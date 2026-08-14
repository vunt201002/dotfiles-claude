import { describe, expect, test } from 'bun:test';
import { buildReportEvent, type EventSourceTask } from '../lib/events';

function task(overrides: Partial<EventSourceTask> = {}): EventSourceTask {
  return {
    id: 'joy-t1-01',
    project: 'joy',
    issue: 't1',
    attempt: 1,
    cost_usd_actual: 1.2,
    failure_reason: '',
    verify_lines: [],
    assumptions: [],
    gates_run: [],
    findings: [],
    envelope: { lane: 'bug-lon' },
    ...overrides,
  };
}

const familyOf = (gates: readonly { gate: string; gate_family: string }[], name: string) =>
  gates.find((g) => g.gate === name)?.gate_family;

describe('a passing gate reports the family that was recorded for it', () => {
  // Every gate that ran and found nothing was stamped `deterministic`
  // unconditionally, because `gates_run` holds bare names. So a `reviewer` run
  // that passed went onto the wire claiming to be a deterministic gate — and
  // P8 unlocks autonomy on "caught from deterministic >= 20%".
  test('an llm gate that passed is not stamped deterministic', () => {
    const event = buildReportEvent(
      task({
        gates_run: ['tsc', 'reviewer', 'spec-check'],
        gate_reports: [
          { gate: 'tsc', gate_family: 'deterministic' },
          { gate: 'reviewer', gate_family: 'llm' },
          { gate: 'spec-check', gate_family: 'llm' },
        ],
      }),
      true,
      'xong',
    );
    expect(familyOf(event.gates, 'tsc')).toBe('deterministic');
    expect(familyOf(event.gates, 'reviewer')).toBe('llm');
    expect(familyOf(event.gates, 'spec-check')).toBe('llm');
  });

  // A gate demoted for lack of corroboration must carry the demotion onto the
  // wire. Re-deriving the family from the gate's name here would hand back
  // exactly the claim the demotion took away.
  test('a demoted gate stays demoted on the wire', () => {
    const event = buildReportEvent(
      task({ gates_run: ['tsc'], gate_reports: [{ gate: 'tsc', gate_family: 'llm' }] }),
      true,
      'xong',
    );
    expect(familyOf(event.gates, 'tsc')).toBe('llm');
  });

  test('a gate with no recorded family falls to llm, never to deterministic', () => {
    const event = buildReportEvent(task({ gates_run: ['mystery'] }), true, 'xong');
    expect(familyOf(event.gates, 'mystery')).toBe('llm');
  });

  test('a gate that caught something keeps the family its finding carries', () => {
    const event = buildReportEvent(
      task({
        gates_run: ['red-test'],
        gate_reports: [{ gate: 'red-test', gate_family: 'deterministic' }],
        findings: [{ gate: 'red-test', gate_family: 'deterministic', text: 'null deref in cart' }],
      }),
      true,
      'xong',
    );
    expect(event.gates.filter((g) => g.gate === 'red-test')).toHaveLength(1);
    expect(familyOf(event.gates, 'red-test')).toBe('deterministic');
    expect(event.gates.find((g) => g.gate === 'red-test')?.verdict).toBe('caught');
  });
});
