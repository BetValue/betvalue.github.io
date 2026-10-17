// Dagens värde: dagens bästa bet, enskilda spel, bet builders och målskyttar.

const dstate = { day: null };

// Dagar framåt som har kommande matcher med modell.
function upcomingDays() {
  const ms = everyMatch().filter(m => UPCOMING.has(m.status) && (m.model || m.values.length));
  return [...new Set(ms.map(m => dayKey(m.utc)))].filter(d => d >= todayKey()).sort().slice(0, 4);
}

function dayMatches() {
  return everyMatch().filter(m => UPCOMING.has(m.status) && dayKey(m.utc) === dstate.day);
}

const confW = m => (m.model ? CONF_W[m.model.conf] : 0.7);

// Kandidater för ett enskilt spel: riktiga värdebets (med odds) eller modellens starkaste spel.
function singles(ms) {
  const withOdds = ms.flatMap(m => m.values.map(v => ({
    m, key: v.pick, label: pickLabel(m, v.pick), p: v.p, odds: v.odds, book: v.book, edge: v.edge, real: true,
    score: 100 + v.edge * 100,
  })));
  const model = ms.flatMap(m => marketsFor(m)
    .filter(x => x.group === 'Matchen' && x.p >= 0.5 && x.p <= 0.8)
    .map(x => ({ m, key: x.key, label: x.label, p: x.p, real: false, score: x.p * confW(m) })));
  return [...withOdds, ...model].sort((a, b) => b.score - a.score);
}

function builders(ms) {
  const all = ms.flatMap(m => marketsFor(m)
    .filter(x => x.legs && fair(x.p) >= 2.2 && fair(x.p) <= 7)
    .map(x => ({ m, ...x, score: x.p * confW(m) })));
  const best = new Map(); // ett bygge per match
  for (const b of all.sort((a, b) => b.score - a.score)) if (!best.has(b.m.id)) best.set(b.m.id, b);
  return [...best.values()];
}

function scorers(ms) {
  return ms.flatMap(m => (m.extras?.players ?? []).map(pl => ({ m, pl, score: pl.p * confW(m) })))
    .sort((a, b) => b.score - a.score);
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

function bestBet(s) {
  if (!s) return `<section class="goldhero empty-hero"><span class="ribbon">Bäst värde</span><h2>Inga spel för dagen</h2><p>Det finns inga kommande matcher med statistik den här dagen.</p></section>`;
  const m = s.m;
  const minO = minOdds(s.p);
  return `<div class="goldhero" role="button" tabindex="0" data-match="${m.id}">
    <span class="shine" aria-hidden="true"></span>
    <div class="gh-top"><span class="ribbon">★ Bäst värde</span><span class="gh-meta">${esc(m.comp.name)} · ${dayText(m.utc)} ${clock(m.utc)}</span></div>
    <div class="gh-label">Dagens bästa bet</div>
    <div class="gh-match">${crest(m.home)}<span>${esc(m.home.short)}</span><i>vs</i><span>${esc(m.away.short)}</span>${crest(m.away)}</div>
    <h2 class="gh-pick">${esc(s.label)}</h2>
    <div class="gh-nums">
      ${s.real
        ? `<div><small>Odds</small><b>${odd(s.odds)}</b><em>hos ${esc(s.book)}</em></div>
           <div><small>Värde</small><b>${signed(s.edge)}</b></div>`
        : `<div><small>Värde från odds</small><b>${odd(minO)}</b><em>allt över det = värde</em></div>`}
      <div><small>Vår chans</small><b>${pct(s.p)}</b></div>
      <div><small>Rättvist odds</small><b>${odd(fair(s.p))}</b></div>
    </div>
    <ul class="gh-why">${reasons(m, s.key).map(r => `<li>${esc(r)}</li>`).join('')}</ul>
    <div class="gh-save">${saveBtn(m, s.key, s.label, s.p, s.odds ?? null, s.book ?? null)}</div>
  </div>`;
}

function singleCard(s, i) {
  const m = s.m;
  return `<div class="pcard${s.real ? ' gold' : ''}" role="button" tabindex="0" data-match="${m.id}" style="animation-delay:${i * 40}ms">
    <div class="meta">${m.comp.emblem ? `<img src="${esc(m.comp.emblem)}" alt="">` : ''}${esc(m.comp.name)} · ${clock(m.utc)}</div>
    <div class="vs">${crest(m.home)}<span>${esc(m.home.short)}</span><small>–</small><span>${esc(m.away.short)}</span>${crest(m.away)}</div>
    <div class="pc-pick">${esc(s.label)}</div>
    <div class="pc-nums">
      <div><small>Vår chans</small><b>${pct(s.p)}</b></div>
      ${s.real ? `<div><small>Odds</small><b>${odd(s.odds)}</b></div><div class="hl"><small>Värde</small><b>${signed(s.edge)}</b></div>`
        : `<div><small>Rättvist</small><b>${odd(fair(s.p))}</b></div><div class="hl"><small>Värde från</small><b>${odd(minOdds(s.p))}</b></div>`}
    </div>
    ${saveBtn(m, s.key, s.label, s.p, s.odds ?? null, s.book ?? null)}
  </div>`;
}

function builderCard(b, i) {
  const m = b.m;
  return `<div class="pcard bb-card" role="button" tabindex="0" data-match="${m.id}" style="animation-delay:${i * 40}ms">
    <div class="meta">${m.comp.emblem ? `<img src="${esc(m.comp.emblem)}" alt="">` : ''}${esc(m.comp.name)} · ${clock(m.utc)}</div>
    <div class="vs">${crest(m.home)}<span>${esc(m.home.short)}</span><small>–</small><span>${esc(m.away.short)}</span>${crest(m.away)}</div>
    <ul class="legs">${b.legs.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
    <div class="pc-nums">
      <div><small>Vår chans</small><b>${pct(b.p)}</b></div>
      <div><small>Rättvist</small><b>${odd(fair(b.p))}</b></div>
      <div class="hl"><small>Värde från</small><b>${odd(minOdds(b.p))}</b></div>
    </div>
    ${saveBtn(m, b.key, b.label, b.p)}
  </div>`;
}

async function render() {
  if (!(await requireLogin('Logga in för att se Dagens värde', 'Dagens bästa bet, enskilda spel, bet builders och målskyttar är bara för inloggade.'))) return;
  const days = upcomingDays();
  if (!days.includes(dstate.day)) dstate.day = days[0] ?? null;
  $('#days').innerHTML = days.map(d => {
    const p = dayParts(d);
    return `<button class="day${d === dstate.day ? ' active' : ''}${p.today ? ' today' : ''}" data-dday="${d}"><small>${esc(p.name)}</small><b>${p.date}</b></button>`;
  }).join('');

  const ms = dayMatches();
  const ss = singles(ms);
  // Huvudtipset ska ha ett spelbart odds (minst ~1,40) om det inte är ett riktigt värdebet.
  const best = ss.find(s => s.real || s.p <= 0.72) ?? ss[0];
  const rest = [];
  const used = new Set(best ? [best.m.id + best.key] : []);
  for (const s of ss.slice(1)) {
    if (used.has(s.m.id + s.key) || rest.some(r => r.m.id === s.m.id && !s.real)) continue;
    rest.push(s); used.add(s.m.id + s.key);
    if (rest.length >= 6) break;
  }
  const bs = builders(ms).slice(0, 6);
  const sc = scorers(ms).slice(0, 8);
  const noOdds = !DATA.latest.oddsUpdated;

  $('#main').innerHTML = `
    ${bestBet(best)}
    ${noOdds ? `<p class="hint">Spelbolagens odds är inte inkopplade än, så spelen visar <b>"värde från"</b>: det lägsta oddset där spelet har värde enligt vår modell. Hittar du högre odds hos ditt spelbolag är det ett värdespel.</p>` : ''}

    <section class="sec">
      <div class="sec-head"><h2>Enskilda spel</h2><span>${rest.length ? 'Starkast först' : ''}</span></div>
      ${rest.length ? `<div class="cgrid">${rest.map(singleCard).join('')}</div>` : '<p class="empty">Inga fler enskilda spel den här dagen.</p>'}
    </section>

    <section class="sec">
      <div class="sec-head"><h2>Bet builders</h2><span>Ett bygge per match</span></div>
      ${bs.length ? `<div class="cgrid">${bs.map(builderCard).join('')}</div>` : '<p class="empty">Inga bet builders den här dagen.</p>'}
    </section>

    <section class="sec">
      <div class="sec-head"><h2>Målskyttar</h2><span>Chans att göra mål</span></div>
      ${sc.length ? `<div class="plist">${sc.map(({ m, pl }) => `<div class="plink" role="button" tabindex="0" data-match="${m.id}">${playerRow(m, pl,
        `<small class="faces">${clock(m.utc)} · ${esc(m.home.short)} – ${esc(m.away.short)} · värde från <b>${odd(minOdds(pl.p))}</b></small>`)}</div>`).join('')}</div>` : '<p class="empty">Ingen spelarstatistik för dagens matcher.</p>'}
      <p class="note lineup">⏱ Startelvan släpps ungefär en timme före avspark. Kolla alltid att spelaren startar innan du spelar på hen.</p>
    </section>`;
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-dday]');
  if (!t) return;
  dstate.day = t.dataset.dday;
  render();
});

document.addEventListener('auth:changed', () => render());
boot('dagens', render);
