import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const folder = 'artifacts/water-lab';
await mkdir(folder, { recursive: true });
const html = await readFile('dist/greywake.html');
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
const report = { passed: false, checks: [], errors: [], captures: [] };
const pass = (name) => {
  report.checks.push(name);
  console.log(`PASS ${name}`);
};
async function capture(page, name) {
  const diagnostics = await page.evaluate(async () => {
    const { view } = greywake.app;
    view.renderer._nodes.nodeFrame.update();
    view.refreshEnvironment(true);
    view.render(0.2, false, 0.2);
    if (view.renderer.backend.device) await view.renderer.backend.device.queue.onSubmittedWorkDone();
    else view.renderer.backend.gl.finish();
    return view.diagnostics();
  });
  await page.screenshot({ path: `${folder}/${name}.png`, timeout: 120000 });
  report.captures.push({ name, diagnostics });
}
async function suspendGpu(page, operation) {
  await page.evaluate(() => {
    const { view } = greywake.app;
    window.labRender = view.renderer.render;
    window.labRefraction = view.ocean.captureRefraction;
    view.renderer.render = () => {};
    view.ocean.captureRefraction = () => {};
  });
  try {
    await operation();
  } finally {
    await page.evaluate(() => {
      const { view } = greywake.app;
      view.renderer.render = window.labRender;
      view.ocean.captureRefraction = window.labRefraction;
    });
  }
}
try {
  for (const backend of ['webgl', 'webgpu']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } }),
      page = await context.newPage();
    page.on('pageerror', (error) => report.errors.push(error.stack));
    page.on('console', (message) => {
      if (message.type() === 'error') report.errors.push(message.text());
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/?renderer=${backend}`);
    await page.waitForFunction(() => window.greywake?.ready, null, { timeout: 120000 });
    await page.evaluate(() => {
      window.requestAnimationFrame = () => 0;
      window.parkedWater = JSON.stringify(greywake.app.careerSnapshot());
      window.parkedCamera = {
        mode: greywake.app.view.mode,
        orbit: greywake.app.view.orbit,
        elevation: greywake.app.view.elevation,
      };
    });
    await page.waitForTimeout(200);
    await page.click('#launch-settings');
    await page.click('[data-settings-tab="ocean"]');
    await page.click('#open-water-lab');
    assert.equal(await page.evaluate(() => greywake.app.waterLab.active), true);
    assert.equal(await page.locator('#modal').isVisible(), false);
    assert.equal(
      await page.evaluate(() => JSON.stringify(greywake.app.careerSnapshot()) === window.parkedWater),
      true,
    );
    const dock = await page.locator('#water-lab').boundingBox();
    assert.ok(dock.width <= 1280 / 3);
    await page.evaluate(() => {
      document.querySelector('.water-lab-body').scrollTop = 0;
    });
    await capture(page, `${backend}-desktop`);
    pass(`${backend}: dock from launch parks career`);
    await page.selectOption('#water-scene', 'calm');
    await page.selectOption('#water-camera', 'low bow');
    await page.selectOption('#water-lighting', 'low sun');
    await suspendGpu(page, async () => {
      await page.click('[data-water-step="1"]');
      await page.waitForFunction(() => !greywake.app.waterLab.advancing);
    });
    assert.ok(Math.abs((await page.evaluate(() => greywake.app.waterLab.elapsed)) - 1) < 1e-8);
    const originalRoughness = await page.evaluate(() => greywake.config().waterAppearance.roughness);
    await page.click('[data-water-store="A"]');
    await page.click('[data-water-section="Surface"]');
    const control = page.locator('input[type="number"][data-water-setting="waterAppearance.roughness"]');
    await control.fill('0.15');
    await control.dispatchEvent('change');
    await page.click('[data-water-store="B"]');
    const held = await page.evaluate(() =>
      JSON.stringify({ career: greywake.app.sim.p, water: greywake.app.sim.water.snapshot() }),
    );
    await page.click('[data-water-view="A"]');
    assert.equal(await page.evaluate(() => greywake.config().waterAppearance.roughness), originalRoughness);
    await page.click('[data-water-view="B"]');
    assert.equal(await page.evaluate(() => greywake.config().waterAppearance.roughness), 0.15);
    assert.equal(
      await page.evaluate(() =>
        JSON.stringify({ career: greywake.app.sim.p, water: greywake.app.sim.water.snapshot() }),
      ),
      held,
    );
    await capture(page, `${backend}-low-sun`);
    await page.click('[data-water-section="Inspect"]');
    for (const mode of ['2', '3', '4', '11', '12', '13', '0']) {
      await page.selectOption('#water-inspect', mode);
      await capture(page, `${backend}-inspect-${mode}`);
    }
    assert.equal(await page.evaluate(() => greywake.app.view.probeOverlay.visible), false);
    const parity = await page.evaluate(async () => {
      const { sim, view } = greywake.app,
        points = [
          [0, 0],
          [12, 17],
          [-30, 55],
          [90, -64],
          [170, 90],
        ];
      view.ocean.update(sim, view.sun, view.sunColor);
      // Three.js uses animation callbacks to poll GL fences. The game loop has
      // already stopped; temporarily allow only the readback polling callbacks.
      const stopped = window.requestAnimationFrame;
      window.requestAnimationFrame = (callback) => setTimeout(() => callback(performance.now()), 0);
      let gpu;
      try {
        gpu = await view.ocean.verifySurfaceSamples(view.renderer, points);
      } finally {
        window.requestAnimationFrame = stopped;
      }
      return points.map(([x, z], i) => ({
        gpu: gpu[i],
        cpu: sim.water.sample(sim.oceanX + x, sim.p.z + z, sim.visualTime, sim.weather),
      }));
    });
    for (const sample of parity)
      assert.ok(
        Number.isFinite(sample.gpu) && Math.abs(sample.gpu - sample.cpu) < 0.035,
        JSON.stringify(sample),
      );
    const meshParity = await page.evaluate(async () => {
      const { sim, view } = greywake.app,
        points = [
          [0, 0],
          [12.3, 17.4],
          [-30.2, 55.7],
        ],
        spacing = 384 / sim.config.graphics.oceanSegments;
      const stopped = requestAnimationFrame;
      window.requestAnimationFrame = (callback) => setTimeout(() => callback(performance.now()), 0);
      let gpu;
      try {
        gpu = await view.ocean.verifySurfaceSamples(view.renderer, points, spacing);
      } finally {
        window.requestAnimationFrame = stopped;
      }
      const pyramids = sim.water.cascades.map((cascade) => {
        const levels = [{ data: cascade.displacement, n: cascade.resolution }];
        while (levels.at(-1).n > 1) {
          const old = levels.at(-1),
            n = old.n / 2,
            data = new Float32Array(n * n * 4);
          for (let z = 0; z < n; z++)
            for (let x = 0; x < n; x++)
              for (let c = 0; c < 4; c++)
                data[(z * n + x) * 4 + c] =
                  (old.data[(z * 2 * old.n + x * 2) * 4 + c] +
                    old.data[(z * 2 * old.n + x * 2 + 1) * 4 + c] +
                    old.data[((z * 2 + 1) * old.n + x * 2) * 4 + c] +
                    old.data[((z * 2 + 1) * old.n + x * 2 + 1) * 4 + c]) /
                  4;
          levels.push({ data, n });
        }
        return levels;
      });
      const weights = sim.water.amplitudes(sim.weather),
        chop = sim.water.effectiveChop;
      return points.map(([x, z], index) => {
        const wx = sim.oceanX + x,
          wz = sim.p.z + z;
        let height = 0,
          dx = 0,
          dz = 0;
        for (const wave of sim.water.swell) {
          const t = Math.max(0, Math.min(1, (wave.length - spacing * 2) / (spacing * 2)));
          height +=
            Math.sin(
              (wx * wave.dx + wz * wave.dz) * wave.k -
                wave.omega * sim.water.phaseAt(sim.visualTime) +
                wave.phase,
            ) *
            wave.amplitude *
            sim.config.ocean.waveHeight *
            (1 + sim.weather) *
            t *
            t *
            (3 - 2 * t);
        }
        for (let band = 0; band < 3; band++) {
          const cascade = sim.water.cascades[band],
            levels = pyramids[band],
            lod = Math.min(
              levels.length - 1,
              Math.max(0, Math.log2((spacing * cascade.resolution) / cascade.size)),
            ),
            lo = Math.floor(lod),
            hi = Math.min(lo + 1, levels.length - 1),
            fraction = lod - lo;
          const sample = (level, component) => {
            const { data, n } = levels[level],
              offset = cascade.size * (0.5 / cascade.resolution - 0.5 / n);
            return cascade.sample.call(
              { resolution: n, size: cascade.size },
              data,
              wx + offset,
              wz + offset,
              component,
            );
          };
          dx += (sample(lo, 0) * (1 - fraction) + sample(hi, 0) * fraction) * weights[band] * chop;
          height += (sample(lo, 1) * (1 - fraction) + sample(hi, 1) * fraction) * weights[band];
          dz += (sample(lo, 2) * (1 - fraction) + sample(hi, 2) * fraction) * weights[band] * chop;
        }
        height += sim.water.interactions.sample(wx + dx, wz + dz) * sim.config.ocean.wakeStrength;
        return { gpu: gpu[index], cpu: [x + dx, height, z + dz] };
      });
    });
    for (const sample of meshParity)
      for (let i = 0; i < 3; i++)
        assert.ok(Math.abs(sample.gpu[i] - sample.cpu[i]) < 0.035, JSON.stringify(sample));
    pass(`${backend}: actual mesh displacement agrees with its filtered CPU reference within 3.5 cm`);
    report.checks.push({ backend, meshParity });
    report.checks.push({ backend, parity });
    pass(`${backend}: actual GPU surface query agrees with CPU within 3.5 cm`);
    pass(`${backend}: exact stepping, live controls and held A/B`);
    const shadowOwners = await page.evaluate(() => {
      const view = greywake.app.view,
        shadow = view.ocean.sunShadow;
      const update = shadow.updateShadow.bind(shadow),
        owners = [];
      shadow.updateShadow = (frame) => {
        owners.push(frame.camera === view.camera);
        return update(frame);
      };
      try {
        view.renderer._nodes.nodeFrame.update();
        view.render(1 / 30, false, 1 / 30);
      } finally {
        shadow.updateShadow = update;
      }
      return owners;
    });
    assert.ok(shadowOwners.includes(true), JSON.stringify(shadowOwners));
    pass(`${backend}: a fresh manual frame updates the main shadow map`);
    await page.check('#water-freeze');
    await page.click('#water-export');
    const recipe = await page.evaluate(() => greywake.app.waterLab.recipe());
    await suspendGpu(page, async () => {
      const chooserPromise = page.waitForEvent('filechooser');
      await page.click('#water-import');
      await (await chooserPromise).setFiles({
        name: 'water.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(recipe)),
      });
      await page.waitForFunction(() =>
        document.querySelector('#water-feedback').textContent.includes('reconstructed'),
      );
    });
    assert.ok(Math.abs((await page.evaluate(() => greywake.app.waterLab.elapsed)) - 1) < 1e-8);
    const restoredCamera = await page.evaluate(() => {
      const { view } = greywake.app;
      view.render(0, false, 0);
      return { position: view.camera.position.toArray(), rotation: view.camera.quaternion.toArray() };
    });
    for (const [i, key] of ['x', 'y', 'z'].entries())
      assert.ok(Math.abs(restoredCamera.position[i] - recipe.camera.position[key]) < 1e-5);
    for (const [i, key] of ['x', 'y', 'z', 'w'].entries())
      assert.ok(Math.abs(restoredCamera.rotation[i] - recipe.camera.rotation[key]) < 1e-8);
    const beforeInvalid = await page.evaluate(() => JSON.stringify(greywake.app.sim.snapshot()));
    assert.equal(await page.isChecked('#water-freeze'), true);
    assert.equal(await page.evaluate(() => greywake.app.sim.water.freezePhase), true);
    const chooserPromise = page.waitForEvent('filechooser');
    await page.click('#water-import');
    await (await chooserPromise).setFiles({
      name: 'invalid.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ ...recipe, seed: 1.5 })),
    });
    await page.waitForFunction(() =>
      document.querySelector('#water-feedback').textContent.includes('Import failed'),
    );
    assert.equal(await page.evaluate(() => JSON.stringify(greywake.app.sim.snapshot())), beforeInvalid);
    assert.equal(
      await page.evaluate(() => JSON.stringify(greywake.app.careerSnapshot()) === window.parkedWater),
      true,
    );
    await page.click('#water-apply');
    assert.equal(
      await page.evaluate(() => greywake.app.waterLab.careerSim.config.waterAppearance.roughness),
      0.15,
    );
    assert.equal(
      await page.evaluate(
        () =>
          JSON.stringify(greywake.app.careerSnapshot().career) ===
          JSON.stringify(JSON.parse(window.parkedWater).career),
      ),
      true,
    );
    const memoryCycles = [];
    for (let cycle = 0; cycle < 2; cycle++) {
      await page.selectOption('#water-scene', 'crossing');
      await suspendGpu(page, () => page.evaluate(() => greywake.app.waterLab.step(1)));
      await page.selectOption('#water-scene', 'flat');
      await page.selectOption('#water-scene', 'calm');
      await capture(page, `${backend}-reset-cycle-${cycle}`);
      memoryCycles.push(
        await page.evaluate(() => ({
          memory: { ...greywake.app.view.renderer.info.memory },
          shaders: greywake.app.view.renderer._nodes.nodeBuilderCache.size,
        })),
      );
    }
    assert.equal(memoryCycles[1].memory.textures, memoryCycles[0].memory.textures);
    assert.equal(memoryCycles[1].shaders, memoryCycles[0].shaders);
    report.checks.push({ backend, memoryCycles });
    pass(`${backend}: repeated scene resets retire material and texture resources`);
    await page.click('#water-exit');
    assert.equal(await page.locator('#launch').isVisible(), true);
    assert.equal(await page.evaluate(() => greywake.app.started), false);
    pass(`${backend}: recipe import is atomic; apply and return preserve patrol`);
    await page.click('#begin');
    await page.evaluate(() => {
      greywake.app.ui.close();
      greywake.app.sim.paused = true;
    });
    await page.keyboard.press('F2');
    await page.click('#dev-water-lab');
    await suspendGpu(page, async () => {
      const longRecipe = await page.evaluate(() => {
        const lab = greywake.app.waterLab;
        const importRecipe = lab.importRecipe.bind(lab);
        lab.importRecipe = async (value) => {
          window.importFinished = false;
          try {
            await importRecipe(value);
          } finally {
            window.importFinished = true;
          }
        };
        return { ...lab.recipe(), duration: 30, actions: [{ type: 'helm', time: 29, throttle: 0 }] };
      });
      const chooser = page.waitForEvent('filechooser');
      await page.click('#water-import');
      await (await chooser).setFiles({
        name: 'long-replay.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(longRecipe)),
      });
      await page.waitForFunction(() => greywake.app.waterLab.advancing);
      await page.selectOption('#water-scene', 'flat');
      await page.waitForFunction(() => window.importFinished);
      assert.deepEqual(
        await page.evaluate(() => {
          const { waterLab: lab, view } = greywake.app;
          return [lab.elapsed, lab.actions.length, view.comparisonCamera, lab.scenario, lab.advancing];
        }),
        [0, 0, null, 'flat', false],
      );
      await page.click('[data-water-step="10"]');
      await page.waitForFunction(() => greywake.app.waterLab.advancing);
      await page.click('#water-play');
      const pausedAt = await page.evaluate(() => greywake.app.waterLab.elapsed);
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => greywake.app.waterLab.elapsed), pausedAt);
      assert.ok(pausedAt > 0 && pausedAt < 10);
      await page.click('[data-water-section="Boat response"]');
      const live = page.locator('input[type="number"][data-water-setting="waterMotion.velocityInfluence"]');
      const editedAt = await page.evaluate(() => greywake.app.waterLab.elapsed);
      await live.fill('0.2');
      // Playback can advance while a dragged/typed control still has focus.
      await page.evaluate(() => greywake.app.waterLab.advanceFrame());
      await live.dispatchEvent('change');
      assert.equal(
        await page.evaluate(
          () =>
            greywake.app.waterLab.actions.findLast(
              (action) => action.type === 'tune' && action.tuning.waterMotion?.velocityInfluence === 0.2,
            ).time,
        ),
        editedAt,
      );
    });
    pass(`${backend}: recipe camera restores; reset and pause cancel active advances without stale writes`);
    pass(`${backend}: live scalar edits are recorded at the first frame they affect`);

    const transitions = await page.evaluate(() => {
      const app = greywake.app;
      const career = app.waterLab.careerSim;
      const baseline = JSON.stringify(app.careerSnapshot());
      let disposed = 0;
      const watch = () => {
        const sim = app.sim;
        const dispose = sim.dispose.bind(sim);
        sim.dispose = () => {
          disposed++;
          dispose();
        };
      };
      watch();
      app.tutorial.start();
      const tutorial = !app.waterLab.active && app.tutorial.active && app.tutorial.careerSim === career;
      app.waterLab.start();
      const fromTutorial = !app.tutorial.active && app.waterLab.active && app.waterLab.careerSim === career;
      watch();
      app.aiLab.start();
      const ai = !app.waterLab.active && app.aiLab.active && app.aiLab.careerSim === career;
      app.waterLab.start();
      const fromAI = !app.aiLab.active && app.waterLab.active && app.waterLab.careerSim === career;
      const unchanged = JSON.stringify(app.careerSnapshot()) === baseline;
      watch();
      const imported = JSON.parse(baseline);
      imported.career.bounty = 4321;
      app.loadCareer(imported);
      const importedOK = !app.waterLab.active && app.sim.p.bounty === 4321 && !app.waterLab.careerSim;
      app.sim.paused = true;
      app.waterLab.start();
      watch();
      const patrolRoughness = app.waterLab.careerSim.config.waterAppearance.roughness;
      app.sim.config.waterAppearance.roughness = 0.23;
      app.reset();
      const fresh =
        !app.waterLab.active &&
        app.sim.p.bounty === 1800 &&
        app.sim.config.waterAppearance.roughness === patrolRoughness;
      app.sim.paused = true;
      app.waterLab.start();
      return { tutorial, fromTutorial, ai, fromAI, unchanged, importedOK, fresh, disposed };
    });
    assert.deepEqual(transitions, {
      tutorial: true,
      fromTutorial: true,
      ai: true,
      fromAI: true,
      unchanged: true,
      importedOK: true,
      fresh: true,
      disposed: 4,
    });
    pass(
      `${backend}: tutorial, AI, career import and new-career transitions dispose experiments and preserve tuning isolation`,
    );
    for (const size of [
      { width: 393, height: 852 },
      { width: 852, height: 393 },
    ]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(200);
      await page.evaluate(() => greywake.app.view.resize());
      await page.evaluate(() => {
        document.querySelector('.water-lab-body').scrollTop = 0;
      });
      const rect = await page.locator('#water-lab').boundingBox();
      assert.ok(rect.height < size.height * 0.5);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await capture(page, `${backend}-${size.width}x${size.height}`);
      await page.click('#water-collapse');
      assert.equal(await page.locator('.water-lab-body').isVisible(), false);
      await page.click('#water-collapse');
    }
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => greywake.app.waterLab.active), false);
    assert.equal(await page.evaluate(() => greywake.app.sim.paused), true);
    assert.deepEqual(
      await page.evaluate(() => {
        const view = greywake.app.view;
        return [
          view.ocean.inspect.value,
          view.ocean.material.wireframe,
          view.probeOverlay.visible,
          view.labCamera,
          view.comparisonCamera,
        ];
      }),
      [0, false, false, null, null],
    );
    pass(`${backend}: F2 entry, touch layouts, collapse and keyboard return`);
    assert.equal(
      await page.evaluate(() => greywake.app.view.backend),
      backend === 'webgpu' ? 'WebGPU' : 'WebGL 2',
    );
    assert.deepEqual(await page.evaluate(() => window.__consoleErrors), []);
    if (backend === 'webgl') {
      const careerFile = await page.evaluate(() => {
        const app = greywake.app;
        app.sim.config.graphics.interactionResolution = 512;
        app.sim.water.resizeInteractions();
        const exported = JSON.stringify(app.careerSnapshot(), null, 2);
        app.waterLab.start();
        app.ui.open('log');
        return exported;
      });
      assert.ok(careerFile.length > 2e6 && careerFile.length < 4e6);
      const chooser = page.waitForEvent('filechooser');
      await page.click('#import-save');
      await (await chooser).setFiles({
        name: 'ultra-career.json',
        mimeType: 'application/json',
        buffer: Buffer.from(careerFile),
      });
      await page.waitForFunction(() => !greywake.app.waterLab.active);
      assert.equal(await page.evaluate(() => greywake.app.sim.water.interactions.resolution), 512);
      assert.equal(await page.evaluate(() => greywake.app.sim.p.bounty), 1800);
      pass(
        'webgl: a career export above 2 MB imports through the actual file control while the lab is active',
      );
    }
    if (backend === 'webgpu') {
      // Stop the ordinary loop immediately on reload so recovery cannot advance the checkpoint.
      await page.addInitScript(() => {
        const raf = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = (callback) =>
          raf((now) => {
            if (!window.greywake?.ready) callback(now);
          });
      });
      for (const started of [false, true]) {
        await page.goto(`http://127.0.0.1:${server.address().port}/?renderer=webgpu`);
        await page.waitForFunction(() => window.greywake?.ready, null, { timeout: 120000, polling: 100 });
        const expected = await page.evaluate((started) => {
          const app = greywake.app;
          if (started) app.begin({ guided: false });
          app.sim.paused = true;
          app.sim.p.bounty = 7777;
          const expected = JSON.stringify(app.careerSnapshot().career);
          app.waterLab.start();
          app.sim.p.bounty = 99999;
          return expected;
        }, started);
        await page.evaluate(() =>
          window.dispatchEvent(
            new CustomEvent('greywake:gpu-lost', {
              detail: { message: 'Water Lab recovery verification' },
            }),
          ),
        );
        await page.waitForURL('**renderer=webgl**', { timeout: 120000 });
        await page.waitForFunction(() => window.greywake?.ready, null, { timeout: 120000, polling: 100 });
        const recovered = await page.evaluate(() => {
          const app = greywake.app;
          return {
            career: JSON.stringify(app.sim.p),
            started: app.started,
            paused: app.sim.paused,
            lab: app.waterLab.active,
            backend: app.view.backend,
            launch: !document.getElementById('launch').hidden,
          };
        });
        assert.deepEqual(recovered, {
          career: expected,
          started,
          paused: true,
          lab: false,
          backend: 'WebGL 2',
          launch: !started,
        });
      }
      pass('webgpu: device-loss recovery restores the parked launch/patrol state and paused career in WebGL');
    }
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} finally {
  await writeFile(`${folder}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
