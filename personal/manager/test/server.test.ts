import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-server-'));
const REPO = fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-server-repo-'));
process.env.MANAGER_HOME = HOME;
process.env.GSTACK_GATE_LOG_DIR = path.join(HOME, 'gate-log');

import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import { resetConfigCache } from '../config';
import { __resetEvents, approvalId, emit, subscribe, subscriberCount } from '../lib/events';
import { __clearWaiters } from '../lib/locks';
import { Orchestrator } from '../lib/orchestrator';
import { ensureManagerDirs, portFile, projectsFile, tokenFile } from '../lib/paths';
import type { SpawnPort } from '../lib/spawn';
import { loadTask, writeState } from '../lib/store';
import { buildFetchHandler, mintToken, readToken, startServer } from '../server';
import { emptyState, type TaskEnvelope, type TaskSource } from '../types';

const PROJECT = 'fixture';
const TOKEN = 'test-token';

function envelopeJson(overrides: Partial<TaskEnvelope> = {}): string {
  const envelope: TaskEnvelope = {
    project: PROJECT,
    issue: 't1',
    title: 'a bug',
    size: 'S',
    uncertainty: 'low',
    lane: 'bug-nho',
    why: 'small',
    oracle_available: true,
    oracle_kind: ['tsc'],
    needs_human: true,
    blocking_questions: [],
    assumptions: [],
    assumption_count: 0,
    est_cost_usd: 0.1,
    est_turns: 5,
    ...overrides,
  };
  return `\`\`\`json\n${JSON.stringify(envelope)}\n\`\`\``;
}

const PASS_VERDICT = `\`\`\`json\n${JSON.stringify({ verdict: 'pass', reason: 'ok', gates: [] })}\n\`\`\``;

/** What the project's own runner prints. B8-assert is run by the manager. */
const GREEN_SUITE = [' 4 pass', ' 0 fail', 'Ran 4 tests across 1 files.'].join('\n');

const port: SpawnPort = {
  async run(req) {
    return {
      output: req.prompt.startsWith('Size issue') ? envelopeJson() : PASS_VERDICT,
      exitReason: 'success',
      turnsUsed: 1,
      costUsd: 0.05,
      model: req.modelAlias,
      sessionId: 'sess',
      durationMs: 1,
    };
  },
};

interface Handler {
  handle: (req: Request) => Promise<Response>;
  manager: Orchestrator;
  brainstormCalls: Array<{ text: string; source: string }>;
}

function makeHandler(): Handler {
  const manager = new Orchestrator({
    spawnPort: port,
    reviewPort: port,
    blindSample: () => false,
    exec: async () => ({ exitCode: 0, stdout: GREEN_SUITE, stderr: '', timedOut: false }),
    diff: () => ({ ok: true, text: '+ fixed', truncated: false, error: '' }),
  });
  const brainstormCalls: Array<{ text: string; source: string }> = [];
  const handle = buildFetchHandler({
    orchestrator: manager,
    token: TOKEN,
    brainstormFn: async (text: string, source: TaskSource = 'cli') => {
      brainstormCalls.push({ text, source });
      return { reply: `echo: ${text}`, cost_usd: 0 };
    },
  });
  return { handle, manager, brainstormCalls };
}

function request(method: string, route: string, body?: unknown, token = TOKEN): Request {
  return new Request(`http://127.0.0.1${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Manager-Token': token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  fs.rmSync(path.join(HOME, 'manager', 'tasks'), { recursive: true, force: true });
  fs.rmSync(path.join(HOME, 'gate-log'), { recursive: true, force: true });
  writeState(emptyState());
  ensureManagerDirs();
  fs.writeFileSync(projectsFile(), JSON.stringify({ [PROJECT]: { path: REPO, assert: ['bun run test'] } }));
  resetConfigCache();
  __clearWaiters();
  __resetEvents();
});

afterAll(() => {
  for (const dir of [HOME, REPO]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

describe('auth', () => {
  test('a missing token is 401 on every route', async () => {
    const { handle } = makeHandler();
    for (const route of ['/tasks', '/cost', '/events']) {
      const response = await handle(new Request(`http://127.0.0.1${route}`));
      expect(response.status).toBe(401);
    }
  });

  test('a wrong token is 401', async () => {
    const { handle } = makeHandler();
    expect((await handle(request('GET', '/tasks', undefined, 'nope'))).status).toBe(401);
  });

  test('the boot token is 64 hex chars and lands in the token file', () => {
    const token = mintToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(readToken()).toBe(token);
    expect(fs.existsSync(tokenFile())).toBe(true);
  });

  test('every boot mints a new token', () => {
    expect(mintToken()).not.toBe(mintToken());
  });
});

describe('task routes', () => {
  test('POST /task returns a task id', async () => {
    const { handle } = makeHandler();
    const response = await handle(request('POST', '/task', { project: PROJECT, issue: 't1', source: 'cli' }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { taskId: string };
    expect(body.taskId).toStartWith('fixture-t1-');
  });

  test('POST /task without project or issue is 400', async () => {
    const { handle } = makeHandler();
    expect((await handle(request('POST', '/task', { issue: 't1' }))).status).toBe(400);
    expect((await handle(request('POST', '/task', { project: PROJECT }))).status).toBe(400);
  });

  test('POST /task for an unregistered project is 400 with the reason', async () => {
    const { handle } = makeHandler();
    const response = await handle(request('POST', '/task', { project: 'ghost', issue: 't1' }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('unknown project');
  });

  test('GET /tasks lists what was submitted', async () => {
    const { handle, manager } = makeHandler();
    const created = await handle(request('POST', '/task', { project: PROJECT, issue: 't1' }));
    const { taskId } = (await created.json()) as { taskId: string };
    await manager.settle(taskId);

    const response = await handle(request('GET', '/tasks'));
    const tasks = (await response.json()) as Array<{ id: string; state: string }>;
    expect(tasks.map((t) => t.id)).toContain(taskId);
  });

  test('GET /task/:id returns the record, unknown ids are 404', async () => {
    const { handle, manager } = makeHandler();
    const created = await handle(request('POST', '/task', { project: PROJECT, issue: 't1' }));
    const { taskId } = (await created.json()) as { taskId: string };
    await manager.settle(taskId);

    const ok = await handle(request('GET', `/task/${taskId}`));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { id: string }).id).toBe(taskId);
    expect((await handle(request('GET', '/task/nope-01'))).status).toBe(404);
  });

  test('approve, answer and stop all work over HTTP', async () => {
    const { handle, manager } = makeHandler();
    const created = await handle(request('POST', '/task', { project: PROJECT, issue: 't1' }));
    const { taskId } = (await created.json()) as { taskId: string };
    await manager.settle(taskId);
    expect(loadTask(taskId)?.state).toBe('APPROVAL');

    const answered = await handle(request('POST', `/task/${taskId}/answer`, { text: 'go ahead' }));
    expect(answered.status).toBe(200);
    expect(loadTask(taskId)?.human_touches).toBe(1);

    const approved = await handle(request('POST', `/task/${taskId}/approve`, { approved: true }));
    expect(approved.status).toBe(200);
    await manager.settle(taskId);
    expect(loadTask(taskId)?.state).toBe('REPORTED');

    const stopped = await handle(request('POST', `/task/${taskId}/stop`));
    expect(stopped.status).toBe(200);
  });

  test('approve without a boolean is 400', async () => {
    const { handle, manager } = makeHandler();
    const created = await handle(request('POST', '/task', { project: PROJECT, issue: 't1' }));
    const { taskId } = (await created.json()) as { taskId: string };
    await manager.settle(taskId);
    expect((await handle(request('POST', `/task/${taskId}/approve`, { approved: 'yes' }))).status).toBe(400);
  });

  test('a GET on an action route is 405', async () => {
    const { handle } = makeHandler();
    expect((await handle(request('GET', '/task/x-01/stop'))).status).toBe(405);
  });
});

describe('stopall and cost', () => {
  test('POST /stopall reports the count', async () => {
    const { handle, manager } = makeHandler();
    const a = await handle(request('POST', '/task', { project: PROJECT, issue: 'a' }));
    const b = await handle(request('POST', '/task', { project: PROJECT, issue: 'b' }));
    await manager.settle(((await a.json()) as { taskId: string }).taskId);
    await manager.settle(((await b.json()) as { taskId: string }).taskId);

    const response = await handle(request('POST', '/stopall'));
    expect(((await response.json()) as { stopped: number }).stopped).toBe(2);
  });

  test('GET /cost returns the three documented keys', async () => {
    const { handle, manager } = makeHandler();
    const created = await handle(request('POST', '/task', { project: PROJECT, issue: 't1' }));
    await manager.settle(((await created.json()) as { taskId: string }).taskId);

    const response = await handle(request('GET', '/cost?window=today'));
    const body = (await response.json()) as { usd: number; byLane: unknown; byProject: unknown };
    expect(body.usd).toBeGreaterThan(0);
    expect(body.byProject).toHaveProperty(PROJECT);
    expect(body.byLane).toBeDefined();
  });

  test('GET /cost defaults to today and accepts all', async () => {
    const { handle } = makeHandler();
    expect((await handle(request('GET', '/cost'))).status).toBe(200);
    expect((await handle(request('GET', '/cost?window=all'))).status).toBe(200);
  });
});

describe('brainstorm', () => {
  test('POST /prompt answers without creating a task', async () => {
    const { handle } = makeHandler();
    const response = await handle(request('POST', '/prompt', { text: 'what should I do next' }));
    expect(((await response.json()) as { reply: string }).reply).toContain('what should I do next');
    const tasks = (await (await handle(request('GET', '/tasks'))).json()) as unknown[];
    expect(tasks).toHaveLength(0);
  });

  test('POST /prompt without text is 400', async () => {
    const { handle } = makeHandler();
    expect((await handle(request('POST', '/prompt', {}))).status).toBe(400);
  });
});

describe('SSE', () => {
  test('events reach a subscriber and the subscriber is cleaned up on abort', async () => {
    const { handle } = makeHandler();
    const controller = new AbortController();
    const response = await handle(
      new Request('http://127.0.0.1/events', {
        headers: { 'X-Manager-Token': TOKEN },
        signal: controller.signal,
      }),
    );
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(subscriberCount()).toBe(1);

    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    emit({ type: 'report', taskId: 't', project: PROJECT, issue: 'i', state: 'REPORTED', text: 'done' });
    const chunk = new TextDecoder().decode((await reader.read()).value);
    expect(chunk).toContain('event: manager');
    expect(chunk).toContain('"type":"report"');

    controller.abort();
    await new Promise((r) => setTimeout(r, 10));
    expect(subscriberCount()).toBe(0);
  });

  test('a dead consumer is dropped on the next event rather than leaking', async () => {
    const { handle } = makeHandler();
    const response = await handle(request('GET', '/events'));
    expect(subscriberCount()).toBe(1);
    await (response.body as ReadableStream).cancel();
    emit({ type: 'report', taskId: 't', project: PROJECT, issue: 'i', state: 'REPORTED', text: 'x' });
    await new Promise((r) => setTimeout(r, 10));
    expect(subscriberCount()).toBe(0);
  });
});

describe('routing', () => {
  test('an unknown route is 404', async () => {
    const { handle } = makeHandler();
    expect((await handle(request('GET', '/nope'))).status).toBe(404);
  });

  test('a trailing slash resolves to the same route', async () => {
    const { handle } = makeHandler();
    expect((await handle(request('GET', '/tasks/'))).status).toBe(200);
  });
});

describe('a real listener', () => {
  test('binds loopback, writes the port file, and serves over TCP', async () => {
    const manager = new Orchestrator({ spawnPort: port, reviewPort: port, blindSample: () => false });
    const server = startServer(manager, 0);
    try {
      expect(server.port).toBeGreaterThan(0);
      expect(fs.readFileSync(portFile(), 'utf-8').trim()).toBe(String(server.port));

      const response = await fetch(`http://127.0.0.1:${server.port}/tasks`, {
        headers: { 'X-Manager-Token': server.token },
      });
      expect(response.status).toBe(200);

      const unauthorized = await fetch(`http://127.0.0.1:${server.port}/tasks`);
      expect(unauthorized.status).toBe(401);
    } finally {
      server.stop();
    }
    expect(fs.existsSync(portFile())).toBe(false);
  });
});

describe('source travels on every state-changing route', () => {
  test('POST /prompt carries the caller source through to brainstorm', async () => {
    const { handle, brainstormCalls } = makeHandler();
    await handle(request('POST', '/prompt', { text: 'from the phone', source: 'telegram' }));
    await handle(request('POST', '/prompt', { text: 'from the shell' }));
    await handle(request('POST', '/prompt', { text: 'legacy spelling', source: 'http' }));
    expect(brainstormCalls.map((c) => c.source)).toEqual(['telegram', 'cli', 'api']);
  });

  test('an unknown source falls back to cli rather than being trusted', async () => {
    const { handle, brainstormCalls } = makeHandler();
    await handle(request('POST', '/prompt', { text: 'x', source: 'root' }));
    expect(brainstormCalls[0].source).toBe('cli');
  });

  test('POST /task records the source on the task', async () => {
    const { handle, manager } = makeHandler();
    const created = await handle(request('POST', '/task', { project: PROJECT, issue: 't1', source: 'telegram' }));
    const { taskId } = (await created.json()) as { taskId: string };
    await manager.settle(taskId);
    expect(loadTask(taskId)?.source).toBe('telegram');
  });

  test('an answer from Telegram is marked as such in the record', async () => {
    const { handle, manager } = makeHandler();
    const created = await handle(request('POST', '/task', { project: PROJECT, issue: 't1' }));
    const { taskId } = (await created.json()) as { taskId: string };
    await manager.settle(taskId);
    await handle(request('POST', `/task/${taskId}/answer`, { text: 'yes', source: 'telegram' }));
    expect(loadTask(taskId)?.answers[0]).toContain('[telegram]');
  });
});

describe('GET /task/:id/diff', () => {
  test('unknown task is 404', async () => {
    const { handle } = makeHandler();
    expect((await handle(request('GET', '/task/nope-01/diff'))).status).toBe(404);
  });

  test('a scope that is not a git work tree is 409, not a silent empty diff', async () => {
    const { handle, manager } = makeHandler();
    const created = await handle(request('POST', '/task', { project: PROJECT, issue: 't1' }));
    const { taskId } = (await created.json()) as { taskId: string };
    await manager.settle(taskId);
    const response = await handle(request('GET', `/task/${taskId}/diff`));
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toContain('not a git work tree');
  });

  test('POST is rejected — the diff route is read-only', async () => {
    const { handle } = makeHandler();
    expect((await handle(request('POST', '/task/x-01/diff'))).status).toBe(405);
  });
});

describe('approval events carry a stable id', () => {
  test('the same task and action always produce the same approvalId', () => {
    expect(approvalId('kivora-t105-01', 'git push', 1)).toBe(approvalId('kivora-t105-01', 'git push', 1));
  });

  test('a different task, action, or attempt produces a different id', () => {
    const base = approvalId('kivora-t105-01', 'git push', 1);
    expect(approvalId('kivora-t105-02', 'git push', 1)).not.toBe(base);
    expect(approvalId('kivora-t105-01', 'deploy', 1)).not.toBe(base);
    expect(approvalId('kivora-t105-01', 'git push', 2)).not.toBe(base);
  });

  test('it fits inside a Telegram callback_data budget', () => {
    expect(approvalId('a-very-long-task-id-that-goes-on', 'some action', 3).length).toBeLessThanOrEqual(16);
  });

  test('the approval that reaches SSE carries taskId, action and approvalId', async () => {
    const { handle, manager } = makeHandler();
    const seen: unknown[] = [];
    const stop = subscribe((e) => seen.push(e));
    const created = await handle(request('POST', '/task', { project: PROJECT, issue: 't1', source: 'telegram' }));
    const { taskId } = (await created.json()) as { taskId: string };
    await manager.settle(taskId);
    stop();
    const approval = seen.find((e) => (e as { type: string }).type === 'approval') as Record<string, unknown>;
    expect(approval).toBeDefined();
    expect(approval.taskId).toBe(taskId);
    expect(typeof approval.action).toBe('string');
    expect(typeof approval.detail).toBe('string');
    expect(String(approval.approvalId)).toMatch(/^[0-9a-f]{12}$/);
  });
});
