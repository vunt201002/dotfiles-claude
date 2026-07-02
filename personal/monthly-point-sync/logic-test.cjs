#!/usr/bin/env node
/**
 * Standalone logic test cho Code.gs — nạp CHÍNH file Code.gs vào sandbox node:vm
 * với mock các service Apps Script (SpreadsheetApp / PropertiesService / UrlFetchApp /
 * Utilities / Logger). Không mạng, không đụng Google thật.
 *
 * Chạy:  node logic-test.cjs   (hoặc: bun logic-test.cjs)
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8');
const ME = '168cd13f-884c-4138-bcec-bbc6ed47ea34';
const DS1 = '25ab0da4-49f1-817c-903b-000b9aa2443b';
const DS2 = '74bfb6cb-c769-4121-b1ec-887b2765d625';

// ---------------- mock Sheets ----------------
const MAXR = 200, MAXC = 12;
class MockRange {
  constructor(sheet, row, col, nr, nc) { this.s = sheet; this.r = row; this.c = col; this.nr = nr; this.nc = nc; }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) row.push(this.s.data[this.r - 1 + i][this.c - 1 + j]);
      out.push(row);
    }
    return out;
  }
  setValues(v) {
    for (let i = 0; i < this.nr; i++)
      for (let j = 0; j < this.nc; j++) this.s.data[this.r - 1 + i][this.c - 1 + j] = v[i][j];
    return this;
  }
  getValue() { return this.s.data[this.r - 1][this.c - 1]; }
  setValue(v) { this.s.data[this.r - 1][this.c - 1] = v; return this; }
}
class MockSheet {
  constructor(name) {
    this.name = name; this.hidden = false;
    this.data = Array.from({ length: MAXR }, () => Array(MAXC).fill(''));
  }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  showSheet() { this.hidden = false; return this; }
  hideSheet() { this.hidden = true; return this; }
  getRange(a, b, c, d) {
    if (typeof a === 'string') {
      if (a === 'A2:A') return new MockRange(this, 2, 1, MAXR - 1, 1);
      throw new Error('A1 notation chưa mock: ' + a);
    }
    return new MockRange(this, a, b, c === undefined ? 1 : c, d === undefined ? 1 : d);
  }
  getLastRow() {
    for (let i = MAXR - 1; i >= 0; i--)
      if (this.data[i].some(v => v !== '' && v !== null)) return i + 1;
    return 0;
  }
  clearContents() { this.data = Array.from({ length: MAXR }, () => Array(MAXC).fill('')); }
  copyTo(ss) { const c = new MockSheet('Copy of ' + this.name); c.data = this.data.map(r => r.slice()); ss.sheets.push(c); return c; }
  dataRowCount() { // helper riêng cho test: số dòng data (từ row 2, cột A)
    let n = 0;
    for (let i = 1; i < MAXR; i++) if (this.data[i][0] !== '' && this.data[i][0] !== null) n++;
    return n;
  }
}
class MockSS {
  constructor() { this.sheets = []; this.toasts = []; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  getSheets() { return this.sheets.slice(); }
  insertSheet(n) { const s = new MockSheet(n); this.sheets.push(s); return s; }
  setActiveSheet() {} moveActiveSheet() {}
  toast(msg, title) { this.toasts.push({ title: title || '', msg: msg }); }
}
class MockUi {
  constructor() { this.alerts = []; this.menus = []; }
  alert(msg) { this.alerts.push(msg); }
  createMenu(title) {
    const ui = this, menu = { title: title, items: [] };
    const b = {
      addItem(label, fn) { menu.items.push({ label, fn }); return b; },
      addSeparator() { menu.items.push({ sep: true }); return b; },
      addToUi() { ui.menus.push(menu); },
    };
    return b;
  }
}

// ---------------- sandbox ----------------
// opts: { nowMonth: 'MM/yyyy', props?: {..}, pages?: {dsId: [page..]}, ss?: MockSS }
function makeEnv(opts) {
  const props = Object.assign({ NOTION_TOKEN: 'ntn_test' }, opts.props || {});
  const ss = opts.ss || new MockSS();
  if (!ss.getSheetByName('_TEMPLATE')) ss.insertSheet('_TEMPLATE');
  const ui = new MockUi();
  const logs = [];
  const sandbox = {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); },
      deleteProperty: k => { delete props[k]; },
    }) },
    Session: { getScriptTimeZone: () => 'Asia/Ho_Chi_Minh' },
    Utilities: { formatDate: (d, tz, fmt) => {
      if (fmt !== 'MM/yyyy') throw new Error('format chưa mock: ' + fmt);
      return opts.nowMonth;
    } },
    Logger: { log: (...a) => logs.push(a.map(String).join(' ')) },
    UrlFetchApp: { fetch: (url) => {
      const m = url.match(/data_sources\/([^/]+)\/query/);
      const pages = (opts.pages && opts.pages[m[1]]) || [];
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ results: pages, has_more: false }) };
    } },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, getUi: () => ui },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => {} }) }) }) },
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { sandbox, props, ss, ui, logs };
}

function page(id, name, status, point, role) {
  return { id: id, url: 'https://notion.so/' + id, properties: {
    'Task name': { title: [{ plain_text: name }] },
    'Status': status ? { status: { name: status } } : { status: null },
    'Size card': { number: point },
    'Developer': { people: (role === 'Dev' || role === 'both') ? [{ id: ME }] : [] },
    'Reviewer': { people: (role === 'Reviewer' || role === 'both') ? [{ id: ME }] : [] },
  } };
}

// ---------------- harness ----------------
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + ' — ' + e.message); }
}
function eq(a, b, what) {
  if (a !== b) throw new Error((what || 'eq') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a));
}
function ok(v, what) { if (!v) throw new Error(what || 'expected truthy'); }

// ---------------- tests ----------------
console.log('— Sanity —');
t('WATCH_SOURCES trong Code.gs khớp với hằng số của test', () => {
  const { sandbox } = makeEnv({ nowMonth: '07/2026' });
  eq(sandbox.WATCH_SOURCES[0], DS1); eq(sandbox.WATCH_SOURCES[1], DS2);
});

console.log('— Month resolution (ghim tháng) —');
t('không ghim → tháng lịch', () => {
  const { sandbox } = makeEnv({ nowMonth: '07/2026' });
  eq(sandbox.activeMonth_(), '07/2026');
});
t('ghim tháng liền trước → dùng tháng ghim', () => {
  const { sandbox } = makeEnv({ nowMonth: '07/2026', props: { ACTIVE_MONTH: '06/2026' } });
  eq(sandbox.activeMonth_(), '06/2026');
});
t('ghim = tháng lịch → tháng lịch (no-op)', () => {
  const { sandbox } = makeEnv({ nowMonth: '07/2026', props: { ACTIVE_MONTH: '07/2026' } });
  eq(sandbox.activeMonth_(), '07/2026');
});
t('ghim stale (2 tháng trước) → bỏ qua, dùng tháng lịch', () => {
  const { sandbox, logs } = makeEnv({ nowMonth: '07/2026', props: { ACTIVE_MONTH: '05/2026' } });
  eq(sandbox.activeMonth_(), '07/2026');
  ok(logs.some(l => l.indexOf('stale') !== -1), 'có log stale');
});
t('ghim tháng tương lai → bỏ qua', () => {
  const { sandbox } = makeEnv({ nowMonth: '07/2026', props: { ACTIVE_MONTH: '08/2026' } });
  eq(sandbox.activeMonth_(), '07/2026');
});
t('ghim sai định dạng ("6/2026") → bỏ qua', () => {
  const { sandbox } = makeEnv({ nowMonth: '07/2026', props: { ACTIVE_MONTH: '6/2026' } });
  eq(sandbox.activeMonth_(), '07/2026');
});
t('prevMonth_ giữa năm: 07/2026 → 06/2026', () => {
  const { sandbox } = makeEnv({ nowMonth: '07/2026' });
  eq(sandbox.prevMonth_(), '06/2026');
});
t('prevMonth_ qua năm: 01/2026 → 12/2025', () => {
  const { sandbox } = makeEnv({ nowMonth: '01/2026' });
  eq(sandbox.prevMonth_(), '12/2025');
});
t('prevMonth_ giữ số 0 đầu: 10/2026 → 09/2026', () => {
  const { sandbox } = makeEnv({ nowMonth: '10/2026' });
  eq(sandbox.prevMonth_(), '09/2026');
});
t('ghim 12/2025 khi lịch là 01/2026 → hợp lệ (qua năm)', () => {
  const { sandbox } = makeEnv({ nowMonth: '01/2026', props: { ACTIVE_MONTH: '12/2025' } });
  eq(sandbox.activeMonth_(), '12/2025');
});

console.log('— Add path —');
t('firstRun chỉ ghi baseline, không add', () => {
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'Done', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', pages });
  const r = env.sandbox.syncNow();
  eq(r.baseline, 1, 'baseline'); eq(r.added, 0, 'added');
  ok(!env.ss.getSheetByName('07/2026'), 'không tạo tab tháng');
});
t('bắt được cross → add vào tab tháng lịch, đủ 7 cột', () => {
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'In progress', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', pages });
  env.sandbox.syncNow(); // baseline: In progress
  pages[DS1][0] = page('p1', 'Task A', 'Ready to Test', 3, 'Dev');
  const r = env.sandbox.syncNow();
  eq(r.added, 1, 'added'); eq(r.month, '07/2026', 'month trả về');
  const sh = env.ss.getSheetByName('07/2026'); ok(sh, 'tab 07/2026 tồn tại');
  const row = sh.getRange(2, 1, 1, 7).getValues()[0];
  eq(row[0], 'Task A'); eq(row[1], 'Ready to Test'); eq(row[2], 3);
  eq(row[3], 'Dev'); eq(row[4], false, 'Have mặc định false'); eq(row[6], 'p1', 'pid');
});
t('GHIM: cross → add vào tab tháng ghim, KHÔNG tạo tab tháng lịch', () => {
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'In progress', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', props: { ACTIVE_MONTH: '06/2026' }, pages });
  env.sandbox.syncNow();
  pages[DS1][0] = page('p1', 'Task A', 'Ready to Test', 3, 'Dev');
  const r = env.sandbox.syncNow();
  eq(r.added, 1); eq(r.month, '06/2026');
  ok(env.ss.getSheetByName('06/2026'), 'có tab 06/2026');
  ok(!env.ss.getSheetByName('07/2026'), 'không có tab 07/2026');
  eq(env.ss.getSheetByName('06/2026').getRange(2, 1).getValue(), 'Task A');
});
t('chưa counted → waiting, không add', () => {
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'In progress', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', pages });
  env.sandbox.syncNow();
  const r = env.sandbox.syncNow(); // vẫn In progress
  eq(r.added, 0); eq(r.waiting, 1);
});
t('counted từ baseline, không thấy cross → không add (chờ quét bù)', () => {
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'Done', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', pages });
  env.sandbox.syncNow(); // baseline: Done
  const r = env.sandbox.syncNow();
  eq(r.added, 0); eq(r.waiting, 1);
});
t('quét bù kéo task counted bị sót vào tháng GHIM + alert in đúng tháng', () => {
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'Done', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', props: { ACTIVE_MONTH: '06/2026' }, pages });
  env.sandbox.syncNow(); // baseline
  const r = env.sandbox.backfillCounted();
  eq(r.added, 1); eq(r.month, '06/2026');
  ok(env.ss.getSheetByName('06/2026'), 'row vào tab ghim');
  ok(env.ui.alerts[0].indexOf('06/2026') !== -1, 'alert nêu tháng đang tính: ' + env.ui.alerts[0]);
});
t('quét bù idempotent: bấm lại chỉ update, không thêm dòng', () => {
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'Done', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', pages });
  env.sandbox.syncNow();
  env.sandbox.backfillCounted();
  const r2 = env.sandbox.backfillCounted();
  eq(r2.added, 0); eq(r2.updated, 1);
  eq(env.ss.getSheetByName('07/2026').dataRowCount(), 1, 'vẫn 1 dòng');
});
t('Reviewer xử như Dev: cross → add với Role=Reviewer', () => {
  const pages = {}; pages[DS1] = [page('p1', 'Task R', 'In progress', 2, 'Reviewer')];
  const env = makeEnv({ nowMonth: '07/2026', pages });
  env.sandbox.syncNow();
  pages[DS1][0] = page('p1', 'Task R', 'Ready to Test', 2, 'Reviewer');
  const r = env.sandbox.syncNow();
  eq(r.added, 1);
  eq(env.ss.getSheetByName('07/2026').getRange(2, 4).getValue(), 'Reviewer');
});
t('vừa Dev vừa Reviewer → tính Dev', () => {
  const pages = {}; pages[DS1] = [page('p1', 'Task B', 'In progress', 2, 'both')];
  const env = makeEnv({ nowMonth: '07/2026', pages });
  env.sandbox.syncNow();
  pages[DS1][0] = page('p1', 'Task B', 'Ready to Test', 2, 'both');
  env.sandbox.syncNow();
  eq(env.ss.getSheetByName('07/2026').getRange(2, 4).getValue(), 'Dev');
});
t('không phải Dev/Reviewer → bỏ qua hẳn', () => {
  const pages = {}; pages[DS1] = [page('p1', 'Task C', 'Done', 3, null)];
  const env = makeEnv({ nowMonth: '07/2026', pages });
  const r = env.sandbox.syncNow();
  eq(r.added + r.updated + r.baseline + r.waiting, 0, 'không đếm gì cả');
});
t('data source thứ hai cũng được quét', () => {
  const pages = {}; pages[DS2] = [page('p2', 'Task DS2', 'In progress', 1, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', pages });
  env.sandbox.syncNow();
  pages[DS2][0] = page('p2', 'Task DS2', 'Ready to Test', 1, 'Dev');
  const r = env.sandbox.syncNow();
  eq(r.added, 1);
});
t('add nối vào sau dòng cuối của tab đã có dữ liệu', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const cur = ss.insertSheet('07/2026');
  cur.getRange(2, 1, 1, 7).setValues([['Đã có', 'Done', 1, 'Dev', true, 'link', 'zzz']]);
  const pages = {}; pages[DS1] = [page('p1', 'Task mới', 'Ready to Test', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', pages, ss });
  const r = env.sandbox.syncNow({ backfill: true }); // bỏ qua firstRun để add thẳng
  eq(r.added, 1);
  eq(cur.getRange(3, 1).getValue(), 'Task mới', 'nằm ở row 3');
});
t('add xong chạy lại → update tại chỗ, không re-add', () => {
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'In progress', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', pages });
  env.sandbox.syncNow();
  pages[DS1][0] = page('p1', 'Task A', 'Ready to Test', 3, 'Dev');
  env.sandbox.syncNow(); // add
  pages[DS1][0] = page('p1', 'Task A', 'Done', 3, 'Dev');
  const r = env.sandbox.syncNow(); // phải là update
  eq(r.added, 0); eq(r.updated, 1);
  const sh = env.ss.getSheetByName('07/2026');
  eq(sh.dataRowCount(), 1, 'vẫn 1 dòng');
  eq(sh.getRange(2, 2).getValue(), 'Done', 'status live');
});

console.log('— Update path (rule 1+2: tháng cũ update tại chỗ, Have/Note bất khả xâm phạm) —');
t('pid trùng ở tab cũ → update tại chỗ, không dòng mới, Have + Note giữ nguyên', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const old = ss.insertSheet('05/2026');
  old.getRange(2, 1, 1, 7).setValues([['Task X', 'Testing', 2, 'Dev', true, 'link', 'px']]);
  old.getRange(2, 8).setValue('note của anh');
  const pages = {}; pages[DS1] = [page('px', 'Task X', 'Done', 5, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', pages, ss });
  const r = env.sandbox.syncNow();
  eq(r.updated, 1); eq(r.added, 0);
  const row = old.getRange(2, 1, 1, 8).getValues()[0];
  eq(row[1], 'Done', 'status'); eq(row[2], 5, 'point');
  eq(row[4], true, 'Have giữ nguyên'); eq(row[7], 'note của anh', 'Note giữ nguyên');
  ok(!ss.getSheetByName('07/2026'), 'không tạo tab/dòng mới');
});
t('đang ghim vẫn vậy: pid trùng → update ở nguyên tab cũ', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const old = ss.insertSheet('05/2026');
  old.getRange(2, 1, 1, 7).setValues([['Task X', 'Testing', 2, 'Dev', false, 'link', 'px']]);
  const pages = {}; pages[DS1] = [page('px', 'Task X', 'Done', 2, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', props: { ACTIVE_MONTH: '06/2026' }, pages, ss });
  const r = env.sandbox.syncNow();
  eq(r.updated, 1);
  ok(!ss.getSheetByName('06/2026') && !ss.getSheetByName('07/2026'), 'không tab mới');
});
t('tên đổi trên Notion → cột A được heal', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const old = ss.insertSheet('06/2026');
  old.getRange(2, 1, 1, 7).setValues([['Tên cũ', 'Done', 2, 'Dev', false, 'link', 'px']]);
  const pages = {}; pages[DS1] = [page('px', 'Tên mới', 'Done', 2, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', pages, ss });
  env.sandbox.syncNow();
  eq(old.getRange(2, 1).getValue(), 'Tên mới');
});

console.log('— Nghi trùng (rule 5) —');
t('cùng tên KHÁC id → vẫn add + cờ ⚠ ở cột H nêu đúng tab', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const old = ss.insertSheet('05/2026');
  old.getRange(2, 1, 1, 7).setValues([['Fix cart', 'Done', 2, 'Dev', true, 'link', 'old1']]);
  const pages = {}; pages[DS1] = [page('new2', 'Fix cart', 'Ready to Test', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', pages, ss });
  const r = env.sandbox.syncNow({ backfill: true });
  eq(r.added, 1); eq(r.suspect, 1);
  const note = ss.getSheetByName('07/2026').getRange(2, 8).getValue();
  ok(note.indexOf('Nghi trùng') !== -1 && note.indexOf('05/2026') !== -1, 'cờ: ' + note);
});
t('cùng tên CÙNG id → update, không cờ', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const old = ss.insertSheet('05/2026');
  old.getRange(2, 1, 1, 7).setValues([['Fix cart', 'Testing', 2, 'Dev', false, 'link', 'same1']]);
  const pages = {}; pages[DS1] = [page('same1', 'Fix cart', 'Done', 2, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', pages, ss });
  const r = env.sandbox.syncNow({ backfill: true });
  eq(r.updated, 1); eq(r.suspect, 0);
  eq(old.getRange(2, 8).getValue(), '', 'H vẫn trống');
});

console.log('— Menu / pin actions —');
t('pinPrevMonth ghi ACTIVE_MONTH = tháng liền trước + toast xác nhận', () => {
  const env = makeEnv({ nowMonth: '07/2026' });
  env.sandbox.pinPrevMonth();
  eq(env.props.ACTIVE_MONTH, '06/2026');
  eq(env.ss.toasts.length, 1);
  ok(env.ss.toasts[0].title.indexOf('06/2026') !== -1, env.ss.toasts[0].title);
});
t('unpinMonth xoá ghim + toast xác nhận', () => {
  const env = makeEnv({ nowMonth: '07/2026', props: { ACTIVE_MONTH: '06/2026' } });
  env.sandbox.unpinMonth();
  ok(!('ACTIVE_MONTH' in env.props), 'property đã xoá');
  eq(env.ss.toasts.length, 1);
});
t('onOpen khi GHIM: tên menu mang tháng ghim + toast nhắc', () => {
  const env = makeEnv({ nowMonth: '07/2026', props: { ACTIVE_MONTH: '06/2026' } });
  env.sandbox.onOpen();
  ok(env.ui.menus[0].title.indexOf('06/2026') !== -1, 'title: ' + env.ui.menus[0].title);
  eq(env.ss.toasts.length, 1, 'có toast nhắc');
  ok(env.ss.toasts[0].msg.indexOf('06/2026') !== -1 && env.ss.toasts[0].msg.indexOf('07/2026') !== -1,
     'toast nêu cả 2 tháng');
});
t('onOpen không ghim: menu mang tháng lịch, KHÔNG toast', () => {
  const env = makeEnv({ nowMonth: '07/2026' });
  env.sandbox.onOpen();
  ok(env.ui.menus[0].title.indexOf('07/2026') !== -1, 'title: ' + env.ui.menus[0].title);
  eq(env.ss.toasts.length, 0, 'không toast');
});
t('onOpen: label 2 nút ghim/gỡ tự điền đúng tháng', () => {
  const env = makeEnv({ nowMonth: '07/2026' });
  env.sandbox.onOpen();
  const labels = env.ui.menus[0].items.filter(i => !i.sep).map(i => i.label);
  ok(labels.some(l => l.indexOf('tháng trước (06/2026)') !== -1), 'nút ghim: ' + labels.join(' | '));
  ok(labels.some(l => l.indexOf('tháng lịch (07/2026)') !== -1), 'nút gỡ: ' + labels.join(' | '));
});
t('onOpen ghim stale: menu quay về tháng lịch (guard chạy cả ở UI)', () => {
  const env = makeEnv({ nowMonth: '09/2026', props: { ACTIVE_MONTH: '06/2026' } });
  env.sandbox.onOpen();
  ok(env.ui.menus[0].title.indexOf('09/2026') !== -1, 'title: ' + env.ui.menus[0].title);
  eq(env.ss.toasts.length, 0, 'stale bị bỏ qua nên không nhắc ghim');
});

// ---------------- kết quả ----------------
console.log('');
console.log(pass + '/' + (pass + fail) + ' passed' + (fail ? ' — ' + fail + ' FAILED' : ''));
process.exit(fail ? 1 : 0);
