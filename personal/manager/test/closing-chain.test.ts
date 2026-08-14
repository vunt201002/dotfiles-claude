import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-chain-'));
process.env.MANAGER_HOME = HOME;
process.env.GSTACK_GATE_LOG_DIR = path.join(HOME, 'gate-log');

import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import { resetConfigCache } from '../config';
import { appendGateLog, type GateLogEntry } from '../lib/gate-log';
import { readEntries } from '../lib/gate-log-port';
import {
  BROWSER_GATES,
  collectHookGates,
  MANAGER_OWNED_GATES,
  needsBrowserToken,
  reportFromVerdict,
  REVIEW_CHAIN,
  roleForGate,
  runReviewChain,
  runVerifyChain,
  VERIFY_CHAIN,
  type ChainContext,
  type ChainGate,
  type GateSpawnRequest,
} from '../lib/closing-chain';
import type { ExecFn } from '../lib/assert-runner';
import { approveCommands } from '../lib/assert-approvals';
import type { DiffResult } from '../lib/git';
import { ensureManagerDirs, managerConfigFile, projectsFile } from '../lib/paths';
import { parseVerdict, verifyDeterministicGates, UNVERIFIED_MARK, type GateReport } from '../lib/verdict';
import type { Lane, TaskEnvelope } from '../types';

const REPO = fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-chain-repo-'));
const PROJECT = 'demo';
const GREEN = ' 9 pass\n 0 fail\nRan 9 tests across 2 files.';

function envelope(overrides: Partial<TaskEnvelope> = {}): TaskEnvelope {
  return {
    project: PROJECT,
    issue: 't7',
    title: 'Discount ignored on mixed carts',
    size: 'M',
    uncertainty: 'med',
    lane: 'bug-lon',
    why: 'shared pricing path',
    oracle_available: true,
    oracle_kind: ['tsc'],
    needs_human: false,
    blocking_questions: [],
    assumptions: [],
    assumption_count: 0,
    est_cost_usd: 1,
    est_turns: 10,
    ...overrides,
  };
}

const DIFF: DiffResult = { ok: true, text: '+ return discounted;', truncated: false, error: '' };

function verdictJson(body: Record<string, unknown>): string {
  return `Done.\n\`\`\`json\n${JSON.stringify({ verdict: 'pass', reason: 'ok', ...body })}\n\`\`\``;
}

interface Harness {
  ctx: ChainContext;
  prompts: GateSpawnRequest[];
}

function harness(
  overrides: Partial<ChainContext> = {},
  reply: (gate: ChainGate) => string = () => verdictJson({}),
): Harness {
  const prompts: GateSpawnRequest[] = [];
  const exec: ExecFn = async () => ({ exitCode: 0, stdout: GREEN, stderr: '', timedOut: false });
  const ctx: ChainContext = {
    project: PROJECT,
    issue: 't7',
    scope: REPO,
    envelope: envelope(),
    attempt: 1,
    reviewDepth: 'summary',
    rootCause: 'the rule engine returns the base price when the cart mixes sale and regular lines',
    hasRealBrowser: false,
    exec,
    diff: () => DIFF,
    spawn: async (req) => {
      prompts.push(req);
      return { output: reply(req.gate), costUsd: 0.05, costKnown: true, exitReason: 'success' };
    },
    ...overrides,
  };
  return { ctx, prompts };
}

beforeEach(() => {
  ensureManagerDirs();
  fs.writeFileSync(managerConfigFile(), JSON.stringify({ browserTools: ['mcp__test-browser__navigate'] }));
  resetConfigCache();
  fs.rmSync(path.join(HOME, 'gate-log'), { recursive: true, force: true });
  fs.writeFileSync(projectsFile(), JSON.stringify({ [PROJECT]: { path: REPO, assert: ['bun run test'] } }));
  approveCommands(PROJECT, ['bun run test']);
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

describe('the chain each lane actually runs (§7.2)', () => {
  test('trivial closes on the hooks alone', () => {
    expect(VERIFY_CHAIN.trivial).toEqual([]);
    expect(REVIEW_CHAIN.trivial).toEqual([]);
  });

  test('bug-nho stops at the repeatable half', () => {
    expect(VERIFY_CHAIN['bug-nho']).toEqual(['B8-assert']);
    expect(REVIEW_CHAIN['bug-nho']).toEqual([]);
  });

  test('bug-lon adds the judge, spec-check and a reviewer', () => {
    expect(VERIFY_CHAIN['bug-lon']).toEqual(['B8-assert', 'B8-judge']);
    expect(REVIEW_CHAIN['bug-lon']).toEqual(['spec-check', 'tech-review']);
  });

  test('feature swaps the judge for design-verify and adds impact', () => {
    expect(VERIFY_CHAIN.feature).toEqual(['B8-assert', 'design-judge']);
    expect(REVIEW_CHAIN.feature).toEqual(['spec-check', 'tech-review', 'impact-review']);
  });

  test('only the judges need the single real Chrome', () => {
    expect(BROWSER_GATES).toEqual(['B8-judge', 'design-judge']);
    expect(needsBrowserToken(['B8-assert'])).toBe(false);
    expect(needsBrowserToken(['B8-assert', 'B8-judge'])).toBe(true);
    for (const lane of ['trivial', 'bug-nho', 'bug-lon', 'feature'] as Lane[]) {
      expect(needsBrowserToken(REVIEW_CHAIN[lane]), `${lane} review must never take the token`).toBe(false);
    }
  });

  test('judges route to the judge role, review gates to the review role', () => {
    expect(roleForGate('B8-judge')).toBe('judge');
    expect(roleForGate('design-judge')).toBe('judge');
    expect(roleForGate('spec-check')).toBe('review');
    expect(roleForGate('tech-review')).toBe('review');
  });
});

// spec-check is only worth running because it has NOT seen how the change was
// built. A prompt assembled from the task record would pick the builder's own
// account back up the first time someone added a convenient field, and nothing
// would fail to say so — the gate would simply stop catching scope drift.
describe('spec-check is blind to the builder', () => {
  const BUILDER_MARKERS = [
    'BUILDER-TRANSCRIPT-I-tried-three-approaches',
    'BUILDER-REASONING-then-I-decided-to-refactor',
    'BUILDER-REPORT-line-about-what-I-did',
    'BUILDER-VERIFY-line-attempt-1',
    'BUILDER-ASSUMPTION-the-cart-is-never-empty',
    'BUILDER-FINDING-something-I-noticed',
  ];

  test('none of the builder\'s narrative reaches the prompt', async () => {
    const { ctx, prompts } = harness({
      envelope: envelope({ title: 'Discount ignored on mixed carts', why: 'shared pricing path' }),
    });
    await runReviewChain(ctx);
    const specCheck = prompts.find((p) => p.gate === 'spec-check');
    expect(specCheck).toBeDefined();
    for (const marker of BUILDER_MARKERS) {
      expect(specCheck?.prompt, `builder narrative leaked: ${marker}`).not.toContain(marker);
    }
  });

  test('it gets exactly the agreed intent, the proven root cause, and the diff', async () => {
    const { ctx, prompts } = harness();
    await runReviewChain(ctx);
    const prompt = prompts.find((p) => p.gate === 'spec-check')?.prompt ?? '';
    expect(prompt).toContain('Discount ignored on mixed carts');
    expect(prompt).toContain('shared pricing path');
    expect(prompt).toContain('the rule engine returns the base price');
    expect(prompt).toContain('+ return discounted;');
    expect(prompt).toContain('You have not seen how it was built');
  });

  test('a root cause longer than one sentence cannot smuggle a transcript through', () => {
    const smuggled = `real cause. ${'and then I tried X. '.repeat(60)}`;
    const parsed = parseVerdict(verdictJson({ root_cause: smuggled }));
    expect(parsed.root_cause.length).toBeLessThanOrEqual(300);
    expect(parsed.root_cause.startsWith('real cause.')).toBe(true);
  });

  test('it is asked what is missing, extra, and silently changed', async () => {
    const { ctx, prompts } = harness();
    await runReviewChain(ctx);
    const prompt = prompts.find((p) => p.gate === 'spec-check')?.prompt ?? '';
    expect(prompt).toContain('MISSING');
    expect(prompt).toContain('EXTRA');
    expect(prompt).toContain('CHANGED without being asked');
  });

  test('every chain gate runs report-only', async () => {
    const { ctx, prompts } = harness({ envelope: envelope({ lane: 'feature' }) });
    await runReviewChain(ctx);
    expect(prompts.length).toBeGreaterThan(0);
    for (const p of prompts) expect(p.readOnly, `${p.gate} is not report-only`).toBe(true);
  });
});

// Two gates emitted from ONE spawn are one opinion wearing two labels. The
// ensemble blocks when two DIFFERENT llm gates agree, so folding tech-review
// and impact-review into a single call would manufacture the very agreement
// the rule is meant to require.
describe('one gate, one spawn', () => {
  test('each llm gate on the feature lane gets its own context', async () => {
    const { ctx, prompts } = harness({ envelope: envelope({ lane: 'feature' }) });
    await runReviewChain(ctx);
    expect(prompts.map((p) => p.gate)).toEqual(['spec-check', 'tech-review', 'impact-review']);
    expect(new Set(prompts.map((p) => p.prompt)).size).toBe(3);
  });

  test('the review prompts do not overlap in what they ask for', async () => {
    const { ctx, prompts } = harness({ envelope: envelope({ lane: 'feature' }) });
    await runReviewChain(ctx);
    const tech = prompts.find((p) => p.gate === 'tech-review')?.prompt ?? '';
    const impact = prompts.find((p) => p.gate === 'impact-review')?.prompt ?? '';
    expect(tech).toContain('a separate gate owns that');
    expect(impact).toContain('a separate gate owns that');
    expect(tech).not.toContain('Read beyond the diff');
  });
});

describe('what lands in the gate log', () => {
  test('every llm gate writes a row that says llm', async () => {
    const { ctx } = harness({ envelope: envelope({ lane: 'feature' }) });
    await runReviewChain(ctx);
    const rows = readEntries(PROJECT);
    for (const gate of ['spec-check', 'tech-review', 'impact-review']) {
      const row = rows.find((r) => r.gate === gate);
      expect(row, `${gate} wrote no row`).toBeDefined();
      expect(row?.gate_family).toBe('llm');
      expect(row?.lane).toBe('feature');
      expect(row?.review_depth).toBe('summary');
    }
  });

  test('B8-assert writes deterministic rows in the same run', async () => {
    const { ctx } = harness();
    await runVerifyChain(ctx);
    const row = readEntries(PROJECT).find((r) => r.gate === 'B8-assert');
    expect(row?.gate_family).toBe('deterministic');
    expect(row?.verdict).toBe('pass');
  });

  test('a finding from the gate becomes a caught row; an advisory does not', async () => {
    const { ctx } = harness({}, (gate) =>
      gate === 'spec-check'
        ? verdictJson({ findings: ['added an endpoint nobody asked for'], advisories: ['naming could be better'] })
        : verdictJson({}),
    );
    const chain = await runReviewChain(ctx);
    const row = readEntries(PROJECT).find((r) => r.gate === 'spec-check');
    expect(row?.verdict).toBe('caught');
    expect(row?.caught).toContain('endpoint nobody asked for');
    expect(chain.advisories.join(' ')).toContain('naming could be better');
    expect(chain.reports.find((r) => r.gate === 'spec-check')?.caught).not.toContain('naming');
  });

  test('the gate name comes from the manager, not from the answer', () => {
    const claimed = parseVerdict(
      verdictJson({ gates: [{ gate: 'tsc', gate_family: 'deterministic', verdict: 'caught', caught: 'TS1' }] }),
    );
    const report = reportFromVerdict('spec-check', claimed);
    expect(report.gate).toBe('spec-check');
    expect(report.gate_family).toBe('llm');
  });

  test('a gate that reports blocked is an error row, not a silent pass', () => {
    const report = reportFromVerdict('tech-review', parseVerdict(verdictJson({ verdict: 'blocked', reason: 'no diff' })));
    expect(report.verdict).toBe('error');
    expect(report.caught).toContain('no diff');
  });

  test('unparseable output is an error row, never a pass', () => {
    const report = reportFromVerdict('spec-check', parseVerdict('I could not do it'));
    expect(report.verdict).toBe('error');
  });
});

describe('judges only run when there is something to judge', () => {
  test('no real-browser oracle means the judge is skipped, loudly, with a reason', async () => {
    const { ctx, prompts } = harness({ hasRealBrowser: false });
    const chain = await runVerifyChain(ctx);
    expect(prompts.map((p) => p.gate)).not.toContain('B8-judge');
    const row = readEntries(PROJECT).find((r) => r.gate === 'B8-judge');
    expect(row?.verdict).toBe('skipped');
    expect(row?.caught).toContain('no real-browser oracle');
    expect(chain.proven, 'a skipped judge must not make the task unproven').toBe(true);
  });

  test('with a real browser the judge really runs', async () => {
    const { ctx, prompts } = harness({ hasRealBrowser: true, envelope: envelope({ oracle_kind: ['my-chrome'] }) });
    await runVerifyChain(ctx);
    expect(prompts.map((p) => p.gate)).toContain('B8-judge');
    expect(readEntries(PROJECT).find((r) => r.gate === 'B8-judge')?.gate_family).toBe('llm');
  });

  test('the judge gets the browser tools, not just the token', async () => {
    const { ctx, prompts } = harness({ hasRealBrowser: true, envelope: envelope({ oracle_kind: ['my-chrome'] }) });
    await runVerifyChain(ctx);
    expect(prompts.find((p) => p.gate === 'B8-judge')?.extraTools).toContain('mcp__test-browser__navigate');
  });

  // A task that needs the browser, on a manager with no way to reach one, is the
  // case that used to hand out the token and accept whatever came back. It has
  // to be an error: `skipped` would read as "nothing to judge" and `pass` would
  // be a verdict nobody produced.
  test('no browser transport is an error, not a verdict', async () => {
    fs.writeFileSync(managerConfigFile(), JSON.stringify({ browserTools: [] }));
    resetConfigCache();

    const { ctx, prompts } = harness({ hasRealBrowser: true, envelope: envelope({ oracle_kind: ['my-chrome'] }) });
    const chain = await runVerifyChain(ctx);

    expect(prompts.map((p) => p.gate), 'nothing may be spawned for a gate that cannot see').not.toContain('B8-judge');
    const row = readEntries(PROJECT).find((r) => r.gate === 'B8-judge');
    expect(row?.verdict).toBe('error');
    expect(row?.caught).toContain('no browser transport configured');
    expect(chain.proven, 'a gate that could not run must not be read as proof').toBe(false);
  });
});

describe('the verify chain stops at an unproven assert', () => {
  test('a red assert does not go on to spend money on a judge', async () => {
    const { ctx, prompts } = harness({
      hasRealBrowser: true,
      envelope: envelope({ oracle_kind: ['my-chrome'] }),
      exec: async () => ({ exitCode: 1, stdout: ' 8 pass\n 1 fail\nRan 9 tests across 2 files.', stderr: '', timedOut: false }),
    });
    const chain = await runVerifyChain(ctx);
    expect(chain.proven).toBe(false);
    expect(chain.oracleFault).toBe(false);
    expect(prompts).toHaveLength(0);
  });

  test('a silently skipped suite is an oracle fault, not a code fault', async () => {
    const { ctx } = harness({
      exec: async () => ({ exitCode: 0, stdout: ' 0 pass\n 0 fail\n 4 skip\nRan 0 tests across 2 files.', stderr: '', timedOut: false }),
    });
    const chain = await runVerifyChain(ctx);
    expect(chain.proven).toBe(false);
    expect(chain.oracleFault).toBe(true);
    expect(chain.lines.join(' ')).toContain('0 test(s) ran');
  });

  test('the count of tests that ran reaches the report lines', async () => {
    const { ctx } = harness();
    const chain = await runVerifyChain(ctx);
    expect(chain.lines.join(' ')).toContain('9 test(s) ran');
    expect(chain.lines.join(' ')).toContain('bun run test');
  });
});

describe('hook rows are read, not re-run', () => {
  test('rows inside the window count; rows outside it do not', () => {
    appendGateLog({ project: PROJECT, gate: 'tsc', gate_family: 'deterministic', verdict: 'pass', ts: '2020-01-01T00:00:00Z' });
    appendGateLog({ project: PROJECT, gate: 'lint', gate_family: 'deterministic', verdict: 'caught', caught: 'unused var', ts: '2026-08-12T10:00:00Z' });
    const inWindow = collectHookGates({ project: PROJECT, since: '2026-08-12T09:00:00Z', until: '2026-08-12T11:00:00Z' });
    expect(inWindow.map((g) => g.gate)).toEqual(['lint']);
    expect(inWindow[0].caught).toBe('unused var');
  });

  test('an llm row is never mistaken for a hook row', () => {
    appendGateLog({ project: PROJECT, gate: 'tsc', gate_family: 'llm', verdict: 'pass', ts: '2026-08-12T10:00:00Z' });
    expect(collectHookGates({ project: PROJECT, since: '2026-08-12T09:00:00Z', until: '2026-08-12T11:00:00Z' })).toEqual([]);
  });

  test('a gate the chain owns is never treated as a hook row', () => {
    appendGateLog({ project: PROJECT, gate: 'B8-assert', gate_family: 'deterministic', verdict: 'pass', ts: '2026-08-12T10:00:00Z' });
    expect(collectHookGates({ project: PROJECT, since: '2026-08-12T09:00:00Z', until: '2026-08-12T11:00:00Z' })).toEqual([]);
  });

  test('a probe run inside the window is not this task evidence', () => {
    appendGateLog({ project: PROJECT, gate: 'guard', gate_family: 'deterministic', verdict: 'caught', caught: 'probe', origin: 'gate-test', ts: '2026-08-12T10:00:00Z' });
    expect(collectHookGates({ project: PROJECT, since: '2026-08-12T09:00:00Z', until: '2026-08-12T11:00:00Z' })).toEqual([]);

    appendGateLog({ project: PROJECT, gate: 'guard', gate_family: 'deterministic', verdict: 'caught', caught: 'real', ts: '2026-08-12T10:30:00Z' });
    const gates = collectHookGates({ project: PROJECT, since: '2026-08-12T09:00:00Z', until: '2026-08-12T11:00:00Z' });
    expect(gates.map((g) => g.caught)).toEqual(['real']);
  });
});

describe('a deterministic claim needs a witness from a channel the agent cannot write', () => {
  const window = { project: PROJECT, since: '2026-08-12T09:00:00Z', until: '2026-08-12T11:00:00Z' };
  const claimed: GateReport[] = [{ gate: 'tsc', gate_family: 'deterministic', verdict: 'pass', caught: '' }];
  const row = (origin?: 'work' | 'gate-test'): GateLogEntry[] => [
    {
      ts: '2026-08-12T10:00:00Z',
      project: PROJECT,
      gate: 'tsc',
      gate_family: 'deterministic',
      verdict: 'pass',
      ...(origin ? { origin } : {}),
    },
  ];

  test('a work row inside the window corroborates it', () => {
    expect(verifyDeterministicGates(claimed, window, () => row('work'))[0].gate_family).toBe('deterministic');
  });

  test('a row from before the origin field still corroborates it', () => {
    expect(verifyDeterministicGates(claimed, window, () => row())[0].gate_family).toBe('deterministic');
  });

  test('a probe row does not — it is a real row, from a run that was not this one', () => {
    const [checked] = verifyDeterministicGates(claimed, window, () => row('gate-test'));
    expect(checked.gate_family).toBe('llm');
    expect(checked.caught).toContain(UNVERIFIED_MARK);
  });
});

describe('the manager owns its own gates', () => {
  test('every gate the chain can run is listed as manager-owned', () => {
    const all = new Set<ChainGate>([...Object.values(VERIFY_CHAIN).flat(), ...Object.values(REVIEW_CHAIN).flat()]);
    for (const gate of all) expect(MANAGER_OWNED_GATES).toContain(gate);
  });
});

describe('a diff that cannot be read is reported, never assumed clean', () => {
  test('every review gate becomes an error row', async () => {
    const { ctx, prompts } = harness({ diff: () => ({ ok: false, text: '', truncated: false, error: 'not a git work tree' }) });
    const chain = await runReviewChain(ctx);
    expect(prompts).toHaveLength(0);
    expect(chain.reports.map((r) => r.verdict)).toEqual(['error', 'error']);
    expect(chain.reports[0].caught).toContain('not a git work tree');
  });
});

// 14/08: the review gates moved onto codex (§7.3 BLOCKER 4). That put a second
// binary on the critical path, and the failure it can produce is the dangerous
// shape — `runCodexSkill` answers "SKIP: codex binary not found", parseVerdict
// finds no JSON in it, and the row that lands says "agent returned no parseable
// verdict block". A machine with no codex installed would read as a model that
// answered badly, and the retry would be aimed at the model.
describe('a review gate whose transport never ran says so', () => {
  function missingTransport(): Partial<ChainContext> {
    return {
      spawn: async () => ({
        output: 'SKIP: codex binary not found',
        costUsd: 0,
        costKnown: false,
        exitReason: 'codex_not_installed',
      }),
    };
  }

  test('every gate is an error, and not one of them is a pass', async () => {
    const { ctx } = harness(missingTransport());
    const chain = await runReviewChain(ctx);

    expect(chain.reports.length).toBeGreaterThan(0);
    for (const report of chain.reports) {
      expect(report.verdict, `${report.gate} passed on a transport that never ran`).toBe('error');
    }
    expect(chain.reports.map((r) => r.verdict)).not.toContain('pass');
  });

  test('the row blames the transport, not the model that was never asked', async () => {
    const { ctx } = harness(missingTransport());
    await runReviewChain(ctx);

    const row = readEntries(PROJECT).find((r) => r.gate === 'spec-check');
    expect(row?.verdict).toBe('error');
    expect(row?.caught).toContain('codex_not_installed');
    expect(row?.caught).toContain('never ran');
    expect(row?.caught, 'a missing binary is not the model returning bad JSON').not.toContain(
      'no parseable verdict block',
    );
  });

  test('the run is marked unavailable, so a retry is not aimed at the same absent binary', async () => {
    const { ctx } = harness(missingTransport());
    const chain = await runReviewChain(ctx);
    for (const run of chain.runs) expect(run.unavailable, `${run.gate} did not report unavailable`).toBe(true);
  });

  // Chua do != bang 0. A zero here would be averaged into the lane p90 as a
  // cheap run and drag every future ceiling below what the lane really costs.
  test('an unpriced run writes no cost at all, rather than a zero', async () => {
    const { ctx } = harness({
      spawn: async () => ({ output: verdictJson({}), costUsd: 0, costKnown: false, exitReason: 'success' }),
    });
    await runReviewChain(ctx);

    const row = readEntries(PROJECT).find((r) => r.gate === 'spec-check');
    expect(row?.verdict).toBe('pass');
    expect(row?.cost_usd, 'an unpriced run must not be logged as costing $0').toBeUndefined();
  });

  test('a priced run still records its cost', async () => {
    const { ctx } = harness();
    await runReviewChain(ctx);
    expect(readEntries(PROJECT).find((r) => r.gate === 'spec-check')?.cost_usd).toBe(0.05);
  });
});
