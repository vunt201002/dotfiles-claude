/**
 * The gates, run against the fixture set.
 *
 * Every gate reports one of four verdicts per fixture. `n_a` and `error` are
 * kept apart from `missed` on purpose: a gate that cannot be applied is not a
 * gate that looked and saw nothing, and a gate whose tooling is missing must
 * never be reported as a gate that passed.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { APPARATUS_DIR, type FixtureCase, type GuardFpProbe } from './cases';
import { ORIGIN_ENV } from '../../manager/lib/gate-log';

export type Verdict = 'caught' | 'missed' | 'n_a' | 'error';
export type GateFamily = 'deterministic' | 'llm';

export interface GateCell {
  verdict: Verdict;
  detail: string;
}

export interface FalsePositive {
  on: string;
  detail: string;
}

export interface GateOutcome {
  gate: string;
  family: GateFamily;
  available: boolean;
  unavailable_reason: string;
  cells: Record<string, GateCell>;
  false_positives: FalsePositive[];
  fp_denominator: number;
}

const GUARD_SCRIPT = path.resolve(APPARATUS_DIR, '..', 'hooks', 'pre-tool-use-guard.sh');
const ESLINT_CONFIG = path.join(APPARATUS_DIR, 'lib', 'eslint.config.mjs');
const CANARY_DIR = path.join(APPARATUS_DIR, 'lib', 'canaries');
const TOOL_TIMEOUT_MS = 600_000;

function quote(arg: string): string {
  return /[\s"']/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

interface Run {
  code: number;
  stdout: string;
  stderr: string;
  spawnError: string;
}

function runShell(cmd: string, args: string[], input?: string, env?: NodeJS.ProcessEnv): Run {
  const res = spawnSync(cmd, args.map(quote), {
    encoding: 'utf-8',
    shell: true,
    input,
    env: env ? { ...process.env, ...env } : undefined,
    timeout: TOOL_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    code: res.status ?? -1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    spawnError: res.error ? String(res.error.message) : '',
  };
}

/**
 * Compilers and linters report a file however they feel like it — tsc echoes
 * the path relative to cwd, eslint prints it absolute. Matching on the absolute
 * path silently attributed every tsc error to nobody, so every fixture read as
 * "missed". Match on the fixture-relative tail instead, which both spellings
 * contain.
 */
function normalize(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

function caseMarker(c: FixtureCase, variant: string): string {
  return normalize(path.join('fixtures', c.bug.id, variant));
}

function emptyOutcome(gate: string, family: GateFamily): GateOutcome {
  return { gate, family, available: true, unavailable_reason: '', cells: {}, false_positives: [], fp_denominator: 0 };
}

function markAll(outcome: GateOutcome, cases: FixtureCase[], verdict: Verdict, detail: string): GateOutcome {
  for (const c of cases) outcome.cells[c.bug.id] = { verdict, detail };
  return outcome;
}

export function runGuardGate(cases: FixtureCase[], fpProbes: GuardFpProbe[]): GateOutcome {
  const out = emptyOutcome('guard', 'deterministic');

  if (!fs.existsSync(GUARD_SCRIPT)) {
    out.available = false;
    out.unavailable_reason = `guard hook not found at ${GUARD_SCRIPT}`;
    return markAll(out, cases, 'error', out.unavailable_reason);
  }
  const jq = runShell('jq', ['--version']);
  if (jq.code !== 0) {
    out.available = false;
    out.unavailable_reason = 'jq is not on PATH — the guard hook is a no-op without it, which is itself the 2026-08 Windows failure';
    return markAll(out, cases, 'error', out.unavailable_reason);
  }

  // Stamped on the child, not on process.env — a test file sharing this process must not inherit it.
  const call = (payload: unknown): Run =>
    runShell('bash', [GUARD_SCRIPT], JSON.stringify(payload), { [ORIGIN_ENV]: 'gate-test' });

  const canary = call({ tool_input: { command: 'rm -rf /' } });
  if (canary.code !== 2) {
    out.available = false;
    out.unavailable_reason = `canary did not trip: the guard let "rm -rf /" through (exit ${canary.code}). A gate that answers "no findings" while broken is worse than no gate.`;
    return markAll(out, cases, 'error', out.unavailable_reason);
  }

  for (const c of cases) {
    const inputs = c.bug.guard_input;
    if (!inputs) {
      out.cells[c.bug.id] = { verdict: 'n_a', detail: 'no tool call to judge — this bug never reaches the guard surface' };
      continue;
    }
    const buggy = call(inputs.buggy);
    out.cells[c.bug.id] = buggy.code === 2
      ? { verdict: 'caught', detail: buggy.stderr.trim().split('\n')[0] ?? '' }
      : { verdict: 'missed', detail: `guard allowed the call (exit ${buggy.code})` };

    const fixed = call(inputs.fixed);
    out.fp_denominator++;
    if (fixed.code === 2) {
      out.false_positives.push({ on: `${c.bug.id}/fixed`, detail: fixed.stderr.trim().split('\n')[0] ?? '' });
    }
  }

  for (const probe of fpProbes) {
    const res = call(probe.input);
    out.fp_denominator++;
    if (res.code === 2) {
      out.false_positives.push({ on: probe.id, detail: `${probe.why_benign} — blocked anyway` });
    }
  }

  return out;
}

function toolMissing(run: Run, marker: string): string {
  if (run.spawnError) return run.spawnError;
  const combined = `${run.stdout}\n${run.stderr}`;
  if (combined.includes('not the tsc command you are looking for')) {
    return 'npx resolved the decoy `tsc` package instead of typescript';
  }
  if (/could not determine executable|npm error|not found/i.test(combined) && !combined.includes(marker)) {
    return combined.trim().split('\n').slice(0, 3).join(' / ');
  }
  return '';
}

export function runTscGate(cases: FixtureCase[]): GateOutcome {
  const out = emptyOutcome('tsc', 'deterministic');
  const tsCases = cases.filter(c => c.bug.lang === 'ts');
  for (const c of cases) {
    if (c.bug.lang !== 'ts') {
      out.cells[c.bug.id] = { verdict: 'n_a', detail: `fixture is ${c.bug.lang}, not typescript` };
    }
  }
  if (tsCases.length === 0) return out;

  const flags = ['--noEmit', '--strict', '--target', 'es2022', '--module', 'esnext', '--moduleResolution', 'bundler'];
  const probe = runShell('npx', ['--yes', '--package', 'typescript', '--', 'tsc', '--version']);
  const missing = toolMissing(probe, 'Version');
  if (missing || probe.code !== 0) {
    out.available = false;
    out.unavailable_reason = `typescript unavailable: ${missing || probe.stderr.trim() || `exit ${probe.code}`}`;
    for (const c of tsCases) out.cells[c.bug.id] = { verdict: 'error', detail: out.unavailable_reason };
    return out;
  }

  const canaryFile = path.join(CANARY_DIR, 'tsc-canary.ts');
  let attributionOk = true;

  const compile = (variant: 'buggy' | 'fixed' | 'ratchet', subset: FixtureCase[]): Map<string, string[]> => {
    const files = subset
      .map(c => path.join(c.dir, variant, 'index.ts'))
      .filter(f => fs.existsSync(f));
    const byCase = new Map<string, string[]>();
    if (files.length === 0) return byCase;
    const run = runShell('npx', ['--yes', '--package', 'typescript', '--', 'tsc', ...flags, ...files, canaryFile]);
    const lines = `${run.stdout}\n${run.stderr}`.split('\n').filter(l => /error TS\d+/.test(l));
    if (!lines.some(l => normalize(l).includes('canaries/tsc-canary.ts'))) attributionOk = false;
    for (const c of subset) {
      const marker = caseMarker(c, variant);
      const mine = lines.filter(l => normalize(l).includes(marker));
      if (mine.length > 0) byCase.set(c.bug.id, mine);
    }
    return byCase;
  };

  const onBuggy = compile('buggy', tsCases);
  if (!attributionOk) {
    out.available = false;
    out.unavailable_reason = 'canary did not trip: tsc did not flag a string assigned to a number, or its output could not be traced back to the file it came from. Every "missed" would be indistinguishable from a compiler that never ran.';
    for (const c of tsCases) out.cells[c.bug.id] = { verdict: 'error', detail: out.unavailable_reason };
    return out;
  }
  for (const c of tsCases) {
    const hits = onBuggy.get(c.bug.id);
    out.cells[c.bug.id] = hits
      ? { verdict: 'caught', detail: hits[0] }
      : { verdict: 'missed', detail: 'compiles clean under --strict' };
  }

  const onFixed = compile('fixed', tsCases);
  for (const c of tsCases) {
    out.fp_denominator++;
    const hits = onFixed.get(c.bug.id);
    if (hits) out.false_positives.push({ on: `${c.bug.id}/fixed`, detail: hits[0] });
  }

  return out;
}

export function runTscRatchet(cases: FixtureCase[]): Record<string, { holds: boolean; detail: string }> {
  const result: Record<string, { holds: boolean; detail: string }> = {};
  const withRatchet = cases.filter(c => c.ratchetDir);
  if (withRatchet.length === 0) return result;

  const flags = ['--noEmit', '--strict', '--target', 'es2022', '--module', 'esnext', '--moduleResolution', 'bundler'];
  for (const c of withRatchet) {
    const file = path.join(c.ratchetDir!, 'index.ts');
    const run = runShell('npx', ['--yes', '--package', 'typescript', '--', 'tsc', ...flags, file]);
    const errs = `${run.stdout}\n${run.stderr}`.split('\n').filter(l => /error TS\d+/.test(l));
    result[c.bug.id] = errs.length > 0
      ? { holds: true, detail: errs[0] }
      : { holds: false, detail: 'the tightened type compiles against the old call sites — the ratchet does not bite' };
  }
  return result;
}

export function runLintGate(cases: FixtureCase[]): GateOutcome {
  const out = emptyOutcome('lint', 'deterministic');
  const jsCases = cases.filter(c => c.bug.lang === 'js');
  for (const c of cases) {
    if (c.bug.lang === 'ts') {
      out.cells[c.bug.id] = { verdict: 'n_a', detail: 'core ESLint cannot parse typescript; no typescript-eslint parser is resolvable offline here' };
    } else if (c.bug.lang !== 'js') {
      out.cells[c.bug.id] = { verdict: 'n_a', detail: `fixture is ${c.bug.lang}, which eslint does not lint` };
    }
  }
  if (jsCases.length === 0) return out;

  const probe = runShell('npx', ['--yes', '--package', 'eslint', '--', 'eslint', '--version']);
  const missing = toolMissing(probe, 'v');
  if (missing || probe.code !== 0) {
    out.available = false;
    out.unavailable_reason = `eslint unavailable: ${missing || probe.stderr.trim() || `exit ${probe.code}`}`;
    for (const c of jsCases) out.cells[c.bug.id] = { verdict: 'error', detail: out.unavailable_reason };
    return out;
  }

  const canaryFile = path.join(CANARY_DIR, 'lint-canary.js');
  let attributionOk = true;

  const lint = (variant: 'buggy' | 'fixed', subset: FixtureCase[]): Map<string, string[]> => {
    const files = subset
      .map(c => path.join(c.dir, variant, 'index.js'))
      .filter(f => fs.existsSync(f));
    const byCase = new Map<string, string[]>();
    if (files.length === 0) return byCase;
    const run = runShell('npx', [
      '--yes', '--package', 'eslint', '--', 'eslint',
      '--no-config-lookup', '--config', ESLINT_CONFIG, '--format', 'json', ...files, canaryFile,
    ]);
    const jsonStart = run.stdout.indexOf('[');
    if (jsonStart === -1) {
      attributionOk = false;
      return byCase;
    }
    let parsed: any[];
    try {
      parsed = JSON.parse(run.stdout.slice(jsonStart));
    } catch {
      attributionOk = false;
      return byCase;
    }
    const errorsFor = (marker: string) => parsed
      .filter(r => normalize(String(r.filePath)).includes(marker))
      .flatMap(r => (r.messages ?? []).filter((m: any) => m.severity === 2))
      .map((m: any) => `${m.ruleId ?? 'parse-error'}: ${m.message}`);

    if (errorsFor('canaries/lint-canary.js').length === 0) attributionOk = false;

    for (const c of subset) {
      const mine = errorsFor(caseMarker(c, variant));
      if (mine.length > 0) byCase.set(c.bug.id, mine);
    }
    return byCase;
  };

  const onBuggy = lint('buggy', jsCases);
  if (!attributionOk) {
    out.available = false;
    out.unavailable_reason = 'canary did not trip: eslint did not flag an undefined global and an unused binding, or its output could not be traced back to the file it came from. Every "missed" would be indistinguishable from a linter that never ran.';
    for (const c of jsCases) out.cells[c.bug.id] = { verdict: 'error', detail: out.unavailable_reason };
    return out;
  }
  for (const c of jsCases) {
    const hits = onBuggy.get(c.bug.id);
    out.cells[c.bug.id] = hits
      ? { verdict: 'caught', detail: hits[0] }
      : { verdict: 'missed', detail: 'no eslint:recommended error' };
  }

  const onFixed = lint('fixed', jsCases);
  for (const c of jsCases) {
    out.fp_denominator++;
    const hits = onFixed.get(c.bug.id);
    if (hits) out.false_positives.push({ on: `${c.bug.id}/fixed`, detail: hits[0] });
  }

  return out;
}

export async function runRedTestGate(cases: FixtureCase[]): Promise<GateOutcome> {
  const out = emptyOutcome('red-test', 'deterministic');

  for (const c of cases) {
    let onBuggy;
    try {
      onBuggy = await c.probe.run(c.buggyDir);
    } catch (err: any) {
      out.cells[c.bug.id] = { verdict: 'error', detail: `probe threw on buggy: ${err?.message ?? err}` };
      continue;
    }

    if (onBuggy.detail.startsWith('SKIPPED-LOUD:')) {
      out.cells[c.bug.id] = { verdict: 'error', detail: onBuggy.detail };
      continue;
    }

    out.cells[c.bug.id] = onBuggy.red
      ? { verdict: 'caught', detail: onBuggy.detail }
      : { verdict: 'missed', detail: `the test written from the ticket stays green: ${onBuggy.detail}` };

    out.fp_denominator++;
    try {
      const onFixed = await c.probe.run(c.fixedDir);
      if (onFixed.red) out.false_positives.push({ on: `${c.bug.id}/fixed`, detail: onFixed.detail });
    } catch (err: any) {
      out.false_positives.push({ on: `${c.bug.id}/fixed`, detail: `probe threw on fixed: ${err?.message ?? err}` });
    }
  }

  return out;
}

export interface FixtureIntegrity {
  id: string;
  ok: boolean;
  detail: string;
}

/**
 * Refuses to let the suite report numbers about fixtures that do not actually
 * break. Every case must have a witness that is red on `buggy` and green on
 * `fixed`; without that, a fixture could quietly be measuring nothing.
 */
export async function verifyFixtures(cases: FixtureCase[]): Promise<FixtureIntegrity[]> {
  const results: FixtureIntegrity[] = [];
  for (const c of cases) {
    try {
      const onBuggy = await c.witness.run(c.buggyDir);
      const onFixed = await c.witness.run(c.fixedDir);
      if (onBuggy.detail.startsWith('SKIPPED-LOUD:') || onFixed.detail.startsWith('SKIPPED-LOUD:')) {
        results.push({ id: c.bug.id, ok: false, detail: onBuggy.detail.startsWith('SKIPPED-LOUD:') ? onBuggy.detail : onFixed.detail });
        continue;
      }
      if (onBuggy.red && !onFixed.red) {
        results.push({ id: c.bug.id, ok: true, detail: onBuggy.detail });
      } else {
        results.push({
          id: c.bug.id,
          ok: false,
          detail: `witness red on buggy=${onBuggy.red}, red on fixed=${onFixed.red} — the fixture does not demonstrate the bug`,
        });
      }
    } catch (err: any) {
      results.push({ id: c.bug.id, ok: false, detail: `witness threw: ${err?.message ?? err}` });
    }
  }
  return results;
}
