// Owner: A1. Downtown toolkit: role-tagged primitives over the KitContext, plus facade pieces (windows, doors,
// storefronts, awnings, signs, cornices, parapets, rooftop clutter, tiny cars).
// Conventions: every facade piece is built facing +z with its back on z = 0 and its local x running left→right
// as seen from the street; place it with `onFace`. Big volumes use k.rbox (rounded); flat details are plain boxes
// so a whole building stays under ~3k triangles. Every mesh carries userData.part = { role, idx }.
import * as THREE from 'three';
import type { AssetParams, KitContext } from '../../types';

export type RoleRef = readonly [role: string, idx: number];
export type Face = 'front' | 'back' | 'left' | 'right';
export type V2 = readonly [number, number];

export const TRIM: RoleRef = ['dtTrim', 0];
export const STONE: RoleRef = ['dtStone', 0];
export const STONE_DARK: RoleRef = ['dtStone', 1];
export const DARK: RoleRef = ['dtDark', 0];
export const METAL: RoleRef = ['dtMetal', 0];
export const IRON: RoleRef = ['dtMetal', 1];
export const CANVAS: RoleRef = ['dtCanvas', 0];

/** Small deterministic PRNG (mulberry32) for explicit `params.variant` choices. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Variety stream for one build: `params.variant` (number) pins the look, otherwise the placement seed (k.rand). */
export function varietyOf(k: KitContext, params: AssetParams, salt: number): () => number {
  const v = params.variant;
  if (typeof v === 'number' && Number.isFinite(v)) return mulberry32(Math.floor(v) * 7919 + salt * 104729 + 17);
  return () => k.rand();
}

export function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, z);
  return o;
}
export function rotY<T extends THREE.Object3D>(o: T, a: number): T {
  o.rotation.y = a;
  return o;
}

/** Downtown builder context: the shared KitContext plus role-tagged primitives and a variety stream. */
export class Dk {
  constructor(readonly k: KitContext, readonly rnd: () => number) {}

  private tag<T extends THREE.Mesh>(m: T, r: RoleRef): T {
    m.userData.part = { role: r[0], idx: r[1] };
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
  mesh(geo: THREE.BufferGeometry, r: RoleRef): THREE.Mesh {
    return this.tag(new THREE.Mesh(geo, this.k.mat(r[0], r[1])), r);
  }
  box(w: number, h: number, d: number, r: RoleRef): THREE.Mesh {
    return this.mesh(new THREE.BoxGeometry(w, h, d), r);
  }
  rbox(w: number, h: number, d: number, rad: number, r: RoleRef): THREE.Mesh {
    return this.tag(this.k.rbox(w, h, d, rad, this.k.mat(r[0], r[1])), r);
  }
  /** Cheap rounded box (~90 tris vs ~300 for rbox): rounded-rect prism with softened top and bottom edges,
   *  centred on the origin like rbox. For copings, slabs and secondary volumes. */
  soft(w: number, h: number, d: number, rad: number, r: RoleRef): THREE.Mesh {
    const rr = Math.max(0.01, Math.min(rad, w / 2 - 0.005, d / 2 - 0.005));
    const hw = w / 2, hd = d / 2;
    const s = new THREE.Shape();
    s.moveTo(-hw + rr, -hd);
    s.lineTo(hw - rr, -hd);
    s.absarc(hw - rr, -hd + rr, rr, -Math.PI / 2, 0, false);
    s.lineTo(hw, hd - rr);
    s.absarc(hw - rr, hd - rr, rr, 0, Math.PI / 2, false);
    s.lineTo(-hw + rr, hd);
    s.absarc(-hw + rr, hd - rr, rr, Math.PI / 2, Math.PI, false);
    s.lineTo(-hw, -hd + rr);
    s.absarc(-hw + rr, -hd + rr, rr, Math.PI, Math.PI * 1.5, false);
    const b = Math.min(rr * 0.6, h / 3);
    const g = new THREE.ExtrudeGeometry(s, {
      depth: h - 2 * b, curveSegments: 1, bevelEnabled: b > 0.002, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 1,
    });
    g.rotateX(-Math.PI / 2);
    g.translate(0, b - h / 2, 0);
    return this.mesh(g, r);
  }
  cyl(rt: number, rb: number, h: number, r: RoleRef, seg = 12): THREE.Mesh {
    return this.tag(this.k.cyl(rt, rb, h, this.k.mat(r[0], r[1]), seg), r);
  }
  sphere(rad: number, r: RoleRef, seg = 8): THREE.Mesh {
    return this.tag(this.k.sphere(rad, this.k.mat(r[0], r[1]), seg), r);
  }
  cone(rad: number, h: number, r: RoleRef, seg = 12): THREE.Mesh {
    return this.tag(this.k.cone(rad, h, this.k.mat(r[0], r[1]), seg), r);
  }
  detail<T extends THREE.Object3D>(o: T): T {
    return this.k.detail(o);
  }

  /** Disc facing +z (axis along z), back on z = 0. */
  disc(rad: number, depth: number, r: RoleRef, seg = 14): THREE.Mesh {
    const g = new THREE.CylinderGeometry(rad, rad, depth, seg);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, depth / 2);
    return this.mesh(g, r);
  }
  /** Upper half disc facing +z (flat side down at y = 0), back on z = 0: arch heads. */
  halfDisc(rad: number, depth: number, r: RoleRef, seg = 8): THREE.Mesh {
    const g = new THREE.CylinderGeometry(rad, rad, depth, seg, 1, false, Math.PI / 2, Math.PI);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, depth / 2);
    return this.mesh(g, r);
  }
  /** Solid from a (z, y) profile, extruded along x over `width`, centred on x = 0. */
  extrudeX(pts: readonly V2[], width: number, r: RoleRef): THREE.Mesh {
    const s = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
    const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false, curveSegments: 1 });
    g.translate(0, 0, -width / 2);
    g.rotateY(-Math.PI / 2);
    return this.mesh(g, r);
  }
  /** Solid from an (x, z) footprint polygon, from y = 0 up to h; `bevel` softens the top and bottom edges. */
  extrudeY(pts: readonly V2[], h: number, r: RoleRef, bevel = 0): THREE.Mesh {
    const s = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
    const b = Math.min(bevel, h / 3);
    const g = new THREE.ExtrudeGeometry(s, {
      depth: h - 2 * b, curveSegments: 1, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 2,
    });
    g.rotateX(-Math.PI / 2);
    g.translate(0, b, 0);
    return this.mesh(g, r);
  }
  /** Triangular prism facing +z: base w on y = 0, apex at y = h, thickness d (z from 0 to d). */
  gable(w: number, h: number, d: number, r: RoleRef): THREE.Mesh {
    const s = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h)]);
    return this.mesh(new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false }), r);
  }
  /** Hip roof: rectangular frustum over w × d from y = 0 to h, top inset by `inset` on every side. */
  hip(w: number, d: number, h: number, inset: number, r: RoleRef): THREE.Mesh {
    const a = w / 2, b = d / 2, c = Math.max(0.02, a - inset), e = Math.max(0.02, b - inset);
    const B = [[-a, 0, -b], [a, 0, -b], [a, 0, b], [-a, 0, b]] as const;
    const T = [[-c, h, -e], [c, h, -e], [c, h, e], [-c, h, e]] as const;
    const pos: number[] = [];
    const quad = (p0: readonly number[], p1: readonly number[], p2: readonly number[], p3: readonly number[]) =>
      pos.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
    quad(B[3], B[2], T[2], T[3]);
    quad(B[2], B[1], T[1], T[2]);
    quad(B[1], B[0], T[0], T[1]);
    quad(B[0], B[3], T[3], T[0]);
    quad(T[3], T[2], T[1], T[0]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return this.mesh(g, r);
  }

  // Variety helpers.
  chance(p: number): boolean { return this.rnd() < p; }
  int(n: number): number { return Math.min(n - 1, Math.floor(this.rnd() * n)); }
  pick<T>(xs: readonly T[]): T { return xs[this.int(xs.length)]!; }
  range(lo: number, hi: number): number { return lo + (hi - lo) * this.rnd(); }
}

/** Put an object built facing +z onto a face of a w × d box centred at (cx, cz); u runs left→right seen from outside. */
export function onFace<T extends THREE.Object3D>(o: T, face: Face, w: number, d: number, u: number, y: number, cx = 0, cz = 0, out = 0): T {
  switch (face) {
    case 'front': o.position.set(cx + u, y, cz + d / 2 + out); o.rotation.y = 0; break;
    case 'back': o.position.set(cx - u, y, cz - d / 2 - out); o.rotation.y = Math.PI; break;
    case 'right': o.position.set(cx + w / 2 + out, y, cz - u); o.rotation.y = Math.PI / 2; break;
    case 'left': o.position.set(cx - w / 2 - out, y, cz + u); o.rotation.y = -Math.PI / 2; break;
  }
  return o;
}

// ------------------------------------------------------------------------------------------------ colour schemes

export interface Scheme {
  wall: RoleRef;
  brick: boolean;
  awning: number;
  striped: boolean;
  front: number;
  sign: number;
  ink: number;
  door: number;
}

/** Awning colours that clash with each painted facade (cream, butter, mint, peach, blue). */
const PAINT_CLASH: Record<number, number[]> = { 0: [], 1: [2], 2: [1], 3: [0, 4], 4: [3] };

/** A harmonious facade scheme: brick or paint, awning, storefront frame, sign board and lettering colours. */
export function scheme(p: Dk, wall: 'brick' | 'paint' | 'any' = 'any'): Scheme {
  const paint = wall === 'paint' || (wall === 'any' && p.chance(0.35));
  const wallRef: RoleRef = paint ? ['dtPaint', p.int(5)] : ['dtBrick', p.int(4)];
  let awning = p.int(5);
  const clash = paint ? PAINT_CLASH[wallRef[1]]! : [];
  while (clash.includes(awning)) awning = (awning + 2) % 5;
  // Coral and blush on red brick only as stripes, so the canvas still reads against the wall.
  const striped = !paint && (awning === 0 || awning === 4) ? true : p.chance(0.55);
  const front = p.int(5);
  let sign = p.int(5);
  if (sign === front) sign = (sign + 1) % 5;
  const ink = sign === 3 ? 3 : p.pick([0, 1, 2]);
  return { wall: wallRef, brick: !paint, awning, striped, front, sign, ink, door: p.int(5) };
}

// ------------------------------------------------------------------------------------------------ facade pieces

export interface WinOpts {
  lit?: boolean;
  frame?: RoleRef | null;
  lintel?: RoleRef | null;
  sill?: RoleRef | null;
  bars?: 'none' | 'v' | 'h' | 'cross';
  /** Arched head (half disc of glass inside a ring of this role). */
  arch?: RoleRef | null;
}

/** A window centred on its middle, facing +z. Glass is the core part; frame, bars, sill and lintel are detail. */
export function windowUnit(p: Dk, ww: number, wh: number, o: WinOpts = {}): THREE.Group {
  const g = new THREE.Group();
  const lit = o.lit ?? p.chance(0.42);
  g.add(at(p.box(ww, wh, 0.04, ['window', lit ? 1 : 0]), 0, 0, 0.02));
  const frame = o.frame === undefined ? TRIM : o.frame;
  if (frame) g.add(p.detail(at(p.box(ww + 0.08, wh + 0.08, 0.03, frame), 0, 0, 0.012)));
  const bars = o.bars ?? (ww >= 0.45 ? 'h' : 'none');
  const barRole = frame ?? TRIM;
  if (bars === 'v' || bars === 'cross') g.add(p.detail(at(p.box(0.03, wh, 0.02, barRole), 0, 0, 0.05)));
  if (bars === 'h' || bars === 'cross') g.add(p.detail(at(p.box(ww, 0.03, 0.02, barRole), 0, wh * 0.08, 0.05)));
  if (o.arch) {
    g.add(at(p.halfDisc(ww / 2, 0.04, ['window', lit ? 1 : 0]), 0, wh / 2, 0));
    g.add(p.detail(at(p.halfDisc(ww / 2 + 0.08, 0.03, o.arch), 0, wh / 2, 0)));
  } else if (o.lintel !== null) {
    g.add(p.detail(at(p.box(ww + 0.14, 0.08, 0.05, o.lintel ?? STONE), 0, wh / 2 + 0.08, 0.025)));
  }
  if (o.sill !== null) g.add(p.detail(at(p.box(ww + 0.14, 0.05, 0.09, o.sill ?? STONE), 0, -wh / 2 - 0.05, 0.045)));
  return g;
}

/** Cheap side/back window: glass + sill only. */
export function plainWindow(p: Dk, ww: number, wh: number, sill: RoleRef = STONE): THREE.Group {
  return windowUnit(p, ww, wh, { frame: null, lintel: null, bars: 'none', sill });
}

export interface DoorOpts {
  w?: number;
  h?: number;
  leaf?: RoleRef;
  /** Glass panel in the leaf (lit at dusk). */
  glass?: boolean;
  /** Dark reveal around the leaf, reads as a recessed entry. */
  recess?: boolean;
  transom?: boolean;
  surround?: RoleRef | null;
  canopy?: RoleRef | null;
  step?: RoleRef | null;
  /** The main entrance of the asset (tests check it faces the street). */
  main?: boolean;
}

/** Door facing +z, bottom at y = 0. */
export function doorUnit(p: Dk, o: DoorOpts = {}): THREE.Group {
  const w = o.w ?? 0.52, h = o.h ?? 1.0;
  const g = new THREE.Group();
  if (o.surround !== null) g.add(p.detail(at(p.box(w + 0.14, h + 0.08, 0.03, o.surround ?? TRIM), 0, (h + 0.08) / 2, 0.012)));
  if (o.recess ?? true) g.add(at(p.box(w + 0.04, h + 0.02, 0.035, DARK), 0, (h + 0.02) / 2, 0.02));
  const leaf = p.box(w - 0.06, h - 0.04, 0.04, o.leaf ?? ['dtDoor', 0]);
  leaf.userData.entrance = o.main ?? true;
  g.add(at(leaf, 0, (h - 0.04) / 2, 0.03));
  if (o.glass ?? true) g.add(p.detail(at(p.box((w - 0.06) * 0.62, h * 0.4, 0.02, ['window', 1]), 0, h * 0.64, 0.055)));
  if (o.transom) g.add(at(p.box(w + 0.04, 0.16, 0.035, ['window', 1]), 0, h + 0.12, 0.02));
  if (o.canopy) g.add(p.detail(at(p.rbox(w + 0.36, 0.07, 0.34, 0.025, o.canopy), 0, h + (o.transom ? 0.33 : 0.18), 0.17)));
  if (o.step) g.add(p.detail(at(p.box(w + 0.2, 0.06, 0.18, o.step), 0, 0.03, 0.09)));
  return g;
}

export interface AwningOpts {
  style: 'shed' | 'round';
  idx: number;
  striped: boolean;
}

/** Awning facing +z: its top edge hangs on the wall at y = 0, z = 0; projects `depth`. */
export function awning(p: Dk, width: number, depth: number, o: AwningOpts): THREE.Group {
  const g = new THREE.Group();
  const col: RoleRef = ['dtAwning', o.idx];
  const t = 0.035, val = 0.11;
  let profile: V2[];
  let cheek: V2[];
  let lipY: number;
  if (o.style === 'shed') {
    const drop = depth * 0.55;
    profile = [[0, 0], [depth, -drop], [depth, -drop - val], [depth - t, -drop - val], [depth - t, -drop * ((depth - t) / depth) - t], [0, -t]];
    cheek = [[0, 0], [depth, -drop], [0, -drop]];
    lipY = -drop;
  } else {
    const R = depth, n = 4;
    const outer: V2[] = [], inner: V2[] = [];
    for (let i = 0; i <= n; i++) {
      const a = (Math.PI / 2) * (1 - i / n);
      outer.push([R * Math.cos(a), -R + R * Math.sin(a)]);
      inner.push([(R - t) * Math.cos(a), -R + (R - t) * Math.sin(a)]);
    }
    profile = [...outer, [R, -R - val], [R - t, -R - val], ...inner.reverse()];
    cheek = [...outer, [0, -R]];
    lipY = -R;
  }
  if (o.striped) {
    const n = Math.max(5, Math.round(width / (o.style === 'round' ? 0.36 : 0.3)) | 1), sw = width / n;
    for (let i = 0; i < n; i++) g.add(at(p.extrudeX(profile, sw, i % 2 ? CANVAS : col), -width / 2 + sw * (i + 0.5), 0, 0));
  } else {
    g.add(p.extrudeX(profile, width, col));
    g.add(p.detail(at(p.box(width + 0.004, 0.025, 0.02, CANVAS), 0, lipY - 0.01, depth + 0.004)));
  }
  for (const s of [-1, 1]) g.add(at(p.extrudeX(cheek, 0.025, col), s * (width / 2 - 0.0125), 0, 0));
  return g;
}

/** Fascia sign facing +z, centred, with lettering as simple shapes (no text). */
export function signBoard(p: Dk, width: number, height: number, sign: number, ink: number, style?: 'bar' | 'dots' | 'logo'): THREE.Group {
  const g = new THREE.Group();
  g.add(at(p.box(width, height, 0.06, ['dtSign', sign]), 0, 0, 0.03));
  const s = style ?? p.pick(['bar', 'dots', 'logo'] as const);
  const inkRef: RoleRef = ['dtInk', ink];
  const lh = Math.min(0.09, height * 0.36);
  if (s === 'bar') {
    g.add(p.detail(at(p.box(Math.min(width * 0.6, 1.5), lh, 0.02, inkRef), 0, 0, 0.065)));
  } else if (s === 'dots') {
    const n = Math.max(3, Math.min(6, Math.floor(width / 0.28)));
    for (let i = 0; i < n; i++) g.add(p.detail(at(p.box(lh, lh * 1.15, 0.02, inkRef), (i - (n - 1) / 2) * lh * 1.9, 0, 0.065)));
  } else {
    g.add(p.detail(at(p.disc(height * 0.3, 0.025, inkRef, 10), -width * 0.3, 0, 0.055)));
    g.add(p.detail(at(p.box(width * 0.36, lh, 0.02, inkRef), width * 0.08, 0, 0.065)));
  }
  return g;
}

/** Blade sign projecting from the wall along +z (sign plane faces ±x); hangs below y = 0. */
export function bladeSign(p: Dk, sign: number, ink: number, shape: 'disc' | 'board' = 'disc'): THREE.Group {
  const g = new THREE.Group();
  g.add(at(p.box(0.035, 0.035, 0.46, IRON), 0, 0, 0.23));
  const inkRef: RoleRef = ['dtInk', ink];
  if (shape === 'disc') {
    const d = p.cyl(0.2, 0.2, 0.06, ['dtSign', sign], 14);
    d.rotation.z = Math.PI / 2;
    g.add(at(d, 0, -0.24, 0.3));
    const i = p.cyl(0.1, 0.1, 0.075, inkRef, 10);
    i.rotation.z = Math.PI / 2;
    g.add(p.detail(at(i, 0, -0.24, 0.3)));
  } else {
    g.add(at(p.box(0.06, 0.4, 0.34, ['dtSign', sign]), 0, -0.24, 0.3));
    g.add(p.detail(at(p.box(0.075, 0.22, 0.2, inkRef), 0, -0.24, 0.3)));
  }
  return g;
}

export interface StorefrontOpts {
  scheme: Scheme;
  /** Door position along the front, or none (side entrance). */
  door?: 'left' | 'right' | 'center' | 'none';
  awning?: 'shed' | 'round' | 'none';
  sign?: boolean;
  /** Recessed upstairs-door width at one end (mixed-use buildings). */
  sideDoor?: 'left' | 'right' | null;
}

/** Ground-floor storefront facing +z, bottom at y = 0, height H, across `width`. */
export function storefront(p: Dk, width: number, H: number, o: StorefrontOpts): THREE.Group {
  const g = new THREE.Group();
  const s = o.scheme;
  const frame: RoleRef = ['dtFront', s.front];
  const pier = 0.1, signH = o.sign === false ? 0 : 0.26, headerH = signH > 0 ? signH : 0.12;
  // Piers + header (sign band or plain beam).
  for (const sx of [-1, 1]) g.add(at(p.box(pier, H - headerH, 0.07, frame), sx * (width / 2 - pier / 2), (H - headerH) / 2, 0.035));
  if (signH > 0) g.add(at(signBoard(p, width - 0.02, signH, s.sign, s.ink), 0, H - signH / 2, 0));
  else g.add(at(p.box(width, headerH, 0.07, frame), 0, H - headerH / 2, 0.035));
  // Bays between the piers: [side door] [display] [door] [display].
  const inner = width - pier * 2;
  let x0 = -inner / 2, x1 = inner / 2;
  const doorW = 0.52;
  if (o.sideDoor) {
    const dx = o.sideDoor === 'left' ? x0 + 0.33 : x1 - 0.33;
    g.add(at(doorUnit(p, { w: 0.46, h: 0.98, leaf: ['dtDoor', s.door], surround: null, glass: false, transom: true, main: false }), dx, 0, 0));
    g.add(at(p.box(0.08, H - headerH, 0.07, frame), o.sideDoor === 'left' ? x0 + 0.62 : x1 - 0.62, (H - headerH) / 2, 0.035));
    if (o.sideDoor === 'left') x0 += 0.66; else x1 -= 0.66;
  }
  const door = o.door ?? 'center';
  const glassTop = H - headerH - 0.06, bulk = 0.26;
  const display = (a: number, b: number) => {
    const w = b - a;
    if (w < 0.2) return;
    const cx = (a + b) / 2, gh = glassTop - bulk;
    g.add(at(p.box(w, bulk, 0.07, frame), cx, bulk / 2, 0.035));
    g.add(at(p.box(w, gh, 0.04, ['window', p.chance(0.85) ? 1 : 0]), cx, bulk + gh / 2, 0.02));
    // Transom bar and mullions.
    g.add(p.detail(at(p.box(w, 0.035, 0.05, frame), cx, bulk + gh * 0.76, 0.045)));
    const panes = Math.max(1, Math.round(w / 0.7));
    for (let i = 1; i < panes; i++) g.add(p.detail(at(p.box(0.035, gh, 0.05, frame), a + (w * i) / panes, bulk + gh / 2, 0.045)));
  };
  if (door === 'none') display(x0, x1);
  else {
    const dx = door === 'left' ? x0 + doorW / 2 + 0.04 : door === 'right' ? x1 - doorW / 2 - 0.04 : (x0 + x1) / 2;
    g.add(at(doorUnit(p, { w: doorW, h: Math.min(1.0, glassTop - 0.02), leaf: ['dtDoor', s.door], surround: frame, transom: false }), dx, 0, 0));
    display(x0, dx - doorW / 2 - 0.07);
    display(dx + doorW / 2 + 0.07, x1);
  }
  const aw = o.awning ?? (s.striped ? 'shed' : p.pick(['shed', 'round'] as const));
  if (aw !== 'none') g.add(at(awning(p, width - 0.06, aw === 'round' ? 0.4 : 0.5, { style: aw, idx: s.awning, striped: s.striped }), 0, H - headerH - 0.02, 0.02));
  return g;
}

/** Projecting cornice facing +z, top at y = 0, spanning `width`. */
export function cornice(p: Dk, width: number, r: RoleRef = STONE, dentils = true, depth = 0.16): THREE.Group {
  const g = new THREE.Group();
  g.add(at(p.box(width + 0.12, 0.13, depth + 0.02, r), 0, -0.065, depth / 2 - 0.01));
  g.add(p.detail(at(p.box(width + 0.04, 0.05, depth * 0.55, r), 0, -0.155, depth * 0.27)));
  if (dentils) {
    const n = Math.max(3, Math.floor(width / 0.3));
    for (let i = 0; i < n; i++) g.add(p.detail(at(p.box(0.07, 0.08, 0.06, r), -width / 2 + (width * (i + 0.5)) / n, -0.22, 0.03)));
  }
  return g;
}

export type ParapetStyle = 'flat' | 'stepped' | 'peak' | 'arch';

/** Parapet crest above a front cornice (facing +z, base at y = 0): stepped block, pediment or arch. */
export function parapetCrest(p: Dk, width: number, style: ParapetStyle, wall: RoleRef, coping: RoleRef = STONE): THREE.Group {
  const g = new THREE.Group();
  if (style === 'stepped') {
    const w = width * 0.42;
    g.add(at(p.box(w, 0.26, 0.2, wall), 0, 0.13, -0.08));
    g.add(at(p.box(w + 0.08, 0.06, 0.26, coping), 0, 0.29, -0.08));
    g.add(p.detail(at(p.box(w * 0.5, 0.1, 0.03, coping), 0, 0.13, 0.03)));
  } else if (style === 'peak') {
    const w = width * 0.5;
    g.add(at(p.gable(w + 0.12, 0.34, 0.16, coping), 0, 0, -0.16));
    g.add(at(p.gable(w, 0.27, 0.18, wall), 0, 0, -0.15));
    g.add(p.detail(at(p.disc(0.06, 0.02, coping, 10), 0, 0.1, 0.03)));
  } else if (style === 'arch') {
    const r = Math.min(width * 0.2, 0.34);
    g.add(at(p.halfDisc(r + 0.06, 0.16, coping, 10), 0, 0, -0.16));
    g.add(at(p.halfDisc(r, 0.18, wall, 10), 0, 0, -0.15));
  }
  return g;
}

/** Flat roof over a w × d body whose top is at y: stone coping cap + inset membrane. Returns the membrane top. */
export function flatRoof(g: THREE.Group, p: Dk, w: number, d: number, y: number, cx = 0, cz = 0, roofIdx = 0, coping: RoleRef = STONE): number {
  g.add(at(p.soft(w + 0.08, 0.1, d + 0.08, 0.05, coping), cx, y + 0.05, cz));
  g.add(at(p.box(w - 0.24, 0.02, d - 0.24, ['dtRoof', roofIdx]), cx, y + 0.11, cz));
  return y + 0.12;
}

// ------------------------------------------------------------------------------------------------ rooftop + props

export function acUnit(p: Dk): THREE.Group {
  const g = new THREE.Group();
  g.add(at(p.box(0.52, 0.28, 0.4, METAL), 0, 0.14, 0));
  g.add(at(p.cyl(0.12, 0.12, 0.03, DARK, 10), 0.08, 0.29, 0));
  return p.detail(g);
}

export function vent(p: Dk): THREE.Group {
  const g = new THREE.Group();
  g.add(at(p.cyl(0.05, 0.05, 0.3, METAL, 8), 0, 0.15, 0));
  g.add(at(p.cyl(0.085, 0.085, 0.05, METAL, 8), 0, 0.32, 0));
  return p.detail(g);
}

export function skylight(p: Dk, w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  g.add(at(p.box(w, 0.08, d, STONE), 0, 0.04, 0));
  g.add(at(p.hip(w - 0.08, d - 0.08, 0.14, Math.min(w, d) * 0.3, ['window', 1]), 0, 0.08, 0));
  return p.detail(g);
}

export function chimney(p: Dk, wall: RoleRef, h = 0.55): THREE.Group {
  const g = new THREE.Group();
  g.add(at(p.box(0.3, h, 0.3, wall), 0, h / 2, 0));
  g.add(p.detail(at(p.box(0.38, 0.06, 0.38, STONE), 0, h + 0.03, 0)));
  return g;
}

/** Classic wooden rooftop water tank on legs (~1.05 tall). */
export function waterTank(p: Dk): THREE.Group {
  const g = new THREE.Group();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(at(p.box(0.05, 0.3, 0.05, IRON), sx * 0.24, 0.15, sz * 0.24));
  g.add(at(p.box(0.66, 0.05, 0.66, ['dtWood', 1]), 0, 0.325, 0));
  g.add(at(p.cyl(0.33, 0.35, 0.48, ['dtWood', 0], 12), 0, 0.59, 0));
  for (const y of [0.45, 0.73]) g.add(p.detail(at(p.cyl(0.357, 0.357, 0.025, IRON, 12), 0, y, 0)));
  g.add(at(p.cone(0.38, 0.22, ['dtWood', 1], 12), 0, 0.94, 0));
  return g;
}

export function stairHut(p: Dk, wall: RoleRef): THREE.Group {
  const g = new THREE.Group();
  g.add(at(p.box(0.78, 0.58, 0.66, wall), 0, 0.29, 0));
  g.add(at(p.box(0.86, 0.06, 0.74, STONE), 0, 0.61, 0));
  g.add(p.detail(at(p.box(0.32, 0.46, 0.02, DARK), 0.12, 0.23, 0.335)));
  return g;
}

/** Tiny parked car, nose toward +z, sitting on y = 0 (~0.62 × 1.25 × 0.5). */
export function tinyCar(p: Dk, idx: number): THREE.Group {
  const g = new THREE.Group();
  g.add(at(p.box(0.56, 0.1, 1.05, DARK), 0, 0.06, 0));
  g.add(at(p.box(0.62, 0.22, 1.25, ['car', idx]), 0, 0.22, 0));
  g.add(at(p.box(0.54, 0.16, 0.64, ['window', 0]), 0, 0.41, -0.06));
  g.add(at(p.box(0.5, 0.05, 0.56, ['car', idx]), 0, 0.5, -0.06));
  return g;
}

/** Window flower box facing +z (top at y = 0): planter + greenery + a few blooms. */
export function flowerBox(p: Dk, w: number, flowers: number): THREE.Group {
  const g = new THREE.Group();
  g.add(at(p.box(w, 0.1, 0.12, ['dtWood', 1]), 0, -0.05, 0.07));
  g.add(at(p.box(w - 0.04, 0.07, 0.1, ['leaf', 0]), 0, 0.03, 0.07));
  const n = Math.max(2, Math.round(w / 0.16));
  for (let i = 0; i < n; i++) g.add(at(p.box(0.055, 0.055, 0.055, ['dtFlower', (flowers + i) % 5]), -w / 2 + (w * (i + 0.5)) / n, 0.08, 0.09 + (i % 2) * 0.02));
  return p.detail(g);
}

/** Potted shrub on the ground. */
export function pottedShrub(p: Dk, r = 0.17): THREE.Group {
  const g = new THREE.Group();
  g.add(at(p.cyl(r * 0.85, r * 0.7, r * 1.3, ['dtWood', 1], 8), 0, r * 0.65, 0));
  g.add(at(p.sphere(r, ['leaf', 2], 7), 0, r * 1.45, 0));
  return p.detail(g);
}

/** Round café table with two chairs (~0.9 wide). */
export function cafeTable(p: Dk, chair: RoleRef, rot = 0): THREE.Group {
  const g = new THREE.Group();
  g.add(at(p.cyl(0.03, 0.06, 0.36, IRON, 6), 0, 0.18, 0));
  g.add(at(p.cyl(0.2, 0.2, 0.035, TRIM, 12), 0, 0.37, 0));
  for (const s of [-1, 1]) {
    const c = new THREE.Group();
    c.add(at(p.box(0.17, 0.035, 0.17, chair), 0, 0.22, 0));
    c.add(at(p.box(0.17, 0.2, 0.035, chair), 0, 0.33, -0.07));
    for (const lx of [-0.065, 0.065]) c.add(at(p.box(0.025, 0.21, 0.025, IRON), lx, 0.105, 0));
    c.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
    g.add(at(c, s * 0.32, 0, 0));
  }
  g.rotation.y = rot;
  return g;
}
