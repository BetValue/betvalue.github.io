// Hämtar statistik (football-data.org) och odds (The Odds API), räknar fram
// sannolikheter och värdebets och skriver allt till data/latest.json.
//
//   FOOTBALL_DATA_KEY=... ODDS_API_KEY=... node scripts/fetch.mjs [--odds]
//
// Odds hämtas högst en gång per ODDS_MAX_AGE_H timmar (gratiskvoten är 500
// anrop/månad); --odds tvingar fram en ny hämtning.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { buildModel, predict } from './model.mjs';
import { findEvent } from './match.mjs';

const FD_KEY = process.env.FOOTBALL_DATA_KEY;
const ODDS_KEY = process.env.ODDS_API_KEY;
const FORCE_ODDS = process.argv.includes('--odds');
const ODDS_MAX_AGE_H = 20;
const PAST_DAYS = 10, AHEAD_DAYS = 14;
const MIN_EDGE = 0.04, MIN_ODDS = 1.3, MAX_ODDS = 8;
const MODEL_WEIGHT = { hög: 0.4, medel: 0.3, låg: 0.15 };
const DATA = new URL('../data/', import.meta.url);
const DAY = 864e5;

const COMPETITIONS = [
  { id: 'PL', name: 'Premier League', area: 'England', fd: 'PL', odds: 'soccer_epl' },
  { id: 'PD', name: 'La Liga', area: 'Spanien', fd: 'PD', odds: 'soccer_spain_la_liga' },
  { id: 'BL1', name: 'Bundesliga', area: 'Tyskland', fd: 'BL1', odds: 'soccer_germany_bundesliga' },
  { id: 'SA', name: 'Serie A', area: 'Italien', fd: 'SA', odds: 'soccer_italy_serie_a' },
  { id: 'FL1', name: 'Ligue 1', area: 'Frankrike', fd: 'FL1', odds: 'soccer_france_ligue_one' },
  { id: 'CL', name: 'Champions League', area: 'Europa', fd: 'CL', odds: 'soccer_uefa_champs_league' },
  { id: 'UNL', name: 'Nations League', area: 'Europa', fd: null, odds: 'soccer_uefa_nations_league' },
  { id: 'EC', name: 'EM', area: 'Europa', fd: 'EC', odds: 'soccer_uefa_european_championship' },
  { id: 'WC', name: 'VM', area: 'Världen', fd: 'WC', odds: 'soccer_fifa_world_cup' },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const r3 = x => Math.round(x * 1000) / 1000;

async function readJson(name, fallback) {
  try { return JSON.parse(await readFile(new URL(name, DATA), 'utf8')); } catch { return fallback; }
}
const writeJson = (name, obj) => writeFile(new URL(name, DATA), JSON.stringify(obj));

// ---------- football-data.org (max 10 anrop/minut på gratisnivån) ----------

let lastFd = 0;
async function fd(path, retries = 2) {
  const wait = lastFd + 6500 - Date.now();
  if (wait > 0) await sleep(wait);
  lastFd = Date.now();
  const res = await fetch('https://api.football-data.org/v4' + path, { headers: { 'X-Auth-Token': FD_KEY } });
  if (res.status === 429 && retries > 0) { await sleep(61000); return fd(path, retries - 1); }
  if (!res.ok) throw new Error(`football-data ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// ---------- The Odds API ----------

function slimEvent(e) {
  const books = [];
  for (const b of e.bookmakers ?? []) {
    const book = { name: b.title };
    for (const m of b.markets) {
      if (m.key === 'h2h') {
        const get = n => m.outcomes.find(o => o.name === n)?.price;
        book.h2h = { home: get(e.home_team), draw: get('Draw'), away: get(e.away_team) };
      } else if (m.key === 'totals') {
        const over = m.outcomes.find(o => o.name === 'Over' && o.point === 2.5);
        const under = m.outcomes.find(o => o.name === 'Under' && o.point === 2.5);
        if (over && under) book.ou25 = { over: over.price, under: under.price };
      }
    }
    books.push(book);
  }
  return { id: e.id, time: e.commence_time, home: e.home_team, away: e.away_team, books };
}

async function fetchOdds(prev) {
  if (!ODDS_KEY) return prev;
  const ageH = prev?.fetched ? (Date.now() - Date.parse(prev.fetched)) / 36e5 : Infinity;
  if (!FORCE_ODDS && ageH < ODDS_MAX_AGE_H) return prev;

  const base = 'https://api.the-odds-api.com/v4';
  const sportsRes = await fetch(`${base}/sports?apiKey=${ODDS_KEY}`); // kostar inga anrop
  if (!sportsRes.ok) { console.warn('Odds API /sports:', sportsRes.status); return prev; }
  const active = new Set((await sportsRes.json()).filter(s => s.active).map(s => s.key));

  const out = { fetched: new Date().toISOString(), remaining: prev?.remaining ?? null, sports: {} };
  for (const c of COMPETITIONS) {
    if (!active.has(c.odds)) continue;
    const res = await fetch(`${base}/sports/${c.odds}/odds?apiKey=${ODDS_KEY}&regions=eu&markets=h2h,totals&oddsFormat=decimal`);
    const left = res.headers.get('x-requests-remaining');
    if (left != null) out.remaining = Number(left);
    if (!res.ok) { console.warn(`Odds API ${c.odds}:`, res.status); continue; }
    out.sports[c.odds] = (await res.json()).map(slimEvent);
    console.log(`Odds ${c.name}: ${out.sports[c.odds].length} matcher, ${out.remaining} anrop kvar`);
    if (out.remaining != null && out.remaining < 20) break;
  }
  return out;
}

// Bästa odds per utfall + marknadens "rättvisa" sannolikhet (snitt över spelbolagen
// efter att deras marginal räknats bort).
function summarize(books, market, keys) {
  const valid = books.filter(b => b[market] && keys.every(k => b[market][k] > 1));
  if (!valid.length) return null;
  const fair = Object.fromEntries(keys.map(k => [k, 0]));
  for (const b of valid) {
    const inv = keys.map(k => 1 / b[market][k]);
    const sum = inv.reduce((s, x) => s + x, 0);
    keys.forEach((k, i) => { fair[k] += inv[i] / sum / valid.length; });
  }
  const out = { books: valid.length };
  for (const k of keys) {
    let best = null;
    for (const b of valid) if (!best || b[market][k] > best.odds) best = { odds: b[market][k], book: b.name };
    out[k] = { ...best, fair: r3(fair[k]) };
  }
  return out;
}

// ---------- Sammanställning ----------

const LIVE = new Set(['IN_PLAY', 'PAUSED']);
const UPCOMING = new Set(['SCHEDULED', 'TIMED']);

function teamInfo(t) {
  return { id: t.id, name: t.name, short: t.shortName || t.name, tla: t.tla, crest: t.crest };
}

function analyze(match, model, event) {
  const market = event && {
    h2h: summarize(event.books, 'h2h', ['home', 'draw', 'away']),
    ou25: summarize(event.books, 'ou25', ['over', 'under']),
    books: event.books.filter(b => b.h2h).map(b => ({ name: b.name, ...b.h2h })),
  };
  const w = model ? MODEL_WEIGHT[model.conf] : 0;
  const final = {}, values = [];
  const groups = [['h2h', ['home', 'draw', 'away']], ['ou25', ['over', 'under']]];
  for (const [mk, keys] of groups) {
    for (const k of keys) {
      const m = market?.[mk]?.[k];
      const pModel = model?.p[k];
      const p = m ? w * (pModel ?? m.fair) + (1 - w) * m.fair : pModel;
      if (p == null) continue;
      final[k] = r3(p);
      if (!m || !UPCOMING.has(match.status)) continue;
      const edge = p * m.odds - 1;
      if (edge >= MIN_EDGE && m.odds >= MIN_ODDS && m.odds <= MAX_ODDS) {
        values.push({ pick: k, odds: m.odds, book: m.book, p: r3(p), fair: m.fair, model: pModel ?? null, edge: r3(edge) });
      }
    }
  }
  return { market, final, values };
}

function formTable(finished, teams) {
  const byTeam = new Map();
  for (const m of [...finished].sort((a, b) => b.time - a.time)) {
    for (const [id, opp, gf, ga, home] of [[m.home, m.away, m.hg, m.ag, true], [m.away, m.home, m.ag, m.hg, false]]) {
      const list = byTeam.get(id) ?? [];
      if (list.length >= 5) continue;
      list.push({ r: gf > ga ? 'V' : gf === ga ? 'O' : 'F', opp: teams.get(opp)?.short ?? '?', gf, ga, home, date: new Date(m.time).toISOString() });
      byTeam.set(id, list);
    }
  }
  return Object.fromEntries(byTeam);
}

async function buildCompetition(c, odds, prev) {
  const events = odds?.sports?.[c.odds] ?? [];
  const now = Date.now();
  const inWindow = t => t > now - PAST_DAYS * DAY && t < now + AHEAD_DAYS * DAY;
  const base = { id: c.id, name: c.name, area: c.area, emblem: null, standings: [], form: {}, matches: [] };

  // Nations League: ingen gratis statistik, bara odds.
  if (!c.fd) {
    base.matches = events.filter(e => inWindow(Date.parse(e.time))).map(e => {
      const m = { id: 'o-' + e.id, utc: e.time, status: 'TIMED', stage: null,
        home: { id: null, name: e.home, short: e.home }, away: { id: null, name: e.away, short: e.away },
        score: null, model: null };
      return { ...m, ...analyze(m, null, e) };
    });
    return base;
  }
  if (!FD_KEY) return prev ?? base;

  const st = await fd(`/competitions/${c.fd}/standings`);
  const mt = await fd(`/competitions/${c.fd}/matches`);

  const teams = new Map();
  for (const m of mt.matches) for (const t of [m.homeTeam, m.awayTeam]) if (t?.id) teams.set(t.id, teamInfo(t));

  const finished = mt.matches
    .filter(m => m.status === 'FINISHED' && m.score.fullTime.home != null && m.homeTeam.id && m.awayTeam.id)
    .map(m => ({ home: m.homeTeam.id, away: m.awayTeam.id, hg: m.score.fullTime.home, ag: m.score.fullTime.away, time: Date.parse(m.utcDate) }));
  const model = buildModel(finished, now);

  base.emblem = st.competition?.emblem ?? null;
  base.season = st.season ? `${st.season.startDate.slice(0, 4)}/${st.season.endDate.slice(2, 4)}` : null;
  base.standings = st.standings.filter(s => s.type === 'TOTAL').map(s => ({
    group: s.group ? s.group.replace('GROUP_', 'Grupp ') : null,
    rows: s.table.map(r => ({
      pos: r.position, team: teamInfo(r.team), p: r.playedGames, w: r.won, d: r.draw, l: r.lost,
      gf: r.goalsFor, ga: r.goalsAgainst, gd: r.goalDifference, pts: r.points,
    })),
  }));
  base.form = formTable(finished, teams);

  base.matches = mt.matches
    .filter(m => inWindow(Date.parse(m.utcDate)) && m.homeTeam.id && m.awayTeam.id)
    .map(m => {
      const out = {
        id: m.id, utc: m.utcDate, status: m.status, stage: m.stage, matchday: m.matchday,
        home: teams.get(m.homeTeam.id), away: teams.get(m.awayTeam.id),
        score: m.score.fullTime.home != null ? { h: m.score.fullTime.home, a: m.score.fullTime.away } : null,
        model: m.status === 'FINISHED' ? null : predict(model, m.homeTeam.id, m.awayTeam.id),
      };
      const event = UPCOMING.has(m.status) || LIVE.has(m.status) ? findEvent(m, events) : null;
      return { ...out, ...analyze(out, out.model, event) };
    });

  const matched = base.matches.filter(m => m.market).length;
  const open = base.matches.filter(m => UPCOMING.has(m.status)).length;
  console.log(`${c.name}: ${base.matches.length} matcher, odds kopplade till ${matched}/${open} kommande (${events.length} odds-event)`);
  return base;
}

async function main() {
  await mkdir(DATA, { recursive: true });
  if (!FD_KEY) console.warn('FOOTBALL_DATA_KEY saknas – statistiken uppdateras inte.');
  if (!ODDS_KEY) console.warn('ODDS_API_KEY saknas – oddsen uppdateras inte.');

  const prevLatest = await readJson('latest.json', { competitions: [] });
  const odds = await fetchOdds(await readJson('odds.json', null));
  if (odds) await writeJson('odds.json', odds);

  const competitions = [];
  for (const c of COMPETITIONS) {
    const prev = prevLatest.competitions.find(p => p.id === c.id);
    try {
      competitions.push(await buildCompetition(c, odds, prev));
    } catch (err) {
      console.error(`${c.name}: ${err.message}`);
      if (prev) competitions.push(prev);
    }
  }

  await writeJson('latest.json', {
    updated: new Date().toISOString(),
    oddsUpdated: odds?.fetched ?? null,
    oddsRemaining: odds?.remaining ?? null,
    competitions,
  });
}

main().catch(err => { console.error(err); process.exit(1); });
