import { afterEach, describe, expect, test } from 'bun:test';
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
