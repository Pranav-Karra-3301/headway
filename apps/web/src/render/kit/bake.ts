// Owner: T2.1. Bake a role-tagged kit group into ONE indexed geometry with per-vertex attributes:
//   color (vec3, linear)  — palette colour of the part's role
//   aGlow (vec3, linear)  — dusk emissive colour × intensity (0 for parts that never glow)
//   aTint (float 0|1)     — 1 where an InstancedMesh's instanceColor replaces the role colour
// Detail parts are written last, so `setDetail(geometry, false)` = drawRange(0, baseIndexCount).
// Palette switches recolour the attributes in place (`recolorBaked`), never rebuilding geometry.
import * as THREE from 'three';
import { colorOf, DEFAULT_PALETTE, glowOf, paletteOf, type Palette, type Role } from '../palettes';
import type { PaletteId } from '../types';
import { partOf } from './prims';

export interface BakeRange { role: Role; idx: number; start: number; count: number; detail: boolean; tint: boolean }
export interface Baked {
  geometry: THREE.BufferGeometry;
  /** Consecutive vertex ranges per (role, idx, detail, tint); counts sum to the vertex count. */
  ranges: BakeRange[];
  /** Index count of the non-detail parts (draw range for detail = 'min'). */
  baseIndexCount: number;
}

interface Item { geo: THREE.BufferGeometry; matrix: THREE.Matrix4; role: Role; idx: number; detail: boolean; tint: boolean }

const tmpM = new THREE.Matrix4();
const tmpN = new THREE.Matrix3();
const v = new THREE.Vector3();
const c = new THREE.Color();

function collect(o: THREE.Object3D, inv: THREE.Matrix4, det: boolean, tnt: boolean, out: Item[]): void {
  if (!o.visible) return;
  const detail = det || !!o.userData.detail;
  const tint = tnt || !!o.userData.tint;
  const p = partOf(o);
  if (p && (o as THREE.Mesh).isMesh) {
    const mesh = o as THREE.Mesh;
    const base = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
    const inst = (o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh) : null;
    if (inst) {
      for (let i = 0; i < inst.count; i++) {
        inst.getMatrixAt(i, tmpM);
        out.push({ geo: mesh.geometry, matrix: new THREE.Matrix4().multiplyMatrices(base, tmpM), role: p.role, idx: p.idx, detail, tint });
      }
    } else {
      out.push({ geo: mesh.geometry, matrix: base, role: p.role, idx: p.idx, detail, tint });
    }
  }
  for (const ch of o.children) collect(ch, inv, detail, tint, out);
}

/** Merge every visible role-tagged mesh under `root` (in root-local space) into one geometry. */
export function bakeGeometry(root: THREE.Object3D, palette: Palette | PaletteId = DEFAULT_PALETTE): Baked {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const all: Item[] = [];
  collect(root, inv, false, false, all);
  const items = [...all.filter((i) => !i.detail), ...all.filter((i) => i.detail)];

  let nv = 0, ni = 0;
  for (const it of items) {
    const n = it.geo.getAttribute('position').count;
    nv += n;
    ni += it.geo.index ? it.geo.index.count : n;
  }
  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  const tintA = new Float32Array(nv);
  const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  const ranges: BakeRange[] = [];
  let vo = 0, io = 0, baseIndexCount = 0;

  for (const it of items) {
    let g = it.geo;
    if (!g.getAttribute('normal')) { g = g.clone(); g.computeVertexNormals(); }
    const P = g.getAttribute('position'), N = g.getAttribute('normal');
    const n = P.count;
    tmpN.getNormalMatrix(it.matrix);
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(it.matrix);
      pos[(vo + i) * 3] = v.x; pos[(vo + i) * 3 + 1] = v.y; pos[(vo + i) * 3 + 2] = v.z;
      v.fromBufferAttribute(N, i).applyMatrix3(tmpN).normalize();
      nor[(vo + i) * 3] = v.x; nor[(vo + i) * 3 + 1] = v.y; nor[(vo + i) * 3 + 2] = v.z;
    }
    if (it.tint) tintA.fill(1, vo, vo + n);
    const flip = it.matrix.determinant() < 0;
    const src = g.index;
    const cnt = src ? src.count : n;
    for (let k = 0; k < cnt; k += 3) {
      const a = src ? src.getX(k) : k, b = src ? src.getX(k + 1) : k + 1, d = src ? src.getX(k + 2) : k + 2;
      index[io + k] = vo + a;
      index[io + k + 1] = vo + (flip ? d : b);
      index[io + k + 2] = vo + (flip ? b : d);
    }
    io += cnt;
    if (!it.detail) baseIndexCount += cnt;
    const last = ranges[ranges.length - 1];
    if (last && last.role === it.role && last.idx === it.idx && last.detail === it.detail && last.tint === it.tint) last.count += n;
    else ranges.push({ role: it.role, idx: it.idx, start: vo, count: n, detail: it.detail, tint: it.tint });
    vo += n;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
  geometry.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
  geometry.setAttribute('aTint', new THREE.BufferAttribute(tintA, 1));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const baked: Baked = { geometry, ranges, baseIndexCount };
  geometry.userData.kit = baked;
  recolorBaked(baked, palette);
  return baked;
}

/** Rewrite colour + glow attributes for a palette (in place). Accepts a Baked or a baked geometry. */
export function recolorBaked(b: Baked | THREE.BufferGeometry, palette: Palette | PaletteId): void {
  const baked = bakedOf(b);
  if (!baked) return;
  const P = paletteOf(palette);
  const col = baked.geometry.getAttribute('color') as THREE.BufferAttribute;
  const glow = baked.geometry.getAttribute('aGlow') as THREE.BufferAttribute;
  const ca = col.array as Float32Array, ga = glow.array as Float32Array;
  for (const r of baked.ranges) {
    c.set(colorOf(P, r.role, r.idx));
    for (let i = r.start; i < r.start + r.count; i++) { ca[i * 3] = c.r; ca[i * 3 + 1] = c.g; ca[i * 3 + 2] = c.b; }
    const gl = glowOf(P, r.role, r.idx);
    if (gl) c.set(gl.color).multiplyScalar(gl.intensity); else c.setRGB(0, 0, 0);
    for (let i = r.start; i < r.start + r.count; i++) { ga[i * 3] = c.r; ga[i * 3 + 1] = c.g; ga[i * 3 + 2] = c.b; }
  }
  col.needsUpdate = true;
  glow.needsUpdate = true;
}

/** detail = 'min' draws only the base parts; 'toy' draws everything. */
export function setBakedDetail(b: Baked | THREE.BufferGeometry, toy: boolean): void {
  const baked = bakedOf(b);
  if (baked) baked.geometry.setDrawRange(0, toy ? Infinity : baked.baseIndexCount);
}

export function bakedOf(b: Baked | THREE.BufferGeometry): Baked | null {
  if ((b as THREE.BufferGeometry).isBufferGeometry) return ((b as THREE.BufferGeometry).userData.kit as Baked | undefined) ?? null;
  return b as Baked;
}

/** Concatenate several baked geometries into one (e.g. static town chunks). Base indices of every input
 *  come first, then every input's detail indices, so `setBakedDetail` keeps working on the result. */
export function mergeBaked(list: Baked[]): Baked {
  const names = ['position', 'normal', 'color', 'aGlow', 'aTint'] as const;
  const width = (n: string) => (n === 'aTint' ? 1 : 3);
  let nv = 0, ni = 0;
  for (const b of list) { nv += b.geometry.getAttribute('position').count; ni += b.geometry.index!.count; }
  const out = names.map((n) => new Float32Array(nv * width(n)));
  const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  const ranges: BakeRange[] = [];
  const offsets: number[] = [];
  let vo = 0;
  list.forEach((b) => {
    names.forEach((n, k) => out[k]!.set(b.geometry.getAttribute(n).array as Float32Array, vo * width(n)));
    for (const r of b.ranges) ranges.push({ ...r, start: r.start + vo });
    offsets.push(vo);
    vo += b.geometry.getAttribute('position').count;
  });
  let io = 0;
  const copy = (b: Baked, off: number, from: number, to: number) => {
    const src = b.geometry.index!;
    for (let i = from; i < to; i++) index[io++] = src.getX(i) + off;
  };
  list.forEach((b, k) => copy(b, offsets[k]!, 0, b.baseIndexCount));
  const baseIndexCount = io;
  list.forEach((b, k) => copy(b, offsets[k]!, b.baseIndexCount, b.geometry.index!.count));
  const geometry = new THREE.BufferGeometry();
  names.forEach((n, k) => geometry.setAttribute(n, new THREE.BufferAttribute(out[k]!, width(n))));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const baked: Baked = { geometry, ranges, baseIndexCount };
  geometry.userData.kit = baked;
  return baked;
}
