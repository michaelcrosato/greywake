import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import * as THREE from 'three/webgpu';
import { sunlight, worldClock } from './lighting.js';
import { buildModels } from './models.js';
import { Ocean } from './ocean.js';
import { hullWaterPose, newWaterMotion } from './water-surface.js';
import { dropletTexture } from './water-textures.js';
import { clamp, deltaX, distance as geoDistance, isLand, random } from './world.js';

export class View {
  constructor(canvas, sim) {
    this.canvas = canvas;
    this.sim = sim;
    this.config = sim.config;
    this.scene = new THREE.Scene();
    this.underwater = false;
    this.attractMotion = newWaterMotion();
    this.attractHeave = -2 - sim.p.depth;
    this.underwaterBlend = 0;
    this.airFogColor = new THREE.Color(0xadc0c5);
    this.underwaterBackground = new THREE.Color(0x052c3b);
    // NodeManager keys fog by object identity. Replacing it rebuilds every material and GPU pipeline.
    this.scene.fog = new THREE.FogExp2(0xadc0c5, 0.48 / this.config.graphics.viewDistance);
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.2, 40000);
    this.sun = new THREE.Vector3();
    this.sunColor = new THREE.Color();
    this.environmentSun = new THREE.Vector3();
    this.models = buildModels();
    this.sub = this.models.sub;
    const steel = this.sub.children[1].material;
    this.scopeExtension = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 1, 10), steel);
    this.scopeEye = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), this.sub.children[0].material);
    this.scopeExtension.castShadow = this.scopeEye.castShadow = true;
    this.sub.add(this.scopeExtension, this.scopeEye);
    this.portBuoy = new THREE.Group();
    const buoyPaint = new THREE.MeshStandardMaterial({ color: 0xdbd7bf, roughness: 0.7, metalness: 0.3 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.6, 1.4, 16), buoyPaint);
    base.position.y = 0.4;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.3, 4.5, 10), steel);
    mast.position.y = 2.8;
    const top = new THREE.Mesh(
      new THREE.ConeGeometry(0.7, 1.2, 12),
      new THREE.MeshStandardMaterial({ color: 0x54776b, roughness: 0.7 }),
    );
    top.position.y = 5.3;
    this.portBuoy.add(base, mast, top);
    this.portBuoy.children.forEach((m) => {
      m.castShadow = true;
    });
    this.scene.add(this.portBuoy);
    this.scene.add(this.sub);
    this.shipModels = new Map();
    this.trails = new Map();
    this.orbit = -0.58;
    this.elevation = 0;
    this.mode = 'chase';
    this.fps = 60;
    this.frameCount = 0;
    this.frameTime = 0;
    this.frameMs = 0;
    this.cpuMs = 0;
    this.cameraPosition = new THREE.Vector3();
    this.cameraTarget = new THREE.Vector3();
    this.projectedPosition = new THREE.Vector3();
    this.cameraDirection = new THREE.Vector3();
    this.terrainKey = '';
    this.sky = new SkyMesh();
    this.sky.scale.setScalar(35000);
    this.sky.turbidity.value = 3;
    this.sky.rayleigh.value = 1.2;
    this.sky.cloudScale.value = 0.00012;
    this.sky.cloudDensity.value = 0.65;
    this.scene.add(this.sky);
    this.light = new THREE.DirectionalLight(0xffe1b7, 3);
    this.light.castShadow = true;
    this.light.shadow.camera.left = this.light.shadow.camera.bottom = -160;
    this.light.shadow.camera.right = this.light.shadow.camera.top = 160;
    this.light.shadow.camera.near = 10;
    this.light.shadow.camera.far = 1100;
    this.light.shadow.bias = -0.0002;
    this.light.shadow.normalBias = 0.15;
    this.scene.add(this.light);
    this.ambient = new THREE.HemisphereLight(0xd0e4ea, 0x164147, 2);
    this.scene.add(this.ambient);
    this.ocean = new Ocean(this.scene, this.config, this.light, sim.water);
    this.ocean.wetMaterials(this.sub, sim.waterMotion);
    // Reuse one map for PBR hulls and the custom ocean shader.
    this.light.shadow.shadowNode = this.ocean.sunShadow;
    const mirrorUpdate = this.ocean.mirror.reflector.updateBefore.bind(this.ocean.mirror.reflector);
    this.ocean.mirror.reflector.updateBefore = (...args) => {
      if (this.config.graphics.reflections && !this.underwater) return mirrorUpdate(...args);
    };
    this.createParticles();
  }
  async init(boot) {
    if (boot) {
      const previous = THREE.getConsoleFunction();
      THREE.setConsoleFunction((level, message, ...details) => {
        if (previous) previous(level, message, ...details);
        else console[level](message, ...details);
        if (level !== 'error') return;
        // Three.js records pipeline failures but can resolve compileAsync anyway.
        // Keep initialization fallback possible; later shader/draw errors are fatal.
        if (boot.report.stage === 'RENDER' && boot.report.status === 'starting')
          boot.note('RENDER-DIAGNOSTIC', new Error(message));
        else
          boot.fail(
            boot.report.status === 'ready' ? 'RUN-GPU' : `${boot.report.stage}-FAIL`,
            new Error(message),
          );
      });
    }
    const stage = (code, operation) => (boot ? boot.stage(code, operation) : operation());
    await stage('RENDER', async () => {
      const forceWebGL =
        boot?.report.renderer === 'WebGL 2' ||
        new URLSearchParams(location.search).get('renderer') === 'webgl';
      this.renderer = new THREE.WebGPURenderer({
        canvas: this.canvas,
        antialias: true,
        forceWebGL,
        powerPreference: 'high-performance',
      });
      try {
        await this.renderer.init();
      } catch (error) {
        if (forceWebGL) throw error;
        boot?.note('RENDER-FALLBACK', error);
        this.renderer.dispose();
        const freshCanvas = this.canvas.cloneNode(false);
        this.canvas.replaceWith(freshCanvas);
        this.canvas = freshCanvas;
        this.renderer = new THREE.WebGPURenderer({ canvas: this.canvas, antialias: true, forceWebGL: true });
        await this.renderer.init();
      }
      this.backend = this.renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2';
      const info = this.renderer.backend.device?.adapterInfo;
      if (info)
        this.adapter = {
          vendor: info.vendor,
          architecture: info.architecture,
          description: info.description,
          software:
            info.isFallbackAdapter ||
            /swiftshader|llvmpipe|software/i.test(`${info.architecture} ${info.description}`),
        };
      else {
        const gl = this.renderer.backend.gl,
          extension = gl?.getExtension('WEBGL_debug_renderer_info');
        const description = extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'WebGL adapter';
        this.adapter = {
          description,
          software: /swiftshader|llvmpipe|software|basic render/i.test(description),
        };
      }
      if (this.backend === 'WebGPU')
        this.renderer.backend.device.lost.then((info) => {
          window.dispatchEvent(new CustomEvent('greywake:gpu-lost', { detail: info }));
        });
      if (boot && this.backend === 'WebGPU')
        this.renderer.backend.device.addEventListener('uncapturederror', (event) =>
          boot.fail('GPU-VALIDATION', event.error),
        );
      boot?.update({ renderer: this.backend, adapter: this.adapter });
    });
    await stage('SKY', () => {
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = this.config.graphics.exposure;
      this.updateSun();
      this.sky.sunPosition.value.copy(this.sun).multiplyScalar(20000);
      this.sky.cloudCoverage.value = this.config.ocean.cloudCover;
      this.environmentScene = new THREE.Scene();
      this.environmentScene.add(this.sky.clone());
      this.environmentGenerator = new THREE.PMREMGenerator(this.renderer);
      this.resize();
      this.applySettings();
      this.environmentTarget = this.environmentGenerator.fromScene(this.environmentScene, 0.03, 0.1, 40000, {
        size: 128,
      });
      this.scene.environment = this.environmentTarget.texture;
      this.environmentSun.copy(this.sun);
      this.lastEnvironmentUpdate = performance.now();
      this.environmentCloud = this.sky.cloudCoverage.value;
      this.resize();
      this.applySettings();
      this.camera.position.set(-60, 36, 100);
      this.camera.lookAt(0, 0, -15);
    });
    await stage('SHDR', () => this.renderer.compileAsync(this.scene, this.camera));
  }
  resize() {
    this.renderer.setPixelRatio(this.config.graphics.pixelRatio);
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.ocean.resize(this.canvas.width, this.canvas.height);
  }
  applySettings(rebuild = false) {
    if (!this.renderer) return;
    this.resize();
    this.renderer.toneMappingExposure = this.config.graphics.exposure;
    this.renderer.shadowMap.enabled = this.config.graphics.shadows;
    // Toggle the renderer, keeping the shared shadow node alive in cached hull/water shaders.
    const size = Math.round(this.config.graphics.shadowResolution);
    if (size !== this.light.shadow.mapSize.x) {
      this.light.shadow.map?.setSize(size, size);
      this.light.shadow.mapSize.set(size, size);
      this.light.shadow.needsUpdate = true;
    }
    this.camera.far = this.config.graphics.viewDistance * 2.2;
    this.camera.updateProjectionMatrix();
    if (rebuild) this.ocean.rebuild();
    this.sim.water.resizeInteractions();
    this.ocean.bindSurface(this.sim.water);
  }
  clearWorldVisuals() {
    this.trails.clear();
    for (const model of this.shipModels.values()) {
      this.scene.remove(model);
      for (const material of model.userData.waterMaterials || []) material.dispose();
    }
    this.shipModels.clear();
    this.particles = [];
    this.spray.count = this.foam.count = this.smoke.count = this.bubbles.count = 0;
    this.tracers.count = this.fireballs.count = 0;
    this.emission = 0;
    this.terrainKey = '';
  }
  updateSun() {
    const clock = worldClock(this.sim.p, this.config),
      direction = sunlight(clock.hour, -this.sim.p.z / 111000);
    this.sun.set(direction.x, direction.y, direction.z).normalize();
    this.sunColor.setHSL(0.1, 0.25 + (1 - Math.max(0, this.sun.y)) * 0.35, 0.75);
  }
  refreshEnvironment() {
    const now = performance.now();
    if (
      this.underwater ||
      now - this.lastEnvironmentUpdate < this.config.graphics.environmentRefresh * 1000 ||
      (this.environmentSun.dot(this.sun) > 0.985 &&
        Math.abs(this.sky.cloudCoverage.value - this.environmentCloud) < 0.06)
    )
      return;
    const disc = this.sky.showSunDisc.value;
    this.sky.showSunDisc.value = 0;
    this.environmentGenerator.fromScene(this.environmentScene, 0.03, 0.1, 40000, {
      size: 128,
      renderTarget: this.environmentTarget,
    });
    this.sky.showSunDisc.value = disc;
    this.environmentSun.copy(this.sun);
    this.lastEnvironmentUpdate = now;
    this.environmentCloud = this.sky.cloudCoverage.value;
  }
  createParticles() {
    this.particles = [];
    this.capacity = 1800;
    const mat = new THREE.MeshBasicMaterial({
      color: 0xe1eee8,
      transparent: true,
      opacity: 0.6,
      reflectivity: 0,
      depthWrite: false,
      map: dropletTexture(),
      alphaTest: 0.005,
    });
    this.spray = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, this.capacity);
    this.spray.frustumCulled = false;
    this.spray.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.spray);
    this.dummy = new THREE.Object3D();
    this.rng = random(1942);
    this.emission = 0;
    this.foam = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: 0xc2ddd5,
        transparent: true,
        opacity: 0.25,
        reflectivity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        alphaMap: this.ocean.foamMap.value,
        alphaTest: 0.015,
      }),
      1200,
    );
    this.foam.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.foam.frustumCulled = false;
    this.scene.add(this.foam);
    this.bubbles = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: 0x9bbfba,
        map: dropletTexture('bubble'),
        transparent: true,
        opacity: 0.5,
        reflectivity: 0,
        depthWrite: false,
        alphaTest: 0.005,
      }),
      500,
    );
    this.bubbles.count = 0;
    this.bubbles.frustumCulled = false;
    this.bubbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.bubbles);
    this.smoke = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0x2b3537, transparent: true, opacity: 0.18, depthWrite: false }),
      180,
    );
    this.smoke.frustumCulled = false;
    this.scene.add(this.smoke);
    this.tracers = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 6, 4),
      new THREE.MeshBasicMaterial({ color: 0xffbf61, toneMapped: false }),
      40,
    );
    this.tracers.frustumCulled = false;
    this.scene.add(this.tracers);
    this.fireballs = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xff922f, toneMapped: false, transparent: true, opacity: 0.8 }),
      20,
    );
    this.fireballs.frustumCulled = false;
    this.scene.add(this.fireballs);
  }
  emit(x, z, kind = 'spray', size = 1, options = {}) {
    if (this.particles.length >= this.config.graphics.particles) return;
    const r = this.rng;
    this.particles.push({
      x,
      z,
      y: options.y ?? this.sim.sampleWater(x, z) + 0.5,
      vx: options.vx ?? (r() - 0.5) * 4,
      vy: options.vy ?? (kind === 'smoke' || kind === 'bubble' ? 1 + r() * 2 : 2 + r() * 5),
      vz: options.vz ?? (r() - 0.5) * 4,
      age: 0,
      life: options.life ?? (kind === 'smoke' || kind === 'bubble' ? 10 : 1.2 + r()),
      kind,
      size,
      stretch: options.stretch ?? 1,
    });
  }
  trail(id, x, z, speed, width, dt) {
    let trail = this.trails.get(id);
    if (!trail) {
      trail = [];
      this.trails.set(id, trail);
    }
    const last = trail[trail.length - 1];
    if (speed > 0.4 && (!last || Math.hypot(deltaX(x, last.x), z - last.z) > 4))
      trail.push({ x, z, width, age: 0 });
    for (const p of trail) p.age += dt;
    while (
      trail.length &&
      (trail[0].age > this.config.ocean.wakeLength / Math.max(3, speed) || trail.length > 160)
    )
      trail.shift();
  }
  updateTerrain() {
    const p = this.sim.p,
      step = 800,
      key = `${Math.floor(p.x / 6000)},${Math.floor(p.z / 6000)}`;
    if (key === this.terrainKey) {
      if (this.terrain)
        this.terrain.position.set(deltaX(this.terrainOrigin.x, p.x), 0, this.terrainOrigin.z - p.z);
      return;
    }
    this.terrainKey = key;
    if (this.terrain) {
      this.scene.remove(this.terrain);
      this.terrain.geometry.dispose();
      this.terrain.material.dispose();
      this.terrain = null;
    }
    const vertices = [],
      colors = [],
      indices = [],
      size = 40;
    const origin = { x: Math.floor(p.x / step) * step, z: Math.floor(p.z / step) * step };
    for (let z = 0; z <= size; z++)
      for (let x = 0; x <= size; x++) {
        const wx = origin.x + (x - size / 2) * step,
          wz = origin.z + (z - size / 2) * step,
          land = isLand(wx, wz);
        const h = land
          ? 15 +
            80 * Math.abs(Math.sin(wx / 6300) * Math.cos(wz / 3800)) +
            100 * Math.abs(Math.sin(wx / 3700 + wz / 2600))
          : -30;
        vertices.push((x - size / 2) * step, h, (z - size / 2) * step);
        const c = new THREE.Color(land ? 0x3a4e43 : 0x72756a);
        colors.push(c.r, c.g, c.b);
      }
    for (let z = 0; z < size; z++)
      for (let x = 0; x < size; x++) {
        const a = z * (size + 1) + x,
          b = a + size + 1;
        if (
          vertices[a * 3 + 1] > 0 ||
          vertices[b * 3 + 1] > 0 ||
          vertices[(a + 1) * 3 + 1] > 0 ||
          vertices[(b + 1) * 3 + 1] > 0
        )
          indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    if (!indices.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    this.terrain = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    this.terrainOrigin = origin;
    this.terrain.position.set(deltaX(origin.x, p.x), 0, origin.z - p.z);
    this.scene.add(this.terrain);
  }
  render(dt, attract = false, wallDt = dt) {
    const cpuStart = performance.now();
    const sim = this.sim,
      p = sim.p,
      c = this.config;
    this.frameCount++;
    this.frameTime += wallDt;
    if (this.frameTime > 1) {
      this.fps = this.frameCount / this.frameTime;
      this.frameMs = (this.frameTime / this.frameCount) * 1000;
      this.frameCount = 0;
      this.frameTime = 0;
    }
    this.updateSun();
    this.sky.sunPosition.value.copy(this.sun).multiplyScalar(20000);
    this.sky.cloudCoverage.value = clamp(c.ocean.cloudCover + sim.weather * 0.3, 0, 1);
    this.sky.cloudSpeed.value = 0.00004 * c.ocean.waveSpeed;
    this.light.position.copy(this.sun).multiplyScalar(500);
    this.light.color.copy(this.sunColor);
    this.light.intensity = Math.max(0.15, this.sun.y * 4.5);
    this.ambient.intensity = Math.max(0.18, 0.65 + this.sun.y * 1.2);
    this.scene.environmentIntensity = Math.max(0.06, 0.3 + this.sun.y * 0.7);
    const fxDt = sim.paused || p.hp <= 0 ? 0 : dt;
    const motion = attract ? this.attractMotion : sim.waterMotion;
    let bodyY = sim.body.translation().y;
    if (attract) {
      const sea = hullWaterPose(sim, p, 66, 6, motion, dt),
        goal = -2 - p.depth + sea * Math.max(0, 1 - p.depth / 5);
      this.attractHeave += (goal - this.attractHeave) * (1 - Math.exp(-dt * 2));
      bodyY = this.attractHeave;
    }
    const opticalY = Math.max(bodyY + 12.4, 1.8),
      extension = Math.max(0, opticalY - bodyY - 12.4),
      scopeAvailable = p.targetDepth <= 18 && p.depth >= 5 && p.depth <= 18;
    this.scopeExtension.visible = this.scopeEye.visible = scopeAvailable && extension > 0.03;
    this.scopeExtension.position.set(-0.7, 12.4 + extension * 0.5, 0.3);
    this.scopeExtension.scale.y = Math.max(0.01, extension);
    this.scopeEye.position.set(-0.7, 12.4 + extension, 0.3);
    this.sub.position.set(0, bodyY, 0);
    this.sub.rotation.set(motion.pitch, -p.heading, motion.roll);
    this.sub.userData.waterWetness.value = p.depth > 3 ? 1 : sim.waterMotion.wetness;
    for (const [id, model] of this.shipModels)
      if (!sim.ships.some((s) => s.id === id)) {
        this.scene.remove(model);
        for (const material of model.userData.waterMaterials || []) material.dispose();
        this.shipModels.delete(id);
      }
    for (const ship of sim.ships) {
      let model = this.shipModels.get(ship.id);
      if (!model) {
        model = (ship.escort ? this.models.escort : this.models.merchant).clone();
        this.ocean.wetMaterials(model, ship.motion);
        this.shipModels.set(ship.id, model);
        this.scene.add(model);
        model.scale.set(1, 1, ship.length / 115);
      }
      model.position.set(deltaX(ship.x, p.x), ship.y, ship.z - p.z);
      const shipMotion = attract ? (model.userData.attractMotion ||= newWaterMotion()) : ship.motion;
      if (attract)
        model.position.y =
          hullWaterPose(sim, ship, ship.length, ship.width, shipMotion, dt) - ship.sinkTime * 0.2;
      model.rotation.set(shipMotion.pitch, -ship.heading, shipMotion.roll + ship.sinkTime * 0.006);
      model.userData.waterWetness.value = ship.hp <= 0 ? 1 : ship.motion.wetness;
      model.visible = Math.hypot(model.position.x, model.position.z) < c.graphics.viewDistance;
      if (ship.hp > 0)
        this.trail(
          ship.id,
          ship.x - Math.sin(ship.heading) * ship.length * 0.42,
          ship.z + Math.cos(ship.heading) * ship.length * 0.42,
          sim.effectiveShipSpeed(ship),
          ship.width,
          fxDt,
        );
    }
    this.trail(
      'player',
      p.x - Math.sin(p.heading) * 29,
      p.z + Math.cos(p.heading) * 29,
      p.depth < 4 ? p.speed : 0,
      5,
      fxDt,
    );
    for (const t of sim.torpedoes) this.trail(`torp${t.id}`, t.x, t.z, c.combat.torpedoSpeed, 0.8, fxDt);
    this.emission += fxDt;
    if (this.emission > 0.05) {
      this.emission = 0;
      for (const event of sim.water.sprayEvents.splice(0)) {
        for (const side of [-1, 1]) {
          for (let i = 0; i < Math.ceil(event.strength * 4); i++) {
            const lateral = side * (2 + this.rng() * 3) * event.strength;
            this.emit(
              p.x + event.x - sim.oceanX + Math.cos(event.heading) * side * event.width * 0.3,
              event.z + Math.sin(event.heading) * side * event.width * 0.3,
              'spray',
              0.3 + event.strength * 0.4,
              {
                y: event.y + 0.2,
                vx: Math.cos(event.heading) * lateral + Math.sin(event.heading) * p.speed * 0.3,
                vz: Math.sin(event.heading) * lateral - Math.cos(event.heading) * p.speed * 0.3,
                vy: 2 + this.rng() * event.strength * 7,
              },
            );
          }
        }
      }
      for (const s of sim.ships)
        if (Math.hypot(deltaX(s.x, p.x), s.z - p.z) < 2500) {
          if (s.hp <= 0 && this.rng() > 0.3)
            this.emit(
              s.x + (this.rng() - 0.5) * s.width,
              s.z + (this.rng() - 0.5) * s.length * 0.5,
              'bubble',
              0.5 + this.rng(),
              { y: s.y - 2, vy: 1.5 + this.rng() * 2, life: 12 },
            );
          if (this.rng() > 0.65) {
            this.emit(
              s.x - Math.sin(s.heading) * 23,
              s.z + Math.cos(s.heading) * 23,
              'smoke',
              s.hp <= 0 ? 4 : 1.8,
            );
            const smoke = this.particles[this.particles.length - 1];
            if (smoke?.kind === 'smoke') smoke.y = 17 - s.sinkTime * 0.15;
          }
        }
      for (const e of sim.effects)
        if (e.type === 'water-impact') {
          const attenuation = Math.exp(-e.depth / 28),
            shell = e.kind === 'shell';
          if (e.age < (shell ? 0.35 : 0.9)) {
            for (let i = 0; i < (shell ? 5 : 12); i++) {
              const angle = this.rng() * Math.PI * 2,
                radius = (shell ? 1.3 : 5) * this.rng(),
                energy = Math.sqrt(e.energy) * attenuation;
              if (energy > 0.12)
                this.emit(
                  e.x + Math.cos(angle) * radius,
                  e.z + Math.sin(angle) * radius,
                  'spray',
                  (shell ? 0.6 + this.rng() * 0.6 : 2.5 + this.rng() * 2.5) * energy,
                  {
                    vx: Math.cos(angle) * (shell ? 2 : 8) * energy,
                    vz: Math.sin(angle) * (shell ? 2 : 8) * energy,
                    vy: (shell ? 12 : 20) * energy * (0.5 + this.rng()),
                    life: shell ? 2 : 4,
                    stretch: shell ? 1.6 : 1.4 + this.rng() * 0.8,
                  },
                );
              if (!shell)
                this.emit(
                  e.x + Math.cos(angle) * radius,
                  e.z + Math.sin(angle) * radius,
                  'bubble',
                  0.3 + this.rng(),
                  { y: -e.depth, vy: 2 + this.rng() * 3, life: 15 },
                );
            }
          }
        }
    }
    let sprayN = 0,
      smokeN = 0,
      bubbleN = 0;
    for (const particle of this.particles) {
      particle.age += fxDt;
      particle.x += particle.vx * fxDt;
      particle.z += particle.vz * fxDt;
      particle.y += particle.vy * fxDt;
      if (particle.kind === 'spray') particle.vy -= 9.81 * fxDt;
      if (particle.kind === 'bubble' && particle.y >= sim.sampleWater(particle.x, particle.z)) {
        particle.age = particle.life;
      }
      this.dummy.position.set(deltaX(particle.x, p.x), particle.y, particle.z - p.z);
      this.dummy.quaternion.copy(this.camera.quaternion);
      const scale =
        particle.size *
        (particle.kind === 'smoke'
          ? 1 + particle.age * 0.4
          : Math.max(0.1, 1 - particle.age / particle.life));
      this.dummy.scale.set(scale * (particle.kind === 'spray' ? 0.65 : 1), scale * particle.stretch, scale);
      this.dummy.updateMatrix();
      if (particle.kind === 'smoke' && smokeN < 180) this.smoke.setMatrixAt(smokeN++, this.dummy.matrix);
      else if (particle.kind === 'spray' && sprayN < this.capacity)
        this.spray.setMatrixAt(sprayN++, this.dummy.matrix);
      else if (particle.kind === 'bubble' && bubbleN < 500)
        this.bubbles.setMatrixAt(bubbleN++, this.dummy.matrix);
    }
    this.particles = this.particles
      .filter((q) => q.age < q.life && (q.kind === 'bubble' || q.y > -2))
      .slice(-c.graphics.particles);
    this.spray.count = sprayN;
    this.smoke.count = smokeN;
    this.bubbles.count = bubbleN;
    this.spray.instanceMatrix.needsUpdate = true;
    this.smoke.instanceMatrix.needsUpdate = true;
    this.bubbles.instanceMatrix.needsUpdate = true;
    let foamN = 0;
    for (const [id, trail] of this.trails) {
      const active =
        id === 'player' ||
        sim.ships.some((s) => s.id === id) ||
        sim.torpedoes.some((t) => `torp${t.id}` === id);
      if (!active) {
        for (const q of trail) q.age += fxDt;
        if (!trail.length || trail[0].age > 100) this.trails.delete(id);
      }
      for (let i = 0; i < trail.length && foamN < 1200; i++) {
        const q = trail[i],
          fade = Math.max(0, 1 - q.age / 75),
          size = q.width * (0.7 + q.age * 0.015) * fade * c.graphics.foam;
        if (
          Math.abs(deltaX(q.x, p.x)) < sim.water.interactions.size * 0.35 &&
          Math.abs(q.z - p.z) < sim.water.interactions.size * 0.35
        )
          continue;
        this.dummy.position.set(deltaX(q.x, p.x), sim.sampleWater(q.x, q.z) + 0.12, q.z - p.z);
        this.dummy.rotation.set(-Math.PI / 2, 0, i * 0.83);
        this.dummy.scale.set(size, size * 2, 1);
        this.dummy.updateMatrix();
        this.foam.setMatrixAt(foamN++, this.dummy.matrix);
      }
    }
    this.foam.count = foamN;
    this.foam.instanceMatrix.needsUpdate = true;
    let tracerN = 0,
      fireballN = 0;
    for (const e of sim.effects) {
      if (e.type === 'shell' && tracerN < 40) {
        const t = Math.min(1, e.age / e.life);
        this.dummy.position.set(
          deltaX(e.x + deltaX(e.targetX, e.x) * t, p.x),
          5 + Math.sin(t * Math.PI) * Math.max(2, (9.81 * e.life * e.life) / 8),
          e.z + (e.targetZ - e.z) * t - p.z,
        );
        this.dummy.scale.setScalar(0.6);
        this.dummy.updateMatrix();
        this.tracers.setMatrixAt(tracerN++, this.dummy.matrix);
      }
      if (e.type === 'explosion' && e.age < 0.8 && fireballN < 20) {
        this.dummy.position.set(deltaX(e.x, p.x), 3 + e.age * 5, e.z - p.z);
        this.dummy.scale.setScalar(Math.sin((e.age / 0.8) * Math.PI) * 11);
        this.dummy.updateMatrix();
        this.fireballs.setMatrixAt(fireballN++, this.dummy.matrix);
      }
    }
    this.tracers.count = tracerN;
    this.fireballs.count = fireballN;
    this.tracers.instanceMatrix.needsUpdate = true;
    this.fireballs.instanceMatrix.needsUpdate = true;
    const orbit = this.orbit + (attract ? Math.sin(performance.now() * 0.00008) * 0.15 : 0),
      angle = p.heading + orbit;
    const distance = c.graphics.cameraDistance * (this.mode === 'chase' && p.depth > 25 ? 0.6 : 1);
    const cameraPos = this.cameraPosition.set(
      -Math.sin(angle) * distance,
      bodyY + c.graphics.cameraHeight * (p.depth > 25 && this.mode === 'chase' ? 0.65 : 1) + this.elevation,
      Math.cos(angle) * distance,
    );
    const look = this.cameraTarget.set(Math.sin(p.heading) * 12, bodyY + 2, -Math.cos(p.heading) * 12);
    if (this.mode === 'periscope') {
      cameraPos.set(0, Math.max(1.8, bodyY + 12), 0);
      look.set(Math.sin(p.heading + orbit) * 1000, cameraPos.y, -Math.cos(p.heading + orbit) * 1000);
    }
    if (this.mode === 'tactical') {
      cameraPos.set(0, 650, 200);
      look.set(0, 0, -80);
    }
    this.camera.position.lerp(cameraPos, 1 - Math.exp(-dt * 3.5));
    this.camera.lookAt(look);
    const surfaceHeight = sim.sampleWater(p.x + this.camera.position.x, p.z + this.camera.position.z);
    this.underwater = this.camera.position.y < surfaceHeight - 0.4;
    const immersion = clamp((surfaceHeight - this.camera.position.y + 0.15) / 0.9, 0, 1);
    this.underwaterBlend += (immersion - this.underwaterBlend) * (1 - Math.exp(-dt * 12));
    this.scene.fog.color.copy(this.airFogColor).lerp(this.underwaterBackground, this.underwaterBlend);
    this.scene.fog.density =
      ((1 + sim.weather * 2) / c.graphics.viewDistance) * 0.48 * (1 - this.underwaterBlend) +
      (0.8 / c.ocean.clarity) * this.underwaterBlend;
    this.scene.background = this.underwater ? this.underwaterBackground : null;
    this.sky.visible = !this.underwater;
    this.ocean.cameraUnderwater = this.underwater;
    this.refreshEnvironment();
    this.sub.visible = this.mode !== 'periscope';
    this.ocean.update(sim, this.sun, this.sunColor);
    const port = sim.nearestPort();
    this.portBuoy.visible = geoDistance(sim.p, port) < c.graphics.viewDistance;
    this.portBuoy.position.set(
      deltaX(port.x + 80, p.x),
      sim.sampleWater(port.x + 80, port.z + 80),
      port.z + 80 - p.z,
    );
    this.portBuoy.rotation.x = Math.sin(sim.visualTime * 0.9) * 0.07;
    this.portBuoy.rotation.z = Math.sin(sim.visualTime * 0.6) * 0.05;
    this.updateTerrain();
    this.ocean.captureRefraction(this.renderer, this.camera);
    this.renderer.render(this.scene, this.camera);
    this.cpuMs = performance.now() - cpuStart;
  }
  diagnostics() {
    return {
      backend: this.backend,
      adapter: this.adapter,
      startup: window.gameBoot?.snapshot(),
      cameraUnderwater: this.underwater,
      fps: this.fps,
      frameMs: this.frameMs,
      cpuSubmitMs: this.cpuMs,
      resolution: { width: this.canvas.width, height: this.canvas.height },
      render: { ...this.renderer.info.render },
      memory: { ...this.renderer.info.memory },
      shaderStates: this.renderer._nodes.nodeBuilderCache.size,
      graphics: { ...this.config.graphics },
      water: {
        spectrumResolution: this.sim.water.cascades[0].resolution,
        cascadeSizes: this.sim.water.cascades.map((cascade) => cascade.size),
        interactionResolution: this.sim.water.interactions.resolution,
        interactionSize: this.sim.water.interactions.size,
        interactionActive: this.sim.water.interactions.active,
        meshVertices: this.ocean.meshes.map((mesh) => mesh.geometry.getAttribute('position').count),
        refractionEnabled: this.config.graphics.waterRefraction,
        refractionSize: {
          width: this.ocean.refractionTarget.width,
          height: this.ocean.refractionTarget.height,
        },
        activeImpacts: this.sim.water.impacts.length,
        particles: { spray: this.spray.count, bubbles: this.bubbles.count, foam: this.foam.count },
      },
      userAgent: navigator.userAgent,
    };
  }
  screenPosition(x, y, z) {
    const v = this.projectedPosition.set(deltaX(x, this.sim.p.x), y, z - this.sim.p.z);
    this.camera.getWorldDirection(this.cameraDirection);
    if (
      (v.x - this.camera.position.x) * this.cameraDirection.x +
        (v.y - this.camera.position.y) * this.cameraDirection.y +
        (v.z - this.camera.position.z) * this.cameraDirection.z <
      0
    )
      return null;
    v.project(this.camera);
    if (Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) return null;
    return { x: ((v.x + 1) * innerWidth) / 2, y: ((1 - v.y) * innerHeight) / 2 };
  }
}
