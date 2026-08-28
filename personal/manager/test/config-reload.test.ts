import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-cfg-')));
process.env.MANAGER_HOME = HOME;

import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
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
  test('the shipped execution provider remains claude', () => {
    expect(loadConfig().executionProvider).toBe('claude');
    expect(loadConfig().cmuxCodexBin).toBe('codex');
  });

  test('codex cannot execute and review the same task', () => {
    writeOverrides({ executionProvider: 'codex', reviewProvider: 'codex' });
    expect(() => loadConfig()).toThrow('executionProvider codex requires reviewProvider opus-fresh');
  });

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

  test('a corrupt edit keeps the last-known-good config, reports the failure, and recovers when fixed', () => {
    writeOverrides({ maxAgents: 7 });
    expect(loadConfig().maxAgents).toBe(7);
    const report = spyOn(console, 'error').mockImplementation(() => undefined);
    fs.writeFileSync(managerConfigFile(), '{ not json');
    expect(loadConfig().maxAgents).toBe(7);
    expect(report).toHaveBeenCalledWith(expect.stringContaining('keeping last-known-good config'));
    report.mockRestore();
    writeOverrides({ maxAgents: 5 });
    expect(loadConfig().maxAgents).toBe(5);
  });

  test('a corrupt config on first load refuses to manufacture policy from defaults', () => {
    ensureManagerDirs();
    fs.writeFileSync(managerConfigFile(), '{ not json');

    expect(() => loadConfig()).toThrow('cannot load manager config');
  });

  test('an invalid numeric env override keeps the last-known-good config instead of widening policy', () => {
    writeOverrides({ dayCeilingUsd: 3 });
    expect(loadConfig().dayCeilingUsd).toBe(3);
    const report = spyOn(console, 'error').mockImplementation(() => undefined);
    process.env.MANAGER_DAY_CEILING_USD = 'not-a-number';
    try {
      expect(loadConfig().dayCeilingUsd).toBe(3);
      expect(report).toHaveBeenCalledWith(expect.stringContaining('keeping last-known-good config'));
    } finally {
      delete process.env.MANAGER_DAY_CEILING_USD;
      report.mockRestore();
    }
  });

  test('an invalid policy shape keeps the last-known-good runner and review provider', () => {
    writeOverrides({ spawnRunner: 'cmux', reviewProvider: 'opus-fresh' });
    expect(loadConfig().spawnRunner).toBe('cmux');
    expect(loadConfig().reviewProvider).toBe('opus-fresh');
    const report = spyOn(console, 'error').mockImplementation(() => undefined);
    fs.writeFileSync(managerConfigFile(), JSON.stringify({ spawnRunner: 'unknown', reviewProvider: 'unknown' }));
    try {
      expect(loadConfig().spawnRunner).toBe('cmux');
      expect(loadConfig().reviewProvider).toBe('opus-fresh');
      expect(report).toHaveBeenCalledWith(expect.stringContaining('keeping last-known-good config'));
    } finally {
      report.mockRestore();
    }
  });

  test('an unreadable config path keeps the last-known-good policy and reports the failure', () => {
    writeOverrides({ maxAgents: 2, dayCeilingUsd: 4 });
    expect(loadConfig().maxAgents).toBe(2);
    const report = spyOn(console, 'error').mockImplementation(() => undefined);
    fs.rmSync(managerConfigFile());
    fs.mkdirSync(managerConfigFile());
    try {
      expect(loadConfig().maxAgents).toBe(2);
      expect(loadConfig().dayCeilingUsd).toBe(4);
      expect(report).toHaveBeenCalledWith(expect.stringContaining('keeping last-known-good config'));
    } finally {
      fs.rmSync(managerConfigFile(), { recursive: true, force: true });
      report.mockRestore();
    }
  });
});
