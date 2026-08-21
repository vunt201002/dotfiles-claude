/**
 * `cmuxSpawnPort` — an agent in a pane the operator can watch and take over.
 *
 * Same `SpawnPort` contract as the SDK and `claude -p` ports, so the
 * orchestrator does not know which one it has. What changes is where the work
 * happens: a cmux workspace, in a git worktree that belongs to exactly one
 * task, with `GSTACK_MANAGER_SCOPE` set in the pane's environment so the
 * pre-tool-use guard fences it the same way it fences an SDK child.
 *
 * ## What it does not do
 *
 * It does not route every role through cmux. Report-only gates are short,
 * headless, and have no tools to watch; a pane each would bury the one pane
 * that matters under five that do not. Only the roles in `cmuxRoles` get a
 * pane, and everything else is delegated to the SDK port — which is also what
 * keeps the review transport (§6.4) independent of this file.
 *
 * ## The three numbers §6.2 said a terminal could not produce
 *
 * Concurrency comes from counting live sessions in cmux's own store, which is
 * strictly better than the SDK semaphore because it also sees panes the
 * operator opened by hand. Completion comes from `agentLifecycle` cross-checked
 * against the pid. Cost comes from the transcript. None of the three is a
 * self-report by the agent being measured (§7.3b lesson 2).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfig, resolveMaxAgents, resolveModelId } from '../config';
import { measuredCost } from './cost';
import {
  buildLaunchCommand,
  closeWorkspace,
  cmuxAvailable,
  createWorkspace,
  readScreen,
  sleep,
  waitForSession,
  writePromptFile,
} from './cmux-control';
import { busyCount, fleet, healthOf, needsHuman, usageFromTranscript, type SessionHealth } from './cmux-sessions';
import { atomicWriteJson, managerDir } from './paths';
import { agentSdkSpawnPort, scopeDirective, type SpawnPort, type SpawnRequest, type SpawnResult } from './spawn';
import { ensureTaskWorktree } from './worktrees';

/**
 * Where a task's prompt file and pane bookkeeping live. Outside the worktree
 * on purpose: the prompt is manager state, and a file inside the checkout
 * would show up in the task's own diff and in every review that reads it.
 */
export function paneStateDir(taskId: string, role: string): string {
  return path.join(managerDir(), 'panes', `${taskId}.${role}`);
}

export type PaneClosedState = 'yes' | 'no' | 'unknown';

export interface PaneRecord {
  workspaceRef: string;
  taskId: string;
  role: string;
  createdAt: string;
  fate: 'unrecorded' | 'ended';
  paneClosed: PaneClosedState;
  endedAt?: string;
  exitReason?: string;
}

export type PaneOwnership =
  | { ownership: 'manager'; workspaceRef: string; taskId: string; role: string; record: PaneRecord }
  | { ownership: 'unknown'; workspaceRef: string | null; recordFile?: string; reason?: string };

export function paneRecordFile(taskId: string, role: string): string {
  return path.join(paneStateDir(taskId, role), 'pane.json');
}

export function recordCreatedPane(workspaceRef: string, taskId: string, role: string): PaneRecord {
  const record: PaneRecord = {
    workspaceRef,
    taskId,
    role,
    createdAt: new Date().toISOString(),
    fate: 'unrecorded',
    paneClosed: 'unknown',
  };
  atomicWriteJson(paneRecordFile(taskId, role), record);
  return record;
}

export function recordEndedPane(record: PaneRecord, exitReason: string, paneClosed: PaneClosedState): PaneRecord {
  const ended: PaneRecord = {
    ...record,
    fate: 'ended',
    paneClosed,
    endedAt: new Date().toISOString(),
    exitReason,
  };
  atomicWriteJson(paneRecordFile(record.taskId, record.role), ended);
  return ended;
}

export async function recordPaneAndWaitForSession(
  workspaceRef: string,
  taskId: string,
  role: string,
  dir: string,
  opts: Parameters<typeof waitForSession>[1],
  waiter: typeof waitForSession = waitForSession,
): Promise<{ record: PaneRecord; session: Awaited<ReturnType<typeof waitForSession>> }> {
  const record = recordCreatedPane(workspaceRef, taskId, role);
  const session = await waiter(dir, opts);
  return { record, session };
}

function validPaneRecord(value: unknown): value is PaneRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Partial<PaneRecord>;
  return (
    typeof record.workspaceRef === 'string' &&
    typeof record.taskId === 'string' &&
    typeof record.role === 'string' &&
    typeof record.createdAt === 'string' &&
    (record.fate === 'unrecorded' || record.fate === 'ended') &&
    (record.paneClosed === 'yes' || record.paneClosed === 'no' || record.paneClosed === 'unknown')
  );
}

export function readPaneOwnership(workspaceRefs: readonly string[] = []): PaneOwnership[] {
  const panesDir = path.join(managerDir(), 'panes');
  let entries: fs.Dirent[] = [];
  let unreadableDir = '';
  try {
    entries = fs.readdirSync(panesDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') unreadableDir = String(error);
    if (unreadableDir && workspaceRefs.length === 0) {
      return [{ ownership: 'unknown', workspaceRef: null, recordFile: panesDir, reason: unreadableDir }];
    }
    entries = [];
  }
  const owned = new Map<string, PaneRecord[]>();
  const unreadable: PaneOwnership[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const recordFile = path.join(panesDir, entry.name, 'pane.json');
    let record: unknown;
    try {
      record = JSON.parse(fs.readFileSync(recordFile, 'utf-8'));
    } catch (error) {
      unreadable.push({ ownership: 'unknown', workspaceRef: null, recordFile, reason: String(error) });
      continue;
    }
    if (validPaneRecord(record)) {
      const records = owned.get(record.workspaceRef) ?? [];
      records.push(record);
      owned.set(record.workspaceRef, records);
    } else {
      unreadable.push({ ownership: 'unknown', workspaceRef: null, recordFile, reason: 'pane record is malformed' });
    }
  }
  if (workspaceRefs.length === 0) {
    const records = [...owned.values()].flat().map(
      (record): PaneOwnership => ({
        ownership: 'manager',
        workspaceRef: record.workspaceRef,
        taskId: record.taskId,
        role: record.role,
        record,
      }),
    );
    return [...records, ...unreadable];
  }
  return workspaceRefs.map((workspaceRef): PaneOwnership => {
    const records = owned.get(workspaceRef) ?? [];
    if (records.length === 0) {
      return unreadableDir
        ? { ownership: 'unknown', workspaceRef, recordFile: panesDir, reason: unreadableDir }
        : { ownership: 'unknown', workspaceRef };
    }
    if (records.length > 1) return { ownership: 'unknown', workspaceRef, reason: 'multiple pane records claim this workspace ref' };
    const record = records[0];
    return {
      ownership: 'manager',
      workspaceRef,
      taskId: record.taskId,
      role: record.role,
      record,
    };
  });
}

/**
 * Whether the write fence is actually installed on this machine.
 *
 * A cmux pane runs a real `claude` with the operator's settings, so
 * `--dangerously-skip-permissions` is only defensible when the pre-tool-use
 * guard is there to catch what the permission prompt would have. §7.3b lesson
 * 1 is that a directive is not a fence; this is the check that the fence
 * exists before the directive is trusted to stand in for it.
 */
export function guardIsWired(settingsFile = path.join(os.homedir(), '.claude', 'settings.json')): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
  } catch {
    return false;
  }
  const pre = (parsed as { hooks?: { PreToolUse?: unknown } })?.hooks?.PreToolUse;
  if (!Array.isArray(pre)) return false;
  for (const entry of pre) {
    const matcher = String((entry as { matcher?: unknown })?.matcher ?? '');
    const hooks = (entry as { hooks?: unknown })?.hooks;
    if (!Array.isArray(hooks)) continue;
    const guards = hooks.some((h) => /pre-tool-use-guard/.test(String((h as { command?: unknown })?.command ?? '')));
    if (guards && /Edit/.test(matcher) && /Write/.test(matcher)) return true;
  }
  return false;
}

function childEnv(req: SpawnRequest, scope: string): Record<string, string> {
  return {
    GSTACK_MANAGER_TASK: req.taskId,
    GSTACK_MANAGER_PROJECT: req.project,
    GSTACK_MANAGER_SCOPE: scope,
    GSTACK_MANAGER_SOURCE: req.source,
    GSTACK_MANAGER_ROLE: req.role,
  };
}

/** The last thing the agent said, which is what the orchestrator parses. */
export function lastAssistantText(transcriptPath: string): string {
  let raw: string;
  try {
    raw = fs.readFileSync(transcriptPath, 'utf-8');
  } catch {
    return '';
  }
  let last = '';
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const record = entry as { type?: string; message?: { content?: unknown } };
    if (record.type !== 'assistant') continue;
    const content = record.message?.content;
    if (!Array.isArray(content)) continue;
    const text = content
      .filter((b) => (b as { type?: string })?.type === 'text')
      .map((b) => String((b as { text?: unknown }).text ?? ''))
      .join('');
    if (text.trim()) last = text;
  }
  return last;
}

export function assistantTexts(transcriptPath: string): string[] {
  let raw: string;
  try {
    raw = fs.readFileSync(transcriptPath, 'utf-8');
  } catch {
    return [];
  }
  const outputs: string[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const record = entry as { type?: string; message?: { content?: unknown } };
    if (record.type !== 'assistant') continue;
    const content = record.message?.content;
    if (!Array.isArray(content)) continue;
    const text = content
      .filter((block) => (block as { type?: string })?.type === 'text')
      .map((block) => String((block as { text?: unknown }).text ?? ''))
      .join('');
    if (text.trim()) outputs.unshift(text);
  }
  return outputs;
}

export interface WatchOutcome {
  health: SessionHealth | 'never-started' | 'aborted' | 'timeout';
  /** Set once the session was observed doing work, so idle-at-boot is not read as done. */
  everWorked: boolean;
  turns: number;
  transcriptPath: string;
}

/**
 * Waits for a pane to reach a state worth reporting.
 *
 * `idle` is only accepted after the session has been seen `working` at least
 * once. A freshly-hooked session is idle for the moment between registering
 * and receiving its first turn, and a watcher that trusted that would hand
 * back an empty transcript as a successful run — the exact shape of a
 * measurement that looks fine and is not.
 */
export async function watchSession(
  dir: string,
  opts: {
    timeoutMs: number;
    startupMs: number;
    needsInputGraceMs: number;
    pollMs?: number;
    signal?: AbortSignal;
    agent?: string;
    home?: string;
  },
): Promise<WatchOutcome> {
  const pollMs = opts.pollMs ?? 1_000;
  const started = Date.now();
  let everWorked = false;
  let needsInputSince = 0;
  let transcriptPath = '';
  let turns = 0;

  while (true) {
    if (opts.signal?.aborted) {
      return { health: 'aborted', everWorked, turns, transcriptPath };
    }
    const session = fleet(opts.agent, opts.home).find((s) => s.cwd && path.resolve(s.cwd) === path.resolve(dir));
    if (session) {
      transcriptPath = session.transcriptPath || transcriptPath;
      const health = healthOf(session);
      if (health === 'working') {
        everWorked = true;
        needsInputSince = 0;
      } else if (needsHuman(health)) {
        // A pane stuck on a permission prompt is not "running" no matter what
        // the lifecycle field says, and waiting out the full run timeout on
        // one costs 45 minutes to learn what was true in the first second.
        everWorked = true;
        if (!needsInputSince) needsInputSince = Date.now();
        if (Date.now() - needsInputSince >= opts.needsInputGraceMs) {
          return { health, everWorked, turns, transcriptPath };
        }
      } else if (health === 'finished') {
        if (everWorked) return { health: 'finished', everWorked, turns, transcriptPath };
      } else {
        return { health, everWorked, turns, transcriptPath };
      }
    }
    if (!everWorked && Date.now() - started >= opts.startupMs) {
      return { health: 'never-started', everWorked, turns, transcriptPath };
    }
    if (Date.now() - started >= opts.timeoutMs) {
      return { health: 'timeout', everWorked, turns, transcriptPath };
    }
    if (transcriptPath) turns = usageFromTranscript(transcriptPath).turns;
    await sleep(pollMs);
  }
}

const EXIT_REASON: Record<string, string> = {
  finished: 'success',
  waiting: 'needs_input',
  blocked: 'blocked_on_permission',
  crashed: 'crashed',
  gone: 'pane_closed',
  aborted: 'aborted',
  timeout: 'timeout',
  'never-started': 'never_started',
  working: 'timeout',
};

export type SlotOutcome = 'free' | 'aborted' | 'timeout';

/**
 * Blocks until the fleet has room.
 *
 * The count includes panes the manager did not start, which is the point: a
 * cap that only knew about the manager's own spawns would let an operator
 * working in three panes push the machine to eleven concurrent agents while
 * every number the manager reported said eight.
 *
 * Counting the operator's panes is also why this has to time out. The
 * manager's own spawns eventually finish and free their seats; an operator
 * with the cap's worth of panes open does not, and an unbounded wait there is
 * a task that never starts and never says why. The timeout turns that into a
 * reported failure naming the cap, which is something a human can act on.
 */
export async function waitForSlot(
  cap: number,
  opts: { signal?: AbortSignal; pollMs?: number; timeoutMs?: number; home?: string; abandonedAfterMs?: number } = {},
): Promise<SlotOutcome> {
  const deadline = Date.now() + (opts.timeoutMs ?? 30 * 60_000);
  const pollMs = opts.pollMs ?? 2_000;
  const abandonedAfterMs = opts.abandonedAfterMs ?? loadConfig().abandonedPaneAfterMs;
  while (true) {
    if (opts.signal?.aborted) return 'aborted';
    if (busyCount(fleet('claude', opts.home), Date.now(), abandonedAfterMs) < cap) return 'free';
    if (Date.now() >= deadline) return 'timeout';
    await sleep(pollMs);
  }
}

/**
 * A refusal BEFORE anything launched. Nothing ran, so the zero is measured.
 */
function refusal(reason: string, detail: string): SpawnResult {
  return {
    output: detail,
    outputs: [],
    exitReason: reason,
    turnsUsed: 0,
    costUsd: 0,
    costKnown: true,
    model: 'cmux',
    sessionId: '',
    durationMs: 0,
    worktreeCreated: false,
  };
}

/**
 * A failure AFTER the launch was attempted, where a pane may be alive.
 *
 * `createWorkspace` returns no ref both when cmux refused and when cmux
 * SUCCEEDED but its ref line did not parse — and in the second case the pane is
 * open and `claude --dangerously-skip-permissions` is already running. Reporting
 * a measured zero there is the fabricated-zero bug in the one place an agent is
 * genuinely spending, and with no ref there is nothing to close it with either.
 */
function launchFailure(reason: string, detail: string): SpawnResult {
  return { ...refusal(reason, detail), costKnown: false };
}

export const cmuxSpawnPort: SpawnPort = {
  async run(req) {
    const cfg = loadConfig();
    if (!cfg.cmuxRoles.includes(req.role)) return agentSdkSpawnPort.run(req);
    if (!cmuxAvailable()) {
      return refusal(
        'cmux_unavailable',
        'cmux is not answering on its socket, so no pane could be opened. Start the cmux app, or set MANAGER_SPAWN_RUNNER to sdk.',
      );
    }
    if (cfg.cmuxSkipPermissions && !guardIsWired()) {
      return refusal(
        'guard_not_wired',
        'refusing to launch a permission-skipping pane: the pre-tool-use guard is not installed in ~/.claude/settings.json, so nothing would stop a write outside the task scope.',
      );
    }

    const worktree = ensureTaskWorktree(req.taskId, req.project, req.scope, { links: cfg.worktreeLinks });
    if (!worktree.ok || !worktree.record) {
      return refusal('worktree_failed', `could not prepare a worktree for ${req.taskId}: ${worktree.reason}`);
    }
    const dir = worktree.record.dir;
    const worktreeCreated = true as const;

    const cap = resolveMaxAgents(cfg);
    const slot = await waitForSlot(cap, { signal: req.signal, timeoutMs: cfg.cmuxSlotWaitMs });
    if (slot === 'aborted') return { ...refusal('aborted', 'stopped while waiting for a free agent slot'), worktreeCreated };
    if (slot === 'timeout') {
      return {
        ...refusal(
          'no_free_slot',
          `all ${cap} agent slots were still busy after waiting. Panes you opened yourself count toward the cap — close one, or raise maxAgents.`,
        ),
        worktreeCreated,
      };
    }

    const stateDir = paneStateDir(req.taskId, req.role);
    const promptFile = writePromptFile(stateDir, `${scopeDirective({ ...req, scope: dir })}\n\n---\n\n${req.prompt}`);
    const extraArgs = [...cfg.cmuxClaudeArgs];
    if (cfg.cmuxSkipPermissions) extraArgs.push('--dangerously-skip-permissions');

    const startedAt = Date.now();
    const created = createWorkspace({
      name: `${req.project}/${req.taskId}:${req.role}`,
      cwd: dir,
      env: childEnv(req, dir),
      focus: false,
      command: buildLaunchCommand({
        claudeBin: cfg.cmuxClaudeBin,
        promptFile,
        model: resolveModelId(req.modelAlias),
        extraArgs,
      }),
    });
    if (!created.ok) {
      return {
        ...launchFailure(
          'cmux_create_failed',
          `cmux did not hand back a workspace ref: ${created.reason}. A pane may be open and running unattended; check cmux and close it by hand.`,
        ),
        worktreeCreated,
      };
    }

    const recorded = await recordPaneAndWaitForSession(created.ref, req.taskId, req.role, dir, {
      timeoutMs: cfg.cmuxStartupMs,
      startedAfter: startedAt / 1000,
    });
    const paneRecord = recorded.record;
    const booted = recorded.session;
    const outcome = await watchSession(dir, {
      timeoutMs: cfg.cmuxRunTimeoutMs,
      startupMs: cfg.cmuxStartupMs,
      needsInputGraceMs: cfg.cmuxNeedsInputGraceMs,
      signal: req.signal,
    });

    const transcriptPath = outcome.transcriptPath || booted?.transcriptPath || '';
    const usage = transcriptPath ? usageFromTranscript(transcriptPath) : null;
    const output = transcriptPath ? lastAssistantText(transcriptPath) : '';
    const outputs = transcriptPath ? assistantTexts(transcriptPath) : [];
    const exitReason = EXIT_REASON[outcome.health] ?? outcome.health;
    const cost = measuredCost(
      {
        input_tokens: usage?.inputTokens ?? 0,
        output_tokens: usage?.outputTokens ?? 0,
        cache_read_input_tokens: usage?.cacheReadTokens ?? 0,
        cache_creation_input_tokens: usage?.cacheCreationTokens ?? 0,
      },
      usage?.model ?? '',
    );

    // A pane that finished cleanly has nothing left to show; one that failed
    // is the operator's only account of what happened, so it stays open and
    // its screen is carried back as the run's output.
    //
    // `aborted` is the exception, and it is not a style choice. §6.8's kill
    // switch is reachable from a phone, and a stop that only stopped WATCHING
    // would leave the agent editing files and spending money with nothing left
    // observing it. Closing the workspace is what actually ends the process,
    // so stop has to mean stop even though it costs the post-mortem.
    const aborted = exitReason === 'aborted';
    const keepOpen = exitReason !== 'success' && !aborted;
    const screenResult = keepOpen ? readScreen(created.ref, 120) : null;
    const screen = screenResult?.ok ? screenResult.screen : '';
    const shouldClose = aborted || (!keepOpen && cfg.cmuxCloseOnSuccess);
    const paneClosed: PaneClosedState = shouldClose ? (closeWorkspace(created.ref).ok ? 'yes' : 'unknown') : 'no';
    recordEndedPane(paneRecord, exitReason, paneClosed);

    return {
      output:
        output ||
        screen ||
        (screenResult && !screenResult.ok
          ? `cmux pane ${created.ref} ended as "${exitReason}": screen was unreadable (${screenResult.error})`
          : `cmux pane ${created.ref} ended as "${exitReason}" with nothing in its transcript.`),
      outputs,
      exitReason,
      turnsUsed: usage?.turns ?? 0,
      costUsd: cost.usd,
      costKnown: cost.known,
      model: cost.model || resolveModelId(req.modelAlias),
      sessionId: booted?.sessionId ?? '',
      durationMs: Date.now() - startedAt,
      worktreeCreated,
    };
  },
};
