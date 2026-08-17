import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeEach, describe, test, expect } from 'bun:test';
import { applyRouterOverrides, extractJsonBlock, parseEnvelope, validateEnvelope } from '../lib/envelope';
import { ensureManagerDirs, projectsFile } from '../lib/paths';
import { sizingPrompt } from '../lib/prompts';
import type { TaskEnvelope } from '../types';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-envelope-'));
process.env.MANAGER_HOME = HOME;

function register(value: unknown): void {
  fs.writeFileSync(projectsFile(), JSON.stringify({ kivora: value }));
}

beforeEach(() => {
  ensureManagerDirs();
  register({ path: '/tmp/kivora', oracle_kind: ['playwright', 'tsc'] });
});

afterAll(() => {
  fs.rmSync(HOME, { recursive: true, force: true });
});

function goodEnvelope(overrides: Partial<TaskEnvelope> = {}): TaskEnvelope {
  return {
    project: 'kivora',
    issue: 't105',
    title: 'Checkout does not apply the discount code on mixed carts',
    size: 'M',
    uncertainty: 'med',
    lane: 'bug-lon',
    why: 'touches shared pricing logic in three places',
    oracle_available: true,
    oracle_kind: ['playwright', 'tsc'],
    needs_human: false,
    blocking_questions: [],
    assumptions: [],
    assumption_count: 0,
    est_cost_usd: 1.2,
    est_turns: 40,
    ...overrides,
  };
}

describe('extractJsonBlock', () => {
  test('prefers the last fenced json block', () => {
    const text = '```json\n{"a":1}\n```\nmore\n```json\n{"a":2}\n```';
    expect(extractJsonBlock(text)).toEqual({ a: 2 });
  });

  test('falls back to a bare object when the fence is missing', () => {
    expect(extractJsonBlock('blah blah {"verdict":"pass"} trailing')).toEqual({ verdict: 'pass' });
  });

  test('handles braces inside strings', () => {
    expect(extractJsonBlock('x {"reason":"a } b","ok":true}')).toEqual({ reason: 'a } b', ok: true });
  });

  test('returns null when there is nothing to parse', () => {
    expect(extractJsonBlock('no json here')).toBeNull();
    expect(extractJsonBlock('{ not json }')).toBeNull();
  });
});

describe('validateEnvelope', () => {
  test('accepts a complete envelope', () => {
    const result = validateEnvelope(goodEnvelope());
    expect(result.ok).toBe(true);
    expect(result.envelope?.lane).toBe('bug-lon');
  });

  test('rejects a missing field instead of defaulting it', () => {
    const partial = { ...goodEnvelope() } as Record<string, unknown>;
    delete partial.oracle_available;
    const result = validateEnvelope(partial);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('oracle_available');
    expect(result.envelope).toBeNull();
  });

  test('rejects out-of-vocabulary enums', () => {
    expect(validateEnvelope(goodEnvelope({ size: 'XXL' as never })).ok).toBe(false);
    expect(validateEnvelope(goodEnvelope({ lane: 'medium' as never })).ok).toBe(false);
    expect(validateEnvelope(goodEnvelope({ uncertainty: 'high-ish' as never })).ok).toBe(false);
  });

  test('rejects a non-object', () => {
    expect(validateEnvelope(null).ok).toBe(false);
    expect(validateEnvelope([1, 2]).ok).toBe(false);
  });
});

describe('router overrides', () => {
  test('an empty oracle list forces oracle_available false and needs_human', () => {
    register({ path: '/tmp/kivora', oracle_kind: [] });
    const { envelope, overrides } = applyRouterOverrides(goodEnvelope({ oracle_kind: [] }));
    expect(envelope.oracle_available).toBe(false);
    expect(envelope.needs_human).toBe(true);
    expect(overrides).toHaveLength(2);
  });

  test('no oracle means no autonomous lane even when the list is honest', () => {
    register({ path: '/tmp/kivora', oracle_kind: [] });
    const { envelope } = applyRouterOverrides(goodEnvelope({ oracle_kind: [], oracle_available: false }));
    expect(envelope.needs_human).toBe(true);
  });

  test('unknown never raises an honest "no oracle" to yes', () => {
    fs.writeFileSync(projectsFile(), JSON.stringify({ someone_else: '/tmp/other' }));
    const { envelope, overrides } = applyRouterOverrides(goodEnvelope({ oracle_kind: [], oracle_available: false }));
    expect(envelope.oracle_kind).toEqual(['unknown']);
    expect(envelope.oracle_available).toBe(false);
    expect(overrides.join(' ')).toContain('verifies no oracle');
  });

  test('unrecognized leaves the claim alone and says it is unchecked', () => {
    register({ path: '/tmp/kivora', assert: ['./scripts/verify-everything.sh'] });
    const { envelope, overrides } = applyRouterOverrides(goodEnvelope({ oracle_kind: [], oracle_available: true }));
    expect(envelope.oracle_kind).toEqual(['unrecognized']);
    expect(envelope.oracle_available).toBe(true);
    expect(overrides.join(' ')).toContain("stays the agent's unchecked claim");
  });

  test('a registry oracle raises an agent that undersold what can check it', () => {
    register({ path: '/tmp/kivora', assert: ['bun test personal/manager/'] });
    const { envelope, overrides } = applyRouterOverrides(goodEnvelope({ oracle_kind: [], oracle_available: false }));
    expect(envelope.oracle_kind).toEqual(['bun-test']);
    expect(envelope.oracle_available).toBe(true);
    expect(envelope.needs_human).toBe(false);
    expect(overrides.join(' ')).toContain('oracle_available=true');
  });

  test('a QC bounce forces bug-lon', () => {
    const { envelope, overrides } = applyRouterOverrides(goodEnvelope({ lane: 'bug-nho' }), { roundTwoFail: true });
    expect(envelope.lane).toBe('bug-lon');
    expect(overrides.join(' ')).toContain('round-2-fail');
  });

  test('auth, payment and migration surfaces float up to bug-lon', () => {
    for (const word of ['auth', 'payment', 'migration']) {
      const { envelope } = applyRouterOverrides(goodEnvelope({ lane: 'trivial', title: `fix ${word} label` }));
      expect(envelope.lane).toBe('bug-lon');
    }
  });

  test('a feature is never demoted by an override', () => {
    const { envelope } = applyRouterOverrides(goodEnvelope({ lane: 'feature', title: 'new payment flow' }), {
      roundTwoFail: true,
    });
    expect(envelope.lane).toBe('feature');
  });

  test('more than two assumptions forces needs_human', () => {
    const { envelope, overrides } = applyRouterOverrides(goodEnvelope({ assumption_count: 3 }));
    expect(envelope.needs_human).toBe(true);
    expect(overrides.join(' ')).toContain('assumption_count>2');
  });

  test('exactly two assumptions does not', () => {
    const { envelope } = applyRouterOverrides(goodEnvelope({ assumption_count: 2 }));
    expect(envelope.needs_human).toBe(false);
  });

  test('the input envelope is left untouched', () => {
    register({ path: '/tmp/kivora', oracle_kind: [] });
    const input = goodEnvelope({ oracle_kind: [] });
    applyRouterOverrides(input);
    expect(input.oracle_available).toBe(true);
  });

  test('an explicit registry oracle_kind beats the agent claim', () => {
    register({ path: '/tmp/kivora', oracle_kind: ['playwright', 'lint'] });
    const { envelope } = applyRouterOverrides(goodEnvelope({ oracle_kind: ['jest'] }));
    expect(envelope.oracle_kind).toEqual(['playwright', 'lint']);
  });

  test('assert commands derive oracle kinds instead of trusting the agent', () => {
    register({ path: '/tmp/kivora', assert: ['npx tsc --noEmit', 'npx eslint .'] });
    const { envelope } = applyRouterOverrides(goodEnvelope({ oracle_kind: ['playwright'] }));
    expect(envelope.oracle_kind).toEqual(['tsc', 'lint']);
  });

  test('a hallucinated jest oracle is dropped for a bun test project and recorded', () => {
    register({ path: '/tmp/kivora', assert: ['bun test personal/manager/'] });
    const { envelope, overrides } = applyRouterOverrides(goodEnvelope({ oracle_kind: ['jest'] }));
    expect(envelope.oracle_kind).toEqual(['bun-test']);
    expect(overrides).toContain(
      'oracle_kind ["jest"] -> ["bun-test"] (registry ["bun-test"], agent my-chrome absent)',
    );
  });

  test('my-chrome survives registry reconciliation', () => {
    register({ path: '/tmp/kivora', assert: ['bun test'] });
    const { envelope } = applyRouterOverrides(goodEnvelope({ oracle_kind: ['jest', 'my-chrome'] }));
    expect(envelope.oracle_kind).toEqual(['bun-test', 'my-chrome']);
  });

  test('an unregistered project remains unknown instead of becoming no oracle', () => {
    fs.writeFileSync(projectsFile(), '{}');
    const { envelope } = applyRouterOverrides(goodEnvelope({ oracle_kind: [] }));
    expect(envelope.oracle_kind).toEqual(['unknown']);
    expect(envelope.oracle_available).toBe(true);
  });

  test('an unrecognized assert command stays visibly unrecognized', () => {
    register({ path: '/tmp/kivora', assert: ['node scripts/verify.js'] });
    const { envelope } = applyRouterOverrides(goodEnvelope({ oracle_kind: [] }));
    expect(envelope.oracle_kind).toEqual(['unrecognized']);
  });
});

describe('parseEnvelope', () => {
  test('parses agent prose plus a fenced block and applies overrides', () => {
    register({ path: '/tmp/kivora', oracle_kind: [] });
    const text = `Here is my sizing.\n\n\`\`\`json\n${JSON.stringify(goodEnvelope({ oracle_kind: [] }))}\n\`\`\``;
    const result = parseEnvelope(text);
    expect(result.ok).toBe(true);
    expect(result.envelope?.needs_human).toBe(true);
    expect(result.overrides.length).toBeGreaterThan(0);
  });

  test('reports the missing JSON rather than inventing an envelope', () => {
    const result = parseEnvelope('I could not size this.');
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('no JSON object');
  });
});

describe('sizing prompt', () => {
  test('asks the agent only about the browser capability it can know', () => {
    const prompt = sizingPrompt('kivora', 't105');
    expect(prompt).toContain('Do not guess them');
    expect(prompt).toContain('use ["my-chrome"]');
    expect(prompt).not.toContain('playwright, tsc, jest');
  });
});
