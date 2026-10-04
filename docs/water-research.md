# Water research and baseline

Date: 2026-10-03. Source revision: `34bc3b7` (developer-mode PR #2).
Status: research only; no game implementation changes.

The user selected **visual priority: richer water, lighting, foam, and wakes**. Deeper physics should support that goal while keeping Greywake accessible. The implementation brief is [water-implementation-plan.md](water-implementation-plan.md); the model handoff is [water-handoff.md](water-handoff.md).

## Repository map

| Area | Entry points | Existing behavior |
| --- | --- | --- |
| Configuration | `src/config.js:1`, `defaults`, `validateConfig`, `PRESETS`, `SEA_STATES` | 105 settings; boolean/numeric tuples; three graphics and three sea presets. |
| Developer tools | `src/developer-panel.js`, `src/developer-settings.js` | F2, searchable variables, numeric entry, aids, teleport, stepping, checkpoint, profile import/export. Water inspection is an aid preset, not a dedicated water editor. |
| Ocean simulation | `src/water-surface.js:7`, `SpectralCascade` | Seeded CPU inverse FFT; displacement, slope/compression, foam; 512/128/32 m domains, 12 Hz spectrum frames, interpolation. |
| Local interaction | `src/water-surface.js:211`, `WaterInteractions` | Moving 384 m height/vertical-velocity/foam field; conservative wake impulses, finite-difference propagation, wind drift, scrolling, quantized save data. |
| Shared queries | `src/water-surface.js:415`, `OceanSurface` | Six analytic components plus three spectra; two inverse-displacement iterations; height-only public query; local wake and analytic impact contribution. |
| Analytic waves | `src/world.js:319`, `WAVES` | Six fixed directions, amplitudes and wavelengths (110, 57, 29, 16, 8, 4 m). `world.waveHeight` is a separate legacy analytic helper. |
| Water material | `src/ocean.js:128`, `Ocean` | TSL displacement and lighting, nested grids, reflection/refraction, foam, underwater window, wet hull materials. |
| Water textures | `src/water-textures.js` | Procedural foam/ripple/droplet textures; half-float upload and allocation reuse. |
| Scene/camera/effects | `src/render.js`, `View` | WebGPU first / WebGL 2 fallback, sky/PMREM, shadows, camera immersion, particles, distant wake trails, rendering diagnostics. |
| Vessel integration | `src/simulation.js:1238`, `update`; `:1473`, `syncShipBodies`; `:1485`, `stepPhysics` | Dynamic player heave, prescribed horizontal velocity/rotation, kinematic shipping, separate strategic travel branch. |
| Lifecycle/persistence | `src/main.js`, `app.attachSimulation`, `careerSnapshot`, `replace`; `Simulation.snapshot/restoreEncounter` | Career isolation already exists for the AI lab and tutorial; ocean interaction memory and hull motion are saved. |
| Verification | `tests/water.test.js`; `scripts/verify-water-*.mjs`; `scripts/verify-water-glsl.py` | Numerical behavior, backend shader generation, actual driver compilation, browser scenes, resource disposal. |

Pinned dependencies are Three.js **0.186.1**, Rapier **0.19.3**, Vite **7.3.6**, and Playwright **1.63.0**. The deliverable remains a standalone offline HTML file. There is no framework UI or external asset pipeline to replace.

## What is already substantial

Retain the shared CPU/GPU wave data, deterministic seeds, floating origin and date-line handling, near/far mesh filtering, persistent local foam, conservative disturbance stamping, and existing backend verification. Reflection, refraction, crest lighting, underwater attenuation, hull wetness, spray, bubbles, and impact rings already exist. Describing these as new features would miss the actual work: improve their quality, consistency, controls, and reproducibility.

The local field is a damped wave equation plus foam transport. It is not a depth-dependent shallow-water solver. The world has simplified coastline polygons and a coarse decorative terrain mesh, not useful bathymetry for surf or shoaling.

## Findings that change the plan

### Confirmed from code and execution

1. **The editor hides its subject.** The current developer modal dims/blurs and covers most of the sea. Both the outer modal and variable list scroll. A water experiment needs an unobstructed view while dragging controls. Desktop screenshot: `artifacts/water-planning/developer-desktop.png`.
2. **Many important controls are literals.** Water colors, RGB absorption, base roughness, reflection/refraction distortion, ripple scale/speed, whitecap generation and decay, local propagation speed/damping, hull response, spray thresholds, wetness drying, and the wave seed/band weights are embedded in code. Existing Ocean/Graphics sliders do not expose these.
3. **Live wave-speed changes jump phase.** `OceanSurface.ensure` rebuilds all spectra when `waveSpeed` or `choppiness` changes, as well as when wind or resolution changes. Phase is `time * waveSpeed`, so changing speed retrospectively changes every wave's phase. A sampled default-sea point jumped 0.784 m for a speed change from 1.0 to 1.1 at the same time. A phase accumulator and more selective invalidation are required.
4. **Permitted extremes can invalidate height queries.** Two fixed-point inversion iterations have increasing residual at high displacement. Combined maximum height/wind/chop plus weather can fold the horizontal surface mapping; merely adding more inverse iterations cannot make a folded height field single-valued. Numerical evidence appears below.
5. **Normals and breaking are approximations.** FFT normals contain height slopes and a divergence-like compression term. The shader changes the normal's Y component using compression; it does not derive the complete normal of the displaced surface. Breaking and spectral foam use several separately hardcoded thresholds/lifetimes.
6. **Clocks are split.** `Simulation.update` advances water/visual time and the interaction field once by real frame delta, then advances movement/physics by accelerated delta. Substeps share the same wave time. Render-owned trails/particles have another real-time update path. The normal frame delta also varies below the existing 1/30 s substep ceiling. The experiment contract must explicitly define pause, step, wave phase, effects, compression, and strategic re-entry.
7. **Hull motion is a controlled approximation.** Five surface heights determine desired pitch/roll. The player uses a vertical spring around ordered depth, has pitch/roll physics rotations disabled, and has horizontal velocity and orientation overwritten each step. Merchants/escorts use filtered kinematic poses. There is no water-relative velocity query, distributed buoyancy force, or hydrodynamic torque calculation.
8. **Depth response has abrupt, unrelated scales.** Player heave loses surface influence by 5 m, pitch/roll by 8 m, and wake sources by 6 m. A common immersion/response model would improve dive/surface transitions. Fluid motion attenuates by wavelength, not one universal cutoff.
9. **Foam has several owners.** Near-field persistent foam, per-cascade foam, analytic contact/far V-wake foam, and render-owned distant trail patches overlap. Their lifetimes differ (including 3 s spectral decay, configured 45 s local lifetime, and 75 s trail fade). The far analytic V is tied to current heading; the local memory/trails already preserve history.
10. **Appearance controls have coupled costs.** Refraction size follows reflection scale, clamped to 0.3–0.7. Graphics edits call `View.applySettings`, which resizes/rebinds broadly. Every developer slider input calls `app.save`, serializing the career including its water field. A richer editor needs cheap previews and coalesced commits.
11. **Warm resource identity matters.** Existing fixes deliberately retain fog, reflection UV roots, meshes and texture objects. Current water fragment shaders use 13 samplers without shadows and 14 with shadows; the verifier caps GLSL at 16. Adding independent texture sets for transitions or debug views can exceed that budget.
12. **A career snapshot is not a complete visual replay.** It saves local water memory, impact events and hull motion, but not per-cascade foam history, render-owned trail/particle state, renderer RNG position, camera, or every water scheduling accumulator. Existing checkpoint behavior must not be presented as exact A/B replay without addressing these omissions.

### Visual assessment

Fresh browser captures show a working, detailed ocean. The largest opportunities are clearer separation of swell and fine ripples; less busy, high-contrast storm highlights; more natural breakup and aging of wake foam; a better connection between hull entry and spray; and richer underwater color/depth cues. These are visual judgments, not failing test assertions.

Use the suite's 960×600 captures for baseline comparisons: `artifacts/water-upgrade/browser/webgpu-{calm,atlantic,storm,turn,underwater}.png`, with matching WebGL cases. Manual captures also exist under `artifacts/water-planning/`; those use different times/cameras and some deliberately changed settings. In particular, the manual WebGPU launch restored an experimental career. It is a backend smoke check, not a matched WebGL comparison. Screenshot FPS labels are not benchmarks.

## Numerical spot audit

The read-only audit instantiated the existing `OceanSurface` at Balanced resolution, time 12.3 s, sampled a 384×384 m region every 4 m (9,216 points), and reconstructed `q + D(q)` after the existing two inverse iterations. The horizontal Jacobian was estimated using centered differences at ±0.1 m. This measures CPU mapping consistency; it is not a rendered-pixel or triangle parity test.

| Configuration | Maximum inverse residual | Mean residual | Minimum determinant | Samples with determinant ≤ 0 |
| --- | ---: | ---: | ---: | ---: |
| Default; weather 0 | 0.0128 m | 0.000318 m | 0.8294 | 0 |
| Height 3.2, wind 17, chop 1.1; weather 0 | 0.2523 m | 0.01173 m | 0.6290 | 0 |
| Height 6, wind 22, chop 1.3; weather 0 | 2.2606 m | 0.11628 m | 0.2436 | 0 |
| Height 6, wind 22, chop 1.3; weather 1 | Not measured | Not measured | −0.3947 | 180 |

At world point (27, 51), changing wave speed 1.0→1.1 at time 12.3 changed height by +0.7840 m in the default case, +1.1596 m in the heavy-sea case, and −0.3857 m in the maximum/weather-0 case. All three replaced the cascade object. These are illustrative samples, not maximum discontinuity bounds.

Machine-readable data: `artifacts/water-planning/numerical-audit.json`. Proposed repair: continuous phase, residual-based inversion with bounded work, and a shared non-folding displacement limit. Preserve requested versus effective chop in diagnostics.

## Research and design implications

These are primary references. The implementation choices are recommendations for this repository, not claims that its existing code implements the references fully.

| Reference | Relevant result | Implication for Greywake |
| --- | --- | --- |
| [Tessendorf, Simulating Ocean Water](https://jtessen.people.clemson.edu/reports/papers_files/coursenotes2002.pdf) | Spectral synthesis, horizontal displacement, deep-water dispersion and water optics. | Extend the existing spectrum; separate controllable swell from wind detail and keep CPU/GPU definitions aligned. |
| [GPU Gems, Effective Water Simulation from Physical Models](https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-1-effective-water-simulation-physical-models) | Geometry and fine normal detail have different useful frequency ranges. | Improve scale separation and filtered highlights before increasing every resolution. |
| [Crest, Foam](https://docs.crest.waveharmonic.com/Manual/Appearance/Foam.html) | Foam generation at compressed crests, accumulation and gradual decay; shallow foam requires depth data. | Give whitecaps and wakes distinct generation/aging controls. Defer shoreline simulation until bathymetry exists. |
| [Crest, Floating Object](https://docs.crest.waveharmonic.com/Components/Physics/FloatingObject.html) | Probe-based buoyancy, drag, force bounds and wavelength filtering by object size. | Use distributed hull samples and water-relative damping, with a bounded game-oriented response. |
| [MIT OCW, Oscillatory Flow, chapter 6](https://ocw.mit.edu/courses/12-090-introduction-to-fluid-motions-sediment-transport-and-current-generated-sedimentary-structures-fall-2006/a2feced79e03dfae8b58fdf193b85f5a_ch6.pdf) | Wave-induced particle motion weakens with depth; long waves reach deeper than short waves. | Distinguish fluid velocity from moving wave crests and replace abrupt submergence cutoffs with filtered response. |
| [Rapier, Forces and impulses](https://rapier.rs/docs/user_guides/javascript/rigid_body_forces_and_impulses/) | Persistent forces/torques, mass/inertia dependence and forces at points. | Accumulate/reset forces deliberately. Keep the current scaled-mass convention unless undertaking a separate vessel-dynamics migration. |
| [Rapier, Integration parameters](https://rapier.rs/docs/user_guides/javascript/integration_parameters/) | Timestep size affects accuracy and collision reliability. | Define a fixed local step and test stepped versus continuous playback. |
| [Three.js, WebGPURenderer](https://threejs.org/docs/pages/WebGPURenderer.html) | WebGPU rendering with a WebGL 2 backend option. | Retain TSL and test both actual backends; do not introduce a WebGPU-only ocean. |
| [Three.js, Color management](https://threejs.org/manual/pages/color-management.html) | Linear working-space calculations and explicit color-space conversions. | Make color pickers sRGB-facing and convert once; retain data textures as data and avoid double tone mapping. |

Installed Three.js sources and Rapier declarations were checked alongside documentation. The pinned Rapier package exposes `resetTorques`, `addForceAtPoint`, and mass-property APIs. Their availability does not make a full six-degree-of-freedom migration the right first task.

## Baseline verification performed

| Check | Result |
| --- | --- |
| `npm run check` | Pass; 47 files, no fixes applied. |
| `npm test` | Pass; 65 tests, 0 failures, approximately 60.6 s. |
| `npm run build` | Pass; 4.59 MB standalone HTML; build ID `9494209e5bf3`. |
| `npm run test:water-driver` | Pass; eight GLSL/WGSL shader-generation cases and four actual GLES program links. |
| `npm run test:water-browser` | Pass; 16 scene captures across actual WebGPU and WebGL 2, quality cycles, texture/buffer disposal, refraction toggles and water saves; no console errors or uncaught exceptions. |
| Manual source-server inspection | WebGL and WebGPU loaded; F2 and the current panel rendered. No page errors; a pre-existing Rapier initialization deprecation warning was observed. |

The browser used `/usr/bin/google-chrome` under Xvfb and SwiftShader. No RTX 3060 Ti or phone performance claim follows from these checks. Full general-game, orientation, boot and developer browser suites were not rerun during this research-only task; they are included in the implementation acceptance plan.

Preserved local evidence under ignored `artifacts/water-planning/`: unit log, water-browser log, copied browser/shader/driver reports, numerical audit, manual screenshots, and `greywake-before.html`. The normal suite's screenshots remain under `artifacts/water-upgrade/browser/`. These local artifacts are supplementary; this document records the durable findings needed in a fresh checkout.
