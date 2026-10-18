// Bygger data/photos.json: en bild per spelare (Wikipedia/Wikimedia Commons, fria licenser),
// 600 px bred så att den blir skarp även på mobil. Körs av fetch.mjs efter spelarlistan.
//
// Rätt person kontrolleras med Wikipedias beskrivning ("… footballer (born 2001)") mot
// spelarens födelseår från ESPN. Spelare utan träff provas igen efter en vecka.
//
// Format: { updated, photos: { ESPN-id: { u: bild-url, p: Wikipedia-sida } }, misses: { ESPN-id: senast provad } }

import { readFile, writeFile } from 'node:fs/promises';

const DATA = new URL('../data/', import.meta.url);
const API = 'https://en.wikipedia.org/w/api.php';
// Wikimedia vill att automatiska anrop har en User-Agent som säger vilka vi är.
const HEADERS = { 'User-Agent': 'BetValueBot/1.0 (https://github.com/BetValue/betvalue.github.io)' };
const RETRY_DAYS = 7;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(params) {
  const url = API + '?' + new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: HEADERS });
    if (res.status === 429) { await sleep(5000 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`Wikipedia ${res.status}`);
    return res.json();
  }
  throw new Error('Wikipedia 429');
}

// Är sidan en fotbollsspelare med rätt födelseår?
function matches(page, player) {
  const desc = (page.description ?? '').toLowerCase();
  if (!/footballer|soccer player|association football/.test(desc)) return false;
  const born = /born (\d{4})/.exec(desc)?.[1];
  return !player.b || !born || Number(born) === player.b;
}

function photoOf(page) {
  const src = page.thumbnail?.source ?? page.original?.source;
  return src ? { u: src, p: page.title } : null;
}

// Slår upp många sidtitlar på en gång (50 per anrop) och returnerar titel → sida.
async function lookupTitles(titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    const chunk = titles.slice(i, i + 50);
    const j = await api({ action: 'query', titles: chunk.join('|'), redirects: '1', prop: 'pageimages|description', piprop: 'thumbnail|original', pithumbsize: '600', pilimit: '50' });
    const alias = new Map();
    for (const n of j.query?.normalized ?? []) alias.set(n.to, n.from);
    for (const r of j.query?.redirects ?? []) alias.set(r.to, alias.get(r.from) ?? r.from);
    for (const page of j.query?.pages ?? []) {
      if (page.missing) continue;
      out.set(alias.get(page.title) ?? page.title, page);
    }
    await sleep(300);
  }
  return out;
}

export async function buildPhotos({ maxSearches = 200, budgetMs = 6 * 60e3 } = {}) {
  const started = Date.now();
  const players = JSON.parse(await readFile(new URL('players.json', DATA), 'utf8')).players;
  let cache = { photos: {}, misses: {} };
  try { cache = { ...cache, ...JSON.parse(await readFile(new URL('photos.json', DATA), 'utf8')) }; } catch {}
  const retryBefore = Date.now() - RETRY_DAYS * 864e5;
  let todo = players.filter(p => !cache.photos[p.i] && !(cache.misses[p.i] && Date.parse(cache.misses[p.i]) > retryBefore));
  const before = Object.keys(cache.photos).length;
  const found = (p, page) => { cache.photos[p.i] = photoOf(page); delete cache.misses[p.i]; };

  try {
    // 1. Sidan heter som spelaren ("Harry Maguire", "Raphinha").
    // 2. "Namn (footballer)" eller "Namn (footballer, born 2001)".
    for (const variant of [p => p.n, p => `${p.n} (footballer)`, p => (p.b ? `${p.n} (footballer, born ${p.b})` : null)]) {
      const want = todo.map(p => [p, variant(p)]).filter(([, t]) => t);
      const pages = await lookupTitles([...new Set(want.map(([, t]) => t))]);
      for (const [p, t] of want) {
        const page = pages.get(t);
        if (page && matches(page, p) && photoOf(page)) found(p, page);
      }
      todo = todo.filter(p => !cache.photos[p.i]);
      if (Date.now() - started > budgetMs) break;
    }

    // 3. Sökning för de som är kvar (en i taget, så begränsat per körning).
    let searches = 0;
    for (const p of todo) {
      if (searches >= maxSearches || Date.now() - started > budgetMs) break;
      searches++;
      const j = await api({ action: 'query', generator: 'search', gsrsearch: `${p.n} footballer`, gsrlimit: '3', prop: 'pageimages|description', piprop: 'thumbnail|original', pithumbsize: '600' });
      const page = (j.query?.pages ?? []).sort((a, b) => a.index - b.index).find(x => matches(x, p) && photoOf(x));
      if (page) found(p, page);
      else cache.misses[p.i] = new Date().toISOString();
      await sleep(400);
    }
  } catch (err) {
    console.warn('Spelarbilder:', err.message, '(sparar det som hunnit hämtas)');
  }

  // Spelare som inte finns kvar i någon trupp rensas bort.
  const ids = new Set(players.map(p => p.i));
  for (const id of Object.keys(cache.photos)) if (!ids.has(id)) delete cache.photos[id];
  await writeFile(new URL('photos.json', DATA), JSON.stringify({ updated: new Date().toISOString(), photos: cache.photos, misses: cache.misses }));
  const total = Object.keys(cache.photos).length;
  console.log(`Spelarbilder: ${total} av ${players.length} spelare har bild (${total - before} nya)`);
}

if (process.argv[1]?.endsWith('photos.mjs')) await buildPhotos({ maxSearches: Number(process.argv[2] ?? 200) });
