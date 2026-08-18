/**
 * The manager itself: routing, accounting, reporting (§6).
 *
 * It is deliberately thin. It never writes code, never edits a file inside a
 * project, and holds nothing important in memory — every decision lands in
 * tasks/<id>.json and in the gate log before the next one starts. What it owns
 * is the order of phases, who is allowed to run at the same time, what a run
 * is allowed to cost, and what a human gets told.
 *
 * The rule that has no layer behind it: nothing irreversible happens without a
 * human saying yes (§10.1). The Telegram bot only asks when this file emits an
 * `approval` event, so every path to a push, a commit, a deploy, a merge, a
 * deletion, or anything touching production must route through
 * parkForApproval. There is no flag to turn that off.
 */

import * as path from 'path';
import {
  familyOfModel,
  loadConfig,
  type ManagerConfig,
  modelForRole,
  READ_ONLY_DISALLOWED,
  READ_ONLY_TOOLS,
  resolveReviewProvider,
  REVIEW_PROVIDER_FAMILY,
} from '../config';
import type { AgentRole, AssertRunRecord, TaskRecord, TaskSource, TaskState } from '../types';
import { ACTIVE_STATES, isTerminal } from '../types';
import { logGate, shouldBlindSample } from './gate-log-port';
import { parseEnvelope } from './envelope';
import { acquire, BROWSER_TOKEN, projectLock, release, releaseAll } from './locks';
import {
  BLOCKING_HOOK_GATES,
  BROWSER_GATES,
  collectLoggedGates,
  MANAGER_OWNED_GATES,
  runReviewChain,
  runVerifyChain,
  VERIFY_CHAIN,
  type ChainContext,
  type ChainRun,
} from './closing-chain';
import { approveCommands } from './assert-approvals';
import { checkDayCeiling, checkTaskCeiling, collectLaneSamples, laneCeiling, unmeasuredRuns } from './cost';
import { buildApprovalEvent, buildReportEvent, emit } from './events';
import type { AssertRun } from './assert-runner';
import { resolveProjectScope } from './paths';
import { executePrompt, sizingPrompt } from './prompts';
import { applyTransition, isNoRetryReason, nextAfterVerifyFailure, RESUME_REASON } from './state-machine';
import {
  abortTask,
  clearTaskAbort,
  defaultSpawnPort,
  resolveReviewPort,
  signalForTask,
  type SpawnPort,
  type SpawnRequest,
  type SpawnResult,
  transportFailed,
} from './spawn';
import { listTasks, loadTask, newTaskRecord, saveTask, saveTaskAndIndex } from './store';
import { resolveTaskWorkdir } from './worktrees';
import {
  applyEnsembleRule,
  parseVerdictCandidates,
  verifyDeterministicGates,
  type AgentVerdict,
  type GateReport,
} from './verdict';

export interface OrchestratorDeps {
  spawnPort?: SpawnPort;
  reviewPort?: SpawnPort;
  /** Override for tests that need a deterministic blind-sample draw. */
  blindSample?: () => boolean;
  /**
   * How B8-assert actually runs a command. Tests pass a stub so the suite
   * never shells out; production leaves it undefined and the real shell runs.
   */
  exec?: ChainContext['exec'];
  /** Reads the staged diff the review gates judge. Stubbed in tests. */
  diff?: ChainContext['diff'];
}

export interface SubmitInput {
  project: string;
  issue: string;
  source: TaskSource;
  /** Explicit repo path; falls back to the project registry. */
  scope?: string;
  roundTwoFail?: boolean;
}

export interface SubmitResult {
  taskId: string;
  accepted: boolean;
  error: string;
}

const APPROVAL_BUDGET = 'raise the budget';
const APPROVAL_START = 'start this task';
const APPROVAL_ORACLE = 'fix the oracle, then re-verify';
const APPROVAL_ASSERT_CMD = 'run this test command';

function spawnFailureReason(phase: 'sizing' | 'execution', run: SpawnResult): string {
  const detail = run.output.trim();
  return `${phase} spawn failed (${run.exitReason})${detail ? `: ${detail}` : ''}`;
}

function parseRunEnvelope(run: SpawnResult, roundTwoFail: boolean) {
  for (const output of run.outputs ?? []) {
    const parsed = parseEnvelope(output, { roundTwoFail });
    if (parsed.ok) return parsed;
  }
  return parseEnvelope(run.output, { roundTwoFail });
}

export class Orchestrator {
  private readonly spawnPort: SpawnPort;
  private readonly reviewPort: SpawnPort;
  private readonly blindSample: () => boolean;
  private readonly exec: ChainContext['exec'];
  private readonly diff: ChainContext['diff'];
  private readonly stopRequested = new Set<string>();
  private readonly running = new Map<string, Promise<void>>();
  private readonly roundTwoFail = new Set<string>();

  constructor(deps: OrchestratorDeps = {}) {
    this.spawnPort = deps.spawnPort ?? defaultSpawnPort();
    this.reviewPort = deps.reviewPort ?? resolveReviewPort();
    this.blindSample = deps.blindSample ?? (() => shouldBlindSample());
    this.exec = deps.exec;
    this.diff = deps.diff;
  }

  async submit(input: SubmitInput): Promise<SubmitResult> {
    const resolved = input.scope
      ? { scope: path.resolve(input.scope), reason: '' }
      : resolveProjectScope(input.project);
    const scope = resolved.scope;
    if (!scope) return { taskId: '', accepted: false, error: resolved.reason };

    const cfg = loadConfig();
    const task = newTaskRecord({
      project: input.project,
      issue: input.issue,
      source: input.source,
      scope,
      ceilingUsd: cfg.bootstrapTaskCeilingUsd,
    });
    if (input.roundTwoFail) this.roundTwoFail.add(task.id);
    await saveTaskAndIndex(task);
    this.logTransition(task, 'INTAKE', 'INTAKE', 'pass', 'submitted');
    void this.start(task.id);
    return { taskId: task.id, accepted: true, error: '' };
  }

  /** Kicks the driver without blocking the caller. */
  start(id: string): Promise<void> {
    const existing = this.running.get(id);
    if (existing) return existing;
    const promise = this.advance(id)
      .catch(async (err) => {
        const task = loadTask(id);
        if (task && !isTerminal(task.state)) {
          await this.terminate(task, 'FAILED', String((err as Error)?.message ?? err));
        }
      })
      .finally(() => {
        this.running.delete(id);
      });
    this.running.set(id, promise);
    return promise;
  }

  /** Waits for the current driver pass. Tests use this; the daemon does not. */
  async settle(id: string): Promise<void> {
    for (let i = 0; i < 100; i++) {
      const inflight = this.running.get(id);
      if (!inflight) return;
      await inflight;
    }
  }

  private async advance(id: string): Promise<void> {
    for (;;) {
      const task = loadTask(id);
      if (!task) return;
      if (isTerminal(task.state)) return;
      if (this.stopRequested.has(id)) {
        this.stopRequested.delete(id);
        await this.terminate(task, 'FAILED', 'stopped by user');
        return;
      }
      if (task.state === 'APPROVAL') return;

      switch (task.state) {
        case 'INTAKE':
          await this.phaseSize(task);
          break;
        case 'SIZED':
          if (!(await this.phaseGate(task))) return;
          break;
        case 'RUNNING':
          if (!(await this.phaseExecute(task))) return;
          break;
        case 'VERIFYING':
          if (!(await this.phaseVerify(task))) return;
          break;
        case 'REVIEW':
          if (!(await this.phaseReview(task))) return;
          break;
        default:
          return;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Phases. Each returns false when the task parked or ended and the driver
  // should stop walking.
  // -------------------------------------------------------------------------

  /**
   * One main agent per repo (§6.3). Acquired inside the driver, never inside
   * an HTTP handler, so a phone waiting on `approve` is not held open while
   * another task finishes with the same repo. Idempotent when already held.
   */
  private async ensureProjectLock(task: TaskRecord): Promise<void> {
    await acquire(projectLock(task.project), task.id);
  }

  private async phaseSize(task: TaskRecord): Promise<boolean> {
    await this.ensureProjectLock(task);
    task = loadTask(task.id) ?? task;
    if (isTerminal(task.state)) return false;
    const budget = this.preflightBudget(task);
    if (!budget.ok) {
      await this.parkForApproval(task, APPROVAL_BUDGET, budget.reason);
      return false;
    }
    const run = await this.spawn(task, 'main', sizingPrompt(task.project, task.issue), this.spawnPort);
    if (transportFailed(run.exitReason)) {
      await this.terminate(task, 'BLOCKED', spawnFailureReason('sizing', run));
      return false;
    }
    const parsed = parseRunEnvelope(run, this.roundTwoFail.has(task.id));
    if (!parsed.ok || !parsed.envelope) {
      await this.terminate(task, 'BLOCKED', `envelope rejected: ${parsed.errors.join('; ')}`);
      return false;
    }
    const next = loadTask(task.id) ?? task;
    next.envelope = parsed.envelope;
    next.assumptions = [...parsed.envelope.assumptions];
    next.assumption_count = parsed.envelope.assumption_count;
    for (const line of parsed.overrides) next.report_lines.push(`router override: ${line}`);
    const decision = laneCeiling(collectLaneSamples(), parsed.envelope.lane);
    next.cost_ceiling_usd = decision.ceiling_usd;
    const rejected =
      decision.rejected_partial > 0 ? `, ${decision.rejected_partial} rejected as partially measured` : '';
    next.report_lines.push(
      `ceiling $${decision.ceiling_usd.toFixed(2)} (${decision.source}, ${decision.sample_count} samples${rejected})`,
    );
    const sized = applyTransition(next, 'SIZED', { reason: 'envelope accepted' });
    await saveTaskAndIndex(sized);
    this.logTransition(sized, 'INTAKE', 'SIZED', 'pass', '');
    return true;
  }

  private async phaseGate(task: TaskRecord): Promise<boolean> {
    await this.ensureProjectLock(task);
    task = loadTask(task.id) ?? task;
    if (isTerminal(task.state)) return false;
    const envelope = task.envelope;
    if (!envelope) {
      await this.terminate(task, 'BLOCKED', 'no envelope at gate');
      return false;
    }
    const policy = loadConfig().spawn[task.source] ?? loadConfig().spawn.cli;
    const reasons: string[] = [];
    if (envelope.needs_human) reasons.push('envelope needs_human');
    if (envelope.blocking_questions.length > 0) {
      reasons.push(`${envelope.blocking_questions.length} blocking question(s)`);
    }
    if (policy.alwaysRequireApproval) reasons.push(`source "${task.source}" always asks first`);
    const budget = this.preflightBudget(task);
    if (!budget.ok) reasons.push(budget.reason);

    if (reasons.length > 0) {
      const action = budget.ok ? APPROVAL_START : APPROVAL_BUDGET;
      await this.parkForApproval(task, action, reasons.join('; '), envelope.blocking_questions);
      return false;
    }
    const running = applyTransition(task, 'RUNNING', { reason: 'auto-approved' });
    await saveTaskAndIndex(running);
    this.logTransition(running, 'SIZED', 'RUNNING', 'pass', '');
    return true;
  }

  private async phaseExecute(task: TaskRecord): Promise<boolean> {
    await this.ensureProjectLock(task);
    task = loadTask(task.id) ?? task;
    if (isTerminal(task.state)) return false;
    const envelope = task.envelope;
    if (!envelope) {
      await this.terminate(task, 'BLOCKED', 'no envelope at execute');
      return false;
    }
    const budget = this.preflightBudget(task);
    if (!budget.ok) {
      await this.parkForApproval(task, APPROVAL_BUDGET, budget.reason);
      return false;
    }
    task.attempt_started_at = new Date().toISOString();
    saveTask(task);
    const priorFailure = task.failure_reason || 'unspecified';
    const run = await this.spawn(
      task,
      'subagent',
      executePrompt(envelope, task.attempt, priorFailure),
      this.spawnPort,
    );
    if (transportFailed(run.exitReason)) {
      await this.terminate(task, 'BLOCKED', spawnFailureReason('execution', run));
      return false;
    }
    const verdict = parseVerdictCandidates(run.outputs, run.output);
    const current = this.absorbVerdict(loadTask(task.id) ?? task, verdict);

    if (verdict.irreversible.length > 0 && await this.parkIfIrreversible(current, verdict.irreversible)) return false;
    if (verdict.verdict === 'blocked') {
      const why = verdict.reason || 'agent reported blocked';
      await this.terminate(
        current,
        'BLOCKED',
        isNoRetryReason(verdict.reason) ? `${why} — no retry, a second attempt has no new evidence` : why,
      );
      return false;
    }
    if (verdict.verdict === 'fail') {
      await this.terminate(current, 'BLOCKED', `execute failed: ${verdict.reason}`);
      return false;
    }
    const verifying = applyTransition(current, 'VERIFYING', { reason: 'execute reported pass' });
    await saveTaskAndIndex(verifying);
    this.logTransition(verifying, 'RUNNING', 'VERIFYING', 'pass', '');
    return true;
  }

  /**
   * The verify lane, split as §7.4 asks.
   *
   * `B8-assert` runs FIRST and takes no browser token: the manager executes
   * the project's own command and reads the exit code, so several projects
   * verify at the same time and the result is evidence rather than an agent's
   * account of it. Only then, and only when the task actually has a real
   * browser to judge in, does the single global token get taken for the
   * judges.
   *
   * Flow is decided by the deterministic half alone. A judge is an llm gate,
   * and §7.3 is explicit that one of those never blocks on its own — it warns,
   * and the ensemble at review time decides whether two of them agreeing means
   * something. So a judge finding does not send the task back for another
   * attempt; a failing assert does.
   *
   * A failing assert and an assert that never ran take different exits. Red
   * means the code is wrong and a retry has evidence to work from. Never-ran
   * means the oracle is broken: retrying spends another attempt to be told the
   * same nothing, and failing the task throws away work that is probably fine,
   * so it asks a human and resumes verification once the command is registered
   * or the environment is fixed.
   */
  private async phaseVerify(task: TaskRecord): Promise<boolean> {
    await this.ensureProjectLock(task);
    task = loadTask(task.id) ?? task;
    if (isTerminal(task.state)) return false;
    const envelope = task.envelope;
    if (!envelope) {
      await this.terminate(task, 'BLOCKED', 'no envelope at verify');
      return false;
    }
    const budget = this.preflightBudget(task);
    if (!budget.ok) {
      await this.parkForApproval(task, APPROVAL_BUDGET, budget.reason);
      return false;
    }
    const hasRealBrowser = envelope.oracle_kind.includes('my-chrome');
    const lane = VERIFY_CHAIN[envelope.lane];
    const headless = lane.filter((gate) => !BROWSER_GATES.includes(gate));
    const browser = lane.filter((gate) => BROWSER_GATES.includes(gate));

    const assertRun = await runVerifyChain(this.chainContext(task, envelope, hasRealBrowser), headless);
    let current = this.absorbChain(loadTask(task.id) ?? task, assertRun, 'verify');
    let unmeasuredWhy = '';

    if (!assertRun.proven) {
      const why = assertRun.reports.find((r) => r.verdict !== 'pass')?.caught || assertRun.lines[0] || 'no verify gate ran';
      if (assertRun.assertPending.length > 0) {
        current.pending_assert_cmds = [...assertRun.assertPending];
        await this.parkForApproval(
          current,
          APPROVAL_ASSERT_CMD,
          `the manager runs no command a human has not approved: ${assertRun.assertPending.join(' | ')}`,
        );
        return false;
      }
      if (assertRun.oracleFault) {
        await this.parkForApproval(current, APPROVAL_ORACLE, `the oracle did not run: ${why}`);
        return false;
      }
      if (lane.length === 0 && assertRun.runs.length === 0) {
        unmeasuredWhy = why;
        current.report_lines.push(`UNMEASURED: ${why}`);
      } else {
        const next = nextAfterVerifyFailure(current);
        if (next.to === 'RUNNING') {
          const retried = applyTransition(current, 'RUNNING', { reason: next.reason, failureReason: why });
          await saveTaskAndIndex(retried);
          this.logTransition(retried, 'VERIFYING', 'RUNNING', 'caught', why);
          return true;
        }
        await this.terminate(current, 'BLOCKED', `${next.reason}; still failing: ${why}`);
        return false;
      }
    }

    if (browser.length > 0) {
      let judgeFault: string[] = [];
      current = await this.withBrowserToken(current, hasRealBrowser, async (held) => {
        const judged = await runVerifyChain(this.chainContext(held, envelope, hasRealBrowser), browser);
        judgeFault = judged.runs.filter((run) => run.unavailable).map((run) => run.gate);
        return this.absorbChain(loadTask(held.id) ?? held, judged, 'verify');
      });
      if (judgeFault.length > 0) {
        await this.parkForApproval(
          current,
          APPROVAL_ORACLE,
          `${judgeFault.join(', ')} could not run, so nothing looked at the page this lane exists to check`,
        );
        return false;
      }
    }

    const reviewReason = unmeasuredWhy ? `verify unmeasured: ${unmeasuredWhy}` : 'B8 verify passed';
    const review = applyTransition(current, 'REVIEW', { reason: reviewReason });
    await saveTaskAndIndex(review);
    this.logTransition(review, 'VERIFYING', 'REVIEW', unmeasuredWhy ? 'skipped' : 'pass', unmeasuredWhy);
    return true;
  }

  /**
   * §6.3 — the machine has one real Chrome, so the token is held for exactly
   * the gates that need it and released whatever happens inside. Skipped
   * judges never take it: queueing behind a token to write "there was no
   * browser to look at" would stall a real judge for nothing.
   */
  private async withBrowserToken(
    task: TaskRecord,
    hasRealBrowser: boolean,
    run: (task: TaskRecord) => Promise<TaskRecord>,
  ): Promise<TaskRecord> {
    if (!hasRealBrowser) return run(task);
    await acquire(BROWSER_TOKEN, task.id);
    const withHold = loadTask(task.id) ?? task;
    if (!withHold.holds.includes(BROWSER_TOKEN)) withHold.holds.push(BROWSER_TOKEN);
    saveTask(withHold);
    try {
      await run(withHold);
    } finally {
      await release(BROWSER_TOKEN, task.id);
      const cleaned = loadTask(task.id);
      if (cleaned) {
        cleaned.holds = cleaned.holds.filter((h) => h !== BROWSER_TOKEN);
        saveTask(cleaned);
      }
    }
    return loadTask(task.id) ?? task;
  }

  /**
   * A8 / B9: spec-check on a fresh context, then the reviewers, then the
   * ensemble over everything this task accumulated — hook rows the harness
   * wrote during RUNNING, the manager's own assert rows, the judges, and the
   * review gates.
   */
  private async phaseReview(task: TaskRecord): Promise<boolean> {
    await this.ensureProjectLock(task);
    task = loadTask(task.id) ?? task;
    if (isTerminal(task.state)) return false;
    const envelope = task.envelope;
    if (!envelope) {
      await this.terminate(task, 'BLOCKED', 'no envelope at review');
      return false;
    }
    const budget = this.preflightBudget(task);
    if (!budget.ok) {
      await this.parkForApproval(task, APPROVAL_BUDGET, budget.reason);
      return false;
    }
    const chain = await runReviewChain(this.chainContext(task, envelope, false));
    const current = this.absorbChain(loadTask(task.id) ?? task, chain, 'report');
    const hasIrreversible = chain.runs.some((run) => (run.verdict?.irreversible.length ?? 0) > 0);
    if (hasIrreversible && await this.parkIfChainIrreversible(current, chain)) return false;

    const ensemble = applyEnsembleRule(this.collectGateReports(current, chain.reports));
    if (ensemble.outcome === 'block') {
      await this.terminate(current, 'BLOCKED', `review blocked: ${ensemble.why}`);
      return false;
    }
    const reviewDidNotRun = chain.runs.some((run) => run.unavailable) || ensemble.broken.length > 0;
    if (reviewDidNotRun && await this.parkIfReviewDidNotRun(current, chain, ensemble)) return false;
    if (ensemble.outcome === 'warn') current.report_lines.push(`WARN: ${ensemble.why}`);
    if (!ensemble.measured) current.report_lines.push(`UNMEASURED: ${ensemble.why}`);

    const reported = applyTransition(current, 'REPORTED', { reason: 'review closed' });
    reported.blind_sample = this.blindSample();
    reported.review_depth = reported.blind_sample ? 'full-diff' : 'summary';
    await saveTaskAndIndex(reported);
    await releaseAll(reported.id);
    this.logTransition(reported, 'REVIEW', 'REPORTED', 'pass', '');
    this.emitReport(reported);
    return false;
  }

  // -------------------------------------------------------------------------
  // Human-facing operations
  // -------------------------------------------------------------------------

  /**
   * The one place a human's yes turns into state. A yes to a parked test
   * command is also written into the approval book, so the same command never
   * asks twice — see lib/assert-approvals.ts for what that book is and is not.
   */
  async approve(id: string, approved: boolean, source: TaskSource = 'cli'): Promise<{ ok: boolean; error: string }> {
    const task = loadTask(id);
    if (!task) return { ok: false, error: `no such task ${id}` };
    if (task.state !== 'APPROVAL') return { ok: false, error: `task ${id} is ${task.state}, not APPROVAL` };
    if (!approved) {
      await this.terminate(task, 'REJECTED', `rejected by human via ${source}`);
      return { ok: true, error: '' };
    }
    task.pending_question = '';
    const wasBudget = task.pending_action === APPROVAL_BUDGET;
    const approvedCommands = task.pending_action === APPROVAL_ASSERT_CMD ? task.pending_assert_cmds ?? [] : [];
    task.pending_action = '';
    task.pending_assert_cmds = [];
    if (approvedCommands.length > 0) {
      approveCommands(task.project, approvedCommands);
      task.report_lines.push(`test command approved by a human: ${approvedCommands.join(' | ')}`);
    }
    if (wasBudget) {
      // Resuming without more headroom would trip the same ceiling on the very
      // next preflight and ask again, forever.
      task.cost_ceiling_usd += loadConfig().bootstrapTaskCeilingUsd;
      task.report_lines.push(`budget raised to $${task.cost_ceiling_usd.toFixed(2)} by a human`);
      // The unpriced-run cap needs the same escape and cannot borrow the
      // ceiling's: no dollar figure covers a run nobody priced, so without this
      // the count stays over the cap and parks again on the next preflight.
      if (unmeasuredRuns(task) > (task.cost_unmeasured_ack ?? 0)) {
        task.cost_unmeasured_ack = unmeasuredRuns(task);
        task.report_lines.push(`${task.cost_unmeasured_ack} unpriced runs acknowledged by a human`);
      }
    }
    const resumeTo: TaskState = task.resume_state === '' ? 'RUNNING' : task.resume_state;
    task.resume_state = '';
    const resumed = applyTransition(task, resumeTo, {
      reason: resumeTo === 'RUNNING' ? 'approved by human' : RESUME_REASON,
    });
    await saveTaskAndIndex(resumed);
    this.logTransition(resumed, 'APPROVAL', resumeTo, 'pass', '');
    void this.start(id);
    return { ok: true, error: '' };
  }

  /**
   * A human answering a parked question is exactly the signal §3.2 wants
   * counted: a gate did not catch what a human had to point out. It increments
   * human_touches and lands in the gate log with human_intervened set.
   */
  async answer(id: string, text: string, source: TaskSource = 'cli'): Promise<{ ok: boolean; error: string }> {
    const task = loadTask(id);
    if (!task) return { ok: false, error: `no such task ${id}` };
    if (isTerminal(task.state)) return { ok: false, error: `task ${id} is ${task.state}` };
    task.answers.push(source === 'telegram' ? `[telegram] ${text}` : text);
    task.human_touches += 1;
    task.pending_question = '';
    saveTask(task);
    logGate({
      project: task.project,
      issue: task.issue,
      lane: task.envelope?.lane ?? 'unsized',
      gate: 'human-answer',
      gate_family: 'deterministic',
      verdict: 'caught',
      attempt: task.attempt,
      cost_usd: 0,
      caught: text.slice(0, 300),
      review_depth: task.review_depth,
      human_intervened: true,
    });
    return { ok: true, error: '' };
  }

  /**
   * Marking the record FAILED does not stop the child: an SDK query left
   * running keeps spending until its turn budget is gone. A kill switch on a
   * phone that only relabels a task is not a kill switch, so the in-flight
   * query is aborted too.
   */
  async stop(id: string): Promise<{ ok: boolean; error: string }> {
    const task = loadTask(id);
    if (!task) return { ok: false, error: `no such task ${id}` };
    abortTask(id);
    if (isTerminal(task.state)) return { ok: true, error: '' };
    this.stopRequested.add(id);
    await this.terminate(task, 'FAILED', 'stopped by user');
    return { ok: true, error: '' };
  }

  /** §6.8 kill switch. Reachable from a phone. */
  async stopAll(): Promise<number> {
    const live = listTasks().filter((t) => !isTerminal(t.state));
    for (const task of live) await this.stop(task.id);
    return live.length;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * `opts.scope` overrides the project root for one run. The chain gates use
   * it to sit in the task's own worktree; nothing else passes it.
   */
  private async spawn(
    task: TaskRecord,
    role: AgentRole,
    prompt: string,
    port: SpawnPort,
    opts: { readOnly?: boolean; extraTools?: string[]; scope?: string } = {},
  ) {
    const cfg = loadConfig();
    const modelAlias = modelForRole(role, { lane: task.envelope?.lane, attempt: task.attempt, cfg });
    const req: SpawnRequest = {
      role,
      taskId: task.id,
      project: task.project,
      issue: task.issue,
      scope: opts.scope ?? task.scope,
      source: task.source,
      prompt,
      modelAlias,
      lane: task.envelope?.lane,
      attempt: task.attempt,
      signal: signalForTask(task.id),
      allowedTools: opts.readOnly ? [...READ_ONLY_TOOLS, ...(opts.extraTools ?? [])] : undefined,
      disallowedTools: opts.readOnly ? [...READ_ONLY_DISALLOWED] : undefined,
    };
    const startedAt = new Date().toISOString();
    const result = await port.run(req);
    const current = loadTask(task.id) ?? task;
    current.run_started_at = startedAt;
    current.agents.push({
      role,
      model: result.model || modelAlias,
      session: result.sessionId,
      status: result.exitReason === 'success' ? 'done' : 'dead',
      started_at: startedAt,
      ended_at: new Date().toISOString(),
    });
    current.cost_usd_actual = round6(current.cost_usd_actual + result.costUsd);
    if (!result.costKnown) current.cost_unmeasured_runs = unmeasuredRuns(current) + 1;
    if (result.worktreeCreated) current.worktree_created = true;
    if (!result.worktreeCreated && !transportFailed(result.exitReason) && current.worktree_created === undefined) {
      const isolationLine = `runner isolation: none; using main checkout ${path.resolve(req.scope)}`;
      if (!current.report_lines.includes(isolationLine)) current.report_lines.push(isolationLine);
    }
    saveTask(current);
    return result;
  }

  /**
   * §10.1 — the one rule with nothing behind it. If an agent says it needs an
   * irreversible step, the task stops here and a human is asked. There is no
   * source, lane, or config that skips this.
   */
  private async parkIfIrreversible(task: TaskRecord, irreversible: string[]): Promise<boolean> {
    if (irreversible.length === 0) return false;
    const action = irreversible[0];
    const detail =
      irreversible.length > 1
        ? `${irreversible.length} irreversible steps requested: ${irreversible.join('; ')}`
        : `irreversible step requested: ${action}`;
    await this.parkForApproval(task, action, detail);
    return true;
  }

  private async parkIfChainIrreversible(task: TaskRecord, chain: ChainRun): Promise<boolean> {
    const irreversible = [...new Set(chain.runs.flatMap((run) => run.verdict?.irreversible ?? []))];
    return this.parkIfIrreversible(task, irreversible);
  }

  /**
   * The review lane's oracle fault, which it did not have.
   *
   * VERIFYING already parks when its oracle could not run. REVIEW had no such
   * check: with codex uninstalled every gate took the transport path, the texts
   * differed so nothing cross-confirmed, the outcome was `warn`, and the task
   * landed REPORTED with `ok: true` and a green tick on the phone — a task whose
   * review never happened, reported as a reviewed one.
   *
   * `ensemble.measured` cannot stand in for this. It counts ROWS, and a row
   * saying "this gate never ran" counts exactly as well as a real verdict.
   */
  private async parkIfReviewDidNotRun(
    task: TaskRecord,
    chain: ChainRun,
    ensemble: { broken: string[]; answered: number },
  ): Promise<boolean> {
    const unavailable = chain.runs.filter((run) => run.unavailable).map((run) => run.gate);
    if (unavailable.length === 0 && ensemble.broken.length === 0) return false;
    const gates = [...new Set([...unavailable, ...ensemble.broken])];
    const detail =
      ensemble.answered === 0
        ? `no review gate returned a judgement (${gates.join(', ')}); nothing reviewed this diff`
        : `${gates.join(', ')} did not return a judgement, so the review is incomplete`;
    await this.parkForApproval(task, APPROVAL_ORACLE, detail);
    return true;
  }

  /**
   * Everything a chain gate is allowed to know, assembled here rather than by
   * handing the chain a task record. spec-check is the reason (see
   * SpecCheckInput): the record carries the builder's own account of its work
   * in five different fields, and a chain that could reach it would leak that
   * account into the one gate whose value depends on never having seen it.
   *
   * The gates are also spawned INTO the task's worktree, not into the project
   * root. `scope` is the write fence as well as the cwd (see spawn.ts), and a
   * report-only gate that can only read is safer fenced to the one directory
   * this task owns than to the shared checkout every other lane is editing.
   */
  private chainContext(task: TaskRecord, envelope: NonNullable<TaskRecord['envelope']>, hasRealBrowser: boolean): ChainContext {
    const workdir = resolveTaskWorkdir(task.id, task.scope, task.worktree_created !== undefined);
    return {
      project: task.project,
      issue: task.issue,
      scope: task.scope,
      workdir,
      envelope,
      attempt: task.attempt,
      reviewDepth: task.review_depth,
      rootCause: task.root_cause,
      hasRealBrowser,
      exec: this.exec,
      diff: this.diff,
      spawn: async (req) => {
        const port = req.role === 'judge' ? this.spawnPort : this.reviewPort;
        const result = await this.spawn(task, req.role, req.prompt, port, {
          readOnly: req.readOnly,
          extraTools: req.extraTools ?? [],
          scope: workdir.dir,
        });
        return {
          output: result.output,
          outputs: result.outputs,
          costUsd: result.costUsd,
          costKnown: result.costKnown,
          exitReason: result.exitReason,
          model: result.model,
          family: gateFamily(req.role, result.model),
        };
      },
    };
  }

  /**
   * Folds a chain run into the record. The gate rows were already written by
   * the chain — this does not re-log them, it carries their findings, their
   * advisories, their assumptions and their questions into the task.
   *
   * Advisories land in their own field and never become findings. A reviewer
   * asked to look for problems will always return some, and workflow.md B4 is
   * explicit that only a finding touching correctness earns a round trip.
   */
  private absorbChain(task: TaskRecord, chain: ChainRun, sink: 'verify' | 'report'): TaskRecord {
    this.recordReports(task, chain.reports, chain.runs.map((run) => run.gate));
    for (const advisory of chain.advisories) {
      if (!task.advisories.includes(advisory)) task.advisories.push(advisory);
    }
    const lines = sink === 'verify' ? task.verify_lines : task.report_lines;
    for (const line of chain.lines) lines.push(line);

    const questions: string[] = [];
    for (const run of chain.runs) {
      for (const outcome of run.assert?.outcomes ?? []) {
        task.assert_runs.push(assertRunRecord(task.attempt, outcome));
      }
      for (const assumption of run.verdict?.assumptions ?? []) {
        if (!task.assumptions.includes(assumption)) task.assumptions.push(assumption);
      }
      for (const question of run.verdict?.questions ?? []) questions.push(`${run.gate}: ${question}`);
    }
    task.assumption_count = Math.max(task.assumption_count, task.assumptions.length);
    if (questions.length > 0) {
      task.pending_question = questions.join(' | ');
      emit({ type: 'question', taskId: task.id, project: task.project, issue: task.issue, text: task.pending_question });
    }
    saveTask(task);
    return task;
  }

  /**
   * Folds an agent verdict into the record and writes one gate-log row per gate.
   *
   * Family verification runs FIRST, and rewrites `verdict.gates` in place, so
   * the demoted family is what lands in the gate log, in `findings`, and in the
   * ensemble rule. Logging the agent's own claim before checking it would let
   * the row it just wrote vouch for the next claim.
   */
  private absorbVerdict(task: TaskRecord, verdict: AgentVerdict): TaskRecord {
    const claimed = verdict.gates.filter((gate) => MANAGER_OWNED_GATES.includes(gate.gate));
    for (const gate of claimed) {
      task.report_lines.push(`dropped agent-claimed gate "${gate.gate}": the manager runs that one itself`);
    }
    verdict.gates = verifyDeterministicGates(
      verdict.gates.filter((gate) => !MANAGER_OWNED_GATES.includes(gate.gate)),
      {
        project: task.project,
        since: task.run_started_at || task.created_at,
        until: new Date().toISOString(),
      },
    );
    if (verdict.root_cause && !task.root_cause) task.root_cause = verdict.root_cause;
    for (const advisory of verdict.advisories) {
      if (!task.advisories.includes(advisory)) task.advisories.push(advisory);
    }
    for (const gate of verdict.gates) {
      logGate({
        project: task.project,
        issue: task.issue,
        lane: task.envelope?.lane ?? 'unsized',
        gate: gate.gate,
        gate_family: gate.gate_family,
        verdict: gate.verdict,
        attempt: task.attempt,
        cost_usd: 0,
        caught: gate.caught,
        review_depth: task.review_depth,
        human_intervened: false,
      });
    }
    this.recordReports(task, verdict.gates, verdict.gates.map((gate) => gate.gate));
    for (const assumption of verdict.assumptions) {
      if (!task.assumptions.includes(assumption)) task.assumptions.push(assumption);
    }
    task.assumption_count = Math.max(task.assumption_count, task.assumptions.length);
    if (verdict.questions.length > 0) {
      task.pending_question = verdict.questions.join(' | ');
      emit({
        type: 'question',
        taskId: task.id,
        project: task.project,
        issue: task.issue,
        text: task.pending_question,
      });
    }
    saveTask(task);
    return task;
  }

  /**
   * Records what a gate said, replacing whatever that same gate said earlier in
   * the same attempt. Re-running a gate supersedes its previous answer: a task
   * parked because no test command was registered, then approved once one was,
   * must not still be carrying the failure that parked it.
   *
   * `findings` is derived here rather than appended to, so the two can never
   * disagree about what is currently true.
   */
  private recordReports(task: TaskRecord, reports: GateReport[], gates: string[]): void {
    task.gate_reports = task.gate_reports.filter(
      (row) => !(row.attempt === task.attempt && gates.includes(row.gate)),
    );
    for (const report of reports) {
      task.gate_reports.push({ ...report, attempt: task.attempt });
      if (!task.gates_run.includes(report.gate)) task.gates_run.push(report.gate);
    }
    task.findings = task.gate_reports
      .filter((row) => row.verdict === 'caught' || row.verdict === 'error')
      .map((row) => ({
        gate: row.gate,
        gate_family: row.gate_family,
        text: row.caught || row.verdict,
        attempt: row.attempt,
      }));
  }

  /**
   * What the ensemble judges: every gate row this attempt produced, plus the
   * hook rows the harness wrote during the run.
   *
   * The manager's own rows come from the record, not from the gate log. The
   * log is append-only by design, so a re-run leaves the superseded row in
   * place forever and replaying it would keep failing a gate that has since
   * passed. Hook rows have no other source, so those are read from the log,
   * bounded to this attempt's window.
   */
  private collectGateReports(task: TaskRecord, latest: GateReport[]): GateReport[] {
    const historical: GateReport[] = task.gate_reports
      .filter((row) => row.attempt === task.attempt)
      .map((row) => ({
        gate: row.gate,
        gate_family: row.gate_family,
        verdict: row.verdict,
        caught: row.caught,
        family: row.family,
      }));
    const window = {
      project: task.project,
      since: task.attempt_started_at || task.created_at,
      until: new Date().toISOString(),
      attempt: task.attempt,
    };
    const evidence = collectLoggedGates(window, BLOCKING_HOOK_GATES);
    const seen = new Set(historical.map((g) => `${g.gate}|${g.caught}`));
    for (const gate of [...evidence, ...latest]) {
      const key = `${gate.gate}|${gate.caught}`;
      if (!seen.has(key)) {
        historical.push(gate);
        seen.add(key);
      }
    }
    return historical;
  }

  /** Ceiling check runs BEFORE a spawn: a breach found after the fact is money already gone. */
  /**
   * The one place §6.5's ceilings are enforced.
   *
   * It calls checkTaskCeiling rather than re-deriving the comparison. The two
   * used to be separate, and the copy here was the only one that ran — so
   * `CeilingVerdict.partial`, the flag that says the spend it compared was
   * missing an unpriced run, was computed by a function with no callers.
   *
   * `partial` gets a bound of its own because the dollar ceiling cannot give it
   * one: codex spends CLI quota, so those runs are invisible to every figure
   * here however large they grow.
   */
  private preflightBudget(task: TaskRecord, cfg: ManagerConfig = loadConfig()): { ok: boolean; reason: string } {
    const ceiling = checkTaskCeiling(task);
    if (!ceiling.ok) return { ok: false, reason: ceiling.reason };
    const unacknowledged = unmeasuredRuns(task) - (task.cost_unmeasured_ack ?? 0);
    if (ceiling.partial && unacknowledged >= cfg.maxUnmeasuredRunsPerTask) {
      return {
        ok: false,
        reason: `${unacknowledged} runs on this task were never priced (cap ${cfg.maxUnmeasuredRunsPerTask}); the spend ceiling cannot see what they cost`,
      };
    }
    const day = checkDayCeiling(listTasks(), cfg);
    if (!day.ok) return { ok: false, reason: day.reason };
    return { ok: true, reason: '' };
  }

  /**
   * Parks the task and asks a human. `action` is the short label the phone
   * shows on the button; `detail` is the sentence under it. A park from a
   * state later than SIZED remembers where to come back to, so approving does
   * not silently re-run a phase that already cost money.
   */
  private async parkForApproval(
    task: TaskRecord,
    action: string,
    detail: string,
    questions: string[] = [],
  ): Promise<void> {
    const from = task.state;
    const parked = applyTransition(task, 'APPROVAL', {
      reason: detail,
      reportLine: `waiting on a human: ${detail}`,
    });
    parked.pending_question = questions.join(' | ');
    parked.pending_action = action;
    parked.resume_state = from === 'SIZED' || from === 'INTAKE' ? '' : from;
    await saveTaskAndIndex(parked);
    await release(projectLock(parked.project), parked.id);
    this.logTransition(parked, from, 'APPROVAL', 'pass', detail);
    emit(buildApprovalEvent(parked, action, detail));
  }

  /**
   * First terminal state wins. A phase that was already in flight when the
   * task was stopped keeps running to its own conclusion, and without this
   * guard its verdict overwrites the stop — a task killed from a phone would
   * report "envelope rejected" instead of "stopped by user", and the abort
   * would look like it had not worked.
   */
  private async terminate(task: TaskRecord, to: TaskState, why: string): Promise<void> {
    const current = loadTask(task.id) ?? task;
    if (isTerminal(current.state)) return;
    const from = current.state;
    const ended = applyTransition(current, to, { reason: why, failureReason: why });
    await saveTaskAndIndex(ended);
    await releaseAll(ended.id);
    clearTaskAbort(ended.id);
    this.logTransition(ended, from, to, to === 'REJECTED' ? 'skipped' : 'error', why);
    this.emitReport(ended);
  }

  private emitReport(task: TaskRecord): void {
    emit(buildReportEvent(task, task.state === 'REPORTED', statusLine(task)));
  }

  /**
   * Every state change lands in the gate log. The `gate` field carries
   * `lifecycle:FROM->TO` so lifecycle rows are greppable and never collide
   * with the oracle gate names in §3.3.
   */
  private logTransition(
    task: TaskRecord,
    from: TaskState,
    to: TaskState,
    verdict: 'pass' | 'caught' | 'error' | 'skipped',
    caught: string,
  ): void {
    logGate({
      project: task.project,
      issue: task.issue,
      lane: task.envelope?.lane ?? 'unsized',
      gate: `lifecycle:${from}->${to}`,
      gate_family: 'deterministic',
      verdict,
      attempt: task.attempt,
      cost_usd: task.cost_usd_actual,
      caught,
      review_depth: task.review_depth,
      human_intervened: false,
    });
  }
}

/**
 * Which family answered a gate.
 *
 * A judge runs on the spawn port, so its family is READ from the model the
 * runner reported. The review port's is ASSERTED from the provider table —
 * `codex exec` picks its model from the operator's own `~/.codex/` config and
 * never tells us which, so claiming otherwise would be a fabricated
 * observation.
 */
export function gateFamily(role: AgentRole, model: string): string {
  if (role === 'judge') return familyOfModel(model);
  return REVIEW_PROVIDER_FAMILY[resolveReviewProvider(loadConfig())];
}

/**
 * The durable count §7.4 asks for. The gate log's §3.3 schema has no field for
 * "how many tests actually ran", so it lives on the task record instead — one
 * row per command per attempt, with the exit code beside it, because the two
 * numbers only mean something read together.
 */
function assertRunRecord(attempt: number, outcome: { run: AssertRun; state: AssertRunRecord['state'] }): AssertRunRecord {
  return {
    attempt,
    cmd: outcome.run.cmd,
    kind: outcome.run.kind,
    exit_code: outcome.run.exit_code,
    timed_out: outcome.run.timed_out,
    ran: outcome.run.ran,
    skipped: outcome.run.skipped,
    total: outcome.run.total,
    state: outcome.state,
  };
}

/** One line a human reads on a phone to know what happens next. */
function statusLine(task: TaskRecord): string {
  switch (task.state) {
    case 'REPORTED':
      return task.blind_sample
        ? 'staged, drawn for a full-diff read before you close it'
        : 'staged, waiting for you to commit';
    case 'BLOCKED':
      return `blocked: ${task.failure_reason}`;
    case 'REJECTED':
      return 'rejected, nothing was run';
    case 'FAILED':
      return `stopped: ${task.failure_reason}`;
    default:
      return task.state.toLowerCase();
  }
}

export function activeTaskIds(): Set<string> {
  return new Set(listTasks().filter((t) => ACTIVE_STATES.includes(t.state) || t.state === 'APPROVAL').map((t) => t.id));
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
