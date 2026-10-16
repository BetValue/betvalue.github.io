// Sätter ett versionsnummer på sidans egna CSS- och JS-filer i alla HTML-sidor
// (style.css?v=…, app.js?v=…), så att webbläsare hämtar den nya versionen direkt
// efter en uppdatering i stället för att köra en gammal kopia från cachen.
//
//   node scripts/stamp.mjs        (kör före varje commit som ändrar CSS/JS)

import { readdir, readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const version = new Date().toISOString().replace(/\D/g, '').slice(0, 12);
const own = /((?:href|src)=")((?:[a-z]+\/)?[a-z-]+\.(?:css|js))(?:\?v=\w+)?(")/g;

for (const file of (await readdir(root)).filter(f => f.endsWith('.html'))) {
  const url = new URL(file, root);
  const html = await readFile(url, 'utf8');
  const next = html.replace(own, (_, a, path, b) => `${a}${path}?v=${version}${b}`);
  if (next !== html) await writeFile(url, next);
}
console.log('Version', version);
