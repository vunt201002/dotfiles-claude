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

  test('4. only lib/git.ts and lib/assert-runner.ts shell out', () => {
    const hits = offenders(/\b(Bun\.spawn|Bun\.spawnSync|child_process|execSync|spawnSync)\s*[(.]/, [
      path.join('lib', 'git.ts'),
      path.join('lib', 'assert-runner.ts'),
    ]);
    expect(hits, `the manager never drives a terminal; it spawns through the SDK runner:\n${hits.join('\n')}`).toEqual([]);

    const gitSrc = fs.readFileSync(path.join(MANAGER_DIR, 'lib', 'git.ts'), 'utf-8');
    const argv = [...gitSrc.matchAll(/Bun\.spawnSync\(\s*\[\s*'([^']+)'/g)].map((m) => m[1]);
    expect(argv, 'lib/git.ts may run git and nothing else').toEqual(['git']);
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
