export const SETTINGS = {
  graphics: {
    pixelRatio: ['Resolution scale', 1.25, 0.5, 2.5, 0.05],
    oceanSegments: ['Near-water tessellation', 160, 48, 320, 16],
    reflectionScale: ['Reflection resolution', 0.45, 0.15, 1, 0.05],
    environmentRefresh: ['Sky reflection update interval · s', 30, 2, 120, 2],
    reflections: ['Planar reflections', true],
    shadows: ['Sunlight / contact shadows', true],
    shadowResolution: ['Shadow map size', 1024, 512, 2048, 512],
    detailWaves: ['Micro-wave strength', 0.55, 0, 1.5, 0.05],
    spectrumResolution: ['Ocean spectrum resolution', 64, 32, 128, 32, [32, 64, 128]],
    interactionResolution: ['Local water / foam resolution', 256, 128, 512, 128, [128, 256, 512]],
    waterRefraction: ['Water refraction', true],
    foam: ['Foam intensity', 0.85, 0, 2, 0.05],
    particles: ['Spray / smoke budget', 700, 100, 1800, 100],
    viewDistance: ['View distance · m', 16000, 6000, 30000, 1000],
    exposure: ['Exposure', 0.75, 0.25, 1.5, 0.05],
    cameraDistance: ['Chase camera · m', 115, 55, 300, 5],
    cameraHeight: ['Camera elevation · m', 32, 8, 100, 2],
    sound: ['Sound volume', 0.35, 0, 1, 0.05],
  },
  ocean: {
    waveHeight: ['Swell height · m', 1.5, 0.1, 6, 0.1],
    waveSpeed: ['Wave time scale', 1, 0.1, 3, 0.1],
    choppiness: ['Wave choppiness', 0.65, 0, 1.3, 0.05],
    windSpeed: ['Wind speed · m/s', 9, 2, 22, 0.5],
    windDirection: ['Wind direction · degrees', 315, 0, 360, 5],
    foamLifetime: ['Wake foam lifetime · seconds', 45, 8, 100, 1],
    clarity: ['Underwater visibility · m', 65, 15, 180, 5],
    crestLight: ['Light through wave crests', 0.65, 0, 1.5, 0.05],
    wakeStrength: ['Wake displacement', 0.7, 0, 2, 0.05],
    wakeLength: ['Wake length · m', 350, 60, 1000, 10],
    cloudCover: ['Cloud coverage', 0.42, 0, 1, 0.02],
    sunHour: ['Solar hour (24h)', 16.4, 0, 23.9, 0.1],
    dayCycle: ['Moving sun', true],
    dayMinutes: ['Day length · real minutes', 40, 2, 240, 2],
    weather: ['Changing weather', true],
    stormStrength: ['Weather variability', 0.45, 0, 1, 0.05],
    buoyancy: ['Buoyancy spring', 3.5, 1, 10, 0.1],
    buoyancyDamping: ['Buoyancy damping', 3.4, 1, 8, 0.1],
  },
  navigation: {
    surfaceSpeed: ['Surface speed · knots', 18, 5, 60, 1],
    submergedSpeed: ['Submerged speed · knots', 8, 2, 40, 1],
    acceleration: ['Engine acceleration · m/s²', 0.8, 0.1, 4, 0.1],
    turnRate: ['Rudder rate · °/s', 6, 1, 30, 1],
    diveRate: ['Dive rate · m/s', 1.6, 0.2, 8, 0.2],
    maxDepth: ['Safe diving depth · m', 160, 40, 400, 10],
    travelMultiplier: ['Maximum time acceleration', 5000, 100, 20000, 100],
    fuelUse: ['Diesel consumption · %/hour', 0.65, 0, 5, 0.05],
    batteryUse: ['Battery consumption · %/hour', 14, 0, 60, 1],
    oxygenUse: ['Oxygen consumption · %/hour', 6, 0, 30, 1],
    contactRadius: ['Encounter slowdown radius · m', 2400, 600, 5000, 100],
  },
  combat: {
    torpedoSpeed: ['Torpedo speed · m/s', 27, 10, 100, 1],
    torpedoDamage: ['Torpedo damage', 78, 10, 500, 5],
    torpedoRange: ['Torpedo range · m', 6500, 500, 15000, 100],
    torpedoReload: ['Torpedo reload · seconds', 4.5, 0.5, 30, 0.5],
    gunDamage: ['Deck gun damage', 26, 5, 200, 1],
    gunRange: ['Deck gun range · m', 1500, 300, 4000, 100],
    gunReload: ['Deck gun reload · seconds', 3, 0.5, 15, 0.5],
    shellSpeed: ['Shell speed · m/s', 300, 100, 800, 25],
    gunDispersion: ['Gun dispersion at max range · m', 8, 0, 30, 1],
    escortResponseRange: ['Escort distress-response radius · m', 3500, 500, 8000, 100],
    searchMemory: ['Escort search memory · seconds', 90, 15, 300, 5],
    collisionDamage: ['Hull impact damage per m/s', 2, 0, 10, 0.5],
    enemyDamage: ['Escort attack damage', 12, 0, 80, 1],
    enemyReload: ['Escort attack interval · seconds', 12, 2, 60, 1],
    detectionRange: ['Visual detection range · m', 1800, 300, 5000, 100],
    sonarRange: ['Enemy sonar range · m', 1200, 200, 3000, 100],
    enemyHull: ['Merchant hull strength', 130, 20, 500, 10],
    escortHull: ['Escort hull strength', 180, 20, 600, 10],
    repairRate: ['Crew repair · HP/minute', 1.2, 0, 20, 0.2],
  },
  world: {
    trafficDensity: ['Ships per streamed cell', 2.5, 0.2, 10, 0.1],
    maxShips: ['Active ship limit', 22, 4, 64, 1],
    escortChance: ['Escort probability', 0.24, 0, 1, 0.02],
    convoyChance: ['Convoy probability', 0.5, 0, 1, 0.05],
    merchantSpeed: ['Merchant speed · knots', 10, 2, 30, 1],
    merchantEvasion: ['Merchants evade when attacked', true],
    escortSpeed: ['Escort speed · knots', 23, 5, 45, 1],
    streamRadius: ['Streaming radius · m', 11000, 5000, 20000, 1000],
  },
  ai: {
    decisionInterval: ['Tactical decision interval · s', 0.55, 0.2, 2, 0.05],
    sensorInterval: ['Sensor sampling interval · s', 0.8, 0.2, 3, 0.1],
    reactionDelay: ['Crew reaction delay · s', 1.2, 0, 6, 0.2],
    crewVariation: ['Crew / doctrine variation', 0.65, 0, 1, 0.05],
    observationNoise: ['Position observation error · m', 35, 0, 160, 5],
    depthUncertainty: ['Sonar depth uncertainty · m', 35, 5, 90, 5],
    uncertaintyGrowth: ['Lost-contact uncertainty growth · m/s', 3.5, 0.5, 12, 0.5],
    sonarArc: ['Forward sonar coverage · degrees', 250, 90, 360, 10],
    sonarBlindRange: ['Close sonar blind zone · m', 85, 0, 200, 5],
    selfNoise: ['Sonar penalty from own speed', 0.55, 0, 0.9, 0.05],
    radioDelay: ['Contact-sharing delay · s', 2.5, 0, 10, 0.5],
    coordination: ['Coordinated escort roles', true],
    guardConvoy: ['Keep a convoy guard with 3+ escorts', true],
    convoyScreenRadius: ['Convoy screen station radius · m', 850, 300, 1800, 50],
    convoyLeash: ['Maximum pursuit from convoy · m', 6000, 2000, 12000, 250],
    torpedoSpotRange: ['Visible torpedo-wake spotting · m', 420, 100, 900, 20],
    torpedoEvasion: ['React to visibly spotted torpedoes', true],
    attackRunLength: ['Depth-charge run-in · m', 300, 150, 600, 25],
    chargePattern: ['Charges in a depth pattern', 3, 1, 5, 1],
    chargeSinkRate: ['Depth-charge sink rate · m/s', 5, 2, 12, 0.5],
    searchSpeed: ['Search speed fraction', 0.48, 0.25, 0.75, 0.05],
    merchantManeuverMin: ['Minimum merchant maneuver hold · s', 12, 5, 40, 1],
    merchantManeuverMax: ['Maximum merchant maneuver hold · s', 30, 10, 75, 1],
    friendlySeparation: ['Friendly maneuver clearance · m', 180, 80, 400, 10],
  },
  economy: {
    bountyScale: ['Bounty multiplier', 1, 0.1, 10, 0.1],
    xpScale: ['Captain XP multiplier', 1, 0.1, 10, 0.1],
    crewXpScale: ['Crew XP multiplier', 1, 0.1, 10, 0.1],
    upgradeCost: ['Boat upgrade cost multiplier', 1, 0.1, 5, 0.1],
    serviceCost: ['Harbor service cost multiplier', 1, 0, 5, 0.1],
    skillXp: ['XP per captain level', 350, 50, 1500, 50],
    crewRankXp: ['XP per crew rank', 200, 50, 1000, 50],
  },
};

export function defaults() {
  return Object.fromEntries(
    Object.entries(SETTINGS).map(([g, fields]) => [
      g,
      Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v[1]])),
    ]),
  );
}

export function validateConfig(raw) {
  const result = defaults();
  for (const [group, fields] of Object.entries(SETTINGS)) {
    for (const [key, spec] of Object.entries(fields)) {
      const value = raw?.[group]?.[key];
      if (typeof spec[1] === 'boolean') result[group][key] = typeof value === 'boolean' ? value : spec[1];
      else if (Number.isFinite(value))
        result[group][key] = spec[5]
          ? spec[5].reduce(
              (best, option) => (Math.abs(option - value) < Math.abs(best - value) ? option : best),
              spec[5][0],
            )
          : Math.min(spec[3], Math.max(spec[2], value));
    }
  }
  return result;
}

export const PRESETS = {
  mobile: {
    pixelRatio: 0.8,
    oceanSegments: 96,
    reflectionScale: 0.25,
    particles: 300,
    viewDistance: 12000,
    shadows: false,
    shadowResolution: 512,
    spectrumResolution: 32,
    interactionResolution: 128,
    waterRefraction: false,
  },
  balanced: {
    pixelRatio: 1.25,
    oceanSegments: 160,
    reflectionScale: 0.45,
    particles: 700,
    viewDistance: 16000,
    shadows: true,
    shadowResolution: 1024,
    spectrumResolution: 64,
    interactionResolution: 256,
    waterRefraction: true,
  },
  ultra: {
    pixelRatio: 2,
    oceanSegments: 288,
    reflectionScale: 0.8,
    particles: 1400,
    viewDistance: 24000,
    shadows: true,
    shadowResolution: 2048,
    spectrumResolution: 128,
    interactionResolution: 512,
    waterRefraction: true,
  },
};

export const SEA_STATES = {
  calm: {
    name: 'Calm water',
    waveHeight: 0.45,
    windSpeed: 3,
    choppiness: 0.25,
    stormStrength: 0,
    weather: false,
  },
  atlantic: {
    name: 'Atlantic swell',
    waveHeight: 1.5,
    windSpeed: 9,
    choppiness: 0.65,
    stormStrength: 0.45,
    weather: true,
  },
  storm: {
    name: 'Heavy seas',
    waveHeight: 3.2,
    windSpeed: 17,
    choppiness: 1.1,
    stormStrength: 0.8,
    weather: true,
  },
};

export const SKILLS = [
  {
    id: 'navigator',
    name: 'Ocean instinct',
    branch: 'Navigation',
    icon: '⌖',
    description: '+8% cruising speed per rank.',
    max: 3,
  },
  {
    id: 'stealth',
    name: 'Silent running',
    branch: 'Survival',
    icon: '◈',
    description: 'Enemy detection range −12% per rank.',
    max: 3,
  },
  {
    id: 'hunter',
    name: 'Wolf of the sea',
    branch: 'Combat',
    icon: '⌁',
    description: '+12% weapon damage per rank.',
    max: 3,
  },
  {
    id: 'range',
    name: 'Dead reckoning',
    branch: 'Navigation',
    icon: '◎',
    description: '+15% torpedo range per rank.',
    max: 2,
    requires: 'navigator',
  },
  {
    id: 'engineer',
    name: 'Damage control',
    branch: 'Survival',
    icon: '✣',
    description: '+60% underway repairs per rank.',
    max: 2,
    requires: 'stealth',
  },
  {
    id: 'tactician',
    name: 'Rapid salvo',
    branch: 'Combat',
    icon: '⋙',
    description: 'Weapon reload time −15% per rank.',
    max: 2,
    requires: 'hunter',
  },
];

export const UPGRADES = [
  {
    id: 'hull',
    name: 'Pressure hull',
    description: '+30 hull integrity and +25 m safe depth per tier.',
    cost: 900,
    max: 4,
  },
  {
    id: 'engine',
    name: 'Diesel turbines',
    description: '+10% surface and submerged speed per tier.',
    cost: 1200,
    max: 4,
  },
  {
    id: 'tubes',
    name: 'Torpedo workshop',
    description: '+10% torpedo damage and −8% reload time per tier.',
    cost: 1100,
    max: 4,
  },
  { id: 'battery', name: 'Battery banks', description: 'Battery drain −15% per tier.', cost: 700, max: 4 },
  {
    id: 'hydrophone',
    name: 'Hydrophone array',
    description: '+25% contact detection range per tier.',
    cost: 850,
    max: 4,
  },
];

export const HEADS = [
  {
    name: 'Marta Weiss',
    role: 'Chief engineer',
    initials: 'MW',
    department: 'Engineering',
    choices: [
      ['economy', 'Economizer', 'Diesel consumption −20%.'],
      ['speed', 'Overdrive', 'All cruising speeds +12%.'],
    ],
  },
  {
    name: 'Emil Brandt',
    role: 'Weapons officer',
    initials: 'EB',
    department: 'Weapons',
    choices: [
      ['reload', 'Drill master', 'Weapon reload time −20%.'],
      ['damage', 'Ordnance expert', 'Weapon damage +15%.'],
    ],
  },
  {
    name: 'Otto Keller',
    role: 'Sonar chief',
    initials: 'OK',
    department: 'Navigation',
    choices: [
      ['range', 'Long ears', 'Contact detection range +30%.'],
      ['stealth', 'Ghost boat', 'Enemy sonar detection −25%.'],
    ],
  },
];
