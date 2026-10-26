"""Add trainee sign-in + score reporting to an LVG training course page.

usage: python3 patch_course.py SRC DST COURSE_ID "Course name" PASS_MARK
"""
import re, sys

src, dst, course_id, course_name, pass_mark = sys.argv[1:6]
pass_mark = int(pass_mark)
s = open(src, encoding="utf-8").read()


def rep(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, (old[:60], n)
    s = s.replace(old, new)


def rerep(pattern, fn):
    global s
    s, n = re.subn(pattern, fn, s, count=1, flags=re.S)
    assert n == 1, pattern[:60]


# ---------- CSS ----------
rep("@media (prefers-reduced-motion: reduce){*{transition:none!important}}", """/* Trainee sign-in + reporting */
.trainee{margin:22px 0;background:var(--surface);border:2px solid var(--ink);border-radius:14px;padding:18px 20px}
.trainee h3{margin:0 0 6px}
.trainee p{margin:0 0 12px;color:var(--muted)}
.trainee .row{display:flex;gap:10px;flex-wrap:wrap}
.trainee .row label{flex:1 1 220px;display:flex;flex-direction:column;gap:4px;font-weight:700;font-size:.92rem}
.trainee input{font:inherit;font-weight:400;padding:11px 13px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--ink)}
.trainee input:focus-visible{outline:3px solid var(--focus);outline-offset:1px}
.trainee .err{color:var(--red);font-weight:700;margin-top:8px}
.trainee.signed{border-color:var(--green)}
.trainee [hidden]{display:none!important}
.trainee .who{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.linkbtn{background:none;border:0;color:var(--blue);font:inherit;font-weight:700;cursor:pointer;text-decoration:underline;padding:0}
.gate-note{background:var(--yellow);color:var(--yellow-ink);border-radius:10px;padding:10px 14px;font-weight:700;margin:0 0 14px}
.sendnote{font-size:.92rem;color:var(--muted);margin-top:6px}
.sendnote.ok{color:var(--green)}
.sendnote.bad{color:var(--red)}
.whoami{font-size:.82rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:22ch}
.homelink{font-size:.85rem;font-weight:700;color:var(--muted);text-decoration:none;white-space:nowrap}
.homelink:hover{color:var(--ink);text-decoration:underline}
@media (max-width:560px){.homelink{display:none}}
@media (prefers-reduced-motion: reduce){*{transition:none!important}}""")

# ---------- header: home link + who's signed in ----------
rerep(r'<div class="brand">(.*?)</div>',
      lambda m: '<a class="brand" href="../" title="All LVG courses" style="color:inherit;text-decoration:none">%s</a>\n  <a class="homelink" href="../">&larr; All courses</a>' % m.group(1))
rep('<small id="progText">0 of 0 done</small>',
    '<small id="progText">0 of 0 done</small>\n    <small class="whoami" id="whoami"></small>')

# ---------- sign-in card on the welcome page ----------
rep('  <h3>How this course works</h3>', '''  <div id="gateNote" class="gate-note" hidden>Enter your name below to start the course.</div>
  <div class="trainee" id="traineeBox">
    <form id="traineeForm" novalidate>
      <h3>Who’s taking this course?</h3>
      <p>Your quiz scores and final check result go to Matt, so use your real name.</p>
      <div class="row">
        <label>Full name<input id="tName" autocomplete="name" required placeholder="First and last name"></label>
        <label>Work email<input id="tEmail" type="email" autocomplete="email" placeholder="you@leveragecompanies.com"></label>
      </div>
      <div class="quiz-actions"><button class="btn y" type="submit">Start the course</button></div>
      <div class="err" id="tErr" hidden></div>
    </form>
    <div class="who" id="traineeWho" hidden>
      <div><b id="whoName"></b><br><small id="whoEmail" style="color:var(--muted)"></small></div>
      <button class="linkbtn" id="notMe" type="button">Not you? Switch trainee</button>
    </div>
  </div>

  <h3>How this course works</h3>''')

# ---------- config ----------
rep("<script>\n(function(){", '<script src="../config.js"></script>\n<script>\n(function(){')

# ---------- state ----------
rep("let state = {done:[],checks:{},quiz:{}};", """const COURSE = {id: %r, name: %r, passMark: %d};
  const RESULTS_URL = (window.LVG_CONFIG && window.LVG_CONFIG.RESULTS_URL) || "";
  const PROFILE_KEY = "lvg-trainee-profile";
  let state = {done:[],checks:{},quiz:{},trainee:null,attempts:0,best:null,outbox:[]};""" % (course_id, course_name, pass_mark))

# ---------- reporting helpers (after save()) ----------
rep("  function save(){ try{ localStorage.setItem(KEY, JSON.stringify(state)); }catch(e){} }",
"""  function save(){ try{ localStorage.setItem(KEY, JSON.stringify(state)); }catch(e){} }

  // ---------- reporting to Matt ----------
  const QUIZ_KEYS = Object.keys(Q).filter(k=>k!=="exam");
  function quizTitle(k){ const b = document.querySelector('.quiz[data-quiz="'+k+'"]'); const sec = b && b.closest("section"); return (sec && sec.dataset.title) || k; }
  function snapshot(type, extra){
    const total = document.querySelectorAll("section.module").length;
    const quizzes = {};
    QUIZ_KEYS.forEach(k=>{ quizzes[k] = {right: (k in state.quiz) ? state.quiz[k] : null, total: Q[k].length, title: quizTitle(k)}; });
    return Object.assign({
      type, ts: new Date().toISOString(),
      course: COURSE.id, courseName: COURSE.name, passMark: COURSE.passMark, finalTotal: Q.exam ? Q.exam.length : null,
      id: state.trainee.id, name: state.trainee.name, email: state.trainee.email,
      modulesDone: state.done.length, modulesTotal: total,
      quizzes, attempts: state.attempts, best: state.best,
      page: location.href.split("#")[0]
    }, extra||{});
  }
  function post(payload){
    if(!RESULTS_URL) return Promise.reject(new Error("no-url"));
    // text/plain keeps this a "simple" request, so the browser skips the CORS preflight Apps Script can't answer
    return fetch(RESULTS_URL, {method:"POST", mode:"no-cors", headers:{"Content-Type":"text/plain;charset=utf-8"}, body: JSON.stringify(payload), keepalive:true});
  }
  function flush(){
    if(!state.outbox.length || !RESULTS_URL) return;
    state.outbox.slice().forEach(p=> post(p).then(()=>{ state.outbox = state.outbox.filter(x=>x.ts!==p.ts); save(); }).catch(()=>{}));
  }
  function report(type, extra){
    if(!state.trainee) return Promise.resolve(false);
    const p = snapshot(type, extra);
    return post(p).then(()=>true).catch(()=>{ state.outbox.push(p); state.outbox = state.outbox.slice(-20); save(); return false; });
  }""")
assert s.index("const Q = {") < s.index("const QUIZ_KEYS")

# ---------- gate navigation until signed in ----------
rep("  function show(id, scroll){\n", """  function show(id, scroll){
    if(!state.trainee && id!=="welcome"){ id = "welcome"; document.getElementById("gateNote").hidden = false; setTimeout(()=>document.getElementById("tName").focus(),0); }
""")

# ---------- module done ----------
rep("if(!state.done.includes(id)){ state.done.push(id); save(); }",
    'if(!state.done.includes(id)){ state.done.push(id); save(); report("progress",{event:"module-done",module:id}); }')

# ---------- quiz + final reporting ----------
Q_STR = r"'(?:[^'\\]|\\.)*'"
def exam_block(m):
    pass_html = re.sub(r"Tell Matt you passed, and (\w)", lambda x: x.group(1).upper(), m.group(2))
    fail_html = m.group(3)
    return """if(key==="exam"){
          const passed = right >= COURSE.passMark;
          state.attempts = (state.attempts||0) + 1;
          state.best = Math.max(state.best==null ? -1 : state.best, right);
          save();
          document.getElementById("examStamp").innerHTML = (passed ? %s : %s) + '<p class="sendnote" id="sendNote">Sending your result to Matt…</p>';
          report("final",{finalScore:right, finalTotal:qs.length, passed, attempts:state.attempts, best:state.best}).then(ok=>{
            const n = document.getElementById("sendNote"); if(!n) return;
            if(ok){ n.className = "sendnote ok"; n.textContent = "Your result was sent to Matt."; }
            else { n.className = "sendnote bad"; n.textContent = RESULTS_URL ? "Couldn’t reach the results server. It will retry next time you open the course." : "Results reporting isn’t set up yet. Tell Matt your score."; }
          });
        } else {
          report("progress",{event:"quiz", module:key, right, total:qs.length});
        }""" % (pass_html, fail_html)
rerep(r'if\(key==="exam"\)\{\s*document\.getElementById\("examStamp"\)\.innerHTML = right>=(\d+) \? (' + Q_STR + r') : (' + Q_STR + r');\s*\}', exam_block)

# ---------- trainee form + startup ----------
rep("  refreshProgress();\n  const start = ", """  // ---------- trainee ----------
  function readProfile(){ try{ return JSON.parse(localStorage.getItem(PROFILE_KEY)||"null"); }catch(e){ return null; } }
  function renderTrainee(){
    const t = state.trainee;
    document.getElementById("traineeForm").hidden = !!t;
    document.getElementById("traineeWho").hidden = !t;
    document.getElementById("traineeBox").classList.toggle("signed", !!t);
    document.getElementById("whoami").textContent = t ? t.name : "";
    if(t){
      document.getElementById("whoName").textContent = t.name;
      document.getElementById("whoEmail").textContent = t.email || "";
      document.getElementById("gateNote").hidden = true;
    } else {
      const p = readProfile();
      if(p){ document.getElementById("tName").value = p.name||""; document.getElementById("tEmail").value = p.email||""; }
    }
  }
  document.getElementById("traineeForm").addEventListener("submit",e=>{
    e.preventDefault();
    const name = document.getElementById("tName").value.trim().replace(/\\s+/g," ");
    const email = document.getElementById("tEmail").value.trim();
    const err = document.getElementById("tErr");
    if(name.split(" ").length < 2){ err.hidden = false; err.textContent = "Enter your first and last name."; document.getElementById("tName").focus(); return; }
    if(email && !/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)){ err.hidden = false; err.textContent = "That email doesn’t look right."; document.getElementById("tEmail").focus(); return; }
    err.hidden = true;
    const p = readProfile();
    const id = (p && p.name === name && p.id) ? p.id : (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())+Math.random().toString(16).slice(2));
    state.trainee = {name, email, id, started: new Date().toISOString()};
    try{ localStorage.setItem(PROFILE_KEY, JSON.stringify({name, email, id})); }catch(e){}
    save(); renderTrainee();
    report("progress",{event:"started"});
  });
  document.getElementById("notMe").addEventListener("click",()=>{
    if(!confirm("Switch trainee? This clears progress saved in this browser for "+state.trainee.name+". Their results already sent to Matt are kept.")) return;
    state = {done:[],checks:{},quiz:{},trainee:null,attempts:0,best:null,outbox:state.outbox};
    try{ localStorage.removeItem(PROFILE_KEY); }catch(e){}
    save(); location.hash = "welcome"; location.reload();
  });
  if(!Array.isArray(state.outbox)) state.outbox = [];
  renderTrainee();
  flush();
  refreshProgress();
  const start = """)

open(dst, "w", encoding="utf-8").write(s)
print("ok", dst, len(s))
