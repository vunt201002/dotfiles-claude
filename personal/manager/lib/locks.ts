/**
 * Scarce-resource locks (§6.3).
 *
 *   project:<name>   at most one main agent per repo
 *   browser-token    exactly one globally — the machine has ONE real Chrome
 *
 * Playwright headless does not take a token; it does not contend for Chrome.
 *
 * The holder and the FIFO waiting list live in state.json, so a daemon that
 * dies mid-task leaves evidence of what it was holding and reconcile can
 * revoke it. The in-process waiter map only carries the promise that wakes a
 * queued task up; it is rebuilt from nothing on boot, which is correct because
 * an unresolved waiter belongs to a task the crash already killed.
 *
 * Two invariants keep a queued task from waiting forever:
 *
 *   1. The waiter is registered BEFORE the task enters the queue, never after.
 *      Entering the queue is an await point, so anything that promotes the
 *      queue head — release() or reconcile — can land inside that gap. A
 *      waiter registered after the claim is a waiter the promoter cannot see:
 *      the task becomes the holder on disk and awaits a wake-up nobody will
 *      send. With one browser token, every later Chrome task queues behind it.
 *   2. Every path that promotes a queue entry to holder wakes that entry.
 *      release() is not the only one — reconcile promotes too.
 */

import { randomUUID } from 'crypto';
import { isProcessAlive } from '../../../browse/src/error-handling';
import { loadConfig } from '../config';
import { logGate } from './gate-log-port';
import { loadTask, mutateState, readState } from './store';
import type { ManagerState } from '../types';

export const BROWSER_TOKEN = 'browser-token';

export function projectLock(project: string): string {
  return `project:${project}`;
}

type Waiter = { resolve: () => void; reject: (err: Error) => void };

const waiters = new Map<string, Waiter>();

function waiterKey(lock: string, taskId: string): string {
  return `${lock} ${taskId}`;
}

/**
 * Identifies THIS daemon run. Stored on every lock so reconcile can tell "a
 * lock this process is holding" from "a lock a dead daemon left behind whose
 * pid the OS has since handed to something else".
 */
let bootNonce = randomUUID();

export function currentBootNonce(): string {
  return bootNonce;
}

/** Test-only. Simulates a daemon restart without spawning a second process. */
export function __setBootNonceForTests(value: string): void {
  bootNonce = value;
}

export type AcquireOutcome = 'acquired' | 'queued';

export interface AcquireOptions {
  /** Overrides the configured wait budget. Zero or less waits forever. */
  timeoutMs?: number;
}

/** Thrown by acquire() when the wait budget runs out. Fails the task, loudly. */
export class LockWaitTimeoutError extends Error {
  readonly lock: string;
  readonly taskId: string;
  readonly waitedMs: number;
  constructor(lock: string, taskId: string, waitedMs: number) {
    super(`task ${taskId} waited ${Math.round(waitedMs / 1000)}s for "${lock}" and gave up`);
    this.name = 'LockWaitTimeoutError';
    this.lock = lock;
    this.taskId = taskId;
    this.waitedMs = waitedMs;
  }
}

function claim(state: ManagerState, lock: string, taskId: string, pid: number): AcquireOutcome {
  const holder = state.locks[lock];
  if (!holder) {
    state.locks[lock] = { task_id: taskId, pid, boot: bootNonce, acquired_at: new Date().toISOString() };
    return 'acquired';
  }
  if (holder.task_id === taskId) return 'acquired';
  const queue = (state.queues[lock] ??= []);
  if (!queue.some((q) => q.task_id === taskId)) {
    queue.push({ task_id: taskId, pid, requested_at: new Date().toISOString() });
  }
  return 'queued';
}

/** Non-blocking. Returns whether the caller now holds the lock. */
export async function tryAcquire(lock: string, taskId: string, pid = process.pid): Promise<AcquireOutcome> {
  return mutateState((state) => claim(state, lock, taskId, pid));
}

function wakeWaiter(lock: string, taskId: string): void {
  const key = waiterKey(lock, taskId);
  const waiter = waiters.get(key);
  if (!waiter) return;
  waiters.delete(key);
  waiter.resolve();
}

function projectForTask(lock: string, taskId: string): string {
  const record = loadTask(taskId);
  if (record?.project) return record.project;
  if (lock.startsWith('project:')) return lock.slice('project:'.length);
  return 'manager';
}

function resolveTimeoutMs(lock: string, opts: AcquireOptions): number {
  if (opts.timeoutMs !== undefined) return opts.timeoutMs;
  const cfg = loadConfig();
  const override = cfg.lockWaitTimeoutOverrideMs?.[lock];
  return typeof override === 'number' ? override : cfg.lockWaitTimeoutMs;
}

/**
 * Drops a task out of a lock's queue. Returns true when the task was promoted
 * to holder in the meantime, which means the wait actually succeeded and the
 * timeout must not fire — otherwise the task would abandon a lock it owns and
 * leave the single browser token orphaned until the next reconcile.
 */
async function abandonWait(lock: string, taskId: string): Promise<boolean> {
  return mutateState((state) => {
    if (state.locks[lock]?.task_id === taskId) return true;
    const queue = state.queues[lock];
    if (!queue) return false;
    const kept = queue.filter((q) => q.task_id !== taskId);
    if (kept.length === 0) delete state.queues[lock];
    else state.queues[lock] = kept;
    return false;
  });
}

function logLockTimeout(lock: string, taskId: string, waitedMs: number): void {
  const record = loadTask(taskId);
  logGate({
    project: projectForTask(lock, taskId),
    issue: record?.issue,
    lane: record?.envelope?.lane ?? 'unsized',
    gate: 'lock-wait',
    gate_family: 'deterministic',
    verdict: 'error',
    attempt: record?.attempt,
    cost_usd: 0,
    caught: `waited ${Math.round(waitedMs / 1000)}s for "${lock}" and gave up`,
    review_depth: record?.review_depth,
    human_intervened: false,
  });
}

/**
 * Blocks until the lock is held. Waiters are woken strictly in the order they
 * were enqueued, because a UI judge that has been waiting ten minutes should
 * not lose Chrome to a task that just arrived.
 *
 * Throws LockWaitTimeoutError once the wait budget is spent. A hung holder
 * would otherwise stall the whole queue forever, and silent give-up is worse
 * than the hang: the throw fails the task, which reports to the human.
 */
export async function acquire(
  lock: string,
  taskId: string,
  pid = process.pid,
  opts: AcquireOptions = {},
): Promise<void> {
  const key = waiterKey(lock, taskId);
  let settle!: Waiter;
  const woken = new Promise<void>((resolve, reject) => {
    settle = { resolve, reject };
  });
  woken.catch(() => undefined);
  waiters.set(key, settle);

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if ((await tryAcquire(lock, taskId, pid)) === 'acquired') return;

    const timeoutMs = resolveTimeoutMs(lock, opts);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      await woken;
      return;
    }
    const expired = new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => {
        void abandonWait(lock, taskId).then((promoted) => {
          if (promoted) {
            resolve();
            return;
          }
          logLockTimeout(lock, taskId, timeoutMs);
          reject(new LockWaitTimeoutError(lock, taskId, timeoutMs));
        }, reject);
      }, timeoutMs);
    });
    expired.catch(() => undefined);
    await Promise.race([woken, expired]);
  } finally {
    if (timer) clearTimeout(timer);
    waiters.delete(key);
  }
}

/** Hands the lock to the FIFO head, if any. Returns the new holder's task id. */
export async function release(lock: string, taskId: string): Promise<string | null> {
  const nextHolder = await mutateState((state) => {
    const holder = state.locks[lock];
    if (!holder || holder.task_id !== taskId) return null;
    delete state.locks[lock];
    const queue = state.queues[lock] ?? [];
    const head = queue.shift();
    if (!head) {
      delete state.queues[lock];
      return null;
    }
    state.queues[lock] = queue;
    state.locks[lock] = {
      task_id: head.task_id,
      pid: head.pid,
      boot: bootNonce,
      acquired_at: new Date().toISOString(),
    };
    return head.task_id;
  });
  if (nextHolder) wakeWaiter(lock, nextHolder);
  return nextHolder;
}

/** Drop a task out of every queue and every lock it holds. Used by stop/fail. */
export async function releaseAll(taskId: string): Promise<string[]> {
  const held = heldBy(taskId);
  for (const lock of held) await release(lock, taskId);
  await mutateState((state) => {
    for (const [lock, queue] of Object.entries(state.queues)) {
      const filtered = queue.filter((q) => q.task_id !== taskId);
      if (filtered.length === 0) delete state.queues[lock];
      else state.queues[lock] = filtered;
    }
  });
  const key = [...waiters.keys()].filter((k) => k.endsWith(` ${taskId}`));
  for (const k of key) {
    const waiter = waiters.get(k);
    waiters.delete(k);
    waiter?.reject(new Error(`task ${taskId} stopped while waiting for a lock`));
  }
  return held;
}

export function heldBy(taskId: string): string[] {
  const state = readState();
  return Object.entries(state.locks)
    .filter(([, holder]) => holder.task_id === taskId)
    .map(([lock]) => lock);
}

export function holderOf(lock: string): string | null {
  return readState().locks[lock]?.task_id ?? null;
}

export function queueFor(lock: string): string[] {
  return (readState().queues[lock] ?? []).map((q) => q.task_id);
}

export interface RevokeResult {
  revoked: Array<{ lock: string; task_id: string; why: string }>;
  dequeued: Array<{ lock: string; task_id: string }>;
  /** Queue entries this sweep promoted to holder. Each one must be woken. */
  promoted: Array<{ lock: string; task_id: string }>;
}

/**
 * Reconcile hook: a lock whose owning task is no longer active, or whose
 * daemon is gone, is an orphan. Left alone it deadlocks every future task that
 * needs the same resource — the browser token especially, since there is only
 * one.
 *
 * "Whose daemon is gone" cannot be answered by pid alone. The OS reuses pids,
 * so a dead daemon's pid can belong to an unrelated live process and the lock
 * then looks healthy forever. The boot nonce settles it: a lock stamped with
 * another boot was not taken by this daemon, and this daemon is the only
 * writer of state.json (§6.1), so it is an orphan whatever its pid says. Locks
 * written before the nonce existed carry none, and fall back to the pid check.
 */
export async function revokeOrphans(isTaskActive: (taskId: string) => boolean): Promise<RevokeResult> {
  const result = await mutateState((state) => {
    const out: RevokeResult = { revoked: [], dequeued: [], promoted: [] };
    for (const [lock, holder] of Object.entries(state.locks)) {
      const taskActive = isTaskActive(holder.task_id);
      const bootMatches = holder.boot === undefined || holder.boot === bootNonce;
      const pidAlive = holder.pid === process.pid || isProcessAlive(holder.pid);
      if (taskActive && bootMatches && pidAlive) continue;
      const why = !taskActive
        ? 'holder task is not active'
        : !bootMatches
          ? `lock was taken by daemon boot ${holder.boot}, this daemon is ${bootNonce}`
          : `daemon pid ${holder.pid} is gone`;
      out.revoked.push({ lock, task_id: holder.task_id, why });
      delete state.locks[lock];
    }
    for (const [lock, queue] of Object.entries(state.queues)) {
      const kept = queue.filter((q) => {
        const alive = isTaskActive(q.task_id);
        if (!alive) out.dequeued.push({ lock, task_id: q.task_id });
        return alive;
      });
      if (kept.length === 0) delete state.queues[lock];
      else state.queues[lock] = kept;
    }
    for (const [lock, queue] of Object.entries(state.queues)) {
      if (state.locks[lock]) continue;
      const head = queue.shift();
      if (!head) {
        delete state.queues[lock];
        continue;
      }
      state.locks[lock] = {
        task_id: head.task_id,
        pid: head.pid,
        boot: bootNonce,
        acquired_at: new Date().toISOString(),
      };
      out.promoted.push({ lock, task_id: head.task_id });
      if (queue.length === 0) delete state.queues[lock];
      else state.queues[lock] = queue;
    }
    return out;
  });
  for (const { lock, task_id } of result.promoted) wakeWaiter(lock, task_id);
  return result;
}

/** Test-only. Clears in-process waiters so a suite does not leak promises. */
export function __clearWaiters(): void {
  for (const [, waiter] of waiters) waiter.reject(new Error('waiters cleared'));
  waiters.clear();
}
