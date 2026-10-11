// Owner: A2. The campus family's Georgian vocabulary: brick + limestone masses, white sash windows, doors with
// fanlights, columns, pediments, hip/gable roofs, cupolas, finials.
//
// Budget rule: k.rbox (≈300 triangles in basicKit) is kept for the main rounded masses only. Flat details are cheap
// custom geometries (planes, shapes, boxes, hand-built polyhedra) carried by a kit-made mesh, so whatever tagging a
// KitContext applies to its meshes (role, shadows) is preserved. Every geometry is indexed with position/normal/uv,
// exactly like the kit primitives, so composers can merge them. Geometries are cached by size.
import * as THREE from 'three';
import type { KitContext } from '../../types';

type M = THREE.Material;
type V3 = [number, number, number];

const GEO = new Map<string, THREE.BufferGeometry>();
const r3 = (n: number) => Math.round(n * 1000) / 1000;
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = GEO.get(key);
  if (!g) { g = make(); GEO.set(key, g); }
  return g;
}

/** A kit-made mesh carrying a custom geometry. */
export function custom(k: KitContext, geo: THREE.BufferGeometry, m: M): THREE.Mesh {
  const mesh = k.cyl(0.01, 0.01, 0.01, m, 3);
  mesh.geometry = geo;
  return mesh;
}

export function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, z);
  return o;
}
export function rotY<T extends THREE.Object3D>(o: T, a: number): T { o.rotation.y = a; return o; }

/** Plain box (12 triangles) centred on the origin. */
export const box = (k: KitContext, w: number, h: number, d: number, m: M) =>
  custom(k, cached(`bx:${r3(w)},${r3(h)},${r3(d)}`, () => new THREE.BoxGeometry(w, h, d)), m);

/** Flat panel facing +z (2 triangles), centred on the origin. */
export const panel = (k: KitContext, w: number, h: number, m: M) =>
  custom(k, cached(`pl:${r3(w)},${r3(h)}`, () => new THREE.PlaneGeometry(w, h)), m);

/** Flat disc facing +z. */
export const disc = (k: KitContext, r: number, m: M, seg = 12) =>
  custom(k, cached(`dc:${r3(r)},${seg}`, () => new THREE.CircleGeometry(r, seg)), m);

function archShape(w: number, h: number): THREE.Shape {
  const r = w / 2, yc = h / 2 - r, s = new THREE.Shape();
  s.moveTo(-r, -h / 2); s.lineTo(r, -h / 2); s.lineTo(r, yc);
  s.absarc(0, yc, r, 0, Math.PI, false);
  s.lineTo(-r, -h / 2);
  return s;
}
/** Flat round-headed panel facing +z, w wide and h tall overall, centred on the origin. */
export const archPanel = (k: KitContext, w: number, h: number, m: M, seg = 6) =>
  custom(k, cached(`ap:${r3(w)},${r3(h)},${seg}`, () => new THREE.ShapeGeometry(archShape(w, Math.max(h, w / 2 + 0.01)), seg)), m);

/** Flat triangle facing +z: base `span` on y = 0, apex at `rise`. */
export const triPanel = (k: KitContext, span: number, rise: number, m: M) =>
  custom(k, cached(`tp:${r3(span)},${r3(rise)}`, () => polyGeo([[[-span / 2, 0, 0], [span / 2, 0, 0], [0, rise, 0]]])), m);

/** Upper hemisphere (flat side down at y = 0); `squash` scales its height. */
export const dome = (k: KitContext, r: number, m: M, ws = 16, hs = 6, squash = 1) =>
  custom(k, cached(`dm:${r3(r)},${ws},${hs},${r3(squash)}`, () => {
    const g = new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, 0, Math.PI / 2);
    if (squash !== 1) { g.scale(1, squash, 1); g.computeVertexNormals(); }
    return g;
  }), m);

/** Half cylinder (apse), axis vertical, curved side toward -z, base at y = 0. */
export const apse = (k: KitContext, r: number, h: number, m: M, seg = 8) =>
  custom(k, cached(`as:${r3(r)},${r3(h)},${seg}`, () => {
    const g = new THREE.CylinderGeometry(r, r, h, seg, 1, false, Math.PI / 2, Math.PI);
    g.translate(0, h / 2, 0);
    return g;
  }), m);

/** Half cone (apse roof), curved side toward -z, base at y = 0. */
export const halfCone = (k: KitContext, r: number, h: number, m: M, seg = 8) =>
  custom(k, cached(`hc:${r3(r)},${r3(h)},${seg}`, () => {
    const g = new THREE.ConeGeometry(r, h, seg, 1, false, Math.PI / 2, Math.PI);
    g.translate(0, h / 2, 0);
    return g;
  }), m);

/** Semicircular stone ring (arch) in the xy plane, springing at y = 0, extruded `depth` along z (centred). */
export const archRing = (k: KitContext, rOut: number, rIn: number, depth: number, m: M, seg = 10) =>
  custom(k, cached(`ar:${r3(rOut)},${r3(rIn)},${r3(depth)},${seg}`, () => {
    const faces: V3[][] = [];
    const h = depth / 2;
    const p = (r: number, a: number, z: number): V3 => [Math.cos(a) * r, Math.sin(a) * r, z];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI, a1 = ((i + 1) / seg) * Math.PI;
      faces.push([p(rIn, a0, h), p(rOut, a0, h), p(rOut, a1, h), p(rIn, a1, h)]); // front
      faces.push([p(rOut, a0, -h), p(rIn, a0, -h), p(rIn, a1, -h), p(rOut, a1, -h)]); // back
      faces.push([p(rOut, a0, h), p(rOut, a0, -h), p(rOut, a1, -h), p(rOut, a1, h)]); // extrados
      faces.push([p(rIn, a0, -h), p(rIn, a0, h), p(rIn, a1, h), p(rIn, a1, -h)]); // intrados
    }
    return polyGeo(faces);
  }), m);

/**
 * Flat-shaded polyhedron from polygons (counter-clockwise seen from outside), fan-triangulated.
 * Indexed, with normals and (zero) uvs like the kit primitives.
 */
export function polyGeo(faces: V3[][]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  for (const f of faces) {
    const base = pos.length / 3;
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < f.length; i++) {
      const a = f[i]!, b = f[(i + 1) % f.length]!;
      nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    for (const p of f) { pos.push(p[0], p[1], p[2]); nor.push(nx / l, ny / l, nz / l); uv.push(0, 0); }
    for (let i = 1; i + 1 < f.length; i++) idx.push(base, base + i, base + i + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Hip roof over w × d (ridge along x when w ≥ d), eaves at y = 0, ridge at `rise`. */
export const hipRoof = (k: KitContext, w: number, d: number, rise: number, m: M) =>
  custom(k, cached(`hr:${r3(w)},${r3(d)},${r3(rise)}`, () => {
    const hw = w / 2, hd = d / 2, rl = Math.max(0, (w - d) / 2);
    const A: V3 = [-hw, 0, hd], B: V3 = [hw, 0, hd], C: V3 = [hw, 0, -hd], D: V3 = [-hw, 0, -hd];
    const R1: V3 = [-rl, rise, 0], R2: V3 = [rl, rise, 0];
    if (rl === 0) return polyGeo([[A, B, R2], [B, C, R2], [C, D, R2], [D, A, R2]]);
    return polyGeo([[A, B, R2, R1], [C, D, R1, R2], [B, C, R2], [D, A, R1]]);
  }), m);

/** Pyramid roof over w × d with apex at `rise` (eaves at y = 0). */
export const pyramid = (k: KitContext, w: number, d: number, rise: number, m: M) => hipRoof(k, Math.min(w, d), Math.min(w, d), rise, m);

/** Gable slopes over w (along x) × d, ridge along x at `rise`, plus the two gable-end triangles in `endM`. */
export function gableRoof(k: KitContext, w: number, d: number, rise: number, roofM: M, endM: M, over = 0.14, inset = 0): THREE.Group {
  const g = new THREE.Group(), hw = w / 2 + over, hd = d / 2 + over, drop = (over * rise) / (d / 2);
  g.add(custom(k, cached(`gs:${r3(w)},${r3(d)},${r3(rise)},${r3(over)}`, () => polyGeo([
    [[-hw, -drop, hd], [hw, -drop, hd], [hw, rise, 0], [-hw, rise, 0]],
    [[hw, -drop, -hd], [-hw, -drop, -hd], [-hw, rise, 0], [hw, rise, 0]],
    // soffit-less thick edge: a thin fascia under each eave
    [[-hw, -drop - 0.06, hd], [hw, -drop - 0.06, hd], [hw, -drop, hd], [-hw, -drop, hd]],
    [[hw, -drop - 0.06, -hd], [-hw, -drop - 0.06, -hd], [-hw, -drop, -hd], [hw, -drop, -hd]],
  ])), roofM));
  const ex = w / 2 - inset, ed = d / 2;
  g.add(custom(k, cached(`ge:${r3(ex)},${r3(ed)},${r3(rise)}`, () => polyGeo([
    [[ex, 0, ed], [ex, 0, -ed], [ex, rise, 0]],
    [[-ex, 0, -ed], [-ex, 0, ed], [-ex, rise, 0]],
  ])), endM));
  return g;
}

/** Solid triangular pediment facing +z: base `span` at y = 0, apex at `rise`, `depth` along z (centred). */
export const pediment = (k: KitContext, span: number, rise: number, depth: number, m: M) =>
  custom(k, cached(`pd:${r3(span)},${r3(rise)},${r3(depth)}`, () => {
    const s = span / 2, h = depth / 2;
    return polyGeo([
      [[-s, 0, h], [s, 0, h], [0, rise, h]],
      [[s, 0, -h], [-s, 0, -h], [0, rise, -h]],
      [[-s, 0, -h], [-s, 0, h], [0, rise, h], [0, rise, -h]],
      [[s, 0, h], [s, 0, -h], [0, rise, -h], [0, rise, h]],
      [[-s, 0, -h], [s, 0, -h], [s, 0, h], [-s, 0, h]],
    ]);
  }), m);

// ------------------------------------------------------------------------------------------------ placement

export type Face = 'front' | 'back' | 'left' | 'right';
export const FACES: Face[] = ['front', 'right', 'back', 'left'];
/** A wall block: centre (cx, cz) and size w × d. */
export interface Block { cx: number; cz: number; w: number; d: number }

/** Put an object built facing +z onto a face of a block; u runs left→right as seen from outside. */
export function onFace<T extends THREE.Object3D>(o: T, b: Block, face: Face, u: number, y: number, out = 0): T {
  switch (face) {
    case 'front': o.position.set(b.cx + u, y, b.cz + b.d / 2 + out); o.rotation.y = 0; break;
    case 'back': o.position.set(b.cx - u, y, b.cz - b.d / 2 - out); o.rotation.y = Math.PI; break;
    case 'right': o.position.set(b.cx + b.w / 2 + out, y, b.cz - u); o.rotation.y = Math.PI / 2; break;
    case 'left': o.position.set(b.cx - b.w / 2 - out, y, b.cz + u); o.rotation.y = -Math.PI / 2; break;
  }
  return o;
}
/** Width of a face (the extent along u). */
export const faceWidth = (b: Block, f: Face) => (f === 'front' || f === 'back' ? b.w : b.d);

/** Evenly spaced bay positions across a span. */
export function bays(n: number, span: number): number[] {
  return Array.from({ length: n }, (_, i) => (n === 1 ? 0 : -span / 2 + (span * i) / (n - 1)));
}

// ------------------------------------------------------------------------------------------------ elements

export interface Mats {
  brick: M; stone: M; trim: M; roof: M; copper: M; gold: M; door: M; dark: M; lit: M;
}
/** The shared campus materials of one building. */
export function mats(k: KitContext, brick = 0, roof = 0, door = 0): Mats {
  return {
    brick: k.mat('cpBrick', brick), stone: k.mat('cpStone'), trim: k.mat('cpTrim'), roof: k.mat('cpRoof', roof),
    copper: k.mat('cpCopper'), gold: k.mat('cpGold'), door: k.mat('cpDoor', door),
    dark: k.mat('window', 0), lit: k.mat('window', 1),
  };
}

export interface SashOpts {
  /** Chance this window is lit at dusk. */
  lit?: number;
  /** Round-headed window (arched top). */
  arch?: boolean;
  /** White glazing bars (cross). */
  bars?: boolean;
  /** Stone lintel + keystone (rectangular windows). */
  lintel?: boolean;
  /** Stone sill. */
  sill?: boolean;
  frame?: M;
}
/** Georgian sash window facing +z, centred at its middle, sitting on a wall at z = 0. Whole unit is a detail. */
export function sash(k: KitContext, x: Mats, w: number, h: number, o: SashOpts = {}): THREE.Group {
  const g = new THREE.Group(), f = 0.065, frame = o.frame ?? x.trim;
  const glass = k.rand() < (o.lit ?? 0.42) ? x.lit : x.dark;
  if (o.arch) {
    g.add(at(archPanel(k, w + 2 * f, h + 2 * f, frame), 0, 0, 0.012));
    g.add(at(archPanel(k, w, h, glass), 0, 0, 0.022));
  } else {
    g.add(at(panel(k, w + 2 * f, h + 2 * f, frame), 0, 0, 0.012));
    g.add(at(panel(k, w, h, glass), 0, 0, 0.022));
  }
  if (o.bars ?? true) {
    const rail = o.arch ? h / 2 - w / 2 : 0.04 * h;
    g.add(at(panel(k, w, 0.04, frame), 0, rail, 0.03));
    g.add(at(panel(k, 0.035, o.arch ? h * 0.98 : h, frame), 0, 0, 0.03));
  }
  if (o.lintel && !o.arch) {
    g.add(at(box(k, w + 0.22, 0.1, 0.06, x.stone), 0, h / 2 + f + 0.05, 0.03));
    g.add(at(box(k, 0.13, 0.15, 0.08, x.stone), 0, h / 2 + f + 0.06, 0.04));
  }
  if (o.sill ?? true) g.add(at(box(k, w + 0.18, 0.05, 0.09, x.stone), 0, -h / 2 - f - 0.02, 0.045));
  return k.detail(g);
}

/** A row of sash windows on a face of a block. */
export function sashRow(g: THREE.Group, k: KitContext, x: Mats, b: Block, face: Face, us: number[], y: number, w: number, h: number, o?: SashOpts): void {
  for (const u of us) g.add(onFace(sash(k, x, w, h, o), b, face, u, y));
}

export interface DoorOpts {
  w?: number; h?: number;
  /** Semicircular fanlight above the door. */
  fanlight?: boolean;
  /** Surround: white pilasters + cornice ('classic'), small pediment ('pediment'), or frame only ('plain'). */
  surround?: 'classic' | 'pediment' | 'plain';
  step?: boolean;
  /** Double door (centre line). */
  double?: boolean;
}
/** Georgian front door facing +z, bottom at y = 0, on a wall at z = 0. The leaf uses the door role. */
export function door(k: KitContext, x: Mats, o: DoorOpts = {}): THREE.Group {
  const g = new THREE.Group(), w = o.w ?? 0.62, h = o.h ?? 1.05, surround = o.surround ?? 'classic';
  g.add(at(panel(k, w + 0.12, h + 0.06, x.trim), 0, (h + 0.06) / 2, 0.012));
  g.add(at(box(k, w, h, 0.04, x.door), 0, h / 2, 0.02));
  if (o.double) g.add(k.detail(at(panel(k, 0.03, h * 0.94, x.trim), 0, h / 2, 0.045)));
  let top = h + 0.06;
  if (o.fanlight ?? true) {
    const W = w + 0.12, H = W / 2 + 0.03, W2 = w - 0.06, H2 = W2 / 2 + 0.01;
    g.add(at(archPanel(k, W, H, x.trim), 0, top + H / 2, 0.012));
    g.add(at(archPanel(k, W2, H2, x.lit), 0, top + 0.015 + H2 / 2, 0.02));
    top += H;
  }
  if (surround !== 'plain') {
    for (const s of [-1, 1]) g.add(at(box(k, 0.1, top, 0.07, x.trim), s * (w / 2 + 0.11), top / 2, 0.035));
    if (surround === 'pediment') {
      g.add(at(box(k, w + 0.42, 0.08, 0.12, x.trim), 0, top + 0.04, 0.06));
      g.add(at(pediment(k, w + 0.46, 0.24, 0.12, x.trim), 0, top + 0.08, 0.06));
    } else {
      g.add(at(box(k, w + 0.46, 0.1, 0.14, x.trim), 0, top + 0.05, 0.07));
    }
  }
  if (o.step ?? true) g.add(at(box(k, w + 0.5, 0.08, 0.3, x.stone), 0, 0.04, 0.15));
  return g;
}

/** Tuscan column: base, slightly tapered shaft, capital. Bottom at y = 0. */
export function column(k: KitContext, h: number, r: number, m: M, seg = 10): THREE.Group {
  const g = new THREE.Group();
  g.add(at(box(k, r * 2.5, 0.08, r * 2.5, m), 0, 0.04, 0));
  g.add(at(k.cyl(r * 0.86, r, h - 0.17, m, seg), 0, 0.08 + (h - 0.17) / 2, 0));
  g.add(at(box(k, r * 2.6, 0.09, r * 2.6, m), 0, h - 0.045, 0));
  return g;
}

export interface PorticoOpts {
  /** Number of columns. */
  n: number;
  /** Width of the portico (outer column centres span = width - 2r - 0.2). */
  width: number;
  /** Depth from the wall to the front of the entablature. */
  depth: number;
  /** Floor level (top of the stylobate) and height of the columns. */
  floor: number;
  colH: number;
  r?: number;
  /** Entablature height; pediment rise (0 = flat top). */
  ent?: number;
  rise?: number;
  /** Stone steps down to the ground in front. */
  steps?: number;
  stepDepth?: number;
  /** Round window in the tympanum. */
  oculus?: boolean;
}
/** Classical portico facing +z, its back on a wall at z = 0. Returns the group; extends `depth + steps*stepDepth` forward. */
export function portico(k: KitContext, x: Mats, o: PorticoOpts): THREE.Group {
  const g = new THREE.Group(), r = o.r ?? 0.1, ent = o.ent ?? 0.26, nSteps = o.steps ?? 0, sd = o.stepDepth ?? 0.16;
  // Stylobate + steps.
  if (o.floor > 0.02) g.add(at(box(k, o.width, o.floor, o.depth, x.stone), 0, o.floor / 2, o.depth / 2));
  for (let i = 0; i < nSteps; i++) {
    const sh = o.floor * (1 - (i + 1) / (nSteps + 1));
    g.add(at(box(k, o.width - 0.1 * i, sh, sd, x.stone), 0, sh / 2, o.depth + sd * (i + 0.5)));
  }
  // Columns on the front line.
  const zc = o.depth - r - 0.12, span = o.width - 2 * r - 0.3;
  for (const u of bays(o.n, span)) g.add(at(column(k, o.colH, r, x.trim), u, o.floor, zc));
  // Entablature + pediment.
  const yE = o.floor + o.colH;
  g.add(at(box(k, o.width, ent, o.depth, x.trim), 0, yE + ent / 2, o.depth / 2));
  g.add(k.detail(at(box(k, o.width + 0.06, 0.05, o.depth + 0.04, x.stone), 0, yE + 0.025, o.depth / 2 + 0.01)));
  if ((o.rise ?? 0) > 0) {
    g.add(at(pediment(k, o.width + 0.08, o.rise!, o.depth + 0.04, x.trim), 0, yE + ent, o.depth / 2));
    g.add(at(triPanel(k, o.width - 0.36, o.rise! - 0.12, x.stone), 0, yE + ent + 0.06, o.depth + 0.025));
    if (o.oculus ?? true) {
      const rr = Math.min(0.14, o.rise! * 0.28);
      g.add(k.detail(at(disc(k, rr + 0.04, x.trim, 12), 0, yE + ent + o.rise! * 0.36, o.depth + 0.03)));
      g.add(k.detail(at(disc(k, rr, x.dark, 12), 0, yE + ent + o.rise! * 0.36, o.depth + 0.035)));
    }
  }
  return g;
}

/** White cupola (square base, octagonal drum with arched openings, copper dome, gold finial). Base at y = 0;
 *  `sink` extends the base downward (below y = 0) so it can sit astride a roof ridge. */
export function cupola(k: KitContext, x: Mats, s = 0.7, sink = 0): THREE.Group {
  const g = new THREE.Group(), bh = s * 0.42, dr = s * 0.4, dh = s * 0.52;
  g.add(at(box(k, s, bh + sink, s, x.trim), 0, (bh - sink) / 2, 0));
  g.add(k.detail(at(box(k, s + 0.08, 0.06, s + 0.08, x.trim), 0, bh, 0)));
  g.add(rotY(at(k.cyl(dr, dr, dh, x.trim, 8), 0, bh + dh / 2, 0), Math.PI / 8));
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2, o = archPanel(k, dr * 0.62, dh * 0.72, x.dark), ap = dr * Math.cos(Math.PI / 8) + 0.008;
    o.rotation.y = a;
    g.add(k.detail(at(o, Math.sin(a) * ap, bh + dh * 0.48, Math.cos(a) * ap)));
  }
  g.add(at(k.cyl(dr + 0.05, dr + 0.05, 0.06, x.trim, 8), 0, bh + dh + 0.03, 0));
  g.add(at(dome(k, dr + 0.02, x.copper, 10, 4, 1.05), 0, bh + dh + 0.06, 0));
  g.add(finial(k, x, s * 0.36, bh + dh + 0.06 + (dr + 0.02) * 1.05 - 0.02));
  return g;
}

/** Gold ball + spike finial standing at y. */
export function finial(k: KitContext, x: Mats, h: number, y: number): THREE.Group {
  const g = new THREE.Group();
  g.add(at(k.cyl(0.018, 0.026, h * 0.55, x.gold, 6), 0, y + h * 0.275, 0));
  g.add(at(k.sphere(h * 0.16, x.gold, 8), 0, y + h * 0.55, 0));
  g.add(at(k.cone(h * 0.07, h * 0.4, x.gold, 6), 0, y + h * 0.8, 0));
  return k.detail(g);
}

/** Brick chimney with a stone cap and two pots, bottom at y = 0. */
export function chimney(k: KitContext, x: Mats, w: number, d: number, h: number): THREE.Group {
  const g = new THREE.Group();
  g.add(at(box(k, w, h, d, x.brick), 0, h / 2, 0));
  g.add(at(box(k, w + 0.1, 0.08, d + 0.1, x.stone), 0, h + 0.04, 0));
  for (const s of d > w ? [-1, 1] : [0]) g.add(k.detail(at(k.cyl(0.055, 0.065, 0.16, x.brick, 6), 0, h + 0.16, s * d * 0.25)));
  return g;
}

/** Stone quoins: alternating big/small stone blocks wrapping the 4 vertical corners of a block, from y0 to y1. */
export function quoins(k: KitContext, x: Mats, b: Block, y0: number, y1: number, out = 0.022): THREE.Group {
  const g = new THREE.Group(), n = Math.max(2, Math.round((y1 - y0) / 0.34)), step = (y1 - y0) / n;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (let i = 0; i < n; i++) {
    const l = i % 2 === 0 ? 0.32 : 0.2;
    g.add(at(box(k, l, step - 0.05, l, x.stone), b.cx + sx * (b.w / 2 - l / 2 + out), y0 + step * (i + 0.5), b.cz + sz * (b.d / 2 - l / 2 + out)));
  }
  return k.detail(g);
}

/** Thin horizontal band (string course / cornice) around a block at height y. */
export function band(k: KitContext, b: Block, y: number, h: number, out: number, m: M): THREE.Mesh {
  return at(box(k, b.w + 2 * out, h, b.d + 2 * out, m), b.cx, y, b.cz);
}

/** Flagpole with a small flag (flag hangs toward +x). Bottom at y = 0. */
export function flagpole(k: KitContext, x: Mats, h: number, flagM: M): THREE.Group {
  const g = new THREE.Group();
  g.add(at(k.cyl(0.03, 0.04, h, x.trim, 6), 0, h / 2, 0));
  g.add(k.detail(at(k.sphere(0.055, x.gold, 6), 0, h + 0.03, 0)));
  const fw = Math.min(0.7, h * 0.36), fh = fw * 0.62;
  g.add(at(box(k, fw, fh, 0.03, flagM), fw / 2 + 0.03, h - fh / 2 - 0.06, 0));
  return g;
}

/** Round window (oculus) facing +z with a white surround and glazing cross, centred on the origin. */
export function roundel(k: KitContext, x: Mats, r: number): THREE.Group {
  const g = new THREE.Group();
  g.add(at(disc(k, r + 0.065, x.trim, 14), 0, 0, 0.014));
  g.add(at(disc(k, r, x.lit, 14), 0, 0, 0.022));
  g.add(at(panel(k, 0.035, r * 2, x.trim), 0, 0, 0.03));
  g.add(at(panel(k, r * 2, 0.035, x.trim), 0, 0, 0.03));
  return g;
}
