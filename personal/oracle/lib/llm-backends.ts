/**
 * Who actually runs an LLM gate, and who scores it.
 *
 * These were one thing — a direct Anthropic SDK call — which made the paid API
 * key a hard requirement and made every gate in the chain the same model
 * family. §7.3 calls that out as BLOCKER 4: the gates are independent in
 * CONTEXT but not in FAILURE MODE, because they share a family and its bias
 * toward "this looks reasonable".
 *
 * Splitting producer from scorer, and naming the family of each, buys two
 * things. Measurement runs with no metered key, on CLI auth the machine already
 * has. And the family of every number is recorded, so "codex found it, Claude
 * agreed it was found" can be told apart from one model agreeing with itself.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { callJudge } from '../../../test/helpers/llm-judge';
import { parseCodexJSONL } from '../../../test/helpers/codex-session-runner';
import { hermeticChildEnv } from '../../../test/helpers/hermetic-env';

export type BackendName = 'codex' | 'claude-cli' | 'anthropic-api';

/** Two gates of the same family are one opinion wearing two labels (§7.3). */
export type ModelFamily = 'openai' | 'anthropic';

export interface Availability {
  ok: boolean;
  reason: string;
}

export interface Backend {
  name: BackendName;
  family: ModelFamily;
  /** Whether the backend runs without reading the operator's real tool configuration. */
  hermetic: boolean;
  available(): Availability;
  callJson<T>(prompt: string, timeoutMs?: number): Promise<T>;
}

const DEFAULT_TIMEOUT_MS = 300_000;

/**
 * Direct parse first, then the first balanced-looking block. A model told to
 * answer in JSON usually does; the fallback is for the ones that wrap it in
 * prose, and it must not silently return a fragment.
 */
export function extractJson<T>(text: string, who: string): T {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // fall through to the embedded-object case
  }
  const fenced = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : trimmed.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) throw new Error(`${who} returned non-JSON: ${trimmed.slice(0, 200)}`);
  try {
    return JSON.parse(candidate) as T;
  } catch (err) {
    throw new Error(`${who} returned unparseable JSON: ${(err as Error).message}`);
  }
}

interface SpawnOutcome {
  stdout: string;
  stderr: string;
  code: number;
  timedOut: boolean;
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv, cwd: string, timeoutMs: number): Promise<SpawnOutcome> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? -1, timedOut });
    });
  });
}

function binaryOnPath(bin: string): boolean {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  return dirs.some((dir) => {
    try {
      fs.accessSync(path.join(dir, bin), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * One codex HOME for the whole process, carrying auth and nothing else.
 *
 * `skills/` is deliberately not copied. A first probe against the operator's
 * real HOME spent 22,086 input tokens on a one-line prompt because every
 * installed skill was in context — that is both the cost and, worse, a gate
 * being measured while reading forty skills it will not have in the field.
 */
let codexHome: string | null = null;
let cleanupArmed = false;

/**
 * The temp HOME holds a COPY of the real codex credentials, so it must not
 * outlive the process that made it. Registered once, on the paths a runner
 * actually exits through.
 */
function armCleanup(): void {
  if (cleanupArmed) return;
  cleanupArmed = true;
  for (const signal of ['exit', 'SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      clearCodexHome();
      if (signal !== 'exit') process.exit(130);
    });
  }
}

function ensureCodexHome(): string {
  if (codexHome) return codexHome;
  armCleanup();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-codex-'));
  const realCodex = path.join(os.homedir(), '.codex');
  const tempCodex = path.join(home, '.codex');
  fs.mkdirSync(tempCodex, { recursive: true });
  if (fs.existsSync(realCodex)) {
    for (const entry of fs.readdirSync(realCodex)) {
      if (entry === 'skills' || entry === 'sessions' || entry === 'log') continue;
      try {
        fs.cpSync(path.join(realCodex, entry), path.join(tempCodex, entry), { recursive: true });
      } catch {
        // an unreadable cache entry must not stop auth from being copied
      }
    }
  }
  codexHome = home;
  return home;
}

export function clearCodexHome(): void {
  if (!codexHome) return;
  try {
    fs.rmSync(codexHome, { recursive: true, force: true });
  } catch {
    // best-effort
  }
  codexHome = null;
}

export const codexBackend: Backend = {
  name: 'codex',
  family: 'openai',
  hermetic: true,
  available() {
    if (!binaryOnPath('codex')) return { ok: false, reason: 'codex is not on PATH' };
    if (!fs.existsSync(path.join(os.homedir(), '.codex'))) {
      return { ok: false, reason: '~/.codex does not exist — run `codex login` once' };
    }
    return { ok: true, reason: '' };
  },
  async callJson<T>(prompt: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
    const home = ensureCodexHome();
    const outcome = await run(
      'codex',
      ['exec', prompt, '--json', '-s', 'read-only', '--skip-git-repo-check'],
      hermeticChildEnv({ HOME: home }, { extraAllow: ['OPENAI_API_KEY', 'CODEX_*'] }),
      os.tmpdir(),
      timeoutMs,
    );
    if (outcome.timedOut) throw new Error(`codex timed out after ${timeoutMs}ms`);
    const parsed = parseCodexJSONL(outcome.stdout.split('\n'));
    if (!parsed.output.trim()) {
      throw new Error(`codex produced no agent message (exit ${outcome.code}): ${outcome.stderr.slice(0, 200)}`);
    }
    return extractJson<T>(parsed.output, 'codex');
  },
};

/**
 * The Claude Code CLI, authenticated by the machine's own subscription.
 *
 * It deliberately does NOT get the hermetic scrub the codex path gets. The
 * scrub swaps in a fresh CLAUDE_CONFIG_DIR, which is right when auth is an API
 * key and fatal when auth is a subscription living in the real config dir.
 * The cost is that this backend sees the operator's settings, so it is the
 * scorer's default and never the gate's: the thing being measured has to be
 * the clean one.
 */
export const claudeCliBackend: Backend = {
  name: 'claude-cli',
  family: 'anthropic',
  hermetic: false,
  available() {
    if (!binaryOnPath('claude')) return { ok: false, reason: 'claude is not on PATH' };
    return { ok: true, reason: '' };
  },
  async callJson<T>(prompt: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
    const outcome = await run(
      'claude',
      ['-p', prompt, '--model', 'claude-haiku-4-5-20251001'],
      process.env,
      os.tmpdir(),
      timeoutMs,
    );
    if (outcome.timedOut) throw new Error(`claude -p timed out after ${timeoutMs}ms`);
    if (!outcome.stdout.trim()) {
      throw new Error(`claude -p produced nothing (exit ${outcome.code}): ${outcome.stderr.slice(0, 200)}`);
    }
    return extractJson<T>(outcome.stdout, 'claude -p');
  },
};

export const anthropicApiBackend: Backend = {
  name: 'anthropic-api',
  family: 'anthropic',
  hermetic: true,
  available() {
    return process.env.ANTHROPIC_API_KEY
      ? { ok: true, reason: '' }
      : { ok: false, reason: 'ANTHROPIC_API_KEY is not set' };
  },
  async callJson<T>(prompt: string): Promise<T> {
    return callJudge<T>(prompt);
  },
};

const BACKENDS: Record<BackendName, Backend> = {
  codex: codexBackend,
  'claude-cli': claudeCliBackend,
  'anthropic-api': anthropicApiBackend,
};

export function backendByName(name: string | undefined, fallback: BackendName): Backend {
  const key = (name ?? '').trim() as BackendName;
  return BACKENDS[key] ?? BACKENDS[fallback];
}

export type BackendRole = 'gate' | 'judge';

export function requireBackendRole(backend: Backend, role: BackendRole): Backend {
  if (role === 'gate' && !backend.hermetic) {
    throw new Error(`backend "${backend.name}" cannot run as a gate: it is non-hermetic and reads the operator's real ~/.claude configuration`);
  }
  return backend;
}

export function backendFamily(name: string): ModelFamily | undefined {
  return BACKENDS[name as BackendName]?.family;
}

/**
 * Gate defaults to codex and scorer to Claude, so the two halves of a
 * measurement come from different families. Both are overridable, and both are
 * reported, because a run where they collapse to one family is a weaker number
 * and the reader has to be able to see that.
 */
export function resolveBackends(env: NodeJS.ProcessEnv = process.env, gate?: string): { gate: Backend; judge: Backend } {
  const prefix = gate ? `ORACLE_${gate.replace(/-/g, '_').toUpperCase()}` : '';
  const gateName = (prefix ? env[`${prefix}_GATE_BACKEND`] : undefined) ?? env.ORACLE_GATE_BACKEND;
  const judgeName = (prefix ? env[`${prefix}_JUDGE_BACKEND`] : undefined) ?? env.ORACLE_JUDGE_BACKEND;
  return {
    gate: requireBackendRole(backendByName(gateName, 'codex'), 'gate'),
    judge: requireBackendRole(backendByName(judgeName, 'claude-cli'), 'judge'),
  };
}
