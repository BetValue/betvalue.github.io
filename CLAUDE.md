# Matchvärde

Privat fotbollssida (för användaren och kompisar): statistik à la FotMob + värdebets mot spelbolagens odds. Svenska i UI och commits.

- Statisk sida: `index.html`, `app.js`, `style.css` läser `data/latest.json`.
- `scripts/fetch.mjs` (Node 22, inga beroenden) hämtar statistik från football-data.org (gratis: PL, PD, BL1, SA, FL1, CL, EC, WC – 10 anrop/min) och odds från The Odds API (gratis: 500 anrop/mån; h2h+totals = 2 anrop per liga och hämtning, därför bara en gång per dygn, `--odds` tvingar). Nations League finns bara hos The Odds API → endast odds, ingen modell.
- `scripts/model.mjs`: Poisson med anfalls-/försvarsstyrka, tidsviktad, krympt mot ligasnitt. `scripts/match.mjs` kopplar ihop lagnamn mellan API:erna.
- Slutlig sannolikhet = vikt × modell + (1 − vikt) × marknadens marginalfria snitt (vikt 0,4/0,3/0,15 efter modellens säkerhet). Värde = p × bästa odds − 1 ≥ 4 %.
- `.github/workflows/update.yml` kör var 3:e timme med secrets `FOOTBALL_DATA_KEY` och `ODDS_API_KEY` och committar `data/`.
- Lokalt: `FOOTBALL_DATA_KEY=… ODDS_API_KEY=… node scripts/fetch.mjs`, servera mappen över http (fetch funkar inte från file://).
