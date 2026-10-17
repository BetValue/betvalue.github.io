// Bygger data/players.json: alla spelare i ligornas trupper (från ESPN), för sökrutan.
// Körs av fetch.mjs högst en gång per dygn, eller direkt: node scripts/players.mjs
//
// Format: { updated, players: [{ i: ESPN-id, n: namn, p: position, j: tröjnummer, t: vårt lag-id, c: turnering }] }

import { readFile, writeFile } from 'node:fs/promises';

const DATA = new URL('../data/', import.meta.url);
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer/';
const MAX_AGE_H = 20;

export async function buildPlayerIndex(competitions, { force = false } = {}) {
  const file = new URL('players.json', DATA);
  try {
    const old = JSON.parse(await readFile(file, 'utf8'));
    if (!force && (Date.now() - Date.parse(old.updated)) / 36e5 < MAX_AGE_H) return;
  } catch {}

  const players = new Map(); // ESPN-id → spelare; ligorna kommer före CL så ligalaget vinner
  let teams = 0, failed = 0;
  for (const c of competitions) {
    if (!c.espn) continue;
    for (const [ourId, team] of Object.entries(c.espn.teams)) {
      try {
        const res = await fetch(`${ESPN}${c.espn.slug}/teams/${team.id}/roster`);
        if (!res.ok) throw new Error(res.status);
        const roster = await res.json();
        for (const a of roster.athletes ?? []) {
          if (players.has(a.id)) continue;
          players.set(a.id, { i: a.id, n: a.displayName, p: a.position?.abbreviation ?? '', j: a.jersey ?? '', t: Number(ourId), c: c.id });
        }
        teams++;
      } catch {
        failed++;
      }
    }
  }
  if (!players.size) { console.warn('Spelarindex: inga spelare hämtades'); return; }
  await writeFile(file, JSON.stringify({ updated: new Date().toISOString(), players: [...players.values()] }));
  console.log(`Spelarindex: ${players.size} spelare från ${teams} lag${failed ? ` (${failed} lag misslyckades)` : ''}`);
}

// Direktkörning: använd lagkopplingen i data/latest.json.
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('players.mjs')) {
  const latest = JSON.parse(await readFile(new URL('latest.json', DATA), 'utf8'));
  await buildPlayerIndex(latest.competitions, { force: true });
}
