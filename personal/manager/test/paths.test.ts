import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-paths-'));
process.env.MANAGER_HOME = HOME;

import { describe, test, expect, afterAll } from 'bun:test';
import { gstackHome, managerDir } from '../lib/paths';
import { gateLogDir } from '../lib/gate-log';
import { resolvePaths } from '../telegram/config';

afterAll(() => {
  try {
    fs.rmSync(HOME, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

// The daemon reads MANAGER_HOME; the bot only ever reads GSTACK_HOME, and it
// lives in another process. Setting one and not the other used to point the two
// halves at different directories, and the symptom is not an error — it is the
// bot reporting that no manager is running, and a gate log written somewhere
// nobody reads. So MANAGER_HOME publishes itself to GSTACK_HOME.

describe('the bot and the daemon resolve to one directory', () => {
  test('MANAGER_HOME is published to GSTACK_HOME so every reader follows it', () => {
    expect(gstackHome()).toBe(HOME);
    expect(process.env.GSTACK_HOME).toBe(HOME);
  });

  test('the telegram bot lands on the same manager directory', () => {
    gstackHome();
    expect(resolvePaths(process.env).managerDir).toBe(managerDir());
  });

  test('the gate log follows the pin instead of the real home', () => {
    const previous = process.env.GSTACK_GATE_LOG_DIR;
    delete process.env.GSTACK_GATE_LOG_DIR;
    try {
      gstackHome();
      expect(gateLogDir()).toBe(path.join(HOME, 'gate-log'));
    } finally {
      if (previous === undefined) delete process.env.GSTACK_GATE_LOG_DIR;
      else process.env.GSTACK_GATE_LOG_DIR = previous;
    }
  });

  test('GSTACK_HOME alone still works, with no pin set', () => {
    const pin = process.env.MANAGER_HOME;
    const shared = process.env.GSTACK_HOME;
    delete process.env.MANAGER_HOME;
    process.env.GSTACK_HOME = HOME;
    try {
      expect(gstackHome()).toBe(HOME);
      expect(resolvePaths(process.env).managerDir).toBe(managerDir());
    } finally {
      if (pin === undefined) delete process.env.MANAGER_HOME;
      else process.env.MANAGER_HOME = pin;
      if (shared === undefined) delete process.env.GSTACK_HOME;
      else process.env.GSTACK_HOME = shared;
    }
  });
});
