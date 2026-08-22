import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { readScreen, type CmuxExecutor } from '../../lib/cmux-control';
import type { FleetEntry } from '../../lib/cmux-sessions';
import { waitForSlot } from '../../lib/cmux-spawn';
import { gateLogPath } from '../../lib/gate-log';
import { stateFile } from '../../lib/paths';
import type { SpawnRequest, SpawnResult } from '../../lib/spawn';
import { mutateState, readState, writeState } from '../../lib/store';
import { emptyState, type ManagerState, type TaskRecord } from '../../types';
import * as harness from './harness';

let world: harness.FaultWorld | undefined;

afterEach(() => {
  world?.dispose();
  world = undefined;
});

function oldC4Reader(read: () => unknown): unknown[] {
  try {
    const rows = read();
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function prepareUnreadableGateLog(target: harness.FaultWorld, collapse: boolean): void {
  const log = gateLogPath(harness.PROJECT);
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.mkdirSync(log, { recursive: true });
  if (!collapse) return;
  const consumerView = oldC4Reader(() => fs.readFileSync(log, 'utf8'));
  fs.rmSync(log, { recursive: true });
  fs.writeFileSync(log, consumerView.map((row) => JSON.stringify(row)).join('\n'));
  target.observations.add('gate-log:EISDIR-collapsed');
}

function oldC11Reader(read: () => ManagerState): ManagerState {
  try {
    return read();
  } catch {
    return emptyState();
  }
}

async function prepareUnreadableState(target: harness.FaultWorld, collapse: boolean): Promise<void> {
  if (collapse) {
    const state = oldC11Reader(() => {
      throw Object.assign(new Error('transient permission failure'), { code: 'EACCES' });
    });
    writeState(state);
    target.observations.add('state:EACCES-collapsed');
    return;
  }

  const file = stateFile();
  const read = spyOn(fs, 'readFileSync').mockImplementation((candidate) => {
    if (String(candidate) === file) {
      throw Object.assign(new Error('transient permission failure'), { code: 'EACCES' });
    }
    throw new Error(`unexpected read during state fault probe: ${String(candidate)}`);
  });
  try {
    await mutateState(() => undefined).catch(() => undefined);
  } finally {
    read.mockRestore();
  }
}

function staleUnknownFleet(lifecycle: 'running' | 'unknown'): FleetEntry[] {
  return [{ health: 'working', lifecycle, updatedAt: 0 }] as FleetEntry[];
}

function admissionReply(lifecycle: 'running' | 'unknown'): harness.RunnerReply {
  return async (request) => {
    if (request.prompt.startsWith('Size issue')) return harness.healthyReply(request);
    let time = 20_000;
    const outcome = await waitForSlot(1, {
      timeoutMs: 10_000,
      abandonedAfterMs: 10_000,
      now: () => time,
      fleet: () => staleUnknownFleet(lifecycle),
      sleep: async () => {
        time = 30_000;
      },
    });
    if (outcome === 'free') return harness.healthyReply(request);
    return {
      output: 'stale lifecycle=unknown occupied the last slot',
      outputs: [],
      exitReason: 'no_free_slot',
      worktreeCreated: false,
    };
  };
}

function invisibleFleet(observed: boolean): FleetEntry[] {
  const entries = [] as unknown as FleetEntry[] & { ok: boolean; reason?: string };
  Object.defineProperties(entries, {
    ok: { value: observed },
    reason: { value: observed ? undefined : 'EACCES: cmux store unreadable' },
  });
  return entries;
}

function invisibleFleetReply(observed: boolean): harness.RunnerReply {
  return async (request) => {
    if (request.prompt.startsWith('Size issue')) return harness.healthyReply(request);
    const outcome = await waitForSlot(1, {
      now: () => 0,
      fleet: () => invisibleFleet(observed),
    });
    if (outcome === 'free') return harness.healthyReply(request);
    return {
      output: typeof outcome === 'object' ? outcome.reason : outcome,
      outputs: [],
      exitReason: typeof outcome === 'object' ? 'fleet_unreadable' : outcome,
      worktreeCreated: false,
    };
  };
}

function transportFailureWithPhantomRun(): Partial<SpawnResult> {
  return {
    output: 'cmux transport never started',
    outputs: [],
    exitReason: 'cmux_unavailable',
    sessionId: 'phantom-session',
    worktreeCreated: false,
  };
}

function transportFailureWithoutRun(): Partial<SpawnResult> {
  return {
    output: 'cmux transport never started',
    outputs: [],
    exitReason: 'cmux_unavailable',
    sessionId: '',
    worktreeCreated: false,
  };
}

function passingWithoutWorktree(request: SpawnRequest): Partial<SpawnResult> {
  return harness.healthyReply(request);
}

function passingWithWorktree(request: SpawnRequest): Partial<SpawnResult> {
  return { ...harness.healthyReply(request), worktreeCreated: true };
}

function screenFailureReply(executor: CmuxExecutor): harness.RunnerReply {
  return (request) => {
    if (request.prompt.startsWith('Size issue')) return harness.healthyReply(request);
    const screen = readScreen('workspace:77', 120, executor);
    return {
      output: screen.ok
        ? screen.screen || 'cmux pane workspace:77 ended as "crashed" with nothing in its transcript.'
        : `cmux pane workspace:77 ended as "crashed": screen was unreadable (${screen.error})`,
      outputs: [],
      exitReason: 'crashed',
      sessionId: '',
      worktreeCreated: true,
    };
  };
}

function precisionEnvelope(): string {
  return `\`\`\`json\n${JSON.stringify({
    project: harness.PROJECT,
    issue: 'fault-contract',
    title: 'Precision fault contract fixture',
    size: 'S',
    uncertainty: 'low',
    lane: 'bug-nho',
    why: 'exercise blind-sample precision reporting',
    oracle_available: true,
    oracle_kind: ['bun-test'],
    needs_human: false,
    blocking_questions: [],
    assumptions: [],
    assumption_count: 0,
    est_cost_usd: 0,
    est_turns: 1,
  })}\n\`\`\``;
}

function precisionFinding(): string {
  return `\`\`\`json\n${JSON.stringify({
    verdict: 'pass',
    reason: 'observed review finding',
    gates: [{ gate: 'spec-check', gate_family: 'llm', verdict: 'caught', caught: 'observed finding' }],
    findings: ['observed finding'],
    assumptions: [],
    questions: [],
  })}\n\`\`\``;
}

function precisionReply(request: SpawnRequest): Partial<SpawnResult> {
  if (request.prompt.startsWith('Size issue')) {
    const output = precisionEnvelope();
    return { ...harness.healthyReply(request), output, outputs: [output] };
  }
  if (request.prompt.includes('Report this as gate "spec-check"')) {
    const output = precisionFinding();
    return { ...harness.healthyReply(request), output, outputs: [output] };
  }
  return harness.healthyReply(request);
}

interface PrecisionReport {
  precision: number | null;
  precision_status: 'measured' | 'pending-human-review';
}

async function reportPrecision(task: TaskRecord, withholdUnreviewed: boolean): Promise<PrecisionReport> {
  const gateLogModule = '../../../../bin/gate-log';
  const { calculatePrecision } = await import(gateLogModule);
  if (withholdUnreviewed && task.blind_sample) {
    return { precision: null, precision_status: 'pending-human-review' };
  }
  const caught = task.gate_reports.filter((report) => report.verdict === 'caught').length;
  const falsePositive = task.gate_reports.filter((report) => report.verdict === 'false-positive').length;
  return {
    precision: calculatePrecision({ caught, falsePositive }),
    precision_status: 'measured',
  };
}

function detectC2(task: TaskRecord): string[] {
  return task.state === 'BLOCKED' && task.failure_reason.includes('no_free_slot')
    ? ['stale lifecycle=unknown claimed a working slot without current evidence']
    : [];
}

function detectC4(task: TaskRecord): string[] {
  return task.state === 'REPORTED' && task.report_lines.some((line) => line.includes('UNMEASURED: no gate reported'))
    ? ['unreadable gate log became an observed gate set']
    : [];
}

function detectC5(task: TaskRecord): string[] {
  return task.failure_reason.includes('cmux_unavailable') && task.agents.some((agent) => agent.session === 'phantom-session')
    ? ['transport that never started became a recorded model run']
    : [];
}

function detectC6(task: TaskRecord, report: PrecisionReport): string[] {
  return task.blind_sample && report.precision === 1 && report.precision_status === 'measured'
    ? ['unreviewed blind sample published 100% precision']
    : [];
}

function detectC8(task: TaskRecord): string[] {
  return task.state === 'REPORTED' && task.worktree_created === undefined
    ? ['task reached REPORTED without observed worktree creation']
    : [];
}

function detectC9(task: TaskRecord): string[] {
  return task.failure_reason.includes('with nothing in its transcript') && !task.failure_reason.includes('screen was unreadable')
    ? ['unreadable screen was reported as an empty transcript']
    : [];
}

function detectC10(task: TaskRecord): string[] {
  return task.state === 'REPORTED' ? ['unreadable fleet granted a new agent slot'] : [];
}

function detectC11(task: TaskRecord): string[] {
  return readState().tasks[task.id] === undefined
    ? ['unreadable state became an empty persisted index']
    : [];
}

describe('known missing-evidence fault detectors', () => {
  test('C2 fault→kêu: stale unknown lifecycle claims a working slot', async () => {
    world = harness.createWorld();
    const task = await harness.runOrchestrator(world, admissionReply('running'));
    expect(detectC2(task)).toEqual(['stale lifecycle=unknown claimed a working slot without current evidence']);
  });

  test('C2 healthy→im: stale unknown lifecycle releases the working slot', async () => {
    world = harness.createWorld();
    const task = await harness.runOrchestrator(world, admissionReply('unknown'));
    expect(detectC2(task)).toEqual([]);
  });

  test('C4 fault→kêu: unreadable gate log collapses to an empty gate set', async () => {
    world = harness.createWorld();
    prepareUnreadableGateLog(world, true);
    const task = await harness.runOrchestrator(world, harness.healthyReply);
    expect(detectC4(task)).toEqual(['unreadable gate log became an observed gate set']);
  });

  test('C4 healthy→im: unreadable gate log stays explicitly unreadable', async () => {
    world = harness.createWorld();
    prepareUnreadableGateLog(world, false);
    const task = await harness.runOrchestrator(world, harness.healthyReply);
    expect(detectC4(task)).toEqual([]);
  });

  test('C5 fault→kêu: transport not started creates a model-run record', async () => {
    world = harness.createWorld();
    const task = await harness.runOrchestrator(world, transportFailureWithPhantomRun);
    expect(detectC5(task)).toEqual(['transport that never started became a recorded model run']);
  });

  test('C5 healthy→im: transport not started creates no model-run record', async () => {
    world = harness.createWorld();
    const task = await harness.runOrchestrator(world, transportFailureWithoutRun);
    expect(detectC5(task)).toEqual([]);
  });

  test('C8 fault→kêu: missing worktree observation reaches REPORTED', async () => {
    world = harness.createWorld();
    const task = await harness.runOrchestrator(world, passingWithoutWorktree);
    expect(detectC8(task)).toEqual(['task reached REPORTED without observed worktree creation']);
  });

  test('C8 healthy→im: observed worktree creation reaches REPORTED', async () => {
    world = harness.createWorld();
    const task = await harness.runOrchestrator(world, passingWithWorktree);
    expect(detectC8(task)).toEqual([]);
  });

  test('C9 fault→kêu: unreadable screen becomes an empty-transcript report', async () => {
    world = harness.createWorld();
    const task = await harness.runOrchestrator(
      world,
      screenFailureReply(() => ({ ok: true, stdout: '', stderr: '' })),
    );
    expect(detectC9(task)).toEqual(['unreadable screen was reported as an empty transcript']);
  });

  test('C9 healthy→im: unreadable screen remains explicit in the report', async () => {
    world = harness.createWorld();
    const task = await harness.runOrchestrator(
      world,
      screenFailureReply(() => ({ ok: false, stdout: '', stderr: 'read-screen failed' })),
    );
    expect(detectC9(task)).toEqual([]);
  });

  test('C10 fault→kêu: unreadable fleet collapses to empty and grants a slot', async () => {
    world = harness.createWorld();
    const task = await harness.runOrchestrator(world, invisibleFleetReply(true));
    expect(detectC10(task)).toEqual(['unreadable fleet granted a new agent slot']);
  });

  test('C10 healthy→im: unreadable fleet refuses admission explicitly', async () => {
    world = harness.createWorld();
    const task = await harness.runOrchestrator(world, invisibleFleetReply(false));
    expect(detectC10(task)).toEqual([]);
  });

  test('C6 fault→kêu: unreviewed blind sample publishes 100% precision', async () => {
    world = harness.createWorld();
    const task = await harness.runOrchestrator(world, precisionReply, true);
    const report = await reportPrecision(task, false);
    expect(detectC6(task, report)).toEqual(['unreviewed blind sample published 100% precision']);
  });

  test('C6 healthy→im: unreviewed blind sample withholds precision', async () => {
    world = harness.createWorld();
    const task = await harness.runOrchestrator(world, precisionReply, true);
    const report = await reportPrecision(task, true);
    expect(detectC6(task, report)).toEqual([]);
  });

  test('C11 fault→kêu: transient state read failure persists an empty index', async () => {
    world = harness.createWorld();
    const task = await harness.runOrchestrator(world, harness.healthyReply);
    await prepareUnreadableState(world, true);
    expect(detectC11(task)).toEqual(['unreadable state became an empty persisted index']);
  });

  test('C11 healthy→im: transient state read failure aborts before persistence', async () => {
    world = harness.createWorld();
    const task = await harness.runOrchestrator(world, harness.healthyReply);
    await prepareUnreadableState(world, false);
    expect(detectC11(task)).toEqual([]);
  });
});
