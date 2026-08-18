import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfig } from '../config';
import { runAssertGate, type AssertGateResult, type ExecFn } from './assert-runner';
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
  const intent = git(['add', '-A', '--intent-to-add'], record.dir);
  if (!intent.ok) return { files: [], reason: `cannot expose untracked task files to git diff: ${intent.stderr || 'no stderr'}` };
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
    const assertion = await runAssertGate({
      project: input.project,
      scope: input.scope,
      cwd: checkout,
      exec: input.exec,
      timeoutMs: input.timeoutMs,
      persist: false,
    });
    if (assertion.plan.commands.length === 0) {
      return { report: row('skipped', `red-test has no runnable assert command: ${assertion.plan.reason}`), assert: assertion, testFiles: classified.tests };
    }
    if (assertion.summary.oracle_fault) {
      return { report: row('skipped', `red-test baseline assert did not produce a verdict: ${assertion.summary.caught}`), assert: assertion, testFiles: classified.tests };
    }
    return { report: null, assert: assertion, testFiles: classified.tests };
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
  if (!head?.summary.proven) {
    return row('skipped', 'red-test baseline was red, but B8-assert was not green at task HEAD');
  }
  return row(
    'caught',
    `manager reproduced red at baseSha with only ${baseline.testFiles.join(', ')}, then B8-assert was green at task HEAD`,
  );
}
