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
export type ExecutionProvider = 'claude' | 'codex';

/** Two gates of the same family are one opinion wearing two labels (§7.3). */
export type ModelFamily = 'anthropic' | 'openai' | 'unknown';

export const REVIEW_PROVIDER_FAMILY: Record<ReviewProvider, ModelFamily> = {
  'opus-fresh': 'anthropic',
  codex: 'openai',
};

export const EXECUTION_PROVIDER_FAMILY: Record<ExecutionProvider, ModelFamily> = {
  claude: 'anthropic',
  codex: 'openai',
};

const MODEL_FAMILY_PREFIXES: Array<[string, ModelFamily]> = [
  ['claude', 'anthropic'],
  ['gpt', 'openai'],
  ['o1', 'openai'],
  ['o3', 'openai'],
  ['codex', 'openai'],
];

/**
 * A model nobody has classified comes back `unknown`, not guessed.
 *
 * "Anything that is not Claude is OpenAI" would label a Gemini route openai and
 * print that as if it had been checked. The independence claim is only worth
 * the classification behind it, so an unrecognised model refuses to support one.
 */
export function familyOfModel(idOrAlias: string): ModelFamily {
  const id = resolveModelId(idOrAlias).toLowerCase();
  return MODEL_FAMILY_PREFIXES.find(([prefix]) => id.startsWith(prefix))?.[1] ?? 'unknown';
}

/** sdk = Agent SDK child · cli = `claude -p` · cmux = a pane you can watch. */
export type SpawnRunner = 'sdk' | 'cli' | 'cmux';

export const SPAWN_RUNNERS: readonly SpawnRunner[] = ['sdk', 'cli', 'cmux'];

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
  projectConcurrency: Record<string, number>;
  /** §6.5 — bootstrap flat ceilings, used until a lane has enough history. */
  bootstrapTaskCeilingUsd: number;
  dayCeilingUsd: number;
  /** Number of same-lane samples required before the p90 ceiling takes over. */
  p90MinSamples: number;
  /**
   * How many unpriced runs one task may accumulate before it parks.
   *
   * A codex review spends CLI quota, which no dollar ceiling can see, so §6.5's
   * ceiling stops bounding those runs entirely. Counting them is the only bound
   * left. It bounds RUNS, not money — say that out loud rather than let the
   * number read as a spend limit.
   */
  maxUnmeasuredRunsPerTask: number;
  /** Retry cap shared by B8 verification and infrastructure failures (§5). */
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
  /**
   * Tools a judge needs to actually look at the page (§7.4). Empty by default,
   * and empty means the browser gates refuse to run rather than run blind.
   *
   * It has to be configuration because there is no transport a spawned agent
   * can assume: `claude-in-chrome` is supplied by the host to an interactive
   * session, not by a config file, so an SDK child does not inherit it. Until a
   * real transport is named here, `B8-judge` and `design-judge` report `error`.
   * The alternative — hand a judge the browser token, let it produce a verdict
   * having never opened the page, and log that verdict as evidence — is the
   * failure this whole book exists to make impossible.
   */
  browserTools: string[];
  /**
   * Where an agent actually runs. `MANAGER_SPAWN_RUNNER` overrides it for one
   * process, which is how a single daemon gets tried on cmux without changing
   * what every other entry point does.
   */
  spawnRunner: SpawnRunner;
  executionProvider: ExecutionProvider;
  /**
   * Roles that get their own cmux pane. Everything else falls back to the SDK
   * port even when the cmux runner is selected.
   *
   * Only the executor is here by default. A pane is for work a human might
   * want to watch or take over; a report-only gate is neither, and five extra
   * panes per task would bury the one that matters.
   */
  cmuxRoles: AgentRole[];
  /**
   * A cmux pane runs a real `claude` against the operator's own settings, so
   * an unanswered permission prompt hangs an unattended task forever. Skipping
   * them is only allowed when `pre-tool-use-guard.sh` is wired — the port
   * checks, and refuses to launch rather than trusting the flag alone.
   */
  cmuxSkipPermissions: boolean;
  cmuxClaudeBin: string;
  cmuxCodexBin: string;
  cmuxClaudeArgs: string[];
  cmuxLaneWorkspace: string;
  cmuxLaneTitles: string[];
  cmuxLaneShellReadyMs: number;
  /** How long a pane has to register a session and start its first turn. */
  cmuxStartupMs: number;
  cmuxRunTimeoutMs: number;
  /**
   * How long a `claude -p` run may take. Without it the cli port inherits the
   * eval harness default of two minutes, which kills real implementation work
   * mid-edit and reports it as a run that produced nothing.
   */
  cliRunTimeoutMs: number;
  /**
   * How long a pane may sit waiting on a human before it stops reserving an
   * agent slot. It keeps showing in the fleet report either way.
   */
  abandonedPaneAfterMs: number;
  /** How long an agent may sit at needsInput before the task is handed back. */
  cmuxNeedsInputGraceMs: number;
  /**
   * How long a task waits for a free agent slot. Bounded because the cap
   * counts the operator's own panes, and those do not free themselves.
   */
  cmuxSlotWaitMs: number;
  /** A failed pane always stays open; this only governs the successful ones. */
  cmuxCloseOnSuccess: boolean;
  /**
   * Gitignored paths symlinked from the main checkout into each task worktree.
   * A fresh worktree has tracked files only, so without this the first command
   * a task runs fails on a missing dependency.
   */
  worktreeLinks: string[];
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
  projectConcurrency: {},
  bootstrapTaskCeilingUsd: 10,
  dayCeilingUsd: 40,
  p90MinSamples: 20,
  maxUnmeasuredRunsPerTask: 12,
  maxAttempts: 3,
  lockWaitTimeoutMs: 15 * 60_000,
  lockWaitTimeoutOverrideMs: {},
  assertTimeoutMs: 10 * 60_000,
  browserTools: [],
  spawnRunner: 'sdk',
  executionProvider: 'claude',
  cmuxRoles: ['main', 'subagent'],
  cmuxSkipPermissions: true,
  cmuxClaudeBin: 'claude',
  cmuxCodexBin: 'codex',
  cmuxClaudeArgs: [],
  cmuxLaneWorkspace: '',
  cmuxLaneTitles: ['L1', 'L2', 'L3', 'L4'],
  cmuxLaneShellReadyMs: 20_000,
  cmuxStartupMs: 3 * 60_000,
  cmuxRunTimeoutMs: 45 * 60_000,
  cliRunTimeoutMs: 45 * 60_000,
  abandonedPaneAfterMs: 2 * 60 * 60_000,
  cmuxNeedsInputGraceMs: 2 * 60_000,
  cmuxSlotWaitMs: 30 * 60_000,
  cmuxCloseOnSuccess: false,
  worktreeLinks: ['node_modules', '.env', '.env.local'],
  reviewProvider: 'codex',
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

export function resolveProjectConcurrency(project: string, cfg: ManagerConfig = loadConfig()): number {
  return Math.max(1, Math.floor(cfg.projectConcurrency[project] ?? 1));
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

/**
 * An unrecognised provider lands on the DEFAULT one, not on a hardcoded name.
 *
 * The runtime override file is hand-edited, and a typo there used to fall back
 * to `opus-fresh` — the same family as the agent being graded, which is exactly
 * the collapse §7.3 forbids, arrived at silently. Falling back to the shipped
 * default keeps a typo from quietly undoing the independence.
 */
export function resolveReviewProvider(cfg: ManagerConfig = loadConfig()): ReviewProvider {
  return Object.prototype.hasOwnProperty.call(REVIEW_PROVIDER_FAMILY, cfg.reviewProvider)
    ? cfg.reviewProvider
    : DEFAULT_CONFIG.reviewProvider;
}

export interface ReviewIndependence {
  provider: ReviewProvider;
  reviewFamily: ModelFamily;
  /** Judges run on the spawn port, so they share the agent's transport. */
  judgeFamily: ModelFamily;
  /** Every family the executor can run as, escalation included. */
  agentFamilies: ModelFamily[];
  reviewIndependent: boolean;
  judgeIndependent: boolean;
  /** True only when EVERY llm gate differs in family from the agent. */
  fullyIndependent: boolean;
  /** Names every half, and what is wrong when one collapses. */
  line: string;
}

/**
 * Every model the executor can actually run as on some attempt.
 *
 * `modelForRole` swaps `subagent` to its fallback on a last bug-lon attempt, so
 * reading `route.model` alone would clear a pairing that goes same-family on
 * attempt 3 — the attempt that matters most.
 */
function agentModels(cfg: ManagerConfig): string[] {
  if (cfg.executionProvider === 'codex') return ['codex'];
  const route = cfg.models.subagent;
  const models = [route.model];
  if (cfg.escalateSubagentOnLastAttempt && route.fallback) models.push(route.fallback);
  return models;
}

/**
 * §7.3 BLOCKER 4 as something a caller can read: the gates are independent in
 * CONTEXT already, and this is the other half — whether they are independent in
 * FAILURE MODE. Mirrors describeBackends() in the oracle's llm-gates.ts, so the
 * measured path and the real path answer the same question the same way.
 *
 * Two honesty limits are stated rather than hidden. The judges are counted,
 * because they are llm gates too and they run on the agent's own transport. And
 * the review family is ASSERTED from the provider table, never observed: the
 * codex port shells `codex exec` against the operator's own `~/.codex/` config
 * and whatever model that picks is what actually reviews.
 */
export function reviewIndependence(cfg: ManagerConfig = loadConfig()): ReviewIndependence {
  const provider = resolveReviewProvider(cfg);
  const reviewFamily = REVIEW_PROVIDER_FAMILY[provider];
  const models = agentModels(cfg);
  const agentFamilies = [...new Set(models.map(familyOfModel))];
  const judgeFamily = familyOfModel(cfg.models.judge.model);

  const differs = (family: ModelFamily): boolean =>
    family !== 'unknown' && !agentFamilies.includes('unknown') && !agentFamilies.includes(family);
  const reviewIndependent = differs(reviewFamily);
  const judgeIndependent = differs(judgeFamily);

  const faults: string[] = [];
  if (!reviewIndependent) faults.push(`review shares the agent's family (${reviewFamily})`);
  if (!judgeIndependent) faults.push(`judges share the agent's family (${judgeFamily})`);
  const where = `review=${provider}[${reviewFamily}, asserted] judge=${cfg.models.judge.model}[${judgeFamily}] agent=${models.join('|')}[${agentFamilies.join('|')}]`;

  return {
    provider,
    reviewFamily,
    judgeFamily,
    agentFamilies,
    reviewIndependent,
    judgeIndependent,
    fullyIndependent: reviewIndependent && judgeIndependent,
    line: faults.length === 0 ? where : `${where} — ${faults.join('; ')}, not an independent check (§7.3)`,
  };
}

const NUMERIC_ENV_NAMES = [
  'MANAGER_PORT',
  'MANAGER_DAY_CEILING_USD',
  'MANAGER_TASK_CEILING_USD',
  'MANAGER_MAX_AGENTS',
  'MANAGER_LOCK_TIMEOUT_MS',
  'MANAGER_ASSERT_TIMEOUT_MS',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readOverrides(): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(managerConfigFile(), 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) throw new Error('top level must be an object');
    return parsed;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot read manager config: ${reason}`);
  }
}

function numberFromEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  if (raw.trim() === '') throw new Error(`${name} must be a finite number`);
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a finite number`);
  return n;
}

/**
 * Identity of the override file as it is on disk right now. Atomic writes swap
 * the inode, plain writes move mtime or size, so all three together change on
 * any edit that matters. Unreadable and absent both collapse to the same key,
 * which is correct: creating the file later changes it and forces a reload.
 */
function overrideStamp(): string {
  try {
    const s = fs.statSync(managerConfigFile());
    return `file:${s.mtimeMs}:${s.size}:${s.ino}`;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return 'missing';
    const reason = error instanceof Error ? error.message : String(error);
    return `error:${reason}`;
  }
}

function configStamp(): string {
  const env = NUMERIC_ENV_NAMES.map((name) => `${name}=${JSON.stringify(process.env[name])}`).join('|');
  return `${overrideStamp()}|${env}`;
}

function mergeObject(defaults: Record<string, unknown>, override: unknown): unknown {
  if (override === undefined) return defaults;
  return isRecord(override) ? { ...defaults, ...override } : override;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSpawnRunner(value: unknown): value is SpawnRunner {
  return typeof value === 'string' && SPAWN_RUNNERS.some((runner) => runner === value);
}

function assertManagerConfig(value: unknown): asserts value is ManagerConfig {
  if (!isRecord(value)) throw new Error('config must be an object');
  if (!hasOnlyKeys(value, Object.keys(DEFAULT_CONFIG))) throw new Error('config contains an unknown field');

  const numericKeys: Array<keyof ManagerConfig> = [
    'port',
    'bootstrapTaskCeilingUsd',
    'dayCeilingUsd',
    'p90MinSamples',
    'maxUnmeasuredRunsPerTask',
    'maxAttempts',
    'lockWaitTimeoutMs',
    'assertTimeoutMs',
    'cmuxLaneShellReadyMs',
    'cmuxStartupMs',
    'cmuxRunTimeoutMs',
    'cliRunTimeoutMs',
    'abandonedPaneAfterMs',
    'cmuxNeedsInputGraceMs',
    'cmuxSlotWaitMs',
  ];
  if (numericKeys.some((key) => !isFiniteNumber(value[key]))) throw new Error('config has a non-numeric number field');
  if (value.maxAgents !== null && !isFiniteNumber(value.maxAgents)) throw new Error('maxAgents must be null or numeric');
  if (!isRecord(value.projectConcurrency)) throw new Error('projectConcurrency must be an object');
  if (Object.values(value.projectConcurrency).some((limit) => !isFiniteNumber(limit) || limit < 1 || !Number.isInteger(limit))) {
    throw new Error('projectConcurrency values must be positive integers');
  }
  if (value.host !== '127.0.0.1') throw new Error('host must remain 127.0.0.1');

  const booleanKeys: Array<keyof ManagerConfig> = [
    'cmuxSkipPermissions',
    'cmuxCloseOnSuccess',
    'escalateSubagentOnLastAttempt',
  ];
  if (booleanKeys.some((key) => typeof value[key] !== 'boolean')) throw new Error('config has a non-boolean boolean field');

  if (
    typeof value.cmuxClaudeBin !== 'string' ||
    typeof value.cmuxCodexBin !== 'string' ||
    typeof value.cmuxLaneWorkspace !== 'string'
  ) {
    throw new Error('cmux binary and lane workspace must be strings');
  }
  if (!isSpawnRunner(value.spawnRunner)) throw new Error('spawnRunner is invalid');
  if (
    typeof value.executionProvider !== 'string' ||
    !Object.prototype.hasOwnProperty.call(EXECUTION_PROVIDER_FAMILY, value.executionProvider)
  ) {
    throw new Error('executionProvider is invalid');
  }
  if (
    typeof value.reviewProvider !== 'string' ||
    !Object.prototype.hasOwnProperty.call(REVIEW_PROVIDER_FAMILY, value.reviewProvider)
  ) {
    throw new Error('reviewProvider is invalid');
  }
  if (value.executionProvider === 'codex' && value.reviewProvider === 'codex') {
    throw new Error('executionProvider codex requires reviewProvider opus-fresh');
  }

  if (
    !isStringArray(value.browserTools) ||
    !isStringArray(value.cmuxClaudeArgs) ||
    !isStringArray(value.cmuxLaneTitles) ||
    !isStringArray(value.worktreeLinks)
  ) {
    throw new Error('config has an invalid string array');
  }
  const roles: AgentRole[] = ['main', 'subagent', 'review', 'judge'];
  if (!isStringArray(value.cmuxRoles) || value.cmuxRoles.some((role) => !roles.some((known) => known === role))) {
    throw new Error('cmuxRoles is invalid');
  }

  if (!isRecord(value.lockWaitTimeoutOverrideMs)) throw new Error('lockWaitTimeoutOverrideMs must be an object');
  if (Object.values(value.lockWaitTimeoutOverrideMs).some((timeout) => !isFiniteNumber(timeout))) {
    throw new Error('lockWaitTimeoutOverrideMs values must be numeric');
  }

  const modelRoles = ['manager', ...roles];
  if (!isRecord(value.models) || !hasOnlyKeys(value.models, modelRoles)) throw new Error('models is invalid');
  for (const role of modelRoles) {
    const route = value.models[role];
    if (!isRecord(route) || !hasOnlyKeys(route, ['model', 'fallback'])) throw new Error(`models.${role} is invalid`);
    if (typeof route.model !== 'string' || typeof route.fallback !== 'string') throw new Error(`models.${role} is invalid`);
  }

  const sources: TaskSource[] = ['cli', 'api', 'telegram'];
  if (!isRecord(value.spawn) || !hasOnlyKeys(value.spawn, sources)) throw new Error('spawn is invalid');
  for (const source of sources) {
    const policy = value.spawn[source];
    if (!isRecord(policy) || !hasOnlyKeys(policy, ['allowedTools', 'disallowedTools', 'alwaysRequireApproval'])) {
      throw new Error(`spawn.${source} is invalid`);
    }
    if (!isStringArray(policy.allowedTools) || !isStringArray(policy.disallowedTools)) {
      throw new Error(`spawn.${source} is invalid`);
    }
    if (typeof policy.alwaysRequireApproval !== 'boolean') throw new Error(`spawn.${source} is invalid`);
  }

  if (!isRecord(value.maxTurns) || !hasOnlyKeys(value.maxTurns, roles)) throw new Error('maxTurns is invalid');
  for (const role of roles) {
    if (!isFiniteNumber(value.maxTurns[role])) throw new Error('maxTurns values must be numeric');
  }
}

function buildConfig(): ManagerConfig {
  const overrides = readOverrides() ?? {};
  const merged: unknown = {
    ...DEFAULT_CONFIG,
    ...overrides,
    host: '127.0.0.1',
    models: mergeObject(DEFAULT_CONFIG.models, overrides.models),
    spawn: mergeObject(DEFAULT_CONFIG.spawn, overrides.spawn),
    maxTurns: mergeObject(DEFAULT_CONFIG.maxTurns, overrides.maxTurns),
    lockWaitTimeoutOverrideMs: mergeObject(
      DEFAULT_CONFIG.lockWaitTimeoutOverrideMs,
      overrides.lockWaitTimeoutOverrideMs,
    ),
    projectConcurrency: mergeObject(DEFAULT_CONFIG.projectConcurrency, overrides.projectConcurrency),
  };
  assertManagerConfig(merged);
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
  return merged;
}

let cached: ManagerConfig | null = null;
let cachedStamp = '';

/**
 * Cached, but only against the file it was built from.
 *
 * The daemon runs for days. Holding the first read forever meant an operator
 * who edited `~/.gstack/manager/config.json` to pull a provider out of the
 * loop kept the old one running until someone remembered to restart — the
 * safety decision was made, acknowledged, and silently not in effect. A config
 * that cannot be changed on a running daemon is not a control surface.
 */
export function loadConfig(): ManagerConfig {
  const stamp = configStamp();
  if (cached && stamp === cachedStamp) return cached;
  try {
    cached = buildConfig();
    cachedStamp = stamp;
    return cached;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (!cached) throw new Error(`cannot load manager config: ${reason}`);
    cachedStamp = stamp;
    console.error(`manager: cannot reload manager config: ${reason}; keeping last-known-good config`);
    return cached;
  }
}

export function resetConfigCache(): void {
  cached = null;
  cachedStamp = '';
}
