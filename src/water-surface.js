import { clamp, deltaX, random, TAU, WAVES } from './world.js';

const GRAVITY = 9.81;
const CASCADES = [512, 128, 32];
const FRAME_RATE = 12;

// The same seeded spectrum is sampled by buoyancy and uploaded to the water shader.
// Keeping it on the CPU avoids GPU readbacks and also supports the WebGL backend.
export class SpectralCascade {
  constructor(size, resolution = 64, wind = 9, direction = 315, seed = 1942) {
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
    this.displacement = new Float32Array(count * 4);
    this.normals = new Float32Array(count * 4);
    this.previousDisplacement = new Float32Array(count * 4);
    this.nextDisplacement = new Float32Array(count * 4);
    this.previousNormals = new Float32Array(count * 4);
    this.nextNormals = new Float32Array(count * 4);
    this.reversal = new Uint16Array(resolution);
    const rng = random(seed + size),
      heading = (direction * Math.PI) / 180,
      wx = Math.sin(heading),
      wz = -Math.cos(heading),
      largestWave = Math.max(3, (wind * wind) / GRAVITY);
    let energy = 0;
    for (let z = 0; z < resolution; z++) {
      for (let x = 0; x < resolution; x++) {
        const i = z * resolution + x,
          kx = ((x <= resolution / 2 ? x : x - resolution) * TAU) / size,
          kz = ((z <= resolution / 2 ? z : z - resolution) * TAU) / size,
          k = Math.hypot(kx, kz);
        this.kx[i] = kx;
        this.kz[i] = kz;
        this.frequency[i] = Math.sqrt(GRAVITY * k);
        if (k < 1e-6) continue;
        const alignment = (kx * wx + kz * wz) / k,
          lowCutoff = Math.exp(-1 / (k * largestWave) ** 2),
          highCutoff = Math.exp(-((((k * size) / resolution) * 0.65) ** 2)),
          power = (lowCutoff * highCutoff * (0.06 + alignment ** 4) * (alignment > 0 ? 1 : 0.18)) / k ** 4,
          radius = Math.sqrt(-2 * Math.log(Math.max(1e-8, rng()))),
          angle = TAU * rng(),
          amplitude = Math.sqrt(power * 0.5);
        this.initial[i * 2] = radius * Math.cos(angle) * amplitude;
        this.initial[i * 2 + 1] = radius * Math.sin(angle) * amplitude;
        energy += this.initial[i * 2] ** 2 + this.initial[i * 2 + 1] ** 2;
      }
    }
    // Fixed energy normalization, never per-frame normalization (which would make seas breathe).
    const scale = count / Math.sqrt(Math.max(1e-8, energy * 2));
    for (let i = 0; i < this.initial.length; i++) this.initial[i] *= scale;
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

  evaluate(time, chop = 0.65, breakingStrength = 1) {
    const elapsed = this.lastTime === undefined ? 1 / FRAME_RATE : clamp(time - this.lastTime, 0, 0.2);
    this.lastTime = time;
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
          s = Math.sin(phase),
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
          ratio = k > 0 ? (-directions[i] / k) * chop : 0;
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
        const breaking = clamp((compression * breakingStrength - 0.12) * 3.5, 0, 1);
        this.foam[i] = Math.min(1, this.foam[i] * Math.exp(-elapsed / 3) + breaking * elapsed * 1.2);
        this.displacement[i * 4 + 3] = this.foam[i];
      }
    }
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
    this.nextHeight = new Float32Array(resolution * resolution);
    this.nextVelocity = new Float32Array(resolution * resolution);
    this.nextFoam = new Float32Array(resolution * resolution);
    this.data = new Float32Array(resolution * resolution * 4);
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
        this.foam[i] = Math.min(1.5, this.foam[i] + foam * falloff);
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

  step(dt, lifetime = 45, windX = 0, windZ = 0) {
    if (!this.active) return;
    const n = this.resolution,
      damping = Math.exp(-dt * 1.2),
      decay = Math.exp(-dt / Math.max(1, lifetime)),
      coefficient = 64 / (this.spacing * this.spacing),
      driftX = clamp((windX * dt) / this.spacing, -0.2, 0.2),
      driftZ = clamp((windZ * dt) / this.spacing, -0.2, 0.2);
    this.nextHeight.fill(0);
    this.nextVelocity.fill(0);
    this.nextFoam.fill(0);
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
            (this.foam[i - 1] + this.foam[i + 1] + this.foam[i - n] + this.foam[i + n] - f * 4) * dt * 0.4,
          advection =
            Math.abs(driftX) * (this.foam[i + (driftX > 0 ? -1 : 1)] - f) +
            Math.abs(driftZ) * (this.foam[i + (driftZ > 0 ? -n : n)] - f),
          edge = Math.min(1, Math.min(x, z, n - x - 1, n - z - 1) / 12);
        this.nextVelocity[i] = velocity * edge;
        this.nextHeight[i] = clamp(h + velocity * dt, -2, 2) * edge;
        this.nextFoam[i] = Math.max(0, (f + diffusion + advection) * decay) * edge;
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
      }
    }
    this.version++;
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
      array = foam === 'velocity' ? this.velocity : foam ? this.foam : this.height,
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
    this.impacts = [];
    this.emissionClock = 0;
    this.ensure(0);
  }

  ensure(time) {
    if (
      time === this.time &&
      this.lastWind === this.config.ocean.windSpeed &&
      this.lastDirection === this.config.ocean.windDirection &&
      this.lastResolution === this.config.graphics.spectrumResolution &&
      this.lastSpeed === this.config.ocean.waveSpeed &&
      this.lastChop === this.config.ocean.choppiness
    )
      return;
    const c = this.config,
      wind = c.ocean.windSpeed ?? 9,
      direction = c.ocean.windDirection ?? 315,
      resolution = c.graphics.spectrumResolution <= 32 ? 32 : c.graphics.spectrumResolution <= 64 ? 64 : 128,
      key = `${wind}:${direction}:${resolution}:${c.ocean.waveSpeed}:${c.ocean.choppiness}`;
    if (key !== this.key) {
      this.cascades = CASCADES.map((size) => new SpectralCascade(size, resolution, wind, direction));
      this.key = key;
      this.tick = -1;
      this.time = -1;
    }
    this.lastWind = c.ocean.windSpeed;
    this.lastDirection = c.ocean.windDirection;
    this.lastResolution = c.graphics.spectrumResolution;
    this.lastSpeed = c.ocean.waveSpeed;
    this.lastChop = c.ocean.choppiness;
    const tick = Math.floor(time * FRAME_RATE);
    if (time === this.time) return;
    const amplitudes = this.amplitudes(this.weather || 0);
    for (let band = 0; band < this.cascades.length; band++) {
      const cascade = this.cascades[band];
      if (tick !== this.tick) {
        if (tick === this.tick + 1) {
          cascade.previousDisplacement.set(cascade.nextDisplacement);
          cascade.previousNormals.set(cascade.nextNormals);
        } else {
          cascade.evaluate((tick / FRAME_RATE) * c.ocean.waveSpeed, c.ocean.choppiness, amplitudes[band]);
          cascade.previousDisplacement.set(cascade.displacement);
          cascade.previousNormals.set(cascade.normals);
        }
        cascade.evaluate(((tick + 1) / FRAME_RATE) * c.ocean.waveSpeed, c.ocean.choppiness, amplitudes[band]);
        cascade.nextDisplacement.set(cascade.displacement);
        cascade.nextNormals.set(cascade.normals);
      }
      const alpha = time * FRAME_RATE - tick;
      for (let i = 0; i < cascade.displacement.length; i++) {
        cascade.displacement[i] =
          cascade.previousDisplacement[i] * (1 - alpha) + cascade.nextDisplacement[i] * alpha;
        cascade.normals[i] = cascade.previousNormals[i] * (1 - alpha) + cascade.nextNormals[i] * alpha;
      }
    }
    this.tick = tick;
    this.time = time;
    this.version++;
  }

  amplitudes(weather = 0) {
    const height = this.config.ocean.waveHeight * (1 + weather),
      wind = (this.config.ocean.windSpeed ?? 9) / 9;
    const scale = height * Math.sqrt(wind);
    if (scale !== this.amplitudeScale) {
      this.amplitudeScale = scale;
      this.amplitudeValues = [0.23 * scale, 0.13 * scale, 0.045 * scale];
    }
    return this.amplitudeValues;
  }

  sample(x, z, time, weather = 0, local = true) {
    this.ensure(time);
    const c = this.config,
      amplitudes = this.amplitudes(weather);
    let qx = x,
      qz = z;
    // Invert the horizontal displacement so sampling a world point agrees with the shader.
    for (let iteration = 0; iteration < 2; iteration++) {
      let dx = 0,
        dz = 0;
      for (let i = 0; i < this.cascades.length; i++) {
        const cascade = this.cascades[i];
        dx += cascade.sample(cascade.displacement, qx, qz, 0) * amplitudes[i];
        dz += cascade.sample(cascade.displacement, qx, qz, 2) * amplitudes[i];
      }
      qx = x - dx;
      qz = z - dz;
    }
    let height = 0;
    for (const [length, amplitude, dx, dz] of WAVES) {
      const k = TAU / length;
      height +=
        Math.sin((qx * dx + qz * dz) * k - Math.sqrt(GRAVITY * k) * time * c.ocean.waveSpeed) *
        amplitude *
        c.ocean.waveHeight *
        (1 + weather);
    }
    for (let i = 0; i < this.cascades.length; i++) {
      const cascade = this.cascades[i];
      height += cascade.sample(cascade.displacement, qx, qz) * amplitudes[i];
    }
    if (local) {
      height += this.interactions.sample(x, z) * c.ocean.wakeStrength;
      for (const impact of this.impacts) {
        const age = time - impact.born;
        if (age < 0 || age > 15) continue;
        const radius = Math.hypot(x - impact.x, z - impact.z),
          delta = radius - age * (12 + Math.sqrt(impact.energy) * 4),
          width = impact.kind === 'shell' ? 3 : 7,
          amplitude =
            (impact.kind === 'shell' ? 0.12 : 0.65) *
            Math.sqrt(impact.energy) *
            Math.exp(-impact.depth / 28) *
            Math.exp(-age / 5);
        height +=
          Math.sin(delta * 0.3) *
          Math.exp(-(delta * delta) / (width * width)) *
          amplitude *
          c.ocean.wakeStrength;
      }
    }
    return height;
  }

  update(sim, dt) {
    this.weather = sim.weather;
    this.ensure(sim.visualTime);
    this.impacts = this.impacts.filter((impact) => sim.visualTime - impact.born < 15);
    const p = sim.p,
      c = this.config,
      x = sim.oceanX;
    this.interactions.recenter(x, p.z);
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
          .map((s) => ({ ...s, x: x + deltaX(s.x, p.x), depth: 0 })),
      ];
      for (const boat of sources) {
        if (boat.depth > 6) continue;
        const forwardX = Math.sin(boat.heading),
          forwardZ = -Math.cos(boat.heading),
          sideX = Math.cos(boat.heading),
          sideZ = Math.sin(boat.heading),
          surfaceFade = clamp(1 - boat.depth / 6, 0, 1),
          speed = boat.speed * surfaceFade,
          bowX = boat.x + forwardX * boat.length * 0.42,
          bowZ = boat.z + forwardZ * boat.length * 0.42,
          bowHeight = this.sample(bowX, bowZ, sim.visualTime, sim.weather, false),
          relativeEntry = Math.max(0, (bowHeight - (boat.motion?.lastBow ?? bowHeight)) / elapsed),
          waveContact = clamp(0.08 + relativeEntry * 0.2 + Math.max(0, bowHeight - boat.y) * 0.3, 0, 1.5),
          foam = (speed * 0.055 + waveContact * 0.25) * elapsed * surfaceFade;
        for (const side of [-1, 1]) {
          for (const offset of [-0.22, 0.05, 0.32]) {
            this.interactions.disturb(
              boat.x + forwardX * boat.length * offset + sideX * side * boat.width * 0.5,
              boat.z + forwardZ * boat.length * offset + sideZ * side * boat.width * 0.5,
              Math.max(1.8, boat.width * 0.23),
              waveContact * elapsed * 0.18,
              foam,
              2.5,
              boat.heading,
            );
          }
        }
        if (speed > 0.3) {
          this.interactions.disturb(
            boat.x - forwardX * boat.length * 0.46,
            boat.z - forwardZ * boat.length * 0.46,
            Math.max(1.5, boat.width * 0.27),
            speed * elapsed * 0.09,
            foam * 2.8,
            1.7,
            boat.heading,
          );
        }
        if (boat.motion) {
          boat.motion.lastBow = bowHeight;
          boat.motion.wetness = Math.max(
            boat.motion.wetness * Math.exp(-elapsed / 35),
            clamp(waveContact * surfaceFade, 0, 1),
          );
        }
        if ((waveContact > 0.4 && speed > 1) || relativeEntry > 0.65) {
          this.sprayEvents.push({
            x: bowX,
            z: bowZ,
            y: bowHeight,
            heading: boat.heading,
            strength: clamp(waveContact + speed * 0.08, 0.2, 2),
            width: boat.width,
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
    const wind = ((c.ocean.windDirection ?? 315) * Math.PI) / 180;
    let remaining = dt;
    while (remaining > 1e-6) {
      const step = Math.min(1 / 30, remaining);
      this.interactions.step(step, c.ocean.foamLifetime ?? 45, Math.sin(wind) * 0.35, -Math.cos(wind) * 0.35);
      remaining -= step;
    }
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
      }
    }
    next.pack();
    next.active = old.active;
    this.interactions = next;
  }

  impact(x, z, kind, energy = 1, depth = 0) {
    const attenuation = Math.exp(-depth / 28),
      radius = kind === 'shell' ? 2.5 : kind === 'torpedo' ? 9 : 12,
      strength = Math.sqrt(Math.max(0.1, energy)) * attenuation;
    this.impacts.push({ x, z, kind, energy, depth, born: this.time || 0 });
    this.impacts = this.impacts.slice(-8);
    // The analytic ring handles displacement at any distance; the local field
    // preserves the foam left behind by a nearby plume.
    this.interactions.stamp(x, z, radius, 0, strength * 0.85);
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
    wetness: 0,
    lastBow: 0,
  };
  for (const key of Object.keys(motion))
    if (Number.isFinite(raw?.[key])) {
      const limit =
        key === 'pitch' || key === 'roll'
          ? 0.35
          : key === 'lastBow' || key === 'heave'
            ? 30
            : key === 'wetness'
              ? 1
              : 3;
      motion[key] = clamp(raw[key], key === 'wetness' ? 0 : -limit, limit);
    }
  return motion;
}

export function hullWaterPose(sim, hull, length, width, motion, dt = 1 / 30) {
  const x = hull.x,
    z = hull.z,
    fx = Math.sin(hull.heading),
    fz = -Math.cos(hull.heading),
    sx = Math.cos(hull.heading),
    sz = Math.sin(hull.heading),
    half = length * 0.36,
    bow = sim.sampleWater(x + fx * half, z + fz * half),
    stern = sim.sampleWater(x - fx * half, z - fz * half),
    port = sim.sampleWater(x - sx * width * 0.6, z - sz * width * 0.6),
    starboard = sim.sampleWater(x + sx * width * 0.6, z + sz * width * 0.6),
    middle = sim.sampleWater(x, z),
    submerged = clamp(1 - (hull.depth || 0) / 8, 0, 1),
    desiredPitch = clamp(Math.atan2(stern - bow, half * 2) * submerged, -0.25, 0.25),
    desiredRoll = clamp(Math.atan2(starboard - port, width * 1.2) * submerged, -0.3, 0.3),
    response = length > 80 ? 1.6 : 3.2,
    step = Math.min(0.05, dt);
  for (const [angle, velocity, target] of [
    ['pitch', 'pitchVelocity', desiredPitch],
    ['roll', 'rollVelocity', desiredRoll],
  ]) {
    motion[velocity] +=
      ((target - motion[angle]) * response - motion[velocity] * Math.sqrt(response) * 1.8) * step;
    motion[angle] = clamp(motion[angle] + motion[velocity] * step, -0.35, 0.35);
  }
  return (middle * 2 + bow + stern + port + starboard) / 6;
}
