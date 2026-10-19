// Vänner: lägg till med användarnamn, svara på förfrågningar, se en väns bets.
// Används på Mitt konto (konto.js) och i Chatt (chatt.js). När något ändras skickas
// händelsen friends:changed så att sidan kan rita om.
//
// friendsHtml({ chat }) – chat: true visar "Chatta" som knapp som öppnar chatten direkt (data-dm-with).

const RESULT_SHORT = { won: 'Vann', lost: 'Förlorade', live: 'Pågår', open: 'Väntar', unknown: 'Okänt', void: 'Struken' };

async function friendsHtml({ chat = false } = {}) {
  const me = AUTH.user.id;
  const { data: rels } = await sb.from('friendships').select('id, requester, addressee, status').order('created_at');
  const list = rels ?? [];
  const ids = [...new Set(list.flatMap(r => [r.requester, r.addressee]).filter(id => id !== me))];
  const { data: profs } = ids.length ? await sb.from('profiles').select('id, username').in('id', ids) : { data: [] };
  const name = id => (profs ?? []).find(p => p.id === id)?.username ?? 'Okänd';
  const other = r => (r.requester === me ? r.addressee : r.requester);
  const friends = list.filter(r => r.status === 'accepted');
  const incoming = list.filter(r => r.status === 'pending' && r.addressee === me);
  const outgoing = list.filter(r => r.status === 'pending' && r.requester === me);
  const avatar = n => `<span class="fr-av">${esc(n.slice(0, 2).toUpperCase())}</span>`;
  const chatBtn = id => (chat ? `<button class="btn-mini gold" data-dm-with="${id}">Chatta</button>` : `<a class="btn-mini gold" href="chatt.html?dm=${id}">Chatta</a>`);

  return `<section class="sec" id="friends"><div class="sec-head"><h2>Vänner</h2><span>${friends.length} ${friends.length === 1 ? 'vän' : 'vänner'}</span></div>
    <form id="friend-form" class="fr-add" novalidate>
      <label class="f"><span>Lägg till vän med användarnamn</span><input id="friend-name" autocomplete="off" maxlength="20"></label>
      <button class="btn-gold" type="submit">Skicka förfrågan</button>
      <p class="note" id="friend-msg" role="status"></p>
    </form>
    ${incoming.length ? `<h3 class="sb-h">Förfrågningar till dig</h3><div class="fr-list">${incoming.map(r => `<div class="fr">
      ${avatar(name(other(r)))}<b>${esc(name(other(r)))}</b><small>vill bli din vän</small>
      <div class="fr-btns"><button class="btn-mini gold" data-friend-accept="${r.id}">Acceptera</button><button class="btn-mini" data-friend-remove="${r.id}">Neka</button></div>
    </div>`).join('')}</div>` : ''}
    ${friends.length ? `<div class="fr-list">${friends.map(r => `<div class="fr" data-fr="${other(r)}">
      ${avatar(name(other(r)))}<b>${esc(name(other(r)))}</b>
      <div class="fr-btns">${chatBtn(other(r))}<button class="btn-mini" data-friend-bets="${other(r)}" data-friend-label="${esc(name(other(r)))}">Se bets</button><button class="btn-mini" data-friend-remove="${r.id}" data-confirm-text="Ta bort">Ta bort</button></div>
      <div class="fr-bets" hidden></div>
    </div>`).join('')}</div>` : '<p class="note">Du har inga vänner här än. Skriv en väns användarnamn ovan för att skicka en förfrågan.</p>'}
    ${outgoing.length ? `<h3 class="sb-h">Skickade förfrågningar</h3><div class="fr-list">${outgoing.map(r => `<div class="fr">
      ${avatar(name(other(r)))}<b>${esc(name(other(r)))}</b><small>väntar på svar</small>
      <div class="fr-btns"><button class="btn-mini" data-friend-remove="${r.id}">Ångra</button></div>
    </div>`).join('')}</div>` : ''}
    <p class="note">Vänner kan se varandras sparade bets och chatta med varandra.</p>
  </section>`;
}

async function friendBetsHtml(userId) {
  const { data } = await sb.from('saved_bets').select('match_id, pick, label, match_label, kickoff, odds, result, p').eq('user_id', userId)
    .order('kickoff', { ascending: false }).limit(30);
  if (!data?.length) return '<p class="note">Inga sparade bets än.</p>';
  return data.map(b => {
    const m = findMatch(b.match_id);
    const res = b.result ?? betResult(m, b.pick, b.label);
    return `<div class="fr-bet r-${res}" ${m ? `role="button" tabindex="0" data-match="${m.id}"` : ''}>
      <span class="sb-res">${RESULT_SHORT[res] ?? res}</span>
      <span class="fb-main"><b>${esc(b.label)}</b><small>${esc(b.match_label)}${b.kickoff ? ' · ' + esc(dayText(b.kickoff)) : ''}</small></span>
      ${b.odds ? `<em>${Number(b.odds).toFixed(2)}</em>` : b.p != null ? `<em>${pct(Number(b.p))}</em>` : ''}
    </div>`;
  }).join('');
}

const friendsChanged = () => document.dispatchEvent(new CustomEvent('friends:changed'));

// Formuläret kan ligga på sidan eller i bottenarket – därför lyssnar vi på hela dokumentet.
document.addEventListener('submit', async e => {
  if (e.target.id !== 'friend-form') return;
  e.preventDefault();
  const input = $('#friend-name'), msg = $('#friend-msg'), btn = e.submitter ?? e.target.querySelector('button');
  const wanted = input.value.trim();
  if (!/^[A-Za-z0-9_.-]{3,20}$/.test(wanted)) { msg.textContent = 'Skriv ett användarnamn (3–20 tecken).'; return; }
  btn.disabled = true;
  // ilike utan jokertecken: _ och % i namnet ska betyda just _ och %.
  const { data: prof } = await sb.from('profiles').select('id, username').ilike('username', wanted.replace(/[%_\\]/g, '\\$&')).maybeSingle();
  if (!prof) { btn.disabled = false; msg.textContent = `Hittade ingen med användarnamnet "${wanted}".`; return; }
  if (prof.id === AUTH.user.id) { btn.disabled = false; msg.textContent = 'Det där är ju du själv.'; return; }
  const { error } = await sb.from('friendships').insert({ addressee: prof.id });
  btn.disabled = false;
  if (error) {
    msg.textContent = /duplicate|unique/i.test(error.message) ? `Ni är redan vänner, eller så finns det redan en förfrågan mellan dig och ${prof.username}.` : 'Kunde inte skicka förfrågan: ' + error.message;
    return;
  }
  friendsChanged();
});

// Vänknappar: acceptera, neka/ta bort/ångra och visa en väns bets.
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-friend-accept],[data-friend-remove],[data-friend-bets]');
  if (!t) return;
  e.preventDefault();
  if (t.dataset.friendAccept) {
    t.disabled = true;
    await sb.from('friendships').update({ status: 'accepted' }).eq('id', t.dataset.friendAccept);
    friendsChanged();
  } else if (t.dataset.friendRemove) {
    // "Ta bort" på en vän kräver ett andra klick, så att man inte tar bort någon av misstag.
    if (t.dataset.confirmText && !t.classList.contains('armed')) {
      t.classList.add('armed');
      t.textContent = 'Säker? Tryck igen';
      setTimeout(() => { t.classList.remove('armed'); t.textContent = t.dataset.confirmText; }, 4000);
      return;
    }
    t.disabled = true;
    await sb.from('friendships').delete().eq('id', t.dataset.friendRemove);
    friendsChanged();
  } else {
    const box = t.closest('.fr').querySelector('.fr-bets');
    if (!box.hidden) { box.hidden = true; t.textContent = 'Se bets'; return; }
    box.hidden = false;
    t.textContent = 'Dölj bets';
    box.innerHTML = '<div class="loading"><span class="spin"></span>Hämtar bets…</div>';
    box.innerHTML = await friendBetsHtml(t.dataset.friendBets);
  }
});
