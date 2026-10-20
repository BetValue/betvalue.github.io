// Spelbolagens boostar, hämtade automatiskt och värderade.
//
// Unibet (Kambi) har sina boostar ("Uniboost") i ett öppet API, tillsammans med hela det vanliga
// oddsutbudet för matchen. För varje boost:
//   1. Delas texten upp i ben ("PSG vinner & Över 2,5 mål" → två ben).
//   2. Varje ben får marknadens chans ur Unibets vanliga odds för samma spel (utan marginal)
//      och vår chans ur modellen (picks.js) när matchen finns hos oss.
//   3. Benen räknas ihop (målben exakt ur resultatmatrisen, övriga som oberoende) och vägs:
//      40 % modell + 60 % marknad. EV = chans × boostat odds − 1.
// Bet365, Svenska Spel m.fl. har inga öppna API:er – de boostarna läggs upp för hand på sidan.
//
// Skriver data/boosts.json (läses av boostar.js).

import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { similarity } from './match.mjs';

const require = createRequire(import.meta.url);
const G = require('../grade.js');
const PICKS = require('../picks.js');
const DATA = new URL('../data/', import.meta.url);

const KAMBI = 'https://eu-offering-api.kambicdn.com/offering/v2018/ubse';
const Q = 'lang=sv_SE&market=SE';
const ONE_WAY_MARGIN = 1.1; // spel där bara "Ja" går att spela: ta bort ungefär 10 % marginal
const MODEL_W = 0.4;
const FOOTBALL_LISTS = [
  'all/all/all', 'england/premier_league/all', 'spain/la_liga/all', 'germany/bundesliga/all', 'italy/serie_a/all',
  'france/ligue_1/all', 'sweden/allsvenskan/all', 'champions_league/all/all', 'europa_league/all/all', 'conference_league/all/all',
];

async function kambi(path) {
  const res = await fetch(`${KAMBI}${path}${path.includes('?') ? '&' : '?'}${Q}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (BetValue; +https://betvalue.github.io)', Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Kambi ${path}: ${res.status}`);
  return res.json();
}

const odds = o => (o?.odds ? o.odds / 1000 : null);
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ø/g, 'o').trim();
const words = s => norm(s).split(/[^a-z0-9]+/).filter(Boolean);

// ---------- Ben ur boosttexten ----------
// "Ousmane Dembele gör mål", "PSG över 1,5 mål", "Över 6,5 hörnor", "Alexander Isak minst 2 skott på mål" …
export function parseLeg(text) {
  const t = text.replace(/(\d),(\d)/g, '$1.$2').replace(/\s+/g, ' ').trim();
  const s = norm(t);
  let n = null, under = false;
  let mm;
  if ((mm = s.match(/\b(?:over|minst|atminstone)\s+(\d+(?:\.\d)?)/))) n = /\./.test(mm[1]) ? Math.floor(+mm[1]) + 1 : +mm[1];
  else if ((mm = s.match(/(\d+)\s*\+/))) n = +mm[1];
  else if ((mm = s.match(/\bunder\s+(\d+(?:\.\d)?)/))) { under = true; n = Math.ceil(+mm[1]); } // högst n−1
  else if ((mm = s.match(/\b(\d+)\s+(?:mal|skott|horn|kort|fouls|assist)/))) n = +mm[1];

  let kind;
  if (/bada lagen gor mal|bada lag gor mal/.test(s)) kind = 'btts';
  else if (/oavgjort/.test(s)) kind = 'draw';
  else if (/horn/.test(s)) kind = 'corners';
  else if (/skott pa mal/.test(s)) kind = 'sot';
  else if (/skott/.test(s)) kind = 'sh';
  else if (/mal eller assist|mal eller (?:en )?malgivande/.test(s)) kind = 'ga';
  else if (/assist|malgivande/.test(s)) kind = 'a';
  else if (/kort/.test(s)) kind = 'cards';
  else if (/vinner|vinst/.test(s)) kind = 'win';
  else if (/\bmal\b|gor mal/.test(s)) kind = 'goals';
  else return null;

  // Subjektet = texten före verbet/siffran ("PSG", "Ousmane Dembele", "" för hela matchen).
  const cut = s.search(/\b(?:(?:gor|vinner|over|under|minst|atminstone|far|slar|tilldelas|har|skjuter)\b|\d)/);
  const subject = (cut >= 0 ? t.slice(0, cut) : t).replace(/[-–:]+$/, '').trim();
  return { text: text.replace(/\s+/g, ' ').trim(), kind, n: n ?? 1, under, subject };
}

export function splitLegs(label) {
  // "&", " + ", ", " (inte decimalkomma), " / " och " och " skiljer benen åt – men inte "2+ skott".
  return label.split(/\s*&\s*|\s+\+\s+|,\s+(?=\D)|\s+\/\s+|\s+och\s+/i).map(x => x.trim()).filter(Boolean);
}

// ---------- Marknadens chans ur Unibets vanliga odds ----------
function offerIndex(full) {
  return (full?.betOffers ?? []).filter(b => b.outcomes?.length);
}

// Chans utan marginal: tvåvägs/trevägs normaliseras, envägs dras med ungefär 10 %.
function fairP(offer, outcome) {
  const o = odds(outcome);
  if (!o) return null;
  const open = offer.outcomes.filter(x => x.odds && (outcome.line == null || x.line === outcome.line) && (outcome.participant == null || offer.betOfferType.englishName !== 'Player Occurrence Line' || x.participant === outcome.participant));
  if (open.length >= 2) {
    const tot = open.reduce((a, x) => a + 1000 / x.odds, 0);
    return (1 / o) / tot;
  }
  return 1 / o / ONE_WAY_MARGIN;
}

const samePerson = (a, b) => G.samePlayer(a, b) || (words(a).at(-1) === words(b).at(-1) && words(a)[0]?.[0] === words(b)[0]?.[0]);

function findSide(subject, ev, m) {
  if (!subject) return null;
  const names = [[ 'h', ev.homeName, m?.home?.name, m?.home?.short ], [ 'a', ev.awayName, m?.away?.name, m?.away?.short ]];
  let best = null, score = 0;
  for (const [side, ...ns] of names) for (const n of ns.filter(Boolean)) {
    const sc = similarity(subject, n);
    if (sc > score) { score = sc; best = side; }
  }
  return score >= 0.5 ? best : null;
}

function marketLeg(leg, offers, ev, side) {
  const teamName = side === 'h' ? ev.homeName : side === 'a' ? ev.awayName : null;
  const byLabel = (re, extra = () => true) => offers.filter(b => re.test(b.criterion.englishLabel) && !/half|interval|0:00/i.test(b.criterion.englishLabel) && extra(b));
  const line = (leg.n - 0.5) * 1000;
  const ou = (offers) => {
    for (const b of offers) {
      const o = b.outcomes.find(x => x.line === line && x.type === (leg.under ? 'OT_UNDER' : 'OT_OVER'));
      if (o) return { p: fairP(b, o), odds: odds(o) };
    }
    return null;
  };
  const teamRe = name => new RegExp(`(?:by|-)\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
  switch (leg.kind) {
    case 'win': case 'draw': {
      const b = byLabel(/^Full Time$/)[0];
      const type = leg.kind === 'draw' ? 'OT_CROSS' : side === 'h' ? 'OT_ONE' : side === 'a' ? 'OT_TWO' : null;
      const o = b?.outcomes.find(x => x.type === type);
      return o ? { p: fairP(b, o), odds: odds(o) } : null;
    }
    case 'btts': {
      const b = byLabel(/^Both Teams To Score$/)[0];
      const o = b?.outcomes.find(x => x.type === 'OT_YES');
      return o ? { p: fairP(b, o), odds: odds(o) } : null;
    }
    case 'goals': case 'corners': case 'cards': {
      const base = { goals: 'Total Goals', corners: 'Total Corners', cards: 'Total Cards' }[leg.kind];
      if (side) return ou(byLabel(new RegExp('^' + base, 'i'), b => teamRe(teamName).test(b.criterion.englishLabel)));
      return ou(byLabel(new RegExp(`^${base}$`, 'i')));
    }
    default: return null;
  }
}

const PLAYER_CRIT = {
  goals: n => (n === 1 ? /^To Score$/ : new RegExp(`^To score at least ${n} goals`, 'i')),
  a: () => /^To give an assist/i,
  ga: () => /^To score or give an assist/i,
  cards: () => /^To Get a Card$/i,
  sh: () => /^Player's shots \(/i,
  sot: () => /^Player's shots on target \(/i,
};

function marketPlayerLeg(leg, offers) {
  const re = PLAYER_CRIT[leg.kind]?.(leg.n);
  if (!re) return null;
  for (const b of offers.filter(b => re.test(b.criterion.englishLabel))) {
    const o = b.outcomes.find(x => x.participant && samePerson(x.participant, leg.subject)
      && (leg.kind === 'sh' || leg.kind === 'sot' ? x.line === (leg.n - 0.5) * 1000 && x.type === 'OT_OVER' : true));
    if (o) return { p: fairP(b, o), odds: odds(o), name: o.participant };
  }
  return null;
}

// ---------- Vår nyckel för benet (picks.js) ----------
const GOAL_KEY = { 1: 'g:o05', 2: 'g:o15', 3: 'over', 4: 'g:o35', 5: 'g:o45' };
const UNDER_KEY = { 2: 'g:u15', 3: 'under', 4: 'g:u35', 5: 'g:u45' };

function ourKey(leg, side, m) {
  switch (leg.kind) {
    case 'win': return side === 'h' ? 'home' : side === 'a' ? 'away' : null;
    case 'draw': return 'draw';
    case 'btts': return 's:btts';
    case 'goals':
      if (side) return leg.under ? (leg.n === 2 ? `g:${side}-u15` : null) : leg.n <= 3 ? `g:${side}-o${leg.n - 1}5` : null;
      return leg.under ? UNDER_KEY[leg.n] ?? null : GOAL_KEY[leg.n] ?? null;
    case 'corners': case 'cards': return `${leg.kind === 'corners' ? 'c' : 'k'}:${side ? side + '-' : ''}${leg.under ? 'u' : 'o'}${leg.n - 0.5}`;
    default: return null;
  }
}

function ourPlayerKey(leg, m) {
  if (!m) return null;
  if (leg.kind === 'goals' && leg.n === 1) {
    const pl = (m.extras?.players ?? []).find(p => samePerson(p.name, leg.subject));
    if (pl) return 'p:' + pl.id;
  }
  const stat = { goals: 'g', a: 'a', ga: 'ga', cards: 'y', sh: 'sh', sot: 'sot' }[leg.kind];
  for (const side of ['home', 'away']) {
    const row = (m.extras?.stats?.pl?.[side] ?? []).find(r => samePerson(r[1], leg.subject));
    if (row) return `x:${stat}:${leg.n}:${row[0]}`;
  }
  return null;
}

// ---------- Koppla Unibets match till vår ----------
function findOurMatch(ev, all) {
  const t = Date.parse(ev.start);
  let best = null, score = 0;
  for (const m of all) {
    if (Math.abs(Date.parse(m.utc) - t) > 3 * 36e5) continue;
    const sc = (similarity(ev.homeName, m.home.name) + similarity(ev.awayName, m.away.name)) / 2;
    if (sc > score) { score = sc; best = m; }
  }
  return score >= 0.5 ? best : null;
}

function findRegularEvent(boostEv, list) {
  const t = Date.parse(boostEv.start);
  const [h, a] = boostEv.name.split(/\s+-\s+/);
  if (!a) return null;
  let best = null, score = 0;
  for (const { event: e } of list) {
    if (e.sport !== 'FOOTBALL' || Math.abs(Date.parse(e.start) - t) > 15 * 60e3 || !e.awayName) continue;
    const sc = (similarity(h, e.homeName) + similarity(a, e.awayName)) / 2;
    if (sc > score) { score = sc; best = e; }
  }
  return score >= 0.5 ? best : null;
}

const r3 = x => (x == null ? null : Math.round(x * 1000) / 1000);

export async function updateBoosts(competitions) {
  const featured = await kambi('/listView/unibet_featured.json');
  const boosts = (featured.events ?? []).filter(e => e.event.path?.some(p => /boost/i.test(p.englishName + p.name)) && e.event.state === 'NOT_STARTED');
  if (!boosts.length) { await writeFile(new URL('boosts.json', DATA), '[]'); console.log('Boostar: inga hos Unibet just nu'); return; }

  // Hela listan täcker bara cirka ett dygn – ligorna hämtas också var för sig.
  const lists = await Promise.all(FOOTBALL_LISTS.map(p => kambi(`/listView/football/${p}/matches.json`).then(d => d.events ?? []).catch(() => [])));
  const football = { events: [...new Map(lists.flat().map(e => [e.event.id, e])).values()] };
  const ours = competitions.flatMap(c => c.matches.map(m => ({ ...m, comp: { id: c.id, name: c.name } })));
  const fullCache = new Map();
  const out = [];

  for (const { event: bev, betOffers } of boosts) {
    const ev = findRegularEvent(bev, football.events ?? []);
    if (!ev) continue; // inte fotboll (NBA, långtidsspel …) eller kombinationer över flera matcher
    if (!fullCache.has(ev.id)) fullCache.set(ev.id, await kambi(`/betoffer/event/${ev.id}.json`).catch(() => null));
    const offers = offerIndex(fullCache.get(ev.id));
    const m = findOurMatch(ev, ours);

    for (const bo of betOffers ?? []) {
      const yes = bo.outcomes.find(o => o.odds && o.status === 'OPEN' && (o.type === 'OT_YES' || /^ja$/i.test(o.label))) ?? bo.outcomes.find(o => o.odds && o.status === 'OPEN');
      if (!yes) continue;
      const title = bo.criterion.label + (/^(ja|yes)$/i.test(yes.label) ? '' : ` – ${yes.label}`);
      const legs = splitLegs(bo.criterion.label).map(parseLeg);
      if (!legs.length || legs.some(l => !l)) {
        out.push({ book: 'Unibet', src: 'unibet', match: m?.id ?? null, home: ev.homeName, away: ev.awayName, comp: m?.comp.name ?? ev.group, title, odds: odds(yes), ends: bo.closed ?? bev.start, legs: [], p: null, note: 'Vi kunde inte dela upp boosten i spel som vi kan räkna på.' });
        continue;
      }
      const legOut = legs.map(leg => {
        const side = findSide(leg.subject, ev, m);
        const player = !side && leg.subject && leg.kind !== 'btts' && leg.kind !== 'draw';
        const mk = player ? marketPlayerLeg(leg, offers) : marketLeg(leg, offers, ev, side);
        const key = player ? ourPlayerKey(leg, m) : m ? ourKey(leg, side, m) : null;
        const model = m && key ? PICKS.marketByKey(m, key) : null;
        return { label: leg.text, key: model ? key : null, mp: r3(mk?.p), was: mk?.odds ?? null, p: r3(model?.p), model };
      });

      // Ihop: marknaden som oberoende ben, justerat med hur modellens ben hänger ihop.
      const allModel = legOut.every(l => l.model);
      const modelJoint = m && allModel ? (legOut.length === 1 ? legOut[0].model.p : PICKS.builder(m, legOut.map(l => l.model)).p) : null;
      const prodModel = allModel ? legOut.reduce((a, l) => a * l.model.p, 1) : null;
      const corr = modelJoint && prodModel ? modelJoint / prodModel : 1;
      const allMarket = legOut.every(l => l.mp);
      const marketJoint = allMarket ? Math.min(1, legOut.reduce((a, l) => a * l.mp, 1) * corr) : null;
      const p = modelJoint != null && marketJoint != null ? MODEL_W * modelJoint + (1 - MODEL_W) * marketJoint : modelJoint ?? marketJoint;
      const was = legOut.length === 1 ? legOut[0].was : null; // kombinationer har inget eget ordinarie odds

      out.push({
        book: 'Unibet', src: 'unibet', match: m?.id ?? null, home: ev.homeName, away: ev.awayName, comp: m?.comp.name ?? ev.group,
        title, odds: odds(yes), was, ends: bo.closed ?? bev.start,
        pick: allModel ? (legOut.length === 1 ? legOut[0].key : 'bb:' + legOut.map(l => l.key).join('|')) : null,
        p: r3(p), mp: r3(marketJoint), modelP: r3(modelJoint),
        legs: legOut.map(({ model, ...l }) => l),
        note: bo.extra ?? null,
      });
    }
  }

  out.sort((a, b) => (b.p ? b.p * b.odds : 0) - (a.p ? a.p * a.odds : 0));
  await writeFile(new URL('boosts.json', DATA), JSON.stringify(out, null, 1));
  console.log(`Boostar: ${out.length} från Unibet (${out.filter(b => b.p).length} värderade)`);
}

// Kör direkt: node scripts/boosts.mjs (använder data/latest.json)
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('boosts.mjs')) {
  const latest = JSON.parse(await readFile(new URL('latest.json', DATA), 'utf8'));
  await updateBoosts(latest.competitions);
}
