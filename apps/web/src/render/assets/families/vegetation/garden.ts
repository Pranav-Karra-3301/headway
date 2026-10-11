// Owner: A5. Low vegetation: bush clusters, clipped hedges, flowerbeds and street planters.
// Flowers are tiny flat inverted cones ("cups") sitting on a surface: cheap (12 triangles), read as dots of colour.
import * as THREE from 'three';
import type { AssetParams, KitContext } from '../../types';
import { at, choices, int, keyed, rooted, squash, weighted } from './util';

const UP = new THREE.Vector3(0, 1, 0);

/** A flower cup at `p` opening along the surface normal `n`. */
function cup(k: KitContext, m: THREE.Material, p: THREE.Vector3, n: THREE.Vector3, r = 0.065, h = 0.05): THREE.Mesh {
  const c = k.cone(r, h, m, 6);
  const nn = n.clone().normalize();
  c.quaternion.setFromUnitVectors(UP, nn.clone().negate());
  c.position.copy(p).addScaledVector(nn, h * 0.22);
  return c;
}

/** Point + normal on an ellipsoid (centre c, radii a) at azimuth th and polar angle ph (0 = top). */
function onEllipsoid(c: THREE.Vector3, a: THREE.Vector3, th: number, ph: number) {
  const sx = Math.sin(ph) * Math.cos(th), sy = Math.cos(ph), sz = Math.sin(ph) * Math.sin(th);
  return { p: new THREE.Vector3(c.x + a.x * sx, c.y + a.y * sy, c.z + a.z * sz), n: new THREE.Vector3(sx / a.x, sy / a.y, sz / a.z) };
}

// ---------- bush: low cluster of squashed balls, some in flower ----------
type Ball = readonly [r: number, x: number, y: number, z: number, seg: number, alt?: boolean];
const BUSH: readonly { balls: readonly Ball[]; flowers: number }[] = [
  { balls: [[0.37, 0.02, 0.33, 0.02, 10], [0.28, 0.18, 0.25, 0.10, 9], [0.26, -0.20, 0.23, -0.10, 9, true]], flowers: 0 },
  { balls: [[0.36, -0.03, 0.32, 0.03, 10], [0.29, 0.17, 0.25, -0.12, 9, true], [0.25, -0.10, 0.22, 0.21, 9]], flowers: 5 },
  { balls: [[0.38, 0.04, 0.34, -0.02, 10], [0.27, -0.21, 0.24, 0.05, 9, true], [0.24, 0.10, 0.21, 0.24, 9]], flowers: 0 },
  { balls: [[0.35, 0, 0.31, 0, 10], [0.28, -0.17, 0.24, -0.13, 9], [0.26, 0.20, 0.23, 0.06, 9, true]], flowers: 6 },
];
const BUSH_SQUASH = 0.86;

export function buildBush(k: KitContext, params: AssetParams): THREE.Object3D {
  const r = choices(k, params);
  const shape = int(r, BUSH.length), tone = int(r, 3), size = int(r, 2), yaw = int(r, 4), bloom = int(r, 5);
  const L = BUSH[shape]!;
  const key = `${shape}.${tone}.${size}.${yaw}${L.flowers ? `.f${bloom}` : ''}`;
  const g = new THREE.Group();
  g.scale.setScalar(size ? 1 : 0.9);
  g.rotation.y = (yaw / 4) * Math.PI * 2 + 0.3;
  const main = k.mat('vegBush', tone), alt = k.mat('vegBush', (tone + 1) % 3);
  for (const [rad, x, y, z, seg, a] of L.balls) g.add(squash(at(k.sphere(rad, a ? alt : main, seg), x, y, z), 1, BUSH_SQUASH));
  if (L.flowers) {
    const [rad, x, y, z] = L.balls[0]!;
    const fl = k.mat('vegFlower', bloom), c = new THREE.Vector3(x, y, z), a = new THREE.Vector3(rad, rad * BUSH_SQUASH, rad);
    for (let i = 0; i < L.flowers; i++) {
      const { p, n } = onEllipsoid(c, a, i * 2.39996 + shape, 0.45 + (i % 3) * 0.3);
      g.add(k.detail(cup(k, fl, p, n, 0.06, 0.045)));
    }
  }
  return rooted('veg.bush', key, g);
}

// ---------- hedge: one clipped rounded block, params.length long, sometimes in flower ----------
export function buildHedge(k: KitContext, params: AssetParams): THREE.Object3D {
  const r = choices(k, params);
  const len = typeof params.length === 'number' && Number.isFinite(params.length) ? Math.max(0.6, Math.min(60, params.length)) : 3;
  const tone = int(r, 2), deco = weighted(r, [2, 1, 1]);
  const key = `${tone}.${deco}.L${len.toFixed(2)}`;
  const g = new THREE.Group();
  const H = 0.74, D = 0.72;
  g.add(at(k.rbox(len - 0.04, H, D, 0.22, k.mat('vegHedge', tone)), 0, H / 2, 0));
  if (deco) {
    const fl = k.mat('vegFlower', deco === 1 ? 2 : 0);
    const n = Math.max(3, Math.min(9, Math.round(len * 2)));
    const d = keyed(key);
    for (let i = 0; i < n; i++) {
      const x = -len / 2 + 0.3 + ((i + 0.5) / n) * (len - 0.6) + (d() - 0.5) * 0.12;
      const side = i % 3; // top, front, back
      const p = side === 0 ? new THREE.Vector3(x, H, (d() - 0.5) * 0.3) : new THREE.Vector3(x, 0.34 + d() * 0.26, side === 1 ? D / 2 : -D / 2);
      const nrm = side === 0 ? UP : new THREE.Vector3(0, 0, side === 1 ? 1 : -1);
      g.add(k.detail(cup(k, fl, p, nrm, 0.06, 0.045)));
    }
  }
  return rooted('veg.hedge', key, g);
}

// ---------- flowerbed: oval stone edging, dark soil, a green mound dotted with flowers ----------
const BED_PAIRS: readonly (readonly [number, number])[] = [[0, 2], [1, 4], [3, 2], [0, 1], [4, 1]];
/** Flower spots in mound-unit coordinates (u along x, v along z), 2 staggered rows. */
const BED_SPOTS: readonly (readonly [number, number])[] = [
  [-0.78, -0.18], [-0.6, 0.4], [-0.48, -0.5], [-0.3, 0.12], [-0.14, -0.38], [0.02, 0.52], [0.12, -0.04], [0.26, -0.56],
  [0.36, 0.34], [0.52, -0.2], [0.68, 0.36], [0.8, -0.06], [-0.68, 0.0], [-0.12, 0.3], [0.4, 0.0], [-0.38, -0.12],
];

export function buildFlowerbed(k: KitContext, params: AssetParams): THREE.Object3D {
  const r = choices(k, params);
  const pattern = int(r, 3), pair = int(r, BED_PAIRS.length), tone = int(r, 3);
  const key = `${pattern}.${pair}.${tone}`;
  const g = new THREE.Group();
  g.add(squash(at(k.cyl(1, 1, 0.14, k.mat('vegEdge'), 20), 0, 0.07, 0), 0.98, 1, 0.48));
  g.add(squash(at(k.cyl(1, 1, 0.04, k.mat('vegSoil'), 20), 0, 0.14, 0), 0.9, 1, 0.41));
  const mound = new THREE.Vector3(0.84, 0.17, 0.36), c = new THREE.Vector3(0, 0.17, 0);
  g.add(squash(at(k.sphere(1, k.mat('vegBed', tone), 12), c.x, c.y, c.z), mound.x, mound.y, mound.z));
  const [a, b] = BED_PAIRS[pair]!;
  const ca = k.mat('vegFlower', a), cb = k.mat('vegFlower', b);
  BED_SPOTS.forEach(([u, v], i) => {
    const w = Math.sqrt(Math.max(0.02, 1 - u * u - v * v));
    const p = new THREE.Vector3(c.x + mound.x * u, c.y + mound.y * w, c.z + mound.z * v);
    const n = new THREE.Vector3(u / mound.x, w / mound.y, v / mound.z);
    // patterns: 0 = mixed, 1 = front/back rows, 2 = drift of one colour with a few accents
    const useB = pattern === 0 ? i % 2 === 1 : pattern === 1 ? v > 0.1 : i % 4 === 3;
    g.add(cup(k, useB ? cb : ca, p, n, 0.075, 0.05));
  });
  return rooted('veg.flowerbed', key, g);
}

// ---------- planter: timber/terracotta box or round pot with a ball, cone topiary, flowers or a bush ----------
export function buildPlanter(k: KitContext, params: AssetParams): THREE.Object3D {
  const r = choices(k, params);
  const pot = weighted(r, [2, 1]), colour = int(r, 4), tone = int(r, 3), bloom = int(r, 5);
  const shrub = pot === 0 ? int(r, 3) : int(r, 4); // 3 = bush (round pots only, keeps the box within budget)
  const key = `${pot}.${colour}.${shrub}.${tone}${shrub === 2 ? `.f${bloom}` : ''}`;
  const g = new THREE.Group();
  const pm = k.mat('vegPot', colour);
  let top: number;
  if (pot === 0) {
    g.add(at(k.rbox(0.84, 0.44, 0.84, 0.08, pm), 0, 0.22, 0));
    g.add(at(k.cyl(0.35, 0.35, 0.02, k.mat('vegSoil'), 12), 0, 0.445, 0));
    top = 0.45;
  } else {
    g.add(at(k.cyl(0.37, 0.29, 0.42, pm, 14), 0, 0.21, 0));
    g.add(at(k.cyl(0.41, 0.41, 0.08, pm, 14), 0, 0.42, 0));
    g.add(at(k.cyl(0.35, 0.35, 0.02, k.mat('vegSoil'), 12), 0, 0.455, 0));
    top = 0.46;
  }
  const green = k.mat('vegBush', tone);
  if (shrub === 0) {
    g.add(squash(at(k.sphere(0.33, green, 13), 0, top + 0.3, 0), 1, 0.94));
  } else if (shrub === 1) {
    g.add(at(k.cyl(0.035, 0.045, 0.14, k.mat('trunk'), 6), 0, top + 0.05, 0));
    g.add(at(k.cone(0.29, 0.54, k.mat('pine', tone % 2), 14), 0, top + 0.1 + 0.27, 0));
  } else if (shrub === 2) {
    const c = new THREE.Vector3(0, top + 0.06, 0), a = new THREE.Vector3(0.36, 0.18, 0.36);
    g.add(squash(at(k.sphere(0.36, k.mat('vegBed', tone), 11), c.x, c.y, c.z), 1, 0.5));
    const fl = k.mat('vegFlower', bloom), fl2 = k.mat('vegFlower', 2);
    for (let i = 0; i < 7; i++) {
      const { p, n } = i === 0 ? onEllipsoid(c, a, 0, 0) : onEllipsoid(c, a, i * 1.047 + 0.3, 0.72);
      g.add(cup(k, i % 3 === 2 ? fl2 : fl, p, n, 0.075, 0.05));
    }
  } else {
    const alt = k.mat('vegBush', (tone + 1) % 3);
    g.add(squash(at(k.sphere(0.26, green, 9), 0.02, top + 0.22, 0.02), 1, 0.9));
    g.add(squash(at(k.sphere(0.2, alt, 9), 0.17, top + 0.13, -0.08), 1, 0.9));
    g.add(squash(at(k.sphere(0.19, green, 9), -0.14, top + 0.12, -0.12), 1, 0.9));
  }
  return rooted('veg.planter', key, g);
}
