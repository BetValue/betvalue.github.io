// Poisson-modell: varje lag får en anfalls- och försvarsstyrka utifrån
// säsongens matcher. Nyare matcher väger tyngre, och lag med få matcher
// dras mot ligasnittet så att modellen inte överreagerar.

const DAY = 864e5;
const HALF_LIFE_DAYS = 120; // en match för 120 dagar sedan väger hälften
const SHRINK = 4;           // antal "snittmatcher" som blandas in per lag
const MAX_GOALS = 10;

export function buildModel(finished, now = Date.now()) {
  let wSum = 0, hg = 0, ag = 0;
  const teams = new Map();
  const team = id => {
    if (!teams.has(id)) teams.set(id, { w: 0, gf: 0, ga: 0, n: 0 });
    return teams.get(id);
  };

  for (const m of finished) {
    const w = 0.5 ** ((now - m.time) / DAY / HALF_LIFE_DAYS);
    wSum += w; hg += w * m.hg; ag += w * m.ag;
    const h = team(m.home), a = team(m.away);
    h.w += w; h.gf += w * m.hg; h.ga += w * m.ag; h.n++;
    a.w += w; a.gf += w * m.ag; a.ga += w * m.hg; a.n++;
  }

  // Ligasnitt för hemma- och bortamål, blandat med typiska värden tidigt på säsongen.
  const avgH = (hg + 10 * 1.5) / (wSum + 10);
  const avgA = (ag + 10 * 1.2) / (wSum + 10);
  const avg = (avgH + avgA) / 2;

  const strength = new Map();
  for (const [id, s] of teams) {
    strength.set(id, {
      att: (s.gf + SHRINK * avg) / (s.w + SHRINK) / avg,
      def: (s.ga + SHRINK * avg) / (s.w + SHRINK) / avg,
      n: s.n,
    });
  }
  return { avgH, avgA, strength };
}

function poisson(lambda) {
  const p = [Math.exp(-lambda)];
  for (let k = 1; k <= MAX_GOALS; k++) p.push(p[k - 1] * lambda / k);
  return p;
}

const r3 = x => Math.round(x * 1000) / 1000;

export function predict(model, homeId, awayId) {
  const h = model.strength.get(homeId), a = model.strength.get(awayId);
  if (!h || !a) return null;

  const lh = model.avgH * h.att * a.def;
  const la = model.avgA * a.att * h.def;
  const ph = poisson(lh), pa = poisson(la);

  let total = 0, home = 0, draw = 0, away = 0, under = 0, btts = 0;
  const scores = [];
  for (let i = 0; i <= MAX_GOALS; i++) {
    for (let j = 0; j <= MAX_GOALS; j++) {
      const p = ph[i] * pa[j];
      total += p;
      if (i > j) home += p; else if (i === j) draw += p; else away += p;
      if (i + j <= 2) under += p;
      if (i > 0 && j > 0) btts += p;
      scores.push({ h: i, a: j, p });
    }
  }

  const games = Math.min(h.n, a.n);
  return {
    xg: [Math.round(lh * 100) / 100, Math.round(la * 100) / 100],
    p: {
      home: r3(home / total), draw: r3(draw / total), away: r3(away / total),
      over: r3(1 - under / total), under: r3(under / total), btts: r3(btts / total),
    },
    scores: scores.sort((x, y) => y.p - x.p).slice(0, 6).map(s => ({ ...s, p: r3(s.p / total) })),
    games,
    conf: games >= 8 ? 'hög' : games >= 4 ? 'medel' : 'låg',
  };
}
