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
// statuses meaning "has reached Ready to Test" -> eligible to be stamped
var COUNTED = ['Ready to Test','Testing','UAT','To review','Reviewing',
               'To deploy','Test Production','Test Production & To launch','Launching','Done'];
var TEMPLATE = '_TEMPLATE';
var STATE = '_STATE';
var NOTION_VERSION = '2025-09-03';
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
  return sh;
}
function lastDataRow_(sh) {
  var col = sh.getRange('A2:A').getValues();
  for (var i = col.length - 1; i >= 0; i--) if (col[i][0] !== '' && col[i][0] !== null) return i + 2;
  return 1;
}
// pageId/title -> {sheet,row}
function buildIndex_(ss) {
  var byPid = {}, byTitle = {};
  ss.getSheets().forEach(function (sh) {
    if (!isMonthTab_(sh.getName())) return;
    var last = lastDataRow_(sh);
    if (last < 2) return;
    var v = sh.getRange(2, 1, last - 1, 7).getValues(); // A..G
    for (var i = 0; i < v.length; i++) {
      var ref = { sheet: sh, row: i + 2 };
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
function syncNow() {
  var ss = ss_();
  var st = getState_(ss), firstRun = st.firstRun, prev = st.map, newState = {};
  var idx = buildIndex_(ss);
  var month = curMonth_();
  var added = 0, updated = 0, baseline = 0, waiting = 0;

  WATCH_SOURCES.forEach(function (ds) {
    notionQuery_(ds).forEach(function (pg) {
      var p = pg.properties, role = roleOf_(p);
      if (role !== 'Dev' && role !== 'Reviewer') return;
      var pid = norm_(pg.id), status = statusOf_(p), point = pointOf_(p),
          name = title_(p), nt = normTitle_(name), url = pg.url;
      newState[pid] = status;

      var ref = idx.byPid[pid] || idx.byTitle[nt];
      if (ref) {
        var cur = ref.sheet.getRange(ref.row, 1, 1, 7).getValues()[0]; // A..G
        if (cur[0] !== name)   ref.sheet.getRange(ref.row, 1).setValue(name);
        if (cur[1] !== status) ref.sheet.getRange(ref.row, 2).setValue(status);
        if (cur[2] !== point)  ref.sheet.getRange(ref.row, 3).setValue(point);
        if (cur[3] !== role)   ref.sheet.getRange(ref.row, 4).setValue(role);
        if (!norm_(String(cur[6]))) ref.sheet.getRange(ref.row, 7).setValue(pid); // heal missing id
        idx.byPid[pid] = ref; idx.byTitle[nt] = ref;
        updated++;
      } else if (!firstRun && !isCounted_(prev[pid]) && isCounted_(status)) {
        // observed crossing into a counted status -> stamp current month
        var msh = ensureMonthSheet_(ss, month);
        var r = lastDataRow_(msh) + 1;
        msh.getRange(r, 1, 1, 7).setValues([[
          name, status, point, role, false,
          '=HYPERLINK("' + url + '","Notion ↗")', pid,
        ]]);
        idx.byPid[pid] = { sheet: msh, row: r };
        idx.byTitle[nt] = { sheet: msh, row: r };
        added++;
      } else if (firstRun) {
        baseline++;
      } else {
        waiting++; // not counted yet, not in sheet
      }
    });
  });
  writeState_(st.sheet, newState);
  Logger.log('Sync done. added=%s updated=%s baseline=%s waiting=%s firstRun=%s month=%s',
             added, updated, baseline, waiting, firstRun, month);
  return { added: added, updated: updated, baseline: baseline, waiting: waiting, firstRun: firstRun };
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
  SpreadsheetApp.getUi().createMenu('🔄 Point Sync')
    .addItem('Sync now', 'syncNow')
    .addItem('Install 10-min auto-sync', 'installTrigger')
    .addToUi();
}
