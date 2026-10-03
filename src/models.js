import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as THREE from 'three/webgpu';
import { random } from './world.js';

export function metalTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d'),
    image = ctx.createImageData(256, 256),
    rng = random(96);
  for (let i = 0; i < image.data.length; i += 4) {
    const v = 125 + rng() * 65,
      rust = rng() < 0.12;
    image.data[i] = rust ? 122 : v;
    image.data[i + 1] = rust ? 85 : v + 5;
    image.data[i + 2] = rust ? 54 : v + 5;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  ctx.strokeStyle = '#454c4888';
  ctx.lineWidth = 1;
  for (let y = 0; y < 256; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function buildModels() {
  const tex = metalTexture();
  const steel = new THREE.MeshStandardMaterial({
    color: 0x8d9994,
    roughness: 0.62,
    metalness: 0.5,
    map: tex,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x253c40, roughness: 0.62, metalness: 0.6, map: tex });
  const rail = new THREE.MeshStandardMaterial({ color: 0x505f5c, metalness: 0.7, roughness: 0.4 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x3b3831, roughness: 0.95 });
  const black = new THREE.MeshStandardMaterial({ color: 0x111b1d, roughness: 0.8 });
  const brass = new THREE.MeshStandardMaterial({ color: 0x928054, roughness: 0.3, metalness: 0.8 });
  const cream = new THREE.MeshStandardMaterial({ color: 0xb4b4a2, roughness: 0.8, map: tex });
  const red = new THREE.MeshStandardMaterial({ color: 0x55332c, roughness: 0.8 });
  const containers = [0x686a54, 0x614f3a, 0x52616a].map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, map: tex }),
  );
  function box(group, x, y, z, sx, sy, sz, mat = steel) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  }
  function cylinder(group, x, y, z, radius, length, mat = rail, rotation = null) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 10), mat);
    m.position.set(x, y, z);
    if (rotation) m.rotation.set(...rotation);
    group.add(m);
    return m;
  }
  function line(group, points, radius = 0.04, mat = rail) {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, points.length * 4, radius, 5, false), mat);
    group.add(m);
  }
  function hull(group, profiles, mat, centerY = 0, widthScale = 1) {
    const vertices = [],
      indices = [],
      uv = [],
      n = 24;
    for (const [z, r] of profiles)
      for (let j = 0; j <= n; j++) {
        const a = (j / n) * Math.PI * 2;
        vertices.push(Math.cos(a) * r * widthScale, centerY + Math.sin(a) * r, z);
        uv.push((j / n) * 3, z / 12);
      }
    for (let i = 0; i < profiles.length - 1; i++)
      for (let j = 0; j < n; j++) {
        const a = i * (n + 1) + j,
          b = a + n + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    group.add(new THREE.Mesh(g, mat));
  }
  function merge(group) {
    group.updateMatrixWorld(true);
    const groups = new Map();
    group.traverse((obj) => {
      if (obj.isMesh) {
        const g = obj.geometry.clone().applyMatrix4(obj.matrixWorld);
        if (!g.attributes.uv)
          g.setAttribute(
            'uv',
            new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2),
          );
        const list = groups.get(obj.material) || [];
        list.push(g);
        groups.set(obj.material, list);
      }
    });
    const result = new THREE.Group();
    for (const [mat, geos] of groups) {
      const m = new THREE.Mesh(mergeGeometries(geos, false), mat);
      m.castShadow = true;
      m.receiveShadow = true;
      result.add(m);
      for (const g of geos) g.dispose();
    }
    group.traverse((obj) => {
      if (obj.isMesh) obj.geometry.dispose();
    });
    return result;
  }
  const sub = new THREE.Group();
  hull(
    sub,
    [
      [-33, 0.06],
      [-31, 0.75],
      [-27, 2],
      [-20, 2.7],
      [-7, 3.05],
      [9, 3],
      [23, 2.1],
      [30, 0.7],
      [33, 0.04],
    ],
    dark,
    0,
    1.08,
  );
  hull(
    sub,
    [
      [-30, 0.05],
      [-26, 1.1],
      [-18, 1.65],
      [18, 1.65],
      [28, 0.15],
    ],
    steel,
    2.1,
    1.65,
  );
  for (let z = -28; z <= 28; z += 0.65) {
    const width = Math.min(5.1, (30 - Math.abs(z)) * 0.42);
    box(sub, 0, 3.05, z, width, 0.1, 0.5, wood);
  }
  for (const sign of [-1, 1]) {
    for (let z = -26; z < 28; z += 3.5) {
      const x = sign * Math.min(2.5, (31 - Math.abs(z)) * 0.32);
      cylinder(sub, x, 3.7, z, 0.035, 1.3);
    }
    line(
      sub,
      [
        [sign * 0.2, 3.8, -31],
        [sign * 2.5, 4.3, -22],
        [sign * 2.6, 4.3, 0],
        [sign * 2.4, 4.3, 22],
        [sign * 0.1, 3.7, 31],
      ],
      0.025,
    );
    for (let z = -22; z < 24; z += 1.4) box(sub, sign * 2.7, 2.5, z, 0.025, 0.28, 0.65, black);
    line(
      sub,
      [
        [sign * 0.2, 4, -29],
        [sign * 2, 9.7, 1],
        [sign * 0.15, 4, 30],
      ],
      0.027,
    );
  }
  const tower = cylinder(sub, 0, 5.3, 2, 2.2, 4.7, steel);
  tower.scale.z = 1.6;
  box(sub, 0, 7.65, 1.4, 4.1, 0.25, 5.6, dark);
  for (let z = -0.6; z < 4; z += 0.7) for (const sign of [-1, 1]) cylinder(sub, sign * 2, 8.3, z, 0.045, 1.4);
  line(
    sub,
    [
      [-2, 9, -1],
      [-2, 9, 4],
      [0, 9, 5],
      [2, 9, 4],
      [2, 9, -1],
    ],
    0.055,
  );
  cylinder(sub, -0.7, 9.3, 0.4, 0.13, 6.2);
  cylinder(sub, 0.7, 9.2, 1.8, 0.16, 5.8);
  box(sub, -0.7, 12.3, 0.3, 0.28, 0.4, 0.6, black);
  cylinder(sub, 0, 4.1, -9, 0.65, 2, rail);
  box(sub, 0, 5.1, -9.2, 1.2, 0.9, 2, steel);
  cylinder(sub, 0, 5.35, -12, 0.14, 5, black, [Math.PI / 2, 0, 0]);
  cylinder(sub, -0.45, 5.2, -9, 0.4, 0.14, brass, [0, 0, Math.PI / 2]);
  cylinder(sub, 0, 8.2, 5.5, 0.25, 1.2);
  cylinder(sub, 0, 9, 6, 0.08, 2, black, [Math.PI / 2, 0, 0]);
  for (const z of [-18, 17, 24]) {
    cylinder(sub, 0, 3.3, z, 0.6, 0.3, rail);
    box(sub, 0, 3.5, z, 0.5, 0.12, 0.06, brass);
  }
  box(sub, 0, -2, 30, 6.7, 0.2, 3, dark);
  box(sub, 0, -1.8, 32, 0.2, 4, 2, dark);
  for (const sign of [-1, 1]) {
    cylinder(sub, sign * 1.6, -1.4, 31.5, 0.25, 3, brass, [Math.PI / 2, 0, 0]);
    for (let j = 0; j < 3; j++) {
      const b = box(sub, sign * 1.6, -1.4, 33, 2, 0.2, 0.5, brass);
      b.rotation.z = (j * Math.PI) / 3;
    }
  }

  function shipModel(escort) {
    const g = new THREE.Group(),
      width = escort ? 4.8 : 8;
    hull(
      g,
      [
        [-58, 0.05],
        [-51, 3],
        [-42, 5.5],
        [-25, 6.5],
        [28, 6.5],
        [48, 4.5],
        [56, 0.4],
      ],
      red,
      -2.8,
      width / 6.5,
    );
    box(g, 0, 2.8, -1, width * 1.85, 0.6, 93, dark);
    hull(
      g,
      [
        [-56, 0.1],
        [-48, 3],
        [-37, 4],
        [31, 4],
        [49, 2.5],
        [55, 0.2],
      ],
      steel,
      0.4,
      width / 4,
    );
    box(g, 0, 4.6, 15, width * 1.7, 4, 22, cream);
    box(g, 0, 7.5, 13, width * 1.25, 3, 12, cream);
    box(g, 0, 9.8, 11, width, 1.4, 7, steel);
    for (let x = -width / 2; x < width / 2; x += 1.5) box(g, x, 8.2, 6.85, 1, 0.8, 0.05, black);
    cylinder(g, 0, 12, 23, escort ? 1.4 : 2, 9, rail);
    cylinder(g, 0, 16.6, 23, escort ? 1.5 : 2.1, 0.8, black);
    cylinder(g, 0, 13, -21, 0.2, 20);
    cylinder(g, 0, 13, 37, 0.18, 20);
    for (const z of [-21, 37]) {
      cylinder(g, 0, 19, z, 0.12, 17, rail, [0, 0, Math.PI / 2]);
      for (const s of [-1, 1])
        line(
          g,
          [
            [s * width, 3, z - 12],
            [0, 23, z],
            [s * width, 3, z + 12],
          ],
          0.035,
        );
    }
    if (escort)
      for (const z of [-36, -15, 36]) {
        cylinder(g, 0, 4.2, z, 1.6, 2.5, steel);
        box(g, 0, 5.5, z, 3, 2, 3.5, steel);
        cylinder(g, 0, 5.8, z - 3, 0.2, 5, black, [Math.PI / 2, 0, 0]);
      }
    else
      for (const z of [-38, -26, -12, 40]) {
        box(g, 0, 4.6, z, width * 1.6, 2, 10, containers[Math.abs(z) % 3]);
        for (const s of [-1, 1]) box(g, s * 5, 6.3, z, 3, 1.5, 8, containers[(Math.abs(z) + 1) % 3]);
      }
    for (const s of [-1, 1]) {
      line(
        g,
        [
          [s * 1, 5, -53],
          [s * width, 5, -35],
          [s * width, 5, 37],
          [s * 1, 5, 53],
        ],
        0.045,
      );
      for (let z = -40; z < 44; z += 6) cylinder(g, s * width, 4.25, z, 0.05, 1.6);
      const lifeboat = cylinder(g, s * width, 7, 26, 0.9, 6, wood, [Math.PI / 2, 0, 0]);
      lifeboat.scale.x = 1.5;
    }
    return merge(g);
  }
  return { sub: merge(sub), merchant: shipModel(false), escort: shipModel(true) };
}
