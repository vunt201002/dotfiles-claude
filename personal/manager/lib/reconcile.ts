/**
 * Crash recovery (§6.7).
 *
 * A daemon that just booted owns no driver loops, so every task still sitting
 * in RUNNING / VERIFYING / REVIEW belonged to a process that is gone. Those
 * tasks are marked FAILED and reported. They are NOT restarted: a half-applied
 * edit plus a fresh agent with no memory of what it already did is how you get
 * the same fix applied twice.
 *
 * Locks are revoked in the same pass. An orphaned browser token is the worst
 * case — there is only one, so a leaked token stalls every later task that
 * needs the real Chrome, silently and forever.
 */

import { buildApprovalEvent, buildReportEvent, emit } from './events';
import { logGate } from './gate-log-port';
import { revokeOrphans, type RevokeResult } from './locks';
import { listTasks, saveTaskAndIndex } from './store';
import { applyTransition } from './state-machine';
import { ACTIVE_STATES } from '../types';
import type { TaskRecord } from '../types';

export interface ReconcileReport {
  failed: Array<{ id: string; from: string; why: string }>;
  revokedLocks: RevokeResult['revoked'];
  dequeued: RevokeResult['dequeued'];
  reAsked: string[];
}

export async function reconcile(): Promise<ReconcileReport> {
  const report: ReconcileReport = { failed: [], revokedLocks: [], dequeued: [], reAsked: [] };
  const tasks = listTasks();

  for (const task of tasks) {
    if (!ACTIVE_STATES.includes(task.state)) continue;
    const why = `daemon died while this task was ${task.state}; not restarted automatically`;
    const failed = applyTransition(task, 'FAILED', { reason: why, failureReason: why });
    // The locks are about to be revoked, so a record still listing them would
    // report a hold that no longer exists — the one place a reader looks to
    // find out who has the single browser token.
    failed.holds = [];
    await saveTaskAndIndex(failed);
    report.failed.push({ id: task.id, from: task.state, why });
    logGate({
      project: failed.project,
      issue: failed.issue,
      lane: failed.envelope?.lane ?? 'unsized',
      gate: `lifecycle:${task.state}->FAILED`,
      gate_family: 'deterministic',
      verdict: 'error',
      attempt: failed.attempt,
      cost_usd: failed.cost_usd_actual,
      caught: why,
      review_depth: failed.review_depth,
      human_intervened: false,
    });
    emitReport(failed, why);
  }

  const stillActive = new Set(
    listTasks()
      .filter((t) => ACTIVE_STATES.includes(t.state))
      .map((t) => t.id),
  );
  const revoked = await revokeOrphans((taskId) => stillActive.has(taskId));
  report.revokedLocks = revoked.revoked;
  report.dequeued = revoked.dequeued;

  for (const task of listTasks()) {
    if (task.state !== 'APPROVAL') continue;
    report.reAsked.push(task.id);
    emit(
      buildApprovalEvent(
        task,
        task.pending_action || 'confirm this task',
        task.pending_question || task.failure_reason || 'still waiting for approval from before the restart',
      ),
    );
  }

  return report;
}

function emitReport(task: TaskRecord, why: string): void {
  emit(buildReportEvent(task, false, `stopped: ${why}`));
}
