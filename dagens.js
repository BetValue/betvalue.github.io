// Dagens värde: dagens spel enligt vår analysmetod (picks.js) –
// ⭐ bästa (hög chans + positivt EV), säkraste, värdespel, spekulativa, bet builders runt 2–3 i odds,
// bra singlar, NO BET/undvik, matcherna i korthet och alla spel per match.

const dstate = { day: null };

// Dagar framåt som har kommande matcher med modell.
function upcomingDays() {
  const ms = everyMatch().filter(m => UPCOMING.has(m.status) && (m.model || m.values.length));
  return [...new Set(ms.map(m => dayKey(m.utc)))].filter(d => d >= todayKey()).sort().slice(0, 4);
}

function dayMatches() {
  return everyMatch().filter(m => UPCOMING.has(m.status) && dayKey(m.utc) === dstate.day && m.model);
}

// Kort motivering till dagens bästa bet.
function reasons(m, key) {
  const out = [];
  const side = /^(home|g:dc-1x|g:dnb-h|g:ah-h|g:h-|g:cs-h|g:wtn-h)/.test(key) ? 'home' : /^(away|g:dc-x2|g:dnb-a|g:ah-a|g:a-|g:cs-a|g:wtn-a)/.test(key) ? 'away' : null;
  if (m.model) out.push(`Förväntade mål ${m.model.xg[0].toFixed(1).replace('.', ',')} – ${m.model.xg[1].toFixed(1).replace('.', ',')}`);
  for (const [t, s] of [[m.home, 'home'], [m.away, 'away']]) {
    const form = m.comp.form[t.id];
    if (form?.length && (!side || side === s)) out.push(`${t.short}: ${form.slice(0, 5).map(f => f.r).join(' ')} senaste`);
  }
  const target = side === 'away' ? m.home : side === 'home' ? m.away : null;
  const d = target && defence(m.comp, target.id);
  if (d) out.push(`${target.short} släpper in ${d.per.toFixed(1).replace('.', ',')} mål/match (${ord(d.rank)} bästa försvar)`);
  return out.slice(0, 4);
}

function bestBet(x) {
  if (!x) return `<section class="goldhero empty-hero"><span class="ribbon">NO BET</span><h2>Inga spel för dagen</h2><p>Inget spel har tillräckligt stöd i statistiken den här dagen.</p></section>`;
  const m = x.m, real = x.ev != null;
  // Utan spelbolagens odds vet vi inte vilket spel som har mest värde – då är det modellens starkaste spel.
  const [ribbon, title] = real ? ['⭐ Bäst värde', 'Dagens bästa bet'] : ['★ Starkast idag', 'Dagens starkaste spel'];
  return `<div class="goldhero" role="button" tabindex="0" data-match="${m.id}">
    <span class="shine" aria-hidden="true"></span>
    <div class="gh-top"><span class="ribbon">${ribbon}</span><span class="gh-meta">${esc(m.comp.name)} · ${dayText(m.utc)} ${clock(m.utc)}</span></div>
    <div class="gh-label">${title}</div>
    <div class="gh-match">${crest(m.home)}<span>${esc(m.home.short)}</span><i>vs</i><span>${esc(m.away.short)}</span>${crest(m.away)}</div>
    <h2 class="gh-pick">${esc(x.label)}</h2>
    <div class="gh-nums">
      ${real
        ? `<div><small>Odds</small><b>${odd(x.odds)}</b><em>hos ${esc(x.book)} · implicit ${pct(x.implied)}</em></div><div><small>EV</small><b>${signed(x.ev)}</b></div>`
        : `<div class="gh-key"><small>Lägsta odds</small><b>${odd(x.min)}</b><em>får du högre odds har spelet värde</em></div>`}
      <div><small>Vår chans</small><b>${pct(x.p)}</b><em>risk: ${esc(x.risk.toLowerCase())}</em></div>
    </div>
    <ul class="gh-why">${reasons(m, x.key).map(r => `<li>${esc(r)}</li>`).join('')}</ul>
    <p class="gh-wrong"><b>Kan gå fel:</b> ${esc(x.wrong)}</p>
    <div class="gh-save">${saveBtn(m, x.key, x.label, x.p, x.odds ?? null, x.book ?? null)}</div>
  </div>`;
}

function bbCard(b, star = false) {
  const m = b.m, weakest = b.legs.slice().sort((x, y) => x.p - y.p)[0];
  return `<div class="pcard bb-card${star ? ' gold' : ''}" role="button" tabindex="0" data-match="${m.id}">
    <div class="meta">${star ? '<span class="star-tag">⭐ Bästa bygget</span>' : ''}${m.comp.emblem ? `<img src="${esc(m.comp.emblem)}" alt="">` : ''}${esc(m.comp.name)} · ${clock(m.utc)}</div>
    <div class="vs">${crest(m.home)}<span>${esc(m.home.short)}</span><small>–</small><span>${esc(m.away.short)}</span>${crest(m.away)}</div>
    <ul class="legs">${b.legs.map(l => `<li>${esc(l.label)}<small>${pct(l.p)}</small></li>`).join('')}</ul>
    <div class="pc-nums"><div><small>Vår chans</small><b>${pct(b.p)}</b></div><div class="hl"><small>Lägsta odds</small><b>${odd(b.min)}</b></div></div>
    <p class="note">Svagaste benet: ${esc(weakest.label)} (${pct(weakest.p)}). ${esc(b.basis)}</p>
    ${saveBtn(m, b.key, b.label, b.p)}
  </div>`;
}

// Matchen i korthet: tabelläge, form, hemma-/bortaform, hörnor, kort och vad vi inte vet.
function matchInfo(m) {
  const st = m.extras?.stats, c = m.comp;
  const sh = standing(c, m.home.id), sa = standing(c, m.away.id);
  const v = (s, k) => (s?.venue?.n >= 3 ? s.venue[k] : s?.all?.[k]);
  const n1 = x => (x == null ? '–' : x.toFixed(1).replace('.', ','));
  const row = (label, a, b) => `<div class="mi-row"><span>${a}</span><small>${label}</small><span>${b}</span></div>`;
  return `<button class="minfo" data-match="${m.id}">
    <div class="mi-head">${crest(m.home)}<b>${esc(m.home.short)}</b><small>${clock(m.utc)}</small><b>${esc(m.away.short)}</b>${crest(m.away)}</div>
    ${row('Tabell', sh ? ord(sh.pos) : '–', sa ? ord(sa.pos) : '–')}
    ${row('Form', esc((c.form[m.home.id] ?? []).slice(0, 5).map(f => f.r).join(' ') || '–'), esc((c.form[m.away.id] ?? []).slice(0, 5).map(f => f.r).join(' ') || '–'))}
    ${row('Väntade mål', n1(m.model?.xg[0]), n1(m.model?.xg[1]))}
    ${st ? row('Mål hemma/borta', `${n1(v(st.home, 'gf'))}–${n1(v(st.home, 'ga'))}`, `${n1(v(st.away, 'gf'))}–${n1(v(st.away, 'ga'))}`)
      + row('Hörnor per match', n1(v(st.home, 'cf')), n1(v(st.away, 'cf')))
      + row('Gula kort', n1(v(st.home, 'yf')), n1(v(st.away, 'yf')))
      + row('Skott', n1(v(st.home, 'sf')), n1(v(st.away, 'sf'))) : ''}
    <p class="mi-note">${st ? `Hemmalagets hemmamatcher och bortalagets bortamatcher (senaste ${st.home.venue?.n ?? '–'} resp. ${st.away.venue?.n ?? '–'}). ` : ''}Startelvor ej bekräftade · skador och domare saknas i vår data · underlag: ${esc(m.model?.conf ?? '–')}</p>
  </button>`;
}

const section = (id, title, sub, body) => `<section class="sec" id="${id}"><div class="sec-head"><h2>${title}</h2><span>${sub}</span></div>${body}</section>`;
const rows = list => `<div class="mlist">${list.map(x => marketRow(x, { match: true })).join('')}</div>`;

async function render() {
  if (!(await requirePremium('Skapa konto för att se Dagens värde', 'Dagens bästa bet, säkraste spelen, värdespel, bet builders, hörnor, kort och spelarspel.'))) return;
  const days = upcomingDays();
  if (!days.includes(dstate.day)) dstate.day = days[0] ?? null;
  $('#days').innerHTML = days.map(d => {
    const p = dayParts(d);
    return `<button class="day${d === dstate.day ? ' active' : ''}${p.today ? ' today' : ''}" data-dday="${d}"><small>${esc(p.name)}</small><b>${p.date}</b></button>`;
  }).join('');

  const ms = dayMatches();
  const r = recommendations(ms);
  const noOdds = !r.hasOdds;
  const jump = [['bast', '⭐ Bästa'], ['sakrast', 'Säkraste'], ['varde', 'Värdespel'], ['spek', 'Spekulativa'], ['bygg', 'Bet builders'], ['undvik', 'Undvik'], ['matcher', 'Matcherna'], ['alla', 'Alla spel']];

  $('#main').innerHTML = `
    ${noOdds ? `<div class="odds-off"><b>Spelbolagens odds saknas just nu</b><span>Därför kan vi inte räkna EV, och ⭐ och värdespel kräver odds. Spelen visar <b>lägsta odds</b>: får du ett högre odds hos ditt spelbolag har spelet värde enligt vår modell.</span></div>` : ''}
    ${bestBet(r.best)}
    <nav class="jump" aria-label="Hoppa till">${jump.map(([id, t]) => `<a href="#${id}">${t}</a>`).join('')}</nav>
    ${glossary()}

    ${section('bast', '⭐ Bästa spelen', 'Hög chans och positivt EV', r.star.length ? rows(r.star.slice(0, 6))
      : `<p class="empty-small">${noOdds ? '⭐ kräver spelbolagens odds – EV går inte att räkna utan dem. Se de säkraste spelen nedan.' : 'Inga spel har både hög chans och positivt EV i dag. Det är okej – då spelar man mindre.'}</p>`)}

    ${section('sakrast', 'Säkraste spelen', 'Högst chans, även om värdet är lågt', r.safest.length ? rows(r.safest) : '<p class="empty-small">Inga spel med tillräckligt underlag.</p>')}

    ${section('varde', 'Värdespel', 'Positivt EV men högre risk', r.value.length ? rows(r.value.slice(0, 6))
      : `<p class="empty-small">${noOdds ? 'Värdespel kräver spelbolagens odds.' : 'Inga tydliga värdespel i dag.'}</p>`)}

    ${section('spek', 'Spekulativa', 'Lägre chans, men statistiken pekar åt rätt håll', r.spec.length ? rows(r.spec) : '<p class="empty-small">Inga spekulativa spel i dag.</p>')}

    ${section('bygg', 'Bet builders', 'Odds runt 2–3', r.bbStar ? `<div class="cgrid">${bbCard(r.bbStar, true)}${r.bbAlts.map(b => bbCard(b)).join('')}</div>` : '<p class="empty-small">Inget bygge med tillräckligt stöd i dag.</p>')}

    ${r.singles.length ? section('singlar', 'Bra singlar', 'Dagens bästa enskilda spel', rows(r.singles)) : ''}

    ${section('undvik', 'NO BET / undvik', 'Det här låter vi bli', r.avoid.length ? `<div class="avoid">${r.avoid.map(a => `<button class="av-row" data-match="${a.m.id}"><b>${esc(a.label)}</b><small>${esc(a.m.home.short)} – ${esc(a.m.away.short)}</small><span>${esc(a.why)}</span></button>`).join('')}</div>`
      : '<p class="empty-small">Inget särskilt att varna för i dag.</p>')}

    ${section('matcher', 'Matcherna i korthet', `${ms.length} ${ms.length === 1 ? 'match' : 'matcher'}`, `<div class="mi-grid">${ms.map(matchInfo).join('')}</div>`)}

    ${section('alla', 'Alla spel', 'Per match', ms.map(m => `<details class="allm-match" data-allm="${m.id}"><summary>${crest(m.home)}<b>${esc(m.home.short)} – ${esc(m.away.short)}</b><small>${clock(m.utc)} · ${PICKS.allMarkets(m).length} spel</small></summary><div class="allm-body"></div></details>`).join(''))}

    <p class="note lineup">⏱ Kolla alltid de bekräftade startelvorna innan du spelar – de släpps ungefär en timme före avspark. Byte+ gäller inte om spelaren inte startar.</p>
    <p class="note center"><a href="tips.html">Se hur våra tips har gått →</a></p>`;
}

// "Alla spel" per match ritas först när man öppnar den (det är många spel).
document.addEventListener('toggle', e => {
  const d = e.target;
  if (!d.matches?.('details[data-allm]') || !d.open || d.dataset.done) return;
  const m = findMatch(d.dataset.allm);
  d.querySelector('.allm-body').innerHTML = m ? allMarketsHtml(m) : '';
  d.dataset.done = '1';
  if (typeof syncSaveButtons === 'function') syncSaveButtons(d);
}, true);

document.addEventListener('click', e => {
  const t = e.target.closest('[data-dday]');
  if (!t) return;
  dstate.day = t.dataset.dday;
  render();
});

document.addEventListener('auth:changed', () => render());
boot('dagens', render).then(startLive);
