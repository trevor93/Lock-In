/* WAR ROOM — frontend */
const $ = (s) => document.querySelector(s);
const app = () => $('#app');
let TAB = 'now';
let STATE = null;

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
const nowTime = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nl2br = (s) => esc(s).replace(/\n/g,'<br>');

const CAT_ICON = { morning:'fa-sun', workout:'fa-dumbbell', deepwork:'fa-crosshairs', study:'fa-graduation-cap',
  meal:'fa-utensils', strategy:'fa-chess-knight', philosophy:'fa-book-open', entertainment:'fa-gamepad',
  skincare:'fa-droplet', admin:'fa-list-check', social:'fa-people-group', review:'fa-pen-nib',
  sleep:'fa-moon', flex:'fa-wind', rest:'fa-leaf' };

async function api(method, url, data) {
  try {
    const r = await axios({ method, url, data });
    return r.data;
  } catch (e) {
    const msg = e?.response?.data?.error || 'Request failed';
    toast(msg, true);
    throw e;
  }
}

function toast(msg, bad=false) {
  const t = document.createElement('div');
  t.className = `fixed top-3 left-3 right-3 z-[100] p-3 rounded-xl text-sm font-semibold fade-in ${bad?'bg-red-950 border border-red-700 text-red-200':'bg-emerald-950 border border-emerald-700 text-emerald-200'}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), bad?5000:2500);
}

async function loadState() {
  STATE = (await axios.get(`/api/state?date=${todayStr()}&time=${nowTime()}`)).data;
}

function shell(content) {
  const tabs = [
    ['now','fa-crosshairs','NOW'],
    ['today','fa-calendar-day','DAY'],
    ['campaign','fa-chess-board','WAR'],
    ['library','fa-book-bookmark','BOOKS'],
    ['council','fa-user-secret','COUNCIL'],
    ['mind','fa-brain','MIND'],
    ['debrief','fa-pen-nib','LOG'],
    ['stats','fa-chart-line','STATS'],
  ];
  app().innerHTML = `
    <main class="max-w-lg mx-auto px-3 pt-3 pb-28">${content}</main>
    <nav class="tabbar flex max-w-lg mx-auto" id="main-nav">
      ${tabs.map(([id,ic,label])=>`
        <button class="tab-btn ${TAB===id?'active':''}" data-tab="${id}">
          <i class="fas ${ic}"></i>${label}
        </button>`).join('')}
    </nav>`;
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{ TAB=b.dataset.tab; render(); });
}

function header() {
  const s = STATE;
  const flagCount = s.flags.length;
  return `
  <header class="flex items-center justify-between mb-3">
    <div>
      <h1 class="font-disp font-bold text-xl tracking-widest text-gold">⚔ WAR ROOM</h1>
      <p class="text-[11px] text-gray-500">${new Date().toDateString()}</p>
    </div>
    <div class="flex gap-2 text-center">
      <div class="card px-2.5 py-1.5">
        <div class="font-disp font-bold text-base ${s.streak>0?'text-orange-400':'text-gray-500'}"><i class="fas fa-fire text-xs"></i> ${s.streak}</div>
        <div class="text-[9px] text-gray-500 font-semibold">STREAK</div>
      </div>
      <div class="card px-2.5 py-1.5">
        <div class="font-disp font-bold text-base text-gold">${s.points}</div>
        <div class="text-[9px] text-gray-500 font-semibold">POINTS</div>
      </div>
      <div class="card px-2.5 py-1.5 ${flagCount?'border-red-800':''}">
        <div class="font-disp font-bold text-base ${flagCount?'text-red-400':'text-jade'}">${flagCount?flagCount:'✓'}</div>
        <div class="text-[9px] text-gray-500 font-semibold">FLAGS</div>
      </div>
    </div>
  </header>`;
}

function flagsPanel() {
  if (!STATE.flags.length) return '';
  return `
  <section id="honesty-flags" class="mb-3 fade-in">
    <h2 class="font-disp font-bold text-sm tracking-widest text-red-400 mb-1.5"><i class="fas fa-triangle-exclamation"></i> HONESTY ENGINE — UNRESOLVED</h2>
    ${STATE.flags.map(f=>`
      <article class="card sev-${f.severity} p-3 mb-2">
        <p class="text-xs leading-relaxed text-gray-300">${esc(f.message)}</p>
        <button class="btn mt-2 text-[11px] px-3 py-1.5 bg-gray-800 text-gray-300 border border-line" onclick="ackFlag(${f.id})">
          <i class="fas fa-check mr-1"></i>ACKNOWLEDGED — I OWN IT
        </button>
      </article>`).join('')}
  </section>`;
}
async function ackFlag(id){ await api('post',`/api/flags/${id}/ack`); await loadState(); render(); }

/* ================= NOW TAB ================= */
function statusBtns(b, compact=false) {
  const st = b.log_status;
  const mk = (val, ic, cls, active) => `
    <button class="btn ${compact?'px-2.5 py-1.5 text-[11px]':'px-3 py-2 text-xs'} ${active?cls:'bg-gray-800/60 text-gray-500 border border-line'}"
      onclick="logBlock(${b.id},'${st===val?'pending':val}')"><i class="fas ${ic}"></i></button>`;
  return `<div class="flex gap-1.5">
    ${mk('done','fa-check','bg-emerald-700 text-white', st==='done')}
    ${mk('partial','fa-star-half-stroke','bg-amber-600 text-white', st==='partial')}
    ${mk('skipped','fa-xmark','bg-red-800 text-white', st==='skipped')}
  </div>`;
}
async function logBlock(id, status){
  await api('post',`/api/blocks/${id}/log`,{date:todayStr(),status});
  await loadState(); render();
}

function viewNow() {
  const s = STATE, c = s.current, n = s.next;
  const adh = s.adherence;
  const adhColor = adh.pct>=80?'#22c55e':adh.pct>=50?'#f59e0b':'#dc2626';
  return `${header()}${flagsPanel()}
  <section id="now-section" class="fade-in">
    ${s.yesterdayTargets?`
    <div class="card p-3 mb-3 border-gold/30">
      <h3 class="text-[10px] font-bold tracking-widest text-gold mb-1"><i class="fas fa-bullseye"></i> TODAY'S 3 TARGETS (set last night — Law 4)</h3>
      <p class="text-xs text-gray-300 leading-relaxed">${nl2br(s.yesterdayTargets)}</p>
    </div>`:`
    <div class="card p-3 mb-3 border-amber-800/50">
      <p class="text-xs text-amber-400"><i class="fas fa-triangle-exclamation"></i> No targets set last night. You woke up without orders — Law 4 violated. Set tonight's targets in the Debrief tab.</p>
    </div>`}

    ${c?`
    <article class="card now-ring p-5 mb-3 text-center border-gold/40">
      <p class="text-[10px] font-bold tracking-[.25em] text-gold mb-1">RIGHT NOW · ${c.start_time}–${c.end_time}</p>
      <i class="fas ${CAT_ICON[c.category]||'fa-circle'} cat-${c.category} text-2xl mb-2"></i>
      <h2 class="font-disp font-bold text-2xl leading-tight mb-1">${esc(c.title)}</h2>
      <p class="text-xs text-gray-400 leading-relaxed mb-3">${esc(c.description||'')}</p>
      ${c.is_non_negotiable?'<span class="pill bg-red-950 text-red-400 border border-red-800 mb-3 inline-block">NON-NEGOTIABLE</span>':''}
      <div class="flex justify-center">${statusBtns(c)}</div>
    </article>`:`
    <article class="card p-5 mb-3 text-center">
      <i class="fas fa-moon text-2xl text-blue-400 mb-2"></i>
      <h2 class="font-disp font-bold text-xl">OFF THE CLOCK</h2>
      <p class="text-xs text-gray-500">No scheduled block right now. If it's late — you should be asleep, soldier.</p>
    </article>`}

    ${n?`
    <div class="card p-3 mb-3 flex items-center gap-3">
      <i class="fas ${CAT_ICON[n.category]||'fa-circle'} cat-${n.category}"></i>
      <div class="flex-1">
        <p class="text-[10px] text-gray-500 font-bold tracking-widest">NEXT · ${n.start_time}</p>
        <p class="text-sm font-semibold">${esc(n.title)}</p>
      </div>
    </div>`:''}

    <div class="card p-3 mb-3">
      <div class="flex justify-between items-baseline mb-1.5">
        <h3 class="text-[10px] font-bold tracking-widest text-gray-400">TODAY'S ADHERENCE (target: 80% — Law 6)</h3>
        <span class="font-disp font-bold text-lg" style="color:${adhColor}">${adh.pct}%</span>
      </div>
      <div class="prog"><div style="width:${adh.pct}%;background:${adhColor}"></div></div>
      <p class="text-[10px] text-gray-500 mt-1">${adh.done} / ${adh.total} blocks · today's points: <span class="${s.todayPoints>=0?'text-jade':'text-red-400'}">${s.todayPoints>=0?'+':''}${s.todayPoints}</span></p>
    </div>

    ${s.activeUnits.length?`
    <div class="card p-3 mb-3">
      <h3 class="text-[10px] font-bold tracking-widest text-gray-400 mb-2"><i class="fas fa-chess-knight text-rose-400"></i> ACTIVE FRONTS</h3>
      ${s.activeUnits.map(u=>`
        <button class="w-full text-left flex items-center gap-2 py-1.5 border-b border-line/50 last:border-0" onclick="TAB='campaign';render()">
          <span class="pill ${u.track==='strategy'?'bg-rose-950 text-rose-300':'bg-indigo-950 text-indigo-300'}">${u.code}</span>
          <span class="text-xs flex-1">${esc(u.title)}</span>
          <span class="text-[9px] text-gray-500">${u.status.replace('_',' ').toUpperCase()}</span>
        </button>`).join('')}
    </div>`:''}

    ${s.dueCards>0?`
    <button class="btn w-full p-3 bg-gold/10 border border-gold/40 text-gold text-sm font-bold" onclick="TAB='mind';render()">
      <i class="fas fa-layer-group mr-1"></i> ${s.dueCards} FLASHCARD${s.dueCards>1?'S':''} DUE — DRILL THE PRINCIPLES
    </button>`:''}
  </section>`;
}

/* ================= TODAY TAB ================= */
let LAWS_CACHE = null;
function viewToday() {
  return `${header()}
  <section id="today-schedule" class="fade-in">
    <h2 class="font-disp font-bold text-sm tracking-widest text-gray-400 mb-2">FULL DAY PLAN — ${dowLabel()}</h2>
    ${STATE.blocks.map(b=>{
      const isNow = STATE.current && STATE.current.id===b.id;
      const done = b.log_status==='done', part = b.log_status==='partial', skip = b.log_status==='skipped';
      return `
      <article class="card p-3 mb-2 ${isNow?'border-gold/50':''} ${done?'opacity-60':''}">
        <div class="flex items-center gap-2.5">
          <div class="text-center w-11 shrink-0">
            <p class="font-disp font-bold text-xs ${isNow?'text-gold':'text-gray-400'}">${b.start_time}</p>
            <p class="text-[9px] text-gray-600">${b.end_time}</p>
          </div>
          <i class="fas ${CAT_ICON[b.category]||'fa-circle'} cat-${b.category} text-sm w-4"></i>
          <div class="flex-1 min-w-0">
            <p class="text-xs font-semibold ${done?'line-through':''} ${skip?'text-red-400':''}">${esc(b.title)}
              ${b.is_non_negotiable?'<i class="fas fa-lock text-[8px] text-red-500 ml-1"></i>':''}
            </p>
            <p class="text-[10px] text-gray-500">+${b.points} pts ${part?'· partial':''}</p>
          </div>
          ${statusBtns(b, true)}
        </div>
        ${isNow?'<p class="text-[9px] text-gold font-bold tracking-widest mt-1.5 text-center">◄ YOU ARE HERE ►</p>':''}
      </article>`;
    }).join('')}
    <div id="laws-panel" class="mt-4">${LAWS_CACHE?renderLaws():'<button class="btn w-full p-3 bg-panel border border-line text-sm" onclick="loadLaws()"><i class="fas fa-scale-balanced mr-1 text-gold"></i> CHECK THE 7 LAWS (tonight)</button>'}</div>
  </section>`;
}
function dowLabel(){ return ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'][new Date().getDay()]; }
async function loadLaws(){ LAWS_CACHE = (await axios.get(`/api/laws?date=${todayStr()}`)).data; render(); }
function renderLaws() {
  return `
  <h2 class="font-disp font-bold text-sm tracking-widest text-gray-400 mb-2"><i class="fas fa-scale-balanced text-gold"></i> THE 7 LAWS — DID THEY HOLD TODAY?</h2>
  ${LAWS_CACHE.map(l=>`
    <article class="card p-3 mb-2">
      <div class="flex items-start gap-2">
        <span class="font-disp font-bold text-gold text-lg leading-none">${l.sort_order}</span>
        <div class="flex-1">
          <p class="text-xs font-bold">${esc(l.title)}</p>
          <p class="text-[10px] text-gray-500 leading-relaxed">${esc(l.detail)}</p>
        </div>
        <div class="flex gap-1.5">
          <button class="btn px-2.5 py-1.5 text-[11px] ${l.kept===1?'bg-emerald-700 text-white':'bg-gray-800/60 text-gray-500 border border-line'}" onclick="checkLaw(${l.id},true)"><i class="fas fa-check"></i></button>
          <button class="btn px-2.5 py-1.5 text-[11px] ${l.kept===0?'bg-red-800 text-white':'bg-gray-800/60 text-gray-500 border border-line'}" onclick="checkLaw(${l.id},false)"><i class="fas fa-xmark"></i></button>
        </div>
      </div>
    </article>`).join('')}`;
}
async function checkLaw(id, kept){
  await api('post',`/api/laws/${id}/check`,{date:todayStr(),kept});
  await loadLaws();
}

window.ackFlag=ackFlag; window.logBlock=logBlock; window.loadLaws=loadLaws; window.checkLaw=checkLaw;

/* render dispatcher — extended by app2.js */
function render() {
  if (TAB==='now') shell(viewNow());
  else if (TAB==='today') shell(viewToday());
  else if (window.renderExtra) window.renderExtra(TAB);
}
window.render = render;

(async function init(){
  try { await loadState(); render(); }
  catch(e){ app().innerHTML = `<div class="p-6 text-center text-red-400 text-sm">Failed to load the war room. Pull to refresh.<br>${esc(e.message||'')}</div>`; }
  setInterval(async ()=>{ if(TAB==='now'||TAB==='today'){ try{ await loadState(); render(); }catch(_){} } }, 60000);
})();
