// Kopplar ihop en match från football-data.org med rätt odds-event från
// The Odds API. Lagnamnen skiljer sig ("FC Bayern München" / "Bayern Munich"),
// så vi jämför ord för ord och kräver att avsparken ligger nära i tid.

const STOP = new Set([
  'fc', 'cf', 'afc', 'sc', 'ssc', 'ac', 'as', 'club', 'de', 'del', 'la', 'calcio', 'cd',
  'ud', 'rc', 'rcd', 'sv', 'vfl', 'vfb', 'tsg', 'fsv', 'bc', 'ogc', 'stade', 'olympique',
  'and', 'the', 'sad', 'bv', 'ss', 'us', 'acf', 'ca', 'sl', 'sk', 'fk', 'hotspur', 'losc',
  '1', '04', '05', '1846', '1899', '1900', '1901', '1907', '1909', '1913', '1919',
]);

const ALIAS = {
  munich: 'munchen', internazionale: 'inter', saint: 'st', wolves: 'wolverhampton',
  spurs: 'tottenham', psg: 'paris', cologne: 'koln', naples: 'napoli', milano: 'milan',
  rome: 'roma', turin: 'torino',
};

export function tokens(name) {
  return name
    .toLowerCase()
    .replace(/ø/g, 'o').replace(/ß/g, 'ss').replace(/æ/g, 'ae')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(t => t && !STOP.has(t))
    .map(t => ALIAS[t] ?? t);
}

function sameToken(a, b) {
  if (a === b || a.startsWith(b) || b.startsWith(a)) return true;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return i >= 4;
}

export function similarity(nameA, nameB) {
  const a = tokens(nameA), b = tokens(nameB);
  if (!a.length || !b.length) return 0;
  const hits = a.filter(x => b.some(y => sameToken(x, y))).length;
  return (2 * hits) / (a.length + b.length);
}

export function findEvent(match, events) {
  const t = Date.parse(match.utcDate);
  let best = null, bestScore = 0;
  for (const e of events) {
    if (Math.abs(Date.parse(e.time) - t) > 3 * 36e5) continue;
    const sh = similarity(match.homeTeam.name, e.home);
    const sa = similarity(match.awayTeam.name, e.away);
    if (sh === 0 || sa === 0) continue;
    if (sh + sa > bestScore) { best = e; bestScore = sh + sa; }
  }
  return bestScore >= 0.6 ? best : null;
}
