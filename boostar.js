// Boostar: analys av boostade odds enligt vår metod – boosten delas upp i sina ben, varje ben får
// en egen chans ur statistiken (picks.js), benen räknas ihop med hänsyn till att de hänger ihop,
// och det boostade oddset jämförs med vår chans: implicit sannolikhet, EV och en dom (⭐ / Okej / Undvik).
// Ett boostat odds är inte automatiskt value.
//
// Listan: data/boosts.json (läggs in för hand) + boostar som medlemmar delat (tabell boosts).
// boosts.json: [{ "book": "Unibet", "match": 560603, "pick": "bb:home|x:sh:2:12345", "odds": 4.5, "was": 3.6, "ends": "2026-10-17T13:30:00Z", "note": "..." }]
// pick-nycklar: se picks.js (home/draw/away/over/under, g:…, c:…, k:…, x:…, p:…, bb:ben|ben|…)

const BOOKS = ['Svenska Spel', 'Bet365', 'ATG', 'Unibet', 'Betsson', 'NordicBet', 'LeoVegas', 'ComeOn', 'Expekt', 'Mr Green', 'Coolbet', 'Betway', 'Speedy Bet', 'Annat'];
const bstate = { legs: [''] };

// Prompten vi själva använder när Claude ska leta boostar hos spelbolagen (kopieras från sidan).
const BOOST_PROMPT = `Du är en noggrann analytiker av boostade odds. Ta reda på vilka boostade odds och specialer som finns hos svenska spelbolag just nu, och bedöm om de faktiskt har värde. Svara på svenska.

ABSOLUTA REGLER
- Hitta ALDRIG på en boost, ett odds, ett spel eller ett villkor. Använd bara boostar du faktiskt hittar på spelbolagets webbplats eller app, eller i en skärmdump jag skickar.
- Ange för varje boost: spelbolag, exakt namn på spelet, ordinarie odds → boostat odds, maxinsats och villkor om de finns, samt var och när du såg den (länk/källa).
- Kan du inte komma åt en sida (inloggning, geo-blockering, appen visar bara boostarna): säg det tydligt och be mig skicka en skärmdump. Gissa inte vad som finns där.
- Kontrollera att matcherna i boosten spelas på det datum som anges.

SPELBOLAG ATT KOLLA
Bet365 (Bet Boost, Guld/Silver-boostar), ATG (Oddsboost, Specialer), Unibet (Odds Boost / Kambi Specials), Svenska Spel (Oddset Boost), LeoVegas (Boost), Betsson och NordicBet (Superodds/Boost), ComeOn, Expekt och andra som jag nämner.

ANALYS AV VARJE BOOST
1. Bryt ner boosten i alla delar (t.ex. lag vinner + spelare gör mål + över 2.5).
2. Analysera varje del med statistik: form, hemma/borta, xG, skott, skott på mål, hörnor, kort, fouls, spelarens senaste 5–10 matcher, startelvor, skador och avstängningar. Ange källor.
3. Uppskatta sannolikheten för varje del och för hela boosten. Ta hänsyn till hur delarna hänger ihop inom samma match.
4. Jämför:
   - ordinarie odds hos spelbolaget
   - bästa marknadsodds för samma kombination (om det finns)
   - det boostade oddset
   - din egen uppskattade sannolikhet
5. Räkna ut implicit sannolikhet (1/odds) och EV = (sannolikhet × boostat odds) − 1.
6. Ett boostat odds är INTE automatiskt value. Säg tydligt om boosten bara får ett dåligt spel att se bättre ut.

RESULTAT
1. Kort lista över alla boostar du hittade, med spelbolag och källa. Ange separat de du inte kunde komma åt.
2. Tabell: spelbolag | boost | ordinarie → boostat odds | maxinsats | min % | implicit % | EV | risk.
3. ⭐ Stjärnmarkera de boostar som har tydligt positivt EV och rimlig träffchans.
4. "Okej": ungefär rätt prissatt.
5. "Undvik": negativt EV, med det svagaste benet utpekat.
6. För varje rekommenderad boost: varför den är bra och vad som kan få den att gå fel.
7. Om en boost är dålig men innehåller ett bra ben: föreslå det benet som singel.

Skriv kortfattat med tabeller. Hitta inte på något. Är du osäker, skriv att du är osäker.`;

const num = id => parseFloat(($(id)?.value ?? '').replace(',', '.'));

// Dom över en boost: ⭐ = tydligt positivt EV och rimlig chans, Okej = ungefär rätt prissatt, Undvik = negativt EV.
function verdict(p, odds) {
  if (!(p > 0) || !(odds > 1)) return null;
  const ev = p * odds - 1;
  if (ev >= 0.05 && p >= 0.15) return { ev, cls: 'yes', text: '⭐ Bra boost', short: '⭐ Värde' };
  if (ev >= -0.03) return { ev, cls: 'meh', text: 'Okej – ungefär rätt prissatt', short: 'Okej' };
  return { ev, cls: 'no', text: 'Undvik – boosten får ett dåligt spel att se bättre ut', short: 'Undvik' };
}

function matchOptions() {
  const ms = everyMatch().filter(m => UPCOMING.has(m.status) && m.model && Date.parse(m.utc) < Date.now() + 4 * 864e5)
    .sort((a, b) => a.utc.localeCompare(b.utc));
  const byComp = new Map();
  for (const m of ms) byComp.set(m.comp.name, [...(byComp.get(m.comp.name) ?? []), m]);
  return [...byComp].map(([name, list]) => `<optgroup label="${esc(name)}">${list.map(m =>
    `<option value="${m.id}">${esc(m.home.short)} – ${esc(m.away.short)} · ${dayText(m.utc)} ${clock(m.utc)}</option>`).join('')}</optgroup>`).join('');
}

function marketOptions(m, selected) {
  const all = PICKS.allMarkets(m).filter(x => x.p >= 0.03 && x.p <= 0.97);
  return '<option value="">Välj spel…</option>' + PICKS.CATS.filter(c => all.some(x => x.cat === c)).map(c => `<optgroup label="${esc(c)}">${all.filter(x => x.cat === c)
    .map(x => `<option value="${esc(x.key)}"${x.key === selected ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</optgroup>`).join('');
}

// Boosten som ett spel: ett ben = det spelet, flera ben = bet builder.
function boostMarket(m, keys) {
  const legs = keys.filter(Boolean).map(k => PICKS.marketByKey(m, k)).filter(Boolean);
  if (!legs.length) return null;
  return legs.length === 1 ? { ...legs[0], legs } : PICKS.builder(m, legs);
}

// Analysen av en boost – samma för kalkylatorn och korten i listan.
function analysisHtml(m, mk, odds, was, extra = {}) {
  const v = verdict(mk.p, odds);
  const weakest = mk.legs.slice().sort((a, b) => a.p - b.p)[0];
  const strong = mk.legs.filter(l => l.p >= 0.6).sort((a, b) => b.p - a.p)[0];
  const row = (k, val, sub = '') => `<div><small>${k}</small><b>${val}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;
  return `
    <div class="cr-main">
      <span class="label">${v ? esc(v.text) : 'Skriv in det boostade oddset'}</span>
      <b>${v ? signed(v.ev) : '–'}</b>
    </div>
    <div class="cr-nums">
      ${row('Boostat odds', odds > 1 ? odd(odds) : '–', odds > 1 ? `implicit ${pct(1 / odds)}` : '')}
      ${was > 1 ? row('Ordinarie odds', odd(was), `implicit ${pct(1 / was)} · EV ${signed(mk.p * was - 1)}`) : ''}
      ${was > 1 && odds > 1 ? row('Boost', '+' + Math.round((odds / was - 1) * 100) + '%') : ''}
      ${row('Vår chans', pct(mk.p), `risk ${esc((mk.risk ?? '').toLowerCase())}`)}
      <div class="hl"><small>Lägsta odds</small><b>${odd(mk.min)}</b><em>rättvist ${odd(mk.fair)}</em></div>
      ${extra.max ? row('Maxinsats', esc(extra.max)) : ''}
    </div>
    <div class="legs-an">
      <span class="label">Benen</span>
      ${mk.legs.map(l => `<div class="leg-an${l === weakest && mk.legs.length > 1 ? ' weak' : ''}">
        <div><b>${esc(l.label)}</b>${l === weakest && mk.legs.length > 1 ? '<em>svagaste benet</em>' : ''}<small>${esc(l.basis ?? '')}</small></div>
        <span>${pct(l.p)}</span></div>`).join('')}
      ${mk.legs.length > 1 ? `<p class="note">${esc(mk.basis)}</p>` : ''}
    </div>
    ${v && v.cls === 'no' && strong && mk.legs.length > 1 ? `<p class="hint">Boosten är dålig, men <b>${esc(strong.label)}</b> (${pct(strong.p)}) är ett bra ben – spela det hellre som singel om du får minst ${odd(strong.min)} i odds.</p>` : ''}
    ${v && v.cls === 'yes' ? `<p class="note"><b>Varför bra:</b> oddset ${odd(odds)} motsvarar ${pct(1 / odds)} chans, vi räknar med ${pct(mk.p)}. <b>Kan gå fel:</b> ${esc(weakest.wrong ?? '')}</p>` : ''}
    ${extra.terms ? `<p class="note">Villkor: ${esc(extra.terms)}</p>` : ''}
    ${mk.legs.some(l => l.cat === 'Spelare') ? '<p class="note">⏱ Kolla startelvan innan du spelar – Byte+ gäller inte om spelaren inte startar.</p>' : ''}`;
}

function legsHtml(m) {
  return bstate.legs.map((k, i) => `<div class="leg-pick">
    <label><span>${bstate.legs.length > 1 ? `Ben ${i + 1}` : 'Spel'}</span><select data-leg="${i}">${m ? marketOptions(m, k) : ''}</select></label>
    ${bstate.legs.length > 1 ? `<button class="btn-mini" data-leg-remove="${i}" aria-label="Ta bort ben ${i + 1}">×</button>` : ''}
  </div>`).join('') + (bstate.legs.length < 5 ? '<button class="btn-mini" data-leg-add>＋ Lägg till ben</button>' : '');
}

function updateCalc() {
  const m = findMatch($('#c-match').value);
  const out = $('#c-result');
  const mk = m && boostMarket(m, bstate.legs);
  if (!mk) { out.className = 'calc-result'; out.innerHTML = '<p class="note">Välj spelet (eller benen) som spelbolaget boostar.</p>'; return; }
  const odds = num('#c-odds'), was = num('#c-was');
  const v = verdict(mk.p, odds);
  out.className = 'calc-result ' + (v?.cls ?? '');
  out.innerHTML = analysisHtml(m, mk, odds, was, { max: $('#c-max').value.trim(), terms: $('#c-terms').value.trim() });
}

function fillLegs(reset = false) {
  if (reset) bstate.legs = [''];
  const m = findMatch($('#c-match').value);
  $('#c-legs').innerHTML = legsHtml(m);
  updateCalc();
}

// Lägg upp boosten som står i kalkylatorn så att alla ser den (kräver inloggning).
async function shareBoost(btn) {
  const m = findMatch($('#c-match').value);
  const mk = m && boostMarket(m, bstate.legs);
  const odds = num('#c-odds'), was = num('#c-was');
  const book = $('#c-book').value, max = $('#c-max').value.trim();
  const msg = $('#share-msg');
  if (!mk || !(odds > 1)) { msg.textContent = 'Välj match och spel och skriv in det boostade oddset först.'; return; }
  if (!book) { msg.textContent = 'Välj vilket spelbolag som har boosten.'; return; }
  btn.disabled = true;
  const { error } = await sb.from('boosts').insert({
    book, match_id: String(m.id), pick: mk.key, title: mk.label + (max ? ` (max ${max})` : ''), odds, was: was > 1 ? was : null, ends: m.utc,
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

// Spelet bakom en boost: vår modell för nyckeln (pick), annars inget.
const boostPick = (m, b) => (m && b.pick ? (String(b.pick).startsWith('bb:') ? PICKS.marketByKey(m, b.pick) : boostMarket(m, [b.pick])) : null);
// Hämtade boostar (scripts/boosts.mjs) har redan chansen vägd mot spelbolagets vanliga odds.
const boostP = (b, mk) => (b.src ? b.p : mk?.p ?? b.p) ?? null;

function boostCard(b, i, best = false) {
  const m = findMatch(b.match);
  const mk = boostPick(m, b);
  const p = boostP(b, mk);
  const v = verdict(p, b.odds);
  const legs = b.legs?.length > 1 ? b.legs : null;
  const weakest = legs ? legs.slice().sort((x, y) => (x.mp ?? x.p ?? 1) - (y.mp ?? y.p ?? 1))[0] : mk?.legs?.length > 1 ? mk.legs.slice().sort((x, y) => x.p - y.p)[0] : null;
  const label = b.title ?? mk?.label ?? 'Boost';
  const risk = mk?.risk ?? (p == null ? '–' : p >= 0.7 ? 'Låg' : p >= 0.45 ? 'Medel' : 'Hög');
  // Målskytt utan egen nyckel: "p:" rättas på spelarnamnet i texten (grade.js).
  const key = mk?.key ?? (/^[^&+,]+ gör mål$/i.test(label) ? 'p:boost' : 'boost:' + label);
  return `<div class="boost ${v?.cls ?? ''}${best ? ' best' : ''}" style="animation-delay:${i * 40}ms">
    <div class="b-top"><span class="b-book">${esc(b.book)}</span>${v ? `<span class="b-tag ${v.cls}">${esc(v.short)}</span>` : ''}${b.ends ? `<small>gäller till ${dayText(b.ends)} ${clock(b.ends)}</small>` : ''}</div>
    ${m ? `<button class="vs" data-match="${m.id}">${crest(m.home)}<span>${esc(m.home.short)}</span><small>–</small><span>${esc(m.away.short)}</span>${crest(m.away)}</button>`
      : b.home ? `<div class="vs"><span>${esc(b.home)}</span><small>–</small><span>${esc(b.away)}</span></div>` : ''}
    <div class="b-pick">${esc(label)}</div>
    <div class="b-odds">${b.was ? `<s title="Spelbolagets vanliga odds">${odd(b.was)}</s>` : ''}<b>${odd(b.odds)}</b><small>implicit ${pct(1 / b.odds)}</small></div>
    <div class="pc-nums">
      <div><small>Vår chans</small><b>${p == null ? '–' : pct(p)}</b></div>
      <div class="hl"><small>EV</small><b>${v ? signed(v.ev) : '–'}</b></div>
      <div><small>Risk</small><b>${esc(risk)}</b></div>
    </div>
    ${b.src && p != null ? `<p class="note">${b.mp != null ? `Marknadens chans ${pct(b.mp)} (${esc(b.book)}s vanliga odds utan marginal)` : ''}${b.mp != null && b.modelP != null ? ' · ' : ''}${b.modelP != null ? `vår modell ${pct(b.modelP)}` : ''}</p>` : ''}
    ${legs ? `<div class="legs-an">${legs.map(l => `<div class="leg-an${l === weakest ? ' weak' : ''}"><div><b>${esc(l.label)}</b>${l === weakest ? '<em>svagaste benet</em>' : ''}</div><span>${l.mp ?? l.p ? pct(l.mp ?? l.p) : '–'}</span></div>`).join('')}</div>`
      : weakest ? `<p class="note">Svagaste benet: ${esc(weakest.label)} (${pct(weakest.p)})</p>` : ''}
    ${p == null ? '<p class="note">Vi kan inte räkna på det här spelet – det saknas odds och statistik för det.</p>' : ''}
    ${m && p != null ? saveBtn(m, key, label, p, b.odds, b.book) : ''}
    ${b.note ? `<p class="note">${esc(b.note)}</p>` : ''}
    ${b.username ? `<div class="b-by">Upplagd av <b>${esc(b.username)}</b>${AUTH.user?.id === b.created_by ? ` · <button class="linkbtn" data-remove-boost="${b.id}">Ta bort</button>` : ''}</div>` : ''}
  </div>`;
}

async function render() {
  if (!(await requirePremium('Skapa konto för att se boostarna', 'Boost-analysen och boostarna som andra har lagt upp.'))) return;
  let boosts = [];
  try {
    const res = await fetch('data/boosts.json?t=' + Date.now());
    if (res.ok) boosts = await res.json();
  } catch {}
  await AUTH.ready;
  boosts = boosts.concat(await sharedBoosts());
  boosts = boosts.filter(b => !b.ends || Date.parse(b.ends) > Date.now())
    .map(b => {
      const p = boostP(b, boostPick(findMatch(b.match), b));
      return { ...b, ev: p ? p * b.odds - 1 : -1 };
    })
    .sort((a, b) => b.ev - a.ev);
  const groups = [['⭐ Värde', boosts.filter(b => b.ev >= 0.05)], ['Okej', boosts.filter(b => b.ev < 0.05 && b.ev >= -0.03)], ['Undvik', boosts.filter(b => b.ev < -0.03)]];

  $('#main').innerHTML = `
    <section class="calc">
      <div class="calc-head">
        <span class="label">Boost-analys</span>
        <h2>Är boosten värd något?</h2>
        <p>Välj matchen och spelet – eller alla benen om boosten är en kombination – och skriv in oddset. Vi räknar varje ben för sig, hur de hänger ihop och om det boostade oddset faktiskt har värde.</p>
      </div>
      <div class="calc-form">
        <label class="f-wide"><span>Match</span><select id="c-match">${matchOptions()}</select></label>
        <div class="f-wide legs-pick" id="c-legs"></div>
        <label><span>Boostat odds</span><input id="c-odds" inputmode="decimal" placeholder="t.ex. 3,50" autocomplete="off"></label>
        <label><span>Ordinarie odds <i>(valfritt)</i></span><input id="c-was" inputmode="decimal" placeholder="t.ex. 2,90" autocomplete="off"></label>
        <label><span>Maxinsats <i>(valfritt)</i></span><input id="c-max" placeholder="t.ex. 100 kr" autocomplete="off"></label>
        <label><span>Villkor <i>(valfritt)</i></span><input id="c-terms" placeholder="t.ex. bara singel, nya kunder" autocomplete="off"></label>
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
      <p class="note">Unibets boostar hämtas automatiskt var tredje timme och jämförs med Unibets vanliga odds för samma spel och med vår modell. Bet365, Svenska Spel, ATG m.fl. har inga öppna listor – ser du en boost där, skriv in den i analysen ovan och lägg upp den så att alla ser den.</p>
      ${boosts.length ? groups.filter(([, l]) => l.length).map(([t, l]) => `<h3 class="sb-h">${t}</h3><div class="cgrid">${l.map((b, i) => boostCard(b, i, t.startsWith('⭐') && i === 0)).join('')}</div>`).join('')
        : `<p class="empty-small">Inga boostar just nu. Vi hittar inte på några – testa en boost du ser i analysen ovan och lägg upp den så att alla ser den.</p>`}
    </section>

    <details class="box ai-prompt">
      <summary><b>Låt Claude leta boostar hos spelbolagen</b><small>Vår analysprompt – kopiera och klistra in, gärna med skärmdumpar på boostarna</small></summary>
      <pre id="boost-prompt">${esc(BOOST_PROMPT)}</pre>
      <button class="btn-mini gold" data-copy-prompt>Kopiera prompten</button> <span class="note" id="copy-msg" role="status"></span>
    </details>`;

  $('#c-match').addEventListener('change', () => fillLegs(true));
  for (const id of ['#c-odds', '#c-was', '#c-max', '#c-terms']) $(id).addEventListener('input', updateCalc);
  fillLegs();
  $('#share-boost')?.addEventListener('click', e => shareBoost(e.currentTarget));
}

document.addEventListener('change', e => {
  const t = e.target.closest('[data-leg]');
  if (!t) return;
  bstate.legs[Number(t.dataset.leg)] = t.value;
  updateCalc();
});
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-remove-boost],[data-leg-add],[data-leg-remove],[data-copy-prompt]');
  if (!t) return;
  if (t.dataset.removeBoost) removeBoost(t.dataset.removeBoost);
  else if ('legAdd' in t.dataset) { bstate.legs.push(''); fillLegs(); }
  else if (t.dataset.legRemove != null) { bstate.legs.splice(Number(t.dataset.legRemove), 1); fillLegs(); }
  else {
    try { await navigator.clipboard.writeText(BOOST_PROMPT); $('#copy-msg').textContent = 'Kopierad!'; }
    catch { $('#copy-msg').textContent = 'Markera texten ovan och kopiera den.'; }
  }
});
document.addEventListener('auth:changed', () => render());

boot('boostar', render).then(startLive);
