import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaults } from '../src/config.js';
import { initPhysics, newCareer, Simulation } from '../src/simulation.js';
import { DEG, geo, wrapCellX, wrapX } from '../src/world.js';

await initPhysics();
test('The date-line seam shares canonical shipping cells on both sides of the world', () => {
  const c = defaults();
  c.world.maxShips = 64;
  c.world.trafficDensity = 0.2;
  const a = newCareer(),
    b = newCareer();
  Object.assign(a, geo(179.99, 25), { time: 1000 });
  Object.assign(b, geo(-179.99, 25), { time: 1000 });
  const left = new Simulation(c, a),
    right = new Simulation(c, b);
  assert.equal(wrapCellX(3330), -3330);
  assert.equal(wrapCellX(-3331), 3329);
  assert.ok([...left.streamed].filter((key) => right.streamed.has(key)).length > 5);
  for (const key of [...left.streamed, ...right.streamed]) {
    const x = Number(key.split(',')[0]);
    assert.ok(x >= -3330 && x < 3330);
  }
  left.dispose();
  right.dispose();
});
test('Wave sampling stays continuous when longitude wraps through the date line', () => {
  const c = defaults(),
    p = newCareer();
  p.x = 180 * DEG - 1;
  p.z = -25 * DEG;
  const s = new Simulation(c, p, { training: true });
  s.visualTime = 30;
  const point = wrapX(p.x + 2),
    before = s.sampleWater(point, p.z);
  s.oceanX += 2;
  s.p.x = point;
  const after = s.sampleWater(point, p.z);
  assert.ok(Math.abs(after - before) < 1e-8);
  assert.equal(s.oceanX, 180 * DEG + 1);
  const data = s.snapshot();
  assert.equal(data.encounter.oceanX, s.oceanX);
  s.dispose();
});
