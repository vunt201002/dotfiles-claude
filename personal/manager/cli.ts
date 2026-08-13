/**
 * manager CLI (§6.1).
 *
 *   manager daemon
 *   manager run <project> <issue>
 *   manager status
 *   manager stop <id>
 *   manager stopall
 *   manager report <project>
 *   manager cost [--today]
 *
 * Commands that change something go through the running daemon, so there is
 * exactly one writer of state.json. Read-only commands fall back to reading
 * the files directly when the daemon is down, because "is anything running?"
 * should still answer after a crash.
 */

import * as fs from 'fs';
import { loadConfig } from './config';
import { costBreakdown } from './lib/cost';
import { Orchestrator } from './lib/orchestrator';
import { portFile } from './lib/paths';
import { reconcile } from './lib/reconcile';
import { configureGlobalAgentCap } from './lib/spawn';
import { listTasks } from './lib/store';
import { readToken, startServer } from './server';
import type { TaskRecord } from './types';

interface DaemonAddress {
  port: number;
  token: string;
}

function daemonAddress(): DaemonAddress | null {
  try {
    const port = Number(fs.readFileSync(portFile(), 'utf-8').trim());
    const token = readToken();
    if (!Number.isFinite(port) || port <= 0 || !token) return null;
    return { port, token };
  } catch {
    return null;
  }
}

async function callDaemon(
  method: string,
  route: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown; error: string }> {
  const address = daemonAddress();
  if (!address) return { ok: false, status: 0, data: null, error: 'daemon is not running (no port file)' };
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${route}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Manager-Token': address.token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    return {
      ok: response.ok,
      status: response.status,
      data,
      error: response.ok ? '' : String((data as { error?: string })?.error ?? response.statusText),
    };
  } catch (err) {
    return { ok: false, status: 0, data: null, error: `daemon unreachable: ${(err as Error).message}` };
  }
}

function line(text = ''): void {
  process.stdout.write(`${text}\n`);
}

function formatTask(task: TaskRecord): string {
  const holds = task.holds.length > 0 ? ` holds=${task.holds.join(',')}` : '';
  const lane = task.envelope?.lane ?? '-';
  const flag = task.blind_sample ? ' [blind-sample]' : '';
  const why = task.failure_reason ? `  ${task.failure_reason}` : '';
  return `${task.id.padEnd(28)} ${task.state.padEnd(10)} ${lane.padEnd(9)} attempt ${task.attempt}/${task.max_attempts}  $${task.cost_usd_actual.toFixed(2)}${holds}${flag}${why}`;
}

async function cmdDaemon(): Promise<number> {
  const cfg = loadConfig();
  const cap = await configureGlobalAgentCap();
  const orchestrator = new Orchestrator();
  const report = await reconcile();
  line(`manager daemon — agent cap ${cap}, review provider ${cfg.reviewProvider}`);
  for (const failed of report.failed) line(`  reconciled ${failed.id}: ${failed.from} -> FAILED (${failed.why})`);
  for (const lock of report.revokedLocks) line(`  revoked lock ${lock.lock} held by ${lock.task_id} (${lock.why})`);
  for (const id of report.reAsked) line(`  re-asking for approval: ${id}`);

  const server = startServer(orchestrator);
  line(`listening on http://127.0.0.1:${server.port} (token in ~/.gstack/manager/token)`);

  const shutdown = (): void => {
    line('shutting down');
    server.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await new Promise<void>(() => undefined);
  return 0;
}

async function cmdRun(project: string, issue: string): Promise<number> {
  const result = await callDaemon('POST', '/task', { project, issue, source: 'cli' });
  if (!result.ok) {
    line(`error: ${result.error}`);
    return 1;
  }
  line(String((result.data as { taskId: string }).taskId));
  return 0;
}

async function cmdStatus(): Promise<number> {
  const remote = await callDaemon('GET', '/tasks');
  const tasks = remote.ok ? (remote.data as TaskRecord[]) : listTasks();
  if (!remote.ok) line(`(daemon down — reading files directly: ${remote.error})`);
  if (tasks.length === 0) {
    line('no tasks');
    return 0;
  }
  for (const task of tasks) line(formatTask(task));
  return 0;
}

async function cmdStop(id: string): Promise<number> {
  const result = await callDaemon('POST', `/task/${encodeURIComponent(id)}/stop`);
  if (!result.ok) {
    line(`error: ${result.error}`);
    return 1;
  }
  line(`stopped ${id}`);
  return 0;
}

async function cmdStopAll(): Promise<number> {
  const result = await callDaemon('POST', '/stopall');
  if (!result.ok) {
    line(`error: ${result.error}`);
    return 1;
  }
  line(`stopped ${(result.data as { stopped: number }).stopped} task(s)`);
  return 0;
}

async function cmdReport(project: string): Promise<number> {
  const remote = await callDaemon('GET', '/tasks');
  const tasks = (remote.ok ? (remote.data as TaskRecord[]) : listTasks()).filter((t) => t.project === project);
  if (tasks.length === 0) {
    line(`no tasks for ${project}`);
    return 0;
  }
  for (const task of tasks) {
    line(formatTask(task));
    for (const finding of task.findings) line(`    finding ${finding.gate} [${finding.gate_family}] ${finding.text}`);
    for (const reportLine of task.report_lines) line(`    ${reportLine}`);
  }
  return 0;
}

async function cmdCost(today: boolean): Promise<number> {
  const window = today ? 'today' : 'all';
  const remote = await callDaemon('GET', `/cost?window=${window}`);
  const breakdown = remote.ok
    ? (remote.data as ReturnType<typeof costBreakdown>)
    : costBreakdown(listTasks(), window);
  if (!remote.ok) line(`(daemon down — reading files directly: ${remote.error})`);
  line(`${window}: $${breakdown.usd.toFixed(2)}`);
  for (const [lane, usd] of Object.entries(breakdown.byLane)) line(`  lane ${lane.padEnd(10)} $${usd.toFixed(2)}`);
  for (const [project, usd] of Object.entries(breakdown.byProject)) line(`  proj ${project.padEnd(10)} $${usd.toFixed(2)}`);
  return 0;
}

function usage(): number {
  line('usage: manager <command>');
  line('  daemon                     start the manager daemon');
  line('  run <project> <issue>      queue a task');
  line('  status                     list every task');
  line('  stop <task-id>             stop one task');
  line('  stopall                    stop everything');
  line('  report <project>           per-project detail');
  line('  cost [--today]             spend breakdown');
  return 1;
}

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case 'daemon':
      return cmdDaemon();
    case 'run':
      if (rest.length < 2) return usage();
      return cmdRun(rest[0], rest[1]);
    case 'status':
      return cmdStatus();
    case 'stop':
      if (rest.length < 1) return usage();
      return cmdStop(rest[0]);
    case 'stopall':
      return cmdStopAll();
    case 'report':
      if (rest.length < 1) return usage();
      return cmdReport(rest[0]);
    case 'cost':
      return cmdCost(rest.includes('--today'));
    default:
      return usage();
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
