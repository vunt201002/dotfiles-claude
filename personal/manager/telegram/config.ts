import os from 'node:os';
import path from 'node:path';

export const DEFAULT_API_BASE = 'https://api.telegram.org';

export type Env = Record<string, string | undefined>;

export interface Paths {
  gstackHome: string;
  managerDir: string;
  portFile: string;
  tokenFile: string;
  stateDir: string;
  outboxFile: string;
  updateLogFile: string;
  pendingFile: string;
  deniedLogFile: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function resolvePaths(env: Env = process.env): Paths {
  const rawHome = env.GSTACK_HOME?.trim();
  const gstackHome = rawHome ? path.resolve(rawHome) : path.join(os.homedir(), '.gstack');
  const managerDir = path.join(gstackHome, 'manager');
  const stateDir = path.join(managerDir, 'telegram');
  return {
    gstackHome,
    managerDir,
    portFile: path.join(managerDir, 'port'),
    tokenFile: path.join(managerDir, 'token'),
    stateDir,
    outboxFile: path.join(stateDir, 'outbox.json'),
    updateLogFile: path.join(stateDir, 'updates.json'),
    pendingFile: path.join(stateDir, 'pending.json'),
    deniedLogFile: path.join(gstackHome, 'security', 'telegram-denied.jsonl'),
  };
}

const CHAT_ID_RE = /^-?\d{1,20}$/;

export function parseChatIds(raw: string | undefined): string[] {
  const entries = (raw ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const bad = entries.filter((entry) => !CHAT_ID_RE.test(entry));
  if (bad.length > 0) {
    throw new ConfigError(`TELEGRAM_ALLOWED_CHAT_IDS chứa giá trị không phải chat-id: ${bad.join(', ')}`);
  }
  return [...new Set(entries)];
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}

export interface BotConfig {
  botToken: string;
  allowedChatIds: Set<string>;
  ownerChatId: string;
  apiBase: string;
  paths: Paths;
  pollTimeoutSec: number;
  rateLimitPerWindow: number;
  rateLimitWindowMs: number;
  maxReconnectAttempts: number;
  questionBatchMs: number;
  outboxMaxItems: number;
  sendGapMs: number;
}

/**
 * Fails closed: a missing token or an empty allowlist aborts startup rather than
 * defaulting to "anyone may drive the manager".
 */
export function loadConfig(env: Env = process.env): BotConfig {
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim() ?? '';
  if (!botToken) {
    throw new ConfigError('Thiếu TELEGRAM_BOT_TOKEN. Xem personal/manager/telegram/README.md.');
  }
  const allowed = parseChatIds(env.TELEGRAM_ALLOWED_CHAT_IDS);
  if (allowed.length === 0) {
    throw new ConfigError('Thiếu TELEGRAM_ALLOWED_CHAT_IDS. Allowlist rỗng nghĩa là chặn hết, bot không khởi động.');
  }
  const apiBase = (env.TELEGRAM_API_BASE?.trim() || DEFAULT_API_BASE).replace(/\/+$/, '');
  return {
    botToken,
    allowedChatIds: new Set(allowed),
    ownerChatId: allowed[0]!,
    apiBase,
    paths: resolvePaths(env),
    pollTimeoutSec: positiveInt(env.TELEGRAM_POLL_TIMEOUT_SEC, 25),
    rateLimitPerWindow: positiveInt(env.TELEGRAM_RATE_LIMIT, 20),
    rateLimitWindowMs: positiveInt(env.TELEGRAM_RATE_LIMIT_WINDOW_MS, 60_000),
    maxReconnectAttempts: positiveInt(env.MANAGER_MAX_RECONNECT_ATTEMPTS, 20),
    questionBatchMs: positiveInt(env.TELEGRAM_QUESTION_BATCH_MS, 3_000),
    outboxMaxItems: positiveInt(env.TELEGRAM_OUTBOX_MAX, 500),
    sendGapMs: positiveInt(env.TELEGRAM_SEND_GAP_MS, 1_100),
  };
}
