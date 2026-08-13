/**
 * Thin wrapper over ./gate-log. Delegation only — there is deliberately NO
 * second code path that writes a gate-log line.
 *
 * It exists for one reason: appendGateLog throws on an invalid entry (that is
 * correct for the writer, a bad line would corrupt every number read back off
 * the log), but the gate log is a measurement tool and a logging failure must
 * never take a running task down with it. So writes go through logGate, which
 * reports the rejection on stderr and carries on.
 *
 * An earlier revision of this file carried a standalone fallback writer for
 * the window before gate-log.ts existed. It was deleted rather than kept as
 * dead code: two writers for one file diverge quietly, and the copy already
 * had a slug-casing bug that would have split one project across two files.
 */

import { appendGateLog, readGateLog } from './gate-log';
import type { GateLogEntry } from './gate-log';

export type { GateLogEntry } from './gate-log';
export { shouldBlindSample } from './gate-log';

export type GateLogInput = Omit<GateLogEntry, 'ts'> & { ts?: string };

/** Never throws. A rejected line is reported and dropped, not retried. */
export function logGate(entry: GateLogInput): void {
  try {
    appendGateLog(entry);
  } catch (err) {
    process.stderr.write(`manager: gate-log rejected an entry (${(err as Error).message})\n`);
  }
}

export function readEntries(project?: string): GateLogEntry[] {
  try {
    const entries = readGateLog(project);
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}
