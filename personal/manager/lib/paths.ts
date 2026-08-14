/**
 * On-disk layout for the manager. Every path is derived at CALL time from
 * os.homedir() (or an env pin), never captured at module load — tests pin
 * MANAGER_HOME after import, and a load-time capture would silently ignore it.
 *
 * Windows-safe: path.join everywhere, no POSIX separators baked into strings.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { gateLogDir } from './gate-log';

/**
 * Root that holds both manager state and the gate log.
 *
 * `GSTACK_HOME` is the shared name: the Telegram bot resolves its own paths
 * from it (telegram/config.ts), as does the gate log. `MANAGER_HOME` exists
 * only to isolate a test run, and it wins when set — but setting it alone used
 * to split the two halves apart, with the daemon writing to the pin while the
 * bot and the gate log still pointed at the real home. The symptom of that is
 * "the bot cannot see the manager", not an error. So the pin is published back
 * to `GSTACK_HOME`, which keeps every reader — this process and any child it
 * spawns — pointed at one directory.
 */
export function gstackHome(): string {
  const pinned = process.env.MANAGER_HOME?.trim();
  if (pinned) {
    if (process.env.GSTACK_HOME !== pinned) process.env.GSTACK_HOME = pinned;
    return pinned;
  }
  const shared = process.env.GSTACK_HOME?.trim();
  return shared || path.join(os.homedir(), '.gstack');
}

export function managerDir(): string {
  return path.join(gstackHome(), 'manager');
}

export function stateFile(): string {
  return path.join(managerDir(), 'state.json');
}

export function tasksDir(): string {
  return path.join(managerDir(), 'tasks');
}

export function taskFile(id: string): string {
  return path.join(tasksDir(), `${id}.json`);
}

export function portFile(): string {
  return path.join(managerDir(), 'port');
}

export function tokenFile(): string {
  return path.join(managerDir(), 'token');
}

export function pidFile(): string {
  return path.join(managerDir(), 'daemon.pid');
}

export function managerConfigFile(): string {
  return path.join(managerDir(), 'config.json');
}

/** name -> absolute repo path. Feeds the per-project write scope (§6.8). */
export function projectsFile(): string {
  return path.join(managerDir(), 'projects.json');
}

/**
 * Assert commands a human has said yes to. Sits beside projects.json on
 * purpose — it is the same trust level, not a stronger one. Read
 * lib/assert-approvals.ts before treating it as a boundary.
 */
export function assertApprovalsFile(): string {
  return path.join(managerDir(), 'assert-approvals.json');
}

/**
 * Re-exported from gate-log.ts rather than recomputed. The gate log's location
 * has exactly one definition; a second one here would drift the day someone
 * changes an env var name and split a project's history across two files.
 */
export { gateLogDir } from './gate-log';

export function ensureManagerDirs(): void {
  fs.mkdirSync(tasksDir(), { recursive: true });
  fs.mkdirSync(gateLogDir(), { recursive: true });
}

/** Filesystem-safe task id fragment. Windows rejects most punctuation. */
export function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/**
 * Write-then-rename so a crash mid-write never leaves a half-parsed state
 * file. rename over an existing path replaces it on both Windows and POSIX.
 */
export function atomicWriteJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

/**
 * What a project is allowed to run for `B8-assert`. `suite` must report how
 * many tests actually executed; `check` (tsc, eslint) has no test count and is
 * judged on its exit code alone. The distinction is the whole point: a suite
 * that exits 0 having run nothing is not a pass (§7.4).
 */
export interface AssertCommandSpec {
  cmd: string;
  kind?: 'suite' | 'check';
}

/**
 * A registry value is either a bare path (the original shape, still valid) or
 * an entry that also carries the project's own assert commands. Old files keep
 * working; nothing has to be migrated.
 */
export interface ProjectEntry {
  path: string;
  assert?: Array<string | AssertCommandSpec>;
}

export interface ProjectRegistry {
  [project: string]: string | ProjectEntry;
}

export function loadProjectRegistry(): ProjectRegistry {
  const raw = readJson<ProjectRegistry>(projectsFile(), {});
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

/** Normalizes both registry shapes to one. Null when the project is unknown. */
export function projectEntry(project: string): ProjectEntry | null {
  const value = loadProjectRegistry()[project];
  if (typeof value === 'string') return { path: value };
  if (value && typeof value === 'object' && typeof value.path === 'string') {
    return Array.isArray(value.assert) ? { path: value.path, assert: value.assert } : { path: value.path };
  }
  return null;
}

/**
 * Writes discovered assert commands back so the next run reads them instead of
 * rediscovering. Refuses to invent a project: an unregistered name is a write
 * scope nobody approved, and inferring one here would route around
 * resolveProjectScope.
 */
export function rememberAssertCommands(project: string, commands: Array<string | AssertCommandSpec>): boolean {
  const registry = loadProjectRegistry();
  const existing = registry[project];
  if (existing === undefined) return false;
  const entryPath = typeof existing === 'string' ? existing : existing.path;
  if (typeof entryPath !== 'string' || !entryPath) return false;
  registry[project] = { path: entryPath, assert: commands };
  atomicWriteJson(projectsFile(), registry);
  return true;
}

/**
 * A project name becomes a gate-log filename and a write-scope key, so it is
 * held to the same shape the gate log slugs to. Rejecting a name here beats
 * accepting one that silently lands in a different file than the user reads.
 */
const PROJECT_NAME = /^[a-z0-9][a-z0-9._-]*$/;

export interface RegisterResult {
  ok: boolean;
  reason: string;
  path: string;
}

/**
 * The on-ramp. Without it the only way into the registry was hand-writing JSON
 * at a path the user has to know, which is why the file did not exist on a
 * machine where every other piece was built and tested.
 *
 * Re-registering a name keeps its approved assert commands when the path is
 * unchanged, and drops them when it is not: those commands were approved
 * against one checkout, and carrying them to a different directory would move
 * a human's approval somewhere the human never looked.
 */
export function registerProject(project: string, dir: string): RegisterResult {
  const name = String(project ?? '').trim().toLowerCase();
  if (!PROJECT_NAME.test(name)) {
    return { ok: false, path: '', reason: `"${project}" is not a usable project name (a-z, 0-9, . _ - and must start alphanumeric)` };
  }
  const abs = path.resolve(String(dir ?? '').trim());
  if (!fs.existsSync(abs)) return { ok: false, path: abs, reason: `${abs} does not exist` };
  if (!fs.statSync(abs).isDirectory()) return { ok: false, path: abs, reason: `${abs} is not a directory` };

  const registry = loadProjectRegistry();
  const existing = registry[name];
  const existingPath = typeof existing === 'string' ? existing : existing?.path;
  const keepAssert =
    existing && typeof existing === 'object' && existingPath && path.resolve(existingPath) === abs
      ? existing.assert
      : undefined;

  registry[name] = keepAssert ? { path: abs, assert: keepAssert } : { path: abs };
  ensureManagerDirs();
  atomicWriteJson(projectsFile(), registry);
  return { ok: true, path: abs, reason: '' };
}

export interface ScopeResolution {
  scope: string | null;
  reason: string;
}

/**
 * Absolute path a task for `project` is allowed to touch. Never guesses: an
 * unregistered project blocks, because a guessed root is a write scope nobody
 * approved.
 *
 * "not registered" and "registered but the path is not there" are reported
 * separately. On Windows they look identical from the outside and the second
 * one is easy to hit — a Git Bash path like /d/Project/foo resolves against
 * the current drive and silently points at nothing.
 */
export function resolveProjectScope(project: string): ScopeResolution {
  const entry = projectEntry(project);
  if (!entry || !entry.path) {
    const known = Object.keys(loadProjectRegistry());
    const suffix = known.length > 0 ? ` Registered: ${known.join(', ')}.` : ' The registry is empty.';
    return { scope: null, reason: `unknown project "${project}": add it to ${projectsFile()}.${suffix}` };
  }
  const abs = path.resolve(entry.path);
  if (!fs.existsSync(abs)) {
    return {
      scope: null,
      reason: `project "${project}" is registered as "${entry.path}" but ${abs} does not exist. Use a full native path.`,
    };
  }
  return { scope: abs, reason: '' };
}

/** True when `candidate` is inside `root` (or is `root`). Case-insensitive on Windows. */
export function isInsideScope(candidate: string, root: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  if (rel === '') return true;
  if (rel.startsWith('..')) return false;
  return !path.isAbsolute(rel);
}
