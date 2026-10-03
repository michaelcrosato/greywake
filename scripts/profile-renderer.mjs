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
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--use-angle=vulkan',
    '--use-vulkan=swiftshader',
    '--use-webgpu-adapter=swiftshader',
    '--disable-vulkan-surface',
  ],
});
const cases = (process.env.AUDIT_CASES || 'original,persistent-fog').split(',');
const report = {
  source,
  adapter: 'SwiftShader software adapter; compare relative costs, not hardware FPS',
  cases: [],
};
try {
  for (const name of cases) {
    const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
    page.on('console', (m) => {
      if (m.text().startsWith('AUDIT ')) console.log(m.text());
    });
    page.on('pageerror', (e) => console.log('ERROR', e.message));
    await page.addInitScript(
      ({ name }) => {
        const original = window.requestAnimationFrame.bind(window);
        const samples = [];
        let last = 0,
          installed = false,
          builds = 0,
          pipelines = 0;
        window.requestAnimationFrame = (callback) => {
          return original((now) => {
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
              const render = v.render.bind(v);
              v.render = (...args) => {
                if (samples.length >= 24) return;
                const start = performance.now();
                render(...args);
                const water = [...v.renderer._nodes.nodeBuilderCache.values()].map(
                  (s) => s.vertexShader.length + s.fragmentShader.length,
                );
                const sample = {
                  frame: samples.length,
                  wallMs: last ? start - last : 0,
                  cpuMs: performance.now() - start,
                  builders: builds,
                  pipelines,
                  nodeStates: v.renderer._nodes.nodeBuilderCache.size,
                  shaderBytes: Math.max(...water),
                  attributes: v.renderer.info.memory.attributes,
                  drawCalls: v.renderer.info.render.drawCalls,
                  triangles: v.renderer.info.render.triangles,
                  memory: v.renderer.info.memory.total,
                };
                samples.push(sample);
                last = start;
                console.log(`AUDIT ${name} ${JSON.stringify(sample)}`);
                if (samples.length === 24)
                  window.renderProfile = {
                    name,
                    samples,
                    backend: v.backend,
                    reportedFps: v.fps,
                    errors: window.__consoleErrors,
                  };
              };
            }
            callback(now);
          });
        };
      },
      { name },
    );
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.renderProfile, null, { timeout: 180000 });
    const result = await page.evaluate(() => window.renderProfile);
    report.cases.push(result);
    await page.screenshot({ path: `artifacts/render-audit/${name}.png` });
    await page.close();
  }
} finally {
  await writeFile(
    `artifacts/render-audit/${process.env.AUDIT_REPORT || 'profile'}.json`,
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
