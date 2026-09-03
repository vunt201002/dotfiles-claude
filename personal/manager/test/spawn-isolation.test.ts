import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'manager-spawn-isolation-'));
process.env.MANAGER_HOME = HOME;

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { runAgentSdkTest, type QueryProvider } from '../../../test/helpers/agent-sdk-runner';
import { DEFAULT_CONFIG, SPAWN_RUNNERS } from '../config';
import {
  agentSdkRunOptions,
  isolateSpawnRequest,
  SDK_SCOPED_WRITE_TOOLS,
  SPAWN_WRITE_FENCES,
  sdkPermissionOptions,
  spawnPortForRunner,
  type SpawnRequest,
} from '../lib/spawn';

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
  test('SDK settings stay hermetic and Edit/Write cannot escape the task scope', async () => {
    const scope = path.join(HOME, 'manager-sdk-scope');
    const outside = path.join(HOME, 'manager-sdk-outside');
    fs.mkdirSync(scope, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.symlinkSync(outside, path.join(scope, 'linked-outside'));
    const options = sdkPermissionOptions(scope);
    const permission = options.canUseTool!;
    const context = { signal: new AbortController().signal, toolUseID: 'scope-check' };

    expect(options.settingSources).toEqual([]);
    expect((await permission('Write', { file_path: path.join(scope, 'inside.ts') }, context)).behavior).toBe('allow');
    expect((await permission('Edit', { file_path: '../outside.ts' }, context)).behavior).toBe('deny');
    expect((await permission('Write', { file_path: `${scope}-sibling/file.ts` }, context)).behavior).toBe('deny');
    expect((await permission('Write', { file_path: path.join(scope, 'linked-outside/file.ts') }, context)).behavior).toBe('deny');
    expect((await permission('Write', {}, context)).behavior).toBe('deny');
    expect((await permission('AskUserQuestion', { questions: [] }, context)).behavior).toBe('deny');
    expect((await permission('Bash', { command: 'pwd' }, context)).behavior).toBe('allow');
  });

  test('production SDK wiring keeps writes available but removes their auto-allow rules', async () => {
    const captured: Options[] = [];
    const queryProvider: QueryProvider = (params) => {
      if (params.options) captured.push(params.options);
      const stream = (async function* (): AsyncGenerator<SDKMessage, void> {
        yield {
          type: 'result',
          subtype: 'success',
          total_cost_usd: 0,
          num_turns: 1,
        } as unknown as SDKMessage;
      })();
      return stream as ReturnType<QueryProvider>;
    };
    const req = request(path.join(HOME, 'sdk-wiring-scope'), 'sdk-wiring');

    await runAgentSdkTest(agentSdkRunOptions(req, DEFAULT_CONFIG, queryProvider));

    expect(captured).toHaveLength(1);
    expect(captured[0]!.tools).toEqual(DEFAULT_CONFIG.spawn.cli.allowedTools);
    expect(captured[0]!.allowedTools).toEqual([]);
    expect(captured[0]!.tools).toContain('Write');
    expect(captured[0]!.tools).not.toContain('AskUserQuestion');
    expect(captured[0]!.allowedTools).not.toContain('Write');
    expect(typeof captured[0]!.canUseTool).toBe('function');
    expect(
      DEFAULT_CONFIG.spawn.cli.allowedTools.filter(
        (tool) => tool !== 'TodoWrite' && /edit|write|patch/i.test(tool),
      ),
    ).toEqual([...SDK_SCOPED_WRITE_TOOLS]);
  });

  test('every selectable spawn runner declares its write-fence status', () => {
    expect(Object.keys(SPAWN_WRITE_FENCES).sort()).toEqual([...SPAWN_RUNNERS].sort());
    expect(SPAWN_WRITE_FENCES).toEqual({
      sdk: 'sdk-permission',
      cli: 'unfenced',
      cmux: 'pre-tool-use-hook',
    });
  });

  test('the manager refuses to select a runner declared unfenced', () => {
    expect(() => spawnPortForRunner('cli')).toThrow('manager spawn runner "cli" is unfenced');
    expect(spawnPortForRunner('sdk')).toBeDefined();
    expect(spawnPortForRunner('cmux')).toBeDefined();
  });

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
