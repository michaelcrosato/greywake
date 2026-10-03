import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaults, PRESETS } from '../src/config.js';
import { initPhysics, newCareer, restoreCareer, Simulation } from '../src/simulation.js';
import {
  hullWaterPose,
  newWaterMotion,
  OceanSurface,
  SpectralCascade,
  WaterInteractions,
} from '../src/water-surface.js';
import { DEG, wrapX } from '../src/world.js';

await initPhysics();
const config = () => {
  const c = defaults();
  Object.assign(c.graphics, PRESETS.mobile);
  return c;
};

test('The inverse FFT reconstructs a known Fourier mode and seeded spectra contain finite wave energy', () => {
  const cascade = new SpectralCascade(128, 32);
  cascade.work.fill(0);
  cascade.work[2] = (32 * 32) / 2;
  cascade.work[(32 - 1) * 2] = (32 * 32) / 2;
  cascade.inverse();
  for (let x = 0; x < 32; x++)
    assert.ok(Math.abs(cascade.work[x * 2] - Math.cos((x / 32) * Math.PI * 2)) < 1e-8);
  cascade.evaluate(4);
  assert.ok(cascade.height.every(Number.isFinite));
  assert.ok(Math.max(...cascade.height) - Math.min(...cascade.height) > 1);
  assert.ok(Math.abs(cascade.height.reduce((a, b) => a + b, 0) / cascade.height.length) < 1e-6);
  const same = new SpectralCascade(128, 32);
  same.evaluate(4);
  assert.deepEqual(cascade.displacement, same.displacement);
});

test('Wind changes wave direction and spectrum frames blend continuously across their update boundary', () => {
  const a = new OceanSurface(config()),
    c = config();
  c.ocean.windDirection = 90;
  const b = new OceanSurface(c);
  a.ensure(2);
  b.ensure(2);
  assert.notDeepEqual(a.cascades[1].height, b.cascades[1].height);
  const left = a.sample(17, 29, 2.99999),
    right = a.sample(17, 29, 3.00001);
  assert.ok(Math.abs(right - left) < 0.002);
});

test('Wake foam stays at its world position through scrolling and decays rather than following a new heading', () => {
  const field = new WaterInteractions(128, 384);
  field.recenter(10000, -20000);
  field.stamp(10000, -20000, 8, 2, 1);
  field.step(1 / 30);
  const before = field.sample(10000, -20000, true);
  field.recenter(10030, -19970);
  assert.ok(Math.abs(field.sample(10000, -20000, true) - before) < 1e-5);
  for (let i = 0; i < 120; i++) field.step(1 / 30, 8);
  assert.ok(field.sample(10000, -20000, true) < before);
  assert.ok(field.height.every(Number.isFinite));
  assert.ok(Math.max(...field.height) < 2);
});

test('Water memory round-trips compactly and rejects malformed binary snapshots', () => {
  const field = new WaterInteractions(128);
  field.recenter(1200, 3000);
  field.stamp(1212, 3006, 5, 1, 0.8);
  field.step(1 / 30);
  const raw = JSON.parse(JSON.stringify(field.snapshot())),
    restored = new WaterInteractions(128);
  assert.ok(raw.data.length < 120000);
  assert.equal(restored.restore(raw), true);
  assert.ok(Math.abs(field.sample(1212, 3006) - restored.sample(1212, 3006)) < 0.0001);
  assert.ok(Math.abs(field.sample(1212, 3006, true) - restored.sample(1212, 3006, true)) < 0.006);
  assert.equal(restored.restore({ ...raw, data: 'invalid' }), false);
  assert.equal(restored.restore({ ...raw, resolution: 4096 }), false);
});

test('Hull pitch and roll follow the direction of the sampled water and settle when the sea becomes flat', () => {
  const motion = newWaterMotion(),
    hull = { x: 0, z: 0, heading: 0, depth: 0 },
    sim = { sampleWater: (x, z) => x * 0.04 - z * 0.02 };
  for (let i = 0; i < 300; i++) hullWaterPose(sim, hull, 66, 6, motion, 1 / 30);
  assert.ok(motion.pitch < -0.01);
  assert.ok(motion.roll > 0.02);
  sim.sampleWater = () => 0;
  for (let i = 0; i < 600; i++) hullWaterPose(sim, hull, 66, 6, motion, 1 / 30);
  assert.ok(Math.abs(motion.pitch) < 0.0001);
  assert.ok(Math.abs(motion.roll) < 0.0001);
});

test('A stopped surfaced boat still creates contact foam and wetness as waves meet its hull', () => {
  const s = new Simulation(config(), newCareer(), { training: true });
  s.p.throttle = s.p.speed = 0;
  for (let i = 0; i < 90; i++) s.update(1 / 30);
  assert.ok(s.water.interactions.foam.some((f) => f > 0.01));
  assert.ok(s.waterMotion.wetness > 0);
  assert.ok(Number.isFinite(s.waterMotion.pitch) && Number.isFinite(s.waterMotion.roll));
  s.dispose();
});

test('Water impacts retain their position, kind and depth; deep charges disturb the surface less', () => {
  const surface = new OceanSurface(config());
  surface.interactions.recenter(0, 0);
  surface.impact(0, 0, 'depth-charge', 1, 0);
  const baseline = new OceanSurface(config()),
    shallow = surface.sample(12, 0, 0.6) - baseline.sample(12, 0, 0.6);
  const deep = new OceanSurface(config());
  deep.interactions.recenter(0, 0);
  deep.impact(0, 0, 'depth-charge', 1, 100);
  assert.ok(Math.abs(deep.sample(12, 0, 0.6) - baseline.sample(12, 0, 0.6)) < Math.abs(shallow) * 0.05);
  const s = new Simulation(config(), newCareer(), { training: true });
  s.waterImpact('shell', s.p.x + 15, s.p.z - 20, 0, 1);
  const e = s.effects.at(-1);
  assert.equal(e.kind, 'shell');
  assert.equal(e.x, s.p.x + 15);
  assert.equal(e.depth, 0);
  const raw = JSON.parse(JSON.stringify(s.snapshot()));
  const r = new Simulation(config(), restoreCareer(raw.career), { encounter: raw.encounter });
  assert.equal(r.effects.at(-1).kind, 'shell');
  assert.equal(r.effects.at(-1).z, s.p.z - 20);
  s.dispose();
  r.dispose();
});

test('Spectral sampling and persistent wake coordinates remain continuous across the date line', () => {
  const c = config(),
    p = newCareer();
  p.x = 180 * DEG - 1;
  p.z = -25 * DEG;
  const s = new Simulation(c, p, { training: true });
  s.visualTime = 3;
  s.water.interactions.recenter(s.oceanX, p.z);
  s.water.interactions.stamp(s.oceanX + 2, p.z, 4, 0, 1);
  const point = wrapX(p.x + 2),
    before = s.sampleWater(point, p.z);
  s.oceanX += 2;
  s.p.x = point;
  const after = s.sampleWater(point, p.z);
  assert.ok(Math.abs(after - before) < 1e-8);
  const data = s.snapshot(),
    r = new Simulation(c, restoreCareer(data.career), { encounter: data.encounter });
  assert.ok(Math.abs(r.sampleWater(point, p.z) - after) < 0.0001);
  s.dispose();
  r.dispose();
});

test('A distant torpedo impact produces a wave beyond the local field and survives a career save', () => {
  const s = new Simulation(config(), newCareer(), { training: true }),
    x = s.p.x + 600,
    z = s.p.z;
  s.waterImpact('torpedo', x, z, 2.5, 1);
  s.visualTime = 0.6;
  const withWave = s.sampleWater(x + 12, z),
    saved = s.snapshot();
  const r = new Simulation(config(), restoreCareer(saved.career), { encounter: saved.encounter });
  assert.ok(Math.abs(r.sampleWater(x + 12, z) - withWave) < 0.0001);
  s.water.impacts = [];
  assert.ok(Math.abs(withWave - s.sampleWater(x + 12, z)) > 0.05);
  s.dispose();
  r.dispose();
});

test('Repeated conservative wake disturbances do not raise the average water level', () => {
  const field = new WaterInteractions(128);
  field.recenter(0, 0);
  for (let i = 0; i < 60; i++) {
    field.disturb(0, 0, 6, 0.2, 0.1);
    field.step(1 / 30);
  }
  const mean = field.height.reduce((a, b) => a + b, 0) / field.height.length;
  assert.ok(Math.abs(mean) < 0.0003);
});
