/**
 * Brainstorm mode (§6.6). A prompt with no project and no issue is answered
 * directly by the manager model against the docs it already has. Nothing is
 * spawned into a repo, nothing is edited.
 *
 * It still goes through the shared spawn port, so a brainstorm answer counts
 * against the same global agent cap and the same cost accounting as real work,
 * and it carries the caller's `source` so a phone-originated prompt runs under
 * the tighter tool policy. Free text from a phone is the widest attack surface
 * the manager exposes; it is the last place that should lose its provenance.
 */

import * as path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from '../config';
import { brainstormPrompt } from './prompts';
import { defaultSpawnPort, type SpawnPort } from './spawn';
import type { TaskSource } from '../types';

/** Repo root: this file is <root>/personal/manager/lib/brainstorm.ts. */
export function docsRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

export interface BrainstormResult {
  reply: string;
  cost_usd: number;
}

export async function brainstorm(
  text: string,
  source: TaskSource = 'cli',
  port: SpawnPort = defaultSpawnPort(),
): Promise<BrainstormResult> {
  const cfg = loadConfig();
  const result = await port.run({
    role: 'main',
    taskId: 'brainstorm',
    project: 'manager',
    issue: 'brainstorm',
    scope: docsRoot(),
    source,
    prompt: brainstormPrompt(text, source),
    modelAlias: cfg.models.manager.model,
    maxTurns: cfg.maxTurns.main,
    systemAppend:
      'You are the manager layer answering a question, not running a task. Read only. Do not edit, create, or delete any file.',
  });
  return { reply: result.output, cost_usd: result.costUsd };
}
