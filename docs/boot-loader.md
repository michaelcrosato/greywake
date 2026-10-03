# Startup contract

`src/boot-loader.js` is the reusable, dependency-free controller. It has no DOM, game, physics, or rendering imports. `src/boot-platform.js` supplies browser capability probes; the renderer probe accepts game-specific HDR and texture-unit requirements. `src/boot.js` connects these to the standard screen and a game runtime exporting `startGame(boot)`. Branding, version and build identity come from HTML metadata.

The startup sequence is fixed. A stage can enter only after the previous stage passes; `complete()` refuses to run until every required stage passes.

| Code | Stage | Progress after passing | Deadline |
| --- | --- | --- | --- |
| SYS | Browser/platform capabilities | 8% | 5 s |
| WASM | Execute a minimal WebAssembly module | 16% | 8 s |
| GPU | Select a usable WebGPU or WebGL 2 backend | 28% | 20 s |
| LOAD | Load game code, styles and markup | 40% | 30 s |
| PHY | Initialize game physics | 52% | 30 s |
| WORLD | Construct simulation and scene | 62% | 30 s |
| RENDER | Initialize the actual renderer | 72% | 30 s |
| SKY | Initialize lighting and reflections | 82% | 30 s |
| SHDR | Compile shaders | 92% | 60 s |
| FRAME | Submit and validate the first frame | 98% | 60 s |
| UI | Construct controls and nonessential systems | 99% | 10 s |
| READY | Reveal the game and start its loop | 100% | — |

A future game supplies the operation for each stage through `boot.stage(code, operation)`. Operations that the game does not need can explicitly return without work. Its runtime returns a function that starts the game loop; the adapter calls that function only after `boot.complete()` succeeds. A different rendering engine can provide its own GPU/RENDER/SHDR/FRAME operations while preserving these codes and report fields. Use `boot.note(code, error)` for recoverable issues and `boot.fail(code, error)` for fatal ones.

## Failure behavior

Fatal failures retain the first failure code, message, stack, stage, progress, earlier stages, version, build ID, platform and graphics information. Further distinct errors are recorded without replacing that first cause (up to 50 entries); lengthy messages stay in the report while the on-screen summary stays short. The screen remains visible, the game stays hidden and later initialization stages cannot enter. `CODE-TIME` identifies an asynchronous operation exceeding its deadline; `CODE-FAIL` identifies a failed stage. Specific capability codes such as `SYS-MISSING`, `GPU-NONE`, `GPU-HDR` and `GPU-LIMIT` identify the missing requirement. WebGPU errors that permit WebGL fallback remain nonfatal report entries. Audio and local storage are optional, so their absence is reported without blocking play.

The ES5 `boot-sentinel.js` runs first and retains a basic report when the modern loader cannot parse, load or start. A static `noscript` message covers JavaScript being disabled. Players can retry, try WebGL 2, copy a report or download JSON. Copy falls back to selecting the text if clipboard access is unavailable. Diagnostic data records startup capabilities and exception text; it does not read careers, storage contents or credentials. Shader errors from Three.js's public console hook and GPU validation are included even when the rendering library resolves its compilation promise after an error.

Timeouts stop the boot sequence; late resolution cannot resume it. Timers require a responsive JavaScript event loop: they cannot preempt a synchronous infinite loop or a browser/driver process that has crashed. The last painted stage still identifies where work stopped. A late graphics-probe device is destroyed rather than retained.

## Packaging and troubleshooting

The development page loads the game module and stylesheet after capability checks. The offline build carries the game as inert base64 text and the styles/markup in inert templates: the payload is decoded and executed only after checks pass. This preserves the single-file, network-free game while keeping the initial executable boot code small. The base64 payload makes the uncompressed HTML larger; gzip mitigates that on the hosted site.

Build IDs are a deterministic SHA-256 fingerprint of the HTML, styles, game bundle, boot bundle, sentinel and package version. No build timestamp or local path enters the ID. Reports use the versioned `game-boot/1` schema. `window.gameBoot.snapshot()` returns a detached copy, and Settings → Startup diagnostics reopens the screen after a successful start. Opening it pauses a live patrol and closing it restores the prior pause state. Rendering diagnostic exports also include the startup report.

Run `npm run test:boot` for actual browser success, isolation, fallback, failed-capability, stalled-initialization, corrupted-payload, physics, renderer, shader, first-frame, offline and JavaScript-disabled checks. `npm test` includes contract tests for ordering, completion gating, timeout finality and error preservation. Reports/screenshots are written to `artifacts/boot/`.

For the development path, run `npm run dev -- --port 4185`, then `npm run test:boot:dev` in another terminal. `npm run test:boot:browsers` adds Firefox and WebKit checks and requires their Playwright browser/runtime dependencies. `WEBKIT_EXECUTABLE_PATH` can select a configured WebKit installation; its runtime environment is inherited.
