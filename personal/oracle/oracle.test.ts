import { describe, test, expect } from 'bun:test';
import { loadCases, loadGuardFpProbes, loadGroundTruth } from './lib/cases';
import { verifyFixtures, runRedTestGate, runGuardGate, runLintGate, runTscGate } from './lib/gates';
import { llmGatesEnabled, runSpecCheckGate, runReviewerGate } from './lib/llm-gates';
import { summarize, diffBaseline, buildReport } from './lib/report';

const slowGates = process.env.ORACLE === '1';
const llm = llmGatesEnabled();

describe('oracle fixture integrity', () => {
  test('every ground-truth bug names a real source', async () => {
    const gt = loadGroundTruth();
    expect(gt.bugs.length).toBe(gt.total_bugs);
    for (const bug of gt.bugs) {
      expect(bug.source.length).toBeGreaterThan(10);
      expect(bug.spec.length).toBeGreaterThan(10);
      expect(bug.detection_hint).toContain('|');
    }
  });

  test('every fixture is red on buggy and green on fixed', async () => {
    const cases = await loadCases();
    const integrity = await verifyFixtures(cases);
    const broken = integrity.filter(i => !i.ok).map(i => `${i.id}: ${i.detail}`);
    expect(broken).toEqual([]);
    expect(integrity.length).toBe(cases.length);
  }, 120_000);

  test('the red test gate does not regress against the baseline', async () => {
    const cases = await loadCases();
    const redTest = await runRedTestGate(cases);
    const stats = summarize(redTest, cases.length);
    expect(stats.error).toBe(0);
    expect(stats.false_positives).toBe(0);

    const report = buildReport(cases, [redTest], [], {});
    const diff = diffBaseline(report);
    if (diff.hasBaseline) {
      const own = diff.regressions.filter(r => r.includes('red-test'));
      expect(own).toEqual([]);
    }
  }, 180_000);
});

describe.skipIf(!slowGates)('oracle deterministic gates (ORACLE=1)', () => {
  test('guard, lint and tsc all pass their canaries', async () => {
    const cases = await loadCases();
    const outcomes = [runGuardGate(cases, loadGuardFpProbes()), runLintGate(cases), runTscGate(cases)];
    const dead = outcomes.filter(o => !o.available).map(o => `${o.gate}: ${o.unavailable_reason}`);
    expect(dead).toEqual([]);
  }, 900_000);

  test('no deterministic gate regresses against the baseline', async () => {
    const cases = await loadCases();
    const outcomes = [
      runGuardGate(cases, loadGuardFpProbes()),
      runLintGate(cases),
      runTscGate(cases),
      await runRedTestGate(cases),
    ];
    const report = buildReport(cases, outcomes, await verifyFixtures(cases), {});
    const diff = diffBaseline(report);
    expect(diff.regressions).toEqual([]);
  }, 900_000);
});

describe.skipIf(!llm.enabled)('oracle llm gates (ORACLE_LLM=1 + ANTHROPIC_API_KEY)', () => {
  test('spec-check and reviewer produce a measurable verdict for every fixture', async () => {
    const cases = await loadCases();
    const outcomes = [await runSpecCheckGate(cases), await runReviewerGate(cases)];
    for (const o of outcomes) {
      const stats = summarize(o, cases.length);
      expect(stats.error).toBe(0);
      expect(stats.applicable).toBe(cases.length);
    }
  }, 1_800_000);
});

if (!llm.enabled) {
  console.warn(`\n[oracle] LLM gates NOT measured: ${llm.reason}\n`);
}
if (!slowGates) {
  console.warn('[oracle] guard / lint / tsc NOT measured here — set ORACLE=1 (free, needs npx)\n');
}
