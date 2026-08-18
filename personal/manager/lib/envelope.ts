/**
 * Task envelope parsing, validation, and router overrides (§3.1, §7.1).
 *
 * A main agent answers in prose with a JSON block. The manager refuses to act
 * on anything it cannot validate: a missing field is a hard reject, not a
 * defaulted value, because a defaulted `oracle_available` silently routes work
 * into an autonomous lane that has nothing to check it.
 */

import type { Lane, OracleKind, TaskEnvelope, TaskSize, Uncertainty } from '../types';
import { LANES, UNVERIFIED_ORACLE_KINDS } from '../types';
import { projectEntry } from './paths';

const SIZES: readonly TaskSize[] = ['S', 'M', 'L', 'XL'];
const UNCERTAINTIES: readonly Uncertainty[] = ['low', 'med', 'high'];
const LANE_RANK: Record<Lane, number> = { trivial: 0, 'bug-nho': 1, 'bug-lon': 2, feature: 3 };
const UNKNOWN_ORACLE: OracleKind = 'unknown';
const UNRECOGNIZED_ORACLE: OracleKind = 'unrecognized';
const REAL_BROWSER_ORACLE: OracleKind = 'my-chrome';
const ASSERT_ORACLE_KINDS: ReadonlyArray<{ kind: OracleKind; shape: RegExp }> = [
  { kind: 'playwright', shape: /\bplaywright\b/i },
  { kind: 'jest', shape: /\bjest\b/i },
  { kind: 'tsc', shape: /\b(tsc|typecheck|type-check)\b/i },
  { kind: 'lint', shape: /\b(eslint|oxlint|lint)\b/i },
  { kind: 'bun-test', shape: /\bbun\s+(?:run\s+)?test(?:\s|:|$)/i },
  { kind: 'vitest', shape: /\bvitest\b/i },
  { kind: 'pytest', shape: /\bpytest\b/i },
];

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  envelope: TaskEnvelope | null;
  /** Human-readable list of router overrides that fired. */
  overrides: string[];
}

/**
 * Pull the last JSON object out of agent output. Prefers a fenced ```json
 * block; falls back to the last balanced brace span so a model that forgot the
 * fence still parses.
 */
export function extractJsonBlock(text: string): unknown | null {
  const fenced = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)];
  for (let i = fenced.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(fenced[i][1]);
    } catch {
      continue;
    }
  }
  const end = text.lastIndexOf('}');
  if (end === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = end; i >= 0; i--) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === '}') depth++;
    else if (ch === '{') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(i, end + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

export function validateEnvelope(raw: unknown): ValidationResult {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['envelope is not a JSON object'], envelope: null, overrides: [] };
  }
  const e = raw as Record<string, unknown>;

  const requireString = (key: string): string => {
    const v = e[key];
    if (typeof v !== 'string' || v.trim() === '') {
      errors.push(`${key}: required non-empty string`);
      return '';
    }
    return v;
  };
  const requireBool = (key: string): boolean => {
    const v = e[key];
    if (typeof v !== 'boolean') {
      errors.push(`${key}: required boolean`);
      return false;
    }
    return v;
  };
  const requireNumber = (key: string): number => {
    const v = e[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      errors.push(`${key}: required number`);
      return 0;
    }
    return v;
  };
  const requireStringArray = (key: string): string[] => {
    const v = e[key];
    if (!isStringArray(v)) {
      errors.push(`${key}: required array of strings`);
      return [];
    }
    return v;
  };

  const project = requireString('project');
  const issue = requireString('issue');
  const title = requireString('title');
  const why = requireString('why');

  const size = e.size as TaskSize;
  if (!SIZES.includes(size)) errors.push(`size: must be one of ${SIZES.join('|')}`);
  const uncertainty = e.uncertainty as Uncertainty;
  if (!UNCERTAINTIES.includes(uncertainty)) errors.push(`uncertainty: must be one of ${UNCERTAINTIES.join('|')}`);
  const lane = e.lane as Lane;
  if (!LANES.includes(lane)) errors.push(`lane: must be one of ${LANES.join('|')}`);

  const oracleAvailable = requireBool('oracle_available');
  const oracleKind = requireStringArray('oracle_kind') as OracleKind[];
  const needsHuman = requireBool('needs_human');
  const blockingQuestions = requireStringArray('blocking_questions');
  const assumptions = requireStringArray('assumptions');
  const assumptionCount = requireNumber('assumption_count');
  const estCost = requireNumber('est_cost_usd');
  const estTurns = requireNumber('est_turns');
  const touchesSensitive = e.touches_sensitive;
  if (
    touchesSensitive !== undefined &&
    touchesSensitive !== null &&
    (typeof touchesSensitive !== 'string' || touchesSensitive.trim() === '')
  ) {
    errors.push('touches_sensitive: must be a non-empty string or null');
  }

  if (errors.length > 0) return { ok: false, errors, envelope: null, overrides: [] };

  const envelope: TaskEnvelope = {
    project,
    issue,
    title,
    size,
    uncertainty,
    lane,
    why,
    touches_sensitive: typeof touchesSensitive === 'string' ? touchesSensitive : null,
    oracle_available: oracleAvailable,
    oracle_kind: oracleKind,
    needs_human: needsHuman,
    blocking_questions: blockingQuestions,
    assumptions: assumptions,
    assumption_count: assumptionCount,
    est_cost_usd: estCost,
    est_turns: estTurns,
  };
  return { ok: true, errors: [], envelope, overrides: [] };
}

export interface OverrideContext {
  /** QC bounced this bug once already (§7.1 override 2). */
  roundTwoFail?: boolean;
}

function registryOracleKinds(project: string): OracleKind[] {
  const entry = projectEntry(project);
  if (!entry) return [UNKNOWN_ORACLE];
  if (entry.oracle_kind !== undefined) return entry.oracle_kind as OracleKind[];
  if (!entry.assert || entry.assert.length === 0) return [UNKNOWN_ORACLE];

  const kinds = entry.assert.flatMap((spec) => {
    const command = typeof spec === 'string' ? spec : spec.cmd;
    const matches = ASSERT_ORACLE_KINDS.filter(({ shape }) => shape.test(command)).map(({ kind }) => kind);
    return matches.length > 0 ? matches : [UNRECOGNIZED_ORACLE];
  });
  return [...new Set(kinds)];
}

/**
 * Apply router overrides. Returns a NEW envelope; the original is
 * kept intact so the report can show what the agent proposed versus what the
 * manager enforced.
 */
export function applyRouterOverrides(input: TaskEnvelope, ctx: OverrideContext = {}): {
  envelope: TaskEnvelope;
  overrides: string[];
} {
  const out: TaskEnvelope = { ...input, oracle_kind: [...input.oracle_kind] };
  const overrides: string[] = [];

  const fromRegistry = registryOracleKinds(input.project);
  const browserOracle = input.oracle_kind.includes(REAL_BROWSER_ORACLE) ? [REAL_BROWSER_ORACLE] : [];
  const reconciledKinds = [...new Set([...fromRegistry, ...browserOracle])];
  if (JSON.stringify(input.oracle_kind) !== JSON.stringify(reconciledKinds)) {
    overrides.push(
      `oracle_kind ${JSON.stringify(input.oracle_kind)} -> ${JSON.stringify(reconciledKinds)} (registry ${JSON.stringify(fromRegistry)}, agent my-chrome ${browserOracle.length > 0 ? 'kept' : 'absent'})`,
    );
  }
  out.oracle_kind = reconciledKinds;
  const verifiedKinds = reconciledKinds.filter((kind) => !UNVERIFIED_ORACLE_KINDS.includes(kind));
  if (verifiedKinds.length > 0) {
    if (!out.oracle_available) {
      out.oracle_available = true;
      overrides.push(`verified oracles ${JSON.stringify(verifiedKinds)} -> oracle_available=true`);
    }
  } else if (reconciledKinds.length === 0) {
    if (out.oracle_available) {
      out.oracle_available = false;
      overrides.push('oracle_kind empty -> oracle_available=false');
    }
  } else {
    overrides.push(
      `oracle_kind ${JSON.stringify(reconciledKinds)} verifies no oracle — oracle_available=${out.oracle_available} stays the agent's unchecked claim`,
    );
  }
  if (!out.oracle_available && !out.needs_human) {
    out.needs_human = true;
    overrides.push('oracle_available=false -> needs_human=true');
  }
  if (ctx.roundTwoFail && LANE_RANK[out.lane] < LANE_RANK['bug-lon']) {
    out.lane = 'bug-lon';
    overrides.push('round-2-fail -> lane=bug-lon');
  }
  if (out.touches_sensitive && LANE_RANK[out.lane] < LANE_RANK['bug-lon']) {
    out.lane = 'bug-lon';
    overrides.push(`touches_sensitive=${out.touches_sensitive} -> lane=bug-lon`);
  }
  if (out.assumption_count > 2 && !out.needs_human) {
    out.needs_human = true;
    overrides.push('assumption_count>2 -> needs_human=true');
  }
  return { envelope: out, overrides };
}

/** Parse + validate + override in one call. */
export function parseEnvelope(text: string, ctx: OverrideContext = {}): ValidationResult {
  const raw = extractJsonBlock(text);
  if (raw === null) {
    return { ok: false, errors: ['no JSON object found in agent output'], envelope: null, overrides: [] };
  }
  const validated = validateEnvelope(raw);
  if (!validated.ok || !validated.envelope) return validated;
  const { envelope, overrides } = applyRouterOverrides(validated.envelope, ctx);
  return { ok: true, errors: [], envelope, overrides };
}
