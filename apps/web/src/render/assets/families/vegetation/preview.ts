// Owner: A5. Dev-only showcase (not part of the build): /src/render/assets/families/vegetation/preview.html
//   ?scene=trees | garden | park   ?p=0|1|2 (palette)   ?zoom=<view size>
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PALETTES } from '../../../palettes';
import { createBasicKit } from '../../basicKit';
import { devScene } from '../../devScene';
import { createRegistry } from '../../index';
import type { PlacedAsset } from '../../types';

const q = new URLSearchParams(location.search);
const scene = q.get('scene') ?? 'trees';
const p = (Number(q.get('p') ?? 0) || 0) as 0 | 1 | 2;
const P = [PALETTES.a, PALETTES.b, PALETTES.c][p]!;
const registry = createRegistry();
const kit = createBasicKit(registry.roles, p, Number(q.get('seed') ?? 7));
document.documentElement.style.background = P.bg;
document.getElementById('sub')!.textContent = `A5 · ${P.name} · ${scene}`;

/** Screen-aligned layout: u runs left→right on screen, v runs top→bottom (iso camera from +x+z). */
const S = Math.SQRT1_2;
const iso = (u: number, v: number) => ({ x: (u + v) * S, z: (v - u) * S });

const items: PlacedAsset[] = [];
const labels: Array<{ text: string; u: number; v: number }> = [];
const flats: Array<{ kind: 'lawn' | 'path'; u: number; v: number; w: number; d: number; rot?: number }> = [];
let view = 19;

if (scene === 'trees') {
  const rows = [['veg.oak', 'veg.maple'], ['veg.cherry', 'veg.birch'], ['veg.poplar', 'veg.pine']];
  rows.forEach((pair, r) => pair.forEach((kind, j) => {
    const v = (r - 1) * 6.2 - 0.6;
    labels.push({ text: kind, u: -12.2 + j * 13.8 + 5.5, v: v + 2.0 });
    for (let i = 0; i < 6; i++) items.push({ kind, ...iso(-12.2 + j * 13.8 + i * 2.2, v) });
  }));
  view = Number(q.get('zoom') ?? 16.5);
} else if (scene === 'garden') {
  labels.push({ text: 'veg.bush', u: -9.4, v: -7.2 });
  for (let i = 0; i < 9; i++) items.push({ kind: 'veg.bush', ...iso(i * 1.55 - 6.4, -7.3) });
  labels.push({ text: 'veg.hedge', u: -9.4, v: -4.0 });
  [2, 3, 4.5].forEach((len, i) => items.push({ kind: 'veg.hedge', ...iso([-5.4, -1.5, 3.6][i]!, -4.0), rot: Math.PI / 4 * 0, params: { length: len } }));
  [1.2, 1.2].forEach((len, i) => items.push({ kind: 'veg.hedge', ...iso(7.0 + i * 1.6, -4.0), params: { length: len } }));
  labels.push({ text: 'veg.flowerbed', u: -9.4, v: -0.6 });
  for (let i = 0; i < 5; i++) items.push({ kind: 'veg.flowerbed', ...iso(i * 3.2 - 5.0, -0.6) });
  labels.push({ text: 'veg.planter', u: -9.4, v: 2.8 });
  for (let i = 0; i < 9; i++) items.push({ kind: 'veg.planter', ...iso(i * 1.65 - 6.3, 2.8) });
  view = 15;
} else {
  // park vignette: lawn, a diagonal path with a poplar avenue, hedged borders, beds, planters, groves
  view = Number(q.get('zoom') ?? 24);
  flats.push({ kind: 'lawn', u: 0, v: 0, w: 26, d: 17 });
  flats.push({ kind: 'path', u: 0, v: 0.2, w: 26, d: 1.6 });
  flats.push({ kind: 'path', u: 2.4, v: 0, w: 1.4, d: 17 });
  const put = (kind: string, u: number, v: number, extra: Partial<PlacedAsset> = {}) => items.push({ kind, ...iso(u, v), ...extra });
  for (let i = 0; i < 6; i++) put('veg.poplar', -11 + i * 2.2, -1.4);
  for (let i = 0; i < 6; i++) put('veg.poplar', -11 + i * 2.2, 1.8);
  put('veg.hedge', -6.5, -6.6, { params: { length: 9 } });
  put('veg.hedge', 8.5, 6.8, { params: { length: 8 } });
  [[-10, -4.6], [-7.2, -3.9], [-4.4, -4.8], [5.6, -6.2], [8.8, -5.0], [11.2, -6.6]].forEach(([u, v], i) => put(i % 3 === 1 ? 'veg.maple' : 'veg.oak', u!, v!));
  [[6.2, 4.4], [9.6, 4.0], [12.0, 3.4]].forEach(([u, v]) => put('veg.cherry', u!, v!));
  [[-10.8, 4.4], [-9.6, 5.8], [-11.8, 6.4], [-8.2, 6.9]].forEach(([u, v], i) => put(i === 1 ? 'veg.birch' : 'veg.pine', u!, v!));
  [[-5.6, 4.6], [-4.2, 5.5], [-6.9, 5.6]].forEach(([u, v]) => put('veg.birch', u!, v!));
  put('veg.flowerbed', -1.6, -3.6); put('veg.flowerbed', 6.4, -2.4); put('veg.flowerbed', -1.4, 4.4);
  [[0.9, -1.4], [3.9, -1.4], [0.9, 1.8], [3.9, 1.8]].forEach(([u, v]) => put('veg.planter', u!, v!));
  [[1.6, -5.9], [3.4, -6.3], [-2.2, 6.6], [12.2, -2.6], [11.3, -1.9], [-12.4, -6.2], [6.6, 7.0]].forEach(([u, v]) => put('veg.bush', u!, v!));
}

const center = new THREE.Vector3(0, 0.8, 0);
const { scene: s3, camera, loop } = devScene(view, center);
s3.background = new THREE.Color(P.bg);
const mat = (c: string) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 });
const board = new THREE.Mesh(new RoundedBoxGeometry(40, 1, 40, 2, 0.4), mat(P.board));
board.position.y = -0.5; board.receiveShadow = true; s3.add(board);
for (const f of flats) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(f.w, 0.06, f.d, 2, f.kind === 'lawn' ? 0.03 : 0.03), mat(f.kind === 'lawn' ? P.lawn : P.road));
  const c = iso(f.u, f.v);
  m.position.set(c.x, f.kind === 'lawn' ? 0.0 : 0.02, c.z); m.rotation.y = Math.PI / 4; m.receiveShadow = true; s3.add(m);
}
for (const it of items) s3.add(registry.build(kit, it));

const box = document.getElementById('labels')!;
const tags = labels.map((l) => {
  const el = document.createElement('div'); el.className = 'l'; el.textContent = l.text; box.append(el);
  const c = iso(l.u, l.v);
  return { el, pos: new THREE.Vector3(c.x, 0.3, c.z) };
});
const v = new THREE.Vector3();
loop(() => {
  for (const t of tags) { v.copy(t.pos).project(camera); t.el.style.left = `${((v.x + 1) / 2) * innerWidth}px`; t.el.style.top = `${((1 - v.y) / 2) * innerHeight}px`; }
});
(window as unknown as { __vegReady: boolean }).__vegReady = true;
