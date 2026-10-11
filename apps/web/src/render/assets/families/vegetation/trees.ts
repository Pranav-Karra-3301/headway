// Owner: A5. The six trees. Rounded primitives only: tapered trunks, sphere/ellipsoid crowns, stacked cones.
// Each tree picks (shape, tone, size, yaw) from one k.rand(); every crown part stays inside a circle of the
// catalog footprint so any yaw keeps the tree inside its footprint.
import * as THREE from 'three';
import type { AssetParams, KitContext } from '../../types';
import { at, choices, int, limb, rooted, squash } from './util';

const TREE_SIZES = [0.88, 0.94, 1.0] as const;
const YAW_STEPS = 5;

/** One crown blob: radius, centre, vertical squash, sphere segments, alt tone. */
type Blob = readonly [r: number, x: number, y: number, z: number, sy: number, seg: number, alt?: boolean];

function frame(size: number, yaw: number): THREE.Group {
  const g = new THREE.Group();
  g.scale.setScalar(size);
  g.rotation.y = (yaw / YAW_STEPS) * Math.PI * 2;
  return g;
}

function blobs(k: KitContext, g: THREE.Object3D, list: readonly Blob[], main: THREE.Material, alt: THREE.Material): void {
  for (const [r, x, y, z, sy, seg, a] of list) g.add(squash(at(k.sphere(r, a ? alt : main, seg), x, y, z), 1, sy));
}

/** Tapered trunk from the ground to `h`, optional root flare. */
function trunk(k: KitContext, g: THREE.Object3D, rb: number, rt: number, h: number, m: THREE.Material, flare = false): void {
  g.add(at(k.cyl(rt, rb, h, m, 8), 0, h / 2, 0));
  if (flare) g.add(at(k.cyl(rb, rb * 1.32, 0.09, m, 8), 0, 0.045, 0));
}

/** (main, alt) tone pairs for 3-tone roles (two-tone blossom): mid + light top, dark + mid, light + mid. */
const PAIRS3 = [[0, 1], [2, 0], [1, 0]] as const;

function pickTree(k: KitContext, params: AssetParams, shapes: number, tones: number, yaw = true) {
  const r = choices(k, params);
  const shape = int(r, shapes), tone = int(r, tones), size = int(r, TREE_SIZES.length), y = yaw ? int(r, YAW_STEPS) : 0;
  return { shape, tone, size, yaw: y, key: `${shape}.${tone}.${size}.${y}`, g: frame(TREE_SIZES[size]!, y) };
}

// ---------- oak: broad, lumpy "cloud" crown on a stout trunk ----------
const OAK: readonly (readonly Blob[])[] = [
  [[0.80, 0, 1.56, 0, 0.82, 13], [0.46, -0.38, 1.90, 0.12, 0.95, 10], [0.44, 0.36, 1.96, -0.16, 0.95, 10]],
  [[0.78, 0, 1.56, 0, 0.85, 13], [0.46, 0.06, 2.08, -0.04, 0.95, 10], [0.42, -0.44, 1.74, 0.12, 0.95, 10]],
  [[0.82, 0, 1.60, 0, 0.78, 13], [0.44, 0.40, 1.86, 0.12, 0.9, 10], [0.42, -0.36, 1.90, -0.20, 0.9, 10]],
];

export function buildOak(k: KitContext, params: AssetParams): THREE.Object3D {
  const t = pickTree(k, params, OAK.length, 3);
  trunk(k, t.g, 0.15, 0.1, 1.35, k.mat('trunk'), true);
  const leaf = k.mat('leaf', t.tone);
  blobs(k, t.g, OAK[t.shape]!, leaf, leaf);
  return rooted('veg.oak', t.key, t.g);
}

// ---------- maple: smooth egg-shaped crown, lime in a, flaming in autumn ----------
const MAPLE: readonly (readonly Blob[])[] = [
  [[0.82, 0, 1.62, 0, 1.06, 14]],
  [[0.76, 0.05, 1.66, 0, 1.06, 14], [0.42, -0.38, 1.55, 0.24, 0.9, 10, true]],
  [[0.80, 0, 1.56, 0, 0.95, 14], [0.38, 0.10, 2.20, -0.08, 1, 10, true]],
];

export function buildMaple(k: KitContext, params: AssetParams): THREE.Object3D {
  const t = pickTree(k, params, MAPLE.length, 3);
  trunk(k, t.g, 0.14, 0.09, 1.2, k.mat('trunk'), true);
  const leaf = k.mat('vegMaple', t.tone);
  blobs(k, t.g, MAPLE[t.shape]!, leaf, leaf);
  return rooted('veg.maple', t.key, t.g);
}

// ---------- pine: stacked cones in two alternating greens ----------
/** Tier: radius, height, base y. */
const PINE: readonly (readonly (readonly [number, number, number])[])[] = [
  [[0.68, 1.12, 0.50], [0.56, 1.02, 1.05], [0.44, 0.94, 1.57], [0.31, 0.92, 2.08]],
  [[0.69, 1.25, 0.52], [0.53, 1.12, 1.20], [0.36, 1.05, 1.84]],
  [[0.60, 1.10, 0.52], [0.50, 1.02, 1.08], [0.40, 0.96, 1.62], [0.28, 0.94, 2.16]],
];

export function buildPine(k: KitContext, params: AssetParams): THREE.Object3D {
  const t = pickTree(k, params, PINE.length, 2, false);
  trunk(k, t.g, 0.11, 0.075, 0.9, k.mat('trunk'));
  PINE[t.shape]!.forEach(([r, h, y0], i) => t.g.add(at(k.cone(r, h, k.mat('pine', (t.tone + i) % 2), 18), 0, y0 + h / 2, 0)));
  return rooted('veg.pine', t.key, t.g);
}

// ---------- birch: slim white stem(s) with dark bark dashes, airy light crown ----------
const BIRCH: readonly { crown: readonly Blob[]; second?: { base: readonly [number, number]; dir: readonly [number, number, number]; len: number; crown: Blob } }[] = [
  { crown: [[0.44, 0.03, 1.84, 0.02, 1.5, 14], [0.30, -0.22, 1.58, -0.20, 1.4, 10, true]] },
  {
    crown: [[0.43, -0.10, 1.86, -0.10, 1.5, 14]],
    second: { base: [0.06, 0.04], dir: [0.16, 1, 0.08], len: 1.45, crown: [0.28, 0.28, 1.62, 0.14, 1.45, 10] },
  },
  { crown: [[0.43, -0.05, 1.76, 0.06, 1.48, 14], [0.30, 0.22, 2.08, -0.12, 1.4, 10, true]] },
];
const MARKS: readonly (readonly [number, number])[] = [[0.32, 0.4], [0.6, 2.6], [0.88, 4.9], [1.18, 1.1], [1.46, 3.5]];

export function buildBirch(k: KitContext, params: AssetParams): THREE.Object3D {
  const t = pickTree(k, params, BIRCH.length, 2);
  const L = BIRCH[t.shape]!;
  const bark = k.mat('vegBirchBark'), mark = k.mat('vegBirchMark');
  const H = 2.05, RB = 0.075, RT = 0.045;
  trunk(k, t.g, RB, RT, H, bark);
  for (const [y, a] of MARKS) {
    const rr = RB + (RT - RB) * (y / H);
    const dash = k.detail(k.cyl(0.02, 0.02, 0.1, mark, 5));
    dash.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)));
    t.g.add(at(dash, Math.cos(a) * rr, y, Math.sin(a) * rr));
  }
  const leaf = k.mat('vegBirchLeaf', t.tone), alt = k.mat('vegBirchLeaf', (t.tone + 1) % 2);
  blobs(k, t.g, L.crown, leaf, alt);
  if (L.second) {
    const s = L.second;
    const { mesh } = limb(k, new THREE.Vector3(s.base[0], 0, s.base[1]), new THREE.Vector3(...s.dir), s.len, 0.05, 0.03, bark, 6);
    t.g.add(mesh);
    blobs(k, t.g, [s.crown], alt, leaf);
  }
  return rooted('veg.birch', t.key, t.g);
}

// ---------- poplar: tall columnar ellipsoid ----------
const POPLAR: readonly (readonly Blob[])[] = [
  [[0.46, 0, 1.78, 0, 2.85, 16]],
  [[0.42, -0.04, 1.82, -0.02, 2.9, 16], [0.26, 0.20, 1.42, 0.10, 2.2, 10, true]],
  [[0.36, -0.12, 1.86, 0, 3.1, 14], [0.32, 0.14, 1.62, 0.06, 2.7, 12, true]],
];

export function buildPoplar(k: KitContext, params: AssetParams): THREE.Object3D {
  const t = pickTree(k, params, POPLAR.length, 2);
  trunk(k, t.g, 0.095, 0.065, 0.75, k.mat('trunk'));
  const leaf = k.mat('vegPoplar', t.tone);
  blobs(k, t.g, POPLAR[t.shape]!, leaf, leaf);
  return rooted('veg.poplar', t.key, t.g);
}

// ---------- cherry: forked trunk under a wide, flat blossom umbrella ----------
const CHERRY: readonly (readonly Blob[])[] = [
  [[0.66, 0, 1.56, 0, 0.68, 13], [0.40, 0.35, 1.48, 0.15, 0.78, 10, true], [0.38, -0.36, 1.50, -0.16, 0.78, 10]],
  [[0.68, 0.02, 1.52, 0, 0.70, 13], [0.36, -0.12, 1.82, 0.10, 0.8, 10, true], [0.38, 0.38, 1.40, -0.10, 0.78, 10]],
  [[0.74, 0, 1.50, 0, 0.60, 13], [0.40, 0.06, 1.78, -0.04, 0.8, 10, true]],
];

export function buildCherry(k: KitContext, params: AssetParams): THREE.Object3D {
  const t = pickTree(k, params, CHERRY.length, 3);
  const bark = k.mat('trunk');
  trunk(k, t.g, 0.13, 0.085, 1.15, bark);
  for (const d of [[0.55, 1, 0.2], [-0.5, 1, -0.25]] as const) t.g.add(k.detail(limb(k, new THREE.Vector3(0, 0.8, 0), new THREE.Vector3(...d), 0.55, 0.065, 0.04, bark, 6).mesh));
  blobs(k, t.g, CHERRY[t.shape]!, k.mat('vegBlossom', PAIRS3[t.tone]![0]), k.mat('vegBlossom', PAIRS3[t.tone]![1]));
  return rooted('veg.cherry', t.key, t.g);
}
