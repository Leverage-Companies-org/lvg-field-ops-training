/**
 * LVG Field Ops Training — results backend
 *
 * Lives inside a Google Sheet (Extensions > Apps Script). It:
 *   - logs every event from the course to the "Log" tab
 *   - keeps one row per trainee on the "Trainees" tab (the live roster)
 *   - DMs Matt on Slack whenever someone submits the final check
 *   - serves the roster as JSON to dashboard.html (needs DASHBOARD_KEY)
 *
 * Script properties (Project Settings > Script properties):
 *   DASHBOARD_KEY    any long random string; Matt types it once on the dashboard
 *   SLACK_BOT_TOKEN  xoxb-... from your Slack app (scope: chat:write)
 *   SLACK_USER_ID    U08BXCYLFNW  (Matthew Silva)
 *   SLACK_WEBHOOK_URL  optional alternative to the bot token (incoming webhook
 *                      or Workflow Builder webhook with a "text" variable)
 */

const PASS_MARK = 10;
const MODULE_NAMES = {
  culture: 'Who we are', team: 'Roles', lifecycle: 'Route to closing', rhythm: 'Daily rhythm',
  inspections: 'CO & fire', permits: 'Permits & blockers', money: 'Money', systems: 'Tools',
  tenants: 'Tenants', safety: 'Site safety', closeout: 'Close-out'
};
const ROSTER_HEADERS = ['Trainee ID', 'Name', 'Email', 'Status', 'Best final', 'Latest final',
  'Final attempts', 'Modules done', 'Module quiz avg', 'Module quiz detail', 'Started', 'Last activity', 'Passed on'];
const LOG_HEADERS = ['Timestamp', 'Type', 'Event', 'Name', 'Email', 'Final score', 'Passed',
  'Attempt', 'Modules done', 'Module', 'Raw'];

function props_() { return PropertiesService.getScriptProperties(); }

function sheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#17203A').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Run once from the editor to create the tabs and send Matt a test DM. */
function setup() {
  sheet_('Trainees', ROSTER_HEADERS);
  sheet_('Log', LOG_HEADERS);
  const p = props_();
  if (!p.getProperty('DASHBOARD_KEY')) p.setProperty('DASHBOARD_KEY', Utilities.getUuid());
  Logger.log('DASHBOARD_KEY = ' + p.getProperty('DASHBOARD_KEY'));
  const r = notifySlack_(':white_check_mark: LVG Field Ops Training is connected. Final check results will show up here.');
  Logger.log('Slack test: ' + r);
}

function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad json' }); }
  if (!d || !d.id || !d.name || ['progress', 'final'].indexOf(d.type) < 0) return json_({ ok: false, error: 'bad payload' });
  d.name = String(d.name).slice(0, 80);
  d.email = String(d.email || '').slice(0, 120);

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const log = sheet_('Log', LOG_HEADERS);
    log.appendRow([new Date(d.ts || Date.now()), d.type, d.event || (d.type === 'final' ? 'final-check' : ''),
      d.name, d.email, d.type === 'final' ? d.finalScore + '/' + d.finalTotal : '',
      d.type === 'final' ? (d.passed ? 'Yes' : 'No') : '', d.attempts || '', d.modulesDone + '/' + d.modulesTotal,
      d.module || '', JSON.stringify(d).slice(0, 4000)]);
    upsertRoster_(d);
  } finally {
    lock.releaseLock();
  }

  if (d.type === 'final') notifySlack_(slackText_(d));
  return json_({ ok: true });
}

function upsertRoster_(d) {
  const sh = sheet_('Trainees', ROSTER_HEADERS);
  const ids = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(r => r[0]) : [];
  let row = ids.indexOf(d.id);
  let cur = row >= 0 ? sh.getRange(row + 2, 1, 1, ROSTER_HEADERS.length).getValues()[0] : null;
  const now = new Date(d.ts || Date.now());

  const q = quizSummary_(d.quizzes);
  let best = cur ? cur[4] : '', latest = cur ? cur[5] : '', attempts = cur ? cur[6] : 0, passedOn = cur ? cur[12] : '';
  if (d.type === 'final') {
    latest = d.finalScore + '/' + d.finalTotal;
    attempts = Math.max(Number(attempts) || 0, d.attempts || 1);
    const prevBest = best ? Number(String(best).split('/')[0]) : -1;
    if (d.finalScore > prevBest) best = latest;
    if (d.passed && !passedOn) passedOn = now;
  }
  const bestNum = best ? Number(String(best).split('/')[0]) : null;
  const status = bestNum != null && bestNum >= PASS_MARK ? 'Passed'
    : attempts > 0 ? 'Not passed yet' : 'In progress';

  const values = [d.id, d.name, d.email, status, best, latest, attempts,
    d.modulesDone + '/' + d.modulesTotal, q.avg, q.detail, cur ? cur[10] : now, now, passedOn];
  if (row >= 0) sh.getRange(row + 2, 1, 1, values.length).setValues([values]);
  else sh.appendRow(values);
}

function quizSummary_(quizzes) {
  let right = 0, total = 0;
  const parts = [];
  Object.keys(quizzes || {}).forEach(k => {
    const v = quizzes[k];
    if (v && v.right != null) { right += v.right; total += v.total; parts.push((MODULE_NAMES[k] || k) + ' ' + v.right + '/' + v.total); }
  });
  return { avg: total ? Math.round(right / total * 100) + '%' : '', detail: parts.join(' · '), right, total };
}

function slackText_(d) {
  const q = quizSummary_(d.quizzes);
  const missing = Object.keys(d.quizzes || {}).filter(k => d.quizzes[k].right == null).map(k => MODULE_NAMES[k] || k);
  return [
    (d.passed ? ':white_check_mark: *' : ':x: *') + d.name + '* ' + (d.passed ? 'passed' : 'did not pass') +
      ' the Field Ops final check: *' + d.finalScore + '/' + d.finalTotal + '* (need ' + PASS_MARK + ')',
    'Attempt ' + (d.attempts || 1) + (d.best != null && d.best !== d.finalScore ? ' · best so far ' + d.best + '/' + d.finalTotal : ''),
    'Modules marked done: ' + d.modulesDone + '/' + d.modulesTotal +
      (q.total ? ' · module quizzes ' + q.right + '/' + q.total + ' (' + q.avg + ')' : ''),
    missing.length ? 'Quizzes not taken: ' + missing.join(', ') : 'All module quizzes taken',
    d.email ? 'Email: ' + d.email : ''
  ].filter(String).join('\n');
}

function notifySlack_(text) {
  const p = props_();
  const token = p.getProperty('SLACK_BOT_TOKEN');
  const user = p.getProperty('SLACK_USER_ID');
  const hook = p.getProperty('SLACK_WEBHOOK_URL');
  try {
    if (token && user) {
      const r = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
        method: 'post', contentType: 'application/json; charset=utf-8', muteHttpExceptions: true,
        headers: { Authorization: 'Bearer ' + token },
        payload: JSON.stringify({ channel: user, text: text })
      });
      return r.getContentText();
    }
    if (hook) {
      const r = UrlFetchApp.fetch(hook, { method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify({ text: text }) });
      return r.getResponseCode() + ' ' + r.getContentText();
    }
    return 'Slack not configured';
  } catch (err) {
    return 'Slack error: ' + err;
  }
}

/** Dashboard feed: GET ?key=DASHBOARD_KEY */
function doGet(e) {
  const key = props_().getProperty('DASHBOARD_KEY');
  if (!key || !e || !e.parameter || e.parameter.key !== key) return json_({ ok: false, error: 'unauthorized' });
  const sh = sheet_('Trainees', ROSTER_HEADERS);
  const rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, ROSTER_HEADERS.length).getValues() : [];
  const trainees = rows.map(r => ({
    id: r[0], name: r[1], email: r[2], status: r[3], best: r[4], latest: r[5], attempts: r[6],
    modules: r[7], quizAvg: r[8], quizDetail: r[9],
    started: r[10] instanceof Date ? r[10].toISOString() : r[10],
    last: r[11] instanceof Date ? r[11].toISOString() : r[11],
    passedOn: r[12] instanceof Date ? r[12].toISOString() : r[12]
  }));
  return json_({ ok: true, passMark: PASS_MARK, generated: new Date().toISOString(), trainees: trainees });
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
