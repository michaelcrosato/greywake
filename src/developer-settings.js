import { clamp, DEG, isLand, wrapX } from './world.js';

export const DEV_SETTINGS = {
  invulnerable: ['Invulnerable hull', false],
  infiniteResources: ['Unlimited fuel, battery and oxygen', false],
  infiniteAmmo: ['Unlimited ammunition', false],
  noReload: ['Instant weapon reloads', false],
  noClip: ['No ship collisions or grounding', false],
  freezeEnemies: ['Freeze ships and enemy AI', false],
  pauseTraffic: ['Pause ambient traffic spawning', false],
  combatTime: ['Allow combat time compression · up to 20×', false],
  speedMultiplier: ['Player speed multiplier', 1, 0.25, 20, 0.25],
  maneuverMultiplier: ['Acceleration, rudder and dive multiplier', 1, 0.25, 10, 0.25],
};
export function developerDefaults() {
  return {
    enabled: false,
    ...Object.fromEntries(Object.entries(DEV_SETTINGS).map(([key, spec]) => [key, spec[1]])),
  };
}
export function validateDeveloper(raw) {
  const result = developerDefaults();
  result.enabled = raw?.enabled === true;
  for (const [key, spec] of Object.entries(DEV_SETTINGS)) {
    if (typeof spec[1] === 'boolean') result[key] = raw?.[key] === true;
    else if (Number.isFinite(raw?.[key])) result[key] = clamp(raw[key], spec[2], spec[3]);
  }
  return result;
}
export const DEV_PRESETS = {
  travel: {
    name: 'Fast travel',
    settings: { invulnerable: true, infiniteResources: true, speedMultiplier: 8, maneuverMultiplier: 4 },
  },
  combat: {
    name: 'Combat testing',
    settings: {
      invulnerable: true,
      infiniteResources: true,
      infiniteAmmo: true,
      noReload: true,
      combatTime: true,
    },
  },
  water: {
    name: 'Water inspection',
    settings: {
      invulnerable: true,
      infiniteResources: true,
      infiniteAmmo: true,
      freezeEnemies: true,
      maneuverMultiplier: 2,
    },
  },
};

// The simplified map places some named harbors inside coastline polygons.
// Playtest jumps find nearby navigable water without changing the game's map.
export function openWaterNear(point) {
  if (!isLand(point.x, point.z)) return { x: point.x, z: point.z };
  for (let radius = 500; radius <= 2500000; radius += 1000) {
    for (let sample = 0; sample < 48; sample++) {
      const angle = (sample * Math.PI * 2) / 48;
      const candidate = {
        x: wrapX(point.x + Math.sin(angle) * radius),
        z: point.z + Math.cos(angle) * radius,
      };
      if (Math.abs(candidate.z) <= 78 * DEG && !isLand(candidate.x, candidate.z)) return candidate;
    }
  }
  throw new Error('No nearby open water found. Choose manual coordinates.');
}
