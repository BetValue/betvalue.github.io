// Alla spel vi kan räkna fram för en match, och dagens urval – enligt vår analysmetod:
//   • Egen, försiktig sannolikhet: Poisson för mål (modellen), hörnor, kort och spelarstatistik,
//     med lite bredare fördelning än ren Poisson där utfallen varierar mer.
//   • Implicit sannolikhet = 1 / odds, EV = sannolikhet × odds − 1 (bara när vi har riktiga odds).
//   • Inget hittas på: saknas data visas inte spelet, och osäkerheten syns som risk.
//   • Ben i samma Bet Builder hänger ihop: målben räknas ihop exakt ur resultatmatrisen,
//     övriga ben räknas som oberoende och det står vid bygget.
//
// Används av sidan (Dagens värde, Matcher, Boostar, matchdetaljer) och av scripts/track.mjs
// (tipsstatistiken) så att urvalet blir exakt detsamma. Kräver grade.js (testerna för målmarknader).
//
// Statistiken för hörnor, kort och spelare kommer från scripts/stats.mjs (m.extras.stats).

(function (root) {
  const G = typeof module === 'object' && module.exports ? require('./grade.js') : root;
  const MAXG = 10;
  const CONF_W = { hög: 1, medel: 0.85, låg: 0.6 };
  const r3 = x => Math.round(x * 1000) / 1000;
  const n1 = x => (Math.round(x * 10) / 10).toFixed(1).replace('.', ',');
  const pc = p => Math.round(p * 100) + ' %';
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  // ---------- Fördelningar ----------
  function pois(l, max = MAXG) {
    const p = [Math.exp(-l)];
    for (let k = 1; k <= max; k++) p.push(p[k - 1] * l / k);
    return p;
  }
  const atLeast = (l, n) => (n <= 0 ? 1 : 1 - pois(l, Math.max(n, 1)).slice(0, n).reduce((a, b) => a + b, 0));
  // Hörnor, kort och spelarstatistik varierar mer än Poisson: snitt av λ·0,8 och λ·1,2.
  const wideAtLeast = (l, n) => (atLeast(l * 0.8, n) + atLeast(l * 1.2, n)) / 2;
  function grid(lh, la) {
    const ph = pois(lh), pa = pois(la);
    let t = 0;
    const g = ph.map(x => pa.map(y => { t += x * y; return x * y; }));
    return g.map(row => row.map(v => v / t));
  }
  const sum = (g, f) => { let s = 0; for (let i = 0; i < g.length; i++) for (let j = 0; j < g[i].length; j++) if (f(i, j)) s += g[i][j]; return s; };

  // ---------- Marknader ----------
  const CATS = ['Matchresultat', 'Handikapp', 'Mål', 'Lagmål', 'Halvlek', 'Hörnor', 'Kort', 'Spelare'];
  const GOAL_DEFS = [
    ['home', 'Matchresultat', '{H} vinner'], ['draw', 'Matchresultat', 'Oavgjort'], ['away', 'Matchresultat', '{A} vinner'],
    ['g:dc-1x', 'Matchresultat', '{H} eller oavgjort'], ['g:dc-x2', 'Matchresultat', '{A} eller oavgjort'], ['g:dc-12', 'Matchresultat', 'Inte oavgjort ({H} eller {A})'],
    ['g:dnb-h', 'Matchresultat', '{H} vinner (Draw No Bet)'], ['g:dnb-a', 'Matchresultat', '{A} vinner (Draw No Bet)'],
    ['g:ah-h-1.5', 'Handikapp', '{H} −1,5'], ['g:ah-h-1', 'Handikapp', '{H} −1'], ['g:ah-h+1', 'Handikapp', '{H} +1'], ['g:ah-h+1.5', 'Handikapp', '{H} +1,5'],
    ['g:ah-a-1.5', 'Handikapp', '{A} −1,5'], ['g:ah-a-1', 'Handikapp', '{A} −1'], ['g:ah-a+1', 'Handikapp', '{A} +1'], ['g:ah-a+1.5', 'Handikapp', '{A} +1,5'],
    ['g:o05', 'Mål', 'Över 0,5 mål'], ['g:o15', 'Mål', 'Över 1,5 mål'], ['over', 'Mål', 'Över 2,5 mål'], ['g:o35', 'Mål', 'Över 3,5 mål'], ['g:o45', 'Mål', 'Över 4,5 mål'],
    ['g:u15', 'Mål', 'Under 1,5 mål'], ['under', 'Mål', 'Under 2,5 mål'], ['g:u35', 'Mål', 'Under 3,5 mål'], ['g:u45', 'Mål', 'Under 4,5 mål'],
    ['s:btts', 'Mål', 'Båda lagen gör mål'], ['g:btts-n', 'Mål', 'Båda lagen gör inte mål'],
    ['g:h-o05', 'Lagmål', '{H} gör mål'], ['g:h-o15', 'Lagmål', '{H} gör minst 2 mål'], ['g:h-o25', 'Lagmål', '{H} gör minst 3 mål'], ['g:h-u15', 'Lagmål', '{H} gör högst 1 mål'],
    ['g:a-o05', 'Lagmål', '{A} gör mål'], ['g:a-o15', 'Lagmål', '{A} gör minst 2 mål'], ['g:a-o25', 'Lagmål', '{A} gör minst 3 mål'], ['g:a-u15', 'Lagmål', '{A} gör högst 1 mål'],
    ['g:cs-h', 'Lagmål', '{H} håller nollan'], ['g:cs-a', 'Lagmål', '{A} håller nollan'], ['g:wtn-h', 'Lagmål', '{H} vinner och håller nollan'], ['g:wtn-a', 'Lagmål', '{A} vinner och håller nollan'],
  ];
  const HALF_DEFS = [
    ['g:1h-o05', 'Mål i första halvlek'], ['g:1h-o15', 'Minst 2 mål i första halvlek'], ['g:1h-u15', 'Högst 1 mål i första halvlek'],
    ['g:2h-o05', 'Mål i andra halvlek'], ['g:2h-o15', 'Minst 2 mål i andra halvlek'], ['g:2h-u15', 'Högst 1 mål i andra halvlek'],
  ];
  // [vinner, push] för ett målben – samma tester som rättningen i grade.js.
  function goalTest(key) {
    if (G.GOAL_TESTS?.[key]) return G.GOAL_TESTS[key];
    if (G.TEAM_TESTS?.[key]) return [G.TEAM_TESTS[key]];
    return null;
  }

  const WRONG = {
    win: 'Ett tidigt mål eller rött kort kan vända matchen – favoriter tappar poäng oftare än oddsen antyder.',
    safe: 'Lågt odds: en enda förlust äter upp vinsten från flera spel som går in.',
    over: 'Ett lugnt matchförlopp, eller ett lag som slutar anfalla efter ledning, ger få mål.',
    under: 'Ett tidigt mål öppnar matchen; straffar och röda kort ger extra mål.',
    half: 'Halvlekar är korta – ett enda mål avgör, och förstahalvlekar är ofta försiktiga.',
    corners: 'Matchbilden avgör: leder favoriten tidigt kan den sluta anfalla och hörnorna utebli.',
    cards: 'Domaren styr korten mycket och vi vet inte vem som dömer – en lugn match ger få kort.',
    attack: 'Startar inte, byts tidigt eller laget får lite boll.',
    fouls: 'Byts tidigt eller får en annan roll – domarens linje avgör hur mycket som blåses.',
    fouled: 'Motståndarna kan undvika närkamper med honom, och han kan bytas tidigt.',
  };
  const wrongFor = key => (/^(home|away|g:dnb|g:ah-.-)/.test(key) ? WRONG.win
    : /^(g:dc|g:ah-.\+|g:o05|g:h-o05|g:a-o05)/.test(key) ? WRONG.safe
    : /^g:[12]h/.test(key) ? WRONG.half
    : /^(over|g:o|s:btts|g:.-o)/.test(key) ? WRONG.over
    : WRONG.under);

  function riskOf(p, conf) {
    let r = p >= 0.7 ? 0 : p >= 0.5 ? 1 : 2;
    if (conf === 'låg') r = Math.min(2, r + 1);
    return ['Låg', 'Medel', 'Hög'][r];
  }

  // Fyll i odds, lägsta odds, EV och risk.
  function finish(m, x) {
    x.push = x.push ?? 0;
    x.fair = x.p > 0 ? (1 - x.push) / x.p : null;
    x.min = x.p > 0 ? (1.05 - x.push) / x.p : null; // minst 5 % värde
    const mk = m.market;
    const o = x.key === 'home' || x.key === 'draw' || x.key === 'away' ? mk?.h2h?.[x.key] : x.key === 'over' || x.key === 'under' ? mk?.ou25?.[x.key] : null;
    if (o?.odds) {
      x.odds = o.odds; x.book = o.book ?? null; x.implied = 1 / o.odds; x.marketP = o.fair ?? null;
      x.ev = x.p * o.odds + x.push - 1;
    }
    x.risk = riskOf(x.p, x.conf);
    x.m = m;
    return x;
  }

  const fillNames = (s, m) => s.replace(/\{H\}/g, m.home.short).replace(/\{A\}/g, m.away.short);

  function goalBasis(m, key) {
    const mo = m.model, st = m.extras?.stats;
    const parts = [`Förväntade mål ${n1(mo.xg[0])}–${n1(mo.xg[1])} (modell, ${mo.games} matcher per lag)`];
    const H = st?.home?.venue, A = st?.away?.venue;
    if (H && A) {
      parts.push(`${m.home.short} hemma ${n1(H.gf)}–${n1(H.ga)} per match (${H.n}), ${m.away.short} borta ${n1(A.gf)}–${n1(A.ga)} (${A.n})`);
      if (/over|under|g:[ou]\d/.test(key)) parts.push(`över 2,5 i ${H.o25} av ${H.n} resp. ${A.o25} av ${A.n}`);
      if (/btts/.test(key)) parts.push(`båda gjorde mål i ${H.btts} av ${H.n} resp. ${A.btts} av ${A.n}`);
    }
    if (m.market?.h2h && /^(home|draw|away)$/.test(key)) parts.push(`marknadens chans ${pc(m.market.h2h[key].fair)}`);
    return parts.join(' · ');
  }

  // Andel mål i första halvlek: ligans siffra (ESPN), dragen mot 44 % när underlaget är litet.
  function firstHalfShare(m) {
    const lg = m.extras?.stats?.home?.lg;
    return lg?.h1 ? (lg.h1 * lg.n + 0.44 * 60) / (lg.n + 60) : 0.44;
  }

  function goalMarkets(m) {
    if (!m.model) return [];
    const [lh, la] = m.model.xg, g = grid(lh, la), conf = m.model.conf, out = [];
    for (const [key, cat, label] of GOAL_DEFS) {
      const t = goalTest(key);
      if (!t) continue;
      const [win, push] = t;
      // 1X2 och över/under 2,5 har redan vägts mot marknaden (m.final).
      const p = m.final?.[key] ?? sum(g, (i, j) => win(i, j));
      out.push(finish(m, { key, cat, label: fillNames(label, m), p: r3(p), push: push ? r3(sum(g, (i, j) => push(i, j))) : 0, conf, basis: goalBasis(m, key), wrong: wrongFor(key), goal: !push }));
    }
    const s1 = firstHalfShare(m);
    const halves = { 1: grid(lh * s1, la * s1), 2: grid(lh * (1 - s1), la * (1 - s1)) };
    for (const [key, label] of HALF_DEFS) {
      const [half, f] = G.HALF_TESTS[key];
      out.push(finish(m, { key, cat: 'Halvlek', label, p: r3(sum(halves[half], f)), conf, wrong: WRONG.half,
        basis: `${Math.round(s1 * 100)} % av målen kommer i första halvlek i ligan · förväntade mål ${n1(lh + la)} i matchen` }));
    }
    return out;
  }

  // ---------- Hörnor och kort ----------
  // Lagets väntade antal = snitt av egen nivå (hemma/borta) och vad motståndaren brukar släppa till,
  // draget mot ligasnittet med 4 matchers vikt.
  function teamRate(own, oppAllowed, nOwn, nOpp, lgAvg) {
    const n = Math.min(nOwn, nOpp);
    const raw = (own + oppAllowed) / 2;
    return lgAvg ? (raw * n + lgAvg * 4) / (n + 4) : raw;
  }
  const venueOr = (s, k) => (s.venue && s.venue.n >= 3 ? s.venue[k] : s.all[k]);
  const nOf = s => (s.venue && s.venue.n >= 3 ? s.venue.n : s.all.n);
  const confN = n => (n >= 8 ? 'hög' : n >= 5 ? 'medel' : 'låg');

  function lineMarkets(m, out, cat, prefix, noun, l, side, basis, wrong, conf) {
    const who = side === 'h-' ? m.home.short + ' ' : side === 'a-' ? m.away.short + ' ' : '';
    const base = Math.floor(l);
    for (let line = Math.max(0.5, base - 2.5); line <= base + 2.5; line += 1) {
      const pOver = wideAtLeast(l, Math.ceil(line));
      for (const [ou, p] of [['o', pOver], ['u', 1 - pOver]]) {
        if (p < 0.15 || p > 0.92) continue;
        const txt = `${ou === 'o' ? 'Över' : 'Under'} ${String(line).replace('.', ',')} ${noun}`;
        out.push(finish(m, { key: `${prefix}:${side}${ou}${line}`, cat, label: who ? `${who}${txt.toLowerCase()}` : txt, p: r3(p), conf, basis, wrong }));
      }
    }
  }

  function statMarkets(m) {
    const st = m.extras?.stats;
    if (!st?.home?.all || !st?.away?.all) return [];
    const H = st.home, A = st.away, lg = H.lg ?? A.lg ?? {};
    const out = [];
    const n = Math.min(nOf(H), nOf(A)), conf = confN(Math.min(H.all.n, A.all.n));
    // Hörnor
    const ch = teamRate(venueOr(H, 'cf'), venueOr(A, 'ca'), nOf(H), nOf(A), lg.c);
    const ca = teamRate(venueOr(A, 'cf'), venueOr(H, 'ca'), nOf(A), nOf(H), lg.c);
    const cBasis = `Hörnor: ${m.home.short} hemma ${n1(venueOr(H, 'cf'))} tagna / ${n1(venueOr(H, 'ca'))} emot, ${m.away.short} borta ${n1(venueOr(A, 'cf'))} / ${n1(venueOr(A, 'ca'))} (senaste ${n}) · ligasnitt ${n1(lg.c ?? 0)} per lag · väntat ${n1(ch + ca)}`;
    lineMarkets(m, out, 'Hörnor', 'c', 'hörnor', ch + ca, '', cBasis, WRONG.corners, conf);
    lineMarkets(m, out, 'Hörnor', 'c', 'hörnor', ch, 'h-', cBasis, WRONG.corners, conf);
    lineMarkets(m, out, 'Hörnor', 'c', 'hörnor', ca, 'a-', cBasis, WRONG.corners, conf);
    const ph = pois(ch, 30), pa = pois(ca, 30);
    let most = 0, least = 0;
    for (let i = 0; i <= 30; i++) for (let j = 0; j <= 30; j++) { if (i > j) most += ph[i] * pa[j]; else if (j > i) least += ph[i] * pa[j]; }
    out.push(finish(m, { key: 'c:most-h', cat: 'Hörnor', label: `${m.home.short} får flest hörnor`, p: r3(most), conf, basis: cBasis, wrong: WRONG.corners }));
    out.push(finish(m, { key: 'c:most-a', cat: 'Hörnor', label: `${m.away.short} får flest hörnor`, p: r3(least), conf, basis: cBasis, wrong: WRONG.corners }));
    // Gula kort: lagets egna kort och hur många kort motståndaren brukar dra på sig mot dem.
    const yh = teamRate(venueOr(H, 'yf'), venueOr(A, 'ya'), nOf(H), nOf(A), lg.y);
    const ya = teamRate(venueOr(A, 'yf'), venueOr(H, 'ya'), nOf(A), nOf(H), lg.y);
    const kBasis = `Gula kort: ${m.home.short} ${n1(venueOr(H, 'yf'))} per match, ${m.away.short} ${n1(venueOr(A, 'yf'))} · fouls ${n1(venueOr(H, 'ff'))} resp. ${n1(venueOr(A, 'ff'))} · ligasnitt ${n1(lg.y ?? 0)} kort per lag · domaren okänd`;
    lineMarkets(m, out, 'Kort', 'k', 'gula kort', yh + ya, '', kBasis, WRONG.cards, conf === 'hög' ? 'medel' : conf);
    lineMarkets(m, out, 'Kort', 'k', 'gula kort', yh, 'h-', kBasis, WRONG.cards, conf === 'hög' ? 'medel' : conf);
    lineMarkets(m, out, 'Kort', 'k', 'gula kort', ya, 'a-', kBasis, WRONG.cards, conf === 'hög' ? 'medel' : conf);
    return out;
  }

  // ---------- Spelare ----------
  // Rad från stats.mjs: [id, namn, position, matcher, starter, minuter, summor[8], serie[[start, min, skott, på mål, fouls, fälld, gula, röda, mål, assist]], startade senaste]
  // Snitt per 90 minuter för en vanlig spelare på positionen – drar spelare med få minuter mot det normala.
  const PRIOR = {
    sh: { F: 2.4, M: 1.2, D: 0.6 }, sot: { F: 0.95, M: 0.4, D: 0.18 }, fc: { F: 1.0, M: 1.2, D: 1.1 }, fs: { F: 1.3, M: 1.2, D: 0.7 },
    y: { F: 0.1, M: 0.17, D: 0.17 }, g: { F: 0.35, M: 0.12, D: 0.05 }, a: { F: 0.14, M: 0.12, D: 0.06 },
  };
  const STAT = {
    sh: { i: 0, lines: [1, 2, 3], txt: n => `minst ${n} skott`, wrong: WRONG.attack },
    sot: { i: 1, lines: [1, 2], txt: n => `minst ${n} skott på mål`, wrong: WRONG.attack },
    fc: { i: 2, lines: [1, 2], txt: n => `gör minst ${n} ${n === 1 ? 'foul' : 'fouls'}`, wrong: WRONG.fouls },
    fs: { i: 3, lines: [1, 2], txt: n => `blir fälld minst ${n} ${n === 1 ? 'gång' : 'gånger'}`, wrong: WRONG.fouled },
    y: { i: 4, lines: [1], txt: () => 'får gult kort', wrong: WRONG.fouls },
    g: { i: 6, lines: [1], txt: () => 'gör mål', wrong: WRONG.attack },
    a: { i: 7, lines: [1], txt: () => 'gör assist', wrong: WRONG.attack },
    ga: { i: null, lines: [1], txt: () => 'gör mål eller assist', wrong: WRONG.attack },
  };
  const K = 3; // matchers vikt för positionssnittet

  function playerMarkets(m) {
    const st = m.extras?.stats;
    if (!st?.pl) return [];
    const out = [];
    const scorerNames = (m.extras?.players ?? []).map(p => p.name);
    for (const side of ['home', 'away']) {
      const team = side === 'home' ? m.home : m.away, me = st[side], opp = st[side === 'home' ? 'away' : 'home'];
      const lg = me?.lg ?? {};
      const xg = m.model?.xg?.[side === 'home' ? 0 : 1];
      for (const [id, name, pos0, apps, starts, mins, tot, series, lastStart] of st.pl[side] ?? []) {
        if (!apps || !mins) continue;
        const pos = PRIOR.sh[pos0] ? pos0 : 'M';
        const startMins = series.filter(s => s[0]).map(s => s[1]);
        const expMin = (startMins.length ? startMins.reduce((a, b) => a + b, 0) / startMins.length : 75) * (lastStart ? 1 : 0.85);
        const rate = (idx, k) => (tot[idx] + K * PRIOR[k][pos]) / (mins / 90 + K);
        const oppF = { sh: opp?.all?.sa / lg.s, sot: opp?.all?.ta / lg.t, fc: opp?.all?.fa / lg.f, fs: opp?.all?.ff / lg.f, y: opp?.all?.ya / lg.y };
        const attackF = xg && me?.all?.gf ? clamp(Math.sqrt(xg / Math.max(0.4, me.all.gf)), 0.75, 1.3) : 1;
        const conf = apps >= 6 ? 'hög' : apps >= 3 ? 'medel' : 'låg';
        for (const [k, def] of Object.entries(STAT)) {
          if (k === 'g' && scorerNames.some(n => G.samePlayer(n, name))) continue; // målskyttarna har egen modell (p:)
          let lam;
          if (k === 'ga') lam = (rate(6, 'g') + rate(7, 'a')) * attackF;
          else if (k === 'g' || k === 'a') lam = rate(def.i, k) * attackF;
          else lam = rate(def.i, k) * (Number.isFinite(oppF[k]) ? clamp(Math.sqrt(oppF[k]), 0.8, 1.25) : 1);
          lam *= expMin / 90;
          const val = s => (k === 'ga' ? s[8] + s[9] : s[2 + def.i]);
          for (const n of def.lines) {
            const hit = series.filter(s => val(s) >= n).length;
            // Modellen (per 90 min, motstånd) vägs ihop med hur ofta det faktiskt hänt (träffbilden).
            const pModel = k === 'g' || k === 'a' || k === 'ga' ? atLeast(lam, n) : wideAtLeast(lam, n);
            const p = 0.6 * pModel + 0.4 * (hit + 1) / (series.length + 2);
            if (p < 0.2 || p > 0.93) continue;
            const per90 = k === 'ga' ? (tot[6] + tot[7]) / (mins / 90) : tot[def.i] / (mins / 90);
            const oppTxt = k === 'sh' || k === 'sot' ? ` · ${(side === 'home' ? m.away : m.home).short} släpper till ${n1(opp?.all?.sa ?? 0)} skott per match (ligan ${n1(lg.s ?? 0)})`
              : k === 'fs' ? ` · motståndarna gör ${n1(opp?.all?.ff ?? 0)} fouls per match (ligan ${n1(lg.f ?? 0)})` : '';
            out.push(finish(m, {
              key: `x:${k}:${n}:${id}`, cat: 'Spelare', label: `${name} ${def.txt(n)}`, p: r3(p), conf, player: { id, name, side, team: team.short },
              hit: `${hit} av ${series.length}`,
              basis: `${def.txt(n).replace(/^gör |^blir |^får /, '')} i ${hit} av ${series.length} senaste matcherna · ${n1(per90)} per 90 min, cirka ${Math.round(expMin)} min per match${oppTxt}`,
              wrong: def.wrong + ' Kolla startelvan – Byte+ gäller inte om spelaren inte startar.',
            }));
          }
        }
      }
    }
    // Målskyttemodellen (andel av lagets mål ur resultatmatrisen).
    for (const pl of m.extras?.players ?? []) {
      out.push(finish(m, { key: 'p:' + pl.id, cat: 'Spelare', label: `${pl.name} gör mål`, p: pl.p, conf: m.model?.conf ?? 'medel', player: { name: pl.name, side: pl.side },
        basis: `${pl.goals} mål på ${pl.played} matcher${pl.pens ? ` (${pl.pens} straff)` : ''} · andel av lagets mål × väntade mål i matchen`,
        wrong: WRONG.attack + ' Kolla startelvan – Byte+ gäller inte om spelaren inte startar.' }));
    }
    return out;
  }

  // ---------- Alla spel för en match ----------
  const cache = new WeakMap();
  function allMarkets(m) {
    const k = m.extras ?? m.model;
    if (!k) return [];
    const c = cache.get(k);
    if (c && c.m === m.id && c.final === m.final && c.market === m.market) return c.list.map(x => ({ ...x, m }));
    const list = [...goalMarkets(m), ...statMarkets(m), ...playerMarkets(m)];
    cache.set(k, { m: m.id, final: m.final, market: m.market, list });
    return list;
  }

  // Sannolikheten att alla ben går in. Målben (helmatch) räknas exakt ihop ur resultatmatrisen;
  // halvlek, hörnor, kort och spelare multipliceras som oberoende.
  function joint(m, legs) {
    const goal = legs.filter(l => l.goal && goalTest(l.key)), other = legs.filter(l => !goal.includes(l));
    let p = 1;
    if (goal.length) {
      const g = grid(...m.model.xg);
      p = sum(g, (i, j) => goal.every(l => goalTest(l.key)[0](i, j)));
      // 1X2 och över/under 2,5 är vägda mot marknaden – skala målbenen med skillnaden.
      const raw = goal.map(l => sum(g, (i, j) => goalTest(l.key)[0](i, j)));
      const adj = goal.reduce((a, l, i) => a * (raw[i] > 0 ? l.p / raw[i] : 1), 1);
      p *= goal.length === 1 ? adj : Math.sqrt(adj);
    }
    for (const l of other) p *= l.p;
    return Math.min(p, Math.min(...legs.map(l => l.p)));
  }

  function builder(m, legs) {
    const p = joint(m, legs);
    const conf = legs.some(l => l.conf === 'låg') ? 'låg' : legs.some(l => l.conf === 'medel') ? 'medel' : 'hög';
    const mixed = legs.some(l => !l.goal) && legs.length > 1;
    return finish(m, {
      key: 'bb:' + legs.map(l => l.key).join('|'), cat: 'Bet builder', label: legs.map(l => l.label).join(' + '), legs, p: r3(p), conf,
      basis: mixed ? 'Målbenen räknade ihop exakt; övriga ben som oberoende – i verkligheten hänger de ofta ihop (t.ex. fler mål ger fler skott).' : 'Alla ben räknade ihop exakt ur resultatmatrisen.',
      wrong: 'Alla ben måste gå in. Det svagaste benet: ' + legs.slice().sort((a, b) => a.p - b.p)[0].label + '.',
    });
  }

  function marketByKey(m, key) {
    if (String(key).startsWith('bb:')) {
      const all = allMarkets(m);
      const legs = key.slice(3).split('|').map(k => all.find(x => x.key === k));
      return legs.every(Boolean) ? builder(m, legs) : null;
    }
    return allMarkets(m).find(x => x.key === key) ?? null;
  }

  // ---------- Dagens urval ----------
  const score = x => x.p * CONF_W[x.conf];
  const useful = x => x.p >= 0.08 && x.p <= 0.92 && x.fair <= 12;

  function pickDiverse(list, max, perMatch = 2) {
    const out = [], n = new Map(), cats = new Set();
    for (const x of list) {
      const k = x.m.id;
      if ((n.get(k) ?? 0) >= perMatch || cats.has(k + x.cat)) continue;
      out.push(x); n.set(k, (n.get(k) ?? 0) + 1); cats.add(k + x.cat);
      if (out.length >= max) break;
    }
    return out;
  }

  function buildersFor(m, all) {
    // Kandidater: starka ben (55–85 %), inga push-spel eller halvlekar, högst tre per kategori.
    const perCat = new Map();
    const pool = all.filter(x => x.p >= 0.55 && x.p <= 0.85 && !x.push && x.cat !== 'Halvlek' && x.conf !== 'låg' && x.key !== 'g:o05')
      .sort((a, b) => score(b) - score(a))
      .filter(x => { const c = perCat.get(x.cat) ?? 0; if (c >= 3) return false; perCat.set(x.cat, c + 1); return true; })
      .slice(0, 16);
    const out = [];
    const MAIN = ['Matchresultat', 'Handikapp', 'Mål', 'Lagmål'];
    const tryLegs = legs => {
      // Minst ett ben om mål/resultat – annars blir bygget en rad småspel utan kärna.
      if (!legs.some(l => MAIN.includes(l.cat))) return;
      // Hörnor, kort och spelare räknas som oberoende – två ben ur samma kategori hänger ihop för mycket för det.
      const side = legs.filter(l => !l.goal).map(l => l.cat);
      if (new Set(side).size < side.length) return;
      const b = builder(m, legs);
      // Ben som redan följer av ett annat (Över 2,5 + Över 1,5) gör inget – hoppa över.
      if (b.p >= 0.97 * Math.min(...legs.map(l => l.p))) return;
      if (b.fair >= 1.9 && b.fair <= 3.3) out.push(b);
    };
    for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
      tryLegs([pool[i], pool[j]]);
      for (let k = j + 1; k < pool.length; k++) tryLegs([pool[i], pool[j], pool[k]]);
    }
    return out.sort((a, b) => score(b) - score(a));
  }

  // ms = dagens matcher (kommande, med modell). Returnerar allt som Dagens värde visar.
  function recommend(ms) {
    const all = ms.flatMap(m => allMarkets(m)).filter(useful);
    const byScore = all.slice().sort((a, b) => score(b) - score(a));
    // EV räknas bara där underlaget räcker. Över 30 % EV mot svenska odds är nästan alltid ett modellfel – visas inte.
    const evOk = x => x.ev != null && x.conf !== 'låg' && x.ev <= 0.3;
    const star = all.filter(x => evOk(x) && x.ev >= 0.03 && x.p >= 0.5).sort((a, b) => b.ev - a.ev);
    const value = all.filter(x => evOk(x) && x.ev >= 0.05 && x.p < 0.5 && x.p >= 0.2).sort((a, b) => b.ev - a.ev);
    // Säkraste: högst chans men ett odds som går att spela (lägst ~1,22). Högst tre spelarspel.
    let players = 0;
    const safest = pickDiverse(byScore.filter(x => x.p <= 0.82 && x.key !== 'g:o05' && (x.cat !== 'Spelare' || players++ < 6)), 8)
      .filter((x, i, arr) => x.cat !== 'Spelare' || arr.slice(0, i).filter(y => y.cat === 'Spelare').length < 3);
    const spec = pickDiverse(byScore.filter(x => x.p >= 0.25 && x.p <= 0.45 && x.conf !== 'låg' && (!x.hit || Number(x.hit.split(' ')[0]) / Number(x.hit.split(' ')[2]) >= x.p)), 6, 1);
    // Undvik: negativt EV mot spelbolagens odds, favoriter som vinner för sällan, matcher med för lite data.
    const avoid = [];
    for (const x of all.filter(x => x.ev != null && x.ev < -0.04).sort((a, b) => b.p - a.p).slice(0, 4)) avoid.push({ m: x.m, label: x.label, why: `EV ${Math.round(x.ev * 100)} % – oddset ${x.odds.toFixed(2)} betalar för lite för ${pc(x.p)} chans.` });
    for (const m of ms) {
      if (!m.model) continue;
      if (m.model.conf === 'låg') { avoid.push({ m, label: 'NO BET – hela matchen', why: `För lite underlag: modellen bygger på ${m.model.games} matcher per lag.` }); continue; }
      const fav = ['home', 'away'].map(k => ({ k, p: m.final?.[k] ?? m.model.p[k] })).sort((a, b) => b.p - a.p)[0];
      if (fav.p < 0.5 && fav.p > 0.38) avoid.push({ m, label: `${fav.k === 'home' ? m.home.short : m.away.short} vinner`, why: `Favoriten vinner bara ${pc(fav.p)} enligt oss – spela inte under ${(1.05 / fav.p).toFixed(2)} i odds.` });
    }
    const builders = ms.filter(m => m.model).flatMap(m => buildersFor(m, allMarkets(m)).slice(0, 3)).sort((a, b) => score(b) - score(a));
    const bbStar = builders[0] ?? null;
    const bbAlts = [];
    // Alternativen: helst från andra matcher, fyll på med samma match om det behövs.
    const rest = builders.slice(1);
    for (const b of [...rest.filter(b => b.m.id !== bbStar?.m.id), ...rest]) {
      if (bbAlts.length >= 3) break;
      if (!bbAlts.includes(b) && !bbAlts.some(x => x.m.id === b.m.id && x.legs.some(l => b.legs.some(k => k.key === l.key)))) bbAlts.push(b);
    }
    // Dagens bästa bet: positivt EV om vi har odds, annars det starkaste lagspelet med ett vettigt odds (~1,30–1,65).
    const best = star[0] ?? byScore.find(x => x.p >= 0.6 && x.p <= 0.77 && x.conf !== 'låg' && ['Matchresultat', 'Handikapp', 'Mål', 'Lagmål'].includes(x.cat))
      ?? byScore.find(x => x.p >= 0.6 && x.p <= 0.77 && x.cat !== 'Spelare') ?? safest[0] ?? null;
    const singles = [];
    for (const x of [...star, ...safest, ...value]) if (!singles.some(y => y.key === x.key && y.m.id === x.m.id) && singles.length < 8) singles.push(x);
    return { all, best, star, safest, value, spec, avoid, bbStar, bbAlts, singles, hasOdds: all.some(x => x.odds) };
  }

  // Det som sparas i tipsstatistiken (scripts/track.mjs): ett urval av dagens rekommendationer.
  function trackPicks(ms) {
    const r = recommend(ms);
    const out = [];
    const add = (x, kind) => { if (x && !out.some(y => y.key === x.key && y.m.id === x.m.id)) out.push({ ...x, kind }); };
    add(r.best, 'best');
    r.safest.filter(x => x.cat !== 'Spelare').slice(0, 3).forEach(x => add(x, 'single'));
    r.value.slice(0, 2).forEach(x => add(x, 'value'));
    add(r.bbStar, 'builder');
    r.safest.filter(x => x.cat === 'Spelare').concat(r.spec.filter(x => x.cat === 'Spelare')).slice(0, 2).forEach(x => add(x, 'player'));
    return out;
  }

  const api = { allMarkets, marketByKey, builder, joint, recommend, trackPicks, CATS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PICKS = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
