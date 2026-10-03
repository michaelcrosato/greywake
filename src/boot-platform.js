import { BootError } from './boot-loader.js';

export function checkPlatform(env, boot) {
  boot.update({
    platform: {
      userAgent: env.navigator.userAgent,
      platform: env.navigator.userAgentData?.platform || env.navigator.platform || 'Unknown',
      protocol: env.location.protocol,
      secureContext: env.isSecureContext,
      viewport: `${env.innerWidth} × ${env.innerHeight}`,
      pixelRatio: env.devicePixelRatio || 1,
      touchPoints: env.navigator.maxTouchPoints || 0,
    },
  });
  let canvas2D = false;
  try {
    canvas2D = !!env.document.createElement('canvas').getContext('2d');
  } catch (error) {
    boot.note('SYS-CANVAS', error);
  }
  const required = {
    promises: !!env.Promise,
    webAssembly: !!env.WebAssembly?.instantiate,
    typedArrays: !!env.Uint8Array,
    textDecoder: !!env.TextDecoder,
    animationFrames: !!env.requestAnimationFrame,
    canvas2D,
  };
  boot.update({ capabilities: { ...required, audio: !!(env.AudioContext || env.webkitAudioContext) } });
  const missing = Object.keys(required).filter((key) => !required[key]);
  if (missing.length)
    throw new BootError('SYS-MISSING', `Required capabilities unavailable: ${missing.join(', ')}.`);
  if (!boot.report.capabilities.audio) boot.note('SYS-AUDIO', 'Audio unavailable; play continues silently.');
  try {
    const key = '__game_boot_storage_probe__',
      previous = env.localStorage.getItem(key);
    env.localStorage.setItem(key, 'ok');
    if (previous === null) env.localStorage.removeItem(key);
    else env.localStorage.setItem(key, previous);
    boot.report.capabilities.storage = true;
  } catch (error) {
    boot.report.capabilities.storage = false;
    boot.note('SYS-STORAGE', new Error(`Local saves unavailable: ${error.message}`));
  }
  boot.emit();
}

export async function checkWasm(env) {
  // A real minimal module verifies execution, not just the presence of an API.
  await env.WebAssembly.instantiate(new env.Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
}

async function bounded(promise, ms, code, lateCleanup = () => {}) {
  let timer,
    expired = false;
  try {
    return await Promise.race([
      promise.then((value) => {
        if (expired) lateCleanup(value);
        return value;
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(new BootError(code, 'Graphics request timed out.'));
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function selectGraphics(
  env,
  boot,
  forceWebGL = false,
  requirements = { hdr: true, fragmentTextures: 16, vertexTextures: 4 },
) {
  const gpu = env.navigator.gpu;
  boot.report.capabilities.webGPU = !!gpu;
  if (gpu && !forceWebGL) {
    try {
      const adapter = await bounded(
        gpu.requestAdapter({ powerPreference: 'high-performance' }),
        5000,
        'GPU-ADAPTER-TIME',
      );
      if (!adapter) throw new BootError('GPU-NO-ADAPTER', 'WebGPU supplied no usable adapter.');
      const info = adapter.info || {};
      boot.update({
        adapter: {
          vendor: info.vendor || 'Not disclosed',
          architecture: info.architecture || 'Not disclosed',
          description: info.description || info.architecture || 'Not disclosed by browser',
          software: !!info.isFallbackAdapter,
        },
      });
      const device = await bounded(adapter.requestDevice(), 8000, 'GPU-DEVICE-TIME', (late) =>
        late.destroy(),
      );
      try {
        if (device.limits.maxSampledTexturesPerShaderStage < requirements.fragmentTextures)
          throw new BootError(
            'GPU-LIMIT',
            `WebGPU needs ${requirements.fragmentTextures} sampled textures per shader stage.`,
          );
        boot.update({
          renderer: 'WebGPU',
          adapter: {
            vendor: info.vendor || 'Not disclosed',
            architecture: info.architecture || 'Not disclosed',
            description: info.description || info.architecture || 'Not disclosed by browser',
            software: !!info.isFallbackAdapter,
          },
        });
        return;
      } finally {
        device.destroy();
      }
    } catch (error) {
      boot.assertActive();
      boot.note(error.code || 'GPU-FALLBACK', error);
    }
  } else if (!forceWebGL) {
    boot.note(
      'GPU-UNAVAILABLE',
      'WebGPU unavailable; checking WebGL 2. HTTPS or localhost may be required for WebGPU.',
    );
  }
  boot.assertActive();
  const canvas = env.document.createElement('canvas');
  let gl;
  try {
    gl = canvas.getContext('webgl2');
    if (!gl)
      throw new BootError(
        'GPU-NONE',
        'No usable WebGPU or WebGL 2 renderer. Enable hardware acceleration or use a supported browser/device. WebGL 1 cannot run this game.',
      );
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    boot.update({
      renderer: 'WebGL 2',
      adapter: {
        description: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'Not disclosed by browser',
      },
    });
    const hdr = !!(
      gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float')
    );
    boot.report.capabilities.webGL2 = true;
    boot.report.capabilities.hdrTargets = hdr;
    if (requirements.hdr && !hdr)
      throw new BootError('GPU-HDR', 'WebGL 2 cannot render the half-float targets required by this game.');
    if (
      gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) < requirements.fragmentTextures ||
      gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) < requirements.vertexTextures
    )
      throw new BootError('GPU-LIMIT', 'Insufficient texture units for this game.');
  } finally {
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
