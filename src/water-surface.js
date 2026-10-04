import {
  cascadeWindow,
  DISPLACEMENT_CONTRACTION,
  INVERSE_ITERATIONS,
  INVERSE_TOLERANCE,
  immersionEnvelope,
  modeRandom,
  swellComponents,
} from './water-math.js';
import { clamp, deltaX, TAU } from './world.js';

const GRAVITY = 9.81;
const CASCADES = [512, 128, 32];

// The same seeded spectrum is sampled by buoyancy and uploaded to the water shader.
// Keeping it on the CPU avoids GPU readbacks and also supports the WebGL backend.
export class SpectralCascade {
  constructor(size, resolution = 64, wind = 9, direction = 315, seed = 1942, shape = {}) {
    this.size = size;
    this.resolution = resolution;
    const count = resolution * resolution;
    this.initial = new Float64Array(count * 2);
    this.frequency = new Float64Array(count);
    this.kx = new Float64Array(count);
    this.kz = new Float64Array(count);
    this.work = new Float64Array(count * 2);
    this.spectrum = new Float64Array(count * 2);
    this.height = new Float32Array(count);
    this.foam = new Float32Array(count);
    this.nextFoam = new Float32Array(count);
    this.displacement = new Float32Array(count * 4);
    this.normals = new Float32Array(count * 4);
    this.previousDisplacement = new Float32Array(count * 4);
    this.nextDisplacement = new Float32Array(count * 4);
    this.previousNormals = new Float32Array(count * 4);
    this.nextNormals = new Float32Array(count * 4);
    this.reversal = new Uint16Array(resolution);
    const heading = (direction * Math.PI) / 180,
      wx = Math.sin(heading),
      wz = -Math.cos(heading),
      largestWave = Math.max(3, (wind * wind) / GRAVITY);
    const coefficient = (x, z) => {
      const kx = (x * TAU) / size,
        kz = (z * TAU) / size,
        k = Math.hypot(kx, kz);
      if (k < 1e-6 || wind === 0) return [0, 0];
      const alignment = (kx * wx + kz * wz) / k;
      const power =
        (Math.exp(-1 / (k * largestWave) ** 2) *
          Math.exp(-((k * (shape.shortSuppression ?? 0.65) * 0.35) ** 2)) *
          ((shape.directionalSpread ?? 0.06) + alignment ** 4) *
          (alignment > 0 ? 1 : 0.18) *
          cascadeWindow(size, k)) /
        k ** 4;
      const rng = modeRandom(seed, size, x, z),
        radius = Math.sqrt(-2 * Math.log(Math.max(1e-8, rng()))),
        angle = TAU * rng(),
        amplitude = Math.sqrt(power * 0.5);
      return [radius * Math.cos(angle) * amplitude, radius * Math.sin(angle) * amplitude];
    };
    // Normalize once against a fixed maximum mode domain. Shared coefficients/count
    // therefore survive a quality change exactly, while omitted small modes stay omitted.
    let energy = 0;
    for (let z = -63; z <= 64; z++)
      for (let x = -63; x <= 64; x++) {
        const [real, imaginary] = coefficient(x, z);
        energy += real * real + imaginary * imaginary;
      }
    const scale = count / Math.sqrt(Math.max(1e-8, energy * 2));
    for (let z = 0; z < resolution; z++)
      for (let x = 0; x < resolution; x++) {
        const i = z * resolution + x,
          nx = x <= resolution / 2 ? x : x - resolution,
          nz = z <= resolution / 2 ? z : z - resolution;
        this.kx[i] = (nx * TAU) / size;
        this.kz[i] = (nz * TAU) / size;
        this.frequency[i] = Math.sqrt(GRAVITY * Math.hypot(this.kx[i], this.kz[i]));
        const [real, imaginary] = coefficient(nx, nz);
        this.initial[i * 2] = real * scale;
        this.initial[i * 2 + 1] = imaginary * scale;
      }
    const bits = Math.log2(resolution);
    for (let i = 0; i < resolution; i++) {
      let reversed = 0;
      for (let b = 0; b < bits; b++) reversed = (reversed << 1) | ((i >> b) & 1);
      this.reversal[i] = reversed;
    }
    this.twiddles = [];
    for (let length = 2; length <= resolution; length *= 2) {
      const values = new Float64Array(length);
      for (let j = 0; j < length / 2; j++) {
        values[j * 2] = Math.cos((TAU * j) / length);
        values[j * 2 + 1] = Math.sin((TAU * j) / length);
      }
      this.twiddles.push(values);
    }
  }

  inverse() {
    const n = this.resolution,
      a = this.work;
    for (let axis = 0; axis < 2; axis++) {
      const stride = axis === 0 ? 2 : n * 2;
      for (let line = 0; line < n; line++) {
        const base = axis === 0 ? line * n * 2 : line * 2;
        for (let i = 0; i < n; i++) {
          const j = this.reversal[i];
          if (j <= i) continue;
          const left = base + i * stride,
            right = base + j * stride,
            real = a[left],
            imaginary = a[left + 1];
          a[left] = a[right];
          a[left + 1] = a[right + 1];
          a[right] = real;
          a[right + 1] = imaginary;
        }
        for (let length = 2, stage = 0; length <= n; length *= 2, stage++) {
          const twiddle = this.twiddles[stage],
            half = length / 2;
          for (let block = 0; block < n; block += length) {
            for (let j = 0; j < half; j++) {
              const left = base + (block + j) * stride,
                right = base + (block + j + half) * stride,
                wr = twiddle[j * 2],
                wi = twiddle[j * 2 + 1],
                real = wr * a[right] - wi * a[right + 1],
                imaginary = wr * a[right + 1] + wi * a[right],
                lr = a[left],
                li = a[left + 1];
              a[left] = lr + real;
              a[left + 1] = li + imaginary;
              a[right] = lr - real;
              a[right + 1] = li - imaginary;
            }
          }
        }
      }
    }
    const scale = 1 / (n * n);
    for (let i = 0; i < a.length; i++) a[i] *= scale;
  }

  evaluate(time, chop = 0.65) {
    const n = this.resolution,
      count = n * n,
      h0 = this.initial,
      spectrum = this.spectrum;
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const i = z * n + x,
          opposite = ((n - z) % n) * n + ((n - x) % n),
          phase = this.frequency[i] * time,
          c = Math.cos(phase),
          s = -Math.sin(phase),
          ar = h0[i * 2],
          ai = h0[i * 2 + 1],
          br = h0[opposite * 2],
          bi = -h0[opposite * 2 + 1];
        spectrum[i * 2] = (ar + br) * c + (bi - ai) * s;
        spectrum[i * 2 + 1] = (ar - br) * s + (ai + bi) * c;
      }
    }
    this.work.set(spectrum);
    this.inverse();
    for (let i = 0; i < count; i++) {
      this.height[i] = this.work[i * 2];
      this.displacement[i * 4 + 1] = this.height[i];
    }
    for (const [component, directions] of [
      [0, this.kx],
      [2, this.kz],
    ]) {
      for (let i = 0; i < count; i++) {
        const k = Math.hypot(this.kx[i], this.kz[i]),
          ratio = k > 0 ? (directions[i] / k) * chop : 0;
        this.work[i * 2] = -spectrum[i * 2 + 1] * ratio;
        this.work[i * 2 + 1] = spectrum[i * 2] * ratio;
      }
      this.inverse();
      for (let i = 0; i < count; i++) this.displacement[i * 4 + component] = this.work[i * 2];
    }
    const spacing = this.size / n;
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const i = z * n + x,
          left = z * n + ((x + n - 1) % n),
          right = z * n + ((x + 1) % n),
          back = ((z + n - 1) % n) * n + x,
          front = ((z + 1) % n) * n + x,
          dx = (this.height[right] - this.height[left]) / (2 * spacing),
          dz = (this.height[front] - this.height[back]) / (2 * spacing),
          compression =
            -(
              this.displacement[right * 4] -
              this.displacement[left * 4] +
              this.displacement[front * 4 + 2] -
              this.displacement[back * 4 + 2]
            ) /
            (2 * spacing);
        this.normals[i * 4] = dx;
        this.normals[i * 4 + 1] = dz;
        this.normals[i * 4 + 2] = compression;
        this.normals[i * 4 + 3] = this.height[i];
        this.displacement[i * 4 + 3] = this.foam[i];
      }
    }
  }

  derivativeBound() {
    const n = this.resolution,
      d = this.displacement,
      spacing = this.size / n;
    let xx = 0,
      xz = 0,
      zx = 0,
      zz = 0;
    for (let z = 0; z < n; z++)
      for (let x = 0; x < n; x++) {
        const i = (z * n + x) * 4,
          right = (z * n + ((x + 1) % n)) * 4,
          front = (((z + 1) % n) * n + x) * 4;
        xx = Math.max(xx, Math.abs(d[right] - d[i]) / spacing);
        xz = Math.max(xz, Math.abs(d[front] - d[i]) / spacing);
        zx = Math.max(zx, Math.abs(d[right + 2] - d[i + 2]) / spacing);
        zz = Math.max(zz, Math.abs(d[front + 2] - d[i + 2]) / spacing);
      }
    return Math.max(xx + xz, zx + zz);
  }

  gradient(array, x, z, component, out) {
    const n = this.resolution,
      u = ((((x / this.size) % 1) + 1) % 1) * n,
      v = ((((z / this.size) % 1) + 1) % 1) * n;
    const ix = Math.floor(u),
      iz = Math.floor(v),
      fx = u - ix,
      fz = v - iz;
    const a = array[(iz * n + ix) * 4 + component],
      b = array[(iz * n + ((ix + 1) % n)) * 4 + component],
      c = array[(((iz + 1) % n) * n + ix) * 4 + component],
      d = array[(((iz + 1) % n) * n + ((ix + 1) % n)) * 4 + component];
    out[0] = (((b - a) * (1 - fz) + (d - c) * fz) * n) / this.size;
    out[1] = (((c - a) * (1 - fx) + (d - b) * fx) * n) / this.size;
    return out;
  }

  sample(array, x, z, component = 1) {
    const n = this.resolution,
      u = ((((x / this.size) % 1) + 1) % 1) * n,
      v = ((((z / this.size) % 1) + 1) % 1) * n,
      ix = Math.floor(u),
      iz = Math.floor(v),
      fx = u - ix,
      fz = v - iz,
      a = array[(iz * n + ix) * 4 + component],
      b = array[(iz * n + ((ix + 1) % n)) * 4 + component],
      c = array[(((iz + 1) % n) * n + ix) * 4 + component],
      d = array[(((iz + 1) % n) * n + ((ix + 1) % n)) * 4 + component];
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
  }
}

export class WaterInteractions {
  constructor(resolution = 256, size = 384) {
    this.resolution = resolution;
    this.size = size;
    this.spacing = size / resolution;
    this.x = 0;
    this.z = 0;
    this.centered = false;
    this.height = new Float32Array(resolution * resolution);
    this.velocity = new Float32Array(resolution * resolution);
    this.foam = new Float32Array(resolution * resolution);
    this.foamAge = new Float32Array(resolution * resolution);
    this.nextFoamAge = new Float32Array(resolution * resolution);
    this.ageData = new Float32Array(resolution * resolution * 4);
    this.nextHeight = new Float32Array(resolution * resolution);
    this.nextVelocity = new Float32Array(resolution * resolution);
    this.nextFoam = new Float32Array(resolution * resolution);
    this.data = new Float32Array(resolution * resolution * 4);
    this.previousData = new Float32Array(this.data.length);
    this.renderData = new Float32Array(this.data.length);
    this.version = 0;
    this.active = false;
  }

  recenter(x, z) {
    const step = this.spacing,
      nx = Math.round(x / step) * step,
      nz = Math.round(z / step) * step,
      ox = this.centered ? Math.round((nx - this.x) / step) : this.resolution,
      oz = this.centered ? Math.round((nz - this.z) / step) : this.resolution;
    if (!ox && !oz) return;
    const n = this.resolution;
    for (const [source, scratch] of [
      [this.height, this.nextHeight],
      [this.velocity, this.nextVelocity],
      [this.foam, this.nextFoam],
      [this.foamAge, this.nextFoamAge],
    ]) {
      scratch.fill(0);
      if (Math.abs(ox) < n && Math.abs(oz) < n) {
        const start = Math.max(0, -ox),
          end = Math.min(n, n - ox);
        for (let row = Math.max(0, -oz); row < Math.min(n, n - oz); row++) {
          scratch.set(
            source.subarray((row + oz) * n + start + ox, (row + oz) * n + end + ox),
            row * n + start,
          );
        }
      }
      source.set(scratch);
    }
    this.x = nx;
    this.z = nz;
    this.centered = true;
    this.pack();
  }

  stamp(x, z, radius, impulse = 0, foam = 0, stretch = 1, heading = 0) {
    const n = this.resolution,
      cx = (x - this.x) / this.spacing + n / 2,
      cz = (z - this.z) / this.spacing + n / 2,
      r = Math.max(0.8, radius / this.spacing),
      bound = Math.ceil(r * Math.max(1, stretch) * 2),
      sin = Math.sin(heading),
      cos = Math.cos(heading);
    if (cx < -bound || cz < -bound || cx > n + bound || cz > n + bound) return;
    for (let row = Math.max(1, Math.floor(cz - bound)); row < Math.min(n - 1, cz + bound); row++) {
      for (let col = Math.max(1, Math.floor(cx - bound)); col < Math.min(n - 1, cx + bound); col++) {
        const dx = col - cx,
          dz = row - cz,
          along = (dx * sin - dz * cos) / stretch,
          across = dx * cos + dz * sin,
          falloff = Math.exp(-(along * along + across * across) / (r * r)),
          i = row * n + col;
        this.velocity[i] = clamp(this.velocity[i] + impulse * falloff, -12, 12);
        const added = Math.max(0, foam * falloff);
        this.foamAge[i] *= this.foam[i] / Math.max(1e-8, this.foam[i] + added);
        this.foam[i] = Math.min(1.5, this.foam[i] + added);
        if (Math.abs(this.velocity[i]) > 1e-6 || this.foam[i] > 1e-6) this.active = true;
      }
    }
  }

  disturb(x, z, radius, impulse = 0, foam = 0, stretch = 1, heading = 0) {
    const effectiveRadius = Math.max(radius, this.spacing * 0.8);
    this.stamp(x, z, effectiveRadius, impulse, foam, stretch, heading);
    // A compensating outer depression keeps repeated wakes from adding water volume.
    if (impulse) this.stamp(x, z, effectiveRadius * 2, -impulse * 0.25, 0, stretch, heading);
  }

  step(dt, lifetime = 45, windX = 0, windZ = 0, settings = {}) {
    const speed = settings.propagation ?? 8,
      diffusion = settings.diffusion ?? 0.12;
    const maxDt = Math.min(
      (0.5 * this.spacing) / speed,
      diffusion > 0 ? (0.2 * this.spacing ** 2) / diffusion : Infinity,
      (this.spacing * 0.7) / Math.max(0.001, Math.abs(windX) + Math.abs(windZ)),
    );
    const substeps = Math.max(1, Math.ceil(dt / maxDt));
    this.substeps = substeps;
    this.courant = (speed * dt) / substeps / this.spacing;
    for (let i = 0; i < substeps; i++) this.integrate(dt / substeps, lifetime, windX, windZ, settings);
  }

  integrate(dt, lifetime = 45, windX = 0, windZ = 0, settings = {}) {
    if (!this.active) return;
    const n = this.resolution,
      damping = Math.exp(-dt * (settings.damping ?? 1.2)),
      decay = Math.exp(-dt / Math.max(1, lifetime)),
      coefficient = (settings.propagation ?? 8) ** 2 / (this.spacing * this.spacing),
      driftX = clamp((windX * dt) / this.spacing, -0.7, 0.7),
      driftZ = clamp((windZ * dt) / this.spacing, -0.7, 0.7);
    this.nextHeight.fill(0);
    this.nextVelocity.fill(0);
    this.nextFoam.fill(0);
    this.nextFoamAge.fill(0);
    let active = false;
    for (let z = 1; z < n - 1; z++) {
      for (let x = 1; x < n - 1; x++) {
        const i = z * n + x,
          h = this.height[i],
          laplacian =
            this.height[i - 1] + this.height[i + 1] + this.height[i - n] + this.height[i + n] - h * 4,
          velocity = (this.velocity[i] + coefficient * laplacian * dt) * damping,
          f = this.foam[i],
          diffusion =
            ((this.foam[i - 1] + this.foam[i + 1] + this.foam[i - n] + this.foam[i + n] - f * 4) *
              dt *
              (settings.diffusion ?? 0.12)) /
            this.spacing ** 2,
          advection =
            Math.abs(driftX) * (this.foam[i + (driftX > 0 ? -1 : 1)] - f) +
            Math.abs(driftZ) * (this.foam[i + (driftZ > 0 ? -n : n)] - f),
          edge = Math.exp(
            -dt * 6 * (1 - Math.min(1, (Math.min(x, z, n - x - 1, n - z - 1) * this.spacing) / 24)) ** 2,
          );
        this.nextVelocity[i] = velocity * edge;
        this.nextHeight[i] = clamp(h + velocity * dt, -2, 2) * edge;
        this.nextFoam[i] = Math.max(0, (f + diffusion + advection) * decay) * edge;
        const moment = f * this.foamAge[i],
          left = this.foam[i - 1] * this.foamAge[i - 1],
          right = this.foam[i + 1] * this.foamAge[i + 1],
          back = this.foam[i - n] * this.foamAge[i - n],
          front = this.foam[i + n] * this.foamAge[i + n];
        const aged =
          moment +
          ((left + right + back + front - 4 * moment) * dt * (settings.diffusion ?? 0.12)) /
            this.spacing ** 2 +
          Math.abs(driftX) * ((driftX > 0 ? left : right) - moment) +
          Math.abs(driftZ) * ((driftZ > 0 ? back : front) - moment);
        this.nextFoamAge[i] =
          this.nextFoam[i] > 1e-8
            ? Math.min(255, Math.max(0, aged / Math.max(1e-8, f + diffusion + advection)) + dt)
            : 0;
        if (
          Math.abs(this.nextHeight[i]) > 1e-6 ||
          Math.abs(this.nextVelocity[i]) > 1e-6 ||
          this.nextFoam[i] > 1e-6
        )
          active = true;
      }
    }
    [this.height, this.nextHeight] = [this.nextHeight, this.height];
    [this.velocity, this.nextVelocity] = [this.nextVelocity, this.velocity];
    [this.foam, this.nextFoam] = [this.nextFoam, this.foam];
    [this.foamAge, this.nextFoamAge] = [this.nextFoamAge, this.foamAge];
    this.active = active;
    this.pack();
  }

  pack() {
    const n = this.resolution,
      scale = 0.5 / this.spacing;
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const i = z * n + x;
        this.data[i * 4] = this.height[i];
        this.data[i * 4 + 1] =
          (this.height[z * n + Math.min(n - 1, x + 1)] - this.height[z * n + Math.max(0, x - 1)]) * scale;
        this.data[i * 4 + 2] =
          (this.height[Math.min(n - 1, z + 1) * n + x] - this.height[Math.max(0, z - 1) * n + x]) * scale;
        this.data[i * 4 + 3] = this.foam[i];
        this.ageData[i * 4] = this.foamAge[i];
        this.ageData[i * 4 + 1] = this.foam[i];
      }
    }
    this.version++;
  }

  samplePacked(array, x, z, component = 0) {
    const n = this.resolution,
      u = (x - this.x) / this.spacing + n / 2,
      v = (z - this.z) / this.spacing + n / 2;
    if (u < 0 || v < 0 || u >= n - 1 || v >= n - 1) return 0;
    const ix = Math.floor(u),
      iz = Math.floor(v),
      a = (iz * n + ix) * 4,
      fx = u - ix,
      fz = v - iz;
    return (
      (array[a + component] * (1 - fx) + array[a + 4 + component] * fx) * (1 - fz) +
      (array[a + n * 4 + component] * (1 - fx) + array[a + n * 4 + 4 + component] * fx) * fz
    );
  }

  render(alpha = 1) {
    if (alpha >= 1) return this.data;
    for (let i = 0; i < this.data.length; i++)
      this.renderData[i] = this.previousData[i] * (1 - alpha) + this.data[i] * alpha;
    return this.renderData;
  }

  sample(x, z, foam = false) {
    const n = this.resolution,
      u = (x - this.x) / this.spacing + n / 2,
      v = (z - this.z) / this.spacing + n / 2;
    if (u < 0 || v < 0 || u >= n - 1 || v >= n - 1) return 0;
    const ix = Math.floor(u),
      iz = Math.floor(v),
      fx = u - ix,
      fz = v - iz,
      array =
        foam === 'velocity' ? this.velocity : foam === 'age' ? this.foamAge : foam ? this.foam : this.height,
      i = iz * n + ix;
    return (
      (array[i] * (1 - fx) + array[i + 1] * fx) * (1 - fz) +
      (array[i + n] * (1 - fx) + array[i + n + 1] * fx) * fz
    );
  }

  snapshot() {
    // Quantized binary keeps persistent water well below localStorage's usual quota.
    const count = this.height.length,
      bytes = new Uint8Array(count * 5),
      view = new DataView(bytes.buffer);
    for (let i = 0; i < count; i++) {
      view.setInt16(i * 5, Math.round(clamp(this.height[i], -2, 2) * 16000), true);
      view.setInt16(i * 5 + 2, Math.round(clamp(this.velocity[i], -12, 12) * 2600), true);
      bytes[i * 5 + 4] = Math.round(clamp(this.foam[i], 0, 1.5) * 170);
    }
    const ages = Uint8Array.from(this.foamAge, (age) => Math.round(clamp(age, 0, 255)));
    let ageBinary = '';
    for (let i = 0; i < ages.length; i += 8192)
      ageBinary += String.fromCharCode(...ages.subarray(i, i + 8192));
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return {
      version: 1,
      resolution: this.resolution,
      size: this.size,
      x: this.x,
      z: this.z,
      data: btoa(binary),
      ages: btoa(ageBinary),
    };
  }

  restore(raw) {
    if (
      raw?.version !== 1 ||
      raw.resolution !== this.resolution ||
      raw.size !== this.size ||
      !Number.isFinite(raw.x) ||
      !Number.isFinite(raw.z) ||
      Math.abs(raw.x) > 1e12 ||
      Math.abs(raw.z) > 78 * 111000 ||
      typeof raw.data !== 'string' ||
      raw.data.length > this.height.length * 7
    )
      return false;
    try {
      const binary = atob(raw.data);
      if (binary.length !== this.height.length * 5) return false;
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0)),
        view = new DataView(bytes.buffer);
      for (let i = 0; i < this.height.length; i++) {
        this.height[i] = view.getInt16(i * 5, true) / 16000;
        this.velocity[i] = view.getInt16(i * 5 + 2, true) / 2600;
        this.foam[i] = bytes[i * 5 + 4] / 170;
      }
      if (typeof raw.ages === 'string' && raw.ages.length <= this.foamAge.length * 2) {
        try {
          const ages = atob(raw.ages);
          if (ages.length === this.foamAge.length)
            for (let i = 0; i < ages.length; i++) this.foamAge[i] = ages.charCodeAt(i);
        } catch {
          /* Legacy / corrupt optional age memory defaults to fresh foam. */
        }
      }
      this.x = raw.x;
      this.z = raw.z;
      this.centered = true;
      this.active =
        this.height.some((v) => Math.abs(v) > 1e-6) ||
        this.velocity.some((v) => Math.abs(v) > 1e-6) ||
        this.foam.some((v) => v > 1e-6);
      this.pack();
      return true;
    } catch {
      return false;
    }
  }
}

export class OceanSurface {
  constructor(config) {
    this.config = config;
    this.key = '';
    this.phase = 0;
    this.clockTime = 0;
    this.freezePhase = false;
    this.queryGradient = [0, 0];
    this.swell = swellComponents(config);
    this.timings = { fftMs: 0, queryMs: 0, interactionMs: 0 };
    this.tick = -1;
    this.version = 0;
    this.interactions = new WaterInteractions(
      config.graphics.interactionResolution <= 128
        ? 128
        : config.graphics.interactionResolution <= 256
          ? 256
          : 512,
      384,
    );
    this.sprayEvents = [];
    this.wakeHistory = new Map();
    this.contactHistory = new Map();
    this.trailEmitters = new Map();
    this.impacts = [];
    this.emissionClock = 0;
    this.ensure(0);
  }

  phaseAt(time = this.clockTime) {
    if (
      this.previousClockTime !== undefined &&
      this.clockTime > this.previousClockTime &&
      time >= this.previousClockTime &&
      time <= this.clockTime
    )
      return (
        this.previousPhase +
        ((this.phase - this.previousPhase) * (time - this.previousClockTime)) /
          (this.clockTime - this.previousClockTime)
      );
    return this.phase + (this.freezePhase ? 0 : (time - this.clockTime) * this.config.ocean.waveSpeed);
  }

  advanceTime(dt) {
    this.previousPhase = this.phase;
    this.previousClockTime = this.clockTime;
    if (!this.freezePhase) this.phase += dt * this.config.ocean.waveSpeed;
    this.clockTime += dt;
  }

  ensure(time = this.clockTime) {
    const start = performance.now(),
      c = this.config,
      w = c.waterWaves,
      phase = this.phaseAt(time);
    swellComponents(c, this.swell, this.weather || 0);
    const resolution =
      c.graphics.spectrumResolution <= 32 ? 32 : c.graphics.spectrumResolution <= 64 ? 64 : 128;
    const key = `${c.ocean.windSpeed}:${c.ocean.windDirection}:${resolution}:${w.seed}:${w.directionalSpread}:${w.shortSuppression}`;
    const rate = w.updateRate,
      tick = Math.floor(phase * rate),
      cache = `${phase}:${key}:${rate}:${this.transition ? this.clockTime : ''}`;
    if (key !== this.key) {
      const old = this.cascades;
      this.cascades = CASCADES.map(
        (size) => new SpectralCascade(size, resolution, c.ocean.windSpeed, c.ocean.windDirection, w.seed, w),
      );
      if (old) {
        // One GPU texture set: the CPU retains the previous realization during a bounded blend.
        const interrupted = !!this.transition;
        this.transition = {
          old,
          wind: this.energyWind ?? c.ocean.windSpeed,
          frozen: interrupted,
          born: this.clockTime,
          duration: 2,
        };
        for (let band = 0; band < 3; band++) {
          const next = this.cascades[band],
            previous = old[band];
          for (let z = 0; z < resolution; z++)
            for (let x = 0; x < resolution; x++)
              next.foam[z * resolution + x] = previous.sample(
                previous.displacement,
                (x * next.size) / resolution,
                (z * next.size) / resolution,
                3,
              );
        }
      }
      this.key = key;
      this.tick = -1;
      this.prepared = '';
    }
    const synthesisChanged = cache !== this.prepared;
    if (synthesisChanged) {
      for (let band = 0; band < 3; band++) {
        const cascade = this.cascades[band];
        if (tick !== this.tick || rate !== this.lastRate) {
          cascade.evaluate(tick / rate, 1);
          cascade.previousDisplacement.set(cascade.displacement);
          cascade.previousNormals.set(cascade.normals);
          cascade.evaluate((tick + 1) / rate, 1);
          cascade.nextDisplacement.set(cascade.displacement);
          cascade.nextNormals.set(cascade.normals);
        }
        const alpha = phase * rate - tick;
        for (let i = 0; i < cascade.displacement.length; i++) {
          cascade.displacement[i] =
            cascade.previousDisplacement[i] * (1 - alpha) + cascade.nextDisplacement[i] * alpha;
          cascade.normals[i] = cascade.previousNormals[i] * (1 - alpha) + cascade.nextNormals[i] * alpha;
        }
        if (this.transition) {
          const old = this.transition.old[band];
          if (!this.transition.frozen && this.clockTime > this.transition.born) {
            old.evaluate(tick / rate, 1);
            old.previousDisplacement.set(old.displacement);
            old.previousNormals.set(old.normals);
            old.evaluate((tick + 1) / rate, 1);
            old.nextDisplacement.set(old.displacement);
            old.nextNormals.set(old.normals);
            for (let i = 0; i < old.displacement.length; i++) {
              old.displacement[i] =
                old.previousDisplacement[i] * (1 - alpha) + old.nextDisplacement[i] * alpha;
              old.normals[i] = old.previousNormals[i] * (1 - alpha) + old.nextNormals[i] * alpha;
            }
          }
          const blend = clamp((this.clockTime - this.transition.born) / this.transition.duration, 0, 1),
            n = cascade.resolution;
          let covariance = 0,
            oldEnergy = 0,
            newEnergy = 0;
          for (let z = 0; z < n; z++)
            for (let x = 0; x < n; x++) {
              const h = old.sample(old.displacement, (x * cascade.size) / n, (z * cascade.size) / n),
                nh = cascade.displacement[(z * n + x) * 4 + 1];
              covariance += h * nh;
              oldEnergy += h * h;
              newEnergy += nh * nh;
            }
          const mixedEnergy =
            oldEnergy * (1 - blend) ** 2 + newEnergy * blend ** 2 + 2 * covariance * blend * (1 - blend);
          const scale = clamp(
            Math.sqrt((oldEnergy * (1 - blend) + newEnergy * blend) / Math.max(1e-10, mixedEnergy)),
            0.7,
            1.42,
          );
          for (let z = 0; z < n; z++)
            for (let x = 0; x < n; x++)
              for (let component = 0; component < 4; component++) {
                const index = (z * n + x) * 4 + component,
                  px = (x * cascade.size) / n,
                  pz = (z * cascade.size) / n;
                cascade.displacement[index] =
                  ((1 - blend) * old.sample(old.displacement, px, pz, component) +
                    blend * cascade.displacement[index]) *
                  scale;
                cascade.normals[index] =
                  ((1 - blend) * old.sample(old.normals, px, pz, component) +
                    blend * cascade.normals[index]) *
                  scale;
              }
        }
        for (let i = 0; i < cascade.foam.length; i++) cascade.displacement[i * 4 + 3] = cascade.foam[i];
        cascade.bound = cascade.derivativeBound();
      }
      if (this.transition && this.clockTime - this.transition.born >= this.transition.duration)
        this.transition = null;
      this.tick = tick;
      this.lastRate = rate;
      this.prepared = cache;
      this.version++;
    }
    this.time = time;
    const energyBlend = this.transition
      ? clamp((this.clockTime - this.transition.born) / this.transition.duration, 0, 1)
      : 1;
    this.energyWind = this.transition
      ? this.transition.wind * (1 - energyBlend) + c.ocean.windSpeed * energyBlend
      : c.ocean.windSpeed;
    const amplitudes = this.amplitudes(this.weather || 0),
      derivativeBound = this.cascades.reduce((sum, band, i) => sum + band.bound * amplitudes[i], 0);
    this.effectiveChop = Math.min(
      c.ocean.choppiness,
      DISPLACEMENT_CONTRACTION / Math.max(1e-8, derivativeBound),
    );
    this.derivativeLimit = derivativeBound * this.effectiveChop;
    if (synthesisChanged) this.timings.fftMs = performance.now() - start;
  }

  amplitudes(weather = 0) {
    const c = this.config,
      w = c.waterWaves,
      scale =
        c.ocean.waveHeight *
        (1 + weather) *
        Math.sqrt((this.energyWind ?? c.ocean.windSpeed) / 9) *
        w.windEnergy;
    this.amplitudeValues ||= [0, 0, 0];
    for (let i = 0; i < 3; i++)
      this.amplitudeValues[i] = [0.23, 0.13, 0.045][i] * scale * w[`band${i + 1}Gain`];
    return this.amplitudeValues;
  }

  sample(x, z, time = this.clockTime, weather = this.weather || 0, local = true, alpha = 1) {
    const options = (this.heightOptions ||= {});
    options.time = time;
    options.weather = weather;
    options.local = local;
    options.alpha = alpha;
    return this.sampleSurface(x, z, options, (this.heightQuery ||= {})).height;
  }

  sampleSurface(x, z, options = {}, out = {}) {
    const start = performance.now(),
      time = options.time ?? this.clockTime,
      weather = options.weather ?? this.weather ?? 0;
    this.weather = weather;
    this.ensure(time);
    const c = this.config,
      amplitudes = this.amplitudes(weather),
      phase = this.phaseAt(time),
      chop = this.effectiveChop;
    let qx = x,
      qz = z,
      residual = Infinity,
      iterations = 0;
    for (; iterations < INVERSE_ITERATIONS; iterations++) {
      let dx = 0,
        dz = 0;
      for (let i = 0; i < 3; i++) {
        const band = this.cascades[i];
        dx += band.sample(band.displacement, qx, qz, 0) * amplitudes[i] * chop;
        dz += band.sample(band.displacement, qx, qz, 2) * amplitudes[i] * chop;
      }
      const rx = qx + dx - x,
        rz = qz + dz - z;
      residual = Math.hypot(rx, rz);
      if (residual <= INVERSE_TOLERANCE) break;
      qx -= rx;
      qz -= rz;
    }
    let height = 0,
      hx = 0,
      hz = 0,
      dxx = 0,
      dxz = 0,
      dzx = 0,
      dzz = 0,
      velocity = 0,
      fluidX = 0,
      fluidY = 0,
      displacementVelocityX = 0,
      displacementVelocityZ = 0,
      fluidZ = 0,
      foam = 0;
    for (const wave of this.swell) {
      if (wave.length < (options.minWavelength || 0)) continue;
      const angle = (qx * wave.dx + qz * wave.dz) * wave.k - wave.omega * phase + wave.phase,
        gain = wave.amplitude * c.ocean.waveHeight * (1 + weather);
      height += Math.sin(angle) * gain;
      hx += Math.cos(angle) * gain * wave.k * wave.dx;
      hz += Math.cos(angle) * gain * wave.k * wave.dz;
      const attenuation = Math.exp(-wave.k * Math.max(0, options.depth || 0));
      const vertical = this.freezePhase ? 0 : -Math.cos(angle) * gain * wave.omega * c.ocean.waveSpeed;
      velocity += vertical;
      fluidY += vertical * attenuation;
      const orbital = this.freezePhase
        ? 0
        : Math.sin(angle) * gain * wave.omega * c.ocean.waveSpeed * attenuation;
      fluidX += orbital * wave.dx;
      fluidZ += orbital * wave.dz;
    }
    for (let i = 0; i < 3; i++) {
      const band = this.cascades[i],
        gain = amplitudes[i],
        g = this.queryGradient;
      height += band.sample(band.displacement, qx, qz) * gain;
      band.gradient(band.displacement, qx, qz, 1, g);
      hx += g[0] * gain;
      hz += g[1] * gain;
      band.gradient(band.displacement, qx, qz, 0, g);
      dxx += g[0] * gain * chop;
      dxz += g[1] * gain * chop;
      band.gradient(band.displacement, qx, qz, 2, g);
      dzx += g[0] * gain * chop;
      dzz += g[1] * gain * chop;
      if (!this.freezePhase) {
        const rate = this.lastRate * c.ocean.waveSpeed * gain,
          attenuation = Math.exp((-TAU * Math.max(0, options.depth || 0)) / [128, 24, 5][i]);
        const vy =
          (band.sample(band.nextDisplacement, qx, qz) - band.sample(band.previousDisplacement, qx, qz)) *
          rate;
        const vx =
          (band.sample(band.nextDisplacement, qx, qz, 0) -
            band.sample(band.previousDisplacement, qx, qz, 0)) *
          rate;
        const vz =
          (band.sample(band.nextDisplacement, qx, qz, 2) -
            band.sample(band.previousDisplacement, qx, qz, 2)) *
          rate;
        velocity += vy;
        fluidY += vy * attenuation;
        fluidX += vx * attenuation;
        fluidZ += vz * attenuation;
        displacementVelocityX += vx * chop;
        displacementVelocityZ += vz * chop;
      }
      foam += band.sample(band.displacement, qx, qz, 3) * 0.18;
    }
    const a = 1 + dxx,
      b = dxz,
      cc = dzx,
      d = 1 + dzz,
      determinant = a * d - b * cc;
    const qVelocityX = -(d * displacementVelocityX - b * displacementVelocityZ) / determinant;
    const qVelocityZ = -(-cc * displacementVelocityX + a * displacementVelocityZ) / determinant;
    velocity += hx * qVelocityX + hz * qVelocityZ;
    let nx = hz * cc - hx * d,
      nz = hx * b - hz * a;
    const normal = (out.normal ||= { x: 0, y: 1, z: 0 });
    out.qx = qx;
    out.qz = qz;
    out.displacementX = x - qx;
    out.displacementZ = z - qz;
    out.compression = 1 - determinant;
    out.jacobian = determinant;
    out.inverseResidual = residual;
    out.inverseIterations = iterations;
    this.maxResidual = Math.max(this.maxResidual || 0, residual);
    this.minJacobian = Math.min(this.minJacobian ?? 1, determinant);
    const local = options.local !== false;
    if (local) {
      let localHeight = this.interactions.sample(x, z);
      if ((options.alpha ?? 1) < 1) {
        const oldHeight = this.interactions.samplePacked(this.interactions.previousData, x, z, 0);
        localHeight = oldHeight * (1 - options.alpha) + localHeight * options.alpha;
      }
      height += localHeight * c.ocean.wakeStrength;
      const delta = this.interactions.spacing;
      nx -=
        (((this.interactions.sample(x + delta, z) - this.interactions.sample(x - delta, z)) *
          c.ocean.wakeStrength) /
          (2 * delta)) *
        determinant;
      nz -=
        (((this.interactions.sample(x, z + delta) - this.interactions.sample(x, z - delta)) *
          c.ocean.wakeStrength) /
          (2 * delta)) *
        determinant;
      const localVelocity = this.interactions.sample(x, z, 'velocity') * c.ocean.wakeStrength;
      velocity += localVelocity;
      fluidY += localVelocity;
      foam += this.interactions.sample(x, z, true);
      for (const impact of this.impacts) {
        const age = time - impact.born;
        if (age < 0 || age > 15) continue;
        const radius = Math.hypot(x - impact.x, z - impact.z),
          delta = radius - age * (12 + Math.sqrt(impact.energy) * 4) * c.waterInteraction.impactSpread,
          width = impact.kind === 'shell' ? 3 : 7,
          amplitude =
            (impact.kind === 'shell' ? 0.12 : 0.65) *
            Math.sqrt(impact.energy) *
            Math.exp(-impact.depth / c.waterInteraction.impactDepth) *
            Math.exp(-age / (5 * c.waterInteraction.impactDecay));
        const slope =
          (Math.cos(delta * 0.3) * 0.3 - (Math.sin(delta * 0.3) * 2 * delta) / (width * width)) *
          Math.exp((-delta * delta) / (width * width)) *
          amplitude *
          c.ocean.wakeStrength *
          c.waterInteraction.impactRing;
        nx -= ((slope * (x - impact.x)) / Math.max(radius, 0.01)) * determinant;
        nz -= ((slope * (z - impact.z)) / Math.max(radius, 0.01)) * determinant;
        height +=
          Math.sin(delta * 0.3) *
          Math.exp(-(delta * delta) / (width * width)) *
          amplitude *
          c.ocean.wakeStrength *
          c.waterInteraction.impactRing;
      }
    }
    const norm = Math.hypot(nx, determinant, nz);
    normal.x = nx / norm;
    normal.y = determinant / norm;
    normal.z = nz / norm;
    out.height = height;
    out.surfaceVerticalVelocity = velocity;
    const fluid = (out.approximateFluidVelocity ||= { x: 0, y: 0, z: 0 });
    fluid.x = fluidX;
    fluid.y = fluidY;
    fluid.z = fluidZ;
    out.foam = foam;
    this.timings.queryMs = performance.now() - start;
    return out;
  }

  update(sim, dt) {
    this.advanceTime(dt);
    this.weather = sim.weather;
    this.ensure(sim.visualTime);
    this.advanceFoam(dt);
    this.impacts = this.impacts.filter((impact) => sim.visualTime - impact.born < 15);
    const p = sim.p,
      c = this.config,
      x = sim.oceanX;
    this.interactions.recenter(x, p.z);
    this.interactions.previousData.set(this.interactions.data);
    this.emissionClock += dt;
    if (this.emissionClock >= 0.1) {
      const elapsed = this.emissionClock;
      this.emissionClock = 0;
      const sources = [
        {
          ...p,
          x,
          length: 66,
          width: 6,
          id: 'player',
          y: sim.body.translation().y + 2,
          motion: sim.waterMotion,
        },
        ...sim.ships
          .filter((s) => Math.abs(deltaX(s.x, p.x)) < 240 && Math.abs(s.z - p.z) < 240)
          .map((s) => ({
            ...s,
            speed: sim.effectiveShipSpeed?.(s) ?? s.speed,
            x: x + deltaX(s.x, p.x),
            depth: s.hp <= 0 ? Math.max(0, -s.y) : 0,
          })),
      ];
      for (const boat of sources) {
        if (boat.depth > c.waterMotion.immersionDistance) continue;
        const forwardX = Math.sin(boat.heading),
          forwardZ = -Math.cos(boat.heading),
          sideX = Math.cos(boat.heading),
          sideZ = Math.sin(boat.heading),
          surfaceFade = immersionEnvelope(boat.depth, c.waterMotion.immersionDistance),
          speed = boat.speed * surfaceFade,
          bowX = boat.x + forwardX * boat.length * 0.42,
          bowZ = boat.z + forwardZ * boat.length * 0.42,
          bowSurface = this.sampleSurface(
            bowX,
            bowZ,
            { time: sim.visualTime, weather: sim.weather, local: false },
            (this.contactQuery ||= {}),
          ),
          bowHeight = bowSurface.height,
          relativeEntry = Math.max(
            0,
            bowSurface.surfaceVerticalVelocity -
              ((bowSurface.normal.x * forwardX + bowSurface.normal.z * forwardZ) /
                Math.max(0.1, bowSurface.normal.y)) *
                speed -
              (boat.motion?.heaveVelocity || 0) -
              (boat.motion?.pitchVelocity || 0) * boat.length * 0.42,
          ),
          waveContact = clamp(
            relativeEntry * 0.2 +
              Math.max(0, bowHeight - boat.y - (boat.motion?.pitch || 0) * boat.length * 0.42) * 0.3,
            0,
            1.5,
          ),
          foam =
            (speed * 0.055 * c.waterInteraction.bowGain +
              waveContact * 0.25 * c.waterInteraction.contactGain) *
            elapsed *
            surfaceFade;
        const previous = this.contactHistory.get(boat.id),
          turn = previous
            ? Math.abs(
                Math.atan2(
                  Math.sin(boat.heading - previous.heading),
                  Math.cos(boat.heading - previous.heading),
                ),
              ) / elapsed
            : 0,
          moved = previous ? Math.hypot(boat.x - previous.x, boat.z - previous.z) : 0;
        const samples = Math.max(
          1,
          Math.min(32, Math.ceil(moved / Math.max(this.interactions.spacing, boat.width * 0.4))),
        );
        const currentX = boat.x,
          currentZ = boat.z;
        for (let sample = 1; sample <= samples; sample++) {
          boat.x = previous ? previous.x + ((currentX - previous.x) * sample) / samples : currentX;
          boat.z = previous ? previous.z + ((currentZ - previous.z) * sample) / samples : currentZ;

          for (const side of [-1, 1]) {
            for (const offset of [-0.22, 0.05, 0.32]) {
              this.interactions.disturb(
                boat.x + forwardX * boat.length * offset + sideX * side * boat.width * 0.5,
                boat.z + forwardZ * boat.length * offset + sideZ * side * boat.width * 0.5,
                Math.max(1.8, boat.width * 0.23 * c.waterInteraction.wakeWidth),
                (waveContact * elapsed * 0.18) / samples,
                (foam * (1 + turn * c.waterInteraction.turnSensitivity)) / samples,
                2.5,
                boat.heading,
              );
            }
          }
          if (speed > 0.3) {
            this.interactions.disturb(
              boat.x - forwardX * boat.length * 0.46,
              boat.z - forwardZ * boat.length * 0.46,
              Math.max(1.5, boat.width * 0.27 * c.waterInteraction.wakeWidth),
              (speed * elapsed * 0.09) / samples,
              (foam * 2.8 * c.waterInteraction.propellerGain) / samples,
              1.7,
              boat.heading,
            );
          }
        }
        boat.x = currentX;
        boat.z = currentZ;
        this.contactHistory.set(boat.id, { x: currentX, z: currentZ, heading: boat.heading });
        if (boat.motion) {
          boat.motion.lastBow = bowHeight;
          boat.motion.wetness = Math.max(
            boat.motion.wetness * Math.exp(-elapsed / c.waterInteraction.dryTime),
            clamp(waveContact * surfaceFade, 0, 1),
          );
        }
        if ((waveContact > 0.4 && speed > 1) || relativeEntry > c.waterInteraction.entryThreshold) {
          this.sprayEvents.push({
            x: bowX,
            z: bowZ,
            y: bowHeight,
            heading: boat.heading,
            strength: clamp(waveContact + speed * 0.08, 0.2, 2) * c.waterInteraction.sprayGain,
            width: boat.width,
            born: this.clockTime,
          });
        }
        if (boat.hp <= 0) {
          this.interactions.disturb(
            boat.x,
            boat.z,
            boat.width * 0.8,
            -elapsed * 0.3,
            elapsed * 0.3,
            2,
            boat.heading,
          );
        }
      }
      for (const t of sim.torpedoes) {
        this.interactions.disturb(x + deltaX(t.x, p.x), t.z, 1.2, elapsed * 0.2, elapsed * 0.6, 2, t.heading);
      }
    }
    this.sprayEvents = this.sprayEvents.slice(-64);
    const f = c.waterInteraction,
      wind = (c.ocean.windDirection * Math.PI) / 180,
      current = (f.currentDirection * Math.PI) / 180;
    const driftX = Math.sin(wind) * f.windDrift + Math.sin(current) * f.currentSpeed,
      driftZ = -Math.cos(wind) * f.windDrift - Math.cos(current) * f.currentSpeed;
    const start = performance.now();
    this.interactions.step(dt, c.ocean.foamLifetime, driftX, driftZ, f);
    this.timings.interactionMs = performance.now() - start;
    this.updateWakeHistory(sim, dt);
  }

  updateWakeHistory(sim, dt) {
    const p = sim.p,
      x = sim.oceanX,
      c = this.config;
    const boats = [
      {
        id: 'player',
        x,
        z: p.z,
        speed: p.speed * immersionEnvelope(p.depth, c.waterMotion.immersionDistance),
        width: 6,
        heading: p.heading,
        length: 66,
      },
      ...sim.ships
        .slice(0, 32)
        .map((ship) => ({ ...ship, x: x + deltaX(ship.x, p.x), speed: sim.effectiveShipSpeed(ship) })),
      ...sim.torpedoes.slice(0, 16).map((torpedo) => ({
        ...torpedo,
        id: `torp${torpedo.id}`,
        x: x + deltaX(torpedo.x, p.x),
        speed: c.combat.torpedoSpeed,
        width: 0.8,
        length: 0,
      })),
    ];
    const flow = c.waterInteraction,
      wind = (c.ocean.windDirection * Math.PI) / 180,
      current = (flow.currentDirection * Math.PI) / 180;
    const driftX = Math.sin(wind) * flow.windDrift + Math.sin(current) * flow.currentSpeed,
      driftZ = -Math.cos(wind) * flow.windDrift - Math.cos(current) * flow.currentSpeed;
    for (const trail of this.wakeHistory.values())
      for (const point of trail) {
        point.x += driftX * dt;
        point.z += driftZ * dt;
      }
    for (const boat of boats) {
      const bx = boat.x - Math.sin(boat.heading) * boat.length * 0.42,
        bz = boat.z + Math.cos(boat.heading) * boat.length * 0.42;
      const trail = this.wakeHistory.get(boat.id) || [],
        last = this.trailEmitters.get(boat.id);
      if (boat.speed > 0.4 && (!last || Math.hypot(bx - last.x, bz - last.z) >= 4)) {
        const count =
          last && this.clockTime - last.born < 0.5
            ? Math.min(32, Math.ceil(Math.hypot(bx - last.x, bz - last.z) / 4))
            : 1;
        for (let i = 1; i <= count; i++)
          trail.push({
            x: last ? last.x + ((bx - last.x) * i) / count : bx,
            z: last ? last.z + ((bz - last.z) * i) / count : bz,
            width: boat.width * c.waterInteraction.wakeWidth,
            born: this.clockTime,
            heading: boat.heading,
          });
      }
      if (boat.speed > 0.4 && (!last || Math.hypot(bx - last.x, bz - last.z) >= 4))
        this.trailEmitters.set(boat.id, { x: bx, z: bz, born: this.clockTime });
      if (trail.length) this.wakeHistory.set(boat.id, trail);
    }
    for (const [id, trail] of this.wakeHistory) {
      const latest = trail.at(-1);
      while (
        trail.length &&
        (this.clockTime - trail[0].born > c.ocean.foamLifetime ||
          trail.length > 160 ||
          Math.hypot(latest.x - trail[0].x, latest.z - trail[0].z) > c.ocean.wakeLength)
      )
        trail.shift();
      if (!trail.length) {
        this.wakeHistory.delete(id);
        this.contactHistory.delete(id);
        this.trailEmitters.delete(id);
      }
    }
    while (this.wakeHistory.size > 64) {
      const id = this.wakeHistory.keys().next().value;
      this.wakeHistory.delete(id);
      this.contactHistory.delete(id);
      this.trailEmitters.delete(id);
    }
    while (this.contactHistory.size > 64) this.contactHistory.delete(this.contactHistory.keys().next().value);
  }

  advanceFoam(dt) {
    const f = this.config.waterInteraction,
      amplitudes = this.amplitudes(this.weather || 0);
    const wind = (this.config.ocean.windDirection * Math.PI) / 180,
      current = (f.currentDirection * Math.PI) / 180,
      driftX = Math.sin(wind) * f.windDrift + Math.sin(current) * f.currentSpeed,
      driftZ = -Math.cos(wind) * f.windDrift - Math.cos(current) * f.currentSpeed;
    for (let band = 0; band < 3; band++) {
      const cascade = this.cascades[band];
      for (let i = 0; i < cascade.foam.length; i++) {
        const n = cascade.resolution,
          x = i % n,
          z = Math.floor(i / n),
          left = (z * n + ((x + n - 1) % n)) * 4,
          right = (z * n + ((x + 1) % n)) * 4,
          back = (((z + n - 1) % n) * n + x) * 4,
          front = (((z + 1) % n) * n + x) * 4;
        const scale = (amplitudes[band] * this.effectiveChop) / ((2 * cascade.size) / n),
          d = cascade.displacement;
        const xx = (d[right] - d[left]) * scale,
          xz = (d[front] - d[back]) * scale,
          zx = (d[right + 2] - d[left + 2]) * scale,
          zz = (d[front + 2] - d[back + 2]) * scale;
        const compression = 1 - ((1 + xx) * (1 + zz) - xz * zx);
        const breaking = clamp((compression - f.compressionThreshold) * 3.5, 0, 1) * f.whitecapGain;
        // Periodic semi-Lagrangian transport keeps crest foam in the same world-space flow as wakes.
        const u = (((x - (driftX * dt * n) / cascade.size) % n) + n) % n,
          v = (((z - (driftZ * dt * n) / cascade.size) % n) + n) % n,
          ix = Math.floor(u),
          iz = Math.floor(v),
          tx = u - ix,
          tz = v - iz,
          nextX = (ix + 1) % n,
          nextZ = (iz + 1) % n;
        const transported =
          (cascade.foam[iz * n + ix] * (1 - tx) + cascade.foam[iz * n + nextX] * tx) * (1 - tz) +
          (cascade.foam[nextZ * n + ix] * (1 - tx) + cascade.foam[nextZ * n + nextX] * tx) * tz;
        cascade.nextFoam[i] = Math.min(
          f.coverageCap,
          transported * Math.exp(-dt / f.whitecapDecay) + breaking * dt * 1.2,
        );
      }
      [cascade.foam, cascade.nextFoam] = [cascade.nextFoam, cascade.foam];
      for (let i = 0; i < cascade.foam.length; i++) cascade.displacement[i * 4 + 3] = cascade.foam[i];
    }
    this.version++;
  }

  snapshot() {
    return {
      version: 1,
      phase: this.phase,
      clockTime: this.clockTime,
      emissionClock: this.emissionClock,
      impacts: this.impacts.map((impact) => ({ ...impact })),
      emitters: [...this.trailEmitters].map(([id, point]) => [id, { ...point }]),
      wakes: [...this.wakeHistory].map(([id, trail]) => [id, trail.map((point) => ({ ...point }))]),
      resolution: this.cascades[0].resolution,
      foam: this.cascades.map((cascade) => {
        const bytes = Uint8Array.from(cascade.foam, (value) => Math.round(clamp(value, 0, 1) * 255));
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192)
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        return btoa(binary);
      }),
    };
  }

  restore(raw, time = 0) {
    this.phase = time * this.config.ocean.waveSpeed;
    this.clockTime = time;
    if (
      raw?.version !== 1 ||
      !Number.isFinite(raw.phase) ||
      raw.phase < 0 ||
      raw.phase > 3e12 ||
      !Number.isFinite(raw.clockTime) ||
      raw.clockTime < 0 ||
      raw.clockTime > 1e12
    ) {
      this.ensure(time);
      return false;
    }
    this.phase = raw.phase;
    this.clockTime = raw.clockTime;
    this.emissionClock = Number.isFinite(raw.emissionClock) ? clamp(raw.emissionClock, 0, 0.1) : 0;
    this.ensure(time);
    if (raw.resolution === this.cascades[0].resolution && Array.isArray(raw.foam) && raw.foam.length === 3) {
      for (let band = 0; band < 3; band++) {
        const cascade = this.cascades[band],
          encoded = raw.foam[band];
        if (typeof encoded !== 'string' || encoded.length > cascade.foam.length * 2) continue;
        try {
          const binary = atob(encoded);
          if (binary.length !== cascade.foam.length) continue;
          for (let i = 0; i < binary.length; i++)
            cascade.displacement[i * 4 + 3] = cascade.foam[i] = binary.charCodeAt(i) / 255;
        } catch {
          /* Optional visual memory may be discarded. */
        }
      }
    }
    if (Array.isArray(raw.wakes))
      for (const row of raw.wakes.slice(0, 64)) {
        if (!Array.isArray(row) || row.length !== 2) continue;
        const [id, trail] = row;
        if (!Array.isArray(trail) || !['string', 'number'].includes(typeof id)) continue;
        const valid = trail
          .slice(-160)
          .filter(
            (p) =>
              p &&
              Number.isFinite(p.x) &&
              Math.abs(p.x) < 1e12 &&
              Number.isFinite(p.z) &&
              Math.abs(p.z) < 78 * 111000 &&
              Number.isFinite(p.born) &&
              p.born <= this.clockTime &&
              p.born >= 0 &&
              Number.isFinite(p.width) &&
              p.width > 0 &&
              p.width < 100 &&
              Number.isFinite(p.heading),
          );
        if (valid.length)
          this.wakeHistory.set(
            id,
            valid.map((p) => ({ x: p.x, z: p.z, width: p.width, born: p.born, heading: p.heading })),
          );
      }
    if (Array.isArray(raw.emitters))
      for (const row of raw.emitters.slice(0, 64)) {
        if (!Array.isArray(row) || row.length !== 2) continue;
        const [id, point] = row;
        if (
          point &&
          Number.isFinite(point.x) &&
          Math.abs(point.x) <= 1e12 &&
          Number.isFinite(point.z) &&
          Math.abs(point.z) <= 78 * 111000 &&
          Number.isFinite(point.born) &&
          point.born >= 0 &&
          point.born <= this.clockTime
        )
          this.trailEmitters.set(id, { x: point.x, z: point.z, born: point.born });
      }
    if (Array.isArray(raw.impacts))
      this.impacts = raw.impacts
        .slice(-8)
        .filter(
          (impact) =>
            impact &&
            ['shell', 'torpedo', 'depth-charge'].includes(impact.kind) &&
            Number.isFinite(impact.x) &&
            Math.abs(impact.x) <= 1e12 &&
            Number.isFinite(impact.z) &&
            Math.abs(impact.z) <= 78 * 111000 &&
            Number.isFinite(impact.born) &&
            impact.born >= 0 &&
            impact.born <= this.clockTime &&
            Number.isFinite(impact.energy) &&
            impact.energy >= 0.1 &&
            impact.energy <= 10 &&
            Number.isFinite(impact.depth) &&
            impact.depth >= 0 &&
            impact.depth <= 600,
        )
        .map((impact) => ({ ...impact }));
    this.version++;
    return true;
  }

  renderState() {
    this.ensure(this.clockTime);
    return this;
  }
  sampleHull(points, options, outputs) {
    for (let i = 0; i < points.length; i++)
      this.sampleSurface(points[i].x, points[i].z, options, (outputs[i] ||= {}));
    return outputs;
  }

  resizeInteractions() {
    const requested = this.config.graphics.interactionResolution,
      resolution = requested <= 128 ? 128 : requested <= 256 ? 256 : 512;
    if (resolution === this.interactions.resolution) return;
    const old = this.interactions,
      next = new WaterInteractions(resolution, old.size);
    next.recenter(old.x, old.z);
    for (let row = 0; row < resolution; row++) {
      for (let col = 0; col < resolution; col++) {
        const x = next.x + (col - resolution / 2) * next.spacing,
          z = next.z + (row - resolution / 2) * next.spacing,
          i = row * resolution + col;
        next.height[i] = old.sample(x, z);
        next.velocity[i] = old.sample(x, z, 'velocity');
        next.foam[i] = old.sample(x, z, true);
        next.foamAge[i] = old.sample(x, z, 'age');
      }
    }
    next.pack();
    next.active = old.active;
    next.previousData.set(next.data);
    this.interactions = next;
  }

  impact(x, z, kind, energy = 1, depth = 0) {
    const f = this.config.waterInteraction;
    const attenuation = Math.exp(-depth / f.impactDepth),
      radius = kind === 'shell' ? 2.5 : kind === 'torpedo' ? 9 : 12,
      strength = Math.sqrt(Math.max(0.1, energy)) * attenuation;
    this.impacts.push({ x, z, kind, energy, depth, born: this.clockTime });
    this.impacts = this.impacts.slice(-8);
    // The analytic ring handles displacement at any distance; the local field
    // preserves the foam left behind by a nearby plume.
    this.interactions.stamp(x, z, radius, 0, strength * 0.85 * f.impactFoam);
    this.interactions.pack();
  }
}

export function newWaterMotion(raw) {
  const motion = {
    pitch: 0,
    roll: 0,
    pitchVelocity: 0,
    rollVelocity: 0,
    heave: 0,
    heaveVelocity: 0,
    supportVelocity: 0,
    wetness: 0,
    lastBow: 0,
  };
  for (const key of Object.keys(motion))
    if (Number.isFinite(raw?.[key])) {
      const limit =
        key === 'pitch' || key === 'roll'
          ? 0.35
          : key === 'lastBow' || key === 'heave'
            ? 300
            : key === 'wetness'
              ? 1
              : key === 'heaveVelocity'
                ? 12
                : key === 'supportVelocity'
                  ? 6
                  : 3;
      motion[key] = clamp(raw[key], key === 'wetness' ? 0 : -limit, limit);
    }
  return motion;
}

export function hullWaterPose(sim, hull, length, width, motion, dt = 1 / 30) {
  const fx = Math.sin(hull.heading),
    fz = -Math.cos(hull.heading),
    sx = Math.cos(hull.heading),
    sz = Math.sin(hull.heading);
  const settings = sim.config?.waterMotion || {
    pitchResponse: 3.2,
    rollResponse: 3.2,
    pitchDamping: 3.2,
    rollDamping: 3.2,
    velocityInfluence: 0,
    immersionDistance: 8,
    longitudinalWeight: 1,
    transverseWeight: 1,
  };
  const fade = immersionEnvelope(hull.depth || 0, settings.immersionDistance);
  if (!motion.probes)
    Object.defineProperty(motion, 'probes', {
      value: Array.from({ length: 12 }, () => ({ surface: {} })),
      configurable: true,
    });
  let sum = 0,
    mean = 0,
    vertical = 0,
    pitchMoment = 0,
    rollMoment = 0,
    pitchVelocity = 0,
    rollVelocity = 0,
    pitchInertia = 0,
    rollInertia = 0,
    index = 0;
  for (const longitudinal of [-0.42, -0.14, 0.14, 0.42])
    for (const transverse of [-0.38, 0, 0.38]) {
      const probe = motion.probes[index++],
        along = length * longitudinal,
        across = width * transverse;
      const weight =
        (Math.abs(longitudinal) > 0.3 ? settings.longitudinalWeight : 1) *
        (transverse ? settings.transverseWeight : 1);
      probe.x = hull.x + fx * along + sx * across;
      probe.z = hull.z + fz * along + sz * across;
      if (sim.sampleWaterSurface)
        sim.sampleWaterSurface(
          probe.x,
          probe.z,
          { depth: hull.depth || 0, minWavelength: length * 0.06 },
          probe.surface,
        );
      else {
        probe.surface.height = sim.sampleWater(probe.x, probe.z);
        probe.surface.surfaceVerticalVelocity = 0;
      }
      const height = probe.surface.height,
        velocity = probe.surface.approximateFluidVelocity?.y ?? probe.surface.surfaceVerticalVelocity ?? 0;
      const pose = (motion.pitch || 0) * along + (motion.roll || 0) * across;
      probe.height = height;
      probe.along = along;
      probe.across = across;
      probe.weight = weight;
      probe.support = (height - pose) * fade - (motion.heave || 0);
      probe.entry =
        velocity -
        (motion.heaveVelocity || 0) -
        (motion.pitchVelocity || 0) * along -
        (motion.rollVelocity || 0) * across;
      sum += weight;
      mean += height * weight;
      vertical += velocity * weight;
      pitchMoment += height * along * weight;
      rollMoment += height * across * weight;
      pitchVelocity += velocity * along * weight;
      rollVelocity += velocity * across * weight;
      pitchInertia += along * along * weight;
      rollInertia += across * across * weight;
    }
  const desiredPitch = clamp((pitchMoment / Math.max(1, pitchInertia)) * fade, -0.25, 0.25),
    desiredRoll = clamp((rollMoment / Math.max(1, rollInertia)) * fade, -0.3, 0.3);
  const classScale = length > 80 ? 0.5 : 1,
    step = Math.min(1 / 30, dt);
  for (const [angle, velocity, target, response, damping, fluid] of [
    [
      'pitch',
      'pitchVelocity',
      desiredPitch,
      settings.pitchResponse,
      settings.pitchDamping,
      pitchVelocity / Math.max(1, pitchInertia),
    ],
    [
      'roll',
      'rollVelocity',
      desiredRoll,
      settings.rollResponse,
      settings.rollDamping,
      rollVelocity / Math.max(1, rollInertia),
    ],
  ]) {
    const relativeVelocity = motion[velocity] - clamp(fluid, -0.5, 0.5) * settings.velocityInfluence * fade;
    motion[velocity] = clamp(
      motion[velocity] +
        ((target - motion[angle]) * response * classScale - relativeVelocity * damping) * step,
      -0.6,
      0.6,
    );
    motion[angle] = clamp(motion[angle] + motion[velocity] * step, -0.35, 0.35);
  }
  motion.supportVelocity = clamp(vertical / sum, -6, 6) * fade;
  return mean / sum;
}
