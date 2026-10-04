import { defaults, SEA_STATES, SETTINGS, validateConfig } from './config.js';
import {
  DEV_PRESETS,
  DEV_SETTINGS,
  developerDefaults,
  openWaterNear,
  validateDeveloper,
} from './developer-settings.js';
import { coordinates, DEG, KNOT, PORTS, wrapX } from './world.js';

const $ = (id) => document.getElementById(id);
const escapeHtml = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const number = (value) => Number(value).toFixed(2).replace(/\.00$/, '');

export class DeveloperPanel {
  constructor(app) {
    this.app = app;
    this.query = '';
    this.group = 'all';
    this.checkpoint = null;
  }
  get sim() {
    return this.app.sim;
  }
  save() {
    this.app.save();
    this.update();
  }
  action(operation) {
    try {
      const result = operation();
      this.save();
      $('dev-feedback').textContent = typeof result === 'string' ? result : 'Applied.';
    } catch (error) {
      $('dev-feedback').textContent = error.message;
    }
  }
  requireEnabled() {
    if (!this.sim.developer.enabled) throw new Error('Enable developer mode to use playtest actions.');
  }
  resetVisuals() {
    this.app.clearInputs?.();
    this.app.view.clearWorldVisuals();
    this.app.view.ocean.bindSurface(this.sim.water);
    this.app.ui.syncCamera();
  }
  teleport(
    destination,
    depth = Number($('dev-depth').value),
    heading = Number($('dev-heading').value),
    preserveShips = false,
  ) {
    this.sim.developerTeleport(destination.x, destination.z, depth, (heading * Math.PI) / 180, preserveShips);
    this.resetVisuals();
    this.fillPosition();
    return preserveShips
      ? 'Teleported near the selected contact. Engines stopped; ships retained.'
      : 'Teleported. Engines stopped and old contacts, weapons and wakes cleared.';
  }
  teleportPort(port) {
    const destination = openWaterNear(port);
    this.teleport(destination, 0, (this.sim.p.heading * 180) / Math.PI);
    const offset = Math.hypot(destination.x - port.x, destination.z - port.z) / 1000;
    return `Teleported to open water near ${port.name}${offset > 0 ? ` · ${offset.toFixed(1)} km from map marker` : ''}. Engines stopped.`;
  }
  draw() {
    if (this.app.tutorial?.active) {
      $('modal-content').innerHTML =
        '<p class="panel-intro">Developer tools edit your patrol. Return from guided practice to keep its protected boat separate.</p><button id="dev-return-patrol" class="primary">Return to patrol & open developer tools</button>';
      $('dev-return-patrol').onclick = () => {
        this.app.tutorial.stop(false);
        this.app.ui.open('developer');
      };
      return;
    }
    const dev = this.sim.developer;
    $('modal-content').innerHTML =
      `<div class="dev-header"><label class="dev-enable"><input id="dev-enabled" type="checkbox" ${dev.enabled ? 'checked' : ''} /> Developer mode</label><span id="dev-summary" class="small-note"></span></div>
      <p class="settings-help">F2 opens this panel. Playtest aids apply while developer mode is enabled. Live tuning updates and saves the active career. Save a checkpoint to return to the same boat, encounter and settings.</p>
      <div class="dev-actions">${Object.entries(DEV_PRESETS)
        .map(([key, preset]) => `<button data-dev-preset="${key}">${preset.name}</button>`)
        .join(
          '',
        )}<button id="dev-normal">Normal play</button><button id="dev-checkpoint-save">Save checkpoint</button><button id="dev-checkpoint-load" ${this.checkpoint ? '' : 'disabled'}>Restore checkpoint</button></div>
      <p id="dev-feedback" role="status" aria-live="polite"></p>
      <div class="developer-grid"><section><h3>Playtest aids</h3><div class="dev-cheats">${Object.entries(
        DEV_SETTINGS,
      )
        .map(([key, spec]) => this.control(key, spec, dev[key], 'data-dev'))
        .join('')}</div>
      <h3>Time and boat state</h3><div class="dev-actions"><button id="dev-pause">${this.sim.paused ? 'Resume' : 'Pause'} simulation</button><button data-dev-step="0.03333333333333333">Step frame</button><button data-dev-step="1">Step 1 s</button><button data-dev-step="10">Advance 10 s</button></div><label>Time compression <select id="dev-time">${[
        ...new Set([1, 5, 20, 100, 1000, 5000, this.sim.acceleration]),
      ]
        .sort((a, b) => a - b)
        .map((v) => `<option ${v === this.sim.acceleration ? 'selected' : ''}>${v}</option>`)
        .join(
          '',
        )}</select></label><p class="settings-help">Combat compression uses full physics and caps at 20×. Higher rates remain for clear-water travel.</p>
      <div class="dev-actions"><button data-dev-action="restore">Restore & rearm</button><button data-dev-action="stop">Stop engines</button><button data-dev-action="funds">Add bounty & XP</button><button data-dev-action="merchant">Spawn merchant</button><button data-dev-action="escort">Spawn escort</button><button data-dev-action="convoy">Spawn convoy</button><button data-dev-action="clear">Clear contacts & weapons</button><button data-dev-action="sink">Sink selected contact</button></div>
      <h3>Teleport</h3><div class="dev-coordinates"><label>Longitude · °<input id="dev-lon" type="number" min="-180" max="180" step="0.001" /></label><label>Latitude · °<input id="dev-lat" type="number" min="-78" max="78" step="0.001" /></label><label>Depth · m<input id="dev-depth" type="number" min="0" max="500" step="1" /></label><label>Heading · °<input id="dev-heading" type="number" min="0" max="360" step="1" /></label></div><div class="dev-actions"><button id="dev-read-position">Use current position</button><button id="dev-teleport">Teleport to coordinates</button><button id="dev-near-target">Near selected contact</button></div><label>Harbor <select id="dev-port">${PORTS.map((port, i) => `<option value="${i}">${port.name} · ${port.region}</option>`).join('')}</select></label><div class="dev-actions"><button id="dev-teleport-port">Teleport to harbor</button><button id="dev-atlantic">Open Atlantic</button><button id="dev-open-chart">Choose on chart</button></div>
      <h3>Sea and inspection</h3><div class="dev-actions">${Object.entries(SEA_STATES)
        .map(([key, state]) => `<button data-dev-sea="${key}">${state.name}</button>`)
        .join('')}<button id="dev-ai-lab">Enemy AI lab</button></div>
      </section><section><h3>Live game variables</h3><label>Search variables <input id="dev-search" type="search" placeholder="Speed, buoyancy, detection…" value="${escapeHtml(this.query)}" /></label><label>Group <select id="dev-group"><option value="all">All groups</option>${Object.keys(
        SETTINGS,
      )
        .map(
          (group) => `<option value="${group}" ${this.group === group ? 'selected' : ''}>${group}</option>`,
        )
        .join(
          '',
        )}</select></label><div class="dev-actions"><button id="dev-reset-group">Reset selected group</button><button id="dev-reset-tuning">Restore game tuning defaults</button></div><p class="settings-help">Hull ratings apply to new ships; projectile ratings apply to new launches. Spawn or launch again to test those changes.</p><p id="dev-variable-count" class="small-note"></p><div id="dev-variables"></div></section></div>
      <div class="file-actions"><button id="dev-export">Export playtest profile</button><button id="dev-import">Import playtest profile</button><button id="dev-export-career">Export current career</button></div>`;
    this.fillPosition();
    this.drawVariables();
    $('dev-enabled').onchange = (event) => {
      this.sim.setDeveloper({ enabled: event.target.checked });
      this.save();
      this.draw();
    };
    $('dev-normal').onclick = () => {
      this.sim.setDeveloper({ enabled: false });
      this.save();
      this.draw();
    };
    for (const button of document.querySelectorAll('[data-dev-preset]'))
      button.onclick = () => {
        this.sim.setDeveloper({
          ...developerDefaults(),
          enabled: true,
          ...DEV_PRESETS[button.dataset.devPreset].settings,
        });
        this.save();
        this.draw();
      };
    this.bindControls(document.querySelector('.dev-cheats'), '[data-dev]', (key, value) => {
      this.sim.setDeveloper({ [key]: value });
      this.save();
    });
    $('dev-pause').onclick = () => {
      this.sim.paused = !this.sim.paused;
      this.app.ui.pauseBefore = this.sim.paused;
      this.update();
    };
    for (const button of document.querySelectorAll('[data-dev-step]'))
      button.onclick = () =>
        this.action(() => {
          this.requireEnabled();
          this.sim.developerStep(Number(button.dataset.devStep));
          this.app.ui.update(1);
          return `Advanced ${Number(button.dataset.devStep).toFixed(2)} s with actual physics.`;
        });
    $('dev-time').onchange = (event) => {
      this.action(() => {
        this.requireEnabled();
        if (!this.sim.setAcceleration(Number(event.target.value)))
          throw new Error('Enable combat time compression or clear contacts.');
        return `Time compression ${this.sim.acceleration}×.`;
      });
      event.target.value = String(this.sim.acceleration);
    };
    for (const button of document.querySelectorAll('[data-dev-action]'))
      button.onclick = () => this.action(() => this.perform(button.dataset.devAction));
    $('dev-read-position').onclick = () => this.fillPosition();
    $('dev-teleport').onclick = () =>
      this.action(() => {
        const lon = $('dev-lon').value,
          lat = $('dev-lat').value;
        if (!lon.trim() || !lat.trim() || !$('dev-depth').value.trim() || !$('dev-heading').value.trim())
          throw new Error('Enter longitude, latitude, depth and heading.');
        return this.teleport({ x: Number(lon) * DEG, z: -Number(lat) * DEG });
      });
    $('dev-teleport-port').onclick = () =>
      this.action(() => this.teleportPort(PORTS[Number($('dev-port').value)]));
    $('dev-atlantic').onclick = () => this.action(() => this.teleport({ x: -30 * DEG, z: -40 * DEG }, 0));
    $('dev-near-target').onclick = () =>
      this.action(() => {
        const target = this.sim.target();
        if (!target) throw new Error('Select a contact first.');
        return this.teleport(
          {
            x: wrapX(target.x - Math.cos(target.heading) * 350),
            z: target.z - Math.sin(target.heading) * 350,
          },
          0,
          Number($('dev-heading').value),
          true,
        );
      });
    $('dev-open-chart').onclick = () => this.app.ui.open('chart');
    for (const button of document.querySelectorAll('[data-dev-sea]'))
      button.onclick = () =>
        this.action(() => {
          const { name, ...settings } = SEA_STATES[button.dataset.devSea];
          Object.assign(this.sim.config.ocean, settings);
          return name;
        });
    $('dev-ai-lab').onclick = () => this.app.aiLab.start();
    $('dev-search').oninput = (event) => {
      this.query = event.target.value;
      this.drawVariables();
    };
    $('dev-group').onchange = (event) => {
      this.group = event.target.value;
      this.drawVariables();
    };
    $('dev-reset-group').onclick = () =>
      this.action(() => {
        const groups = this.group === 'all' ? Object.keys(SETTINGS) : [this.group];
        const values = defaults();
        for (const group of groups) Object.assign(this.sim.config[group], values[group]);
        this.applyTuning();
        this.drawVariables();
        return 'Selected groups restored to defaults.';
      });
    $('dev-reset-tuning').onclick = () =>
      this.action(() => {
        const values = defaults();
        for (const group of Object.keys(values)) Object.assign(this.sim.config[group], values[group]);
        this.applyTuning();
        this.drawVariables();
        return 'Game tuning restored. Developer aids remain separately controlled.';
      });
    $('dev-checkpoint-save').onclick = () => {
      this.checkpoint = structuredClone(this.sim.snapshot());
      this.checkpointPaused = this.sim.paused;
      this.draw();
      $('dev-feedback').textContent = 'Checkpoint captured for this session.';
    };
    $('dev-checkpoint-load').onclick = () =>
      this.action(() => {
        if (!this.checkpoint) throw new Error('Save a checkpoint first.');
        this.app.loadCareer(structuredClone(this.checkpoint));
        this.sim.paused = this.checkpointPaused;
        this.app.ui.pauseBefore = this.sim.paused;
        this.draw();
        return 'Career, encounter, developer aids and tuning restored.';
      });
    $('dev-export').onclick = () =>
      this.app.ui.download(
        'greywake-playtest.json',
        JSON.stringify(
          { schema: 'greywake.playtest/1', developer: this.sim.developer, config: this.sim.config },
          null,
          2,
        ),
      );
    $('dev-export-career').onclick = () =>
      this.app.ui.download('greywake-career.json', JSON.stringify(this.app.careerSnapshot(), null, 2));
    $('dev-import').onclick = () => this.importProfile();
    this.update();
  }
  control(key, spec, value, attribute) {
    const boolean = typeof spec[1] === 'boolean';
    const selector = spec[5]
      ? `<select ${attribute}="${key}">${spec[5].map((v) => `<option ${v === value ? 'selected' : ''}>${v}</option>`).join('')}</select>`
      : boolean
        ? `<input ${attribute}="${key}" type="checkbox" ${value ? 'checked' : ''} />`
        : `<input ${attribute}="${key}" type="range" min="${spec[2]}" max="${spec[3]}" step="${spec[4]}" value="${value}" /><input ${attribute}="${key}" type="number" aria-label="${escapeHtml(spec[0])} exact value" min="${spec[2]}" max="${spec[3]}" step="${spec[4] < 1 ? 'any' : spec[4]}" value="${value}" />`;
    return `<div class="dev-setting"><label>${escapeHtml(spec[0])}<span class="dev-key">${key}</span>${selector}</label><output>${boolean ? (value ? 'ON' : 'OFF') : number(value)}</output></div>`;
  }
  bindControls(root, selector, apply) {
    for (const input of root.querySelectorAll(selector)) {
      const handler = () => {
        const key = input.getAttribute(selector.slice(1, -1)),
          value = input.type === 'checkbox' ? input.checked : Number(input.value);
        if (
          input.type !== 'checkbox' &&
          (!input.value.trim() || !Number.isFinite(value) || !input.checkValidity())
        )
          return;
        apply(key, value);
        const row = input.closest('.dev-setting');
        for (const sibling of row.querySelectorAll(selector))
          if (sibling !== input) {
            if (sibling.type === 'checkbox') sibling.checked = value;
            else sibling.value = value;
          }
        row.querySelector('output').textContent =
          typeof value === 'boolean' ? (value ? 'ON' : 'OFF') : number(value);
      };
      if (input.type === 'number') input.onchange = handler;
      else input.oninput = handler;
    }
  }
  drawVariables() {
    const query = this.query.toLowerCase().trim();
    let count = 0;
    $('dev-variables').innerHTML = Object.entries(SETTINGS)
      .filter(([group]) => this.group === 'all' || this.group === group)
      .map(([group, fields]) => {
        const controls = Object.entries(fields)
          .filter(([key, spec]) => `${group} ${key} ${spec[0]}`.toLowerCase().includes(query))
          .map(([key, spec]) => {
            count++;
            return this.control(`${group}.${key}`, spec, this.sim.config[group][key], 'data-dev-setting');
          })
          .join('');
        return controls ? `<h4>${group.toUpperCase()}</h4>${controls}` : '';
      })
      .join('');
    $('dev-variable-count').textContent = `${count} variables shown · values apply live`;
    this.bindControls($('dev-variables'), '[data-dev-setting]', (path, value) => {
      const [group, key] = path.split('.');
      this.sim.config[group][key] = value;
      this.applyTuning(group, key);
      this.save();
    });
  }
  applyTuning(group, key) {
    if (!group || group === 'graphics')
      this.app.view.applySettings(!key || key === 'oceanSegments' || key === 'interactionResolution');
    if (!group || group === 'world') {
      this.sim.streamed.clear();
      const excess = this.sim.ships.splice(Math.floor(this.sim.config.world.maxShips));
      for (const ship of excess) this.sim.physics.removeRigidBody(ship.body);
      this.sim.stream();
    }
    this.sim.acceleration = Math.min(this.sim.acceleration, this.sim.config.navigation.travelMultiplier);
  }
  fillPosition() {
    if (!$('dev-lon')) return;
    const p = this.sim.p,
      position = coordinates(p.x, p.z);
    $('dev-lon').value = position.lon.toFixed(5);
    $('dev-lat').value = position.lat.toFixed(5);
    $('dev-depth').value = p.depth.toFixed(1);
    $('dev-heading').value = (((p.heading * 180) / Math.PI + 360) % 360).toFixed(1);
  }
  perform(action) {
    this.requireEnabled();
    const sim = this.sim;
    if (['funds', 'restore', 'convoy'].includes(action)) {
      sim.debug(action);
      if (action === 'restore') sim.cooldown = sim.gunCooldown = 0;
    } else if (action === 'stop') {
      sim.p.throttle = sim.p.speed = sim.rudder = 0;
      sim.p.auto = false;
      sim.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    } else if (action === 'clear') {
      sim.clearEncounter();
      this.resetVisuals();
    } else if (action === 'sink') {
      const target = sim.target();
      if (!target) throw new Error('Select a contact first.');
      sim.hitShip(target, target.hp);
    } else if (action === 'merchant' || action === 'escort') {
      const ship = sim.addShip(
        wrapX(sim.p.x + Math.sin(sim.p.heading) * 650),
        sim.p.z - Math.cos(sim.p.heading) * 650,
        sim.p.heading,
        action === 'escort',
      );
      if (!ship)
        throw new Error(
          'No space for another ship, or spawn point is on land. Increase the ship limit or clear contacts.',
        );
      sim.targetId = ship.id;
    }
    return `Playtest action: ${action}.`;
  }
  importProfile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      try {
        const file = input.files?.[0];
        if (!file) return;
        if (file.size > 2e6) throw new Error('Profile is too large.');
        const profile = JSON.parse(await file.text());
        if (profile.schema !== 'greywake.playtest/1' || !profile.config)
          throw new Error('Choose a Greywake playtest profile.');
        const config = validateConfig(profile.config);
        for (const group of Object.keys(config)) Object.assign(this.sim.config[group], config[group]);
        this.sim.setDeveloper(validateDeveloper(profile.developer));
        this.applyTuning();
        this.save();
        this.draw();
        $('dev-feedback').textContent = 'Playtest profile imported.';
      } catch (error) {
        $('dev-feedback').textContent = `Import failed: ${error.message}`;
      }
    };
    input.click();
  }
  update() {
    if (!$('dev-summary')) return;
    const sim = this.sim,
      p = sim.p;
    $('dev-summary').textContent =
      `${sim.developer.enabled ? 'DEV ON' : 'DEV OFF'} · ${number(p.speed / KNOT)} kn · ${number(p.depth)} m · ${Math.round(p.hp)} hull · ${sim.physicsTicks} physics ticks`;
    $('dev-pause').textContent = `${sim.paused ? 'Resume' : 'Pause'} simulation`;
  }
}
