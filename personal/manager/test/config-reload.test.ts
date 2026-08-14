import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-cfg-')));
process.env.MANAGER_HOME = HOME;

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { loadConfig, resetConfigCache } from '../config';
import { ensureManagerDirs, managerConfigFile } from '../lib/paths';

function writeOverrides(overrides: Record<string, unknown>): void {
  ensureManagerDirs();
  fs.writeFileSync(managerConfigFile(), JSON.stringify(overrides));
}

beforeEach(() => {
  resetConfigCache();
  fs.rmSync(managerConfigFile(), { force: true });
});

afterAll(() => {
  fs.rmSync(HOME, { recursive: true, force: true });
});

// The daemon runs for days. Caching the first read forever meant an operator
// who pulled a review provider out of the loop kept the old one running until
// someone remembered to restart, so the safety decision was made, acknowledged,
// and silently not in effect.
describe('a config edit reaches a process that already read the config', () => {
  test('an override written after the first read is picked up', () => {
    expect(loadConfig().reviewProvider).toBe('codex');
    writeOverrides({ reviewProvider: 'opus-fresh' });
    expect(loadConfig().reviewProvider).toBe('opus-fresh');
  });

  test('editing an existing override file is picked up', () => {
    writeOverrides({ reviewProvider: 'opus-fresh' });
    expect(loadConfig().reviewProvider).toBe('opus-fresh');
    writeOverrides({ reviewProvider: 'codex' });
    expect(loadConfig().reviewProvider).toBe('codex');
  });

  test('deleting the override file restores the shipped default', () => {
    writeOverrides({ maxAgents: 99 });
    expect(loadConfig().maxAgents).toBe(99);
    fs.rmSync(managerConfigFile());
    expect(loadConfig().maxAgents).not.toBe(99);
  });

  test('an untouched file is still served from cache', () => {
    writeOverrides({ maxAgents: 7 });
    expect(loadConfig()).toBe(loadConfig());
  });

  // A half-written file must not blow away a working config: the parse failure
  // falls back to defaults, and the next good write has to recover on its own.
  test('a corrupt file falls back to defaults and recovers when fixed', () => {
    writeOverrides({ maxAgents: 7 });
    expect(loadConfig().maxAgents).toBe(7);
    fs.writeFileSync(managerConfigFile(), '{ not json');
    expect(loadConfig().maxAgents).not.toBe(7);
    writeOverrides({ maxAgents: 5 });
    expect(loadConfig().maxAgents).toBe(5);
  });
});
