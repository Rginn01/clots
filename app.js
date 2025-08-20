// ===== util =====
const $  = (sel, el=document) => el.querySelector(sel);
const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// quick seeded rng for reproducibility across a session
let _seed = Date.now() % 2147483647;
function rnd(){ _seed = (_seed*48271)%2147483647; return _seed/2147483647 }
function randn(mean=0, sigma=1){
  // Box-Muller
  const u = 1 - rnd(); const v = 1 - rnd();
  return Math.sqrt(-2*Math.log(u)) * Math.cos(2*Math.PI*v) * sigma + mean;
}

// ===== storage =====

function deepClone(x){ return JSON.parse(JSON.stringify(x)); }

function sanityCheck(autoFix=true){
  let repaired = false;
  for(const d of state.divisions){
    if(!Array.isArray(d.teams) || d.teams.length===0){
      // tentar reconstruir a partir da última tabela conhecida
      const source = (d.table && d.table.length)? d.table : [];
      if(source.length){
        const rebuilt = source.map((r,i)=>({
          id: (crypto.randomUUID?crypto.randomUUID():String(Date.now())+i),
          name: r.name,
          rating: 72 + (r.P||0)*0.2 + (r.SG||0)*0.5,
          titles: {A:0,B:0,C:0},
          cupTitles: 0
        }));
        d.teams = rebuilt;
        repaired = true;
      }
    } else {
      // remover duplicados por id e itens inválidos
      const seen = new Set(); const clean=[];
      for(const t of d.teams){
        if(!t || !t.id || !t.name){ continue; }
        if(seen.has(t.id)) continue;
        if(typeof t.rating!=='number' || !isFinite(t.rating)){ t.rating=72; }
        seen.add(t.id); clean.push(t);
      }
      if(clean.length !== d.teams.length){ d.teams = clean; repaired = true; }
    }
    if(!Array.isArray(d.fixtures)){ d.fixtures=[]; repaired=true; }
    if(typeof d.round!=='number'){ d.round=0; repaired=true; }
  }
  if(repaired && autoFix){ saveState(); }
  return repaired;
}

const STORAGE_KEY = "clots-manager-v1";
function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw){ return JSON.parse(raw); }
  }catch(e){ console.error(e); }
  return null;
}
function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
sanityCheck(true);
}

// ===== initial data (a,b,c) =====
function seedTeams(){
  // Derive ratings a partir das imagens (pontos e saldo sugerem força)
  const A = [
    {name:"Lany", P:36, SG:6},{name:"Cornixho",P:33,SG:4},{name:"Pika",P:33,SG:4},{name:"Cloni",P:30,SG:2},
    {name:"Ameno",P:27,SG:0},{name:"Monk",P:27,SG:0},{name:"Glokk",P:24,SG:-2},{name:"Pau",P:24,SG:-2},
    {name:"A01",P:22,SG:-3},{name:"FF",P:15,SG:-8},
  ];
  const B = [
    {name:"Sexo",P:36,SG:6},{name:"Foger",P:33,SG:4},{name:"Remo",P:30,SG:2},{name:"FDS",P:30,SG:2},
    {name:"Pila",P:30,SG:2},{name:"Ameroca",P:28,SG:1},{name:"Amor",P:24,SG:-2},{name:"Ploca",P:21,SG:-4},
    {name:"Stone",P:21,SG:-4},{name:"Del Zap",P:18,SG:-6},
  ];
  const C = [
    {name:"City",P:42,SG:10},{name:"Light",P:36,SG:6},{name:"Freezer",P:33,SG:4},{name:"Heand",P:27,SG:0},
    {name:"Red Hot",P:27,SG:0},{name:"Kira",P:27,SG:0},{name:"Tu Zap",P:24,SG:-2},{name:"Pinko",P:24,SG:-2},
    {name:"Block",P:18,SG:-6},{name:"Lanus",P:12,SG:-10},
  ];

  function computeRatings(arr, base){
    const pts = arr.map(t=>t.P); const sg = arr.map(t=>t.SG);
    const meanP = pts.reduce((a,b)=>a+b,0)/pts.length;
    const sdP = Math.sqrt(pts.reduce((s,x)=>s+(x-meanP)**2,0)/pts.length) || 1;
    return arr.map(t=>{
      const r = base + ((t.P-meanP)/sdP)*3 + t.SG*0.4 + randn(0,1);
      return { id: crypto.randomUUID(), name:t.name, rating: clamp(Math.round(r*1e2)/1e2, 55, 95),
        titles:{A:0,B:0,C:0}, cupTitles:0 };
    });
  }
  return {
    season: 1,
    config: { avgGoals: 2.7, homeEdge: 0.12, perfSigma: 0.08, seasonSigma: 0.05 },
    divisions: [
      { code:"A", name:"Divisão A", teams: computeRatings(A, 82), fixtures:[], round:0, table:[] },
      { code:"B", name:"Divisão B", teams: computeRatings(B, 76), fixtures:[], round:0, table:[] },
      { code:"C", name:"Divisão C", teams: computeRatings(C, 70), fixtures:[], round:0, table:[] },
    ],
    history: [],
    cup: { rounds:[], alive:[], stage:0, seasonOf: 0, champion:null, perDivision: 16 }
  };
}

// ===== fixtures (double round-robin) =====
function makeFixtures(teams){
  // Circle method
  const n = teams.length;
  const arr = teams.map(t=>t.id);
  if(n%2===1){ arr.push(null); } // bye if odd
  const rounds = (arr.length-1)*2;
  const half = arr.length/2;
  const out = [];
  let left = arr.slice(0,half), right = arr.slice(half).reverse();
  for(let r=0;r<rounds;r++){
    const legs = [];
    for(let i=0;i<half;i++){
      const a = left[i], b = right[i];
      if(a && b){
        // invert mando no 2º turno
        const home = (r<rounds/2) ? a : b;
        const away = (r<rounds/2) ? b : a;
        legs.push({home, away, played:false, score:null});
      }
    }
    out.push(legs);
    // rotate (ignora null)
    const fixed = left[0];
    const moved = left.splice(1).concat(right.splice(0,1));
    right.push(moved.pop());
    left = [fixed].concat(moved);
  }
  return out;
}

// ===== simulation model =====
function teamById(id){
  for(const d of state.divisions){ for(const t of d.teams){ if(t.id===id) return t; } }
  return null;
}

function strength(t){
  // rating com ruído sazonal embutido no começo da temporada
  if(t._seasonMul==null){
    t._seasonMul = 1 + randn(0, state.config.seasonSigma);
  }
  return t.rating * t._seasonMul;
}

function simMatch(home, away){
  const cfg = state.config;
  // forças com oscilação de partida
  const sh = strength(home) * (1 + randn(0, cfg.perfSigma));
  const sa = strength(away) * (1 + randn(0, cfg.perfSigma));

  const totalGoals = Math.max(0.8, cfg.avgGoals + randn(0, 0.25));
  const homeBias = 0.5 + cfg.homeEdge; // fração para casa
  // alocação proporcional à força com leve vantagem de mando
  const rh = sh * homeBias, ra = sa * (1 - cfg.homeEdge);
  const ratioH = rh / (rh + ra);
  const muH = clamp(totalGoals * ratioH, 0.2, 5.0);
  const muA = clamp(totalGoals * (1 - ratioH), 0.2, 5.0);

  const gH = samplePoisson(muH);
  const gA = samplePoisson(muA);

  return [gH, gA];
}

function samplePoisson(lambda){
  // Knuth
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do{ k++; p *= rnd(); } while(p > L);
  return k-1;
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
      m.score = simMatch(home, away);
      m.played = true;
    }
  }
  div.round++;
  computeTable(div);
  return true;
}

function playAllRounds(div){
  while(playNextRound(div)) {}
}

// ===== season close (promotions & relegations) =====

function endSeason(){
  const summary = { season: state.season, champions: {}, tables: {}, date: new Date().toISOString() };
  for(const d of state.divisions){
    while(d.round < d.fixtures.length){ playNextRound(d); }
    const champ = d.table[0];
    const team = teamById(champ.id);
    team.titles[d.code] = (team.titles[d.code]||0)+1;
    summary.champions[d.code] = team.name;
    summary.tables[d.code] = d.table.map(r=>({id:r.id,name:r.name,P:r.P,SG:r.SG,GP:r.GP,GC:r.GC}));
  }

  function moveBetween(upper, lower){
    // usa posições finais diretamente da tabela (sem reordenar arrays base)
    const bottom4Ids = upper.table.slice(-4).map(r=>r.id);
    const top4Ids    = lower.table.slice(0,4).map(r=>r.id);

    const down = bottom4Ids.map(id=> upper.teams.find(t=>t.id===id)).filter(Boolean);
    const up   = top4Ids.map(id=> lower.teams.find(t=>t.id===id)).filter(Boolean);

    const upperKeep = upper.teams.filter(t=> !bottom4Ids.includes(t.id));
    const lowerKeep = lower.teams.filter(t=> !top4Ids.includes(t.id));

    upper.teams = upperKeep.concat(up);
    lower.teams = lowerKeep.concat(down);
  }
  const A = state.divisions.find(d=>d.code==="A");
  const B = state.divisions.find(d=>d.code==="B");
  const C = state.divisions.find(d=>d.code==="C");
  moveBetween(A,B);
  moveBetween(B,C);

  for(const d of state.divisions){
    d.fixtures = []; d.round = 0; d.table = [];
    for(const t of d.teams){ delete t._seasonMul; }
  }

  state.history.unshift(summary);
  state.season += 1;
  saveState();
}

// ===== CUP =====

function seedCup(perDivision){
  state.cup = { rounds:[], alive:[], stage:0, seasonOf: state.season, champion:null, perDivision };
  const picks = [];
  for(const d of state.divisions){
    let ordered = (d.table && d.table.length) ? d.table.slice() : d.teams.map(t=>({id:t.id,name:t.name,P:0,SG:0}));
    const take = Math.min(perDivision, ordered.length);
    for(let i=0;i<take;i++){ picks.push( ordered[i].id ); }
  }
  const pow2 = 1<<Math.floor(Math.log2(Math.max(2, picks.length)));
  const field = picks.slice(0, pow2);
  field.sort(()=>rnd()-0.5);
  state.cup.alive = field.slice();
  state.cup.rounds = []; state.cup.stage = 0; state.cup.champion = null;
  saveState();
}

function teamByName(name){
  for(const d of state.divisions){ for(const t of d.teams){ if(t.name===name) return t; } }
  return null;
}

function playCupRound(){
  const ids = state.cup.alive.slice();
  if(ids.length<=1) return false;
  const pairs = [];
  for(let i=0;i<ids.length;i+=2){
    pairs.push([ids[i], ids[i+1]]);
  }
  const results = [];
  for(const [aId,bId] of pairs){
    const A = teamById(aId), B = teamById(bId);
    // copa não tem mando — campo neutro
    let [ga, gb] = simMatch(A,B);
    // desempate por prorrogação "virtual"
    if(ga===gb){
      const bumpA = randn(0,0.2)+strength(A);
      const bumpB = randn(0,0.2)+strength(B);
      if(bumpA>bumpB) ga++; else gb++;
    }
    const win = ga>gb ? A.id : B.id;
    results.push({home:A.name,away:B.name,score:[ga,gb],winner:teamById(win).name});
  }
  state.cup.rounds.push(results);
  state.cup.alive = results.map(r=> teamByName(r.winner).id );
  if(state.cup.alive.length===1){
    const champion = teamById(state.cup.alive[0]);
    champion.cupTitles = (champion.cupTitles||0)+1;
    state.cup.champion = champion.name;
  }
  saveState();
  return true;
}

function playCupAll(){ while(playCupRound()){} }

// ===== RENDER =====
function render(){
  // side tabs
  const tabs = $$('.tab-btn');
  tabs.forEach(btn=>btn.onclick=()=>{
    tabs.forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    $$('.tab').forEach(s=>s.classList.remove('visible'));
    $('#tab-'+btn.dataset.tab).classList.add('visible');
  });

  // DASHBOARD
  const dash = $('#dashDivisions'); dash.innerHTML='';
  for(const d of state.divisions){
    const card = document.createElement('div'); card.className='card';
    card.innerHTML = `<h3>${d.name} — Temporada ${state.season}</h3>
      <div class="small">Rodada ${d.round}/${d.fixtures.length||((d.teams.length-1)*2)}</div>
      <table class="table"><thead><tr><th>#</th><th>Time</th><th>P</th><th>J</th><th>V</th><th>SG</th></tr></thead><tbody></tbody></table>`;
    const tb = card.querySelector('tbody');
    computeTable(d); // atual
    (d.table.slice(0,10)).forEach((r,i)=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${i+1}</td><td>${r.name}</td><td>${r.P}</td><td>${r.J}</td><td>${r.V}</td><td>${r.SG}</td>`;
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
            const h = teamById(m.home).name, a = teamById(m.away).name;
            const sc = m.played ? `${m.score[0]} x ${m.score[1]}` : '—';
            return `<div class="match"><div class="row">
              <div class="team">${h}</div><div>${sc}</div><div class="team">${a}</div></div></div>`;
          }).join('') } </div>
        </div>
      </div>`;
    // fill table
    computeTable(d);
    const tbody = sec.querySelector('tbody');
    d.table.forEach((r,i)=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${i+1}</td><td>${r.name}</td><td>${r.P}</td><td>${r.J}</td><td>${r.V}</td><td>${r.E}</td><td>${r.D}</td><td>${r.GP}</td><td>${r.GC}</td><td>${r.SG}</td>`;
      tbody.appendChild(tr);
    });
    // actions
    const [btnGen, btnRound, btnAll] = sec.querySelectorAll('button');
    btnGen.onclick = ()=>{ d.fixtures = makeFixtures(d.teams); d.round=0; d.table=[]; saveState(); };
    btnRound.onclick = ()=>{ playNextRound(d); saveState(); };
    btnAll.onclick = ()=>{ playAllRounds(d); saveState(); };
    area.appendChild(sec);
  }

  // CUP
  $('#cupTake').value = state.cup.perDivision || 16;
  const cup = $('#cupArea'); cup.innerHTML='';
  if(state.cup.alive.length>0){
    // render bracket
    const bracket = document.createElement('div'); bracket.className='bracket';
    const rounds = state.cup.rounds.slice();
    let working = rounds.length ? rounds : [];
    // build columns; if ainda não jogou nenhuma, mostra pares baseados nos vivos
    if(working.length===0){
      const ids = state.cup.alive;
      const pairs = []; for(let i=0;i<ids.length;i+=2){ pairs.push([teamById(ids[i]).name, teamById(ids[i+1]).name]); }
      working = [ pairs.map(([a,b])=>({home:a,away:b,score:null,winner:null})) ];
    }
    working.forEach((matches, idx)=>{
      const col = document.createElement('div'); col.className='round';
      col.innerHTML = `<h4>Fase ${idx+1}</h4>`;
      matches.forEach(m=>{
        const div = document.createElement('div'); div.className='match';
        const row1 = document.createElement('div'); row1.className='row' + (m.score && m.score[0]>m.score[1] ? ' win':'');
        const row2 = document.createElement('div'); row2.className='row' + (m.score && m.score[1]>m.score[0] ? ' win':'');
        row1.innerHTML = `<div class="team">${m.home}</div><div>${m.score?m.score[0]:'-'}</div>`;
        row2.innerHTML = `<div class="team">${m.away}</div><div>${m.score?m.score[1]:'-'}</div>`;
        div.appendChild(row1); div.appendChild(row2);
        if(m.winner){ const w = document.createElement('div'); w.className='small'; w.textContent = `Vencedor: ${m.winner}`; div.appendChild(w); }
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
    cup.innerHTML = `<div class="card small">Monte a copa com <span class="kbd">Montar Copa</span>. Ela usa os <b>primeiros N</b> de cada divisão (se houver menos times, pega todos). O campo é cortado para potência de 2 (64,32,16,8...).</div>`;
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
            return `<div><h4>Divisão ${code} — Campeão: <span class="badge ok">${h.champions[code]}</span></h4>
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

  const editor = $('#teamsEditor'); editor.innerHTML='';
  state.divisions.forEach(d=>{
    const wrap = document.createElement('div'); wrap.className='card';
    wrap.innerHTML = `<h3>${d.name}</h3>`;
    const tbl = document.createElement('table'); tbl.className='table';
    tbl.innerHTML = '<thead><tr><th>Time</th><th>Rating</th><th>Títulos A/B/C</th><th>Copa</th></tr></thead>';
    const tb = document.createElement('tbody'); tbl.appendChild(tb);
    d.teams.forEach(t=>{
      const tr = document.createElement('tr');
      const tit = `${t.titles.A||0}/${t.titles.B||0}/${t.titles.C||0}`;
      tr.innerHTML = `<td>${t.name}</td>
        <td><input type="number" step="0.1" min="40" max="99" value="${t.rating}" data-id="${t.id}" class="ratingInput"></td>
        <td>${tit}</td><td>${t.cupTitles||0}</td>`;
      tb.appendChild(tr);
    });
    wrap.appendChild(tbl);
    editor.appendChild(wrap);
  });

  // bind inputs
  $$('#teamsEditor .ratingInput').forEach(inp=>{
    inp.onchange = ()=>{
      const t = teamById(inp.dataset.id); t.rating = parseFloat(inp.value);
      saveState();
    };
  });
}

// ===== bindings & init =====
let state = loadState() || seedTeams();
ensureFixtures();
computeTable(state.divisions[0]); computeTable(state.divisions[1]); computeTable(state.divisions[2]);
render();
sanityCheck(true);

// dashboard buttons
$('#btnNextRoundAll').onclick = ()=>{ state.divisions.forEach(d=>playNextRound(d)); saveState(); };
$('#btnPlayAll').onclick = ()=>{ state.divisions.forEach(d=>playAllRounds(d)); saveState(); };
$('#btnNewSeason').onclick = ()=>{ endSeason(); };

// cup buttons
$('#btnCupSeed').onclick = ()=>{ const n = parseInt($('#cupTake').value||'16',10); seedCup(n); };
$('#btnCupRound').onclick = ()=>{ playCupRound(); };
$('#btnCupAll').onclick = ()=>{ playCupAll(); };

// settings bindings
$('#btnSanity').onclick = ()=>{ const fixed = sanityCheck(true); alert(fixed? 'Dados corrigidos.' : 'Tudo ok!'); };
$('#cfgAvgGoals').onchange = ()=>{ state.config.avgGoals = parseFloat($('#cfgAvgGoals').value); saveState(); };
$('#cfgHomeEdge').onchange = ()=>{ state.config.homeEdge = parseFloat($('#cfgHomeEdge').value); saveState(); };
$('#cfgPerfSigma').onchange = ()=>{ state.config.perfSigma = parseFloat($('#cfgPerfSigma').value); saveState(); };
$('#cfgSeasonSigma').onchange = ()=>{ state.config.seasonSigma = parseFloat($('#cfgSeasonSigma').value); saveState(); };

// export/import
$('#btnSave').onclick = ()=>{
  const blob = new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `clots-save-s${state.season}.json`; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};
$('#fileImport').onchange = (e)=>{
  const f = e.target.files[0]; if(!f) return;
  const fr = new FileReader();
  fr.onload = ()=>{
    try{ state = JSON.parse(fr.result); saveState(); }catch(err){ alert('Arquivo inválido'); }
  };
  fr.readAsText(f);
};
