// Kontosidan: logga in, skapa konto (med 6-siffrig kod via mejl första gången) och Mitt konto.

// Mejlbekräftelse är avstängd i Supabase (Confirm email = av). Sätt till false om den slås på igen.
const AUTH_NO_EMAIL = true;
const kstate = { view: 'login', email: '', notice: '' };
const next = new URLSearchParams(location.search).get('next');

const field = (id, label, type = 'text', attrs = '') =>
  `<label class="f"><span>${label}</span><input id="${id}" type="${type}" ${attrs}></label>`;
const errBox = '<p class="form-err" id="form-err" role="alert" hidden></p>';
function showErr(text) {
  const el = $('#form-err');
  el.textContent = text;
  el.hidden = !text;
}
// Avbryt efter 20 s så att knappen inte står och snurrar om nätet eller Supabase hänger.
function withTimeout(promise, ms = 20000) {
  return Promise.race([promise, new Promise(resolve => setTimeout(() => resolve({ error: { message: 'timeout' } }), ms))]);
}
function busy(btn, on, text) {
  btn.disabled = on;
  if (text) btn.textContent = text;
}

// Supabase-felen på svenska.
function sv(error) {
  const m = (error?.message ?? String(error)).toLowerCase();
  if (m.includes('invalid login')) return 'Fel användarnamn, mejl eller lösenord.';
  if (m.includes('already registered') || m.includes('already been registered')) return 'Det finns redan ett konto med den mejladressen. Logga in i stället.';
  if (m.includes('password should be') || m.includes('weak')) return 'Lösenordet är för svagt. Använd minst 8 tecken.';
  if (m.includes('expired') || (m.includes('invalid') && m.includes('otp')) || m.includes('token has expired')) return 'Koden är fel eller har gått ut. Skicka en ny kod.';
  if (m.includes('rate limit') || m.includes('security purposes')) return 'För många försök. Vänta en stund och försök igen.';
  if (m.includes('email address') && m.includes('invalid')) return 'Mejladressen ser inte giltig ut.';
  if (m.includes('error sending') || m.includes('smtp')) return 'Kunde inte skicka mejlet med koden just nu. Försök igen om en stund.';
  if (m === 'timeout') return 'Det tog för lång tid. Kontrollera uppkopplingen och försök igen.';
  return 'Något gick fel: ' + (error?.message ?? error);
}

function done() {
  location.href = next && next.startsWith('/') ? next : 'konto.html';
}

// ---------- Vyer ----------

function viewLogin() {
  return `<div class="auth-card">
    <div class="auth-tabs"><button class="on">Logga in</button><button data-kview="signup">Skapa konto</button></div>
    <form id="login-form" novalidate>
      ${field('l-id', 'Användarnamn', 'text', 'autocomplete="username" required')}
      ${field('l-pw', 'Lösenord', 'password', 'autocomplete="current-password" required')}
      ${errBox}
      <button class="btn-gold" type="submit">Logga in</button>
    </form>
    <p class="auth-alt">Inget konto än? <button class="linkbtn" data-kview="signup">Skapa ett här</button></p>
  </div>`;
}

function viewSignup() {
  return `<div class="auth-card">
    <div class="auth-tabs"><button data-kview="login">Logga in</button><button class="on">Skapa konto</button></div>
    <form id="signup-form" novalidate>
      ${field('s-user', 'Användarnamn', 'text', 'autocomplete="nickname" minlength="3" maxlength="20" required')}
      <p class="hint-sm">3–20 tecken: bokstäver a–z, siffror, punkt, bindestreck eller understreck.</p>
      ${field('s-pw', 'Lösenord', 'password', 'autocomplete="new-password" minlength="8" required')}
      ${field('s-pw2', 'Upprepa lösenordet', 'password', 'autocomplete="new-password" minlength="8" required')}
      ${errBox}
      <button class="btn-gold" type="submit">Skapa konto</button>
    </form>
    <p class="auth-alt">Det räcker med användarnamn och lösenord. Du loggar in direkt.</p>
  </div>`;
}

function viewVerify() {
  return `<div class="auth-card">
    <span class="label">Ett steg kvar</span>
    <h2>Skriv in koden</h2>
    <p class="auth-alt">Vi har skickat en <b>6-siffrig kod</b> till <b>${esc(kstate.email)}</b>. Kolla skräpposten om den inte syns.</p>
    <form id="verify-form" novalidate>
      <div class="otp" id="otp">${Array.from({ length: 6 }, (_, i) =>
        `<input inputmode="numeric" maxlength="1" pattern="[0-9]" aria-label="Siffra ${i + 1}" ${i === 0 ? 'autocomplete="one-time-code"' : ''}>`).join('')}</div>
      ${errBox}
      ${kstate.notice ? `<p class="form-ok">${esc(kstate.notice)}</p>` : ''}
      <button class="btn-gold" type="submit">Aktivera kontot</button>
    </form>
    <p class="auth-alt">Fick du ingen kod? <button class="linkbtn" id="resend">Skicka en ny</button></p>
  </div>`;
}

function favLink(f) {
  if (f.kind === 'team') {
    const [comp, id] = f.ref.split(':');
    return `?club=${encodeURIComponent(id)}&comp=${encodeURIComponent(comp)}`;
  }
  const [slug, id] = f.ref.split(':');
  return `?player=${encodeURIComponent(id)}&slug=${encodeURIComponent(slug)}&team=${encodeURIComponent(f.extra?.team ?? '')}`;
}

// ---------- Vänner ----------

async function friendsHtml() {
  const me = AUTH.user.id;
  const { data: rels } = await sb.from('friendships').select('id, requester, addressee, status').order('created_at');
  const list = rels ?? [];
  const ids = [...new Set(list.flatMap(r => [r.requester, r.addressee]).filter(id => id !== me))];
  const { data: profs } = ids.length ? await sb.from('profiles').select('id, username').in('id', ids) : { data: [] };
  const name = id => (profs ?? []).find(p => p.id === id)?.username ?? 'Okänd';
  const other = r => (r.requester === me ? r.addressee : r.requester);
  const friends = list.filter(r => r.status === 'accepted');
  const incoming = list.filter(r => r.status === 'pending' && r.addressee === me);
  const outgoing = list.filter(r => r.status === 'pending' && r.requester === me);
  const avatar = n => `<span class="fr-av">${esc(n.slice(0, 2).toUpperCase())}</span>`;

  return `<section class="sec" id="friends"><div class="sec-head"><h2>Vänner</h2><span>${friends.length} ${friends.length === 1 ? 'vän' : 'vänner'}</span></div>
    <form id="friend-form" class="fr-add" novalidate>
      <label class="f"><span>Lägg till vän med användarnamn</span><input id="friend-name" autocomplete="off" maxlength="20"></label>
      <button class="btn-gold" type="submit">Skicka förfrågan</button>
      <p class="note" id="friend-msg" role="status"></p>
    </form>
    ${incoming.length ? `<h3 class="sb-h">Förfrågningar till dig</h3><div class="fr-list">${incoming.map(r => `<div class="fr">
      ${avatar(name(other(r)))}<b>${esc(name(other(r)))}</b><small>vill bli din vän</small>
      <div class="fr-btns"><button class="btn-mini gold" data-friend-accept="${r.id}">Acceptera</button><button class="btn-mini" data-friend-remove="${r.id}">Neka</button></div>
    </div>`).join('')}</div>` : ''}
    ${friends.length ? `<div class="fr-list">${friends.map(r => `<div class="fr" data-fr="${other(r)}">
      ${avatar(name(other(r)))}<b>${esc(name(other(r)))}</b>
      <div class="fr-btns"><a class="btn-mini gold" href="chatt.html?dm=${other(r)}">Chatta</a><button class="btn-mini" data-friend-bets="${other(r)}" data-friend-label="${esc(name(other(r)))}">Se bets</button><button class="btn-mini" data-friend-remove="${r.id}" data-confirm-text="Ta bort">Ta bort</button></div>
      <div class="fr-bets" hidden></div>
    </div>`).join('')}</div>` : '<p class="note">Du har inga vänner här än. Skriv en väns användarnamn ovan för att skicka en förfrågan.</p>'}
    ${outgoing.length ? `<h3 class="sb-h">Skickade förfrågningar</h3><div class="fr-list">${outgoing.map(r => `<div class="fr">
      ${avatar(name(other(r)))}<b>${esc(name(other(r)))}</b><small>väntar på svar</small>
      <div class="fr-btns"><button class="btn-mini" data-friend-remove="${r.id}">Ångra</button></div>
    </div>`).join('')}</div>` : ''}
    <p class="note">Vänner kan se varandras sparade bets.</p>
  </section>`;
}

const RESULT_SHORT = { won: 'Vann', lost: 'Förlorade', live: 'Pågår', open: 'Väntar', unknown: 'Okänt', void: 'Struken' };

async function friendBetsHtml(userId) {
  const { data } = await sb.from('saved_bets').select('match_id, pick, label, match_label, kickoff, odds, result, p').eq('user_id', userId)
    .order('kickoff', { ascending: false }).limit(30);
  if (!data?.length) return '<p class="note">Inga sparade bets än.</p>';
  return data.map(b => {
    const m = findMatch(b.match_id);
    const res = b.result ?? betResult(m, b.pick);
    return `<div class="fr-bet r-${res}" ${m ? `role="button" tabindex="0" data-match="${m.id}"` : ''}>
      <span class="sb-res">${RESULT_SHORT[res] ?? res}</span>
      <span class="fb-main"><b>${esc(b.label)}</b><small>${esc(b.match_label)}${b.kickoff ? ' · ' + esc(dayText(b.kickoff)) : ''}</small></span>
      ${b.odds ? `<em>${Number(b.odds).toFixed(2)}</em>` : b.p != null ? `<em>${pct(Number(b.p))}</em>` : ''}
    </div>`;
  }).join('');
}

async function addFriend(e) {
  e.preventDefault();
  const input = $('#friend-name'), msg = $('#friend-msg'), btn = e.submitter;
  const wanted = input.value.trim();
  if (!/^[A-Za-z0-9_.-]{3,20}$/.test(wanted)) { msg.textContent = 'Skriv ett användarnamn (3–20 tecken).'; return; }
  btn.disabled = true;
  const { data: prof } = await sb.from('profiles').select('id, username').ilike('username', wanted.replace(/[%_\\]/g, '\\async function viewAccount() {')).maybeSingle();
  if (!prof) { btn.disabled = false; msg.textContent = `Hittade ingen med användarnamnet "${wanted}".`; return; }
  if (prof.id === AUTH.user.id) { btn.disabled = false; msg.textContent = 'Det där är ju du själv.'; return; }
  const { error } = await sb.from('friendships').insert({ addressee: prof.id });
  btn.disabled = false;
  if (error) {
    msg.textContent = /duplicate|unique/i.test(error.message) ? `Ni är redan vänner, eller så finns det redan en förfrågan mellan dig och ${prof.username}.` : 'Kunde inte skicka förfrågan: ' + error.message;
    return;
  }
  render();
}

async function viewAccount() {
  const favs = [...AUTH.favs.values()];
  const teams = favs.filter(f => f.kind === 'team'), players = favs.filter(f => f.kind === 'player');
  const { data: mine } = await sb.from('boosts').select('id, book, title, odds, ends').eq('created_by', AUTH.user.id).order('created_at', { ascending: false }).limit(20);
  const list = (items, empty) => items.length
    ? `<div class="favlist">${items.map(f => `<a class="favitem" href="index.html${favLink(f)}">
        ${f.extra?.logo ? `<img src="${esc(f.extra.logo)}" alt="">` : '<span class="star">★</span>'}<span>${esc(f.label)}</span><small>${esc(f.extra?.sub ?? '')}</small></a>`).join('')}</div>`
    : `<p class="note">${empty}</p>`;
  return `<div class="acc-head">
      <div class="acc-avatar">${esc((AUTH.profile?.username ?? '?').slice(0, 2).toUpperCase())}</div>
      <div><span class="label">Inloggad som</span><h2>${esc(AUTH.profile?.username ?? '')}</h2><small>${esc(AUTH.user.email)}</small></div>
      <button class="btn-ghost" id="logout">Logga ut</button>
    </div>
    <a class="sb-link member-link${AUTH.premium ? ' on' : ''}" href="medlem.html"><b>${AUTH.premium ? '★ Medlem' : 'Bli medlem'}</b>
      <span>${AUTH.premium ? (AUTH.subscription?.status === 'owner' ? 'Ägare · gratis medlemskap' : 'Aktivt medlemskap') : '9 kr/mån · Dagens värde, värdebets och boostar'}</span><i>→</i></a>
    ${await friendsHtml()}
    <a class="sb-link" href="sparade.html"><b>Sparade bets</b><span>${AUTH.saved.size} sparade · se resultat och träffprocent</span><i>→</i></a>
    <section class="sec"><div class="sec-head"><h2>Favoritlag</h2><span>${teams.length}</span></div>
      ${list(teams, 'Tryck på ☆ på en klubbsida för att spara laget här.')}</section>
    <section class="sec"><div class="sec-head"><h2>Favoritspelare</h2><span>${players.length}</span></div>
      ${list(players, 'Tryck på ☆ i en spelarprofil för att spara spelaren här.')}</section>
    <section class="sec"><div class="sec-head"><h2>Mina boostar</h2><span>${mine?.length ?? 0}</span></div>
      ${mine?.length ? `<div class="favlist">${mine.map(b => `<a class="favitem" href="boostar.html"><span class="b-book">${esc(b.book)}</span><span>${esc(b.title ?? '')}</span><small>@ ${Number(b.odds).toFixed(2)}</small></a>`).join('')}</div>`
        : '<p class="note">Boostar du lägger upp på sidan Boostar syns här.</p>'}</section>`;
}

// ---------- Ritning och formulär ----------

async function render() {
  await AUTH.ready;
  if (!sb) { $('#main').innerHTML = '<p class="empty">Inloggningen kunde inte laddas. Ladda om sidan.</p>'; return; }
  if (AUTH.user && kstate.view !== 'verify') kstate.view = 'account';
  if (!AUTH.user && kstate.view === 'account') kstate.view = 'login';
  const html = kstate.view === 'signup' ? viewSignup() : kstate.view === 'verify' ? viewVerify() : kstate.view === 'account' ? await viewAccount() : viewLogin();
  $('#main').innerHTML = html;
  wire();
}

function otpValue() {
  return [...document.querySelectorAll('#otp input')].map(i => i.value).join('');
}

function wire() {
  $('#login-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.submitter;
    const id = $('#l-id').value.trim(), pw = $('#l-pw').value;
    if (!id || !pw) return showErr('Fyll i användarnamn eller mejl och lösenord.');
    busy(btn, true, 'Loggar in…');
    let email = id;
    if (!id.includes('@')) {
      const { data } = await sb.rpc('email_for_login', { login: id });
      if (!data) { busy(btn, false, 'Logga in'); return showErr('Fel användarnamn, mejl eller lösenord.'); }
      email = data;
    }
    const { error } = await withTimeout(sb.auth.signInWithPassword({ email, password: pw }));
    if (error && /not confirmed/i.test(error.message) && AUTH_NO_EMAIL) {
      busy(btn, false, 'Logga in');
      return showErr('Kontot är inte aktiverat än. Be Simon aktivera det i Supabase, eller skapa ett nytt konto.');
    }
    if (error && /not confirmed/i.test(error.message)) {
      kstate.email = email;
      kstate.view = 'verify';
      await sb.auth.resend({ type: 'signup', email });
      kstate.notice = 'Kontot är inte aktiverat än. Vi har skickat en ny kod.';
      return render();
    }
    if (error) { busy(btn, false, 'Logga in'); return showErr(sv(error)); }
    done();
  });

  $('#signup-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.submitter;
    const username = $('#s-user').value.trim(), pw = $('#s-pw').value;
    // Supabase kräver en mejladress, så kontot får en intern adress som aldrig tar emot mejl.
    // Inloggning sker med användarnamnet (RPC email_for_login slår upp adressen).
    const email = username.toLowerCase() + '@konto.betvalue.github.io';
    if (!/^[A-Za-z0-9_.-]{3,20}$/.test(username)) return showErr('Användarnamnet ska vara 3–20 tecken: bokstäver a–z, siffror, punkt, bindestreck eller understreck.');
    if (pw.length < 8) return showErr('Lösenordet måste vara minst 8 tecken.');
    if (pw !== $('#s-pw2').value) return showErr('Lösenorden är inte lika.');
    busy(btn, true, 'Skapar konto…');
    const { data: taken } = await sb.rpc('username_taken', { name: username });
    if (taken) { busy(btn, false, 'Skapa konto'); return showErr('Användarnamnet är upptaget. Välj ett annat.'); }
    const { data, error } = await withTimeout(sb.auth.signUp({ email, password: pw, options: { data: { username } } }));
    if (error) { busy(btn, false, 'Skapa konto'); return showErr(sv(error)); }
    // Finns mejlen redan returnerar Supabase en användare utan identiteter.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      busy(btn, false, 'Skapa konto');
      return showErr('Användarnamnet är upptaget. Välj ett annat.');
    }
    // Utan mejlbekräftelse är man inloggad direkt. Annars (om bekräftelse slås på igen) visas kodsteget.
    if (data.session) { done(); return; }
    kstate.email = email;
    kstate.notice = '';
    kstate.view = 'verify';
    render();
  });

  const boxes = [...document.querySelectorAll('#otp input')];
  boxes.forEach((inp, i) => {
    inp.addEventListener('input', () => {
      const digits = inp.value.replace(/\D/g, '');
      if (digits.length > 1) { // inklistrad kod
        digits.slice(0, 6).split('').forEach((d, j) => { if (boxes[j]) boxes[j].value = d; });
        boxes[Math.min(digits.length, 6) - 1]?.focus();
      } else {
        inp.value = digits;
        if (digits && boxes[i + 1]) boxes[i + 1].focus();
      }
      if (otpValue().length === 6) $('#verify-form').requestSubmit();
    });
    inp.addEventListener('keydown', e => { if (e.key === 'Backspace' && !inp.value && boxes[i - 1]) boxes[i - 1].focus(); });
  });
  boxes[0]?.focus();

  $('#verify-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('#verify-form .btn-gold');
    const token = otpValue();
    if (token.length !== 6) return showErr('Skriv in alla 6 siffrorna.');
    busy(btn, true, 'Kontrollerar…');
    let { error } = await withTimeout(sb.auth.verifyOtp({ email: kstate.email, token, type: 'email' }));
    if (error && error.message !== 'timeout') ({ error } = await withTimeout(sb.auth.verifyOtp({ email: kstate.email, token, type: 'signup' })));
    if (error) { busy(btn, false, 'Aktivera kontot'); boxes.forEach(b => { b.value = ''; }); boxes[0]?.focus(); return showErr(sv(error)); }
    kstate.view = 'account';
    done();
  });

  $('#resend')?.addEventListener('click', async () => {
    const { error } = await sb.auth.resend({ type: 'signup', email: kstate.email });
    kstate.notice = error ? '' : 'En ny kod är skickad.';
    if (error) showErr(sv(error)); else render();
  });

  $('#friend-form')?.addEventListener('submit', addFriend);

  $('#logout')?.addEventListener('click', async () => {
    await sb.auth.signOut();
    kstate.view = 'login';
    render();
  });
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-kview]');
  if (!t) return;
  kstate.view = t.dataset.kview;
  render();
});
document.addEventListener('auth:changed', () => { if (kstate.view !== 'verify') render(); });

// Vänknappar: acceptera, neka/ta bort/ångra och visa en väns bets.
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-friend-accept],[data-friend-remove],[data-friend-bets]');
  if (!t) return;
  e.preventDefault();
  if (t.dataset.friendAccept) {
    t.disabled = true;
    await sb.from('friendships').update({ status: 'accepted' }).eq('id', t.dataset.friendAccept);
    render();
  } else if (t.dataset.friendRemove) {
    // "Ta bort" på en vän kräver ett andra klick, så att man inte tar bort någon av misstag.
    if (t.dataset.confirmText && !t.classList.contains('armed')) {
      t.classList.add('armed');
      t.textContent = 'Säker? Tryck igen';
      setTimeout(() => { t.classList.remove('armed'); t.textContent = t.dataset.confirmText; }, 4000);
      return;
    }
    t.disabled = true;
    await sb.from('friendships').delete().eq('id', t.dataset.friendRemove);
    render();
  } else {
    const box = t.closest('.fr').querySelector('.fr-bets');
    if (!box.hidden) { box.hidden = true; t.textContent = 'Se bets'; return; }
    box.hidden = false;
    t.textContent = 'Dölj bets';
    box.innerHTML = '<div class="loading"><span class="spin"></span>Hämtar bets…</div>';
    box.innerHTML = await friendBetsHtml(t.dataset.friendBets);
  }
});


boot('konto', render);
