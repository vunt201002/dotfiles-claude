/**
 * File-backed task store (§6.1). All manager state lives on disk so a crash
 * loses nothing but in-flight sessions; nothing meaningful is kept in process
 * memory.
 *
 *   ~/.gstack/manager/state.json      in-flight index + locks + FIFO queues
 *   ~/.gstack/manager/tasks/<id>.json full task record
 *
 * state.json is the single hot file, so every read-modify-write goes through
 * one in-process mutex. The daemon is the only writer; CLI reads are
 * lock-free and may see a slightly stale index, which is fine for `status`.
 */

import * as fs from 'fs';
import { atomicWriteJson, ensureManagerDirs, readJson, slug, stateFile, taskFile, tasksDir } from './paths';
import type { ManagerState, TaskRecord, TaskSource, TaskState } from '../types';
import { emptyState } from '../types';
import { loadConfig } from '../config';

class Mutex {
  private tail: Promise<void> = Promise.resolve();
  run<T>(fn: () => T | Promise<T>): Promise<T> {
    const result = this.tail.then(fn);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

const stateMutex = new Mutex();

export function readState(): ManagerState {
  const state = readJson<ManagerState>(stateFile(), emptyState());
  return {
    version: state.version ?? 1,
    updated_at: state.updated_at ?? new Date().toISOString(),
    tasks: state.tasks ?? {},
    locks: state.locks ?? {},
    queues: state.queues ?? {},
  };
}

export function writeState(state: ManagerState): void {
  ensureManagerDirs();
  atomicWriteJson(stateFile(), { ...state, updated_at: new Date().toISOString() });
}

/** Serialized read-modify-write of state.json. */
export function mutateState<T>(fn: (state: ManagerState) => T): Promise<T> {
  return stateMutex.run(() => {
    const state = readState();
    const result = fn(state);
    writeState(state);
    return result;
  });
}

export function listTaskIds(): string[] {
  try {
    return fs
      .readdirSync(tasksDir())
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -'.json'.length));
  } catch {
    return [];
  }
}

export function loadTask(id: string): TaskRecord | null {
  const record = readJson<TaskRecord | null>(taskFile(id), null);
  return record && typeof record === 'object' && record.id === id ? record : null;
}

export function listTasks(): TaskRecord[] {
  return listTaskIds()
    .map(loadTask)
    .filter((t): t is TaskRecord => t !== null)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export function saveTask(record: TaskRecord): void {
  ensureManagerDirs();
  atomicWriteJson(taskFile(record.id), { ...record, updated_at: new Date().toISOString() });
}

/** Persist a task and keep the in-flight index in step with it. */
export async function saveTaskAndIndex(record: TaskRecord, pid: number = process.pid): Promise<void> {
  saveTask(record);
  await mutateState((state) => {
    state.tasks[record.id] = {
      state: record.state,
      project: record.project,
      issue: record.issue,
      pid,
    };
  });
}

export function nextTaskId(project: string, issue: string): string {
  const base = `${slug(project)}-${slug(issue)}`;
  const existing = new Set(listTaskIds());
  for (let n = 1; n < 1000; n++) {
    const candidate = `${base}-${String(n).padStart(2, '0')}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export interface CreateTaskInput {
  project: string;
  issue: string;
  source: TaskSource;
  scope: string;
  ceilingUsd: number;
}

export function newTaskRecord(input: CreateTaskInput): TaskRecord {
  const now = new Date().toISOString();
  return {
    id: nextTaskId(input.project, input.issue),
    state: 'INTAKE',
    source: input.source,
    project: input.project,
    issue: input.issue,
    scope: input.scope,
    envelope: null,
    attempt: 1,
    max_attempts: loadConfig().maxAttempts,
    review_depth: 'summary',
    blind_sample: false,
    agents: [],
    gates_run: [],
    findings: [],
    gate_reports: [],
    holds: [],
    cost_usd_actual: 0,
    cost_ceiling_usd: input.ceilingUsd,
    human_touches: 0,
    assumption_count: 0,
    failure_reason: '',
    report_lines: [],
    verify_lines: [],
    assert_runs: [],
    assumptions: [],
    advisories: [],
    root_cause: '',
    resume_state: '',
    pending_action: '',
    pending_assert_cmds: [],
    pending_question: '',
    answers: [],
    run_started_at: '',
    attempt_started_at: '',
    created_at: now,
    updated_at: now,
  };
}

export function tasksInState(states: readonly TaskState[]): TaskRecord[] {
  return listTasks().filter((t) => states.includes(t.state));
}
