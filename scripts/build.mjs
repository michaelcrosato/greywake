import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const result = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2022'],
  write: false,
  legalComments: 'eof',
});
const html = await readFile('index.html', 'utf8'),
  css = await readFile('src/style.css', 'utf8'),
  js = result.outputFiles[0].text;
const notices = `GREYWAKE dependency licenses\n\nThree.js 0.186.1 — MIT\n${await readFile('node_modules/three/LICENSE', 'utf8')}\n\nRapier 3D compatibility 0.19.3 — Copyright Dimforge, Apache-2.0\n${await readFile('licenses/RAPIER-APACHE-2.0.txt', 'utf8')}`;
const standalone = html
  .replace('<link rel="stylesheet" href="/src/style.css" />', `<style>${css}</style>`)
  .replace(
    '<script type="module" src="/src/main.js"></script>',
    `<script>/* ${notices.replaceAll('*/', '* /')} */\n${js.replaceAll('</script', '<\\/script')}</script>`,
  );
await mkdir('dist', { recursive: true });
await writeFile('dist/greywake.html', standalone);
await rm('dist/index.html', { force: true });
await writeFile('dist/THIRD-PARTY-LICENSES.txt', notices);
console.log(
  `Built dist/greywake.html (${(Buffer.byteLength(standalone) / 1024 / 1024).toFixed(2)} MB): inline JavaScript, styles, procedural assets, and Rapier WASM.`,
);
