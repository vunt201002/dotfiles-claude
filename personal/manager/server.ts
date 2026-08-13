/**
 * Local HTTP API (§6.1). The Telegram bot is coded against this contract, so
 * the routes and payloads below are fixed.
 *
 *   POST /task              {project, issue, source}   -> {taskId}
 *   GET  /tasks                                        -> TaskRecord[]
 *   GET  /task/:id                                     -> TaskRecord
 *   POST /task/:id/approve  {approved, source}         -> {ok}
 *   POST /task/:id/answer   {text, source}              -> {ok}
 *   POST /task/:id/stop                                -> {ok}
 *   GET  /task/:id/diff                                -> text/plain
 *   POST /stopall                                      -> {stopped}
 *   GET  /cost?window=today|all                        -> {usd, byLane, byProject}
 *   POST /prompt            {text, source}             -> {reply}
 *   GET  /events            SSE                        -> report | question | approval
 *
 * Binds loopback only, never 0.0.0.0: anyone who can reach this port can start
 * a bypass-permissions agent on eight repositories. Every request carries
 * X-Manager-Token, minted fresh at boot.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import { createSseEndpoint } from '../../browse/src/sse-helpers';
import { loadConfig } from './config';
import { brainstorm } from './lib/brainstorm';
import { costBreakdown } from './lib/cost';
import { readDiff } from './lib/git';
import { subscribe, type ManagerEvent } from './lib/events';
import { Orchestrator } from './lib/orchestrator';
import { ensureManagerDirs, pidFile, portFile, tokenFile } from './lib/paths';
import { listTasks, loadTask } from './lib/store';
import type { TaskSource } from './types';

const SOURCES: readonly TaskSource[] = ['cli', 'api', 'telegram'];

/**
 * `source` travels on every state-changing route, not just POST /task.
 * A tighter policy has to key off where the request came from; keying off the
 * endpoint instead leaves free text from a phone — the widest surface there
 * is — running under the loose one. 'http' is accepted as a legacy spelling
 * of 'api'. Absent means 'cli'.
 */
function readSource(body: Record<string, unknown>): TaskSource {
  const raw = typeof body.source === 'string' ? body.source : '';
  if (raw === 'http') return 'api';
  return SOURCES.includes(raw as TaskSource) ? (raw as TaskSource) : 'cli';
}

export function mintToken(): string {
  ensureManagerDirs();
  const token = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(tokenFile(), token, { mode: 0o600 });
  try {
    fs.chmodSync(tokenFile(), 0o600);
  } catch {
    // Windows maps this onto the read-only bit; loopback binding is the real
    // boundary there, not the file mode.
  }
  return token;
}

export function readToken(): string {
  try {
    return fs.readFileSync(tokenFile(), 'utf-8').trim();
  } catch {
    return '';
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export interface HandlerDeps {
  orchestrator: Orchestrator;
  token: string;
  brainstormFn?: typeof brainstorm;
}

export function buildFetchHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  const { orchestrator, token } = deps;
  const brainstormFn = deps.brainstormFn ?? brainstorm;

  async function route(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    if (req.headers.get('X-Manager-Token') !== token) {
      return json({ error: 'bad or missing X-Manager-Token' }, 401);
    }

    if (req.method === 'GET' && pathname === '/events') {
      return createSseEndpoint<ManagerEvent>(req, {
        subscribe: (notify) => subscribe(notify),
        liveEventName: 'manager',
      });
    }

    if (req.method === 'POST' && pathname === '/task') {
      const body = await readJsonBody(req);
      const project = typeof body.project === 'string' ? body.project.trim() : '';
      const issue = typeof body.issue === 'string' ? body.issue.trim() : '';
      const source = readSource(body);
      if (!project || !issue) return json({ error: 'project and issue are required' }, 400);
      const result = await orchestrator.submit({ project, issue, source });
      if (!result.accepted) return json({ error: result.error }, 400);
      return json({ taskId: result.taskId });
    }

    if (req.method === 'GET' && pathname === '/tasks') {
      return json(listTasks());
    }

    if (req.method === 'POST' && pathname === '/stopall') {
      const stopped = await orchestrator.stopAll();
      return json({ stopped });
    }

    if (req.method === 'GET' && pathname === '/cost') {
      const window = url.searchParams.get('window') === 'all' ? 'all' : 'today';
      return json(costBreakdown(listTasks(), window));
    }

    if (req.method === 'POST' && pathname === '/prompt') {
      const body = await readJsonBody(req);
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text) return json({ error: 'text is required' }, 400);
      const result = await brainstormFn(text, readSource(body));
      return json({ reply: result.reply });
    }

    const taskMatch = pathname.match(/^\/task\/([^/]+)(?:\/(approve|answer|stop|diff))?$/);
    if (taskMatch) {
      const id = decodeURIComponent(taskMatch[1]);
      const action = taskMatch[2];
      if (!action) {
        if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405);
        const task = loadTask(id);
        return task ? json(task) : json({ error: `no such task ${id}` }, 404);
      }
      if (action === 'diff') {
        if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405);
        const task = loadTask(id);
        if (!task) return json({ error: `no such task ${id}` }, 404);
        const diff = readDiff(task.scope);
        if (!diff.ok) return json({ error: diff.error }, 409);
        return new Response(diff.text, {
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Diff-Truncated': String(diff.truncated) },
        });
      }
      if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
      if (action === 'approve') {
        const body = await readJsonBody(req);
        if (typeof body.approved !== 'boolean') return json({ error: 'approved must be a boolean' }, 400);
        const result = await orchestrator.approve(id, body.approved, readSource(body));
        return result.ok ? json({ ok: true }) : json({ ok: false, error: result.error }, 400);
      }
      if (action === 'answer') {
        const body = await readJsonBody(req);
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        if (!text) return json({ error: 'text is required' }, 400);
        const result = await orchestrator.answer(id, text, readSource(body));
        return result.ok ? json({ ok: true }) : json({ ok: false, error: result.error }, 404);
      }
      const result = await orchestrator.stop(id);
      return result.ok ? json({ ok: true }) : json({ ok: false, error: result.error }, 404);
    }

    return json({ error: `no route for ${req.method} ${pathname}` }, 404);
  }

  /**
   * A throw from any handler becomes a 500 with a readable body. Without this
   * the daemon answers a bare Bun 500 with no reason, and the phone client
   * shows a blank failure for what is usually a one-line cause.
   */
  return async function handle(req: Request): Promise<Response> {
    try {
      return await route(req);
    } catch (err) {
      return json({ error: `manager failed handling the request: ${(err as Error).message}` }, 500);
    }
  };
}

export interface StartedServer {
  port: number;
  token: string;
  stop: () => void;
}

export function startServer(orchestrator: Orchestrator, portOverride?: number): StartedServer {
  const cfg = loadConfig();
  const token = mintToken();
  const server = Bun.serve({
    hostname: cfg.host,
    port: portOverride ?? cfg.port,
    fetch: buildFetchHandler({ orchestrator, token }),
  });
  ensureManagerDirs();
  fs.writeFileSync(portFile(), String(server.port));
  fs.writeFileSync(pidFile(), String(process.pid));
  return {
    port: server.port,
    token,
    stop: () => {
      server.stop(true);
      safeRemove(portFile());
      safeRemove(pidFile());
    },
  };
}

function safeRemove(file: string): void {
  try {
    fs.unlinkSync(file);
  } catch {
    // Shutdown path: a file already gone is the desired end state.
  }
}
