import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { pathToFileURL } from 'url';
import { buildLaunchCommand, parseWorkspaceRef, sendText, waitForSession, writePromptFile } from '../lib/cmux-control';
import { cmuxStorePath, type CmuxSession } from '../lib/cmux-sessions';
import {
  assistantTexts,
  buildExecutionLaunchCommand,
  createCmuxSpawnPort,
  guardIsWired,
  lastAssistantText,
  readPaneOwnership,
  recordEndedPane,
  recordPaneAndWaitForSession,
  reserveSlot,
  waitForSlot,
  watchSession,
} from '../lib/cmux-spawn';
import { DEFAULT_CONFIG, resetConfigCache } from '../config';
import { measuredCost } from '../lib/cost';
import { managerConfigFile } from '../lib/paths';
import { resolveSpawnRunner } from '../lib/spawn';

const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cmux-spawn-')));
process.env.MANAGER_HOME = HOME;
process.env.GSTACK_HOME = HOME;
const WORK = path.join(HOME, 'worktree');
const ALIVE = process.pid;
const DEAD = 2 ** 22;

function writeStore(lifecycle: string, extra: Record<string, unknown> = {}): void {
  fs.mkdirSync(path.join(HOME, '.cmuxterm'), { recursive: true });
  fs.writeFileSync(
    cmuxStorePath('claude', HOME),
    JSON.stringify({
      sessions: {
        a: {
          sessionId: 's1',
          cwd: WORK,
          pid: ALIVE,
          agentLifecycle: lifecycle,
          transcriptPath: path.join(HOME, 'transcript.jsonl'),
          updatedAt: 100,
          startedAt: 50,
          ...extra,
        },
      },
    }),
  );
}

function writeSameDirSessions(freshLifecycle: string): void {
  fs.mkdirSync(path.join(HOME, '.cmuxterm'), { recursive: true });
  fs.writeFileSync(
    cmuxStorePath('claude', HOME),
    JSON.stringify({
      sessions: {
        stale: {
          sessionId: 'stale-sizing-session',
          cwd: WORK,
          pid: ALIVE,
          agentLifecycle: 'idle',
          transcriptPath: path.join(HOME, 'sizing.jsonl'),
          updatedAt: 300,
          startedAt: 100,
        },
        fresh: {
          sessionId: 'fresh-execution-session',
          cwd: WORK,
          pid: ALIVE,
          agentLifecycle: freshLifecycle,
          transcriptPath: path.join(HOME, 'execution.jsonl'),
          updatedAt: 200,
          startedAt: 200,
        },
      },
    }),
  );
}

function session(over: Partial<CmuxSession> = {}): CmuxSession {
  return {
    sessionId: 's1',
    surfaceId: '',
    workspaceId: '',
    cwd: WORK,
    pid: ALIVE,
    pidStartSeconds: 0,
    lifecycle: 'idle',
    transcriptPath: '',
    updatedAt: 0,
    startedAt: 0,
    subtitle: '',
    ...over,
  };
}

beforeEach(() => {
  fs.rmSync(path.join(HOME, '.cmuxterm'), { recursive: true, force: true });
  fs.rmSync(managerConfigFile(), { force: true });
  resetConfigCache();
  fs.mkdirSync(WORK, { recursive: true });
});

afterAll(() => {
  fs.rmSync(HOME, { recursive: true, force: true });
});

const FAST = { timeoutMs: 3_000, startupMs: 600, needsInputGraceMs: 300, pollMs: 30, home: HOME };

describe('pane ownership survives the run that created it', () => {
  beforeEach(() => {
    fs.rmSync(path.join(HOME, 'manager', 'panes'), { recursive: true, force: true });
  });

  test('the ownership record exists before the session waiter runs', async () => {
    const waiter = async (): Promise<null> => {
      const ownership = readPaneOwnership(['workspace:41']);
      expect(ownership[0].ownership).toBe('manager');
      if (ownership[0].ownership === 'manager') expect(ownership[0].taskId).toBe('joy-t41');
      return null;
    };
    await recordPaneAndWaitForSession('workspace:41', 'joy-t41', 'implementer', WORK, {}, waiter);
  });

  test('a fresh process can recover the task and role for an owned pane', async () => {
    await recordPaneAndWaitForSession('workspace:42', 'joy-t42', 'reviewer', WORK, {}, async () => null);
    const moduleUrl = pathToFileURL(path.resolve('personal/manager/lib/cmux-spawn.ts')).href;
    const script = `const m = await import(${JSON.stringify(moduleUrl)}); process.stdout.write(JSON.stringify(m.readPaneOwnership(['workspace:42'])))`;
    const child = spawnSync(process.execPath, ['-e', script], {
      env: { ...process.env, MANAGER_HOME: HOME },
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    expect(child.status, child.stderr).toBe(0);
    expect(JSON.parse(child.stdout)[0]).toMatchObject({ ownership: 'manager', taskId: 'joy-t42', role: 'reviewer' });
  });

  test('an unrecorded pane is unknown and is never claimed by the manager', () => {
    expect(readPaneOwnership(['workspace:999'])).toEqual([{ ownership: 'unknown', workspaceRef: 'workspace:999' }]);
  });

  test('a legacy state directory with no record is reported as unknown instead of disappearing', () => {
    const stateDir = path.join(HOME, 'manager', 'panes', 'old-task.implementer');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'prompt.txt'), 'old prompt');
    expect(readPaneOwnership()).toContainEqual(
      expect.objectContaining({ ownership: 'unknown', workspaceRef: null, recordFile: path.join(stateDir, 'pane.json') }),
    );
  });

  test('duplicate records make a workspace ref unknown instead of guessing an owner', async () => {
    await recordPaneAndWaitForSession('workspace:46', 'joy-t46-a', 'implementer', WORK, {}, async () => null);
    await recordPaneAndWaitForSession('workspace:46', 'joy-t46-b', 'reviewer', WORK, {}, async () => null);
    expect(readPaneOwnership(['workspace:46'])).toEqual([
      { ownership: 'unknown', workspaceRef: 'workspace:46', reason: 'multiple pane records claim this workspace ref' },
    ]);
  });

  test('a reusable lane belongs to its current lease rather than an ended historical run', async () => {
    const old = await recordPaneAndWaitForSession('surface:11', 'joy-old', 'implementer', WORK, {}, async () => null);
    recordEndedPane(old.record, 'success', 'no');
    await recordPaneAndWaitForSession('surface:11', 'joy-current', 'implementer', WORK, {}, async () => null);
    expect(readPaneOwnership(['surface:11'])).toEqual([
      expect.objectContaining({ ownership: 'manager', taskId: 'joy-current', workspaceRef: 'surface:11' }),
    ]);
  });

  test('a record not finalized by its run says fate unrecorded and closure unknown', async () => {
    await recordPaneAndWaitForSession('workspace:43', 'joy-t43', 'implementer', WORK, {}, async () => null);
    const ownership = readPaneOwnership(['workspace:43'])[0];
    expect(ownership.ownership).toBe('manager');
    if (ownership.ownership === 'manager') {
      expect(ownership.record.fate).toBe('unrecorded');
      expect(ownership.record.paneClosed).toBe('unknown');
    }
  });

  test('finalization distinguishes a deliberately kept pane from a closed pane', async () => {
    const kept = await recordPaneAndWaitForSession('workspace:44', 'joy-t44', 'implementer', WORK, {}, async () => null);
    recordEndedPane(kept.record, 'needs_input', 'no');
    const closed = await recordPaneAndWaitForSession('workspace:45', 'joy-t45', 'implementer', WORK, {}, async () => null);
    recordEndedPane(closed.record, 'success', 'yes');
    const ownership = readPaneOwnership(['workspace:44', 'workspace:45']);
    expect(ownership[0].ownership === 'manager' && ownership[0].record.paneClosed).toBe('no');
    expect(ownership[1].ownership === 'manager' && ownership[1].record.paneClosed).toBe('yes');
  });
});

describe('lane-backed cmux execution', () => {
  function configureLane(enabled: boolean, closeOnSuccess = false): void {
    fs.mkdirSync(path.dirname(managerConfigFile()), { recursive: true });
    fs.writeFileSync(
      managerConfigFile(),
      JSON.stringify({
        cmuxRoles: ['main'],
        cmuxSkipPermissions: false,
        cmuxLaneWorkspace: enabled ? 'improve-harness' : '',
        cmuxLaneTitles: ['L1'],
        cmuxCloseOnSuccess: closeOnSuccess,
        maxAgents: 4,
      }),
    );
    resetConfigCache();
  }

  function worktree(taskId: string) {
    return {
      ok: true as const,
      reason: '',
      reused: false,
      record: {
        taskId,
        project: 'fixture',
        repo: '/tmp/repo',
        dir: `/tmp/${taskId}-work`,
        branch: `manager/${taskId}`,
        baseSha: 'abc',
        createdAt: new Date().toISOString(),
      },
    };
  }

  async function runLaneOutcome(
    health: 'finished' | 'blocked' | 'aborted' | 'budget-exhausted',
    taskId: string,
    events: string[],
  ) {
    configureLane(true);
    const lane = { title: 'L1', surfaceRef: 'surface:11', workspaceRef: 'workspace:7', foreground: 'shell' as const };
    const port = createCmuxSpawnPort({
      cmuxAvailable: () => true,
      createWorkspace: () => ({ ok: false, ref: '', reason: 'must not create' }),
      ensureTaskWorktree: () => worktree(taskId),
      fleet: () => ({ ok: true, entries: [] }),
      waitForSession: async () => null,
      watchSession: async () => ({ health, everWorked: true, turns: 1, transcriptPath: '' }),
      reserveLane: async () => ({ outcome: 'reserved', lane, release: () => events.push('release') }),
      cmux: (args) => {
        if (args[0] === 'send-key' && args.at(-1) === 'ctrl+c') events.push('interrupt');
        if (events.includes('interrupt') && args[0] === 'send' && args.at(-1) === '/exit') events.push('exit');
        if (events.includes('exit') && args[0] === 'send-key' && args.at(-1) === 'Enter') events.push('exit-enter');
        return { ok: true, stdout: args[0] === 'read-screen' ? '$' : '', stderr: '' };
      },
    });
    return port.run({
      role: 'main',
      taskId,
      project: 'fixture',
      issue: 'route it',
      scope: '/tmp/repo',
      source: 'cli',
      prompt: 'work',
      modelAlias: 'sonnet',
      maxBudgetUsd: 1,
    });
  }

  async function runWorkspaceOutcome(
    health: 'finished' | 'blocked' | 'aborted' | 'budget-exhausted',
    taskId: string,
    closeOnSuccess: boolean,
    closed: string[],
  ) {
    configureLane(false, closeOnSuccess);
    const port = createCmuxSpawnPort({
      cmuxAvailable: () => true,
      createWorkspace: () => ({ ok: true, ref: `workspace:${taskId.length}`, reason: '' }),
      closeWorkspace: (ref) => {
        closed.push(ref);
        return { ok: true, stdout: '', stderr: '' };
      },
      ensureTaskWorktree: () => worktree(taskId),
      fleet: () => ({ ok: true, entries: [] }),
      waitForSession: async () => null,
      watchSession: async () => ({ health, everWorked: true, turns: 1, transcriptPath: '' }),
      cmux: () => ({ ok: true, stdout: '', stderr: '' }),
    });
    return port.run({
      role: 'main',
      taskId,
      project: 'fixture',
      issue: 'route it',
      scope: '/tmp/repo',
      source: 'cli',
      prompt: 'work',
      modelAlias: 'sonnet',
      maxBudgetUsd: 1,
    });
  }

  test('a codex cmux run completes from JSONL without waiting for a Claude session', async () => {
    const taskId = 'codex-task';
    const taskDir = path.join(HOME, `${taskId}-work`);
    fs.mkdirSync(taskDir, { recursive: true });
    const fakeCodex = path.join(HOME, 'fake-codex');
    fs.writeFileSync(
      fakeCodex,
      [
        '#!/bin/sh',
        `printf '%s\\n' '${JSON.stringify({ type: 'thread.started', thread_id: 'codex-thread' })}'`,
        `printf '%s\\n' '${JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'bun test focused' } })}'`,
        `printf '%s\\n' '${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Done.\n```json\n{"verdict":"pass","reason":"sized","root_cause":"","gates":[],"findings":[],"advisories":[],"assumptions":[],"questions":[],"irreversible":[]}\n```' } })}'`,
        `printf '%s\\n' '${JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 12, output_tokens: 8 } })}'`,
      ].join('\n'),
    );
    fs.chmodSync(fakeCodex, 0o700);
    fs.mkdirSync(path.dirname(managerConfigFile()), { recursive: true });
    fs.writeFileSync(
      managerConfigFile(),
      JSON.stringify({
        spawnRunner: 'cmux',
        executionProvider: 'codex',
        reviewProvider: 'opus-fresh',
        cmuxCodexBin: fakeCodex,
        cmuxRoles: ['main'],
        cmuxLaneWorkspace: '',
        maxAgents: 4,
      }),
    );
    resetConfigCache();
    let waitedForClaude = false;
    let launch = '';
    const port = createCmuxSpawnPort({
      cmuxAvailable: () => true,
      createWorkspace: (opts) => {
        launch = opts.command;
        const completed = spawnSync('/bin/zsh', ['-lc', opts.command], { cwd: opts.cwd, encoding: 'utf-8' });
        return completed.status === 0
          ? { ok: true, ref: 'workspace:81', reason: '' }
          : { ok: false, ref: '', reason: completed.stderr || 'launch failed' };
      },
      ensureTaskWorktree: () => ({
        ...worktree(taskId),
        record: { ...worktree(taskId).record, dir: taskDir },
      }),
      fleet: () => ({ ok: true, entries: [] }),
      waitForSession: async () => {
        waitedForClaude = true;
        return null;
      },
      watchSession: async () => {
        throw new Error('Codex must not use the Claude session watcher');
      },
      cmux: () => ({ ok: true, stdout: '', stderr: '' }),
    });
    const result = await port.run({
      role: 'main',
      taskId,
      project: 'fixture',
      issue: 'route it',
      scope: '/tmp/repo',
      source: 'cli',
      prompt: 'size this issue',
      modelAlias: 'sonnet',
    });
    expect(launch).toContain('exec -s workspace-write -a never --json');
    expect(waitedForClaude).toBe(false);
    expect(result).toMatchObject({
      exitReason: 'success',
      model: 'codex',
      sessionId: 'codex-thread',
      turnsUsed: 1,
      costKnown: false,
    });
    expect(result.output).toContain('"verdict":"pass"');
  });

  test('launches in a discovered surface and never creates or closes a workspace', async () => {
    fs.mkdirSync(path.dirname(managerConfigFile()), { recursive: true });
    fs.writeFileSync(
      managerConfigFile(),
      JSON.stringify({
        cmuxRoles: ['main'],
        cmuxSkipPermissions: false,
        cmuxLaneWorkspace: 'improve-harness',
        cmuxLaneTitles: ['L1', 'L2', 'L3', 'L4'],
        maxAgents: 4,
      }),
    );
    resetConfigCache();
    const calls: string[][] = [];
    let created = 0;
    const cmux = (args: string[]) => {
      calls.push(args);
      if (args[0] === 'list-workspaces') return { ok: true, stdout: 'workspace:7 improve-harness', stderr: '' };
      if (args[0] === 'list-panes') return { ok: true, stdout: 'pane:1 L1', stderr: '' };
      if (args[0] === 'list-pane-surfaces') return { ok: true, stdout: 'surface:11 L1', stderr: '' };
      if (args[0] === 'read-screen') return { ok: true, stdout: '$', stderr: '' };
      return { ok: true, stdout: '', stderr: '' };
    };
    const port = createCmuxSpawnPort({
      cmuxAvailable: () => true,
      createWorkspace: () => {
        created += 1;
        return { ok: false, ref: '', reason: 'must not create' };
      },
      ensureTaskWorktree: () => ({
        ok: true,
        reason: '',
        reused: false,
        record: {
          taskId: 'lane-task',
          project: 'fixture',
          repo: '/tmp/repo',
          dir: '/tmp/lane-task-work',
          branch: 'manager/lane-task',
          baseSha: 'abc',
          createdAt: new Date().toISOString(),
        },
      }),
      fleet: () => ({ ok: true, entries: [] }),
      waitForSession: async () => null,
      watchSession: async () => ({ health: 'finished', everWorked: true, turns: 1, transcriptPath: '' }),
      cmux,
    });
    const result = await port.run({
      role: 'main',
      taskId: 'lane-task',
      project: 'fixture',
      issue: 'route it',
      scope: '/tmp/repo',
      source: 'cli',
      prompt: 'work',
      modelAlias: 'sonnet',
      maxBudgetUsd: 1,
    });
    expect(result.exitReason).toBe('success');
    expect(created).toBe(0);
    expect(calls).toContainEqual(expect.arrayContaining(['send', '--surface', 'surface:11']));
    expect(calls).toContainEqual(['send-key', '--surface', 'surface:11', 'Enter']);
    fs.rmSync(managerConfigFile(), { force: true });
    resetConfigCache();
  });

  test('an ordinary completed lane run exits the process before releasing the lane', async () => {
    const events: string[] = [];
    const result = await runLaneOutcome('finished', 'lane-finished', events);
    expect(result.exitReason).toBe('success');
    expect(events).toEqual(['interrupt', 'exit', 'exit-enter', 'release']);
  });

  test('a terminal lane run exits Claude before releasing the lane', async () => {
    const events: string[] = [];
    await runLaneOutcome('blocked', 'lane-exit', events);
    expect(events).toEqual(['interrupt', 'exit', 'exit-enter', 'release']);
  });

  test.each(['aborted', 'budget-exhausted'] as const)(
    'a lane run ending as %s still exits before release',
    async (health) => {
      const events: string[] = [];
      await runLaneOutcome(health, `lane-${health}`, events);
      expect(events).toEqual(['interrupt', 'exit', 'exit-enter', 'release']);
    },
  );

  test('non-lane keep-open and close decisions are unchanged', async () => {
    const failedClosed: string[] = [];
    const failed = await runWorkspaceOutcome('blocked', 'workspace-blocked', true, failedClosed);
    expect(failed.exitReason).toBe('blocked_on_permission');
    expect(failedClosed).toEqual([]);

    const abortedClosed: string[] = [];
    await runWorkspaceOutcome('aborted', 'workspace-aborted', false, abortedClosed);
    expect(abortedClosed).toHaveLength(1);

    const budgetClosed: string[] = [];
    await runWorkspaceOutcome('budget-exhausted', 'workspace-budget', false, budgetClosed);
    expect(budgetClosed).toHaveLength(1);

    const successClosed: string[] = [];
    await runWorkspaceOutcome('finished', 'workspace-success', true, successClosed);
    expect(successClosed).toHaveLength(1);
  });
});

describe('watching a pane to a state worth reporting', () => {
  // A freshly-hooked session is idle for the moment between registering and
  // taking its first turn. A watcher that trusted that would hand back an
  // empty transcript as a successful run — a measurement that looks fine and
  // is not, which is the failure this whole layer exists to prevent.
  test('idle-at-boot is never read as done', async () => {
    writeStore('idle');
    const outcome = await watchSession(WORK, FAST);
    expect(outcome.health).toBe('never-started');
    expect(outcome.everWorked).toBe(false);
  });

  test('idle AFTER work is done', async () => {
    writeStore('running');
    setTimeout(() => writeStore('idle'), 120);
    const outcome = await watchSession(WORK, FAST);
    expect(outcome.health).toBe('finished');
    expect(outcome.everWorked).toBe(true);
  });

  test('waitForSession searches past a stale same-directory session from the prior agent', async () => {
    writeSameDirSessions('running');
    const found = await waitForSession(WORK, { home: HOME, startedAfter: 150, timeoutMs: 100, pollMs: 10 });
    expect(found?.sessionId).toBe('fresh-execution-session');
  });

  test('watcher follows the booted session when an older agent shares the worktree', async () => {
    writeSameDirSessions('running');
    setTimeout(() => writeSameDirSessions('idle'), 120);
    const outcome = await watchSession(WORK, { ...FAST, sessionId: 'fresh-execution-session' });
    expect(outcome.health).toBe('finished');
    expect(outcome.transcriptPath).toBe(path.join(HOME, 'execution.jsonl'));
  });

  test('a dead pid recorded as running is a crash, reported as one', async () => {
    writeStore('running');
    setTimeout(() => writeStore('running', { pid: DEAD }), 120);
    expect((await watchSession(WORK, FAST)).health).toBe('crashed');
  });

  // The observed case: a pane sat at needsInput for hours and nothing said so.
  test('needsInput past the grace period hands the task back instead of waiting forever', async () => {
    writeStore('running');
    setTimeout(() => writeStore('needsInput'), 100);
    const outcome = await watchSession(WORK, FAST);
    expect(outcome.health).toBe('waiting');
  });

  // Waiting out the full 45-minute run timeout on a permission prompt costs
  // three quarters of an hour to learn what was true in the first second.
  test('a pane stuck on a permission prompt is handed back, not waited out', async () => {
    writeStore('running');
    setTimeout(() => writeStore('running', { lastSubtitle: 'Permission' }), 100);
    const outcome = await watchSession(WORK, { ...FAST, timeoutMs: 30_000 });
    expect(outcome.health).toBe('blocked');
  });

  // A question the agent answers itself is not a question for a human.
  test('a brief needsInput that resolves on its own does not end the run', async () => {
    writeStore('running');
    setTimeout(() => writeStore('needsInput'), 60);
    setTimeout(() => writeStore('running'), 180);
    setTimeout(() => writeStore('idle'), 500);
    const outcome = await watchSession(WORK, { ...FAST, needsInputGraceMs: 400 });
    expect(outcome.health).toBe('finished');
  });

  test('a session that never registers at all times out on startup, not on the long clock', async () => {
    const started = Date.now();
    const outcome = await watchSession(WORK, FAST);
    expect(outcome.health).toBe('never-started');
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  test('an unreadable fleet ends the watch explicitly instead of becoming a missing session', async () => {
    fs.mkdirSync(cmuxStorePath('claude', HOME), { recursive: true });
    const outcome = await watchSession(WORK, FAST);
    expect(outcome).toMatchObject({ health: 'fleet-unreadable', reason: expect.stringContaining('EISDIR') });
  });

  test('stop is honoured mid-run', async () => {
    writeStore('running');
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    expect((await watchSession(WORK, { ...FAST, timeoutMs: 30_000, signal: controller.signal })).health).toBe('aborted');
  });

  test('an agent that never stops is cut off by the run timeout', async () => {
    writeStore('running');
    const outcome = await watchSession(WORK, { ...FAST, timeoutMs: 400, startupMs: 400 });
    expect(outcome.health).toBe('timeout');
  });

  test('a running pane is stopped when transcript cost exhausts its reservation', async () => {
    writeStore('running');
    fs.writeFileSync(
      path.join(HOME, 'transcript.jsonl'),
      `${JSON.stringify({ message: { model: 'claude-opus-4-7', usage: { input_tokens: 0, output_tokens: 1_000_000 } } })}\n`,
    );
    const outcome = await watchSession(WORK, { ...FAST, timeoutMs: 400, startupMs: 400, maxBudgetUsd: 0.01 });
    expect(outcome.health).toBe('budget-exhausted');
  });
});

describe('the agent cap counts panes the manager never started', () => {
  test('concurrent admissions cannot claim the same final slot', async () => {
    const emptyFleet = () => ({ ok: true as const, entries: [] });
    const first = await reserveSlot(1, 'first', { fleet: emptyFleet, pollMs: 10, timeoutMs: 40 });
    const second = await reserveSlot(1, 'second', { fleet: emptyFleet, pollMs: 10, timeoutMs: 40 });
    expect(first.outcome).toBe('reserved');
    expect(second.outcome).toBe('timeout');
    if (first.outcome === 'reserved') first.release();
    const third = await reserveSlot(1, 'third', { fleet: emptyFleet, pollMs: 10, timeoutMs: 40 });
    expect(third.outcome).toBe('reserved');
    if (third.outcome === 'reserved') third.release();
  });

  test('a free machine lets a spawn through', async () => {
    writeStore('idle');
    expect(await waitForSlot(2, { home: HOME, pollMs: 20 })).toBe('free');
  });

  // The operator's own panes count toward the cap, which is the point — and
  // also why the wait has to end. Manager spawns free their seats eventually;
  // a person with eight panes open does not, and an unbounded wait there is a
  // task that never starts and never says why.
  test('a full machine gives up with a timeout rather than waiting forever', async () => {
    writeStore('running');
    expect(await waitForSlot(1, { home: HOME, pollMs: 20, timeoutMs: 150 })).toBe('timeout');
  });

  test('an unreadable fleet refuses admission with its read error instead of granting a slot', async () => {
    fs.mkdirSync(cmuxStorePath('claude', HOME), { recursive: true });
    expect(
      await waitForSlot(2, {
        home: HOME,
        now: () => 0,
      }),
    ).toMatchObject({ outcome: 'unreadable', reason: expect.stringContaining('EISDIR') });
  });

  test('stop is honoured while queued for a slot', async () => {
    writeStore('running');
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 60);
    expect(await waitForSlot(1, { home: HOME, pollMs: 20, timeoutMs: 30_000, signal: controller.signal })).toBe('aborted');
  });
});

describe('the prompt never gets typed into a TUI', () => {
  test('the launch command reads the prompt from a file, as one argument', () => {
    const file = writePromptFile(path.join(HOME, 'pane'), 'line one\nline two\n"quoted" $(rm -rf /)');
    const cmd = buildLaunchCommand({ claudeBin: 'claude', promptFile: file, model: 'claude-opus-4-7' });
    expect(cmd).toContain(`"$(cat '${file}')"`);
    expect(cmd).toContain("--model 'claude-opus-4-7'");
    // The prompt's own text is nowhere on the command line, so nothing in it
    // is ever parsed by the shell.
    expect(cmd).not.toContain('rm -rf');
    expect(fs.readFileSync(file, 'utf-8')).toContain('$(rm -rf /)');
  });

  test('the prompt file is not world-readable', () => {
    const file = writePromptFile(path.join(HOME, 'pane2'), 'secret-ish');
    expect(fs.statSync(file).mode & 0o077).toBe(0);
  });

  test('extra flags land before the prompt, so they are flags and not text', () => {
    const file = writePromptFile(path.join(HOME, 'pane3'), 'hi');
    const cmd = buildLaunchCommand({ claudeBin: 'claude', promptFile: file, extraArgs: ['--dangerously-skip-permissions'] });
    expect(cmd.indexOf('--dangerously-skip-permissions')).toBeLessThan(cmd.indexOf('$(cat'));
  });

  test('a codex execution config builds an unattended sandboxed one-shot command', () => {
    const file = writePromptFile(path.join(HOME, 'pane-codex'), 'implement this\nthen emit the verdict block');
    const cmd = buildExecutionLaunchCommand(
      { ...DEFAULT_CONFIG, executionProvider: 'codex', cmuxCodexBin: 'codex-custom' },
      file,
      'sonnet',
    );
    expect(cmd).toStartWith("'codex-custom' exec -s workspace-write -a never --json -c model_reasoning_effort=high");
    expect(cmd).toContain(`"$(cat '${file}')"`);
    expect(cmd).not.toContain('--dangerously-skip-permissions');
    expect(cmd).not.toContain('--model');
  });

  // Nothing that reaches the builder is user or agent text — it is a binary
  // name and a model id from config, and a path the manager built. A value
  // needing an escape means something arrived from somewhere it should not
  // have, and the useful response to that is to stop rather than to escape it
  // correctly forever.
  test('a metacharacter anywhere on the launch line is refused, not escaped', () => {
    const file = writePromptFile(path.join(HOME, 'pane4'), 'hi');
    expect(() => buildLaunchCommand({ claudeBin: "claude'; rm -rf ~; '", promptFile: file })).toThrow(/refusing/);
    expect(() => buildLaunchCommand({ claudeBin: 'claude', promptFile: file, model: "o$(id)" })).toThrow(/refusing/);
    expect(() => buildLaunchCommand({ claudeBin: 'claude', promptFile: file, extraArgs: ['--x`id`'] })).toThrow(/refusing/);
    expect(() => buildLaunchCommand({ claudeBin: 'claude', promptFile: "/tmp/it's/prompt.txt" })).toThrow(/refusing/);
  });
});

describe('sending text into a live pane', () => {
  test('refuses mid-turn: characters would land inside whatever the agent is doing', () => {
    const result = sendText('workspace:1', 'yes', session({ lifecycle: 'running' }));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('running');
  });

  test('refuses a newline: it would submit early and leave the tail as a second instruction', () => {
    const result = sendText('workspace:1', 'do this\nand that', session({ lifecycle: 'idle' }));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('newline');
  });

  test('refuses when no session is attached at all', () => {
    expect(sendText('workspace:1', 'hello', null).ok).toBe(false);
  });
});

describe('the guard has to exist before a permission-free pane is allowed', () => {
  const settings = (body: unknown): string => {
    const file = path.join(HOME, `settings-${Math.abs(JSON.stringify(body).length)}.json`);
    fs.writeFileSync(file, JSON.stringify(body));
    return file;
  };

  test('wired when a PreToolUse hook runs the guard on Edit and Write', () => {
    const file = settings({
      hooks: {
        PreToolUse: [
          { matcher: 'Bash|Edit|Write', hooks: [{ type: 'command', command: 'bash "$HOME/personal/hooks/pre-tool-use-guard.sh"' }] },
        ],
      },
    });
    expect(guardIsWired(file)).toBe(true);
  });

  // §7.3b lesson 1: a directive is not a fence. --dangerously-skip-permissions
  // with no guard behind it is a sentence in a prompt standing in for one.
  test('not wired when the hook covers Bash only', () => {
    const file = settings({
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'bash pre-tool-use-guard.sh' }] }] },
    });
    expect(guardIsWired(file)).toBe(false);
  });

  test('not wired when the hook is some other script', () => {
    const file = settings({
      hooks: { PreToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'bash something-else.sh' }] }] },
    });
    expect(guardIsWired(file)).toBe(false);
  });

  test('a missing or unreadable settings file reads as not wired', () => {
    expect(guardIsWired(path.join(HOME, 'nope.json'))).toBe(false);
  });
});

describe('reading back what the agent said', () => {
  const transcript = path.join(HOME, 'out.jsonl');

  test('the last assistant text is the run output, tool calls skipped', () => {
    fs.writeFileSync(
      transcript,
      [
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'thinking out loud' }] } }),
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read' }] } }),
        JSON.stringify({ type: 'user', message: { content: 'nope' } }),
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'VERDICT: pass' }] } }),
        'garbage that is not json',
      ].join('\n'),
    );
    expect(lastAssistantText(transcript)).toBe('VERDICT: pass');
  });

  test('assistant texts contain every non-empty message newest first', () => {
    fs.writeFileSync(
      transcript,
      [
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'thinking out loud' }] } }),
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read' }] } }),
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'VERDICT: pass' }] } }),
      ].join('\n'),
    );
    expect(assistantTexts(transcript)).toEqual(['VERDICT: pass', 'thinking out loud']);
  });

  test('a transcript that is not there reads as empty, not as a throw', () => {
    expect(lastAssistantText(path.join(HOME, 'missing.jsonl'))).toBe('');
  });
});

describe('cost separates "free" from "nobody knows"', () => {
  // estimateCostUsd collapses both to 0. That is fine for a test harness and
  // wrong for a ceiling: unpriced runs make the machine look like it spent
  // nothing all day, and the first thing anyone does with that number is raise
  // the limit.
  // Deliberately a model that cannot ever exist. Naming a real unpriced model
  // here made the test assert the table's gaps rather than the behaviour, so it
  // broke the day that model got a price.
  test('an unpriced model reports unknown, not zero', () => {
    const cost = measuredCost({ input_tokens: 500_000, output_tokens: 100_000 }, 'claude-not-a-model');
    expect(cost.known).toBe(false);
    expect(cost.usd).toBe(0);
    expect(cost.model).toBe('claude-not-a-model');
  });

  test('a priced model bills cache writes above plain input, not at the same rate', () => {
    const plain = measuredCost({ input_tokens: 1_000_000 }, 'claude-opus-4-7');
    const written = measuredCost({ cache_creation_input_tokens: 1_000_000 }, 'claude-opus-4-7');
    const read = measuredCost({ cache_read_input_tokens: 1_000_000 }, 'claude-opus-4-7');
    expect(plain.usd).toBe(5);
    expect(written.usd).toBeGreaterThan(plain.usd);
    expect(read.usd).toBeLessThan(plain.usd);
  });

  test('no model at all is unknown rather than free', () => {
    expect(measuredCost({ input_tokens: 100 }, '').known).toBe(false);
  });
});

describe('choosing where an agent runs', () => {
  function withConfig(body: Record<string, unknown> | null): void {
    fs.mkdirSync(path.dirname(managerConfigFile()), { recursive: true });
    if (body) fs.writeFileSync(managerConfigFile(), JSON.stringify(body));
    else fs.rmSync(managerConfigFile(), { force: true });
    resetConfigCache();
  }

  afterAll(() => {
    delete process.env.MANAGER_SPAWN_RUNNER;
    withConfig(null);
  });

  test('the SDK runner is what you get by default', () => {
    delete process.env.MANAGER_SPAWN_RUNNER;
    withConfig(null);
    expect(resolveSpawnRunner()).toBe('sdk');
  });

  test('config picks the runner when no env var says otherwise', () => {
    delete process.env.MANAGER_SPAWN_RUNNER;
    withConfig({ spawnRunner: 'cmux' });
    expect(resolveSpawnRunner()).toBe('cmux');
  });

  // So one daemon can be tried on cmux without changing what every other entry
  // point on the machine does.
  test('the env var beats config', () => {
    withConfig({ spawnRunner: 'cmux' });
    process.env.MANAGER_SPAWN_RUNNER = 'cli';
    expect(resolveSpawnRunner()).toBe('cli');
  });

  // A typo in an env var should not take the daemon down, and the runner in
  // use is printed at boot either way.
  test('an unrecognised name falls back to the SDK instead of throwing', () => {
    withConfig(null);
    process.env.MANAGER_SPAWN_RUNNER = 'warp';
    expect(resolveSpawnRunner()).toBe('sdk');
  });
});

describe('parsing what cmux prints back', () => {
  test('the workspace ref survives a leading notice line', () => {
    expect(parseWorkspaceRef("cmux: 'new-workspace' is now an alias\nOK workspace:21")).toBe('workspace:21');
  });

  test('no ref in the output is an empty string, not a wrong guess', () => {
    expect(parseWorkspaceRef('some error happened')).toBe('');
  });
});

describe('readScreen distinguishes a failed read from a genuinely empty pane', () => {
  const controlUrl = pathToFileURL(path.resolve('personal/manager/lib/cmux-control.ts')).href;
  const spawnUrl = pathToFileURL(path.resolve('personal/manager/lib/cmux-spawn.ts')).href;
  const moduleUrl = (relativePath: string): string => pathToFileURL(path.resolve(relativePath)).href;

  function isolatedReadScreen(cmuxBin: string): { ok: boolean; screen?: string; error?: string } {
    const script = `const { readScreen } = await import(${JSON.stringify(controlUrl)}); process.stdout.write(JSON.stringify(readScreen('workspace:77'))) `;
    const child = spawnSync(process.execPath, ['-e', script], {
      env: { ...process.env, MANAGER_CMUX_BIN: cmuxBin },
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    expect(child.status, child.stderr).toBe(0);
    return JSON.parse(child.stdout);
  }

  function isolatedOperatorOutput(screenResult: { ok: boolean; screen?: string; error?: string }): string {
    const configUrl = moduleUrl('personal/manager/config.ts');
    const sessionsUrl = moduleUrl('personal/manager/lib/cmux-sessions.ts');
    const pathsUrl = moduleUrl('personal/manager/lib/paths.ts');
    const runnerUrl = moduleUrl('personal/manager/lib/spawn.ts');
    const worktreesUrl = moduleUrl('personal/manager/lib/worktrees.ts');
    const costUrl = moduleUrl('personal/manager/lib/cost.ts');
    const script = `
      import { mock } from 'bun:test';
      mock.module(${JSON.stringify(configUrl)}, () => ({
        loadConfig: () => ({ cmuxRoles: ['implementer'], cmuxSkipPermissions: false, worktreeLinks: [], cmuxSlotWaitMs: 1, cmuxClaudeArgs: [], cmuxClaudeBin: 'claude', cmuxLaneWorkspace: '', cmuxLaneTitles: ['L1', 'L2', 'L3', 'L4'], cmuxStartupMs: 1, cmuxRunTimeoutMs: 1, cmuxNeedsInputGraceMs: 1, cmuxCloseOnSuccess: false }),
        resolveMaxAgents: () => 1,
        resolveModelId: () => 'model',
        resolveProjectConcurrency: () => 1
      }));
      mock.module(${JSON.stringify(controlUrl)}, () => ({
        buildLaunchCommand: () => 'launch',
        closeWorkspace: () => ({ ok: true, stdout: '', stderr: '' }),
        cmuxAvailable: () => true,
        createWorkspace: () => ({ ok: true, ref: 'workspace:77', reason: '' }),
        readScreen: () => (${JSON.stringify(screenResult)}),
        runCmux: () => ({ ok: true, stdout: '', stderr: '' }),
        sessionInDir: () => null,
        shellSafePath: () => true,
        singleQuote: (value) => "'" + value + "'",
        sleep: async () => {},
        waitForSession: async () => ({ sessionId: 's', transcriptPath: '', cwd: '/tmp/cmux-test-work' }),
        writePromptFile: () => '/tmp/prompt'
      }));
      mock.module(${JSON.stringify(sessionsUrl)}, () => ({
        busyCount: () => 0,
        fleet: () => ({ ok: true, entries: [{ sessionId: 's', cwd: '/tmp/cmux-test-work', transcriptPath: '' }] }),
        healthOf: () => 'crashed',
        needsHuman: () => false,
        usageFromTranscript: () => ({ turns: 0 })
      }));
      mock.module(${JSON.stringify(pathsUrl)}, () => ({ atomicWriteJson: () => {}, managerDir: () => '/tmp/cmux-test-manager' }));
      mock.module(${JSON.stringify(runnerUrl)}, () => ({ agentSdkSpawnPort: { run: async () => { throw new Error('unexpected SDK run'); } }, scopeDirective: () => 'scope' }));
      mock.module(${JSON.stringify(worktreesUrl)}, () => ({
        cloneNodeModules: () => ({ ok: true, reason: '' }),
        ensureTaskWorktree: () => ({ ok: true, record: { dir: '/tmp/cmux-test-work' } })
      }));
      mock.module(${JSON.stringify(costUrl)}, () => ({ measuredCost: () => ({ usd: 0, known: false, model: '' }) }));
      const { cmuxSpawnPort } = await import(${JSON.stringify(`${spawnUrl}?operator-output-test`)});
      const result = await cmuxSpawnPort.run({ role: 'implementer', taskId: 't', project: 'p', issue: 'i', scope: '/tmp/cmux-test-work', source: 'cli', prompt: 'x', modelAlias: 'm' });
      process.stdout.write(result.output);
    `;
    const child = spawnSync(process.execPath, ['-e', script], { stdio: 'pipe', encoding: 'utf-8' });
    expect(child.status, child.stderr).toBe(0);
    return child.stdout;
  }

  test('a failed screen read reports the read error to the operator', () => {
    const result = isolatedReadScreen('/usr/bin/false');
    expect(result).toEqual({ ok: false, error: 'cmux read-screen failed' });
    expect(isolatedOperatorOutput(result)).toBe(
      'cmux pane workspace:77 ended as "crashed": screen was unreadable (cmux read-screen failed)',
    );
  });

  test('a successful empty screen reports an empty transcript to the operator', () => {
    const result = isolatedReadScreen('/usr/bin/true');
    expect(result).toEqual({ ok: true, screen: '' });
    expect(isolatedOperatorOutput(result)).toBe('cmux pane workspace:77 ended as "crashed" with nothing in its transcript.');
  });
});
