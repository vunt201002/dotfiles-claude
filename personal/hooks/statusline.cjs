#!/usr/bin/env node
/**
 * Claude Code `statusLine` (settings.json key, KHONG phai hook).
 * Hop dong: doc JSON session tren stdin, in nhom NOI (worktree + branch) roi nhom
 * TRANG THAI (ten session + context + rate limit). So dong CO GIAN theo be ngang pane:
 * pane rong thi 2 dong, pane hep thi tach ra them chu khong bao gio cat chu bang `…`.
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
const MAX_PATH_LINES = 3;
const MAX_IDENTITY_LINES = 2;
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
 * Moi profile la mot muc chi tiet cua DONG TRANG THAI, giau xuong ngheo. Thu tu nay la
 * thu tu HY SINH: cai nao dung truoc thi mat truoc.
 *
 * Chi nhung thu KHONG mang thong tin rieng cua pane moi duoc nam trong bang nay — ten
 * model va thanh bar giong het nhau o moi pane, bo di khong mat gi. Ten session, duong
 * dan, branch thi KHONG bao gio bi cat cho vua: het cho thi xuong dong, vi mot cai ten
 * cut duoi (`Brief MR84 re-rev…`) chinh la thu can doc ma khong doc duoc.
 */
const PROFILES = [
  { model: true, bar: BAR_CELLS, scale: true, tight: false },
  { model: true, bar: BAR_CELLS, scale: false, tight: false },
  { model: true, bar: NARROW_BAR_CELLS, scale: false, tight: false },
  { model: true, bar: NARROW_BAR_CELLS, scale: false, tight: true },
  { model: false, bar: NARROW_BAR_CELLS, scale: false, tight: true },
  { model: false, bar: 0, scale: false, tight: true },
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

/** Duong dan hien thi: `~` cho home, va luon dung `/` ke ca tren Windows. */
function tildePath(dir) {
  const abs = String(dir || '');
  const slashed = abs.split(path.sep).join('/');
  const home = (os.homedir() || '').split(path.sep).join('/');
  if (!home) return slashed;
  if (slashed === home) return '~';
  return slashed.startsWith(home + '/') ? '~' + slashed.slice(home.length) : slashed;
}

/** Chia deu theo be ngang, khong quan tam `/` — luoi cuoi khi cat theo `/` khong du cho. */
function hardWrap(text, room) {
  const chars = Array.from(text);
  const lines = [];
  for (let i = 0; i < chars.length; i += room) lines.push(chars.slice(i, i + room).join(''));
  return lines.length ? lines : [''];
}

/**
 * Duong dan KHONG bao gio bi cat bang `…` khi con vua trong MAX_PATH_LINES dong — het cho
 * thi xuong dong, cat o dau `/` va de dau `/` o cuoi dong tren (dong bat dau bang `/` nhin
 * nhu mot path tuyet doi khac). Ly do: `…` an dung doan phan biet worktree, ma do la ly do
 * duy nhat dong nay ton tai.
 *
 * Cat theo `/` bo phi phan duoi moi dong, nen pane cuc hep co the tran qua so dong cho
 * phep; luc do chia deu (`hardWrap`) — xau hon nhung khong mat mot ky tu nao. Chi khi ca
 * hai deu khong vua moi chiu cat, va cat tu DAU: duoi la phan phan biet.
 */
function wrapPath(display, room) {
  if (room <= 0) return [''];

  const segments = display.split('/');
  const tokens = segments
    .map((seg, i) => (i < segments.length - 1 ? `${seg}/` : seg))
    .filter((token) => token !== '');

  const lines = [];
  let current = '';
  for (const token of tokens) {
    if (!current) current = token;
    else if (Array.from(current + token).length <= room) current += token;
    else {
      lines.push(current);
      current = token;
    }
    while (Array.from(current).length > room) {
      const chars = Array.from(current);
      lines.push(chars.slice(0, room).join(''));
      current = chars.slice(room).join('');
    }
  }
  if (current) lines.push(current);
  if (!lines.length) return [''];
  if (lines.length <= MAX_PATH_LINES) return lines;

  const packed = hardWrap(display, room);
  if (packed.length <= MAX_PATH_LINES) return packed;

  const kept = packed.slice(-MAX_PATH_LINES);
  kept[0] = '…' + Array.from(kept[0]).slice(1).join('');
  return kept;
}

/**
 * Ten session cung khong bi cat: dai qua be ngang pane thi xuong dong o khoang trang.
 * Giu may dong DAU — ten doc tu trai sang, phan dau moi la phan nhan ra pane nao.
 */
function wrapWords(text, room, maxLines) {
  if (room <= 0) return [];
  const words = String(text).split(' ').filter(Boolean);

  const lines = [];
  let current = '';
  for (const word of words) {
    if (!current) current = word;
    else if (Array.from(`${current} ${word}`).length <= room) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
    while (Array.from(current).length > room) {
      const chars = Array.from(current);
      lines.push(chars.slice(0, room).join(''));
      current = chars.slice(room).join('');
    }
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;

  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = clampVisible(lines.slice(maxLines - 1).join(' '), room);
  return kept;
}

/** Chi doan cuoi sang len: quet 4 pane thi mat bam vao ten worktree, khong bam vao `~/Project`. */
function paintPath(text) {
  const cut = text.lastIndexOf('/');
  if (cut < 0) return text;
  return `${DIM}${text.slice(0, cut + 1)}${RESET}${text.slice(cut + 1)}`;
}

/** Be rong lon nhat con vua, do tren dong DA RENDER — cong tay chi phi separator la sai mot ky tu. */
function widest(max, fits) {
  let low = 0;
  let high = max;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(mid)) low = mid;
    else high = mid - 1;
  }
  return low;
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

/** Ten worktree o dong CUOI phai sang; may dong tren chi la duong di, de mo het. */
function paintPathLines(lines) {
  return lines.map((line, i) => (i === lines.length - 1 ? paintPath(line) : `${DIM}${line}${RESET}`));
}

/** Branch chi bi cat khi mot minh no cung khong vua — cat GIUA de giu ca loai nhanh lan phan phan biet. */
function fitGit(info, room) {
  const full = renderGit(info, info && info.branch ? Array.from(info.branch).length : 0);
  if (!full || visibleWidth(full) <= room) return full;
  const width = widest(Array.from(info.branch).length, (w) => visibleWidth(renderGit(info, w)) <= room);
  return renderGit(info, width);
}

/**
 * Dong NOI: dang o worktree nao, tren branch nao. Duong dan la thu duy nhat tra loi
 * "mo cai nao de doc code" — bon lane cua mot repo co the cung ten session mau ma khac
 * checkout, va cung co the KHAC ten session ma cung mot checkout.
 *
 * Branch di theo duong dan tren cung mot dong khi con cho; het cho thi xuong dong rieng
 * chu khong ai bi cat.
 */
function placeLines(display, info, room) {
  const git = fitGit(info, room);
  const lines = paintPathLines(wrapPath(display, room));
  if (!git) return lines;

  const merged = `${lines[lines.length - 1]} ${git}`;
  if (visibleWidth(merged) <= room) {
    lines[lines.length - 1] = merged;
    return lines;
  }
  lines.push(clampVisible(git, room));
  return lines;
}

function compose(parts, profile, withIdentity) {
  const left = [];
  if (profile.model && parts.model) left.push(parts.model);
  if (withIdentity && parts.identity) left.push(parts.identity);

  return (
    left.join(' ') + renderContext(parts.context, profile, left.length > 0) + renderLimits(parts.limits, profile)
  );
}

/**
 * Claude Code export COLUMNS rieng cho tung pane, va tu cat duoi dong khi tran —
 * nghia la thu quan trong nhat (context, rate limit) nam cuoi dong se chet dau tien.
 * Nen o day tu cat lay: tut het thang hy sinh de giu ten session NGUYEN VEN tren mot
 * dong; van khong vua thi ten session xuong dong rieng va thang hy sinh chay lai tu dau
 * cho phan so — luc do thanh bar va ten model thuong quay lai duoc.
 */
function statusLines(parts, room) {
  for (const profile of PROFILES) {
    const line = compose(parts, profile, true);
    if (visibleWidth(line) <= room) return [line];
  }

  const numbers = PROFILES.map((profile) => compose(parts, profile, false)).find(
    (line) => visibleWidth(line) <= room
  );
  const last =
    numbers === undefined ? clampVisible(compose(parts, PROFILES[PROFILES.length - 1], false), room) : numbers;
  return wrapWords(parts.identity, room, MAX_IDENTITY_LINES).concat(last);
}

/**
 * Do tren 10 pane dang chay: session_name khac nhau ca 10, con ten thu muc chi khac 6
 * (bon pane wishlist trung nhau y het). Nen no la thu dinh danh pane, dir chi la du phong
 * cho luc Claude Code chua kip dat ten. Strip control char vi mot ky tu `\n` lot vao la
 * de ra mot dong khong ai kiem soat be ngang.
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
  const room = budget();

  const name = String(session.model?.display_name || '?').replace(/\s*\([^)]*\)\s*$/, '');
  const effort = session.effort?.level ? `${DIM}·${session.effort.level}${RESET}` : '';
  const fast = session.fast_mode ? `${DIM}·fast${RESET}` : '';

  const parts = {
    model: `${DIM}${name}${RESET}${effort}${fast}`,
    identity: sessionLabel(session, cwd),
    context: contextInfo(session),
    limits: pooledLimits(session),
  };

  const lines = placeLines(tildePath(cwd), gitInfo(cwd), room).concat(statusLines(parts, room));
  process.stdout.write(`${lines.join('\n')}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch {
    process.stdout.write('\n');
  }
}

module.exports = { tildePath, wrapPath, wrapWords, placeLines, statusLines, sessionLabel, visibleWidth };
