#!/usr/bin/env node
/**
 * Claude Code `statusLine` (settings.json key, KHONG phai hook).
 * Hop dong: doc JSON session tren stdin, in DUNG 1 dong ra stdout.
 * Bat buoc: khong bao gio throw va khong bao gio cham — script fail hoac
 * chay lau deu lam thanh status trong tron, va no chay lai rat thuong xuyen.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const LIMITS_CACHE =
  process.env.STATUSLINE_LIMITS_CACHE || path.join(os.homedir(), '.claude', 'statusline-limits.json');

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';

const CONTEXT_COMPACT_THRESHOLD = 80;
const BAR_CELLS = 10;

function readSession() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

function git(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      timeout: 400,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
  } catch {
    return '';
  }
}

function percentOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function severityColor(percentUsed, warnAt, dangerAt) {
  if (percentUsed >= dangerAt) return RED;
  if (percentUsed >= warnAt) return YELLOW;
  return GREEN;
}

function basename(dir) {
  const parts = String(dir).split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '?';
}

function gitSegment(cwd) {
  const status = git(['status', '--porcelain=v2', '--branch'], cwd);
  if (!status) return '';

  let branch = '';
  let ahead = 0;
  let behind = 0;
  let dirty = 0;

  for (const line of status.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      branch = line.slice('# branch.head '.length).trim();
    } else if (line.startsWith('# branch.ab ')) {
      const ab = line.slice('# branch.ab '.length).trim().match(/^\+(\d+)\s+-(\d+)$/);
      if (ab) {
        ahead = Number(ab[1]);
        behind = Number(ab[2]);
      }
    } else if (/^[12u?]\s/.test(line)) {
      dirty += 1;
    }
  }

  if (!branch) return '';
  if (branch === '(detached)') branch = git(['rev-parse', '--short', 'HEAD'], cwd) || 'detached';

  let marks = '';
  if (ahead) marks += `${GREEN}↑${ahead}${RESET}${DIM}`;
  if (behind) marks += `${YELLOW}↓${behind}${RESET}${DIM}`;
  if (dirty) marks += `${YELLOW}●${dirty}${RESET}${DIM}`;

  return `${DIM} ⎇ ${branch}${marks ? ' ' + marks : ''}${RESET}`;
}

function contextSegment(session) {
  const ctx = session.context_window;
  if (!ctx) return '';

  const used = percentOrNull(ctx.used_percentage);
  if (used === null) return '';

  const filled = Math.min(BAR_CELLS, Math.round((used / 100) * BAR_CELLS));
  const bar = '▓'.repeat(filled) + '░'.repeat(BAR_CELLS - filled);
  const color = severityColor(used, 60, CONTEXT_COMPACT_THRESHOLD);

  const size = Number(ctx.context_window_size);
  const scale = Number.isFinite(size) && size >= 1000000 ? `${DIM}1M${RESET}` : '';

  return ` ${color}${bar} ${used}%${RESET}${scale ? ' ' + scale : ''}`;
}

function countdown(epochSeconds) {
  if (epochSeconds === null || epochSeconds === undefined) return '';
  const secondsLeft = Number(epochSeconds) - Math.floor(Date.now() / 1000);
  if (!Number.isFinite(secondsLeft) || secondsLeft <= 0) return '';
  const hours = Math.floor(secondsLeft / 3600);
  const minutes = Math.floor((secondsLeft % 3600) / 60);
  return hours ? `${hours}h${String(minutes).padStart(2, '0')}m` : `${minutes}m`;
}

function windowSegment(fallbackLabel, window, useCountdownAsLabel) {
  if (!window) return '';
  const used = percentOrNull(window.used_percentage);
  if (used === null) return '';

  const color = severityColor(used, 50, 80);
  const label = (useCountdownAsLabel && countdown(window.resets_at)) || fallbackLabel;

  return `${DIM}${label} ${RESET}${color}${used}%${RESET}`;
}

function hasPercent(window) {
  return Boolean(window) && percentOrNull(window.used_percentage) !== null;
}

function stillOpen(window) {
  return hasPercent(window) && Number(window.resets_at) > Math.floor(Date.now() / 1000);
}

/**
 * Every Claude Code session gets rate_limits frozen at ITS last API response, so an
 * idle session reports a stale number while another session (or the website) is
 * already ahead. All sessions run this same script, so they pool observations here.
 * Usage only climbs within a window, so max() is the freshest truth; a larger
 * resets_at means the window rolled over and the count restarted.
 */
function freshest(cached, live) {
  if (!stillOpen(live)) {
    if (stillOpen(cached)) return cached;
    return hasPercent(live) ? live : null;
  }
  if (!stillOpen(cached)) return live;

  const liveReset = Number(live.resets_at);
  const cachedReset = Number(cached.resets_at);
  if (liveReset !== cachedReset) return liveReset > cachedReset ? live : cached;

  return Number(live.used_percentage) >= Number(cached.used_percentage) ? live : cached;
}

function pooledLimits(session) {
  const live = session.rate_limits || {};
  let cached = {};
  try {
    cached = JSON.parse(fs.readFileSync(LIMITS_CACHE, 'utf8'));
  } catch {}

  const pooled = {
    five_hour: freshest(cached.five_hour, live.five_hour),
    seven_day: freshest(cached.seven_day, live.seven_day),
  };

  const persistable = {};
  if (stillOpen(pooled.five_hour)) persistable.five_hour = pooled.five_hour;
  if (stillOpen(pooled.seven_day)) persistable.seven_day = pooled.seven_day;

  if (Object.keys(persistable).length) {
    try {
      const tmp = `${LIMITS_CACHE}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(persistable));
      fs.renameSync(tmp, LIMITS_CACHE);
    } catch {}
  }

  return pooled;
}

function limitsSegment(session) {
  const limits = pooledLimits(session);
  const parts = [
    windowSegment('5h', limits.five_hour, true),
    windowSegment('7d', limits.seven_day, false),
  ].filter(Boolean);
  return parts.length ? ` ${DIM}·${RESET} ${parts.join(`${DIM} · ${RESET}`)}` : '';
}

function main() {
  const session = readSession();
  const cwd = session.workspace?.current_dir || session.cwd || process.cwd();

  const model = session.model?.display_name || '?';
  const effort = session.effort?.level ? `${DIM}·${session.effort.level}${RESET}` : '';
  const fast = session.fast_mode ? `${DIM}·fast${RESET}` : '';

  let out = `${DIM}${model}${RESET}${effort}${fast} ${basename(cwd)}`;
  out += gitSegment(cwd);

  const context = contextSegment(session);
  if (context) out += `${DIM} │${RESET}${context}`;
  out += limitsSegment(session);

  process.stdout.write(out + '\n');
}

try {
  main();
} catch {
  process.stdout.write('\n');
}
