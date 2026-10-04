import { SEA_STATES } from './config.js';
import { applyWaterTuning } from './water-scenarios.js';

// Artistic looks layer on top of existing sea presets. All values use the lab allowlist.
export const WATER_LOOKS = {
  calm: {
    name: 'Calm water',
    tuning: {
      waterWaves: { swellGain: 0.8, windEnergy: 0.65, band3Gain: 0.65 },
      waterAppearance: {
        roughness: 0.04,
        windRoughness: 0.04,
        glitter: 0.85,
        environmentGain: 1,
        planarGain: 1,
        deepColor: '#06343d',
        scatterColor: '#226b72',
      },
      waterInteraction: { whitecapGain: 0.5, compressionThreshold: 0.18, whitecapDecay: 3 },
      graphics: { detailWaves: 0.28, foam: 0.65 },
    },
  },
  atlantic: {
    name: 'Atlantic swell',
    tuning: {
      waterWaves: { swellGain: 1.15, windEnergy: 1, band3Gain: 0.8 },
      waterAppearance: {
        roughness: 0.06,
        windRoughness: 0.05,
        glitter: 1,
        environmentGain: 1,
        planarGain: 1,
        deepColor: '#042933',
        scatterColor: '#175966',
      },
      waterInteraction: { whitecapGain: 1.2, compressionThreshold: 0.14, whitecapDecay: 4.5 },
      graphics: { detailWaves: 0.42, foam: 0.85 },
    },
  },
  storm: {
    name: 'Heavy seas',
    tuning: {
      waterWaves: { swellGain: 1.2, windEnergy: 1.1, band3Gain: 0.75 },
      waterAppearance: {
        roughness: 0.14,
        windRoughness: 0.065,
        glitter: 0.15,
        environmentGain: 0.2,
        planarGain: 0.1,
        deepColor: '#03232d',
        scatterColor: '#21545b',
      },
      waterInteraction: { whitecapGain: 1.8, compressionThreshold: 0.11, whitecapDecay: 6 },
      graphics: { detailWaves: 0.3, foam: 1.05 },
    },
  },
  clear: {
    name: 'Clear water · noon',
    tuning: {
      waterAppearance: {
        deepColor: '#074352',
        scatterColor: '#267c7d',
        crestColor: '#95d0b1',
        underwaterColor: '#155a63',
        roughness: 0.045,
        glitter: 1.1,
        environmentGain: 1,
        planarGain: 1,
      },
      ocean: { sunHour: 12, dayCycle: false, cloudCover: 0.12, clarity: 100 },
    },
  },
  overcast: {
    name: 'Overcast water',
    tuning: {
      waterAppearance: {
        deepColor: '#172e38',
        scatterColor: '#405d60',
        crestColor: '#91ae9b',
        underwaterColor: '#153d48',
        roughness: 0.12,
        glitter: 0.4,
        environmentGain: 0.2,
        planarGain: 0.1,
      },
      ocean: { sunHour: 12, dayCycle: false, cloudCover: 0.95, clarity: 45 },
    },
  },
};

export function applyWaterLook(config, key) {
  const look = WATER_LOOKS[key];
  if (!look) throw new Error('Unknown water look.');
  const sea = SEA_STATES[key];
  const { name, ...waves } = sea || {};
  applyWaterTuning(config, { ...look.tuning, ocean: { ...waves, ...look.tuning.ocean } });
}
