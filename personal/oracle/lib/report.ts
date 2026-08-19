/**
 * Turns gate outcomes into the numbers P6 exists to produce, and diffs them
 * against a frozen baseline so a drop in oracle quality is visible.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ORACLE_DIR, type CorpusFingerprint, type FixtureCase } from './cases';
import type { GateOutcome, Verdict, FixtureIntegrity } from './gates';
import { backendFamily } from './llm-backends';

export const BASELINE_PATH = path.join(ORACLE_DIR, 'baseline.json');

export interface GateStats {
  gate: string;
  family: 'deterministic' | 'llm';
  gate_backend: string;
  judge_backend: string;
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
  fp_errors: number;
  fp_denominator: number;
  fp_rate: number | null;
}

export interface OracleReport {
  generated_at: string;
  /** Which fixtures these numbers were measured on. Absent in baselines frozen before the pin existed. */
  corpus?: CorpusFingerprint;
  fixtures_total: number;
  fixtures_verified: number;
  fixtures_unverified: string[];
  gates: GateStats[];
  matrix: Record<string, Record<string, Verdict>>;
  details: Record<string, Record<string, string>>;
  false_positives: Record<string, { on: string; detail: string }[]>;
  fp_errors: Record<string, { on: string; detail: string }[]>;
  ratchet: Record<string, { holds: boolean; detail: string }>;
  deterministic_catch_share: number | null;
  caught_by_any_deterministic: number;
  caught_by_nothing: string[];
  llm_gate_backends_share_family: boolean;
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
    gate_backend: outcome.gate_backend,
    judge_backend: outcome.judge_backend,
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
    fp_errors: outcome.fp_errors.length,
    fp_denominator: outcome.fp_denominator,
    fp_rate: ratio(outcome.false_positives.length, outcome.fp_denominator),
  };
}

export function buildReport(
  cases: FixtureCase[],
  outcomes: GateOutcome[],
  integrity: FixtureIntegrity[],
  ratchet: Record<string, { holds: boolean; detail: string }>,
  corpus: CorpusFingerprint,
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
  const fpErrors: Record<string, { on: string; detail: string }[]> = {};
  for (const o of outcomes) fpErrors[o.gate] = o.fp_errors;

  const llmGateFamilies = gates
    .filter(g => g.family === 'llm' && g.gate_backend)
    .map(g => backendFamily(g.gate_backend));

  return {
    generated_at: new Date().toISOString(),
    corpus,
    fixtures_total: total,
    fixtures_verified: integrity.filter(i => i.ok).length,
    fixtures_unverified: integrity.filter(i => !i.ok).map(i => `${i.id}: ${i.detail}`),
    gates,
    matrix,
    details,
    false_positives: falsePositives,
    fp_errors: fpErrors,
    ratchet,
    deterministic_catch_share: ratio(deterministicCatches, totalCatches),
    caught_by_any_deterministic: caughtByAnyDeterministic.length,
    caught_by_nothing: caughtByNothing,
    llm_gate_backends_share_family: llmGateFamilies.length >= 2
      && llmGateFamilies.every(family => family !== undefined && family === llmGateFamilies[0]),
  };
}

export type MetricName = 'detection' | 'false positives';

interface Harm {
  rateRiseIsWorse: boolean;
  worseSays: string;
  /**
   * What counts as worse once the denominator has grown, where rate and count
   * disagree. Catches are an absolute good, so losing one is unambiguous while a
   * falling rate can come purely from newly-judged fixtures. Wrong blocks only
   * mean anything per opportunity, so widening the probe set raises the count
   * proportionally and only the rate says whether the gate got worse.
   */
  worseOverWiderGround: (was: ScoredMetric, now: ScoredMetric) => boolean;
}

const HARM: Record<MetricName, Harm> = {
  detection: {
    rateRiseIsWorse: false,
    worseSays: 'fewer bugs caught',
    worseOverWiderGround: (was, now) => now.numerator < was.numerator,
  },
  'false positives': {
    rateRiseIsWorse: true,
    worseSays: 'a worse false positive rate',
    worseOverWiderGround: (was, now) => now.rate > was.rate,
  },
};

interface ScoredMetric {
  gate: string;
  metric: MetricName;
  numerator: number;
  denominator: number;
  rate: number;
  errors: number;
  fixtures: number;
}

export interface DiffContext {
  /**
   * Gates the operator deliberately switched off for this run. Only a switch the
   * operator actually threw belongs here — never a gate's own `unavailable_reason`,
   * and never a backend that merely failed, since neither is a choice (§7.3b
   * lesson 2). The caller must sample it before any fixture code has run, because
   * fixtures execute in this process and can reach the environment. Empty means
   * strict, so a caller that forgets gets more alarms, not fewer.
   */
  operatorDisabledGates: string[];
  operatorReason: string;
}

const STRICT: DiffContext = { operatorDisabledGates: [], operatorReason: '' };

export interface BaselineDiff {
  hasBaseline: boolean;
  /** Fields on either side that contradict each other. Nothing is compared when this is non-empty. */
  corruption: string[];
  /**
   * The fixtures moved, or one side does not say which fixtures it used. Numbers
   * measured on different exams are not comparable, so nothing else is compared
   * and the run cannot pass. An absent pin counts as a mismatch: not knowing the
   * ground is not the same as standing on the same ground.
   */
  corpusChanged: string[];
  /** Per-gate backend pairs that changed, making only that gate's numbers incomparable. */
  instrumentChanged: string[];
  regressions: string[];
  /** The measured set shrank without the operator asking for it. An alarm, not an advisory. */
  lostMeasurements: string[];
  improvements: string[];
  /** An existing metric is now scored over more fixtures, so its old and new numbers have different ground. */
  firstMeasurements: string[];
  /** A metric produced a number that the baseline has never frozen, leaving this and later runs incomparable. */
  unfrozenMeasurements: string[];
  /**
   * A gate that scored nothing at all, that the operator switched off, and that
   * reports itself unavailable. All three are required: a gate cannot excuse
   * itself, and naming a gate the operator did not actually switch off cannot
   * excuse it either. Anything short of all three is a loss.
   */
  acknowledgedAbsences: string[];
  /** Baseline numbers frozen from a run that was itself partly broken. */
  baselineCaveats: string[];
  newCases: string[];
  droppedCases: string[];
}

function emptyDiff(hasBaseline: boolean): BaselineDiff {
  return {
    hasBaseline,
    corruption: [], corpusChanged: [], instrumentChanged: [], regressions: [], lostMeasurements: [], improvements: [],
    firstMeasurements: [], unfrozenMeasurements: [], acknowledgedAbsences: [], baselineCaveats: [],
    newCases: [], droppedCases: [],
  };
}

/**
 * Why this run must not be frozen as the baseline. A baseline is the yardstick
 * every later run is judged against, so freezing a run with a gate that scored
 * nothing retires that gate's ratchet silently: the next healthy run reads as a
 * first measurement rather than a recovery.
 */
export function unfitToFreeze(
  report: OracleReport,
  context: DiffContext = STRICT,
  baseline: OracleReport | null = readBaseline(),
): string[] {
  const reasons = inconsistencies(report, 'this run');
  const baselineScoredGates = new Set(
    baseline?.gates
      .filter(g => g.detection_rate !== null || g.fp_rate !== null)
      .map(g => g.gate) ?? [],
  );
  const currentGates = new Set(report.gates.map(g => g.gate));
  if (!report.corpus) {
    reasons.push('this run does not record which fixtures it measured, so freezing it would pin numbers to a corpus nobody can name');
  }
  for (const unverified of report.fixtures_unverified) {
    reasons.push(`a fixture does not demonstrate its bug: ${unverified}`);
  }
  for (const g of report.gates) {
    if (!g.available && g.family === 'deterministic') {
      reasons.push(`${g.gate} could not run: ${g.unavailable_reason}`);
      continue;
    }
    const scoredNothing = g.detection_rate === null && g.fp_rate === null;
    const switchedOff = context.operatorDisabledGates.includes(g.gate) && g.available === false;
    if (scoredNothing && (!switchedOff || baselineScoredGates.has(g.gate))) {
      reasons.push(`${g.gate} scored nothing at all (${g.error}/${report.fixtures_total} fixtures errored)`);
    }
  }
  for (const gate of baselineScoredGates) {
    if (!currentGates.has(gate)) {
      reasons.push(`${gate} is absent from this run even though the current baseline scores it`);
    }
  }
  if (!baseline) {
    const families = new Set(report.gates.map(g => g.family));
    for (const family of families) {
      const familyScored = report.gates.some(
        g => g.family === family && (g.detection_rate !== null || g.fp_rate !== null),
      );
      if (!familyScored) reasons.push(`the ${family} gate family scored nothing at all`);
    }
  }
  return reasons;
}

/**
 * Exit code this diff earns, so `run.ts` and the tests read the same rule from
 * one place instead of a copy that can drift.
 */
export function exitCodeFor(diff: BaselineDiff): number {
  if (diff.corruption.length > 0 || diff.corpusChanged.length > 0 || diff.instrumentChanged.length > 0) return 1;
  if (diff.regressions.length > 0 || diff.lostMeasurements.length > 0) return 2;
  if (diff.unfrozenMeasurements.length > 0) return 3;
  return 0;
}

function metricText(m: ScoredMetric): string {
  return `${m.numerator}/${m.denominator} (${m.rate})`;
}

function incompleteSuffix(m: ScoredMetric): string {
  return m.errors > 0 ? ` — INCOMPLETE, ${m.errors}/${m.fixtures} fixtures errored` : '';
}

/**
 * Cross-checks the counts, rates, coverage, matrix and corpus count against each
 * other, since `summarize` derives them together and they cannot disagree in a
 * real run. One edited number contradicts its neighbours. It does NOT check the
 * matrix verdicts against the counts, so a forgery that flips cells without
 * touching the totals passes, and it does not constrain `available`,
 * `unavailable_reason`, `family` (which drives the P8 share) or the ratchet
 * block. The corpus digest is checked separately, against the fixtures on disk.
 */
function inconsistencies(report: OracleReport, side: string): string[] {
  const found: string[] = [];
  const declared = report.gates.map(g => g.gate);
  const names = new Set(declared);
  if (names.size !== declared.length) found.push(`${side}: the same gate is recorded twice in gates[]`);

  if (report.fixtures_total > 0 && report.gates.length > 0 && Object.keys(report.matrix).length === 0) {
    found.push(`${side}: ${report.gates.length} gates over ${report.fixtures_total} fixtures, but no per-fixture scores at all`);
  }

  const scoredInMatrix = new Set<string>();
  for (const row of Object.values(report.matrix)) for (const gate of Object.keys(row)) scoredInMatrix.add(gate);
  if (scoredInMatrix.size > 0) {
    for (const gate of scoredInMatrix) {
      if (!names.has(gate)) found.push(`${side}: every fixture scores "${gate}" but gates[] has no record of it`);
    }
    for (const gate of names) {
      if (!scoredInMatrix.has(gate)) found.push(`${side}: gates[] records "${gate}" but no fixture scores it`);
    }
  }

  for (const g of report.gates) {
    const where = `${side}: gate "${g.gate}"`;
    if (typeof g.fp_errors !== 'number') {
      found.push(`${where} has no fp_errors count; this file predates fixed-side error accounting and must be re-frozen`);
    }
    if (g.applicable !== g.caught + g.missed) {
      found.push(`${where} says applicable ${g.applicable} but caught ${g.caught} + missed ${g.missed} is ${g.caught + g.missed}`);
    }
    if (g.detection_rate !== ratio(g.caught, g.applicable)) {
      found.push(`${where} says detection ${g.detection_rate} but ${g.caught}/${g.applicable} is ${ratio(g.caught, g.applicable)}`);
    }
    if (g.fp_rate !== ratio(g.false_positives, g.fp_denominator)) {
      found.push(`${where} says false positive rate ${g.fp_rate} but ${g.false_positives}/${g.fp_denominator} is ${ratio(g.false_positives, g.fp_denominator)}`);
    }
    if (g.coverage !== (ratio(g.applicable, report.fixtures_total) ?? 0)) {
      found.push(`${where} says coverage ${g.coverage} but ${g.applicable}/${report.fixtures_total} is ${ratio(g.applicable, report.fixtures_total) ?? 0}`);
    }
    const cells = g.caught + g.missed + g.n_a + g.error;
    if (report.fixtures_total > 0 && cells !== report.fixtures_total) {
      found.push(`${where} accounts for ${cells} fixtures, not ${report.fixtures_total}`);
    }
  }

  if (report.corpus && report.corpus.fixtures !== report.fixtures_total) {
    found.push(`${side}: the corpus pin counts ${report.corpus.fixtures} fixtures but the run scored ${report.fixtures_total}`);
  }
  return found;
}

/**
 * Recomputed from the per-gate catches rather than read from the stored field,
 * so editing `deterministic_catch_share` in the baseline changes nothing.
 */
function deterministicCatchShare(report: OracleReport): number | null {
  const all = report.gates.reduce((sum, g) => sum + g.caught, 0);
  const deterministic = report.gates
    .filter(g => g.family === 'deterministic')
    .reduce((sum, g) => sum + g.caught, 0);
  return ratio(deterministic, all);
}

function scoredMetrics(report: OracleReport): Map<string, ScoredMetric> {
  const scored = new Map<string, ScoredMetric>();
  for (const g of report.gates) {
    const shared = { gate: g.gate, errors: g.error, fixtures: report.fixtures_total };
    if (g.detection_rate !== null) {
      scored.set(`${g.gate}/detection`, {
        ...shared, metric: 'detection', numerator: g.caught, denominator: g.applicable, rate: g.detection_rate,
      });
    }
    if (g.fp_rate !== null) {
      scored.set(`${g.gate}/false positives`, {
        ...shared, metric: 'false positives', numerator: g.false_positives, denominator: g.fp_denominator, rate: g.fp_rate,
      });
    }
  }
  return scored;
}

function compareOverSameGround(diff: BaselineDiff, was: ScoredMetric, now: ScoredMetric): void {
  if (now.rate === was.rate) return;
  const move = `${now.gate}: ${now.metric} ${metricText(was)} -> ${metricText(now)}`;
  const worse = HARM[now.metric].rateRiseIsWorse ? now.rate > was.rate : now.rate < was.rate;
  if (worse) diff.regressions.push(move);
  else diff.improvements.push(move);
}

function compareOverWiderGround(diff: BaselineDiff, was: ScoredMetric, now: ScoredMetric): void {
  const harm = HARM[now.metric];
  const move = `${metricText(was)} -> ${metricText(now)}`;
  if (harm.worseOverWiderGround(was, now)) {
    diff.regressions.push(`${now.gate}: ${now.metric} ${move} — ${harm.worseSays}, on ground that only got wider`);
    return;
  }
  diff.firstMeasurements.push(
    `${now.gate}: ${now.metric} denominator ${was.denominator} -> ${now.denominator} — ${move}${incompleteSuffix(now)}`,
  );
}

function noteShrink(
  diff: BaselineDiff,
  context: DiffContext,
  was: ScoredMetric,
  now: ScoredMetric | undefined,
  nowGate: GateStats | undefined,
): void {
  const shrank = now
    ? `${was.gate}: ${was.metric} denominator ${was.denominator} -> ${now.denominator} — ${metricText(was)} -> ${metricText(now)}`
    : `${was.gate}: ${was.metric} is no longer scored at all — the baseline had ${metricText(was)}`;
  const switchedOff = now === undefined
    && context.operatorDisabledGates.includes(was.gate)
    && nowGate?.available === false;
  if (switchedOff) diff.acknowledgedAbsences.push(`${shrank} — ${context.operatorReason}`);
  else diff.lostMeasurements.push(shrank);
}

function compareRatchets(diff: BaselineDiff, report: OracleReport, base: OracleReport): void {
  for (const [id, was] of Object.entries(base.ratchet)) {
    const now = report.ratchet[id];
    if (!now) {
      diff.lostMeasurements.push(`${id}: the type ratchet is no longer checked — the baseline checked it`);
    } else if (was.holds && !now.holds) {
      diff.regressions.push(`${id}: type ratchet HOLDS -> LOOSE — ${now.detail}`);
    } else if (!was.holds && now.holds) {
      diff.improvements.push(`${id}: type ratchet LOOSE -> HOLDS`);
    }
  }
  for (const id of Object.keys(report.ratchet)) {
    if (!base.ratchet[id]) diff.firstMeasurements.push(`${id}: type ratchet checked for the first time`);
  }
}

function fixtureIds(report: OracleReport): string[] {
  return Object.keys(report.matrix).sort();
}

function corpusMismatch(report: OracleReport, base: OracleReport): string[] {
  if (!base.corpus) {
    return ['the baseline does not record which fixtures it measured, so nothing can be compared against it — re-freeze with --write-baseline'];
  }
  if (!report.corpus) {
    return ['this run does not record which fixtures it measured, so nothing can be compared'];
  }
  if (base.corpus.digest === report.corpus.digest) return [];

  const before = new Set(fixtureIds(base));
  const after = new Set(fixtureIds(report));
  const added = [...after].filter(id => !before.has(id));
  const removed = [...before].filter(id => !after.has(id));
  const moved = added.length === 0 && removed.length === 0
    ? 'same fixture names, changed contents'
    : [added.length ? `added ${added.join(', ')}` : '', removed.length ? `removed ${removed.join(', ')}` : '']
      .filter(Boolean).join('; ');
  return [
    `the fixture corpus changed since the baseline was frozen — baseline ${base.corpus.fixtures} fixtures (${base.corpus.digest}), this run ${report.corpus.fixtures} (${report.corpus.digest}): ${moved}. Numbers measured on different fixtures are not comparable; re-freeze with --write-baseline.`,
  ];
}

export function diffAgainstBaseline(
  report: OracleReport,
  base: OracleReport,
  context: DiffContext = STRICT,
): BaselineDiff {
  const diff = emptyDiff(true);
  diff.corruption = [...inconsistencies(base, 'baseline'), ...inconsistencies(report, 'this run')];
  if (diff.corruption.length > 0) return diff;

  diff.corpusChanged = corpusMismatch(report, base);
  if (diff.corpusChanged.length > 0) return diff;

  const before = scoredMetrics(base);
  const after = scoredMetrics(report);
  const nowGates = new Map(report.gates.map(g => [g.gate, g]));
  const changedInstruments = new Set<string>();

  for (const was of base.gates) {
    if (was.family !== 'llm') continue;
    const now = nowGates.get(was.gate);
    const baselineMeasured = was.detection_rate !== null || was.fp_rate !== null;
    if (!baselineMeasured) continue;
    const baselineHasProvenance = Boolean(was.gate_backend) && Boolean(was.judge_backend);
    if (!baselineHasProvenance) {
      diff.baselineCaveats.push(
        `${was.gate}: this baseline does not record which gate/judge backends produced its numbers, so one silent backend change cannot be detected for this gate; metrics remain comparable`,
      );
      continue;
    }
    if (!now || !now.gate_backend || !now.judge_backend) continue;
    if (was.gate_backend !== now.gate_backend || was.judge_backend !== now.judge_backend) {
      changedInstruments.add(was.gate);
      diff.instrumentChanged.push(
        `${was.gate}: backend pair ${was.gate_backend}/${was.judge_backend} -> ${now.gate_backend}/${now.judge_backend}; numbers from different instruments are not comparable — re-freeze with --write-baseline`,
      );
    }
  }

  for (const [key, was] of before) {
    if (changedInstruments.has(was.gate)) continue;
    const now = after.get(key);
    const nowGate = nowGates.get(was.gate);
    if (!now) noteShrink(diff, context, was, undefined, nowGate);
    else if (now.denominator < was.denominator) noteShrink(diff, context, was, now, nowGate);
    else if (now.denominator > was.denominator) compareOverWiderGround(diff, was, now);
    else compareOverSameGround(diff, was, now);
  }

  for (const [key, now] of after) {
    if (changedInstruments.has(now.gate)) continue;
    if (before.has(key)) continue;
    const paid = nowGates.get(now.gate)?.family === 'llm';
    const command = `${paid ? 'ORACLE_LLM=1 ' : ''}bun personal/oracle/run.ts --write-baseline`;
    diff.unfrozenMeasurements.push(
      `${now.gate}: ${now.metric} first produced a number — ${metricText(now)}${incompleteSuffix(now)}. `
      + `The baseline holds no number for this metric, so the next${paid ? ' paid' : ''} run cannot be compared `
      + `with it: even 0/${now.denominator} would print UNFROZEN again. `
      + `Freeze it now, in the run that measured it — ${command}`,
    );
  }

  for (const g of base.gates) {
    const switchedOff = context.operatorDisabledGates.includes(g.gate) && g.available === false;
    if (g.error > 0 && !switchedOff) {
      const scored = g.detection_rate !== null || g.fp_rate !== null;
      const what = scored ? 'froze this gate' : 'recorded no number for this gate';
      diff.baselineCaveats.push(`${g.gate}: the baseline ${what} from a run where ${g.error}/${base.fixtures_total} fixtures errored`);
    }
    if (g.fp_errors > 0) {
      diff.baselineCaveats.push(`${g.gate}: the baseline froze false-positive measurements from a run where ${g.fp_errors} fixed-side calls errored`);
    }
  }

  const sameMetrics = changedInstruments.size === 0 && before.size === after.size && [...before.keys()].every(k => after.has(k));
  const wasShare = deterministicCatchShare(base);
  const nowShare = deterministicCatchShare(report);
  if (sameMetrics && wasShare !== null && nowShare !== null && nowShare !== wasShare) {
    const move = `deterministic share of all catches ${wasShare} -> ${nowShare}`;
    if (nowShare < wasShare) diff.regressions.push(`${move} (P8 wants >= 0.2)`);
    else diff.improvements.push(move);
  }

  compareRatchets(diff, report, base);

  const chosenOff = new Set(context.operatorDisabledGates);
  for (const [id, row] of Object.entries(report.matrix)) {
    const prevRow = base.matrix[id];
    if (!prevRow) continue;
    for (const [gate, verdict] of Object.entries(row)) {
      const was = prevRow[gate];
      if (!was || chosenOff.has(gate) || changedInstruments.has(gate)) continue;
      if (was === 'caught' && verdict !== 'caught') diff.regressions.push(`${id} / ${gate}: caught -> ${verdict}`);
      if (was === 'missed' && verdict === 'caught') diff.improvements.push(`${id} / ${gate}: missed -> caught`);
    }
  }

  diff.newCases = Object.keys(report.matrix).filter(id => !base.matrix[id]);
  diff.droppedCases = Object.keys(base.matrix).filter(id => !report.matrix[id]);

  return diff;
}

export function diffBaseline(report: OracleReport, context: DiffContext = STRICT): BaselineDiff {
  const base = readBaseline();
  if (!base) return emptyDiff(false);
  return diffAgainstBaseline(report, base, context);
}

function readBaseline(): OracleReport | null {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8')) as OracleReport;
}

/**
 * Freeze this run as the yardstick.
 *
 * A symlink at the destination is refused rather than followed: the baseline is
 * the one file whose contents are the operator's own decision, and writing
 * through a link would hand that decision to whoever placed the link.
 */
export function writeBaseline(report: OracleReport, dest: string = BASELINE_PATH): void {
  let stat: fs.Stats | null = null;
  try {
    stat = fs.lstatSync(dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  if (stat?.isSymbolicLink()) {
    throw new Error(`writeBaseline: ${dest} is a symbolic link — refusing to write`);
  }
  fs.writeFileSync(dest, `${JSON.stringify(report, null, 2)}\n`);
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
  lines.push(report.corpus
    ? `corpus: ${report.corpus.fixtures} fixtures, ${report.corpus.digest}`
    : 'corpus: NOT RECORDED — this run does not say which fixtures produced these numbers');
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

  const llmBackends = report.gates.filter(g => g.family === 'llm' && g.gate_backend && g.judge_backend);
  if (llmBackends.length > 0) {
    lines.push('backend provenance');
    for (const g of llmBackends) lines.push(`  ${g.gate.padEnd(PAD)} gate=${g.gate_backend} judge=${g.judge_backend}`);
    if (report.llm_gate_backends_share_family) {
      lines.push('WARNING — both LLM gates run on the same gate-backend family, so their agreement is');
    lines.push('        one opinion counted twice, not a cross-check. Principle 3: a different model does');
    lines.push('        not substitute for independent context, and independent context does not substitute');
    lines.push('        for an independent failure mode.');
    }
    lines.push('');
  }

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

  const anyFpErrors = Object.values(report.fp_errors).some(v => v.length > 0);
  if (anyFpErrors) {
    lines.push('false-positive measurement errors');
    for (const [gate, errors] of Object.entries(report.fp_errors)) {
      for (const error of errors) lines.push(`  ${gate.padEnd(12)} ${error.on.padEnd(34)} ${error.detail}`);
    }
    lines.push('');
  }

  if (!diff.hasBaseline) {
    lines.push('no baseline on disk — run with --write-baseline to freeze this run');
  } else {
    const said = diff.corruption.length + diff.corpusChanged.length + diff.instrumentChanged.length + diff.regressions.length + diff.lostMeasurements.length
      + diff.improvements.length + diff.unfrozenMeasurements.length + diff.firstMeasurements.length + diff.acknowledgedAbsences.length
      + diff.baselineCaveats.length + diff.newCases.length + diff.droppedCases.length;
    if (said === 0) lines.push('baseline: no change');
    for (const c of diff.corruption) lines.push(`CORRUPT     ${c}`);
    for (const c of diff.corpusChanged) lines.push(`CORPUS      ${c}`);
    for (const c of diff.instrumentChanged) lines.push(`INSTRUMENT  ${c}`);
    for (const l of diff.lostMeasurements) lines.push(`LOST        ${l}`);
    for (const r of diff.regressions) lines.push(`REGRESSION  ${r}`);
    for (const i of diff.improvements) lines.push(`improved    ${i}`);
    for (const u of diff.unfrozenMeasurements) lines.push(`UNFROZEN    ${u}`);
    for (const f of diff.firstMeasurements) lines.push(`MEASURED    ${f}`);
    for (const a of diff.acknowledgedAbsences) lines.push(`not run     ${a}`);
    for (const b of diff.baselineCaveats) lines.push(`caveat      ${b}`);
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
