import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Static invariants for the manager. These are grep tests on our own source,
// in the shape of browse/test/cdp-session-cleanup.test.ts: the runtime tests
// prove the happy path works, these prove nobody can quietly route around it.
//
// Three things must stay true:
//   1. Every agent spawn goes through lib/spawn.ts, so the global semaphore in
//      agent-sdk-runner.ts caps concurrency and cost is always accounted.
//   2. The real Chrome is only ever reached while holding the browser token.
//      There is one Chrome on this machine; a second claimant corrupts both.
//   3. The HTTP surface binds loopback. Anyone reaching this port can start a
//      bypass-permissions agent on every registered repository.

const MANAGER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPAWN_MODULE = path.join('lib', 'spawn.ts');

interface SourceFile {
  rel: string;
  content: string;
}

function collectSources(): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'test' || entry.name === 'node_modules' || entry.name === 'telegram') continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
      out.push({ rel: path.relative(MANAGER_DIR, full), content: fs.readFileSync(full, 'utf-8') });
    }
  };
  walk(MANAGER_DIR);
  return out;
}

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

function isControlByte(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (code < 9 && code >= 0) || code === 11 || code === 12 || (code >= 14 && code <= 31);
}

/** Source with every comment line dropped, so a docblock naming a banned
 * symbol does not read as the code using it. */
function codeOnly(src: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const line of src.split('\n')) {
    const trimmed = line.trim();
    if (inBlock) {
      if (trimmed.includes('*/')) inBlock = false;
      continue;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlock = true;
      continue;
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    out.push(line);
  }
  return out.join('\n');
}

function offenders(pattern: RegExp, allowed: string[]): string[] {
  const hits: string[] = [];
  for (const file of collectSources()) {
    if (allowed.includes(file.rel)) continue;
    const lines = file.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (isCommentLine(lines[i])) continue;
      if (pattern.test(lines[i])) hits.push(`${file.rel}:${i + 1}  ${lines[i].trim()}`);
    }
  }
  return hits;
}

describe('every agent spawn goes through the shared semaphore', () => {
  test('1. runAgentSdkTest is only called from lib/spawn.ts', () => {
    const hits = offenders(/\brunAgentSdkTest\s*\(/, [SPAWN_MODULE]);
    expect(hits, `agent spawns must route through lib/spawn.ts:\n${hits.join('\n')}`).toEqual([]);
  });

  test('2. runSkillTest is only called from lib/spawn.ts', () => {
    const hits = offenders(/\brunSkillTest\s*\(/, [SPAWN_MODULE]);
    expect(hits, `agent spawns must route through lib/spawn.ts:\n${hits.join('\n')}`).toEqual([]);
  });

  test('3. runCodexSkill is only called from lib/spawn.ts', () => {
    const hits = offenders(/\brunCodexSkill\s*\(/, [SPAWN_MODULE]);
    expect(hits, `agent spawns must route through lib/spawn.ts:\n${hits.join('\n')}`).toEqual([]);
  });

  // Two files may shell out, and only two. git.ts reads a diff so the phone
  // has something to show. assert-runner.ts runs the project's OWN test
  // command, which is the entire reason B8-assert counts as deterministic
  // evidence instead of an agent's account of it (§7.3b lesson 2) — the
  // manager reads an exit code rather than asking whether the tests were run.
  //
  // The ban was never on subprocesses as such. It is on a SECOND route to an
  // agent, which would sit outside the semaphore, outside the cost ledger and
  // outside the scope directive. So each exception carries its own narrower
  // invariant, checked here on the file itself: git.ts may name only git, and
  // assert-runner.ts must refuse an agent binary before it runs anything.

  test('4. only the four named files shell out', () => {
    const hits = offenders(/\b(Bun\.spawn|Bun\.spawnSync|child_process|execSync|spawnSync)\s*[(.]/, [
      path.join('lib', 'git.ts'),
      path.join('lib', 'assert-runner.ts'),
      path.join('lib', 'worktrees.ts'),
      path.join('lib', 'cmux-control.ts'),
    ]);
    expect(hits, `the manager never drives a terminal; it spawns through the SDK runner:\n${hits.join('\n')}`).toEqual([]);

    const gitSrc = fs.readFileSync(path.join(MANAGER_DIR, 'lib', 'git.ts'), 'utf-8');
    const argv = [...gitSrc.matchAll(/Bun\.spawnSync\(\s*\[\s*'([^']+)'/g)].map((m) => m[1]);
    expect(argv, 'lib/git.ts may run git and nothing else').toEqual(['git']);
  });

  // worktrees.ts is git.ts's rule applied to a second file: it exists to run
  // `git worktree`, and a binary other than git appearing in it is a new
  // subprocess route wearing a plumbing file's name.
  test('4c. lib/worktrees.ts may run git and nothing else', () => {
    const src = codeOnly(fs.readFileSync(path.join(MANAGER_DIR, 'lib', 'worktrees.ts'), 'utf-8'));
    const argv = [...src.matchAll(/spawnSync\(\s*'([^']+)'/g)].map((m) => m[1]);
    expect(argv.length, 'worktrees.ts must still spawn something').toBeGreaterThan(0);
    expect([...new Set(argv)], 'lib/worktrees.ts may run git and nothing else').toEqual(['git']);
  });

  // cmux-control.ts is the one file that opens a SECOND route to an agent, so
  // it carries the most conditions. The pane it opens runs a real `claude`
  // outside the SDK semaphore, outside the SDK's cost report, and outside the
  // hermetic child env — which is fine only because each of those is replaced
  // by something checked here rather than assumed.
  //
  // The exception it does NOT get: spawning the agent itself. Everything it
  // executes is the cmux binary; `claude` reaches a shell only as text inside
  // `cmux workspace create --command`, where the pane's own env carries the
  // scope and the guard hook fences the writes.
  test('4e. the cmux route runs only cmux, and never types a prompt into a TUI', () => {
    const control = codeOnly(fs.readFileSync(path.join(MANAGER_DIR, 'lib', 'cmux-control.ts'), 'utf-8'));
    const argv = [...control.matchAll(/spawnSync\(\s*([A-Za-z_$][\w$]*|'[^']+')/g)].map((m) => m[1]);
    expect(argv.length, 'cmux-control.ts must still spawn something').toBeGreaterThan(0);
    for (const target of new Set(argv)) {
      expect(target, `cmux-control.ts may only execute the cmux binary, got ${target}`).toBe('CMUX_BIN');
    }
    expect(control, 'CMUX_BIN stopped resolving to cmux').toMatch(/CMUX_BIN\s*=[^\n]*'cmux'/);

    // `cmux send` types characters into a live TUI. Sending mid-turn injects
    // text into whatever the agent is doing, and a newline submits early and
    // leaves the tail as a second instruction. Both are gated in sendText, and
    // both gates are one deleted line away from silently not existing.
    const send = control.slice(control.indexOf('export function sendText'));
    const body = send.slice(0, send.indexOf('\n}\n'));
    expect(body, 'sendText no longer refuses a mid-turn send').toContain("lifecycle !== 'idle'");
    expect(body, 'sendText no longer refuses a newline').toMatch(/\[\\r\\n\]/);
  });

  // The three numbers §6.2 said a terminal could not produce. Each is replaced
  // by a channel the measured agent does not write for us (§7.3b lesson 2), and
  // a cmux run that lost any one of them would report a plausible number
  // nobody could check.
  test('4f. a cmux spawn is still capped, scoped, and costed', () => {
    const src = codeOnly(fs.readFileSync(path.join(MANAGER_DIR, 'lib', 'cmux-spawn.ts'), 'utf-8'));
    expect(src, 'the cmux spawn no longer waits for a free slot, so the agent cap is gone').toContain('waitForSlot');
    expect(src, 'the fleet cap is no longer read from cmux-sessions').toContain('busyCount');
    expect(src, 'the scope directive is no longer prepended to the prompt').toContain('scopeDirective');
    expect(src, 'GSTACK_MANAGER_SCOPE is no longer set in the pane env').toContain('GSTACK_MANAGER_SCOPE');
    expect(src, 'cost is no longer measured from the transcript').toContain('usageFromTranscript');
    expect(src, 'the pane runs permission-free without checking that the guard exists').toContain('guardIsWired');
    expect(
      src.includes('spawnSync') || src.includes('child_process'),
      'cmux-spawn.ts must not shell out directly; it goes through cmux-control.ts',
    ).toBe(false);
  });

  // §6.8's kill switch is reachable from a phone, and closing the workspace is
  // what actually ends the process. A stop that only stopped WATCHING would
  // leave the agent editing files and spending money with nothing observing
  // it — the failure mode where the safety control reports success and the
  // dangerous thing keeps running.
  test('4g. stopping a cmux task closes the pane, so stop means stop', () => {
    const src = codeOnly(fs.readFileSync(path.join(MANAGER_DIR, 'lib', 'cmux-spawn.ts'), 'utf-8'));
    expect(src, 'the abort path no longer closes the workspace').toMatch(
      /aborted[\s\S]{0,400}closeWorkspace\(/,
    );
    expect(src, 'the run no longer carries an abort signal into the watcher').toContain('signal: req.signal');
  });

  // 14/08 review finding. `failure()` claimed in its own docblock that every
  // caller was a refusal before a pane opened, so its zero was a measured zero.
  // Five of six were. The sixth followed the only process launch in the file:
  // createWorkspace returns no ref both when cmux refused AND when cmux
  // SUCCEEDED but its ref line did not parse — and in the second case the pane
  // is open with `claude --dangerously-skip-permissions` already running. A
  // measured zero there is the fabricated-zero bug in the one place an agent is
  // genuinely spending, and with no ref there is nothing left to close it with.
  test('4h. a cmux failure after the launch does not claim a measured zero', () => {
    const src = codeOnly(fs.readFileSync(path.join(MANAGER_DIR, 'lib', 'cmux-spawn.ts'), 'utf-8'));

    const launch = src.slice(src.indexOf('function launchFailure'));
    expect(launch.slice(0, launch.indexOf('\n}\n')), 'the post-launch failure went back to claiming a measured cost').toContain(
      'costKnown: false',
    );

    const createFailed = src.slice(src.indexOf('cmux_create_failed') - 200, src.indexOf('cmux_create_failed') + 200);
    expect(createFailed, 'cmux_create_failed is back on the pre-launch helper').toContain('launchFailure');

    const refusal = src.slice(src.indexOf('function refusal'));
    expect(refusal.slice(0, refusal.indexOf('\n}\n')), 'the pre-launch refusal stopped reporting its zero as measured').toContain(
      'costKnown: true',
    );
  });

  test('4b. the assert runner refuses an agent binary, on every path that runs a command', () => {
    const src = fs.readFileSync(path.join(MANAGER_DIR, 'lib', 'assert-runner.ts'), 'utf-8');

    expect(src, 'the agent-binary denylist is gone').toContain('AGENT_BINARY_DENYLIST');
    for (const binary of ['claude', 'codex', 'gemini']) {
      expect(src, `"${binary}" dropped out of the denylist`).toContain(`'${binary}'`);
    }

    const gate = src.slice(src.indexOf('export function commandRejection'));
    expect(gate.slice(0, 600), 'commandRejection no longer consults the denylist').toContain(
      'AGENT_BINARY_DENYLIST',
    );

    // A command reaches the shell only through resolveAssertPlan, and both of
    // its branches — the registry and discovery — must pass through the
    // rejection check. A branch that skips it is a hole with a denylist
    // sitting next to it, which reads safer than having none at all.
    const resolver = src.slice(src.indexOf('export function resolveAssertPlan'));
    const body = resolver.slice(0, resolver.indexOf('\n}\n') + 1);
    expect(
      (body.match(/commandRejection\(/g) ?? []).length,
      'resolveAssertPlan must screen registry commands as well as discovered ones',
    ).toBeGreaterThanOrEqual(1);
    for (const discovery of ['discoverFromClaudeMd', 'discoverFromPackageJson']) {
      const fn = src.slice(src.indexOf(`export function ${discovery}`));
      expect(fn.slice(0, fn.indexOf('\n}\n')), `${discovery} accepts a command it never screened`).toContain(
        'commandRejection(',
      );
    }
  });

  // The command assert-runner.ts executes comes out of projects.json, which
  // sits outside every task's write scope and is reachable through the Bash
  // slot the write guard does not analyse (§7.3b lesson 1). Two structural
  // rules make a planted line harmless, and both are cheap to delete by
  // accident while "just making npm work again":
  //
  //   1. It never reaches a shell. Parsed into argv here, spawned directly.
  //   2. Its first word is on a short allowlist of real test runners.
  //
  // Rule 1 without rule 2 lets `curl` run; rule 2 without rule 1 lets
  // `npm test | curl … | sh` run. Neither is optional, so both are pinned.

  test('4d. the assert runner never spawns through a shell', () => {
    const src = codeOnly(fs.readFileSync(path.join(MANAGER_DIR, 'lib', 'assert-runner.ts'), 'utf-8'));
    const banned: Array<[RegExp, string]> = [
      [/cmd\.exe/i, 'cmd.exe is back as an interpreter'],
      [/\/bin\/(sh|bash)/, 'a POSIX shell is back as an interpreter'],
      [/\bshell\s*:\s*true/, 'Bun.spawn was given shell: true'],
      [/\bshellArgv\b/, 'the shell argv builder is back'],
      [/\bBun\.\$/, "Bun's own shell is back"],
      [/import\s*\{[^}]*\$[^}]*\}\s*from\s*'bun'/, "Bun's shell tag was imported"],
    ];
    for (const [pattern, why] of banned) {
      expect(pattern.test(src), `${why}: ${pattern}`).toBe(false);
    }

    const spawnArgs = [...src.matchAll(/Bun\.spawn\(([^)]*)/g)].map((m) => m[1]);
    expect(spawnArgs.length, 'the assert runner must still spawn something').toBeGreaterThan(0);
    for (const args of spawnArgs) {
      expect(args.trimStart().startsWith('['), `Bun.spawn must take a parsed argv array, got: ${args}`).toBe(true);
    }
  });

  test('4e. the assert runner allowlists the first word and refuses shell metacharacters', () => {
    const src = fs.readFileSync(path.join(MANAGER_DIR, 'lib', 'assert-runner.ts'), 'utf-8');
    expect(src, 'the runner allowlist is gone').toContain('RUNNER_ALLOWLIST');
    expect(src, 'the metacharacter refusal is gone').toContain('SHELL_METACHARS');
    for (const runner of ['bun', 'npm', 'npx', 'node', 'pytest']) {
      expect(src, `"${runner}" dropped out of the runner allowlist`).toContain(`'${runner}'`);
    }

    const gate = codeOnly(src.slice(src.indexOf('export function commandRejection')));
    const body = gate.slice(0, gate.indexOf('\n}\n'));
    expect(body, 'commandRejection stopped consulting the runner allowlist').toContain('RUNNER_ALLOWLIST');
    expect(body, 'commandRejection stopped refusing shell metacharacters').toContain('SHELL_METACHARS');

    // The exported spawn screens too. Everything reaching it in production was
    // screened by resolveAssertPlan already; without this the export is a way
    // around that one.
    const exec = codeOnly(src.slice(src.indexOf('export const directExec')));
    expect(exec.slice(0, exec.indexOf('\n};\n')), 'the spawn path no longer screens the command itself').toContain(
      'commandRejection(',
    );
  });

  test('4c. the assert runner never reaches the SDK spawn path', () => {
    const src = fs.readFileSync(path.join(MANAGER_DIR, 'lib', 'assert-runner.ts'), 'utf-8');
    expect(src, 'the assert runner must not import the agent spawn layer').not.toMatch(
      /from '\.\/spawn'|agent-sdk-runner|session-runner|codex-session-runner/,
    );
  });

  test('5. lib/spawn.ts really does own the runners it is allowed to own', () => {
    const spawnSrc = fs.readFileSync(path.join(MANAGER_DIR, SPAWN_MODULE), 'utf-8');
    expect(spawnSrc).toContain('../../../test/helpers/agent-sdk-runner');
    expect(spawnSrc).toContain('../../../test/helpers/session-runner');
    expect(spawnSrc).toContain('__resetSemaphoreForTests');
  });
});

describe('the real Chrome is only reached while holding the browser token', () => {
  test('6. the my-chrome branch lives in a file that acquires the token', () => {
    const bad: string[] = [];
    for (const file of collectSources()) {
      const lines = file.content.split('\n');
      const touchesChrome = lines.some(
        (line) => !isCommentLine(line) && /(includes|===|==)\s*\(?\s*['"]my-chrome['"]/.test(line),
      );
      if (!touchesChrome) continue;
      const guards = file.content.includes('BROWSER_TOKEN') && /\bacquire\s*\(/.test(file.content);
      if (!guards) bad.push(file.rel);
    }
    expect(bad, `these files branch on my-chrome without acquiring BROWSER_TOKEN: ${bad.join(', ')}`).toEqual([]);
  });

  test('7. no direct MCP or CDP browser call anywhere in the manager', () => {
    const hits = offenders(/mcp__claude-in-chrome__|newCDPSession\s*\(|chrome\.debugger/, []);
    expect(hits, `browser access belongs to the spawned agent under a token, not to the manager:\n${hits.join('\n')}`).toEqual([]);
  });

  test('8. BROWSER_TOKEN is defined once', () => {
    const definitions = collectSources().filter((f) => /export const BROWSER_TOKEN/.test(f.content));
    expect(definitions.map((d) => d.rel)).toEqual([path.join('lib', 'locks.ts')]);
  });
});

describe('the HTTP surface stays on loopback', () => {
  test('9. nothing binds 0.0.0.0 or an empty hostname', () => {
    const hits = offenders(/0\.0\.0\.0|hostname:\s*['"]\s*['"]|hostname:\s*undefined/, []);
    expect(hits, `the manager API must never leave loopback:\n${hits.join('\n')}`).toEqual([]);
  });

  test('10. the config host is a literal 127.0.0.1 that overrides file config', () => {
    const configSrc = fs.readFileSync(path.join(MANAGER_DIR, 'config.ts'), 'utf-8');
    expect(configSrc).toContain("readonly host: '127.0.0.1'");
    expect(configSrc).toContain("host: '127.0.0.1',");
  });

  test('11. every request is token-checked before any route matches', () => {
    const serverSrc = fs.readFileSync(path.join(MANAGER_DIR, 'server.ts'), 'utf-8');
    const authIndex = serverSrc.indexOf("req.headers.get('X-Manager-Token')");
    const firstRoute = serverSrc.indexOf("pathname === '/events'");
    expect(authIndex).toBeGreaterThan(-1);
    expect(firstRoute).toBeGreaterThan(authIndex);
  });
});

describe('the write scope is actually enforced, not just announced', () => {
  // scopeDirective() tells the agent where it may write. That sentence is not
  // enforcement — an agent can ignore it. The enforcement is the PreToolUse
  // hook reading GSTACK_MANAGER_SCOPE and exiting 2. It only works while BOTH
  // ends stay wired: the hook still reads the variable, and spawn.ts still
  // puts it in the child env. Drop either and the scope silently becomes a
  // suggestion again, with nothing failing to say so.

  const GUARD_HOOK = path.resolve(MANAGER_DIR, '..', 'hooks', 'pre-tool-use-guard.sh');

  test('17. pre-tool-use-guard.sh still reads GSTACK_MANAGER_SCOPE and blocks on it', () => {
    const hook = fs.readFileSync(GUARD_HOOK, 'utf-8');
    expect(hook, 'the guard no longer reads the manager scope').toContain('GSTACK_MANAGER_SCOPE');

    const guarded = hook.slice(hook.indexOf('GSTACK_MANAGER_SCOPE'));
    expect(guarded, 'the guard reads the scope but never refuses anything').toMatch(/exit 2/);
    expect(hook, 'the guard must compare the scope against the tool call file_path').toMatch(
      /tool_input\.file_path/,
    );
  });

  test('18. lib/spawn.ts still hands GSTACK_MANAGER_SCOPE to the child', () => {
    const spawnSrc = fs.readFileSync(path.join(MANAGER_DIR, SPAWN_MODULE), 'utf-8');
    expect(spawnSrc, 'the hook cannot enforce a scope the child never receives').toContain(
      'GSTACK_MANAGER_SCOPE',
    );
    const envBlock = spawnSrc.slice(spawnSrc.indexOf('function childEnv'));
    expect(envBlock.slice(0, 400)).toContain('GSTACK_MANAGER_SCOPE');
  });
});

describe('probe lines cannot re-enter the numbers that open autonomy', () => {
  // origin only works while all three ends stay wired: the probe harness stamps
  // the child it spawns, and both readers that feed §7.3 and P8 drop anything
  // that is not work. Cut any one and probe traffic silently counts as field
  // evidence again — the exact 10-of-14 contamination §3.3 was written for, and
  // nothing would fail to say so.

  const ORACLE_GATES = path.resolve(MANAGER_DIR, '..', 'oracle', 'lib', 'gates.ts');

  test('22. the oracle stamps the guard calls it makes as gate-test', () => {
    const src = fs.readFileSync(ORACLE_GATES, 'utf-8');
    expect(src, 'the probe harness no longer stamps its guard calls').toContain('ORIGIN_ENV');
    const guardFn = src.slice(src.indexOf('export function runGuardGate'));
    expect(guardFn.slice(0, 1500), 'the guard probe is spawned without a gate-test stamp').toContain("'gate-test'");
  });

  test('23. deterministic corroboration only accepts work rows', () => {
    const src = fs.readFileSync(path.join(MANAGER_DIR, 'lib', 'verdict.ts'), 'utf-8');
    const fn = src.slice(src.indexOf('export function verifyDeterministicGates'));
    expect(fn.slice(0, 900), 'a probe row can vouch for an agent-claimed deterministic gate').toMatch(
      /originOf\([^)]*\)\s*===\s*'work'/,
    );
  });

  test('24. the closing chain reads work rows only', () => {
    const src = fs.readFileSync(path.join(MANAGER_DIR, 'lib', 'closing-chain.ts'), 'utf-8');
    const fn = src.slice(src.indexOf('export function collectLoggedGates'));
    expect(fn.slice(0, 700), 'a task can collect a probe run as its own evidence').toContain('workOnly(');
  });

  test('25. gate-log stats counts work by default, not everything', () => {
    const src = fs.readFileSync(path.resolve(MANAGER_DIR, '..', '..', 'bin', 'gate-log'), 'utf-8');
    const fn = src.slice(src.indexOf('function cmdStats'));
    expect(fn.slice(0, 600), 'stats no longer defaults to work — P8 would read probe traffic').toMatch(
      /originScope\(flags,\s*'work'\)/,
    );
  });
});

describe('spec-check cannot see how the change was built', () => {
  // The sharpest gate in the chain (§7.2) is sharp for exactly one reason: it
  // judges a diff against what was agreed WITHOUT having seen the build. That
  // isolation is not a sentence in a prompt, it is the shape of the call —
  // specCheckPrompt takes a flat SpecCheckInput, and the function that fills
  // it in reads the envelope and the diff and nothing else.
  //
  // The runtime test in closing-chain.test.ts proves today's prompt is clean.
  // This one stops the cheap regression: someone passing the task record in
  // "so it has more context", which would silently fold the builder's own
  // report_lines / verify_lines / findings / assumptions into the one gate
  // whose value depends on not having them.

  const NARRATIVE_FIELDS = ['report_lines', 'verify_lines', 'findings', 'assumptions', 'answers', 'agents'];

  test('19. specCheckPrompt takes a flat input, never a task record', () => {
    const src = codeOnly(fs.readFileSync(path.join(MANAGER_DIR, 'lib', 'prompts.ts'), 'utf-8'));
    expect(src).toContain('export interface SpecCheckInput');
    expect(src, 'specCheckPrompt must take SpecCheckInput').toMatch(
      /export function specCheckPrompt\(input: SpecCheckInput\)/,
    );
    expect(src, 'prompts.ts must not touch the task record type').not.toMatch(/\bTaskRecord\b/);

    const fn = src.slice(src.indexOf('export function specCheckPrompt'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    for (const field of NARRATIVE_FIELDS) {
      expect(body, `spec-check prompt reads the builder's ${field}`).not.toContain(field);
    }
  });

  test('20. the input builder reads the envelope and the diff, nothing else', () => {
    const src = codeOnly(fs.readFileSync(path.join(MANAGER_DIR, 'lib', 'closing-chain.ts'), 'utf-8'));
    const fn = src.slice(src.indexOf('export function specCheckInput'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body, 'the spec-check input builder is gone').toBeTruthy();
    for (const field of NARRATIVE_FIELDS) {
      expect(body, `spec-check input carries the builder's ${field}`).not.toContain(field);
    }
    expect(body, 'spec-check must not be handed a task record').not.toMatch(/\btask\b/);
  });

  test('21. the chain is given a context, not a task record', () => {
    const src = codeOnly(fs.readFileSync(path.join(MANAGER_DIR, 'lib', 'closing-chain.ts'), 'utf-8'));
    expect(src, 'the chain must not touch the task record type').not.toMatch(/\bTaskRecord\b/);
    const ctx = src.slice(src.indexOf('export interface ChainContext'));
    const fields = ctx.slice(0, ctx.indexOf('\n}\n'));
    for (const field of NARRATIVE_FIELDS) {
      expect(fields, `ChainContext exposes the builder's ${field}`).not.toContain(field);
    }
  });
});

describe('the manager stays thin', () => {
  test('12. only the port writes to the gate log', () => {
    const hits = offenders(/\bappendGateLog\b/, [path.join('lib', 'gate-log-port.ts'), path.join('lib', 'gate-log.ts')]);
    expect(hits, `gate-log writes go through logGate() in lib/gate-log-port.ts:\n${hits.join('\n')}`).toEqual([]);
  });

  test('13. the port only delegates; it carries no writer of its own', () => {
    const portSrc = fs.readFileSync(path.join(MANAGER_DIR, 'lib', 'gate-log-port.ts'), 'utf-8');
    expect(portSrc).toContain("from './gate-log'");
    expect(portSrc).not.toMatch(/appendFileSync|writeFileSync|\.jsonl/);
  });

  test('14. every source file is real text', () => {
    // A stray NUL byte makes a .ts file "binary" to grep, git diff, and every
    // editor, while still compiling — so it hides rather than fails. Two files
    // picked one up as a template-literal separator and nothing noticed until
    // grep started skipping them.
    const binary: string[] = [];
    for (const file of collectSources()) {
      if ([...file.content].some((ch) => isControlByte(ch))) binary.push(file.rel);
    }
    expect(binary, `these files contain control bytes: ${binary.join(', ')}`).toEqual([]);
  });

  test('15. no hardcoded home directory or drive letter', () => {
    const hits = offenders(/['"](?:[A-Za-z]:[\\/]|\/Users\/|\/home\/|~\/)/, []);
    expect(hits, `paths must derive from os.homedir() or the file's own location:\n${hits.join('\n')}`).toEqual([]);
  });

  test('16. no inline comments inside function bodies', () => {
    const hits: string[] = [];
    for (const file of collectSources()) {
      const lines = file.content.split('\n');
      let inBlockComment = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (inBlockComment) {
          if (trimmed.includes('*/')) inBlockComment = false;
          continue;
        }
        if (trimmed.startsWith('/*')) {
          if (!trimmed.includes('*/')) inBlockComment = true;
          continue;
        }
        if (trimmed.startsWith('//')) continue;
        const codeThenComment = /^[^'"`]*[^:'"`/]\/\/(?!\/)/.test(line);
        if (codeThenComment) hits.push(`${file.rel}:${i + 1}  ${trimmed}`);
      }
    }
    expect(hits, `trailing inline comments are not allowed:\n${hits.join('\n')}`).toEqual([]);
  });
});
