// Dagens värde: dagens bästa bet, enskilda spel, bet builders och målskyttar.
// Urvalet görs av recommendations() i common.js (samma som tipsstatistiken).

const dstate = { day: null };

// Dagar framåt som har kommande matcher med modell.
function upcomingDays() {
  const ms = everyMatch().filter(m => UPCOMING.has(m.status) && (m.model || m.values.length));
  return [...new Set(ms.map(m => dayKey(m.utc)))].filter(d => d >= todayKey()).sort().slice(0, 4);
}

function dayMatches() {
  return everyMatch().filter(m => UPCOMING.has(m.status) && dayKey(m.utc) === dstate.day);
}

// Kort motivering till dagens bästa bet.
function reasons(m, key) {
  const out = [];
  const side = key === 'home' || key === 's:1x' ? 'home' : key === 'away' || key === 's:x2' ? 'away' : null;
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

// Siffrorna på ett kort: med spelbolagets odds visas odds + värde, annars lägsta odds.
// Den viktigaste siffran (den man jämför med sitt spelbolag) står sist och lyses upp.
function nums(s) {
  return s.real
    ? `<div><small>Vår chans</small><b>${pct(s.p)}</b></div><div><small>Odds</small><b>${odd(s.odds)}</b></div><div class="hl"><small>Värde</small><b>${signed(s.edge)}</b></div>`
    : `<div><small>Vår chans</small><b>${pct(s.p)}</b></div><div class="hl"><small>Lägsta odds</small><b>${odd(minOdds(s.p))}</b></div>`;
}

function bestBet(s) {
  if (!s) return `<section class="goldhero empty-hero"><span class="ribbon">Dagens spel</span><h2>Inga spel för dagen</h2><p>Det finns inga kommande matcher med statistik den här dagen.</p></section>`;
  const m = s.m;
  // Utan spelbolagens odds vet vi inte vilket spel som har mest värde – då är det modellens starkaste spel.
  const [ribbon, title] = s.real ? ['★ Bäst värde', 'Dagens bästa bet'] : ['★ Starkast idag', 'Dagens starkaste spel'];
  return `<div class="goldhero" role="button" tabindex="0" data-match="${m.id}">
    <span class="shine" aria-hidden="true"></span>
    <div class="gh-top"><span class="ribbon">${ribbon}</span><span class="gh-meta">${esc(m.comp.name)} · ${dayText(m.utc)} ${clock(m.utc)}</span></div>
    <div class="gh-label">${title}</div>
    <div class="gh-match">${crest(m.home)}<span>${esc(m.home.short)}</span><i>vs</i><span>${esc(m.away.short)}</span>${crest(m.away)}</div>
    <h2 class="gh-pick">${esc(s.label)}</h2>
    <div class="gh-nums">
      ${s.real
        ? `<div><small>Odds</small><b>${odd(s.odds)}</b><em>hos ${esc(s.book)}</em></div><div><small>Värde</small><b>${signed(s.edge)}</b></div>`
        : `<div class="gh-key"><small>Lägsta odds</small><b>${odd(minOdds(s.p))}</b><em>får du högre odds har spelet värde</em></div>`}
      <div><small>Vår chans</small><b>${pct(s.p)}</b></div>
    </div>
    <ul class="gh-why">${reasons(m, s.key).map(r => `<li>${esc(r)}</li>`).join('')}</ul>
    <div class="gh-save">${saveBtn(m, s.key, s.label, s.p, s.odds ?? null, s.book ?? null)}</div>
  </div>`;
}

const cardHead = m => `<div class="meta">${m.comp.emblem ? `<img src="${esc(m.comp.emblem)}" alt="">` : ''}${esc(m.comp.name)} · ${clock(m.utc)}</div>
    <div class="vs">${crest(m.home)}<span>${esc(m.home.short)}</span><small>–</small><span>${esc(m.away.short)}</span>${crest(m.away)}</div>`;

function singleCard(s, i) {
  return `<div class="pcard${s.real ? ' gold' : ''}" role="button" tabindex="0" data-match="${s.m.id}" style="animation-delay:${i * 40}ms">
    ${cardHead(s.m)}
    <div class="pc-pick">${esc(s.label)}</div>
    <div class="pc-nums">${nums(s)}</div>
    ${saveBtn(s.m, s.key, s.label, s.p, s.odds ?? null, s.book ?? null)}
  </div>`;
}

function builderCard(b, i) {
  return `<div class="pcard bb-card" role="button" tabindex="0" data-match="${b.m.id}" style="animation-delay:${i * 40}ms">
    ${cardHead(b.m)}
    <ul class="legs">${b.legs.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
    <div class="pc-nums">${nums(b)}</div>
    ${saveBtn(b.m, b.key, b.label, b.p)}
  </div>`;
}

async function render() {
  if (!(await requirePremium('Skapa konto för att se Dagens värde', 'Dagens bästa bet, enskilda spel, bet builders och målskyttar.'))) return;
  const days = upcomingDays();
  if (!days.includes(dstate.day)) dstate.day = days[0] ?? null;
  $('#days').innerHTML = days.map(d => {
    const p = dayParts(d);
    return `<button class="day${d === dstate.day ? ' active' : ''}${p.today ? ' today' : ''}" data-dday="${d}"><small>${esc(p.name)}</small><b>${p.date}</b></button>`;
  }).join('');

  const { best, singles, builders, scorers } = recommendations(dayMatches());
  const noOdds = !DATA.latest.oddsUpdated;

  $('#main').innerHTML = `
    ${noOdds ? `<div class="odds-off"><b>Spelbolagens odds saknas just nu</b><span>Därför visar vi <b>lägsta odds</b> i stället för värde: får du ett högre odds hos ditt spelbolag har spelet värde enligt vår modell.</span></div>` : ''}
    ${bestBet(best)}
    ${glossary()}

    <section class="sec">
      <div class="sec-head"><h2>Enskilda spel</h2><span>${singles.length ? 'Starkast först' : ''}</span></div>
      ${singles.length ? `<div class="cgrid">${singles.map(singleCard).join('')}</div>` : '<p class="empty">Inga fler enskilda spel den här dagen.</p>'}
    </section>

    <section class="sec">
      <div class="sec-head"><h2>Bet builders</h2><span>Flera spel i samma match</span></div>
      ${builders.length ? `<div class="cgrid">${builders.map(builderCard).join('')}</div>` : '<p class="empty">Inga bet builders den här dagen.</p>'}
    </section>

    <section class="sec">
      <div class="sec-head"><h2>Målskyttar</h2><span>Vår chans att spelaren gör mål</span></div>
      ${scorers.length ? `<div class="plist">${scorers.map(({ m, pl }) => `<div class="plink" role="button" tabindex="0" data-match="${m.id}">${playerRow(m, pl,
        `<small class="faces">${clock(m.utc)} · ${esc(m.home.short)} – ${esc(m.away.short)}</small>`)}</div>`).join('')}</div>` : '<p class="empty">Ingen spelarstatistik för dagens matcher.</p>'}
      <p class="note lineup">⏱ Startelvan släpps ungefär en timme före avspark. Kolla alltid att spelaren startar innan du spelar på hen.</p>
    </section>
    <p class="note center"><a href="tips.html">Se hur våra tips har gått →</a></p>`;
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-dday]');
  if (!t) return;
  dstate.day = t.dataset.dday;
  render();
});

document.addEventListener('auth:changed', () => render());
boot('dagens', render).then(startLive);
