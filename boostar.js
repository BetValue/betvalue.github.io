// Boostar: kalkylator som testar ett boostat odds mot vår modell, plus en lista
// med inlagda boostar från data/boosts.json.
//
// boosts.json: [{ "book": "Unibet", "match": 560603, "pick": "pw:38101", "odds": 4.5, "was": 3.6, "ends": "2026-10-17T13:30:00Z", "note": "..." }]
// pick-nycklar: home/draw/away/over/under, s:<enkel>, b:<bygge>, p:<spelar-id>, pw:<spelar-id>, po:<spelar-id>

const BOOKS = ['Svenska Spel', 'Bet365', 'ATG', 'Unibet', 'Betsson', 'LeoVegas', 'NordicBet', 'ComeOn', 'Mr Green', 'Coolbet', 'Betway', 'Speedy Bet', 'Annat'];

function verdict(p, odds) {
  if (!(p > 0) || !(odds > 1)) return null;
  const edge = p * odds - 1;
  const cls = edge >= 0.05 ? 'yes' : edge >= 0 ? 'meh' : 'no';
  const text = edge >= 0.05 ? 'Boosten har värde' : edge >= 0 ? 'Ungefär rättvist' : 'Inget värde';
  return { edge, cls, text };
}

function matchOptions() {
  const ms = everyMatch().filter(m => UPCOMING.has(m.status) && m.model && Date.parse(m.utc) < Date.now() + 4 * 864e5)
    .sort((a, b) => a.utc.localeCompare(b.utc));
  const byComp = new Map();
  for (const m of ms) byComp.set(m.comp.name, [...(byComp.get(m.comp.name) ?? []), m]);
  return [...byComp].map(([name, list]) => `<optgroup label="${esc(name)}">${list.map(m =>
    `<option value="${m.id}">${esc(m.home.short)} – ${esc(m.away.short)} · ${dayText(m.utc)} ${clock(m.utc)}</option>`).join('')}</optgroup>`).join('');
}

function marketOptions(m) {
  const groups = new Map();
  for (const x of marketsFor(m)) groups.set(x.group, [...(groups.get(x.group) ?? []), x]);
  return [...groups].map(([g, list]) => `<optgroup label="${esc(g)}">${list.map(x =>
    `<option value="${esc(x.key)}">${esc(x.label)}</option>`).join('')}</optgroup>`).join('');
}

function updateCalc() {
  const m = findMatch($('#c-match').value);
  const mk = m && marketsFor(m).find(x => x.key === $('#c-market').value);
  const odds = parseFloat($('#c-odds').value.replace(',', '.'));
  const was = parseFloat($('#c-was').value.replace(',', '.'));
  const out = $('#c-result');
  if (!mk) { out.innerHTML = ''; return; }
  const v = verdict(mk.p, odds);
  out.className = 'calc-result ' + (v?.cls ?? '');
  out.innerHTML = `
    <div class="cr-main">
      <span class="label">${v ? esc(v.text) : 'Skriv in det boostade oddset'}</span>
      <b>${v ? signed(v.edge) : '–'}</b>
    </div>
    <div class="cr-nums">
      <div><small>Vår chans</small><b>${pct(mk.p)}</b></div>
      <div><small>Rättvist odds</small><b>${odd(fair(mk.p))}</b></div>
      <div><small>Värde från</small><b>${odd(minOdds(mk.p))}</b></div>
      ${was > 1 && odds > 1 ? `<div><small>Boost</small><b>+${Math.round((odds / was - 1) * 100)}%</b></div>` : ''}
    </div>
    <p class="note">${v && v.edge >= 0.05 ? 'Oddset är högre än vad modellen tycker att spelet är värt.' : 'Ett spel har värde när det boostade oddset är högre än "värde från".'}
      ${mk.player ? ' Kolla att spelaren startar – startelvan släpps cirka en timme före avspark.' : ''}</p>`;
}

function fillMarkets() {
  const m = findMatch($('#c-match').value);
  $('#c-market').innerHTML = m ? marketOptions(m) : '';
  updateCalc();
}

// Lägg upp boosten som står i kalkylatorn så att alla ser den (kräver inloggning).
async function shareBoost(btn) {
  const m = findMatch($('#c-match').value);
  const mk = m && marketsFor(m).find(x => x.key === $('#c-market').value);
  const odds = parseFloat($('#c-odds').value.replace(',', '.'));
  const was = parseFloat($('#c-was').value.replace(',', '.'));
  const book = $('#c-book').value;
  const msg = $('#share-msg');
  if (!mk || !(odds > 1)) { msg.textContent = 'Välj match och spel och skriv in det boostade oddset först.'; return; }
  if (!book) { msg.textContent = 'Välj vilket spelbolag som har boosten.'; return; }
  btn.disabled = true;
  const { error } = await sb.from('boosts').insert({
    book, match_id: String(m.id), pick: mk.key, title: mk.label, odds, was: was > 1 ? was : null, ends: m.utc,
  });
  btn.disabled = false;
  if (error) { msg.textContent = 'Kunde inte lägga upp boosten: ' + error.message; return; }
  msg.textContent = 'Upplagd! Nu ser alla boosten i listan nedan.';
  render();
}

async function removeBoost(id) {
  await sb.from('boosts').delete().eq('id', id);
  render();
}

// Den bästa boosten: stort guldkort överst.
function bestBoostHtml(b) {
  const m = findMatch(b.match);
  const mk = m && marketsFor(m).find(x => x.key === b.pick);
  const p = mk?.p ?? b.p;
  return `<div class="goldhero boost-best">
    <span class="shine" aria-hidden="true"></span>
    <div class="gh-top"><span class="ribbon">★ Bästa boosten</span><span class="gh-meta">${esc(b.book)}${m ? " · " + esc(dayText(m.utc)) + " " + esc(clock(m.utc)) : ""}</span></div>
    ${m ? `<div class="gh-match">${crest(m.home)}<span>${esc(m.home.short)}</span><i>vs</i><span>${esc(m.away.short)}</span>${crest(m.away)}</div>` : ""}
    <h2 class="gh-pick">${esc(b.title ?? mk?.label ?? "Boost")}</h2>
    <div class="gh-nums">
      <div><small>Boostat odds</small><b>${odd(b.odds)}</b>${b.was ? `<em>var ${odd(b.was)}</em>` : ""}</div>
      <div><small>Värde</small><b>${signed(b.edge)}</b></div>
      <div><small>Vår chans</small><b>${pct(p)}</b></div>
      <div><small>Rättvist odds</small><b>${odd(fair(p))}</b></div>
    </div>
    <div class="gh-save">${m && mk ? saveBtn(m, mk.key, mk.label, mk.p, b.odds, b.book) : ""}</div>
  </div>`;
}

function boostCard(b, i) {
  const m = findMatch(b.match);
  const mk = m && marketsFor(m).find(x => x.key === b.pick);
  const p = mk?.p ?? b.p ?? null;
  const v = verdict(p, b.odds);
  const label = b.title ?? mk?.label ?? 'Boost';
  return `<div class="boost ${v?.cls ?? ''}" style="animation-delay:${i * 40}ms">
    <div class="b-top"><span class="b-book">${esc(b.book)}</span>${b.ends ? `<small>gäller till ${dayText(b.ends)} ${clock(b.ends)}</small>` : ''}</div>
    ${m ? `<button class="vs" data-match="${m.id}">${crest(m.home)}<span>${esc(m.home.short)}</span><small>–</small><span>${esc(m.away.short)}</span>${crest(m.away)}</button>` : ''}
    <div class="b-pick">${esc(label)}</div>
    <div class="b-odds">${b.was ? `<s>${odd(b.was)}</s>` : ''}<b>${odd(b.odds)}</b></div>
    <div class="pc-nums">
      <div><small>Vår chans</small><b>${pct(p)}</b></div>
      <div><small>Rättvist</small><b>${odd(fair(p))}</b></div>
      <div class="hl"><small>Värde</small><b>${v ? signed(v.edge) : '–'}</b></div>
    </div>
    ${v ? `<div class="b-verdict">${esc(v.text)}</div>` : ''}
    ${m && mk ? saveBtn(m, mk.key, mk.label, mk.p, b.odds, b.book) : ''}
    ${b.note ? `<p class="note">${esc(b.note)}</p>` : ''}
    ${b.username ? `<div class="b-by">Upplagd av <b>${esc(b.username)}</b>${AUTH.user?.id === b.created_by ? ` · <button class="linkbtn" data-remove-boost="${b.id}">Ta bort</button>` : ''}</div>` : ''}
  </div>`;
}

async function render() {
  if (!(await requirePremium('Skapa konto för att se boostarna', 'Boost-kalkylatorn och de rekommenderade boostarna.'))) return;
  let boosts = [];
  try {
    const res = await fetch('data/boosts.json?t=' + Date.now());
    if (res.ok) boosts = await res.json();
  } catch {}
  await AUTH.ready;
  boosts = boosts.concat(await sharedBoosts());
  boosts = boosts.filter(b => !b.ends || Date.parse(b.ends) > Date.now())
    .map(b => {
      const m = findMatch(b.match), mk = m && marketsFor(m).find(x => x.key === b.pick);
      const p = mk?.p ?? b.p;
      return { ...b, edge: p ? p * b.odds - 1 : -1 };
    })
    .sort((a, b) => b.edge - a.edge);
  // Guldkortet går bara till den boost som ger mest värde för oddset (och bara om den har värde).
  const best = boosts[0]?.edge > 0 ? boosts[0] : null;

  $('#main').innerHTML = `
    <section class="calc">
      <div class="calc-head">
        <span class="label">Boost-kalkylator</span>
        <h2>Är boosten värd något?</h2>
        <p>Välj matchen och spelet som spelbolaget boostar och skriv in oddset. Vi jämför med vår modell direkt.</p>
      </div>
      <div class="calc-form">
        <label class="f-wide"><span>Match</span><select id="c-match">${matchOptions()}</select></label>
        <label class="f-wide"><span>Spel</span><select id="c-market"></select></label>
        <label><span>Boostat odds</span><input id="c-odds" inputmode="decimal" placeholder="t.ex. 3,50" autocomplete="off"></label>
        <label><span>Vanligt odds <i>(valfritt)</i></span><input id="c-was" inputmode="decimal" placeholder="t.ex. 2,90" autocomplete="off"></label>
      </div>
      <div id="c-result" class="calc-result"></div>
      <div class="share">
        ${AUTH.user ? `<label class="f"><span>Spelbolag</span><select id="c-book"><option value="">Välj spelbolag…</option>${BOOKS.map(b => `<option>${b}</option>`).join('')}</select></label>
          <button class="btn-gold" id="share-boost">Lägg upp boosten för alla</button>`
          : `<p class="note"><a href="konto.html?next=${encodeURIComponent(location.pathname)}">Logga in</a> för att lägga upp boosten så att alla ser den.</p>`}
        <p class="note" id="share-msg" role="status"></p>
      </div>
    </section>

    <section class="sec">
      <div class="sec-head"><h2>Aktuella boostar</h2><span>${boosts.length ? 'Bäst värde först' : ''}</span></div>
      ${best ? bestBoostHtml(best) : ''}
      ${boosts.length ? `<div class="cgrid">${(best ? boosts.slice(1) : boosts).map(boostCard).join('')}</div>`
        : `<div class="locked"><b>Inga boostar inlagda</b><span>Ser du en boost hos ${BOOKS.slice(0, 3).join(', ')} eller något annat bolag? Testa den i kalkylatorn ovan, eller be Claude lägga in den i listan så att kompisarna ser den också.</span></div>`}
    </section>`;

  $('#c-match').addEventListener('change', fillMarkets);
  $('#c-market').addEventListener('change', updateCalc);
  $('#c-odds').addEventListener('input', updateCalc);
  $('#c-was').addEventListener('input', updateCalc);
  fillMarkets();
  $('#share-boost')?.addEventListener('click', e => shareBoost(e.currentTarget));
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-remove-boost]');
  if (t) removeBoost(t.dataset.removeBoost);
});
document.addEventListener('auth:changed', () => render());

boot('boostar', render).then(startLive);
