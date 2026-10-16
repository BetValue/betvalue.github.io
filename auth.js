// Konton via Supabase: inloggning, favoriter (lag och spelare) och delade boostar.
// Nyckeln nedan är projektets publika nyckel – den är gjord för att ligga i webbläsaren.
// Vad den får göra styrs av reglerna i supabase/schema.sql.

const SUPABASE_URL = 'https://avtmxbqqjkrcwbpkaihr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_kl5iy4KG88gg8Shzm4_G-w_A-8JL6xw';

// lock: supabase-js låser normalt sessionen mellan flikar via navigator.locks. Med sidan öppen i
// flera flikar kan inloggningen då stå och vänta länge ("laddar"). Vi kör utan det låset.
const sb = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, lock: (_name, _timeout, fn) => fn() },
});
const AUTH = { user: null, profile: null, favs: new Map(), saved: new Set(), ready: null };

async function loadProfile() {
  if (!AUTH.user) { AUTH.profile = null; AUTH.favs.clear(); AUTH.saved.clear(); return; }
  const [{ data: profile }, { data: favs }, { data: saved }] = await Promise.all([
    sb.from('profiles').select('username').eq('id', AUTH.user.id).maybeSingle(),
    sb.from('favorites').select('kind, ref, label, extra').order('created_at'),
    sb.from('saved_bets').select('match_id, pick'),
  ]);
  AUTH.profile = profile;
  AUTH.favs = new Map((favs ?? []).map(f => [f.kind + '|' + f.ref, f]));
  AUTH.saved = new Set((saved ?? []).map(b => b.match_id + '|' + b.pick));
  const { count } = await sb.from('friendships').select('id', { count: 'exact', head: true }).eq('addressee', AUTH.user.id).eq('status', 'pending');
  AUTH.requests = count ?? 0;
}

function paintAccountLink() {
  const a = document.getElementById('nav-account');
  if (!a) return;
  for (const link of [a, document.getElementById('nav-account-m')]) {
    if (!link) continue;
    link.textContent = AUTH.user ? (AUTH.profile?.username ?? 'Mitt konto') : 'Logga in';
    link.classList.toggle('signed-in', !!AUTH.user);
    link.classList.toggle('has-req', !!(AUTH.user && AUTH.requests));
    if (AUTH.user && AUTH.requests) link.title = AUTH.requests === 1 ? '1 ny vänförfrågan' : AUTH.requests + ' nya vänförfrågningar';
  }
  let out = document.getElementById('nav-logout');
  if (AUTH.user && !out) {
    out = document.createElement('button');
    out.id = 'nav-logout';
    out.className = 'logout-btn';
    out.textContent = 'Logga ut';
    out.addEventListener('click', logOut);
    a.closest('.top-in').appendChild(out);
  }
  if (out) out.hidden = !AUTH.user;
}

async function logOut() {
  await sb.auth.signOut();
  if (/konto.html$/.test(location.pathname)) location.reload();
}

AUTH.ready = (async () => {
  if (!sb) return;
  const { data } = await Promise.race([sb.auth.getSession(), new Promise(r => setTimeout(() => r({ data: {} }), 6000))]);
  AUTH.user = data.session?.user ?? null;
  await loadProfile().catch(() => {});
  paintAccountLink();
  syncFavButtons(document);
  syncSaveButtons(document);
})();

// OBS: inga Supabase-anrop direkt i den här callbacken – supabase-js håller ett lås medan den körs,
// så ett anrop här inne väntar på sig självt och inloggningen fastnar på "Loggar in…".
// Därför skjuts arbetet upp med setTimeout.
sb?.auth.onAuthStateChange((event, session) => {
  if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
  AUTH.user = session?.user ?? null;
  setTimeout(async () => {
    await loadProfile().catch(() => {});
    paintAccountLink();
    syncFavButtons(document);
    syncSaveButtons(document);
    document.dispatchEvent(new CustomEvent('auth:changed'));
  }, 0);
});

// Skriv bara om texten ändrats – annars triggar MutationObservern nedan sig själv i all evighet.
function setText(el, text) { if (el && el.textContent !== text) el.textContent = text; }

// ---------- Favoriter ----------

function favButton(kind, ref, label, extra = {}) {
  return `<button class="fav" data-fav-kind="${kind}" data-fav-ref="${esc(ref)}" data-fav-label="${esc(label)}" data-fav-extra="${esc(JSON.stringify(extra))}"
    aria-pressed="false"><span class="star">☆</span><span class="fav-text">Favorit</span></button>`;
}

function syncFavButtons(root) {
  root.querySelectorAll?.('[data-fav-kind]').forEach(b => {
    const on = AUTH.favs.has(b.dataset.favKind + '|' + b.dataset.favRef);
    b.setAttribute('aria-pressed', on);
    b.classList.toggle('on', on);
    setText(b.querySelector('.star'), on ? '★' : '☆');
    setText(b.querySelector('.fav-text'), on ? 'Favorit' : 'Lägg till favorit');
  });
}

async function toggleFav(b) {
  if (!AUTH.user) { location.href = 'konto.html?next=' + encodeURIComponent(location.pathname + location.search); return; }
  const { favKind: kind, favRef: ref, favLabel: label } = b.dataset;
  const key = kind + '|' + ref;
  if (AUTH.favs.has(key)) {
    AUTH.favs.delete(key);
    await sb.from('favorites').delete().match({ kind, ref });
  } else {
    const row = { kind, ref, label, extra: JSON.parse(b.dataset.favExtra || '{}') };
    AUTH.favs.set(key, row);
    await sb.from('favorites').insert(row);
  }
  syncFavButtons(document);
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-fav-kind]');
  if (!b) return;
  e.preventDefault();
  e.stopPropagation();
  toggleFav(b);
}, true);
document.addEventListener('sheet:rendered', e => syncFavButtons(e.detail));

// ---------- Sparade bets ----------

function syncSaveButtons(root) {
  root.querySelectorAll?.('[data-save-bet]').forEach(b => {
    const d = JSON.parse(b.dataset.saveBet);
    const on = AUTH.saved.has(d.match_id + '|' + d.pick);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on);
    setText(b.querySelector('b'), on ? '✓' : '＋');
    setText(b.querySelector('span'), on ? 'Sparad' : 'Spara');
  });
}

async function toggleSave(b) {
  if (!AUTH.user) { location.href = 'konto.html?next=' + encodeURIComponent(location.pathname + location.search); return; }
  const d = JSON.parse(b.dataset.saveBet);
  const key = d.match_id + '|' + d.pick;
  b.disabled = true;
  if (AUTH.saved.has(key)) {
    const { error } = await sb.from('saved_bets').delete().match({ match_id: d.match_id, pick: d.pick });
    if (!error) AUTH.saved.delete(key);
  } else {
    const { error } = await sb.from('saved_bets').insert(d);
    if (!error || /duplicate/i.test(error.message)) AUTH.saved.add(key);
  }
  b.disabled = false;
  syncSaveButtons(document);
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-save-bet]');
  if (!b) return;
  e.preventDefault();
  e.stopPropagation();
  toggleSave(b);
}, true);

// Knappar som ritas efter inloggningen (nya vyer, bottenarket) får rätt läge direkt.
let syncQueued = false;
new MutationObserver(() => {
  if (syncQueued) return;
  syncQueued = true;
  requestAnimationFrame(() => { syncQueued = false; syncSaveButtons(document); syncFavButtons(document); });
}).observe(document.documentElement, { childList: true, subtree: true });

// ---------- Delade boostar ----------

async function sharedBoosts() {
  if (!sb) return [];
  const { data, error } = await sb.from('boosts_public').select('*').order('created_at', { ascending: false }).limit(200);
  if (error) return [];
  return data.map(b => ({ ...b, odds: Number(b.odds), was: b.was ? Number(b.was) : null, match: b.match_id, shared: true }));
}
