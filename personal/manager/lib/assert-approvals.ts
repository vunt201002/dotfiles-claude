/**
 * The book of `B8-assert` commands a human has said yes to.
 *
 * What it buys and what it does NOT buy, written out because the difference
 * decides how much weight anything else may put on it.
 *
 * It buys VISIBILITY. The manager reads its test command out of
 * `~/.gstack/manager/projects.json` and then runs it. A command that appears
 * there without anyone putting it there used to run silently on the next task;
 * now the task stops and asks once, and the answer is remembered so it never
 * asks twice for the same command.
 *
 * It does NOT buy INTEGRITY, and no comment here should suggest otherwise.
 * This file lives in the same directory as projects.json, outside every task's
 * write scope, and the write guard only analyses `tool_input.file_path` —
 * which covers Edit and Write and covers nothing that goes through a Bash
 * command (§7.3b lesson 1, stated there as a known hole rather than patched
 * with unreliable shell parsing). Whoever can append a command to
 * projects.json through that slot can append its approval here through the
 * same slot, and nothing in this module would notice.
 *
 * What actually cuts that chain is structural and lives in assert-runner.ts:
 * the command never reaches a shell, and only a small allowlist of real test
 * runners may be its first word. This book is the second layer. Reading it as
 * the first is the mistake §7.3b lesson 1 is about.
 */

import * as crypto from 'crypto';
import { assertApprovalsFile, atomicWriteJson, readJson } from './paths';

export interface ApprovalRecord {
  project: string;
  cmd: string;
  approved_at: string;
}

export type ApprovalBook = Record<string, ApprovalRecord>;

/**
 * Whitespace is the only thing normalised away. Anything else — a flag order
 * swap, a different path — is a different command and gets asked about again.
 */
export function normalizeCommand(cmd: string): string {
  return cmd.trim().replace(/\s+/g, ' ');
}

export function commandFingerprint(project: string, cmd: string): string {
  return crypto
    .createHash('sha256')
    .update(`${project}\n${normalizeCommand(cmd)}`)
    .digest('hex');
}

export function loadApprovals(): ApprovalBook {
  const result = readJson<ApprovalBook>(assertApprovalsFile());
  if (!result.ok) {
    if (result.kind === 'missing') return {};
    throw new Error(`cannot read approval book: ${result.reason}`);
  }
  const raw = result.value;
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

export function isCommandApproved(project: string, cmd: string): boolean {
  const record = loadApprovals()[commandFingerprint(project, cmd)];
  return Boolean(record && record.project === project);
}

/** Returns the fingerprints written, so a caller can report what it recorded. */
export function approveCommands(project: string, commands: readonly string[]): string[] {
  const book = loadApprovals();
  const written: string[] = [];
  const approvedAt = new Date().toISOString();
  for (const cmd of commands) {
    const normalized = normalizeCommand(cmd);
    if (!normalized) continue;
    const fingerprint = commandFingerprint(project, normalized);
    book[fingerprint] = { project, cmd: normalized, approved_at: approvedAt };
    written.push(fingerprint);
  }
  if (written.length > 0) atomicWriteJson(assertApprovalsFile(), book);
  return written;
}

export function approvedCommandsFor(project: string): string[] {
  return Object.values(loadApprovals())
    .filter((record) => record.project === project)
    .map((record) => record.cmd);
}
