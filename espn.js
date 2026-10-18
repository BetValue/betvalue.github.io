// Startelvor, matchstatistik, spelarprofiler och klubbsidor från ESPN:s öppna API
// (ingen nyckel, CORS öppet). Allt hämtas när man öppnar något och cachas i minnet.

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer/';
const ESPN_WEB = 'https://site.web.api.espn.com/apis/common/v3/sports/soccer/';
const SLUG = { PL: 'eng.1', PD: 'esp.1', BL1: 'ger.1', SA: 'ita.1', FL1: 'fra.1', CL: 'uefa.champions', UNL: 'uefa.nations', EC: 'uefa.euro', WC: 'fifa.world' };
const espnCache = new Map();

function getJson(url) {
  if (!espnCache.has(url)) {
    espnCache.set(url, fetch(url).then(r => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).catch(err => { espnCache.delete(url); throw err; }));
  }
  return espnCache.get(url);
}

// ---------- Namnmatchning (samma idé som scripts/match.mjs) ----------

const STOPWORDS = new Set(['fc', 'cf', 'afc', 'sc', 'ssc', 'ac', 'as', 'club', 'de', 'del', 'la', 'calcio', 'cd', 'ud', 'rc', 'rcd', 'sv',
  'vfl', 'vfb', 'tsg', 'fsv', 'bc', 'ogc', 'stade', 'olympique', 'and', 'the', 'sad', 'bv', 'ss', 'us', 'acf', 'ca', 'sl', 'sk', 'fk', 'hotspur', 'losc', '1']);
const ALIASES = { munich: 'munchen', internazionale: 'inter', saint: 'st', wolves: 'wolverhampton', spurs: 'tottenham', psg: 'paris',
  cologne: 'koln', naples: 'napoli', milano: 'milan', rome: 'roma', turin: 'torino' };

function nameTokens(name) {
  return String(name ?? '').toLowerCase()
    .replace(/ø/g, 'o').replace(/ß/g, 'ss').replace(/æ/g, 'ae')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/).filter(t => t && !STOPWORDS.has(t) && !/^\d{4}$/.test(t)).map(t => ALIASES[t] ?? t);
}
function sameTok(a, b) {
  if (a === b || a.startsWith(b) || b.startsWith(a)) return true;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return i >= 4;
}
function nameSim(x, y) {
  const a = nameTokens(x), b = nameTokens(y);
  if (!a.length || !b.length) return 0;
  return (2 * a.filter(t => b.some(u => sameTok(t, u))).length) / (a.length + b.length);
}
function bestByName(list, name, getNames, min = 0.5) {
  let best = null, score = 0;
  for (const item of list) {
    const s = Math.max(...getNames(item).map(n => nameSim(n, name)));
    if (s > score) { best = item; score = s; }
  }
  return score >= min ? best : null;
}

// ---------- Uppslag ----------

const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '');

async function findEvent(m) {
  const slug = SLUG[m.comp.id];
  if (!slug) return null;
  const t = Date.parse(m.utc);
  for (const day of [new Date(t), new Date(t - 864e5)]) {
    const sb = await getJson(`${ESPN}${slug}/scoreboard?dates=${ymd(day)}`).catch(() => null);
    for (const e of sb?.events ?? []) {
      if (Math.abs(Date.parse(e.date) - t) > 6 * 36e5) continue;
      const comp = e.competitions[0].competitors;
      const home = comp.find(c => c.homeAway === 'home'), away = comp.find(c => c.homeAway === 'away');
      if (nameSim(home.team.displayName, m.home.name) > 0 && nameSim(away.team.displayName, m.away.name) > 0) return { slug, id: e.id };
    }
  }
  return null;
}

// ESPN-lag kopplade till våra lag (görs i scripts/fetch.mjs, ESPN:s lagslista saknar CORS).
function ourTeamName(c, id) {
  return standing(c, id)?.team.name ?? c.matches.flatMap(m => [m.home, m.away]).find(t => t.id === id)?.name ?? '';
}
function espnTeams(slug) {
  return DATA.latest.competitions.filter(c => c.espn && (!slug || c.espn.slug === slug)).flatMap(c =>
    Object.entries(c.espn.teams).map(([ourId, e]) => ({ ...e, ourId: Number(ourId), ourName: ourTeamName(c, Number(ourId)), compId: c.id })));
}
async function findTeam(slug, name) {
  if (!name) return null;
  const pick = list => bestByName(list, name, t => [t.name, t.ourName], 0.4);
  const t = pick(espnTeams(slug)) ?? pick(espnTeams(null));
  return t && { id: t.id, displayName: t.name, color: t.color, logos: t.logo ? [{ href: t.logo }] : [], ourId: t.ourId, compId: t.compId };
}

async function findPlayer(slug, teamName, playerName) {
  const team = await findTeam(slug, teamName);
  if (!team) return null;
  const roster = await getJson(`${ESPN}${slug}/teams/${team.id}/roster`);
  const p = bestByName(roster.athletes, playerName, a => [a.displayName, a.fullName], 0.5);
  return p ? { id: p.id, team } : null;
}

// ---------- Små byggstenar ----------

const hex = c => (c && /^[0-9a-f]{6}$/i.test(c) ? '#' + c : null);
const lum = c => { const h = hex(c); return h ? [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).reduce((t, v, i) => t + v * [0.2126, 0.7152, 0.0722][i], 0) : 0.5; };
const barColor = (c, fallback) => (hex(c) && lum(c) > 0.12 ? hex(c) : fallback);
function inkFor(color) {
  const c = hex(color);
  if (!c) return '#06110c';
  const [r, g, b] = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? '#06110c' : '#ffffff';
}
const initials = name => nameTokens(name).length ? String(name).split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase() : '?';
const statMap = list => Object.fromEntries((list ?? []).map(s => [s.name, Number(s.value ?? s.displayValue) || 0]));
const loading = text => `<div class="loading"><span class="spin"></span>${esc(text)}</div>`;

// ---------- Startelvor ----------

function depthOf(pos) {
  const p = (pos || '').toUpperCase();
  if (p === 'G' || p === 'GK') return 0;
  if (/WB/.test(p)) return 1.5;
  if (/^(CD|CB|LB|RB|D|SW)/.test(p)) return 1;
  if (/^DM/.test(p)) return 2;
  if (/^(CM|LM|RM|M)/.test(p)) return 3;
  if (/^(AM|LW|RW)/.test(p)) return 4;
  return 5;
}
function sideOf(pos) {
  const p = (pos || '').toUpperCase();
  if (/-L$/.test(p) || /^L(B|M|W|WB|CB)$/.test(p)) return 0;
  if (/-R$/.test(p) || /^R(B|M|W|WB|CB)$/.test(p)) return 2;
  return 1;
}

// Delar upp startelvan i linjer enligt formationen, t.ex. 4-2-3-1 → [1, 4, 2, 3, 1].
function lines(starters, formation) {
  const sorted = starters.slice().sort((a, b) =>
    depthOf(a.position?.abbreviation) - depthOf(b.position?.abbreviation) || (a.formationPlace ?? 0) - (b.formationPlace ?? 0));
  const counts = String(formation || '').split('-').map(Number).filter(n => n > 0);
  const shape = counts.reduce((s, n) => s + n, 0) === sorted.length - 1 ? [1, ...counts] : null;
  const out = [];
  if (shape) {
    let i = 0;
    for (const n of shape) { out.push(sorted.slice(i, i + n)); i += n; }
  } else {
    for (const p of sorted) {
      const d = Math.floor(depthOf(p.position?.abbreviation));
      (out[d] ??= []).push(p);
    }
  }
  return out.filter(Boolean).map(l => l.sort((a, b) => sideOf(a.position?.abbreviation) - sideOf(b.position?.abbreviation)));
}

// Med evId (matchen pågår eller är spelad) öppnar ett tryck spelarens statistik i just den matchen.
const lineupAttrs = (p, team, slug, evId) =>
  `data-player="${p.athlete.id}" data-slug="${slug}" data-pteam="${esc(team.displayName)}"${evId ? ` data-mevent="${evId}"` : ''}`;

function dot(p, team, slug, x, y, evId) {
  const s = statMap(p.stats);
  const name = p.athlete.lastName || p.athlete.shortName || p.athlete.displayName;
  const marks = `${'<i class="m-goal">⚽</i>'.repeat(Math.min(s.totalGoals || 0, 3))}${s.yellowCards ? '<i class="m-yc"></i>' : ''}${s.redCards ? '<i class="m-rc"></i>' : ''}${p.subbedOut ? '<i class="m-sub">▼</i>' : ''}`;
  return `<button class="pdot" style="left:${x}%;top:${y}%;--kit:${hex(team.color) ?? '#3ddc84'};--ink:${inkFor(team.color)}"
    ${lineupAttrs(p, team, slug, evId)}>
    <span class="kit">${esc(p.jersey ?? '')}</span>${marks ? `<span class="marks">${marks}</span>` : ''}
    <span class="pname">${esc(name)}</span></button>`;
}

function pitchHtml(rosters, slug, evId = null) {
  const home = rosters.find(r => r.homeAway === 'home') ?? rosters[0];
  const away = rosters.find(r => r.homeAway === 'away') ?? rosters[1];
  let dots = '';
  for (const [r, isHome] of [[home, true], [away, false]]) {
    const ls = lines(r.roster.filter(p => p.starter), r.formation);
    ls.forEach((line, k) => {
      const step = 36 / Math.max(ls.length - 1, 1);
      const y = isHome ? 93 - k * step : 7 + k * step;
      const ordered = isHome ? line : line.slice().reverse();
      ordered.forEach((p, i) => { dots += dot(p, r.team, slug, ((i + 1) / (ordered.length + 1)) * 100, y, evId); });
    });
  }
  const bench = r => r.roster.filter(p => !p.starter);
  const benchList = r => `<div class="bench"><div class="bench-head">${r.team.logo ? `<img src="${esc(r.team.logo)}" alt="">` : ''}<b>${esc(r.team.shortDisplayName ?? r.team.displayName)}</b><small>${esc(r.formation ?? '')}</small></div>
    ${bench(r).map(p => `<button class="bench-p" ${lineupAttrs(p, r.team, slug, evId)}>
      <span class="kit sm" style="--kit:${hex(r.team.color) ?? '#3ddc84'};--ink:${inkFor(r.team.color)}">${esc(p.jersey ?? '')}</span>
      <span>${esc(p.athlete.displayName)}</span>${p.subbedIn ? '<em>▲ in</em>' : ''}</button>`).join('')}</div>`;
  return `<div class="pitchwrap">
      <div class="formations"><span>${esc(away.team.shortDisplayName ?? away.team.displayName)} <b>${esc(away.formation ?? '')}</b></span></div>
      <div class="pitchbox"><div class="lines"><i class="half"></i><i class="circle"></i><i class="pbox pb-t"></i><i class="pbox pb-b"></i></div>${dots}</div>
      <div class="formations"><span>${esc(home.team.shortDisplayName ?? home.team.displayName)} <b>${esc(home.formation ?? '')}</b></span></div>
    </div>
    <details class="benches"><summary class="note">Avbytare</summary><div class="row2">${benchList(home)}${benchList(away)}</div></details>`;
}

// Förra matchens startelva för ett lag, när den riktiga elvan inte är släppt än.
async function previousRoster(slug, sum, teamId) {
  const games = (sum.lastFiveGames ?? []).find(g => String(g.team?.id) === String(teamId))?.events ?? [];
  const last = games.slice().sort((a, b) => b.gameDate.localeCompare(a.gameDate))[0];
  if (!last) return null;
  const s = await getJson(`${ESPN}${slug}/summary?event=${last.id}`).catch(() => null);
  const r = s?.rosters?.find(x => String(x.team.id) === String(teamId));
  return r?.roster?.some(p => p.starter) ? r : null;
}

const STAT_ROWS = [
  ['possessionPct', 'Bollinnehav', v => v + '%'], ['totalShots', 'Skott'], ['shotsOnTarget', 'Skott på mål'],
  ['wonCorners', 'Hörnor'], ['foulsCommitted', 'Fouls'], ['yellowCards', 'Gula kort'], ['redCards', 'Röda kort'],
  ['offsides', 'Offside'], ['saves', 'Räddningar'], ['blockedShots', 'Blockerade skott'], ['totalCrosses', 'Inlägg'], ['accuratePasses', 'Lyckade passningar'], ['effectiveTackles', 'Lyckade tacklingar'], ['interceptions', 'Brytningar'],
];

function matchStatsHtml(sum) {
  const teams = sum.boxscore?.teams;
  if (!teams?.length || !teams[0].statistics?.length) return '';
  const home = teams.find(t => t.homeAway === 'home') ?? teams[0], away = teams.find(t => t.homeAway === 'away') ?? teams[1];
  const hs = statMap(home.statistics), as = statMap(away.statistics);
  const rows = STAT_ROWS.filter(([k]) => k in hs && (hs[k] || as[k])).map(([k, label, fmt = v => v]) => {
    const a = hs[k], b = as[k], tot = a + b || 1;
    return `<div class="mstat"><div class="ms-top"><b class="${a > b ? 'lead' : ''}">${fmt(a)}</b><span>${label}</span><b class="${b > a ? 'lead' : ''}">${fmt(b)}</b></div>
      <div class="ms-bar"><i style="width:${(a / tot) * 100}%;--c:${barColor(home.team.color, 'var(--home)')}"></i><i style="width:${(b / tot) * 100}%;--c:${barColor(away.team.color === home.team.color ? null : away.team.color, 'var(--chalk)')}"></i></div></div>`;
  }).join('');
  return rows ? `<div class="box"><span class="label">Matchstatistik</span>${rows}</div>` : '';
}

// ---------- Händelser: mål, kort och byten (som på FotMob) ----------

const EVENT_KIND = [
  [/own goal/i, 'og'], [/penalty - scored/i, 'pen'], [/penalty - missed|penalty - saved/i, 'penmiss'], [/^goal/i, 'goal'],
  [/red card|second yellow/i, 'red'], [/yellow card/i, 'yellow'], [/substitution/i, 'sub'], [/^halftime/i, 'ht'],
];
const kindOf = e => EVENT_KIND.find(([re]) => re.test(e.type?.text ?? ''))?.[1] ?? null;
const lastName = n => String(n ?? '').split(' ').slice(-1)[0];

function matchEvents(sum) {
  const comp = sum.header?.competitions?.[0];
  const homeId = String(comp?.competitors?.find(c => c.homeAway === 'home')?.team?.id ?? '');
  let h = 0, a = 0;
  return (sum.keyEvents ?? []).map(e => {
    const kind = kindOf(e);
    if (!kind) return null;
    const side = e.team ? (String(e.team.id) === homeId ? 'home' : 'away') : null;
    const who = (e.participants ?? []).map(x => x.athlete?.displayName).filter(Boolean);
    if (['goal', 'pen', 'og'].includes(kind)) { if (side === 'home') h++; else if (side === 'away') a++; }
    return { kind, side, minute: e.clock?.displayValue ?? '', who, score: `${h}–${a}` };
  }).filter(Boolean);
}

// Målskyttar under resultattavlan: "Rudoni 6' (str), Cherif 48'".
function scorersHtml(events) {
  const goals = events.filter(e => ['goal', 'pen', 'og'].includes(e.kind));
  if (!goals.length) return '';
  const col = side => goals.filter(g => g.side === side).map(g =>
    `<span>${esc(lastName(g.who[0]))} ${esc(g.minute)}${g.kind === 'pen' ? ' (str)' : g.kind === 'og' ? ' (självm.)' : ''}</span>`).join('');
  return `<div class="scorers"><div class="sc-h">${col('home')}</div><span class="sc-ball">⚽</span><div class="sc-a">${col('away')}</div></div>`;
}

function eventLine(e) {
  const [main, other] = e.who;
  const text = {
    goal: `<b>${esc(main ?? 'Mål')}</b>${other ? `<small>Assist: ${esc(other)}</small>` : ''}`,
    pen: `<b>${esc(main ?? 'Straff')}</b><small>Straffmål</small>`,
    og: `<b>${esc(main ?? 'Självmål')}</b><small>Självmål</small>`,
    penmiss: `<b>${esc(main ?? 'Straff')}</b><small>Missad straff</small>`,
    yellow: `<b>${esc(main ?? '')}</b><small>Gult kort</small>`,
    red: `<b>${esc(main ?? '')}</b><small>Rött kort</small>`,
    sub: `<b class="in">▲ ${esc(main ?? '')}</b><small class="out">▼ ${esc(other ?? '')}</small>`,
  }[e.kind];
  const icon = { goal: '⚽', pen: '⚽', og: '⚽', penmiss: '✖', yellow: '<i class="card y"></i>', red: '<i class="card r"></i>', sub: '🔁' }[e.kind];
  const goal = ['goal', 'pen', 'og'].includes(e.kind);
  const body = `<div class="ev-body ${e.kind}">${goal ? `<span class="ev-score">${e.score}</span>` : ''}<span class="ev-ic">${icon}</span><div class="ev-txt">${text}</div></div>`;
  return `<div class="ev${goal ? ' is-goal' : ''}"><div class="ev-l">${e.side === 'home' ? body : ''}</div><span class="ev-min">${esc(e.minute)}</span><div class="ev-r">${e.side === 'away' ? body : ''}</div></div>`;
}

function eventsHtml(events) {
  if (!events.length) return '';
  const rows = events.map(e => (e.kind === 'ht'
    ? `<div class="ev-ht"><span>Paus ${esc(events.filter(x => x.kind !== 'ht' && ['goal', 'pen', 'og'].includes(x.kind) && events.indexOf(x) < events.indexOf(e)).pop()?.score ?? '0–0')}</span></div>`
    : eventLine(e))).join('');
  return `<div class="box"><span class="label">Händelser</span><div class="events">${rows}</div></div>`;
}

// Fylls i matchdetaljerna efter att arket öppnats.
async function loadMatchExtras(m, root) {
  const slot = root.querySelector('#espn-slot');
  if (!slot) return;
  if (!SLUG[m.comp.id]) { slot.innerHTML = ''; return; }
  slot.innerHTML = `<div class="box"><span class="label">Startelvor</span>${loading('Hämtar startelvor…')}</div>`;
  try {
    const ev = await findEvent(m);
    if (!ev) throw new Error('ingen match');
    const sum = await getJson(`${ESPN}${ev.slug}/summary?event=${ev.id}`);
    let rosters = sum.rosters ?? [];
    let note = '';
    if (!rosters.some(r => r.roster?.some(p => p.starter))) {
      const prev = await Promise.all(rosters.map(r => previousRoster(ev.slug, sum, r.team.id)));
      if (prev.every(Boolean)) {
        rosters = prev.map((p, i) => ({ ...p, homeAway: rosters[i].homeAway, team: { ...p.team, ...rosters[i].team } }));
        note = '<p class="note lineup">Startelvan är inte släppt än (kommer ca 1 h före avspark). Här är <b>förra matchens</b> startelvor.</p>';
      } else rosters = [];
    }
    if (!slot.isConnected) return;
    const events = matchEvents(sum);
    const scorersSlot = root.querySelector('#board-scorers');
    if (scorersSlot) scorersSlot.innerHTML = scorersHtml(events);
    const state = sum.header?.competitions?.[0]?.status?.type?.state;
    const inMatch = !note && (state === 'in' || state === 'post') ? ev.id : null;
    slot.innerHTML = eventsHtml(events) + matchStatsHtml(sum) + (rosters.length === 2
      ? `<div class="box"><span class="label">Startelvor</span>${note}${pitchHtml(rosters, ev.slug, inMatch)}<p class="note">${inMatch
        ? `Tryck på en spelare för hens statistik i matchen${state === 'in' ? ' (uppdateras live)' : ''}: skott, mål, assist, fouls med mera.`
        : 'Tryck på en spelare för all statistik.'}</p></div>`
      : `<div class="box"><span class="label">Startelvor</span><p class="note">Startelvorna släpps ungefär en timme före avspark.</p></div>`);
  } catch (err) {
    console.warn("ESPN:", err);
    if (slot.isConnected) slot.innerHTML = '<div class="box"><span class="label">Startelvor</span><p class="note">Kunde inte hämta startelvor just nu.</p></div>';
  }
}

// ---------- En spelares statistik i en match ----------

const MATCH_STATS = [
  ['totalGoals', 'Mål'], ['goalAssists', 'Assist'], ['totalShots', 'Skott'], ['shotsOnTarget', 'Skott på mål'],
  ['foulsCommitted', 'Fouls'], ['foulsSuffered', 'Fouls mot'], ['offsides', 'Offside'],
  ['yellowCards', 'Gula kort'], ['redCards', 'Röda kort'], ['ownGoals', 'Självmål', true],
];
const KEEPER_STATS = [['saves', 'Räddningar'], ['goalsConceded', 'Insläppta mål'], ['shotsFaced', 'Skott mot']];
// "67'" → 67, "90'+4'" → 94
const minuteOf = s => { const m = /(\d+)'?(?:\s*\+\s*(\d+))?/.exec(s ?? ''); return m ? Number(m[1]) + Number(m[2] ?? 0) : null; };

async function matchPlayerHtml(slug, evId, athleteId, teamName) {
  // Ny hämtning högst var 30:e sekund, så att siffrorna följer med under matchen.
  const sum = await getJson(`${ESPN}${slug}/summary?event=${evId}&_=${Math.floor(Date.now() / 3e4)}`);
  let entry = null, side = null;
  for (const r of sum.rosters ?? []) {
    const p = r.roster?.find(x => String(x.athlete?.id) === String(athleteId));
    if (p) { entry = p; side = r; break; }
  }
  if (!entry) return playerHtml(athleteId, slug, teamName);
  const a = entry.athlete, team = side.team, s = statMap(entry.stats);
  const comp = sum.header?.competitions?.[0];
  const live = comp?.status?.type?.state === 'in';
  const clockNow = comp?.status?.displayClock ?? '';
  const home = comp?.competitors?.find(c => c.homeAway === 'home'), away = comp?.competitors?.find(c => c.homeAway === 'away');
  const events = matchEvents(sum);
  const same = n => !!n && nameSim(n, a.displayName) >= 0.8;

  // Speltid: från avspark (eller inbytet) till utbytet/utvisningen (eller nu / slutsignalen).
  const now = live ? (minuteOf(clockNow) ?? 0) : 90;
  const subIn = events.find(e => e.kind === 'sub' && same(e.who[0]));
  const subOut = events.find(e => e.kind === 'sub' && same(e.who[1]));
  const red = events.find(e => e.kind === 'red' && same(e.who[0]));
  const from = entry.starter ? 0 : subIn ? minuteOf(subIn.minute) : null;
  const to = subOut ? minuteOf(subOut.minute) : red ? minuteOf(red.minute) : now;
  const mins = from == null ? null : Math.max(0, Math.min(to, 90) - Math.min(from, 90)) || (to > from ? 1 : 0);
  const played = entry.starter || from != null || entry.subbedIn;

  // Spelarens händelser: mål, assist, kort, byten.
  const mine = events.filter(e => e.kind !== 'ht' && (same(e.who[0]) || ((e.kind === 'goal' || e.kind === 'sub') && same(e.who[1]))));
  const evText = e => {
    if (e.kind === 'goal' && !same(e.who[0])) return ['👟', 'Assist' + (e.who[0] ? ' till ' + e.who[0] : '')];
    if (e.kind === 'sub') return same(e.who[0]) ? ['▲', 'Inbytt' + (e.who[1] ? ' mot ' + e.who[1] : '')] : ['▼', 'Utbytt'];
    return {
      goal: ['⚽', 'Mål'], pen: ['⚽', 'Straffmål'], og: ['⚽', 'Självmål'], penmiss: ['✖', 'Missad straff'],
      yellow: ['<i class="card y"></i>', 'Gult kort'], red: ['<i class="card r"></i>', 'Rött kort'],
    }[e.kind] ?? ['', e.kind];
  };

  const keeper = entry.position?.abbreviation === 'G';
  const rows = [...(keeper ? KEEPER_STATS : []), ...MATCH_STATS].filter(([k, , onlyIfAny]) => k in s && (!onlyIfAny || s[k]));
  const photo = await playerPhoto(a).catch(() => null);
  const color = hex(team.color) ?? '#3ddc84';
  const tname = t => esc(t?.team?.shortDisplayName ?? t?.team?.displayName ?? '');
  const when = entry.starter ? 'Startade' : 'Inbytt' + (subIn ? ' ' + esc(subIn.minute) : '');
  const end = subOut ? ' · utbytt ' + esc(subOut.minute) : red ? ' · utvisad ' + esc(red.minute) : live ? ' · på planen nu' : '';

  return `<div class="mp">
    <div class="mp-head" style="--kit:${color}">
      ${photo ? `<img class="mp-photo" src="${esc(photo.src)}" alt="">` : `<span class="kit mp-kit" style="--kit:${color};--ink:${inkFor(team.color)}">${esc(entry.jersey ?? '')}</span>`}
      <div class="mp-who">
        <span class="label">${live ? '<span class="mp-live">● Live ' + esc(clockNow) + '</span>' : 'Matchen är slut'}</span>
        <h2>${esc(a.displayName)}</h2>
        <small>${team.logo ? `<img src="${esc(team.logo)}" alt="">` : ''}${esc(team.displayName)}${entry.position?.displayName ? ' · ' + esc(entry.position.displayName) : ''}${entry.jersey ? ' · #' + esc(entry.jersey) : ''}</small>
        <div class="mp-score">${tname(home)} <b>${esc(home?.score ?? '0')}–${esc(away?.score ?? '0')}</b> ${tname(away)}</div>
      </div>
    </div>
    ${played
      ? `<div class="mp-mins"><b>${mins ?? '–'}'</b><span>${when}${end}</span></div>
         <div class="mp-grid">${rows.map(([k, label]) => `<div class="${s[k] ? 'nz' : ''}${(k === 'redCards' || k === 'ownGoals') && s[k] ? ' bad' : ''}"><b>${s[k]}</b><small>${label}</small></div>`).join('')}</div>`
      : '<p class="note">Satt på bänken och har inte spelat i matchen.</p>'}
    ${mine.length ? `<div class="box"><span class="label">I matchen</span><div class="mp-evs">${mine.map(e => {
      const [ic, t] = evText(e);
      return `<div><span class="ev-min">${esc(e.minute)}</span><span class="ev-ic">${ic}</span><span>${esc(t)}</span></div>`;
    }).join('')}</div></div>` : ''}
    ${live ? '<p class="note">Siffrorna hämtas på nytt var 30:e sekund – öppna spelaren igen för senaste läget.</p>' : ''}
    <button class="btn-ghost mp-full" data-player="${a.id}" data-slug="${slug}" data-pteam="${esc(team.displayName)}">Hela profilen och säsongen →</button>
  </div>`;
}

function openMatchPlayer(slug, evId, athleteId, teamName) {
  pushSheet(async () => matchPlayerHtml(slug, evId, athleteId, teamName));
}

// ---------- Spelarprofil ----------

const GAME_COLS = [['totalGoals', 'Mål'], ['goalAssists', 'Ass'], ['totalShots', 'Skott'], ['shotsOnTarget', 'På mål'], ['foulsCommitted', 'Fouls'], ['foulsSuffered', 'Fouls mot'], ['offsides', 'Offs.'], ['yellowCards', 'Gula'], ['redCards', 'Röda']];

function nextMatchFor(name) {
  const now = Date.now();
  for (const m of everyMatch().filter(x => UPCOMING.has(x.status) && Date.parse(x.utc) > now).sort((a, b) => a.utc.localeCompare(b.utc))) {
    const pl = m.extras?.players.find(p => nameSim(p.name, name) >= 0.8);
    if (pl) return { m, pl };
  }
  return null;
}

const POS_SV = { Goalkeeper: 'Målvakt', Defender: 'Försvarare', Midfielder: 'Mittfältare', Forward: 'Anfallare' };
function cm(display) {
  const m = /(\d+)'\s*(\d+)?/.exec(display ?? '');
  return m ? Math.round((Number(m[1]) * 12 + Number(m[2] ?? 0)) * 2.54) + ' cm' : null;
}

// Spelarbild från Wikipedia (fri licens, CORS öppet). Vi kräver att sidan handlar om en
// fotbollsspelare med samma namn – och samma födelseår om Wikipedia anger ett – så att
// vi inte visar fel person. Tar det för lång tid visas profilen utan bild.
// Färdig bildlista från datahämtningen (scripts/photos.mjs), laddas en gång per besök.
let photoIndex = null;
function loadPhotoIndex() {
  photoIndex ??= fetch('data/photos.json?d=' + new Date().toISOString().slice(0, 10))
    .then(r => (r.ok ? r.json() : { photos: {} })).then(j => j.photos ?? {}).catch(() => ({}));
  return photoIndex;
}
const wikiLink = title => 'https://en.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_'));

async function playerPhoto(a) {
  const known = (await loadPhotoIndex())[a.id];
  if (known) return { src: known.u, credit: known.p ? wikiLink(known.p) : null };
  if (a.headshot?.href) return { src: a.headshot.href, credit: null };
  // Reserv: sök live (för spelare som inte hunnit få bild i listan än).
  const year = (a.dateOfBirth ?? '').slice(0, 4);
  const url = 'https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrlimit=4'
    + '&prop=pageimages|description&piprop=thumbnail&pithumbsize=600&gsrsearch=' + encodeURIComponent(a.displayName + ' footballer');
  const search = getJson(url).then(j => {
    const pages = Object.values(j.query?.pages ?? {}).sort((x, y) => x.index - y.index);
    const ok = pages.find(p => {
      const desc = (p.description ?? '').toLowerCase();
      const born = /born (\d{4})/.exec(desc)?.[1];
      return p.thumbnail && /footballer|soccer player/.test(desc)
        && nameSim(p.title.replace(/\s*\(.*\)$/, ''), a.displayName) >= 0.7
        && (!year || !born || born === year);
    });
    return ok ? { src: ok.thumbnail.source, credit: wikiLink(ok.title) } : null;
  }).catch(() => null);
  return Promise.race([search, new Promise(r => setTimeout(() => r(null), 3000))]);
}

async function playerHtml(id, slug, teamName) {
  const [ath, ov, gl] = await Promise.all([
    getJson(`${ESPN_WEB}${slug}/athletes/${id}`),
    getJson(`${ESPN_WEB}${slug}/athletes/${id}/overview`).catch(() => null),
    getJson(`${ESPN_WEB}${slug}/athletes/${id}/gamelog`).catch(() => null),
  ]);
  const a = ath.athlete;
  let team = await findTeam(slug, teamName);
  // Hittades spelaren bara via ett landslag (han spelar i en liga vi inte har, t.ex. Turkiet)
  // visas hans riktiga klubb från ESPN i stället för landslaget.
  const national = /fifa|uefa\.(euro|nations)/.test(slug);
  if ((national || !team) && a.team?.displayName) {
    team = { displayName: a.team.displayName, color: a.team.color ?? team?.color, logos: a.team.logos?.length ? a.team.logos : (a.team.logo ? [{ href: a.team.logo }] : []) };
  }
  const color = team?.color, ink = inkFor(color);

  // Match för match (alla turneringar den här säsongen).
  const names = gl?.names ?? [];
  const games = [];
  const seen = new Set();
  for (const st of gl?.seasonTypes ?? []) for (const cat of st.categories ?? []) for (const e of cat.events ?? []) {
    if (seen.has(e.eventId)) continue;
    seen.add(e.eventId);
    const meta = gl.events?.[e.eventId];
    if (!meta) continue;
    games.push({ meta, s: Object.fromEntries(names.map((n, i) => [n, Number(e.stats[i]) || 0])) });
  }
  games.sort((x, y) => y.meta.gameDate.localeCompare(x.meta.gameDate));
  const n = games.length;
  const sum = k => games.reduce((t, g) => t + (g.s[k] || 0), 0);
  const hits = f => games.filter(g => f(g.s)).length;
  const per = k => (n ? (sum(k) / n).toFixed(2).replace('.', ',') : '–');
  const rate = (f, label) => { const h = hits(f); return `<div class="hit"><div class="hit-bar"><i style="width:${n ? (h / n) * 100 : 0}%"></i></div><span>${label}</span><b>${h}/${n}</b></div>`; };

  const nm = nextMatchFor(a.displayName);
  const splits = ov?.statistics?.splits ?? [];
  const sNames = ov?.statistics?.names ?? [];
  const leagueName = DATA.latest.competitions.find(c => SLUG[c.id] === slug)?.name ?? '';
  const photo = await playerPhoto(a);
  const shotPct = sum('totalShots') ? Math.round((sum('shotsOnTarget') / sum('totalShots')) * 100) : null;

  // Huvudsiffrorna, stora och tydliga i spelarkortet.
  const key = [['Mål', 'totalGoals'], ['Assist', 'goalAssists'], ['Skott', 'totalShots'], ['Skott på mål', 'shotsOnTarget']];
  const tile = (label, value, sub, cls = '') => `<div class="st ${cls}"><small>${label}</small><b>${value}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;

  return `<div class="phead" style="--kit:${hex(color) ?? '#3ddc84'};--ink:${ink}">
      <div class="ph-photo">${photo
        ? `<img src="${esc(photo.src)}" alt="${esc(a.displayName)}" onerror="this.parentNode.classList.add('nophoto');this.remove()"><span class="ph-no">${esc(a.jersey ?? initials(a.displayName))}</span>`
        : `<span class="ph-no">${esc(a.jersey ?? initials(a.displayName))}</span>`}</div>
      <div class="ph-main">
        <span class="label">${esc(POS_SV[a.position?.displayName] ?? a.position?.displayName ?? 'Spelare')}${team ? ' · ' + esc(team.displayName) : ''}</span>
        <h2>${esc(a.displayName)}</h2>
        <div class="ph-facts">${[a.age && `${a.age} år`, a.citizenship, cm(a.displayHeight), a.jersey && `Tröja #${a.jersey}`].filter(Boolean).map(f => `<span>${esc(f)}</span>`).join('')}</div>
      </div>
      ${team?.logos?.[0]?.href ? `<img class="ph-logo" src="${esc(team.logos[0].href)}" alt="">` : ''}
      ${typeof favButton === 'function' ? `<div class="ph-fav">${favButton('player', slug + ':' + id, a.displayName, { team: team?.displayName ?? teamName ?? '', logo: team?.logos?.[0]?.href ?? null, sub: team?.displayName ?? '' })}</div>` : ''}
      <div class="ph-key" title="${esc(leagueName)} den här säsongen">${key.map(([l, k]) => `<div><b>${sum(k)}</b><small>${l}</small><em>${n ? per(k) + ' / match' : '–'}</em></div>`).join('')}</div>
      ${photo?.credit ? `<a class="ph-credit" href="${esc(photo.credit)}" target="_blank" rel="noopener">Bild: Wikipedia</a>` : ''}
    </div>

    ${nm ? `<button class="box nextm" data-match="${nm.m.id}"><span class="label">Nästa match</span>
      <div class="nm-row">${crest(nm.m.home)}<b>${esc(nm.m.home.short)} – ${esc(nm.m.away.short)}</b>${crest(nm.m.away)}<small>${dayText(nm.m.utc)} ${clock(nm.m.utc)}</small></div>
      <div class="nm-num"><span>Chans att göra mål</span><b>${pct(nm.pl.p)}</b><small>värde från ${odd(minOdds(nm.pl.p))}</small></div></button>` : ''}

    <div class="box"><span class="label">Säsongen ${esc(DATA.latest.competitions.find(c => c.season)?.season ?? '')} · ${esc(leagueName)}</span>
      <div class="stgroup"><h4>Anfall</h4><div class="sts">
        ${tile('Matcher', n)}
        ${tile('Mål', sum('totalGoals'), n ? per('totalGoals') + ' / match' : '', 'hot')}
        ${tile('Assist', sum('goalAssists'), n ? per('goalAssists') + ' / match' : '', 'hot')}
        ${tile('Mål + assist', sum('totalGoals') + sum('goalAssists'), '', 'hot')}
        ${tile('Skott', sum('totalShots'), n ? per('totalShots') + ' / match' : '')}
        ${tile('Skott på mål', sum('shotsOnTarget'), n ? per('shotsOnTarget') + ' / match' : '')}
        ${tile('Träffsäkerhet', shotPct == null ? '–' : shotPct + '%', 'av skotten på mål')}
        ${tile('Offside', sum('offsides'), n ? per('offsides') + ' / match' : '')}
      </div></div>
      <div class="stgroup"><h4>Fouls och kort</h4><div class="sts">
        ${tile('Fouls begångna', sum('foulsCommitted'), n ? per('foulsCommitted') + ' / match' : '')}
        ${tile('Blivit fälld', sum('foulsSuffered'), n ? per('foulsSuffered') + ' / match' : '')}
        ${tile('Gula kort', sum('yellowCards'), '', 'yc')}
        ${tile('Röda kort', sum('redCards'), '', 'rc')}
      </div></div>
    </div>

    ${n ? `<div class="box"><span class="label">Trender · bra för bet builders</span>
      ${rate(s => s.totalShots >= 1, 'Minst 1 skott')}
      ${rate(s => s.totalShots >= 2, 'Minst 2 skott')}
      ${rate(s => s.shotsOnTarget >= 1, 'Minst 1 skott på mål')}
      ${rate(s => s.totalGoals >= 1, 'Gjorde mål')}
      ${rate(s => s.totalGoals + s.goalAssists >= 1, 'Mål eller assist')}
      ${rate(s => s.foulsCommitted >= 1, 'Minst 1 foul')}
      ${rate(s => s.foulsSuffered >= 1, 'Blev fällt minst 1 gång')}
      ${rate(s => s.yellowCards >= 1, 'Fick gult kort')}
    </div>` : ''}

    ${n ? `<div class="box"><span class="label">Match för match</span><div class="odds-wrap"><table class="glog">
      <thead><tr><th style="text-align:left">Match</th><th>Res.</th>${GAME_COLS.map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead>
      <tbody>${games.slice(0, 15).map(g => `<tr>
        <td class="gl-opp"><div>${g.meta.opponent?.logo ? `<img src="${esc(g.meta.opponent.logo)}" alt="">` : ''}<span>${g.meta.atVs === '@' ? 'borta ' : ''}${esc(g.meta.opponent?.displayName ?? '?')}</span><small>${esc(g.meta.gameDate.slice(5, 10).replace('-', '/'))} · ${esc(g.meta.leagueAbbreviation ?? '')}</small></div></td>
        <td><span class="res ${esc(g.meta.gameResult ?? '')}">${esc(g.meta.score ?? '')}</span></td>
        ${GAME_COLS.map(([k]) => `<td class="${g.s[k] ? 'nz' : ''}">${g.s[k] ?? 0}</td>`).join('')}
      </tr>`).join('')}</tbody></table></div></div>` : '<p class="note">Ingen matchstatistik för spelaren den här säsongen.</p>'}

    ${splits.length ? `<div class="box"><span class="label">Per turnering</span><div class="odds-wrap"><table class="glog">
      <thead><tr><th style="text-align:left">Turnering</th>${(ov.statistics.labels ?? []).map(l => `<th>${esc(l)}</th>`).join('')}</tr></thead>
      <tbody>${splits.map(s => `<tr><td class="gl-opp"><div><span>${esc(s.displayName)}</span></div></td>${s.stats.map(v => `<td class="${+v ? 'nz' : ''}">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="note">${sNames.length ? 'STRT = starter, FC = fouls, FA = fouls mot, YC/RC = gula/röda, G = mål, A = assist, SHOT = skott, SOG = på mål, OF = offside.' : ''}</p></div>` : ''}`;
}

async function openPlayer(id, slug, teamName) {
  pushSheet(async () => playerHtml(id, slug, teamName));
}

async function openPlayerByName(compId, teamName, playerName) {
  const slug = SLUG[compId];
  if (!slug) return;
  pushSheet(async () => {
    const p = await findPlayer(slug, teamName, playerName);
    if (!p) return `<p class="empty">Hittade ingen profil för ${esc(playerName)}.</p>`;
    return playerHtml(p.id, slug, p.team.displayName);
  });
}

// ---------- Klubbsida ----------

const POS_GROUPS = [['G', 'Målvakter'], ['D', 'Försvarare'], ['M', 'Mittfältare'], ['F', 'Anfallare']];

async function clubHtml(compId, ourTeamId, teamName) {
  const slug = SLUG[compId];
  const c = DATA.latest.competitions.find(x => x.id === compId);
  const ours = c && ourTeamId ? (standing(c, ourTeamId)?.team ?? c.matches.flatMap(m => [m.home, m.away]).find(t => t.id === ourTeamId)) : null;
  const mapped = c?.espn?.teams?.[ourTeamId];
  const t = mapped ? { id: mapped.id, displayName: mapped.name, color: mapped.color, logos: mapped.logo ? [{ href: mapped.logo }] : [], ourId: ourTeamId }
    : slug ? await findTeam(slug, teamName ?? ours?.name) : null;
  if (!t) return `<p class="empty">Hittade ingen klubbsida.</p>`;
  const roster = await getJson(`${ESPN}${slug}/teams/${t.id}/roster`).catch(() => null);
  const team = t;
  ourTeamId ??= t.ourId;
  const color = hex(team.color) ?? '#3ddc84';
  ourTeamId ??= null;
  const row = c && ourTeamId ? standing(c, ourTeamId) : null;
  const upcoming = c && ourTeamId ? everyMatch().filter(m => (m.home.id === ourTeamId || m.away.id === ourTeamId) && UPCOMING.has(m.status))
    .sort((a, b) => a.utc.localeCompare(b.utc)).slice(0, 3) : [];
  const recent = c && ourTeamId ? (c.form[ourTeamId] ?? []) : [];

  const players = (roster?.athletes ?? []).map(p => {
    const s = {};
    for (const cat of p.statistics?.splits?.categories ?? []) Object.assign(s, statMap(cat.stats));
    return { p, s };
  });
  const leader = (k, label) => {
    const top = players.slice().sort((a, b) => (b.s[k] || 0) - (a.s[k] || 0))[0];
    return top && top.s[k] ? `<button class="leader" data-player="${top.p.id}" data-slug="${slug}" data-pteam="${esc(team.displayName)}">
      <small>${label}</small><b>${top.s[k]}</b><span>${esc(top.p.displayName)}</span></button>` : '';
  };
  const group = (code, label) => {
    const list = players.filter(x => (x.p.position?.abbreviation ?? '').toUpperCase().startsWith(code))
      .sort((a, b) => (b.s.appearances || 0) - (a.s.appearances || 0) || (b.s.totalGoals || 0) - (a.s.totalGoals || 0));
    if (!list.length) return '';
    return `<tr class="grp"><td colspan="9">${label}</td></tr>${list.map(({ p, s }) => `<tr class="click" data-player="${p.id}" data-slug="${slug}" data-pteam="${esc(team.displayName)}">
      <td class="pos">${esc(p.jersey ?? '')}</td>
      <td class="team-cell"><div><span>${esc(p.displayName)}</span><small class="muted">${p.age ? p.age + ' år' : ''}${p.citizenship ? ' · ' + esc(p.citizenship) : ''}</small></div></td>
      <td>${s.appearances ?? 0}</td><td class="pts">${s.totalGoals ?? 0}</td><td>${s.goalAssists ?? 0}</td>
      <td class="hide-sm">${s.totalShots ?? 0}</td><td class="hide-sm">${s.shotsOnTarget ?? 0}</td><td class="hide-sm">${s.foulsCommitted ?? 0}</td><td class="hide-sm">${s.yellowCards ?? 0}</td>
    </tr>`).join('')}`;
  };

  return `<div class="chead" style="--kit:${color}">
      ${team.logos?.[0]?.href ? `<img src="${esc(team.logos[0].href)}" alt="">` : crest(ours)}
      <div><span class="label">${esc(c?.name ?? '')}</span><h2>${esc(team.displayName)}</h2>
        ${row ? `<small>${ord(row.pos)} i ${esc(c.name)} · ${row.pts} poäng</small>` : ''}
        ${typeof favButton === 'function' && ourTeamId ? favButton('team', compId + ':' + ourTeamId, team.displayName, { logo: team.logos?.[0]?.href ?? null, sub: c?.name ?? '' }) : ''}</div>
    </div>

    ${row ? `<div class="box"><span class="label">Tabellen</span><div class="sgrid">
      ${[['Plats', ord(row.pos)], ['Poäng', row.pts], ['Matcher', row.p], ['V–O–F', `${row.w}–${row.d}–${row.l}`], ['Mål', `${row.gf}–${row.ga}`], ['Mål/match', (row.gf / (row.p || 1)).toFixed(1).replace('.', ',')]]
        .map(([l, v]) => `<div><b>${v}</b><small>${l}</small></div>`).join('')}</div>
      ${recent.length ? `<div class="formrow"><div><span>Form</span></div>${formIcons(recent)}</div>` : ''}</div>` : ''}

    ${upcoming.length ? `<div class="box"><span class="label">Kommande matcher</span>${upcoming.map(m => `<button class="nm-row up" data-match="${m.id}">
      ${crest(m.home)}<b>${esc(m.home.short)} – ${esc(m.away.short)}</b>${crest(m.away)}<small>${dayText(m.utc)} ${clock(m.utc)}</small></button>`).join('')}</div>` : ''}

    ${players.length ? `<div class="leaders">${leader('totalGoals', 'Flest mål')}${leader('totalShots', 'Flest skott')}${leader('goalAssists', 'Flest assist')}${leader('foulsCommitted', 'Flest fouls')}</div>
    <div class="box"><span class="label">Truppen · tryck på en spelare</span><div class="odds-wrap"><table class="squad">
      <thead><tr><th>#</th><th style="text-align:left">Spelare</th><th>M</th><th>Mål</th><th>Ass</th><th class="hide-sm">Skott</th><th class="hide-sm">På mål</th><th class="hide-sm">Fouls</th><th class="hide-sm">Gula</th></tr></thead>
      <tbody>${POS_GROUPS.map(([code, label]) => group(code, label)).join('')}</tbody></table></div></div>` : ''}`;
}

function openClub(compId, ourTeamId, teamName) {
  pushSheet(async () => clubHtml(compId, ourTeamId, teamName));
}

// ---------- Klick ----------

document.addEventListener('click', e => {
  const t = e.target.closest('[data-player],[data-pname],[data-cteam]');
  if (!t) return;
  e.stopPropagation();
  if (t.dataset.mevent) openMatchPlayer(t.dataset.slug, t.dataset.mevent, t.dataset.player, t.dataset.pteam);
  else if (t.dataset.player) openPlayer(t.dataset.player, t.dataset.slug, t.dataset.pteam);
  else if (t.dataset.pname) openPlayerByName(t.dataset.pcomp, t.dataset.pteamname, t.dataset.pname);
  else openClub(t.dataset.ccomp, t.dataset.cteam ? Number(t.dataset.cteam) || null : null, t.dataset.cname);
}, true);
