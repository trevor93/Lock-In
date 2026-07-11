/* WAR ROOM — Debrief + Stats */
function viewDebrief(){
  const d=STATE.debrief||{};
  return header()+
  '<section id="debrief-section" class="fade-in">'+
    '<h2 class="font-disp font-bold text-sm tracking-widest text-gray-400 mb-1"><i class="fas fa-pen-nib text-fuchsia-400"></i> NIGHT DEBRIEF — '+todayStr()+'</h2>'+
    '<p class="text-[10px] text-gray-500 mb-3">The single highest-leverage habit in this system. 10 minutes. Marcus Aurelius did this 1,900 years ago. Missing it triggers the honesty engine.</p>'+
    '<div class="card p-3 mb-3">'+
      '<label class="text-[10px] font-bold tracking-widest text-emerald-400">WHAT DID I WIN TODAY?</label>'+
      '<textarea id="db-wins" rows="2" class="mb-2">'+esc(d.wins||'')+'</textarea>'+
      '<label class="text-[10px] font-bold tracking-widest text-red-400">WHERE DID I BREAK THE SCHEDULE — AND WHY, HONESTLY?</label>'+
      '<textarea id="db-breaks" rows="2" class="mb-2">'+esc(d.breaks||'')+'</textarea>'+
      '<label class="text-[10px] font-bold tracking-widest text-gold">TOMORROW\'S 3 TARGETS (Law 4 — decide tonight)</label>'+
      '<textarea id="db-targets" rows="3" placeholder="1.&#10;2.&#10;3." class="mb-2">'+esc(d.tomorrow_targets||'')+'</textarea>'+
      '<label class="text-[10px] font-bold tracking-widest text-rose-400">STRATEGY INSIGHT — one principle I saw or used today</label>'+
      '<textarea id="db-insight" rows="2" class="mb-2">'+esc(d.strategy_insight||'')+'</textarea>'+
      '<div class="grid grid-cols-2 gap-2 mb-2">'+
        '<div><label class="text-[10px] font-bold text-gray-400">MOOD (1-5)</label><input type="number" id="db-mood" min="1" max="5" value="'+(d.mood||'')+'"></div>'+
        '<div><label class="text-[10px] font-bold text-gray-400">ENERGY (1-5)</label><input type="number" id="db-energy" min="1" max="5" value="'+(d.energy||'')+'"></div>'+
      '</div>'+
      '<div class="grid grid-cols-3 gap-2 mb-3">'+
        '<div><label class="text-[10px] font-bold text-gray-400">WOKE AT</label><input type="time" id="db-wake" value="'+(d.wake_time||'')+'"></div>'+
        '<div><label class="text-[10px] font-bold text-gray-400">LIGHTS OUT</label><input type="time" id="db-sleep" value="'+(d.sleep_time||'')+'"></div>'+
        '<div><label class="text-[10px] font-bold text-gray-400">SLEPT (h)</label><input type="number" step="0.25" id="db-hours" value="'+(d.sleep_hours||'')+'"></div>'+
      '</div>'+
      '<button class="btn w-full p-3 bg-fuchsia-900/50 border border-fuchsia-700 text-fuchsia-200 text-sm font-bold" onclick="saveDebrief()"><i class="fas fa-file-shield mr-1"></i> FILE INTELLIGENCE REPORT (+25)</button>'+
    '</div>'+
    rewardsPanel()+
    '<h3 class="font-disp font-bold text-sm tracking-widest text-gray-400 mt-4 mb-2">PAST REPORTS ('+DEBRIEFS.length+')</h3>'+
    DEBRIEFS.slice(0,14).map(x=>
      '<details class="card p-3 mb-2">'+
        '<summary class="text-xs font-bold cursor-pointer">'+x.log_date+(x.sleep_hours?' · '+x.sleep_hours+'h sleep':'')+(x.mood?' · mood '+x.mood+'/5':'')+'</summary>'+
        '<div class="mt-2 text-[11px] text-gray-400 space-y-1">'+
          (x.wins?'<p><span class="text-emerald-400 font-bold">WINS:</span> '+nl2br(x.wins)+'</p>':'')+
          (x.breaks?'<p><span class="text-red-400 font-bold">BREAKS:</span> '+nl2br(x.breaks)+'</p>':'')+
          (x.tomorrow_targets?'<p><span class="text-gold font-bold">TARGETS:</span> '+nl2br(x.tomorrow_targets)+'</p>':'')+
          (x.strategy_insight?'<p><span class="text-rose-400 font-bold">INSIGHT:</span> '+nl2br(x.strategy_insight)+'</p>':'')+
        '</div>'+
      '</details>').join('')+
  '</section>';
}

function rewardsPanel(){
  if(!REWARDS){ axios.get('/api/rewards').then(r=>{REWARDS=r.data; if(TAB==='debrief')render();}); return ''; }
  return '<div class="card p-3">'+
    '<h3 class="text-[10px] font-bold tracking-widest text-gray-400 mb-2"><i class="fas fa-trophy text-gold"></i> REWARDS — EARNED, NEVER GIVEN (you have <span class="text-gold font-bold">'+STATE.points+'</span> pts)</h3>'+
    REWARDS.map(r=>
      '<div class="flex items-center gap-2 py-1.5 border-b border-line/50 last:border-0">'+
        '<div class="flex-1"><p class="text-xs font-semibold">'+esc(r.title)+'</p><p class="text-[10px] text-gray-500">'+esc(r.description||'')+(r.redeemed_count?' · taken ×'+r.redeemed_count:'')+'</p></div>'+
        '<button class="btn px-3 py-1.5 text-[11px] font-bold '+(STATE.points>=r.cost?'bg-gold/20 border border-gold/50 text-gold':'bg-gray-800 text-gray-600 border border-line')+'" onclick="redeem('+r.id+')">'+r.cost+'</button>'+
      '</div>').join('')+
  '</div>';
}

async function redeem(id){
  await api('post','/api/rewards/'+id+'/redeem',{date:todayStr()});
  toast('Reward claimed. You paid for it in discipline — enjoy it fully, zero guilt.');
  REWARDS=(await axios.get('/api/rewards')).data; await loadState(); render();
}

async function saveDebrief(){
  const b={date:todayStr(),wins:$('#db-wins').value,breaks:$('#db-breaks').value,tomorrow_targets:$('#db-targets').value,
    strategy_insight:$('#db-insight').value,mood:Number($('#db-mood').value)||null,energy:Number($('#db-energy').value)||null,
    wake_time:$('#db-wake').value||null,sleep_time:$('#db-sleep').value||null,sleep_hours:Number($('#db-hours').value)||null};
  if(!b.wins&&!b.breaks&&!b.tomorrow_targets){ toast('An empty report is a lie of omission. Write something true.',true); return; }
  if(!b.tomorrow_targets){ toast('Law 4: tomorrow\'s 3 targets are NOT optional. Decide tonight.',true); return; }
  await api('post','/api/debrief',b);
  toast('Intelligence report filed. Tomorrow already knows its orders.');
  DEBRIEFS=(await axios.get('/api/debriefs')).data; await loadState(); render();
}

/* ============ STATS ============ */
function viewStats(){
  const s=STATS;
  const avg=Math.round(s.days.reduce((a,d)=>a+d.pct,0)/s.days.length);
  const sleepDays=s.days.filter(d=>d.sleep!=null);
  const avgSleep=sleepDays.length?(sleepDays.reduce((a,d)=>a+d.sleep,0)/sleepDays.length).toFixed(1):'—';
  const catName={morning:'Morning',workout:'Exercise',deepwork:'Deep Work',study:'University',meal:'Meals',strategy:'Strategy',philosophy:'Philosophy',entertainment:'Entertainment',skincare:'Skincare',admin:'Admin',social:'Social',review:'Review',sleep:'Sleep',flex:'Recovery',rest:'Rest'};
  return header()+
  '<section id="stats-section" class="fade-in">'+
    '<div class="grid grid-cols-3 gap-2 mb-3">'+
      '<div class="card p-3 text-center"><p class="font-disp font-bold text-xl '+(avg>=80?'text-jade':avg>=50?'text-amber-400':'text-red-400')+'">'+avg+'%</p><p class="text-[9px] text-gray-500 font-bold">14-DAY ADHERENCE</p></div>'+
      '<div class="card p-3 text-center"><p class="font-disp font-bold text-xl text-sky-400">'+avgSleep+'h</p><p class="text-[9px] text-gray-500 font-bold">AVG SLEEP</p></div>'+
      '<div class="card p-3 text-center"><p class="font-disp font-bold text-xl text-rose-400">'+(s.unitStats.complete||0)+'/'+(s.unitStats.total||0)+'</p><p class="text-[9px] text-gray-500 font-bold">UNITS WON</p></div>'+
    '</div>'+
    '<div class="card p-3 mb-3">'+
      '<h3 class="text-[10px] font-bold tracking-widest text-gray-400 mb-2">LAST 14 DAYS (green = victory day: ≥80% + debrief)</h3>'+
      '<div class="flex items-end gap-1" style="height:70px">'+
        s.days.map(d=>'<div class="flex-1 flex flex-col items-center gap-0.5">'+
          '<div class="w-full rounded-t" style="height:'+Math.max(d.pct,3)*0.6+'px;background:'+(d.pct>=80&&d.debrief?'#22c55e':d.pct>=50?'#f59e0b':d.total===0?'#1e2a3d':'#dc2626')+'"></div>'+
          '<span class="text-[7px] text-gray-600">'+d.date.slice(8)+'</span></div>').join('')+
      '</div>'+
    '</div>'+
    '<div class="card p-3 mb-3">'+
      '<h3 class="text-[10px] font-bold tracking-widest text-gray-400 mb-2">7-DAY OUTPUT BY FRONT</h3>'+
      (s.categories.length?s.categories.map(cr=>{
        const pct=cr.total?Math.round((cr.done/cr.total)*100):0;
        return '<div class="mb-1.5"><div class="flex justify-between text-[10px] mb-0.5"><span class="cat-'+cr.category+' font-semibold">'+(catName[cr.category]||cr.category)+'</span><span class="text-gray-500">'+pct+'%</span></div><div class="prog"><div class="cat-'+cr.category+'" style="width:'+pct+'%;background:currentColor"></div></div></div>';
      }).join(''):'<p class="text-[11px] text-gray-500">No logs yet. Start checking off blocks.</p>')+
    '</div>'+
    '<div class="card p-3 mb-3">'+
      '<h3 class="text-[10px] font-bold tracking-widest text-gray-400 mb-2">MIND FORGE</h3>'+
      '<p class="text-[11px] text-gray-400">Flashcard reviews: <span class="text-gold font-bold">'+(s.cardStats.reviews||0)+'</span> · avg recall grade: <span class="text-gold font-bold">'+(s.cardStats.avg_grade?Number(s.cardStats.avg_grade).toFixed(2):'—')+'</span>/3</p>'+
      (s.flagCounts.length
        ?'<p class="text-[11px] text-gray-400 mt-1">Honesty flags all-time: '+s.flagCounts.map(f=>'<span class="text-red-400">'+f.flag_type.replace(/_/g,' ')+' ×'+f.n+'</span>').join(' · ')+'</p>'
        :'<p class="text-[11px] text-jade mt-1">Zero honesty flags. Clean record, soldier.</p>')+
    '</div>'+
    '<div class="card p-3">'+
      '<h3 class="text-[10px] font-bold tracking-widest text-gray-400 mb-2">POINTS LEDGER (latest)</h3>'+
      (s.ledger.slice(0,25).map(l=>
        '<div class="flex gap-2 py-1 border-b border-line/40 last:border-0 text-[10px]">'+
          '<span class="font-bold w-9 text-right '+(l.points>=0?'text-jade':'text-red-400')+'">'+(l.points>=0?'+':'')+l.points+'</span>'+
          '<span class="text-gray-400 flex-1">'+esc(l.reason)+'</span>'+
          '<span class="text-gray-600 shrink-0">'+l.log_date.slice(5)+'</span>'+
        '</div>').join('')||'<p class="text-[11px] text-gray-500">Empty. Go earn.</p>')+
    '</div>'+
  '</section>';
}

window.redeem=redeem; window.saveDebrief=saveDebrief;
