/**
 * Contract for a fixture's red test, plus the sandbox helpers probes share.
 *
 * A probe runs the fixture's code and reports whether it observed the defect.
 * `red: true` means the probe saw the bug. The runner calls each probe twice,
 * once against `buggy/` and once against `fixed/`; red on buggy is a catch,
 * red on fixed is a false positive.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface ProbeResult {
  red: boolean;
  detail: string;
}

/**
 * `natural` — the test a dev would write from the ticket text alone, without
 * knowing the root cause. `targeted` — a test that needs the root cause to
 * write. Only `natural` probes measure what B5 actually produces in the field.
 */
export type ProbeKind = 'natural' | 'targeted';

export interface Probe {
  kind: ProbeKind;
  run(variantDir: string): Promise<ProbeResult>;
}

export function sandbox(label: string): string {
  // realpath, không phải mkdtemp trần: trên macOS os.tmpdir() là /var/... còn /var là
  // symlink tới /private/var. Code dưới đo dùng realpathSync ra một nhánh, probe dựng
  // path.join ra nhánh kia, và fixture đúng bị chấm là sai. Cùng lớp lỗi với tsc
  // path-tương-đối trong §P6 — sai ở dụng cụ đo, không sai ở thứ đang đo.
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `oracle-${label}-`)));
}

/** Best effort — a temp dir Windows still has a handle on must not fail a measurement. */
export function cleanup(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
}

export interface ShellResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runBash(script: string, args: string[], env: NodeJS.ProcessEnv = {}): ShellResult {
  const res = spawnSync('bash', [script, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, ...env },
    timeout: 60_000,
  });
  return {
    code: res.status ?? -1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
  };
}

export function git(dir: string, args: string[]): ShellResult {
  const res = spawnSync('git', args, {
    cwd: dir,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'oracle',
      GIT_AUTHOR_EMAIL: 'oracle@example.invalid',
      GIT_COMMITTER_NAME: 'oracle',
      GIT_COMMITTER_EMAIL: 'oracle@example.invalid',
    },
    timeout: 60_000,
  });
  return {
    code: res.status ?? -1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
  };
}

export function initGitRepo(dir: string): void {
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'oracle@example.invalid']);
  git(dir, ['config', 'user.name', 'oracle']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(dir, '.gitkeep'), '');
  git(dir, ['add', '.gitkeep']);
  git(dir, ['commit', '-q', '-m', 'base']);
}

/**
 * Puts a fake executable first on PATH so a probe can stub a tool (npx, eslint)
 * without touching the machine. Returns the env fragment to pass to runBash.
 */
export function stubBin(dir: string, name: string, body: string): NodeJS.ProcessEnv {
  const binDir = path.join(dir, 'stub-bin');
  fs.mkdirSync(binDir, { recursive: true });
  const file = path.join(binDir, name);
  fs.writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  return { PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}` };
}

export async function loadModule(variantDir: string): Promise<any> {
  const candidates = ['index.ts', 'index.js'];
  for (const name of candidates) {
    const file = path.join(variantDir, name);
    if (fs.existsSync(file)) {
      return import(/* @vite-ignore */ `file://${file.replace(/\\/g, '/')}`);
    }
  }
  throw new Error(`no index.ts / index.js in ${variantDir}`);
}
