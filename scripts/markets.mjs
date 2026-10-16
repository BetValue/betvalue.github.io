// Spel som räknas direkt ur modellens resultatmatris: enskilda marknader,
// bet builders (flera villkor i samma match) och målskyttar.
//
// Målskyttar: varje mål laget gör antas vara spelarens med sannolikheten
// "share" (spelarens andel av lagets mål, nedskalat för byten/vila).

const r3 = x => Math.round(x * 1000) / 1000;

// p(i, j) = sannolikheten för i–j. w(i, j) = hur stor del av den som räknas.
function weigh(grid, w) {
  let s = 0;
  for (let i = 0; i < grid.length; i++) for (let j = 0; j < grid[i].length; j++) s += grid[i][j] * w(i, j);
  return s;
}
const when = f => (i, j) => (f(i, j) ? 1 : 0);

export const SINGLES = [
  ['o15', 'Över 1,5 mål', (i, j) => i + j >= 2],
  ['u35', 'Under 3,5 mål', (i, j) => i + j <= 3],
  ['btts', 'Båda lagen gör mål', (i, j) => i > 0 && j > 0],
  ['hscore', '{H} gör mål', i => i > 0],
  ['ascore', '{A} gör mål', (i, j) => j > 0],
  ['1x', '{H} eller oavgjort', (i, j) => i >= j],
  ['x2', '{A} eller oavgjort', (i, j) => j >= i],
];

export const BUILDERS = [
  ['1-o15', ['{H} vinner', 'Över 1,5 mål'], (i, j) => i > j && i + j >= 2],
  ['1-o25', ['{H} vinner', 'Över 2,5 mål'], (i, j) => i > j && i + j >= 3],
  ['1-btts', ['{H} vinner', 'Båda lagen gör mål'], (i, j) => i > j && j > 0],
  ['1-cs', ['{H} vinner', '{H} håller nollan'], (i, j) => i > j && j === 0],
  ['2-o15', ['{A} vinner', 'Över 1,5 mål'], (i, j) => j > i && i + j >= 2],
  ['2-o25', ['{A} vinner', 'Över 2,5 mål'], (i, j) => j > i && i + j >= 3],
  ['2-btts', ['{A} vinner', 'Båda lagen gör mål'], (i, j) => j > i && i > 0],
  ['2-cs', ['{A} vinner', '{A} håller nollan'], (i, j) => j > i && i === 0],
  ['btts-o25', ['Båda lagen gör mål', 'Över 2,5 mål'], (i, j) => i > 0 && j > 0 && i + j >= 3],
  ['1x-u35', ['{H} eller oavgjort', 'Under 3,5 mål'], (i, j) => i >= j && i + j <= 3],
  ['x2-u35', ['{A} eller oavgjort', 'Under 3,5 mål'], (i, j) => j >= i && i + j <= 3],
  ['x-u25', ['Oavgjort', 'Under 2,5 mål'], (i, j) => i === j && i + j <= 2],
];

export function teamMarkets(grid) {
  return {
    singles: SINGLES.map(([key, label, f]) => ({ key, label, p: r3(weigh(grid, when(f))) })),
    builders: BUILDERS.map(([key, legs, f]) => ({ key, legs, p: r3(weigh(grid, when(f))) })),
  };
}

const PLAY_FACTOR = 0.85; // spelaren byts ut, vilar eller missar ibland

export function playerMarkets(grid, side, players, teamGoals) {
  const goals = (i, j) => (side === 'home' ? i : j);
  const win = side === 'home' ? (i, j) => i > j : (i, j) => j > i;
  return players.map(pl => {
    const share = Math.min(pl.goals / Math.max(teamGoals, pl.goals, 1), 0.6) * PLAY_FACTOR;
    const scores = (i, j) => 1 - (1 - share) ** goals(i, j);
    return {
      ...pl, side,
      p: r3(weigh(grid, scores)),
      win: r3(weigh(grid, (i, j) => (win(i, j) ? scores(i, j) : 0))),
      o25: r3(weigh(grid, (i, j) => (i + j >= 3 ? scores(i, j) : 0))),
    };
  });
}
