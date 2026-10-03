import { defaults, SETTINGS, validateConfig } from './config.js';
import { newCareer, Simulation } from './simulation.js';
import { clamp, distance, geo } from './world.js';

export const AI_SCENARIOS = [
  {
    id: 'convoy',
    name: 'Convoy ambush',
    description: 'Four merchants, three escorts: one attacker, one listener, and a convoy guard.',
  },
  {
    id: 'escape',
    name: 'Surface contact → deep escape',
    description:
      'A clear visual contact followed by a dive and course change tests loss, memory and reacquisition.',
  },
  {
    id: 'blind',
    name: 'Uncertain acoustic search',
    description:
      'A reported contact without current sensor access reveals search coverage and whether the AI cheats.',
  },
  {
    id: 'torpedo',
    name: 'Visible torpedo wake',
    description: 'A straight torpedo approaches shipping; crews must spot it before reacting.',
  },
  {
    id: 'coast',
    name: 'Coastal convoy',
    description: 'Ships screen and maneuver near an authored coastline; avoidance should prevent grounding.',
  },
];
export const PLAYER_PROFILES = [
  { id: 'evasive', name: 'Dive, turn and quiet down' },
  { id: 'loud', name: 'Stay shallow and run fast' },
  { id: 'quiet', name: 'Deep silent passage' },
  { id: 'manual', name: 'Manual lab helm' },
];

export function createScenario(id = 'convoy', seed = 42, config = defaults(), profile = 'evasive') {
  const c = validateConfig(config);
  // The tactical lab has no sea renderer. Keep water at the Mobile detail level
  // so a desktop graphics preset cannot consume its fast-forward budget.
  c.graphics.spectrumResolution = 32;
  c.graphics.interactionResolution = 128;
  c.world.maxShips = Math.max(12, c.world.maxShips);
  c.ocean.dayCycle = false;
  const p = newCareer();
  Object.assign(p, {
    seed: Math.max(1, Math.floor(seed) || 42),
    speed: 0,
    throttle: 0.4,
    heading: 0,
    time: 0,
    depth: id === 'blind' ? 130 : id === 'convoy' ? 12 : 0,
    targetDepth: id === 'blind' ? 130 : id === 'convoy' ? 12 : 0,
  });
  if (id === 'coast') Object.assign(p, geo(-3.53, 46.5));
  const sim = new Simulation(c, p, { ambientTraffic: false, invulnerable: true, recordAI: true });
  const convoyId = `lab-${seed}`;
  const merchant = (x, z, h = 0) => {
    const ship = sim.addShip(p.x + x, p.z + z, h, false, seed * 31 + sim.nextId);
    ship.convoyId = convoyId;
    return ship;
  };
  const escort = (x, z, h = 0) => {
    const ship = sim.addShip(p.x + x, p.z + z, h, true, seed * 131 + sim.nextId);
    ship.convoyId = convoyId;
    return ship;
  };
  if (id === 'convoy' || id === 'coast') {
    const ships = [merchant(900, -300), merchant(1300, -700), merchant(850, -1150), merchant(1350, -1500)];
    escort(100, -650, 0.4);
    escort(2000, -600, -0.6);
    escort(1050, -2250, Math.PI * 0.2);
    sim.targetId = ships[0].id;
  } else if (id === 'escape') {
    merchant(1400, -1800);
    escort(650, -450, Math.PI * 1.5);
    escort(-700, -950, 0.8);
  } else if (id === 'blind') {
    merchant(2800, -2500);
    const a = escort(1000, -450, Math.PI * 1.5),
      b = escort(-1100, -650, 0.8),
      guard = escort(2300, -2300, 0);
    for (const ship of [a, b]) {
      ship.track = {
        x: p.x,
        z: p.z - 1400,
        depth: 70,
        vx: 2,
        vz: 0,
        age: 8,
        uncertainty: 250,
        depthSpread: 45,
        confidence: 0.45,
        source: 'active-ping',
        fixTime: -8,
      };
      ship.alert = c.combat.searchMemory;
      ship.state = 'investigate';
    }
    guard.state = 'screen';
  } else if (id === 'torpedo') {
    const ship = merchant(250, -650, Math.PI * 0.5);
    escort(700, -1100, 0.6);
    sim.targetId = ship.id;
  }
  return {
    sim,
    id,
    seed: p.seed,
    profile,
    initial: sim.snapshot(),
    events: [],
    fired: false,
    eventCursor: 0,
    ticks: 0,
  };
}

export function applyPlayerScript(run) {
  const s = run.sim,
    p = s.p,
    t = p.time;
  if (run.profile === 'manual') return;
  if (run.profile === 'quiet' || run.id === 'blind') {
    p.throttle = 0.18;
    p.targetDepth = 130;
    s.rudder = 0;
  } else if (run.profile === 'loud') {
    p.throttle = 1;
    p.targetDepth = 12;
    s.rudder = 0;
  } else {
    p.targetDepth = t < 12 ? (run.id === 'convoy' ? 12 : 0) : t < 48 ? 95 : 130;
    p.throttle = t < 12 ? 0.7 : t < 48 ? 0.55 : 0.2;
    s.rudder = t > 15 && t < 27 ? 1 : t > 55 && t < 63 ? -1 : 0;
  }
  if ((run.id === 'convoy' || run.id === 'torpedo') && !run.fired && t >= 5) {
    s.fireTorpedo();
    run.fired = true;
  }
}

export function telemetryFrame(sim) {
  const p = sim.p;
  return {
    time: p.time,
    player: { x: p.x, z: p.z, heading: p.heading, depth: p.depth, speed: p.speed, hp: p.hp },
    detected: sim.detected,
    searching: sim.searching,
    torpedoes: sim.torpedoes.map((t) => ({ id: t.id, x: t.x, z: t.z, heading: t.heading })),
    charges: sim.charges.map((c) => ({ x: c.x, z: c.z, depth: c.depth, life: c.life })),
    ships: sim.ships.map((s) => ({
      id: s.id,
      name: s.name,
      x: s.x,
      z: s.z,
      heading: s.heading,
      speed: s.speed,
      hp: s.hp,
      maxHp: s.maxHp,
      escort: s.escort,
      state: s.state,
      role: s.ai.role,
      reason: s.ai.reason,
      doctrine: s.ai.personality.doctrine,
      skill: s.ai.personality.skill,
      aggression: s.ai.personality.aggression,
      confidence: s.ai.confidence,
      track: s.track ? { ...s.track } : null,
      goal: s.ai.goal ? { ...s.ai.goal } : null,
      run: s.ai.run ? structuredClone(s.ai.run) : null,
      sensor: { mode: s.ai.sensorMode, range: s.ai.sensorRange, seen: s.ai.seen },
      chargesLeft: s.ai.chargesLeft,
    })),
    pendingReports: sim.aiMessages.length,
  };
}

// Lab and CLI use the same fixed step; browser frame rate changes only how many ticks are scheduled.
export const AI_STEP = 1 / 30;
export function stepScenario(run, seconds = 1, sample, events = []) {
  const s = run.sim,
    count = Math.max(0, Math.round(seconds / AI_STEP));
  for (let i = 0; i < count; i++) {
    while (run.eventCursor < events.length && events[run.eventCursor].time <= s.p.time + 1e-7)
      applyLabEvent(s, events[run.eventCursor++], run);
    applyPlayerScript(run);
    s.update(AI_STEP);
    run.ticks++;
    if (sample && run.ticks % 30 === 0) sample(telemetryFrame(s));
    if (s.p.hp <= 0) break;
  }
  while (run.eventCursor < events.length && events[run.eventCursor].time <= s.p.time + 1e-7)
    applyLabEvent(s, events[run.eventCursor++], run);
}
export function applyLabEvent(sim, event, run) {
  if (event.type === 'profile' && run && PLAYER_PROFILES.some((p) => p.id === event.value))
    run.profile = event.value;
  if (
    event.type === 'tune' &&
    Object.hasOwn(SETTINGS, event.group) &&
    Object.hasOwn(SETTINGS[event.group], event.key)
  ) {
    const copy = structuredClone(sim.config);
    copy[event.group][event.key] = event.value;
    const valid = validateConfig(copy);
    sim.config[event.group][event.key] = valid[event.group][event.key];
  }
  if (event.type === 'helm') {
    if (Number.isFinite(event.throttle)) sim.p.throttle = clamp(event.throttle, 0, 1);
    if (Number.isFinite(event.depth)) sim.dive(event.depth);
    if (Number.isFinite(event.rudder)) sim.rudder = clamp(event.rudder, -1, 1);
  }
  if (event.type === 'ping') sim.sonarPing();
  if (event.type === 'torpedo') {
    if (Number.isInteger(event.targetId)) sim.targetId = event.targetId;
    sim.fireTorpedo();
  }
  if (event.type === 'damage') {
    const ship = sim.ships.find((s) => s.id === event.targetId);
    if (ship) sim.hitShip(ship, clamp(Number(event.damage) || 10, 0, 500));
  }
}
export function trialMetrics(run, frames) {
  const events = run.sim.aiEvents,
    observations = events.filter(
      (e) => e.type === 'observation' && run.sim.ships.find((s) => s.id === e.shipId)?.escort,
    );
  const decisions = events.filter((e) => e.type === 'state'),
    patterns = events.filter((e) => e.type === 'depth-pattern');
  const minSeparation = frames.reduce((minimum, f) => {
    for (let i = 0; i < f.ships.length; i++)
      for (let j = i + 1; j < f.ships.length; j++)
        minimum = Math.min(minimum, distance(f.ships[i], f.ships[j]));
    return minimum;
  }, Infinity);
  const errors = frames.flatMap((f) =>
    f.ships.filter((s) => s.escort && s.track).map((s) => distance(s.track, f.player)),
  );
  return {
    scenario: run.id,
    seed: run.seed,
    profile: run.profile,
    duration: run.sim.p.time,
    firstDetection: observations[0]?.time ?? null,
    detectionSeconds: frames.filter((f) => f.detected).length,
    patternAttacks: patterns.length,
    gunAttacks: events.filter((e) => e.type === 'gun-attack').length,
    torpedoReactions: events.filter((e) => e.type === 'torpedo-sighted').length,
    merchantPlans: [...new Set(events.filter((e) => e.type === 'merchant-maneuver').map((e) => e.plan))],
    states: [...new Set(decisions.map((e) => e.to))],
    roles: [...new Set(events.filter((e) => e.type === 'role').map((e) => e.to))],
    minShipSeparation: Number.isFinite(minSeparation) ? minSeparation : null,
    meanTrackError: errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : null,
    shipsSunk: run.sim.p.sunk,
    eventCount: events.length,
    potentialDamage: run.sim.aiDamage || 0,
  };
}
