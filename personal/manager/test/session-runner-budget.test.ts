import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { skillBudgetArgs } from '../../../test/helpers/session-runner';

describe('CLI runner budget enforcement', () => {
  test('a positive reservation becomes the Claude CLI budget flag', () => {
    expect(skillBudgetArgs(1.25)).toEqual(['--max-budget-usd', '1.25']);
    expect(skillBudgetArgs(undefined)).toEqual([]);
    expect(skillBudgetArgs(0)).toEqual([]);
  });

  test('the manager CLI adapter passes its reservation into the runner', () => {
    const source = fs.readFileSync(path.resolve('personal/manager/lib/spawn.ts'), 'utf-8');
    expect(source).toContain('maxBudgetUsd: req.maxBudgetUsd');
  });
});
