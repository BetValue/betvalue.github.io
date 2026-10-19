// Delad kod för alla sidor: hjälpfunktioner, datahämtning, resultatraden och matchdetaljerna.

const TZ = 'Europe/Stockholm';
const DATA = { latest: null };
const $ = sel => document.querySelector(sel);

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = p => (p == null ? '–' : Math.round(p * 100) + '%');
const odd = o => (o == null || !isFinite(o) ? '–' : o.toFixed(2));
const fair = p => (p > 0 ? 1 / p : null);
const minOdds = p => (p > 0 ? 1.05 / p : null); // 5 % värde
// Svenska ordningstal: 1:a, 2:a, 3:e … 11:e, 12:e, 21:a, 22:a
const ord = n => n + ([1, 2].includes(n % 10) && ![11, 12].includes(n % 100) ? ':a' : ':e');
const signed = e => (e >= 0.0005 ? '+' : '') + (Math.round(e * 1000) / 10).toFixed(1) + '%';
const dayKey = iso => new Date(iso).toLocaleDateString('sv-SE', { timeZone: TZ });
const todayKey = () => dayKey(new Date().toISOString());
const clock = iso => new Date(iso).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const LIVE = new Set(['IN_PLAY', 'PAUSED']);
const UPCOMING = new Set(['SCHEDULED', 'TIMED']);
const PICK = { home: '1', draw: 'X', away: '2', over: 'Över 2,5', under: 'Under 2,5' };
const CONF_W = { hög: 1, medel: 0.85, låg: 0.6 };

function dayParts(key) {
  const d = new Date(key + 'T12:00:00Z');
  const diff = Math.round((Date.parse(key) - Date.parse(todayKey())) / 864e5);
  const name = diff === 0 ? 'Idag' : diff === 1 ? 'Imorgon' : diff === -1 ? 'Igår'
    : d.toLocaleDateString('sv-SE', { weekday: 'short', timeZone: 'UTC' });
  return { name, date: d.getUTCDate(), month: d.toLocaleDateString('sv-SE', { month: 'short', timeZone: 'UTC' }), today: diff === 0, diff };
}
const dayText = iso => { const p = dayParts(dayKey(iso)); return Math.abs(p.diff) <= 1 ? p.name : `${p.name} ${p.date} ${p.month}`; };

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

const fill = (s, m) => s.replace('{H}', m.home.short).replace('{A}', m.away.short);
const surname = name => name.split(' ').slice(-1)[0];

function pickLabel(m, pick) {
  if (pick === 'home') return `${m.home.short} vinner`;
  if (pick === 'away') return `${m.away.short} vinner`;
  if (pick === 'draw') return 'Oavgjort';
  return PICK[pick] + ' mål';
}

// Värdebets, bet builders och målskyttechanser visas bara för inloggade (auth.js).
const premium = () => typeof AUTH !== 'undefined' && !!AUTH.premium;
const valuesOf = m => (premium() ? m.values : []);
const lockedBox = text => `<div class="box lockbox"><span>★</span><div><b>${esc(text)}</b>
  ${typeof AUTH !== 'undefined' && AUTH.user
    ? '<a href="medlem.html">Slutför betalningen (9 kr/mån)</a> för att se det.'
    : `<a href="konto.html?tab=signup&next=${encodeURIComponent(location.pathname)}">Skapa konto – 9 kr/mån</a> eller <a href="konto.html?next=${encodeURIComponent(location.pathname)}">logga in</a>.`}</div></div>`;

// ---------- Ord på sidan ----------
// Samma ord betyder alltid samma sak:
//   Vår chans      – modellens sannolikhet att spelet går in.
//   Marknadens chans – spelbolagens odds omräknade till chans (utan deras marginal).
//   Rättvist odds  – 1 ÷ vår chans: oddset där spelet går jämnt ut i längden.
//   Lägsta odds    – rättvist odds + 5 %: får du minst det här oddset har spelet värde.
//   Odds           – spelbolagets faktiska odds (bara när de finns).
//   Värde          – hur mycket mer oddset betalar än chansen motiverar (+6 % = 6 kr per 100 kr i längden).
function glossary(open = false) {
  return `<details class="gloss"${open ? ' open' : ''}><summary><i>i</i>Så läser du siffrorna</summary><dl>
    <div><dt>Vår chans</dt><dd>Hur ofta spelet går in enligt vår modell. 70 % = sju gånger av tio.</dd></div>
    <div><dt>Lägsta odds</dt><dd>Oddset du minst behöver för att spelet ska vara värt att spela. Hittar du ett högre odds hos ditt spelbolag har spelet värde.</dd></div>
    <div><dt>Rättvist odds</dt><dd>1 ÷ vår chans. På det oddset går spelet jämnt ut i längden – lägsta odds är rättvist odds + 5 % marginal.</dd></div>
    <div><dt>Värde</dt><dd>Hur mycket mer spelbolagets odds betalar än chansen motiverar. +6 % betyder 6 kr i plus per 100 kr i längden. Visas bara när vi har spelbolagens odds.</dd></div>
    <div><dt>Marknadens chans</dt><dd>Spelbolagens odds omräknade till chans, utan deras marginal.</dd></div>
  </dl></details>`;
}

// ---------- Dagens rekommendationer ----------
// Urvalet görs av picks.js (PICKS.recommend) – samma som tipsstatistiken (PICKS.trackPicks i scripts/track.mjs).
const recommendations = ms => PICKS.recommend(ms);

const everyMatch = () => DATA.latest.competitions.flatMap(c => c.matches.map(m => ({ ...m, comp: c })));
const findMatch = id => everyMatch().find(x => String(x.id) === String(id));

function standing(c, teamId) {
  for (const s of c.standings) {
    const r = s.rows.find(x => x.team.id === teamId);
    if (r) return { ...r, group: s.group, size: s.rows.length };
  }
  return null;
}

// Hur bra försvar ett lag har: insläppta mål per match och plats i ligan (1 = bäst).
function defence(c, teamId) {
  const rows = c.standings.flatMap(s => s.rows).filter(r => r.p > 0);
  const me = rows.find(r => r.team.id === teamId);
  if (!me) return null;
  const per = r => r.ga / r.p;
  const rank = rows.filter(r => per(r) < per(me)).length + 1;
  return { per: per(me), rank, size: rows.length };
}

// Alla spel vi kan räkna fram för en match (picks.js), plus de gamla målskyttebyggena (pw:/po:)
// så att äldre sparade bets och boostar fortfarande hittar sitt spel.
function marketsFor(m) {
  const out = PICKS.allMarkets(m).map(x => ({ ...x, group: x.cat }));
  for (const pl of m.extras?.players ?? []) {
    const team = pl.side === 'home' ? m.home.short : m.away.short;
    out.push({ key: 'pw:' + pl.id, group: 'Bet builder', cat: 'Bet builder', label: `${team} vinner + ${pl.name} gör mål`, legs: [{ label: `${team} vinner` }, { label: `${pl.name} gör mål` }], p: pl.win, player: pl });
    out.push({ key: 'po:' + pl.id, group: 'Bet builder', cat: 'Bet builder', label: `${pl.name} gör mål + Över 2,5 mål`, legs: [{ label: `${pl.name} gör mål` }, { label: 'Över 2,5 mål' }], p: pl.o25, player: pl });
  }
  return out;
}
const marketByKey = (m, key) => PICKS.marketByKey(m, key) ?? marketsFor(m).find(x => x.key === key) ?? null;

// Ett spel som rad: huvudsiffrorna syns direkt, underlaget och "vad kan gå fel" fälls ut.
function marketRow(x, { match = false, save = true } = {}) {
  const m = x.m;
  const money = x.odds != null
    ? `<span class="mr-o"><small>Odds</small><b>${odd(x.odds)}</b></span><span class="mr-ev ${x.ev >= 0 ? 'up' : 'down'}"><small>EV</small><b>${signed(x.ev)}</b></span>`
    : `<span class="mr-o"><small>Lägsta odds</small><b>${odd(x.min)}</b></span>`;
  return `<details class="mrow risk-${(x.risk ?? '').toLowerCase()}">
    <summary>
      <span class="mr-main"><b>${esc(x.label)}</b>${match ? `<small>${esc(m.home.short)} – ${esc(m.away.short)} · ${clock(m.utc)}</small>` : x.hit ? `<small>${esc(x.hit)} senaste</small>` : ''}</span>
      <span class="mr-p"><small>Vår chans</small><b>${pct(x.p)}</b></span>${money}
    </summary>
    <div class="mr-body">
      <dl>
        ${x.odds != null ? `<div><dt>Odds</dt><dd>${odd(x.odds)}${x.book ? ' hos ' + esc(x.book) : ''} · implicit ${pct(x.implied)}${x.marketP ? ' · marknadens chans ' + pct(x.marketP) : ''}</dd></div>` : '<div><dt>Odds</dt><dd>Spelbolagens odds för det här spelet saknas – jämför själv med lägsta odds.</dd></div>'}
        <div><dt>Vår chans</dt><dd>${pct(x.p)} · rättvist odds ${odd(x.fair)} · lägsta odds ${odd(x.min)}${x.push ? ` · ${pct(x.push)} chans att insatsen kommer tillbaka` : ''}</dd></div>
        <div><dt>Risk</dt><dd>${esc(x.risk)}${x.conf ? ` · underlag ${esc(x.conf)}` : ''}</dd></div>
        ${x.basis ? `<div><dt>Underlag</dt><dd>${esc(x.basis)}</dd></div>` : ''}
        ${x.wrong ? `<div><dt>Kan gå fel</dt><dd>${esc(x.wrong)}</dd></div>` : ''}
      </dl>
      <div class="mr-btns">${save ? saveBtn(m, x.key, x.label, x.p, x.odds ?? null, x.book ?? null) : ''}${match ? `<button class="btn-mini" data-match="${m.id}">Hela matchen →</button>` : ''}</div>
    </div>
  </details>`;
}

// Alla spel i en match, grupperade per kategori.
function allMarketsHtml(m) {
  const all = PICKS.allMarkets(m).filter(x => x.p >= 0.08 && x.p <= 0.95);
  if (!all.length) return '';
  const cats = PICKS.CATS.filter(c => all.some(x => x.cat === c));
  return `<div class="box allm"><span class="label">Alla spel i matchen</span>
    <p class="note">Tryck på ett spel för underlag, risk och vad som kan gå fel. Spel utan odds visar lägsta odds – det du minst behöver hos ditt spelbolag.</p>
    ${cats.map((c, i) => { const list = all.filter(x => x.cat === c); return `<details class="allm-cat"${i === 0 ? ' open' : ''}><summary>${esc(c)}<small>${list.length}</small></summary>
      <div class="mlist">${list.map(x => marketRow(x)).join('')}</div></details>`; }).join('')}
    ${m.extras?.stats ? '' : '<p class="note">Hörnor, kort och spelarspel visas när matchen är inom två dygn och vi har lagens statistik.</p>'}
  </div>`;
}

// ---------- Sparade bets ----------

// Vann betet? Rättningen finns i grade.js (samma kod som tipsstatistiken i fetch.mjs).
// m.goals (målskyttar) kommer från datahämtningen och live.js; utan dem kan spelarspel inte rättas.
// 'won' | 'lost' | 'live' | 'open' | 'unknown'
function betResult(m, key, label = '') {
  if (!m) return 'unknown';
  const started = LIVE.has(m.status) || m.status === 'FINISHED';
  if (!started || !m.score && m.status === 'FINISHED') return 'open';
  const post = m.post;
  return gradeBet(key, label, {
    started, done: m.status === 'FINISHED', h: m.score?.h ?? 0, a: m.score?.a ?? 0, goals: m.goals ?? null,
    ht: post?.ht ?? null, stats: post?.c ? { c: post.c, y: post.y } : null,
    players: post?.pl ? post.pl.map(([id, name, sh, sot, fc, fs, y, g, a]) => ({ id, name, sh, sot, fc, fs, y, g, a })) : null,
  });
}

// Knapp som sparar betet på kontot (auth.js sköter klicket).
function saveBtn(m, key, label, p = null, odds = null, book = null) {
  const data = {
    match_id: String(m.id), pick: key, label, match_label: `${m.home.short} – ${m.away.short}`, kickoff: m.utc,
    comp: m.comp?.name ?? null, p: p != null ? Math.round(p * 1000) / 1000 : null, odds: odds ?? null, book: book ?? null,
  };
  return `<button class="savebet" data-save-bet="${esc(JSON.stringify(data))}" aria-pressed="false" title="Spara betet på ditt konto"><b>＋</b><span>Spara</span></button>`;
}

// ---------- Sidhuvud och resultatrad ----------

function markNav(page) {
  document.body.dataset.page = page;
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === page));
  // Sidorna under Mer: markera Mer.
  document.querySelector('[data-nav-more]')?.classList.toggle('active', !!document.querySelector('.more-menu .active'));
}

// Mer-menyn stängs när man trycker utanför den eller väljer något.
document.addEventListener('click', e => {
  const more = document.querySelector('details.more[open]');
  if (more && (!more.contains(e.target) || e.target.closest('.more-menu a, .more-menu button'))) more.open = false;
});

// Resultatraden visas bara på Matcher – på de andra sidorna tar den bara plats.
function renderTicker() {
  if (!['matcher', 'tabeller'].includes(document.body.dataset.page)) return;
  const now = Date.now();
  const all = everyMatch();
  const items = [
    ...all.filter(m => LIVE.has(m.status)).map(m => ['live', 'Live', m, `${m.score?.h ?? 0}–${m.score?.a ?? 0}`]),
    ...all.filter(m => UPCOMING.has(m.status)).flatMap(m => valuesOf(m).map(v => ({ m, v })))
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

// ---------- Byggstenar ----------

function bigBar(m) {
  const f = m.final, vals = new Set(valuesOf(m).map(v => v.pick));
  const parts = [['home', 'h'], ['draw', 'd'], ['away', 'a']];
  return `<div class="bigbar"><div class="bar">${parts.map(([k, c]) =>
    `<div class="${c}${vals.has(k) ? ' v' : ''}" style="flex:${Math.max(f[k] * 100, 1)}">${pct(f[k])}</div>`).join('')}</div>
    <div class="bar-labels"><span>${esc(m.home.short)}</span><span>Oavgjort</span><span>${esc(m.away.short)}</span></div></div>`;
}

// Attribut som öppnar klubbsidan (espn.js) när man trycker.
const clubAttrs = (c, t) => `data-cteam="${t.id ?? ''}" data-ccomp="${c.id}" data-cname="${esc(t.name)}"`;
// Attribut som öppnar spelarprofilen via namnet (espn.js letar upp spelaren).
const playerAttrs = (c, teamName, name) => `data-pname="${esc(name)}" data-pcomp="${c.id}" data-pteamname="${esc(teamName)}"`;

// Mitten av resultattavlan: ställning + minut (live), slutresultat eller avsparkstid.
function midHtml(m) {
  const done = m.score && !UPCOMING.has(m.status);
  const live = LIVE.has(m.status);
  return done
    ? `<b>${m.score.h}–${m.score.a}</b><small${live ? ' class="live-min"' : ''}>${live ? `<span class="livedot"></span> ${esc(m.minute || 'Live')}` : 'Slutresultat'}</small>`
    : `<b>${clock(m.utc)}</b><small class="count">${countdown(m.utc)}</small>`;
}

function scoreboard(m, clickable = false) {
  const mid = midHtml(m);
  const sh = standing(m.comp, m.home.id), sa = standing(m.comp, m.away.id);
  const side = (t, s) => clickable && t.id
    ? `<button class="side-t club" ${clubAttrs(m.comp, t)}>${crest(t)}<span>${esc(t.short)}</span><small>${s ? `${ord(s.pos)} · ${s.pts} p · ` : ''}Klubbsida →</small></button>`
    : `<div class="side-t">${crest(t)}<span>${esc(t.short)}</span>${s ? `<small>${ord(s.pos)} · ${s.pts} p</small>` : ''}</div>`;
  return `${m.home.crest ? `<img class="glow h" src="${esc(m.home.crest)}" alt="">` : ''}
    ${m.away.crest ? `<img class="glow a" src="${esc(m.away.crest)}" alt="">` : ''}
    <div class="duel">
      ${side(m.home, sh)}
      <div class="mid">${mid}</div>
      ${side(m.away, sa)}
    </div>`;
}

function formIcons(list) {
  return `<span class="form">${(list ?? []).slice().reverse().map(f =>
    `<i class="${f.r}" title="${esc((f.home ? 'mot ' : 'borta mot ') + f.opp + ' ' + f.gf + '–' + f.ga)}">${f.r}</i>`).join('')}</span>`;
}

// "möter Köln – släpper in 1,8 mål/match (16:e av 18)"
function facing(m, side) {
  const opp = side === 'home' ? m.away : m.home;
  const d = defence(m.comp, opp.id);
  return `möter ${esc(opp.short)}${d ? ` · släpper in ${d.per.toFixed(1).replace('.', ',')}/match <span class="rank ${d.rank > d.size * 0.66 ? 'weak' : d.rank <= d.size * 0.33 ? 'strong' : ''}">${ord(d.rank)} bästa försvar</span>` : ''}`;
}

function playerRow(m, pl, extra = '') {
  const team = pl.side === 'home' ? m.home : m.away;
  return `<div class="player">
    ${crest(team)}
    <div class="pl-main"><b class="plname" ${playerAttrs(m.comp, team.name, pl.name)}>${esc(pl.name)}</b>
      <small>${pl.goals} mål · ${pl.assists} assist · ${pl.played} matcher${pl.pens ? ` · ${pl.pens} straff` : ''}</small>
      <small class="faces">${facing(m, pl.side)}</small>${extra}</div>
    <div class="pl-num"><b>${pct(pl.p)}</b><small>lägsta odds ${odd(minOdds(pl.p))}</small>${saveBtn(m, 'p:' + pl.id, pl.name + ' gör mål', pl.p)}</div>
  </div>`;
}

// ---------- Matchdetaljer ----------

function openMatch(id) {
  const m = findMatch(id);
  if (!m) return;
  pushSheet(() => matchHtml(m), root => loadMatchExtras(m, root));
}

function matchHtml(m) {
  const c = m.comp, f = m.final ?? {}, mo = m.model, mk = m.market;
  const done = m.score && !UPCOMING.has(m.status);
  const sh = standing(c, m.home.id), sa = standing(c, m.away.id);
  const vals = new Set(valuesOf(m).map(v => v.pick));

  let html = `<div class="board" data-board="${m.id}">
    <div class="sub">${esc(c.name)}${m.matchday && m.stage === 'REGULAR_SEASON' ? ' · Omgång ' + m.matchday : ''} · ${dayText(m.utc)}</div>
    ${scoreboard(m, true)}
    <div class="board-scorers" id="board-scorers"></div>
  </div>`;

  if (!premium() && UPCOMING.has(m.status) && m.model) {
    html += lockedBox('Värdebets, bet builders och målskyttar ingår i kontot.');
  }
  if (premium() && m.values.length) {
    html += `<div class="box valbox"><span class="label">Värdebet</span>${m.values.map(v => `<div class="valrow">
      <div><b>${esc(pickLabel(m, v.pick))} @ ${odd(v.odds)}</b><br><small>hos ${esc(v.book)} · vår chans ${pct(v.p)} · marknadens chans ${pct(v.fair)}</small></div>
      <em>${signed(v.edge)}</em>${saveBtn(m, v.pick, pickLabel(m, v.pick), v.p, v.odds, v.book)}</div>`).join('')}</div>`;
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

  html += '<div id="espn-slot"></div>';

  if (premium() && m.extras && !done) {
    const r = PICKS.recommend([m]);
    const builders = [r.bbStar, ...r.bbAlts].filter(Boolean).slice(0, 3);
    if (builders.length) {
      html += `<div class="box"><span class="label">Bet builders · odds runt 2–3</span>${builders.map(b => `<div class="bb">
        <ul>${b.legs.map(l => `<li>${esc(l.label)}</li>`).join('')}</ul>
        <div class="pl-num"><b>${pct(b.p)}</b><small>lägsta odds ${odd(b.min)}</small>${saveBtn(m, b.key, b.label, b.p)}</div></div>`).join('')}
        <p class="note">Spelbolagen sätter egna odds på bet builders. Är deras odds högre än lägsta odds har spelet värde enligt oss. ${esc(builders[0].basis)}</p></div>`;
    }
    html += allMarketsHtml(m);
    if (m.extras.players.length) {
      html += `<div class="box"><span class="label">Nyckelspelare · chans att göra mål</span>
        ${m.extras.players.slice().sort((a, b) => b.p - a.p).map(pl => playerRow(m, pl)).join('')}
        <p class="note">Startelvan släpps ungefär en timme före avspark. Kolla att spelaren startar innan du spelar.</p></div>`;
    }
  }

  if (m.home.id && (c.form[m.home.id] || c.form[m.away.id])) {
    const row = (t, s) => `<div class="formrow"><div>${crest(t)}<span>${esc(t.short)}</span>${s ? `<small>${ord(s.pos)}</small>` : ''}</div>${formIcons(c.form[t.id])}</div>`;
    html += `<div class="box"><span class="label">Form · senaste 5</span>${row(m.home, sh)}${row(m.away, sa)}</div>`;
  }

  if (m.h2h?.length) {
    const name = id => id === m.home.id ? m.home.short : id === m.away.id ? m.away.short : '?';
    const wins = { [m.home.id]: 0, [m.away.id]: 0, d: 0 };
    for (const x of m.h2h) {
      if (x.hg === x.ag) wins.d++;
      else wins[x.hg > x.ag ? x.home : x.away] = (wins[x.hg > x.ag ? x.home : x.away] ?? 0) + 1;
    }
    html += `<div class="box"><span class="label">Inbördes möten</span>
      <div class="h2h-sum"><div><b>${wins[m.home.id]}</b><small>${esc(m.home.short)}</small></div><div><b>${wins.d}</b><small>Oavgjort</small></div><div><b>${wins[m.away.id]}</b><small>${esc(m.away.short)}</small></div></div>
      ${m.h2h.map(x => `<div class="stat"><span>${x.date}</span><b class="h2h-res">${esc(name(x.home))} ${x.hg}–${x.ag} ${esc(name(x.away))}</b></div>`).join('')}</div>`;
  }

  if (mk) {
    const rows = [];
    if (mk.h2h) for (const k of ['home', 'draw', 'away']) rows.push([k, mk.h2h[k]]);
    if (mk.ou25) for (const k of ['over', 'under']) rows.push([k, mk.ou25[k]]);
    const name = k => k === 'home' ? '1 · ' + m.home.short : k === 'away' ? '2 · ' + m.away.short : k === 'draw' ? 'X · Oavgjort' : PICK[k] + ' mål';
    html += `<div class="box"><span class="label">Odds</span><div class="odds-wrap"><table class="odds-table">
      <thead><tr><th>Spel</th><th>Bäst (SE)</th><th>Hos</th><th>Vår chans</th><th>Värde</th></tr></thead>
      <tbody>${rows.map(([k, o]) => `<tr class="${vals.has(k) ? 'val' : ''}"><td>${esc(name(k))}</td>
        <td class="best">${odd(o.odds)}</td><td>${esc(o.book)}</td><td>${pct(f[k])}</td>
        <td>${!o.odds ? '–' : premium() && f[k] != null ? signed(f[k] * o.odds - 1) : '🔒'}</td></tr>`).join('')}</tbody></table></div>
      <p class="note">Bästa odds hos spelbolag med svensk licens (Unibet, LeoVegas, Nordic Bet, Betsson, Coolbet). Marknadens chans räknas på alla bolag.</p>
      ${mk.books?.length ? `<details><summary class="note">Alla spelbolag (1X2)</summary><div class="odds-wrap"><table class="odds-table">
        <tbody>${mk.books.map(b => `<tr><td>${esc(b.name)}</td><td>${odd(b.home)}</td><td>${odd(b.draw)}</td><td>${odd(b.away)}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
    </div>`;
  } else if (UPCOMING.has(m.status)) {
    html += '<p class="note">Inga odds från spelbolagen för matchen än – de hämtas en gång per dygn.</p>';
  }

  return html;
}

// ---------- Bottenarket: en stapel av vyer (match → spelare → klubb …) med Tillbaka ----------

const sheetStack = [];

async function paintSheet() {
  const view = sheetStack[sheetStack.length - 1];
  const body = $('#sheet-body');
  $('#sheet').hidden = false;
  document.body.style.overflow = 'hidden';
  const back = sheetStack.length > 1 ? '<button class="back" data-back>← Tillbaka</button>' : '';
  body.innerHTML = back + '<div class="loading big"><span class="spin"></span>Laddar…</div>';
  $('#sheet .sheet-card').scrollTop = 0;
  let html;
  try { html = await view.render(); } catch { html = '<p class="empty">Kunde inte hämta det här just nu. Försök igen om en stund.</p>'; }
  if (sheetStack[sheetStack.length - 1] !== view) return; // användaren hann gå vidare
  body.innerHTML = back + html;
  document.dispatchEvent(new CustomEvent('sheet:rendered', { detail: body }));
  view.after?.(body);
}

// Öppna en ny vy. Är arket redan öppet läggs den ovanpå (Tillbaka går till förra).
function pushSheet(render, after) {
  if ($('#sheet').hidden) sheetStack.length = 0;
  sheetStack.push({ render, after });
  paintSheet();
}

function closeSheet() {
  sheetStack.length = 0;
  $('#sheet').hidden = true;
  document.body.style.overflow = '';
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-match],[data-close],[data-back]');
  if (!t) return;
  if (t.dataset.match) openMatch(t.dataset.match);
  else if ('back' in t.dataset) { sheetStack.pop(); paintSheet(); }
  else closeSheet();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeSheet();
  // Kort som är div med role="button" (de innehåller egna knappar) ska gå att öppna med tangentbordet.
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[role="button"][data-match]')) { e.preventDefault(); e.target.click(); }
});

// Hämtar datan, fyller sidfoten och resultatraden och anropar sidans egen ritfunktion.
async function boot(page, start) {
  markNav(page);
  try {
    const res = await fetch('data/latest.json?t=' + Date.now());
    if (!res.ok) throw new Error(res.status);
    DATA.latest = await res.json();
  } catch {
    $('#main').innerHTML = '<p class="empty">Ingen data ännu. Den hämtas automatiskt några gånger per dygn.</p>';
    return;
  }
  const ts = iso => new Date(iso).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short', timeZone: TZ });
  $('#updated').textContent = `Statistik uppdaterad ${ts(DATA.latest.updated)}` +
    (DATA.latest.oddsUpdated ? ` · odds ${ts(DATA.latest.oddsUpdated)}` : '');
  if (typeof AUTH !== 'undefined') { await AUTH.ready; await applyPremium().catch(() => {}); }
  renderTicker();
  await start();
  // Direktlänkar: ?match=ID, ?player=ESPN-ID&slug=eng.1&team=Arsenal, ?club=LAG-ID&comp=PL
  const q = new URLSearchParams(location.search);
  if (q.get('match')) openMatch(q.get('match'));
  else if (q.get('player') && typeof openPlayer === 'function') openPlayer(q.get('player'), q.get('slug') ?? 'eng.1', q.get('team'));
  else if (q.get('club') && typeof openClub === 'function') openClub(q.get('comp') ?? 'PL', Number(q.get('club')), null);
}

// ---------- Vår tipsstatistik (öppen för alla) ----------
// data/track.json byggs av scripts/track.mjs: alla tips från Dagens värde, rättade efter matchen.

const TRACK_KIND = { best: 'Dagens bästa bet', single: 'Säkraste spelen', value: 'Värdespel', builder: 'Bet builders', player: 'Spelarspel', scorer: 'Målskyttar' };
let trackData = null;
const loadTrack = () => (trackData ??= fetch('data/track.json?t=' + Math.floor(Date.now() / 6e5))
  .then(r => (r.ok ? r.json() : { picks: [] })).catch(() => ({ picks: [] })));

// full = egna sidan (tips.html): alla tips, grupperade per dag. days = Infinity → hela historiken.
async function trackHtml(days = 30, full = false) {
  const { picks = [] } = await loadTrack();
  const since = Date.now() - days * 864e5;
  const recent = picks.filter(p => Date.parse(p.utc) > since);
  const done = recent.filter(p => p.result === 'won' || p.result === 'lost');
  if (!done.length) return '';
  const won = done.filter(p => p.result === 'won').length;
  const rate = won / done.length;
  const expected = done.reduce((s, p) => s + (Number(p.p) || 0), 0) / done.length;
  const waiting = recent.filter(p => !p.result).length;
  const kinds = Object.entries(TRACK_KIND).map(([k, name]) => {
    const list = done.filter(p => p.kind === k);
    if (!list.length) return '';
    const w = list.filter(p => p.result === 'won').length;
    return `<div><small>${esc(name)}</small><b>${w}<i>/${list.length}</i></b></div>`;
  }).join('');
  const row = p => `<div class="tr-row r-${p.result}">
      <span class="tr-mark">${p.result === 'won' ? '✓' : '✗'}</span>
      <span class="tr-main"><b>${esc(p.label)}</b><small>${esc(p.home)} – ${esc(p.away)}${p.score ? ' · ' + esc(p.score) : ''} · ${esc(dayText(p.utc))}</small></span>
      <em>${pct(Number(p.p))}</em></div>`;
  const back = done.some(p => p.back);
  return `<section class="box track">
    <span class="label">Så har våra bets gått</span>
    <div class="tr-big"><b>${won} av ${done.length}</b><span>av våra tips gick in ${days === Infinity ? 'totalt' : `senaste ${days} dagarna`}</span><em>${Math.round(rate * 100)}%</em></div>
    <div class="tr-bar" role="img" aria-label="${won} vunna, ${done.length - won} förlorade"><i style="width:${rate * 100}%"></i></div>
    <div class="tr-legend"><span class="w">✓ ${won} gick in</span><span class="l">✗ ${done.length - won} gick inte in</span><span>Modellen räknade med ${pct(expected)}</span></div>
    <div class="tr-kinds">${kinds}</div>
    ${full ? [...new Set(done.map(p => p.day))].map(d => { const list = done.filter(p => p.day === d), w = list.filter(p => p.result === 'won').length;
      return `<h3 class="tr-day"><span>${esc(dayText(list[0].utc))}</span><small>${w} av ${list.length} gick in</small></h3><div class="tr-list">${list.map(row).join('')}</div>`; }).join('') : `<div class="tr-list">${done.slice(0, 8).map(row).join('')}</div>`}
    ${!full && done.length > 8 ? `<details class="tr-more"><summary class="note">Visa alla ${done.length} avgjorda tips</summary><p class="note"><a href="tips.html">Alla tips dag för dag finns under Så har det gått →</a></p><div class="tr-list">${done.slice(8).map(row).join('')}</div></details>` : ''}
    <p class="note">Alla tips från Dagens värde räknas – även de som inte gick in. Procenten till höger är modellens chans före matchen.${waiting ? ` ${waiting} tips väntar på matcher som inte är klara.` : ''}${back ? ' Tips före ' + esc(dayText(picks.filter(p => !p.back).map(p => p.utc).sort()[0] ?? new Date().toISOString())) + ' är räknade i efterhand med samma modell, som då bara fick se matcher spelade före avspark.' : ''}</p>
  </section>`;
}

// Fyller en plats på sidan med tipsstatistiken (tom om det inte finns några avgjorda tips än).
async function fillTrack(sel) {
  const html = await trackHtml();
  const el = document.querySelector(sel);
  if (el) el.innerHTML = html;
  // Kort rad vid priset: "✓ 34 av 56 tips gick in senaste 30 dagarna".
  const proof = document.getElementById('plan-proof');
  const big = el?.querySelector('.tr-big b');
  if (proof && big) { proof.innerHTML = `✓ <b>${big.textContent}</b> av våra tips gick in senaste 30 dagarna (${el.querySelector('.tr-big em').textContent})`; proof.hidden = false; }
}

// Liten länk vid "skapa konto" och betalningen: de senaste tipsen som prickar + träffprocent.
// Öppnas i ny flik så att man inte tappar det man fyllt i.
async function fillTeaser(sel) {
  const el = document.querySelector(sel);
  if (!el) return;
  const { picks = [] } = await loadTrack();
  const since = Date.now() - 30 * 864e5;
  const done = picks.filter(p => (p.result === 'won' || p.result === 'lost') && Date.parse(p.utc) > since);
  if (!done.length) return;
  const won = done.filter(p => p.result === 'won').length;
  const dots = done.slice(0, 10).reverse().map(p => `<i class="${p.result === 'won' ? 'w' : 'l'}" title="${esc(p.label)} – ${p.result === 'won' ? 'gick in' : 'gick inte in'}"></i>`).join('');
  el.innerHTML = `<a class="teaser" href="tips.html" target="_blank" rel="noopener">
    <span class="teaser-dots" aria-hidden="true">${dots}</span>
    <span class="teaser-txt"><b>Se hur våra senaste bets har gått</b><small>${won} av ${done.length} gick in senaste 30 dagarna · ${Math.round((won / done.length) * 100)}%</small></span>
    <span class="teaser-go" aria-hidden="true">→</span></a>`;
}
