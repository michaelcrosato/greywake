import { DEG, deltaX } from './world.js';

export function worldClock(player, config) {
  const hours =
    config.ocean.sunHour + (config.ocean.dayCycle ? (player.time / (config.ocean.dayMinutes * 60)) * 24 : 0);
  const local = hours + deltaX(player.x, -17 * DEG) / (15 * DEG);
  const hour = ((local % 24) + 24) % 24,
    minutes = Math.floor(hour * 60 + 1e-8) % 1440;
  return {
    hour,
    day: Math.floor(hours / 24) + 1,
    text: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
  };
}

// Equinox lighting for the simplified globe: +X is east, +Z is south.
export function sunlight(hour, latitude) {
  const angle = ((hour - 12) * Math.PI) / 12,
    lat = (latitude * Math.PI) / 180;
  return { x: -Math.sin(angle), y: Math.cos(lat) * Math.cos(angle), z: Math.sin(lat) * Math.cos(angle) };
}
