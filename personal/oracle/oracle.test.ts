import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  corpusFingerprint, fixtureEscapes, loadCases, loadGuardFpProbes, loadGroundTruth,
  APPARATUS_DIR, FIXTURES_DIR, SHARED_FIXTURE_HARNESS, type CorpusFingerprint,
} from './lib/cases';
import { verifyFixtures, runRedTestGate, runGuardGate, runLintGate, runTscGate, runTscRatchet, type Verdict } from './lib/gates';
import { backendLabel, llmGatesEnabled, runSpecCheckGate, runReviewerGate, skippedLlmGate } from './lib/llm-gates';
import {
  summarize, diffBaseline, diffAgainstBaseline, buildReport, render, exitCodeFor, unfitToFreeze, writeBaseline, BASELINE_PATH,
  type GateStats, type OracleReport, type DiffContext,
} from './lib/report';

const slowGates = process.env.ORACLE === '1';
const llm = llmGatesEnabled();

const FIXTURES = 19;

const SPEC_CHECK_NEVER_SCORED: GateStats = {
  gate: 'spec-check',
  family: 'llm',
  available: false,
  unavailable_reason: 'ORACLE_LLM=1 is not set — the paid gates are off by default',
  caught: 0, missed: 0, n_a: 0, error: 19, applicable: 0,
  detection_rate: null, coverage: 0, false_positives: 0, fp_denominator: 0, fp_rate: null,
};

const SPEC_CHECK_SCORED: GateStats = {
  gate: 'spec-check',
  family: 'llm',
  available: true,
  unavailable_reason: '',
  caught: 17, missed: 2, n_a: 0, error: 0, applicable: 19,
  detection_rate: 0.895, coverage: 1, false_positives: 13, fp_denominator: 19, fp_rate: 0.684,
};

const REVIEWER_SCORED: GateStats = {
  gate: 'reviewer',
  family: 'llm',
  available: true,
  unavailable_reason: '',
  caught: 13, missed: 5, n_a: 0, error: 1, applicable: 18,
  detection_rate: 0.722, coverage: 0.947, false_positives: 8, fp_denominator: 18, fp_rate: 0.444,
};

const REVIEWER_NEVER_SCORED: GateStats = { ...SPEC_CHECK_NEVER_SCORED, gate: 'reviewer' };

const REVIEWER_QUOTA_DIED_AFTER_TWO: GateStats = {
  gate: 'reviewer',
  family: 'llm',
  available: true,
  unavailable_reason: '',
  caught: 2, missed: 0, n_a: 0, error: 17, applicable: 2,
  detection_rate: 1, coverage: 0.105, false_positives: 0, fp_denominator: 2, fp_rate: 0,
};

const GUARD_AFTER_DENYLIST_SPLIT: GateStats = {
  gate: 'guard',
  family: 'deterministic',
  available: true,
  unavailable_reason: '',
  caught: 0, missed: 2, n_a: 17, error: 0, applicable: 2,
  detection_rate: 0, coverage: 0.105, false_positives: 1, fp_denominator: 8, fp_rate: 0.125,
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
  available: true,
  unavailable_reason: '',
  caught: 17, missed: 2, n_a: 0, error: 0, applicable: 19,
  detection_rate: 0.895, coverage: 1, false_positives: 0, fp_denominator: 19, fp_rate: 0,
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
  available: true,
  unavailable_reason: '',
  caught: 0, missed: 6, n_a: 13, error: 0, applicable: 6,
  detection_rate: 0, coverage: 0.316, false_positives: 0, fp_denominator: 6, fp_rate: 0,
};

const PAID_GATES_OFF: DiffContext = {
  operatorDisabledGates: ['spec-check', 'reviewer'],
  operatorReason: 'ORACLE_LLM=1 is not set — the paid gates are off by default',
};

const EVERYTHING_EXPECTED: DiffContext = { operatorDisabledGates: [], operatorReason: '' };

// The fingerprint of the fixtures actually on disk. Changing the corpus is
// supposed to move it, so a diff that touches fixtures/ or lib/probe.ts is
// expected to update this line AND to re-freeze baseline.json. A digest nobody
// ever asserts against is a digest that can quietly stop being computed.
const CORPUS_DIGEST = '8c66f84239c1a0a0';

const SAME_CORPUS: CorpusFingerprint = { fixtures: FIXTURES, digest: CORPUS_DIGEST };

interface ReportParts {
  matrix?: Record<string, Record<string, Verdict>>;
  ratchet?: Record<string, { holds: boolean; detail: string }>;
  corpus?: CorpusFingerprint | null;
}

function reportWith(gates: GateStats[], parts: ReportParts = {}): OracleReport {
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
    ratchet: parts.ratchet ?? {},
    deterministic_catch_share: null,
    caught_by_any_deterministic: 17,
    caught_by_nothing: [],
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
  test('a gate the baseline never scored is a first measurement, not a regression', () => {
    const base = reportWith([SPEC_CHECK_NEVER_SCORED]);
    const now = reportWith([SPEC_CHECK_SCORED]);

    const diff = diffAgainstBaseline(now, base, PAID_GATES_OFF);

    expect(diff.regressions).toEqual([]);
    expect(diff.improvements).toEqual([]);
    expect(diff.firstMeasurements).toEqual([
      'spec-check: detection scored for the first time — 17/19 (0.895)',
      'spec-check: false positives scored for the first time — 13/19 (0.684)',
    ]);
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

    expect(diff.firstMeasurements).toEqual(['guard: detection scored for the first time — 1/2 (0.5)']);
    expect(exitCodeFor(diff)).toBe(0);
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
  test('a gate added to the harness is a first measurement even when it scores badly', () => {
    const uselessNewGate: GateStats = {
      gate: 'newgate',
      family: 'deterministic',
      available: true,
      unavailable_reason: '',
      caught: 0, missed: 19, n_a: 0, error: 0, applicable: 19,
      detection_rate: 0, coverage: 1, false_positives: 12, fp_denominator: 19, fp_rate: 0.632,
    };
    const base = reportWith([LINT_SCORED]);
    const now = reportWith([LINT_SCORED, uselessNewGate]);

    const diff = diffAgainstBaseline(now, base);

    expect(diff.firstMeasurements).toEqual([
      'newgate: detection scored for the first time — 0/19 (0)',
      'newgate: false positives scored for the first time — 12/19 (0.632)',
    ]);
    expect(diff.regressions).toEqual([]);
    expect(exitCodeFor(diff)).toBe(0);
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
    expect(diff.firstMeasurements).toHaveLength(2);
    expect(exitCodeFor(diff)).toBe(0);
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

  test('a first measurement taken from a broken run declares how much of it errored', () => {
    const base = reportWith([REVIEWER_NEVER_SCORED]);
    const now = reportWith([REVIEWER_QUOTA_DIED_AFTER_TWO]);

    const diff = diffAgainstBaseline(now, base);

    expect(diff.firstMeasurements[0]).toContain('detection scored for the first time — 2/2 (1)');
    expect(diff.firstMeasurements[0]).toContain('INCOMPLETE, 17/19 fixtures errored');
    expect(exitCodeFor(diff)).toBe(0);
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

    expect(diff.firstMeasurements).toHaveLength(2);
    expect(diff.regressions).toEqual([]);
    expect(diff.improvements).toEqual([]);
    expect(exitCodeFor(diff)).toBe(0);
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
  test('a first measurement is printed, not just recorded', () => {
    const base = reportWith([SPEC_CHECK_NEVER_SCORED]);
    const now = reportWith([SPEC_CHECK_SCORED]);

    const diff = diffAgainstBaseline(now, base, PAID_GATES_OFF);
    const out = render(now, diff);

    expect(out).toContain('MEASURED    spec-check: detection scored for the first time — 17/19 (0.895)');
    expect(out).not.toContain('baseline: no change');
    expect(exitCodeFor(diff)).toBe(0);
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

  // minimum_detection and max_false_positives are type declarations and nothing
  // else: no gate, no exit code and no comparison reads either. An operator
  // reading ground-truth.json believes a floor and a ceiling are being held.
  test('the report says the declared floors are not enforced by anything', () => {
    const now = reportWith([GUARD_AFTER_DENYLIST_SPLIT]);

    const out = render(now, diffAgainstBaseline(now, now));

    expect(out).toContain('minimum_detection and max_false_positives');
    expect(out).toContain('nothing reads either');
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
    diff.baselineCaveats.push('a caveat line');
    diff.newCases.push('a-new-fixture');
    diff.droppedCases.push('a-dropped-fixture');

    const verdictLines = render(now, diff)
      .split('\n')
      .filter(l => /^(CORRUPT|LOST|REGRESSION|improved|MEASURED|not run|caveat|new fixture|DROPPED) /.test(l));

    expect(exitCodeFor(diff)).toBe(1);
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
      const comparable: OracleReport = { ...frozen, corpus: frozen.corpus ?? report.corpus };
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

describe('writeBaseline symlink guard', () => {
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
