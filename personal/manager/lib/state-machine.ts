/**
 * Task lifecycle (§5).
 *
 *   INTAKE -> SIZED -> [APPROVAL] -> RUNNING -> VERIFYING -> REVIEW -> REPORTED
 *                 |        |            |          |           |
 *              BLOCKED  REJECTED     BLOCKED   RETRY(<=3)   BLOCKED
 *
 * The retry edges are the load-bearing rule. VERIFYING -> RUNNING exists only
 * for a B8 verify failure. A same-state retry in INTAKE or RUNNING exists only
 * when infrastructure kept the agent from answering. Both consume the shared
 * attempt budget. A block at B2 (root cause not proven) or B4 (red-team hole)
 * is terminal because a second attempt starts from the same empty evidence.
 */

import type { TaskRecord, TaskState } from '../types';
import { isTerminal } from '../types';

/** Only this reason may retry a failed verification. */
export const RETRY_REASON = 'b8-verify-failed';

/** Only this reason may retry an agent run without advancing its phase. */
export const INFRA_RETRY_REASON = 'infra-run-failed';

/** Only this reason may move a task back out of a mid-run APPROVAL park. */
export const RESUME_REASON = 'resume-after-approval';

/** Reasons that terminate a task immediately, no retry. */
export const NO_RETRY_REASONS = ['b2-root-cause-unproven', 'b4-red-team-hole'] as const;

/**
 * Two edges here are NOT in the §5 diagram and are deliberate additions:
 *
 *   RUNNING/VERIFYING/REVIEW -> APPROVAL, and APPROVAL -> VERIFYING/REVIEW.
 *
 * §5 only parks for approval after SIZED, but two later rules need to ask
 * mid-run and then carry on. §9 says a task that breaks its cost ceiling
 * should "stop and ask again", and §10.1 says nothing irreversible ever
 * happens without a human saying yes — and an agent only discovers it needs
 * to push once it is already RUNNING. Without these edges the only honest
 * options are to terminate a task that just needs a yes, or to let the
 * irreversible step through unasked. Both are worse.
 *
 * The return edges are gated on RESUME_REASON so a task resumes exactly where
 * it parked instead of silently restarting a phase.
 */
const ALLOWED: Record<TaskState, readonly TaskState[]> = {
  INTAKE: ['INTAKE', 'SIZED', 'APPROVAL', 'BLOCKED', 'REJECTED', 'FAILED'],
  SIZED: ['APPROVAL', 'RUNNING', 'BLOCKED', 'REJECTED', 'FAILED'],
  APPROVAL: ['RUNNING', 'VERIFYING', 'REVIEW', 'REJECTED', 'BLOCKED', 'FAILED'],
  RUNNING: ['RUNNING', 'VERIFYING', 'APPROVAL', 'BLOCKED', 'FAILED'],
  VERIFYING: ['REVIEW', 'RUNNING', 'APPROVAL', 'BLOCKED', 'FAILED'],
  REVIEW: ['REPORTED', 'APPROVAL', 'BLOCKED', 'FAILED'],
  REPORTED: [],
  BLOCKED: [],
  REJECTED: [],
  FAILED: [],
};

export interface TransitionCheck {
  ok: boolean;
  error: string;
  /** True when this edge consumes a retry attempt. */
  consumesAttempt: boolean;
}

export function canTransition(record: TaskRecord, to: TaskState, reason = ''): TransitionCheck {
  const from = record.state;
  if (isTerminal(from)) {
    return { ok: false, error: `${from} is terminal; cannot move to ${to}`, consumesAttempt: false };
  }
  if (!ALLOWED[from].includes(to)) {
    return { ok: false, error: `illegal transition ${from} -> ${to}`, consumesAttempt: false };
  }
  if ((from === 'INTAKE' || from === 'RUNNING') && to === from) {
    if (reason !== INFRA_RETRY_REASON) {
      return {
        ok: false,
        error: `same-state retry from ${from} requires reason "${INFRA_RETRY_REASON}", got "${reason || '(none)'}"`,
        consumesAttempt: false,
      };
    }
    if (record.attempt >= record.max_attempts) {
      return {
        ok: false,
        error: `retry cap reached (${record.attempt}/${record.max_attempts})`,
        consumesAttempt: false,
      };
    }
    return { ok: true, error: '', consumesAttempt: true };
  }
  if (from === 'VERIFYING' && to === 'RUNNING') {
    if (reason !== RETRY_REASON) {
      return {
        ok: false,
        error: `retry from VERIFYING requires reason "${RETRY_REASON}", got "${reason || '(none)'}"`,
        consumesAttempt: false,
      };
    }
    if (record.attempt >= record.max_attempts) {
      return {
        ok: false,
        error: `retry cap reached (${record.attempt}/${record.max_attempts})`,
        consumesAttempt: false,
      };
    }
    return { ok: true, error: '', consumesAttempt: true };
  }
  if (from === 'APPROVAL' && (to === 'VERIFYING' || to === 'REVIEW') && reason !== RESUME_REASON) {
    return {
      ok: false,
      error: `resuming into ${to} requires reason "${RESUME_REASON}", got "${reason || '(none)'}"`,
      consumesAttempt: false,
    };
  }
  return { ok: true, error: '', consumesAttempt: false };
}

export class IllegalTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IllegalTransitionError';
  }
}

export interface TransitionOptions {
  reason?: string;
  failureReason?: string;
  reportLine?: string;
}

/** Returns a NEW record. Throws IllegalTransitionError on a forbidden edge. */
export function applyTransition(record: TaskRecord, to: TaskState, opts: TransitionOptions = {}): TaskRecord {
  const reason = opts.reason ?? '';
  const check = canTransition(record, to, reason);
  if (!check.ok) throw new IllegalTransitionError(check.error);

  const next: TaskRecord = {
    ...record,
    state: to,
    attempt: check.consumesAttempt ? record.attempt + 1 : record.attempt,
    updated_at: new Date().toISOString(),
  };
  if (opts.failureReason !== undefined) next.failure_reason = opts.failureReason;
  if (to === 'REPORTED') next.failure_reason = '';
  if (opts.reportLine) next.report_lines = [...record.report_lines, opts.reportLine];
  return next;
}

/**
 * Where a failed verify goes: back to RUNNING while attempts remain, otherwise
 * BLOCKED. Hitting the cap is the tripwire — it stops and reports what is
 * still missing rather than trying a fourth time.
 */
export function nextAfterVerifyFailure(record: TaskRecord): { to: TaskState; reason: string } {
  if (record.attempt < record.max_attempts) return { to: 'RUNNING', reason: RETRY_REASON };
  return { to: 'BLOCKED', reason: `retry cap ${record.max_attempts} reached` };
}

export function isNoRetryReason(reason: string): boolean {
  return (NO_RETRY_REASONS as readonly string[]).includes(reason);
}
