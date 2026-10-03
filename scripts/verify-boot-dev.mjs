import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  headless: false,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 700 } }),
    requests = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.addInitScript(() => {
    const original = WebAssembly.instantiate.bind(WebAssembly);
    WebAssembly.instantiate = (...args) =>
      args[0]?.byteLength === 8
        ? new Promise((resolve) => {
            window.releaseBoot = () => original(...args).then(resolve);
          })
        : original(...args);
  });
  await page.goto(process.env.BOOT_DEV_URL || 'http://localhost:4185/?renderer=webgl');
  await page.waitForFunction(() => window.gameBoot?.report.stage === 'WASM' && window.releaseBoot);
  assert.ok(
    !requests.some((url) => /\/src\/(main\.js|style\.css|ui\.js|simulation\.js)/.test(url)),
    JSON.stringify(requests),
  );
  assert.equal(await page.locator('#sea').count(), 0);
  assert.equal(await page.evaluate(() => document.styleSheets.length), 1);
  await page.evaluate(() => releaseBoot());
  await page.waitForFunction(
    () => window.greywake?.ready || window.gameBoot.report.status === 'failed',
    null,
    { timeout: 120000 },
  );
  const boot = await page.evaluate(() => gameBoot.snapshot());
  assert.equal(boot.status, 'ready', JSON.stringify(boot.errors));
  assert.equal(boot.renderer, 'WebGL 2');
  assert.ok(requests.some((url) => url.includes('/src/main.js')));
  assert.ok(requests.some((url) => url.includes('/src/style.css')));
  assert.deepEqual(await page.evaluate(() => window.__consoleErrors), []);
  await writeFile(
    'artifacts/boot/development.json',
    JSON.stringify({ passed: true, boot, requests }, null, 2),
  );
  console.log('PASS Vite defers game modules/styles until preflight completes, then boots successfully');
} finally {
  await browser.close();
}
