// Liveuppdatering: var 30:e sekund hämtas ställning, matchminut och status från ESPN för
// matcher som pågår eller precis ska börja. Matcherna i DATA.latest uppdateras och sidan
// får händelsen "live:update" så att den kan rita om. data/latest.json uppdateras bara var
// tredje timme, så utan det här skulle livematcher stå still.

const LIVE_EVERY_MS = 30000;
const liveState = { timer: null, lastRun: 0 };

const ymdUtc = d => d.toISOString().slice(0, 10).replace(/-/g, '');

// Matcher som kan vara igång: avspark från 3 timmar sedan till 15 minuter fram, eller redan live.
function liveCandidates() {
  const now = Date.now();
  return everyMatch().filter(m => LIVE.has(m.status)
    || ((UPCOMING.has(m.status) || m.status === 'FINISHED' && m.liveFromEspn) && Date.parse(m.utc) < now + 15 * 6e4 && Date.parse(m.utc) > now - 3 * 36e5));
}

function espnStatus(ev) {
  const st = ev.status?.type ?? ev.competitions?.[0]?.status?.type ?? {};
  if (st.state === 'post') return 'FINISHED';
  if (st.state === 'in') return /HALFTIME/i.test(st.name ?? '') ? 'PAUSED' : 'IN_PLAY';
  if (/POSTPONED/i.test(st.name ?? '')) return 'POSTPONED';
  return null; // inte startad
}

async function liveTick() {
  if (document.hidden || !DATA.latest) return;
  const candidates = liveCandidates();
  if (!candidates.length) return;
  liveState.lastRun = Date.now();
  const changed = [];
  const bySlug = new Map();
  for (const m of candidates) {
    const slug = SLUG[m.comp.id];
    if (slug) bySlug.set(slug, [...(bySlug.get(slug) ?? []), m]);
  }
  for (const [slug, ms] of bySlug) {
    const days = [...new Set(ms.map(m => ymdUtc(new Date(m.utc))))];
    for (const day of days) {
      let sb;
      try {
        const res = await fetch(`${ESPN}${slug}/scoreboard?dates=${day}&t=${Date.now()}`);
        if (!res.ok) continue;
        sb = await res.json();
      } catch { continue; }
      for (const ev of sb.events ?? []) {
        const comp = ev.competitions?.[0];
        const home = comp?.competitors?.find(c => c.homeAway === 'home'), away = comp?.competitors?.find(c => c.homeAway === 'away');
        if (!home || !away) continue;
        const m = ms.find(x => Math.abs(Date.parse(ev.date) - Date.parse(x.utc)) < 3 * 36e5
          && nameSim(home.team.displayName, x.home.name) > 0 && nameSim(away.team.displayName, x.away.name) > 0);
        if (!m) continue;
        const status = espnStatus(ev);
        if (!status) continue;
        // Uppdatera originalmatchen i DATA (everyMatch() ger kopior).
        const orig = m.comp.matches.find(x => x.id === m.id);
        const score = { h: Number(home.score) || 0, a: Number(away.score) || 0 };
        const minute = status === 'PAUSED' ? 'Paus' : status === 'IN_PLAY' ? (ev.status?.displayClock ?? comp.status?.displayClock ?? '') : null;
        // Målskyttar (för rättning av målskyttebets).
        const goals = (comp.details ?? []).filter(d => d.scoringPlay).map(d => ({
          side: String(d.team?.id) === String(home.team?.id) ? 'home' : 'away',
          name: d.athletesInvolved?.[0]?.displayName ?? null, og: !!d.ownGoal, min: d.clock?.displayValue ?? null,
        }));
        if (goals.length || !orig.goals) orig.goals = goals;
        const bigChange = orig.status !== status || orig.score?.h !== score.h || orig.score?.a !== score.a;
        if (bigChange || orig.minute !== minute) {
          Object.assign(orig, { status, score, minute, liveFromEspn: true });
          changed.push({ id: orig.id, bigChange });
        }
      }
    }
  }
  if (changed.length) {
    // Vid mål eller ny status ska matchens sammanfattning (statistik, byten) hämtas på nytt.
    if (changed.some(c => c.bigChange)) for (const key of [...espnCache.keys()]) if (key.includes('/summary?')) espnCache.delete(key);
    document.dispatchEvent(new CustomEvent('live:update', { detail: changed }));
  }
}

function startLive() {
  if (liveState.timer) return;
  liveTick();
  liveState.timer = setInterval(liveTick, LIVE_EVERY_MS);
  // Kom man tillbaka till fliken efter en stund: uppdatera direkt.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - liveState.lastRun > 15000) liveTick(); });
}

// Gemensamt för alla sidor: resultatraden och en öppen match ritas om.
document.addEventListener('live:update', e => {
  if (typeof renderTicker === 'function') renderTicker();
  const board = document.querySelector('#sheet:not([hidden]) #sheet-body .board[data-board]');
  if (!board) return;
  const hit = e.detail?.find(c => String(c.id) === board.dataset.board);
  if (!hit) return;
  const m = findMatch(hit.id);
  const mid = board.querySelector('.duel .mid');
  if (m && mid) mid.innerHTML = midHtml(m);
  if (hit.bigChange && m) loadMatchExtras(m, document.querySelector('#sheet-body')); // ny ställning: ny statistik
});
