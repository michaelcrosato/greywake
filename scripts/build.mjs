import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const options = { bundle: true, minify: true, write: false, legalComments: 'eof', charset: 'ascii' };
const [game, bootstrap, html, css, sentinel, pkg] = await Promise.all([
  build({
    ...options,
    entryPoints: ['src/main.js'],
    format: 'iife',
    globalName: 'GameRuntime',
    target: ['es2022'],
  }),
  build({
    ...options,
    entryPoints: ['src/boot.js'],
    format: 'iife',
    target: ['es2017'],
    external: ['./main.js'],
  }),
  readFile('index.html', 'utf8'),
  readFile('src/style.css', 'utf8'),
  readFile('src/boot-sentinel.js', 'utf8'),
  readFile('package.json', 'utf8'),
]);
const js = game.outputFiles[0].text,
  loader = bootstrap.outputFiles[0].text;
const version = JSON.parse(pkg).version;
const buildId = createHash('sha256')
  .update(html + css + js + loader + sentinel + version)
  .digest('hex')
  .slice(0, 12);
const notices = `GREYWAKE dependency licenses\n\nThree.js 0.186.1 — MIT\n${await readFile('node_modules/three/LICENSE', 'utf8')}\n\nRapier 3D compatibility 0.19.3 — Copyright Dimforge, Apache-2.0\n${await readFile('licenses/RAPIER-APACHE-2.0.txt', 'utf8')}`;
const standalone = html
  .replace('<link rel="stylesheet" href="/src/style.css" />', `<style>${css}</style>`)
  .replace('<script src="/src/boot-sentinel.js"></script>', `<script>${sentinel}</script>`)
  .replace('content="development"', `content="${buildId}"`)
  .replace('id="boot-build">development', `id="boot-build">${buildId}`)
  .replace('name="game-version" content="1.0.0"', `name="game-version" content="${version}"`)
  .replace('id="boot-version">1.0.0', `id="boot-version">${version}`)
  .replace(
    '<script type="module" src="/src/boot.js"></script>',
    `<script id="game-bundle" type="application/octet-stream">${Buffer.from(js).toString('base64')}</script>\n<script>${loader.replaceAll('</script', '<\\/script')}</script>\n<!-- ${notices.replaceAll('--', '- -')} -->`,
  );
await mkdir('dist', { recursive: true });
await writeFile('dist/greywake.html', standalone);
await rm('dist/index.html', { force: true });
await writeFile('dist/THIRD-PARTY-LICENSES.txt', notices);
console.log(
  `Built dist/greywake.html (${(Buffer.byteLength(standalone) / 1024 / 1024).toFixed(2)} MB), version ${version}, build ${buildId}, boot code ${(Buffer.byteLength(loader) / 1024).toFixed(1)} KB.`,
);
