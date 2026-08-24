/**
 * Reading cmux's own session bookkeeping.
 *
 * §6.2 refused to drive a GUI terminal for four reasons: no structured result,
 * no concurrency cap, no cost, and dying mute when a window changes. Three of
 * those turn out not to apply to cmux, and this file is why.
 *
 * cmux writes `~/.cmuxterm/<agent>-hook-sessions.json` from its own turn hooks.
 * Every session carries `agentLifecycle` (running · idle · needsInput), the
 * cwd, the pid, and `transcriptPath`. So "is it done" is a recorded fact rather
 * than a guess from `pgrep`; "how many are running where" is a count over the
 * same file; and cost is recoverable from the transcript the agent was writing
 * anyway. That last property is the valuable one — it is a channel the thing
 * being measured does not write FOR the manager, which is the §7.3b lesson-2
 * requirement for any number allowed to open autonomy.
 *
 * Read-only. Nothing here starts, stops, or talks to cmux.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export type AgentLifecycle = 'running' | 'idle' | 'needsInput' | 'unknown';

const LIFECYCLES: readonly AgentLifecycle[] = ['running', 'idle', 'needsInput', 'unknown'];

export interface CmuxSession {
  sessionId: string;
  surfaceId: string;
  workspaceId: string;
  /** Where the agent is working — the repo or worktree root, usually. */
  cwd: string;
  pid: number;
  /**
   * Start time of that pid. Carried because a pid alone is not an identity:
   * the OS reuses numbers, and a recycled pid would report a finished agent as
   * still alive. Same failure class the terminal-agent kill path hit.
   */
  pidStartSeconds: number;
  lifecycle: AgentLifecycle;
  transcriptPath: string;
  /** Epoch seconds, fractional. The baseline for "did this just change". */
  updatedAt: number;
  startedAt: number;
  subtitle: string;
}

export type CmuxSessionsRead = { ok: true; entries: CmuxSession[] } | { ok: false; reason: string };

export function cmuxStorePath(agent = 'claude', home = os.homedir()): string {
  return path.join(home, '.cmuxterm', `${agent}-hook-sessions.json`);
}

function asNumber(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asLifecycle(value: unknown): AgentLifecycle {
  return LIFECYCLES.includes(value as AgentLifecycle) ? (value as AgentLifecycle) : 'unknown';
}

/**
 * Never throws. ENOENT is an observed empty fleet; every other read or parse
 * failure stays explicit so a caller can keep running without mistaking lost
 * visibility for spare capacity.
 */
export function readCmuxSessions(agent = 'claude', home = os.homedir()): CmuxSessionsRead {
  let raw: string;
  try {
    raw = fs.readFileSync(cmuxStorePath(agent, home), 'utf8');
  } catch (error) {
    const isEnoent = (error as NodeJS.ErrnoException).code === 'ENOENT';
    return isEnoent ? { ok: true, entries: [] } : { ok: false, reason: errorReason(error) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { ok: false, reason: errorReason(error) };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'cmux store root is not an object' };
  }
  const sessions = (parsed as { sessions?: unknown }).sessions;
  if (!sessions || typeof sessions !== 'object' || Array.isArray(sessions)) {
    return { ok: false, reason: 'cmux store has no valid sessions object' };
  }

  const out: CmuxSession[] = [];
  let invalidRows = 0;
  for (const value of Object.values(sessions)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      invalidRows += 1;
      continue;
    }
    const s = value as Record<string, unknown>;
    const sessionId = asString(s.sessionId);
    if (!sessionId) {
      invalidRows += 1;
      continue;
    }
    out.push({
      sessionId,
      surfaceId: asString(s.surfaceId),
      workspaceId: asString(s.workspaceId),
      cwd: asString(s.cwd),
      pid: asNumber(s.pid),
      pidStartSeconds: asNumber(s.pidStartSeconds),
      lifecycle: asLifecycle(s.agentLifecycle),
      transcriptPath: asString(s.transcriptPath),
      updatedAt: asNumber(s.updatedAt),
      startedAt: asNumber(s.startedAt),
      subtitle: asString(s.lastSubtitle),
    });
  }
  const sorted = out.sort((a, b) => b.updatedAt - a.updatedAt);
  return invalidRows === 0
    ? { ok: true, entries: sorted }
    : { ok: false, reason: `cmux store contains ${invalidRows} invalid session row${invalidRows === 1 ? '' : 's'}` };
}

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Signal 0: asks the kernel whether the pid exists, without touching it. */
export function pidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * `running` on a dead pid is a crash, not work in progress.
 *
 * Reported as its own state rather than folded into either side: treating it
 * as running hangs a watcher forever, and treating it as done hands back a
 * task nobody finished.
 */
export type SessionHealth = 'working' | 'waiting' | 'blocked' | 'finished' | 'crashed' | 'gone';

/**
 * cmux's subtitle for a pane sitting on a permission prompt.
 *
 * Found by reading the live store, not by reading cmux's source: a pane in
 * `wishlist-2` had been showing `lastSubtitle: "Permission"` for five hours
 * with `agentLifecycle: "running"` the whole time. Nothing keyed on lifecycle
 * alone would ever have said a human was blocking it.
 */
const PERMISSION_SUBTITLE = /permission/i;

/**
 * `running` on a dead pid is a crash. `running` with a permission prompt on
 * screen is a human being waited on. Neither is what the lifecycle field says
 * on its own, so both are cross-checked against a second channel.
 *
 * When the two disagree in the direction of "a human is needed", the one that
 * needs a human wins. The subtitle is softer evidence than the lifecycle — it
 * is display text and its wording can change — but the costs are not
 * symmetric: a false alarm is one extra line in a report, and a miss is a pane
 * sitting untouched for five hours, which is the case that produced this rule.
 */
export function healthOf(session: CmuxSession): SessionHealth {
  const alive = pidAlive(session.pid);
  if (!alive) return session.lifecycle === 'running' ? 'crashed' : 'gone';
  if (session.lifecycle === 'needsInput') return 'waiting';
  if (PERMISSION_SUBTITLE.test(session.subtitle)) return 'blocked';
  if (session.lifecycle === 'running') return 'working';
  if (session.lifecycle === 'idle') return 'finished';
  return 'working';
}

/** Holding a seat: still costing a core and a rate limit, whatever it is doing. */
export function isLive(health: SessionHealth): boolean {
  return health === 'working' || health === 'waiting' || health === 'blocked';
}

/** Nobody but a human can move these along. */
export function needsHuman(health: SessionHealth): boolean {
  return health === 'waiting' || health === 'blocked';
}

export interface FleetEntry extends CmuxSession {
  health: SessionHealth;
}

export type FleetRead = { ok: true; entries: FleetEntry[] } | { ok: false; reason: string };

export function fleet(agent = 'claude', home = os.homedir()): FleetRead {
  const sessions = readCmuxSessions(agent, home);
  if (!sessions.ok) return { ok: false, reason: sessions.reason };
  return { ok: true, entries: sessions.entries.map((session) => ({ ...session, health: healthOf(session) })) };
}

/** Sessions whose cwd is inside `root` — one repo's share of the fleet. */
export function sessionsUnder(root: string, entries: FleetEntry[]): FleetEntry[] {
  const abs = path.resolve(root);
  return entries.filter((e) => {
    if (!e.cwd) return false;
    const rel = path.relative(abs, path.resolve(e.cwd));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });
}

/**
 * A pane waiting on a human, or one whose lifecycle is unknown, for long
 * enough that its conservative claim on a seat has expired. Measured from
 * `updatedAt`, which is the last time anything about the pane changed at all.
 *
 * It stays in the fleet report, because the operator needs to see it. It stops
 * reserving a seat, because a cap that a forgotten pane holds forever is not a
 * cap, it is a deadlock: three panes left open on a Friday silently halve the
 * machine's capacity every week after.
 */
export function isAbandoned(entry: FleetEntry, nowMs: number, afterMs: number): boolean {
  return (needsHuman(entry.health) || entry.lifecycle === 'unknown') && nowMs - entry.updatedAt * 1000 > afterMs;
}

/**
 * The concurrency number §6.3 wanted. Counts agents that are actually holding a
 * seat — including ones the operator started by hand, which the manager's own
 * semaphore could never see.
 *
 * `nowMs` and `abandonedAfterMs` are required rather than defaulted: a caller
 * that forgets them would silently get the old count-everything behaviour, and
 * that is the failure this argument exists to prevent.
 */
export function busyCount(entries: FleetEntry[], nowMs: number, abandonedAfterMs: number): number {
  return entries.filter((e) => isLive(e.health) && !isAbandoned(e, nowMs, abandonedAfterMs)).length;
}

export interface TranscriptUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  turns: number;
  /**
   * The model that actually answered, taken from the transcript rather than
   * from what the manager asked for. A pane the operator started, or one whose
   * model was switched mid-session, would otherwise be priced as whatever the
   * manager last requested.
   */
  model: string;
}

const EMPTY_USAGE: TranscriptUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  turns: 0,
  model: '',
};

export type TranscriptUsageRead = TranscriptUsage & ({ ok: true } | { ok: false; reason: string });

/**
 * Sums usage across a transcript, which is what makes a pane accountable.
 *
 * Cache reads are kept apart from fresh input rather than summed: they are
 * priced differently, and collapsing them would quietly overstate the bill of
 * every long session — exactly the kind of number that looks measured and is
 * not.
 */
export function usageFromTranscript(transcriptPath: string): TranscriptUsageRead {
  let raw: string;
  try {
    raw = fs.readFileSync(transcriptPath, 'utf8');
  } catch (error) {
    return { ...EMPTY_USAGE, ok: false, reason: errorReason(error) };
  }
  const total = { ...EMPTY_USAGE };
  let observedUsage = false;
  let invalidUsage = false;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const message = (entry as { message?: { usage?: Record<string, unknown>; model?: unknown } })?.message;
    const model = asString(message?.model);
    if (model) total.model = model;
    const usage = message?.usage;
    if (!usage || typeof usage !== 'object') {
      if (model) invalidUsage = true;
      continue;
    }
    const inputTokens = tokenCount(usage.input_tokens);
    const outputTokens = tokenCount(usage.output_tokens);
    const cacheReadTokens = optionalTokenCount(usage, 'cache_read_input_tokens');
    const cacheCreationTokens = optionalTokenCount(usage, 'cache_creation_input_tokens');
    if (inputTokens === null || outputTokens === null || cacheReadTokens === null || cacheCreationTokens === null) {
      invalidUsage = true;
      continue;
    }
    observedUsage = true;
    total.inputTokens += inputTokens;
    total.outputTokens += outputTokens;
    total.cacheReadTokens += cacheReadTokens;
    total.cacheCreationTokens += cacheCreationTokens;
    total.turns += 1;
  }
  if (!observedUsage || invalidUsage) {
    return { ...total, ok: false, reason: invalidUsage ? 'transcript contains invalid usage' : 'transcript contains no usage' };
  }
  return { ...total, ok: true };
}

function tokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function optionalTokenCount(usage: Record<string, unknown>, key: string): number | null {
  if (!Object.prototype.hasOwnProperty.call(usage, key)) return 0;
  return tokenCount(usage[key]);
}
