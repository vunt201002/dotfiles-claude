import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { ensureManagerDirs, managerDir, stateFile, tasksDir } from '../lib/paths';
import { listTaskIds, mutateState, readState, writeState } from '../lib/store';
import { emptyState } from '../types';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'manager-store-'));
process.env.MANAGER_HOME = HOME;

beforeEach(() => {
  fs.rmSync(managerDir(), { recursive: true, force: true });
});

afterAll(() => {
  fs.rmSync(HOME, { recursive: true, force: true });
});

describe('state reads preserve evidence', () => {
  test('mutateState preserves every state-file byte when a transient read fails', async () => {
    ensureManagerDirs();
    const state = emptyState();
    state.tasks['still-running'] = { state: 'RUNNING', project: 'joy', issue: 'T-1', pid: 4242 };
    writeState(state);
    const before = fs.readFileSync(stateFile());
    const read = spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw Object.assign(new Error('transient permission failure'), { code: 'EACCES' });
    });

    let failure: unknown;
    try {
      await mutateState((current) => {
        current.tasks = {};
      });
    } catch (error) {
      failure = error;
    } finally {
      read.mockRestore();
    }

    expect(fs.readFileSync(stateFile())).toEqual(before);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('cannot read manager state');
  });

  test('mutateState treats ENOENT as first-run empty state', async () => {
    await mutateState((state) => {
      state.tasks.first = { state: 'INTAKE', project: 'joy', issue: 'T-2', pid: 7 };
    });

    expect(readState().tasks.first).toEqual({ state: 'INTAKE', project: 'joy', issue: 'T-2', pid: 7 });
  });
});

describe('task directory reads preserve evidence', () => {
  test('listTaskIds never turns an unreadable task directory into an empty list', () => {
    fs.mkdirSync(managerDir(), { recursive: true });
    fs.writeFileSync(tasksDir(), 'not a directory');

    expect(() => listTaskIds()).toThrow('cannot read task directory');
  });
});
