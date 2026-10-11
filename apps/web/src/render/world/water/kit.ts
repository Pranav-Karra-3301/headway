// Owner: E2. Role-tagged primitives for the lake's props and boats. Like render/kit/prims.ts, but roles may be any
// palette Role *or* a lake role from colors.ts (WATER_ROLES); bakeGeometry reads the role from the material name
// ("role#idx") and resolveWaterRole colours the custom ones per palette. Geometries are cached by shape.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PALETTES, type Role } from '../../palettes';
import { WATER_ROLES } from './colors';

const mats = new Map<string, THREE.MeshStandardMaterial>();
/** Shared material tagged with a role ("role#idx"), so bakeGeometry colours it per palette. */
export function roleMat(role: string, idx: number): THREE.MeshStandardMaterial {
  const key = `${role}#${idx}`;
  let m = mats.get(key);
  if (!m) {
    const custom = WATER_ROLES[role]?.[0];
    const pal = (PALETTES.a as unknown as Record<string, string | string[]>)[role];
    const v = custom ?? pal ?? '#9aa0a6';
    const hex = Array.isArray(v) ? v[idx % v.length]! : v;
    m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.82 });
    m.name = key;
    m.userData.role = role;
    m.userData.idx = idx;
    mats.set(key, m);
  }
  return m;
}

const cache = new Map<string, THREE.BufferGeometry>();
const r3 = (n: number) => Math.round(n * 1000) / 1000;
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = cache.get(key);
  if (!g) {
    g = make();
    if (g.getAttribute('uv')) g.deleteAttribute('uv');
    cache.set(key, g);
  }
  return g;
}

export type AnyRole = Role | (string & {});

export function wpart(geo: THREE.BufferGeometry, role: AnyRole, idx = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, roleMat(role, idx));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function rbox(w: number, h: number, d: number, r: number, role: AnyRole, idx = 0): THREE.Mesh {
  const rr = Math.max(0.005, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
  const s = rr >= 0.2 ? 3 : rr >= 0.05 ? 2 : 1;
  return wpart(cached(`rb:${r3(w)},${r3(h)},${r3(d)},${r3(rr)},${s}`, () => new RoundedBoxGeometry(w, h, d, s, rr)), role, idx);
}

export function box(w: number, h: number, d: number, role: AnyRole, idx = 0): THREE.Mesh {
  return wpart(cached(`bx:${r3(w)},${r3(h)},${r3(d)}`, () => new THREE.BoxGeometry(w, h, d)), role, idx);
}

export function cyl(rt: number, rb: number, h: number, role: AnyRole, idx = 0, seg = 12): THREE.Mesh {
  return wpart(cached(`cy:${r3(rt)},${r3(rb)},${r3(h)},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)), role, idx);
}

export function sphere(r: number, role: AnyRole, idx = 0, ws = 12, hs = 8): THREE.Mesh {
  return wpart(cached(`sp:${r3(r)},${ws},${hs}`, () => new THREE.SphereGeometry(r, ws, hs)), role, idx);
}

/** Upper hemisphere, flat side at y = 0. */
export function dome(r: number, role: AnyRole, idx = 0, ws = 14, hs = 6): THREE.Mesh {
  return wpart(cached(`dm:${r3(r)},${ws},${hs}`, () => new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, 0, Math.PI / 2)), role, idx);
}

/** Cone centred on the origin (base at y = -h/2); optional wedge (thetaStart, thetaLength). */
export function cone(r: number, h: number, role: AnyRole, idx = 0, seg = 12, t0 = 0, tl = Math.PI * 2): THREE.Mesh {
  return wpart(cached(`co:${r3(r)},${r3(h)},${seg},${r3(t0)},${r3(tl)}`, () => new THREE.ConeGeometry(r, h, seg, 1, false, t0, tl)), role, idx);
}

export function torus(r: number, tube: number, role: AnyRole, idx = 0, rs = 6, ts = 14): THREE.Mesh {
  return wpart(cached(`to:${r3(r)},${r3(tube)},${rs},${ts}`, () => new THREE.TorusGeometry(r, tube, rs, ts)), role, idx);
}

export function capsule(r: number, len: number, role: AnyRole, idx = 0): THREE.Mesh {
  return wpart(cached(`ca:${r3(r)},${r3(len)}`, () => new THREE.CapsuleGeometry(r, len, 3, 10)), role, idx);
}

/** Gable roof prism: triangle (base `span`, height `rise`) extruded `length` along axis; base at y = 0. */
export function prism(span: number, rise: number, length: number, axis: 'x' | 'z', role: AnyRole, idx = 0): THREE.Mesh {
  return wpart(cached(`pr:${r3(span)},${r3(rise)},${r3(length)},${axis}`, () => {
    const s = new THREE.Shape();
    s.moveTo(-span / 2, 0); s.lineTo(span / 2, 0); s.lineTo(0, rise); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: length, bevelEnabled: false });
    g.translate(0, 0, -length / 2);
    if (axis === 'x') g.rotateY(Math.PI / 2);
    return g;
  }), role, idx);
}

/** Flat shape (in the xz plane, +y up) extruded `h` up from y = 0 with a soft bevel. */
export function slab(key: string, shape: () => THREE.Shape, h: number, bevel: number, role: AnyRole, idx = 0, curve = 10): THREE.Mesh {
  return wpart(cached(`sl:${key},${r3(h)},${r3(bevel)},${curve}`, () => {
    const depth = Math.max(0.001, h - 2 * bevel);
    const g = new THREE.ExtrudeGeometry(shape(), {
      depth, curveSegments: curve, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2,
    });
    g.rotateX(-Math.PI / 2); // shape xy → xz (shape y becomes −z), extrude +z → +y
    g.translate(0, bevel, 0);
    return g;
  }), role, idx);
}

/** A soft low-poly pebble (icosphere), unit radius before scaling. */
export function pebble(role: AnyRole, idx = 0, detail = 1): THREE.Mesh {
  return wpart(cached(`pb:${detail}`, () => {
    const g = new THREE.IcosahedronGeometry(1, detail);
    // weld seams so normals are smooth, then nudge vertices for a hand-shaped silhouette
    g.deleteAttribute('normal');
    const merged = mergeVertices(g);
    const p = merged.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 1 + 0.09 * Math.sin(x * 5.1 + z * 3.7) + 0.06 * Math.sin(y * 6.3 + x * 2.1);
      p.setXYZ(i, x * k, y * k, z * k);
    }
    merged.computeVertexNormals();
    return merged;
  }), role, idx);
}

function mergeVertices(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const map = new Map<string, number>();
  const verts: number[] = [];
  const index: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    let k = map.get(key);
    if (k === undefined) { k = verts.length / 3; verts.push(pos.getX(i), pos.getY(i), pos.getZ(i)); map.set(key, k); }
    index.push(k);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  out.setIndex(index);
  return out;
}

export function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, z);
  return o;
}
export function rot<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.rotation.set(x, y, z);
  return o;
}
export function scl<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.scale.set(x, y, z);
  return o;
}
export function group(...children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  if (children.length) g.add(...children);
  return g;
}
