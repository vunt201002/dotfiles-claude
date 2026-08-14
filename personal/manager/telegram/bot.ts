import { ConfigError, loadConfig, type BotConfig } from './config';
import { log, logError, redact, registerSecret, warn } from './logger';
import {
  ManagerClient,
  ManagerRequestError,
  ManagerUnavailableError,
  type ApprovalEvent,
  type ManagerEvent,
  type QuestionEvent,
  type ReportEvent,
} from './manager-client';
import { Outbox, type OutboundItem, type OutboundKind } from './outbox';
import { PendingStore } from './pending';
import { parseCommand, parseNumberedAnswer, type ParsedCommand } from './commands';
import {
  approvalKeyboard,
  renderApproval,
  renderCost,
  renderFleetReport,
  renderDiff,
  renderHelp,
  renderProjectReport,
  renderQuestionBatch,
  renderReport,
  renderStatus,
} from './render';
import { RateLimiter, authorize, logDenied } from './security';
import { ensureDir } from './store';
import {
  TelegramApi,
  TelegramError,
  chunkText,
  type InlineKeyboardMarkup,
  type TelegramCallbackQuery,
  type TelegramMessage,
  type TelegramUpdate,
} from './telegram-api';
import { UpdateLog } from './update-log';
import { classifyProvenance, wrapUntrusted } from './untrusted';

const CALLBACK_RE = /^ap:([A-Za-z0-9_-]{1,32}):(y|n|d)$/;

function backoffMs(attempt: number): number {
  const base = Math.min(1000 * 2 ** Math.max(0, attempt - 1), 60_000);
  return base + Math.floor(Math.random() * 250);
}

function describeError(err: unknown): string {
  if (err instanceof ManagerUnavailableError) return err.message;
  if (err instanceof ManagerRequestError) return err.message;
  if (err instanceof Error) return err.message;
  return 'lỗi không rõ';
}

export interface BotOverrides {
  api?: TelegramApi;
  manager?: ManagerClient;
}

export class Bot {
  private readonly api: TelegramApi;
  private readonly manager: ManagerClient;
  private readonly outbox: Outbox;
  private readonly pending: PendingStore;
  private readonly updateLog: UpdateLog;
  private readonly limiter: RateLimiter;
  private readonly abort = new AbortController();
  private readonly pendingSleeps = new Set<{ timer: ReturnType<typeof setTimeout>; resolve: () => void }>();
  private readonly approvalsInFlight = new Set<string>();

  private stopping = false;
  private flushing = false;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private questionTimer: ReturnType<typeof setTimeout> | undefined;
  private managerDown = false;
  private eventsStopped = false;
  private eventsRunning = false;
  private loops: Promise<void>[] = [];

  constructor(
    private readonly config: BotConfig,
    overrides: BotOverrides = {},
  ) {
    registerSecret(config.botToken);
    ensureDir(config.paths.stateDir);
    this.api =
      overrides.api ?? new TelegramApi({ botToken: config.botToken, apiBase: config.apiBase });
    this.manager = overrides.manager ?? new ManagerClient(config.paths);
    this.outbox = Outbox.load(config.paths.outboxFile, config.outboxMaxItems);
    this.outbox.onEvict = (items) => warn(`hàng đợi outbound đầy, bỏ ${items.length} tin loại report/notice`);
    this.pending = PendingStore.load(config.paths.pendingFile);
    this.updateLog = UpdateLog.load(config.paths.updateLogFile);
    this.limiter = new RateLimiter(config.rateLimitPerWindow, config.rateLimitWindowMs);
  }

  start(): void {
    log(`bot khởi động · allowlist ${this.config.allowedChatIds.size} chat · state ${this.config.paths.stateDir}`);
    if (this.outbox.size > 0) log(`còn ${this.outbox.size} tin chưa gửi từ lần chạy trước`);
    this.loops = [this.pollLoop(), this.eventsLoop()];
    this.kickFlush(0);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.abort.abort();
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    if (this.questionTimer) clearTimeout(this.questionTimer);
    this.questionTimer = undefined;
    for (const entry of this.pendingSleeps) {
      clearTimeout(entry.timer);
      entry.resolve();
    }
    this.pendingSleeps.clear();
    await Promise.allSettled(this.loops);
  }

  /** Resolves early on shutdown so no loop can park on a backoff timer. */
  private sleep(ms: number): Promise<void> {
    if (this.stopping) return Promise.resolve();
    return new Promise((resolve) => {
      const entry = {
        timer: setTimeout(() => {
          this.pendingSleeps.delete(entry);
          resolve();
        }, ms),
        resolve,
      };
      this.pendingSleeps.add(entry);
    });
  }

  private enqueueMessage(
    chatId: string,
    kind: OutboundKind,
    text: string,
    replyMarkup?: InlineKeyboardMarkup,
    meta?: Record<string, unknown>,
  ): void {
    const chunks = chunkText(redact(text));
    chunks.forEach((chunk, index) => {
      const last = index === chunks.length - 1;
      this.outbox.enqueue({
        chatId,
        kind,
        text: chunk,
        ...(last && replyMarkup ? { replyMarkup } : {}),
        ...(last && meta ? { meta } : {}),
      });
    });
    this.kickFlush(0);
  }

  private notifyOwner(text: string): void {
    this.enqueueMessage(this.config.ownerChatId, 'notice', text);
  }

  private kickFlush(delay: number): void {
    if (this.stopping || this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      void this.flushOnce();
    }, delay);
  }

  private async flushOnce(): Promise<void> {
    if (this.flushing || this.stopping) return;
    this.flushing = true;
    try {
      while (!this.stopping) {
        const item = this.outbox.peek();
        if (!item) break;
        try {
          const sent = await this.api.sendMessage(
            item.chatId,
            item.text,
            item.replyMarkup as InlineKeyboardMarkup | undefined,
          );
          this.outbox.resolve(item.id);
          this.afterSend(item, sent);
          if (this.config.sendGapMs > 0) await this.sleep(this.config.sendGapMs);
        } catch (err) {
          this.outbox.fail(item.id);
          const retryAfter = err instanceof TelegramError ? err.retryAfterSec : undefined;
          const delay = retryAfter ? retryAfter * 1000 : backoffMs(item.attempts + 1);
          warn(`gửi Telegram thất bại (${describeError(err)}), thử lại sau ${Math.round(delay / 1000)}s`);
          this.kickFlush(delay);
          break;
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  private afterSend(item: OutboundItem, sent: TelegramMessage | undefined): void {
    const shortId = item.meta?.approvalShortId;
    if (typeof shortId === 'string' && sent && typeof sent.message_id === 'number') {
      this.pending.setApprovalMessage(shortId, item.chatId, sent.message_id);
    }
  }

  private async pollLoop(): Promise<void> {
    let failures = 0;
    while (!this.stopping) {
      try {
        const updates = await this.api.getUpdates(this.updateLog.offset, this.config.pollTimeoutSec);
        failures = 0;
        for (const update of updates) {
          if (this.stopping) break;
          void this.handleUpdate(update).catch((err) => logError('xử lý update lỗi', err));
        }
      } catch (err) {
        if (this.stopping) break;
        failures += 1;
        warn(`getUpdates lỗi (${describeError(err)})`);
        await this.sleep(backoffMs(failures));
      }
    }
  }

  /**
   * Marks the update as taken in before doing any work: replaying a `/run`
   * after a crash is worse than dropping one the operator can retype.
   */
  async handleUpdate(update: TelegramUpdate): Promise<void> {
    const id = update.update_id;
    if (typeof id !== 'number') return;
    if (this.updateLog.has(id)) return;
    this.updateLog.mark(id);

    const decision = authorize(update, this.config.allowedChatIds);
    if (!decision.ok) {
      logDenied(this.config.paths.deniedLogFile, decision);
      log(`từ chối update ${id} · chat ${decision.chatId || '?'} · ${decision.reason}`);
      return;
    }

    if (update.callback_query) {
      await this.handleCallback(update.callback_query, decision.chatId);
      return;
    }
    if (update.message) await this.handleMessage(update.message, decision.chatId);
  }

  private async handleMessage(message: TelegramMessage, chatId: string): Promise<void> {
    const raw = (message.text ?? message.caption ?? '').trim();
    const provenance = classifyProvenance(message);

    if (!raw) {
      if (this.limiter.tryConsume(chatId)) this.enqueueMessage(chatId, 'reply', 'Bot chỉ nhận tin nhắn text.');
      return;
    }

    const parsed: ParsedCommand = provenance.external ? { kind: 'text', text: raw } : parseCommand(raw);

    if (parsed.kind === 'stopall') {
      await this.handleStopAll(chatId);
      return;
    }

    if (!this.limiter.tryConsume(chatId)) {
      if (this.limiter.shouldNotify(chatId)) {
        this.enqueueMessage(chatId, 'notice', 'Nhiều tin quá, bot tạm bỏ qua bớt. /stopall thì luôn chạy.');
      }
      return;
    }

    try {
      await this.dispatch(parsed, chatId, provenance.external ? provenance.source : undefined);
    } catch (err) {
      logError('lệnh thất bại', err);
      this.enqueueMessage(chatId, 'reply', `Không chạy được: ${describeError(err)}`);
    }
  }

  private async dispatch(parsed: ParsedCommand, chatId: string, externalSource?: string): Promise<void> {
    switch (parsed.kind) {
      case 'status': {
        const tasks = await this.manager.listTasks();
        this.ensureEventsRunning();
        this.enqueueMessage(chatId, 'reply', renderStatus(tasks ?? []));
        return;
      }
      case 'run': {
        const created = await this.manager.createTask(parsed.project, parsed.issue);
        this.enqueueMessage(
          chatId,
          'reply',
          `▶️ Đã giao ${parsed.project}/${parsed.issue}\nTask: ${created?.taskId ?? '(manager không trả taskId)'}`,
        );
        return;
      }
      case 'report': {
        const tasks = await this.manager.listTasks();
        this.enqueueMessage(chatId, 'reply', renderProjectReport(parsed.project, tasks ?? []));
        return;
      }
      case 'stop': {
        await this.manager.stop(parsed.taskId);
        this.enqueueMessage(chatId, 'reply', `⏹ Đã yêu cầu dừng ${parsed.taskId}.`);
        return;
      }
      case 'cost': {
        const report = await this.manager.cost(parsed.window);
        this.enqueueMessage(chatId, 'reply', renderCost(parsed.window, report ?? {}));
        return;
      }
      case 'fleet': {
        const report = await this.manager.fleet();
        this.enqueueMessage(chatId, 'reply', renderFleetReport(report ?? {}));
        return;
      }
      case 'text':
        await this.handleFreeText(parsed.text, chatId, externalSource);
        return;
      case 'invalid':
        this.enqueueMessage(chatId, 'reply', parsed.reason);
        return;
      case 'unknown':
        this.enqueueMessage(chatId, 'reply', `Không có lệnh ${parsed.name}.\n${renderHelp()}`);
        return;
      default:
        return;
    }
  }

  /**
   * Relayed content never routes to a task answer and never parses as a
   * command; it goes to the manager as marked data.
   */
  private async handleFreeText(text: string, chatId: string, externalSource?: string): Promise<void> {
    if (externalSource) {
      const { reply } = (await this.manager.prompt(wrapUntrusted(text, externalSource))) ?? { reply: '' };
      this.enqueueMessage(chatId, 'reply', reply || '(manager không trả lời gì)');
      return;
    }

    const numbered = parseNumberedAnswer(text);
    const target = numbered ? this.pending.questionAt(numbered.index) : undefined;
    if (numbered && !target) {
      this.enqueueMessage(chatId, 'reply', `Không có câu số ${numbered.index} đang treo.`);
      return;
    }

    if (target && numbered) {
      await this.manager.answer(target.taskId, numbered.body);
      this.pending.removeQuestion(target.id);
      const left = this.pending.questionCount;
      this.enqueueMessage(
        chatId,
        'reply',
        `✅ Đã trả lời ${target.taskId}.${left > 0 ? `\nCòn ${left} câu treo.` : ''}`,
      );
      if (left > 0) this.enqueueMessage(chatId, 'question', renderQuestionBatch(this.pending.listQuestions()));
      return;
    }

    const { reply } = (await this.manager.prompt(text)) ?? { reply: '' };
    this.enqueueMessage(chatId, 'reply', reply || '(manager không trả lời gì)');
  }

  private async handleStopAll(chatId: string): Promise<void> {
    try {
      const result = await this.manager.stopAll();
      this.enqueueMessage(chatId, 'notice', `🛑 Đã dừng ${result?.stopped ?? 0} task.`);
    } catch (err) {
      logError('stopall thất bại', err);
      this.enqueueMessage(chatId, 'notice', `🛑 KHÔNG dừng được: ${describeError(err)}`);
    }
  }

  private async handleCallback(query: TelegramCallbackQuery, chatId: string): Promise<void> {
    const match = CALLBACK_RE.exec(query.data ?? '');
    if (!match) {
      await this.api.answerCallbackQuery(query.id, 'Nút không hợp lệ.').catch(() => {});
      return;
    }
    const approval = this.pending.getApproval(match[1]!);
    if (!approval) {
      await this.api.answerCallbackQuery(query.id, 'Yêu cầu này không còn.').catch(() => {});
      return;
    }

    if (match[2] === 'd') {
      await this.api.answerCallbackQuery(query.id, 'Đang lấy diff...').catch(() => {});
      let diff = approval.diff;
      if (!diff) {
        try {
          const record = await this.manager.getTask(approval.taskId);
          if (typeof record?.diff === 'string') diff = record.diff;
        } catch (err) {
          warn(`không lấy được diff (${describeError(err)})`);
        }
      }
      this.enqueueMessage(chatId, 'reply', renderDiff(approval.taskId, diff));
      return;
    }

    if (approval.resolved || this.approvalsInFlight.has(approval.shortId)) {
      await this.api.answerCallbackQuery(query.id, 'Đã xử lý rồi.').catch(() => {});
      return;
    }

    const approved = match[2] === 'y';
    this.approvalsInFlight.add(approval.shortId);
    try {
      await this.manager.approve(approval.taskId, approved);
      this.pending.resolveApproval(approval.shortId);
      await this.api.answerCallbackQuery(query.id, approved ? 'Đã gật.' : 'Đã lắc.').catch(() => {});
      if (approval.chatId && typeof approval.messageId === 'number') {
        await this.api.clearReplyMarkup(approval.chatId, approval.messageId).catch(() => {});
      }
      this.enqueueMessage(
        chatId,
        'reply',
        `${approved ? '✅ Đã gật' : '🚫 Đã lắc'} — ${approval.taskId}`,
      );
    } catch (err) {
      logError('gửi quyết định approval thất bại', err);
      await this.api.answerCallbackQuery(query.id, 'Manager không nhận được.').catch(() => {});
      this.enqueueMessage(
        chatId,
        'reply',
        `Chưa gửi được quyết định cho ${approval.taskId}: ${describeError(err)}\nBấm lại nút khi manager lên.`,
      );
    } finally {
      this.approvalsInFlight.delete(approval.shortId);
    }
  }

  private ensureEventsRunning(): void {
    if (!this.eventsStopped || this.stopping) return;
    this.eventsStopped = false;
    this.loops.push(this.eventsLoop());
  }

  private async eventsLoop(): Promise<void> {
    if (this.eventsRunning) return;
    this.eventsRunning = true;
    let attempts = 0;
    try {
      while (!this.stopping) {
        try {
          for await (const event of this.manager.events(this.abort.signal)) {
            attempts = 0;
            if (this.managerDown) {
              this.managerDown = false;
              this.notifyOwner('✅ Manager đã kết nối lại.');
            }
            this.dispatchEvent(event);
          }
          if (this.stopping) break;
          attempts += 1;
        } catch (err) {
          if (this.stopping) break;
          attempts += 1;
          if (attempts >= 3 && !this.managerDown) {
            this.managerDown = true;
            this.notifyOwner(`⚠️ Manager không phản hồi: ${describeError(err)}\nBot vẫn nhận lệnh, sẽ thử lại.`);
          }
        }
        if (attempts > this.config.maxReconnectAttempts) {
          this.eventsStopped = true;
          this.notifyOwner('⚠️ Đã ngừng thử kết nối lại manager. Gõ /status để thử lại.');
          break;
        }
        await this.sleep(backoffMs(attempts));
      }
    } finally {
      this.eventsRunning = false;
    }
  }

  dispatchEvent(event: ManagerEvent): void {
    switch (event.type) {
      case 'report':
        this.enqueueMessage(this.config.ownerChatId, 'report', renderReport(event as ReportEvent));
        return;
      case 'question': {
        const question = event as QuestionEvent;
        if (!question.taskId || !question.text) {
          warn('bỏ qua event question thiếu taskId hoặc text');
          return;
        }
        this.pending.addQuestion({
          taskId: question.taskId,
          project: question.project,
          issue: question.issue,
          text: question.text,
        });
        this.scheduleQuestionBatch();
        return;
      }
      case 'approval': {
        const approval = event as ApprovalEvent;
        if (!approval.taskId || !approval.action) {
          warn('bỏ qua event approval thiếu taskId hoặc action');
          return;
        }
        const record = this.pending.addApproval({
          taskId: approval.taskId,
          action: approval.action,
          detail: approval.detail,
          diff: approval.diff,
        });
        this.enqueueMessage(
          this.config.ownerChatId,
          'approval',
          renderApproval(approval),
          approvalKeyboard(record.shortId),
          { approvalShortId: record.shortId },
        );
        return;
      }
      default:
        warn(`event lạ từ manager: ${(event as { type?: string }).type}`);
    }
  }

  private scheduleQuestionBatch(): void {
    if (this.questionTimer) clearTimeout(this.questionTimer);
    this.questionTimer = setTimeout(() => {
      this.questionTimer = undefined;
      if (this.pending.questionCount === 0) return;
      this.enqueueMessage(this.config.ownerChatId, 'question', renderQuestionBatch(this.pending.listQuestions()));
    }, this.config.questionBatchMs);
  }
}

export function createBot(config: BotConfig, overrides: BotOverrides = {}): Bot {
  return new Bot(config, overrides);
}

async function main(): Promise<void> {
  let config: BotConfig;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  const checkOnly = process.argv.includes('--check');
  const api = new TelegramApi({ botToken: config.botToken, apiBase: config.apiBase });

  let me: string;
  try {
    const info = await api.getMe();
    me = info.username ? `@${info.username}` : String(info.id);
  } catch (err) {
    process.stderr.write(`Telegram từ chối token bot. ${redact(describeError(err))}\n`);
    process.exit(1);
  }

  if (checkOnly) {
    let managerState: string;
    try {
      const client = new ManagerClient(config.paths);
      const endpoint = client.endpoint();
      managerState = `ok (${endpoint.base})`;
    } catch (err) {
      managerState = describeError(err);
    }
    process.stdout.write(
      [
        `bot: ${me}`,
        `allowlist: ${config.allowedChatIds.size} chat-id`,
        `owner chat: ${config.ownerChatId}`,
        `state dir: ${config.paths.stateDir}`,
        `deny log: ${config.paths.deniedLogFile}`,
        `manager: ${managerState}`,
        '',
      ].join('\n'),
    );
    return;
  }

  const bot = createBot(config, { api });
  bot.start();
  log(`đang lắng nghe với tư cách ${me}`);

  const shutdown = () => {
    log('đang dừng...');
    void bot.stop().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (import.meta.main) {
  main().catch((err) => {
    logError('bot chết', err);
    process.exit(1);
  });
}
