#!/usr/bin/env bun
/**
 * Measures every gate in the harness against the planted-bug fixture set.
 *
 * Usage:
 *   bun personal/oracle/run.ts                  deterministic gates only, free
 *   bun personal/oracle/run.ts --matrix         also print the per-fixture grid
 *   bun personal/oracle/run.ts --write-baseline freeze this run as the baseline
 *   bun personal/oracle/run.ts --json           machine-readable report
 *   ORACLE_LLM=1 bun personal/oracle/run.ts     add spec-check and reviewer (paid)
 *
 * Exit codes: 0 clean, 1 a fixture does not demonstrate its bug or a gate could
 * not run, 2 a regression against the baseline.
 */

import { loadCases, loadGuardFpProbes } from './lib/cases';
import {
  runGuardGate, runLintGate, runTscGate, runTscRatchet, runRedTestGate, verifyFixtures,
  type GateOutcome,
} from './lib/gates';
import { llmGatesEnabled, runSpecCheckGate, runReviewerGate, skippedLlmGate } from './lib/llm-gates';
import { buildReport, diffBaseline, writeBaseline, render, renderMatrix } from './lib/report';

const argv = process.argv.slice(2);
const has = (flag: string) => argv.includes(flag);

async function main(): Promise<number> {
  const cases = await loadCases();
  const fpProbes = loadGuardFpProbes();

  const integrity = await verifyFixtures(cases);
  const broken = integrity.filter(i => !i.ok);

  const outcomes: GateOutcome[] = [];
  outcomes.push(runGuardGate(cases, fpProbes));
  outcomes.push(runLintGate(cases));
  outcomes.push(runTscGate(cases));
  outcomes.push(await runRedTestGate(cases));

  const llm = llmGatesEnabled();
  if (llm.enabled) {
    outcomes.push(await runSpecCheckGate(cases));
    outcomes.push(await runReviewerGate(cases));
  } else {
    outcomes.push(skippedLlmGate('spec-check', cases, llm.reason));
    outcomes.push(skippedLlmGate('reviewer', cases, llm.reason));
  }

  const ratchet = runTscRatchet(cases);
  const report = buildReport(cases, outcomes, integrity, ratchet);
  const diff = diffBaseline(report);

  if (has('--json')) {
    process.stdout.write(`${JSON.stringify({ report, diff }, null, 2)}\n`);
  } else {
    process.stdout.write(render(report, diff));
    if (has('--matrix')) process.stdout.write(renderMatrix(report, cases));
    if (!llm.enabled) {
      process.stdout.write(`\nSKIPPED — spec-check and reviewer were NOT measured: ${llm.reason}\n`);
      process.stdout.write('The deterministic numbers above stand on their own. Do not read them as a whole-chain result.\n\n');
    }
  }

  if (has('--write-baseline')) {
    writeBaseline(report);
    process.stdout.write('baseline written to personal/oracle/baseline.json\n');
    return broken.length > 0 ? 1 : 0;
  }

  if (broken.length > 0) return 1;
  if (report.gates.some(g => !g.available && g.family === 'deterministic')) return 1;
  if (diff.regressions.length > 0) return 2;
  return 0;
}

main().then(
  code => process.exit(code),
  err => {
    process.stderr.write(`oracle: ${err?.stack ?? err}\n`);
    process.exit(1);
  },
);
