/**
 * Schema + routing-rule enforcement for the `/size-issue` task envelope.
 *
 * Source of truth: personal/docs/manager-layer-plan-2026-08-12.md §3.1 (shape)
 * and §7.1 (lane table + the four overrides). The manager imports
 * `validateEnvelope`; the skill runs this file as a CLI on its own output before
 * emitting.
 */

export type Size = 'S' | 'M' | 'L' | 'XL';
export type Uncertainty = 'low' | 'med' | 'high';
export type Lane = 'trivial' | 'bug-nho' | 'bug-lon' | 'feature';
export type SensitiveSurface = 'auth' | 'payment' | 'data-migration';
export type WorkKind = 'code' | 'investigate' | 'provision' | 'decide';

export const SIZES: readonly Size[] = ['S', 'M', 'L', 'XL'];
export const UNCERTAINTIES: readonly Uncertainty[] = ['low', 'med', 'high'];
export const LANES: readonly Lane[] = ['trivial', 'bug-nho', 'bug-lon', 'feature'];
export const SENSITIVE_SURFACES: readonly SensitiveSurface[] = ['auth', 'payment', 'data-migration'];
export const WORK_KINDS: readonly WorkKind[] = ['code', 'investigate', 'provision', 'decide'];

export interface TaskEnvelope {
  project: string;
  issue: string;
  title: string;
  size: Size;
  uncertainty: Uncertainty;
  lane: Lane;
  why: string;
  oracle_available: boolean;
  oracle_kind: string[];
  needs_human: boolean;
  blocking_questions: string[];
  assumptions: string[];
  assumption_count: number;
  est_cost_usd: number;
  est_turns: number;
  round_2_fail?: boolean;
  touches_sensitive?: SensitiveSurface[];
  kind?: WorkKind;
  in_scope?: boolean;
  defer_reason?: string;
}

/** Carries every problem found, not just the first — the caller fixes one envelope, not one field. */
export class EnvelopeError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`invalid task envelope (${problems.length} problem${problems.length === 1 ? '' : 's'}):\n  - ${problems.join('\n  - ')}`);
    this.name = 'EnvelopeError';
    this.problems = problems;
  }
}

const WHY_MAX_CHARS = 240;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const AUTONOMOUS_SHORT_LANES: readonly Lane[] = ['trivial', 'bug-nho'];
const AT_LEAST_BUG_LON: readonly Lane[] = ['bug-lon', 'feature'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkNonEmptyString(record: Record<string, unknown>, field: string, problems: string[]): void {
  const value = record[field];
  if (typeof value !== 'string') {
    problems.push(`${field}: expected a string, got ${describe(value)}`);
    return;
  }
  if (value.trim() === '') problems.push(`${field}: must not be empty`);
}

function checkEnum<T extends string>(
  record: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
  problems: string[],
): void {
  const value = record[field];
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    problems.push(`${field}: expected one of ${allowed.join(' | ')}, got ${describe(value)}`);
  }
}

function checkBoolean(record: Record<string, unknown>, field: string, problems: string[]): void {
  if (typeof record[field] !== 'boolean') {
    problems.push(`${field}: expected a boolean, got ${describe(record[field])}`);
  }
}

function checkStringArray(record: Record<string, unknown>, field: string, problems: string[]): void {
  const value = record[field];
  if (!Array.isArray(value)) {
    problems.push(`${field}: expected an array, got ${describe(value)}`);
    return;
  }
  value.forEach((entry, index) => {
    if (typeof entry !== 'string' || entry.trim() === '') {
      problems.push(`${field}[${index}]: expected a non-empty string, got ${describe(entry)}`);
    }
  });
}

function describe(value: unknown): string {
  if (value === undefined) return 'undefined (missing)';
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array(${value.length})`;
  return `${typeof value} ${JSON.stringify(value)}`;
}

function checkShape(record: Record<string, unknown>, problems: string[]): void {
  for (const field of ['project', 'issue', 'title']) checkNonEmptyString(record, field, problems);

  checkEnum(record, 'size', SIZES, problems);
  checkEnum(record, 'uncertainty', UNCERTAINTIES, problems);
  checkEnum(record, 'lane', LANES, problems);

  checkNonEmptyString(record, 'why', problems);
  if (typeof record.why === 'string') {
    if (record.why.includes('\n')) problems.push('why: must be one sentence on one line');
    if (record.why.length > WHY_MAX_CHARS) {
      problems.push(`why: must be one sentence (max ${WHY_MAX_CHARS} chars), got ${record.why.length}`);
    }
  }

  checkBoolean(record, 'oracle_available', problems);
  checkBoolean(record, 'needs_human', problems);

  checkStringArray(record, 'oracle_kind', problems);
  if (Array.isArray(record.oracle_kind)) {
    record.oracle_kind.forEach((kind, index) => {
      if (typeof kind === 'string' && kind.trim() !== '' && !KEBAB.test(kind)) {
        problems.push(`oracle_kind[${index}]: expected lowercase-kebab, got ${JSON.stringify(kind)}`);
      }
    });
  }

  checkStringArray(record, 'blocking_questions', problems);
  checkStringArray(record, 'assumptions', problems);

  if (!Number.isInteger(record.assumption_count) || (record.assumption_count as number) < 0) {
    problems.push(`assumption_count: expected an integer >= 0, got ${describe(record.assumption_count)}`);
  }
  if (typeof record.est_cost_usd !== 'number' || !Number.isFinite(record.est_cost_usd) || record.est_cost_usd < 0) {
    problems.push(`est_cost_usd: expected a finite number >= 0, got ${describe(record.est_cost_usd)}`);
  }
  if (!Number.isInteger(record.est_turns) || (record.est_turns as number) < 1) {
    problems.push(`est_turns: expected an integer >= 1, got ${describe(record.est_turns)}`);
  }

  if (record.round_2_fail !== undefined && typeof record.round_2_fail !== 'boolean') {
    problems.push(`round_2_fail: expected a boolean when present, got ${describe(record.round_2_fail)}`);
  }
  if (record.touches_sensitive !== undefined) {
    if (!Array.isArray(record.touches_sensitive)) {
      problems.push(`touches_sensitive: expected an array when present, got ${describe(record.touches_sensitive)}`);
    } else {
      record.touches_sensitive.forEach((surface, index) => {
        if (typeof surface !== 'string' || !SENSITIVE_SURFACES.includes(surface as SensitiveSurface)) {
          problems.push(
            `touches_sensitive[${index}]: expected one of ${SENSITIVE_SURFACES.join(' | ')}, got ${describe(surface)}`,
          );
        }
      });
    }
  }
  if (record.kind !== undefined && (typeof record.kind !== 'string' || !WORK_KINDS.includes(record.kind as WorkKind))) {
    problems.push(`kind: expected one of ${WORK_KINDS.join(' | ')} when present, got ${describe(record.kind)}`);
  }
  if (record.in_scope !== undefined && typeof record.in_scope !== 'boolean') {
    problems.push(`in_scope: expected a boolean when present, got ${describe(record.in_scope)}`);
  }
  if (record.defer_reason !== undefined && (typeof record.defer_reason !== 'string' || record.defer_reason.trim() === '')) {
    problems.push(`defer_reason: expected a non-empty string when present, got ${describe(record.defer_reason)}`);
  }
}

function checkConsistency(record: Record<string, unknown>, problems: string[]): void {
  const kinds = record.oracle_kind;
  if (typeof record.oracle_available === 'boolean' && Array.isArray(kinds)) {
    if (record.oracle_available && kinds.length === 0) {
      problems.push('oracle_available is true but oracle_kind is empty — name what runs, or set it false');
    }
    if (!record.oracle_available && kinds.length > 0) {
      problems.push(`oracle_available is false but oracle_kind lists ${JSON.stringify(kinds)} — §3.1 ties them together`);
    }
  }

  if (Array.isArray(record.assumptions) && Number.isInteger(record.assumption_count)) {
    if (record.assumptions.length !== record.assumption_count) {
      problems.push(
        `assumption_count is ${record.assumption_count} but assumptions holds ${record.assumptions.length} entries`,
      );
    }
  }
}

function checkOverrides(record: Record<string, unknown>, problems: string[]): void {
  const lane = record.lane as Lane;
  const needsHuman = record.needs_human;

  if (record.oracle_available === false && needsHuman !== true) {
    problems.push('override 1: oracle_available is false, so needs_human must be true — nothing can prove the work landed');
  }

  if (record.round_2_fail === true && lane !== 'bug-lon') {
    problems.push(`override 2: round_2_fail is true, so lane must be bug-lon regardless of size, got ${JSON.stringify(lane)}`);
  }

  const sensitive = record.touches_sensitive;
  if (Array.isArray(sensitive) && sensitive.length > 0 && !AT_LEAST_BUG_LON.includes(lane)) {
    problems.push(
      `override 3: touches ${sensitive.join(', ')}, so lane must be at least bug-lon, got ${JSON.stringify(lane)}`,
    );
  }

  if (Number.isInteger(record.assumption_count) && (record.assumption_count as number) > 2 && needsHuman !== true) {
    problems.push(
      `override 4: assumption_count is ${record.assumption_count} (> 2), so needs_human must be true`,
    );
  }

  if (record.in_scope === false) {
    if (needsHuman !== true) {
      problems.push('in_scope is false, so needs_human must be true — a parked item does not silently restart');
    }
    if (record.defer_reason === undefined) {
      problems.push('in_scope is false, so defer_reason must say why it was parked and what revives it');
    }
  }

  if (record.kind !== undefined && record.kind !== 'code' && needsHuman !== true) {
    problems.push(
      `kind is ${JSON.stringify(record.kind)}, so needs_human must be true — the lane describes the follow-up work, which nobody can pick until this finishes`,
    );
  }
}

function checkLaneFloor(record: Record<string, unknown>, problems: string[]): void {
  const lane = record.lane as Lane;
  const size = record.size as Size;
  const uncertainty = record.uncertainty as Uncertainty;

  if (!AUTONOMOUS_SHORT_LANES.includes(lane)) return;

  if (size !== 'S' || uncertainty !== 'low') {
    problems.push(
      `lane ${JSON.stringify(lane)} needs size S and uncertainty low (§7.1), got size ${JSON.stringify(size)} / uncertainty ${JSON.stringify(uncertainty)} — that is bug-lon`,
    );
  }
  if (lane === 'bug-nho' && record.oracle_available !== true) {
    problems.push('lane bug-nho requires oracle_available true (§7.1) — without one there is nothing to shorten the lane against');
  }
}

/** Throws `EnvelopeError` listing every problem; returns the input typed on success. */
export function validateEnvelope(input: unknown): TaskEnvelope {
  if (!isPlainObject(input)) {
    throw new EnvelopeError([`envelope: expected a JSON object, got ${describe(input)}`]);
  }

  const problems: string[] = [];
  checkShape(input, problems);
  if (problems.length > 0) throw new EnvelopeError(problems);

  checkConsistency(input, problems);
  checkOverrides(input, problems);
  checkLaneFloor(input, problems);
  if (problems.length > 0) throw new EnvelopeError(problems);

  return input as unknown as TaskEnvelope;
}

export function isTaskEnvelope(input: unknown): input is TaskEnvelope {
  try {
    validateEnvelope(input);
    return true;
  } catch {
    return false;
  }
}

/** Accepts a single envelope or an array of them, as the skill emits for a batch. */
export function validateEnvelopeJson(text: string): TaskEnvelope[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new EnvelopeError([`not valid JSON: ${(err as Error).message}`]);
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  if (items.length === 0) throw new EnvelopeError(['envelope: empty array, expected at least one envelope']);

  const problems: string[] = [];
  const valid: TaskEnvelope[] = [];
  items.forEach((item, index) => {
    try {
      valid.push(validateEnvelope(item));
    } catch (err) {
      const prefix = items.length > 1 ? `[${index}] ` : '';
      for (const problem of (err as EnvelopeError).problems) problems.push(prefix + problem);
    }
  });
  if (problems.length > 0) throw new EnvelopeError(problems);
  return valid;
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: bun run validate.ts <envelope.json>   (or "-" for stdin)');
    process.exit(2);
  }

  let text: string;
  try {
    text = path === '-' ? await Bun.stdin.text() : await Bun.file(path).text();
  } catch (err) {
    console.error(`cannot read ${path}: ${(err as Error).message}`);
    process.exit(2);
    return;
  }

  try {
    const envelopes = validateEnvelopeJson(text);
    for (const envelope of envelopes) {
      console.log(`OK  ${envelope.project}/${envelope.issue}  ${envelope.lane}  size=${envelope.size} uncertainty=${envelope.uncertainty} needs_human=${envelope.needs_human}`);
    }
    process.exit(0);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}

if (import.meta.main) await main();
