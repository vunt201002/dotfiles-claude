import { appendLine } from './store';
import type { TelegramMessage, TelegramUpdate } from './telegram-api';

export interface AuthDecision {
  ok: boolean;
  chatId: string;
  fromId: string;
  reason: string;
}

function idOf(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim()) return value.trim();
  return '';
}

/**
 * Both the chat and the sender must be on the allowlist. In a private chat the
 * two ids are the same; in a group this stops a non-allowlisted member from
 * pressing an approval button in a chat that is otherwise trusted.
 */
export function authorize(update: TelegramUpdate, allowed: ReadonlySet<string>): AuthDecision {
  const message: TelegramMessage | undefined = update.message ?? update.callback_query?.message;
  const chatId = idOf(message?.chat?.id);
  const fromId = idOf(update.callback_query?.from?.id ?? update.message?.from?.id);

  if (!chatId) return { ok: false, chatId: '', fromId, reason: 'no-chat-id' };
  if (!allowed.has(chatId)) return { ok: false, chatId, fromId, reason: 'chat-not-allowed' };
  if (fromId && fromId !== chatId && !allowed.has(fromId)) {
    return { ok: false, chatId, fromId, reason: 'sender-not-allowed' };
  }
  return { ok: true, chatId, fromId, reason: 'ok' };
}

export interface DeniedRecord {
  ts: string;
  chat_id: string;
  from_id: string;
  reason: string;
}

/**
 * Records the identity of a rejected caller and nothing else. Message text is
 * never written: the log must stay safe to read and to ship around.
 */
export function logDenied(file: string, decision: AuthDecision, now: () => number = Date.now): DeniedRecord {
  const record: DeniedRecord = {
    ts: new Date(now()).toISOString(),
    chat_id: decision.chatId,
    from_id: decision.fromId,
    reason: decision.reason,
  };
  try {
    appendLine(file, JSON.stringify(record));
  } catch {
    void 0;
  }
  return record;
}

interface Bucket {
  tokens: number;
  windowStart: number;
  notified: boolean;
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private readonly capacity: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  private bucket(key: string): Bucket {
    const stamp = this.now();
    const existing = this.buckets.get(key);
    if (!existing || stamp - existing.windowStart >= this.windowMs) {
      const fresh: Bucket = { tokens: this.capacity, windowStart: stamp, notified: false };
      this.buckets.set(key, fresh);
      return fresh;
    }
    return existing;
  }

  tryConsume(key: string): boolean {
    const bucket = this.bucket(key);
    if (bucket.tokens <= 0) return false;
    bucket.tokens -= 1;
    return true;
  }

  /** True once per window, so a throttled chat gets one notice instead of a flood. */
  shouldNotify(key: string): boolean {
    const bucket = this.bucket(key);
    if (bucket.notified) return false;
    bucket.notified = true;
    return true;
  }
}
