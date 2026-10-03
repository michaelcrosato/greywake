import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

await mkdir('artifacts/ai-lab', { recursive: true });
const html = await readFile('dist/greywake.html');
const server = createServer((_, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  headless: false,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});
const report = { checks: [], errors: [], screenshots: [] };
const pass = (name) => {
  report.checks.push(name);
  console.log(`PASS ${name}`);
};
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', (e) => report.errors.push(e.stack));
page.on('console', (m) => {
  if (m.type() === 'error') report.errors.push(m.text());
});
const state = () =>
  page.evaluate(() =>
    JSON.stringify({
      player: {
        x: greywake.app.sim.p.x,
        z: greywake.app.sim.p.z,
        depth: greywake.app.sim.p.depth,
        heading: greywake.app.sim.p.heading,
      },
      ships: greywake.app.sim.ships.map((s) => ({
        x: s.x,
        z: s.z,
        heading: s.heading,
        state: s.state,
        ai: s.ai,
        track: s.track,
      })),
    }),
  );
async function screenshot(name) {
  const path = `artifacts/ai-lab/${name}.png`;
  await page.screenshot({ path, timeout: 120000 });
  report.screenshots.push(path);
}
async function input(selector, value) {
  await page.locator(selector).evaluate((el, value) => {
    if (el.type === 'checkbox') el.checked = value;
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/?renderer=webgl`);
  await page.waitForFunction(() => window.greywake?.ready, null, { timeout: 60000 });
  await page.click('#begin');
  await page.click('#guide-skip');
  await page.evaluate(() => {
    greywake.app.sim.paused = true;
  });
  await page.click('[data-panel="settings"]');
  await page.getByRole('button', { name: 'Mobile', exact: true }).click();
  await page.evaluate(() => {
    window.parkedSim = greywake.app.sim;
    window.parkedCareer = JSON.stringify(greywake.app.sim.p);
    window.parkedConfig = JSON.stringify(greywake.app.sim.config);
  });
  await page.click('#open-ai-lab');
  assert.equal(await page.locator('#ai-lab').isVisible(), true);
  assert.equal(await page.locator('#hud').isVisible(), false);
  assert.equal(await page.evaluate(() => greywake.app.aiLab.careerSim === parkedSim), true);
  assert.equal(await page.evaluate(() => greywake.app.sim.training), false);
  await screenshot('lab-desktop');
  pass('Settings opens a real-AI lab while parking the exact career simulation');

  await page.selectOption('#ai-scenario', 'escape');
  await page.selectOption('#ai-profile', 'loud');
  await page.click('#ai-restart');
  await page.click('#ai-step');
  assert.ok(Math.abs((await page.evaluate(() => greywake.app.sim.p.time)) - 1) < 1e-6);
  await page.click('#ai-ten');
  await page.getByRole('button', { name: '2 Escort', exact: true }).click();
  assert.equal(await page.evaluate(() => greywake.app.aiLab.selectedShip), 2);
  assert.match(await page.locator('#ai-selected').textContent(), /Sensor|Evidence/);
  pass('Fixed one-second stepping, advance, and keyboard-accessible enemy inspection work');

  await page.getByText('Live tuning', { exact: true }).click();
  await input('[data-ai-tune="ai.reactionDelay"]', '2');
  assert.equal(await page.evaluate(() => greywake.app.sim.config.ai.reactionDelay), 2);
  await page.getByText('Manual inputs and interventions', { exact: true }).click();
  await input('#ai-power', '0.3');
  await input('#ai-rudder', '1');
  await page.click('[data-ai-depth="80"]');
  await page.click('#ai-ten');
  await input('#ai-rudder', '0');
  await page.click('#ai-ten');
  await page.click('#ai-ten');
  await page.click('#ai-ping');
  await page.click('#ai-ten');
  const end = await page.evaluate(() => greywake.app.sim.p.time),
    original = await state();
  assert.equal(await page.evaluate(() => greywake.app.aiLab.run.profile), 'manual');
  assert.equal(await page.evaluate(() => greywake.app.aiLab.exportReplay().profile), 'loud');
  await screenshot('lab-observation');
  pass('Live tuning, manual helm and sonar interventions become timestamped replay events');

  const pending = page.waitForEvent('download');
  await page.click('#ai-export');
  await (await pending).saveAs('artifacts/ai-lab/browser-replay.json');
  const replay = JSON.parse(await readFile('artifacts/ai-lab/browser-replay.json', 'utf8'));
  assert.equal(replay.seed, 42);
  assert.equal(replay.profile, 'loud');
  assert.ok(replay.events.some((e) => e.type === 'profile' && e.value === 'manual'));
  assert.ok(replay.decisions.some((e) => e.type === 'observation'));
  await page.locator('#ai-timeline').evaluate((el) => {
    el.value = '20';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => !greywake.app.aiLab.seeking, null, { timeout: 60000 });
  assert.ok(Math.abs((await page.evaluate(() => greywake.app.sim.p.time)) - 20) < 1e-6);
  pass('The timeline reconstructs a past encounter from its seed and recorded controls');

  const chooser = page.waitForEvent('filechooser');
  await page.click('#ai-import');
  await (await chooser).setFiles('artifacts/ai-lab/browser-replay.json');
  await page.waitForFunction(
    (end) => !greywake.app.aiLab.seeking && Math.abs(greywake.app.sim.p.time - end) < 1e-6,
    end,
    { timeout: 60000 },
  );
  assert.equal(await state(), original);
  assert.equal(await page.evaluate(() => greywake.app.sim.config.ai.reactionDelay), 2);
  pass('Exported replay imports and reproduces the complete enemy state and player motion');

  await page.selectOption('#ai-rate', '1');
  await page.click('#ai-play');
  await page.waitForFunction((end) => greywake.app.sim.p.time > end + 1, end, { timeout: 10000 });
  await page.click('#ai-play');
  assert.equal(await page.evaluate(() => greywake.app.aiLab.playing), false);
  await page.evaluate(() => {
    greywake.app.sim.hurt(1000);
    greywake.app.save();
  });
  assert.ok(await page.evaluate(() => greywake.app.sim.p.hp > 0));
  assert.equal(
    await page.evaluate(
      () => JSON.stringify(JSON.parse(localStorage.getItem('greywake.career.v1')).career) === parkedCareer,
    ),
    true,
  );
  pass('Playback runs, lab damage is measurable but protected, and autosave preserves the career');

  const benchmark = await page.evaluate(() => {
    const lab = greywake.app.aiLab;
    lab.scenario = 'convoy';
    lab.profile = 'evasive';
    lab.reset();
    const start = performance.now();
    lab.step(120);
    return {
      simulatedSeconds: lab.run.sim.p.time,
      wallMs: performance.now() - start,
      frames: lab.frames.length,
    };
  });
  report.fastForward = benchmark;
  assert.ok(benchmark.wallMs < 10000);
  pass('Two minutes of real AI/physics simulate within ten seconds with the tactical map');

  await page.setViewportSize({ width: 393, height: 852 });
  await page.evaluate(() => greywake.app.aiLab.render());
  assert.equal(await page.evaluate(() => document.getElementById('ai-lab').scrollWidth <= innerWidth), true);
  const box = await page.locator('#ai-canvas').boundingBox();
  assert.ok(box.width > 250 && box.x >= 0 && box.x + box.width <= 393);
  await screenshot('lab-mobile-portrait');
  await page.setViewportSize({ width: 852, height: 393 });
  await page.evaluate(() => greywake.app.aiLab.render());
  assert.equal(await page.evaluate(() => document.getElementById('ai-lab').scrollWidth <= innerWidth), true);
  await screenshot('lab-mobile-landscape');
  pass('Portrait and landscape lab layouts fit the viewport and scroll to all controls');

  await page.click('#ai-exit');
  assert.equal(await page.evaluate(() => greywake.app.sim === parkedSim), true);
  assert.equal(await page.evaluate(() => JSON.stringify(greywake.app.sim.p) === parkedCareer), true);
  assert.equal(await page.evaluate(() => JSON.stringify(greywake.app.sim.config) === parkedConfig), true);
  assert.equal(await page.locator('#hud').isVisible(), true);
  pass('Returning restores the exact career and leaves its tuning unchanged');
  await page.click('[data-panel="settings"]');
  await page.click('#open-ai-lab');
  await page.getByText('Live tuning', { exact: true }).click();
  await input('[data-ai-tune="ai.radioDelay"]', '6');
  await page.click('#ai-apply');
  await page.click('#ai-exit');
  assert.equal(await page.evaluate(() => greywake.app.sim.config.ai.radioDelay), 6);
  pass('Apply tuning explicitly commits the chosen AI settings to the parked patrol');
  assert.deepEqual(await page.evaluate(() => window.__consoleErrors), []);
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile('artifacts/ai-lab/browser-report.json', JSON.stringify(report, null, 2));
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
