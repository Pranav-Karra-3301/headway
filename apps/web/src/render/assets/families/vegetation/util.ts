// Owner: A5. Small helpers shared by the vegetation builders.
// Variety contract: a build draws exactly ONE k.rand() (or uses params.variant) and turns it into a few
// discrete choices (shape, tone, size, yaw). The root's userData.variant names those choices, so two builds
// with the same key are geometrically identical: the composer may bake one per key and instance the rest.
import * as THREE from 'three';
import type { AssetParams, KitContext } from '../../types';

export type Rng = () => number;

/** mulberry32: tiny deterministic PRNG. */
export function mulberry(seed: number): Rng {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The per-placement choice stream: params.variant pins it, otherwise one k.rand() seeds it. */
export function choices(k: KitContext, params: AssetParams): Rng {
  const v = params.variant;
  const seed = typeof v === 'number' && Number.isFinite(v)
    ? Math.imul((Math.round(v) + 1) | 0, 0x9e3779b1)
    : Math.imul(Math.floor(k.rand() * 0x7fffffff), 0x85ebca6b) ^ 0x5bd1e995;
  const r = mulberry(seed);
  r();
  return r;
}

/** Integer in [0, n). */
export const int = (r: Rng, n: number): number => Math.min(n - 1, Math.floor(r() * n));

/** Index picked with relative weights. */
export function weighted(r: Rng, weights: readonly number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let x = r() * total;
  for (let i = 0; i < weights.length; i++) { x -= weights[i]!; if (x < 0) return i; }
  return weights.length - 1;
}

/** A detail stream that depends only on the variant key (so equal keys stay identical). */
export function keyed(key: string): Rng {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return mulberry(h);
}

export function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, z);
  return o;
}

export function squash<T extends THREE.Object3D>(o: T, sx: number, sy: number, sz = sx): T {
  o.scale.set(sx, sy, sz);
  return o;
}

const UP = new THREE.Vector3(0, 1, 0);

/** Point an object's +y axis along `dir` (unit). */
export function aim<T extends THREE.Object3D>(o: T, dir: THREE.Vector3): T {
  o.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
  return o;
}

/** A tapered limb from `base` along `dir` (any length), returns the mesh and its tip. */
export function limb(k: KitContext, base: THREE.Vector3, dir: THREE.Vector3, len: number, rb: number, rt: number, m: THREE.Material, seg = 6) {
  const d = dir.clone().normalize();
  const mesh = aim(k.cyl(rt, rb, len, m, seg), d);
  mesh.position.copy(base).addScaledVector(d, len / 2);
  return { mesh, tip: base.clone().addScaledVector(d, len) };
}

/** Root (no transform: registry.build owns it) + body (yaw/size variety) + the variant key. */
export function rooted(kind: string, key: string, body: THREE.Object3D): THREE.Group {
  const root = new THREE.Group();
  root.name = kind;
  root.userData.variant = `${kind}#${key}`;
  root.add(body);
  return root;
}
