import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfig } from '../config';
import {
  assertLines,
  classifyRun,
  directExec,
  resolveAssertPlan,
  runAssertCommands,
  summarizeAssertRuns,
  tokenizeCommand,
  type AssertCommand,
  type AssertGateResult,
  type AssertPlan,
  type ExecFn,
} from './assert-runner';
import type { GateReport } from './verdict';
import { gitRaw as git, linkInto, type WorktreeRecord } from './worktrees';

export interface RedTestInput {
  project: string;
  scope: string;
  record: WorktreeRecord | null;
  exec?: ExecFn;
  timeoutMs?: number;
}

export interface RedTestBaseline {
  report: GateReport | null;
  assert: AssertGateResult | null;
  headAssert?: AssertGateResult;
  testFiles: string[];
}

function row(verdict: GateReport['verdict'], caught: string): GateReport {
  return { gate: 'red-test', gate_family: 'deterministic', verdict, caught };
}

function globRegex(glob: string): RegExp | null {
  const normalized = glob.replace(/^<rootDir>\/?/, '').replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || normalized.includes('{') || normalized.includes('[')) return null;
  let source = '';
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    if (char === '*' && normalized[i + 1] === '*') {
      source += '.*';
      i++;
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  try {
    return new RegExp(`^${source}$`);
  } catch {
    return null;
  }
}

function configuredTestPatterns(scope: string): { patterns: RegExp[]; reason: string } {
  const packageFile = path.join(scope, 'package.json');
  if (!fs.existsSync(packageFile)) return { patterns: [], reason: '' };
  let parsed: { jest?: { testMatch?: unknown } };
  try {
    parsed = JSON.parse(fs.readFileSync(packageFile, 'utf-8')) as { jest?: { testMatch?: unknown } };
  } catch {
    return { patterns: [], reason: 'package.json is invalid, so project test-file configuration cannot be read safely' };
  }
  const configured = parsed.jest?.testMatch;
  if (configured === undefined) return { patterns: [], reason: '' };
  if (!Array.isArray(configured) || !configured.every((item) => typeof item === 'string')) {
    return { patterns: [], reason: 'package.json jest.testMatch is not a string array' };
  }
  const patterns = configured.map(globRegex);
  if (patterns.some((pattern) => pattern === null)) {
    return { patterns: [], reason: 'package.json jest.testMatch uses a pattern the manager cannot classify safely' };
  }
  return { patterns: patterns as RegExp[], reason: '' };
}

function commonTestPath(file: string): boolean {
  const normalized = file.replaceAll('\\', '/');
  const base = path.posix.basename(normalized);
  return (
    /(^|\/)(test|tests|__tests__)(\/|$)/i.test(normalized) ||
    /(?:\.test\.|_test\.|\.spec\.|_spec\.)/i.test(base)
  );
}

function testishButUnknown(file: string): boolean {
  return /(^|[._/-])(tests?|specs?)([._/-]|$)/i.test(file.replaceAll('\\', '/'));
}

function changedFiles(record: WorktreeRecord): { files: string[]; reason: string } {
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'], record.dir);
  if (!untracked.ok) return { files: [], reason: `cannot list untracked files: ${untracked.stderr || 'no stderr'}` };
  const testLike = untracked.stdout
    .split('\0')
    .filter(Boolean)
    .filter((f) => commonTestPath(f) || testishButUnknown(f));
  if (testLike.length > 0) {
    const intent = git(['add', '--intent-to-add', '--', ...testLike], record.dir);
    if (!intent.ok) return { files: [], reason: `cannot expose untracked task files to git diff: ${intent.stderr || 'no stderr'}` };
  }
  const changed = git(['diff', '--name-only', '-z', record.baseSha], record.dir);
  if (!changed.ok) return { files: [], reason: `cannot list files changed since ${record.baseSha}: ${changed.stderr || 'no stderr'}` };
  return { files: changed.stdout.split('\0').filter(Boolean), reason: '' };
}

function classifyTestFiles(scope: string, files: string[]): { tests: string[]; reason: string } {
  const configured = configuredTestPatterns(scope);
  if (configured.reason) return { tests: [], reason: configured.reason };
  const tests: string[] = [];
  const ambiguous: string[] = [];
  for (const file of files) {
    if (configured.patterns.some((pattern) => pattern.test(file)) || commonTestPath(file)) tests.push(file);
    else if (testishButUnknown(file)) ambiguous.push(file);
  }
  if (ambiguous.length > 0) {
    return { tests: [], reason: `cannot classify test-like changed file(s): ${ambiguous.join(', ')}` };
  }
  if (tests.length === 0) return { tests: [], reason: 'no changed test files were found' };
  return { tests, reason: '' };
}

const UNSUPPORTED_FOCUS = 'red-test cannot target changed test files';
const UNSAFE_FOCUS = 'red-test cannot safely pass changed test path';

type FocusStyle = 'append' | 'jest' | 'npm-script';

function focusStyle(argv: readonly string[]): FocusStyle | null {
  if (argv[0] === 'bun' && argv[1] === 'test') return 'append';
  if (argv[0] === 'bun' && argv[1] === 'run' && argv[2] === 'test') return 'append';
  if (argv[0] === 'npm' && argv[1] === 'run' && argv[2] === 'test') return 'npm-script';
  if (argv[0] === 'npx' && argv[1] === 'jest') return 'jest';
  if (argv[0] === 'jest') return 'jest';
  return null;
}

function focusedTestPlan(project: string, scope: string, testFiles: string[]): AssertPlan {
  const approved = resolveAssertPlan(project, scope, false);
  if (approved.commands.length === 0) return approved;
  let selected: { command: AssertCommand; style: FocusStyle } | null = null;
  for (const command of approved.commands) {
    if (command.kind !== 'suite') continue;
    const parsed = tokenizeCommand(command.cmd);
    if (parsed.error) continue;
    const style = focusStyle(parsed.argv);
    if (style) {
      selected = { command, style };
      break;
    }
  }
  if (!selected) {
    return {
      commands: [],
      pending: [],
      source: approved.source,
      reason: `${UNSUPPORTED_FOCUS} with the approved command(s): ${approved.commands.map((command) => command.cmd).join(' | ')}`,
    };
  }
  const unsafe = testFiles.find(
    (file) => path.isAbsolute(file) || file.split('/').includes('..') || !/^[A-Za-z0-9_./@+-]+$/.test(file),
  );
  if (unsafe) {
    return {
      commands: [],
      pending: [],
      source: approved.source,
      reason: `${UNSAFE_FOCUS}: ${unsafe}`,
    };
  }
  const separator = selected.style === 'npm-script' && !tokenizeCommand(selected.command.cmd).argv.includes('--') ? ' --' : '';
  const exactPath = selected.style === 'jest' && !tokenizeCommand(selected.command.cmd).argv.includes('--runTestsByPath')
    ? ' --runTestsByPath'
    : '';
  const command: AssertCommand = { cmd: `${selected.command.cmd}${separator}${exactPath} ${testFiles.join(' ')}`, kind: 'suite' };
  return { commands: [command], pending: [], source: approved.source, reason: '' };
}

async function runFocusedBaselineAssert(input: RedTestInput, cwd: string, testFiles: string[]): Promise<AssertGateResult> {
  const plan = focusedTestPlan(input.project, input.scope, testFiles);
  const runs =
    plan.commands.length === 0
      ? []
      : await runAssertCommands(plan.commands, cwd, {
          timeoutMs: input.timeoutMs,
          exec: input.exec ?? directExec,
        });
  const outcomes = runs.map(classifyRun);
  const summary = summarizeAssertRuns(outcomes, plan);
  const reports =
    outcomes.length > 0
      ? outcomes.map((outcome) => outcome.report)
      : [{ gate: 'B8-assert', gate_family: 'deterministic' as const, verdict: summary.verdict, caught: summary.caught }];
  return { reports, outcomes, runs, plan, summary, lines: assertLines(runs) };
}

function cleanupCheckout(repo: string, dir: string): void {
  git(['worktree', 'remove', '--force', dir], repo);
  try {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch {
  }
  git(['worktree', 'prune'], repo);
}

export async function runRedTestBaseline(input: RedTestInput): Promise<RedTestBaseline> {
  const record = input.record;
  if (!record) {
    return { report: row('skipped', 'red-test needs a manager worktree record with baseSha; this task has none'), assert: null, testFiles: [] };
  }
  if (!record.baseSha) {
    return { report: row('skipped', 'red-test worktree record has no baseSha'), assert: null, testFiles: [] };
  }
  const changed = changedFiles(record);
  if (changed.reason) return { report: row('skipped', changed.reason), assert: null, testFiles: [] };
  const classified = classifyTestFiles(input.scope, changed.files);
  if (classified.reason) return { report: row('skipped', classified.reason), assert: null, testFiles: [] };

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'manager-red-test-'));
  const checkout = path.join(root, 'base');
  try {
    const added = git(['worktree', 'add', '--detach', checkout, record.baseSha], record.repo);
    if (!added.ok) {
      return { report: row('skipped', `cannot create temporary checkout at ${record.baseSha}: ${added.stderr || 'no stderr'}`), assert: null, testFiles: classified.tests };
    }
    linkInto(checkout, record.repo, loadConfig().worktreeLinks);
    const patch = git(['diff', '--binary', record.baseSha, '--', ...classified.tests], record.dir);
    if (!patch.ok) {
      return { report: row('skipped', `cannot isolate changed test files: ${patch.stderr || 'git diff failed'}`), assert: null, testFiles: classified.tests };
    }
    if (!patch.stdout.trim()) {
      return { report: row('skipped', `changed test file diff is empty: ${classified.tests.join(', ')}`), assert: null, testFiles: classified.tests };
    }
    const applied = git(['apply', '--whitespace=nowarn', '-'], checkout, 120_000, patch.stdout);
    if (!applied.ok) {
      return { report: row('skipped', `cannot apply isolated test diff at baseSha: ${applied.stderr || 'git apply failed'}`), assert: null, testFiles: classified.tests };
    }
    const assertion = await runFocusedBaselineAssert({
      project: input.project,
      scope: input.scope,
      exec: input.exec,
      timeoutMs: input.timeoutMs,
      record: input.record,
    }, checkout, classified.tests);
    if (assertion.plan.commands.length === 0) {
      return { report: row('skipped', `red-test has no runnable assert command: ${assertion.plan.reason}`), assert: assertion, testFiles: classified.tests };
    }
    if (assertion.summary.oracle_fault) {
      return { report: row('skipped', `red-test baseline assert did not produce a verdict: ${assertion.summary.caught}`), assert: assertion, testFiles: classified.tests };
    }
    const headAssert = assertion.summary.verdict === 'caught'
      ? await runFocusedBaselineAssert(input, record.dir, classified.tests)
      : undefined;
    return { report: null, assert: assertion, headAssert, testFiles: classified.tests };
  } finally {
    cleanupCheckout(record.repo, checkout);
    try {
      if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
    } catch {
    }
  }
}

export function finishRedTest(baseline: RedTestBaseline, head: AssertGateResult | null): GateReport {
  if (baseline.report) return baseline.report;
  if (!baseline.assert) return row('skipped', 'red-test baseline assert result is missing');
  if (baseline.assert.summary.proven) {
    return row(
      'error',
      `red-test finding: assert was green at baseSha after applying only ${baseline.testFiles.join(', ')}; the changed test does not exercise the pre-fix bug`,
    );
  }
  if (baseline.assert.summary.verdict !== 'caught') {
    return row('skipped', `red-test baseline assert was not classifiable as red: ${baseline.assert.summary.caught}`);
  }
  if (!baseline.headAssert?.summary.proven) {
    return row('skipped', 'red-test baseline was red, but the changed test was not green at task HEAD');
  }
  if (!head?.summary.proven) {
    return row('skipped', 'red-test baseline was red, but B8-assert was not green at task HEAD');
  }
  return row(
    'caught',
    `manager reproduced red at baseSha including ${baseline.testFiles.join(', ')}, then the changed test and B8-assert were green at task HEAD`,
  );
}
