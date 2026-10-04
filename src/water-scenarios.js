import { SETTINGS, validateConfig } from './config.js';
import { validateSetting } from './setting-controls.js';
import { newCareer, Simulation } from './simulation.js';
import { WATER_PATHS } from './water-settings.js';
import { newWaterMotion, WaterInteractions } from './water-surface.js';
import { DEG, isLand } from './world.js';

export const WATER_STEP = 1 / 30;
export const WATER_SCENARIOS = [
  ['patrol', 'Current patrol'],
  ['flat', 'Still boat · flat water'],
  ['calm', 'Calm cruise'],
  ['swell', 'Atlantic swell'],
  ['head', 'Heavy head seas'],
  ['beam', 'Heavy beam seas'],
  ['turn', 'Turning wake'],
  ['crossing', 'Merchant / escort wake crossing'],
  ['dive', 'Dive and surface'],
  ['surface', 'Shallow camera crossing'],
  ['impacts', 'Weapon impacts'],
];
export const WATER_CAMERAS = [
  'chase',
  'low bow',
  'broadside',
  'stern / wake',
  'periscope',
  'overhead',
  'underwater up',
  'surface crossing',
];
export const WATER_LIGHTING = ['patrol', 'noon', 'low sun', 'overcast'];
export function waterTuning(config) {
  const out = {};
  for (const path of WATER_PATHS) {
    const [group, key] = path.split('.');
    (out[group] ||= {})[key] = config[group][key];
  }
  return out;
}
export function applyWaterTuning(config, tuning) {
  const next = validateWaterTuning(tuning);
  for (const [group, fields] of Object.entries(next)) Object.assign(config[group], fields);
}
export function validateWaterTuning(tuning) {
  if (!tuning || typeof tuning !== 'object' || Array.isArray(tuning))
    throw new Error('Missing water tuning.');
  const result = {};
  for (const [group, fields] of Object.entries(tuning)) {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields))
      throw new Error('Invalid water settings group.');
    for (const [key, value] of Object.entries(fields)) {
      if (!WATER_PATHS.includes(`${group}.${key}`))
        throw new Error(`Unsupported water setting: ${group}.${key}.`);
      (result[group] ||= {})[key] = validateSetting(SETTINGS[group][key], value, { strict: true });
    }
  }
  return result;
}
function bounded(value, min, max, name) {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${name}.`);
  return value;
}
export function initialWaterBoat(p) {
  return Object.fromEntries(
    ['x', 'z', 'heading', 'depth', 'targetDepth', 'speed', 'throttle'].map((key) => [key, p[key]]),
  );
}
export function waterController(sim) {
  return (
    sim.labController || {
      surfaceSpeed: sim.speedLimit(0),
      submergedSpeed: sim.speedLimit(12),
      acceleration: sim.config.navigation.acceleration * sim.dev('maneuverMultiplier'),
      turnRate: sim.config.navigation.turnRate * sim.dev('maneuverMultiplier'),
      diveRate: sim.config.navigation.diveRate * sim.dev('maneuverMultiplier'),
    }
  );
}
export function initialWaterConditions(sim) {
  return {
    ...initialWaterBoat(sim.p),
    time: sim.p.time,
    visualTime: sim.visualTime,
    weather: sim.weather,
    bodyY: sim.body.translation().y,
    bodyVelocity: sim.body.linvel().y,
    motion: { ...sim.waterMotion },
    controller: { ...waterController(sim) },
    noClip: !!sim.dev('noClip'),
    oceanX: sim.oceanX,
    waterState: sim.water.snapshot(),
    localWater: sim.water.interactions.snapshot(),
    ships: sim.ships.slice(0, 64).map((ship) => ({
      id: ship.id,
      x: ship.x,
      z: ship.z,
      heading: ship.heading,
      speed: ship.speed,
      seed: ship.seed,
      escort: ship.escort,
      length: ship.length,
      y: ship.y,
      hp: ship.hp,
      sinkTime: ship.sinkTime,
      motion: { ...ship.motion },
    })),
  };
}
function validateMotion(raw) {
  if (raw === undefined) return newWaterMotion();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid hull response memory.');
  const result = newWaterMotion();
  for (const key of Object.keys(result))
    if (raw[key] !== undefined) {
      const limit = ['pitch', 'roll'].includes(key)
        ? 0.35
        : ['heave', 'lastBow'].includes(key)
          ? 300
          : key === 'heaveVelocity'
            ? 12
            : key === 'supportVelocity'
              ? 6
              : key === 'wetness'
                ? 1
                : 3;
      result[key] = bounded(raw[key], key === 'wetness' ? 0 : -limit, limit, key);
    }
  return result;
}
function validateInitialMemory(initial, raw) {
  for (const [key, min, max] of [
    ['time', 0, 1e12],
    ['visualTime', 0, 1e12],
    ['weather', 0, 1],
    ['oceanX', -1e12, 1e12],
    ['bodyY', -600, 300],
    ['bodyVelocity', -12, 12],
  ])
    if (raw[key] !== undefined) initial[key] = bounded(raw[key], min, max, key);
  if (raw.noClip !== undefined) {
    if (typeof raw.noClip !== 'boolean') throw new Error('Invalid initial collision mode.');
    initial.noClip = raw.noClip;
  }
  if (raw.controller !== undefined) {
    initial.controller = {};
    for (const [key, min, max] of [
      ['surfaceSpeed', 0.1, 2000],
      ['submergedSpeed', 0.1, 2000],
      ['acceleration', 0.025, 40],
      ['turnRate', 0.25, 300],
      ['diveRate', 0.05, 80],
    ])
      initial.controller[key] = bounded(raw.controller[key], min, max, key);
  }
  if (raw.motion) initial.motion = validateMotion(raw.motion);
  if (raw.localWater !== undefined) {
    if (![128, 256, 512].includes(raw.localWater?.resolution))
      throw new Error('Invalid initial water resolution.');
    if (
      raw.localWater.ages !== undefined &&
      (typeof raw.localWater.ages !== 'string' ||
        raw.localWater.ages.length > raw.localWater.resolution ** 2 * 2 ||
        atob(raw.localWater.ages).length !== raw.localWater.resolution ** 2)
    )
      throw new Error('Invalid initial foam age memory.');
    const field = new WaterInteractions(raw.localWater.resolution);
    if (!field.restore(raw.localWater)) throw new Error('Invalid initial water memory.');
    initial.localWater = field.snapshot();
  }
  if (raw.waterState !== undefined) {
    const state = raw.waterState;
    if (
      state?.version !== 1 ||
      ![32, 64, 128].includes(state.resolution) ||
      !Array.isArray(state.foam) ||
      state.foam.length !== 3
    )
      throw new Error('Invalid initial wave memory.');
    for (const encoded of state.foam)
      if (
        typeof encoded !== 'string' ||
        encoded.length > state.resolution ** 2 * 2 ||
        atob(encoded).length !== state.resolution ** 2
      )
        throw new Error('Invalid crest foam memory.');
    initial.waterState = {
      version: 1,
      resolution: state.resolution,
      phase: bounded(state.phase, 0, 3e12, 'phase'),
      clockTime: bounded(state.clockTime, 0, 1e12, 'wave clock'),
      emissionClock: bounded(state.emissionClock, 0, 0.1, 'source clock'),
      foam: [...state.foam],
      wakes: [],
    };
    if (state.impacts !== undefined) {
      if (!Array.isArray(state.impacts) || state.impacts.length > 8)
        throw new Error('Too many initial impacts.');
      initial.waterState.impacts = state.impacts.map((impact) => {
        if (!['shell', 'torpedo', 'depth-charge'].includes(impact.kind))
          throw new Error('Invalid impact kind.');
        return {
          kind: impact.kind,
          x: bounded(impact.x, -1e12, 1e12, 'impact x'),
          z: bounded(impact.z, -78 * DEG, 78 * DEG, 'impact z'),
          energy: bounded(impact.energy, 0.1, 10, 'impact energy'),
          depth: bounded(impact.depth, 0, 600, 'impact depth'),
          born: bounded(impact.born, 0, state.clockTime, 'impact birth'),
        };
      });
    }
    if (state.emitters !== undefined) {
      if (!Array.isArray(state.emitters) || state.emitters.length > 64)
        throw new Error('Too many source histories.');
      initial.waterState.emitters = state.emitters.map((row) => {
        if (!Array.isArray(row) || row.length !== 2 || !['string', 'number'].includes(typeof row[0]))
          throw new Error('Invalid wake source.');
        return [
          row[0],
          {
            x: bounded(row[1].x, -1e12, 1e12, 'source x'),
            z: bounded(row[1].z, -78 * DEG, 78 * DEG, 'source z'),
            born: bounded(row[1].born, 0, state.clockTime, 'source birth'),
          },
        ];
      });
    }
    if (state.wakes !== undefined) {
      if (!Array.isArray(state.wakes) || state.wakes.length > 64) throw new Error('Too many wake histories.');
      initial.waterState.wakes = state.wakes.map((row) => {
        if (
          !Array.isArray(row) ||
          !['string', 'number'].includes(typeof row[0]) ||
          String(row[0]).length > 40 ||
          !Array.isArray(row[1]) ||
          row[1].length > 160
        )
          throw new Error('Invalid wake history.');
        return [
          row[0],
          row[1].map((p) => ({
            x: bounded(p.x, -1e12, 1e12, 'wake x'),
            z: bounded(p.z, -78 * DEG, 78 * DEG, 'wake z'),
            width: bounded(p.width, 0.1, 100, 'wake width'),
            born: bounded(p.born, 0, state.clockTime, 'wake birth'),
            heading: bounded(p.heading, -Math.PI * 2, Math.PI * 2, 'wake heading'),
          })),
        ];
      });
    }
  }
  if (raw.ships !== undefined) {
    if (!Array.isArray(raw.ships) || raw.ships.length > 64) throw new Error('Too many initial ships.');
    initial.ships = raw.ships.map((ship) => {
      if (typeof ship.escort !== 'boolean') throw new Error('Invalid initial ship class.');
      if (
        !Number.isInteger(ship.seed) ||
        (ship.id !== undefined && (!Number.isInteger(ship.id) || ship.id < 1 || ship.id > 1e9))
      )
        throw new Error('Invalid initial ship identity.');
      if (isLand(ship.x, ship.z)) throw new Error('Initial ships must start in open water.');
      return {
        ...(ship.id !== undefined ? { id: ship.id } : {}),
        x: bounded(ship.x, -180 * DEG, 180 * DEG, 'ship x'),
        z: bounded(ship.z, -78 * DEG, 78 * DEG, 'ship z'),
        heading: bounded(ship.heading, -Math.PI * 2, Math.PI * 2, 'ship heading'),
        speed: bounded(ship.speed, 0, 40, 'ship speed'),
        seed: bounded(ship.seed, -2147483648, 4294967295, 'ship seed'),
        escort: ship.escort,
        length: bounded(ship.length, 30, 200, 'ship length'),
        ...(ship.y !== undefined ? { y: bounded(ship.y, -600, 300, 'ship heave') } : {}),
        ...(ship.hp !== undefined
          ? {
              hp: bounded(ship.hp, 0, 1000, 'ship hull'),
              sinkTime: bounded(ship.sinkTime, 0, 120, 'ship sinking time'),
            }
          : {}),
        motion: validateMotion(ship.motion),
      };
    });
  }
}
export function validateWaterRecipe(raw) {
  if (raw?.schema !== 'greywake.water-lab/1')
    throw new Error('Choose a supported Greywake Water Lab recipe (version 1).');
  if (JSON.stringify(raw).length > 4e6) throw new Error('Water recipe is too large (4 MB maximum).');
  const tuning = validateWaterTuning(raw.tuning);
  if (!WATER_SCENARIOS.some(([id]) => id === raw.scenario)) throw new Error('Unknown water scene.');
  if (!WATER_CAMERAS.includes(raw.camera?.bookmark) || typeof raw.camera?.fixed !== 'boolean')
    throw new Error('Invalid camera bookmark.');
  if (!WATER_LIGHTING.includes(raw.lighting)) throw new Error('Unknown lighting view.');
  const camera = {
    bookmark: raw.camera.bookmark,
    fixed: raw.camera.fixed,
    orbit: bounded(raw.camera.orbit, -100, 100, 'camera orbit'),
    elevation: bounded(raw.camera.elevation, -100, 100, 'camera elevation'),
  };
  if (raw.camera.position !== undefined) {
    if (!raw.camera.rotation || !raw.camera.origin || typeof raw.camera.underwater !== 'boolean')
      throw new Error('Invalid camera pose.');
    camera.position = {};
    camera.rotation = {};
    for (const key of ['x', 'y', 'z'])
      camera.position[key] = bounded(raw.camera.position[key], -70000, 70000, `camera ${key}`);
    for (const key of ['x', 'y', 'z', 'w'])
      camera.rotation[key] = bounded(raw.camera.rotation[key], -1, 1, `camera rotation ${key}`);
    if (Math.abs(Math.hypot(...Object.values(camera.rotation)) - 1) > 0.001)
      throw new Error('Camera orientation must be normalized.');
    camera.origin = {
      x: bounded(raw.camera.origin.x, -180 * DEG, 180 * DEG, 'camera origin x'),
      z: bounded(raw.camera.origin.z, -78 * DEG, 78 * DEG, 'camera origin z'),
    };
    camera.underwater = raw.camera.underwater;
  }
  const seed = bounded(raw.seed, 0, 4294967295, 'seed');
  if (!Number.isInteger(seed)) throw new Error('Sea seed must be an unsigned integer.');
  const initial = {};
  for (const [key, min, max] of [
    ['x', -180 * DEG, 180 * DEG],
    ['z', -78 * DEG, 78 * DEG],
    ['heading', -Math.PI * 2, Math.PI * 2],
    ['depth', 0, 500],
    ['targetDepth', 0, 500],
    ['speed', 0, 2000],
    ['throttle', 0, 1],
  ])
    initial[key] = bounded(raw.initial?.[key], min, max, key);
  if (isLand(initial.x, initial.z) && raw.initial?.noClip !== true)
    throw new Error('Water scenes must start in open water.');
  validateInitialMemory(initial, raw.initial);
  const duration = bounded(raw.duration, 0, 1200, 'duration');
  if (!Array.isArray(raw.actions) || raw.actions.length > 2000)
    throw new Error('Too many or missing scripted actions.');
  let previous = -1;
  const actions = raw.actions.map((action) => {
    const time = bounded(action.time, 0, duration, 'action time');
    if (time < previous) throw new Error('Scripted actions must be ordered by time.');
    previous = time;
    if (action.type === 'tune') return { type: 'tune', time, tuning: validateWaterTuning(action.tuning) };
    if (action.type === 'helm') {
      const result = { type: 'helm', time };
      for (const [key, min, max] of [
        ['throttle', 0, 1],
        ['rudder', -1, 1],
        ['depth', 0, 500],
      ])
        if (action[key] !== undefined) result[key] = bounded(action[key], min, max, key);
      return result;
    }
    if (action.type === 'freeze' && typeof action.value === 'boolean')
      return { type: 'freeze', time, value: action.value };
    throw new Error('Unsupported scripted action.');
  });
  return {
    schema: raw.schema,
    seed,
    tuning,
    scenario: raw.scenario,
    initial,
    camera,
    lighting: raw.lighting,
    duration,
    actions,
  };
}
export function createWaterScene(recipe, config) {
  const c = validateConfig(config),
    p = newCareer();
  applyWaterTuning(c, recipe.tuning);
  c.waterWaves.seed = recipe.seed;
  c.world.maxShips = Math.max(c.world.maxShips, recipe.initial.ships?.length || 0);
  Object.assign(p, initialWaterBoat(recipe.initial), {
    seed: recipe.seed,
    time: recipe.initial.time || 0,
    auto: false,
    route: [],
    destination: null,
  });
  const sim = new Simulation(c, p, { training: true, ambientTraffic: false, invulnerable: true });
  sim.labController = recipe.initial.controller || {
    surfaceSpeed: 18 * 0.514444,
    submergedSpeed: 8 * 0.514444,
    acceleration: 0.8,
    turnRate: 6,
    diveRate: 1.6,
  };
  sim.oceanX = recipe.initial.oceanX ?? p.x;
  sim.visualTime = recipe.initial.visualTime ?? p.time;
  sim.weather = recipe.initial.weather || 0;
  sim.water.restore(recipe.initial.waterState, sim.visualTime);
  if (recipe.initial.localWater) sim.water.interactions.restore(recipe.initial.localWater);
  if (recipe.initial.motion) sim.waterMotion = newWaterMotion(recipe.initial.motion);
  if (recipe.initial.bodyY !== undefined)
    sim.body.setTranslation({ x: 0, y: recipe.initial.bodyY, z: 0 }, true);
  if (recipe.initial.bodyVelocity !== undefined)
    sim.body.setLinvel({ x: 0, y: recipe.initial.bodyVelocity, z: 0 }, true);
  for (const initial of recipe.initial.ships || []) {
    const ship = sim.addShip(initial.x, initial.z, initial.heading, initial.escort, initial.seed);
    if (ship) {
      if (initial.id !== undefined) {
        ship.id = initial.id;
        sim.nextId = Math.max(sim.nextId, ship.id + 1);
      }
      ship.speed = initial.speed;
      if (initial.hp !== undefined) {
        ship.hp = initial.hp;
        ship.sinkTime = initial.sinkTime;
      }
      ship.length = initial.length;
      if (initial.y !== undefined) {
        ship.y = initial.y;
        ship.body.setTranslation(
          { x: initial.x - sim.origin.x, y: initial.y, z: initial.z - sim.origin.z },
          true,
        );
      }
      ship.motion = newWaterMotion(initial.motion);
    }
  }
  if (recipe.scenario === 'crossing' && !recipe.initial.ships?.length) {
    sim.addShip(p.x - 120, p.z - 130, Math.PI / 2, false, recipe.seed);
    sim.addShip(p.x + 140, p.z + 80, -Math.PI / 2, true, recipe.seed + 1);
    for (const ship of sim.ships) ship.speed = ship.escort ? 9 : 6;
  }
  sim.labShipMotion = recipe.scenario === 'crossing';
  sim.setDeveloper({
    enabled: true,
    invulnerable: true,
    infiniteResources: true,
    pauseTraffic: true,
    freezeEnemies: true,
    noClip: recipe.initial.noClip || false,
  });
  sim.paused = true;
  return sim;
}
export function scriptWaterScene(sim, scenario, elapsed) {
  if (scenario === 'crossing')
    for (const ship of sim.ships) {
      ship.x += Math.sin(ship.heading) * ship.speed * WATER_STEP;
      ship.z -= Math.cos(ship.heading) * ship.speed * WATER_STEP;
    }
  if (scenario === 'turn' && !sim.labManual) sim.rudder = elapsed >= 8 && elapsed < 23 ? 1 : 0;
  if (scenario === 'dive' && !sim.labManual) sim.p.targetDepth = elapsed < 8 || elapsed >= 40 ? 0 : 18;
  if (scenario === 'impacts') {
    for (const [time, type, x, z, depth] of [
      [1, 'shell', 75, -70, 0],
      [4, 'torpedo', -80, -100, 0],
      [7, 'depth-charge', 30, -130, 18],
    ])
      if (elapsed >= time && elapsed - WATER_STEP < time)
        sim.waterImpact(type, sim.p.x + x, sim.p.z + z, depth, 1);
  }
}
