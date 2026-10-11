// A4 dev-only close-up preview (not part of the app bundle): /src/render/assets/families/landmarks/preview.html
//   ?kind=lm.stadium[,lm.clockTower]  &palette=0|1|2  &view=<world units>  &rot=<quarter turns>  &scene=rail
import * as THREE from 'three';
import { createBasicKit } from '../../basicKit';
import { CATALOG_BY_KIND } from '../../catalog';
import { devScene } from '../../devScene';
import { createRegistry } from '../../index';
import { makePerson, makeTrack, makeTrain } from '../../../kit';
import { PALETTES } from '../../../palettes';
import type { RoleColors } from '../../types';

const q = new URLSearchParams(location.search);
const palette = (Number(q.get('palette') ?? 0) as 0 | 1 | 2);
const registry = createRegistry();
// kit=town: resolve composer palette roles first (like the T2.2 clay adapter), then family roles.
const townRoles: RoleColors = { ...registry.roles };
if (q.get('kit') === 'town') for (const role of Object.keys(PALETTES.a) as Array<keyof typeof PALETTES.a>) {
  if (role === 'name') continue;
  townRoles[role] = [PALETTES.a[role], PALETTES.b[role], PALETTES.c[role]];
}
const kit = createBasicKit(townRoles, palette, 7);
const scene = q.get('scene');
const kinds = (q.get('kind') ?? 'lm.stadium').split(',');
const rot = (Number(q.get('rot') ?? 0) * Math.PI) / 2;

type Item = { kind: string; x: number; z: number; rot?: number };
let items: Item[] = [];
const extras: Array<(s: THREE.Scene) => void> = [];
const road = (x: number, z: number, w: number, d: number) => (s: THREE.Scene) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), new THREE.MeshStandardMaterial({ color: '#F4EBDD', roughness: 0.95 }));
  m.position.set(x, 0.03, z); m.receiveShadow = true; s.add(m);
};
if (scene === 'rail') {
  items = [
    { kind: 'lm.stationCentral', x: -9, z: -3.4 },
    { kind: 'lm.stationHalt', x: 3.5, z: -2.5 },
    { kind: 'lm.levelCrossing', x: 12, z: 0 },
    { kind: 'lm.railSignal', x: 8.6, z: 1.3 },
    { kind: 'lm.railSignal', x: -16, z: -1.3, rot: Math.PI },
  ];
  extras.push(road(12, 0, 2.4, 22));
  extras.push((s) => { const t = makeTrack(36); t.position.set(-1, 0, 0); s.add(t); const tr = makeTrain(); tr.position.set(-6.5, 0.2, 0); s.add(tr); });
} else if (scene === 'sheet') {
  items = [
    { kind: 'lm.stadium', x: 1.5, z: -8.5 },
    { kind: 'lm.clockTower', x: -11.5, z: -9 },
    { kind: 'lm.waterTower', x: 13.5, z: -10.5 },
    { kind: 'lm.stationCentral', x: -9.5, z: 0.6 },
    { kind: 'lm.stationHalt', x: 5.5, z: 1.6 },
    { kind: 'lm.levelCrossing', x: 14, z: 4.2 },
    { kind: 'lm.railSignal', x: -17.5, z: 5.5 },
    { kind: 'lm.railSignal', x: 10.6, z: 5.5 },
  ];
  extras.push(road(14, 2.5, 2.4, 25));
  extras.push((s) => { const t = makeTrack(46); t.position.set(-1, 0, 4.2); s.add(t); const tr = makeTrain(); tr.position.set(-1.5, 0.2, 4.2); s.add(tr); });
} else {
  let x = 0;
  for (const kind of kinds) {
    const c = CATALOG_BY_KIND.get(kind)!;
    items.push({ kind, x: x + c.w / 2, z: 0, rot });
    x += c.w + 2;
  }
  const off = (x - 2) / 2;
  for (const it of items) it.x -= off;
}
const span = Math.max(...items.map((i) => Math.abs(i.x) + (CATALOG_BY_KIND.get(i.kind)?.w ?? 1)), 6);
const maxH = Math.max(...items.map((i) => CATALOG_BY_KIND.get(i.kind)?.h ?? 1));
const view = Number(q.get('view') ?? 0) || Math.max(span * 1.25, maxH * 1.6);
const { scene: s, loop } = devScene(view, new THREE.Vector3(0, Math.min(maxH, 6) * 0.3, 0));
const board = new THREE.Mesh(new THREE.BoxGeometry(600, 0.6, 600), new THREE.MeshStandardMaterial({ color: '#A8D8B9', roughness: 0.9 }));
board.position.y = -0.3; board.receiveShadow = true; s.add(board);
for (const it of items) s.add(registry.build(kit, { kind: it.kind, x: it.x, z: it.z, rot: it.rot }));
for (const e of extras) e(s);
if (q.get('people') !== '0' && scene !== 'rail') {
  const first = items[0]!; const c = CATALOG_BY_KIND.get(first.kind)!;
  [[-0.6, 0.9], [0.1, 1.3], [0.7, 0.8], [1.4, 1.5]].forEach(([dx, dz], i) => { const p = makePerson(i); p.position.set(first.x + dx!, 0, first.z + c.d / 2 + dz!); s.add(p); });
}
document.getElementById('msg')!.textContent = `${scene ?? kinds.join(', ')} · palette ${'abc'[palette]}`;
loop();
(window as unknown as { __ready: boolean }).__ready = true;
