import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-assert-'));
process.env.MANAGER_HOME = HOME;
process.env.GSTACK_GATE_LOG_DIR = path.join(HOME, 'gate-log');

import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import {
  AGENT_BINARY_DENYLIST,
  classifyRun,
  commandRejection,
  discoverFromClaudeMd,
  discoverFromPackageJson,
  inferKind,
  normalizeAssertCommands,
  parseTestCounts,
  resolveAssertPlan,
  runAssertGate,
  shellExec,
  summarizeAssertRuns,
  type AssertRun,
  type ExecFn,
} from '../lib/assert-runner';
import { ensureManagerDirs, projectEntry, projectsFile } from '../lib/paths';

const REPO = fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-assert-repo-'));

function register(value: unknown): void {
  ensureManagerDirs();
  fs.writeFileSync(projectsFile(), JSON.stringify({ demo: value }, null, 2));
}

function clearRepo(): void {
  for (const f of ['CLAUDE.md', 'package.json', 'bun.lockb', 'pnpm-lock.yaml', 'yarn.lock']) {
    fs.rmSync(path.join(REPO, f), { force: true });
  }
}

function run(overrides: Partial<AssertRun> = {}): AssertRun {
  return {
    cmd: 'bun run test',
    kind: 'suite',
    exit_code: 0,
    duration_ms: 10,
    timed_out: false,
    ran: 12,
    skipped: 0,
    total: 12,
    tail: '',
    ...overrides,
  };
}

const stubExec =
  (result: { exitCode?: number; stdout?: string; timedOut?: boolean }): ExecFn =>
  async () => ({
    exitCode: result.exitCode ?? 0,
    stdout: result.stdout ?? '',
    stderr: '',
    timedOut: result.timedOut ?? false,
  });

beforeEach(() => {
  clearRepo();
  register(REPO);
});

afterAll(() => {
  for (const dir of [HOME, REPO]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

// The whole reason B8-assert counts as deterministic evidence is that the
// manager runs the command and reads the exit code instead of asking an agent
// whether the tests passed. That only holds while the command really is the
// project's test command — a "test command" that launches an agent would be a
// second spawn route outside the semaphore and outside the cost ledger.
describe('what the runner refuses to run', () => {
  test('an agent binary is refused by name', () => {
    for (const binary of AGENT_BINARY_DENYLIST) {
      expect(commandRejection(`${binary} -p "run the tests"`), `${binary} slipped through`).toContain(binary);
    }
  });

  test('an agent binary buried mid-command is still caught', () => {
    expect(commandRejection('bun run test && codex exec "fix it"')).toContain('codex');
    expect(commandRejection('npx claude.cmd -p x')).toContain('claude');
  });

  test('a watch or dev command is refused because it never exits', () => {
    expect(commandRejection('bun run test:watch')).toContain('watch');
    expect(commandRejection('npm run dev')).toContain('watch');
    expect(commandRejection('bun run test:evals')).not.toBe('');
  });

  test('an ordinary test command is allowed', () => {
    for (const cmd of ['bun run test', 'npx vitest run', 'npm test', 'npx tsc --noEmit', 'yarn lint']) {
      expect(commandRejection(cmd), `${cmd} was refused`).toBe('');
    }
  });

  test('a project whose registry names a refused command gets no plan at all', () => {
    register({ path: REPO, assert: ['claude -p "run tests"'] });
    const plan = resolveAssertPlan('demo', REPO, false);
    expect(plan.commands).toHaveLength(0);
    expect(plan.reason).toContain('claude');
  });
});

describe('resolving what to run, without guessing', () => {
  test('an unregistered project is refused, not inferred', () => {
    const plan = resolveAssertPlan('never-registered', REPO, false);
    expect(plan.commands).toHaveLength(0);
    expect(plan.reason).toContain('not registered');
  });

  test('a registered project with nothing to run says so instead of passing', () => {
    const plan = resolveAssertPlan('demo', REPO, false);
    expect(plan.commands).toHaveLength(0);
    expect(plan.source).toBe('none');
    expect(plan.reason).toContain('Add "assert"');
  });

  test('the registry wins over discovery', () => {
    fs.writeFileSync(path.join(REPO, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }));
    register({ path: REPO, assert: [{ cmd: 'bun run mine', kind: 'suite' }] });
    const plan = resolveAssertPlan('demo', REPO, false);
    expect(plan.source).toBe('registry');
    expect(plan.commands.map((c) => c.cmd)).toEqual(['bun run mine']);
  });

  test("the project's own CLAUDE.md is read before anything is guessed", () => {
    fs.writeFileSync(
      path.join(REPO, 'CLAUDE.md'),
      ['# demo', '', '```bash', 'bun install          # deps', 'bun test             # run tests', 'npx tsc --noEmit', 'bun run dev', '```'].join('\n'),
    );
    const plan = resolveAssertPlan('demo', REPO, false);
    expect(plan.source).toBe('claude-md');
    expect(plan.commands.map((c) => c.cmd)).toEqual(['bun test', 'npx tsc --noEmit']);
    expect(plan.commands[0].kind).toBe('suite');
    expect(plan.commands[1].kind).toBe('check');
  });

  test('package.json scripts are the fallback, with the right package manager', () => {
    fs.writeFileSync(
      path.join(REPO, 'package.json'),
      JSON.stringify({ scripts: { test: 'vitest run', typecheck: 'tsc --noEmit', dev: 'vite' } }),
    );
    fs.writeFileSync(path.join(REPO, 'pnpm-lock.yaml'), '');
    const plan = discoverFromPackageJson(REPO);
    expect(plan.map((c) => c.cmd)).toEqual(['pnpm run test', 'pnpm run typecheck']);
    expect(plan.map((c) => c.kind)).toEqual(['suite', 'check']);
  });

  test('a discovered plan is written back so it is never rediscovered', () => {
    fs.writeFileSync(path.join(REPO, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }));
    const plan = resolveAssertPlan('demo', REPO);
    expect(plan.source).toBe('package-json');
    expect(projectEntry('demo')?.assert).toBeDefined();
    expect(resolveAssertPlan('demo', REPO, false).source).toBe('registry');
  });

  test('discovery never picks up a watch or install line', () => {
    fs.writeFileSync(
      path.join(REPO, 'CLAUDE.md'),
      ['```bash', 'bun install', 'bun run test:watch', 'yarn deploy:test', '```'].join('\n'),
    );
    expect(discoverFromClaudeMd(REPO)).toHaveLength(0);
  });

  test('kind is declared, not guessed, when the registry says so', () => {
    const cmds = normalizeAssertCommands(['npx vitest run', { cmd: 'node scripts/verify.js', kind: 'check' }]);
    expect(cmds).toEqual([
      { cmd: 'npx vitest run', kind: 'suite' },
      { cmd: 'node scripts/verify.js', kind: 'check' },
    ]);
  });

  test('an unrecognised command defaults to check, a test runner to suite', () => {
    expect(inferKind('npx tsc --noEmit')).toBe('check');
    expect(inferKind('npx eslint .')).toBe('check');
    expect(inferKind('npx vitest run')).toBe('suite');
    expect(inferKind('bun test')).toBe('suite');
  });
});

// eivno's integration tests skip silently when TEST_DATABASE_URL is missing:
// same repo, same commit, exit 0, nothing ran. A gate that reads only the exit
// code calls that a pass, which is why §7.4 asks for the count of tests that
// actually RAN rather than the pass/fail state.
describe('reading how many tests actually ran', () => {
  test('bun', () => {
    expect(parseTestCounts(' 93 pass\n 4 skip\n 0 fail\nRan 97 tests across 12 files.')).toEqual({
      ran: 93,
      skipped: 4,
      total: 97,
    });
  });

  test('vitest', () => {
    expect(parseTestCounts('     Tests  93 passed | 4 skipped (97)')).toEqual({ ran: 93, skipped: 4, total: 97 });
  });

  test('jest', () => {
    expect(parseTestCounts('Tests:       4 skipped, 93 passed, 97 total')).toEqual({
      ran: 93,
      skipped: 4,
      total: 97,
    });
  });

  test('a failing run still reports how many executed', () => {
    expect(parseTestCounts('Tests:       1 failed, 92 passed, 93 total').ran).toBe(93);
  });

  test('a suite that found no test files reports zero, not unknown', () => {
    expect(parseTestCounts('No test files found, exiting with code 0')).toEqual({ ran: 0, skipped: 0, total: 0 });
  });

  test('an unrecognised reporter reports unknown, never zero and never a count', () => {
    expect(parseTestCounts('everything is fine')).toEqual({ ran: null, skipped: null, total: null });
  });
});

describe('green, red, and never-ran are three different answers', () => {
  test('a suite that ran and passed is green', () => {
    const outcome = classifyRun(run());
    expect(outcome.state).toBe('green');
    expect(outcome.report.verdict).toBe('pass');
    expect(outcome.report.caught).toBe('');
    expect(outcome.report.gate_family).toBe('deterministic');
  });

  test('a non-zero exit is red and says how far it got', () => {
    const outcome = classifyRun(run({ exit_code: 1, ran: 11, tail: 'expected 3 got 4' }));
    expect(outcome.state).toBe('red');
    expect(outcome.report.verdict).toBe('caught');
    expect(outcome.report.caught).toContain('11 test(s) ran');
  });

  test('exit 0 over zero tests is NOT a pass', () => {
    const outcome = classifyRun(run({ ran: 0, skipped: 7, total: 7 }));
    expect(outcome.state).toBe('not-run');
    expect(outcome.report.verdict).toBe('skipped');
    expect(outcome.report.caught).toContain('ran 0 tests');
    expect(outcome.report.caught).toContain('7 skipped');
  });

  test('exit 0 with an unreadable count is NOT a pass either', () => {
    const outcome = classifyRun(run({ ran: null, skipped: null, total: null }));
    expect(outcome.state).toBe('not-run');
    expect(outcome.report.verdict).toBe('skipped');
    expect(outcome.report.caught).toContain('no test count');
  });

  test('a check has no count to owe, so exit 0 is enough', () => {
    const outcome = classifyRun(run({ kind: 'check', ran: null, skipped: null, total: null }));
    expect(outcome.state).toBe('green');
    expect(outcome.report.verdict).toBe('pass');
  });

  test('a timeout is an oracle failure, not a code failure', () => {
    const outcome = classifyRun(run({ timed_out: true, exit_code: -1 }));
    expect(outcome.state).toBe('not-run');
    expect(outcome.report.verdict).toBe('error');
    expect(outcome.report.caught).toContain('did not finish');
  });
});

describe('the one flow decision made from those answers', () => {
  const plan = { commands: [{ cmd: 'x', kind: 'suite' as const }], source: 'registry' as const, reason: '' };

  test('all green is proven', () => {
    const summary = summarizeAssertRuns([classifyRun(run())], plan);
    expect(summary).toMatchObject({ verdict: 'pass', proven: true, oracle_fault: false, ran: 12 });
  });

  test('red is not proven and is the code\'s fault, so a retry has something to learn', () => {
    const summary = summarizeAssertRuns([classifyRun(run({ exit_code: 2 }))], plan);
    expect(summary.proven).toBe(false);
    expect(summary.oracle_fault).toBe(false);
  });

  test('never-ran is not proven and is the ORACLE\'s fault, so a retry learns nothing', () => {
    const summary = summarizeAssertRuns([classifyRun(run({ ran: 0, skipped: 3 }))], plan);
    expect(summary.proven).toBe(false);
    expect(summary.oracle_fault).toBe(true);
  });

  test('red wins over never-ran: a broken test is the more actionable answer', () => {
    const summary = summarizeAssertRuns([classifyRun(run({ ran: 0 })), classifyRun(run({ exit_code: 1 }))], plan);
    expect(summary.verdict).toBe('caught');
    expect(summary.oracle_fault).toBe(false);
  });

  test('no command at all is an oracle fault, never a quiet pass', () => {
    const summary = summarizeAssertRuns([], { commands: [], source: 'none', reason: 'nothing registered' });
    expect(summary).toMatchObject({ verdict: 'error', proven: false, oracle_fault: true });
  });
});

// Every other test here stubs the command away. These two do not: if the real
// shell path is broken, B8-assert reports an oracle failure on every project
// and the whole split buys nothing.
describe('the real shell path', () => {
  test('an exit code comes back as itself', async () => {
    const ok = await shellExec('echo hello-from-shell', REPO, 30_000);
    expect(ok.exitCode).toBe(0);
    expect(ok.stdout).toContain('hello-from-shell');
    expect(ok.timedOut).toBe(false);

    const bad = await shellExec('exit 3', REPO, 30_000);
    expect(bad.exitCode).toBe(3);
  });

  test('a command that will not finish stops being waited on', async () => {
    fs.writeFileSync(path.join(REPO, 'slow.js'), 'await new Promise((r) => setTimeout(r, 30000));\n');
    const started = Date.now();
    const slow = await shellExec('bun slow.js', REPO, 300);
    const elapsed = Date.now() - started;
    expect(slow.timedOut).toBe(true);
    expect(elapsed, 'the timeout must bound the wait, not just label it').toBeLessThan(10_000);
  }, 30_000);
});

describe('the gate as a whole', () => {
  test('one row per command, so a green suite and a red check both get said', async () => {
    register({ path: REPO, assert: [{ cmd: 'suite-a', kind: 'suite' }, { cmd: 'check-b', kind: 'check' }] });
    let call = 0;
    const exec: ExecFn = async () => {
      call++;
      return call === 1
        ? { exitCode: 0, stdout: ' 5 pass\n 0 fail\nRan 5 tests across 1 files.', stderr: '', timedOut: false }
        : { exitCode: 1, stdout: 'TS2345', stderr: '', timedOut: false };
    };
    const result = await runAssertGate({ project: 'demo', scope: REPO, exec, persist: false });

    expect(result.reports).toHaveLength(2);
    expect(result.reports[0].verdict).toBe('pass');
    expect(result.reports[1].verdict).toBe('caught');
    expect(result.summary.proven).toBe(false);
    expect(result.lines[0]).toContain('5 ran');
  });

  test('the report it produces is deterministic, because the manager ran it', async () => {
    register({ path: REPO, assert: ['bun run test'] });
    const result = await runAssertGate({
      project: 'demo',
      scope: REPO,
      exec: stubExec({ stdout: ' 3 pass\n 0 fail\nRan 3 tests across 1 files.' }),
      persist: false,
    });
    expect(result.reports.every((r) => r.gate_family === 'deterministic')).toBe(true);
    expect(result.reports.every((r) => r.gate === 'B8-assert')).toBe(true);
    expect(result.summary.ran).toBe(3);
  });
});
