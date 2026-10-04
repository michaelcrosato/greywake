import {
  AI_SCENARIOS,
  AI_STEP,
  applyLabEvent,
  createScenario,
  PLAYER_PROFILES,
  stepScenario,
  telemetryFrame,
  trialMetrics,
} from './ai-scenarios.js';
import { SETTINGS, validateConfig } from './config.js';
import { clamp, deltaX, geo, LAND, TAU, wrapX } from './world.js';

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const number = (n) => (Number.isFinite(n) ? n.toFixed(1) : '—');

export class AILab {
  constructor(app) {
    this.app = app;
    this.active = false;
    this.careerSim = null;
    this.playing = false;
    this.rate = 5;
    this.frames = [];
    this.controls = [];
    this.selectedShip = null;
    this.truth = true;
    this.range = 1800;
    this.elapsed = 0;
    this.preview = null;
    this.seeking = false;
    this.seekGeneration = 0;
  }
  start() {
    if (this.active) return;
    if (this.app.waterLab?.active) this.app.waterLab.stop();
    if (this.app.tutorial.active) this.app.tutorial.stop(false);
    this.app.ui.close();
    this.app.clearInputs();
    if (!this.app.started) this.app.begin({ guided: false });
    this.app.save();
    this.careerSim = this.app.sim;
    this.careerPaused = this.careerSim.paused;
    this.careerSim.paused = true;
    this.camera = {
      mode: this.app.view.mode,
      orbit: this.app.view.orbit,
      elevation: this.app.view.elevation,
    };
    this.config = structuredClone(this.careerSim.config);
    this.scenario = 'convoy';
    this.seed = 42;
    this.profile = 'evasive';
    this.initialProfile = this.profile;
    this.accumulator = 0;
    this.active = true;
    $('hud').hidden = true;
    $('ai-lab').hidden = false;
    document.body.classList.add('ai-lab-active');
    this.layout();
    this.reset();
    $('ai-exit').focus();
  }
  layout() {
    $('ai-lab').innerHTML =
      `<header class="ai-lab-header"><div><p class="eyebrow">DEVELOPER / ISOLATED ENCOUNTER SIMULATION</p><h1>Enemy AI lab</h1></div><button id="ai-exit" class="secondary">Return to patrol</button></header><div class="ai-lab-toolbar"><label>Scenario<select id="ai-scenario">${AI_SCENARIOS.map((s) => `<option value="${s.id}">${s.name}</option>`).join('')}</select></label><label>Seed<input id="ai-seed" type="number" min="1" max="999999" value="42" /></label><label>Player behavior<select id="ai-profile">${PLAYER_PROFILES.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}</select></label><button id="ai-restart" class="primary">Rerun seed</button><button id="ai-play" class="secondary">Play</button><button id="ai-step" class="secondary">Step 1 s</button><button id="ai-ten" class="secondary">Advance 10 s</button><label>Rate<select id="ai-rate"><option>1</option><option selected>5</option><option>20</option><option>100</option></select></label></div><div class="ai-lab-grid"><section class="ai-lab-map"><div class="ai-map-toolbar"><span id="ai-time">0.0 s</span><label><input type="checkbox" id="ai-truth" checked /> Player ground truth</label><label>Range<select id="ai-range"><option value="1800" selected>1.8 km</option><option value="4500">4.5 km</option><option value="8000">8 km</option></select></label></div><canvas id="ai-canvas" aria-label="AI tactical plot with actual ships, estimated contacts, uncertainty and intended courses"></canvas><div class="ai-map-key"><span>▲ Player truth</span><span>▰ Shipping</span><span>○ Contact uncertainty</span><span>┄ Intended course</span><span>● Depth charge</span></div><label class="ai-timeline">Replay time <input id="ai-timeline" type="range" min="0" max="1" step="1" value="0" /><output id="ai-timeline-value">0 s</output></label><p id="ai-scenario-description" class="panel-intro"></p><div id="ai-metrics" class="ai-metrics"></div></section><aside class="ai-lab-inspector"><h2>Observe an enemy</h2><div id="ai-ships"></div><div id="ai-selected"></div><details open><summary>Latest decisions and evidence</summary><div id="ai-events"></div></details><details><summary>Live tuning</summary><p class="settings-help">Changes affect this isolated run immediately and are recorded in its replay. Rerun the seed for a clean comparison. Apply to patrol only when you choose.</p><div id="ai-tuning">${[
        'ai',
        'combat',
        'world',
      ]
        .map(
          (group) =>
            `<details ${group === 'ai' ? 'open' : ''}><summary>${group === 'ai' ? 'Sensors, crew, coordination, search' : group === 'world' ? 'Shipping speed and evasion' : 'Weapon ranges and enemy attacks'}</summary>${Object.entries(
              SETTINGS[group],
            )
              .filter(
                ([key]) =>
                  group !== 'world' || ['merchantSpeed', 'merchantEvasion', 'escortSpeed'].includes(key),
              )
              .map(([key, s]) => {
                const value = this.config[group][key],
                  bool = typeof s[1] === 'boolean';
                return `<label class="setting-row"><span>${s[0]}</span><input data-ai-tune="${group}.${key}" type="${bool ? 'checkbox' : 'range'}" ${bool ? (value ? 'checked' : '') : `min="${s[2]}" max="${s[3]}" step="${s[4]}" value="${value}"`} /><output>${bool ? (value ? 'ON' : 'OFF') : value}</output></label>`;
              })
              .join('')}</details>`,
        )
        .join(
          '',
        )}</div></details><details><summary>Manual inputs and interventions</summary><p class="settings-help">Use Manual lab helm to steer directly; interventions are saved in the replay.</p><label class="setting-row"><span>Power</span><input id="ai-power" type="range" min="0" max="1" step="0.05" value="0.4" /><output>40%</output></label><label class="setting-row"><span>Rudder</span><input id="ai-rudder" type="range" min="-1" max="1" step="0.1" value="0" /><output>0</output></label><div class="ai-action-row"><button data-ai-depth="0">Surface</button><button data-ai-depth="12">12 m</button><button data-ai-depth="80">80 m</button><button data-ai-depth="130">130 m</button><button id="ai-ping">Active ping</button><button id="ai-torpedo">Launch at selected ship</button><button id="ai-damage">Damage selected ship</button></div></details><div class="ai-action-row"><button id="ai-export">Export replay & trace</button><button id="ai-import">Import replay</button><button id="ai-export-tuning">Export tuning</button><button id="ai-apply">Apply tuning to my patrol</button></div><p class="settings-help">This map reveals developer information. Enemy tactics use only their sensor reports; cyan player truth is shown for comparison. Your career is parked safely.</p></aside></div>`;
    $('ai-exit').onclick = () => this.stop();
    $('ai-play').onclick = () => {
      this.playing = !this.playing;
      $('ai-play').textContent = this.playing ? 'Pause' : 'Play';
      this.accumulator = 0;
    };
    $('ai-restart').onclick = () => {
      this.scenario = $('ai-scenario').value;
      this.seed = clamp(Math.floor(Number($('ai-seed').value) || 42), 1, 999999);
      this.profile = $('ai-profile').value;
      this.reset();
    };
    $('ai-step').onclick = () => this.step(1);
    $('ai-ten').onclick = () => this.step(10);
    $('ai-rate').onchange = (e) => {
      this.rate = Number(e.target.value);
    };
    $('ai-truth').onchange = (e) => {
      this.truth = e.target.checked;
      this.render();
    };
    $('ai-range').onchange = (e) => {
      this.range = Number(e.target.value);
      this.render();
    };
    $('ai-timeline').oninput = (e) => {
      this.playing = false;
      this.preview = this.frames[Math.min(this.frames.length - 1, Number(e.target.value))];
      this.render();
    };
    $('ai-timeline').onchange = (e) => this.seek(Number(e.target.value));
    for (const input of document.querySelectorAll('[data-ai-tune]'))
      input.oninput = () => {
        const [group, key] = input.dataset.aiTune.split('.'),
          value = input.type === 'checkbox' ? input.checked : Number(input.value);
        this.config[group][key] = value;
        this.event({ type: 'tune', group, key, value });
        input.nextElementSibling.value = typeof value === 'boolean' ? (value ? 'ON' : 'OFF') : value;
      };
    for (const button of document.querySelectorAll('[data-ai-depth]'))
      button.onclick = () => this.helm({ depth: Number(button.dataset.aiDepth) });
    $('ai-power').oninput = (e) => {
      this.helm({ throttle: Number(e.target.value) });
      e.target.nextElementSibling.value = `${Math.round(Number(e.target.value) * 100)}%`;
    };
    $('ai-rudder').oninput = (e) => {
      this.helm({ rudder: Number(e.target.value) });
      e.target.nextElementSibling.value = e.target.value;
    };
    $('ai-ping').onclick = () => this.event({ type: 'ping' });
    $('ai-torpedo').onclick = () => this.event({ type: 'torpedo', targetId: this.selectedShip });
    $('ai-damage').onclick = () => this.event({ type: 'damage', targetId: this.selectedShip, damage: 25 });
    $('ai-export').onclick = () =>
      this.app.ui.download(
        `greywake-ai-${this.scenario}-${this.seed}.json`,
        JSON.stringify(this.exportReplay(), null, 2),
      );
    $('ai-import').onclick = () => this.importReplay();
    $('ai-export-tuning').onclick = () =>
      this.app.ui.download('greywake-ai-tuning.json', JSON.stringify(this.config, null, 2));
    $('ai-apply').onclick = () => {
      for (const group of ['ai', 'combat']) Object.assign(this.careerSim.config[group], this.config[group]);
      for (const key of ['merchantEvasion', 'merchantSpeed', 'escortSpeed'])
        this.careerSim.config.world[key] = this.config.world[key];
      this.app.save();
      $('ai-apply').textContent = 'Applied to parked patrol ✓';
    };
    $('ai-canvas').onclick = (e) => {
      const rect = e.target.getBoundingClientRect(),
        frame = this.preview || telemetryFrame(this.run.sim),
        best = frame.ships
          .map((s) => ({
            id: s.id,
            d: Math.hypot(this.plot(s).x - (e.clientX - rect.left), this.plot(s).y - (e.clientY - rect.top)),
          }))
          .sort((a, b) => a.d - b.d)[0];
      if (best?.d < 35) {
        this.selectedShip = best.id;
        this.render();
      }
    };
  }
  reset() {
    this.playing = false;
    this.preview = null;
    this.frames = [];
    this.controls = [];
    this.seekGeneration++;
    this.seeking = false;
    const old = this.run?.sim;
    this.run = createScenario(this.scenario, this.seed, this.config, this.profile);
    this.app.attachSimulation(this.run.sim, { render: false });
    old?.dispose();
    this.baseConfig = structuredClone(this.run.sim.config);
    this.config = this.run.sim.config;
    this.initialProfile = this.profile;
    this.accumulator = 0;
    this.frames.push(telemetryFrame(this.run.sim));
    const points = [this.run.sim.p, ...this.run.sim.ships],
      anchor = this.run.sim.p,
      xs = points.map((p) => deltaX(p.x, anchor.x)),
      zs = points.map((p) => p.z);
    this.origin = {
      x: wrapX(anchor.x + (Math.min(...xs) + Math.max(...xs)) / 2),
      z: (Math.min(...zs) + Math.max(...zs)) / 2,
    };
    this.selectedShip = this.run.sim.ships.find((s) => s.escort)?.id ?? this.run.sim.ships[0]?.id;
    $('ai-play').textContent = 'Play';
    $('ai-scenario-description').textContent =
      AI_SCENARIOS.find((s) => s.id === this.scenario)?.description || '';
    this.render();
  }
  event(event) {
    if (this.seeking) return;
    const entry = { ...event, time: this.run.sim.p.time };
    this.controls.push(entry);
    applyLabEvent(this.run.sim, entry, this.run);
    this.config = this.run.sim.config;
    this.render();
  }
  helm(values) {
    if (this.run.profile !== 'manual') this.event({ type: 'profile', value: 'manual' });
    this.profile = 'manual';
    $('ai-profile').value = 'manual';
    this.event({ type: 'helm', ...values });
  }
  step(seconds, redraw = true) {
    if (this.seeking) return;
    this.preview = null;
    seconds = Math.min(seconds, Math.max(0, 1200 - this.run.sim.p.time));
    if (seconds < AI_STEP) {
      this.playing = false;
      $('ai-play').textContent = 'Play';
      return;
    }
    stepScenario(this.run, seconds, (frame) => {
      this.frames.push(frame);
      if (this.frames.length > 1800) this.frames.shift();
    });
    this.run.sim.events = [];
    if (redraw) this.render();
  }
  tick(dt) {
    if (!this.active) return;
    if (this.playing && !this.seeking) {
      this.accumulator += Math.min(0.1, Math.max(0, dt)) * this.rate;
      const ticks = Math.floor((this.accumulator + 1e-9) / AI_STEP);
      this.accumulator -= ticks * AI_STEP;
      if (ticks > 0) this.step(ticks * AI_STEP, false);
    }
    this.elapsed += dt;
    if (this.elapsed > 0.15) {
      this.elapsed = 0;
      this.render();
    }
  }
  async seek(index) {
    const frame = this.frames[index];
    if (frame) await this.seekTime(frame.time);
  }
  async seekTime(time) {
    const generation = ++this.seekGeneration;
    this.playing = false;
    this.seeking = true;
    this.accumulator = 0;
    $('ai-play').textContent = 'Replaying…';
    const fresh = createScenario(this.scenario, this.seed, this.baseConfig, this.initialProfile);
    const rebuilt = [telemetryFrame(fresh.sim)];
    const ticks = Math.max(0, Math.round(time / AI_STEP));
    while (fresh.ticks < ticks) {
      stepScenario(
        fresh,
        Math.min(600, ticks - fresh.ticks) * AI_STEP,
        (f) => rebuilt.push(f),
        this.controls,
      );
      fresh.sim.events = [];
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (generation !== this.seekGeneration || !this.active) {
        fresh.sim.dispose();
        return;
      }
    }
    // Also apply controls at the selected endpoint (including edits made while paused).
    stepScenario(fresh, 0, null, this.controls);
    const old = this.run.sim;
    this.run = fresh;
    this.app.attachSimulation(fresh.sim, { render: false });
    old.dispose();
    this.frames = rebuilt;
    this.controls = this.controls.filter((e) => e.time <= time + 1e-7);
    this.config = fresh.sim.config;
    this.profile = fresh.profile;
    $('ai-profile').value = this.profile;
    this.syncTuning();
    this.preview = null;
    this.seeking = false;
    $('ai-play').textContent = 'Play';
    this.render();
  }
  syncTuning() {
    for (const input of document.querySelectorAll('[data-ai-tune]')) {
      const [group, key] = input.dataset.aiTune.split('.'),
        value = this.config[group][key];
      if (input.type === 'checkbox') input.checked = value;
      else input.value = value;
      input.nextElementSibling.value = typeof value === 'boolean' ? (value ? 'ON' : 'OFF') : value;
    }
  }
  exportReplay() {
    return {
      version: 1,
      scenario: this.scenario,
      seed: this.seed,
      profile: this.initialProfile,
      config: this.baseConfig,
      tuning: this.config,
      duration: this.run.sim.p.time,
      events: this.controls,
      frames: this.frames,
      decisions: this.run.sim.aiEvents,
      metrics: trialMetrics(this.run, this.frames),
    };
  }
  importReplay() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      try {
        const file = input.files?.[0];
        if (!file) return;
        if (file.size > 15e6) throw new Error('Replay exceeds 15 MB');
        const replay = JSON.parse(await file.text());
        if (
          replay.version !== 1 ||
          !AI_SCENARIOS.some((s) => s.id === replay.scenario) ||
          !PLAYER_PROFILES.some((p) => p.id === replay.profile)
        )
          throw new Error('Choose a Greywake AI replay');
        this.scenario = replay.scenario;
        this.seed = clamp(Math.floor(Number(replay.seed) || 42), 1, 999999);
        this.profile = replay.profile;
        this.config = validateConfig(replay.config);
        this.layout();
        $('ai-scenario').value = this.scenario;
        $('ai-seed').value = this.seed;
        $('ai-profile').value = this.profile;
        this.reset();
        this.controls = (Array.isArray(replay.events) ? replay.events : [])
          .filter((e) => e && Number.isFinite(e.time) && e.time >= 0 && e.time <= 1200)
          .sort((a, b) => a.time - b.time);
        const duration = clamp(Number(replay.duration) || 0, 0, 1200);
        await this.seekTime(duration);
        this.render();
      } catch (e) {
        $('ai-scenario-description').textContent = `Import failed: ${e.message}`;
      }
    };
    input.click();
  }
  stop() {
    if (!this.active) return;
    this.seekGeneration++;
    this.playing = false;
    this.active = false;
    const sim = this.run.sim,
      career = this.careerSim;
    this.careerSim = null;
    this.app.attachSimulation(career);
    sim.dispose();
    this.run = null;
    Object.assign(this.app.view, this.camera);
    career.paused = this.careerPaused;
    this.app.ui.syncCamera();
    $('ai-lab').hidden = true;
    $('hud').hidden = false;
    document.body.classList.remove('ai-lab-active');
    this.app.save();
    $('sea').focus();
  }
  plot(point) {
    const canvas = $('ai-canvas'),
      rect = canvas.getBoundingClientRect(),
      origin = this.origin || this.run.sim.p,
      scale = Math.min(rect.width, rect.height) / (this.range * 2);
    return {
      x: rect.width / 2 + deltaX(point.x, origin.x) * scale,
      y: rect.height / 2 + (point.z - origin.z) * scale,
    };
  }
  render() {
    if (!this.active || !this.run) return;
    const frame = this.preview || telemetryFrame(this.run.sim),
      canvas = $('ai-canvas'),
      rect = canvas.getBoundingClientRect(),
      ratio = Math.min(2, devicePixelRatio || 1);
    if (
      canvas.width !== Math.round(rect.width * ratio) ||
      canvas.height !== Math.round(rect.height * ratio)
    ) {
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = '#0b202b';
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.strokeStyle = '#aec2b414';
    ctx.lineWidth = 1;
    for (let i = 0; i < 10; i++) {
      ctx.beginPath();
      ctx.moveTo((i * rect.width) / 10, 0);
      ctx.lineTo((i * rect.width) / 10, rect.height);
      ctx.moveTo(0, (i * rect.height) / 10);
      ctx.lineTo(rect.width, (i * rect.height) / 10);
      ctx.stroke();
    }
    ctx.fillStyle = '#314442';
    ctx.strokeStyle = '#688278';
    for (const polygon of LAND) {
      ctx.beginPath();
      polygon.forEach(([lon, lat], i) => {
        const q = geo(lon, lat),
          scale = Math.min(rect.width, rect.height) / (this.range * 2),
          p = {
            x: rect.width / 2 + (q.x - this.origin.x) * scale,
            y: rect.height / 2 + (q.z - this.origin.z) * scale,
          };
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = '#9eb0ad';
    ctx.font = '10px Courier New';
    ctx.fillText('N ↑', 12, 18);
    const selected = frame.ships.find((s) => s.id === this.selectedShip),
      color = (s) =>
        !s.escort
          ? '#adbdb2'
          : s.state === 'evade'
            ? '#df966f'
            : s.role === 'attacker'
              ? '#e6b67b'
              : s.role === 'guard'
                ? '#83bba6'
                : '#96acdd';
    for (const s of frame.ships) {
      const p = this.plot(s);
      if (s.id === this.selectedShip && s.track) {
        const t = this.plot(s.track),
          radius = ((s.track.uncertainty / this.range) * Math.min(rect.width, rect.height)) / 2;
        ctx.fillStyle = '#dfbd8110';
        ctx.strokeStyle = '#dfbd8180';
        ctx.beginPath();
        ctx.arc(t.x, t.y, Math.max(5, radius), 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(t.x, t.y);
        ctx.setLineDash([3, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (s.id === this.selectedShip && s.goal) {
        const g = this.plot(s.goal);
        ctx.strokeStyle = '#8caadfaa';
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(g.x, g.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeRect(g.x - 4, g.y - 4, 8, 8);
      }
      const trail = this.frames
        .filter((_, i) => i % 3 === 0)
        .slice(-120)
        .map((f) => f.ships?.find((a) => a.id === s.id))
        .filter(Boolean);
      ctx.strokeStyle = `${color(s)}45`;
      ctx.beginPath();
      trail.forEach((q, i) => {
        const a = this.plot(q);
        i ? ctx.lineTo(a.x, a.y) : ctx.moveTo(a.x, a.y);
      });
      ctx.stroke();
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(s.heading);
      ctx.fillStyle = color(s);
      ctx.fillRect(-3, -10, 6, 20);
      if (s.id === this.selectedShip) {
        ctx.strokeStyle = '#e8e7dc';
        ctx.strokeRect(-6, -13, 12, 26);
      }
      ctx.restore();
      ctx.font = '10px Courier New';
      ctx.fillStyle = color(s);
      ctx.fillText(`${s.id} ${s.role}`, p.x + 10, p.y - 7);
    }
    for (const t of frame.torpedoes) {
      const p = this.plot(t);
      ctx.strokeStyle = '#dfbd81';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - Math.sin(t.heading) * 12, p.y + Math.cos(t.heading) * 12);
      ctx.stroke();
    }
    for (const c of frame.charges) {
      const p = this.plot(c);
      ctx.strokeStyle = '#ee9c6f';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = '#ee9c6f';
      ctx.fillText(`${Math.round(c.depth)}m`, p.x + 8, p.y);
    }
    if (this.truth) {
      const p = this.plot(frame.player);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(frame.player.heading);
      ctx.fillStyle = '#73d8db';
      ctx.beginPath();
      ctx.moveTo(0, -10);
      ctx.lineTo(-6, 7);
      ctx.lineTo(6, 7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.fillText(`U-boat ${Math.round(frame.player.depth)}m`, p.x + 12, p.y + 12);
    }
    $('ai-time').textContent =
      `${number(frame.time)} s · ${this.seeking ? 'REPLAYING' : this.playing ? 'RUNNING' : 'PAUSED'} · ${frame.detected ? 'SIGNATURE FIXED' : frame.searching ? 'SEARCH ACTIVE' : 'UNDETECTED'}`;
    $('ai-timeline').max = Math.max(1, this.frames.length - 1);
    if (!this.preview) $('ai-timeline').value = this.frames.length - 1;
    $('ai-timeline-value').textContent = `${number(frame.time)} s`;
    $('ai-ships').innerHTML =
      `<table><thead><tr><th>Ship</th><th>State / role</th><th>Confidence</th></tr></thead><tbody>${frame.ships.map((s) => `<tr data-ai-ship="${s.id}" class="${s.id === this.selectedShip ? 'selected' : ''}"><td><button data-ai-select="${s.id}" aria-pressed="${s.id === this.selectedShip}">${s.id} ${s.escort ? 'Escort' : 'Merchant'}</button></td><td>${esc(s.state)} / ${esc(s.role)}</td><td>${Math.round(s.confidence * 100)}%</td></tr>`).join('')}</tbody></table>`;
    for (const row of document.querySelectorAll('[data-ai-select]'))
      row.onclick = () => {
        this.selectedShip = Number(row.dataset.aiSelect);
        this.render();
      };
    $('ai-selected').innerHTML = selected
      ? `<h3>${esc(selected.name)}</h3><p>${esc(selected.reason)}</p><dl><dt>Crew / doctrine</dt><dd>${number(selected.skill)} / ${esc(selected.doctrine)}</dd><dt>Sensor</dt><dd>${esc(selected.sensor.mode)} · ${Math.round(selected.sensor.range)} m</dd><dt>Evidence</dt><dd>${esc(selected.track?.source || 'none')} · age ${number(selected.track?.age)} s</dd><dt>Uncertainty</dt><dd>${number(selected.track?.uncertainty)} m horizontal / ±${number(selected.track?.depthSpread)} m depth</dd><dt>Estimated depth</dt><dd>${number(selected.track?.depth)} m</dd><dt>Depth charges left</dt><dd>${selected.chargesLeft}</dd></dl>`
      : 'Select a ship on the map or in the table.';
    const events = this.run.sim.aiEvents
      .filter((e) => e.shipId === this.selectedShip && e.time <= frame.time && e.type !== 'decision')
      .slice(-12)
      .reverse();
    $('ai-events').innerHTML = events
      .map(
        (e) =>
          `<div class="ai-event"><time>${number(e.time)} s</time><b>${esc(e.type)}</b><span>${esc(e.reason || e.source || e.plan || e.to || '')}</span></div>`,
      )
      .join('');
    const metrics = trialMetrics(this.run, this.frames);
    $('ai-metrics').innerHTML =
      `<span>First detection <b>${number(metrics.firstDetection)} s</b></span><span>Depth patterns <b>${metrics.patternAttacks}</b></span><span>Wake reactions <b>${metrics.torpedoReactions}</b></span><span>Potential damage <b>${number(metrics.potentialDamage)}</b></span><span>Radio reports pending <b>${frame.pendingReports}</b></span>`;
  }
}
