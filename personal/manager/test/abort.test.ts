import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-abort-'));
process.env.MANAGER_HOME = HOME;
process.env.GSTACK_GATE_LOG_DIR = path.join(HOME, 'gate-log');

import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import { __clearTaskAborts, abortTask, type SpawnPort } from '../lib/spawn';
import { Orchestrator } from '../lib/orchestrator';
import { ensureManagerDirs, projectsFile } from '../lib/paths';
import { __clearWaiters } from '../lib/locks';
import { loadTask, writeState } from '../lib/store';
import { resetConfigCache } from '../config';
import { emptyState } from '../types';

const PROJECT = 'fixture';
const REPO = fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-abort-repo-'));

function idleReply(): SpawnPort {
  return {
    async run() {
      return {
        output: 'no verdict block',
        outputs: ['no verdict block'],
        exitReason: 'success',
        turnsUsed: 1,
        costUsd: 0,
        costKnown: true,
        model: 'sonnet',
        sessionId: '',
        durationMs: 1,
        worktreeCreated: false,
      };
    },
  };
}

beforeEach(() => {
  fs.rmSync(path.join(HOME, 'manager', 'tasks'), { recursive: true, force: true });
  writeState(emptyState());
  ensureManagerDirs();
  fs.writeFileSync(projectsFile(), JSON.stringify({ [PROJECT]: REPO }, null, 2));
  resetConfigCache();
  __clearWaiters();
  __clearTaskAborts();
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

// A kill switch reachable from a phone has to stop the spending, not just
// relabel the record. Marking a task FAILED while its query runs on to the
// turn budget is the failure these cover.

describe('stop cancels the in-flight run, not just the record', () => {
  test('abortTask reports whether there was anything to cancel', () => {
    expect(abortTask('never-spawned')).toBe(false);
  });

  test('every spawn carries a signal the task can be stopped with', async () => {
    const seen: Array<AbortSignal | undefined> = [];
    const port: SpawnPort = {
      async run(req) {
        seen.push(req.signal);
        return idleReply().run(req);
      },
    };
    const manager = new Orchestrator({ spawnPort: port, reviewPort: port, blindSample: () => false });
    const { taskId } = await manager.submit({ project: PROJECT, issue: 't1', source: 'cli' });
    await manager.settle(taskId);

    expect(seen.length).toBeGreaterThan(0);
    for (const signal of seen) expect(signal).toBeInstanceOf(AbortSignal);
  });

  test('stop() aborts the run that is in flight', async () => {
    let sawAbort = false;
    const port: SpawnPort = {
      async run(req) {
        await new Promise<void>((resolve) => {
          req.signal?.addEventListener(
            'abort',
            () => {
              sawAbort = true;
              resolve();
            },
            { once: true },
          );
          setTimeout(resolve, 400);
        });
        return idleReply().run(req);
      },
    };

    const manager = new Orchestrator({ spawnPort: port, reviewPort: port, blindSample: () => false });
    const { taskId } = await manager.submit({ project: PROJECT, issue: 't2', source: 'cli' });
    await new Promise((r) => setTimeout(r, 30));

    await manager.stop(taskId);
    await manager.settle(taskId);

    expect(sawAbort, 'stop() marked the task FAILED but left the run going').toBe(true);
    expect(loadTask(taskId)?.state).toBe('FAILED');
  });

  test('stopAll aborts every live task', async () => {
    const aborted: string[] = [];
    const port: SpawnPort = {
      async run(req) {
        await new Promise<void>((resolve) => {
          req.signal?.addEventListener(
            'abort',
            () => {
              aborted.push(req.taskId);
              resolve();
            },
            { once: true },
          );
          setTimeout(resolve, 400);
        });
        return idleReply().run(req);
      },
    };

    const manager = new Orchestrator({ spawnPort: port, reviewPort: port, blindSample: () => false });
    const a = await manager.submit({ project: PROJECT, issue: 'a', source: 'cli' });
    const b = await manager.submit({ project: PROJECT, issue: 'b', source: 'cli' });
    await new Promise((r) => setTimeout(r, 30));

    await manager.stopAll();
    await Promise.all([manager.settle(a.taskId), manager.settle(b.taskId)]);

    expect(aborted).toContain(a.taskId);
  });

  test('a finished task drops its handle so there is nothing left to abort', async () => {
    const port = idleReply();
    const manager = new Orchestrator({ spawnPort: port, reviewPort: port, blindSample: () => false });
    const { taskId } = await manager.submit({ project: PROJECT, issue: 't3', source: 'cli' });
    await manager.settle(taskId);
    expect(abortTask(taskId)).toBe(false);
  });
});
