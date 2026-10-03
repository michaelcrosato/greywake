import { BootError, BootLoader } from './boot-loader.js';
import { checkPlatform, checkWasm, selectGraphics } from './boot-platform.js';

const $ = (id) => document.getElementById(id);
const meta = (name) => document.querySelector(`meta[name="${name}"]`)?.content || 'Unknown';
const boot = new BootLoader({
  name: meta('game-name'),
  version: meta('game-version'),
  buildId: meta('game-build'),
  onChange(report) {
    $('boot-brand').textContent = `${report.game} / STARTUP`;
    $('boot-version').textContent = report.version;
    $('boot-build').textContent = report.buildId;
    $('boot-platform').textContent = report.platform.userAgent || 'Detecting…';
    $('boot-renderer').textContent = report.renderer;
    $('boot-adapter').textContent = report.adapter.description;
    $('boot-status').textContent =
      `${report.stage} / ${report.status === 'failed' ? 'Stopped' : report.status === 'ready' ? 'Ready' : 'Starting'} / ${report.percent}%`;
    $('boot-progress').value = report.percent;
    const stages = $('boot-stages');
    while (stages.firstChild) stages.removeChild(stages.firstChild);
    report.stages.forEach((stage) => {
      const line = document.createElement('li');
      line.textContent = `${`${stage.code}       `.slice(0, 7)} ${`${stage.status.toUpperCase()}        `.slice(0, 8)} ${stage.label}`;
      stages.append(line);
    });
    $('boot-report').value = JSON.stringify(report, null, 2);
    const fatal = report.errors.find((error) => error.fatal);
    $('boot-error').hidden = !fatal;
    $('boot-error').textContent = fatal
      ? `${fatal.code}: ${fatal.message.slice(0, 320)}${fatal.message.length > 320 ? '… (full details in report)' : ''}`
      : '';
    $('boot-notes').textContent = report.errors
      .filter((error) => !error.fatal)
      .map((error) => `${error.code}: ${error.message}`)
      .join('\n');
    $('boot-download').hidden = !window.Blob || !window.URL?.createObjectURL;
    $('boot-actions').hidden = report.status === 'starting';
    $('boot-return').hidden = report.status !== 'ready';
    $('boot-webgl').hidden =
      report.status !== 'failed' ||
      !['GPU', 'RENDER', 'SKY', 'SHDR', 'FRAME', 'RUN'].includes(report.stage) ||
      new URLSearchParams(location.search).get('renderer') === 'webgl';
    if (fatal) {
      $('boot-root').hidden = false;
      $('game-root').hidden = true;
      if (!window.__consoleErrors.includes(`${fatal.code}: ${fatal.message}`))
        window.__consoleErrors.push(`${fatal.code}: ${fatal.message}`);
    }
  },
});
window.gameBoot = boot;
window.__bootSentinel.adopt();
boot.open = () => {
  $('boot-root').hidden = false;
  window.dispatchEvent(new CustomEvent('game:boot-visible', { detail: true }));
};
boot.close = () => {
  if (boot.report.status !== 'ready') return;
  $('boot-root').hidden = true;
  $('game-root').hidden = false;
  window.dispatchEvent(new CustomEvent('game:boot-visible', { detail: false }));
};
$('boot-return').onclick = boot.close;
$('boot-webgl').onclick = () => {
  const url = new URL(location.href);
  url.searchParams.set('renderer', 'webgl');
  location.replace(url);
};
$('boot-copy').onclick = () => {
  $('boot-report').hidden = false;
  const manual = () => {
    $('boot-report').select();
    $('boot-feedback').textContent = 'Select and copy the report below.';
  };
  if (!window.Promise || !navigator.clipboard?.writeText) return manual();
  navigator.clipboard.writeText($('boot-report').value).then(() => {
    $('boot-feedback').textContent = 'Report copied.';
  }, manual);
};
$('boot-download').onclick = () => {
  const url = URL.createObjectURL(new Blob([$('boot-report').value], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${boot.report.game.toLowerCase().replace(/[^a-z0-9-]/g, '-')}-boot-${boot.report.buildId}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

async function loadGame() {
  const style = $('game-style').content.cloneNode(true);
  const link = style.querySelector('link');
  const loaded = link
    ? new Promise((resolve, reject) => {
        link.onload = resolve;
        link.onerror = () => reject(new BootError('LOAD-CSS', 'Game stylesheet could not be loaded.'));
      })
    : Promise.resolve();
  document.head.append(style);
  await loaded;
  boot.assertActive();
  const payload = $('game-bundle');
  let runtime;
  if (payload) {
    // The standalone payload is inert text: no game code executes before checks.
    const binary = atob(payload.textContent.trim());
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const script = document.createElement('script');
    script.id = 'game-runtime';
    script.textContent = new TextDecoder().decode(bytes);
    document.body.append(script);
    boot.assertActive();
    runtime = window.GameRuntime;
  } else {
    // Vite serves the runtime separately only after the capability gates pass.
    runtime = await import('./main.js');
  }
  boot.assertActive();
  if (typeof runtime?.startGame !== 'function')
    throw new BootError('LOAD-RUNTIME', 'Game entry point is missing.');
  $('game-root').append($('game-ui').content.cloneNode(true));
  return runtime;
}

async function start() {
  try {
    await boot.stage('SYS', () => checkPlatform(window, boot));
    await boot.stage('WASM', () => checkWasm(window));
    await boot.stage('GPU', () =>
      selectGraphics(window, boot, new URLSearchParams(location.search).get('renderer') === 'webgl'),
    );
    const runtime = await boot.stage('LOAD', loadGame);
    const launch = await runtime.startGame(boot);
    boot.complete();
    launch();
    boot.close();
  } catch (error) {
    boot.fail(error.code || `${boot.report.stage}-FAIL`, error);
  }
}
if (window.__bootSentinel.failure) {
  boot.report.stage = 'SYS';
  boot.update({ platform: { userAgent: navigator.userAgent } });
  boot.fail(window.__bootSentinel.failure.code, new Error(window.__bootSentinel.failure.message));
} else start();
