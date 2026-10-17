// Sökruta i menyn: sök bland alla klubbar och spelare. Klubbar kommer från vår data,
// spelare från data/players.json (byggs av scripts/players.mjs en gång per dygn).
// Öppnas med 🔍-knappen, "/" eller Ctrl+K.

const SEARCH = { players: null, active: 0, results: [] };
const POS_NAME = { G: 'Målvakt', D: 'Försvarare', M: 'Mittfältare', F: 'Anfallare' };

const normName = s => String(s ?? '').toLowerCase()
  .replace(/ø/g, 'o').replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/ł/g, 'l')
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

// Alla lag, en gång per lag (ligan går före Champions League).
function allClubs() {
  const seen = new Map();
  for (const c of DATA.latest?.competitions ?? []) {
    if (c.id === 'UNL') continue;
    const teams = [...c.standings.flatMap(s => s.rows.map(r => r.team)), ...c.matches.flatMap(m => [m.home, m.away])];
    for (const t of teams) {
      if (!t?.id || seen.has(t.id)) continue;
      seen.set(t.id, { ...t, comp: c, k: normName(t.name) + ' ' + normName(t.short) });
    }
  }
  return [...seen.values()];
}

function teamOf(compId, teamId) {
  const c = DATA.latest?.competitions.find(x => x.id === compId);
  if (!c) return null;
  return c.standings.flatMap(s => s.rows.map(r => r.team)).find(t => t.id === teamId)
    ?? c.matches.flatMap(m => [m.home, m.away]).find(t => t.id === teamId) ?? null;
}

function loadPlayers() {
  SEARCH.players ??= fetch('data/players.json?d=' + new Date().toISOString().slice(0, 10))
    .then(r => (r.ok ? r.json() : { players: [] }))
    .then(d => d.players.map(p => ({ ...p, k: normName(p.n) })))
    .catch(() => []);
  return SEARCH.players;
}

// 4 = ett helt ord är exakt sökningen, 3 = namnet börjar med den, 2 = något ord gör det, 1 = finns någonstans.
function score(k, q) {
  if (k.split(/[\s-]+/).includes(q)) return 4;
  if (k.startsWith(q)) return 3;
  if (k.split(/[\s-]+/).some(w => w.startsWith(q))) return 2;
  return k.includes(q) ? 1 : 0;
}

async function runSearch(text) {
  const q = normName(text.trim());
  const list = $('#search-results');
  if (q.length < 2) {
    SEARCH.results = [];
    list.innerHTML = '<p class="note search-tip">Skriv minst två bokstäver, t.ex. <b>haal</b> eller <b>arsen</b>.</p>';
    return;
  }
  const clubs = allClubs().map(t => ({ t, s: score(t.k, q) })).filter(x => x.s)
    .sort((a, b) => b.s - a.s || a.t.name.length - b.t.name.length).slice(0, 6);
  const players = (await loadPlayers()).map(p => ({ p, s: score(p.k, q) })).filter(x => x.s)
    .sort((a, b) => b.s - a.s || a.p.n.length - b.p.n.length).slice(0, 14);
  if (normName($('#search-input').value.trim()) !== q) return; // användaren hann skriva mer

  SEARCH.results = [
    ...clubs.map(({ t }) => ({ type: 'club', t })),
    ...players.map(({ p }) => ({ type: 'player', p, team: teamOf(p.c, p.t) })),
  ];
  SEARCH.active = 0;
  if (!SEARCH.results.length) { list.innerHTML = `<p class="note search-tip">Hittade inget för "${esc(text.trim())}".</p>`; return; }
  let i = -1;
  const row = r => {
    i++;
    if (r.type === 'club') {
      return `<button class="sr" data-sr="${i}">${crest(r.t)}<span class="sr-main"><b>${esc(r.t.name)}</b><small>Klubb · ${esc(r.t.comp.name)}</small></span><i>→</i></button>`;
    }
    return `<button class="sr" data-sr="${i}">${r.team ? crest(r.team) : '<span class="crest blank"></span>'}
      <span class="sr-main"><b>${esc(r.p.n)}</b><small>${esc([POS_NAME[r.p.p] ?? r.p.p, r.team?.short, r.p.j && '#' + r.p.j].filter(Boolean).join(' · '))}</small></span><i>→</i></button>`;
  };
  list.innerHTML = (clubs.length ? `<span class="label">Klubbar</span>${SEARCH.results.filter(r => r.type === 'club').map(row).join('')}` : '')
    + (players.length ? `<span class="label">Spelare</span>${SEARCH.results.filter(r => r.type === 'player').map(row).join('')}` : '');
  markActive();
}

function markActive() {
  document.querySelectorAll('#search-results .sr').forEach(b => b.classList.toggle('on', Number(b.dataset.sr) === SEARCH.active));
}

function pick(i) {
  const r = SEARCH.results[i];
  if (!r) return;
  closeSearch();
  if (r.type === 'club') openClub(r.t.comp.id, r.t.id, r.t.name);
  else openPlayer(r.p.i, SLUG[r.p.c], r.team?.name ?? '');
}

function openSearch() {
  let box = $('#search');
  if (!box) {
    document.body.insertAdjacentHTML('beforeend', `<div class="search" id="search" hidden>
      <div class="search-bg" data-search-close></div>
      <div class="search-card" role="dialog" aria-modal="true" aria-label="Sök">
        <div class="search-field"><span>🔍</span><input id="search-input" type="search" placeholder="Sök klubbar och spelare" autocomplete="off" aria-label="Sök klubbar och spelare">
          <button class="search-x" data-search-close aria-label="Stäng">Esc</button></div>
        <div class="search-results" id="search-results"></div>
      </div>
    </div>`);
    box = $('#search');
    const input = $('#search-input');
    let timer;
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => runSearch(input.value), 120); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); SEARCH.active = Math.min(SEARCH.active + 1, SEARCH.results.length - 1); markActive(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); SEARCH.active = Math.max(SEARCH.active - 1, 0); markActive(); }
      else if (e.key === 'Enter') { e.preventDefault(); pick(SEARCH.active); }
      else if (e.key === 'Escape') closeSearch();
    });
  }
  box.hidden = false;
  document.body.style.overflow = 'hidden';
  loadPlayers();
  const input = $('#search-input');
  input.value = '';
  runSearch('');
  input.focus();
}

function closeSearch() {
  const box = $('#search');
  if (box) box.hidden = true;
  if ($('#sheet')?.hidden !== false) document.body.style.overflow = '';
}

// Knappen i menyn (läggs in här så att HTML-sidorna inte behöver ändras).
const brandEl = document.querySelector('.top-in .brand');
brandEl?.insertAdjacentHTML('afterend', '<button class="search-btn" id="search-open" aria-label="Sök klubbar och spelare"><span>🔍</span><b>Sök</b></button>');

document.addEventListener('click', e => {
  const t = e.target.closest('#search-open,[data-search-close],[data-sr]');
  if (!t) return;
  if (t.id === 'search-open') openSearch();
  else if ('searchClose' in t.dataset) closeSearch();
  else pick(Number(t.dataset.sr));
});
document.addEventListener('keydown', e => {
  const typing = /input|textarea|select/i.test(document.activeElement?.tagName ?? '');
  if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); openSearch(); }
});
