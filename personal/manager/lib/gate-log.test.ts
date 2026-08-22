import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  appendGateLog,
  readGateLog,
  readGateLogRaw,
  readGateLogCorrections,
  reclassify,
  refOf,
  entryRef,
  precisionByGate,
  gateLogPath,
  gateLogDir,
  shouldBlindSample,
  isKnownGate,
  validateGateLogEntry,
  originOf,
  isUnstamped,
  workOnly,
  ORIGIN_ENV,
  BLIND_SAMPLE_RATE,
} from './gate-log';

let sandbox: string;
const originalDir = process.env.GSTACK_GATE_LOG_DIR;
const originalOrigin = process.env[ORIGIN_ENV];

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-log-test-'));
  process.env.GSTACK_GATE_LOG_DIR = sandbox;
  delete process.env[ORIGIN_ENV];
});

afterEach(() => {
  if (originalDir === undefined) delete process.env.GSTACK_GATE_LOG_DIR;
  else process.env.GSTACK_GATE_LOG_DIR = originalDir;
  if (originalOrigin === undefined) delete process.env[ORIGIN_ENV];
  else process.env[ORIGIN_ENV] = originalOrigin;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe('append / read round-trip', () => {
  test('a full §3.3 entry survives the round-trip unchanged', () => {
    appendGateLog({
      project: 'kivora',
      issue: 't105',
      lane: 'bug-lon',
      gate: 'spec-check',
      gate_family: 'llm',
      verdict: 'caught',
      attempt: 1,
      cost_usd: 0.12,
      caught: 'thêm endpoint /discount/preview không có trong scope',
      review_depth: 'summary',
      human_intervened: false,
    });

    const entries = readGateLog('kivora');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      project: 'kivora',
      issue: 't105',
      lane: 'bug-lon',
      gate: 'spec-check',
      gate_family: 'llm',
      verdict: 'caught',
      attempt: 1,
      cost_usd: 0.12,
      review_depth: 'summary',
      human_intervened: false,
    });
    expect(entries[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('appends keep chronological order and one line each', () => {
    appendGateLog({ project: 'kivora', gate: 'lint', gate_family: 'deterministic', verdict: 'pass' });
    appendGateLog({ project: 'kivora', gate: 'tsc', gate_family: 'deterministic', verdict: 'caught', caught: 'TS2345' });

    const raw = fs.readFileSync(gateLogPath('kivora'), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw.trimEnd().split('\n')).toHaveLength(2);
    expect(readGateLog('kivora').map((e) => e.gate)).toEqual(['lint', 'tsc']);
  });

  test('readGateLog() with no project merges every project file by ts', () => {
    appendGateLog({ project: 'joy', gate: 'lint', gate_family: 'deterministic', verdict: 'pass', ts: '2026-08-12T10:00:00.000Z' });
    appendGateLog({ project: 'kivora', gate: 'tsc', gate_family: 'deterministic', verdict: 'pass', ts: '2026-08-12T09:00:00.000Z' });

    expect(readGateLog().map((e) => e.project)).toEqual(['kivora', 'joy']);
  });

  test('reading a project that was never written returns empty, not a throw', () => {
    expect(readGateLog('never-seen')).toEqual([]);
  });

  test('optional fields are omitted rather than written as null', () => {
    appendGateLog({ project: 'kivora', gate: 'guard', gate_family: 'deterministic', verdict: 'caught' });
    const raw = fs.readFileSync(gateLogPath('kivora'), 'utf8').trim();
    expect(raw).not.toContain('null');
    expect(JSON.parse(raw)).not.toHaveProperty('issue');
  });
});

describe('origin separates real work from probing the gate (§3.3)', () => {
  const line = { project: 'kivora', gate: 'guard', gate_family: 'deterministic', verdict: 'caught' } as const;

  test('a line is stamped work by default, and the stamp is written, not implied', () => {
    appendGateLog(line);
    expect(readGateLog('kivora')[0].origin).toBe('work');
    expect(JSON.parse(fs.readFileSync(gateLogPath('kivora'), 'utf8').trim()).origin).toBe('work');
  });

  test('the environment stamps every writer below it, which is how hooks carry it', () => {
    process.env[ORIGIN_ENV] = 'gate-test';
    appendGateLog(line);
    expect(readGateLog('kivora')[0].origin).toBe('gate-test');
  });

  test('an explicit origin beats the environment', () => {
    process.env[ORIGIN_ENV] = 'gate-test';
    appendGateLog({ ...line, origin: 'work' });
    expect(readGateLog('kivora')[0].origin).toBe('work');
  });

  test('an unknown origin throws instead of writing', () => {
    expect(() => appendGateLog({ ...line, origin: 'probe' as never })).toThrow(/origin must be one of/);
    expect(fs.existsSync(gateLogPath('kivora'))).toBe(false);
  });

  test('a misspelt env value throws instead of quietly falling back to work', () => {
    process.env[ORIGIN_ENV] = 'gatetest';
    expect(() => appendGateLog(line)).toThrow(new RegExp(ORIGIN_ENV));
    expect(fs.existsSync(gateLogPath('kivora'))).toBe(false);
  });

  test('an empty env value is not a value — it falls through to the default', () => {
    process.env[ORIGIN_ENV] = '   ';
    appendGateLog(line);
    expect(readGateLog('kivora')[0].origin).toBe('work');
  });

  test('lines written before the field read as work, but say so', () => {
    fs.mkdirSync(sandbox, { recursive: true });
    fs.writeFileSync(
      gateLogPath('dotfiles-claude'),
      `${JSON.stringify({ ts: '2026-08-12T09:00:00.000Z', project: 'dotfiles-claude', gate: 'guard', gate_family: 'deterministic', verdict: 'caught' })}\n`,
      'utf8',
    );
    const [legacy] = readGateLog('dotfiles-claude');
    expect(legacy.origin).toBeUndefined();
    expect(originOf(legacy)).toBe('work');
    expect(isUnstamped(legacy)).toBe(true);
  });

  test('workOnly drops probe lines and keeps unstamped ones', () => {
    appendGateLog({ ...line, caught: 'real' });
    appendGateLog({ ...line, caught: 'probe', origin: 'gate-test' });
    fs.appendFileSync(
      gateLogPath('kivora'),
      `${JSON.stringify({ ts: '2026-08-12T09:00:00.000Z', project: 'kivora', gate: 'guard', gate_family: 'deterministic', verdict: 'caught', caught: 'legacy' })}\n`,
      'utf8',
    );

    expect(readGateLog('kivora')).toHaveLength(3);
    expect(workOnly(readGateLog('kivora')).map((e) => e.caught)).toEqual(['real', 'legacy']);
  });

  test('precision over a probe run and precision over work are different numbers', () => {
    appendGateLog({ ...line, caught: 'real catch' });
    for (const n of [1, 2, 3]) appendGateLog({ ...line, caught: `probe ${n}`, origin: 'gate-test' });
    reclassify(refOf(workOnly(readGateLog('kivora'))[0]), 'false-positive', 'oan');

    expect(precisionByGate(readGateLog('kivora'))[0].precision).toBe(0.75);
    expect(precisionByGate(workOnly(readGateLog('kivora')))[0].precision).toBe(0);
  });
});

describe('the data contract throws instead of writing garbage', () => {
  const base = { project: 'kivora', gate: 'lint' } as const;

  test('an unknown verdict throws', () => {
    expect(() =>
      appendGateLog({ ...base, gate_family: 'deterministic', verdict: 'maybe' as never }),
    ).toThrow(/verdict must be one of/);
  });

  test('a missing verdict throws', () => {
    expect(() => appendGateLog({ ...base, gate_family: 'deterministic', verdict: undefined as never })).toThrow(
      /verdict must be one of/,
    );
  });

  test('an unknown gate_family throws', () => {
    expect(() => appendGateLog({ ...base, gate_family: 'vibes' as never, verdict: 'pass' })).toThrow(
      /gate_family must be one of/,
    );
  });

  test('an unknown review_depth throws', () => {
    expect(() =>
      appendGateLog({ ...base, gate_family: 'llm', verdict: 'pass', review_depth: 'skimmed' as never }),
    ).toThrow(/review_depth must be one of/);
  });

  test('a non-numeric cost_usd throws', () => {
    expect(() =>
      appendGateLog({ ...base, gate_family: 'llm', verdict: 'pass', cost_usd: 'cheap' as never }),
    ).toThrow(/cost_usd must be a finite number/);
  });

  test('a non-boolean human_intervened throws', () => {
    expect(() =>
      appendGateLog({ ...base, gate_family: 'llm', verdict: 'pass', human_intervened: 'yes' as never }),
    ).toThrow(/human_intervened must be a boolean/);
  });

  test('a missing project throws', () => {
    expect(() =>
      appendGateLog({ gate: 'lint', gate_family: 'llm', verdict: 'pass', project: undefined as never }),
    ).toThrow(/project must be a string/);
  });

  test('a rejected entry writes no file at all', () => {
    expect(() => appendGateLog({ ...base, gate_family: 'llm', verdict: 'nope' as never })).toThrow();
    expect(fs.existsSync(gateLogPath('kivora'))).toBe(false);
  });

  test('a gate outside the §3.3 list is still written', () => {
    expect(isKnownGate('spec-check')).toBe(true);
    expect(isKnownGate('wibble')).toBe(false);
    appendGateLog({ project: 'kivora', gate: 'wibble', gate_family: 'llm', verdict: 'pass' });
    expect(readGateLog('kivora')[0].gate).toBe('wibble');
  });

  test('string forms of numeric and boolean fields coerce (the CLI passes strings)', () => {
    const entry = validateGateLogEntry({
      project: 'kivora',
      gate: 'lint',
      gate_family: 'llm',
      verdict: 'pass',
      attempt: '2' as never,
      cost_usd: '0.5' as never,
      human_intervened: 'true' as never,
    });
    expect(entry.attempt).toBe(2);
    expect(entry.cost_usd).toBe(0.5);
    expect(entry.human_intervened).toBe(true);
  });

  test('caught is capped so one stray blob cannot bloat the log', () => {
    appendGateLog({
      project: 'kivora',
      gate: 'guard',
      gate_family: 'deterministic',
      verdict: 'caught',
      caught: 'x'.repeat(5000),
    });
    expect(readGateLog('kivora')[0].caught!.length).toBeLessThanOrEqual(501);
  });
});

describe('project name never escapes the gate-log directory', () => {
  test('traversal characters are flattened into the filename', () => {
    const file = gateLogPath('../../etc/passwd');
    expect(path.dirname(file)).toBe(gateLogDir());
    expect(path.basename(file)).toBe('etc-passwd.jsonl');
  });

  test('case differences resolve to one file across machines', () => {
    expect(gateLogPath('Kivora')).toBe(gateLogPath('kivora'));
  });

  test('a project name with no usable characters throws', () => {
    expect(() => gateLogPath('///')).toThrow(/no usable characters/);
  });
});

describe('rotation at 10MB keeps 5 generations', () => {
  test('an oversized log rotates to .1 and the new line lands in a fresh file', () => {
    const file = gateLogPath('kivora');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${'x'.repeat(10 * 1024 * 1024)}\n`);

    appendGateLog({ project: 'kivora', gate: 'lint', gate_family: 'deterministic', verdict: 'pass' });

    expect(fs.existsSync(`${file}.1`)).toBe(true);
    expect(fs.statSync(file).size).toBeLessThan(1024);
    expect(readGateLog('kivora')).toHaveLength(1);
  });

  test('older generations shift down and the 6th is dropped', () => {
    const file = gateLogPath('kivora');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    for (let i = 1; i <= 5; i++) fs.writeFileSync(`${file}.${i}`, `gen${i}\n`);
    fs.writeFileSync(file, `${'x'.repeat(10 * 1024 * 1024)}\n`);

    appendGateLog({ project: 'kivora', gate: 'lint', gate_family: 'deterministic', verdict: 'pass' });

    expect(fs.readFileSync(`${file}.2`, 'utf8')).toBe('gen1\n');
    expect(fs.readFileSync(`${file}.5`, 'utf8')).toBe('gen4\n');
    expect(fs.existsSync(`${file}.6`)).toBe(false);
    expect(fs.readFileSync(`${file}.1`, 'utf8').startsWith('xxx')).toBe(true);
  });

  test('a log under the threshold is left alone', () => {
    appendGateLog({ project: 'kivora', gate: 'lint', gate_family: 'deterministic', verdict: 'pass' });
    appendGateLog({ project: 'kivora', gate: 'lint', gate_family: 'deterministic', verdict: 'pass' });
    expect(fs.existsSync(`${gateLogPath('kivora')}.1`)).toBe(false);
  });
});

describe('a non-ENOENT read failure is not silently empty', () => {
  test('single-project path: EISDIR throws instead of returning empty', () => {
    const file = gateLogPath('kivora');
    fs.mkdirSync(file, { recursive: true });
    expect(() => readGateLog('kivora')).toThrow();
  });

  test('multi-file loop: an unreadable .jsonl entry throws instead of being silently skipped', () => {
    const f = path.join(gateLogDir(), 'problematic.jsonl');
    fs.mkdirSync(gateLogDir(), { recursive: true });
    fs.mkdirSync(f, { recursive: true });
    expect(() => readGateLog()).toThrow();
  });

  test('multi-file loop: a log that vanishes between listing and reading is absent, not fatal', () => {
    appendGateLog({ project: 'kivora', gate: 'lint', gate_family: 'deterministic', verdict: 'pass' });
    fs.symlinkSync(path.join(gateLogDir(), 'rotated-away.jsonl'), path.join(gateLogDir(), 'vanished.jsonl'));
    expect(() => readGateLog()).not.toThrow();
    expect(readGateLog().length).toBe(1);
  });
});

describe('a corrupt line is skipped, never fatal', () => {
  test('garbage, blank, and half-written lines drop out; good lines survive', () => {
    const file = gateLogPath('kivora');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      [
        '{"ts":"2026-08-12T09:00:00.000Z","project":"kivora","gate":"lint","gate_family":"deterministic","verdict":"pass"}',
        'not json at all',
        '{"ts":"2026-08-12T09:01:00.000Z","project":"kivora","gate":"tsc"',
        '',
        '   ',
        '[1,2,3]',
        '{"no":"gate field"}',
        'null',
        '{"ts":"2026-08-12T09:02:00.000Z","project":"kivora","gate":"guard","gate_family":"deterministic","verdict":"caught"}',
        '',
      ].join('\n'),
    );

    const entries = readGateLog('kivora');
    expect(entries.map((e) => e.gate)).toEqual(['lint', 'guard']);
  });

  test('appending after a torn line still works and the good lines stay readable', () => {
    const file = gateLogPath('kivora');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"ts":"2026-08-12T09:00:00.000Z","project":"kivora","gate":"lint"\n');

    appendGateLog({ project: 'kivora', gate: 'tsc', gate_family: 'deterministic', verdict: 'pass' });
    expect(readGateLog('kivora').map((e) => e.gate)).toEqual(['tsc']);
  });
});

describe('a false positive is marked by appending, never by editing', () => {
  function caught(caughtText: string, ts?: string): void {
    appendGateLog({
      project: 'kivora',
      gate: 'guard',
      gate_family: 'deterministic',
      verdict: 'caught',
      caught: caughtText,
      ts,
    });
  }

  test('the original line is still on disk, untouched, with the correction below it', () => {
    caught('rule=danger cmd=grep danger script.sh');
    reclassify(refOf(readGateLog('kivora')[0]), 'false-positive', 'a grep pattern, not a command');

    const lines = fs.readFileSync(gateLogPath('kivora'), 'utf8').trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({ verdict: 'caught', caught: 'rule=danger cmd=grep danger script.sh' });
    expect(JSON.parse(lines[1])).toMatchObject({
      project: 'kivora',
      gate: 'guard',
      verdict: 'false-positive',
      note: 'a grep pattern, not a command',
    });
  });

  test('readGateLog applies the correction; readGateLogRaw shows what the gate said', () => {
    caught('rule=danger cmd=grep danger script.sh');
    reclassify(refOf(readGateLog('kivora')[0]), 'false-positive', 'a grep pattern, not a command');

    const corrected = readGateLog('kivora');
    expect(corrected).toHaveLength(1);
    expect(corrected[0].verdict).toBe('false-positive');
    expect(corrected[0].reclassified).toMatchObject({ from: 'caught', note: 'a grep pattern, not a command' });

    const raw = readGateLogRaw('kivora');
    expect(raw).toHaveLength(1);
    expect(raw[0].verdict).toBe('caught');
    expect(raw[0].reclassified).toBeUndefined();
  });

  test('a correction record is not an observation and never inflates the counts', () => {
    caught('one');
    caught('two');
    reclassify(refOf(readGateLog('kivora')[0]), 'false-positive', 'oan');

    expect(readGateLog('kivora')).toHaveLength(2);
    expect(readGateLogRaw('kivora')).toHaveLength(2);
    expect(readGateLogCorrections('kivora')).toHaveLength(1);
    expect(readGateLogCorrections('kivora')[0]).toMatchObject({ gate: 'guard', verdict: 'false-positive' });
  });

  test('the five lines already on disk carry no id and are still addressable', () => {
    const file = gateLogPath('dotfiles-claude');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      `{"ts":"2026-08-12T13:09:38.527Z","project":"dotfiles-claude","gate":"guard","gate_family":"deterministic","verdict":"caught","caught":"rule=danger [redacted]"}\n`,
    );

    const legacy = readGateLog('dotfiles-claude')[0];
    expect(legacy.ref).toMatch(/^[0-9a-f]{12}$/);

    reclassify(refOf(legacy), 'false-positive', 'matched inside a grep pattern');
    expect(readGateLog('dotfiles-claude')[0].verdict).toBe('false-positive');
  });

  test('correcting the same line twice keeps the last verdict and the first origin', () => {
    caught('rule=danger cmd=echo danger');
    const target = refOf(readGateLog('kivora')[0]);

    reclassify(target, 'false-positive', 'first call');
    reclassify(target, 'caught', 'second call, undo the first');

    const entry = readGateLog('kivora')[0];
    expect(entry.verdict).toBe('caught');
    expect(entry.reclassified).toMatchObject({ from: 'caught', note: 'second call, undo the first' });
    expect(readGateLogCorrections('kivora')).toHaveLength(2);
  });

  test('the ref survives a correction, so a corrected line can be corrected again', () => {
    caught('rule=danger cmd=echo danger');
    const first = refOf(readGateLog('kivora')[0]);
    reclassify(first, 'false-positive', 'oan');

    const afterward = refOf(readGateLog('kivora')[0]);
    expect(afterward.ref).toBe(first.ref);
    expect(() => reclassify(afterward, 'caught', 'undo')).not.toThrow();
  });

  test('correcting a line that does not exist throws instead of landing nowhere', () => {
    caught('rule=danger cmd=echo danger');
    expect(() => reclassify({ project: 'kivora', ref: 'deadbeefcafe' }, 'false-positive', 'nope')).toThrow(
      /no entry in kivora matches ref deadbeefcafe/,
    );
    expect(() => reclassify({ project: 'never-written', ref: 'deadbeefcafe' }, 'false-positive', 'nope')).toThrow(
      /no entry in never-written matches/,
    );
    expect(readGateLogCorrections('kivora')).toEqual([]);
  });

  test('a correction with no ref, or an unknown verdict, throws', () => {
    caught('rule=danger cmd=echo danger');
    expect(() => reclassify({ project: 'kivora', ref: '' }, 'false-positive', 'x')).toThrow(/needs a ref/);
    expect(() => reclassify(refOf(readGateLog('kivora')[0]), 'oan' as never, 'x')).toThrow(/verdict must be one of/);
  });

  test('an empty note is allowed and simply not written', () => {
    caught('rule=danger cmd=echo danger');
    reclassify(refOf(readGateLog('kivora')[0]), 'false-positive', '   ');
    expect(readGateLogCorrections('kivora')[0]).not.toHaveProperty('note');
    expect(readGateLog('kivora')[0].reclassified).toMatchObject({ from: 'caught' });
  });

  test('a torn correction line is skipped and the surviving corrections still apply', () => {
    const file = gateLogPath('kivora');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      [
        '{"ts":"2026-08-12T09:00:00.000Z","project":"kivora","gate":"guard","gate_family":"deterministic","verdict":"caught","caught":"first"}',
        '{"ts":"2026-08-12T09:01:00.000Z","project":"kivora","gate":"guard","gate_family":"deterministic","verdict":"caught","caught":"second"}',
        '{"ts":"2026-08-12T09:02:00.000Z","project":"kivora","gate":"guard","verdict":"false-positive","reclassifies"',
        '{"ts":"2026-08-12T09:03:00.000Z","project":"kivora","gate":"guard","verdict":"maybe","reclassifies":"whatever"}',
        '{"ts":"2026-08-12T09:04:00.000Z","project":"kivora","gate":"guard","verdict":"false-positive","reclassifies":""}',
        '',
      ].join('\n'),
    );

    const entries = readGateLog('kivora');
    expect(entries.map((e) => e.verdict)).toEqual(['caught', 'caught']);
    expect(readGateLogCorrections('kivora')).toEqual([]);

    reclassify(refOf(entries[1]), 'false-positive', 'still writable over a torn file');
    expect(readGateLog('kivora').map((e) => e.verdict)).toEqual(['caught', 'false-positive']);
  });

  test('two lines that differ only in one field get different refs', () => {
    caught('rule=danger cmd=echo one', '2026-08-12T09:00:00.000Z');
    caught('rule=danger cmd=echo two', '2026-08-12T09:00:00.000Z');
    const [a, b] = readGateLog('kivora');
    expect(a.ref).not.toBe(b.ref);

    reclassify(refOf(a), 'false-positive', 'only this one');
    expect(readGateLog('kivora').map((e) => e.verdict)).toEqual(['false-positive', 'caught']);
  });

  test('the ref ignores read-time fields, so it is the same before and after a read', () => {
    caught('rule=danger cmd=echo danger');
    const entry = readGateLog('kivora')[0];
    expect(entryRef(entry)).toBe(entry.ref);
  });
});

describe('precision per gate is the number P8 reads', () => {
  test('caught over caught plus false-positive, per gate', () => {
    for (let i = 0; i < 3; i++) {
      appendGateLog({ project: 'kivora', gate: 'guard', gate_family: 'deterministic', verdict: 'caught', caught: `g${i}` });
    }
    appendGateLog({ project: 'kivora', gate: 'guard', gate_family: 'deterministic', verdict: 'pass' });
    appendGateLog({ project: 'kivora', gate: 'lint', gate_family: 'deterministic', verdict: 'caught', caught: 'l0' });

    reclassify(refOf(readGateLog('kivora')[0]), 'false-positive', 'oan');

    const rows = precisionByGate(readGateLog('kivora'));
    const guard = rows.find((r) => r.gate === 'guard')!;
    expect(guard).toMatchObject({ caught: 2, false_positive: 1 });
    expect(guard.precision).toBeCloseTo(2 / 3, 10);
    expect(rows.find((r) => r.gate === 'lint')!.precision).toBe(1);
  });

  test('a gate that never raised anything has no precision rather than a perfect one', () => {
    appendGateLog({ project: 'kivora', gate: 'tsc', gate_family: 'deterministic', verdict: 'pass' });
    appendGateLog({ project: 'kivora', gate: 'tsc', gate_family: 'deterministic', verdict: 'skipped' });

    const tsc = precisionByGate(readGateLog('kivora')).find((r) => r.gate === 'tsc')!;
    expect(tsc).toMatchObject({ caught: 0, false_positive: 0, precision: null });
  });

  test('precision reads the corrected view, so marking a line moves the number', () => {
    appendGateLog({ project: 'kivora', gate: 'guard', gate_family: 'deterministic', verdict: 'caught', caught: 'a' });
    appendGateLog({ project: 'kivora', gate: 'guard', gate_family: 'deterministic', verdict: 'caught', caught: 'b' });

    expect(precisionByGate(readGateLog('kivora'))[0].precision).toBe(1);
    reclassify(refOf(readGateLog('kivora')[0]), 'false-positive', 'oan');
    expect(precisionByGate(readGateLog('kivora'))[0].precision).toBe(0.5);
    expect(precisionByGate(readGateLogRaw('kivora'))[0].precision).toBe(1);
  });
});

describe('blind sample lottery draws every reported task while calibrating', () => {
  test('an injected rng sweep yields all 100 of 100', () => {
    const draws = Array.from({ length: 100 }, (_, i) => i / 100);
    const hits = draws.filter((d) => shouldBlindSample(() => d)).length;
    expect(hits).toBe(100);
    expect(BLIND_SAMPLE_RATE).toBe(1);
  });

  test('the comparison stays strict, so a fractional rate keeps its boundary', () => {
    expect(shouldBlindSample(() => 0)).toBe(true);
    expect(shouldBlindSample(() => 0.999999)).toBe(true);
    expect(shouldBlindSample(() => 1)).toBe(false);
  });

  test('a broken rng loses rather than sampling everything', () => {
    expect(shouldBlindSample(() => NaN)).toBe(false);
    expect(shouldBlindSample(() => undefined as never)).toBe(false);
  });

  test('the default rng draws every time, never by returning a bare true', () => {
    const hits = Array.from({ length: 4000 }, () => shouldBlindSample()).filter(Boolean).length;
    expect(hits).toBe(4000);
  });
});

describe('concurrent appends from separate processes never interleave', () => {
  test('8 processes x 40 appends produce 320 complete lines', async () => {
    const writer = path.join(sandbox, 'writer.ts');
    fs.writeFileSync(
      writer,
      `import { appendGateLog } from ${JSON.stringify(path.join(import.meta.dir, 'gate-log.ts'))};
const tag = process.argv[2];
for (let i = 0; i < 40; i++) {
  appendGateLog({
    project: 'kivora',
    gate: 'lint',
    gate_family: 'deterministic',
    verdict: 'pass',
    caught: tag + '-' + i + '-' + 'p'.repeat(200),
  });
}
`,
    );

    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        Bun.spawn(['bun', 'run', writer, `w${i}`], {
          env: { ...process.env, GSTACK_GATE_LOG_DIR: sandbox },
          stdout: 'ignore',
          stderr: 'ignore',
        }).exited,
      ),
    );

    const raw = fs.readFileSync(gateLogPath('kivora'), 'utf8');
    const lines = raw.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(320);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
    expect(readGateLog('kivora')).toHaveLength(320);
  }, 60_000);
});
