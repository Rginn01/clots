// ===== util =====
const $  = (sel, el=document) => el.querySelector(sel);
const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// quick seeded rng
let _seed = Date.now() % 2147483647;
function rnd(){ _seed = (_seed*48271)%2147483647; return _seed/2147483647 }
function randn(mean=0, sigma=1){
  const u = 1 - rnd(); const v = 1 - rnd();
  return Math.sqrt(-2*Math.log(u)) * Math.cos(2*Math.PI*v) * sigma + mean;
}
function samplePoisson(lambda){
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do{ k++; p *= rnd(); } while(p > L);
  return k-1;
}
function initials(name){ return name.split(/\s+/).map(s=>s[0]).join('').slice(0,3).toUpperCase(); }

// ===== storage =====
const STORAGE_KEY = "clots-manager-v2";
function loadState(){
  // try v2
  try{ const raw = localStorage.getItem(STORAGE_KEY); if(raw) return JSON.parse(raw); }catch(e){}
  // migrate v1 if exists
  try{
    const v1 = localStorage.getItem("clots-manager-v1");
    if(v1){
      const old = JSON.parse(v1);
      const st = {
        season: old.season||1,
        config: {...old.config, playoffs:false, theme:'ocean'},
        divisions: old.divisions,
        history: old.history||[],
        cup: old.cup||{rounds:[],alive:[],stage:0,seasonOf:0,champion:null,perDivision:16},
        scorers: {},
      };
      return st;
    }
  }catch(e){}
  return null;
}
function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
}

// ===== initial data =====
function seedTeams(){
  const A = ["Lany","Cornixho","Pika","Cloni","Ameno","Monk","Glokk","Pau","A01","FF"];
  const B = ["Sexo","Foger","Remo","FDS","Pila","Ameroca","Amor","Ploca","Stone","Del Zap"];
  const C = ["City","Light","Freezer","Heand","Red Hot","Kira","Tu Zap","Pinko","Block","Lanus"];
  function mk(arr, base){
    return arr.map(n=>({
      id: crypto.randomUUID(),
      name:n, rating: clamp(Math.round((base+randn(0,6))*10)/10,50,95),
      titles:{A:0,B:0,C:0}, cupTitles:0, logo:null, players:[]
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
    cup: { rounds:[], alive:[], stage:0, seasonOf: 0, champion:null, perDivision: 16 },
    history: [],
    scorers: {} // season -> array of {teamId,playerId,name,goals}
  };
}

// ===== sanity =====
function deepClone(x){ return JSON.parse(JSON.stringify(x)); }
function sanityCheck(autoFix=true){
  let repaired = false;
  if(!Array.isArray(state.divisions)){ state.divisions=[]; repaired=true; }
  for(const d of state.divisions){
    if(!Array.isArray(d.teams) || d.teams.length===0){ d.teams=[]; repaired=true; }
    d.teams = d.teams.filter(t=>t && t.id && t.name);
    for(const t of d.teams){
      if(!Array.isArray(t.players)) t.players = [];
      if(typeof t.rating!=='number' || !isFinite(t.rating)) t.rating = 72;
    }
    if(!Array.isArray(d.fixtures)) d.fixtures=[];
    if(typeof d.round!=='number') d.round=0;
    if(!Array.isArray(d.table)) d.table=[];
  }
  if(repaired && autoFix) saveState();
  return repaired;
}

// ===== fixtures =====
function makeFixtures(teams){
  const n = teams.length;
  const arr = teams.map(t=>t.id);
  if(n%2===1){ arr.push(null); }
  const rounds = (arr.length-1)*2;
  const half = arr.length/2;
  const out = [];
  let left = arr.slice(0,half), right = arr.slice(half).reverse();
  for(let r=0;r<rounds;r++){
    const legs = [];
    for(let i=0;i<half;i++){
      const a = left[i], b = right[i];
      if(a && b){
        const home = (r<rounds/2) ? a : b;
        const away = (r<rounds/2) ? b : a;
        legs.push({home, away, played:false, score:null, details:null});
      }
    }
    out.push(legs);
    const fixed = left[0];
    const moved = left.splice(1).concat(right.splice(0,1));
    right.push(moved.pop());
    left = [fixed].concat(moved);
  }
  return out;
}

// ===== team & players =====
function teamById(id){
  for(const d of state.divisions){ for(const t of d.teams){ if(t.id===id) return t; } }
  return null;
}
function allTeams(){ return state.divisions.flatMap(d=>d.teams); }

function ensureRoster(team){
  if(team.players && team.players.length>=14) return;
  const roles = ["GK","DF","DF","DF","DF","MF","MF","MF","MF","FW","FW","FW","MF","DF","MF","DF","FW","MF"];
  team.players = roles.map((pos,i)=>{
    const spread = {GK:4, DF:6, MF:7, FW:8}[pos] || 6;
    const pr = clamp(Math.round((team.rating + randn(0,spread))*10)/10, 40, 99);
    return { id: crypto.randomUUID(), name: pos+" "+(i+1), pos, ovr:pr,
      goals:0, yc:0, rc:0, apps:0, injuredUntil:0, suspendedUntil:0 };
  });
}

function availablePlayers(team, currentRound){
  ensureRoster(team);
  const pool = team.players.filter(p=> (p.injuredUntil||0) <= currentRound && (p.suspendedUntil||0) <= currentRound);
  if(pool.length<11){
    // libera parcialmente — volta alguns com 75% de chance se precisamos preencher
    team.players.forEach(p=>{ if(pool.length<11 && rnd()<0.75) pool.push(p); });
  }
  // choose XI: priority FW/MF/DF then GK
  const gk = pool.filter(p=>p.pos==="GK").slice(0,1);
  const rest = pool.filter(p=>p.pos!=="GK").sort((a,b)=>b.ovr-a.ovr).slice(0,10);
  return gk.concat(rest);
}

// ===== strengths & simulation =====
function strength(t){
  if(t._seasonMul==null){
    t._seasonMul = 1 + randn(0, state.config.seasonSigma);
  }
  return t.rating * t._seasonMul;
}

function simMatch(home, away, currentRound){
  const cfg = state.config;
  const sh = strength(home) * (1 + randn(0, cfg.perfSigma));
  const sa = strength(away) * (1 + randn(0, cfg.perfSigma));

  const totalGoals = Math.max(0.6, cfg.avgGoals + randn(0, 0.25));
  const homeBias = 0.5 + cfg.homeEdge;
  const rh = sh * homeBias, ra = sa * (1 - cfg.homeEdge);
  const ratioH = rh / (rh + ra);
  const muH = clamp(totalGoals * ratioH, 0.2, 5.0);
  const muA = clamp(totalGoals * (1 - ratioH), 0.2, 5.0);
  const gH = samplePoisson(muH);
  const gA = samplePoisson(muA);

  // allocate scorers + cards + injuries
  const xiH = availablePlayers(home, currentRound);
  const xiA = availablePlayers(away, currentRound);
  const det = { scorers:[], cards:[], injuries:[] };

  function allocGoals(team, xi, n){
    const weights = xi.map(p=>{
      const base = {FW:3, MF:1.8, DF:0.7, GK:0.1}[p.pos] || 1;
      return base * (p.ovr/Math.max(50, team.rating));
    });
    for(let k=0;k<n;k++){
      const tot = weights.reduce((a,b)=>a+b,0);
      let r = rnd()*tot, idx=0;
      for(; idx<weights.length; idx++){ if((r -= weights[idx])<=0) break; }
      const p = xi[Math.min(idx, xi.length-1)];
      p.goals++; det.scorers.push({team:team.id, player:p.id, name:p.name});
      // register season artilharia
      const sid = String(state.season);
      if(!state.scorers[sid]) state.scorers[sid]=[];
      const arr = state.scorers[sid];
      let row = arr.find(x=>x.playerId===p.id);
      if(!row){ row = {teamId:team.id, playerId:p.id, name:p.name, teamName:team.name, goals:0}; arr.push(row); }
      row.goals++;
    }
  }
  allocGoals(home, xiH, gH);
  allocGoals(away, xiA, gA);

  function disciplineAndInjuries(team, xi){
    // cards: Poisson ~ 1.6
    const ycTeam = samplePoisson(1.6), rcTeam = (rnd()<0.12?1:0);
    for(let i=0;i<ycTeam;i++){
      const p = xi[Math.floor(rnd()*xi.length)]; p.yc++; det.cards.push({team:team.id,player:p.id,type:'Y'});
      if(p.yc % 3 === 0){ p.suspendedUntil = currentRound+1; det.cards.push({team:team.id,player:p.id,type:'S'}); }
    }
    if(rcTeam){
      const p = xi[Math.floor(rnd()*xi.length)]; p.rc++; p.suspendedUntil = currentRound+1;
      det.cards.push({team:team.id,player:p.id,type:'R'});
    }
    // injuries: 2% minor (1-2 jogos), 0.6% major (3-6)
    xi.forEach(p=>{
      const r = rnd();
      if(r<0.02){ p.injuredUntil = currentRound + 1 + Math.round(rnd()*1)+1; det.injuries.push({team:team.id,player:p.id,weeks:p.injuredUntil-currentRound}); }
      else if(r<0.026){ p.injuredUntil = currentRound + 3 + Math.round(rnd()*3); det.injuries.push({team:team.id,player:p.id,weeks:p.injuredUntil-currentRound}); }
      p.apps++;
    });
  }
  disciplineAndInjuries(home, xiH);
  disciplineAndInjuries(away, xiA);

  return { score:[gH,gA], details:det };
}

// ===== tables =====
function emptyRow(team){
  return { id: team.id, name: team.name, P:0, J:0, V:0, E:0, D:0, GP:0, GC:0, SG:0 };
}
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

function ensureFixtures(){
  for(const d of state.divisions){
    if(!d.fixtures || d.fixtures.length===0){
      d.fixtures = makeFixtures(d.teams);
      d.round = 0;
    }
  }
}

function playNextRound(div){
  ensureFixtures();
  if(div.round >= div.fixtures.length) return false;
  for(const m of div.fixtures[div.round]){
    if(!m.played){
      const home = teamById(m.home), away = teamById(m.away);
      const res = simMatch(home, away, div.round);
      m.score = res.score; m.details = res.details;
      m.played = true;
    }
  }
  div.round++;
  computeTable(div);
  return true;
}
function playAllRounds(div){ while(playNextRound(div)){} }

// ===== playoffs por divisão (top4) =====
function playoffsChampion(div){
  // usa tabela final
  const top = div.table.slice(0,4);
  if(top.length<4) return null;
  function play(a,b){
    const A = teamById(a.id), B = teamById(b.id);
    let {score:[ga,gb]} = simMatch(A,B,9999); // neutro (mando irrelevante aqui)
    if(ga===gb){ // desempate
      const bumpA = randn(0,0.2)+strength(A), bumpB = randn(0,0.2)+strength(B);
      if(bumpA>bumpB) ga++; else gb++;
    }
    return ga>gb ? a : b;
  }
  const s1 = play(top[0], top[3]);
  const s2 = play(top[1], top[2]);
  const fin = play(s1, s2);
  return fin;
}

// ===== end season with promotions/relegations =====
function endSeason(){
  // fecha ligas
  const summary = { season: state.season, champions: {}, tables: {}, playoffs: {}, date: new Date().toISOString() };
  for(const d of state.divisions){
    while(d.round < d.fixtures.length){ playNextRound(d); }
    let champRow = d.table[0];
    if(state.config.playoffs){
      const winner = playoffsChampion(d);
      if(winner) champRow = winner;
      summary.playoffs[d.code] = true;
    } else summary.playoffs[d.code] = false;
    const team = teamById(champRow.id);
    team.titles[d.code] = (team.titles[d.code]||0)+1;
    summary.champions[d.code] = team.name;
    summary.tables[d.code] = d.table.map(r=>({id:r.id,name:r.name,P:r.P,SG:r.SG,GP:r.GP,GC:r.GC}));
  }

  // promo/rebaixamento 4
  function moveBetween(upper, lower){
    const bottom4Ids = upper.table.slice(-4).map(r=>r.id);
    const top4Ids    = lower.table.slice(0,4).map(r=>r.id);
    const upperKeep = upper.teams.filter(t=> !bottom4Ids.includes(t.id));
    const lowerKeep = lower.teams.filter(t=> !top4Ids.includes(t.id));
    const down = bottom4Ids.map(id=> upper.teams.find(t=>t.id===id)).filter(Boolean);
    const up   = top4Ids.map(id=> lower.teams.find(t=>t.id===id)).filter(Boolean);
    upper.teams = upperKeep.concat(up);
    lower.teams = lowerKeep.concat(down);
  }
  for(let i=0;i<state.divisions.length-1;i++){
    moveBetween(state.divisions[i], state.divisions[i+1]);
  }

  // reset fixtures & sanear
  for(const d of state.divisions){
    d.fixtures=[]; d.round=0; d.table=[];
    for(const t of d.teams){ delete t._seasonMul; t.players?.forEach(p=>{ p.injuredUntil=0; p.suspendedUntil=0; }); }
  }
  state.history.unshift(summary);
  state.season += 1;
  // zera artilharia da nova temporada
  state.scorers[String(state.season)] = [];
  saveState();
}

// ===== cup =====
function seedCup(perDivision){
  state.cup = { rounds:[], alive:[], stage:0, seasonOf: state.season, champion:null, perDivision };
  const picks = [];
  for(const d of state.divisions){
    const ordered = d.table?.length ? d.table.slice(0,perDivision) : d.teams.map(t=>({id:t.id})).slice(0,perDivision);
    ordered.forEach(r=>picks.push(r.id));
  }
  const pow2 = 1<<Math.floor(Math.log2(Math.max(2,picks.length)));
  const field = picks.slice(0, pow2);
  field.sort(()=>rnd()-0.5);
  state.cup.alive = field.slice();
  saveState();
}
function playCupRound(){
  const ids = state.cup.alive.slice();
  if(ids.length<=1) return false;
  const results = [];
  for(let i=0;i<ids.length;i+=2){
    const A = teamById(ids[i]), B = teamById(ids[i+1]);
    let {score:[ga,gb]} = simMatch(A,B,9999);
    if(ga===gb){ const bumpA = randn(0,0.2)+strength(A); const bumpB = randn(0,0.2)+strength(B); if(bumpA>bumpB) ga++; else gb++; }
    const win = ga>gb ? A : B;
    results.push({home:A.name,away:B.name,score:[ga,gb],winner:win.name});
  }
  state.cup.rounds.push(results);
  state.cup.alive = results.map(r=> teamById(allTeams().find(t=>t.name===r.winner).id).id );
  if(state.cup.alive.length===1){
    const champion = teamById(state.cup.alive[0]);
    champion.cupTitles = (champion.cupTitles||0)+1;
    state.cup.champion = champion.name;
  }
  saveState();
  return true;
}
function playCupAll(){ while(playCupRound()){} }

// ===== render helpers =====
function logoBadge(team){
  const el = document.createElement('span'); el.className='logo-badge';
  if(team.logo){ const img = document.createElement('img'); img.src=team.logo; el.appendChild(img); }
  else el.textContent = initials(team.name);
  return el;
}

// ===== RENDER =====
function render(){
  document.documentElement.setAttribute('data-theme', state.config.theme||'ocean');

  // menu mobile
  $('#btnMenu').onclick = ()=> $('#sidebar').classList.toggle('open');
  const tabs = $$('.tab-btn');
  tabs.forEach(btn=>btn.onclick=()=>{
    tabs.forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    $$('.tab').forEach(s=>s.classList.remove('visible'));
    $('#tab-'+btn.dataset.tab).classList.add('visible');
    $('#sidebar').classList.remove('open');
  });

  // DASHBOARD
  const dash = $('#dashDivisions'); dash.innerHTML='';
  for(const d of state.divisions){
    computeTable(d);
    const card = document.createElement('div'); card.className='card';
    const roundsTotal = d.fixtures.length || ((d.teams.length-1)*2);
    card.innerHTML = `<h3>${d.name} — Temporada ${state.season} ${state.config.playoffs?'<span class="tag">Playoffs</span>':''}</h3>
      <div class="small">Rodada ${d.round}/${roundsTotal}</div>
      <table class="table"><thead><tr><th>#</th><th>Time</th><th>P</th><th>J</th><th>V</th><th>SG</th></tr></thead><tbody></tbody></table>`;
    const tb = card.querySelector('tbody');
    d.table.forEach((r,i)=>{
      const tr = document.createElement('tr');
      const t = teamById(r.id);
      const cell = document.createElement('td'); cell.textContent = i+1;
      const nameTd = document.createElement('td'); nameTd.className='teamcell'; nameTd.appendChild(logoBadge(t)); const span = document.createElement('span'); span.textContent=' '+r.name; nameTd.appendChild(span);
      tr.appendChild(cell); tr.appendChild(nameTd);
      tr.insertAdjacentHTML('beforeend', `<td>${r.P}</td><td>${r.J}</td><td>${r.V}</td><td>${r.SG}</td>`);
      tb.appendChild(tr);
    });
    dash.appendChild(card);
  }

  // DIVISIONS detailed
  const area = $('#divisionsArea'); area.innerHTML='';
  for(const d of state.divisions){
    const sec = document.createElement('div'); sec.className='card';
    const roundsTotal = d.fixtures.length || ((d.teams.length-1)*2);
    sec.innerHTML = `<h3>${d.name}</h3>
      <div class="toolbar">
        <button data-act="gen">Gerar Tabela</button>
        <button data-act="round">Jogar próxima rodada</button>
        <button data-act="all">Jogar tudo</button>
      </div>
      <div class="grid grid2">
        <div>
          <h4>Tabela</h4>
          <table class="table"><thead><tr>
            <th>#</th><th>Time</th><th>P</th><th>J</th><th>V</th><th>E</th><th>D</th><th>GP</th><th>GC</th><th>SG</th>
          </tr></thead><tbody></tbody></table>
        </div>
        <div>
          <h4>Rodada ${d.round}/${roundsTotal}</h4>
          <div class="grid"> ${ (d.fixtures[d.round]||[]).map(m=>{
            const h = teamById(m.home), a = teamById(m.away);
            const sc = m.played ? `${m.score[0]} x ${m.score[1]}` : '—';
            return `<div class="match"><div class="row">
              <div class="teamcell">${h?`<span class='logo-badge'>${h.logo?`<img src='${h.logo}'/>`:initials(h.name)}</span>`:''} ${h?.name||'?'}</div>
              <div>${sc}</div>
              <div class="teamcell">${a?`<span class='logo-badge'>${a.logo?`<img src='${a.logo}'/>`:initials(a.name)}</span>`:''} ${a?.name||'?'}</div>
            </div></div>`;
          }).join('') } </div>
        </div>
      </div>`;
    // fill table
    computeTable(d);
    const tbody = sec.querySelector('tbody');
    d.table.forEach((r,i)=>{
      const t = teamById(r.id);
      const tr = document.createElement('tr');
      const nameHtml = `<span class="teamcell"><span class="logo-badge">${t.logo?`<img src='${t.logo}'/>`:initials(t.name)}</span> ${r.name}</span>`;
      tr.innerHTML = `<td>${i+1}</td><td>${nameHtml}</td><td>${r.P}</td><td>${r.J}</td><td>${r.V}</td><td>${r.E}</td><td>${r.D}</td><td>${r.GP}</td><td>${r.GC}</td><td>${r.SG}</td>`;
      tbody.appendChild(tr);
    });
    // actions
    const [btnGen, btnRound, btnAll] = sec.querySelectorAll('button');
    btnGen.onclick = ()=>{ d.fixtures = makeFixtures(d.teams); d.round=0; d.table=[]; saveState(); };
    btnRound.onclick = ()=>{ playNextRound(d); saveState(); };
    btnAll.onclick = ()=>{ playAllRounds(d); saveState(); };
    area.appendChild(sec);
  }

  // SQUADS
  const sel = $('#teamSelect'); sel.innerHTML='';
  allTeams().forEach(t=>{ const o=document.createElement('option'); o.value=t.id; o.textContent=t.name; sel.appendChild(o); });
  sel.onchange = ()=> renderSquad(sel.value);
  $('#btnHealAll').onclick = ()=>{ allTeams().forEach(t=>t.players?.forEach(p=>{ p.injuredUntil=0; p.suspendedUntil=0; })); saveState(); };

  if(allTeams().length){ renderSquad(allTeams()[0].id); }
  renderScorers();

  // CUP
  $('#cupTake').value = state.cup.perDivision || 16;
  const cup = $('#cupArea'); cup.innerHTML='';
  if(state.cup.alive.length>0){
    const bracket = document.createElement('div'); bracket.className='grid';
    state.cup.rounds.forEach((matches, idx)=>{
      const col = document.createElement('div'); col.className='card';
      col.innerHTML = `<h4>Fase ${idx+1}</h4>`;
      matches.forEach(m=>{
        const div = document.createElement('div'); div.className='match';
        div.innerHTML = `<div class="row"><div>${m.home}</div><div>${m.score[0]} x ${m.score[1]}</div><div>${m.away}</div></div><div class="small">Vencedor: ${m.winner}</div>`;
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
    cup.innerHTML = `<div class="card small">Monte a copa com <span class="kbd">Montar Copa</span>.</div>`;
  }

  // HISTORY
  const hist = $('#historyArea'); hist.innerHTML='';
  if(state.history.length===0){
    hist.innerHTML = '<div class="card small">Nenhuma temporada finalizada ainda.</div>';
  }else{
    state.history.forEach(h=>{
      const card = document.createElement('div'); card.className='card';
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

  // SETTINGS editor
  $('#cfgAvgGoals').value = state.config.avgGoals;
  $('#cfgHomeEdge').value = state.config.homeEdge;
  $('#cfgPerfSigma').value = state.config.perfSigma;
  $('#cfgSeasonSigma').value = state.config.seasonSigma;
  $('#cfgPlayoffs').checked = !!state.config.playoffs;
  $('#cfgTheme').value = state.config.theme || 'ocean';

  const editor = $('#teamsEditor'); editor.innerHTML='';
  state.divisions.forEach((d, di)=>{
    const wrap = document.createElement('div'); wrap.className='card';
    wrap.innerHTML = `<h3>${d.name}</h3>`;
    const tbl = document.createElement('table'); tbl.className='table';
    tbl.innerHTML = '<thead><tr><th>Escudo</th><th>Time</th><th>Rating</th><th>Títulos A/B/C</th><th>Copa</th><th>Ações</th></tr></thead>';
    const tb = document.createElement('tbody'); tbl.appendChild(tb);
    d.teams.forEach(t=>{
      const tr = document.createElement('tr');
      const badge = logoBadge(t).outerHTML;
      tr.innerHTML = `<td>${badge}</td><td>${t.name}</td>
        <td><input type="number" step="0.1" min="40" max="99" value="${t.rating}" data-id="${t.id}" class="ratingInput"></td>
        <td>${(t.titles.A||0)}/${(t.titles.B||0)}/${(t.titles.C||0)}</td><td>${t.cupTitles||0}</td>
        <td><button data-logo="${t.id}">Escudo</button> <button data-del="${t.id}">Remover</button></td>`;
      tb.appendChild(tr);
    });
    const trAdd = document.createElement('tr');
    trAdd.innerHTML = `<td></td><td><input placeholder="Novo time"></td><td><input type="number" value="70"></td><td></td><td></td><td><button data-add="${di}">Adicionar time</button></td>`;
    tb.appendChild(trAdd);
    wrap.appendChild(tbl);
    editor.appendChild(wrap);
  });

  // bind editor events
  $$('#teamsEditor .ratingInput').forEach(inp=>{
    inp.onchange = ()=>{ const t = teamById(inp.dataset.id); t.rating = parseFloat(inp.value); saveState(); };
  });
  $$('#teamsEditor button[data-logo]').forEach(btn=>{
    btn.onclick = ()=>{
      const id = btn.getAttribute('data-logo');
      const input = document.createElement('input'); input.type='file'; input.accept='image/*';
      input.onchange = (e)=>{
        const f = e.target.files[0]; if(!f) return;
        const fr = new FileReader();
        fr.onload = ()=>{ const t = teamById(id); t.logo = fr.result; saveState(); };
        fr.readAsDataURL(f);
      };
      input.click();
    };
  });
  $$('#teamsEditor button[data-del]').forEach(btn=>{
    btn.onclick = ()=>{ const id = btn.getAttribute('data-del'); const d = state.divisions.find(dd=>dd.teams.some(t=>t.id===id)); d.teams = d.teams.filter(t=>t.id!==id); saveState(); };
  });
  $$('#teamsEditor button[data-add]').forEach(btn=>{
    btn.onclick = ()=>{
      const di = parseInt(btn.getAttribute('data-add')); const row = btn.closest('tr');
      const name = row.children[1].querySelector('input').value.trim(); const rating = parseFloat(row.children[2].querySelector('input').value);
      if(!name) return;
      state.divisions[di].teams.push({ id: crypto.randomUUID(), name, rating, titles:{A:0,B:0,C:0}, cupTitles:0, logo:null, players:[] });
      saveState();
    };
  });

  // settings bindings
  $('#cfgAvgGoals').onchange = ()=>{ state.config.avgGoals = parseFloat($('#cfgAvgGoals').value); saveState(); };
  $('#cfgHomeEdge').onchange = ()=>{ state.config.homeEdge = parseFloat($('#cfgHomeEdge').value); saveState(); };
  $('#cfgPerfSigma').onchange = ()=>{ state.config.perfSigma = parseFloat($('#cfgPerfSigma').value); saveState(); };
  $('#cfgSeasonSigma').onchange = ()=>{ state.config.seasonSigma = parseFloat($('#cfgSeasonSigma').value); saveState(); };
  $('#cfgPlayoffs').onchange = ()=>{ state.config.playoffs = $('#cfgPlayoffs').checked; saveState(); };
  $('#cfgTheme').onchange = ()=>{ state.config.theme = $('#cfgTheme').value; saveState(); };
  $('#btnSanity').onclick = ()=>{ const fixed = sanityCheck(true); alert(fixed? 'Dados corrigidos.' : 'Tudo ok!'); };

  // dashboard buttons
  $('#btnNextRoundAll').onclick = ()=>{ state.divisions.forEach(d=>playNextRound(d)); saveState(); };
  $('#btnPlayAll').onclick = ()=>{ state.divisions.forEach(d=>playAllRounds(d)); saveState(); };
  $('#btnNewSeason').onclick = ()=>{ endSeason(); };

  // cup buttons
  $('#btnCupSeed').onclick = ()=>{ const n = parseInt($('#cupTake').value||'16',10); state.cup.perDivision=n; seedCup(n); };
  $('#btnCupRound').onclick = ()=>{ playCupRound(); };
  $('#btnCupAll').onclick = ()=>{ playCupAll(); };

  // export/import
  $('#btnSave').onclick = ()=>{
    const blob = new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `clots-v2-s${state.season}.json`; a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  $('#fileImport').onchange = (e)=>{
    const f = e.target.files[0]; if(!f) return;
    const fr = new FileReader();
    fr.onload = ()=>{ try{ state = JSON.parse(fr.result); saveState(); }catch(err){ alert('Arquivo inválido'); } };
    fr.readAsText(f);
  };
}

function renderSquad(teamId){
  const t = teamById(teamId); ensureRoster(t);
  const area = $('#squadArea'); area.innerHTML='';
  const card = document.createElement('div'); card.className='card';
  card.innerHTML = `<h3>${t.name}</h3>`;
  const wrap = document.createElement('div'); wrap.className='card-grid';
  t.players.sort((a,b)=>b.ovr-a.ovr).forEach(p=>{
    const div = document.createElement('div'); div.className='player';
    const tags = [];
    if((p.injuredUntil||0) > currentRoundEstimate()){ tags.push(`<span class="tag inj">Lesão (${p.injuredUntil-currentRoundEstimate()}j)</span>`); }
    if((p.suspendedUntil||0) > currentRoundEstimate()){ tags.push(`<span class="tag sus">Suspenso</span>`); }
    div.innerHTML = `<div><div class="name">${p.name} · ${p.pos}</div>
      <div class="meta">OVR ${p.ovr} · J:${p.apps} · G:${p.goals} · Y:${p.yc} · R:${p.rc}</div>
      <div>${tags.join(' ')}</div></div>
      <div class="badge ok">${p.goals}</div>`;
    wrap.appendChild(div);
  });
  card.appendChild(wrap);
  area.appendChild(card);
  $('#teamSelect').value = t.id;
}

function currentRoundEstimate(){
  // média das divisões (serve para exibir prazos de suspensão/lesão)
  const vals = state.divisions.map(d=>d.round||0);
  return Math.round(vals.reduce((a,b)=>a+b,0)/(vals.length||1));
}

function renderScorers(){
  const sid = String(state.season);
  const rows = (state.scorers[sid]||[]).slice().sort((a,b)=>b.goals-a.goals).slice(0,30);
  const area = $('#scorersArea');
  if(rows.length===0){ area.innerHTML = '<div class="small">Ninguém marcou ainda nesta temporada.</div>'; return; }
  const tbl = document.createElement('table'); tbl.className='table';
  tbl.innerHTML = '<thead><tr><th>#</th><th>Jogador</th><th>Time</th><th>Gols</th></tr></thead>';
  const tb = document.createElement('tbody'); tbl.appendChild(tb);
  rows.forEach((r,i)=>{
    const t = teamById(r.teamId);
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i+1}</td><td>${r.name}</td><td>${t?t.name:'?'}</td><td>${r.goals}</td>`;
    tb.appendChild(tr);
  });
  area.innerHTML=''; area.appendChild(tbl);
}

// ===== init =====
let state = loadState() || seedTeams();
sanityCheck(true);
ensureFixtures();
state.divisions.forEach(d=>computeTable(d));
// init scorers structure
if(!state.scorers[String(state.season)]) state.scorers[String(state.season)] = [];
render();
