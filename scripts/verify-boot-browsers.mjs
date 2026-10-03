import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { firefox, webkit } from 'playwright';

await mkdir('artifacts/boot', { recursive: true });
const html = await readFile('dist/greywake.html');
const server = createServer((_, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end(html);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const report = [];
try {
  for (const [name, type] of [
    ['Firefox', firefox],
    ['WebKit', webkit],
  ]) {
    const browser = await type.launch({
      headless: true,
      executablePath: name === 'WebKit' ? process.env.WEBKIT_EXECUTABLE_PATH : undefined,
      env: process.env,
    });
    try {
      const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
      await page.addInitScript(() =>
        localStorage.setItem(
          'greywake.career.v1',
          JSON.stringify({
            config: {
              graphics: {
                pixelRatio: 0.5,
                shadows: false,
                spectrumResolution: 32,
                interactionResolution: 128,
                waterRefraction: false,
                oceanSegments: 96,
              },
            },
          }),
        ),
      );
      await page.goto(`http://127.0.0.1:${server.address().port}/?renderer=webgl`);
      await page.waitForFunction(
        () => window.gameBoot?.report.status === 'ready' || window.gameBoot?.report.status === 'failed',
        null,
        { timeout: 120000 },
      );
      const boot = await page.evaluate(() => gameBoot.snapshot());
      assert.ok(boot.platform.userAgent);
      if (boot.status === 'ready') {
        assert.equal(boot.renderer, 'WebGL 2');
        assert.equal(await page.evaluate(() => greywake.ready), true);
        assert.equal(await page.locator('#launch').isVisible(), true);
      } else {
        // These Linux software drivers may lack graphics; diagnosis must still work.
        assert.ok(
          ['GPU-NONE', 'GPU-HDR', 'GPU-LIMIT'].includes(boot.failureCode),
          JSON.stringify(boot.errors),
        );
        assert.equal(await page.locator('#boot-error').isVisible(), true);
        assert.equal(await page.locator('#game-root').isVisible(), false);
      }
      await page.screenshot({ path: `artifacts/boot/${name.toLowerCase()}.png`, timeout: 120000 });
      report.push({ browser: name, boot });
      console.log(`PASS ${name}: ${boot.status} ${boot.failureCode || boot.renderer}`);
    } finally {
      await browser.close();
    }
  }
} finally {
  await writeFile('artifacts/boot/other-browsers.json', JSON.stringify(report, null, 2));
  await new Promise((resolve) => server.close(resolve));
}
