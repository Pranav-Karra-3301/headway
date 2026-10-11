// Owner: G1. Geometry accumulator for the highway layer: per-colour buckets merged into ONE KitMaterial geometry
// (position, normal, color, aGlow, aTint) that recolours in place on palette change. Colour keys are highway roles
// (./colors) or Kenney part colours `kn:<role>#<idx>@<shade>` (K0's role tables). Plus swept-ribbon helpers with a
// per-point height (the overpass profile).
import * as THREE from 'three';
import type { Vec2 } from '@headway/sim';
import { kenneyColor } from '../../assets/kenney/colors';
import { shadeHex } from '../../assets/kenney/colors';
import { PALETTES } from '../../palettes';
import type { PaletteId } from '../../types';
import { offsetRight } from '../roads/lanes';
import { HW_GLOW, highwayColors, type HwRole } from './colors';

export type ColorKey = HwRole | `kn:${string}`;

/** Colour key of a Kenney part (role, variant, OKLab shade). */
export function knKey(role: string, idx: number, shade: number): ColorKey {
  return `kn:${role}#${idx}@${shade.toFixed(3)}`;
}

function keyHex(key: ColorKey, p: PaletteId): string {
  if (key.startsWith('kn:')) {
    const m = /^kn:(.+)#(\d+)@(-?[\d.]+)$/.exec(key);
    if (!m) return '#9aa0a6';
    return shadeHex(kenneyColor(m[1]!, Number(m[2]), p), Number(m[3]));
  }
  return highwayColors(p)[key as HwRole] ?? '#ff00ff';
}

interface Bucket { pos: number[]; nor: number[]; idx: number[] }
interface Range { key: ColorKey; start: number; count: number }

const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpN = new THREE.Vector3();
const col = new THREE.Color();

export class Acc {
  readonly b = new Map<ColorKey, Bucket>();
  private bucket(key: ColorKey): Bucket {
    let k = this.b.get(key);
    if (!k) { k = { pos: [], nor: [], idx: [] }; this.b.set(key, k); }
    return k;
  }
  get empty(): boolean { return this.b.size === 0; }

  /** Quad a-b-c-d, counter-clockwise seen from its front face (flat normal). */
  quad(key: ColorKey, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): void {
    tmpN.subVectors(b, a).cross(tmpA.subVectors(d, a));
    if (tmpN.lengthSq() < 1e-14) tmpN.subVectors(c, b).cross(tmpA.subVectors(d, b));
    if (tmpN.lengthSq() < 1e-14) return;
    tmpN.normalize();
    const k = this.bucket(key);
    const i = k.pos.length / 3;
    for (const v of [a, b, c, d]) { k.pos.push(v.x, v.y, v.z); k.nor.push(tmpN.x, tmpN.y, tmpN.z); }
    k.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }

  tri(key: ColorKey, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void {
    tmpN.subVectors(b, a).cross(tmpB.subVectors(c, a));
    if (tmpN.lengthSq() < 1e-14) return;
    tmpN.normalize();
    const k = this.bucket(key);
    const i = k.pos.length / 3;
    for (const v of [a, b, c]) { k.pos.push(v.x, v.y, v.z); k.nor.push(tmpN.x, tmpN.y, tmpN.z); }
    k.idx.push(i, i + 1, i + 2);
  }

  /**
   * Append a geometry under a transform. `keyOf` picks the colour per triangle (uv centroid + world normal y), or
   * a fixed key. Returns nothing; bottom-facing triangles are kept (callers may drop them in keyOf).
   */
  geometry(geo: THREE.BufferGeometry, m: THREE.Matrix4, keyOf: ColorKey | ((tri: { u: number; v: number; ny: number }) => ColorKey | null)): void {
    const P = geo.getAttribute('position'), N = geo.getAttribute('normal'), UV = geo.getAttribute('uv');
    const I = geo.getIndex();
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const flip = m.determinant() < 0;
    const count = I ? I.count : P.count;
    const remap = new Map<string, number>();
    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    const fixed = typeof keyOf === 'string' ? keyOf : null;
    for (let t = 0; t + 2 < count; t += 3) {
      const ia = I ? I.getX(t) : t, ib = I ? I.getX(t + 1) : t + 1, ic = I ? I.getX(t + 2) : t + 2;
      let key: ColorKey | null = fixed;
      if (!key) {
        va.fromBufferAttribute(P, ia).applyMatrix4(m);
        vb.fromBufferAttribute(P, ib).applyMatrix4(m);
        vc.fromBufferAttribute(P, ic).applyMatrix4(m);
        const fn = e1.subVectors(vb, va).cross(e2.subVectors(vc, va));
        const L = fn.length();
        if (L < 1e-12) continue;
        const ny = (flip ? -fn.y : fn.y) / L;
        const u = UV ? (UV.getX(ia) + UV.getX(ib) + UV.getX(ic)) / 3 : 0.3;
        const v = UV ? (UV.getY(ia) + UV.getY(ib) + UV.getY(ic)) / 3 : 0.9;
        key = (keyOf as (tri: { u: number; v: number; ny: number }) => ColorKey | null)({ u, v, ny });
        if (!key) continue;
      }
      const k = this.bucket(key);
      const order = flip ? [ia, ic, ib] : [ia, ib, ic];
      for (const vi of order) {
        const rk = `${key}|${vi}`;
        let ni = remap.get(rk);
        if (ni === undefined) {
          va.fromBufferAttribute(P, vi).applyMatrix4(m);
          if (N) vb.fromBufferAttribute(N, vi).applyMatrix3(nm).normalize(); else vb.set(0, 1, 0);
          ni = k.pos.length / 3;
          k.pos.push(va.x, va.y, va.z);
          k.nor.push(vb.x, vb.y, vb.z);
          remap.set(rk, ni);
        }
        k.idx.push(ni);
      }
    }
  }

  /** Axis box (optionally rotated about y around its centre). */
  box(key: ColorKey, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rotY = 0): void {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(cx, cy, cz), new THREE.Quaternion().setFromAxisAngle(UP, rotY), new THREE.Vector3(sx, sy, sz));
    this.geometry(UNIT_BOX, m, key);
  }

  build(palette: PaletteId): THREE.BufferGeometry {
    let nv = 0, ni = 0;
    for (const k of this.b.values()) { nv += k.pos.length / 3; ni += k.idx.length; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3);
    const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    const ranges: Range[] = [];
    let vo = 0, io = 0;
    for (const [key, k] of [...this.b.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (!k.idx.length) continue;
      pos.set(k.pos, vo * 3);
      nor.set(k.nor, vo * 3);
      for (let i = 0; i < k.idx.length; i++) index[io + i] = k.idx[i]! + vo;
      const n = k.pos.length / 3;
      ranges.push({ key, start: vo, count: n });
      vo += n; io += k.idx.length;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    geo.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    geo.setAttribute('aTint', new THREE.BufferAttribute(new Float32Array(nv), 1));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    geo.userData.hwRanges = ranges;
    recolorHighway(geo, palette);
    return geo;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

/** Rewrite colour + dusk glow of a geometry built by Acc for a palette (in place). */
export function recolorHighway(geo: THREE.BufferGeometry, p: PaletteId): void {
  const ranges = geo.userData.hwRanges as Range[] | undefined;
  if (!ranges) return;
  const ca = (geo.getAttribute('color') as THREE.BufferAttribute).array as Float32Array;
  const ga = (geo.getAttribute('aGlow') as THREE.BufferAttribute).array as Float32Array;
  for (const r of ranges) {
    col.set(keyHex(r.key, p));
    for (let i = r.start; i < r.start + r.count; i++) { ca[i * 3] = col.r; ca[i * 3 + 1] = col.g; ca[i * 3 + 2] = col.b; }
    const g = HW_GLOW[r.key as HwRole];
    if (g) col.set(PALETTES[p].lamp).multiplyScalar(g); else col.setRGB(0, 0, 0);
    for (let i = r.start; i < r.start + r.count; i++) { ga[i * 3] = col.r; ga[i * 3 + 1] = col.g; ga[i * 3 + 2] = col.b; }
  }
  geo.getAttribute('color').needsUpdate = true;
  geo.getAttribute('aGlow').needsUpdate = true;
}

// ---------------------------------------------------------------- swept ribbons (polyline + per-point height)
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** A path with per-point heights. */
export interface Path3 { pts: Vec2[]; ys: number[] }

export function path3(pts: Vec2[], y: number | ((p: Vec2) => number) = 0): Path3 {
  return { pts, ys: pts.map((p) => (typeof y === 'number' ? y : y(p))) };
}

/** Sub-path between arc distances s0..s1 (interpolated ends). */
export function subPath(p: Path3, s0: number, s1: number): Path3 {
  const out: Vec2[] = [], ys: number[] = [];
  let acc = 0;
  const lerp = (i: number, t: number) => {
    const a = p.pts[i]!, b = p.pts[i + 1]!;
    out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    ys.push(p.ys[i]! + (p.ys[i + 1]! - p.ys[i]!) * t);
  };
  for (let i = 0; i + 1 < p.pts.length; i++) {
    const a = p.pts[i]!, b = p.pts[i + 1]!;
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    const e = acc + L;
    if (e > s0 && acc < s1 && L > 1e-9) {
      if (!out.length) lerp(i, Math.max(0, (s0 - acc) / L));
      if (e < s1) { out.push({ x: b.x, z: b.z }); ys.push(p.ys[i + 1]!); }
      else { lerp(i, (s1 - acc) / L); break; }
    }
    acc = e;
  }
  return { pts: out, ys };
}

export function pathLength(p: Path3): number {
  let L = 0;
  for (let i = 0; i + 1 < p.pts.length; i++) L += Math.hypot(p.pts[i + 1]!.x - p.pts[i]!.x, p.pts[i + 1]!.z - p.pts[i]!.z);
  return L;
}

/** Lateral offsets (+ = right of travel) per point: constant or per-point arrays. */
export type Lat = number | readonly number[];
/** Points offset to the right by a per-point lateral (mitred like offsetRight). */
export function offsetVar(pts: readonly Vec2[], lat: Lat): Vec2[] {
  if (typeof lat === 'number') return offsetRight(pts, lat);
  const u = offsetRight(pts, 1);
  return pts.map((p, i) => ({ x: p.x + (u[i]!.x - p.x) * lat[i]!, z: p.z + (u[i]!.z - p.z) * lat[i]! }));
}
/** Negate / shift a lateral. */
export function latMap(l: Lat, f: (v: number) => number): Lat {
  return typeof l === 'number' ? f(l) : l.map(f);
}

/** Up-facing strip between lateral offsets l0 < l1 (+ = right of travel) at the path height + dy. */
export function ribbon(acc: Acc, key: ColorKey, p: Path3, l0: Lat, l1: Lat, dy = 0): void {
  if (p.pts.length < 2) return;
  const A = offsetVar(p.pts, l0), B = offsetVar(p.pts, l1);
  for (let i = 0; i + 1 < p.pts.length; i++) {
    const y0 = p.ys[i]! + dy, y1 = p.ys[i + 1]! + dy;
    acc.quad(key, V(A[i]!.x, y0, A[i]!.z), V(B[i]!.x, y0, B[i]!.z), V(B[i + 1]!.x, y1, B[i + 1]!.z), V(A[i + 1]!.x, y1, A[i + 1]!.z));
  }
}

/** Down-facing strip (deck soffit). */
export function soffit(acc: Acc, key: ColorKey, p: Path3, l0: number, l1: number, dy = 0): void {
  if (p.pts.length < 2) return;
  const A = offsetRight(p.pts, l0), B = offsetRight(p.pts, l1);
  for (let i = 0; i + 1 < p.pts.length; i++) {
    const y0 = p.ys[i]! + dy, y1 = p.ys[i + 1]! + dy;
    acc.quad(key, V(A[i]!.x, y0, A[i]!.z), V(A[i + 1]!.x, y1, A[i + 1]!.z), V(B[i + 1]!.x, y1, B[i + 1]!.z), V(B[i]!.x, y0, B[i]!.z));
  }
}

/** Vertical wall along the path at lateral offset `lat`, from y = bot(i) to y = top(i), facing right (+) or left. */
export function wall(acc: Acc, key: ColorKey, p: Path3, lat: Lat, bot: (i: number, y: number) => number, top: (i: number, y: number) => number, facingRight: boolean): void {
  if (p.pts.length < 2) return;
  const A = offsetVar(p.pts, lat);
  for (let i = 0; i + 1 < p.pts.length; i++) {
    const a = A[i]!, b = A[i + 1]!;
    const a0 = bot(i, p.ys[i]!), a1 = top(i, p.ys[i]!), b0 = bot(i + 1, p.ys[i + 1]!), b1 = top(i + 1, p.ys[i + 1]!);
    if (a1 - a0 < 1e-4 && b1 - b0 < 1e-4) continue;
    if (facingRight) acc.quad(key, V(a.x, a0, a.z), V(b.x, b0, b.z), V(b.x, b1, b.z), V(a.x, a1, a.z));
    else acc.quad(key, V(b.x, b0, b.z), V(a.x, a0, a.z), V(a.x, a1, a.z), V(b.x, b1, b.z));
  }
}

/** A raised band (kerb, parapet, jersey barrier): top strip l0..l1 at h above the path, walls on both sides. */
export function band(acc: Acc, key: ColorKey, p: Path3, l0: Lat, l1: Lat, base: number, h: number, sideKey: ColorKey = key, ends = true): void {
  ribbon(acc, key, p, l0, l1, base + h);
  wall(acc, sideKey, p, l0, (_i, y) => y + base, (_i, y) => y + base + h, false);
  wall(acc, sideKey, p, l1, (_i, y) => y + base, (_i, y) => y + base + h, true);
  if (!ends || p.pts.length < 2) return;
  const A = offsetVar(p.pts, l0), B = offsetVar(p.pts, l1), n = p.pts.length;
  const y0 = p.ys[0]! + base, yn = p.ys[n - 1]! + base;
  acc.quad(sideKey, V(B[0]!.x, y0, B[0]!.z), V(A[0]!.x, y0, A[0]!.z), V(A[0]!.x, y0 + h, A[0]!.z), V(B[0]!.x, y0 + h, B[0]!.z));
  acc.quad(sideKey, V(A[n - 1]!.x, yn, A[n - 1]!.z), V(B[n - 1]!.x, yn, B[n - 1]!.z), V(B[n - 1]!.x, yn + h, B[n - 1]!.z), V(A[n - 1]!.x, yn + h, A[n - 1]!.z));
}

/** Dashed up-facing strip: dashes of length `on` every `on + off` along the path (phase from the start). */
export function dashes(acc: Acc, key: ColorKey, p: Path3, l0: number, l1: number, on: number, off: number, dy: number, phase = 0): void {
  const L = pathLength(p);
  for (let s = phase; s < L; s += on + off) {
    const e = Math.min(L, s + on);
    if (e - s < 0.05) continue;
    ribbon(acc, key, subPath(p, s, e), l0, l1, dy);
  }
}
