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
const flats: Array<{ kind: 'lawn' | 'path' | 'plaza'; u: number; v: number; w: number; d: number }> = [];
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
  // park vignette: lawn, crossing paths with a planter plaza, poplar avenue, hedged edges, themed corners
  view = 16;
  flats.push({ kind: 'lawn', u: 0, v: 0, w: 27, d: 16.5 });
  flats.push({ kind: 'path', u: -1.5, v: 0, w: 24, d: 1.6 });
  flats.push({ kind: 'path', u: 3, v: 0, w: 1.4, d: 16.5 });
  flats.push({ kind: 'plaza', u: 3, v: 0, w: 4.8, d: 4.8 });
  const put = (kind: string, u: number, v: number, extra: Partial<PlacedAsset> = {}) => items.push({ kind, ...iso(u, v), ...extra });
  const ALONG_U = Math.PI / 4, ALONG_V = -Math.PI / 4;
  for (const v of [-1.7, 1.7]) for (let i = 0; i < 4; i++) put('veg.poplar', -11.2 + i * 2.6, v);
  put('veg.bush', -7.3, -1.9); put('veg.bush', -4.7, 1.9);
  // top-left: hedged lawn with a flowerbed
  put('veg.hedge', -7.2, -7.2, { rot: ALONG_U, params: { length: 9 } });
  put('veg.bush', -12.3, -7.0); put('veg.bush', -2.1, -7.1);
  put('veg.flowerbed', -7.4, -5.1, { rot: ALONG_U });
  put('veg.oak', -11.0, -4.5); put('veg.maple', -3.6, -4.4);
  // top-right: oak + maple grove
  [[5.6, -6.0, 'veg.oak'], [7.8, -6.8, 'veg.maple'], [10.0, -5.8, 'veg.oak'], [12.0, -6.9, 'veg.oak'], [8.6, -4.0, 'veg.maple'], [11.4, -3.6, 'veg.oak']]
    .forEach(([u, v, k]) => put(k as string, u as number, v as number));
  put('veg.flowerbed', 6.0, -2.7, { rot: ALONG_U });
  put('veg.bush', 13.0, -2.4); put('veg.bush', 6.8, -4.4);
  // bottom-right: blossom garden behind a hedge
  [[6.0, 4.0], [8.4, 3.2], [10.8, 4.2], [7.4, 6.2], [9.9, 6.3], [12.4, 6.0]].forEach(([u, v]) => put('veg.cherry', u!, v!));
  put('veg.hedge', 9.0, 7.9, { rot: ALONG_U, params: { length: 8 } });
  put('veg.hedge', 13.2, 4.6, { rot: ALONG_V, params: { length: 4.5 } });
  // bottom-left: birch + pine woodland
  [[-11.4, 3.9], [-10.0, 5.7], [-12.0, 6.9], [-8.3, 7.0]].forEach(([u, v]) => put('veg.pine', u!, v!));
  [[-6.4, 3.7], [-4.6, 4.9], [-6.9, 5.8], [-3.0, 6.6], [-8.2, 4.5]].forEach(([u, v]) => put('veg.birch', u!, v!));
  put('veg.bush', -2.4, 3.3); put('veg.bush', -9.0, 2.9); put('veg.bush', -4.9, 7.4);
  // plaza planters + beds
  [[1.25, -1.75], [4.75, -1.75], [1.25, 1.75], [4.75, 1.75]].forEach(([u, v]) => put('veg.planter', u!, v!));
  put('veg.flowerbed', -0.4, 2.4, { rot: ALONG_U }); put('veg.flowerbed', 6.4, 2.2, { rot: ALONG_U });
}
view = Number(q.get('zoom') ?? view);
const cu = Number(q.get('cu') ?? 0), cv = Number(q.get('cv') ?? 0);
const cc = iso(cu, cv);
const center = new THREE.Vector3(cc.x, 0.8, cc.z);
const { scene: s3, camera, loop } = devScene(view, center);
s3.background = new THREE.Color(P.bg);
const mat = (c: string) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 });
const board = new THREE.Mesh(new RoundedBoxGeometry(40, 1, 40, 2, 0.4), mat(P.board));
board.position.y = -0.5; board.receiveShadow = true; s3.add(board);
for (const f of flats) {
  const c = iso(f.u, f.v);
  const m = f.kind === 'plaza'
    ? new THREE.Mesh(new THREE.CylinderGeometry(f.w / 2, f.w / 2, 0.08, 48), mat(P.road))
    : new THREE.Mesh(new RoundedBoxGeometry(f.w, 0.06, f.d, 2, 0.03), mat(f.kind === 'lawn' ? P.lawn : P.road));
  m.position.set(c.x, f.kind === 'lawn' ? 0.0 : f.kind === 'path' ? 0.02 : 0.03, c.z);
  m.rotation.y = Math.PI / 4; m.receiveShadow = true; s3.add(m);
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
