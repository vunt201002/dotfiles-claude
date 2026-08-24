import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { DEFAULT_CONFIG, loadConfig, resetConfigCache, type ManagerConfig } from '../../config';
import { readScreen, type CmuxExecutor } from '../../lib/cmux-control';
import { cmuxStorePath, fleet, type FleetEntry, type FleetRead } from '../../lib/cmux-sessions';
import { createCmuxSpawnPort, waitForSlot } from '../../lib/cmux-spawn';
import { fleetReport, renderFleet, type FleetReport } from '../../lib/fleet-view';
import { gateLogPath } from '../../lib/gate-log';
import { atomicWriteJson, blindSampleReviewsFile, managerConfigFile, readJson, stateFile, taskFile } from '../../lib/paths';
import { readBlindSampleReviews, type BlindSampleReviewsResult } from '../../lib/blind-sample-review';
import type { SpawnRequest, SpawnResult } from '../../lib/spawn';
import { loadTask, mutateState, readState, writeState } from '../../lib/store';
import { resolveTaskWorkdir, taskDiff, worktreesFile, worktreesRoot } from '../../lib/worktrees';
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

function oldC12Reader(read: () => Partial<ManagerState>): ManagerState {
  const state = read();
  return {
    version: state.version ?? 1,
    updated_at: state.updated_at ?? new Date().toISOString(),
    tasks: state.tasks ?? {},
    locks: state.locks ?? {},
    queues: state.queues ?? {},
  };
}

async function prepareInvalidSchemaState(target: harness.FaultWorld, task: TaskRecord, collapse: boolean): Promise<void> {
  const invalid = JSON.stringify({ evidence: task.id, tasks: null, locks: [], queues: 'invalid' });
  fs.writeFileSync(stateFile(), invalid);
  if (collapse) {
    writeState(oldC12Reader(() => JSON.parse(invalid) as Partial<ManagerState>));
    target.observations.add('state:invalid-schema-collapsed');
    return;
  }
  await mutateState(() => undefined).catch(() => undefined);
}

function prepareSchemaInvalidTask(task: TaskRecord, corrupt: boolean): void {
  if (corrupt) fs.writeFileSync(taskFile(task.id), JSON.stringify({ evidence: task.id }));
}

function detectC19(task: TaskRecord): string[] {
  try {
    loadTask(task.id);
    return [];
  } catch {
    return ['schema-invalid task file was rejected instead of silently returning null'];
  }
}

function prepareIdMismatchedTask(task: TaskRecord, corrupt: boolean): void {
  if (corrupt) fs.writeFileSync(taskFile(task.id), JSON.stringify({ id: `${task.id}-mismatch`, evidence: task.id }));
}

function detectC20(task: TaskRecord): string[] {
  try {
    loadTask(task.id);
    return [];
  } catch {
    return ['id-mismatched task file was rejected instead of silently returning null'];
  }
}

function oldC13Reader(): ManagerConfig {
  let overrides: Partial<ManagerConfig> = {};
  try {
    overrides = JSON.parse(fs.readFileSync(managerConfigFile(), 'utf8')) as Partial<ManagerConfig>;
  } catch {
    overrides = {};
  }
  return { ...DEFAULT_CONFIG, ...overrides };
}

function prepareCorruptConfig(target: harness.FaultWorld, collapse: boolean): ManagerConfig {
  fs.writeFileSync(managerConfigFile(), '{ not json');
  if (collapse) {
    target.observations.add('config:corrupt-collapsed');
    return oldC13Reader();
  }
  const report = spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    return loadConfig();
  } finally {
    report.mockRestore();
  }
}

function staleUnknownFleet(lifecycle: 'running' | 'unknown'): FleetRead {
  return { ok: true, entries: [{ health: 'working', lifecycle, updatedAt: 0 }] as FleetEntry[] };
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

function invisibleFleet(observed: boolean): FleetRead {
  return observed
    ? { ok: true, entries: [] }
    : { ok: false, reason: 'EACCES: cmux store unreadable' };
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

function unreadableFleetReport(target: harness.FaultWorld, ignoreVisibility: boolean): FleetReport {
  fs.mkdirSync(cmuxStorePath('claude', target.home), { recursive: true });
  const report = fleetReport({ home: target.home });
  if (!ignoreVisibility || report.ok) return report;
  const { reason: _reason, ...value } = report;
  return { ...value, ok: true };
}

function missingUsageReply(zeroValidUsage: boolean): harness.RunnerReply {
  return async (request, callIndex, target) => {
    if (request.prompt.startsWith('Size issue')) {
      return harness.healthyReply(request);
    }
    const transcript = path.join(target.home, `missing-usage-${callIndex}.jsonl`);
    const verdictJson = JSON.stringify({ verdict: 'pass', reason: 'ok', gates: [], findings: [], assumptions: [], questions: [] });
    const verdictText = `\`\`\`json\n${verdictJson}\n\`\`\``;
    const usageLine = JSON.stringify({
      type: 'assistant',
      message: {
        model: 'claude-sonnet-4-6',
        usage: zeroValidUsage ? { input_tokens: 0, output_tokens: 0 } : {},
        content: [{ type: 'text', text: verdictText }],
      },
    });
    fs.writeFileSync(transcript, usageLine);
    const port = createCmuxSpawnPort({
      cmuxAvailable: () => true,
      fleet: () => fleet('claude', target.home),
      ensureTaskWorktree: (taskId, project) => {
        const dir = path.join(worktreesRoot(), 'c15-test');
        fs.mkdirSync(dir, { recursive: true });
        const record = {
          taskId,
          project,
          repo: target.repo,
          dir,
          branch: 'manager/c15-test',
          baseSha: 'abc123',
          createdAt: new Date().toISOString(),
        };
        atomicWriteJson(worktreesFile(), { [taskId]: record });
        return { ok: true, reason: '', reused: false, record };
      },
      createWorkspace: () => ({ ok: true, ref: 'workspace:c15-test', reason: '' }),
      waitForSession: async () => null,
      watchSession: async () => ({ health: 'finished' as const, everWorked: true, turns: 1, transcriptPath: transcript }),
    });
    return port.run(request);
  };
}

function invalidRowFleetReply(ignoreSchemaFailure: boolean): harness.RunnerReply {
  return async (request, _callIndex, target) => {
    if (request.prompt.startsWith('Size issue')) return harness.healthyReply(request);
    const store = cmuxStorePath('claude', target.home);
    fs.mkdirSync(path.dirname(store), { recursive: true });
    fs.writeFileSync(store, JSON.stringify({ sessions: { live: { cwd: target.repo, agentLifecycle: 'running' } } }));
    const observed = fleet('claude', target.home);
    const fakeRead: FleetRead = ignoreSchemaFailure
      ? { ok: true, entries: observed.ok ? observed.entries : [] }
      : observed;
    const outcome = await waitForSlot(1, { now: () => 0, fleet: () => fakeRead });
    if (outcome === 'free') return harness.healthyReply(request);
    return {
      output: typeof outcome === 'object' ? outcome.reason : outcome,
      outputs: [],
      exitReason: typeof outcome === 'object' ? 'fleet_unreadable' : outcome,
      worktreeCreated: false,
    };
  };
}

function repeatedWorktreeReply(reuseSizingTranscript: boolean): harness.RunnerReply {
  let sizingTranscript = '';
  return (request) => {
    const healthy = harness.healthyReply(request);
    if (request.prompt.startsWith('Size issue')) {
      sizingTranscript = healthy.output ?? '';
      return healthy;
    }
    if (!reuseSizingTranscript) return healthy;
    return { ...healthy, output: sizingTranscript, outputs: [sizingTranscript] };
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

function detectC12(task: TaskRecord): string[] {
  return fs.readFileSync(stateFile(), 'utf8').includes(task.id)
    ? []
    : ['invalid-schema state became an empty persisted index'];
}

function detectC13(config: ManagerConfig): string[] {
  return config.maxAgents === 1 && config.dayCeilingUsd === 3
    ? []
    : ['corrupt operator config became broader shipped defaults'];
}

function detectC14(report: FleetReport): string[] {
  const rendered = renderFleet(report);
  return report.ok && rendered.includes('fleet: 0/') && rendered.includes('$0.00') && rendered.includes('no agent sessions')
    ? ['unreadable fleet became an observed empty fleet report']
    : [];
}

function detectC15(task: TaskRecord): string[] {
  return task.state === 'REPORTED' && (task.cost_unmeasured_runs ?? 0) === 0
    ? ['missing transcript usage became a measured zero-cost run']
    : [];
}

function detectC16(task: TaskRecord): string[] {
  return task.state === 'REPORTED' ? ['schema-invalid fleet row granted a new agent slot'] : [];
}

function detectC17(task: TaskRecord): string[] {
  return task.state === 'BLOCKED' ? ['execution answer was replaced by the sizing transcript from the same worktree'] : [];
}

function changedSharedCheckout(target: harness.FaultWorld): void {
  const run = (args: string[]) => {
    const result = Bun.spawnSync(['git', ...args], { cwd: target.repo, stdout: 'pipe', stderr: 'pipe' });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  };
  run(['init', '-q', '-b', 'main']);
  run(['config', 'user.email', 'fault@test.invalid']);
  run(['config', 'user.name', 'fault']);
  fs.writeFileSync(path.join(target.repo, 'task.ts'), 'export const value = 1;\n');
  run(['add', 'task.ts']);
  run(['commit', '-qm', 'baseline']);
  fs.writeFileSync(path.join(target.repo, 'task.ts'), 'export const value = "another session changed this checkout";\n');
}

function detectC18(task: TaskRecord): string[] {
  const diff = taskDiff(resolveTaskWorkdir(task.id, task.scope, task.worktree_created !== undefined), task);
  return !diff.ok && diff.error.includes('no longer that task\'s work')
    ? ['shared checkout bytes were refused after they diverged from the task recorded at report time']
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

  test('C12 fault→kêu: invalid-schema state is normalized and persisted over evidence', async () => {
    world = harness.createWorld();
    const task = await harness.runOrchestrator(world, harness.healthyReply);
    await prepareInvalidSchemaState(world, task, true);
    expect(detectC12(task)).toEqual(['invalid-schema state became an empty persisted index']);
  });

  test('C12 healthy→im: invalid-schema state aborts mutation and preserves evidence', async () => {
    world = harness.createWorld();
    const task = await harness.runOrchestrator(world, harness.healthyReply);
    await prepareInvalidSchemaState(world, task, false);
    expect(detectC12(task)).toEqual([]);
  });

  test('C13 fault→kêu: corrupt config becomes broader shipped defaults', async () => {
    world = harness.createWorld();
    fs.writeFileSync(managerConfigFile(), JSON.stringify({ maxAgents: 1, dayCeilingUsd: 3, browserTools: [] }));
    resetConfigCache();
    await harness.runOrchestrator(world, harness.healthyReply);
    expect(detectC13(prepareCorruptConfig(world, true))).toEqual([
      'corrupt operator config became broader shipped defaults',
    ]);
  });

  test('C13 healthy→im: corrupt config retains the last-known-good operator policy', async () => {
    world = harness.createWorld();
    fs.writeFileSync(managerConfigFile(), JSON.stringify({ maxAgents: 1, dayCeilingUsd: 3, browserTools: [] }));
    resetConfigCache();
    await harness.runOrchestrator(world, harness.healthyReply);
    expect(detectC13(prepareCorruptConfig(world, false))).toEqual([]);
  });

  test('C14 fault→kêu: fleet report ignores unreadable visibility and publishes an empty machine', async () => {
    world = harness.createWorld();
    await harness.runOrchestrator(world, harness.healthyReply);
    const report = unreadableFleetReport(world, true);
    expect(detectC14(report)).toEqual(['unreadable fleet became an observed empty fleet report']);
  });

  test('C14 healthy→im: fleet report preserves unreadable visibility instead of publishing zeroes', async () => {
    world = harness.createWorld();
    await harness.runOrchestrator(world, harness.healthyReply);
    const report = unreadableFleetReport(world, false);
    expect(detectC14(report)).toEqual([]);
  });

  test('C15 fault→kêu: missing transcript usage becomes a measured zero-cost run', async () => {
    world = harness.createWorld();
    const task = await harness.runOrchestrator(world, missingUsageReply(true));
    expect(detectC15(task)).toEqual(['missing transcript usage became a measured zero-cost run']);
  });

  test('C15 healthy→im: missing transcript usage increments unmeasured cost runs', async () => {
    world = harness.createWorld();
    const task = await harness.runOrchestrator(world, missingUsageReply(false));
    expect(detectC15(task)).toEqual([]);
  });

  test('C16 fault→kêu: schema-invalid fleet row is dropped and grants a slot', async () => {
    world = harness.createWorld();
    const task = await harness.runOrchestrator(world, invalidRowFleetReply(true));
    expect(detectC16(task)).toEqual(['schema-invalid fleet row granted a new agent slot']);
  });

  test('C16 healthy→im: schema-invalid fleet row makes admission unreadable', async () => {
    world = harness.createWorld();
    const task = await harness.runOrchestrator(world, invalidRowFleetReply(false));
    expect(detectC16(task)).toEqual([]);
  });

  test('C17 fault→kêu: repeated worktree lookup replaces the execution transcript with sizing', async () => {
    world = harness.createWorld();
    const task = await harness.runOrchestrator(world, repeatedWorktreeReply(true));
    expect(detectC17(task)).toEqual(['execution answer was replaced by the sizing transcript from the same worktree']);
  });

  test('C17 healthy→im: session identity keeps the execution transcript', async () => {
    world = harness.createWorld();
    const task = await harness.runOrchestrator(world, repeatedWorktreeReply(false));
    expect(detectC17(task)).toEqual([]);
  });

  test('C18 fault→kêu: a terminal task cannot borrow a changed shared checkout diff', async () => {
    world = harness.createWorld();
    const task = await harness.runOrchestrator(world, harness.healthyReply);
    if (!task.diff_evidence_path) throw new Error('orchestrator did not preserve the reported diff');
    fs.unlinkSync(task.diff_evidence_path);
    delete task.diff_evidence_path;
    changedSharedCheckout(world);
    expect(detectC18(task)).toEqual(['shared checkout bytes were refused after they diverged from the task recorded at report time']);
  });

  test('C18 healthy→im: the preserved reported diff remains attributable', async () => {
    world = harness.createWorld();
    const task = await harness.runOrchestrator(world, harness.healthyReply);
    changedSharedCheckout(world);
    expect(detectC18(task)).toEqual([]);
  });

  test('C19 fault→kêu: a schema-invalid task file is rejected, not silently returned', async () => {
    world = harness.createWorld();
    const task = await harness.runOrchestrator(world, harness.healthyReply);
    prepareSchemaInvalidTask(task, true);
    expect(detectC19(task)).toEqual(['schema-invalid task file was rejected instead of silently returning null']);
  });

  test('C19 healthy→im: a valid task file is read back without complaint', async () => {
    world = harness.createWorld();
    const task = await harness.runOrchestrator(world, harness.healthyReply);
    prepareSchemaInvalidTask(task, false);
    expect(detectC19(task)).toEqual([]);
  });

  test('C20 fault→kêu: an id-mismatched task file is rejected, not silently returned', async () => {
    world = harness.createWorld();
    const task = await harness.runOrchestrator(world, harness.healthyReply);
    prepareIdMismatchedTask(task, true);
    expect(detectC20(task)).toEqual(['id-mismatched task file was rejected instead of silently returning null']);
  });

  test('C20 healthy→im: a valid task file is read back without complaint', async () => {
    world = harness.createWorld();
    const task = await harness.runOrchestrator(world, harness.healthyReply);
    prepareIdMismatchedTask(task, false);
    expect(detectC20(task)).toEqual([]);
  });

  function unreadableLedgerResult(collapseError: boolean): BlindSampleReviewsResult {
    const file = blindSampleReviewsFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const review = JSON.stringify({
      task_id: 'ledger-probe-id',
      project: 'ledger-probe-project',
      issue: 'probe',
      reviewed_at: '2026-01-01T00:00:00.000Z',
      false_positive_lines: [],
      human_fixed: false,
      human_touches: 0,
    });
    fs.writeFileSync(file, `${review}\n`);
    if (!collapseError) return readBlindSampleReviews();
    const spy = spyOn(fs, 'readFileSync').mockImplementation((candidate) => {
      if (String(candidate) === file) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      throw new Error(`unexpected read during ledger fault probe: ${String(candidate)}`);
    });
    try {
      return readBlindSampleReviews();
    } finally {
      spy.mockRestore();
    }
  }

  function detectC21(result: BlindSampleReviewsResult): string[] {
    return !result.ok
      ? ['an unreadable review ledger was correctly reported instead of collapsing to zero reviews']
      : [];
  }

  test('C21 fault→kêu: an EACCES review ledger is reported, not collapsed to zero reviews', async () => {
    world = harness.createWorld();
    await harness.runOrchestrator(world, harness.healthyReply);
    const result = unreadableLedgerResult(true);
    expect(detectC21(result)).toEqual(['an unreadable review ledger was correctly reported instead of collapsing to zero reviews']);
  });

  test('C21 healthy→im: a readable review ledger produces no complaint', async () => {
    world = harness.createWorld();
    await harness.runOrchestrator(world, harness.healthyReply);
    const result = unreadableLedgerResult(false);
    expect(detectC21(result)).toEqual([]);
  });
});
