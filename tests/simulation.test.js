import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaults, validateConfig } from '../src/config.js';
import { initPhysics, newCareer, restoreCareer, Simulation } from '../src/simulation.js';
import {
  DEG,
  distance,
  geo,
  isLand,
  PORTS,
  planRoute,
  segmentClear,
  waveHeight,
  wrapX,
} from '../src/world.js';

await initPhysics();
test('Training worlds prevent damage and ambient spawns while retaining real controls and physics', () => {
  const s = new Simulation(defaults(), newCareer(), { training: true });
  assert.equal(s.ships.length, 0);
  const before = s.p.hp;
  s.hurt(1000);
  assert.equal(s.p.hp, before);
  s.dive(12);
  for (let i = 0; i < 300; i++) s.update(1 / 30);
  assert.equal(s.p.depth, 12);
  assert.equal(s.ships.length, 0);
  assert.ok(s.physicsTicks > 200);
  const target = s.addShip(s.p.x + 100, s.p.z - 300, 0);
  s.targetId = target.id;
  assert.equal(s.fireTorpedo(), true);
  assert.equal(s.p.torpedoes, 13);
  s.dispose();
});
function fixture() {
  const c = defaults();
  c.world.trafficDensity = 0.2;
  c.combat.enemyDamage = 0;
  const s = new Simulation(c);
  s.debug('clear');
  return s;
}
function run(s, seconds) {
  for (let i = 0; i < seconds * 30; i++) s.update(1 / 30);
}

test('Rapier propulsion and wave buoyancy remain finite, including after floating-origin rebasing', () => {
  const s = fixture();
  s.config.world.maxShips = 0;
  s.p.throttle = 1;
  run(s, 8);
  assert.ok(s.p.speed > 6);
  assert.ok(s.p.distance > 35);
  assert.ok(distance(s.p, newCareer()) > 35);
  const y = s.body.translation().y;
  assert.ok(Number.isFinite(y) && y > -10 && y < 4);
  assert.ok(s.physicsTicks > 200);
  const old = s.body.translation();
  s.p.x += 2000;
  s.body.setTranslation({ x: old.x + 2000, y, z: old.z }, true);
  s.rebase();
  assert.ok(Math.abs(s.body.translation().x) < 1);
  s.dispose();
});

test('Straight-running torpedoes intercept a moving merchant and award bounty, captain XP, and crew XP', () => {
  const s = fixture();
  s.config.world.maxShips = 1;
  s.config.combat.torpedoDamage = 200;
  s.p.throttle = 0;
  s.p.speed = 0;
  const target = s.addShip(s.p.x + 250, s.p.z - 400, Math.PI / 2);
  s.targetId = target.id;
  const money = s.p.bounty;
  assert.equal(s.fireTorpedo(), true);
  assert.equal(s.p.torpedoes, 13);
  assert.equal(s.fireTorpedo(), false);
  run(s, 30);
  assert.equal(target.hp, 0);
  assert.equal(s.p.sunk, 1);
  assert.ok(s.p.bounty > money);
  assert.ok(s.p.xp > 0);
  assert.ok(s.p.crewXp > 90);
  s.dispose();
});

test('Weapon depth gates and deck-gun damage work', () => {
  const s = fixture();
  s.config.world.maxShips = 1;
  const target = s.addShip(s.p.x, s.p.z - 500, 0);
  s.targetId = target.id;
  s.p.depth = 30;
  assert.equal(s.fireTorpedo(), false);
  assert.equal(s.fireGun(), false);
  s.p.depth = 0;
  s.p.targetDepth = 0;
  assert.equal(s.fireGun(), true);
  run(s, 2);
  assert.ok(target.hp < target.maxHp);
  assert.equal(s.p.shells, 79);
  s.dispose();
});

test('Captain branches enforce prerequisites and spend points; refits spend actual bounty and change stats', () => {
  const s = fixture();
  assert.equal(s.buySkill('tactician'), false);
  assert.equal(s.buySkill('hunter'), true);
  assert.equal(s.p.skillPoints, 0);
  assert.ok(s.damageMultiplier() > 1);
  s.awardXp(1500);
  assert.ok(s.p.level >= 3);
  assert.ok(s.p.skillPoints >= 2);
  assert.equal(s.buySkill('tactician'), true);
  const before = s.p.bounty;
  assert.equal(s.buyUpgrade('hull'), true);
  assert.equal(s.p.bounty, before - 900);
  assert.equal(s.maxHp(), 150);
  assert.equal(s.maxDepth(), 185);
  assert.equal(s.buyUpgrade('engine'), false);
  s.p.bounty = 5000;
  const speed = s.speedLimit();
  s.buyUpgrade('engine');
  assert.ok(s.speedLimit() > speed);
  s.dispose();
});

test('Crew rank and department-head doctrines change measured stats', () => {
  const s = fixture();
  const speed = s.speedLimit();
  s.awardCrewXp(900);
  assert.ok(s.p.crewRank >= 3);
  assert.ok(s.speedLimit() > speed);
  const reload = s.reloadMultiplier();
  s.setHead('Weapons', 'damage');
  assert.ok(s.reloadMultiplier() > reload);
  assert.ok(s.damageMultiplier() > 1.15);
  const detection = s.detectionRadius();
  s.setHead('Navigation', 'stealth');
  assert.ok(s.detectionRadius() < detection);
  s.dispose();
});

test('Time compression refuses near contacts, moves safely over open ocean, and arrives at waypoints', () => {
  const s = fixture();
  s.config.world.maxShips = 0;
  assert.equal(s.setDestination({ x: s.p.x + 1000, z: s.p.z - 1000 }, 'Test waypoint'), true);
  assert.equal(s.setAcceleration(1000), true);
  for (let i = 0; i < 120; i++) s.update(0.1);
  assert.equal(s.p.auto, false);
  assert.equal(s.p.route.length, 0);
  assert.equal(s.acceleration, 1);
  s.config.world.maxShips = 1;
  s.addShip(s.p.x + 500, s.p.z, 0);
  assert.equal(s.setAcceleration(100), false);
  s.dispose();
});

test('Compressed travel automatically stops for freshly streamed traffic', () => {
  const s = fixture();
  s.config.world.maxShips = 0;
  s.p.throttle = 1;
  s.setAcceleration(1000);
  s.update(0.1);
  assert.ok(s.p.time > 50);
  s.config.world.maxShips = 1;
  s.addShip(s.p.x + 1000, s.p.z, 0);
  s.update(0.1);
  assert.equal(s.acceleration, 1);
  s.dispose();
});
test('High-speed compressed travel cannot jump past a nearby contact before slowing down', () => {
  const s = fixture();
  s.config.world.maxShips = 1;
  s.config.world.merchantSpeed = 0;
  s.config.navigation.contactRadius = 600;
  s.config.navigation.surfaceSpeed = 60;
  Object.assign(s.p, { heading: 0, throttle: 1, crewRank: 10 });
  s.p.upgrades.engine = 4;
  s.p.skills.navigator = 3;
  s.p.heads.Engineering = 'speed';
  s.p.speed = s.speedLimit();
  const ship = s.addShip(s.p.x, s.p.z - 2000, 0);
  assert.equal(s.setAcceleration(5000), true);
  s.update(0.1);
  assert.equal(s.acceleration, 1);
  assert.ok(s.p.z > ship.z);
  assert.ok(distance(s.p, ship) > 350);
  s.dispose();
});

test('Submerged resources drain and trigger an emergency ascent when exhausted', () => {
  const s = fixture();
  s.config.world.maxShips = 0;
  s.p.depth = 80;
  s.p.targetDepth = 80;
  s.p.battery = 0.0001;
  s.p.oxygen = 100;
  run(s, 2);
  assert.equal(s.p.targetDepth, 0);
  assert.ok(s.p.depth < 80);
  s.dispose();
});

test('Escorts detect the surface boat, attack, and lose deep quiet signatures', () => {
  const s = fixture();
  s.config.world.maxShips = 1;
  s.config.combat.enemyDamage = 20;
  s.p.throttle = 0;
  s.p.speed = 0;
  const escort = s.addShip(s.p.x + 600, s.p.z - 300, 0, true);
  escort.attack = 0;
  run(s, 7);
  assert.equal(s.detected, true);
  assert.ok(s.p.hp < 120);
  s.p.depth = 150;
  s.p.targetDepth = 150;
  escort.alert = 0;
  escort.x = s.p.x + 1800;
  escort.z = s.p.z;
  run(s, 1);
  assert.equal(s.detected, false);
  s.dispose();
});

test('Harbor replenishment requires proximity and spends the service price', () => {
  const s = fixture();
  assert.equal(s.service(), false);
  Object.assign(s.p, { x: PORTS[2].x, z: PORTS[2].z, hp: 70, fuel: 70, torpedoes: 5 });
  const price = s.servicePrice(),
    cash = s.p.bounty;
  assert.equal(s.service(), true);
  assert.equal(s.p.bounty, cash - price);
  assert.equal(s.p.hp, 120);
  assert.equal(s.p.torpedoes, 14);
  assert.equal(s.p.fuel, 100);
  s.dispose();
});

test('Career round-trip preserves progression, routes, and doctrines; malformed input is bounded', () => {
  const s = fixture();
  s.debug('funds');
  s.buySkill('hunter');
  s.buyUpgrade('engine');
  s.setDestination(PORTS[2], PORTS[2].name);
  const loaded = restoreCareer(JSON.parse(JSON.stringify(s.p)));
  assert.deepEqual(loaded.skills, s.p.skills);
  assert.deepEqual(loaded.upgrades, s.p.upgrades);
  assert.equal(loaded.bounty, s.p.bounty);
  assert.equal(loaded.auto, true);
  assert.ok(loaded.route.length);
  const bad = restoreCareer({
    version: 1,
    x: Infinity,
    bounty: -50,
    skills: { hunter: 100 },
    log: [{ text: 'safe', time: 0 }],
  });
  assert.equal(bad.bounty, 0);
  assert.equal(bad.skills.hunter, 3);
  assert.ok(Number.isFinite(bad.x));
  s.dispose();
});

test('Global route planner rejects land and routes around the Americas and Africa', () => {
  const cases = [
    [geo(-17, 49), geo(-28.8, 38.5)],
    [geo(-40, 15), geo(70, -5)],
    [geo(-50, 30), geo(-120, 25)],
  ];
  for (const [a, b] of cases) {
    const path = planRoute(a, b);
    assert.ok(path?.length);
    let previous = a;
    for (const p of path) {
      assert.equal(isLand(p.x, p.z), false);
      assert.equal(segmentClear(previous, p), true);
      previous = p;
    }
  }
  assert.equal(planRoute(geo(-17, 49), geo(10, 20)), null);
  assert.equal(wrapX(181 * DEG), -179 * DEG);
});

test('Setting validation rejects non-finite values and bounds all imported tuning parameters', () => {
  const c = validateConfig({
    graphics: { pixelRatio: 10, reflections: false },
    combat: { torpedoDamage: NaN },
    world: { maxShips: -20 },
  });
  assert.equal(c.graphics.pixelRatio, 2.5);
  assert.equal(c.graphics.reflections, false);
  assert.equal(c.combat.torpedoDamage, 78);
  assert.equal(c.world.maxShips, 4);
  assert.ok(Number.isFinite(waveHeight(-1700000, 5500000, 70, c, 0.4)));
});

test('Sinking a boat enables salvage without wiping earned upgrades or captain skills', () => {
  const s = fixture();
  s.buySkill('hunter');
  s.buyUpgrade('hull');
  s.hurt(1000);
  assert.equal(s.p.hp, 0);
  const cash = s.p.bounty;
  s.salvage();
  assert.equal(s.p.hp, 150);
  assert.equal(s.p.bounty, Math.floor(cash * 0.75));
  assert.equal(s.p.skills.hunter, 1);
  assert.equal(s.p.upgrades.hull, 1);
  assert.equal(distance(s.p, s.nearestPort()), 0);
  s.dispose();
});
