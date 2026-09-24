// Сборка оружейных страниц: каждая — один самодостаточный HTML (three.js с unpkg).
// Движок общий, в один модуль склеиваются: prelude → engine (порядок из order.txt) → оружие → entry.
//   node weapons/build.mjs  → weapons/{svd,mp5a3,glock18c,remington870}.html
import { readFileSync, writeFileSync } from 'node:fs';

const here = new URL('./', import.meta.url);
const read = f => readFileSync(new URL(f, here), 'utf8');

const WEAPONS = [
  { out: 'svd.html', title: 'СВД — оружейная', id: 'svd', src: ['src/weapons/svd.js', 'src/entries/svd.js'] },
  { out: 'mp5a3.html', title: 'HK MP5A3 — оружейная', id: 'mp5a3', src: ['src/weapons/mp5.js', 'src/entries/mp5a3.js'] },
  { out: 'glock18c.html', title: 'Glock 18C — оружейная', id: 'glock18c', src: ['src/weapons/glock18c.js', 'src/entries/glock18c.js'] },
  { out: 'remington870.html', title: 'Remington 870 — оружейная', id: 'm870', src: ['src/weapons/m870.js', 'src/entries/m870.js'] }
];

const order = read('src/order.txt').split('\n').filter(Boolean);
const engine = [read('src/prelude.js'), ...order.map(f => read(f))];
const head = read('src/head.html'), tail = read('src/tail.html');

for (const w of WEAPONS) {
  const body = [...engine, ...w.src.map(read)].map(s => s.replace(/\n$/, '')).join('\n');
  const html = head.replace('%TITLE%', w.title).replace('%WEAPON%', w.id) + body + '\n' + tail.replace(/\n$/, '');
  writeFileSync(new URL(w.out, here), html);
  console.log(`${w.out}: ${(html.length / 1024).toFixed(0)} KB`);
}
