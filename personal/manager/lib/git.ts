/**
 * The manager's ONLY subprocess. It runs read-only git plumbing inside a
 * task's own scope so the phone's [Xem diff] button has something to show.
 *
 * Every other kind of subprocess is banned by the tripwire in
 * test/tripwire.test.ts, and this file is banned from naming any agent binary.
 * The reason is the ban's whole point: an agent launched by shelling out sits
 * outside the semaphore, outside the cost ledger, and outside the scope
 * directive. Reading a diff is reporting, which is the manager's job.
 */

import * as path from 'path';

/** Beyond this a diff is noise on a phone and a memory cost on the daemon. */
const MAX_DIFF_BYTES = 200_000;
const GIT_TIMEOUT_MS = 15_000;

export interface DiffResult {
  ok: boolean;
  text: string;
  truncated: boolean;
  error: string;
}

function runGit(args: string[], cwd: string): { code: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: GIT_TIMEOUT_MS,
  });
  return {
    code: proc.exitCode ?? -1,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

/**
 * Staged plus unstaged changes in `scope`. Read-only: `git diff` never
 * mutates the working tree, and no other git subcommand is reachable here.
 */
export function readDiff(scope: string): DiffResult {
  const cwd = path.resolve(scope);
  let combined: string;
  try {
    const inside = runGit(['rev-parse', '--is-inside-work-tree'], cwd);
    if (inside.code !== 0) {
      return { ok: false, text: '', truncated: false, error: `${cwd} is not a git work tree` };
    }
    const staged = runGit(['diff', '--staged'], cwd);
    const unstaged = runGit(['diff'], cwd);
    if (staged.code !== 0 && unstaged.code !== 0) {
      return { ok: false, text: '', truncated: false, error: staged.stderr || unstaged.stderr || 'git diff failed' };
    }
    combined = [staged.stdout, unstaged.stdout].filter((part) => part.trim() !== '').join('\n');
  } catch (err) {
    return { ok: false, text: '', truncated: false, error: `git is not runnable: ${(err as Error).message}` };
  }
  if (combined.length > MAX_DIFF_BYTES) {
    return {
      ok: true,
      text: `${combined.slice(0, MAX_DIFF_BYTES)}\n... truncated at ${MAX_DIFF_BYTES} bytes ...\n`,
      truncated: true,
      error: '',
    };
  }
  return { ok: true, text: combined, truncated: false, error: '' };
}
