#!/usr/bin/env node
/**
 * Test cho statusline.cjs — ba hop dong khong duoc pha:
 *   1. KHONG dong nao tran be ngang pane (tran la Claude Code cat duoi dong, ma duoi
 *      dong la % context va rate limit).
 *   2. Duong dan va ten session KHONG bao gio bi cat bang `…` khi con cach xuong dong
 *      duoc — ghep cac dong lai phai ra dung chuoi goc.
 *   3. Dau git va canh bao MERGE khong bao gio bi bo.
 *
 * Fuzz ca dai 4→200 cot chu khong chi vai mau: bug be ngang chi lo ra o vai cot le loi.
 *
 * Chay:  node statusline-test.cjs   (hoac: bun statusline-test.cjs)
 */
'use strict';
const assert = require('assert');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, 'statusline.cjs');
const { tildePath, wrapPath, wrapWords, placeLines, statusLines, sessionLabel, visibleWidth } = require(SCRIPT);

const RESERVED_COLUMNS = 3;
const ESC = String.fromCharCode(27);
const strip = (text) => text.replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    console.error(`FAIL  ${name}\n      ${err.message}`);
    process.exitCode = 1;
  }
}

const HOME = os.homedir();
const PATHS = [
  `${HOME}/Project/gitlab/wishlist`,
  `${HOME}/Project/gitlab/wishlist-mr84-r4`,
  `${HOME}/Project/gitlab/wishlist/.claude/worktrees/agent-a12e792080a6ba3e3`,
  `${HOME}/x`,
  HOME,
  '/opt/homebrew/var/log',
  '/',
];
const GITS = [
  null,
  { branch: 'master', ahead: 0, behind: 0, dirty: 6, detached: false, linked: false, operation: '' },
  { branch: 'fix/dev-zone-icon-position-product-card', ahead: 2, behind: 115, dirty: 3, detached: false, linked: true, operation: '' },
  { branch: 'bd928856', ahead: 0, behind: 0, dirty: 0, detached: true, linked: true, operation: '' },
  { branch: 'feat/x', ahead: 0, behind: 0, dirty: 1, detached: false, linked: false, operation: 'MERGE' },
];
const rooms = [];
for (let c = 4; c <= 200; c += 1) rooms.push(c - RESERVED_COLUMNS);

test('tildePath thu gon home, giu nguyen path ngoai home', () => {
  assert.strictEqual(tildePath(HOME), '~');
  assert.strictEqual(tildePath(`${HOME}/Project/gitlab/wishlist`), '~/Project/gitlab/wishlist');
  assert.strictEqual(tildePath('/opt/homebrew'), '/opt/homebrew');
  assert.strictEqual(tildePath(`${HOME}x/trap`), `${HOME}x/trap`);
});

test('wrapPath: ghep cac dong lai ra DUNG duong dan goc, khong mat mot ky tu', () => {
  for (const p of PATHS) {
    const display = tildePath(p);
    for (const room of rooms) {
      const lines = wrapPath(display, room);
      const joined = lines.join('');
      if (joined.includes('…')) continue;
      assert.strictEqual(joined, display, `room=${room} path=${display} -> ${JSON.stringify(lines)}`);
    }
  }
});

test('wrapPath: khong dong nao tran, va khong cat bang … khi con du 3 dong', () => {
  for (const p of PATHS) {
    const display = tildePath(p);
    for (const room of rooms) {
      const lines = wrapPath(display, room);
      for (const line of lines) {
        assert.ok(Array.from(line).length <= room, `room=${room} tran: ${JSON.stringify(line)}`);
      }
      if (Array.from(display).length <= room * 3) {
        assert.ok(!lines.join('').includes('…'), `room=${room} cat oan ${display}: ${JSON.stringify(lines)}`);
      }
    }
  }
});

test('wrapPath cat o dau `/`, dau `/` o lai cuoi dong tren', () => {
  const lines = wrapPath('~/Project/gitlab/wishlist/.claude/worktrees/agent-a12e792080a6ba3e3', 43);
  assert.deepStrictEqual(lines, ['~/Project/gitlab/wishlist/.claude/', 'worktrees/agent-a12e792080a6ba3e3']);
});

test('wrapWords: ten session xuong dong o khoang trang, khong cat chu', () => {
  assert.deepStrictEqual(wrapWords('MR !84 backfill review slice 2', 27, 2), ['MR !84 backfill review', 'slice 2']);
  assert.deepStrictEqual(wrapWords('Brief Slack bug', 43, 2), ['Brief Slack bug']);
  for (const room of rooms) {
    for (const line of wrapWords('MR !84 backfill review slice 2', room, 2)) {
      assert.ok(visibleWidth(line) <= room, `room=${room} tran: ${JSON.stringify(line)}`);
    }
  }
});

test('placeLines khong tran o moi be ngang', () => {
  for (const p of PATHS) {
    for (const git of GITS) {
      for (const room of rooms) {
        for (const line of placeLines(tildePath(p), git, room)) {
          assert.ok(
            visibleWidth(line) <= room,
            `room=${room} path=${p} branch=${git && git.branch} -> rong ${visibleWidth(line)}: ${JSON.stringify(line)}`
          );
          assert.ok(!/[\u0000-\u001f\u007f]/.test(strip(line)), 'lot control char');
        }
      }
    }
  }
});

test('placeLines giu duong dan NGUYEN VEN, khong `…` o giua', () => {
  for (const p of PATHS) {
    const display = tildePath(p);
    for (const room of rooms) {
      if (Array.from(display).length > room * 3) continue;
      const shown = placeLines(display, GITS[1], room)
        .map(strip)
        .join('')
        .split(' ')[0];
      assert.ok(shown.startsWith(display), `room=${room} ${display} -> ${shown}`);
    }
  }
});

test('placeLines khong bao gio bo canh bao MERGE', () => {
  for (const room of rooms) {
    const out = placeLines(tildePath(PATHS[1]), GITS[4], room).join(' ');
    if (room >= 12) assert.ok(out.includes('MERGE'), `room=${room} mat MERGE: ${JSON.stringify(out)}`);
  }
});

function statusParts(overrides) {
  return Object.assign(
    {
      model: 'Opus 5',
      identity: 'Brief MR84 re-review',
      context: { used: 51, scale: '1M', color: '' },
      limits: {
        five_hour: { used_percentage: 14, resets_at: Math.floor(Date.now() / 1000) + 11400 },
        seven_day: { used_percentage: 57, resets_at: Math.floor(Date.now() / 1000) + 400000 },
      },
    },
    overrides
  );
}

test('statusLines khong tran o moi be ngang', () => {
  const shapes = [statusParts(), statusParts({ identity: '' }), statusParts({ context: null }), statusParts({ limits: {} })];
  for (const room of rooms) {
    for (const parts of shapes) {
      for (const line of statusLines(parts, room)) {
        assert.ok(visibleWidth(line) <= room, `room=${room} -> rong ${visibleWidth(line)}: ${JSON.stringify(line)}`);
      }
    }
  }
});

test('ten session KHONG bi cat bang … khi con cho xuong dong', () => {
  const parts = statusParts({ identity: 'MR !84 backfill review slice 2' });
  for (const room of rooms) {
    if (room < 22) continue;
    const out = statusLines(parts, room).map(strip).join(' ');
    assert.ok(!out.includes('…'), `room=${room} cat ten: ${JSON.stringify(out)}`);
  }
});

test('statusLines giu % context va ca hai rate limit den tan pane hep nhat', () => {
  for (const room of rooms) {
    const out = statusLines(statusParts(), room).join(' ');
    if (room >= 20) {
      assert.ok(out.includes('51%'), `room=${room} mat % context: ${JSON.stringify(out)}`);
      assert.ok(out.includes('14%') && out.includes('57%'), `room=${room} mat rate limit: ${JSON.stringify(out)}`);
    }
  }
});

test('context null thi an segment, khong roi ve 0%', () => {
  const out = statusLines(statusParts({ context: null }), 100).join(' ');
  assert.ok(!out.includes('0%'), `bao lao context rong: ${JSON.stringify(out)}`);
});

test('sessionLabel strip control char va escape ANSI', () => {
  assert.strictEqual(sessionLabel({ session_name: 'a\nb' }, '/x/y'), 'a b');
  assert.strictEqual(sessionLabel({ session_name: `${ESC}[31mred` }, '/x/y'), '[31mred');
  assert.strictEqual(sessionLabel({ session_name: '   ' }, '/x/y'), 'y');
  assert.strictEqual(sessionLabel({}, '/x/y'), 'y');
});

function run(payload, columns) {
  return execFileSync('node', [SCRIPT], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      STATUSLINE_COLUMNS: String(columns),
      STATUSLINE_LIMITS_CACHE: path.join(os.tmpdir(), 'statusline-test-limits.json'),
    }),
  });
}

const SESSION = {
  session_name: 'Brief MR84 re-review',
  model: { display_name: 'Opus 5 (1M context)' },
  effort: { level: 'max' },
  context_window: { used_percentage: 51, context_window_size: 1000000 },
};

test('pane rong in dung 2 dong', () => {
  const out = run(Object.assign({ workspace: { current_dir: process.cwd() } }, SESSION), 160);
  assert.ok(out.endsWith('\n'), 'thieu newline cuoi');
  assert.strictEqual(out.split('\n').length - 1, 2, `khong phai 2 dong: ${JSON.stringify(out)}`);
});

test('pane hep tach them dong chu khong tran', () => {
  for (const columns of [60, 46, 34, 24, 12]) {
    const out = run(
      { session_name: 'MR !84 backfill review slice 2', workspace: { current_dir: process.cwd() }, context_window: { used_percentage: 10 } },
      columns
    );
    const lines = out.split('\n').slice(0, -1);
    assert.ok(lines.length >= 2, `${columns} cot chi ra ${lines.length} dong`);
    for (const line of lines) {
      assert.ok(visibleWidth(line) <= columns - RESERVED_COLUMNS, `${columns} cot tran: ${JSON.stringify(line)}`);
    }
  }
});

test('ten session chua newline hoac ANSI khong pha duoc so dong', () => {
  for (const name of ['a\nb\nc', `${ESC}[31mred${ESC}[0m`, 'x\r\ty', 'z'.repeat(400)]) {
    const out = run({ session_name: name, workspace: { current_dir: process.cwd() }, context_window: { used_percentage: 10 } }, 60);
    const lines = out.split('\n').slice(0, -1);
    assert.ok(lines.length >= 2 && lines.length <= 6, `ten ${JSON.stringify(name.slice(0, 20))} ra ${lines.length} dong`);
    for (const line of lines) {
      assert.ok(visibleWidth(line) <= 60 - RESERVED_COLUMNS, `tran: ${JSON.stringify(line)}`);
    }
  }
});

test('stdin rong hoac rac van khong throw', () => {
  for (const payload of ['', 'not json', '[]', 'null']) {
    const out = run(payload, 80);
    assert.ok(out.endsWith('\n'), `payload ${JSON.stringify(payload)} khong in gi`);
  }
});

test('dong NOI hien thu muc that cua session', () => {
  const out = run({ workspace: { current_dir: process.cwd() }, context_window: { used_percentage: 10 } }, 160);
  assert.ok(strip(out.split('\n')[0]).includes(path.basename(process.cwd())), `dong 1 khong co thu muc: ${JSON.stringify(out)}`);
});

if (process.exitCode) console.error(`\n${passed} pass, co case FAIL.`);
else console.log(`statusline: ${passed} test pass.`);
