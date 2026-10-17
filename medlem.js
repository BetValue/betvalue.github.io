// Bli medlem: 9 kr/mån via Stripe. Betalningen görs på Stripes egen sida (Payment Link);
// webhooken supabase/functions/stripe-webhook aktiverar medlemskapet när betalningen gått igenom.
//
// STRIPE_LINK sätts till BetValues Payment Link när Stripe-kontot finns
// (t.ex. https://buy.stripe.com/test_… i testläge). Tom = betalningen är inte öppen än.
const STRIPE_LINK = '';
const STRIPE_PORTAL = ''; // Stripes kundportal, där man avslutar prenumerationen

const PERKS = [
  ['★', 'Dagens bästa bet', 'Guldkortet med dagens starkaste spel, varje dag.'],
  ['＋', 'Enskilda spel och bet builders', 'Modellens bästa spel, med lägsta odds för värde.'],
  ['⚽', 'Målskyttar', 'Chans att göra mål för nyckelspelarna i varje match.'],
  ['%', 'Värdebets', 'Odds som är högre än vad statistiken säger att de borde vara.'],
  ['⚡', 'Boostar', 'Boost-kalkylatorn och de rekommenderade boostarna.'],
];

async function render() {
  await AUTH.ready;
  const user = AUTH.user;
  const member = AUTH.premium;
  const payUrl = STRIPE_LINK && user ? `${STRIPE_LINK}?client_reference_id=${encodeURIComponent(user.id)}` : '';

  let action;
  if (!user) {
    action = `<a class="btn-gold" href="konto.html?next=${encodeURIComponent(location.pathname)}">Skapa konto eller logga in först</a>`;
  } else if (member) {
    action = `<div class="member-ok">✓ Du är medlem${AUTH.subscription?.status === 'owner' ? ' (ägare)' : ''}</div>
      ${STRIPE_PORTAL && AUTH.subscription?.status !== 'owner' ? `<a class="btn-ghost" href="${STRIPE_PORTAL}" target="_blank" rel="noopener">Hantera eller avsluta prenumerationen</a>` : ''}`;
  } else {
    action = `<label class="age"><input type="checkbox" id="age18"> Jag är 18 år eller äldre</label>
      <button class="btn-gold" id="pay" ${payUrl ? '' : 'disabled'}>${payUrl ? 'Bli medlem – 9 kr/mån' : 'Betalningen öppnar snart'}</button>
      <p class="note" id="pay-msg">${payUrl ? 'Du skickas till Stripe för att betala säkert med kort. Avsluta när du vill.' : 'Vi håller på att koppla in betalningen. Titta in snart igen!'}</p>`;
  }

  $('#main').innerHTML = `<section class="plan">
      <div class="plan-price"><span class="label">BetValue Medlem</span><b>9 kr</b><small>per månad · avsluta när du vill</small></div>
      <ul class="perks">${PERKS.map(([i, t, d]) => `<li><span>${i}</span><div><b>${esc(t)}</b><small>${esc(d)}</small></div></li>`).join('')}</ul>
      <div class="plan-action">${action}</div>
    </section>
    <p class="note plan-fine">Matcher, tabeller, startelvor, spelar- och klubbstatistik, chatt och vänner är gratis för alla med konto.
      Statistiken är ingen garanti – spela aldrig för mer än du har råd att förlora. 18+ · <a href="https://www.stodlinjen.se" target="_blank" rel="noopener">Stödlinjen.se</a></p>`;

  $('#pay')?.addEventListener('click', () => {
    if (!$('#age18').checked) { $('#pay-msg').textContent = 'Du måste vara 18 år för att bli medlem.'; return; }
    location.href = payUrl;
  });
}

document.addEventListener('auth:changed', () => render());
boot('medlem', render);
