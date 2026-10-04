import { WAVES } from './world.js';
// Independent of config.js: config includes these descriptors, never the reverse.
export const WATER_SECTIONS = [
  'Waves',
  'Surface',
  'Foam & wakes',
  'Underwater',
  'Boat response',
  'Lighting',
  'Quality',
];
const fields = {};
export const WATER_METADATA = {};
function field(group, key, label, value, min, max, step, section, update = 'uniform', extra = {}) {
  const meta = {
    section,
    update,
    cost:
      update === 'resource' ? 'Rebuild on commit' : update === 'spectrum' ? 'Spectrum transition' : 'Live',
    help: label,
    ...extra,
  };
  (fields[group] ||= {})[key] = [label, value, min, max, step, meta.options, meta];
  WATER_METADATA[`${group}.${key}`] = meta;
}
const n = (group, key, label, value, min, max, step, section, update, extra) =>
  field(group, key, label, value, min, max, step, section, update, extra);
const w = (...args) => n('waterWaves', ...args);
w('seed', 'Sea seed', 1942, 0, 4294967295, 1, 'Waves', 'spectrum', { type: 'integer', advanced: true });
w('swellEnabled', 'Analytic swell', true, null, null, null, 'Waves', 'spectrum');
w('swellGain', 'Swell energy gain', 1, 0, 2, 0.05, 'Waves');
w('swellHeading', 'Swell heading offset · °', 0, -180, 180, 1, 'Waves', 'spectrum');
w('wavelengthScale', 'Swell wavelength scale', 1, 0.5, 2, 0.05, 'Waves', 'spectrum');
for (let i = 0; i < 3; i++)
  w(`band${i + 1}Gain`, `${['Long', 'Medium', 'Short'][i]} wind-wave band gain`, 1, 0, 2, 0.05, 'Waves');
w('directionalSpread', 'Wind-wave directional spread', 0.06, 0, 1, 0.02, 'Waves', 'spectrum', {
  advanced: true,
});
w('windEnergy', 'Wind-sea energy', 1, 0, 2, 0.05, 'Waves', 'uniform');
w('shortSuppression', 'Short-wave suppression', 0.65, 0.1, 2, 0.05, 'Waves', 'spectrum', { advanced: true });
w('updateRate', 'Spectrum synthesis · Hz', 12, 8, 20, 1, 'Quality', 'simulation', {
  options: [8, 12, 20],
  advanced: true,
});
const components = WAVES;
for (let i = 0; i < components.length; i++) {
  const [length, amplitude, x, z] = components[i],
    prefix = `swell${i + 1}`;
  for (const [key, label, v, min, max, step] of [
    ['Enabled', 'enabled', true],
    ['Length', 'wavelength · m', length, 4, 300, 1],
    ['Amplitude', 'amplitude coefficient', amplitude, 0, 1.5, 0.005],
    ['Direction', 'travel toward · °', ((Math.atan2(x, -z) * 180) / Math.PI + 360) % 360, 0, 360, 1],
    ['Phase', 'phase · °', 0, 0, 360, 1],
  ])
    w(`${prefix}${key}`, `Swell ${i + 1} ${label}`, v, min, max, step, 'Waves', 'spectrum', {
      advanced: true,
    });
}
const a = (...args) => n('waterAppearance', ...args);
for (const [key, label, value, section] of [
  ['deepColor', 'Deep water', '#042933', 'Surface'],
  ['scatterColor', 'Water scatter', '#175966', 'Surface'],
  ['crestColor', 'Crest transmission', '#65bfa4', 'Surface'],
  ['underwaterColor', 'Underwater scatter', '#0c3743', 'Underwater'],
])
  a(key, label, value, null, null, null, section, 'uniform', { type: 'color' });
for (const [key, label, value, min, max, step, section, extra] of [
  ['roughness', 'Base roughness', 0.06, 0.03, 0.25, 0.005, 'Surface'],
  ['windRoughness', 'Wind roughness gain', 0.05, 0, 0.2, 0.005, 'Surface'],
  ['glitter', 'Sun glitter gain', 1, 0, 2, 0.05, 'Surface'],
  ['crestWidth', 'Crest light width', 0.65, 0.1, 2, 0.05, 'Surface'],
  ['rippleScale', 'Ripple scale', 1, 0.25, 4, 0.05, 'Surface'],
  ['rippleSpeed', 'Ripple travel speed', 1, 0, 3, 0.05, 'Surface'],
  ['rippleAlignment', 'Ripple wind alignment', 0.7, 0, 1, 0.05, 'Surface'],
  ['rippleFade', 'Ripple fade distance · m', 800, 100, 2000, 25, 'Surface'],
  ['environmentGain', 'Environment reflection gain', 1, 0, 2, 0.05, 'Surface'],
  ['planarGain', 'Planar reflection gain', 1, 0, 1, 0.05, 'Surface'],
  ['reflectionDistortion', 'Reflection distortion', 1, 0, 2, 0.05, 'Surface'],
  ['refractionScale', 'Refraction resolution', 0.45, 0.25, 1, 0.05, 'Quality', { update: 'resource' }],
  ['refractionDistortion', 'Refraction distortion', 1, 0, 2, 0.05, 'Surface'],
  ['refractionWeight', 'Refraction weight', 0.18, 0, 1, 0.02, 'Surface'],
  ['absorptionR', 'Red absorption · /m', 0.065, 0.001, 0.5, 0.001, 'Underwater'],
  ['absorptionG', 'Green absorption · /m', 0.022, 0.001, 0.5, 0.001, 'Underwater'],
  ['absorptionB', 'Blue absorption · /m', 0.011, 0.001, 0.5, 0.001, 'Underwater'],
  ['ior', 'Water index of refraction', 1.333, 1.3, 1.36, 0.001, 'Surface', { advanced: true }],
  ['scatterGain', 'Underwater scatter gain', 1, 0, 2, 0.05, 'Underwater'],
  ['extinction', 'Underwater extinction gain', 1, 0.2, 3, 0.05, 'Underwater'],
  ['transitionWidth', 'Surface crossing width · m', 0.9, 0.2, 2, 0.05, 'Underwater'],
  ['surfaceWindow', 'Underwater surface window', 1, 0, 2, 0.05, 'Underwater'],
])
  a(key, label, value, min, max, step, section, extra?.update || 'uniform', extra);
const f = (...args) => n('waterInteraction', ...args);
for (const [key, label, value, min, max, step] of [
  ['compressionThreshold', 'Whitecap compression threshold', 0.16, 0.02, 0.8, 0.01],
  ['whitecapGain', 'Whitecap generation', 1, 0, 3, 0.05],
  ['whitecapDecay', 'Whitecap decay · s', 3, 0.5, 15, 0.5],
  ['coverageCap', 'Whitecap coverage cap', 0.8, 0, 1, 0.02],
  ['bubbleScale', 'Foam bubble scale', 1, 0.25, 4, 0.05],
  ['foamBrightness', 'Foam brightness', 1, 0.2, 2, 0.05],
  ['foamRoughness', 'Foam roughness', 0.85, 0.4, 1, 0.05],
  ['contactGain', 'Hull contact foam', 1, 0, 3, 0.05],
  ['bowGain', 'Bow foam', 1, 0, 3, 0.05],
  ['propellerGain', 'Propeller wash', 1, 0, 3, 0.05],
  ['wakeWidth', 'Wake width scale', 1, 0.5, 3, 0.05],
  ['turnSensitivity', 'Turn wake sensitivity', 1, 0, 3, 0.05],
  ['propagation', 'Local wave propagation · m/s', 8, 2, 12, 0.5],
  ['damping', 'Local wave damping · /s', 1.65, 0.2, 4, 0.05],
  ['diffusion', 'Foam diffusion · m²/s', 0.12, 0, 1, 0.02],
  ['windDrift', 'Foam wind drift · m/s', 0.12, 0, 0.8, 0.02],
  ['currentSpeed', 'Uniform local current · m/s', 0, 0, 1.5, 0.05],
  ['currentDirection', 'Current travel toward · °', 0, 0, 360, 1],
  ['entryThreshold', 'Spray entry threshold · m/s', 0.7, 0.1, 3, 0.05],
  ['sprayGain', 'Spray gain', 1, 0, 2, 0.05],
  ['dropletSize', 'Droplet size scale', 1, 0.5, 2, 0.05],
  ['dropletLifetime', 'Droplet lifetime scale', 1, 0.5, 2, 0.05],
  ['wetDarkening', 'Wet hull darkening', 0.18, 0, 0.5, 0.02],
  ['wetRoughness', 'Wet hull roughness', 0.24, 0.05, 0.8, 0.02],
  ['dryTime', 'Hull dry time · s', 35, 5, 120, 1],
  ['impactRing', 'Impact ring gain', 1, 0, 2, 0.05],
  ['impactSpread', 'Impact spreading scale', 1, 0.5, 2, 0.05],
  ['impactDecay', 'Impact decay scale', 1, 0.5, 2, 0.05],
  ['impactDepth', 'Impact depth attenuation · m', 22, 5, 60, 1],
  ['impactFoam', 'Impact foam gain', 1, 0, 3, 0.05],
  ['impactSpray', 'Impact spray gain', 1, 0, 2, 0.05],
])
  f(
    key,
    label,
    value,
    min,
    max,
    step,
    'Foam & wakes',
    ['bubbleScale', 'foamBrightness', 'foamRoughness', 'wetDarkening', 'wetRoughness'].includes(key)
      ? 'uniform'
      : 'simulation',
    {
      advanced: [
        'propagation',
        'damping',
        'diffusion',
        'windDrift',
        'currentSpeed',
        'currentDirection',
      ].includes(key),
    },
  );
for (const [key, label, value, min, max, step] of [
  ['pitchResponse', 'Pitch support response', 3.4, 0.5, 8, 0.1],
  ['rollResponse', 'Roll support response', 3.8, 0.5, 8, 0.1],
  ['pitchDamping', 'Pitch damping', 2.4, 0.5, 6, 0.1],
  ['rollDamping', 'Roll damping', 2.6, 0.5, 6, 0.1],
  ['velocityInfluence', 'Wave velocity influence', 0.6, 0, 1, 0.05],
  ['slamResponse', 'Entry / slam response', 0.3, 0, 1, 0.05],
  ['immersionDistance', 'Immersion blend distance · m', 8, 3, 20, 0.5],
  ['longitudinalWeight', 'Bow / stern support weight', 1, 0.25, 2, 0.05],
  ['transverseWeight', 'Port / starboard support weight', 1, 0.25, 2, 0.05],
])
  n('waterMotion', key, label, value, min, max, step, 'Boat response', 'simulation');
export const WATER_SETTINGS = fields;

for (const [section, group, keys] of [
  [
    'Waves',
    'ocean',
    ['waveHeight', 'waveSpeed', 'choppiness', 'windSpeed', 'windDirection', 'weather', 'stormStrength'],
  ],
  ['Surface', 'graphics', ['detailWaves']],
  ['Surface', 'ocean', ['crestLight']],
  ['Foam & wakes', 'graphics', ['foam', 'particles']],
  ['Foam & wakes', 'ocean', ['foamLifetime', 'wakeStrength', 'wakeLength']],
  ['Underwater', 'ocean', ['clarity']],
  ['Boat response', 'ocean', ['buoyancy', 'buoyancyDamping']],
  ['Lighting', 'ocean', ['cloudCover', 'sunHour', 'dayCycle', 'dayMinutes']],
  ['Lighting', 'graphics', ['exposure', 'environmentRefresh', 'shadows', 'shadowResolution']],
  [
    'Quality',
    'graphics',
    [
      'pixelRatio',
      'oceanSegments',
      'spectrumResolution',
      'interactionResolution',
      'reflections',
      'reflectionScale',
      'waterRefraction',
      'viewDistance',
      'cameraDistance',
      'cameraHeight',
    ],
  ],
])
  for (const key of keys)
    WATER_METADATA[`${group}.${key}`] = {
      section,
      update: [
        'pixelRatio',
        'oceanSegments',
        'spectrumResolution',
        'interactionResolution',
        'reflectionScale',
        'shadowResolution',
        'shadows',
        'reflections',
        'waterRefraction',
      ].includes(key)
        ? 'resource'
        : ['windSpeed', 'windDirection'].includes(key)
          ? 'spectrum'
          : group === 'ocean'
            ? 'simulation'
            : 'uniform',
      help:
        key === 'waveHeight'
          ? 'Coefficient applied to the wave mixture; this is not significant wave height.'
          : /Direction/.test(key)
            ? 'Travel toward: 0° north (−Z), 90° east (+X).'
            : 'Changes apply to this experiment.',
    };
for (const [path, meta] of Object.entries(WATER_METADATA)) {
  if (
    /^waterWaves\.(swellEnabled|swellHeading|wavelengthScale|swell[1-6](Enabled|Length|Direction))$/.test(
      path,
    )
  ) {
    meta.boundary = 'scene';
    meta.cost = 'Scene reset on commit';
    meta.help += ' Resets the scene on commit to keep composition edits repeatable.';
  }
  if (/^waterWaves\.swell[1-6]Amplitude$/.test(path)) meta.update = 'uniform';
  if (/^waterWaves\.swell[1-6]Phase$/.test(path)) {
    meta.update = 'uniform';
    meta.help = 'An explicit phase edit intentionally shifts this wave.';
  }
}
const booleanPaths = new Set([
  'graphics.reflections',
  'graphics.shadows',
  'graphics.waterRefraction',
  'ocean.weather',
  'ocean.dayCycle',
]);
for (const [path, meta] of Object.entries(WATER_METADATA)) {
  const [group, key] = path.split('.'),
    spec = WATER_SETTINGS[group]?.[key];
  meta.controlType =
    meta.type ||
    (spec
      ? typeof spec[1] === 'boolean'
        ? 'boolean'
        : spec[5]
          ? 'enum'
          : 'number'
      : booleanPaths.has(path)
        ? 'boolean'
        : /Resolution$/.test(key) && ['spectrumResolution', 'interactionResolution'].includes(key)
          ? 'enum'
          : 'number');
  meta.units =
    spec?.[0].split('·')[1]?.trim() ||
    {
      waveHeight: 'coefficient',
      buoyancy: '1/s²',
      buoyancyDamping: '1/s',
      pitchResponse: '1/s²',
      rollResponse: '1/s²',
      pitchDamping: '1/s',
      rollDamping: '1/s',
      sunHour: 'hour',
      dayMinutes: 'min',
      waveSpeed: 'rate',
      windSpeed: 'm/s',
      clarity: 'm',
      foamLifetime: 's',
      wakeLength: 'm',
      windDirection: '°',
    }[key] ||
    'unitless';
}
export const WATER_PATHS = Object.keys(WATER_METADATA);
