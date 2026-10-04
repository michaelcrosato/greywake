# Water implementation status

Implementation and local acceptance verification are complete against all six phases of the [original plan](water-implementation-plan.md). The [validation report](water-validation.md) records the requirement audit, fixes, command results, visual comparisons and measured limits; [structured results](water-validation.json) preserve the numerical evidence.

| Phase | Delivered |
| --- | --- |
| 1 · Water Lab | Dock/touch sheet, parked-career isolation, 143 water controls, seeded scenes, cameras, exact steps, A/B, recipes and allowlisted apply. |
| 2 · Shared water contract | Accepted phase/physics clocks, continuous speed edits, bounded spectrum transitions, shared mode identities, non-folding effective chop and residual-based CPU/TSL queries. |
| 3 · Appearance | Displaced normals, separate ripple/optics controls, reflection/refraction and absorption, continuous immersion, ring morphing and tuned sea looks. |
| 4 · Foam and wakes | Persistent transported crest/local foam, stable world-unit interaction solver, bounded world-space turning wakes, contact spray/wetness and depth-scaled impacts. |
| 5 · Hull response | Twelve weighted probes, bounded heave and relative damping, yaw-first pitch/roll transforms, common immersion policy and pooled inspection markers. |
| 6 · Closure | Preset/replay/lifecycle repairs, old-save compatibility, offline build, complete regression runs, matched visual review, six performance cases and documentation. |

Verification includes **83 passing unit tests**, both actual WebGPU and WebGL 2 backends, GPU/CPU height and mesh comparisons within 3.5 cm, eight shader-generation cases and four GLES driver links. Water uses 15 fragment samplers with shadows, under the limit of 16. The developer, game, boot, Vite boot, orientation and AI-lab checks pass.

The current standalone build is **48962e944c89**. Final visual evidence contains 56 matched stills and six motion clips, with explicit renderer frame advancement so reflections and shadows remain fresh. The local gallery is `artifacts/water-review/index.html`; representative lossless images are checked into `docs/water-review/`.

All six software-adapter performance cases have stable warm allocation counts. SwiftShader frame intervals are slow and are reported as measured; physical phone/desktop FPS remains unmeasured. Height-field optics, approximate fluid velocity, controlled probe motion and bounded distant foam remain deliberate model limits. Full volumetric fluids, breakers, bathymetry, ballast dynamics and a GPU FFT remain the extensions deferred by the original plan.

The original research and handoff documents are preserved as historical context. Dependencies remain pinned, legacy careers and playtest profiles remain readable, and the HTML remains usable offline.
