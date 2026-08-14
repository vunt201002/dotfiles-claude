/**
 * One repo, N worktrees — a private checkout per task.
 *
 * Until now every task on a project shared one directory, so two tasks on the
 * same repo could not run at the same time without editing each other's files.
 * The manager papered over that with a per-project lock, which is a queue
 * wearing the costume of concurrency: eight repos meant a ceiling of eight
 * agents no matter how many cores the machine had.
 *
 * A git worktree fixes it at the source. Each task gets its own directory and
 * its own branch off the main checkout's HEAD, so `GSTACK_MANAGER_SCOPE` can
 * point at a path only that task owns. Two tasks on one repo become genuinely
 * parallel, and a task that goes wrong damages a directory nobody else is in.
 *
 * ## What this module refuses to do
 *
 * It never deletes a directory it did not create. Every worktree it makes is
 * recorded in `worktrees.json` first, and `remove` cross-checks that file
 * before running `git worktree remove`. The machine this was built on has
 * `joy-2`, `joy-3`, `wishlist-2`, `wishlist-3` sitting next to their originals
 * holding 19 stashes between them; a cleanup pass that walked a naming pattern
 * instead of a registry would have taken them.
 *
 * It also never removes a worktree with uncommitted changes unless explicitly
 * forced. An agent's unfinished work is the most expensive thing on disk.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomicWriteJson, managerDir, readJson, slug } from './paths';

export interface WorktreeRecord {
  taskId: string;
  project: string;
  /** The main checkout this was branched from. */
  repo: string;
  /** Absolute path to the worktree directory. */
  dir: string;
  branch: string;
  /** Commit the worktree started at, so a diff has a baseline. */
  baseSha: string;
  createdAt: string;
}

interface WorktreeRegistry {
  [taskId: string]: WorktreeRecord;
}

export function worktreesFile(): string {
  return path.join(managerDir(), 'worktrees.json');
}

/**
 * Outside the repo on purpose.
 *
 * Inside it (`<repo>/.gstack-worktrees/...`, which is what the harness's older
 * WorktreeManager does for tests) every task's scope would contain every other
 * task's worktree, and the scope guard would wave through a write from task A
 * into task B's checkout. Nesting also makes `git status` in the main checkout
 * noisy and invites an agent to `git add` a sibling's work.
 */
export function worktreesRoot(): string {
  return path.join(managerDir(), 'worktrees');
}

export function loadWorktreeRegistry(): WorktreeRegistry {
  const raw = readJson<WorktreeRegistry>(worktreesFile(), {});
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

export function worktreeFor(taskId: string): WorktreeRecord | null {
  return loadWorktreeRegistry()[taskId] ?? null;
}

export function listWorktrees(): WorktreeRecord[] {
  return Object.values(loadWorktreeRegistry()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export interface GitRun {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function git(args: string[], cwd: string, timeoutMs = 120_000): GitRun {
  const result = spawnSync('git', args, { cwd, stdio: 'pipe', timeout: timeoutMs, encoding: 'utf-8' });
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? String(result.error?.message ?? '')).trim(),
  };
}

export function isGitRepo(dir: string): boolean {
  return git(['rev-parse', '--git-dir'], dir, 15_000).ok;
}

export interface EnsureResult {
  ok: boolean;
  reason: string;
  record: WorktreeRecord | null;
  /** True when the directory already existed and was reused. */
  reused: boolean;
}

/**
 * Gitignored paths linked into a fresh worktree.
 *
 * A worktree starts with tracked files only, so `node_modules` is absent and
 * the first command a task runs fails on a missing dependency. Symlinked
 * rather than copied: a copy is hundreds of megabytes per task and is stale the
 * moment the main checkout installs anything.
 *
 * The cost of sharing is real and is not hidden: two tasks that both run an
 * install command are writing to the same tree. That is the same exposure as
 * today's single-checkout setup, not a new one, and it is why install commands
 * belong behind the project lock rather than in a task.
 */
export const DEFAULT_WORKTREE_LINKS = ['node_modules', '.env', '.env.local'];

function linkInto(worktreeDir: string, repo: string, links: string[]): string[] {
  const linked: string[] = [];
  for (const rel of links) {
    if (!rel || rel.includes('..') || path.isAbsolute(rel)) continue;
    const src = path.join(repo, rel);
    const dst = path.join(worktreeDir, rel);
    if (!fs.existsSync(src) || fs.existsSync(dst)) continue;
    try {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.symlinkSync(src, dst, fs.statSync(src).isDirectory() ? 'dir' : 'file');
      linked.push(rel);
    } catch {
      // A link that cannot be made is a slower task, not a broken one: the
      // command that needs it will say so far more clearly than a throw here.
    }
  }
  return linked;
}

export interface EnsureOptions {
  /** Defaults to the repo's current HEAD. */
  baseRef?: string;
  links?: string[];
}

/**
 * Creates (or re-attaches to) the worktree for one task.
 *
 * Idempotent by task id: calling it twice returns the same directory, because
 * a retry of a task must land in the checkout that already holds its work.
 */
export function ensureTaskWorktree(
  taskId: string,
  project: string,
  repo: string,
  opts: EnsureOptions = {},
): EnsureResult {
  const repoAbs = path.resolve(repo);
  const existing = worktreeFor(taskId);
  if (existing && fs.existsSync(existing.dir)) {
    return { ok: true, reason: '', record: existing, reused: true };
  }
  if (!fs.existsSync(repoAbs)) {
    return { ok: false, reason: `${repoAbs} does not exist`, record: null, reused: false };
  }
  if (!isGitRepo(repoAbs)) {
    return { ok: false, reason: `${repoAbs} is not a git repository, so it cannot host a worktree`, record: null, reused: false };
  }

  const head = git(['rev-parse', opts.baseRef ?? 'HEAD'], repoAbs);
  if (!head.ok) {
    return { ok: false, reason: `cannot resolve ${opts.baseRef ?? 'HEAD'} in ${repoAbs}: ${head.stderr}`, record: null, reused: false };
  }

  const name = slug(taskId) || 'task';
  const dir = path.join(worktreesRoot(), slug(project) || 'project', name);
  const branch = `manager/${name}`;

  fs.mkdirSync(path.dirname(dir), { recursive: true });
  let add = git(['worktree', 'add', '-b', branch, dir, head.stdout], repoAbs);
  if (!add.ok && /already exists/i.test(add.stderr)) {
    // A leftover branch from a previous run of the same task id. Re-use it
    // rather than inventing a second name, so the task's history stays in one
    // place; a stale directory registration is cleared by `git worktree prune`.
    git(['worktree', 'prune'], repoAbs);
    add = git(['worktree', 'add', dir, branch], repoAbs);
  }
  if (!add.ok) {
    return { ok: false, reason: `git worktree add failed: ${add.stderr || add.stdout}`, record: null, reused: false };
  }

  linkInto(dir, repoAbs, opts.links ?? DEFAULT_WORKTREE_LINKS);

  const record: WorktreeRecord = {
    taskId,
    project,
    repo: repoAbs,
    dir,
    branch,
    baseSha: head.stdout,
    createdAt: new Date().toISOString(),
  };
  const registry = loadWorktreeRegistry();
  registry[taskId] = record;
  fs.mkdirSync(managerDir(), { recursive: true });
  atomicWriteJson(worktreesFile(), registry);
  return { ok: true, reason: '', record, reused: false };
}

/** Tracked + untracked changes in the worktree, as porcelain lines. */
export function worktreeStatus(dir: string): string[] {
  const out = git(['status', '--porcelain'], dir, 30_000);
  return out.ok ? out.stdout.split('\n').filter(Boolean) : [];
}

export function isDirty(dir: string): boolean {
  return worktreeStatus(dir).length > 0;
}

/** Diff against the commit the worktree started at, including untracked files. */
export function worktreeDiff(record: WorktreeRecord): string {
  git(['add', '-A', '--intent-to-add'], record.dir, 60_000);
  const out = git(['diff', record.baseSha], record.dir, 60_000);
  return out.ok ? out.stdout : '';
}

export interface RemoveResult {
  ok: boolean;
  reason: string;
}

/**
 * Removes a worktree the manager created. Refuses everything else.
 *
 * Two gates, in this order: the task must be in the registry, and the checkout
 * must be clean. The first stops a bug in a caller from deleting a directory a
 * human made; the second stops the manager from throwing away work an agent
 * finished but nobody has looked at yet.
 */
export function removeTaskWorktree(taskId: string, opts: { force?: boolean } = {}): RemoveResult {
  const registry = loadWorktreeRegistry();
  const record = registry[taskId];
  if (!record) {
    return { ok: false, reason: `task ${taskId} has no worktree the manager created; refusing to touch anything` };
  }
  if (fs.existsSync(record.dir) && !opts.force && isDirty(record.dir)) {
    return {
      ok: false,
      reason: `${record.dir} has uncommitted changes. Harvest them first, or pass force to discard them.`,
    };
  }
  const args = ['worktree', 'remove', record.dir];
  if (opts.force) args.push('--force');
  const removed = git(args, record.repo);
  if (!removed.ok && fs.existsSync(record.dir)) {
    return { ok: false, reason: `git worktree remove failed: ${removed.stderr || removed.stdout}` };
  }
  git(['worktree', 'prune'], record.repo);
  delete registry[taskId];
  atomicWriteJson(worktreesFile(), registry);
  return { ok: true, reason: '' };
}

/**
 * Registry entries whose directory is gone — a worktree someone removed by
 * hand. Reported, never auto-pruned: a missing directory is also what a
 * mounted-volume hiccup looks like, and dropping the record would lose the
 * branch name that still holds the work.
 */
export function staleRecords(): WorktreeRecord[] {
  return listWorktrees().filter((r) => !fs.existsSync(r.dir));
}
