// Chatt: enskilda chattar med vänner och grupper, där man kan dela bets.
// Nya meddelanden kommer direkt via Supabase Realtime; om den inte är ansluten
// hämtas de med jämna mellanrum i stället.

const cstate = { convs: [], profiles: new Map(), friends: [], active: null, messages: [], unread: new Map(), live: false };
const RESULT_SHORT = { won: 'Vann', lost: 'Förlorade', live: 'Pågår', open: 'Väntar', unknown: 'Okänt', void: 'Struken' };
const params = new URLSearchParams(location.search);

const uname = id => cstate.profiles.get(id) ?? 'Okänd';
const initialsOf = n => esc(String(n).slice(0, 2).toUpperCase());
const stamp = iso => (dayKey(iso) === todayKey() ? clock(iso)
  : new Date(iso).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', timeZone: TZ }) + ' ' + clock(iso));

async function loadProfiles(ids) {
  const missing = ids.filter(id => id && !cstate.profiles.has(id));
  if (!missing.length) return;
  const { data } = await sb.from('profiles').select('id, username').in('id', missing);
  for (const p of data ?? []) cstate.profiles.set(p.id, p.username);
}

async function loadFriends() {
  const me = AUTH.user.id;
  const { data } = await sb.from('friendships').select('requester, addressee').eq('status', 'accepted');
  cstate.friends = (data ?? []).map(r => (r.requester === me ? r.addressee : r.requester));
  await loadProfiles(cstate.friends);
}

async function loadConvs() {
  const { data: convs } = await sb.from('conversations').select('id, kind, name, last_message_at').order('last_message_at', { ascending: false });
  const ids = (convs ?? []).map(c => c.id);
  const none = Promise.resolve({ data: [] });
  const [{ data: members }, { data: unread }, { data: last }] = await Promise.all([
    ids.length ? sb.from('conversation_members').select('conversation_id, user_id').in('conversation_id', ids) : none,
    sb.rpc('unread_counts'),
    ids.length ? sb.from('messages').select('conversation_id, sender, body, bet, created_at').in('conversation_id', ids)
      .order('created_at', { ascending: false }).limit(300) : none,
  ]);
  await loadProfiles([...new Set((members ?? []).map(m => m.user_id))]);
  cstate.convs = (convs ?? []).map(c => ({
    ...c,
    members: (members ?? []).filter(m => m.conversation_id === c.id).map(m => m.user_id),
    last: (last ?? []).find(m => m.conversation_id === c.id) ?? null,
  }));
  cstate.unread = new Map((unread ?? []).map(u => [u.conversation_id, Number(u.unread)]));
}

const convOf = id => cstate.convs.find(c => c.id === Number(id));
function convTitle(c) {
  if (c.kind === 'group') return c.name;
  return uname(c.members.find(id => id !== AUTH.user.id) ?? AUTH.user.id);
}
function preview(m) {
  if (!m) return 'Inga meddelanden än';
  const who = m.sender === AUTH.user.id ? 'Du: ' : '';
  return who + (m.bet ? '🎯 ' + (m.bet.label ?? 'Delat bet') : m.body);
}

// ---------- Ritning ----------

function listHtml() {
  if (!cstate.convs.length) {
    return `<p class="note chat-empty">Inga chattar än. Starta en <b>ny chatt</b> med en vän eller skapa en <b>grupp</b>.</p>`;
  }
  return cstate.convs.map(c => {
    const n = cstate.unread.get(c.id) ?? 0;
    const title = convTitle(c);
    return `<button class="chat-item${cstate.active === c.id ? ' on' : ''}${n ? ' unread' : ''}" data-open-conv="${c.id}">
      <span class="ci-av${c.kind === 'group' ? ' grp' : ''}">${c.kind === 'group' ? '#' : initialsOf(title)}</span>
      <span class="ci-main"><b>${esc(title)}</b><small>${esc(preview(c.last))}</small></span>
      <span class="ci-side">${c.last ? `<small>${stamp(c.last.created_at)}</small>` : ''}${n ? `<em>${n}</em>` : ''}</span>
    </button>`;
  }).join('');
}

function betCard(bet) {
  const m = findMatch(bet.match_id);
  const res = betResult(m, bet.pick);
  return `<div class="msg-bet r-${res}" ${m ? `role="button" tabindex="0" data-match="${m.id}"` : ''}>
    <div class="mb-top"><span class="sb-res">${RESULT_SHORT[res] ?? res}</span><small>${esc(bet.comp ?? '')}${bet.kickoff ? ' · ' + esc(dayText(bet.kickoff)) + ' ' + esc(clock(bet.kickoff)) : ''}</small></div>
    <b>${esc(bet.label)}</b>
    <small>${esc(bet.match_label ?? '')}${m?.score && res !== 'open' ? ` · ${m.score.h}–${m.score.a}` : ''}</small>
    <div class="mb-nums">${bet.p != null ? `<span>Vår chans <b>${pct(Number(bet.p))}</b></span>` : ''}${bet.odds ? `<span>Odds <b>${Number(bet.odds).toFixed(2)}</b>${bet.book ? ' hos ' + esc(bet.book) : ''}</span>` : ''}</div>
    ${m ? saveBtn(m, bet.pick, bet.label, bet.p, bet.odds, bet.book) : ''}
  </div>`;
}

function messageHtml(m, prev) {
  const mine = m.sender === AUTH.user.id;
  const c = convOf(m.conversation_id);
  const showName = !mine && c?.kind === 'group' && prev?.sender !== m.sender;
  return `<div class="msg${mine ? ' mine' : ''}">
    ${showName ? `<span class="msg-name">${esc(uname(m.sender))}</span>` : ''}
    ${m.bet ? betCard(m.bet) : ''}
    ${m.body ? `<div class="bubble">${esc(m.body)}</div>` : ''}
    <span class="msg-time">${stamp(m.created_at)}</span>
  </div>`;
}

function roomHtml() {
  const c = convOf(cstate.active);
  if (!c) {
    return `<div class="room-empty"><span class="label">BetValue chatt</span><h2>Snacka bets med kompisarna</h2>
      <p>Välj en chatt till vänster, eller starta en ny. Dela bets direkt i chatten – de rättas automatiskt när matchen är slut.</p></div>`;
  }
  const others = c.members.filter(id => id !== AUTH.user.id).map(uname);
  return `<header class="room-head">
      <button class="room-back" data-close-room aria-label="Tillbaka till chattlistan">←</button>
      <span class="ci-av${c.kind === 'group' ? ' grp' : ''}">${c.kind === 'group' ? '#' : initialsOf(convTitle(c))}</span>
      <div class="room-title"><b>${esc(convTitle(c))}</b><small>${c.kind === 'group' ? esc(['Du', ...others].join(', ')) : 'Vän'}</small></div>
      ${c.kind === 'group' ? '<button class="btn-mini" data-add-members>+ Lägg till</button>' : ''}
    </header>
    <div class="room-msgs" id="room-msgs">${cstate.messages.length
      ? cstate.messages.map((m, i) => messageHtml(m, cstate.messages[i - 1])).join('')
      : '<p class="note room-first">Inga meddelanden än. Säg hej eller dela ett bet!</p>'}</div>
    <form class="composer" id="composer" novalidate>
      <button type="button" class="btn-mini share-btn" data-share-picker>🎯 Dela bet</button>
      <textarea id="msg-input" rows="1" maxlength="1000" placeholder="Skriv ett meddelande…" aria-label="Meddelande"></textarea>
      <button class="send" type="submit" aria-label="Skicka">➤</button>
    </form>`;
}

function render() {
  const root = $('#main');
  if (!AUTH.user) {
    root.innerHTML = `<div class="locked"><b>Logga in för att chatta</b><span>Chatta med vänner och grupper och dela bets.</span>
      <a class="btn-gold" style="max-width:260px;text-decoration:none;text-align:center" href="konto.html?next=${encodeURIComponent(location.pathname)}">Logga in</a></div>`;
    return;
  }
  const draft = $('#msg-input')?.value ?? '';
  root.innerHTML = `<div class="chat${cstate.active ? ' room-open' : ''}">
    <aside class="chat-side">
      <div class="chat-side-head"><h2>Chattar</h2>
        <div><button class="btn-mini" data-new-dm>Ny chatt</button><button class="btn-mini gold" data-new-group>Ny grupp</button></div></div>
      <div class="chat-list" id="chat-list">${listHtml()}</div>
    </aside>
    <section class="chat-room" id="chat-room">${roomHtml()}</section>
  </div>`;
  const input = $('#msg-input');
  if (input) {
    input.value = draft;
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#composer').requestSubmit(); } });
    input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; });
    $('#composer').addEventListener('submit', sendText);
  }
  scrollDown();
}

function scrollDown() {
  const box = $('#room-msgs');
  if (box) box.scrollTop = box.scrollHeight;
}

// ---------- Handlingar ----------

async function openConv(id) {
  cstate.active = Number(id);
  const { data } = await sb.from('messages').select('id, conversation_id, sender, body, bet, created_at')
    .eq('conversation_id', cstate.active).order('created_at', { ascending: false }).limit(150);
  cstate.messages = (data ?? []).reverse();
  await loadProfiles([...new Set(cstate.messages.map(m => m.sender))]);
  markRead();
  render();
  $('#msg-input')?.focus();
}

async function markRead() {
  if (!cstate.active) return;
  cstate.unread.set(cstate.active, 0);
  await sb.from('conversation_members').update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', cstate.active).eq('user_id', AUTH.user.id);
  refreshNavUnread();
}

function refreshNavUnread() {
  AUTH.unread = [...cstate.unread.values()].reduce((t, n) => t + n, 0);
  if (typeof paintAccountLink === 'function') paintAccountLink();
}

async function send(row) {
  const { data, error } = await sb.from('messages').insert({ conversation_id: cstate.active, ...row })
    .select('id, conversation_id, sender, body, bet, created_at').single();
  if (error) { alertInline('Kunde inte skicka: ' + error.message); return false; }
  addMessage(data);
  return true;
}

async function sendText(e) {
  e.preventDefault();
  const input = $('#msg-input');
  const body = input.value.trim();
  if (!body) return;
  input.value = '';
  input.style.height = 'auto';
  if (!(await send({ body: body.slice(0, 1000) }))) input.value = body;
}

function alertInline(text) {
  const box = $('#room-msgs');
  if (box) box.insertAdjacentHTML('beforeend', `<p class="form-err">${esc(text)}</p>`);
  scrollDown();
}

// Lägger in ett meddelande (eget eller via Realtime) utan att rita om hela sidan.
function addMessage(m) {
  const c = convOf(m.conversation_id);
  if (c) { c.last = m; c.last_message_at = m.created_at; }
  cstate.convs.sort((a, b) => String(b.last_message_at).localeCompare(String(a.last_message_at)));
  if (m.conversation_id === cstate.active) {
    if (cstate.messages.some(x => x.id === m.id)) return;
    const prev = cstate.messages[cstate.messages.length - 1];
    cstate.messages.push(m);
    const box = $('#room-msgs');
    box?.querySelector('.room-first')?.remove();
    box?.insertAdjacentHTML('beforeend', messageHtml(m, prev));
    scrollDown();
    if (m.sender !== AUTH.user.id) markRead();
  } else if (m.sender !== AUTH.user.id) {
    cstate.unread.set(m.conversation_id, (cstate.unread.get(m.conversation_id) ?? 0) + 1);
    refreshNavUnread();
  }
  const list = $('#chat-list');
  if (list) list.innerHTML = listHtml();
}

// ---------- Ark: ny chatt, ny grupp, lägg till, dela bet ----------

function friendRows(ids, type) {
  if (!ids.length) return '<p class="note">Du har inga vänner att välja. Lägg till vänner under <a href="konto.html">Mitt konto</a>.</p>';
  return `<div class="pick-list">${ids.map(id => type === 'check'
    ? `<label class="pick"><input type="checkbox" value="${id}"><span class="ci-av">${initialsOf(uname(id))}</span><b>${esc(uname(id))}</b></label>`
    : `<button class="pick" data-dm-with="${id}"><span class="ci-av">${initialsOf(uname(id))}</span><b>${esc(uname(id))}</b><i>→</i></button>`).join('')}</div>`;
}

function newDmSheet() {
  pushSheet(async () => { await loadFriends(); return `<span class="label">Ny chatt</span><h2 class="sheet-h">Chatta med en vän</h2>${friendRows(cstate.friends, 'button')}`; });
}

function newGroupSheet() {
  pushSheet(async () => {
    await loadFriends();
    return `<span class="label">Ny grupp</span><h2 class="sheet-h">Skapa en grupp</h2>
      <form id="group-form" novalidate>
        <label class="f"><span>Gruppnamn</span><input id="group-name" maxlength="40" autocomplete="off"></label>
        <span class="label">Välj vänner</span>${friendRows(cstate.friends, 'check')}
        <p class="form-err" id="group-err" hidden></p>
        <button class="btn-gold" type="submit">Skapa grupp</button>
      </form>`;
  }, root => root.querySelector('#group-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const name = root.querySelector('#group-name').value.trim();
    const members = [...root.querySelectorAll('input[type=checkbox]:checked')].map(i => i.value);
    const err = root.querySelector('#group-err');
    if (!name) { err.textContent = 'Ge gruppen ett namn.'; err.hidden = false; return; }
    if (!members.length) { err.textContent = 'Välj minst en vän.'; err.hidden = false; return; }
    const { data, error } = await sb.rpc('create_group', { group_name: name, members });
    if (error) { err.textContent = error.message; err.hidden = false; return; }
    closeSheet();
    await loadConvs();
    openConv(data);
  }));
}

function addMembersSheet() {
  const c = convOf(cstate.active);
  pushSheet(async () => {
    await loadFriends();
    const candidates = cstate.friends.filter(id => !c.members.includes(id));
    return `<span class="label">${esc(c.name)}</span><h2 class="sheet-h">Lägg till i gruppen</h2>
      ${candidates.length ? `<form id="add-form" novalidate>${friendRows(candidates, 'check')}<p class="form-err" id="add-err" hidden></p>
        <button class="btn-gold" type="submit">Lägg till</button></form>` : '<p class="note">Alla dina vänner är redan med i gruppen.</p>'}`;
  }, root => root.querySelector('#add-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const members = [...root.querySelectorAll('input[type=checkbox]:checked')].map(i => i.value);
    if (!members.length) return;
    const { error } = await sb.rpc('add_to_group', { conv: c.id, members });
    if (error) { const err = root.querySelector('#add-err'); err.textContent = error.message; err.hidden = false; return; }
    closeSheet();
    await loadConvs();
    render();
  }));
}

async function mySavedBets() {
  const { data } = await sb.from('saved_bets').select('id, match_id, pick, label, match_label, kickoff, comp, p, odds, book')
    .order('kickoff', { ascending: false }).limit(60);
  return data ?? [];
}
const betPayload = b => ({ match_id: b.match_id, pick: b.pick, label: b.label, match_label: b.match_label, kickoff: b.kickoff, comp: b.comp, p: b.p, odds: b.odds, book: b.book });

function shareBetSheet() {
  pushSheet(async () => {
    const bets = await mySavedBets();
    cstate.shareable = bets;
    return `<span class="label">Dela i ${esc(convTitle(convOf(cstate.active)))}</span><h2 class="sheet-h">Välj ett av dina sparade bets</h2>
      ${bets.length ? `<div class="pick-list">${bets.map(b => `<button class="pick bet" data-share-saved="${b.id}">
        <span class="pb-main"><b>${esc(b.label)}</b><small>${esc(b.match_label)}${b.kickoff ? ' · ' + esc(dayText(b.kickoff)) : ''}</small></span><i>Dela</i></button>`).join('')}</div>`
        : '<p class="note">Du har inga sparade bets. Tryck på ＋ Spara på ett bet under Dagens värde först.</p>'}`;
  });
}

// ?share=ID från Sparade bets: välj vilken chatt betet ska till.
function shareToSheet(savedId) {
  pushSheet(async () => {
    const { data: bet } = await sb.from('saved_bets').select('id, match_id, pick, label, match_label, kickoff, comp, p, odds, book').eq('id', savedId).maybeSingle();
    if (!bet) return '<p class="empty">Hittade inte betet.</p>';
    cstate.shareable = [bet];
    return `<span class="label">Dela bet</span><h2 class="sheet-h">${esc(bet.label)}</h2><p class="note">${esc(bet.match_label)}</p>
      ${cstate.convs.length ? `<div class="pick-list">${cstate.convs.map(c => `<button class="pick" data-share-to="${c.id}" data-share-id="${bet.id}">
        <span class="ci-av${c.kind === 'group' ? ' grp' : ''}">${c.kind === 'group' ? '#' : initialsOf(convTitle(c))}</span><b>${esc(convTitle(c))}</b><i>Skicka</i></button>`).join('')}</div>`
        : '<p class="note">Du har inga chattar än. Starta en ny chatt eller grupp först.</p>'}`;
  });
}

document.addEventListener('click', async e => {
  const t = e.target.closest('[data-open-conv],[data-close-room],[data-new-dm],[data-new-group],[data-add-members],[data-share-picker],[data-dm-with],[data-share-saved],[data-share-to]');
  if (!t) return;
  e.preventDefault();
  if (t.dataset.openConv) openConv(t.dataset.openConv);
  else if ('closeRoom' in t.dataset) { cstate.active = null; render(); }
  else if ('newDm' in t.dataset) newDmSheet();
  else if ('newGroup' in t.dataset) newGroupSheet();
  else if ('addMembers' in t.dataset) addMembersSheet();
  else if ('sharePicker' in t.dataset) shareBetSheet();
  else if (t.dataset.dmWith) {
    t.disabled = true;
    const { data, error } = await sb.rpc('open_dm', { other: t.dataset.dmWith });
    if (error) { t.disabled = false; return; }
    closeSheet();
    await loadConvs();
    openConv(data);
  } else if (t.dataset.shareSaved) {
    const b = cstate.shareable.find(x => String(x.id) === t.dataset.shareSaved);
    closeSheet();
    if (b) send({ bet: betPayload(b) });
  } else if (t.dataset.shareTo) {
    const b = cstate.shareable.find(x => String(x.id) === t.dataset.shareId);
    closeSheet();
    await openConv(t.dataset.shareTo);
    if (b) send({ bet: betPayload(b) });
  }
});

// ---------- Start ----------

function connectRealtime() {
  if (cstate.channel) return;
  cstate.channel = sb.channel('betvalue-chat')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async payload => {
      const m = payload.new;
      if (!convOf(m.conversation_id)) { await loadConvs(); }
      await loadProfiles([m.sender]);
      addMessage(m);
    })
    .subscribe(status => { cstate.live = status === 'SUBSCRIBED'; });
}

// Reserv om Realtime inte är ansluten: hämta nytt var 8:e sekund.
setInterval(async () => {
  if (cstate.live || !AUTH.user || document.hidden) return;
  const before = cstate.messages.length;
  await loadConvs();
  if (cstate.active) {
    const lastAt = cstate.messages[cstate.messages.length - 1]?.created_at ?? '1970-01-01';
    const { data } = await sb.from('messages').select('id, conversation_id, sender, body, bet, created_at')
      .eq('conversation_id', cstate.active).gt('created_at', lastAt).order('created_at');
    await loadProfiles([...new Set((data ?? []).map(m => m.sender))]);
    for (const m of data ?? []) addMessage(m);
  }
  if (cstate.messages.length === before) { const list = $('#chat-list'); if (list) list.innerHTML = listHtml(); }
}, 8000);

async function start() {
  await AUTH.ready;
  if (!AUTH.user) return render();
  await Promise.all([loadConvs(), loadFriends()]);
  render();
  connectRealtime();
  if (params.get('dm')) {
    const { data } = await sb.rpc('open_dm', { other: params.get('dm') });
    if (data) { await loadConvs(); openConv(data); }
  } else if (params.get('share')) {
    shareToSheet(params.get('share'));
  } else if (params.get('c')) {
    openConv(params.get('c'));
  }
}

document.addEventListener('auth:changed', () => start());
boot('chatt', start).then(startLive);
