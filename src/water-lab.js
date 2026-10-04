import { PRESETS, SEA_STATES, SETTINGS } from './config.js';
import { escapeSetting as esc, settingControl, settingText, settingValue } from './setting-controls.js';
import { Simulation } from './simulation.js';
import { applyWaterLook, WATER_LOOKS } from './water-presets.js';
import {
  applyWaterTuning,
  createWaterScene,
  initialWaterBoat,
  initialWaterConditions,
  scriptWaterScene,
  validateWaterRecipe,
  WATER_CAMERAS,
  WATER_LIGHTING,
  WATER_SCENARIOS,
  WATER_STEP,
  waterController,
  waterTuning,
} from './water-scenarios.js';
import { WATER_METADATA, WATER_PATHS, WATER_SECTIONS } from './water-settings.js';
import { DEG, deltaX, random } from './world.js';

const $ = (id) => document.getElementById(id);
export class WaterLab {
  constructor(app) {
    this.app = app;
    this.active = false;
    this.careerSim = null;
    this.generation = 0;
    this.pending = new Map();
    this.section = 'Waves';
    this.query = '';
    this.advanced = false;
    this.changedOnly = false;
    this.comparisons = {};
  }
  get sim() {
    return this.app.sim;
  }
  start() {
    if (this.active) return;
    if (this.app.aiLab?.active) this.app.aiLab.stop();
    if (this.app.tutorial?.active) this.app.tutorial.stop(false);
    this.app.ui.close();
    this.parked = {
      started: this.app.started,
      previewTime: this.app.previewTime || 0,
      paused: this.sim.paused,
      rudder: this.sim.rudder,
      launch: $('launch').hidden,
      hud: $('hud').hidden,
      loss: $('loss').hidden,
      focus: document.activeElement,
      inputs: this.app.captureInputs?.(),
      camera: { mode: this.app.view.mode, orbit: this.app.view.orbit, elevation: this.app.view.elevation },
      position: this.app.view.camera.position.clone(),
      rotation: this.app.view.camera.quaternion.clone(),
    };
    this.app.clearInputs();
    this.app.save();
    this.careerSim = this.sim;
    const snapshot = this.careerSim.snapshot();
    this.initial = initialWaterBoat(this.careerSim.p);
    this.careerSim.paused = true;
    this.active = true;
    this.app.started = true;
    this.playing = false;
    this.elapsed = this.accumulator = 0;
    this.actions = [];
    this.scenario = 'patrol';
    this.lighting = 'patrol';
    this.bookmark = 'chase';
    this.fixed = false;
    this.seed = this.initialSeed = this.careerSim.config.waterWaves.seed;
    const experiment = new Simulation(
      structuredClone(this.careerSim.config),
      structuredClone(snapshot.career),
      { encounter: snapshot.encounter, ambientTraffic: false, invulnerable: true },
    );
    experiment.labController = { ...waterController(this.careerSim) };
    experiment.acceleration = 1;
    experiment.localAccumulator = 0;
    experiment.setDeveloper({
      enabled: true,
      invulnerable: true,
      infiniteResources: true,
      pauseTraffic: true,
      freezeEnemies: true,
      noClip: !!this.careerSim.dev('noClip'),
    });
    for (const torpedo of experiment.torpedoes) experiment.physics.removeRigidBody(torpedo.body);
    experiment.torpedoes = [];
    experiment.charges = [];
    experiment.effects = [];
    experiment.paused = true;
    experiment.p.auto = false;
    experiment.p.route = [];
    experiment.p.destination = null;
    this.initial = initialWaterConditions(experiment);
    this.baseTuning = waterTuning(experiment.config);
    this.lastRecorded = structuredClone(this.baseTuning);
    this.timeOrigin = experiment.p.time;
    this.app.attachSimulation(experiment);
    this.app.view.rng = random(this.seed);
    $('launch').hidden = $('hud').hidden = $('loss').hidden = true;
    $('water-lab').hidden = false;
    document.body.classList.add('water-lab-active');
    this.layout();
    this.drawControls();
    $('water-collapse').focus();
  }
  layout() {
    $('water-lab').innerHTML =
      `<header class="water-lab-header"><div><p class="eyebrow">DEVELOPER / ISOLATED SEA</p><h2>Water Lab <small>· experiment</small></h2></div><button id="water-collapse" aria-expanded="true" aria-label="Collapse Water Lab">⌄</button></header>
      <div class="water-toolbar"><button id="water-play">Play</button><button data-water-step="${WATER_STEP}">Frame</button><button data-water-step="1">1 s</button><button data-water-step="10">10 s</button><button id="water-reset">Reset scene</button><span id="water-time">0.00 s</span></div>
      <div class="water-lab-body"><div class="water-scene-controls"><label>Scene<select id="water-scene">${WATER_SCENARIOS.map(([id, name]) => `<option value="${id}">${name}</option>`).join('')}</select></label><label>Camera<select id="water-camera">${WATER_CAMERAS.map((name) => `<option>${name}</option>`).join('')}</select></label><label><input type="checkbox" id="water-fixed" /> Fixed camera</label><label><input type="checkbox" id="water-freeze" /> Freeze wave phase</label><label>Lighting<select id="water-lighting">${WATER_LIGHTING.map((name) => `<option>${name}</option>`).join('')}</select></label><button id="water-refresh">Refresh sky reflection</button></div>
      <div class="water-compare">${['A', 'B'].map((slot) => `<button data-water-store="${slot}">Store ${slot}</button><button data-water-view="${slot}" disabled>View ${slot}</button>`).join('')}<p class="settings-help">Appearance uses a held camera, phase and boat pose. Rerun the scene to compare wake or hull behavior.</p></div>
      <label>Search water controls<input id="water-search" type="search" placeholder="Foam, ripple, absorption…" /></label><div class="water-filters"><label><input id="water-changed" type="checkbox" /> Changed only</label><label><input id="water-advanced" type="checkbox" /> Advanced</label></div>
      <nav class="water-tabs" aria-label="Water settings sections">${[...WATER_SECTIONS, 'Inspect'].map((section) => `<button data-water-section="${section}">${section}</button>`).join('')}</nav><div id="water-controls"></div>
      <div class="water-presets">${Object.entries(WATER_LOOKS)
        .map(([key, preset]) => `<button data-water-preset="${key}">${preset.name}</button>`)
        .join('')}${Object.keys(PRESETS)
        .map((key) => `<button data-water-quality="${key}">${key}</button>`)
        .join('')}</div>
      <div class="water-files"><button id="water-export">Export recipe</button><button id="water-import">Import recipe</button><button id="water-apply">Apply water tuning to patrol</button><button id="water-exit">Return to patrol</button></div><p id="water-feedback" role="status" aria-live="polite">Your patrol is parked. Directions travel toward: 0° north (−Z), 90° east (+X).</p></div>`;
    const quick = document.createElement('div');
    quick.className = 'water-quickbar';
    quick.append($('water-camera').closest('label'));
    const look = document.createElement('select');
    look.id = 'water-look';
    look.setAttribute('aria-label', 'Water look preset');
    look.innerHTML =
      '<option value="">Look preset…</option>' +
      Object.entries(WATER_LOOKS)
        .map(([key, preset]) => `<option value="${key}">${preset.name}</option>`)
        .join('');
    quick.append(look);
    document.querySelector('.water-toolbar').after(quick);
    const compare = document.querySelector('.water-compare');
    compare.querySelector('p').remove();
    quick.append(compare);
    look.onchange = () => {
      if (look.value) document.querySelector(`[data-water-preset="${look.value}"]`).click();
      look.value = '';
    };
    $('water-exit').onclick = () => this.stop();
    $('water-collapse').onclick = () => {
      const collapsed = $('water-lab').classList.toggle('collapsed');
      $('water-collapse').setAttribute('aria-expanded', String(!collapsed));
    };
    $('water-play').onclick = () => {
      if (this.advancing) {
        this.pause();
        this.feedback('Advance paused at the current simulation frame.');
        return;
      }
      this.playing = !this.playing;
      this.accumulator = 0;
      $('water-play').textContent = this.playing ? 'Pause' : 'Play';
    };
    for (const button of document.querySelectorAll('[data-water-step]'))
      button.onclick = () => this.step(Number(button.dataset.waterStep));
    $('water-reset').onclick = () => this.reset();
    $('water-scene').onchange = () => {
      this.scenario = $('water-scene').value;
      this.reset(true);
    };
    $('water-camera').onchange = () => {
      this.app.view.comparisonCamera = null;
      this.bookmark = $('water-camera').value;
      this.setCamera();
    };
    $('water-fixed').onchange = () => {
      this.fixed = $('water-fixed').checked;
      this.setCamera();
    };
    $('water-freeze').onchange = () => {
      this.sim.water.freezePhase = $('water-freeze').checked;
      this.actions.push({ type: 'freeze', time: this.elapsed, value: this.sim.water.freezePhase });
    };
    $('water-lighting').onchange = () => {
      this.lighting = $('water-lighting').value;
      this.applyLighting();
      this.recordTuning();
    };
    $('water-refresh').onclick = () => {
      this.app.view.refreshEnvironment(true);
      this.feedback('Sky reflection refreshed.');
    };
    for (const [id, property] of [
      ['water-search', 'query'],
      ['water-changed', 'changedOnly'],
      ['water-advanced', 'advanced'],
    ])
      $(id).oninput = () => {
        this[property] = $(id).type === 'checkbox' ? $(id).checked : $(id).value;
        this.drawControls();
      };
    for (const button of document.querySelectorAll('[data-water-section]'))
      button.onclick = () => {
        this.section = button.dataset.waterSection;
        this.drawControls();
      };
    for (const button of document.querySelectorAll('[data-water-preset]'))
      button.onclick = () => {
        this.commit();
        const key = button.dataset.waterPreset;
        applyWaterLook(this.sim.config, key);
        this.sim.refreshWeather();
        this.app.view.refreshEnvironment(true);
        this.recordTuning();
        this.drawControls();
      };
    for (const button of document.querySelectorAll('[data-water-quality]'))
      button.onclick = () => {
        this.commit();
        Object.assign(this.sim.config.graphics, PRESETS[button.dataset.waterQuality]);
        this.app.view.applySettings(true);
        this.recordTuning();
        this.drawControls();
      };
    for (const button of document.querySelectorAll('[data-water-store]'))
      button.onclick = () => {
        this.commit();
        const slot = button.dataset.waterStore;
        this.comparisons[slot] = waterTuning(this.sim.config);
        document.querySelector(`[data-water-view="${slot}"]`).disabled = false;
        this.feedback(`Stored ${slot}. View compares appearance at the held scene state.`);
      };
    for (const button of document.querySelectorAll('[data-water-view]'))
      button.onclick = () => {
        this.pause();
        this.commit();
        this.app.view.comparisonCamera ||= {
          position: this.app.view.camera.position.clone(),
          rotation: this.app.view.camera.quaternion.clone(),
        };
        this.comparisonSeed ??= this.sim.config.waterWaves.seed;
        applyWaterTuning(this.sim.config, this.comparisons[button.dataset.waterView]);
        this.sim.config.waterWaves.seed = this.comparisonSeed;
        this.sim.water.ensure();
        this.sim.water.transition = null;
        this.sim.water.prepared = '';
        this.sim.water.ensure();
        this.app.view.applySettings(true);
        this.app.view.refreshEnvironment(true);
        this.recordTuning();
        this.drawControls();
      };
    $('water-apply').onclick = () => {
      this.commit();
      applyWaterTuning(this.careerSim.config, waterTuning(this.sim.config));
      this.app.save();
      this.feedback('Water, lighting and quality tuning applied to the parked patrol.');
    };
    $('water-export').onclick = () => {
      this.commit();
      try {
        const recipe = validateWaterRecipe(this.recipe());
        this.app.ui.download(`greywake-water-${this.scenario}-${this.seed}.json`, JSON.stringify(recipe));
      } catch (error) {
        this.feedback(`Export failed: ${error.message}`);
      }
    };
    $('water-import').onclick = () => this.importFile();
  }
  feedback(text) {
    if ($('water-feedback')) $('water-feedback').textContent = text;
  }
  pause() {
    if (this.advancing) this.generation++;
    this.advancing = this.playing = false;
    this.accumulator = 0;
    if ($('water-play')) $('water-play').textContent = 'Play';
  }
  recordTuning() {
    const current = waterTuning(this.sim.config),
      tuning = {};
    for (const path of WATER_PATHS) {
      const [group, key] = path.split('.');
      if (current[group][key] !== this.lastRecorded[group][key])
        (tuning[group] ||= {})[key] = current[group][key];
    }
    if (Object.keys(tuning).length) {
      const last = this.actions.at(-1);
      if (last?.type === 'tune' && Math.abs(last.time - this.elapsed) < 1e-8)
        for (const [group, fields] of Object.entries(tuning))
          Object.assign((last.tuning[group] ||= {}), fields);
      else this.actions.push({ type: 'tune', time: this.elapsed, tuning });
    }
    this.lastRecorded = current;
  }

  recipe() {
    return {
      schema: 'greywake.water-lab/1',
      scenario: this.scenario,
      seed: this.initialSeed,
      tuning: this.baseTuning,
      initial: this.initial,
      lighting: this.lighting,
      camera: {
        bookmark: this.bookmark,
        fixed: this.fixed,
        orbit: this.app.view.orbit,
        elevation: this.app.view.elevation,
        position: {
          x: this.app.view.camera.position.x,
          y: this.app.view.camera.position.y,
          z: this.app.view.camera.position.z,
        },
        rotation: {
          x: this.app.view.camera.quaternion.x,
          y: this.app.view.camera.quaternion.y,
          z: this.app.view.camera.quaternion.z,
          w: this.app.view.camera.quaternion.w,
        },
        origin: { x: this.sim.p.x, z: this.sim.p.z },
        underwater: this.app.view.underwater,
      },
      duration: this.elapsed,
      actions: this.actions,
    };
  }
  drawControls() {
    const section = this.section,
      config = this.sim.config;
    for (const button of document.querySelectorAll('[data-water-section]'))
      button.classList.toggle('active', button.dataset.waterSection === section);
    if (section === 'Inspect') {
      const modes = [
        'Beauty',
        'Geometric height',
        'Final normal',
        'Compression / Jacobian',
        'Foam sources',
        'Foam coverage',
        'Local field extent',
        'Reflection',
        'Refraction',
        'Scene depth',
        'Immersion',
        'Foam age',
        'Mesh wireframe',
        'Hull probes',
      ];
      $('water-controls').innerHTML =
        `<label>Inspection view<select id="water-inspect">${modes.map((mode, i) => `<option value="${i}">${mode}</option>`).join('')}</select></label><pre id="water-telemetry"></pre>`;
      $('water-inspect').value = this.inspectMode || 0;
      $('water-inspect').onchange = () => {
        this.inspectMode = Number($('water-inspect').value);
        this.app.view.ocean.inspect.value = this.inspectMode < 12 ? this.inspectMode : 0;
        this.app.view.ocean.material.wireframe = this.inspectMode === 12;
        this.app.view.probeOverlay.visible = this.inspectMode === 13;
      };
      this.update();
      return;
    }
    const paths = WATER_PATHS.filter((path) => {
      const [group, key] = path.split('.'),
        meta = WATER_METADATA[path],
        spec = SETTINGS[group][key];
      return (
        (this.query || meta.section === section) &&
        (!meta.advanced || this.advanced) &&
        (!this.changedOnly || config[group][key] !== spec[1]) &&
        `${path} ${spec[0]} ${meta.help}`.toLowerCase().includes(this.query.toLowerCase())
      );
    });
    $('water-controls').innerHTML =
      `<div class="water-section-actions"><span>${paths.length} controls</span><button id="water-reset-section">Reset ${esc(section)}</button></div>${paths
        .map((path) => {
          const [group, key] = path.split('.'),
            spec = SETTINGS[group][key],
            meta = WATER_METADATA[path];
          return `<div class="water-setting" data-water-row="${path}"><div class="water-setting-heading"><span>${esc(spec[0])}</span><button data-water-default="${path}" aria-label="Reset ${esc(spec[0])}">↺</button></div>${settingControl(path, spec, config[group][key], 'data-water-setting', { numeric: true })}<output>${settingText(config[group][key])}</output><small>${esc(meta.help)} <span>${meta.boundary === 'scene' ? 'Scene reset on release' : meta.update === 'resource' ? 'Apply on release' : meta.update === 'spectrum' ? 'Spectrum transition' : 'Live'}</span></small></div>`;
        })
        .join('')}`;
    if (section === 'Boat response') {
      const helm = document.createElement('div');
      helm.className = 'water-helm';
      helm.innerHTML = `<h3>Experiment helm</h3><label>Power<input data-water-helm="throttle" type="range" min="0" max="1" step="0.05" value="${this.sim.p.throttle}" /></label><label>Rudder<input data-water-helm="rudder" type="range" min="-1" max="1" step="0.05" value="${this.sim.rudder}" /></label><label>Ordered depth · m<input data-water-helm="depth" type="number" min="0" max="160" value="${this.sim.p.targetDepth}" /></label><button id="water-stop-engines">Stop engines</button>`;
      $('water-controls').prepend(helm);
      const apply = (values) => {
        const action = { type: 'helm', time: this.elapsed, ...values };
        this.applyAction(action);
        this.actions.push(action);
      };
      for (const input of helm.querySelectorAll('[data-water-helm]'))
        input.onchange = () => {
          if (input.checkValidity() && input.value.trim())
            apply({ [input.dataset.waterHelm]: Number(input.value) });
        };
      $('water-stop-engines').onclick = () => apply({ throttle: 0, rudder: 0 });
    }
    for (const input of document.querySelectorAll('[data-water-setting]')) {
      const path = input.dataset.waterSetting,
        [group, key] = path.split('.'),
        meta = WATER_METADATA[path];
      const preview = () => {
        let value;
        try {
          value = settingValue(input, SETTINGS[group][key]);
        } catch {
          return;
        }
        if (meta.update === 'resource' || meta.update === 'spectrum') {
          this.pending.set(path, value);
          input
            .closest('.water-setting')
            .querySelector(
              'output',
            ).textContent = `${settingText(value)} requested · ${settingText(config[group][key])} effective`;
        } else {
          config[group][key] = value;
          this.syncRow(path, value);
          this.recordTuning();
        }
      };
      input.oninput = preview;
      input.onchange = () => {
        preview();
        this.commit();
        this.recordTuning();
        this.syncRow(path, config[group][key]);
        if (meta.section === 'Lighting') this.app.view.refreshEnvironment(true);
      };
    }
    for (const button of document.querySelectorAll('[data-water-default]'))
      button.onclick = () => {
        const path = button.dataset.waterDefault,
          [group, key] = path.split('.');
        this.pending.set(path, SETTINGS[group][key][1]);
        this.commit();
        this.recordTuning();
        this.drawControls();
      };
    $('water-reset-section').onclick = () => {
      for (const path of WATER_PATHS.filter((path) => WATER_METADATA[path].section === section)) {
        const [group, key] = path.split('.');
        this.pending.set(path, SETTINGS[group][key][1]);
      }
      this.commit();
      this.recordTuning();
      this.drawControls();
    };
  }
  syncRow(path, value) {
    const row = document.querySelector(`[data-water-row="${path}"]`);
    for (const input of row?.querySelectorAll('[data-water-setting]') || []) {
      if (input.type === 'checkbox') input.checked = value;
      else input.value = value;
    }
    if (row) row.querySelector('output').textContent = settingText(value);
    if (['ocean.weather', 'ocean.stormStrength'].includes(path)) this.sim.refreshWeather();
  }
  commit() {
    let resource = false,
      composition = false,
      lighting = false;
    for (const [path, value] of this.pending) {
      const [group, key] = path.split('.');
      this.sim.config[group][key] = value;
      if (group === 'ocean' && ['weather', 'stormStrength'].includes(key)) this.sim.refreshWeather();
      resource ||= WATER_METADATA[path].update === 'resource';
      composition ||= WATER_METADATA[path].boundary === 'scene';
      lighting ||= WATER_METADATA[path].section === 'Lighting';
    }
    this.pending.clear();
    if (resource) this.app.view.applySettings(true);
    if (lighting) this.app.view.refreshEnvironment(true);
    this.seed = this.sim.config.waterWaves.seed;
    if (composition && !this.resetting) {
      this.reset(false);
      this.feedback('Wave composition applied to a fresh scene.');
    }
  }
  applyLighting() {
    this.app.view.freezeLighting = this.lighting !== 'patrol';
    this.app.view.skyFrozenPhase = this.initial.waterState?.phase || 0;
    if (this.lighting !== 'patrol')
      Object.assign(this.sim.config.ocean, {
        dayCycle: false,
        sunHour: Math.min(
          23.9,
          ((((this.lighting === 'low sun' ? 17.2 : 12) - deltaX(this.sim.p.x, -17 * DEG) / (15 * DEG)) % 24) +
            24) %
            24,
        ),
        cloudCover: this.lighting === 'overcast' ? 0.96 : 0.15,
      });
    this.app.view.refreshEnvironment(true);
    this.drawControls();
  }
  reset(fixture = false, imported = null) {
    this.resetting = true;
    this.commit();
    this.generation++;
    this.advancing = false;
    this.playing = false;
    let tuning = waterTuning(this.sim.config);
    if (fixture) {
      this.initial = {
        x: -30 * DEG,
        z: -40 * DEG,
        heading: 0,
        speed: this.scenario === 'flat' ? 0 : 7,
        throttle: this.scenario === 'flat' ? 0 : 0.85,
        depth: 0,
        targetDepth: 0,
      };
      const { name, ...sea } =
        this.scenario === 'flat'
          ? { waveHeight: 0, windSpeed: 0, choppiness: 0, weather: false }
          : SEA_STATES[
              ['head', 'beam'].includes(this.scenario)
                ? 'storm'
                : this.scenario === 'calm'
                  ? 'calm'
                  : 'atlantic'
            ];
      Object.assign(tuning.ocean, sea, { weather: false, windDirection: this.scenario === 'beam' ? 90 : 0 });
      const look =
        WATER_LOOKS[
          ['head', 'beam'].includes(this.scenario) ? 'storm' : this.scenario === 'calm' ? 'calm' : 'atlantic'
        ];
      for (const [group, fields] of Object.entries(look.tuning)) Object.assign(tuning[group], fields);
      if (['head', 'beam'].includes(this.scenario)) {
        tuning.waterWaves.swellHeading = 0;
        for (let i = 1; i <= 6; i++)
          tuning.waterWaves[`swell${i}Direction`] = this.scenario === 'beam' ? 90 : 180;
      }
      if (this.scenario === 'flat') {
        tuning.graphics.detailWaves = 0;
        tuning.graphics.foam = 0;
        tuning.waterInteraction.contactGain = 0;
      }
      if (this.scenario === 'surface') this.bookmark = 'surface crossing';
    }
    if (imported) {
      this.scenario = imported.scenario;
      this.seed = imported.seed;
      this.initial = imported.initial;
      this.lighting = imported.lighting;
      this.bookmark = imported.camera.bookmark;
      this.fixed = imported.camera.fixed;
      tuning = imported.tuning;
    }
    const recipe = { scenario: this.scenario, seed: this.seed, initial: this.initial, tuning };
    const old = this.sim;
    this.app.attachSimulation(createWaterScene(recipe, old.config));
    old.dispose();
    this.app.view.clearWorldVisuals();
    this.app.view.rng = random(this.seed);
    this.elapsed = this.accumulator = 0;
    this.timeOrigin = this.sim.p.time;
    this.actions = [];
    this.baseTuning = waterTuning(this.sim.config);
    this.app.view.orbit = imported?.camera.orbit || 0;
    this.app.view.elevation = imported?.camera.elevation || 0;
    this.app.view.comparisonCamera = null;
    this.comparisonSeed = null;
    this.initialSeed = this.seed;
    this.lastRecorded = structuredClone(this.baseTuning);
    this.setCamera();
    this.layout();
    $('water-scene').value = this.scenario;
    $('water-camera').value = this.bookmark;
    $('water-lighting').value = this.lighting;
    $('water-fixed').checked = this.fixed;
    this.applyLighting();
    this.update();
    this.resetting = false;
  }
  setCamera() {
    const view = this.app.view;
    view.labCamera = {
      bookmark: this.bookmark,
      fixed: this.fixed,
      anchor: { x: this.sim.p.x, z: this.sim.p.z },
    };
    view.mode = this.bookmark === 'periscope' ? 'periscope' : 'chase';
    view.snapCamera = true;
  }
  advanceFrame(actions = null) {
    this.app.view.comparisonCamera = null;
    this.comparisonSeed = null;
    scriptWaterScene(this.sim, this.scenario, this.elapsed);
    if (actions)
      for (const action of actions)
        if (action.time >= this.elapsed - 1e-8 && action.time < this.elapsed + WATER_STEP - 1e-8)
          this.applyAction(action);
    this.sim.paused = false;
    try {
      this.sim.update(WATER_STEP);
      this.elapsed = this.sim.p.time - this.timeOrigin;
      const now = performance.now(),
        wallDt = this.lastRenderWall ? (now - this.lastRenderWall) / 1000 : WATER_STEP;
      this.lastRenderWall = now;
      this.app.view.render(WATER_STEP, false, wallDt);
    } finally {
      this.sim.paused = true;
    }
  }
  applyAction(action) {
    if (action.type === 'tune') {
      applyWaterTuning(this.sim.config, action.tuning);
      this.sim.refreshWeather();
      this.app.view.applySettings(true);
      if (
        Object.entries(action.tuning).some(([group, fields]) =>
          Object.keys(fields).some((key) => WATER_METADATA[`${group}.${key}`].section === 'Lighting'),
        )
      )
        this.app.view.refreshEnvironment(true);
    }
    if (action.type === 'freeze') {
      this.sim.water.freezePhase = action.value;
      if ($('water-freeze')) $('water-freeze').checked = action.value;
    }
    if (action.type === 'helm') {
      this.sim.labManual = true;
      if (action.throttle !== undefined) this.sim.p.throttle = action.throttle;
      if (action.rudder !== undefined) this.sim.rudder = action.rudder;
      if (action.depth !== undefined) this.sim.p.targetDepth = action.depth;
    }
  }
  async step(seconds, actions = null) {
    if (this.advancing || !this.active) return;
    this.playing = false;
    $('water-play').textContent = 'Play';
    this.commit();
    this.advancing = true;
    $('water-play').textContent = 'Pause';
    const generation = this.generation,
      ticks = Math.min(Math.round(seconds / WATER_STEP), Math.round((1200 - this.elapsed) / WATER_STEP));
    try {
      for (let i = 0; i < ticks; i++) {
        if (!this.active || generation !== this.generation) return;
        this.advanceFrame(actions);
        if (i % 4 === 3) {
          this.update();
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      this.update();
    } finally {
      if (generation === this.generation) {
        this.advancing = false;
        if ($('water-play')) $('water-play').textContent = 'Play';
      }
    }
  }
  tick(dt) {
    if (!this.active) return;
    if (this.playing && !this.advancing && this.elapsed < 1200) {
      this.accumulator = Math.min(0.1, this.accumulator + dt);
      for (let i = 0; i < 3 && this.accumulator + 1e-9 >= WATER_STEP; i++) {
        this.advanceFrame();
        this.accumulator -= WATER_STEP;
      }
    } else {
      this.app.view.render(Math.min(0.1, dt), false, dt);
      this.lastRenderWall = performance.now();
    }
    this.update();
  }
  update() {
    if (!$('water-time')) return;
    $('water-time').textContent = `${this.elapsed.toFixed(2)} s${this.advancing ? ' · advancing' : ''}`;
    if ($('water-telemetry'))
      $('water-telemetry').textContent = JSON.stringify(
        {
          seed: this.seed,
          phase: this.sim.water.phase ?? this.sim.visualTime,
          physicsTime: this.sim.p.time,
          pending: Object.fromEntries(this.pending),
          motion: this.sim.waterMotion,
          ...this.app.view.diagnostics(),
        },
        null,
        2,
      );
  }
  async importRecipe(raw) {
    const recipe = validateWaterRecipe(raw); // Validate everything before touching the running experiment.
    if (!this.active) return;
    this.reset(false, recipe);
    const generation = this.generation;
    await this.step(recipe.duration, recipe.actions);
    if (!this.active || generation !== this.generation) return;
    for (const action of recipe.actions.filter((action) => action.time >= recipe.duration - 1e-7))
      this.applyAction(action);
    if (recipe.camera.position) {
      const position = this.app.view.camera.position
        .clone()
        .set(
          recipe.camera.position.x + deltaX(recipe.camera.origin.x, this.sim.p.x),
          recipe.camera.position.y,
          recipe.camera.position.z + recipe.camera.origin.z - this.sim.p.z,
        );
      const rotation = this.app.view.camera.quaternion
        .clone()
        .set(
          recipe.camera.rotation.x,
          recipe.camera.rotation.y,
          recipe.camera.rotation.z,
          recipe.camera.rotation.w,
        );
      this.app.view.comparisonCamera = { position, rotation };
      this.app.view.underwater = recipe.camera.underwater;
      if (this.fixed && this.app.view.labCamera) this.app.view.labCamera.pose = null;
    }
    this.actions = recipe.actions;
    this.lastRecorded = waterTuning(this.sim.config);
    this.drawControls();
    this.feedback('Recipe reconstructed from its seed, initial conditions and scripted actions.');
  }
  importFile() {
    this.pause();
    const generation = this.generation;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      try {
        const file = input.files?.[0];
        if (!file) return;
        if (file.size > 4e6) throw new Error('Water recipe is too large.');
        const text = await file.text();
        if (!this.active || generation !== this.generation) return;
        await this.importRecipe(JSON.parse(text));
      } catch (error) {
        this.feedback(`Import failed: ${error.message}`);
      }
    };
    input.click();
  }
  stop() {
    if (!this.active) return;
    this.pause();
    this.generation++;
    this.pending.clear();
    this.playing = this.active = false;
    const experiment = this.sim,
      career = this.careerSim;
    this.careerSim = null;
    this.app.attachSimulation(career);
    experiment.dispose();
    career.paused = this.parked.paused;
    career.rudder = this.parked.rudder;
    this.app.restoreInputs?.(this.parked.inputs);
    Object.assign(this.app.view, this.parked.camera);
    this.app.view.labCamera = null;
    this.app.view.freezeLighting = false;
    this.app.view.refreshEnvironment(true);
    this.app.view.comparisonCamera = null;
    this.app.view.ocean.inspect.value = 0;
    this.app.view.ocean.material.wireframe = false;
    this.app.view.probeOverlay.visible = false;
    this.inspectMode = 0;
    this.app.view.camera.position.copy(this.parked.position);
    this.app.view.camera.quaternion.copy(this.parked.rotation);
    this.app.started = this.parked.started;
    this.app.previewTime = this.parked.previewTime;
    $('launch').hidden = this.parked.launch;
    $('hud').hidden = this.parked.hud;
    $('loss').hidden = this.parked.loss;
    $('water-lab').hidden = true;
    document.body.classList.remove('water-lab-active');
    this.app.ui.syncCamera();
    this.app.save();
    this.parked.focus?.focus();
  }
}
