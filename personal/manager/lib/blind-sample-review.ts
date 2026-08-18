/**
 * Human adjudication ledger for blind samples.
 *
 * A missing row means UNREVIEWED, never clean. Completed reviews are appended
 * so the evidence survives restarts without making the CLI a second writer of
 * the daemon-owned state.json.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { blindSampleReviewsFile, ensureManagerDirs } from './paths';
import { gateLogDir } from './gate-log';
import { listTasks } from './store';
import type { TaskRecord } from '../types';

export interface BlindSampleReview {
  task_id: string;
  project: string;
  issue: string;
  reviewed_at: string;
  false_positive_lines: number[];
  human_fixed: boolean;
  human_touches: number;
  note?: string;
}

export interface GateLogRun {
  ok: boolean;
  stdout: string;
  stderr: string;
}

interface ListedLine {
  n: number;
  project: string;
  issue?: string;
  verdict: string;
  origin: string;
}

interface Listing {
  lines: ListedLine[];
}

const GATE_LOG = fileURLToPath(new URL('../../../bin/gate-log', import.meta.url));

function parseReview(line: string): BlindSampleReview | null {
  try {
    const value = JSON.parse(line) as Partial<BlindSampleReview>;
    if (!value || typeof value !== 'object') return null;
    if (typeof value.task_id !== 'string' || typeof value.project !== 'string' || typeof value.issue !== 'string') return null;
    if (
      typeof value.reviewed_at !== 'string' ||
      !Array.isArray(value.false_positive_lines) ||
      !value.false_positive_lines.every((n) => Number.isInteger(n) && n > 0)
    ) return null;
    if (
      typeof value.human_fixed !== 'boolean' ||
      typeof value.human_touches !== 'number' ||
      !Number.isInteger(value.human_touches) ||
      value.human_touches < 0
    ) return null;
    return value as BlindSampleReview;
  } catch {
    return null;
  }
}

export function readBlindSampleReviews(): BlindSampleReview[] {
  let raw: string;
  try {
    raw = fs.readFileSync(blindSampleReviewsFile(), 'utf8');
  } catch {
    return [];
  }
  return raw.split('\n').map(parseReview).filter((row): row is BlindSampleReview => row !== null);
}

export function reviewedBlindSampleIds(): Set<string> {
  return new Set(readBlindSampleReviews().map((row) => row.task_id));
}

export function unreviewedBlindSamples(project?: string): TaskRecord[] {
  const reviewed = reviewedBlindSampleIds();
  return listTasks().filter(
    (task) =>
      task.state === 'REPORTED' &&
      task.blind_sample === true &&
      !reviewed.has(task.id) &&
      (project === undefined || task.project === project),
  );
}

function runGateLog(args: string[]): GateLogRun {
  const result = spawnSync(process.execPath, [GATE_LOG, ...args], {
    encoding: 'utf8',
    env: process.env,
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? String(result.error?.message ?? ''),
  };
}

export function listTaskGateRows(task: TaskRecord): GateLogRun {
  return runGateLog([
    'recent',
    '--project',
    task.project,
    '--issue',
    task.issue,
    '--origin',
    'work',
    '--limit',
    '100000',
  ]);
}

function lastListing(): Listing | null {
  try {
    const raw = fs.readFileSync(path.join(gateLogDir(), '.last-listing.json'), 'utf8');
    const parsed = JSON.parse(raw) as Listing;
    return parsed && Array.isArray(parsed.lines) ? parsed : null;
  } catch {
    return null;
  }
}

function validateFalsePositiveLines(task: TaskRecord, numbers: number[]): string {
  const listing = lastListing();
  if (!listing) return 'no gate-log listing is active; open this sample again before adjudicating it';
  for (const n of numbers) {
    const row = listing.lines.find((line) => line.n === n);
    if (!row) return `gate-log line ${n} is not in the active listing`;
    if (row.project !== task.project || row.issue !== task.issue) return `gate-log line ${n} belongs to another task; open ${task.id} again`;
    if (row.origin !== 'work') return `gate-log line ${n} is not real-work evidence`;
    if (row.verdict !== 'caught') return `gate-log line ${n} is ${row.verdict}, not caught`;
  }
  return '';
}

export function recordBlindSampleReview(
  task: TaskRecord,
  falsePositiveLines: number[],
  humanFixed: boolean,
  note: string,
): GateLogRun {
  if (task.state !== 'REPORTED' || task.blind_sample !== true) {
    return { ok: false, stdout: '', stderr: `${task.id} is not a REPORTED blind sample` };
  }
  if (reviewedBlindSampleIds().has(task.id)) {
    return { ok: false, stdout: '', stderr: `${task.id} has already been reviewed` };
  }
  const validation = validateFalsePositiveLines(task, falsePositiveLines);
  if (validation) return { ok: false, stdout: '', stderr: validation };

  let output = '';
  for (const n of falsePositiveLines) {
    const result = runGateLog(['fp', String(n), ...(note.trim() ? ['--note', note.trim()] : [])]);
    if (!result.ok) return { ok: false, stdout: output + result.stdout, stderr: result.stderr };
    output += result.stdout;
  }

  const review: BlindSampleReview = {
    task_id: task.id,
    project: task.project,
    issue: task.issue,
    reviewed_at: new Date().toISOString(),
    false_positive_lines: falsePositiveLines,
    human_fixed: humanFixed,
    human_touches: humanFixed ? 1 : 0,
    ...(note.trim() ? { note: note.trim() } : {}),
  };
  ensureManagerDirs();
  fs.appendFileSync(blindSampleReviewsFile(), `${JSON.stringify(review)}\n`, 'utf8');
  return { ok: true, stdout: output, stderr: '' };
}
