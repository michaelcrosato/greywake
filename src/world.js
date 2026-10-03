export const DEG = 111000;
export const CELL = 6000;
export function wrapCellX(value) {
  const count = (360 * DEG) / CELL;
  return ((((value + count / 2) % count) + count) % count) - count / 2;
}
export const KNOT = 0.514444;
export const TAU = Math.PI * 2;
export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
export const geo = (lon, lat) => ({ x: lon * DEG, z: -lat * DEG });
export const coordinates = (x, z) => ({ lon: x / DEG, lat: -z / DEG });
export function wrapX(x) {
  return ((((x + 180 * DEG) % (360 * DEG)) + 360 * DEG) % (360 * DEG)) - 180 * DEG;
}
export function deltaX(a, b) {
  return wrapX(a - b);
}
export function distance(a, b) {
  return Math.hypot(deltaX(a.x, b.x), a.z - b.z);
}
export function bearing(a, b) {
  return Math.atan2(deltaX(b.x, a.x), a.z - b.z);
}

// Deliberately simplified navigable coastline; all coordinates are authored locally.
export const LAND = [
  [
    [-168, 72],
    [-140, 70],
    [-130, 58],
    [-125, 49],
    [-124, 40],
    [-117, 32],
    [-110, 25],
    [-104, 20],
    [-97, 18],
    [-89, 21],
    [-83, 10],
    [-77, 8],
    [-80, 25],
    [-81, 31],
    [-75, 35],
    [-70, 43],
    [-60, 47],
    [-55, 53],
    [-64, 60],
    [-80, 65],
    [-95, 72],
    [-130, 73],
  ],
  [
    [-81, 12],
    [-72, 11],
    [-61, 10],
    [-51, 4],
    [-35, -5],
    [-40, -22],
    [-48, -29],
    [-53, -34],
    [-66, -55],
    [-72, -51],
    [-75, -36],
    [-81, -7],
  ],
  [
    [-17, 35],
    [-5, 36],
    [10, 37],
    [25, 32],
    [34, 31],
    [43, 12],
    [51, 11],
    [44, -12],
    [35, -25],
    [19, -35],
    [11, -23],
    [8, -4],
    [-6, 5],
    [-16, 16],
  ],
  [
    [-10, 36],
    [-9, 43],
    [-1, 44],
    [-5, 48],
    [4, 51],
    [7, 55],
    [13, 54],
    [20, 60],
    [28, 71],
    [47, 70],
    [60, 72],
    [100, 77],
    [140, 72],
    [178, 66],
    [170, 52],
    [147, 45],
    [139, 35],
    [130, 30],
    [122, 23],
    [109, 20],
    [107, 10],
    [103, 1],
    [99, 7],
    [94, 18],
    [88, 21],
    [80, 8],
    [73, 20],
    [65, 25],
    [57, 25],
    [50, 30],
    [43, 37],
    [40, 42],
    [29, 41],
    [27, 37],
    [24, 40],
    [20, 40],
    [18, 45],
    [12, 45],
    [16, 39],
    [12, 37],
    [8, 43],
    [0, 42],
  ],
  [
    [-8, 50],
    [-5, 50],
    [-1, 53],
    [-3, 59],
    [-6, 58],
    [-7, 55],
  ],
  [
    [-11, 51],
    [-6, 52],
    [-6, 55],
    [-10, 55],
  ],
  [
    [-52, 59],
    [-42, 60],
    [-22, 70],
    [-20, 80],
    [-48, 83],
    [-60, 75],
  ],
  [
    [-24, 64],
    [-13, 64],
    [-14, 67],
    [-22, 67],
  ],
  [
    [113, -22],
    [122, -15],
    [130, -12],
    [138, -17],
    [146, -14],
    [153, -27],
    [151, -37],
    [138, -39],
    [130, -32],
    [115, -35],
  ],
  [
    [47, -13],
    [50, -17],
    [48, -25],
    [44, -26],
    [43, -18],
  ],
  [
    [130, 31],
    [141, 40],
    [145, 44],
    [142, 45],
    [135, 36],
  ],
  [
    [95, 5],
    [106, -6],
    [114, -8],
    [119, -4],
    [116, 5],
    [109, 7],
    [104, 1],
  ],
  [
    [166, -35],
    [179, -39],
    [172, -47],
    [166, -45],
  ],
  [
    [-85, 22],
    [-74, 20],
    [-77, 23],
  ],
];

export const PORTS = [
  { name: 'Lorient', lon: -3.6, lat: 47.5, region: 'Bay of Biscay' },
  { name: 'Las Palmas', lon: -16.5, lat: 28, region: 'Canary Islands' },
  { name: 'Horta', lon: -28.8, lat: 38.5, region: 'Azores' },
  { name: 'Casablanca', lon: -8.2, lat: 33.7, region: 'Eastern Atlantic' },
  { name: 'Cape Town', lon: 17.5, lat: -34.5, region: 'South Atlantic' },
  { name: 'Buenos Aires', lon: -55, lat: -35, region: 'South Atlantic' },
  { name: 'Penang', lon: 97.5, lat: 5, region: 'Indian Ocean' },
  { name: 'Surabaya', lon: 113, lat: -9, region: 'Java Sea' },
  { name: 'Truk', lon: 151.8, lat: 7.4, region: 'Western Pacific' },
  { name: 'Valparaiso', lon: -72.5, lat: -33, region: 'Eastern Pacific' },
].map((p) => ({ ...p, ...geo(p.lon, p.lat) }));

export const LANES = [
  [
    [-72, 40],
    [-45, 46],
    [-17, 49],
    [-8, 50],
  ],
  [
    [-65, 43],
    [-34, 40],
    [-12, 38],
    [-7, 35],
  ],
  [
    [-75, 30],
    [-40, 20],
    [-17, 10],
    [-4, -7],
    [15, -34],
  ],
  [
    [15, -34],
    [50, -20],
    [75, 2],
    [98, 6],
  ],
  [
    [-120, 35],
    [-150, 22],
    [-175, 24],
    [155, 32],
  ],
  [
    [145, 30],
    [150, 10],
    [140, -10],
    [154, -30],
  ],
  [
    [-75, 7],
    [-87, -4],
    [-80, -25],
  ],
  [
    [-50, 5],
    [-40, -15],
    [-55, -35],
  ],
];

function inside(lon, lat, poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i],
      [xj, yj] = poly[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
export function isLand(x, z) {
  const { lon, lat } = coordinates(wrapX(x), z);
  return Math.abs(lat) > 78 || LAND.some((poly) => inside(lon, lat, poly));
}

export function regionName(x, z) {
  const { lon, lat } = coordinates(x, z);
  if (lon > -7 && lon < 37 && lat > 29 && lat < 45) return 'Mediterranean Sea';
  if (lon > -80 && lon < 20) return lat > 0 ? 'North Atlantic' : 'South Atlantic';
  if (lon > 20 && lon < 110 && lat < 26) return 'Indian Ocean';
  return lat > 0 ? 'North Pacific' : 'South Pacific';
}

export function random(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const cellSeed = (x, z, cycle = 0) =>
  Math.imul(x, 73856093) ^ Math.imul(z, 19349663) ^ Math.imul(cycle, 83492791);

export function shippingHeading(x, z) {
  const p = coordinates(x, z);
  let best = Infinity,
    heading = Math.PI / 2;
  for (const lane of LANES)
    for (let i = 1; i < lane.length; i++) {
      const a = geo(...lane[i - 1]),
        b = geo(...lane[i]);
      const dx = deltaX(b.x, a.x),
        dz = b.z - a.z;
      const t = clamp((deltaX(x, a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
      const d = Math.hypot(deltaX(x, a.x + dx * t), z - (a.z + dz * t));
      if (d < best) {
        best = d;
        heading = Math.atan2(dx, -dz);
      }
    }
  return { heading, density: best < DEG * 4 ? 1 : 0.3, region: regionName(p.lon * DEG, -p.lat * DEG) };
}

export const WAVES = [
  [110, 0.62, 0.85, 0.53],
  [57, 0.3, -0.45, 0.89],
  [29, 0.17, 0.94, -0.34],
  [16, 0.08, 0.2, 0.98],
  [8, 0.035, -0.8, 0.6],
  [4, 0.015, 0.65, -0.76],
];
export function waveHeight(x, z, time, config, weather = 0) {
  let y = 0;
  for (const [length, amp, dx, dz] of WAVES) {
    const k = TAU / length;
    y += Math.sin(k * (x * dx + z * dz) - Math.sqrt(9.81 * k) * time * config.ocean.waveSpeed) * amp;
  }
  return y * config.ocean.waveHeight * (1 + weather);
}

export function segmentClear(a, b, spacing = DEG * 0.5) {
  const dx = deltaX(b.x, a.x),
    dz = b.z - a.z;
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / spacing));
  for (let i = 1; i <= n; i++) if (isLand(a.x + (dx * i) / n, a.z + (dz * i) / n)) return false;
  return true;
}

// A* over a wrapped 2-degree ocean grid. Every returned segment is checked against land.
export function planRoute(start, end) {
  if (isLand(end.x, end.z)) return null;
  if (segmentClear(start, end)) return [{ ...end }];
  const nx = 180,
    nz = 76,
    step = DEG * 2;
  const id = (x, z) => z * nx + ((x + nx) % nx);
  const point = (k) => ({ x: ((k % nx) * 2 - 179) * DEG, z: (Math.floor(k / nx) * 2 - 75) * DEG });
  function nearest(p) {
    const ix = Math.round((p.x / DEG + 179) / 2),
      iz = clamp(Math.round((p.z / DEG + 75) / 2), 0, nz - 1);
    let best = null,
      dist = Infinity;
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++) {
        if (iz + dz < 0 || iz + dz >= nz) continue;
        const k = id(ix + dx, iz + dz),
          q = point(k),
          d = distance(p, q);
        if (!isLand(q.x, q.z) && d < dist && segmentClear(p, q)) {
          best = k;
          dist = d;
        }
      }
    return best;
  }
  const from = nearest(start),
    goal = nearest(end);
  if (from === null || goal === null) return null;
  const open = new Set([from]),
    came = new Map(),
    g = new Map([[from, 0]]),
    f = new Map([[from, distance(point(from), end)]]);
  let found = false;
  for (let count = 0; count < nx * nz && open.size; count++) {
    let current,
      score = Infinity;
    for (const k of open)
      if (f.get(k) < score) {
        score = f.get(k);
        current = k;
      }
    if (current === goal) {
      found = true;
      break;
    }
    open.delete(current);
    const x = current % nx,
      z = Math.floor(current / nx),
      a = point(current);
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dz) || z + dz < 0 || z + dz >= nz) continue;
        const k = id(x + dx, z + dz),
          b = point(k);
        if (isLand(b.x, b.z) || !segmentClear(a, b, step / 6)) continue;
        const cost = g.get(current) + Math.hypot(dx, dz) * step;
        if (cost < (g.get(k) ?? Infinity)) {
          came.set(k, current);
          g.set(k, cost);
          f.set(k, cost + distance(b, end));
          open.add(k);
        }
      }
  }
  if (!found) return null;
  const raw = [end];
  let k = goal;
  while (k !== from) {
    raw.unshift(point(k));
    k = came.get(k);
  }
  raw.unshift(point(from));
  const route = [];
  let a = start,
    i = 0;
  while (i < raw.length) {
    let last = i;
    for (let j = i; j < raw.length; j++)
      if (segmentClear(a, raw[j])) last = j;
      else break;
    route.push(raw[last]);
    a = raw[last];
    i = last + 1;
  }
  return route;
}
