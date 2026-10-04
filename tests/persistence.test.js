import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaults, PRESETS } from '../src/config.js';
import { initPhysics, newCareer, restoreCareer, Simulation } from '../src/simulation.js';

await initPhysics();
const advance = (s, seconds) => {
  for (let i = 0; i < seconds * 30; i++) s.update(1 / 30);
};
test('An encounter snapshot preserves damage, target lock, ammunition, and a torpedo already in flight', () => {
  const c = defaults();
  c.world.maxShips = 1;
  c.combat.enemyDamage = 0;
  c.world.merchantEvasion = false;
  const s = new Simulation(c);
  s.debug('clear');
  const target = s.addShip(s.p.x + 300, s.p.z - 450, 1.1, false, -12345);
  s.targetId = target.id;
  s.hitShip(target, 25);
  s.fireTorpedo();
  advance(s, 3);
  const data = JSON.parse(JSON.stringify(s.snapshot()));
  const r = new Simulation(c, restoreCareer(data.career), { encounter: data.encounter });
  assert.equal(r.target().id, target.id);
  assert.equal(r.target().hp, target.hp);
  assert.equal(r.target().length, target.length);
  assert.equal(r.p.torpedoes, s.p.torpedoes);
  assert.equal(r.torpedoes.length, 1);
  assert.equal(r.torpedoes[0].life, s.torpedoes[0].life);
  assert.equal(r.visualTime, s.visualTime);
  assert.equal(r.weather, s.weather);
  assert.deepEqual([...r.streamed], [...s.streamed]);
  advance(s, 30);
  advance(r, 30);
  assert.equal(r.target().hp, s.target().hp);
  assert.equal(r.torpedoes.length, 0);
  assert.equal(r.target().hp, 27);
  s.fireTorpedo();
  r.fireTorpedo();
  advance(s, 40);
  advance(r, 40);
  assert.equal(r.p.sunk, 1);
  assert.equal(r.p.sunk, s.p.sunk);
  assert.equal(r.p.bounty, s.p.bounty);
  s.dispose();
  r.dispose();
});
test('Legacy career files remain playable without an encounter snapshot', () => {
  const p = newCareer();
  p.skills.hunter = 1;
  p.bounty = 4500;
  const s = new Simulation(defaults(), restoreCareer(JSON.parse(JSON.stringify(p))));
  assert.equal(s.p.skills.hunter, 1);
  assert.equal(s.p.bounty, 4500);
  assert.ok(s.ships.length);
  s.dispose();
});
test('Malformed encounter rows are ignored, duplicate identifiers are rejected, and imported values are bounded', () => {
  const p = newCareer();
  const raw = {
    version: 1,
    ships: [
      null,
      {},
      { id: 1, x: Infinity, z: p.z },
      { id: 3, x: p.x + 300, z: p.z - 400, hp: 999999, maxHp: 130, seed: -55 },
      { id: 3, x: p.x + 600, z: p.z - 400 },
    ],
    torpedoes: [null, { id: 2, x: p.x, z: p.z, life: -1 }],
    streamed: ['invalid', '-4,5,0'],
    body: { y: Infinity, vy: Infinity },
    cooldown: 99999,
  };
  const s = new Simulation(defaults(), p, { encounter: raw });
  assert.equal(s.ships.length, 1);
  assert.equal(s.ships[0].hp, 130);
  assert.equal(s.ships[0].seed, -55);
  assert.equal(s.torpedoes.length, 0);
  assert.equal(s.cooldown, 120);
  assert.equal(s.body.translation().y, -2);
  assert.deepEqual([...s.streamed], ['-4,5,0']);
  s.dispose();
});

test('Ultra water exports fit the import budget and corrupt optional water memory preserves the career', () => {
  const config = defaults();
  Object.assign(config.graphics, PRESETS.ultra);
  const sim = new Simulation(config, newCareer(), { ambientTraffic: false });
  sim.p.bounty = 1234;
  sim.water.interactions.recenter(sim.oceanX, sim.p.z);
  sim.water.interactions.disturb(sim.oceanX, sim.p.z, 6, 1, 1);
  sim.water.interactions.pack();
  const saved = sim.snapshot();
  const exported = JSON.stringify(saved, null, 2);
  assert.ok(exported.length > 2e6 && exported.length < 4e6);
  const restored = new Simulation(config, restoreCareer(saved.career), { encounter: saved.encounter });
  assert.ok(Math.abs(restored.water.interactions.sample(sim.oceanX, sim.p.z, true) - 1) < 0.007);
  restored.dispose();
  saved.encounter.water.data = 'corrupt';
  saved.encounter.waterState.foam = ['bad', null, []];
  saved.encounter.waterState.wakes = [null, {}, ['bad', [null]]];
  const recovered = new Simulation(config, restoreCareer(saved.career), { encounter: saved.encounter });
  assert.equal(recovered.p.bounty, 1234);
  assert.ok(Number.isFinite(recovered.sampleWater(recovered.p.x, recovered.p.z)));
  recovered.dispose();
  sim.dispose();
});
