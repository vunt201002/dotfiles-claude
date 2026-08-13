import fs from 'node:fs';
import type { Paths } from './config';
import { registerSecret } from './logger';
import type { FetchLike } from './telegram-api';

export class ManagerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManagerUnavailableError';
  }
}

export class ManagerRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ManagerRequestError';
  }
}

export interface TaskRecord {
  id?: string;
  state?: string;
  envelope?: {
    project?: string;
    issue?: string;
    title?: string;
    lane?: string;
    size?: string;
  };
  attempt?: number;
  max_attempts?: number;
  review_depth?: string;
  cost_usd_actual?: number;
  human_touches?: number;
  holds?: string[];
  diff?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface CostReport {
  usd?: number;
  byLane?: Record<string, number>;
  byProject?: Record<string, number>;
}

export interface ReportEvent {
  type: 'report';
  taskId?: string;
  project?: string;
  issue?: string;
  lane?: string;
  attempt?: number;
  cost_usd?: number;
  ok?: boolean;
  cause?: string;
  gates?: Array<{ gate?: string; gate_family?: string; caught?: string; verdict?: string }>;
  verify?: string[];
  assumptions?: string[];
  status?: string;
}

export interface QuestionEvent {
  type: 'question';
  taskId: string;
  project?: string;
  issue?: string;
  text: string;
}

export interface ApprovalEvent {
  type: 'approval';
  taskId: string;
  project?: string;
  issue?: string;
  action: string;
  detail?: string;
  diff?: string;
}

export type ManagerEvent = ReportEvent | QuestionEvent | ApprovalEvent;

interface Endpoint {
  base: string;
  token: string;
}

/**
 * Talks to the manager daemon on 127.0.0.1. Port and token are re-read on every
 * call so a manager restart on a new port needs no bot restart.
 */
export class ManagerClient {
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly paths: Pick<Paths, 'portFile' | 'tokenFile'>,
    fetchImpl?: FetchLike,
  ) {
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init));
  }

  endpoint(): Endpoint {
    let port: string;
    let token: string;
    try {
      port = fs.readFileSync(this.paths.portFile, 'utf8').trim();
    } catch {
      throw new ManagerUnavailableError('manager chưa chạy (không đọc được file port)');
    }
    try {
      token = fs.readFileSync(this.paths.tokenFile, 'utf8').trim();
    } catch {
      throw new ManagerUnavailableError('manager chưa chạy (không đọc được file token)');
    }
    const parsed = Number(port);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      throw new ManagerUnavailableError('file port của manager không hợp lệ');
    }
    if (!token) throw new ManagerUnavailableError('file token của manager rỗng');
    registerSecret(token);
    return { base: `http://127.0.0.1:${parsed}`, token };
  }

  async request<T>(method: string, pathname: string, body?: unknown, timeoutMs = 20_000): Promise<T> {
    const { base, token } = this.endpoint();
    let response: Response;
    try {
      response = await this.fetchImpl(`${base}${pathname}`, {
        method,
        headers: {
          'content-type': 'application/json',
          'X-Manager-Token': token,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new ManagerUnavailableError(`manager không phản hồi (${(err as Error).message})`);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ManagerRequestError(`manager trả HTTP ${response.status} ${detail.slice(0, 200)}`.trim(), response.status);
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (!text.trim()) return undefined as T;
    return JSON.parse(text) as T;
  }

  createTask(project: string, issue: string): Promise<{ taskId: string }> {
    return this.request('POST', '/task', { project, issue, source: 'telegram' });
  }

  listTasks(): Promise<TaskRecord[]> {
    return this.request('GET', '/tasks');
  }

  getTask(taskId: string): Promise<TaskRecord> {
    return this.request('GET', `/task/${encodeURIComponent(taskId)}`);
  }

  approve(taskId: string, approved: boolean): Promise<{ ok: boolean }> {
    return this.request('POST', `/task/${encodeURIComponent(taskId)}/approve`, { approved });
  }

  answer(taskId: string, text: string): Promise<{ ok: boolean }> {
    return this.request('POST', `/task/${encodeURIComponent(taskId)}/answer`, { text });
  }

  stop(taskId: string): Promise<{ ok: boolean }> {
    return this.request('POST', `/task/${encodeURIComponent(taskId)}/stop`, {});
  }

  /** Kill switch. Short timeout on purpose: it must answer while the manager is busy. */
  stopAll(timeoutMs = 8_000): Promise<{ stopped: number }> {
    return this.request('POST', '/stopall', {}, timeoutMs);
  }

  cost(window: 'today' | 'all'): Promise<CostReport> {
    return this.request('GET', `/cost?window=${window}`);
  }

  prompt(text: string, timeoutMs = 120_000): Promise<{ reply: string }> {
    return this.request('POST', '/prompt', { text }, timeoutMs);
  }

  /** Yields decoded `/events` frames until the stream ends or the signal aborts. */
  async *events(signal: AbortSignal): AsyncGenerator<ManagerEvent> {
    const { base, token } = this.endpoint();
    let response: Response;
    try {
      response = await this.fetchImpl(`${base}/events`, {
        method: 'GET',
        headers: { 'X-Manager-Token': token, accept: 'text/event-stream' },
        signal,
      });
    } catch (err) {
      throw new ManagerUnavailableError(`không mở được /events (${(err as Error).message})`);
    }
    if (!response.ok || !response.body) {
      throw new ManagerUnavailableError(`/events trả HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (!signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const event = decodeFrame(frame);
          if (event) yield event;
          boundary = buffer.indexOf('\n\n');
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }
  }
}

export function decodeFrame(frame: string): ManagerEvent | undefined {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data.trim()) return undefined;
  try {
    const parsed = JSON.parse(data) as ManagerEvent;
    if (parsed && typeof parsed === 'object' && typeof parsed.type === 'string') return parsed;
  } catch {
    return undefined;
  }
  return undefined;
}
