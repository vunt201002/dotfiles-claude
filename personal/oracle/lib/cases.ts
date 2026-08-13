/**
 * Loads the fixture set and joins it to the ground truth.
 *
 * A fixture is one real bug: `buggy/` is how the code was, `fixed/` is how it
 * ended up, `probe.ts` is the red test, and `witness.ts` (optional) is the
 * targeted assertion that proves the two variants really do differ.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Probe } from './probe';

export const ORACLE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
  minimum_detection: number;
  max_false_positives: number;
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
