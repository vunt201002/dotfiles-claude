/**
 * Single config surface for the manager (§6.4 model routing, §6.5 cost
 * ceilings, §6.3 concurrency, §6.8 blast radius).
 *
 * Everything tunable lives here so swapping the review provider to codex, or
 * raising a ceiling, is a one-file change. Runtime overrides come from
 * ~/.gstack/manager/config.json; env vars win over both so a single run can
 * be nudged without editing files.
 */

import * as fs from 'fs';
import * as os from 'os';
import { managerConfigFile } from './lib/paths';
import type { AgentRole, Lane, TaskSource } from './types';

export type ReviewProvider = 'opus-fresh' | 'codex';

export interface ModelRoute {
  /** Model id handed to the spawn runner. */
  model: string;
  /** Used when the primary is unavailable. Empty string means no fallback. */
  fallback: string;
}

export interface ManagerConfig {
  port: number;
  /** Hard invariant, not a knob: the HTTP surface never leaves loopback. */
  readonly host: '127.0.0.1';
  /** §6.3 — global agent cap. Resolved from cores when null. */
  maxAgents: number | null;
  /** §6.5 — bootstrap flat ceilings, used until a lane has enough history. */
  bootstrapTaskCeilingUsd: number;
  dayCeilingUsd: number;
  /** Number of same-lane samples required before the p90 ceiling takes over. */
  p90MinSamples: number;
  /** Retry cap. Only a B8 verify failure consumes an attempt (§5). */
  maxAttempts: number;
  /**
   * §6.3 — how long a task waits for a scarce lock before it gives up. A hung
   * holder otherwise stalls the whole FIFO forever, and there is only one
   * browser token. Zero or less waits indefinitely.
   */
  lockWaitTimeoutMs: number;
  /** Per-lock overrides, keyed by lock name. Empty means "use the default". */
  lockWaitTimeoutOverrideMs: Record<string, number>;
  /**
   * §7.4 — how long the manager waits for one project's own test command. The
   * manager runs `B8-assert` itself, so a suite that hangs would hold the
   * project lock forever; the timeout turns that into a reported oracle
   * failure instead of a stuck task.
   */
  assertTimeoutMs: number;
  reviewProvider: ReviewProvider;
  models: Record<AgentRole | 'manager', ModelRoute>;
  /** Sonnet is the default executor; a third bug-lon attempt escalates. */
  escalateSubagentOnLastAttempt: boolean;
  spawn: Record<TaskSource, SpawnPolicy>;
  /** Turn budget per role, passed to the runner. */
  maxTurns: Record<AgentRole, number>;
}

export interface SpawnPolicy {
  allowedTools: string[];
  disallowedTools: string[];
  /** Telegram-initiated work always parks for a human gat (§6.8). */
  alwaysRequireApproval: boolean;
}

const BASE_ALLOWED_TOOLS = ['Read', 'Glob', 'Grep', 'Bash', 'Edit', 'Write', 'TodoWrite'];

/**
 * Tools denied to every spawned agent regardless of source. Manager owns
 * spawning and accounting, so an agent fanning out on its own would spend
 * money outside the semaphore and outside the ceiling.
 */
const BASE_DISALLOWED_TOOLS = ['Task', 'NotebookEdit'];

/** Telegram adds the network reach an unattended phone-initiated run should not have. */
const TELEGRAM_EXTRA_DISALLOWED = ['WebFetch', 'WebSearch'];

/**
 * Report-only gates (spec-check, tech-review, impact-review, the judges) get
 * these instead of the source policy's tool list.
 *
 * "Report only. Do not change any file." is a sentence in a prompt, and §7.3b
 * lesson 1 is that a directive is not a fence. A reviewer that can edit is a
 * reviewer that grades its own next revision, so the tools are taken away
 * rather than asked about. Bash goes too: it is a write path the guard cannot
 * parse.
 */
export const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep'];
export const READ_ONLY_DISALLOWED = ['Edit', 'Write', 'Bash', 'NotebookEdit', 'Task'];

export const DEFAULT_CONFIG: ManagerConfig = {
  port: 8787,
  host: '127.0.0.1',
  maxAgents: null,
  bootstrapTaskCeilingUsd: 5,
  dayCeilingUsd: 40,
  p90MinSamples: 20,
  maxAttempts: 3,
  lockWaitTimeoutMs: 15 * 60_000,
  lockWaitTimeoutOverrideMs: {},
  assertTimeoutMs: 10 * 60_000,
  reviewProvider: 'opus-fresh',
  models: {
    manager: { model: 'fable', fallback: 'opus' },
    main: { model: 'opus', fallback: '' },
    subagent: { model: 'sonnet', fallback: 'opus' },
    review: { model: 'opus', fallback: '' },
    judge: { model: 'opus', fallback: '' },
  },
  escalateSubagentOnLastAttempt: true,
  spawn: {
    cli: {
      allowedTools: BASE_ALLOWED_TOOLS,
      disallowedTools: BASE_DISALLOWED_TOOLS,
      alwaysRequireApproval: false,
    },
    api: {
      allowedTools: BASE_ALLOWED_TOOLS,
      disallowedTools: BASE_DISALLOWED_TOOLS,
      alwaysRequireApproval: false,
    },
    telegram: {
      allowedTools: BASE_ALLOWED_TOOLS,
      disallowedTools: [...BASE_DISALLOWED_TOOLS, ...TELEGRAM_EXTRA_DISALLOWED],
      alwaysRequireApproval: true,
    },
  },
  maxTurns: { main: 30, subagent: 80, review: 25, judge: 25 },
};

/**
 * Role aliases resolve to concrete ids at spawn time. Kept next to the routing
 * table so adding a model is one edit, and so the alias survives an id bump.
 */
export const MODEL_IDS: Record<string, string> = {
  fable: 'claude-opus-4-7',
  opus: 'claude-opus-4-7',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5',
};

export function resolveModelId(alias: string): string {
  return MODEL_IDS[alias] ?? alias;
}

/** §6.3 — global agent cap: min(8, cores-2), floored at 1. */
export function resolveMaxAgents(cfg: ManagerConfig = loadConfig()): number {
  if (cfg.maxAgents !== null) return Math.max(1, cfg.maxAgents);
  const cores = os.cpus().length || 4;
  return Math.max(1, Math.min(8, cores - 2));
}

/** Which model actually runs a role for this attempt. */
export function modelForRole(
  role: AgentRole,
  opts: { lane?: Lane; attempt?: number; cfg?: ManagerConfig } = {},
): string {
  const cfg = opts.cfg ?? loadConfig();
  const route = cfg.models[role];
  if (
    role === 'subagent' &&
    cfg.escalateSubagentOnLastAttempt &&
    opts.lane === 'bug-lon' &&
    (opts.attempt ?? 1) >= cfg.maxAttempts &&
    route.fallback
  ) {
    return route.fallback;
  }
  return route.model;
}

function readOverrides(): Partial<ManagerConfig> {
  try {
    const raw = fs.readFileSync(managerConfigFile(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ManagerConfig>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function numberFromEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

let cached: ManagerConfig | null = null;

export function loadConfig(): ManagerConfig {
  if (cached) return cached;
  const overrides = readOverrides();
  const merged: ManagerConfig = {
    ...DEFAULT_CONFIG,
    ...overrides,
    host: '127.0.0.1',
    models: { ...DEFAULT_CONFIG.models, ...(overrides.models ?? {}) },
    spawn: { ...DEFAULT_CONFIG.spawn, ...(overrides.spawn ?? {}) },
    maxTurns: { ...DEFAULT_CONFIG.maxTurns, ...(overrides.maxTurns ?? {}) },
    lockWaitTimeoutOverrideMs: {
      ...DEFAULT_CONFIG.lockWaitTimeoutOverrideMs,
      ...(overrides.lockWaitTimeoutOverrideMs ?? {}),
    },
  };
  const envPort = numberFromEnv('MANAGER_PORT');
  if (envPort !== undefined) merged.port = envPort;
  const envDay = numberFromEnv('MANAGER_DAY_CEILING_USD');
  if (envDay !== undefined) merged.dayCeilingUsd = envDay;
  const envTask = numberFromEnv('MANAGER_TASK_CEILING_USD');
  if (envTask !== undefined) merged.bootstrapTaskCeilingUsd = envTask;
  const envAgents = numberFromEnv('MANAGER_MAX_AGENTS');
  if (envAgents !== undefined) merged.maxAgents = envAgents;
  const envLockWait = numberFromEnv('MANAGER_LOCK_TIMEOUT_MS');
  if (envLockWait !== undefined) merged.lockWaitTimeoutMs = envLockWait;
  const envAssert = numberFromEnv('MANAGER_ASSERT_TIMEOUT_MS');
  if (envAssert !== undefined) merged.assertTimeoutMs = envAssert;
  cached = merged;
  return merged;
}

export function resetConfigCache(): void {
  cached = null;
}
