// Rättning av bets: används både av sidan (sparade bets) och av scripts/fetch.mjs (vår
// tipsstatistik), så att båda räknar exakt likadant.
//
// gradeBet(key, label, state) → 'won' | 'lost' | 'live' | 'open' | 'unknown'
//   state = { started, done, h, a, goals }   goals = [{ side: 'home'|'away', name, og }] eller null
//
// Under matchen avgörs ett bet så fort inget som kan hända längre kan ändra utfallet
// (t.ex. "Över 2,5 mål" vid 3 mål, "Båda lagen gör mål" när båda har gjort mål).

(function (root) {
  // Samma villkor som scripts/markets.mjs.
  const TEAM_TESTS = {
    home: (h, a) => h > a, draw: (h, a) => h === a, away: (h, a) => a > h,
    over: (h, a) => h + a >= 3, under: (h, a) => h + a <= 2,
    's:o15': (h, a) => h + a >= 2, 's:u35': (h, a) => h + a <= 3, 's:btts': (h, a) => h > 0 && a > 0,
    's:hscore': h => h > 0, 's:ascore': (h, a) => a > 0, 's:1x': (h, a) => h >= a, 's:x2': (h, a) => a >= h,
    'b:1-o15': (h, a) => h > a && h + a >= 2, 'b:1-o25': (h, a) => h > a && h + a >= 3, 'b:1-btts': (h, a) => h > a && a > 0, 'b:1-cs': (h, a) => h > a && a === 0,
    'b:2-o15': (h, a) => a > h && h + a >= 2, 'b:2-o25': (h, a) => a > h && h + a >= 3, 'b:2-btts': (h, a) => a > h && h > 0, 'b:2-cs': (h, a) => a > h && h === 0,
    'b:btts-o25': (h, a) => h > 0 && a > 0 && h + a >= 3, 'b:1x-u35': (h, a) => h >= a && h + a <= 3, 'b:x2-u35': (h, a) => a >= h && h + a <= 3, 'b:x-u25': (h, a) => h === a && h + a <= 2,
  };
  // Fler målmarknader (picks.js). [vinner, push] – push = insatsen tillbaka (Draw No Bet, hela handikapp).
  const GOALS = {
    'g:dc-1x': [(h, a) => h >= a], 'g:dc-x2': [(h, a) => a >= h], 'g:dc-12': [(h, a) => h !== a],
    'g:dnb-h': [(h, a) => h > a, (h, a) => h === a], 'g:dnb-a': [(h, a) => a > h, (h, a) => h === a],
    'g:ah-h-1.5': [(h, a) => h - a >= 2], 'g:ah-h-1': [(h, a) => h - a >= 2, (h, a) => h - a === 1],
    'g:ah-h+1': [(h, a) => h >= a, (h, a) => a - h === 1], 'g:ah-h+1.5': [(h, a) => a - h <= 1],
    'g:ah-a-1.5': [(h, a) => a - h >= 2], 'g:ah-a-1': [(h, a) => a - h >= 2, (h, a) => a - h === 1],
    'g:ah-a+1': [(h, a) => a >= h, (h, a) => h - a === 1], 'g:ah-a+1.5': [(h, a) => h - a <= 1],
    'g:btts-n': [(h, a) => !(h > 0 && a > 0)],
    'g:cs-h': [(h, a) => a === 0], 'g:cs-a': [h => h === 0],
    'g:wtn-h': [(h, a) => h > a && a === 0], 'g:wtn-a': [(h, a) => a > h && h === 0],
  };
  for (const n of [0.5, 1.5, 3.5, 4.5]) {
    const k = String(n).replace('.', '');
    GOALS['g:o' + k.padStart(2, '0')] = [(h, a) => h + a > n];
    GOALS['g:u' + k.padStart(2, '0')] = [(h, a) => h + a < n];
  }
  for (const n of [0.5, 1.5, 2.5]) {
    const k = String(n).replace('.', '').padStart(2, '0');
    GOALS['g:h-o' + k] = [h => h > n]; GOALS['g:a-o' + k] = [(h, a) => a > n];
    GOALS['g:h-u' + k] = [h => h < n]; GOALS['g:a-u' + k] = [(h, a) => a < n];
  }
  // Halvlekar: [halvlek, test på målen i den halvleken].
  const HALVES = {
    'g:1h-o05': [1, (x, y) => x + y >= 1], 'g:1h-o15': [1, (x, y) => x + y >= 2], 'g:1h-u15': [1, (x, y) => x + y <= 1],
    'g:2h-o05': [2, (x, y) => x + y >= 1], 'g:2h-o15': [2, (x, y) => x + y >= 2], 'g:2h-u15': [2, (x, y) => x + y <= 1],
  };
  // Spelarspel (x:stat:antal:id): index i st.players[i].
  const PSTAT = { sh: 'sh', sot: 'sot', fc: 'fc', fs: 'fs', y: 'y', g: 'g', a: 'a', ga: null };

  // Spelarspel: s = spelaren har gjort mål, side = spelarens lag.
  const PLAYER_TESTS = {
    p: s => s,
    pw: (s, side, h, a) => s && (side === 'home' ? h > a : a > h),
    po: (s, side, h, a) => s && h + a >= 3,
  };

  const norm = s => String(s ?? '').toLowerCase()
    .replace(/ø/g, 'o').replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/ł/g, 'l').replace(/ı/g, 'i')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(Boolean);

  // Samma spelare? "Harry Kane" = "H. Kane" = "Kane"; "Vinícius Júnior" = "Vinicius Junior".
  function samePlayer(x, y) {
    const a = norm(x), b = norm(y);
    if (!a.length || !b.length) return false;
    if (a.join(' ') === b.join(' ')) return true;
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    if (short.every(t => long.includes(t))) return true;
    // Samma efternamn och samma första bokstav i förnamnet.
    return a[a.length - 1] === b[b.length - 1] && a.length > 1 && b.length > 1 && a[0][0] === b[0][0];
  }

  // Spelarens namn ur betets text: "Kane gör mål", "Bayern vinner + Kane gör mål".
  const playerFromLabel = label => /(?:^|\+\s*)([^+]+?) gör mål/.exec(String(label ?? ''))?.[1]?.trim() ?? null;

  // Ett ben i taget för spel som inte bara hänger på slutresultatet.
  // st.ht = [h, a] i halvtid, st.stats = { c: [hörnor h, a], y: [gula h, a] }, st.players = [{ id, name, sh, sot, fc, fs, y, g, a }]
  function gradeExtra(key, label, st) {
    const done = st.done;
    const ou = (v, s) => { const m = /^(h-|a-)?([ou])(\d+(?:\.5)?)$/.exec(s); if (!m) return null; const x = m[1] === 'h-' ? v[0] : m[1] === 'a-' ? v[1] : v[0] + v[1]; return m[2] === 'o' ? x > Number(m[3]) : x < Number(m[3]); };
    if (HALVES[key]) {
      if (!done || !Array.isArray(st.ht)) return done ? 'unknown' : 'live';
      const [half, f] = HALVES[key];
      const x = half === 1 ? st.ht[0] : (Number(st.h) || 0) - st.ht[0], y = half === 1 ? st.ht[1] : (Number(st.a) || 0) - st.ht[1];
      return f(x, y) ? 'won' : 'lost';
    }
    const [kind, rest] = [key.slice(0, 2), key.slice(2)];
    if (kind === 'c:' || kind === 'k:') {
      const v = st.stats?.[kind === 'c:' ? 'c' : 'y'];
      if (!done || !Array.isArray(v)) return done ? 'unknown' : 'live';
      if (rest === 'most-h') return v[0] > v[1] ? 'won' : 'lost';
      if (rest === 'most-a') return v[1] > v[0] ? 'won' : 'lost';
      const r = ou(v, rest);
      return r == null ? 'unknown' : r ? 'won' : 'lost';
    }
    if (kind === 'x:') {
      const [stat, n, id] = rest.split(':');
      if (!done || !Array.isArray(st.players)) return done ? 'unknown' : 'live';
      const name = String(label ?? '').replace(/ (minst|gör|får|blir|skjuter).*$/, '');
      const p = st.players.find(q => String(q.id) === id) ?? st.players.find(q => samePlayer(q.name, name));
      if (!p) return 'void'; // spelade inte – spelbolagen makulerar spelet
      const v = stat === 'ga' ? (p.g || 0) + (p.a || 0) : Number(p[PSTAT[stat]] || 0);
      return v >= Number(n) ? 'won' : 'lost';
    }
    return null;
  }

  function gradeBet(key, label, st) {
    if (!st || !st.started) return 'open';
    key = String(key);
    // Bet builder: alla ben måste gå in. Ett ben som makuleras (spelaren spelade inte) gör hela spelet ogiltigt.
    if (key.startsWith('bb:')) {
      const keys = key.slice(3).split('|'), labels = String(label ?? '').split(' + ');
      const res = keys.map((k, i) => gradeBet(k, labels[i] ?? '', st));
      if (res.includes('lost')) return 'lost';
      if (res.every(r => r === 'won')) return 'won';
      if (res.includes('void') && res.every(r => r === 'won' || r === 'void')) return 'void';
      return res.includes('unknown') && st.done ? 'unknown' : st.done ? 'unknown' : 'live';
    }
    if (HALVES[key] || /^[ckx]:/.test(key)) return gradeExtra(key, label, st);
    if (GOALS[key]) {
      const [win, push] = GOALS[key];
      const out = (h, a) => (win(h, a) ? 'won' : push?.(h, a) ? 'void' : 'lost');
      const h = Number(st.h) || 0, a = Number(st.a) || 0;
      if (st.done) return out(h, a);
      const seen = new Set();
      for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) seen.add(out(h + i, a + j));
      return seen.size === 1 ? [...seen][0] : 'live';
    }
    const kind = key.split(':')[0];
    let test;
    if (TEAM_TESTS[key]) {
      const f = TEAM_TESTS[key];
      test = (h, a) => f(h, a);
    } else if (PLAYER_TESTS[kind] && /^p[wo]?:/.test(key)) {
      const name = playerFromLabel(label);
      if (!name || !Array.isArray(st.goals)) return st.done ? 'unknown' : 'live';
      const goal = st.goals.find(g => !g.og && samePlayer(g.name, name));
      const f = PLAYER_TESTS[kind];
      // Har spelaren inte gjort mål än kan hen göra det för vilket lag som helst (vi vet inte vilket).
      const options = goal ? [[true, goal.side]] : st.done ? [[false, 'home']] : [[false, 'home'], [true, 'home'], [true, 'away']];
      test = (h, a) => options.map(([s, side]) => f(s, side, h, a));
    } else return st.done ? 'unknown' : 'live';

    const h = Number(st.h) || 0, a = Number(st.a) || 0;
    if (st.done) return [].concat(test(h, a)).every(Boolean) ? 'won' : 'lost';
    // Pågår: prova alla sätt matchen kan sluta på (upp till 8 mål till per lag).
    let any = false, all = true;
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
      for (const r of [].concat(test(h + i, a + j))) { any ||= r; all &&= r; }
    }
    return all ? 'won' : !any ? 'lost' : 'live';
  }

  const api = { gradeBet, samePlayer, playerFromLabel, TEAM_TESTS, GOAL_TESTS: GOALS, HALF_TESTS: HALVES };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
