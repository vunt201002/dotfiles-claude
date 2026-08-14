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
 * Never throws. A missing or half-written store means "no sessions", because a
 * reader that dies takes the manager's whole view of the fleet with it, and
 * this file is watched in a loop.
 */
export function readCmuxSessions(agent = 'claude', home = os.homedir()): CmuxSession[] {
  let raw: string;
  try {
    raw = fs.readFileSync(cmuxStorePath(agent, home), 'utf8');
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const sessions = (parsed as { sessions?: Record<string, unknown> })?.sessions;
  if (!sessions || typeof sessions !== 'object') return [];

  const out: CmuxSession[] = [];
  for (const value of Object.values(sessions)) {
    if (!value || typeof value !== 'object') continue;
    const s = value as Record<string, unknown>;
    const sessionId = asString(s.sessionId);
    if (!sessionId) continue;
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
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
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

export function fleet(agent = 'claude', home = os.homedir()): FleetEntry[] {
  return readCmuxSessions(agent, home).map((session) => ({ ...session, health: healthOf(session) }));
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
 * The concurrency number §6.3 wanted. Counts agents that are actually holding a
 * seat — including ones the operator started by hand, which the manager's own
 * semaphore could never see.
 */
export function busyCount(entries: FleetEntry[]): number {
  return entries.filter((e) => isLive(e.health)).length;
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

/**
 * Sums usage across a transcript, which is what makes a pane accountable.
 *
 * Cache reads are kept apart from fresh input rather than summed: they are
 * priced differently, and collapsing them would quietly overstate the bill of
 * every long session — exactly the kind of number that looks measured and is
 * not.
 */
export function usageFromTranscript(transcriptPath: string): TranscriptUsage {
  let raw: string;
  try {
    raw = fs.readFileSync(transcriptPath, 'utf8');
  } catch {
    return { ...EMPTY_USAGE };
  }
  const total = { ...EMPTY_USAGE };
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
    if (!usage || typeof usage !== 'object') continue;
    total.inputTokens += asNumber(usage.input_tokens);
    total.outputTokens += asNumber(usage.output_tokens);
    total.cacheReadTokens += asNumber(usage.cache_read_input_tokens);
    total.cacheCreationTokens += asNumber(usage.cache_creation_input_tokens);
    total.turns += 1;
  }
  return total;
}
