// Owner: T2.1. Kit primitives. Every kit mesh is tagged with a palette *role* (+ variant index) instead of a
// real material; `bakeGeometry` (./bake) merges a kit group into one vertex-coloured geometry that renders with
// one shared KitMaterial (../materials). Geometries are cached by size so identical parts share one buffer.
// Unbaked groups still render (palette A placeholder materials) for quick debugging.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { colorOf, PALETTES, type Role } from '../palettes';

/** What a kit mesh is: palette role + variant index (array roles are indexed modulo their length). */
export interface Part { role: Role; idx: number }

/** Role tag of a kit mesh (undefined for untagged objects). */
export function partOf(o: THREE.Object3D): Part | undefined {
  return o.userData.part as Part | undefined;
}

const placeholders = new Map<string, THREE.MeshStandardMaterial>();
function placeholder(role: Role, idx: number): THREE.MeshStandardMaterial {
  const key = `${role}#${idx}`;
  let m = placeholders.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: colorOf(PALETTES.a, role, idx), roughness: 0.82, metalness: 0 });
    m.name = key;
    placeholders.set(key, m);
  }
  return m;
}

const cache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = cache.get(key);
  if (!g) { g = make(); cache.set(key, g); }
  return g;
}
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Wrap any geometry as a kit part with a role. */
export function part(geo: THREE.BufferGeometry, role: Role, idx = 0): THREE.Mesh {
  const o = new THREE.Mesh(geo, placeholder(role, idx));
  o.userData.part = { role, idx } satisfies Part;
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

/** Rounded box centred on the origin. Segment count scales with the radius so small parts stay cheap. */
export function rbox(w: number, h: number, d: number, r: number, role: Role, idx = 0, seg?: number): THREE.Mesh {
  const rr = Math.max(0.005, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
  const s = seg ?? (rr >= 0.2 ? 3 : rr >= 0.06 ? 2 : 1);
  const key = `rb:${r3(w)},${r3(h)},${r3(d)},${r3(rr)},${s}`;
  return part(cached(key, () => new RoundedBoxGeometry(w, h, d, s, rr)), role, idx);
}

/** Plain box (24 vertices) for flat details: windows, frames, sills, ties, signs. */
export function box(w: number, h: number, d: number, role: Role, idx = 0): THREE.Mesh {
  return part(cached(`bx:${r3(w)},${r3(h)},${r3(d)}`, () => new THREE.BoxGeometry(w, h, d)), role, idx);
}

export function cyl(rt: number, rb: number, h: number, role: Role, idx = 0, seg = 16): THREE.Mesh {
  return part(cached(`cy:${r3(rt)},${r3(rb)},${r3(h)},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)), role, idx);
}

export function sphere(r: number, role: Role, idx = 0, ws = 18, hs = 12): THREE.Mesh {
  return part(cached(`sp:${r3(r)},${ws},${hs}`, () => new THREE.SphereGeometry(r, ws, hs)), role, idx);
}

/** Upper hemisphere, flat side down at y = 0. */
export function dome(r: number, role: Role, idx = 0, ws = 22, hs = 8): THREE.Mesh {
  return part(cached(`dm:${r3(r)},${ws},${hs}`, () => new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, 0, Math.PI / 2)), role, idx);
}

/** Cone centred on the origin (base at y = -h/2). */
export function cone(r: number, h: number, role: Role, idx = 0, seg = 16): THREE.Mesh {
  return part(cached(`co:${r3(r)},${r3(h)},${seg}`, () => new THREE.ConeGeometry(r, h, seg)), role, idx);
}

/** Capsule centred on the origin; total height = len + 2r. */
export function capsule(r: number, len: number, role: Role, idx = 0, capSeg = 4, radial = 12): THREE.Mesh {
  return part(cached(`ca:${r3(r)},${r3(len)},${capSeg},${radial}`, () => new THREE.CapsuleGeometry(r, len, capSeg, radial)), role, idx);
}

/**
 * Triangular prism (gable roof): triangle of base `span` and height `rise` in the plane across `axis`,
 * extruded `length` along `axis` ('x' = ridge along x). Base at y = 0, centred on the origin.
 */
export function prism(span: number, rise: number, length: number, axis: 'x' | 'z', role: Role, idx = 0): THREE.Mesh {
  const key = `pr:${r3(span)},${r3(rise)},${r3(length)},${axis}`;
  return part(cached(key, () => {
    const s = new THREE.Shape();
    s.moveTo(-span / 2, 0); s.lineTo(span / 2, 0); s.lineTo(0, rise); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: length, bevelEnabled: false });
    g.translate(0, 0, -length / 2);
    if (axis === 'x') g.rotateY(Math.PI / 2);
    g.deleteAttribute('uv');
    return g;
  }), role, idx);
}

/** Flat extruded elliptic ring (or disc when rx2 = 0), bottom at y = 0. */
export function ellipseRing(rx1: number, ry1: number, rx2: number, ry2: number, h: number, role: Role, idx = 0): THREE.Mesh {
  const key = `er:${r3(rx1)},${r3(ry1)},${r3(rx2)},${r3(ry2)},${r3(h)}`;
  return part(cached(key, () => {
    const s = new THREE.Shape();
    s.absellipse(0, 0, rx1, ry1, 0, Math.PI * 2, false, 0);
    if (rx2 > 0) { const hole = new THREE.Path(); hole.absellipse(0, 0, rx2, ry2, 0, Math.PI * 2, true, 0); s.holes.push(hole); }
    const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 48 });
    g.rotateX(-Math.PI / 2);
    g.deleteAttribute('uv');
    return g;
  }), role, idx);
}

/** Cached custom geometry (for one-off shapes built by kit files). */
export function shaped(key: string, make: () => THREE.BufferGeometry, role: Role, idx = 0): THREE.Mesh {
  return part(cached(key, make), role, idx);
}

export function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, z);
  return o;
}

export function rotX<T extends THREE.Object3D>(o: T, a: number): T { o.rotation.x = a; return o; }
export function rotY<T extends THREE.Object3D>(o: T, a: number): T { o.rotation.y = a; return o; }
export function rotZ<T extends THREE.Object3D>(o: T, a: number): T { o.rotation.z = a; return o; }

/** Mark an object (and its subtree) as a "toy detail": baked last, dropped at detail = 'min'. */
export function detail<T extends THREE.Object3D>(o: T): T {
  o.userData.detail = true;
  return o;
}

/** Mark an object (and its subtree) as instance-tinted: in an InstancedMesh with instanceColor, these
 *  vertices take the instance colour (car bodies, shirts, tree crowns); other parts keep their role colour. */
export function tint<T extends THREE.Object3D>(o: T): T {
  o.userData.tint = true;
  return o;
}

export function noShadow<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => { c.castShadow = false; });
  return o;
}

export function group(...children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  if (children.length) g.add(...children);
  return g;
}

/** Small deterministic PRNG (mulberry32) for per-building variety (lit windows, jitter). */
export function prng(seed: number): () => number {
  let a = (seed | 0) ^ 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Show/hide every detail-tagged object under an *unbaked* kit group. */
export function applyDetail(root: THREE.Object3D, toy: boolean): void {
  root.traverse((o) => { if (o.userData.detail) o.visible = toy; });
}
