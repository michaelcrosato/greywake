import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaults } from '../src/config.js';
import { initPhysics, restoreCareer, Simulation } from '../src/simulation.js';

await initPhysics();
function fixture() {
  const c = defaults();
  c.world.maxShips = 4;
  c.combat.repairRate = 0;
  c.combat.enemyDamage = 0;
  c.world.merchantEvasion = false;
  const s = new Simulation(c);
  s.debug('clear');
  s.p.throttle = 0;
  s.p.speed = 0;
  return s;
}
const advance = (s, seconds) => {
  for (let i = 0; i < seconds * 30; i++) s.update(1 / 30);
};
test('A distress call sends an escort to the attack site without revealing a quiet captain’s position', () => {
  const s = fixture();
  s.p.depth = s.p.targetDepth = 120;
  const merchant = s.addShip(s.p.x + 2000, s.p.z - 1700, 0),
    escort = s.addShip(s.p.x + 2600, s.p.z - 1500, 0, true);
  s.hitShip(merchant, 10);
  assert.equal(escort.state, 'investigate');
  assert.equal(escort.track.x, merchant.x);
  assert.notEqual(escort.track.x, s.p.x);
  advance(s, 1);
  assert.equal(s.detected, false);
  assert.equal(s.searching, true);
  const data = s.snapshot(),
    r = new Simulation(s.config, restoreCareer(data.career), { encounter: data.encounter });
  assert.equal(r.ships.find((v) => v.id === escort.id).track.x, escort.track.x);
  r.dispose();
  s.dispose();
});
test('An escort loses a deep quiet signature and searches the last observed position until its memory expires', () => {
  const s = fixture(),
    escort = s.addShip(s.p.x + 600, s.p.z - 100, 0, true);
  s.config.combat.searchMemory = 3;
  s.config.ai.reactionDelay = 0;
  advance(s, 1);
  assert.equal(s.detected, true);
  assert.equal(escort.state, 'hunt');
  const location = { x: escort.track.x, z: escort.track.z };
  s.p.depth = s.p.targetDepth = 150;
  advance(s, 1.2);
  assert.equal(s.detected, false);
  assert.equal(escort.state, 'search');
  assert.equal(escort.track.x, location.x);
  advance(s, 4);
  assert.ok(['patrol', 'screen'].includes(escort.state));
  assert.equal(escort.track, null);
  s.dispose();
});
test('Merchant evasion changes course after damage and remains configurable', () => {
  const s = fixture();
  s.config.world.merchantEvasion = true;
  const ship = s.addShip(s.p.x + 700, s.p.z - 900, 0);
  s.hitShip(ship, 10);
  advance(s, 5);
  assert.ok(Math.abs(ship.heading) > 0.1);
  s.config.world.merchantEvasion = false;
  advance(s, 8);
  assert.ok(Math.abs(ship.heading) < 0.01);
  s.dispose();
});
test('Deck-gun lead hits steady shipping but can miss a ship that changes course after the shot', () => {
  const s = fixture();
  s.config.combat.gunDispersion = 0;
  s.config.combat.shellSpeed = 100;
  s.config.world.merchantSpeed = 30;
  const ship = s.addShip(s.p.x + 300, s.p.z - 400, 0);
  s.targetId = ship.id;
  assert.equal(s.fireGun(), true);
  ship.heading = ship.baseHeading = Math.PI / 2;
  advance(s, 8);
  assert.equal(ship.hp, ship.maxHp);
  assert.ok(s.p.log.some((e) => e.text.includes('Shell fell wide')));
  assert.equal(s.fireGun(), true);
  advance(s, 12);
  assert.equal(ship.hp, ship.maxHp - s.config.combat.gunDamage * s.damageMultiplier());
  s.dispose();
});
test('Passing within 65 m causes no invisible collision damage; actual Rapier hull contact does', () => {
  const s = fixture();
  s.config.world.merchantSpeed = 0;
  const ship = s.addShip(s.p.x + 45, s.p.z, 0);
  advance(s, 1);
  assert.equal(s.p.hp, 120);
  ship.x = s.p.x;
  ship.z = s.p.z - 15;
  s.p.speed = 5;
  s.p.throttle = 0.7;
  advance(s, 0.2);
  assert.ok(s.p.hp < 120);
  assert.ok(s.p.log.some((e) => e.text.includes('Hull contact')));
  s.dispose();
});
