// Om oss: vad BetValue är. Innehållet står i om.html; här fylls siffror i och knapparna
// anpassas efter om man är inloggad/medlem.

async function render() {
  const players = await fetch('data/players.json?d=' + new Date().toISOString().slice(0, 10))
    .then(r => (r.ok ? r.json() : null)).then(j => j?.players?.length).catch(() => null);
  if (players) $('#fact-players').textContent = (Math.floor(players / 100) * 100).toLocaleString('sv-SE') + '+';

  const { picks = [] } = await loadTrack();
  const since = Date.now() - 30 * 864e5;
  const done = picks.filter(p => (p.result === 'won' || p.result === 'lost') && Date.parse(p.utc) > since);
  if (done.length) $('#fact-hit').textContent = Math.round((done.filter(p => p.result === 'won').length / done.length) * 100) + '%';
  else $('#fact-hit').closest('div').hidden = true;
  fillTeaser('#teaser-slot');

  await AUTH.ready;
  const cta = AUTH.premium
    ? '<a class="btn-gold" href="dagens-varde.html">Till Dagens värde</a><a class="btn-ghost" href="tips.html">Se hur det har gått</a>'
    : AUTH.user
      ? '<a class="btn-gold" href="medlem.html">Slutför medlemskapet – 9 kr/mån</a><a class="btn-ghost" href="tips.html">Se hur det har gått</a>'
      : null;
  if (cta) document.querySelectorAll('[data-cta]').forEach(el => { el.innerHTML = cta; });
}

document.addEventListener('auth:changed', () => render());
boot('om', render).then(startLive);
