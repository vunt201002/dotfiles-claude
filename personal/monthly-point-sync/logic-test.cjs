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
const DASHBOARD_NAME = 'Dashboard';
const IN_PROGRESS_NAME = 'Đang xử lý';

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
  // Mock đơn giản hoá: mọi setValue(s) ghi thẳng string (kể cả "=HYPERLINK(...)")
  // vào this.s.data — không phân biệt "giá trị hiển thị" vs "công thức thô" như
  // Sheets thật. getFormulas() vì vậy trả về ĐÚNG same data — đủ cho mục đích test
  // (Code.gs chỉ set Card bằng string HYPERLINK trực tiếp, không dùng setFormula riêng).
  getFormulas() { return this.getValues(); }
  setValues(v) {
    for (let i = 0; i < this.nr; i++)
      for (let j = 0; j < this.nc; j++) this.s.data[this.r - 1 + i][this.c - 1 + j] = v[i][j];
    return this;
  }
  getValue() { return this.s.data[this.r - 1][this.c - 1]; }
  setValue(v) { this.s.data[this.r - 1][this.c - 1] = v; return this; }
  getColumn() { return this.c; }
  copyTo(dest, opts) { // Range.copyTo — mock chỉ ghi nhận đã gọi, không mô phỏng font/màu thật
    dest.s.formatCopiedFrom = dest.s.formatCopiedFrom || [];
    dest.s.formatCopiedFrom.push({ from: this.s.name, opts: opts || {} });
    return this;
  }
  setFontWeight(w) { this.s.fontWeightCalls = this.s.fontWeightCalls || []; this.s.fontWeightCalls.push(w); return this; }
  setWrapStrategy(strategy) {
    this.s.wrapCalls = this.s.wrapCalls || [];
    this.s.wrapCalls.push({ r: this.r, c: this.c, nr: this.nr, nc: this.nc, strategy: strategy });
    return this;
  }
}
// Mock 1 conditional format rule đơn giản: chỉ giữ đủ thông tin để test "rule của
// cột Status được copy sang, rule khác thì bị lọc bỏ" — không mô phỏng điều kiện/màu thật.
class MockCFRule {
  constructor(ranges, tag) { this._ranges = ranges; this.tag = tag; }
  getRanges() { return this._ranges; }
  copy() { return new MockCFRuleBuilder(this.tag); }
}
class MockCFRuleBuilder {
  constructor(tag) { this.tag = tag; this._ranges = []; }
  setRanges(ranges) { this._ranges = ranges; return this; }
  build() { return new MockCFRule(this._ranges, this.tag); }
}
class MockSheet {
  constructor(name) {
    this.name = name; this.hidden = false;
    this.data = Array.from({ length: MAXR }, () => Array(MAXC).fill(''));
    this.cfRules = []; this.frozenRows = 0; this.colWidths = {}; this.hiddenCols = [];
  }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  showSheet() { this.hidden = false; return this; }
  hideSheet() { this.hidden = true; return this; }
  getConditionalFormatRules() { return this.cfRules.slice(); }
  setConditionalFormatRules(rules) { this.cfRules = rules.slice(); return this; }
  setFrozenRows(n) { this.frozenRows = n; return this; }
  setColumnWidth(col, w) { this.colWidths[col] = w; return this; }
  hideColumns(col) { this.hiddenCols.push(col); return this; }
  getRange(a, b, c, d) {
    if (typeof a === 'string') {
      if (a === 'A2:A') return new MockRange(this, 2, 1, MAXR - 1, 1);
      // dạng "<Col><Row>:<Col><Row>" (vd "B2:B1000") — đủ cho các range dùng trong Code.gs
      const m = a.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
      if (m) {
        const colOf = s => s.split('').reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0);
        const r1 = parseInt(m[2], 10), c1 = colOf(m[1]), r2 = Math.min(parseInt(m[4], 10), MAXR), c2 = colOf(m[3]);
        return new MockRange(this, r1, c1, r2 - r1 + 1, c2 - c1 + 1);
      }
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
  deleteRow(r) { this.data.splice(r - 1, 1); this.data.push(Array(MAXC).fill('')); }
  copyTo(ss) { const c = new MockSheet('Copy of ' + this.name); c.data = this.data.map(r => r.slice()); ss.sheets.push(c); return c; }
  dataRowCount() { // helper riêng cho test: số dòng data (từ row 2, cột A)
    let n = 0;
    for (let i = 1; i < MAXR; i++) if (this.data[i][0] !== '' && this.data[i][0] !== null) n++;
    return n;
  }
}
class MockSS {
  constructor() { this.sheets = []; this.toasts = []; this.active = null; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  getSheets() { return this.sheets.slice(); }
  insertSheet(n) { const s = new MockSheet(n); this.sheets.push(s); return s; }
  setActiveSheet(sh) { this.active = sh; }
  moveActiveSheet(pos) {
    if (!this.active) return;
    const i = this.sheets.indexOf(this.active);
    if (i === -1) return;
    this.sheets.splice(i, 1);
    this.sheets.splice(pos, 0, this.active);
  }
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
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, getUi: () => ui, WrapStrategy: { WRAP: 'WRAP' } },
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

console.log('— Dashboard pin —');
t('tạo tab tháng mới → Dashboard vẫn ở index 0, tab tháng mới ở index 1', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE'); ss.insertSheet(DASHBOARD_NAME);
  ss.insertSheet('06/2026'); // tab tháng cũ đã tồn tại trước
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'In progress', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', pages, ss });
  env.sandbox.syncNow(); // baseline
  pages[DS1][0] = page('p1', 'Task A', 'Ready to Test', 3, 'Dev');
  env.sandbox.syncNow(); // add -> tạo tab 07/2026 mới
  const names = ss.getSheets().map(s => s.getName());
  eq(names[0], DASHBOARD_NAME, 'Dashboard ở đầu: ' + names.join(','));
  eq(names[1], '07/2026', 'tab tháng mới ngay sau Dashboard: ' + names.join(','));
});
t('không có tab Dashboard → không lỗi, hành vi cũ giữ nguyên', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'In progress', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', pages, ss });
  env.sandbox.syncNow();
  pages[DS1][0] = page('p1', 'Task A', 'Ready to Test', 3, 'Dev');
  env.sandbox.syncNow();
  ok(ss.getSheetByName('07/2026'), 'tab tháng vẫn được tạo bình thường');
});
t('pinDashboardFirstMenu_: Dashboard bị lệch vị trí → đưa về đầu + toast xác nhận', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  ss.insertSheet('06/2026'); ss.insertSheet(DASHBOARD_NAME); ss.insertSheet('07/2026');
  const env = makeEnv({ nowMonth: '07/2026', ss });
  env.sandbox.pinDashboardFirstMenu_();
  eq(ss.getSheets()[0].getName(), DASHBOARD_NAME);
  eq(env.ss.toasts.length, 1);
  ok(env.ss.toasts[0].msg.indexOf(DASHBOARD_NAME) !== -1, env.ss.toasts[0].msg);
});
t('pinDashboardFirstMenu_: không có tab Dashboard → toast báo không tìm thấy, không lỗi', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const env = makeEnv({ nowMonth: '07/2026', ss });
  env.sandbox.pinDashboardFirstMenu_();
  eq(env.ss.toasts.length, 1);
  ok(env.ss.toasts[0].msg.indexOf('Không tìm thấy') !== -1, env.ss.toasts[0].msg);
});

console.log('— Tab Đang xử lý (mirror sống) —');
t('task cross vào Reviewing → xuất hiện ở Đang xử lý, đủ 5 cột hiển thị', () => {
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'In progress', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', pages });
  env.sandbox.syncNow(); // baseline
  pages[DS1][0] = page('p1', 'Task A', 'Reviewing', 3, 'Dev');
  env.sandbox.syncNow();
  const ip = env.ss.getSheetByName(IN_PROGRESS_NAME);
  ok(ip, 'tab Đang xử lý tự được tạo');
  const row = ip.getRange(2, 1, 1, 5).getValues()[0];
  eq(row[0], 'Task A'); eq(row[1], 'Reviewing'); eq(row[2], 3); eq(row[3], 'Dev');
});
t('task đi thẳng Ready to Test (không thuộc 4 status theo dõi) → KHÔNG vào Đang xử lý', () => {
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'In progress', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', pages });
  env.sandbox.syncNow();
  pages[DS1][0] = page('p1', 'Task A', 'Ready to Test', 3, 'Dev');
  env.sandbox.syncNow();
  const ip = env.ss.getSheetByName(IN_PROGRESS_NAME);
  eq(ip.dataRowCount(), 0, 'Ready to Test không nằm trong IN_PROGRESS_STATUSES');
});
t('status vẫn trong nhóm nhưng đổi (Reviewing -> Testing) → update tại chỗ, không thêm dòng', () => {
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'In progress', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', pages });
  env.sandbox.syncNow();
  pages[DS1][0] = page('p1', 'Task A', 'Reviewing', 3, 'Dev');
  env.sandbox.syncNow();
  pages[DS1][0] = page('p1', 'Task A', 'Testing', 3, 'Dev');
  env.sandbox.syncNow();
  const ip = env.ss.getSheetByName(IN_PROGRESS_NAME);
  eq(ip.dataRowCount(), 1, 'vẫn 1 dòng');
  eq(ip.getRange(2, 2).getValue(), 'Testing', 'status live update');
});
t('task rời nhóm theo dõi (Testing -> Done) → dòng bị XOÁ khỏi Đang xử lý', () => {
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'In progress', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', pages });
  env.sandbox.syncNow();
  pages[DS1][0] = page('p1', 'Task A', 'Testing', 3, 'Dev');
  env.sandbox.syncNow();
  const ip = env.ss.getSheetByName(IN_PROGRESS_NAME);
  eq(ip.dataRowCount(), 1, 'có mặt lúc Testing');
  pages[DS1][0] = page('p1', 'Task A', 'Done', 3, 'Dev');
  env.sandbox.syncNow();
  eq(ip.dataRowCount(), 0, 'biến mất khi Done');
  // dữ liệu THẬT ở tab tháng vẫn còn nguyên, không bị mất
  eq(env.ss.getSheetByName('07/2026').getRange(2, 2).getValue(), 'Done');
});
t('task rời nhóm theo dõi (Test Production -> Launching) → cũng bị XOÁ khỏi Đang xử lý', () => {
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'In progress', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', pages });
  env.sandbox.syncNow();
  pages[DS1][0] = page('p1', 'Task A', 'Test Production', 3, 'Dev');
  env.sandbox.syncNow();
  const ip = env.ss.getSheetByName(IN_PROGRESS_NAME);
  eq(ip.dataRowCount(), 1, 'có mặt lúc Test Production');
  pages[DS1][0] = page('p1', 'Task A', 'Launching', 3, 'Dev');
  env.sandbox.syncNow();
  eq(ip.dataRowCount(), 0, 'biến mất khi Launching — không nằm trong IN_PROGRESS_STATUSES');
  eq(env.ss.getSheetByName('07/2026').getRange(2, 2).getValue(), 'Launching');
});
t('nhiều task rời nhóm cùng lúc → xoá đúng dòng, không lệch index (test splice)', () => {
  const pages = {}; pages[DS1] = [
    page('p1', 'Task A', 'In progress', 1, 'Dev'),
    page('p2', 'Task B', 'In progress', 2, 'Dev'),
    page('p3', 'Task C', 'In progress', 3, 'Dev'),
  ];
  const env = makeEnv({ nowMonth: '07/2026', pages });
  env.sandbox.syncNow();
  pages[DS1] = [
    page('p1', 'Task A', 'Reviewing', 1, 'Dev'),
    page('p2', 'Task B', 'Testing', 2, 'Dev'),
    page('p3', 'Task C', 'Test Production', 3, 'Dev'),
  ];
  env.sandbox.syncNow();
  const ip = env.ss.getSheetByName(IN_PROGRESS_NAME);
  eq(ip.dataRowCount(), 3, 'cả 3 vào Đang xử lý');
  // Task B (giữa) rời nhóm; Task A và Task C phải còn nguyên đúng dữ liệu
  pages[DS1][1] = page('p2', 'Task B', 'Done', 2, 'Dev');
  env.sandbox.syncNow();
  eq(ip.dataRowCount(), 2, 'còn 2 dòng');
  const names = [ip.getRange(2, 1).getValue(), ip.getRange(3, 1).getValue()];
  ok(names.indexOf('Task A') !== -1, 'Task A còn: ' + names.join(','));
  ok(names.indexOf('Task C') !== -1, 'Task C còn: ' + names.join(','));
  ok(names.indexOf('Task B') === -1, 'Task B đã bị xoá: ' + names.join(','));
});
t('task ở TAB THÁNG CŨ cũng được theo dõi (không chỉ tab tháng hiện tại)', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const old = ss.insertSheet('05/2026');
  old.getRange(2, 1, 1, 7).setValues([['Task cũ', 'Testing', 2, 'Dev', false, 'link', 'pold']]);
  const pages = {}; pages[DS1] = [page('pold', 'Task cũ', 'Test Production', 2, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', pages, ss });
  env.sandbox.syncNow();
  const ip = ss.getSheetByName(IN_PROGRESS_NAME);
  eq(ip.dataRowCount(), 1, 'task tab tháng cũ vẫn xuất hiện ở Đang xử lý');
  eq(ip.getRange(2, 2).getValue(), 'Test Production');
});
t('chạy syncNow lặp lại nhiều lần không đổi status → Đang xử lý idempotent, không nhân đôi', () => {
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'In progress', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', pages });
  env.sandbox.syncNow();
  pages[DS1][0] = page('p1', 'Task A', 'Reviewing', 3, 'Dev');
  env.sandbox.syncNow();
  env.sandbox.syncNow();
  env.sandbox.syncNow();
  const ip = env.ss.getSheetByName(IN_PROGRESS_NAME);
  eq(ip.dataRowCount(), 1, 'vẫn đúng 1 dòng sau nhiều lần sync');
});
t('Đang xử lý KHÔNG bị buildIndex_ coi là tab tháng (không ảnh hưởng dedup RULE 1-5)', () => {
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'In progress', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', pages });
  env.sandbox.syncNow();
  pages[DS1][0] = page('p1', 'Task A', 'Reviewing', 3, 'Dev');
  env.sandbox.syncNow();
  // tab Đang xử lý tồn tại nhưng không phải MM/YYYY -> không được buildIndex_ quét,
  // nghĩa là 1 sync tiếp theo không nhầm nó là nơi task đã "có" theo pid.
  ok(!env.sandbox.isMonthTab_(IN_PROGRESS_NAME), 'tên tab không khớp pattern MM/YYYY');
});

console.log('— Đang xử lý: style (header, màu Status, ẩn cột pid) —');
t('tạo tab lần đầu → header bold, freeze row 1, cột pid (F) bị ẩn', () => {
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'In progress', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', pages });
  env.sandbox.syncNow();
  pages[DS1][0] = page('p1', 'Task A', 'Reviewing', 3, 'Dev');
  env.sandbox.syncNow(); // tạo tab Đang xử lý lần đầu ở đây
  const ip = env.ss.getSheetByName(IN_PROGRESS_NAME);
  ok(ip.fontWeightCalls && ip.fontWeightCalls.indexOf('bold') !== -1, 'header set bold');
  eq(ip.frozenRows, 1, 'freeze header row');
  ok(ip.hiddenCols.indexOf(6) !== -1, 'cột F (pid) bị ẩn: ' + ip.hiddenCols.join(','));
});
t('header format được copy từ _TEMPLATE (đồng bộ hình thức tab tháng)', () => {
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'In progress', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', pages });
  env.sandbox.syncNow();
  pages[DS1][0] = page('p1', 'Task A', 'Reviewing', 3, 'Dev');
  env.sandbox.syncNow();
  const ip = env.ss.getSheetByName(IN_PROGRESS_NAME);
  ok(ip.formatCopiedFrom && ip.formatCopiedFrom.some(c => c.from === '_TEMPLATE' && c.opts.formatOnly),
     'có copyTo formatOnly từ _TEMPLATE: ' + JSON.stringify(ip.formatCopiedFrom));
});
t('conditional format rule của cột Status (B) ở _TEMPLATE được copy sang cột B của Đang xử lý', () => {
  const ss = new MockSS();
  const tpl = ss.insertSheet('_TEMPLATE');
  tpl.cfRules = [
    new MockCFRule([{ getColumn: () => 2 }], 'status-color'), // rule cột B (Status)
    new MockCFRule([{ getColumn: () => 5 }], 'have-checkbox'), // rule KHÔNG phải Status
  ];
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'In progress', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', pages, ss });
  env.sandbox.syncNow();
  pages[DS1][0] = page('p1', 'Task A', 'Reviewing', 3, 'Dev');
  env.sandbox.syncNow();
  const ip = ss.getSheetByName(IN_PROGRESS_NAME);
  eq(ip.cfRules.length, 1, 'chỉ 1 rule được mang sang (chỉ rule cột Status)');
  eq(ip.cfRules[0].tag, 'status-color', 'đúng rule Status, không phải rule Have');
  eq(ip.cfRules[0].getRanges()[0].getColumn(), 2, 'rule áp cho đúng cột B ở tab mới');
});
t('conditional format rule của cột Role (D) ở _TEMPLATE cũng được copy sang cột D của Đang xử lý', () => {
  const ss = new MockSS();
  const tpl = ss.insertSheet('_TEMPLATE');
  tpl.cfRules = [
    new MockCFRule([{ getColumn: () => 2 }], 'status-color'),
    new MockCFRule([{ getColumn: () => 4 }], 'role-color'), // rule cột D (Role)
    new MockCFRule([{ getColumn: () => 5 }], 'have-checkbox'),
  ];
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'In progress', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', pages, ss });
  env.sandbox.syncNow();
  pages[DS1][0] = page('p1', 'Task A', 'Reviewing', 3, 'Dev');
  env.sandbox.syncNow();
  const ip = ss.getSheetByName(IN_PROGRESS_NAME);
  eq(ip.cfRules.length, 2, 'Status + Role được mang sang, Have thì không');
  const tags = ip.cfRules.map(r => r.tag).sort();
  eq(tags.join(','), 'role-color,status-color', 'đúng 2 rule: ' + tags.join(','));
  const roleRule = ip.cfRules.find(r => r.tag === 'role-color');
  eq(roleRule.getRanges()[0].getColumn(), 4, 'rule Role áp cho đúng cột D ở tab mới');
});
t('không có _TEMPLATE → vẫn tạo tab + style cơ bản, không lỗi', () => {
  // Task đã có SẴN ở 1 tab tháng (không phải add mới) → đi qua nhánh update pid
  // match, không đụng ensureMonthSheet_ (chỗ DUY NHẤT thật sự cần _TEMPLATE để
  // tạo tab tháng). Cô lập đúng thứ đang test: styleInProgressSheet_ tự chịu
  // được thiếu _TEMPLATE, không phải toàn bộ syncNow.
  const ss = new MockSS();
  const cur = ss.insertSheet('07/2026');
  cur.getRange(2, 1, 1, 7).setValues([['Task A', 'In progress', 3, 'Dev', false, 'link', 'p1']]);
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'Reviewing', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', pages, ss }); // makeEnv tự thêm _TEMPLATE
  ss.sheets = ss.sheets.filter(s => s.getName() !== '_TEMPLATE'); // rồi gỡ đi để test đúng case thiếu
  env.sandbox.syncNow();
  const ip = ss.getSheetByName(IN_PROGRESS_NAME);
  ok(ip, 'tab Đang xử lý vẫn được tạo dù thiếu _TEMPLATE');
  ok(ip.fontWeightCalls.indexOf('bold') !== -1, 'header vẫn bold dù không copy được từ _TEMPLATE');
});
t('tạo tab lần đầu → cột Task (A) được set wrap, giống tab tháng', () => {
  const pages = {}; pages[DS1] = [page('p1', 'Task A dài để cần wrap', 'In progress', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', pages });
  env.sandbox.syncNow();
  pages[DS1][0] = page('p1', 'Task A dài để cần wrap', 'Reviewing', 3, 'Dev');
  env.sandbox.syncNow();
  const ip = env.ss.getSheetByName(IN_PROGRESS_NAME);
  ok(ip.wrapCalls && ip.wrapCalls.length === 1, 'gọi setWrapStrategy đúng 1 lần: ' + JSON.stringify(ip.wrapCalls));
  const call = ip.wrapCalls[0];
  eq(call.c, 1, 'áp dụng cho cột A (Task)');
  eq(call.r, 2, 'bắt đầu từ dòng data (row 2), không đụng header');
  eq(call.strategy, 'WRAP', 'đúng WrapStrategy.WRAP');
});
t('tạo tab CHỈ 1 lần — sync các lần sau không style lại (không tốn thêm API call)', () => {
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'In progress', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', pages });
  env.sandbox.syncNow();
  pages[DS1][0] = page('p1', 'Task A', 'Reviewing', 3, 'Dev');
  env.sandbox.syncNow(); // tạo + style lần đầu
  const ip = env.ss.getSheetByName(IN_PROGRESS_NAME);
  const callsAfterFirst = ip.fontWeightCalls.length;
  pages[DS1][0] = page('p1', 'Task A', 'Testing', 3, 'Dev');
  env.sandbox.syncNow(); // update status, KHÔNG được style lại
  eq(ip.fontWeightCalls.length, callsAfterFirst, 'không gọi setFontWeight thêm lần nào');
});

console.log('— Đang xử lý: sort theo priority + hỗ trợ Doing —');
t('5 status trộn thứ tự phát hiện → sau sync, đúng thứ tự Reviewing, To review, Test Production, Testing, Doing', () => {
  const pages = {}; pages[DS1] = [
    page('p1', 'Task Testing', 'In progress', 1, 'Dev'),
    page('p2', 'Task Doing', 'In progress', 1, 'Dev'),
    page('p3', 'Task ToReview', 'In progress', 1, 'Dev'),
    page('p4', 'Task TestProd', 'In progress', 1, 'Dev'),
    page('p5', 'Task Reviewing', 'In progress', 1, 'Dev'),
  ];
  const env = makeEnv({ nowMonth: '07/2026', pages });
  env.sandbox.syncNow(); // baseline
  // cố tình phát hiện theo thứ tự KHÔNG khớp priority, để chứng minh sort hoạt động
  pages[DS1] = [
    page('p1', 'Task Testing', 'Testing', 1, 'Dev'),
    page('p2', 'Task Doing', 'Doing', 1, 'Dev'),
    page('p3', 'Task ToReview', 'To review', 1, 'Dev'),
    page('p4', 'Task TestProd', 'Test Production', 1, 'Dev'),
    page('p5', 'Task Reviewing', 'Reviewing', 1, 'Dev'),
  ];
  env.sandbox.syncNow();
  const ip = env.ss.getSheetByName(IN_PROGRESS_NAME);
  eq(ip.dataRowCount(), 5, 'cả 5 status đều lên tab (kể cả Doing)');
  const order = [1, 2, 3, 4, 5].map(r => ip.getRange(r + 1, 1).getValue());
  eq(order.join(','), 'Task Reviewing,Task ToReview,Task TestProd,Task Testing,Task Doing',
     'thứ tự thực tế: ' + order.join(','));
});
t('Doing trước đây bị chặn hoàn toàn bởi COUNTED — giờ lên được tab dù CHƯA TỪNG chạm Ready to Test', () => {
  const pages = {}; pages[DS1] = [page('p1', 'Task Doing', 'Doing', 5, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', pages });
  env.sandbox.syncNow(); // baseline — trước fix, syncInProgress_ CHƯA BAO GIỜ được gọi ở nhánh baseline
  const ip = env.ss.getSheetByName(IN_PROGRESS_NAME);
  eq(ip.dataRowCount(), 1, 'Task Doing xuất hiện ngay từ baseline, không cần đợi cross COUNTED');
  eq(ip.getRange(2, 2).getValue(), 'Doing');
  // task này CHƯA từng vào tab tháng nào (chưa đạt Ready to Test) — xác nhận đúng thiết kế
  ok(!env.ss.getSheetByName('07/2026'), 'không có tab tháng nào được tạo — task chưa counted');
});
t('task đổi status (Testing -> Reviewing) → re-sort lên đúng vị trí đầu', () => {
  const pages = {}; pages[DS1] = [
    page('p1', 'Task A', 'Testing', 1, 'Dev'),
    page('p2', 'Task B', 'Doing', 1, 'Dev'),
  ];
  const env = makeEnv({ nowMonth: '07/2026', pages });
  env.sandbox.syncNow();
  const ip = env.ss.getSheetByName(IN_PROGRESS_NAME);
  eq(ip.getRange(2, 1).getValue(), 'Task A', 'lúc đầu Testing đứng trước Doing (đúng rank)');
  pages[DS1][0] = page('p1', 'Task A', 'Reviewing', 1, 'Dev');
  env.sandbox.syncNow();
  eq(ip.getRange(2, 1).getValue(), 'Task A', 'Task A (giờ Reviewing) lên đầu');
  eq(ip.getRange(2, 2).getValue(), 'Reviewing');
});
t('Card (HYPERLINK) không bị mất công thức sau khi sort', () => {
  const pages = {}; pages[DS1] = [
    page('p1', 'Task A', 'Testing', 1, 'Dev'),
    page('p2', 'Task B', 'Reviewing', 1, 'Dev'),
  ];
  const env = makeEnv({ nowMonth: '07/2026', pages });
  env.sandbox.syncNow(); // Testing (p1) và Reviewing (p2) đảo thứ tự sau sort
  const ip = env.ss.getSheetByName(IN_PROGRESS_NAME);
  const card = ip.getRange(2, 5).getValue(); // dòng đầu sau sort phải là Task B (Reviewing)
  eq(ip.getRange(2, 1).getValue(), 'Task B');
  ok(String(card).indexOf('HYPERLINK') !== -1, 'Card vẫn là công thức HYPERLINK: ' + card);
  ok(String(card).indexOf('notion.so/p2') !== -1, 'đúng URL của Task B: ' + card);
});
t('status lạ không nằm trong IN_PROGRESS_STATUSES (hiếm, vd đổi tên trên Notion) → xếp cuối, không crash', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const ip = ss.insertSheet(IN_PROGRESS_NAME);
  ip.getRange(1, 1, 1, 5).setValues([['Task', 'Status', 'Point', 'Role', 'Card']]);
  ip.getRange(2, 1, 2, 6).setValues([
    ['Task Known', 'Testing', 1, 'Dev', 'link1', 'pk'],
    ['Task Unknown', 'Some Weird Status', 1, 'Dev', 'link2', 'pu'],
  ]);
  const env = makeEnv({ nowMonth: '07/2026', ss });
  env.sandbox.sortInProgressSheet_(ip);
  eq(ip.getRange(2, 1).getValue(), 'Task Known', 'status hợp lệ lên trước');
  eq(ip.getRange(3, 1).getValue(), 'Task Unknown', 'status lạ bị đẩy xuống cuối, không crash');
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
