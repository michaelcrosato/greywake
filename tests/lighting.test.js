import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaults } from '../src/config.js';
import { sunlight, worldClock } from '../src/lighting.js';
import { newCareer } from '../src/simulation.js';
import { DEG } from '../src/world.js';

test('Day length and the displayed clock share the same solar progression', () => {
  const c = defaults(),
    p = newCareer();
  assert.equal(worldClock(p, c).text, '16:24');
  p.time = c.ocean.dayMinutes * 60;
  assert.equal(worldClock(p, c).day, 2);
  assert.equal(worldClock(p, c).text, '16:24');
});
test('Sunrise is east, sunset is west, and southern-hemisphere noon faces north', () => {
  assert.ok(sunlight(6, 49).x > 0.99);
  assert.ok(sunlight(18, 49).x < -0.99);
  assert.ok(sunlight(12, 49).z > 0);
  assert.ok(sunlight(12, -35).z < 0);
});
test('Local solar hour follows longitude without jumping at the date line', () => {
  const c = defaults(),
    p = newCareer();
  p.x = 180 * DEG - 1;
  const a = worldClock(p, c).hour;
  p.x = -180 * DEG + 1;
  const b = worldClock(p, c).hour;
  assert.ok(Math.abs(a - b) < 0.001);
});
