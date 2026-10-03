import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import {
  AI_SCENARIOS,
  createScenario,
  PLAYER_PROFILES,
  stepScenario,
  telemetryFrame,
  trialMetrics,
} from '../src/ai-scenarios.js';
import { defaults, validateConfig } from '../src/config.js';
import { initPhysics } from '../src/simulation.js';

const args = process.argv.slice(2),
  get = (key, fallback) => {
    const i = args.indexOf(`--${key}`);
    return i < 0 ? fallback : args[i + 1];
  };
const scenario = get('scenario', 'all'),
  seeds = Math.max(1, Math.min(100, Number(get('seeds', 8)))),
  duration = Math.max(15, Math.min(1200, Number(get('duration', 180)))),
  firstSeed = Number(get('seed', 42)),
  profile = get('profile', 'evasive'),
  settings = get('settings', null),
  out = get('out', 'artifacts/ai-lab'),
  replayFile = get('replay', null);
if (
  !Number.isFinite(seeds) ||
  !Number.isFinite(duration) ||
  !Number.isFinite(firstSeed) ||
  !PLAYER_PROFILES.some((p) => p.id === profile)
)
  throw new Error('Use valid numeric arguments and a supported player profile');
const config = settings ? validateConfig(JSON.parse(await readFile(settings, 'utf8'))) : defaults();
await initPhysics();
await mkdir(out, { recursive: true });
if (replayFile) {
  const replay = JSON.parse(await readFile(replayFile, 'utf8'));
  if (
    replay.version !== 1 ||
    !AI_SCENARIOS.some((s) => s.id === replay.scenario) ||
    !PLAYER_PROFILES.some((p) => p.id === replay.profile)
  )
    throw new Error('Choose a Greywake AI replay');
  const run = createScenario(replay.scenario, replay.seed, validateConfig(replay.config), replay.profile),
    frames = [telemetryFrame(run.sim)],
    events = (Array.isArray(replay.events) ? replay.events : [])
      .filter((e) => e && Number.isFinite(e.time) && e.time >= 0 && e.time <= 1200)
      .sort((a, b) => a.time - b.time),
    end = Math.max(0, Math.min(1200, Number(replay.duration) || replay.frames?.at(-1)?.time || 0)),
    time = performance.now();
  stepScenario(run, end, (f) => frames.push(f), events);
  const metrics = { ...trialMetrics(run, frames), cpuMs: performance.now() - time };
  await writeFile(
    `${out}/replayed-trace.json`,
    JSON.stringify({ ...replay, frames, decisions: run.sim.aiEvents, metrics }),
  );
  console.log(JSON.stringify(metrics));
  run.sim.dispose();
  process.exit(0);
}
const cases = scenario === 'all' ? AI_SCENARIOS : AI_SCENARIOS.filter((s) => s.id === scenario);
if (!cases.length) throw new Error('Unknown scenario');
const report = { version: 1, config, profile, duration, trials: [], started: new Date().toISOString() };
const started = performance.now();
for (const item of cases)
  for (let i = 0; i < seeds; i++) {
    const run = createScenario(item.id, firstSeed + i, config, profile),
      frames = [telemetryFrame(run.sim)],
      time = performance.now();
    stepScenario(run, duration, (frame) => frames.push(frame));
    const metrics = { ...trialMetrics(run, frames), cpuMs: performance.now() - time };
    if (!report.trials.length) report.config = structuredClone(run.sim.config);
    report.trials.push(metrics);
    if (i === 0)
      await writeFile(
        `${out}/${item.id}-trace.json`,
        JSON.stringify({
          version: 1,
          scenario: item.id,
          seed: run.seed,
          profile,
          config: run.sim.config,
          duration: run.sim.p.time,
          tuning: run.sim.config,
          events: [],
          frames,
          decisions: run.sim.aiEvents,
          metrics,
        }),
      );
    console.log(JSON.stringify(metrics));
    run.sim.dispose();
  }
report.cpuMs = performance.now() - started;
report.aggregate = Object.fromEntries(
  cases.map((c) => {
    const rows = report.trials.filter((t) => t.scenario === c.id);
    return [
      c.id,
      {
        trials: rows.length,
        detectionRate: rows.filter((t) => t.firstDetection !== null).length / rows.length,
        meanDetectionSeconds: rows.reduce((a, b) => a + b.detectionSeconds, 0) / rows.length,
        meanPatterns: rows.reduce((a, b) => a + b.patternAttacks, 0) / rows.length,
        meanDamage: rows.reduce((a, b) => a + b.potentialDamage, 0) / rows.length,
        states: [...new Set(rows.flatMap((t) => t.states))],
        roles: [...new Set(rows.flatMap((t) => t.roles))],
      },
    ];
  }),
);
await writeFile(`${out}/batch-report.json`, JSON.stringify(report, null, 2));
console.log(
  `AI batch complete: ${report.trials.length} trials in ${(report.cpuMs / 1000).toFixed(2)} s. ${out}/batch-report.json`,
);
