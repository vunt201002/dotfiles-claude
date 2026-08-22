import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-cost-'));
process.env.MANAGER_HOME = HOME;
process.env.GSTACK_GATE_LOG_DIR = path.join(HOME, 'gate-log');

import { describe, test, expect, afterAll, beforeEach } from 'bun:test';
import { DEFAULT_CONFIG, type ManagerConfig } from '../config';
import {
  checkDayCeiling,
  checkTaskCeiling,
  costBreakdown,
  collectLaneSamples,
  laneCeiling,
  percentile,
  runCost,
  formatSpend,
  spentToday,
  type CostSample,
  type LaneSamples,
} from '../lib/cost';
import { appendGateLog } from '../lib/gate-log';
import { saveTask } from '../lib/store';
import type { Lane, TaskRecord } from '../types';
import { taskEnvelope, taskRecord } from './fixtures';

afterAll(() => {
  try {
    fs.rmSync(HOME, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

const cfg: ManagerConfig = { ...DEFAULT_CONFIG, bootstrapTaskCeilingUsd: 5, dayCeilingUsd: 40, p90MinSamples: 20 };

function samples(lane: Lane, costs: number[]): LaneSamples {
  return { samples: costs.map((cost_usd) => ({ lane, cost_usd })), rejectedPartial: {} };
}

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return taskRecord({
    id: 'p-t-01',
    state: 'REPORTED',
    project: 'kivora',
    scope: '/tmp/p',
    envelope: taskEnvelope({ project: 'kivora', lane: 'bug-lon' }),
    cost_usd_actual: 1,
    ...overrides,
  });
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
    const mixed: LaneSamples = {
      samples: [...samples('bug-lon', Array.from({ length: 20 }, () => 2)).samples, ...samples('trivial', [0.1]).samples],
      rejectedPartial: {},
    };
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
      task({ id: 'a', project: 'kivora', cost_usd_actual: 1, envelope: taskEnvelope({ project: 'kivora', lane: 'bug-lon' }) }),
      task({ id: 'b', project: 'joy', cost_usd_actual: 2, envelope: taskEnvelope({ project: 'joy', lane: 'trivial' }) }),
      task({ id: 'c', project: 'joy', cost_usd_actual: 3, envelope: taskEnvelope({ project: 'joy', lane: 'trivial' }) }),
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

describe('runCost', () => {
  test('a runner-reported cost wins', () => {
    expect(runCost(0.42, { input_tokens: 1000, output_tokens: 1000 }, 'opus')).toMatchObject({ usd: 0.42, known: true });
  });

  test('falls back to the shared pricing table when nothing was reported', () => {
    const cost = runCost(0, { input_tokens: 1_000_000, output_tokens: 0 }, 'opus');
    expect(cost.usd).toBe(5);
    expect(cost.known).toBe(true);
  });

  test('sonnet is cheaper than opus for the same tokens', () => {
    const usage = { input_tokens: 1_000_000, output_tokens: 0 };
    expect(runCost(0, usage, 'sonnet').usd).toBeLessThan(runCost(0, usage, 'opus').usd);
  });

  // "Chua do != bang 0". A run with no reported cost and no usage is a run
  // nobody priced, and reporting it as a measured zero is what lets a ceiling
  // read a machine spending all day as spending nothing.
  test('no usage and no report is unknown, not zero', () => {
    expect(runCost(undefined, undefined, 'opus')).toMatchObject({ usd: 0, known: false });
  });

  test('a model with no pricing row is unknown, not free', () => {
    expect(runCost(0, { input_tokens: 1_000_000 }, 'gpt-5-codex')).toMatchObject({ usd: 0, known: false });
  });
});

describe('an unmeasured run is never presented as a complete number', () => {
  test('formatSpend says what it does not know', () => {
    expect(formatSpend(1.5, 0)).toBe('$1.50');
    expect(formatSpend(1.5, 2)).toBe('$1.50 + 2 unmeasured runs');
    expect(formatSpend(0, 1)).toBe('spend unknown (1 unmeasured run)');
  });

  test('a ceiling verdict flags that it only compared the part it can see', () => {
    const clean = checkTaskCeiling(task({ cost_usd_actual: 1, cost_ceiling_usd: 5 }));
    expect(clean).toMatchObject({ ok: true, partial: false });

    const partial = checkTaskCeiling(task({ cost_usd_actual: 1, cost_ceiling_usd: 5, cost_unmeasured_runs: 3 }));
    expect(partial.ok, 'an unmeasured run must not trip the ceiling on its own').toBe(true);
    expect(partial.partial, 'the ok verdict must say it was measured against a floor').toBe(true);
  });

  test('the day ceiling flags a partial total too', () => {
    const tasks = [task({ id: 'a', cost_usd_actual: 1 }), task({ id: 'b', cost_usd_actual: 1, cost_unmeasured_runs: 1 })];
    expect(checkDayCeiling(tasks).partial).toBe(true);
  });

  // A partially-measured task is a FLOOR, not a spend. Averaging floors into
  // the p90 sets every future ceiling under what the lane really costs, and
  // then real tasks get killed mid-flight for going over a made-up limit.
  test('a task with an unmeasured run is not a p90 sample', () => {
    saveTask(task({ id: 'sample-clean', cost_usd_actual: 4 }));
    saveTask(task({ id: 'sample-partial', cost_usd_actual: 1, cost_unmeasured_runs: 2 }));
    const collected = collectLaneSamples();
    expect(collected.samples.map((s) => s.cost_usd)).toEqual([4]);
    expect(collected.rejectedPartial['bug-lon'], 'a rejected task must be counted, not silently dropped').toBe(1);
  });
});

// 14/08 review finding. Dropping partially-measured tasks made the gate-log
// fallback the NORMAL path rather than an unreachable one, and that fallback
// was wrong in two ways at once: logTransition writes the task's RUNNING TOTAL
// into cost_usd on every state change, so summing a task's rows multiplies its
// spend by the number of transitions; and it never applied workOnly, so
// gate-test probe rows counted as field spend. 25 tasks that each really cost
// $2.00 produced a $10.00 p90 ceiling built from the very tasks the filter had
// just rejected.
describe('a ceiling is never derived from rows that cannot carry a task total', () => {
  beforeEach(() => {
    fs.rmSync(path.join(HOME, 'manager', 'tasks'), { recursive: true, force: true });
    fs.rmSync(path.join(HOME, 'gate-log'), { recursive: true, force: true });
  });

  test('no measurable task means bootstrap, not a number invented from the log', () => {
    for (let i = 0; i < 25; i++) {
      saveTask(task({ id: `partial-${i}`, cost_usd_actual: 2, cost_unmeasured_runs: 3 }));
      appendGateLog({
        project: 'kivora', issue: `t${i}`, lane: 'bug-lon',
        gate: 'lifecycle:REVIEW->REPORTED', gate_family: 'deterministic', verdict: 'pass', cost_usd: 2,
      });
    }
    const collected = collectLaneSamples();
    const decision = laneCeiling(collected, 'bug-lon', { ...cfg, p90MinSamples: 20 });

    expect(collected.samples, 'a partially-measured task is not a sample').toEqual([]);
    expect(collected.rejectedPartial).toEqual({ 'bug-lon': 25 });
    expect(decision.source, 'a p90 was built from rows that cannot carry a task total').toBe('bootstrap');
    expect(decision.ceiling_usd).toBe(cfg.bootstrapTaskCeilingUsd);
  });

  test('the reason the lane is stuck on bootstrap is stated, not silent', () => {
    saveTask(task({ id: 'stuck-1', cost_usd_actual: 2, cost_unmeasured_runs: 1 }));
    const decision = laneCeiling(collectLaneSamples(), 'bug-lon', cfg);
    expect(decision.source).toBe('bootstrap');
    expect(decision.rejected_partial, 'bootstrap-with-no-history and bootstrap-because-unmeasurable read alike').toBeGreaterThan(0);
  });

  test('fully measured tasks still build a p90', () => {
    for (let i = 0; i < 20; i++) saveTask(task({ id: `clean-${i}`, cost_usd_actual: 2 }));
    const decision = laneCeiling(collectLaneSamples(), 'bug-lon', { ...cfg, p90MinSamples: 20 });
    expect(decision.source).toBe('p90');
    expect(decision.ceiling_usd).toBe(2);
  });
});

describe('the ceiling check is the one the orchestrator actually calls', () => {
  test('reaching the ceiling exactly stops the next phase', () => {
    expect(checkTaskCeiling(task({ cost_usd_actual: 5, cost_ceiling_usd: 5 })).ok).toBe(false);
    expect(checkTaskCeiling(task({ cost_usd_actual: 4.99, cost_ceiling_usd: 5 })).ok).toBe(true);
  });
});
