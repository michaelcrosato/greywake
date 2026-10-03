import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createScenario, stepScenario, telemetryFrame, trialMetrics } from '../src/ai-scenarios.js';
import { defaults } from '../src/config.js';
import { coordinateFleet, hearPing, updateEnemy } from '../src/enemy-ai.js';
import { initPhysics, restoreCareer, Simulation } from '../src/simulation.js';
import { distance, isLand } from '../src/world.js';

await initPhysics();
const ticks = (run, seconds, events = []) => {
  const frames = [telemetryFrame(run.sim)];
  stepScenario(run, seconds, (f) => frames.push(f), events);
  return frames;
};
const shipTactics = (sim) =>
  sim.ships.map((s) => ({
    x: s.x,
    z: s.z,
    heading: s.heading,
    speed: s.speed,
    state: s.state,
    role: s.ai.role,
    goal: s.ai.goal,
    run: s.ai.run,
    track: s.track,
    rng: s.ai.rng,
  }));

test('The same seed and timed tuning/manual inputs reproduce decisions across different scheduling batches', () => {
  const a = createScenario('escape', 42),
    b = createScenario('escape', 42);
  const events = [
    { time: 3, type: 'tune', group: 'ai', key: 'reactionDelay', value: 2 },
    { time: 8, type: 'profile', value: 'manual' },
    { time: 8, type: 'helm', depth: 80, throttle: 0.3, rudder: 1 },
    { time: 12, type: 'helm', rudder: 0 },
    { time: 16, type: 'ping' },
  ];
  stepScenario(a, 60, null, events);
  for (let i = 0; i < 180; i++) stepScenario(b, 1 / 3, null, events);
  assert.deepEqual(shipTactics(a.sim), shipTactics(b.sim));
  assert.deepEqual(a.sim.aiEvents, b.sim.aiEvents);
  assert.equal(a.sim.p.depth, b.sim.p.depth);
  a.sim.dispose();
  b.sim.dispose();
});

test('Blind search tactics cannot follow hidden changes to submarine position or depth', () => {
  const a = createScenario('blind', 42, defaults(), 'manual'),
    b = createScenario('blind', 42, defaults(), 'manual');
  for (const run of [a, b]) {
    run.sim.config.combat.sonarRange = 200;
    run.sim.p.depth = run.sim.p.targetDepth = 130;
    run.sim.p.throttle = 0;
  }
  b.sim.p.x += 9000;
  b.sim.p.depth = b.sim.p.targetDepth = 180;
  b.sim.body.setTranslation({ x: 9000, y: -182, z: 0 }, true);
  ticks(a, 90);
  ticks(b, 90);
  assert.deepEqual(shipTactics(a.sim), shipTactics(b.sim));
  assert.equal(
    a.sim.aiEvents.some((e) => e.type === 'observation'),
    false,
  );
  assert.equal(
    b.sim.aiEvents.some((e) => e.type === 'observation'),
    false,
  );
  a.sim.dispose();
  b.sim.dispose();
});

test('An audible ping supplies an uncertain fix rather than the captain’s hidden depth', () => {
  const a = createScenario('escape', 42),
    b = createScenario('escape', 42);
  a.sim.p.depth = 90;
  b.sim.p.depth = 150;
  const x = a.sim.ships.find((s) => s.escort),
    y = b.sim.ships.find((s) => s.escort);
  hearPing(a.sim, x);
  hearPing(b.sim, y);
  assert.deepEqual(x.track, y.track);
  assert.ok(x.track.uncertainty >= 80);
  assert.notEqual(x.track.depth, a.sim.p.depth);
  assert.notEqual(y.track.depth, b.sim.p.depth);
  a.sim.dispose();
  b.sim.dispose();
});

test('Radio information is delayed and three-escort groups retain a convoy guard', () => {
  const run = createScenario('convoy', 42),
    s = run.sim;
  const escorts = s.ships.filter((v) => v.escort),
    [source, receiver] = escorts;
  source.track = {
    x: s.p.x,
    z: s.p.z,
    depth: 60,
    vx: 0,
    vz: 0,
    age: 0,
    uncertainty: 50,
    depthSpread: 35,
    confidence: 0.9,
    source: 'sonar',
    fixTime: 0,
  };
  source.ai.confidence = 0.9;
  source.alert = 60;
  s.config.ai.radioDelay = 4;
  coordinateFleet(s, 1);
  assert.equal(receiver.track, null);
  assert.ok(s.aiMessages.length > 0);
  s.p.time = 2;
  coordinateFleet(s, 1);
  assert.equal(receiver.track, null);
  s.p.time = 7;
  coordinateFleet(s, 1);
  assert.equal(receiver.track.source, 'shared');
  assert.equal(receiver.track.age, 7);
  assert.ok(receiver.track.confidence < source.track.confidence);
  assert.equal(escorts.filter((e) => e.ai.role === 'guard').length, 1);
  assert.equal(escorts.filter((e) => e.ai.role === 'attacker').length, 1);
  assert.equal(escorts.filter((e) => e.ai.role === 'assistant').length, 1);
  s.config.ai.coordination = false;
  coordinateFleet(s, 1);
  assert.ok(escorts.every((e) => e.ai.role === 'independent'));
  s.dispose();
});

test('Different seeds vary search paths and merchant maneuvers while the same seed remains reproducible', () => {
  const paths = [],
    plans = new Set(),
    doctrines = new Set();
  for (let seed = 42; seed < 48; seed++) {
    const run = createScenario('blind', seed),
      frames = ticks(run, 90);
    paths.push(JSON.stringify(shipTactics(run.sim).map((s) => [s.x, s.z, s.goal])));
    for (const s of run.sim.ships.filter((s) => s.escort)) doctrines.add(s.ai.personality.doctrine);
    assert.ok(frames.some((f) => f.ships.some((s) => s.state === 'search')));
    run.sim.dispose();
    const convoy = createScenario('convoy', seed, defaults(), 'loud');
    convoy.sim.hitShip(convoy.sim.ships[0], 10);
    ticks(convoy, 90);
    for (const e of convoy.sim.aiEvents.filter((e) => e.type === 'merchant-maneuver')) plans.add(e.plan);
    convoy.sim.dispose();
  }
  assert.equal(new Set(paths).size, paths.length);
  assert.ok(doctrines.size >= 2);
  assert.ok(plans.size >= 2);
});

test('Torpedo evasive headings override an earlier navigation goal', () => {
  const run = createScenario('convoy', 42),
    s = run.sim,
    e = s.ships.find((v) => v.escort);
  e.ai.goal = { x: e.x + 1000, z: e.z };
  e.ai.evadeHeading = e.heading;
  e.ai.evadeUntil = 20;
  e.ai.reactionUntil = 0;
  e.ai.decisionClock = 1;
  updateEnemy(s, e, 1 / 30);
  assert.equal(e.state, 'evade');
  assert.equal(e.ai.goal, null);
  s.dispose();
});

test('A save restores crew RNG, orders, roles, search and committed attack state', () => {
  const run = createScenario('escape', 42, defaults(), 'loud');
  ticks(run, 45);
  const snapshot = run.sim.snapshot();
  const restored = new Simulation(structuredClone(run.sim.config), restoreCareer(snapshot.career), {
    encounter: snapshot.encounter,
    ambientTraffic: false,
    invulnerable: true,
    recordAI: true,
  });
  assert.deepEqual(
    restored.ships.map((s) => s.ai),
    run.sim.ships.map((s) => s.ai),
  );
  assert.deepEqual(
    restored.ships.map((s) => s.track),
    run.sim.ships.map((s) => s.track),
  );
  assert.deepEqual(restored.aiMessages, run.sim.aiMessages);
  for (let i = 0; i < 30; i++) {
    run.sim.update(1 / 30);
    restored.update(1 / 30);
  }
  for (let i = 0; i < restored.ships.length; i++) {
    assert.equal(restored.ships[i].ai.rng, run.sim.ships[i].ai.rng);
    assert.equal(restored.ships[i].state, run.sim.ships[i].state);
    assert.ok(distance(restored.ships[i], run.sim.ships[i]) < 0.1);
  }
  restored.dispose();
  run.sim.dispose();
});

test('Deep quiet counterplay reduces detections and damage relative to loud shallow running', () => {
  const damage = { loud: 0, evasive: 0 },
    detections = { loud: 0, evasive: 0 };
  for (let seed = 42; seed < 45; seed++)
    for (const profile of ['loud', 'evasive']) {
      const run = createScenario('escape', seed, defaults(), profile),
        frames = ticks(run, 240),
        m = trialMetrics(run, frames);
      damage[profile] += m.potentialDamage;
      detections[profile] += m.detectionSeconds;
      run.sim.dispose();
    }
  assert.ok(detections.loud > detections.evasive * 3);
  assert.ok(damage.loud > damage.evasive + 20);
});

test('Coastal maneuvers remain afloat and friendlies maintain hull clearance in seeded trials', () => {
  for (let seed = 42; seed < 45; seed++) {
    const run = createScenario('coast', seed),
      frames = ticks(run, 180);
    for (const frame of frames)
      for (const ship of frame.ships) {
        assert.ok(Number.isFinite(ship.heading) && Number.isFinite(ship.speed));
        assert.equal(isLand(ship.x, ship.z), false);
      }
    assert.ok(trialMetrics(run, frames).minShipSeparation > 60);
    run.sim.dispose();
  }
});
