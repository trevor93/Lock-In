/* WAR ROOM — ALARM ENGINE + LIBRARY (real books reader) */

/* ================== ALARM ENGINE ================== */
const Alarm = {
  ctx: null, enabled: JSON.parse(localStorage.getItem('wr_alarm') || 'true'),
  volume: Number(localStorage.getItem('wr_volume') || 0.9),
  fired: JSON.parse(sessionStorage.getItem('wr_fired') || '{}'),

  init() {
    // Unlock audio on first touch (mobile requirement)
    const unlock = () => {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      document.removeEventListener('touchstart', unlock);
      document.removeEventListener('click', unlock);
    };
    document.addEventListener('touchstart', unlock);
    document.addEventListener('click', unlock);
    // Ask notification permission once
    if ('Notification' in window && Notification.permission === 'default') {
      setTimeout(() => Notification.requestPermission(), 3000);
    }
    setInterval(() => this.tick(), 15000);
  },

  // war-horn style alarm: 3 rising blasts, repeated
  ring(times = 3) {
    if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; } }
    const ctx = this.ctx;
    if (ctx.state === 'suspended') ctx.resume();
    let t = ctx.currentTime;
    for (let r = 0; r < times; r++) {
      [392, 523, 659].forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'square'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + r * 1.4 + i * 0.38);
        g.gain.exponentialRampToValueAtTime(this.volume, t + r * 1.4 + i * 0.38 + 0.04);
        g.gain.exponentialRampToValueAtTime(0.0001, t + r * 1.4 + i * 0.38 + 0.34);
        o.connect(g); g.connect(ctx.destination);
        o.start(t + r * 1.4 + i * 0.38); o.stop(t + r * 1.4 + i * 0.38 + 0.36);
      });
    }
    if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 700]);
  },

  notify(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        navigator.serviceWorker?.ready?.then(reg => reg.showNotification(title, {
          body, icon: '/static/icon.svg', badge: '/static/icon.svg',
          vibrate: [400, 150, 400], tag: 'warroom-block', renotify: true, requireInteraction: true
        })).catch(() => new Notification(title, { body }));
      } catch (e) { try { new Notification(title, { body }); } catch (_) {} }
    }
  },

  tick() {
    if (!this.enabled || !STATE) return;
    const t = nowTime();
    const today = todayStr();
    for (const b of (STATE.blocks || [])) {
      const key = today + '-' + b.id;
      // fire at block start (within the 15s tick window we compare minute strings)
      if (b.start_time === t && !this.fired[key]) {
        this.fired[key] = 1;
        sessionStorage.setItem('wr_fired', JSON.stringify(this.fired));
        this.ring(3);
        this.notify('⚔ ' + b.start_time + ' — ' + b.title, (b.is_non_negotiable ? 'NON-NEGOTIABLE. ' : '') + (b.description || 'The block has started. Move.'));
        this.banner(b);
      }
    }
    // refresh state so current-block view stays live
    loadState().then(() => { if (TAB === 'now') render(); }).catch(() => {});
  },

  banner(b) {
    const el = document.createElement('div');
    el.className = 'fixed inset-x-2 top-2 z-[200] card border-gold p-4 gold-glow fade-in';
    el.innerHTML = '<p class="text-[10px] font-bold tracking-[.2em] text-gold">⚔ BATTLE STATIONS — ' + b.start_time + '</p>' +
      '<p class="font-disp font-bold text-lg">' + esc(b.title) + '</p>' +
      '<p class="text-xs text-gray-400">' + esc(b.description || '') + '</p>' +
      '<div class="flex gap-2 mt-2">' +
      '<button class="btn flex-1 p-2 bg-gold/20 border border-gold/50 text-gold text-xs font-bold" onclick="this.closest(\'div.fixed\').remove();TAB=\'now\';render()">REPORTING FOR DUTY</button>' +
      '<button class="btn p-2 bg-gray-800 text-gray-400 text-xs border border-line" onclick="this.closest(\'div.fixed\').remove()">✕</button></div>';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 120000);
  },

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem('wr_alarm', JSON.stringify(this.enabled));
    toast(this.enabled ? 'War horns armed. No block will pass you unaware.' : 'War horns silenced. (Device calendar alarms still active if you exported.)', !this.enabled);
    render();
  }
};
Alarm.init();
window.Alarm = Alarm;

/* ================== LIBRARY (real books) ================== */
let LIBRARY = null, BOOK = null, BOOK_ID = null, CHAP_IDX = 0;

async function loadLibrary() { LIBRARY = (await axios.get('/api/library')).data; }

function viewLibrary() {
  if (BOOK) return viewReader();
  return header() +
  '<section id="library-section" class="stagger">' +
    '<p class="text-[10px] text-gray-500 mb-3">Official public-domain translations (Giles, Marriott, Long, Jowett, Common, Zimmern, Graham). The full actual books — every word, offline-cached after first read.</p>' +
    '<div class="card-glass p-3.5 mb-3">' +
      '<h3 class="text-[10px] font-bold tracking-[.2em] text-gold mb-1"><i class="fas fa-bell"></i> ALARMS & ENGAGEMENT</h3>' +
      '<div class="flex items-center justify-between py-1.5"><span class="text-xs">War-horn alarm at every block start</span>' +
      '<button class="btn px-3 py-1 text-[11px] font-bold ' + (Alarm.enabled ? 'bg-emerald-800 text-emerald-100' : 'bg-gray-800 text-gray-500 border border-line') + '" onclick="Alarm.toggle()">' + (Alarm.enabled ? 'ARMED' : 'OFF') + '</button></div>' +
      '<div class="flex items-center justify-between py-1.5"><span class="text-xs">Test the war horn</span>' +
      '<button class="btn px-3 py-1 text-[11px] font-bold bg-gold/20 border border-gold/50 text-gold" onclick="Alarm.ring(2)">SOUND IT</button></div>' +
      '<div class="flex items-center justify-between py-1.5"><span class="text-xs">Push notifications</span>' +
      '<button class="btn px-3 py-1 text-[11px] font-bold bg-sky-900/60 border border-sky-700 text-sky-200" onclick="Notification.requestPermission().then(p=>toast(p===\'granted\'?\'Notifications armed.\':\'Denied — enable in browser settings.\',p!==\'granted\'))">ENABLE</button></div>' +
      '<div class="flex items-center justify-between py-1.5"><span class="text-xs pr-2">Device calendar + native alarms (rings even when app is closed)</span>' +
      '<a class="btn px-3 py-1 text-[11px] font-bold bg-indigo-900/60 border border-indigo-700 text-indigo-200 shrink-0" href="/calendar.ics" download>EXPORT .ICS</a></div>' +
      '<p class="text-[9px] text-gray-600 mt-1">Import warroom.ics into Google Calendar / iPhone Calendar once — every block becomes a repeating native event with a 2-min-before alert. That is the bulletproof layer: your phone itself becomes the war horn.</p>' +
    '</div>' +
    '<div class="sect">THE ARSENAL — ' + LIBRARY.length + ' COMPLETE TEXTS</div>' +
    LIBRARY.map(b => {
      const total = b.chapters || 0;
      const pct = total ? Math.round((b.chaptersDone / total) * 100) : 0;
      const finished = total > 0 && b.chaptersDone >= total;
      return '<button class="' + (finished ? 'card-lux' : 'card') + ' w-full p-3.5 mb-2 text-left flex items-center gap-3" onclick="openBook(\'' + b.id + '\')">' +
        '<div class="w-10 h-12 rounded-md flex items-center justify-center shrink-0" style="background:linear-gradient(160deg,' + (b.phase === 'PHIL' ? '#1e1b4b,#0f0d26' : '#4c0519,#1c0208') + ');border:1px solid ' + (b.phase === 'PHIL' ? 'rgba(129,140,248,.35)' : 'rgba(244,63,94,.35)') + ';box-shadow:inset 0 1px 0 rgba(255,255,255,.08)">' +
          (finished ? '<i class="fas fa-crown text-gold"></i>' : '<i class="fas fa-book ' + (b.phase === 'PHIL' ? 'text-indigo-400' : 'text-rose-400') + '"></i>') +
        '</div>' +
        '<div class="flex-1 min-w-0">' +
          '<p class="text-sm font-bold ' + (finished ? 'gold-text' : 'text-white') + '">' + esc(b.title) + '</p>' +
          '<p class="text-[10px] text-gray-500 mb-1">' + esc(b.author) + ' · <span class="pill ' + (b.phase === 'PHIL' ? 'bg-indigo-950 text-indigo-300' : 'bg-rose-950 text-rose-300') + '">' + b.phase + '</span></p>' +
          '<div class="prog" style="height:5px"><div style="width:' + pct + '%"></div></div>' +
        '</div>' +
        '<div class="text-right shrink-0">' +
          '<p class="font-disp font-bold ' + (finished ? 'text-gold' : 'text-gray-300') + '">' + b.chaptersDone + '<span class="text-gray-600 text-[10px]">/' + total + '</span></p>' +
          '<p class="text-[8px] text-gray-600 font-bold tracking-widest">' + (finished ? 'CONQUERED' : pct + '%') + '</p>' +
        '</div>' +
      '</button>';
    }).join('') +
  '</section>';
}

async function openBook(id) {
  toast('Opening the real text…');
  BOOK = (await axios.get('/static/books/' + id + '.json')).data;
  BOOK_ID = id;
  const lib = LIBRARY.find(x => x.id === id);
  CHAP_IDX = lib && lib.currentChapter != null ? lib.currentChapter : 0;
  render();
  window.scrollTo(0, 0);
}

function viewReader() {
  const ch = BOOK.chapters[CHAP_IDX];
  const chPct = Math.round(((CHAP_IDX + 1) / BOOK.chapters.length) * 100);
  return '<header class="flex items-center gap-2 mb-1 sticky top-0 py-2 z-40" style="background:linear-gradient(180deg,var(--ink-1) 75%,transparent)">' +
    '<button class="btn btn-ghost px-3 py-2 text-xs" onclick="FX.tap();BOOK=null;loadLibrary().then(render)"><i class="fas fa-arrow-left"></i></button>' +
    '<div class="flex-1 min-w-0"><p class="text-xs font-bold truncate text-white">' + esc(BOOK.title) + '</p>' +
    '<p class="text-[9px] text-gray-500">' + esc(BOOK.author) + ' · tr. ' + esc(BOOK.translator) + '</p></div>' +
    '<select class="!w-auto text-xs" onchange="CHAP_IDX=Number(this.value);render();window.scrollTo(0,0)">' +
      BOOK.chapters.map((c, i) => '<option value="' + i + '" ' + (i === CHAP_IDX ? 'selected' : '') + '>' + esc(c.title.slice(0, 40)) + '</option>').join('') +
    '</select>' +
  '</header>' +
  '<div class="prog mb-4" style="height:4px"><div style="width:' + chPct + '%"></div></div>' +
  '<article id="reader" class="fade-in px-1">' +
    '<div class="text-center mb-5">' +
      '<p class="text-[9px] text-gray-600 font-bold tracking-[.3em] mb-1">CHAPTER ' + (CHAP_IDX + 1) + ' OF ' + BOOK.chapters.length + '</p>' +
      '<h2 class="font-engraved font-bold text-lg gold-text">' + esc(ch.title) + '</h2>' +
      '<div class="mx-auto mt-2" style="width:80px;height:1px;background:linear-gradient(90deg,transparent,var(--gold),transparent)"></div>' +
    '</div>' +
    ch.paras.map((p, i) => '<p class="text-[13.5px] leading-[1.85] text-gray-300 mb-3.5" style="text-align:justify">' + (i === 0 ? '<span class="font-engraved text-2xl gold-text float-left mr-1.5 leading-none mt-0.5">' + esc(p.charAt(0)) + '</span>' + esc(p.slice(1)) : esc(p)) + '</p>').join('') +
    '<div class="card-lux p-4 my-5 text-center">' +
      '<button class="btn btn-gold w-full p-3 text-sm" onclick="finishChapter()"><i class="fas fa-check mr-1"></i> CHAPTER CONQUERED (+20) → NEXT</button>' +
      '<p class="text-[9px] text-gray-600 mt-2">Slow reading is deep reading. Mark done only when you truly finished — the honesty engine trusts you here.</p>' +
    '</div>' +
  '</article>';
}

async function finishChapter() {
  await api('post', '/api/library/' + BOOK_ID + '/chapter/' + CHAP_IDX, { status: 'done', date: todayStr() });
  FX.confetti({count:60}); FX.toast('CHAPTER CONQUERED  +20','gold');
  if (CHAP_IDX < BOOK.chapters.length - 1) {
    CHAP_IDX++;
    await api('post', '/api/library/' + BOOK_ID + '/chapter/' + CHAP_IDX, { status: 'reading' });
    render(); window.scrollTo(0, 0);
  } else {
    FX.confetti({count:180}); FX.toast('📕 BOOK COMPLETE — ' + BOOK.title + ' is now inside you','gold');
    BOOK = null; await loadLibrary(); render();
  }
}

window.openBook = openBook; window.finishChapter = finishChapter;
window.viewLibrary = viewLibrary; window.loadLibrary = loadLibrary;
