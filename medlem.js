// Medlemskap: ett konto kostar 9 kr/mån och ger allt.
// Utloggad → skapa konto. Inloggad utan betalning → kassan. Betalt → allt är upplåst.
//
// Betalningen körs i TESTLÄGE (inga riktiga pengar) tills BetValue har ett eget Stripe-konto.
// Då sätts STRIPE_LINK till Payment Link-adressen och payments_test_mode till false i Supabase.
const STRIPE_LINK = '';
const STRIPE_PORTAL = ''; // Stripes kundportal, där man avslutar prenumerationen

const PERKS = [
  ['★', 'Dagens bästa bet', 'Guldkortet med dagens starkaste spel, varje dag.'],
  ['＋', 'Enskilda spel och bet builders', 'Modellens bästa spel, med lägsta odds för värde.'],
  ['⚽', 'Målskyttar', 'Chans att göra mål för nyckelspelarna i varje match.'],
  ['%', 'Värdebets', 'Odds som är högre än vad statistiken säger att de borde vara.'],
  ['⚡', 'Boostar', 'Boost-kalkylatorn och de rekommenderade boostarna.'],
  ['💬', 'Vänner, chatt och sparade bets', 'Dela bets med kompisarna och följ hur de går.'],
];
const perksHtml = () => `<ul class="perks">${PERKS.map(([i, t, d]) => `<li><span>${i}</span><div><b>${esc(t)}</b><small>${esc(d)}</small></div></li>`).join('')}</ul>`;
const fmtDate = iso => new Date(iso).toLocaleDateString('sv-SE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ });

async function testMode() {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'payments_test_mode').maybeSingle();
  return data?.value === true;
}

function signedOutHtml() {
  return `<section class="plan">
    <div class="plan-price"><span class="label">BetValue Medlem</span><b>9 kr</b><small>per månad · avsluta när du vill</small></div>
    <a class="plan-proof" id="plan-proof" href="tips.html" hidden></a>
    <p class="plan-lead">Ett konto kostar <b>9 kr i månaden</b> och ger dig <b>allt</b> på BetValue:</p>
    ${perksHtml()}
    <div class="plan-action">
      <a class="btn-gold" href="konto.html?tab=signup&next=${encodeURIComponent(location.pathname)}">Skapa konto – 9 kr/mån</a>
      <a class="linkbtn" href="konto.html?next=${encodeURIComponent(location.pathname)}">Har du redan ett konto? Logga in</a>
    </div>
  </section><div class="track-slot" id="track-slot"></div>`;
}

function checkoutHtml(test) {
  return `<section class="checkout">
    <div class="co-head"><span class="label">Steg 2 av 2 · Betalning</span><h2>Slutför ditt konto</h2>
      ${test ? '<span class="test-badge">TESTLÄGE – inga riktiga pengar dras</span>' : ''}</div>
    <div class="co-order">
      <div class="co-row"><span>BetValue Medlem</span><b>9,00 kr</b></div>
      <div class="co-row sub"><span>Varje månad, avsluta när du vill</span><span>moms ingår</span></div>
      <div class="co-row total"><span>Att betala idag</span><b>9,00 kr</b></div>
    </div>
    ${perksHtml()}
    <label class="age"><input type="checkbox" id="age18"> Jag är 18 år eller äldre</label>
    <button class="btn-gold" id="pay">${test ? 'Betala 9 kr (test)' : 'Till betalning – 9 kr/mån'}</button>
    <p class="note" id="pay-msg">${test
      ? 'Det här är en testkassa. Inget kort behövs och inga pengar dras – kontot blir medlem i 30 dagar så att vi kan testa hur allt fungerar.'
      : 'Du skickas till Stripe för att betala säkert med kort.'}</p>
  </section><div class="track-slot" id="track-slot"></div>`;
}

function memberHtml(test) {
  const sub = AUTH.subscription;
  const owner = sub?.status === 'owner';
  return `<section class="checkout done">
    <div class="done-check">✓</div>
    <h2>Du har allt upplåst</h2>
    <p>${owner ? 'Du är ägare av BetValue och har allt gratis.'
      : `Medlemskapet är aktivt${sub?.current_period_end ? ' till <b>' + esc(fmtDate(sub.current_period_end)) + '</b>' : ''}${test ? ' (testläge)' : ''}.`}</p>
    <div class="gate-btns">
      <a class="btn-gold" href="dagens-varde.html">Till Dagens värde</a>
      <a class="btn-ghost" href="boostar.html">Boostar</a>
    </div>
    ${!owner && test ? '<button class="linkbtn" id="cancel-test">Avsluta medlemskapet (test)</button>' : ''}
    ${!owner && !test && STRIPE_PORTAL ? `<a class="linkbtn" href="${STRIPE_PORTAL}" target="_blank" rel="noopener">Hantera eller avsluta prenumerationen</a>` : ''}
  </section>`;
}

async function render() {
  await AUTH.ready;
  if (!AUTH.user) { $('#main').innerHTML = signedOutHtml(); fillTrack('#track-slot'); return; }
  const test = await testMode();
  if (AUTH.premium) {
    $('#main').innerHTML = memberHtml(test);
    $('#cancel-test')?.addEventListener('click', async e => {
      e.currentTarget.disabled = true;
      await sb.rpc('cancel_test_subscription');
      await loadProfile();
      render();
    });
    return;
  }
  $('#main').innerHTML = checkoutHtml(test);
  fillTrack('#track-slot');
  $('#pay').addEventListener('click', async e => {
    const msg = $('#pay-msg');
    if (!$('#age18').checked) { msg.textContent = 'Du måste vara 18 år eller äldre för att bli medlem.'; return; }
    if (!test) {
      if (!STRIPE_LINK) { msg.textContent = 'Betalningen är inte öppen än. Titta in snart igen!'; return; }
      location.href = `${STRIPE_LINK}?client_reference_id=${encodeURIComponent(AUTH.user.id)}`;
      return;
    }
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Betalar…';
    const { error } = await sb.rpc('activate_test_subscription');
    if (error) { btn.disabled = false; btn.textContent = 'Betala 9 kr (test)'; msg.textContent = 'Något gick fel: ' + error.message; return; }
    await loadProfile();
    paintAccountLink();
    render();
  });
}

document.addEventListener('auth:changed', () => render());
boot('medlem', render).then(startLive);
