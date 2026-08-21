import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-locks-'));
process.env.MANAGER_HOME = HOME;
process.env.GSTACK_GATE_LOG_DIR = path.join(HOME, 'gate-log');

import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import {
  BROWSER_TOKEN,
  LockWaitTimeoutError,
  __clearWaiters,
  __setBootNonceForTests,
  acquire,
  currentBootNonce,
  heldBy,
  holderOf,
  projectLock,
  queueFor,
  release,
  releaseAll,
  revokeOrphans,
  tryAcquire,
} from '../lib/locks';
import { readGateLog } from '../lib/gate-log';
import { readState, writeState } from '../lib/store';
import { emptyState } from '../types';

const REAL_BOOT = currentBootNonce();

beforeEach(() => {
  writeState(emptyState());
  __setBootNonceForTests(REAL_BOOT);
});

afterAll(() => {
  try {
    fs.rmSync(HOME, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe('project lock — one main agent per repo', () => {
  test('the first task takes it, the second queues', async () => {
    expect(await tryAcquire(projectLock('kivora'), 'kivora-t1-01')).toBe('acquired');
    expect(await tryAcquire(projectLock('kivora'), 'kivora-t2-01')).toBe('queued');
    expect(holderOf(projectLock('kivora'))).toBe('kivora-t1-01');
    expect(queueFor(projectLock('kivora'))).toEqual(['kivora-t2-01']);
  });

  test('a different repo is not blocked', async () => {
    await tryAcquire(projectLock('kivora'), 'kivora-t1-01');
    expect(await tryAcquire(projectLock('joy'), 'joy-t1-01')).toBe('acquired');
  });

  test('re-acquiring your own lock is a no-op, not a queue entry', async () => {
    await tryAcquire(projectLock('kivora'), 'kivora-t1-01');
    expect(await tryAcquire(projectLock('kivora'), 'kivora-t1-01')).toBe('acquired');
    expect(queueFor(projectLock('kivora'))).toEqual([]);
  });

  test('release hands the lock to the queue head', async () => {
    await tryAcquire(projectLock('kivora'), 'a');
    await tryAcquire(projectLock('kivora'), 'b');
    expect(await release(projectLock('kivora'), 'a')).toBe('b');
    expect(holderOf(projectLock('kivora'))).toBe('b');
  });

  test('a non-holder cannot release', async () => {
    await tryAcquire(projectLock('kivora'), 'a');
    expect(await release(projectLock('kivora'), 'b')).toBeNull();
    expect(holderOf(projectLock('kivora'))).toBe('a');
  });
});

describe('browser token — exactly one, FIFO', () => {
  test('only one holder at a time', async () => {
    expect(await tryAcquire(BROWSER_TOKEN, 'a')).toBe('acquired');
    expect(await tryAcquire(BROWSER_TOKEN, 'b')).toBe('queued');
    expect(await tryAcquire(BROWSER_TOKEN, 'c')).toBe('queued');
    expect(holderOf(BROWSER_TOKEN)).toBe('a');
  });

  test('waiters wake in the order they arrived', async () => {
    await acquire(BROWSER_TOKEN, 'a');
    const woken: string[] = [];
    const b = acquire(BROWSER_TOKEN, 'b').then(() => woken.push('b'));
    const c = acquire(BROWSER_TOKEN, 'c').then(() => woken.push('c'));
    await new Promise((r) => setTimeout(r, 5));
    expect(queueFor(BROWSER_TOKEN)).toEqual(['b', 'c']);

    await release(BROWSER_TOKEN, 'a');
    await b;
    expect(woken).toEqual(['b']);
    await release(BROWSER_TOKEN, 'b');
    await c;
    expect(woken).toEqual(['b', 'c']);
  });

  test('the queue survives a process restart because it lives on disk', async () => {
    await tryAcquire(BROWSER_TOKEN, 'a');
    await tryAcquire(BROWSER_TOKEN, 'b');
    const onDisk = readState();
    expect(onDisk.locks[BROWSER_TOKEN].task_id).toBe('a');
    expect(onDisk.queues[BROWSER_TOKEN].map((q) => q.task_id)).toEqual(['b']);
  });
});

describe('releaseAll', () => {
  test('drops every lock and every queue entry for one task', async () => {
    await tryAcquire(projectLock('kivora'), 'a');
    await tryAcquire(BROWSER_TOKEN, 'a');
    await tryAcquire(projectLock('joy'), 'a');
    expect(heldBy('a').sort()).toEqual([BROWSER_TOKEN, 'project:joy', 'project:kivora']);
    await releaseAll('a');
    expect(heldBy('a')).toEqual([]);
    expect(holderOf(BROWSER_TOKEN)).toBeNull();
  });

  test('a queued task that stops is removed from the queue', async () => {
    await tryAcquire(BROWSER_TOKEN, 'a');
    await tryAcquire(BROWSER_TOKEN, 'b');
    await tryAcquire(BROWSER_TOKEN, 'c');
    await releaseAll('b');
    expect(queueFor(BROWSER_TOKEN)).toEqual(['c']);
    __clearWaiters();
  });
});

describe('revokeOrphans', () => {
  test('a lock held by a dead task is revoked', async () => {
    await tryAcquire(BROWSER_TOKEN, 'ghost');
    const result = await revokeOrphans(() => false);
    expect(result.revoked.map((r) => r.lock)).toContain(BROWSER_TOKEN);
    expect(holderOf(BROWSER_TOKEN)).toBeNull();
  });

  test('a lock held by a live task is left alone', async () => {
    await tryAcquire(projectLock('kivora'), 'alive');
    const result = await revokeOrphans((id) => id === 'alive');
    expect(result.revoked).toEqual([]);
    expect(holderOf(projectLock('kivora'))).toBe('alive');
  });

  test('a lock whose daemon pid is gone is revoked even if the task looks active', async () => {
    await tryAcquire(BROWSER_TOKEN, 'a', 999_999);
    const result = await revokeOrphans(() => true);
    expect(result.revoked[0].why).toContain('999999');
    expect(holderOf(BROWSER_TOKEN)).toBeNull();
  });

  test('dead waiters are dequeued and the live head is promoted', async () => {
    await tryAcquire(BROWSER_TOKEN, 'dead-holder');
    await tryAcquire(BROWSER_TOKEN, 'dead-waiter');
    await tryAcquire(BROWSER_TOKEN, 'live-waiter');
    const result = await revokeOrphans((id) => id === 'live-waiter');
    expect(result.dequeued.map((d) => d.task_id)).toEqual(['dead-waiter']);
    expect(holderOf(BROWSER_TOKEN)).toBe('live-waiter');
    expect(queueFor(BROWSER_TOKEN)).toEqual([]);
  });

  test('nothing is left holding anything after a full sweep', async () => {
    await tryAcquire(projectLock('kivora'), 'a');
    await tryAcquire(BROWSER_TOKEN, 'b');
    await tryAcquire(BROWSER_TOKEN, 'c');
    await revokeOrphans(() => false);
    const state = readState();
    expect(state.locks).toEqual({});
    expect(state.queues).toEqual({});
    __clearWaiters();
  });

  test('a task promoted by the sweep is woken, not left holding a lock it awaits', async () => {
    await tryAcquire(BROWSER_TOKEN, 'dead-holder', 999_999);
    let woken = false;
    const waiting = acquire(BROWSER_TOKEN, 'live-waiter').then(() => {
      woken = true;
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(queueFor(BROWSER_TOKEN)).toEqual(['live-waiter']);

    await revokeOrphans((id) => id === 'live-waiter');
    await Promise.race([waiting, new Promise((r) => setTimeout(r, 200))]);

    expect(holderOf(BROWSER_TOKEN)).toBe('live-waiter');
    expect(
      woken,
      'reconcile made live-waiter the holder but never resolved its acquire(); the task owns the only browser token and waits forever',
    ).toBe(true);
  });

  test('a crashed project-lock holder is revoked and the queue advances', async () => {
    const lock = projectLock('kivora');
    await tryAcquire(lock, 'dead-holder', 999_999);
    let woken = false;
    const waiting = acquire(lock, 'live-waiter', process.pid, { timeoutMs: 0 }).then(() => {
      woken = true;
    });
    await new Promise((r) => setTimeout(r, 5));

    const result = await revokeOrphans((id) => id === 'live-waiter');
    await Promise.race([waiting, new Promise((r) => setTimeout(r, 200))]);

    expect(result.revoked.map((entry) => entry.task_id)).toContain('dead-holder');
    expect(holderOf(lock)).toBe('live-waiter');
    expect(woken).toBe(true);
  });
});

describe('boot nonce — pid reuse must not disguise a dead daemon', () => {
  test('a lock from another boot is an orphan even when its pid is alive', async () => {
    await tryAcquire(BROWSER_TOKEN, 'a', process.pid);
    expect(readState().locks[BROWSER_TOKEN].boot).toBe(REAL_BOOT);

    __setBootNonceForTests('a-different-boot');
    const result = await revokeOrphans(() => true);

    expect(result.revoked.map((r) => r.lock)).toContain(BROWSER_TOKEN);
    expect(result.revoked[0].why).toContain('daemon boot');
    expect(holderOf(BROWSER_TOKEN)).toBeNull();
  });

  test('a lock from this boot with a live pid is left alone', async () => {
    await tryAcquire(projectLock('kivora'), 'alive', process.pid);
    const result = await revokeOrphans(() => true);
    expect(result.revoked).toEqual([]);
    expect(holderOf(projectLock('kivora'))).toBe('alive');
  });

  test('a lock written before the nonce existed still falls back to the pid check', async () => {
    const state = emptyState();
    state.locks[BROWSER_TOKEN] = { task_id: 'legacy', pid: 999_999, acquired_at: new Date().toISOString() };
    writeState(state);
    const result = await revokeOrphans(() => true);
    expect(result.revoked[0].why).toContain('999999');
    expect(holderOf(BROWSER_TOKEN)).toBeNull();
  });
});

describe('acquire timeout — a hung holder must not stall the queue forever', () => {
  test('the waiter rejects, leaves the queue, and lands in the gate log', async () => {
    await tryAcquire(BROWSER_TOKEN, 'hung-holder');

    await expect(acquire(BROWSER_TOKEN, 'waiter', process.pid, { timeoutMs: 30 })).rejects.toThrow(
      LockWaitTimeoutError,
    );

    expect(queueFor(BROWSER_TOKEN)).toEqual([]);
    expect(holderOf(BROWSER_TOKEN)).toBe('hung-holder');

    const row = readGateLog().find((e) => e.gate === 'lock-wait');
    expect(row?.verdict).toBe('error');
    expect(row?.gate_family).toBe('deterministic');
    expect(row?.caught).toContain(BROWSER_TOKEN);
  });

  test('a waiter woken before the budget expires does not time out', async () => {
    await tryAcquire(BROWSER_TOKEN, 'a');
    const waiting = acquire(BROWSER_TOKEN, 'b', process.pid, { timeoutMs: 500 });
    await new Promise((r) => setTimeout(r, 5));
    await release(BROWSER_TOKEN, 'a');
    await waiting;
    expect(holderOf(BROWSER_TOKEN)).toBe('b');
  });

  test('timing out does not strand a lock the task was promoted into', async () => {
    await tryAcquire(BROWSER_TOKEN, 'a');
    const waiting = acquire(BROWSER_TOKEN, 'b', process.pid, { timeoutMs: 40 });
    await new Promise((r) => setTimeout(r, 38));
    await release(BROWSER_TOKEN, 'a');
    await waiting;
    expect(holderOf(BROWSER_TOKEN)).toBe('b');
    expect(queueFor(BROWSER_TOKEN)).toEqual([]);
  });
});
