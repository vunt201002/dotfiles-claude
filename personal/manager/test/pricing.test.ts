import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-price-')));
process.env.MANAGER_HOME = HOME;

import { afterAll, describe, expect, test } from 'bun:test';
import { measuredCost } from '../lib/cost';
import { PRICING } from '../../../test/helpers/pricing';

afterAll(() => {
  fs.rmSync(HOME, { recursive: true, force: true });
});

// Every id below was read out of a real transcript under ~/.claude/projects.
// A model the fleet actually runs but the table does not name reports its spend
// as unknown, which is honest but leaves the ceilings with nothing to hold.
const MODELS_IN_USE = [
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-haiku-4-5-20251001',
  'claude-opus-4-7',
  'claude-sonnet-4-6',
];

describe('the pricing table covers the models the fleet actually runs', () => {
  test.each(MODELS_IN_USE)('%s has a price on file', (model) => {
    expect(PRICING[model]).toBeDefined();
  });

  // Lookup is an exact key match, so `claude-haiku-4-5-20251001` does not find
  // the undated `claude-haiku-4-5` row. A near-miss reads as "no price on file".
  test('a dated model id resolves on its own, not via the undated row', () => {
    expect(measuredCost({ input_tokens: 1_000_000 }, 'claude-haiku-4-5-20251001').known).toBe(true);
  });

  test('an unknown model reports unknown rather than zero', () => {
    const cost = measuredCost({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, 'claude-opus-9');
    expect(cost.known).toBe(false);
    expect(cost.usd).toBe(0);
  });

  test('opus 5 costs $5 per million in and $25 per million out', () => {
    expect(measuredCost({ input_tokens: 1_000_000 }, 'claude-opus-5').usd).toBeCloseTo(5, 6);
    expect(measuredCost({ output_tokens: 1_000_000 }, 'claude-opus-5').usd).toBeCloseTo(25, 6);
  });
});

describe('a cache write is priced at the TTL it was actually written for', () => {
  // Long agent sessions run on the hour TTL, where writes are the bulk of
  // input. Charging them at the 5-minute rate understates the write by 37.5%.
  test('an hour-TTL write costs 2x input, not 1.25x', () => {
    const usd = measuredCost(
      { cache_creation: { ephemeral_1h_input_tokens: 1_000_000, ephemeral_5m_input_tokens: 0 } },
      'claude-opus-5',
    ).usd;
    expect(usd).toBeCloseTo(10, 6);
  });

  test('a five-minute write costs 1.25x input', () => {
    const usd = measuredCost(
      { cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 0 } },
      'claude-opus-5',
    ).usd;
    expect(usd).toBeCloseTo(6.25, 6);
  });

  test('both TTLs in one turn are billed at their own rates', () => {
    const usd = measuredCost(
      { cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 1_000_000 } },
      'claude-opus-5',
    ).usd;
    expect(usd).toBeCloseTo(16.25, 6);
  });

  // A transcript predating the split carries only the aggregate. Treating that
  // as a five-minute write is the old behaviour and must not silently change.
  test('a transcript with no TTL split falls back to the aggregate at the five-minute rate', () => {
    const usd = measuredCost({ cache_creation_input_tokens: 1_000_000 }, 'claude-opus-5').usd;
    expect(usd).toBeCloseTo(6.25, 6);
  });

  // The split is authoritative when present: an aggregate that disagrees with
  // it must not be added on top, or every hour-TTL turn double-counts.
  test('the split wins over the aggregate rather than adding to it', () => {
    const usd = measuredCost(
      {
        cache_creation_input_tokens: 1_000_000,
        cache_creation: { ephemeral_1h_input_tokens: 1_000_000, ephemeral_5m_input_tokens: 0 },
      },
      'claude-opus-5',
    ).usd;
    expect(usd).toBeCloseTo(10, 6);
  });
});
