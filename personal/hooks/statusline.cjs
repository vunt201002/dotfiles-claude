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
const NARROW_BAR_CELLS = 6;
const BRANCH_FLOOR = 12;
const FALLBACK_COLUMNS = 80;
const RESERVED_COLUMNS = 3;
const GITDIR_WALK_LIMIT = 40;

const IN_PROGRESS = [
  ['rebase-merge', 'REBASE'],
  ['rebase-apply', 'REBASE'],
  ['MERGE_HEAD', 'MERGE'],
  ['CHERRY_PICK_HEAD', 'PICK'],
  ['REVERT_HEAD', 'REVERT'],
  ['BISECT_LOG', 'BISECT'],
];

/**
 * Moi profile la mot muc chi tiet, giau xuong ngheo. Thu tu nay la thu tu HY SINH:
 * cai nao dung truoc thi mat truoc. Scale/model di truoc vi chung khong doi theo
 * thoi gian va giong het nhau o moi pane; % context va rate limit khong bao gio bi bo.
 */
const PROFILES = [
  { model: true, id: Infinity, bar: BAR_CELLS, scale: true, tight: false, branch: true },
  { model: true, id: 30, bar: BAR_CELLS, scale: false, tight: false, branch: true },
  { model: true, id: 24, bar: NARROW_BAR_CELLS, scale: false, tight: false, branch: true },
  { model: true, id: 20, bar: NARROW_BAR_CELLS, scale: false, tight: true, branch: true },
  { model: false, id: 20, bar: NARROW_BAR_CELLS, scale: false, tight: true, branch: true },
  { model: false, id: 20, bar: 0, scale: false, tight: true, branch: true },
  { model: false, id: 20, bar: 0, scale: false, tight: true, branch: false },
  { model: false, id: 12, bar: 0, scale: false, tight: true, branch: false },
  { model: false, id: 0, bar: 0, scale: false, tight: true, branch: false },
];

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

/** Be ngang kha dung cua PANE, khong phai cua ca terminal. */
function budget() {
  const raw = Number(process.env.STATUSLINE_COLUMNS || process.env.COLUMNS);
  const columns = Number.isFinite(raw) && raw > 0 ? raw : FALLBACK_COLUMNS;
  return Math.max(1, columns - RESERVED_COLUMNS);
}

function visibleWidth(text) {
  return Array.from(text.replace(/\x1b\[[0-9;]*m/g, '')).length;
}

function clampVisible(text, max) {
  if (visibleWidth(text) <= max) return text;
  let kept = '';
  let used = 0;
  const tokens = text.split(/(\x1b\[[0-9;]*m)/);
  for (const token of tokens) {
    if (token.startsWith('\x1b[')) {
      kept += token;
      continue;
    }
    for (const ch of token) {
      if (used >= max - 1) return `${kept}…${RESET}`;
      kept += ch;
      used += 1;
    }
  }
  return kept + RESET;
}

function truncateEnd(text, max) {
  const chars = Array.from(text);
  if (max <= 0) return '';
  if (chars.length <= max) return text;
  return chars.slice(0, max - 1).join('') + '…';
}

/** Giu dau va duoi: duoi la phan phan biet nhanh, dau la loai nhanh (fix/, feat/). */
function middleTruncate(text, max) {
  const chars = Array.from(text);
  if (max <= 0) return '';
  if (chars.length <= max) return text;
  if (max === 1) return '…';
  const head = Math.max(1, Math.floor((max - 1) * 0.45));
  const tail = max - 1 - head;
  return chars.slice(0, head).join('') + '…' + chars.slice(chars.length - tail).join('');
}

/**
 * Doc thang tren dia thay vi goi `git rev-parse`: 0.02ms so voi ~16ms mot subprocess,
 * va script nay chay lai moi 15s o moi pane. `.git` la thu muc => worktree chinh,
 * la file => worktree phu, trong do co duong dan gitdir that.
 */
function gitLayout(cwd) {
  let dir = path.resolve(cwd);
  for (let i = 0; i < GITDIR_WALK_LIMIT; i += 1) {
    const dot = path.join(dir, '.git');
    let stat = null;
    try {
      stat = fs.statSync(dot);
    } catch {}
    if (stat) {
      if (stat.isDirectory()) return { gitDir: dot, linked: false };
      const pointer = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dot, 'utf8'));
      if (pointer) return { gitDir: pointer[1].trim(), linked: true };
      return null;
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return null;
}

function inProgress(gitDir) {
  for (const [marker, label] of IN_PROGRESS) {
    try {
      fs.accessSync(path.join(gitDir, marker));
      return label;
    } catch {}
  }
  return '';
}

function gitInfo(cwd) {
  const status = git(['status', '--porcelain=v2', '--branch'], cwd);
  if (!status) return null;

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

  if (!branch) return null;

  const detached = branch === '(detached)';
  if (detached) branch = git(['rev-parse', '--short', 'HEAD'], cwd) || 'detached';

  const layout = gitLayout(cwd);
  return {
    branch,
    ahead,
    behind,
    dirty,
    detached,
    linked: Boolean(layout && layout.linked),
    operation: layout ? inProgress(layout.gitDir) : '',
  };
}

function renderGit(info, branchWidth) {
  if (!info) return '';

  let marks = '';
  if (info.ahead) marks += `${GREEN}↑${info.ahead}${RESET}`;
  if (info.behind) marks += `${YELLOW}↓${info.behind}${RESET}`;
  if (info.dirty) marks += `${YELLOW}●${info.dirty}${RESET}`;
  if (info.operation) marks += `${marks ? ' ' : ''}${RED}${info.operation}${RESET}`;

  const branch = middleTruncate(info.branch, branchWidth);
  if (!branch) return marks;

  const mark = info.linked ? '+' : '';
  const glyph = info.detached ? `@${mark}` : `⎇${mark} `;
  return `${DIM}${glyph}${branch}${RESET}${marks ? ' ' + marks : ''}`;
}

function contextInfo(session) {
  const ctx = session.context_window;
  if (!ctx) return null;

  const used = percentOrNull(ctx.used_percentage);
  if (used === null) return null;

  const size = Number(ctx.context_window_size);
  return {
    used,
    scale: Number.isFinite(size) && size >= 1000000 ? '1M' : '',
    color: severityColor(used, 60, CONTEXT_COMPACT_THRESHOLD),
  };
}

function renderContext(info, profile, hasLeft) {
  if (!info) return '';

  let out = hasLeft ? `${DIM} │${RESET} ` : '';
  if (profile.bar > 0) {
    const filled = Math.min(profile.bar, Math.round((info.used / 100) * profile.bar));
    out += `${info.color}${'▓'.repeat(filled)}${'░'.repeat(profile.bar - filled)}${RESET} `;
  }
  out += `${info.color}${info.used}%${RESET}`;
  if (profile.scale && info.scale) out += ` ${DIM}${info.scale}${RESET}`;
  return out;
}

function countdown(epochSeconds) {
  if (epochSeconds === null || epochSeconds === undefined) return '';
  const secondsLeft = Number(epochSeconds) - Math.floor(Date.now() / 1000);
  if (!Number.isFinite(secondsLeft) || secondsLeft <= 0) return '';
  const hours = Math.floor(secondsLeft / 3600);
  const minutes = Math.floor((secondsLeft % 3600) / 60);
  return hours ? `${hours}h${String(minutes).padStart(2, '0')}m` : `${minutes}m`;
}

function windowSegment(fallbackLabel, window, useCountdownAsLabel, tight) {
  if (!window) return '';
  const used = percentOrNull(window.used_percentage);
  if (used === null) return '';

  const color = severityColor(used, 50, 80);
  const label = (useCountdownAsLabel && countdown(window.resets_at)) || fallbackLabel;
  const gap = tight ? '' : ' ';

  return `${DIM}${label}${gap}${RESET}${color}${used}%${RESET}`;
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

function renderLimits(limits, profile) {
  const parts = [
    windowSegment('5h', limits.five_hour, !profile.tight, profile.tight),
    windowSegment('7d', limits.seven_day, false, profile.tight),
  ].filter(Boolean);
  if (!parts.length) return '';
  if (profile.tight) return ' ' + parts.join(' ');
  return ` ${DIM}·${RESET} ` + parts.join(`${DIM} · ${RESET}`);
}

function compose(parts, profile, branchWidth) {
  const left = [];
  if (profile.model && parts.model) left.push(parts.model);
  const identity = truncateEnd(parts.identity, profile.id);
  if (identity) left.push(identity);

  const gitText = renderGit(parts.git, profile.branch ? branchWidth : 0);
  if (gitText) left.push(gitText);

  return (
    left.join(' ') + renderContext(parts.context, profile, left.length > 0) + renderLimits(parts.limits, profile)
  );
}

/** Be ngang cua branch la bien dan hoi: no an het cho con thua o profile giau nhat con vua. */
function widestBranchThatFits(parts, profile, max, room) {
  let low = 0;
  let high = max;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (visibleWidth(compose(parts, profile, mid)) <= room) low = mid;
    else high = mid - 1;
  }
  return low;
}

/**
 * Claude Code export COLUMNS rieng cho tung pane, va tu cat duoi dong khi tran —
 * nghia la thu quan trong nhat (context, rate limit) nam cuoi dong se chet dau tien.
 * Nen o day tu cat lay: chon profile giau nhat ma van vua, va khong bao gio de tran.
 */
function fit(parts) {
  const room = budget();
  const fullBranch = parts.git ? Array.from(parts.git.branch).length : 0;

  let fallback = null;
  for (const profile of PROFILES) {
    const wantsBranch = profile.branch && fullBranch > 0;
    const branchWidth = wantsBranch ? widestBranchThatFits(parts, profile, fullBranch, room) : 0;
    if (!wantsBranch || branchWidth >= Math.min(fullBranch, BRANCH_FLOOR)) {
      const line = compose(parts, profile, branchWidth);
      if (visibleWidth(line) <= room) return line;
    }
    if (!fallback) {
      const bare = compose(parts, profile, 0);
      if (visibleWidth(bare) <= room) fallback = bare;
    }
  }

  const last = PROFILES[PROFILES.length - 1];
  return clampVisible(fallback || compose(parts, last, 0), room);
}

/**
 * Do tren 10 pane dang chay: session_name khac nhau ca 10, con ten thu muc chi khac 6
 * (bon pane wishlist trung nhau y het). Nen no la thu dinh danh pane, dir chi la du phong
 * cho luc Claude Code chua kip dat ten. Strip control char vi hop dong la DUNG 1 dong.
 */
function sessionLabel(session, cwd) {
  const raw = typeof session.session_name === 'string' ? session.session_name : '';
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || basename(cwd);
}

function main() {
  const session = readSession();
  const cwd = session.workspace?.current_dir || session.cwd || process.cwd();

  const name = String(session.model?.display_name || '?').replace(/\s*\([^)]*\)\s*$/, '');
  const effort = session.effort?.level ? `${DIM}·${session.effort.level}${RESET}` : '';
  const fast = session.fast_mode ? `${DIM}·fast${RESET}` : '';

  const parts = {
    model: `${DIM}${name}${RESET}${effort}${fast}`,
    identity: sessionLabel(session, cwd),
    git: gitInfo(cwd),
    context: contextInfo(session),
    limits: pooledLimits(session),
  };

  process.stdout.write(fit(parts) + '\n');
}

try {
  main();
} catch {
  process.stdout.write('\n');
}
