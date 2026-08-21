#!/usr/bin/env bun
/**
 * Measures every gate in the harness against the planted-bug fixture set.
 *
 * Usage:
 *   bun personal/oracle/run.ts                  deterministic gates only, free
 *   bun personal/oracle/run.ts --matrix         also print the per-fixture grid
 *   bun personal/oracle/run.ts --write-baseline freeze this run as the baseline
 *   bun personal/oracle/run.ts --json           machine-readable report
 *   bun personal/oracle/run.ts --rejudge        judge the newest saved raw reports
 *   bun personal/oracle/run.ts --rejudge <dir>  judge raw reports from one run
 *   bun personal/oracle/run.ts --rejudge --repeat N  judge the same raw reports N times
 *   ORACLE_LLM=1 bun personal/oracle/run.ts     add spec-check and reviewer (paid)
 *   ORACLE_ROOT=<dir> bun personal/oracle/run.ts  measure a throwaway copy of the
 *     corpus instead of the installed one, so the tests can run this file end to
 *     end. It moves the fixtures, the probe harness AND the baseline together,
 *     so such a run cannot reach the real baseline, and it says so on stderr.
 *
 * Exit codes: 0 clean, 1 a fixture does not demonstrate its bug, a gate could
 * not run, the baseline contradicts itself, the fixture corpus moved since the
 * baseline was frozen, or this run is unfit to freeze, 2 a regression against
 * the baseline or a measurement lost without the operator asking for it, 3 a
 * measurement that the baseline has never frozen.
 */

import { ORACLE_ROOT_OVERRIDE, corpusFingerprint, loadCases, loadGuardFpProbes } from './lib/cases';
import {
  runGuardGate, runLintGate, runTscGate, runTscRatchet, runRedTestGate, verifyFixtures,
  type GateOutcome,
} from './lib/gates';
import { llmGatesEnabled, runSpecCheckGate, runReviewerGate, skippedLlmGate } from './lib/llm-gates';
import { backendByName, resolveBackends, type Backend } from './lib/llm-backends';
import {
  createRawReportRun, latestRawReportRun, loadRawReportRun, type LlmGateName, type RawReportRun,
} from './lib/raw-reports';
import { rejudgeRepeat } from './lib/rejudge';
import {
  buildReport, diffBaseline, writeBaseline, render, renderMatrix, exitCodeFor, recordObservedNoise, unfitToFreeze,
  type DiffContext,
} from './lib/report';

/**
 * Sampled at module load, before any fixture module has been imported, and read
 * from the switch itself rather than from `llmGatesEnabled()`: that helper also
 * returns false when a backend is merely broken, and a backend that broke is a
 * loss, not a choice.
 */
const argv = process.argv.slice(2);
const has = (flag: string) => argv.includes(flag);
const rejudgeIndex = argv.indexOf('--rejudge');
const REJUDGE_REQUESTED = rejudgeIndex !== -1;
const OPERATOR_SWITCHED_OFF_LLM = !REJUDGE_REQUESTED && process.env.ORACLE_LLM !== '1';

function requestedRawReportRun(): RawReportRun {
  const candidate = argv[rejudgeIndex + 1];
  return candidate && !candidate.startsWith('--') ? loadRawReportRun(candidate) : latestRawReportRun();
}

function cachedGateBackend(source: RawReportRun, gate: LlmGateName): Backend {
  const backend = backendByName(source.manifest.gate_backends[gate], source.manifest.gate_backends[gate]);
  return {
    ...backend,
    callJson: async () => {
      throw new Error(`rejudge attempted to call ${gate} gate backend`);
    },
  };
}

if (ORACLE_ROOT_OVERRIDE) {
  process.stderr.write(
    `oracle: ORACLE_ROOT is set — measuring the corpus at ${ORACLE_ROOT_OVERRIDE}, NOT the installed one. ` +
    'A run against a copy exercises this harness; it does not measure it.\n',
  );
}

async function main(): Promise<number> {
  // Before the gates, not after — a corpus that cannot be read should cost seconds, not a whole run.
  const corpus = corpusFingerprint();
  const cases = await loadCases();
  const fpProbes = loadGuardFpProbes();

  const integrity = await verifyFixtures(cases);
  const broken = integrity.filter(i => !i.ok);

  const outcomes: GateOutcome[] = [];
  outcomes.push(runGuardGate(cases, fpProbes));
  outcomes.push(runLintGate(cases));
  outcomes.push(runTscGate(cases));
  outcomes.push(await runRedTestGate(cases));

  const llm = REJUDGE_REQUESTED ? { enabled: true, reason: '' } : llmGatesEnabled();
  let rawRun: RawReportRun | undefined;
  let reportSource: import('./lib/report').OracleReport['report_source'];
  const repeatedLlmOutcomes: GateOutcome[][] = [];
  if (REJUDGE_REQUESTED) {
    rawRun = requestedRawReportRun();
    reportSource = {
      mode: 'rejudge',
      raw_report_run: rawRun.manifest.source_run,
      raw_report_dir: rawRun.dir,
    };
    const repeat = rejudgeRepeat(argv);
    for (let sample = 0; sample < repeat; sample++) {
      const sampleOutcomes: GateOutcome[] = [];
      for (const gate of ['spec-check', 'reviewer'] as const) {
        const judge = resolveBackends(process.env, gate).judge;
        const availability = judge.available();
        if (!availability.ok) throw new Error(`${gate} judge backend "${judge.name}" unusable: ${availability.reason}`);
        const backends = { gate: cachedGateBackend(rawRun, gate), judge };
        sampleOutcomes.push(gate === 'spec-check'
          ? await runSpecCheckGate(cases, backends, { rejudgeSource: rawRun, judgePass: sample + 1 })
          : await runReviewerGate(cases, backends, { rejudgeSource: rawRun, judgePass: sample + 1 }));
      }
      repeatedLlmOutcomes.push(sampleOutcomes);
    }
  } else if (llm.enabled) {
    const specBackends = resolveBackends(process.env, 'spec-check');
    const reviewerBackends = resolveBackends(process.env, 'reviewer');
    rawRun = createRawReportRun({
      'spec-check': specBackends.gate.name,
      reviewer: reviewerBackends.gate.name,
    });
    reportSource = {
      mode: 'live',
      raw_report_run: rawRun.manifest.source_run,
      raw_report_dir: rawRun.dir,
    };
    outcomes.push(await runSpecCheckGate(cases, specBackends, { rawReportOutput: rawRun, judgePass: 1 }));
    outcomes.push(await runReviewerGate(cases, reviewerBackends, { rawReportOutput: rawRun, judgePass: 1 }));
  } else {
    outcomes.push(skippedLlmGate('spec-check', cases, llm.reason));
    outcomes.push(skippedLlmGate('reviewer', cases, llm.reason));
  }

  const ratchet = runTscRatchet(cases);
  const report = repeatedLlmOutcomes.length > 0
    ? recordObservedNoise(repeatedLlmOutcomes.map(sample => buildReport(
      cases, [...outcomes, ...sample], integrity, ratchet, corpus, reportSource,
    )))
    : buildReport(cases, outcomes, integrity, ratchet, corpus, reportSource);
  const context: DiffContext = {
    operatorDisabledGates: OPERATOR_SWITCHED_OFF_LLM ? ['spec-check', 'reviewer'] : [],
    operatorReason: llm.reason,
  };
  const diff = diffBaseline(report, context);

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
    const unfit = unfitToFreeze(report, context);
    if (unfit.length > 0) {
      process.stderr.write(`refusing to freeze this run as the baseline:\n${unfit.map(r => `  ${r}`).join('\n')}\n`);
      return 1;
    }
    writeBaseline(report);
    process.stdout.write('baseline written to personal/oracle/baseline.json\n');
    return 0;
  }

  if (broken.length > 0) return 1;
  if (report.gates.some(g => !g.available && g.family === 'deterministic')) return 1;
  return exitCodeFor(diff);
}

main().then(
  code => process.exit(code),
  err => {
    process.stderr.write(`oracle: ${err?.stack ?? err}\n`);
    process.exit(1);
  },
);
