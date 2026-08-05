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
 * ACTIVE_MONTH). "✅ Chốt: sang tháng lịch" gỡ ghim VÀ chốt sổ tháng trước. Ghim cũ hơn
 * tháng liền trước là stale — tự bỏ qua, dùng tháng lịch (quên gỡ ghim chỉ lệch tối đa
 * 1 tháng).
 *
 * CHỐT SỔ: Script Property CLOSED_THROUGH giữ MỘT tháng "MM/YYYY" — mọi tab tháng ≤ nó
 * đã chốt và không nhận dòng MỚI nữa (update thì vẫn chạy). Vắng mặt = chưa chốt tháng
 * nào. Nút "✅ Chốt" nâng mốc này lên, chỉ nâng chứ không bao giờ hạ.
 *
 * XOÁ TAY = Ý ĐỊNH (ca thật 2026-08-06): task anh đã xoá khỏi sheet không bao giờ được
 * script hồi sinh. Dòng chỉ còn id ở cột G ẩn = BIA MỘ — vẫn ghim pid (chống add lại)
 * nhưng update bỏ qua hẳn. _STATE có cột 'stamped' nhớ pid đã-từng-có-dòng để quét bù
 * không kéo về. Và dòng tay (trống G) không bao giờ bị script tự dọn — luật 8 chỉ ghi note.
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
// Dấu nhận diện note do CHÍNH script ghi. Một ký tự ở đầu ô, không phải câu chữ — nhận
// diện bằng cách so tiền tố tiếng Việt thì đổi lời văn một lần là note cũ hết nhận ra
// được, và note anh gõ lỡ trùng chữ sẽ bị coi nhầm là của script. Có dấu này thì toàn bộ
// icon còn lại thuộc về anh: 📝, ℹ️, ✅... gõ thoải mái, script không bao giờ nhận vơ.
var SCRIPT_NOTE_MARK = '\uD83E\uDD16'; // 🤖
// Vùng "dòng đã dùng" của một tab tháng = A..H (7 cột data + Note ở NOTE_COL). KPI /
// summary sống từ cột I trở đi và có thể kéo dài xuống DƯỚI vùng task, nên tính cả I+
// vào sẽ đẩy dòng add ra giữa khoảng trắng. Quét mỗi cột A cũng sai: dòng anh sửa tay
// có thể trống tên mà B..H còn nguyên, add sau đó ghi đè lên chính dòng đó (mất data —
// đúng ca 2026-08). Xem lastDataRow_ / nextFreeRow_.
// Note là cột ngoài cùng của vùng dữ liệu, nên bám theo NOTE_COL — dời Note mà để lại
// số 8 ở đây thì vùng quét lặng lẽ bỏ sót đúng cột vừa dời.
var FOOTPRINT_COLS = NOTE_COL; // A..H
// Tab kín lưới thì phải nới ra mới ghi được dòng mới; nới dư một ít để khỏi phải nới
// lại ở mỗi lần add tiếp theo.
var GRID_GROW_ROWS = 50;
var TITLE_COL = 1; // A
var HAVE_COL = 5;  // E
var CARD_COL = 6;  // F
// Kiểu chữ cột Note: nhỏ hơn, nghiêng, xám — ghi chú phải lùi ra sau dữ liệu.
var NOTE_FONT_SIZE = 9;
var NOTE_MIN_WIDTH = 200, NOTE_WIDTH = 280;
// Tên task dài bị cắt cụt ở cột A. Wrap là format của Ô chứ không phải của dữ liệu, nên
// đặt một lần cho cả cột là xong — dòng thêm về sau tự thừa hưởng. Số phiên bản để lượt
// sync sau khỏi đặt lại y hệt mỗi 10 phút; đổi cột / đổi chiến lược thì bump nó lên.
var ROW_FMT = 4;
var ROW_FMT_PROP = 'ROW_FORMAT_VERSION';
// Script Property ACTIVE_MONTH ("MM/YYYY"): ghim tháng đích cho dòng MỚI khi KPI
// chốt sổ trễ (đầu tháng 7 vẫn tính cho tháng 6). Set/gỡ bằng menu, không sửa tay.
// Vắng mặt = tháng lịch (mặc định an toàn). Luật stale: xem activeMonth_().
var ACTIVE_MONTH_PROP = 'ACTIVE_MONTH';
// Script Property CLOSED_THROUGH ("MM/YYYY"): mốc chốt sổ — mọi tab tháng ≤ mốc này
// không nhận dòng MỚI nữa. Vắng mặt = CHƯA chốt tháng nào (cùng nguyên tắc với
// ACTIVE_MONTH: không bao giờ lưu trạng thái bình thường thành một giá trị).
var CLOSED_THROUGH_PROP = 'CLOSED_THROUGH';
// -----------------------------------------------------

function token_() {
  var t = PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN');
  if (!t) throw new Error('Missing Script Property NOTION_TOKEN');
  return t;
}
function norm_(id) { return (id || '').replace(/-/g, ''); }
// Quy ký tự "đánh máy đẹp" về dạng thẳng TRƯỚC khi so tên. Notion đẻ ra nháy cong \u201C \u201D \u2018 \u2019
// và gạch dài \u2013 \u2014 ở đúng chỗ người gõ tay trong Sheets ra nháy thẳng " ' và gạch -. Hai
// chuỗi nhìn y hệt nhau mà không quy về một mối thì vẫn không khớp, task coi như chưa có
// ở tháng cũ và bị add lại sang tháng mới. Dùng escape \uXXXX vì file này bị copy-paste qua
// lại — ký tự sống rất dễ bị editor bóp méo. Space cứng thì \s của JS đã bắt sẵn.
function normTitle_(s) {
  return String(s || '')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}
function isMonthTab_(name) { return /^\d{2}\/\d{4}$/.test(name); }
// "Vốn định là tab tháng nhưng gõ sai tên" — 7/2026, 06-2026, 06/2026 (chốt)… Chỉ dùng
// cho chẩn đoán, để tách tab gõ sai ra khỏi tab thường (Ghi chú, Sheet1…).
function looksLikeMonthTab_(name) { return /\d{1,2}\s*[\/\-.]\s*\d{2,4}/.test(name); }
// So KHÔNG phân biệt hoa thường: hai board tự đổi tên status theo thời gian và chỉ cần
// lệch đúng một chữ cái ("Waiting to Launch" vs "Waiting to launch") là task đi thẳng
// vào status đó không bao giờ được tính — hỏng im lặng, không ai thấy cho tới lúc soát KPI.
function isCounted_(status) {
  var s = String(status || '').trim().toLowerCase();
  for (var i = 0; i < COUNTED.length; i++) if (COUNTED[i].toLowerCase() === s) return true;
  return false;
}
function curMonth_() {
  var tz = Session.getScriptTimeZone() || 'Asia/Ho_Chi_Minh';
  return Utilities.formatDate(new Date(), tz, 'MM/yyyy');
}
function prevOf_(month) { // 'MM/yyyy' — string math, tránh mọi pitfall timezone
  var m = parseInt(month.slice(0, 2), 10), y = parseInt(month.slice(3), 10);
  m--; if (m < 1) { m = 12; y--; }
  return (m < 10 ? '0' + m : String(m)) + '/' + y;
}
function prevMonth_() { return prevOf_(curMonth_()); }
// Số thứ tự tháng để SO SÁNH. Không so chuỗi ('12/2025' > '01/2026' là sai) và không
// đi qua Date (timezone) — cùng lý do prevOf_ làm string math.
function monthOrd_(month) {
  if (!isMonthTab_(month)) return null;
  return parseInt(month.slice(3), 10) * 12 + parseInt(month.slice(0, 2), 10);
}
function closedThrough_() {
  var v = PropertiesService.getScriptProperties().getProperty(CLOSED_THROUGH_PROP);
  return (v && isMonthTab_(v)) ? v : null; // vắng mặt / rác = chưa chốt tháng nào
}
function isClosedMonth_(month) {
  var w = closedThrough_();
  if (!w) return false;
  var a = monthOrd_(month), b = monthOrd_(w);
  return a !== null && b !== null && a <= b;
}
// Mốc chốt sổ chỉ được NÂNG. Bấm "✅ Chốt" lần nữa khi mốc đã cao hơn (vd bấm muộn,
// hoặc bấm 2 lần cách nhau 1 tháng) không được mở lại tháng đã chốt.
function raiseClosedThrough_(month) {
  var cur = closedThrough_();
  if (cur && monthOrd_(cur) >= monthOrd_(month)) return cur;
  PropertiesService.getScriptProperties().setProperty(CLOSED_THROUGH_PROP, month);
  return month;
}
// Tháng mà dòng MỚI được ghi vào. Bình thường = tháng lịch; khi KPI chốt sổ trễ,
// menu ghim tháng liền trước qua ACTIVE_MONTH. Ghim chỉ được honor khi nó là tháng
// lịch hiện tại hoặc tháng liền trước — cũ hơn nghĩa là quên gỡ ghim: bỏ qua và
// quay về tháng lịch, để thiệt hại của việc quên tối đa là 1 tháng.
// Ghim trỏ vào tháng ĐÃ CHỐT cũng bị bỏ qua: đây chính là ca "đã sang tháng 8 mà
// task mới vẫn rơi vào tab tháng 7" — bấm "✅ Chốt" là hết, không phải nhớ gỡ ghim.
function activeMonth_() {
  var pin = PropertiesService.getScriptProperties().getProperty(ACTIVE_MONTH_PROP);
  if (!pin) return curMonth_();
  if (isMonthTab_(pin) && (pin === curMonth_() || pin === prevMonth_())) {
    if (!isClosedMonth_(pin)) return pin;
    Logger.log('ACTIVE_MONTH "%s" trỏ vào tháng đã chốt sổ (chốt tới hết %s) — dùng tháng lịch %s.',
               pin, closedThrough_(), curMonth_());
    return curMonth_();
  }
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
  applyRowFormat_(sh); // không phụ thuộc việc copyTo có mang theo format ô hay không
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
function footprintValues_(sh) {
  var rows = sh.getMaxRows() - 1, cols = Math.min(FOOTPRINT_COLS, sh.getMaxColumns());
  if (rows < 1 || cols < 1) return [];
  return sh.getRange(2, 1, rows, cols).getValues();
}
// false bị coi là TRỐNG: ô checkbox chưa tick trả về boolean false chứ không phải ''.
// Cột Have (E) thường được kẻ sẵn checkbox xuống cả trăm dòng, nhận nhầm nó là "có
// data" sẽ đẩy dòng add xuống tận cuối vùng checkbox. Dòng task thật luôn có ít nhất
// tên / status / page id, nên không có ca nào mất vì luật này.
function rowHasContent_(row) {
  for (var i = 0; i < row.length; i++) {
    var v = row[i];
    if (v !== '' && v !== null && v !== undefined && v !== false) return true;
  }
  return false;
}
// BIA MỘ (ca thật 2026-08-06): dòng anh xoá tay nhưng cột G ẩn còn sót id — trống hết
// A..F và H, chỉ còn G. Đó là dấu "anh đã xoá task này", không phải dòng hỏng cần vá.
// H có chữ thì KHÔNG phải bia mộ: note còn đó nghĩa là dòng còn mang thông tin, đường
// update cứ chạy như thường. false của checkbox tính là trống — cùng luật rowHasContent_.
// row = mảng A..H (8 ô, index 6 = G).
function isTombstoneRow_(row) {
  if (!norm_(String(row[6] || ''))) return false;
  for (var i = 0; i < row.length; i++) {
    if (i === 6) continue;
    var v = row[i];
    if (v !== '' && v !== null && v !== undefined && v !== false) return false;
  }
  return true;
}
// Dòng cuối còn nội dung, quét A..H chứ không riêng cột A — xem FOOTPRINT_COLS.
// Vùng này cũng là vùng buildIndex_ / orphanStatuses_ quét: dòng anh xoá tên nhưng
// còn page id ở G phải được index, nếu không task đó bị coi là mất và bị add lại mãi.
function lastDataRow_(sh) {
  var v = footprintValues_(sh);
  for (var i = v.length - 1; i >= 0; i--) if (rowHasContent_(v[i])) return i + 2;
  return 1;
}
// Dòng được phép ghi dòng MỚI: dòng TRỐNG ĐẦU TIÊN (trống hoàn toàn A..H), tính từ dòng 2.
// Bảo đảm cốt lõi vẫn y nguyên — add KHÔNG BAO GIỜ setValues đè lên một dòng còn nội dung.
// Trước đây hàm này nhảy xuống sau DÒNG CUỐI còn nội dung, nên mọi lỗ phía trên (do luật 8
// dọn bản sao để lại) nằm trống vĩnh viễn còn dòng mới cứ rơi xuống đáy. Ghi vào một dòng
// trống hoàn toàn thì không đè mất gì cả, nên lấp lỗ là an toàn và sheet không bị rỗ.
function nextFreeRow_(sh) {
  var v = footprintValues_(sh), r = v.length + 2; // không còn chỗ trống -> dòng ngoài lưới
  for (var i = 0; i < v.length; i++) if (!rowHasContent_(v[i])) { r = i + 2; break; }
  // Tab dùng kín lưới: getRange() ở dòng ngoài lưới ném lỗi, và lỗi đó kéo sập CẢ lượt
  // sync chứ không riêng task này. Nới lưới rồi ghi tiếp — thêm dòng ở đáy không đụng
  // khối KPI nằm phía trên.
  var max = sh.getMaxRows();
  if (r > max) sh.insertRowsAfter(max, r - max + GRID_GROW_ROWS);
  return r;
}
// Công thức ô Card. Một chỗ duy nhất dựng nó, để đường add và đường vá không bao giờ
// sinh ra hai kiểu link khác nhau.
function cardFormula_(url) { return '=HYPERLINK("' + url + '","Notion \u2197")'; }
// pageId/title -> {sheet,row,month}. month = tab name (MM/YYYY), used to tell whether
// a matched row sits in an OLD month tab (anything != current month) and to annotate
// the Note column when a new task looks like a title-duplicate of an existing one.
// olderByTitle chỉ gom dòng ở tab tháng CŨ HƠN tháng đang tính mà TRỐNG page id —
// ứng viên duy nhất được phép khớp theo tên (rule 6, xem syncNow).
function buildIndex_(ss, activeMonth) {
  var byPid = {}, byTitle = {}, olderByTitle = {}, titleRows = {};
  var activeOrd = monthOrd_(activeMonth);
  ss.getSheets().forEach(function (sh) {
    var name = sh.getName();
    if (!isMonthTab_(name)) return;
    var last = lastDataRow_(sh);
    if (last < 2) return;
    var ord = monthOrd_(name);
    var older = (activeOrd !== null && ord !== null && ord < activeOrd);
    // Đọc cả H (NOTE_COL) vì nhận diện bia mộ cần biết ô Note có chữ hay không;
    // title/pid vẫn chỉ lấy từ A và G như cũ, Note không được index.
    var v = sh.getRange(2, 1, last - 1, NOTE_COL).getValues(); // A..H
    for (var i = 0; i < v.length; i++) {
      var ref = { sheet: sh, row: i + 2, month: name };
      var pid = norm_(String(v[i][6]));
      var nt = normTitle_(v[i][0]);
      if (pid) {
        // Bia mộ vẫn PHẢI vào byPid — chính cái ghim đó giữ cho task không bị add
        // lại ở tab khác (cùng lý do dòng trống tên còn id phải được index).
        // Đường update thấy tomb thì bỏ qua hẳn — xem syncNow.
        ref.tomb = isTombstoneRow_(v[i]);
        byPid[pid] = ref;
      }
      if (!nt) continue;
      byTitle[nt] = ref;
      (titleRows[nt] = titleRows[nt] || []).push(ref);
      if (older && !pid && !olderByTitle[nt]) olderByTitle[nt] = ref;
    }
  });
  return { byPid: byPid, byTitle: byTitle, olderByTitle: olderByTitle, titleRows: titleRows };
}
// RULE 8 (2026-08): khớp bằng id chỉ trả lời "task này đang ở đâu", KHÔNG trả lời "nó
// có nằm ở chỗ khác nữa không". Một dòng trùng ở tab tháng khác mà lại giữ page id thì
// mọi lượt sync sau đều bám vào nó, dòng bên kia thành mồ côi vĩnh viễn và không ai
// thấy — đúng ca 2026-08-05: 4 task ở cả 07/2026 lẫn 08/2026, id nằm bên tháng 8 nên
// dòng tháng 7 không bao giờ được vá.
// Chỉ ĐÁNH DẤU, không tự xoá: script không có cách nào biết anh muốn giữ dòng nào.
// Ghi vào Note (H) và chỉ khi H đang trống — note anh tự gõ không bao giờ bị đè.
// Dọn một dòng task = XOÁ NỘI DUNG A..H, KHÔNG deleteRow. Khối KPI sống ở cột I+ TRÊN
// CÙNG những dòng đó ("Tổng số task", "Point Dev", "Tổng point" nằm ở I2:J5), nên
// deleteRow sẽ nuốt luôn công thức KPI. Dòng trống ở giữa là vô hại: nextFreeRow_ và
// buildIndex_ đều bỏ qua dòng trống. Xoá nội dung vẫn undo được bằng version history.
// Note do CHÍNH script ghi — nhận ra bằng tiền tố nó tự đặt. Dùng để biết ô Note nào
// dọn được, ô nào là chữ của anh và phải giữ.
// Tiền tố tiếng Việt đời cũ vẫn được nhận: note script ghi trước khi có SCRIPT_NOTE_MARK
// còn nằm sẵn trong sheet, bỏ chúng ra là chúng thành bất khả dọn vĩnh viễn.
var LEGACY_NOTE_PREFIXES = ['⚠ Nghi trùng', '⚠ Script tự gán', '⚠ Trùng với'];
function isScriptNote_(text) {
  var s = String(text || '').trim();
  if (s.indexOf(SCRIPT_NOTE_MARK) === 0) return true;
  for (var i = 0; i < LEGACY_NOTE_PREFIXES.length; i++)
    if (s.indexOf(LEGACY_NOTE_PREFIXES[i]) === 0) return true;
  return false;
}
function clearTaskRow_(ref) {
  ref.sheet.getRange(ref.row, 1, 1, 7).clearContent(); // A..G
  // Note (H) chỉ được dọn khi nó do script ghi. Chữ anh tự gõ thì giữ lại nguyên vẹn,
  // kể cả trên một dòng vừa bị dọn sạch — luật "Note không bao giờ bị đè" không có
  // ngoại lệ nào, và một ghi chú lạc trên dòng trống vẫn hơn là mất chữ của anh.
  var note = ref.sheet.getRange(ref.row, NOTE_COL);
  var v = note.getValue();
  if (!String(v || '').trim() || isScriptNote_(v)) note.clearContent();
  else Logger.log('Dọn %s dòng %s nhưng GIỮ lại note anh tự gõ: "%s"', ref.month, ref.row, v);
}
// Trùng RÕ RÀNG vs trùng MỜ, phân biệt bằng PAGE ID chứ không bằng độ giống của tên —
// normTitle_ vốn đã là so khít, không có bậc "nghe tương tự" nào cả (fuzzy match bị loại
// từ rule 5, cố ý).
//   · id bên kia TRỐNG hoặc TRÙNG KHÍT  -> cùng một task chiếm hai chỗ. Giữ dòng ở tab
//     tháng CŨ NHẤT (đúng tinh thần rule 7: task đã ở tháng cũ thì thuộc về tháng cũ),
//     dọn sạch các bản sao ở tháng mới hơn, và vá id vào dòng giữ lại.
//   · id bên kia KHÁC HẲN -> hai page Notion khác nhau vô tình trùng tên (ca thật:
//     "Fix translation ... Loyalty Hub" tồn tại 2 lần với 2 id). KHÔNG BAO GIỜ tự dọn,
//     chỉ ghi chú để anh tự quyết.
function resolveCrossTabTwins_(idx, nt, pid, ref) {
  var rows = idx.titleRows[nt] || [], same = [ref], fuzzy = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r.month === ref.month) continue; // cùng tab thì không thuộc luật này
    var rp = norm_(String(r.sheet.getRange(r.row, 7).getValue()));
    if (!rp || rp === pid) same.push(r); else fuzzy.push(r.month + ' dòng ' + r.row);
  }
  var keeper = same[0];
  for (var j = 1; j < same.length; j++)
    if (monthOrd_(same[j].month) < monthOrd_(keeper.month)) keeper = same[j];
  // Tháng đã chốt sổ VẪN được dọn bản sao (Garry, 2026-08-05 — đã cân nhắc rồi chốt).
  // Chốt sổ cấm đúng MỘT việc: thêm dòng mới. Update 4 cột, ghi note, dọn dòng trùng đều
  // được. Hệ quả có thật và đã chấp nhận: hai bản sao ở hai tháng đều đã chốt thì dòng ở
  // tháng mới hơn bị dọn, KPI hai tháng đó đổi theo. Mỗi lần dọn đều vào `dupCleared` và
  // log, nên không bao giờ im lặng. Đừng thêm lại guard "tháng chốt thì miễn dọn".
  var cleared = [], handKept = [];
  for (var k = 0; k < same.length; k++) {
    if (same[k] === keeper) continue;
    // LUẬT TAY (ca thật 2026-08-06): bản sao TRỐNG cột G là dòng anh gõ tay — dòng
    // script sinh ra luôn có id từ lúc chào đời, nên trống G là dấu người thật đặt nó
    // ở đó có ý (anh xoá task khỏi 07/2026 rồi gõ lại vào 08/2026, luật này từng dọn
    // mất dòng tay đó). Không bao giờ tự xoá dòng tay: chỉ ghi note khi H trống để
    // anh tự quyết. Bản sao CÓ id (chắc chắn do script ghi) vẫn dọn y như cũ — ca
    // sáng lập 2026-08-05 (bản gốc tay ở July, bản sao có id ở August) giữ nguyên kết cục.
    if (!norm_(String(same[k].sheet.getRange(same[k].row, 7).getValue()))) {
      var hcell = same[k].sheet.getRange(same[k].row, NOTE_COL);
      if (!String(hcell.getValue() || '').trim())
        hcell.setValue(SCRIPT_NOTE_MARK + ' Trùng với ' + keeper.month + ' dòng ' + keeper.row +
                       ' (cùng task Notion) — dòng tay nên script không tự xoá, check rồi xoá tay nếu trùng');
      handKept.push(same[k].month + ' dòng ' + same[k].row);
      continue;
    }
    clearTaskRow_(same[k]);
    cleared.push(same[k].month + ' dòng ' + same[k].row);
  }
  if (cleared.length && !norm_(String(keeper.sheet.getRange(keeper.row, 7).getValue())))
    keeper.sheet.getRange(keeper.row, 7).setValue(pid);
  if (fuzzy.length) {
    var cell = keeper.sheet.getRange(keeper.row, NOTE_COL);
    if (!String(cell.getValue() || '').trim())
      cell.setValue(SCRIPT_NOTE_MARK + ' Nghi trùng TÊN (page id khác): cũng có ở ' +
                    fuzzy.join(', ') + ' — check, xoá tay nếu đúng là trùng');
  }
  return { keeper: keeper, cleared: cleared, handKept: handKept, fuzzy: fuzzy };
}

// ---- state (hidden _STATE sheet: A=pageId, B=lastStatus, C=stamped) ----
// Cột C 'stamped' (2026-08-06): 1 = pid này đã TỪNG có dòng trong sheet (script add,
// khớp được id, hoặc được vá id theo rule 7). Pid có stamp mà giờ không còn dòng nào
// (kể cả bia mộ) trên MỌI tab = anh đã xoá tay → quét bù không được hồi sinh.
// MIGRATION format cũ (2 cột, thiếu header 'stamped'): pid có status counted coi như
// đã-từng-add. Sheet thật lúc nâng cấp đã đầy đủ, nên pid counted mà thiếu dòng chính
// là task anh vừa xoá — coi ngược lại (chưa từng add) là quét bù hồi sinh đúng cái anh
// xoá hôm 2026-08-06. Đánh đổi chấp nhận: task counted bị sync bắt hụt TRƯỚC lúc nâng
// cấp thì quét bù không cứu nữa, phải gõ tay.
// Stamp sống theo vòng đời state: task rời query Notion thì stamp rơi theo (state chỉ
// giữ task đang thấy, y như cột status xưa nay) — ca quay lại hiếm, rule 7 đỡ được.
function getState_(ss) {
  var sh = ss.getSheetByName(STATE);
  if (!sh) {
    sh = ss.insertSheet(STATE); sh.hideSheet();
    sh.getRange(1, 1, 1, 3).setValues([['pageId', 'status', 'stamped']]);
    return { sheet: sh, map: {}, stamped: {}, firstRun: true };
  }
  var last = sh.getLastRow(), map = {}, stamped = {};
  var legacy = String(sh.getRange(1, 3).getValue() || '') !== 'stamped';
  if (last >= 2) {
    var v = sh.getRange(2, 1, last - 1, 3).getValues();
    for (var i = 0; i < v.length; i++) {
      if (!v[i][0]) continue;
      var pid = norm_(String(v[i][0]));
      map[pid] = v[i][1];
      if (legacy ? isCounted_(v[i][1]) : v[i][2]) stamped[pid] = true;
    }
  }
  return { sheet: sh, map: map, stamped: stamped, firstRun: (last < 2) };
}
function writeState_(sheet, map, stamped) {
  var rows = [];
  for (var k in map) rows.push([k, map[k], stamped[k] ? 1 : '']);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, 3).setValues([['pageId', 'status', 'stamped']]);
  if (rows.length) sheet.getRange(2, 1, rows.length, 3).setValues(rows);
}

// ---- main ----
// opts.backfill = true: stamp EVERY counted task missing from the sheet, not only
// the ones we catch crossing live. Used by the "Backfill counted" menu item to
// rescue tasks that skipped Ready to Test (e.g. dev-only tasks dragged straight to
// review) or crossed between two 10-min polls. Dedup is by the sheet index, so a
// task already present in any month tab is updated, never re-stamped. A pid the
// script once placed in the sheet (stamped in _STATE) that is now missing from
// every tab was DELETED by the user — never re-added, counted as skippedDeleted.
function syncNow(opts) {
  var backfill = !!(opts && opts.backfill);
  var ss = ss_();
  var st = getState_(ss), firstRun = st.firstRun, prev = st.map, stamped = st.stamped,
      newState = {}, newStamped = {};
  var month = activeMonth_(); // tháng đang tính — tháng lịch, hoặc tháng ghim từ menu
  var monthClosed = isClosedMonth_(month);
  var idx = buildIndex_(ss, month);
  var added = 0, updated = 0, baseline = 0, waiting = 0, suspect = 0,
      blockedClosed = 0, blockedOld = 0, dupFlagged = 0, dupCleared = 0, dupHandKept = 0,
      healedLink = 0, tombstones = 0, skippedDeleted = 0, skippedDeletedNames = [], seenStatus = {};

  WATCH_SOURCES.forEach(function (ds) {
    notionQuery_(ds).forEach(function (pg) {
      var p = pg.properties, role = roleOf_(p);
      if (role !== 'Dev' && role !== 'Reviewer') return;
      var pid = norm_(pg.id), status = statusOf_(p), point = pointOf_(p),
          name = title_(p), nt = normTitle_(name), url = pg.url;
      newState[pid] = status;
      // Dấu đã-từng-add là vĩnh viễn trong vòng đời state: anh xoá dòng thì dấu vẫn
      // phải sống, không thì lượt sau quét bù lại hồi sinh đúng cái vừa xoá.
      if (stamped[pid]) newStamped[pid] = true;
      if (status) seenStatus[status] = true;

      // RULE 2 (exact): this Notion page id already lives in SOME month tab (current
      // OR an old, closed one) -> it is the same task. Update it in place, never add
      // again. RULE 1: updating an old-month row is allowed (status/point/role go
      // live); we just never create a NEW row there. Have is never touched; any Note
      // (H) flag stays until Garry clears it by hand after checking the suspected dup.
      var pidRef = idx.byPid[pid];
      if (pidRef) {
        newStamped[pid] = true; // pid đang có mặt trên sheet (dòng thật hoặc bia mộ)
        // BIA MỘ (ca thật 2026-08-06): anh xoá dòng nhưng cột G ẩn còn sót id. Trước
        // đây đường update "hồi sinh" nó — ghi lại tên/status/point/role rồi vá link —
        // mọi guard đều được tôn trọng mà kết quả vẫn ngược ý anh. Giờ nó chỉ nằm đó
        // ghim pid (chống add lại chỗ khác); update, heal link, vai keeper của luật 8
        // đều bỏ qua hết.
        if (pidRef.tomb) {
          tombstones++;
          Logger.log('Bia mộ "%s" ở %s dòng %s — anh đã xoá tay, không hồi sinh.',
                     name, pidRef.month, pidRef.row);
          return;
        }
        // RULE 8 chạy TRƯỚC khi update: nó có thể dọn chính dòng vừa khớp id (bản sao ở
        // tháng mới hơn) và trả về dòng được giữ. Update sau, để giá trị rơi đúng chỗ
        // thay vì ghi vào một dòng sắp bị xoá.
        var dup = resolveCrossTabTwins_(idx, nt, pid, pidRef);
        if (dup.cleared.length) {
          dupCleared += dup.cleared.length;
          idx.byPid[pid] = dup.keeper;
          Logger.log('Dọn bản sao "%s" ở %s — giữ dòng tháng cũ nhất %s dòng %s.',
                     name, dup.cleared.join(', '), dup.keeper.month, dup.keeper.row);
        }
        if (dup.handKept.length) {
          dupHandKept += dup.handKept.length;
          Logger.log('Bản sao "%s" ở %s là dòng tay (trống id) — không tự dọn, đã ghi Note.',
                     name, dup.handKept.join(', '));
        }
        if (dup.fuzzy.length) {
          dupFlagged++;
          Logger.log('⚠ "%s" trùng TÊN nhưng khác page id với %s — không tự dọn, đã ghi Note.',
                     name, dup.fuzzy.join(', '));
        }
        var keep = dup.keeper;
        var cur = keep.sheet.getRange(keep.row, 1, 1, 7).getValues()[0]; // A..G
        if (cur[0] !== name)   keep.sheet.getRange(keep.row, 1).setValue(name);
        if (cur[1] !== status) keep.sheet.getRange(keep.row, 2).setValue(status);
        if (cur[2] !== point)  keep.sheet.getRange(keep.row, 3).setValue(point);
        if (cur[3] !== role)   keep.sheet.getRange(keep.row, 4).setValue(role);
        // Vá link Card khi ô đang TRỐNG. Đường update xưa nay chỉ ghi A..D nên dòng nào
        // mất link — cắt-dán tay, paste thiếu cột — là mất vĩnh viễn, sync bao nhiêu lượt
        // cũng không mọc lại. Chỉ vá ô trống: link anh tự sửa không bao giờ bị đè.
        if (!String(cur[5] || '').trim() && url) {
          keep.sheet.getRange(keep.row, 6).setValue(cardFormula_(url));
          healedLink++;
          Logger.log('Vá link Card cho "%s" (%s dòng %s).', name, keep.month, keep.row);
        }
        updated++;
        return;
      }

      // No pid match anywhere -> this task (by id) has never been stamped.
      if (firstRun && !backfill) {
        // very first auto-run only records a baseline; manual backfill ignores this
        baseline++;
        return;
      }

      // RULE 7 (2026-08): task đã nằm ở tab tháng CŨ HƠN thì không được kéo lại về
      // tháng đang tính. Khớp id đã xử ở trên; tới đây chỉ còn ca dòng cũ TRỐNG cột G
      // (anh gõ tay / cắt-dán thiếu cột) — vá luôn page id vào G để lần sau khớp bằng
      // id, hết lặp. Tên trùng mà G có id KHÁC vẫn được add (rule 5): chặn theo tên vô
      // điều kiện sẽ nuốt mất task mới trùng tên ("Fix bug", "Review PR").
      //
      // Cố tình đứng NGOÀI cổng "có vừa vượt mốc không" bên dưới. Vá id là SỬA DỮ LIỆU,
      // không liên quan gì tới việc task có đang vượt mốc hay không. Nhét nó vào trong
      // cổng đó thì task đã counted từ trước (prev[pid] đã counted) không bao giờ đi vào,
      // nên dòng thiếu id ở tháng cũ nằm hỏng vĩnh viễn — lượt sync 10 phút không tự lành
      // được, phải có người nhớ bấm "quét bù". Ở ngoài thì mọi lượt sync đều vá.
      var oldRef = idx.olderByTitle[nt];
      if (oldRef) {
        if (!norm_(String(oldRef.sheet.getRange(oldRef.row, 7).getValue()))) {
          oldRef.sheet.getRange(oldRef.row, 7).setValue(pid);
          // Gán id theo TÊN là suy đoán, không phải khớp chắc chắn: hai task khác nhau
          // trùng tên sẽ bị buộc nhầm vào nhau, và dòng đó im lặng thay mặt task kia
          // mãi mãi. Để lại dấu ngay trên sheet — Execution log chỉ giữ được vài ngày.
          // Chỉ ghi khi Note đang trống: note anh tự gõ không bao giờ bị đè.
          if (!String(oldRef.sheet.getRange(oldRef.row, NOTE_COL).getValue() || '').trim())
            oldRef.sheet.getRange(oldRef.row, NOTE_COL).setValue(
              SCRIPT_NOTE_MARK + ' Tự gán Notion id theo tên task — check, xoá dòng này nếu không phải task đó');
        }
        idx.byPid[pid] = oldRef;
        delete idx.olderByTitle[nt];
        newStamped[pid] = true; // dòng cũ giờ mang id — pid coi như đã có mặt trên sheet
        blockedOld++;
        Logger.log('Không add "%s": đã có ở tab tháng cũ %s dòng %s — vá page id vào cột G.',
                   name, oldRef.month, oldRef.row);
        return;
      }

      // RULE 3a (Reviewer & Dev alike): only eligible once status reached Ready to
      // Test or beyond. Normal sync also requires observing the CROSS (prev not yet
      // counted); backfill stamps any counted task missing here.
      if (isCounted_(status) && (backfill || !isCounted_(prev[pid]))) {
        // DẤU ĐÃ-TỪNG-ADD (ca thật 2026-08-06): tới được đây là pid không còn dòng nào
        // (kể cả bia mộ) trên MỌI tab. Có stamp trong _STATE nghĩa là nó TỪNG có dòng
        // — anh đã xoá tay, và xoá tay là ý định: không re-add, kể cả quét bù. Task
        // chưa từng được add (không stamp) thì quét bù vẫn cứu như xưa — đúng việc
        // của nó là vớt task sync bắt hụt.
        if (stamped[pid]) {
          skippedDeleted++;
          skippedDeletedNames.push(name);
          Logger.log('Không hồi sinh "%s": pid từng có dòng trong sheet, giờ không còn — anh đã xoá tay.', name);
          return;
        }
        // RULE 6 (2026-08): tháng đã CHỐT SỔ thì không nhận dòng mới nữa — kể cả việc
        // tạo tab tháng đó từ _TEMPLATE. Update dòng cũ vẫn chạy bình thường (rule 1),
        // chốt sổ chỉ chặn đúng một việc: ADD. Đếm + log để không bao giờ chặn im lặng.
        if (monthClosed) {
          blockedClosed++;
          Logger.log('Chặn add "%s": tháng %s đã chốt sổ (chốt tới hết %s).',
                     name, month, closedThrough_());
          return;
        }
        // RULE 1: new rows go ONLY into the active month tab (calendar month, or
        // the pinned previous month while KPI close lags) — never any other tab.
        var msh = ensureMonthSheet_(ss, month);
        var r = nextFreeRow_(msh);
        msh.getRange(r, 1, 1, 7).setValues([[
          name, status, point, role, false,
          cardFormula_(url), pid,
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
            SCRIPT_NOTE_MARK + ' Nghi trùng "' + name + '" ở tab ' + titleRef.month +
            ' — check & xoá nếu trùng');
          suspect++;
        }
        idx.byPid[pid] = { sheet: msh, row: r, month: month };
        idx.byTitle[nt] = { sheet: msh, row: r, month: month };
        newStamped[pid] = true; // từ giờ pid này biến mất khỏi sheet = anh xoá, không re-add
        added++;
        return;
      }

      waiting++; // not counted yet, not in sheet
    });
  });
  writeState_(st.sheet, newState, newStamped);
  // Format là việc trang trí — hỏng thì kệ, không được kéo sập lượt sync point.
  try { syncRowFormat_(ss); }
  catch (e) { Logger.log('Đặt format dòng lỗi (sync point vẫn xong): %s', e); }
  try { syncStatusColors_(ss, Object.keys(seenStatus)); }
  catch (e) { Logger.log('Đồng bộ màu status lỗi (sync point vẫn xong): %s', e); }
  Logger.log('Sync done. added=%s updated=%s baseline=%s waiting=%s suspect=%s ' +
             'blockedClosed=%s blockedOld=%s dupFlagged=%s dupCleared=%s dupHandKept=%s healedLink=%s ' +
             'tombstones=%s skippedDeleted=%s firstRun=%s month=%s',
             added, updated, baseline, waiting, suspect, blockedClosed, blockedOld, dupFlagged,
             dupCleared, dupHandKept, healedLink, tombstones, skippedDeleted, firstRun, month);
  return { added: added, updated: updated, baseline: baseline, waiting: waiting, suspect: suspect,
           blockedClosed: blockedClosed, blockedOld: blockedOld,
           dupFlagged: dupFlagged, dupCleared: dupCleared, dupHandKept: dupHandKept,
           healedLink: healedLink, tombstones: tombstones,
           skippedDeleted: skippedDeleted, skippedDeletedNames: skippedDeletedNames,
           firstRun: firstRun, month: month, closedThrough: closedThrough_() };
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
      (r.blockedOld ? 'Bỏ qua (đã có ở tháng cũ): ' + r.blockedOld + '\n' : '') +
      (r.skippedDeleted ? '⛔ Không hồi sinh (anh đã xoá tay): ' + r.skippedDeleted + '\n   • ' +
                          r.skippedDeletedNames.join('\n   • ') + '\n' : '') +
      (r.dupCleared ? 'Đã dọn bản sao trùng: ' + r.dupCleared + '\n' : '') +
      (r.dupHandKept ? 'Dòng tay trùng (không tự xoá — xem Note H): ' + r.dupHandKept + '\n' : '') +
      (r.dupFlagged ? '⚠ Trùng tên khác id (xem Note H): ' + r.dupFlagged + '\n' : '') +
      (r.blockedClosed ? 'Bị chặn (tháng ' + r.month + ' đã chốt sổ tới hết ' +
                         r.closedThrough + '): ' + r.blockedClosed + '\n' : '') +
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
// Ghim lại một tháng đã chốt sổ = phá luật chốt sổ, nên phải có người bấm Yes. Không
// có UI (chạy từ editor / trigger) thì mặc định KHÔNG mở lại.
function confirmReopenMonth_(month) {
  var ui;
  try { ui = SpreadsheetApp.getUi(); }
  catch (e) {
    Logger.log('Tháng %s đã chốt sổ, không có UI để hỏi — không mở lại.', month);
    return false;
  }
  return ui.alert('Mở lại tháng ' + month + '?',
                  'Tháng ' + month + ' đã chốt sổ. Mở lại để tính tiếp?',
                  ui.ButtonSet.YES_NO) === ui.Button.YES;
}
function pinPrevMonth() {
  var pm = prevMonth_();
  if (isClosedMonth_(pm)) {
    if (!confirmReopenMonth_(pm)) {
      toast_('Giữ nguyên: tháng ' + pm + ' vẫn chốt sổ, task mới vẫn vào tháng ' + curMonth_() + '.',
             '🔒 Không mở lại');
      return;
    }
    // Chỉ hạ đúng một bậc: các tháng trước pm vốn đã chốt, mở lại pm không được mở lây.
    var back = prevOf_(pm);
    PropertiesService.getScriptProperties().setProperty(CLOSED_THROUGH_PROP, back);
    Logger.log('Mở lại tháng %s: hạ CLOSED_THROUGH xuống %s.', pm, back);
  }
  PropertiesService.getScriptProperties().setProperty(ACTIVE_MONTH_PROP, pm);
  toast_('Task mới sẽ tính cho tháng ' + pm + '. Chốt sổ xong nhớ bấm "✅ Chốt: sang tháng lịch".',
         '📌 Đã ghim tháng ' + pm);
}
// Gỡ ghim VÀ chốt sổ: sang tháng mới thì tháng cũ không nhận task mới nữa (Garry,
// 2026-08 — gộp vào đúng nút này chứ không thêm nút thứ hai). Mốc chỉ nâng, không hạ.
function unpinMonth() {
  PropertiesService.getScriptProperties().deleteProperty(ACTIVE_MONTH_PROP);
  var closed = raiseClosedThrough_(prevMonth_());
  toast_('Task mới sẽ tính cho tháng lịch như bình thường. Đã chốt sổ tới hết tháng ' +
         closed + ' — các tab tháng đó trở về trước không nhận task mới nữa.',
         '✅ Đã về tháng ' + curMonth_());
}
function toast_(msg, title) {
  try { ss_().toast(msg, title, 8); } catch (e) { Logger.log('%s — %s', title, msg); }
}
// Menu action: ghim tay Dashboard lên đầu, phòng khi thứ tự tab bị lệch ngoài lúc
// tạo tab tháng mới (vd Garry tự kéo thả tab khác).
// CỐ Ý không có gạch dưới cuối tên: Apps Script coi hàm kết thúc bằng `_` là private và
// KHÔNG gọi được từ addItem — bấm menu sẽ ra "Script function not found". Mọi hàm gắn
// menu/trigger đều phải để tên trần: syncNow, backfillCounted, diagnoseSheet, installTrigger.
function pinDashboardFirstMenu() {
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
// Format của rule do code sinh. Bảng màu không đổi thì code không ghi lại rule, nên
// đổi cách VẼ rule (thêm bold, đổi font...) mà không bump số này thì sheet giữ rule đời
// cũ vĩnh viễn. Bump = lượt sync kế tiếp dựng lại rule theo format mới.
var STATUS_FMT = 4;
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
  PropertiesService.getScriptProperties()
    .setProperty(STATUS_CACHE_PROP, JSON.stringify({ map: map, ts: ts, fmt: STATUS_FMT }));
}
function sameMap_(a, b) {
  var ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (var i = 0; i < ka.length; i++) if (a[ka[i]] !== b[ka[i]]) return false;
  return true;
}
// Trigger chạy 10 phút/lần — gọi Notion mỗi lần là đốt quota vô ích. Chỉ đọc lại
// schema khi: chưa có cache, gặp status chưa có trong cache (Notion vừa thêm), cache
// quá 24h (bắt ca đổi MÀU bên Notion mà tên status không đổi), hoặc rule trong sheet
// đang ở format đời cũ.
function needStatusRefresh_(cache, seenStatuses) {
  if (!cache) return true;
  if (cache.fmt !== STATUS_FMT) return true;
  if (now_() - cache.ts > STATUS_CACHE_TTL_MS) return true;
  for (var i = 0; i < seenStatuses.length; i++)
    if (!cache.map.hasOwnProperty(seenStatuses[i])) return true;
  return false;
}

// DỰNG LẠI mọi rule màu status mà code ĐỌC ĐƯỢC, thay vì cố đoán rule nào là của anh.
// Anh không tự tô màu status bao giờ ("để script lo hết", 2026-08), nên mọi rule
// TEXT_EQUAL_TO ở cột Status đều là sản phẩm của chính script này — chỉ khác là do bản
// nào sinh ra. Giữ lại rule đời cũ (thiếu màu chữ, palette đã đổi, range chặn đuôi) là
// thứ làm mỗi tab một màu: rule cũ chiếm chỗ status đó nên màu hiện tại không bao giờ
// được thêm vào tab đấy, trong khi tab mới tạo lại nhận màu hiện tại. Dựng lại hết thì
// mọi tab hội tụ về đúng một bảng màu.
// Chỉ dựng lại thứ dựng lại được. Hai loại rule KHÔNG đụng tới, vì xoá đi là mất luôn
// không tái tạo nổi: rule không đọc ra status (công thức / TEXT_CONTAINS), và rule phủ
// status mà Notion không còn (xoá đi thì mấy dòng cũ mất màu chứ không được màu mới).
// Chúng giữ nguyên thứ tự và vẫn đứng ĐẦU — Sheets xét từ trên xuống, rule khớp đầu
// tiên thắng. Range rule dựng lại luôn là B2:B không chặn đuôi.
function applyStatusRules_(sh, colorByStatus) {
  var old = sh.getConditionalFormatRules();
  var full = sh.getRange('B2:B');
  var theirs = [], rebuilt = 0;
  for (var i = 0; i < old.length; i++) {
    var rule = old[i], name = statusRuleValue_(rule);
    if (name !== null && colorByStatus.hasOwnProperty(name)) { rebuilt++; continue; }
    theirs.push(rule);
  }
  var out = theirs.slice(), names = Object.keys(colorByStatus), appended = 0;
  for (var j = 0; j < names.length; j++) {
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
  return { kept: theirs.length, rebuilt: rebuilt, appended: appended };
}
// Cột Status có dropdown (data validation). Danh sách của nó KHÔNG tự lớn theo Notion,
// nên status mới hợp lệ vẫn bị Sheets gắn cờ đỏ "invalid" — đúng ca QA/UAT, Waiting to
// launch. Dựng lại danh sách từ chính bảng status đang dùng để tô màu.
// allowInvalid = true (chỉ cảnh báo, không chặn) là cố ý: chặn cứng thì một status vừa
// đổi tên bên Notion sẽ khoá luôn lượt ghi của script, hỏng nặng hơn hẳn cái cờ đỏ.
function applyStatusValidation_(sh, statusNames) {
  if (!statusNames.length) return;
  sh.getRange(2, STATUS_COL, sh.getMaxRows() - 1, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(statusNames, true)
      .setAllowInvalid(true)
      .build());
}
function applyToTabs_(tabs, colorByStatus) {
  var tot = { kept: 0, rebuilt: 0, appended: 0 }, names = Object.keys(colorByStatus);
  tabs.forEach(function (sh) {
    var s = applyStatusRules_(sh, colorByStatus);
    applyStatusValidation_(sh, names);
    tot.kept += s.kept; tot.rebuilt += s.rebuilt; tot.appended += s.appended;
  });
  Logger.log('Màu status: giữ nguyên %s rule không đụng được, dựng lại %s rule, ghi %s rule màu, ' +
             'dropdown %s status (trên %s tab).',
             tot.kept, tot.rebuilt, tot.appended, names.length, tabs.length);
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
// Rule mang đúng dấu vân tay của bản code HIỆN TẠI: đúng cột Status, khớp text tuyệt
// đối, cặp nền/chữ trùng khít một dòng trong NOTION_CHIP. Chỉ dùng cho chẩn đoán —
// rule trượt phép thử này chính là rule đời cũ (thiếu màu chữ, palette đã đổi), thứ
// từng làm mỗi tab một màu. Việc dựng lại không còn phụ thuộc vào nó nữa.
// Cố tình KHÔNG xét bold: bold là format, không phải danh tính.
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
// Status đã có rule phủ trên tab này (dùng cho báo cáo "còn thiếu màu").
function coveredStatuses_(sh) {
  var out = {}, rules = sh.getConditionalFormatRules();
  for (var i = 0; i < rules.length; i++) {
    var name = statusRuleValue_(rules[i]);
    if (name !== null) out[name] = true;
  }
  return out;
}
// Tab tháng + _TEMPLATE — đích của MỌI lượt đặt format (màu status và wrap tiêu đề).
function formatTargets_(ss) {
  var out = [];
  ss.getSheets().forEach(function (sh) {
    var n = sh.getName();
    if (isMonthTab_(n) || n === TEMPLATE) out.push(sh);
  });
  return out;
}
// Format cấp DÒNG, đặt cho cả cột chứ không chỉ vùng _TEMPLATE vẽ sẵn.
// - Tên task dài phải xuống dòng thay vì bị cắt cụt ở cột A.
// - Checkbox cột Have phải phủ hết cột: dòng thêm về sau, hoặc dòng anh cắt-dán tay,
//   mà không có checkbox thì nhìn lệch hẳn so với các dòng khác trong cùng tab (ca thật
//   2026-08-05: dòng 10-12 tab 08/2026 trống trơn trong khi dòng 6-7 có ô tick).
function applyRowFormat_(sh) {
  var rows = sh.getMaxRows() - 1;
  if (rows < 1) return;
  sh.getRange(2, TITLE_COL, rows, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  sh.getRange(2, HAVE_COL, rows, 1)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  // Căn giữa Status..Card. Tên task wrap thành 2-3 dòng làm dòng cao lên, mấy ô một dòng
  // bên cạnh mặc định dính đáy nên nhìn lệch hẳn so với ô tick. Căn giữa theo chiều dọc
  // cho CẢ A..H, ngang thì chỉ B..F — cột tên (A) và cột Note (H) là văn bản dài, căn
  // giữa chữ dài đọc rất khó.
  sh.getRange(2, 1, rows, FOOTPRINT_COLS).setVerticalAlignment('middle');
  sh.getRange(2, STATUS_COL, rows, CARD_COL - STATUS_COL + 1).setHorizontalAlignment('center');
  // Cột Note mặc định tràn ngang sang phải — mà cột I+ là khối KPI, nên note dài sẽ đè
  // chữ lên đúng chỗ đó. Wrap để nó nằm yên trong ô. Nghiêng + xám + nhỏ hơn một cỡ để
  // ghi chú lùi ra sau chứ không tranh chỗ với task; màu lấy đúng xám của Notion cho khớp
  // với bảng màu status đang dùng.
  sh.getRange(2, NOTE_COL, rows, 1)
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP)
    .setFontStyle('italic')
    .setFontSize(NOTE_FONT_SIZE)
    .setFontColor(NOTION_CHIP['gray'].fg);
  // Wrap trong một cột quá hẹp thì dòng cao vống lên, còn tệ hơn tràn ngang. Chỉ nới khi
  // cột đang hẹp — anh đã tự kéo rộng hơn thì tôn trọng, không đụng.
  if (sh.getColumnWidth(NOTE_COL) < NOTE_MIN_WIDTH) sh.setColumnWidth(NOTE_COL, NOTE_WIDTH);
}
// Ghi số phiên bản SAU khi đặt xong: ghi trước rồi lỗi giữa chừng là mấy tab lỡ dở kẹt
// format cũ vĩnh viễn, vì lượt sau thấy phiên bản đã khớp nên bỏ qua (đúng bài học của
// cache màu). Trả về số tab đã đặt, 0 = không có gì phải làm.
function syncRowFormat_(ss) {
  var props = PropertiesService.getScriptProperties();
  if (parseInt(props.getProperty(ROW_FMT_PROP), 10) >= ROW_FMT) return 0;
  var tabs = formatTargets_(ss);
  tabs.forEach(applyRowFormat_);
  props.setProperty(ROW_FMT_PROP, String(ROW_FMT));
  Logger.log('Đặt format dòng (wrap tên + checkbox Have) cho %s tab — format v%s.', tabs.length, ROW_FMT);
  return tabs.length;
}
// Tab tháng mới clone từ _TEMPLATE nên bình thường đã thừa hưởng conditional
// formatting. Guard cho ca _TEMPLATE chưa kịp có rule (thứ tự lần chạy đầu): có cache
// màu thì tô ngay, khỏi đợi tới lần bảng màu đổi tiếp theo.
function applyCachedStatusRules_(sh) {
  var cache = readStatusCache_();
  if (!cache) return;
  applyStatusRules_(sh, cache.map);
  applyStatusValidation_(sh, Object.keys(cache.map));
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
  var changed = !cache || cache.fmt !== STATUS_FMT || !sameMap_(cache.map, sc.map);
  var orphans = orphanStatuses_(ss, sc.map);
  if (orphans.length)
    Logger.log('⚠ Status có trong sheet nhưng Notion không còn (mấy dòng này vẫn không màu): %s', orphans.join(' | '));
  if (!changed) {
    writeStatusCache_(sc.map, now_()); // bảng màu y cũ: chỉ cần trẻ lại ts để khỏi fetch mỗi 10'
    return { refreshed: true, applied: 0, orphans: orphans };
  }
  var tabs = formatTargets_(ss);
  applyToTabs_(tabs, sc.map);
  // Cache chỉ được ghi SAU khi áp xong. Ghi trước thì một lần applyToTabs_ ném giữa
  // chừng (quota, sheet bị protect) sẽ để cache nói dối là "đã áp": lượt sau thấy bảng
  // màu không đổi nên bỏ qua, mấy tab lỡ dở kẹt màu sai vĩnh viễn.
  writeStatusCache_(sc.map, now_());
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
    return { colored: 0, tabs: 0, orphans: [], kept: 0, rebuilt: 0, appended: 0 };
  }
  var tabs = formatTargets_(ss);
  var tot = applyToTabs_(tabs, sc.map);
  writeStatusCache_(sc.map, now_());

  var colored = Object.keys(sc.map).length;
  var orphans = orphanStatuses_(ss, sc.map);
  alert_(
    'Bù màu status xong.\n\n' +
    'Status lấy từ Notion:   ' + colored + '\n' +
    'Tab xử lý:              ' + tabs.length + ' (gồm cả ' + TEMPLATE + ' → tab tháng mới tự có màu)\n' +
    'Rule không đụng tới:    ' + tot.kept + '\n' +
    'Rule dựng lại:          ' + tot.rebuilt + '\n' +
    'Rule màu đã ghi:        ' + tot.appended + '\n\n' +
    (orphans.length
      ? '⚠ ' + orphans.length + ' status trong sheet vẫn không màu (Notion không còn, đổi tên / xoá):\n   • ' +
        orphans.join('\n   • ') + '\n\nSửa tên cho khớp Notion là xong.'
      : 'Mọi status đang có trong sheet đều đã có màu.'));
  Logger.log('Color done. statuses=%s tabs=%s orphans=%s', colored, tabs.length, orphans.join(' | '));
  return { colored: colored, tabs: tabs.length, orphans: orphans,
           kept: tot.kept, rebuilt: tot.rebuilt, appended: tot.appended };
}
function alert_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}

// ---- 🩺 chẩn đoán (CHỈ ĐỌC, không sửa một ô nào) ----
// Ba triệu chứng khó chịu nhất — task bị kéo lại tháng mới, màu lệch giữa các tab,
// dòng bị ghi đè — đều có thể do trạng thái chỉ tồn tại trong sheet thật mà đọc code
// không thấy: tab bị đổi tên nên isMonthTab_ không nhận (vô hình với index / màu /
// orphan), dòng trống cột A, dòng thiếu page id. Hàm này in ra đủ dữ kiện để kết
// luận thay vì đoán. Chi tiết vào Logger, tóm tắt vào alert.
function diagnoseStatusRules_(sh) {
  var rules = sh.getConditionalFormatRules(), own = [], foreign = [], unreadable = 0;
  for (var i = 0; i < rules.length; i++) {
    if (!isStatusColRule_(rules[i])) continue;
    var name = statusRuleValue_(rules[i]);
    if (name === null) { unreadable++; continue; }
    if (isOwnStatusRule_(rules[i])) own.push(name); else foreign.push(name);
  }
  return { ownRules: own, foreignRules: foreign, unreadableRules: unreadable };
}
function diagnoseTab_(sh, name, isMonth) {
  var v = footprintValues_(sh);
  var out = { name: name, isMonth: isMonth, dataRows: 0, gapRows: [], missingPid: [],
              lastByA: 1, lastByAH: 1, lastRowAll: sh.getLastRow(), rows: [] };
  for (var i = 0; i < v.length; i++) {
    var row = v[i], r = i + 2;
    if (!rowHasContent_(row)) continue;
    out.dataRows++;
    out.lastByAH = r;
    if (row[0] !== '' && row[0] !== null) out.lastByA = r; else out.gapRows.push(r);
    var pid = row.length > 6 ? norm_(String(row[6])) : '';
    if (!pid) out.missingPid.push(r);
    out.rows.push({ row: r, pid: pid, title: normTitle_(row[0]) });
  }
  var cf = diagnoseStatusRules_(sh);
  out.ownRules = cf.ownRules; out.foreignRules = cf.foreignRules;
  out.unreadableRules = cf.unreadableRules;
  return out;
}
function diagnoseSheet() {
  var ss = ss_();
  var props = PropertiesService.getScriptProperties();
  var L = ['🩺 CHẨN ĐOÁN SHEET (chỉ đọc, không sửa gì)'];
  L.push('Tháng đang tính: ' + activeMonth_() + ' | tháng lịch: ' + curMonth_() +
         ' | ghim: ' + (props.getProperty(ACTIVE_MONTH_PROP) || '(không)') +
         ' | chốt sổ tới hết: ' + (closedThrough_() || '(chưa chốt tháng nào)'));

  var tabs = [], alienTabs = [], pidWhere = {}, titleWhere = {};
  var monthTabs = 0, gapRows = 0, missingPid = 0, dataRows = 0, foreignRules = 0;
  ss.getSheets().forEach(function (sh) {
    var name = sh.getName();
    if (name === TEMPLATE || name === STATE || name === DASHBOARD) {
      L.push('· "' + name + '" — tab hệ thống, bỏ qua');
      return;
    }
    // Tab lạ vẫn được QUÉT chứ không chỉ điểm mặt: task nằm trong đó là thứ giải thích
    // vì sao nó bị add lại ở tháng mới, nên page id / tên của nó phải vào bảng trùng.
    var isMonth = isMonthTab_(name);
    var d = diagnoseTab_(sh, name, isMonth);
    // Tab không phải tab tháng chỉ đáng báo động khi nó ĐANG giữ dòng task, hoặc khi cái
    // tên cho thấy nó vốn định là tab tháng mà gõ sai. Bắt một tab "Ghi chú" đi đổi tên
    // thành MM/YYYY là làm nhiễu đúng cái báo cáo sinh ra để đọc cho nhanh.
    if (!isMonth && !looksLikeMonthTab_(name) && !d.dataRows) {
      L.push('· "' + name + '" — tab thường, không giữ dòng task nào, bỏ qua');
      return;
    }
    tabs.push(d);
    if (isMonth) monthTabs++; else alienTabs.push(name);
    dataRows += d.dataRows; gapRows += d.gapRows.length; missingPid += d.missingPid.length;
    foreignRules += d.foreignRules.length;
    d.rows.forEach(function (x) {
      if (x.pid) (pidWhere[x.pid] = pidWhere[x.pid] || []).push(name + '!' + x.row);
      if (x.title) (titleWhere[x.title] = titleWhere[x.title] || []).push(name + '!' + x.row);
    });
    L.push((isMonth ? '✔ "' : '✗ "') + name + '" — ' +
           (isMonth ? '' : 'KHÔNG khớp MM/YYYY → VÔ HÌNH với sync (không được index nên task ' +
                           'trong đây bị coi là chưa có và bị add lại ở tháng mới; không được ' +
                           'tô màu; không bị chặn add). Đổi tên đúng dạng MM/YYYY là hết. — ') +
           'dòng data: ' + d.dataRows +
           ' | dòng cuối theo cột A: ' + d.lastByA + ' | theo A..H: ' + d.lastByAH +
           ' | dòng cuối cả sheet (kể cả KPI cột I+): ' + d.lastRowAll);
    if (d.gapRows.length)
      L.push('    ⚠ ' + d.gapRows.length + ' dòng có data nhưng TRỐNG cột A (dòng ' +
             d.gapRows.join(', ') + ') — bản cũ chỉ soi cột A nên add sẽ ghi đè lên đây.');
    if (d.missingPid.length)
      L.push('    ⚠ ' + d.missingPid.length + ' dòng TRỐNG page id cột G (dòng ' +
             d.missingPid.join(', ') + ') — không khớp được theo id, task dễ bị add lại.');
    L.push('    rule màu cột Status: đúng bảng màu hiện tại ' + d.ownRules.length +
           ' [' + d.ownRules.join(', ') + '] | đời cũ/lệch màu ' + d.foreignRules.length +
           ' [' + d.foreignRules.join(', ') + '] | không đọc được ' + d.unreadableRules);
  });

  var dupPid = [], dupTitle = [], k;
  for (k in pidWhere) if (pidWhere[k].length > 1) dupPid.push(k + ' @ ' + pidWhere[k].join(', '));
  for (k in titleWhere) if (titleWhere[k].length > 1) dupTitle.push(k + ' @ ' + titleWhere[k].join(', '));
  L.push(dupPid.length ? '⚠ Page id trùng: ' + dupPid.join(' ; ') : '✔ Không có page id trùng.');
  L.push(dupTitle.length ? '⚠ Tên task trùng: ' + dupTitle.join(' ; ') : '✔ Không có tên task trùng.');

  // Bán kính nổ của "quét bù", đo TRƯỚC khi bấm. _STATE giữ status lần quét gần nhất,
  // nên task counted trong đó mà không có dòng nào ở bất kỳ tab tháng nào chính là tập
  // quét bù sẽ thêm — và nó thêm tất cả vào THÁNG ĐANG TÍNH, kể cả task thật ra đã đạt
  // mốc từ tháng khác. Con số này nhỏ thì bấm yên tâm, lớn thì dừng lại xem đã.
  var stSh = ss.getSheetByName(STATE), pendingBackfill = 0, deletedStamped = 0;
  if (stSh && stSh.getLastRow() >= 2) {
    // Đọc _STATE đúng luật của getState_ (kể cả migration format cũ 2 cột), để con số
    // in ra khớp với việc quét bù SẼ làm: pid có stamp mà mất dòng = anh đã xoá,
    // quét bù bỏ qua chứ không thêm — không được đếm nó vào bán kính nổ.
    var legacySt = String(stSh.getRange(1, 3).getValue() || '') !== 'stamped';
    var sv = stSh.getRange(2, 1, stSh.getLastRow() - 1, 3).getValues();
    for (var m = 0; m < sv.length; m++) {
      var sp = norm_(String(sv[m][0]));
      if (!sp || !isCounted_(sv[m][1]) || pidWhere[sp]) continue;
      if (legacySt || sv[m][2]) deletedStamped++;
      else pendingBackfill++;
    }
  }
  L.push('Quét bù sẽ thêm khoảng ' + pendingBackfill + ' dòng vào tab ' + activeMonth_() +
         ' (task đã counted mà chưa có dòng nào trong sheet).' +
         (deletedStamped ? ' Bỏ qua ' + deletedStamped + ' task anh đã xoá tay — không hồi sinh.' : '') +
         ' Task nào thật ra đạt mốc ở tháng khác thì kéo dòng sang tab đúng sau khi quét.');

  Logger.log(L.join('\n'));
  alert_('🩺 Chẩn đoán xong (chỉ đọc, không sửa gì).\n\n' +
         'Tháng đang tính:            ' + activeMonth_() + '\n' +
         'Chốt sổ tới hết:            ' + (closedThrough_() || 'chưa chốt') + '\n' +
         'Tab tháng hợp lệ:           ' + monthTabs + '\n' +
         'Tab KHÔNG khớp MM/YYYY:     ' + alienTabs.length +
             (alienTabs.length ? ' → ' + alienTabs.join(', ') : '') + '\n' +
         'Dòng data:                  ' + dataRows + '\n' +
         'Dòng trống cột A:           ' + gapRows + '\n' +
         'Dòng thiếu page id (G):     ' + missingPid + '\n' +
         'Page id trùng:              ' + dupPid.length + '\n' +
         'Tên task trùng:             ' + dupTitle.length + '\n' +
         'Rule màu status đời cũ:     ' + foreignRules + '\n\n' +
         'Quét bù sẽ thêm ~' + pendingBackfill + ' dòng vào tab ' + activeMonth_() + '.' +
         (deletedStamped ? ' (Bỏ qua ' + deletedStamped + ' task anh đã xoá tay.)' : '') + '\n\n' +
         'Chi tiết từng tab / từng dòng nằm trong Execution log ' +
         '(Extensions → Apps Script → Executions).');
  return { tabs: tabs, alienTabs: alienTabs, monthTabs: monthTabs, dataRows: dataRows,
           gapRows: gapRows, missingPid: missingPid, dupPid: dupPid, dupTitle: dupTitle,
           foreignRules: foreignRules, pendingBackfill: pendingBackfill,
           deletedStamped: deletedStamped, lines: L };
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
  var cur = curMonth_(), am = activeMonth_(), closed = closedThrough_();
  var pin = PropertiesService.getScriptProperties().getProperty(ACTIVE_MONTH_PROP);
  SpreadsheetApp.getUi()
    .createMenu('🔄 Point Sync — tháng ' + am + (closed ? ' (đã chốt ≤ ' + closed + ')' : ''))
    .addItem('Sync now', 'syncNow')
    .addItem('Kéo task counted còn thiếu (quét bù)', 'backfillCounted')
    .addSeparator()
    .addItem('⏪ Vẫn tính cho tháng trước (' + prevMonth_() + ')', 'pinPrevMonth')
    .addItem('✅ Chốt: sang tháng lịch (' + cur + ')', 'unpinMonth')
    .addSeparator()
    .addItem('🩺 Chẩn đoán sheet', 'diagnoseSheet')
    .addItem('📌 Ghim Dashboard lên đầu', 'pinDashboardFirstMenu')
    .addItem('Install 10-min auto-sync', 'installTrigger')
    .addToUi();
  // Nhắc passive khi đang ghim — mở sheet là thấy mình đang tính cho tháng nào.
  if (am !== cur) {
    toast_('Đang ghim: task mới tính cho tháng ' + am + ', không phải tháng lịch ' + cur +
           '. Chốt sổ xong bấm "✅ Chốt: sang tháng lịch".', '📌 Point Sync');
  } else if (pin && isClosedMonth_(pin)) {
    toast_('Ghim tháng ' + pin + ' đang bị bỏ qua vì tháng đó đã chốt sổ — task mới vẫn vào ' +
           'tháng lịch ' + cur + '.', '🔒 Point Sync');
  }
}
