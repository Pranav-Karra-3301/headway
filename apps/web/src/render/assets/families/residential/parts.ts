// Owner: A3. Shared building parts for the residential family, built only from KitContext materials.
// Big volumes use the kit's rounded box (shared clay look); mid parts use a 1-segment rounded box; flat details
// (glass, frames, sills, rails, lines) are plain boxes. Every geometry is indexed with position/normal/uv so the
// composer can merge them per material. Local frame: ground y = 0, FRONT faces +z.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { KitContext } from '../../types';

export type K = KitContext;

const cache = new Map<string, THREE.BufferGeometry>();
const r3 = (n: number) => Math.round(n * 1000) / 1000;
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = cache.get(key);
  if (!g) { g = make(); cache.set(key, g); }
  return g;
}
function mesh(g: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

export function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, z);
  return o;
}
export function rotY<T extends THREE.Object3D>(o: T, a: number): T { o.rotation.y = a; return o; }
export function named<T extends THREE.Object3D>(o: T, name: string): T { o.name = name; return o; }

/** Big rounded volume (walls, main roofs): the kit's own rounded box. */
export const big = (k: K, w: number, h: number, d: number, r: number, role: string, idx = 0): THREE.Mesh =>
  k.rbox(w, h, d, r, k.mat(role, idx));

/** Mid-size rounded part (roof slabs, canopies, steps): 1-segment rounded box, 108 triangles. */
export function soft(k: K, w: number, h: number, d: number, r: number, role: string, idx = 0): THREE.Mesh {
  const rr = Math.max(0.005, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
  return mesh(cached(`s${r3(w)},${r3(h)},${r3(d)},${r3(rr)}`, () => new RoundedBoxGeometry(w, h, d, 1, rr)), k.mat(role, idx));
}

/** Plain box for flat details (12 triangles). */
export const box = (k: K, w: number, h: number, d: number, role: string, idx = 0): THREE.Mesh =>
  mesh(cached(`b${r3(w)},${r3(h)},${r3(d)}`, () => new THREE.BoxGeometry(w, h, d)), k.mat(role, idx));

export const cyl = (k: K, rt: number, rb: number, h: number, role: string, idx = 0, seg = 8): THREE.Mesh =>
  k.cyl(rt, rb, h, k.mat(role, idx), seg);

export const ball = (k: K, r: number, role: string, idx = 0, seg = 8): THREE.Mesh => k.sphere(r, k.mat(role, idx), seg);

/**
 * Triangular prism (gable infill): triangle of base `span` and height `rise` across `axis`, extruded `length`
 * along it ('x' = ridge along x). Base at y = 0, centred. Flat-shaded, indexed, 8 triangles.
 */
export function prism(k: K, span: number, rise: number, length: number, axis: 'x' | 'z', role: string, idx = 0): THREE.Mesh {
  const g = cached(`p${r3(span)},${r3(rise)},${r3(length)},${axis}`, () => {
    const s = span / 2, l = length / 2;
    // Built with the ridge along x: cross-section in (z, y).
    const P: number[][] = [];
    const quad = (a: number[], b: number[], c: number[], d: number[]) => P.push(a, b, c, a, c, d);
    const tri = (a: number[], b: number[], c: number[]) => P.push(a, b, c);
    tri([l, 0, s], [l, 0, -s], [l, rise, 0]);
    tri([-l, 0, -s], [-l, 0, s], [-l, rise, 0]);
    quad([-l, 0, s], [l, 0, s], [l, rise, 0], [-l, rise, 0]);
    quad([l, 0, -s], [-l, 0, -s], [-l, rise, 0], [l, rise, 0]);
    quad([-l, 0, -s], [l, 0, -s], [l, 0, s], [-l, 0, s]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P.flat(), 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((P.length * 2)).fill(0), 2));
    geo.setIndex(P.map((_, i) => i));
    geo.computeVertexNormals();
    if (axis === 'z') geo.rotateY(Math.PI / 2);
    return geo;
  });
  return mesh(g, k.mat(role, idx));
}

export interface GableOpts {
  /** Body width along x and depth along z under the roof; centre (x, z); wall top y. */
  w: number; d: number; y: number; x?: number; z?: number;
  rise: number;
  /** 'x': ridge along x (slopes face ±z); 'z': ridge along z (gable end faces the street). */
  ridge: 'x' | 'z';
  roofRole?: string; roofIdx?: number;
  endRole: string; endIdx?: number;
  over?: number; thick?: number;
  /** Use the kit rounded box for the slabs (nicer, 300 tris each with the basic kit) instead of the soft box. */
  bigSlabs?: boolean;
  capRole?: string; capIdx?: number;
}

/** Gable roof: wall-coloured gable infill + two rounded slabs with overhang + ridge cap. */
export function gable(k: K, g: THREE.Group, o: GableOpts): void {
  const x = o.x ?? 0, z = o.z ?? 0, over = o.over ?? 0.15, t = o.thick ?? 0.1;
  const roofRole = o.roofRole ?? 'roof', roofIdx = o.roofIdx ?? 0;
  const span = o.ridge === 'x' ? o.d : o.w, len = o.ridge === 'x' ? o.w : o.d;
  g.add(at(prism(k, span - 0.02, o.rise - 0.02, len - 0.04, o.ridge, o.endRole, o.endIdx ?? 0), x, o.y, z));
  const half = span / 2, slant = Math.hypot(half, o.rise), ang = Math.atan2(o.rise, half);
  const sn = Math.sin(ang), cs = Math.cos(ang);
  const along = half / 2 + (t / 2) * sn + (over / 2) * cs, up = o.y + o.rise / 2 + (t / 2) * cs - (over / 2) * sn;
  for (const s of [-1, 1]) {
    const L = slant + over, W = len + over * 2;
    if (o.ridge === 'x') {
      const slab = o.bigSlabs ? big(k, W, t, L, 0.04, roofRole, roofIdx) : soft(k, W, t, L, 0.04, roofRole, roofIdx);
      slab.rotation.x = s * ang;
      g.add(at(slab, x, up, z + s * along));
    } else {
      const slab = o.bigSlabs ? big(k, L, t, W, 0.04, roofRole, roofIdx) : soft(k, L, t, W, 0.04, roofRole, roofIdx);
      slab.rotation.z = -s * ang;
      g.add(at(slab, x + s * along, up, z));
    }
  }
  const capLen = len + over * 2 + 0.02, capY = o.y + o.rise + t * 0.55;
  const cap = o.ridge === 'x' ? box(k, capLen, 0.08, 0.14, o.capRole ?? roofRole, o.capIdx ?? roofIdx)
    : box(k, 0.14, 0.08, capLen, o.capRole ?? roofRole, o.capIdx ?? roofIdx);
  g.add(k.detail(at(cap, x, capY, z)));
}

/** Highest point of a gable roof built by `gable` (for height planning). */
export const gableTop = (y: number, rise: number, thick = 0.1) => y + rise + thick * 0.55 + 0.04;

export type Face = 'front' | 'back' | 'left' | 'right';

/** Put an object built facing +z onto a face of a w × d box centred at (cx, cz); u runs left→right seen from outside. */
export function onFace<T extends THREE.Object3D>(o: T, face: Face, w: number, d: number, u: number, y: number, cx = 0, cz = 0): T {
  switch (face) {
    case 'front': o.position.set(cx + u, y, cz + d / 2); o.rotation.y = 0; break;
    case 'back': o.position.set(cx - u, y, cz - d / 2); o.rotation.y = Math.PI; break;
    case 'right': o.position.set(cx + w / 2, y, cz - u); o.rotation.y = Math.PI / 2; break;
    case 'left': o.position.set(cx - w / 2, y, cz + u); o.rotation.y = -Math.PI / 2; break;
  }
  return o;
}

export interface WinOpts {
  /** White frame around the glass (default true). */
  frame?: boolean;
  sill?: boolean;
  /** Vertical mullion (default for wide windows). */
  mullion?: boolean;
  /** Shutters either side in this accent index. */
  shutters?: number;
  /** Flower box under the window (flower colour index). */
  flowers?: number;
}

/** Window facing +z, centred at its middle, back flush with z = 0. Whole unit is a detail. */
export function windowUnit(k: K, ww: number, wh: number, lit: boolean, o: WinOpts = {}): THREE.Group {
  const g = new THREE.Group();
  if (o.frame ?? true) g.add(at(box(k, ww + 0.1, wh + 0.1, 0.04, 'resFrame'), 0, 0, 0.02));
  g.add(at(box(k, ww, wh, 0.04, 'window', lit ? 1 : 0), 0, 0, 0.03));
  if (o.mullion ?? ww > 0.7) g.add(at(box(k, 0.04, wh, 0.03, 'resFrame'), 0, 0, 0.06));
  if (o.shutters !== undefined) for (const s of [-1, 1]) g.add(at(box(k, ww * 0.42, wh + 0.06, 0.035, 'resAccent', o.shutters), s * (ww / 2 + ww * 0.21 + 0.07), 0, 0.02));
  if (o.flowers !== undefined) {
    g.add(at(box(k, ww + 0.1, 0.12, 0.16, 'resWood', 0), 0, -wh / 2 - 0.1, 0.08));
    g.add(at(box(k, ww - 0.02, 0.07, 0.11, 'resFlower', o.flowers), 0, -wh / 2 - 0.02, 0.08));
  } else if (o.sill ?? true) {
    g.add(at(box(k, ww + 0.18, 0.05, 0.1, 'resTrim'), 0, -wh / 2 - 0.07, 0.05));
  }
  return k.detail(g);
}

export interface DoorOpts { w?: number; h?: number; role?: string; idx?: number; canopy?: { role: string; idx?: number } | null; step?: boolean; lamp?: boolean }

/** Door facing +z, bottom at y = 0, back flush with z = 0. The leaf is named 'door'. */
export function doorUnit(k: K, o: DoorOpts = {}): THREE.Group {
  const w = o.w ?? 0.55, h = o.h ?? 0.98;
  const g = new THREE.Group();
  g.add(named(at(box(k, w, h, 0.05, o.role ?? 'door', o.idx ?? 0), 0, h / 2, 0.025), 'door'));
  g.add(k.detail(at(box(k, w + 0.12, h + 0.06, 0.035, 'resFrame'), 0, (h + 0.06) / 2, 0.0175)));
  g.add(k.detail(at(box(k, 0.05, 0.05, 0.03, 'resBrass'), w * 0.3, h * 0.5, 0.065)));
  if (o.canopy) g.add(k.detail(at(box(k, w + 0.4, 0.07, 0.4, o.canopy.role, o.canopy.idx ?? 0), 0, h + 0.17, 0.2)));
  if (o.lamp) g.add(k.detail(at(box(k, 0.08, 0.12, 0.08, 'lamp'), w / 2 + 0.16, h * 0.82, 0.06)));
  if (o.step ?? true) g.add(at(box(k, w + 0.26, 0.07, 0.26, 'resStep'), 0, 0.035, 0.13));
  return g;
}

/** Small round bush (detail), slightly squashed, resting on y0 at (x, z). */
export function bush(k: K, r: number, idx: number, x: number, z: number, y0 = 0): THREE.Mesh {
  const b = k.detail(ball(k, r, 'leaf', idx, 7));
  b.scale.y = 0.86;
  return at(b, x, y0 + r * 0.86, z);
}

/** xorshift-free pick helper: integer in [0, n) from a 0..1 random. */
export const pick = (r: number, n: number): number => Math.min(n - 1, Math.floor(r * n));
