import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'manager-spawn-isolation-'));
process.env.MANAGER_HOME = HOME;

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { DEFAULT_CONFIG } from '../config';
import { isolateSpawnRequest, type SpawnRequest } from '../lib/spawn';

function git(args: string[], cwd: string): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}

const repos: string[] = [];

function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manager-spawn-repo-'));
  repos.push(dir);
  git(['init', '-q'], dir);
  git(['config', 'user.email', 'manager@example.test'], dir);
  git(['config', 'user.name', 'Manager Test'], dir);
  fs.writeFileSync(path.join(dir, 'tracked.ts'), 'export const value = 1;\n');
  fs.mkdirSync(path.join(dir, 'node_modules', 'fixture-dependency'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'node_modules', 'fixture-dependency', 'package.json'),
    JSON.stringify({ name: 'fixture-dependency', main: 'index.js' }),
  );
  fs.writeFileSync(path.join(dir, 'node_modules', 'fixture-dependency', 'index.js'), "module.exports = 'dependency-ready';\n");
  git(['add', 'tracked.ts'], dir);
  git(['commit', '-qm', 'fixture'], dir);
  return dir;
}

function request(scope: string, taskId: string): SpawnRequest {
  return {
    role: 'main',
    taskId,
    project: 'fixture',
    issue: 'isolate',
    scope,
    source: 'cli',
    prompt: 'work',
    modelAlias: 'sonnet',
  };
}

function dependencyOutput(scope: string): string {
  const result = spawnSync(process.execPath, ['-e', "console.log(require('fixture-dependency'))"], {
    cwd: scope,
    encoding: 'utf-8',
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

beforeEach(() => fs.rmSync(path.join(HOME, 'manager'), { recursive: true, force: true }));

afterAll(() => {
  fs.rmSync(HOME, { recursive: true, force: true });
  for (const dir of repos) fs.rmSync(dir, { recursive: true, force: true });
});

describe('production spawn isolation', () => {
  test('two concurrent isolateSpawnRequest calls each receive a real working node_modules tree', () => {
    const source = repo();
    const cfg = {
      ...DEFAULT_CONFIG,
      projectConcurrency: { fixture: 2 },
    };
    const first = isolateSpawnRequest(request(source, 'isolation-a'), cfg);
    const second = isolateSpawnRequest(request(source, 'isolation-b'), cfg);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok) throw new Error(first.reason);
    if (!second.ok) throw new Error(second.reason);
    for (const result of [first, second]) {
      const modules = path.join(result.req.scope, 'node_modules');
      expect(result.req.scope).not.toBe(path.resolve(source));
      expect(fs.lstatSync(modules).isDirectory()).toBe(true);
      expect(fs.lstatSync(modules).isSymbolicLink()).toBe(false);
      expect(dependencyOutput(result.req.scope)).toBe('dependency-ready');
    }
  });

  test('a write in one concurrent worktree node_modules never reaches its sibling or source', () => {
    const source = repo();
    const cfg = {
      ...DEFAULT_CONFIG,
      projectConcurrency: { fixture: 2 },
    };
    const first = isolateSpawnRequest(request(source, 'write-isolation-a'), cfg);
    const second = isolateSpawnRequest(request(source, 'write-isolation-b'), cfg);
    if (!first.ok) throw new Error(first.reason);
    if (!second.ok) throw new Error(second.reason);
    const relative = path.join('node_modules', 'fixture-dependency', 'worktree-a-only');
    fs.writeFileSync(path.join(first.req.scope, relative), 'private');
    expect(fs.existsSync(path.join(second.req.scope, relative))).toBe(false);
    expect(fs.existsSync(path.join(source, relative))).toBe(false);
  });

  test('projectConcurrency one keeps the original shared-link behavior', () => {
    const source = repo();
    const result = isolateSpawnRequest(request(source, 'single-isolation'), {
      ...DEFAULT_CONFIG,
      projectConcurrency: { fixture: 1 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    const modules = path.join(result.req.scope, 'node_modules');
    expect(fs.lstatSync(modules).isSymbolicLink()).toBe(true);
    expect(dependencyOutput(result.req.scope)).toBe('dependency-ready');
  });
});
