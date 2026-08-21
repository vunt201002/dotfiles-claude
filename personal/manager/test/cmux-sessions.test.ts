import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  busyCount,
  cmuxStorePath,
  fleet,
  healthOf,
  readCmuxSessions,
  sessionsUnder,
  usageFromTranscript,
  type CmuxSession,
} from '../lib/cmux-sessions';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'cmux-store-'));

/** This process is the only pid guaranteed alive for the length of a test. */
const ALIVE = process.pid;
/** Never allocated by any OS, so it is reliably dead. */
const DEAD = 2 ** 22;

function writeStore(sessions: Record<string, unknown>): void {
  fs.mkdirSync(path.join(HOME, '.cmuxterm'), { recursive: true });
  fs.writeFileSync(cmuxStorePath('claude', HOME), JSON.stringify({ version: 1, sessions }));
}

const FRESH_NOW_MS = 100_000;
const ABANDONED_AFTER_MS = 2 * 60 * 60_000;

function session(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    sessionId: 's1',
    surfaceId: 'surf1',
    workspaceId: 'ws1',
    cwd: '/repo/joy',
    pid: ALIVE,
    pidStartSeconds: 1786591983,
    agentLifecycle: 'running',
    transcriptPath: '/tmp/none.jsonl',
    updatedAt: 100,
    startedAt: 50,
    lastSubtitle: 'Working',
    ...over,
  };
}

beforeEach(() => {
  fs.rmSync(path.join(HOME, '.cmuxterm'), { recursive: true, force: true });
});

afterAll(() => {
  fs.rmSync(HOME, { recursive: true, force: true });
});

describe('reading the store never takes the manager down with it', () => {
  test('a missing store is no sessions, not a throw', () => {
    expect(readCmuxSessions('claude', HOME)).toEqual([]);
  });

  test('a half-written store is no sessions, not a throw', () => {
    fs.mkdirSync(path.join(HOME, '.cmuxterm'), { recursive: true });
    fs.writeFileSync(cmuxStorePath('claude', HOME), '{"sessions": {"a": {"sessionId"');
    expect(readCmuxSessions('claude', HOME)).toEqual([]);
  });

  test('an entry with no sessionId is skipped, the rest survive', () => {
    writeStore({ bad: { cwd: '/repo/joy' }, good: session({ sessionId: 'keep' }) });
    expect(readCmuxSessions('claude', HOME).map((s) => s.sessionId)).toEqual(['keep']);
  });

  test('an unknown lifecycle string degrades to unknown rather than being trusted', () => {
    writeStore({ a: session({ agentLifecycle: 'vibing' }) });
    expect(readCmuxSessions('claude', HOME)[0].lifecycle).toBe('unknown');
  });

  test('newest first, so a watcher reads the freshest state at the top', () => {
    writeStore({
      old: session({ sessionId: 'old', updatedAt: 10 }),
      fresh: session({ sessionId: 'fresh', updatedAt: 900 }),
    });
    expect(readCmuxSessions('claude', HOME).map((s) => s.sessionId)).toEqual(['fresh', 'old']);
  });
});

// A recorded lifecycle is a claim about the past. The pid is the check on
// whether it is still true, and the two disagree in both directions.
describe('the store says what happened; the pid says whether it still holds', () => {
  const withPid = (pid: number, lifecycle: string): CmuxSession =>
    ({ ...(readAll({ a: session({ pid, agentLifecycle: lifecycle }) })[0]) });

  function readAll(sessions: Record<string, unknown>): CmuxSession[] {
    writeStore(sessions);
    return readCmuxSessions('claude', HOME);
  }

  test('alive + running is work in progress', () => {
    expect(healthOf(withPid(ALIVE, 'running'))).toBe('working');
  });

  test('alive + needsInput is a human being waited on', () => {
    expect(healthOf(withPid(ALIVE, 'needsInput'))).toBe('waiting');
  });

  test('alive + idle is done', () => {
    expect(healthOf(withPid(ALIVE, 'idle'))).toBe('finished');
  });

  test('dead + running is a crash, never "still working"', () => {
    expect(healthOf(withPid(DEAD, 'running'))).toBe('crashed');
  });

  test('dead + needsInput is gone, not a human being waited on', () => {
    // The observed case: wishlist-3 sat at needsInput with a dead pid. Read as
    // "waiting" it is a queue entry nobody will ever answer.
    expect(healthOf(withPid(DEAD, 'needsInput'))).toBe('gone');
  });
});

// Read straight off the live store: a pane in wishlist-2 had been showing
// `lastSubtitle: "Permission"` for five hours with `agentLifecycle: "running"`
// the entire time. Keyed on lifecycle alone, that pane reads as healthy work
// in progress forever, and it is the exact case the fleet view exists to find.
describe('a permission prompt is a human blocking, whatever the lifecycle says', () => {
  function health(over: Record<string, unknown>): string {
    writeStore({ a: session(over) });
    return healthOf(readCmuxSessions('claude', HOME)[0]);
  }

  test('running + a Permission subtitle is blocked, not working', () => {
    expect(health({ pid: ALIVE, agentLifecycle: 'running', lastSubtitle: 'Permission' })).toBe('blocked');
  });

  test('an ordinary subtitle leaves running as working', () => {
    expect(health({ pid: ALIVE, agentLifecycle: 'running', lastSubtitle: 'Editing widget.ts' })).toBe('working');
  });

  // The pid stays the harder evidence. A dead process is not blocked on
  // anything; it is over.
  test('a dead pid still wins over the subtitle', () => {
    expect(health({ pid: DEAD, agentLifecycle: 'running', lastSubtitle: 'Permission' })).toBe('crashed');
  });

  test('blocked holds a seat, so it counts against the cap', () => {
    writeStore({
      a: session({ sessionId: 'a', pid: ALIVE, agentLifecycle: 'running', lastSubtitle: 'Permission' }),
      b: session({ sessionId: 'b', pid: ALIVE, agentLifecycle: 'idle', lastSubtitle: 'Completed' }),
    });
    expect(busyCount(fleet('claude', HOME), FRESH_NOW_MS, ABANDONED_AFTER_MS)).toBe(1);
  });
});

describe('counting the fleet, including agents the manager never started', () => {
  test('busy counts working and waiting, not finished or dead', () => {
    writeStore({
      a: session({ sessionId: 'a', pid: ALIVE, agentLifecycle: 'running' }),
      b: session({ sessionId: 'b', pid: ALIVE, agentLifecycle: 'needsInput' }),
      c: session({ sessionId: 'c', pid: ALIVE, agentLifecycle: 'idle' }),
      d: session({ sessionId: 'd', pid: DEAD, agentLifecycle: 'running' }),
    });
    expect(busyCount(fleet('claude', HOME), FRESH_NOW_MS, ABANDONED_AFTER_MS)).toBe(2);
  });

  // Three panes left open on a Friday must not silently halve the machine's
  // capacity every week after.
  test('a pane waiting on a human past the cutoff stops holding a seat', () => {
    writeStore({
      a: session({ sessionId: 'a', pid: ALIVE, agentLifecycle: 'running' }),
      b: session({ sessionId: 'b', pid: ALIVE, agentLifecycle: 'needsInput' }),
      c: session({ sessionId: 'c', pid: ALIVE, agentLifecycle: 'running', lastSubtitle: 'Permission' }),
    });
    const long = FRESH_NOW_MS + 3 * ABANDONED_AFTER_MS;
    expect(busyCount(fleet('claude', HOME), FRESH_NOW_MS, ABANDONED_AFTER_MS)).toBe(3);
    expect(busyCount(fleet('claude', HOME), long, ABANDONED_AFTER_MS)).toBe(1);
  });

  test('a pane that is still working never ages out, however long it runs', () => {
    writeStore({
      a: session({ sessionId: 'a', pid: ALIVE, agentLifecycle: 'running' }),
    });
    const long = FRESH_NOW_MS + 1000 * ABANDONED_AFTER_MS;
    expect(busyCount(fleet('claude', HOME), long, ABANDONED_AFTER_MS)).toBe(1);
  });
});

describe('scoping a repo to its own sessions', () => {
  // These four directories exist side by side on this machine, and a prefix
  // match would fold three of them into the first. A per-project agent cap
  // built on that would be wrong in the direction that lets two agents into
  // one repo.
  test('a sibling whose name extends the root is NOT inside it', () => {
    writeStore({
      a: session({ sessionId: 'in', cwd: '/repo/wishlist' }),
      b: session({ sessionId: 'nested', cwd: '/repo/wishlist/packages/functions' }),
      c: session({ sessionId: 'sibling', cwd: '/repo/wishlist-2' }),
      d: session({ sessionId: 'other', cwd: '/repo/joy' }),
    });
    const entries = fleet('claude', HOME);
    const ids = sessionsUnder('/repo/wishlist', entries).map((s) => s.sessionId).sort();
    expect(ids).toEqual(['in', 'nested']);
  });

  test('a session with no cwd belongs to no repo', () => {
    writeStore({ a: session({ cwd: '' }) });
    expect(sessionsUnder('/repo/joy', fleet('claude', HOME))).toEqual([]);
  });
});

describe('cost comes from the transcript, a channel the agent does not write for us', () => {
  const transcript = path.join(HOME, 'usage.jsonl');

  test('usage sums across turns and keeps cache reads apart from fresh input', () => {
    fs.writeFileSync(
      transcript,
      [
        JSON.stringify({ message: { usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 7 } } }),
        'not json at all',
        JSON.stringify({ message: { usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 50, cache_creation_input_tokens: 3 } } }),
        JSON.stringify({ message: { role: 'user' } }),
      ].join('\n'),
    );
    expect(usageFromTranscript(transcript)).toEqual({
      inputTokens: 11,
      outputTokens: 7,
      cacheReadTokens: 150,
      cacheCreationTokens: 10,
      turns: 2,
      model: '',
    });
  });

  // Priced from what actually answered, not from what the manager asked for.
  // A pane the operator started, or one whose model was switched mid-session,
  // would otherwise be billed at whatever the manager last requested.
  test('the model comes from the transcript, and the last one seen wins', () => {
    fs.writeFileSync(
      transcript,
      [
        JSON.stringify({ message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 1, output_tokens: 1 } } }),
        JSON.stringify({ message: { model: 'claude-opus-4-7', usage: { input_tokens: 1, output_tokens: 1 } } }),
      ].join('\n'),
    );
    expect(usageFromTranscript(transcript).model).toBe('claude-opus-4-7');
  });

  test('a transcript that is not there reads as zero, not as a throw', () => {
    expect(usageFromTranscript(path.join(HOME, 'nope.jsonl')).turns).toBe(0);
  });
});
