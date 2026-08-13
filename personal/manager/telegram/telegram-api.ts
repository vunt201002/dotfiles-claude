import { redact } from './logger';

export interface TelegramChat {
  id: number | string;
  type?: string;
}

export interface TelegramUser {
  id: number | string;
  username?: string;
  is_bot?: boolean;
}

export interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  caption?: string;
  date?: number;
  forward_origin?: unknown;
  forward_from?: unknown;
  forward_from_chat?: unknown;
  forward_sender_name?: string;
  via_bot?: TelegramUser;
  reply_to_message?: TelegramMessage;
}

export interface TelegramCallbackQuery {
  id: string;
  from?: TelegramUser;
  data?: string;
  message?: TelegramMessage;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export const MAX_MESSAGE_CHARS = 3800;

export class TelegramError extends Error {
  constructor(
    message: string,
    readonly method: string,
    readonly status?: number,
    readonly retryAfterSec?: number,
  ) {
    super(redact(message));
    this.name = 'TelegramError';
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface TelegramApiOptions {
  botToken: string;
  apiBase: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/**
 * Thin Bot API wrapper over fetch. The bot token only ever appears inside the
 * request URL; errors carry the method name, never the URL.
 */
export class TelegramApi {
  private readonly botToken: string;
  private readonly apiBase: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: TelegramApiOptions) {
    this.botToken = options.botToken;
    this.apiBase = options.apiBase.replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async call<T>(method: string, body?: unknown, timeoutMs = this.timeoutMs): Promise<T> {
    const url = `${this.apiBase}/bot${this.botToken}/${method}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new TelegramError(`không gọi được Telegram (${(err as Error).message})`, method);
    }

    let payload: { ok?: boolean; result?: T; description?: string; parameters?: { retry_after?: number } };
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      throw new TelegramError(`Telegram trả về body không phải JSON (HTTP ${response.status})`, method, response.status);
    }

    if (!response.ok || payload.ok !== true) {
      throw new TelegramError(
        `Telegram từ chối ${method}: HTTP ${response.status} ${payload.description ?? ''}`.trim(),
        method,
        response.status,
        payload.parameters?.retry_after,
      );
    }
    return payload.result as T;
  }

  getUpdates(offset: number, timeoutSec: number): Promise<TelegramUpdate[]> {
    return this.call<TelegramUpdate[]>(
      'getUpdates',
      { offset, timeout: timeoutSec, allowed_updates: ['message', 'callback_query'] },
      (timeoutSec + 15) * 1000,
    );
  }

  sendMessage(chatId: string, text: string, replyMarkup?: InlineKeyboardMarkup): Promise<TelegramMessage> {
    return this.call<TelegramMessage>('sendMessage', {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  }

  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<boolean> {
    return this.call<boolean>('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
    });
  }

  clearReplyMarkup(chatId: string, messageId: number): Promise<unknown> {
    return this.call<unknown>('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] },
    });
  }

  getMe(): Promise<TelegramUser> {
    return this.call<TelegramUser>('getMe');
  }
}

/** Splits on line boundaries where possible so phone-sized messages stay readable. */
export function chunkText(text: string, limit = MAX_MESSAGE_CHARS): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const breakAt = window.lastIndexOf('\n');
    const cut = breakAt > limit * 0.5 ? breakAt : limit;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}
