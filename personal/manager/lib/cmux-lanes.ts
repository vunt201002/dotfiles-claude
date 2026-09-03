import * as path from 'node:path';
import { loadConfig } from '../config';
import { shellSafePath, singleQuote, sleep, type CmuxRun } from './cmux-control';
import * as cmuxSessions from './cmux-sessions';

export type LaneCmuxExecutor = (args: string[], timeoutMs?: number) => CmuxRun;

export interface DiscoveredLane {
  title: string;
  surfaceRef: string;
  surfaceId?: string;
  workspaceRef: string;
}

export interface ReservedLane extends DiscoveredLane {
  foreground: 'shell' | 'agent';
}

const WORKSPACE_REF = /\bworkspace:\d+\b/;
const PANE_REF = /\bpane:\d+\b/;
const SURFACE_REF = /\bsurface:\d+\b/;
const SURFACE_ID = /\b[0-9A-F]{8}-(?:[0-9A-F]{4}-){3}[0-9A-F]{12}\b/i;

function titleOnLine(line: string, titles: readonly string[]): string {
  const lower = line.toLowerCase();
  return titles.find((title) => new RegExp(`(?:^|\\s)${title.toLowerCase()}(?:\\s|·|$)`).test(lower)) ?? '';
}

export function discoverLanes(
  workspaceTitle: string,
  laneTitles: readonly string[],
  executor: LaneCmuxExecutor,
): DiscoveredLane[] {
  const workspaces = executor(['list-workspaces']);
  if (!workspaces.ok) return [];
  const workspaceLine = workspaces.stdout
    .split('\n')
    .find((line) => line.toLowerCase().includes(workspaceTitle.toLowerCase()) && WORKSPACE_REF.test(line));
  const workspaceRef = workspaceLine?.match(WORKSPACE_REF)?.[0] ?? '';
  if (!workspaceRef) return [];
  const panes = executor(['list-panes', '--workspace', workspaceRef]);
  if (!panes.ok) return [];
  const found = new Map<string, DiscoveredLane>();
  for (const paneLine of panes.stdout.split('\n')) {
    const paneRef = paneLine.match(PANE_REF)?.[0];
    if (!paneRef) continue;
    const paneTitle = titleOnLine(paneLine, laneTitles);
    const surfaces = executor(['list-pane-surfaces', '--id-format', 'both', '--workspace', workspaceRef, '--pane', paneRef]);
    if (!surfaces.ok) continue;
    for (const surfaceLine of surfaces.stdout.split('\n')) {
      const surfaceRef = surfaceLine.match(SURFACE_REF)?.[0];
      if (!surfaceRef) continue;
      const surfaceId = surfaceLine.match(SURFACE_ID)?.[0];
      const title = titleOnLine(surfaceLine, laneTitles) || paneTitle;
      if (title && !found.has(title)) {
        found.set(title, {
          title,
          surfaceRef,
          ...(surfaceId ? { surfaceId } : {}),
          workspaceRef,
        });
      }
    }
  }
  return laneTitles.flatMap((title) => (found.has(title) ? [found.get(title)!] : []));
}

function idleLaneForeground(run: CmuxRun): ReservedLane['foreground'] | null {
  if (!run.ok) return null;
  const screen = run.stdout.trimEnd();
  if (!screen) return 'shell';
  const lines = screen.split('\n').map((line) => line.trim()).filter(Boolean);
  const last = lines.at(-1) ?? '';
  const footer = lines.slice(-7);
  const claudeIdle = footer.some((line, index) => line === '❯' && /^─{8,}$/.test(footer[index + 1] ?? ''));
  const codexIdle =
    footer.at(-2) === '› Ask Codex to do anything' &&
    /^[\w.-]+(?:\s+[\w.-]+)*\s+·\s+\S/.test(last) &&
    !footer.slice(0, -2).some((line) => /^• Working\b/i.test(line) || /\besc to interrupt\b/i.test(line));
  if (claudeIdle || codexIdle) return 'agent';
  if (/(?:\$|%|#|❯|›|>)\s*$/.test(last) || /\b(?:idle|ready|rảnh)\b/i.test(last)) return 'shell';
  return null;
}

export function laneLooksIdle(run: CmuxRun): boolean {
  return idleLaneForeground(run) !== null;
}

export type LaneReservationOutcome =
  | { outcome: 'reserved'; lane: ReservedLane; release: () => void }
  | { outcome: 'aborted' | 'timeout' | 'unavailable'; reason?: string };

interface ActiveLaneReservation {
  taskId: string;
}

export type LaneFleetReader = (agent?: string, home?: string) => cmuxSessions.FleetRead;

const laneReservations = new Map<string, ActiveLaneReservation>();

export function laneHasLiveSession(
  surfaceId: string,
  readFleet: LaneFleetReader = cmuxSessions.fleet,
  nowMs: number = Date.now(),
  abandonedAfterMs: number = loadConfig().abandonedPaneAfterMs,
): boolean {
  const normalizedSurfaceId = surfaceId.toLowerCase();
  for (const agent of ['claude', 'codex']) {
    const read = readFleet(agent);
    if (!read.ok) continue;
    if (
      read.entries.some(
        (entry) =>
          entry.surfaceId.toLowerCase() === normalizedSurfaceId &&
          (entry.health === 'working' || entry.health === 'waiting' || entry.health === 'blocked') &&
          !cmuxSessions.isAbandoned(entry, nowMs, abandonedAfterMs),
      )
    ) {
      return true;
    }
  }
  return false;
}

export async function reserveLane(
  taskId: string,
  workspaceTitle: string,
  laneTitles: readonly string[],
  opts: {
    executor: LaneCmuxExecutor;
    fleet?: LaneFleetReader;
    now?: () => number;
    abandonedAfterMs?: number;
    pollMs?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<LaneReservationOutcome> {
  const now = opts.now ?? Date.now;
  const deadline = now() + (opts.timeoutMs ?? 30 * 60_000);
  const pollMs = opts.pollMs ?? 2_000;
  const readFleet = opts.fleet ?? cmuxSessions.fleet;
  const abandonedAfterMs = opts.abandonedAfterMs ?? loadConfig().abandonedPaneAfterMs;
  while (true) {
    if (opts.signal?.aborted) return { outcome: 'aborted' };
    const lanes = discoverLanes(workspaceTitle, laneTitles, opts.executor);
    if (lanes.length === 0) return { outcome: 'unavailable', reason: `no lanes named ${laneTitles.join(', ')} in ${workspaceTitle}` };
    for (const lane of lanes) {
      if (laneReservations.has(lane.surfaceRef)) continue;
      if (lane.surfaceId && laneHasLiveSession(lane.surfaceId, readFleet, now(), abandonedAfterMs)) continue;
      const screen = opts.executor(['read-screen', '--surface', lane.surfaceRef, '--lines', '80']);
      const foreground = idleLaneForeground(screen);
      if (!foreground) continue;
      const reservation: ActiveLaneReservation = { taskId };
      laneReservations.set(lane.surfaceRef, reservation);
      return {
        outcome: 'reserved',
        lane: { ...lane, foreground },
        release: () => {
          if (laneReservations.get(lane.surfaceRef) === reservation) {
            laneReservations.delete(lane.surfaceRef);
          }
        },
      };
    }
    if (now() >= deadline) return { outcome: 'timeout' };
    await sleep(pollMs);
  }
}

export function buildLaneLaunchCommand(dir: string, env: Record<string, string>, launch: string): string {
  const cwd = path.resolve(dir);
  if (!shellSafePath(cwd)) throw new Error(`refusing lane worktree path containing shell metacharacters: ${cwd}`);
  const assignments = Object.entries(env).map(([key, value]) => singleQuote(`${key}=${value}`));
  return `cd ${singleQuote(cwd)} && env ${assignments.join(' ')} ${launch}`;
}

export interface LaneShellReadyOptions {
  shellReadyTimeoutMs: number;
  now?: () => number;
  wait?: (delayMs: number) => Promise<void>;
}

const LANE_SHELL_POLL_BACKOFF_MS = [50, 100, 200, 250] as const;

function laneFailure(lane: DiscoveredLane, reason: string): CmuxRun {
  return { ok: false, stdout: '', stderr: `${lane.title} ${reason}` };
}

function sendLaneExit(lane: DiscoveredLane, executor: LaneCmuxExecutor): CmuxRun {
  const exit = executor(['send', '--surface', lane.surfaceRef, '--', '/exit']);
  if (!exit.ok) return laneFailure(lane, `could not send /exit: ${exit.stderr || exit.stdout || 'cmux send failed'}`);
  const submitted = executor(['send-key', '--surface', lane.surfaceRef, 'Enter']);
  if (!submitted.ok) {
    return laneFailure(lane, `could not submit /exit: ${submitted.stderr || submitted.stdout || 'cmux send-key failed'}`);
  }
  return submitted;
}

/** Returns only after the terminal is observably at a shell prompt. */
export async function ensureLaneShell(
  lane: DiscoveredLane,
  executor: LaneCmuxExecutor,
  opts: LaneShellReadyOptions,
  initialForeground: ReservedLane['foreground'] | null = null,
): Promise<CmuxRun> {
  const now = opts.now ?? Date.now;
  const wait = opts.wait ?? sleep;
  const timeoutMs = Math.max(0, opts.shellReadyTimeoutMs);
  const deadline = now() + timeoutMs;
  let exitSent = false;
  let poll = 0;
  if (initialForeground === 'shell') return { ok: true, stdout: '', stderr: '' };
  if (initialForeground === 'agent') {
    const submitted = sendLaneExit(lane, executor);
    if (!submitted.ok) return submitted;
    exitSent = true;
  }
  while (true) {
    const ready = executor(['read-screen', '--surface', lane.surfaceRef, '--lines', '20']);
    if (!ready.ok) return laneFailure(lane, `could not verify its shell: ${ready.stderr || 'read-screen failed'}`);
    const foreground = idleLaneForeground(ready);
    if (foreground === 'shell') return ready;
    if (foreground === 'agent' && !exitSent) {
      const submitted = sendLaneExit(lane, executor);
      if (!submitted.ok) return submitted;
      exitSent = true;
    }
    const remaining = deadline - now();
    if (remaining <= 0) {
      const afterExit = exitSent ? ' after /exit' : '';
      return laneFailure(lane, `did not return to a shell${afterExit} within ${timeoutMs}ms`);
    }
    const delay = Math.min(LANE_SHELL_POLL_BACKOFF_MS[Math.min(poll, LANE_SHELL_POLL_BACKOFF_MS.length - 1)], remaining);
    poll += 1;
    await wait(delay);
  }
}

export async function launchInLane(
  lane: ReservedLane,
  command: string,
  executor: LaneCmuxExecutor,
  opts: LaneShellReadyOptions = { shellReadyTimeoutMs: loadConfig().cmuxLaneShellReadyMs },
): Promise<CmuxRun> {
  const shell = await ensureLaneShell(lane, executor, opts, lane.foreground);
  if (!shell.ok) return shell;
  const sent = executor(['send', '--surface', lane.surfaceRef, '--', command]);
  if (!sent.ok) return sent;
  return executor(['send-key', '--surface', lane.surfaceRef, 'Enter']);
}

export function interruptLane(lane: DiscoveredLane, executor: LaneCmuxExecutor): CmuxRun {
  return executor(['send-key', '--surface', lane.surfaceRef, 'ctrl+c']);
}
