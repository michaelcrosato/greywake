import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { WATER_LOOKS } from '../src/water-presets.js';
import { validateWaterTuning } from '../src/water-scenarios.js';

const folder = process.env.WATER_REVIEW_FOLDER || 'artifacts/water-review';
const beforePath = process.env.WATER_BEFORE || 'artifacts/water-planning/greywake-before.html';
const builds = { before: await readFile(beforePath), after: await readFile('dist/greywake.html') };
await mkdir(folder, { recursive: true });
const server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end(builds[request.url.startsWith('/before') ? 'before' : 'after']);
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
const fixtures = [
  { name: 'calm-noon', sea: 'calm', duration: 6, hour: 12, clouds: 0.15 },
  { name: 'low-sun-swell', sea: 'atlantic', duration: 8, hour: 17.2, clouds: 0.15 },
  { name: 'overcast-storm', sea: 'storm', duration: 8, hour: 12, clouds: 0.95 },
  { name: 'grazing-swell', sea: 'atlantic', duration: 8, hour: 12, camera: [50, 3, 95] },
  { name: 'stopped-hull', sea: 'atlantic', duration: 10, hour: 12, stopped: true, camera: [75, 9, 25] },
  { name: 'straight-wake', sea: 'calm', duration: 18, hour: 12, camera: [0, 35, 155] },
  { name: 'turn-and-aging-wake', sea: 'atlantic', duration: 42, hour: 12, turn: true, camera: [0, 320, 65] },
  { name: 'wake-crossing', sea: 'calm', duration: 22, hour: 12, crossing: true, camera: [0, 220, 60] },
  {
    name: 'surface-camera-crossing',
    sea: 'calm',
    duration: 6,
    hour: 12,
    stopped: true,
    camera: [40, 0.3, -35],
  },
  {
    name: 'underwater-up',
    sea: 'atlantic',
    duration: 6,
    hour: 12,
    stopped: true,
    depth: 18,
    camera: [45, -18, 40],
    look: [0, 5, 0],
  },
  { name: 'distant-impact', sea: 'calm', duration: 8, hour: 12, impact: true, camera: [75, 25, 150] },
  ...['mobile', 'balanced', 'ultra'].map((quality) => ({
    name: `quality-${quality}`,
    sea: 'atlantic',
    duration: 8,
    hour: 12,
    quality,
  })),
];
const selectedBackends = (process.env.WATER_REVIEW_BACKENDS || 'webgl,webgpu').split(',');
const selectedBuilds = (process.env.WATER_REVIEW_BUILDS || 'before,after').split(',');
const motionOnly = process.env.WATER_REVIEW_MOTION_ONLY === '1';
const selectedNames = process.env.WATER_REVIEW_SCENES?.split(',');
const selectedFixtures = fixtures
  .filter((fixture) => !selectedNames || selectedNames.includes(fixture.name))
  .map((fixture) => ({
    ...fixture,
    duration: Number(process.env.WATER_REVIEW_DURATION || fixture.duration),
  }));
const overrideTuning = process.env.WATER_REVIEW_TUNING
  ? validateWaterTuning(JSON.parse(process.env.WATER_REVIEW_TUNING))
  : {};
const report = {
  beforePath,
  generatedAt: new Date().toISOString(),
  builds: Object.fromEntries(
    Object.entries(builds).map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')]),
  ),
  passed: false,
  adapter: 'SwiftShader; rendered verification, not physical-device FPS',
  scenes: [],
  errors: [],
  motion: [],
};
async function setup(page, fixture, build) {
  const look = build === 'after' ? structuredClone(WATER_LOOKS[fixture.sea].tuning) : {};
  for (const [group, fields] of Object.entries(overrideTuning)) Object.assign((look[group] ||= {}), fields);
  await page.evaluate(
    ({ fixture, look }) => {
      const { app } = greywake,
        config = structuredClone(window.reviewConfig),
        p = structuredClone(window.reviewCareer);
      const seas = { calm: [0.45, 3, 0.25], atlantic: [1.5, 9, 0.65], storm: [3.2, 17, 1.1] };
      const [waveHeight, windSpeed, choppiness] = seas[fixture.sea];
      Object.assign(config.ocean, {
        waveHeight,
        windSpeed,
        choppiness,
        windDirection: 315,
        weather: false,
        stormStrength: 0,
        sunHour: fixture.hour + 13 / 15,
        dayCycle: false,
        cloudCover: fixture.clouds ?? 0.42,
      });
      const qualities = {
        mobile: {
          oceanSegments: 96,
          spectrumResolution: 32,
          interactionResolution: 128,
          reflectionScale: 0.25,
          reflections: true,
          shadows: false,
          shadowResolution: 512,
          waterRefraction: false,
          particles: 300,
        },
        balanced: {
          oceanSegments: 160,
          spectrumResolution: 64,
          interactionResolution: 256,
          reflectionScale: 0.45,
          reflections: true,
          shadows: true,
          shadowResolution: 1024,
          waterRefraction: true,
          particles: 700,
        },
        ultra: {
          oceanSegments: 288,
          spectrumResolution: 128,
          interactionResolution: 512,
          reflectionScale: 0.8,
          reflections: true,
          shadows: true,
          shadowResolution: 2048,
          waterRefraction: true,
          particles: 1400,
        },
      };
      Object.assign(config.graphics, qualities[fixture.quality || 'balanced'], {
        pixelRatio: 1,
        environmentRefresh: 120,
      });
      if (look) for (const [group, values] of Object.entries(look)) Object.assign(config[group], values);
      Object.assign(p, {
        x: -30 * 111000,
        z: -40 * 111000,
        time: 0,
        heading: 0,
        depth: fixture.depth || 0,
        targetDepth: fixture.depth || 0,
        speed: fixture.stopped ? 0 : 7,
        throttle: fixture.stopped ? 0 : 0.85,
        auto: false,
        route: [],
        destination: null,
        seed: 1942,
      });
      const previous = app.sim,
        sim = new previous.constructor(config, p, {
          training: true,
          ambientTraffic: false,
          invulnerable: true,
        });
      app.attachSimulation(sim);
      previous.dispose();
      sim.paused = true;
      sim.setDeveloper({
        enabled: true,
        invulnerable: true,
        infiniteResources: true,
        pauseTraffic: true,
        freezeEnemies: true,
      });
      if (fixture.crossing) {
        sim.addShip(p.x - 120, p.z - 130, Math.PI / 2, false, 42);
        sim.addShip(p.x + 140, p.z + 80, -Math.PI / 2, true, 43);
        for (const ship of sim.ships) ship.speed = ship.escort ? 9 : 6;
        sim.effectiveShipSpeed = (ship) => ship.speed;
      }
      const { view } = app;
      view.clearWorldVisuals();
      view.mode = 'chase';
      view.orbit = view.elevation = 0;
      view.underwaterBlend = 0;
      view.underwater = false;
      view.fixedReviewCamera = fixture.camera || [-60, 36, 100];
      view.fixedReviewLook = fixture.look || [0, 0, -15];
      view.camera.position.set(...view.fixedReviewCamera);
      window.reviewLookAt(...view.fixedReviewLook);
      let randomSeed = 1942;
      view.rng = () => {
        randomSeed += 0x6d2b79f5;
        let t = Math.imul(randomSeed ^ (randomSeed >>> 15), 1 | randomSeed);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      window.reviewElapsed = 0;
      window.reviewFixture = fixture;
    },
    { fixture, look },
  );
}
async function advance(page, seconds) {
  await page.evaluate(
    ({ seconds }) => {
      const { sim, view } = greywake.app,
        fixture = window.reviewFixture;
      const render = view.renderer.render,
        refraction = view.ocean.captureRefraction;
      view.renderer.render = () => {};
      view.ocean.captureRefraction = () => {};
      try {
        for (let i = 0; i < Math.round(seconds * 30); i++) {
          const elapsed = window.reviewElapsed;
          sim.rudder = fixture.turn && elapsed >= 8 && elapsed < 23 ? 1 : 0;
          if (fixture.crossing)
            for (const ship of sim.ships) {
              ship.x += (Math.sin(ship.heading) * ship.speed) / 30;
              ship.z -= (Math.cos(ship.heading) * ship.speed) / 30;
            }
          if (fixture.impact && elapsed >= 5 && elapsed < 5 + 1 / 30)
            sim.waterImpact('torpedo', sim.p.x + 230, sim.p.z - 230, 2.5, 2);
          sim.paused = false;
          sim.update(1 / 30);
          view.render(1 / 30, false, 1 / 30);
          sim.paused = true;
          window.reviewElapsed += 1 / 30;
        }
      } finally {
        view.renderer.render = render;
        view.ocean.captureRefraction = refraction;
        sim.paused = true;
      }
    },
    { seconds },
  );
}
async function draw(page, refresh = false) {
  return page.evaluate(
    async ({ refresh }) => {
      const { sim, view } = greywake.app;
      // Native animation is suspended for deterministic capture. Advance Three's
      // frame clock so frame-scoped reflection and shadow nodes render fresh maps.
      view.renderer._nodes.nodeFrame.update();
      view.camera.position.set(...view.fixedReviewCamera);
      if (refresh) {
        const underwater = view.underwater;
        view.underwater = false;
        view.lastEnvironmentUpdate = -Infinity;
        view.environmentSun.set(0, 0, 0);
        view.environmentCloud = -10;
        window.reviewEnvironment(true);
        view.underwater = underwater;
      }
      view.render(0.2, false, 0.2);
      if (view.renderer.backend.device) await view.renderer.backend.device.queue.onSubmittedWorkDone();
      else view.renderer.backend.gl.finish();
      return {
        ...view.diagnostics(),
        fixture: window.reviewFixture,
        tuning: Object.fromEntries(
          ['ocean', 'waterWaves', 'waterAppearance', 'waterInteraction', 'waterMotion'].map((group) => [
            group,
            sim.config[group],
          ]),
        ),
        seed: 1942,
        duration: window.reviewElapsed,
        heading: sim.p.heading,
        camera: { position: view.camera.position.toArray(), quaternion: view.camera.quaternion.toArray() },
        sun: view.sun.toArray(),
      };
    },
    { refresh },
  );
}
try {
  for (const backend of selectedBackends)
    for (const build of selectedBuilds) {
      const context = await browser.newContext({ viewport: { width: 960, height: 600 } }),
        page = await context.newPage();
      page.on('pageerror', (error) => report.errors.push({ build, backend, message: error.stack }));
      page.on('console', (message) => {
        if (message.type() === 'error') report.errors.push({ build, backend, message: message.text() });
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/${build}?renderer=${backend}`);
      await page.waitForFunction(() => window.greywake?.ready, null, { timeout: 120000 });
      await page.evaluate(() => {
        window.requestAnimationFrame = () => 0;
        const { app } = greywake;
        app.started = true;
        window.reviewConfig = structuredClone(app.sim.config);
        window.reviewCareer = structuredClone(app.sim.p);
        window.reviewLookAt = app.view.camera.lookAt.bind(app.view.camera);
        app.view.camera.lookAt = () => app.view.camera;
        app.view.camera.position.lerp = () => app.view.camera.position;
        window.reviewEnvironment = app.view.refreshEnvironment.bind(app.view);
        app.view.refreshEnvironment = () => {};
        Object.defineProperty(app.view.sky.cloudSpeed, 'value', {
          configurable: true,
          get: () => 0,
          set: () => {},
        });
        for (const id of ['launch', 'hud', 'modal', 'guide', 'water-lab', 'toast']) {
          const element = document.getElementById(id);
          if (element) element.hidden = true;
        }
      });
      await page.waitForTimeout(200);
      for (const fixture of motionOnly ? [] : selectedFixtures) {
        await setup(page, fixture, build);
        await advance(page, fixture.duration);
        const diagnostics = await draw(page, true);
        const path = `${folder}/${build}-${backend}-${fixture.name}.png`;
        await page.screenshot({ path, timeout: 120000 });
        report.scenes.push({ build, backend, name: fixture.name, path, diagnostics });
        await writeFile(`${folder}/capture-checkpoint.json`, JSON.stringify(report, null, 2));
        console.log(`CAPTURE ${build} ${backend} ${fixture.name}`);
      }
      if (build === 'after' && process.env.WATER_REVIEW_SKIP_MOTION !== '1')
        for (const fixture of [fixtures[1], fixtures[6], fixtures[8]].filter(
          (fixture) => !selectedNames || selectedNames.includes(fixture.name),
        )) {
          await setup(page, fixture, build);
          await advance(page, fixture.duration);
          await draw(page, true);
          const clipFolder = `${folder}/${backend}-${fixture.name}-motion`;
          await mkdir(clipFolder, { recursive: true });
          const frames = [];
          for (let i = 0; i < 24; i++) {
            await advance(page, (i % 2 ? 2 : 3) / 30);
            if (fixture.name === 'surface-camera-crossing')
              await page.evaluate((i) => {
                const { sim, view } = greywake.app;
                view.fixedReviewCamera[1] = sim.sampleWater(sim.p.x + 40, sim.p.z - 35) + 0.8 - i * 0.07;
              }, i);
            frames.push(await draw(page));
            await page.screenshot({
              path: `${clipFolder}/frame-${String(i).padStart(3, '0')}.png`,
              timeout: 120000,
            });
          }
          report.motion.push({ backend, name: fixture.name, folder: clipFolder, fps: 12, frames });
          execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', [
            '-y',
            '-loglevel',
            'error',
            '-framerate',
            '12',
            '-i',
            `${clipFolder}/frame-%03d.png`,
            '-c:v',
            'libx264',
            '-threads',
            '2',
            '-crf',
            '20',
            '-pix_fmt',
            'yuv420p',
            '-movflags',
            '+faststart',
            `${folder}/${backend}-${fixture.name}.mp4`,
          ]);
          await writeFile(`${folder}/capture-checkpoint.json`, JSON.stringify(report, null, 2));
          console.log(`MOTION ${backend} ${fixture.name}`);
        }
      assert.deepEqual(await page.evaluate(() => window.__consoleErrors), []);
      await context.close();
    }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} finally {
  await writeFile(`${folder}/report.json`, JSON.stringify(report, null, 2));
  await writeFile(
    `${folder}/index.html`,
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Greywake water review</title>
  <style>body{margin:2rem auto;padding:0 1rem;max-width:1500px;background:#101a22;color:#e1e9e8;font:16px system-ui}h2{margin-top:3rem}figure{margin:0}img,video{width:100%;display:block}figcaption{padding:.7rem;background:#20303b}.pair{display:grid;grid-template-columns:1fr 1fr;gap:1rem}code{overflow-wrap:anywhere}a{color:#9fced7}@media(max-width:700px){.pair{grid-template-columns:1fr}}</style>
  <h1>Water Lab and ocean review</h1><p>Generated ${report.generatedAt}. ${report.adapter}. Matched seed, accepted time, camera, lighting and capability settings; final presets are applied to the upgraded water.</p>
  <p>After SHA-256: <code>${report.builds.after}</code></p><p><a href="report.json">Raw settings, camera poses, backend diagnostics and motion frame metadata</a></p>
  ${selectedBackends.map((backend) => `<h2>${backend}</h2>${selectedFixtures.map((fixture) => `<h3>${fixture.name}</h3><div class="pair">${['before', 'after'].map((build) => `<figure><img loading="lazy" src="${build}-${backend}-${fixture.name}.png" alt="${build} ${backend} ${fixture.name}"><figcaption>${build}</figcaption></figure>`).join('')}</div>`).join('')}`).join('')}
  <h2>Motion</h2><p>Clips use actual rendered frames at 12 fps; source PNGs and per-frame metadata are retained.</p>${report.motion.map((clip) => `<h3>${clip.backend} · ${clip.name}</h3><video controls loop preload="none" poster="${clip.backend}-${clip.name}-motion/frame-000.png" src="${clip.backend}-${clip.name}.mp4"></video>`).join('')}
  </html>`,
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
