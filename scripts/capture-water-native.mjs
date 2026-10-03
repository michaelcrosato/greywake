import { mkdir, writeFile } from 'node:fs/promises';
import NodeFrame from 'three/src/nodes/core/NodeFrame.js';
import { densityFogFactor, fog, pmremTexture, uniform } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { defaults, PRESETS, SEA_STATES } from '../src/config.js';
import { View } from '../src/render.js';
import { initPhysics, newCareer, Simulation } from '../src/simulation.js';

// Capture the real shader graphs/geometry/uniforms for an independent GLES draw.
// The preview substitutes an analytical environment atlas for the browser PMREM pass.
// It deliberately does not claim to test the browser, reflection pass, or UI.
globalThis.ImageBitmap = class {};
globalThis.document = {
  createElement() {
    const canvas = { width: 256, height: 256 };
    canvas.getContext = () => ({
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: (image) => {
        canvas.pixels = image.data;
      },
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
    });
    return canvas;
  },
};
await initPhysics();
const width = 960,
  height = 600;
const selectedCase = process.argv.includes('--case')
  ? process.argv[process.argv.indexOf('--case') + 1]
  : null;
const impactAge = process.argv.includes('--impact-age')
  ? Number(process.argv[process.argv.indexOf('--impact-age') + 1])
  : 1;
const cases = [
  ['calm', 'calm', 0],
  ['atlantic', 'atlantic', 0],
  ['storm', 'storm', 0],
  ['turn', 'atlantic', 0],
  ['underwater', 'atlantic', 30],
  ['torpedo-impact', 'atlantic', 0],
  ['shell-impact', 'atlantic', 0],
  ['depth-charge', 'atlantic', 30],
];
for (const [name, state, depth] of cases) {
  if (selectedCase && selectedCase !== name) continue;
  const folder = `artifacts/water-upgrade/native/${name}`;
  await mkdir(folder, { recursive: true });
  const config = defaults();
  Object.assign(config.graphics, PRESETS.mobile);
  Object.assign(config.ocean, SEA_STATES[state]);
  config.graphics.reflections = false;
  config.graphics.waterRefraction = false;
  config.ocean.dayCycle = false;
  const career = newCareer();
  career.depth = career.targetDepth = depth;
  const sim = new Simulation(config, career, { ambientTraffic: false, invulnerable: true });
  const canvas = { width, height, style: {}, addEventListener() {}, removeEventListener() {} },
    view = new View(canvas, sim);
  const scene = view.scene,
    sun = view.light,
    ambient = view.ambient;
  view.updateSun();
  const sunVector = view.sun.clone();
  globalThis.innerWidth = width;
  globalThis.innerHeight = height;
  const envWidth = 384,
    envHeight = 512,
    envData = new Uint16Array(envWidth * envHeight * 4);
  for (let mip = 7; mip >= -2; mip--) {
    const size = 2 ** Math.max(4, mip),
      offsetX = Math.max(0, 4 - mip) * 48,
      offsetY = 4 * (128 - size);
    for (let face = 0; face < 6; face++)
      for (let row = 0; row < size; row++)
        for (let col = 0; col < size; col++) {
          const u = ((col + 0.5) / size) * 2 - 1,
            v = ((row + 0.5) / size) * 2 - 1;
          const rays = [
              [1, v, u],
              [-u, 1, -v],
              [-u, v, 1],
              [-1, v, -u],
              [-u, -1, v],
              [u, v, -1],
            ],
            ray = new THREE.Vector3(...rays[face]).normalize();
          const skyMix = Math.max(0, Math.min(1, ray.y)),
            glow = Math.max(0, ray.dot(sunVector)) ** 64,
            rgb = [
              0.45 * (1 - skyMix) + 0.09 * skyMix + glow * 2,
              0.56 * (1 - skyMix) + 0.25 * skyMix + glow * 1.5,
              0.6 * (1 - skyMix) + 0.4 * skyMix + glow,
            ];
          const x = (face % 3) * size + col + offsetX,
            y = (face > 2 ? size : 0) + row + offsetY,
            index = (y * envWidth + x) * 4;
          if (x >= envWidth || y >= envHeight) continue;
          for (let channel = 0; channel < 3; channel++)
            envData[index + channel] = THREE.DataUtils.toHalfFloat(rgb[channel]);
          envData[index + 3] = THREE.DataUtils.toHalfFloat(1);
        }
  }
  scene.environment = new THREE.DataTexture(
    envData,
    envWidth,
    envHeight,
    THREE.RGBAFormat,
    THREE.HalfFloatType,
  );
  scene.environment.mapping = THREE.CubeUVReflectionMapping;
  scene.environment.isRenderTargetTexture = true;
  const camera = view.camera,
    sky = view.sky;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  view.environmentSun.copy(sunVector);
  view.lastEnvironmentUpdate = performance.now();
  view.environmentCloud = sky.cloudCoverage.value;
  const renderer = new THREE.WebGPURenderer({
    canvas,
    forceWebGL: true,
  });
  renderer._initialized = true;
  renderer.shadowMap.enabled = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.75;
  renderer.backend.extensions = { has: () => false, get: () => null };
  renderer.backend.capabilities = { getUniformBufferLimit: () => 65536 };
  renderer.backend.hasFeature = () => false;
  renderer.getViewport = (target) => target.set(0, 0, width, height);
  renderer.getDrawingBufferSize = (target) => target.set(width, height);
  renderer.getSize = (target) => target.set(width, height);
  renderer.render = () => {};
  view.renderer = renderer;
  view.backend = 'Native preview';
  for (let tick = 0; tick < 30 * 12; tick++) {
    if (name === 'turn' && tick > 120) sim.rudder = 0.7;
    if (tick === Math.round(30 * (12 - impactAge)) && name.includes('impact'))
      sim.waterImpact(name === 'shell-impact' ? 'shell' : 'torpedo', sim.p.x + 45, sim.p.z - 45, 2.5, 1.5);
    if (tick === Math.round(30 * (12 - impactAge)) && name === 'depth-charge')
      sim.waterImpact('depth-charge', sim.p.x + 15, sim.p.z - 15, 35, 1.5);
    sim.update(1 / 30);
    view.render(1 / 30, false, 1 / 30);
  }
  camera.updateMatrixWorld();
  scene.updateMatrixWorld(true);
  const convertedMaterials = new WeakMap();
  const textures = new Map(),
    meshes = [];
  let fileCount = 0;
  async function binary(array) {
    const file = `buffer-${fileCount++}.bin`;
    await writeFile(`${folder}/${file}`, new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
    return file;
  }
  async function textureData(map) {
    if (textures.has(map.uuid)) return textures.get(map.uuid).id;
    const image = map.image || {},
      data = image.data || image.pixels || new Uint8Array([0, 0, 0, 255]),
      record = {
        id: textures.size,
        width: image.width || 1,
        height: image.height || 1,
        type: map.type,
        format: map.format,
        repeat: map.wrapS === THREE.RepeatWrapping,
        mipmaps: map.generateMipmaps,
        srgb: map.colorSpace === THREE.SRGBColorSpace,
        file: await binary(data),
      };
    if (!image.data && !image.pixels) {
      record.width = record.height = 1;
      record.type = THREE.UnsignedByteType;
      record.format = THREE.RGBAFormat;
    }
    textures.set(map.uuid, record);
    return record.id;
  }
  const objects = [];
  scene.traverse((object) => {
    if (!object.isMesh || (object.isInstancedMesh && !object.count)) return;
    for (let parent = object; parent; parent = parent.parent) if (!parent.visible) return;
    objects.push(object);
  });
  objects.sort(
    (a, b) =>
      (a === sky ? -1 : a.material.transparent ? 1 : 0) - (b === sky ? -1 : b.material.transparent ? 1 : 0),
  );
  for (const mesh of objects) {
    mesh.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld);
    mesh.normalMatrix.getNormalMatrix(mesh.modelViewMatrix);
    const builder = renderer.backend.createNodeBuilder(mesh, renderer);
    let nodeMaterial = convertedMaterials.get(mesh.material);
    if (!nodeMaterial) {
      nodeMaterial = renderer.library.fromMaterial(mesh.material);
      if (nodeMaterial === mesh.material) nodeMaterial = nodeMaterial.clone();
      const setupOutput = nodeMaterial.setupOutput.bind(nodeMaterial);
      nodeMaterial.setupOutput = (context, output) =>
        setupOutput(context, output).renderOutput(THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace);
      convertedMaterials.set(mesh.material, nodeMaterial);
    }
    builder.material = nodeMaterial;
    builder.scene = scene;
    builder.camera = camera;
    builder.context.material = nodeMaterial;
    builder.lightsNode = renderer.lighting.createNode([sun, ambient]);
    builder.environmentNode = pmremTexture(scene.environment);
    builder.fogNode = fog(uniform(scene.fog.color), densityFogFactor(uniform(scene.fog.density)));
    builder.build();
    const frame = new NodeFrame();
    frame.renderer = renderer;
    frame.camera = camera;
    frame.object = mesh;
    frame.material = nodeMaterial;
    frame.scene = scene;
    frame.update();
    frame.renderId = 1;
    frame.time = sim.visualTime;
    for (const node of builder.updateNodes) frame.updateNode(node);
    const id = meshes.length;
    await writeFile(`${folder}/mesh-${id}.vert.glsl`, builder.vertexShader);
    await writeFile(`${folder}/mesh-${id}.frag.glsl`, builder.fragmentShader);
    const uniforms = [],
      samplers = [];
    for (const group of builder.getBindings())
      for (const binding of group.bindings) {
        if (binding.isUniformsGroup) {
          binding.update();
          uniforms.push({ name: binding.name, file: await binary(binding.buffer) });
        } else if (binding.isUniformBuffer) {
          uniforms.push({ name: binding.name, file: await binary(binding.buffer) });
        } else if (binding.texture)
          samplers.push({ name: binding.name, texture: await textureData(binding.texture) });
      }
    const attributes = [];
    for (const attribute of builder.getAttributesArray()) {
      const data = mesh.geometry.getAttribute(attribute.name) || attribute.node?.attribute;
      if (data)
        attributes.push({
          name: attribute.name,
          size: data.itemSize,
          file: await binary(data.array),
          stride: data.isInterleavedBufferAttribute ? data.data.stride * 4 : 0,
          offset: data.isInterleavedBufferAttribute ? data.offset * 4 : 0,
          instanced: !!(
            attribute.node?.instanced ||
            data.isInstancedBufferAttribute ||
            data.data?.isInstancedInterleavedBuffer
          ),
        });
    }
    meshes.push({
      id,
      uniforms,
      samplers,
      attributes,
      index: mesh.geometry.index ? await binary(mesh.geometry.index.array) : null,
      indexType: mesh.geometry.index?.array instanceof Uint32Array ? 5125 : 5123,
      count: mesh.geometry.index?.count || mesh.geometry.getAttribute('position').count,
      depthTest: mesh.material.depthTest,
      depthWrite: mesh.material.depthWrite,
      transparent: mesh.material.transparent,
      instances: mesh.isInstancedMesh ? mesh.count : 0,
    });
  }
  await writeFile(
    `${folder}/scene.json`,
    JSON.stringify(
      {
        width,
        height,
        meshes,
        textures: [...textures.values()],
        clear: depth ? [0.015, 0.04, 0.055, 1] : [0.3, 0.4, 0.5, 1],
        scope:
          'Actual View.render scene drawn through native GLES; analytical environment, reflections/refraction disabled, no browser UI',
      },
      null,
      2,
    ),
  );
  sim.dispose();
  console.log(`EXPORTED ${name}: ${meshes.length} meshes, ${textures.size} textures`);
}
