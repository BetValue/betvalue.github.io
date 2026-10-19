// Så har det gått: hur alla tips från Dagens värde har gått, öppet för alla.
// Filter: period, typ av spel, liga och om tipset sparades före avspark eller räknades i efterhand.

const tstate = { days: 30, kind: 'all', comp: 'all', src: 'all' };
const PERIODS = [[7, '7 dagar'], [30, '30 dagar'], [Infinity, 'Allt']];
const SOURCES = [['all', 'Alla tips'], ['live', 'Sparade före avspark'], ['back', 'Räknade i efterhand']];
const STAKE = 100;

const isDone = p => p.result === 'won' || p.result === 'lost';
const won = list => list.filter(p => p.result === 'won').length;
const expectedHits = list => list.reduce((s, p) => s + (Number(p.p) || 0), 0);
const kr = x => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(Math.round(x)).toLocaleString('sv-SE') + ' kr';
// Vinst på ett tips med 100 kr insats till ett visst odds.
const profitAt = (p, o) => (p.result === 'won' ? (o - 1) * STAKE : -STAKE);

function chips(list, key, cls = 'chip') {
  return list.map(([v, label, img]) => `<button class="${cls}${String(tstate[key]) === String(v) ? ' active' : ''}" data-t-${key}="${v}">${img ? `<img src="${esc(img)}" alt="">` : ''}${esc(label)}</button>`).join('');
}

// Pengar: med riktiga odds visas avkastningen. Utan odds visas ett räkneexempel på lägsta odds –
// tydligt märkt, eftersom ingen kan veta att man faktiskt fick just det oddset.
function moneyHtml(done) {
  const withOdds = done.filter(p => Number(p.odds) > 1);
  if (withOdds.length) {
    const profit = withOdds.reduce((s, p) => s + profitAt(p, Number(p.odds)), 0);
    const roi = profit / (withOdds.length * STAKE);
    return `<div class="money ${profit >= 0 ? 'up' : 'down'}"><small>Avkastning med spelbolagens odds</small>
      <b>${kr(profit)}</b><span>${withOdds.length} tips à ${STAKE} kr · ROI ${signed(roi)}</span></div>`;
  }
  const ex = done.filter(p => Number(p.p) > 0);
  const profit = ex.reduce((s, p) => s + profitAt(p, minOdds(Number(p.p))), 0);
  return `<div class="money ex ${profit >= 0 ? 'up' : 'down'}"><small>Räkneexempel · lägsta odds</small>
    <b>${kr(profit)}</b><span>om du fått precis lägsta odds på alla ${ex.length} tips à ${STAKE} kr. Riktig avkastning visas när spelbolagens odds är inkopplade.</span></div>`;
}

// Kalibrering: går tipsen in så ofta som modellen säger? Stapel = gick in, streck = modellen sa.
function calibrationHtml(done) {
  const bands = [];
  for (let lo = 0; lo < 1; lo += 0.1) {
    const list = done.filter(p => Number(p.p) >= lo && Number(p.p) < lo + 0.1);
    if (list.length >= 3) bands.push({ lo, n: list.length, hit: won(list) / list.length, exp: expectedHits(list) / list.length });
  }
  if (bands.length < 2) return '';
  const row = b => {
    const tip = `${b.n} tips där modellen sa ${Math.round(b.lo * 100)}–${Math.round(b.lo * 100) + 10} %: ${Math.round(b.hit * 100)} % gick in (modellen väntade ${Math.round(b.exp * 100)} %)`;
    return `<div class="cal-row" title="${tip}">
      <span class="cal-band">${Math.round(b.lo * 100)}–${Math.round(b.lo * 100) + 10} %<small>${b.n} tips</small></span>
      <span class="cal-track" role="img" aria-label="${tip}"><i style="width:${b.hit * 100}%"></i><u style="left:${b.exp * 100}%"></u></span>
      <span class="cal-val"><b>${Math.round(b.hit * 100)} %</b><small>väntat ${Math.round(b.exp * 100)} %</small></span>
    </div>`;
  };
  return `<section class="box cal">
    <span class="label">Stämmer chanserna?</span>
    <p class="note">Säger modellen 70 % ska ungefär 7 av 10 sådana tips gå in. Ju närmare stapeln är strecket, desto bättre stämmer modellen.</p>
    <div class="cal-legend"><span><i></i>Gick in</span><span><u></u>Modellen sa</span></div>
    ${bands.map(row).join('')}
  </section>`;
}

function rowHtml(p) {
  return `<div class="tr-row r-${p.result}">
    <span class="tr-mark">${p.result === 'won' ? '✓' : '✗'}</span>
    <span class="tr-main"><b>${esc(p.label)}</b><small>${esc(p.home)} – ${esc(p.away)}${p.score ? ' · ' + esc(p.score) : ''}${p.back ? ' · <span class="tr-back">räknat i efterhand</span>' : ''}</small></span>
    <em>${pct(Number(p.p))}${Number(p.odds) > 1 ? `<small>@ ${odd(Number(p.odds))}</small>` : ''}</em></div>`;
}

async function render() {
  const { picks = [] } = await loadTrack();
  const since = Date.now() - tstate.days * 864e5;
  const inPeriod = picks.filter(p => Date.parse(p.utc) > since);
  const filtered = inPeriod.filter(p => (tstate.kind === 'all' || p.kind === tstate.kind) && (tstate.comp === 'all' || p.comp === tstate.comp)
    && (tstate.src === 'all' || (tstate.src === 'back') === !!p.back));
  const done = filtered.filter(isDone);
  const waiting = filtered.filter(p => !p.result).length;

  const comps = DATA.latest.competitions.filter(c => inPeriod.some(p => p.comp === c.id));
  const filters = `<div class="tips-filters">
    <div class="days tips-periods">${PERIODS.map(([d, label]) => `<button class="day${d === tstate.days ? ' active' : ''}" data-t-days="${d}"><b>${label}</b></button>`).join('')}</div>
    <div class="chips">${chips([['all', 'Alla spel'], ...Object.entries(TRACK_KIND)], 'kind')}</div>
    ${comps.length > 1 ? `<div class="chips">${chips([['all', 'Alla ligor'], ...comps.map(c => [c.id, c.name, c.emblem])], 'comp')}</div>` : ''}
    <div class="chips">${chips(SOURCES, 'src')}</div>
  </div>`;

  if (!done.length) {
    $('#main').innerHTML = filters + '<p class="empty">Inga avgjorda tips med de här filtren än.</p>';
    return;
  }

  const w = won(done), rate = w / done.length, exp = expectedHits(done) / done.length;
  const live = done.filter(p => !p.back), back = done.filter(p => p.back);
  const split = tstate.src === 'all' && live.length && back.length ? `<div class="tr-split">
      <div><small>Sparade före avspark</small><b>${won(live)}<i>/${live.length}</i></b><span>${Math.round(won(live) / live.length * 100)} % · modellen sa ${Math.round(expectedHits(live) / live.length * 100)} %</span></div>
      <div><small>Räknade i efterhand</small><b>${won(back)}<i>/${back.length}</i></b><span>${Math.round(won(back) / back.length * 100)} % · modellen sa ${Math.round(expectedHits(back) / back.length * 100)} %</span></div>
    </div>` : '';
  const kinds = tstate.kind === 'all' ? `<div class="tr-kinds">${Object.entries(TRACK_KIND).map(([k, name]) => {
    const list = done.filter(p => p.kind === k);
    return list.length ? `<div><small>${esc(name)}</small><b>${won(list)}<i>/${list.length}</i></b></div>` : '';
  }).join('')}</div>` : '';

  const days = [...new Set(done.map(p => p.day))];
  const list = days.map(d => {
    const l = done.filter(p => p.day === d), lw = won(l), le = expectedHits(l);
    const cls = lw >= le + 0.5 ? 'good' : lw <= le - 0.5 ? 'bad' : '';
    return `<h3 class="tr-day ${cls}"><span>${esc(dayText(l[0].utc))}</span><small>${lw} av ${l.length} gick in · modellen väntade ${Math.round(le)}</small></h3>
      <div class="tr-list">${l.map(rowHtml).join('')}</div>`;
  }).join('');

  $('#main').innerHTML = `${filters}
    <section class="box track">
      <span class="label">Så har våra tips gått</span>
      <div class="tr-big"><b>${w} av ${done.length}</b><span>gick in ${tstate.days === Infinity ? 'totalt' : `senaste ${tstate.days} dagarna`}</span><em>${Math.round(rate * 100)}%</em></div>
      <div class="tr-bar" role="img" aria-label="${w} gick in, ${done.length - w} gick inte in"><i style="width:${rate * 100}%"></i></div>
      <div class="tr-legend"><span class="w">✓ ${w} gick in</span><span class="l">✗ ${done.length - w} gick inte in</span><span>Modellen räknade med ${pct(exp)}</span></div>
      ${moneyHtml(done)}
      ${split}
      ${kinds}
    </section>
    ${calibrationHtml(done)}
    <section class="box track">
      <span class="label">Alla tips dag för dag</span>
      <p class="note">Grön dag = fler tips gick in än modellen räknade med, röd = färre.${waiting ? ` ${waiting} tips väntar på matcher som inte är klara.` : ''}</p>
      ${list}
    </section>
    <p class="note">Alla tips från Dagens värde räknas – även de som inte gick in. Procenten till höger är vår chans före matchen. Tips märkta <span class="tr-back">räknat i efterhand</span> togs fram efteråt med samma modell, som då bara fick se matcher spelade före avspark. Riktiga tips sparas före avspark och ändras aldrig.</p>`;
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-t-days],[data-t-kind],[data-t-comp],[data-t-src]');
  if (!t) return;
  for (const k of ['days', 'kind', 'comp', 'src']) {
    const v = t.getAttribute('data-t-' + k);
    if (v != null) tstate[k] = k === 'days' ? Number(v) : v;
  }
  render();
});

boot('tips', render).then(startLive);
