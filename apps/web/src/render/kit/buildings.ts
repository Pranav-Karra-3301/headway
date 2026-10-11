// Owner: T2.1. Building modules (kit v2): 9 types from the same primitives and roles.
// Scale: person ≈ 0.8, door ≈ 1.0, storey ≈ 1.1. Local frame: footprint centred on the origin, ground at y = 0,
// FRONT (door side) faces +z. Rotate by multiples of π/2 to face a street. Small details (window frames, sills,
// door canopies, roof trims, chimneys caps, rooftop units, awning valances, café tables) are detail()-tagged.
import * as THREE from 'three';
import type { Role } from '../palettes';
import { at, box, cone, cyl, detail, dome, group, prism, prng, rbox, sphere } from './prims';

export const BUILDING_TYPES = ['small', 'tall', 'hall', 'shop', 'house', 'townhouses', 'cafe', 'dorm', 'library'] as const;
export type BuildingType = (typeof BUILDING_TYPES)[number];

export interface BuildingOpts {
  /** Palette `wall` (or `brick` for the dorm) index. */
  wall?: number;
  /** Palette `roof` (and `awning`) index. */
  roof?: number;
  /** Variety seed (which windows are lit at dusk). */
  seed?: number;
}

type Face = 'front' | 'back' | 'left' | 'right';
const FACES: Face[] = ['front', 'right', 'back', 'left'];

/** Put an object built facing +z onto a face of a w × d footprint; u runs left→right seen from outside. */
function onFace<T extends THREE.Object3D>(o: T, face: Face, w: number, d: number, u: number, y: number, out = 0): T {
  switch (face) {
    case 'front': o.position.set(u, y, d / 2 + out); o.rotation.y = 0; break;
    case 'back': o.position.set(-u, y, -d / 2 - out); o.rotation.y = Math.PI; break;
    case 'right': o.position.set(w / 2 + out, y, -u); o.rotation.y = Math.PI / 2; break;
    case 'left': o.position.set(-w / 2 - out, y, u); o.rotation.y = -Math.PI / 2; break;
  }
  return o;
}

interface WinOpts { sill?: boolean; mullion?: boolean; frame?: Role; arch?: boolean }

/** Window facing +z, centred at its middle, back flush with z = 0: frame, glass (lit variant), sill. */
function windowUnit(ww: number, wh: number, lit: boolean, o: WinOpts = {}): THREE.Group {
  const g = new THREE.Group();
  const fr = o.frame ?? 'frame';
  g.add(at(box(ww + 0.1, wh + 0.1, 0.04, fr), 0, 0, 0.02));
  g.add(at(box(ww, wh, 0.04, 'window', lit ? 1 : 0), 0, 0, 0.03));
  if (o.arch) g.add(at(box(ww * 0.62, 0.1, 0.04, fr), 0, wh / 2 + 0.1, 0.02));
  if (o.mullion ?? ww > 0.75) g.add(at(box(0.035, wh, 0.03, fr), 0, 0, 0.06));
  if (o.sill ?? true) g.add(at(box(ww + 0.18, 0.05, 0.11, 'trim'), 0, -wh / 2 - 0.06, 0.055));
  return detail(g);
}

interface DoorOpts { w?: number; h?: number; canopy?: Role | null; canopyIdx?: number; step?: boolean }

/** Door facing +z, bottom at y = 0, back flush with z = 0. The leaf is the only `door`-role part. */
function doorUnit(o: DoorOpts = {}): THREE.Group {
  const w = o.w ?? 0.6, h = o.h ?? 1.0;
  const g = new THREE.Group();
  g.add(at(box(w, h, 0.05, 'door'), 0, h / 2, 0.025));
  g.add(detail(at(box(w + 0.12, h + 0.06, 0.035, 'frame'), 0, (h + 0.06) / 2, 0.0175)));
  g.add(detail(at(box(0.05, 0.05, 0.03, 'hub'), w * 0.3, h * 0.5, 0.06)));
  if (o.canopy !== null) g.add(detail(at(rbox(w + 0.46, 0.07, 0.42, 0.025, o.canopy ?? 'trim', o.canopyIdx ?? 0), 0, h + 0.2, 0.21)));
  if (o.step ?? true) g.add(detail(at(box(w + 0.24, 0.06, 0.24, 'curb'), 0, 0.03, 0.12)));
  return g;
}

/** Windows along a face at the given u positions and storey heights. */
function windowRow(g: THREE.Group, rnd: () => number, face: Face, w: number, d: number, us: number[], y: number, ww: number, wh: number, o?: WinOpts): void {
  for (const u of us) g.add(onFace(windowUnit(ww, wh, rnd() < 0.45, o), face, w, d, u, y));
}

/** Gable roof over a w × d box whose eaves run along x (ridge along x): wall-coloured gable ends + 2 slabs. */
function gableX(g: THREE.Group, w: number, d: number, y: number, rise: number, roofIdx: number, wallRole: Role, wallIdx: number, over = 0.16): void {
  g.add(at(prism(d, rise, w - 0.02, 'x', wallRole, wallIdx), 0, y, 0));
  const half = d / 2, slant = Math.hypot(half, rise), ang = Math.atan2(rise, half);
  const sn = Math.sin(ang), cs = Math.cos(ang);
  for (const s of [-1, 1]) {
    const slab = rbox(w + over * 2, 0.1, slant + over, 0.035, 'roof', roofIdx);
    slab.rotation.x = s * ang;
    g.add(at(slab, 0, y + rise / 2 + 0.05 * cs - (over / 2) * sn, s * (half / 2 + 0.05 * sn + (over / 2) * cs)));
  }
  g.add(detail(at(box(w + over * 2 + 0.02, 0.08, 0.12, 'trim'), 0, y + rise + 0.04, 0)));
}

/** Gable roof with the ridge along z (gable end faces the street). */
function gableZ(g: THREE.Group, x: number, w: number, d: number, y: number, rise: number, roofIdx: number, wallRole: Role, wallIdx: number, over = 0.12): void {
  g.add(at(prism(w, rise, d - 0.02, 'z', wallRole, wallIdx), x, y, 0));
  const half = w / 2, slant = Math.hypot(half, rise), ang = Math.atan2(rise, half);
  const sn = Math.sin(ang), cs = Math.cos(ang);
  for (const s of [-1, 1]) {
    const slab = rbox(slant + over, 0.1, d + over * 2, 0.035, 'roof', roofIdx);
    slab.rotation.z = -s * ang;
    g.add(at(slab, x + s * (half / 2 + 0.05 * sn + (over / 2) * cs), y + rise / 2 + 0.05 * cs - (over / 2) * sn, 0));
  }
}

/** Sloped awning facing +z: hangs from y, projecting `depth`; optional stripes; white valance. */
function awning(width: number, depth: number, idx: number, striped: boolean): THREE.Group {
  const g = new THREE.Group();
  const tilt = 0.42, inner = new THREE.Group();
  if (striped) {
    const n = Math.max(3, Math.round(width / 0.3)), sw = width / n;
    for (let i = 0; i < n; i++) inner.add(at(box(sw, 0.05, depth, i % 2 ? 'stripe' : 'awning', idx), -width / 2 + sw * (i + 0.5), 0, depth / 2));
  } else {
    inner.add(at(rbox(width, 0.05, depth, 0.02, 'awning', idx), 0, 0, depth / 2));
  }
  inner.rotation.x = tilt;
  g.add(inner);
  const dropY = -Math.sin(tilt) * depth, dropZ = Math.cos(tilt) * depth;
  g.add(detail(at(box(width, 0.12, 0.03, striped ? 'awning' : 'stripe', idx), 0, dropY - 0.05, dropZ)));
  return g;
}

function rooftopUnit(g: THREE.Group, x: number, y: number, z: number): void {
  g.add(detail(at(rbox(0.7, 0.36, 0.5, 0.05, 'metal'), x, y + 0.18, z)));
  g.add(detail(at(cyl(0.13, 0.13, 0.05, 'post', 0, 12), x - 0.12, y + 0.385, z)));
}

// ---------------------------------------------------------------------------------------------------------

function small(o: Required<BuildingOpts>, rnd: () => number): THREE.Group {
  const g = new THREE.Group(), w = 3, d = 3, h = 2.3;
  g.add(at(rbox(w, h, d, 0.14, 'wall', o.wall), 0, h / 2, 0));
  g.add(at(rbox(w + 0.2, 0.24, d + 0.2, 0.09, 'roof', o.roof), 0, h + 0.1, 0));
  g.add(detail(at(box(w + 0.05, 0.07, d + 0.05, 'trim'), 0, 1.16, 0)));
  g.add(onFace(doorUnit({ canopy: 'roof', canopyIdx: o.roof }), 'front', w, d, 0.75, 0));
  g.add(onFace(windowUnit(0.95, 0.62, rnd() < 0.5), 'front', w, d, -0.55, 0.62));
  windowRow(g, rnd, 'front', w, d, [-0.7, 0.7], 1.72, 0.58, 0.5);
  for (const f of ['right', 'back', 'left'] as Face[]) {
    windowRow(g, rnd, f, w, d, [-0.7, 0.7], 0.66, 0.58, 0.52);
    windowRow(g, rnd, f, w, d, [-0.7, 0.7], 1.72, 0.58, 0.5);
  }
  rooftopUnit(g, -0.55, h + 0.22, -0.5);
  return g;
}

function tall(o: Required<BuildingOpts>, rnd: () => number): THREE.Group {
  const g = new THREE.Group(), w = 3.2, d = 3.2, g0 = 1.3, fh = 1.1, floors = 4, h = g0 + fh * floors;
  g.add(at(rbox(w, h, d, 0.16, 'wall', o.wall), 0, h / 2, 0));
  g.add(at(rbox(w + 0.16, 0.22, d + 0.16, 0.08, 'roof', o.roof), 0, h + 0.06, 0));
  g.add(detail(at(box(w + 0.05, 0.1, d + 0.05, 'trim'), 0, g0, 0)));
  g.add(onFace(doorUnit({ w: 0.7, canopy: 'roof', canopyIdx: o.roof }), 'front', w, d, 0, 0));
  windowRow(g, rnd, 'front', w, d, [-1.0, 1.0], 0.66, 0.52, 0.56);
  for (let f = 0; f < floors; f++) {
    const y = g0 + 0.55 + f * fh;
    for (const face of FACES) windowRow(g, rnd, face, w, d, [-0.75, 0.75], y, 0.62, 0.56);
    if (f % 2 === 1) for (const u of [-0.75, 0.75]) {
      const bal = new THREE.Group();
      bal.add(at(box(0.86, 0.06, 0.3, 'trim'), 0, 0, 0.15), at(box(0.86, 0.2, 0.03, 'frame'), 0, 0.12, 0.29));
      g.add(detail(onFace(bal, 'front', w, d, u, y - 0.36)));
    }
  }
  for (const face of ['right', 'back', 'left'] as Face[]) windowRow(g, rnd, face, w, d, [-0.75, 0.75], 0.68, 0.56, 0.52);
  g.add(detail(at(cyl(0.34, 0.34, 0.5, 'metal', 0, 14), 0.65, h + 0.42, -0.6)));
  g.add(detail(at(cyl(0.38, 0.3, 0.12, 'roof', o.roof, 14), 0.65, h + 0.73, -0.6)));
  rooftopUnit(g, -0.6, h + 0.17, 0.4);
  return g;
}

function hall(o: Required<BuildingOpts>, rnd: () => number): THREE.Group {
  const g = new THREE.Group(), w = 6.6, d = 3.2, h = 2.4;
  g.add(at(rbox(w, h, d, 0.14, 'hall'), 0, h / 2, 0));
  g.add(at(prism(d + 0.4, 1.25, w + 0.3, 'x', 'hallRoof'), 0, h, 0));
  g.add(detail(at(box(w + 0.1, 0.12, d + 0.1, 'trim'), 0, h - 0.06, 0)));
  // Portico (stays within 1.1 of the front wall): stylobate + step, 4 columns, entablature, pediment.
  g.add(at(rbox(2.2, 0.16, 0.9, 0.05, 'column'), 0, 0.08, d / 2 + 0.45));
  g.add(detail(at(box(2.3, 0.07, 0.2, 'curb'), 0, 0.035, d / 2 + 1.0)));
  for (const x of [-0.72, -0.24, 0.24, 0.72]) g.add(at(cyl(0.09, 0.1, 1.9, 'column', 0, 12), x, 1.11, d / 2 + 0.62));
  g.add(at(rbox(2.0, 0.22, 0.6, 0.05, 'column'), 0, 2.17, d / 2 + 0.55));
  g.add(at(prism(2.1, 0.45, 0.6, 'z', 'column'), 0, 2.28, d / 2 + 0.55));
  g.add(onFace(doorUnit({ w: 0.7, h: 1.2, canopy: null, step: false }), 'front', w, d, 0, 0));
  windowRow(g, rnd, 'front', w, d, [-2.5, -1.6, 1.6, 2.5], 1.3, 0.5, 0.9, { arch: true });
  windowRow(g, rnd, 'back', w, d, [-2.5, -1.6, -0.5, 0.5, 1.6, 2.5], 1.3, 0.5, 0.9, { arch: true });
  for (const f of ['right', 'left'] as Face[]) windowRow(g, rnd, f, w, d, [-0.8, 0.8], 1.3, 0.5, 0.9, { arch: true });
  return g;
}

function shop(o: Required<BuildingOpts>, rnd: () => number): THREE.Group {
  const g = new THREE.Group(), w = 2.6, d = 2.4, h = 1.7;
  g.add(at(rbox(w, h, d, 0.1, 'wall', o.wall), 0, h / 2, 0));
  g.add(at(rbox(w + 0.12, 0.16, d + 0.12, 0.06, 'roof', o.roof), 0, h + 0.06, 0));
  g.add(onFace(doorUnit({ w: 0.55, canopy: null }), 'front', w, d, 0.78, 0));
  g.add(onFace(windowUnit(1.15, 0.7, rnd() < 0.7, { sill: true }), 'front', w, d, -0.42, 0.6));
  g.add(onFace(awning(2.3, 0.55, o.roof, false), 'front', w, d, 0, 1.36));
  g.add(onFace(group(at(box(1.5, 0.24, 0.05, 'paper'), 0, 0, 0.025)), 'front', w, d, -0.1, 1.53));
  g.add(detail(onFace(group(at(box(1.1, 0.07, 0.02, 'accent'), 0, 0, 0.06)), 'front', w, d, -0.1, 1.53)));
  for (const f of ['right', 'back', 'left'] as Face[]) windowRow(g, rnd, f, w, d, [0], 0.85, 0.7, 0.55);
  // Planter by the door.
  g.add(detail(onFace(group(at(rbox(0.5, 0.26, 0.26, 0.04, 'brick', 0), 0, 0.13, 0.13)), 'front', w, d, 1.12, 0)));
  g.add(detail(onFace(group(at(sphere(0.2, 'leaf', 1, 10, 7), 0, 0.36, 0.13)), 'front', w, d, 1.12, 0)));
  return g;
}

function house(o: Required<BuildingOpts>, rnd: () => number): THREE.Group {
  const g = new THREE.Group(), w = 2.8, d = 2.2, h = 1.35, rise = 1.0;
  g.add(at(rbox(w, h, d, 0.08, 'wall', o.wall), 0, h / 2, 0));
  gableX(g, w, d, h, rise, o.roof, 'wall', o.wall);
  // Chimney through the back slope.
  g.add(at(rbox(0.3, 1.0, 0.3, 0.04, 'brick', 0), 0.82, h + 0.72, -0.45));
  g.add(detail(at(box(0.38, 0.06, 0.38, 'trim'), 0.82, h + 1.25, -0.45)));
  g.add(onFace(doorUnit({ canopy: 'roof', canopyIdx: o.roof }), 'front', w, d, 0, 0));
  windowRow(g, rnd, 'front', w, d, [-0.85, 0.85], 0.72, 0.52, 0.5);
  windowRow(g, rnd, 'back', w, d, [-0.7, 0.7], 0.72, 0.52, 0.5);
  for (const f of ['right', 'left'] as Face[]) {
    windowRow(g, rnd, f, w, d, [0], 0.72, 0.52, 0.5);
    windowRow(g, rnd, f, w, d, [0], h + 0.38, 0.3, 0.3, { sill: false });
  }
  // Hedge strip along the front.
  g.add(detail(at(rbox(0.7, 0.3, 0.3, 0.12, 'leaf', 2), -0.85, 0.15, d / 2 + 0.3)));
  return g;
}

function townhouses(o: Required<BuildingOpts>, rnd: () => number): THREE.Group {
  const g = new THREE.Group(), uw = 1.5, n = 3, w = uw * n, d = 2.4, h = 2.3;
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + uw * (i + 0.5), wall = o.wall + i, roof = o.roof + i;
    g.add(at(rbox(uw - 0.02, h, d, 0.06, 'wall', wall), x, h / 2, 0));
    gableZ(g, x, uw, d, h, 0.72, roof, 'wall', wall);
    const unit = (o2: THREE.Object3D, u: number, y: number) => onFace(o2, 'front', w, d, x + u, y);
    g.add(unit(doorUnit({ w: 0.48, canopy: 'roof', canopyIdx: roof }), -0.32, 0));
    g.add(unit(windowUnit(0.42, 0.52, rnd() < 0.45), 0.36, 0.7));
    for (const u of [-0.34, 0.34]) g.add(unit(windowUnit(0.4, 0.5, rnd() < 0.45), u, 1.72));
    g.add(detail(unit(windowUnit(0.26, 0.26, rnd() < 0.4, { sill: false }), 0, h + 0.28)));
    for (const u of [-0.34, 0.34]) g.add(onFace(windowUnit(0.4, 0.5, rnd() < 0.45), 'back', w, d, -(x + u), 1.72));
  }
  for (const f of ['right', 'left'] as Face[]) {
    windowRow(g, rnd, f, w, d, [0], 0.72, 0.5, 0.5);
    windowRow(g, rnd, f, w, d, [0], 1.72, 0.5, 0.5);
  }
  return g;
}

function cafe(o: Required<BuildingOpts>, rnd: () => number): THREE.Group {
  // Corner café inside a 2.8 × 2.3 footprint: café block on the left, a small side terrace with tables on the right.
  const g = new THREE.Group(), W = 2.8, D = 2.3, w = 1.9, d = D, h = 1.6, x0 = -(W - w) / 2;
  const body = new THREE.Group();
  body.add(at(rbox(w, h, d, 0.1, 'wall', o.wall), 0, h / 2, 0));
  body.add(at(rbox(w + 0.12, 0.14, d + 0.12, 0.05, 'roof', o.roof), 0, h + 0.05, 0));
  body.add(onFace(doorUnit({ w: 0.5, canopy: null }), 'front', w, d, 0.55, 0));
  body.add(onFace(windowUnit(0.8, 0.72, rnd() < 0.8, { sill: false }), 'front', w, d, -0.3, 0.62));
  body.add(onFace(windowUnit(1.2, 0.72, rnd() < 0.8, { sill: false }), 'right', w, d, 0, 0.62));
  body.add(onFace(awning(1.8, 0.55, o.roof, true), 'front', w, d, 0, 1.28));
  body.add(onFace(awning(1.0, 0.55, o.roof, true), 'right', w, d, 0.55, 1.28));
  body.add(onFace(group(at(box(1.0, 0.22, 0.05, 'paper'), 0, 0, 0.025)), 'front', w, d, 0, 1.5));
  body.add(detail(onFace(group(at(box(0.66, 0.06, 0.02, 'awning', o.roof), 0, 0, 0.06)), 'front', w, d, 0, 1.5)));
  windowRow(body, rnd, 'back', w, d, [-0.45, 0.45], 0.8, 0.5, 0.5);
  windowRow(body, rnd, 'left', w, d, [-0.6, 0.6], 0.8, 0.5, 0.5);
  body.position.x = x0;
  g.add(body);
  // Side terrace: paving, two tables with stools, one parasol.
  const tx = x0 + w / 2 + (W - w) / 2;
  g.add(detail(at(box(W - w - 0.02, 0.03, D - 0.1, 'curb'), tx, 0.015, 0)));
  for (const [tz, para] of [[-0.55, false], [0.55, true]] as const) {
    const t = new THREE.Group();
    t.add(at(cyl(0.035, 0.05, 0.36, 'metal', 0, 8), 0, 0.18, 0));
    t.add(at(cyl(0.2, 0.2, 0.04, 'stripe', 0, 14), 0, 0.38, 0));
    for (const a of [Math.PI / 2, -Math.PI / 2]) t.add(at(cyl(0.075, 0.075, 0.22, 'awning', o.roof, 10), Math.cos(a) * 0.32, 0.11, Math.sin(a) * 0.32));
    if (para) {
      t.add(at(cyl(0.02, 0.02, 0.85, 'metal', 0, 6), 0, 0.82, 0));
      t.add(at(cone(0.4, 0.2, 'awning', o.roof, 12), 0, 1.3, 0));
    }
    g.add(detail(at(t, tx + 0.08, 0, tz)));
  }
  return g;
}

function dorm(o: Required<BuildingOpts>, rnd: () => number): THREE.Group {
  const g = new THREE.Group(), w = 4.6, d = 3.2, g0 = 1.3, fh = 1.1, floors = 2, h = g0 + fh * floors;
  const brick = o.wall % 2;
  g.add(at(rbox(w, h, d, 0.12, 'brick', brick), 0, h / 2, 0));
  g.add(at(rbox(w + 0.12, 0.2, d + 0.12, 0.05, 'trim'), 0, h + 0.04, 0));
  g.add(detail(at(box(w + 0.04, 0.09, d + 0.04, 'trim'), 0, g0, 0)));
  g.add(onFace(doorUnit({ w: 0.75, canopy: 'trim' }), 'front', w, d, 0, 0));
  windowRow(g, rnd, 'front', w, d, [-1.65, -0.85, 0.85, 1.65], 0.68, 0.5, 0.56);
  windowRow(g, rnd, 'back', w, d, [-1.65, -0.85, 0, 0.85, 1.65], 0.68, 0.5, 0.56);
  for (const f of ['right', 'left'] as Face[]) windowRow(g, rnd, f, w, d, [-0.7, 0.7], 0.68, 0.5, 0.56);
  for (let f = 0; f < floors; f++) {
    const y = g0 + 0.55 + f * fh;
    for (const face of ['front', 'back'] as Face[]) windowRow(g, rnd, face, w, d, [-1.65, -0.85, 0, 0.85, 1.65], y, 0.5, 0.58);
    for (const face of ['right', 'left'] as Face[]) windowRow(g, rnd, face, w, d, [-0.7, 0.7], y, 0.5, 0.58);
  }
  // Rooftop garden: lawn patch, two planters with bushes, stair hut.
  const top = h + 0.14;
  g.add(detail(at(box(w - 0.6, 0.03, d - 0.7, 'lawn'), -0.2, top, 0)));
  for (const z of [-0.85, 0.85]) {
    g.add(detail(at(rbox(1.6, 0.22, 0.42, 0.04, 'trunk'), -0.5, top + 0.11, z)));
    for (const x of [-1.05, -0.5, 0.05]) g.add(detail(at(sphere(0.2, 'leaf', (x * 7) & 3, 10, 7), x, top + 0.3, z)));
  }
  g.add(at(rbox(0.8, 0.62, 0.8, 0.06, 'brick', brick), 1.6, top + 0.31, -0.7));
  g.add(detail(at(box(0.9, 0.06, 0.9, 'trim'), 1.6, top + 0.65, -0.7)));
  return g;
}

function library(o: Required<BuildingOpts>, rnd: () => number): THREE.Group {
  const g = new THREE.Group(), w = 5.4, d = 4.0, base = 0.3, h = 2.6;
  g.add(at(rbox(w + 0.4, base, d + 0.4, 0.06, 'trim'), 0, base / 2, 0));
  g.add(at(rbox(w, h, d, 0.1, 'hall'), 0, base + h / 2, 0));
  g.add(at(rbox(w + 0.2, 0.22, d + 0.2, 0.06, 'column'), 0, base + h + 0.05, 0));
  // Colonnade + pediment across the front.
  const pz = d / 2 + 0.55;
  g.add(at(rbox(4.6, 0.3, 1.1, 0.05, 'column'), 0, 0.15, pz));
  for (let i = 0; i < 6; i++) g.add(at(cyl(0.12, 0.13, 2.3, 'column', 0, 12), -2.0 + i * 0.8, 0.3 + 1.15, pz));
  g.add(at(rbox(4.7, 0.3, 1.1, 0.05, 'column'), 0, 2.75, pz));
  g.add(at(prism(4.7, 0.62, 1.1, 'z', 'column'), 0, 2.9, pz));
  for (let s = 0; s < 3; s++) g.add(detail(at(box(4.0 - s * 0.3, 0.1, 0.3, 'curb'), 0, 0.05 + s * 0.1, pz + 0.85 - s * 0.22)));
  g.add(onFace(doorUnit({ w: 0.8, h: 1.2, canopy: null, step: false }), 'front', w, d, 0, base));
  windowRow(g, rnd, 'front', w, d, [-1.6, 1.6], base + 1.3, 0.5, 1.1, { arch: true });
  windowRow(g, rnd, 'back', w, d, [-1.8, -0.6, 0.6, 1.8], base + 1.3, 0.5, 1.1, { arch: true });
  for (const f of ['right', 'left'] as Face[]) windowRow(g, rnd, f, w, d, [-1.2, 0, 1.2], base + 1.3, 0.5, 1.1, { arch: true });
  // Drum, dome, lantern, finial.
  const top = base + h + 0.16;
  g.add(at(cyl(1.1, 1.15, 0.5, 'hall', 0, 24), 0, top + 0.25, -0.2));
  g.add(detail(at(cyl(1.2, 1.2, 0.08, 'column', 0, 24), 0, top + 0.52, -0.2)));
  g.add(at(dome(1.08, 'dome'), 0, top + 0.5, -0.2));
  g.add(at(cyl(0.2, 0.2, 0.36, 'column', 0, 10), 0, top + 1.72, -0.2));
  g.add(at(cone(0.24, 0.42, 'dome', 0, 10), 0, top + 2.1, -0.2));
  g.add(detail(at(sphere(0.07, 'display', 0, 8, 6), 0, top + 2.36, -0.2)));
  return g;
}

const BUILDERS: Record<BuildingType, (o: Required<BuildingOpts>, rnd: () => number) => THREE.Group> = {
  small, tall, hall, shop, house, townhouses, cafe, dorm, library,
};

/** A building module, front (door) toward +z, base at y = 0. */
export function makeBuilding(type: BuildingType, opts: BuildingOpts = {}): THREE.Group {
  const o: Required<BuildingOpts> = { wall: opts.wall ?? 0, roof: opts.roof ?? 0, seed: opts.seed ?? 0 };
  const rnd = prng(o.seed * 7919 + BUILDING_TYPES.indexOf(type) * 131 + o.wall * 17 + o.roof * 3 + 1);
  const g = BUILDERS[type](o, rnd);
  g.name = `building:${type}`;
  return g;
}

const sizes = new Map<BuildingType, { w: number; d: number; h: number }>();
/** Footprint (w along x, d along z, incl. porticos/terraces/awnings) and height of a building type. */
export function buildingSize(type: BuildingType): { w: number; d: number; h: number } {
  let s = sizes.get(type);
  if (!s) {
    const b = new THREE.Box3().setFromObject(makeBuilding(type));
    s = { w: +(b.max.x - b.min.x).toFixed(2), d: +(b.max.z - b.min.z).toFixed(2), h: +b.max.y.toFixed(2) };
    sizes.set(type, s);
  }
  return s;
}

// Facade helpers, also used by landmarks (clock tower windows) and available for custom buildings.
export { doorUnit, onFace, windowUnit };
export type { Face };
