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
  getRow() { return this.r; }
  getColumn() { return this.c; }
  getNumRows() { return this.nr; }
  getNumColumns() { return this.nc; }
}
// Conditional format rule + builder — bám sát API thật: getBooleanCondition() trả
// criteria/giá trị/màu, copy() trả builder nạp sẵn setting của rule.
const TEXT_EQUAL_TO = 'TEXT_EQUAL_TO', TEXT_CONTAINS = 'TEXT_CONTAINS';
function rgbColor(hex) { return hex ? { asRgbColor: () => ({ asHexString: () => hex }) } : null; }
class MockCfRule {
  constructor(s) {
    this.text = s.text; this.bg = s.bg; this.fg = s.fg;
    this.ranges = s.ranges.slice(); this.criteria = s.criteria; this.values = (s.values || []).slice();
  }
  getRanges() { return this.ranges.slice(); }
  getBooleanCondition() {
    if (!this.criteria) return null;
    return {
      getCriteriaType: () => this.criteria,
      getCriteriaValues: () => this.values.slice(),
      getBackgroundObject: () => rgbColor(this.bg),
      getFontColorObject: () => rgbColor(this.fg),
    };
  }
  copy() { return newCfRuleBuilder(this); }
}
function newCfRuleBuilder(from) {
  const s = from
    ? { text: from.text, bg: from.bg, fg: from.fg, ranges: from.ranges.slice(),
        criteria: from.criteria, values: from.values.slice() }
    : { text: null, bg: null, fg: null, ranges: [], criteria: null, values: [] };
  const b = {
    whenTextEqualTo(v) { s.text = v; s.criteria = TEXT_EQUAL_TO; s.values = [v]; return b; },
    setBackground(c) { s.bg = c; return b; },
    setFontColor(c) { s.fg = c; return b; },
    setRanges(rs) { s.ranges = rs.slice(); return b; },
    build() { return new MockCfRule(s); },
  };
  return b;
}
// Rule "của anh" dựng tay trong test (chưa từng qua builder của code).
function mkRule(o) {
  return new MockCfRule({ text: o.text || null, bg: o.bg || null, fg: o.fg || null,
                          ranges: o.ranges || [], criteria: o.criteria || null, values: o.values || [] });
}
class MockSheet {
  constructor(name) {
    this.name = name; this.hidden = false; this.cfRules = []; this.cfWrites = 0;
    this.data = Array.from({ length: MAXR }, () => Array(MAXC).fill(''));
  }
  getConditionalFormatRules() { return this.cfRules.slice(); }
  setConditionalFormatRules(rules) { this.cfRules = rules.slice(); this.cfWrites++; }
  getMaxRows() { return MAXR; }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  showSheet() { this.hidden = false; return this; }
  hideSheet() { this.hidden = true; return this; }
  getRange(a, b, c, d) {
    if (typeof a === 'string') {
      if (a === 'A2:A') return new MockRange(this, 2, 1, MAXR - 1, 1);
      if (a === 'B2:B') return new MockRange(this, 2, 2, MAXR - 1, 1);
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
  copyTo(ss) {
    const c = new MockSheet('Copy of ' + this.name);
    c.data = this.data.map(r => r.slice());
    c.cfRules = this.cfRules.slice(); // như Sheets thật: copyTo mang theo conditional formatting
    ss.sheets.push(c); return c;
  }
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
// opts: { nowMonth: 'MM/yyyy', props?: {..}, pages?: {dsId: [page..]}, ss?: MockSS,
//         schema?: {dsId: [statusOption..] | null}, now?: <epoch ms>, noUi?: bool }
//   schema[ds] = null  → board đó trả HTTP lỗi (khác với [] = board không có option).
//   now                → mốc thời gian ban đầu; chỉnh env.clock.ms để "già hoá" cache.
//   noUi               → getUi() ném lỗi, mô phỏng lúc trigger chạy (không có UI).
function makeEnv(opts) {
  const props = Object.assign({ NOTION_TOKEN: 'ntn_test' }, opts.props || {});
  const ss = opts.ss || new MockSS();
  if (!ss.getSheetByName('_TEMPLATE')) ss.insertSheet('_TEMPLATE');
  const ui = new MockUi();
  const logs = [];
  const fetches = [];
  const clock = { ms: opts.now === undefined ? Date.now() : opts.now };
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
      fetches.push(url);
      const q = url.match(/data_sources\/([^/]+)\/query/);
      if (q) {
        const pages = (opts.pages && opts.pages[q[1]]) || [];
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ results: pages, has_more: false }) };
      }
      const d = url.match(/data_sources\/([^/?]+)$/);
      if (!d) throw new Error('URL chưa mock: ' + url);
      const spec = opts.schema ? opts.schema[d[1]] : undefined;
      if (spec === null) return { getResponseCode: () => 404, getContentText: () => '{"object":"error"}' };
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({
        properties: spec ? { Status: { status: { options: spec } } } : {} }) };
    } },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      getUi: () => { if (opts.noUi) throw new Error('Cannot call SpreadsheetApp.getUi() from this context'); return ui; },
      newConditionalFormatRule: () => newCfRuleBuilder(),
      BooleanCriteria: { TEXT_EQUAL_TO: TEXT_EQUAL_TO, TEXT_CONTAINS: TEXT_CONTAINS },
    },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => {} }) }) }) },
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  // Seam đồng hồ: now_() là global trong sandbox nên ghi đè được sau khi nạp Code.gs.
  // Test chỉnh clock.ms để già hoá cache màu mà không phải đụng tới Date.
  sandbox.now_ = () => clock.ms;
  return { sandbox, props, ss, ui, logs, fetches, clock };
}
function schemaFetches(env) { return env.fetches.filter(u => !/\/query$/.test(u)); }

function page(id, name, status, point, role) {
  return { id: id, url: 'https://notion.so/' + id, properties: {
    'Task name': { title: [{ plain_text: name }] },
    'Status': status ? { status: { name: status } } : { status: null },
    'Size card': { number: point },
    'Developer': { people: (role === 'Dev' || role === 'both') ? [{ id: ME }] : [] },
    'Reviewer': { people: (role === 'Reviewer' || role === 'both') ? [{ id: ME }] : [] },
  } };
}

function statusOption(name, color) { return { id: 'opt-' + name, name: name, color: color }; }

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
console.log('— Tô màu status: bảng màu lấy từ Notion —');
const T0 = 1800000000000; // mốc thời gian cố định cho mọi test liên quan cache
function colorEnv(statusRows, schema, ssIn, extra) {
  const ss = ssIn || new MockSS();
  if (!ss.getSheetByName('_TEMPLATE')) ss.insertSheet('_TEMPLATE');
  if (statusRows) {
    const sh = ss.getSheetByName('07/2026') || ss.insertSheet('07/2026');
    statusRows.forEach((s, i) => sh.getRange(2 + i, 1, 1, 7)
      .setValues([['Task ' + i, s, 1, 'Dev', false, 'link', 'p' + i]]));
  }
  return makeEnv(Object.assign({ nowMonth: '07/2026', ss, schema, now: T0 }, extra || {}));
}
// Rule màu Role của anh ở cột D — ngoài cột Status nên phải được giữ nguyên tuyệt đối.
function foreignRule(sh) {
  return mkRule({ text: 'Dev', bg: '#000000', fg: '#ffffff', criteria: TEXT_EQUAL_TO,
                  values: ['Dev'], ranges: [sh.getRange(2, 4, 10, 1)] });
}
// Rule màu status anh tự set (màu riêng, không trùng chip Notion nào).
function ownStatusRule(sh, status, bg, fg, lastRow) {
  return mkRule({ text: status, bg: bg, fg: fg, criteria: TEXT_EQUAL_TO, values: [status],
                  ranges: [lastRow ? sh.getRange(2, 2, lastRow - 1, 1) : sh.getRange('B2:B')] });
}
function rulesOf(env, tab) { return env.ss.getSheetByName(tab).getConditionalFormatRules(); }

t('màu lấy từ schema Notion (không hardcode), map đúng chip Notion', () => {
  const schema = {}; schema[DS1] = [statusOption('Done', 'green'), statusOption('Testing', 'blue')];
  const env = colorEnv(['Done'], schema);
  const r = env.sandbox.colorStatusesFromNotion();
  eq(r.colored, 2, 'số status tô');
  const rules = rulesOf(env, '07/2026');
  eq(rules.length, 2, 'số rule');
  const done = rules.find(x => x.text === 'Done'), testing = rules.find(x => x.text === 'Testing');
  eq(done.bg, '#DBEDDB', 'green bg'); eq(done.fg, '#448361', 'green fg');
  eq(testing.bg, '#D3E5EF', 'blue bg'); eq(testing.fg, '#337EA9', 'blue fg');
});
t('"Waiting to live" (status đang không màu của anh) cũng được tô', () => {
  const schema = {}; schema[DS1] = [
    statusOption('Ready to Test', 'yellow'), statusOption('To review', 'orange'),
    statusOption('Testing', 'blue'), statusOption('Waiting to live', 'purple')];
  const env = colorEnv(['Ready to Test', 'To review', 'Testing', 'Waiting to live'], schema);
  const r = env.sandbox.colorStatusesFromNotion();
  eq(r.colored, 4); eq(r.orphans.length, 0, 'không còn status nào thiếu màu');
  const wtl = rulesOf(env, '07/2026').find(x => x.text === 'Waiting to live');
  ok(wtl, 'có rule cho Waiting to live');
  eq(wtl.bg, '#E8DEEE', 'purple bg'); eq(wtl.fg, '#9065B0', 'purple fg');
});
t('rule tô đúng cột Status (B), từ dòng 2', () => {
  const schema = {}; schema[DS1] = [statusOption('Done', 'green')];
  const env = colorEnv(['Done'], schema);
  env.sandbox.colorStatusesFromNotion();
  const rg = rulesOf(env, '07/2026')[0].getRanges()[0];
  eq(rg.getColumn(), 2, 'cột B'); eq(rg.getRow(), 2, 'từ dòng 2'); eq(rg.getNumColumns(), 1, '1 cột');
});
t('range B2:B không chặn đuôi → dòng thêm sau này vẫn có màu', () => {
  const schema = {}; schema[DS1] = [statusOption('Done', 'green')];
  const env = colorEnv(['Done'], schema);
  env.sandbox.colorStatusesFromNotion();
  const sh = env.ss.getSheetByName('07/2026');
  const rg = sh.getConditionalFormatRules()[0].getRanges()[0];
  eq(rg.getRow() + rg.getNumRows() - 1, sh.getMaxRows(), 'range chạy tới dòng cuối sheet');
});
t('gộp status cả 2 board; trùng tên khác màu → board đầu thắng + log', () => {
  const schema = {};
  schema[DS1] = [statusOption('Done', 'green')];
  schema[DS2] = [statusOption('Done', 'red'), statusOption('UAT', 'orange')];
  const env = colorEnv(['Done'], schema);
  const r = env.sandbox.colorStatusesFromNotion();
  eq(r.colored, 2, 'Done + UAT');
  const rules = rulesOf(env, '07/2026');
  eq(rules.find(x => x.text === 'Done').bg, '#DBEDDB', 'giữ green của board đầu');
  eq(rules.find(x => x.text === 'UAT').bg, '#FADEC9', 'UAT lấy từ board 2');
  ok(env.logs.some(l => l.indexOf('Done') !== -1 && l.indexOf('board đầu') !== -1), env.logs.join('\n'));
});
t('màu Notion lạ → fallback về default, vẫn có màu (không bỏ status)', () => {
  const schema = {}; schema[DS1] = [statusOption('Kỳ lạ', 'chartreuse')];
  const env = colorEnv(['Kỳ lạ'], schema);
  const r = env.sandbox.colorStatusesFromNotion();
  eq(r.colored, 1);
  const rule = rulesOf(env, '07/2026')[0];
  eq(rule.bg, '#E3E2E0', 'default bg'); eq(rule.fg, '#37352F', 'default fg');
});
t('rule ngoài cột Status được giữ nguyên (màu Role cột D không bị đè)', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const sh = ss.insertSheet('07/2026');
  const mine = foreignRule(sh);
  sh.setConditionalFormatRules([mine]);
  const schema = {}; schema[DS1] = [statusOption('Done', 'green')];
  const env = colorEnv(null, schema, ss);
  env.sandbox.colorStatusesFromNotion();
  const rules = sh.getConditionalFormatRules();
  eq(rules.length, 2, 'rule cũ + rule status');
  ok(rules[0] === mine, 'rule cột C giữ nguyên và vẫn đứng đầu');
});
t('chạy lại không nhân đôi rule (idempotent)', () => {
  const schema = {}; schema[DS1] = [statusOption('Done', 'green'), statusOption('Testing', 'blue')];
  const env = colorEnv(['Done'], schema);
  env.sandbox.colorStatusesFromNotion();
  env.sandbox.colorStatusesFromNotion();
  env.sandbox.colorStatusesFromNotion();
  eq(rulesOf(env, '07/2026').length, 2, 'vẫn 2 rule');
});
t('status có trong sheet mà Notion không còn → báo đích danh trong alert', () => {
  const schema = {}; schema[DS1] = [statusOption('Done', 'green')];
  const env = colorEnv(['Done', 'Status đã xoá bên Notion'], schema);
  const r = env.sandbox.colorStatusesFromNotion();
  eq(r.orphans.length, 1); eq(r.orphans[0], 'Status đã xoá bên Notion');
  ok(env.ui.alerts[0].indexOf('Status đã xoá bên Notion') !== -1, env.ui.alerts[0]);
});
t('mọi status trong sheet đều khớp Notion → alert báo không còn thiếu', () => {
  const schema = {}; schema[DS1] = [statusOption('Done', 'green')];
  const env = colorEnv(['Done'], schema);
  const r = env.sandbox.colorStatusesFromNotion();
  eq(r.orphans.length, 0);
  ok(env.ui.alerts[0].indexOf('đều đã có màu') !== -1, env.ui.alerts[0]);
});
t('không có UI (trigger chạy) → báo cáo rơi xuống Logger, không ném lỗi', () => {
  const schema = {}; schema[DS1] = [statusOption('Done', 'green')];
  const env = colorEnv(['Done', 'Status lạ'], schema, null, { noUi: true });
  const r = env.sandbox.colorStatusesFromNotion();
  eq(r.colored, 1);
  eq(env.ui.alerts.length, 0, 'không alert được vì không có UI');
  ok(env.logs.some(l => l.indexOf('Status lạ') !== -1), 'nội dung báo cáo vào log: ' + env.logs.join('\n'));
});

console.log('— Tô màu status: CỘNG THÊM, màu sẵn có không bị đổi —');
function ssWithRules(rulesFn, rows) {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const sh = ss.insertSheet('07/2026');
  (rows || []).forEach((s, i) => sh.getRange(2 + i, 1, 1, 7)
    .setValues([['Task ' + i, s, 1, 'Dev', false, 'link', 'p' + i]]));
  sh.setConditionalFormatRules(rulesFn(sh));
  return { ss, sh };
}

t('status anh đã tô rồi → giữ nguyên màu của anh, KHÔNG thêm rule thứ hai', () => {
  const { ss, sh } = ssWithRules(s => [ownStatusRule(s, 'Done', '#123456', '#654321')], ['Done']);
  const schema = {}; schema[DS1] = [statusOption('Done', 'green')];
  const env = colorEnv(null, schema, ss);
  env.sandbox.colorStatusesFromNotion();
  const rules = sh.getConditionalFormatRules().filter(r => r.text === 'Done');
  eq(rules.length, 1, 'chỉ 1 rule cho Done');
  eq(rules[0].bg, '#123456', 'nền của anh giữ nguyên');
  eq(rules[0].fg, '#654321', 'chữ của anh giữ nguyên');
});
t('rule của anh luôn đứng TRƯỚC rule Notion (rule khớp đầu tiên thắng)', () => {
  const { ss, sh } = ssWithRules(s => [
    ownStatusRule(s, 'Done', '#123456', '#654321'),
    foreignRule(s),
  ], ['Done', 'Testing']);
  const schema = {}; schema[DS1] = [statusOption('Done', 'green'), statusOption('Testing', 'blue')];
  const env = colorEnv(null, schema, ss);
  const r = env.sandbox.colorStatusesFromNotion();
  const rules = sh.getConditionalFormatRules();
  eq(rules[0].bg, '#123456', 'rule Done của anh vẫn ở index 0');
  eq(rules[1].bg, '#000000', 'rule Role của anh vẫn ở index 1');
  eq(rules.length, 3, 'chỉ thêm 1 rule cho Testing');
  eq(rules[2].text, 'Testing', 'rule Notion nằm cuối');
  eq(r.kept, 2, 'giữ 2 rule của anh');
  eq(r.appended, 3, 'thêm Testing ở tab tháng + cả 2 status ở _TEMPLATE (đang trắng)');
});
t('status chưa có màu → được thêm màu Notion', () => {
  const { ss, sh } = ssWithRules(s => [ownStatusRule(s, 'Done', '#123456', '#654321')],
                                 ['Done', 'Waiting to live']);
  const schema = {}; schema[DS1] = [statusOption('Done', 'green'), statusOption('Waiting to live', 'purple')];
  const env = colorEnv(null, schema, ss);
  env.sandbox.colorStatusesFromNotion();
  const wtl = sh.getConditionalFormatRules().find(r => r.text === 'Waiting to live');
  ok(wtl, 'có rule mới cho Waiting to live');
  eq(wtl.bg, '#E8DEEE', 'purple bg'); eq(wtl.fg, '#9065B0', 'purple fg');
});
t('rule cũ bị chặn đuôi (B2:B51) → nới hết cột, màu giữ nguyên từng byte', () => {
  const { ss, sh } = ssWithRules(s => [ownStatusRule(s, 'Testing', '#AA0011', '#BB2233', 51)], ['Testing']);
  const before = sh.getConditionalFormatRules()[0];
  eq(before.getRanges()[0].getRow() + before.getRanges()[0].getNumRows() - 1, 51, 'trước: chặn ở dòng 51');
  const schema = {}; schema[DS1] = [statusOption('Testing', 'blue')];
  const env = colorEnv(null, schema, ss);
  const r = env.sandbox.colorStatusesFromNotion();
  const after = sh.getConditionalFormatRules()[0];
  const rg = after.getRanges()[0];
  eq(rg.getRow() + rg.getNumRows() - 1, sh.getMaxRows(), 'sau: chạy hết cột B');
  eq(rg.getColumn(), 2, 'vẫn cột B');
  eq(after.bg, '#AA0011', 'nền không đổi'); eq(after.fg, '#BB2233', 'chữ không đổi');
  eq(after.criteria, TEXT_EQUAL_TO, 'criteria không đổi');
  eq(after.values.join(), 'Testing', 'giá trị khớp không đổi');
  eq(r.extended, 1, 'báo cáo có nới 1 rule');
  ok(env.logs.some(l => l.indexOf('Nới range') !== -1 && l.indexOf('Testing') !== -1), env.logs.join('\n'));
});
t('rule của anh không đọc ra được status (công thức / TEXT_CONTAINS) → giữ, vẫn đứng trước', () => {
  const { ss, sh } = ssWithRules(s => [
    mkRule({ text: 'contains', bg: '#111111', fg: '#eeeeee', criteria: TEXT_CONTAINS,
             values: ['Test'], ranges: [s.getRange('B2:B')] }),
    mkRule({ text: 'formula', bg: '#222222', fg: '#dddddd', ranges: [s.getRange('B2:B')] }),
  ], ['Testing']);
  const schema = {}; schema[DS1] = [statusOption('Testing', 'blue')];
  const env = colorEnv(null, schema, ss);
  const r = env.sandbox.colorStatusesFromNotion();
  const rules = sh.getConditionalFormatRules();
  eq(r.kept, 2, 'giữ cả 2 rule không đọc được');
  eq(rules[0].bg, '#111111', 'TEXT_CONTAINS vẫn index 0');
  eq(rules[1].bg, '#222222', 'rule công thức vẫn index 1');
  const added = rules.findIndex(x => x.text === 'Testing' && x.bg === '#D3E5EF');
  ok(added > 1, 'rule Notion (nếu thừa) vẫn nằm SAU rule của anh → màu hiển thị không đổi');
});
t('chạy 3 lần liên tiếp không làm phình danh sách rule', () => {
  const { ss, sh } = ssWithRules(s => [
    ownStatusRule(s, 'Done', '#123456', '#654321', 51),
    foreignRule(s),
  ], ['Done', 'Testing']);
  const schema = {}; schema[DS1] = [statusOption('Done', 'green'), statusOption('Testing', 'blue')];
  const env = colorEnv(null, schema, ss);
  env.sandbox.colorStatusesFromNotion();
  const n = sh.getConditionalFormatRules().length;
  env.sandbox.colorStatusesFromNotion();
  env.sandbox.colorStatusesFromNotion();
  eq(sh.getConditionalFormatRules().length, n, 'số rule không đổi');
  eq(sh.getConditionalFormatRules()[0].bg, '#123456', 'màu của anh vẫn nguyên sau 3 lần');
});
t('status anh đã tô mà Notion không còn → KHÔNG bị báo là thiếu màu', () => {
  const { ss, sh } = ssWithRules(s => [ownStatusRule(s, 'Status cũ của anh', '#123456', '#654321')],
                                 ['Status cũ của anh', 'Status không ai tô']);
  const schema = {}; schema[DS1] = [statusOption('Done', 'green')];
  const env = colorEnv(null, schema, ss);
  const r = env.sandbox.colorStatusesFromNotion();
  eq(r.orphans.length, 1, 'chỉ 1 status thật sự không màu');
  eq(r.orphans[0], 'Status không ai tô');
});
t('nhận ra rule của chính code khi Sheets trả hex 8 ký tự (#aarrggbb) hoa', () => {
  const { ss, sh } = ssWithRules(s => [
    mkRule({ text: 'Done', bg: '#FFDBEDDB', fg: '#FF448361', criteria: TEXT_EQUAL_TO,
             values: ['Done'], ranges: [s.getRange('B2:B')] }),
  ], ['Done']);
  const schema = {}; schema[DS1] = [statusOption('Done', 'green')];
  const env = colorEnv(null, schema, ss);
  env.sandbox.colorStatusesFromNotion();
  const rules = sh.getConditionalFormatRules();
  eq(rules.length, 1, 'dựng lại chứ không nhân đôi');
  eq(rules[0].bg, '#DBEDDB', 'màu green chuẩn');
});
t('log tổng kết nêu rõ giữ / nới / thêm bao nhiêu rule', () => {
  const { ss } = ssWithRules(s => [ownStatusRule(s, 'Done', '#123456', '#654321', 51)], ['Done']);
  const schema = {}; schema[DS1] = [statusOption('Done', 'green'), statusOption('Testing', 'blue')];
  const env = colorEnv(null, schema, ss);
  env.sandbox.colorStatusesFromNotion();
  ok(env.logs.some(l => l.indexOf('giữ nguyên') !== -1 && l.indexOf('nới range') !== -1 &&
                        l.indexOf('thêm mới') !== -1), env.logs.join('\n'));
});
t('đường tự động trong syncNow cũng chỉ cộng thêm, không đổi màu sẵn có', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const old = ss.insertSheet('06/2026');
  old.getRange(2, 1, 1, 7).setValues([['T', 'Ready to Test', 1, 'Dev', false, 'link', 'z']]);
  old.setConditionalFormatRules([ownStatusRule(old, 'Ready to Test', '#123456', '#654321', 51)]);
  const schema = {}; schema[DS1] = [statusOption('Ready to Test', 'yellow'), statusOption('Done', 'green')];
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'Ready to Test', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', ss, schema, pages, now: T0 });
  env.sandbox.syncNow();
  const rules = old.getConditionalFormatRules();
  eq(rules[0].bg, '#123456', 'màu Ready to Test của anh giữ nguyên');
  eq(rules[0].getRanges()[0].getNumRows(), old.getMaxRows() - 1, 'range được nới hết cột');
  eq(rules.length, 2, 'chỉ thêm rule cho Done');
  eq(rules[1].text, 'Done');
});

console.log('— Tô màu status: Notion lỗi thì không đụng vào rule —');
t('MỌI board lỗi → không xoá rule đang có, báo rõ chưa đổi gì', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const sh = ss.insertSheet('07/2026');
  const mine = foreignRule(sh);
  sh.setConditionalFormatRules([mine]);
  const schema = {}; schema[DS1] = null; schema[DS2] = null;
  const env = colorEnv(null, schema, ss);
  const r = env.sandbox.colorStatusesFromNotion();
  eq(r.colored, 0);
  eq(sh.getConditionalFormatRules().length, 1, 'rule cũ còn nguyên');
  ok(env.ui.alerts[0].indexOf('Chưa đổi màu') !== -1, env.ui.alerts[0]);
});
t('MỘT board lỗi → bỏ qua hẳn, không xoá màu của board đọc được', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const sh = ss.insertSheet('07/2026');
  sh.getRange(2, 1, 1, 7).setValues([['T1', 'Done', 1, 'Dev', false, 'link', 'p1']]);
  sh.getRange(3, 1, 1, 7).setValues([['T2', 'Waiting to live', 1, 'Dev', false, 'link', 'p2']]);
  const before = [foreignRule(sh), ownStatusRule(sh, 'Waiting to live', '#E8DEEE', '#9065B0')];
  sh.setConditionalFormatRules(before);
  const schema = {}; schema[DS1] = [statusOption('Done', 'green')]; schema[DS2] = null;
  const env = colorEnv(null, schema, ss);
  const r = env.sandbox.colorStatusesFromNotion();
  eq(r.colored, 0, 'không tô gì');
  eq(sh.getConditionalFormatRules().length, 2, 'rule cũ (kể cả rule cột B) còn nguyên');
  ok(sh.getConditionalFormatRules()[1] === before[1], 'màu Waiting to live không bị xoá');
  eq(r.orphans.length, 0, 'không báo nhầm status nào là "Notion không còn"');
  ok(env.ui.alerts[0].indexOf('Chưa đổi màu') !== -1, env.ui.alerts[0]);
});
t('MỘT board lỗi trong lượt sync tự động → cũng bỏ qua, không ghi cache', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const schema = {}; schema[DS1] = [statusOption('Ready to Test', 'yellow')]; schema[DS2] = null;
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'Ready to Test', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', ss, schema, pages, now: T0 });
  env.sandbox.syncNow();
  eq(ss.getSheetByName('_TEMPLATE').cfWrites, 0, 'không ghi rule nào');
  ok(!('STATUS_COLOR_CACHE' in env.props), 'không ghi cache bảng màu lỗi');
});

console.log('— Tô màu status: tự động trong syncNow (không cần bấm nút) —');
t('KHÔNG còn nút tô màu trong menu', () => {
  const env = makeEnv({ nowMonth: '07/2026' });
  env.sandbox.onOpen();
  const items = env.ui.menus[0].items.filter(i => !i.sep);
  ok(!items.some(i => i.fn === 'colorStatusesFromNotion'), 'không có item gọi colorStatusesFromNotion');
  ok(!items.some(i => i.label.indexOf('màu') !== -1), 'không có label nhắc tới màu: ' +
     items.map(i => i.label).join(' | '));
  ok(typeof env.sandbox.colorStatusesFromNotion === 'function', 'hàm vẫn chạy tay được từ editor');
});
t('syncNow đầu tiên tự tô màu, không cần thao tác tay', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE'); ss.insertSheet('06/2026');
  const schema = {}; schema[DS1] = [statusOption('Ready to Test', 'yellow'), statusOption('Done', 'green')];
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'Ready to Test', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', ss, schema, pages, now: T0 });
  env.sandbox.syncNow();
  eq(ss.getSheetByName('06/2026').getConditionalFormatRules().length, 2, 'tab tháng cũ có màu');
  eq(ss.getSheetByName('_TEMPLATE').getConditionalFormatRules().length, 2, '_TEMPLATE có màu');
  ok(env.props.STATUS_COLOR_CACHE, 'cache bảng màu được ghi');
});
t('bảng màu không đổi → lượt sync sau không đọc Notion, không ghi lại rule', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE'); ss.insertSheet('06/2026');
  const schema = {}; schema[DS1] = [statusOption('Ready to Test', 'yellow')];
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'Ready to Test', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', ss, schema, pages, now: T0 });
  env.sandbox.syncNow();
  const writes = ss.getSheetByName('06/2026').cfWrites, fetched = schemaFetches(env).length;
  eq(writes, 1, 'lượt đầu ghi 1 lần');
  env.sandbox.syncNow();
  env.sandbox.syncNow();
  eq(ss.getSheetByName('06/2026').cfWrites, writes, 'không ghi lại rule');
  eq(schemaFetches(env).length, fetched, 'không gọi lại Notion');
});
t('gặp status lạ → đọc lại Notion và cập nhật rule', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE'); ss.insertSheet('06/2026');
  const schema = {}; schema[DS1] = [statusOption('Ready to Test', 'yellow')];
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'Ready to Test', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', ss, schema, pages, now: T0 });
  env.sandbox.syncNow();
  const fetched = schemaFetches(env).length;
  schema[DS1] = [statusOption('Ready to Test', 'yellow'), statusOption('Waiting to live', 'purple')];
  pages[DS1] = [page('p1', 'Task A', 'Waiting to live', 3, 'Dev')];
  env.sandbox.syncNow();
  ok(schemaFetches(env).length > fetched, 'có đọc lại Notion');
  const rules = ss.getSheetByName('06/2026').getConditionalFormatRules();
  eq(rules.length, 2, 'thêm rule mới');
  eq(rules.find(x => x.text === 'Waiting to live').bg, '#E8DEEE', 'purple');
});
t('cache quá 24h → đọc lại Notion, đổi màu bên Notion được áp lại', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE'); ss.insertSheet('06/2026');
  const schema = {}; schema[DS1] = [statusOption('Ready to Test', 'yellow')];
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'Ready to Test', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', ss, schema, pages, now: T0 });
  env.sandbox.syncNow();
  eq(ss.getSheetByName('06/2026').getConditionalFormatRules()[0].bg, '#FDECC8', 'yellow');
  schema[DS1] = [statusOption('Ready to Test', 'red')]; // đổi màu, không đổi tên
  env.sandbox.syncNow();
  eq(ss.getSheetByName('06/2026').getConditionalFormatRules()[0].bg, '#FDECC8', 'chưa tới 24h: giữ nguyên');
  env.clock.ms = T0 + 25 * 60 * 60 * 1000;
  env.sandbox.syncNow();
  eq(ss.getSheetByName('06/2026').getConditionalFormatRules()[0].bg, '#FFE2DD', 'quá 24h: áp màu mới');
});
t('quét bù (backfillCounted) cũng đi qua đường tô màu tự động', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const schema = {}; schema[DS1] = [statusOption('Done', 'green')];
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'Done', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', ss, schema, pages, now: T0 });
  env.sandbox.backfillCounted();
  eq(ss.getSheetByName('_TEMPLATE').getConditionalFormatRules().length, 1);
});
t('tô màu lỗi → syncNow vẫn cộng point xong, không kéo sập lượt sync', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const schema = {}; schema[DS1] = [statusOption('Done', 'green')];
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'Done', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', ss, schema, pages, now: T0, noUi: true });
  env.sandbox.syncStatusColors_ = () => { throw new Error('Sheets quota'); };
  const r = env.sandbox.syncNow({ backfill: true });
  eq(r.added, 1, 'task vẫn được kéo về dù tô màu lỗi');
  eq(ss.getSheetByName('07/2026').dataRowCount(), 1, 'dòng vẫn được ghi');
  ok(env.logs.some(l => l.indexOf('sync point vẫn xong') !== -1),
     'log nêu rõ màu lỗi nhưng sync xong: ' + env.logs.join('\n'));
});
t('status trong sheet mà Notion không còn → log đích danh (không cần UI)', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const old = ss.insertSheet('06/2026');
  old.getRange(2, 1, 1, 7).setValues([['Cũ', 'Status Notion đã xoá', 1, 'Dev', false, 'link', 'zz']]);
  const schema = {}; schema[DS1] = [statusOption('Done', 'green')];
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'Done', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', ss, schema, pages, now: T0, noUi: true });
  env.sandbox.syncNow();
  ok(env.logs.some(l => l.indexOf('Status Notion đã xoá') !== -1),
     'log nêu đích danh: ' + env.logs.join('\n'));
});

console.log('— Tô màu status: tab tháng mới —');
t('_TEMPLATE có rule → tab tháng mới clone ra là có màu sẵn', () => {
  const ss = new MockSS(); const tpl = ss.insertSheet('_TEMPLATE');
  const schema = {}; schema[DS1] = [statusOption('Ready to Test', 'yellow')];
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'In progress', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', ss, schema, pages, now: T0 });
  env.sandbox.syncNow(); // baseline + tô _TEMPLATE
  eq(tpl.getConditionalFormatRules().length, 1, '_TEMPLATE có rule');
  pages[DS1][0] = page('p1', 'Task A', 'Ready to Test', 3, 'Dev');
  env.sandbox.syncNow(); // tạo tab 07/2026 từ _TEMPLATE
  const fresh = ss.getSheetByName('07/2026');
  eq(fresh.getConditionalFormatRules().length, 1, 'tab tháng mới thừa hưởng rule');
  eq(fresh.getConditionalFormatRules()[0].bg, '#FDECC8', 'yellow bg');
});
t('_TEMPLATE chưa có rule nhưng đã có cache → tab tháng mới vẫn được tô', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const cache = JSON.stringify({ map: { 'Ready to Test': 'yellow' }, ts: T0 });
  const schema = {}; schema[DS1] = [statusOption('Ready to Test', 'yellow')];
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'Ready to Test', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', ss, schema, pages, now: T0,
                        props: { STATUS_COLOR_CACHE: cache } });
  env.sandbox.syncNow({ backfill: true }); // add thẳng -> tạo tab 07/2026
  eq(ss.getSheetByName('_TEMPLATE').getConditionalFormatRules().length, 0, '_TEMPLATE vẫn trắng');
  const fresh = ss.getSheetByName('07/2026');
  eq(fresh.getConditionalFormatRules().length, 1, 'tab mới vẫn có màu nhờ cache');
  eq(fresh.getConditionalFormatRules()[0].bg, '#FDECC8', 'yellow bg');
});

// ---------------- kết quả ----------------
console.log('');
console.log(pass + '/' + (pass + fail) + ' passed' + (fail ? ' — ' + fail + ' FAILED' : ''));
process.exit(fail ? 1 : 0);
