import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { BOOT_STAGES } from '../src/boot-loader.js';

const folder = 'artifacts/boot';
await mkdir(folder, { recursive: true });
const html = await readFile('dist/greywake.html', 'utf8');
const server = createServer((request, response) => {
  let content = html;
  if (request.url.startsWith('/bad-payload'))
    content = content.replace(
      /(<script id="game-bundle"[^>]*>)[\s\S]*?(<\/script>)/,
      `$1${Buffer.from('this is not JavaScript !!!').toString('base64')}$2`,
    );
  if (request.url.startsWith('/no-loader'))
    content = content.replace(/<script>\(\(\)=>[\s\S]*?<\/script>/, '');
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end(content);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  headless: false,
  args: [
    '--no-sandbox',
    '--disable-gpu-watchdog',
    '--enable-unsafe-webgpu',
    '--enable-unsafe-swiftshader',
    '--use-angle=vulkan',
    '--use-vulkan=swiftshader',
    '--use-webgpu-adapter=swiftshader',
    '--disable-vulkan-surface',
    '--enable-features=Vulkan',
  ],
});
const report = { passed: false, checks: [], cases: [] };
const pass = (name) => {
  report.checks.push(name);
  console.log(`PASS ${name}`);
};
async function ready(page) {
  await page.waitForFunction(
    () => window.greywake?.ready || window.gameBoot?.report.status === 'failed',
    null,
    { timeout: 120000 },
  );
  const state = await page.evaluate(() => ({
    boot: gameBoot.snapshot(),
    ready: window.greywake?.ready,
    errors: window.__consoleErrors,
  }));
  assert.equal(state.boot.status, 'ready', JSON.stringify(state.boot.errors));
  assert.equal(state.ready, true);
  assert.deepEqual(state.errors, []);
  assert.deepEqual(
    state.boot.stages.map(({ code, status }) => [code, status]),
    BOOT_STAGES.map(([code]) => [code, 'ok']),
  );
  assert.equal(state.boot.percent, 100);
  assert.match(state.boot.buildId, /^[a-f0-9]{12}$/);
  assert.ok(state.boot.platform.userAgent);
  assert.ok(state.boot.adapter.description);
  await page.evaluate(async () => {
    greywake.app.sim.paused = true;
    greywake.app.view.render = () => {};
    const backend = greywake.app.view.renderer.backend;
    if (backend.device) await backend.device.queue.onSubmittedWorkDone();
    else backend.gl.finish();
  });
  return state;
}
try {
  const context = await browser.newContext({ viewport: { width: 960, height: 700 } });
  let page = await context.newPage();
  await page.addInitScript(() => {
    const instantiate = WebAssembly.instantiate.bind(WebAssembly);
    WebAssembly.instantiate = (...args) =>
      args[0]?.byteLength === 8
        ? new Promise((resolve, reject) => {
            window.releaseBootWasm = () => instantiate(...args).then(resolve, reject);
          })
        : instantiate(...args);
  });
  await page.goto(base);
  await page.waitForFunction(() => window.releaseBootWasm && window.gameBoot?.report.stage === 'WASM');
  assert.deepEqual(
    await page.evaluate(() => ({
      canvas: !!document.getElementById('sea'),
      runtime: !!window.GameRuntime,
      ui: document.getElementById('game-root').children.length,
      styles: document.styleSheets.length,
      ready: !!window.greywake?.ready,
    })),
    { canvas: false, runtime: false, ui: 0, styles: 1, ready: false },
  );
  await page.screenshot({ path: `${folder}/preflight.png` });
  pass('Preflight runs without the game canvas, runtime, UI, styles or main loop');
  await page.evaluate(() => releaseBootWasm());
  const gpu = await ready(page);
  assert.equal(gpu.boot.renderer, 'WebGPU');
  await page.click('#launch-settings');
  await page.getByRole('button', { name: 'Startup diagnostics', exact: true }).click();
  await page.screenshot({ path: `${folder}/ready-webgpu.png` });
  const download = page.waitForEvent('download');
  await page.click('#boot-download');
  await (await download).saveAs(`${folder}/downloaded-report.json`);
  const downloaded = JSON.parse(await readFile(`${folder}/downloaded-report.json`, 'utf8'));
  assert.equal(downloaded.buildId, gpu.boot.buildId);
  assert.equal(downloaded.schema, 'game-boot/1');
  await page.click('#boot-return');
  assert.equal(await page.locator('#launch').isVisible(), true);
  pass('WebGPU completes every stage, exports diagnostics and returns to the launch screen');
  await page.click('#close-modal');
  await page.click('#begin');
  if (await page.locator('#guide-skip').isVisible()) await page.click('#guide-skip');
  await page.evaluate(() => {
    greywake.app.sim.paused = false;
    gameBoot.open();
  });
  assert.equal(await page.evaluate(() => greywake.app.sim.paused), true);
  await page.click('#boot-return');
  assert.equal(await page.evaluate(() => greywake.app.sim.paused), false);
  pass('Reopening diagnostics pauses a live patrol and restores its prior pause state');
  report.cases.push(gpu.boot);
  await page.close();

  for (const [name, inject, path] of [
    ['webgl', () => {}, '/?renderer=webgl'],
    [
      'gpu-fallback',
      () => {
        Object.defineProperty(navigator, 'gpu', {
          value: { requestAdapter: () => Promise.reject(new Error('GPU driver unavailable')) },
          configurable: true,
        });
      },
      '/',
    ],
    [
      'optional-features',
      () => {
        Object.defineProperty(window, 'localStorage', {
          get: () => {
            throw new DOMException('Storage denied', 'SecurityError');
          },
          configurable: true,
        });
        window.AudioContext = window.webkitAudioContext = undefined;
      },
      '/?renderer=webgl',
    ],
  ]) {
    page = await context.newPage();
    await page.addInitScript(inject);
    await page.goto(base + path);
    const state = await ready(page);
    assert.equal(state.boot.renderer, 'WebGL 2');
    if (name === 'gpu-fallback')
      assert.ok(state.boot.errors.some((error) => error.code === 'GPU-FALLBACK' && !error.fatal));
    if (name === 'optional-features') assert.equal(state.boot.capabilities.storage, false);
    report.cases.push(state.boot);
    await page.close();
    pass(`${name}: startup succeeds with supported fallback and optional-feature diagnostics`);
  }

  for (const [name, inject, path, expected, stage] of [
    [
      'missing-promises',
      () => {
        window.Promise = undefined;
      },
      '/',
      'SYS-MISSING',
      'SYS',
    ],
    [
      'missing-hdr',
      () => {
        const extension = WebGL2RenderingContext.prototype.getExtension;
        WebGL2RenderingContext.prototype.getExtension = function (name) {
          return /EXT_color_buffer_(float|half_float)/.test(name) ? null : extension.call(this, name);
        };
      },
      '/?renderer=webgl',
      'GPU-HDR',
      'GPU',
    ],
    [
      'first-frame-failure',
      () => {
        const get = WebGL2RenderingContext.prototype.getError;
        WebGL2RenderingContext.prototype.getError = function () {
          return window.gameBoot?.report.stage === 'FRAME' ? this.INVALID_OPERATION : get.call(this);
        };
      },
      '/?renderer=webgl',
      'FRAME-FAIL',
      'FRAME',
    ],
    [
      'missing-wasm',
      () => {
        window.WebAssembly = undefined;
      },
      '/',
      'SYS-MISSING',
      'SYS',
    ],
    [
      'missing-graphics',
      () => {
        Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
        const get = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (name, ...args) {
          return name === 'webgl2' ? null : get.call(this, name, ...args);
        };
      },
      '/',
      'GPU-NONE',
      'GPU',
    ],
    [
      'wasm-failure',
      () => {
        WebAssembly.instantiate = () => Promise.reject(new Error('WASM execution denied'));
      },
      '/',
      'WASM-FAIL',
      'WASM',
    ],
    [
      'wasm-stall',
      () => {
        WebAssembly.instantiate = () => new Promise(() => {});
        const timer = window.setTimeout;
        window.setTimeout = (fn, ms, ...args) => timer(fn, ms === 8000 ? 60 : ms, ...args);
      },
      '/',
      'WASM-TIME',
      'WASM',
    ],
    ['bad-runtime', () => {}, '/bad-payload?renderer=webgl', 'LOAD-UNCAUGHT', 'LOAD'],
    [
      'physics-failure',
      () => {
        const init = WebAssembly.instantiate.bind(WebAssembly);
        WebAssembly.instantiate = (...args) =>
          args[0]?.byteLength === 8 ? init(...args) : Promise.reject(new Error('Physics WASM refused'));
      },
      '/?renderer=webgl',
      'PHY-FAIL',
      'PHY',
    ],
    [
      'renderer-failure',
      () => {
        const get = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (name, ...args) {
          return name === 'webgl2' && this.id === 'sea' ? null : get.call(this, name, ...args);
        };
      },
      '/?renderer=webgl',
      'RENDER-FAIL',
      'RENDER',
    ],
    [
      'shader-failure',
      () => {
        GPUDevice.prototype.createRenderPipelineAsync = () =>
          Promise.reject(new Error('Shader compilation refused'));
      },
      '/',
      'SHDR-FAIL',
      'SHDR',
    ],
    [
      'script-stall',
      () => {
        const timer = window.setTimeout;
        window.setTimeout = (fn, ms, ...args) => timer(fn, ms === 15000 ? 200 : ms, ...args);
      },
      '/no-loader',
      'SCRIPT-TIME',
      null,
    ],
  ]) {
    const failureContext = await browser.newContext({ viewport: { width: 393, height: 852 } });
    page = await failureContext.newPage();
    await page.addInitScript(inject);
    await page.goto(base + path);
    if (name === 'missing-promises') {
      // Playwright's in-page polling itself needs Promise; use isolated DOM polling.
      await page.locator('#boot-error').waitFor({ state: 'visible', timeout: 10000 });
    } else {
      await page.waitForFunction(
        () => window.gameBoot?.report.status === 'failed' || window.__bootSentinel?.failure,
        null,
        { timeout: 120000 },
      );
    }
    const failure = await page.evaluate(() => window.gameBoot?.snapshot() || window.__bootSentinel.failure);
    assert.equal(failure.failureCode || failure.code, expected, JSON.stringify(failure));
    if (stage) assert.equal(failure.stage, stage);
    assert.equal(await page.evaluate(() => !!window.greywake?.ready), false);
    assert.equal(await page.locator('#boot-root').isVisible(), true);
    assert.equal(await page.locator('#game-root').isVisible(), false);
    const box = await page.locator('#boot-error').boundingBox();
    assert.ok(box && box.y >= 0 && box.y + box.height <= 852, 'Failure code must remain visible on a phone');
    await page.screenshot({ path: `${folder}/${name}.png` });
    await page.click('#boot-copy');
    assert.equal(await page.locator('#boot-report').isVisible(), true);
    assert.ok((await page.locator('#boot-report').inputValue()).includes(expected));
    report.cases.push(failure);
    await failureContext.close();
    pass(`${name}: readable ${expected} diagnostic, frozen failure state, no game loop`);
  }
  const offline = await browser.newContext();
  page = await offline.newPage();
  const requests = [];
  await page.route(/^https?:/, (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  await page.goto(`${pathToFileURL(resolve('dist/greywake.html'))}?renderer=webgl`);
  await ready(page);
  assert.deepEqual(requests, []);
  await offline.close();
  pass('Standalone file boots through WebGL with HTTP traffic blocked');
  const noJS = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 393, height: 852 } });
  page = await noJS.newPage();
  await page.goto(base);
  assert.match(await page.locator('#boot-root').innerText(), /SYS-JS-OFF/);
  assert.match(await page.locator('#boot-build').innerText(), /^[a-f0-9]{12}$/);
  assert.equal(await page.locator('#sea').count(), 0);
  await page.screenshot({ path: `${folder}/javascript-disabled.png` });
  await noJS.close();
  pass('JavaScript-disabled browsers retain a static diagnostic screen and build identity');
  await context.close();
  report.passed = true;
} catch (error) {
  report.failure = error.stack;
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(`${folder}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
