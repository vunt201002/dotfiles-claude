import { describe, test, expect } from 'bun:test';
import {
  applyTransition,
  canTransition,
  IllegalTransitionError,
  isNoRetryReason,
  nextAfterVerifyFailure,
  RETRY_REASON,
  RESUME_REASON,
} from '../lib/state-machine';
import type { TaskRecord, TaskState } from '../types';

function record(overrides: Partial<TaskRecord> = {}): TaskRecord {
  const now = new Date().toISOString();
  return {
    id: 'proj-t1-01',
    state: 'INTAKE',
    source: 'cli',
    project: 'proj',
    issue: 't1',
    scope: '/tmp/proj',
    envelope: null,
    attempt: 1,
    max_attempts: 3,
    review_depth: 'summary',
    blind_sample: false,
    agents: [],
    gates_run: [],
    findings: [],
    holds: [],
    cost_usd_actual: 0,
    cost_ceiling_usd: 5,
    human_touches: 0,
    assumption_count: 0,
    failure_reason: '',
    report_lines: [],
    pending_question: '',
    answers: [],
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('happy path edges', () => {
  const happy: Array<[TaskState, TaskState]> = [
    ['INTAKE', 'SIZED'],
    ['SIZED', 'APPROVAL'],
    ['SIZED', 'RUNNING'],
    ['APPROVAL', 'RUNNING'],
    ['RUNNING', 'VERIFYING'],
    ['VERIFYING', 'REVIEW'],
    ['REVIEW', 'REPORTED'],
  ];
  for (const [from, to] of happy) {
    test(`${from} -> ${to} is allowed`, () => {
      expect(canTransition(record({ state: from }), to).ok).toBe(true);
    });
  }
});

describe('illegal edges', () => {
  const illegal: Array<[TaskState, TaskState]> = [
    ['INTAKE', 'RUNNING'],
    ['INTAKE', 'REPORTED'],
    ['SIZED', 'VERIFYING'],
    ['RUNNING', 'REVIEW'],
    ['RUNNING', 'REPORTED'],
    ['REVIEW', 'RUNNING'],
    ['SIZED', 'REVIEW'],
  ];
  for (const [from, to] of illegal) {
    test(`${from} -> ${to} is rejected`, () => {
      const check = canTransition(record({ state: from }), to);
      expect(check.ok).toBe(false);
      expect(check.error).toContain('illegal transition');
    });
  }

  test('terminal states never move', () => {
    for (const state of ['REPORTED', 'BLOCKED', 'REJECTED', 'FAILED'] as TaskState[]) {
      const check = canTransition(record({ state }), 'RUNNING');
      expect(check.ok).toBe(false);
      expect(check.error).toContain('terminal');
    }
  });

  test('applyTransition throws on a forbidden edge', () => {
    expect(() => applyTransition(record({ state: 'INTAKE' }), 'REPORTED')).toThrow(IllegalTransitionError);
  });
});

describe('retry is B8-only and capped at 3', () => {
  test('VERIFYING -> RUNNING needs the B8 reason', () => {
    const task = record({ state: 'VERIFYING' });
    expect(canTransition(task, 'RUNNING', 'b2-root-cause-unproven').ok).toBe(false);
    expect(canTransition(task, 'RUNNING', '').ok).toBe(false);
    expect(canTransition(task, 'RUNNING', RETRY_REASON).ok).toBe(true);
  });

  test('a retry consumes an attempt', () => {
    const task = record({ state: 'VERIFYING', attempt: 1 });
    const next = applyTransition(task, 'RUNNING', { reason: RETRY_REASON });
    expect(next.attempt).toBe(2);
    expect(next.state).toBe('RUNNING');
  });

  test('no other edge consumes an attempt', () => {
    const task = record({ state: 'VERIFYING', attempt: 2 });
    expect(applyTransition(task, 'REVIEW').attempt).toBe(2);
  });

  test('the third failure blocks instead of retrying a fourth time', () => {
    expect(nextAfterVerifyFailure(record({ state: 'VERIFYING', attempt: 1 }))).toEqual({
      to: 'RUNNING',
      reason: RETRY_REASON,
    });
    expect(nextAfterVerifyFailure(record({ state: 'VERIFYING', attempt: 2 })).to).toBe('RUNNING');
    const capped = nextAfterVerifyFailure(record({ state: 'VERIFYING', attempt: 3 }));
    expect(capped.to).toBe('BLOCKED');
    expect(capped.reason).toContain('retry cap');
  });

  test('the cap is enforced at the edge, not only by the helper', () => {
    const task = record({ state: 'VERIFYING', attempt: 3, max_attempts: 3 });
    const check = canTransition(task, 'RUNNING', RETRY_REASON);
    expect(check.ok).toBe(false);
    expect(check.error).toContain('retry cap reached');
  });

  test('B2 and B4 blocks are terminal reasons, not retry reasons', () => {
    expect(isNoRetryReason('b2-root-cause-unproven')).toBe(true);
    expect(isNoRetryReason('b4-red-team-hole')).toBe(true);
    expect(isNoRetryReason(RETRY_REASON)).toBe(false);
  });
});

describe('mid-run approval and resume', () => {
  test('a running task can park to ask a human', () => {
    for (const from of ['RUNNING', 'VERIFYING', 'REVIEW'] as TaskState[]) {
      expect(canTransition(record({ state: from }), 'APPROVAL').ok).toBe(true);
    }
  });

  test('resuming into a later phase needs the resume reason', () => {
    const parked = record({ state: 'APPROVAL' });
    expect(canTransition(parked, 'VERIFYING').ok).toBe(false);
    expect(canTransition(parked, 'REVIEW', 'anything else').ok).toBe(false);
    expect(canTransition(parked, 'VERIFYING', RESUME_REASON).ok).toBe(true);
    expect(canTransition(parked, 'REVIEW', RESUME_REASON).ok).toBe(true);
  });

  test('resuming into RUNNING is the plain first-approval path', () => {
    expect(canTransition(record({ state: 'APPROVAL' }), 'RUNNING').ok).toBe(true);
  });

  test('a resume never consumes a retry attempt', () => {
    const parked = record({ state: 'APPROVAL', attempt: 2 });
    expect(applyTransition(parked, 'VERIFYING', { reason: RESUME_REASON }).attempt).toBe(2);
  });
});

describe('record bookkeeping', () => {
  test('failure reason is carried and cleared on REPORTED', () => {
    const failed = applyTransition(record({ state: 'RUNNING' }), 'BLOCKED', {
      reason: 'x',
      failureReason: 'root cause not proven',
    });
    expect(failed.failure_reason).toBe('root cause not proven');
    const reported = applyTransition(record({ state: 'REVIEW', failure_reason: 'stale' }), 'REPORTED');
    expect(reported.failure_reason).toBe('');
  });

  test('transitions do not mutate the input record', () => {
    const before = record({ state: 'INTAKE' });
    applyTransition(before, 'SIZED');
    expect(before.state).toBe('INTAKE');
  });
});
