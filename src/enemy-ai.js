import { sunlight, worldClock } from './lighting.js';
import { angleDelta, bearing, clamp, deltaX, distance, isLand, KNOT, TAU, wrapX } from './world.js';

export const AI_STATES = [
  'patrol',
  'screen',
  'investigate',
  'hunt',
  'search',
  'attack-run',
  'recover',
  'evade',
  'withdraw',
];
export const AI_ROLES = ['independent', 'attacker', 'assistant', 'guard', 'searcher'];

// Each ship owns a persisted RNG. Variation is repeatable; rendering frame rate never supplies randomness.
export function draw(ai) {
  let x = ai.rng >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  ai.rng = x >>> 0 || 1;
  return (ai.rng >>> 0) / 4294967296;
}
export function createAI(seed, id) {
  const ai = {
    version: 1,
    rng: ((seed >>> 0) ^ Math.imul(id, 2654435761) ^ 0x9e3779b9) >>> 0 || 1,
    sensorClock: 0,
    decisionClock: 0,
    reactionUntil: 0,
    role: 'independent',
    reason: 'Following the shipping route',
    goal: null,
    orderHeading: 0,
    orderSpeed: 0,
    confidence: 0,
    lastObservation: null,
    searchIndex: 0,
    searchCenter: null,
    searchWaypoint: null,
    run: null,
    recoverUntil: 0,
    evadeUntil: 0,
    evadeHeading: 0,
    merchantUntil: 0,
    merchantOffset: 0,
    merchantPlan: 'steady',
    lastBroadcast: -99,
    lastSharedFix: -1,
    failedRuns: 0,
    chargesLeft: 72,
    seen: false,
    sensorMode: 'none',
    sensorRange: 0,
    sensorBearing: 0,
    assignmentUntil: 0,
    slot: 0,
    groupSize: 1,
    convoyAnchor: null,
  };
  ai.personality = {
    skill: 0.75 + draw(ai) * 0.5,
    aggression: 0.6 + draw(ai) * 0.8,
    caution: 0.65 + draw(ai) * 0.7,
    doctrine: ['sector', 'box', 'sweep'][Math.floor(draw(ai) * 3)],
    turnBias: draw(ai) < 0.5 ? -1 : 1,
  };
  ai.sensorClock = draw(ai) * 0.5;
  ai.decisionClock = draw(ai) * 0.3;
  return ai;
}
export function restoreAI(raw, seed, id) {
  const ai = createAI(seed, id);
  if (raw?.version !== 1) return ai;
  const number = (k, min, max) => {
    if (Number.isFinite(raw[k])) ai[k] = clamp(raw[k], min, max);
  };
  for (const k of ['sensorClock', 'decisionClock']) number(k, 0, 10);
  for (const k of ['reactionUntil', 'recoverUntil', 'evadeUntil', 'merchantUntil', 'assignmentUntil'])
    number(k, 0, 1e12);
  for (const k of ['lastBroadcast', 'lastSharedFix']) number(k, -100, 1e12);
  number('rng', 1, 4294967295);
  ai.rng = ai.rng >>> 0 || 1;
  number('confidence', 0, 1);
  number('searchIndex', 0, 10000);
  number('failedRuns', 0, 1000);
  number('chargesLeft', 0, 200);
  number('merchantOffset', -Math.PI, Math.PI);
  number('evadeHeading', -1e8, 1e8);
  number('orderHeading', -1e8, 1e8);
  number('orderSpeed', 0, 50);
  number('sensorRange', 0, 50000);
  number('sensorBearing', 0, Math.PI);
  number('slot', 0, 100);
  number('groupSize', 1, 100);
  for (const key of ['slot', 'groupSize', 'searchIndex', 'failedRuns', 'chargesLeft'])
    ai[key] = Math.floor(ai[key]);
  ai.seen = !!raw.seen;
  ai.sensorMode = ['none', 'visual', 'sonar'].includes(raw.sensorMode) ? raw.sensorMode : 'none';
  ai.convoyAnchor = Number.isInteger(raw.convoyAnchor) ? raw.convoyAnchor : null;
  if (raw.lastObservation && Number.isFinite(raw.lastObservation.time))
    ai.lastObservation = structuredClone(raw.lastObservation);
  if (AI_ROLES.includes(raw.role)) ai.role = raw.role;
  if (['sector', 'box', 'sweep'].includes(raw.personality?.doctrine))
    ai.personality.doctrine = raw.personality.doctrine;
  for (const k of ['skill', 'aggression', 'caution'])
    if (Number.isFinite(raw.personality?.[k])) ai.personality[k] = clamp(raw.personality[k], 0.3, 2);
  if ([-1, 1].includes(raw.personality?.turnBias)) ai.personality.turnBias = raw.personality.turnBias;
  if (typeof raw.reason === 'string') ai.reason = raw.reason.slice(0, 180);
  if (['steady', 'zigzag', 'hard-turn', 'breakaway', 'comb-wake'].includes(raw.merchantPlan))
    ai.merchantPlan = raw.merchantPlan;
  const point = (p) =>
    p && Number.isFinite(p.x) && Number.isFinite(p.z) && Math.abs(p.x) <= 2e7 && Math.abs(p.z) <= 9e6;
  for (const k of ['searchCenter', 'searchWaypoint', 'goal'])
    if (point(raw[k])) ai[k] = { x: raw[k].x, z: raw[k].z };
  if (raw.run && point(raw.run.center) && point(raw.run.end) && Number.isFinite(raw.run.heading))
    ai.run = {
      center: { ...raw.run.center },
      end: { ...raw.run.end },
      heading: raw.run.heading,
      depth: clamp(Number(raw.run.depth) || 65, 0, 300),
      released: !!raw.run.released,
      until: clamp(Number(raw.run.until) || 0, 0, 1e12),
    };
  return ai;
}
const point = (x, z) => ({ x: wrapX(x), z });
const unit = (h) => ({ x: Math.sin(h), z: -Math.cos(h) });
const trait = (sim, ship, key) => 1 + (ship.ai.personality[key] - 1) * sim.config.ai.crewVariation;
const log = (sim, ship, type, details) => sim.recordAI?.(ship, type, details);
function state(sim, s, name, reason) {
  if (s.state !== name) log(sim, s, 'state', { from: s.state, to: name, reason });
  s.state = name;
  s.ai.reason = reason;
}
function trackPoint(track, horizon = 0) {
  const t = Math.min(25, track.age + horizon);
  return point(track.x + track.vx * t, track.z + track.vz * t);
}
function crewDelay(sim, s) {
  return (sim.config.ai.reactionDelay * (0.7 + 0.6 * draw(s.ai))) / trait(sim, s, 'skill');
}

export function nearestMerchant(sim, s) {
  let result = null,
    best = Infinity;
  for (const m of sim.ships) {
    if (m.escort || m.hp <= 0) continue;
    if (s.convoyId && m.convoyId && s.convoyId !== m.convoyId) continue;
    const d = distance(m, s);
    if (d < best) {
      best = d;
      result = m;
    }
  }
  return best < sim.config.ai.convoyLeash * 1.5 ? result : null;
}

export function reportAttack(sim, victim) {
  victim.alert = Math.max(victim.alert, 45);
  victim.alertStart = sim.p.time;
  victim.ai ||= createAI(victim.seed, victim.id);
  victim.ai.merchantUntil = 0;
  victim.ai.reactionUntil = sim.p.time + crewDelay(sim, victim);
  for (const escort of sim.ships) {
    if (
      !escort.escort ||
      escort.hp <= 0 ||
      distance(escort, victim) > sim.config.combat.escortResponseRange ||
      escort.state === 'hunt' ||
      escort.state === 'attack-run'
    )
      continue;
    const track = {
      x: victim.x,
      z: victim.z,
      depth: 65,
      vx: 0,
      vz: 0,
      age: 0,
      uncertainty: 180,
      depthSpread: 55,
      confidence: 0.32,
      source: 'distress',
      fixTime: sim.p.time,
    };
    escort.track = track;
    escort.alert = sim.config.combat.searchMemory;
    escort.ai.confidence = track.confidence;
    escort.ai.searchCenter = null;
    escort.ai.searchIndex = 0;
    escort.ai.reactionUntil = sim.p.time + crewDelay(sim, escort);
    state(
      sim,
      escort,
      'investigate',
      'Merchant distress report: attack site known, submarine position unknown',
    );
    log(sim, escort, 'distress', { victim: victim.id, track: { ...track } });
  }
}
export function hearPing(sim, s) {
  s.ai ||= createAI(s.seed, s.id);
  const error = sim.config.ai.observationNoise * 2;
  s.track = {
    x: wrapX(sim.p.x + (draw(s.ai) - 0.5) * error),
    z: sim.p.z + (draw(s.ai) - 0.5) * error,
    depth: s.track?.depth || 65,
    vx: 0,
    vz: 0,
    age: 0,
    uncertainty: Math.max(80, error),
    depthSpread: sim.config.ai.depthUncertainty,
    confidence: 0.45,
    source: 'active-ping',
    fixTime: sim.p.time,
  };
  s.alert = sim.config.combat.searchMemory;
  s.ai.confidence = 0.45;
  s.ai.reactionUntil = sim.p.time + crewDelay(sim, s);
  state(sim, s, 'investigate', 'Heard an active ping; investigate the acoustic fix');
  log(sim, s, 'ping-heard', { track: { ...s.track } });
}

// Only perception may inspect hidden submarine or torpedo truth. Tactics below consume reports.
export function sampleSensors(sim, s) {
  const ai = s.ai,
    c = sim.config,
    p = sim.p,
    r = distance(s, p),
    skill = trait(sim, s, 'skill');
  const clock = worldClock(p, c),
    sun = sunlight(clock.hour, -p.z / 111000);
  const daylight = clamp(0.5 + sun.y, 0.28, 1),
    visual =
      c.combat.detectionRange *
      (1 - (p.skills.stealth || 0) * 0.12) *
      (1 - sim.weather * 0.35) *
      daylight *
      skill *
      (p.depth > 3 ? 0.23 : 1);
  const forwardError = Math.abs(angleDelta(bearing(s, p), s.heading));
  const selfNoise = 1 - c.ai.selfNoise * clamp(s.speed / Math.max(1, c.world.escortSpeed * KNOT), 0, 1);
  const sonar =
    c.combat.sonarRange *
    (sim.head('Navigation', 'stealth') ? 0.75 : 1) *
    (0.4 + (p.speed / Math.max(1, sim.speedLimit())) * 0.6) *
    Math.max(0.35, 1 - p.depth / 260) *
    selfNoise *
    skill;
  const optic = p.depth <= 18 && r < visual;
  const sonarEligible =
    s.escort &&
    p.depth > 3 &&
    r < sonar &&
    r > c.ai.sonarBlindRange &&
    forwardError < (c.ai.sonarArc * Math.PI) / 360 &&
    s.state !== 'attack-run';
  const quality = optic
    ? clamp(1 - (r / visual) * 0.55, 0.3, 1)
    : sonarEligible
      ? clamp(1 - (r / sonar) * 0.6 - sim.weather * 0.1, 0.25, 1)
      : 0;
  ai.sensorMode = optic ? 'visual' : sonarEligible ? 'sonar' : 'none';
  ai.sensorRange = optic || p.depth <= 3 ? visual : sonar;
  ai.sensorBearing = forwardError;
  const hit = quality > 0 && (quality > 0.65 || draw(ai) < quality);
  if (hit) {
    const spread = (c.ai.observationNoise * (optic ? 0.2 : 1.3)) / Math.max(0.5, quality * skill);
    const x = wrapX(p.x + (draw(ai) - 0.5) * spread * 2),
      z = p.z + (draw(ai) - 0.5) * spread * 2;
    const measuredHeading = p.heading + (draw(ai) - 0.5) * (optic ? 0.08 : 0.45),
      speed = Math.max(0, p.speed + (draw(ai) - 0.5) * (optic ? 0.4 : 1.5));
    const old = s.track,
      confidence = clamp(Math.max(old?.confidence * 0.7 || 0, quality), 0, 1);
    const depth = optic
      ? p.depth > 3
        ? 12
        : 0
      : clamp(
          old && old.source !== 'distress' ? old.depth : 55 + (draw(ai) - 0.5) * c.ai.depthUncertainty,
          18,
          180,
        );
    s.track = {
      x,
      z,
      depth,
      vx: Math.sin(measuredHeading) * speed,
      vz: -Math.cos(measuredHeading) * speed,
      age: 0,
      uncertainty: Math.max(optic ? 5 : 20, spread),
      depthSpread: optic ? 5 : c.ai.depthUncertainty,
      confidence,
      source: optic ? 'visual' : 'sonar',
      fixTime: sim.p.time,
    };
    s.alert = c.combat.searchMemory;
    ai.confidence = confidence;
    ai.seen = true;
    ai.lastObservation = { time: sim.p.time, source: s.track.source, quality, track: { ...s.track } };
    if (!old || old.age > 8) {
      ai.reactionUntil = sim.p.time + crewDelay(sim, s);
      ai.searchCenter = null;
      ai.searchIndex = 0;
    }
    log(sim, s, 'observation', { source: s.track.source, quality, track: { ...s.track } });
  }
  if (!hit) ai.seen = false;
  if (sim.training || !c.ai.torpedoEvasion) return;
  let threat = null,
    best = Infinity;
  for (const t of sim.torpedoes) {
    const d = distance(s, t),
      visible = c.ai.torpedoSpotRange * (0.45 + daylight * 0.55) * (1 - sim.weather * 0.35) * skill;
    if (d > visible) continue;
    const v = t.body.linvel(),
      rx = deltaX(t.x, s.x),
      rz = t.z - s.z,
      vx = v.x - Math.sin(s.heading) * s.speed,
      vz = v.z + Math.cos(s.heading) * s.speed;
    const eta = -(rx * vx + rz * vz) / Math.max(1, vx * vx + vz * vz),
      miss = Math.hypot(rx + vx * eta, rz + vz * eta);
    if (eta > 0 && eta < 30 && miss < s.width + 18 && eta < best && (d < visible * 0.6 || draw(ai) > 0.25)) {
      threat = { id: t.id, bearing: bearing(s, t), heading: t.heading, eta };
      best = eta;
    }
  }
  if (threat && ai.evadeUntil <= sim.p.time) {
    const bow = Math.abs(angleDelta(threat.bearing, s.heading)) < 0.7;
    ai.evadeHeading = bow ? s.heading + ai.personality.turnBias * (0.65 + draw(ai) * 0.5) : threat.bearing;
    ai.evadeUntil = sim.p.time + Math.max(10, threat.eta + 6);
    ai.reactionUntil = sim.p.time + Math.min(crewDelay(sim, s), threat.eta * 0.3);
    ai.merchantPlan = 'comb-wake';
    ai.run = null;
    log(sim, s, 'torpedo-sighted', { ...threat, evadeHeading: ai.evadeHeading });
  }
}

export function coordinateFleet(sim, dt) {
  sim.aiMessages ||= [];
  sim.aiCoordClock = (sim.aiCoordClock || 0) + dt;
  const now = sim.p.time;
  for (const message of sim.aiMessages) {
    if (message.due > now) continue;
    const receiver = sim.ships.find((s) => s.id === message.to && s.hp > 0);
    if (receiver && (!receiver.track || message.track.fixTime > receiver.track.fixTime + 0.01)) {
      const age = now - message.track.fixTime;
      receiver.track = {
        ...message.track,
        age,
        confidence: message.track.confidence * Math.exp(-age / 40) * 0.8,
        source: 'shared',
      };
      receiver.ai.confidence = receiver.track.confidence;
      receiver.alert = Math.max(receiver.alert, sim.config.combat.searchMemory - age);
      log(sim, receiver, 'radio-received', { from: message.from, track: { ...receiver.track } });
    }
  }
  sim.aiMessages = sim.aiMessages.filter((m) => m.due > now).slice(-96);
  if (sim.aiCoordClock < 1) return;
  sim.aiCoordClock %= 1;
  const escorts = sim.ships.filter((s) => s.escort && s.hp > 0);
  for (const s of escorts) {
    if (
      !s.track ||
      !['visual', 'sonar', 'active-ping'].includes(s.track.source) ||
      s.track.age > 4 ||
      now - s.ai.lastBroadcast < 4 ||
      !sim.config.ai.coordination
    )
      continue;
    s.ai.lastBroadcast = now;
    for (const other of escorts) {
      if (other === s || distance(s, other) > sim.config.combat.escortResponseRange * 1.5) continue;
      if (s.convoyId && other.convoyId && s.convoyId !== other.convoyId) continue;
      sim.aiMessages.push({
        from: s.id,
        to: other.id,
        due: now + sim.config.ai.radioDelay * (0.75 + draw(s.ai) * 0.5),
        track: { ...s.track },
      });
      log(sim, s, 'radio-sent', { to: other.id, fixTime: s.track.fixTime });
    }
  }
  const groups = new Map();
  for (const s of escorts) {
    const merchant = nearestMerchant(sim, s),
      key = s.convoyId || merchant?.id || 'unattached';
    const group = groups.get(key) || [];
    group.push(s);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const informed = group.filter((s) => s.track && s.alert > 0 && s.ai.confidence > 0.2);
    const strongest = informed.sort(
      (a, b) => b.ai.confidence - b.track.age * 0.003 - (a.ai.confidence - a.track.age * 0.003),
    )[0];
    const aim = strongest ? trackPoint(strongest.track) : null;
    // Reserve a ship before choosing attack roles so the nearest escort cannot consume the guard slot.
    const guard =
      sim.config.ai.guardConvoy && group.length >= 3 && group.some((s) => nearestMerchant(sim, s))
        ? [...group].sort((a, b) => {
            const score = (s) => (s.ai.role === 'guard' ? 1200 : 0) + (aim ? distance(s, aim) : 0);
            return score(b) - score(a);
          })[0]
        : null;
    const ranked = informed
      .filter((s) => s !== guard)
      .sort((a, b) => {
        const score = (s) =>
          distance(s, aim) / trait(sim, s, 'aggression') +
          (s.ai.role === 'attacker' && s.ai.assignmentUntil > now ? -450 : 0) +
          (s.ai.recoverUntil > now ? 1200 : 0);
        return score(a) - score(b);
      });
    group.forEach((s, index) => {
      const previous = s.ai.role;
      s.ai.slot = index;
      s.ai.groupSize = group.length;
      s.ai.convoyAnchor = nearestMerchant(sim, s)?.id ?? null;
      if (!sim.config.ai.coordination) s.ai.role = 'independent';
      else if (s === guard) s.ai.role = 'guard';
      else if (s === ranked[0]) s.ai.role = 'attacker';
      else if (s === ranked[1]) s.ai.role = 'assistant';
      else s.ai.role = 'searcher';
      if (!aim && sim.config.ai.coordination) s.ai.role = 'guard';
      if (previous !== s.ai.role) {
        s.ai.assignmentUntil = now + 8;
        log(sim, s, 'role', { from: previous, to: s.ai.role });
      }
    });
  }
}

function searchGoal(s) {
  const ai = s.ai,
    t = s.track,
    center = trackPoint(t),
    radius = clamp(t.uncertainty, 100, 1100);
  if (!ai.searchCenter || distance(ai.searchCenter, center) > 200) {
    ai.searchCenter = center;
    ai.searchIndex = 0;
    ai.searchWaypoint = null;
  }
  if (ai.searchWaypoint && distance(s, ai.searchWaypoint) > 110) return ai.searchWaypoint;
  const n = ai.searchIndex++,
    slot = ai.slot || 0,
    bias = ai.personality.turnBias;
  let x, z;
  if (ai.personality.doctrine === 'sector') {
    const angle = ((n % 6) * TAU) / 6 + slot * 1.1 + bias * 0.4;
    x = Math.sin(angle) * radius;
    z = Math.cos(angle) * radius;
    if (n % 2 === 1) {
      x *= 0.25;
      z *= 0.25;
    }
  } else if (ai.personality.doctrine === 'box') {
    const corners = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ],
      c = corners[(n + slot) % 4],
      scale = radius * (0.55 + Math.floor(n / 4) * 0.2);
    x = c[0] * scale;
    z = c[1] * scale;
  } else {
    x = ((n + slot) % 2 ? 1 : -1) * radius;
    z = (((Math.floor(n / 2) + slot) % 5) - 2) * radius * 0.4;
  }
  const h = Math.atan2(t.vx, -t.vz) || s.baseHeading,
    u = unit(h);
  ai.searchWaypoint = point(ai.searchCenter.x + x * u.z - z * u.x, ai.searchCenter.z - x * u.x - z * u.z);
  return ai.searchWaypoint;
}

function firePattern(sim, s, run) {
  const ai = s.ai,
    c = sim.config,
    count = Math.min(Math.round(c.ai.chargePattern), ai.chargesLeft),
    depthSpread = s.track?.depthSpread || 35;
  if (!count) return;
  const u = unit(run.heading),
    sink = Math.max(2, run.depth / c.ai.chargeSinkRate),
    spread = Math.max(25, Math.min(90, s.track?.uncertainty || 40));
  for (let i = 0; i < count; i++) {
    const side = (i - (count - 1) / 2) * spread * 0.7,
      depth = clamp(run.depth + (i - (count - 1) / 2) * depthSpread * 0.65 + (draw(ai) - 0.5) * 8, 12, 240);
    sim.charges.push({
      type: 'enemy',
      x: wrapX(run.center.x + u.z * side),
      z: run.center.z - u.x * side,
      depth,
      life: Math.max(2, depth / c.ai.chargeSinkRate),
      damage: c.combat.enemyDamage * 0.65,
      ownerId: s.id,
    });
  }
  ai.chargesLeft -= count;
  s.attack = c.combat.enemyReload * (0.85 + draw(ai) * 0.4);
  ai.failedRuns++;
  run.released = true;
  log(sim, s, 'depth-pattern', {
    center: { ...run.center },
    depth: run.depth,
    count,
    sinkSeconds: sink,
    uncertainty: spread,
  });
  sim.message('Escort laying a depth-charge pattern. Change course and depth.');
}

function escortDecision(sim, s) {
  const ai = s.ai,
    c = sim.config,
    now = sim.p.time,
    anchor = nearestMerchant(sim, s),
    track = s.track;
  if (ai.evadeUntil > now && now >= ai.reactionUntil) {
    ai.goal = null;
    state(sim, s, 'evade', 'A nearby torpedo wake threatens this ship');
    ai.orderHeading = ai.evadeHeading;
    ai.orderSpeed = c.world.escortSpeed * KNOT;
    return;
  }
  if (s.hp / s.maxHp < 0.25 * trait(sim, s, 'caution')) {
    state(sim, s, 'withdraw', 'Hull critically damaged; retire toward protected shipping');
    ai.goal = anchor
      ? point(anchor.x - 600 * Math.sin(anchor.heading), anchor.z + 600 * Math.cos(anchor.heading))
      : point(s.x + Math.sin(s.baseHeading) * 900, s.z - Math.cos(s.baseHeading) * 900);
    ai.orderSpeed = c.world.escortSpeed * KNOT * 0.45;
    return;
  }
  if (ai.recoverUntil > now) {
    state(sim, s, 'recover', 'Clear the blast area, turn, and listen before another run');
    ai.goal = ai.run?.end || point(s.x + Math.sin(s.heading) * 300, s.z - Math.cos(s.heading) * 300);
    ai.orderSpeed = c.world.escortSpeed * KNOT * 0.7;
    return;
  }
  if (ai.run && now < ai.run.until) {
    state(sim, s, 'attack-run', 'Committed to a predicted run; close sonar contact can be lost');
    ai.goal = ai.run.end;
    ai.orderSpeed = c.world.escortSpeed * KNOT * 0.88;
    if (!ai.run.released && distance(s, ai.run.center) < 110) firePattern(sim, s, ai.run);
    if (ai.run.released && distance(s, ai.run.end) < 120) {
      ai.recoverUntil = now + 8 + draw(ai) * 8;
      ai.run = null;
    }
    return;
  }
  ai.run = null;
  if (anchor && distance(s, anchor) > c.ai.convoyLeash) {
    state(sim, s, 'screen', 'Pursuit limit reached; return to convoy protection');
    ai.goal = point(anchor.x, anchor.z);
    ai.orderSpeed = c.world.escortSpeed * KNOT * 0.8;
    return;
  }
  const usable = track && s.alert > 0 && ai.confidence > 0.15;
  if (usable && ai.role !== 'guard') {
    const aim = trackPoint(track, Math.min(20, distance(s, track) / Math.max(2, s.speed))),
      near = distance(s, aim);
    if (now < ai.reactionUntil) {
      state(sim, s, 'investigate', 'Crew evaluating a new report before maneuvering');
      ai.orderSpeed = c.world.escortSpeed * KNOT * c.ai.searchSpeed;
      return;
    }
    if (ai.role === 'assistant') {
      const h = Math.atan2(track.vx, -track.vz) || bearing(s, aim),
        u = unit(h),
        side = ai.personality.turnBias;
      state(
        sim,
        s,
        ai.seen ? 'hunt' : 'search',
        'Maintain a listening position beside the attacker’s solution',
      );
      ai.goal = point(aim.x + u.z * side * 650, aim.z - u.x * side * 650);
      ai.orderSpeed = c.world.escortSpeed * KNOT * c.ai.searchSpeed;
      return;
    }
    if (track.depth < 5 && track.age < 3 && ai.confidence > 0.55 && near < 1600 && s.attack <= 0) {
      const life = clamp(near / 250, 0.7, 5),
        noise = track.uncertainty * 0.4;
      sim.charges.push({
        type: 'enemy',
        x: wrapX(aim.x + track.vx * life + (draw(ai) - 0.5) * noise),
        z: aim.z + track.vz * life + (draw(ai) - 0.5) * noise,
        depth: 0,
        life,
        damage: c.combat.enemyDamage,
        ownerId: s.id,
      });
      s.attack = c.combat.enemyReload * (0.8 + draw(ai) * 0.4);
      log(sim, s, 'gun-attack', { aim: { ...aim }, confidence: ai.confidence });
    }
    const canAttack =
      track.depth >= 5 &&
      ai.confidence > 0.5 &&
      track.age < 12 &&
      s.attack <= 0 &&
      ai.chargesLeft > 0 &&
      (ai.role === 'attacker' || ai.role === 'independent');
    if (canAttack && near < c.ai.attackRunLength + 180) {
      const sink = track.depth / c.ai.chargeSinkRate,
        center = trackPoint(track, Math.min(35, near / Math.max(3, s.speed) + sink)),
        h = bearing(s, center),
        u = unit(h);
      if (Math.abs(angleDelta(h, s.heading)) < 0.65) {
        ai.run = {
          center,
          end: point(center.x + u.x * 350, center.z + u.z * 350),
          heading: h,
          // Cycle depth hypotheses using previous runs, never the hidden submarine depth.
          depth: clamp(track.depth + [0, 25, 50, -15][ai.failedRuns % 4], 12, 210),
          released: false,
          until: now + 65,
        };
        ai.goal = ai.run.end;
        state(sim, s, 'attack-run', 'Run across an estimated position with a spread of depth settings');
        ai.orderSpeed = c.world.escortSpeed * KNOT * 0.88;
        return;
      }
    }
    if (ai.seen || (track.source === 'shared' && track.age < 5)) {
      state(sim, s, 'hunt', 'Intercept the reported course while retaining sonar at moderate speed');
      ai.goal = aim;
      ai.orderSpeed = c.world.escortSpeed * KNOT * (track.depth < 5 ? 0.9 : 0.65);
    } else {
      state(
        sim,
        s,
        track.source === 'distress' ? 'investigate' : 'search',
        `Search ${ai.personality.doctrine} sectors around an uncertain last report`,
      );
      ai.goal = searchGoal(s);
      ai.orderSpeed = c.world.escortSpeed * KNOT * c.ai.searchSpeed;
    }
    return;
  }
  if (anchor) {
    const slot = ai.slot || 0,
      n = Math.max(1, ai.groupSize || 1),
      angle = anchor.heading + (slot * TAU) / n,
      u = unit(angle),
      radius = c.ai.convoyScreenRadius;
    ai.goal = point(anchor.x + u.x * radius, anchor.z + u.z * radius);
    state(sim, s, 'screen', 'Keep the convoy screened rather than abandon all merchants');
    ai.orderSpeed =
      distance(s, ai.goal) > 250
        ? Math.min(c.world.escortSpeed * KNOT * 0.75, anchor.speed + 4)
        : anchor.speed;
  } else {
    state(sim, s, 'patrol', 'No actionable contact; resume the shipping route');
    ai.goal = null;
    ai.orderHeading = s.baseHeading;
    ai.orderSpeed = c.world.escortSpeed * KNOT * 0.6;
  }
}

function merchantDecision(sim, s) {
  const ai = s.ai,
    c = sim.config,
    now = sim.p.time,
    damage = s.hp / s.maxHp;
  if (ai.evadeUntil > now && now >= ai.reactionUntil) {
    ai.goal = null;
    state(sim, s, 'evade', 'Comb the visible torpedo wake');
    ai.orderHeading = ai.evadeHeading;
    ai.orderSpeed = c.world.merchantSpeed * KNOT * clamp(damage + 0.15, 0.45, 1.15);
    return;
  }
  const evade = s.alert > 0 && c.world.merchantEvasion && !sim.training;
  if (evade && now >= ai.reactionUntil && now >= ai.merchantUntil) {
    const choice = draw(ai),
      side = draw(ai) < 0.5 ? -1 : 1;
    ai.merchantPlan = choice < 0.4 ? 'zigzag' : choice < 0.8 ? 'hard-turn' : 'breakaway';
    ai.merchantOffset =
      side *
      (ai.merchantPlan === 'breakaway'
        ? 0.75
        : ai.merchantPlan === 'hard-turn'
          ? 0.5
          : 0.2 + draw(ai) * 0.25);
    const low = c.ai.merchantManeuverMin,
      high = Math.max(low, c.ai.merchantManeuverMax);
    ai.merchantUntil = now + low + draw(ai) * (high - low);
    log(sim, s, 'merchant-maneuver', {
      plan: ai.merchantPlan,
      offset: ai.merchantOffset,
      until: ai.merchantUntil,
    });
  }
  if (!evade) ai.merchantOffset = 0;
  ai.orderHeading = s.baseHeading + ai.merchantOffset;
  ai.orderSpeed =
    c.world.merchantSpeed *
    KNOT *
    (sim.training ? 1 : clamp(0.5 + damage * 0.5, 0.45, 1)) *
    (evade ? 1.08 : 1);
  ai.goal = null;
  state(
    sim,
    s,
    evade ? 'evade' : 'patrol',
    evade ? `Captain chose ${ai.merchantPlan}; hold until a new tactical decision` : 'Steady convoy passage',
  );
}

function steer(sim, s, dt) {
  const ai = s.ai,
    c = sim.config;
  let desired = ai.goal ? bearing(s, ai.goal) : ai.orderHeading;
  let vx = Math.sin(desired),
    vz = -Math.cos(desired);
  for (const other of sim.ships) {
    if (other === s || other.hp <= 0) continue;
    const d = distance(s, other),
      clear = c.ai.friendlySeparation + (s.width + other.width) * 0.5;
    if (d > clear || d < 1) continue;
    vx += (deltaX(s.x, other.x) / d) * (1 - d / clear) * 2;
    vz += ((s.z - other.z) / d) * (1 - d / clear) * 2;
  }
  desired = Math.atan2(vx, -vz);
  const look = Math.max(s.length, Math.max(2, s.speed) * 8),
    u = unit(desired);
  if (isLand(s.x + u.x * look, s.z + u.z * look)) {
    let found = false;
    for (const turn of [0.45, -0.45, 0.9, -0.9, 1.5, -1.5, Math.PI]) {
      const candidate = desired + turn * ai.personality.turnBias,
        v = unit(candidate);
      if (!isLand(s.x + v.x * look, s.z + v.z * look)) {
        desired = candidate;
        found = true;
        ai.reason = 'Avoiding coastline while preserving tactical intent';
        break;
      }
    }
    if (!found) ai.orderSpeed = 0;
  }
  const turn = (s.escort ? 0.11 : 0.041) * trait(sim, s, 'skill');
  s.heading += clamp(angleDelta(desired, s.heading), -turn * dt, turn * dt);
  const targetSpeed = ai.orderSpeed || 0;
  s.speed += clamp(targetSpeed - s.speed, -1.2 * dt, 0.65 * dt);
}

export function updateEnemy(sim, s, dt) {
  s.ai ||= createAI(s.seed, s.id);
  const ai = s.ai,
    c = sim.config;
  if (s.alert <= 0 && s.track) {
    s.track = null;
    ai.confidence = 0;
    ai.searchCenter = null;
    ai.searchWaypoint = null;
  }
  if (s.track) {
    s.track.age += dt;
    s.track.uncertainty = (s.track.uncertainty || 35) + c.ai.uncertaintyGrowth * dt;
    ai.confidence =
      (s.track.confidence ?? 0.7) * Math.exp(-s.track.age / Math.max(5, c.combat.searchMemory * 0.75));
  }
  ai.sensorClock += dt;
  ai.decisionClock += dt;
  s.attack = Math.max(0, s.attack - dt);
  const sensorEvery = c.ai.sensorInterval * (0.85 + (0.3 * (s.id % 5)) / 4);
  if (ai.sensorClock >= sensorEvery) {
    ai.sensorClock %= sensorEvery;
    sampleSensors(sim, s);
  }
  if (ai.decisionClock >= c.ai.decisionInterval) {
    ai.decisionClock %= c.ai.decisionInterval;
    s.escort ? escortDecision(sim, s) : merchantDecision(sim, s);
    log(sim, s, 'decision', {
      state: s.state,
      role: ai.role,
      reason: ai.reason,
      goal: ai.goal ? { ...ai.goal } : null,
      confidence: ai.confidence,
    });
  }
  steer(sim, s, dt);
  return s.escort && ai.seen && s.track?.age < c.ai.sensorInterval * 1.8 && ai.confidence > 0.5;
}
