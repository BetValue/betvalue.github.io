// Vår tipsstatistik (data/track.json): alla spel som Dagens värde rekommenderar sparas när
// matchen närmar sig avspark och rättas när den är spelad. Visas öppet för alla (även
// utloggade) så att man kan se hur många av våra tips som gått in.
//
// Urvalet kommer från picks.js (trackPicks): dagens bästa bet, de tre säkraste lagspelen,
// värdespel (när vi har odds), dagens Bet Builder och två spelarspel.
//
// Ett tips läggs in först när matchen börjar inom LOCK_HOURS (så att medlemmarnas tips inte
// syns öppet långt i förväg) och ändras inte efter avspark.
//
// Målskyttar (data/goals.json) hämtas från ESPN:s scoreboard för spelade matcher; de behövs
// för att rätta målskyttebets och visas på sidan för sparade bets.

import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { gradeBet } = require('../grade.js');
const PICKS = require('../picks.js');
import { compactSummary } from './stats.mjs';
const DATA = new URL('../data/', import.meta.url);
const TZ = 'Europe/Stockholm';
const LOCK_HOURS = 3.5, KEEP_DAYS = 120, STATS_DAYS = 21;
const UPCOMING = new Set(['SCHEDULED', 'TIMED']);
const LIVE = new Set(['IN_PLAY', 'PAUSED']);
const PICK = { over: 'Över 2,5', under: 'Under 2,5' };
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer/';

const dayKey = iso => new Date(iso).toLocaleDateString('sv-SE', { timeZone: TZ });
const fill = (s, m) => s.replace('{H}', m.home.short).replace('{A}', m.away.short);
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

// Dagens rekommendationer: exakt samma urval som sidan (picks.js).
function recommendations(ms) {
  return PICKS.trackPicks(ms);
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
    // Spelade matcher, och matcher som borde vara slut men som football-data inte hunnit uppdatera.
    const late = m => !m.score && ['SCHEDULED', 'TIMED', 'IN_PLAY', 'PAUSED'].includes(m.status) && Date.parse(m.utc) < now - 2.5 * 36e5;
    // Äldre poster saknar ESPN-id (behövs för statistiken efter matchen) – hämta igen om matchen är färsk.
    const noId = m => cache[m.id] && !cache[m.id].espn && Date.parse(m.utc) > now - STATS_DAYS * 864e5;
    const need = c.matches.filter(m => (!cache[m.id] || late(m) && !cache[m.id].score || noId(m)) && (m.status === 'FINISHED' && m.score || late(m)));
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
        const m = need.find(x => (!cache[x.id]?.score || !cache[x.id]?.espn) && c.espn.teams[x.home.id]?.id === String(home?.team?.id) && c.espn.teams[x.away.id]?.id === String(away?.team?.id)
          && Math.abs(Date.parse(ev.date) - Date.parse(x.utc)) < 6 * 36e5);
        if (!m) continue;
        const ht = c => Number(c.linescores?.[0]?.value ?? c.linescores?.[0]?.displayValue);
        cache[m.id] = {
          until: m.utc, espn: ev.id, slug,
          score: { h: Number(home.score) || 0, a: Number(away.score) || 0 },
          ht: Number.isFinite(ht(home)) && Number.isFinite(ht(away)) ? [ht(home), ht(away)] : null,
          goals: (comp.details ?? []).filter(d => d.scoringPlay).map(d => ({
            side: String(d.team?.id) === String(home.team.id) ? 'home' : 'away',
            name: d.athletesInvolved?.[0]?.displayName ?? null, og: !!d.ownGoal, min: d.clock?.displayValue ?? null,
          })),
        };
      }
    }
  }
  // Statistik efter matchen (hörnor, kort, halvtid, spelare) – för att rätta sådana spel.
  let summaries = 0;
  for (const [id, v] of Object.entries(cache)) {
    if (v.st || !v.espn || !v.slug || summaries >= 40 || Date.parse(v.until) < now - STATS_DAYS * 864e5) continue;
    try {
      const res = await fetch(`${ESPN}${v.slug}/summary?event=${v.espn}`);
      if (!res.ok) continue;
      const ev = compactSummary(await res.json(), v.slug);
      summaries++;
      if (!ev) continue;
      const side = t => (t === ev.h ? 0 : 1);
      const c = [0, 0], y = [0, 0];
      for (const [t, arr] of Object.entries(ev.t)) { c[side(t)] = arr[0]; y[side(t)] = arr[1]; }
      v.st = { c, y, pl: ev.p.map(p => [p[0], p[2], p[6], p[7], p[8], p[9], p[10], p[12], p[13]]) };
      v.ht ??= ev.ht;
    } catch {}
  }
  for (const [, v] of Object.entries(cache)) if (v.st && Date.parse(v.until) < now - STATS_DAYS * 864e5) delete v.st.pl;
  for (const [id, v] of Object.entries(cache)) if (Date.parse(v.until) < now - KEEP_DAYS * 864e5) delete cache[id];
  for (const c of competitions) for (const m of c.matches) {
    const g = cache[m.id];
    if (!g) continue;
    m.goals = g.goals;
    if (g.ht || g.st) m.post = { ht: g.ht ?? null, c: g.st?.c ?? null, y: g.st?.y ?? null, pl: g.st?.pl ?? null };
    // football-data släpar ibland efter: ESPN säger att matchen är slut.
    if (m.status !== 'FINISHED' && g.score) { m.status = 'FINISHED'; m.score = g.score; m.values = []; }
  }
  await writeFile(new URL('goals.json', DATA), JSON.stringify(cache));
  console.log(`Målskyttar: ${fetched} ESPN-anrop, ${summaries} matchstatistik, ${Object.keys(cache).length} matcher sparade`);
  return cache;
}

// Det som behövs för att rätta spel som inte bara hänger på slutresultatet.
export function postState(m, g) {
  const post = m.post ?? (g ? { ht: g.ht, c: g.st?.c, y: g.st?.y, pl: g.st?.pl } : null);
  return {
    goals: m.goals ?? g?.goals ?? null,
    ht: post?.ht ?? null,
    stats: post?.c ? { c: post.c, y: post.y } : null,
    players: post?.pl ? post.pl.map(([id, name, sh, sot, fc, fs, y, gl, a]) => ({ id, name, sh, sot, fc, fs, y, g: gl, a })) : null,
  };
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
  const upcoming = all.filter(m => UPCOMING.has(m.status) && Date.parse(m.utc) > now && (m.model || m.values?.length));
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
    const res = gradeBet(p.key, p.label, { started: true, done: true, h: m.score.h, a: m.score.a, ...postState(m, goals[m.id]) });
    if (res === 'void') p.result = 'void';
    else if (res === 'won' || res === 'lost') { p.result = res; p.score = `${m.score.h}–${m.score.a}`; }
  }

  picks = picks.filter(p => Date.parse(p.utc) > now - KEEP_DAYS * 864e5).sort((a, b) => b.utc.localeCompare(a.utc));
  await writeFile(new URL('track.json', DATA), JSON.stringify({ updated: new Date().toISOString(), backfilled: track.backfilled, picks }));
  const done = picks.filter(p => p.result === 'won' || p.result === 'lost');
  console.log(`Tipsstatistik: ${picks.length} tips, ${done.filter(p => p.result === 'won').length} av ${done.length} avgjorda gick in`);
}
