import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaults, PRESETS } from '../src/config.js';
import { developerDefaults, openWaterNear, validateDeveloper } from '../src/developer-settings.js';
import { initPhysics, newCareer, restoreCareer, Simulation } from '../src/simulation.js';
import { DEG, deltaX, distance, isLand, PORTS } from '../src/world.js';

await initPhysics();
function simulation() {
  const config = defaults();
  Object.assign(config.graphics, PRESETS.mobile);
  const sim = new Simulation(config, newCareer(), { ambientTraffic: false });
  return sim;
}
const advance = (sim, seconds) => {
  for (let i = 0; i < seconds * 30; i++) sim.update(1 / 30);
};
test('Developer options validate imports and do not affect normal play while disabled', () => {
  assert.deepEqual(validateDeveloper(null), developerDefaults());
  const valid = validateDeveloper({
    enabled: 'true',
    invulnerable: 1,
    speedMultiplier: Infinity,
    maneuverMultiplier: 999,
  });
  assert.equal(valid.enabled, false);
  assert.equal(valid.invulnerable, false);
  assert.equal(valid.speedMultiplier, 1);
  assert.equal(valid.maneuverMultiplier, 10);
  const sim = simulation(),
    normal = sim.speedLimit();
  sim.setDeveloper({ invulnerable: true, speedMultiplier: 20, noClip: true });
  assert.equal(sim.speedLimit(), normal);
  assert.equal(sim.hullCollider.isSensor(), false);
  sim.hurt(20);
  assert.equal(sim.p.hp, 100);
  sim.dispose();
});
test('Developer movement and maneuvers are faster, and disabling restores normal limits', () => {
  const sim = simulation(),
    normal = sim.speedLimit();
  sim.setDeveloper({ enabled: true, speedMultiplier: 8, maneuverMultiplier: 4, infiniteResources: true });
  assert.equal(sim.speedLimit(), normal * 8);
  assert.equal(sim.body.isCcdEnabled(), true);
  sim.p.throttle = 1;
  sim.p.targetDepth = 12;
  sim.rudder = 1;
  advance(sim, 1);
  assert.ok(sim.p.speed > 7);
  assert.ok(sim.p.depth > 6);
  assert.ok(sim.p.heading > 0.3);
  sim.p.speed = 120;
  sim.setDeveloper({ enabled: false });
  assert.ok(sim.p.speed <= sim.speedLimit());
  assert.equal(sim.body.isCcdEnabled(), false);
  sim.dispose();
});
test('Invulnerability blocks enemy, collision and pressure damage and can recover a lost boat', () => {
  const sim = simulation();
  sim.p.hp = 0;
  sim.setDeveloper({ enabled: true, invulnerable: true });
  assert.equal(sim.p.hp, sim.maxHp());
  for (const kind of ['enemy', 'collision', 'pressure']) sim.hurt(999, kind);
  assert.equal(sim.p.hp, sim.maxHp());
  assert.ok(sim.aiDamage > 0);
  sim.setDeveloper({ enabled: false });
  sim.hurt(10);
  assert.equal(sim.p.hp, 110);
  sim.dispose();
});
test('Resource/ammo/reload aids operate on real movement and real weapon launches', () => {
  const sim = simulation();
  sim.setDeveloper({ enabled: true, infiniteResources: true, infiniteAmmo: true, noReload: true });
  const ship = sim.addShip(sim.p.x + 300, sim.p.z - 450, 0, false, 12);
  sim.targetId = ship.id;
  sim.p.torpedoes = sim.p.shells = 0;
  sim.cooldown = sim.gunCooldown = 20;
  assert.equal(sim.weaponReadiness('torpedo').ready, true);
  assert.equal(sim.fireTorpedo(), true);
  assert.equal(sim.fireTorpedo(), true);
  assert.equal(sim.fireGun(), true);
  assert.equal(sim.p.torpedoes, 0);
  assert.equal(sim.p.shells, 0);
  assert.equal(sim.cooldown, 0);
  assert.equal(sim.gunCooldown, 0);
  sim.p.depth = sim.p.targetDepth = 12;
  sim.p.fuel = sim.p.battery = sim.p.oxygen = 0;
  advance(sim, 1);
  assert.equal(sim.p.fuel, 100);
  assert.equal(sim.p.battery, 100);
  assert.equal(sim.p.oxygen, 100);
  sim.setDeveloper({ enabled: false });
  assert.equal(sim.weaponReadiness('torpedo').ready, false);
  sim.dispose();
});
test('Teleport validates destination, rebases physics, clears old effects and can retain selected ships', () => {
  const sim = simulation();
  assert.throws(() => sim.developerTeleport(0, 0), /Enable/);
  sim.setDeveloper({ enabled: true, pauseTraffic: true });
  assert.throws(() => sim.developerTeleport(0, 90 * DEG), /valid/);
  const land = { x: 10 * DEG, z: 0 };
  assert.equal(isLand(land.x, land.z), true);
  assert.throws(() => sim.developerTeleport(land.x, land.z), /land/);
  const target = sim.addShip(sim.p.x + 300, sim.p.z - 500, 0, false, 22);
  sim.targetId = target.id;
  sim.fireTorpedo();
  sim.p.auto = true;
  sim.waterImpact('shell', sim.p.x, sim.p.z);
  sim.developerTeleport(target.x - 350, target.z, 12, 1, true);
  assert.equal(sim.target().id, target.id);
  assert.equal(sim.torpedoes.length, 0);
  assert.equal(sim.effects.length, 0);
  assert.equal(sim.water.impacts.length, 0);
  assert.equal(sim.p.auto, false);
  assert.equal(sim.p.speed, 0);
  assert.equal(sim.p.depth, 12);
  assert.deepEqual({ ...sim.body.translation() }, { x: 0, y: -14, z: 0 });
  assert.ok(Math.abs(target.body.translation().x - deltaX(target.x, sim.p.x)) < 0.01);
  sim.developerTeleport(PORTS[2].x, PORTS[2].z, 0, 0);
  assert.equal(distance(sim.p, PORTS[2]), 0);
  assert.equal(sim.ships.length, 0);
  assert.equal(sim.targetId, null);
  sim.setDeveloper({ noClip: true });
  sim.developerTeleport(land.x, land.z);
  assert.equal(sim.hullCollider.isSensor(), true);
  sim.dispose();
});
test('Paused stepping advances exact simulation time/physics, and frozen enemies stay put', () => {
  const sim = simulation();
  sim.setDeveloper({ enabled: true, freezeEnemies: true });
  const ship = sim.addShip(sim.p.x + 300, sim.p.z - 500, 0, true, 1),
    start = { x: ship.x, z: ship.z, state: ship.state };
  sim.paused = true;
  const time = sim.p.time,
    ticks = sim.physicsTicks;
  assert.equal(sim.developerStep(1), true);
  assert.ok(Math.abs(sim.p.time - time - 1) < 1e-8);
  assert.equal(sim.physicsTicks, ticks + 30);
  assert.equal(sim.paused, true);
  assert.deepEqual({ x: ship.x, z: ship.z, state: ship.state }, start);
  sim.setDeveloper({ freezeEnemies: false });
  sim.developerStep(1);
  assert.notEqual(ship.z, start.z);
  sim.dispose();
});
test('Combat time compression remains physical and is bounded at 20x; normal mode retains slowdown', () => {
  const sim = simulation();
  sim.addShip(sim.p.x + 350, sim.p.z - 500, 0, true, 1);
  assert.equal(sim.setAcceleration(20), false);
  sim.setDeveloper({ enabled: true, combatTime: true });
  assert.equal(sim.setAcceleration(1000), true);
  assert.equal(sim.acceleration, 20);
  const ticks = sim.physicsTicks;
  sim.update(0.1);
  assert.equal(sim.acceleration, 20);
  assert.ok(sim.physicsTicks - ticks >= 60);
  sim.setDeveloper({ enabled: false });
  assert.equal(sim.acceleration, 1);
  sim.dispose();
});
test('Developer settings and high speeds persist through saves; legacy snapshots default to normal mode', () => {
  const sim = simulation();
  sim.setDeveloper({ enabled: true, invulnerable: true, noClip: true, speedMultiplier: 20 });
  sim.p.speed = 220;
  const snapshot = sim.snapshot();
  const restored = new Simulation(snapshot.config, restoreCareer(snapshot.career), {
    encounter: snapshot.encounter,
    ambientTraffic: false,
  });
  assert.deepEqual(restored.developer, sim.developer);
  assert.equal(restored.p.speed, 220);
  assert.equal(restored.hullCollider.isSensor(), true);
  delete snapshot.encounter.developer;
  delete snapshot.encounter.developerSpeed;
  const legacy = new Simulation(snapshot.config, restoreCareer(snapshot.career), {
    encounter: snapshot.encounter,
    ambientTraffic: false,
  });
  assert.deepEqual(legacy.developer, developerDefaults());
  sim.dispose();
  restored.dispose();
  legacy.dispose();
});

test('Every harbor playtest jump has a navigable offshore destination', () => {
  for (const port of PORTS) {
    const point = openWaterNear(port);
    assert.equal(isLand(point.x, point.z), false);
    assert.ok(distance(point, port) <= 2500000);
  }
});

test('Weapons use the effective stationary velocity of frozen targets', () => {
  const sim = simulation();
  sim.setDeveloper({ enabled: true, freezeEnemies: true, noReload: true });
  const ship = sim.addShip(sim.p.x + 300, sim.p.z - 300, Math.PI / 2, false, 9);
  sim.targetId = ship.id;
  const bearing = Math.atan2(ship.x - sim.p.x, sim.p.z - ship.z);
  assert.ok(Math.abs(sim.intercept(ship, sim.config.combat.torpedoSpeed).heading - bearing) < 1e-6);
  assert.equal(sim.fireGun(), true);
  advance(sim, 3);
  assert.ok(ship.hp < ship.maxHp);
  sim.dispose();
});
