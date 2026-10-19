// Lag- och spelarstatistik från ESPN för matcher som spelas snart: hörnor, kort, fouls, skott,
// halvlekar och spelarnas skott/fouls/kort/mål/assist per match. Används av picks.js för
// hörn-, kort- och spelarmarknader (Dagens värde, Boostar) och för att rätta sådana spel.
//
// Cache: data/espn-stats.json
//   leagues: { espnLagId: { slug, t } }           – lagets hemmaliga (för lag i Champions League)
//   sched:   { "slug:lagId": { t, ev: [id, …] } }  – lagets senaste spelade ligamatcher
//   events:  { id: kompakt match }                 – se compactSummary()
//
// Bara spelade matcher sparas, och varje match hämtas en gång.

import { readFile, writeFile } from 'node:fs/promises';

const DATA = new URL('../data/', import.meta.url);
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer/';
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36' };
const DOMESTIC = new Set(['eng.1', 'esp.1', 'ger.1', 'ita.1', 'fra.1']);
const AHEAD_H = 48, LAST_N = 10, SCHED_MAX_AGE_H = 12, LEAGUE_MAX_AGE_D = 30, KEEP_DAYS = 400;
const MAX_PLAYERS = 12, SERIES = 8;
const UPCOMING = new Set(['SCHEDULED', 'TIMED']);

const r2 = x => Math.round(x * 100) / 100;
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

async function readJson(name, fallback) {
  try { return JSON.parse(await readFile(new URL(name, DATA), 'utf8')); } catch { return fallback; }
}
async function get(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}
// Kör högst n anrop samtidigt.
async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch(() => null); } }));
  return out;
}

const TEAM_STATS = ['wonCorners', 'yellowCards', 'redCards', 'foulsCommitted', 'totalShots', 'shotsOnTarget', 'totalTackles'];
const PLAYER_STATS = ['totalShots', 'shotsOnTarget', 'foulsCommitted', 'foulsSuffered', 'yellowCards', 'redCards', 'totalGoals', 'goalAssists'];

// En spelad match i kompakt form:
//   { d, s, r: domare, h, a: lag-id, sc: [h, a], ht: [h, a] | null,
//     t: { lagId: [hörnor, gula, röda, fouls, skott, skott på mål, tacklingar] },
//     p: [[spelar-id, lag-id, namn, position, start 1/0, minuter, skott, på mål, fouls, fälld, gula, röda, mål, assist]] }
export function compactSummary(s, slug) {
  const comp = s.header?.competitions?.[0];
  if (comp?.status?.type?.state !== 'post') return null;
  const home = comp.competitors.find(c => c.homeAway === 'home'), away = comp.competitors.find(c => c.homeAway === 'away');
  if (!home || !away) return null;
  const ls = c => c.linescores?.[0]?.displayValue;
  const t = {};
  for (const bt of s.boxscore?.teams ?? []) {
    const m = new Map((bt.statistics ?? []).map(x => [x.name, x.displayValue]));
    if (m.size) t[bt.team.id] = TEAM_STATS.map(k => num(m.get(k)));
  }
  // Minuter: startspelare 90 om de inte byts ut, inbytta 90 minus bytesminuten.
  const subMin = new Map(), outMin = new Map();
  for (const k of s.keyEvents ?? []) {
    if (!/substitution/i.test(k.type?.type ?? '')) continue;
    const min = Math.min(90, Math.round(num(k.clock?.value) / 60));
    const [inP, outP] = k.participants ?? [];
    if (inP?.athlete?.id) subMin.set(inP.athlete.id, min);
    if (outP?.athlete?.id) outMin.set(outP.athlete.id, min);
  }
  const p = [];
  for (const r of s.rosters ?? []) {
    for (const x of r.roster ?? []) {
      if (!x.starter && !x.subbedIn) continue;
      const id = x.athlete?.id;
      const st = new Map((x.stats ?? []).map(y => [y.name, y.value]));
      const min = x.starter ? (outMin.get(id) ?? 90) : Math.max(1, 90 - (subMin.get(id) ?? 75));
      p.push([id, r.team?.id, x.athlete?.displayName, x.position?.abbreviation ?? '', x.starter ? 1 : 0, min, ...PLAYER_STATS.map(k => num(st.get(k)))]);
    }
  }
  return {
    d: comp.date ?? s.header?.competitions?.[0]?.date, s: slug,
    r: s.gameInfo?.officials?.find(o => /referee/i.test(o.position?.name ?? ''))?.displayName ?? null,
    h: home.team.id, a: away.team.id, sc: [num(home.score), num(away.score)],
    ht: ls(home) != null && ls(away) != null ? [num(ls(home)), num(ls(away))] : null, t, p,
  };
}

export async function fetchEvent(cache, slug, id) {
  if (cache.events[id]) return cache.events[id];
  const s = await get(`${ESPN}${slug}/summary?event=${id}`);
  const ev = compactSummary(s, slug);
  if (ev) cache.events[id] = ev;
  return ev;
}

async function domesticSlug(cache, teamId, compSlug) {
  if (DOMESTIC.has(compSlug)) return compSlug;
  const c = cache.leagues[teamId];
  if (c && Date.now() - c.t < LEAGUE_MAX_AGE_D * 864e5) return c.slug;
  const t = await get(`${ESPN}${compSlug}/teams/${teamId}`);
  const href = t.team?.defaultLeague?.links?.[0]?.href ?? '';
  const slug = /\/name\/([a-z0-9._]+)/i.exec(href)?.[1] ?? null;
  cache.leagues[teamId] = { slug, t: Date.now() };
  return slug;
}

async function teamEvents(cache, slug, teamId) {
  const k = slug + ':' + teamId;
  const c = cache.sched[k];
  if (c && Date.now() - c.t < SCHED_MAX_AGE_H * 36e5) return c.ev;
  const sch = await get(`${ESPN}${slug}/teams/${teamId}/schedule`);
  let evs = (sch.events ?? []).filter(e => e.competitions?.[0]?.status?.type?.state === 'post');
  // Tidigt på säsongen: fyll på med förra säsongen.
  if (evs.length < LAST_N) {
    const year = Number(sch.requestedSeason?.year ?? sch.season?.year ?? new Date().getFullYear());
    const prev = await get(`${ESPN}${slug}/teams/${teamId}/schedule?season=${year - 1}`).catch(() => null);
    evs = evs.concat((prev?.events ?? []).filter(e => e.competitions?.[0]?.status?.type?.state === 'post'));
  }
  const ev = evs.sort((a, b) => b.date.localeCompare(a.date)).slice(0, LAST_N).map(e => e.id);
  cache.sched[k] = { t: Date.now(), ev };
  return ev;
}

// ---------- Sammanställning ----------

// Snitt för ett lag i sina senaste matcher. venue: 'home' | 'away' | null (alla).
function teamProfile(evs, teamId, venue) {
  const list = evs.filter(e => e.t[teamId] && (!venue || (venue === 'home' ? e.h : e.a) === teamId));
  if (!list.length) return null;
  const s = { n: list.length, gf: 0, ga: 0, cf: 0, ca: 0, yf: 0, ya: 0, ff: 0, fa: 0, sf: 0, sa: 0, tf: 0, ta: 0, btts: 0, o25: 0, ht: 0, htn: 0, g1f: 0, g1a: 0 };
  for (const e of list) {
    const home = e.h === teamId, opp = home ? e.a : e.h;
    const me = e.t[teamId], them = e.t[opp] ?? [];
    const [gf, ga] = home ? e.sc : [e.sc[1], e.sc[0]];
    s.gf += gf; s.ga += ga;
    s.cf += me[0]; s.ca += num(them[0]); s.yf += me[1]; s.ya += num(them[1]);
    s.ff += me[3]; s.fa += num(them[3]); s.sf += me[4]; s.sa += num(them[4]); s.tf += me[5]; s.ta += num(them[5]);
    if (gf > 0 && ga > 0) s.btts++;
    if (gf + ga >= 3) s.o25++;
    if (e.ht) { const [h1, a1] = home ? e.ht : [e.ht[1], e.ht[0]]; s.g1f += h1; s.g1a += a1; s.htn++; }
  }
  const out = { n: s.n };
  for (const k of ['gf', 'ga', 'cf', 'ca', 'yf', 'ya', 'ff', 'fa', 'sf', 'sa', 'tf', 'ta']) out[k] = r2(s[k] / s.n);
  out.btts = s.btts; out.o25 = s.o25;
  if (s.htn) { out.g1f = r2(s.g1f / s.htn); out.g1a = r2(s.g1a / s.htn); }
  return out;
}

// Ligasnitt per lag och match, och andel mål i första halvlek.
function leagueAverages(evs) {
  const a = { n: 0, c: 0, y: 0, f: 0, s: 0, t: 0, g: 0, g1: 0, htn: 0 };
  for (const e of evs) {
    for (const v of Object.values(e.t)) { a.n++; a.c += v[0]; a.y += v[1]; a.f += v[3]; a.s += v[4]; a.t += v[5]; }
    if (e.ht) { a.g += e.sc[0] + e.sc[1]; a.g1 += e.ht[0] + e.ht[1]; a.htn++; }
  }
  if (!a.n) return null;
  return { n: a.n / 2, c: r2(a.c / a.n), y: r2(a.y / a.n), f: r2(a.f / a.n), s: r2(a.s / a.n), t: r2(a.t / a.n), h1: a.g ? r2(a.g1 / a.g) : 0.45 };
}

// ESPN:s position (CD-L, DM, LW …) → G/D/M/F. Inbytta har positionen SUB och räknas inte.
const posGroup = p => (!p || p === 'SUB' ? '' : p === 'G' ? 'G' : /^(CD|LB|RB|LWB|RWB|D|SW)/.test(p) ? 'D' : /^(F|CF|ST|LW|RW|LF|RF)/.test(p) ? 'F' : 'M');

// Troliga startspelare: startade lagets senaste match, eller minst 3 av de 5 senaste.
// Serien (senaste SERIES matcherna spelaren var med i) används för träffbilden: "minst 2 skott i 6 av 7".
function playerProfiles(evs, teamId) {
  const team = evs.filter(e => e.t[teamId] || e.p.some(p => p[1] === teamId));
  const last = team[0], last5 = team.slice(0, 5);
  const byId = new Map();
  team.forEach((e, idx) => {
    for (const p of e.p) {
      if (p[1] !== teamId) continue;
      const x = byId.get(p[0]) ?? { id: p[0], name: p[2], pos: '', apps: 0, starts: 0, min: 0, tot: Array(8).fill(0), s: [], recentStarts: 0, lastStart: false };
      x.apps++; x.starts += p[4]; x.min += p[5];
      for (let k = 0; k < 8; k++) x.tot[k] += p[6 + k];
      if (x.s.length < SERIES) x.s.push([p[4], p[5], ...p.slice(6)]);
      if (idx < 5 && p[4]) x.recentStarts++;
      if (e === last && p[4]) x.lastStart = true;
      if (!x.pos && posGroup(p[3])) x.pos = posGroup(p[3]);
      byId.set(p[0], x);
    }
  });
  return [...byId.values()]
    .filter(x => x.pos !== 'G' && (x.lastStart || x.recentStarts >= Math.min(3, last5.length)))
    .sort((a, b) => b.min - a.min).slice(0, MAX_PLAYERS)
    // [id, namn, position, matcher, starter, minuter, summor (skott, på mål, fouls, fälld, gula, röda, mål, assist), serie, startade senaste]
    .map(x => [x.id, x.name, x.pos, x.apps, x.starts, x.min, x.tot, x.s, x.lastStart ? 1 : 0]);
}

// Lägger m.extras.stats på matcher som spelas inom AHEAD_H timmar.
export async function addStats(competitions) {
  const cache = await readJson('espn-stats.json', { leagues: {}, sched: {}, events: {} });
  const now = Date.now();
  const targets = [];
  for (const c of competitions) {
    if (!c.espn?.slug) continue;
    for (const m of c.matches) {
      if (!UPCOMING.has(m.status) || !m.model || Date.parse(m.utc) > now + AHEAD_H * 36e5) continue;
      const h = c.espn.teams?.[m.home.id]?.id, a = c.espn.teams?.[m.away.id]?.id;
      if (h && a) targets.push({ m, slug: c.espn.slug, h, a });
    }
  }
  // Lagens ligor och senaste matcher.
  const teams = [...new Map(targets.flatMap(t => [[t.h, t.slug], [t.a, t.slug]])).entries()];
  const evIds = new Map();
  let calls = 0;
  await pool(teams, 6, async ([id, compSlug]) => {
    const slug = await domesticSlug(cache, id, compSlug);
    if (!slug) return;
    const ev = await teamEvents(cache, slug, id);
    for (const e of ev) evIds.set(e, slug);
  });
  const missing = [...evIds].filter(([id]) => !cache.events[id]);
  await pool(missing, 6, async ([id, slug]) => { await fetchEvent(cache, slug, id); calls++; });

  const leagueOf = {}, leagues = {};
  for (const [, ev] of Object.entries(cache.events)) (leagueOf[ev.s] ??= []).push(ev);
  for (const [slug, list] of Object.entries(leagueOf)) leagues[slug] = leagueAverages(list);

  let n = 0;
  for (const t of targets) {
    const side = id => {
      const slug = DOMESTIC.has(t.slug) ? t.slug : cache.leagues[id]?.slug;
      const ids = cache.sched[slug + ':' + id]?.ev ?? [];
      const evs = ids.map(e => cache.events[e]).filter(Boolean);
      return { slug, evs };
    };
    const H = side(t.h), A = side(t.a);
    if (H.evs.length < 3 || A.evs.length < 3) continue;
    const stats = {
      home: { all: teamProfile(H.evs, t.h), venue: teamProfile(H.evs, t.h, 'home'), lg: leagues[H.slug] ?? null, slug: H.slug },
      away: { all: teamProfile(A.evs, t.a), venue: teamProfile(A.evs, t.a, 'away'), lg: leagues[A.slug] ?? null, slug: A.slug },
      pl: { home: playerProfiles(H.evs, t.h), away: playerProfiles(A.evs, t.a) },
    };
    t.m.extras = { ...(t.m.extras ?? {}), stats };
    n++;
  }

  // Städa: matcher som ingen lista pekar på längre och som är gamla.
  const used = new Set(Object.values(cache.sched).flatMap(s => s.ev));
  for (const [id, ev] of Object.entries(cache.events)) if (!used.has(id) && Date.parse(ev.d) < now - KEEP_DAYS * 864e5) delete cache.events[id];
  await writeFile(new URL('espn-stats.json', DATA), JSON.stringify(cache));
  console.log(`Statistik: ${n}/${targets.length} matcher med lag- och spelarstatistik, ${calls} nya ESPN-matcher, ${Object.keys(cache.events).length} sparade`);
  return cache;
}
