// Kontosidan: logga in, skapa konto (med 6-siffrig kod via mejl första gången) och Mitt konto.

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
      ${field('l-id', 'Användarnamn eller mejl', 'text', 'autocomplete="username" required')}
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
      ${field('s-email', 'Mejl', 'email', 'autocomplete="email" required')}
      ${field('s-user', 'Användarnamn', 'text', 'autocomplete="nickname" minlength="3" maxlength="20" required')}
      <p class="hint-sm">3–20 tecken: bokstäver a–z, siffror, punkt, bindestreck eller understreck.</p>
      ${field('s-pw', 'Lösenord', 'password', 'autocomplete="new-password" minlength="8" required')}
      ${field('s-pw2', 'Upprepa lösenordet', 'password', 'autocomplete="new-password" minlength="8" required')}
      ${errBox}
      <button class="btn-gold" type="submit">Skapa konto</button>
    </form>
    <p class="auth-alt">Vi skickar en 6-siffrig kod till din mejl som du skriver in för att aktivera kontot.</p>
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

const RESULT_TEXT = { won: 'Vann', lost: 'Förlorade', live: 'Pågår', open: 'Väntar', unknown: 'Okänt', void: 'Struken' };

// Sparade bets med resultat. Resultatet sparas på raden när matchen är spelad, så det finns kvar
// även när matchen försvunnit ur datan.
async function savedBetsHtml() {
  const { data: rows } = await sb.from('saved_bets').select('*').order('kickoff', { ascending: false }).limit(200);
  const bets = (rows ?? []).map(r => {
    const m = findMatch(r.match_id);
    const res = r.result ?? betResult(m, r.pick);
    if (!r.result && (res === 'won' || res === 'lost')) sb.from('saved_bets').update({ result: res }).eq('id', r.id).then(() => {});
    return { ...r, m, res };
  });
  const settled = bets.filter(b => b.res === 'won' || b.res === 'lost');
  const won = settled.filter(b => b.res === 'won').length;
  const withOdds = settled.filter(b => b.odds);
  const units = withOdds.reduce((t, b) => t + (b.res === 'won' ? Number(b.odds) - 1 : -1), 0);
  const isOpen = b => b.res === 'open' || b.res === 'live';
  const upcoming = bets.filter(isOpen).sort((a, b) => String(a.kickoff).localeCompare(String(b.kickoff)));
  const done = bets.filter(b => !isOpen(b));

  const card = b => `<div class="sbet r-${b.res}" ${b.m ? `role="button" tabindex="0" data-match="${b.m.id}"` : ''}>
      <div class="sb-top"><span class="sb-res">${RESULT_TEXT[b.res] ?? b.res}</span><small>${esc(b.comp ?? '')}${b.kickoff ? ' · ' + esc(dayText(b.kickoff)) + ' ' + esc(clock(b.kickoff)) : ''}</small></div>
      <div class="sb-match">${b.m ? crest(b.m.home) : ''}<span>${esc(b.match_label)}</span>${b.m ? crest(b.m.away) : ''}${b.m?.score && b.res !== 'open' ? `<b class="sb-score">${b.m.score.h}–${b.m.score.a}</b>` : ''}</div>
      <div class="sb-pick">${esc(b.label)}</div>
      <div class="sb-nums">
        ${b.p != null ? `<span>Vår chans <b>${pct(Number(b.p))}</b></span>` : ''}
        ${b.odds ? `<span>Odds <b>${Number(b.odds).toFixed(2)}</b>${b.book ? ' hos ' + esc(b.book) : ''}</span>` : ''}
        <button class="linkbtn" data-unsave="${b.id}">Ta bort</button>
      </div>
    </div>`;

  if (!bets.length) {
    return `<section class="sec"><div class="sec-head"><h2>Mina bets</h2><span>0 sparade</span></div>
      <p class="note">Tryck på <b>＋ Spara</b> på ett bet under Dagens värde, i en match eller på en boost, så hamnar det här.</p></section>`;
  }
  return `<section class="sec"><div class="sec-head"><h2>Mina bets</h2><span>${bets.length} sparade</span></div>
    <div class="sb-stats">
      <div><b>${bets.length}</b><small>Sparade</small></div>
      <div><b>${upcoming.length}</b><small>Väntar</small></div>
      <div class="w"><b>${won}</b><small>Vann</small></div>
      <div class="l"><b>${settled.length - won}</b><small>Förlorade</small></div>
      <div><b>${settled.length ? Math.round((won / settled.length) * 100) + '%' : '–'}</b><small>Träffprocent</small></div>
      <div class="${units >= 0 ? 'w' : 'l'}"><b>${withOdds.length ? (units >= 0 ? '+' : '') + units.toFixed(2).replace('.', ',') : '–'}</b><small>Enheter</small></div>
    </div>
    ${upcoming.length ? `<h3 class="sb-h">Kommande</h3><div class="cgrid">${upcoming.map(card).join('')}</div>` : ''}
    ${done.length ? `<h3 class="sb-h">Avgjorda</h3><div class="cgrid">${done.map(card).join('')}</div>` : ''}
    <p class="note">Enheter räknar som om du satsat 1 enhet på varje avgjort bet som har odds. Målskyttebets kan vi inte rätta automatiskt.</p>
  </section>`;
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
    ${await savedBetsHtml()}
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
    const { error } = await sb.auth.signInWithPassword({ email, password: pw });
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
    const email = $('#s-email').value.trim(), username = $('#s-user').value.trim(), pw = $('#s-pw').value;
    if (!/^\S+@\S+\.\S+$/.test(email)) return showErr('Skriv en giltig mejladress.');
    if (!/^[A-Za-z0-9_.-]{3,20}$/.test(username)) return showErr('Användarnamnet ska vara 3–20 tecken: bokstäver a–z, siffror, punkt, bindestreck eller understreck.');
    if (pw.length < 8) return showErr('Lösenordet måste vara minst 8 tecken.');
    if (pw !== $('#s-pw2').value) return showErr('Lösenorden är inte lika.');
    busy(btn, true, 'Skapar konto…');
    const { data: taken } = await sb.rpc('username_taken', { name: username });
    if (taken) { busy(btn, false, 'Skapa konto'); return showErr('Användarnamnet är upptaget. Välj ett annat.'); }
    const { data, error } = await sb.auth.signUp({ email, password: pw, options: { data: { username } } });
    if (error) { busy(btn, false, 'Skapa konto'); return showErr(sv(error)); }
    // Finns mejlen redan returnerar Supabase en användare utan identiteter.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      busy(btn, false, 'Skapa konto');
      return showErr('Det finns redan ett konto med den mejladressen. Logga in i stället.');
    }
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
    let { error } = await sb.auth.verifyOtp({ email: kstate.email, token, type: 'email' });
    if (error) ({ error } = await sb.auth.verifyOtp({ email: kstate.email, token, type: 'signup' }));
    if (error) { busy(btn, false, 'Aktivera kontot'); boxes.forEach(b => { b.value = ''; }); boxes[0]?.focus(); return showErr(sv(error)); }
    kstate.view = 'account';
    done();
  });

  $('#resend')?.addEventListener('click', async () => {
    const { error } = await sb.auth.resend({ type: 'signup', email: kstate.email });
    kstate.notice = error ? '' : 'En ny kod är skickad.';
    if (error) showErr(sv(error)); else render();
  });

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
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-unsave]');
  if (!t) return;
  e.stopPropagation();
  const { data } = await sb.from('saved_bets').delete().eq('id', t.dataset.unsave).select('match_id, pick');
  for (const r of data ?? []) AUTH.saved.delete(r.match_id + '|' + r.pick);
  render();
}, true);

boot('konto', render);
