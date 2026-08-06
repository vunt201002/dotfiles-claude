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
const STATUS_FMT = Number(/var STATUS_FMT = (\d+)/.exec(SRC)[1]);

// ---------------- mock Sheets ----------------
const MAXR = 200, MAXC = 12;
const PROP_VALUE_MAX = 9216;
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
  setWrapStrategy(w) {
    this.s.wrapCalls.push({ row: this.r, col: this.c, nr: this.nr, nc: this.nc, strategy: w });
    return this;
  }
  clearContent() {
    for (let i = 0; i < this.nr; i++)
      for (let j = 0; j < this.nc; j++) this.s.data[this.r - 1 + i][this.c - 1 + j] = '';
    return this;
  }
  setFontStyle(v) { this.s.fonts.push({ kind: 'style', col: this.c, nr: this.nr, value: v }); return this; }
  setFontSize(v) { this.s.fonts.push({ kind: 'size', col: this.c, nr: this.nr, value: v }); return this; }
  setFontColor(v) { this.s.fonts.push({ kind: 'color', col: this.c, nr: this.nr, value: v }); return this; }
  setVerticalAlignment(v) { this.s.aligns.push({ axis: 'v', row: this.r, col: this.c, nr: this.nr, nc: this.nc, value: v }); return this; }
  setHorizontalAlignment(v) { this.s.aligns.push({ axis: 'h', row: this.r, col: this.c, nr: this.nr, nc: this.nc, value: v }); return this; }
  setDataValidation(rule) {
    this.s.validations.push({ row: this.r, col: this.c, nr: this.nr, rule: rule });
    return this;
  }
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
    this.text = s.text; this.bg = s.bg; this.fg = s.fg; this.bold = s.bold || false;
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
    ? { text: from.text, bg: from.bg, fg: from.fg, bold: from.bold, ranges: from.ranges.slice(),
        criteria: from.criteria, values: from.values.slice() }
    : { text: null, bg: null, fg: null, bold: false, ranges: [], criteria: null, values: [] };
  const b = {
    whenTextEqualTo(v) { s.text = v; s.criteria = TEXT_EQUAL_TO; s.values = [v]; return b; },
    setBackground(c) { s.bg = c; return b; },
    setFontColor(c) { s.fg = c; return b; },
    setBold(v) { s.bold = v; return b; },
    setRanges(rs) { s.ranges = rs.slice(); return b; },
    build() { return new MockCfRule(s); },
  };
  return b;
}
// Rule "của anh" dựng tay trong test (chưa từng qua builder của code).
function mkRule(o) {
  return new MockCfRule({ text: o.text || null, bg: o.bg || null, fg: o.fg || null, bold: o.bold || false,
                          ranges: o.ranges || [], criteria: o.criteria || null, values: o.values || [] });
}
class MockSheet {
  constructor(name) {
    this.name = name; this.hidden = false; this.cfRules = []; this.cfWrites = 0; this.clearAllCalls = 0;
    this.wrapCalls = []; this.validations = []; this.aligns = []; this.fonts = []; this.widths = {};
    this.hiddenCols = {}; this.showColCalls = []; this.hideColCalls = [];
    this.maxRows = MAXR;
    this.data = Array.from({ length: MAXR }, () => Array(MAXC).fill(''));
  }
  hideColumns(c, n) {
    for (let i = 0; i < (n || 1); i++) this.hiddenCols[c + i] = true;
    this.hideColCalls.push({ col: c, n: n || 1 });
    return this;
  }
  showColumns(c, n) {
    for (let i = 0; i < (n || 1); i++) this.hiddenCols[c + i] = false;
    this.showColCalls.push({ col: c, n: n || 1 });
    return this;
  }
  // Khối KPI (cột I+) nằm TRÊN CÙNG những dòng task, nên xoá cả dòng là nuốt luôn công
  // thức tháng đó. Mock ném thẳng để bất kỳ đường code nào lỡ gọi đều làm đỏ test.
  deleteRow() { throw new Error('deleteRow bị cấm — KPI ở cột I+ nằm cùng dòng'); }
  deleteRows() { throw new Error('deleteRows bị cấm — KPI ở cột I+ nằm cùng dòng'); }
  getConditionalFormatRules() { return this.cfRules.slice(); }
  setConditionalFormatRules(rules) { this.cfRules = rules.slice(); this.cfWrites++; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return MAXC; }
  getColumnWidth(c) { return this.widths[c] === undefined ? 100 : this.widths[c]; }
  setColumnWidth(c, w) { this.widths[c] = w; return this; }
  insertRowsAfter(after, n) {
    for (let i = 0; i < n; i++) this.data.splice(after, 0, Array(MAXC).fill(''));
    this.maxRows += n;
    return this;
  }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  showSheet() { this.hidden = false; return this; }
  hideSheet() { this.hidden = true; return this; }
  getRange(a, b, c, d) {
    if (typeof a === 'string') {
      if (a === 'A2:A') return new MockRange(this, 2, 1, this.maxRows - 1, 1);
      if (a === 'B2:B') return new MockRange(this, 2, 2, this.maxRows - 1, 1);
      throw new Error('A1 notation chưa mock: ' + a);
    }
    return new MockRange(this, a, b, c === undefined ? 1 : c, d === undefined ? 1 : d);
  }
  getLastRow() {
    for (let i = this.data.length - 1; i >= 0; i--)
      if (this.data[i].some(v => v !== '' && v !== null)) return i + 1;
    return 0;
  }
  clearContents() {
    this.clearAllCalls++;
    this.data = Array.from({ length: this.maxRows }, () => Array(MAXC).fill(''));
  }
  copyTo(ss) {
    const c = new MockSheet('Copy of ' + this.name);
    c.maxRows = this.maxRows;
    c.data = this.data.map(r => r.slice());
    c.cfRules = this.cfRules.slice(); // như Sheets thật: copyTo mang theo conditional formatting
    c.wrapCalls = this.wrapCalls.slice(); // và mang theo cả format ô (wrap)
    c.validations = this.validations.slice();
    c.aligns = this.aligns.slice();
    c.fonts = this.fonts.slice();
    c.hiddenCols = Object.assign({}, this.hiddenCols); // cột ẩn cũng đi theo bản sao
    ss.sheets.push(c); return c;
  }
  dataRowCount() { // helper riêng cho test: số dòng data (từ row 2, cột A)
    let n = 0;
    for (let i = 1; i < this.data.length; i++) if (this.data[i][0] !== '' && this.data[i][0] !== null) n++;
    return n;
  }
}
class MockSS {
  constructor() { this.sheets = []; this.toasts = []; this.active = null; this.activeRange = null; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  getSheets() { return this.sheets.slice(); }
  insertSheet(n) { const s = new MockSheet(n); this.sheets.push(s); return s; }
  getActiveSheet() { return this.active; }
  getActiveRange() { return this.activeRange; }
  // Vùng anh bôi đen trước khi bấm menu.
  selectRange_(sh, row, col, nr, nc) {
    this.active = sh;
    this.activeRange = new MockRange(sh, row, col, nr, nc);
    return this.activeRange;
  }
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
  constructor() {
    this.alerts = []; this.menus = []; this.answer = 'NO';
    this.ButtonSet = { OK: 'OK', YES_NO: 'YES_NO' };
    this.Button = { OK: 'OK', YES: 'YES', NO: 'NO' };
  }
  // alert(msg) = thông báo; alert(title, msg, buttonSet) = hỏi Yes/No (trả this.answer).
  alert(a, b) {
    if (b === undefined) { this.alerts.push(a); return this.Button.OK; }
    this.alerts.push(a + '\n' + b);
    return this.answer;
  }
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
//         schema?: {dsId: [statusOption..] | null}, now?: <epoch ms>, noUi?: bool,
//         uiAnswer?: 'YES'|'NO' }
//   schema[ds] = null  → board đó trả HTTP lỗi (khác với [] = board không có option).
//   now                → mốc thời gian ban đầu; chỉnh env.clock.ms để "già hoá" cache.
//   noUi               → getUi() ném lỗi, mô phỏng lúc trigger chạy (không có UI).
//   uiAnswer           → nút anh bấm trong hộp thoại Yes/No (mặc định NO).
function makeEnv(opts) {
  const props = Object.assign({ NOTION_TOKEN: 'ntn_test' }, opts.props || {});
  const ss = opts.ss || new MockSS();
  if (!ss.getSheetByName('_TEMPLATE')) ss.insertSheet('_TEMPLATE');
  const ui = new MockUi();
  if (opts.uiAnswer) ui.answer = opts.uiAnswer;
  const logs = [];
  const fetches = [];
  const queryFail = Object.assign({}, opts.queryFail || {});
  const clock = { ms: opts.now === undefined ? Date.now() : opts.now };
  const sandbox = {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null),
      // Trần thật của Apps Script: 9KB mỗi property. Vượt là ném "Argument too large",
      // và cú ném đó chạy giữa lượt sync chứ không phải lúc deploy.
      setProperty: (k, v) => {
        if (String(v).length > PROP_VALUE_MAX) throw new Error('Argument too large: value');
        props[k] = String(v);
      },
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
        // queryFail[ds] = true → board đó trả HTTP lỗi cho lượt /query (502/429 thật sự
        // hay gặp). Mutable sau khi tạo env để test bật/tắt giữa hai lượt sync.
        if (queryFail[q[1]])
          return { getResponseCode: () => 502, getContentText: () => '{"object":"error"}' };
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
      WrapStrategy: { WRAP: 'WRAP', OVERFLOW: 'OVERFLOW', CLIP: 'CLIP' },
      newDataValidation: () => {
        const s = { values: [], allowInvalid: null, kind: null };
        const b = {
          requireValueInList(v, showDropdown) { s.kind = 'list'; s.values = v.slice(); s.showDropdown = showDropdown; return b; },
          requireCheckbox() { s.kind = 'checkbox'; return b; },
          setAllowInvalid(v) { s.allowInvalid = v; return b; },
          build: () => s,
        };
        return b;
      },
    },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => {} }) }) }) },
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  // Seam đồng hồ: now_() là global trong sandbox nên ghi đè được sau khi nạp Code.gs.
  // Test chỉnh clock.ms để già hoá cache màu mà không phải đụng tới Date.
  sandbox.now_ = () => clock.ms;
  return { sandbox, props, ss, ui, logs, fetches, clock, queryFail };
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
t('pinDashboardFirstMenu: Dashboard bị lệch vị trí → đưa về đầu + toast xác nhận', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  ss.insertSheet('06/2026'); ss.insertSheet(DASHBOARD_NAME); ss.insertSheet('07/2026');
  const env = makeEnv({ nowMonth: '07/2026', ss });
  env.sandbox.pinDashboardFirstMenu();
  eq(ss.getSheets()[0].getName(), DASHBOARD_NAME);
  eq(env.ss.toasts.length, 1);
  ok(env.ss.toasts[0].msg.indexOf(DASHBOARD_NAME) !== -1, env.ss.toasts[0].msg);
});
t('pinDashboardFirstMenu: không có tab Dashboard → toast báo không tìm thấy, không lỗi', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const env = makeEnv({ nowMonth: '07/2026', ss });
  env.sandbox.pinDashboardFirstMenu();
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
t('chữ status in đậm — chip Notion ở nét thường đọc bị mờ trên nền nhạt', () => {
  const schema = {}; schema[DS1] = [statusOption('Done', 'green'), statusOption('Testing', 'blue')];
  const env = colorEnv(['Done'], schema);
  env.sandbox.colorStatusesFromNotion();
  rulesOf(env, '07/2026').forEach(r => eq(r.bold, true, 'bold: ' + r.text));
});
t('rule sinh từ bản cũ (chưa bold) vẫn nhận là của code → dựng lại thành bold', () => {
  const schema = {}; schema[DS1] = [statusOption('Done', 'green')];
  const env = colorEnv(['Done'], schema);
  const sh = env.ss.getSheetByName('07/2026');
  sh.setConditionalFormatRules([ownStatusRule(sh, 'Done', '#DBEDDB', '#448361')]);
  env.sandbox.colorStatusesFromNotion();
  const rules = rulesOf(env, '07/2026');
  eq(rules.length, 1, 'không nhân đôi rule');
  eq(rules[0].bold, true, 'rule cũ được nâng lên bold');
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

// Garry không tự tô màu status bao giờ ("để script lo hết") → mọi rule TEXT_EQUAL_TO ở
// cột B đều do chính script sinh, chỉ khác đời. Rule đọc được thì dựng lại theo palette
// hiện tại; rule không dựng lại được (công thức / TEXT_CONTAINS / status Notion đã bỏ)
// thì không đụng tới và vẫn đứng trước.
console.log('— Tô màu status: dựng lại rule đọc được, không đụng rule không dựng lại nổi —');
function ssWithRules(rulesFn, rows) {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const sh = ss.insertSheet('07/2026');
  (rows || []).forEach((s, i) => sh.getRange(2 + i, 1, 1, 7)
    .setValues([['Task ' + i, s, 1, 'Dev', false, 'link', 'p' + i]]));
  sh.setConditionalFormatRules(rulesFn(sh));
  return { ss, sh };
}

t('rule status lệch bảng màu hiện tại → dựng lại theo Notion, KHÔNG nhân đôi', () => {
  const { ss, sh } = ssWithRules(s => [ownStatusRule(s, 'Done', '#123456', '#654321')], ['Done']);
  const schema = {}; schema[DS1] = [statusOption('Done', 'green')];
  const env = colorEnv(null, schema, ss);
  env.sandbox.colorStatusesFromNotion();
  const rules = sh.getConditionalFormatRules().filter(r => r.text === 'Done');
  eq(rules.length, 1, 'chỉ 1 rule cho Done');
  eq(rules[0].bg, '#DBEDDB', 'nền về đúng green của Notion');
  eq(rules[0].fg, '#448361', 'chữ về đúng green của Notion');
});
t('rule ngoài cột Status vẫn đứng TRƯỚC và không bị đụng', () => {
  const { ss, sh } = ssWithRules(s => [
    ownStatusRule(s, 'Done', '#123456', '#654321'),
    foreignRule(s),
  ], ['Done', 'Testing']);
  const schema = {}; schema[DS1] = [statusOption('Done', 'green'), statusOption('Testing', 'blue')];
  const env = colorEnv(null, schema, ss);
  const r = env.sandbox.colorStatusesFromNotion();
  const rules = sh.getConditionalFormatRules();
  eq(rules.length, 3, 'rule màu Role cột D + 2 rule status');
  eq(rules[0].bg, '#000000', 'rule cột D vẫn ở index 0');
  eq(rules.find(x => x.text === 'Done').bg, '#DBEDDB', 'Done về green');
  eq(rules.find(x => x.text === 'Testing').bg, '#D3E5EF', 'Testing về blue');
  eq(r.kept, 1, 'chỉ giữ rule cột D');
  eq(r.rebuilt, 1, 'dựng lại rule Done đời cũ');
  eq(r.appended, 4, '2 status × (tab tháng + _TEMPLATE)');
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
t('rule cũ bị chặn đuôi (B2:B51) → dựng lại: chạy hết cột + đúng màu Notion', () => {
  const { ss, sh } = ssWithRules(s => [ownStatusRule(s, 'Testing', '#AA0011', '#BB2233', 51)], ['Testing']);
  const before = sh.getConditionalFormatRules()[0];
  eq(before.getRanges()[0].getRow() + before.getRanges()[0].getNumRows() - 1, 51, 'trước: chặn ở dòng 51');
  const schema = {}; schema[DS1] = [statusOption('Testing', 'blue')];
  const env = colorEnv(null, schema, ss);
  const r = env.sandbox.colorStatusesFromNotion();
  const after = sh.getConditionalFormatRules()[0];
  const rg = after.getRanges()[0];
  eq(sh.getConditionalFormatRules().length, 1, 'không nhân đôi');
  eq(rg.getRow() + rg.getNumRows() - 1, sh.getMaxRows(), 'sau: chạy hết cột B');
  eq(rg.getColumn(), 2, 'vẫn cột B');
  eq(after.bg, '#D3E5EF', 'nền về đúng blue'); eq(after.fg, '#337EA9', 'chữ về đúng blue');
  eq(after.criteria, TEXT_EQUAL_TO, 'vẫn khớp text tuyệt đối');
  eq(after.values.join(), 'Testing', 'vẫn phủ đúng status đó');
  eq(r.rebuilt, 1, 'báo cáo có dựng lại 1 rule');
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
  eq(sh.getConditionalFormatRules()[0].bg, '#000000', 'rule cột D vẫn nguyên sau 3 lần');
  eq(sh.getConditionalFormatRules().find(r => r.text === 'Done').bg, '#DBEDDB', 'màu status ổn định');
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
t('log tổng kết nêu rõ giữ / dựng lại / ghi bao nhiêu rule', () => {
  const { ss } = ssWithRules(s => [ownStatusRule(s, 'Done', '#123456', '#654321', 51)], ['Done']);
  const schema = {}; schema[DS1] = [statusOption('Done', 'green'), statusOption('Testing', 'blue')];
  const env = colorEnv(null, schema, ss);
  env.sandbox.colorStatusesFromNotion();
  ok(env.logs.some(l => l.indexOf('giữ nguyên') !== -1 && l.indexOf('dựng lại') !== -1 &&
                        l.indexOf('rule màu') !== -1), env.logs.join('\n'));
});
t('đường tự động trong syncNow cũng dựng lại rule đời cũ về đúng palette', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const old = ss.insertSheet('06/2026');
  old.getRange(2, 1, 1, 7).setValues([['T', 'Ready to Test', 1, 'Dev', false, 'link', 'z']]);
  old.setConditionalFormatRules([ownStatusRule(old, 'Ready to Test', '#123456', '#654321', 51)]);
  const schema = {}; schema[DS1] = [statusOption('Ready to Test', 'yellow'), statusOption('Done', 'green')];
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'Ready to Test', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', ss, schema, pages, now: T0 });
  env.sandbox.syncNow();
  const rules = old.getConditionalFormatRules();
  eq(rules.length, 2, 'đúng 2 rule: Ready to Test + Done');
  const rtt = rules.find(x => x.text === 'Ready to Test');
  eq(rtt.bg, '#FDECC8', 'về đúng yellow của Notion');
  eq(rtt.getRanges()[0].getNumRows(), old.getMaxRows() - 1, 'range chạy hết cột');
  ok(rules.find(x => x.text === 'Done'), 'status còn lại cũng có màu');
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
t('cache đời cũ (format rule khác) → sync sau tự dựng lại rule theo format mới', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const sh = ss.insertSheet('06/2026');
  sh.setConditionalFormatRules([ownStatusRule(sh, 'Ready to Test', '#FDECC8', '#CB912F')]);
  const cache = JSON.stringify({ map: { 'Ready to Test': 'yellow' }, ts: T0, fmt: STATUS_FMT - 1 });
  const schema = {}; schema[DS1] = [statusOption('Ready to Test', 'yellow')];
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'Ready to Test', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', ss, schema, pages, now: T0,
                        props: { STATUS_COLOR_CACHE: cache } });
  env.sandbox.syncNow();
  const rules = ss.getSheetByName('06/2026').getConditionalFormatRules();
  eq(rules.length, 1, 'không nhân đôi rule');
  eq(rules[0].bold, true, 'rule đời cũ được dựng lại theo format mới');
  eq(JSON.parse(env.props.STATUS_COLOR_CACHE).fmt, STATUS_FMT, 'cache ghi lại đúng format');
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
  const cache = JSON.stringify({ map: { 'Ready to Test': 'yellow' }, ts: T0, fmt: STATUS_FMT });
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

console.log('— Dòng add: chỉ được rơi vào dòng TRỐNG hết A..H —');
function ssWithMonth(tab, rowsFn) {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const sh = ss.insertSheet(tab);
  rowsFn(sh);
  return { ss, sh };
}
function addOnce(ss, nowMonth, props) {
  const pages = {}; pages[DS1] = [page('p9', 'Task mới', 'Ready to Test', 3, 'Dev')];
  const env = makeEnv({ nowMonth: nowMonth || '07/2026', pages, ss, props });
  return { env, r: env.sandbox.syncNow({ backfill: true }) };
}

t('dòng cuối trống cột A nhưng B..H còn data → add KHÔNG được đè lên nó', () => {
  const { ss, sh } = ssWithMonth('07/2026', s => {
    s.getRange(2, 1, 1, 7).setValues([['Task cũ', 'Done', 1, 'Dev', true, 'link', 'old1']]);
    s.getRange(3, 2, 1, 6).setValues([['Testing', 2, 'Dev', true, 'link', 'old2']]);
    s.getRange(3, 8).setValue('note anh gõ tay');
  });
  const { r } = addOnce(ss);
  eq(r.added, 1, 'task mới vẫn được thêm');
  eq(sh.getRange(3, 7).getValue(), 'old2', 'page id dòng 3 còn nguyên');
  eq(sh.getRange(3, 5).getValue(), true, 'Have dòng 3 còn nguyên');
  eq(sh.getRange(3, 8).getValue(), 'note anh gõ tay', 'Note dòng 3 còn nguyên');
  eq(sh.getRange(4, 1).getValue(), 'Task mới', 'task mới xuống dòng 4');
});
t('dòng dưới chỉ có Note (H) → add vẫn phải nhảy qua', () => {
  const { ss, sh } = ssWithMonth('07/2026', s => {
    s.getRange(2, 1, 1, 7).setValues([['Task cũ', 'Done', 1, 'Dev', true, 'link', 'old1']]);
    s.getRange(3, 8).setValue('⚠ ghi chú lạc dòng');
  });
  addOnce(ss);
  eq(sh.getRange(3, 8).getValue(), '⚠ ghi chú lạc dòng', 'note không bị đè');
  eq(sh.getRange(3, 1).getValue(), '', 'dòng 3 không bị ghi task');
  eq(sh.getRange(4, 1).getValue(), 'Task mới', 'task mới xuống dòng 4');
});
t('KPI ở cột I+ kéo xuống dưới vùng task → KHÔNG đẩy dòng add xuống', () => {
  const { ss, sh } = ssWithMonth('07/2026', s => {
    s.getRange(2, 1, 1, 7).setValues([['Task cũ', 'Done', 1, 'Dev', true, 'link', 'old1']]);
    s.getRange(30, 9).setValue('KPI tháng');
    s.getRange(31, 10).setValue(45000);
  });
  addOnce(ss);
  eq(sh.getRange(3, 1).getValue(), 'Task mới', 'add ngay dòng 3, không nhảy qua block KPI');
});
t('checkbox trống sẵn ở cột E (Sheets trả false) KHÔNG được tính là dòng có data', () => {
  const { ss, sh } = ssWithMonth('07/2026', s => {
    s.getRange(2, 1, 1, 7).setValues([['Task cũ', 'Done', 1, 'Dev', true, 'link', 'old1']]);
    for (let r = 3; r <= 50; r++) s.getRange(r, 5).setValue(false); // checkbox chưa tick
  });
  addOnce(ss);
  eq(sh.getRange(3, 1).getValue(), 'Task mới', 'add ngay dòng 3, không nhảy xuống dòng 51');
});
t('tab đã kín lưới → nới lưới rồi mới ghi, không kéo sập cả lượt sync', () => {
  const { ss, sh } = ssWithMonth('07/2026', s => {
    for (let r = 2; r <= s.getMaxRows(); r++) s.getRange(r, 1).setValue('cũ ' + r);
  });
  const before = sh.getMaxRows();
  const { r } = addOnce(ss);
  eq(r.added, 1, 'vẫn add được, không ném lỗi');
  ok(sh.getMaxRows() > before, 'lưới được nới: ' + before + ' → ' + sh.getMaxRows());
  eq(sh.getRange(before, 1).getValue(), 'cũ ' + before, 'dòng cuối cũ không bị đè');
  eq(sh.getRange(before + 1, 1).getValue(), 'Task mới', 'task mới nằm đúng dòng kế tiếp');
});
// Ca thật 2026-08-05: luật 8 dọn bản sao xong để lại lỗ ở dòng 2-9, data còn ở 10-12.
// Bản cũ nhảy xuống sau dòng cuối (13) nên lỗ nằm trống mãi.
t('có lỗ trống phía trên, data ở dưới → add LẤP LỖ, không rơi xuống đáy', () => {
  const { ss, sh } = ssWithMonth('07/2026', s => {
    s.getRange(10, 1, 1, 7).setValues([['Task cũ 1', 'Done', 1, 'Dev', true, 'link', 'old1']]);
    s.getRange(11, 1, 1, 7).setValues([['Task cũ 2', 'Done', 2, 'Dev', true, 'link', 'old2']]);
  });
  const { r } = addOnce(ss);
  eq(r.added, 1);
  eq(sh.getRange(2, 1).getValue(), 'Task mới', 'phải lấp vào dòng trống đầu tiên');
  eq(sh.getRange(10, 1).getValue(), 'Task cũ 1', 'data cũ không bị đụng');
  eq(sh.getRange(11, 7).getValue(), 'old2', 'và không bị đè');
});
t('lỗ trống ở GIỮA hai vùng data → vẫn lấp đúng lỗ đó', () => {
  const { ss, sh } = ssWithMonth('07/2026', s => {
    s.getRange(2, 1, 1, 7).setValues([['Task A', 'Done', 1, 'Dev', true, 'link', 'a1']]);
    s.getRange(5, 1, 1, 7).setValues([['Task B', 'Done', 2, 'Dev', true, 'link', 'b1']]);
  });
  addOnce(ss);
  eq(sh.getRange(3, 1).getValue(), 'Task mới', 'lấp dòng 3');
  eq(sh.getRange(5, 1).getValue(), 'Task B', 'dòng 5 nguyên vẹn');
});
t('tab trống hoàn toàn → dòng đầu tiên là dòng 2', () => {
  const { ss, sh } = ssWithMonth('07/2026', () => {});
  addOnce(ss);
  eq(sh.getRange(2, 1).getValue(), 'Task mới');
});
t('hai task trong cùng lượt → hai dòng liên tiếp, không đè nhau', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const pages = {}; pages[DS1] = [page('pa', 'Task A', 'Done', 1, 'Dev'),
                                  page('pb', 'Task B', 'Done', 2, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', pages, ss });
  const r = env.sandbox.syncNow({ backfill: true });
  eq(r.added, 2);
  const sh = ss.getSheetByName('07/2026');
  eq(sh.getRange(2, 1).getValue(), 'Task A'); eq(sh.getRange(3, 1).getValue(), 'Task B');
});

console.log('— Index: dòng còn page id nhưng trống cột A vẫn phải khớp được —');
t('dòng trống tên mà còn page id → update tại chỗ, không add lại', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const old = ss.insertSheet('06/2026');
  old.getRange(2, 1, 1, 7).setValues([['Neo', 'Done', 1, 'Dev', false, 'link', 'anchor']]);
  old.getRange(3, 2, 1, 6).setValues([['Testing', 2, 'Dev', true, 'link', 'px']]);
  const pages = {}; pages[DS1] = [page('px', 'Task X', 'Done', 5, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', pages, ss });
  const r = env.sandbox.syncNow({ backfill: true });
  eq(r.updated, 1, 'update'); eq(r.added, 0, 'không add lại');
  eq(old.getRange(3, 1).getValue(), 'Task X', 'tên được heal vào cột A');
  eq(old.getRange(3, 5).getValue(), true, 'Have giữ nguyên');
  ok(!ss.getSheetByName('07/2026'), 'không tạo tab tháng mới');
});

console.log('— Rule 6: task đã nằm ở tab tháng CŨ HƠN thì không kéo về tháng đang tính —');
function julWithHandRow(values) {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const jul = ss.insertSheet('07/2026');
  jul.getRange(2, 1, 1, values.length).setValues([values]);
  return { ss, jul };
}
t('tên trùng ở tab cũ, cột G TRỐNG → không add, page id được vá vào G', () => {
  const { ss, jul } = julWithHandRow(['Fix cart', 'Done', 2, 'Dev', true]);
  const pages = {}; pages[DS1] = [page('pfix', 'Fix cart', 'Done', 2, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  const r = env.sandbox.syncNow({ backfill: true });
  eq(r.added, 0, 'không add');
  eq(r.blockedOld, 1, 'đếm được ca bị chặn');
  eq(jul.getRange(2, 7).getValue(), 'pfix', 'page id được vá vào cột G');
  eq(jul.getRange(2, 5).getValue(), true, 'Have không bị đụng');
  ok(!ss.getSheetByName('08/2026'), 'không tạo tab tháng 8');
  ok(env.logs.some(l => l.indexOf('Fix cart') !== -1 && l.indexOf('07/2026') !== -1),
     'log nêu đích danh: ' + env.logs.join('\n'));
});
// Ca thật 2026-08-05: 4 task đã counted từ lâu, dòng tháng 7 bị cắt-dán thiếu cột G.
// Vá id nằm trong cổng "có vừa vượt mốc không" thì lượt sync 10 phút KHÔNG BAO GIỜ vào
// được (prev đã counted) → sheet nằm hỏng vĩnh viễn, phải có người nhớ bấm quét bù.
t('Sync now thường (KHÔNG backfill), task đã counted từ trước → vẫn tự vá id', () => {
  const { ss, jul } = julWithHandRow(['Fix cart', 'Done', 2, 'Dev', true]);
  const st = ss.insertSheet('_STATE');
  st.getRange(1, 1, 1, 2).setValues([['pageId', 'status']]);
  st.getRange(2, 1, 1, 2).setValues([['pfix', 'Done']]); // đã counted ở lượt trước
  const pages = {}; pages[DS1] = [page('pfix', 'Fix cart', 'Done', 2, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  const r = env.sandbox.syncNow(); // đúng đường trigger 10 phút chạy
  eq(jul.getRange(2, 7).getValue(), 'pfix', 'id phải được vá dù không bấm quét bù');
  eq(r.added, 0, 'không add sang tháng 8');
  eq(r.blockedOld, 1, 'đếm được ca nối lại với tháng cũ');
  ok(!ss.getSheetByName('08/2026'), 'không tạo tab tháng 8');
});
// Đúng cấu hình sheet thật lúc 2026-08-05: đã bấm ✅ nên 07/2026 đã chốt sổ. Chốt sổ
// chỉ chặn ADD dòng mới vào tab đó — vá id là UPDATE dòng sẵn có, phải vẫn chạy.
t('July đã chốt sổ → Sync now vẫn vá được id vào dòng July', () => {
  const { ss, jul } = julWithHandRow(['Fix cart', 'Done', 2, 'Dev', true]);
  const st = ss.insertSheet('_STATE');
  st.getRange(1, 1, 1, 2).setValues([['pageId', 'status']]);
  st.getRange(2, 1, 1, 2).setValues([['pfix', 'Done']]);
  const pages = {}; pages[DS1] = [page('pfix', 'Fix cart', 'Done', 2, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss, props: { CLOSED_THROUGH: '07/2026' } });
  const r = env.sandbox.syncNow();
  eq(jul.getRange(2, 7).getValue(), 'pfix', 'chốt sổ không được chặn việc vá id');
  eq(jul.getRange(2, 5).getValue(), true, 'Have vẫn nguyên');
  eq(r.added, 0);
});
t('Sync now thường, task CHƯA counted → vẫn vá id, vẫn không add', () => {
  const { ss, jul } = julWithHandRow(['Fix cart', 'In progress', 2, 'Dev', true]);
  const st = ss.insertSheet('_STATE');
  st.getRange(1, 1, 1, 2).setValues([['pageId', 'status']]);
  st.getRange(2, 1, 1, 2).setValues([['pfix', 'In progress']]);
  const pages = {}; pages[DS1] = [page('pfix', 'Fix cart', 'In progress', 2, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  const r = env.sandbox.syncNow();
  eq(jul.getRange(2, 7).getValue(), 'pfix', 'nối lại được thì nối, khỏi đợi tới lúc vượt mốc');
  eq(r.added, 0);
});
t('vá id theo tên → để lại dấu 🤖 ở cột Note để anh check được', () => {
  const { ss, jul } = julWithHandRow(['Fix cart', 'Done', 2, 'Dev', true]);
  const pages = {}; pages[DS1] = [page('pfix', 'Fix cart', 'Done', 2, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  env.sandbox.syncNow({ backfill: true });
  const note = String(jul.getRange(2, 8).getValue());
  ok(note.indexOf('\uD83E\uDD16') === 0 && note.indexOf('tên') !== -1,
     'Note phải mở đầu bằng dấu của script và nêu rõ gán theo tên: ' + note);
});
t('vá id theo tên → note anh tự gõ KHÔNG bị đè', () => {
  const { ss, jul } = julWithHandRow(['Fix cart', 'Done', 2, 'Dev', true]);
  jul.getRange(2, 8).setValue('note của anh');
  const pages = {}; pages[DS1] = [page('pfix', 'Fix cart', 'Done', 2, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  env.sandbox.syncNow({ backfill: true });
  eq(jul.getRange(2, 8).getValue(), 'note của anh', 'Note cũ còn nguyên');
  eq(jul.getRange(2, 7).getValue(), 'pfix', 'id vẫn được vá');
});
t('vá xong → lượt sau khớp bằng id, update tại chỗ ở tab cũ', () => {
  const { ss, jul } = julWithHandRow(['Fix cart', 'Testing', 2, 'Dev', true]);
  const pages = {}; pages[DS1] = [page('pfix', 'Fix cart', 'Done', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  env.sandbox.syncNow({ backfill: true });
  const r2 = env.sandbox.syncNow({ backfill: true });
  eq(r2.blockedOld, 0, 'không còn phải chặn theo tên');
  eq(r2.updated, 1, 'khớp bằng id');
  eq(jul.getRange(2, 2).getValue(), 'Done', 'status update tại tab cũ');
  eq(jul.getRange(2, 5).getValue(), true, 'Have vẫn nguyên');
});
t('tên trùng ở tab cũ nhưng G có id KHÁC → vẫn add + cờ ⚠ (rule 5 còn nguyên)', () => {
  const { ss, jul } = julWithHandRow(['Fix cart', 'Done', 2, 'Dev', true, 'link', 'idcu']);
  const pages = {}; pages[DS1] = [page('idmoi', 'Fix cart', 'Done', 2, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  const r = env.sandbox.syncNow({ backfill: true });
  eq(r.added, 1, 'vẫn add'); eq(r.suspect, 1, 'vẫn cảnh báo');
  eq(jul.getRange(2, 7).getValue(), 'idcu', 'G có sẵn KHÔNG bị ghi đè');
  const note = ss.getSheetByName('08/2026').getRange(2, 8).getValue();
  ok(String(note).indexOf('Nghi trùng') !== -1, 'cờ ⚠: ' + note);
});
t('tên trùng ở CHÍNH tab đang tính (G trống) → vẫn add, chỉ chặn tab cũ hơn', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const aug = ss.insertSheet('08/2026');
  aug.getRange(2, 1, 1, 5).setValues([['Fix cart', 'Done', 2, 'Dev', true]]);
  const pages = {}; pages[DS1] = [page('pfix', 'Fix cart', 'Done', 2, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  const r = env.sandbox.syncNow({ backfill: true });
  eq(r.added, 1, 'add bình thường'); eq(r.blockedOld, 0);
  eq(aug.getRange(2, 7).getValue(), '', 'không vá id vào dòng cùng tháng');
});
t('tên trùng ở tab MỚI HƠN (G trống) → vẫn add vào tháng đang tính', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const sep = ss.insertSheet('09/2026');
  sep.getRange(2, 1, 1, 5).setValues([['Fix cart', 'Done', 2, 'Dev', true]]);
  const pages = {}; pages[DS1] = [page('pfix', 'Fix cart', 'Done', 2, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  const r = env.sandbox.syncNow({ backfill: true });
  eq(r.added, 1); eq(r.blockedOld, 0);
});

console.log('— Chốt sổ tháng (CLOSED_THROUGH) —');
t('vắng CLOSED_THROUGH = chưa chốt tháng nào → hành vi như cũ', () => {
  const { sandbox } = makeEnv({ nowMonth: '08/2026' });
  eq(sandbox.closedThrough_(), null, 'không có watermark');
  eq(sandbox.isClosedMonth_('01/2020'), false, 'tháng cũ nhất cũng chưa chốt');
  eq(sandbox.activeMonth_(), '08/2026');
});
t('so tháng bằng số thứ tự, không so chuỗi (12/2025 < 01/2026)', () => {
  const { sandbox } = makeEnv({ nowMonth: '01/2026', props: { CLOSED_THROUGH: '12/2025' } });
  eq(sandbox.isClosedMonth_('12/2025'), true, '12/2025 đã chốt');
  eq(sandbox.isClosedMonth_('01/2026'), false, '01/2026 chưa chốt');
});
t('unpinMonth: gỡ ghim VÀ nâng watermark lên tháng liền trước', () => {
  const env = makeEnv({ nowMonth: '08/2026', props: { ACTIVE_MONTH: '07/2026' } });
  env.sandbox.unpinMonth();
  ok(!('ACTIVE_MONTH' in env.props), 'ghim đã gỡ');
  eq(env.props.CLOSED_THROUGH, '07/2026', 'chốt tới hết tháng 7');
  ok(env.ss.toasts[0].msg.indexOf('07/2026') !== -1, env.ss.toasts[0].msg);
});
t('unpinMonth monotonic: bấm lại ở tháng cũ hơn không hạ watermark', () => {
  const env = makeEnv({ nowMonth: '08/2026', props: { CLOSED_THROUGH: '08/2026' } });
  env.sandbox.unpinMonth();
  eq(env.props.CLOSED_THROUGH, '08/2026', 'không hạ xuống 07/2026');
});
t('unpinMonth bấm nhiều lần cùng tháng → idempotent', () => {
  const env = makeEnv({ nowMonth: '08/2026' });
  env.sandbox.unpinMonth(); env.sandbox.unpinMonth(); env.sandbox.unpinMonth();
  eq(env.props.CLOSED_THROUGH, '07/2026');
});
t('ghim trỏ vào tháng đã chốt → bỏ qua ghim, add vào tháng lịch', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE'); ss.insertSheet('07/2026');
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'Done', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', ss, pages,
                        props: { ACTIVE_MONTH: '07/2026', CLOSED_THROUGH: '07/2026' } });
  const r = env.sandbox.syncNow({ backfill: true });
  eq(r.month, '08/2026', 'tháng đang tính quay về tháng lịch');
  eq(r.added, 1);
  eq(ss.getSheetByName('07/2026').dataRowCount(), 0, 'tab tháng 7 không nhận dòng mới');
  ok(env.logs.some(l => l.indexOf('chốt sổ') !== -1), 'có log nêu lý do: ' + env.logs.join('\n'));
});
t('tháng đang tính đã chốt → KHÔNG add, KHÔNG tạo tab, đếm blockedClosed', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'Done', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', ss, pages, props: { CLOSED_THROUGH: '08/2026' } });
  const r = env.sandbox.syncNow({ backfill: true });
  eq(r.added, 0, 'không add'); eq(r.blockedClosed, 1, 'đếm được');
  ok(!ss.getSheetByName('08/2026'), 'không tạo tab tháng đã chốt');
  ok(env.logs.some(l => l.indexOf('Chặn add') !== -1), env.logs.join('\n'));
});
t('tháng đã chốt vẫn UPDATE Status/Tên/Point/Role; Have + Note bất khả xâm phạm', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const jul = ss.insertSheet('07/2026');
  jul.getRange(2, 1, 1, 7).setValues([['Tên cũ', 'Testing', 2, 'Reviewer', true, 'link', 'px']]);
  jul.getRange(2, 8).setValue('note của anh');
  const pages = {}; pages[DS1] = [page('px', 'Tên mới', 'Done', 5, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', ss, pages, props: { CLOSED_THROUGH: '07/2026' } });
  const r = env.sandbox.syncNow({ backfill: true });
  eq(r.updated, 1);
  const row = jul.getRange(2, 1, 1, 8).getValues()[0];
  eq(row[0], 'Tên mới', 'tên'); eq(row[1], 'Done', 'status');
  eq(row[2], 5, 'point'); eq(row[3], 'Dev', 'role');
  eq(row[4], true, 'Have giữ nguyên'); eq(row[7], 'note của anh', 'Note giữ nguyên');
});
t('backfillCounted: alert nêu số task bị chặn vì tháng đã chốt', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'Done', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', ss, pages, props: { CLOSED_THROUGH: '08/2026' } });
  env.sandbox.backfillCounted();
  ok(env.ui.alerts[0].indexOf('chốt') !== -1 && env.ui.alerts[0].indexOf('08/2026') !== -1,
     'alert: ' + env.ui.alerts[0]);
});
t('backfillCounted: alert nêu số task bỏ qua vì đã có ở tháng cũ', () => {
  const { ss } = julWithHandRow(['Fix cart', 'Done', 2, 'Dev', true]);
  const pages = {}; pages[DS1] = [page('pfix', 'Fix cart', 'Done', 2, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', ss, pages });
  env.sandbox.backfillCounted();
  ok(env.ui.alerts[0].indexOf('tháng cũ') !== -1, 'alert: ' + env.ui.alerts[0]);
});
t('pinPrevMonth khi tháng trước đã chốt: bấm Không → không ghim, không hạ watermark', () => {
  const env = makeEnv({ nowMonth: '08/2026', props: { CLOSED_THROUGH: '07/2026' }, uiAnswer: 'NO' });
  env.sandbox.pinPrevMonth();
  ok(!('ACTIVE_MONTH' in env.props), 'không ghim');
  eq(env.props.CLOSED_THROUGH, '07/2026', 'watermark giữ nguyên');
  ok(env.ui.alerts[0].indexOf('07/2026') !== -1, 'có hỏi: ' + env.ui.alerts[0]);
});
t('pinPrevMonth khi tháng trước đã chốt: bấm Có → hạ watermark + ghim', () => {
  const env = makeEnv({ nowMonth: '08/2026', props: { CLOSED_THROUGH: '07/2026' }, uiAnswer: 'YES' });
  env.sandbox.pinPrevMonth();
  eq(env.props.ACTIVE_MONTH, '07/2026', 'đã ghim lại');
  eq(env.props.CLOSED_THROUGH, '06/2026', 'chỉ mở lại đúng tháng 7');
  eq(env.sandbox.activeMonth_(), '07/2026', 'ghim có hiệu lực trở lại');
});
t('pinPrevMonth khi đã chốt mà KHÔNG có UI → không tự mở lại', () => {
  const env = makeEnv({ nowMonth: '08/2026', props: { CLOSED_THROUGH: '07/2026' }, noUi: true });
  env.sandbox.pinPrevMonth();
  ok(!('ACTIVE_MONTH' in env.props), 'không ghim');
  eq(env.props.CLOSED_THROUGH, '07/2026', 'watermark giữ nguyên');
});
t('pinPrevMonth khi tháng trước CHƯA chốt → ghim thẳng, không hỏi', () => {
  const env = makeEnv({ nowMonth: '08/2026', props: { CLOSED_THROUGH: '06/2026' } });
  env.sandbox.pinPrevMonth();
  eq(env.props.ACTIVE_MONTH, '07/2026');
  eq(env.ui.alerts.length, 0, 'không hỏi gì');
});
t('onOpen: đang có watermark → tên menu mang dấu đã chốt', () => {
  const env = makeEnv({ nowMonth: '08/2026', props: { CLOSED_THROUGH: '07/2026' } });
  env.sandbox.onOpen();
  ok(env.ui.menus[0].title.indexOf('07/2026') !== -1, 'title: ' + env.ui.menus[0].title);
});
t('onOpen: ghim bị bỏ vì tháng đó đã chốt → toast nhắc', () => {
  const env = makeEnv({ nowMonth: '08/2026',
                        props: { ACTIVE_MONTH: '07/2026', CLOSED_THROUGH: '07/2026' } });
  env.sandbox.onOpen();
  eq(env.ss.toasts.length, 1, 'có toast nhắc');
  ok(env.ss.toasts[0].msg.indexOf('07/2026') !== -1, env.ss.toasts[0].msg);
});
t('onOpen: chưa chốt gì → menu không nhắc chốt, không toast', () => {
  const env = makeEnv({ nowMonth: '08/2026' });
  env.sandbox.onOpen();
  ok(env.ui.menus[0].title.indexOf('chốt') === -1, 'title: ' + env.ui.menus[0].title);
  eq(env.ss.toasts.length, 0);
});

console.log('— 🩺 Chẩn đoán sheet (chỉ đọc) —');
t('có trong menu', () => {
  const env = makeEnv({ nowMonth: '07/2026' });
  env.sandbox.onOpen();
  const items = env.ui.menus[0].items.filter(i => !i.sep);
  ok(items.some(i => i.fn === 'diagnoseSheet'), 'menu: ' + items.map(i => i.label).join(' | '));
});
t('điểm mặt tab KHÔNG khớp MM/YYYY (đổi tên / thiếu số 0 / thừa khoảng trắng)', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  ss.insertSheet('07/2026'); ss.insertSheet('7/2026'); ss.insertSheet('06/2026 (chốt)');
  const env = makeEnv({ nowMonth: '08/2026', ss });
  const d = env.sandbox.diagnoseSheet();
  eq(d.monthTabs, 1, 'chỉ 1 tab hợp lệ');
  eq(d.alienTabs.length, 2, 'điểm mặt 2 tab lạ');
  ok(d.alienTabs.indexOf('7/2026') !== -1 && d.alienTabs.indexOf('06/2026 (chốt)') !== -1,
     d.alienTabs.join(' | '));
  ok(env.ui.alerts[0].indexOf('7/2026') !== -1, 'alert nêu tên tab lạ: ' + env.ui.alerts[0]);
});
t('tab thường (tên không giống tháng, không giữ task) KHÔNG bị bắt đổi tên', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  ss.insertSheet('07/2026'); ss.insertSheet('Ghi chú'); ss.insertSheet('7/2026');
  const env = makeEnv({ nowMonth: '08/2026', ss });
  const d = env.sandbox.diagnoseSheet();
  eq(d.alienTabs.length, 1, 'chỉ tab gõ sai tên bị điểm mặt: ' + d.alienTabs.join(' | '));
  eq(d.alienTabs[0], '7/2026');
  ok(d.lines.join('\n').indexOf('"Ghi chú" — tab thường') !== -1,
     'tab thường chỉ được ghi nhận trung tính');
});
t('tab thường NHƯNG đang giữ dòng task → vẫn phải bị điểm mặt', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE'); ss.insertSheet('07/2026');
  const stray = ss.insertSheet('Ghi chú');
  stray.getRange(2, 1, 1, 7).setValues([['Task lạc', 'Done', 1, 'Dev', false, 'link', 'plac']]);
  const env = makeEnv({ nowMonth: '08/2026', ss });
  const d = env.sandbox.diagnoseSheet();
  eq(d.alienTabs.length, 1, 'tab giữ task thì không được bỏ qua');
  eq(d.alienTabs[0], 'Ghi chú');
});
t('đếm dòng trống cột A và dòng thiếu page id', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const sh = ss.insertSheet('07/2026');
  sh.getRange(2, 1, 1, 7).setValues([['A', 'Done', 1, 'Dev', false, 'link', 'p1']]);
  sh.getRange(3, 2, 1, 6).setValues([['Done', 1, 'Dev', false, 'link', 'p2']]); // trống cột A
  sh.getRange(4, 1, 1, 5).setValues([['C', 'Done', 1, 'Dev', false]]);          // trống cột G
  const env = makeEnv({ nowMonth: '07/2026', ss });
  const d = env.sandbox.diagnoseSheet();
  eq(d.gapRows, 1, 'dòng trống tên'); eq(d.missingPid, 1, 'dòng thiếu page id');
  eq(d.dataRows, 3, 'tổng dòng data');
});
t('so dòng cuối theo cột A với dòng cuối theo A..H', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const sh = ss.insertSheet('07/2026');
  sh.getRange(2, 1, 1, 7).setValues([['A', 'Done', 1, 'Dev', false, 'link', 'p1']]);
  sh.getRange(5, 2).setValue('Done');
  const env = makeEnv({ nowMonth: '07/2026', ss });
  const d = env.sandbox.diagnoseSheet();
  const tab = d.tabs.find(x => x.name === '07/2026');
  eq(tab.lastByA, 2, 'cột A dừng ở dòng 2'); eq(tab.lastByAH, 5, 'A..H tới dòng 5');
});
t('phát hiện page id trùng và tên trùng giữa các tab', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const a = ss.insertSheet('06/2026'), b = ss.insertSheet('07/2026');
  a.getRange(2, 1, 1, 7).setValues([['Fix cart', 'Done', 1, 'Dev', false, 'link', 'dup']]);
  b.getRange(2, 1, 1, 7).setValues([['Fix cart', 'Done', 1, 'Dev', false, 'link', 'dup']]);
  const env = makeEnv({ nowMonth: '07/2026', ss });
  const d = env.sandbox.diagnoseSheet();
  eq(d.dupPid.length, 1, 'trùng id'); eq(d.dupTitle.length, 1, 'trùng tên');
  ok(d.dupPid[0].indexOf('06/2026') !== -1 && d.dupPid[0].indexOf('07/2026') !== -1, d.dupPid[0]);
});
t('tab LẠ cũng được quét → bắt được task bị add lại từ tab lạ sang tab tháng', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const alien = ss.insertSheet('7/2026'), aug = ss.insertSheet('08/2026');
  alien.getRange(2, 1, 1, 7).setValues([['Fix cart', 'Done', 2, 'Dev', true, 'link', 'pfix']]);
  aug.getRange(2, 1, 1, 7).setValues([['Fix cart', 'Done', 2, 'Dev', false, 'link', 'pfix']]);
  const env = makeEnv({ nowMonth: '08/2026', ss });
  const d = env.sandbox.diagnoseSheet();
  eq(d.monthTabs, 1, 'chỉ 08/2026 là tab tháng hợp lệ');
  eq(d.dupPid.length, 1, 'thấy page id trùng dù một bên nằm ở tab lạ');
  ok(d.dupPid[0].indexOf('7/2026') !== -1 && d.dupPid[0].indexOf('08/2026') !== -1, d.dupPid[0]);
});
t('phân loại rule màu status: script nhận vs lạ vs không đọc được', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const sh = ss.insertSheet('07/2026');
  sh.setConditionalFormatRules([
    mkRule({ text: 'Done', bg: '#DBEDDB', fg: '#448361', criteria: TEXT_EQUAL_TO,
             values: ['Done'], ranges: [sh.getRange('B2:B')] }),          // đúng chip Notion
    mkRule({ text: 'Testing', bg: '#123456', criteria: TEXT_EQUAL_TO,
             values: ['Testing'], ranges: [sh.getRange('B2:B')] }),       // đời cũ: thiếu màu chữ
    mkRule({ text: 'x', bg: '#111111', fg: '#eeeeee', criteria: TEXT_CONTAINS,
             values: ['Test'], ranges: [sh.getRange('B2:B')] }),          // không đọc ra status
    foreignRule(sh),                                                      // cột D, không tính
  ]);
  const env = makeEnv({ nowMonth: '07/2026', ss });
  const d = env.sandbox.diagnoseSheet();
  const tab = d.tabs.find(x => x.name === '07/2026');
  eq(tab.ownRules.join(), 'Done', 'script nhận là của mình');
  eq(tab.foreignRules.join(), 'Testing', 'rule đời cũ bị coi là lạ');
  eq(tab.unreadableRules, 1, 'rule không đọc ra status');
});
t('đo trước bán kính nổ của quét bù: tách task sẽ thêm vs task anh đã xoá (stamped)', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const aug = ss.insertSheet('08/2026');
  aug.getRange(2, 1, 1, 7).setValues([['Có rồi', 'Done', 1, 'Dev', false, 'link', 'pcó']]);
  const st = ss.insertSheet('_STATE');
  st.getRange(1, 1, 1, 3).setValues([['pageId', 'status', 'stamped']]);
  st.getRange(2, 1, 4, 3).setValues([
    ['pcó', 'Done', 1],              // đã có dòng -> không tính
    ['pthiếu1', 'Waiting to test', ''], // counted, CHƯA TỪNG add -> quét bù sẽ thêm
    ['pxoá', 'Done', 1],             // counted, từng add, giờ mất dòng -> anh đã xoá
    ['pchưa', 'In progress', ''],    // chưa tới mốc -> không tính
  ]);
  const env = makeEnv({ nowMonth: '08/2026', ss });
  const d = env.sandbox.diagnoseSheet();
  eq(d.pendingBackfill, 1, 'chỉ đếm task counted chưa từng được add');
  eq(d.deletedStamped, 1, 'task từng add mà mất dòng = đã xoá, không tính vào bán kính');
  ok(env.ui.alerts[0].indexOf('Quét bù sẽ thêm ~1') !== -1, 'alert nêu số: ' + env.ui.alerts[0]);
  ok(env.ui.alerts[0].indexOf('đã xoá tay') !== -1, 'alert nêu số bị bỏ qua: ' + env.ui.alerts[0]);
});
// F5 (2026-08-06, sửa lại quyết định cũ): _STATE format cũ KHÔNG còn suy "counted =
// đã từng add". Dấu được dựng lại từ sheet ở lượt sync tới, nên pid counted vắng dòng
// là ứng viên quét bù chứ không phải task đã xoá — và bán kính nổ phải nói đúng như vậy.
t('bán kính nổ với _STATE format cũ: counted vắng dòng là ứng viên quét bù (cận trên)', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE'); ss.insertSheet('08/2026');
  const st = ss.insertSheet('_STATE');
  st.getRange(1, 1, 1, 2).setValues([['pageId', 'status']]);
  st.getRange(2, 1, 1, 2).setValues([['pthiếu1', 'Waiting to test']]);
  const env = makeEnv({ nowMonth: '08/2026', ss });
  const d = env.sandbox.diagnoseSheet();
  eq(d.pendingBackfill, 1, 'format cũ: counted vắng dòng vẫn được quét bù cứu');
  eq(d.deletedStamped, 0, 'không còn bị gán nhãn "anh đã xoá"');
  ok(d.lines.some(l => l.indexOf('CẬN TRÊN') !== -1), 'báo rõ đây là cận trên: ' + d.lines.join('\n'));
});
t('chỉ ĐỌC: không sửa dòng nào, không đụng rule, không tạo tab', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const sh = ss.insertSheet('07/2026');
  sh.getRange(2, 1, 1, 5).setValues([['A', 'Done', 1, 'Dev', true]]);
  sh.setConditionalFormatRules([foreignRule(sh)]);
  const before = JSON.stringify(sh.data), tabs = ss.getSheets().length;
  const env = makeEnv({ nowMonth: '07/2026', ss });
  env.sandbox.diagnoseSheet();
  eq(JSON.stringify(sh.data), before, 'không đổi 1 ô nào');
  eq(sh.cfWrites, 1, 'không ghi lại rule (1 lần là do test set trước)');
  eq(ss.getSheets().length, tabs, 'không tạo tab');
});
t('không có UI (chạy từ editor) → báo cáo rơi xuống log, không ném lỗi', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE'); ss.insertSheet('7/2026');
  const env = makeEnv({ nowMonth: '07/2026', ss, noUi: true });
  const d = env.sandbox.diagnoseSheet();
  eq(d.alienTabs.length, 1);
  ok(env.logs.some(l => l.indexOf('7/2026') !== -1), 'log có nội dung: ' + env.logs.join('\n'));
});

console.log('— Màu status: mọi tab phải hội tụ về cùng bảng màu —');
t('rule đời cũ chỉ có nền (thiếu màu chữ) → dựng lại theo palette hiện tại', () => {
  const { ss, sh } = ssWithRules(s => [
    mkRule({ text: 'Done', bg: '#AABBCC', criteria: TEXT_EQUAL_TO, values: ['Done'],
             ranges: [s.getRange('B2:B')] }),
  ], ['Done']);
  const schema = {}; schema[DS1] = [statusOption('Done', 'green')];
  const env = colorEnv(null, schema, ss);
  env.sandbox.colorStatusesFromNotion();
  const rules = sh.getConditionalFormatRules().filter(r => r.text === 'Done');
  eq(rules.length, 1, 'không nhân đôi');
  eq(rules[0].bg, '#DBEDDB', 'nền theo palette hiện tại');
  eq(rules[0].fg, '#448361', 'chữ theo palette hiện tại');
});
t('tab cũ (rule đời cũ) và tab mới (rule sạch) → sau sync giống hệt nhau', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const oldTab = ss.insertSheet('05/2026'), newTab = ss.insertSheet('06/2026');
  oldTab.getRange(2, 1, 1, 7).setValues([['T', 'Done', 1, 'Dev', false, 'link', 'a']]);
  newTab.getRange(2, 1, 1, 7).setValues([['T2', 'Done', 1, 'Dev', false, 'link', 'b']]);
  // Rule đời cũ THẬT: chỉ set nền, chưa có màu chữ, range còn chặn đuôi.
  oldTab.setConditionalFormatRules([
    mkRule({ text: 'Done', bg: '#FDECC8', criteria: TEXT_EQUAL_TO,
             values: ['Done'], ranges: [oldTab.getRange(2, 2, 50, 1)] }),
  ]);
  const schema = {}; schema[DS1] = [statusOption('Done', 'green')];
  const env = colorEnv(null, schema, ss);
  env.sandbox.colorStatusesFromNotion();
  const a = oldTab.getConditionalFormatRules(), b = newTab.getConditionalFormatRules();
  eq(a.length, 1); eq(b.length, 1);
  eq(a[0].bg, b[0].bg, 'cùng nền'); eq(a[0].fg, b[0].fg, 'cùng chữ');
  eq(a[0].getRanges()[0].getNumRows(), oldTab.getMaxRows() - 1, 'range cũ chặn đuôi được dựng lại hết cột');
});
t('tab tháng MỚI tạo ra cùng màu với tab đã có (đường cache)', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const old = ss.insertSheet('06/2026');
  old.getRange(2, 1, 1, 7).setValues([['T', 'Ready to Test', 1, 'Dev', false, 'link', 'a']]);
  const schema = {}; schema[DS1] = [statusOption('Ready to Test', 'yellow')];
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'Ready to Test', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', ss, schema, pages, now: T0 });
  env.sandbox.syncNow({ backfill: true });
  const fresh = ss.getSheetByName('07/2026');
  eq(fresh.getConditionalFormatRules().length, old.getConditionalFormatRules().length, 'cùng số rule');
  eq(fresh.getConditionalFormatRules()[0].bg, old.getConditionalFormatRules()[0].bg, 'cùng màu');
});
t('rule màu cho status Notion KHÔNG còn → giữ nguyên, không bị xoá màu', () => {
  const { ss, sh } = ssWithRules(s => [
    ownStatusRule(s, 'Status Notion đã bỏ', '#123456', '#654321'),
  ], ['Status Notion đã bỏ']);
  const schema = {}; schema[DS1] = [statusOption('Done', 'green')];
  const env = colorEnv(null, schema, ss);
  const r = env.sandbox.colorStatusesFromNotion();
  const kept = sh.getConditionalFormatRules().find(x => x.text === 'Status Notion đã bỏ');
  ok(kept, 'rule còn đó'); eq(kept.bg, '#123456', 'màu không đổi');
  eq(r.orphans.length, 0, 'đã có rule trên tab nên không báo thiếu màu');
});
t('applyToTabs_ lỗi giữa chừng → cache KHÔNG claim thành công, lượt sau thử lại', () => {
  const ss = new MockSS(); const tpl = ss.insertSheet('_TEMPLATE');
  const a = ss.insertSheet('05/2026'), b = ss.insertSheet('06/2026');
  a.getRange(2, 1, 1, 7).setValues([['T', 'Done', 1, 'Dev', false, 'link', 'a']]);
  b.getRange(2, 1, 1, 7).setValues([['T2', 'Done', 1, 'Dev', false, 'link', 'b']]);
  const schema = {}; schema[DS1] = [statusOption('Done', 'green')];
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'Done', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', ss, schema, pages, now: T0 });
  const boom = b.setConditionalFormatRules.bind(b);
  b.setConditionalFormatRules = () => { throw new Error('Sheets quota'); };
  env.sandbox.syncNow();
  ok(!env.props.STATUS_COLOR_CACHE, 'cache không được ghi khi áp lỗi');
  eq(b.getConditionalFormatRules().length, 0, 'tab lỗi chưa có màu');
  b.setConditionalFormatRules = boom;
  env.sandbox.syncNow();
  eq(b.getConditionalFormatRules().length, 1, 'lượt sau tự vá lại tab lỗi');
  eq(a.getConditionalFormatRules().length, 1, 'tab kia không bị nhân đôi rule');
  ok(env.props.STATUS_COLOR_CACHE, 'áp xong mới ghi cache');
  eq(tpl.getConditionalFormatRules().length, 1, '_TEMPLATE cũng đủ màu');
});

console.log('— Rule 8: cùng task nằm ở 2 tab tháng → phải bị chỉ mặt, không im lặng —');
// Ca thật 2026-08-05: id nằm ở dòng tháng 8, dòng tháng 7 trống id. byPid bám tháng 8
// rồi return, nên luật 7 không bao giờ với tới dòng tháng 7 — nó mồ côi vĩnh viễn.
function twoTabTwin(julNote) {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const jul = ss.insertSheet('07/2026');
  jul.getRange(2, 1, 1, 6).setValues([['Fix cart', 'Waiting to test', 2, 'Reviewer', true, 'link']]);
  if (julNote) jul.getRange(2, 8).setValue(julNote);
  const aug = ss.insertSheet('08/2026');
  aug.getRange(2, 1, 1, 7).setValues([['Fix cart', 'Waiting to test', 2, 'Reviewer', false, 'link', 'pfix']]);
  return { ss, jul, aug };
}
t('trùng RÕ RÀNG (id bên kia trống) → DỌN bản sao tháng 8, giữ tháng 7, vá id', () => {
  const { ss, jul, aug } = twoTabTwin();
  const pages = {}; pages[DS1] = [page('pfix', 'Fix cart', 'Done', 2, 'Reviewer')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  const r = env.sandbox.syncNow();
  eq(r.dupCleared, 1, 'phải dọn đúng 1 bản sao');
  eq(r.added, 0, 'không add thêm');
  eq(aug.getRange(2, 1).getValue(), '', 'dòng tháng 8 bị dọn sạch tên');
  eq(aug.getRange(2, 7).getValue(), '', 'và sạch cả page id');
  eq(jul.getRange(2, 1).getValue(), 'Fix cart', 'dòng tháng 7 còn nguyên');
  eq(jul.getRange(2, 7).getValue(), 'pfix', 'tháng 7 được vá id');
  eq(jul.getRange(2, 2).getValue(), 'Done', 'update rơi vào dòng được giữ, không phải dòng bị dọn');
  eq(jul.getRange(2, 5).getValue(), true, 'Have của tháng 7 nguyên vẹn');
});
t('KPI ở cột I+ cùng dòng với bản sao → KHÔNG bị dọn theo', () => {
  const { ss, aug } = twoTabTwin();
  aug.getRange(2, 9).setValue('Tổng số task');
  aug.getRange(2, 10).setValue(9);
  const pages = {}; pages[DS1] = [page('pfix', 'Fix cart', 'Done', 2, 'Reviewer')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  env.sandbox.syncNow();
  eq(aug.getRange(2, 1).getValue(), '', 'task bị dọn');
  eq(aug.getRange(2, 9).getValue(), 'Tổng số task', 'khối KPI còn nguyên');
  eq(aug.getRange(2, 10).getValue(), 9, 'số KPI còn nguyên');
});
// Garry chốt 2026-08-05: chốt sổ cấm ĐÚNG MỘT việc là thêm dòng mới. Dọn bản sao vẫn
// chạy kể cả trong tháng đã chốt. Test này khoá quyết định đó lại — hệ quả (KPI hai
// tháng đã chốt đổi theo) là đã biết và đã chấp nhận.
t('bản sao nằm ở tháng ĐÃ CHỐT → vẫn dọn, chốt sổ chỉ cấm thêm dòng mới', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const jun = ss.insertSheet('06/2026');
  jun.getRange(2, 1, 1, 7).setValues([['Fix cart', 'Done', 2, 'Dev', true, 'link', '']]);
  const jul = ss.insertSheet('07/2026');
  jul.getRange(2, 1, 1, 7).setValues([['Fix cart', 'Done', 2, 'Dev', true, 'link', 'pfix']]);
  const pages = {}; pages[DS1] = [page('pfix', 'Fix cart', 'Done', 2, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss, props: { CLOSED_THROUGH: '07/2026' } });
  const r = env.sandbox.syncNow();
  eq(r.dupCleared, 1, 'tháng đã chốt vẫn được dọn bản sao');
  eq(jun.getRange(2, 1).getValue(), 'Fix cart', 'giữ dòng ở tháng cũ nhất');
  eq(jun.getRange(2, 7).getValue(), 'pfix', 'và vá id vào dòng giữ');
  eq(jul.getRange(2, 1).getValue(), '', 'dòng tháng 7 bị dọn dù tháng 7 đã chốt');
  eq(r.added, 0, 'nhưng tuyệt đối không thêm dòng mới vào tháng đã chốt');
});
t('tháng đã chốt: cấm THÊM dòng, không cấm gì khác', () => {
  const { ss, jul } = julWithHandRow(['Task cũ', 'Done', 2, 'Dev', true]);
  const pages = {}; pages[DS1] = [page('pmoi', 'Task hoàn toàn mới', 'Done', 5, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', pages, ss, props: { CLOSED_THROUGH: '07/2026' } });
  const r = env.sandbox.syncNow({ backfill: true });
  eq(r.added, 0, 'không add vào tháng đã chốt');
  eq(r.blockedClosed, 1, 'và đếm được ca bị chặn');
  eq(jul.getRange(3, 1).getValue(), '', 'không có dòng mới nào mọc ra');
});
t('trùng MỜ (id khác hẳn) → KHÔNG dọn, chỉ ghi Note', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const jul = ss.insertSheet('07/2026');
  jul.getRange(2, 1, 1, 7).setValues([['Fix cart', 'Done', 2, 'Dev', true, 'link', 'idkhac']]);
  const aug = ss.insertSheet('08/2026');
  aug.getRange(2, 1, 1, 7).setValues([['Fix cart', 'Waiting to test', 2, 'Dev', false, 'link', 'pfix']]);
  const pages = {}; pages[DS1] = [page('pfix', 'Fix cart', 'Done', 2, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  const r = env.sandbox.syncNow();
  eq(r.dupCleared, 0, 'hai page Notion khác nhau — không được tự dọn');
  eq(r.dupFlagged, 1, 'nhưng phải cảnh báo');
  eq(jul.getRange(2, 1).getValue(), 'Fix cart', 'dòng tháng 7 còn nguyên');
  eq(aug.getRange(2, 1).getValue(), 'Fix cart', 'dòng tháng 8 cũng còn nguyên');
  ok(String(aug.getRange(2, 8).getValue()).indexOf('07/2026') !== -1, 'Note chỉ đích danh tab kia');
});
t('không có bản sao ở tab khác → không ghi Note gì cả', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const aug = ss.insertSheet('08/2026');
  aug.getRange(2, 1, 1, 7).setValues([['Fix cart', 'Waiting to test', 2, 'Dev', false, 'link', 'pfix']]);
  const pages = {}; pages[DS1] = [page('pfix', 'Fix cart', 'Done', 2, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  const r = env.sandbox.syncNow();
  eq(r.dupFlagged, 0);
  eq(aug.getRange(2, 8).getValue(), '', 'không được bôi Note vô cớ');
});
t('dọn bản sao nhưng Note anh tự gõ trên dòng đó → GIỮ lại', () => {
  const { ss, aug } = twoTabTwin();
  aug.getRange(2, 8).setValue('note của anh');
  const pages = {}; pages[DS1] = [page('pfix', 'Fix cart', 'Done', 2, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  const r = env.sandbox.syncNow();
  eq(r.dupCleared, 1, 'vẫn dọn');
  eq(aug.getRange(2, 1).getValue(), '', 'task bị dọn');
  eq(aug.getRange(2, 8).getValue(), 'note của anh', 'chữ của anh không bao giờ bị xoá');
  ok(env.logs.some(l => l.indexOf('GIỮ lại note') !== -1), 'log báo đã giữ note: ' + env.logs.join('\n'));
});
t('note anh gõ mở đầu bằng icon KHÁC → vẫn là của anh, không bị dọn', () => {
  const { ss, aug } = twoTabTwin();
  aug.getRange(2, 8).setValue('📝 Task trống, không đánh point, không ảnh hưởng');
  const pages = {}; pages[DS1] = [page('pfix', 'Fix cart', 'Done', 2, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  env.sandbox.syncNow();
  eq(aug.getRange(2, 8).getValue(), '📝 Task trống, không đánh point, không ảnh hưởng',
     'icon của anh không được nhận vơ thành note script');
});
t('note đời cũ (tiền tố ⚠ tiếng Việt) vẫn được nhận là của script', () => {
  const { ss, aug } = twoTabTwin();
  aug.getRange(2, 8).setValue('⚠ Nghi trùng "Fix cart" ở tab 07/2026 — check & xoá nếu trùng');
  const pages = {}; pages[DS1] = [page('pfix', 'Fix cart', 'Done', 2, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  env.sandbox.syncNow();
  eq(aug.getRange(2, 8).getValue(), '', 'note đời cũ vẫn dọn được, không kẹt vĩnh viễn');
});
t('note do CHÍNH script ghi thì dọn được, không để lại rác', () => {
  const { ss, aug } = twoTabTwin();
  aug.getRange(2, 8).setValue('\uD83E\uDD16 Nghi trùng: task này cũng nằm ở 07/2026 dòng 2');
  const pages = {}; pages[DS1] = [page('pfix', 'Fix cart', 'Done', 2, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  env.sandbox.syncNow();
  eq(aug.getRange(2, 8).getValue(), '', 'note của script bị dọn theo');
});

console.log('— Dropdown status: danh sách phải lớn theo Notion, không gắn cờ oan —');
function validationOn(sh) { return sh.validations.filter(v => v.col === 2 && v.row === 2); }
t('dropdown cột Status dựng từ đúng danh sách status của Notion', () => {
  const ss = new MockSS(); const tpl = ss.insertSheet('_TEMPLATE');
  const jul = ss.insertSheet('07/2026');
  const env = makeEnv({ nowMonth: '07/2026', ss,
    schema: { [DS1]: [{ name: 'QA/UAT', color: 'blue' }, { name: 'Waiting to launch', color: 'pink' }],
              [DS2]: [{ name: 'Done', color: 'green' }] } });
  env.sandbox.syncNow({ backfill: true });
  [tpl, jul].forEach(sh => {
    const v = validationOn(sh);
    ok(v.length >= 1, 'thiếu dropdown ở tab ' + sh.getName());
    const vals = v[v.length - 1].rule.values;
    ok(vals.indexOf('QA/UAT') !== -1 && vals.indexOf('Waiting to launch') !== -1,
       'dropdown thiếu status mới: ' + vals.join(', '));
  });
});
t('dropdown chỉ cảnh báo, KHÔNG chặn ghi', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE'); const jul = ss.insertSheet('07/2026');
  const env = makeEnv({ nowMonth: '07/2026', ss,
    schema: { [DS1]: [{ name: 'Done', color: 'green' }], [DS2]: [] } });
  env.sandbox.syncNow({ backfill: true });
  eq(validationOn(jul)[0].rule.allowInvalid, true, 'phải allowInvalid');
});
t('dropdown phủ hết cột, không chặn đuôi', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE'); const jul = ss.insertSheet('07/2026');
  const env = makeEnv({ nowMonth: '07/2026', ss,
    schema: { [DS1]: [{ name: 'Done', color: 'green' }], [DS2]: [] } });
  env.sandbox.syncNow({ backfill: true });
  eq(validationOn(jul)[0].nr, jul.getMaxRows() - 1);
});

console.log('— COUNTED so không phân biệt hoa thường —');
t('status lệch hoa thường ("Waiting to launch") vẫn được tính', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const pages = {}; pages[DS1] = [page('pw2', 'Task L', 'Waiting to launch', 2, 'Dev')];
  const env = makeEnv({ nowMonth: '07/2026', pages, ss });
  const r = env.sandbox.syncNow({ backfill: true });
  eq(r.added, 1, 'phải được stamp, không rơi vào "chưa tới mốc"');
});

console.log('— Vá link Card: dòng mất link phải mọc lại, link anh sửa thì không —');
// Ca thật 2026-08-05: 3 dòng ở 08/2026 có page id nhưng cột F rỗng. Đường update xưa nay
// chỉ ghi A..D nên chúng mất link vĩnh viễn, sync bao nhiêu lượt cũng không mọc lại.
t('dòng có page id nhưng TRỐNG cột Card → được vá link', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const aug = ss.insertSheet('08/2026');
  aug.getRange(2, 1, 1, 7).setValues([['Fix cart', 'Done', 2, 'Dev', false, '', 'pfix']]);
  const pages = {}; pages[DS1] = [page('pfix', 'Fix cart', 'Done', 2, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  const r = env.sandbox.syncNow();
  eq(r.healedLink, 1, 'phải đếm được ca vá link');
  ok(String(aug.getRange(2, 6).getValue()).indexOf('pfix') !== -1,
     'F phải mang link Notion: ' + aug.getRange(2, 6).getValue());
});
t('link anh tự sửa → KHÔNG bị đè', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const aug = ss.insertSheet('08/2026');
  aug.getRange(2, 1, 1, 7).setValues([['Fix cart', 'Done', 2, 'Dev', false, 'link của anh', 'pfix']]);
  const pages = {}; pages[DS1] = [page('pfix', 'Fix cart', 'Done', 2, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  const r = env.sandbox.syncNow();
  eq(r.healedLink, 0);
  eq(aug.getRange(2, 6).getValue(), 'link của anh');
});

console.log('— Checkbox cột Have phủ hết cột, không chỉ vùng _TEMPLATE vẽ sẵn —');
t('đặt checkbox cột E cho mọi tab tháng và _TEMPLATE', () => {
  const ss = new MockSS(); const tpl = ss.insertSheet('_TEMPLATE');
  const aug = ss.insertSheet('08/2026');
  const env = makeEnv({ nowMonth: '08/2026', ss });
  env.sandbox.syncNow();
  [tpl, aug].forEach(sh => {
    const cb = sh.validations.filter(v => v.col === 5 && v.rule.kind === 'checkbox');
    ok(cb.length >= 1, 'thiếu checkbox ở tab ' + sh.getName());
    eq(cb[0].nr, sh.getMaxRows() - 1, 'checkbox phải phủ hết cột, không chặn đuôi');
  });
});

console.log('— Căn chữ: dòng cao do wrap thì ô một dòng bên cạnh phải nằm giữa —');
t('căn giữa dọc cả A..H, căn giữa ngang chỉ B..F', () => {
  const ss = new MockSS(); const tpl = ss.insertSheet('_TEMPLATE');
  const aug = ss.insertSheet('08/2026');
  const env = makeEnv({ nowMonth: '08/2026', ss });
  env.sandbox.syncNow();
  [tpl, aug].forEach(sh => {
    const v = sh.aligns.filter(a => a.axis === 'v');
    const h = sh.aligns.filter(a => a.axis === 'h');
    ok(v.length >= 1 && v[0].value === 'middle', 'thiếu căn giữa dọc ở ' + sh.getName());
    eq(v[0].col, 1, 'căn dọc bắt đầu từ cột A');
    eq(v[0].nc, 8, 'căn dọc phủ A..H');
    ok(h.length >= 1 && h[0].value === 'center', 'thiếu căn giữa ngang ở ' + sh.getName());
    eq(h[0].col, 2, 'căn ngang bắt đầu từ Status (B)');
    eq(h[0].nc, 5, 'căn ngang dừng ở Card (F) — không đụng tên task và Note');
  });
});

console.log('— Cột Note: chữ ghi chú phải lùi ra sau, không tràn sang khối KPI —');
t('cột Note được wrap + nghiêng + xám + nhỏ hơn một cỡ', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const aug = ss.insertSheet('08/2026');
  const env = makeEnv({ nowMonth: '08/2026', ss });
  env.sandbox.syncNow();
  ok(aug.wrapCalls.some(w => w.col === 8), 'Note phải wrap, không được tràn sang cột I+ (khối KPI)');
  const f = aug.fonts.filter(x => x.col === 8);
  ok(f.some(x => x.kind === 'style' && x.value === 'italic'), 'nghiêng');
  ok(f.some(x => x.kind === 'size' && x.value < 10), 'nhỏ hơn cỡ chữ dữ liệu');
  ok(f.some(x => x.kind === 'color' && x.value === '#787774'), 'xám của Notion');
});
t('cột Note quá hẹp thì nới ra, đã đủ rộng thì KHÔNG đụng', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const hep = ss.insertSheet('08/2026');
  const rong = ss.insertSheet('07/2026');
  rong.setColumnWidth(8, 420); // anh đã tự kéo rộng
  const env = makeEnv({ nowMonth: '08/2026', ss });
  env.sandbox.syncNow();
  ok(hep.getColumnWidth(8) >= 200, 'cột hẹp được nới: ' + hep.getColumnWidth(8));
  eq(rong.getColumnWidth(8), 420, 'độ rộng anh tự đặt không bị đè');
});

console.log('— Wrap cột tên task: tiêu đề dài phải xuống dòng, không bị cắt cụt —');
function wrapOnTitleCol(sh) {
  return sh.wrapCalls.filter(w => w.col === 1 && w.row === 2 && w.strategy === 'WRAP');
}
t('đặt wrap cột A cho mọi tab tháng VÀ _TEMPLATE', () => {
  const ss = new MockSS(); const tpl = ss.insertSheet('_TEMPLATE');
  const jun = ss.insertSheet('06/2026'), jul = ss.insertSheet('07/2026');
  const env = makeEnv({ nowMonth: '07/2026', ss });
  env.sandbox.syncNow({ backfill: true });
  [tpl, jun, jul].forEach(sh => ok(wrapOnTitleCol(sh).length >= 1, 'thiếu wrap ở tab ' + sh.getName()));
  eq(wrapOnTitleCol(jul)[0].nr, jul.getMaxRows() - 1, 'wrap phủ hết cột, không chặn đuôi');
});
t('không đặt lại wrap ở lượt sync sau (đã có số phiên bản)', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const jul = ss.insertSheet('07/2026');
  const env = makeEnv({ nowMonth: '07/2026', ss });
  env.sandbox.syncNow({ backfill: true });
  const after1 = jul.wrapCalls.length;
  env.sandbox.syncNow({ backfill: true });
  eq(jul.wrapCalls.length, after1, 'lượt 2 không đụng lại format');
});
t('đặt wrap lỗi giữa chừng → KHÔNG ghi số phiên bản, lượt sau thử lại', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const jul = ss.insertSheet('07/2026');
  const realGetRange = jul.getRange.bind(jul); // chỉ phá đúng setWrapStrategy, đọc/ghi vẫn chạy
  jul.getRange = function () {
    const rg = realGetRange.apply(null, arguments);
    rg.setWrapStrategy = () => { throw new Error('quota'); };
    return rg;
  };
  const env = makeEnv({ nowMonth: '07/2026', ss });
  const r = env.sandbox.syncNow({ backfill: true });
  ok(!env.props.ROW_FORMAT_VERSION, 'không được claim là đã đặt xong');
  ok(r && typeof r.added === 'number', 'lỗi format không được kéo sập lượt sync point');
});
t('tab tháng mới tạo cũng được wrap', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const pages = {}; pages[DS1] = [page('pw', 'Task', 'Done', 1, 'Dev')];
  const env = makeEnv({ nowMonth: '09/2026', pages, ss });
  env.sandbox.syncNow({ backfill: true });
  ok(wrapOnTitleCol(ss.getSheetByName('09/2026')).length >= 1, 'tab mới thiếu wrap');
});

console.log('— So tên: nháy cong / gạch dài của Notion phải khớp với nháy thẳng gõ tay —');
t('tên Notion có nháy cong, dòng tháng cũ gõ nháy thẳng → vẫn khớp, không add lại', () => {
  const { ss, jul } = julWithHandRow(
    ['[Notifications] "Notify me" Button & Back-in-Stock Product Scope', 'Done', 3, 'Dev', true]);
  const pages = {}; pages[DS1] = [page(
    'pnotif', '[Notifications] “Notify me” Button & Back–in–Stock Product Scope',
    'Done', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  const r = env.sandbox.syncNow({ backfill: true });
  eq(r.added, 0, 'không được kéo sang tháng 8');
  eq(r.blockedOld, 1, 'nhận ra đã có ở tháng 7');
  eq(jul.getRange(2, 7).getValue(), 'pnotif', 'id được vá vào dòng tháng 7');
});

console.log('— Gói an toàn 2026-08-06: xoá tay là ý định, script không hồi sinh / không tự xoá dòng tay —');
// Ca thật 2026-08-06: anh xoá 2 task Reviewer khỏi 07/2026 (đã chốt) rồi gõ tay lại vào
// 08/2026. Bản cũ: cột G ẩn sót id thì đường update hồi sinh dòng July, hoặc quét bù
// trước lúc chốt re-add; xong luật 8 "tháng cũ nhất thắng" DỌN luôn dòng tay tháng 8.
// Gói an toàn khoá cả 3 đường: bia mộ (update), stamp trong _STATE (quét bù), luật tay (rule 8).
const T1 = '[Refactor] Place order không xoá item khỏi wishlist';
const T2 = '[Refactor] wishlist data model: soft-delete on remove';
const WTL = 'Waiting to Launch';
function handRow(title) { return [title, WTL, 8, 'Reviewer', false, '', '']; }
function scriptRow(title, pid) { return [title, WTL, 8, 'Reviewer', false, 'link', pid]; }
function incidentPages() {
  const p = {};
  p[DS1] = [page('p1', T1, WTL, 8, 'Reviewer'),
            page('p2', T2, WTL, 8, 'Reviewer'),
            page('p3', 'Other July task', 'Done', 3, 'Dev')];
  return p;
}
function seedOldState(ss) { // format CŨ 2 cột — đúng _STATE thật lúc dán code mới
  const st = ss.insertSheet('_STATE');
  st.getRange(1, 1, 1, 2).setValues([['pageId', 'status']]);
  st.getRange(2, 1, 3, 2).setValues([['p1', WTL], ['p2', WTL], ['p3', 'Done']]);
}

t('bia mộ (chỉ còn id ở G) → update KHÔNG hồi sinh, không heal link, đếm tombstones', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  seedOldState(ss);
  const jul = ss.insertSheet('07/2026');
  jul.getRange(2, 7).setValue('p1'); // anh xoá dòng, cột G ẩn còn sót
  jul.getRange(3, 1, 1, 7).setValues([scriptRow('Other July task', 'p3')]);
  const env = makeEnv({ nowMonth: '08/2026', pages: incidentPages(), ss,
                        props: { CLOSED_THROUGH: '07/2026' } });
  const r = env.sandbox.syncNow();
  eq(r.tombstones, 1, 'đếm bia mộ');
  eq(r.added, 0, 'không add lại ở đâu cả');
  const row = jul.getRange(2, 1, 1, 8).getValues()[0];
  eq(row[0], '', 'tên KHÔNG bị hồi sinh');
  eq(row[1], '', 'status trống');
  eq(row[5], '', 'link Card không được vá vào bia mộ');
  eq(row[6], 'p1', 'id vẫn nằm đó ghim pid');
  eq(r.updated, 1, 'chỉ p3 (dòng thật) được update');
  ok(env.logs.some(l => l.indexOf('Bia mộ') !== -1), 'log nêu đích danh: ' + env.logs.join('\n'));
});
function titleAnywhere_(ss, title) {
  return ss.getSheets().some(sh => sh.data.some(r => r[0] === title));
}
// F5 sửa lại nửa sau của test này: p2 (xoá sạch cả G, KHÔNG có dòng tay nào mang tên nó)
// từng bị stamp format cũ chặn vĩnh viễn. Giờ dấu dựng từ sheet nên quét bù cứu nó một
// lần — thiệt hại nhỏ và TỰ SỬA (xoá lần nữa là dính stamp thật), đổi lấy việc không
// khoá chết đường cứu của mọi task chưa từng có dòng. Nửa bia mộ (p1) giữ nguyên.
t('bia mộ ghim pid: quét bù cũng không add lại task đó ở tab nào', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  seedOldState(ss);
  const jul = ss.insertSheet('07/2026');
  jul.getRange(2, 7).setValue('p1');
  jul.getRange(3, 1, 1, 7).setValues([scriptRow('Other July task', 'p3')]);
  const env = makeEnv({ nowMonth: '08/2026', pages: incidentPages(), ss,
                        props: { CLOSED_THROUGH: '07/2026' } });
  const r = env.sandbox.backfillCounted();
  eq(r.tombstones, 1, 'p1 ghim bởi bia mộ');
  ok(!titleAnywhere_(ss, T1), 'p1 KHÔNG được add lại ở bất kỳ tab nào');
  eq(r.added, 1, 'chỉ p2 (không dấu vết nào trong sheet) được quét bù cứu');
  const aug = ss.getSheetByName('08/2026');
  eq(aug.getRange(2, 1).getValue(), T2, 'p2 rơi vào tháng đang tính');
  aug.getRange(2, 1, 1, 8).clearContent(); // anh xoá lần nữa
  const r2 = env.sandbox.backfillCounted();
  eq(r2.added, 0, 'lần này stamp là thật — không hồi sinh nữa');
  eq(r2.skippedDeleted, 1, 'và được nêu đích danh');
});
t('bia mộ 07 + dòng tay 08 cùng task → cả hai đứng yên (giới hạn đã chấp nhận)', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  seedOldState(ss);
  const jul = ss.insertSheet('07/2026');
  jul.getRange(2, 7).setValue('p1');
  const aug = ss.insertSheet('08/2026');
  aug.getRange(2, 1, 1, 7).setValues([handRow(T1)]);
  const env = makeEnv({ nowMonth: '08/2026', pages: incidentPages(), ss,
                        props: { CLOSED_THROUGH: '07/2026' } });
  const r = env.sandbox.syncNow();
  eq(r.tombstones, 1);
  eq(r.dupCleared, 0, 'bia mộ không làm keeper, không kéo theo dọn dẹp');
  eq(r.dupHandKept, 0, 'luật 8 không chạy — bia mộ bị bỏ qua trước đó');
  eq(aug.getRange(2, 1).getValue(), T1, 'dòng tay tháng 8 nguyên vẹn');
  eq(aug.getRange(2, 8).getValue(), '', 'không note vô cớ lên dòng tay');
  eq(jul.getRange(2, 7).getValue(), 'p1', 'bia mộ vẫn ghim');
});
t('script add → anh xoá sạch dòng (cả G) → quét bù KHÔNG hồi sinh + alert nêu tên', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'In progress', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  env.sandbox.syncNow(); // baseline
  pages[DS1][0] = page('p1', 'Task A', 'Ready to Test', 3, 'Dev');
  env.sandbox.syncNow(); // add vào 08/2026
  const aug = ss.getSheetByName('08/2026');
  eq(aug.getRange(2, 1).getValue(), 'Task A', 'đã add');
  aug.getRange(2, 1, 1, 8).clearContent(); // anh xoá tay, sạch cả G
  env.sandbox.syncNow(); // một nhịp 10' trôi qua — stamp phải sống sót qua writeState
  const r = env.sandbox.backfillCounted();
  eq(r.added, 0, 'không hồi sinh');
  eq(r.skippedDeleted, 1, 'đếm được');
  ok(env.ui.alerts.some(a => a.indexOf('Task A') !== -1 && a.indexOf('hồi sinh') !== -1),
     'alert nêu đích danh: ' + env.ui.alerts.join(' | '));
  eq(aug.getRange(2, 1).getValue(), '', 'dòng vẫn trống');
});
t('status lùi rồi vượt mốc lại sau khi anh đã xoá → nhịp thường cũng không hồi sinh', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const st = ss.insertSheet('_STATE');
  st.getRange(1, 1, 1, 3).setValues([['pageId', 'status', 'stamped']]);
  st.getRange(2, 1, 1, 3).setValues([['p1', 'In progress', 1]]); // từng add, status đang lùi
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'Done', 3, 'Dev')]; // vượt mốc lại
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  const r = env.sandbox.syncNow();
  eq(r.added, 0, 'cross thật nhưng pid đã stamp + vắng dòng = anh đã xoá');
  eq(r.skippedDeleted, 1);
});
// F5: bản cũ suy "counted trong _STATE format cũ = đã từng add" nên khoá pdel vĩnh viễn.
// Giờ dấu dựng lại từ SHEET: pid không còn dấu vết nào thì quét bù cứu MỘT lần, và chính
// lượt đó đóng stamp thật — lần xoá sau là chết hẳn. Thiệt hại tự sửa, đổi lấy việc không
// khoá chết đường cứu của mọi task chưa từng có dòng.
t('migration format cũ: dấu dựng lại từ SHEET, quét bù cứu được, xoá lần sau mới dính', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const st = ss.insertSheet('_STATE');
  st.getRange(1, 1, 1, 2).setValues([['pageId', 'status']]); // format cũ 2 cột
  st.getRange(2, 1, 1, 2).setValues([['pdel', 'Done']]);
  const pages = {}; pages[DS1] = [page('pdel', 'Task từng xoá', 'Done', 2, 'Dev'),
                                  page('pnew', 'Task sót', 'Done', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  const r = env.sandbox.backfillCounted();
  eq(r.skippedDeleted, 0, 'không pid nào bị gán nhãn "đã xoá" chỉ vì status counted');
  eq(r.added, 2, 'cả hai đều được cứu');
  eq(st.getRange(1, 3).getValue(), 'stamped', 'state được ghi lại theo format mới');
  const sv = st.getRange(2, 1, 2, 3).getValues();
  ok(sv.every(x => x[2]), 'cả hai mang stamp THẬT sau lượt migration: ' + JSON.stringify(sv));
  const aug = ss.getSheetByName('08/2026');
  aug.getRange(2, 1, 2, 8).clearContent(); // anh xoá tay cả hai
  const r2 = env.sandbox.backfillCounted();
  eq(r2.added, 0, 'xoá tay sau migration là chết hẳn');
  eq(r2.skippedDeleted, 2);
});
t('luật 8: bản sao TRỐNG G là dòng tay → KHÔNG dọn, chỉ note 🤖 + đếm dupHandKept', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const jul = ss.insertSheet('07/2026');
  jul.getRange(2, 1, 1, 7).setValues([scriptRow('Fix cart', 'pfix')]);
  const aug = ss.insertSheet('08/2026');
  aug.getRange(2, 1, 1, 5).setValues([['Fix cart', WTL, 8, 'Reviewer', false]]);
  const pages = {}; pages[DS1] = [page('pfix', 'Fix cart', 'Done', 2, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  const r = env.sandbox.syncNow();
  eq(r.dupCleared, 0, 'không dọn dòng tay');
  eq(r.dupHandKept, 1, 'đếm riêng, không im lặng');
  eq(aug.getRange(2, 1).getValue(), 'Fix cart', 'dòng tay còn nguyên');
  const note = String(aug.getRange(2, 8).getValue());
  ok(note.indexOf('🤖') === 0 && note.indexOf('07/2026') !== -1, 'note: ' + note);
  eq(jul.getRange(2, 2).getValue(), 'Done', 'dòng giữ (July) vẫn được update');
});
t('luật 8 dòng tay: H đã có chữ của anh → không đè note, vẫn không dọn', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const jul = ss.insertSheet('07/2026');
  jul.getRange(2, 1, 1, 7).setValues([scriptRow('Fix cart', 'pfix')]);
  const aug = ss.insertSheet('08/2026');
  aug.getRange(2, 1, 1, 5).setValues([['Fix cart', WTL, 8, 'Reviewer', false]]);
  aug.getRange(2, 8).setValue('note của anh');
  const pages = {}; pages[DS1] = [page('pfix', 'Fix cart', 'Done', 2, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  const r = env.sandbox.syncNow();
  eq(r.dupHandKept, 1);
  eq(aug.getRange(2, 1).getValue(), 'Fix cart', 'không dọn');
  eq(aug.getRange(2, 8).getValue(), 'note của anh', 'chữ của anh không bị đè');
});
// Ca sáng lập 2026-08-05 phải giữ NGUYÊN kết cục: bản gốc tay ở July (trống G) thắng,
// bản sao CÓ id ở August bị dọn — luật tay chỉ che dòng TRỐNG G, không che dòng có id.
t('ca 2026-08-05 (regression): bản sao CÓ id vẫn bị dọn, bản gốc tay July giữ + vá id', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const jul = ss.insertSheet('07/2026');
  jul.getRange(2, 1, 1, 5).setValues([['Fix cart', 'Waiting to test', 2, 'Reviewer', true]]);
  jul.getRange(3, 1, 1, 5).setValues([['Fix translation', 'Done', 3, 'Reviewer', true]]);
  const aug = ss.insertSheet('08/2026');
  aug.getRange(2, 1, 1, 7).setValues([scriptRow('Fix cart', 'pa')]);
  aug.getRange(3, 1, 1, 7).setValues([['Fix translation', 'Done', 3, 'Reviewer', false, 'link', 'pb']]);
  const pages = {}; pages[DS1] = [page('pa', 'Fix cart', 'Done', 2, 'Reviewer'),
                                  page('pb', 'Fix translation', 'Done', 3, 'Reviewer')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss, props: { CLOSED_THROUGH: '07/2026' } });
  const r = env.sandbox.syncNow();
  eq(r.dupCleared, 2, 'cả hai bản sao có id đều bị dọn');
  eq(r.dupHandKept, 0, 'không có gì bị nhận nhầm là dòng tay');
  eq(aug.getRange(2, 1).getValue(), '', 'bản sao tháng 8 sạch');
  eq(aug.getRange(3, 1).getValue(), '');
  eq(jul.getRange(2, 1).getValue(), 'Fix cart', 'bản gốc July giữ');
  eq(jul.getRange(2, 7).getValue(), 'pa', 'vá id vào bản gốc');
  eq(jul.getRange(3, 7).getValue(), 'pb');
});
t('ca 2026-08-06 đường G sót: July nằm yên bia mộ, August tay nguyên vẹn, chạy lặp vẫn vậy', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  seedOldState(ss);
  const jul = ss.insertSheet('07/2026');
  jul.getRange(2, 7).setValue('p1');
  jul.getRange(3, 1, 1, 7).setValues([scriptRow('Other July task', 'p3')]);
  jul.getRange(4, 7).setValue('p2');
  const aug = ss.insertSheet('08/2026');
  aug.getRange(2, 1, 1, 7).setValues([handRow(T1)]);
  aug.getRange(3, 1, 1, 7).setValues([handRow(T2)]);
  const env = makeEnv({ nowMonth: '08/2026', pages: incidentPages(), ss,
                        props: { CLOSED_THROUGH: '07/2026' } });
  for (let i = 1; i <= 3; i++) {
    const r = env.sandbox.syncNow();
    eq(r.added, 0, 'lượt ' + i + ': không add');
    eq(r.dupCleared, 0, 'lượt ' + i + ': không dọn gì');
    eq(r.tombstones, 2, 'lượt ' + i + ': 2 bia mộ');
  }
  eq(jul.getRange(2, 1).getValue(), '', 'July không hồi sinh');
  eq(jul.getRange(4, 1).getValue(), '');
  eq(jul.getRange(2, 7).getValue(), 'p1', 'bia mộ còn ghim');
  eq(jul.getRange(3, 1).getValue(), 'Other July task', 'dòng thật bên cạnh không bị vạ lây');
  eq(aug.getRange(2, 1).getValue(), T1, 'dòng tay tháng 8 sống');
  eq(aug.getRange(3, 1).getValue(), T2);
  eq(aug.getRange(2, 8).getValue(), '', 'không note vô cớ lên dòng tay');
});
t('ca 2026-08-06 đường quét bù: xoá sạch + còn ghim 07 → không kéo về July nữa', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  seedOldState(ss);
  const jul = ss.insertSheet('07/2026');
  jul.getRange(3, 1, 1, 7).setValues([scriptRow('Other July task', 'p3')]);
  const aug = ss.insertSheet('08/2026');
  aug.getRange(2, 1, 1, 7).setValues([handRow(T1)]);
  aug.getRange(3, 1, 1, 7).setValues([handRow(T2)]);
  const env = makeEnv({ nowMonth: '08/2026', pages: incidentPages(), ss,
                        props: { ACTIVE_MONTH: '07/2026' } });
  const r1 = env.sandbox.backfillCounted(); // đúng thao tác đã gây ra ca thật
  eq(r1.added, 0, 'không hồi sinh vào July');
  eq(r1.skippedDeleted, 2, 'cả 2 task anh xoá đều được nhận ra');
  ok(env.ui.alerts[0].indexOf(T1) !== -1 && env.ui.alerts[0].indexOf(T2) !== -1,
     'alert nêu đích danh cả hai: ' + env.ui.alerts[0]);
  ok(rowEmpty_(jul, 2) && rowEmpty_(jul, 4), 'July trống nguyên');
  env.sandbox.unpinMonth(); // ✅ Chốt
  const r2 = env.sandbox.syncNow(); // nhịp 10 phút hôm sau
  eq(r2.dupCleared, 0, 'không dọn dòng tay tháng 8');
  eq(r2.added, 0);
  eq(aug.getRange(2, 1).getValue(), T1, 'dòng tay sống sót');
  eq(aug.getRange(3, 1).getValue(), T2);
});
function rowEmpty_(sh, r) {
  return sh.getRange(r, 1, 1, 8).getValues()[0]
    .every(v => v === '' || v === null || v === false);
}

console.log('— F5: migration _STATE format cũ dựng stamp từ SHEET, không từ status —');
// Bản cũ suy ra stamp từ status counted, nên MỌI pid counted trong _STATE format cũ bị
// đóng dấu "anh đã xoá" — kể cả task chưa từng có dòng ở đâu (bị CLOSED_THROUGH chặn,
// bị nhịp 10 phút bắt hụt, hoặc nằm trong tab không khớp MM/YYYY). Ca thật: task Dev
// pid 3b1b… status "Waiting to live" đang chờ được quét bù cứu.
function legacyState(ss, rows) {
  const st = ss.insertSheet('_STATE');
  st.getRange(1, 1, 1, 2).setValues([['pageId', 'status']]);
  if (rows.length) st.getRange(2, 1, rows.length, 2).setValues(rows);
  return st;
}
function newState(ss, rows) {
  const st = ss.insertSheet('_STATE');
  st.getRange(1, 1, 1, 3).setValues([['pageId', 'status', 'stamped']]);
  if (rows.length) st.getRange(2, 1, rows.length, 3).setValues(rows);
  return st;
}
t('F5: _STATE format cũ, task counted CHƯA TỪNG có dòng → quét bù vẫn cứu được', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const jul = ss.insertSheet('07/2026');
  jul.getRange(2, 1, 1, 7).setValues([['Task khác', 'Done', 3, 'Dev', false, 'link', 'pkhac']]);
  legacyState(ss, [['pkhac', 'Done'], ['3b1b', 'Waiting to live']]);
  const pages = {}; pages[DS1] = [page('pkhac', 'Task khác', 'Done', 3, 'Dev'),
                                  page('3b1b', 'Fix Write Review button greyed out', 'Waiting to live', 5, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss, props: { CLOSED_THROUGH: '07/2026' } });
  const r = env.sandbox.backfillCounted();
  eq(r.skippedDeleted, 0, 'pid chưa từng có dòng KHÔNG được gán nhãn "anh đã xoá"');
  eq(r.added, 1, 'quét bù cứu được');
  eq(ss.getSheetByName('08/2026').getRange(2, 1).getValue(), 'Fix Write Review button greyed out');
});
t('F5: _STATE format cũ, pid ĐANG có dòng → stamp dựng lại từ sheet, xoá tay vẫn dính', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const aug = ss.insertSheet('08/2026');
  aug.getRange(2, 1, 1, 7).setValues([['Task A', 'Done', 3, 'Dev', false, 'link', 'p1']]);
  legacyState(ss, [['p1', 'Done']]);
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'Done', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  env.sandbox.syncNow();                    // lượt migration: stamp dựng lại từ sheet
  const st = ss.getSheetByName('_STATE');
  eq(st.getRange(1, 3).getValue(), 'stamped', 'state ghi lại theo format mới');
  ok(st.getRange(2, 1, 1, 3).getValues()[0][2], 'pid có dòng → có stamp');
  aug.getRange(2, 1, 1, 8).clearContent();  // anh xoá tay sạch cả G
  const r = env.sandbox.backfillCounted();
  eq(r.added, 0, 'không hồi sinh');
  eq(r.skippedDeleted, 1, 'stamp dựng từ sheet vẫn chặn được quét bù');
});

console.log('— F1: bia mộ không được đóng băng dòng SỐNG mang cùng pid —');
// ensureMonthSheet_ đưa tab tháng mới về index 0, nên tab thật xếp NGƯỢC thời gian và
// tab CŨ được duyệt SAU CÙNG. byPid kiểu "ghi sau thắng" vì thế để bia mộ tháng cũ
// chiếm chỗ dòng sống tháng mới — dòng sống đứng hình vĩnh viễn, không đếm vào đâu.
function revChronSS(months) { // [mới nhất ... cũ nhất] đúng thứ tự tab thật
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const out = { ss };
  months.forEach(m => { out[m] = ss.insertSheet(m); });
  return out;
}
t('F1: bia mộ 07 + dòng sống 08 cùng pid → update dòng sống, không đóng băng', () => {
  const s = revChronSS(['08/2026', '07/2026']);
  s['08/2026'].getRange(2, 1, 1, 7).setValues([['Task X', 'Testing', 5, 'Dev', false, 'link', 'px']]);
  s['07/2026'].getRange(2, 7).setValue('px'); // copy sang August rồi xoá ô hiện của July
  newState(s.ss, [['px', 'Testing', 1]]);
  const pages = {}; pages[DS1] = [page('px', 'Task X', 'Done', 9, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss: s.ss });
  const r = env.sandbox.syncNow();
  eq(r.updated, 1, 'dòng sống phải được update');
  eq(r.tombstones, 0, 'pid này có dòng sống — không phải ca bia mộ');
  eq(s['08/2026'].getRange(2, 2).getValue(), 'Done', 'status theo Notion');
  eq(s['08/2026'].getRange(2, 3).getValue(), 9, 'point theo Notion');
  eq(s['07/2026'].getRange(2, 7).getValue(), 'px', 'bia mộ July vẫn nằm yên, không bị hồi sinh');
  eq(s['07/2026'].getRange(2, 1).getValue(), '', 'và không mọc lại tên');
});
t('F1: chạy 3 lượt liên tiếp vẫn update, không bao giờ tự lành ngược', () => {
  const s = revChronSS(['08/2026', '07/2026']);
  s['08/2026'].getRange(2, 1, 1, 7).setValues([['Task X', 'Testing', 5, 'Dev', false, 'link', 'px']]);
  s['07/2026'].getRange(2, 7).setValue('px');
  newState(s.ss, [['px', 'Testing', 1]]);
  const pages = {}; pages[DS1] = [page('px', 'Task X', 'Done', 9, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss: s.ss });
  for (let i = 1; i <= 3; i++) {
    const r = env.sandbox.syncNow();
    eq(r.updated, 1, 'lượt ' + i);
    eq(r.tombstones, 0, 'lượt ' + i);
  }
  eq(s['08/2026'].getRange(2, 2).getValue(), 'Done');
});

console.log('— F2: cửa thoát trong tài liệu (dán page id vào ô G) phải chạy được —');
// SETUP.md + PLAN.md bảo: dán page id vào cột G thì dòng tay sẽ theo Notion. Dựng đúng
// hiện trạng sau ca 2026-08-06 (bia mộ July, dòng tay August, _STATE format cũ, đã chốt
// tới hết 07/2026) rồi làm đúng thao tác đó.
t('F2: dán page id vào dòng tay August (bia mộ July cùng pid) → dòng tay theo Notion', () => {
  const s = revChronSS(['08/2026', '07/2026']);
  const aug = s['08/2026'], jul = s['07/2026'];
  jul.getRange(2, 7).setValue('p1'); // bia mộ: anh xoá dòng, cột G ẩn còn sót
  jul.getRange(3, 7).setValue('p2');
  aug.getRange(2, 1, 1, 7).setValues([[T1, WTL, 8, 'Reviewer', false, '', 'p1']]); // đã dán id
  aug.getRange(3, 1, 1, 7).setValues([[T2, WTL, 8, 'Reviewer', false, '', 'p2']]);
  seedOldState(s.ss);
  const p = {};
  p[DS1] = [page('p1', T1, 'Done', 13, 'Reviewer'), page('p2', T2, 'Done', 13, 'Reviewer'),
            page('p3', 'Other July task', 'Done', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages: p, ss: s.ss,
                        props: { CLOSED_THROUGH: '07/2026' } });
  const r = env.sandbox.syncNow();
  eq(r.tombstones, 0, 'dòng tay đã mang id — không còn bia mộ nào chặn đường');
  eq(r.updated, 2, 'cả hai dòng tay theo Notion');
  eq(r.dupCleared, 0, 'và KHÔNG bị dọn mất');
  eq(aug.getRange(2, 2).getValue(), 'Done', 'status'); eq(aug.getRange(2, 3).getValue(), 13, 'point');
  eq(aug.getRange(3, 2).getValue(), 'Done'); eq(aug.getRange(3, 3).getValue(), 13);
  eq(aug.getRange(2, 1).getValue(), T1, 'dòng vẫn nằm ở August');
  ok(String(aug.getRange(2, 6).getValue()).indexOf('notion.so') !== -1,
     'link Card được vá: ' + aug.getRange(2, 6).getValue());
  eq(jul.getRange(2, 1).getValue(), '', 'bia mộ July vẫn không hồi sinh');
});

console.log('— F3: dán page id vào dòng TRỐNG là để BUỘC task, không phải bia mộ —');
// Bia mộ = dấu "script từng đặt dòng ở đây rồi anh xoá đi". Dấu đó nằm sẵn trong
// _STATE (cột stamped). Pid chưa từng stamp mà xuất hiện ở ô G một dòng trống thì
// không thể là dấu xoá — chỉ có thể là anh vừa dán id vào để buộc task vào dòng đó.
t('F3: pid CHƯA từng stamp + dòng trống chỉ có id → script điền dòng, không phải bia mộ', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const aug = ss.insertSheet('08/2026');
  aug.getRange(2, 1, 1, 7).setValues([['Neo', 'Done', 1, 'Dev', false, 'link', 'pneo']]);
  aug.getRange(3, 7).setValue('pnew'); // anh dán id vào dòng trống
  newState(ss, [['pneo', 'Done', 1], ['pnew', 'Done', '']]);
  const pages = {}; pages[DS1] = [page('pneo', 'Neo', 'Done', 1, 'Dev'),
                                  page('pnew', 'Task mới', 'Done', 4, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  const r = env.sandbox.syncNow();
  eq(r.tombstones, 0, 'chưa từng stamp → không phải bia mộ');
  eq(r.added, 0, 'và không add thêm bản sao ở đâu cả');
  eq(aug.getRange(3, 1).getValue(), 'Task mới', 'dòng được điền tên');
  eq(aug.getRange(3, 2).getValue(), 'Done', 'status');
  eq(aug.getRange(3, 3).getValue(), 4, 'point');
  eq(aug.getRange(3, 4).getValue(), 'Dev', 'role');
  eq(aug.dataRowCount(), 2, 'vẫn đúng 2 dòng task');
});
t('F3: pid ĐÃ stamp + dòng trống chỉ có id → vẫn là bia mộ, không hồi sinh', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const aug = ss.insertSheet('08/2026');
  aug.getRange(2, 7).setValue('pdel');
  newState(ss, [['pdel', 'Done', 1]]);
  const pages = {}; pages[DS1] = [page('pdel', 'Task đã xoá', 'Done', 4, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  const r = env.sandbox.syncNow();
  eq(r.tombstones, 1, 'có stamp → đúng là dòng anh đã xoá');
  eq(aug.getRange(2, 1).getValue(), '', 'không hồi sinh');
});

console.log('— F4: note do CHÍNH script ghi không được cứu dòng khỏi là bia mộ —');
// Đúng thao tác của ca 2026-08-06: anh quét A..F rồi Delete. Nếu dòng đó trước đó bị
// script gắn cờ, cột H còn chữ của SCRIPT — bản cũ coi "H có chữ = dòng còn thông tin"
// nên hồi sinh sạch sẽ cả tên/status/point/role và vá lại link. Bất biến (ii) thủng
// đúng ngay thao tác đã gây ra sự cố.
const SCRIPT_NOTES = [
  '🤖 Nghi trùng "Task A" ở tab 06/2026 — check & xoá nếu trùng',
  '🤖 Tự gán Notion id theo tên task — check, xoá dòng này nếu không phải task đó',
  '🤖 Trùng với 06/2026 dòng 2 (cùng task Notion) — dòng tay nên script không tự xoá',
  '⚠ Nghi trùng "Task A" ở tab 06/2026', // note đời cũ, vẫn là của script
];
SCRIPT_NOTES.forEach((note, i) => {
  t('F4: H còn note script #' + (i + 1) + ' → vẫn là bia mộ, không hồi sinh', () => {
    const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
    const jul = ss.insertSheet('07/2026');
    jul.getRange(2, 7).setValue('p1');
    jul.getRange(2, 8).setValue(note);
    newState(ss, [['p1', 'Done', 1]]);
    const pages = {}; pages[DS1] = [page('p1', 'Task A', 'Done', 3, 'Dev')];
    const env = makeEnv({ nowMonth: '08/2026', pages, ss });
    const r = env.sandbox.syncNow();
    eq(r.tombstones, 1, 'note của script không làm dòng "còn thông tin"');
    eq(r.updated, 0, 'không update');
    eq(r.healedLink, 0, 'không vá link vào bia mộ');
    eq(jul.getRange(2, 1).getValue(), '', 'tên KHÔNG được hồi sinh');
    eq(jul.getRange(2, 8).getValue(), note, 'note vẫn nằm nguyên đó');
  });
});
// ĐỔI Ý 2026-08-06 vòng 2 (bản trước test này đòi tombstones=0 + updated=1): note anh gõ
// ở H KHÔNG còn cứu dòng khỏi là bia mộ. Ranh giới xoá bây giờ chỉ đọc A..D — bốn cột
// script sở hữu. H là cột của ANH, nên "đã chuyển sang tháng 8" gõ vào đó là lời giải
// thích việc xoá chứ không phải bằng chứng dòng còn dùng; giữ nó làm chốt chặn thì đúng
// thao tác anh đang than phiền (quét A..D, ghi chú lại lý do) vẫn bị hồi sinh mỗi 10 phút.
// Phần luật KHÔNG đổi và vẫn được test này khoá: chữ của anh ở H không bao giờ bị đè.
t('F4: H là chữ của ANH cũng không cứu dòng — nhưng chữ đó không bao giờ bị đè', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const jul = ss.insertSheet('07/2026');
  jul.getRange(2, 7).setValue('p1');
  jul.getRange(2, 8).setValue('📝 chờ QA xác nhận rồi mới tính point');
  newState(ss, [['p1', 'Done', 1]]);
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'Done', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  const r = env.sandbox.syncNow();
  eq(r.tombstones, 1, 'A..D trống là đủ — H không được xét');
  eq(r.updated, 0, 'không hồi sinh');
  eq(jul.getRange(2, 1).getValue(), '', 'tên KHÔNG bị ghi lại');
  eq(jul.getRange(2, 8).getValue(), '📝 chờ QA xác nhận rồi mới tính point',
     'Note của anh không bị đè, kể cả bởi note bia mộ');
});
t('F4: dòng còn A..D thì note của anh ở H vẫn đi cùng đường update như cũ', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const jul = ss.insertSheet('07/2026');
  jul.getRange(2, 1, 1, 7).setValues([['Task A', 'Testing', 1, 'Dev', true, 'link', 'p1']]);
  jul.getRange(2, 8).setValue('📝 chờ QA xác nhận rồi mới tính point');
  newState(ss, [['p1', 'Done', 1]]);
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'Done', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  const r = env.sandbox.syncNow();
  eq(r.tombstones, 0, 'dòng còn dữ liệu của script → còn sống');
  eq(r.updated, 1);
  eq(jul.getRange(2, 2).getValue(), 'Done', 'update chạy như thường');
  eq(jul.getRange(2, 8).getValue(), '📝 chờ QA xác nhận rồi mới tính point', 'Note không bị đè');
});

console.log('— F6: ký ức xoá tay không được rơi vì một lượt hỏng vặt —');
// newState/newStamped chỉ dựng từ page THẤY ĐƯỢC lượt này, rồi writeState_ ghi đè cả
// sheet bằng đúng tập đó. Một lần Notion 502 (hoặc anh bỏ assign một lượt, hoặc page
// rời board) là dấu đã-từng-add bay sạch — quét bù kế tiếp hồi sinh đúng cái anh vừa xoá.
function addThenDelete(env, ss, pages) {
  env.sandbox.syncNow();                                   // baseline
  pages[DS1][0] = page('p1', 'Task A', 'Ready to Test', 3, 'Dev');
  env.sandbox.syncNow();                                   // add
  const aug = ss.getSheetByName('08/2026');
  eq(aug.getRange(2, 1).getValue(), 'Task A', 'đã add');
  aug.getRange(2, 1, 1, 8).clearContent();                 // anh xoá tay, sạch cả G
  return aug;
}
t('F6: một lượt Notion 502 → stamp sống sót, quét bù sau đó KHÔNG hồi sinh', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'In progress', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  addThenDelete(env, ss, pages);
  env.queryFail[DS1] = true;
  const rf = env.sandbox.syncNow();                        // nhịp 10' gặp 502
  ok(rf.fetchFailed, 'lượt fetch hỏng phải hiện ra, không im lặng');
  env.queryFail[DS1] = false;
  const r = env.sandbox.backfillCounted();
  eq(r.added, 0, 'không hồi sinh');
  eq(r.skippedDeleted, 1, 'dấu vẫn còn nguyên');
});
t('F6: page rời query Notion một lượt (bỏ assign) → stamp vẫn sống', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'In progress', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  addThenDelete(env, ss, pages);
  const keep = pages[DS1];
  pages[DS1] = [];                                         // anh bỏ assign một lượt
  env.sandbox.syncNow();
  pages[DS1] = keep;                                       // assign lại
  const r = env.sandbox.backfillCounted();
  eq(r.added, 0, 'rule 7 không đỡ được ca này — chỉ có stamp bền mới đỡ');
  eq(r.skippedDeleted, 1);
});
t('F6: fetch hỏng → status cũ được giữ, không bị hiểu nhầm là vừa vượt mốc', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'Done', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  env.sandbox.syncNow();                                   // baseline: Done
  env.queryFail[DS1] = true;
  env.sandbox.syncNow();
  const st = ss.getSheetByName('_STATE');
  eq(st.getRange(2, 1, 1, 2).getValues()[0][1], 'Done', 'status cũ không bị xoá');
});
t('F6: writeState_ không dùng clearContents — không có cửa sổ _STATE trắng', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'Done', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  env.sandbox.syncNow();
  env.sandbox.syncNow();
  const st = ss.getSheetByName('_STATE');
  eq(st.clearAllCalls, 0, '_STATE không bao giờ bị xoá trắng trước khi ghi lại');
  eq(st.getRange(1, 1).getValue(), 'pageId', 'header luôn còn');
  eq(st.getRange(1, 3).getValue(), 'stamped');
});
t('F6: state thu nhỏ thì đuôi thừa vẫn được dọn, không để lại pid ma', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  newState(ss, [['pa', 'In progress', ''], ['pb', 'In progress', ''], ['pc', 'In progress', '']]);
  const pages = {}; pages[DS1] = [page('pa', 'Task A', 'In progress', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  env.sandbox.syncNow();
  const st = ss.getSheetByName('_STATE');
  eq(st.getLastRow(), 2, 'chỉ còn header + pa');
  eq(st.getRange(2, 1).getValue(), 'pa');
});

console.log('— F7: bia mộ chỉ được chặn HỒI SINH, không được tắt luôn luật 8 —');
// `return` sớm ở nhánh bia mộ nằm TRƯỚC lời gọi luật 8. Bia mộ chỉ nói "dòng NÀY anh đã
// xoá" — nó không nói gì về các BẢN SAO cùng task ở tab khác, nên luật 8 vẫn phải chạy.
// Luật 7 thì ngược lại: vá id theo TÊN cho một pid đã là bia mộ chính là đường D1 dùng
// để chiếm dòng tay ở tab cũ — xem khối D1 bên dưới.
t('F7 (luật 7): bia mộ ở tháng đang tính + dòng tay ở tháng CŨ HƠN → KHÔNG vá id, dòng tay của anh', () => {
  const s = revChronSS(['08/2026', '06/2026']);
  s['08/2026'].getRange(2, 7).setValue('pfix');                      // bia mộ
  s['06/2026'].getRange(2, 1, 1, 5).setValues([['Fix cart', 'Done', 2, 'Dev', true]]); // dòng tay
  newState(s.ss, [['pfix', 'Done', 1]]);
  const pages = {}; pages[DS1] = [page('pfix', 'Fix cart', 'Done', 2, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss: s.ss });
  const r = env.sandbox.syncNow();
  eq(r.tombstones, 1, 'bia mộ vẫn được đếm');
  eq(r.added, 0, 'và vẫn không hồi sinh / không add');
  eq(r.blockedOld, 0, 'không vá id theo tên cho pid đã là bia mộ');
  eq(s['06/2026'].getRange(2, 7).getValue(), '', 'dòng tay tháng cũ không nhận id của task đã xoá');
  eq(s['06/2026'].getRange(2, 8).getValue(), '', 'và không bị ghi note');
  eq(s['08/2026'].getRange(2, 1).getValue(), '', 'bia mộ không hồi sinh');
});
t('F7 (luật 7): lượt sau vẫn là bia mộ — dòng tay tháng cũ không bị đường update kéo vào', () => {
  const s = revChronSS(['08/2026', '06/2026']);
  s['08/2026'].getRange(2, 7).setValue('pfix');
  s['06/2026'].getRange(2, 1, 1, 5).setValues([['Fix cart', 'Testing', 2, 'Dev', true]]);
  newState(s.ss, [['pfix', 'Testing', 1]]);
  const pages = {}; pages[DS1] = [page('pfix', 'Fix cart', 'Done', 7, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss: s.ss });
  env.sandbox.syncNow();
  const r2 = env.sandbox.syncNow();
  eq(r2.updated, 0, 'không có dòng nào của task này được update — anh đã xoá nó');
  eq(r2.tombstones, 1, 'vẫn là bia mộ, không "sống lại" nhờ id vừa được vá');
  eq(s['06/2026'].getRange(2, 2).getValue(), 'Testing', 'status anh gõ tay giữ nguyên');
  eq(s['06/2026'].getRange(2, 3).getValue(), 2, 'Point anh gõ tay giữ nguyên (Notion đang là 7)');
  eq(s['06/2026'].getRange(2, 5).getValue(), true, 'Have vẫn nguyên');
});
t('F7 (luật 8): bia mộ 06 che cặp trùng 07+08 (trống G) → vẫn bị chỉ mặt, không double-count im lặng', () => {
  const s = revChronSS(['08/2026', '07/2026', '06/2026']);
  s['06/2026'].getRange(2, 7).setValue('pfix');                      // bia mộ
  s['07/2026'].getRange(2, 1, 1, 5).setValues([['Fix cart', 'Waiting to test', 2, 'Reviewer', true]]);
  s['08/2026'].getRange(2, 1, 1, 5).setValues([['Fix cart', 'Waiting to test', 2, 'Reviewer', false]]);
  newState(s.ss, [['pfix', 'Waiting to test', 1]]);
  const pages = {}; pages[DS1] = [page('pfix', 'Fix cart', 'Done', 2, 'Reviewer')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss: s.ss });
  const r = env.sandbox.syncNow();
  eq(r.tombstones, 1);
  eq(r.dupHandKept, 1, 'bản sao tháng 8 là dòng tay → phải được ghi note, không im lặng');
  ok(String(s['08/2026'].getRange(2, 8).getValue()).indexOf('07/2026') !== -1,
     'note chỉ đích danh tab giữ: ' + s['08/2026'].getRange(2, 8).getValue());
  eq(s['08/2026'].getRange(2, 1).getValue(), 'Fix cart', 'dòng tay KHÔNG bị dọn');
  eq(r.dupCleared, 0);
});
t('F7 (luật 8): bia mộ 06 che cặp trùng CÓ id ở 07+08 → bản sao tháng mới bị dọn', () => {
  const s = revChronSS(['08/2026', '07/2026', '06/2026']);
  s['06/2026'].getRange(2, 7).setValue('pfix');
  s['07/2026'].getRange(2, 1, 1, 7).setValues([['Fix cart', 'Waiting to test', 2, 'Reviewer', true, 'link', 'pfix']]);
  s['08/2026'].getRange(2, 1, 1, 7).setValues([['Fix cart', 'Waiting to test', 2, 'Reviewer', false, 'link', 'pfix']]);
  newState(s.ss, [['pfix', 'Waiting to test', 1]]);
  const pages = {}; pages[DS1] = [page('pfix', 'Fix cart', 'Done', 2, 'Reviewer')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss: s.ss });
  const r = env.sandbox.syncNow();
  eq(r.dupCleared, 1, 'bản sao tháng 8 (do script sinh) bị dọn');
  eq(s['08/2026'].getRange(2, 1).getValue(), '', 'dọn sạch');
  eq(s['07/2026'].getRange(2, 2).getValue(), 'Done', 'dòng giữ được update');
});

console.log('— F8: note của script phải BỎ QUA ĐƯỢC, xoá tay là đã đọc —');
// Note ghi lại mỗi khi H trống, không nhớ đã ghi bao giờ chưa → anh đọc, thấy ổn, xoá
// đi thì 10 phút sau nó mọc lại. Vĩnh viễn. Và nó mọc trên đúng những dòng tay mà luật
// này sinh ra để bảo vệ. Note đọc rồi mà cứ mọc lại thì anh sẽ ngừng đọc mọi note.
function handTwinSS() {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const jul = ss.insertSheet('07/2026');
  jul.getRange(2, 1, 1, 7).setValues([['Fix cart', WTL, 8, 'Reviewer', false, 'link', 'pfix']]);
  const aug = ss.insertSheet('08/2026');
  aug.getRange(2, 1, 1, 5).setValues([['Fix cart', WTL, 8, 'Reviewer', false]]);
  return { ss, jul, aug };
}
t('F8: anh xoá note "🤖 Trùng với" → lượt sau KHÔNG ghi lại', () => {
  const { ss, aug } = handTwinSS();
  const pages = {}; pages[DS1] = [page('pfix', 'Fix cart', 'Done', 2, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  env.sandbox.syncNow();
  ok(String(aug.getRange(2, 8).getValue()).indexOf('🤖') === 0, 'lượt đầu vẫn phải cảnh báo');
  aug.getRange(2, 8).clearContent(); // anh đọc, check, thấy ổn → xoá
  const r = env.sandbox.syncNow();
  eq(aug.getRange(2, 8).getValue(), '', 'đã đọc rồi thì đừng ghi lại nữa');
  eq(r.dupHandKept, 1, 'nhưng vẫn đếm + log — bỏ qua note không phải bỏ qua sự kiện');
  env.sandbox.syncNow();
  eq(aug.getRange(2, 8).getValue(), '', 'và mãi mãi không mọc lại');
});
t('F8: note "🤖 Nghi trùng TÊN (page id khác)" cũng bỏ qua được', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const jul = ss.insertSheet('07/2026');
  jul.getRange(2, 1, 1, 7).setValues([['Fix cart', 'Done', 2, 'Dev', true, 'link', 'idkhac']]);
  const aug = ss.insertSheet('08/2026');
  aug.getRange(2, 1, 1, 7).setValues([['Fix cart', WTL, 2, 'Dev', false, 'link', 'pfix']]);
  const pages = {}; pages[DS1] = [page('pfix', 'Fix cart', 'Done', 2, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  env.sandbox.syncNow();
  ok(String(aug.getRange(2, 8).getValue()).indexOf('Nghi trùng TÊN') !== -1, 'lượt đầu có cờ');
  aug.getRange(2, 8).clearContent();
  const r = env.sandbox.syncNow();
  eq(aug.getRange(2, 8).getValue(), '', 'không mọc lại');
  eq(r.dupFlagged, 1, 'vẫn đếm');
});
t('F8: chưa từng ghi note thì lần đầu vẫn phải ghi (không im lặng từ đầu)', () => {
  const { ss, aug } = handTwinSS();
  const pages = {}; pages[DS1] = [page('pfix', 'Fix cart', 'Done', 2, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  const r = env.sandbox.syncNow();
  eq(r.dupHandKept, 1);
  ok(String(aug.getRange(2, 8).getValue()).indexOf('07/2026') !== -1,
     'note nêu đích danh tab giữ: ' + aug.getRange(2, 8).getValue());
});

console.log('— F9: làm theo SETUP.md (dán page id) không được biến dòng tay thành mồi cho luật 8 —');
// "Trống G = dòng tay" đứng vững chừng nào chỉ script mới đặt id vào G. Từ lúc tài liệu
// bảo anh tự dán id vào, tiền đề đó sai: dán xong là dòng tay mất hết lớp bảo vệ và bị
// luật 8 dọn. Dấu vân tay còn lại của dòng script sinh là ô Card (F) — nó được ghi ngay
// lúc dòng chào đời, cùng một setValues với id.
t('F9: dán id vào dòng tay August trùng dòng CÓ id ở July → KHÔNG bị dọn, chỉ ghi note', () => {
  const s = revChronSS(['08/2026', '07/2026']);
  s['07/2026'].getRange(2, 1, 1, 7).setValues([['Fix cart', 'Waiting to test', 2, 'Reviewer', true, 'link', 'pfix']]);
  s['08/2026'].getRange(2, 1, 1, 7).setValues([['Fix cart', WTL, 8, 'Reviewer', false, '', 'pfix']]);
  const pages = {}; pages[DS1] = [page('pfix', 'Fix cart', 'Done', 2, 'Reviewer')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss: s.ss });
  const r = env.sandbox.syncNow();
  eq(r.dupCleared, 0, 'dòng anh vừa gõ + dán id KHÔNG được xoá');
  eq(r.dupHandKept, 1, 'chỉ ghi note để anh tự quyết');
  eq(s['08/2026'].getRange(2, 1).getValue(), 'Fix cart', 'dòng tay còn nguyên');
  eq(s['08/2026'].getRange(2, 7).getValue(), 'pfix', 'id anh dán còn nguyên');
  ok(String(s['08/2026'].getRange(2, 8).getValue()).indexOf('07/2026') !== -1,
     'note chỉ đích danh tab giữ: ' + s['08/2026'].getRange(2, 8).getValue());
  eq(s['07/2026'].getRange(2, 2).getValue(), 'Done', 'dòng giữ vẫn được update');
});
t('F9: bản sao do SCRIPT sinh (có ô Card) vẫn bị dọn như cũ', () => {
  const s = revChronSS(['08/2026', '07/2026']);
  s['07/2026'].getRange(2, 1, 1, 5).setValues([['Fix cart', 'Waiting to test', 2, 'Reviewer', true]]);
  s['08/2026'].getRange(2, 1, 1, 7).setValues([['Fix cart', WTL, 8, 'Reviewer', false,
                                                '=HYPERLINK("https://notion.so/pfix","Notion ↗")', 'pfix']]);
  const pages = {}; pages[DS1] = [page('pfix', 'Fix cart', 'Done', 2, 'Reviewer')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss: s.ss });
  const r = env.sandbox.syncNow();
  eq(r.dupCleared, 1, 'dòng script sinh vẫn dọn');
  eq(s['08/2026'].getRange(2, 1).getValue(), '', 'dọn sạch');
  eq(s['07/2026'].getRange(2, 7).getValue(), 'pfix', 'và vá id vào dòng giữ');
});

console.log('— D1: bia mộ không được chiếm dòng tay ở tab cũ hơn bằng phép vá id theo TÊN —');
// Vá id theo TÊN là suy đoán, chính rule 7 tự cảnh báo tên chung ("Fix bug", "Review PR")
// đụng nhau. Với pid ĐÃ LÀ BIA MỘ, vá xong dòng tay mang id của task anh vừa xoá: lượt
// sau nó khớp bằng id, hết là bia mộ, rơi vào đường update và bị ghi đè Tên/Status/Point/
// Role + vá link. Bia mộ + stamped đã chặn re-add rồi, nên đường vá này không mua thêm gì
// mà lấy mất dòng anh gõ tay, ở một tab CLOSED_THROUGH không bảo vệ được (chốt sổ chỉ
// chặn ADD).
t('D1: bia mộ ở 07 + dòng tay cùng tên ở 06 → không vá id, không ghi note, dòng tay nguyên vẹn', () => {
  const s = revChronSS(['08/2026', '07/2026', '06/2026']);
  s['07/2026'].getRange(2, 7).setValue('pdel');                       // bia mộ: anh xoá, G sót
  s['06/2026'].getRange(2, 1, 1, 7).setValues([['Fix cart', 'Done', 2, 'Dev', true, '', '']]);
  newState(s.ss, [['pdel', 'Done', 1]]);
  const pages = {}; pages[DS1] = [page('pdel', 'Fix cart', 'Done', 9, 'Reviewer')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss: s.ss });
  const r = env.sandbox.syncNow();
  eq(r.tombstones, 1, 'vẫn nhận ra bia mộ');
  eq(r.added, 0, 'vẫn không add lại ở đâu');
  eq(r.blockedOld, 0, 'nhánh bia mộ KHÔNG được vá id theo tên nữa');
  eq(s['06/2026'].getRange(2, 7).getValue(), '', 'dòng tay không bị gán id của task đã xoá');
  eq(s['06/2026'].getRange(2, 8).getValue(), '', 'và không bị ghi note');
});
t('D1: chạy tiếp lượt sau → dòng tay tháng cũ vẫn của anh, không bị đường update đè', () => {
  const s = revChronSS(['08/2026', '07/2026', '06/2026']);
  s['07/2026'].getRange(2, 7).setValue('pdel');
  s['06/2026'].getRange(2, 1, 1, 7).setValues([['Fix cart', 'Done', 2, 'Dev', true, '', '']]);
  newState(s.ss, [['pdel', 'Done', 1]]);
  const pages = {}; pages[DS1] = [page('pdel', 'Fix cart', 'Done', 9, 'Reviewer')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss: s.ss });
  env.sandbox.syncNow();
  const r2 = env.sandbox.syncNow();
  eq(r2.tombstones, 1, 'lượt sau vẫn là bia mộ, không "sống lại" nhờ id vừa được vá');
  eq(r2.updated, 0, 'không có gì để update — task này anh đã xoá');
  const row = s['06/2026'].getRange(2, 1, 1, 8).getValues()[0];
  eq(row[2], 2, 'Point anh gõ tay giữ nguyên (Notion đang là 9)');
  eq(row[3], 'Dev', 'Role anh gõ tay giữ nguyên (Notion đang là Reviewer)');
  eq(row[5], '', 'không vá link Card vào dòng tay');
  eq(row[6], '', 'không có id của task đã xoá');
});

// GIỚI HẠN ĐÃ CHẤP NHẬN (đi kèm D1, không phải bug bỏ sót). Dán id vào một dòng TRỐNG
// TRƠN ở tháng đang tính trong khi task còn dòng tay ở tab CŨ HƠN: luật 8 không dọn gì
// (dòng tay bất khả xâm phạm) nên keeper không được vá id, và từ lượt 2 dòng trống mang
// id lẻ loi thành bia mộ → task đứng yên. Trước D1 nó tự gỡ nhờ phép vá id theo tên ở
// nhánh bia mộ — chính phép vá đó là đường D1 dùng để ĐÈ MẤT dòng tay của một task đã
// xoá. Không có tín hiệu nào phân biệt hai ca, nên đổi "ngừng cập nhật, không mất gì"
// lấy "không bao giờ đè mất dòng tay". Cửa thoát: dán id vào chính dòng tab cũ.
t('D1 (giới hạn đã chấp nhận): dán id vào dòng TRỐNG khi còn dòng tay tab cũ → đứng yên, không mất gì', () => {
  const s = revChronSS(['08/2026', '07/2026']);
  s['07/2026'].getRange(2, 1, 1, 5).setValues([['Fix cart', 'Testing', 2, 'Dev', true]]);
  s['08/2026'].getRange(2, 7).setValue('pfix');       // anh dán id vào dòng trống trơn
  newState(s.ss, [['pfix', 'Testing', '']]);          // chưa từng stamp
  const pages = {}; pages[DS1] = [page('pfix', 'Fix cart', 'Done', 9, 'Reviewer')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss: s.ss });
  const r1 = env.sandbox.syncNow();
  eq(r1.updated, 1, 'lượt đầu: dòng tab cũ vẫn được cập nhật một lần');
  eq(s['07/2026'].getRange(2, 3).getValue(), 9, 'và nhận Point mới');
  const r2 = env.sandbox.syncNow();
  eq(r2.tombstones, 1, 'từ lượt 2: dòng trống mang id lẻ loi thành bia mộ');
  eq(r2.updated, 0, 'task đứng yên — đây là giá đã chấp nhận của D1');
  eq(s['07/2026'].getRange(2, 1).getValue(), 'Fix cart', 'nhưng KHÔNG mất dòng nào');
  eq(s['07/2026'].getRange(2, 7).getValue(), '', 'và không bị gán id sau lưng');
  s['07/2026'].getRange(2, 7).setValue('pfix');       // cửa thoát: dán id vào chính dòng đó
  const r3 = env.sandbox.syncNow();
  eq(r3.updated, 1, 'cửa thoát SETUP.md chạy thật');
  eq(r3.tombstones, 0, 'dòng sống thắng bia mộ');
});

console.log('— D2: migration _STATE đời cũ không được đóng dấu "đã xoá" cho task chưa từng có dòng —');
// Bản trước gom MỌI tên có dòng trống G ở BẤT KỲ tab tháng nào. Task Notion mới
// toanh trùng tên một dòng tay ở tháng ĐANG TÍNH bị đóng dấu stamped vĩnh viễn ngay lượt
// migration, rồi chết ở cổng add mãi mãi — và alert quét bù bảo anh đã xoá nó. Dòng tay
// ở tab cũ hơn đã có rule 7 lo (vá id + blockedOld, chặn trước cổng add); dòng tay ở
// đúng tab đang tính đã có cờ "Nghi trùng" của rule 5 lo. Chỗ duy nhất cần suy đoán là
// dòng tay ở tab MỚI HƠN tháng đang tính — đúng hình ca 2026-08-06 (ghim về 07, gõ tay
// lại vào 08).
t('D2: dòng tay ở THÁNG ĐANG TÍNH → task mới trùng tên vẫn được add, không bị gán nhãn đã xoá', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const jul = ss.insertSheet('07/2026');
  jul.getRange(2, 1, 1, 7).setValues([['Task cũ', 'Done', 3, 'Dev', false, 'link', 'pold']]);
  const aug = ss.insertSheet('08/2026');
  aug.getRange(2, 1, 1, 5).setValues([['Fix bug', 'Done', 3, 'Dev', false]]); // dòng tay, trống G
  legacyState(ss, [['pold', 'Done']]);
  const pages = {}; pages[DS1] = [page('pold', 'Task cũ', 'Done', 3, 'Dev'),
                                  page('pnew', 'Fix bug', 'Done', 5, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss, props: { CLOSED_THROUGH: '07/2026' } });
  const r = env.sandbox.syncNow();
  eq(r.skippedDeleted, 0, 'task chưa từng có dòng không được gán nhãn "anh đã xoá"');
  eq(r.added, 1, 'vẫn được add vào tháng đang tính');
  eq(aug.getRange(3, 1).getValue(), 'Fix bug', 'dòng mới nằm cạnh dòng tay');
  ok(String(aug.getRange(3, 8).getValue()).indexOf('Nghi trùng') !== -1,
     'và mang cờ nghi trùng của rule 5: ' + aug.getRange(3, 8).getValue());
  eq(aug.getRange(2, 1).getValue(), 'Fix bug', 'dòng tay không bị đụng');
  eq(aug.getRange(2, 7).getValue(), '', 'dòng tay vẫn trống G');
});
t('D2: nhãn oan không được ghi vĩnh viễn vào _STATE — quét bù sau đó không tố oan anh', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const jul = ss.insertSheet('07/2026');
  jul.getRange(2, 1, 1, 7).setValues([['Task cũ', 'Done', 3, 'Dev', false, 'link', 'pold']]);
  const aug = ss.insertSheet('08/2026');
  aug.getRange(2, 1, 1, 5).setValues([['Fix bug', 'Done', 3, 'Dev', false]]);
  legacyState(ss, [['pold', 'Done']]);
  const pages = {}; pages[DS1] = [page('pold', 'Task cũ', 'Done', 3, 'Dev'),
                                  page('pnew', 'Fix bug', 'Done', 5, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss, props: { CLOSED_THROUGH: '07/2026' } });
  env.sandbox.syncNow();
  const r2 = env.sandbox.backfillCounted();
  eq(r2.skippedDeleted, 0, 'quét bù không được báo "anh đã xoá" task chưa bao giờ bị xoá');
  ok(env.ui.alerts[0].indexOf('Không hồi sinh') === -1,
     'alert không có dòng tố oan: ' + env.ui.alerts[0]);
});
t('D2: dòng tay ở tab MỚI HƠN tháng đang tính vẫn chặn được, và log nêu đích danh', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  seedOldState(ss);
  const jul = ss.insertSheet('07/2026');
  jul.getRange(3, 1, 1, 7).setValues([scriptRow('Other July task', 'p3')]);
  const aug = ss.insertSheet('08/2026');
  aug.getRange(2, 1, 1, 7).setValues([handRow(T1)]);
  aug.getRange(3, 1, 1, 7).setValues([handRow(T2)]);
  const env = makeEnv({ nowMonth: '08/2026', pages: incidentPages(), ss,
                        props: { ACTIVE_MONTH: '07/2026' } });
  const r = env.sandbox.backfillCounted();
  eq(r.added, 0, 'ca 2026-08-06: không kéo về July');
  eq(r.skippedDeleted, 2, 'cả hai vẫn bị chặn');
  ok(env.logs.some(l => l.indexOf(T1) !== -1 && l.indexOf('08/2026') !== -1 && l.indexOf('trùng TÊN') !== -1),
     'log phải nêu đích danh task + dòng tay khớp: ' + env.logs.join('\n'));
  ok(env.ui.alerts[0].indexOf('không phải page id') !== -1,
     'alert phải nói rõ đây là khớp theo TÊN, không phải bằng chứng anh đã xoá: ' + env.ui.alerts[0]);
});

console.log('— D3: SCRIPT_NOTE_ACK không được phình tới trần 9KB rồi kéo sập cả lượt sync —');
// setProperty của Apps Script chặn ở 9216 byte. noteOnce_ chỉ thêm, không bao giờ dọn,
// nên tới ngưỡng ~581 dòng đã ack là setProperty ném — và cú ném đó nằm TRƯỚC writeState_,
// không có try/catch nào trên đường noteOnce_ → resolveCrossTabTwins_ → syncNow. Mọi nhịp
// 10 phút chết vĩnh viễn vì store không bao giờ nhỏ lại.
function fillRows_(sh, n) {
  const v = []; for (let i = 0; i < n; i++) v.push(['x' + i, '', '', '', false, '', '', '']);
  sh.getRange(2, 1, n, 8).setValues(v);
}
function twinNoteSS_() { // dòng script ở 05 + dòng tay cùng tên ở 08 → luật 8 phải ghi note
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const may = ss.insertSheet('05/2026');
  may.getRange(2, 1, 1, 7).setValues([['Fix cart', WTL, 8, 'Reviewer', false, 'link', 'pfix']]);
  const aug = ss.insertSheet('08/2026');
  aug.getRange(2, 1, 1, 5).setValues([['Fix cart', WTL, 8, 'Reviewer', false]]);
  return { ss, may, aug };
}
t('D3: ack đầy toàn dòng CÒN SỐNG (không dọn được) → ghi hỏng vẫn không kéo sập sync', () => {
  const { ss, aug } = twinNoteSS_();
  const ack = {};
  ['01/2026', '02/2026', '03/2026', '04/2026'].forEach(m => {
    fillRows_(ss.insertSheet(m), 180);
    for (let r = 2; r <= 181; r++) ack[m + '!' + r] = 1;
  });
  ok(JSON.stringify(ack).length > 9216, 'seed phải thật sự vượt trần 9216 byte');
  const pages = {}; pages[DS1] = [page('pfix', 'Fix cart', 'Done', 2, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss,
                        props: { SCRIPT_NOTE_ACK: JSON.stringify(ack) } });
  const r = env.sandbox.syncNow();
  eq(r.dupHandKept, 1, 'lượt sync vẫn chạy tới nơi');
  eq(r.updated, 1, 'và vẫn cập nhật được dòng script');
  ok(String(aug.getRange(2, 8).getValue()).indexOf('🤖') === 0, 'note vẫn được ghi');
  const st = ss.getSheetByName('_STATE');
  eq(st.getRange(2, 1).getValue(), 'pfix', '_STATE vẫn được ghi — cú ném không cắt ngang lượt');
});
t('D3: ack của dòng đã bị dọn / tab không còn được dọn theo, không dồn lên trần', () => {
  const { ss, aug } = twinNoteSS_();
  const ack = {};
  for (let i = 0; i < 600; i++) ack['01/2020!' + i] = 1; // tab đó không còn tồn tại
  ok(JSON.stringify(ack).length > 9216, 'seed phải thật sự vượt trần 9216 byte');
  const pages = {}; pages[DS1] = [page('pfix', 'Fix cart', 'Done', 2, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss,
                        props: { SCRIPT_NOTE_ACK: JSON.stringify(ack) } });
  env.sandbox.syncNow();
  const saved = JSON.parse(env.props.SCRIPT_NOTE_ACK);
  eq(Object.keys(saved).filter(k => k.indexOf('01/2020!') === 0).length, 0, 'ack chết bị dọn sạch');
  eq(saved['08/2026!2'], 1, 'ack của dòng vừa ghi note thì giữ');
  ok(JSON.stringify(saved).length < 9216, 'store về lại dưới trần');
  ok(String(aug.getRange(2, 8).getValue()).indexOf('🤖') === 0, 'note vẫn được ghi');
});

console.log('— P1: tín hiệu xoá rộng ra — A..D trống là đủ, E/F/H không cứu dòng nữa —');
// Ca thật 2026-08-06 vòng 2: anh quét đúng mấy cột NHÌN THẤY (A..D) rồi bấm Delete. Cột G
// ẩn giữ id, ô tick Have (E) và link Card (F) sống sót — phép thử cũ đòi trống hết A..F+H
// nên dòng không bao giờ là bia mộ, và đường update ghi lại Tên/Status/Point/Role từ Notion.
// Ranh giới đo được: chỉ cần MỘT ô trong E / F / H-anh-gõ sống sót là dòng bị hồi sinh.
function tombSS_(cells, stamp) {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const jul = ss.insertSheet('07/2026');
  jul.getRange(2, 7).setValue('p1');
  (cells || []).forEach(c => jul.getRange(2, c[0]).setValue(c[1]));
  newState(ss, [['p1', 'Done', stamp === undefined ? 1 : stamp]]);
  return { ss, jul };
}
function tombEnv_(ss, pages) {
  const p = pages || {};
  if (!p[DS1]) p[DS1] = [page('p1', 'Task A', 'Done', 3, 'Dev')];
  return makeEnv({ nowMonth: '08/2026', pages: p, ss });
}
const HAND_NOTE = 'đã chuyển sang tháng 8';
[
  { name: 'không còn ô nào', cells: [] },
  { name: 'E còn tick Have', cells: [[5, true]] },
  { name: 'F còn link Card', cells: [[6, 'link']] },
  { name: 'E tick + F link (đúng ca thật)', cells: [[5, true], [6, 'link']] },
  { name: 'H là note anh gõ tay', cells: [[8, HAND_NOTE]] },
  { name: 'E + F + H đủ bộ', cells: [[5, true], [6, 'link'], [8, HAND_NOTE]] },
].forEach(c => {
  t('P1: A..D trống, ' + c.name + ' → là bia mộ, không hồi sinh', () => {
    const { ss, jul } = tombSS_(c.cells);
    const env = tombEnv_(ss);
    const r = env.sandbox.syncNow();
    eq(r.tombstones, 1, 'phải nhận ra là bia mộ');
    eq(r.updated, 0, 'không update');
    eq(r.healedLink, 0, 'không vá link');
    eq(jul.getRange(2, 1).getValue(), '', 'tên KHÔNG hồi sinh');
    eq(jul.getRange(2, 2).getValue(), '', 'status trống');
    eq(jul.getRange(2, 3).getValue(), '', 'point trống → KPI tháng đó không đếm');
    eq(jul.getRange(2, 7).getValue(), 'p1', 'id vẫn nằm đó ghim pid');
  });
});
t('P1: H là note anh gõ → note đó không bị đè, chỉ là nó không cứu dòng nữa', () => {
  const { ss, jul } = tombSS_([[8, HAND_NOTE]]);
  const env = tombEnv_(ss);
  eq(env.sandbox.syncNow().tombstones, 1);
  eq(jul.getRange(2, 8).getValue(), HAND_NOTE, 'chữ của anh nguyên vẹn');
});
// Tín hiệu là CẢ BỐN cột script sở hữu cùng trống. Còn một ô trong A..D nghĩa là dòng
// vẫn đang mang dữ liệu của script — không phải thao tác xoá.
[[1, 'Task A', 'A còn tên'], [2, 'Done', 'B còn status'],
 [3, 5, 'C còn point'], [4, 'Dev', 'D còn role']].forEach(c => {
  t('P1: ' + c[2] + ' → KHÔNG phải bia mộ, update chạy như thường', () => {
    const { ss, jul } = tombSS_([[c[0], c[1]], [5, true], [6, 'link']]);
    const env = tombEnv_(ss);
    const r = env.sandbox.syncNow();
    eq(r.tombstones, 0, 'còn ô của script → dòng còn sống');
    eq(r.updated, 1, 'update chạy');
    eq(jul.getRange(2, 1).getValue(), 'Task A', 'tên về từ Notion');
    eq(jul.getRange(2, 5).getValue(), true, 'ô tick của anh không bị đụng');
  });
});
t('P1: pid CHƯA stamp + A..D trống + E/F còn → không phải bia mộ, script điền cả dòng', () => {
  const { ss, jul } = tombSS_([[5, true], [6, 'link']], '');
  const env = tombEnv_(ss);
  const r = env.sandbox.syncNow();
  eq(r.tombstones, 0, 'chưa từng stamp thì không thể là dấu xoá');
  eq(r.added, 0, 'và không add bản sao ở đâu cả');
  eq(jul.getRange(2, 1).getValue(), 'Task A', 'dòng được điền');
  eq(jul.getRange(2, 3).getValue(), 3, 'point');
});
// Bỏ note bia mộ xong thì dòng đóng băng nhìn đúng như một dòng trống — chỉ còn mỗi ô G.
// nextFreeRow_ đòi TRỐNG HẾT A..H nên nó không trống, và phải giữ nguyên như vậy: lấy dòng
// đó làm chỗ ghi task mới là đè mất id giữ chỗ, và task anh đã xoá sống lại ở lượt sau.
t('P1: bia mộ không bao giờ bị đường add lấy làm dòng trống — id ở G giữ chỗ', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const aug = ss.insertSheet('08/2026');
  aug.getRange(2, 7).setValue('p1');   // bia mộ: A..F và H trống, chỉ còn id ở G
  newState(ss, [['p1', 'Done', 1]]);
  const pages = {};
  pages[DS1] = [page('p1', 'Task A', 'Done', 3, 'Dev'), page('p3', 'Task C', 'In progress', 1, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  eq(env.sandbox.syncNow().tombstones, 1, 'lượt baseline: dòng 2 là bia mộ');
  pages[DS1][1] = page('p3', 'Task C', 'Ready to Test', 1, 'Dev');
  const r = env.sandbox.syncNow();
  eq(r.added, 1, 'Task C vượt mốc nên phải được add');
  eq(aug.getRange(2, 7).getValue(), 'p1', 'id bia mộ KHÔNG bị đè');
  eq(aug.getRange(2, 1).getValue(), '', 'dòng bia mộ vẫn trống');
  eq(aug.getRange(3, 1).getValue(), 'Task C', 'dòng mới rơi xuống dòng trống THẬT');
});

console.log('— P2: đóng băng phải NHÌN THẤY được và MỞ RA được —');
// Note bia mộ đã bỏ (Garry chốt 2026-08-06, sau khi nhìn sheet thật): bia mộ là dòng TRỐNG,
// một ghi chú nằm đó đọc ra thành "không có task mà vẫn có note". Việc nhìn thấy chuyển hẳn
// sang alert quét bù + diagnoseSheet — hai hộp thoại đọc được bất cứ lúc nào, xem nhóm R2.
t('P2: bia mộ → script KHÔNG ghi gì vào ô H, kể cả sau nhiều lượt', () => {
  const { ss, jul } = tombSS_([[5, true], [6, 'link']]);
  const env = tombEnv_(ss);
  for (let i = 1; i <= 3; i++) {
    eq(env.sandbox.syncNow().tombstones, 1, 'lượt ' + i + ': vẫn là bia mộ');
    eq(jul.getRange(2, 8).getValue(), '', 'lượt ' + i + ': ô H phải trống trơn');
  }
});
t('P2: bia mộ đứng yên qua nhiều lượt — không hồi sinh, không update', () => {
  const { ss, jul } = tombSS_([[5, true], [6, 'link']]);
  const env = tombEnv_(ss);
  for (let i = 1; i <= 3; i++) {
    const r = env.sandbox.syncNow();
    eq(r.tombstones, 1, 'lượt ' + i + ': vẫn là bia mộ');
    eq(r.updated, 0, 'lượt ' + i + ': vẫn không hồi sinh');
  }
  eq(jul.getRange(2, 1).getValue(), '', 'tên vẫn trống sau 3 lượt');
});
t('P2 (mở ra được): gõ lại tên vào cột A → dòng sống lại, sync tiếp như thường', () => {
  const { ss, jul } = tombSS_([[5, true], [6, 'link']]);
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'Done', 3, 'Dev')];
  const env = tombEnv_(ss, pages);
  eq(env.sandbox.syncNow().tombstones, 1, 'đang đóng băng');
  jul.getRange(2, 1).setValue('Task A'); // anh gõ tên lại
  const r = env.sandbox.syncNow();
  eq(r.tombstones, 0, 'hết đóng băng');
  eq(r.updated, 1, 'update chạy lại');
  eq(jul.getRange(2, 2).getValue(), 'Done', 'status về từ Notion');
  eq(jul.getRange(2, 3).getValue(), 3, 'point về từ Notion');
  eq(jul.getRange(2, 4).getValue(), 'Dev', 'role về từ Notion');
  eq(jul.getRange(2, 5).getValue(), true, 'ô tick của anh không bị đụng');
  pages[DS1] = [page('p1', 'Task A', 'Waiting to Launch', 4, 'Dev')];
  env.sandbox.syncNow();
  eq(jul.getRange(2, 2).getValue(), 'Waiting to Launch', 'và tiếp tục sống theo Notion');
  eq(jul.getRange(2, 3).getValue(), 4);
});

console.log('— P3: menu "Xoá task khỏi tháng này" —');
function delSS_() {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const aug = ss.insertSheet('08/2026');
  aug.getRange(2, 1, 1, 7).setValues([['Task A', 'Done', 3, 'Dev', true, 'link', 'p1']]);
  aug.getRange(3, 1, 1, 7).setValues([['Task B', 'Done', 4, 'Dev', false, 'link', 'p2']]);
  aug.getRange(2, 9).setValue('KPI tháng'); // khối KPI nằm CÙNG DÒNG với task
  newState(ss, [['p1', 'Done', 1], ['p2', 'Done', 1]]);
  return { ss, aug };
}
function delPages_() {
  const p = {}; p[DS1] = [page('p1', 'Task A', 'Done', 3, 'Dev'),
                          page('p2', 'Task B', 'Done', 4, 'Dev')];
  return p;
}
t('P3: có trong menu, và tên hàm KHÔNG kết thúc bằng gạch dưới', () => {
  const { sandbox, ui } = makeEnv({ nowMonth: '08/2026' });
  sandbox.onOpen();
  const item = ui.menus[0].items.filter(x => x.label && x.label.indexOf('Xoá task khỏi tháng này') !== -1)[0];
  ok(item, 'menu thiếu mục xoá: ' + JSON.stringify(ui.menus[0].items));
  ok(item.fn.slice(-1) !== '_', 'addItem không gọi được hàm private: ' + item.fn);
  eq(typeof sandbox[item.fn], 'function', 'hàm ' + item.fn + ' phải tồn tại');
});
t('P3: Code.gs không bao giờ gọi deleteRow / deleteRows', () => {
  ok(!/\.deleteRows?\s*\(/.test(SRC), 'deleteRow nuốt luôn công thức KPI ở cột I+');
});
t('P3: xoá vùng chọn → A..F và H trống, GIỮ id ở G, KPI cột I+ nguyên', () => {
  const { ss, aug } = delSS_();
  aug.getRange(2, 8).setValue('ghi chú cũ');
  const env = makeEnv({ nowMonth: '08/2026', pages: delPages_(), ss, uiAnswer: 'YES' });
  ss.selectRange_(aug, 2, 1, 2, 8);
  const r = env.sandbox.deleteTasksFromMonth();
  eq(r.cleared, 2, 'báo đúng số dòng đã xoá');
  [2, 3].forEach(row => {
    for (let c = 1; c <= 6; c++) eq(aug.getRange(row, c).getValue(), '', 'dòng ' + row + ' cột ' + c);
    eq(aug.getRange(row, 8).getValue(), '', 'dòng ' + row + ' cột H');
  });
  eq(aug.getRange(2, 7).getValue(), 'p1', 'id ở G được giữ');
  eq(aug.getRange(3, 7).getValue(), 'p2');
  eq(aug.getRange(2, 9).getValue(), 'KPI tháng', 'khối KPI cùng dòng không bị đụng');
  ok(env.ui.alerts.join(' ').indexOf('2') !== -1, 'phải báo lại số dòng: ' + env.ui.alerts.join(' | '));
});
t('P3: xoá xong, dù id ở G bị dọn nốt thì quét bù vẫn KHÔNG hồi sinh', () => {
  const { ss, aug } = delSS_();
  const env = makeEnv({ nowMonth: '08/2026', pages: delPages_(), ss, uiAnswer: 'YES' });
  ss.selectRange_(aug, 2, 1, 2, 8);
  eq(env.sandbox.deleteTasksFromMonth().cleared, 2);
  aug.getRange(2, 7).clearContent(); aug.getRange(3, 7).clearContent(); // anh dọn nốt cột G
  const r = env.sandbox.backfillCounted();
  eq(r.added, 0, 'không task nào mọc lại');
  eq(r.skippedDeleted, 2, 'dấu stamped do menu đóng đã chặn được');
});
t('P3: bấm Không → không xoá gì cả', () => {
  const { ss, aug } = delSS_();
  const env = makeEnv({ nowMonth: '08/2026', pages: delPages_(), ss, uiAnswer: 'NO' });
  ss.selectRange_(aug, 2, 1, 2, 8);
  eq(env.sandbox.deleteTasksFromMonth().cleared, 0);
  eq(aug.getRange(2, 1).getValue(), 'Task A', 'dòng nguyên vẹn');
});
t('P3: không có UI (chạy từ editor / trigger) → không xoá gì cả', () => {
  const { ss, aug } = delSS_();
  const env = makeEnv({ nowMonth: '08/2026', pages: delPages_(), ss, noUi: true });
  ss.selectRange_(aug, 2, 1, 2, 8);
  eq(env.sandbox.deleteTasksFromMonth().cleared, 0);
  eq(aug.getRange(2, 1).getValue(), 'Task A');
});
t('P3: tab không phải MM/YYYY → từ chối', () => {
  const { ss } = delSS_();
  const other = ss.insertSheet('Ghi chú');
  other.getRange(2, 1, 1, 7).setValues([['Task A', 'Done', 3, 'Dev', true, 'link', 'p1']]);
  const env = makeEnv({ nowMonth: '08/2026', pages: delPages_(), ss, uiAnswer: 'YES' });
  ss.selectRange_(other, 2, 1, 1, 8);
  eq(env.sandbox.deleteTasksFromMonth().cleared, 0);
  eq(other.getRange(2, 1).getValue(), 'Task A', 'không đụng tab lạ');
});
t('P3: vùng chọn tràn sang khối KPI (cột I+) → từ chối, không xoá', () => {
  const { ss, aug } = delSS_();
  const env = makeEnv({ nowMonth: '08/2026', pages: delPages_(), ss, uiAnswer: 'YES' });
  ss.selectRange_(aug, 2, 1, 2, 12); // đúng hình "bấm số dòng chọn cả dòng"
  eq(env.sandbox.deleteTasksFromMonth().cleared, 0);
  eq(aug.getRange(2, 1).getValue(), 'Task A', 'không xoá gì');
  eq(aug.getRange(2, 9).getValue(), 'KPI tháng', 'KPI nguyên');
});
t('P3: vùng chọn không có page id nào ở G → từ chối, dòng tay nguyên vẹn', () => {
  const { ss, aug } = delSS_();
  aug.getRange(5, 1, 1, 5).setValues([['Dòng tay', 'Done', 2, 'Dev', false]]);
  const env = makeEnv({ nowMonth: '08/2026', pages: delPages_(), ss, uiAnswer: 'YES' });
  ss.selectRange_(aug, 5, 1, 1, 8);
  eq(env.sandbox.deleteTasksFromMonth().cleared, 0);
  eq(aug.getRange(5, 1).getValue(), 'Dòng tay', 'dòng tay không bị script dọn');
});
t('P3: vùng chọn lẫn dòng tay → chỉ xoá dòng có id, dòng tay còn nguyên + được báo', () => {
  const { ss, aug } = delSS_();
  aug.getRange(4, 1, 1, 5).setValues([['Dòng tay', 'Done', 2, 'Dev', false]]);
  const env = makeEnv({ nowMonth: '08/2026', pages: delPages_(), ss, uiAnswer: 'YES' });
  ss.selectRange_(aug, 2, 1, 3, 8);
  const r = env.sandbox.deleteTasksFromMonth();
  eq(r.cleared, 2, 'hai dòng có id');
  eq(r.skipped, 1, 'dòng tay được đếm riêng');
  eq(aug.getRange(4, 1).getValue(), 'Dòng tay', 'dòng tay nguyên vẹn');
  ok(env.ui.alerts.join(' ').indexOf('4') !== -1, 'phải nêu dòng bị bỏ qua: ' + env.ui.alerts.join(' | '));
});
// Ghi state từ một đường phụ không bao giờ được làm HẸP ký ức xoá tay của pid khác —
// cùng luật với writeState_. _STATE format cũ chưa có cột dấu, nên phải dựng lại từ sheet
// trước khi ghi, y hệt syncNow, không thì mọi pid khác mất dấu ngay lượt bấm nút.
t('P3: _STATE format cũ → menu xoá không làm rơi dấu đã-từng-add của pid khác', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const aug = ss.insertSheet('08/2026');
  aug.getRange(2, 1, 1, 7).setValues([['Task A', 'Done', 3, 'Dev', true, 'link', 'p1']]);
  aug.getRange(3, 1, 1, 7).setValues([['Task B', 'Done', 4, 'Dev', false, 'link', 'p2']]);
  legacyState(ss, [['p1', 'Done'], ['p2', 'Done']]);
  const env = makeEnv({ nowMonth: '08/2026', pages: delPages_(), ss, uiAnswer: 'YES' });
  ss.selectRange_(aug, 2, 1, 1, 8);
  eq(env.sandbox.deleteTasksFromMonth().cleared, 1, 'xoá Task A qua menu');
  aug.getRange(3, 1, 1, 8).clearContent(); // anh xoá tay Task B, sạch cả G
  const r = env.sandbox.backfillCounted();
  eq(r.added, 0, 'Task B cũng không được hồi sinh');
  eq(r.skippedDeleted, 1, 'dấu của Task B sống sót qua lượt ghi state của menu');
});
t('P3: script chưa chạy lượt sync nào (_STATE trống) → từ chối, không xoá', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const aug = ss.insertSheet('08/2026');
  aug.getRange(2, 1, 1, 7).setValues([['Task A', 'Done', 3, 'Dev', true, 'link', 'p1']]);
  const env = makeEnv({ nowMonth: '08/2026', pages: delPages_(), ss, uiAnswer: 'YES' });
  ss.selectRange_(aug, 2, 1, 1, 8);
  eq(env.sandbox.deleteTasksFromMonth().cleared, 0, 'chưa có dấu để đóng thì không xoá');
  eq(aug.getRange(2, 1).getValue(), 'Task A');
});
t('P3: xoá xong, lượt sync kế tiếp coi dòng là bia mộ và để ô H yên', () => {
  const { ss, aug } = delSS_();
  const env = makeEnv({ nowMonth: '08/2026', pages: delPages_(), ss, uiAnswer: 'YES' });
  ss.selectRange_(aug, 2, 1, 1, 8);
  eq(env.sandbox.deleteTasksFromMonth().cleared, 1);
  const r = env.sandbox.syncNow();
  eq(r.tombstones, 1, 'hình dạng chuẩn của dòng đã xoá');
  eq(aug.getRange(2, 1).getValue(), '', 'không hồi sinh');
  eq(aug.getRange(2, 8).getValue(), '', 'nút xoá đã dọn H — script không ghi ngược lại note nào');
});

console.log('— P4: ẩn lại cột G — tín hiệu xoá chỉ đọc A..D nên id không cần nằm trong tầm mắt —');
// Đời trước bỏ ẩn G vì tín hiệu xoá khi đó đòi trống A..F: G ẩn thì anh quét mấy cột nhìn
// thấy rồi Delete mà dòng vẫn không thành bia mộ. Cùng vòng đó tín hiệu thu về A..D, nên lý
// do bỏ ẩn hết hiệu lực — dọn sạch mấy cột nhìn thấy là đủ.
t('P4: sheet ĐÃ bị bỏ ẩn đời trước → phải ẩn lại, không chỉ ngừng bỏ ẩn', () => {
  const ss = new MockSS();
  const tpl = ss.insertSheet('_TEMPLATE'); tpl.showColumns(7);
  const jun = ss.insertSheet('06/2026'); jun.showColumns(7);
  const jul = ss.insertSheet('07/2026'); jul.showColumns(7);
  const env = makeEnv({ nowMonth: '07/2026', ss });
  env.sandbox.syncNow();
  [tpl, jun, jul].forEach(sh => eq(sh.hiddenCols[7], true, 'cột G còn hiện ở tab ' + sh.getName()));
});
// Sheet thật đã chạy qua đời format trước nên ROW_FORMAT_VERSION đã nằm sẵn trong Script
// Property. Chỉ đổi showColumns → hideColumns mà quên nâng ROW_FMT thì cổng phiên bản chặn
// cả pass, applyRowFormat_ không bao giờ chạy lại, và cột G hiện vĩnh viễn trên đúng cái
// sheet cần sửa. Đây là nửa mang tải của Part B.
t('P4: sheet đã có ROW_FORMAT_VERSION đời trước → vẫn phải chạy lại pass mà ẩn G', () => {
  const ss = new MockSS();
  const tpl = ss.insertSheet('_TEMPLATE'); tpl.showColumns(7);
  const jul = ss.insertSheet('07/2026'); jul.showColumns(7);
  const env = makeEnv({ nowMonth: '07/2026', ss, props: { ROW_FORMAT_VERSION: '5' } });
  env.sandbox.syncNow();
  [tpl, jul].forEach(sh => eq(sh.hiddenCols[7], true, 'cột G còn hiện ở tab ' + sh.getName()));
});
t('P4: một lần rồi thôi — anh hiện lại thì script không cãi mỗi 10 phút', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const jul = ss.insertSheet('07/2026');
  const env = makeEnv({ nowMonth: '07/2026', ss });
  env.sandbox.syncNow();
  eq(jul.hiddenCols[7], true, 'lượt đầu ẩn');
  jul.showColumns(7); // anh tự hiện lại
  const before = jul.hideColCalls.length;
  env.sandbox.syncNow();
  eq(jul.hideColCalls.length, before, 'lượt sau không đụng lại');
  eq(jul.hiddenCols[7], false, 'ý của anh được tôn trọng');
});
t('P4: tab tháng mới tạo cũng ẩn cột G', () => {
  const ss = new MockSS(); const tpl = ss.insertSheet('_TEMPLATE'); tpl.showColumns(7);
  const pages = {}; pages[DS1] = [page('pw', 'Task', 'Done', 1, 'Dev')];
  const env = makeEnv({ nowMonth: '09/2026', pages, ss });
  env.sandbox.syncNow({ backfill: true });
  eq(ss.getSheetByName('09/2026').hiddenCols[7], true, 'tab mới clone ra vẫn hiện cột G');
});

console.log('— R1: đóng băng LẦN HAI vẫn phải tự báo —');
// Đóng băng #1 → anh gõ lại tên vào A → xoá lần nữa: lần #2 không được im lặng. Bỏ note bia
// mộ thì trên sheet không còn vết nào để kiểm, nên bằng chứng phải nằm trọn ở hai hộp thoại
// đọc được bất cứ lúc nào — alert quét bù và diagnoseSheet. Vòng gọi-dòng-về ở giữa chính là
// phép thử "mở ra được": gõ lại A..D là dòng sống lại và sync tiếp từ Notion.
t('R1: đóng băng → gọi về → xoá lần nữa: lần đóng băng thứ hai vẫn báo', () => {
  const { ss, jul } = tombSS_([[5, true], [6, 'link']]);
  const env = tombEnv_(ss);
  eq(env.sandbox.syncNow().tombstones, 1, 'đóng băng lần 1');
  jul.getRange(2, 1).setValue('Task A');       // gọi dòng về đúng cách SETUP.md chỉ
  const back = env.sandbox.syncNow();
  eq(back.tombstones, 0, 'dòng sống lại');
  eq(back.updated, 1, 'và sync tiếp từ Notion');
  jul.getRange(2, 1, 1, 4).clearContent();     // xoá lần nữa
  const before = env.ui.alerts.length;
  eq(env.sandbox.backfillCounted().tombstones, 1, 'đóng băng lần 2');
  const a = env.ui.alerts.slice(before).join(' | ');
  ok(a.indexOf('07/2026 dòng 2') !== -1, 'lần đóng băng thứ hai vẫn phải nêu ra: ' + a);
  eq(env.sandbox.diagnoseSheet().tombstones, 1, 'và chẩn đoán cũng thấy');
});
t('R1: dòng từng nhận note TRÙNG rồi bị xoá → việc đóng băng vẫn được nêu', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const jul = ss.insertSheet('07/2026');
  jul.getRange(2, 1, 1, 7).setValues([['Fix cart', 'Done', 2, 'Dev', true, 'link', 'idkhac']]);
  const aug = ss.insertSheet('08/2026');
  aug.getRange(2, 1, 1, 7).setValues([['Fix cart', WTL, 2, 'Dev', false, 'link', 'pfix']]);
  const pages = {}; pages[DS1] = [page('pfix', 'Fix cart', 'Done', 2, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  env.sandbox.syncNow();
  ok(String(aug.getRange(2, 8).getValue()).indexOf('Nghi trùng TÊN') !== -1, 'lượt 1: cờ nghi trùng');
  aug.getRange(2, 8).clearContent();           // đọc rồi, xoá đi
  aug.getRange(2, 1, 1, 4).clearContent();     // rồi xoá luôn dòng
  const r = env.sandbox.syncNow();
  eq(r.tombstones, 1, 'dòng thành bia mộ');
  eq(aug.getRange(2, 8).getValue(), '', 'dấu ack của note TRÙNG vẫn giữ, H không mọc lại chữ nào');
  const d = env.sandbox.diagnoseSheet();
  eq(d.tombstones, 1, 'chẩn đoán nêu được dòng đang đóng băng');
  eq(d.tabs.find(x => x.name === '08/2026').tombRows.join(','), '2', 'và chỉ đúng dòng');
  ok(d.lines.join('\n').indexOf('❄') !== -1, 'log chi tiết phải nêu: ' + d.lines.join('\n'));
});

console.log('— R2: dòng đang đóng băng phải nhìn thấy được ngoài Execution log —');
// Đóng băng KHÔNG để lại vết nào trên sheet (note bia mộ đã bỏ — dòng trống thì không mang
// note), mà Execution log chỉ giữ vài ngày. Hai hộp thoại đọc được bất cứ lúc nào — quét bù
// và chẩn đoán — là toàn bộ đường nhìn thấy, nên phải nêu ra.
t('R2: alert quét bù nêu đúng dòng đang đóng băng, chữ anh gõ ở H vẫn nguyên', () => {
  const { ss, jul } = tombSS_([[8, HAND_NOTE]]);
  const env = tombEnv_(ss);
  const r = env.sandbox.backfillCounted();
  eq(r.tombstones, 1, 'vẫn là bia mộ');
  eq(jul.getRange(2, 8).getValue(), HAND_NOTE, 'chữ của anh không bao giờ bị đè');
  const a = env.ui.alerts.join(' | ');
  ok(a.indexOf('đóng băng') !== -1, 'alert phải nêu việc đóng băng: ' + a);
  ok(a.indexOf('07/2026 dòng 2') !== -1, 'và chỉ đúng chỗ: ' + a);
});
t('R2: chẩn đoán sheet liệt kê dòng đang đóng băng', () => {
  const { ss } = tombSS_([[8, HAND_NOTE]]);
  const env = tombEnv_(ss);
  const d = env.sandbox.diagnoseSheet();
  eq(d.tombstones, 1, 'chẩn đoán phải đếm được');
  ok(d.lines.join('\n').indexOf('đóng băng') !== -1, 'log chi tiết phải nêu: ' + d.lines.join('\n'));
  ok(env.ui.alerts.join(' | ').indexOf('đóng băng') !== -1, 'và cả trong hộp thoại tóm tắt');
});
t('R2: _STATE format cũ → dòng hình bia mộ vẫn được nêu (lượt sync tới sẽ đóng băng nó)', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const jul = ss.insertSheet('07/2026');
  jul.getRange(2, 7).setValue('p1');
  legacyState(ss, [['p1', 'Done']]);
  const env = tombEnv_(ss);
  eq(env.sandbox.diagnoseSheet().tombstones, 1, 'dấu dựng từ sheet nên hình dạng là đủ');
});
t('R2: dòng anh vừa DÁN id (pid chưa stamp) không bị chẩn đoán gọi là đóng băng', () => {
  const { ss } = tombSS_([[5, true], [6, 'link']], '');   // pid chưa từng có dấu
  const env = tombEnv_(ss);
  eq(env.sandbox.diagnoseSheet().tombstones, 0,
     'script sắp điền cả dòng cho anh — đó không phải đóng băng');
});
t('R2: không có bia mộ thì không bịa ra dòng nào', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const aug = ss.insertSheet('08/2026');
  aug.getRange(2, 1, 1, 7).setValues([['Task A', 'Done', 3, 'Dev', false, 'link', 'p1']]);
  newState(ss, [['p1', 'Done', 1]]);
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'Done', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  eq(env.sandbox.backfillCounted().tombstones, 0);
  const d = env.sandbox.diagnoseSheet();
  eq(d.tombstones, 0, 'chẩn đoán báo 0 chứ không bịa');
  ok((env.ui.alerts.join(' | ') + d.lines.join('\n')).indexOf('❄') === -1,
     'không có dòng nào đóng băng thì không liệt kê dòng nào: ' + env.ui.alerts.join(' | '));
});

console.log('— R3: nút xoá không được nuốt lượt migration của _STATE format cũ —');
// _STATE thật đang ở format 2 cột. Nút xoá ghi state là header thành "stamped" NGAY, nên
// lượt sync đầu tiên sau đó không còn biết mình đang migrate: suy-dấu-theo-tên (dòng tay ở
// tab tháng mới hơn) không bao giờ nổ, và task anh đã gõ tay lại bị kéo về thành bản sao.
t('R3: bấm nút xoá TRƯỚC lượt sync đầu → suy-dấu-theo-tên vẫn còn nguyên cho lượt sau', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  seedOldState(ss);
  const jul = ss.insertSheet('07/2026');
  jul.getRange(3, 1, 1, 7).setValues([scriptRow('Other July task', 'p3')]);
  const aug = ss.insertSheet('08/2026');
  aug.getRange(2, 1, 1, 7).setValues([handRow(T1)]);
  aug.getRange(3, 1, 1, 7).setValues([handRow(T2)]);
  const env = makeEnv({ nowMonth: '08/2026', pages: incidentPages(), ss,
                        props: { ACTIVE_MONTH: '07/2026' }, uiAnswer: 'YES' });
  ss.selectRange_(jul, 3, 1, 1, 8);
  eq(env.sandbox.deleteTasksFromMonth().cleared, 1, 'nút xoá vẫn chạy được');
  const r = env.sandbox.backfillCounted();
  eq(r.added, 0, 'không kéo bản sao nào về');
  eq(r.skippedDeleted, 2, 'suy-dấu-theo-tên vẫn nhận ra hai dòng tay');
  eq(aug.getRange(2, 1).getValue(), T1, 'dòng tay nguyên vẹn');
  eq(aug.getRange(3, 1).getValue(), T2);
});
// Header còn cũ nghĩa là lượt ghi state nào của nút xoá cũng dựng lại dấu từ sheet, nên bấm
// nút HAI lần trước lượt sync đầu là có thật. Dựng lại mà THAY chứ không GỘP thì lần bấm sau
// xoá mất dấu của lần bấm trước — đúng thứ writeState_ sinh ra để chặn, ở một đường khác.
t('R3: bấm nút xoá hai lần khi _STATE còn format cũ → dấu lần đầu không bị lần sau làm rơi', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const aug = ss.insertSheet('08/2026');
  aug.getRange(2, 1, 1, 7).setValues([['Task A', 'Done', 3, 'Dev', true, 'link', 'p1']]);
  aug.getRange(3, 1, 1, 7).setValues([['Task B', 'Done', 4, 'Dev', false, 'link', 'p2']]);
  legacyState(ss, [['p1', 'Done'], ['p2', 'Done']]);
  const env = makeEnv({ nowMonth: '08/2026', pages: delPages_(), ss, uiAnswer: 'YES' });
  ss.selectRange_(aug, 2, 1, 1, 8);
  eq(env.sandbox.deleteTasksFromMonth().cleared, 1, 'xoá Task A');
  aug.getRange(2, 7).clearContent();           // anh dọn nốt ô G của Task A
  ss.selectRange_(aug, 3, 1, 1, 8);
  eq(env.sandbox.deleteTasksFromMonth().cleared, 1, 'xoá tiếp Task B');
  aug.getRange(3, 7).clearContent();
  const r = env.sandbox.backfillCounted();
  eq(r.added, 0, 'không task nào mọc lại');
  eq(r.skippedDeleted, 2, 'dấu của cả hai lần bấm đều còn nguyên');
});
t('R3: dấu do chính nút xoá đóng vẫn sống qua lượt migration, kể cả khi anh dọn nốt ô G', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const aug = ss.insertSheet('08/2026');
  aug.getRange(2, 1, 1, 7).setValues([['Task A', 'Done', 3, 'Dev', true, 'link', 'p1']]);
  legacyState(ss, [['p1', 'Done']]);
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'Done', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss, uiAnswer: 'YES' });
  ss.selectRange_(aug, 2, 1, 1, 8);
  eq(env.sandbox.deleteTasksFromMonth().cleared, 1);
  aug.getRange(2, 7).clearContent();           // anh dọn nốt ô G
  const r = env.sandbox.backfillCounted();
  eq(r.added, 0, 'không hồi sinh');
  eq(r.skippedDeleted, 1, 'dấu của nút xoá sống qua lượt migration');
});

console.log('— N1: dấu stamped chỉ được đọc từ ĐÚNG sentinel writeState_ ghi ra —');
// `_STATE` ẩn chứ không khoá — anh mở nó ra xem rồi gõ nhầm một chữ vào cột C là xong:
// pid đó bị coi như "từng có dòng rồi bị xoá tay", cổng add chặn vĩnh viễn. Tự sửa cũng
// không được: lượt ghi state kế tiếp đóng luôn số 1 vào ô đó (dấu KHÔNG BAO GIỜ được hẹp
// lại — xem writeState_), nên chữ gõ nhầm hoá thành dấu thật. Trên nhịp 10 phút việc này
// im lặng (task chưa vượt mốc thì chưa tới cổng add), tới lượt quét bù mới lòi ra dưới
// dạng "anh đã xoá tay" — tố oan một task anh chưa từng đụng tới.
// writeState_ ghi số 1 và chỉ số 1, nên đường đọc phải đòi đúng sentinel đó.
function poisonedLegacyState_(ss, rows, badRow, badValue) {
  const st = legacyState(ss, rows);
  st.getRange(badRow, 3).setValue(badValue);
  return st;
}
t('N1: chữ gõ nhầm ở cột C của _STATE không được thành dấu "anh đã xoá tay"', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE'); ss.insertSheet('08/2026');
  poisonedLegacyState_(ss, [['pcu', 'Done'], ['pnew', 'Done']], 3, 'x');
  const pages = {}; pages[DS1] = [page('pcu', 'Task cũ', 'Done', 3, 'Dev'),
                                  page('pnew', 'Task mới', 'Done', 5, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  const r = env.sandbox.backfillCounted();
  eq(r.skippedDeleted, 0, 'không pid nào bị gán nhãn xoá tay: ' + r.skippedDeletedNames.join(' | '));
  eq(r.added, 2, 'cả hai task đều được quét bù cứu');
  eq(countTitle_(ss, 'Task mới'), 1, 'task bị đầu độc vẫn có dòng');
});
t('N1: nhiễm im lặng trên nhịp 10 phút không được đóng dấu vĩnh viễn vào _STATE', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE'); ss.insertSheet('08/2026');
  poisonedLegacyState_(ss, [['pnew', 'In progress']], 2, 'x');
  const pages = {}; pages[DS1] = [page('pnew', 'Task mới', 'In progress', 5, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  const trig = env.sandbox.syncNow();
  eq(trig.skippedDeleted, 0, 'nhịp 10 phút không nói gì — nên nó càng không được ghi dấu');
  const st = ss.getSheetByName('_STATE');
  eq(st.getRange(2, 3).getValue(), '', 'cột C phải sạch, không hoá thành dấu số 1');
  pages[DS1] = [page('pnew', 'Task mới', 'Done', 5, 'Dev')];
  const r = env.sandbox.backfillCounted();
  eq(r.skippedDeleted, 0, 'vài ngày sau quét bù không được tố oan: ' + r.skippedDeletedNames.join(' | '));
  eq(r.added, 1, 'task vẫn về được');
});
t('N1: dấu THẬT (số 1 do writeState_ ghi) vẫn chặn quét bù như cũ', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE'); ss.insertSheet('08/2026');
  newState(ss, [['pxoa', 'Done', 1]]);
  const pages = {}; pages[DS1] = [page('pxoa', 'Task đã xoá', 'Done', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  const r = env.sandbox.backfillCounted();
  eq(r.skippedDeleted, 1, 'siết sentinel không được làm rơi ký ức xoá tay');
  eq(r.added, 0);
});
t('N1: ô C định dạng text nên đọc ra chuỗi "1" vẫn là dấu thật', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE'); ss.insertSheet('08/2026');
  newState(ss, [['pxoa', 'Done', '1']]);
  const pages = {}; pages[DS1] = [page('pxoa', 'Task đã xoá', 'Done', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  eq(env.sandbox.backfillCounted().skippedDeleted, 1, 'chuỗi "1" là cùng một dấu, chỉ khác định dạng ô');
});

// Chẩn đoán đọc _STATE bằng TAY (không qua getState_, vì hàm đó tạo tab khi thiếu) nên nó
// có đường đọc cột C riêng — và đường đó phải theo ĐÚNG luật của getState_, nếu không con
// số in ra mô tả một lượt quét bù khác với lượt sẽ chạy thật.
t('N1: chữ gõ nhầm ở cột C không được làm chẩn đoán báo "đã xoá tay" sai lượt quét bù', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE'); ss.insertSheet('08/2026');
  const st = newState(ss, [['pnew', 'Done', '']]);
  st.getRange(2, 3).setValue('x');
  const env = makeEnv({ nowMonth: '08/2026', ss });
  const d = env.sandbox.diagnoseSheet();
  eq(d.deletedStamped, 0, 'chữ gõ nhầm không phải dấu xoá tay');
  eq(d.pendingBackfill, 1, 'và task đó vẫn nằm trong bán kính nổ của quét bù');
  const pages = {}; pages[DS1] = [page('pnew', 'Task mới', 'Done', 5, 'Dev')];
  const env2 = makeEnv({ nowMonth: '08/2026', pages, ss });
  eq(env2.sandbox.backfillCounted().added, 1, 'số chẩn đoán in ra phải khớp việc quét bù làm thật');
});
t('N1: chữ gõ nhầm ở cột C không được làm chẩn đoán gọi dòng chưa stamp là đóng băng', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const aug = ss.insertSheet('08/2026');
  aug.getRange(2, 7).setValue('p1');
  const st = newState(ss, [['p1', 'Done', '']]);
  st.getRange(2, 3).setValue('x');
  const pages = {}; pages[DS1] = [page('p1', 'Task A', 'Done', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  eq(env.sandbox.diagnoseSheet().tombstones, 0, 'pid chưa từng stamp thật → không phải đóng băng');
  eq(env.sandbox.syncNow().tombstones, 0, 'và sync đồng ý — nó điền cả dòng cho anh');
  eq(aug.getRange(2, 1).getValue(), 'Task A', 'dòng được điền chứ không bị đóng băng');
});

console.log('— N2: chẩn đoán không được đếm đóng băng ở tab sync không nhìn thấy —');
// scanMonthRows_ chỉ quét tab khớp MM/YYYY, nên dòng hình bia mộ nằm trong tab "Ghi chú"
// KHÔNG bị đóng băng — cả tab đó vô hình với sync. Đếm nó vào "Dòng đang đóng băng" là
// bịa ra một con số trong đúng cái công cụ sinh ra để dẹp hoang mang.
t('N2: dòng hình bia mộ ở tab KHÔNG khớp MM/YYYY không được tính là đang đóng băng', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE'); ss.insertSheet('08/2026');
  const stray = ss.insertSheet('Ghi chú');
  stray.getRange(2, 7).setValue('plac');
  newState(ss, [['plac', 'Done', 1]]);
  const env = makeEnv({ nowMonth: '08/2026', ss });
  const d = env.sandbox.diagnoseSheet();
  eq(d.tombstones, 0, 'sync không index tab đó nên ở đó không có gì bị đóng băng');
  ok(d.alienTabs.indexOf('Ghi chú') !== -1, 'tab vẫn phải bị điểm mặt: ' + d.alienTabs.join(' | '));
  ok(d.lines.join('\n').indexOf('❄') === -1, 'không được liệt kê dòng đóng băng nào');
});
t('N2: bia mộ THẬT ở tab tháng vẫn đếm đủ, chỉ dòng ở tab lạ bị bỏ ra', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const jul = ss.insertSheet('07/2026');
  jul.getRange(2, 7).setValue('p1');
  const stray = ss.insertSheet('Ghi chú');
  stray.getRange(2, 7).setValue('plac');
  newState(ss, [['p1', 'Done', 1], ['plac', 'Done', 1]]);
  const env = makeEnv({ nowMonth: '08/2026', ss });
  const d = env.sandbox.diagnoseSheet();
  eq(d.tombstones, 1, 'chỉ dòng ở tab tháng mới là đóng băng thật');
  const tomb = d.lines.filter(l => l.indexOf('❄') !== -1).join('\n');
  ok(tomb.indexOf('dòng 2') !== -1, 'vẫn chỉ đúng chỗ: ' + tomb);
  eq(d.tabs.find(x => x.name === 'Ghi chú').tombRows.length, 0, 'tab lạ không giữ dòng đóng băng nào');
});

console.log('— Ca thật 2026-08-06 vòng 2: quét A..D rồi Delete trên tab đã chốt —');
// Đúng hình sự cố: 2 task Reviewer bị xoá khỏi 07/2026 (đã chốt) bằng cách quét A..D rồi
// Delete — ô tick Have và link Card sống sót, cột G ẩn giữ id — trong khi 08/2026 có dòng
// anh gõ tay cho cùng hai task đó (trống G). Bản trước: July bị ghi lại từ Notion, KPI
// hai tháng cùng đếm.
function countTitle_(ss, title) {
  let n = 0;
  ss.getSheets().forEach(sh => sh.data.forEach(r => { if (r[0] === title) n++; }));
  return n;
}
t('vòng 2: July đứng yên, August tay nguyên vẹn, 3 lượt + quét bù không thêm gì', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  seedOldState(ss);
  const jul = ss.insertSheet('07/2026');
  jul.getRange(2, 1, 1, 7).setValues([['', '', '', '', true, 'link', 'p1']]);
  jul.getRange(3, 1, 1, 7).setValues([scriptRow('Other July task', 'p3')]);
  jul.getRange(4, 1, 1, 7).setValues([['', '', '', '', true, 'link', 'p2']]);
  const aug = ss.insertSheet('08/2026');
  aug.getRange(2, 1, 1, 7).setValues([handRow(T1)]);
  aug.getRange(3, 1, 1, 7).setValues([handRow(T2)]);
  const env = makeEnv({ nowMonth: '08/2026', pages: incidentPages(), ss,
                        props: { CLOSED_THROUGH: '07/2026' } });
  for (let i = 1; i <= 3; i++) {
    const r = env.sandbox.syncNow();
    eq(r.added, 0, 'lượt ' + i + ': không add');
    eq(r.tombstones, 2, 'lượt ' + i + ': 2 bia mộ');
    eq(r.dupCleared, 0, 'lượt ' + i + ': không dọn gì');
  }
  const rb = env.sandbox.backfillCounted();
  eq(rb.added, 0, 'quét bù cũng không kéo về July');
  eq(rb.tombstones, 2);
  [2, 4].forEach(row => {
    eq(jul.getRange(row, 1).getValue(), '', 'July dòng ' + row + ' không hồi sinh');
    eq(jul.getRange(row, 2).getValue(), '', 'status trống');
    eq(jul.getRange(row, 3).getValue(), '', 'point trống → KPI July không đếm');
    ok(jul.getRange(row, 7).getValue(), 'id vẫn ghim chống add lại');
  });
  eq(jul.getRange(3, 1).getValue(), 'Other July task', 'dòng thật bên cạnh không vạ lây');
  eq(aug.getRange(2, 1).getValue(), T1, 'dòng tay tháng 8 sống');
  eq(aug.getRange(3, 1).getValue(), T2);
  eq(aug.getRange(2, 8).getValue(), '', 'không note vô cớ lên dòng tay');
  eq(countTitle_(ss, T1), 1, 'không đếm đôi');
  eq(countTitle_(ss, T2), 1);
});

console.log('— BA BẤT BIẾN (theo thứ tự ưu tiên của rule 10) —');
// Khoá lại bằng tên gọi thẳng, để ai gỡ một chốt chặn nào cũng làm đỏ đúng một test có
// tên nói rõ mất cái gì.
t('BẤT BIẾN (i): dòng tay không bao giờ bị script tự xoá — trống G lẫn đã dán id', () => {
  const s = revChronSS(['08/2026', '07/2026']);
  s['07/2026'].getRange(2, 1, 1, 7).setValues([['Fix cart', 'Done', 2, 'Dev', true, 'link', 'pa']]);
  s['07/2026'].getRange(3, 1, 1, 7).setValues([['Fix login', 'Done', 2, 'Dev', true, 'link', 'pb']]);
  s['08/2026'].getRange(2, 1, 1, 5).setValues([['Fix cart', WTL, 8, 'Dev', false]]);          // trống G
  s['08/2026'].getRange(3, 1, 1, 7).setValues([['Fix login', WTL, 8, 'Dev', false, '', 'pb']]); // đã dán id
  const pages = {}; pages[DS1] = [page('pa', 'Fix cart', 'Done', 2, 'Dev'),
                                  page('pb', 'Fix login', 'Done', 2, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss: s.ss });
  for (let i = 1; i <= 3; i++) env.sandbox.syncNow();
  eq(s['08/2026'].getRange(2, 1).getValue(), 'Fix cart', 'dòng tay trống G sống');
  eq(s['08/2026'].getRange(3, 1).getValue(), 'Fix login', 'dòng tay đã dán id cũng sống');
  eq(s['08/2026'].getRange(3, 7).getValue(), 'pb', 'id anh dán không bị lấy đi');
});
t('BẤT BIẾN (ii): task anh đã xoá không bao giờ được hồi sinh — cả 3 kiểu xoá, qua cả 502', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const pages = {};
  pages[DS1] = [page('p1', 'Task 1', 'In progress', 3, 'Dev'), page('p2', 'Task 2', 'In progress', 3, 'Dev'),
                page('p3', 'Task 3', 'In progress', 3, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss });
  env.sandbox.syncNow();                                        // baseline
  pages[DS1] = pages[DS1].map(p => page(p.id, p.properties['Task name'].title[0].plain_text, 'Done', 3, 'Dev'));
  env.sandbox.syncNow();                                        // add cả 3
  const aug = ss.getSheetByName('08/2026');
  eq(aug.dataRowCount(), 3, 'đã add đủ 3');
  aug.getRange(2, 1, 1, 8).clearContent();                      // (a) xoá sạch cả G
  aug.getRange(3, 1, 1, 6).clearContent();                      // (b) xoá A..F, G sót lại = bia mộ
  aug.getRange(4, 1, 1, 6).clearContent();                      // (c) như (b) nhưng H còn note script
  aug.getRange(4, 8).setValue('🤖 Nghi trùng "Task 3" ở tab 07/2026');
  env.queryFail[DS1] = true; env.sandbox.syncNow(); env.queryFail[DS1] = false; // một nhịp 502
  const r = env.sandbox.backfillCounted();
  eq(r.added, 0, 'không dòng nào mọc lại');
  eq(r.skippedDeleted, 1, '(a) chặn ở cổng add');
  eq(r.tombstones, 2, '(b) + (c) chặn ở bia mộ');
  eq(aug.getRange(2, 1).getValue(), ''); eq(aug.getRange(3, 1).getValue(), '');
  eq(aug.getRange(4, 1).getValue(), '');
});
t('BẤT BIẾN (iii): tháng đã chốt không nhận dòng mới, không tạo tab', () => {
  const ss = new MockSS(); ss.insertSheet('_TEMPLATE');
  const pages = {}; pages[DS1] = [page('pmoi', 'Task mới toanh', 'Done', 5, 'Dev')];
  const env = makeEnv({ nowMonth: '08/2026', pages, ss, props: { CLOSED_THROUGH: '08/2026' } });
  const r = env.sandbox.backfillCounted();
  eq(r.added, 0); eq(r.blockedClosed, 1, 'bị chặn và được đếm');
  ok(!ss.getSheetByName('08/2026'), 'không tạo tab tháng đã chốt');
});

// ---------------- kết quả ----------------
console.log('');
console.log(pass + '/' + (pass + fail) + ' passed' + (fail ? ' — ' + fail + ' FAILED' : ''));
process.exit(fail ? 1 : 0);
