# Implementation handoff: Water Lab and ocean upgrade

**Historical planning handoff:** This records the brief before implementation. For the current implementation and verification state, see [implementation status](water-implementation-status.md) and [validation](water-validation.md).
**Requested implementer:** GPT-6.1-sol, extra effort, as selected by the user.
**Baseline:** `34bc3b7`, 2026-10-03; standalone build `9494209e5bf3`.

## User intent

Extend developer mode so we can experiment with all meaningful water settings. Improve water rendering, its appearance and the physics behind its interaction with boats. The user explicitly chose **visual priority: richer water, lighting, foam, and wakes**. This planning turn must end before implementation so the user can switch models.

The next model should read:

1. [Water implementation plan](water-implementation-plan.md) — scope, control inventory, architecture, phases and acceptance criteria.
2. [Water research](water-research.md) — source map, confirmed issues, visual observations, primary references and baseline results.
3. The applicable `AGENTS.md` instructions and `~/.claude/skills/game-assets/SKILL.md` before modifying the game.

## Recommended first implementation increment

Build the docked Water Lab within the existing developer workflow, with an unobstructed scene, isolated career lifecycle, shared setting metadata and current water controls. Establish seeded scene reset, fixed camera bookmarks and pause/step behavior. Then complete the water continuity, appearance, foam/wake and bounded hull-response phases. Do not stop after adding controls.

Important constraints:

- Keep Three.js 0.186.1 / Rapier 0.19.3 and the TSL material path unless a demonstrated problem requires a dependency change.
- Retain WebGPU and WebGL 2, Mobile/Balanced/Ultra and the self-contained offline HTML build.
- Reuse the substantial existing FFT/local-water implementation. A new engine, backend, UI framework or generic ocean replacement is unnecessary.
- Preserve old career and playtest files. Water Lab autosaves the parked career; applying tuning copies only an explicit allowlist.
- Make artistic changes cheap. Stage spectrum/target rebuilds and avoid saving the full career on each slider event.
- Improve heave/pitch/roll with a bounded probe response. Full vessel dynamics and spatial-current navigation are deferred.
- Preserve fog/texture/mesh/node identity and immutable reflection UV roots. Water currently uses 14 WebGL fragment samplers with shadows; the suite enforces a limit of 16.
- Keep physics/render surface definitions, clocks and effective displacement limits consistent. Wave speed currently causes phase jumps; maximum allowed combinations can fold the surface.
- Keep all game changes out of this planning turn. Begin implementation only after the user's model switch/start instruction. Publishing is outside this handoff.

## Baseline already verified

`npm run check`, `npm test` (**65/65**), `npm run build`, `npm run test:water-driver`, and `npm run test:water-browser` all passed. The browser suite verified both actual backends, 16 water scenes, quality changes and allocation disposal with no console errors or uncaught exceptions. A Rapier initialization deprecation warning appeared in other baseline checks.

Browser execution used Xvfb and SwiftShader. These are correctness checks, not physical-device performance measurements. The implementation plan lists the broader regression suites required after code changes.

Local supporting files are in ignored `artifacts/water-planning/`, including a preserved `greywake-before.html`, logs, copied verification reports, screenshots and `numerical-audit.json`. Existing water-suite captures are in `artifacts/water-upgrade/browser/`. The research document contains the durable results if those artifacts are unavailable in another checkout.

## Ready-to-use start message

> Implement the visual-priority Water Lab and ocean upgrade described in `docs/water-implementation-plan.md`. Read `docs/water-research.md` and `docs/water-handoff.md` first. Complete the core phases, including visible rendering improvements, richer foam/wakes and the bounded boat-response changes; preserve both backends, old saves and offline packaging. Verify the actual browser flows and review matched visual captures. Work locally; do not deploy.

## Completion evidence expected

Report the new Water Lab workflow, meaningful appearance/physics improvements, presets and import/export behavior, passing checks, matched before/after captures, and remaining measured limitations. Distinguish software-renderer results from hardware performance. Keep the final diff focused on this upgrade.
