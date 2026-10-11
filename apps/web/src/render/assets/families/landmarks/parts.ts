// Owner: A4. Shared building blocks for the landmark builders. Everything goes through the KitContext materials
// (so the composer's clay materials apply); custom geometries are indexed with position/normal/uv like the
// stock three.js primitives, so they merge cleanly with them. No geometry is shared between meshes.
import * as THREE from 'three';
import type { KitContext } from '../../types';

export type Kit = KitContext;

export function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, z);
  return o;
}

export function rotY<T extends THREE.Object3D>(o: T, a: number): T { o.rotation.y = a; return o; }
export function rotX<T extends THREE.Object3D>(o: T, a: number): T { o.rotation.x = a; return o; }
export function rotZ<T extends THREE.Object3D>(o: T, a: number): T { o.rotation.z = a; return o; }

export function named<T extends THREE.Object3D>(o: T, name: string): T {
  o.name = name;
  return o;
}

export function group(name = '', ...children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  if (children.length) g.add(...children);
  return g;
}

export function shadow<T extends THREE.Mesh>(m: T): T {
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function mesh(k: Kit, geo: THREE.BufferGeometry, role: string, idx = 0): THREE.Mesh {
  return shadow(new THREE.Mesh(geo, k.mat(role, idx)));
}

/** Plain box (12 triangles) for flat details: panes, frames, sills, stripes, signs. */
export function box(k: Kit, w: number, h: number, d: number, role: string, idx = 0): THREE.Mesh {
  return mesh(k, new THREE.BoxGeometry(w, h, d), role, idx);
}

/** Rounded box for main masses (the basic kit spends ~300 triangles on each, so use them for big forms). */
export function rbox(k: Kit, w: number, h: number, d: number, r: number, role: string, idx = 0): THREE.Mesh {
  return k.rbox(w, h, d, r, k.mat(role, idx));
}

export function cyl(k: Kit, rt: number, rb: number, h: number, role: string, idx = 0, seg = 12): THREE.Mesh {
  return k.cyl(rt, rb, h, k.mat(role, idx), seg);
}

export function sphere(k: Kit, r: number, role: string, idx = 0, seg = 12): THREE.Mesh {
  return k.sphere(r, k.mat(role, idx), seg);
}

/** Disc facing +z (a cylinder lying on its side), centred on the origin. */
export function disc(k: Kit, r: number, depth: number, role: string, idx = 0, seg = 16): THREE.Mesh {
  const m = k.cyl(r, r, depth, k.mat(role, idx), seg);
  m.rotation.x = Math.PI / 2;
  return m;
}

/** Horizontal rod along x (cylinder lying on its side), centred on the origin. */
export function rodX(k: Kit, r: number, len: number, role: string, idx = 0, seg = 8): THREE.Mesh {
  const m = k.cyl(r, r, len, k.mat(role, idx), seg);
  m.rotation.z = Math.PI / 2;
  return m;
}

/** Rod from a to b (cylinder), for legs and braces. */
export function rodBetween(k: Kit, a: THREE.Vector3, b: THREE.Vector3, r: number, role: string, idx = 0, seg = 8): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const m = k.cyl(r, r, len, k.mat(role, idx), seg);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
}

// ---------- flat-shaded custom solids ----------

/** Indexed geometry from flat polygons (each polygon gets its own vertices + face normal). */
function polyGeometry(polys: THREE.Vector3[][]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
  for (const poly of polys) {
    e1.subVectors(poly[1]!, poly[0]!);
    e2.subVectors(poly[2]!, poly[0]!);
    n.crossVectors(e1, e2).normalize();
    const base = pos.length / 3;
    for (const p of poly) { pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); uv.push(0, 0); }
    for (let i = 1; i + 1 < poly.length; i++) idx.push(base, base + i, base + i + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Gable prism: triangle of base `span` and height `rise` across `axis`, extruded `length` along it. Base at y = 0. */
export function prism(k: Kit, span: number, rise: number, length: number, axis: 'x' | 'z', role: string, idx = 0): THREE.Mesh {
  const s = span / 2, l = length / 2;
  // ridge along z: triangle in the xy plane
  const f = [V(-s, 0, l), V(s, 0, l), V(0, rise, l)];
  const b = [V(s, 0, -l), V(-s, 0, -l), V(0, rise, -l)];
  const polys = [
    f, b,
    [V(s, 0, l), V(s, 0, -l), V(0, rise, -l), V(0, rise, l)],
    [V(-s, 0, -l), V(-s, 0, l), V(0, rise, l), V(0, rise, -l)],
    [V(-s, 0, -l), V(s, 0, -l), V(s, 0, l), V(-s, 0, l)],
  ];
  const g = polyGeometry(polys);
  if (axis === 'x') g.rotateY(Math.PI / 2);
  return mesh(k, g, role, idx);
}

/** Four-sided pyramid (w × d base at y = 0, apex at y = h), crisp faces. */
export function pyramid(k: Kit, w: number, d: number, h: number, role: string, idx = 0): THREE.Mesh {
  const x = w / 2, z = d / 2, top = V(0, h, 0);
  const polys = [
    [V(-x, 0, z), V(x, 0, z), top],
    [V(x, 0, z), V(x, 0, -z), top],
    [V(x, 0, -z), V(-x, 0, -z), top],
    [V(-x, 0, -z), V(-x, 0, z), top],
    [V(-x, 0, -z), V(x, 0, -z), V(x, 0, z), V(-x, 0, z)],
  ];
  return mesh(k, polyGeometry(polys), role, idx);
}

/** Hipped roof over a w × d box: ridge along x of length w - d (0 = pyramid), base at y = 0. */
export function hipRoof(k: Kit, w: number, d: number, h: number, role: string, idx = 0): THREE.Mesh {
  const x = w / 2, z = d / 2, r = Math.max(0, (w - d) / 2);
  const a = V(-r, h, 0), b = V(r, h, 0);
  const polys = [
    [V(-x, 0, z), V(x, 0, z), b, a],
    [V(x, 0, -z), V(-x, 0, -z), a, b],
    [V(x, 0, z), V(x, 0, -z), b],
    [V(-x, 0, -z), V(-x, 0, z), a],
    [V(-x, 0, -z), V(x, 0, -z), V(x, 0, z), V(-x, 0, z)],
  ];
  return mesh(k, polyGeometry(polys), role, idx);
}

/** Flat rounded-rectangle plate (half sizes a × b, corner radius r) lying at y = 0, facing up. */
export function roundedPlate(k: Kit, a: number, b: number, r: number, role: string, idx = 0, seg = 6): THREE.Mesh {
  const s = new THREE.Shape();
  const rr = Math.min(r, a - 1e-3, b - 1e-3);
  s.moveTo(-a + rr, -b);
  s.lineTo(a - rr, -b); s.absarc(a - rr, -b + rr, rr, -Math.PI / 2, 0, false);
  s.lineTo(a, b - rr); s.absarc(a - rr, b - rr, rr, 0, Math.PI / 2, false);
  s.lineTo(-a + rr, b); s.absarc(-a + rr, b - rr, rr, Math.PI / 2, Math.PI, false);
  s.lineTo(-a, -b + rr); s.absarc(-a + rr, -b + rr, rr, Math.PI, Math.PI * 1.5, false);
  const g = new THREE.ShapeGeometry(s, seg);
  g.rotateX(-Math.PI / 2);
  return mesh(k, g, role, idx);
}

// ---------- facade details (all facing +z, back flush with z = 0) ----------

export interface WinOpts { sill?: boolean; mullion?: boolean; arch?: boolean; frame?: string }

/** Window: frame, pane (lit variant idx 1 glows at dusk), optional mullion, arch keystone and sill. Detail. */
export function windowUnit(k: Kit, ww: number, wh: number, lit: boolean, o: WinOpts = {}): THREE.Group {
  const g = group('window');
  const fr = o.frame ?? 'frame';
  g.add(at(box(k, ww + 0.1, wh + 0.1, 0.04, fr), 0, 0, 0.02));
  g.add(at(box(k, ww, wh, 0.04, 'window', lit ? 1 : 0), 0, 0, 0.035));
  if (o.mullion ?? ww > 0.7) g.add(at(box(k, 0.035, wh, 0.03, fr), 0, 0, 0.065));
  if (o.arch) g.add(at(box(k, ww * 0.5, 0.09, 0.05, fr), 0, wh / 2 + 0.09, 0.025));
  if (o.sill ?? true) g.add(at(box(k, ww + 0.18, 0.05, 0.11, 'trim'), 0, -wh / 2 - 0.06, 0.055));
  return k.detail(g);
}

/** Arched window: rectangular pane topped by a half disc, with a frame. Detail. */
export function archWindow(k: Kit, ww: number, wh: number, lit: boolean, frame = 'frame'): THREE.Group {
  const g = group('window');
  const r = ww / 2, rect = wh - r;
  g.add(at(box(k, ww + 0.1, rect, 0.04, frame), 0, -wh / 2 + rect / 2, 0.02));
  g.add(at(disc(k, r + 0.05, 0.04, frame, 0, 12), 0, -wh / 2 + rect, 0.02));
  g.add(at(box(k, ww, rect, 0.04, 'window', lit ? 1 : 0), 0, -wh / 2 + rect / 2, 0.035));
  g.add(at(disc(k, r, 0.04, 'window', lit ? 1 : 0, 12), 0, -wh / 2 + rect, 0.035));
  g.add(at(box(k, 0.03, wh - 0.04, 0.03, frame), 0, -0.02, 0.06));
  g.add(at(box(k, ww + 0.16, 0.05, 0.1, 'trim'), 0, -wh / 2 - 0.05, 0.05));
  return k.detail(g);
}

export interface DoorOpts { w?: number; h?: number; canopy?: string | null; canopyIdx?: number; step?: boolean }

/** Door: leaf, frame, knob, optional canopy and step. Bottom at y = 0. */
export function doorUnit(k: Kit, o: DoorOpts = {}): THREE.Group {
  const w = o.w ?? 0.6, h = o.h ?? 1.0;
  const g = group('door');
  g.add(at(box(k, w, h, 0.05, 'door'), 0, h / 2, 0.025));
  g.add(k.detail(at(box(k, w + 0.12, h + 0.06, 0.035, 'frame'), 0, (h + 0.06) / 2, 0.0175)));
  g.add(k.detail(at(box(k, 0.05, 0.05, 0.03, 'hub'), w * 0.3, h * 0.5, 0.065)));
  if (o.canopy) g.add(k.detail(at(box(k, w + 0.4, 0.07, 0.38, o.canopy, o.canopyIdx ?? 0), 0, h + 0.18, 0.19)));
  if (o.step ?? true) g.add(k.detail(at(box(k, w + 0.24, 0.06, 0.22, 'curb'), 0, 0.03, 0.11)));
  return g;
}

/** Put an object built facing +z onto a face of a w × d footprint (u runs left → right seen from outside). */
export type Face = 'front' | 'back' | 'left' | 'right';
export function onFace<T extends THREE.Object3D>(o: T, face: Face, w: number, d: number, u: number, y: number, out = 0): T {
  switch (face) {
    case 'front': o.position.set(u, y, d / 2 + out); o.rotation.y = 0; break;
    case 'back': o.position.set(-u, y, -d / 2 - out); o.rotation.y = Math.PI; break;
    case 'right': o.position.set(w / 2 + out, y, -u); o.rotation.y = Math.PI / 2; break;
    case 'left': o.position.set(-w / 2 - out, y, u); o.rotation.y = -Math.PI / 2; break;
  }
  return o;
}

/** Clock face looking along +z, centred on the origin: rim, dial, 4 hour ticks, optional hands ('clockHand',
 *  pivot at the centre, rotation.z = angle, 0 = 12 o'clock, clockwise negative; default pose 10:10). */
export function clockFace(k: Kit, r: number, hands: boolean, minuteAngle = -1.047, hourAngle = 0.96): THREE.Group {
  const g = group('clockFace');
  g.add(at(disc(k, r + 0.06, 0.06, 'hands', 0, 20), 0, 0, -0.01));
  g.add(at(disc(k, r, 0.08, 'clock', 0, 20), 0, 0, 0));
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const t = box(k, 0.035, r * 0.2, 0.02, 'hands');
    t.position.set(Math.sin(a) * r * 0.78, Math.cos(a) * r * 0.78, 0.045);
    t.rotation.z = -a;
    g.add(k.detail(t));
  }
  if (hands) {
    for (const [len, ang, wd] of [[r * 0.55, hourAngle, 0.07], [r * 0.82, minuteAngle, 0.05]] as const) {
      const geo = new THREE.BoxGeometry(wd, len, 0.02);
      geo.translate(0, len / 2, 0);
      const hand = shadow(new THREE.Mesh(geo, k.mat('hands')));
      hand.name = 'clockHand';
      hand.rotation.z = ang;
      hand.position.z = 0.055;
      g.add(hand);
    }
    g.add(k.detail(at(disc(k, 0.045, 0.03, 'hands', 0, 8), 0, 0, 0.07)));
  }
  return g;
}

/** Simple wooden bench facing +z (seat, back, two legs). */
export function bench(k: Kit, len = 0.9): THREE.Group {
  const g = group('bench');
  g.add(at(box(k, len, 0.06, 0.26, 'bench'), 0, 0.3, 0));
  g.add(at(box(k, len, 0.22, 0.05, 'bench'), 0, 0.48, -0.12));
  for (const x of [-len / 2 + 0.1, len / 2 - 0.1]) g.add(at(box(k, 0.06, 0.3, 0.24, 'post'), x, 0.15, -0.01));
  return g;
}

/** Globe lamp on a slim post (globe uses role `lamp`, which glows at dusk). */
export function lampPost(k: Kit, h = 1.7): THREE.Group {
  const g = group('lamp');
  g.add(at(cyl(k, 0.08, 0.1, 0.12, 'post', 0, 8), 0, 0.06, 0));
  g.add(at(cyl(k, 0.035, 0.045, h - 0.2, 'post', 0, 6), 0, (h - 0.2) / 2 + 0.1, 0));
  g.add(at(sphere(k, 0.13, 'lamp', 0, 10), 0, h, 0));
  return g;
}
