import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const folder = process.env.WATER_CAPTURE_DIR || 'artifacts/water-upgrade/browser';
const qualityOnly = process.argv.includes('--quality-only');
await mkdir(folder, { recursive: true });
const html = await readFile(process.env.WATER_BUILD || 'dist/greywake.html');
const server = createServer((_, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end(html);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
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
const report = { passed: false, checks: [], errors: [], scenes: [], quality: [] };
function pass(name) {
  report.checks.push(name);
  console.log(`PASS ${name}`);
}
async function draw(page, seconds = 0, rudder = 0) {
  return page.evaluate(
    async ({ seconds, rudder }) => {
      const { sim, view } = greywake.app;
      sim.paused = false;
      sim.rudder = rudder;
      const render = view.renderer.render,
        refraction = view.ocean.captureRefraction;
      // Advance the actual scene and effects at their normal 30 Hz, submitting
      // only the final image to the software GPU. No gameplay/update is skipped.
      view.renderer.render = () => {};
      view.ocean.captureRefraction = () => {};
      try {
        for (let i = 0; i < Math.round(seconds * 30); i++) {
          sim.update(1 / 30);
          view.render(1 / 30, false, 1 / 30);
        }
      } finally {
        view.renderer.render = render;
        view.ocean.captureRefraction = refraction;
      }
      sim.paused = true;
      view.renderer._nodes.nodeFrame.update();
      view.render(0.2, false, 0.2);
      const device = view.renderer.backend.device;
      if (device) await device.queue.onSubmittedWorkDone();
      else view.renderer.backend.gl.finish();
      greywake.app.ui.update(1);
      return view.diagnostics();
    },
    { seconds, rudder },
  );
}
async function capture(page, backend, name, diagnostics) {
  const path = `${folder}/${backend}-${name}.png`;
  await page.screenshot({ path, timeout: 120000 });
  report.scenes.push({ backend, name, screenshot: path, diagnostics });
}
try {
  for (const backend of ['webgpu', 'webgl']) {
    const context = await browser.newContext({ viewport: { width: 960, height: 600 } });
    const page = await context.newPage();
    page.on('pageerror', (error) => report.errors.push(error.stack));
    page.on('console', (message) => {
      if (message.type() === 'error') report.errors.push(message.text());
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/?renderer=${backend}`);
    await page.waitForFunction(() => window.greywake?.ready, null, { timeout: 120000 });
    // Freeze the animation scheduler after its pending frame. Each capture submits
    // real game frames and waits for the GPU, avoiding competing software renders.
    await page.evaluate(() => {
      window.requestAnimationFrame = () => 0;
      greywake.app.begin({ guided: false });
      greywake.app.sim.paused = true;
      greywake.app.sim.debug('clear');
      greywake.config().ocean.dayCycle = false;
      greywake.config().world.trafficDensity = 0.2;
      greywake.config().graphics.environmentRefresh = 120;
    });
    await page.waitForTimeout(200);
    assert.equal(
      await page.evaluate(() => greywake.app.view.backend),
      backend === 'webgpu' ? 'WebGPU' : 'WebGL 2',
    );
    await page.click('[data-panel="settings"]');
    await page.click('[data-preset="balanced"]');
    // Keep software-adapter captures practical while retaining Balanced water,
    // shadows, planar reflection and scene/depth refraction.
    await page.evaluate(() => {
      greywake.config().graphics.pixelRatio = 1;
      greywake.app.view.applySettings();
    });
    if (!qualityOnly) {
      await page.click('[data-settings-tab="ocean"]');
      for (const [state, wind] of [
        ['calm', 3],
        ['atlantic', 9],
        ['storm', 17],
      ]) {
        await page.click(`[data-sea-state="${state}"]`);
        assert.equal(await page.evaluate(() => greywake.config().ocean.windSpeed), wind);
        await page.click('#close-modal');
        await page.evaluate(() => {
          greywake.app.sim.weather = 0;
        });
        const diagnostics = await draw(page, 6);
        assert.equal(diagnostics.water.spectrumResolution, 64);
        assert.equal(diagnostics.water.interactionResolution, 256);
        assert.equal(diagnostics.water.refractionEnabled, true);
        assert.ok(diagnostics.water.refractionSize.width > 1);
        await capture(page, backend, state, diagnostics);
        await page.click('[data-panel="settings"]');
        await page.click('[data-settings-tab="ocean"]');
      }
      await page.click('[data-sea-state="atlantic"]');
      await page.click('#close-modal');
      const turn = await draw(page, 12, 0.7);
      assert.equal(turn.water.interactionActive, true);
      await capture(page, backend, 'turn', turn);
      const motion = await page.evaluate(() => ({ ...greywake.app.sim.waterMotion }));
      assert.ok(
        Object.values(motion)
          .filter((value) => typeof value === 'number')
          .every(Number.isFinite),
      );
      assert.ok(motion.wetness > 0);
      for (const [kind, depth] of [
        ['shell', 0],
        ['torpedo', 2.5],
        ['depth-charge', 30],
      ]) {
        await page.evaluate(
          ({ kind, depth }) => {
            const { sim, view } = greywake.app;
            sim.effects = [];
            view.particles = [];
            sim.waterImpact(kind, sim.p.x + 35, sim.p.z - 35, depth, 1.5);
          },
          { kind, depth },
        );
        const diagnostics = await draw(page, 0.5);
        assert.ok(diagnostics.water.activeImpacts > 0);
        if (kind === 'shell') assert.ok(diagnostics.water.particles.spray > 0);
        else assert.ok(diagnostics.water.particles.bubbles > 0);
        await capture(page, backend, kind, diagnostics);
      }
      await page.evaluate(() => {
        const { sim } = greywake.app;
        sim.p.depth = sim.p.targetDepth = 30;
        sim.body.setTranslation({ x: 0, y: -32, z: 0 }, true);
      });
      const submerged = await draw(page, 2);
      assert.equal(submerged.cameraUnderwater, true);
      await capture(page, backend, 'underwater', submerged);
      await page.evaluate(() => {
        const { sim } = greywake.app;
        sim.p.depth = sim.p.targetDepth = 0;
        sim.body.setTranslation({ x: 0, y: -2, z: 0 }, true);
      });
      assert.equal((await draw(page, 2)).cameraUnderwater, false);
      pass(`${backend}: calm, swell, storm, turning, wet hulls, three impacts and dive/surface render`);
    }

    if (!qualityOnly) await page.click('[data-panel="settings"]');
    await page.click('[data-settings-tab="graphics"]');
    await page.evaluate(() => {
      const backend = greywake.app.view.renderer.backend;
      window.waterBufferProbe = new Map();
      if (backend.device) {
        const create = backend.device.createBuffer.bind(backend.device);
        backend.device.createBuffer = (descriptor) => {
          const buffer = create(descriptor),
            destroy = buffer.destroy.bind(buffer);
          waterBufferProbe.set(buffer, descriptor.size);
          buffer.destroy = () => {
            waterBufferProbe.delete(buffer);
            destroy();
          };
          return buffer;
        };
      } else {
        const gl = backend.gl,
          create = gl.createBuffer.bind(gl),
          remove = gl.deleteBuffer.bind(gl);
        gl.createBuffer = () => {
          const buffer = create();
          waterBufferProbe.set(buffer, 0);
          return buffer;
        };
        gl.deleteBuffer = (buffer) => {
          waterBufferProbe.delete(buffer);
          remove(buffer);
        };
      }
    });
    const cycles = [];
    for (let cycle = 0; cycle < 2; cycle++) {
      for (const [quality, spectrum, interaction] of [
        ['mobile', 32, 128],
        ['ultra', 128, 512],
        ['balanced', 64, 256],
      ]) {
        await page.click(`[data-preset="${quality}"]`);
        await page.evaluate(() => {
          greywake.config().graphics.pixelRatio = 0.75;
          greywake.app.view.applySettings();
        });
        const diagnostics = await draw(page);
        assert.equal(diagnostics.water.spectrumResolution, spectrum);
        assert.equal(diagnostics.water.interactionResolution, interaction);
        assert.equal(diagnostics.water.refractionEnabled, quality !== 'mobile');
      }
      cycles.push(
        await page.evaluate(() => ({
          ...greywake.app.view.diagnostics(),
          gpuBuffers: {
            count: waterBufferProbe.size,
            bytes: [...waterBufferProbe.values()].reduce((a, b) => a + b, 0),
          },
        })),
      );
    }
    report.quality.push({ backend, cycles });
    assert.equal(cycles[1].memory.textures, cycles[0].memory.textures, 'Quality switching leaks textures');
    // Three.js counts fresh interleaved attribute views separately even when
    // they share an existing GPU buffer. Check real driver allocations instead.
    assert.deepEqual(cycles[1].gpuBuffers, cycles[0].gpuBuffers, 'Quality switching leaks GPU buffers');
    for (const key of ['uniformBuffers', 'programs', 'indexAttributes', 'texturesSize'])
      assert.equal(cycles[1].memory[key], cycles[0].memory[key], `${key} grows across quality cycles`);
    await page.locator('[data-setting="graphics.waterRefraction"]').uncheck();
    await draw(page);
    assert.equal(await page.evaluate(() => greywake.app.view.ocean.refractionEnabled.value), 0);
    await page.locator('[data-setting="graphics.waterRefraction"]').check();
    await draw(page);
    assert.equal(await page.evaluate(() => greywake.app.view.ocean.refractionEnabled.value), 1);
    const snapshot = await page.evaluate(() => {
      const { sim } = greywake.app;
      const saved = sim.snapshot();
      return {
        bytes: JSON.stringify(saved).length,
        hasWater: !!saved.encounter.water,
        impacts: saved.encounter.waterImpacts.length,
      };
    });
    assert.equal(snapshot.hasWater, true);
    if (!qualityOnly) assert.ok(snapshot.impacts > 0);
    pass(
      `${backend}: repeated quality switches release textures/buffers; refraction toggles and water saves work`,
    );
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  pass('Both browser backends report no console errors or uncaught exceptions');
  report.passed = true;
} catch (error) {
  report.failure = error.stack;
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(
    `${folder}/${qualityOnly ? 'quality-report' : 'report'}.json`,
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
