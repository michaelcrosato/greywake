import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const source = process.env.AUDIT_BUILD || 'dist/greywake.html';
const html = await readFile(source);
await mkdir('artifacts/render-audit', { recursive: true });
const server = createServer((_, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: false,
  args: [
    '--no-sandbox',
    '--disable-gpu-watchdog',
    '--enable-unsafe-swiftshader',
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--use-angle=vulkan',
    '--use-vulkan=swiftshader',
    '--use-webgpu-adapter=swiftshader',
    '--disable-vulkan-surface',
  ],
});
const cases = (process.env.AUDIT_CASES || 'original,no-reflections').split(',');
const report = {
  source,
  sha256: createHash('sha256').update(html).digest('hex'),
  generatedAt: new Date().toISOString(),
  adapter: 'SwiftShader software adapter; compare relative costs, not hardware FPS',
  method:
    '12 warmup callbacks, then 24 animation callbacks that rendered. Percentiles describe this short software-adapter sample. CPU timings are inclusive and overlap; submission/upload preparation is not measured GPU time.',
  passed: false,
  cases: [],
};
try {
  for (const name of cases) {
    const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
    const errors = [];
    page.on('console', (m) => {
      if (m.text().startsWith('AUDIT ')) console.log(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(
      ({ name }) => {
        const original = window.requestAnimationFrame.bind(window);
        const samples = [];
        let last = 0,
          installed = false,
          builds = 0,
          pipelines = 0,
          frames = 0,
          renderCalls = 0,
          timings = {};
        const time = (object, method, key) => {
          if (!object?.[method]) return;
          const run = object[method].bind(object);
          object[method] = (...args) => {
            const start = performance.now();
            try {
              return run(...args);
            } finally {
              timings[key] = (timings[key] || 0) + performance.now() - start;
            }
          };
        };
        window.requestAnimationFrame = (callback) => {
          return original((now) => {
            if (window.renderProfile) return;
            const v = window.greywake?.app.view;
            if (window.greywake?.ready && !installed) {
              installed = true;
              const nodes = v.renderer._nodes,
                build = nodes._createNodeBuilder.bind(nodes);
              nodes._createNodeBuilder = (...args) => {
                builds++;
                return build(...args);
              };
              const backend = v.renderer.backend,
                pipeline = backend.createRenderPipeline.bind(backend);
              backend.createRenderPipeline = (...args) => {
                pipelines++;
                return pipeline(...args);
              };
              if (name === 'persistent-fog') {
                let current = v.scene.fog;
                Object.defineProperty(v.scene, 'fog', {
                  configurable: true,
                  get: () => current,
                  set: (value) => {
                    if (!current) current = value;
                    else {
                      current.color.copy(value.color);
                      current.density = value.density;
                    }
                  },
                });
              }
              if (name === 'no-reflections') v.config.graphics.reflections = false;
              if (name === 'no-water') for (const mesh of v.ocean.meshes) mesh.visible = false;
              if (name === 'no-sky') v.sky.visible = false;
              if (name.startsWith('lab-')) {
                const { waterLab } = window.greywake.app;
                waterLab.start();
                waterLab.scenario = name === 'lab-boats' ? 'crossing' : 'head';
                waterLab.reset(true);
                waterLab.playing = true;
                if (name === 'lab-underwater') {
                  v.sim.p.depth = v.sim.p.targetDepth = 30;
                  v.sim.body.setTranslation({ x: 0, y: -32, z: 0 }, true);
                  waterLab.bookmark = 'underwater up';
                  waterLab.setCamera();
                }
              } else window.greywake.app.begin({ guided: false });
              time(v.sim, 'update', 'simulationMs');
              time(v.sim.water, 'ensure', 'waterPreparationMs');
              time(v.sim.water, 'sampleSurface', 'surfaceQueryMs');
              time(v.sim.water.interactions, 'step', 'interactionMs');
              time(v.ocean, 'update', 'uploadPreparationMs');
              time(v, 'render', 'renderSubmissionMs');
              const render = v.render.bind(v);
              v.render = (...args) => {
                renderCalls++;
                return render(...args);
              };
            }
            timings = {};
            renderCalls = 0;
            if (installed && name === 'lab-tuning')
              v.config.waterAppearance.roughness = frames % 2 ? 0.065 : 0.08;
            const start = performance.now();
            callback(now);
            if (!renderCalls) return;
            const sample = {
              frame: frames++,
              wallMs: last ? start - last : 0,
              callbackCpuMs: performance.now() - start,
              ...timings,
              renderCalls,
              builders: builds,
              pipelines,
              nodeStates: v.renderer._nodes.nodeBuilderCache.size,
              memory: { ...v.renderer.info.memory },
              drawCalls: v.renderer.info.render.drawCalls,
              triangles: v.renderer.info.render.triangles,
              requestedAcceleration: v.sim.acceleration,
              achievedAcceleration: v.sim.achievedAcceleration || 0,
            };
            last = start;
            if (frames > 12) samples.push(sample);
            if (samples.length === 24)
              window.renderProfile = {
                name,
                samples,
                backend: v.backend,
                errors: window.__consoleErrors,
                diagnostics: v.diagnostics(),
              };
          });
        };
      },
      { name },
    );
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.renderProfile, null, { timeout: 600000, polling: 100 });
    const result = await page.evaluate(() => window.renderProfile);
    result.summary = {};
    for (const key of [
      'wallMs',
      'callbackCpuMs',
      'renderSubmissionMs',
      'simulationMs',
      'waterPreparationMs',
      'surfaceQueryMs',
      'interactionMs',
      'uploadPreparationMs',
    ]) {
      const values = result.samples.map((sample) => sample[key] || 0).sort((a, b) => a - b);
      result.summary[key] = {
        p50: values[Math.ceil(values.length * 0.5) - 1],
        p95: values[Math.ceil(values.length * 0.95) - 1],
      };
    }
    result.allocations = {};
    for (const key of ['textures', 'geometries', 'attributes']) {
      const values = result.samples.map((sample) => sample.memory[key]).filter(Number.isFinite);
      if (values.length) result.allocations[key] = { min: Math.min(...values), max: Math.max(...values) };
    }
    for (const key of ['builders', 'pipelines', 'nodeStates']) {
      const values = result.samples.map((sample) => sample[key]);
      result.allocations[key] = { min: Math.min(...values), max: Math.max(...values) };
    }
    report.cases.push(result);
    assert.deepEqual(errors, []);
    assert.deepEqual(result.errors, []);
    await page.evaluate(async () => {
      const backend = greywake.app.view.renderer.backend;
      if (backend.device) await backend.device.queue.onSubmittedWorkDone();
      else backend.gl.finish();
    });
    await page.screenshot({ path: `artifacts/render-audit/${name}.png`, timeout: 120000 });
    console.log(JSON.stringify({ name, summary: result.summary, allocations: result.allocations }));
    await page.close();
  }
  report.passed = true;
} finally {
  await writeFile(
    `artifacts/render-audit/${process.env.AUDIT_REPORT || 'profile'}.json`,
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
