// ===== util =====
const $  = (sel, el=document) => el.querySelector(sel);
const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
let _seed = Date.now() % 2147483647;
function rnd(){ _seed = (_seed*48271)%2147483647; return _seed/2147483647 }
function randn(mean=0, sigma=1){ const u=1-rnd(), v=1-rnd(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)*sigma + mean; }
function samplePoisson(lambda){ const L=Math.exp(-lambda); let k=0,p=1; do{ k++; p*=rnd(); }while(p>L); return k-1; }
function initials(name){ return name.split(/\s+/).map(s=>s[0]).join('').slice(0,3).toUpperCase(); }

// ===== storage =====
const STORAGE_KEY = "clots-manager-v3";
function loadState(){
  try{ const raw = localStorage.getItem(STORAGE_KEY); if(raw) return JSON.parse(raw); }catch(e){}
  return null;
}
function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); render(); }
function clearAll(){
  if(!confirm("Tem certeza que deseja limpar TODOS os dados?")) return;
  localStorage.removeItem(STORAGE_KEY);
  state = seedTeams(); saveState();
}

// ===== initial data =====
function seedTeams(){
  const A = ["Lany","Cornixho","Pika","Cloni","Ameno","Monk","Glokk","Pau","A01","FF"];
  const B = ["Sexo","Foger","Remo","FDS","Pila","Ameroca","Amor","Ploca","Stone","Del Zap"];
  const C = ["City","Light","Freezer","Heand","Red Hot","Kira","Tu Zap","Pinko","Block","Lanus"];
  function mk(arr, base){
    return arr.map(n=>({
      id: crypto.randomUUID(), name:n, rating: Math.round((base+randn(0,6))*10)/10,
      titles:{A:0,B:0,C:0}, cupTitles:0, logo:null
    }));
  }
  return {
    season: 1,
    config: { avgGoals: 2.7, homeEdge: 0.12, perfSigma: 0.08, seasonSigma: 0.05, playoffs:false, theme:'ocean' },
    divisions: [
      { code:"A", name:"Divisão A", teams: mk(A,82), fixtures:[], round:0, table:[] },
      { code:"B", name:"Divisão B", teams: mk(B,76), fixtures:[], round:0, table:[] },
      { code:"C", name:"Divisão C", teams: mk(C,70), fixtures:[], round:0, table:[] },
    ],
    cup: { rounds:[], alive:[], stage:0, seasonOf: 0, champion:null, perDivision: 16, locked:true },
    history: []
  };
}

// ===== sanity =====
function sanityCheck(autoFix=true){
  let repaired=false;
  for(const d of state.divisions){
    if(!Array.isArray(d.teams)) d.teams=[];
    d.teams=d.teams.filter(t=>t&&t.id&&t.name);
    if(!Array.isArray(d.fixtures)) d.fixtures=[];
    if(typeof d.round!=='number') d.round=0;
    if(!Array.isArray(d.table)) d.table=[];
  }
  if(repaired&&autoFix) saveState();
  return repaired;
}

// ===== fixtures & sim =====
function makeFixtures(teams){
  const n = teams.length; const arr=teams.map(t=>t.id); if(n%2===1) arr.push(null);
  const rounds=(arr.length-1)*2, half=arr.length/2, out=[];
  let left=arr.slice(0,half), right=arr.slice(half).reverse();
  for(let r=0;r<rounds;r++){
    const legs=[];
    for(let i=0;i<half;i++){
      const a=left[i], b=right[i]; if(a&&b){ const home=(r<rounds/2)?a:b, away=(r<rounds/2)?b:a; legs.push({home,away,played:false,score:null}); }
    }
    out.push(legs);
    const fixed=left[0], moved=left.splice(1).concat(right.splice(0,1)); right.push(moved.pop()); left=[fixed].concat(moved);
  }
  return out;
}
function teamById(id){ for(const d of state.divisions){ for(const t of d.teams){ if(t.id===id) return t; } } return null; }
function strength(t){ if(t._seasonMul==null) t._seasonMul = 1 + randn(0, state.config.seasonSigma); return t.rating * t._seasonMul; }
function simMatch(home, away){
  const cfg=state.config, sh=strength(home)*(1+randn(0,cfg.perfSigma)), sa=strength(away)*(1+randn(0,cfg.perfSigma));
  const total=Math.max(0.6,cfg.avgGoals+randn(0,0.25)); const homeBias=0.5+cfg.homeEdge;
  const rh=sh*homeBias, ra=sa*(1-cfg.homeEdge), ratio=rh/(rh+ra);
  const muH=clamp(total*ratio,0.2,5), muA=clamp(total*(1-ratio),0.2,5);
  return [samplePoisson(muH), samplePoisson(muA)];
}
function emptyRow(team){ return { id: team.id, name: team.name, P:0, J:0, V:0, E:0, D:0, GP:0, GC:0, SG:0 }; }
function computeTable(div){
  const map = new Map(div.teams.map(t=>[t.id, emptyRow(t)]));
  for(const round of div.fixtures){
    for(const m of round){
      if(!m.played) continue;
      const a = map.get(m.home), b = map.get(m.away);
      a.J++; b.J++; a.GP+=m.score[0]; a.GC+=m.score[1];
      b.GP+=m.score[1]; b.GC+=m.score[0];
      a.SG=a.GP-a.GC; b.SG=b.GP-b.GC;
      if(m.score[0]>m.score[1]){ a.V++; b.D++; a.P+=3; }
      else if(m.score[0]<m.score[1]){ b.V++; a.D++; b.P+=3; }
      else { a.E++; b.E++; a.P+=1; b.P+=1; }
    }
  }
  let rows = Array.from(map.values());
  rows.sort((r1,r2)=> r2.P - r1.P || r2.SG - r1.SG || r2.GP - r1.GP || (rnd()-0.5));
  div.table = rows;
}
function ensureFixtures(){ for(const d of state.divisions){ if(!d.fixtures || d.fixtures.length===0){ d.fixtures = makeFixtures(d.teams); d.round=0; } } }
function playNextRound(div){
  ensureFixtures();
  if(div.round >= div.fixtures.length) return false;
  for(const m of div.fixtures[div.round]){
    if(!m.played){
      const home=teamById(m.home), away=teamById(m.away);
      m.score = simMatch(home, away); m.played=true;
    }
  }
  div.round++; computeTable(div); return true;
}
function playAllRounds(div){ while(playNextRound(div)){} }

// ===== animated round =====
let _ovSkip=false;
function animateRound(div, speed=700){
  ensureFixtures();
  if(div.round >= div.fixtures.length) return;
  const matches = div.fixtures[div.round].filter(m=>!m.played);
  const finals = matches.map(m=>{
    const home=teamById(m.home), away=teamById(m.away);
    const res = simMatch(home, away);
    m._target = res; return {m, home, away, res};
  });
  const overlay = $('#overlay'), list=$('#ovList'), btnSkip=$('#ovSkip');
  overlay.classList.remove('hidden'); _ovSkip=false; btnSkip.onclick=()=>{ _ovSkip=true; };
  list.innerHTML='';
  finals.forEach(({home,away})=>{
    const item=document.createElement('div'); item.className='ov-item';
    item.innerHTML = `<div class="ov-home"><span class="logo-badge">${initials(home.name)}</span> ${home.name}</div>
      <div class="ov-score">0 x 0</div>
      <div class="ov-away">${away.name} <span class="logo-badge">${initials(away.name)}</span></div>`;
    list.appendChild(item);
  });
  let idx=0;
  function step(){
    if(idx>=finals.length || _ovSkip){
      finals.forEach(({m})=>{ m.score = m._target; m.played=true; delete m._target; });
      div.round++; computeTable(div); overlay.classList.add('hidden'); saveState(); return;
    }
    const row = list.children[idx];
    const tgt = finals[idx].res.slice(); const sc = [0,0];
    const scoreEl = row.querySelector('.ov-score');
    function grow(){
      if(_ovSkip){ step(); return; }
      if(sc[0]<tgt[0] && Math.random()<0.6){ sc[0]++; }
      else if(sc[1]<tgt[1] && Math.random()<0.6){ sc[1]++; }
      scoreEl.textContent = `${sc[0]} x ${sc[1]}`;
      if(sc[0]>=tgt[0] && sc[1]>=tgt[1]){ finals[idx].m.score = tgt; finals[idx].m.played=true; idx++; setTimeout(step, speed*0.5); return; }
      setTimeout(grow, Math.max(180, speed*0.5));
    }
    grow();
  }
  step();
}

// ===== playoffs & end season; cup only after first season and auto-seed after each season =====
function playoffsChampion(div){
  const top = div.table.slice(0,4); if(top.length<4) return null;
  function play(a,b){
    const A = teamById(a.id), B = teamById(b.id);
    let [ga,gb] = simMatch(A,B); if(ga===gb){ const bumpA=randn(0,0.2)+strength(A), bumpB=randn(0,0.2)+strength(B); if(bumpA>bumpB) ga++; else gb++; }
    return ga>gb ? a : b;
  }
  const s1 = play(top[0],top[3]), s2 = play(top[1],top[2]);
  return play(s1,s2);
}
function endSeason(){
  const summary = { season: state.season, champions: {}, tables: {}, playoffs: {}, date: new Date().toISOString() };
  for(const d of state.divisions){
    while(d.round < d.fixtures.length){ playNextRound(d); }
    let champRow = d.table[0];
    if(state.config.playoffs){ const w = playoffsChampion(d); if(w) champRow = w; summary.playoffs[d.code]=true; } else summary.playoffs[d.code]=false;
    const team = teamById(champRow.id); team.titles[d.code] = (team.titles[d.code]||0)+1;
    summary.champions[d.code] = team.name;
    summary.tables[d.code] = d.table.map(r=>({id:r.id,name:r.name,P:r.P,SG:r.SG,GP:r.GP,GC:r.GC}));
  }
  for(let i=0;i<state.divisions.length-1;i++){
    const upper=state.divisions[i], lower=state.divisions[i+1];
    const bottom4Ids = upper.table.slice(-4).map(r=>r.id);
    const top4Ids    = lower.table.slice(0,4).map(r=>r.id);
    const upperKeep = upper.teams.filter(t=> !bottom4Ids.includes(t.id));
    const lowerKeep = lower.teams.filter(t=> !top4Ids.includes(t.id));
    const down = bottom4Ids.map(id=> upper.teams.find(t=>t.id===id)).filter(Boolean);
    const up   = top4Ids.map(id=> lower.teams.find(t=>t.id===id)).filter(Boolean);
    upper.teams = upperKeep.concat(up);
    lower.teams = lowerKeep.concat(down);
  }
  // auto-seed cup after season finishes (and unlock from then on)
  const per = state.cup.perDivision || 16;
  const picks=[]; for(const d of state.divisions){ const take=Math.min(per, d.table.length); for(let i=0;i<take;i++){ picks.push(d.table[i].id); } }
  const pow2 = 1<<Math.floor(Math.log2(Math.max(2,picks.length))); const field = picks.slice(0,pow2); field.sort(()=>Math.random()-0.5);
  state.cup = { rounds:[], alive:field.slice(), stage:0, seasonOf: state.season, champion:null, perDivision: per, locked:false };

  for(const d of state.divisions){ d.fixtures=[]; d.round=0; d.table=[]; for(const t of d.teams){ delete t._seasonMul; } }
  state.history.unshift(summary);
  state.season += 1;
  saveState();
}

// ===== cup =====
function cupLocked(){ return state.history.length===0; }
function playCupRound(){
  if(cupLocked()){ alert("A Copa Truste BK só fica disponível após a primeira temporada."); return false; }
  const ids = state.cup.alive.slice(); if(ids.length<=1) return false;
  const results=[];
  for(let i=0;i<ids.length;i+=2){
    const A=teamById(ids[i]), B=teamById(ids[i+1]); let [ga,gb]=simMatch(A,B);
    if(ga===gb){ const bumpA=randn(0,0.2)+strength(A), bumpB=randn(0,0.2)+strength(B); if(bumpA>bumpB) ga++; else gb++; }
    const win = ga>gb ? A.id : B.id;
    results.push({home:A.name,away:B.name,score:[ga,gb],winner:teamById(win).name});
  }
  state.cup.rounds.push(results);
  state.cup.alive = results.map(r=> state.divisions.flatMap(d=>d.teams).find(t=>t.name===r.winner).id );
  if(state.cup.alive.length===1){
    const champion = teamById(state.cup.alive[0]); champion.cupTitles=(champion.cupTitles||0)+1; state.cup.champion=champion.name;
  }
  saveState(); return true;
}
function seedCup(perDivision){
  if(cupLocked()){ alert("A Copa Truste BK só fica disponível após a primeira temporada."); return; }
  const picks=[]; for(const d of state.divisions){ const take=Math.min(perDivision,d.table.length||d.teams.length); const arr=(d.table.length?d.table:d.teams.map(t=>({id:t.id}))).slice(0,take); arr.forEach(r=>picks.push(r.id)); }
  const pow2=1<<Math.floor(Math.log2(Math.max(2,picks.length))); const field=picks.slice(0,pow2); field.sort(()=>Math.random()-0.5);
  state.cup = { rounds:[], alive:field.slice(), stage:0, seasonOf: (state.history[0]?.season||0), champion:null, perDivision: perDivision, locked:false };
  saveState();
}
function playCupAll(){ while(playCupRound()){} }

// ===== Hall of Fame =====
function renderHallOfFame(){
  const hall = $('#hallArea'); hall.innerHTML='';
  const acc = {}; // name -> {A,B,C,CUP,total}
  state.history.forEach(h=>{
    for(const code of Object.keys(h.champions)){ const name=h.champions[code]; acc[name]=acc[name]||{A:0,B:0,C:0,CUP:0,total:0}; acc[name][code]++; acc[name].total++; }
  });
  state.divisions.flatMap(d=>d.teams).forEach(t=>{ if(t.cupTitles>0){ acc[t.name]=acc[t.name]||{A:0,B:0,C:0,CUP:0,total:0}; acc[t.name].CUP=t.cupTitles; acc[t.name].total+=t.cupTitles; } });
  const rows = Object.entries(acc).filter(([_,v])=>v.total>0).sort((a,b)=>b[1].total - a[1].total);
  if(rows.length===0){ hall.innerHTML = '<div class="card small">Ainda não há campeões para exibir.</div>'; return; }
  const card=document.createElement('div'); card.className='card';
  card.innerHTML = `<h3>🏅 Hall da Fama — apenas quem já foi campeão</h3>`;
  const tbl=document.createElement('table'); tbl.className='table'; tbl.innerHTML='<thead><tr><th>#</th><th>Time</th><th>A</th><th>B</th><th>C</th><th>Copa</th><th>Total</th></tr></thead>'; const tb=document.createElement('tbody'); tbl.appendChild(tb);
  rows.forEach(([name,v],i)=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${i+1}</td><td>${name}</td><td>${v.A||0}</td><td>${v.B||0}</td><td>${v.C||0}</td><td>${v.CUP||0}</td><td>${v.total}</td>`; tb.appendChild(tr); });
  card.appendChild(tbl); hall.appendChild(card);
}

// ===== render =====
function logoBadgeText(t){ const el=document.createElement('span'); el.className='logo-badge'; el.textContent=initials(t.name); return el; }
function render(){
  document.documentElement.setAttribute('data-theme', state.config.theme||'ocean');
  $('#btnMenu').onclick = ()=> $('#sidebar').classList.toggle('open');
  const tabs = $$('.tab-btn'); tabs.forEach(btn=>btn.onclick=()=>{ tabs.forEach(b=>b.classList.remove('active')); btn.classList.add('active'); $$('.tab').forEach(s=>s.classList.remove('visible')); $('#tab-'+btn.dataset.tab).classList.add('visible'); $('#sidebar').classList.remove('open'); });

  // DASH
  const dash = $('#dashDivisions'); dash.innerHTML='';
  for(const d of state.divisions){ computeTable(d); const card=document.createElement('div'); card.className='card';
    const roundsTotal = d.fixtures.length || ((d.teams.length-1)*2);
    card.innerHTML = `<h3>${d.name} — Temporada ${state.season} ${state.config.playoffs?'<span class="tag">Playoffs</span>':''}</h3>
      <div class="small">Rodada ${d.round}/${roundsTotal}</div>
      <div class="toolbar"><button data-act="round">▶ Próxima</button><button data-act="anim">🎬 Anima</button><button data-act="all">⏩ Tudo</button></div>
      <table class="table"><thead><tr><th>#</th><th>Time</th><th>P</th><th>J</th><th>V</th><th>SG</th></tr></thead><tbody></tbody></table>`;
    const tb = card.querySelector('tbody');
    d.table.forEach((r,i)=>{ const tr=document.createElement('tr'); const t=teamById(r.id);
      const nameTd = document.createElement('td'); nameTd.className='teamcell'; nameTd.appendChild(logoBadgeText(t)); nameTd.append(' '+r.name);
      tr.innerHTML=`<td>${i+1}</td>`; tr.appendChild(nameTd); tr.insertAdjacentHTML('beforeend', `<td>${r.P}</td><td>${r.J}</td><td>${r.V}</td><td>${r.SG}</td>`); tb.appendChild(tr);
    });
    const [b1,b2,b3] = card.querySelectorAll('button');
    b1.onclick=()=>{ playNextRound(d); saveState(); };
    b2.onclick=()=>{ animateRound(d); };
    b3.onclick=()=>{ playAllRounds(d); saveState(); };
    dash.appendChild(card);
  }

  // DIVISIONS
  const area = $('#divisionsArea'); area.innerHTML='';
  for(const d of state.divisions){
    const sec=document.createElement('div'); sec.className='card';
    const roundsTotal=d.fixtures.length||((d.teams.length-1)*2);
    sec.innerHTML = `<h3>${d.name}</h3>
      <div class="toolbar">
        <button data-act="gen">Gerar Tabela</button>
        <button data-act="round">▶ Jogar próxima rodada</button>
        <button data-act="anim">🎬 Rodada com animação</button>
        <button data-act="all">⏩ Jogar tudo</button>
      </div>
      <div class="grid grid2">
        <div>
          <h4>Tabela</h4>
          <table class="table"><thead><tr><th>#</th><th>Time</th><th>P</th><th>J</th><th>V</th><th>E</th><th>D</th><th>GP</th><th>GC</th><th>SG</th></tr></thead><tbody></tbody></table>
        </div>
        <div>
          <h4>Rodada ${d.round}/${roundsTotal}</h4>
          <div class="grid"> ${ (d.fixtures[d.round]||[]).map(m=>{
            const h=teamById(m.home), a=teamById(m.away); const sc=m.played?`${m.score[0]} x ${m.score[1]}`:'—';
            return `<div class="card ov-item"><div class="ov-home"><span class='logo-badge'>${initials(h.name)}</span> ${h.name}</div><div class="ov-score">${sc}</div><div class="ov-away">${a.name} <span class='logo-badge'>${initials(a.name)}</span></div></div>`;
          }).join('') } </div>
        </div>
      </div>`;
    computeTable(d); const tbody=sec.querySelector('tbody');
    d.table.forEach((r,i)=>{ const t=teamById(r.id); const tr=document.createElement('tr');
      tr.innerHTML = `<td>${i+1}</td><td class="teamcell"><span class="logo-badge">${initials(t.name)}</span> ${r.name}</td><td>${r.P}</td><td>${r.J}</td><td>${r.V}</td><td>${r.E}</td><td>${r.D}</td><td>${r.GP}</td><td>${r.GC}</td><td>${r.SG}</td>`;
      tbody.appendChild(tr);
    });
    const [btnGen,btnRound,btnAnim,btnAll]=sec.querySelectorAll('button');
    btnGen.onclick=()=>{ d.fixtures=makeFixtures(d.teams); d.round=0; d.table=[]; saveState(); };
    btnRound.onclick=()=>{ playNextRound(d); saveState(); };
    btnAnim.onclick=()=>{ animateRound(d); };
    btnAll.onclick=()=>{ playAllRounds(d); saveState(); };
    area.appendChild(sec);
  }

  // CUP
  $('#cupTake').value = state.cup.perDivision || 16;
  const info = $('#cupInfo');
  if(state.history.length===0){
    info.textContent = "🔒 A Copa Truste BK desbloqueia depois que você finalizar a 1ª temporada.";
  }else{
    info.textContent = `Copa da temporada ${state.cup.seasonOf||'-'}. Participantes: ${state.cup.alive.length || '—'}`;
  }
  const cup = $('#cupArea'); cup.innerHTML='';
  if(state.history.length>0){
    if(state.cup.alive.length>0){
      const bracket = document.createElement('div'); bracket.className='grid';
      state.cup.rounds.forEach((matches, idx)=>{
        const col = document.createElement('div'); col.className='card';
        col.innerHTML = `<h4>Fase ${idx+1}</h4>`;
        matches.forEach(m=>{
          const div = document.createElement('div'); div.className='ov-item';
          div.innerHTML = `<div class="ov-home">${m.home}</div><div class="ov-score">${m.score[0]} x ${m.score[1]}</div><div class="ov-away">${m.away}</div><div class="small">Vencedor: ${m.winner}</div>`;
          col.appendChild(div);
        });
        bracket.appendChild(col);
      });
      if(state.cup.champion){
        const fin = document.createElement('div'); fin.className='card';
        fin.innerHTML = `<h3>🏆 Campeão da Truste BK: ${state.cup.champion}</h3>`;
        cup.appendChild(fin);
      }
      cup.appendChild(bracket);
    } else {
      cup.innerHTML = `<div class="card small">Monte a copa com <span class="kbd">Montar Copa</span>. Ela também é gerada automaticamente ao <b>fechar a temporada</b>.</div>`;
    }
  }

  // HISTORY + Hall
  renderHallOfFame();
  const hist = $('#historyArea'); hist.innerHTML='';
  if(state.history.length===0){
    hist.innerHTML = '<div class="card small">Nenhuma temporada finalizada ainda.</div>';
  } else {
    state.history.forEach(h=>{
      const card=document.createElement('div'); card.className='card';
      card.innerHTML = `<h3>Temporada ${h.season}</h3>
        <div class="grid grid2">
          ${Object.entries(h.tables).map(([code,rows])=>{
            return `<div><h4>Divisão ${code} — Campeão: <span class="badge ok">${h.champions[code]}</span> ${h.playoffs[code]?'(playoffs)':''}</h4>
              <table class="table"><thead><tr><th>#</th><th>Time</th><th>P</th><th>SG</th></tr></thead>
              <tbody>${rows.slice(0,10).map((r,i)=>`<tr><td>${i+1}</td><td>${r.name}</td><td>${r.P}</td><td>${r.SG}</td></tr>`).join('')}</tbody></table></div>`;
          }).join('')}
        </div>`;
      hist.appendChild(card);
    });
  }

  // bindings
  $('#btnSanity').onclick=()=>{ const fixed=sanityCheck(true); alert(fixed?'Dados corrigidos.':'Tudo ok!'); };
  $('#btnClear').onclick=clearAll;
  $('#btnNextRoundAll').onclick=()=>{ state.divisions.forEach(d=>playNextRound(d)); saveState(); };
  $('#btnNextRoundAnim').onclick=()=>{
    let i=0; const go=()=>{ if(i>=state.divisions.length) return; animateRound(state.divisions[i++]); setTimeout(()=>{ if($('#overlay').classList.contains('hidden')) go(); else setTimeout(go,400); }, 400); };
    go();
  };
  $('#btnPlayAll').onclick=()=>{ state.divisions.forEach(d=>playAllRounds(d)); saveState(); };
  $('#btnNewSeason').onclick=()=>{ endSeason(); };
  $('#btnCupSeed').onclick=()=>{ const n=parseInt($('#cupTake').value||'16',10); seedCup(n); };
  $('#btnCupRound').onclick=()=>{ playCupRound(); };
  $('#btnCupAll').onclick=()=>{ playCupAll(); };

  // export/import
  $('#btnSave').onclick=()=>{ const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`clots-v3-s${state.season}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); };
  $('#fileImport').onchange=(e)=>{ const f=e.target.files[0]; if(!f) return; const fr=new FileReader(); fr.onload=()=>{ try{ state=JSON.parse(fr.result); saveState(); }catch(err){ alert('Arquivo inválido'); } }; fr.readAsText(f); };
}

// ===== init =====
let state = loadState() || seedTeams();
sanityCheck(true); 
for(const d of state.divisions){ if(!d.fixtures.length){ d.fixtures = makeFixtures(d.teams); } computeTable(d); }
state.cup.locked = state.history.length===0;
render();
