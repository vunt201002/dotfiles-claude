/**
 * The write side of cmux. `cmux-sessions.ts` is the read side.
 *
 * Kept apart on purpose: reading the session store is safe from anywhere and
 * happens in a poll loop, while everything here changes the operator's live
 * terminal. Two files means a caller has to opt in to the second.
 *
 * ## Why a pane at all
 *
 * §6.2 chose the SDK runner over driving a terminal, and for a headless gate
 * that is still right. But the operator's actual work now happens in cmux
 * panes, and a manager that spawns somewhere else produces agents the operator
 * cannot watch, cannot interrupt, and cannot take over mid-task. The
 * measurement objections that made §6.2 refuse a GUI terminal do not apply
 * here — cmux records lifecycle, cwd, pid, and a transcript path — so what is
 * left is the plain advantage of the work being visible.
 *
 * ## The one rule about `send`
 *
 * `cmux send` types characters into a TUI. It is not an API call. Sending
 * while the agent is mid-turn injects text into a running turn, and sending a
 * string with a newline in it submits early. So: the initial prompt is NEVER
 * typed — it is written to a file and read by the launch command — and
 * `sendText` refuses unless the session is idle.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { readCmuxSessions, type CmuxSession } from './cmux-sessions';

const CMUX_BIN = process.env.MANAGER_CMUX_BIN?.trim() || 'cmux';

export interface CmuxRun {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/**
 * CMUX_QUIET silences the "this command is now an alias" notice cmux prints on
 * legacy spellings. Without it that notice lands on stdout and the ref parser
 * reads a sentence where it expects `OK workspace:21`.
 */
function cmux(args: string[], timeoutMs = 30_000): CmuxRun {
  const result = spawnSync(CMUX_BIN, args, {
    stdio: 'pipe',
    timeout: timeoutMs,
    encoding: 'utf-8',
    env: { ...process.env, CMUX_QUIET: '1' },
  });
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? String(result.error?.message ?? '')).trim(),
  };
}

export function runCmux(args: string[], timeoutMs?: number): CmuxRun {
  return cmux(args, timeoutMs);
}

/**
 * True only when the app is actually up, not merely installed.
 *
 * `cmux` on PATH with no running app answers every command with a socket
 * error, and a spawn port that took installation for availability would report
 * each of those as a failed agent run.
 */
export function cmuxAvailable(): boolean {
  const ping = cmux(['ping'], 5_000);
  return ping.ok && /PONG/i.test(ping.stdout);
}

const WORKSPACE_REF = /\bworkspace:\d+\b/;

export function parseWorkspaceRef(stdout: string): string {
  const match = stdout.match(WORKSPACE_REF);
  return match ? match[0] : '';
}

export interface CreateWorkspaceOptions {
  name: string;
  cwd: string;
  /** A shell line, typed into the new workspace's shell with Enter appended. */
  command: string;
  env?: Record<string, string>;
  focus?: boolean;
}

export interface CreateWorkspaceResult {
  ok: boolean;
  ref: string;
  reason: string;
}

/**
 * `--command` is a shell line, so anything interpolated into it is code.
 *
 * Every value this module puts there is manager-owned (a path it built, a
 * binary name from config), never agent or user text — the task's prompt
 * travels as a file instead. This guard is the backstop for that rule rather
 * than the rule itself: a path with a quote in it is refused instead of being
 * escaped, because escaping invites someone to trust the escaper with input
 * that should never have arrived here.
 */
export function shellSafePath(p: string): boolean {
  return !/['"`$\\\n]/.test(p);
}

/**
 * Refuses rather than escapes.
 *
 * A quote inside a single-quoted string ends it, so escaping would have to be
 * correct here forever. Nothing that reaches this function is user or agent
 * text — it is a binary name and a model id from config, and a path the
 * manager built — so a value that needs escaping means something arrived from
 * somewhere it should not have, and the useful response to that is to stop.
 */
export function singleQuote(value: string): string {
  if (!shellSafePath(value)) {
    throw new Error(`refusing to put "${value}" on a shell command line: it contains shell metacharacters`);
  }
  return `'${value}'`;
}

export function createWorkspace(opts: CreateWorkspaceOptions): CreateWorkspaceResult {
  const cwd = path.resolve(opts.cwd);
  if (!shellSafePath(cwd)) {
    return { ok: false, ref: '', reason: `refusing to launch in a path containing shell metacharacters: ${cwd}` };
  }
  const args = ['workspace', 'create', '--name', opts.name, '--cwd', cwd, '--focus', opts.focus ? 'true' : 'false'];
  for (const [key, value] of Object.entries(opts.env ?? {})) {
    args.push('--env', `${key}=${value}`);
  }
  args.push('--command', opts.command);
  const run = cmux(args, 60_000);
  const ref = parseWorkspaceRef(run.stdout);
  if (!run.ok || !ref) {
    return { ok: false, ref: '', reason: run.stderr || run.stdout || 'cmux workspace create produced no workspace ref' };
  }
  return { ok: true, ref, reason: '' };
}

export function closeWorkspace(ref: string): CmuxRun {
  return cmux(['close-workspace', '--workspace', ref]);
}

export type ReadScreenResult = { ok: true; screen: string } | { ok: false; error: string };

export type CmuxExecutor = (args: string[], timeoutMs?: number) => CmuxRun;

export function readScreen(ref: string, lines = 200, executor: CmuxExecutor = cmux): ReadScreenResult {
  const run = executor(['read-screen', '--workspace', ref, '--lines', String(lines)]);
  if (run.ok) return { ok: true, screen: run.stdout };
  return { ok: false, error: run.stderr || 'cmux read-screen failed' };
}

export function renameWorkspace(ref: string, title: string): CmuxRun {
  return cmux(['rename-workspace', '--workspace', ref, title]);
}

export interface SendResult {
  ok: boolean;
  reason: string;
}

/**
 * Types text into a live agent, then presses Enter.
 *
 * Refuses unless the session is idle. A `running` session is mid-turn, and
 * characters delivered there land inside whatever the agent is currently
 * doing; `needsInput` is the one case a human is being asked something, which
 * is exactly when an answer is wanted, so it is allowed alongside idle.
 *
 * The newline check is not paranoia about the caller. A multi-line answer
 * submits at the first newline and leaves the remaining lines typed into a
 * fresh prompt as if they were a second instruction.
 */
export function sendText(ref: string, text: string, session: CmuxSession | null): SendResult {
  if (!session) {
    return { ok: false, reason: `no cmux session is attached to ${ref}, so there is nothing to type into` };
  }
  if (session.lifecycle !== 'idle' && session.lifecycle !== 'needsInput') {
    return {
      ok: false,
      reason: `session is "${session.lifecycle}"; typing into a running agent injects text mid-turn. Wait for idle.`,
    };
  }
  if (/[\r\n]/.test(text)) {
    return { ok: false, reason: 'refusing to send text containing a newline: it would submit early and leave the rest as a second prompt' };
  }
  const typed = cmux(['send', '--workspace', ref, text]);
  if (!typed.ok) return { ok: false, reason: typed.stderr || typed.stdout || 'cmux send failed' };
  const entered = cmux(['send-key', '--workspace', ref, 'Enter']);
  if (!entered.ok) return { ok: false, reason: entered.stderr || entered.stdout || 'cmux send-key Enter failed' };
  return { ok: true, reason: '' };
}

/**
 * The session running in `dir`, matched on exact cwd.
 *
 * Exact, not prefix: a task's worktree and its own subdirectories are
 * different sessions, and a prefix match would hand back whichever the agent
 * happened to cd into. Per-task worktrees are what make this key unique in the
 * first place — with one shared checkout every task on a repo would collide
 * here.
 */
export function sessionInDir(dir: string, agent = 'claude', home?: string, startedAfter = 0): CmuxSession | null {
  const target = path.resolve(dir);
  const read = readCmuxSessions(agent, home);
  for (const session of read.ok ? read.entries : []) {
    if (session.cwd && path.resolve(session.cwd) === target && session.startedAt >= startedAfter) return session;
  }
  return null;
}

/**
 * Waits for a session to appear in `dir` and settle out of its boot state.
 *
 * Returns null on timeout rather than throwing: a pane that never registers is
 * an ordinary failure the caller reports as a dead run, and the operator can
 * still see the pane and read what went wrong on it.
 */
export async function waitForSession(
  dir: string,
  opts: { timeoutMs?: number; pollMs?: number; agent?: string; startedAfter?: number; home?: string } = {},
): Promise<CmuxSession | null> {
  const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
  const pollMs = opts.pollMs ?? 500;
  while (Date.now() < deadline) {
    const session = sessionInDir(dir, opts.agent, opts.home, opts.startedAfter);
    if (session) return session;
    await sleep(pollMs);
  }
  return null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Writes the task prompt where the launch command can read it.
 *
 * This is the whole reason the prompt is never typed: a file read by
 * `"$(cat …)"` is delivered byte for byte, while a TUI paste of the same text
 * is subject to bracketed-paste handling, newline-submits, and whatever the
 * agent's input box does with a very long string.
 */
export function writePromptFile(dir: string, prompt: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'prompt.txt');
  fs.writeFileSync(file, prompt, { mode: 0o600 });
  return file;
}

export interface LaunchCommandOptions {
  claudeBin: string;
  promptFile: string;
  model?: string;
  extraArgs?: string[];
  capture?: {
    stdoutFile: string;
    stderrFile: string;
    exitCodeFile: string;
  };
}

/**
 * The shell line that starts the agent with its prompt already submitted.
 *
 * `"$(cat 'file')"` is one argument no matter what the file contains: command
 * substitution inside double quotes is not word-split and not glob-expanded.
 * That is what makes it safe to put a model-written prompt on a command line
 * at all.
 */
export function buildLaunchCommand(opts: LaunchCommandOptions): string {
  const parts = [singleQuote(opts.claudeBin)];
  if (opts.model) parts.push('--model', singleQuote(opts.model));
  for (const arg of opts.extraArgs ?? []) {
    if (!shellSafePath(arg)) throw new Error(`refusing a launch flag containing shell metacharacters: ${arg}`);
    parts.push(arg);
  }
  parts.push(`"$(cat ${singleQuote(opts.promptFile)})"`);
  const command = parts.join(' ');
  if (!opts.capture) return command;
  return `${command} > ${singleQuote(opts.capture.stdoutFile)} 2> ${singleQuote(opts.capture.stderrFile)}; printf '%s' "$?" > ${singleQuote(opts.capture.exitCodeFile)}`;
}
