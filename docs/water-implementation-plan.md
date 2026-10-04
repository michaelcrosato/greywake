# Water Lab and ocean upgrade implementation plan

Prepared 2026-10-03 against `34bc3b7`. This is the original implementation scope. Current completion evidence is recorded in [validation](water-validation.md).

The user's priority is **visual quality**, followed by physics that makes the appearance and vessel interaction convincing. Build a practical place to experiment with all meaningful water parameters, then improve the ocean itself. See [the research and measured baseline](water-research.md) and [the implementation handoff](water-handoff.md).

## Outcome and scope

A developer can open a Water Lab from F2, see the sea while tuning it, isolate wave/foam/lighting contributions, reproduce a scene, compare looks, and save a preset. Calm water, Atlantic swell and heavy seas should differ in wave structure, highlights, whitecaps, wakes and hull motion. Diving should reveal a coherent underwater treatment with a stable transition at the surface.

Complete the core phases below, including the appearance and interaction improvements. A panel full of sliders alone does not complete the task.

Keep the existing JavaScript/Three.js TSL/Rapier architecture, both rendering backends, procedural/offline assets, quality tiers, and standalone HTML build. This iteration uses a bounded height-field ocean and controlled vessel motion. Full fluid volumes, overturning breakers, bathymetry/surf, a WebGPU-only compute rewrite, and a full submarine dynamics/ballast simulator belong to a later iteration.

## 1. Water Lab experience

### Entry, layout and isolation

- Add **Open Water Lab** under F2 → Sea and inspection and Settings → Ocean. Retain the existing Water inspection aid preset.
- Use a dock about 360 px wide on desktop, capped at one third of the viewport. Leave the scene visible and interactive; remove the modal backdrop and focus trap for this dock. A collapsible bottom sheet on narrow screens should leave a useful scene view. Preserve the game's typography, colors and controls.
- Keep Play/Pause, Step, Reset scene, camera, A/B, and preset actions in a compact persistent toolbar. Put controls into **Waves, Surface, Foam & wakes, Underwater, Boat response, Lighting, Quality, Inspect**. Include search, changed-only, Advanced, per-field default, per-section reset, numeric entry, color pickers and named enum choices.
- Reuse the AI lab's parked-career pattern. Opening Water Lab creates a separate simulation from a cloned checkpoint and parks the career; initial camera/boat/sea match the patrol. Label it **Water Lab · experiment**. Preset scenes operate on this experiment. **Apply water tuning to patrol** copies only an explicit water/lighting/quality allowlist. **Return to patrol** restores the parked simulation, camera, pause state, inputs and launch/HUD state.
- Add Water Lab to `careerSnapshot`, `attachSimulation`, replacement/import/recovery, and frame-loop routing. Autosave continues to save the parked career. The lab must work from the launch screen as well as during a patrol. Tutorial, AI lab and Water Lab are mutually exclusive; use their existing return/stop paths.
- Do not copy experimental position, rewards, elapsed career time, damage, encounters or developer aids back to the career when applying tuning. Lab UI state and debug modes are separate from game configuration.

### Repeatable experiments

- Seeded scenes: still boat in flat water; calm cruise; Atlantic swell; heavy head seas; heavy beam seas; turning wake; merchant/escort wake crossing; dive/surface; shallow camera crossing; shell/torpedo/depth-charge impacts. Provide frozen noon, low sun and overcast lighting views.
- Camera bookmarks: chase, low bow, broadside, stern/wake, periscope, overhead, underwater looking up. Allow orbit and a fixed camera; hide ordinary HUD for inspection/capture while keeping the lab toolbar reachable.
- **Pause** freezes simulation and effects. **Step frame / 1 s / 10 s** advances exact simulation durations and redraws. Long advances yield between batches so controls remain responsive.
- **Freeze wave phase** holds the base wave field while boat/local wake evolution may continue; report zero base-wave velocity in that mode. It is distinct from pausing the whole scene. Reset/rerun is the initial mechanism for going backward; do not expose arbitrary time scrubbing over stateful foam.
- **Store A / Store B / View A or B** compares appearance at the same camera, wave phase, seed and held boat pose. Use one renderer and sequential frames. For changes to boat/wake behavior, **Rerun scene** starts from the same initial fixture and scripted inputs. Do not suggest two differently evolved hull/foam histories are an exact material comparison.
- Export/import a versioned `greywake.water-lab/1` recipe: seed, water tuning, quality, lighting, scenario, initial conditions, camera, duration and scripted actions. This is a reproducible recipe; it is not a career save or a serialized GPU resource. Reject unsupported versions and malformed/oversized fields with a useful message.
- Keep the existing playtest profiles and career exports compatible. Add a water-only preset format if useful, using the same validation and allowlist as the lab recipe.

## 2. Settings, validation and control inventory

Keep `SETTINGS` as the canonical collection of values/defaults. Add metadata for control type, units, lab section, help text, update class and cost. Adapt the existing numeric/boolean tuples instead of rewriting all 105 legacy settings. Extend shared validation/input helpers for integer, string enum and color types. Both settings UIs, imports, resets and presets must use those helpers.

Suggested additions: `waterWaves`, `waterAppearance`, `waterInteraction`, `waterMotion` groups. Existing `ocean.*` and `graphics.*` paths remain valid. `src/water-settings.js` can export new descriptors/metadata for `config.js` to include without a circular dependency. Keep the ordinary Settings interface compact; the full inventory belongs in Water Lab and developer search.

“All water settings” means all existing water-related fields and every newly introduced artistic/physical parameter below have a reachable, functioning control. Internal epsilon values, gravity, transform conventions and solver safety limits remain documented implementation constants. Resource layouts and fixed pool limits can be read-only diagnostics rather than unrestricted numeric inputs.

### Existing fields to reuse

| Lab section | Existing paths |
| --- | --- |
| Waves | `ocean.waveHeight`, `waveSpeed`, `choppiness`, `windSpeed`, `windDirection`, `weather`, `stormStrength` |
| Surface / foam | `graphics.detailWaves`, `graphics.foam`, `ocean.crestLight`, `foamLifetime`, `wakeStrength`, `wakeLength` |
| Underwater / boat | `ocean.clarity`, `buoyancy`, `buoyancyDamping` |
| Lighting | `ocean.cloudCover`, `sunHour`, `dayCycle`, `dayMinutes`; `graphics.exposure`, `environmentRefresh`, `shadows`, `shadowResolution` |
| Quality / view | `graphics.pixelRatio`, `oceanSegments`, `spectrumResolution`, `interactionResolution`, `reflections`, `reflectionScale`, `waterRefraction`, `particles`, `viewDistance`, `cameraDistance`, `cameraHeight` |

The current “Swell height · m” is a coefficient scaling a mixture of waves, not measured significant wave height. Preserve saved values and make that distinction in the label/help. Allow zero wave height and zero wind for a genuinely flat test fixture. Provide a separately labeled measured height estimate if added; do not relabel the old slider as significant wave height.

### Additional controls

Ranges below are starting UI ranges, not assertions that every combination is physically admissible. Defaults initially reproduce the current look; the final art pass supplies improved presets. Units and validation must remain correct even when imports bypass the UI.

| Section | Parameters / suggested range | Update behavior |
| --- | --- | --- |
| Wave composition | Seed (unsigned integer); analytic swell enabled; swell gain 0–2; heading offset ±180°; wavelength scale 0.5–2; individual gains 0–2 for the three FFT bands | Phase/gain controls live; seed/composition changes rebuilt at an explicit boundary with a transition or scene reset. |
| Advanced swell editor | Six bounded components: enabled, wavelength 4–300 m, amplitude 0–1.5, travel direction 0–360°, phase 0–360°. Initialize from `WAVES`; controls share one descriptor set with CPU and TSL. | Fixed-size uniforms/arrays; validate steepness and sampling. A component's phase edit is intentionally a phase change. |
| Spectrum shape | Directional spread; wind-sea energy; short-wave suppression; spectral update rate choices 8/12/20 Hz | Spectrum changes staged/crossfaded; update rate changes preserve phase. Three cascade extents remain fixed for this iteration. |
| Surface color | Deep/scatter/crest colors; clear/overcast look presets | Color pickers store sRGB hex; convert to the working space once. Existing raw linear constants require conversion when establishing equivalent defaults. |
| Highlights | Base roughness 0.03–0.25; wind roughness gain 0–0.2; sun-glitter gain 0–2; crest-light width/gain | Uniform-only. Retain derivative filtering and an energy bound. |
| Fine detail | Ripple scale 0.25–4×; travel speed 0–3×; wind alignment; near strength and distance fade | Uniform-only; does not change hull physics. Keep fine normal detail separate from geometric waves. |
| Reflection | Environment contribution 0–2; planar contribution 0–1; distortion 0–2×; existing enable/resolution | Appearance uniform-only; target size changes only on commit. Zero contribution should skip an optional pass when equivalent to disabled. |
| Refraction / absorption | Independent refraction scale 0.25–1; distortion 0–2×; RGB absorption coefficients 0.001–0.5 /m; refraction weight 0–1 | Coefficients/uniforms live; size committed. Keep IOR at the water default except an explicitly advanced bounded control (1.30–1.36), deriving Fresnel from it. |
| Underwater | Scatter tint/gain; extinction/visibility; surface transition width 0.2–2 m; surface-window strength | Uniform-only; one coherent optics configuration shared with hull shading and camera fog. |
| Whitecaps | Compression threshold, generation gain 0–3, decay 0.5–15 s, coverage cap, texture/bubble scale 0.25–4×, brightness/roughness | Scalar controls live; thresholds use the new documented compression convention. |
| Wakes | Hull contact, bow and propeller foam gains 0–3; width scale 0.5–3×; turn sensitivity; trail lifetime/length; existing displacement gain | Live and bounded; one documented near/far blend and shared age units. |
| Local field | Propagation speed 2–12 m/s; damping 0.2–4 /s; foam diffusion 0–1 m²/s; wind drift 0–0.8 m/s; uniform current speed 0–1.5 m/s and travel direction | Automatic stable substeps; fixed 384 m footprint; existing 128/256/512 resolution choices commit/resample. Current defaults to zero. |
| Spray / wetness | Entry threshold 0.1–3 m/s; spray gain 0–2; droplet size/lifetime 0.5–2×; wet darkening 0–0.5; wet roughness; dry time 5–120 s | Live; pool/budget remains bounded and capability-independent. |
| Impacts | Ring gain 0–2; spreading/decay scale 0.5–2×; depth attenuation distance 5–60 m; foam/spray gains | Shared CPU/TSL parameters. Existing weapon gameplay damage remains a separate setting. |
| Boat response | Heave stiffness/damping; pitch and roll response/damping; water-velocity influence 0–1; entry/slam response 0–1; immersion blend distance; bow/stern and port/starboard support weighting | Fixed-step solver controls; bounded by coupled stability rules. Probe layouts/inertia use vessel-class presets; physics quality is not silently changed by graphics presets. |

Show a north/east compass convention on direction controls: 0° points north (`-Z`), 90° east (`+X`), and arrows describe **travel toward**. Existing wind direction already creates that vector; do not silently switch it to meteorological “from” semantics.

### Apply semantics

Classify changes as **uniform**, **simulation scalar**, **spectrum transition**, or **resource rebuild**. Preview cheap changes on input. Coalesce expensive changes and apply on pointer release/change or after a short idle interval; show requested and effective values while pending. A slider must not synchronously serialize a 512² career water field on every input.

Validate imports atomically before mutation. Check finiteness, ranges, enum membership, color syntax, integer seeds, coupled constraints, and supported resolutions. Use a path allowlist; never recursively assign arbitrary imported properties. Defaults, UI validation, profile import and save migration must agree.

Reset section and preset application are transactions, including their dependent state. Changing the sun/clouds in a paused experiment must explicitly refresh the environment map; waiting for the periodic PMREM timer makes comparisons misleading.

## 3. Shared water state and continuous editing

Introduce an explicit water phase clock and a narrow, testable surface contract in `water-surface.js` (extract pure math into `water-math.js` if this reduces duplication):

```js
// Conceptual API; use allocation-free outputs in hot paths.
water.advance(dt, sources, environment);
water.sampleSurface(x, z, options, out);
// out: height, normal, displacement, surfaceVerticalVelocity,
//      approximateFluidVelocity, foam, compression, inverseResidual
water.sampleHull(points, options, outputs);
water.renderState();
water.snapshot();
water.restore(snapshot);
```

Keep `sim.sampleWater(x,z)` as a compatibility height wrapper. Preparing/advancing state owns FFT/foam changes; queries and drawing must not advance physical state. Cache by wave clock plus configuration revision and weather/amplitude revision, not by time alone.

### Phase, spectra and query correctness

1. Integrate phase time (`wavePhase += dt * waveSpeed`) so changing speed changes its future rate. Do not rebuild `h0` for speed or chop. Chop changes displacement, not the random sea realization.
2. Use seed plus integer wavevector/cascade identity for random coefficients so a resolution change does not randomly replace all shared low-frequency modes. Normalize spectral energy independently of frame extrema. Add complementary frequency windows so cascade controls have understandable effects rather than adding overlapping energy without accounting for it.
3. For wind/composition transitions, retain an old and a target CPU spectrum for a bounded transition (initially 1–3 s). Blend CPU height/displacement and upload the same blended field into the existing texture set. A second complete GPU sampler set would exceed the current budget. Test correlated/uncorrelated seeds so crossfading does not visibly collapse or boost energy.
4. Compute the horizontal displacement Jacobian and use a shared effective-chop limit to keep the mapping invertible. Apply the same limit on CPU and GPU, including weather and band gains. Start with a conservative derivative bound plus measured diagnostics; do not independently clip shader displacement and leave CPU queries unchanged.
5. Replace the unconditional two inverse iterations with a bounded residual-based solver (start with at most 6–8 iterations, with a guarded Newton/fixed-point fallback). Proposed near-hull target: residual ≤ 0.02 m at ordinary presets and ≤ 0.05 m throughout the supported extreme envelope. Return a diagnostic if the work limit is hit. Revisit the envelope rather than pretending a folded surface has a unique height.
6. Derive surface normals from displaced tangents, including the off-diagonal displacement derivatives and local/impact slopes. Define all signs/coordinates once. Keep a filtered fine-detail normal contribution separate. Choose texture packing/fetches against the actual GLSL sampler and frame budgets; verify the shader before adding more layers.
7. Distinguish surface motion, crest phase speed, and approximate fluid velocity. Derive the velocity used for hull damping and spray from the wave model, not by treating moving foam textures as fluid. Apply wavelength-dependent depth attenuation and label the result as the model's approximation.

### Time policy

Use a fixed 1/30 s local simulation step with an accumulator and interpolated rendering. At 1× and local compression up to 20×, advance the water phase, local field, hull response and encounter events from the same accepted simulation time. FFT synthesis may run at its configured lower sample rate and interpolate. Cosmetic animation can use interpolated time, but must not create or age gameplay-affecting water independently of stepping.

Limit work per animation callback and yield long lab advances. Track requested versus achieved compression; if the machine cannot sustain the requested rate, slow the achieved rate and report it rather than growing `dt` or accumulating unbounded work. Tests compare simulated duration, not how quickly a software adapter executes it.

Above 20×, retain strategic navigation with its existing coast/resource/contact checks. Advance phase by accepted travel time analytically, expire/decay local transient memory, recenter after movement, and resume local physics without an old wake impulse or a large velocity spike. Do not simulate every wave tick of a 5000× voyage. Preserve saved time and accumulator semantics, with defaults for old saves.

The attract screen can have its own preview clock and pose, but it must not mutate the parked career or lab state. Freeze/pause and rendering extra frames must not change authoritative foam or boat state.

## 4. Appearance upgrade, in priority order

### Wave shape and highlights

Make swell direction/length/energy separately visible from wind sea and micro ripples. Keep the four ring meshes initially. Improve near-ring transitions with compatible displacement filtering and an edge morph if inspection shows a seam; do not substitute skirts for a visibly continuous surface. Check low camera angles and grazing horizon views.

Use the corrected large-scale normal, filtered small-scale slopes and roughness to create readable broad wave faces and a narrower, stable glitter distribution. Control crest lighting independently from white foam. Preserve dark troughs without crushing the hull silhouette. No new full-screen post-processing dependency is needed for this pass.

### Reflection, refraction and color

- Retain planar reflection for nearby scene objects plus the existing sky environment. Fade their blend consistently with roughness/distance. Keep the planar approximation to the mean surface explicit; reflected objects will not become ray-traced just by increasing its resolution.
- Separate refraction resolution from reflection resolution. Validate distorted UVs against scene depth and fall back to the undistorted valid sample/deep-water result at silhouettes and screen edges. Clamp distortions near geometry; avoid pulling foreground boat pixels through the water.
- Use a common set of linear RGB absorption/scattering parameters for transmitted scene color, wet/submerged hull treatment and the underwater look. The current depth difference is an approximate optical path; reconstruct view positions or correct the path length where needed, with tests at grazing angles.
- Derive Fresnel from the selected IOR and keep reflection/transmission energy bounded. Give foam its own rough diffuse response; it should suppress the mirror-like water contribution beneath it.
- Expose sky/environment refresh and a manual refresh action for inspection. Keep persistent PMREM/fog/reflection nodes and immutable base reflection UVs.

### Foam, contact and underwater readability

Give foam macro breakup, bubble detail and an age-dependent transition from bright fresh bubbles to thin residual streaks. The same foam field should not appear as opaque grey paint in every lighting condition. Distinguish crest whitecaps from hull contact and propeller wash; tune their coverage separately.

Stabilize camera crossing with continuous immersion and hysteresis. One camera immersion result should drive fog, surface side treatment, reflection availability and the underwater window. Keep the boat legible at representative visibility settings; distinguish this from artificially illuminating deep water. Reuse the existing caustic hint only where shallow, lit and affordable. High-cost volumetric shafts and underwater postprocessing are optional later work.

## 5. Interaction and motion improvements

### Persistent foam and wakes

- Generate whitecap foam from the validated displaced-surface compression measure. Treat it as accumulated state with decay/advection, not just an instantaneous threshold. Choose one ownership path for persistent crest foam and keep it consistent across saves and replay.
- Retain the local conservative wave solver. Express diffusion in world units and transport foam using a bounded current/flow estimate plus wind drift. Uniform current is a lab/local water control in this iteration; it does not silently change global routes, torpedo aiming or AI navigation.
- Compute stable substeps from spacing and propagation speed. For the existing 2D stencil, enforce a conservative Courant bound such as `c * dt / dx <= 0.5`; the undamped linear stability ceiling is `1/sqrt(2)`. Also respect advection and diffusion bounds. At the current 512 grid, `dx=0.75 m`, `c=8 m/s`, `dt=1/30 s`, the Courant number is about 0.356. New ranges require recalculation.
- Convert edge damping to a world-space width and time-based rate. Measure energy decay and boundary reflection after resizing; damping should not change simply because the number of steps changed. Keep disturbances approximately zero-volume.
- Deposit bow, side and propeller sources from actual hull movement, local immersion, water-relative entry velocity and turn rate. Use traveled-distance sampling/interpolation so moving sources do not become dots at high speed or compression. Avoid re-emitting foam when paused or when drawing extra frames.
- Consolidate render-owned far wake history into bounded world-space simulation history. Preserve turning arcs and decay after engines stop; crossfade with the local field so the transition neither doubles nor erases foam. Replace the heading-attached far V where it conflicts with stored history. Keep a bounded distant fallback for large fleets.
- Use the same contact/entry event to drive spray and hull wetness. Initialize previous contact samples on spawn/teleport to avoid an artificial first-frame splash. Let spray fall back into the surface; bound any return impulse to avoid self-exciting feedback. Give sinking ships and impacts their own limited source patterns.

### Controlled probe response

Improve heave/pitch/roll with distributed support and relative damping while keeping the existing helm, ordered depth and kinematic shipping model. This is a **game-oriented probe model**, not a claim of calibrated submarine hydrostatics.

Use 8–12 weighted support points for the player/nearby vessels (bow/mid/stern, port/starboard), scaled by hull class. Compute contact depth, sampled wave velocity and probe velocity including rotational motion. Integrate accumulated vertical support and pitch/roll torque with class-specific inertia and damping. Low-pass wavelengths that are too short to move the hull materially.

To preserve collision tuning, keep the existing Rapier mass convention (player mass is 750 in engine units). Normalize support weights to the body's mass and calibrate equilibrium to the existing approximately −2 m surfaced body origin. A usable starting support law is weighted gravity compensation plus bounded immersion spring force; relative-velocity damping is a separate force. Tune nonlinear emergence/immersion and slam response after flat-water equilibrium is established. Do not insert a seawater density in SI units against the current scaled mass and call the result correct.

For this iteration, apply summed heave force to the dynamic player body and integrate pitch/roll in the existing reduced motion state; the composed pose drives its collider/model. Shipping remains kinematic but uses the same response calculation. Keep exactly one owner of each degree of freedom. Do not add Rapier pitch/roll torques while continuing to overwrite those same rotations. A fully dynamic boat would require a separate change to rotation locks, yaw control, velocity control, inertia, save state and collisions.

Blend surface support into depth-hold behavior with one continuous immersion policy. Distinguish ordered gameplay depth from wave heave/body position. Replace the independent 5/6/8 m response cutoffs with deliberate smooth envelopes, and attenuate orbital motion with wavelength/depth. At full submergence, maintain stable depth/trim without buoyancy growing indefinitely. Keep wave motion from arbitrarily changing torpedo firing/deck-gun depth permissions.

## 6. Diagnostics, persistence and budgets

Inspect views: beauty, geometric height, final normal, compression/Jacobian, foam sources, foam age/coverage, local field extent, mesh rings/wireframe, reflection, refraction and scene depth, immersion, hull probes/support vectors. Debug switches should use stable material variants/uniforms and bounded overlay objects. They must not repeatedly append to a TSL graph or remain active after leaving the lab.

Telemetry: sea seed and phase, requested/effective settings, surface query residual, minimum Jacobian, heave/pitch/roll and velocities, probe contact/entry, foam coverage, local solver substeps/Courant number, phase/physics clocks, FFT/query/interaction/upload CPU time, draw calls, target dimensions, textures/buffers, backend and adapter. Report measured GPU time only if available; CPU submission time is not GPU frame time.

Persist authoritative wave clocks, water revision/seed, foam/wake state, relevant scheduling accumulators and hull response under a versioned optional water snapshot. Keep old encounter v1 files readable; do not reject an entire career because it lacks new water fields. Default missing fields and migrate known legacy settings. Resample or explicitly reset incompatible visual memory while preserving the career.

For exact lab reruns, reset both simulation and render RNG, effects, trails, camera smoothing and environment state. Use scenario recipes plus deterministic warmup to reconstruct history. If implementing an exact in-memory checkpoint, capture all authoritative water state instead of assuming the current career snapshot is complete. Store only bounded/quantized history in localStorage; a 512² local field already costs roughly 1.75 MB as base64 before other career data.

Keep Mobile/Balanced/Ultra as starting tiers. Nominal design targets are 30 FPS at practical mobile resolution and 60 FPS at 1080p on the existing desktop reference class; **these require device measurements and are not current results**. Record frame-time percentiles with the lab open/closed, boats nearby, heavy seas, underwater and repeated tuning. Stop increasing detail when it obscures wave shape or exceeds cost.

Retain a maximum of 16 fragment samplers for the WebGL path unless a more conservative actual-device limit applies; current water uses 14 with shadows. Keep optional passes skippable, pool effects, reuse arrays/textures/meshes, and verify allocation counts after warmup. Run GPU browser suites sequentially on the workstation's software adapter.

## 7. Implementation sequence and file ownership

| Phase | Deliverable | Main files | Exit condition |
| --- | --- | --- | --- |
| 1 | Water Lab shell, isolated lifecycle, typed water metadata, existing controls, reproducible scenes/cameras | New `water-lab.js`, `water-settings.js`, optionally `water-scenarios.js`; `developer-panel.js`, `ui.js`, `style.css`, `main.js`, `config.js` | Tune existing water while seeing it; stepping works from launch and patrol; exit/apply cannot corrupt career. |
| 2 | Continuous editing and authoritative water contract | `water-surface.js`, optional `water-math.js`, `simulation.js`, `world.js`, `ocean.js` | Speed/gain edits do not unexpectedly jump phase; extreme queries are bounded; time/pause/step semantics and legacy-save migration tested. |
| 3 | Visible appearance upgrade and newly exposed optics/detail controls | `ocean.js`, `water-textures.js`, `render.js`, configuration/lab | Matched captures improve swell/readability, foam material, reflection/refraction and underwater transitions on both backends. |
| 4 | Persistent whitecaps, stable interaction transport, coherent wakes and spray | `water-surface.js`, `simulation.js`, `render.js`, optional `water-effects.js` | Turns leave curved history; stopping/dive changes sources smoothly; no accumulated volume/energy growth or near/far seam. |
| 5 | Distributed hull response and inspection overlays | `water-surface.js` or `water-motion.js`, `simulation.js`, `render.js`, lab | Equilibrium, wave-direction response, damping and submergence behave consistently; old navigation/combat controls still work. |
| 6 | Preset art pass, A/B/export polish, regression/performance verification, documentation | Existing tests/scripts plus focused new tests; `README.md` | Acceptance matrix below passes; hardware-dependent claims are labeled; the user has useful presets and reproducible experiments. |

Implement in reviewable increments; extraction is justified only where it gives math/state/UI a clear owner. Keep unrelated AI, economy, progression and model-asset work out of this change. The phases are one coherent requested upgrade, not permission gates.

## 8. Acceptance matrix

### Meaningful automated checks

| Concern | Required assertion |
| --- | --- |
| Schema | All existing settings remain valid; new types/ranges/defaults round-trip; every declared water parameter reaches a real runtime value; invalid profile imports leave state unchanged. |
| Continuity | Changing only speed does not move the surface at the edit instant; gain/wind transitions remain finite and bounded; random seed is repeatable; shared low-frequency modes survive quality changes. |
| Query correctness | Analytic plane/single-mode cases have expected height/normal/velocity; inverse residual meets the selected bound; determinant remains positive over supported stress presets. CPU/GPU near-field samples agree within explicit quantization/mesh tolerances. |
| Time | One second via fixed steps agrees with one second of ordinary simulation to tolerance; render-only frames do not age water; pause freezes state; local compression uses coherent clocks; strategic travel/re-entry and the date line remain continuous. |
| Interaction | Stable at every supported resolution and extreme accepted speed/diffusion; foam decays/advection follows configured direction; recentering preserves world locations; impulses have near-zero volume and bounded energy. |
| Hull | Flat water returns to equilibrium; head seas primarily excite pitch, beam seas roll; response settles; surface entry/exit and full submergence remain bounded; stationary waves can wet a stopped hull without continuous artificial spray. |
| Lifecycle | Lab open/reset/repeat/close does not modify parked career; apply modifies only water allowlist; import, new career, GPU recovery, tutorial and AI lab transitions dispose/restore correctly. |
| Persistence | Old career/playtest JSON loads; new water state round-trips within quantization tolerance; corrupt optional memory does not destroy a valid career; repeated export stays within bounded size. |
| UI | Desktop dock and 393×852 / 852×393 touch layouts expose controls without losing the scene; keyboard and pointer input remain usable; camera/HUD restore; reset/A/B/import/export work through actual controls. |
| Rendering | Both backend shaders compile, sampler limits hold, screenshots are reviewed, and repeated preset/quality/scene changes return texture/buffer/shader counts to a stable warm baseline. |

For GPU query parity, add a test-only offscreen sample/render readback using the actual TSL field. Compare the authoritative field first and account separately for mesh filtering and half-float quantization. Do not confuse a CPU translation of GLSL with execution of the actual backend.

Extend `tests/water.test.js`, `tests/developer.test.js`, `tests/persistence.test.js` and a focused lab test rather than snapshot-testing shader text. Extend the existing shader/browser water verifiers; use a dedicated `verify-water-lab.mjs` for the lab workflow if that keeps suites understandable.

### Visual review scenes

Capture matched seed/time/camera/lighting at calm noon, low-sun swell, overcast storm, low grazing angle, stopped hull, fast straight wake, 90° turn with an aging wake, wake crossing, surface camera crossing, underwater up-view, distant weapon impact, and all quality tiers. Record presets and capability settings next to screenshots. Review motion clips as well as stills for shimmering, swimming foam, pops, seams and immersion flicker. Dynamic screenshots should use tolerances; do not demand pixel identity between backends.

### Commands and final review

```sh
npm run check
npm test
npm run build
npm run test:water-driver
npm run test:water-browser
npm run test:developer
npm run test:browser
npm run test:boot
npm run test:boot:dev
npm run test:orientation
npm run test:ai-lab
# Run the new Water Lab verifier once added.
# Profile representative current-build cases without repeating the historical audit patch:
AUDIT_CASES=original,no-reflections AUDIT_REPORT=water-after npm run profile:renderer
```

Use `artifacts/water-planning/greywake-before.html` with `AUDIT_BUILD` for a comparable preserved baseline when useful. Add water-subsystem timings to the profiler instead of interpreting its current CPU submission metric as FFT/physics/GPU time. The native GLES capture route is supplementary and omits planar reflection/refraction passes; it cannot replace browser verification.

Review the final diff for accidental dependency updates, save-format breakage, duplicated configuration, unbounded allocations, and controls that do not affect output. Update README with the Water Lab workflow and actual limitations. Keep the local static build usable offline. Deployment is not part of this planning handoff.

## Deferred extensions

Consider JONSWAP/TMA authoring, a worker/GPU FFT, projected-grid replacement, flow/bathymetry-aware coastal waves, full force-at-point Rapier boats, ballast/dive-plane controls, spatial currents affecting navigation, and expensive volumetric/post-processing optics only after the core upgrade is measured. None is required to deliver the selected visual-priority result.
