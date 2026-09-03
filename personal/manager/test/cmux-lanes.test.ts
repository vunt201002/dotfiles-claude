import { describe, expect, test } from 'bun:test';
import {
  buildLaneLaunchCommand,
  discoverLanes,
  laneLooksIdle,
  launchInLane,
  reserveLane,
  type LaneCmuxExecutor,
} from '../lib/cmux-lanes';
import type { FleetEntry, FleetRead } from '../lib/cmux-sessions';

const RECONSTRUCTED_IDLE_CLAUDE_SCREEN = `
● Finished the requested implementation and verified the focused tests.

❯
────────────────────────────────────────────────────────────────────────────────
  /Users/avadavu/Project/github/dotfiles-claude
  main
  Sonnet 4.6 · task │ ████████████████████ 100%
  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents
`;

const RECONSTRUCTED_BUSY_CLAUDE_SCREEN = `
● Read(personal/manager/lib/cmux-lanes.ts)
  ⎿  Read 128 lines

✽ Investigating lane reservation behavior… (32s · ↓ 1.2k tokens)

  esc to interrupt
`;

const REAL_CAPTURED_CODEX_IDLE_SCREEN = `
  › Ask Codex to do anything

    gpt-5.6-sol high · ~/Project/github/dotfile…
`;

const CONSTRUCTED_BUSY_CODEX_SCREEN = `
• Working (32s • esc to interrupt)
  ↳ Reading personal/manager/lib/cmux-lanes.ts

  gpt-5.6-sol high · ~/Project/github/dotfile…
`;

const CONSTRUCTED_BUSY_CODEX_SCREEN_QUOTING_PLACEHOLDER = `
• Working (48s • esc to interrupt)
  ↳ Writing the lane-idle-detection review:
    A busy agent can quote "Ask Codex to do anything" in its visible output.
    Substring matching would then reserve the lane while this report is still being written.

  gpt-5.6-sol high · ~/Project/github/dotfile…
`;

const CONSTRUCTED_BUSY_CODEX_SCREEN_WITH_WRAPPED_IDLE_EXAMPLE = `
• Working (52s • esc to interrupt)
  ↳ Explaining how terminal prose can wrap a quoted example so the next line is only:
  › Ask Codex to do anything
    That line is documentation, not the live empty-input prompt row.

  gpt-5.6-sol high · ~/Project/github/dotfile…
`;

const CONSTRUCTED_BUSY_CODEX_SCREEN_WITH_IDLE_DOC_BLOCK = `
• Working (58s • esc to interrupt)
  ↳ Documenting a raw idle-screen capture:

  \`\`\`text
  › Ask Codex to do anything

    gpt-5.6-sol high · ~/Project/github/dotfile…
  \`\`\`

• Working (58s • esc to interrupt)

› Ask Codex to do anything

  gpt-5.6-sol high · ~/Project/github/dotfile…
`;

const CONSTRUCTED_BUSY_CODEX_SCREEN_WITH_DISTANT_BUSY_INDICATOR = `
• Working (73s • esc to interrupt)
  ↳ Writing a detailed investigation report whose visible body now spans many rows.
    The manager owns the active task and has not observed its process exit.
    The report explains the lane discovery path.
    It records the workspace lookup.
    It records the pane lookup.
    It records the surface lookup.
    It records the current task identity.
    It records why rendered prose is not process state.

› Ask Codex to do anything

  gpt-5.6-sol high · ~/Project/github/dotfile…
`;

const DOCUMENTATION_THAT_REPRODUCES_THE_IDLE_SHAPE = `
Here is what the manager's lane-idle detector looks for
when it decides a Codex lane is free to reuse. A real
idle Codex pane renders its footer like this:

› Ask Codex to do anything

  gpt-5.6-sol high · ~/Project/github/dotfile…
`;

const TEST_SURFACE_ID = '11111111-1111-4111-8111-111111111111';
const TEST_NOW_MS = 10 * 60 * 60_000;
const TEST_ABANDONED_AFTER_MS = 2 * 60 * 60_000;

function busyFleet(surfaceId: string, overrides: Partial<FleetEntry> = {}): (agent?: string) => FleetRead {
  const entry: FleetEntry = {
    sessionId: 'external-busy-session',
    surfaceId,
    workspaceId: 'workspace-uuid',
    cwd: '/tmp/external-work',
    pid: process.pid,
    pidStartSeconds: 1,
    lifecycle: 'running',
    transcriptPath: '',
    updatedAt: TEST_NOW_MS / 1000,
    startedAt: 50,
    subtitle: 'Working',
    health: 'working',
    ...overrides,
  };
  return (agent = 'claude') => ({ ok: true, entries: agent === 'codex' ? [entry] : [] });
}

function fixtureExecutor(
  screens: Record<string, { ok: boolean; text: string }>,
  surfaceIds: Record<string, string> = {},
): LaneCmuxExecutor {
  return (args) => {
    const command = args[0];
    if (command === 'list-workspaces') return { ok: true, stdout: 'workspace:7 improve-harness', stderr: '' };
    if (command === 'list-panes') return { ok: true, stdout: 'pane:1 L1\npane:2 L2\npane:3 L3 · rảnh\npane:4 L4 · rảnh', stderr: '' };
    if (command === 'list-pane-surfaces') {
      const pane = args[args.indexOf('--pane') + 1];
      const number = pane.split(':')[1];
      const surfaceRef = `surface:1${number}`;
      const surfaceId = surfaceIds[surfaceRef];
      return { ok: true, stdout: `${surfaceRef}${surfaceId ? ` ${surfaceId}` : ''} L${number}`, stderr: '' };
    }
    if (command === 'read-screen') {
      const surface = args[args.indexOf('--surface') + 1];
      const screen = screens[surface] ?? { ok: false, text: 'untouched' };
      return screen.ok
        ? { ok: true, stdout: screen.text, stderr: '' }
        : { ok: false, stdout: '', stderr: screen.text };
    }
    return { ok: true, stdout: '', stderr: '' };
  };
}

async function reserveAgainstStructuredBusySession(
  screen: string,
  entryOverrides: Partial<FleetEntry> = {},
): Promise<{ outcome: string; screenReads: number }> {
  let screenReads = 0;
  const baseExecutor = fixtureExecutor(
    { 'surface:11': { ok: true, text: screen } },
    { 'surface:11': TEST_SURFACE_ID },
  );
  const executor: LaneCmuxExecutor = (args, timeoutMs) => {
    if (args[0] === 'read-screen') screenReads += 1;
    return baseExecutor(args, timeoutMs);
  };
  const result = await reserveLane('external-busy-check', 'improve-harness', ['L1'], {
    executor,
    fleet: busyFleet(TEST_SURFACE_ID, entryOverrides),
    now: () => TEST_NOW_MS,
    abandonedAfterMs: TEST_ABANDONED_AFTER_MS,
    pollMs: 1,
    timeoutMs: 0,
  });
  if (result.outcome === 'reserved') result.release();
  return { outcome: result.outcome, screenReads };
}

async function launchFromReservedScreen(screen: string): Promise<{ ok: boolean; calls: string[][] }> {
  const calls: string[][] = [];
  let currentScreen = screen;
  let pendingText = '';
  const baseExecutor = fixtureExecutor({ 'surface:11': { ok: true, text: screen } });
  const executor: LaneCmuxExecutor = (args, timeoutMs) => {
    calls.push(args);
    if (args[0] === 'read-screen') return { ok: true, stdout: currentScreen, stderr: '' };
    if (args[0] === 'send') {
      pendingText = args.at(-1) ?? '';
      return { ok: true, stdout: '', stderr: '' };
    }
    if (args[0] === 'send-key' && args.at(-1) === 'Enter') {
      if (pendingText === '/exit') currentScreen = 'manager@host ~/repo %';
      pendingText = '';
      return { ok: true, stdout: '', stderr: '' };
    }
    return baseExecutor(args, timeoutMs);
  };
  const reservation = await reserveLane('launch-test', 'improve-harness', ['L1'], {
    executor,
    timeoutMs: 0,
  });
  if (reservation.outcome !== 'reserved') throw new Error(`expected a reservation, got ${reservation.outcome}`);
  const result = await launchInLane(reservation.lane, 'launch', executor);
  reservation.release();
  return {
    ok: result.ok,
    calls: calls.filter((args) => args[0] === 'read-screen' || args[0] === 'send' || args[0] === 'send-key'),
  };
}

describe('reusable cmux lanes', () => {
  test('recognizes a reconstructed captured idle Claude Code footer with the prompt above status lines', () => {
    expect(laneLooksIdle({ ok: true, stdout: RECONSTRUCTED_IDLE_CLAUDE_SCREEN, stderr: '' })).toBe(true);
  });

  test('recognizes a real captured idle Codex footer with the placeholder above its status line', () => {
    expect(laneLooksIdle({ ok: true, stdout: REAL_CAPTURED_CODEX_IDLE_SCREEN, stderr: '' })).toBe(true);
  });

  test('an unreadable screen is unknown, never a shell available for reservation', async () => {
    const executor = fixtureExecutor({ 'surface:11': { ok: false, text: 'screen unavailable' } });
    expect(laneLooksIdle({ ok: false, stdout: '', stderr: 'screen unavailable' })).toBe(false);
    expect(
      await reserveLane('unreadable-screen', 'improve-harness', ['L1'], {
        executor,
        timeoutMs: 0,
      }),
    ).toEqual({ outcome: 'timeout' });
  });

  test.each([
    ['bare shell prompt', 'manager@host ~/repo %'],
    ['bare ❯ prompt', '❯'],
    ['idle status word', 'lane idle'],
    ['ready status word', 'lane ready'],
    ['rảnh status word', 'lane rảnh'],
  ])('still recognizes an idle %s', (_name, screen) => {
    expect(laneLooksIdle({ ok: true, stdout: screen, stderr: '' })).toBe(true);
  });

  test('does not mistake a mid-task Claude Code screen for idle', () => {
    expect(laneLooksIdle({ ok: true, stdout: RECONSTRUCTED_BUSY_CLAUDE_SCREEN, stderr: '' })).toBe(false);
  });

  test('does not mistake a constructed mid-task Codex screen for idle', () => {
    expect(laneLooksIdle({ ok: true, stdout: CONSTRUCTED_BUSY_CODEX_SCREEN, stderr: '' })).toBe(false);
  });

  test('does not mistake busy Codex output quoting the empty-input placeholder for idle', () => {
    expect(laneLooksIdle({ ok: true, stdout: CONSTRUCTED_BUSY_CODEX_SCREEN_QUOTING_PLACEHOLDER, stderr: '' })).toBe(false);
  });

  test('does not mistake a naturally wrapped idle-placeholder example for the live prompt row', () => {
    expect(laneLooksIdle({ ok: true, stdout: CONSTRUCTED_BUSY_CODEX_SCREEN_WITH_WRAPPED_IDLE_EXAMPLE, stderr: '' })).toBe(false);
  });

  test('does not mistake a raw idle-screen documentation block for the live idle footer', () => {
    expect(laneLooksIdle({ ok: true, stdout: CONSTRUCTED_BUSY_CODEX_SCREEN_WITH_IDLE_DOC_BLOCK, stderr: '' })).toBe(false);
  });

  test('structured session health defeats a busy indicator beyond the fallback footer window', async () => {
    expect(await reserveAgainstStructuredBusySession(CONSTRUCTED_BUSY_CODEX_SCREEN_WITH_DISTANT_BUSY_INDICATOR)).toEqual({
      outcome: 'timeout',
      screenReads: 0,
    });
  });

  test('structured session health defeats pure documentation that reproduces the idle shape', async () => {
    expect(await reserveAgainstStructuredBusySession(DOCUMENTATION_THAT_REPRODUCES_THE_IDLE_SHAPE)).toEqual({
      outcome: 'timeout',
      screenReads: 0,
    });
  });

  test('an abandoned working entry falls through to an actually idle screen', async () => {
    expect(
      await reserveAgainstStructuredBusySession(REAL_CAPTURED_CODEX_IDLE_SCREEN, {
        lifecycle: 'unknown',
        health: 'working',
        updatedAt: (TEST_NOW_MS - 3 * TEST_ABANDONED_AFTER_MS) / 1000,
      }),
    ).toEqual({ outcome: 'reserved', screenReads: 1 });
  });

  test('an uncleared finished session record does not hide an idle lane', async () => {
    expect(
      await reserveAgainstStructuredBusySession(REAL_CAPTURED_CODEX_IDLE_SCREEN, {
        lifecycle: 'idle',
        health: 'finished',
        updatedAt: TEST_NOW_MS / 1000,
      }),
    ).toEqual({ outcome: 'reserved', screenReads: 1 });
  });

  test('a waiting session stops hiding the lane after the configured abandonment window', async () => {
    expect(
      await reserveAgainstStructuredBusySession(REAL_CAPTURED_CODEX_IDLE_SCREEN, {
        lifecycle: 'needsInput',
        health: 'waiting',
        updatedAt: (TEST_NOW_MS - TEST_ABANDONED_AFTER_MS - 1) / 1000,
      }),
    ).toEqual({ outcome: 'reserved', screenReads: 1 });
  });

  test.each([
    ['working', 'running', 'Working'],
    ['waiting', 'needsInput', 'Needs input'],
    ['blocked', 'running', 'Permission'],
  ] as const)('a fresh %s entry still blocks before the screen fallback', async (health, lifecycle, subtitle) => {
    expect(
      await reserveAgainstStructuredBusySession(REAL_CAPTURED_CODEX_IDLE_SCREEN, {
        health,
        lifecycle,
        subtitle,
        updatedAt: TEST_NOW_MS / 1000,
      }),
    ).toEqual({ outcome: 'timeout', screenReads: 0 });
  });

  test('reserves a lane promptly when Claude Code is idle above its multi-line footer', async () => {
    let screenReads = 0;
    const baseExecutor = fixtureExecutor({
      'surface:11': { ok: true, text: RECONSTRUCTED_IDLE_CLAUDE_SCREEN },
      'surface:12': { ok: true, text: RECONSTRUCTED_IDLE_CLAUDE_SCREEN },
      'surface:13': { ok: true, text: RECONSTRUCTED_IDLE_CLAUDE_SCREEN },
      'surface:14': { ok: true, text: RECONSTRUCTED_IDLE_CLAUDE_SCREEN },
    });
    const executor: LaneCmuxExecutor = (args, timeoutMs) => {
      if (args[0] === 'read-screen') screenReads += 1;
      return baseExecutor(args, timeoutMs);
    };

    const result = await reserveLane('task-claude-idle', 'improve-harness', ['L1', 'L2', 'L3', 'L4'], {
      executor,
      pollMs: 1,
      timeoutMs: 20,
    });

    expect(result.outcome).toBe('reserved');
    expect(screenReads).toBe(1);
    if (result.outcome === 'reserved') result.release();
  });

  test('discovers lane surfaces by workspace and title instead of stored refs', () => {
    const lanes = discoverLanes('improve-harness', ['L1', 'L2', 'L3', 'L4'], fixtureExecutor({}));
    expect(lanes).toEqual([
      { title: 'L1', surfaceRef: 'surface:11', workspaceRef: 'workspace:7' },
      { title: 'L2', surfaceRef: 'surface:12', workspaceRef: 'workspace:7' },
      { title: 'L3', surfaceRef: 'surface:13', workspaceRef: 'workspace:7' },
      { title: 'L4', surfaceRef: 'surface:14', workspaceRef: 'workspace:7' },
    ]);
  });

  test('atomic leases queue when every lane is reserved and wake after release', async () => {
    const exec = fixtureExecutor({
      'surface:11': { ok: true, text: '$' },
      'surface:12': { ok: true, text: 'working' },
      'surface:13': { ok: true, text: 'working' },
      'surface:14': { ok: true, text: 'working' },
    });
    const first = await reserveLane('task-a', 'improve-harness', ['L1', 'L2', 'L3', 'L4'], {
      executor: exec,
      pollMs: 10,
      timeoutMs: 200,
    });
    expect(first.outcome).toBe('reserved');
    const secondPromise = reserveLane('task-b', 'improve-harness', ['L1', 'L2', 'L3', 'L4'], {
      executor: exec,
      pollMs: 10,
      timeoutMs: 200,
    });
    setTimeout(() => {
      if (first.outcome === 'reserved') first.release();
    }, 30);
    const second = await secondPromise;
    expect(second.outcome).toBe('reserved');
    if (second.outcome === 'reserved') second.release();
  });

  test('a stale release closure cannot erase a newer self-owned reservation', async () => {
    const exec = fixtureExecutor({ 'surface:11': { ok: true, text: '$' } });
    const first = await reserveLane('task-first', 'improve-harness', ['L1'], { executor: exec, timeoutMs: 0 });
    expect(first.outcome).toBe('reserved');
    if (first.outcome !== 'reserved') return;
    first.release();

    const second = await reserveLane('task-second', 'improve-harness', ['L1'], { executor: exec, timeoutMs: 0 });
    expect(second.outcome).toBe('reserved');
    if (second.outcome !== 'reserved') return;
    first.release();

    const third = await reserveLane('task-third', 'improve-harness', ['L1'], {
      executor: exec,
      pollMs: 1,
      timeoutMs: 0,
    });
    second.release();
    if (third.outcome === 'reserved') third.release();
    expect(third.outcome).toBe('timeout');
  });

  test('launch command changes to the isolated worktree before starting the agent', () => {
    const command = buildLaneLaunchCommand('/tmp/task-worktree', { GSTACK_MANAGER_TASK: 'task-a' }, "'claude' 'prompt'");
    expect(command).toBe("cd '/tmp/task-worktree' && env 'GSTACK_MANAGER_TASK=task-a' 'claude' 'prompt'");
  });

  test('exits a realistic idle Codex session before sending the launch command', async () => {
    expect(await launchFromReservedScreen(REAL_CAPTURED_CODEX_IDLE_SCREEN)).toEqual({
      ok: true,
      calls: [
        ['read-screen', '--surface', 'surface:11', '--lines', '80'],
        ['send', '--surface', 'surface:11', '--', '/exit'],
        ['send-key', '--surface', 'surface:11', 'Enter'],
        ['read-screen', '--surface', 'surface:11', '--lines', '20'],
        ['send', '--surface', 'surface:11', '--', 'launch'],
        ['send-key', '--surface', 'surface:11', 'Enter'],
      ],
    });
  });

  test('exits a realistic idle Claude Code session before sending the launch command', async () => {
    expect(await launchFromReservedScreen(RECONSTRUCTED_IDLE_CLAUDE_SCREEN)).toEqual({
      ok: true,
      calls: [
        ['read-screen', '--surface', 'surface:11', '--lines', '80'],
        ['send', '--surface', 'surface:11', '--', '/exit'],
        ['send-key', '--surface', 'surface:11', 'Enter'],
        ['read-screen', '--surface', 'surface:11', '--lines', '20'],
        ['send', '--surface', 'surface:11', '--', 'launch'],
        ['send-key', '--surface', 'surface:11', 'Enter'],
      ],
    });
  });

  test.each([
    ['send', 'L1 could not send /exit: cmux send failed'],
    ['send-key', 'L1 could not submit /exit: cmux send-key failed'],
  ] as const)('a failed %s exit operation names the lane and the operation that failed', async (failedOperation, reason) => {
    const executor: LaneCmuxExecutor = (args) => {
      if (args[0] === 'read-screen') return { ok: true, stdout: REAL_CAPTURED_CODEX_IDLE_SCREEN, stderr: '' };
      if (args[0] === failedOperation) return { ok: false, stdout: '', stderr: '' };
      return { ok: true, stdout: '', stderr: '' };
    };

    expect(
      await launchInLane(
        { title: 'L1', surfaceRef: 'surface:11', workspaceRef: 'workspace:7', foreground: 'agent' },
        'launch',
        executor,
        { shellReadyTimeoutMs: 250 },
      ),
    ).toEqual({ ok: false, stdout: '', stderr: reason });
  });

  test('a slow TUI that needs more than the old twenty polls still reaches the shell', async () => {
    let now = 0;
    let screenReads = 0;
    const executor: LaneCmuxExecutor = (args) => {
      if (args[0] === 'read-screen') {
        screenReads += 1;
        return {
          ok: true,
          stdout: screenReads < 25 ? REAL_CAPTURED_CODEX_IDLE_SCREEN : 'manager@host ~/repo %',
          stderr: '',
        };
      }
      return { ok: true, stdout: '', stderr: '' };
    };

    const result = await launchInLane(
      { title: 'L1', surfaceRef: 'surface:11', workspaceRef: 'workspace:7', foreground: 'agent' },
      'launch',
      executor,
      {
        shellReadyTimeoutMs: 10_000,
        now: () => now,
        wait: async (delayMs) => {
          now += delayMs;
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(screenReads).toBe(25);
  });

  test('a TUI that never returns to a shell fails with the configured wait in the reason', async () => {
    let now = 0;
    const executor: LaneCmuxExecutor = (args) =>
      args[0] === 'read-screen'
        ? { ok: true, stdout: REAL_CAPTURED_CODEX_IDLE_SCREEN, stderr: '' }
        : { ok: true, stdout: '', stderr: '' };

    const result = await launchInLane(
      { title: 'L1', surfaceRef: 'surface:11', workspaceRef: 'workspace:7', foreground: 'agent' },
      'launch',
      executor,
      {
        shellReadyTimeoutMs: 250,
        now: () => now,
        wait: async (delayMs) => {
          now += delayMs;
        },
      },
    );

    expect(result).toEqual({
      ok: false,
      stdout: '',
      stderr: 'L1 did not return to a shell after /exit within 250ms',
    });
  });

  test('launches directly in a bare shell without another screen read or exit attempt', async () => {
    expect(await launchFromReservedScreen('manager@host ~/repo %')).toEqual({
      ok: true,
      calls: [
        ['read-screen', '--surface', 'surface:11', '--lines', '80'],
        ['send', '--surface', 'surface:11', '--', 'launch'],
        ['send-key', '--surface', 'surface:11', 'Enter'],
      ],
    });
  });
});
