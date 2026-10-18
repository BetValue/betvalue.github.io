// Vår tipsstatistik (data/track.json): alla spel som Dagens värde rekommenderar sparas när
// matchen närmar sig avspark och rättas när den är spelad. Visas öppet för alla (även
// utloggade) så att man kan se hur många av våra tips som gått in.
//
// Urvalet är samma som i dagens.js: dagens bästa bet, upp till 6 enskilda spel, ett bet
// builder per match (max 6) och de 8 bästa målskyttarna per dag.
//
// Ett tips läggs in först när matchen börjar inom LOCK_HOURS (så att medlemmarnas tips inte
// syns öppet långt i förväg) och ändras inte efter avspark.
//
// Målskyttar (data/goals.json) hämtas från ESPN:s scoreboard för spelade matcher; de behövs
// för att rätta målskyttebets och visas på sidan för sparade bets.

import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const { gradeBet } = createRequire(import.meta.url)('../grade.js');
const DATA = new URL('../data/', import.meta.url);
const TZ = 'Europe/Stockholm';
const LOCK_HOURS = 3.5, KEEP_DAYS = 120;
const UPCOMING = new Set(['SCHEDULED', 'TIMED']);
const LIVE = new Set(['IN_PLAY', 'PAUSED']);
const CONF_W = { hög: 1, medel: 0.85, låg: 0.6 };
const PICK = { over: 'Över 2,5', under: 'Under 2,5' };
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer/';

const dayKey = iso => new Date(iso).toLocaleDateString('sv-SE', { timeZone: TZ });
const fill = (s, m) => s.replace('{H}', m.home.short).replace('{A}', m.away.short);
const fair = p => 1 / p;
const r3 = x => Math.round(x * 1000) / 1000;

async function readJson(name, fallback) {
  try { return JSON.parse(await readFile(new URL(name, DATA), 'utf8')); } catch { return fallback; }
}

function pickLabel(m, k) {
  if (k === 'home') return `${m.home.short} vinner`;
  if (k === 'away') return `${m.away.short} vinner`;
  if (k === 'draw') return 'Oavgjort';
  return PICK[k] + ' mål';
}

// Samma som marketsFor() i common.js.
function marketsFor(m) {
  const out = [];
  for (const k of ['home', 'draw', 'away', 'over', 'under']) if (m.final?.[k] != null) out.push({ key: k, group: 'Matchen', label: pickLabel(m, k), p: m.final[k] });
  const x = m.extras;
  if (x) {
    for (const s of x.singles) out.push({ key: 's:' + s.key, group: 'Matchen', label: fill(s.label, m), p: s.p });
    for (const b of x.builders) out.push({ key: 'b:' + b.key, group: 'Bet builder', label: b.legs.map(l => fill(l, m)).join(' + '), legs: true, p: b.p });
    for (const pl of x.players) {
      const team = pl.side === 'home' ? m.home.short : m.away.short;
      out.push({ key: 'pw:' + pl.id, group: 'Bet builder', label: `${team} vinner + ${pl.name} gör mål`, legs: true, p: pl.win });
      out.push({ key: 'po:' + pl.id, group: 'Bet builder', label: `${pl.name} gör mål + Över 2,5 mål`, legs: true, p: pl.o25 });
    }
  }
  return out;
}

// Dagens rekommendationer för en dag, precis som dagens.js räknar fram dem.
function recommendations(ms) {
  const confW = m => (m.model ? CONF_W[m.model.conf] : 0.7);
  const ss = [
    ...ms.flatMap(m => (m.values ?? []).map(v => ({ m, key: v.pick, label: pickLabel(m, v.pick), p: v.p, odds: v.odds, book: v.book, real: true, score: 100 + v.edge * 100 }))),
    ...ms.flatMap(m => marketsFor(m).filter(x => x.group === 'Matchen' && x.p >= 0.5 && x.p <= 0.8)
      .map(x => ({ m, key: x.key, label: x.label, p: x.p, real: false, score: x.p * confW(m) }))),
  ].sort((a, b) => b.score - a.score);
  const out = [];
  const best = ss.find(s => s.real || s.p <= 0.72) ?? ss[0];
  if (best) out.push({ ...best, kind: 'best' });
  const rest = [];
  const used = new Set(best ? [best.m.id + best.key] : []);
  for (const s of ss) {
    if (used.has(s.m.id + s.key) || rest.some(r => r.m.id === s.m.id && !s.real)) continue;
    rest.push(s); used.add(s.m.id + s.key);
    if (rest.length >= 6) break;
  }
  out.push(...rest.map(s => ({ ...s, kind: 'single' })));
  const bb = new Map();
  for (const b of ms.flatMap(m => marketsFor(m).filter(x => x.legs && fair(x.p) >= 2.2 && fair(x.p) <= 7).map(x => ({ m, ...x, score: x.p * confW(m) })))
    .sort((a, b) => b.score - a.score)) if (!bb.has(b.m.id)) bb.set(b.m.id, b);
  out.push(...[...bb.values()].slice(0, 6).map(b => ({ ...b, kind: 'builder' })));
  out.push(...ms.flatMap(m => (m.extras?.players ?? []).map(pl => ({ m, key: 'p:' + pl.id, label: `${pl.name} gör mål`, p: pl.p, score: pl.p * confW(m) })))
    .sort((a, b) => b.score - a.score).slice(0, 8).map(s => ({ ...s, kind: 'scorer' })));
  return out;
}

// ---------- Målskyttar från ESPN ----------

const ymd = t => new Date(t).toISOString().slice(0, 10).replace(/-/g, '');

export async function addGoals(competitions) {
  const cache = await readJson('goals.json', {});
  const now = Date.now();
  let fetched = 0;
  for (const c of competitions) {
    const slug = c.espn?.slug;
    if (!slug) continue;
    const need = c.matches.filter(m => m.status === 'FINISHED' && m.score && !cache[m.id]);
    const days = [...new Set(need.flatMap(m => [ymd(Date.parse(m.utc)), ymd(Date.parse(m.utc) - 864e5)]))];
    for (const day of days) {
      let sb;
      try {
        const res = await fetch(`${ESPN}${slug}/scoreboard?dates=${day}`);
        if (!res.ok) continue;
        sb = await res.json();
        fetched++;
      } catch { continue; }
      for (const ev of sb.events ?? []) {
        const comp = ev.competitions?.[0];
        if (comp?.status?.type?.state !== 'post') continue;
        const home = comp.competitors.find(x => x.homeAway === 'home'), away = comp.competitors.find(x => x.homeAway === 'away');
        const m = need.find(x => !cache[x.id] && c.espn.teams[x.home.id]?.id === String(home?.team?.id) && c.espn.teams[x.away.id]?.id === String(away?.team?.id)
          && Math.abs(Date.parse(ev.date) - Date.parse(x.utc)) < 6 * 36e5);
        if (!m) continue;
        cache[m.id] = {
          until: m.utc,
          goals: (comp.details ?? []).filter(d => d.scoringPlay).map(d => ({
            side: String(d.team?.id) === String(home.team.id) ? 'home' : 'away',
            name: d.athletesInvolved?.[0]?.displayName ?? null, og: !!d.ownGoal, min: d.clock?.displayValue ?? null,
          })),
        };
      }
    }
  }
  for (const [id, v] of Object.entries(cache)) if (Date.parse(v.until) < now - KEEP_DAYS * 864e5) delete cache[id];
  for (const c of competitions) for (const m of c.matches) if (cache[m.id]) m.goals = cache[m.id].goals;
  await writeFile(new URL('goals.json', DATA), JSON.stringify(cache));
  console.log(`Målskyttar: ${fetched} ESPN-anrop, ${Object.keys(cache).length} matcher sparade`);
  return cache;
}

// ---------- Tipsstatistik ----------

export async function updateTrack(competitions, goals = {}) {
  const track = await readJson('track.json', { picks: [] });
  const now = Date.now();
  const all = competitions.filter(c => c.id !== 'UNL').flatMap(c => c.matches.map(m => ({ ...m, comp: c })));
  const byId = new Map(all.map(m => [String(m.id), m]));
  const started = p => Date.parse(p.utc) <= now;

  // Nya tips: för matcher som ännu inte börjat men börjar snart. Tips för matcher som inte
  // har börjat byts ut mot dagens aktuella urval varje körning.
  const upcoming = all.filter(m => UPCOMING.has(m.status) && (m.model || m.values?.length));
  const days = [...new Set(upcoming.filter(m => Date.parse(m.utc) - now < LOCK_HOURS * 36e5).map(m => dayKey(m.utc)))];
  let picks = track.picks.filter(p => started(p) || !days.includes(p.day));

  // Första gången: räkna fram tipsen för de senaste dagarna i efterhand, med en modell som bara
  // ser matcher spelade före avspark (c.backtest() i fetch.mjs). Markeras med back: true.
  if (!track.backfilled && competitions.some(c => c.backtest)) {
    const past = competitions.filter(c => c.id !== 'UNL' && c.backtest).flatMap(c => c.backtest().map(m => ({ ...m, comp: c })));
    for (const day of [...new Set(past.map(m => dayKey(m.utc)))]) {
      if (picks.some(p => p.day === day)) continue;
      for (const r of recommendations(past.filter(m => dayKey(m.utc) === day))) {
        picks.push({
          day, kind: r.kind, match: String(r.m.id), comp: r.m.comp.id, utc: r.m.utc, home: r.m.home.short, away: r.m.away.short,
          key: r.key, label: r.label, p: r3(r.p), odds: null, book: null, result: null, score: null, back: true,
        });
      }
    }
    track.backfilled = new Date().toISOString();
  }
  for (const day of days) {
    const recs = recommendations(upcoming.filter(m => dayKey(m.utc) === day))
      .filter(r => Date.parse(r.m.utc) - now < LOCK_HOURS * 36e5);
    const hasBest = picks.some(p => p.day === day && p.kind === 'best');
    for (const r of recs) {
      if (r.kind === 'best' && hasBest) continue;
      if (picks.some(p => p.day === day && p.match === String(r.m.id) && p.key === r.key)) continue;
      picks.push({
        day, kind: r.kind, match: String(r.m.id), comp: r.m.comp.id, utc: r.m.utc, home: r.m.home.short, away: r.m.away.short,
        key: r.key, label: r.label, p: r3(r.p), odds: r.odds ?? null, book: r.book ?? null, result: null, score: null,
      });
    }
  }

  // Rätta.
  for (const p of picks) {
    if (p.result === 'won' || p.result === 'lost') continue;
    const m = byId.get(p.match);
    if (!m) { if (Date.parse(p.utc) < now - 3 * 864e5) p.result = 'void'; continue; }
    if (m.status === 'POSTPONED' || m.status === 'CANCELLED') { p.result = 'void'; continue; }
    if (m.status !== 'FINISHED' || !m.score) continue;
    const res = gradeBet(p.key, p.label, { started: true, done: true, h: m.score.h, a: m.score.a, goals: m.goals ?? goals[m.id]?.goals ?? null });
    if (res === 'won' || res === 'lost') { p.result = res; p.score = `${m.score.h}–${m.score.a}`; }
  }

  picks = picks.filter(p => Date.parse(p.utc) > now - KEEP_DAYS * 864e5).sort((a, b) => b.utc.localeCompare(a.utc));
  await writeFile(new URL('track.json', DATA), JSON.stringify({ updated: new Date().toISOString(), backfilled: track.backfilled, picks }));
  const done = picks.filter(p => p.result === 'won' || p.result === 'lost');
  console.log(`Tipsstatistik: ${picks.length} tips, ${done.filter(p => p.result === 'won').length} av ${done.length} avgjorda gick in`);
}
