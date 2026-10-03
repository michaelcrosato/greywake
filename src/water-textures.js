import * as THREE from 'three/webgpu';
import { random, TAU } from './world.js';

function valueNoise(x, y, seed = 0) {
  const hash = (a, b) => {
    let v = Math.imul(a + seed * 17, 374761393) + Math.imul(b, 668265263);
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return ((v ^ (v >>> 16)) >>> 0) / 4294967295;
  };
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy,
    sx = fx * fx * (3 - 2 * fx),
    sy = fy * fy * (3 - 2 * fy),
    period = Math.max(1, seed),
    h = (a, b) => hash(((a % period) + period) % period, ((b % period) + period) % period);
  return (
    (h(ix, iy) * (1 - sx) + h(ix + 1, iy) * sx) * (1 - sy) +
    (h(ix, iy + 1) * (1 - sx) + h(ix + 1, iy + 1) * sx) * sy
  );
}

export function foamTexture() {
  const n = 256,
    data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = x / n,
        v = y / n,
        noise =
          valueNoise(u * 8, v * 8, 8) * 0.5 +
          valueNoise(u * 24, v * 24, 24) * 0.3 +
          valueNoise(u * 64, v * 64, 64) * 0.2,
        cells = Math.abs(valueNoise(u * 48, v * 48, 48) - 0.5),
        bubbles = Math.max(0, 1 - cells * 7),
        density = Math.max(0, Math.min(1, (noise - 0.23) * 2.1)),
        i = (y * n + x) * 4;
      data[i] = Math.round(density * 255);
      data[i + 1] = Math.round(bubbles * 255);
      data[i + 2] = Math.round(noise * 255);
      data[i + 3] = Math.round(density * bubbles * 255);
    }
  }
  const map = new THREE.DataTexture(data, n, n);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  return map;
}

export function rippleTexture() {
  const n = 256,
    data = new Uint8Array(n * n * 4),
    rng = random(1942);
  const waves = Array.from({ length: 32 }, (_, i) => {
    const frequency = 3 + i * 1.4,
      angle = rng() * TAU;
    return {
      x: Math.round(Math.cos(angle) * frequency),
      z: Math.round(Math.sin(angle) * frequency),
      phase: rng() * TAU,
      amplitude: 0.13 / Math.sqrt(frequency),
    };
  });
  for (let z = 0; z < n; z++)
    for (let x = 0; x < n; x++) {
      let nx = 0,
        nz = 0;
      for (const w of waves) {
        const value = Math.cos(((x * w.x + z * w.z) / n) * TAU + w.phase) * w.amplitude,
          length = Math.hypot(w.x, w.z);
        nx += (value * w.x) / length;
        nz += (value * w.z) / length;
      }
      const i = (z * n + x) * 4;
      data[i] = Math.round(Math.max(0, Math.min(255, 128 + nx * 200)));
      data[i + 1] = Math.round(Math.max(0, Math.min(255, 128 + nz * 200)));
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
  const map = new THREE.DataTexture(data, n, n);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = 4;
  map.needsUpdate = true;
  return map;
}

export function dropletTexture(kind = 'spray') {
  const n = 64,
    data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const dx = ((x + 0.5) / n) * 2 - 1,
        dy = ((y + 0.5) / n) * 2 - 1,
        r = Math.hypot(dx, dy),
        i = (y * n + x) * 4;
      const alpha =
        kind === 'bubble'
          ? Math.exp(-(((r - 0.72) * 16) ** 2)) * 0.65 +
            Math.exp(-((dx + 0.25) ** 2 + (dy - 0.3) ** 2) * 50) * 0.7
          : Math.max(0, 1 - r * r) ** 2;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(Math.min(1, alpha) * 255);
    }
  const map = new THREE.DataTexture(data, n, n);
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearFilter;
  map.needsUpdate = true;
  return map;
}

export function floatTexture(resolution, repeat = true, mipmaps = false) {
  const map = new THREE.DataTexture(
    new Uint16Array(resolution * resolution * 4),
    resolution,
    resolution,
    THREE.RGBAFormat,
    THREE.HalfFloatType,
  );
  map.wrapS = map.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  map.generateMipmaps = mipmaps;
  map.needsUpdate = true;
  return map;
}

export function resizeFloatTexture(map, resolution) {
  // Keep node/sampler references stable while replacing the GPU allocation.
  // Cached material bindings can otherwise resurrect an old disposed texture.
  map.dispose();
  map.image = {
    data: new Uint16Array(resolution * resolution * 4),
    width: resolution,
    height: resolution,
  };
  map.needsUpdate = true;
}

export function uploadFloatTexture(map, data) {
  for (let i = 0; i < data.length; i++) map.image.data[i] = THREE.DataUtils.toHalfFloat(data[i]);
  map.needsUpdate = true;
}
