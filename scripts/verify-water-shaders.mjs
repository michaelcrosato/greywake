import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import * as THREE from 'three/webgpu';
import { defaults, PRESETS } from '../src/config.js';
import { Ocean } from '../src/ocean.js';
import { newWaterMotion, OceanSurface } from '../src/water-surface.js';

const output = 'artifacts/water-upgrade/shaders';
await mkdir(output, { recursive: true });
const report = [];
// Generate shaders with the actual bundled builders without requiring browser sockets.
// This checks the TSL graphs and their backend output, not browser rendering or frame rate.
for (const backend of ['webgl', 'webgpu']) {
  for (const shadows of [false, true]) {
    const config = defaults();
    Object.assign(config.graphics, PRESETS.mobile);
    const scene = new THREE.Scene(),
      sun = new THREE.DirectionalLight();
    sun.castShadow = true;
    scene.environment = new THREE.DataTexture(
      new Uint16Array(768 * 1024 * 4),
      768,
      1024,
      THREE.RGBAFormat,
      THREE.HalfFloatType,
    );
    scene.environment.mapping = THREE.CubeUVReflectionMapping;
    scene.environment.isRenderTargetTexture = true;
    const surface = new OceanSurface(config),
      ocean = new Ocean(scene, config, sun, surface);
    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(6, 6, 66),
      new THREE.MeshStandardMaterial({ color: 0x59675f }),
    );
    ocean.wetMaterials(hull, newWaterMotion());
    scene.add(hull);
    const canvas = { width: 960, height: 600, style: {}, addEventListener() {}, removeEventListener() {} },
      renderer = new THREE.WebGPURenderer({ canvas, forceWebGL: backend === 'webgl' });
    renderer.backend.extensions = {
      has() {
        return false;
      },
      get() {
        return null;
      },
    };
    renderer.backend.capabilities = {
      getUniformBufferLimit() {
        return 65536;
      },
    };
    renderer._initialized = true;
    renderer.shadowMap.enabled = shadows;
    renderer.backend.hasFeature = () => false;
    renderer.backend.hasCompatibility = () => true;
    for (const [kind, mesh] of [
      ['ocean', ocean.meshes[0]],
      ['wet-hull', hull],
    ]) {
      const builder = renderer.backend.createNodeBuilder(mesh, renderer);
      builder.camera = new THREE.PerspectiveCamera(52, 1.6, 0.2, 40000);
      builder.scene = scene;
      builder.camera.position.set(-60, 36, 100);
      builder.camera.lookAt(0, 0, -15);
      builder.camera.updateMatrixWorld(true);
      mesh.updateMatrixWorld(true);
      builder.build();
      assert.ok(builder.vertexShader.length > 500 && builder.fragmentShader.length > 500);
      assert.ok(!builder.fragmentShader.includes('NaN'));
      const suffix = backend === 'webgl' ? 'glsl' : 'wgsl',
        name = `${backend}-${kind}-${shadows ? 'shadows' : 'plain'}`;
      await writeFile(`${output}/${name}.vert.${suffix}`, builder.vertexShader);
      await writeFile(`${output}/${name}.frag.${suffix}`, builder.fragmentShader);
      const samplers = (builder.fragmentShader.match(/uniform sampler\w+/g) || []).length;
      if (backend === 'webgl') assert.ok(samplers <= 16, `Too many fragment samplers: ${samplers}`);
      report.push({
        backend,
        kind,
        shadows,
        vertexBytes: builder.vertexShader.length,
        fragmentBytes: builder.fragmentShader.length,
        samplers,
      });
      console.log(
        `PASS ${name} (${builder.fragmentShader.length} fragment bytes, ${samplers} GLSL samplers)`,
      );
    }
  }
}
await writeFile(
  `${output}/report.json`,
  JSON.stringify(
    { scope: 'Actual Three.js shader generation; browser/GPU execution is separate', cases: report },
    null,
    2,
  ),
);
