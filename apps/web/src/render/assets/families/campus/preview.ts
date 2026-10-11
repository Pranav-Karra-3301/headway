// Owner: A2. Dev-only close-up for the campus family:
//   /src/render/assets/families/campus/preview.html?k=cp.hall&palette=0&detail=toy&view=16
// Shows every documented variant of one kind side by side (default: one of each kind).
import * as THREE from 'three';
import { createBasicKit } from '../../basicKit';
import { CATALOG } from '../../catalog';
import { devScene } from '../../devScene';
import { AssetRegistry } from '../../registry';
import type { AssetParams } from '../../types';
import * as campus from '../campus';

const q = new URLSearchParams(location.search);
const kind = q.get('k');
const palette = Math.max(0, Math.min(2, Number(q.get('palette') ?? 0))) as 0 | 1 | 2;
const registry = new AssetRegistry();
campus.register(registry);
const kit = createBasicKit(registry.roles, palette, Number(q.get('seed') ?? 3));
const SHOWCASE: Array<{ kind: string; params: AssetParams }> = [
  { kind: 'cp.hall', params: { variant: 1, roof: 1, brick: 0, door: 1 } }, { kind: 'cp.library', params: {} }, { kind: 'cp.chapel', params: { roof: 0, brick: 1 } },
  { kind: 'cp.dorm', params: { roof: 1, brick: 2 } }, { kind: 'cp.hall', params: { variant: 0, roof: 0, brick: 2, door: 0 } }, { kind: 'cp.union', params: { banner: 0, roof: 1 } },
  { kind: 'cp.science', params: { brick: 1 } }, { kind: 'cp.gate', params: { brick: 0, banner: 0 } }, { kind: 'cp.hall', params: { variant: 2, roof: 2, brick: 1, door: 2 } },
];
const items: Array<{ kind: string; params: AssetParams }> = q.has('show')
  ? SHOWCASE
  : kind
    ? [{}, ...(campus.VARIANTS[kind] ?? [])].map((params) => ({ kind, params }))
    : CATALOG.filter((c) => c.family === 'campus').map((c) => ({ kind: c.kind, params: {} }));
const sizes = items.map((it) => CATALOG.find((c) => c.kind === it.kind)!);
const cols = Number(q.get('cols') ?? Math.min(items.length, 4));
const cell = Number(q.get('cell') ?? Math.max(...sizes.map((s) => Math.max(s.w, s.d))) + 2.5);
const rows = Math.ceil(items.length / cols);
const view = Number(q.get('view') ?? cell * Math.max(cols, rows) * 0.62);
const shift = Number(q.get('shift') ?? 0); // pan the camera target back (−x −z) to move content down on screen
const { scene, camera, loop } = devScene(view, new THREE.Vector3(-shift, 0, -shift));
const board = new THREE.Mesh(new THREE.BoxGeometry(cols * cell + 3, 0.6, rows * cell + 3), new THREE.MeshStandardMaterial({ color: ['#A8D8B9', '#EADFC8', '#E7E2CF'][palette], roughness: 0.9 }));
board.position.y = -0.3; board.receiveShadow = true; scene.add(board);
const bg = ['#DDEFE5', '#F3ECDD', '#EEF0F4'][palette]!;
(scene.background as THREE.Color).set(bg); document.body.style.background = bg;
const labels: Array<{ el: HTMLElement; p: THREE.Vector3 }> = [];
items.forEach((it, i) => {
  const x = (i % cols) * cell - (cols * cell) / 2 + cell / 2, z = Math.floor(i / cols) * cell - (rows * cell) / 2 + cell / 2;
  const obj = registry.build(kit, { kind: it.kind, x, z, rot: Number(q.get('rot') ?? 0) * (Math.PI / 2), params: it.params });
  if (q.get('detail') === 'min') obj.traverse((o) => { if (o.userData.detail) o.visible = false; });
  scene.add(obj);
  const el = document.createElement('div'); el.className = 'l'; el.textContent = q.has('show') ? it.kind : `${it.kind} ${JSON.stringify(it.params)}`;
  if (!q.has('show')) document.getElementById('labels')!.append(el);
  labels.push({ el, p: new THREE.Vector3(x, 0, z + sizes[i]!.d / 2 + 0.9) });
});
const v = new THREE.Vector3();
loop(() => { for (const { el, p } of labels) { v.copy(p).project(camera); el.style.left = `${((v.x + 1) / 2) * innerWidth}px`; el.style.top = `${((1 - v.y) / 2) * innerHeight}px`; } });
