import {
  abs,
  attribute,
  cameraFar,
  cameraNear,
  cameraPosition,
  clamp,
  cos,
  dFdx,
  dFdy,
  dot,
  exp,
  Fn,
  float,
  If,
  log2,
  max,
  min,
  mix,
  normalize,
  normalWorld,
  perspectiveDepthToViewZ,
  pmremTexture,
  positionGeometry,
  positionView,
  positionWorld,
  pow,
  reflect,
  reflector,
  refract,
  shadow,
  sin,
  smoothstep,
  sqrt,
  texture,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
  viewportUV,
} from 'three/tsl';
import * as THREE from 'three/webgpu';
import {
  floatTexture,
  foamTexture,
  resizeFloatTexture,
  rippleTexture,
  uploadFloatTexture,
} from './water-textures.js';
import { deltaX, TAU, WAVES } from './world.js';

function grid(size, segments, hole = 0) {
  const vertices = [],
    indices = [],
    uvs = [];
  for (let z = 0; z <= segments; z++)
    for (let x = 0; x <= segments; x++)
      vertices.push((x / segments - 0.5) * size, 0, (z / segments - 0.5) * size);
  for (let z = 0; z < segments; z++)
    for (let x = 0; x < segments; x++) {
      const px = ((x + 0.5) / segments - 0.5) * size,
        pz = ((z + 0.5) / segments - 0.5) * size;
      if (hole && Math.abs(px) < hole / 2 && Math.abs(pz) < hole / 2) continue;
      const a = z * (segments + 1) + x,
        b = a + segments + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  // Vertical skirts cover the small interpolation differences at nested mesh edges.
  for (const extent of hole ? [size / 2, hole / 2] : [size / 2]) {
    const count = Math.round((extent * 2) / (size / segments));
    for (let side = 0; side < 4; side++)
      for (let j = 0; j < count; j++) {
        const a = -extent + (j / count) * extent * 2,
          b = -extent + ((j + 1) / count) * extent * 2;
        const coords =
          side === 0
            ? [
                [a, -extent],
                [b, -extent],
              ]
            : side === 1
              ? [
                  [extent, a],
                  [extent, b],
                ]
              : side === 2
                ? [
                    [b, extent],
                    [a, extent],
                  ]
                : [
                    [-extent, b],
                    [-extent, a],
                  ];
        const i = vertices.length / 3;
        vertices.push(
          coords[0][0],
          0,
          coords[0][1],
          coords[1][0],
          0,
          coords[1][1],
          coords[0][0],
          -3,
          coords[0][1],
          coords[1][0],
          -3,
          coords[1][1],
        );
        indices.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
      }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  for (let i = 0; i < vertices.length; i += 3)
    uvs.push(vertices[i] / size + 0.5, vertices[i + 2] / size + 0.5);
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute(
    'waterSpacing',
    new THREE.Float32BufferAttribute(new Float32Array(vertices.length / 3).fill(size / segments), 1),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export class Ocean {
  constructor(scene, config, sunLight, surface) {
    this.scene = scene;
    this.config = config;
    this.surface = surface;
    this.meshes = [];
    this.sunShadow = sunLight ? shadow(sunLight) : null;
    this.height = uniform(config.ocean.waveHeight);
    this.detail = uniform(config.graphics.detailWaves);
    this.foam = uniform(config.graphics.foam);
    this.wakeStrength = uniform(config.ocean.wakeStrength);
    this.wakeLength = uniform(config.ocean.wakeLength);
    this.sun = uniform(new THREE.Vector3(-0.55, 0.38, -0.74).normalize());
    this.sunColor = uniform(new THREE.Color(0xffd9a4));
    this.daylight = uniform(1);
    this.wind = uniform(0.4);
    this.weather = uniform(0);
    this.crestLight = uniform(config.ocean.crestLight);
    this.underwater = uniform(0);
    this.clarity = uniform(config.ocean.clarity);
    this.phases = WAVES.map(() => uniform(0));
    this.microTime = uniform(0);
    this.worldOffset = uniform(new THREE.Vector2());
    this.rippleOffset = uniform(new THREE.Vector2());
    this.rippleOffset1 = uniform(new THREE.Vector2());
    this.foamOffset1 = uniform(new THREE.Vector2());
    this.rippleMap = texture(rippleTexture());
    this.foamMap = texture(foamTexture());
    this.bands = [512, 128, 32].map((size) => ({
      size,
      amplitude: uniform(0),
      offset: uniform(new THREE.Vector2()),
      texel: uniform(0),
      displacement: texture(floatTexture(surface.cascades[0].resolution, true, true)),
      normals: texture(floatTexture(surface.cascades[0].resolution, true, true)),
    }));
    this.field = texture(floatTexture(surface.interactions.resolution, false));
    this.fieldCenter = uniform(new THREE.Vector2());
    this.fieldTexel = uniform(0);
    this.fieldSize = uniform(surface.interactions.size);
    this.wakes = Array.from({ length: 12 }, () => ({
      data: uniform(new THREE.Vector4(0, 0, 0, 0)),
      size: uniform(new THREE.Vector4(1, 1, 0, 0)),
    }));
    this.impacts = Array.from({ length: 8 }, () => ({
      data: uniform(new THREE.Vector4(0, 0, 0, 0)),
      shape: uniform(new THREE.Vector4(7, 16, 0, 0)),
    }));
    this.impactSample = Fn(([p]) => {
      const result = vec4(0).toVar();
      for (const impact of this.impacts) {
        const direction = p.sub(impact.data.xy),
          bound = impact.data.z.mul(impact.shape.y).add(impact.shape.x.mul(4));
        If(
          impact.data.w.greaterThan(0.0001).and(dot(direction, direction).lessThan(bound.mul(bound))),
          () => {
            const radius = direction.length(),
              delta = radius.sub(impact.data.z.mul(impact.shape.y)),
              band = exp(delta.pow(2).div(impact.shape.x.pow(2)).negate()),
              phase = delta.mul(0.3),
              height = sin(phase).mul(band).mul(impact.data.w),
              derivative = cos(phase)
                .mul(0.3)
                .sub(sin(phase).mul(delta).mul(2).div(impact.shape.x.pow(2)))
                .mul(band)
                .mul(impact.data.w),
              slope = direction.div(max(radius, 0.01)).mul(derivative);
            const foam = exp(radius.pow(2).mul(-1 / 225))
              .mul(exp(impact.data.z.mul(-0.2)))
              .add(band.mul(exp(impact.data.z.mul(-0.125))))
              .mul(impact.shape.z);
            result.addAssign(vec4(height, slope.x, slope.y, foam));
          },
        );
      }
      return result;
    });
    const target = new THREE.Object3D();
    target.rotation.x = -Math.PI / 2;
    scene.add(target);
    this.mirror = reflector({ target, resolutionScale: config.graphics.reflectionScale, bounces: false });
    this.mirror.reflector.forceUpdate = true;
    this.baseReflectionUV = this.mirror.uvNode;
    this.reflectionEnabled = uniform(config.graphics.reflections ? 1 : 0);
    this.refractionTarget = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true });
    this.refractionTarget.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    this.refraction = texture(this.refractionTarget.texture);
    this.refractionDepth = texture(this.refractionTarget.depthTexture);
    this.refractionEnabled = uniform(0);
    this.localSample = Fn(([p]) => {
      const coords = p.sub(this.fieldCenter).div(this.fieldSize).add(0.5),
        mask = float(1).sub(smoothstep(0.46, 0.5, max(abs(coords.x.sub(0.5)), abs(coords.y.sub(0.5)))));
      return this.field
        .sample(coords.add(this.fieldTexel.mul(0.5)))
        .level(0)
        .mul(mask);
    });
    this.heightAt = Fn(([p]) => {
      const q = p.toVar();
      for (let iteration = 0; iteration < 2; iteration++) {
        const horizontal = vec2(0).toVar();
        for (const band of this.bands)
          horizontal.addAssign(
            band.displacement
              .sample(q.div(band.size).add(band.offset).add(band.texel.mul(0.5)))
              .level(0)
              .xz.mul(band.amplitude),
          );
        q.assign(p.sub(horizontal));
      }
      const result = float(0).toVar();
      WAVES.forEach(([length, amp, dx, dz], i) => {
        result.addAssign(
          sin(
            q.x
              .mul((dx * TAU) / length)
              .add(q.y.mul((dz * TAU) / length))
              .add(this.phases[i]),
          )
            .mul(amp)
            .mul(this.height),
        );
      });
      for (const band of this.bands)
        result.addAssign(
          band.displacement
            .sample(q.div(band.size).add(band.offset).add(band.texel.mul(0.5)))
            .level(0)
            .y.mul(band.amplitude),
        );
      return result.add(this.localSample(p).x.mul(this.wakeStrength)).add(this.impactSample(p).x);
    });
    const displacement = Fn(([p]) => {
      const result = vec3(p.x, p.y, p.z).toVar(),
        spacing = attribute('waterSpacing', 'float');
      WAVES.forEach(([length, amp, dx, dz], i) => {
        result.y.addAssign(
          sin(
            p.x
              .mul((dx * TAU) / length)
              .add(p.z.mul((dz * TAU) / length))
              .add(this.phases[i]),
          )
            .mul(amp)
            .mul(this.height)
            .mul(smoothstep(spacing.mul(2), spacing.mul(4), length)),
        );
      });
      for (const band of this.bands) {
        const d = band.displacement
          .sample(p.xz.div(band.size).add(band.offset).add(band.texel.mul(0.5)))
          .level(max(0, log2(spacing.div(band.size).div(band.texel))));
        result.addAssign(d.xyz.mul(band.amplitude));
      }
      result.y.addAssign(this.localSample(result.xz).x.mul(this.wakeStrength));
      result.y.addAssign(this.impactSample(result.xz).x);
      return result;
    });
    const color = Fn((_, builder) => {
      const p = varying(positionGeometry.xz, 'oceanCoordinates'),
        slope = vec2(0).toVar(),
        crest = float(0).toVar(),
        spectralFoam = float(0).toVar(),
        compression = float(0).toVar();
      WAVES.forEach(([length, amp, dx, dz], i) => {
        const phase = p.x
          .mul((dx * TAU) / length)
          .add(p.y.mul((dz * TAU) / length))
          .add(this.phases[i]);
        slope.addAssign(
          vec2(dx, dz)
            .mul(cos(phase))
            .mul(this.height)
            .mul((amp * TAU) / length),
        );
        crest.addAssign(sin(phase).mul(amp));
      });
      for (const band of this.bands) {
        const sample = band.normals.sample(p.div(band.size).add(band.offset).add(band.texel.mul(0.5)));
        slope.addAssign(sample.xy.mul(band.amplitude));
        compression.addAssign(sample.z.mul(band.amplitude));
        crest.addAssign(sample.w.mul(band.amplitude).mul(0.4));
        spectralFoam.addAssign(
          band.displacement.sample(p.div(band.size).add(band.offset).add(band.texel.mul(0.5))).w.mul(0.18),
        );
      }
      const local = this.localSample(positionWorld.xz).toVar();
      slope.addAssign(local.yz.mul(this.wakeStrength));
      const impactSurface = this.impactSample(positionWorld.xz).toVar();
      slope.addAssign(impactSurface.yz);
      const fineUV = p
          .mul(0.045)
          .add(this.rippleOffset)
          .add(vec2(this.microTime.mul(0.014), this.microTime.mul(-0.011))),
        detail = this.rippleMap
          .sample(fineUV)
          .rg.add(
            this.rippleMap.sample(
              p
                .mul(0.045 * 2.37)
                .add(this.rippleOffset1)
                .add(vec2(this.microTime.mul(-0.006), this.microTime.mul(0.007).add(0.23))),
            ).rg,
          )
          .sub(1);
      const distance = cameraPosition.sub(positionWorld).length().toVar(),
        detailFade = float(1).div(distance.mul(0.0025).add(1));
      slope.addAssign(detail.mul(this.detail).mul(0.26).mul(detailFade));
      const normal = normalize(
          vec3(slope.x.negate(), max(0.35, float(1).sub(compression.mul(0.5))), slope.y.negate()),
        ).toVar(),
        eye = normalize(cameraPosition.sub(positionWorld)).toVar(),
        reflected = reflect(eye.negate(), normal).toVar(),
        ndv = max(dot(eye, normal), 0.001),
        ndl = max(dot(normal, this.sun), 0),
        fresnel = float(0.0204).add(pow(float(1).sub(ndv), 5).mul(0.9796));
      const baseRoughness = clamp(
          float(0.055).add(this.wind.mul(0.075)).add(this.weather.mul(0.055)).add(distance.mul(0.000008)),
          0.05,
          0.28,
        ),
        normalDx = dFdx(normal),
        normalDy = dFdy(normal),
        roughness = sqrt(
          baseRoughness.pow(2).add(min(0.05, dot(normalDx, normalDx).add(dot(normalDy, normalDy)).mul(0.5))),
        ),
        half = normalize(eye.add(this.sun)),
        ndh = max(dot(normal, half), 0),
        vdh = max(dot(eye, half), 0),
        alpha2 = roughness.pow(4),
        denominator = ndh.pow(2).mul(alpha2.sub(1)).add(1),
        distribution = alpha2.div(denominator.pow(2).mul(Math.PI)),
        k = roughness.add(1).pow(2).div(8),
        visibility = ndv.div(ndv.mul(float(1).sub(k)).add(k)).mul(ndl.div(ndl.mul(float(1).sub(k)).add(k))),
        specF = float(0.0204).add(pow(float(1).sub(vdh), 5).mul(0.9796)),
        specular = min(distribution.mul(visibility).mul(specF).div(ndv.mul(4).add(0.0001)), 18)
          .mul(this.sunColor)
          .mul(this.daylight)
          .mul(3.2);
      const environment = pmremTexture(this.scene.environment, reflected, roughness),
        distortion = normal.xz.mul(0.024).mul(float(1).div(distance.mul(0.015).add(1)));
      this.mirror.uvNode = this.baseReflectionUV.add(distortion);
      const reflectedColor = mix(
        environment,
        this.mirror.rgb,
        this.reflectionEnabled.mul(float(1).sub(roughness.mul(1.8))),
      );
      const illumination = this.daylight.mul(0.83).add(0.055),
        deep = vec3(0.007, 0.041, 0.06).mul(illumination),
        waterColor = mix(
          deep,
          vec3(0.015, 0.14, 0.13).mul(illumination),
          clamp(crest.mul(0.24).add(0.24), 0, 0.75),
        ).toVar();
      const through = pow(max(dot(eye, this.sun.negate()), 0), 3)
        .mul(smoothstep(-0.1, 0.8, crest))
        .mul(this.crestLight)
        .mul(this.daylight);
      waterColor.addAssign(vec3(0.025, 0.23, 0.18).mul(through));
      If(this.refractionEnabled.greaterThan(0.5), () => {
        const uv = clamp(viewportUV.add(normal.xz.mul(0.012).mul(detailFade)), 0.002, 0.998),
          sceneDepth = perspectiveDepthToViewZ(
            this.refractionDepth.sample(uv).r,
            cameraNear,
            cameraFar,
          ).negate(),
          thickness = max(sceneDepth.add(positionView.z), 0),
          absorption = exp(vec3(0.14, 0.055, 0.032).mul(thickness).negate());
        If(sceneDepth.greaterThan(positionView.z.negate()), () => {
          waterColor.assign(mix(waterColor, this.refraction.sample(uv).rgb, absorption));
        });
      });
      const wakeFoam = local.w.add(spectralFoam).add(impactSurface.w).toVar();
      for (const wake of this.wakes) {
        const d = p.sub(wake.data.xy),
          radius = this.wakeLength.add(wake.size.x);
        If(wake.size.w.greaterThan(0.01).and(dot(d, d).lessThan(radius.mul(radius))), () => {
          const forward = d.x.mul(sin(wake.data.z)).sub(d.y.mul(cos(wake.data.z))),
            across = abs(d.x.mul(cos(wake.data.z)).add(d.y.mul(sin(wake.data.z)))),
            hull = forward
              .div(wake.size.x.mul(0.49))
              .pow(2)
              .add(across.div(wake.size.y.mul(0.52)).pow(2))
              .sqrt(),
            contact = exp(hull.sub(1).pow(2).mul(-90)).mul(wake.size.w),
            back = forward.negate().sub(wake.size.x.mul(0.4)),
            v = across.sub(back.mul(0.34)),
            farMask = smoothstep(this.fieldSize.mul(0.35), this.fieldSize.mul(0.48), max(abs(p.x), abs(p.y))),
            fade = float(1)
              .sub(smoothstep(0, this.wakeLength, back))
              .mul(smoothstep(-3, 15, back))
              .mul(clamp(wake.data.w.div(7), 0, 1));
          wakeFoam.addAssign(
            contact.mul(0.4).add(
              exp(v.pow(2).div(max(back, 0).mul(0.25).add(18)).negate())
                .mul(fade)
                .mul(farMask)
                .mul(0.4),
            ),
          );
        });
      }
      const foamUV = p
          .mul(0.105)
          .add(this.worldOffset)
          .add(vec2(this.microTime.mul(0.003), this.microTime.mul(-0.002))),
        foamNoise = this.foamMap.sample(foamUV).toVar(),
        foamDetail = this.foamMap.sample(
          p
            .mul(0.105 * 2.73)
            .add(this.foamOffset1)
            .add(vec2(this.microTime.mul(0.002), this.microTime.mul(-0.003)))
            .add(0.37),
        ),
        breaking = smoothstep(0.32, 0.72, compression.add(slope.length().mul(0.12))).mul(
          this.wind.mul(0.3).add(this.weather.mul(0.25)),
        ),
        foamCoverage = clamp(wakeFoam.add(breaking).mul(this.foam), 0, 1),
        foamAmount = smoothstep(
          float(0.72).sub(foamCoverage.mul(0.68)),
          float(0.93).sub(foamCoverage.mul(0.7)),
          foamNoise.r.mul(0.65).add(foamDetail.g.mul(0.35)),
        ).mul(foamCoverage),
        foamAmbient = smoothstep(-0.12, 0.08, this.sun.y)
          .mul(float(0.38).add(max(this.sun.y, 0).mul(0.4)))
          .mul(float(1).sub(this.weather.mul(0.15)))
          .add(0.01),
        foamColor = mix(vec3(0.52, 0.62, 0.59), vec3(0.88, 0.92, 0.86), foamNoise.g).mul(foamAmbient);
      const result = mix(waterColor, reflectedColor, fresnel).add(specular).toVar();
      result.assign(mix(result, foamColor, foamAmount));
      If(this.underwater.greaterThan(0.5), () => {
        const incident = eye.negate(),
          transmitted = refract(incident, normal.negate(), 1.333),
          window = smoothstep(0.62, 0.76, abs(dot(eye, normal))),
          sky = pmremTexture(this.scene.environment, normalize(transmitted.add(vec3(0, 0.00001, 0))), 0.03),
          attenuation = exp(distance.div(this.clarity).negate());
        const airView = sky.toVar();
        If(this.refractionEnabled.greaterThan(0.5), () => {
          const uv = clamp(viewportUV.add(normal.xz.mul(0.018)), 0.002, 0.998),
            sceneDepth = perspectiveDepthToViewZ(
              this.refractionDepth.sample(uv).r,
              cameraNear,
              cameraFar,
            ).negate();
          If(
            sceneDepth.lessThan(cameraFar.mul(0.95)).and(sceneDepth.greaterThan(positionView.z.negate())),
            () => {
              airView.assign(this.refraction.sample(uv).rgb);
            },
          );
        });
        result.assign(
          mix(vec3(0.012, 0.085, 0.1), airView, window.mul(attenuation)).add(
            foamColor.mul(foamAmount).mul(0.35),
          ),
        );
      });
      return this.sunShadow && builder.renderer.shadowMap.enabled
        ? result.mul(mix(vec3(0.65, 0.75, 0.8), vec3(1), this.sunShadow))
        : result;
    });
    this.material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    this.material.colorNode = color();
    this.material.positionNode = displacement(positionGeometry);
    this.material.fog = true;
    this.rebuild();
    this.bindSurface(surface);
  }

  bindSurface(surface) {
    this.surface = surface;
    for (let i = 0; i < this.bands.length; i++) {
      const band = this.bands[i],
        cascade = surface.cascades[i];
      if (band.displacement.value.image.width !== cascade.resolution) {
        resizeFloatTexture(band.displacement.value, cascade.resolution);
        resizeFloatTexture(band.normals.value, cascade.resolution);
      }
      band.texel.value = 1 / cascade.resolution;
    }
    if (this.field.value.image.width !== surface.interactions.resolution) {
      resizeFloatTexture(this.field.value, surface.interactions.resolution);
    }
    this.fieldTexel.value = 1 / surface.interactions.resolution;
    this.spectralVersion = -1;
    this.fieldVersion = -1;
  }

  rebuild() {
    const segments = Math.round(this.config.graphics.oceanSegments / 16) * 16;
    if (this.meshes.length) {
      const near = this.meshes[0];
      if (near.userData.segments !== segments) {
        near.geometry.dispose();
        near.geometry = grid(384, segments);
        near.userData.segments = segments;
      }
      return;
    }
    // Reuse the mesh objects and unchanged distant rings across quality changes.
    // Their per-object GPU bindings should live as long as the ocean does.
    this.meshes = [
      [384, segments, 0],
      [1536, 128, 384],
      [6144, 128, 1536],
      [65536, 128, 6144],
    ].map(([size, n, hole]) => {
      const mesh = new THREE.Mesh(grid(size, n, hole), this.material);
      mesh.userData.segments = n;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      return mesh;
    });
  }

  resize(width, height) {
    const scale = Math.max(0.3, Math.min(0.7, this.config.graphics.reflectionScale));
    this.refractionTarget.setSize(
      Math.max(1, Math.round(width * scale)),
      Math.max(1, Math.round(height * scale)),
    );
  }

  captureRefraction(renderer, camera) {
    this.refractionEnabled.value = this.config.graphics.waterRefraction ? 1 : 0;
    if (!this.config.graphics.waterRefraction) return;
    const previous = renderer.getRenderTarget(),
      visible = this.meshes.map((m) => m.visible);
    try {
      for (const mesh of this.meshes) mesh.visible = false;
      renderer.setRenderTarget(this.refractionTarget);
      renderer.render(this.scene, camera);
    } finally {
      renderer.setRenderTarget(previous);
      this.meshes.forEach((m, i) => {
        m.visible = visible[i];
      });
    }
  }

  wetMaterials(model, motion) {
    const wetness = uniform(motion.wetness || 0),
      materials = new Map();
    model.traverse((object) => {
      if (!object.isMesh || !object.material.isMeshStandardMaterial) return;
      const original = object.material;
      if (!materials.has(original)) {
        const material = original.clone(),
          base = uniform(original.color),
          surfaceHeight = this.heightAt(positionWorld.xz).toVar(),
          soaked = Fn(() =>
            max(wetness.mul(0.75), float(1).sub(smoothstep(-0.15, 0.7, positionWorld.y.sub(surfaceHeight)))),
          );
        material.colorNode = base
          .mul(original.map ? texture(original.map) : vec3(1))
          .mul(mix(1, 0.68, soaked()))
          .mul(
            exp(
              vec3(0.035, 0.014, 0.009)
                .mul(max(surfaceHeight.sub(positionWorld.y), 0))
                .negate(),
            ),
          );
        material.emissiveNode = Fn(() => {
          const depth = max(surfaceHeight.sub(positionWorld.y), 0),
            causticUV = positionWorld.xz
              .mul(0.075)
              .add(vec2(this.microTime.mul(0.023), this.microTime.mul(-0.017))),
            caustic = pow(float(1).sub(abs(this.rippleMap.sample(causticUV).r.sub(0.5)).mul(2)), 12)
              .mul(float(1).sub(smoothstep(0, 12, depth)))
              .mul(smoothstep(0.1, 1, depth))
              .mul(max(normalWorld.y, 0))
              .mul(this.daylight)
              .mul(0.025);
          return vec3(0.45, 0.75, 0.7).mul(caustic);
        })();
        material.roughnessNode = mix(original.roughness, Math.min(0.2, original.roughness), soaked());
        materials.set(original, material);
      }
      object.material = materials.get(original);
    });
    model.userData.waterWetness = wetness;
    model.userData.waterMaterials = [...materials.values()];
  }

  update(sim, sun, sunColor) {
    const c = this.config,
      p = sim.p,
      surface = sim.water;
    surface.ensure(sim.visualTime);
    if (
      this.surface !== surface ||
      this.bands[0].displacement.value.image.width !== surface.cascades[0].resolution ||
      this.field.value.image.width !== surface.interactions.resolution
    )
      this.bindSurface(surface);
    this.height.value = c.ocean.waveHeight * (1 + sim.weather);
    this.detail.value = c.graphics.detailWaves;
    this.foam.value = c.graphics.foam;
    this.microTime.value = sim.visualTime;
    this.wakeStrength.value = c.ocean.wakeStrength;
    this.wakeLength.value = c.ocean.wakeLength;
    this.sun.value.copy(sun);
    this.sunColor.value.copy(sunColor);
    this.daylight.value = Math.max(0, sun.y) * Math.max(0.3, 1 - sim.weather * 0.5);
    this.wind.value = Math.min(1, c.ocean.windSpeed / 18);
    this.weather.value = sim.weather;
    this.crestLight.value = c.ocean.crestLight;
    this.clarity.value = c.ocean.clarity;
    this.underwater.value = this.cameraUnderwater ? 1 : 0;
    this.mirror.reflector.resolutionScale = c.graphics.reflectionScale;
    this.reflectionEnabled.value = c.graphics.reflections && !this.cameraUnderwater ? 1 : 0;
    const oceanX = sim.oceanX ?? p.x,
      amplitudes = surface.amplitudes(sim.weather);
    this.rippleOffset.value.set((oceanX * 0.045) % 1, (p.z * 0.045) % 1);
    this.rippleOffset1.value.set((oceanX * 0.045 * 2.37) % 1, (p.z * 0.045 * 2.37) % 1);
    this.foamOffset1.value.set((oceanX * 0.105 * 2.73) % 1, (p.z * 0.105 * 2.73) % 1);
    this.worldOffset.value.set((oceanX * 0.105) % 1, (p.z * 0.105) % 1);
    WAVES.forEach(([length, , dx, dz], i) => {
      const k = TAU / length;
      this.phases[i].value =
        ((oceanX * dx + p.z * dz) * k - Math.sqrt(9.81 * k) * sim.visualTime * c.ocean.waveSpeed) % TAU;
    });
    for (let i = 0; i < this.bands.length; i++) {
      const band = this.bands[i],
        cascade = surface.cascades[i];
      band.offset.value.set((oceanX / band.size) % 1, (p.z / band.size) % 1);
      band.amplitude.value = amplitudes[i];
      if (this.spectralVersion !== surface.version) {
        uploadFloatTexture(band.displacement.value, cascade.displacement);
        uploadFloatTexture(band.normals.value, cascade.normals);
      }
    }
    this.spectralVersion = surface.version;
    const field = surface.interactions;
    this.fieldCenter.value.set(field.x - oceanX, field.z - p.z);
    this.fieldSize.value = field.size;
    if (this.fieldVersion !== field.version) {
      uploadFloatTexture(this.field.value, field.data);
      this.fieldVersion = field.version;
    }
    const nearby = sim.ships
        .filter((s) => s.hp > 0 || s.sinkTime < 40)
        .sort((a, b) => Math.hypot(deltaX(a.x, p.x), a.z - p.z) - Math.hypot(deltaX(b.x, p.x), b.z - p.z))
        .slice(0, 11),
      sources = [
        {
          x: p.x,
          z: p.z,
          heading: p.heading,
          speed: p.speed,
          length: 66,
          width: 6,
          depth: p.depth,
          y: sim.body.translation().y + 2,
        },
        ...nearby.map((ship) => ({ ...ship, speed: sim.effectiveShipSpeed(ship) })),
      ];
    this.wakes.forEach((wake, i) => {
      const s = sources[i];
      wake.data.value.set(
        s ? deltaX(s.x, p.x) : 1e5,
        s ? s.z - p.z : 1e5,
        s?.heading || 0,
        s?.hp === 0 ? 0 : s?.speed || 0,
      );
      wake.size.value.set(
        s?.length || 1,
        s?.width || 1,
        s?.y || 0,
        s ? Math.max(0, 1 - (s.depth || 0) / 6) * (s.hp === 0 ? Math.exp(-s.sinkTime / 12) : 1) : 0,
      );
    });
    this.impacts.forEach((slot, i) => {
      const impact = surface.impacts[i],
        age = impact ? sim.visualTime - impact.born : 0,
        amplitude = impact
          ? (impact.kind === 'shell' ? 0.12 : 0.65) *
            Math.sqrt(impact.energy) *
            Math.exp(-impact.depth / 28) *
            Math.exp(-age / 5) *
            c.ocean.wakeStrength
          : 0;
      slot.data.value.set(
        impact ? impact.x - oceanX : 0,
        impact ? impact.z - p.z : 0,
        age,
        age < 15 ? amplitude : 0,
      );
      slot.shape.value.set(
        impact?.kind === 'shell' ? 3 : 7,
        impact ? 12 + Math.sqrt(impact.energy) * 4 : 16,
        impact
          ? (impact.kind === 'shell' ? 0.45 : 1.2) * Math.sqrt(impact.energy) * Math.exp(-impact.depth / 28)
          : 0,
        0,
      );
    });
  }
}
