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
import { sunlightTransmission } from './lighting.js';
import {
  INVERSE_ITERATIONS,
  INVERSE_TOLERANCE,
  immersionEnvelope,
  LOCAL_FOAM_BLEND_END,
  LOCAL_FOAM_BLEND_START,
} from './water-math.js';
import {
  floatTexture,
  foamTexture,
  resizeFloatTexture,
  rippleTexture,
  uploadFloatTexture,
} from './water-textures.js';
import { deltaX, TAU } from './world.js';

function grid(size, segments, hole = 0, outerSpacing = size / segments) {
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
  const geometry = new THREE.BufferGeometry();
  const spacings = new Float32Array(vertices.length / 3);
  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i],
      z = vertices[i + 2],
      distance = size / 2 - Math.max(Math.abs(x), Math.abs(z));
    const t = Math.max(0, Math.min(1, 1 - distance / (outerSpacing * 2))),
      morph = t * t * (3 - 2 * t);
    vertices[i] += (Math.round(x / outerSpacing) * outerSpacing - x) * morph;
    vertices[i + 2] += (Math.round(z / outerSpacing) * outerSpacing - z) * morph;
    spacings[i / 3] = (size / segments) * (1 - morph) + outerSpacing * morph;
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  for (let i = 0; i < vertices.length; i += 3)
    uvs.push(vertices[i] / size + 0.5, vertices[i + 2] / size + 0.5);
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('waterSpacing', new THREE.Float32BufferAttribute(spacings, 1));
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
    this.look = Object.fromEntries(
      Object.entries(config.waterAppearance).map(([key, value]) => [
        key,
        uniform(typeof value === 'string' ? new THREE.Color(value) : value),
      ]),
    );
    this.fx = Object.fromEntries(
      Object.entries(config.waterInteraction).map(([key, value]) => [key, uniform(value)]),
    );
    this.inspect = uniform(0);
    this.height = uniform(config.ocean.waveHeight);
    this.detail = uniform(config.graphics.detailWaves);
    this.foam = uniform(config.graphics.foam);
    this.wakeStrength = uniform(config.ocean.wakeStrength);
    this.wakeLength = uniform(config.ocean.wakeLength);
    this.sun = uniform(new THREE.Vector3(-0.55, 0.38, -0.74).normalize());
    this.sunColor = uniform(new THREE.Color(0xffd9a4));
    this.daylight = uniform(1);
    this.skyLight = uniform(1);
    this.foamDrift = uniform(new THREE.Vector2());
    this.wind = uniform(0.4);
    this.weather = uniform(0);
    this.crestLight = uniform(config.ocean.crestLight);
    this.underwater = uniform(0);
    this.clarity = uniform(config.ocean.clarity);
    this.phases = Array.from({ length: 6 }, () => uniform(0));
    this.waveComponents = Array.from({ length: 6 }, () => uniform(new THREE.Vector4()));
    this.chop = uniform(1);
    this.rippleDirection = uniform(new THREE.Vector2(0, 1));
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
    this.fieldAge = texture(floatTexture(surface.interactions.resolution, false));
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
      const sample = this.field.sample(coords.add(this.fieldTexel.mul(0.5))).level(0);
      const foamMask = float(1).sub(
        smoothstep(
          LOCAL_FOAM_BLEND_START,
          LOCAL_FOAM_BLEND_END,
          max(abs(coords.x.sub(0.5)), abs(coords.y.sub(0.5))),
        ),
      );
      return vec4(sample.xyz.mul(mask), sample.w.mul(foamMask));
    });
    this.heightAt = Fn(([p]) => {
      const q = p.toVar(),
        active = float(1).toVar();
      for (let iteration = 0; iteration < INVERSE_ITERATIONS; iteration++) {
        If(active.greaterThan(0.5), () => {
          const horizontal = vec2(0).toVar();
          for (const band of this.bands)
            horizontal.addAssign(
              band.displacement
                .sample(q.div(band.size).add(band.offset).add(band.texel.mul(0.5)))
                .level(0)
                .xz.mul(band.amplitude)
                .mul(this.chop),
            );
          const residual = q.add(horizontal).sub(p);
          If(dot(residual, residual).lessThanEqual(INVERSE_TOLERANCE * INVERSE_TOLERANCE), () => {
            active.assign(0);
          }).Else(() => {
            q.assign(p.sub(horizontal));
          });
        });
      }
      const result = float(0).toVar();
      this.waveComponents.forEach((component, i) => {
        const kx = component.x,
          kz = component.y,
          amp = component.z;
        result.addAssign(
          sin(q.x.mul(kx).add(q.y.mul(kz)).add(this.phases[i]))
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
      this.waveComponents.forEach((component, i) => {
        const kx = component.x,
          kz = component.y,
          amp = component.z;
        result.y.addAssign(
          sin(p.x.mul(kx).add(p.z.mul(kz)).add(this.phases[i]))
            .mul(amp)
            .mul(this.height)
            .mul(smoothstep(spacing.mul(2), spacing.mul(4), component.w)),
        );
      });
      for (const band of this.bands) {
        const d = band.displacement
          .sample(p.xz.div(band.size).add(band.offset).add(band.texel.mul(0.5)))
          .level(max(0, log2(spacing.div(band.size).div(band.texel))));
        result.addAssign(d.xyz.mul(vec3(this.chop, 1, this.chop)).mul(band.amplitude));
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
        compression = float(0).toVar(),
        tangentX = vec2(1, 0).toVar(),
        tangentZ = vec2(0, 1).toVar();
      this.waveComponents.forEach((component, i) => {
        const kx = component.x,
          kz = component.y,
          amp = component.z;
        const phase = p.x.mul(kx).add(p.y.mul(kz)).add(this.phases[i]);
        slope.addAssign(vec2(kx, kz).mul(cos(phase)).mul(this.height).mul(amp));
        crest.addAssign(sin(phase).mul(amp));
      });
      for (const band of this.bands) {
        const sample = band.normals.sample(p.div(band.size).add(band.offset).add(band.texel.mul(0.5)));
        slope.addAssign(sample.xy.mul(band.amplitude));
        const uv = p.div(band.size).add(band.offset).add(band.texel.mul(0.5)),
          spacing = band.texel.mul(band.size);
        const derivativeX = band.displacement
          .sample(uv.add(vec2(band.texel, 0)))
          .xz.sub(band.displacement.sample(uv.sub(vec2(band.texel, 0))).xz)
          .div(spacing.mul(2))
          .mul(band.amplitude)
          .mul(this.chop);
        const derivativeZ = band.displacement
          .sample(uv.add(vec2(0, band.texel)))
          .xz.sub(band.displacement.sample(uv.sub(vec2(0, band.texel))).xz)
          .div(spacing.mul(2))
          .mul(band.amplitude)
          .mul(this.chop);
        tangentX.addAssign(derivativeX);
        tangentZ.addAssign(derivativeZ);
        crest.addAssign(sample.w.mul(band.amplitude).mul(0.4));
        spectralFoam.addAssign(
          band.displacement.sample(p.div(band.size).add(band.offset).add(band.texel.mul(0.5))).w.mul(0.18),
        );
      }
      const local = this.localSample(positionWorld.xz).toVar();
      const age = this.fieldAge.sample(
        positionWorld.xz.sub(this.fieldCenter).div(this.fieldSize).add(0.5).add(this.fieldTexel.mul(0.5)),
      ).r;
      const freshness = exp(age.div(this.fx.whitecapDecay.mul(2)).negate());
      slope.addAssign(local.yz.mul(this.wakeStrength));
      const impactSurface = this.impactSample(positionWorld.xz).toVar();
      slope.addAssign(impactSurface.yz);
      const fineUV = p
          .mul(this.look.rippleScale.mul(0.045))
          .add(this.rippleOffset)
          .add(
            vec2(
              this.microTime.mul(this.look.rippleSpeed).mul(0.014),
              this.microTime.mul(this.look.rippleSpeed).mul(-0.011),
            ),
          ),
        detail = this.rippleMap
          .sample(fineUV)
          .rg.add(
            this.rippleMap.sample(
              p
                .mul(this.look.rippleScale.mul(0.045 * 2.37))
                .add(this.rippleOffset1)
                .add(
                  vec2(
                    this.microTime.mul(this.look.rippleSpeed).mul(-0.006),
                    this.microTime.mul(this.look.rippleSpeed).mul(0.007).add(0.23),
                  ),
                ),
            ).rg,
          )
          .sub(1);
      const distance = cameraPosition.sub(positionWorld).length().toVar(),
        detailFade = float(1).div(distance.div(this.look.rippleFade).mul(2).add(1));
      const determinant = tangentX.x.mul(tangentZ.y).sub(tangentX.y.mul(tangentZ.x));
      compression.assign(float(1).sub(determinant));
      const alignedDetail = vec2(
        detail.x.mul(this.rippleDirection.y).add(detail.y.mul(this.rippleDirection.x)),
        detail.y.mul(this.rippleDirection.y).sub(detail.x.mul(this.rippleDirection.x)),
      );
      slope.addAssign(
        mix(detail, alignedDetail, this.look.rippleAlignment).mul(this.detail).mul(0.2).mul(detailFade),
      );
      const normal = normalize(
          vec3(
            slope.y.mul(tangentX.y).sub(slope.x.mul(tangentZ.y)),
            determinant,
            slope.x.mul(tangentZ.x).sub(slope.y.mul(tangentX.x)),
          ),
        ).toVar(),
        eye = normalize(cameraPosition.sub(positionWorld)).toVar(),
        reflected = reflect(eye.negate(), normal).toVar(),
        ndv = max(dot(eye, normal), 0.001),
        ndl = max(dot(normal, this.sun), 0),
        f0 = this.look.ior.sub(1).div(this.look.ior.add(1)).pow(2),
        fresnel = f0.add(pow(float(1).sub(ndv), 5).mul(float(1).sub(f0)));
      const baseRoughness = clamp(
          this.look.roughness
            .add(this.wind.mul(this.look.windRoughness))
            .add(this.weather.mul(0.055))
            .add(distance.mul(0.000008)),
          0.03,
          0.35,
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
        specF = f0.add(pow(float(1).sub(vdh), 5).mul(float(1).sub(f0))),
        specular = min(distribution.mul(visibility).mul(specF).div(ndv.mul(4).add(0.0001)), 18)
          .mul(this.sunColor)
          .mul(this.daylight)
          .mul(this.look.glitter)
          .mul(3.2);
      const environment = pmremTexture(this.scene.environment, reflected, roughness),
        distortion = normal.xz
          .mul(0.024)
          .mul(this.look.reflectionDistortion)
          .mul(float(1).div(distance.mul(0.015).add(1)));
      this.mirror.uvNode = this.baseReflectionUV.add(distortion);
      const reflectedColor = mix(
        environment.mul(this.look.environmentGain),
        this.mirror.rgb,
        this.reflectionEnabled.mul(this.look.planarGain).mul(float(1).sub(roughness.mul(1.8))),
      );
      const illumination = this.skyLight.mul(0.83).add(0.055),
        deep = this.look.deepColor.mul(illumination),
        waterColor = mix(
          deep,
          this.look.scatterColor.mul(illumination),
          clamp(crest.mul(0.24).add(0.24), 0, 0.75),
        ).toVar();
      const through = pow(max(dot(eye, this.sun.negate()), 0), 3)
        .mul(smoothstep(this.look.crestWidth.mul(-0.15), this.look.crestWidth.mul(1.2), crest))
        .mul(this.crestLight)
        .mul(this.daylight);
      waterColor.addAssign(this.look.crestColor.mul(through).mul(0.4));
      If(this.refractionEnabled.greaterThan(0.5), () => {
        const uv = viewportUV.toVar(),
          candidate = viewportUV.add(
            normal.xz.mul(0.012).mul(this.look.refractionDistortion).mul(detailFade),
          );
        const baseDepth = perspectiveDepthToViewZ(
          this.refractionDepth.sample(viewportUV).r,
          cameraNear,
          cameraFar,
        )
          .negate()
          .toVar();
        If(
          candidate.x
            .greaterThan(0.002)
            .and(candidate.x.lessThan(0.998))
            .and(candidate.y.greaterThan(0.002))
            .and(candidate.y.lessThan(0.998)),
          () => {
            const distortedDepth = perspectiveDepthToViewZ(
              this.refractionDepth.sample(candidate).r,
              cameraNear,
              cameraFar,
            ).negate();
            If(distortedDepth.greaterThan(positionView.z.negate().add(0.05)), () => {
              uv.assign(candidate);
              baseDepth.assign(distortedDepth);
            });
          },
        );
        // Axial depth differences are converted to ray length for grazing views.
        const thickness = max(baseDepth.add(positionView.z), 0).mul(
          positionView.length().div(max(positionView.z.negate(), 0.1)),
        );
        const absorption = exp(
          vec3(this.look.absorptionR, this.look.absorptionG, this.look.absorptionB).mul(thickness).negate(),
        );
        If(baseDepth.greaterThan(positionView.z.negate()), () => {
          const transmitted = this.refraction
            .sample(uv)
            .rgb.mul(absorption)
            .add(waterColor.mul(vec3(1).sub(absorption)));
          waterColor.assign(mix(waterColor, transmitted, this.look.refractionWeight));
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
            contactGain = contact.mul(this.fx.contactGain);
          wakeFoam.addAssign(contactGain.mul(0.22));
        });
      }
      const foamUV = positionWorld.xz
          .mul(this.fx.bubbleScale.mul(0.105))
          .add(this.worldOffset)
          .add(this.foamDrift.mul(this.microTime).mul(this.fx.bubbleScale).mul(-0.105)),
        foamNoise = this.foamMap.sample(foamUV).toVar(),
        foamDetail = this.foamMap.sample(
          positionWorld.xz
            .mul(this.fx.bubbleScale.mul(0.105 * 2.73))
            .add(this.foamOffset1)
            .add(
              this.foamDrift
                .mul(this.microTime)
                .mul(this.fx.bubbleScale)
                .mul(-0.105 * 2.73),
            )
            .add(0.37),
        ),
        foamCoverage = clamp(wakeFoam.mul(this.foam), 0, 1),
        freshBubbles = smoothstep(0.3, 0.72, foamNoise.r)
          .mul(0.55)
          .add(smoothstep(0.25, 0.8, foamDetail.g).mul(0.45)),
        residualStreaks = smoothstep(0.58, 0.88, foamNoise.r.mul(0.8).add(foamDetail.g.mul(0.35))),
        foamAmount = foamCoverage.mul(mix(residualStreaks, freshBubbles, freshness)),
        foamAmbient = smoothstep(-0.12, 0.08, this.sun.y)
          .mul(float(0.38).add(max(this.sun.y, 0).mul(0.4)))
          .mul(float(1).sub(this.weather.mul(0.15)))
          .add(0.01),
        foamColor = mix(
          vec3(0.62, 0.72, 0.68),
          vec3(0.95, 0.98, 0.93),
          foamNoise.g.mul(freshness.mul(0.5).add(0.5)),
        )
          .mul(foamAmbient)
          .mul(this.fx.foamBrightness)
          .add(
            this.sunColor
              .mul(pow(ndh, mix(12, 2, this.fx.foamRoughness)))
              .mul(float(1).sub(this.fx.foamRoughness))
              .mul(this.daylight)
              .mul(0.035),
          );
      const result = mix(waterColor, reflectedColor, fresnel).add(specular).toVar();
      result.assign(mix(result, foamColor, foamAmount));
      If(this.underwater.greaterThan(0.001), () => {
        const incident = eye.negate(),
          transmitted = refract(incident, normal.negate(), this.look.ior),
          critical = sqrt(float(1).sub(float(1).div(this.look.ior.pow(2)))),
          window = smoothstep(critical.sub(0.06), critical.add(0.06), abs(dot(eye, normal))),
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
        const submergedColor = mix(
          this.look.underwaterColor.mul(this.look.scatterGain),
          airView,
          window.mul(attenuation).mul(this.look.surfaceWindow).clamp(0, 1),
        ).add(foamColor.mul(foamAmount).mul(0.35));
        result.assign(mix(result, submergedColor, this.underwater));
      });
      If(this.inspect.equal(1), () => {
        result.assign(vec3(positionWorld.y.mul(0.07).add(0.5)));
      });
      If(this.inspect.equal(2), () => {
        result.assign(normal.mul(0.5).add(0.5));
      });
      If(this.inspect.equal(3), () => {
        result.assign(vec3(clamp(compression, 0, 1), clamp(determinant, 0, 1), 0.05));
      });
      If(this.inspect.equal(4), () => {
        result.assign(vec3(local.w, spectralFoam, impactSurface.w).clamp(0, 1));
      });
      If(this.inspect.equal(11), () => {
        result.assign(vec3(freshness, age.div(60).clamp(0, 1), 0.1));
      });
      If(this.inspect.equal(5), () => {
        result.assign(vec3(foamCoverage));
      });
      If(this.inspect.equal(6), () => {
        result.assign(vec3(this.localSample(positionWorld.xz).x.mul(0.1).add(0.3), local.w, 0.1));
      });
      If(this.inspect.equal(7), () => {
        result.assign(reflectedColor);
      });
      If(this.inspect.equal(8), () => {
        result.assign(this.refraction.sample(viewportUV).rgb);
      });
      If(this.inspect.equal(9), () => {
        const depth = perspectiveDepthToViewZ(
          this.refractionDepth.sample(viewportUV).r,
          cameraNear,
          cameraFar,
        ).negate();
        result.assign(vec3(float(1).sub(exp(depth.div(200).negate()))));
      });
      If(this.inspect.equal(10), () => {
        result.assign(vec3(this.underwater, 0.2, float(1).sub(this.underwater)));
      });
      return this.sunShadow && builder.renderer.shadowMap.enabled
        ? result.mul(mix(vec3(0.65, 0.75, 0.8), vec3(1), this.sunShadow))
        : result;
    });
    this.displaceSurface = displacement;
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
      resizeFloatTexture(this.fieldAge.value, surface.interactions.resolution);
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
        near.geometry = grid(384, segments, 0, 12);
        near.userData.segments = segments;
      }
      return;
    }
    // Reuse the mesh objects and unchanged distant rings across quality changes.
    // Their per-object GPU bindings should live as long as the ocean does.
    this.meshes = [
      [384, segments, 0, 12],
      [1536, 128, 384, 48],
      [6144, 128, 1536, 512],
      [65536, 128, 6144, 512],
    ].map(([size, n, hole, outerSpacing]) => {
      const mesh = new THREE.Mesh(grid(size, n, hole, outerSpacing), this.material);
      mesh.userData.segments = n;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      return mesh;
    });
  }

  resize(width, height) {
    const scale = this.config.waterAppearance.refractionScale;
    this.refractionTarget.setSize(
      Math.max(1, Math.round(width * scale)),
      Math.max(1, Math.round(height * scale)),
    );
  }

  captureRefraction(renderer, camera) {
    this.refractionEnabled.value =
      this.config.graphics.waterRefraction && this.config.waterAppearance.refractionWeight > 0 ? 1 : 0;
    if (!this.refractionEnabled.value) return;
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

  // Verification only: execute the actual shared TSL query on either backend.
  async verifySurfaceSamples(renderer, points, spacing = null) {
    const point = uniform(new THREE.Vector2());
    const material = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
    material.fragmentNode =
      spacing === null
        ? vec4(this.heightAt(point), 0, 0, 1)
        : vec4(this.displaceSurface(vec3(point.x, 0, point.y)), 1);
    material.toneMapped = false;
    const quad = new THREE.QuadMesh(material);
    if (spacing !== null) {
      quad.geometry = quad.geometry.clone();
      quad.geometry.setAttribute(
        'waterSpacing',
        new THREE.Float32BufferAttribute([spacing, spacing, spacing], 1),
      );
    }
    const target = new THREE.RenderTarget(1, 1, { type: THREE.FloatType, depthBuffer: false });
    const previous = renderer.getRenderTarget(),
      results = [];
    try {
      renderer.setRenderTarget(target);
      for (const [x, z] of points) {
        point.value.set(x, z);
        quad.render(renderer);
        const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 1, 1);
        results.push(spacing === null ? pixels[0] : [...pixels.slice(0, 3)]);
      }
    } finally {
      renderer.setRenderTarget(previous);
      target.dispose();
      material.dispose();
      if (spacing !== null) quad.geometry.dispose();
    }
    return results;
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
          .mul(mix(1, float(1).sub(this.fx.wetDarkening), soaked()))
          .mul(
            exp(
              vec3(this.look.absorptionR, this.look.absorptionG, this.look.absorptionB)
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
        material.roughnessNode = mix(
          original.roughness,
          min(this.fx.wetRoughness, original.roughness),
          soaked(),
        );
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
    const waterTime = sim.renderTime ?? sim.visualTime;
    const weather = sim.renderWeather ?? sim.weather;
    surface.weather = weather;
    surface.ensure(waterTime);
    for (const [key, node] of Object.entries(this.look)) {
      const value = c.waterAppearance[key];
      if (typeof value === 'string') {
        if (node.waterHex !== value) {
          node.value.set(value);
          node.waterHex = value;
        }
      } else node.value = value;
    }
    for (const [key, node] of Object.entries(this.fx)) node.value = c.waterInteraction[key];
    const flow = c.waterInteraction,
      windAngle = (c.ocean.windDirection * Math.PI) / 180,
      currentAngle = (flow.currentDirection * Math.PI) / 180;
    this.foamDrift.value.set(
      Math.sin(windAngle) * flow.windDrift + Math.sin(currentAngle) * flow.currentSpeed,
      -Math.cos(windAngle) * flow.windDrift - Math.cos(currentAngle) * flow.currentSpeed,
    );
    if (
      this.surface !== surface ||
      this.bands[0].displacement.value.image.width !== surface.cascades[0].resolution ||
      this.field.value.image.width !== surface.interactions.resolution
    )
      this.bindSurface(surface);
    this.height.value = c.ocean.waveHeight * (1 + weather);
    this.detail.value = c.graphics.detailWaves;
    this.foam.value = c.graphics.foam;
    this.microTime.value = waterTime;
    this.wakeStrength.value = c.ocean.wakeStrength;
    this.wakeLength.value = c.ocean.wakeLength;
    this.sun.value.copy(sun);
    this.sunColor.value.copy(sunColor);
    this.skyLight.value = Math.max(0, sun.y) * Math.max(0.65, 1 - sim.weather * 0.25);
    this.daylight.value =
      this.skyLight.value * sunlightTransmission(Math.min(1, c.ocean.cloudCover + sim.weather * 0.3));
    this.wind.value = Math.min(1, c.ocean.windSpeed / 18);
    this.weather.value = sim.weather;
    this.crestLight.value = c.ocean.crestLight;
    this.clarity.value = c.ocean.clarity;
    this.underwater.value = this.cameraImmersion ?? (this.cameraUnderwater ? 1 : 0);
    this.mirror.reflector.resolutionScale = c.graphics.reflectionScale;
    this.reflectionEnabled.value = c.graphics.reflections ? 1 - this.underwater.value : 0;
    const oceanX = sim.oceanX ?? p.x,
      amplitudes = surface.amplitudes(weather);
    this.rippleOffset.value.set(
      (oceanX * 0.045 * c.waterAppearance.rippleScale) % 1,
      (p.z * 0.045 * c.waterAppearance.rippleScale) % 1,
    );
    this.rippleOffset1.value.set(
      (oceanX * 0.045 * 2.37 * c.waterAppearance.rippleScale) % 1,
      (p.z * 0.045 * 2.37 * c.waterAppearance.rippleScale) % 1,
    );
    this.foamOffset1.value.set(
      (oceanX * 0.105 * 2.73 * c.waterInteraction.bubbleScale) % 1,
      (p.z * 0.105 * 2.73 * c.waterInteraction.bubbleScale) % 1,
    );
    this.worldOffset.value.set(
      (oceanX * 0.105 * c.waterInteraction.bubbleScale) % 1,
      (p.z * 0.105 * c.waterInteraction.bubbleScale) % 1,
    );
    surface.swell.forEach((wave, i) => {
      this.waveComponents[i].value.set(wave.dx * wave.k, wave.dz * wave.k, wave.amplitude, wave.length);
      this.phases[i].value =
        ((oceanX * wave.dx + p.z * wave.dz) * wave.k - wave.omega * surface.phaseAt(waterTime) + wave.phase) %
        TAU;
    });
    this.chop.value = surface.effectiveChop;
    this.rippleDirection.value.set(
      Math.sin((c.ocean.windDirection * Math.PI) / 180),
      Math.cos((c.ocean.windDirection * Math.PI) / 180),
    );
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
    const fieldKey = `${field.version}:${sim.renderAlpha ?? 1}`;
    if (this.fieldVersion !== fieldKey) {
      uploadFloatTexture(this.field.value, field.render(sim.renderAlpha ?? 1));
      uploadFloatTexture(this.fieldAge.value, field.ageData);
      this.fieldVersion = fieldKey;
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
        s
          ? immersionEnvelope(s.depth || 0, c.waterMotion.immersionDistance) *
              (s.hp === 0 ? Math.exp(-s.sinkTime / 12) : 1)
          : 0,
      );
    });
    this.impacts.forEach((slot, i) => {
      const impact = surface.impacts[i],
        age = impact ? waterTime - impact.born : 0,
        amplitude = impact
          ? (impact.kind === 'shell' ? 0.12 : 0.65) *
            Math.sqrt(impact.energy) *
            Math.exp(-impact.depth / c.waterInteraction.impactDepth) *
            Math.exp(-age / (5 * c.waterInteraction.impactDecay)) *
            c.ocean.wakeStrength *
            c.waterInteraction.impactRing
          : 0;
      slot.data.value.set(
        impact ? impact.x - oceanX : 0,
        impact ? impact.z - p.z : 0,
        age,
        age < 15 ? amplitude : 0,
      );
      slot.shape.value.set(
        impact?.kind === 'shell' ? 3 : 7,
        impact ? (12 + Math.sqrt(impact.energy) * 4) * c.waterInteraction.impactSpread : 16,
        impact
          ? (impact.kind === 'shell' ? 0.45 : 1.2) *
              Math.sqrt(impact.energy) *
              Math.exp(-impact.depth / c.waterInteraction.impactDepth) *
              c.waterInteraction.impactFoam
          : 0,
        0,
      );
    });
  }
}
