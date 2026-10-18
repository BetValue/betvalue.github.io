// Facit: hur alla tips från Dagens värde har gått, öppet för alla.

const tstate = { days: 30 };
const PERIODS = [[7, '7 dagar'], [30, '30 dagar'], [Infinity, 'Allt']];

async function render() {
  $('#main').innerHTML = `<div class="days tips-periods">${PERIODS.map(([d, label]) =>
    `<button class="day${d === tstate.days ? ' active' : ''}" data-tdays="${d}"><b>${label}</b></button>`).join('')}</div>
    ${(await trackHtml(tstate.days, true)) || '<p class="empty">Inga avgjorda tips under den här perioden än.</p>'}`;
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-tdays]');
  if (!t) return;
  tstate.days = Number(t.dataset.tdays);
  render();
});

boot('tips', render).then(startLive);
