/**
 * The closing chain — what happens AFTER the subagent says it is done.
 *
 * This is workflow.md A8 and B9 turned into steps that actually run. The
 * chain per lane is §7.2:
 *
 *   trivial   hook
 *   bug-nho   hook -> red-test -> B8-assert -> spec-check
 *   bug-lon   hook -> red-test -> B8-assert -> B8-judge -> spec-check -> tech-review
 *   feature   hook -> B8-assert -> design-judge -> spec-check -> tech-review
 *             -> impact-review
 *
 * Two of those steps are already recorded by the time this file runs. The hook
 * gates are written into the gate log by the harness itself while the agent
 * works, so they are READ here rather than re-run — that is the whole reason
 * they count as independent evidence. The manager witnesses red-test by
 * applying only changed test files to a temporary baseSha checkout and running
 * the same registered assert command used at task HEAD.
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
import type { DiffResult } from './git';
import { logGate, readEntries } from './gate-log-port';
import { workOnly } from './gate-log';
import {
  managerChain,
  managerGates,
  ORACLE_CHAIN,
  type HookGate,
  type ManagerDispatchGate,
} from './oracle-chain';
import {
  designJudgePrompt,
  impactReviewPrompt,
  judgePrompt,
  specCheckPrompt,
  techReviewPrompt,
  type SpecCheckInput,
} from './prompts';
import { transportFailed } from './spawn';
import { finishRedTest, runRedTestBaseline } from './red-test-runner';
import { NO_PARSEABLE_VERDICT, parseVerdictCandidates, type AgentVerdict, type GateReport } from './verdict';
import { liveTaskDiff, type TaskWorkdir } from './worktrees';

export type ChainGate = ManagerDispatchGate;
export type ManagerDispatchKind = 'red-test' | 'assert' | 'judge' | 'design-judge' | 'spec-check' | 'tech-review' | 'impact-review';

export function managerDispatchKind(gate: ChainGate): ManagerDispatchKind {
  switch (gate) {
    case 'red-test':
      return 'red-test';
    case 'B8-assert':
      return 'assert';
    case 'B8-judge':
      return 'judge';
    case 'design-judge':
      return 'design-judge';
    case 'spec-check':
      return 'spec-check';
    case 'tech-review':
      return 'tech-review';
    case 'impact-review':
      return 'impact-review';
    default: {
      const neverGate: never = gate;
      throw new Error(`manager gate has no dispatcher: ${neverGate}`);
    }
  }
}

/** Gates run in the VERIFYING phase. */
export const VERIFY_CHAIN: Record<Lane, ChainGate[]> = Object.fromEntries(
  (Object.keys(ORACLE_CHAIN) as Lane[]).map((lane) => [lane, managerChain(lane, 'verify')]),
) as Record<Lane, ChainGate[]>;

/** Gates run in the REVIEW phase. */
export const REVIEW_CHAIN: Record<Lane, ChainGate[]> = Object.fromEntries(
  (Object.keys(ORACLE_CHAIN) as Lane[]).map((lane) => [lane, managerChain(lane, 'review')]),
) as Record<Lane, ChainGate[]>;

/** The only gates that need the single real Chrome (§6.3, §7.4). */
export const BROWSER_GATES: readonly ChainGate[] = managerGates('real-browser-oracle');

/**
 * Gates the manager runs itself. An agent claiming one of these in its own
 * verdict is claiming a result it did not produce, so the claim is dropped
 * rather than logged — the whole reason these moved out of the agent's JSON
 * (§7.3b lesson 2) was that a self-reported gate is testimony, not evidence.
 */
export const MANAGER_OWNED_GATES: readonly string[] = managerGates();

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
  /**
   * Added to the read-only set for gates that need more than reading — today
   * only the browser gates, which cannot judge a page they cannot open.
   */
  extraTools?: string[];
}

export interface GateSpawnResult {
  output: string;
  outputs: string[];
  costUsd: number;
  /** False when nobody priced the run. The gate log then carries no cost at all. */
  costKnown: boolean;
  /** The transport's own word for how the run ended. See transportFailed(). */
  exitReason: string;
  /** What answered, recorded on the row so §7.3 stays checkable afterwards. */
  model: string;
  family: string;
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
  /**
   * The gate could not be applied at all — no transport, no tooling. Kept apart
   * from a pass and from a fail: it is the oracle that broke, not the code, so
   * it must not read as proof and must not spend a retry on the same empty
   * answer.
   */
  unavailable?: boolean;
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
  diff: DiffResult | null;
}

export interface ChainContext {
  taskId: string;
  project: string;
  issue: string;
  /** The project's own checkout. Only B8-assert's command plan is resolved from it. */
  scope: string;
  /**
   * Where this task's work actually is. Every gate reads THIS, never `scope`.
   *
   * The two were one field until 14/08, and a task run in a worktree had its
   * whole closing chain pointed at the main checkout: the assert counted the
   * project's tests instead of the task's, and the reviewers read whatever
   * another session happened to have uncommitted. Required rather than
   * optional so a caller cannot leave it out and get the old behaviour back.
   */
  workdir: TaskWorkdir;
  envelope: TaskEnvelope;
  attempt: number;
  reviewDepth: 'summary' | 'full-diff';
  /** One sentence, from the builder's verdict. Empty for feature work. */
  rootCause: string;
  spawn: GateSpawn;
  /** Swapped in tests so no real command runs. */
  exec?: ExecFn;
  assertTimeoutMs?: number;
  diff?: (work: TaskWorkdir) => DiffResult;
  /** True when the task's oracle includes the real logged-in browser. */
  hasRealBrowser?: boolean;
}

/**
 * §7.2 step one. The hook rows were written by `pre-tool-use-guard.sh` and
 * `stop-full-check.sh` during RUNNING, from inside the harness on a path the
 * agent cannot reach. Reading them here is what puts the hook step of the
 * chain into the ensemble instead of leaving it as a line in a diagram.
 */
export function hookEvidenceGates(gate: HookGate): readonly string[] {
  switch (gate) {
    case 'hook':
      return ['guard', 'lint', 'tsc', 'test'];
    default: {
      const neverGate: never = gate;
      throw new Error(`hook gate has no evidence reader: ${neverGate}`);
    }
  }
}

export const HOOK_GATES: readonly string[] = hookEvidenceGates('hook');

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
  taskId?: string;
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
 *
 * `origin: gate-test` rows are skipped. A probe run aimed at the guard writes
 * genuine rows for the same project, and a task whose window overlaps one would
 * otherwise collect another run's evidence as its own.
 */
export function collectLoggedGates(
  window: HookWindow,
  gates: readonly string[],
  read: typeof readEntries = readEntries,
): GateReport[] {
  if (!window.since) return [];
  const result = read(window.project);
  if (!result.ok) {
    return [{ gate: 'gate-log', gate_family: 'deterministic', verdict: 'error', caught: result.reason }];
  }
  return workOnly(result.entries)
    .filter(
      (entry) =>
        gates.includes(entry.gate) &&
        (window.taskId === undefined || entry.task_id === window.taskId) &&
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

interface GateCost {
  usd: number;
  known: boolean;
  model?: string;
  family?: string;
}

/** A gate that never reached a transport. Zero here is measured, not assumed. */
const NOTHING_SPENT: GateCost = { usd: 0, known: true };

/**
 * An unpriced run writes NO cost field rather than a zero.
 *
 * A zero would read as a cheap run to anything that later sums or averages
 * these rows; an absent field cannot be mistaken for a measurement. Nothing
 * builds a ceiling from the gate log today — `collectLaneSamples` reads task
 * records only — but the log is the durable record, and the row has to stay
 * true to whoever reads it next.
 */
function write(ctx: ChainContext, report: GateReport, cost: GateCost): void {
  logGate({
    project: ctx.project,
    task_id: ctx.taskId,
    issue: ctx.issue,
    lane: ctx.envelope.lane,
    gate: report.gate,
    gate_family: report.gate_family,
    verdict: report.verdict,
    attempt: ctx.attempt,
    cost_usd: cost.known ? cost.usd : undefined,
    caught: report.caught,
    model: cost.model,
    model_family: cost.family,
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

/**
 * A judge with no way to open the page is not a judge. Refusing here costs one
 * `error` row; running anyway costs a verdict that reads like evidence and was
 * produced without looking, which is worse than having no gate at all.
 */
function browserGateBlocked(gate: ChainGate): GateReport | null {
  if (!BROWSER_GATES.includes(gate)) return null;
  const tools = loadConfig().browserTools;
  if (tools.length > 0) return null;
  return {
    gate,
    gate_family: 'llm',
    verdict: 'error',
    caught:
      'no browser transport configured (config.browserTools is empty), so this gate cannot see the page it is meant to judge',
  };
}

/**
 * The transport never carried the request — no codex binary, no pane. Held
 * apart from every other error because the alternative reads as the model's
 * fault: parseVerdict finds no JSON in "SKIP: codex binary not found" and
 * reports "agent returned no parseable verdict block", which blames a model
 * that was never asked. `unavailable` is what stops a missing binary being
 * retried against the same absent transport.
 */
function transportRow(gate: ChainGate, exitReason: string, output: string): GateReport {
  return {
    gate,
    gate_family: 'llm',
    verdict: 'error',
    caught: `${gate} never ran: the review transport failed with "${exitReason}" — ${output.trim().slice(0, 200)}`,
  };
}

export function nonTransportExitFailure(exitReason: string, output: string, subject: string): string {
  if (exitReason === 'success' || transportFailed(exitReason)) return '';
  const detail = output.trim().slice(0, 200);
  return `${subject} stopped with "${exitReason}"${detail ? ` — ${detail}` : ''}`;
}

async function runLlmGate(ctx: ChainContext, gate: ChainGate, prompt: string): Promise<ChainGateRun> {
  const blocked = browserGateBlocked(gate);
  if (blocked) {
    write(ctx, blocked, NOTHING_SPENT);
    return { gate, reports: [blocked], verdict: null, assert: null, costUsd: 0, unavailable: true };
  }
  const browserTools = BROWSER_GATES.includes(gate) ? loadConfig().browserTools : undefined;
  const result = await ctx.spawn({ gate, role: roleForGate(gate), prompt, readOnly: true, extraTools: browserTools });
  const cost: GateCost = { usd: result.costUsd, known: result.costKnown, model: result.model, family: result.family };
  if (transportFailed(result.exitReason)) {
    const report = transportRow(gate, result.exitReason, result.output);
    write(ctx, report, cost);
    return { gate, reports: [report], verdict: null, assert: null, costUsd: result.costUsd, unavailable: true };
  }
  const verdict = parseVerdictCandidates(result.outputs, result.output);
  const stopped = verdict.reason === NO_PARSEABLE_VERDICT
    ? nonTransportExitFailure(result.exitReason, result.output, gate)
    : '';
  if (stopped) {
    const report: GateReport = { gate, gate_family: 'llm', verdict: 'error', caught: stopped };
    write(ctx, report, cost);
    return { gate, reports: [report], verdict: null, assert: null, costUsd: result.costUsd };
  }
  const report = { ...reportFromVerdict(gate, verdict), family: result.family };
  write(ctx, report, cost);
  return { gate, reports: [report], verdict, assert: null, costUsd: result.costUsd };
}

function skipped(ctx: ChainContext, gate: ChainGate, why: string): ChainGateRun {
  const report = skipRow(gate, why);
  write(ctx, report, NOTHING_SPENT);
  return { gate, reports: [report], verdict: null, assert: null, costUsd: 0 };
}

/**
 * A gate with no tree to look at.
 *
 * `unavailable` preserves why the oracle did not run, separately from a gate
 * that ran and returned an error verdict.
 */
function noTree(ctx: ChainContext, gate: ChainGate, why: string): ChainGateRun {
  const report: GateReport = { gate, gate_family: 'deterministic', verdict: 'error', caught: why };
  write(ctx, report, NOTHING_SPENT);
  return { gate, reports: [report], verdict: null, assert: null, costUsd: 0, unavailable: true };
}

async function runVerifyGate(ctx: ChainContext, gate: ChainGate): Promise<ChainGateRun> {
  const dispatch = managerDispatchKind(gate);
  if (dispatch === 'red-test') throw new Error('red-test must be paired with the task HEAD assert');
  if (dispatch === 'assert') {
    if (ctx.workdir.reason) return noTree(ctx, gate, ctx.workdir.reason);
    const result = await runAssertGate({
      project: ctx.project,
      scope: ctx.scope,
      cwd: ctx.workdir.dir,
      exec: ctx.exec,
      timeoutMs: ctx.assertTimeoutMs,
    });
    for (const report of result.reports) write(ctx, report, NOTHING_SPENT);
    return { gate, reports: result.reports, verdict: null, assert: result, costUsd: 0 };
  }
  if (!ctx.hasRealBrowser) {
    return skipped(
      ctx,
      gate,
      `lane ${ctx.envelope.lane} asks for ${gate} but this task has no real-browser oracle (oracle_kind: ${ctx.envelope.oracle_kind.join(', ') || 'none'})`,
    );
  }
  if (dispatch !== 'judge' && dispatch !== 'design-judge') {
    throw new Error(`review gate ${gate} was dispatched during verify`);
  }
  const prompt = dispatch === 'design-judge' ? designJudgePrompt(ctx.envelope) : judgePrompt(ctx.envelope);
  return runLlmGate(ctx, gate, prompt);
}

function assemble(runs: ChainGateRun[], lines: string[], forceUnavailable = false, diff: DiffResult | null = null): ChainRun {
  const advisories: string[] = [];
  for (const run of runs) {
    for (const advisory of run.verdict?.advisories ?? []) {
      const line = `${run.gate}: ${advisory}`;
      if (!advisories.includes(line)) advisories.push(line);
    }
  }
  const assertRun = runs.find((r) => r.assert !== null)?.assert ?? null;
  const unavailable = forceUnavailable || runs.some((r) => r.unavailable);
  const measured = runs.length > 0;
  return {
    runs,
    reports: runs.flatMap((r) => r.reports),
    advisories,
    lines,
    proven: unavailable || !measured ? false : assertRun ? assertRun.summary.proven : true,
    oracleFault: unavailable ? true : assertRun ? assertRun.summary.oracle_fault : false,
    assertPending: assertRun ? assertRun.plan.pending.map((c) => c.cmd) : [],
    diff,
  };
}

/**
 * The verify lane, split as §7.4 asks. Red-test builds and runs the isolated
 * baseSha checkout, then `B8-assert` supplies the task-HEAD half of the proof.
 * Neither takes a browser token. Judges run only when the task has a real
 * browser to judge in.
 */
export async function runVerifyChain(
  ctx: ChainContext,
  gates: readonly ChainGate[] = VERIFY_CHAIN[ctx.envelope.lane],
): Promise<ChainRun> {
  const runs: ChainGateRun[] = [];
  const lines: string[] = [];
  let baseline: Awaited<ReturnType<typeof runRedTestBaseline>> | null = null;
  if (gates.length === 0 && ctx.workdir.reason) return assemble(runs, [ctx.workdir.reason], true);
  for (const gate of gates) {
    if (gate === 'red-test') {
      baseline = await runRedTestBaseline({
        project: ctx.project,
        scope: ctx.scope,
        record: ctx.workdir.record,
        exec: ctx.exec,
        timeoutMs: ctx.assertTimeoutMs,
      });
      continue;
    }
    const run = await runVerifyGate(ctx, gate);
    runs.push(run);
    if (gate === 'B8-assert' && baseline) {
      const report = finishRedTest(baseline, run.assert);
      write(ctx, report, NOTHING_SPENT);
      runs.push({ gate: 'red-test', reports: [report], verdict: null, assert: null, costUsd: 0 });
      lines.push(`red-test: ${report.caught}`);
      baseline = null;
    }
    if (run.assert) {
      lines.push(
        `B8-assert (${run.assert.plan.source}): ${run.assert.summary.ran} test(s) ran, ${run.assert.summary.skipped} skipped`,
      );
      for (const line of run.assert.lines) lines.push(`  ${line}`);
      if (!run.assert.summary.proven) break;
    }
  }
  if (baseline) {
    const report = finishRedTest(baseline, null);
    write(ctx, report, NOTHING_SPENT);
    runs.push({ gate: 'red-test', reports: [report], verdict: null, assert: null, costUsd: 0 });
    lines.push(`red-test: ${report.caught}`);
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

  const diff = (ctx.diff ?? liveTaskDiff)(ctx.workdir);
  if (!diff.ok) {
    for (const gate of gates) {
      const report: GateReport = {
        gate,
        gate_family: 'llm',
        verdict: 'error',
        caught: `no diff to review: ${diff.error}`,
      };
      write(ctx, report, NOTHING_SPENT);
      runs.push({ gate, reports: [report], verdict: null, assert: null, costUsd: 0 });
    }
    return assemble(runs, lines, false, diff);
  }
  lines.push(`diff: ${diff.text.length} bytes${diff.truncated ? ' (truncated)' : ''}`);

  const intent = `${ctx.envelope.title} — ${ctx.envelope.why}`;
  for (const gate of gates) {
    const dispatch = managerDispatchKind(gate);
    const input = {
      project: ctx.project,
      issue: ctx.issue,
      intent,
      diff: diff.text,
      diffTruncated: diff.truncated,
    };
    let prompt: string;
    switch (dispatch) {
      case 'spec-check':
        prompt = specCheckPrompt(specCheckInput(ctx, diff));
        break;
      case 'tech-review':
        prompt = techReviewPrompt(input);
        break;
      case 'impact-review':
        prompt = impactReviewPrompt(input);
        break;
      default:
        throw new Error(`verify gate ${gate} was dispatched during review`);
    }
    runs.push(await runLlmGate(ctx, gate, prompt));
  }
  return assemble(runs, lines, false, diff);
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
