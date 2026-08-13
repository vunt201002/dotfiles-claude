import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-cost-'));
process.env.MANAGER_HOME = HOME;
process.env.GSTACK_GATE_LOG_DIR = path.join(HOME, 'gate-log');

import { describe, test, expect, afterAll } from 'bun:test';
import { DEFAULT_CONFIG, type ManagerConfig } from '../config';
import {
  checkDayCeiling,
  checkTaskCeiling,
  costBreakdown,
  laneCeiling,
  percentile,
  resolveRunCostUsd,
  spentToday,
  type CostSample,
} from '../lib/cost';
import type { Lane, TaskEnvelope, TaskRecord } from '../types';

afterAll(() => {
  try {
    fs.rmSync(HOME, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

const cfg: ManagerConfig = { ...DEFAULT_CONFIG, bootstrapTaskCeilingUsd: 5, dayCeilingUsd: 40, p90MinSamples: 20 };

function samples(lane: Lane, costs: number[]): CostSample[] {
  return costs.map((cost_usd) => ({ lane, cost_usd }));
}

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  const now = new Date().toISOString();
  return {
    id: 'p-t-01',
    state: 'REPORTED',
    source: 'cli',
    project: 'kivora',
    issue: 't1',
    scope: '/tmp/p',
    envelope: { lane: 'bug-lon' } as TaskEnvelope,
    attempt: 1,
    max_attempts: 3,
    review_depth: 'summary',
    blind_sample: false,
    agents: [],
    gates_run: [],
    findings: [],
    holds: [],
    cost_usd_actual: 1,
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

describe('percentile', () => {
  test('nearest rank on a known set', () => {
    const values = Array.from({ length: 10 }, (_, i) => i + 1);
    expect(percentile(values, 90)).toBe(9);
    expect(percentile(values, 100)).toBe(10);
    expect(percentile(values, 50)).toBe(5);
  });

  test('empty input is 0, single value is itself', () => {
    expect(percentile([], 90)).toBe(0);
    expect(percentile([3.5], 90)).toBe(3.5);
  });

  test('unsorted input is handled', () => {
    expect(percentile([9, 1, 5, 3, 7], 90)).toBe(9);
  });
});

describe('laneCeiling', () => {
  test('bootstrap flat ceiling until there is enough history', () => {
    const decision = laneCeiling(samples('bug-lon', [1, 2, 3]), 'bug-lon', cfg);
    expect(decision.source).toBe('bootstrap');
    expect(decision.ceiling_usd).toBe(5);
    expect(decision.sample_count).toBe(3);
  });

  test('19 samples is still bootstrap, 20 flips to p90', () => {
    const nineteen = samples('bug-lon', Array.from({ length: 19 }, (_, i) => i + 1));
    expect(laneCeiling(nineteen, 'bug-lon', cfg).source).toBe('bootstrap');
    const twenty = samples('bug-lon', Array.from({ length: 20 }, (_, i) => i + 1));
    const decision = laneCeiling(twenty, 'bug-lon', cfg);
    expect(decision.source).toBe('p90');
    expect(decision.ceiling_usd).toBe(18);
  });

  test('lanes are counted separately', () => {
    const mixed = [...samples('bug-lon', Array.from({ length: 20 }, () => 2)), ...samples('trivial', [0.1])];
    expect(laneCeiling(mixed, 'bug-lon', cfg).source).toBe('p90');
    expect(laneCeiling(mixed, 'trivial', cfg).source).toBe('bootstrap');
  });

  test('zero-cost rows do not count as history', () => {
    const zeros = samples('bug-lon', Array.from({ length: 25 }, () => 0));
    expect(laneCeiling(zeros, 'bug-lon', cfg).sample_count).toBe(0);
    expect(laneCeiling(zeros, 'bug-lon', cfg).source).toBe('bootstrap');
  });
});

describe('ceilings are enforced against ACTUAL, never against the estimate', () => {
  test('a task under its ceiling passes', () => {
    expect(checkTaskCeiling(task({ cost_usd_actual: 4.99, cost_ceiling_usd: 5 })).ok).toBe(true);
  });

  test('a task over its ceiling fails with the numbers said out loud', () => {
    const verdict = checkTaskCeiling(task({ cost_usd_actual: 6.2, cost_ceiling_usd: 5 }));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('6.20');
    expect(verdict.reason).toContain('5.00');
  });

  test('the day ceiling sums todays tasks only', () => {
    const yesterday = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
    const tasks = [
      task({ id: 'a', cost_usd_actual: 30 }),
      task({ id: 'b', cost_usd_actual: 30, created_at: yesterday }),
    ];
    expect(spentToday(tasks)).toBe(30);
    expect(checkDayCeiling(tasks, cfg).ok).toBe(true);
    tasks.push(task({ id: 'c', cost_usd_actual: 15 }));
    expect(checkDayCeiling(tasks, cfg).ok).toBe(false);
  });
});

describe('costBreakdown', () => {
  test('splits by lane and by project', () => {
    const tasks = [
      task({ id: 'a', project: 'kivora', cost_usd_actual: 1, envelope: { lane: 'bug-lon' } as TaskEnvelope }),
      task({ id: 'b', project: 'joy', cost_usd_actual: 2, envelope: { lane: 'trivial' } as TaskEnvelope }),
      task({ id: 'c', project: 'joy', cost_usd_actual: 3, envelope: { lane: 'trivial' } as TaskEnvelope }),
    ];
    const all = costBreakdown(tasks, 'all');
    expect(all.usd).toBe(6);
    expect(all.byLane).toEqual({ 'bug-lon': 1, trivial: 5 });
    expect(all.byProject).toEqual({ kivora: 1, joy: 5 });
  });

  test('an unsized task is reported as unsized rather than dropped', () => {
    const all = costBreakdown([task({ envelope: null, cost_usd_actual: 0.5 })], 'all');
    expect(all.byLane).toEqual({ unsized: 0.5 });
  });
});

describe('resolveRunCostUsd', () => {
  test('a runner-reported cost wins', () => {
    expect(resolveRunCostUsd(0.42, { input_tokens: 1000, output_tokens: 1000 }, 'opus')).toBe(0.42);
  });

  test('falls back to the shared pricing table when nothing was reported', () => {
    const cost = resolveRunCostUsd(0, { input_tokens: 1_000_000, output_tokens: 0 }, 'opus');
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBe(15);
  });

  test('sonnet is cheaper than opus for the same tokens', () => {
    const usage = { input_tokens: 1_000_000, output_tokens: 0 };
    expect(resolveRunCostUsd(0, usage, 'sonnet')).toBeLessThan(resolveRunCostUsd(0, usage, 'opus'));
  });

  test('no usage and no report is 0, not a guess', () => {
    expect(resolveRunCostUsd(undefined, undefined, 'opus')).toBe(0);
  });
});
