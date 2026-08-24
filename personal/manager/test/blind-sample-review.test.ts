import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { appendGateLog, gateLogPath, readGateLog } from '../lib/gate-log';
import { readDiff } from '../lib/git';
import {
  listTaskGateRows,
  readBlindSampleReviews,
  recordBlindSampleReview,
  unreviewedBlindSamples,
  type BlindSampleReviewsResult,
} from '../lib/blind-sample-review';
import { blindSampleReviewsFile } from '../lib/paths';
import { newTaskRecord, saveTask } from '../lib/store';
import type { TaskRecord } from '../types';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'blind-review-'));
const CLI = fileURLToPath(new URL('../cli.ts', import.meta.url));
const GATE_LOG = fileURLToPath(new URL('../../../bin/gate-log', import.meta.url));
const ORIGINAL_MANAGER_HOME = process.env.MANAGER_HOME;
const ORIGINAL_GATE_LOG_DIR = process.env.GSTACK_GATE_LOG_DIR;
process.env.MANAGER_HOME = HOME;
process.env.GSTACK_GATE_LOG_DIR = path.join(HOME, 'gate-log');

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  const record = newTaskRecord({ project: 'joy', issue: 'H-1', source: 'cli', scope: path.join(HOME, 'repo'), ceilingUsd: 5 });
  return {
    ...record,
    id: 'joy-h-1-01',
    state: 'REPORTED',
    blind_sample: true,
    review_depth: 'full-diff',
    ...overrides,
  };
}

function gate(issue = 'H-1', verdict: 'pass' | 'caught' = 'caught', name = 'spec-check'): void {
  appendGateLog({
    project: 'joy',
    issue,
    gate: name,
    gate_family: name === 'tsc' ? 'deterministic' : 'llm',
    verdict,
    caught: verdict === 'caught' ? `${name} found a problem` : '',
    review_depth: 'full-diff',
  });
}

function cli(args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: process.env });
}

function git(args: string[], cwd: string): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'git failed');
}

beforeEach(() => {
  fs.rmSync(path.join(HOME, 'manager'), { recursive: true, force: true });
  fs.rmSync(path.join(HOME, 'gate-log'), { recursive: true, force: true });
});

afterAll(() => {
  fs.rmSync(HOME, { recursive: true, force: true });
  if (ORIGINAL_MANAGER_HOME === undefined) delete process.env.MANAGER_HOME;
  else process.env.MANAGER_HOME = ORIGINAL_MANAGER_HOME;
  if (ORIGINAL_GATE_LOG_DIR === undefined) delete process.env.GSTACK_GATE_LOG_DIR;
  else process.env.GSTACK_GATE_LOG_DIR = ORIGINAL_GATE_LOG_DIR;
});

describe('blind sample queue', () => {
  test('an empty store has no unreviewed samples', () => {
    expect(unreviewedBlindSamples().tasks).toEqual([]);
  });

  test('lists only REPORTED blind samples', () => {
    saveTask(task());
    saveTask(task({ id: 'not-blind', blind_sample: false }));
    saveTask(task({ id: 'not-reported', state: 'REVIEW' }));
    expect(unreviewedBlindSamples().tasks.map((row) => row.id)).toEqual(['joy-h-1-01']);
  });

  test('project scope does not mix queues', () => {
    saveTask(task());
    saveTask(task({ id: 'other-01', project: 'other' }));
    expect(unreviewedBlindSamples('other').tasks.map((row) => row.id)).toEqual(['other-01']);
  });

  test('a persisted review removes the task from later reads', () => {
    const sample = task();
    saveTask(sample);
    listTaskGateRows(sample);
    expect(recordBlindSampleReview(sample, [], false, 'read carefully').ok).toBe(true);
    expect(unreviewedBlindSamples().tasks).toEqual([]);
    expect(readBlindSampleReviews().reviews[0].task_id).toBe(sample.id);
  });

  test('malformed ledger rows do not turn a task into reviewed', () => {
    const sample = task();
    saveTask(sample);
    fs.mkdirSync(path.dirname(blindSampleReviewsFile()), { recursive: true });
    fs.writeFileSync(blindSampleReviewsFile(), '{bad json}\n');
    expect(unreviewedBlindSamples().tasks.map((row) => row.id)).toEqual([sample.id]);
  });

  test('ENOENT ledger reads as ok with no reviews', () => {
    expect(readBlindSampleReviews()).toEqual({ ok: true, reviews: [] });
  });

  test('EACCES on ledger returns ok:false and blocks duplicate adjudication', () => {
    const sample = task();
    saveTask(sample);
    fs.mkdirSync(path.dirname(blindSampleReviewsFile()), { recursive: true });
    const review = {
      task_id: sample.id, project: 'joy', issue: 'H-1',
      reviewed_at: '2026-01-01T00:00:00.000Z',
      false_positive_lines: [], human_fixed: false, human_touches: 0,
    };
    fs.writeFileSync(blindSampleReviewsFile(), `${JSON.stringify(review)}\n`);
    const file = blindSampleReviewsFile();
    const read = spyOn(fs, 'readFileSync').mockImplementation((candidate) => {
      if (String(candidate) === file) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      throw new Error(`unexpected read: ${String(candidate)}`);
    });
    let result: BlindSampleReviewsResult;
    try {
      result = readBlindSampleReviews();
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('EACCES');
      const adjudication = recordBlindSampleReview(sample, [], false, 'duplicate attempt');
      expect(adjudication.ok).toBe(false);
      expect(adjudication.stderr).toContain('unreadable');
    } finally {
      read.mockRestore();
    }
  });
});

describe('task-scoped gate listing', () => {
  test('shows only rows for the selected issue', () => {
    gate('H-1', 'caught', 'spec-check');
    gate('H-2', 'caught', 'tech-review');
    const result = listTaskGateRows(task());
    expect(result.ok).toBe(true);
    expect(result.stdout).toContain('spec-check');
    expect(result.stdout).not.toContain('tech-review');
  });

  test('prints line numbers that gate-log fp can consume', () => {
    gate();
    const result = listTaskGateRows(task());
    expect(result.stdout).toMatch(/\s+1\..*spec-check/);
  });

  test('an empty task listing stays explicit', () => {
    const result = listTaskGateRows(task());
    expect(result.ok).toBe(true);
    expect(result.stdout).toContain('(no entries)');
  });
});

describe('human adjudication', () => {
  test('a selected false positive appends a correction through gate-log fp', () => {
    const sample = task();
    saveTask(sample);
    gate();
    listTaskGateRows(sample);
    expect(recordBlindSampleReview(sample, [1], false, 'not a real defect').ok).toBe(true);
    expect(readGateLog('joy')[0].verdict).toBe('false-positive');
    expect(fs.readFileSync(gateLogPath('joy'), 'utf8').trim().split('\n')).toHaveLength(2);
  });

  test('no false positives writes no gate-log correction', () => {
    const sample = task();
    saveTask(sample);
    gate();
    listTaskGateRows(sample);
    expect(recordBlindSampleReview(sample, [], false, 'all catches valid').ok).toBe(true);
    expect(fs.readFileSync(gateLogPath('joy'), 'utf8').trim().split('\n')).toHaveLength(1);
  });

  test('manual fixing is recorded as one human touch', () => {
    const sample = task();
    saveTask(sample);
    listTaskGateRows(sample);
    expect(recordBlindSampleReview(sample, [], true, 'fixed wording').ok).toBe(true);
    expect(readBlindSampleReviews().reviews[0]).toMatchObject({ human_fixed: true, human_touches: 1 });
  });

  test('a non-sample cannot be adjudicated', () => {
    const result = recordBlindSampleReview(task({ blind_sample: false }), [], false, 'no');
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('not a REPORTED blind sample');
  });

  test('the same sample cannot be adjudicated twice', () => {
    const sample = task();
    saveTask(sample);
    listTaskGateRows(sample);
    expect(recordBlindSampleReview(sample, [], false, 'first').ok).toBe(true);
    expect(recordBlindSampleReview(sample, [], false, 'second').stderr).toContain('already been reviewed');
  });

  test('a line from another task is rejected before any correction', () => {
    const sample = task();
    saveTask(sample);
    gate('H-2');
    listTaskGateRows(task({ issue: 'H-2' }));
    const result = recordBlindSampleReview(sample, [1], false, 'wrong task');
    expect(result.ok).toBe(false);
    expect(readGateLog('joy')[0].verdict).toBe('caught');
  });

  test('a pass row cannot be marked false-positive', () => {
    const sample = task();
    saveTask(sample);
    gate('H-1', 'pass');
    listTaskGateRows(sample);
    const result = recordBlindSampleReview(sample, [1], false, 'wrong verdict');
    expect(result.stderr).toContain('is pass, not caught');
  });
});

describe('manager review-sample CLI', () => {
  test('detail renders diff, gate rows, findings, advisories, and gate verdicts', () => {
    const repo = path.join(HOME, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    git(['init', '-q'], repo);
    git(['config', 'user.email', 'test@example.com'], repo);
    git(['config', 'user.name', 'Test'], repo);
    fs.writeFileSync(path.join(repo, 'work.txt'), 'before\n');
    git(['add', 'work.txt'], repo);
    git(['commit', '-qm', 'base'], repo);
    fs.writeFileSync(path.join(repo, 'work.txt'), 'after\n');
    const recordedDiff = readDiff(repo);
    if (!recordedDiff.ok) throw new Error(recordedDiff.error);
    const sample = task({
      scope: repo,
      report_lines: [`diff: ${recordedDiff.text.length} bytes`],
      findings: [{ gate: 'spec-check', gate_family: 'llm', text: 'finding text' }],
      advisories: ['advisory text'],
      gate_reports: [{ gate: 'spec-check', gate_family: 'llm', verdict: 'caught', caught: 'finding text', attempt: 1 }],
    });
    saveTask(sample);
    gate();
    const result = cli(['review-sample', sample.id]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('-before');
    expect(result.stdout).toContain('+after');
    expect(result.stdout).toContain(`SOURCE: live read from ${repo}`);
    expect(result.stdout).toContain('finding text');
    expect(result.stdout).toContain('advisory text');
    expect(result.stdout).toContain('verdict=caught');
    expect(result.stdout).toContain('UNREVIEWED does not mean clean');
  });

  test('closing requires explicit answers for both judgment fields', () => {
    const sample = task();
    saveTask(sample);
    const result = cli(['review-sample', sample.id, '--fp', 'none']);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('requires both --fp');
    expect(unreviewedBlindSamples().tasks).toHaveLength(1);
  });

  test('CLI adjudication sends selected rows through gate-log fp and closes the sample', () => {
    const sample = task();
    saveTask(sample);
    gate();
    listTaskGateRows(sample);
    const result = cli([
      'review-sample',
      sample.id,
      '--fp',
      '1',
      '--human-fixed',
      'no',
      '--note',
      'not a real defect',
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('false-positive');
    expect(result.stdout).toContain(`reviewed ${sample.id}`);
    expect(readGateLog('joy')[0].verdict).toBe('false-positive');
    expect(unreviewedBlindSamples().tasks).toEqual([]);
  });

  test('stats withholds precision while a blind sample is unreviewed', () => {
    const sample = task({
      gate_reports: [{ gate: 'spec-check', gate_family: 'llm', verdict: 'caught', caught: 'finding', attempt: 1 }],
    });
    saveTask(sample);
    gate();
    const result = spawnSync(process.execPath, [GATE_LOG, 'stats', '--project', 'joy'], { encoding: 'utf8', env: process.env });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('pending review');
    expect(result.stdout).toMatch(/spec-check[^\n]+pending review/);
    expect(result.stdout).toMatch(/TOTAL[^\n]+pending review/);
    expect(result.stdout).toContain('blind samples awaiting human review = 1');
    expect(result.stdout).toContain('current overall denominator = 1 rows');
  });

  test('--json withholds precision on the same terms as the table', () => {
    const sample = task({
      gate_reports: [{ gate: 'spec-check', gate_family: 'llm', verdict: 'caught', caught: 'finding', attempt: 1 }],
    });
    saveTask(sample);
    gate();
    const result = spawnSync(process.execPath, [GATE_LOG, 'stats', '--project', 'joy', '--json'], {
      encoding: 'utf8',
      env: process.env,
    });
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.blind_samples_unreviewed).toBe(1);
    for (const gateRow of Object.values(parsed.by_gate) as Array<{ precision: unknown; precision_status: string }>) {
      expect(gateRow.precision).toBeNull();
      expect(gateRow.precision_status).toBe('pending-human-review');
    }
  });

  test('one unreviewed blind sample withholds only the gate that sample ran', () => {
    const sample = task({
      gate_reports: [{ gate: 'spec-check', gate_family: 'llm', verdict: 'caught', caught: 'finding', attempt: 1 }],
    });
    saveTask(sample);
    gate('H-1', 'caught', 'spec-check');
    gate('H-2', 'caught', 'tech-review');
    const result = spawnSync(process.execPath, [GATE_LOG, 'stats', '--project', 'joy', '--json'], {
      encoding: 'utf8',
      env: process.env,
    });
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.by_gate['spec-check'].precision).toBeNull();
    expect(parsed.by_gate['spec-check'].precision_status).toBe('pending-human-review');
    expect(parsed.by_gate['tech-review'].precision).toBe(1);
    expect(parsed.by_gate['tech-review'].precision_status).toBe('measured');
  });
});
