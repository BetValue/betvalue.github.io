// Konton via Supabase: inloggning, favoriter (lag och spelare) och delade boostar.
// Nyckeln nedan är projektets publika nyckel – den är gjord för att ligga i webbläsaren.
// Vad den får göra styrs av reglerna i supabase/schema.sql.

const SUPABASE_URL = 'https://avtmxbqqjkrcwbpkaihr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_kl5iy4KG88gg8Shzm4_G-w_A-8JL6xw';

const sb = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
const AUTH = { user: null, profile: null, favs: new Map(), ready: null };

async function loadProfile() {
  if (!AUTH.user) { AUTH.profile = null; AUTH.favs.clear(); return; }
  const [{ data: profile }, { data: favs }] = await Promise.all([
    sb.from('profiles').select('username').eq('id', AUTH.user.id).maybeSingle(),
    sb.from('favorites').select('kind, ref, label, extra').order('created_at'),
  ]);
  AUTH.profile = profile;
  AUTH.favs = new Map((favs ?? []).map(f => [f.kind + '|' + f.ref, f]));
}

function paintAccountLink() {
  const a = document.getElementById('nav-account');
  if (!a) return;
  a.textContent = AUTH.user ? (AUTH.profile?.username ?? 'Mitt konto') : 'Logga in';
  a.classList.toggle('signed-in', !!AUTH.user);
}

AUTH.ready = (async () => {
  if (!sb) return;
  const { data } = await sb.auth.getSession();
  AUTH.user = data.session?.user ?? null;
  await loadProfile().catch(() => {});
  paintAccountLink();
  syncFavButtons(document);
})();

sb?.auth.onAuthStateChange(async (event, session) => {
  if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
  AUTH.user = session?.user ?? null;
  await loadProfile().catch(() => {});
  paintAccountLink();
  syncFavButtons(document);
  document.dispatchEvent(new CustomEvent('auth:changed'));
});

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
    b.querySelector('.star').textContent = on ? '★' : '☆';
    b.querySelector('.fav-text').textContent = on ? 'Favorit' : 'Lägg till favorit';
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

// ---------- Delade boostar ----------

async function sharedBoosts() {
  if (!sb) return [];
  const { data, error } = await sb.from('boosts_public').select('*').order('created_at', { ascending: false }).limit(200);
  if (error) return [];
  return data.map(b => ({ ...b, odds: Number(b.odds), was: b.was ? Number(b.was) : null, match: b.match_id, shared: true }));
}
