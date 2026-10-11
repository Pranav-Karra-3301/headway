// Owner: E1. Mountain flora: slim layered pines, round broadleaf clumps for the foothills, and rounded boulders —
// each one baked geometry drawn as an InstancedMesh — plus the deterministic scatter that places them on the field
// (forest patches, thinning toward bare summits, rocks on steep slopes, summits and headland shores).
import * as THREE from 'three';
import { bakeGeometry, type Baked } from '../../kit/bake';
import type { PaletteId } from '../../types';
import { resolveTerrainRole } from './colors';
import { smooth, WATER_LEVEL, type TerrainField } from './field';
import { rolePart } from './portals';

/** One placed instance. `tone` 0..1 picks a colour jitter, `haze` 0..1 is the aerial-perspective amount. */
export interface Inst { x: number; y: number; z: number; s: number; sy: number; rot: number; tone: number; haze: number }

const tag = <T extends THREE.Object3D>(o: T, tint: boolean): T => { o.userData.tint = tint; return o; };
const at = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T => { o.position.set(x, y, z); return o; };

/** Layered mountain pine (~2.6 u): four stacked cones in alternating greens on a short trunk. */
export function makePine(): THREE.Group {
  const g = new THREE.Group();
  g.add(at(rolePart(new THREE.CylinderGeometry(0.07, 0.11, 0.7, 7), 'trunk'), 0, 0.35, 0));
  const tiers: Array<[number, number, number]> = [[0.66, 0.98, 0.42], [0.53, 0.88, 0.9], [0.4, 0.78, 1.34], [0.26, 0.7, 1.74]];
  tiers.forEach(([r, h, y0], i) => g.add(tag(at(rolePart(new THREE.ConeGeometry(r, h, 10, 1), 'pine', i % 2), 0, y0 + h / 2, 0), true)));
  return g;
}

/** Round broadleaf clump (~2.2 u) for the lower foothills. */
export function makeBroadleaf(): THREE.Group {
  const g = new THREE.Group();
  g.add(at(rolePart(new THREE.CylinderGeometry(0.08, 0.12, 0.9, 7), 'trunk'), 0, 0.45, 0));
  const blobs: Array<[number, number, number, number]> = [[0.62, 0, 1.32, 0], [0.44, -0.36, 1.2, 0.18], [0.42, 0.34, 1.26, -0.16], [0.38, 0.06, 1.74, 0.02]];
  blobs.forEach(([r, x, y, z], i) => g.add(tag(at(rolePart(new THREE.IcosahedronGeometry(r, 2), 'leaf', i % 3), x, y, z), true)));
  return g;
}

/** Rounded boulder (~1 u): a lumpy, slightly flattened icosphere, sitting with ~25 % below ground. */
export function makeBoulder(): THREE.Group {
  const geo = new THREE.IcosahedronGeometry(0.55, 1);
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + 0.16 * Math.sin(v.x * 7.1 + v.z * 3.3) * Math.cos(v.y * 5.7 - v.x * 2.1);
    v.multiplyScalar(k);
    v.y = v.y * 0.72 + 0.12;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  const merged = mergeByPosition(geo);
  const g = new THREE.Group();
  g.add(tag(rolePart(merged, 'trRock', 0), true));
  return g;
}

/** Weld duplicate vertices so a flat-shaded primitive gets smooth normals. */
function mergeByPosition(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = src.getAttribute('position') as THREE.BufferAttribute;
  const keyOf = (i: number) => `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
  const map = new Map<string, number>();
  const out: number[] = [];
  const index: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const k = keyOf(i);
    let id = map.get(k);
    if (id === undefined) { id = out.length / 3; map.set(k, id); out.push(pos.getX(i), pos.getY(i), pos.getZ(i)); }
    index.push(id);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** Bake a role-tagged group; crown/rock vertices get aTint < 1 so instance colours mix with the baked tiers. */
export function bakeFlora(root: THREE.Object3D, palette: PaletteId, tint: number): Baked {
  const b = bakeGeometry(root, palette, { resolve: resolveTerrainRole });
  const t = b.geometry.getAttribute('aTint') as THREE.BufferAttribute;
  for (let i = 0; i < t.count; i++) if (t.getX(i) > 0) t.setX(i, tint);
  return b;
}

// ---------------------------------------------------------------- scatter
function rng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Flora {
  conifers: Inst[];
  broadleaf: Inst[];
  rocks: Inst[];
  /** Static trees baked into the rail-spur mesh (no sway; they fade with the spur). */
  spurTrees: Array<Inst & { pine: boolean }>;
}

export function scatterFlora(field: TerrainField, seed = 11): Flora {
  const E = field.extent;
  const R = rng(seed);
  const out: Flora = { conifers: [], broadleaf: [], rocks: [], spurTrees: [] };
  const roadPortals = field.portals.filter((p) => p.kind === 'road');
  const railPortals = field.portals.filter((p) => p.kind === 'rail');
  const nearRoadPortal = (x: number, z: number) => roadPortals.some((p) => {
    const rx = x - p.x, rz = z - p.z, o = -(rx * p.face.x + rz * p.face.z), a = Math.abs(rx * p.face.z - rz * p.face.x);
    return o > -1 && o < 3.4 && a < p.half + 1.6;
  });
  const hazeAt = (d: number) => smooth(10, 34, d) * 0.42;

  // trees: a jittered grid over the mountain band
  const cellT = 1.8;
  for (let z = E.minZ + cellT / 2; z < E.maxZ; z += cellT) {
    for (let x = E.minX + cellT / 2; x < E.maxX; x += cellT) {
      const px = x + (R() - 0.5) * cellT * 0.9, pz = z + (R() - 0.5) * cellT * 0.9;
      const r1 = R(), r2 = R(), r3 = R(), r4 = R(), r5 = R();
      if (px < E.minX + 1 || px > E.maxX - 1 || pz < E.minZ + 1 || pz > E.maxZ - 1) continue;
      if (field.region(px, pz) !== 0) continue;
      const d = field.depth(px, pz);
      if (d < 0.7) continue;
      const h = field.height(px, pz);
      if (h < WATER_LEVEL + 0.65 || field.coast(px, pz) < 2.4) continue;
      if (field.slope(px, pz) > 1.15 || nearRoadPortal(px, pz)) continue;
      const dens = field.forest(px, pz, h) * 0.92 + 0.05 * smooth(0.5, 3, h) * (1 - smooth(15, 18, h));
      if (r1 > dens) continue;
      const pine = r2 < 0.3 + 0.62 * smooth(1.5, 7, h);
      const far = 1 - 0.22 * smooth(12, 30, d);
      const s = (pine ? 0.86 + r3 * 0.44 : 0.82 + r3 * 0.34) * far;
      const inst: Inst = { x: px, y: h - 0.12 * s, z: pz, s, sy: 0.9 + r4 * 0.22, rot: r5 * Math.PI * 2, tone: R(), haze: hazeAt(d) };
      (pine ? out.conifers : out.broadleaf).push(inst);
    }
  }

  // rocks: outcrops on steep ground, bare summits, the headland shores
  const cellR = 2.5;
  for (let z = E.minZ + cellR / 2; z < E.maxZ; z += cellR) {
    for (let x = E.minX + cellR / 2; x < E.maxX; x += cellR) {
      const px = x + (R() - 0.5) * cellR * 0.9, pz = z + (R() - 0.5) * cellR * 0.9;
      const r1 = R(), r2 = R(), r3 = R(), r4 = R();
      if (px < E.minX + 0.8 || px > E.maxX - 0.8 || pz < E.minZ + 0.8 || pz > E.maxZ - 0.8) continue;
      if (field.region(px, pz) !== 0 || field.depth(px, pz) < 0.8 || nearRoadPortal(px, pz)) continue;
      const h = field.height(px, pz), L = field.coast(px, pz), sl = field.slope(px, pz);
      if (h < WATER_LEVEL - 0.45) continue;
      const p = 0.5 * smooth(0.75, 1.3, sl) + 0.4 * smooth(15.5, 19, h) + 0.5 * smooth(3.2, 0.6, L) * smooth(-1.4, 0.4, h) + 0.025;
      if (r1 > p) continue;
      const coastal = L < 3;
      const s = (coastal ? 0.55 + r2 * 0.9 : 0.5 + r2 * 1.1) * (1 - 0.2 * smooth(14, 30, field.depth(px, pz)));
      out.rocks.push({ x: px, y: h - 0.08 * s, z: pz, s, sy: 0.75 + r3 * 0.5, rot: r4 * Math.PI * 2, tone: R(), haze: hazeAt(field.depth(px, pz)) });
    }
  }

  // the rail spur: a few static trees on the hill tops
  const cellS = 1.35;
  for (let z = E.minZ; z < E.maxZ; z += cellS) {
    for (let x = E.minX; x < E.maxX; x += cellS) {
      if (field.region(x + 0.5, z + 0.5) !== 1) continue;
      const px = x + R() * cellS, pz = z + R() * cellS;
      const r1 = R(), r2 = R(), r3 = R(), r4 = R();
      if (field.region(px, pz) !== 1) continue;
      const h = field.height(px, pz);
      if (h < 2.2 || field.slope(px, pz) > 0.7) continue;
      if (railPortals.some((p) => Math.hypot(px - p.x, pz - p.z) < 2.6) || roadPortals.some((p) => Math.hypot(px - p.x, pz - p.z) < 3.4)) continue;
      if (r1 > 0.42) continue;
      const pine = r2 < 0.7;
      const s = 0.72 + r3 * 0.3;
      out.spurTrees.push({ x: px, y: h - 0.1, z: pz, s, sy: 0.92 + r4 * 0.16, rot: R() * Math.PI * 2, tone: R(), haze: 0, pine });
    }
  }
  return out;
}
