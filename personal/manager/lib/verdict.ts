/**
 * Structured verdict returned by a spawned agent, plus the ensemble rule
 * (§7.3) that decides whether findings actually block.
 *
 * A single LLM gate never blocks. The three strongest gates (spec-check,
 * reviewer, design-judge) are all LLM gates and, with codex off this machine,
 * all Claude — independent in context but not in failure mode. So one LLM
 * gate raising an alarm is a WARN that goes to the human; two different LLM
 * gates naming the same finding, or any deterministic gate failing, blocks.
 */

import { extractJsonBlock } from './envelope';
import { readGateLog, type GateLogEntry } from './gate-log';
import type { Finding } from '../types';

export type VerdictKind = 'pass' | 'fail' | 'blocked';

export interface GateReport {
  gate: string;
  gate_family: 'deterministic' | 'llm';
  verdict: 'pass' | 'caught' | 'false-positive' | 'skipped' | 'error';
  caught: string;
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
 * `red-test` still has no witness outside the agent: nothing but the agent
 * knows which of a suite's tests is the one written before the fix, so a
 * claimed `red-test` always demotes. Closing that needs the failing output
 * captured before the fix (§8 P6), which is not built yet.
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
      .filter((e) => e.gate_family === 'deterministic' && withinWindow(e.ts, window))
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
  const llmByFinding = new Map<string, Set<string>>();
  const measured = gates.length > 0;

  for (const gate of gates) {
    const isAlarm = gate.verdict === 'caught' || gate.verdict === 'error';
    if (!isAlarm) continue;
    findings.push({ gate: gate.gate, gate_family: gate.gate_family, text: gate.caught || gate.verdict });
    if (gate.gate_family === 'deterministic') {
      deterministicFailures.push(gate);
      continue;
    }
    const key = normalizeFindingText(gate.caught);
    if (!key) continue;
    const set = llmByFinding.get(key) ?? new Set<string>();
    set.add(gate.gate);
    llmByFinding.set(key, set);
  }

  if (deterministicFailures.length > 0) {
    return {
      outcome: 'block',
      why: `deterministic gate failed: ${deterministicFailures.map((g) => g.gate).join(', ')}`,
      findings,
      measured,
    };
  }
  for (const [, gateNames] of llmByFinding) {
    if (gateNames.size >= 2) {
      return { outcome: 'block', why: `two llm gates agree: ${[...gateNames].join(' + ')}`, findings, measured };
    }
  }
  if (findings.length > 0) {
    return { outcome: 'warn', why: 'single llm gate raised a finding; reported, not blocked', findings, measured };
  }
  if (!measured) {
    return { outcome: 'clear', why: 'no gate reported — this task was not checked, not proven clean', findings, measured };
  }
  return { outcome: 'clear', why: '', findings, measured };
}
