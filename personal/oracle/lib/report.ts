/**
 * Turns gate outcomes into the numbers P6 exists to produce, and diffs them
 * against a frozen baseline so a drop in oracle quality is visible.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ORACLE_DIR, type FixtureCase } from './cases';
import type { GateOutcome, Verdict, FixtureIntegrity } from './gates';

export const BASELINE_PATH = path.join(ORACLE_DIR, 'baseline.json');

export interface GateStats {
  gate: string;
  family: 'deterministic' | 'llm';
  available: boolean;
  unavailable_reason: string;
  caught: number;
  missed: number;
  n_a: number;
  error: number;
  applicable: number;
  detection_rate: number | null;
  coverage: number;
  false_positives: number;
  fp_denominator: number;
  fp_rate: number | null;
}

export interface OracleReport {
  generated_at: string;
  fixtures_total: number;
  fixtures_verified: number;
  fixtures_unverified: string[];
  gates: GateStats[];
  matrix: Record<string, Record<string, Verdict>>;
  details: Record<string, Record<string, string>>;
  false_positives: Record<string, { on: string; detail: string }[]>;
  ratchet: Record<string, { holds: boolean; detail: string }>;
  deterministic_catch_share: number | null;
  caught_by_any_deterministic: number;
  caught_by_nothing: string[];
}

function ratio(num: number, den: number): number | null {
  return den === 0 ? null : Math.round((num / den) * 1000) / 1000;
}

export function summarize(outcome: GateOutcome, total: number): GateStats {
  const counts: Record<Verdict, number> = { caught: 0, missed: 0, n_a: 0, error: 0 };
  for (const cell of Object.values(outcome.cells)) counts[cell.verdict]++;
  const applicable = counts.caught + counts.missed;
  return {
    gate: outcome.gate,
    family: outcome.family,
    available: outcome.available,
    unavailable_reason: outcome.unavailable_reason,
    caught: counts.caught,
    missed: counts.missed,
    n_a: counts.n_a,
    error: counts.error,
    applicable,
    detection_rate: ratio(counts.caught, applicable),
    coverage: ratio(applicable, total) ?? 0,
    false_positives: outcome.false_positives.length,
    fp_denominator: outcome.fp_denominator,
    fp_rate: ratio(outcome.false_positives.length, outcome.fp_denominator),
  };
}

export function buildReport(
  cases: FixtureCase[],
  outcomes: GateOutcome[],
  integrity: FixtureIntegrity[],
  ratchet: Record<string, { holds: boolean; detail: string }>,
): OracleReport {
  const total = cases.length;
  const gates = outcomes.map(o => summarize(o, total));

  const matrix: Record<string, Record<string, Verdict>> = {};
  const details: Record<string, Record<string, string>> = {};
  for (const c of cases) {
    matrix[c.bug.id] = {};
    details[c.bug.id] = {};
    for (const o of outcomes) {
      const cell = o.cells[c.bug.id];
      matrix[c.bug.id][o.gate] = cell?.verdict ?? 'error';
      details[c.bug.id][o.gate] = cell?.detail ?? 'no cell recorded';
    }
  }

  const deterministic = outcomes.filter(o => o.family === 'deterministic');
  const caughtByAnyDeterministic = cases.filter(c =>
    deterministic.some(o => o.cells[c.bug.id]?.verdict === 'caught'),
  );
  const caughtByNothing = cases
    .filter(c => outcomes.every(o => o.cells[c.bug.id]?.verdict !== 'caught'))
    .map(c => c.bug.id);

  const totalCatches = gates.reduce((s, g) => s + g.caught, 0);
  const deterministicCatches = gates.filter(g => g.family === 'deterministic').reduce((s, g) => s + g.caught, 0);

  const falsePositives: Record<string, { on: string; detail: string }[]> = {};
  for (const o of outcomes) falsePositives[o.gate] = o.false_positives;

  return {
    generated_at: new Date().toISOString(),
    fixtures_total: total,
    fixtures_verified: integrity.filter(i => i.ok).length,
    fixtures_unverified: integrity.filter(i => !i.ok).map(i => `${i.id}: ${i.detail}`),
    gates,
    matrix,
    details,
    false_positives: falsePositives,
    ratchet,
    deterministic_catch_share: ratio(deterministicCatches, totalCatches),
    caught_by_any_deterministic: caughtByAnyDeterministic.length,
    caught_by_nothing: caughtByNothing,
  };
}

export interface BaselineDiff {
  hasBaseline: boolean;
  regressions: string[];
  improvements: string[];
  newCases: string[];
  droppedCases: string[];
}

export function diffBaseline(report: OracleReport): BaselineDiff {
  if (!fs.existsSync(BASELINE_PATH)) {
    return { hasBaseline: false, regressions: [], improvements: [], newCases: [], droppedCases: [] };
  }
  const base = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8')) as OracleReport;

  const regressions: string[] = [];
  const improvements: string[] = [];

  for (const g of report.gates) {
    const prev = base.gates.find(p => p.gate === g.gate);
    if (!prev) continue;
    if (prev.detection_rate !== null && g.detection_rate !== null && g.detection_rate < prev.detection_rate) {
      regressions.push(`${g.gate}: detection ${prev.detection_rate} -> ${g.detection_rate}`);
    }
    if (prev.detection_rate !== null && g.detection_rate !== null && g.detection_rate > prev.detection_rate) {
      improvements.push(`${g.gate}: detection ${prev.detection_rate} -> ${g.detection_rate}`);
    }
    if (g.false_positives > prev.false_positives) {
      regressions.push(`${g.gate}: false positives ${prev.false_positives} -> ${g.false_positives}`);
    }
    if (g.error > prev.error) {
      regressions.push(`${g.gate}: gate errors ${prev.error} -> ${g.error}`);
    }
  }

  for (const [id, row] of Object.entries(report.matrix)) {
    const prevRow = base.matrix[id];
    if (!prevRow) continue;
    for (const [gate, verdict] of Object.entries(row)) {
      const prev = prevRow[gate];
      if (prev === 'caught' && verdict !== 'caught') regressions.push(`${id} / ${gate}: caught -> ${verdict}`);
      if (prev && prev !== 'caught' && verdict === 'caught') improvements.push(`${id} / ${gate}: ${prev} -> caught`);
    }
  }

  const newCases = Object.keys(report.matrix).filter(id => !base.matrix[id]);
  const droppedCases = Object.keys(base.matrix).filter(id => !report.matrix[id]);

  return { hasBaseline: true, regressions, improvements, newCases, droppedCases };
}

export function writeBaseline(report: OracleReport): void {
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(report, null, 2)}\n`);
}

const PAD = 16;

function pct(v: number | null): string {
  return v === null ? '  n/a' : `${String(Math.round(v * 100)).padStart(3)}%`;
}

export function render(report: OracleReport, diff: BaselineDiff): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(`ORACLE MEASUREMENT — ${report.fixtures_total} fixtures, all from bugs that really happened`);
  lines.push(`generated ${report.generated_at}`);
  lines.push('');

  if (report.fixtures_unverified.length > 0) {
    lines.push('!! FIXTURES THAT DO NOT DEMONSTRATE THEIR BUG — numbers below are not trustworthy:');
    for (const u of report.fixtures_unverified) lines.push(`   ${u}`);
    lines.push('');
  } else {
    lines.push(`fixture integrity: ${report.fixtures_verified}/${report.fixtures_total} verified red on buggy, green on fixed`);
    lines.push('');
  }

  lines.push(`${'gate'.padEnd(PAD)}${'family'.padEnd(15)}${'caught'.padEnd(8)}${'missed'.padEnd(8)}${'n/a'.padEnd(6)}${'err'.padEnd(6)}${'detect'.padEnd(8)}${'cover'.padEnd(8)}${'fp'.padEnd(8)}fp rate`);
  lines.push('-'.repeat(96));
  for (const g of report.gates) {
    lines.push(
      g.gate.padEnd(PAD) +
      g.family.padEnd(15) +
      String(g.caught).padEnd(8) +
      String(g.missed).padEnd(8) +
      String(g.n_a).padEnd(6) +
      String(g.error).padEnd(6) +
      pct(g.detection_rate).padEnd(8) +
      pct(g.coverage).padEnd(8) +
      `${g.false_positives}/${g.fp_denominator}`.padEnd(8) +
      pct(g.fp_rate),
    );
  }
  lines.push('');

  for (const g of report.gates) {
    if (!g.available) lines.push(`NOT MEASURED — ${g.gate}: ${g.unavailable_reason}`);
  }
  if (report.gates.some(g => !g.available)) lines.push('');

  lines.push('what these columns mean, so they are not over-read');
  lines.push('  detect   caught / (caught + missed). n/a means the gate was never applicable.');
  lines.push('  cover    how many of the 19 fixtures the gate can even be applied to.');
  lines.push('  fp rate  false positives over the calls where a false positive was possible.');
  lines.push('  red-test answers a different question from the other three: it asks whether the');
  lines.push('           test implied by the BUG REPORT goes red. Every fixture here is a bug that');
  lines.push('           was eventually found and written up, so this number is an upper bound on');
  lines.push('           B5 given a ticket, NOT a detection rate for unreported bugs.');
  lines.push('  guard fp measured against a probe set built to press on precision, not against');
  lines.push('           observed traffic. Real-world precision needs the gate log, not this file.');
  lines.push('');

  lines.push(`caught by at least one deterministic gate: ${report.caught_by_any_deterministic}/${report.fixtures_total}`);
  lines.push(`share of all catches coming from deterministic gates: ${pct(report.deterministic_catch_share)}   (P8 wants >= 20%)`);
  lines.push(`caught by nothing at all: ${report.caught_by_nothing.length}${report.caught_by_nothing.length ? ` — ${report.caught_by_nothing.join(', ')}` : ''}`);
  lines.push('');

  if (Object.keys(report.ratchet).length > 0) {
    lines.push('type ratchet (does the fix make tsc catch a recurrence?)');
    for (const [id, r] of Object.entries(report.ratchet)) {
      lines.push(`  ${r.holds ? 'HOLDS ' : 'LOOSE '} ${id.padEnd(28)} ${r.detail}`);
    }
    lines.push('');
  }

  const anyFp = Object.values(report.false_positives).some(v => v.length > 0);
  if (anyFp) {
    lines.push('false positives');
    for (const [gate, fps] of Object.entries(report.false_positives)) {
      for (const fp of fps) lines.push(`  ${gate.padEnd(12)} ${fp.on.padEnd(34)} ${fp.detail}`);
    }
    lines.push('');
  }

  if (!diff.hasBaseline) {
    lines.push('no baseline on disk — run with --write-baseline to freeze this run');
  } else {
    if (diff.regressions.length === 0 && diff.improvements.length === 0) {
      lines.push('baseline: no change');
    }
    for (const r of diff.regressions) lines.push(`REGRESSION  ${r}`);
    for (const i of diff.improvements) lines.push(`improved    ${i}`);
    for (const n of diff.newCases) lines.push(`new fixture ${n}`);
    for (const d of diff.droppedCases) lines.push(`DROPPED     ${d}`);
  }
  lines.push('');

  return lines.join('\n');
}

export function renderMatrix(report: OracleReport, cases: FixtureCase[]): string {
  const gates = report.gates.map(g => g.gate);
  const symbol: Record<Verdict, string> = { caught: 'CATCH', missed: 'miss ', n_a: '  -  ', error: 'ERR  ' };
  const lines: string[] = [];
  lines.push('');
  lines.push(`${'fixture'.padEnd(30)}${'class'.padEnd(14)}${gates.map(g => g.padEnd(12)).join('')}`);
  lines.push('-'.repeat(30 + 14 + gates.length * 12));
  for (const c of cases) {
    const row = gates.map(g => symbol[report.matrix[c.bug.id][g]].padEnd(12)).join('');
    lines.push(`${c.bug.id.padEnd(30)}${c.bug.category.padEnd(14)}${row}`);
  }
  lines.push('');
  return lines.join('\n');
}
