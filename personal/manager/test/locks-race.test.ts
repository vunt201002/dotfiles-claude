import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-locks-race-'));
process.env.MANAGER_HOME = HOME;
process.env.GSTACK_GATE_LOG_DIR = path.join(HOME, 'gate-log');

import { describe, test, expect, beforeEach, afterAll, mock } from 'bun:test';
import * as store from '../lib/store';
import { emptyState, type ManagerState } from '../types';

// acquire() has to do two things to enqueue a task: put it in the queue on
// disk, and register the in-process promise that wakes it up. Whichever order
// those happen in, a release() from another task can land between them —
// mutateState goes through the state mutex, so entering the queue is a real
// await point.
//
// The order decides whether that is survivable. Register-then-claim is safe at
// any gap width: the promise already exists, so a promoter always finds it.
// Claim-then-register is not, and its safety today rests only on an accidental
// microtask count inside Mutex.run — the gap happens to be zero hops wide, so
// nothing can slip in. This widens exactly that gap and fires a release() into
// it, at several widths, which is the interleaving the real system reaches the
// moment any state write becomes async.
//
// The wrapper is a pass-through unless a test sets gapHops, and it only delays
// the 'queued' outcome — the claim that a waiter is about to be registered for.

const realMutateState = store.mutateState;
let gapHops = 0;

mock.module('../lib/store', () => ({
  ...store,
  mutateState: async <T,>(fn: (state: ManagerState) => T): Promise<T> => {
    const result = await realMutateState(fn);
    if (result === ('queued' as unknown as T)) {
      for (let i = 0; i < gapHops; i++) await null;
    }
    return result;
  },
}));

const locks = await import('../lib/locks');

beforeEach(() => {
  gapHops = 0;
  store.writeState(emptyState());
  locks.__clearWaiters();
});

afterAll(() => {
  gapHops = 0;
  try {
    fs.rmSync(HOME, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe('a release() landing inside acquire()\'s enqueue gap still wakes the waiter', () => {
  for (const hops of [0, 1, 2, 3, 5]) {
    test(`gap of ${hops} microtask hop(s)`, async () => {
      gapHops = hops;
      await locks.tryAcquire(locks.BROWSER_TOKEN, 'holder');

      let woken = false;
      const waiting = locks
        .acquire(locks.BROWSER_TOKEN, 'waiter', process.pid, { timeoutMs: 0 })
        .then(() => {
          woken = true;
        });
      void (async () => {
        await locks.release(locks.BROWSER_TOKEN, 'holder');
      })();

      await Promise.race([waiting, new Promise((r) => setTimeout(r, 200))]);

      expect(locks.holderOf(locks.BROWSER_TOKEN)).toBe('waiter');
      expect(
        woken,
        `release() promoted waiter to holder but never resolved its acquire() (gap ${hops}); the browser token is now held by a task that waits forever`,
      ).toBe(true);
    });
  }
});
