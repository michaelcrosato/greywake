import RAPIER from '@dimforge/rapier3d-compat';
import { HEADS, SKILLS, UPGRADES } from './config.js';
import { DEV_SETTINGS, developerDefaults, validateDeveloper } from './developer-settings.js';
import {
  AI_STATES,
  coordinateFleet,
  createAI,
  hearPing,
  reportAttack,
  restoreAI,
  updateEnemy,
} from './enemy-ai.js';
import { immersionEnvelope } from './water-math.js';
import { hullWaterPose, newWaterMotion, OceanSurface } from './water-surface.js';
import {
  angleDelta,
  bearing,
  CELL,
  cellSeed,
  clamp,
  coordinates,
  DEG,
  deltaX,
  distance,
  geo,
  isLand,
  KNOT,
  PORTS,
  planRoute,
  random,
  regionName,
  shippingHeading,
  TAU,
  wrapCellX,
  wrapX,
} from './world.js';

let physicsReady;
export async function initPhysics() {
  physicsReady ??= RAPIER.init();
  await physicsReady;
}

export function newCareer() {
  return {
    version: 1,
    name: 'U-96 · Greywake',
    x: geo(-17, 49).x,
    z: geo(-17, 49).z,
    heading: 0.18,
    speed: 5,
    throttle: 0.55,
    depth: 0,
    targetDepth: 0,
    hp: 120,
    fuel: 100,
    battery: 100,
    oxygen: 100,
    torpedoes: 14,
    shells: 80,
    bounty: 1800,
    xp: 0,
    level: 1,
    skillPoints: 1,
    skills: Object.fromEntries(SKILLS.map((s) => [s.id, 0])),
    upgrades: Object.fromEntries(UPGRADES.map((u) => [u.id, 0])),
    crewXp: 0,
    crewRank: 1,
    heads: Object.fromEntries(HEADS.map((h) => [h.department, h.choices[0][0]])),
    sunk: 0,
    tonnage: 0,
    distance: 0,
    time: 0,
    seed: 1942,
    route: [],
    destination: null,
    auto: false,
    log: [],
  };
}

export function restoreCareer(raw) {
  const p = newCareer();
  if (raw?.version !== 1) return p;
  const bounded = {
    x: [-180 * DEG, 180 * DEG],
    z: [-78 * DEG, 78 * DEG],
    heading: [-TAU, TAU],
    speed: [0, 100],
    throttle: [0, 1],
    depth: [0, 500],
    targetDepth: [0, 500],
    hp: [0, 1000],
    fuel: [0, 100],
    battery: [0, 100],
    oxygen: [0, 100],
    torpedoes: [0, 100],
    shells: [0, 1000],
    bounty: [0, 1e12],
    xp: [0, 1e9],
    level: [1, 1e5],
    skillPoints: [0, 1e5],
    crewXp: [0, 1e9],
    crewRank: [1, 20],
    sunk: [0, 1e7],
    tonnage: [0, 1e10],
    distance: [0, 1e12],
    time: [0, 1e12],
    seed: [0, 2 ** 31],
  };
  for (const [key, range] of Object.entries(bounded))
    if (Number.isFinite(raw[key])) p[key] = clamp(raw[key], ...range);
  for (const item of [...SKILLS, ...UPGRADES]) {
    const key = SKILLS.includes(item) ? 'skills' : 'upgrades';
    p[key][item.id] = Math.floor(clamp(Number(raw[key]?.[item.id]) || 0, 0, item.max));
  }
  for (const h of HEADS)
    if (h.choices.some((c) => c[0] === raw.heads?.[h.department]))
      p.heads[h.department] = raw.heads[h.department];
  if (Array.isArray(raw.log))
    p.log = raw.log
      .slice(0, 40)
      .filter((e) => typeof e.text === 'string')
      .map((e) => ({ text: e.text.slice(0, 200), time: Number(e.time) || 0 }));
  if (isLand(p.x, p.z)) {
    p.x = newCareer().x;
    p.z = newCareer().z;
  }
  if (raw.destination && Number.isFinite(raw.destination.x) && Number.isFinite(raw.destination.z)) {
    const end = {
      x: wrapX(raw.destination.x),
      z: clamp(raw.destination.z, -78 * DEG, 78 * DEG),
      name: String(raw.destination.name || 'Chart waypoint').slice(0, 80),
    };
    const route = planRoute(p, end);
    if (route) {
      p.destination = end;
      p.route = route;
      p.auto = !!raw.auto;
    }
  }
  return p;
}

export class Simulation {
  constructor(config, career = newCareer(), options = {}) {
    this.config = config;
    this.training = !!options.training;
    this.ambientTraffic = options.ambientTraffic !== false;
    this.invulnerable = !!options.invulnerable;
    this.developer = developerDefaults();
    this.aiRecording = !!options.recordAI;
    this.aiDamage = 0;
    this.aiEvents = [];
    this.aiMessages = [];
    this.aiCoordClock = 0;
    this.p = career;
    this.ships = [];
    this.torpedoes = [];
    this.charges = [];
    this.effects = [];
    this.events = [];
    this.streamed = new Set();
    this.nextId = 1;
    this.targetId = null;
    this.acceleration = 1;
    this.paused = false;
    this.rudder = 0;
    this.cooldown = 0;
    this.gunCooldown = 0;
    this.detected = false;
    this.searching = false;
    this.collisionCooldown = new Map();
    this.resourceWarnings = new Set();
    this.weather = 0;
    this.visualTime = career.time;
    this.oceanX = career.x;
    this.water = new OceanSurface(config);
    this.water.restore(null, this.visualTime);
    this.localAccumulator = 0;
    this.waterMotion = newWaterMotion();
    this.origin = { x: career.x, z: career.z };
    this.physicsTicks = 0;
    this.physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, -2 - career.depth, 0)
      .setLinearDamping(0.35)
      .enabledRotations(false, true, false)
      .setCanSleep(false);
    this.body = this.physics.createRigidBody(desc);
    this.hullCollider = this.physics.createCollider(
      RAPIER.ColliderDesc.cuboid(3, 2.8, 30).setMass(750),
      this.body,
    );
    this.body.setRotation(this.quaternion(career.heading), true);
    if (!this.training && !this.restoreEncounter(options.encounter)) this.spawnOpening();
    if (!career.log.length && !this.training)
      this.message('Independent patrol begun. Open water. Your course, your rules.');
  }

  quaternion(heading, pitch = 0, roll = 0) {
    const sx = Math.sin(pitch / 2),
      cx = Math.cos(pitch / 2),
      sy = -Math.sin(heading / 2),
      cy = Math.cos(heading / 2),
      sz = Math.sin(roll / 2),
      cz = Math.cos(roll / 2);
    return {
      x: sx * cy * cz + cx * sy * sz,
      y: cx * sy * cz - sx * cy * sz,
      z: cx * cy * sz - sx * sy * cz,
      w: cx * cy * cz + sx * sy * sz,
    };
  }
  refreshWeather() {
    this.weather = this.config.ocean.weather
      ? (0.5 + 0.5 * Math.sin(this.p.time / 320 + this.p.x / 180000)) * this.config.ocean.stormStrength
      : 0;
    this.water.weather = this.weather;
  }
  sampleWater(x, z) {
    return this.water.sample(
      this.oceanX + deltaX(x, this.p.x),
      z,
      this.renderTime ?? this.visualTime,
      this.renderWeather ?? this.weather,
      true,
      this.renderAlpha ?? 1,
    );
  }
  sampleWaterSurface(x, z, options, out) {
    return this.water.sampleSurface(
      this.oceanX + deltaX(x, this.p.x),
      z,
      {
        ...options,
        time: this.renderTime ?? this.visualTime,
        weather: this.renderWeather ?? this.weather,
        alpha: this.renderAlpha ?? 1,
      },
      out,
    );
  }
  recordAI(ship, type, details) {
    if (!this.aiRecording) return;
    this.aiEvents.push({ time: this.p.time, shipId: ship.id, type, ...details });
    if (this.aiEvents.length > 20000) this.aiEvents.splice(0, 1000);
  }
  snapshot() {
    const ships = this.ships.map(
      ({
        id,
        x,
        z,
        heading,
        escort,
        seed,
        hp,
        maxHp,
        tonnage,
        name,
        speed,
        alert,
        attack,
        sinkTime,
        baseHeading,
        track,
        state,
        alertStart,
        ai,
        convoyId,
        motion,
      }) => ({
        id,
        x,
        z,
        heading,
        escort,
        seed,
        hp,
        maxHp,
        tonnage,
        name,
        speed,
        alert,
        attack,
        sinkTime,
        baseHeading,
        track: track ? { ...track } : null,
        state,
        alertStart,
        ai: structuredClone(ai),
        convoyId,
        motion: { ...motion },
      }),
    );
    const torpedoes = this.torpedoes.map((t) => {
      const b = t.body.translation(),
        velocity = t.body.linvel();
      return {
        id: t.id,
        x: wrapX(this.origin.x + b.x),
        z: this.origin.z + b.z,
        y: b.y,
        velocity: { ...velocity },
        heading: t.heading,
        life: t.life,
        damage: t.damage,
        targetId: t.targetId,
      };
    });
    return {
      career: structuredClone(this.p),
      config: structuredClone(this.config),
      encounter: {
        version: 1,
        developer: { ...this.developer },
        developerSpeed: this.developer.enabled ? this.p.speed : 0,
        ships,
        torpedoes,
        charges: structuredClone(this.charges),
        effects: structuredClone(this.effects),
        streamed: [...this.streamed].slice(-2500),
        targetId: this.targetId,
        nextId: this.nextId,
        cooldown: this.cooldown,
        gunCooldown: this.gunCooldown,
        acceleration: this.acceleration,
        visualTime: this.visualTime,
        oceanX: this.oceanX,
        weather: this.weather,
        aiMessages: structuredClone(this.aiMessages),
        aiCoordClock: this.aiCoordClock,
        body: { y: this.body.translation().y, vy: this.body.linvel().y },
        waterMotion: { ...this.waterMotion },
        water: this.water.interactions.snapshot(),
        waterState: this.water.snapshot(),
        localAccumulator: this.localAccumulator,
        waterImpacts: this.water.impacts.map((impact) => ({ ...impact })),
      },
    };
  }
  restoreEncounter(raw) {
    if (raw?.version !== 1 || !Array.isArray(raw.ships) || !Array.isArray(raw.torpedoes)) return false;
    const finite = (value, fallback, min, max) =>
      Number.isFinite(value) ? clamp(value, min, max) : fallback;
    const validPoint = (p) =>
      p &&
      Number.isFinite(p.x) &&
      Number.isFinite(p.z) &&
      Math.abs(p.x) <= 180 * DEG &&
      Math.abs(p.z) <= 78 * DEG;
    const ids = new Set(),
      validId = (id) => Number.isInteger(id) && id > 0 && id < 1e9 && !ids.has(id);
    this.visualTime = finite(raw.visualTime, this.p.time, 0, 1e12);
    this.oceanX = finite(raw.oceanX, this.p.x, -1e12, 1e12);
    this.weather = finite(raw.weather, 0, 0, 1);
    this.waterMotion = newWaterMotion(raw.waterMotion);
    this.water.interactions.restore(raw.water);
    this.water.restore(raw.waterState, this.visualTime);
    this.localAccumulator = finite(raw.localAccumulator, 0, 0, 2);
    this.water.impacts = (Array.isArray(raw.waterImpacts) ? raw.waterImpacts : [])
      .slice(-8)
      .filter(
        (impact) => Number.isFinite(impact?.x) && Number.isFinite(impact.z) && Number.isFinite(impact.born),
      )
      .map((impact) => ({
        x: finite(impact.x, this.oceanX, -1e12, 1e12),
        z: finite(impact.z, this.p.z, -78 * DEG, 78 * DEG),
        born: finite(impact.born, this.visualTime, 0, this.visualTime),
        depth: finite(impact.depth, 0, 0, 600),
        energy: finite(impact.energy, 1, 0.1, 10),
        kind: ['shell', 'torpedo', 'depth-charge'].includes(impact.kind) ? impact.kind : 'torpedo',
      }));
    for (const row of raw.ships.slice(0, this.config.world.maxShips)) {
      if (!validPoint(row) || !validId(row.id) || isLand(row.x, row.z)) continue;
      const ship = this.addShip(
        row.x,
        row.z,
        finite(row.heading, 0, -1e8, 1e8),
        !!row.escort,
        finite(row.seed, row.id, -(2 ** 31), 2 ** 31 - 1),
      );
      if (!ship) continue;
      ids.add(row.id);
      ship.id = row.id;
      ship.maxHp = finite(row.maxHp, ship.maxHp, 1, 2000);
      ship.hp = finite(row.hp, ship.maxHp, 0, ship.maxHp);
      ship.name = typeof row.name === 'string' ? row.name.slice(0, 80) : ship.name;
      ship.tonnage = Math.round(finite(row.tonnage, ship.tonnage, 100, 50000));
      ship.speed = finite(row.speed, ship.speed, 0, 50);
      ship.alert = finite(row.alert, 0, 0, 180);
      ship.baseHeading = finite(row.baseHeading, ship.heading, -1e8, 1e8);
      ship.alertStart = finite(row.alertStart, this.p.time, 0, 1e12);
      ship.state = AI_STATES.includes(row.state) ? row.state : 'patrol';
      ship.ai = restoreAI(row.ai, ship.seed, ship.id);
      ship.motion = newWaterMotion(row.motion);
      ship.convoyId = typeof row.convoyId === 'string' ? row.convoyId.slice(0, 80) : null;
      ship.track = validPoint(row.track)
        ? {
            x: row.track.x,
            z: row.track.z,
            depth: finite(row.track.depth, 12, 0, 600),
            vx: finite(row.track.vx, 0, -50, 50),
            vz: finite(row.track.vz, 0, -50, 50),
            age: finite(row.track.age, 0, 0, 300),
            uncertainty: finite(row.track.uncertainty, 35, 0, 5000),
            depthSpread: finite(row.track.depthSpread, 35, 0, 150),
            confidence: finite(row.track.confidence, 0.7, 0, 1),
            source: ['visual', 'sonar', 'distress', 'shared', 'active-ping'].includes(row.track.source)
              ? row.track.source
              : 'shared',
            fixTime: finite(row.track.fixTime, this.p.time - finite(row.track.age, 0, 0, 300), -300, 1e12),
          }
        : null;
      ship.attack = finite(row.attack, 12, 0, 120);
      ship.sinkTime = finite(row.sinkTime, 0, 0, 100);
      ship.y =
        (Number.isFinite(row.motion?.heave) ? ship.motion.heave : this.sampleWater(ship.x, ship.z)) -
        ship.sinkTime * 0.2;
      ship.body.setTranslation(
        { x: deltaX(ship.x, this.origin.x), y: ship.y, z: ship.z - this.origin.z },
        true,
      );
    }
    for (const row of raw.torpedoes.slice(0, 64)) {
      if (!validPoint(row) || !validId(row.id) || !Number.isFinite(row.life) || row.life <= 0) continue;
      const y = finite(row.y, -2.5, -600, 10),
        heading = finite(row.heading, 0, -1e8, 1e8);
      const velocity = {
        x: finite(row.velocity?.x, Math.sin(heading) * this.config.combat.torpedoSpeed, -150, 150),
        y: finite(row.velocity?.y, 0, -30, 30),
        z: finite(row.velocity?.z, -Math.cos(heading) * this.config.combat.torpedoSpeed, -150, 150),
      };
      const body = this.physics.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(deltaX(row.x, this.origin.x), y, row.z - this.origin.z)
          .setGravityScale(0)
          .setCcdEnabled(true),
      );
      this.physics.createCollider(RAPIER.ColliderDesc.ball(0.35).setSensor(true), body);
      body.setLinvel(velocity, true);
      this.torpedoes.push({
        id: row.id,
        x: row.x,
        z: row.z,
        heading,
        body,
        life: finite(row.life, 1, 0, 1800),
        damage: finite(row.damage, this.config.combat.torpedoDamage, 0, 5000),
        targetId: row.targetId,
        wake: [],
      });
      ids.add(row.id);
    }
    this.charges = (Array.isArray(raw.charges) ? raw.charges : [])
      .slice(0, 64)
      .filter(
        (row) =>
          validPoint(row) &&
          ['shell', 'enemy'].includes(row.type) &&
          Number.isFinite(row.life) &&
          row.life > 0,
      )
      .map((row) => ({
        type: row.type,
        x: row.x,
        z: row.z,
        life: finite(row.life, 1, 0, 120),
        depth: finite(row.depth, 0, 0, 600),
        damage: finite(row.damage, 0, 0, 5000),
        targetId: row.targetId,
      }));
    this.effects = (Array.isArray(raw.effects) ? raw.effects : [])
      .slice(-32)
      .filter(
        (row) =>
          validPoint(row) &&
          ['shell', 'explosion', 'splash', 'ping', 'water-impact'].includes(row.type) &&
          Number.isFinite(row.age) &&
          Number.isFinite(row.life) &&
          row.age < row.life,
      )
      .map((row) => ({
        type: row.type,
        x: row.x,
        z: row.z,
        age: finite(row.age, 0, 0, 30),
        life: finite(row.life, 1, 0.1, 30),
        kind: ['shell', 'torpedo', 'depth-charge', 'sinking'].includes(row.kind) ? row.kind : 'torpedo',
        depth: finite(row.depth, 0, 0, 600),
        energy: finite(row.energy, 1, 0.1, 10),
        targetX: finite(row.targetX, row.x, -180 * DEG, 180 * DEG),
        targetZ: finite(row.targetZ, row.z, -78 * DEG, 78 * DEG),
      }));
    this.streamed = new Set(
      (Array.isArray(raw.streamed) ? raw.streamed : [])
        .filter((key) => typeof key === 'string' && /^-?\d+,-?\d+,\d+$/.test(key))
        .slice(-2500),
    );
    this.targetId = this.ships.some((s) => s.id === raw.targetId && s.hp > 0) ? raw.targetId : null;
    this.aiMessages = (Array.isArray(raw.aiMessages) ? raw.aiMessages : [])
      .slice(-96)
      .filter((m) => m && Number.isFinite(m.due) && validPoint(m.track) && Number.isFinite(m.track.fixTime))
      .map((m) => ({
        from: m.from,
        to: m.to,
        due: finite(m.due, this.p.time, 0, 1e12),
        track: {
          ...m.track,
          confidence: finite(m.track.confidence, 0.5, 0, 1),
          vx: finite(m.track.vx, 0, -50, 50),
          vz: finite(m.track.vz, 0, -50, 50),
          depth: finite(m.track.depth, 65, 0, 300),
          age: finite(m.track.age, 0, 0, 300),
          uncertainty: finite(m.track.uncertainty, 100, 0, 5000),
          depthSpread: finite(m.track.depthSpread, 35, 0, 150),
        },
      }));
    this.aiCoordClock = finite(raw.aiCoordClock, 0, 0, 1);
    this.nextId = Math.max(
      this.nextId,
      Math.floor(finite(raw.nextId, 1, 1, 1e9)),
      ...Array.from(ids, (id) => id + 1),
    );
    this.cooldown = finite(raw.cooldown, 0, 0, 120);
    this.gunCooldown = finite(raw.gunCooldown, 0, 0, 120);
    this.setDeveloper(validateDeveloper(raw.developer));
    if (this.developer.enabled) this.p.speed = finite(raw.developerSpeed, this.p.speed, 0, 1000);
    this.acceleration = finite(raw.acceleration, 1, 1, this.config.navigation.travelMultiplier);
    if (this.inCombat() && this.acceleration > 1)
      this.acceleration = this.dev('combatTime') ? Math.min(20, this.acceleration) : 1;
    this.body.setTranslation(
      {
        x: 0,
        y: finite(raw.body?.y, -2 - this.p.depth, -600, raw.waterState?.version === 1 ? 300 : 30),
        z: 0,
      },
      true,
    );
    this.body.setLinvel(
      {
        x: Math.sin(this.p.heading) * this.p.speed,
        y: finite(raw.body?.vy, 0, -100, 100),
        z: -Math.cos(this.p.heading) * this.p.speed,
      },
      true,
    );
    return true;
  }
  message(text) {
    this.events.push({ type: 'message', text });
    this.p.log.unshift({ text, time: this.p.time });
    this.p.log.length = Math.min(this.p.log.length, 40);
  }
  maxHp() {
    return 120 + (this.p.upgrades.hull || 0) * 30;
  }
  maxDepth() {
    return this.config.navigation.maxDepth + (this.p.upgrades.hull || 0) * 25;
  }
  head(department, trait) {
    return this.p.heads[department] === trait;
  }
  speedLimit(depth = this.p.depth) {
    if (this.labController)
      return depth > 3 ? this.labController.submergedSpeed : this.labController.surfaceSpeed;
    const base = depth > 3 ? this.config.navigation.submergedSpeed : this.config.navigation.surfaceSpeed;
    return (
      base *
      KNOT *
      this.dev('speedMultiplier') *
      (1 +
        (this.p.skills.navigator || 0) * 0.08 +
        (this.p.upgrades.engine || 0) * 0.1 +
        (this.head('Engineering', 'speed') ? 0.12 : 0) +
        (this.p.crewRank - 1) * 0.015)
    );
  }
  damageMultiplier() {
    return (
      1 +
      (this.p.skills.hunter || 0) * 0.12 +
      (this.head('Weapons', 'damage') ? 0.15 : 0) +
      (this.p.crewRank - 1) * 0.02
    );
  }
  reloadMultiplier() {
    return Math.max(
      0.2,
      1 -
        (this.p.skills.tactician || 0) * 0.15 -
        (this.head('Weapons', 'reload') ? 0.2 : 0) -
        (this.p.crewRank - 1) * 0.015,
    );
  }
  detectionRadius() {
    return (
      5500 * (1 + (this.p.upgrades.hydrophone || 0) * 0.25 + (this.head('Navigation', 'range') ? 0.3 : 0))
    );
  }
  contacts() {
    return this.ships
      .filter((s) => s.hp > 0 && distance(s, this.p) < this.detectionRadius())
      .sort((a, b) => distance(a, this.p) - distance(b, this.p));
  }
  target() {
    return this.ships.find((s) => s.id === this.targetId && s.hp > 0);
  }
  nextTarget() {
    const contacts = this.contacts();
    if (!contacts.length) {
      this.targetId = null;
      return;
    }
    const index = contacts.findIndex((s) => s.id === this.targetId);
    this.targetId = contacts[(index + 1) % contacts.length].id;
  }

  addShip(x, z, heading, escort = false, seed = this.nextId) {
    if (isLand(x, z) || this.ships.length >= this.config.world.maxShips) return null;
    const rng = random(seed),
      id = this.nextId++;
    const length = escort ? 96 : 105 + rng() * 35,
      width = escort ? 10 : 16;
    const maxHp = escort ? this.config.combat.escortHull : this.config.combat.enemyHull;
    const body = this.physics.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(deltaX(x, this.origin.x), 0, z - this.origin.z)
        .setRotation(this.quaternion(heading)),
    );
    const collider = this.physics.createCollider(RAPIER.ColliderDesc.cuboid(width / 2, 6, length / 2), body);
    const ship = {
      id,
      x: wrapX(x),
      z,
      heading,
      baseHeading: heading,
      track: null,
      state: 'patrol',
      alertStart: 0,
      escort,
      seed,
      length,
      width,
      hp: maxHp,
      maxHp,
      tonnage: escort ? 1700 : Math.round((4000 + rng() * 6000) / 100) * 100,
      name: escort
        ? ['HMS Vesper', 'HMS Halcyon', 'HMS Warden'][id % 3]
        : [
            'SS Meridian',
            'MV North Star',
            'SS Portland',
            'SS Atlantic',
            'MV Silver Bay',
            'SS Harborough',
            'SS Dunedin',
          ][id % 7],
      speed:
        (escort ? this.config.world.escortSpeed : this.config.world.merchantSpeed) *
        KNOT *
        (escort ? 0.6 : 0.9 + rng() * 0.2),
      alert: 0,
      attack: 6 + rng() * 10,
      sinkTime: 0,
      body,
      collider,
      wake: [],
      y: 0,
      pitch: 0,
      roll: 0,
      ai: createAI(seed, id),
      motion: newWaterMotion(),
      convoyId: null,
    };
    this.ships.push(ship);
    ship.ai.orderHeading = heading;
    ship.ai.orderSpeed = ship.speed;
    return ship;
  }
  spawnOpening() {
    if (this.training || !this.ambientTraffic || this.dev('pauseTraffic')) return;
    const p = this.p;
    if (p.sunk === 0 && p.time < 300) {
      const a = this.addShip(p.x + 380, p.z - 480, 0.8, false, 96);
      this.addShip(p.x + 570, p.z - 800, 0.8, false, 97);
      this.addShip(p.x + 1700, p.z - 1950, 0.7, true, 98);
      for (const ship of this.ships) ship.convoyId = 'opening-convoy';
      if (a) this.targetId = a.id;
    }
    this.stream();
  }
  stream() {
    if (this.training || !this.ambientTraffic || this.dev('pauseTraffic')) return;
    const p = this.p,
      r = Math.ceil(this.config.world.streamRadius / CELL),
      cx = Math.floor(p.x / CELL),
      cz = Math.floor(p.z / CELL);
    const cells = [];
    for (let z = -r; z <= r; z++) for (let x = -r; x <= r; x++) cells.push([wrapCellX(cx + x), cz + z]);
    cells.sort(
      (a, b) =>
        distance({ x: (a[0] + 0.5) * CELL, z: (a[1] + 0.5) * CELL }, p) -
        distance({ x: (b[0] + 0.5) * CELL, z: (b[1] + 0.5) * CELL }, p),
    );
    for (const [x, z] of cells) {
      if (this.ships.length >= this.config.world.maxShips) break;
      if (
        distance({ x: (x + 0.5) * CELL, z: (z + 0.5) * CELL }, p) >
        this.config.world.streamRadius + CELL * 0.5
      )
        continue;
      const key = `${x},${z},${Math.floor(p.time / 21600)}`;
      if (this.streamed.has(key)) continue;
      this.streamed.add(key);
      const rng = random(cellSeed(x, z, Math.floor(p.time / 21600)) ^ p.seed),
        lane = shippingHeading(x * CELL, z * CELL);
      const count = Math.floor(this.config.world.trafficDensity * lane.density + rng());
      const convoy = rng() < this.config.world.convoyChance;
      const bx = (x + rng()) * CELL,
        bz = (z + rng()) * CELL;
      for (let i = 0; i < count; i++) {
        const sx = convoy ? bx + i * 430 : (x + rng()) * CELL,
          sz = convoy ? bz - i * 600 : (z + rng()) * CELL;
        if (distance({ x: sx, z: sz }, p) < 2800 && p.time < 300) continue;
        if (distance({ x: sx, z: sz }, p) > this.config.world.streamRadius) continue;
        const ship = this.addShip(
          sx,
          sz,
          lane.heading + (rng() - 0.5) * 0.35,
          rng() < this.config.world.escortChance,
          cellSeed(x + i, z),
        );
        if (ship && convoy) ship.convoyId = `convoy:${key}`;
      }
    }
    if (this.streamed.size > 2500) this.streamed = new Set([...this.streamed].slice(-1500));
  }

  rebase() {
    if (distance(this.p, this.origin) < 1600) return;
    const dx = deltaX(this.p.x, this.origin.x),
      dz = this.p.z - this.origin.z;
    this.origin = { x: this.p.x, z: this.p.z };
    this.physics.forEachRigidBody((body) => {
      const t = body.translation();
      body.setTranslation({ x: t.x - dx, y: t.y, z: t.z - dz }, false);
    });
  }
  setDestination(end, name = 'Chart waypoint') {
    const route = planRoute(this.p, end);
    if (!route) {
      this.message('No open-water route found. Choose a point farther offshore.');
      return false;
    }
    this.p.destination = { ...end, name };
    this.p.route = route;
    this.p.auto = true;
    this.p.throttle = Math.max(0.65, this.p.throttle);
    this.message(
      `Navigator: course set for ${name}. ${Math.round(route.reduce((v, b, i) => v + distance(i ? route[i - 1] : this.p, b), 0) / 1852).toLocaleString()} nautical miles.`,
    );
    return true;
  }
  setAcceleration(value) {
    if (!Number.isFinite(value) || value < 1) return false;
    if (this.inCombat() && value > 1 && !this.dev('combatTime')) {
      this.message('Time acceleration unavailable near contacts. Clear the area first.');
      return false;
    }
    this.acceleration = Math.min(
      this.config.navigation.travelMultiplier,
      value,
      this.inCombat() ? 20 : Infinity,
    );
    return true;
  }
  inCombat() {
    return (
      this.torpedoes.length > 0 ||
      this.charges.length > 0 ||
      this.ships.some(
        (s) =>
          s.hp > 0 &&
          distance(s, this.p) <
            Math.max(
              this.config.navigation.contactRadius,
              s.escort && s.alert > 0 ? this.config.combat.detectionRange : 0,
            ),
      )
    );
  }
  dive(depth) {
    this.p.targetDepth = clamp(depth, 0, this.maxDepth());
  }

  effectiveShipSpeed(ship) {
    return this.dev('freezeEnemies') && !this.labShipMotion ? 0 : ship.speed;
  }
  intercept(target, speed) {
    const rx = deltaX(target.x, this.p.x),
      rz = target.z - this.p.z;
    const vx = Math.sin(target.heading) * this.effectiveShipSpeed(target),
      vz = -Math.cos(target.heading) * this.effectiveShipSpeed(target);
    const a = vx * vx + vz * vz - speed * speed,
      b = 2 * (rx * vx + rz * vz),
      c = rx * rx + rz * rz;
    const discriminant = b * b - 4 * a * c;
    let t = Math.sqrt(c) / speed;
    if (discriminant >= 0 && Math.abs(a) > 0.001) {
      const roots = [
        (-b - Math.sqrt(discriminant)) / (2 * a),
        (-b + Math.sqrt(discriminant)) / (2 * a),
      ].filter((v) => v > 0);
      if (roots.length) t = Math.min(...roots);
    }
    return { heading: Math.atan2(rx + vx * t, -(rz + vz * t)), seconds: t };
  }
  fireTorpedo() {
    const target = this.target(),
      p = this.p,
      c = this.config.combat;
    if (p.hp <= 0) return false;
    if (this.paused) {
      this.message('Resume the patrol before launching a torpedo.');
      return false;
    }
    if (!target) {
      this.message('Select a contact before firing.');
      return false;
    }
    if (p.depth > 18) {
      this.message('Torpedo launch requires surface or periscope depth (18 m or less).');
      return false;
    }
    if (this.cooldown > 0 && !this.dev('noReload')) return false;
    if (p.torpedoes < 1 && !this.dev('infiniteAmmo')) {
      this.message('Torpedo room empty. Resupply at a harbor.');
      return false;
    }
    const range = c.torpedoRange * (1 + (p.skills.range || 0) * 0.15);
    if (distance(target, p) > range) {
      this.message('Target outside torpedo range.');
      return false;
    }
    const solution = this.intercept(target, c.torpedoSpeed),
      h = solution.heading;
    const x = p.x + Math.sin(h) * 38,
      z = p.z - Math.cos(h) * 38;
    const body = this.physics.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(deltaX(x, this.origin.x), -2.5, z - this.origin.z)
        .setGravityScale(0)
        .setCcdEnabled(true),
    );
    this.physics.createCollider(RAPIER.ColliderDesc.ball(0.35).setSensor(true), body);
    body.setLinvel({ x: Math.sin(h) * c.torpedoSpeed, y: 0, z: -Math.cos(h) * c.torpedoSpeed }, true);
    this.torpedoes.push({
      id: this.nextId++,
      x,
      z,
      heading: h,
      body,
      life: range / c.torpedoSpeed,
      damage: c.torpedoDamage * this.damageMultiplier() * (1 + (p.upgrades.tubes || 0) * 0.1),
      targetId: target.id,
      wake: [],
    });
    if (!this.dev('infiniteAmmo')) p.torpedoes--;
    this.cooldown = this.dev('noReload')
      ? 0
      : c.torpedoReload * this.reloadMultiplier() * (1 - (p.upgrades.tubes || 0) * 0.08);
    this.acceleration = 1;
    this.events.push({ type: 'torpedo' });
    this.message(`Tube away. ${target.name}, estimated impact ${Math.ceil(solution.seconds)} seconds.`);
    return true;
  }
  weaponReadiness(kind) {
    const p = this.p,
      target = this.target(),
      torpedo = kind === 'torpedo';
    const range = torpedo
      ? this.config.combat.torpedoRange * (1 + (p.skills.range || 0) * 0.15)
      : this.config.combat.gunRange;
    const cooldown = this.dev('noReload') ? 0 : torpedo ? this.cooldown : this.gunCooldown,
      ammo = this.dev('infiniteAmmo') ? Infinity : torpedo ? p.torpedoes : p.shells;
    let reason = '';
    if (p.hp <= 0) reason = 'Boat lost';
    else if (this.paused) reason = 'Patrol paused · resume with P';
    else if (p.depth > (torpedo ? 18 : 2))
      reason = torpedo ? 'Too deep · ascend to 18 m or less' : 'Submerged · surface for deck gun';
    else if (ammo < 1) reason = torpedo ? 'Torpedoes empty · resupply' : 'Shells empty · resupply';
    else if (!target) reason = 'Select a contact first';
    else if (distance(target, p) > range) reason = `Outside ${Math.round(range)} m range`;
    else if (cooldown > 0) reason = `Reloading · ${cooldown.toFixed(1)}s`;
    return { ready: !reason, reason, range, cooldown, ammo };
  }
  fireGun() {
    const target = this.target(),
      p = this.p,
      c = this.config.combat;
    if (p.hp <= 0 || (this.gunCooldown > 0 && !this.dev('noReload'))) return false;
    if (this.paused) {
      this.message('Resume the patrol before firing the deck gun.');
      return false;
    }
    if (p.depth > 2) {
      this.message('Deck gun is unavailable while submerged.');
      return false;
    }
    if (!target || distance(target, p) > c.gunRange) {
      this.message('Deck gun needs a contact within range.');
      return false;
    }
    if (p.shells <= 0 && !this.dev('infiniteAmmo')) {
      this.message('Deck ammunition exhausted.');
      return false;
    }
    if (!this.dev('infiniteAmmo')) p.shells--;
    this.gunCooldown = this.dev('noReload') ? 0 : c.gunReload * this.reloadMultiplier();
    this.acceleration = 1;
    const solution = this.intercept(target, c.shellSpeed),
      life = solution.seconds;
    const rng = random((this.nextId++ * 7919) ^ p.seed),
      spread = this.training ? 0 : (c.gunDispersion * distance(target, p)) / c.gunRange;
    const impactX = wrapX(
      target.x +
        Math.sin(target.heading) * this.effectiveShipSpeed(target) * life +
        (rng() - 0.5) * spread * 2,
    );
    const impactZ =
      target.z -
      Math.cos(target.heading) * this.effectiveShipSpeed(target) * life +
      (rng() - 0.5) * spread * 2;
    this.effects.push({
      type: 'shell',
      x: p.x,
      z: p.z,
      targetX: impactX,
      targetZ: impactZ,
      age: 0,
      life,
    });
    this.charges.push({
      type: 'shell',
      x: impactX,
      z: impactZ,
      life,
      targetId: target.id,
      damage: c.gunDamage * this.damageMultiplier(),
    });
    this.events.push({ type: 'gun' });
    return true;
  }
  sonarPing() {
    this.events.push({ type: 'ping' });
    this.effects.push({ type: 'ping', x: this.p.x, z: this.p.z, age: 0, life: 5 });
    const contacts = this.contacts();
    this.message(
      `Hydrophone: ${contacts.length} contacts. ${contacts.filter((s) => s.escort).length} escorts.`,
    );
    for (const s of contacts)
      if (s.escort && distance(s, this.p) < this.config.combat.sonarRange * 1.5) hearPing(this, s);
  }

  waterImpact(kind, x, z, depth = 0, energy = 1) {
    this.water.impact(this.oceanX + deltaX(x, this.p.x), z, kind, energy, depth);
    this.effects.push({
      type: 'water-impact',
      kind,
      x: wrapX(x),
      z,
      depth,
      energy,
      age: 0,
      life: kind === 'shell' ? 6 : 15,
    });
  }
  hitShip(ship, damage, impact = null) {
    if (ship.hp <= 0) return;
    ship.hp = Math.max(0, ship.hp - damage);
    reportAttack(this, ship);
    const x = impact?.x ?? ship.x,
      z = impact?.z ?? ship.z;
    this.effects.push({ type: 'explosion', x, z, age: 0, life: 5 });
    this.waterImpact(impact?.kind || 'torpedo', x, z, impact?.depth ?? 2.5, damage / 78);
    this.events.push({ type: 'explosion', intensity: 1 });
    if (ship.hp <= 0) {
      this.p.sunk++;
      this.p.tonnage += ship.tonnage;
      const bounty = Math.round((ship.escort ? 1800 : ship.tonnage * 0.28) * this.config.economy.bountyScale);
      this.p.bounty += bounty;
      this.awardXp(ship.escort ? 400 : 280);
      this.awardCrewXp(ship.escort ? 140 : 100);
      this.message(
        `${ship.name} sunk · ${ship.tonnage.toLocaleString()} tons · +${bounty.toLocaleString()} bounty.`,
      );
      if (this.targetId === ship.id) this.targetId = null;
    } else this.message(`${ship.name} hit. ${Math.round(ship.hp)} hull remaining.`);
  }
  hurt(damage, kind = 'enemy') {
    if (!this.training && damage > 0) {
      this.aiDamage += damage;
      this.recordAI({ id: 0 }, 'damage', { amount: damage, kind });
    }
    if (this.training || this.invulnerable || this.dev('invulnerable')) return;
    if (this.p.hp <= 0) return;
    this.p.hp = Math.max(0, this.p.hp - damage);
    this.events.push({ type: 'hurt' });
    if (this.p.hp <= 0) {
      this.acceleration = 1;
      this.p.auto = false;
      this.message('Pressure hull lost. The salvage crew is standing by.');
    }
  }
  awardXp(amount) {
    const p = this.p;
    p.xp += amount * this.config.economy.xpScale;
    const level = Math.floor(Math.sqrt(p.xp / this.config.economy.skillXp)) + 1;
    if (level > p.level) {
      p.skillPoints += level - p.level;
      p.level = level;
      this.message(`Captain promoted to level ${level}. Skill point available.`);
    }
  }
  awardCrewXp(amount) {
    this.p.crewXp += amount * this.config.economy.crewXpScale;
    const rank = Math.min(10, Math.floor(Math.sqrt(this.p.crewXp / this.config.economy.crewRankXp)) + 1);
    if (rank > this.p.crewRank) {
      this.p.crewRank = rank;
      this.message(`All departments advanced to crew rank ${rank}.`);
    }
  }
  buySkill(id) {
    const skill = SKILLS.find((s) => s.id === id),
      p = this.p;
    if (
      !skill ||
      p.skillPoints < 1 ||
      (p.skills[id] || 0) >= skill.max ||
      (skill.requires && !p.skills[skill.requires])
    )
      return false;
    p.skills[id] = (p.skills[id] || 0) + 1;
    p.skillPoints--;
    this.message(`Captain trained: ${skill.name}, rank ${p.skills[id]}.`);
    return true;
  }
  upgradePrice(id) {
    const u = UPGRADES.find((item) => item.id === id);
    return u
      ? Math.round(u.cost * (1 + (this.p.upgrades[id] || 0) * 0.75) * this.config.economy.upgradeCost)
      : Infinity;
  }
  buyUpgrade(id) {
    const upgrade = UPGRADES.find((u) => u.id === id),
      price = this.upgradePrice(id),
      p = this.p;
    if (!upgrade || (p.upgrades[id] || 0) >= upgrade.max || p.bounty < price) return false;
    p.bounty -= price;
    p.upgrades[id] = (p.upgrades[id] || 0) + 1;
    if (id === 'hull') p.hp = Math.min(this.maxHp(), p.hp + 30);
    this.message(`${upgrade.name} refit installed, tier ${p.upgrades[id]}.`);
    return true;
  }
  setHead(department, trait) {
    const head = HEADS.find((h) => h.department === department);
    if (!head?.choices.some((c) => c[0] === trait)) return false;
    this.p.heads[department] = trait;
    this.message(`${head.name}: ${head.choices.find((c) => c[0] === trait)[1]} doctrine active.`);
    return true;
  }
  nearestPort() {
    return PORTS.reduce((best, p) => (distance(this.p, p) < distance(this.p, best) ? p : best), PORTS[0]);
  }
  servicePrice() {
    return Math.ceil(
      ((this.maxHp() - this.p.hp) * 5 +
        (100 - this.p.fuel) * 3 +
        (14 - Math.min(14, this.p.torpedoes)) * 65 +
        (80 - Math.min(80, this.p.shells)) * 2) *
        this.config.economy.serviceCost,
    );
  }
  service() {
    if (distance(this.p, this.nearestPort()) > 8000 || this.p.depth > 2) {
      this.message('Harbor service requires surfacing within 8 km of a marked harbor.');
      return false;
    }
    const cost = this.servicePrice();
    if (this.p.bounty < cost) {
      this.message('Insufficient bounty for harbor service.');
      return false;
    }
    this.p.bounty -= cost;
    Object.assign(this.p, {
      hp: this.maxHp(),
      fuel: 100,
      battery: 100,
      oxygen: 100,
      torpedoes: 14,
      shells: 80,
    });
    this.message(`Harbor service complete · ${cost} bounty.`);
    return true;
  }
  salvage() {
    const port = this.nearestPort();
    Object.assign(this.p, {
      x: port.x,
      z: port.z,
      depth: 0,
      targetDepth: 0,
      hp: this.maxHp(),
      fuel: 100,
      battery: 100,
      oxygen: 100,
      torpedoes: 14,
      shells: 80,
      bounty: Math.floor(this.p.bounty * 0.75),
      speed: 0,
      throttle: 0,
      auto: false,
      route: [],
      destination: null,
    });
    this.teleportBodies();
    this.message(`Recovered at ${port.name}. Salvage fee: 25% of current bounty. Career retained.`);
  }
  teleportBodies(preserveShips = false) {
    if (!preserveShips) for (const s of this.ships) this.physics.removeRigidBody(s.body);
    for (const t of this.torpedoes) this.physics.removeRigidBody(t.body);
    if (!preserveShips) {
      this.ships = [];
      this.streamed.clear();
      this.targetId = null;
    }
    this.torpedoes = [];
    this.charges = [];
    this.effects = [];
    this.detected = this.searching = false;
    this.aiMessages = [];
    this.collisionCooldown.clear();
    this.resourceWarnings.clear();
    this.cooldown = this.gunCooldown = 0;
    this.acceleration = 1;
    this.rudder = 0;
    const previousPhase = this.water.phase,
      previousClock = this.water.clockTime;
    this.water = new OceanSurface(this.config);
    this.water.phase = previousPhase;
    this.water.clockTime = previousClock;
    this.water.ensure(this.visualTime);
    this.previousPose = null;
    this.waterMotion = newWaterMotion();
    this.origin = { x: this.p.x, z: this.p.z };
    this.oceanX = this.p.x;
    for (const ship of this.ships)
      ship.body.setTranslation(
        { x: deltaX(ship.x, this.origin.x), y: ship.y, z: ship.z - this.origin.z },
        true,
      );
    this.body.setTranslation({ x: 0, y: -2 - this.p.depth, z: 0 }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.resetForces(true);
    this.body.setRotation(this.quaternion(this.p.heading), true);
    this.stream();
  }
  dev(key) {
    return this.developer.enabled ? this.developer[key] : DEV_SETTINGS[key][1];
  }
  setDeveloper(patch) {
    const wasEnabled = this.developer.enabled;
    this.developer = validateDeveloper({ ...this.developer, ...patch });
    this.hullCollider.setSensor(!!this.dev('noClip'));
    this.body.enableCcd(this.developer.enabled && !this.dev('noClip'));
    if (wasEnabled && !this.developer.enabled) {
      this.p.speed = Math.min(this.p.speed, this.speedLimit());
      this.body.setLinvel(
        {
          x: Math.sin(this.p.heading) * this.p.speed,
          y: this.body.linvel().y,
          z: -Math.cos(this.p.heading) * this.p.speed,
        },
        true,
      );
    }
    if (this.dev('invulnerable') && this.p.hp <= 0) this.p.hp = this.maxHp();
    if (this.dev('noReload')) this.cooldown = this.gunCooldown = 0;
    if (this.dev('infiniteResources')) this.p.fuel = this.p.battery = this.p.oxygen = 100;
    if (!this.dev('combatTime') && this.inCombat()) this.acceleration = 1;
    return this.developer;
  }
  clearEncounter() {
    for (const ship of this.ships) this.physics.removeRigidBody(ship.body);
    for (const torpedo of this.torpedoes) this.physics.removeRigidBody(torpedo.body);
    this.ships = [];
    this.torpedoes = [];
    this.charges = [];
    this.effects = [];
    this.targetId = null;
    this.detected = this.searching = false;
    this.aiMessages = [];
    this.collisionCooldown.clear();
    this.water.impacts = [];
  }
  developerTeleport(x, z, depth = this.p.depth, heading = this.p.heading, preserveShips = false) {
    if (!this.developer.enabled) throw new Error('Enable developer mode first.');
    if (
      ![x, z, depth, heading].every(Number.isFinite) ||
      Math.abs(x) > 180 * DEG ||
      Math.abs(z) > 78 * DEG ||
      depth < 0 ||
      depth > 500
    )
      throw new Error('Enter valid coordinates and a depth from 0 to 500 m.');
    x = wrapX(x);
    if (!this.dev('noClip') && isLand(x, z))
      throw new Error('Destination is on land. Choose open water or enable no collisions/grounding.');
    Object.assign(this.p, {
      x,
      z,
      depth,
      targetDepth: depth,
      heading: Math.atan2(Math.sin(heading), Math.cos(heading)),
      speed: 0,
      throttle: 0,
      auto: false,
      route: [],
      destination: null,
    });
    this.teleportBodies(preserveShips);
    this.message(
      `Developer teleport: ${(x / DEG).toFixed(3)}° longitude, ${(-z / DEG).toFixed(3)}° latitude, ${depth} m.`,
    );
  }
  developerStep(seconds) {
    if (!this.developer.enabled || !Number.isFinite(seconds) || seconds <= 0 || seconds > 10) return false;
    const paused = this.paused,
      accumulator = this.localAccumulator,
      acceleration = this.acceleration;
    this.paused = false;
    this.acceleration = 1;
    this.localAccumulator = 0;
    try {
      const ticks = Math.max(1, Math.round(seconds * 30));
      for (let i = 0; i < ticks; i++) this.update(seconds / ticks);
    } finally {
      this.paused = paused;
      this.localAccumulator = accumulator;
      this.acceleration =
        this.inCombat() && acceleration > 1
          ? this.dev('combatTime')
            ? Math.min(20, acceleration)
            : 1
          : acceleration;
    }
    return true;
  }
  debug(action) {
    if (action === 'funds') {
      this.p.bounty += 10000;
      this.awardXp(1500);
      this.awardCrewXp(800);
    }
    if (action === 'restore')
      Object.assign(this.p, {
        hp: this.maxHp(),
        fuel: 100,
        battery: 100,
        oxygen: 100,
        torpedoes: 30,
        shells: 200,
      });
    if (action === 'convoy')
      for (let i = 0; i < 4; i++)
        this.addShip(this.p.x + 500 + i * 350, this.p.z - 600 - i * 200, 1, i === 3, this.nextId * 13);
    if (action === 'clear') {
      for (const s of this.ships) this.physics.removeRigidBody(s.body);
      this.ships = [];
      this.targetId = null;
    }
    this.message(`Playtest action: ${action}.`);
  }

  update(realDt) {
    const wallDt = realDt;
    const frameStart = performance.now();
    if (this.paused || this.p.hp <= 0) return;
    realDt = Math.min(0.1, realDt);
    if (this.acceleration > 1 && this.inCombat() && (!this.dev('combatTime') || this.acceleration > 20)) {
      this.acceleration = this.dev('combatTime') ? 20 : 1;
      this.message(
        this.dev('combatTime')
          ? 'Developer combat compression capped at 20×.'
          : 'Contact nearby. Time acceleration returned to 1×.',
      );
    }
    const dt = realDt * this.acceleration;
    if (this.acceleration > 20) {
      // Strategic integration still checks route, resources, land and newly streamed encounters.
      let remaining = dt;
      const before = this.p.time;
      while (remaining > 0) {
        const relativeSpeed =
          this.p.speed +
          Math.max(this.config.world.escortSpeed, this.config.world.merchantSpeed) * KNOT * 1.1;
        const step = Math.min(20, 200 / Math.max(1, relativeSpeed), remaining);
        this.advance(step, true);
        remaining -= step;
        if (this.inCombat() || this.acceleration === 1) {
          this.acceleration = 1;
          break;
        }
      }
      const accepted = this.p.time - before;
      this.refreshWeather();
      this.visualTime += accepted;
      this.water.advanceTime(accepted);
      this.water.interactions.recenter(this.oceanX, this.p.z);
      this.water.interactions.height.fill(0);
      this.water.interactions.velocity.fill(0);
      this.water.contactHistory.clear();
      for (const cascade of this.water.cascades)
        for (let i = 0; i < cascade.foam.length; i++)
          cascade.foam[i] *= Math.exp(-accepted / this.config.waterInteraction.whitecapDecay);
      const decay = Math.exp(-accepted / this.config.ocean.foamLifetime);
      for (let i = 0; i < this.water.interactions.foam.length; i++) this.water.interactions.foam[i] *= decay;
      this.water.interactions.pack();
      this.water.sprayEvents.length = 0;
      this.water.impacts = this.water.impacts.filter((impact) => this.visualTime - impact.born < 15);
      this.water.ensure(this.visualTime);
      this.waterMotion = newWaterMotion({
        wetness: this.waterMotion.wetness * Math.exp(-accepted / this.config.waterInteraction.dryTime),
      });
      this.localAccumulator = 0;
      this.rebase();
      this.body.setTranslation(
        { x: deltaX(this.p.x, this.origin.x), y: -2 - this.p.depth, z: this.p.z - this.origin.z },
        true,
      );
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.syncShipBodies();
      this.physics.timestep = 1 / 60;
      this.physics.step();
      this.physicsTicks++;
    } else {
      const step = 1 / 30;
      this.localAccumulator = Math.min(2, this.localAccumulator + dt);
      const steps = Math.min(16, Math.floor((this.localAccumulator + 1e-9) / step));
      let acceptedSteps = 0;
      for (let i = 0; i < steps; i++) {
        if (i > 0 && performance.now() - frameStart > 12) break;
        const pose = (this.previousPose ||= {});
        Object.assign(pose, {
          x: this.p.x,
          z: this.p.z,
          y: this.body.translation().y,
          heading: this.p.heading,
          pitch: this.waterMotion.pitch,
          roll: this.waterMotion.roll,
          weather: this.weather,
        });
        for (const ship of this.ships)
          Object.assign((ship.previousPose ||= {}), {
            x: ship.x,
            z: ship.z,
            y: ship.y,
            heading: ship.heading,
            pitch: ship.motion.pitch,
            roll: ship.motion.roll,
          });
        this.advance(step, false);
        this.refreshWeather();
        this.visualTime += step;
        this.water.update(this, step);
        this.stepPhysics(step);
        for (const effect of this.effects) effect.age += step;
        acceptedSteps++;
      }
      this.localAccumulator = Math.max(0, this.localAccumulator - acceptedSteps * step);
      this.achievedAcceleration = wallDt > 0 ? (acceptedSteps * step) / wallDt : 0;
    }
    if (this.acceleration > 20) for (const effect of this.effects) effect.age += dt;
    this.effects = this.effects.filter((e) => e.age < e.life);
  }

  advance(dt, strategic) {
    const p = this.p,
      c = this.config;
    p.time += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.gunCooldown = Math.max(0, this.gunCooldown - dt);
    const maneuver = this.dev('maneuverMultiplier');
    const acceleration = this.labController?.acceleration ?? c.navigation.acceleration * maneuver;
    const turnRate = this.labController?.turnRate ?? c.navigation.turnRate * maneuver;
    const diveRate = this.labController?.diveRate ?? c.navigation.diveRate * maneuver;
    if (this.dev('infiniteResources')) p.fuel = p.battery = p.oxygen = 100;
    const previousDepth = p.depth;
    p.depth += clamp(p.targetDepth - p.depth, -diveRate * dt, diveRate * dt);
    const powered = p.depth > 3 ? p.battery > 0 && p.oxygen > 0 : p.fuel > 0;
    if (p.depth > 3 && (p.battery <= 0 || p.oxygen <= 0)) {
      p.targetDepth = 0;
      if (previousDepth > 3) this.acceleration = 1;
    }
    p.speed += clamp(
      (powered ? this.speedLimit() * p.throttle : 0) - p.speed,
      -acceleration * dt,
      acceleration * dt,
    );
    if (p.auto && p.route.length) {
      const next = p.route[0],
        d = distance(next, p);
      if (d < Math.max(100, p.speed * dt * 1.5)) {
        p.route.shift();
        if (!p.route.length) {
          p.auto = false;
          p.throttle = 0;
          this.acceleration = 1;
          this.message(`Arrived at ${p.destination?.name || 'waypoint'}. Engines stopped.`);
        }
      } else
        p.heading += clamp(
          angleDelta(bearing(p, next), p.heading),
          ((-turnRate * Math.PI) / 180) * dt,
          ((turnRate * Math.PI) / 180) * dt,
        );
    } else p.heading += ((this.rudder * turnRate * Math.PI) / 180) * dt;
    p.heading = Math.atan2(Math.sin(p.heading), Math.cos(p.heading));
    if (strategic) {
      const next = {
        x: wrapX(p.x + Math.sin(p.heading) * p.speed * dt),
        z: p.z - Math.cos(p.heading) * p.speed * dt,
      };
      if (this.dev('noClip') || !isLand(next.x, next.z)) {
        this.oceanX += deltaX(next.x, p.x);
        p.x = next.x;
        p.z = next.z;
      } else {
        p.auto = false;
        p.throttle = 0;
        p.speed = 0;
        this.acceleration = 1;
        this.message('Shallow water ahead. Helm stopped to prevent grounding.');
      }
    }
    p.distance += p.speed * dt;
    const hours = dt / 3600;
    if (p.depth < 3) {
      p.fuel = clamp(
        p.fuel - hours * c.navigation.fuelUse * p.throttle * (this.head('Engineering', 'economy') ? 0.8 : 1),
        0,
        100,
      );
      p.battery = Math.min(100, p.battery + hours * 24);
      p.oxygen = Math.min(100, p.oxygen + dt * 0.4);
    } else {
      p.battery = clamp(
        p.battery -
          hours * c.navigation.batteryUse * (0.2 + p.throttle * 0.8) * (1 - (p.upgrades.battery || 0) * 0.15),
        0,
        100,
      );
      p.oxygen = clamp(p.oxygen - hours * c.navigation.oxygenUse, 0, 100);
    }
    if (this.dev('infiniteResources')) p.fuel = p.battery = p.oxygen = 100;
    this.warnResources();
    if (!this.detected && p.hp > 0)
      p.hp = Math.min(
        this.maxHp(),
        p.hp +
          ((c.combat.repairRate * dt) / 60) * (1 + (p.skills.engineer || 0) * 0.6 + (p.crewRank - 1) * 0.05),
      );
    this.awardCrewXp(dt / 120);
    if (!this.dev('freezeEnemies')) coordinateFleet(this, dt);
    let detected = false;
    for (const s of this.ships) {
      if (this.dev('freezeEnemies')) continue;
      if (s.hp <= 0) {
        s.sinkTime += dt;
        continue;
      }
      s.alert = Math.max(0, s.alert - dt);
      const contact = updateEnemy(this, s, dt);
      if (s.escort) detected = contact || detected;
      const next = {
        x: wrapX(s.x + Math.sin(s.heading) * s.speed * dt),
        z: s.z - Math.cos(s.heading) * s.speed * dt,
      };
      if (isLand(next.x, next.z)) s.heading += Math.PI;
      else {
        s.x = next.x;
        s.z = next.z;
      }
    }
    if (detected && !this.detected) this.message('Escort has your signature. Evade or fight.');
    this.detected = detected;
    this.searching = this.ships.some((s) => s.escort && s.alert > 0 && !detected && distance(s, p) < 4500);
    for (const charge of this.charges) {
      charge.life -= dt;
      if (charge.life <= 0) {
        if (charge.type === 'shell') {
          const s = this.ships.find((v) => v.id === charge.targetId);
          const dx = s ? deltaX(charge.x, s.x) : 0,
            dz = s ? charge.z - s.z : 0;
          const across = s ? dx * Math.cos(s.heading) + dz * Math.sin(s.heading) : 0;
          const along = s ? dx * Math.sin(s.heading) - dz * Math.cos(s.heading) : 0;
          if (s && s.hp > 0 && Math.abs(across) < s.width * 0.65 && Math.abs(along) < s.length * 0.55)
            this.hitShip(s, charge.damage, { kind: 'shell', x: charge.x, z: charge.z, depth: 0 });
          else {
            this.waterImpact('shell', charge.x, charge.z, 0, charge.damage / 26);
            this.events.push({ type: 'splash' });
            this.message('Shell fell wide. Recheck range and the target’s course.');
          }
        } else {
          if (distance(charge, p) < 75 && Math.abs(p.depth - charge.depth) < 30) this.hurt(charge.damage);
          this.waterImpact('depth-charge', charge.x, charge.z, charge.depth, charge.damage / 12);
          this.events.push({ type: 'explosion', intensity: 0.4 });
        }
      }
    }
    this.charges = this.charges.filter((ch) => ch.life > 0);
    const remove = this.ships.filter((s) => distance(s, p) > c.world.streamRadius * 1.1 || s.sinkTime > 100);
    for (const ship of remove) {
      this.physics.removeRigidBody(ship.body);
      this.collisionCooldown.delete(ship.id);
    }
    this.ships = this.ships.filter((s) => !remove.includes(s));
    if (Math.floor((p.time - dt) / 5) !== Math.floor(p.time / 5) || strategic) this.stream();
  }
  warnResources() {
    const p = this.p;
    const checks = [
      ['fuel', p.fuel, 25, 'Diesel below 25%. Plot a harbor stop before the tanks run dry.'],
      [
        'battery',
        p.depth > 3 ? p.battery : 100,
        15,
        'Battery below 15%. Surface to recharge; time compression stopped.',
      ],
      [
        'oxygen',
        p.depth > 3 ? p.oxygen : 100,
        20,
        'Oxygen below 20%. Surface for fresh air; time compression stopped.',
      ],
      [
        'hull',
        (p.hp / this.maxHp()) * 100,
        25,
        'Hull integrity below 25%. Evade the escort and plan harbor service.',
      ],
      ['ammo', p.torpedoes, 1, 'One torpedo or fewer remains. Plan ammunition resupply at a harbor.'],
    ];
    for (const [key, value, threshold, message] of checks) {
      if (value <= threshold && !this.resourceWarnings.has(key)) {
        this.resourceWarnings.add(key);
        this.message(message);
        if ((key === 'battery' || key === 'oxygen') && this.acceleration > 1) this.acceleration = 1;
      } else if (value > threshold + 5) this.resourceWarnings.delete(key);
    }
  }
  updateEscort(s, dt) {
    return updateEnemy(this, s, dt);
  }

  syncShipBodies(dt = 1 / 30) {
    for (const s of this.ships) {
      const y = hullWaterPose(this, s, s.length, s.width, s.motion, dt);
      const step = Math.min(0.05, dt),
        response = s.escort ? 1.8 : 1.1;
      s.motion.heaveVelocity +=
        ((y - s.motion.heave) * response - s.motion.heaveVelocity * Math.sqrt(response) * 1.8) * step;
      s.motion.heave += s.motion.heaveVelocity * step;
      s.y = s.motion.heave - s.sinkTime * 0.2;
      s.body.setNextKinematicTranslation({ x: deltaX(s.x, this.origin.x), y: s.y, z: s.z - this.origin.z });
      s.body.setNextKinematicRotation(this.quaternion(s.heading, s.motion.pitch, s.motion.roll));
    }
  }
  stepPhysics(dt) {
    const p = this.p;
    this.rebase();
    const t = this.body.translation(),
      v = this.body.linvel();
    this.waterMotion.heave = t.y + 2 + p.depth;
    this.waterMotion.heaveVelocity = v.y;
    const water = hullWaterPose(this, p, 66, 6, this.waterMotion, dt);
    const fade = immersionEnvelope(p.depth, this.config.waterMotion.immersionDistance);
    const targetY = -2 - p.depth + water * fade;
    const mass = this.body.mass(),
      spring = this.config.ocean.buoyancy,
      damping = this.config.ocean.buoyancyDamping;
    this.body.resetForces(true);
    this.body.addForce(
      {
        x: 0,
        y:
          mass *
          clamp(
            9.81 +
              (targetY - t.y) * spring -
              (v.y - this.waterMotion.supportVelocity * this.config.waterMotion.velocityInfluence) * damping +
              clamp(this.waterMotion.supportVelocity - v.y, 0, 3) * this.config.waterMotion.slamResponse,
            -50,
            50,
          ),
        z: 0,
      },
      true,
    );
    this.body.setLinvel(
      { x: Math.sin(p.heading) * p.speed, y: v.y, z: -Math.cos(p.heading) * p.speed },
      true,
    );
    this.body.setRotation(this.quaternion(p.heading, this.waterMotion.pitch, this.waterMotion.roll), true);
    this.syncShipBodies(dt);
    const oldTorp = this.torpedoes.map((torp) => ({ torp, pos: torp.body.translation() }));
    this.physics.timestep = Math.max(0.0001, dt);
    this.physics.step();
    this.physicsTicks++;
    const velocityAfter = this.body.linvel();
    if (Math.abs(velocityAfter.y) > 12)
      this.body.setLinvel(
        { x: velocityAfter.x, y: clamp(velocityAfter.y, -12, 12), z: velocityAfter.z },
        true,
      );
    for (const ship of this.ships) {
      if (distance(ship, p) > ship.length * 0.5 + 40 || (this.collisionCooldown.get(ship.id) || 0) > p.time)
        continue;
      let touching = false;
      this.physics.contactPair(this.hullCollider, ship.collider, (manifold) => {
        for (let i = 0; i < manifold.numContacts(); i++) if (manifold.contactDist(i) < 0.05) touching = true;
      });
      if (touching) {
        const relative = Math.hypot(
          Math.sin(p.heading) * p.speed - Math.sin(ship.heading) * this.effectiveShipSpeed(ship),
          -Math.cos(p.heading) * p.speed + Math.cos(ship.heading) * this.effectiveShipSpeed(ship),
        );
        this.hurt(clamp(relative * this.config.combat.collisionDamage, 0, 35), 'collision');
        this.collisionCooldown.set(ship.id, p.time + 2);
        this.message(`Hull contact with ${ship.name}. Stop engines and turn clear.`);
      }
    }
    const updated = this.body.translation();
    const nextX = wrapX(this.origin.x + updated.x),
      nextZ = this.origin.z + updated.z;
    if (!this.dev('noClip') && isLand(nextX, nextZ)) {
      this.body.setTranslation({ x: deltaX(p.x, this.origin.x), y: updated.y, z: p.z - this.origin.z }, true);
      p.speed = 0;
      p.throttle = 0;
      p.auto = false;
      this.acceleration = 1;
    } else {
      this.oceanX += deltaX(nextX, p.x);
      p.x = nextX;
      p.z = nextZ;
    }
    for (const { torp, pos } of oldTorp) {
      const current = torp.body.translation(),
        dx = current.x - pos.x,
        dz = current.z - pos.z,
        travel = Math.hypot(dx, dz);
      if (travel > 0) {
        const ray = new RAPIER.Ray(
          { x: pos.x, y: pos.y, z: pos.z },
          { x: dx / travel, y: 0, z: dz / travel },
        );
        const hit = this.physics.castRay(
          ray,
          travel + 1,
          true,
          undefined,
          undefined,
          undefined,
          torp.body,
          (col) => this.ships.some((s) => s.hp > 0 && s.collider.handle === col.handle),
        );
        if (hit) {
          const ship = this.ships.find((s) => s.collider.handle === hit.collider.handle);
          if (ship)
            this.hitShip(ship, torp.damage, {
              kind: 'torpedo',
              x: wrapX(this.origin.x + pos.x + (dx / travel) * hit.timeOfImpact),
              z: this.origin.z + pos.z + (dz / travel) * hit.timeOfImpact,
              depth: Math.max(0, -pos.y),
            });
          torp.life = 0;
        }
      }
      torp.x = wrapX(this.origin.x + current.x);
      torp.z = this.origin.z + current.z;
      torp.life -= dt;
      if (isLand(torp.x, torp.z)) torp.life = 0;
    }
    for (const torp of this.torpedoes.filter((t) => t.life <= 0)) this.physics.removeRigidBody(torp.body);
    this.torpedoes = this.torpedoes.filter((t) => t.life > 0);
  }
  state() {
    const p = this.p,
      t = this.target();
    return {
      ...p,
      ships: this.ships.map((s) => ({ id: s.id, x: s.x, z: s.z, hp: s.hp, escort: s.escort, name: s.name })),
      target: t ? { id: t.id, name: t.name, hp: t.hp, range: distance(t, p) } : null,
      acceleration: this.acceleration,
      detected: this.detected,
      torpedoesInWater: this.torpedoes.length,
      physicsTicks: this.physicsTicks,
      region: regionName(p.x, p.z),
      coordinates: coordinates(p.x, p.z),
      paused: this.paused,
    };
  }
  dispose() {
    this.physics.free();
  }
}
