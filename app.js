// Startsidan: matcher per dag och tabeller. Delad kod finns i common.js.

const state = { view: 'matcher', comp: 'ALL', day: null };

const comps = () => DATA.latest.competitions.filter(c => state.comp === 'ALL' || c.id === state.comp);
const allMatches = () => comps().flatMap(c => c.matches.map(m => ({ ...m, comp: c })));

// ---------- Filter ----------

function renderChips() {
  const list = DATA.latest.competitions.filter(c => c.matches.length || c.standings.length);
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

// ---------- Matcher ----------

function pickFocus(matches) {
  const score = m => {
    if (m.values.length) return 1000 + Math.max(...m.values.map(v => v.edge)) * 100;
    const ph = standing(m.comp, m.home.id), pa = standing(m.comp, m.away.id);
    const rank = ph && pa ? (ph.pos + pa.pos) / 2 : 15;
    return (m.comp.id === 'CL' ? 60 : 40) - rank + (LIVE.has(m.status) ? 50 : 0) + (m.final?.home != null ? 5 : 0);
  };
  return matches.slice().sort((a, b) => score(b) - score(a))[0];
}

function hero(m) {
  const done = m.score && !UPCOMING.has(m.status);
  const top = m.values.length ? 'Bästa värdet' : LIVE.has(m.status) ? 'Live nu' : 'Matchen i fokus';
  const v = m.values.slice().sort((a, b) => b.edge - a.edge)[0];
  const star = m.extras?.players.slice().sort((a, b) => b.p - a.p)[0];
  const foot = v ? `Värde: <b>${esc(pickLabel(m, v.pick))} @ ${odd(v.odds)}</b> (${signed(v.edge)})`
    : m.model ? `Förväntade mål <b>${m.model.xg[0].toFixed(1)} – ${m.model.xg[1].toFixed(1)}</b>${star ? ` · ${esc(surname(star.name))} gör mål <b>${pct(star.p)}</b>` : ''}` : '';
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

// ---------- Tabeller ----------

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

function scorerTable(c) {
  if (!c.scorers?.length) return '';
  return `<div class="table-wrap">
    <div class="group-head"><b>Skytteliga</b><small>${esc(c.name)}</small></div>
    <table>
      <thead><tr><th>#</th><th style="text-align:left">Spelare</th><th>Mål</th><th class="hide-sm">Assist</th><th class="hide-sm">Straff</th><th>Matcher</th><th class="hide-sm">Mål/match</th></tr></thead>
      <tbody>${c.scorers.slice(0, 15).map((p, i) => `<tr>
        <td class="pos">${i + 1}</td>
        <td class="team-cell"><button class="cell-btn" ${playerAttrs(c, p.team.name ?? p.team.short, p.name)}>${crest(p.team)}<span>${esc(p.name)}</span><small class="muted">${esc(p.team.short)}</small></button></td>
        <td class="pts">${p.goals}</td><td class="hide-sm">${p.assists}</td><td class="hide-sm">${p.pens}</td><td>${p.played}</td>
        <td class="hide-sm">${p.played ? (p.goals / p.played).toFixed(2).replace('.', ',') : '–'}</td>
      </tr>`).join('')}</tbody>
    </table>
  </div>`;
}

function viewTables() {
  $('#days').innerHTML = '';
  const withTables = DATA.latest.competitions.filter(c => c.standings.length);
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
        <td class="team-cell"><button class="cell-btn" ${clubAttrs(c, r.team)}>${crest(r.team)}<span>${esc(r.team.short)}</span></button></td>
        <td>${r.p}</td><td class="hide-sm">${r.w}</td><td class="hide-sm">${r.d}</td><td class="hide-sm">${r.l}</td>
        <td class="hide-sm">${r.gf}–${r.ga}</td>
        <td>${r.gd > 0 ? '+' : ''}${r.gd}</td><td class="pts">${r.pts}</td>
        <td class="hide-sm">${formIcons(c.form[r.team.id])}</td>
      </tr>`).join('')}</tbody>
    </table>
    ${z ? `<div class="legend">${z.legend.map(([k, l]) => `<span style="--z:var(--${ZONE_COLOR[k]})">${l}</span>`).join('')}</div>` : ''}
  </div>`;
  }).join('') + scorerTable(c);
}

// ---------- Ritning ----------

function render() {
  markNav(state.view);
  renderChips();
  $('#main').innerHTML = state.view === 'tabeller' ? viewTables() : viewMatches();
}

function readHash() {
  const hash = location.hash.slice(1);
  if (hash === 'varde') { location.replace('dagens-varde.html'); return false; }
  state.view = hash === 'tabeller' ? 'tabeller' : 'matcher';
  if (state.view === 'matcher' && !DATA.latest?.competitions.some(c => c.id === state.comp && c.matches.length)) state.comp = 'ALL';
  return true;
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-comp],[data-day]');
  if (!t) return;
  if (t.dataset.comp) state.comp = t.dataset.comp;
  else state.day = t.dataset.day;
  render();
});
window.addEventListener('hashchange', () => { if (readHash()) { render(); window.scrollTo({ top: 0 }); } });

boot('matcher', () => { if (readHash()) render(); });
