import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Quaternion, Vector3 } from 'three';
import { defaults, PRESETS, SETTINGS, validateConfig } from '../src/config.js';
import { validateSetting } from '../src/setting-controls.js';
import { initPhysics } from '../src/simulation.js';
import { applyWaterLook, WATER_LOOKS } from '../src/water-presets.js';
import {
  applyWaterTuning,
  createWaterScene,
  initialWaterConditions,
  validateWaterRecipe,
  WATER_STEP,
  waterTuning,
} from '../src/water-scenarios.js';
import { WATER_PATHS } from '../src/water-settings.js';
import { OceanSurface, SpectralCascade, WaterInteractions } from '../src/water-surface.js';
import { DEG } from '../src/world.js';

await initPhysics();
function recipe() {
  const config = defaults();
  Object.assign(config.graphics, PRESETS.mobile);
  return {
    schema: 'greywake.water-lab/1',
    seed: 42,
    tuning: waterTuning(config),
    scenario: 'calm',
    initial: { x: -30 * DEG, z: -40 * DEG, heading: 0, depth: 0, targetDepth: 0, speed: 0, throttle: 0 },
    lighting: 'noon',
    camera: { bookmark: 'chase', fixed: false, orbit: 0, elevation: 0 },
    duration: 1,
    actions: [],
  };
}
test('Every water look validates and returning from storm to calm restores reflection strength', () => {
  const config = defaults();
  for (const name of Object.keys(WATER_LOOKS)) {
    applyWaterLook(config, name);
    assert.deepEqual(validateConfig(config, { strict: true }), config);
  }
  applyWaterLook(config, 'storm');
  assert.ok(config.waterAppearance.environmentGain < defaults().waterAppearance.environmentGain);
  applyWaterLook(config, 'calm');
  assert.equal(config.waterAppearance.environmentGain, defaults().waterAppearance.environmentGain);
  assert.equal(config.waterAppearance.planarGain, defaults().waterAppearance.planarGain);
});
test('Typed water defaults and legacy configuration round-trip; imports reject invalid values atomically', () => {
  const c = defaults();
  assert.deepEqual(validateConfig(c, { strict: true }), c);
  for (const path of WATER_PATHS) {
    const [group, key] = path.split('.');
    assert.equal(validateSetting(SETTINGS[group][key], c[group][key], { strict: true }), c[group][key]);
  }
  assert.equal(validateConfig({ ocean: { waveHeight: 1.5 } }).ocean.waveHeight, 1.5);
  const before = structuredClone(c);
  for (const invalid of [
    { waterWaves: { seed: 1.5 } },
    { waterAppearance: { deepColor: 'red' } },
    { graphics: { spectrumResolution: 48 } },
    { ocean: { waveSpeed: Infinity } },
    { combat: { torpedoDamage: 50 } },
    { waterWaves: { updateRate: 9 } },
  ]) {
    assert.throws(() => applyWaterTuning(c, invalid));
    assert.deepEqual(c, before);
  }
  c.navigation.turnRate = 12;
  applyWaterTuning(c, { ocean: { waveHeight: 0 }, waterWaves: { seed: 4294967295 } });
  assert.equal(c.navigation.turnRate, 12);
  assert.equal(c.ocean.waveHeight, 0);
});
test('Recipes validate camera, seed, duration, initial conditions and every scripted action before execution', () => {
  const r = recipe();
  assert.deepEqual(validateWaterRecipe(r), r);
  for (const invalid of [
    { ...r, schema: 'greywake.water-lab/2' },
    { ...r, duration: 1201 },
    { ...r, seed: -1 },
    { ...r, camera: { ...r.camera, bookmark: 'unknown' } },
    { ...r, actions: [{ type: 'tune', time: 0, tuning: { navigation: { turnRate: 30 } } }] },
    { ...r, actions: [{ type: 'helm', time: 0, throttle: NaN }] },
  ])
    assert.throws(() => validateWaterRecipe(invalid));
});
test('Changing wave speed and chop preserves the realization and instantaneous phase; freeze reports zero base velocity', () => {
  const c = defaults();
  Object.assign(c.graphics, PRESETS.mobile);
  const water = new OceanSurface(c);
  water.advanceTime(12.3);
  const a = water.sampleSurface(27, 51),
    height = a.height,
    cascades = water.cascades;
  c.ocean.waveSpeed = 1.1;
  assert.equal(water.sampleSurface(27, 51).height, height);
  assert.equal(water.cascades, cascades);
  c.ocean.choppiness = 1.1;
  water.ensure();
  assert.equal(water.cascades, cascades);
  water.freezePhase = true;
  const held = water.phase;
  water.advanceTime(1);
  assert.equal(water.phase, held);
  assert.equal(water.sampleSurface(27, 51, { local: false }).surfaceVerticalVelocity, 0);
});
test('Supported extreme bands and weather remain invertible with bounded residual', () => {
  const c = defaults();
  Object.assign(c.graphics, PRESETS.mobile);
  Object.assign(c.ocean, { waveHeight: 6, windSpeed: 22, choppiness: 1.3 });
  Object.assign(c.waterWaves, { windEnergy: 2, band1Gain: 2, band2Gain: 2, band3Gain: 2 });
  const water = new OceanSurface(c);
  water.advanceTime(12.3);
  const out = {};
  for (let z = -192; z < 192; z += 8)
    for (let x = -192; x < 192; x += 8) {
      water.sampleSurface(x, z, { weather: 1, local: false }, out);
      assert.ok(out.jacobian > 0, `fold at ${x},${z}`);
      assert.ok(out.inverseResidual < 0.02, `${out.inverseResidual}`);
      assert.ok(Number.isFinite(out.height));
    }
  assert.ok(water.effectiveChop < c.ocean.choppiness);
});
test('Shared low-frequency coefficients survive resolution changes and pure queries do not age foam', () => {
  const a = new SpectralCascade(512, 32),
    b = new SpectralCascade(512, 128);
  for (const [x, z] of [
    [1, 0],
    [3, 4],
    [-2, -1],
  ]) {
    const ia = (((z + 32) % 32) * 32 + ((x + 32) % 32)) * 2,
      ib = (((z + 128) % 128) * 128 + ((x + 128) % 128)) * 2;
    assert.equal(a.initial[ia] / 32 ** 2, b.initial[ib] / 128 ** 2);
  }
  const c = defaults();
  Object.assign(c.graphics, PRESETS.mobile);
  const water = new OceanSurface(c);
  water.cascades[0].foam[12] = 0.7;
  const before = water.snapshot();
  for (let i = 0; i < 20; i++) water.sampleSurface(i, 17, { time: i / 10 });
  assert.deepEqual(water.snapshot(), before);
});
test('One second of ordinary playback and exact fixed steps have the same water, motion and encounter state', () => {
  const r = recipe(),
    a = createWaterScene(r, defaults()),
    b = createWaterScene(r, defaults());
  a.paused = b.paused = false;
  for (let i = 0; i < 60; i++) a.update(1 / 60);
  for (let i = 0; i < 30; i++) b.update(WATER_STEP);
  assert.equal(a.physicsTicks, b.physicsTicks);
  assert.deepEqual(a.snapshot(), b.snapshot());
  const saved = a.snapshot(),
    c = createWaterScene(r, defaults());
  c.restoreEncounter(saved.encounter);
  assert.ok(Math.abs(c.water.phase - a.water.phase) < 1e-9);
  a.dispose();
  b.dispose();
  c.dispose();
});

test('A single analytic mode has the expected geometric normal and phase velocity', () => {
  const c = defaults();
  Object.assign(c.graphics, PRESETS.mobile);
  c.ocean.windSpeed = 0;
  c.ocean.waveHeight = 1;
  c.ocean.choppiness = 0;
  for (let i = 1; i <= 6; i++) c.waterWaves[`swell${i}Enabled`] = i === 1;
  Object.assign(c.waterWaves, { swell1Length: 100, swell1Amplitude: 0.5, swell1Direction: 90 });
  const water = new OceanSurface(c),
    out = water.sampleSurface(0, 0, { local: false });
  const k = (2 * Math.PI) / 100,
    slope = 0.5 * k;
  assert.equal(out.height, 0);
  assert.ok(Math.abs(out.normal.x + slope / Math.hypot(slope, 1)) < 1e-9);
  assert.ok(Math.abs(out.surfaceVerticalVelocity + 0.5 * Math.sqrt(9.81 * k)) < 1e-9);
  assert.equal(out.jacobian, 1);
});

test('A positive Fourier wavevector travels toward its heading and compresses the crest', () => {
  const cascade = new SpectralCascade(128, 64, 0);
  cascade.initial.fill(0);
  cascade.initial[2] = 64 ** 2 / 2;
  const k = (2 * Math.PI) / 128,
    time = 0.5,
    crest = (Math.sqrt(9.81 * k) / k) * time;
  cascade.evaluate(time, 1);
  assert.ok(cascade.sample(cascade.displacement, crest, 0) > 0.995);
  assert.ok(cascade.sample(cascade.normals, crest, 0, 2) > 0.04);
  assert.ok(cascade.sample(cascade.normals, crest + 64, 0, 2) < -0.04);
});

test('Positive pitch raises the bow and positive roll raises starboard at north and east headings', () => {
  const sim = createWaterScene(recipe(), defaults());
  for (const heading of [0, Math.PI / 2]) {
    const rotation = sim.quaternion(heading, 0.05, 0.04),
      quaternion = new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
    const bow = new Vector3(0, 0, -30).applyQuaternion(quaternion),
      side = new Vector3(3, 0, 0).applyQuaternion(quaternion);
    assert.ok(Math.abs(bow.y - 30 * Math.sin(0.05)) < 1e-9);
    assert.ok(Math.abs(side.y - 3 * Math.sin(0.04) * Math.cos(0.05)) < 1e-9);
  }
  sim.dispose();
});

test('Wind transitions complete with a frozen base phase, and render interpolation does not age the field', () => {
  const c = defaults();
  Object.assign(c.graphics, PRESETS.mobile);
  const water = new OceanSurface(c);
  water.freezePhase = true;
  c.ocean.windDirection = 90;
  water.ensure();
  water.advanceTime(2.1);
  water.ensure();
  assert.equal(water.transition, null);
  assert.equal(water.phase, 0);
  const field = water.interactions;
  field.recenter(0, 0);
  field.previousData.set(field.data);
  field.stamp(0, 0, 5, 0, 1);
  field.pack();
  const saved = field.snapshot(),
    version = field.version,
    now = field.data[field.data.length / 2 + field.resolution * 2 + 3];
  assert.equal(field.render(0.5)[field.data.length / 2 + field.resolution * 2 + 3], now * 0.5);
  assert.deepEqual(field.snapshot(), saved);
  assert.equal(field.version, version);
});

test('Wind/seed transitions preserve the edit instant and remain bounded when interrupted', () => {
  const c = defaults();
  Object.assign(c.graphics, PRESETS.mobile);
  const water = new OceanSurface(c);
  water.advanceTime(4);
  const before = water.sample(17, 29);
  c.ocean.windSpeed = 17;
  c.ocean.windDirection = 90;
  assert.ok(Math.abs(water.sample(17, 29) - before) < 0.00001);
  water.advanceTime(0.5);
  water.ensure();
  const intermediate = water.sample(17, 29);
  c.waterWaves.seed = 999;
  assert.ok(Math.abs(water.sample(17, 29) - intermediate) < 0.00001);
  for (let i = 0; i < 75; i++) {
    water.advanceTime(WATER_STEP);
    assert.ok(Math.abs(water.sample(17, 29)) < 10);
  }
  assert.equal(water.transition, null);
});

test('Every supported local field remains stable at the maximum propagation, diffusion and transport settings', () => {
  for (const resolution of [128, 256, 512]) {
    const field = new WaterInteractions(resolution);
    field.recenter(0, 0);
    field.disturb(0, 0, 5, 1, 1);
    const settings = { propagation: 12, diffusion: 1, damping: 0.2 };
    let initialEnergy = 0,
      finalEnergy = 0;
    for (const value of field.velocity) initialEnergy += value * value;
    for (let i = 0; i < 60; i++) field.step(WATER_STEP, 45, 1.5, 0.8, settings);
    for (const value of field.velocity) {
      assert.ok(Number.isFinite(value));
      finalEnergy += value * value;
    }
    assert.ok(finalEnergy < initialEnergy * 1.5);
    assert.ok(field.courant <= 0.5);
    assert.ok(field.foam.every((value) => Number.isFinite(value) && value >= 0 && value <= 1.5));
    assert.ok(field.foamAge.some((age) => age > 1));
    const age = field.sample(0, 0, 'age');
    field.recenter(12, 15);
    assert.ok(Math.abs(field.sample(0, 0, 'age') - age) < 1e-5);
  }
});

test('Distributed support settles at the scaled-mass equilibrium and distinguishes head from beam seas', () => {
  const r = recipe();
  r.tuning.ocean.waveHeight = 0;
  r.tuning.ocean.windSpeed = 0;
  const flat = createWaterScene(r, defaults());
  flat.paused = false;
  flat.body.setLinvel({ x: 0, y: 3, z: 0 }, true);
  for (let i = 0; i < 300; i++) flat.update(WATER_STEP);
  assert.ok(Math.abs(flat.body.translation().y + 2) < 0.02);
  assert.equal(flat.body.mass(), 750);
  flat.dispose();
  for (const direction of [0, 90]) {
    const waveRecipe = recipe();
    waveRecipe.tuning.ocean.windSpeed = 0;
    waveRecipe.tuning.ocean.waveHeight = 2;
    for (let i = 1; i <= 6; i++) waveRecipe.tuning.waterWaves[`swell${i}Enabled`] = i === 1;
    waveRecipe.tuning.waterWaves.swell1Direction = direction;
    const sim = createWaterScene(waveRecipe, defaults());
    sim.paused = false;
    let pitch = 0,
      roll = 0;
    for (let i = 0; i < 300; i++) {
      sim.update(WATER_STEP);
      pitch = Math.max(pitch, Math.abs(sim.waterMotion.pitch));
      roll = Math.max(roll, Math.abs(sim.waterMotion.roll));
    }
    assert.ok(direction === 0 ? pitch > roll * 10 + 0.005 : roll > pitch * 10 + 0.005);
    sim.p.depth = sim.p.targetDepth = 80;
    sim.body.setTranslation({ x: 0, y: -82, z: 0 }, true);
    for (let i = 0; i < 300; i++) sim.update(WATER_STEP);
    assert.ok(Math.abs(sim.waterMotion.pitch) < 0.001 && Math.abs(sim.waterMotion.roll) < 0.001);
    assert.ok(Math.abs(sim.body.translation().y + 82) < 0.02);
    sim.dispose();
  }
});

test('Recipes reconstruct nonzero initial clocks, hull pose, nearby ships and quantized water memory', () => {
  const r = recipe(),
    sim = createWaterScene(r, defaults());
  sim.paused = false;
  sim.addShip(sim.p.x + 120, sim.p.z - 150, 1.2, false, -55);
  for (let i = 0; i < 90; i++) sim.update(WATER_STEP);
  r.initial = initialWaterConditions(sim);
  r.duration = 0;
  const validated = validateWaterRecipe(JSON.parse(JSON.stringify(r))),
    restored = createWaterScene(validated, defaults());
  assert.equal(restored.p.time, sim.p.time);
  assert.equal(restored.water.phase, sim.water.phase);
  assert.equal(restored.ships[0].id, sim.ships[0].id);
  assert.equal(restored.ships[0].seed, -55);
  assert.equal(restored.ships[0].x, sim.ships[0].x);
  assert.ok(Math.abs(restored.body.translation().y - sim.body.translation().y) < 1e-6);
  assert.ok(
    Math.abs(
      restored.water.interactions.sample(sim.oceanX, sim.p.z, true) -
        sim.water.interactions.sample(sim.oceanX, sim.p.z, true),
    ) < 0.006,
  );
  const malformed = JSON.parse(JSON.stringify(r));
  malformed.initial.localWater.ages = 'bad';
  assert.throws(() => validateWaterRecipe(malformed));
  sim.dispose();
  restored.dispose();
});

test('A crossing recipe with explicit ships preserves moving wake sources', () => {
  const r = recipe();
  r.scenario = 'crossing';
  const original = createWaterScene(r, defaults());
  r.initial = initialWaterConditions(original);
  const restored = createWaterScene(validateWaterRecipe(r), defaults());
  for (const ship of restored.ships) assert.ok(restored.effectiveShipSpeed(ship) > 0);
  original.dispose();
  restored.dispose();
});

test('Persistent crest foam advects east with the configured current and decays without creating mass', () => {
  const config = defaults();
  Object.assign(config.graphics, PRESETS.mobile);
  Object.assign(config.waterInteraction, {
    whitecapGain: 0,
    coverageCap: 1,
    whitecapDecay: 15,
    windDrift: 0,
    currentSpeed: 1.5,
    currentDirection: 90,
  });
  const water = new OceanSurface(config),
    band = water.cascades[2],
    n = band.resolution;
  band.foam[8 * n + 8] = 1;
  water.advanceFoam(1);
  let mass = 0,
    xMoment = 0,
    zMoment = 0;
  for (let i = 0; i < band.foam.length; i++) {
    mass += band.foam[i];
    xMoment += (i % n) * band.foam[i];
    zMoment += Math.floor(i / n) * band.foam[i];
  }
  assert.ok(Math.abs(mass - Math.exp(-1 / 15)) < 1e-6);
  assert.ok(Math.abs(((xMoment / mass - 8) * band.size) / n - 1.5) < 1e-6);
  assert.ok(Math.abs(zMoment / mass - 8) < 1e-6);
});
