/**
 * Gate log — append-only record of what every quality gate caught, per project.
 *
 * Schema is the data contract in `personal/docs/manager-layer-plan-2026-08-12.md` §3.3.
 * A wrong `verdict` / `gate_family` / `review_depth` throws instead of writing garbage:
 * every later number (detection rate, ensemble balance §7.3, the P8 unlock condition)
 * is read back off these lines, so a bad write silently corrupts all of them.
 *
 * The log is append-only, including corrections. `false-positive` is a verdict only a
 * human can hand out — a gate cannot know it fired on nothing — so `reclassify` appends
 * a correction record pointing at the original line instead of editing it. The whole
 * value of the book is that it is evidence, and a line edited in place leaves no trace
 * of who changed what, when. `readGateLog` applies corrections; `readGateLogRaw` shows
 * what the gate actually said at the time.
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

export type GateFamily = 'deterministic' | 'llm';
export type Verdict = 'pass' | 'caught' | 'false-positive' | 'skipped' | 'error';
export type ReviewDepth = 'summary' | 'full-diff';

/**
 * `work` — the gate fired while doing real work. `gate-test` — the gate fired
 * because something was deliberately probing it.
 *
 * Both are true positives, so marking a probe `false-positive` would be a lie and
 * would drag precision down for the wrong reason. But probe lines still must not
 * reach the §7.3 family split or the P8 unlock threshold: those numbers are meant
 * to say what the gates catch in the field, and a probe run can inflate `caught`
 * to any number you like. So provenance is a separate axis from verdict.
 */
export type GateOrigin = 'work' | 'gate-test';

/** Read-time only: what a later correction record did to this line. */
export interface Reclassification {
  ts: string;
  from: Verdict;
  note?: string;
}

export interface GateLogEntry {
  ts: string;
  project: string;
  issue?: string;
  lane?: string;
  gate: string;
  gate_family: GateFamily;
  verdict: Verdict;
  attempt?: number;
  cost_usd?: number;
  caught?: string;
  /**
   * Which model produced an llm row, and which family it belongs to.
   *
   * Recorded per row because §7.3's independence claim is otherwise unfalsifiable
   * after the fact: a task reviewed on `opus-fresh` and one reviewed on `codex`
   * leave identical logs, and the only statement of which ran is a line the
   * daemon printed to a log nobody reopens.
   */
  model?: string;
  model_family?: string;
  review_depth?: ReviewDepth;
  human_intervened?: boolean;
  origin?: GateOrigin;
  ref?: string;
  reclassified?: Reclassification;
}

/**
 * Points at one written line. `ref` is derived from the line's own content
 * (see `entryRef`), so the lines already on disk — written before corrections
 * existed — are addressable without a migration or a rewrite.
 */
export interface GateLogRef {
  project: string;
  ref: string;
  ts?: string;
  gate?: string;
}

/** The correction itself, appended below the line it corrects. */
export interface GateLogCorrection {
  ts: string;
  project: string;
  gate: string;
  verdict: Verdict;
  reclassifies: string;
  reclassifies_ts?: string;
  note?: string;
}

export const GATE_FAMILIES: readonly GateFamily[] = ['deterministic', 'llm'];
export const VERDICTS: readonly Verdict[] = ['pass', 'caught', 'false-positive', 'skipped', 'error'];
export const REVIEW_DEPTHS: readonly ReviewDepth[] = ['summary', 'full-diff'];
export const GATE_ORIGINS: readonly GateOrigin[] = ['work', 'gate-test'];

/**
 * Set by whatever is probing a gate; every writer below it inherits it through
 * the environment, which is what makes hooks carry it without knowing they do.
 * A probe harness sets it once and every guard/lint/tsc line the probed run
 * produces is stamped, including lines written by shell hooks it never sees.
 */
export const ORIGIN_ENV = 'GSTACK_GATE_LOG_ORIGIN';
export const DEFAULT_ORIGIN: GateOrigin = 'work';

/**
 * §3.3 taxonomy plus `test` — the Stop hook runs a project's own suite, which is
 * neither `red-test` (written before the fix) nor `B8-assert` (the verify lane).
 */
export const KNOWN_GATES: readonly string[] = [
  'guard',
  'lint',
  'tsc',
  'test',
  'red-test',
  'B8-assert',
  'B8-judge',
  'design-judge',
  'spec-check',
  'tech-review',
  'impact-review',
  'codex-review',
];

export const BLIND_SAMPLE_RATE = 1 / 5;

const MAX_LOG_BYTES = 10 * 1024 * 1024;
const MAX_LOG_GENERATIONS = 5;
const MAX_CAUGHT_CHARS = 500;

/**
 * `GSTACK_GATE_LOG_DIR` overrides the whole directory (tests, sandboxes);
 * `GSTACK_HOME` follows gstack's own convention. Read at call time so a test
 * can point it somewhere else between cases.
 */
export function gateLogDir(): string {
  const explicit = process.env.GSTACK_GATE_LOG_DIR;
  if (explicit && explicit.trim()) return explicit;
  const home = process.env.GSTACK_HOME?.trim() || path.join(os.homedir(), '.gstack');
  return path.join(home, 'gate-log');
}

/** Lowercased so the same repo lands in one file on both Windows and macOS. */
function projectSlug(project: unknown): string {
  if (typeof project !== 'string') throw new Error('gate-log: project must be a string');
  const slug = project
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[.\-]+|[.\-]+$/g, '');
  if (!slug) throw new Error(`gate-log: project has no usable characters: ${JSON.stringify(project)}`);
  return slug;
}

export function gateLogPath(project: string): string {
  return path.join(gateLogDir(), `${projectSlug(project)}.jsonl`);
}

export function isKnownGate(gate: string): boolean {
  return KNOWN_GATES.includes(gate);
}

function requireOneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`gate-log: ${field} must be one of ${allowed.join(' | ')} — got ${JSON.stringify(value)}`);
  }
  return value as T;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`gate-log: ${field} must be a string — got ${JSON.stringify(value)}`);
  return value;
}

function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new Error(`gate-log: ${field} must be a finite number — got ${JSON.stringify(value)}`);
  }
  return n;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`gate-log: ${field} must be a boolean — got ${JSON.stringify(value)}`);
}

/**
 * Explicit argument wins, then the environment, then `work`.
 *
 * A misspelt `GSTACK_GATE_LOG_ORIGIN` throws rather than quietly falling back to
 * `work`. Falling back would stamp probe lines as real work, which is precisely
 * the contamination this field exists to stop, and it would do it silently — the
 * one failure shape this book must never have. `logGate` catches the throw and
 * reports it, so a bad value is loud without taking a running task down.
 */
function resolveOrigin(value: unknown): GateOrigin {
  if (value !== undefined && value !== null && value !== '') {
    return requireOneOf(value, GATE_ORIGINS, 'origin');
  }
  const fromEnv = process.env[ORIGIN_ENV]?.trim();
  if (!fromEnv) return DEFAULT_ORIGIN;
  return requireOneOf(fromEnv, GATE_ORIGINS, ORIGIN_ENV);
}

/** Key order follows the §3.3 example so a raw log line reads like the spec. */
export function validateGateLogEntry(input: Omit<GateLogEntry, 'ts'> & { ts?: string }): GateLogEntry {
  const gate = optionalString(input.gate, 'gate');
  if (!gate) throw new Error('gate-log: gate is required');

  const caught = optionalString(input.caught, 'caught');
  const reviewDepth =
    input.review_depth === undefined || input.review_depth === null || String(input.review_depth) === ''
      ? undefined
      : requireOneOf(input.review_depth, REVIEW_DEPTHS, 'review_depth');

  const entry: GateLogEntry = {
    ts: optionalString(input.ts, 'ts') ?? new Date().toISOString(),
    project: projectSlug(input.project),
    issue: optionalString(input.issue, 'issue'),
    lane: optionalString(input.lane, 'lane'),
    gate,
    gate_family: requireOneOf(input.gate_family, GATE_FAMILIES, 'gate_family'),
    verdict: requireOneOf(input.verdict, VERDICTS, 'verdict'),
    attempt: optionalNumber(input.attempt, 'attempt'),
    cost_usd: optionalNumber(input.cost_usd, 'cost_usd'),
    caught: caught && caught.length > MAX_CAUGHT_CHARS ? `${caught.slice(0, MAX_CAUGHT_CHARS)}…` : caught,
    model: optionalString(input.model, 'model'),
    model_family: optionalString(input.model_family, 'model_family'),
    review_depth: reviewDepth,
    human_intervened: optionalBoolean(input.human_intervened, 'human_intervened'),
    origin: resolveOrigin(input.origin),
  };

  for (const key of Object.keys(entry) as (keyof GateLogEntry)[]) {
    if (entry[key] === undefined) delete entry[key];
  }
  return entry;
}

function rotateIfNeeded(file: string): void {
  try {
    if (fs.statSync(file).size < MAX_LOG_BYTES) return;
  } catch {
    return;
  }
  for (let i = MAX_LOG_GENERATIONS - 1; i >= 1; i--) {
    try {
      if (fs.existsSync(`${file}.${i}`)) fs.renameSync(`${file}.${i}`, `${file}.${i + 1}`);
    } catch {}
  }
  try {
    fs.renameSync(file, `${file}.1`);
  } catch {}
}

/**
 * One complete `\n`-terminated line per `appendFileSync` call, so parallel agents
 * appending to the same project file never interleave a half-written record.
 */
export function appendGateLog(input: Omit<GateLogEntry, 'ts'> & { ts?: string }): void {
  const entry = validateGateLogEntry(input);
  const file = gateLogPath(entry.project);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  rotateIfNeeded(file);
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
}

interface ParsedLog {
  entries: GateLogEntry[];
  corrections: GateLogCorrection[];
}

function parseLines(raw: string): ParsedLog {
  const entries: GateLogEntry[] = [];
  const corrections: GateLogCorrection[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    const candidate = parsed as Partial<GateLogEntry & GateLogCorrection>;
    if (typeof candidate.ts !== 'string') continue;

    if (candidate.reclassifies !== undefined) {
      if (typeof candidate.reclassifies !== 'string' || !candidate.reclassifies) continue;
      if (typeof candidate.project !== 'string' || typeof candidate.gate !== 'string') continue;
      if (!VERDICTS.includes(candidate.verdict as Verdict)) continue;
      corrections.push(candidate as GateLogCorrection);
      continue;
    }

    if (typeof candidate.gate !== 'string') continue;
    entries.push(candidate as GateLogEntry);
  }
  return { entries, corrections };
}

const REF_LENGTH = 12;

/**
 * Content-addressed identity. The old lines carry no id and never will — the log
 * is append-only — so identity is derived from the bytes that were written, which
 * makes every line ever logged addressable, including the five the guard wrote
 * before any of this existed. Read-time fields are excluded so the ref of a
 * corrected entry still resolves to the line it came from.
 */
export function entryRef(entry: GateLogEntry): string {
  const canonical = Object.keys(entry)
    .filter((key) => key !== 'ref' && key !== 'reclassified')
    .sort()
    .map((key) => [key, (entry as Record<string, unknown>)[key]]);
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, REF_LENGTH);
}

/** Prefers the ref carried by a read entry, so a corrected line still points home. */
export function refOf(entry: GateLogEntry): GateLogRef {
  return { project: entry.project, ref: entry.ref ?? entryRef(entry), ts: entry.ts, gate: entry.gate };
}

function withRefs(entries: GateLogEntry[]): GateLogEntry[] {
  return entries.map((entry) => ({ ...entry, ref: entryRef(entry) }));
}

function applyCorrections(parsed: ParsedLog): GateLogEntry[] {
  const entries = withRefs(parsed.entries);
  const byRef = new Map<string, GateLogEntry[]>();
  for (const entry of entries) {
    const bucket = byRef.get(entry.ref!);
    if (bucket) bucket.push(entry);
    else byRef.set(entry.ref!, [entry]);
  }
  for (const correction of parsed.corrections) {
    for (const target of byRef.get(correction.reclassifies) ?? []) {
      const from = target.reclassified?.from ?? target.verdict;
      target.reclassified = correction.note
        ? { ts: correction.ts, from, note: correction.note }
        : { ts: correction.ts, from };
      target.verdict = correction.verdict;
    }
  }
  return entries;
}

function readParsed(project?: string): ParsedLog[] {
  if (project) {
    try {
      return [parseLines(fs.readFileSync(gateLogPath(project), 'utf8'))];
    } catch {
      return [];
    }
  }

  const dir = gateLogDir();
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return [];
  }
  const out: ParsedLog[] = [];
  for (const f of files.sort()) {
    try {
      out.push(parseLines(fs.readFileSync(path.join(dir, f), 'utf8')));
    } catch {}
  }
  return out;
}

function byTimestamp(a: GateLogEntry, b: GateLogEntry): number {
  return a.ts.localeCompare(b.ts);
}

/**
 * The path everything reads through, so every number downstream counts a
 * corrected line as corrected. Reads the live `.jsonl` only — rotated
 * generations are history, not working data. Unparseable lines are skipped: a
 * torn line must never take down the reader.
 */
export function readGateLog(project?: string): GateLogEntry[] {
  const entries = readParsed(project).flatMap(applyCorrections);
  return project ? entries : entries.sort(byTimestamp);
}

/**
 * What the gates actually said, corrections not applied — the audit view. Correction
 * records are not observations and are not returned here; `readGateLogCorrections`
 * has them.
 */
export function readGateLogRaw(project?: string): GateLogEntry[] {
  const entries = readParsed(project).flatMap((log) => withRefs(log.entries));
  return project ? entries : entries.sort(byTimestamp);
}

export function readGateLogCorrections(project?: string): GateLogCorrection[] {
  const corrections = readParsed(project).flatMap((log) => log.corrections);
  return project ? corrections : corrections.sort((a, b) => a.ts.localeCompare(b.ts));
}

/**
 * Appends a correction for one already-written line. Throws when nothing matches:
 * a correction that silently lands on no line is worse than an error, because the
 * number it was supposed to fix stays wrong and looks measured.
 */
export function reclassify(target: GateLogRef, verdict: Verdict, note: string): void {
  const wanted = requireOneOf(verdict, VERDICTS, 'verdict');
  if (!target || typeof target.ref !== 'string' || !target.ref.trim()) {
    throw new Error('gate-log: reclassify needs a ref for the line being corrected');
  }
  const project = projectSlug(target.project);
  const ref = target.ref.trim();

  const [parsed] = readParsed(project);
  const match = parsed?.entries.find((entry) => entryRef(entry) === ref);
  if (!match) throw new Error(`gate-log: no entry in ${project} matches ref ${ref}`);

  const trimmed = typeof note === 'string' ? note.trim() : '';
  const record: GateLogCorrection = {
    ts: new Date().toISOString(),
    project,
    gate: match.gate,
    verdict: wanted,
    reclassifies: ref,
    reclassifies_ts: match.ts,
    ...(trimmed ? { note: trimmed.length > MAX_CAUGHT_CHARS ? `${trimmed.slice(0, MAX_CAUGHT_CHARS)}…` : trimmed } : {}),
  };

  const file = gateLogPath(project);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  rotateIfNeeded(file);
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
}

/**
 * Lines written before this field existed carry no `origin`. §3.3 makes `work`
 * the default, so that is how they read — but `isUnstamped` keeps them countable
 * separately, because a number that silently mixes measured provenance with
 * assumed provenance is the kind of number this book exists to stop.
 */
export function originOf(entry: GateLogEntry): GateOrigin {
  return entry.origin ?? DEFAULT_ORIGIN;
}

export function isUnstamped(entry: GateLogEntry): boolean {
  return entry.origin === undefined;
}

/**
 * The one implementation of "§7.3 and P8 only count `origin: work`". Callers
 * filter through this rather than writing the predicate themselves, so the rule
 * cannot drift apart across the CLI, the manager, and whatever reads next.
 */
export function workOnly(entries: GateLogEntry[]): GateLogEntry[] {
  return entries.filter((entry) => originOf(entry) === 'work');
}

export interface GatePrecision {
  gate: string;
  caught: number;
  false_positive: number;
  precision: number | null;
}

/**
 * `caught / (caught + false-positive)` per gate — the number the P8 unlock
 * condition reads. `null`, never 1, when a gate raised nothing: a gate that has
 * not fired has no precision, and printing 100% for it would invent a measurement.
 */
export function precisionByGate(entries: GateLogEntry[]): GatePrecision[] {
  const byGate = new Map<string, GatePrecision>();
  for (const entry of entries) {
    if (typeof entry?.gate !== 'string') continue;
    const row = byGate.get(entry.gate) ?? { gate: entry.gate, caught: 0, false_positive: 0, precision: null };
    if (entry.verdict === 'caught') row.caught++;
    if (entry.verdict === 'false-positive') row.false_positive++;
    byGate.set(entry.gate, row);
  }
  for (const row of byGate.values()) {
    const decided = row.caught + row.false_positive;
    row.precision = decided === 0 ? null : row.caught / decided;
  }
  return [...byGate.values()].sort((a, b) => b.caught + b.false_positive - (a.caught + a.false_positive));
}

/**
 * Blind-sample lottery (§3.2): 1 task in 5 gets read as a full diff, drawn AFTER
 * the task closes so nobody can pay extra attention to a task they know is watched.
 */
export function shouldBlindSample(rng: () => number = Math.random): boolean {
  const roll = rng();
  return typeof roll === 'number' && Number.isFinite(roll) && roll < BLIND_SAMPLE_RATE;
}
