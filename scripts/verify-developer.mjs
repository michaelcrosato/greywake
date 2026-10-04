import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { SETTINGS } from '../src/config.js';

const folder = 'artifacts/developer';
await mkdir(folder, { recursive: true });
const html = await readFile('dist/greywake.html');
const server = createServer((_, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
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
const report = { passed: false, checks: [], errors: [] };
const pass = (name) => {
  report.checks.push(name);
  console.log(`PASS ${name}`);
};
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }),
  page = await context.newPage();
page.on('pageerror', (error) => report.errors.push(error.stack));
page.on('console', (message) => {
  if (message.type() === 'error') report.errors.push(message.text());
});
async function input(selector, value) {
  const control = page.locator(selector);
  if (typeof value === 'boolean') await control.setChecked(value);
  else {
    await control.fill(String(value));
    await control.dispatchEvent('change');
  }
}
async function settle() {
  await page.evaluate(async () => {
    greywake.app.sim.paused = true;
    greywake.app.view.render(0.1, false, 0.1);
    const b = greywake.app.view.renderer.backend;
    if (b.device) await b.device.queue.onSubmittedWorkDone();
    else b.gl.finish();
    greywake.app.ui.update(1);
  });
}
async function freeze() {
  await page.evaluate(() => {
    window.requestAnimationFrame = () => 0;
    greywake.app.sim.paused = true;
  });
  await page.waitForTimeout(100);
}
try {
  await page.goto(base);
  await page.waitForFunction(() => window.greywake?.ready, null, { timeout: 120000 });
  await freeze();
  await page.keyboard.press('F2');
  assert.equal(await page.locator('#dev-enabled').isVisible(), true);
  const total = Object.values(SETTINGS).reduce((n, fields) => n + Object.keys(fields).length, 0);
  assert.equal(
    await page
      .locator('.dev-setting [data-dev-setting]')
      .evaluateAll((controls) => new Set(controls.map((c) => c.dataset.devSetting)).size),
    total,
  );
  await page.fill('#dev-search', 'torpedo damage');
  assert.equal(await page.locator('[data-dev-setting="combat.torpedoDamage"][type="number"]').count(), 1);
  await input('[data-dev-setting="combat.torpedoDamage"][type="number"]', 145);
  assert.equal(await page.evaluate(() => greywake.config().combat.torpedoDamage), 145);
  await page.fill('#dev-search', '');
  await page.selectOption('#dev-group', 'ai');
  assert.match(
    await page.locator('#dev-variable-count').textContent(),
    new RegExp(String(Object.keys(SETTINGS.ai).length)),
  );
  pass(`F2 opens before patrol; all ${total} variables are searchable, grouped and live`);

  await page.click('[data-dev-preset="travel"]');
  assert.equal(await page.evaluate(() => greywake.app.sim.developer.speedMultiplier), 8);
  assert.equal(await page.evaluate(() => greywake.app.sim.dev('invulnerable')), true);
  await page.click('#dev-checkpoint-save');
  const checkpoint = await page.evaluate(() => ({
    x: greywake.app.sim.p.x,
    z: greywake.app.sim.p.z,
    bounty: greywake.app.sim.p.bounty,
    damage: greywake.config().combat.torpedoDamage,
  }));
  await page.click('[data-dev-action="funds"]');
  await page.click('#dev-atlantic');
  assert.equal(await page.evaluate(() => greywake.app.sim.p.x), -30 * 111000);
  assert.equal(await page.evaluate(() => greywake.app.sim.origin.x), -30 * 111000);
  assert.equal(await page.evaluate(() => greywake.app.view.trails.size), 0);
  await page.click('#dev-checkpoint-load');
  assert.deepEqual(
    await page.evaluate(() => ({
      x: greywake.app.sim.p.x,
      z: greywake.app.sim.p.z,
      bounty: greywake.app.sim.p.bounty,
      damage: greywake.config().combat.torpedoDamage,
    })),
    checkpoint,
  );
  pass('Travel preset, real teleport, visual reset and checkpoint restoration work');

  await input('[data-dev="pauseTraffic"]', true);
  await page.click('[data-dev-action="clear"]');
  await page.click('[data-dev-action="merchant"]');
  const target = await page.evaluate(() => greywake.app.sim.target().id);
  await page.click('#dev-near-target');
  assert.equal(await page.evaluate(() => greywake.app.sim.target()?.id), target);
  await page.click('[data-dev-preset="combat"]');
  await input('[data-dev="freezeEnemies"]', true);
  const start = await page.evaluate(() => ({
    time: greywake.app.sim.p.time,
    ticks: greywake.app.sim.physicsTicks,
  }));
  await page.click('[data-dev-step="1"]');
  assert.ok(Math.abs((await page.evaluate(() => greywake.app.sim.p.time)) - start.time - 1) < 1e-7);
  assert.equal(await page.evaluate(() => greywake.app.sim.physicsTicks), start.ticks + 30);
  await page.selectOption('#dev-time', '1000');
  assert.equal(await page.evaluate(() => greywake.app.sim.acceleration), 20);
  await page.click('[data-dev-action="sink"]');
  assert.equal(
    await page.evaluate((targetId) => greywake.app.sim.ships.find((s) => s.id === targetId)?.hp, target),
    0,
  );
  pass('Contact-preserving teleport, spawn/sink tools and paused real-physics stepping work');

  await page.selectOption('#dev-port', '2');
  await page.click('#dev-teleport-port');
  assert.equal(await page.evaluate(() => greywake.app.sim.p.x), -28.8 * 111000);
  await page.click('#dev-open-chart');
  await page.selectOption('#port-select', '1');
  await page.click('#dev-chart-teleport');
  assert.ok(Math.abs((await page.evaluate(() => greywake.app.sim.p.x)) + 16.5 * 111000) < 300000);
  assert.equal(await page.evaluate(() => greywake.app.ui.panel), null);
  assert.notEqual(await page.evaluate(() => greywake.app.sim.p.x), -28.8 * 111000);
  await page.keyboard.press('F2');
  await input('#dev-lon', 10);
  await input('#dev-lat', 0);
  await page.click('#dev-teleport');
  assert.match(await page.locator('#dev-feedback').textContent(), /land/);
  await input('[data-dev="noClip"]', true);
  await page.click('#dev-teleport');
  assert.equal(await page.evaluate(() => greywake.app.sim.hullCollider.isSensor()), true);
  await page.click('#dev-atlantic');
  pass('Harbor, chart and manual teleport validate coordinates and support explicit no-collision mode');

  const pending = page.waitForEvent('download');
  await page.click('#dev-export');
  await (await pending).saveAs(`${folder}/profile.json`);
  const profile = JSON.parse(await readFile(`${folder}/profile.json`, 'utf8'));
  assert.equal(profile.schema, 'greywake.playtest/1');
  await page.click('#dev-normal');
  assert.equal(await page.evaluate(() => greywake.app.sim.dev('invulnerable')), false);
  const chooser = page.waitForEvent('filechooser');
  await page.click('#dev-import');
  await (await chooser).setFiles(`${folder}/profile.json`);
  await page.waitForFunction(() => greywake.app.sim.developer.enabled);
  assert.deepEqual(await page.evaluate(() => greywake.app.sim.developer), profile.developer);
  pass('Export/import preserves playtest aids and live game tuning; normal mode removes the aids');
  await page.evaluate(() => greywake.app.save());
  await page.reload();
  await page.waitForFunction(() => window.greywake?.ready, null, { timeout: 120000 });
  await freeze();
  assert.deepEqual(await page.evaluate(() => greywake.app.sim.developer), profile.developer);
  await page.click('#begin');
  if (await page.locator('#guide-skip').isVisible()) await page.click('#guide-skip');
  await page.evaluate(() => {
    greywake.app.sim.paused = true;
    greywake.app.ui.update(1);
  });
  assert.equal(await page.locator('#developer-badge').isVisible(), true);
  await page.click('#developer-badge');
  await settle();
  await page.screenshot({ path: `${folder}/desktop.png`, timeout: 120000 });
  pass('Developer state survives reload and the active-mode badge reopens the tools');
  for (const [width, height] of [
    [393, 852],
    [852, 393],
  ]) {
    await page.setViewportSize({ width, height });
    await settle();
    assert.equal(await page.evaluate(() => document.querySelector('.modal').scrollWidth <= innerWidth), true);
    for (const id of ['dev-enabled', 'dev-search', 'dev-teleport', 'dev-import']) {
      await page.locator(`#${id}`).scrollIntoViewIfNeeded();
      const box = await page.locator(`#${id}`).boundingBox();
      assert.ok(
        box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= height,
        `${id} outside viewport`,
      );
    }
    await page.locator('#dev-enabled').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${folder}/mobile-${width}.png`, timeout: 120000 });
  }
  pass('Developer controls fit and remain reachable in portrait and landscape');
  await page.setViewportSize({ width: 1280, height: 900 });
  const careerDev = await page.evaluate(() => JSON.stringify(greywake.app.sim.developer));
  await page.click('#dev-ai-lab');
  assert.equal(await page.evaluate(() => greywake.app.sim.developer.enabled), false);
  await page.click('#ai-exit');
  assert.equal(await page.evaluate(() => JSON.stringify(greywake.app.sim.developer)), careerDev);
  await page.evaluate(() => greywake.app.tutorial.start(true));
  await page.keyboard.press('F2');
  assert.equal(await page.locator('#dev-return-patrol').isVisible(), true);
  assert.equal(await page.locator('#dev-enabled').count(), 0);
  await page.click('#dev-return-patrol');
  assert.equal(await page.evaluate(() => JSON.stringify(greywake.app.sim.developer)), careerDev);
  pass('Developer aids stay out of the AI lab and guided practice; returning preserves the patrol aids');
  assert.deepEqual(report.errors, []);
  assert.deepEqual(await page.evaluate(() => window.__consoleErrors), []);
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
