import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildLaunchCommand, parseWorkspaceRef, sendText, writePromptFile } from '../lib/cmux-control';
import { cmuxStorePath, type CmuxSession } from '../lib/cmux-sessions';
import { guardIsWired, lastAssistantText, waitForSlot, watchSession } from '../lib/cmux-spawn';
import { resetConfigCache } from '../config';
import { measuredCost } from '../lib/cost';
import { managerConfigFile } from '../lib/paths';
import { resolveSpawnRunner } from '../lib/spawn';

const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cmux-spawn-')));
const WORK = path.join(HOME, 'worktree');
const ALIVE = process.pid;
const DEAD = 2 ** 22;

function writeStore(lifecycle: string, extra: Record<string, unknown> = {}): void {
  fs.mkdirSync(path.join(HOME, '.cmuxterm'), { recursive: true });
  fs.writeFileSync(
    cmuxStorePath('claude', HOME),
    JSON.stringify({
      sessions: {
        a: {
          sessionId: 's1',
          cwd: WORK,
          pid: ALIVE,
          agentLifecycle: lifecycle,
          transcriptPath: path.join(HOME, 'transcript.jsonl'),
          updatedAt: 100,
          startedAt: 50,
          ...extra,
        },
      },
    }),
  );
}

function session(over: Partial<CmuxSession> = {}): CmuxSession {
  return {
    sessionId: 's1',
    surfaceId: '',
    workspaceId: '',
    cwd: WORK,
    pid: ALIVE,
    pidStartSeconds: 0,
    lifecycle: 'idle',
    transcriptPath: '',
    updatedAt: 0,
    startedAt: 0,
    subtitle: '',
    ...over,
  };
}

beforeEach(() => {
  fs.rmSync(path.join(HOME, '.cmuxterm'), { recursive: true, force: true });
  fs.mkdirSync(WORK, { recursive: true });
});

afterAll(() => {
  fs.rmSync(HOME, { recursive: true, force: true });
});

const FAST = { timeoutMs: 3_000, startupMs: 600, needsInputGraceMs: 300, pollMs: 30, home: HOME };

describe('watching a pane to a state worth reporting', () => {
  // A freshly-hooked session is idle for the moment between registering and
  // taking its first turn. A watcher that trusted that would hand back an
  // empty transcript as a successful run — a measurement that looks fine and
  // is not, which is the failure this whole layer exists to prevent.
  test('idle-at-boot is never read as done', async () => {
    writeStore('idle');
    const outcome = await watchSession(WORK, FAST);
    expect(outcome.health).toBe('never-started');
    expect(outcome.everWorked).toBe(false);
  });

  test('idle AFTER work is done', async () => {
    writeStore('running');
    setTimeout(() => writeStore('idle'), 120);
    const outcome = await watchSession(WORK, FAST);
    expect(outcome.health).toBe('finished');
    expect(outcome.everWorked).toBe(true);
  });

  test('a dead pid recorded as running is a crash, reported as one', async () => {
    writeStore('running');
    setTimeout(() => writeStore('running', { pid: DEAD }), 120);
    expect((await watchSession(WORK, FAST)).health).toBe('crashed');
  });

  // The observed case: a pane sat at needsInput for hours and nothing said so.
  test('needsInput past the grace period hands the task back instead of waiting forever', async () => {
    writeStore('running');
    setTimeout(() => writeStore('needsInput'), 100);
    const outcome = await watchSession(WORK, FAST);
    expect(outcome.health).toBe('waiting');
  });

  // Waiting out the full 45-minute run timeout on a permission prompt costs
  // three quarters of an hour to learn what was true in the first second.
  test('a pane stuck on a permission prompt is handed back, not waited out', async () => {
    writeStore('running');
    setTimeout(() => writeStore('running', { lastSubtitle: 'Permission' }), 100);
    const outcome = await watchSession(WORK, { ...FAST, timeoutMs: 30_000 });
    expect(outcome.health).toBe('blocked');
  });

  // A question the agent answers itself is not a question for a human.
  test('a brief needsInput that resolves on its own does not end the run', async () => {
    writeStore('running');
    setTimeout(() => writeStore('needsInput'), 60);
    setTimeout(() => writeStore('running'), 180);
    setTimeout(() => writeStore('idle'), 500);
    const outcome = await watchSession(WORK, { ...FAST, needsInputGraceMs: 400 });
    expect(outcome.health).toBe('finished');
  });

  test('a session that never registers at all times out on startup, not on the long clock', async () => {
    const started = Date.now();
    const outcome = await watchSession(WORK, FAST);
    expect(outcome.health).toBe('never-started');
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  test('stop is honoured mid-run', async () => {
    writeStore('running');
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    expect((await watchSession(WORK, { ...FAST, timeoutMs: 30_000, signal: controller.signal })).health).toBe('aborted');
  });

  test('an agent that never stops is cut off by the run timeout', async () => {
    writeStore('running');
    const outcome = await watchSession(WORK, { ...FAST, timeoutMs: 400, startupMs: 400 });
    expect(outcome.health).toBe('timeout');
  });
});

describe('the agent cap counts panes the manager never started', () => {
  test('a free machine lets a spawn through', async () => {
    writeStore('idle');
    expect(await waitForSlot(2, { home: HOME, pollMs: 20 })).toBe('free');
  });

  // The operator's own panes count toward the cap, which is the point — and
  // also why the wait has to end. Manager spawns free their seats eventually;
  // a person with eight panes open does not, and an unbounded wait there is a
  // task that never starts and never says why.
  test('a full machine gives up with a timeout rather than waiting forever', async () => {
    writeStore('running');
    expect(await waitForSlot(1, { home: HOME, pollMs: 20, timeoutMs: 150 })).toBe('timeout');
  });

  test('stop is honoured while queued for a slot', async () => {
    writeStore('running');
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 60);
    expect(await waitForSlot(1, { home: HOME, pollMs: 20, timeoutMs: 30_000, signal: controller.signal })).toBe('aborted');
  });
});

describe('the prompt never gets typed into a TUI', () => {
  test('the launch command reads the prompt from a file, as one argument', () => {
    const file = writePromptFile(path.join(HOME, 'pane'), 'line one\nline two\n"quoted" $(rm -rf /)');
    const cmd = buildLaunchCommand({ claudeBin: 'claude', promptFile: file, model: 'claude-opus-4-7' });
    expect(cmd).toContain(`"$(cat '${file}')"`);
    expect(cmd).toContain("--model 'claude-opus-4-7'");
    // The prompt's own text is nowhere on the command line, so nothing in it
    // is ever parsed by the shell.
    expect(cmd).not.toContain('rm -rf');
    expect(fs.readFileSync(file, 'utf-8')).toContain('$(rm -rf /)');
  });

  test('the prompt file is not world-readable', () => {
    const file = writePromptFile(path.join(HOME, 'pane2'), 'secret-ish');
    expect(fs.statSync(file).mode & 0o077).toBe(0);
  });

  test('extra flags land before the prompt, so they are flags and not text', () => {
    const file = writePromptFile(path.join(HOME, 'pane3'), 'hi');
    const cmd = buildLaunchCommand({ claudeBin: 'claude', promptFile: file, extraArgs: ['--dangerously-skip-permissions'] });
    expect(cmd.indexOf('--dangerously-skip-permissions')).toBeLessThan(cmd.indexOf('$(cat'));
  });

  // Nothing that reaches the builder is user or agent text — it is a binary
  // name and a model id from config, and a path the manager built. A value
  // needing an escape means something arrived from somewhere it should not
  // have, and the useful response to that is to stop rather than to escape it
  // correctly forever.
  test('a metacharacter anywhere on the launch line is refused, not escaped', () => {
    const file = writePromptFile(path.join(HOME, 'pane4'), 'hi');
    expect(() => buildLaunchCommand({ claudeBin: "claude'; rm -rf ~; '", promptFile: file })).toThrow(/refusing/);
    expect(() => buildLaunchCommand({ claudeBin: 'claude', promptFile: file, model: "o$(id)" })).toThrow(/refusing/);
    expect(() => buildLaunchCommand({ claudeBin: 'claude', promptFile: file, extraArgs: ['--x`id`'] })).toThrow(/refusing/);
    expect(() => buildLaunchCommand({ claudeBin: 'claude', promptFile: "/tmp/it's/prompt.txt" })).toThrow(/refusing/);
  });
});

describe('sending text into a live pane', () => {
  test('refuses mid-turn: characters would land inside whatever the agent is doing', () => {
    const result = sendText('workspace:1', 'yes', session({ lifecycle: 'running' }));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('running');
  });

  test('refuses a newline: it would submit early and leave the tail as a second instruction', () => {
    const result = sendText('workspace:1', 'do this\nand that', session({ lifecycle: 'idle' }));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('newline');
  });

  test('refuses when no session is attached at all', () => {
    expect(sendText('workspace:1', 'hello', null).ok).toBe(false);
  });
});

describe('the guard has to exist before a permission-free pane is allowed', () => {
  const settings = (body: unknown): string => {
    const file = path.join(HOME, `settings-${Math.abs(JSON.stringify(body).length)}.json`);
    fs.writeFileSync(file, JSON.stringify(body));
    return file;
  };

  test('wired when a PreToolUse hook runs the guard on Edit and Write', () => {
    const file = settings({
      hooks: {
        PreToolUse: [
          { matcher: 'Bash|Edit|Write', hooks: [{ type: 'command', command: 'bash "$HOME/personal/hooks/pre-tool-use-guard.sh"' }] },
        ],
      },
    });
    expect(guardIsWired(file)).toBe(true);
  });

  // §7.3b lesson 1: a directive is not a fence. --dangerously-skip-permissions
  // with no guard behind it is a sentence in a prompt standing in for one.
  test('not wired when the hook covers Bash only', () => {
    const file = settings({
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'bash pre-tool-use-guard.sh' }] }] },
    });
    expect(guardIsWired(file)).toBe(false);
  });

  test('not wired when the hook is some other script', () => {
    const file = settings({
      hooks: { PreToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'bash something-else.sh' }] }] },
    });
    expect(guardIsWired(file)).toBe(false);
  });

  test('a missing or unreadable settings file reads as not wired', () => {
    expect(guardIsWired(path.join(HOME, 'nope.json'))).toBe(false);
  });
});

describe('reading back what the agent said', () => {
  const transcript = path.join(HOME, 'out.jsonl');

  test('the last assistant text is the run output, tool calls skipped', () => {
    fs.writeFileSync(
      transcript,
      [
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'thinking out loud' }] } }),
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read' }] } }),
        JSON.stringify({ type: 'user', message: { content: 'nope' } }),
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'VERDICT: pass' }] } }),
        'garbage that is not json',
      ].join('\n'),
    );
    expect(lastAssistantText(transcript)).toBe('VERDICT: pass');
  });

  test('a transcript that is not there reads as empty, not as a throw', () => {
    expect(lastAssistantText(path.join(HOME, 'missing.jsonl'))).toBe('');
  });
});

describe('cost separates "free" from "nobody knows"', () => {
  // estimateCostUsd collapses both to 0. That is fine for a test harness and
  // wrong for a ceiling: unpriced runs make the machine look like it spent
  // nothing all day, and the first thing anyone does with that number is raise
  // the limit.
  // Deliberately a model that cannot ever exist. Naming a real unpriced model
  // here made the test assert the table's gaps rather than the behaviour, so it
  // broke the day that model got a price.
  test('an unpriced model reports unknown, not zero', () => {
    const cost = measuredCost({ input_tokens: 500_000, output_tokens: 100_000 }, 'claude-not-a-model');
    expect(cost.known).toBe(false);
    expect(cost.usd).toBe(0);
    expect(cost.model).toBe('claude-not-a-model');
  });

  test('a priced model bills cache writes above plain input, not at the same rate', () => {
    const plain = measuredCost({ input_tokens: 1_000_000 }, 'claude-opus-4-7');
    const written = measuredCost({ cache_creation_input_tokens: 1_000_000 }, 'claude-opus-4-7');
    const read = measuredCost({ cache_read_input_tokens: 1_000_000 }, 'claude-opus-4-7');
    expect(plain.usd).toBe(5);
    expect(written.usd).toBeGreaterThan(plain.usd);
    expect(read.usd).toBeLessThan(plain.usd);
  });

  test('no model at all is unknown rather than free', () => {
    expect(measuredCost({ input_tokens: 100 }, '').known).toBe(false);
  });
});

describe('choosing where an agent runs', () => {
  function withConfig(body: Record<string, unknown> | null): void {
    fs.mkdirSync(path.dirname(managerConfigFile()), { recursive: true });
    if (body) fs.writeFileSync(managerConfigFile(), JSON.stringify(body));
    else fs.rmSync(managerConfigFile(), { force: true });
    resetConfigCache();
  }

  afterAll(() => {
    delete process.env.MANAGER_SPAWN_RUNNER;
    withConfig(null);
  });

  test('the SDK runner is what you get by default', () => {
    delete process.env.MANAGER_SPAWN_RUNNER;
    withConfig(null);
    expect(resolveSpawnRunner()).toBe('sdk');
  });

  test('config picks the runner when no env var says otherwise', () => {
    delete process.env.MANAGER_SPAWN_RUNNER;
    withConfig({ spawnRunner: 'cmux' });
    expect(resolveSpawnRunner()).toBe('cmux');
  });

  // So one daemon can be tried on cmux without changing what every other entry
  // point on the machine does.
  test('the env var beats config', () => {
    withConfig({ spawnRunner: 'cmux' });
    process.env.MANAGER_SPAWN_RUNNER = 'cli';
    expect(resolveSpawnRunner()).toBe('cli');
  });

  // A typo in an env var should not take the daemon down, and the runner in
  // use is printed at boot either way.
  test('an unrecognised name falls back to the SDK instead of throwing', () => {
    withConfig(null);
    process.env.MANAGER_SPAWN_RUNNER = 'warp';
    expect(resolveSpawnRunner()).toBe('sdk');
  });
});

describe('parsing what cmux prints back', () => {
  test('the workspace ref survives a leading notice line', () => {
    expect(parseWorkspaceRef("cmux: 'new-workspace' is now an alias\nOK workspace:21")).toBe('workspace:21');
  });

  test('no ref in the output is an empty string, not a wrong guess', () => {
    expect(parseWorkspaceRef('some error happened')).toBe('');
  });
});
