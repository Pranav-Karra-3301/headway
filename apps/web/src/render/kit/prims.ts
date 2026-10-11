// Owner: T2. Geometry primitives for the kit: rounded boxes, boxes, cylinders, spheres, cones, prisms.
// Geometries are cached by size so identical parts share one BufferGeometry.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const cache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = cache.get(key);
  if (!g) { g = make(); cache.set(key, g); }
  return g;
}
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function mesh(geo: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh {
  const o = new THREE.Mesh(geo, m);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

/** Rounded box. Segment count scales with the radius so small parts stay cheap. */
export function rbox(w: number, h: number, d: number, r: number, m: THREE.Material, seg?: number): THREE.Mesh {
  const rr = Math.max(0.005, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
  const s = seg ?? (rr >= 0.22 ? 3 : rr >= 0.07 ? 2 : 1);
  const key = `rb:${r3(w)},${r3(h)},${r3(d)},${r3(rr)},${s}`;
  return mesh(cached(key, () => new RoundedBoxGeometry(w, h, d, s, rr)), m);
}

/** Plain box, for flat details (windows, frames, sills, ties). */
export function box(w: number, h: number, d: number, m: THREE.Material): THREE.Mesh {
  return mesh(cached(`bx:${r3(w)},${r3(h)},${r3(d)}`, () => new THREE.BoxGeometry(w, h, d)), m);
}

export function cyl(rt: number, rb: number, h: number, m: THREE.Material, seg = 16): THREE.Mesh {
  return mesh(cached(`cy:${r3(rt)},${r3(rb)},${r3(h)},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)), m);
}

export function sphere(r: number, m: THREE.Material, ws = 20, hs = 14): THREE.Mesh {
  return mesh(cached(`sp:${r3(r)},${ws},${hs}`, () => new THREE.SphereGeometry(r, ws, hs)), m);
}

/** Upper hemisphere (dome), flat side down at y = 0. */
export function dome(r: number, m: THREE.Material, ws = 24, hs = 10): THREE.Mesh {
  return mesh(cached(`dm:${r3(r)},${ws},${hs}`, () => new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, 0, Math.PI / 2)), m);
}

export function cone(r: number, h: number, m: THREE.Material, seg = 16): THREE.Mesh {
  return mesh(cached(`co:${r3(r)},${r3(h)},${seg}`, () => new THREE.ConeGeometry(r, h, seg)), m);
}

export function capsule(r: number, len: number, m: THREE.Material, capSeg = 4, radial = 12): THREE.Mesh {
  return mesh(cached(`ca:${r3(r)},${r3(len)},${capSeg},${radial}`, () => new THREE.CapsuleGeometry(r, len, capSeg, radial)), m);
}

/**
 * Triangular prism (gable): triangle of base `span` and height `rise` in the plane across `axis`,
 * extruded `length` along `axis` ('x' or 'z'). Base sits at y = 0, centred on the origin.
 */
export function prism(span: number, rise: number, length: number, axis: 'x' | 'z', m: THREE.Material): THREE.Mesh {
  const key = `pr:${r3(span)},${r3(rise)},${r3(length)},${axis}`;
  return mesh(cached(key, () => {
    const s = new THREE.Shape();
    s.moveTo(-span / 2, 0); s.lineTo(span / 2, 0); s.lineTo(0, rise); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: length, bevelEnabled: false });
    g.translate(0, 0, -length / 2);
    if (axis === 'x') g.rotateY(Math.PI / 2);
    g.deleteAttribute('uv');
    return g;
  }), m);
}

/** Flat extruded ring/ellipse (stadium bowl tiers). */
export function ellipseRing(rx1: number, ry1: number, rx2: number, ry2: number, h: number, m: THREE.Material): THREE.Mesh {
  const key = `er:${r3(rx1)},${r3(ry1)},${r3(rx2)},${r3(ry2)},${r3(h)}`;
  return mesh(cached(key, () => {
    const s = new THREE.Shape();
    s.absellipse(0, 0, rx1, ry1, 0, Math.PI * 2, false, 0);
    if (rx2 > 0) { const hole = new THREE.Path(); hole.absellipse(0, 0, rx2, ry2, 0, Math.PI * 2, true, 0); s.holes.push(hole); }
    const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 64 });
    g.rotateX(-Math.PI / 2);
    g.deleteAttribute('uv');
    return g;
  }), m);
}

export function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, z);
  return o;
}

export function rotY<T extends THREE.Object3D>(o: T, a: number): T { o.rotation.y = a; return o; }

/** Mark an object (and its subtree) as a "toy detail" part, hidden/dropped at detail = 'min'. */
export function detail<T extends THREE.Object3D>(o: T): T {
  o.userData.detail = true;
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

/** Show/hide every detail-tagged object under `root` (for live, unmerged groups such as vehicles). */
export function applyDetail(root: THREE.Object3D, toy: boolean): void {
  root.traverse((o) => { if (o.userData.detail) o.visible = toy; });
}
