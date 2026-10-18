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

  function gradeBet(key, label, st) {
    if (!st || !st.started) return 'open';
    const kind = String(key).split(':')[0];
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

  const api = { gradeBet, samePlayer, playerFromLabel, TEAM_TESTS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
