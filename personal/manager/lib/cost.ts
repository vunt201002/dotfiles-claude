/**
 * Cost ceilings (§6.5).
 *
 * The ceiling is NEVER derived from the agent's own `est_cost_usd`. LLMs
 * under-estimate systematically; a ceiling built on that estimate kills tasks
 * mid-flight, which spends the money and delivers nothing — strictly worse
 * than having no ceiling. `est_cost_usd` is recorded only so the drift
 * between estimate and actual can be measured later.
 *
 * Bootstrap: a flat, generous per-task ceiling plus a hard daily ceiling.
 * After enough same-lane history: the p90 of ACTUAL spend for that lane.
 */

import { estimateCostUsd } from '../../../test/helpers/pricing';
import { loadConfig, resolveModelId, type ManagerConfig } from '../config';
import type { Lane, TaskRecord } from '../types';
import { readEntries } from './gate-log-port';
import { listTasks } from './store';

export interface CostSample {
  lane: Lane | string;
  cost_usd: number;
}

export type CeilingSource = 'bootstrap' | 'p90';

export interface CeilingDecision {
  ceiling_usd: number;
  source: CeilingSource;
  sample_count: number;
}

/** Nearest-rank percentile. Empty input returns 0. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

export function laneCeiling(
  samples: CostSample[],
  lane: Lane | string,
  cfg: ManagerConfig = loadConfig(),
): CeilingDecision {
  const laneCosts = samples.filter((s) => s.lane === lane && s.cost_usd > 0).map((s) => s.cost_usd);
  if (laneCosts.length < cfg.p90MinSamples) {
    return { ceiling_usd: cfg.bootstrapTaskCeilingUsd, source: 'bootstrap', sample_count: laneCosts.length };
  }
  return { ceiling_usd: percentile(laneCosts, 90), source: 'p90', sample_count: laneCosts.length };
}

/**
 * Per-task actual spend, by lane.
 *
 * Task records are the primary source: `cost_usd_actual` is exactly one number
 * per task. The gate log is per-GATE and carries no task id, so summing it
 * would merge two separate tasks on the same issue into one sample. It is used
 * only when there are no task records to read (fresh manager home, historical
 * log), and then grouped by project+issue+lane.
 */
export function collectLaneSamples(): CostSample[] {
  const fromTasks = listTasks()
    .filter((t) => t.envelope !== null && t.cost_usd_actual > 0)
    .map((t) => ({ lane: (t.envelope as { lane: Lane }).lane, cost_usd: t.cost_usd_actual }));
  if (fromTasks.length > 0) return fromTasks;

  const grouped = new Map<string, CostSample>();
  for (const entry of readEntries()) {
    if (!entry || typeof entry.cost_usd !== 'number') continue;
    const key = `${entry.project} ${entry.issue} ${entry.lane}`;
    const hit = grouped.get(key);
    if (hit) hit.cost_usd += entry.cost_usd;
    else grouped.set(key, { lane: entry.lane, cost_usd: entry.cost_usd });
  }
  return [...grouped.values()];
}

function localDayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayKey(now: Date = new Date()): string {
  return localDayKey(now.toISOString());
}

/** Sum of actual spend for tasks created today, local time. */
export function spentToday(tasks: TaskRecord[] = listTasks(), now: Date = new Date()): number {
  const key = todayKey(now);
  return round6(tasks.filter((t) => localDayKey(t.created_at) === key).reduce((sum, t) => sum + t.cost_usd_actual, 0));
}

export function spentAllTime(tasks: TaskRecord[] = listTasks()): number {
  return round6(tasks.reduce((sum, t) => sum + t.cost_usd_actual, 0));
}

export interface CostBreakdown {
  usd: number;
  byLane: Record<string, number>;
  byProject: Record<string, number>;
}

export function costBreakdown(tasks: TaskRecord[], window: 'today' | 'all', now: Date = new Date()): CostBreakdown {
  const key = todayKey(now);
  const scoped = window === 'today' ? tasks.filter((t) => localDayKey(t.created_at) === key) : tasks;
  const byLane: Record<string, number> = {};
  const byProject: Record<string, number> = {};
  let usd = 0;
  for (const task of scoped) {
    usd += task.cost_usd_actual;
    const lane = task.envelope?.lane ?? 'unsized';
    byLane[lane] = round6((byLane[lane] ?? 0) + task.cost_usd_actual);
    byProject[task.project] = round6((byProject[task.project] ?? 0) + task.cost_usd_actual);
  }
  return { usd: round6(usd), byLane, byProject };
}

export interface CeilingVerdict {
  ok: boolean;
  reason: string;
}

export function checkTaskCeiling(task: TaskRecord): CeilingVerdict {
  if (task.cost_ceiling_usd <= 0) return { ok: true, reason: '' };
  if (task.cost_usd_actual <= task.cost_ceiling_usd) return { ok: true, reason: '' };
  return {
    ok: false,
    reason: `task spend $${task.cost_usd_actual.toFixed(2)} exceeded ceiling $${task.cost_ceiling_usd.toFixed(2)}`,
  };
}

export function checkDayCeiling(tasks: TaskRecord[], cfg: ManagerConfig = loadConfig(), now: Date = new Date()): CeilingVerdict {
  const spent = spentToday(tasks, now);
  if (spent <= cfg.dayCeilingUsd) return { ok: true, reason: '' };
  return {
    ok: false,
    reason: `daily spend $${spent.toFixed(2)} exceeded ceiling $${cfg.dayCeilingUsd.toFixed(2)}`,
  };
}

export interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
}

/**
 * Cost of one agent run. The runner's own total_cost_usd is authoritative when
 * present; estimateCostUsd from the shared pricing table covers the paths that
 * report none (a max-turns throw, a mocked runner) so a run is never silently
 * free.
 */
export function resolveRunCostUsd(
  reported: number | undefined,
  usage: TokenUsage | undefined,
  modelAlias: string,
): number {
  if (typeof reported === 'number' && reported > 0) return round6(reported);
  if (!usage) return 0;
  return estimateCostUsd(
    {
      input: usage.input_tokens ?? 0,
      output: usage.output_tokens ?? 0,
      cached: usage.cache_read_input_tokens ?? 0,
    },
    resolveModelId(modelAlias),
  );
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
