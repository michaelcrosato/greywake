import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { defaults } from '../src/config.js';
import { OceanSurface, WaterInteractions } from '../src/water-surface.js';

const folder = 'artifacts/water-review';
await mkdir(folder, { recursive: true });
const report = { passed: false, stress: [], boundaries: [], resize: [] };
const energy = (field, speed) => {
  let total = 0;
  const n = field.resolution;
  for (let z = 1; z < n - 1; z++)
    for (let x = 1; x < n - 1; x++) {
      const i = z * n + x,
        dx = (field.height[i + 1] - field.height[i - 1]) / (2 * field.spacing),
        dz = (field.height[i + n] - field.height[i - n]) / (2 * field.spacing);
      total += field.velocity[i] ** 2 + speed ** 2 * (dx ** 2 + dz ** 2);
    }
  return (total * field.spacing ** 2) / 2;
};
for (const resolution of [32, 64, 128])
  for (const seed of [42, 1942]) {
    const config = defaults();
    config.graphics.spectrumResolution = resolution;
    Object.assign(config.ocean, { waveHeight: 6, windSpeed: 22, choppiness: 1.3 });
    Object.assign(config.waterWaves, {
      seed,
      windEnergy: 2,
      band1Gain: 2,
      band2Gain: 2,
      band3Gain: 2,
      directionalSpread: 1,
      shortSuppression: 0.1,
    });
    const water = new OceanSurface(config),
      out = {};
    let minimumJacobian = Infinity,
      maximumResidual = 0,
      maximumHeight = 0;
    for (const time of [0, 1, 4.5, 12.3]) {
      water.advanceTime(time - water.clockTime);
      for (let z = -192; z < 192; z += 16)
        for (let x = -192; x < 192; x += 16) {
          water.sampleSurface(x, z, { weather: 1, local: false }, out);
          minimumJacobian = Math.min(minimumJacobian, out.jacobian);
          maximumResidual = Math.max(maximumResidual, out.inverseResidual);
          maximumHeight = Math.max(maximumHeight, Math.abs(out.height));
          assert.ok(out.normal.y > 0 && Number.isFinite(out.surfaceVerticalVelocity));
        }
    }
    assert.ok(minimumJacobian > 0 && maximumResidual <= 0.02);
    report.stress.push({
      resolution,
      seed,
      minimumJacobian,
      maximumResidual,
      maximumHeight,
      effectiveChop: water.effectiveChop,
    });
  }
for (const resolution of [128, 256, 512]) {
  const field = new WaterInteractions(resolution);
  field.recenter(0, 0);
  field.disturb(156, 0, 5, 1, 0);
  const initial = energy(field, 8);
  let early = 0,
    late = 0;
  for (let i = 0; i < 420; i++) {
    field.step(1 / 30, 45, 0, 0, { propagation: 8, damping: 0.2, diffusion: 0.12 });
    const t = (i + 1) / 30,
      sample = Math.abs(field.sample(140, 0));
    if (t < 6) early = Math.max(early, sample);
    if (t > 9) late = Math.max(late, sample);
  }
  const final = energy(field, 8);
  assert.ok(final < initial * 0.25 && field.height.every(Number.isFinite));
  report.boundaries.push({
    resolution,
    spacing: field.spacing,
    edgeWidthMeters: 24,
    elapsed: 14,
    initialEnergy: initial,
    finalEnergy: final,
    energyRatio: final / initial,
    lateToEarlyProbeRatio: late / Math.max(early, 1e-9),
    note: 'Probe ratio includes dispersive pulse tails; it is not an isolated physical reflection coefficient.',
  });
}
const config = defaults();
config.graphics.interactionResolution = 128;
const water = new OceanSurface(config);
water.interactions.recenter(0, 0);
water.interactions.disturb(0, 0, 6, 1, 1);
water.interactions.step(1 / 30);
for (const resolution of [256, 512, 128]) {
  const before = water.interactions.sample(0, 0),
    foam = water.interactions.sample(0, 0, true);
  config.graphics.interactionResolution = resolution;
  water.resizeInteractions();
  const heightError = Math.abs(water.interactions.sample(0, 0) - before),
    foamError = Math.abs(water.interactions.sample(0, 0, true) - foam);
  assert.ok(heightError < 0.005 && foamError < 0.005);
  report.resize.push({ resolution, heightError, foamError });
}
report.passed = true;
await writeFile(`${folder}/field-audit.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
