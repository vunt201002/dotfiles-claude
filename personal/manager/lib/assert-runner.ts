/**
 * `B8-assert` — the repeatable half of verification, run by the MANAGER (§7.4).
 *
 * The manager executes the project's own runner and reads the exit code. That
 * is the difference between evidence and testimony: everything else the
 * manager knows about a deterministic gate arrives inside an agent's JSON, and
 * §7.3b is explicit that a self-reported deterministic gate is "an LLM's
 * statement ABOUT deterministic evidence", not the evidence. `verdict.ts`
 * therefore demotes any claimed-deterministic gate with no independent witness,
 * and named `B8-assert` as a gate that "has no independent witness by
 * construction". This file is that witness. Nothing here asks an agent
 * anything.
 *
 * Two consequences fall out for free. The run needs no Chrome, so N projects
 * assert at once without contending for the single browser token. And the row
 * it writes into the gate log corroborates a later agent claim of the same
 * gate, which is what lifts the deterministic share the P8 unlock condition
 * reads.
 *
 * The second rule this file exists for: a suite that exits 0 having run
 * nothing is NOT a pass. eivno's integration tests skip silently without
 * TEST_DATABASE_URL — same repo, same commit, green on a machine that ran
 * none of them. So every run records how many tests actually executed, and a
 * zero-count suite is reported as `skipped`, never `pass`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadConfig } from '../config';
import { projectEntry, projectsFile, rememberAssertCommands, type AssertCommandSpec } from './paths';
import type { GateReport } from './verdict';

export type AssertKind = 'suite' | 'check';

export interface AssertCommand {
  cmd: string;
  kind: AssertKind;
}

export type AssertSource = 'registry' | 'claude-md' | 'package-json' | 'none';

export interface AssertPlan {
  commands: AssertCommand[];
  source: AssertSource;
  /** Why the plan is empty. Empty string when commands were found. */
  reason: string;
}

export interface TestCounts {
  /** Tests that actually executed: passed + failed. Null when unreadable. */
  ran: number | null;
  skipped: number | null;
  total: number | null;
}

export interface AssertRun {
  cmd: string;
  kind: AssertKind;
  exit_code: number;
  duration_ms: number;
  timed_out: boolean;
  ran: number | null;
  skipped: number | null;
  total: number | null;
  tail: string;
}

export interface AssertSummary {
  verdict: GateReport['verdict'];
  caught: string;
  /**
   * True only when an oracle actually ran and was green. A green exit code
   * over zero executed tests is false, which is the entire point.
   */
  proven: boolean;
  /**
   * True when the failure is the oracle's, not the code's — nothing ran, the
   * command timed out, no command is registered. Retrying spends money on the
   * same empty answer, so the caller must not treat this as a verify failure.
   */
  oracle_fault: boolean;
  ran: number;
  skipped: number;
}

/**
 * Three states, kept apart on purpose: a suite that ran and was green, a suite
 * that ran and went red, and a suite that never ran (missing env, timeout,
 * zero tests). Collapsing them is the failure §7.4 names — a silently skipped
 * suite reports green and reads as proof.
 */
export type AssertState = 'green' | 'red' | 'not-run';

export interface AssertOutcome {
  run: AssertRun;
  state: AssertState;
  report: GateReport;
}

export interface AssertGateResult {
  /**
   * One row per command, never one row for the whole gate. A plan with a green
   * suite and a red type-check has two things to say, and a single row can
   * only say one of them.
   */
  reports: GateReport[];
  outcomes: AssertOutcome[];
  runs: AssertRun[];
  plan: AssertPlan;
  summary: AssertSummary;
  /** One line per command, carrying the executed-test count for the report. */
  lines: string[];
}

/**
 * A "test command" that launches an agent would spend money outside the
 * semaphore and outside the cost ledger, which is the exact thing the spawn
 * tripwire exists to prevent. The scan is a guardrail over operator-owned
 * config, not airtight enforcement: shell text cannot be analysed reliably,
 * and a determined `sh -c "$(printf ...)"` gets through. It catches the
 * accident, which is the case that happens.
 */
export const AGENT_BINARY_DENYLIST: readonly string[] = [
  'claude',
  'codex',
  'gemini',
  'aider',
  'opencode',
  'cursor-agent',
  'copilot',
  'gstack-detach',
];

const TAIL_CHARS = 2000;
const MAX_DISCOVERED = 4;

/** How long a killed command gets to close its pipes before we stop waiting. */
const KILL_GRACE_MS = 2000;

/** Never run these: they do not terminate, or they cost real money. */
const UNSAFE_COMMAND = /(^|[\s:_-])(-?-?watch|dev|serve|start|install|eval|evals|publish|deploy|release)([\s:]|$)/i;

const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');

const SUITE_HINT = /\b(vitest|jest|mocha|ava|playwright|bun\s+test|node:test|test)\b/i;

const TEST_SCRIPT_NAMES = ['test', 'test:unit', 'typecheck', 'type-check', 'tsc', 'lint', 'check'];

const CHECK_SCRIPT_NAMES = new Set(['typecheck', 'type-check', 'tsc', 'lint', 'check']);

export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE, '');
}

/** Empty string when the command is allowed to run. */
export function commandRejection(cmd: string): string {
  const tokens = stripAnsi(cmd)
    .toLowerCase()
    .split(/[^a-z0-9_.:-]+/)
    .map((t) => t.replace(/\.(exe|cmd|bat|ps1|sh)$/, ''));
  const hit = AGENT_BINARY_DENYLIST.find((binary) => tokens.includes(binary));
  if (hit) return `command names the agent binary "${hit}"; agent spawns go through lib/spawn.ts, never a test command`;
  if (UNSAFE_COMMAND.test(cmd)) return 'command looks like a watch, dev, install, deploy, or paid-eval command';
  return '';
}

/**
 * `check` covers tools with nothing to count (tsc, eslint): the exit code IS
 * the whole signal. Anything that names a test runner is a `suite` and owes a
 * count. When in doubt the answer is `suite`, because the failure this file
 * guards against is a suite mistaken for a clean check.
 */
export function inferKind(cmd: string): AssertKind {
  if (/\b(tsc|typecheck|type-check|eslint|lint|biome|prettier|oxlint)\b/i.test(cmd) && !/\btest\b/i.test(cmd)) {
    return 'check';
  }
  return SUITE_HINT.test(cmd) ? 'suite' : 'check';
}

export function normalizeAssertCommands(raw: Array<string | AssertCommandSpec> | undefined): AssertCommand[] {
  if (!Array.isArray(raw)) return [];
  const out: AssertCommand[] = [];
  for (const item of raw) {
    const cmd = typeof item === 'string' ? item : typeof item?.cmd === 'string' ? item.cmd : '';
    const trimmed = cmd.trim();
    if (!trimmed) continue;
    const declared = typeof item === 'string' ? undefined : item?.kind;
    const kind: AssertKind = declared === 'suite' || declared === 'check' ? declared : inferKind(trimmed);
    out.push({ cmd: trimmed, kind });
  }
  return out;
}

function readIfPresent(file: string): string {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Platform-agnostic discovery, in the order the project instructions demand:
 * the project's own CLAUDE.md first, then whatever the package manifest
 * actually declares. Nothing is guessed from a framework name.
 */
export function discoverFromClaudeMd(scope: string): AssertCommand[] {
  const text = readIfPresent(path.join(scope, 'CLAUDE.md'));
  if (!text) return [];
  const out: AssertCommand[] = [];
  const seen = new Set<string>();
  const fences = [...text.matchAll(/```(?:bash|sh|shell|console)?\s*\n([\s\S]*?)```/g)];
  for (const fence of fences) {
    for (const rawLine of fence[1].split('\n')) {
      const line = rawLine.replace(/\s+#.*$/, '').trim();
      if (!line || line.startsWith('#')) continue;
      if (!/^(bun|npm|yarn|pnpm|npx|deno|make|cargo|go|python|pytest)\b/.test(line)) continue;
      if (!/\b(test|tsc|typecheck|type-check|lint|check)\b/.test(line)) continue;
      if (commandRejection(line)) continue;
      if (seen.has(line)) continue;
      seen.add(line);
      out.push({ cmd: line, kind: inferKind(line) });
      if (out.length >= MAX_DISCOVERED) return out;
    }
  }
  return out;
}

function packageRunner(scope: string): string {
  if (fs.existsSync(path.join(scope, 'bun.lockb')) || fs.existsSync(path.join(scope, 'bun.lock'))) return 'bun run';
  if (fs.existsSync(path.join(scope, 'pnpm-lock.yaml'))) return 'pnpm run';
  if (fs.existsSync(path.join(scope, 'yarn.lock'))) return 'yarn';
  return 'npm run';
}

export function discoverFromPackageJson(scope: string): AssertCommand[] {
  const raw = readIfPresent(path.join(scope, 'package.json'));
  if (!raw) return [];
  let scripts: Record<string, string> = {};
  try {
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
    scripts = parsed?.scripts && typeof parsed.scripts === 'object' ? parsed.scripts : {};
  } catch {
    return [];
  }
  const runner = packageRunner(scope);
  const out: AssertCommand[] = [];
  for (const name of TEST_SCRIPT_NAMES) {
    const body = scripts[name];
    if (typeof body !== 'string' || !body.trim()) continue;
    if (commandRejection(body)) continue;
    const cmd = `${runner} ${name}`;
    const kind: AssertKind = CHECK_SCRIPT_NAMES.has(name) ? 'check' : inferKind(body);
    out.push({ cmd, kind });
    if (out.length >= MAX_DISCOVERED) break;
  }
  return out;
}

/**
 * Registry first, then discovery, then refusal. A project with no resolvable
 * command is reported as an unrunnable oracle, never as a pass — "we could not
 * check this" and "this is clean" are the two answers that must never be
 * printed the same way.
 */
export function resolveAssertPlan(project: string, scope: string, persist = true): AssertPlan {
  const entry = projectEntry(project);
  if (!entry) {
    return { commands: [], source: 'none', reason: `project "${project}" is not registered` };
  }
  const registered = normalizeAssertCommands(entry.assert);
  if (registered.length > 0) {
    const rejected = registered.map((c) => ({ c, why: commandRejection(c.cmd) })).filter((r) => r.why);
    if (rejected.length > 0) {
      return {
        commands: [],
        source: 'registry',
        reason: rejected.map((r) => `refused "${r.c.cmd}": ${r.why}`).join('; '),
      };
    }
    return { commands: registered, source: 'registry', reason: '' };
  }

  const fromDoc = discoverFromClaudeMd(scope);
  if (fromDoc.length > 0) {
    if (persist) rememberAssertCommands(project, fromDoc);
    return { commands: fromDoc, source: 'claude-md', reason: '' };
  }
  const fromPkg = discoverFromPackageJson(scope);
  if (fromPkg.length > 0) {
    if (persist) rememberAssertCommands(project, fromPkg);
    return { commands: fromPkg, source: 'package-json', reason: '' };
  }
  return {
    commands: [],
    source: 'none',
    reason: `no assert command found for "${project}": CLAUDE.md names none and package.json declares none. Add "assert" to its entry in ${projectsFile()} — guessing one would be an oracle nobody approved`,
  };
}

const NO_TESTS_PHRASE = /(no test files found|no tests found|no test suites found|no tests to run|found no test)/i;

function sumSegments(text: string): TestCounts {
  const counts = { passed: 0, failed: 0, skipped: 0, todo: 0, total: 0 };
  let matched = false;
  for (const m of text.matchAll(/(\d+)\s+(passed|failed|skipped|todo|pending|pass|fail|skip|total)\b/gi)) {
    const n = Number(m[1]);
    if (!Number.isFinite(n)) continue;
    matched = true;
    const label = m[2].toLowerCase();
    if (label === 'passed' || label === 'pass') counts.passed += n;
    else if (label === 'failed' || label === 'fail') counts.failed += n;
    else if (label === 'skipped' || label === 'skip' || label === 'pending') counts.skipped += n;
    else if (label === 'todo') counts.todo += n;
    else counts.total += n;
  }
  if (!matched) return { ran: null, skipped: null, total: null };
  const ran = counts.passed + counts.failed;
  const total = counts.total > 0 ? counts.total : ran + counts.skipped + counts.todo;
  return { ran, skipped: counts.skipped + counts.todo, total };
}

/**
 * Reads the executed-test count out of a runner's own summary. Covers the
 * shapes actually on this machine (bun, vitest, jest, playwright); an
 * unrecognised reporter returns nulls, which the summary treats as unproven
 * rather than as a pass.
 */
export function parseTestCounts(raw: string): TestCounts {
  const text = stripAnsi(raw);
  const jest = text.match(/^\s*Tests:\s*(.+)$/m);
  if (jest) return sumSegments(jest[1]);

  const vitest = text.match(/^\s*Tests\s{2,}(.+)$/m);
  if (vitest) {
    if (/no tests/i.test(vitest[1])) return { ran: 0, skipped: 0, total: 0 };
    return sumSegments(vitest[1]);
  }

  const bunLines = [...text.matchAll(/^\s*(\d+)\s+(pass|fail|skip|todo)\s*$/gm)];
  if (bunLines.length > 0) {
    const joined = bunLines.map((m) => `${m[1]} ${m[2]}`).join(' ');
    const counts = sumSegments(joined);
    const ranLine = text.match(/Ran\s+(\d+)\s+tests?/i);
    if (ranLine && counts.ran !== null) {
      return { ran: counts.ran, skipped: counts.skipped, total: Number(ranLine[1]) };
    }
    return counts;
  }

  const playwright = text.match(/^\s*(\d+)\s+(passed|failed|skipped)\b.*$/gm);
  if (playwright && playwright.length > 0) return sumSegments(playwright.join(' '));

  if (NO_TESTS_PHRASE.test(text)) return { ran: 0, skipped: 0, total: 0 };
  return { ran: null, skipped: null, total: null };
}

function shellArgv(cmd: string): string[] {
  return process.platform === 'win32' ? ['cmd.exe', '/d', '/s', '/c', cmd] : ['/bin/sh', '-c', cmd];
}

/** A process that already exited throws on kill; that is the expected case. */
function killQuietly(proc: { kill: () => void }): void {
  try {
    proc.kill();
  } catch {
    return;
  }
}

function tailOf(text: string): string {
  const clean = stripAnsi(text).trimEnd();
  return clean.length > TAIL_CHARS ? `…${clean.slice(-TAIL_CHARS)}` : clean;
}

export interface RunOptions {
  timeoutMs?: number;
  /** Swapped in tests so the suite never shells out. */
  exec?: ExecFn;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type ExecFn = (cmd: string, cwd: string, timeoutMs: number) => Promise<ExecResult>;

/**
 * Runs through the platform shell because the command is operator-written
 * config that legitimately uses `&&` and env prefixes. Async on purpose: a
 * synchronous spawn would block the daemon's event loop for the length of a
 * test suite, which would serialise every other project's assert run and
 * destroy the one property this gate was split out to get.
 *
 * The timeout stops WAITING; it does not always stop the process. On Windows
 * the command runs under `cmd.exe`, and killing that does not kill what it
 * launched, so a runaway `bun test` keeps going and keeps its pipes open.
 * Waiting for those pipes would mean the timeout never fires in the one case
 * it exists for, so the race resolves on its own after a short grace period
 * and the run is reported as timed out with whatever it had. The orphan is a
 * real cost, stated rather than hidden: it costs CPU until it exits, but it
 * cannot report a result and it cannot hold the project lock.
 */
export const shellExec: ExecFn = async (cmd, cwd, timeoutMs) => {
  const proc = Bun.spawn(shellArgv(cmd), {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' },
  });
  let timedOut = false;

  const finished = (async (): Promise<ExecResult> => {
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { exitCode: await proc.exited, stdout, stderr, timedOut: false };
  })();
  finished.catch(() => undefined);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let grace: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<ExecResult>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      killQuietly(proc);
      grace = setTimeout(
        () => resolve({ exitCode: -1, stdout: '', stderr: `killed after ${timeoutMs}ms`, timedOut: true }),
        KILL_GRACE_MS,
      );
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([finished, expired]);
    return { ...result, timedOut: timedOut || result.timedOut };
  } catch (err) {
    return { exitCode: -1, stdout: '', stderr: String((err as Error)?.message ?? err), timedOut };
  } finally {
    if (timer) clearTimeout(timer);
    if (grace) clearTimeout(grace);
  }
};

export async function runAssertCommands(
  commands: AssertCommand[],
  scope: string,
  opts: RunOptions = {},
): Promise<AssertRun[]> {
  const exec = opts.exec ?? shellExec;
  const timeoutMs = opts.timeoutMs ?? loadConfig().assertTimeoutMs;
  const runs: AssertRun[] = [];
  for (const command of commands) {
    const startedAt = Date.now();
    let result: ExecResult;
    try {
      result = await exec(command.cmd, path.resolve(scope), timeoutMs);
    } catch (err) {
      result = { exitCode: -1, stdout: '', stderr: String((err as Error)?.message ?? err), timedOut: false };
    }
    const combined = `${result.stdout}\n${result.stderr}`;
    const counts = command.kind === 'suite' ? parseTestCounts(combined) : { ran: null, skipped: null, total: null };
    runs.push({
      cmd: command.cmd,
      kind: command.kind,
      exit_code: result.exitCode,
      duration_ms: Date.now() - startedAt,
      timed_out: result.timedOut,
      ran: counts.ran,
      skipped: counts.skipped,
      total: counts.total,
      tail: tailOf(combined),
    });
  }
  return runs;
}

/** One human-readable line per command, carrying the executed-test count. */
export function assertLines(runs: AssertRun[]): string[] {
  return runs.map((run) => {
    const status = run.timed_out ? 'timed out' : `exit ${run.exit_code}`;
    if (run.kind === 'check') return `${run.cmd}: ${status}`;
    const counted = run.ran === null ? 'test count unreadable' : `${run.ran} ran, ${run.skipped ?? 0} skipped`;
    return `${run.cmd}: ${status}, ${counted}`;
  });
}

/** One command, one verdict. The aggregate decision is made separately. */
export function classifyRun(run: AssertRun): AssertOutcome {
  const row = (verdict: GateReport['verdict'], caught: string, state: AssertState): AssertOutcome => ({
    run,
    state,
    report: { gate: 'B8-assert', gate_family: 'deterministic', verdict, caught },
  });

  if (run.timed_out) {
    return row(
      'error',
      `${run.cmd} timed out after ${run.duration_ms}ms — the oracle did not finish, so nothing was proven`,
      'not-run',
    );
  }
  if (run.exit_code !== 0) {
    const counted = run.kind === 'suite' && run.ran !== null ? ` after ${run.ran} test(s) ran` : '';
    return row('caught', `${run.cmd} exited ${run.exit_code}${counted}: ${run.tail.slice(-400)}`, 'red');
  }
  if (run.kind === 'suite' && run.ran === 0) {
    return row(
      'skipped',
      `${run.cmd} exited 0 but ran 0 tests (${run.skipped ?? 0} skipped) — green because nothing ran, not because anything passed`,
      'not-run',
    );
  }
  if (run.kind === 'suite' && run.ran === null) {
    return row(
      'skipped',
      `${run.cmd} exited 0 but printed no test count this reader understands — a green suite and a silently skipped one look identical here. Declare it "kind":"check" in the registry if it genuinely has no tests to count`,
      'not-run',
    );
  }
  return row('pass', '', 'green');
}

/**
 * The single flow decision, made from the per-command outcomes.
 *
 * A red suite and an unrun suite are both "not proven" and they are NOT the
 * same thing: red means the code is wrong and another attempt has something to
 * work with, unrun means the oracle is broken and another attempt would spend
 * money to learn nothing. `oracle_fault` is what keeps the retry loop off the
 * second case.
 */
export function summarizeAssertRuns(outcomes: AssertOutcome[], plan: AssertPlan): AssertSummary {
  if (plan.commands.length === 0) {
    return { verdict: 'error', caught: plan.reason, proven: false, oracle_fault: true, ran: 0, skipped: 0 };
  }
  const ran = outcomes.reduce((n, o) => n + (o.run.ran ?? 0), 0);
  const skipped = outcomes.reduce((n, o) => n + (o.run.skipped ?? 0), 0);

  const red = outcomes.filter((o) => o.state === 'red');
  if (red.length > 0) {
    return {
      verdict: 'caught',
      caught: red.map((o) => o.report.caught).join(' | ').slice(0, 480),
      proven: false,
      oracle_fault: false,
      ran,
      skipped,
    };
  }
  const notRun = outcomes.filter((o) => o.state === 'not-run');
  if (notRun.length > 0) {
    return {
      verdict: notRun[0].report.verdict,
      caught: notRun.map((o) => o.report.caught).join(' | ').slice(0, 480),
      proven: false,
      oracle_fault: true,
      ran,
      skipped,
    };
  }
  return { verdict: 'pass', caught: '', proven: true, oracle_fault: false, ran, skipped };
}

export interface AssertGateInput {
  project: string;
  scope: string;
  timeoutMs?: number;
  exec?: ExecFn;
  persist?: boolean;
}

/**
 * The whole gate in one call: resolve, run, count, judge. The returned report
 * carries `gate_family: 'deterministic'` and is NOT subject to the demotion in
 * verdict.ts, because the manager ran the command itself — there is no claim
 * here to corroborate.
 */
export async function runAssertGate(input: AssertGateInput): Promise<AssertGateResult> {
  const plan = resolveAssertPlan(input.project, input.scope, input.persist !== false);
  const runs =
    plan.commands.length === 0
      ? []
      : await runAssertCommands(plan.commands, input.scope, { timeoutMs: input.timeoutMs, exec: input.exec });
  const outcomes = runs.map(classifyRun);
  const summary = summarizeAssertRuns(outcomes, plan);
  const reports =
    outcomes.length > 0
      ? outcomes.map((o) => o.report)
      : [{ gate: 'B8-assert', gate_family: 'deterministic' as const, verdict: summary.verdict, caught: summary.caught }];
  return { reports, outcomes, runs, plan, summary, lines: assertLines(runs) };
}
