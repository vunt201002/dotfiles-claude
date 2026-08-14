import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-indep-'));
process.env.MANAGER_HOME = HOME;
process.env.GSTACK_GATE_LOG_DIR = path.join(HOME, 'gate-log');

import { describe, test, expect, afterAll } from 'bun:test';
import {
  DEFAULT_CONFIG,
  familyOfModel,
  resolveReviewProvider,
  reviewIndependence,
  REVIEW_PROVIDER_FAMILY,
  type ManagerConfig,
  type ReviewProvider,
} from '../config';
import { codexOutcome, redactSecrets, reviewPorts, transportFailed, TRANSPORT_FAILURES } from '../lib/spawn';
import { applyEnsembleRule } from '../lib/verdict';

afterAll(() => {
  try {
    fs.rmSync(HOME, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

function config(overrides: Partial<ManagerConfig> = {}): ManagerConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

// §7.3 BLOCKER 4. The three strongest gates in the chain are LLM gates, and
// gates that share a model family share its blind spots — so two of them
// agreeing is one opinion counted twice, not the cross-confirmation the
// ensemble rule thinks it is getting. The measurement layer already refuses to
// let that collapse happen quietly (resolveBackends in oracle/lib/llm-backends).
// This is the same property for the path that actually runs.
describe('the review path is not the same model family as the agent it grades', () => {
  test('the shipped default puts the REVIEW gates in a different family from the agent', () => {
    const independence = reviewIndependence(DEFAULT_CONFIG);
    expect(independence.reviewIndependent, `review and agent are both ${independence.reviewFamily}`).toBe(true);
    expect(independence.reviewFamily).not.toBe(independence.agentFamilies[0]);
  });

  // The judges run on the spawn port, so they are Claude grading Claude. The
  // function used to look only at the review provider and answer `true`, which
  // is the comfortable answer rather than the true one.
  test('the judges are counted, so the default is NOT fully independent', () => {
    const independence = reviewIndependence(DEFAULT_CONFIG);
    expect(independence.judgeIndependent).toBe(false);
    expect(independence.fullyIndependent).toBe(false);
    expect(independence.line).toContain("judges share the agent's family");
  });

  test('a config that collapses the review half is reported as such', () => {
    const collapsed = reviewIndependence(config({ reviewProvider: 'opus-fresh' }));
    expect(collapsed.reviewIndependent).toBe(false);
    expect(collapsed.line).toContain("review shares the agent's family");
    expect(collapsed.line).toContain('§7.3');
  });

  // modelForRole swaps subagent to its fallback on the last bug-lon attempt.
  // Reading route.model alone cleared a pairing that goes same-family on
  // attempt 3 — the attempt that matters most.
  test('the escalation model counts toward the agent side', () => {
    const escalating = reviewIndependence(
      config({ models: { ...DEFAULT_CONFIG.models, subagent: { model: 'sonnet', fallback: 'gpt-5-codex' } } }),
    );
    expect(escalating.agentFamilies).toContain('openai');
    expect(escalating.reviewIndependent, 'attempt 3 runs codex reviewing codex').toBe(false);
  });

  test('the line names every half so the reader can check the claim', () => {
    const line = reviewIndependence(DEFAULT_CONFIG).line;
    expect(line).toContain(DEFAULT_CONFIG.reviewProvider);
    expect(line).toContain(DEFAULT_CONFIG.models.subagent.model);
    expect(line).toContain(DEFAULT_CONFIG.models.judge.model);
  });

  // The codex port shells `codex exec` against the operator's own ~/.codex/
  // config; nothing reports which model that picked. Saying "openai" is a
  // declaration, and the line has to admit that rather than read as a reading.
  test('the review family is labelled as asserted, never as observed', () => {
    expect(reviewIndependence(DEFAULT_CONFIG).line).toContain('asserted');
  });

  test('every alias the manager routes to is classified', () => {
    for (const route of Object.values(DEFAULT_CONFIG.models)) {
      expect(familyOfModel(route.model), `${route.model} has no family`).not.toBe('unknown');
    }
    expect(familyOfModel('opus')).toBe('anthropic');
    expect(familyOfModel('gpt-5-codex')).toBe('openai');
  });

  // "Anything not Claude is OpenAI" would label a Gemini route openai and print
  // it as though someone had checked. An unrecognised model has to refuse to
  // support the independence claim rather than accidentally granting it.
  test('an unclassified model does not get to count as independent', () => {
    const exotic = reviewIndependence(
      config({ models: { ...DEFAULT_CONFIG.models, subagent: { model: 'gemini-3-pro', fallback: '' } } }),
    );
    expect(familyOfModel('gemini-3-pro')).toBe('unknown');
    expect(exotic.reviewIndependent, 'independence was granted to a model nobody classified').toBe(false);
    expect(exotic.line).toContain('unknown');
  });
});

// A provider added to the type but not to one of the two tables would either
// have no transport or no family, and the second one fails open: an unclassified
// provider would read as independent without anything having checked.
describe('a review provider cannot be half-added', () => {
  test('every declared provider has a port and a family', () => {
    for (const provider of Object.keys(REVIEW_PROVIDER_FAMILY) as ReviewProvider[]) {
      expect(reviewPorts[provider], `${provider} has a family but no transport`).toBeDefined();
    }
    for (const provider of Object.keys(reviewPorts)) {
      expect(
        REVIEW_PROVIDER_FAMILY[provider as ReviewProvider],
        `${provider} has a transport but no declared family`,
      ).toBeDefined();
    }
  });

  // The runtime override file is hand-edited. A typo there used to fall through
  // to a hardcoded 'opus-fresh', which is the agent's own family — the exact
  // collapse this whole change removes, arrived at by mistyping a word.
  test('an unrecognised provider lands on the shipped default, not on Claude', () => {
    const resolved = resolveReviewProvider(config({ reviewProvider: 'oopus-frsh' as ReviewProvider }));
    expect(resolved).toBe(DEFAULT_CONFIG.reviewProvider);
    expect(reviewIndependence(config({ reviewProvider: 'oopus-frsh' as ReviewProvider })).reviewIndependent).toBe(true);
  });
});

const TEST_DIR = path.dirname(new URL(import.meta.url).pathname);
const SPAWN_MODULE = path.resolve(TEST_DIR, '..', 'lib', 'spawn.ts');

describe('the codex review port reports what it cannot measure', () => {
  // Run in a CHILD with codex off its PATH from birth, rather than mocking the
  // runner, so this covers the port that actually ships. It has to be a child:
  // runCodexSkill probes with Bun.spawnSync(['which','codex']), which reads the
  // env as it was at process start, so scrubbing process.env.PATH in here would
  // leave the probe saying yes and only the later launch saying no.
  //
  // `which` fails, runCodexSkill returns its SKIP sentinel before launching
  // anything, and the test spends nothing.
  test('a missing binary is a transport failure carrying no fabricated cost', () => {
    const script = path.join(HOME, 'probe-codex-port.ts');
    fs.writeFileSync(
      script,
      [
        `import { reviewPorts } from ${JSON.stringify(SPAWN_MODULE)};`,
        'const result = await reviewPorts.codex.run({',
        "  role: 'review', taskId: 'indep-1', project: 'demo', issue: 't1',",
        `  scope: ${JSON.stringify(HOME)}, source: 'cli', prompt: 'review this diff', modelAlias: 'opus',`,
        '});',
        'console.log(JSON.stringify(result));',
      ].join('\n'),
    );

    const proc = Bun.spawnSync([process.execPath, 'run', script], {
      env: { PATH: '/usr/bin:/bin', HOME, MANAGER_HOME: HOME, GSTACK_GATE_LOG_DIR: path.join(HOME, 'gate-log') },
    });
    expect(proc.exitCode, `probe failed: ${proc.stderr.toString()}`).toBe(0);

    const result = JSON.parse(proc.stdout.toString()) as { exitReason: string; costKnown: boolean; costUsd: number };
    expect(result.exitReason).toBe('codex_not_installed');
    expect(transportFailed(result.exitReason), 'the chain would read this as a model that answered badly').toBe(true);
    expect(result.costKnown, 'a run that never happened still must not claim a measured cost').toBe(false);
    expect(result.costUsd).toBe(0);
  });

  test('codex spends CLI quota, so its cost is unknown rather than zero', () => {
    const src = fs.readFileSync(SPAWN_MODULE, 'utf-8');
    const port = src.slice(src.indexOf('  codex: {'));
    const body = port.slice(0, port.indexOf('\n  },\n'));
    expect(body, 'the codex port went back to claiming a measured cost').toContain('costKnown: false');
  });

  test('every transport failure is a reason the chain can recognise', () => {
    expect(TRANSPORT_FAILURES.length).toBeGreaterThan(0);
    for (const reason of TRANSPORT_FAILURES) expect(transportFailed(reason)).toBe(true);
    expect(transportFailed('success')).toBe(false);
    expect(transportFailed('error_max_turns')).toBe(false);
  });
});

// 14/08 review finding. `codex_not_installed` was the ONLY reason the port
// could produce that `transportFailed` recognised; everything else became
// `exit_code_N`. So an expired login, a rate limit, a sandbox denial and the
// runner's own 300s wall all reached the chain as a model that answered badly —
// and the port never read `stderr`, where codex writes the one line that says
// which of those happened.
describe('every way codex can fail to answer is a transport failure', () => {
  const cases: Array<[string, { output: string; exitCode: number; stderr: string }, string]> = [
    ['binary missing', { output: 'SKIP: codex binary not found', exitCode: -1, stderr: '' }, 'codex_not_installed'],
    ['logged out', { output: '', exitCode: 1, stderr: 'ERROR: not authenticated' }, 'codex_no_answer'],
    ['rate limited', { output: '', exitCode: 1, stderr: 'rate limit exceeded' }, 'codex_no_answer'],
    ['exited clean but silent', { output: '   ', exitCode: 0, stderr: '' }, 'codex_no_answer'],
    ["the runner's wall clock", { output: '', exitCode: 124, stderr: '' }, 'codex_timeout'],
  ];

  for (const [name, result, expected] of cases) {
    test(`${name} is recognised, not blamed on the model`, () => {
      const outcome = codexOutcome(result);
      expect(outcome.exitReason).toBe(expected);
      expect(transportFailed(outcome.exitReason), `${name} would reach the chain as a bad answer`).toBe(true);
    });
  }

  test('an answer is still an answer, whatever the exit code', () => {
    expect(codexOutcome({ output: '{"verdict":"pass"}', exitCode: 0, stderr: '' }).exitReason).toBe('success');
    expect(codexOutcome({ output: '{"verdict":"pass"}', exitCode: 3, stderr: '' }).exitReason).toBe('exit_code_3');
  });

  test('stderr is carried back, because it is the only account of why', () => {
    const outcome = codexOutcome({ output: '', exitCode: 1, stderr: 'ERROR: not authenticated. Run `codex login`.' });
    expect(outcome.output).toContain('codex login');
  });

  // stderr is both the useful diagnostic and the likeliest place for a token,
  // and it now lands in the gate log, which persists.
  test('a credential in stderr does not reach the log', () => {
    const outcome = codexOutcome({ output: '', exitCode: 1, stderr: 'auth failed for sk-abcd1234efgh5678ijkl' });
    expect(outcome.output).not.toContain('sk-abcd1234efgh5678ijkl');
    expect(outcome.output).toContain('[redacted]');
    expect(redactSecrets('token ghp_ABCDEFGH12345678 here')).not.toContain('ghp_ABCDEFGH12345678');
  });
});

// The sharpest finding of the 14/08 review: two gates that produced NO answer
// used to cross-confirm each other, because parseVerdict returns one CONSTANT
// string for unparseable output and the ensemble keyed on that text. Two
// broken gates therefore reached `block: "two llm gates agree"` — the phrasing
// §7.3 reserves for independent corroboration — having judged nothing.
describe('a gate that produced no answer cannot corroborate another', () => {
  const NO_ANSWER = 'agent returned no parseable verdict block';
  const broke = (gate: string) => ({ gate, gate_family: 'llm' as const, verdict: 'error' as const, caught: NO_ANSWER });

  test('two identically-broken gates do not manufacture agreement', () => {
    const decision = applyEnsembleRule([broke('spec-check'), broke('tech-review')]);
    expect(decision.why, 'two gates that judged nothing claimed to agree').not.toContain('agree');
    expect(decision.broken).toEqual(['spec-check', 'tech-review']);
    expect(decision.answered, 'nothing judged this diff').toBe(0);
  });

  test('a broken gate is still escalated, never dropped', () => {
    const decision = applyEnsembleRule([broke('spec-check'), broke('tech-review')]);
    expect(decision.outcome).not.toBe('clear');
    expect(decision.findings.length).toBe(2);
  });

  test('a real finding beside a broken gate survives', () => {
    const real = { gate: 'tech-review', gate_family: 'llm' as const, verdict: 'caught' as const, caught: 'unbounded loop' };
    const decision = applyEnsembleRule([broke('spec-check'), real]);
    expect(decision.findings.map((f) => f.text)).toContain('unbounded loop');
    expect(decision.broken).toEqual(['spec-check']);
    expect(decision.answered).toBe(1);
  });

  test('a deterministic gate failing still blocks on its own', () => {
    const decision = applyEnsembleRule([
      { gate: 'B8-assert', gate_family: 'deterministic', verdict: 'error', caught: 'suite failed' },
    ]);
    expect(decision.outcome).toBe('block');
  });
});

// applyEnsembleRule had no family field at all, so the two judges — both Claude,
// both on the spawn port — naming the same finding reached the strongest verdict
// in the system described as independent corroboration.
describe('agreement is labelled by whose agreement it is', () => {
  const finding = (gate: string, family: string) => ({
    gate, gate_family: 'llm' as const, verdict: 'caught' as const, caught: 'the modal traps focus', family,
  });

  test('same-family agreement still blocks, but is not called corroboration', () => {
    const decision = applyEnsembleRule([finding('B8-judge', 'anthropic'), finding('design-judge', 'anthropic')]);
    expect(decision.outcome, 'a real finding must still stop the task').toBe('block');
    expect(decision.why).toContain('same family');
    expect(decision.why).not.toContain('across families');
  });

  test('cross-family agreement is what the rule was written for', () => {
    const decision = applyEnsembleRule([finding('design-judge', 'anthropic'), finding('spec-check', 'openai')]);
    expect(decision.outcome).toBe('block');
    expect(decision.why).toContain('across families');
  });
});
