// Matchvärde – läser data/latest.json (byggs av scripts/fetch.mjs) och ritar sidan.

const TZ = 'Europe/Stockholm';
const state = { data: null, view: 'matcher', comp: 'ALL', day: null };
const $ = sel => document.querySelector(sel);

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = p => (p == null ? '–' : Math.round(p * 100) + '%');
const odd = o => (o == null ? '–' : o.toFixed(2));
const signed = e => (e >= 0.0005 ? '+' : '') + (Math.round(e * 1000) / 10).toFixed(1) + '%';
const dayKey = iso => new Date(iso).toLocaleDateString('sv-SE', { timeZone: TZ });
const todayKey = () => dayKey(new Date().toISOString());
const clock = iso => new Date(iso).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const LIVE = new Set(['IN_PLAY', 'PAUSED']);
const UPCOMING = new Set(['SCHEDULED', 'TIMED']);
const PICK = { home: '1', draw: 'X', away: '2', over: 'Över 2,5', under: 'Under 2,5' };

function dayParts(key) {
  const d = new Date(key + 'T12:00:00Z');
  const diff = Math.round((Date.parse(key) - Date.parse(todayKey())) / 864e5);
  const name = diff === 0 ? 'Idag' : diff === 1 ? 'Imorgon' : diff === -1 ? 'Igår'
    : d.toLocaleDateString('sv-SE', { weekday: 'short', timeZone: 'UTC' });
  return { name, date: d.getUTCDate(), month: d.toLocaleDateString('sv-SE', { month: 'short', timeZone: 'UTC' }), today: diff === 0 };
}
const dayText = iso => { const p = dayParts(dayKey(iso)); return p.today || /^I/.test(p.name) ? p.name : `${p.name} ${p.date} ${p.month}`; };

function countdown(iso) {
  const min = Math.round((Date.parse(iso) - Date.now()) / 6e4);
  if (min <= 0) return 'Snart';
  if (min < 60) return `om ${min} min`;
  if (min < 24 * 60) return `om ${Math.floor(min / 60)} h ${min % 60} min`;
  return dayText(iso);
}

function crest(team, cls = 'crest') {
  return team?.crest
    ? `<img class="${cls}" src="${esc(team.crest)}" alt="" loading="lazy">`
    : `<span class="${cls} blank"></span>`;
}

function pickLabel(m, pick) {
  if (pick === 'home') return `${m.home.short} vinner`;
  if (pick === 'away') return `${m.away.short} vinner`;
  if (pick === 'draw') return 'Oavgjort';
  return PICK[pick] + ' mål';
}

const comps = () => state.data.competitions.filter(c => state.comp === 'ALL' || c.id === state.comp);
const allMatches = () => comps().flatMap(c => c.matches.map(m => ({ ...m, comp: c })));
const everyMatch = () => state.data.competitions.flatMap(c => c.matches.map(m => ({ ...m, comp: c })));

function standing(c, teamId) {
  for (const s of c.standings) {
    const r = s.rows.find(x => x.team.id === teamId);
    if (r) return { ...r, group: s.group, size: s.rows.length };
  }
  return null;
}

// ---------- Filter ----------

function renderChips() {
  const list = state.data.competitions.filter(c => c.matches.length || c.standings.length);
  const chip = (id, label, img) =>
    `<button class="chip${state.comp === id ? ' active' : ''}" data-comp="${id}">${img ? `<img src="${esc(img)}" alt="">` : ''}${esc(label)}</button>`;
  $('#chips').innerHTML = (state.view === 'tabeller' ? '' : chip('ALL', 'Alla ligor')) +
    list.filter(c => state.view !== 'tabeller' || c.standings.length).map(c => chip(c.id, c.name, c.emblem)).join('');
}

function renderDays(matches) {
  const days = [...new Set(matches.map(m => dayKey(m.utc)))].sort();
  const today = todayKey();
  if (!days.includes(state.day)) state.day = days.find(d => d >= today) ?? days[days.length - 1] ?? null;
  $('#days').innerHTML = days.map(d => {
    const p = dayParts(d);
    return `<button class="day${d === state.day ? ' active' : ''}${p.today ? ' today' : ''}" data-day="${d}"><small>${esc(p.name)}</small><b>${p.date}</b></button>`;
  }).join('');
  $('#days').querySelector('.active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
}

// ---------- Rullande resultatrad ----------

function renderTicker() {
  const now = Date.now();
  const all = everyMatch();
  const items = [
    ...all.filter(m => LIVE.has(m.status)).map(m => ['live', 'Live', m, `${m.score?.h ?? 0}–${m.score?.a ?? 0}`]),
    ...all.filter(m => UPCOMING.has(m.status)).flatMap(m => m.values.map(v => ({ m, v })))
      .sort((a, b) => b.v.edge - a.v.edge).slice(0, 6)
      .map(({ m, v }) => ['val', 'Värde ' + signed(v.edge), m, `${PICK[v.pick]} @ ${odd(v.odds)}`]),
    ...all.filter(m => m.status === 'FINISHED' && m.score && now - Date.parse(m.utc) < 3 * 864e5)
      .sort((a, b) => b.utc.localeCompare(a.utc)).slice(0, 16)
      .map(m => ['', 'Slut', m, `${m.score.h}–${m.score.a}`]),
  ];
  if (items.length < 4) { $('#ticker').hidden = true; return; }
  const html = items.map(([cls, tag, m, mid]) => `<button class="tk" data-match="${m.id}"><em class="${cls}">${esc(tag)}</em>
    ${crest(m.home)}<span>${esc(m.home.short)}</span><b>${esc(mid)}</b><span>${esc(m.away.short)}</span>${crest(m.away)}</button>`).join('');
  $('#ticker-track').innerHTML = html + html.replace(/<button class="tk"/g, '<button tabindex="-1" aria-hidden="true" class="tk"');
  $('#ticker').hidden = false;
}

// ---------- Matcher ----------

function bigBar(m) {
  const f = m.final, vals = new Set(m.values.map(v => v.pick));
  const parts = [['home', 'h'], ['draw', 'd'], ['away', 'a']];
  return `<div class="bigbar"><div class="bar">${parts.map(([k, c]) =>
    `<div class="${c}${vals.has(k) ? ' v' : ''}" style="flex:${Math.max(f[k] * 100, 1)}">${pct(f[k])}</div>`).join('')}</div>
    <div class="bar-labels"><span>${esc(m.home.short)}</span><span>Oavgjort</span><span>${esc(m.away.short)}</span></div></div>`;
}

function pickFocus(matches) {
  const score = m => {
    if (m.values.length) return 1000 + Math.max(...m.values.map(v => v.edge)) * 100;
    const ph = standing(m.comp, m.home.id), pa = standing(m.comp, m.away.id);
    const rank = ph && pa ? (ph.pos + pa.pos) / 2 : 15;
    return (m.comp.id === 'CL' ? 60 : 40) - rank + (LIVE.has(m.status) ? 50 : 0) + (m.final?.home != null ? 5 : 0);
  };
  return matches.slice().sort((a, b) => score(b) - score(a))[0];
}

function scoreboard(m) {
  const done = m.score && !UPCOMING.has(m.status);
  const live = LIVE.has(m.status);
  const mid = done
    ? `<b>${m.score.h}–${m.score.a}</b><small>${live ? '<span class="livedot"></span> Live' : 'Slutresultat'}</small>`
    : `<b>${clock(m.utc)}</b><small class="count">${countdown(m.utc)}</small>`;
  const sh = standing(m.comp, m.home.id), sa = standing(m.comp, m.away.id);
  return `${m.home.crest ? `<img class="glow h" src="${esc(m.home.crest)}" alt="">` : ''}
    ${m.away.crest ? `<img class="glow a" src="${esc(m.away.crest)}" alt="">` : ''}
    <div class="duel">
      <div class="side-t">${crest(m.home)}<span>${esc(m.home.short)}</span>${sh ? `<small>${sh.pos}:a · ${sh.pts} p</small>` : ''}</div>
      <div class="mid">${mid}</div>
      <div class="side-t">${crest(m.away)}<span>${esc(m.away.short)}</span>${sa ? `<small>${sa.pos}:a · ${sa.pts} p</small>` : ''}</div>
    </div>`;
}

function hero(m) {
  const done = m.score && !UPCOMING.has(m.status);
  const top = m.values.length ? 'Bästa värdet' : LIVE.has(m.status) ? 'Live nu' : 'Matchen i fokus';
  const v = m.values.slice().sort((a, b) => b.edge - a.edge)[0];
  const foot = v ? `Värde: <b>${esc(pickLabel(m, v.pick))} @ ${odd(v.odds)}</b> (${signed(v.edge)})`
    : m.model ? `Förväntade mål <b>${m.model.xg[0].toFixed(1)} – ${m.model.xg[1].toFixed(1)}</b> · Båda gör mål <b>${pct(m.model.p.btts)}</b>` : '';
  return `<button class="hero" data-match="${m.id}">
    <div class="hero-top"><span class="label">${top}</span><small>${esc(m.comp.name)}</small></div>
    ${scoreboard(m)}
    ${!done && m.final?.home != null ? bigBar(m) : ''}
    <div class="hero-foot"><span>${foot}</span><span class="go">Se hela analysen →</span></div>
  </button>`;
}

function matchRow(m) {
  const live = LIVE.has(m.status);
  const done = m.score && !UPCOMING.has(m.status);
  const time = live ? '<span class="time live"><span class="livedot"></span>LIVE</span>'
    : m.status === 'FINISHED' ? '<span class="time ft">SLUT</span>'
    : m.status === 'POSTPONED' ? '<span class="time ft">UPPSK.</span>'
    : `<span class="time">${clock(m.utc)}</span>`;
  const res = side => !done || m.score.h === m.score.a ? ''
    : (side === 'h' ? m.score.h > m.score.a : m.score.a > m.score.h) ? 'win' : 'lose';
  let side = '';
  if (done) {
    side = `<div class="score"><span class="${res('h')}">${m.score.h}</span><span class="${res('a')}">${m.score.a}</span></div>`;
  } else if (m.final?.home != null) {
    const ks = [['home', 'h', '1'], ['draw', 'd', 'X'], ['away', 'a', '2']];
    const top = ks.reduce((a, b) => (m.final[a[0]] >= m.final[b[0]] ? a : b))[0];
    const vals = new Set(m.values.map(v => v.pick));
    side = `<div class="probs">${ks.map(([k, c, l]) =>
      `<span class="k-${c}${vals.has(k) ? ' val' : k === top ? ' top' : ''}"><span><small>${l}</small>${pct(m.final[k])}</span><i style="width:${Math.round(m.final[k] * 100)}%"></i></span>`).join('')}</div>`;
  }
  return `<button class="match${m.values?.length ? ' has-val' : ''}" data-match="${m.id}">
    ${time}
    <span class="teams">
      <span class="team ${res('h')}">${crest(m.home)}<span>${esc(m.home.short)}</span></span>
      <span class="team ${res('a')}">${crest(m.away)}<span>${esc(m.away.short)}</span></span>
    </span>
    <span class="side">${side}</span>
  </button>`;
}

function viewMatches() {
  const matches = allMatches();
  renderDays(matches);
  const todays = matches.filter(m => dayKey(m.utc) === state.day).sort((a, b) => a.utc.localeCompare(b.utc));
  if (!todays.length) return '<p class="empty">Inga matcher de närmaste dagarna.</p>';
  const byComp = new Map();
  for (const m of todays) byComp.set(m.comp, [...(byComp.get(m.comp) ?? []), m]);
  return hero(pickFocus(todays)) + [...byComp].map(([c, ms]) => `<section class="group">
    <div class="group-head">${c.emblem ? `<img src="${esc(c.emblem)}" alt="">` : ''}<b>${esc(c.name)}</b><small>${esc(c.area)}</small>
      <small class="n">${ms.length} ${ms.length === 1 ? 'match' : 'matcher'}</small></div>
    ${ms.map(matchRow).join('')}
  </section>`).join('');
}

// ---------- Värdebets ----------

function viewValues() {
  $('#days').innerHTML = '';
  const intro = `<div class="intro">
    <div class="formula">Chans × odds − 1<small>= värde</small></div>
    <p>Vi blandar vår modell med vad hela marknaden tror (spelbolagens odds utan deras marginal) och jämför med <b>det bästa oddset som finns</b>. Allt över <b>+4 %</b> hamnar här.</p>
    <p>Ett värdebet kan fortfarande förlora. Det betyder bara att oddset ser för högt ut i längden. Själva spelet lägger du själv, om du vill.</p>
  </div>`;
  if (!state.data.oddsUpdated) {
    return intro + `<div class="locked"><b>Oddsen kopplas snart in</b>
      <span>När odds-nyckeln är på plats fylls den här sidan med dagens bästa värden.</span></div>`;
  }
  const bets = allMatches()
    .filter(m => UPCOMING.has(m.status))
    .flatMap(m => m.values.map(v => ({ ...v, m })))
    .sort((a, b) => b.edge - a.edge);
  if (!bets.length) return intro + '<div class="locked"><b>Inga värdebets just nu</b><span>Marknaden verkar rätt prissatt. Titta in igen efter nästa uppdatering.</span></div>';
  return intro + `<div class="vgrid">${bets.map((v, i) => {
    const conf = v.m.model ? v.m.model.conf : 'marknad';
    return `<button class="vcard" data-match="${v.m.id}" style="animation-delay:${Math.min(i, 10) * 40}ms">
      <div class="meta">${v.m.comp.emblem ? `<img src="${esc(v.m.comp.emblem)}" alt="">` : ''}${esc(v.m.comp.name)} · ${dayText(v.m.utc)} ${clock(v.m.utc)}</div>
      <div class="vs">${crest(v.m.home)}<span>${esc(v.m.home.short)}</span><small>–</small><span>${esc(v.m.away.short)}</span>${crest(v.m.away)}</div>
      <div class="big">
        <div class="pick">${esc(pickLabel(v.m, v.pick))}<small>bäst hos <b>${esc(v.book)}</b></small></div>
        <div class="edge"><b>${signed(v.edge)}</b><small>värde</small></div>
      </div>
      <div class="nums">
        <div><small>Odds</small><b>${odd(v.odds)}</b></div>
        <div><small>Vår chans</small><b>${pct(v.p)}</b></div>
        <div><small>Marknaden</small><b>${pct(v.fair)}</b></div>
      </div>
      <div><span class="conf ${conf}">${conf === 'marknad' ? 'Bara odds' : 'Säkerhet: ' + conf}</span></div>
    </button>`;
  }).join('')}</div>`;
}

// ---------- Tabeller ----------

function formIcons(list) {
  return `<span class="form">${(list ?? []).slice().reverse().map(f =>
    `<i class="${f.r}" title="${esc((f.home ? 'mot ' : 'borta mot ') + f.opp + ' ' + f.gf + '–' + f.ga)}">${f.r}</i>`).join('')}</span>`;
}

const ZONE_COLOR = { cl: 'home', el: 'away', po: 'gold', rel: 'live' };

function zones(c, size) {
  if (c.id === 'CL' && size > 20) {
    return { rule: p => (p <= 8 ? 'cl' : p <= 24 ? 'po' : 'rel'), legend: [['cl', 'Direkt till åttondel'], ['po', 'Playoff'], ['rel', 'Utslagen']] };
  }
  if (['PL', 'PD', 'BL1', 'SA', 'FL1'].includes(c.id)) {
    const playoff = size === 18; // Bundesliga och Ligue 1 har kvalplats
    return {
      rule: p => (p <= 4 ? 'cl' : p <= 6 ? 'el' : playoff && p === size - 2 ? 'po' : p > size - (playoff ? 2 : 3) ? 'rel' : ''),
      legend: [['cl', 'Champions League'], ['el', 'Europa League'], ...(playoff ? [['po', 'Kval']] : []), ['rel', 'Nedflyttning']],
    };
  }
  return null;
}

function viewTables() {
  $('#days').innerHTML = '';
  const withTables = state.data.competitions.filter(c => c.standings.length);
  if (!withTables.length) return '<p class="empty">Inga tabeller ännu.</p>';
  if (!withTables.some(c => c.id === state.comp)) { state.comp = withTables[0].id; renderChips(); }
  const c = withTables.find(x => x.id === state.comp);
  return c.standings.map(s => {
    const z = zones(c, s.rows.length);
    return `<div class="table-wrap">
    ${s.group ? `<div class="group-head"><b>${esc(s.group)}</b></div>` : ''}
    <table>
      <thead><tr><th>#</th><th style="text-align:left">Lag</th><th>S</th><th class="hide-sm">V</th><th class="hide-sm">O</th><th class="hide-sm">F</th><th class="hide-sm">Mål</th><th>+/-</th><th>P</th><th class="hide-sm">Form</th></tr></thead>
      <tbody>${s.rows.map(r => `<tr class="${z ? 'z-' + z.rule(r.pos) : ''}">
        <td class="pos">${r.pos}</td>
        <td class="team-cell"><div>${crest(r.team)}<span>${esc(r.team.short)}</span></div></td>
        <td>${r.p}</td><td class="hide-sm">${r.w}</td><td class="hide-sm">${r.d}</td><td class="hide-sm">${r.l}</td>
        <td class="hide-sm">${r.gf}–${r.ga}</td>
        <td>${r.gd > 0 ? '+' : ''}${r.gd}</td><td class="pts">${r.pts}</td>
        <td class="hide-sm">${formIcons(c.form[r.team.id])}</td>
      </tr>`).join('')}</tbody>
    </table>
    ${z ? `<div class="legend">${z.legend.map(([k, l]) => `<span style="--z:var(--${ZONE_COLOR[k]})">${l}</span>`).join('')}</div>` : ''}
  </div>`;
  }).join('');
}

// ---------- Matchdetaljer ----------

function openMatch(id) {
  const m = everyMatch().find(x => String(x.id) === String(id));
  if (!m) return;
  const c = m.comp, f = m.final ?? {}, mo = m.model, mk = m.market;
  const done = m.score && !UPCOMING.has(m.status);
  const sh = standing(c, m.home.id), sa = standing(c, m.away.id);
  const vals = new Set(m.values.map(v => v.pick));

  let html = `<div class="board">
    <div class="sub">${esc(c.name)}${m.matchday && m.stage === 'REGULAR_SEASON' ? ' · Omgång ' + m.matchday : ''} · ${dayText(m.utc)}</div>
    ${scoreboard(m)}
  </div>`;

  if (m.values.length) {
    html += `<div class="box valbox"><span class="label">Värdebet</span>${m.values.map(v => `<div class="valrow">
      <div><b>${esc(pickLabel(m, v.pick))} @ ${odd(v.odds)}</b><br><small>hos ${esc(v.book)} · vår chans ${pct(v.p)} · marknaden ${pct(v.fair)}</small></div>
      <em>${signed(v.edge)}</em></div>`).join('')}</div>`;
  }

  if (f.home != null && !done) {
    html += `<div class="box"><span class="label">Vinstchans</span>${bigBar(m)}
      ${mo && mk?.h2h ? `<p class="note">Modell ${pct(mo.p.home)} / ${pct(mo.p.draw)} / ${pct(mo.p.away)} · Marknaden ${pct(mk.h2h.home.fair)} / ${pct(mk.h2h.draw.fair)} / ${pct(mk.h2h.away.fair)}</p>` : ''}
      ${!mo ? '<p class="note">Ingen statistik för den här turneringen – bara spelbolagens odds.</p>' : ''}</div>`;
  }

  if (mo) {
    html += `<div class="row2">
      <div class="box"><span class="label">Förväntade mål</span>
        <div class="xg">${mo.xg[0].toFixed(2)}<small>XG</small>${mo.xg[1].toFixed(2)}</div>
        <div class="stat"><span>Över 2,5 mål</span><b>${pct(f.over ?? mo.p.over)}</b></div>
        <div class="stat"><span>Båda lagen gör mål</span><b>${pct(mo.p.btts)}</b></div>
        <div class="stat"><span>Modellens säkerhet</span><span class="conf ${mo.conf}">${mo.conf}</span></div>
      </div>
      <div class="box"><span class="label">Troligaste resultat</span>
        <div class="scores">${mo.scores.map(s => `<span>${s.h}–${s.a}<small>${pct(s.p)}</small></span>`).join('')}</div>
      </div>
    </div>`;
  }

  if (m.home.id && (c.form[m.home.id] || c.form[m.away.id])) {
    const row = (t, s) => `<div class="formrow"><div>${crest(t)}<span>${esc(t.short)}</span>${s ? `<small>${s.pos}:a</small>` : ''}</div>${formIcons(c.form[t.id])}</div>`;
    html += `<div class="box"><span class="label">Form · senaste 5</span>${row(m.home, sh)}${row(m.away, sa)}</div>`;
  }

  if (mk) {
    const rows = [];
    if (mk.h2h) for (const k of ['home', 'draw', 'away']) rows.push([k, mk.h2h[k]]);
    if (mk.ou25) for (const k of ['over', 'under']) rows.push([k, mk.ou25[k]]);
    const name = k => k === 'home' ? '1 · ' + m.home.short : k === 'away' ? '2 · ' + m.away.short : k === 'draw' ? 'X · Oavgjort' : PICK[k] + ' mål';
    html += `<div class="box"><span class="label">Odds</span><div class="odds-wrap"><table class="odds-table">
      <thead><tr><th>Spel</th><th>Bäst</th><th>Hos</th><th>Vår chans</th><th>Värde</th></tr></thead>
      <tbody>${rows.map(([k, o]) => `<tr class="${vals.has(k) ? 'val' : ''}"><td>${esc(name(k))}</td>
        <td class="best">${odd(o.odds)}</td><td>${esc(o.book)}</td><td>${pct(f[k])}</td>
        <td>${f[k] != null ? signed(f[k] * o.odds - 1) : '–'}</td></tr>`).join('')}</tbody></table></div>
      ${mk.books?.length ? `<details><summary class="note">Alla spelbolag (1X2)</summary><div class="odds-wrap"><table class="odds-table">
        <tbody>${mk.books.map(b => `<tr><td>${esc(b.name)}</td><td>${odd(b.home)}</td><td>${odd(b.draw)}</td><td>${odd(b.away)}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
    </div>`;
  } else if (UPCOMING.has(m.status)) {
    html += '<p class="note">Inga odds för matchen än – de hämtas en gång per dygn.</p>';
  }

  $('#sheet-body').innerHTML = html;
  $('#sheet').hidden = false;
  $('#sheet .sheet-card').scrollTop = 0;
  document.body.style.overflow = 'hidden';
}

function closeSheet() {
  $('#sheet').hidden = true;
  document.body.style.overflow = '';
}

// ---------- Ritning och händelser ----------

function render() {
  try { history.replaceState(null, '', state.view === 'matcher' ? location.pathname : '#' + state.view); } catch {}
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
  renderChips();
  $('#main').innerHTML = state.view === 'matcher' ? viewMatches() : state.view === 'varde' ? viewValues() : viewTables();
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-view],[data-comp],[data-day],[data-match],[data-close]');
  if (!t) return;
  if (t.dataset.view) {
    state.view = t.dataset.view;
    if (state.view !== 'tabeller' && !state.data.competitions.some(c => c.id === state.comp && c.matches.length)) state.comp = 'ALL';
    render();
    window.scrollTo({ top: 0 });
  } else if (t.dataset.comp) { state.comp = t.dataset.comp; render(); }
  else if (t.dataset.day) { state.day = t.dataset.day; render(); }
  else if (t.dataset.match) openMatch(t.dataset.match);
  else if ('close' in t.dataset) closeSheet();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

async function load() {
  try {
    const res = await fetch('data/latest.json?t=' + Date.now());
    if (!res.ok) throw new Error(res.status);
    state.data = await res.json();
  } catch {
    $('#main').innerHTML = '<p class="empty">Ingen data ännu. Den hämtas automatiskt några gånger per dygn.</p>';
    return;
  }
  const ts = iso => new Date(iso).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short', timeZone: TZ });
  $('#updated').textContent = `Statistik uppdaterad ${ts(state.data.updated)}` +
    (state.data.oddsUpdated ? ` · odds ${ts(state.data.oddsUpdated)}` : '');
  const hash = location.hash.slice(1);
  if (['varde', 'tabeller'].includes(hash)) state.view = hash;
  const m = new URLSearchParams(location.search).get('match');
  renderTicker();
  render();
  if (m) openMatch(m);
}

load();
