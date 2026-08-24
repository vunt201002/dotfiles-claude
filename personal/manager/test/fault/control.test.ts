import { afterEach, describe, expect, test } from 'bun:test';
import { readScreen } from '../../lib/cmux-control';
import type { FleetEntry, FleetRead } from '../../lib/cmux-sessions';
import { waitForSlot } from '../../lib/cmux-spawn';
import { createWorld, healthyReply, runOrchestrator, type FaultWorld } from './harness';

let world: FaultWorld | undefined;

afterEach(() => {
  world?.dispose();
  world = undefined;
});

describe('fault harness control', () => {
  test('observed evidence drives the production orchestrator to REPORTED without API calls', async () => {
    world = createWorld();
    const task = await runOrchestrator(world, (request) => healthyReply(request));
    expect(task.state).toBe('REPORTED');
    expect(task.cost_usd_actual).toBe(0);
    expect(world.calls.length).toBeGreaterThan(0);
  });
});

describe('production fault seams', () => {
  test('waitForSlot reaches timeout through injected clock, fleet reader, and sleep', async () => {
    let time = 0;
    let sleeps = 0;

    const outcome = await waitForSlot(1, {
      timeoutMs: 10_000,
      now: () => time,
      fleet: (): FleetRead => ({ ok: true, entries: [{ health: 'working' }] as FleetEntry[] }),
      sleep: async () => {
        sleeps++;
        time = 10_000;
      },
    });

    expect(outcome).toBe('timeout');
    expect(sleeps).toBe(1);
  });

  test('readScreen returns an injected executor failure without spawning cmux', () => {
    const calls: string[][] = [];
    const result = readScreen('workspace:77', 40, (args) => {
      calls.push(args);
      return { ok: false, stdout: '', stderr: 'replayed read failure' };
    });

    expect(result).toEqual({ ok: false, error: 'replayed read failure' });
    expect(calls).toEqual([['read-screen', '--workspace', 'workspace:77', '--lines', '40']]);
  });

  test('calculatePrecision returns the known caught share', async () => {
    const gateLogModule = '../../../../bin/gate-log';
    const { calculatePrecision } = await import(gateLogModule);
    expect(calculatePrecision({ caught: 3, falsePositive: 1 })).toBe(0.75);
  });
});
