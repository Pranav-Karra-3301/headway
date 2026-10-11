// Owner: A1. Dev-only close-up preview of the downtown family (not part of the app build):
//   /src/render/assets/families/downtown/preview.html                 main street (north row faces the camera)
//   ...?mode=variants&kind=dt.shop&n=6                                 one kind, variants 0..n-1
//   ...&palette=1|2  &detail=min  &zoom=<view size>  &rot=1 (turn everything around to see backs)
import * as THREE from 'three';
import { createBasicKit } from '../../basicKit';
import { CATALOG_BY_KIND } from '../../catalog';
import { devScene } from '../../devScene';
import { createRegistry } from '../../index';
import type { PlacedAsset } from '../../types';

const q = new URLSearchParams(location.search);
const mode = q.get('mode') ?? 'street';
const palette = Math.max(0, Math.min(2, Number(q.get('palette') ?? 0))) as 0 | 1 | 2;
const turn = q.get('rot') === '1' ? Math.PI : 0;
const registry = createRegistry();
const kit = createBasicKit(registry.roles, palette, Number(q.get('seed') ?? 7));
const GROUND = [
  { board: '#A8D8B9', road: '#515566', walk: '#B9BDC9', mark: '#FFFFFF' },
  { board: '#EADFC8', road: '#D3CABA', walk: '#C7BCA8', mark: '#F7F2E8' },
  { board: '#E7E2CF', road: '#DAD7D0', walk: '#C9C5BC', mark: '#FFFFFF' },
][palette]!;

const items: PlacedAsset[] = [];
const ROAD_HALF = 1.2, WALK = 1.0, front = -(ROAD_HALF + WALK);
const row = (kinds: string[], z0: number, gap = 0, variantBase = 0) => {
  const total = kinds.reduce((s, k) => s + CATALOG_BY_KIND.get(k)!.w + gap, -gap);
  let x = -total / 2;
  kinds.forEach((kind, i) => {
    const c = CATALOG_BY_KIND.get(kind)!;
    items.push({ kind, x: x + c.w / 2, z: z0 - c.d / 2, rot: turn, params: { variant: variantBase + i } });
    x += c.w + gap;
  });
  return total;
};
let span: number;
if (mode === 'variants') {
  const kind = q.get('kind') ?? 'dt.shop';
  span = row(Array.from({ length: Number(q.get('n') ?? 6) }, () => kind), front, 0.6);
} else {
  span = row(['dt.bank', 'dt.shop', 'dt.shopRow', 'dt.cafe', 'dt.midrise', 'dt.theater', 'dt.garage', 'dt.shop', 'dt.corner'], front, 0, Number(q.get('v') ?? 0));
}
const view = Number(q.get('zoom') ?? (mode === 'variants' ? span * 0.42 : span * 0.4));
const { scene, camera, renderer, loop } = devScene(view, new THREE.Vector3(0, 1.2, -2));
renderer.setClearColor(palette === 0 ? '#DDEFE5' : palette === 1 ? '#F3ECDD' : '#EEF0F4');
scene.background = new THREE.Color(palette === 0 ? '#DDEFE5' : palette === 1 ? '#F3ECDD' : '#EEF0F4');

const flat = (w: number, d: number, color: string, x: number, z: number, y = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, d), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
  m.position.set(x, y + 0.02, z);
  m.receiveShadow = true;
  scene.add(m);
};
const L = span + 10;
const board = new THREE.Mesh(new THREE.BoxGeometry(L + 6, 0.6, 26), new THREE.MeshStandardMaterial({ color: GROUND.board, roughness: 0.9 }));
board.position.set(0, -0.3, -3);
board.receiveShadow = true;
scene.add(board);
flat(L, ROAD_HALF * 2, GROUND.road, 0, 0, -0.02);
for (let x = -L / 2 + 1; x < L / 2; x += 2) flat(0.9, 0.1, GROUND.mark, x, 0, 0);
flat(L, WALK, GROUND.walk, 0, -(ROAD_HALF + WALK / 2), 0.0);
flat(L, WALK, GROUND.walk, 0, ROAD_HALF + WALK / 2, 0.0);

const minDetail = q.get('detail') === 'min';
const dusk = q.get('dusk') === '1';
const GLOW: Record<string, [string, number]> = { 'window#1': ['#FFD27A', 1.0], 'lamp#0': ['#FFF3C4', 1.6] };
for (const it of items) {
  const o = registry.build(kit, it);
  o.traverse((c) => {
    if (minDetail && c.userData.detail) c.visible = false;
    const part = c.userData.part as { role: string; idx: number } | undefined;
    const glow = dusk && part ? GLOW[`${part.role}#${part.idx}`] : undefined;
    if (glow) {
      const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
      m.emissive.set(glow[0]);
      m.emissiveIntensity = glow[1];
    }
  });
  scene.add(o);
}
if (dusk) {
  scene.traverse((c) => {
    if ((c as THREE.Light).isLight) (c as THREE.Light).intensity *= c instanceof THREE.HemisphereLight ? 0.35 : 0.3;
  });
  scene.background = new THREE.Color('#2F3A5E');
}
document.body.style.background = '#' + (scene.background as THREE.Color).getHexString();
const labels: Array<{ el: HTMLElement; p: THREE.Vector3 }> = [];
if (q.get('labels') !== '0') for (const it of items) {
  const el = document.createElement('div');
  el.className = 'l';
  el.textContent = `${it.kind} v${it.params?.variant ?? ''}`;
  document.getElementById('labels')!.append(el);
  labels.push({ el, p: new THREE.Vector3(it.x, 0, front + 0.6) });
}
const v = new THREE.Vector3();
loop(() => {
  for (const { el, p } of labels) {
    v.copy(p).project(camera);
    el.style.left = `${((v.x + 1) / 2) * innerWidth}px`;
    el.style.top = `${((1 - v.y) / 2) * innerHeight}px`;
  }
});
(window as unknown as { __assetsReady: boolean }).__assetsReady = true;
