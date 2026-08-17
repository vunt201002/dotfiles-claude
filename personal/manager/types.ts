/**
 * Data model for the manager layer.
 *
 * Shapes follow personal/docs/manager-layer-plan-2026-08-12.md §3.1 (task
 * envelope) and §3.2 (task record). Field names are copied verbatim from the
 * spec so a task file on disk can be read against the doc without a mapping.
 */

export type TaskSize = 'S' | 'M' | 'L' | 'XL';
export type Uncertainty = 'low' | 'med' | 'high';
export type Lane = 'trivial' | 'bug-nho' | 'bug-lon' | 'feature';
export type OracleKind = 'playwright' | 'tsc' | 'jest' | 'lint' | 'emulator' | 'my-chrome';
export type TaskSource = 'cli' | 'api' | 'telegram';

export const LANES: readonly Lane[] = ['trivial', 'bug-nho', 'bug-lon', 'feature'];

/** §3.1 — what a main agent hands back after sizing an issue. */
export interface TaskEnvelope {
  project: string;
  issue: string;
  title: string;
  size: TaskSize;
  uncertainty: Uncertainty;
  lane: Lane;
  why: string;
  oracle_available: boolean;
  oracle_kind: OracleKind[];
  needs_human: boolean;
  blocking_questions: string[];
  assumptions: string[];
  assumption_count: number;
  est_cost_usd: number;
  est_turns: number;
}

export type TaskState =
  | 'INTAKE'
  | 'SIZED'
  | 'APPROVAL'
  | 'RUNNING'
  | 'VERIFYING'
  | 'REVIEW'
  | 'REPORTED'
  | 'BLOCKED'
  | 'REJECTED'
  | 'FAILED';

export type ReviewDepth = 'summary' | 'full-diff';

export type AgentRole = 'main' | 'subagent' | 'review' | 'judge';

export interface AgentHandle {
  role: AgentRole;
  model: string;
  session: string;
  status: 'alive' | 'done' | 'dead';
  started_at: string;
  ended_at?: string;
}

export type HoldName = 'browser-token' | string;

/**
 * A finding surfaced by one gate, carried into the report.
 *
 * `attempt` is what keeps a fixed problem from blocking the fix. Attempt 1's
 * failing assert is real history and stays on the record and in the gate log,
 * but the ensemble judges the attempt that is actually being shipped —
 * otherwise a task could never pass a retry, because the failure that caused
 * the retry would still be sitting in the evidence pile.
 */
export interface Finding {
  gate: string;
  gate_family: 'deterministic' | 'llm';
  text: string;
  attempt?: number;
}

/**
 * One gate row this task produced, pass or fail, kept per attempt.
 *
 * Findings alone cannot answer the ensemble's second question. "Nothing was
 * caught" and "nothing was checked" both produce an empty finding list, and
 * reading the second as the first is how an unmeasured task gets reported as a
 * clean one — so the passes are kept too.
 *
 * Re-running a gate REPLACES its row for the current attempt. A human who
 * registers the missing test command and approves is not still failing the
 * gate that was missing it, and reading the raw log would say otherwise
 * forever.
 */
export interface GateOutcome {
  gate: string;
  gate_family: 'deterministic' | 'llm';
  verdict: 'pass' | 'caught' | 'false-positive' | 'skipped' | 'error';
  caught: string;
  attempt: number;
  /**
   * Model family that produced an llm row. Absent on rows written before this
   * was recorded, and the ensemble has to treat absent as unknown rather than
   * as "the same as the other one".
   */
  family?: string;
}

/**
 * One `B8-assert` command run, kept per attempt.
 *
 * §7.4 asks the manager to record how many tests actually RAN, not just
 * whether the command was green, because a suite that skips silently on a
 * missing env var exits 0 having proven nothing. The gate log's §3.3 schema
 * has no field for a count, so the number lives here — durable on disk, one
 * row per command, next to the exit code it has to be read against.
 */
export interface AssertRunRecord {
  attempt: number;
  cmd: string;
  kind: 'suite' | 'check';
  exit_code: number;
  timed_out: boolean;
  /** Tests that actually executed. Null when the runner printed no count. */
  ran: number | null;
  skipped: number | null;
  total: number | null;
  state: 'green' | 'red' | 'not-run';
}

/** §3.2 — the manager's own state for one task. */
export interface TaskRecord {
  id: string;
  state: TaskState;
  source: TaskSource;
  project: string;
  issue: string;
  /** Absolute path the task is allowed to write inside (§6.8 blast radius). */
  scope: string;
  /** Present only after a spawn result observed that this task created a worktree. */
  worktree_created?: true;
  envelope: TaskEnvelope | null;
  attempt: number;
  max_attempts: number;
  review_depth: ReviewDepth;
  blind_sample: boolean;
  agents: AgentHandle[];
  gates_run: string[];
  findings: Finding[];
  /** Every gate row this task produced. Derives findings; feeds the ensemble. */
  gate_reports: GateOutcome[];
  holds: HoldName[];
  cost_usd_actual: number;
  /**
   * Runs folded into this task whose cost nobody could price — a codex review
   * on CLI quota, a model with no pricing row. `cost_usd_actual` is a floor
   * while this is above zero, so no ceiling may read it as a total (§6.5).
   */
  cost_unmeasured_runs: number;
  /**
   * Unpriced runs a human has already been shown and waved through. Subtracted
   * from the cap so approving actually grants headroom; never subtracted from
   * `cost_unmeasured_runs`, which stays the true count everything else reads.
   */
  cost_unmeasured_ack: number;
  cost_ceiling_usd: number;
  human_touches: number;
  assumption_count: number;
  /** Set when the task leaves the happy path. Empty on REPORTED. */
  failure_reason: string;
  /** Free-text lines the manager shows in the report / Telegram card. */
  report_lines: string[];
  /** What the verify phase reported, newest last. Shown on the report card. */
  verify_lines: string[];
  /** Every B8-assert command the manager ran, with its executed-test count. */
  assert_runs: AssertRunRecord[];
  /** Assumptions the agents proceeded on. assumption_count is their count. */
  assumptions: string[];
  /**
   * Findings the gates themselves triaged as not touching correctness (B4).
   * They reach the report and never block, so a reviewer that finds gaps
   * because it was asked to find gaps does not cost a round trip.
   */
  advisories: string[];
  /**
   * One sentence naming the proven source of the bug, as the builder stated
   * it. The only thing about the build that spec-check is given — see
   * SpecCheckInput in lib/prompts.ts for why that list is so short.
   */
  root_cause: string;
  /**
   * Where to resume after a mid-run approval. Empty unless the task is parked
   * at APPROVAL from a state later than SIZED.
   */
  resume_state: TaskState | '';
  /** What the human is being asked to allow, when parked at APPROVAL. */
  pending_action: string;
  /**
   * Assert commands this task is parked on, waiting to be allowed to run.
   * Recorded so approving records exactly the commands the human was shown,
   * not whatever the registry file happens to say by the time he answers.
   */
  pending_assert_cmds: string[];
  /** Pending question text when the task is parked waiting on a human. */
  pending_question: string;
  /** Answers a human fed back in, newest last. */
  answers: string[];
  /**
   * When the most recent agent run started. Bounds the window used to look for
   * independent evidence of a self-reported deterministic gate (§3.3, §7.3):
   * only hook-written rows from inside this run corroborate the claim.
   */
  run_started_at: string;
  /**
   * When the current attempt's real work began. Bounds which logged gate rows
   * count as evidence about THIS attempt: a lint failure from attempt 1 that
   * attempt 2 fixed must not still be blocking at review, and a green assert
   * from attempt 1 must not vouch for attempt 2 either.
   */
  attempt_started_at: string;
  created_at: string;
  updated_at: string;
}

export interface LockRecord {
  /** Task that currently owns the lock. */
  task_id: string;
  /** Daemon pid that acquired it — reconcile revokes when the pid is dead. */
  pid: number;
  /**
   * Daemon boot that acquired it. Absent on locks written before this field
   * existed, which fall back to the pid check. The OS reuses pids, so pid
   * alone cannot distinguish "still ours" from "a dead daemon's number".
   */
  boot?: string;
  acquired_at: string;
}

export interface QueueEntry {
  task_id: string;
  pid: number;
  requested_at: string;
}

/** In-flight index. The per-task detail lives in tasks/<id>.json. */
export interface ManagerState {
  version: number;
  updated_at: string;
  /** Task id -> coarse state, so reconcile does not have to read every file. */
  tasks: Record<string, { state: TaskState; project: string; issue: string; pid: number }>;
  /** Exclusive locks: 'project:<name>' and 'browser-token'. */
  locks: Record<string, LockRecord>;
  /** FIFO waiters per lock name. */
  queues: Record<string, QueueEntry[]>;
}

export function emptyState(): ManagerState {
  return { version: 1, updated_at: new Date().toISOString(), tasks: {}, locks: {}, queues: {} };
}

export const TERMINAL_STATES: readonly TaskState[] = ['REPORTED', 'BLOCKED', 'REJECTED', 'FAILED'];

export function isTerminal(state: TaskState): boolean {
  return TERMINAL_STATES.includes(state);
}

/** States where an agent session is expected to be alive. */
export const ACTIVE_STATES: readonly TaskState[] = ['RUNNING', 'VERIFYING', 'REVIEW'];
