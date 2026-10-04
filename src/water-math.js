import { TAU } from './world.js';

export const WATER_GRAVITY = 9.81;
// Supremum of the horizontal derivative row sums stays below this contraction.
// It guarantees a single-valued surface and bounds fixed-point query convergence.
export const DISPLACEMENT_CONTRACTION = 0.55;
export const INVERSE_TOLERANCE = 0.0005;
export const INVERSE_ITERATIONS = 16;
export const LOCAL_FOAM_BLEND_START = 0.35;
export const LOCAL_FOAM_BLEND_END = 0.48;

export function swellComponents(config, out = [], weather = 0) {
  const c = config.waterWaves;
  for (let i = 0; i < 6; i++) {
    const prefix = `swell${i + 1}`,
      wave = (out[i] ||= {});
    const direction = ((c[`${prefix}Direction`] + c.swellHeading) * Math.PI) / 180;
    wave.length = c[`${prefix}Length`] * c.wavelengthScale;
    wave.amplitude = c.swellEnabled && c[`${prefix}Enabled`] ? c[`${prefix}Amplitude`] * c.swellGain : 0;
    wave.dx = Math.sin(direction);
    wave.dz = -Math.cos(direction);
    wave.k = TAU / wave.length;
    wave.amplitude = Math.min(
      wave.amplitude,
      0.5 / Math.max(1e-8, wave.k * config.ocean.waveHeight * (1 + weather)),
    );
    wave.omega = Math.sqrt(WATER_GRAVITY * wave.k);
    wave.phase = (c[`${prefix}Phase`] * Math.PI) / 180;
  }
  return out;
}

// Integer wavevector identity is independent of FFT resolution / iteration order.
export function modeRandom(seed, size, x, z) {
  let hash = (seed ^ Math.imul(size, 73856093) ^ Math.imul(x, 19349663) ^ Math.imul(z, 83492791)) >>> 0;
  return () => {
    hash = Math.imul(hash ^ (hash >>> 16), 2246822507) >>> 0;
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909) >>> 0;
    hash ^= hash >>> 16;
    return ((hash >>> 0) + 0.5) / 4294967296;
  };
}

export function cascadeWindow(size, k) {
  const length = k ? TAU / k : Infinity;
  const blend = (value, lo, hi) => {
    const t = Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
    return t * t * (3 - 2 * t);
  };
  const long = blend(length, 40, 80),
    short = 1 - blend(length, 6, 14);
  return size === 512 ? long : size === 128 ? (1 - long) * (1 - short) : short;
}

export function immersionEnvelope(depth, distance = 8) {
  const t = Math.max(0, Math.min(1, depth / distance));
  return 1 - t * t * (3 - 2 * t);
}
