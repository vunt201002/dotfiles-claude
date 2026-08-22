import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-')));
process.env.MANAGER_HOME = HOME;

const { cmuxStorePath } = await import('../lib/cmux-sessions');
const { fleetReport, renderFleet } = await import('../lib/fleet-view');
const { worktreesFile } = await import('../lib/worktrees');
const { atomicWriteJson } = await import('../lib/paths');
const { saveTask } = await import('../lib/store');
const { ACTIVE_STATES } = await import('../types');
const { taskRecord } = await import('./fixtures');
type TaskState = import('../types').TaskState;

const ALIVE = process.pid;
const DEAD = 2 ** 22;
const MINE = path.join(HOME, 'wt', 'joy-t1-01');
const YOURS = path.join(HOME, 'repos', 'wishlist');

interface StoreSession {
  sessionId: string;
  cwd: string;
  pid: number;
  agentLifecycle: string;
  transcriptPath?: string;
  lastSubtitle?: string;
  updatedAt?: number;
  startedAt?: number;
}

function writeStore(sessions: StoreSession[]): void {
  fs.mkdirSync(path.join(HOME, '.cmuxterm'), { recursive: true });
  const byId = Object.fromEntries(
    sessions.map((s, i) => [
      String(i),
      { updatedAt: Date.now() / 1000, startedAt: 900, transcriptPath: '', lastSubtitle: '', ...s },
    ]),
  );
  fs.writeFileSync(cmuxStorePath('claude', HOME), JSON.stringify({ sessions: byId }));
}

function writeTranscript(name: string, model: string, turns = 2): string {
  const file = path.join(HOME, `${name}.jsonl`);
  fs.writeFileSync(
    file,
    Array.from({ length: turns }, () =>
      JSON.stringify({ message: { model, usage: { input_tokens: 1000, output_tokens: 500 } } }),
    ).join('\n'),
  );
  return file;
}

function registerWorktree(taskId: string, dir: string): void {
  atomicWriteJson(worktreesFile(), {
    [taskId]: {
      taskId,
      project: 'joy',
      repo: path.join(HOME, 'repos', 'joy'),
      dir,
      branch: `manager/${taskId}`,
      baseSha: 'abc123',
      createdAt: new Date().toISOString(),
    },
  });
}

function seedTask(id: string, state: TaskState): void {
  saveTask(taskRecord({
    id,
    state,
    project: 'joy',
    scope: MINE,
  }));
}

beforeEach(() => {
  fs.rmSync(path.join(HOME, '.cmuxterm'), { recursive: true, force: true });
  fs.rmSync(path.join(HOME, 'manager'), { recursive: true, force: true });
  fs.mkdirSync(MINE, { recursive: true });
  fs.mkdirSync(YOURS, { recursive: true });
});

afterAll(() => {
  fs.rmSync(HOME, { recursive: true, force: true });
});

describe('the fleet is every agent on the machine, not every task the manager started', () => {
  // `manager status` answers "what did I give the manager". That is a strictly
  // smaller set than the agents that exist, and the missing ones spend money
  // and hold cores without appearing in any number the manager reports.
  test('a pane the operator opened by hand is in the report, marked as theirs', () => {
    registerWorktree('joy-t1-01', MINE);
    writeStore([
      { sessionId: 'mine', cwd: MINE, pid: ALIVE, agentLifecycle: 'running' },
      { sessionId: 'yours', cwd: YOURS, pid: ALIVE, agentLifecycle: 'running' },
    ]);
    const report = fleetReport({ home: HOME });
    expect(report.members).toHaveLength(2);
    expect(report.members.find((m) => m.sessionId === 'mine')!.managerOwned).toBe(true);
    expect(report.members.find((m) => m.sessionId === 'yours')!.managerOwned).toBe(false);
    expect(report.busy).toBe(2);
  });

  test('needsInput is pulled out on its own, because that is the line a human has to act on', () => {
    writeStore([
      { sessionId: 'busy', cwd: YOURS, pid: ALIVE, agentLifecycle: 'running' },
      { sessionId: 'asking', cwd: MINE, pid: ALIVE, agentLifecycle: 'needsInput', lastSubtitle: 'Ghi đè file?' },
    ]);
    const report = fleetReport({ home: HOME });
    expect(report.waiting.map((m) => m.sessionId)).toEqual(['asking']);
    const text = renderFleet(report);
    expect(text.indexOf('WAITING ON YOU')).toBeLessThan(text.indexOf('▶'));
  });

  // Read straight off the live store: a pane showed `lastSubtitle: "Permission"`
  // with `agentLifecycle: "running"` for five hours. Lifecycle alone reads that
  // as healthy work in progress forever.
  test('a pane stuck on a permission prompt is a human blocking, not work in progress', () => {
    writeStore([
      { sessionId: 'perm', cwd: MINE, pid: ALIVE, agentLifecycle: 'running', lastSubtitle: 'Permission' },
    ]);
    const report = fleetReport({ home: HOME });
    expect(report.waiting.map((m) => m.sessionId)).toEqual(['perm']);
    expect(report.busy).toBe(1);
    expect(renderFleet(report)).toContain('stuck on a permission prompt');
  });

  // Releasing the seat must not also hide the pane: the operator is the only
  // one who can close it, and they cannot close what the report stopped showing.
  test('a pane abandoned at a prompt stops counting as busy but stays in the report', () => {
    const longAgo = Date.now() / 1000 - 48 * 60 * 60;
    writeStore([
      { sessionId: 'forgotten', cwd: MINE, pid: ALIVE, agentLifecycle: 'needsInput', updatedAt: longAgo },
    ]);
    const report = fleetReport({ home: HOME });
    expect(report.busy).toBe(0);
    expect(report.waiting.map((m) => m.sessionId)).toEqual(['forgotten']);
  });

  test('a dead pid recorded as running is listed as crashed, not as running', () => {
    writeStore([{ sessionId: 'dead', cwd: MINE, pid: DEAD, agentLifecycle: 'running' }]);
    const report = fleetReport({ home: HOME });
    expect(report.crashed.map((m) => m.sessionId)).toEqual(['dead']);
    expect(report.busy).toBe(0);
    expect(renderFleet(report)).toContain('CRASHED');
  });

  test('an empty machine says so instead of rendering a bare header', () => {
    writeStore([]);
    expect(renderFleet(fleetReport({ home: HOME }))).toContain('no agent sessions');
  });

  test('an unreadable fleet report never claims zero busy, zero spend, or no sessions', () => {
    fs.mkdirSync(cmuxStorePath('claude', HOME), { recursive: true });
    const report = fleetReport({ home: HOME });
    expect(report).toMatchObject({ ok: false, reason: expect.stringContaining('EISDIR') });
    const text = renderFleet(report);
    expect(text).toContain('fleet: unreadable');
    expect(text).not.toContain('0/');
    expect(text).not.toContain('$0.00');
    expect(text).not.toContain('no agent sessions');
  });
});

describe('money the manager cannot price is reported as missing, not as zero', () => {
  test('an unpriced model is excluded from the total and named', () => {
    writeStore([
      {
        sessionId: 'new-model',
        cwd: MINE,
        pid: ALIVE,
        agentLifecycle: 'running',
        transcriptPath: writeTranscript('unpriced', 'claude-not-a-model'),
      },
    ]);
    const report = fleetReport({ home: HOME });
    expect(report.unpricedModels).toEqual(['claude-not-a-model']);
    expect(report.members[0].costKnown).toBe(false);
    const text = renderFleet(report);
    expect(text).toContain('no price on file');
    expect(text).toContain('$?');
    // "$0.00 in flight" beside a fleet of unpriced agents reads as "nothing is
    // being spent", which is the one conclusion the number cannot support.
    expect(text).toContain('spend unknown');
    expect(text).not.toContain('$0.00');
  });

  test('a priced model is counted into the total', () => {
    writeStore([
      {
        sessionId: 'priced',
        cwd: MINE,
        pid: ALIVE,
        agentLifecycle: 'running',
        transcriptPath: writeTranscript('priced', 'claude-sonnet-4-6'),
      },
    ]);
    const report = fleetReport({ home: HOME });
    expect(report.unpricedModels).toEqual([]);
    expect(report.totalCostUsd).toBeGreaterThan(0);
    expect(report.members[0].costKnown).toBe(true);
  });

  test('a priced model without observed usage is unmeasured, not a measured zero', () => {
    const transcript = path.join(HOME, 'missing-usage.jsonl');
    fs.writeFileSync(transcript, JSON.stringify({ message: { model: 'claude-sonnet-4-6', usage: {} } }));
    writeStore([{ sessionId: 'unknown-cost', cwd: MINE, pid: ALIVE, agentLifecycle: 'running', transcriptPath: transcript }]);
    const report = fleetReport({ home: HOME });
    expect(report.members[0]).toMatchObject({ costKnown: false, costStatus: 'unmeasured', costUsd: 0 });
    expect(report.unpricedModels).toEqual([]);
    expect(report.unmeasuredSessions).toBe(1);
    expect(renderFleet(report)).toContain('spend unknown');
  });

  // Only live agents are still spending. A finished pane's bill belongs to the
  // task ledger, not to "in flight".
  test('a finished pane does not count toward the in-flight total', () => {
    writeStore([
      {
        sessionId: 'done',
        cwd: MINE,
        pid: ALIVE,
        agentLifecycle: 'idle',
        transcriptPath: writeTranscript('done', 'claude-sonnet-4-6'),
      },
    ]);
    expect(fleetReport({ home: HOME }).totalCostUsd).toBe(0);
  });
});

describe('disagreements between what the manager believes and what is running', () => {
  // The orphan detector held its own copy of the active-state list, and one
  // entry was spelled `REVIEWING` where the state is `REVIEW`. A task sitting
  // in review with a dead session was therefore invisible to the one check
  // that exists to find exactly that. Driving the test off ACTIVE_STATES means
  // a state added later cannot slip through the same gap unnoticed.
  test.each([...ACTIVE_STATES])('a task in %s with no session covering it is an orphan', (state) => {
    seedTask('joy-t5-01', state);
    writeStore([]);
    expect(fleetReport({ home: HOME }).orphanTasks.map((t) => t.id)).toEqual(['joy-t5-01']);
  });

  test('a task whose session is live is not an orphan', () => {
    seedTask('joy-t1-01', 'REVIEW');
    registerWorktree('joy-t1-01', MINE);
    writeStore([{ sessionId: 'mine', cwd: MINE, pid: ALIVE, agentLifecycle: 'running' }]);
    expect(fleetReport({ home: HOME }).orphanTasks).toEqual([]);
  });

  test('a finished task with no session is not an orphan', () => {
    seedTask('joy-t7-01', 'REPORTED');
    writeStore([]);
    expect(fleetReport({ home: HOME }).orphanTasks).toEqual([]);
  });

  test('a worktree whose directory is gone is surfaced with the branch that still holds the work', () => {
    registerWorktree('joy-t9-01', path.join(HOME, 'wt', 'deleted-by-hand'));
    writeStore([]);
    const report = fleetReport({ home: HOME });
    expect(report.stale.map((r) => r.taskId)).toEqual(['joy-t9-01']);
    expect(renderFleet(report)).toContain('manager/joy-t9-01');
  });
});
