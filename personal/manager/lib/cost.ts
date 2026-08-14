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

import { estimateCostUsd, PRICING } from '../../../test/helpers/pricing';
import { loadConfig, resolveModelId, type ManagerConfig } from '../config';
import type { Lane, TaskRecord } from '../types';
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
  /**
   * Same-lane tasks that had real spend but could not be sampled because part
   * of their cost was never priced. Above zero, `bootstrap` means "not enough
   * measurable history", not "not enough history".
   */
  rejected_partial: number;
}

/** Nearest-rank percentile. Empty input returns 0. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

/**
 * Takes the whole LaneSamples, never a bare array: a caller that could pass
 * only the samples would get `rejected_partial: 0` for free, which is the same
 * comfortable zero standing in for an unknown that this file exists to refuse.
 */
export function laneCeiling(
  collected: LaneSamples,
  lane: Lane | string,
  cfg: ManagerConfig = loadConfig(),
): CeilingDecision {
  const laneCosts = collected.samples.filter((s) => s.lane === lane && s.cost_usd > 0).map((s) => s.cost_usd);
  const rejected = collected.rejectedPartial[String(lane)] ?? 0;
  if (laneCosts.length < cfg.p90MinSamples) {
    return {
      ceiling_usd: cfg.bootstrapTaskCeilingUsd,
      source: 'bootstrap',
      sample_count: laneCosts.length,
      rejected_partial: rejected,
    };
  }
  return {
    ceiling_usd: percentile(laneCosts, 90),
    source: 'p90',
    sample_count: laneCosts.length,
    rejected_partial: rejected,
  };
}

export interface LaneSamples {
  samples: CostSample[];
  /**
   * Tasks with real spend rejected for carrying an unpriced run, counted PER
   * LANE. A single total would be reported against whichever lane asked, so a
   * lane with no rejected tasks at all would still be told some were.
   */
  rejectedPartial: Record<string, number>;
}

/**
 * Per-task actual spend, by lane. Task records are the only source.
 *
 * The gate log used to be a fallback, and it has to stay gone. It is per-GATE,
 * carries no task id, and — decisively — `logTransition` writes the task's
 * RUNNING TOTAL into `cost_usd` on every state change, so summing a task's rows
 * multiplies its spend by the number of transitions it made. Measured against
 * 25 feature tasks that each really cost $2.00, it produced a $10.00 p90
 * ceiling. It also read `gate-test` probe rows as field spend.
 *
 * That fallback was harmless while it was unreachable. Dropping partially-
 * measured tasks made it the NORMAL path instead: every bug-lon and feature
 * task runs review gates on codex, which reports no price, so the primary
 * source is empty for exactly the lanes that cost the most.
 *
 * The honest consequence is that those lanes stay on the bootstrap ceiling
 * until their spend is measurable again. A p90 that cannot be computed is a p90
 * you do not get; `rejectedPartial` exists so that shows up as a stated reason
 * rather than as a lane that quietly never leaves bootstrap.
 */
export function collectLaneSamples(): LaneSamples {
  const priced = listTasks().filter((t) => t.envelope !== null && t.cost_usd_actual > 0);
  const laneOf = (t: TaskRecord): string => (t.envelope as { lane: Lane }).lane;
  const rejectedPartial: Record<string, number> = {};
  for (const t of priced.filter((t) => unmeasuredRuns(t) > 0)) {
    rejectedPartial[laneOf(t)] = (rejectedPartial[laneOf(t)] ?? 0) + 1;
  }
  return {
    samples: priced.filter((t) => unmeasuredRuns(t) === 0).map((t) => ({ lane: laneOf(t), cost_usd: t.cost_usd_actual })),
    rejectedPartial,
  };
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
  /**
   * The spend this was compared against is missing at least one run nobody
   * priced, so `ok` means "not over the part we can see" (§6.5).
   */
  partial: boolean;
}

export function unmeasuredRuns(task: TaskRecord): number {
  return task.cost_unmeasured_runs ?? 0;
}

export function unmeasuredRunsAcross(tasks: TaskRecord[]): number {
  return tasks.reduce((sum, t) => sum + unmeasuredRuns(t), 0);
}

/**
 * Spend as a string that cannot be mistaken for a complete number.
 *
 * `$0.00` beside a task whose whole review ran on an unpriced transport reads
 * as "this was free", which is the one conclusion the figure cannot support.
 */
export function formatSpend(usd: number, unmeasured: number): string {
  if (unmeasured <= 0) return `$${usd.toFixed(2)}`;
  const runs = `${unmeasured} unmeasured run${unmeasured === 1 ? '' : 's'}`;
  return usd > 0 ? `$${usd.toFixed(2)} + ${runs}` : `spend unknown (${runs})`;
}

/** Reaching the ceiling stops the next phase; there is no budget left to spend. */
export function checkTaskCeiling(task: TaskRecord): CeilingVerdict {
  const partial = unmeasuredRuns(task) > 0;
  const spend = formatSpend(task.cost_usd_actual, unmeasuredRuns(task));
  if (task.cost_ceiling_usd <= 0) return { ok: true, reason: '', partial };
  if (task.cost_usd_actual < task.cost_ceiling_usd) return { ok: true, reason: '', partial };
  return {
    ok: false,
    reason: `task spend ${spend} reached ceiling $${task.cost_ceiling_usd.toFixed(2)}`,
    partial,
  };
}

export function checkDayCeiling(tasks: TaskRecord[], cfg: ManagerConfig = loadConfig(), now: Date = new Date()): CeilingVerdict {
  const key = todayKey(now);
  const today = tasks.filter((t) => localDayKey(t.created_at) === key);
  const partial = unmeasuredRunsAcross(today) > 0;
  const spent = spentToday(tasks, now);
  if (spent <= cfg.dayCeilingUsd) return { ok: true, reason: '', partial };
  return {
    ok: false,
    reason: `daily spend ${formatSpend(spent, unmeasuredRunsAcross(today))} exceeded ceiling $${cfg.dayCeilingUsd.toFixed(2)}`,
    partial,
  };
}

export interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  /** Billed above the plain input rate, so it is counted apart from both. */
  cache_creation_input_tokens?: number;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export interface MeasuredCost {
  usd: number;
  /** False when the model has no row in the pricing table. */
  known: boolean;
  model: string;
}

/**
 * Cost of a run whose only evidence is its transcript.
 *
 * Separates "this run cost nothing" from "nobody knows what this run cost".
 * `estimateCostUsd` collapses both to 0, which is fine for a test harness and
 * wrong here: a ceiling fed unpriced runs reads as a machine spending nothing
 * all day, and the first thing anyone would do with that number is raise the
 * limit. An unpriced model is reported as unknown so the gap is visible
 * instead of comfortable.
 */
export function measuredCost(usage: TokenUsage, model: string): MeasuredCost {
  const known = Boolean(model) && Object.prototype.hasOwnProperty.call(PRICING, model);
  if (!known) return { usd: 0, known: false, model };
  return {
    usd: estimateCostUsd(
      {
        input: usage.input_tokens ?? 0,
        output: usage.output_tokens ?? 0,
        cached: usage.cache_read_input_tokens ?? 0,
        cacheWrite: usage.cache_creation_input_tokens ?? 0,
      },
      model,
    ),
    known: true,
    model,
  };
}

/**
 * Cost of one agent run. The runner's own total_cost_usd is authoritative when
 * present; the shared pricing table covers the paths that report none.
 *
 * A run that reports neither a cost nor any usage comes back `known: false`,
 * not zero. Those are two different facts and only one of them may be added to
 * a ceiling.
 */
export function runCost(
  reported: number | undefined,
  usage: TokenUsage | undefined,
  modelAlias: string,
): MeasuredCost {
  const model = resolveModelId(modelAlias);
  if (typeof reported === 'number' && reported > 0) return { usd: round6(reported), known: true, model };
  if (!usage) return { usd: 0, known: false, model };
  return measuredCost(usage, model);
}
