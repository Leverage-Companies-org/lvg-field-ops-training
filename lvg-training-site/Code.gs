/**
 * LVG Training — results backend (all courses)
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

// Pass marks live here (server side) so a page can't lower its own bar.
const COURSES = {
  'field-ops': { name: 'Field Ops', passMark: 10 },
  'project-management': { name: 'Project Management', passMark: 11 }
};
const DEFAULT_COURSE = 'field-ops';  // rows/events sent before courses existed
const ROSTER_HEADERS = ['Trainee ID', 'Name', 'Email', 'Status', 'Best final', 'Latest final',
  'Final attempts', 'Modules done', 'Module quiz avg', 'Module quiz detail', 'Started', 'Last activity', 'Passed on', 'Course'];
const LOG_HEADERS = ['Timestamp', 'Type', 'Event', 'Name', 'Email', 'Final score', 'Passed',
  'Attempt', 'Modules done', 'Module', 'Raw', 'Course'];

function course_(id) { return COURSES[id] ? id : DEFAULT_COURSE; }

// Leading apostrophe stops Sheets turning "12/12" into a date.
function txt_(v) { return v === '' || v == null ? '' : "'" + String(v).replace(/^'/, ''); }

function props_() { return PropertiesService.getScriptProperties(); }

function sheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#17203A').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  } else if (sh.getLastColumn() < headers.length) {
    // older sheet: add any new header columns
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#17203A').setFontColor('#FFFFFF');
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
  const r = notifySlack_(':white_check_mark: LVG Training is connected. Final check results will show up here.');
  Logger.log('Slack test: ' + r);
}

function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad json' }); }
  if (!d || !d.id || !d.name || ['progress', 'final'].indexOf(d.type) < 0) return json_({ ok: false, error: 'bad payload' });
  d.name = String(d.name).slice(0, 80);
  d.email = String(d.email || '').slice(0, 120);
  d.course = course_(d.course);
  d.passMark = COURSES[d.course].passMark;
  d.courseName = COURSES[d.course].name;

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const log = sheet_('Log', LOG_HEADERS);
    log.appendRow([new Date(d.ts || Date.now()), d.type, d.event || (d.type === 'final' ? 'final-check' : ''),
      d.name, d.email, d.type === 'final' ? txt_(d.finalScore + '/' + d.finalTotal) : '',
      d.type === 'final' ? (d.passed ? 'Yes' : 'No') : '', d.attempts || '', txt_(d.modulesDone + '/' + d.modulesTotal),
      d.module || '', JSON.stringify(d).slice(0, 4000), d.courseName]);
    upsertRoster_(d);
  } finally {
    lock.releaseLock();
  }

  if (d.type === 'final') notifySlack_(slackText_(d));
  return json_({ ok: true });
}

function upsertRoster_(d) {
  const sh = sheet_('Trainees', ROSTER_HEADERS);
  const keys = sh.getLastRow() > 1
    ? sh.getRange(2, 1, sh.getLastRow() - 1, ROSTER_HEADERS.length).getValues().map(r => r[0] + '|' + course_(courseIdFromName_(r[13])))
    : [];
  let row = keys.indexOf(d.id + '|' + d.course);
  let cur = row >= 0 ? sh.getRange(row + 2, 1, 1, ROSTER_HEADERS.length).getValues()[0] : null;
  const now = new Date(d.ts || Date.now());

  const q = quizSummary_(d.quizzes);
  let best = cur && !(cur[4] instanceof Date) ? cur[4] : '', latest = cur && !(cur[5] instanceof Date) ? cur[5] : '', attempts = cur ? cur[6] : 0, passedOn = cur ? cur[12] : '';
  if (d.type === 'final') {
    latest = d.finalScore + '/' + d.finalTotal;
    attempts = Math.max(Number(attempts) || 0, d.attempts || 1);
    const prevBest = best ? Number(String(best).replace(/^'/, '').split('/')[0]) : -1;
    if (d.finalScore > prevBest) best = latest;
    if (d.passed && !passedOn) passedOn = now;
  }
  const bestNum = best ? Number(String(best).replace(/^'/, '').split('/')[0]) : null;
  const status = bestNum != null && bestNum >= d.passMark ? 'Passed'
    : attempts > 0 ? 'Not passed yet' : 'In progress';

  const values = [d.id, d.name, d.email, status, txt_(best), txt_(latest), attempts,
    txt_(d.modulesDone + '/' + d.modulesTotal), q.avg, q.detail, cur ? cur[10] : now, now, passedOn, d.courseName];
  if (row >= 0) sh.getRange(row + 2, 1, 1, values.length).setValues([values]);
  else sh.appendRow(values);
}

function courseIdFromName_(name) {
  if (!name) return DEFAULT_COURSE;
  for (const id in COURSES) if (COURSES[id].name === name) return id;
  return DEFAULT_COURSE;
}

function quizName_(k, v) { return (v && v.title) || k; }

function quizSummary_(quizzes) {
  let right = 0, total = 0;
  const parts = [];
  Object.keys(quizzes || {}).forEach(k => {
    const v = quizzes[k];
    if (v && v.right != null) { right += v.right; total += v.total; parts.push(quizName_(k, v) + ' ' + v.right + '/' + v.total); }
  });
  return { avg: total ? Math.round(right / total * 100) + '%' : '', detail: parts.join(' · '), right, total };
}

function slackText_(d) {
  const q = quizSummary_(d.quizzes);
  const missing = Object.keys(d.quizzes || {}).filter(k => d.quizzes[k].right == null).map(k => quizName_(k, d.quizzes[k]));
  return [
    (d.passed ? ':white_check_mark: *' : ':x: *') + d.name + '* ' + (d.passed ? 'passed' : 'did not pass') +
      ' the ' + d.courseName + ' final check: *' + d.finalScore + '/' + d.finalTotal + '* (need ' + d.passMark + ')',
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
    passedOn: r[12] instanceof Date ? r[12].toISOString() : r[12],
    course: courseIdFromName_(r[13]), courseName: COURSES[courseIdFromName_(r[13])].name
  }));
  return json_({ ok: true, courses: COURSES, generated: new Date().toISOString(), trainees: trainees });
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
