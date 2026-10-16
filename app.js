// Matchvärde – läser data/latest.json (byggs av scripts/fetch.mjs) och ritar sidan.

const TZ = 'Europe/Stockholm';
const state = { data: null, view: 'matcher', comp: 'ALL', day: null };
const $ = sel => document.querySelector(sel);

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = p => (p == null ? '–' : Math.round(p * 100) + '%');
const odd = o => (o == null ? '–' : o.toFixed(2));
const dayKey = iso => new Date(iso).toLocaleDateString('sv-SE', { timeZone: TZ });
const clock = iso => new Date(iso).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const LIVE = new Set(['IN_PLAY', 'PAUSED']);
const UPCOMING = new Set(['SCHEDULED', 'TIMED']);
const PICK = { home: '1', draw: 'X', away: '2', over: 'Över 2,5', under: 'Under 2,5' };

function dayLabel(key) {
  const today = dayKey(new Date().toISOString());
  const diff = Math.round((Date.parse(key) - Date.parse(today)) / 864e5);
  if (diff === 0) return ['Idag', ''];
  if (diff === 1) return ['Imorgon', ''];
  if (diff === -1) return ['Igår', ''];
  const d = new Date(key + 'T12:00:00Z');
  return [
    d.toLocaleDateString('sv-SE', { weekday: 'short', timeZone: 'UTC' }),
    d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
  ];
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

function statusText(m) {
  if (LIVE.has(m.status)) return ['Live', 'live'];
  if (m.status === 'FINISHED') return ['Slut', ''];
  if (m.status === 'POSTPONED') return ['Uppsk.', ''];
  if (m.status === 'CANCELLED') return ['Inställd', ''];
  return [clock(m.utc), ''];
}

const comps = () => state.data.competitions.filter(c => state.comp === 'ALL' || c.id === state.comp);
const allMatches = () => comps().flatMap(c => c.matches.map(m => ({ ...m, comp: c })));

// ---------- Filter ----------

function renderChips() {
  const list = state.data.competitions.filter(c => c.matches.length || c.standings.length);
  const chip = (id, label, img) =>
    `<button class="chip${state.comp === id ? ' active' : ''}" data-comp="${id}">${img ? `<img src="${esc(img)}" alt="">` : ''}${esc(label)}</button>`;
  $('#chips').innerHTML = (state.view === 'tabeller' ? '' : chip('ALL', 'Alla')) +
    list.filter(c => state.view !== 'tabeller' || c.standings.length).map(c => chip(c.id, c.name, c.emblem)).join('');
}

function renderDays(matches) {
  const days = [...new Set(matches.map(m => dayKey(m.utc)))].sort();
  const today = dayKey(new Date().toISOString());
  if (!days.includes(state.day)) state.day = days.find(d => d >= today) ?? days[days.length - 1] ?? null;
  $('#days').innerHTML = days.map(d => {
    const [a, b] = dayLabel(d);
    return `<button class="day${d === state.day ? ' active' : ''}" data-day="${d}">${a}${b ? `<small>${b}</small>` : ''}</button>`;
  }).join('');
  $('#days').querySelector('.active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
}

// ---------- Vyer ----------

function matchRow(m) {
  const [st, cls] = statusText(m);
  const done = m.score && !UPCOMING.has(m.status);
  const win = side => done && (side === 'h' ? m.score.h > m.score.a : m.score.a > m.score.h) ? ' win' : '';
  let side;
  if (done) {
    side = `<div class="score"><span>${m.score.h}</span><span>${m.score.a}</span></div>`;
  } else if (m.final?.home != null) {
    const ks = ['home', 'draw', 'away'];
    const top = ks.reduce((a, b) => (m.final[a] >= m.final[b] ? a : b));
    const vals = new Set(m.values.map(v => v.pick));
    side = `<div class="probs">${ks.map(k =>
      `<span class="${vals.has(k) ? 'val' : k === top ? 'top' : ''}">${pct(m.final[k])}</span>`).join('')}</div>`;
  } else side = '';
  return `<button class="match" data-match="${m.id}">
    <span class="time ${cls}">${st}</span>
    <span class="teams">
      <span class="team${win('h')}">${crest(m.home)}<span>${esc(m.home.short)}</span></span>
      <span class="team${win('a')}">${crest(m.away)}<span>${esc(m.away.short)}</span></span>
    </span>
    <span class="side">${m.values?.length ? '<span class="badge">VÄRDE</span>' : ''}${side}</span>
  </button>`;
}

function viewMatches() {
  const matches = allMatches();
  renderDays(matches);
  const todays = matches.filter(m => dayKey(m.utc) === state.day).sort((a, b) => a.utc.localeCompare(b.utc));
  if (!todays.length) return '<p class="empty">Inga matcher de närmaste dagarna.</p>';
  const byComp = new Map();
  for (const m of todays) byComp.set(m.comp, [...(byComp.get(m.comp) ?? []), m]);
  return [...byComp].map(([c, ms]) => `<section class="group">
    <div class="group-head">${c.emblem ? `<img src="${esc(c.emblem)}" alt="">` : ''}${esc(c.name)} <small>${esc(c.area)}</small></div>
    ${ms.map(matchRow).join('')}
  </section>`).join('');
}

function viewValues() {
  $('#days').innerHTML = '';
  const bets = allMatches()
    .filter(m => UPCOMING.has(m.status))
    .flatMap(m => m.values.map(v => ({ ...v, m })))
    .sort((a, b) => b.edge - a.edge);
  const intro = `<div class="intro"><b>Så funkar det:</b> vi blandar vår modells sannolikhet med marknadens
    (alla spelbolags odds med marginalen bortplockad) och jämför med det <b>bästa</b> oddset som finns.
    Värde = sannolikhet × odds − 1. Allt över +4% listas. Det betyder inte att spelet vinner,
    bara att oddset ser för högt ut på lång sikt.</div>`;
  if (!bets.length) return intro + '<p class="empty">Inga värdebets just nu.</p>';
  return intro + bets.map(v => {
    const conf = v.m.model ? v.m.model.conf : 'marknad';
    const [d1, d2] = dayLabel(dayKey(v.m.utc));
    return `<button class="value-card" data-match="${v.m.id}">
      <div class="meta">${esc(v.m.comp.name)} · ${d1} ${d2} ${clock(v.m.utc)}</div>
      <div class="edge"><b>+${(v.edge * 100).toFixed(1)}%</b><small>värde</small></div>
      <div class="pick">${esc(pickLabel(v.m, v.pick))} @ ${odd(v.odds)}</div>
      <div class="line">
        <span>${esc(v.m.home.short)} – ${esc(v.m.away.short)}</span>
        <span>hos <b>${esc(v.book)}</b></span>
        <span>vår chans <b>${pct(v.p)}</b></span>
        <span>marknaden <b>${pct(v.fair)}</b></span>
        <span class="conf ${conf}">${conf === 'marknad' ? 'bara odds' : 'säkerhet: ' + conf}</span>
      </div>
    </button>`;
  }).join('');
}

function formIcons(list) {
  return `<span class="form">${(list ?? []).slice().reverse().map(f =>
    `<i class="${f.r}" title="${esc((f.home ? 'mot ' : 'borta mot ') + f.opp + ' ' + f.gf + '–' + f.ga)}">${f.r}</i>`).join('')}</span>`;
}

function viewTables() {
  $('#days').innerHTML = '';
  const withTables = state.data.competitions.filter(c => c.standings.length);
  if (!withTables.length) return '<p class="empty">Inga tabeller ännu.</p>';
  if (!withTables.some(c => c.id === state.comp)) { state.comp = withTables[0].id; renderChips(); }
  const c = withTables.find(x => x.id === state.comp);
  return c.standings.map(s => `<div class="table-wrap">
    ${s.group ? `<div class="group-head">${esc(s.group)}</div>` : ''}
    <table>
      <thead><tr><th>#</th><th style="text-align:left">Lag</th><th>S</th><th class="hide-sm">V</th><th class="hide-sm">O</th><th class="hide-sm">F</th><th>+/-</th><th>P</th><th class="hide-sm">Form</th></tr></thead>
      <tbody>${s.rows.map(r => `<tr>
        <td class="pos">${r.pos}</td>
        <td class="team-cell"><div>${crest(r.team)}<span>${esc(r.team.short)}</span></div></td>
        <td>${r.p}</td><td class="hide-sm">${r.w}</td><td class="hide-sm">${r.d}</td><td class="hide-sm">${r.l}</td>
        <td>${r.gd > 0 ? '+' : ''}${r.gd}</td><td class="pts">${r.pts}</td>
        <td class="hide-sm">${formIcons(c.form[r.team.id])}</td>
      </tr>`).join('')}</tbody>
    </table>
  </div>`).join('');
}

// ---------- Matchdetaljer ----------

function bar(p, labels) {
  const w = p.map(x => Math.max(x * 100, 0));
  return `<div class="bar">${w.map((x, i) => `<div class="${'abc'[i]}" style="flex:${x}">${Math.round(x)}%</div>`).join('')}</div>
    <div class="bar-labels">${labels.map(l => `<span>${esc(l)}</span>`).join('')}</div>`;
}

function position(c, teamId) {
  for (const s of c.standings) {
    const r = s.rows.find(x => x.team.id === teamId);
    if (r) return `${r.pos}:a${s.group ? ' i ' + s.group : ''}, ${r.pts} p`;
  }
  return null;
}

function openMatch(id) {
  const m = state.data.competitions.flatMap(c => c.matches.map(x => ({ ...x, comp: c }))).find(x => String(x.id) === String(id));
  if (!m) return;
  const c = m.comp, f = m.final ?? {}, mo = m.model, mk = m.market;
  const [st] = statusText(m);
  const [d1, d2] = dayLabel(dayKey(m.utc));
  const mid = m.score && !UPCOMING.has(m.status)
    ? `${m.score.h} – ${m.score.a}<small>${st}</small>`
    : `${clock(m.utc)}<small>${d1} ${d2}</small>`;
  const vals = new Set(m.values.map(v => v.pick));
  let html = `<div class="head">
      <div class="t">${crest(m.home)}<span>${esc(m.home.name)}</span></div>
      <div class="mid">${mid}</div>
      <div class="t">${crest(m.away)}<span>${esc(m.away.name)}</span></div>
    </div>
    <p class="sub">${esc(c.name)}${m.matchday && !m.stage?.includes('FINAL') ? ' · omgång ' + m.matchday : ''}</p>`;

  for (const v of m.values) {
    html += `<div class="box" style="border:1px solid var(--green)"><h3 style="color:var(--green)">Värdebet</h3>
      <b>${esc(pickLabel(m, v.pick))} @ ${odd(v.odds)}</b> hos ${esc(v.book)} · vår chans ${pct(v.p)} · värde <b style="color:var(--green)">+${(v.edge * 100).toFixed(1)}%</b></div>`;
  }

  if (f.home != null) {
    html += `<div class="box"><h3>Vinstchans</h3>${bar([f.home, f.draw, f.away], [m.home.short, 'Oavgjort', m.away.short])}
      ${mo && mk?.h2h ? `<p class="note">Modell ${pct(mo.p.home)} / ${pct(mo.p.draw)} / ${pct(mo.p.away)} · Marknaden ${pct(mk.h2h.home.fair)} / ${pct(mk.h2h.draw.fair)} / ${pct(mk.h2h.away.fair)}</p>` : ''}
      ${!mo ? '<p class="note">Ingen statistik för den här turneringen – bara spelbolagens odds.</p>' : ''}</div>`;
  }

  if (mo) {
    html += `<div class="row2">
      <div class="box"><h3>Modellen</h3>
        <div class="stat"><span>Förväntade mål</span><b>${mo.xg[0].toFixed(2)} – ${mo.xg[1].toFixed(2)}</b></div>
        <div class="stat"><span>Över 2,5 mål</span><b>${pct(f.over ?? mo.p.over)}</b></div>
        <div class="stat"><span>Båda gör mål</span><b>${pct(mo.p.btts)}</b></div>
        <div class="stat"><span>Säkerhet</span><b class="conf ${mo.conf}">${mo.conf}</b></div>
      </div>
      <div class="box"><h3>Troligast resultat</h3>
        <div class="scores">${mo.scores.map(s => `<span>${s.h}–${s.a}<small>${pct(s.p)}</small></span>`).join('')}</div>
      </div>
    </div>`;
  }

  if (m.home.id && (c.form[m.home.id] || c.form[m.away.id])) {
    html += `<div class="box"><h3>Form (senaste 5)</h3>
      <div class="stat"><span>${esc(m.home.short)}${position(c, m.home.id) ? ' · ' + position(c, m.home.id) : ''}</span>${formIcons(c.form[m.home.id])}</div>
      <div class="stat"><span>${esc(m.away.short)}${position(c, m.away.id) ? ' · ' + position(c, m.away.id) : ''}</span>${formIcons(c.form[m.away.id])}</div>
    </div>`;
  }

  if (mk) {
    const rows = [];
    if (mk.h2h) for (const k of ['home', 'draw', 'away']) rows.push([k, mk.h2h[k]]);
    if (mk.ou25) for (const k of ['over', 'under']) rows.push([k, mk.ou25[k]]);
    html += `<div class="box"><h3>Odds</h3><table class="odds-table">
      <thead><tr><th>Spel</th><th>Bästa odds</th><th>Spelbolag</th><th>Vår chans</th><th>Värde</th></tr></thead>
      <tbody>${rows.map(([k, o]) => {
        const edge = f[k] != null ? f[k] * o.odds - 1 : null;
        return `<tr class="${vals.has(k) ? 'val' : ''}"><td>${esc(PICK[k] === '1' ? '1 (' + m.home.short + ')' : PICK[k] === '2' ? '2 (' + m.away.short + ')' : PICK[k])}</td>
          <td class="best">${odd(o.odds)}</td><td>${esc(o.book)}</td><td>${pct(f[k])}</td>
          <td>${edge == null ? '–' : (edge >= 0.0005 ? '+' : '') + (Math.round(edge * 1000) / 10).toFixed(1) + '%'}</td></tr>`;
      }).join('')}</tbody></table>
      ${mk.books?.length ? `<details><summary class="note">Alla spelbolag (1X2)</summary><table class="odds-table">
        <tbody>${mk.books.map(b => `<tr><td>${esc(b.name)}</td><td>${odd(b.home)}</td><td>${odd(b.draw)}</td><td>${odd(b.away)}</td></tr>`).join('')}</tbody></table></details>` : ''}
    </div>`;
  } else if (UPCOMING.has(m.status)) {
    html += '<p class="note">Inga odds för matchen än – de hämtas en gång per dag.</p>';
  }

  $('#sheet-body').innerHTML = html;
  $('#sheet').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeSheet() {
  $('#sheet').hidden = true;
  document.body.style.overflow = '';
}

// ---------- Ritning och händelser ----------

function render() {
  history.replaceState(null, "", state.view === "matcher" ? location.pathname : "#" + state.view);
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
  if (["varde", "tabeller"].includes(hash)) state.view = hash;
  const m = new URLSearchParams(location.search).get("match");
  render();
  if (m) openMatch(m);
}

load();
