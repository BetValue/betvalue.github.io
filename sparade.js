// Sparade bets: alla bets man tryckt ＋ Spara på, med automatisk rättning.

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
        <a class="linkbtn share-link" href="chatt.html?share=${b.id}">Dela i chatt</a>
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


async function render() {
  await AUTH.ready;
  if (!AUTH.user) {
    $('#main').innerHTML = `<div class="locked"><b>Logga in för att se dina sparade bets</b>
      <span>Tryck på ＋ Spara på ett bet så hamnar det här, rättat när matchen är slut.</span>
      <a class="btn-gold" style="max-width:260px;text-decoration:none;text-align:center" href="konto.html?next=${encodeURIComponent(location.pathname)}">Logga in</a></div>`;
    return;
  }
  $('#main').innerHTML = await savedBetsHtml();
}

document.addEventListener('click', async e => {
  const t = e.target.closest('[data-unsave]');
  if (!t) return;
  e.stopPropagation();
  const { data } = await sb.from('saved_bets').delete().eq('id', t.dataset.unsave).select('match_id, pick');
  for (const r of data ?? []) AUTH.saved.delete(r.match_id + '|' + r.pick);
  render();
}, true);
document.addEventListener('auth:changed', () => render());

boot('sparade', render);
