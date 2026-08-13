/**
 * The closing chain — what happens AFTER the subagent says it is done.
 *
 * This is workflow.md A8 and B9 turned into steps that actually run. The
 * chain per lane is §7.2:
 *
 *   trivial   hook
 *   bug-nho   hook -> red test -> B8-assert
 *   bug-lon   hook -> red test -> B8-assert -> B8-judge -> spec-check -> reviewer
 *   feature   hook -> acceptance test -> B8-assert + design-verify -> spec-check
 *             -> tech+impact -> reviewer
 *
 * Two of those steps are already recorded by the time this file runs. The hook
 * gates are written into the gate log by the harness itself while the agent
 * works, so they are READ here rather than re-run — that is the whole reason
 * they count as independent evidence. The red test is the agent's own work
 * inside RUNNING; the manager cannot witness which test is the red one, and
 * says so rather than pretending.
 *
 * Everything else runs here, and every gate that runs writes exactly one row
 * into the gate log with the family it actually has. Before this file existed
 * `gate_family: "llm"` had almost no writer, so `gate-log stats` reported 100%
 * deterministic — a denominator of zero wearing the costume of a good score.
 *
 * Two rules shape the code more than anything else:
 *
 *   One gate, one spawn. The ensemble rule (§7.3) blocks when two DIFFERENT
 *   llm gates name the same finding. Two gates emitted from one context are
 *   one opinion with two labels, and cross-confirming them would manufacture
 *   exactly the agreement the rule is trying to require.
 *
 *   Deterministic gates decide flow; llm gates decide reporting. A single llm
 *   gate never blocks and never triggers a retry — it warns, and the human
 *   sees it. Only B8-assert and the hooks move a task backwards.
 */

import { loadConfig, READ_ONLY_DISALLOWED, READ_ONLY_TOOLS } from '../config';
import type { AgentRole, Lane, TaskEnvelope } from '../types';
import { runAssertGate, type AssertGateResult, type ExecFn } from './assert-runner';
import { readDiff, type DiffResult } from './git';
import { logGate, readEntries } from './gate-log-port';
import {
  designJudgePrompt,
  impactReviewPrompt,
  judgePrompt,
  specCheckPrompt,
  techReviewPrompt,
  type SpecCheckInput,
} from './prompts';
import { parseVerdict, type AgentVerdict, type GateReport } from './verdict';

export type ChainGate = 'B8-assert' | 'B8-judge' | 'design-judge' | 'spec-check' | 'tech-review' | 'impact-review';

/** Gates run in the VERIFYING phase. */
export const VERIFY_CHAIN: Record<Lane, ChainGate[]> = {
  trivial: [],
  'bug-nho': ['B8-assert'],
  'bug-lon': ['B8-assert', 'B8-judge'],
  feature: ['B8-assert', 'design-judge'],
};

/** Gates run in the REVIEW phase. */
export const REVIEW_CHAIN: Record<Lane, ChainGate[]> = {
  trivial: [],
  'bug-nho': [],
  'bug-lon': ['spec-check', 'tech-review'],
  feature: ['spec-check', 'tech-review', 'impact-review'],
};

/** The only gates that need the single real Chrome (§6.3, §7.4). */
export const BROWSER_GATES: readonly ChainGate[] = ['B8-judge', 'design-judge'];

/**
 * Gates the manager runs itself. An agent claiming one of these in its own
 * verdict is claiming a result it did not produce, so the claim is dropped
 * rather than logged — the whole reason these moved out of the agent's JSON
 * (§7.3b lesson 2) was that a self-reported gate is testimony, not evidence.
 */
export const MANAGER_OWNED_GATES: readonly string[] = [
  'B8-assert',
  'B8-judge',
  'design-judge',
  'spec-check',
  'tech-review',
  'impact-review',
];

export function needsBrowserToken(gates: readonly ChainGate[]): boolean {
  return gates.some((gate) => BROWSER_GATES.includes(gate));
}

/** Which spawned role runs a gate. Drives model routing and the turn budget. */
export function roleForGate(gate: ChainGate): AgentRole {
  return gate === 'B8-judge' || gate === 'design-judge' ? 'judge' : 'review';
}

export interface GateSpawnRequest {
  gate: ChainGate;
  role: AgentRole;
  prompt: string;
  /** True for every gate here; report-only tools are not negotiable. */
  readOnly: boolean;
}

export interface GateSpawnResult {
  output: string;
  costUsd: number;
}

export type GateSpawn = (req: GateSpawnRequest) => Promise<GateSpawnResult>;

export interface ChainGateRun {
  gate: ChainGate;
  /** One per gate for llm gates; one per COMMAND for B8-assert. */
  reports: GateReport[];
  /** Present for llm gates: the full parsed verdict, for questions/irreversible. */
  verdict: AgentVerdict | null;
  /** Present for B8-assert. */
  assert: AssertGateResult | null;
  costUsd: number;
}

export interface ChainRun {
  runs: ChainGateRun[];
  reports: GateReport[];
  advisories: string[];
  /** Report lines carrying the numbers: which command ran, how many tests. */
  lines: string[];
  /**
   * VERIFYING only. False when nothing proved the change works — either the
   * assert failed or no oracle ran at all.
   */
  proven: boolean;
  /**
   * VERIFYING only. True when the assert gate could not run: no command
   * registered, a suite that ran zero tests, a timeout. A retry has no new
   * evidence to offer, so the caller must block instead of looping.
   */
  oracleFault: boolean;
  /**
   * VERIFYING only. Commands the plan resolved but no human has approved. A
   * different kind of oracle fault from the rest: nothing is broken, the
   * manager is waiting to be told it may run this.
   */
  assertPending: string[];
}

export interface ChainContext {
  project: string;
  issue: string;
  scope: string;
  envelope: TaskEnvelope;
  attempt: number;
  reviewDepth: 'summary' | 'full-diff';
  /** One sentence, from the builder's verdict. Empty for feature work. */
  rootCause: string;
  spawn: GateSpawn;
  /** Swapped in tests so no real command runs. */
  exec?: ExecFn;
  assertTimeoutMs?: number;
  diff?: (scope: string) => DiffResult;
  /** True when the task's oracle includes the real logged-in browser. */
  hasRealBrowser?: boolean;
}

/**
 * §7.2 step one. The hook rows were written by `pre-tool-use-guard.sh` and
 * `stop-full-check.sh` during RUNNING, from inside the harness on a path the
 * agent cannot reach. Reading them here is what puts the hook step of the
 * chain into the ensemble instead of leaving it as a line in a diagram.
 */
export const HOOK_GATES: readonly string[] = ['guard', 'lint', 'tsc', 'test'];

/**
 * Which hook rows are allowed to block.
 *
 * `lint` / `tsc` / `test` come from the Stop hook and mean the change itself
 * failed a check, which is exactly what a deterministic gate is for. `guard`
 * is left out: it fires whenever a write outside scope is refused, and the
 * usual sequence is that the agent adapts and carries on. Blocking a finished
 * task because the guard did its job once mid-run would make the guard's own
 * success look like a failure.
 *
 * Known limit, worth saying out loud: hook rows carry a project but no task
 * id, so a row written by the operator's own session in the same repo inside
 * the same window is indistinguishable from this task's. The project lock
 * keeps two MANAGER tasks apart; it cannot keep a human out.
 */
export const BLOCKING_HOOK_GATES: readonly string[] = ['lint', 'tsc', 'test'];

export interface HookWindow {
  project: string;
  since: string;
  until: string;
  /**
   * Rows from an earlier attempt are history, not evidence about this one. A
   * row that carries no attempt (the hooks write none) is kept: it cannot be
   * attributed either way, and the window already bounds it.
   */
  attempt?: number;
}

/**
 * Rows the manager or the harness already wrote, read back as evidence.
 *
 * Nothing is re-run. The point of a hook row is that it was written from
 * inside the harness on a path the agent cannot reach, and the point of a
 * B8-assert row is that the manager produced it by running a command. Reading
 * them is what puts those steps of the chain into the ensemble instead of
 * leaving them as boxes in a diagram.
 */
export function collectLoggedGates(
  window: HookWindow,
  gates: readonly string[],
  read: typeof readEntries = readEntries,
): GateReport[] {
  if (!window.since) return [];
  return read(window.project)
    .filter(
      (entry) =>
        gates.includes(entry.gate) &&
        typeof entry.ts === 'string' &&
        entry.ts >= window.since &&
        (!window.until || entry.ts <= window.until) &&
        (window.attempt === undefined || entry.attempt === undefined || entry.attempt === window.attempt),
    )
    .map((entry) => ({
      gate: entry.gate,
      gate_family: entry.gate_family,
      verdict: entry.verdict,
      caught: entry.caught ?? '',
    }));
}

export function collectHookGates(window: HookWindow, read: typeof readEntries = readEntries): GateReport[] {
  return collectLoggedGates(window, HOOK_GATES, read).filter((gate) => gate.gate_family === 'deterministic');
}

function write(ctx: ChainContext, report: GateReport, costUsd: number): void {
  logGate({
    project: ctx.project,
    issue: ctx.issue,
    lane: ctx.envelope.lane,
    gate: report.gate,
    gate_family: report.gate_family,
    verdict: report.verdict,
    attempt: ctx.attempt,
    cost_usd: costUsd,
    caught: report.caught,
    review_depth: ctx.reviewDepth,
    human_intervened: false,
  });
}

function skipRow(gate: ChainGate, why: string): GateReport {
  return { gate, gate_family: 'llm', verdict: 'skipped', caught: why };
}

/**
 * Turns an llm gate's answer into one row. The gate NAME is assigned by the
 * manager, never taken from the agent's JSON: the manager knows which prompt
 * it just sent, and letting the answer name itself would hand the thing being
 * measured control of its own label. Only the verdict and the finding text
 * come from the agent.
 */
export function reportFromVerdict(gate: ChainGate, verdict: AgentVerdict): GateReport {
  const own = verdict.gates.find((g) => g.gate === gate);
  const findings = verdict.findings.filter((f) => f.trim() !== '');
  if (verdict.verdict === 'blocked') {
    return { gate, gate_family: 'llm', verdict: 'error', caught: verdict.reason || 'gate reported blocked' };
  }
  if (own && (own.verdict === 'caught' || own.verdict === 'error')) {
    return { gate, gate_family: 'llm', verdict: own.verdict, caught: own.caught || findings.join('; ') || verdict.reason };
  }
  if (findings.length > 0) {
    return { gate, gate_family: 'llm', verdict: 'caught', caught: findings.join('; ') };
  }
  if (verdict.verdict === 'fail') {
    return { gate, gate_family: 'llm', verdict: 'error', caught: verdict.reason || 'gate returned no usable answer' };
  }
  return { gate, gate_family: 'llm', verdict: 'pass', caught: '' };
}

async function runLlmGate(ctx: ChainContext, gate: ChainGate, prompt: string): Promise<ChainGateRun> {
  const result = await ctx.spawn({ gate, role: roleForGate(gate), prompt, readOnly: true });
  const verdict = parseVerdict(result.output);
  const report = reportFromVerdict(gate, verdict);
  write(ctx, report, result.costUsd);
  return { gate, reports: [report], verdict, assert: null, costUsd: result.costUsd };
}

function skipped(ctx: ChainContext, gate: ChainGate, why: string): ChainGateRun {
  const report = skipRow(gate, why);
  write(ctx, report, 0);
  return { gate, reports: [report], verdict: null, assert: null, costUsd: 0 };
}

async function runVerifyGate(ctx: ChainContext, gate: ChainGate): Promise<ChainGateRun> {
  if (gate === 'B8-assert') {
    const result = await runAssertGate({
      project: ctx.project,
      scope: ctx.scope,
      exec: ctx.exec,
      timeoutMs: ctx.assertTimeoutMs,
    });
    for (const report of result.reports) write(ctx, report, 0);
    return { gate, reports: result.reports, verdict: null, assert: result, costUsd: 0 };
  }
  if (!ctx.hasRealBrowser) {
    return skipped(
      ctx,
      gate,
      `lane ${ctx.envelope.lane} asks for ${gate} but this task has no real-browser oracle (oracle_kind: ${ctx.envelope.oracle_kind.join(', ') || 'none'})`,
    );
  }
  const prompt = gate === 'design-judge' ? designJudgePrompt(ctx.envelope) : judgePrompt(ctx.envelope);
  return runLlmGate(ctx, gate, prompt);
}

function assemble(runs: ChainGateRun[], lines: string[]): ChainRun {
  const advisories: string[] = [];
  for (const run of runs) {
    for (const advisory of run.verdict?.advisories ?? []) {
      const line = `${run.gate}: ${advisory}`;
      if (!advisories.includes(line)) advisories.push(line);
    }
  }
  const assertRun = runs.find((r) => r.assert !== null)?.assert ?? null;
  return {
    runs,
    reports: runs.flatMap((r) => r.reports),
    advisories,
    lines,
    proven: assertRun ? assertRun.summary.proven : true,
    oracleFault: assertRun ? assertRun.summary.oracle_fault : false,
    assertPending: assertRun ? assertRun.plan.pending.map((c) => c.cmd) : [],
  };
}

/**
 * The verify lane, split as §7.4 asks. `B8-assert` runs first and takes no
 * token, so N projects verify at once. The judges run only when the task
 * actually has a real browser to judge in, and the caller holds the single
 * browser token around them.
 */
export async function runVerifyChain(
  ctx: ChainContext,
  gates: readonly ChainGate[] = VERIFY_CHAIN[ctx.envelope.lane],
): Promise<ChainRun> {
  const runs: ChainGateRun[] = [];
  const lines: string[] = [];
  for (const gate of gates) {
    const run = await runVerifyGate(ctx, gate);
    runs.push(run);
    if (run.assert) {
      lines.push(
        `B8-assert (${run.assert.plan.source}): ${run.assert.summary.ran} test(s) ran, ${run.assert.summary.skipped} skipped`,
      );
      for (const line of run.assert.lines) lines.push(`  ${line}`);
      if (!run.assert.summary.proven) break;
    }
  }
  return assemble(runs, lines);
}

/**
 * The review lane: spec-check first and alone, then the reviewers.
 *
 * Sequential on purpose. Each spawn folds cost and agent handles back into one
 * task record, and two of them in flight would read the same record and write
 * over each other's spend — the money would go missing from the ledger the
 * ceiling is enforced against.
 */
export async function runReviewChain(ctx: ChainContext): Promise<ChainRun> {
  const gates = REVIEW_CHAIN[ctx.envelope.lane];
  const runs: ChainGateRun[] = [];
  const lines: string[] = [];
  if (gates.length === 0) return assemble(runs, lines);

  const diff = (ctx.diff ?? readDiff)(ctx.scope);
  if (!diff.ok) {
    for (const gate of gates) {
      const report: GateReport = {
        gate,
        gate_family: 'llm',
        verdict: 'error',
        caught: `no diff to review: ${diff.error}`,
      };
      write(ctx, report, 0);
      runs.push({ gate, reports: [report], verdict: null, assert: null, costUsd: 0 });
    }
    return assemble(runs, lines);
  }
  lines.push(`diff: ${diff.text.length} bytes${diff.truncated ? ' (truncated)' : ''}`);

  const intent = `${ctx.envelope.title} — ${ctx.envelope.why}`;
  for (const gate of gates) {
    const prompt =
      gate === 'spec-check'
        ? specCheckPrompt(specCheckInput(ctx, diff))
        : gate === 'impact-review'
          ? impactReviewPrompt({
              project: ctx.project,
              issue: ctx.issue,
              intent,
              diff: diff.text,
              diffTruncated: diff.truncated,
            })
          : techReviewPrompt({
              project: ctx.project,
              issue: ctx.issue,
              intent,
              diff: diff.text,
              diffTruncated: diff.truncated,
            });
    runs.push(await runLlmGate(ctx, gate, prompt));
  }
  return assemble(runs, lines);
}

/**
 * Builds spec-check's entire world, field by field, from the sized envelope
 * and the diff.
 *
 * Nothing here reads the task record. The agreed intent comes from the
 * envelope, which the SIZING agent wrote before any code existed, and the root
 * cause is one capped sentence. The builder's reasoning, its report lines, its
 * findings, its assumptions and its transcript are not reachable from this
 * function's arguments, which is the point: an isolation kept by a sentence in
 * a prompt lasts until the next convenient refactor, an isolation kept by the
 * shape of the call survives it.
 */
export function specCheckInput(ctx: ChainContext, diff: DiffResult): SpecCheckInput {
  return {
    project: ctx.project,
    issue: ctx.issue,
    lane: ctx.envelope.lane,
    intent: `${ctx.envelope.title} — ${ctx.envelope.why}`,
    rootCause: ctx.rootCause,
    diff: diff.text,
    diffTruncated: diff.truncated,
  };
}

/** Tools a chain gate gets. Every gate here is report-only. */
export function gateTools(): { allowedTools: string[]; disallowedTools: string[] } {
  return { allowedTools: [...READ_ONLY_TOOLS], disallowedTools: [...READ_ONLY_DISALLOWED] };
}

export function gateMaxTurns(gate: ChainGate): number {
  return loadConfig().maxTurns[roleForGate(gate)];
}
