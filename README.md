# Greywake

A free-roaming WWII submarine sandbox. Captain a fictional independent U-boat, intercept Allied shipping, earn bounty, and shape your captain, boat, and crew. There are no assigned missions.

## Play

**[Play Greywake online](https://greywake-azure.vercel.app)** in a current Chrome or Edge browser.

For offline play, run `npm install` and `npm run build`, then open `dist/greywake.html`. This file is self-contained: JavaScript, CSS, geometry, textures, audio synthesis, and Rapier WASM are embedded. It requires no network connection or asset server. WebGPU is preferred; WebGL 2 is the fallback. `?renderer=webgl` explicitly selects that fallback.

To work on the source:

```sh
npm install
npm run dev
```

Vite prints the local URL. Serve over localhost or HTTPS for WebGPU availability. The game is also playable with touch controls in portrait or landscape.

## Developer mode

Open **Settings → Developer mode**, or press **F2** on the launch screen or during a patrol. Turn on Developer mode for playtest aids; an active-mode badge appears in the game. **Normal play** disables the aids and restores normal speed limits. Your live balance/graphics tuning remains as edited until you reset it.

The panel exposes all 213 game variables with search, group filters, sliders, precise numeric entry, defaults and profile import/export. It covers graphics, ocean, navigation, combat, traffic, AI and economy. **Fast travel**, **Combat testing** and **Water inspection** presets configure developer aids separately from those game variables.

Aids include invulnerability, speed and maneuver multipliers, unlimited fuel/battery/oxygen and ammo, instant reloads, no collisions/grounding, frozen ships/AI, paused traffic spawning and combat time compression. Combat compression caps at 20× and uses real physics; higher rates remain for clear-water travel. Paused frame/one-second/ten-second steps advance actual simulation and physics, so weapon, movement and AI tests do not require waiting in real time.

Teleport to coordinates with depth/heading, jump to open Atlantic water or a named harbor, move near a selected contact, or use **Teleport to selected point** on the chart. Jumps stop the engines, clear navigation/weapons/wakes and synchronize physics and rendering. Moving near a contact preserves the ships. Harbor jumps find nearby navigable water when a map marker sits inside the simplified coastline, and report the offset. Manual land destinations require the no-collision/grounding aid.

Encounter tools spawn merchants, escorts and convoys, clear contacts/weapons, sink a selected target, restore/rearm and grant bounty/XP. Tools alter the active career and its rewards. **Save checkpoint / Restore checkpoint** preserves a test's career, encounter, tuning, aids and pause state during the current session. Export a career for a checkpoint that survives closing the page. Playtest profiles save tuning and aids; saved careers retain developer settings across reloads. Guided practice and the AI lab keep their own simulations and start with developer aids off.

```sh
npm run test:developer
```

## Startup diagnostics

A small boot screen runs before the game. It reports version, deterministic build ID, platform, renderer/adapter and startup stage. Required checks finish before game code, styles or UI activate. The main loop starts only after physics, the renderer, shader compilation and a validated first frame succeed. WebGPU can fall back to WebGL 2; missing audio or local storage is reported without blocking play.

If startup fails, keep the short error code or download the report for a bug report. The screen remains readable with retry, WebGL fallback and copy/download actions. **Settings → Startup diagnostics** reopens a successful report. The [startup contract](docs/boot-loader.md) documents the reusable dependency-free controller, stage codes, timeouts and packaging.

```sh
npm run test:boot
```

## Learn the boat

Your first patrol opens a paused captain’s briefing. Choose **Start guided practice** for a 15-lesson orientation covering the career goal, helm, periscope dive, essential resources, contact selection and viewing, torpedo salvos, escort evasion, surfacing and the deck gun, captain skills, boat refits, department-head doctrines, chart/autopilot, time compression, harbor service, and the patrol loop.

Practice uses the real controls and physics in an isolated, protected boat with steady daylight. Your original simulation is parked, so training does not spend its resources, reset its encounters, or earn it practice rewards. The instructor highlights the relevant controls, checks actual actions, and offers an **Advance maneuver** button for waiting periods. Feedback appears inside the coach rather than covering the instructions. Lessons can be paused and resumed; completed training does not reopen on every launch. **Help / H** contains the field manual and replay entry. A visible camera button is available on phones.

During normal play, **Captain’s intent** recommends a next action based on the current situation. Depth control shows the current depth and the crew’s ordered depth. Weapon captions explain missing contacts, range limits, reloads, and depth restrictions. These are aids for independent command rather than assigned combat missions.

## At the helm

Select a ship on the horizon or cycle contacts with Tab. Torpedoes calculate a lead solution, then run straight; they can miss an escort that changes course. Launch at surface or periscope depth. The deck gun requires surfacing and a contact within range. Escorts spot surfaced boats and use sonar against submerged boats. Change course, slow down, and dive to evade their attacks.

| Control | Action |
| --- | --- |
| W / S, or + / − | Engine throttle |
| A / D, or helm arrows | Rudder; cancels autopilot |
| Space / F | Torpedo / deck gun |
| Q / Tab | Sonar ping / next contact |
| G | Turn the camera toward the selected contact |
| R / V / X | Surface / 12 m / 80 m |
| C | Chase / periscope / tactical camera |
| Drag / wheel | Orbit camera / zoom |
| M / K | World chart / captain skills |
| T / P / Escape | Time acceleration / pause / close panel |
| H / ? | Field manual and guided orientation |

The chart accepts arbitrary ocean waypoints and named service anchorages. Autopilot uses A* routes around the authored coastlines. Time compression progresses through 1×, 5×, 20×, 100×, 1000×, and the configured maximum (5000× by default). Contacts interrupt acceleration automatically. Strategic movement is bounded so faster custom boats cannot skip past an encounter. Diesel powers surfaced travel, batteries power submerged travel, and oxygen limits extended dives. Critical battery and oxygen warnings stop compression; surfacing restores both. Harbors replenish diesel, weapons, and hull integrity.

Merchants choose held zigzags, hard turns, or breakaways after a threat, and may comb a torpedo wake only after spotting it. Escorts react to uncertain visual/acoustic reports, share them after a delay, and divide attacker, listening-assistant, and convoy-guard duties. Losing a signature starts a widening search around the last report; a committed depth-charge run continues across its estimated solution while close sonar is unavailable. Deck-gun rounds calculate lead and can miss a ship that turns after firing. Hull damage from collisions requires actual Rapier hull contact. Periscope optics require a depth of 18 m or less; underwater fog and reflection behavior follow the camera’s actual position.

Sunk ships pay bounty and captain XP. Captain skills form three prerequisite branches. Five boat refits are installed by the onboard workshop. All 44 hands earn crew XP underway and in combat; crew ranks improve speed, reloads, and repairs. Three department heads each offer two interchangeable doctrines, with measurable advantages in engineering, weapons, and navigation.

## Tune and playtest

The gear button opens live settings. **Mobile**, **Balanced**, and **Ultra** presets set resolution, ocean tessellation, reflection resolution, view distance, and particle budgets. Mobile is the starting profile for S25-class hardware; Balanced is the starting profile for RTX 3060 Ti-class desktops. These are tuning presets, not measured frame-rate guarantees. A live FPS and rendering-backend display helps tune your device.

Seven tabs expose the rendering, ocean, buoyancy, camera, weather, movement, diving, resources, weapons, enemy behavior, traffic, XP, rewards, and costs. The **Developer tools** section can grant bounty and XP, restore and rearm the boat, spawn a nearby convoy, and clear local traffic. Export/import settings as JSON to keep and compare balance experiments.

Career progress autosaves locally every ten seconds and when panels close. Export/import a portable career from the captain’s log; it includes tuning settings. File-based browser storage behavior can vary, so an exported career is the portable backup. Salvage after a hull loss keeps progression and charges 25% of current bounty.

## Enemy AI lab

The tactical lab uses Mobile water detail while retaining the seeded ocean and Rapier physics. Its AI, weapon, and shipping settings remain the selected tuning. This keeps an Ultra graphics preset from slowing the lab's fast-forward; returning to patrol restores the parked simulation and its full water detail.

Open **Settings → Open enemy AI lab**. Your career simulation is parked; the lab uses the same enemy AI and Rapier physics as a patrol, with damage protection and no ambient traffic. The tactical canvas runs without the 3D sea renderer, allowing quick simulation and tuning even when rendering is slow. Return to patrol restores the exact boat and encounter. **Apply tuning to my patrol** commits only the chosen enemy/weapon settings and shipping speeds/evasion.

Choose a scenario, player behavior, and seed, then **Rerun seed**. Five scenarios cover a convoy ambush, surface contact followed by a deep escape, a blind acoustic search, visible torpedo wakes, and a convoy beside the authored coastline. **Step 1 s**, **Advance 10 s**, and playback at 1×–100× use fixed 30 Hz simulation. Runs are limited to 20 simulated minutes. Space toggles playback when focus is outside a control; Escape returns to the patrol.

Select an enemy on the plot or in the table to see its crew, search doctrine, role, confidence, sensor state, last report/source/age, horizontal and depth uncertainty, intended waypoint, charge inventory, and decision reasons. The map includes trails, shoreline, torpedoes, and charges. The cyan submarine is optional developer ground truth; enemies do not receive that information. An uncertainty circle shows the last report's expanding search area, not a guaranteed statistical confidence interval.

**Live tuning** exposes sensor cadence, reaction time, observation error, sonar arc/blind zone/self-noise, radio delay, coordination, pursuit limits, charge patterns, search speed, merchant maneuvers, and weapon ranges. **Manual inputs and interventions** records helm orders, pings, shots, and damage. The timeline reconstructs the selected past time from the seed and recorded controls; continuing then creates a new branch. **Export replay & trace** saves the initial configuration/profile, timed interventions, one-second telemetry, decisions, and metrics. **Import replay** reproduces that run; **Export tuning** supplies a settings file for headless comparisons.

For repeatable batches without a browser:

```sh
npm run ai:simulate -- --seeds 8 --duration 240 --out artifacts/ai-lab/evasive
npm run ai:simulate -- --scenario escape --profile loud --seeds 8 --duration 240 --out artifacts/ai-lab/loud
npm run ai:simulate -- --scenario convoy --settings greywake-ai-tuning.json --seed 42 --seeds 8
npm run ai:simulate -- --replay greywake-ai-escape-42.json --out artifacts/ai-lab/replayed
npm run test:ai-lab
```

Profiles are `evasive`, `loud`, `quiet`, and `manual`; scenarios are `convoy`, `escape`, `blind`, `torpedo`, and `coast`, or `all`. Each batch writes `batch-report.json` and an importable trace for its first seed per scenario. Reports include first detection, sampled detection seconds, attack counts, merchant plans, roles/states, track error, minimum ship separation, potential damage, and CPU time. Detection duration and separation use one-second samples; damage is accumulated before lab protection. CPU time measures this workstation, not browser GPU performance. Current scripts/settings/seed/events are needed for identical replay after code changes.

The AI uses seeded crew variation, noisy reports, weather/daylight-dependent perception, and limited torpedo-wake visibility. Tactical decisions consume these reports rather than hidden submarine position/depth. Ships limit pursuit away from their convoy, avoid nearby hulls and coastlines, and withdraw if badly damaged. Depth hypotheses change across successive charge patterns without learning the submarine's actual depth. RNG, contact memory, radio queues, orders, and committed maneuvers persist in career saves.

Attacker/assistant roles, lost-contact searches, self-noise tradeoffs, and depth patterns are arcade interpretations informed by the [US Navy's 1944 anti-submarine instructions](https://www.ibiblio.org/hyperwar/USN/ref/ASW-Convoy/ASW-Convoy-1.html). The [1944 war instructions on zigzagging](https://www.ibiblio.org/hyperwar/USN/ref/WarInst/WarInst-7.html) informed varied maneuver choices. These sources postdate the game's 1942 setting; the implementation does not reproduce a specific navy's equipment, acoustic propagation, or exact historical doctrine.

## Rendering and world

- Three.js **0.186.1**, WebGPU-first `WebGPURenderer`, and TSL materials shared with the WebGL 2 backend.
- Rapier 3D **0.19.3** for dynamic submarine buoyancy, hull collisions, CCD torpedoes, and swept hit queries.
- Six long-wave components plus three seeded wind-driven FFT cascades. Spectrum frames interpolate at a selectable 8/12/20 Hz, with 32/64/128 samples per cascade for Mobile/Balanced/Ultra. CPU surface queries invert the horizontal displacement so buoyancy and the rendered surface share a field.
- Four nested ocean meshes concentrate detail within 384 m: 4 m vertex spacing on Mobile, 2.4 m on Balanced, and about 1.33 m on Ultra. Geometry filters waves below its sampling resolution; fragment normals retain fine ripples. Boundary vertices morph onto the next ring’s grid and share its displacement filtering; the rings use no skirts.
- A moving 384 m water field propagates local disturbances and transports persistent foam. Hull contact, propeller wash, turning wakes, torpedoes, and sinking ships contribute to it. Scrolling preserves its world coordinates; compressed water memory and hull motion travel with career saves.
- Fresnel reflection, filtered sun glitter, crest scattering, sky and boat reflections, textured whitecaps and wake foam, depth-aware refraction, underwater absorption, and an underwater surface window. Refraction can be disabled independently and starts disabled on Mobile.
- Hull heave, pitch, and roll use twelve weighted support points, relative wave-velocity damping, and a common immersion envelope. Positive pitch raises the bow; yaw precedes local pitch/roll on both the collider and model. Wave encounters drive bow spray and wetness; hull materials darken and become more reflective, then dry over time. Plumes and bubbles distinguish shells, torpedoes, and depth charges. Impact rings use the actual hit position and reach beyond the local water field.
- Procedural weathered U-boat and merchant/escort models; sky environment lighting, drifting clouds, a moving sun, smoke, tracers, fireballs, underwater haze, and synthesized sea/engine/combat audio.
- Telescoping periscope optics, a closer submerged chase camera, and visible service-anchor buoys. The solar clock follows latitude and longitude, with sunrise in the east and sunset in the west. Sky reflection updates reuse the existing environment target at a configurable interval.
- Deterministic shipping cells follow regional corridors. A floating physics origin preserves local precision during global travel. Fast voyages use strategic integration with coast, resource, arrival, and contact checks.

Geography and navigation use a simplified equirectangular world, with approximate coastlines and offshore anchorages. This is an arcade sandbox, not a historically exact naval simulator. Current saves preserve nearby shipping, ship damage, escort search memory, target locks, weapons in flight, cooldowns, visited cells, and buoyancy state alongside career progression. Legacy files without encounter data still load. Shipping cells and the wave field remain continuous across the international date line.

## Build and verify

```sh
npm run check
npm test
npm run build
npm run test:browser
npm run test:orientation
npm run test:ai-lab
```

The build emits `dist/greywake.html` and dependency licenses. It removes any old `dist/index.html` duplicate. The browser verifier serves that build on an ephemeral local port, tests actual WebGPU and forced WebGL rendering, exercises combat/progression/navigation/save controls, captures desktop and touch-layout screenshots, and runs the standalone file with HTTP traffic blocked. It uses Linux Xvfb and `/usr/bin/google-chrome`; set `CHROME_PATH` for a different Chrome installation. Reports and screenshots go to `artifacts/`. Xvfb is necessary because Linux headless Chromium does not present WebGPU canvases to its screenshot compositor. A lost WebGPU device triggers a saved-career recovery through WebGL.

`vercel.json` builds the standalone game and serves `/greywake.html` at `/`. To deploy, link the Vercel project with `vercel link`, then run `vercel deploy --prod`. The repository's root `index.html` remains the source template used by the build.

The AI lab verifier checks real controls, timeline reconstruction, replay import/export equality, fast-forward speed, mobile layouts, career isolation, and explicit tuning application. Unit tests additionally cover information limits, delayed radio, guard retention, seed variation, save state, quiet counterplay, and navigation.

The orientation verifier walks every lesson through actual controls, validates career preservation and replay/resume, and tests real touch input in portrait and landscape. Its screenshots and report are in `artifacts/orientation-audit/`.

The browser suites run sequentially on this workstation’s software SwiftShader adapter; screenshot capture drains queued frames. Physical S25 and RTX 3060 Ti performance must be measured on those devices. The game exposes quality and simulation controls so those measurements can inform your chosen settings.

## Water Lab

Open **F2 → Sea and inspection → Open Water Lab**, or **Settings → Ocean → Open Water Lab**. A desktop dock leaves the sea visible; portrait and landscape touch layouts use a collapsible bottom sheet. The toolbar keeps playback, exact frame/one-second/ten-second steps, camera bookmarks, look presets, and A/B actions available while controls scroll.

The lab parks your patrol and runs an isolated experiment. Autosave and career export continue to use the parked patrol. **Apply water tuning to patrol** copies an explicit water, lighting, and graphics allowlist; **Return to patrol** restores the original simulation, camera, pause, inputs, and launch/HUD state. The patrol fixture holds shipping and clears live ordnance while retaining boat poses and existing water memory. Seeded fixtures provide flat water, calm cruising, Atlantic swell, head/beam seas, a 90° turn, crossing wakes, diving/surfacing, a shallow camera crossing, and weapon impacts. Noon, low sun, and overcast lighting freeze the local solar view and cloud phase.

Controls cover Waves, Surface, Foam & wakes, Underwater, Boat response, Lighting, Quality, and Inspect. Search, changed-only, Advanced, numeric entry, color pickers, and field/section resets share the configuration schema with F2 and Settings. The advanced swell editor starts from the six original components. Wave height remains a **mixture coefficient**, with zero allowed; it is not significant wave height. Directions describe travel **toward**: 0° north (−Z), 90° east (+X).

Cheap changes preview while dragging. Spectrum and allocation changes commit on release; swell length/direction/enabling changes rerun the fixture. Sun/cloud commits explicitly refresh the existing environment target. The lab does not serialize a full career for each slider event. Calm, Atlantic, heavy-sea, clear-water, and overcast looks adjust colors, roughness, glitter, detail, and whitecaps; ordinary sea presets use the same art tuning.

**Pause** freezes simulation and effects. **Freeze wave phase** holds the base waves while local wakes and boats may continue, with zero base-wave velocity reported. Long advances yield and can be paused or reset. **Store A/B** and **View A/B** compare appearance at one held camera, phase, seed, and boat pose. Use **Reset scene** with the same fixture and inputs to compare hull or wake behavior.

Export/import uses `greywake.water-lab/1`: water tuning, quality, seed, lighting, scenario, initial boat/controller/ship conditions, optional quantized water memory, camera pose, duration, and scripted actions. Imports validate before changing the experiment; unsupported versions, invalid fields, and files over 4 MB are rejected. Recipes reconstruct an experiment; career/playtest formats remain compatible. Missing or corrupt optional career water memory defaults without discarding progression.

Inspect provides geometric height, final normals, displaced-surface compression/Jacobian, foam sources/coverage/age, local extent, reflection/refraction/depth, immersion, mesh wireframe, and pooled hull support markers. Diagnostics distinguish requested/effective chop, phase/physics clocks, solver substeps/Courant number, CPU preparation/query/interaction time, target sizes, memory, shader counts, and the actual backend/adapter.

The base phase integrates accepted time, so a speed edit changes its future rate without replacing the sea. Shared low-frequency mode identities survive quality changes. Wind/seed changes crossfade old and target CPU fields into the existing texture set. A conservative horizontal derivative bound limits effective chop; bounded inverse queries target 0.5 mm residual. Normals use displaced tangents, including off-diagonal derivatives. Crest compression is `1 − det(I + ∇D)`, positive at compressed crests.

Local disturbances use a 384 m field, stable substeps, diffusion in world units, and a 24 m time-based absorbing edge. Persistent foam and simulation-owned world-space wake histories share age and drift. Near/far foam uses complementary fades over 134.4–184.32 m from the local field center. Contact velocity drives wetness and bounded spray; droplets return to the sampled surface. Current affects local foam and water inspection, while routes, aiming, and AI navigation retain their existing behavior.

Local simulation runs at 1/30 s, with interpolated rendering and bounded work per callback. The requested compression can exceed the achieved rate under load; diagnostics report both. Strategic travel advances the accepted phase analytically, expires transient memory, and clears local wave impulses before resuming. The launch preview has its own clock and does not advance career water memory.

This is a controlled height-field/probe model using the existing player mass of 750 engine units, not calibrated hydrostatics or a full ballast/fluid-volume simulation. Fluid velocities are model approximations. Planar reflection represents the mean surface. Fine ripples affect shading rather than hull physics. Extreme gain combinations can create exaggerated seas; the effective chop/steepness safeguards keep queries bounded. Desktop/mobile FPS targets need measurements on those devices; Xvfb/SwiftShader verification does not establish hardware performance.

## Water verification

Settings → Ocean includes **Calm water**, **Atlantic swell**, and **Heavy seas** presets, plus wind speed/direction, foam lifetime, crest light, and underwater visibility. Graphics controls separately select spectrum and interaction resolution, reflections, and refraction.

```sh
npm run test:water
npm run test:water-browser
npm run test:water-driver
npm run test:water-lab
node scripts/audit-water-fields.mjs
xvfb-run -a node scripts/capture-water-review.mjs
npm run capture:water-native
```

The matched review script uses Chrome, Xvfb and `ffmpeg`, and writes a local gallery, raw frames, metadata and MP4 clips to `artifacts/water-review/`. It expects the preserved pre-upgrade HTML at `artifacts/water-planning/greywake-before.html`; in a fresh checkout, build commit `34bc3b7` separately and set `WATER_BEFORE` to that HTML. See [validation and measured limits](docs/water-validation.md) for the closure review.

Water tests cover Fourier reconstruction, wind variation, temporal continuity, wave-driven hull motion, wake scrolling and decay, compact persistence, date-line continuity, depth attenuation, distant impacts, and bounded wake volume. The water browser verifier captures calm, swell, heavy seas, turning wakes, weapon impacts, and underwater travel on both actual rendering backends. It also checks live quality/refraction controls, texture disposal and actual GPU buffer allocations after repeated quality changes, and water save data. Its captures retain Balanced water, reflections, refraction, and shadows at a practical resolution for software adapters. Scene captures advance simulation and effects at 30 Hz before submitting the final frame; their FPS labels are not a performance benchmark. Buffer checks intercept actual WebGPU/WebGL allocation and deletion because Three.js also counts attribute views that share an existing GPU buffer. The shader verifier generates both GLSL and WGSL with the installed Three.js builders. The driver verifier compiles and links GLSL with Linux surfaceless EGL/GLES using Python's standard library.

Native captures run the real `View.render` scene updates and draw the exported shaders, geometry, uniforms, and instances through GLES. Scenes cover calm water, swell, storms, turns, underwater travel, shell and torpedo impacts, and depth charges. Images and reports are under `artifacts/water-upgrade/`. This is a material and geometry verification path when browser launch is restricted: it uses an analytical environment atlas, disables planar reflection/refraction passes, and does not verify browser input, the compositor, or WebGPU execution. The normal browser verifiers remain necessary for those checks.

The rendering APIs follow the [Three.js WebGPURenderer documentation](https://threejs.org/docs/pages/WebGPURenderer.html); the physics integration follows the [Rapier rigid-body documentation](https://rapier.rs/docs/user_guides/javascript/rigid_bodies/). Three.js is MIT licensed; Rapier is Apache-2.0 licensed. Both notices are included in the standalone HTML.

## Rendering audit

The original render loop replaced `scene.fog` every frame. Three.js keys fog shader nodes by object identity, so this rebuilt materials, GPU pipelines, and attribute buffers continuously. In the captured comparison, the original created 23 shader builders and 10 pipelines per warm frame and grew approximately 2.15 MB of tracked GPU resources per frame. The water shader also appended distortion to its existing reflection UV graph on every build, making shader source grow continuously. Both defects are corrected: fog values mutate one persistent object, and reflection distortion always starts from an immutable UV node.

FPS now measures uncapped wall time. The former counter used the simulation's 0.1-second cap and could report 10 FPS even with multi-second frames. The settings panel can export rendering diagnostics with adapter identity, actual frame time, CPU submission time, resolution, draw counts, and tracked memory. Software adapters are identified explicitly.

Wake shading now rejects distant and inactive sources before expensive calculations. Sunlight shadows were absent despite model flags; they are now enabled in Balanced/Ultra and can be tuned or disabled. The rendering profiler (`npm run profile:renderer`) records real game render frames and shader/pipeline allocations. Set `AUDIT_BUILD`, `AUDIT_CASES`, and `AUDIT_REPORT` to compare a preserved build; captured before/after reports are in `artifacts/render-audit/`.

These fixes address rendering correctness and performance. The procedural models, low-resolution material textures, simplified water optics, and absence of a full cinematic post-processing pipeline still limit visual fidelity compared with a high-budget Unreal scene.
