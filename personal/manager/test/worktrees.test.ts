import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wt-home-')));
process.env.MANAGER_HOME = HOME;

const {
  DEFAULT_WORKTREE_LINKS,
  ensureTaskWorktree,
  isDirty,
  listWorktrees,
  loadWorktreeRegistry,
  removeTaskWorktree,
  staleRecords,
  worktreeDiff,
  worktreesRoot,
} = await import('../lib/worktrees');

function git(args: string[], cwd: string): void {
  const r = spawnSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
}

/** A throwaway repo with one commit, so `git worktree add` has a HEAD to branch from. */
function makeRepo(name: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `wt-repo-${name}-`)));
  git(['init', '-q', '-b', 'main'], dir);
  git(['config', 'user.email', 't@t.test'], dir);
  git(['config', 'user.name', 'test'], dir);
  fs.writeFileSync(path.join(dir, 'README.md'), 'hello\n');
  git(['add', '-A'], dir);
  git(['commit', '-qm', 'init'], dir);
  return dir;
}

const repos: string[] = [];
function repo(name: string): string {
  const dir = makeRepo(name);
  repos.push(dir);
  return dir;
}

beforeEach(() => {
  fs.rmSync(path.join(HOME, 'manager'), { recursive: true, force: true });
});

afterAll(() => {
  for (const dir of repos) fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(HOME, { recursive: true, force: true });
});

describe('a task gets its own checkout', () => {
  test('the worktree is a real one, on its own branch, off the repo HEAD', () => {
    const dir = repo('basic');
    const result = ensureTaskWorktree('joy-t1-01', 'joy', dir);
    expect(result.ok, result.reason).toBe(true);
    const record = result.record!;
    expect(fs.existsSync(path.join(record.dir, 'README.md'))).toBe(true);
    expect(record.branch).toBe('manager/joy-t1-01');
    const branch = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: record.dir, encoding: 'utf-8' });
    expect(branch.stdout.trim()).toBe('manager/joy-t1-01');
  });

  // A retry of a task must land in the checkout that already holds its work,
  // not in a second empty one beside it.
  test('asking twice for the same task returns the same directory', () => {
    const dir = repo('idem');
    const first = ensureTaskWorktree('joy-t2-01', 'joy', dir);
    const second = ensureTaskWorktree('joy-t2-01', 'joy', dir);
    expect(second.reused).toBe(true);
    expect(second.record!.dir).toBe(first.record!.dir);
  });

  test('two tasks on ONE repo get two directories — the whole point of this file', () => {
    const dir = repo('parallel');
    const a = ensureTaskWorktree('joy-a-01', 'joy', dir);
    const b = ensureTaskWorktree('joy-b-01', 'joy', dir);
    expect(a.record!.dir).not.toBe(b.record!.dir);
    fs.writeFileSync(path.join(a.record!.dir, 'only-a.txt'), 'a');
    expect(fs.existsSync(path.join(b.record!.dir, 'only-a.txt'))).toBe(false);
  });

  test('long task ids differing only near the tail get different directories and branches', () => {
    const dir = repo('long-task-ids');
    const shared = `project-${'issue-'.repeat(13)}x`;
    expect(`${shared}01`.length).toBe(89);
    expect(`${shared}02`.length).toBe(89);
    const a = ensureTaskWorktree(`${shared}01`, 'project', dir);
    const b = ensureTaskWorktree(`${shared}02`, 'project', dir);
    expect(a.ok, a.reason).toBe(true);
    expect(b.ok, b.reason).toBe(true);
    expect(a.record!.dir).not.toBe(b.record!.dir);
    expect(a.record!.branch).not.toBe(b.record!.branch);
    expect(path.basename(a.record!.dir).length).toBeLessThanOrEqual(64);
    expect(path.basename(b.record!.dir).length).toBeLessThanOrEqual(64);
    expect(a.record!.branch).toMatch(/^manager\/[a-z0-9._-]+$/);
    expect(b.record!.branch).toMatch(/^manager\/[a-z0-9._-]+$/);
  });

  // Nested under the repo, every task's scope would contain every other task's
  // checkout, and the scope guard would wave a write from A into B straight
  // through.
  test('the worktree lives outside the repo it came from', () => {
    const dir = repo('outside');
    const record = ensureTaskWorktree('joy-t3-01', 'joy', dir).record!;
    expect(record.dir.startsWith(worktreesRoot())).toBe(true);
    expect(path.relative(dir, record.dir).startsWith('..')).toBe(true);
  });

  test('gitignored essentials are linked in, so the first command does not fail on a missing dependency', () => {
    const dir = repo('links');
    fs.mkdirSync(path.join(dir, 'node_modules', 'left-pad'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', 'left-pad', 'index.js'), '// pad');
    const record = ensureTaskWorktree('joy-t4-01', 'joy', dir, { links: DEFAULT_WORKTREE_LINKS }).record!;
    expect(fs.existsSync(path.join(record.dir, 'node_modules', 'left-pad', 'index.js'))).toBe(true);
    expect(fs.lstatSync(path.join(record.dir, 'node_modules')).isSymbolicLink()).toBe(true);
  });

  test('a link entry that tries to escape the repo is ignored, not followed', () => {
    const dir = repo('escape');
    const record = ensureTaskWorktree('joy-t5-01', 'joy', dir, { links: ['../../../etc', '/etc'] }).record!;
    expect(fs.existsSync(path.join(record.dir, 'etc'))).toBe(false);
  });

  test('a directory that is not a git repo is refused with a reason, not a throw', () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-plain-'));
    const result = ensureTaskWorktree('x-01', 'x', plain);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('not a git repository');
    fs.rmSync(plain, { recursive: true, force: true });
  });

  test('a path that does not exist is refused with a reason, not a throw', () => {
    const result = ensureTaskWorktree('x-02', 'x', path.join(os.tmpdir(), 'definitely-not-here-92831'));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('does not exist');
  });
});

describe('removal refuses everything it did not create', () => {
  // The machine this was built on has joy-2, joy-3, wishlist-2 and wishlist-3
  // sitting beside their originals holding 19 stashes between them. A cleanup
  // pass that walked a naming pattern instead of the registry would take them.
  test('a task with no registry entry is refused outright', () => {
    const result = removeTaskWorktree('never-registered');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('refusing');
  });

  test('a worktree with uncommitted changes is refused', () => {
    const dir = repo('dirty');
    const record = ensureTaskWorktree('joy-t6-01', 'joy', dir).record!;
    fs.writeFileSync(path.join(record.dir, 'work-in-progress.txt'), 'do not lose me');
    expect(isDirty(record.dir)).toBe(true);
    const result = removeTaskWorktree('joy-t6-01');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('uncommitted');
    expect(fs.existsSync(record.dir)).toBe(true);
  });

  test('force is the only way past a dirty checkout, and it says so on the tin', () => {
    const dir = repo('force');
    const record = ensureTaskWorktree('joy-t7-01', 'joy', dir).record!;
    fs.writeFileSync(path.join(record.dir, 'scratch.txt'), 'x');
    expect(removeTaskWorktree('joy-t7-01', { force: true }).ok).toBe(true);
    expect(fs.existsSync(record.dir)).toBe(false);
    expect(loadWorktreeRegistry()['joy-t7-01']).toBeUndefined();
  });

  test('a clean worktree is removed and drops out of the registry', () => {
    const dir = repo('clean');
    const record = ensureTaskWorktree('joy-t8-01', 'joy', dir).record!;
    expect(removeTaskWorktree('joy-t8-01').ok).toBe(true);
    expect(fs.existsSync(record.dir)).toBe(false);
    expect(listWorktrees().some((r) => r.taskId === 'joy-t8-01')).toBe(false);
  });
});

describe('what the manager can still tell you after the fact', () => {
  test('the diff is against the commit the worktree started at, untracked files included', () => {
    const dir = repo('diff');
    const record = ensureTaskWorktree('joy-t9-01', 'joy', dir).record!;
    fs.writeFileSync(path.join(record.dir, 'added.ts'), 'export const x = 1;\n');
    const diff = worktreeDiff(record);
    expect(diff.ok).toBe(true);
    expect(diff.text).toContain('added.ts');
  });

  // An empty string for both "nothing changed" and "git would not answer" is
  // the shape this whole layer exists to refuse: one of them is a measurement
  // and the other is the absence of one.
  test('a diff git cannot produce is reported, not returned as an empty one', () => {
    const dir = repo('diff-broken');
    const record = ensureTaskWorktree('joy-t9-02', 'joy', dir).record!;
    const diff = worktreeDiff({ ...record, baseSha: 'de1e7ed0000000000000000000000000000000ff' });
    expect(diff.ok).toBe(false);
    expect(diff.text).toBe('');
    expect(diff.error).toContain('git diff');
  });

  test('a failed intent-to-add is reported before untracked files can disappear', () => {
    const dir = repo('intent-broken');
    const record = ensureTaskWorktree('joy-t9-03', 'joy', dir).record!;
    fs.writeFileSync(path.join(record.dir, 'only-untracked.ts'), 'export const hidden = true;\n');
    const gitPath = spawnSync('git', ['rev-parse', '--git-path', 'index'], {
      cwd: record.dir,
      stdio: 'pipe',
      encoding: 'utf-8',
    }).stdout.trim();
    const lock = path.isAbsolute(gitPath) ? `${gitPath}.lock` : path.join(record.dir, `${gitPath}.lock`);
    fs.writeFileSync(lock, 'stale');
    try {
      const diff = worktreeDiff(record);
      expect(diff.ok).toBe(false);
      expect(diff.text).toBe('');
      expect(diff.error).toContain('git add --intent-to-add failed');
    } finally {
      fs.rmSync(lock, { force: true });
    }
  });

  // Reported rather than auto-pruned: a missing directory is also what a
  // mounted volume looks like mid-hiccup, and the record holds the branch name
  // that still has the work.
  test('a directory removed by hand is reported as stale, not silently forgotten', () => {
    const dir = repo('stale');
    const record = ensureTaskWorktree('joy-t10-01', 'joy', dir).record!;
    fs.rmSync(record.dir, { recursive: true, force: true });
    expect(staleRecords().map((r) => r.taskId)).toContain('joy-t10-01');
    expect(loadWorktreeRegistry()['joy-t10-01'].branch).toBe('manager/joy-t10-01');
  });
});
