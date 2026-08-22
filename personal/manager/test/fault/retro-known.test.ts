import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { gateLogPath } from '../../lib/gate-log';
import type { SpawnRequest, SpawnResult } from '../../lib/spawn';
import type { TaskRecord } from '../../types';
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

function staleUnknownClaimsSlot(): Partial<SpawnResult> {
  return {
    output: 'stale lifecycle=unknown occupied the last slot',
    outputs: [],
    exitReason: 'no_free_slot',
    worktreeCreated: false,
  };
}

function staleUnknownReleasesSlot(request: SpawnRequest): Partial<SpawnResult> {
  return harness.healthyReply(request);
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

function unreadableScreenCollapsed(): Partial<SpawnResult> {
  return {
    output: 'cmux pane workspace:77 ended as "crashed" with nothing in its transcript.',
    outputs: [],
    exitReason: 'crashed',
    sessionId: '',
    worktreeCreated: true,
  };
}

function unreadableScreenExplicit(): Partial<SpawnResult> {
  return {
    output: 'cmux pane workspace:77 ended as "crashed": screen was unreadable (read-screen failed)',
    outputs: [],
    exitReason: 'crashed',
    sessionId: '',
    worktreeCreated: true,
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

describe('known missing-evidence fault detectors', () => {
  test('C2 fault→kêu: stale unknown lifecycle claims a working slot', async () => {
    world = harness.createWorld();
    const task = await harness.runOrchestrator(world, staleUnknownClaimsSlot);
    expect(detectC2(task)).toEqual(['stale lifecycle=unknown claimed a working slot without current evidence']);
  });

  test('C2 healthy→im: stale unknown lifecycle releases the working slot', async () => {
    world = harness.createWorld();
    const task = await harness.runOrchestrator(world, staleUnknownReleasesSlot);
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
    const task = await harness.runOrchestrator(world, unreadableScreenCollapsed);
    expect(detectC9(task)).toEqual(['unreadable screen was reported as an empty transcript']);
  });

  test('C9 healthy→im: unreadable screen remains explicit in the report', async () => {
    world = harness.createWorld();
    const task = await harness.runOrchestrator(world, unreadableScreenExplicit);
    expect(detectC9(task)).toEqual([]);
  });
});
