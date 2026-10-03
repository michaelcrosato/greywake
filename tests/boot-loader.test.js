import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transform } from 'esbuild';
import { BOOT_STAGES, BootLoader } from '../src/boot-loader.js';

const create = (onChange) =>
  new BootLoader({ name: 'Example game', version: '2.0', buildId: 'abc123', onChange });
test('The reusable boot contract gates completion and runs stages in a fixed order', async () => {
  const snapshots = [],
    boot = create((report) => snapshots.push(report));
  for (const [code] of BOOT_STAGES) await boot.stage(code, () => {});
  boot.complete();
  assert.equal(boot.report.game, 'Example game');
  assert.equal(boot.report.status, 'ready');
  assert.equal(boot.report.percent, 100);
  assert.deepEqual(
    boot.report.stages.map((stage) => stage.code),
    BOOT_STAGES.map(([code]) => code),
  );
  assert.ok(snapshots.every((report, i) => !i || report.percent >= snapshots[i - 1].percent));
  const incomplete = create();
  assert.throws(() => incomplete.complete(), /Required startup stages/);
  assert.equal(incomplete.report.failureCode, 'BOOT-INCOMPLETE');
  await assert.rejects(
    create().stage('WORLD', () => {}),
    /Expected SYS/,
  );
});
test('A timed-out stage stays failed even after the operation completes; no later system may start', async () => {
  const boot = create();
  let release,
    ranNext = false;
  await assert.rejects(
    boot.stage(
      'SYS',
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
      20,
    ),
    /did not finish/,
  );
  release();
  await new Promise((resolve) => setTimeout(resolve, 5));
  await assert.rejects(
    boot.stage('WASM', () => {
      ranNext = true;
    }),
    /already stopped/,
  );
  assert.equal(ranNext, false);
  assert.equal(boot.report.failureCode, 'SYS-TIME');
  assert.equal(boot.report.stages[0].status, 'failed');
  assert.equal(boot.report.percent, 0);
});
test('Reports retain nonfatal fallback attempts and the first fatal error with its actual stage', async () => {
  const boot = create();
  await boot.stage('SYS', () => boot.note('SYS-STORAGE', new Error('storage denied')));
  await assert.rejects(
    boot.stage('WASM', () => {
      throw new Error('wasm blocked');
    }),
    /wasm blocked/,
  );
  boot.fail('ANOTHER-ERROR', new Error('late rejection'));
  assert.deepEqual(
    boot.report.errors.map(({ code, stage, fatal }) => ({ code, stage, fatal })),
    [
      { code: 'SYS-STORAGE', stage: 'SYS', fatal: false },
      { code: 'WASM-FAIL', stage: 'WASM', fatal: true },
      { code: 'ANOTHER-ERROR', stage: 'WASM', fatal: true },
    ],
  );
  assert.match(boot.report.errors[1].stack, /wasm blocked/);
  const snapshot = boot.snapshot();
  snapshot.errors.length = 0;
  assert.equal(boot.report.errors.length, 3);
  assert.equal(boot.report.failureCode, 'WASM-FAIL');
});
test('The independent startup sentinel stays compatible with ES5 compilation', async () => {
  const source = await readFile('src/boot-sentinel.js', 'utf8');
  const result = await transform(source, { target: 'es5' });
  assert.ok(result.code.includes('SCRIPT-TIME'));
  assert.ok(!result.code.includes('=>'));
});
