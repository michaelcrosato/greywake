import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

await mkdir('artifacts', { recursive: true });
const html = await readFile('dist/greywake.html');
const server = createServer((_, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end(html);
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
const report = { checks: [], errors: [], screenshots: [], adapter: null };
const check = (name, details = '') => {
  report.checks.push({ name, details });
  console.log(`PASS ${name}${details ? ` · ${details}` : ''}`);
};
function watch(page) {
  page.on('pageerror', (e) => report.errors.push(e.stack));
  page.on('console', (m) => {
    if (m.type() === 'error') report.errors.push(m.text());
  });
}
async function ready(page, url) {
  watch(page);
  await page.goto(url);
  await page.waitForFunction(() => window.greywake?.ready, null, { timeout: 60000 });
  assert.deepEqual(await page.evaluate(() => window.__consoleErrors), []);
}
async function startPatrol(page) {
  await page.click('#begin');
  if (await page.locator('#guide-skip').isVisible()) await page.click('#guide-skip');
}
async function shot(page, name) {
  const path = `artifacts/${name}.png`;
  // Drain queued software-GPU frames without submitting more during capture.
  await page.evaluate(async () => {
    const view = greywake.app.view;
    window.captureRender = view.render;
    view.render = () => {};
    if (view.renderer.backend.device) await view.renderer.backend.device.queue.onSubmittedWorkDone();
    else view.renderer.backend.gl.finish();
  });
  try {
    await page.screenshot({ path, timeout: 120000 });
  } finally {
    await page.evaluate(() => {
      greywake.app.view.render = window.captureRender;
    });
  }
  report.screenshots.push(path);
}
async function panel(page, name) {
  await page.locator(`.side-nav [data-panel="${name}"]`).click();
}
async function close(page) {
  await page.locator('#close-modal').click();
}
async function step(page, seconds) {
  await page.evaluate((seconds) => {
    const sim = greywake.app.sim;
    for (let i = 0; i < seconds * 30; i++) sim.update(1 / 30);
  }, seconds);
}

try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  await ready(page, base);
  const backend = await page.evaluate(() => greywake.app.view.backend);
  assert.equal(backend, 'WebGPU');
  report.adapter = await page.evaluate(async () => {
    const adapter = await navigator.gpu.requestAdapter();
    return {
      vendor: adapter.info.vendor,
      architecture: adapter.info.architecture,
      description: adapter.info.description,
      isFallbackAdapter: adapter.info.isFallbackAdapter,
    };
  });
  check('Primary WebGPU renderer initializes', JSON.stringify(report.adapter));
  // Controlled targets for weapon/progression assertions. Evasion is verified in the dedicated AI suite.
  await page.evaluate(() => {
    greywake.config().world.merchantEvasion = false;
    greywake.config().ai.torpedoEvasion = false;
  });
  await shot(page, 'launch-final');
  await startPatrol(page);
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('#hud').isVisible(), true);
  await shot(page, 'helm-final');
  check('Desktop helm, ocean, contacts, and controls render');

  await page.evaluate(() => {
    const v = greywake.app.view,
      nodes = v.renderer._nodes,
      backend = v.renderer.backend;
    greywake.app.sim.paused = true;
    const build = nodes._createNodeBuilder.bind(nodes),
      pipeline = backend.createRenderPipeline.bind(backend),
      render = v.render.bind(v);
    window.renderProbe = {
      frames: 0,
      builders: 0,
      pipelines: 0,
      snapshots: [],
      fog: v.scene.fog,
      originalRender: v.render,
      originalBuild: nodes._createNodeBuilder,
      originalPipeline: backend.createRenderPipeline,
    };
    nodes._createNodeBuilder = (...args) => {
      renderProbe.builders++;
      return build(...args);
    };
    backend.createRenderPipeline = (...args) => {
      renderProbe.pipelines++;
      return pipeline(...args);
    };
    v.render = (...args) => {
      render(...args);
      renderProbe.frames++;
      if (renderProbe.frames > 12 && renderProbe.snapshots.length < 12)
        renderProbe.snapshots.push({
          builders: renderProbe.builders,
          pipelines: renderProbe.pipelines,
          attributes: v.renderer.info.memory.attributes,
          shaderBytes: Math.max(
            ...[...nodes.nodeBuilderCache.values()].map(
              (s) => s.vertexShader.length + s.fragmentShader.length,
            ),
          ),
          sameFog: v.scene.fog === renderProbe.fog,
        });
    };
  });
  await page.waitForFunction(() => renderProbe.snapshots.length === 12, null, { timeout: 120000 });
  const rendering = await page.evaluate(() => {
    const v = greywake.app.view,
      probe = renderProbe,
      result = probe.snapshots;
    v.render = probe.originalRender;
    v.renderer._nodes._createNodeBuilder = probe.originalBuild;
    v.renderer.backend.createRenderPipeline = probe.originalPipeline;
    greywake.app.sim.paused = false;
    return result;
  });
  assert.ok(rendering.every((s) => s.sameFog));
  for (const key of ['builders', 'pipelines', 'attributes', 'shaderBytes'])
    assert.equal(rendering.at(-1)[key], rendering[0][key], `${key} grows during ordinary rendering`);
  report.rendering = rendering;
  check('Warm render frames create no shader builders, pipelines, or leaking attribute buffers');
  const measured = await page.evaluate(() => {
    const v = greywake.app.view,
      previous = { fps: v.fps, frameCount: v.frameCount, frameTime: v.frameTime, frameMs: v.frameMs };
    v.frameCount = v.frameTime = 0;
    v.render(0, false, 4);
    const result = { fps: v.fps, frameMs: v.frameMs, diagnostics: v.diagnostics() };
    Object.assign(v, previous);
    return result;
  });
  assert.equal(measured.fps, 0.25);
  assert.equal(measured.frameMs, 4000);
  assert.equal(measured.diagnostics.adapter.software, true);
  assert.equal(
    await page.evaluate(
      () => greywake.app.view.light.shadow.shadowNode === greywake.app.view.ocean.sunShadow,
    ),
    true,
  );
  check('FPS uses real wall time and diagnostics identify the actual adapter');
  const skyUpdate = await page.evaluate(() => {
    const v = greywake.app.view,
      texture = v.scene.environment,
      nodes = v.renderer._nodes,
      build = nodes._createNodeBuilder.bind(nodes);
    let mainBuilds = 0;
    nodes._createNodeBuilder = (object, material) => {
      if (object.scene === v.scene) mainBuilds++;
      return build(object, material);
    };
    v.config.graphics.environmentRefresh = 2;
    v.environmentSun.set(1, 0, 0);
    v.lastEnvironmentUpdate = 0;
    v.refreshEnvironment();
    v.render(0.1, false, 0.1);
    nodes._createNodeBuilder = build;
    return { sameTexture: v.scene.environment === texture, mainBuilds };
  });
  assert.equal(skyUpdate.sameTexture, true);
  assert.equal(skyUpdate.mainBuilds, 0);
  check('Sky reflection refresh reuses its texture without rebuilding main-scene shaders');
  await page.evaluate(() => {
    greywake.config().graphics.pixelRatio = 0.75;
    greywake.app.view.applySettings();
  });

  await panel(page, 'captain');
  await page.click('[data-skill="hunter"]');
  assert.equal(await page.evaluate(() => greywake.state().skills.hunter), 1);
  await close(page);
  check('Captain skill purchase updates progression');
  await panel(page, 'refit');
  const before = await page.evaluate(() => greywake.state().bounty);
  await page.click('[data-upgrade="hull"]');
  assert.equal(await page.evaluate(() => greywake.state().bounty), before - 900);
  assert.equal(await page.evaluate(() => greywake.app.sim.maxHp()), 150);
  await close(page);
  check('Boat refit charges bounty and changes hull capacity');
  await panel(page, 'crew');
  await page.click('[data-department="Weapons"][data-doctrine="damage"]');
  assert.equal(await page.evaluate(() => greywake.state().heads.Weapons), 'damage');
  await close(page);
  check('Department-head doctrine changes weapons advantage');

  await page.click('.career-bar [data-panel="settings"]');
  await page.click('[data-settings-tab="graphics"]');
  await page.uncheck('[data-setting="graphics.shadows"]');
  let renderingCalls = await page.evaluate(() => greywake.app.view.renderer.info.render.calls);
  await page.waitForFunction(
    (calls) => greywake.app.view.renderer.info.render.calls > calls + 6,
    renderingCalls,
    { timeout: 60000 },
  );
  await page.check('[data-setting="graphics.shadows"]');
  renderingCalls = await page.evaluate(() => greywake.app.view.renderer.info.render.calls);
  await page.waitForFunction(
    (calls) => greywake.app.view.renderer.info.render.calls > calls + 6,
    renderingCalls,
    { timeout: 60000 },
  );
  assert.deepEqual(await page.evaluate(() => window.__consoleErrors), []);
  await page.locator('[data-setting="graphics.shadowResolution"]').evaluate((input) => {
    input.value = '1536';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => greywake.app.view.light.shadow.map?.width === 1536, null, {
    timeout: 60000,
  });
  assert.equal(await page.evaluate(() => greywake.app.view.renderer.shadowMap.enabled), true);
  const diagnosticsDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export rendering diagnostics', exact: true }).click();
  await (await diagnosticsDownload).saveAs('artifacts/render-audit/browser-diagnostics.json');
  const diagnostics = JSON.parse(await readFile('artifacts/render-audit/browser-diagnostics.json', 'utf8'));
  assert.equal(diagnostics.backend, 'WebGPU');
  assert.equal(diagnostics.graphics.shadowResolution, 1536);
  assert.equal(diagnostics.adapter.software, true);
  check('Shadow controls toggle and resize the shared map; rendering diagnostics export real state');
  await page.click('[data-settings-tab="combat"]');
  await page.locator('[data-setting="combat.torpedoDamage"]').evaluate((input) => {
    input.value = '200';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(await page.evaluate(() => greywake.config().combat.torpedoDamage), 200);
  await close(page);
  check('Live tuning updates the actual combat configuration');
  await page.click('#torpedo');
  assert.equal(await page.evaluate(() => greywake.state().torpedoes), 13);
  await step(page, 42);
  assert.equal(await page.evaluate(() => greywake.state().sunk), 1);
  check('UI-fired torpedo intercepts and sinks a moving ship, awarding bounty');
  await page.click('#cycle-target');
  await page.click('#torpedo');
  await step(page, 65);
  assert.ok((await page.evaluate(() => greywake.state().sunk)) >= 2);
  assert.ok((await page.evaluate(() => greywake.state().level)) >= 2);
  assert.ok((await page.evaluate(() => greywake.state().crewRank)) >= 2);
  check('Combat promotes the captain and crew');
  await panel(page, 'captain');
  await shot(page, 'captain-final');
  await close(page);
  await panel(page, 'chart');
  await page.selectOption('#port-select', '2');
  await shot(page, 'chart-final');
  await page.click('#set-course');
  assert.equal(await page.evaluate(() => greywake.state().auto), true);
  assert.ok((await page.evaluate(() => greywake.state().route.length)) > 0);
  check('Chart harbor selection plots a global autopilot route');

  await page.click('.career-bar [data-panel="settings"]');
  await page.click('summary');
  await page.click('[data-debug="clear"]');
  await close(page);
  await page.click('#time-cycle');
  assert.equal(await page.evaluate(() => greywake.state().acceleration), 5);
  await page.click('#time-cycle');
  await page.evaluate(() => greywake.app.sim.setAcceleration(1));
  check('Developer traffic tools and safe time acceleration work');
  await page.click('[data-depth="12"]');
  await step(page, 10);
  assert.ok((await page.evaluate(() => greywake.state().depth)) > 10);
  const scopePhysics = await page.evaluate(() => {
    const v = greywake.app.view;
    v.mode = 'chase';
    for (let i = 0; i < 18; i++) v.render(0.1, false, 0.1);
    return {
      underwater: v.underwater,
      fog: v.scene.fog.density,
      extended: v.scopeExtension.visible,
      opticsY: v.scopeEye.getWorldPosition(v.camera.position.clone()).y,
    };
  });
  assert.equal(scopePhysics.underwater, false);
  assert.ok(scopePhysics.fog < 0.001);
  assert.equal(scopePhysics.extended, true);
  assert.ok(scopePhysics.opticsY >= 1.7);
  await page.keyboard.press('c');
  assert.equal(await page.locator('#periscope').isVisible(), true);
  await shot(page, 'periscope-final');
  await page.keyboard.press('c');
  await page.keyboard.press('c');
  await page.click('[data-depth="80"]');
  await step(page, 50);
  assert.ok((await page.evaluate(() => greywake.state().depth)) >= 79);
  const underwaterPhysics = await page.evaluate(() => {
    const v = greywake.app.view;
    v.mode = 'chase';
    for (let i = 0; i < 18; i++) v.render(0.1, false, 0.1);
    greywake.app.ui.camera();
    return { underwater: v.underwater, sky: v.sky.visible, mode: v.mode };
  });
  assert.equal(underwaterPhysics.underwater, true);
  assert.equal(underwaterPhysics.sky, false);
  assert.notEqual(underwaterPhysics.mode, 'periscope');
  await page.evaluate(() => {
    greywake.app.view.mode = 'chase';
    greywake.app.ui.syncCamera();
  });
  await page.waitForTimeout(500);
  await shot(page, 'submerged-final');
  check('Dive controls, periscope, and underwater chase camera work');
  check(
    'Fog follows camera depth, periscope optics extend above the surface, and deep optics cannot see the sky',
  );
  await page.click('[data-depth="0"]');
  await step(page, 55);

  await panel(page, 'log');
  await page.evaluate(() => {
    const s = greywake.app.sim;
    s.debug('clear');
    const ship = s.addShip(s.p.x + 450, s.p.z - 400, 1.1);
    s.targetId = ship.id;
    s.hitShip(ship, 10);
    s.paused = false;
    s.fireTorpedo();
    s.paused = true;
  });
  const downloadPromise = page.waitForEvent('download');
  await page.click('#export-save');
  const download = await downloadPromise;
  await download.saveAs('artifacts/exported-career.json');
  const exported = JSON.parse(await readFile('artifacts/exported-career.json', 'utf8'));
  assert.equal(exported.career.skills.hunter, 1);
  await close(page);
  await page.evaluate(() => greywake.app.save());
  const saved = await page.evaluate(() => ({
    bounty: greywake.state().bounty,
    skills: greywake.state().skills,
    heads: greywake.state().heads,
  }));
  await page.reload();
  await page.waitForFunction(() => window.greywake?.ready, null, { timeout: 60000 });
  const preservedEncounter = await page.evaluate(() => ({
    ships: greywake.app.sim.ships.map((s) => ({ id: s.id, hp: s.hp })),
    torpedoes: greywake.app.sim.torpedoes.length,
    ammo: greywake.app.sim.p.torpedoes,
  }));
  const exportedEncounter = exported.encounter;
  assert.ok(exportedEncounter);
  assert.equal(preservedEncounter.torpedoes, 1);
  assert.equal(preservedEncounter.ammo, exported.career.torpedoes);
  assert.equal(
    preservedEncounter.ships.find((s) => s.id === exportedEncounter.targetId).hp,
    exportedEncounter.ships.find((s) => s.id === exportedEncounter.targetId).hp,
  );
  check('Live save/reload preserves damaged contacts and a launched torpedo');
  assert.deepEqual(
    await page.evaluate(() => ({
      bounty: greywake.state().bounty,
      skills: greywake.state().skills,
      heads: greywake.state().heads,
    })),
    saved,
  );
  check('Career export and reload preserve bounty, skills, and doctrines');
  await startPatrol(page);
  await page.evaluate(() => greywake.app.view.renderer.backend.device.destroy());
  await page.waitForURL(/renderer=webgl/, { timeout: 30000 });
  await page.waitForFunction(() => window.greywake?.ready && greywake.app.started, null, { timeout: 60000 });
  assert.equal(await page.evaluate(() => greywake.app.view.backend), 'WebGL 2');
  assert.deepEqual(
    await page.evaluate(() => ({
      bounty: greywake.state().bounty,
      skills: greywake.state().skills,
      heads: greywake.state().heads,
    })),
    saved,
  );
  check('Lost WebGPU device recovers into WebGL and resumes the saved career');
  await desktop.close();

  const mobile = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const phone = await mobile.newPage();
  await ready(phone, `${base}?renderer=webgl`);
  assert.equal(await phone.evaluate(() => greywake.app.view.backend), 'WebGL 2');
  assert.equal(await phone.evaluate(() => greywake.config().graphics.pixelRatio), 0.8);
  await startPatrol(phone);
  await phone.waitForTimeout(500);
  await shot(phone, 'mobile-portrait');
  for (const id of ['torpedo', 'gun', 'faster', 'port', 'starboard', 'time-cycle']) {
    const box = await phone.locator(`#${id}`).boundingBox();
    assert.ok(
      box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 394 && box.y + box.height <= 853,
      `${id} is outside mobile viewport`,
    );
  }
  await panel(phone, 'chart');
  await phone.selectOption('#port-select', '2');
  await phone.click('#set-course');
  assert.equal(await phone.evaluate(() => greywake.state().auto), true);
  await phone.setViewportSize({ width: 852, height: 393 });
  await phone.waitForTimeout(500);
  for (const id of ['torpedo', 'gun', 'faster', 'port', 'starboard', 'time-cycle']) {
    const box = await phone.locator(`#${id}`).boundingBox();
    assert.ok(
      box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 853 && box.y + box.height <= 394,
      `${id} is outside landscape viewport`,
    );
  }
  await shot(phone, 'mobile-landscape');
  check('Portrait and landscape touch layouts render and navigate with WebGL fallback');
  await mobile.close();

  const offline = await browser.newContext();
  const standalone = await offline.newPage();
  const requests = [];
  await standalone.route(/^https?:\/\//, (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  await ready(standalone, `${pathToFileURL(resolve('dist/greywake.html'))}?renderer=webgl`);
  await startPatrol(standalone);
  await standalone.waitForFunction(() => greywake.state().physicsTicks > 0, null, {
    timeout: 60000,
    polling: 100,
  });
  assert.deepEqual(requests, []);
  assert.equal(await standalone.evaluate(() => greywake.state().torpedoes), 14);
  assert.ok((await standalone.evaluate(() => greywake.state().physicsTicks)) > 0);
  check('Self-contained file:// HTML runs physics and rendering with all network requests blocked');
  await offline.close();
  assert.deepEqual(report.errors, []);
  check('No browser console errors or uncaught exceptions');
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = error.stack;
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile('artifacts/browser-report.json', JSON.stringify(report, null, 2));
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
