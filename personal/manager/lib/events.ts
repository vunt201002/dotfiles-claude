/**
 * Manager event bus. Feeds GET /events (SSE).
 *
 * Three event types, and the field names below are the wire contract the
 * Telegram bot reads (personal/manager/telegram/manager-client.ts). The bot
 * renders leniently: a missing field is dropped from the message rather than
 * printed as undefined, so a rename here does not fail loudly — it produces a
 * quietly empty card. Field names are matched exactly for that reason.
 */

import * as crypto from 'crypto';

export type ManagerEventType = 'report' | 'question' | 'approval';

export interface GateSummary {
  gate: string;
  gate_family: string;
  verdict: string;
  caught: string;
}

export interface ReportEvent {
  type: 'report';
  taskId: string;
  project: string;
  issue: string;
  lane: string;
  attempt: number;
  cost_usd: number;
  ok: boolean;
  cause: string;
  gates: GateSummary[];
  verify: string[];
  assumptions: string[];
  status: string;
}

export interface QuestionEvent {
  type: 'question';
  taskId: string;
  project: string;
  issue: string;
  text: string;
}

export interface ApprovalEvent {
  type: 'approval';
  taskId: string;
  project: string;
  issue: string;
  action: string;
  detail: string;
  diff?: string;
  /**
   * Stable across a manager restart. The bot keys its inline buttons on this,
   * so a re-emitted approval after a crash updates the existing card instead
   * of putting a second pair of buttons on the phone.
   */
  approvalId: string;
}

export type ManagerEvent = ReportEvent | QuestionEvent | ApprovalEvent;

/** Same task + same kind + same attempt always yields the same id. */
export function approvalId(taskId: string, kind: string, attempt: number): string {
  return crypto.createHash('sha256').update(`${taskId}|${kind}|${attempt}`).digest('hex').slice(0, 12);
}

/**
 * Builders, not raw object literals at the call sites. Two places emit these
 * (the driver and crash recovery) and when they each built their own, the
 * recovery path drifted onto a shape the bot renders as an empty card —
 * silently, because a missing field is dropped rather than flagged.
 */
export function buildReportEvent(task: EventSourceTask, ok: boolean, status: string): ReportEvent {
  return {
    type: 'report',
    taskId: task.id,
    project: task.project,
    issue: task.issue,
    lane: task.envelope?.lane ?? 'unsized',
    attempt: task.attempt,
    cost_usd: task.cost_usd_actual,
    ok,
    cause: task.failure_reason || task.envelope?.why || '',
    gates: gateSummaries(task),
    verify: task.verify_lines,
    assumptions: task.assumptions,
    status,
  };
}

export function buildApprovalEvent(task: EventSourceTask, action: string, detail: string): ApprovalEvent {
  return {
    type: 'approval',
    taskId: task.id,
    project: task.project,
    issue: task.issue,
    action,
    detail,
    approvalId: approvalId(task.id, action, task.attempt),
  };
}

/** The slice of a TaskRecord an event is built from. */
export interface EventSourceTask {
  id: string;
  project: string;
  issue: string;
  attempt: number;
  cost_usd_actual: number;
  failure_reason: string;
  verify_lines: string[];
  assumptions: string[];
  gates_run: string[];
  findings: Array<{ gate: string; gate_family: string; text: string }>;
  envelope: { lane?: string; why?: string } | null;
}

function gateSummaries(task: EventSourceTask): GateSummary[] {
  const caught: GateSummary[] = task.findings.map((f) => ({
    gate: f.gate,
    gate_family: f.gate_family,
    verdict: 'caught',
    caught: f.text,
  }));
  const named = new Set(caught.map((g) => g.gate));
  const passed: GateSummary[] = task.gates_run
    .filter((gate) => !named.has(gate))
    .map((gate) => ({ gate, gate_family: 'deterministic', verdict: 'pass', caught: '' }));
  return [...caught, ...passed];
}

type Subscriber = (event: ManagerEvent) => void;

const subscribers = new Set<Subscriber>();
const recent: ManagerEvent[] = [];
const RECENT_CAP = 200;

export function subscribe(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

export function emit(event: ManagerEvent): ManagerEvent {
  recent.push(event);
  if (recent.length > RECENT_CAP) recent.splice(0, recent.length - RECENT_CAP);
  for (const fn of [...subscribers]) {
    try {
      fn(event);
    } catch {
      // A broken subscriber must not stop the others from being notified.
    }
  }
  return event;
}

export function recentEvents(limit = 20): ManagerEvent[] {
  return recent.slice(-limit);
}

export function subscriberCount(): number {
  return subscribers.size;
}

/** Test-only. */
export function __resetEvents(): void {
  subscribers.clear();
  recent.length = 0;
}
