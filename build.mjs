// Сборка angar_map.html: один самодостаточный файл без сети.
//   three.js + нужные аддоны → минифицированный классический <script> (globalThis.__THREE)
//   src/game.js              → читаемый <script type="module">, импорты three подменяются на __THREE
//   vendor/ammo.wasm.js      → как есть; vendor/ammo.wasm.wasm → base64 в <script type="application/octet-stream">
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const read = f => readFileSync(new URL(f, import.meta.url));

const threeBundle = await build({
  entryPoints: [new URL('./src/three-entry.js', import.meta.url).pathname],
  bundle: true, write: false, minify: true, format: 'iife', globalName: '__THREE',
  target: 'es2020', legalComments: 'none'
});

// Импорты three в коде игры читают уже загруженный глобальный бандл.
const shim = {
  name: 'three-global',
  setup(b){
    b.onResolve({ filter: /^three(\/.*)?$/ }, a => ({ path: a.path, namespace: 'three-global' }));
    b.onLoad({ filter: /.*/, namespace: 'three-global' }, a => ({
      contents: a.path === 'three' ? 'module.exports = globalThis.__THREE.THREE;'
        : a.path.endsWith('BufferGeometryUtils.js') ? 'module.exports = globalThis.__THREE.BGU;'
        : 'module.exports = globalThis.__THREE;',
      loader: 'js'
    }));
  }
};
const game = await build({
  entryPoints: [new URL('./src/game.js', import.meta.url).pathname],
  bundle: true, write: false, minify: false, format: 'esm', target: 'es2020',
  plugins: [shim], legalComments: 'inline', charset: 'utf8'
});

const guard = s => s.replace(/<\/script/gi, '<\\/script');
const html = read('./src/index.html').toString()
  .replace('<!--THREE_BUNDLE-->', () => '<!-- three.js r166.1, MIT license -->\n<script>' + guard(threeBundle.outputFiles[0].text) + '</script>')
  .replace('<!--GAME-->', () => guard(game.outputFiles[0].text))
  .replace('<!--AMMO-->', () => guard(read('./vendor/ammo.wasm.js').toString()))
  .replace('<!--AMMO_WASM-->', () => read('./vendor/ammo.wasm.wasm').toString('base64'));
writeFileSync(new URL('./angar_map.html', import.meta.url), html);
console.log(`angar_map.html: ${(html.length/1024/1024).toFixed(2)} MB`);
