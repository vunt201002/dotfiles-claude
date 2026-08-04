/**
 * Monthly Point — Notion → Google Sheets sync (one-way, read-only on Notion).
 *
 * One tab per month ("MM/YYYY"). A task is stamped into the CURRENT month tab only
 * at the moment we observe it CROSS into a "counted" status (Ready to Test or beyond) —
 * tracked via the hidden _STATE sheet (pageId -> last seen status). The FIRST run only
 * records a baseline and adds nothing, so your manually backfilled history is untouched.
 *
 * Existing rows keep Status/Point/Role live; your Have checkbox is never overwritten.
 * Matching is by Notion page id, with task title as a fallback (handles a task that
 * exists in both boards / was tracked under a different id) — prevents duplicates.
 *
 * MONTH PIN: KPI thường chốt sổ trễ vài ngày — đầu tháng 7 task vẫn tính cho tháng 6.
 * Menu "⏪ Vẫn tính cho tháng trước" ghim tháng đích cho dòng MỚI (Script Property
 * ACTIVE_MONTH). "✅ Chốt: sang tháng lịch" gỡ ghim. Ghim cũ hơn tháng liền trước là
 * stale — tự bỏ qua, dùng tháng lịch (quên gỡ ghim chỉ lệch tối đa 1 tháng).
 *
 * SETUP: see SETUP.md. Only secret is Script Property NOTION_TOKEN.
 */

// ---------------- CONFIG (non-secret) ----------------
var ME = '168cd13f-884c-4138-bcec-bbc6ed47ea34';      // your Notion user id
// Notion DATA SOURCE ids to watch (get via GET /v1/databases/<id> with Notion-Version 2025-09-03)
var WATCH_SOURCES = [
  '25ab0da4-49f1-817c-903b-000b9aa2443b',             // Joy Wishlist Product Tasks
  '74bfb6cb-c769-4121-b1ec-887b2765d625',             // Joy Loyalty Development
];
var POINT_FIELD = 'Size card';
var STATUS_FIELD = 'Status';
// statuses meaning "has reached Ready to Test" -> eligible to be stamped.
// Two boards, two naming schemes (Wishlist vs Loyalty Development) — kept in one
// flat list rather than split per-source, ordered to read as one merged pipeline.
var COUNTED = ['Ready to Test','Waiting to test','Testing','UAT','QA/UAT',
               'To review','Reviewing','Waiting to review',
               'To deploy','Test Production','Testing prod',
               'Test Production & To launch','Launching','Waiting to Launch','Waiting to live','Done'];
var TEMPLATE = '_TEMPLATE';
var STATE = '_STATE';
var DASHBOARD = 'Dashboard';
var NOTION_VERSION = '2025-09-03';
// Note column (1-based): written ONLY when a freshly-added task looks like a title
// duplicate of a row already in another month. Col H is blank in the template; the
// KPI summary lives at col I+, so H is safe. Data columns stay A..G (7).
var NOTE_COL = 8; // H
// Script Property ACTIVE_MONTH ("MM/YYYY"): ghim tháng đích cho dòng MỚI khi KPI
// chốt sổ trễ (đầu tháng 7 vẫn tính cho tháng 6). Set/gỡ bằng menu, không sửa tay.
// Vắng mặt = tháng lịch (mặc định an toàn). Luật stale: xem activeMonth_().
var ACTIVE_MONTH_PROP = 'ACTIVE_MONTH';
// -----------------------------------------------------

function token_() {
  var t = PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN');
  if (!t) throw new Error('Missing Script Property NOTION_TOKEN');
  return t;
}
function norm_(id) { return (id || '').replace(/-/g, ''); }
function normTitle_(s) { return (s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
function isMonthTab_(name) { return /^\d{2}\/\d{4}$/.test(name); }
function isCounted_(status) { return COUNTED.indexOf(status) !== -1; }
function curMonth_() {
  var tz = Session.getScriptTimeZone() || 'Asia/Ho_Chi_Minh';
  return Utilities.formatDate(new Date(), tz, 'MM/yyyy');
}
function prevMonth_() {
  var cur = curMonth_(); // 'MM/yyyy' — string math, tránh mọi pitfall timezone
  var m = parseInt(cur.slice(0, 2), 10), y = parseInt(cur.slice(3), 10);
  m--; if (m < 1) { m = 12; y--; }
  return (m < 10 ? '0' + m : String(m)) + '/' + y;
}
// Tháng mà dòng MỚI được ghi vào. Bình thường = tháng lịch; khi KPI chốt sổ trễ,
// menu ghim tháng liền trước qua ACTIVE_MONTH. Ghim chỉ được honor khi nó là tháng
// lịch hiện tại hoặc tháng liền trước — cũ hơn nghĩa là quên gỡ ghim: bỏ qua và
// quay về tháng lịch, để thiệt hại của việc quên tối đa là 1 tháng.
function activeMonth_() {
  var pin = PropertiesService.getScriptProperties().getProperty(ACTIVE_MONTH_PROP);
  if (!pin) return curMonth_();
  if (isMonthTab_(pin) && (pin === curMonth_() || pin === prevMonth_())) return pin;
  Logger.log('ACTIVE_MONTH "%s" stale/không hợp lệ (tháng lịch %s) — dùng tháng lịch.', pin, curMonth_());
  return curMonth_();
}

// ---- Notion ----
function notionQuery_(dataSourceId) {
  var url = 'https://api.notion.com/v1/data_sources/' + dataSourceId + '/query';
  var headers = { 'Authorization': 'Bearer ' + token_(), 'Notion-Version': NOTION_VERSION };
  var filter = { or: [
    { property: 'Developer', people: { contains: ME } },
    { property: 'Reviewer',  people: { contains: ME } },
  ]};
  var out = [], cursor = null;
  do {
    var body = { page_size: 100, filter: filter };
    if (cursor) body.start_cursor = cursor;
    var resp = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json', headers: headers,
      payload: JSON.stringify(body), muteHttpExceptions: true,
    });
    if (resp.getResponseCode() !== 200) {
      Logger.log('source %s HTTP %s: %s', dataSourceId, resp.getResponseCode(), resp.getContentText().slice(0,200));
      return out;
    }
    var data = JSON.parse(resp.getContentText());
    out = out.concat(data.results || []);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return out;
}
function title_(p) {
  var t = (p['Task name'] && p['Task name'].title) || [];
  return t.map(function (x) { return x.plain_text; }).join('');
}
function roleOf_(p) {
  var dev = (p['Developer'] && p['Developer'].people) || [];
  for (var i = 0; i < dev.length; i++) if (dev[i].id === ME) return 'Dev';
  var rev = (p['Reviewer'] && p['Reviewer'].people) || [];
  for (var j = 0; j < rev.length; j++) if (rev[j].id === ME) return 'Reviewer';
  return '';
}
function statusOf_(p) { var s = p[STATUS_FIELD] && p[STATUS_FIELD].status; return s ? s.name : ''; }
function pointOf_(p) { var x = p[POINT_FIELD]; return (x && typeof x.number === 'number') ? x.number : ''; }

// ---- Sheet helpers ----
function ss_() {
  var p = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return p ? SpreadsheetApp.openById(p) : SpreadsheetApp.getActiveSpreadsheet();
}
function ensureMonthSheet_(ss, month) {
  var sh = ss.getSheetByName(month);
  if (sh) return sh;
  var tpl = ss.getSheetByName(TEMPLATE);
  if (!tpl) throw new Error('Missing ' + TEMPLATE + ' sheet');
  sh = tpl.copyTo(ss).setName(month);
  sh.showSheet(); ss.setActiveSheet(sh); ss.moveActiveSheet(0);
  pinDashboardFirst_(ss); // Dashboard luôn ở vị trí đầu; tab tháng mới xếp ngay sau nó
  applyCachedStatusRules_(sh);
  return sh;
}
// Nếu tab Dashboard tồn tại, đưa nó về vị trí đầu tiên (index 0). Gọi SAU khi tab
// tháng mới đã được move lên đầu, để thứ tự cuối cùng là Dashboard, rồi tab tháng mới.
function pinDashboardFirst_(ss) {
  var dash = ss.getSheetByName(DASHBOARD);
  if (!dash) return;
  ss.setActiveSheet(dash);
  ss.moveActiveSheet(0);
}
function lastDataRow_(sh) {
  var col = sh.getRange('A2:A').getValues();
  for (var i = col.length - 1; i >= 0; i--) if (col[i][0] !== '' && col[i][0] !== null) return i + 2;
  return 1;
}
// pageId/title -> {sheet,row,month}. month = tab name (MM/YYYY), used to tell whether
// a matched row sits in an OLD month tab (anything != current month) and to annotate
// the Note column when a new task looks like a title-duplicate of an existing one.
function buildIndex_(ss) {
  var byPid = {}, byTitle = {};
  ss.getSheets().forEach(function (sh) {
    var name = sh.getName();
    if (!isMonthTab_(name)) return;
    var last = lastDataRow_(sh);
    if (last < 2) return;
    var v = sh.getRange(2, 1, last - 1, 7).getValues(); // A..G (Note col H is not indexed)
    for (var i = 0; i < v.length; i++) {
      var ref = { sheet: sh, row: i + 2, month: name };
      var pid = norm_(String(v[i][6]));
      var nt = normTitle_(v[i][0]);
      if (pid) byPid[pid] = ref;
      if (nt) byTitle[nt] = ref;
    }
  });
  return { byPid: byPid, byTitle: byTitle };
}

// ---- state (hidden _STATE sheet: A=pageId, B=lastStatus) ----
function getState_(ss) {
  var sh = ss.getSheetByName(STATE);
  if (!sh) {
    sh = ss.insertSheet(STATE); sh.hideSheet();
    sh.getRange(1, 1, 1, 2).setValues([['pageId', 'status']]);
    return { sheet: sh, map: {}, firstRun: true };
  }
  var last = sh.getLastRow(), map = {};
  if (last >= 2) {
    var v = sh.getRange(2, 1, last - 1, 2).getValues();
    for (var i = 0; i < v.length; i++) if (v[i][0]) map[norm_(String(v[i][0]))] = v[i][1];
  }
  return { sheet: sh, map: map, firstRun: (last < 2) };
}
function writeState_(sheet, map) {
  var rows = [];
  for (var k in map) rows.push([k, map[k]]);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, 2).setValues([['pageId', 'status']]);
  if (rows.length) sheet.getRange(2, 1, rows.length, 2).setValues(rows);
}

// ---- main ----
// opts.backfill = true: stamp EVERY counted task missing from the sheet, not only
// the ones we catch crossing live. Used by the "Backfill counted" menu item to
// rescue tasks that skipped Ready to Test (e.g. dev-only tasks dragged straight to
// review) or crossed between two 10-min polls. Dedup is by the sheet index, so a
// task already present in any month tab is updated, never re-stamped.
function syncNow(opts) {
  var backfill = !!(opts && opts.backfill);
  var ss = ss_();
  var st = getState_(ss), firstRun = st.firstRun, prev = st.map, newState = {};
  var idx = buildIndex_(ss);
  var month = activeMonth_(); // tháng đang tính — tháng lịch, hoặc tháng ghim từ menu
  var added = 0, updated = 0, baseline = 0, waiting = 0, suspect = 0, seenStatus = {};

  WATCH_SOURCES.forEach(function (ds) {
    notionQuery_(ds).forEach(function (pg) {
      var p = pg.properties, role = roleOf_(p);
      if (role !== 'Dev' && role !== 'Reviewer') return;
      var pid = norm_(pg.id), status = statusOf_(p), point = pointOf_(p),
          name = title_(p), nt = normTitle_(name), url = pg.url;
      newState[pid] = status;
      if (status) seenStatus[status] = true;

      // RULE 2 (exact): this Notion page id already lives in SOME month tab (current
      // OR an old, closed one) -> it is the same task. Update it in place, never add
      // again. RULE 1: updating an old-month row is allowed (status/point/role go
      // live); we just never create a NEW row there. Have is never touched; any Note
      // (H) flag stays until Garry clears it by hand after checking the suspected dup.
      var pidRef = idx.byPid[pid];
      if (pidRef) {
        var cur = pidRef.sheet.getRange(pidRef.row, 1, 1, 7).getValues()[0]; // A..G
        if (cur[0] !== name)   pidRef.sheet.getRange(pidRef.row, 1).setValue(name);
        if (cur[1] !== status) pidRef.sheet.getRange(pidRef.row, 2).setValue(status);
        if (cur[2] !== point)  pidRef.sheet.getRange(pidRef.row, 3).setValue(point);
        if (cur[3] !== role)   pidRef.sheet.getRange(pidRef.row, 4).setValue(role);
        // (id already present since this is a pid match; nothing to heal)
        updated++;
        return;
      }

      // No pid match anywhere -> this task (by id) has never been stamped.
      if (firstRun && !backfill) {
        // very first auto-run only records a baseline; manual backfill ignores this
        baseline++;
        return;
      }

      // RULE 3a (Reviewer & Dev alike): only eligible once status reached Ready to
      // Test or beyond. Normal sync also requires observing the CROSS (prev not yet
      // counted); backfill stamps any counted task missing here.
      if (isCounted_(status) && (backfill || !isCounted_(prev[pid]))) {
        // RULE 1: new rows go ONLY into the active month tab (calendar month, or
        // the pinned previous month while KPI close lags) — never any other tab.
        var msh = ensureMonthSheet_(ss, month);
        var r = lastDataRow_(msh) + 1;
        msh.getRange(r, 1, 1, 7).setValues([[
          name, status, point, role, false,
          '=HYPERLINK("' + url + '","Notion ↗")', pid,
        ]]);
        // RULE 2 (fuzzy): a row with the SAME title but a DIFFERENT id already exists
        // somewhere (e.g. tracked under an old board id). Per Garry: still add, but
        // flag it in the Note column so he can verify and delete manually if it's a
        // true duplicate. Only flag matches in a DIFFERENT row than the one we just
        // wrote (titleRef was built before this add, so it can't point here).
        var titleRef = idx.byTitle[nt];
        if (titleRef && norm_(String(
              titleRef.sheet.getRange(titleRef.row, 7).getValue())) !== pid) {
          msh.getRange(r, NOTE_COL).setValue(
            '⚠ Nghi trùng "' + name + '" ở tab ' + titleRef.month + ' — check & xoá nếu trùng');
          suspect++;
        }
        idx.byPid[pid] = { sheet: msh, row: r, month: month };
        idx.byTitle[nt] = { sheet: msh, row: r, month: month };
        added++;
        return;
      }

      waiting++; // not counted yet, not in sheet
    });
  });
  writeState_(st.sheet, newState);
  // Tô màu là việc trang trí — hỏng thì kệ, không được kéo sập lượt sync point.
  try { syncStatusColors_(ss, Object.keys(seenStatus)); }
  catch (e) { Logger.log('Đồng bộ màu status lỗi (sync point vẫn xong): %s', e); }
  Logger.log('Sync done. added=%s updated=%s baseline=%s waiting=%s suspect=%s firstRun=%s month=%s',
             added, updated, baseline, waiting, suspect, firstRun, month);
  return { added: added, updated: updated, baseline: baseline, waiting: waiting, suspect: suspect, firstRun: firstRun, month: month };
}

// Manual catch-up: stamp every counted task that's missing from the sheet, even if
// we never observed it cross live (dev-only tasks dragged straight to review, or a
// task that jumped between two polls). Safe to run repeatedly — dedup by sheet index.
function backfillCounted() {
  var r = syncNow({ backfill: true });
  try {
    SpreadsheetApp.getUi().alert(
      'Backfill xong.\n\n' +
      'Kéo về (mới):  ' + r.added + '\n' +
      'Cập nhật:      ' + r.updated + '\n' +
      'Nghi trùng:    ' + r.suspect + '\n' +
      'Chưa tới mốc:  ' + r.waiting + '\n\n' +
      (r.added ? 'Lưu ý: task kéo về được gán vào tháng đang tính (' + r.month +
                 '). Nếu thực tế nó đạt mốc ở tháng khác, kéo dòng sang tab đúng.' +
                 (r.suspect ? '\n\n⚠ Có ' + r.suspect + ' task nghi trùng — xem cột Note (H), ' +
                              'check rồi xoá tay nếu đúng là trùng.' : '')
               : 'Không có task nào thiếu.'));
  } catch (e) { /* no UI when run from editor; log only */ }
  return r;
}

// ---- month pin (menu) ----
// KPI chốt sổ trễ vài ngày đầu tháng: bấm ghim để task MỚI tiếp tục vào tab tháng
// trước; chốt sổ xong thì gỡ (mặc định = tháng lịch). Ghim chỉ đổi tab đích khi
// ADD — update dòng cũ / Have / Note giữ nguyên hành vi.
function pinPrevMonth() {
  var pm = prevMonth_();
  PropertiesService.getScriptProperties().setProperty(ACTIVE_MONTH_PROP, pm);
  toast_('Task mới sẽ tính cho tháng ' + pm + '. Chốt sổ xong nhớ bấm "✅ Chốt: sang tháng lịch".',
         '📌 Đã ghim tháng ' + pm);
}
function unpinMonth() {
  PropertiesService.getScriptProperties().deleteProperty(ACTIVE_MONTH_PROP);
  toast_('Task mới sẽ tính cho tháng lịch như bình thường.', '✅ Đã về tháng ' + curMonth_());
}
function toast_(msg, title) {
  try { ss_().toast(msg, title, 8); } catch (e) { Logger.log('%s — %s', title, msg); }
}
// Menu action: ghim tay Dashboard lên đầu, phòng khi thứ tự tab bị lệch ngoài lúc
// tạo tab tháng mới (vd Garry tự kéo thả tab khác).
function pinDashboardFirstMenu_() {
  var ss = ss_();
  if (!ss.getSheetByName(DASHBOARD)) {
    toast_('Không tìm thấy tab "' + DASHBOARD + '".', '⚠ Point Sync');
    return;
  }
  pinDashboardFirst_(ss);
  toast_('Tab "' + DASHBOARD + '" đã ở vị trí đầu tiên.', '📌 Point Sync');
}

// ---- tô màu status theo Notion (tự động, không nút) ----
// Bảng màu KHÔNG hardcode: đọc schema Status của các board trong WATCH_SOURCES rồi
// dựng conditional formatting cho cột Status. Tên status hai board vốn đã lệch nhau
// và còn đổi theo thời gian (xem COUNTED) — lấy sống từ Notion thì màu không bao giờ
// lệch, status mới thêm bên Notion tự có màu.
// Chạy cuối mỗi syncNow (kể cả trigger 10 phút) nên anh không phải bấm gì. Bảng màu
// được cache ở Script Property; chỉ gọi Notion khi cache thiếu / gặp status lạ / cache
// quá 24h, và chỉ ghi lại rule khi bảng màu THỰC SỰ đổi — xem syncStatusColors_.
var STATUS_COL = 2; // B
var STATUS_CACHE_PROP = 'STATUS_COLOR_CACHE';
var STATUS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// 10 tên màu Notion cho phép -> đúng chip màu light-mode của Notion (nền + chữ).
var NOTION_CHIP = {
  'default': { bg: '#E3E2E0', fg: '#37352F' },
  'gray':    { bg: '#E3E2E0', fg: '#787774' },
  'brown':   { bg: '#EEE0DA', fg: '#9F6B53' },
  'orange':  { bg: '#FADEC9', fg: '#D9730D' },
  'yellow':  { bg: '#FDECC8', fg: '#CB912F' },
  'green':   { bg: '#DBEDDB', fg: '#448361' },
  'blue':    { bg: '#D3E5EF', fg: '#337EA9' },
  'purple':  { bg: '#E8DEEE', fg: '#9065B0' },
  'pink':    { bg: '#F5E0E9', fg: '#C14C8A' },
  'red':     { bg: '#FFE2DD', fg: '#D44C47' },
};

function now_() { return Date.now(); }

// null = ĐỌC LỖI (khác hẳn [] = board không có option nào). Phân biệt hai ca này là
// bắt buộc: gộp map khi một board lỗi sẽ thiếu status của board đó, dựng rule theo
// map thiếu là xoá sạch màu của board kia — xem statusColors_.
function notionStatusOptions_(dataSourceId) {
  var url = 'https://api.notion.com/v1/data_sources/' + dataSourceId;
  var headers = { 'Authorization': 'Bearer ' + token_(), 'Notion-Version': NOTION_VERSION };
  var resp = UrlFetchApp.fetch(url, { method: 'get', headers: headers, muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) {
    Logger.log('schema %s HTTP %s: %s', dataSourceId, resp.getResponseCode(), resp.getContentText().slice(0, 200));
    return null;
  }
  var prop = (JSON.parse(resp.getContentText()).properties || {})[STATUS_FIELD];
  return (prop && prop.status && prop.status.options) || [];
}
// Gộp status của mọi board thành một bảng tên -> tên màu Notion. Hai board đặt cùng
// tên status mà khác màu thì board đầu thắng (chỉ log, không hỏi).
// failed = có board đọc lỗi -> map đang THIẾU, mọi caller phải bỏ qua lượt này chứ
// không được dựng rule (sẽ xoá màu của board đọc được và báo nhầm là Notion đã xoá).
function statusColors_() {
  var map = {}, failed = false;
  WATCH_SOURCES.forEach(function (ds) {
    var options = notionStatusOptions_(ds);
    if (options === null) { failed = true; return; }
    options.forEach(function (o) {
      var name = o && o.name;
      if (!name) return;
      var c = o.color || 'default';
      if (map.hasOwnProperty(name)) {
        if (map[name] !== c) Logger.log('Status "%s" khác màu giữa 2 board (%s) — giữ màu board đầu (%s).', name, c, map[name]);
        return;
      }
      map[name] = c;
    });
  });
  return { map: map, failed: failed };
}

function readStatusCache_() {
  var raw = PropertiesService.getScriptProperties().getProperty(STATUS_CACHE_PROP);
  if (!raw) return null;
  try {
    var c = JSON.parse(raw);
    return (c && c.map && typeof c.ts === 'number') ? c : null;
  } catch (e) { return null; }
}
function writeStatusCache_(map, ts) {
  PropertiesService.getScriptProperties().setProperty(STATUS_CACHE_PROP, JSON.stringify({ map: map, ts: ts }));
}
function sameMap_(a, b) {
  var ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (var i = 0; i < ka.length; i++) if (a[ka[i]] !== b[ka[i]]) return false;
  return true;
}
// Trigger chạy 10 phút/lần — gọi Notion mỗi lần là đốt quota vô ích. Chỉ đọc lại
// schema khi: chưa có cache, gặp status chưa có trong cache (Notion vừa thêm), hoặc
// cache quá 24h (bắt ca đổi MÀU bên Notion mà tên status không đổi).
function needStatusRefresh_(cache, seenStatuses) {
  if (!cache) return true;
  if (now_() - cache.ts > STATUS_CACHE_TTL_MS) return true;
  for (var i = 0; i < seenStatuses.length; i++)
    if (!cache.map.hasOwnProperty(seenStatuses[i])) return true;
  return false;
}

// CỘNG THÊM, không thay thế: màu anh đã set thì giữ nguyên y hệt, chỉ status nào
// CHƯA có màu mới lấy màu từ Notion. Rule của anh được giữ nguyên thứ tự và đặt lên
// ĐẦU danh sách — Sheets xét rule từ trên xuống, rule khớp đầu tiên thắng, nên đứng
// trước chính là thứ bảo đảm màu của anh không bao giờ bị màu Notion đè.
// Sai số của việc đoán "rule này của ai" luôn rơi về phía vô hại: đoán nhầm rule của
// anh thành rule của code thì nó bị dựng lại y nguyên màu cũ; không nhận ra rule của
// anh phủ status nào (rule dùng công thức / TEXT_CONTAINS) thì cùng lắm thêm một rule
// thừa đứng SAU nó — thừa một dòng trong danh sách, màu hiển thị không đổi.
// Range mới luôn là B2:B không chặn đuôi. Rule cũ của anh bị chặn đuôi (vd B2:B100)
// được nới ra hết cột — không đổi màu, chỉ để dòng thêm sau này có màu của chính anh.
function applyStatusRules_(sh, colorByStatus) {
  var old = sh.getConditionalFormatRules();
  var full = sh.getRange('B2:B'), maxRow = sh.getMaxRows();
  var theirs = [], covered = {}, extended = 0;
  for (var i = 0; i < old.length; i++) {
    var rule = old[i];
    if (isOwnStatusRule_(rule)) continue;
    var name = statusRuleValue_(rule);
    if (name !== null) {
      covered[name] = true;
      if (!reachesLastRow_(rule, maxRow)) {
        rule = rule.copy().setRanges([full]).build();
        extended++;
        Logger.log('Nới range rule màu sẵn có của status "%s" (tab %s) ra hết cột Status.', name, sh.getName());
      }
    }
    theirs.push(rule);
  }
  var out = theirs.slice(), names = Object.keys(colorByStatus), appended = 0;
  for (var j = 0; j < names.length; j++) {
    if (covered[names[j]]) continue;
    var chip = NOTION_CHIP[colorByStatus[names[j]]] || NOTION_CHIP['default'];
    out.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(names[j])
      .setBackground(chip.bg)
      .setFontColor(chip.fg)
      .setBold(true)
      .setRanges([full])
      .build());
    appended++;
  }
  sh.setConditionalFormatRules(out);
  return { kept: theirs.length, extended: extended, appended: appended };
}
function applyToTabs_(tabs, colorByStatus) {
  var tot = { kept: 0, extended: 0, appended: 0 };
  tabs.forEach(function (sh) {
    var s = applyStatusRules_(sh, colorByStatus);
    tot.kept += s.kept; tot.extended += s.extended; tot.appended += s.appended;
  });
  Logger.log('Màu status: giữ nguyên %s rule sẵn có, nới range %s rule, thêm mới %s rule (trên %s tab).',
             tot.kept, tot.extended, tot.appended, tabs.length);
  return tot;
}
function isStatusColRule_(rule) {
  var rs = rule.getRanges();
  if (!rs.length) return false;
  for (var i = 0; i < rs.length; i++)
    if (rs[i].getColumn() !== STATUS_COL || rs[i].getNumColumns() !== 1) return false;
  return true;
}
function textEqRuleCondition_(rule) {
  if (!isStatusColRule_(rule)) return null;
  var bc = rule.getBooleanCondition();
  if (!bc || bc.getCriteriaType() !== SpreadsheetApp.BooleanCriteria.TEXT_EQUAL_TO) return null;
  return bc;
}
// Status mà rule này phủ, hoặc null nếu không đọc ra được (rule công thức, TEXT_CONTAINS…).
function statusRuleValue_(rule) {
  var bc = textEqRuleCondition_(rule);
  if (!bc) return null;
  var vals = bc.getCriteriaValues() || [];
  return vals.length ? String(vals[0]) : null;
}
// Rule do CHÍNH code này tạo: đúng cột Status, khớp text tuyệt đối, và cặp nền/chữ
// trùng khít một dòng trong NOTION_CHIP. Chỉ những rule này mới được dựng lại.
// Cố tình KHÔNG xét bold: rule sinh trước khi có bold vẫn phải nhận ra là của code
// thì lần chạy sau mới dựng lại được thành bold.
function isOwnStatusRule_(rule) {
  var bc = textEqRuleCondition_(rule);
  if (!bc) return false;
  var bg = hexOf_(bc.getBackgroundObject()), fg = hexOf_(bc.getFontColorObject());
  if (!bg || !fg) return false;
  for (var k in NOTION_CHIP)
    if (normHex_(NOTION_CHIP[k].bg) === bg && normHex_(NOTION_CHIP[k].fg) === fg) return true;
  return false;
}
function hexOf_(colorObj) {
  if (!colorObj) return '';
  try { return normHex_(colorObj.asRgbColor().asHexString()); } catch (e) { return ''; }
}
// asHexString() trả #rrggbb hoặc #aarrggbb — bỏ alpha và hạ chữ thường để so được.
function normHex_(h) {
  var s = String(h || '').toLowerCase().replace('#', '');
  return s.length === 8 ? s.slice(2) : s;
}
function reachesLastRow_(rule, maxRow) {
  var rs = rule.getRanges();
  for (var i = 0; i < rs.length; i++)
    if (rs[i].getRow() + rs[i].getNumRows() - 1 >= maxRow) return true;
  return false;
}
// Status đã được rule sẵn có của anh phủ trên tab này (dùng cho báo cáo "còn thiếu màu").
function coveredStatuses_(sh) {
  var out = {}, rules = sh.getConditionalFormatRules();
  for (var i = 0; i < rules.length; i++) {
    var name = statusRuleValue_(rules[i]);
    if (name !== null) out[name] = true;
  }
  return out;
}
function colorTargets_(ss) {
  var out = [];
  ss.getSheets().forEach(function (sh) {
    var n = sh.getName();
    if (isMonthTab_(n) || n === TEMPLATE) out.push(sh);
  });
  return out;
}
// Tab tháng mới clone từ _TEMPLATE nên bình thường đã thừa hưởng conditional
// formatting. Guard cho ca _TEMPLATE chưa kịp có rule (thứ tự lần chạy đầu): có cache
// màu thì tô ngay, khỏi đợi tới lần bảng màu đổi tiếp theo.
function applyCachedStatusRules_(sh) {
  var cache = readStatusCache_();
  if (cache) applyStatusRules_(sh, cache.map);
}

// Quét status thực tế trong các tab tháng và chỉ đích danh cái nào sẽ VẪN không màu:
// vừa không có rule sẵn của anh trên chính tab đó, vừa không có trong bảng màu Notion.
function orphanStatuses_(ss, map) {
  var listed = {}, out = [];
  ss.getSheets().forEach(function (sh) {
    if (!isMonthTab_(sh.getName())) return;
    var last = lastDataRow_(sh);
    if (last < 2) return;
    var covered = coveredStatuses_(sh);
    var v = sh.getRange(2, STATUS_COL, last - 1, 1).getValues();
    for (var i = 0; i < v.length; i++) {
      var s = String(v[i][0] === null || v[i][0] === undefined ? '' : v[i][0]).trim();
      if (!s || listed[s] || covered[s] || map.hasOwnProperty(s)) continue;
      listed[s] = true; out.push(s);
    }
  });
  return out;
}

// Đồng bộ màu TỰ ĐỘNG, gọi ở cuối syncNow. seenStatuses = status quan sát được từ
// Notion trong chính lượt sync này (khỏi quét lại sheet). Không đổi bảng màu thì
// không đụng vào sheet lấy một lần — ghi lại rule y hệt mỗi 10 phút là đốt quota.
function syncStatusColors_(ss, seenStatuses) {
  var cache = readStatusCache_();
  if (!needStatusRefresh_(cache, seenStatuses)) return { refreshed: false, applied: 0 };
  var sc = statusColors_();
  if (sc.failed || !Object.keys(sc.map).length) {
    Logger.log('Bỏ qua đồng bộ màu status: đọc schema Notion không đủ — giữ nguyên rule đang có.');
    return { refreshed: false, applied: 0 };
  }
  var changed = !cache || !sameMap_(cache.map, sc.map);
  writeStatusCache_(sc.map, now_());
  var orphans = orphanStatuses_(ss, sc.map);
  if (orphans.length)
    Logger.log('⚠ Status có trong sheet nhưng Notion không còn (mấy dòng này vẫn không màu): %s', orphans.join(' | '));
  if (!changed) return { refreshed: true, applied: 0, orphans: orphans };
  var tabs = colorTargets_(ss);
  applyToTabs_(tabs, sc.map);
  return { refreshed: true, applied: tabs.length, orphans: orphans };
}

// Chạy TAY từ Apps Script editor khi cần soi hoặc ép bù màu — cố tình KHÔNG gắn menu:
// màu đã tự đúng sau mỗi lần sync. Bỏ qua cache, đọc lại schema, bù màu cho mọi tab
// tháng VÀ _TEMPLATE (tab tháng mới clone từ nó nên thừa hưởng luôn), rồi báo cáo đích
// danh status vẫn không màu (không có rule sẵn của anh, cũng không có bên Notion).
function colorStatusesFromNotion() {
  var ss = ss_();
  var sc = statusColors_();
  if (sc.failed || !Object.keys(sc.map).length) {
    alert_('Không đọc được đủ danh sách status từ Notion (xem Execution log).\n\nChưa đổi màu gì cả.');
    return { colored: 0, tabs: 0, orphans: [], kept: 0, extended: 0, appended: 0 };
  }
  var tabs = colorTargets_(ss);
  var tot = applyToTabs_(tabs, sc.map);
  writeStatusCache_(sc.map, now_());

  var colored = Object.keys(sc.map).length;
  var orphans = orphanStatuses_(ss, sc.map);
  alert_(
    'Bù màu status xong.\n\n' +
    'Status lấy từ Notion:   ' + colored + '\n' +
    'Tab xử lý:              ' + tabs.length + ' (gồm cả ' + TEMPLATE + ' → tab tháng mới tự có màu)\n' +
    'Màu cũ giữ nguyên:      ' + tot.kept + ' rule\n' +
    'Rule cũ nới hết cột:    ' + tot.extended + '\n' +
    'Rule màu mới thêm:      ' + tot.appended + '\n\n' +
    (orphans.length
      ? '⚠ ' + orphans.length + ' status trong sheet vẫn không màu (Notion không còn, đổi tên / xoá):\n   • ' +
        orphans.join('\n   • ') + '\n\nSửa tên cho khớp Notion là xong.'
      : 'Mọi status đang có trong sheet đều đã có màu.'));
  Logger.log('Color done. statuses=%s tabs=%s orphans=%s', colored, tabs.length, orphans.join(' | '));
  return { colored: colored, tabs: tabs.length, orphans: orphans,
           kept: tot.kept, extended: tot.extended, appended: tot.appended };
}
function alert_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}

// ---- triggers / menu ----
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncNow') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncNow').timeBased().everyMinutes(10).create();
  Logger.log('Trigger installed: syncNow every 10 minutes');
}
function onOpen() {
  var cur = curMonth_(), am = activeMonth_();
  SpreadsheetApp.getUi().createMenu('🔄 Point Sync — tháng ' + am)
    .addItem('Sync now', 'syncNow')
    .addItem('Kéo task counted còn thiếu (quét bù)', 'backfillCounted')
    .addSeparator()
    .addItem('⏪ Vẫn tính cho tháng trước (' + prevMonth_() + ')', 'pinPrevMonth')
    .addItem('✅ Chốt: sang tháng lịch (' + cur + ')', 'unpinMonth')
    .addSeparator()
    .addItem('📌 Ghim Dashboard lên đầu', 'pinDashboardFirstMenu_')
    .addItem('Install 10-min auto-sync', 'installTrigger')
    .addToUi();
  // Nhắc passive khi đang ghim — mở sheet là thấy mình đang tính cho tháng nào.
  if (am !== cur) {
    toast_('Đang ghim: task mới tính cho tháng ' + am + ', không phải tháng lịch ' + cur +
           '. Chốt sổ xong bấm "✅ Chốt: sang tháng lịch".', '📌 Point Sync');
  }
}
