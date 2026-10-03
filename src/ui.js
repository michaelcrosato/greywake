import { captainIntent } from './advice.js';
import {
  defaults,
  HEADS,
  PRESETS,
  SEA_STATES,
  SETTINGS,
  SKILLS,
  UPGRADES,
  validateConfig,
} from './config.js';
import { manualHTML, welcomeHTML } from './guide.js';
import { worldClock } from './lighting.js';
import {
  clamp,
  coordinates,
  DEG,
  deltaX,
  distance,
  geo,
  KNOT,
  LAND,
  LANES,
  PORTS,
  regionName,
} from './world.js';

const $ = (id) => document.getElementById(id);
const number = (n) => Math.round(n).toLocaleString();
const escapeHtml = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const rankDots = (n, max) =>
  `<div class="rank-dots">${Array.from({ length: max }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</div>`;
const positionText = (p) => {
  const c = coordinates(p.x, p.z);
  return `${Math.abs(c.lat).toFixed(2)}° ${c.lat >= 0 ? 'N' : 'S'} · ${Math.abs(c.lon).toFixed(2)}° ${c.lon >= 0 ? 'E' : 'W'}`;
};

export class UI {
  constructor(app) {
    this.app = app;
    this.sim = app.sim;
    this.panel = null;
    this.settingsGroup = 'graphics';
    this.lastUpdate = 0;
    this.intentKey = '';
    this.toastTimer = null;
    this.chartView = { lon: 0, lat: 0, zoom: 1 };
    this.chartDestination = null;
    document.addEventListener('click', (e) => {
      const panel = e.target.closest('[data-panel]');
      if (panel) this.open(panel.dataset.panel);
      const depth = e.target.closest('[data-depth]');
      if (depth) this.sim.dive(Number(depth.dataset.depth));
      const skill = e.target.closest('[data-skill]');
      if (skill) {
        this.sim.buySkill(skill.dataset.skill);
        this.drawPanel();
      }
      const upgrade = e.target.closest('[data-upgrade]');
      if (upgrade) {
        this.sim.buyUpgrade(upgrade.dataset.upgrade);
        this.drawPanel();
      }
      const head = e.target.closest('[data-doctrine]');
      if (head) {
        this.sim.setHead(head.dataset.department, head.dataset.doctrine);
        this.drawPanel();
      }
    });
    $('begin').onclick = () => app.begin();
    $('launch-settings').onclick = () => this.open('settings');
    $('launch-orientation').onclick = () => this.open('orientation');
    $('close-modal').onclick = () => this.close();
    $('modal').addEventListener('click', (e) => {
      if (e.target === $('modal')) this.close();
    });
    $('torpedo').onclick = () => this.sim.fireTorpedo();
    $('gun').onclick = () => this.sim.fireGun();
    $('ping').onclick = () => this.sim.sonarPing();
    $('cycle-target').onclick = () => this.sim.nextTarget();
    $('focus-target').onclick = () => this.focusTarget();
    $('intent-action').onclick = () => this.actOnIntent();
    $('port-marker').onclick = () => this.open('refit');
    $('throttle').oninput = (e) => {
      this.sim.p.throttle = Number(e.target.value);
    };
    $('slower').onclick = () => this.throttle(-0.1);
    $('faster').onclick = () => this.throttle(0.1);
    $('camera').onclick = () => this.camera();
    $('camera-mobile').onclick = () => this.camera();
    $('pause').onclick = () => this.pause();
    $('autopilot').onclick = () => {
      if (!this.sim.p.destination) this.open('chart');
      else this.sim.p.auto = !this.sim.p.auto;
    };
    $('time-cycle').onclick = () => this.time();
    $('salvage').onclick = () => {
      this.sim.salvage();
      $('loss').hidden = true;
      app.save();
    };
    this.bindSteer('port', -1);
    this.bindSteer('starboard', 1);
  }
  bindSteer(id, direction) {
    const button = $(id);
    button.addEventListener('pointerdown', (e) => {
      button.setPointerCapture(e.pointerId);
      this.sim.p.auto = false;
      this.sim.rudder = direction;
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'])
      button.addEventListener(event, () => {
        this.sim.rudder = 0;
      });
  }
  throttle(delta) {
    this.sim.p.throttle = clamp(this.sim.p.throttle + delta, 0, 1);
  }
  time() {
    const steps = [1, 5, 20, 100, 1000, this.sim.config.navigation.travelMultiplier]
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort((a, b) => a - b);
    this.sim.setAcceleration(steps[(steps.indexOf(this.sim.acceleration) + 1) % steps.length]);
  }
  camera() {
    const modes = ['chase', 'periscope', 'tactical'];
    this.app.view.mode = modes[(modes.indexOf(this.app.view.mode) + 1) % modes.length];
    if (this.app.view.mode === 'periscope' && this.sim.p.depth > 18) {
      this.app.view.mode = 'tactical';
      this.toast('Periscope is below the surface. Ascend to 12 m for an optical view.');
    }
    if (this.app.view.mode === 'periscope') this.app.view.orbit = 0;
    this.syncCamera();
  }
  syncCamera() {
    $('periscope').hidden = this.app.view.mode !== 'periscope';
    $('camera').textContent = `${this.app.view.mode.toUpperCase()} VIEW ↻`;
    $('camera-mobile').textContent = `${this.app.view.mode.toUpperCase()} VIEW`;
  }
  pause() {
    this.sim.paused = !this.sim.paused;
  }
  focusTarget() {
    const target = this.sim.target();
    if (!target) {
      this.toast('Select a contact first with Tab / Next contact.');
      return;
    }
    const desired = Math.atan2(deltaX(target.x, this.sim.p.x), this.sim.p.z - target.z);
    this.app.view.orbit = desired - this.sim.p.heading;
    $('sea').focus();
  }
  actOnIntent() {
    const action = captainIntent(this.sim).action;
    if (action === 'surface') this.sim.dive(0);
    if (action === 'resume') this.pause();
    if (action === 'scope') this.sim.dive(12);
    if (action === 'deep') this.sim.dive(80);
    if (action === 'quiet') this.sim.p.throttle = 0.25;
    if (action === 'torpedo') this.sim.fireTorpedo();
    if (action === 'contact') this.sim.nextTarget();
    if (action === 'focus') this.focusTarget();
    if (action === 'time') this.time();
    if (action === 'manual') this.open('manual');
    if (action === 'chart' || action === 'harbor') {
      this.open('chart');
      if (action === 'harbor') {
        this.chartDestination = { ...this.sim.nearestPort() };
        this.updateWaypoint();
        this.drawChart();
      }
    }
    if (!this.panel) $('sea').focus();
  }
  toast(text) {
    if (this.app.tutorial?.active) {
      $('guide-report').textContent = text;
      return;
    }
    clearTimeout(this.toastTimer);
    $('toast').textContent = text;
    $('toast').hidden = false;
    this.toastTimer = setTimeout(() => {
      $('toast').hidden = true;
    }, 5500);
  }
  open(panel) {
    this.app.clearInputs?.();
    if (!this.panel) {
      this.lastFocus = document.activeElement;
      this.pauseBefore = this.sim.paused;
    }
    this.panel = panel;
    this.sim.paused = panel !== 'settings' ? true : this.pauseBefore;
    $('modal').hidden = false;
    document.querySelector('.modal').classList.toggle('settings-modal', panel === 'settings');
    this.drawPanel();
    $('close-modal').focus();
  }
  close() {
    if (!this.panel) return;
    $('modal').hidden = true;
    this.sim.paused = this.pauseBefore;
    this.panel = null;
    this.app.save();
    this.lastFocus?.focus();
  }
  drawPanel() {
    const titles = {
      chart: 'World chart',
      captain: 'The captain',
      crew: 'A crew makes a boat',
      refit: 'Make her your own',
      log: 'Captain’s log',
      settings: 'Graphics & playtest settings',
      orientation: 'Welcome aboard, captain',
      manual: 'Captain’s field manual',
    };
    $('modal-title').textContent = titles[this.panel];
    $('modal-eyebrow').textContent =
      this.panel === 'settings' ? 'GREYWAKE / LIVE TUNING' : 'U-96 / INDEPENDENT COMMAND';
    const content = $('modal-content');
    if (this.panel === 'orientation') {
      content.innerHTML = welcomeHTML(this.app.tutorial.state, this.app.tutorial.active);
      this.app.tutorial.bindWelcome();
    }
    if (this.panel === 'manual') {
      content.innerHTML = manualHTML(this.sim, this.app.tutorial.state);
      $('manual-practice').onclick = () =>
        this.app.tutorial.active ? this.close() : this.app.tutorial.start(false);
    }
    if (this.panel === 'captain') {
      const p = this.sim.p,
        next = p.level * p.level * this.sim.config.economy.skillXp;
      content.innerHTML = `<p class="panel-intro">Experience comes from disrupting shipping. Choose your strengths. Each lower skill requires the first rank of its branch.</p><div class="panel-stats"><div class="panel-stat"><small>CAPTAIN LEVEL</small><strong>${p.level}</strong></div><div class="panel-stat"><small>UNSPENT POINTS</small><strong>${p.skillPoints}</strong></div><div class="panel-stat"><small>XP / NEXT LEVEL</small><strong>${number(p.xp)} <small>/ ${number(next)}</small></strong></div></div><div class="card-grid">${SKILLS.map(
        (s) => {
          const rank = p.skills[s.id] || 0,
            blocked = s.requires && !p.skills[s.requires];
          return `<article class="card"><div class="eyebrow">${s.branch}</div><span class="card-icon">${s.icon}</span><h3>${s.name}</h3><p>${s.description}</p>${rankDots(rank, s.max)}<button class="${rank === s.max ? 'secondary' : 'primary'}" data-skill="${s.id}" ${p.skillPoints < 1 || blocked || rank === s.max ? 'disabled' : ''}>${rank === s.max ? 'Mastered' : 'Train · 1 point'}</button>${blocked ? `<span class="requirement">Requires ${SKILLS.find((v) => v.id === s.requires).name}</span>` : ''}</article>`;
        },
      ).join('')}</div>`;
    }
    if (this.panel === 'crew') {
      const p = this.sim.p;
      content.innerHTML = `<p class="panel-intro">All 44 hands earn experience at sea and in combat. Every rank improves cruising speed, weapons drills, and repairs. Your department heads give the boat its character; their doctrines can be changed freely.</p><div class="panel-stats"><div class="panel-stat"><small>CREW RANK</small><strong>${p.crewRank} / 10</strong></div><div class="panel-stat"><small>CREW EXPERIENCE</small><strong>${number(p.crewXp)}</strong></div><div class="panel-stat"><small>HANDS ABOARD</small><strong>44</strong></div></div><div class="crew-grid">${HEADS.map((h) => `<article class="card"><div class="portrait">${h.initials}</div><div class="eyebrow">${h.role}</div><h3>${h.name}</h3><p>${h.department} · rank ${p.crewRank}<br />${number(p.crewXp)} XP · next rank at ${number(p.crewRank * p.crewRank * this.sim.config.economy.crewRankXp)} XP</p>${h.choices.map((c) => `<button class="doctrine ${p.heads[h.department] === c[0] ? 'active' : ''}" data-department="${h.department}" data-doctrine="${c[0]}"><b>${c[1]} ${p.heads[h.department] === c[0] ? '✓' : ''}</b><small>${c[2]}</small></button>`).join('')}</article>`).join('')}</div>`;
    }
    if (this.panel === 'refit') {
      const p = this.sim.p,
        port = this.sim.nearestPort(),
        near = distance(p, port) < 8000 && p.depth < 2;
      content.innerHTML = `<p class="panel-intro">Spend bounty on permanent boat improvements. Your onboard workshop installs refits underway. Ammunition, diesel, and a full hull repair are available at marked harbors.</p><div class="panel-stats"><div class="panel-stat"><small>AVAILABLE BOUNTY</small><strong>${number(p.bounty)}</strong></div><div class="panel-stat"><small>SHIPPING DISRUPTED</small><strong>${number(p.tonnage)} <small>tons</small></strong></div></div><div class="card-grid">${UPGRADES.map(
        (u) => {
          const rank = p.upgrades[u.id] || 0,
            cost = this.sim.upgradePrice(u.id);
          return `<article class="card"><div class="eyebrow">BOAT REFIT / ${rank} OF ${u.max}</div><h3>${u.name}</h3><p>${u.description}</p>${rankDots(rank, u.max)}<button class="primary" data-upgrade="${u.id}" ${rank === u.max || p.bounty < cost ? 'disabled' : ''}>${rank === u.max ? 'Fully upgraded' : `Install · ${number(cost)} bounty`}</button></article>`;
        },
      ).join(
        '',
      )}</div><div class="service-box"><p>Nearest harbor: <b>${port.name}</b> · ${number(distance(p, port) / 1852)} nm<br />${near ? 'Harbor tender within reach.' : 'Surface within 8 km for harbor service.'}</p><button id="service" class="primary" ${!near || p.bounty < this.sim.servicePrice() ? 'disabled' : ''}>Resupply · ${number(this.sim.servicePrice())}</button></div>`;
      $('service').onclick = () => {
        this.sim.service();
        this.drawPanel();
      };
    }
    if (this.panel === 'chart') this.drawChartPanel();
    if (this.panel === 'log') {
      const p = this.sim.p;
      content.innerHTML = `<div class="panel-stats"><div class="panel-stat"><small>VESSELS SUNK</small><strong>${p.sunk}</strong></div><div class="panel-stat"><small>TONNAGE</small><strong>${number(p.tonnage)}</strong></div><div class="panel-stat"><small>SAILED</small><strong>${number(p.distance / 1852)} <small>nm</small></strong></div></div><p class="panel-intro">${positionText(p)} · ${regionName(p.x, p.z)}. Career autosaves every ten seconds and when a panel closes.</p>${p.log.map((e) => `<div class="log-entry"><time>DAY ${String(Math.floor(e.time / 86400) + 1).padStart(2, '0')}<br />${new Date(e.time * 1000).toISOString().slice(11, 16)}</time><span>${escapeHtml(e.text)}</span></div>`).join('')}<div class="file-actions"><button id="export-save">Export career</button><button id="import-save">Import career</button><button id="new-career" class="danger-button">Start a new career</button></div><p class="settings-help">Controls</p><div class="help-grid"><span><kbd>W / S</kbd>Engine throttle</span><span><kbd>A / D</kbd>Rudder (cancels autopilot)</span><span><kbd>SPACE</kbd>Launch torpedo at selected contact</span><span><kbd>F / Q</kbd>Deck gun / sonar ping</span><span><kbd>R / V</kbd>Surface / periscope depth</span><span><kbd>X / C</kbd>Deep dive / camera view</span><span><kbd>M / K</kbd>Chart / captain skills</span><span><kbd>T / P</kbd>Time acceleration / pause</span><span><kbd>TAB</kbd>Next nearby contact</span><span><kbd>DRAG</kbd>Orbit camera · wheel to zoom</span></div>`;
      $('export-save').onclick = () =>
        this.download('greywake-career.json', JSON.stringify(this.app.careerSnapshot(), null, 2));
      $('import-save').onclick = () => this.importFile('career');
      $('new-career').onclick = () => {
        if (confirm('Start a new career? Export your current career first if you want to keep it.')) {
          this.app.reset();
          this.close();
        }
      };
    }
    if (this.panel === 'settings') this.drawSettings();
  }
  drawSettings() {
    const config = this.sim.config,
      group = this.settingsGroup;
    $('modal-content').innerHTML =
      `<p class="panel-intro">Every control is live. Settings are saved locally and travel with exported careers. Start with Mobile for S25-class hardware or Balanced for an RTX 3060 Ti, then tune to your device.</p><div class="settings-top"><button data-preset="mobile">Mobile</button><button data-preset="balanced">Balanced</button><button data-preset="ultra">Ultra</button><span class="small-note" id="live-performance">${this.app.view?.backend || 'INITIALIZING'}</span></div><div class="settings-tabs">${Object.keys(
        SETTINGS,
      )
        .map(
          (g) =>
            `<button data-settings-tab="${g}" class="${group === g ? 'active' : ''}">${g[0].toUpperCase() + g.slice(1)}</button>`,
        )
        .join('')}</div><div class="settings-fields">${Object.entries(SETTINGS[group])
        .map(([key, spec]) => {
          const boolean = typeof spec[1] === 'boolean',
            value = config[group][key];
          const control = spec[5]
            ? `<select data-setting="${group}.${key}">${spec[5]
                .map(
                  (option) =>
                    `<option value="${option}" ${option === value ? 'selected' : ''}>${option}</option>`,
                )
                .join('')}</select>`
            : `<input data-setting="${group}.${key}" type="${boolean ? 'checkbox' : 'range'}" ${boolean ? (value ? 'checked' : '') : `min="${spec[2]}" max="${spec[3]}" step="${spec[4]}" value="${value}"`} />`;
          return `<label class="setting-row"><span>${spec[0]}</span>${control}<output>${boolean ? (value ? 'ON' : 'OFF') : Number(value).toFixed(spec[4] < 1 ? 2 : 0)}</output></label>`;
        })
        .join(
          '',
        )}</div><p class="settings-help">${group === 'graphics' ? 'Resolution scale is pixels per CSS pixel. Reflection resolution and tessellation are the largest water-quality costs. Drag the camera to inspect bow foam and the trailing wake.' : group === 'world' ? 'Traffic is deterministic per 6 km cell, with convoys following ocean shipping corridors. A changed density or ship limit refreshes the current streamed area.' : group === 'navigation' ? 'Acceleration drops to 1× near contacts. Large time factors use strategic navigation while checking land, resources, and incoming traffic.' : group === 'economy' ? 'Captain and crew rank thresholds grow with the square of the rank. Cost and reward multipliers apply to all future transactions.' : 'Changes apply to the active simulation immediately.'}</p><details><summary class="small-note">DEVELOPER TOOLS / PLAYTEST ACTIONS</summary><div class="dev-actions"><button data-debug="funds">+10,000 bounty & XP</button><button data-debug="restore">Restore & rearm</button><button data-debug="convoy">Spawn nearby convoy</button><button data-debug="clear">Clear local traffic</button></div><p class="settings-help">These actions affect your saved career. Export it before experimenting if you want to preserve your progress.</p></details><div class="file-actions"><button id="export-settings">Export settings</button><button id="import-settings">Import settings</button><button id="factory-settings">Factory settings</button></div>`;
    for (const button of document.querySelectorAll('[data-settings-tab]'))
      button.onclick = () => {
        this.settingsGroup = button.dataset.settingsTab;
        this.drawSettings();
      };
    if (group === 'ocean') {
      const states = document.createElement('div');
      states.className = 'settings-top';
      states.innerHTML = Object.entries(SEA_STATES)
        .map(([key, state]) => `<button data-sea-state="${key}">${state.name}</button>`)
        .join('');
      document.querySelector('.settings-fields').before(states);
      for (const button of states.querySelectorAll('[data-sea-state]'))
        button.onclick = () => {
          const { name, ...settings } = SEA_STATES[button.dataset.seaState];
          Object.assign(config.ocean, settings);
          this.app.save();
          this.drawSettings();
        };
    }
    for (const button of document.querySelectorAll('[data-preset]'))
      button.onclick = () => {
        Object.assign(config.graphics, PRESETS[button.dataset.preset]);
        this.app.view?.applySettings(true);
        this.app.save();
        this.drawSettings();
      };
    for (const input of document.querySelectorAll('[data-setting]'))
      input.oninput = () => {
        const [g, k] = input.dataset.setting.split('.'),
          value = input.type === 'checkbox' ? input.checked : Number(input.value);
        config[g][k] = value;
        input.nextElementSibling.value =
          typeof value === 'boolean'
            ? value
              ? 'ON'
              : 'OFF'
            : Number(value).toFixed(SETTINGS[g][k][4] < 1 ? 2 : 0);
        if (g === 'graphics')
          this.app.view?.applySettings(['oceanSegments', 'interactionResolution'].includes(k));
        if (g === 'world') {
          this.sim.streamed.clear();
          const excess = this.sim.ships.splice(Math.floor(config.world.maxShips));
          for (const s of excess) this.sim.physics.removeRigidBody(s.body);
          this.sim.stream();
        }
        if (g === 'navigation' && k === 'travelMultiplier')
          this.sim.acceleration = Math.min(this.sim.acceleration, value);
        this.app.save();
      };
    for (const button of document.querySelectorAll('[data-debug]'))
      button.onclick = () => this.sim.debug(button.dataset.debug);
    $('export-settings').onclick = () =>
      this.download('greywake-settings.json', JSON.stringify(config, null, 2));
    $('import-settings').onclick = () => this.importFile('settings');
    $('factory-settings').onclick = () => {
      const d = defaults();
      for (const g of Object.keys(d)) Object.assign(config[g], d[g]);
      this.app.view?.applySettings(true);
      this.app.save();
      this.drawSettings();
    };
    const diagnostics = document.createElement('button');
    diagnostics.textContent = 'Export rendering diagnostics';
    diagnostics.onclick = () =>
      this.download('greywake-rendering.json', JSON.stringify(this.app.view.diagnostics(), null, 2));
    document.querySelector('#modal-content .file-actions').append(diagnostics);
    if (window.gameBoot) {
      const startup = document.createElement('button');
      startup.textContent = 'Startup diagnostics';
      startup.onclick = () => window.gameBoot.open();
      document.querySelector('#modal-content .file-actions').append(startup);
    }
    const lab = document.createElement('button');
    lab.id = 'open-ai-lab';
    lab.textContent = 'Open enemy AI lab';
    lab.onclick = () => this.app.aiLab.start();
    document.querySelector('#modal-content .file-actions').append(lab);
  }
  download(name, text) {
    const a = document.createElement('a'),
      url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  importFile(kind) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      try {
        const file = input.files?.[0];
        if (!file) return;
        if (file.size > 2e6) throw new Error('File is too large.');
        const value = JSON.parse(await file.text());
        if (kind === 'settings') {
          if (!value.graphics || !value.combat) throw new Error('Choose a Greywake settings file.');
          const valid = validateConfig(value);
          for (const g of Object.keys(valid)) Object.assign(this.sim.config[g], valid[g]);
          this.app.view.applySettings(true);
        } else {
          if (value.career?.version !== 1) throw new Error('Choose a Greywake career export.');
          this.app.loadCareer(value);
        }
        this.app.save();
        this.drawPanel();
        this.toast(`${kind === 'settings' ? 'Settings' : 'Career'} imported.`);
      } catch (error) {
        this.toast(`Import failed: ${error.message}`);
      }
    };
    input.click();
  }
  drawChartPanel() {
    this.chartDestination = this.sim.p.destination ? { ...this.sim.p.destination } : null;
    $('modal-content').innerHTML =
      `<p class="panel-intro">Choose any open-water destination. The navigator plots a course around land. Harbors offer resupply; shipping corridors offer opportunity.</p><div class="chart-layout"><div><div class="chart-map"><canvas id="world-chart" aria-label="World navigation chart. Click open water to choose a destination."></canvas><div class="chart-tools"><button id="chart-world">WORLD</button><button id="chart-local">LOCAL</button><button id="chart-zoom-in" aria-label="Zoom chart in">+</button><button id="chart-zoom-out" aria-label="Zoom chart out">−</button></div><div class="chart-key"><span style="color:#dfbd81">◆ U-96</span><span>○ HARBOR</span><span>┄ SHIPPING LANE</span></div></div><p class="chart-hint">TAP WATER TO SET A WAYPOINT · WHEEL TO ZOOM<br />${positionText(this.sim.p)} · Equirectangular chart</p></div><div class="chart-side"><div class="eyebrow">KNOWN HARBORS</div><select id="port-select" aria-label="Choose a harbor"><option value="">Choose a harbor…</option>${PORTS.map((p, i) => `<option value="${i}">${p.name} · ${p.region}</option>`).join('')}</select><h3 id="waypoint-name">${escapeHtml(this.chartDestination?.name || 'Open horizon')}</h3><p id="waypoint-info">Tap the ocean or choose a harbor.</p><button id="set-course" class="primary" ${!this.chartDestination ? 'disabled' : ''}>Set course & engage autopilot</button><button id="cancel-course" class="secondary" style="width:100%;font-size:10px">Cancel navigation</button><p>Use time compression after you break contact. Escorts and nearby shipping return time to 1×.</p></div></div>`;
    $('port-select').onchange = (e) => {
      if (e.target.value === '') return;
      this.chartDestination = { ...PORTS[Number(e.target.value)] };
      this.updateWaypoint();
      this.drawChart();
    };
    $('set-course').onclick = () => {
      if (this.chartDestination && this.sim.setDestination(this.chartDestination, this.chartDestination.name))
        this.close();
    };
    $('cancel-course').onclick = () => {
      this.sim.p.route = [];
      this.sim.p.destination = null;
      this.sim.p.auto = false;
      this.chartDestination = null;
      this.updateWaypoint();
      this.drawChart();
    };
    $('chart-world').onclick = () => {
      this.chartView = { lon: 0, lat: 0, zoom: 1 };
      this.drawChart();
    };
    $('chart-local').onclick = () => {
      const p = coordinates(this.sim.p.x, this.sim.p.z);
      this.chartView = { lon: p.lon, lat: p.lat, zoom: 16 };
      this.drawChart();
    };
    $('chart-zoom-in').onclick = () => {
      this.chartView.zoom = clamp(this.chartView.zoom * 2, 1, 256);
      this.drawChart();
    };
    $('chart-zoom-out').onclick = () => {
      this.chartView.zoom = clamp(this.chartView.zoom / 2, 1, 256);
      this.drawChart();
    };
    const canvas = $('world-chart');
    canvas.onclick = (e) => {
      const rect = canvas.getBoundingClientRect(),
        lon = this.chartView.lon + (((e.clientX - rect.left) / rect.width - 0.5) * 360) / this.chartView.zoom,
        lat = this.chartView.lat + ((0.5 - (e.clientY - rect.top) / rect.height) * 150) / this.chartView.zoom;
      const candidate = geo(lon, lat),
        port = PORTS.find((p) => distance(p, candidate) < (DEG * 2) / this.chartView.zoom);
      this.chartDestination = port ? { ...port } : { ...candidate, name: 'Chart waypoint' };
      this.updateWaypoint();
      this.drawChart();
    };
    canvas.onwheel = (e) => {
      e.preventDefault();
      this.chartView.zoom = clamp(this.chartView.zoom * (e.deltaY < 0 ? 1.3 : 1 / 1.3), 1, 256);
      this.drawChart();
    };
    this.updateWaypoint();
    requestAnimationFrame(() => this.drawChart());
  }
  updateWaypoint() {
    const dest = this.chartDestination;
    $('waypoint-name').textContent = dest?.name || 'Open horizon';
    $('waypoint-info').textContent = dest
      ? `${positionText(dest)} · ${number(distance(dest, this.sim.p) / 1852)} nm direct distance.`
      : 'Tap the ocean or choose a harbor.';
    $('set-course').disabled = !dest;
  }
  drawChart() {
    const canvas = $('world-chart');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect(),
      ratio = Math.min(2, devicePixelRatio || 1);
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    const w = rect.width,
      h = rect.height,
      v = this.chartView;
    const xy = (lon, lat) => [
      (((lon - v.lon) * v.zoom) / 360) * w + w / 2,
      (((v.lat - lat) * v.zoom) / 150) * h + h / 2,
    ];
    const routePoint = (p) => {
      const g = coordinates(p.x, p.z);
      return xy(g.lon, g.lat);
    };
    ctx.fillStyle = '#0b2330';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#8bafa416';
    ctx.lineWidth = 1;
    const step = v.zoom > 32 ? 0.25 : v.zoom > 8 ? 2 : v.zoom > 2 ? 10 : 30;
    ctx.font = '8px Courier New';
    ctx.fillStyle = '#63877c';
    for (let lon = -180; lon <= 180; lon += step) {
      const [x] = xy(lon, 0);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      if (x > 10 && x < w - 25) ctx.fillText(`${lon}°`, x + 3, h - 10);
    }
    for (let lat = -75; lat <= 75; lat += step) {
      const [, y] = xy(0, lat);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      if (y > 15 && y < h - 20) ctx.fillText(`${lat}°`, 5, y - 5);
    }
    for (const poly of LAND) {
      ctx.beginPath();
      poly.forEach(([lon, lat], i) => {
        const [x, y] = xy(lon, lat);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = '#38514e';
      ctx.fill();
      ctx.strokeStyle = '#7a948566';
      ctx.stroke();
    }
    ctx.strokeStyle = '#9fb8a640';
    ctx.setLineDash([3, 5]);
    for (const lane of LANES) {
      ctx.beginPath();
      lane.forEach(([lon, lat], i) => {
        const [x, y] = xy(lon, lat);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.font = '9px Courier New';
    for (const port of PORTS) {
      const [x, y] = xy(port.lon, port.lat);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.strokeStyle = '#acbea9';
      ctx.stroke();
      ctx.fillStyle = '#a7b7a9';
      ctx.fillText(port.name, x + 6, y - 5);
    }
    const [px, py] = routePoint(this.sim.p);
    ctx.strokeStyle = '#dfbd81';
    ctx.fillStyle = '#dfbd81';
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(this.sim.p.heading);
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(-4, 5);
    ctx.lineTo(4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    if (this.sim.p.route.length) {
      ctx.beginPath();
      ctx.moveTo(px, py);
      for (const p of this.sim.p.route) ctx.lineTo(...routePoint(p));
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const ship of this.sim.contacts()) {
      const [x, y] = routePoint(ship);
      ctx.fillStyle = ship.escort ? '#c47d65' : '#b6c8ae';
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
    if (this.chartDestination) {
      const [x, y] = routePoint(this.chartDestination);
      ctx.strokeStyle = '#dfbd81';
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.moveTo(x - 12, y);
      ctx.lineTo(x + 12, y);
      ctx.moveTo(x, y - 12);
      ctx.lineTo(x, y + 12);
      ctx.stroke();
    }
  }
  update(dt) {
    this.lastUpdate += dt;
    const sim = this.sim,
      p = sim.p,
      view = this.app.view;
    if (view.mode === 'periscope' && p.depth > 18) {
      view.mode = 'chase';
      this.syncCamera();
    }
    for (const event of sim.events.splice(0)) {
      if (event.type === 'message') this.toast(event.text);
      else this.app.sound.play(event.type);
    }
    if (!this.app.started) return;
    if (this.lastUpdate < 0.1) return;
    this.lastUpdate = 0;
    $('region').textContent = regionName(p.x, p.z).toUpperCase();
    $('heading').textContent =
      `${String(Math.round(((p.heading * 180) / Math.PI + 360) % 360)).padStart(3, '0')}°`;
    $('bounty').textContent = number(p.bounty);
    $('level').textContent = `LVL ${p.level}`;
    $('coordinates').textContent = positionText(p);
    $('speed').textContent = (p.speed / KNOT).toFixed(1);
    $('throttle').value = p.throttle;
    $('depth').textContent = Math.round(p.depth);
    const depthDifference = p.targetDepth - p.depth;
    $('depth-order').textContent =
      Math.abs(depthDifference) < 0.5
        ? p.depth < 1
          ? 'On the surface'
          : `Holding ${Math.round(p.depth)} m`
        : `${depthDifference > 0 ? 'Diving' : 'Rising'} → ${p.targetDepth} m`;
    $('patrol-kind').textContent = this.sim.training
      ? 'PRACTICE BOAT / YOUR CAREER IS SAFE'
      : 'U-96 / INDEPENDENT PATROL';
    $('intent-card').hidden = !!sim.training;
    const intent = captainIntent(sim),
      intentKey = JSON.stringify(intent);
    if (intentKey !== this.intentKey) {
      this.intentKey = intentKey;
      $('intent-title').textContent = intent.title;
      $('intent-copy').textContent = intent.text;
      $('intent-action').textContent = intent.label;
    }
    for (const key of ['hp', 'fuel', 'battery', 'oxygen']) {
      const label = key === 'hp' ? 'hull' : key,
        percent = key === 'hp' ? (p.hp / sim.maxHp()) * 100 : p[key];
      $(label).textContent = `${Math.ceil(percent)}%`;
      $(`${label}-bar`).style.width = `${percent}%`;
      $(`${label}-bar`).style.background = percent < 25 ? '#df9374' : '#83bba6';
    }
    for (const button of document.querySelectorAll('[data-depth]'))
      button.classList.toggle('active', Number(button.dataset.depth) === p.targetDepth);
    $('route-label').innerHTML = `${escapeHtml(p.destination?.name || 'Set a destination')} <span>↗</span>`;
    $('route-distance').textContent = p.route.length
      ? `${number(p.route.reduce((n, b, i) => n + distance(i ? p.route[i - 1] : p, b), 0) / 1852)} nm to destination`
      : 'Open water · free helm';
    $('autopilot').textContent = p.auto ? 'AUTO ON' : 'AUTO OFF';
    $('time-value').textContent = `${sim.acceleration}×`;
    $('pause').textContent = sim.paused ? '▶ RESUME' : 'Ⅱ PAUSE';
    $('threat').classList.toggle('danger', sim.detected);
    $('threat').innerHTML =
      `<span class="status-dot"></span>${sim.detected ? 'Escort tracking you' : sim.searching ? 'Escort searching · signature lost' : p.depth > 5 ? 'Running submerged' : 'Running undetected'}`;
    $('sea-state').textContent =
      sim.config.ocean.waveHeight * (1 + sim.weather) > 3
        ? 'HEAVY SEAS'
        : sim.config.ocean.waveHeight < 0.8
          ? 'CALM WATER'
          : 'MODERATE SWELL';
    for (const kind of ['torpedo', 'gun']) {
      const readiness = sim.weaponReadiness(kind);
      $(`${kind}-status`).textContent = readiness.ready
        ? `${readiness.ammo} ${kind === 'torpedo' ? 'TORPEDOES READY' : 'SHELLS READY'}`
        : readiness.reason;
      $(kind).disabled = !readiness.ready;
      $(kind).title =
        readiness.reason || `Fire at the selected contact within ${Math.round(readiness.range)} m`;
    }
    const target = sim.target();
    $('target-name').textContent = target?.name || 'No contact selected';
    $('target-detail').textContent = target
      ? `${target.escort ? 'ESCORT' : 'MERCHANT'} · ${(distance(target, p) / 1000).toFixed(2)} km · ${number(target.tonnage)} t`
      : 'Tap a ship or cycle contacts';
    $('target-hull').style.width = target ? `${(target.hp / target.maxHp) * 100}%` : '0%';
    $('solution').textContent = target
      ? `LEAD ${Math.round(((sim.intercept(target, sim.config.combat.torpedoSpeed).heading * 180) / Math.PI + 360) % 360)}° · ${Math.ceil(sim.intercept(target, sim.config.combat.torpedoSpeed).seconds)}s TO IMPACT`
      : '';
    $('contact-count').textContent = `${String(sim.contacts().length).padStart(2, '0')} CONTACTS`;
    const clock = worldClock(p, sim.config);
    $('patrol-time').textContent =
      `${sim.training ? 'PRACTICE' : 'PATROL'} DAY ${String(clock.day).padStart(2, '0')} · ${clock.text}`;
    const fpsText = view.fps < 10 ? view.fps.toFixed(1) : Math.round(view.fps);
    $('performance').textContent =
      `${fpsText} FPS · ${view.backend}${view.adapter?.software ? ' / CPU' : ''}`;
    $('performance').title =
      `${view.frameMs.toFixed(1)} ms/frame · ${view.cpuMs.toFixed(1)} ms CPU submit · ${view.adapter?.description || view.adapter?.architecture || 'Adapter not reported'}`;
    $('loss').hidden = p.hp > 0 || !!this.panel || !!this.app.tutorial?.active;
    this.drawRadar();
    this.updateLabels();
    const port = sim.nearestPort(),
      portPosition =
        distance(port, p) < sim.config.graphics.viewDistance
          ? view.screenPosition(port.x + 80, 8, port.z + 80)
          : null;
    $('port-marker').hidden = !portPosition;
    if (portPosition) {
      $('port-marker').textContent = `${port.name} · resupply anchorage`;
      $('port-marker').style.left = `${portPosition.x}px`;
      $('port-marker').style.top = `${portPosition.y}px`;
    }
    if (this.panel === 'settings' && $('live-performance'))
      $('live-performance').textContent =
        `${fpsText} FPS · ${view.frameMs.toFixed(0)} ms · ${view.backend} · ${view.adapter?.software ? 'SOFTWARE GPU' : view.adapter?.vendor || 'GPU'}`;
  }
  drawRadar() {
    const ctx = $('radar').getContext('2d'),
      s = 280,
      c = 140;
    ctx.clearRect(0, 0, s, s);
    ctx.fillStyle = '#0a252b80';
    ctx.beginPath();
    ctx.arc(c, c, 129, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#aac2ac30';
    ctx.lineWidth = 1;
    for (const r of [42, 84, 126]) {
      ctx.beginPath();
      ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(c, 10);
    ctx.lineTo(c, 270);
    ctx.moveTo(10, c);
    ctx.lineTo(270, c);
    ctx.stroke();
    ctx.font = '11px Courier New';
    ctx.fillStyle = '#acc3ac99';
    ctx.fillText('N', 136, 8);
    const angle = performance.now() / 2800;
    ctx.strokeStyle = '#b5caae40';
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(c + Math.sin(angle) * 127, c - Math.cos(angle) * 127);
    ctx.stroke();
    for (const ship of this.sim.contacts()) {
      const dx = deltaX(ship.x, this.sim.p.x),
        dz = ship.z - this.sim.p.z,
        x = c + (dx / this.sim.detectionRadius()) * 125,
        y = c + (dz / this.sim.detectionRadius()) * 125;
      ctx.fillStyle = ship.id === this.sim.targetId ? '#dfbd81' : ship.escort ? '#df947a' : '#b6ccaf';
      ctx.beginPath();
      ctx.arc(x, y, ship.id === this.sim.targetId ? 4 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(this.sim.p.heading);
    ctx.fillStyle = '#dfbd81';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(-4, 5);
    ctx.lineTo(4, 5);
    ctx.fill();
    ctx.restore();
  }
  updateLabels() {
    const contacts = this.sim.contacts(),
      labels = $('labels');
    for (const el of [...labels.children])
      if (!contacts.some((s) => String(s.id) === el.dataset.ship)) el.remove();
    for (const ship of contacts) {
      let button = labels.querySelector(`[data-ship="${ship.id}"]`);
      if (!button) {
        button = document.createElement('button');
        button.className = 'ship-label';
        button.dataset.ship = ship.id;
        button.onclick = () => {
          this.sim.targetId = ship.id;
        };
        labels.append(button);
      }
      const pos = this.app.view.screenPosition(ship.x, ship.y + 20, ship.z);
      button.hidden = !pos;
      if (pos) {
        button.style.left = `${pos.x}px`;
        button.style.top = `${pos.y}px`;
        button.classList.toggle('selected', ship.id === this.sim.targetId);
        button.innerHTML = `${escapeHtml(ship.name)}<small>${(distance(ship, this.sim.p) / 1000).toFixed(1)} KM</small><span class="diamond"></span>`;
      }
    }
  }
}
