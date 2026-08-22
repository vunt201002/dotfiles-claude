/**
 * One view of every agent running on this machine.
 *
 * The gap this closes is concrete: on the day it was written, a pane in the
 * `wishlist` repo had been sitting at `needsInput` for hours and nothing
 * anywhere would ever say so. `manager status` lists tasks the manager
 * started, which is a strictly smaller set than the agents that exist — an
 * operator opens panes by hand all day, and those spend money and hold cores
 * without appearing in any of the manager's numbers.
 *
 * So the fleet is assembled from cmux's session store, not from the task
 * store, and tasks are matched onto it rather than the other way round.
 * Anything the manager did not start still shows up, marked as such.
 */

import * as path from 'node:path';
import { loadConfig, resolveMaxAgents } from '../config';
import { busyCount, fleet, isLive, needsHuman, usageFromTranscript, type FleetEntry, type SessionHealth } from './cmux-sessions';
import { measuredCost } from './cost';
import { listTasks } from './store';
import { ACTIVE_STATES } from '../types';
import { listWorktrees, staleRecords, type WorktreeRecord } from './worktrees';

export interface FleetMember {
  sessionId: string;
  health: SessionHealth;
  cwd: string;
  /** Short name for the directory the agent is in. */
  where: string;
  subtitle: string;
  pid: number;
  ageSec: number;
  idleSec: number;
  turns: number;
  costUsd: number;
  /** False when the model has no pricing row, so costUsd is absence not zero. */
  costKnown: boolean;
  costStatus: 'known' | 'unpriced' | 'unmeasured';
  model: string;
  /** Set when the cwd matches a worktree the manager created. */
  taskId: string;
  project: string;
  /** False for a pane the operator opened themselves. */
  managerOwned: boolean;
}

interface FleetReportValue {
  members: FleetMember[];
  busy: number;
  cap: number;
  /** Members at needsInput — the ones a human is blocking. */
  waiting: FleetMember[];
  crashed: FleetMember[];
  worktrees: WorktreeRecord[];
  stale: WorktreeRecord[];
  totalCostUsd: number;
  /** Models seen in flight with no pricing row. totalCostUsd excludes them. */
  unpricedModels: string[];
  unmeasuredSessions: number;
  /** Tasks the manager thinks are live but which have no pane behind them. */
  orphanTasks: Array<{ id: string; project: string; state: string }>;
}

export type FleetReport = FleetReportValue & ({ ok: true } | { ok: false; reason: string });

function secondsSince(epochSeconds: number, now: number): number {
  if (!epochSeconds) return 0;
  return Math.max(0, Math.round(now / 1000 - epochSeconds));
}

function memberFrom(entry: FleetEntry, byDir: Map<string, WorktreeRecord>, now: number): FleetMember {
  const record = entry.cwd ? byDir.get(path.resolve(entry.cwd)) : undefined;
  const usage = entry.transcriptPath ? usageFromTranscript(entry.transcriptPath) : null;
  const cost = usage?.ok
    ? measuredCost(
        {
          input_tokens: usage.inputTokens,
          output_tokens: usage.outputTokens,
          cache_read_input_tokens: usage.cacheReadTokens,
          cache_creation_input_tokens: usage.cacheCreationTokens,
        },
        usage.model,
      )
    : { usd: 0, known: false, model: usage?.model ?? '' };
  return {
    sessionId: entry.sessionId,
    health: entry.health,
    cwd: entry.cwd,
    where: entry.cwd ? path.basename(entry.cwd) : '(no cwd)',
    subtitle: entry.subtitle,
    pid: entry.pid,
    ageSec: secondsSince(entry.startedAt, now),
    idleSec: secondsSince(entry.updatedAt, now),
    turns: usage?.turns ?? 0,
    costUsd: cost.usd,
    costKnown: cost.known,
    costStatus: usage?.ok ? (cost.known ? 'known' : 'unpriced') : 'unmeasured',
    model: cost.model,
    taskId: record?.taskId ?? '',
    project: record?.project ?? '',
    managerOwned: Boolean(record),
  };
}

export function fleetReport(opts: { now?: number; home?: string } = {}): FleetReport {
  const now = opts.now ?? Date.now();
  const cfg = loadConfig();
  const worktrees = listWorktrees();
  const byDir = new Map(worktrees.map((r) => [path.resolve(r.dir), r]));
  const entries = fleet('claude', opts.home);
  const members = entries.map((e) => memberFrom(e, byDir, now));
  const live = members.filter((m) => isLive(m.health));
  const covered = new Set(members.map((m) => m.taskId).filter(Boolean));

  const report: FleetReportValue = {
    members,
    busy: busyCount(entries, now, cfg.abandonedPaneAfterMs),
    cap: resolveMaxAgents(cfg),
    waiting: members.filter((m) => needsHuman(m.health)),
    crashed: members.filter((m) => m.health === 'crashed'),
    worktrees,
    stale: staleRecords(),
    totalCostUsd: +live.reduce((sum, m) => sum + m.costUsd, 0).toFixed(4),
    unpricedModels: [...new Set(live.filter((m) => m.costStatus === 'unpriced' && m.model).map((m) => m.model))],
    unmeasuredSessions: live.filter((m) => m.costStatus === 'unmeasured').length,
    orphanTasks: listTasks()
      .filter((t) => ACTIVE_STATES.includes(t.state) && !covered.has(t.id))
      .map((t) => ({ id: t.id, project: t.project, state: t.state })),
  };
  if (entries.ok) return { ...report, ok: true };
  return { ...report, ok: false, reason: entries.reason };
}

const MARK: Record<SessionHealth, string> = {
  working: '▶',
  waiting: '?',
  blocked: '!',
  finished: '✓',
  crashed: '✗',
  gone: '·',
};

/**
 * What to say when the subtitle does not already say it.
 *
 * `blocked` overrides its subtitle because cmux's is the bare word
 * "Permission", which is the fact without the consequence. `waiting` defers to
 * its subtitle, which is often the actual question.
 */
const WHY_STUCK: Partial<Record<SessionHealth, string>> = {
  blocked: 'stuck on a permission prompt',
};

function duration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
}

/**
 * Ordered so the two lines that need a human come first.
 *
 * A report that sorted by start time would put the pane waiting on an answer
 * wherever it happened to fall, which is how one sat unanswered for hours on
 * a screen the operator had open the whole time.
 */
export function renderFleet(report: FleetReport): string {
  if (!report.ok) return `fleet: unreadable · ${report.reason}`;
  const lines: string[] = [];
  // "$0.00" beside a fleet of unpriced agents reads as "nothing is being
  // spent", which is the one conclusion the number cannot support.
  const spend =
    report.unpricedModels.length > 0 || report.unmeasuredSessions > 0
      ? report.totalCostUsd > 0
        ? `$${report.totalCostUsd.toFixed(2)} + unknown`
        : 'spend unknown'
      : `$${report.totalCostUsd.toFixed(2)}`;
  lines.push(`fleet: ${report.busy}/${report.cap} busy · ${spend} in flight`);
  if (report.unpricedModels.length > 0) {
    lines.push(
      `  (no price on file for ${report.unpricedModels.join(', ')} — add a row to test/helpers/pricing.ts to turn cost accounting on)`,
    );
  }
  if (report.unmeasuredSessions > 0) {
    lines.push(`  (${report.unmeasuredSessions} live session${report.unmeasuredSessions === 1 ? '' : 's'} has no observed usage)`);
  }

  if (report.waiting.length > 0) {
    lines.push('');
    lines.push('WAITING ON YOU');
    for (const m of report.waiting) {
      const why = WHY_STUCK[m.health] ?? m.subtitle ?? 'asked a question';
      lines.push(`  ${MARK[m.health]} ${m.where.padEnd(24)} ${duration(m.ageSec)} old · ${why}`);
    }
  }
  if (report.crashed.length > 0) {
    lines.push('');
    lines.push('CRASHED (recorded as running, pid is gone)');
    for (const m of report.crashed) lines.push(`  ✗ ${m.where.padEnd(24)} pid ${m.pid} · ${m.subtitle}`);
  }

  // `gone` is a session whose process ended some time ago. Fifteen of them
  // accumulate over a fortnight on one machine, and listing every one pushes
  // the live agents off the top of the screen.
  const closed = report.members.filter((m) => m.health === 'gone').length;
  const rest = report.members.filter((m) => !needsHuman(m.health) && m.health !== 'crashed' && m.health !== 'gone');
  if (rest.length > 0) {
    lines.push('');
    for (const m of rest) {
      const owner = m.managerOwned ? m.taskId : 'yours';
      const cost = m.costKnown ? ` $${m.costUsd.toFixed(2)}` : m.costStatus === 'unmeasured' || m.turns > 0 ? ' $?' : '';
      lines.push(
        `  ${MARK[m.health]} ${m.where.padEnd(24)} ${owner.padEnd(20)} ${duration(m.ageSec)}${cost} · ${m.subtitle}`,
      );
    }
  }

  if (closed > 0) lines.push('', `  ${closed} closed session${closed === 1 ? '' : 's'} not shown`);

  if (report.orphanTasks.length > 0) {
    lines.push('');
    lines.push('TASKS WITH NO PANE (manager thinks these are live)');
    for (const t of report.orphanTasks) lines.push(`  ! ${t.id} ${t.project} ${t.state}`);
  }
  if (report.stale.length > 0) {
    lines.push('');
    lines.push('WORKTREES IN THE REGISTRY WHOSE DIRECTORY IS GONE');
    for (const w of report.stale) lines.push(`  ! ${w.taskId} ${w.dir} (branch ${w.branch} still holds the work)`);
  }
  if (report.members.length === 0) lines.push('  no agent sessions on this machine');
  return lines.join('\n');
}
