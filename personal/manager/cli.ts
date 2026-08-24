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
 *   manager fleet [--json]
 *   manager worktrees
 *   manager review-sample [<task-id>]
 *
 * Commands that change something go through the running daemon, so there is
 * exactly one writer of state.json. Read-only commands fall back to reading
 * the files directly when the daemon is down, because "is anything running?"
 * should still answer after a crash.
 */

import * as fs from 'fs';
import { loadConfig, reviewIndependence } from './config';
import { costBreakdown, formatSpend, unmeasuredRuns } from './lib/cost';
import { Orchestrator } from './lib/orchestrator';
import { commandRejection, inferKind, resolveAssertPlan, runAssertGate, type AssertPlan } from './lib/assert-runner';
import { approveCommands, approvedCommandsFor } from './lib/assert-approvals';
import {
  loadProjectRegistry,
  portFile,
  projectsFile,
  registerProject,
  rememberAssertCommands,
  resolveProjectScope,
} from './lib/paths';
import { fleetReport, renderFleet } from './lib/fleet-view';
import { reconcile } from './lib/reconcile';
import { isDirty, listWorktrees, resolveTaskWorkdir, taskDiff } from './lib/worktrees';
import { cmuxAvailable } from './lib/cmux-control';
import { guardIsWired } from './lib/cmux-spawn';
import { configureGlobalAgentCap, resolveSpawnRunner } from './lib/spawn';
import { listTasks, loadTask } from './lib/store';
import {
  listTaskGateRows,
  readBlindSampleReviews,
  recordBlindSampleReview,
  unreviewedBlindSamples,
} from './lib/blind-sample-review';
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
  const spend = formatSpend(task.cost_usd_actual, unmeasuredRuns(task));
  return `${task.id.padEnd(28)} ${task.state.padEnd(10)} ${lane.padEnd(9)} attempt ${task.attempt}/${task.max_attempts}  ${spend}${holds}${flag}${why}`;
}

async function cmdDaemon(): Promise<number> {
  const cfg = loadConfig();
  const cap = await configureGlobalAgentCap();
  const orchestrator = new Orchestrator();
  const report = await reconcile();
  const runner = resolveSpawnRunner();
  const independence = reviewIndependence(cfg);
  line(`manager daemon — agent cap ${cap}, spawn runner ${runner}`);
  line(`  gates: ${independence.line}`);
  if (!independence.fullyIndependent) {
    line('  ⚠ some llm gates share a model family with the agent they grade — their agreement is not corroboration');
  }
  // A cmux daemon that cannot reach cmux answers every task with a failed run,
  // and the reason would only surface one task at a time. Say it at boot.
  if (runner === 'cmux') {
    if (!cmuxAvailable()) line('  ⚠ cmux is not answering — every spawn will fail until the app is running');
    if (cfg.cmuxSkipPermissions && !guardIsWired()) {
      line('  ⚠ pre-tool-use-guard.sh is not wired in ~/.claude/settings.json — permission-free panes will be refused');
    }
  }
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

function cmdRegister(project: string, dir: string): number {
  const result = registerProject(project, dir);
  if (!result.ok) {
    line(`error: ${result.reason}`);
    return 1;
  }
  line(`registered ${project} -> ${result.path}`);
  const plan = resolveAssertPlan(project, result.path, false);
  line(`  oracle: ${describeOracle(plan)}`);
  return 0;
}

function describeOracle(plan: AssertPlan): string {
  if (plan.commands.length > 0) {
    return `${plan.commands.length} command(s) from ${plan.source} — ${plan.commands.map((c) => `${c.cmd} [${c.kind}]`).join(' · ')}`;
  }
  if (plan.pending.length > 0) {
    return `${plan.pending.length} command(s) from ${plan.source} AWAITING APPROVAL — ${plan.pending.map((c) => c.cmd).join(' · ')}`;
  }
  return `NONE (${plan.reason || 'nothing discoverable'}) — §7.1 rule 1: this project cannot enter an autonomous lane`;
}

/**
 * Doubles as the T0.3 inventory. "Does this project have an assertion that runs
 * headless, here, today" is the question that decides whether a lane may ever
 * run unattended, and it was being answered from memory in a table.
 */
function cmdProjects(): number {
  const registry = loadProjectRegistry();
  const names = Object.keys(registry).sort();
  if (names.length === 0) {
    line('no projects registered');
    line(`add one: manager register <name> <path>   (file: ${projectsFile()})`);
    return 0;
  }
  let withOracle = 0;
  for (const name of names) {
    const { scope, reason } = resolveProjectScope(name);
    if (!scope) {
      line(`${name.padEnd(20)} BROKEN  ${reason}`);
      continue;
    }
    const plan = resolveAssertPlan(name, scope, false);
    if (plan.commands.length > 0) withOracle++;
    line(`${name.padEnd(20)} ${scope}`);
    line(`${' '.repeat(20)} oracle: ${describeOracle(plan)}`);
  }
  line('');
  line(`${withOracle}/${names.length} project(s) have a runnable oracle right now`);
  return 0;
}

/**
 * Commands worth a second look before a human waves them through. Not a refusal
 * — an e2e suite is a legitimate oracle in most repos — but this machine's own
 * `test:e2e` costs about $3.85 a run, and an approval granted once is spent on
 * every verify cycle afterwards.
 */
const COSTLY_HINT = /\b(e2e|bench|benchmark|integration|periodic)\b/i;

/**
 * Pins exactly which commands are this project's oracle.
 *
 * Needed because approval is all-or-nothing per plan (assert-runner's
 * gateOnApproval — a half-approved plan would report a partial oracle as a
 * whole one). Discovery on this repo turns up four commands including a paid
 * e2e suite, so "approve everything discovered" is the wrong shape of yes.
 * Choosing the set first, then approving it, keeps both properties.
 */
function cmdAssert(project: string, commands: string[]): number {
  const { scope, reason } = resolveProjectScope(project);
  if (!scope) {
    line(`error: ${reason}`);
    return 1;
  }
  if (commands.length === 0) {
    const plan = resolveAssertPlan(project, scope, false);
    line(`${project} — oracle: ${describeOracle(plan)}`);
    line('');
    line(`set it: manager assert ${project} "bun test" "npx tsc --noEmit"`);
    return 0;
  }
  const rejected = commands.map((cmd) => ({ cmd, why: commandRejection(cmd) })).filter((r) => r.why);
  if (rejected.length > 0) {
    for (const r of rejected) line(`refused "${r.cmd}": ${r.why}`);
    return 1;
  }
  if (!rememberAssertCommands(project, commands)) {
    line(`error: "${project}" is not registered`);
    return 1;
  }
  for (const cmd of commands) line(`assert  ${project}  ${cmd}  [${inferKind(cmd)}]`);
  line('');
  line(`now approve them: manager approve ${project} --all`);
  return 0;
}

/**
 * Runs the project's approved oracle for real and says which of the three
 * answers came back.
 *
 * `manager projects` reports whether a command is REGISTERED. That is a
 * different question from whether it RUNS here today, and §7.4 lesson 2 is
 * that the gap between them is where a fake oracle lives: eivno's integration
 * suite skips silently without TEST_DATABASE_URL, so one machine runs it and
 * another reports green having executed nothing. Nothing enters an autonomous
 * lane on the strength of a command that was only ever read.
 */
async function cmdVerify(project: string, timeoutMs: number): Promise<number> {
  const { scope, reason } = resolveProjectScope(project);
  if (!scope) {
    line(`error: ${reason}`);
    return 1;
  }
  line(`${project} — running its oracle in ${scope}`);
  const result = await runAssertGate({ project, scope, timeoutMs, persist: false });
  if (result.plan.commands.length === 0) {
    line(`  NOT RUNNABLE: ${result.plan.reason || 'no command resolved'}`);
    return 1;
  }
  for (const outcome of result.outcomes) {
    const { run, state } = outcome;
    const counted = run.ran === null ? 'count unreadable' : `${run.ran} ran`;
    line(`  ${state.toUpperCase().padEnd(8)} ${run.cmd}  (exit ${run.exit_code}, ${counted}, ${Math.round(run.duration_ms / 1000)}s)`);
    if (state !== 'green') line(`           ${run.tail.split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 200)}`);
  }
  line('');
  line(`  proven=${result.summary.proven}  oracle_fault=${result.summary.oracle_fault}  ran=${result.summary.ran}  skipped=${result.summary.skipped}`);
  if (!result.summary.proven) {
    line(`  ${result.summary.caught}`);
    line('  oracle_available is FALSE for this project until this passes (§7.1 rule 1).');
  }
  return result.summary.proven ? 0 : 1;
}

function cmdApprove(project: string, args: string[]): number {
  const { scope, reason } = resolveProjectScope(project);
  if (!scope) {
    line(`error: ${reason}`);
    return 1;
  }
  const plan = resolveAssertPlan(project, scope, false);
  const pending = plan.pending;
  if (pending.length === 0) {
    line(`nothing pending for ${project}`);
    const approved = approvedCommandsFor(project);
    if (approved.length > 0) line(`already approved: ${approved.join(' · ')}`);
    else if (plan.reason) line(plan.reason);
    return 0;
  }

  const all = args.includes('--all');
  const picked = all
    ? pending
    : args
        .filter((a) => /^\d+$/.test(a))
        .map((a) => pending[Number(a) - 1])
        .filter(Boolean);

  if (picked.length === 0) {
    line(`${project} — ${pending.length} command(s) awaiting approval (source: ${plan.source})`);
    line('');
    pending.forEach((c, i) => {
      const warn = COSTLY_HINT.test(c.cmd) ? '   <-- may be slow or PAID, check before approving' : '';
      line(`${String(i + 1).padStart(3)}. ${c.cmd}  [${c.kind}]${warn}`);
    });
    line('');
    line(`approve all:  manager approve ${project} --all`);
    line(`narrow first: manager assert ${project} "<cmd>" ...`);
    line('');
    line('Approval is all-or-nothing per plan: a half-approved plan reports a partial');
    line('oracle as if it were the whole one, so approving 1 of 4 leaves 0 runnable.');
    line('To run only some, pin the set with `manager assert` first.');
    return 0;
  }

  approveCommands(project, picked.map((c) => c.cmd));
  for (const c of picked) line(`approved  ${project}  ${c.cmd}`);
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

/**
 * Reads cmux's store directly rather than asking the daemon.
 *
 * The fleet is a property of the machine, not of the manager: panes the
 * operator opened are in it, and they are exactly the ones a daemon-only view
 * would miss. It also has to answer when the daemon is down, which is when
 * "what is still running?" is most worth asking.
 */
function cmdFleet(json: boolean): number {
  const report = fleetReport();
  line(json ? JSON.stringify(report, null, 2) : renderFleet(report));
  return report.waiting.length > 0 || report.crashed.length > 0 ? 1 : 0;
}

function cmdWorktrees(): number {
  const records = listWorktrees();
  if (records.length === 0) {
    line('no task worktrees. The manager creates one per task when the cmux runner is on.');
    return 0;
  }
  for (const r of records) {
    const state = fs.existsSync(r.dir) ? (isDirty(r.dir) ? 'dirty' : 'clean') : 'MISSING';
    line(`${r.taskId.padEnd(24)} ${r.project.padEnd(12)} ${state.padEnd(8)} ${r.branch}`);
    line(`  ${r.dir}`);
  }
  return 0;
}

interface ReviewSampleArgs {
  falsePositiveLines: number[] | null;
  humanFixed: boolean | null;
  note: string;
  error: string;
}

function parseReviewSampleArgs(args: string[]): ReviewSampleArgs {
  let falsePositiveLines: number[] | null = null;
  let humanFixed: boolean | null = null;
  let note = '';
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    if (!['--fp', '--human-fixed', '--note'].includes(flag)) {
      return { falsePositiveLines, humanFixed, note, error: `unknown option ${flag}` };
    }
    if (value === undefined || value.startsWith('--')) {
      return { falsePositiveLines, humanFixed, note, error: `${flag} needs a value` };
    }
    i++;
    if (flag === '--note') {
      note = value;
      continue;
    }
    if (flag === '--human-fixed') {
      if (value !== 'yes' && value !== 'no') {
        return { falsePositiveLines, humanFixed, note, error: '--human-fixed must be yes or no' };
      }
      humanFixed = value === 'yes';
      continue;
    }
    if (value === 'none') {
      falsePositiveLines = [];
      continue;
    }
    const numbers = value.split(',').map(Number);
    if (numbers.length === 0 || numbers.some((n) => !Number.isInteger(n) || n < 1)) {
      return { falsePositiveLines, humanFixed, note, error: '--fp must be none or comma-separated positive line numbers' };
    }
    falsePositiveLines = [...new Set(numbers)];
  }
  return { falsePositiveLines, humanFixed, note, error: '' };
}

function listBlindSamples(): number {
  const tasks = unreviewedBlindSamples();
  line(`blind samples awaiting human review: ${tasks.length}`);
  if (tasks.length === 0) return 0;
  line('');
  for (const task of tasks) {
    line(`${task.id}  ${task.project}/${task.issue}  UNREVIEWED  reported ${task.updated_at}`);
    line(`  open: manager review-sample ${task.id}`);
  }
  return 0;
}

function showBlindSample(task: TaskRecord): number {
  const prior = readBlindSampleReviews().find((review) => review.task_id === task.id);
  if (prior) {
    line(`${task.id}  REVIEWED ${prior.reviewed_at}  fp=${prior.false_positive_lines.length}  human_fixed=${prior.human_fixed ? 'yes' : 'no'}`);
    return 0;
  }
  if (task.state !== 'REPORTED' || task.blind_sample !== true) {
    line(`error: ${task.id} is not a REPORTED blind sample`);
    return 1;
  }

  line(`${task.id}  ${task.project}/${task.issue}  UNREVIEWED`);
  line('');
  line('DIFF');
  const diff = taskDiff(resolveTaskWorkdir(task.id, task.scope, task.worktree_created !== undefined), task);
  if (diff.ok) {
    line(`  SOURCE: ${diff.source === 'preserved' ? `preserved bytes from ${diff.sourcePath}` : `live read from ${diff.sourcePath}`}`);
    process.stdout.write(`${diff.text.trimEnd()}\n`);
  }
  else line(`  UNAVAILABLE: ${diff.error}`);

  line('');
  line('GATE LOG ROWS');
  const rows = listTaskGateRows(task);
  if (rows.stdout) process.stdout.write(rows.stdout);
  if (!rows.ok) line(`  UNAVAILABLE: ${rows.stderr.trim()}`);

  line('');
  line('GATE VERDICTS');
  const reports = task.gate_reports ?? [];
  if (reports.length === 0) line('  (none recorded)');
  for (const report of reports) {
    line(`  ${report.gate} [${report.gate_family}] attempt=${report.attempt} verdict=${report.verdict}${report.caught ? ` — ${report.caught}` : ''}`);
  }

  line('');
  line('FINDINGS');
  if (task.findings.length === 0) line('  (none)');
  for (const finding of task.findings) line(`  ${finding.gate} [${finding.gate_family}] ${finding.text}`);
  line('');
  line('ADVISORIES');
  if ((task.advisories ?? []).length === 0) line('  (none)');
  for (const advisory of task.advisories ?? []) line(`  ${advisory}`);

  line('');
  line('Human verdict is still required; UNREVIEWED does not mean clean.');
  line(`  no false positives: manager review-sample ${task.id} --fp none --human-fixed no --note "review note"`);
  line(`  mark false positives: manager review-sample ${task.id} --fp 1,3 --human-fixed yes --note "why the gates were wrong"`);
  return diff.ok && rows.ok ? 0 : 1;
}

function cmdReviewSample(args: string[]): number {
  if (args.length === 0) return listBlindSamples();
  const task = loadTask(args[0]);
  if (!task) {
    line(`error: no such task ${args[0]}`);
    return 1;
  }
  if (args.length === 1) return showBlindSample(task);
  const parsed = parseReviewSampleArgs(args.slice(1));
  if (parsed.error) {
    line(`error: ${parsed.error}`);
    return 1;
  }
  if (parsed.falsePositiveLines === null || parsed.humanFixed === null) {
    line('error: adjudication requires both --fp none|N,... and --human-fixed yes|no');
    return 1;
  }
  const result = recordBlindSampleReview(task, parsed.falsePositiveLines, parsed.humanFixed, parsed.note);
  if (!result.ok) {
    line(`error: ${result.stderr.trim()}`);
    return 1;
  }
  if (result.stdout) process.stdout.write(result.stdout);
  line(`reviewed ${task.id}: false_positive=${parsed.falsePositiveLines.length}, human_fixed=${parsed.humanFixed ? 'yes' : 'no'}`);
  return 0;
}

function usage(): number {
  line('usage: manager <command>');
  line('  register <name> <path>     register a repo the manager may work in');
  line('  projects                   list projects + whether each has a runnable oracle');
  line('  assert <project> [<cmd>...]  pin which commands are its oracle');
  line('  approve <project> [--all]  review and approve its assert commands');
  line('  verify <project>           RUN its oracle here, now, and report green/red/not-run');
  line('  daemon                     start the manager daemon');
  line('  run <project> <issue>      queue a task');
  line('  status                     list every task');
  line('  stop <task-id>             stop one task');
  line('  stopall                    stop everything');
  line('  report <project>           per-project detail');
  line('  cost [--today]             spend breakdown');
  line('  fleet [--json]             every agent on this machine, yours included');
  line('  worktrees                  per-task checkouts the manager created');
  line('  review-sample [<task-id>]  adjudicate REPORTED blind samples');
  return 1;
}

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case 'register':
      if (rest.length < 2) return usage();
      return cmdRegister(rest[0], rest[1]);
    case 'projects':
      return cmdProjects();
    case 'assert':
      if (rest.length < 1) return usage();
      return cmdAssert(rest[0], rest.slice(1));
    case 'approve':
      if (rest.length < 1) return usage();
      return cmdApprove(rest[0], rest.slice(1));
    case 'verify':
      if (rest.length < 1) return usage();
      return cmdVerify(rest[0], 600_000);
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
    case 'fleet':
      return cmdFleet(rest.includes('--json'));
    case 'worktrees':
      return cmdWorktrees();
    case 'review-sample':
      return cmdReviewSample(rest);
    default:
      return usage();
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
