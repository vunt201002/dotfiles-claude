/**
 * Loads the fixture set and joins it to the ground truth.
 *
 * A fixture is one real bug: `buggy/` is how the code was, `fixed/` is how it
 * ended up, `probe.ts` is the red test, and `witness.ts` (optional) is the
 * targeted assertion that proves the two variants really do differ.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Probe } from './probe';

/**
 * Where the measuring apparatus lives: the guard hook, the lint config, the
 * canaries, `run.ts` itself. Never redirected — an instrument that can be
 * pointed at a copy of itself is not an instrument.
 */
export const APPARATUS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Where the exam lives: the fixtures, the probe harness they import, and the
 * baseline those numbers are frozen into. `ORACLE_ROOT` moves all three
 * together so a test can run the real `run.ts` end to end against a throwaway
 * corpus. Moving them together is what keeps the seam honest: a redirected run
 * reads and writes the copy's baseline and can never reach the installed one.
 */
export const ORACLE_ROOT_OVERRIDE = process.env.ORACLE_ROOT ? path.resolve(process.env.ORACLE_ROOT) : null;
export const ORACLE_DIR = ORACLE_ROOT_OVERRIDE ?? APPARATUS_DIR;
export const FIXTURES_DIR = path.join(ORACLE_DIR, 'fixtures');

export type Lang = 'bash' | 'js' | 'ts';

export interface GroundTruthBug {
  id: string;
  category: string;
  severity: string;
  description: string;
  detection_hint: string;
  source: string;
  bug_class: string;
  lang: Lang;
  spec: string;
  guard_input?: { buggy: unknown; fixed: unknown };
}

export interface GroundTruth {
  fixture: string;
  bugs: GroundTruthBug[];
  total_bugs: number;
}

export interface FixtureCase {
  bug: GroundTruthBug;
  dir: string;
  buggyDir: string;
  fixedDir: string;
  ratchetDir: string | null;
  entryName: string;
  probe: Probe;
  witness: Probe;
  hasOwnWitness: boolean;
}

export interface GuardFpProbe {
  id: string;
  why_benign: string;
  source: string;
  input: unknown;
}

export function loadGroundTruth(): GroundTruth {
  const file = path.join(FIXTURES_DIR, 'ground-truth.json');
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as GroundTruth;
}

export function loadGuardFpProbes(): GuardFpProbe[] {
  const file = path.join(FIXTURES_DIR, 'guard-fp-probes.json');
  return (JSON.parse(fs.readFileSync(file, 'utf-8')) as { probes: GuardFpProbe[] }).probes;
}

export interface CorpusFingerprint {
  fixtures: number;
  digest: string;
}

export interface DetectionHintViolation {
  fixture: string;
  token: string;
}

const MIN_AUDITED_HINT_LENGTH = 5;
const COMMON_HINT_TOKENS = new Set(['code', 'error', 'false', 'issue']);

function readSourceTree(dir: string): string {
  return fs.readdirSync(dir, { withFileTypes: true }).map(entry => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? readSourceTree(target) : entry.isFile() ? fs.readFileSync(target, 'utf-8') : '';
  }).join('\n').toLowerCase();
}

/**
 * Finds hint vocabulary introduced by the fix rather than present in the bug.
 * Tokens shorter than five characters and four generic review words are
 * ignored because their substring collision rate makes them poor evidence.
 */
export function auditDetectionHints(oracleDir: string = ORACLE_DIR): DetectionHintViolation[] {
  const fixturesDir = path.join(oracleDir, 'fixtures');
  const groundTruth = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'ground-truth.json'), 'utf-8')) as GroundTruth;
  const violations: DetectionHintViolation[] = [];
  for (const bug of groundTruth.bugs) {
    const fixtureDir = path.join(fixturesDir, bug.id);
    const buggy = readSourceTree(path.join(fixtureDir, 'buggy'));
    const fixed = readSourceTree(path.join(fixtureDir, 'fixed'));
    for (const raw of bug.detection_hint.split('|')) {
      const token = raw.trim();
      const normalized = token.toLowerCase();
      if (normalized.length < MIN_AUDITED_HINT_LENGTH || COMMON_HINT_TOKENS.has(normalized)) continue;
      if (fixed.includes(normalized) && !buggy.includes(normalized)) violations.push({ fixture: bug.id, token });
    }
  }
  return violations;
}

/**
 * One field into the hash, length-prefixed, so the stream can be read back only
 * one way. Plain concatenation is ambiguous — moving a trailing newline from one
 * file to the next leaves the bytes identical — and a `\0` separator does not
 * fix it, because file CONTENT may contain `\0` and swallow the next entry
 * whole, deleting a file from the digest's view of the corpus.
 */
function hashField(hash: crypto.Hash, field: string | Buffer): void {
  const buf = Buffer.isBuffer(field) ? field : Buffer.from(field, 'utf-8');
  hash.update(`${buf.length}\0`);
  hash.update(buf);
}

function hashTree(hash: crypto.Hash, dir: string, label: string): void {
  // Code-unit order, not localeCompare — collation is locale-dependent, and this digest has to match across machines.
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = `${label}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      throw new Error(`corpus entry ${rel} is a symlink — the corpus must be plain files and directories, or a fixture's bytes are not the bytes the digest names`);
    }
    if (entry.isDirectory()) {
      hashField(hash, `dir ${rel}`);
      hashTree(hash, full, rel);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`corpus entry ${rel} is neither a file nor a directory, so its contents cannot be pinned`);
    }
    hashField(hash, `file ${rel}`);
    hashField(hash, fs.readFileSync(full));
  }
}

/**
 * The one file outside a fixture's own directory that fixture code imports, so
 * it decides what red and green mean for every probe. It is hashed with the
 * corpus for that reason; the rest of `lib/` is the apparatus doing the
 * measuring, not the exam being measured. `fixtureEscapes` is what keeps that
 * split honest — it fails the suite if a fixture reaches anywhere else.
 */
export const SHARED_FIXTURE_HARNESS = path.join(ORACLE_DIR, 'lib', 'probe.ts');

/**
 * Identifies the exam, not the score: every byte under `fixtures/` — each
 * fixture's tree, the ground truth, the guard probe set and any loose file
 * alike — plus the shared probe harness. A ratchet over a corpus it cannot see
 * can always be cleared by editing the corpus, so the baseline has to pin which
 * fixtures its numbers came from. Every name and every file's bytes go in
 * length-prefixed, so the stream reads back exactly one way: renaming,
 * swapping, adding a file or quietly softening one all move the digest.
 *
 * 16 hex chars is kept on purpose. Truncating to 64 bits leaves a second
 * preimage at ~2^64 hashes, far past anyone editing a fixture, and the digest
 * is also read by a human comparing two runs.
 *
 * Takes a root so it can be proven against a copy. A test that had to edit the
 * real corpus to check the fingerprint could corrupt the thing it is measuring.
 */
export function corpusFingerprint(oracleDir: string = ORACLE_DIR): CorpusFingerprint {
  const fixturesDir = path.join(oracleDir, 'fixtures');
  const groundTruthFile = path.join(fixturesDir, 'ground-truth.json');
  const groundTruth = JSON.parse(fs.readFileSync(groundTruthFile, 'utf-8')) as GroundTruth;
  const hash = crypto.createHash('sha256');
  hashField(hash, 'file lib/probe.ts');
  hashField(hash, fs.readFileSync(path.join(oracleDir, 'lib', 'probe.ts')));
  hashTree(hash, fixturesDir, 'fixtures');
  return { fixtures: groundTruth.bugs.length, digest: hash.digest('hex').slice(0, 16) };
}

export interface FixtureEscape {
  file: string;
  reference: string;
}

const QUOTED_LITERAL = /(['"`])([^'"`\n]*)\1/g;
const BARE_RELATIVE_PATH = /(?<![\w.])\.{1,2}[/\\][^\s'"`;,)\]}]*/g;

function isInside(dir: string, target: string): boolean {
  const rel = path.relative(dir, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function pathLiteralTarget(literal: string, fileDir: string, oracleDir: string): string | null {
  if (literal === '..' || /^\.\.?[/\\]/.test(literal)) return path.resolve(fileDir, literal);
  if (literal.startsWith('/')) {
    const absolute = path.resolve(literal);
    return isInside(oracleDir, absolute) ? absolute : null;
  }
  return null;
}

/**
 * Every reference in a fixture that leaves the fixture's own directory. This is
 * what lets the digest hash one file out of all of `lib/`: one escaping
 * reference and the corpus gains a control surface the digest does not cover,
 * permanently, since the target can then be edited without moving the digest.
 *
 * Import syntax is not the unit. A `require`, a dynamic `import()`, a
 * `readFileSync` and a bash `source` all reach the same file, and the file doing
 * the reaching can carry any extension, so the scan is over path literals in
 * every file of the fixture. Quoted and bare tokens are both read, and each is
 * resolved and compared against the fixture directory rather than pattern
 * matched, because the set of ways to spell an escape is not enumerable. A
 * relative literal that leaves the directory always counts; an absolute one
 * counts only when it lands back inside the oracle tree, since `/usr/bin/env`
 * and a URL route are not reaches into the exam.
 */
export function fixtureEscapes(oracleDir: string = ORACLE_DIR): FixtureEscape[] {
  const fixturesDir = path.join(oracleDir, 'fixtures');
  const sharedHarness = path.join(oracleDir, 'lib', 'probe.ts');
  const groundTruth = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'ground-truth.json'), 'utf-8')) as GroundTruth;
  const found = new Map<string, FixtureEscape>();

  for (const bug of groundTruth.bugs) {
    const fixtureDir = path.join(fixturesDir, bug.id);
    for (const name of fs.readdirSync(fixtureDir, { recursive: true, encoding: 'utf-8' })) {
      const file = path.join(fixtureDir, name);
      if (!fs.lstatSync(file).isFile()) continue;
      const source = fs.readFileSync(file, 'utf-8');
      const literals = [
        ...[...source.matchAll(QUOTED_LITERAL)].map(m => m[2]),
        ...[...source.matchAll(BARE_RELATIVE_PATH)].map(m => m[0]),
      ];
      for (const literal of literals) {
        const target = pathLiteralTarget(literal, path.dirname(file), oracleDir);
        if (target === null || isInside(fixtureDir, target)) continue;
        if (target === sharedHarness || `${target}.ts` === sharedHarness) continue;
        found.set(`${bug.id}/${name} -> ${literal}`, { file: `${bug.id}/${name}`, reference: literal });
      }
    }
  }
  return [...found.values()];
}

function entryFor(dir: string, lang: Lang): string {
  const names = lang === 'bash' ? ['script.sh'] : lang === 'ts' ? ['index.ts'] : ['index.js'];
  for (const name of names) {
    if (fs.existsSync(path.join(dir, name))) return name;
  }
  throw new Error(`fixture ${dir} has no ${names.join(' or ')}`);
}

async function importProbe(file: string, key: 'probe' | 'witness'): Promise<Probe> {
  const mod = await import(`file://${file.replace(/\\/g, '/')}`);
  const found = mod[key];
  if (!found || typeof found.run !== 'function') {
    throw new Error(`${file} does not export a ${key} with a run()`);
  }
  return found as Probe;
}

export async function loadCases(): Promise<FixtureCase[]> {
  const gt = loadGroundTruth();
  const cases: FixtureCase[] = [];

  for (const bug of gt.bugs) {
    const dir = path.join(FIXTURES_DIR, bug.id);
    if (!fs.existsSync(dir)) throw new Error(`ground truth names ${bug.id} but ${dir} does not exist`);

    const buggyDir = path.join(dir, 'buggy');
    const fixedDir = path.join(dir, 'fixed');
    const ratchet = path.join(dir, 'ratchet');
    const probeFile = path.join(dir, 'probe.ts');
    const witnessFile = path.join(dir, 'witness.ts');

    if (!fs.existsSync(probeFile)) throw new Error(`fixture ${bug.id} has no probe.ts`);

    const probe = await importProbe(probeFile, 'probe');
    const hasOwnWitness = fs.existsSync(witnessFile);
    const witness = hasOwnWitness ? await importProbe(witnessFile, 'witness') : probe;

    cases.push({
      bug,
      dir,
      buggyDir,
      fixedDir,
      ratchetDir: fs.existsSync(ratchet) ? ratchet : null,
      entryName: entryFor(buggyDir, bug.lang),
      probe,
      witness,
      hasOwnWitness,
    });
  }

  const dirsOnDisk = fs.readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);
  const known = new Set(gt.bugs.map(b => b.id));
  const orphans = dirsOnDisk.filter(d => !known.has(d));
  if (orphans.length > 0) {
    throw new Error(`fixture directories with no ground-truth row: ${orphans.join(', ')}`);
  }

  return cases;
}
