/**
 * Structured verdict returned by a spawned agent, plus the ensemble rule
 * (§7.3) that decides whether findings actually block.
 *
 * A single LLM gate never blocks. So one LLM gate raising an alarm is a WARN
 * that goes to the human; two different LLM gates naming the same finding, or
 * any deterministic failure, blocks. A caught red-test is a successful witness
 * that the test detects the baseSha bug, not a failure at task HEAD.
 *
 * The rule survived the 14/08 move of the review gates onto codex. The two
 * judges are still Claude (they need a browser codex cannot drive), so a pair
 * that cross-confirms can still be one family agreeing with itself, and one
 * gate is still one opinion however good the model behind it is.
 */

import { extractJsonBlock } from './envelope';
import { readGateLog, originOf, type GateLogEntry } from './gate-log';
import type { Finding } from '../types';

export type VerdictKind = 'pass' | 'fail' | 'blocked';

export interface GateReport {
  gate: string;
  gate_family: 'deterministic' | 'llm';
  verdict: 'pass' | 'caught' | 'false-positive' | 'skipped' | 'error';
  caught: string;
  /** Model family that produced an llm row, when the caller knew it. */
  family?: string;
}

export interface AgentVerdict {
  verdict: VerdictKind;
  reason: string;
  gates: GateReport[];
  findings: string[];
  assumptions: string[];
  questions: string[];
  /**
   * Steps the agent needs that cannot be undone: push, commit, deploy, merge,
   * data deletion, anything touching production. The agent is told to list
   * them and stop. Any entry here parks the task for a human (§10.1).
   */
  irreversible: string[];
  /**
   * Findings the gate itself judged as not touching correctness — the B4
   * triage lane in workflow.md. A reviewer prompted to find gaps always finds
   * gaps, so only correctness-touching findings come back as `caught`;
   * everything else lands here, reaches the report, and never blocks.
   */
  advisories: string[];
  /**
   * One sentence naming the proven root cause (B2). The CLAIM, never the
   * reasoning that produced it: it is the only thing spec-check is given about
   * the build, and spec-check's whole value is that it never sees the build.
   * Capped so a builder cannot smuggle its transcript through this field.
   */
  root_cause: string;
}

const MAX_ROOT_CAUSE_CHARS = 300;
const VERDICT_KINDS = new Set(['pass', 'fail', 'blocked']);

const DETERMINISTIC_GATES = new Set(['guard', 'lint', 'tsc', 'red-test', 'B8-assert']);

function normalizeGate(raw: unknown): GateReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const g = raw as Record<string, unknown>;
  const gate = typeof g.gate === 'string' && g.gate ? g.gate : null;
  if (!gate) return null;
  const family =
    g.gate_family === 'deterministic' || g.gate_family === 'llm'
      ? g.gate_family
      : DETERMINISTIC_GATES.has(gate)
        ? 'deterministic'
        : 'llm';
  const verdicts = ['pass', 'caught', 'false-positive', 'skipped', 'error'];
  const verdict = typeof g.verdict === 'string' && verdicts.includes(g.verdict) ? (g.verdict as GateReport['verdict']) : 'error';
  return { gate, gate_family: family, verdict, caught: typeof g.caught === 'string' ? g.caught : '' };
}

function stringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
}

/** Never throws. Unparseable output becomes a `fail` verdict with the reason said out loud. */
export function parseVerdict(output: string): AgentVerdict {
  const raw = extractJsonBlock(output);
  if (!raw || typeof raw !== 'object') {
    return {
      verdict: 'fail',
      reason: 'agent returned no parseable verdict block',
      gates: [],
      findings: [],
      assumptions: [],
      questions: [],
      irreversible: [],
      advisories: [],
      root_cause: '',
    };
  }
  const v = raw as Record<string, unknown>;
  const kind: VerdictKind =
    v.verdict === 'pass' || v.verdict === 'fail' || v.verdict === 'blocked' ? v.verdict : 'fail';
  const rootCause = typeof v.root_cause === 'string' ? v.root_cause.trim() : '';
  return {
    verdict: kind,
    reason: typeof v.reason === 'string' ? v.reason : '',
    gates: Array.isArray(v.gates) ? v.gates.map(normalizeGate).filter((g): g is GateReport => g !== null) : [],
    findings: stringList(v.findings),
    assumptions: stringList(v.assumptions),
    questions: stringList(v.questions),
    irreversible: stringList(v.irreversible),
    advisories: stringList(v.advisories),
    root_cause: rootCause.slice(0, MAX_ROOT_CAUSE_CHARS),
  };
}

/**
 * The newest thing the agent said that is verdict-SHAPED, not merely parseable.
 *
 * `parseVerdict` never fails — it normalizes anything into a `fail` — so "the
 * newest message that parses" would let a closing sentence that happens to
 * quote a JSON object outrank the real verdict two messages earlier.
 */
export function parseVerdictCandidates(candidates: readonly string[], fallback: string): AgentVerdict {
  for (const candidate of candidates) {
    const raw = extractJsonBlock(candidate);
    if (!raw || typeof raw !== 'object') continue;
    const kind = (raw as { verdict?: unknown }).verdict;
    if (typeof kind === 'string' && VERDICT_KINDS.has(kind)) return parseVerdict(candidate);
  }
  return parseVerdict(fallback);
}

/** Appended to `caught` on a demoted gate so the reason survives into the log. */
export const UNVERIFIED_MARK = 'unverified-self-report';

export interface GateEvidenceWindow {
  project: string;
  /** ISO timestamp the agent run started. */
  since: string;
  /** ISO timestamp the verdict was collected. */
  until: string;
}

function withinWindow(ts: unknown, window: GateEvidenceWindow): boolean {
  if (typeof ts !== 'string' || !ts) return false;
  if (!window.since || !window.until) return false;
  return ts >= window.since && ts <= window.until;
}

function demote(gate: GateReport): GateReport {
  return {
    ...gate,
    gate_family: 'llm',
    caught: gate.caught ? `${gate.caught} [${UNVERIFIED_MARK}]` : UNVERIFIED_MARK,
  };
}

/**
 * A `deterministic` claim is only worth the record that backs it.
 *
 * The gate list comes out of the agent's own JSON, so an agent can write
 * `{gate:"tsc", gate_family:"deterministic", verdict:"pass"}` without ever
 * running tsc — and the ensemble rule (§7.3) plus the P8 unlock condition
 * ("caught from deterministic >= 20%") would then both stand on a number the
 * thing being measured reported about itself.
 *
 * The hooks write `guard` / `lint` / `tsc` / `test` rows into the gate log from
 * inside the harness, on a path the agent cannot reach, and the manager writes
 * `B8-assert` itself after running the project's own command (assert-runner.ts).
 * So a claimed deterministic gate keeps its family only when the log holds a
 * deterministic row for the same project and gate, timestamped inside the run.
 * Everything else drops to `llm` with the reason recorded, which means a single
 * such gate warns instead of blocking.
 *
 * Only `origin: work` rows corroborate. A probe run aimed at the guard writes
 * real deterministic rows for the same project, and letting those vouch for an
 * agent's claim would reopen this hole from the other side.
 *
 * Manager-owned gates are removed from agent verdicts before this function is
 * called. Their rows come from the manager's own execution path.
 */
export function verifyDeterministicGates(
  gates: GateReport[],
  window: GateEvidenceWindow,
  readLog: (project?: string) => GateLogEntry[] = readGateLog,
): GateReport[] {
  if (!gates.some((g) => g.gate_family === 'deterministic')) return gates;
  let entries: GateLogEntry[] = [];
  try {
    const read = readLog(window.project);
    if (Array.isArray(read)) entries = read;
  } catch {
    entries = [];
  }
  const corroborated = new Set(
    entries
      .filter((e) => e.gate_family === 'deterministic' && originOf(e) === 'work' && withinWindow(e.ts, window))
      .map((e) => e.gate),
  );
  return gates.map((gate) =>
    gate.gate_family === 'deterministic' && !corroborated.has(gate.gate) ? demote(gate) : gate,
  );
}

export type EnsembleOutcome = 'block' | 'warn' | 'clear';

export interface EnsembleDecision {
  outcome: EnsembleOutcome;
  why: string;
  findings: Finding[];
  /**
   * False when no gate reported at all. "Nothing was caught" and "nothing was
   * checked" produce the same empty finding list, and reading the second as
   * the first is how an unmeasured task gets reported as a clean one.
   */
  measured: boolean;
  /**
   * Gates that reported without producing a judgement. `measured` cannot see
   * these — it counts ROWS, and a row saying "this gate never ran" satisfies it
   * exactly as well as a row saying "I looked and it is fine".
   */
  broken: string[];
  /** llm gates that actually returned a verdict. Zero means nothing was judged. */
  answered: number;
}

/**
 * What two agreeing gates are worth, which depends on whose agreement it is.
 *
 * An unrecorded family is reported as unrecorded. Collapsing it into "both the
 * same" would state independence backwards from no evidence at all, and rows
 * replayed from a task record written before families were logged arrive here
 * with none.
 */
function describeAgreement(families: Set<string>, names: string): string {
  if (families.has('unknown')) {
    return `two llm gates agree, family not recorded for at least one — independence unverified (§7.3): ${names}`;
  }
  if (families.size >= 2) return `two llm gates agree across families: ${names}`;
  return `two llm gates agree, both ${[...families][0]} — same family, so this is corroboration in name only (§7.3): ${names}`;
}

function normalizeFindingText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * `gates` may span several spawns (verify, review, judge). Findings are matched
 * across gates by normalized text; two DIFFERENT llm gates naming the same
 * thing is the cross-confirmation the rule asks for.
 */
export function applyEnsembleRule(gates: GateReport[]): EnsembleDecision {
  const findings: Finding[] = [];
  const deterministicFailures: GateReport[] = [];
  const llmByFinding = new Map<string, Map<string, string>>();
  const broken: string[] = [];
  let answered = 0;
  const measured = gates.length > 0;

  for (const gate of gates) {
    const redTestWitness = gate.gate === 'red-test' && gate.verdict === 'caught';
    const isAlarm = !redTestWitness && (gate.verdict === 'caught' || gate.verdict === 'error');
    if (gate.gate_family === 'llm' && gate.verdict !== 'error' && gate.verdict !== 'skipped') answered++;
    if (!isAlarm) continue;
    findings.push({ gate: gate.gate, gate_family: gate.gate_family, text: gate.caught || gate.verdict });
    if (gate.gate_family === 'deterministic') {
      deterministicFailures.push(gate);
      continue;
    }
    if (gate.verdict === 'error') {
      broken.push(gate.gate);
      continue;
    }
    const key = normalizeFindingText(gate.caught);
    if (!key) continue;
    const byGate = llmByFinding.get(key) ?? new Map<string, string>();
    byGate.set(gate.gate, gate.family ?? 'unknown');
    llmByFinding.set(key, byGate);
  }

  const base = { findings, measured, broken, answered };
  if (deterministicFailures.length > 0) {
    return {
      outcome: 'block',
      why: `deterministic gate failed: ${deterministicFailures.map((g) => g.gate).join(', ')}`,
      ...base,
    };
  }
  for (const [, byGate] of llmByFinding) {
    if (byGate.size < 2) continue;
    const names = [...byGate.keys()].join(' + ');
    const families = new Set(byGate.values());
    const why = describeAgreement(families, names);
    return { outcome: 'block', why, ...base };
  }
  if (findings.length > 0) {
    const alarms = findings.filter((f) => f.gate_family === 'llm').length;
    return {
      outcome: 'warn',
      why: `${alarms} llm gate${alarms === 1 ? '' : 's'} raised a finding without cross-confirmation; reported, not blocked`,
      ...base,
    };
  }
  if (!measured) {
    return { outcome: 'clear', why: 'no gate reported — this task was not checked, not proven clean', ...base };
  }
  return { outcome: 'clear', why: '', ...base };
}
