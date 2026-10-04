import { AILab } from './ai-lab.js';
import { Sound } from './audio.js';
import { defaults, PRESETS, validateConfig } from './config.js';
import { Orientation } from './guide.js';
import { View } from './render.js';
import { initPhysics, newCareer, restoreCareer, Simulation } from './simulation.js';
import { UI } from './ui.js';
import { clamp } from './world.js';

const SAVE_KEY = 'greywake.career.v1';
let status;

const app = {
  started: false,
  sim: null,
  view: null,
  ui: null,
  sound: null,
  saveElapsed: 0,
  recovering: false,
  recoverRenderer() {
    if (this.recovering || new URLSearchParams(location.search).get('renderer') === 'webgl') return;
    this.recovering = true;
    this.save();
    this.ui?.toast('Graphics device interrupted. Recovering with WebGL…');
    const url = new URL(location.href);
    url.searchParams.set('renderer', 'webgl');
    url.searchParams.set('resume', this.started ? '1' : '0');
    setTimeout(() => location.replace(url), 300);
  },
  begin({ guided = true } = {}) {
    this.started = true;
    document.getElementById('launch').hidden = true;
    document.getElementById('hud').hidden = false;
    this.sound.start();
    this.sim.paused = false;
    this.ui.close();
    this.save();
    document.getElementById('sea').focus();
    if (guided && this.tutorial?.shouldOffer) this.ui.open('orientation');
  },
  save() {
    if (!this.sim) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.careerSnapshot()));
    } catch {
      if (!this.storageWarning) {
        this.storageWarning = true;
        this.ui?.toast('Autosave unavailable in this browser. Export your career from the log.');
      }
    }
  },
  careerSnapshot() {
    return (this.aiLab?.careerSim || this.tutorial?.careerSim || this.sim).snapshot();
  },
  attachSimulation(sim, { render = true } = {}) {
    this.sim = sim;
    const config = sim.config;
    this.view.sim = this.sim;
    this.view.config = config;
    this.view.ocean.config = config;
    this.ui.sim = this.sim;
    if (render) {
      this.view.trails.clear();
      for (const model of this.view.shipModels.values()) {
        this.view.scene.remove(model);
        for (const material of model.userData.waterMaterials || []) material.dispose();
      }
      this.view.shipModels.clear();
      this.view.particles = [];
      this.view.terrainKey = '';
      this.view.applySettings(true);
    }
    this.ui.pauseBefore = false;
  },
  replace(career, config, encounter) {
    if (this.aiLab?.active) this.aiLab.stop();
    if (this.tutorial?.active) this.tutorial.stop(false);
    this.sim.dispose();
    this.attachSimulation(new Simulation(config, career, { encounter }));
  },
  reset() {
    this.replace(newCareer(), this.sim.config);
    this.save();
  },
  loadCareer(value) {
    this.replace(restoreCareer(value.career), validateConfig(value.config), value.encounter);
    this.sim.paused = !!this.ui.panel && !['settings', 'developer'].includes(this.ui.panel);
  },
};
window.greywake = { state: () => app.sim?.state(), config: () => app.sim?.config, app };
window.addEventListener('greywake:gpu-lost', (event) => {
  if (window.greywake.ready) app.recoverRenderer();
  else
    window.gameBoot?.fail(
      'RENDER-LOST',
      new Error(event.detail?.message || 'Graphics device lost during startup.'),
    );
});

export async function startGame(boot) {
  status = document.getElementById('loading-status');
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
  } catch (error) {
    boot.note('SAVE-UNAVAILABLE', new Error(`Using a fresh career: ${error.message}`));
  }
  const config = saved ? validateConfig(saved.config) : defaults();
  if (!saved && matchMedia('(pointer: coarse)').matches) Object.assign(config.graphics, PRESETS.mobile);
  await boot.stage('PHY', initPhysics);
  await boot.stage('WORLD', () => {
    app.sim = new Simulation(config, saved ? restoreCareer(saved.career) : newCareer(), {
      encounter: saved?.encounter,
    });
    app.view = new View(document.getElementById('sea'), app.sim);
  });
  await app.view.init(boot);
  await boot.stage('FRAME', async () => {
    const backend = app.view.renderer.backend;
    if (backend.device) backend.device.pushErrorScope('validation');
    let scopeOpen = !!backend.device;
    try {
      app.view.render(0.1, true, 0.1);
      if (backend.device) {
        await backend.device.queue.onSubmittedWorkDone();
        scopeOpen = false;
        const error = await backend.device.popErrorScope();
        if (error) throw new Error(error.message);
      } else {
        backend.gl.finish();
        const error = backend.gl.getError();
        if (error) throw new Error(`WebGL first-frame error: 0x${error.toString(16)}`);
      }
    } finally {
      if (scopeOpen) await backend.device.popErrorScope();
    }
  });
  await boot.stage('UI', () => {
    app.sound = new Sound();
    app.ui = new UI(app);
    app.tutorial = new Orientation(app);
    app.aiLab = new AILab(app);
    bindInputs();
  });
  status.textContent = 'Drag to look around · headphones recommended';
  document.getElementById('renderer-badge').textContent =
    `${app.view.backend.toUpperCase()} · THREE.JS r186 · RAPIER 0.19.3`;
  const begin = document.getElementById('begin');
  begin.textContent = saved ? 'Resume patrol →' : 'Begin patrol →';
  begin.disabled = false;
  document.getElementById('launch-orientation').disabled = false;
  let diagnosticsPause = null;
  window.addEventListener('game:boot-visible', (event) => {
    if (!app.started) return;
    if (event.detail && diagnosticsPause === null) {
      diagnosticsPause = app.sim.paused;
      app.sim.paused = true;
    } else if (!event.detail && diagnosticsPause !== null) {
      app.sim.paused = diagnosticsPause;
      diagnosticsPause = null;
    }
  });
  let last = performance.now();
  function frame(now) {
    if (app.recovering || boot.report.status === 'failed') return;
    const wallDt = Math.max(0, (now - last) / 1000);
    const dt = Math.min(0.1, wallDt);
    last = now;
    if (!document.getElementById('boot-root').hidden) {
      requestAnimationFrame(frame);
      return;
    }
    try {
      if (app.started) {
        if (app.aiLab.active) app.aiLab.tick(Math.min(0.1, wallDt));
        else app.sim.update(dt);
        app.saveElapsed += dt;
        if (app.saveElapsed > 10) {
          app.save();
          app.saveElapsed = 0;
        }
      } else app.sim.visualTime += dt;
      if (!app.aiLab.active) {
        app.view.render(dt, !app.started, wallDt);
        app.ui.update(dt);
        app.tutorial.tick(wallDt);
      }
      app.sound.update(app.sim);
    } catch (error) {
      window.__consoleErrors.push(error.stack);
      boot.fail('RUN-FAIL', error);
      status.textContent = `Renderer error: ${error.message}`;
      app.ui.toast(`Rendering stopped: ${error.message}`);
      console.error(error);
      return;
    }
    requestAnimationFrame(frame);
  }
  return () => {
    window.greywake.ready = true;
    requestAnimationFrame(frame);
    if (new URLSearchParams(location.search).get('resume') === '1') app.begin();
  };
}

function bindInputs() {
  const keys = new Set(),
    canvas = document.getElementById('sea');
  let drag = null;
  app.clearInputs = () => {
    keys.clear();
    app.sim.rudder = 0;
    drag = null;
  };
  window.addEventListener('resize', () => {
    app.view.resize();
    if (app.ui.panel === 'chart') app.ui.drawChart();
  });
  window.addEventListener('blur', () => {
    if (app.aiLab?.active) {
      app.aiLab.playing = false;
      document.getElementById('ai-play').textContent = 'Play';
      app.save();
      return;
    }
    keys.clear();
    app.sim.rudder = 0;
    app.save();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (app.aiLab?.active) {
        app.aiLab.playing = false;
        document.getElementById('ai-play').textContent = 'Play';
        app.save();
        return;
      }
      app.save();
      keys.clear();
      app.sim.rudder = 0;
      app.sim.paused = true;
    } else if (app.started && !app.ui.panel) app.ui.toast('Patrol paused while away. Press P to resume.');
  });
  window.addEventListener('pagehide', () => app.save());
  document.addEventListener('keydown', (e) => {
    if (app.aiLab?.active) {
      if (e.key === 'Tab') {
        const controls = [
            ...document.querySelectorAll('#ai-lab button,#ai-lab input,#ai-lab select,#ai-lab summary'),
          ].filter((el) => el.offsetParent !== null && !el.disabled),
          first = controls[0],
          last = controls.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
      if (e.key === 'Escape') app.aiLab.stop();
      else if (e.code === 'Space' && !e.target.closest('input,select,button,summary,a')) {
        e.preventDefault();
        document.getElementById('ai-play').click();
      }
      return;
    }
    if (e.key === 'F2' && !e.repeat) {
      e.preventDefault();
      if (app.ui.panel === 'developer') app.ui.close();
      else app.ui.open('developer');
      return;
    }
    if (e.key === 'Escape') {
      if (app.ui.panel) app.ui.close();
      else if (app.started) app.ui.pause();
      return;
    }
    if (app.ui.panel) {
      if (e.key === 'Tab') {
        const controls = [
          ...document.querySelectorAll(
            '#modal button:not(:disabled), #modal input, #modal select, #modal summary, #guide:not([hidden]) button:not(:disabled):not([hidden])',
          ),
        ].filter((el) => el.offsetParent !== null);
        const first = controls[0],
          last = controls.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
      return;
    }
    const editing =
      ['SELECT', 'TEXTAREA'].includes(e.target.tagName) ||
      (e.target.tagName === 'INPUT' &&
        (e.target.type !== 'range' || e.key.startsWith('Arrow') || ['Home', 'End', ' '].includes(e.key)));
    if (!app.started || e.ctrlKey || e.metaKey || editing) return;
    // Space activates a focused button natively; it must not also fire a torpedo.
    if ((e.key === ' ' || e.key === 'Enter') && e.target.closest('button, a, summary')) return;
    const k = e.key.toLowerCase();
    if ([' ', 'tab', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    keys.add(k);
    if (e.repeat) return;
    const sim = app.sim;
    if (k === 'a' || k === 'arrowleft' || k === 'd' || k === 'arrowright') {
      sim.p.auto = false;
      sim.rudder =
        (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
    }
    const actions = {
      w: () => app.ui.throttle(0.1),
      arrowup: () => app.ui.throttle(0.1),
      s: () => app.ui.throttle(-0.1),
      arrowdown: () => app.ui.throttle(-0.1),
      ' ': () => sim.fireTorpedo(),
      f: () => sim.fireGun(),
      q: () => sim.sonarPing(),
      g: () => app.ui.focusTarget(),
      r: () => sim.dive(0),
      v: () => sim.dive(12),
      x: () => sim.dive(80),
      c: () => app.ui.camera(),
      m: () => app.ui.open('chart'),
      k: () => app.ui.open('captain'),
      t: () => app.ui.time(),
      p: () => app.ui.pause(),
      h: () => app.ui.open('manual'),
      '?': () => app.ui.open('manual'),
      tab: () => sim.nextTarget(),
    };
    actions[k]?.();
  });
  document.addEventListener('keyup', (e) => {
    keys.delete(e.key.toLowerCase());
    app.sim.rudder =
      (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
  });
  canvas.addEventListener('pointerdown', (e) => {
    canvas.focus();
    drag = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    app.view.orbit -= (e.clientX - drag.x) * 0.004;
    app.view.elevation = clamp(app.view.elevation + (e.clientY - drag.y) * 0.08, -15, 55);
    drag = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointerup', () => {
    drag = null;
  });
  canvas.addEventListener('pointercancel', () => {
    drag = null;
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      app.sim.config.graphics.cameraDistance = clamp(
        app.sim.config.graphics.cameraDistance + e.deltaY * 0.1,
        55,
        300,
      );
    },
    { passive: false },
  );
}
