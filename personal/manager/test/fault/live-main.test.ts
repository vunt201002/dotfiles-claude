import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { gateLogPath } from '../../lib/gate-log';
import { readEntries } from '../../lib/gate-log-port';
import { createWorld, PROJECT, type FaultWorld } from './harness';

let world: FaultWorld | undefined;

afterEach(() => {
  world?.dispose();
  world = undefined;
});

describe('live-main acceptance', () => {
  test('LIVE-C4 readEntries must preserve an unreadable gate log as unreadable', () => {
    world = createWorld();
    const log = gateLogPath(PROJECT);
    fs.mkdirSync(path.dirname(log), { recursive: true });
    fs.mkdirSync(log, { recursive: true });
    const result = readEntries(PROJECT);
    expect(result, 'readEntries collapsed EISDIR into observed empty evidence').toMatchObject({
      ok: false,
      reason: expect.stringContaining('EISDIR'),
    });
  });
});
