import { describe, test, expect, afterAll } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'red-test-cf-home-')));
process.env.MANAGER_HOME = HOME;

const { gitRaw } = await import('../lib/worktrees');
type WorktreeRecord = import('../lib/worktrees').WorktreeRecord;

const dirs: string[] = [];

function makeRepo(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'red-test-cf-repo-')));
  dirs.push(dir);
  function git(args: string[]): void {
    const r = spawnSync('git', args, { cwd: dir, stdio: 'pipe', encoding: 'utf-8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  }
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 't@t.test']);
  git(['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'hello\n');
  git(['add', 'README.md']);
  git(['commit', '-qm', 'init']);
  return dir;
}

function baseSha(dir: string): string {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, stdio: 'pipe', encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`rev-parse: ${r.stderr}`);
  return r.stdout.trim();
}

function intentToAddSet(dir: string): string[] {
  const r = gitRaw(['diff', '--name-only', '--diff-filter=A', '--cached'], dir);
  if (!r.ok) return [];
  return r.stdout.split('\n').filter(Boolean);
}

function worktreeRecord(taskId: string, dir: string, baseSha: string): WorktreeRecord {
  return {
    taskId,
    project: 'demo',
    branch: `manager/${taskId}`,
    dir,
    repo: dir,
    baseSha,
    createdAt: new Date().toISOString(),
  };
}

afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  fs.rmSync(HOME, { recursive: true, force: true });
});

describe('changedFiles intent-to-add scoping', () => {
  test('a new untracked test file appears in git diff after the call', async () => {
    const dir = makeRepo();
    const sha = baseSha(dir);
    fs.writeFileSync(path.join(dir, 'foo.test.ts'), 'import { test } from "bun:test";\n');

    const { runRedTestBaseline } = await import('../lib/red-test-runner');

    const fakeRecord = worktreeRecord('x', dir, sha);

    const result = await runRedTestBaseline({
      project: 'demo',
      scope: dir,
      record: fakeRecord,
    });

    expect(result.testFiles).toContain('foo.test.ts');
  });

  test('a stray artifact does not enter the intent-to-add set', async () => {
    const dir = makeRepo();

    fs.writeFileSync(path.join(dir, 'foo.test.ts'), 'import { test } from "bun:test";\n');
    fs.writeFileSync(path.join(dir, 'build.js'), 'console.log("artifact");\n');
    fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'dist', 'output.js'), 'compiled output\n');

    const sha = baseSha(dir);
    const fakeRecord = worktreeRecord('y', dir, sha);

    const { runRedTestBaseline } = await import('../lib/red-test-runner');

    await runRedTestBaseline({
      project: 'demo',
      scope: dir,
      record: fakeRecord,
    });

    const staged = intentToAddSet(dir);
    expect(staged).not.toContain('build.js');
    expect(staged).not.toContain('dist/output.js');
    expect(staged.every((f) => f.includes('test'))).toBe(true);
  });
});
