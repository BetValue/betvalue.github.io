# Simon-Casper gamble projekt

Privat fotbollssida (för användaren och kompisar): statistik à la FotMob + värdebets mot spelbolagens odds. Man spelar inte på sidan och vi länkar inte till spelbolag – den visar bara statistik och värde. Svenska i UI och commits. Live: https://simmpro123.github.io/simon-casper-gamble-projekt/ (GitHub Pages, main). Commit + push publicerar.

## Sidor
- `index.html` + `app.js`: Matcher (per dag, "Matchen i fokus") och `#tabeller` (tabeller med zoner + skytteliga).
- `dagens-varde.html` + `dagens.js`: Dagens bästa bet (guld, "Bäst värde"), enskilda spel, bet builders, målskyttar.
- `boostar.html` + `boostar.js`: boost-kalkylator + lista från `data/boosts.json` (läggs in för hand, se kommentar överst i boostar.js för formatet och pick-nycklarna).
- `espn.js`: startelvor (plan + avbytare, förra matchens elva innan den släppts), matchstatistik, spelarprofil (säsong, trender, match för match, per turnering) och klubbsida (trupp med statistik). Hämtas direkt i webbläsaren från ESPN:s öppna API (site.api.espn.com / site.web.api.espn.com, CORS öppet) – utom lagslistan `/teams` och `/teams/{id}` som saknar CORS, därför kopplas våra lag → ESPN-lag (id, färg, logga) i fetch.mjs (`competition.espn`). Headless-webbläsare blockeras av ESPN; testa med vanlig user-agent. Direktlänkar: `?match=`, `?player=ID&slug=eng.1&team=`, `?club=LAGID&comp=PL`.
- `common.js`: delad kod (hjälpfunktioner, `marketsFor`, matchdetaljer i bottenarket, resultatrad, `boot()`). `style.css` delas av alla sidor. HTML-skalet är detsamma på alla tre sidor – ändra menyn på alla.

## Data
- `scripts/fetch.mjs` (Node 22, inga beroenden) → `data/latest.json`. football-data.org (gratis: PL, PD, BL1, SA, FL1, CL, EC, WC – 10 anrop/min, matcher + tabell + skytteliga per liga, inbördes möten för matcher inom 48 h cachas i `data/h2h.json`). The Odds API (gratis 500 anrop/mån; h2h+totals = 2 anrop per liga, därför en gång per dygn, `--odds` tvingar) → `data/odds.json`. Nations League bara odds.
- Spelbolagens boostar finns inte gratis – sidan säger det öppet.
- `scripts/model.mjs`: Poisson, tidsviktad, krympt mot ligasnitt; ger resultatmatris. `scripts/markets.mjs`: enskilda spel, bet builders och målskyttar ur matrisen (spelarens andel av lagets mål × 0,85). `scripts/match.mjs` kopplar lagnamn mellan API:erna.
- Slutlig sannolikhet = vikt × modell + (1 − vikt) × marknadens marginalfria snitt (vikt 0,4/0,3/0,15 efter modellens säkerhet). Värde = p × bästa odds − 1 ≥ 4 %. Utan odds visas "värde från" = 1,05 / p.
- `.github/workflows/update.yml` kör var 3:e timme med secrets `FOOTBALL_DATA_KEY` och `ODDS_API_KEY` och committar `data/`.
- Lokalt: `FOOTBALL_DATA_KEY=… node scripts/fetch.mjs` (~6 min p.g.a. takten), servera mappen över http (fetch funkar inte från file://).
