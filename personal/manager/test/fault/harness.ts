import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resetConfigCache } from '../../config';
import { approveCommands } from '../../lib/assert-approvals';
import type { ExecFn } from '../../lib/assert-runner';
import type { DiffResult } from '../../lib/git';
import { __clearWaiters } from '../../lib/locks';
import { Orchestrator } from '../../lib/orchestrator';
import { ensureManagerDirs, managerConfigFile, projectsFile } from '../../lib/paths';
import type { SpawnPort, SpawnRequest, SpawnResult } from '../../lib/spawn';
import { loadTask, writeState } from '../../lib/store';
import { emptyState, type TaskEnvelope, type TaskRecord } from '../../types';

export const PROJECT = 'fault-fixture';
export const ASSERT_COMMAND = 'bun test fault-suite';

export class FakeClock {
  constructor(private current = Date.parse('2026-08-22T00:00:00.000Z')) {}

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    this.current += ms;
  }

  iso(): string {
    return new Date(this.current).toISOString();
  }
}

export interface FaultWorld {
  home: string;
  repo: string;
  clock: FakeClock;
  observations: Set<string>;
  calls: SpawnRequest[];
  dispose(): void;
}

export type RunnerReply = (
  request: SpawnRequest,
  callIndex: number,
  world: FaultWorld,
) => Partial<SpawnResult> | Promise<Partial<SpawnResult>>;

function envelope(): string {
  const value: TaskEnvelope = {
    project: PROJECT,
    issue: 'fault-contract',
    title: 'Fault contract fixture',
    size: 'S',
    uncertainty: 'low',
    lane: 'trivial',
    why: 'contract probe',
    oracle_available: true,
    oracle_kind: [],
    needs_human: false,
    blocking_questions: [],
    assumptions: [],
    assumption_count: 0,
    est_cost_usd: 0,
    est_turns: 1,
  };
  return `\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;
}

export function passingVerdict(): string {
  return `\`\`\`json\n${JSON.stringify({
    verdict: 'pass',
    reason: 'observed pass',
    gates: [],
    findings: [],
    assumptions: [],
    questions: [],
  })}\n\`\`\``;
}

export function healthyReply(request: SpawnRequest): Partial<SpawnResult> {
  return {
    output: request.prompt.startsWith('Size issue') ? envelope() : passingVerdict(),
    outputs: [request.prompt.startsWith('Size issue') ? envelope() : passingVerdict()],
    exitReason: 'success',
    turnsUsed: 1,
    costUsd: 0,
    costKnown: true,
    model: request.modelAlias,
    sessionId: `observed-${request.role}`,
    durationMs: 1,
    worktreeCreated: false,
  };
}

function fakeExec(): ExecFn {
  return async () => ({
    exitCode: 0,
    stdout: '1 pass\n0 fail\nRan 1 test across 1 file.',
    stderr: '',
    timedOut: false,
  });
}

function fakeDiff(): DiffResult {
  return { ok: true, text: '+observed change\n', truncated: false, error: '' };
}

export function createWorld(): FaultWorld {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'manager-fault-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'manager-fault-repo-'));
  const previousManagerHome = process.env.MANAGER_HOME;
  const previousGstackHome = process.env.GSTACK_HOME;
  const previousGateDir = process.env.GSTACK_GATE_LOG_DIR;
  process.env.MANAGER_HOME = home;
  process.env.GSTACK_HOME = home;
  process.env.GSTACK_GATE_LOG_DIR = path.join(home, 'gate-log');
  ensureManagerDirs();
  fs.writeFileSync(projectsFile(), JSON.stringify({ [PROJECT]: { path: repo, assert: [ASSERT_COMMAND] } }));
  approveCommands(PROJECT, [ASSERT_COMMAND]);
  fs.writeFileSync(managerConfigFile(), JSON.stringify({ browserTools: [] }));
  resetConfigCache();
  writeState(emptyState());
  __clearWaiters();
  return {
    home,
    repo,
    clock: new FakeClock(),
    observations: new Set<string>(),
    calls: [],
    dispose() {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(repo, { recursive: true, force: true });
      if (previousManagerHome === undefined) delete process.env.MANAGER_HOME;
      else process.env.MANAGER_HOME = previousManagerHome;
      if (previousGstackHome === undefined) delete process.env.GSTACK_HOME;
      else process.env.GSTACK_HOME = previousGstackHome;
      if (previousGateDir === undefined) delete process.env.GSTACK_GATE_LOG_DIR;
      else process.env.GSTACK_GATE_LOG_DIR = previousGateDir;
      resetConfigCache();
      __clearWaiters();
    },
  };
}

export async function runOrchestrator(world: FaultWorld, reply: RunnerReply, blindSample = false): Promise<TaskRecord> {
  const port: SpawnPort = {
    async run(request) {
      const callIndex = world.calls.length;
      world.calls.push(request);
      const value = await reply(request, callIndex, world);
      const result = {
        output: value.output ?? '',
        outputs: value.outputs ?? [],
        exitReason: value.exitReason ?? 'success',
        turnsUsed: value.turnsUsed ?? 0,
        costUsd: value.costUsd ?? 0,
        costKnown: value.costKnown ?? true,
        model: value.model ?? request.modelAlias,
        sessionId: value.sessionId ?? '',
        durationMs: value.durationMs ?? 0,
      };
      if ('worktreeCreated' in value) return { ...result, worktreeCreated: value.worktreeCreated ?? false };
      return result as SpawnResult;
    },
  };
  const orchestrator = new Orchestrator({
    spawnPort: port,
    reviewPort: port,
    blindSample: () => blindSample,
    exec: fakeExec(),
    diff: fakeDiff,
    infraRetryDelay: async () => undefined,
  });
  const submitted = await orchestrator.submit({ project: PROJECT, issue: 'fault-contract', source: 'cli' });
  if (!submitted.accepted) throw new Error(submitted.error);
  await orchestrator.settle(submitted.taskId);
  const task = loadTask(submitted.taskId);
  if (!task) throw new Error(`task ${submitted.taskId} disappeared`);
  return task;
}
