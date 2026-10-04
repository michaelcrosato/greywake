import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

await mkdir('artifacts/orientation-audit', { recursive: true });
const html = await readFile('dist/greywake.html');
const server = createServer((_, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html' });
  r.end(html);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: false,
  args: [
    '--no-sandbox',
    '--disable-gpu-watchdog',
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--use-angle=vulkan',
    '--use-vulkan=swiftshader',
    '--use-webgpu-adapter=swiftshader',
    '--disable-vulkan-surface',
  ],
});
const report = { checks: [], errors: [], steps: [] };
const pass = (name) => {
  report.checks.push(name);
  console.log(`PASS ${name}`);
};
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', (error) => report.errors.push(error.stack));
page.on('console', (m) => {
  if (m.type() === 'error') report.errors.push(m.text());
});
async function state() {
  return page.evaluate(() => ({
    id: greywake.app.tutorial.lesson.id,
    step: greywake.app.tutorial.state.step,
    ready: greywake.app.tutorial.ready(),
    training: greywake.app.sim.training,
  }));
}
async function tick(seconds = 0) {
  await page.evaluate((seconds) => {
    for (let i = 0; i < seconds * 30; i++) greywake.app.sim.update(1 / 30);
    greywake.app.tutorial.tick(1);
    greywake.app.ui.update(1);
  }, seconds);
}
async function capture() {
  const s = await state();
  const path = `artifacts/orientation-audit/${String(s.step + 1).padStart(2, '0')}-${s.id}-after.png`;
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
  report.steps.push({ step: s.step + 1, name: s.id, health: 'verified', screenshot: path });
}
async function next(expected) {
  await tick();
  assert.equal((await state()).ready, true, `${(await state()).id} did not complete`);
  await page.click('#guide-next');
  await tick();
  assert.equal((await state()).id, expected);
}
async function open(name) {
  await page.locator(`.side-nav [data-panel="${name}"]`).click();
  await tick();
}
async function close() {
  await page.click('#close-modal');
  await tick();
}

try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.greywake?.ready, null, { timeout: 60000 });
  await page.evaluate(() => {
    greywake.config().graphics.pixelRatio = 0.8;
    greywake.app.view.applySettings();
  });
  await page.click('#begin');
  assert.equal(await page.locator('#modal-title').textContent(), 'Welcome aboard, captain');
  assert.equal(await page.evaluate(() => greywake.app.sim.paused), true);
  pass('First patrol automatically opens a paused briefing with the career objective');
  await page.evaluate(() => {
    window.originalCareerSim = greywake.app.sim;
    greywake.app.ui.pauseBefore = true;
    window.originalCareer = JSON.stringify(greywake.app.sim.p);
    window.originalConfig = JSON.stringify(greywake.app.sim.config);
  });
  await page.click('#guide-start');
  await tick();
  assert.equal((await state()).training, true);
  assert.equal(await page.evaluate(() => greywake.app.tutorial.careerSim === originalCareerSim), true);
  pass('Practice parks the original simulation and uses protected, isolated resources');
  await capture();
  await next('helm');
  await page.locator('#throttle').evaluate((input) => {
    input.value = '0.7';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.keyboard.down('d');
  await tick(2);
  await page.keyboard.up('d');
  await tick();
  await capture();
  await next('dive');
  pass('Helm lesson accepts real throttle and keyboard rudder orders');
  await page.keyboard.press('v');
  await tick();
  assert.equal(await page.evaluate(() => greywake.app.sim.p.targetDepth), 12);
  assert.match(await page.locator('#depth-order').textContent(), /Diving.*12/);
  await page.click('#guide-wait');
  await page.waitForFunction(() => !greywake.app.tutorial.advancing, null, { timeout: 120000 });
  await tick();
  assert.equal(await page.evaluate(() => greywake.app.sim.p.depth), 12);
  await page.keyboard.press('c');
  await tick();
  assert.equal(await page.locator('#periscope').isVisible(), true);
  await capture();
  await next('gauges');
  pass('Dive lesson shows the ordered depth and advances an actual maneuver');
  await capture();
  await next('contact');
  await page.click('#cycle-target');
  await page.click('#focus-target');
  await tick();
  await capture();
  await next('attack');
  const ammunition = await page.evaluate(() => greywake.app.sim.p.torpedoes);
  await page.click('#torpedo');
  await tick();
  assert.equal(await page.evaluate(() => greywake.app.sim.p.torpedoes), ammunition - 1);
  await page.click('#guide-wait');
  await page.waitForFunction(() => !greywake.app.tutorial.advancing, null, { timeout: 120000 });
  await tick();
  if ((await page.evaluate(() => greywake.app.sim.p.sunk)) === 0) {
    await page.click('#torpedo');
    await tick();
    await page.click('#guide-wait');
    await page.waitForFunction(() => !greywake.app.tutorial.advancing, null, { timeout: 120000 });
    await tick();
  }
  assert.equal(await page.evaluate(() => greywake.app.sim.p.sunk), 1);
  await capture();
  await next('evade');
  pass('Practice torpedoes intercept and sink a moving merchant with real rewards');
  await page.keyboard.press('x');
  await page.locator('#throttle').evaluate((input) => {
    input.value = '0.2';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.keyboard.down('a');
  await tick(4);
  await page.keyboard.up('a');
  await page.click('#guide-wait');
  await page.waitForFunction(() => !greywake.app.tutorial.advancing, null, { timeout: 120000 });
  await tick();
  await capture();
  await next('surface');
  await page.keyboard.press('r');
  await tick();
  await page.click('#guide-wait');
  await page.waitForFunction(() => !greywake.app.tutorial.advancing, null, { timeout: 120000 });
  await tick();
  await page.click('#gun');
  await tick(2);
  await capture();
  await next('skills');
  pass('Evasion, surfacing, and the deck gun are taught using actual controls');
  await open('captain');
  await page.click('[data-skill="hunter"]');
  await tick();
  await capture();
  await next('refit');
  await open('refit');
  await page.click('[data-upgrade="hull"]');
  await tick();
  await capture();
  await next('crew');
  await open('crew');
  await page.click('[data-department="Weapons"][data-doctrine="damage"]');
  await tick();
  await capture();
  await next('chart');
  pass('Captain skills, boat refits, and department doctrines complete real progression actions');
  await open('chart');
  await page.selectOption('#port-select', '2');
  await page.click('#set-course');
  await tick();
  await capture();
  await next('time');
  await page.click('#time-cycle');
  await tick();
  assert.ok((await page.evaluate(() => greywake.app.sim.acceleration)) > 1);
  await page.click('#guide-wait');
  await page.waitForFunction(() => !greywake.app.tutorial.advancing, null, { timeout: 120000 });
  await tick();
  await capture();
  await next('harbor');
  pass('Chart and accelerated autopilot complete a coastal passage to Horta');
  await open('refit');
  await page.click('#service');
  await tick();
  await capture();
  await next('ready');
  await capture();
  await page.click('#guide-next');
  await tick();
  assert.equal(await page.evaluate(() => greywake.app.tutorial.active), false);
  assert.equal(await page.evaluate(() => greywake.app.sim === originalCareerSim), true);
  assert.equal(
    await page.evaluate(() => JSON.stringify(originalCareerSim.p)),
    await page.evaluate(() => originalCareer),
  );
  assert.equal(
    await page.evaluate(() => JSON.stringify(originalCareerSim.config)),
    await page.evaluate(() => originalConfig),
  );
  pass('Harbor service and tutorial completion restore the exact original career and configuration');
  await page.keyboard.press('h');
  assert.equal(await page.locator('#modal-title').textContent(), 'Captain’s field manual');
  assert.ok((await page.locator('.manual-topics details').count()) >= 11);
  await close();
  await page.reload();
  await page.waitForFunction(() => window.greywake?.ready, null, { timeout: 60000 });
  await page.click('#begin');
  assert.equal(await page.locator('#modal').isVisible(), false);
  pass('Manual remains available and completed orientation does not nag on resume');
  await page.keyboard.press('h');
  await page.click('#manual-practice');
  await tick();
  assert.equal((await state()).id, 'command');
  await next('helm');
  await page.click('#guide-exit');
  await tick();
  assert.equal(await page.evaluate(() => greywake.app.tutorial.active), false);
  await page.keyboard.press('h');
  await page.click('#manual-practice');
  await tick();
  assert.equal((await state()).id, 'helm');
  pass('Orientation can be replayed, paused, and resumed from its saved lesson');
  await page.click('#guide-exit');
  await tick();
  await page.close();
  const touchContext = await browser.newContext({
    viewport: { width: 393, height: 852 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  const touch = await touchContext.newPage();
  touch.on('pageerror', (e) => report.errors.push(e.stack));
  touch.on('console', (m) => {
    if (m.type() === 'error') report.errors.push(m.text());
  });
  await touch.goto(`http://127.0.0.1:${server.address().port}?renderer=webgl`);
  await touch.waitForFunction(() => window.greywake?.ready || window.__consoleErrors?.length, null, {
    timeout: 120000,
  });
  assert.deepEqual(await touch.evaluate(() => window.__consoleErrors), []);
  await touch.tap('#begin');
  await touch.tap('#guide-start');
  for (const [width, height] of [
    [393, 852],
    [852, 393],
  ]) {
    await touch.setViewportSize({ width, height });
    await touch.evaluate(() => greywake.app.tutorial.tick(1));
    const nextBox = await touch.locator('#guide-next').boundingBox();
    assert.ok(
      nextBox &&
        nextBox.x >= 0 &&
        nextBox.y >= 0 &&
        nextBox.x + nextBox.width <= width + 1 &&
        nextBox.y + nextBox.height <= height + 1,
    );
    const exitBox = await touch.locator('#guide-exit').boundingBox();
    assert.ok(exitBox && exitBox.y + exitBox.height <= height + 1);
    for (const depth of ['0', '12', '80']) {
      const depthBox = await touch.locator(`[data-depth="${depth}"]`).boundingBox();
      assert.ok(
        depthBox && depthBox.y + depthBox.height <= height + 1,
        `Depth ${depth} escapes ${width}x${height} viewport`,
      );
    }
    await touch.screenshot({
      path: `artifacts/orientation-audit/touch-${width}x${height}.png`,
      timeout: 120000,
    });
  }
  await touch.setViewportSize({ width: 393, height: 852 });
  await touch.evaluate(() => greywake.app.tutorial.tick(1));
  await touch.tap('#guide-next');
  for (let i = 0; i < 5; i++) await touch.tap('#faster');
  const rudderBox = await touch.locator('#starboard').boundingBox(),
    cdp = await touchContext.newCDPSession(touch);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: rudderBox.x + rudderBox.width / 2, y: rudderBox.y + rudderBox.height / 2, id: 1 }],
  });
  await touch.evaluate(() => {
    for (let i = 0; i < 60; i++) greywake.app.sim.update(1 / 30);
    greywake.app.tutorial.tick(1);
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.equal(await touch.evaluate(() => greywake.app.tutorial.ready()), true);
  await touch.tap('#guide-next');
  await touch.tap('[data-depth="12"]');
  await touch.evaluate(() => greywake.app.tutorial.tick(1));
  await touch.tap('#guide-wait');
  await touch.tap('#camera-mobile');
  await touch.evaluate(() => greywake.app.tutorial.tick(1));
  assert.equal(await touch.evaluate(() => greywake.app.tutorial.ready()), true);
  assert.equal(await touch.evaluate(() => greywake.app.sim.p.depth), 12);
  await touch.tap('#guide-exit');
  await touchContext.close();
  pass(
    'Portrait and landscape coach actions stay visible; real touch controls complete helm and periscope lessons',
  );
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = error.stack;
  console.error(error);
  if (!page.isClosed())
    await page
      .screenshot({ path: 'artifacts/orientation-audit/failure.png', timeout: 120000 })
      .catch((captureError) => console.error('Failure screenshot:', captureError.message));
  process.exitCode = 1;
} finally {
  await writeFile('artifacts/orientation-audit/verification.json', JSON.stringify(report, null, 2));
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
