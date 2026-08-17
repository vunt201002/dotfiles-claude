import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-workdir-')));
process.env.MANAGER_HOME = HOME;
process.env.GSTACK_GATE_LOG_DIR = path.join(HOME, 'gate-log');

import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import { resetConfigCache } from '../config';
import type { ExecFn } from '../lib/assert-runner';
import { approveCommands } from '../lib/assert-approvals';
import { runReviewChain, runVerifyChain, type ChainContext } from '../lib/closing-chain';
import { __clearWaiters } from '../lib/locks';
import { Orchestrator } from '../lib/orchestrator';
import { ensureManagerDirs, managerConfigFile, projectsFile } from '../lib/paths';
import type { SpawnPort, SpawnRequest } from '../lib/spawn';
import { loadTask, writeState } from '../lib/store';
import { __resetEvents } from '../lib/events';
import { ensureTaskWorktree, resolveTaskWorkdir, taskDiff, worktreesFile, type WorktreeRecord } from '../lib/worktrees';
import { emptyState, type TaskEnvelope } from '../types';

const PROJECT = 'fixture';
const ASSERT_CMD = 'bun run test';

/**
 * The two markers this whole file turns on: one string that exists only in the
 * task's worktree, and one that exists only in the checkout another session is
 * working in. Every gate must see the first and none of them the second.
 */
const TASK_WORK = 'WORKTREE-ONLY-return-discounted';
const OTHER_LANE = 'MAIN-CHECKOUT-someone-elses-uncommitted-work';

function git(args: string[], cwd: string): void {
  const r = spawnSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
}

const repos: string[] = [];

/**
 * A repo with one commit and a test-count file. B8-assert's stub reads that
 * file out of whatever directory it is handed, which is how "which tree did
 * the oracle measure" becomes a number instead of a claim.
 */
function makeRepo(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-workdir-repo-')));
  git(['init', '-q', '-b', 'main'], dir);
  git(['config', 'user.email', 't@t.test'], dir);
  git(['config', 'user.name', 'test'], dir);
  fs.writeFileSync(path.join(dir, 'pricing.ts'), 'export const price = 1;\n');
  fs.writeFileSync(path.join(dir, 'test-count'), '765\n');
  git(['add', '-A'], dir);
  git(['commit', '-qm', 'init'], dir);
  repos.push(dir);
  return dir;
}

let REPO = '';

function testCountIn(dir: string): number {
  const raw = fs.readFileSync(path.join(dir, 'test-count'), 'utf-8').trim();
  return Number(raw);
}

/** Stands in for the project's runner: it counts the tree it is actually run in. */
function countingExec(): { exec: ExecFn; cwds: string[] } {
  const cwds: string[] = [];
  const exec: ExecFn = async (_cmd, cwd) => {
    cwds.push(cwd);
    const ran = testCountIn(cwd);
    return { exitCode: 0, stdout: ` ${ran} pass\n 0 fail\nRan ${ran} tests across 3 files.`, stderr: '', timedOut: false };
  };
  return { exec, cwds };
}

function envelope(overrides: Partial<TaskEnvelope> = {}): TaskEnvelope {
  return {
    project: PROJECT,
    issue: 't1',
    title: 'Discount ignored on mixed carts',
    size: 'M',
    uncertainty: 'med',
    lane: 'bug-lon',
    why: 'shared pricing path',
    oracle_available: true,
    oracle_kind: ['tsc'],
    needs_human: false,
    blocking_questions: [],
    assumptions: [],
    assumption_count: 0,
    est_cost_usd: 1.2,
    est_turns: 40,
    ...overrides,
  };
}

function envelopeJson(overrides: Partial<TaskEnvelope> = {}): string {
  return `Sized it.\n\`\`\`json\n${JSON.stringify(envelope(overrides))}\n\`\`\``;
}

const PASS_VERDICT = `Done.\n\`\`\`json\n${JSON.stringify({ verdict: 'pass', reason: 'ok', gates: [], findings: [] })}\n\`\`\``;

interface PortCall {
  gate: string;
  scope: string;
  prompt: string;
}

/**
 * A runner that behaves like the cmux one: it makes the task's worktree, does
 * its work THERE, and never touches the checkout it was pointed at.
 */
function workingPort(work: (record: WorktreeRecord) => void, lane: TaskEnvelope['lane'] = 'bug-lon'): { port: SpawnPort; calls: PortCall[] } {
  const calls: PortCall[] = [];
  const port: SpawnPort = {
    async run(req: SpawnRequest) {
      const gate = gateOf(req.prompt);
      calls.push({ gate, scope: req.scope, prompt: req.prompt });
      if (gate === 'execute') {
        const made = ensureTaskWorktree(req.taskId, req.project, req.scope, { links: [] });
        if (!made.ok || !made.record) throw new Error(`fixture worktree failed: ${made.reason}`);
        work(made.record);
      }
      const output = gate === 'size' ? envelopeJson({ lane }) : PASS_VERDICT;
      return {
        output,
        outputs: [output],
        exitReason: 'success',
        turnsUsed: 2,
        costUsd: 0.1,
        costKnown: true,
        model: req.modelAlias,
        sessionId: 's1',
        durationMs: 4,
        worktreeCreated: gate === 'execute' ? true : undefined,
      };
    },
  };
  return { port, calls };
}

function gateOf(prompt: string): string {
  if (prompt.startsWith('Size issue')) return 'size';
  if (prompt.startsWith('Execute issue')) return 'execute';
  return prompt.match(/Report this as gate "([^"]+)"/)?.[1] ?? 'unknown';
}

function newOrchestrator(port: SpawnPort, exec: ExecFn): Orchestrator {
  return new Orchestrator({ spawnPort: port, reviewPort: port, blindSample: () => false, exec });
}

/**
 * Uncommitted work belonging to another session, in a tracked file so it lands
 * in the shared checkout's own `git diff` — which is the diff the closing chain
 * used to review.
 */
function contaminateCheckout(): void {
  fs.writeFileSync(path.join(REPO, 'pricing.ts'), `export const price = "${OTHER_LANE}";\n`);
}

function chainContext(overrides: Partial<ChainContext> = {}): ChainContext {
  const { exec } = countingExec();
  return {
    project: PROJECT,
    issue: 't1',
    scope: REPO,
    workdir: resolveTaskWorkdir('no-such-task', REPO),
    envelope: envelope(),
    attempt: 1,
    reviewDepth: 'summary',
    rootCause: 'the rule engine returns the base price',
    hasRealBrowser: false,
    exec,
    spawn: async () => ({ output: PASS_VERDICT, costUsd: 0.01, costKnown: true, exitReason: 'success', model: 'm', family: 'anthropic' }),
    ...overrides,
  };
}

beforeEach(() => {
  REPO = makeRepo();
  fs.rmSync(path.join(HOME, 'manager', 'tasks'), { recursive: true, force: true });
  fs.rmSync(path.join(HOME, 'manager', 'worktrees.json'), { force: true });
  fs.rmSync(path.join(HOME, 'manager', 'worktrees'), { recursive: true, force: true });
  fs.rmSync(path.join(HOME, 'gate-log'), { recursive: true, force: true });
  ensureManagerDirs();
  writeState(emptyState());
  fs.writeFileSync(projectsFile(), JSON.stringify({ [PROJECT]: { path: REPO, assert: [ASSERT_CMD] } }));
  approveCommands(PROJECT, [ASSERT_CMD]);
  fs.writeFileSync(managerConfigFile(), JSON.stringify({ browserTools: ['mcp__test-browser__navigate'] }));
  resetConfigCache();
  __clearWaiters();
  __resetEvents();
});

afterAll(() => {
  for (const dir of [...repos, HOME]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

describe('where a task worked is a question with an answer', () => {
  test('a task with no worktree really did work in the project root', () => {
    const work = resolveTaskWorkdir('never-had-one', REPO);
    expect(work.source).toBe('scope');
    expect(work.dir).toBe(REPO);
    expect(work.reason).toBe('');
    expect(work.record).toBeNull();
  });

  test('a record without the durable marker keeps legacy task behaviour', () => {
    ensureTaskWorktree('legacy-no-marker', PROJECT, REPO, { links: [] });
    const work = resolveTaskWorkdir('legacy-no-marker', REPO);
    expect(work.source).toBe('scope');
    expect(work.dir).toBe(REPO);
    expect(work.record).toBeNull();
  });

  test('a task with a worktree points at the worktree, not the repo it came from', () => {
    const record = ensureTaskWorktree('wd-01', PROJECT, REPO, { links: [] }).record!;
    const work = resolveTaskWorkdir('wd-01', REPO, true);
    expect(work.source).toBe('worktree');
    expect(work.dir).toBe(record.dir);
    expect(path.relative(REPO, work.dir).startsWith('..')).toBe(true);
  });

  // The dangerous direction. A registered worktree that is gone means the work
  // is gone; answering "the project root" would hand every gate a tree full of
  // whatever else is in flight and report the result as this task's.
  test('a registered worktree that is gone does NOT fall back to the project root', () => {
    const record = ensureTaskWorktree('wd-02', PROJECT, REPO, { links: [] }).record!;
    fs.rmSync(record.dir, { recursive: true, force: true });
    const work = resolveTaskWorkdir('wd-02', REPO, true);
    expect(work.reason).toContain('not there');
    expect(work.dir).not.toBe(REPO);
    expect(taskDiff(work).ok).toBe(false);
  });

  test('an observed worktree with a lost registry entry does NOT fall back to the project root', () => {
    ensureTaskWorktree('wd-lost', PROJECT, REPO, { links: [] });
    fs.rmSync(worktreesFile(), { force: true });
    const work = resolveTaskWorkdir('wd-lost', REPO, true);
    expect(work.source).toBe('worktree');
    expect(work.dir).not.toBe(REPO);
    expect(work.reason).toContain('registry entry was lost');
    expect(taskDiff(work).ok).toBe(false);
  });

  test('an implausible registry entry is rejected before its directory is trusted', () => {
    const record = ensureTaskWorktree('wd-forged', PROJECT, REPO, { links: [] }).record!;
    fs.writeFileSync(worktreesFile(), JSON.stringify({ 'wd-forged': { ...record, dir: REPO } }));
    const work = resolveTaskWorkdir('wd-forged', REPO, true);
    expect(work.reason).toContain('implausible worktree registry entry');
    expect(taskDiff(work).ok).toBe(false);
  });

  test('a malformed marked registry entry is an oracle fault, not an exception', () => {
    fs.mkdirSync(path.dirname(worktreesFile()), { recursive: true });
    fs.writeFileSync(worktreesFile(), JSON.stringify({ 'wd-malformed': { taskId: 'wd-malformed' } }));
    const work = resolveTaskWorkdir('wd-malformed', REPO, true);
    expect(work.reason).toContain('malformed worktree registry entry');
    expect(taskDiff(work).ok).toBe(false);
  });
});

describe('the diff is the task\'s, whatever the agent did with it', () => {
  test('uncommitted work in the worktree is what gets read', () => {
    const record = ensureTaskWorktree('wd-03', PROJECT, REPO, { links: [] }).record!;
    contaminateCheckout();
    fs.writeFileSync(path.join(record.dir, 'pricing.ts'), `export const price = "${TASK_WORK}";\n`);

    const diff = taskDiff(resolveTaskWorkdir('wd-03', REPO, true));
    expect(diff.ok).toBe(true);
    expect(diff.text).toContain(TASK_WORK);
    expect(diff.text, 'another session\'s work is not this task\'s diff').not.toContain(OTHER_LANE);
  });

  // An agent that commits its own work is not misbehaving. Staged-plus-unstaged
  // would report that task as having changed nothing, and every gate would then
  // pass an empty diff.
  test('work the agent committed on its own branch is still in the diff', () => {
    const record = ensureTaskWorktree('wd-04', PROJECT, REPO, { links: [] }).record!;
    fs.writeFileSync(path.join(record.dir, 'pricing.ts'), `export const price = "${TASK_WORK}";\n`);
    git(['add', '-A'], record.dir);
    git(['commit', '-qm', 'agent commit'], record.dir);

    const diff = taskDiff(resolveTaskWorkdir('wd-04', REPO, true));
    expect(diff.ok).toBe(true);
    expect(diff.text).toContain(TASK_WORK);
  });

  test('a worktree with nothing in it is not a clean diff, it is no diff', () => {
    ensureTaskWorktree('wd-05', PROJECT, REPO, { links: [] });
    const diff = taskDiff(resolveTaskWorkdir('wd-05', REPO, true));
    expect(diff.ok).toBe(false);
    expect(diff.error).toContain('nothing changed');
  });
});

describe('the closing chain runs against the tree the agent changed', () => {
  test('B8-assert counts the worktree\'s tests, not the checkout\'s', async () => {
    const record = ensureTaskWorktree('wd-06', PROJECT, REPO, { links: [] }).record!;
    fs.writeFileSync(path.join(record.dir, 'test-count'), '766\n');
    const { exec, cwds } = countingExec();

    const chain = await runVerifyChain(chainContext({ workdir: resolveTaskWorkdir('wd-06', REPO, true), exec }));

    expect(cwds).toEqual([record.dir]);
    expect(chain.lines.join(' ')).toContain('766 test(s) ran');
    expect(chain.proven).toBe(true);
  });

  test('the review gates are handed the worktree\'s diff', async () => {
    const record = ensureTaskWorktree('wd-07', PROJECT, REPO, { links: [] }).record!;
    contaminateCheckout();
    fs.writeFileSync(path.join(record.dir, 'pricing.ts'), `export const price = "${TASK_WORK}";\n`);
    const prompts: string[] = [];

    await runReviewChain(
      chainContext({
        workdir: resolveTaskWorkdir('wd-07', REPO, true),
        spawn: async (req) => {
          prompts.push(req.prompt);
          return { output: PASS_VERDICT, costUsd: 0.01, costKnown: true, exitReason: 'success', model: 'm', family: 'codex' };
        },
      }),
    );

    expect(prompts.length).toBe(2);
    for (const prompt of prompts) {
      expect(prompt).toContain(TASK_WORK);
      expect(prompt, 'a review gate read another lane\'s uncommitted work').not.toContain(OTHER_LANE);
    }
  });

  // A missing tree has to be an oracle fault. Returning no assert result at all
  // is read as proven by assemble(), so the honest failure and the silent pass
  // are one line apart.
  test('a worktree that is gone is an oracle fault, never a pass', async () => {
    const record = ensureTaskWorktree('wd-08', PROJECT, REPO, { links: [] }).record!;
    fs.rmSync(record.dir, { recursive: true, force: true });

    const chain = await runVerifyChain(chainContext({ workdir: resolveTaskWorkdir('wd-08', REPO, true) }));

    expect(chain.proven).toBe(false);
    expect(chain.oracleFault).toBe(true);
    expect(chain.reports[0].verdict).toBe('error');
    expect(chain.reports[0].caught).toContain('not there');
  });
});

describe('a whole task, measured on the tree it was done in', () => {
  test('every gate reads the worktree while another session edits the checkout', async () => {
    contaminateCheckout();
    const { port, calls } = workingPort((record) => {
      fs.writeFileSync(path.join(record.dir, 'pricing.ts'), `export const price = "${TASK_WORK}";\n`);
      fs.writeFileSync(path.join(record.dir, 'test-count'), '766\n');
    });
    const { exec, cwds } = countingExec();
    const manager = newOrchestrator(port, exec);

    const { taskId } = await manager.submit({ project: PROJECT, issue: 't1', source: 'cli' });
    await manager.settle(taskId);

    const task = loadTask(taskId);
    const worktree = resolveTaskWorkdir(taskId, REPO, task?.worktree_created === true);
    expect(task?.state).toBe('REPORTED');
    expect(task?.worktree_created).toBe(true);

    expect(task?.assert_runs.map((r) => r.ran), 'B8-assert counted the wrong tree').toEqual([766]);
    expect(cwds).toEqual([worktree.dir]);

    const reviews = calls.filter((c) => c.gate === 'spec-check' || c.gate === 'tech-review');
    expect(reviews.map((c) => c.gate)).toEqual(['spec-check', 'tech-review']);
    for (const call of reviews) {
      expect(call.scope, 'a review agent was pointed at the shared checkout').toBe(worktree.dir);
      expect(call.prompt).toContain(TASK_WORK);
      expect(call.prompt, 'a review agent read another lane\'s work').not.toContain(OTHER_LANE);
    }
  });

  test('a task whose worktree vanished parks for a human instead of reporting green', async () => {
    const { port } = workingPort((record) => {
      fs.writeFileSync(path.join(record.dir, 'pricing.ts'), `export const price = "${TASK_WORK}";\n`);
      fs.rmSync(record.dir, { recursive: true, force: true });
    });
    const { exec } = countingExec();
    const manager = newOrchestrator(port, exec);

    const { taskId } = await manager.submit({ project: PROJECT, issue: 't1', source: 'cli' });
    await manager.settle(taskId);

    const task = loadTask(taskId);
    expect(task?.state).toBe('APPROVAL');
    expect(task?.pending_action).toContain('oracle');
    expect(task?.report_lines.join(' ')).toContain('the oracle did not run');
    expect(task?.report_lines.join(' ')).toContain('not there');
  });

  test('a task whose worktree registry vanished parks instead of measuring the checkout', async () => {
    const { port } = workingPort((record) => {
      fs.writeFileSync(path.join(record.dir, 'pricing.ts'), `export const price = "${TASK_WORK}";\n`);
      fs.rmSync(worktreesFile(), { force: true });
    });
    const { exec, cwds } = countingExec();
    const manager = newOrchestrator(port, exec);

    const { taskId } = await manager.submit({ project: PROJECT, issue: 't1', source: 'cli' });
    await manager.settle(taskId);

    const task = loadTask(taskId);
    expect(task?.worktree_created).toBe(true);
    expect(task?.state).toBe('APPROVAL');
    expect(task?.report_lines.join(' ')).toContain('registry entry was lost');
    expect(cwds).toEqual([]);
  });

  test('a trivial task names its lost registry even though its lane has no gates', async () => {
    const { port } = workingPort((record) => {
      fs.writeFileSync(path.join(record.dir, 'pricing.ts'), `export const price = "${TASK_WORK}";\n`);
      fs.rmSync(worktreesFile(), { force: true });
    }, 'trivial');
    const { exec, cwds } = countingExec();
    const manager = newOrchestrator(port, exec);

    const { taskId } = await manager.submit({ project: PROJECT, issue: 't1', source: 'cli' });
    await manager.settle(taskId);

    const task = loadTask(taskId);
    expect(task?.state).toBe('APPROVAL');
    expect(task?.report_lines.join(' ')).toContain('registry entry was lost');
    expect(cwds).toEqual([]);
  });
});
