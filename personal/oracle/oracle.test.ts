import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  auditDetectionHints, corpusFingerprint, fixtureEscapes, loadCases, loadGuardFpProbes, loadGroundTruth,
  APPARATUS_DIR, FIXTURES_DIR, SHARED_FIXTURE_HARNESS, type CorpusFingerprint, type FixtureCase,
} from './lib/cases';
import { verifyFixtures, runRedTestGate, runGuardGate, runLintGate, runTscGate, runTscRatchet, type Verdict } from './lib/gates';
import { backendLabel, buildFixDiff, llmGatesEnabled, runSpecCheckGate, runReviewerGate, skippedLlmGate } from './lib/llm-gates';
import {
  backendFamily, claudeCliBackend, requireBackendRole, resolveBackends, type Backend,
} from './lib/llm-backends';
import { writeRawReport, type RawReportRun } from './lib/raw-reports';
import { rejudgeRepeat } from './lib/rejudge';
import { outcomeJudgePrompt } from '../../test/helpers/llm-judge';
import {
  summarize, diffBaseline, diffAgainstBaseline, buildReport, render, exitCodeFor, recordObservedNoise,
  selectMedianRejudgeReport, unfitToFreeze, writeBaseline, BASELINE_PATH,
  type GateStats, type OracleReport, type DiffContext,
} from './lib/report';

const slowGates = process.env.ORACLE === '1';
const llm = llmGatesEnabled();

const FIXTURES = 19;

const SPEC_CHECK_NEVER_SCORED: GateStats = {
  gate: 'spec-check',
  family: 'llm',
  gate_backend: '',
  judge_backend: '',
  available: false,
  unavailable_reason: 'ORACLE_LLM=1 is not set — the paid gates are off by default',
  caught: 0, missed: 0, n_a: 0, error: 19, applicable: 0,
  detection_rate: null, coverage: 0, false_positives: 0, fp_errors: 0, fp_denominator: 0, fp_rate: null,
};

const SPEC_CHECK_SCORED: GateStats = {
  gate: 'spec-check',
  family: 'llm',
  gate_backend: 'codex',
  judge_backend: 'claude-cli',
  available: true,
  unavailable_reason: '',
  caught: 17, missed: 2, n_a: 0, error: 0, applicable: 19,
  detection_rate: 0.895, coverage: 1, false_positives: 13, fp_errors: 0, fp_denominator: 19, fp_rate: 0.684,
};

const REVIEWER_SCORED: GateStats = {
  gate: 'reviewer',
  family: 'llm',
  gate_backend: 'codex',
  judge_backend: 'claude-cli',
  available: true,
  unavailable_reason: '',
  caught: 13, missed: 5, n_a: 0, error: 1, applicable: 18,
  detection_rate: 0.722, coverage: 0.947, false_positives: 8, fp_errors: 0, fp_denominator: 18, fp_rate: 0.444,
};

const REVIEWER_NEVER_SCORED: GateStats = { ...SPEC_CHECK_NEVER_SCORED, gate: 'reviewer' };

const REVIEWER_QUOTA_DIED_AFTER_TWO: GateStats = {
  gate: 'reviewer',
  family: 'llm',
  gate_backend: 'codex',
  judge_backend: 'claude-cli',
  available: true,
  unavailable_reason: '',
  caught: 2, missed: 0, n_a: 0, error: 17, applicable: 2,
  detection_rate: 1, coverage: 0.105, false_positives: 0, fp_errors: 0, fp_denominator: 2, fp_rate: 0,
};

const GUARD_AFTER_DENYLIST_SPLIT: GateStats = {
  gate: 'guard',
  family: 'deterministic',
  gate_backend: '',
  judge_backend: '',
  available: true,
  unavailable_reason: '',
  caught: 0, missed: 2, n_a: 17, error: 0, applicable: 2,
  detection_rate: 0, coverage: 0.105, false_positives: 1, fp_errors: 0, fp_denominator: 8, fp_rate: 0.125,
};

const GUARD_BEFORE_DENYLIST_SPLIT: GateStats = {
  ...GUARD_AFTER_DENYLIST_SPLIT,
  false_positives: 4,
  fp_rate: 0.5,
};

const GUARD_CANARY_FAILED: GateStats = {
  ...GUARD_AFTER_DENYLIST_SPLIT,
  available: false,
  unavailable_reason: 'canary did not trip: the guard let "rm -rf /" through (exit 0). A gate that answers "no findings" while broken is worse than no gate.',
  caught: 0, missed: 0, n_a: 0, error: 19, applicable: 0,
  detection_rate: null, coverage: 0, false_positives: 0, fp_denominator: 0, fp_rate: null,
};

const RED_TEST_SCORED: GateStats = {
  gate: 'red-test',
  family: 'deterministic',
  gate_backend: '',
  judge_backend: '',
  available: true,
  unavailable_reason: '',
  caught: 17, missed: 2, n_a: 0, error: 0, applicable: 19,
  detection_rate: 0.895, coverage: 1, false_positives: 0, fp_errors: 0, fp_denominator: 19, fp_rate: 0,
};

const RED_TEST_ALL_ERRORS: GateStats = {
  ...RED_TEST_SCORED,
  caught: 0, missed: 0, n_a: 0, error: 19, applicable: 0,
  detection_rate: null, coverage: 0, fp_denominator: 0, fp_rate: null,
};

const RED_TEST_ALL_BUT_ONE_ERRORS: GateStats = {
  ...RED_TEST_SCORED,
  caught: 1, missed: 0, n_a: 0, error: 18, applicable: 1,
  detection_rate: 1, coverage: 0.053, fp_denominator: 1, fp_rate: 0,
};

const LINT_SCORED: GateStats = {
  gate: 'lint',
  family: 'deterministic',
  gate_backend: '',
  judge_backend: '',
  available: true,
  unavailable_reason: '',
  caught: 0, missed: 6, n_a: 13, error: 0, applicable: 6,
  detection_rate: 0, coverage: 0.316, false_positives: 0, fp_errors: 0, fp_denominator: 6, fp_rate: 0,
};

const PAID_GATES_OFF: DiffContext = {
  operatorDisabledGates: ['spec-check', 'reviewer'],
  operatorReason: 'ORACLE_LLM=1 is not set — the paid gates are off by default',
};

const EVERYTHING_EXPECTED: DiffContext = { operatorDisabledGates: [], operatorReason: '' };

// The fingerprint of the fixtures actually on disk. Changing the corpus moves
// this constant immediately. baseline.json stays on its paid-run digest until
// the next paid measurement freezes matching numbers and provenance.
const CORPUS_DIGEST = '90429966daaa1bb0';

const SAME_CORPUS: CorpusFingerprint = { fixtures: FIXTURES, digest: CORPUS_DIGEST };

interface ReportParts {
  matrix?: Record<string, Record<string, Verdict>>;
  ratchet?: Record<string, { holds: boolean; detail: string }>;
  corpus?: CorpusFingerprint | null;
}

function reportWith(gates: GateStats[], parts: ReportParts = {}): OracleReport {
  const llmGateFamilies = gates.filter(g => g.family === 'llm' && g.gate_backend).map(g => backendFamily(g.gate_backend));
  return {
    generated_at: '2026-08-14T04:57:24.244Z',
    corpus: parts.corpus === null ? undefined : parts.corpus ?? SAME_CORPUS,
    fixtures_total: FIXTURES,
    fixtures_verified: FIXTURES,
    fixtures_unverified: [],
    gates,
    matrix: parts.matrix ?? { 'idempotency-key-race': {} },
    details: {},
    false_positives: {},
    fp_errors: {},
    ratchet: parts.ratchet ?? {},
    deterministic_catch_share: null,
    caught_by_any_deterministic: 17,
    caught_by_nothing: [],
    llm_gate_backends_share_family: llmGateFamilies.length >= 2
      && llmGateFamilies.every(family => family !== undefined && family === llmGateFamilies[0]),
  };
}

function readFrozenBaseline(): OracleReport | null {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8')) as OracleReport;
}

function copyCorpus(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-corpus-'));
  fs.cpSync(FIXTURES_DIR, path.join(root, 'fixtures'), { recursive: true });
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  fs.copyFileSync(SHARED_FIXTURE_HARNESS, path.join(root, 'lib', 'probe.ts'));
  return root;
}

/**
 * A copy carrying only the named fixtures, so a subprocess run finishes in
 * milliseconds. Bash-only keeps npx off the free tier: tsc and lint return
 * early when no fixture is in their language.
 */
function miniCorpus(ids: string[]): string {
  const root = copyCorpus();
  const groundTruthFile = path.join(root, 'fixtures', 'ground-truth.json');
  const groundTruth = JSON.parse(fs.readFileSync(groundTruthFile, 'utf-8')) as { bugs: { id: string }[]; total_bugs: number };
  const keep = new Set(ids);
  groundTruth.bugs = groundTruth.bugs.filter(b => keep.has(b.id));
  groundTruth.total_bugs = groundTruth.bugs.length;
  fs.writeFileSync(groundTruthFile, `${JSON.stringify(groundTruth, null, 2)}\n`);
  for (const entry of fs.readdirSync(path.join(root, 'fixtures'), { withFileTypes: true })) {
    if (entry.isDirectory() && !keep.has(entry.name)) {
      fs.rmSync(path.join(root, 'fixtures', entry.name), { recursive: true, force: true });
    }
  }
  return root;
}

interface OracleRun {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * The real `run.ts`, as a subprocess, against a throwaway corpus. Reading the
 * file and asserting on its text cannot tell whether the wiring in it works;
 * only the exit code and the printed report can.
 */
function runOracle(root: string, args: string[] = []): OracleRun {
  const res = spawnSync(process.execPath, [path.join(APPARATUS_DIR, 'run.ts'), ...args], {
    encoding: 'utf-8',
    env: { ...process.env, ORACLE_ROOT: root, ORACLE_LLM: '' },
    timeout: 300_000,
  });
  return { code: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

function freezeAsBaseline(root: string, report: OracleReport): void {
  fs.writeFileSync(path.join(root, 'baseline.json'), `${JSON.stringify(report, null, 2)}\n`);
}

function withoutAvailableFlag(g: GateStats): GateStats {
  const stripped: Partial<GateStats> = { ...g };
  delete stripped.available;
  return stripped as GateStats;
}

// baseline.json pinned the numbers but not the ground they were measured on. A
// ratchet over a corpus it cannot see can always be cleared by editing the
// corpus, and no amount of comparison logic fixes that from inside.
describe('baseline diff: what the corpus did', () => {
  // Delete the hardest fixture, add an easy one, hold every denominator at 19:
  // the instrument reported `improved red-test 0.895 -> 0.947` and exited 0. It
  // rewarded making the exam easier, and that number gates P8 autonomy.
  test('swapping a hard fixture for an easy one cannot be reported as an improvement', () => {
    const base = reportWith([RED_TEST_SCORED], {
      matrix: { 'cross-surface-token-drift': { 'red-test': 'missed' } },
      corpus: { fixtures: 19, digest: 'hardcorpus000000' },
    });
    const now = reportWith([{ ...RED_TEST_SCORED, caught: 18, missed: 1, detection_rate: 0.947 }], {
      matrix: { 'easy-replacement': { 'red-test': 'caught' } },
      corpus: { fixtures: 19, digest: 'easycorpus000000' },
    });

    const diff = diffAgainstBaseline(now, base);

    expect(diff.improvements).toEqual([]);
    expect(diff.regressions).toEqual([]);
    expect(diff.corpusChanged).toHaveLength(1);
    expect(diff.corpusChanged[0]).toContain('added easy-replacement');
    expect(diff.corpusChanged[0]).toContain('removed cross-surface-token-drift');
    expect(exitCodeFor(diff)).toBe(1);
  });

  test('a fixture softened while keeping its name moves the digest with no name to show for it', () => {
    const base = reportWith([RED_TEST_SCORED], { corpus: { fixtures: 19, digest: 'beforeedit000000' } });
    const now = reportWith([RED_TEST_SCORED], { corpus: { fixtures: 19, digest: 'afteredit0000000' } });

    const diff = diffAgainstBaseline(now, base);

    expect(diff.corpusChanged[0]).toContain('same fixture names, changed contents');
    expect(exitCodeFor(diff)).toBe(1);
  });

  // Absence is not a match. The baselines frozen before this pin existed say
  // nothing about their corpus, and reading that as "the same 19 fixtures" is
  // the exact bug class this whole thread started from.
  test('a baseline with no corpus pin is not treated as a matching corpus', () => {
    const base = reportWith([RED_TEST_SCORED], { corpus: null });
    const now = reportWith([RED_TEST_SCORED]);

    const diff = diffAgainstBaseline(now, base);

    expect(diff.corpusChanged).toEqual([
      'the baseline does not record which fixtures it measured, so nothing can be compared against it — re-freeze with --write-baseline',
    ]);
    expect(exitCodeFor(diff)).toBe(1);
  });

  test('a run with no corpus pin cannot be compared either', () => {
    const base = reportWith([RED_TEST_SCORED]);
    const now = reportWith([RED_TEST_SCORED], { corpus: null });

    const diff = diffAgainstBaseline(now, base);

    expect(diff.corpusChanged).toHaveLength(1);
    expect(exitCodeFor(diff)).toBe(1);
  });

  test('a changed corpus stops every other comparison rather than colouring it', () => {
    const base = reportWith([RED_TEST_SCORED], { corpus: { fixtures: 19, digest: 'aaaaaaaaaaaaaaaa' } });
    const now = reportWith([RED_TEST_ALL_ERRORS], { corpus: { fixtures: 19, digest: 'bbbbbbbbbbbbbbbb' } });

    const diff = diffAgainstBaseline(now, base);

    expect(diff.corruption).toEqual([]);
    expect(diff.corpusChanged).toHaveLength(1);
    expect(diff.lostMeasurements).toEqual([]);
    expect(diff.firstMeasurements).toEqual([]);
    expect(diff.newCases).toEqual([]);
    expect(diff.droppedCases).toEqual([]);
    expect(exitCodeFor(diff)).toBe(1);
  });

  // The count inside the pin is the one field of it a hand edit could reach
  // without recomputing a sha256, so it is checked against what the run scored.
  test('a corpus pin whose count disagrees with the run refuses to compare', () => {
    const base = reportWith([RED_TEST_SCORED], { corpus: { fixtures: 12, digest: SAME_CORPUS.digest } });
    const now = reportWith([RED_TEST_SCORED]);

    const diff = diffAgainstBaseline(now, base);

    expect(diff.corruption).toEqual([
      'baseline: the corpus pin counts 12 fixtures but the run scored 19',
    ]);
    expect(exitCodeFor(diff)).toBe(1);
  });

  test('a matching corpus lets the numbers compare as usual', () => {
    const base = reportWith([GUARD_BEFORE_DENYLIST_SPLIT]);
    const now = reportWith([GUARD_AFTER_DENYLIST_SPLIT]);

    const diff = diffAgainstBaseline(now, base);

    expect(diff.corpusChanged).toEqual([]);
    expect(diff.improvements).toEqual(['guard: false positives 4/8 (0.5) -> 1/8 (0.125)']);
    expect(exitCodeFor(diff)).toBe(0);
  });

  test('the fingerprint of the fixtures on disk is stable across calls', () => {
    const first = corpusFingerprint();
    const second = corpusFingerprint();

    expect(first.digest).toBe(second.digest);
    expect(first.fixtures).toBe(FIXTURES);
    expect(first.digest).toMatch(/^[0-9a-f]{16}$/);
  });

  // Every other digest test compares a copy against itself, so all of them would
  // still pass if the corpus walk quietly stopped covering half the corpus. This
  // one is the only assertion tied to the real value.
  test('the fixtures on disk carry the digest the baseline is meant to pin', () => {
    expect(corpusFingerprint()).toEqual({ fixtures: FIXTURES, digest: CORPUS_DIGEST });
  });

  // The digest covers every byte under fixtures/ plus the one shared harness
  // fixture code imports. A fixture reaching anywhere else would be a permanent
  // way to change what red means without moving the digest.
  test('no fixture reaches outside itself except to the shared probe harness', () => {
    expect(fixtureEscapes()).toEqual([]);
  });

  // The old tripwire matched `from '..'` in single quotes in a .ts/.js/.sh file
  // and nothing else, so every line below smuggled a dependency past it. Import
  // syntax was never the unit: a require, a readFileSync and a bash source all
  // reach the same file, and the file doing the reaching can be named anything.
  const SMUGGLED_DEPENDENCIES: { form: string; file: string; body: string }[] = [
    { form: 'double-quoted import', file: 'smuggle.ts', body: 'import { x } from "../shared";\n' },
    { form: 'import via ./..', file: 'smuggle.ts', body: "import { x } from './../shared';\n" },
    { form: 'bare side-effect import', file: 'smuggle.ts', body: "import '../shared';\n" },
    { form: 'dynamic import()', file: 'smuggle.ts', body: "export const load = () => import('../shared');\n" },
    { form: 'require()', file: 'smuggle.ts', body: "const shared = require('../shared');\n" },
    { form: 'readFileSync', file: 'smuggle.ts', body: "export const raw = readFileSync('../../ground-truth.json');\n" },
    { form: 'bash source', file: 'smuggle.sh', body: '#!/usr/bin/env bash\nsource ../shared.sh\n' },
    { form: 'an .mjs hop', file: 'smuggle.mjs', body: "export { x } from '../shared.mjs';\n" },
    { form: 'a .cjs hop', file: 'smuggle.cjs', body: "module.exports = require('../shared.cjs');\n" },
    { form: 'a .tsx hop', file: 'smuggle.tsx', body: "import { x } from '../shared';\nexport const y = x;\n" },
    { form: 'a bare .. segment', file: 'smuggle.ts', body: "export const dir = join(__dirname, '..', 'shared');\n" },
  ];

  for (const { form, file, body } of SMUGGLED_DEPENDENCIES) {
    test(`a dependency smuggled out of a fixture by ${form} is caught`, () => {
      const copy = copyCorpus();
      try {
        fs.writeFileSync(path.join(copy, 'fixtures', 'hook-hardcoded-repo-path', file), body);

        const escapes = fixtureEscapes(copy);

        expect(escapes.map(e => e.file)).toEqual([`hook-hardcoded-repo-path/${file}`]);
      } finally {
        fs.rmSync(copy, { recursive: true, force: true });
      }
    });
  }

  test('an absolute path into the oracle tree is an escape too', () => {
    const copy = copyCorpus();
    try {
      const apparatus = path.join(copy, 'lib', 'gates.ts');
      fs.writeFileSync(
        path.join(copy, 'fixtures', 'hook-hardcoded-repo-path', 'smuggle.ts'),
        `export const raw = readFileSync('${apparatus}');\n`,
      );

      expect(fixtureEscapes(copy).map(e => e.reference)).toEqual([apparatus]);
    } finally {
      fs.rmSync(copy, { recursive: true, force: true });
    }
  });

  // Every edit below happens to a throwaway copy. A fingerprint test that had to
  // modify the real corpus to prove itself could leave it modified if the run
  // died between the edit and the restore, which is the exact corruption the
  // fingerprint exists to detect.
  test('the digest follows the bytes, not the path they sit at', () => {
    const copy = copyCorpus();
    try {
      expect(corpusFingerprint(copy).digest).toBe(corpusFingerprint().digest);
    } finally {
      fs.rmSync(copy, { recursive: true, force: true });
    }
  });

  test('editing the shared probe harness moves the digest, since every fixture imports it', () => {
    const copy = copyCorpus();
    try {
      const before = corpusFingerprint(copy).digest;
      const harness = path.join(copy, 'lib', 'probe.ts');
      fs.appendFileSync(harness, '\nexport const softened = true;\n');

      expect(corpusFingerprint(copy).digest).not.toBe(before);
    } finally {
      fs.rmSync(copy, { recursive: true, force: true });
    }
  });

  test('softening one fixture in place moves the digest with no name change to show for it', () => {
    const copy = copyCorpus();
    try {
      const before = corpusFingerprint(copy).digest;
      const buggy = path.join(copy, 'fixtures', 'twin-mapper-drift', 'buggy', 'index.ts');
      fs.appendFileSync(buggy, '\n');

      const after = corpusFingerprint(copy);
      expect(after.digest).not.toBe(before);
      expect(after.fixtures).toBe(FIXTURES);
    } finally {
      fs.rmSync(copy, { recursive: true, force: true });
    }
  });

  test('dropping a fixture moves both the digest and the count', () => {
    const copy = copyCorpus();
    try {
      const before = corpusFingerprint(copy);
      const groundTruthFile = path.join(copy, 'fixtures', 'ground-truth.json');
      const groundTruth = JSON.parse(fs.readFileSync(groundTruthFile, 'utf-8')) as { bugs: { id: string }[]; total_bugs: number };
      const dropped = groundTruth.bugs.pop()!;
      groundTruth.total_bugs = groundTruth.bugs.length;
      fs.writeFileSync(groundTruthFile, JSON.stringify(groundTruth, null, 2));
      fs.rmSync(path.join(copy, 'fixtures', dropped.id), { recursive: true, force: true });

      const after = corpusFingerprint(copy);
      expect(after.digest).not.toBe(before.digest);
      expect(after.fixtures).toBe(FIXTURES - 1);
    } finally {
      fs.rmSync(copy, { recursive: true, force: true });
    }
  });

  test('widening the guard probe set moves the digest', () => {
    const copy = copyCorpus();
    try {
      const before = corpusFingerprint(copy).digest;
      const probesFile = path.join(copy, 'fixtures', 'guard-fp-probes.json');
      const probes = JSON.parse(fs.readFileSync(probesFile, 'utf-8')) as { probes: unknown[] };
      probes.probes.push({ id: 'extra-probe', why_benign: 'added', source: 'test', input: {} });
      fs.writeFileSync(probesFile, JSON.stringify(probes, null, 2));

      expect(corpusFingerprint(copy).digest).not.toBe(before);
    } finally {
      fs.rmSync(copy, { recursive: true, force: true });
    }
  });

  // ground-truth.json feeds guard_input straight to the guard gate and carries
  // every spec and detection hint the LLM gates are scored against. Every other
  // test reached it only through the fixture ids it names, so deleting the line
  // that hashed its bytes left the whole suite green.
  test('rewriting the ground truth without touching a fixture still moves the digest', () => {
    const copy = copyCorpus();
    try {
      const before = corpusFingerprint(copy);
      const groundTruthFile = path.join(copy, 'fixtures', 'ground-truth.json');
      const groundTruth = JSON.parse(fs.readFileSync(groundTruthFile, 'utf-8')) as { bugs: { detection_hint: string; spec: string }[] };
      groundTruth.bugs[0].detection_hint = 'softened|until it matches anything';
      groundTruth.bugs[0].spec = 'a spec so loose that no reviewer can fail it';
      fs.writeFileSync(groundTruthFile, JSON.stringify(groundTruth, null, 2));

      const after = corpusFingerprint(copy);
      expect(after.digest).not.toBe(before.digest);
      expect(after.fixtures).toBe(before.fixtures);
    } finally {
      fs.rmSync(copy, { recursive: true, force: true });
    }
  });

  // Walking only the per-id trees left the corpus root itself unwatched, and
  // loadCases only rejects orphan DIRECTORIES, so a loose file was seen by
  // neither. A fixture that reached it would have an off-digest control surface
  // inside the corpus.
  test('a loose file dropped into the corpus root moves the digest', () => {
    const copy = copyCorpus();
    try {
      const before = corpusFingerprint(copy).digest;
      fs.writeFileSync(path.join(copy, 'fixtures', 'shared-helper.ts'), 'export const threshold = 99;\n');

      expect(corpusFingerprint(copy).digest).not.toBe(before);
    } finally {
      fs.rmSync(copy, { recursive: true, force: true });
    }
  });

  // Concatenation with no separator is ambiguous: a + bc and ab + c are the same
  // bytes. Both files stay valid JSON, both still parse, and the digest that is
  // supposed to name the exam does not move.
  test('moving a byte from one hashed file into the next moves the digest', () => {
    const copy = copyCorpus();
    try {
      const before = corpusFingerprint(copy).digest;
      const groundTruthFile = path.join(copy, 'fixtures', 'ground-truth.json');
      const probesFile = path.join(copy, 'fixtures', 'guard-fp-probes.json');
      const groundTruth = fs.readFileSync(groundTruthFile, 'utf-8');
      expect(groundTruth.endsWith('\n')).toBe(true);
      fs.writeFileSync(groundTruthFile, groundTruth.replace(/\n$/, ''));
      fs.writeFileSync(probesFile, `\n${fs.readFileSync(probesFile, 'utf-8')}`);

      expect(corpusFingerprint(copy).digest).not.toBe(before);
    } finally {
      fs.rmSync(copy, { recursive: true, force: true });
    }
  });

  // A separator does not disambiguate a stream whose fields can contain that
  // separator. probe.ts absorbing "\0<path>\0<contents>" reproduced witness.ts's
  // entry byte for byte, so deleting witness.ts left the digest untouched — and
  // loadCases then falls back to witness = probe, checking the probe against
  // itself while every fixture still reads as verified. Both spellings below are
  // boundaries this digest has framed entries with; a file's own bytes must not
  // be able to forge either, which is what the length prefix buys.
  const FORGED_ENTRY_BOUNDARIES = [
    (witness: string) => `\0scroll-pinned-control/witness.ts\0${witness}`,
    (witness: string) => `file fixtures/scroll-pinned-control/witness.ts${witness}`,
  ];

  for (const [index, boundary] of FORGED_ENTRY_BOUNDARIES.entries()) {
    test(`a fixture file cannot swallow the entry that follows it (boundary ${index})`, () => {
      const copy = copyCorpus();
      try {
        const before = corpusFingerprint(copy).digest;
        const dir = path.join(copy, 'fixtures', 'scroll-pinned-control');
        const probeFile = path.join(dir, 'probe.ts');
        const witnessFile = path.join(dir, 'witness.ts');
        const witness = fs.readFileSync(witnessFile, 'utf-8');
        fs.writeFileSync(probeFile, `${fs.readFileSync(probeFile, 'utf-8')}${boundary(witness)}`);
        fs.rmSync(witnessFile);

        expect(corpusFingerprint(copy).digest).not.toBe(before);
      } finally {
        fs.rmSync(copy, { recursive: true, force: true });
      }
    });
  }

  // Replacing buggy/ with a link to fixed/ makes a fixture pass everything. The
  // read threw a bare "EISDIR: illegal operation on a directory" after the whole
  // run had been paid for, which reads as a crash rather than a corpus verdict.
  test('a symlink in the corpus is refused by name, not by errno', () => {
    const copy = copyCorpus();
    try {
      const dir = path.join(copy, 'fixtures', 'twin-mapper-drift');
      fs.rmSync(path.join(dir, 'buggy'), { recursive: true, force: true });
      fs.symlinkSync(path.join(dir, 'fixed'), path.join(dir, 'buggy'));

      expect(() => corpusFingerprint(copy)).toThrow(/twin-mapper-drift\/buggy is a symlink/);
    } finally {
      fs.rmSync(copy, { recursive: true, force: true });
    }
  });

  test('a dangling symlink is refused the same way instead of raising ENOENT', () => {
    const copy = copyCorpus();
    try {
      const dir = path.join(copy, 'fixtures', 'twin-mapper-drift');
      fs.symlinkSync(path.join(dir, 'nothing-here.ts'), path.join(dir, 'ghost.ts'));

      expect(() => corpusFingerprint(copy)).toThrow(/twin-mapper-drift\/ghost.ts is a symlink/);
    } finally {
      fs.rmSync(copy, { recursive: true, force: true });
    }
  });

  test('a corpus change is printed under its own word, never as a DROPPED line among green', () => {
    const base = reportWith([RED_TEST_SCORED], { corpus: { fixtures: 19, digest: 'aaaaaaaaaaaaaaaa' } });
    const now = reportWith([RED_TEST_SCORED], { corpus: { fixtures: 19, digest: 'bbbbbbbbbbbbbbbb' } });
    const diff = diffAgainstBaseline(now, base);

    const out = render(now, diff);

    expect(out).toContain('CORPUS      the fixture corpus changed');
    expect(out).not.toContain('baseline: no change');
    expect(out).not.toContain('DROPPED');
    expect(exitCodeFor(diff)).toBe(1);
  });
});

// A baseline is the yardstick every later run is judged against, so what may
// become one is a boundary of the instrument, not a detail of the comparison.
describe('what may be frozen as a baseline', () => {
  // --write-baseline returned before the dead-gate check, so with tsc or bun off
  // PATH a plain run exited 1 while --write-baseline exited 0 and froze the gate
  // at applicable: 0. The next healthy run then read as a first measurement.
  test('a run with a gate that scored nothing is refused', () => {
    const report = reportWith([GUARD_AFTER_DENYLIST_SPLIT, RED_TEST_ALL_ERRORS]);

    expect(unfitToFreeze(report, PAID_GATES_OFF, report)).toEqual([
      'red-test scored nothing at all (19/19 fixtures errored)',
    ]);
  });

  test('a run with a dead deterministic gate is refused', () => {
    const report = reportWith([GUARD_CANARY_FAILED, RED_TEST_SCORED]);

    expect(unfitToFreeze(report, PAID_GATES_OFF, report)[0]).toContain('guard could not run: canary did not trip');
  });

  test('a run with an unverified fixture is refused', () => {
    const report = { ...reportWith([RED_TEST_SCORED]), fixtures_unverified: ['stage-whole-index: green on buggy'] };

    expect(unfitToFreeze(report, PAID_GATES_OFF, report)).toEqual([
      'a fixture does not demonstrate its bug: stage-whole-index: green on buggy',
    ]);
  });

  // The everyday free-tier freeze must still be allowed, or the only way out of
  // a stale baseline closes.
  test('an ordinary free-tier run is fit to freeze', () => {
    const report = reportWith([
      GUARD_AFTER_DENYLIST_SPLIT, LINT_SCORED, RED_TEST_SCORED,
      SPEC_CHECK_NEVER_SCORED, REVIEWER_NEVER_SCORED,
    ]);

    expect(unfitToFreeze(report, PAID_GATES_OFF, report)).toEqual([]);
  });

  test('a run cannot drop a gate scored by the current baseline', () => {
    const baseline = reportWith([RED_TEST_SCORED, SPEC_CHECK_SCORED]);
    const report = reportWith([RED_TEST_SCORED, SPEC_CHECK_NEVER_SCORED]);

    expect(unfitToFreeze(report, EVERYTHING_EXPECTED, baseline)).toEqual([
      'spec-check scored nothing at all (19/19 fixtures errored)',
    ]);
  });

  test('operator-disabled does not excuse dropping a gate scored by the current baseline', () => {
    const baseline = reportWith([RED_TEST_SCORED, SPEC_CHECK_SCORED]);
    const report = reportWith([RED_TEST_SCORED, SPEC_CHECK_NEVER_SCORED]);

    expect(unfitToFreeze(report, PAID_GATES_OFF, baseline)).toEqual([
      'spec-check scored nothing at all (19/19 fixtures errored)',
    ]);
  });

  test('a run scoring the full set scored by the current baseline is fit to freeze', () => {
    const baseline = reportWith([RED_TEST_SCORED, SPEC_CHECK_SCORED]);
    const report = reportWith([RED_TEST_SCORED, SPEC_CHECK_SCORED]);

    expect(unfitToFreeze(report, EVERYTHING_EXPECTED, baseline)).toEqual([]);
  });

  test('a healthy first run scores every declared gate family', () => {
    const report = reportWith([RED_TEST_SCORED, SPEC_CHECK_SCORED]);

    expect(unfitToFreeze(report, EVERYTHING_EXPECTED, null)).toEqual([]);
  });

  test('a degenerate first run that misses a declared gate family is refused', () => {
    const report = reportWith([RED_TEST_SCORED, SPEC_CHECK_NEVER_SCORED]);

    expect(unfitToFreeze(report, PAID_GATES_OFF, null)).toEqual([
      'the llm gate family scored nothing at all',
    ]);
  });

  test('gates that scored nothing are only excused by the same three channels', () => {
    const report = reportWith([RED_TEST_SCORED, SPEC_CHECK_NEVER_SCORED]);

    expect(unfitToFreeze(report, EVERYTHING_EXPECTED, report)).toEqual([
      'spec-check scored nothing at all (19/19 fixtures errored)',
    ]);
  });

  // A baseline with no pin is a yardstick that names no exam, and the next run
  // refuses to compare against it. Fail-closed, so the damage is a ratchet stuck
  // at exit 1 rather than a false green — but it is still a run that never had
  // to be frozen in the first place.
  test('a run that does not say which fixtures it measured is refused', () => {
    const report = reportWith([RED_TEST_SCORED], { corpus: null });

    expect(unfitToFreeze(report, PAID_GATES_OFF, report)).toEqual([
      'this run does not record which fixtures it measured, so freezing it would pin numbers to a corpus nobody can name',
    ]);
  });
});

// The three-channel AND is enforced inside diffAgainstBaseline, but all three
// channels collapse to one boolean if the caller sources the list from whether
// the gates could run. llmGatesEnabled() returns false for four causes, only one
// of which is a decision, so the list has to come from the switch itself.
describe('where the operator list comes from', () => {
  test('run.ts reads the switch directly, not whether the gates happened to work', () => {
    const source = fs.readFileSync(path.join(APPARATUS_DIR, 'run.ts'), 'utf-8');

    expect(source).toContain("process.env.ORACLE_LLM !== '1'");
    expect(source).not.toMatch(/operatorDisabledGates:\s*llm\.enabled/);
  });

  // Fixtures are imported into this process and can reach the environment, and
  // verifyFixtures runs before the diff. Sampling at module load puts the read
  // before any fixture has been loaded.
  test('run.ts samples the switch at module load, before any fixture is imported', () => {
    const source = fs.readFileSync(path.join(APPARATUS_DIR, 'run.ts'), 'utf-8');
    const sampled = source.indexOf("process.env.ORACLE_LLM !== '1'");
    const mainStarts = source.indexOf('async function main');

    expect(sampled).toBeGreaterThan(-1);
    expect(sampled).toBeLessThan(mainStarts);
  });

  test('a backend that merely broke is a loss, not an operator choice', () => {
    const base = reportWith([SPEC_CHECK_SCORED]);
    const now = reportWith([SPEC_CHECK_NEVER_SCORED]);

    const brokenBackend = diffAgainstBaseline(now, base, {
      operatorDisabledGates: [],
      operatorReason: 'gate backend "codex" unusable: not on PATH',
    });

    expect(brokenBackend.acknowledgedAbsences).toEqual([]);
    expect(brokenBackend.lostMeasurements).toHaveLength(2);
    expect(exitCodeFor(brokenBackend)).toBe(2);
  });
});

// run.ts was only ever read as text by the two greps above, never spawned, so
// four separate one-line mutations to it shipped a fully green suite: a
// hardcoded digest, an exit code of 0 for every diff, a --write-baseline that
// stopped refusing, and an unverified fixture that stopped failing. What a gate
// asserts about itself is not evidence; the exit code and the printed report
// are, and only a real process produces those.
describe('run.ts end to end', () => {
  // Everything below runs against a throwaway corpus. ORACLE_ROOT moves the
  // fixtures, the probe harness and the baseline together, so a redirected run
  // reads and writes the copy's baseline and cannot reach the installed one; it
  // says on stderr that it was redirected, so no transcript can pass one of
  // these off as a measurement.
  test('the corpus digest comes from the fixtures on disk, and a corpus that moved stops the run', () => {
    const root = miniCorpus(['hook-hardcoded-repo-path']);
    try {
      const first = runOracle(root, ['--json']);
      expect(first.code).toBe(0);
      expect(first.stderr).toContain('NOT the installed one');

      const report = (JSON.parse(first.stdout) as { report: OracleReport }).report;
      const dead = report.gates
        .filter(g => !g.available && g.family === 'deterministic')
        .map(g => `${g.gate}: ${g.unavailable_reason}`);
      expect(dead).toEqual([]);
      expect(report.corpus).toEqual(corpusFingerprint(root));
      expect(report.corpus?.digest).not.toBe(CORPUS_DIGEST);

      freezeAsBaseline(root, report);
      const unchanged = runOracle(root);
      expect(unchanged.code).toBe(0);
      expect(unchanged.stdout).toContain(`corpus: 1 fixtures, ${report.corpus?.digest}`);
      expect(unchanged.stdout).toContain('baseline: no change');

      freezeAsBaseline(root, { ...report, corpus: { fixtures: 1, digest: 'deadbeefdeadbeef' } });
      const moved = runOracle(root);
      expect(moved.stdout).toContain('CORPUS      the fixture corpus changed since the baseline was frozen');
      expect(moved.code).toBe(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 300_000);

  test('a fixture that no longer demonstrates its bug fails the run and says which one', () => {
    const root = miniCorpus(['hook-hardcoded-repo-path']);
    try {
      const dir = path.join(root, 'fixtures', 'hook-hardcoded-repo-path');
      fs.copyFileSync(path.join(dir, 'fixed', 'script.sh'), path.join(dir, 'buggy', 'script.sh'));

      const run = runOracle(root);

      expect(run.stdout).toContain('!! FIXTURES THAT DO NOT DEMONSTRATE THEIR BUG');
      expect(run.stdout).toContain('hook-hardcoded-repo-path: witness red on buggy=false');
      expect(run.code).toBe(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 300_000);

  test('--write-baseline refuses a run that is unfit to freeze, names why, and writes nothing', () => {
    const root = miniCorpus(['hook-hardcoded-repo-path']);
    try {
      const dir = path.join(root, 'fixtures', 'hook-hardcoded-repo-path');
      fs.copyFileSync(path.join(dir, 'fixed', 'script.sh'), path.join(dir, 'buggy', 'script.sh'));

      const run = runOracle(root, ['--write-baseline']);

      expect(run.stderr).toContain('refusing to freeze this run as the baseline');
      expect(run.stderr).toContain('a fixture does not demonstrate its bug: hook-hardcoded-repo-path');
      expect(run.code).toBe(1);
      expect(fs.existsSync(path.join(root, 'baseline.json'))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 300_000);
});

describe('baseline diff: what the measured set did', () => {
  // The 2026-08-13 paid run exited 2 on "REGRESSION spec-check: false positives
  // 0 -> 13". The baseline's 0 was never a measurement: ORACLE_LLM was off when
  // it was frozen, so the gate had never run. A first number is not a fall.
  test('a paid metric the baseline never froze is unfrozen and exits 3', () => {
    const base = reportWith([SPEC_CHECK_NEVER_SCORED]);
    const now = reportWith([SPEC_CHECK_SCORED]);

    const diff = diffAgainstBaseline(now, base, PAID_GATES_OFF);

    expect(diff.regressions).toEqual([]);
    expect(diff.improvements).toEqual([]);
    expect(diff.firstMeasurements).toEqual([]);
    expect(diff.unfrozenMeasurements).toEqual([
      'spec-check: detection first produced a number — 17/19 (0.895). The baseline holds no number for this metric, so the next paid run cannot be compared with it: even 0/19 would print UNFROZEN again. Freeze it now, in the run that measured it — ORACLE_LLM=1 bun personal/oracle/run.ts --write-baseline',
      'spec-check: false positives first produced a number — 13/19 (0.684). The baseline holds no number for this metric, so the next paid run cannot be compared with it: even 0/19 would print UNFROZEN again. Freeze it now, in the run that measured it — ORACLE_LLM=1 bun personal/oracle/run.ts --write-baseline',
    ]);
    expect(exitCodeFor(diff)).toBe(3);
  });

  test('a paid detection frozen at 17/19 and later falling to 0/19 is a regression and exits 2', () => {
    const base = reportWith([SPEC_CHECK_SCORED]);
    const now = reportWith([{ ...SPEC_CHECK_SCORED, caught: 0, missed: 19, detection_rate: 0 }]);

    const diff = diffAgainstBaseline(now, base);

    expect(diff.regressions).toContain('spec-check: detection 17/19 (0.895) -> 0/19 (0)');
    expect(diff.unfrozenMeasurements).toEqual([]);
    expect(exitCodeFor(diff)).toBe(2);
  });

  test('a paid detection frozen at 17/19 and still at 17/19 exits clean', () => {
    const base = reportWith([SPEC_CHECK_SCORED]);
    const now = reportWith([SPEC_CHECK_SCORED]);

    const diff = diffAgainstBaseline(now, base);

    expect(diff.regressions).toEqual([]);
    expect(diff.unfrozenMeasurements).toEqual([]);
    expect(exitCodeFor(diff)).toBe(0);
  });

  test('an everyday free run leaves paid metrics unfrozen-free and exits clean', () => {
    const base = reportWith([SPEC_CHECK_NEVER_SCORED, REVIEWER_NEVER_SCORED]);
    const now = reportWith([SPEC_CHECK_NEVER_SCORED, REVIEWER_NEVER_SCORED]);

    const diff = diffAgainstBaseline(now, base, PAID_GATES_OFF);

    expect(diff.unfrozenMeasurements).toEqual([]);
    expect(exitCodeFor(diff)).toBe(0);
  });

  // A gate is two independent numbers and can acquire them at different times:
  // guard scores false positives against its probe set whether or not any
  // fixture reaches its surface.
  test('one metric appearing is news even when the gate already reported the other', () => {
    const fpOnly: GateStats = {
      ...GUARD_AFTER_DENYLIST_SPLIT,
      caught: 0, missed: 0, n_a: 19, applicable: 0, detection_rate: null, coverage: 0,
    };
    const base = reportWith([fpOnly]);
    const now = reportWith([{ ...GUARD_AFTER_DENYLIST_SPLIT, caught: 1, missed: 1, detection_rate: 0.5 }]);

    const diff = diffAgainstBaseline(now, base);

    expect(diff.firstMeasurements).toEqual([]);
    expect(diff.unfrozenMeasurements).toEqual([
      'guard: detection first produced a number — 1/2 (0.5). The baseline holds no number for this metric, so the next run cannot be compared with it: even 0/2 would print UNFROZEN again. Freeze it now, in the run that measured it — bun personal/oracle/run.ts --write-baseline',
    ]);
    expect(exitCodeFor(diff)).toBe(3);
  });

  // Round 2's headline: red-test erroring on 18 of 19 raised 18 regressions,
  // and erroring on all 19 raised nothing at all, because the gate fell out of
  // every comparison the moment it stopped producing a rate. One cell worse,
  // alarm gone. The alarm now comes from the measured set shrinking, so both
  // sides of that cliff are the same event.
  test('the highest-scoring gate erroring on every fixture is an alarm', () => {
    const base = reportWith([RED_TEST_SCORED]);
    const now = reportWith([RED_TEST_ALL_ERRORS]);

    const diff = diffAgainstBaseline(now, base);

    expect(diff.lostMeasurements).toEqual([
      'red-test: detection is no longer scored at all — the baseline had 17/19 (0.895)',
      'red-test: false positives is no longer scored at all — the baseline had 0/19 (0)',
    ]);
    expect(exitCodeFor(diff)).toBe(2);
  });

  test('erroring on all but one fixture raises the same alarm as erroring on all of them', () => {
    const base = reportWith([RED_TEST_SCORED]);
    const allButOne = diffAgainstBaseline(reportWith([RED_TEST_ALL_BUT_ONE_ERRORS]), base);
    const everyOne = diffAgainstBaseline(reportWith([RED_TEST_ALL_ERRORS]), base);

    expect(exitCodeFor(allButOne)).toBe(2);
    expect(exitCodeFor(everyOne)).toBe(2);
    expect(allButOne.lostMeasurements.length).toBeGreaterThan(0);
    expect(everyOne.lostMeasurements.length).toBeGreaterThan(0);
  });

  // `available: false` is also what a FAILED CANARY sets — the guard let
  // "rm -rf /" through. The gate's own reason string is self-report and cannot
  // be the thing that decides whether its absence was intended.
  test('a gate whose canary failed is an alarm, not an advisory', () => {
    const base = reportWith([GUARD_AFTER_DENYLIST_SPLIT]);
    const now = reportWith([GUARD_CANARY_FAILED]);

    const diff = diffAgainstBaseline(now, base);

    expect(diff.lostMeasurements).toHaveLength(2);
    expect(diff.acknowledgedAbsences).toEqual([]);
    expect(exitCodeFor(diff)).toBe(2);
  });

  // llmGatesEnabled() reads the environment, which is an operator input the
  // gates cannot write to. That is the only channel allowed to turn a shrink
  // into an expected absence.
  test('switching the paid gates off is an acknowledged absence, not a loss', () => {
    const base = reportWith([SPEC_CHECK_SCORED], { matrix: { 'idempotency-key-race': { 'spec-check': 'caught' } } });
    const now = reportWith([SPEC_CHECK_NEVER_SCORED], { matrix: { 'idempotency-key-race': { 'spec-check': 'error' } } });

    const diff = diffAgainstBaseline(now, base, PAID_GATES_OFF);

    expect(diff.lostMeasurements).toEqual([]);
    expect(diff.regressions).toEqual([]);
    expect(diff.acknowledgedAbsences).toHaveLength(2);
    expect(exitCodeFor(diff)).toBe(0);
  });

  test('the same absence without the operator asking for it is an alarm', () => {
    const base = reportWith([SPEC_CHECK_SCORED]);
    const now = reportWith([SPEC_CHECK_NEVER_SCORED]);

    const diff = diffAgainstBaseline(now, base, EVERYTHING_EXPECTED);

    expect(diff.acknowledgedAbsences).toEqual([]);
    expect(diff.lostMeasurements).toHaveLength(2);
    expect(exitCodeFor(diff)).toBe(2);
  });

  // The operator channel is an input, not a master key. Naming a gate that never
  // went unavailable would let a caller excuse the death of the highest-scoring
  // gate in the harness just by listing it.
  test('naming a gate the operator did not actually switch off does not excuse its death', () => {
    const base = reportWith([RED_TEST_SCORED]);
    const now = reportWith([RED_TEST_ALL_ERRORS]);

    const diff = diffAgainstBaseline(now, base, {
      operatorDisabledGates: ['red-test'],
      operatorReason: 'claimed to be off',
    });

    expect(diff.acknowledgedAbsences).toEqual([]);
    expect(diff.lostMeasurements).toHaveLength(2);
    expect(exitCodeFor(diff)).toBe(2);
  });

  // Being on the disabled list explains a gate scoring NOTHING. It cannot
  // explain a gate scoring 2 fixtures out of 19, so that stays a loss.
  test('a disabled gate that still produced a partial number is a loss anyway', () => {
    const base = reportWith([REVIEWER_SCORED]);
    const now = reportWith([REVIEWER_QUOTA_DIED_AFTER_TWO]);

    const diff = diffAgainstBaseline(now, base, PAID_GATES_OFF);

    expect(diff.acknowledgedAbsences).toEqual([]);
    expect(diff.lostMeasurements).toContain(
      'reviewer: detection denominator 18 -> 2 — 13/18 (0.722) -> 2/2 (1)',
    );
    expect(diff.improvements).toEqual([]);
    expect(exitCodeFor(diff)).toBe(2);
  });

  // detection is a rate over caught + missed, so fixing one flaky fixture moves
  // the denominator and drops the rate while the gate catches exactly the same
  // bugs. Rate-vs-rate called that a regression and exited 2.
  test('the same bugs caught over wider ground is not a regression', () => {
    const flakeFixed: GateStats = {
      ...REVIEWER_SCORED,
      caught: 13, missed: 6, error: 0, applicable: 19,
      detection_rate: 0.684, coverage: 1, false_positives: 8, fp_denominator: 19, fp_rate: 0.421,
    };
    const base = reportWith([REVIEWER_SCORED]);
    const now = reportWith([flakeFixed]);

    const diff = diffAgainstBaseline(now, base);

    expect(diff.regressions).toEqual([]);
    expect(diff.lostMeasurements).toEqual([]);
    expect(diff.firstMeasurements).toContain(
      'reviewer: detection denominator 18 -> 19 — 13/18 (0.722) -> 13/19 (0.684)',
    );
    expect(diff.unfrozenMeasurements).toEqual([]);
    expect(exitCodeFor(diff)).toBe(0);
  });

  // Commit e6e1efae split the guard denylist into hard-block and ask, taking the
  // probe set from 4/8 false positives to 1/8. A count-only comparison had no
  // branch for that, so the payoff was invisible in the one report meant to
  // decide whether the gate can be trusted.
  test('a gate that got more precise over the same probe set is an improvement', () => {
    const base = reportWith([GUARD_BEFORE_DENYLIST_SPLIT]);
    const now = reportWith([GUARD_AFTER_DENYLIST_SPLIT]);

    const diff = diffAgainstBaseline(now, base);

    expect(diff.improvements).toEqual(['guard: false positives 4/8 (0.5) -> 1/8 (0.125)']);
    expect(diff.regressions).toEqual([]);
    expect(exitCodeFor(diff)).toBe(0);
  });

  test('a gate that cries wolf more often over the same probe set is a regression', () => {
    const base = reportWith([GUARD_AFTER_DENYLIST_SPLIT]);
    const now = reportWith([GUARD_BEFORE_DENYLIST_SPLIT]);

    const diff = diffAgainstBaseline(now, base);

    expect(diff.regressions).toEqual(['guard: false positives 1/8 (0.125) -> 4/8 (0.5)']);
    expect(exitCodeFor(diff)).toBe(2);
  });

  // Doubling guard-fp-probes.json is planned work, and it raises the raw count
  // in exact proportion while precision holds still. Counting wrong blocks
  // called that a regression and exited 2 on purpose-built work, which is how
  // exit 2 stops being read. Wrong blocks only mean anything per opportunity.
  test('a wider probe set at an unchanged rate is news, not a regression', () => {
    const widerProbeSet: GateStats = {
      ...GUARD_AFTER_DENYLIST_SPLIT,
      false_positives: 2, fp_denominator: 16, fp_rate: 0.125,
    };
    const base = reportWith([GUARD_AFTER_DENYLIST_SPLIT]);
    const now = reportWith([widerProbeSet]);

    const diff = diffAgainstBaseline(now, base);

    expect(diff.regressions).toEqual([]);
    expect(diff.firstMeasurements).toEqual([
      'guard: false positives denominator 8 -> 16 — 1/8 (0.125) -> 2/16 (0.125)',
    ]);
    expect(exitCodeFor(diff)).toBe(0);
  });

  test('a wider probe set the gate actually got worse on is still a regression', () => {
    const widerAndWorse: GateStats = {
      ...GUARD_AFTER_DENYLIST_SPLIT,
      false_positives: 4, fp_denominator: 16, fp_rate: 0.25,
    };
    const base = reportWith([GUARD_AFTER_DENYLIST_SPLIT]);
    const now = reportWith([widerAndWorse]);

    const diff = diffAgainstBaseline(now, base);

    expect(diff.regressions).toEqual([
      'guard: false positives 1/8 (0.125) -> 4/16 (0.25) — a worse false positive rate, on ground that only got wider',
    ]);
    expect(diff.firstMeasurements).toEqual([]);
    expect(exitCodeFor(diff)).toBe(2);
  });

  // applicable = caught + missed, so the denominator also moves when a fixture is
  // relabelled n_a -> missed, with no new fixture anywhere. That used to print
  // "baseline: no change".
  test('a denominator that moved without any new fixture is reported, not swallowed', () => {
    const widerLint: GateStats = {
      ...LINT_SCORED,
      missed: 8, n_a: 11, applicable: 8, coverage: 0.421, fp_denominator: 8,
    };
    const base = reportWith([LINT_SCORED]);
    const now = reportWith([widerLint]);

    const diff = diffAgainstBaseline(now, base);

    expect(diff.firstMeasurements).toContain('lint: detection denominator 6 -> 8 — 0/6 (0) -> 0/8 (0)');
    expect(diff.regressions).toEqual([]);
    expect(exitCodeFor(diff)).toBe(0);
  });

  // The zeros that actually sit in the frozen baseline are detection zeros on
  // guard, lint and tsc, all genuinely measured. A measured 0 must move like any
  // other number or the three gates P8 leans on go unwatched.
  test('a measured detection rate of zero compares normally instead of reading as unscored', () => {
    const base = reportWith([LINT_SCORED]);
    const now = reportWith([{ ...LINT_SCORED, caught: 1, missed: 5, detection_rate: 0.167 }]);

    const diff = diffAgainstBaseline(now, base);

    expect(diff.improvements).toEqual(['lint: detection 0/6 (0) -> 1/6 (0.167)']);
    expect(diff.firstMeasurements).toEqual([]);
    expect(exitCodeFor(diff)).toBe(0);
  });

  test('a type ratchet that stopped holding is a regression', () => {
    const holds = { ratchet: { 'twin-mapper-drift': { holds: true, detail: 'TS2741' } } };
    const loose = { ratchet: { 'twin-mapper-drift': { holds: false, detail: 'compiles clean' } } };
    const base = reportWith([RED_TEST_SCORED], holds);
    const now = reportWith([RED_TEST_SCORED], loose);

    const diff = diffAgainstBaseline(now, base);

    expect(diff.regressions).toEqual(['twin-mapper-drift: type ratchet HOLDS -> LOOSE — compiles clean']);
    expect(exitCodeFor(diff)).toBe(2);
  });

  test('a type ratchet that stopped being checked at all is a loss', () => {
    const base = reportWith([RED_TEST_SCORED], { ratchet: { 'twin-mapper-drift': { holds: true, detail: 'TS2741' } } });
    const now = reportWith([RED_TEST_SCORED]);

    const diff = diffAgainstBaseline(now, base);

    expect(diff.lostMeasurements).toEqual([
      'twin-mapper-drift: the type ratchet is no longer checked — the baseline checked it',
    ]);
    expect(exitCodeFor(diff)).toBe(2);
  });

  // render prints "P8 wants >= 20%" a dozen lines above the verdict, so the
  // share collapsing while the verdict says nothing is the report contradicting
  // itself on its own headline number. The share is recomputed from the catches,
  // never read from the stored field, so editing that field moves nothing.
  test('the deterministic share of catches falling is a regression even when the llm gate improved', () => {
    const specCheckBarelyCatches: GateStats = {
      ...SPEC_CHECK_SCORED,
      caught: 2, missed: 17, detection_rate: 0.105, false_positives: 0, fp_rate: 0,
    };
    const base = reportWith([RED_TEST_SCORED, specCheckBarelyCatches]);
    const now = reportWith([RED_TEST_SCORED, { ...SPEC_CHECK_SCORED, false_positives: 0, fp_rate: 0 }]);

    const diff = diffAgainstBaseline(now, base);

    expect(diff.regressions).toEqual(['deterministic share of all catches 0.895 -> 0.5 (P8 wants >= 0.2)']);
    expect(diff.improvements).toContain('spec-check: detection 2/19 (0.105) -> 17/19 (0.895)');
    expect(exitCodeFor(diff)).toBe(2);
  });

  test('editing the stored share in the baseline changes nothing, because it is recomputed', () => {
    const base = reportWith([RED_TEST_SCORED]);
    const tampered = { ...base, deterministic_catch_share: 0.02 };
    const now = reportWith([RED_TEST_SCORED]);

    expect(diffAgainstBaseline(now, tampered)).toEqual(diffAgainstBaseline(now, base));
    expect(exitCodeFor(diffAgainstBaseline(now, tampered))).toBe(0);
  });

  // The share swings purely on which gate families ran, so comparing it across a
  // paid baseline and a free run measures the operator's wallet, not the gates.
  test('the deterministic share is not compared when the measured set itself changed', () => {
    const base = reportWith([RED_TEST_SCORED, SPEC_CHECK_SCORED]);
    const now = reportWith([RED_TEST_SCORED, SPEC_CHECK_NEVER_SCORED]);

    const diff = diffAgainstBaseline(now, base, PAID_GATES_OFF);

    expect(diff.regressions).toEqual([]);
    expect(diff.improvements).toEqual([]);
    expect(exitCodeFor(diff)).toBe(0);
  });

  test('a gate deleted from the harness is a loss', () => {
    const base = reportWith([RED_TEST_SCORED, LINT_SCORED]);
    const now = reportWith([LINT_SCORED]);

    const diff = diffAgainstBaseline(now, base);

    expect(diff.lostMeasurements).toHaveLength(2);
    expect(diff.lostMeasurements[0]).toContain('red-test: detection is no longer scored at all');
    expect(exitCodeFor(diff)).toBe(2);
  });

  // A gate with no baseline cannot regress against one. It is loud in the report
  // and it does not turn the ratchet red, because every gate addition would.
  test('a gate added to the harness is unfrozen even when it scores badly', () => {
    const uselessNewGate: GateStats = {
      gate: 'newgate',
      family: 'deterministic',
      gate_backend: '',
      judge_backend: '',
      available: true,
      unavailable_reason: '',
      caught: 0, missed: 19, n_a: 0, error: 0, applicable: 19,
      detection_rate: 0, coverage: 1, false_positives: 12, fp_errors: 0, fp_denominator: 19, fp_rate: 0.632,
    };
    const base = reportWith([LINT_SCORED]);
    const now = reportWith([LINT_SCORED, uselessNewGate]);

    const diff = diffAgainstBaseline(now, base);

    expect(diff.unfrozenMeasurements).toEqual([
      'newgate: detection first produced a number — 0/19 (0). The baseline holds no number for this metric, so the next run cannot be compared with it: even 0/19 would print UNFROZEN again. Freeze it now, in the run that measured it — bun personal/oracle/run.ts --write-baseline',
      'newgate: false positives first produced a number — 12/19 (0.632). The baseline holds no number for this metric, so the next run cannot be compared with it: even 0/19 would print UNFROZEN again. Freeze it now, in the run that measured it — bun personal/oracle/run.ts --write-baseline',
    ]);
    expect(diff.firstMeasurements).toEqual([]);
    expect(diff.regressions).toEqual([]);
    expect(exitCodeFor(diff)).toBe(3);
  });

  // Nulling one rate in baseline.json used to read as "never measured" and
  // silently retire that gate's comparison forever. Every stored field is
  // checked against the neighbours summarize derives with it.
  test('a baseline rate edited to null contradicts its own counts and refuses to compare', () => {
    const tampered: GateStats = { ...GUARD_AFTER_DENYLIST_SPLIT, fp_rate: null };
    const base = reportWith([tampered]);
    const now = reportWith([{ ...GUARD_AFTER_DENYLIST_SPLIT, false_positives: 8, fp_rate: 1 }]);

    const diff = diffAgainstBaseline(now, base);

    expect(diff.corruption).toEqual([
      'baseline: gate "guard" says false positive rate null but 1/8 is 0.125',
    ]);
    expect(diff.firstMeasurements).toEqual([]);
    expect(exitCodeFor(diff)).toBe(1);
  });

  test('a gate deleted from the baseline while its fixtures still score it refuses to compare', () => {
    const base = reportWith([LINT_SCORED], {
      matrix: { 'idempotency-key-race': { lint: 'missed', 'red-test': 'caught' } },
    });
    const now = reportWith([LINT_SCORED, RED_TEST_SCORED], {
      matrix: { 'idempotency-key-race': { lint: 'missed', 'red-test': 'caught' } },
    });

    const diff = diffAgainstBaseline(now, base);

    expect(diff.corruption).toEqual([
      'baseline: every fixture scores "red-test" but gates[] has no record of it',
    ]);
    expect(exitCodeFor(diff)).toBe(1);
  });

  // applicable is both a printed denominator and the switch between the rate
  // comparison and the raw-count one, so editing it alone steers the comparison
  // and prints a fraction that disagrees with its own rate.
  test('a baseline denominator edited alone refuses to compare', () => {
    const base = reportWith([{ ...RED_TEST_SCORED, applicable: 12 }]);
    const now = reportWith([RED_TEST_SCORED]);

    const diff = diffAgainstBaseline(now, base);

    expect(diff.corruption.length).toBeGreaterThan(0);
    expect(diff.corruption[0]).toContain('says applicable 12 but caught 17 + missed 2 is 19');
    expect(exitCodeFor(diff)).toBe(1);
  });

  test('an error count edited alone stops accounting for every fixture and refuses to compare', () => {
    const base = reportWith([{ ...RED_TEST_SCORED, error: 7 }]);
    const now = reportWith([RED_TEST_SCORED]);

    const diff = diffAgainstBaseline(now, base);

    expect(diff.corruption).toEqual([
      'baseline: gate "red-test" accounts for 26 fixtures, not 19',
    ]);
    expect(exitCodeFor(diff)).toBe(1);
  });

  // A baseline frozen from a run where most fixtures errored is a poisoned
  // yardstick, and it is internally consistent so nothing else catches it. It
  // has to announce itself every time it is used as the comparison.
  test('a baseline frozen from a partly broken run says so whenever it is compared', () => {
    const frozenFromBrokenRun: GateStats = {
      ...RED_TEST_SCORED,
      caught: 3, missed: 0, n_a: 0, error: 16, applicable: 3,
      detection_rate: 1, coverage: 0.158, fp_denominator: 3, fp_rate: 0,
    };
    const genuineCollapse: GateStats = {
      ...RED_TEST_SCORED,
      caught: 4, missed: 15, error: 0, applicable: 19,
      detection_rate: 0.211, coverage: 1, fp_denominator: 19, fp_rate: 0,
    };
    const base = reportWith([frozenFromBrokenRun]);
    const now = reportWith([genuineCollapse]);

    const diff = diffAgainstBaseline(now, base);

    expect(diff.baselineCaveats).toEqual([
      'red-test: the baseline froze this gate from a run where 16/19 fixtures errored',
    ]);
    expect(diff.improvements).toEqual([]);
    expect(exitCodeFor(diff)).toBe(0);
  });

  // The caveat was gated on the baseline gate still having a rate, so a gate that
  // errored on SOME fixtures got warned about and a gate that errored on ALL of
  // them got nothing. The worst case was the silent one.
  test('a baseline gate that errored on every fixture is caveated, not passed over', () => {
    const base = reportWith([RED_TEST_ALL_ERRORS]);
    const now = reportWith([RED_TEST_SCORED]);

    const diff = diffAgainstBaseline(now, base, PAID_GATES_OFF);

    expect(diff.baselineCaveats).toEqual([
      'red-test: the baseline recorded no number for this gate from a run where 19/19 fixtures errored',
    ]);
    expect(diff.unfrozenMeasurements).toHaveLength(2);
    expect(exitCodeFor(diff)).toBe(3);
  });

  // The everyday free baseline records error 19 on both paid gates by design. A
  // caveat on every healthy run is the noise that stops caveats being read.
  test('gates the operator switched off do not caveat the baseline on every run', () => {
    const base = reportWith([RED_TEST_SCORED, SPEC_CHECK_NEVER_SCORED, REVIEWER_NEVER_SCORED]);
    const now = reportWith([RED_TEST_SCORED, SPEC_CHECK_NEVER_SCORED, REVIEWER_NEVER_SCORED]);

    const diff = diffAgainstBaseline(now, base, PAID_GATES_OFF);

    expect(diff.baselineCaveats).toEqual([]);
    expect(render(now, diff)).toContain('baseline: no change');
    expect(exitCodeFor(diff)).toBe(0);
  });

  test('an unfrozen measurement taken from a broken run declares how much of it errored', () => {
    const base = reportWith([REVIEWER_NEVER_SCORED]);
    const now = reportWith([REVIEWER_QUOTA_DIED_AFTER_TWO]);

    const diff = diffAgainstBaseline(now, base);

    expect(diff.unfrozenMeasurements[0]).toContain('detection first produced a number — 2/2 (1)');
    expect(diff.unfrozenMeasurements[0]).toContain('INCOMPLETE, 17/19 fixtures errored');
    expect(exitCodeFor(diff)).toBe(3);
  });

  // A fixture the gate used to catch and now cannot even judge is the single
  // signal this instrument exists to raise, and it stayed hidden whenever
  // another fixture recovered in the same run and held the error count level.
  test('a fixture that degrades from caught to error is a regression even when the error count holds level', () => {
    const base = reportWith([REVIEWER_SCORED], {
      matrix: { 'idempotency-key-race': { reviewer: 'caught' }, 'global-queue-drain': { reviewer: 'error' } },
    });
    const now = reportWith([REVIEWER_SCORED], {
      matrix: { 'idempotency-key-race': { reviewer: 'error' }, 'global-queue-drain': { reviewer: 'caught' } },
    });

    const diff = diffAgainstBaseline(now, base);

    expect(diff.regressions).toEqual(['idempotency-key-race / reviewer: caught -> error']);
    expect(exitCodeFor(diff)).toBe(2);
  });

  // A fixture becoming applicable is the denominator moving, which the gate-level
  // rule refuses to read as evidence. The cell rule used to call the same fact an
  // improvement, one line apart.
  test('a fixture that became applicable and was caught is not counted as an improvement', () => {
    const base = reportWith([LINT_SCORED], { matrix: { 'idempotency-key-race': { lint: 'n_a' } } });
    const now = reportWith([LINT_SCORED], { matrix: { 'idempotency-key-race': { lint: 'caught' } } });

    const diff = diffAgainstBaseline(now, base);

    expect(diff.improvements).toEqual([]);
    expect(exitCodeFor(diff)).toBe(0);
  });

  test('a fixture the gate started catching is an improvement', () => {
    const base = reportWith([LINT_SCORED], { matrix: { 'idempotency-key-race': { lint: 'missed' } } });
    const now = reportWith([LINT_SCORED], { matrix: { 'idempotency-key-race': { lint: 'caught' } } });

    const diff = diffAgainstBaseline(now, base);

    expect(diff.improvements).toEqual(['idempotency-key-race / lint: missed -> caught']);
    expect(exitCodeFor(diff)).toBe(0);
  });

  // The `available` flag is one boolean in a hand-editable file and nothing in
  // the comparison reads it any more, so an older baseline that predates it
  // still compares normally.
  test('a baseline missing the available flag still compares', () => {
    const collapsed: GateStats = { ...RED_TEST_SCORED, caught: 3, missed: 16, detection_rate: 0.158 };
    const base = reportWith([withoutAvailableFlag(RED_TEST_SCORED)], {
      matrix: { 'idempotency-key-race': { 'red-test': 'caught' } },
    });
    const now = reportWith([collapsed], { matrix: { 'idempotency-key-race': { 'red-test': 'missed' } } });

    const diff = diffAgainstBaseline(now, base);

    expect(diff.regressions).toContain('red-test: detection 17/19 (0.895) -> 3/19 (0.158)');
    expect(diff.regressions).toContain('idempotency-key-race / red-test: caught -> missed');
    expect(exitCodeFor(diff)).toBe(2);
  });

  // available: true is set before a single call succeeds, so a gate whose backend
  // answered but whose quota was gone freezes as available with no numbers.
  test('a baseline that was available but scored nothing still counts as never scored', () => {
    const base = reportWith([{ ...SPEC_CHECK_NEVER_SCORED, available: true, unavailable_reason: '' }]);
    const now = reportWith([SPEC_CHECK_SCORED]);

    const diff = diffAgainstBaseline(now, base);

    expect(diff.unfrozenMeasurements).toHaveLength(2);
    expect(diff.regressions).toEqual([]);
    expect(diff.improvements).toEqual([]);
    expect(exitCodeFor(diff)).toBe(3);
  });

  test('an unchanged run against an unchanged baseline says nothing and exits clean', () => {
    const base = reportWith([GUARD_AFTER_DENYLIST_SPLIT, RED_TEST_SCORED]);
    const now = reportWith([GUARD_AFTER_DENYLIST_SPLIT, RED_TEST_SCORED]);

    const diff = diffAgainstBaseline(now, base);

    expect(diff.regressions).toEqual([]);
    expect(diff.lostMeasurements).toEqual([]);
    expect(diff.firstMeasurements).toEqual([]);
    expect(diff.improvements).toEqual([]);
    expect(exitCodeFor(diff)).toBe(0);
  });
});

// render() is the only surface a human reads and its only caller is run.ts, so a
// category that exists in the diff and not in the printout is invisible in
// exactly the place it was added to be visible.
describe('baseline diff reaches the printed report', () => {
  test('an unfrozen measurement prints its consequence and immediate freeze command', () => {
    const base = reportWith([SPEC_CHECK_NEVER_SCORED]);
    const now = reportWith([SPEC_CHECK_SCORED]);

    const diff = diffAgainstBaseline(now, base, PAID_GATES_OFF);
    const out = render(now, diff);

    expect(out).toContain('UNFROZEN    spec-check: detection first produced a number — 17/19 (0.895)');
    expect(out).toContain('The baseline holds no number for this metric');
    expect(out).toContain('even 0/19 would print UNFROZEN again');
    expect(out).toContain('ORACLE_LLM=1 bun personal/oracle/run.ts --write-baseline');
    expect(out).not.toContain('baseline: no change');
    expect(exitCodeFor(diff)).toBe(3);
  });

  test('a lost measurement is printed under its own alarm word', () => {
    const base = reportWith([RED_TEST_SCORED]);
    const now = reportWith([RED_TEST_ALL_ERRORS]);

    const diff = diffAgainstBaseline(now, base);
    const out = render(now, diff);

    expect(out).toContain('LOST        red-test: detection is no longer scored at all');
    expect(out).not.toContain('baseline: no change');
    expect(exitCodeFor(diff)).toBe(2);
  });

  test('a baseline that contradicts itself is printed before anything is compared', () => {
    const base = reportWith([{ ...GUARD_AFTER_DENYLIST_SPLIT, fp_rate: null }]);
    const now = reportWith([GUARD_AFTER_DENYLIST_SPLIT]);

    const diff = diffAgainstBaseline(now, base);
    const out = render(now, diff);

    expect(out).toContain('CORRUPT     baseline: gate "guard"');
    expect(out).not.toContain('baseline: no change');
    expect(exitCodeFor(diff)).toBe(1);
  });

  test('an acknowledged absence is printed in lower case, away from the alarm words', () => {
    const base = reportWith([SPEC_CHECK_SCORED]);
    const now = reportWith([SPEC_CHECK_NEVER_SCORED]);

    const diff = diffAgainstBaseline(now, base, PAID_GATES_OFF);
    const out = render(now, diff);

    expect(out).toContain('not run     spec-check: detection is no longer scored at all');
    expect(out).not.toContain('LOST');
    expect(exitCodeFor(diff)).toBe(0);
  });

  test('a run that really did not move still says so', () => {
    const base = reportWith([GUARD_AFTER_DENYLIST_SPLIT]);
    const now = reportWith([GUARD_AFTER_DENYLIST_SPLIT]);

    const diff = diffAgainstBaseline(now, base);

    expect(render(now, diff)).toContain('baseline: no change');
    expect(exitCodeFor(diff)).toBe(0);
  });

  // The digest reached the human-readable report only inside the mismatch line,
  // so a clean run printed numbers with nothing naming the exam they came from.
  // The operator grants autonomy off this text, not off --json.
  test('a clean run names the corpus its numbers came from', () => {
    const base = reportWith([GUARD_AFTER_DENYLIST_SPLIT]);
    const now = reportWith([GUARD_AFTER_DENYLIST_SPLIT]);

    const out = render(now, diffAgainstBaseline(now, base));

    expect(out).toContain(`corpus: ${FIXTURES} fixtures, ${CORPUS_DIGEST}`);
    expect(out).toContain('baseline: no change');
  });

  test('a run with no corpus pin says so rather than printing no corpus line at all', () => {
    const now = reportWith([GUARD_AFTER_DENYLIST_SPLIT], { corpus: null });

    const out = render(now, diffAgainstBaseline(now, reportWith([GUARD_AFTER_DENYLIST_SPLIT])));

    expect(out).toContain('corpus: NOT RECORDED');
    expect(out).not.toContain(CORPUS_DIGEST);
  });

  test('ground truth and the report no longer advertise dead floors', () => {
    const groundTruth = loadGroundTruth() as unknown as Record<string, unknown>;
    const now = reportWith([GUARD_AFTER_DENYLIST_SPLIT]);

    const out = render(now, diffAgainstBaseline(now, now));

    expect(groundTruth).not.toHaveProperty('minimum_detection');
    expect(groundTruth).not.toHaveProperty('max_false_positives');
    expect(out).not.toContain('minimum_detection');
  });

  test('a run that lost a fixture does not claim nothing changed one line above saying so', () => {
    const base = reportWith([RED_TEST_SCORED], {
      matrix: { 'idempotency-key-race': { 'red-test': 'caught' }, 'global-queue-drain': { 'red-test': 'caught' } },
    });
    const now = reportWith([RED_TEST_SCORED], { matrix: { 'idempotency-key-race': { 'red-test': 'caught' } } });

    const diff = diffAgainstBaseline(now, base);
    const out = render(now, diff);

    expect(out).toContain('DROPPED     global-queue-drain');
    expect(out).not.toContain('baseline: no change');
    expect(exitCodeFor(diff)).toBe(0);
  });

  test('every printed verdict word lines its content up in the same column', () => {
    const base = reportWith([SPEC_CHECK_SCORED, RED_TEST_SCORED]);
    const now = reportWith([SPEC_CHECK_NEVER_SCORED, RED_TEST_ALL_ERRORS]);
    const diff = diffAgainstBaseline(now, base, PAID_GATES_OFF);
    diff.corruption.push('a corrupt line');
    diff.improvements.push('an improved line');
    diff.unfrozenMeasurements.push('spec-check: an unfrozen line');
    diff.firstMeasurements.push('a measured line');
    diff.baselineCaveats.push('a caveat line');
    diff.newCases.push('a-new-fixture');
    diff.droppedCases.push('a-dropped-fixture');

    const out = render(now, diff);
    const verdictLines = out.split('\n')
      .filter(l => /^(CORRUPT|LOST|REGRESSION|improved|UNFROZEN|MEASURED|not run|caveat|new fixture|DROPPED) /.test(l));

    expect(exitCodeFor(diff)).toBe(1);
    expect(out.indexOf('\nUNFROZEN')).toBeLessThan(out.indexOf('\nMEASURED'));
    expect(verdictLines.length).toBeGreaterThan(6);
    for (const line of verdictLines) expect(line[11]).toBe(' ');
    for (const line of verdictLines) expect(line[12]).not.toBe(' ');
  });
});

describe('oracle fixture integrity', () => {
  test('every ground-truth bug names a real source', async () => {
    const gt = loadGroundTruth();
    expect(gt.bugs.length).toBe(gt.total_bugs);
    for (const bug of gt.bugs) {
      expect(bug.source.length).toBeGreaterThan(10);
      expect(bug.spec.length).toBeGreaterThan(10);
      expect(bug.detection_hint).toContain('|');
    }
  });

  test('every fixture is red on buggy and green on fixed', async () => {
    const cases = await loadCases();
    const integrity = await verifyFixtures(cases);
    const broken = integrity.filter(i => !i.ok).map(i => `${i.id}: ${i.detail}`);
    expect(broken).toEqual([]);
    expect(integrity.length).toBe(cases.length);
  }, 120_000);

  test('the red test gate does not regress against the baseline', async () => {
    const cases = await loadCases();
    const redTest = await runRedTestGate(cases);
    const stats = summarize(redTest, cases.length);
    expect(stats.error).toBe(0);
    expect(stats.false_positives).toBe(0);

    // This asserts red-test's numbers, not the corpus pin, and the frozen
    // baseline predates that pin. Comparing against a copy that carries this
    // run's fingerprint keeps the assertion meaningful both before and after
    // someone re-freezes; the pin itself is covered by its own suite above.
    const report = buildReport(cases, [redTest], [], {}, corpusFingerprint());
    const frozen = readFrozenBaseline();
    if (frozen) {
      const comparable: OracleReport = { ...frozen, corpus: report.corpus };
      const diff = diffAgainstBaseline(report, comparable, PAID_GATES_OFF);

      expect(diff.corruption).toEqual([]);
      expect(diff.corpusChanged).toEqual([]);
      expect(diff.regressions.filter(r => r.includes('red-test'))).toEqual([]);
      expect(diff.lostMeasurements.filter(l => l.includes('red-test'))).toEqual([]);
    }
  }, 180_000);
});

describe.skipIf(!slowGates)('oracle deterministic gates (ORACLE=1)', () => {
  test('guard, lint and tsc all pass their canaries', async () => {
    const cases = await loadCases();
    const outcomes = [runGuardGate(cases, loadGuardFpProbes()), runLintGate(cases), runTscGate(cases)];
    const dead = outcomes.filter(o => !o.available).map(o => `${o.gate}: ${o.unavailable_reason}`);
    expect(dead).toEqual([]);
  }, 900_000);

  // The free-tier E2E tests can only prove the refusal, since a bash-only corpus
  // leaves lint and tsc with nothing to score and is unfit by construction. A
  // freeze that always refuses is a ratchet that can never be re-frozen, so the
  // other direction needs the whole corpus — on a copy, never the installed one.
  test('--write-baseline freezes a run that is fit to freeze', () => {
    const root = miniCorpus(loadGroundTruth().bugs.map(b => b.id));
    try {
      const run = runOracle(root, ['--write-baseline']);
      expect(run.stderr).not.toContain('refusing to freeze');
      expect(run.stdout).toContain('baseline written');
      expect(run.code).toBe(0);

      const frozen = JSON.parse(fs.readFileSync(path.join(root, 'baseline.json'), 'utf-8')) as OracleReport;
      expect(frozen.corpus).toEqual(corpusFingerprint(root));
      expect(runOracle(root).code).toBe(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 900_000);

  // Anything less than everything run.ts assembles is a different input: it
  // appends both skipped LLM gates, and it passes the real type ratchet. An
  // empty ratchet or a four-gate report would exercise a shape production never
  // produces, and the paths this diff has been wrong on are exactly those.
  test('a real free-tier run against the frozen baseline exits clean', async () => {
    const cases = await loadCases();
    const outcomes = [
      runGuardGate(cases, loadGuardFpProbes()),
      runLintGate(cases),
      runTscGate(cases),
      await runRedTestGate(cases),
      skippedLlmGate('spec-check', cases, llm.reason),
      skippedLlmGate('reviewer', cases, llm.reason),
    ];
    const report = buildReport(cases, outcomes, await verifyFixtures(cases), runTscRatchet(cases), corpusFingerprint());
    const diff = diffBaseline(report, PAID_GATES_OFF);
    const frozen = readFrozenBaseline();

    expect(diff.corruption).toEqual([]);
    expect(diff.regressions).toEqual([]);
    expect(diff.lostMeasurements).toEqual([]);

    // Two worlds, and which one holds is a property of the file on disk rather
    // than of this run. The baseline frozen before the corpus pin existed cannot
    // be compared against at all; once it is re-frozen, it compares and passes.
    if (frozen?.corpus) {
      expect(frozen.corpus.digest).toBe(report.corpus?.digest);
      expect(diff.corpusChanged).toEqual([]);
      expect(exitCodeFor(diff)).toBe(0);
    } else {
      expect(diff.corpusChanged).toEqual([
        'the baseline does not record which fixtures it measured, so nothing can be compared against it — re-freeze with --write-baseline',
      ]);
      expect(exitCodeFor(diff)).toBe(1);
    }
  }, 900_000);
});

describe('LLM backend provenance and instrument changes', () => {
  function specSample(caught: number, falsePositives: number, generatedAt: string): OracleReport {
    return {
      ...reportWith([{
        ...SPEC_CHECK_SCORED,
        caught,
        missed: FIXTURES - caught,
        detection_rate: Math.round((caught / FIXTURES) * 1000) / 1000,
        false_positives: falsePositives,
        fp_rate: Math.round((falsePositives / FIXTURES) * 1000) / 1000,
      }]),
      generated_at: generatedAt,
    };
  }

  test('--repeat defaults to one rejudge with unchanged single-sample behavior', () => {
    const report = specSample(16, 2, 'single');

    expect(rejudgeRepeat(['--rejudge'])).toBe(1);
    expect(rejudgeRepeat(['--rejudge', '--repeat', '1'])).toBe(1);
    expect(recordObservedNoise([report])).toBe(report);
    expect(report.gates[0].noise_range).toBeUndefined();
  });

  test('three samples freeze the real spec-check median report intact', () => {
    const low = specSample(15, 2, 'low');
    const median = specSample(16, 3, 'median');
    const high = specSample(16, 1, 'high');
    const frozen = recordObservedNoise([high, low, median]);

    expect(selectMedianRejudgeReport([high, low, median])).toBe(median);
    expect(frozen.generated_at).toBe('median');
    expect(frozen.gates[0]).toMatchObject({ caught: 16, missed: 3, applicable: 19, false_positives: 3 });
    expect(diffAgainstBaseline(frozen, frozen).corruption).toEqual([]);
  });

  test('an even sample count takes the deterministic lower-middle report', () => {
    const reports = [
      specSample(17, 0, 'fourth'),
      specSample(15, 2, 'second'),
      specSample(16, 1, 'third'),
      specSample(14, 3, 'first'),
    ];

    expect(selectMedianRejudgeReport(reports).generated_at).toBe('second');
    expect(selectMedianRejudgeReport(reports).generated_at).toBe('second');
  });

  test('a value inside a three-sample range is withinNoise and exits zero', () => {
    const base = recordObservedNoise([
      specSample(15, 2, 'low'),
      specSample(16, 2, 'median'),
      specSample(17, 1, 'high'),
    ]);
    base.matrix = { 'idempotency-key-race': { 'spec-check': 'caught' } };
    const now = specSample(15, 2, 'now');
    now.matrix = { 'idempotency-key-race': { 'spec-check': 'missed' } };
    const diff = diffAgainstBaseline(now, base);

    expect(diff.withinNoise).toEqual([
      'spec-check: detection 16/19 (0.842) -> 15/19 (0.789) — within observed range 15..17 from 3 samples',
    ]);
    expect(diff.regressions).toEqual([]);
    expect(render(now, diff)).toContain('withinNoise spec-check: detection');
    expect(exitCodeFor(diff)).toBe(0);
  });

  test('a value outside the observed range remains a regression', () => {
    const base = recordObservedNoise([
      specSample(15, 2, 'low'),
      specSample(16, 2, 'median'),
      specSample(17, 1, 'high'),
    ]);
    const diff = diffAgainstBaseline(specSample(14, 2, 'now'), base);

    expect(diff.withinNoise).toEqual([]);
    expect(diff.regressions).toContain('spec-check: detection 16/19 (0.842) -> 14/19 (0.737)');
    expect(exitCodeFor(diff)).toBe(2);
  });

  test('a range with fewer than three samples cannot suppress a regression', () => {
    const base = specSample(17, 2, 'base');
    base.gates[0].noise_range = {
      samples: 2,
      detection: { min: 16, max: 17 },
      false_positives: { min: 1, max: 2 },
    };
    const diff = diffAgainstBaseline(specSample(16, 2, 'now'), base);

    expect(diff.withinNoise).toEqual([]);
    expect(diff.regressions).toContain('spec-check: detection 17/19 (0.895) -> 16/19 (0.842)');
    expect(exitCodeFor(diff)).toBe(2);
  });

  test('the same backend pair preserves normal regression comparison', () => {
    const base = reportWith([SPEC_CHECK_SCORED]);
    const worse = { ...SPEC_CHECK_SCORED, caught: 16, missed: 3, detection_rate: 0.842 };
    const diff = diffAgainstBaseline(reportWith([worse]), base);

    expect(diff.instrumentChanged).toEqual([]);
    expect(diff.regressions).toContain('spec-check: detection 17/19 (0.895) -> 16/19 (0.842)');
    expect(exitCodeFor(diff)).toBe(2);
  });

  test('a changed backend pair is an instrument change instead of a regression', () => {
    const base = reportWith([SPEC_CHECK_SCORED]);
    const changed = {
      ...SPEC_CHECK_SCORED,
      gate_backend: 'anthropic-api',
      caught: 16,
      missed: 3,
      detection_rate: 0.842,
    };
    const diff = diffAgainstBaseline(reportWith([changed]), base);

    expect(diff.instrumentChanged).toEqual([
      'spec-check: backend pair codex/claude-cli -> anthropic-api/claude-cli; numbers from different instruments are not comparable — re-freeze with --write-baseline',
    ]);
    expect(diff.regressions).toEqual([]);
    expect(exitCodeFor(diff)).toBe(1);
  });

  test('an instrument change excludes only its own gate', () => {
    const base = reportWith([SPEC_CHECK_SCORED, REVIEWER_SCORED]);
    const changedSpec = { ...SPEC_CHECK_SCORED, gate_backend: 'anthropic-api', caught: 16, missed: 3, detection_rate: 0.842 };
    const worseReviewer = { ...REVIEWER_SCORED, caught: 12, missed: 6, detection_rate: 0.667 };
    const diff = diffAgainstBaseline(reportWith([changedSpec, worseReviewer]), base);

    expect(diff.instrumentChanged).toHaveLength(1);
    expect(diff.regressions).toEqual(['reviewer: detection 13/18 (0.722) -> 12/18 (0.667)']);
  });

  test('a legacy baseline without provenance emits a caveat and remains comparable', () => {
    const legacy: Partial<GateStats> = { ...SPEC_CHECK_SCORED };
    delete legacy.gate_backend;
    delete legacy.judge_backend;
    const diff = diffAgainstBaseline(reportWith([SPEC_CHECK_SCORED]), reportWith([legacy as GateStats]));

    expect(diff.corruption).toEqual([]);
    expect(diff.baselineCaveats).toEqual([
      'spec-check: this baseline does not record which gate/judge backends produced its numbers, so one silent backend change cannot be detected for this gate; metrics remain comparable',
    ]);
    expect(diff.regressions).toEqual([]);
    expect(exitCodeFor(diff)).toBe(0);
  });

  test('non-hermetic backends are refused as gates but accepted as judges', () => {
    expect(() => requireBackendRole(claudeCliBackend, 'gate')).toThrow(
      'backend "claude-cli" cannot run as a gate: it is non-hermetic and reads the operator\'s real ~/.claude configuration',
    );
    expect(requireBackendRole(claudeCliBackend, 'judge')).toBe(claudeCliBackend);
  });

  test('shared LLM gate-backend families render the double-counting warning', () => {
    const shared = reportWith([SPEC_CHECK_SCORED, REVIEWER_SCORED]);
    const independent = reportWith([
      SPEC_CHECK_SCORED,
      { ...REVIEWER_SCORED, gate_backend: 'anthropic-api' },
    ]);

    expect(shared.llm_gate_backends_share_family).toBe(true);
    expect(render(shared, diffAgainstBaseline(shared, shared))).toContain('one opinion counted twice, not a cross-check');
    expect(independent.llm_gate_backends_share_family).toBe(false);
    expect(render(independent, diffAgainstBaseline(independent, independent))).not.toContain('one opinion counted twice, not a cross-check');
  });

  // A baseline frozen by a FREE run records '' for both backends, because the gate
  // never ran. Reading that as "a different instrument" turns the next paid run into
  // exit 1 with advice to re-freeze WITHOUT ORACLE_LLM, which freezes an empty
  // baseline again. Empty means unmeasured, not different.
  test('a baseline frozen free then measured paid is unfrozen, not an instrument change', () => {
    const base = reportWith([SPEC_CHECK_NEVER_SCORED]);
    const now = reportWith([SPEC_CHECK_SCORED]);

    const diff = diffAgainstBaseline(now, base);

    expect(diff.instrumentChanged).toEqual([]);
    expect(diff.baselineCaveats.filter(c => c.includes('does not record which gate/judge backends'))).toEqual([]);
    expect(diff.unfrozenMeasurements).toHaveLength(2);
    expect(exitCodeFor(diff)).toBe(3);
  });

  test('per-gate backend overrides fall back through common knobs to defaults', () => {
    const own = resolveBackends({
      ORACLE_REVIEWER_GATE_BACKEND: 'anthropic-api',
      ORACLE_REVIEWER_JUDGE_BACKEND: 'anthropic-api',
      ORACLE_GATE_BACKEND: 'codex',
      ORACLE_JUDGE_BACKEND: 'claude-cli',
    }, 'reviewer');
    const common = resolveBackends({ ORACLE_GATE_BACKEND: 'anthropic-api', ORACLE_JUDGE_BACKEND: 'anthropic-api' }, 'reviewer');
    const defaults = resolveBackends({}, 'reviewer');

    expect([own.gate.name, own.judge.name]).toEqual(['anthropic-api', 'anthropic-api']);
    expect([common.gate.name, common.judge.name]).toEqual(['anthropic-api', 'anthropic-api']);
    expect([defaults.gate.name, defaults.judge.name]).toEqual(['codex', 'claude-cli']);
  });
});

describe('variant-aware outcome judging and replay', () => {
  // A run whose canary tripped reports the gate unavailable with every cell
  // errored. Folding that into the range turns "the gate died" into "within
  // noise", which is the one thing a range must never be able to say.
  const noiseSample = (caught: number, fp: number): GateStats => ({
    ...SPEC_CHECK_SCORED,
    caught, missed: 19 - caught, applicable: 19, error: 0,
    detection_rate: caught / 19, false_positives: fp, fp_denominator: 19, fp_rate: fp / 19,
  });
  const deadSample: GateStats = { ...SPEC_CHECK_SCORED, available: false, error: 19, caught: 0, missed: 0, applicable: 0, detection_rate: null, false_positives: 0, fp_denominator: 0, fp_rate: null };

  test('a sample where the gate never ran stays out of its noise range', () => {
    const frozen = recordObservedNoise([
      reportWith([noiseSample(16, 1)]), reportWith([noiseSample(17, 0)]),
      reportWith([noiseSample(16, 1)]), reportWith([deadSample]), reportWith([deadSample]),
    ]);

    const gate = frozen.gates.find(g => g.gate === 'spec-check');
    expect(gate?.noise_range?.samples).toBe(3);
    expect(gate?.noise_range?.detection).toEqual({ min: 16, max: 17 });
    expect(gate?.noise_range?.false_positives).toEqual({ min: 0, max: 1 });
  });

  // Ranked purely by caught ascending, two dead samples sit either side of the
  // middle and the median lands on one of them. Freezing a run where the gate
  // never ran would publish its zeros as the measurement.
  test('the median is chosen from runs where the gate actually ran', () => {
    const chosen = selectMedianRejudgeReport([
      reportWith([deadSample]), reportWith([deadSample]), reportWith([noiseSample(17, 0)]),
    ]);

    const gate = chosen.gates.find(g => g.gate === 'spec-check');
    expect(gate?.available).toBe(true);
    expect(gate?.caught).toBe(17);
  });

  test('fewer than three intact samples records no range rather than a fabricated one', () => {
    const frozen = recordObservedNoise([
      reportWith([noiseSample(16, 1)]), reportWith([noiseSample(17, 0)]),
      reportWith([deadSample]), reportWith([deadSample]), reportWith([deadSample]),
    ]);

    expect(frozen.gates.find(g => g.gate === 'spec-check')?.noise_range).toBeUndefined();
  });

  // The library short-circuit in obtainReport is what actually stops a rejudge
  // from spending, and it has its own tests. This pins the second layer: run.ts
  // hands the gates a backend whose callJson throws, so a refactor that drops
  // the wrapper cannot quietly turn a free replay back into a paid run.
  test('run.ts gives rejudge a gate backend that throws instead of calling out', () => {
    const source = fs.readFileSync(path.join(APPARATUS_DIR, 'run.ts'), 'utf-8');

    expect(source).toContain('rejudge attempted to call');
    expect(source.slice(source.indexOf('function cachedGateBackend'))).toMatch(/callJson[\s\S]{0,120}throw new Error/);
  });

  const groundTruth = {
    total_bugs: 1,
    bugs: [{ id: 'fixture-bug', category: 'correctness', severity: 'high', description: 'The defect.', detection_hint: 'defect|remedy' }],
  };

  function backend(call: (prompt: string) => unknown): Backend {
    return {
      name: 'codex',
      family: 'openai',
      hermetic: true,
      available: () => ({ ok: true, reason: '' }),
      callJson: async <T>(prompt: string) => call(prompt) as T,
    };
  }

  function rawRun(dir: string): RawReportRun {
    const run: RawReportRun = {
      dir,
      manifest: {
        format_version: 1,
        generated_at: '2026-08-19T00:00:00.000Z',
        source_run: 'paid-source-run',
        gate_backends: { 'spec-check': 'codex', reviewer: 'codex' },
      },
    };
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(run.manifest, null, 2)}\n`);
    return run;
  }

  function writeReplaySet(run: RawReportRun, fixture: string): void {
    for (const [id, variant, report] of [
      ['llm-canary-unauthenticated-delete-all-customers', 'buggy', 'The unauthenticated bulk delete remains.'],
      [fixture, 'buggy', 'The planted defect remains.'],
      [fixture, 'fixed', 'The fix is present.'],
    ] as const) {
      writeRawReport(run, { gate: 'spec-check', fixture: id, variant, gate_backend: 'codex', report });
    }
  }

  test('the default outcome prompt is exactly the legacy buggy prompt', () => {
    const report = 'One finding.';
    const expected = `You are evaluating a QA testing report against known ground truth bugs.

GROUND TRUTH (1 planted bugs):
${JSON.stringify(groundTruth.bugs, null, 2)}

QA REPORT (generated by an AI agent):
One finding.

For each planted bug, determine if the report identified it. A bug counts as
"detected" if the report describes the same defect, even if the wording differs.
Use the detection_hint keywords as guidance.

Also count false positives: issues in the report that don't correspond to any
planted bug AND aren't legitimate issues with the page.

Respond with ONLY valid JSON:
{
  "detected": ["bug-id-1", "bug-id-2"],
  "missed": ["bug-id-3"],
  "false_positives": 0,
  "detection_rate": 2,
  "evidence_quality": 4,
  "reasoning": "brief explanation"
}

Rules:
- "detected" and "missed" arrays must only contain IDs from the ground truth: fixture-bug
- detection_rate = length of detected array
- evidence_quality (1-5): Do detected bugs have screenshots, repro steps, or specific element references?
  5 = excellent evidence for every bug, 1 = no evidence at all`;

    expect(outcomeJudgePrompt(groundTruth, report)).toBe(expected);
  });

  test('the fixed prompt includes the fix diff and distinguishes unchanged evidence from a remains-present claim', () => {
    const fixDiff = '-const repo = hardcoded;\n+const repo = discovered;';
    const prompt = outcomeJudgePrompt(groundTruth, 'The report.', 'fixed', fixDiff);

    expect(prompt).toContain('HAS ALREADY BEEN FIXED');
    expect(prompt).toContain('only if the report claims the defect remains');
    expect(prompt).toContain('A keyword match alone is never enough');
    expect(prompt).toContain(fixDiff);
    expect(prompt).toContain('Code present in both variants is not part of the fix');
    expect(prompt).toContain('only quotes unchanged code is not, by itself');
    expect(prompt).toContain('independently asserts that the same defect still remains, count it as detected');
  });

  test('the buggy prompt ignores a supplied fix diff', () => {
    const prompt = outcomeJudgePrompt(groundTruth, 'The report.', 'buggy', 'MUST_NOT_REACH_BUGGY_PROMPT');

    expect(prompt).not.toContain('MUST_NOT_REACH_BUGGY_PROMPT');
    expect(prompt).not.toContain('FIX DIFF');
  });

  test('LLM scoring receives buggy prompts for canary and detection, then a fixed prompt for false positives', async () => {
    const source = (await loadCases()).find(c => c.bug.id === 'idempotency-key-race')!;
    const prompts: string[] = [];
    await runSpecCheckGate([source], {
      gate: backend(() => ({ findings: [{ title: 'Finding', why_it_matters: 'Impact.', evidence: 'Symbol.' }] })),
      judge: backend(prompt => {
        prompts.push(prompt);
        const id = prompt.includes('llm-canary-unauthenticated-delete-all-customers')
          ? 'llm-canary-unauthenticated-delete-all-customers'
          : source.bug.id;
        return { detected: prompt.includes('HAS ALREADY BEEN FIXED') ? [] : [id], reasoning: 'Scored.' };
      }),
    });

    expect(prompts).toHaveLength(3);
    expect(prompts[0]).not.toContain('HAS ALREADY BEEN FIXED');
    expect(prompts[1]).not.toContain('HAS ALREADY BEEN FIXED');
    expect(prompts[2]).toContain('HAS ALREADY BEEN FIXED');
    expect(prompts[0]).not.toContain('FIX DIFF');
    expect(prompts[1]).not.toContain('FIX DIFF');
    expect(prompts[2]).toContain('FIX DIFF');
    expect(prompts[2]).toContain('-  let total: number;');
  });

  test('identical buggy and fixed directories produce a fixed-side error instead of a miss', async () => {
    const source = (await loadCases()).find(c => c.bug.id === 'idempotency-key-race')!;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-empty-fix-diff-'));
    const buggyDir = path.join(root, 'buggy');
    const fixedDir = path.join(root, 'fixed');
    try {
      fs.mkdirSync(buggyDir);
      fs.mkdirSync(fixedDir);
      fs.writeFileSync(path.join(buggyDir, source.entryName), 'export const identical = true;\n');
      fs.writeFileSync(path.join(fixedDir, source.entryName), 'export const identical = true;\n');
      const fixture = { ...source, buggyDir, fixedDir };
      const outcome = await runSpecCheckGate([fixture], {
        gate: backend(() => ({ findings: [{ title: 'Finding', why_it_matters: 'Impact.', evidence: 'Symbol.' }] })),
        judge: backend(prompt => {
          const id = prompt.includes('llm-canary-unauthenticated-delete-all-customers')
            ? 'llm-canary-unauthenticated-delete-all-customers'
            : source.bug.id;
          return { detected: [id], reasoning: 'Scored.' };
        }),
      });

      expect(outcome.cells[source.bug.id].verdict).toBe('caught');
      expect(outcome.cells[source.bug.id].verdict).not.toBe('missed');
      expect(outcome.fp_denominator).toBe(0);
      expect(outcome.fp_errors).toEqual([{
        on: `${source.bug.id}/fixed`,
        detail: `spec-check failed on fixed: fixture ${source.bug.id} has identical buggy and fixed directories; fix diff is empty`,
      }]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('diff exit 1 means a non-empty fix diff and does not throw', async () => {
    const source = (await loadCases()).find(c => c.bug.id === 'hook-hardcoded-repo-path')!;
    const raw = spawnSync('diff', ['-u', source.buggyDir, source.fixedDir], { encoding: 'utf-8' });

    expect(raw.status).toBe(1);
    expect(() => buildFixDiff(source)).not.toThrow();
    expect(buildFixDiff(source)).toContain('-REPO="$HOME/Project/github/dotfiles-claude/personal"');
  });

  test('hint audit names a fixture and token found only in fixed code', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-hint-'));
    try {
      fs.mkdirSync(path.join(root, 'fixtures', 'fake', 'buggy'), { recursive: true });
      fs.mkdirSync(path.join(root, 'fixtures', 'fake', 'fixed'), { recursive: true });
      fs.writeFileSync(path.join(root, 'fixtures', 'fake', 'buggy', 'index.ts'), 'export const state = "broken";\n');
      fs.writeFileSync(path.join(root, 'fixtures', 'fake', 'fixed', 'index.ts'), 'export const state = "remedyToken";\n');
      fs.writeFileSync(path.join(root, 'fixtures', 'ground-truth.json'), JSON.stringify({ bugs: [{ id: 'fake', detection_hint: 'broken|remedyToken' }] }));

      expect(auditDetectionHints(root)).toEqual([{ fixture: 'fake', token: 'remedyToken' }]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('hint audit accepts a token present in both variants', () => {
    expect(auditDetectionHints()).toEqual([]);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-hint-'));
    try {
      for (const variant of ['buggy', 'fixed']) {
        fs.mkdirSync(path.join(root, 'fixtures', 'fake', variant), { recursive: true });
        fs.writeFileSync(path.join(root, 'fixtures', 'fake', variant, 'index.ts'), 'export const sharedToken = true;\n');
      }
      fs.writeFileSync(path.join(root, 'fixtures', 'ground-truth.json'), JSON.stringify({ bugs: [{ id: 'fake', detection_hint: 'sharedToken' }] }));

      expect(auditDetectionHints(root)).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejudge builds complete gate results from raw reports without calling the gate backend', async () => {
    const source = (await loadCases()).find(c => c.bug.id === 'idempotency-key-race')!;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-rejudge-'));
    try {
      const run = rawRun(dir);
      writeReplaySet(run, source.bug.id);
      const outcome = await runSpecCheckGate([source], {
        gate: backend(() => { throw new Error('gate backend must not be called during rejudge'); }),
        judge: backend(prompt => {
          const id = prompt.includes('llm-canary-unauthenticated-delete-all-customers')
            ? 'llm-canary-unauthenticated-delete-all-customers'
            : source.bug.id;
          return { detected: prompt.includes('HAS ALREADY BEEN FIXED') ? [] : [id], reasoning: 'Rejudged.' };
        }),
      }, { rejudgeSource: run });

      expect(outcome.cells[source.bug.id].verdict).toBe('caught');
      expect(outcome.fp_denominator).toBe(1);
      expect(outcome.fp_errors).toEqual([]);
      const report = buildReport([source], [outcome], [], {}, { fixtures: 1, digest: 'rejudge-test' }, {
        mode: 'rejudge',
        raw_report_run: run.manifest.source_run,
        raw_report_dir: run.dir,
      });
      expect(report.report_source).toEqual({
        mode: 'rejudge',
        raw_report_run: 'paid-source-run',
        raw_report_dir: run.dir,
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a missing replay report is an error cell and never a miss', async () => {
    const source = (await loadCases()).find(c => c.bug.id === 'idempotency-key-race')!;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-rejudge-'));
    try {
      const run = rawRun(dir);
      writeReplaySet(run, source.bug.id);
      fs.rmSync(path.join(dir, 'spec-check', 'buggy', `${source.bug.id}.json`));
      const outcome = await runSpecCheckGate([source], {
        gate: backend(() => { throw new Error('gate backend must not be called during rejudge'); }),
        judge: backend(prompt => ({
          detected: prompt.includes('llm-canary-unauthenticated-delete-all-customers')
            ? ['llm-canary-unauthenticated-delete-all-customers']
            : [],
          reasoning: 'Rejudged.',
        })),
      }, { rejudgeSource: run });

      expect(outcome.cells[source.bug.id].verdict).toBe('error');
      expect(outcome.cells[source.bug.id].detail).toContain('raw report missing for (spec-check, idempotency-key-race, buggy)');
      expect(outcome.cells[source.bug.id].verdict).not.toBe('missed');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('false-positive measurement errors', () => {
  function backend(call: (prompt: string) => unknown): Backend {
    return {
      name: 'codex',
      family: 'openai',
      hermetic: true,
      available: () => ({ ok: true, reason: '' }),
      callJson: async <T>(prompt: string) => call(prompt) as T,
    };
  }

  function llmBackends(fixed: 'throw' | 'false-positive') {
    let producerCalls = 0;
    return {
      gate: backend(() => {
        producerCalls++;
        if (fixed === 'throw' && producerCalls === 3) throw new Error('fixed transport died');
        return { findings: [{ title: 'A finding', why_it_matters: 'It matters.', evidence: 'evidence' }] };
      }),
      judge: backend(prompt => {
        const id = prompt.includes('llm-canary-unauthenticated-delete-all-customers')
          ? 'llm-canary-unauthenticated-delete-all-customers'
          : 'idempotency-key-race';
        return { detected: [id], reasoning: 'The named defect is present.' };
      }),
    };
  }

  test('a fixed-side LLM call that throws is an fp error outside numerator and denominator', async () => {
    const source = (await loadCases()).find(c => c.bug.id === 'idempotency-key-race')!;
    const outcome = await runSpecCheckGate([source], llmBackends('throw'));

    expect(outcome.fp_errors).toEqual([
      { on: 'idempotency-key-race/fixed', detail: 'spec-check failed on fixed: fixed transport died' },
    ]);
    expect(outcome.false_positives).toEqual([]);
    expect(outcome.fp_denominator).toBe(0);
  });

  test('a fixed-side SKIPPED-LOUD probe is an fp error outside numerator and denominator', async () => {
    const source = (await loadCases()).find(c => c.bug.id === 'idempotency-key-race')!;
    const fixture: FixtureCase = {
      ...source,
      probe: {
        kind: source.probe.kind,
        run: async variantDir => variantDir === source.buggyDir
          ? { red: true, detail: 'bug reproduced' }
          : { red: false, detail: 'SKIPPED-LOUD: symlink unavailable' },
      },
    };

    const outcome = await runRedTestGate([fixture]);

    expect(outcome.fp_errors).toEqual([
      { on: 'idempotency-key-race/fixed', detail: 'SKIPPED-LOUD: symlink unavailable' },
    ]);
    expect(outcome.false_positives).toEqual([]);
    expect(outcome.fp_denominator).toBe(0);
  });

  test('a completed fixed-side call that reports the bug remains a false positive', async () => {
    const source = (await loadCases()).find(c => c.bug.id === 'idempotency-key-race')!;
    const outcome = await runSpecCheckGate([source], llmBackends('false-positive'));

    expect(outcome.fp_errors).toEqual([]);
    expect(outcome.false_positives).toEqual([
      { on: 'idempotency-key-race/fixed', detail: 'The named defect is present.' },
    ]);
    expect(outcome.fp_denominator).toBe(1);
  });

  test('fp rate uses only completed fixed-side calls', () => {
    const stats = summarize({
      gate: 'spec-check', family: 'llm', gate_backend: 'codex', judge_backend: 'claude-cli', available: true, unavailable_reason: '', cells: {},
      false_positives: [{ on: 'real-fp/fixed', detail: 'reported' }],
      fp_errors: [{ on: 'transport-dead/fixed', detail: 'timeout' }],
      fp_denominator: 2,
    }, 0);

    expect(stats.false_positives).toBe(1);
    expect(stats.fp_errors).toBe(1);
    expect(stats.fp_denominator).toBe(2);
    expect(stats.fp_rate).toBe(0.5);
  });

  test('a baseline without fp_errors is corrupt and no metric is compared', () => {
    const legacyGate: Partial<GateStats> = { ...RED_TEST_SCORED };
    delete legacyGate.fp_errors;
    const baseline = reportWith([legacyGate as GateStats]);
    const diff = diffAgainstBaseline(reportWith([RED_TEST_SCORED]), baseline);

    expect(diff.corruption).toEqual([
      'baseline: gate "red-test" has no fp_errors count; this file predates fixed-side error accounting and must be re-frozen',
    ]);
    expect(exitCodeFor(diff)).toBe(1);
    expect(diff.regressions).toEqual([]);
    expect(diff.improvements).toEqual([]);
    expect(diff.lostMeasurements).toEqual([]);
    expect(diff.firstMeasurements).toEqual([]);
    expect(diff.unfrozenMeasurements).toEqual([]);
  });

  test('render lists fp errors separately from false positives with fixture names', () => {
    const report = reportWith([{ ...RED_TEST_SCORED, false_positives: 1, fp_errors: 1, fp_rate: 0.053 }]);
    report.false_positives = { 'red-test': [{ on: 'real-fp/fixed', detail: 'reported' }] };
    report.fp_errors = { 'red-test': [{ on: 'transport-dead/fixed', detail: 'timeout' }] };
    const out = render(report, diffAgainstBaseline(report, report));
    const fpStart = out.indexOf('\nfalse positives\n');
    const errorStart = out.indexOf('\nfalse-positive measurement errors\n');
    const fpSection = out.slice(fpStart, errorStart);
    const errorSection = out.slice(errorStart);

    expect(fpStart).toBeGreaterThan(-1);
    expect(errorStart).toBeGreaterThan(fpStart);
    expect(fpSection).toContain('real-fp/fixed');
    expect(fpSection).not.toContain('transport-dead/fixed');
    expect(errorSection).toContain('transport-dead/fixed');
    expect(out).toContain('caveat      red-test: the baseline froze false-positive measurements from a run where 1 fixed-side calls errored');
  });
});

describe('oracle llm gate canaries', () => {
  const runners = [
    ['spec-check', runSpecCheckGate],
    ['reviewer', runReviewerGate],
  ] as const;

  function backend(call: (prompt: string) => unknown): Backend {
    return {
      name: 'codex',
      family: 'openai',
      hermetic: true,
      available: () => ({ ok: true, reason: '' }),
      callJson: async <T>(prompt: string) => call(prompt) as T,
    };
  }

  test('a tripped and correctly attributed canary preserves availability without entering metrics', async () => {
    const cases = await loadCases();
    for (const [name, run] of runners) {
      const producerPrompts: string[] = [];
      const judgePrompts: string[] = [];
      const outcome = await run(cases, {
        gate: backend(prompt => {
          producerPrompts.push(prompt);
          return { findings: [{ title: 'Unauthenticated bulk deletion', why_it_matters: 'Any caller can erase all customer data.', evidence: 'database.customers.deleteMany({}) ignores requestingUser' }] };
        }),
        judge: backend(prompt => {
          judgePrompts.push(prompt);
          const id = prompt.includes('llm-canary-unauthenticated-delete-all-customers')
            ? 'llm-canary-unauthenticated-delete-all-customers'
            : cases.find(c => prompt.includes(c.bug.id))?.bug.id;
          return { detected: id ? [id] : [], reasoning: 'The report identifies the named defect.' };
        }),
      });

      expect(outcome.available).toBe(true);
      expect(outcome.unavailable_reason).toBe('');
      expect(Object.keys(outcome.cells)).toEqual(cases.map(c => c.bug.id));
      expect(outcome.cells['llm-canary-unauthenticated-delete-all-customers']).toBeUndefined();
      expect(outcome.fp_denominator).toBe(cases.length);
      expect(producerPrompts).toHaveLength(1 + cases.length * 2);
      expect(judgePrompts).toHaveLength(1 + cases.length * 2);
      expect(producerPrompts[0]).toContain('deleteAllCustomers');
      expect(judgePrompts[0]).toContain('llm-canary-unauthenticated-delete-all-customers');
      expect(name).toBe(outcome.gate);
    }
  });

  test('a silent canary makes the gate unavailable before any fixture runs', async () => {
    const cases = await loadCases();
    for (const [name, run] of runners) {
      let producerCalls = 0;
      let judgeCalls = 0;
      const outcome = await run(cases, {
        gate: backend(() => {
          producerCalls++;
          return { findings: [] };
        }),
        judge: backend(() => {
          judgeCalls++;
          return { detected: [], reasoning: 'No defect reported.' };
        }),
      });

      expect(outcome.available).toBe(false);
      expect(outcome.unavailable_reason).toContain(`canary did not trip: ${name}`);
      expect(Object.values(outcome.cells).every(cell => cell.verdict === 'error')).toBe(true);
      expect(outcome.fp_denominator).toBe(0);
      expect(outcome.false_positives).toEqual([]);
      expect(producerCalls).toBe(1);
      expect(judgeCalls).toBe(1);
    }
  });

  test('a finding attributed to the wrong id makes the gate unavailable before fixtures run', async () => {
    const cases = await loadCases();
    for (const [, run] of runners) {
      let producerCalls = 0;
      let judgeCalls = 0;
      const outcome = await run(cases, {
        gate: backend(() => {
          producerCalls++;
          return { findings: [{ title: 'Bulk deletion', why_it_matters: 'All data is lost.', evidence: 'deleteMany({})' }] };
        }),
        judge: backend(() => {
          judgeCalls++;
          return { detected: ['some-other-bug'], reasoning: 'Attributed elsewhere.' };
        }),
      });

      expect(outcome.available).toBe(false);
      expect(outcome.unavailable_reason).toContain('canary attribution failed');
      expect(outcome.unavailable_reason).toContain('llm-canary-unauthenticated-delete-all-customers');
      expect(Object.values(outcome.cells).every(cell => cell.verdict === 'error')).toBe(true);
      expect(outcome.fp_denominator).toBe(0);
      expect(producerCalls).toBe(1);
      expect(judgeCalls).toBe(1);
    }
  });
});

describe.skipIf(!llm.enabled)('oracle llm gates (ORACLE_LLM=1)', () => {
  test('spec-check and reviewer produce a measurable verdict for every fixture', async () => {
    // ORACLE_LLM_LIMIT exists so a wiring change can be smoke-tested on two
    // fixtures instead of spending a full run's quota to find out the transport
    // is misconfigured. A capped run is not a measurement and says so.
    const limit = Number(process.env.ORACLE_LLM_LIMIT ?? '0');
    const all = await loadCases();
    const cases = Number.isFinite(limit) && limit > 0 ? all.slice(0, limit) : all;
    if (cases.length !== all.length) {
      console.warn(`[oracle] CAPPED at ${cases.length}/${all.length} fixtures — smoke run, not a measurement`);
    }
    console.warn(`[oracle] ${backendLabel()}`);
    const outcomes = [await runSpecCheckGate(cases), await runReviewerGate(cases)];
    for (const o of outcomes) {
      const stats = summarize(o, cases.length);
      expect(stats.error).toBe(0);
      expect(stats.applicable).toBe(cases.length);
    }
  }, 1_800_000);
});

describe('writeBaseline', () => {
  test('freezing identical measurements twice is byte-identical across generated temp paths', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-wb-stable-'));
    const dest = path.join(dir, 'baseline.json');
    const tempRoot = fs.realpathSync(os.tmpdir());
    const report = reportWith([]);
    try {
      report.details = {
        'symlink-path': {
          'red-test': `notes would be written to ${path.join(tempRoot, 'oracle-symlink-path-AAAAAA', 'home', '.claude', 'brain-vault')}, outside the checkout`,
        },
      };
      writeBaseline(report, dest);
      const first = fs.readFileSync(dest, 'utf-8');

      report.details['symlink-path']['red-test'] = `notes would be written to ${path.join(tempRoot, 'oracle-symlink-path-BBBBBB', 'home', '.claude', 'brain-vault')}, outside the checkout`;
      writeBaseline(report, dest);
      const second = fs.readFileSync(dest, 'utf-8');

      expect(second).toBe(first);
      expect(second).toContain('<temp>/oracle-symlink-path-<generated>/home/.claude/brain-vault');
      expect(second).not.toContain(tempRoot);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('refuses to write when the baseline path is a symlink and leaves the link target untouched', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-wb-'));
    const real = path.join(dir, 'real.json');
    const link = path.join(dir, 'baseline.json');
    const sentinel = '"untouched"\n';
    try {
      fs.writeFileSync(real, sentinel);
      fs.symlinkSync(real, link);

      const report = reportWith([RED_TEST_SCORED]);
      expect(() => writeBaseline(report, link)).toThrow(/baseline\.json.*symbolic link/i);
      expect(fs.readFileSync(real, 'utf-8')).toBe(sentinel);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

if (!llm.enabled) {
  console.warn(`\n[oracle] LLM gates NOT measured: ${llm.reason}\n`);
}
if (!slowGates) {
  console.warn('[oracle] guard / lint / tsc NOT measured here — set ORACLE=1 (free, needs npx)\n');
}
