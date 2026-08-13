import { describe, expect, it } from 'bun:test';
import { EnvelopeError, isTaskEnvelope, validateEnvelope, validateEnvelopeJson } from './validate';

const SPEC_EXAMPLE = {
  project: 'kivora',
  issue: 't105',
  title: 'Checkout không áp mã giảm giá khi giỏ có sản phẩm sale',
  size: 'M',
  uncertainty: 'med',
  lane: 'bug-lon',
  why: 'chạm logic tính giá dùng chung 3 nơi, chưa rõ nguồn ở FE hay rule engine',
  oracle_available: true,
  oracle_kind: ['playwright', 'tsc'],
  needs_human: false,
  blocking_questions: [],
  assumptions: [],
  assumption_count: 0,
  est_cost_usd: 1.2,
  est_turns: 40,
};

const TRIVIAL_EXAMPLE = {
  project: 'monthly-point-sync',
  issue: 'copy-01',
  title: 'Sheet header still says "Diem" instead of "Điểm"',
  size: 'S',
  uncertainty: 'low',
  lane: 'trivial',
  why: 'string literal, correct value knowable by reading, no runtime observation needed',
  oracle_available: true,
  oracle_kind: ['node-script'],
  needs_human: false,
  blocking_questions: [],
  assumptions: [],
  assumption_count: 0,
  est_cost_usd: 0.15,
  est_turns: 6,
};

function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...SPEC_EXAMPLE, ...overrides };
}

function problemsOf(input: unknown): string[] {
  try {
    validateEnvelope(input);
    throw new Error('expected validateEnvelope to throw, it returned');
  } catch (err) {
    if (!(err instanceof EnvelopeError)) throw err;
    return err.problems;
  }
}

describe('valid envelopes', () => {
  it('accepts the §3.1 example from the plan verbatim', () => {
    expect(validateEnvelope(SPEC_EXAMPLE)).toBe(SPEC_EXAMPLE as never);
  });

  it('accepts a trivial-lane envelope', () => {
    expect(isTaskEnvelope(TRIVIAL_EXAMPLE)).toBe(true);
  });

  it('accepts bug-nho when size, uncertainty and oracle all line up', () => {
    expect(isTaskEnvelope(envelope({ size: 'S', uncertainty: 'low', lane: 'bug-nho' }))).toBe(true);
  });

  it('accepts a feature at any size', () => {
    expect(isTaskEnvelope(envelope({ size: 'XL', uncertainty: 'high', lane: 'feature' }))).toBe(true);
  });

  it('accepts the optional override fields when they are consistent', () => {
    expect(
      isTaskEnvelope(envelope({ round_2_fail: true, touches_sensitive: ['payment'], lane: 'bug-lon' })),
    ).toBe(true);
  });

  it('accepts an explicit kind of code without forcing needs_human', () => {
    expect(isTaskEnvelope(envelope({ kind: 'code', needs_human: false }))).toBe(true);
  });

  it('accepts in_scope true without a defer_reason', () => {
    expect(isTaskEnvelope(envelope({ in_scope: true }))).toBe(true);
  });
});

describe('shape', () => {
  it('rejects a non-object', () => {
    expect(problemsOf('not an envelope')[0]).toContain('expected a JSON object');
    expect(problemsOf(null)[0]).toContain('expected a JSON object');
    expect(problemsOf([SPEC_EXAMPLE])[0]).toContain('expected a JSON object');
  });

  for (const field of [
    'project',
    'issue',
    'title',
    'size',
    'uncertainty',
    'lane',
    'why',
    'oracle_available',
    'oracle_kind',
    'needs_human',
    'blocking_questions',
    'assumptions',
    'assumption_count',
    'est_cost_usd',
    'est_turns',
  ]) {
    it(`rejects a missing ${field}`, () => {
      const broken = envelope();
      delete broken[field];
      expect(problemsOf(broken).some((p) => p.startsWith(`${field}:`))).toBe(true);
    });
  }

  it('reports every missing field at once rather than only the first', () => {
    expect(problemsOf({ project: 'kivora' }).length).toBeGreaterThan(10);
  });

  it('rejects an empty string where content is required', () => {
    expect(problemsOf(envelope({ title: '   ' }))).toContain('title: must not be empty');
    expect(problemsOf(envelope({ why: '' }))).toContain('why: must not be empty');
  });
});

describe('enums', () => {
  it('rejects a size outside S|M|L|XL', () => {
    expect(problemsOf(envelope({ size: 'medium' }))[0]).toContain('expected one of S | M | L | XL');
    expect(problemsOf(envelope({ size: 's' }))[0]).toContain('expected one of');
  });

  it('rejects an uncertainty outside low|med|high', () => {
    expect(problemsOf(envelope({ uncertainty: 'medium' }))[0]).toContain('expected one of low | med | high');
  });

  it('rejects a lane outside the four lanes', () => {
    expect(problemsOf(envelope({ lane: 'bug-big' }))[0]).toContain('trivial | bug-nho | bug-lon | feature');
  });

  it('rejects a touches_sensitive value outside the three sensitive surfaces', () => {
    expect(problemsOf(envelope({ touches_sensitive: ['analytics'] }))[0]).toContain('auth | payment | data-migration');
  });

  it('rejects oracle_kind entries that are not lowercase-kebab', () => {
    expect(problemsOf(envelope({ oracle_kind: ['Playwright'] }))[0]).toContain('expected lowercase-kebab');
    expect(problemsOf(envelope({ oracle_kind: ['screenshot diff'] }))[0]).toContain('expected lowercase-kebab');
  });
});

describe('numbers', () => {
  it('rejects a negative or non-finite est_cost_usd', () => {
    expect(problemsOf(envelope({ est_cost_usd: -1 }))[0]).toContain('est_cost_usd');
    expect(problemsOf(envelope({ est_cost_usd: Number.NaN }))[0]).toContain('est_cost_usd');
    expect(problemsOf(envelope({ est_cost_usd: '1.2' }))[0]).toContain('est_cost_usd');
  });

  it('rejects est_turns below one or fractional', () => {
    expect(problemsOf(envelope({ est_turns: 0 }))[0]).toContain('est_turns');
    expect(problemsOf(envelope({ est_turns: 12.5 }))[0]).toContain('est_turns');
  });

  it('rejects a negative assumption_count', () => {
    expect(problemsOf(envelope({ assumption_count: -1 }))[0]).toContain('assumption_count');
  });
});

describe('why is one sentence', () => {
  it('rejects a multi-line why', () => {
    expect(problemsOf(envelope({ why: 'first line\nsecond line' }))).toContain('why: must be one sentence on one line');
  });

  it('rejects a why long enough to be a paragraph', () => {
    expect(problemsOf(envelope({ why: 'x'.repeat(241) }))[0]).toContain('max 240 chars');
  });
});

describe('structural consistency from §3.1', () => {
  it('rejects oracle_available true with an empty oracle_kind', () => {
    expect(problemsOf(envelope({ oracle_kind: [] }))).toContain(
      'oracle_available is true but oracle_kind is empty — name what runs, or set it false',
    );
  });

  it('rejects oracle_available false while oracle_kind still names a runner', () => {
    const problems = problemsOf(envelope({ oracle_available: false, needs_human: true }));
    expect(problems.some((p) => p.includes('oracle_available is false but oracle_kind lists'))).toBe(true);
  });

  it('rejects assumption_count disagreeing with the assumptions array', () => {
    const problems = problemsOf(envelope({ assumptions: ['rule engine owns pricing'], assumption_count: 0 }));
    expect(problems.some((p) => p.includes('assumption_count is 0 but assumptions holds 1'))).toBe(true);
  });
});

describe('override 1 — no oracle means a human is required', () => {
  it('rejects oracle_available false with needs_human false', () => {
    const problems = problemsOf(envelope({ oracle_available: false, oracle_kind: [], needs_human: false }));
    expect(problems.some((p) => p.startsWith('override 1:'))).toBe(true);
  });

  it('accepts oracle_available false once needs_human is true', () => {
    expect(isTaskEnvelope(envelope({ oracle_available: false, oracle_kind: [], needs_human: true }))).toBe(true);
  });

  it('rejects a trivial lane with no oracle and no human, at the smallest size', () => {
    const problems = problemsOf({ ...TRIVIAL_EXAMPLE, oracle_available: false, oracle_kind: [] });
    expect(problems.some((p) => p.startsWith('override 1:'))).toBe(true);
  });
});

describe('override 2 — a round-2 fail is always bug-lon', () => {
  for (const lane of ['trivial', 'bug-nho', 'feature']) {
    it(`rejects round_2_fail true on lane ${lane}`, () => {
      const problems = problemsOf(
        envelope({ lane, size: 'S', uncertainty: 'low', round_2_fail: true }),
      );
      expect(problems.some((p) => p.startsWith('override 2:'))).toBe(true);
    });
  }

  it('accepts round_2_fail true on bug-lon even when the size is S', () => {
    expect(isTaskEnvelope(envelope({ lane: 'bug-lon', size: 'S', uncertainty: 'low', round_2_fail: true }))).toBe(true);
  });
});

describe('override 3 — auth, payment and data migration are at least bug-lon', () => {
  for (const surface of ['auth', 'payment', 'data-migration']) {
    it(`rejects a bug-nho that touches ${surface}`, () => {
      const problems = problemsOf(
        envelope({ lane: 'bug-nho', size: 'S', uncertainty: 'low', touches_sensitive: [surface] }),
      );
      expect(problems.some((p) => p.startsWith('override 3:'))).toBe(true);
    });
  }

  it('rejects a trivial lane that touches auth', () => {
    const problems = problemsOf({ ...TRIVIAL_EXAMPLE, touches_sensitive: ['auth'] });
    expect(problems.some((p) => p.startsWith('override 3:'))).toBe(true);
  });

  it('leaves feature alone since Workflow A already carries heavier gates', () => {
    expect(isTaskEnvelope(envelope({ lane: 'feature', touches_sensitive: ['data-migration'] }))).toBe(true);
  });
});

describe('override 4 — more than two assumptions needs a human', () => {
  it('rejects three assumptions with needs_human false', () => {
    const problems = problemsOf(
      envelope({ assumptions: ['a', 'b', 'c'], assumption_count: 3, needs_human: false }),
    );
    expect(problems.some((p) => p.startsWith('override 4:'))).toBe(true);
  });

  it('accepts exactly two assumptions with needs_human false', () => {
    expect(isTaskEnvelope(envelope({ assumptions: ['a', 'b'], assumption_count: 2, needs_human: false }))).toBe(true);
  });

  it('accepts three assumptions once needs_human is true', () => {
    expect(isTaskEnvelope(envelope({ assumptions: ['a', 'b', 'c'], assumption_count: 3, needs_human: true }))).toBe(true);
  });
});

describe('parked work — in_scope false never restarts silently', () => {
  it('rejects in_scope false with needs_human false', () => {
    const problems = problemsOf(envelope({ in_scope: false, defer_reason: 'launch plan §8 defers it', needs_human: false }));
    expect(problems.some((p) => p.includes('a parked item does not silently restart'))).toBe(true);
  });

  it('rejects in_scope false with no defer_reason', () => {
    const problems = problemsOf(envelope({ in_scope: false, needs_human: true }));
    expect(problems.some((p) => p.includes('defer_reason must say why it was parked'))).toBe(true);
  });

  it('rejects an empty defer_reason', () => {
    expect(problemsOf(envelope({ defer_reason: '  ' }))[0]).toContain('defer_reason');
  });

  it('accepts a parked item carrying both a reason and a human', () => {
    expect(
      isTaskEnvelope(
        envelope({
          in_scope: false,
          defer_reason: 'launch plan §8 parks it until a locale outside nl/fr/de/en is added',
          needs_human: true,
        }),
      ),
    ).toBe(true);
  });
});

describe('kind — non-code work cannot pick its own follow-up lane', () => {
  it('rejects a kind outside the four work kinds', () => {
    expect(problemsOf(envelope({ kind: 'spike' }))[0]).toContain('code | investigate | provision | decide');
  });

  for (const kind of ['investigate', 'provision', 'decide']) {
    it(`rejects kind ${kind} with needs_human false`, () => {
      const problems = problemsOf(envelope({ kind, needs_human: false }));
      expect(problems.some((p) => p.includes('the lane describes the follow-up work'))).toBe(true);
    });

    it(`accepts kind ${kind} once needs_human is true`, () => {
      expect(isTaskEnvelope(envelope({ kind, needs_human: true }))).toBe(true);
    });
  }
});

describe('lane floor — a short lane cannot be claimed for work the table calls bug-lon', () => {
  it('rejects bug-nho at size M', () => {
    const problems = problemsOf(envelope({ lane: 'bug-nho', size: 'M', uncertainty: 'low' }));
    expect(problems.some((p) => p.includes('needs size S and uncertainty low'))).toBe(true);
  });

  it('rejects trivial at uncertainty med', () => {
    const problems = problemsOf(envelope({ lane: 'trivial', size: 'S', uncertainty: 'med' }));
    expect(problems.some((p) => p.includes('needs size S and uncertainty low'))).toBe(true);
  });

  it('rejects bug-nho without an oracle even when it is small and certain', () => {
    const problems = problemsOf(
      envelope({ lane: 'bug-nho', size: 'S', uncertainty: 'low', oracle_available: false, oracle_kind: [], needs_human: true }),
    );
    expect(problems.some((p) => p.includes('lane bug-nho requires oracle_available true'))).toBe(true);
  });

  it('allows a conservative call — bug-lon on small certain work is never rejected', () => {
    expect(isTaskEnvelope(envelope({ lane: 'bug-lon', size: 'S', uncertainty: 'low' }))).toBe(true);
  });
});

describe('validateEnvelopeJson', () => {
  it('accepts a single envelope', () => {
    expect(validateEnvelopeJson(JSON.stringify(SPEC_EXAMPLE))).toHaveLength(1);
  });

  it('accepts a batch array', () => {
    expect(validateEnvelopeJson(JSON.stringify([SPEC_EXAMPLE, TRIVIAL_EXAMPLE]))).toHaveLength(2);
  });

  it('prefixes problems with the index when validating a batch', () => {
    const bad = { ...SPEC_EXAMPLE, size: 'huge' };
    try {
      validateEnvelopeJson(JSON.stringify([SPEC_EXAMPLE, bad]));
      throw new Error('expected a throw');
    } catch (err) {
      expect((err as EnvelopeError).problems[0]).toStartWith('[1] ');
    }
  });

  it('rejects malformed JSON with a readable message', () => {
    try {
      validateEnvelopeJson('{ not json');
      throw new Error('expected a throw');
    } catch (err) {
      expect((err as EnvelopeError).problems[0]).toContain('not valid JSON');
    }
  });

  it('rejects an empty array', () => {
    try {
      validateEnvelopeJson('[]');
      throw new Error('expected a throw');
    } catch (err) {
      expect((err as EnvelopeError).problems[0]).toContain('empty array');
    }
  });
});

describe('EnvelopeError', () => {
  it('carries every problem and renders them in the message', () => {
    try {
      validateEnvelope(envelope({ size: 'huge', lane: 'nope' }));
      throw new Error('expected a throw');
    } catch (err) {
      const error = err as EnvelopeError;
      expect(error.name).toBe('EnvelopeError');
      expect(error.problems).toHaveLength(2);
      expect(error.message).toContain('2 problems');
      expect(error.message).toContain('size:');
      expect(error.message).toContain('lane:');
    }
  });
});
