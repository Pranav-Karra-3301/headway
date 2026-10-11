// Owner: A6 street. Dev-only close-up preview of the street family (Vite dev server):
//   /src/render/assets/families/street/preview.html?view=grid|scene|one&kind=st.kiosk&palette=a|b|c&light=day|dusk&clay=0
// Colours resolve like the composer: palette roles first (render/palettes.ts), then family roles.
import * as THREE from 'three';
import { createBasicKit } from '../../basicKit';
import { CATALOG_BY_KIND } from '../../catalog';
import { devScene } from '../../devScene';
import { AssetRegistry } from '../../registry';
import type { KitContext, PlacedAsset, RoleColors } from '../../types';
import { applyClay } from '../../../materials';
import { PALETTES } from '../../../palettes';
import { register } from '../street';

const q = new URLSearchParams(location.search);
const view = q.get('view') ?? 'grid';
const pal = (['a', 'b', 'c'].includes(q.get('palette') ?? '') ? q.get('palette') : 'a') as 'a' | 'b' | 'c';
const P = PALETTES[pal] as unknown as Record<string, string | string[]>;
const dusk = q.get('light') === 'dusk';
const clay = q.get('clay') !== '0';
const seed = Number(q.get('seed') ?? 3);

const registry = new AssetRegistry();
register(registry);
const paletteRoles: RoleColors = {};
for (const role of Object.keys(PALETTES.a)) {
  if (role === 'name') continue;
  const get = (id: 'a' | 'b' | 'c') => (PALETTES[id] as unknown as Record<string, string | string[]>)[role]!;
  paletteRoles[role] = [get('a'), get('b'), get('c')];
}
const base = createBasicKit({ ...registry.roles, ...paletteRoles }, ({ a: 0, b: 1, c: 2 } as const)[pal], seed);
const GLOW: Record<string, number> = { lamp: 1.6, taillight: 1.2 };
const seen = new Set<THREE.Material>();
const kit: KitContext = {
  ...base,
  mat(role, idx) {
    const m = base.mat(role, idx) as THREE.MeshStandardMaterial;
    if (!seen.has(m)) {
      seen.add(m);
      if (clay) applyClay(m);
      if (dusk && GLOW[role]) { m.emissive.copy(m.color); m.emissiveIntensity = GLOW[role]!; }
    }
    return m;
  },
};
const place = (it: PlacedAsset) => registry.build(kit, it);

const labels: Array<{ el: HTMLElement; p: THREE.Vector3 }> = [];
const label = (text: string, p: THREE.Vector3) => {
  const el = document.createElement('div'); el.className = 'l'; el.textContent = text;
  document.getElementById('labels')!.append(el); labels.push({ el, p });
};
const groundMat = (role: string) => new THREE.MeshStandardMaterial({ color: (paletteRoles[role]![({ a: 0, b: 1, c: 2 } as const)[pal]] as string), roughness: 0.92 });
const slab = (w: number, d: number, x: number, z: number, y: number, role: string) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, d), groundMat(role));
  m.position.set(x, y, z); m.receiveShadow = true; return m;
};

let items: PlacedAsset[] = [];
let viewSize = 14, center = new THREE.Vector3();
const extras: THREE.Object3D[] = [];

if (view === 'one') {
  const kind = q.get('kind') ?? 'st.lamp';
  const c = CATALOG_BY_KIND.get(kind)!;
  items = [{ kind, x: 0, z: 0, params: kind === 'st.fence' ? { length: 3 } : {} }];
  // Fit the projected iso silhouette (plus room for the shadow, which falls to the right).
  viewSize = Math.max(0.85 * c.h + 0.37 * (c.w + c.d), 0.71 * (c.w + c.d)) * 1.45;
  center = new THREE.Vector3(0.16 * c.h, c.h * 0.45, -0.16 * c.h);
} else if (view === 'grid') {
  const rows = [
    ['st.lamp', 'st.trafficLight', 'st.flag', 'st.kiosk'],
    ['st.bench', 'st.tableUmbrella', 'st.bikeRack', 'st.fence'],
    ['st.bin', 'st.hydrant', 'st.mailbox', 'st.fountain'],
  ];
  const cell = 3.4;
  rows.forEach((row, r) => row.forEach((kind, i) => {
    const x = (i - 1.5) * cell, z = (r - 1) * cell;
    items.push({ kind, x, z });
    const c = CATALOG_BY_KIND.get(kind)!;
    label(kind.replace('st.', ''), new THREE.Vector3(x, c.h + 0.25, z));
  }));
  viewSize = 15.5; center = new THREE.Vector3(0, 0.6, 0.4);
  extras.push(slab(cell * 4 + 1, cell * 3 + 1, 0, 0, 0.0, 'curb'));
} else {
  // Street corner: road A along x (z = 3.6), road B along z (x = 4.2), plaza with fountain, café, lawns, field.
  viewSize = Number(q.get('size') ?? 16); center = new THREE.Vector3(Number(q.get('cx') ?? -0.6), 0.4, Number(q.get('cz') ?? -0.8));
  extras.push(slab(40, 2.4, 0, 3.6, 0.03, 'road'), slab(2.4, 40, 4.2, 0, 0.031, 'road'));
  extras.push(slab(40, 1.0, 0, 1.9, 0.045, 'curb'), slab(40, 1.0, 0, 5.3, 0.045, 'curb'));
  extras.push(slab(1.0, 40, 2.5, 0, 0.046, 'curb'), slab(1.0, 40, 5.9, 0, 0.046, 'curb'));
  extras.push(slab(10.6, 9.2, -3.3, -3.0, 0.02, 'platform'));
  extras.push(slab(12, 8, 12.4, -2.2, 0.02, 'lawn'), slab(12, 8, 12.4, 10, 0.02, 'field'));
  for (let x = -11; x < 11; x += 1.6) extras.push(slab(0.8, 0.1, x, 3.6, 0.055, 'mark'));
  for (let z = -11; z < 11; z += 1.6) if (Math.abs(z - 3.6) > 1.6) extras.push(slab(0.1, 0.8, 4.2, z, 0.056, 'mark'));
  for (let i = 0; i < 6; i++) extras.push(slab(0.32, 1.9, 1.5 - i * 0.55 + 0.2, 3.6, 0.057, 'mark'));
  const F = { x: -2.6, z: -2.2 };
  const tags: Array<[PlacedAsset, string]> = [];
  const add = (kind: string, x: number, z: number, rot = 0, params: PlacedAsset['params'] = {}, tag?: string) => {
    const it: PlacedAsset = { kind, x, z, rot, params };
    items.push(it);
    if (tag) tags.push([it, tag]);
  };
  add('st.fountain', F.x, F.z, 0, {}, 'fountain');
  add('st.bench', F.x, F.z + 2.2, Math.PI);
  add('st.bench', F.x, F.z - 2.2);
  add('st.bench', F.x - 2.2, F.z, Math.PI / 2);
  add('st.bench', F.x + 2.2, F.z, -Math.PI / 2, {}, 'bench');
  add('st.bin', F.x + 1.05, F.z + 2.25);
  add('st.bin', F.x - 2.25, F.z - 1.05);
  add('st.lamp', F.x - 2.3, F.z + 2.3); add('st.lamp', F.x + 2.3, F.z - 2.3); add('st.lamp', F.x - 2.3, F.z - 2.3);
  add('st.kiosk', -7.6, -1.4, Math.PI / 2, { color: 0 }, 'kiosk');
  add('st.tableUmbrella', -6.4, 0.6, 0, { color: 0 });
  add('st.tableUmbrella', -6.6, -3.6, 0, { color: 1 }, 'table + umbrella');
  add('st.tableUmbrella', -5.0, -5.7, 0, { color: 2 });
  add('st.flag', -2.0, -6.7, 0, { color: 0 });
  add('st.flag', -0.9, -6.7, 0, { color: 1 }, 'flag');
  add('st.flag', 0.2, -6.7, 0, { color: 2 });
  add('st.lamp', -5.6, 2.15); add('st.lamp', 1.2, 2.15); add('st.lamp', 2.25, -3.8, 0, {}, 'lamp');
  add('st.lamp', -2.6, 5.05); add('st.lamp', 5.65, -2.6);
  add('st.trafficLight', 2.25, 2.15);
  add('st.trafficLight', 6.15, 5.05, Math.PI, {}, 'traffic light');
  add('st.hydrant', 0.3, 2.1, 0, {}, 'hydrant');
  add('st.mailbox', -1.4, 2.0, 0, {}, 'mailbox');
  add('st.bikeRack', -3.8, 1.95, 0, { color: 0 }, 'bike rack');
  add('st.bench', -0.8, 5.45, Math.PI);
  add('st.bin', 0.25, 5.45, 0, {}, 'bin');
  add('st.fence', 6.75, -3.6, Math.PI / 2, { length: 10.4 });
  add('st.fence', 9.2, 1.75, 0, { length: 4.8 }, 'picket fence');
  add('st.fence', 9.2, 6.1, 0, { length: 4.8, style: 'rail' }, 'rail fence');
  add('st.fence', 6.75, 8.5, Math.PI / 2, { length: 4.8, style: 'rail' });
  if (q.get('labels') === '1') for (const [it, text] of tags) label(text, new THREE.Vector3(it.x, CATALOG_BY_KIND.get(it.kind)!.h + 0.3, it.z));
}

const { scene, camera, renderer, loop } = devScene(viewSize, center);
scene.background = new THREE.Color(dusk ? PALETTES[pal].duskBg : PALETTES[pal].bg);
const board = new THREE.Mesh(new THREE.BoxGeometry(80, 0.6, 80), groundMat('board'));
board.position.y = -0.3; board.receiveShadow = true; scene.add(board);
for (const e of extras) scene.add(e);
for (const it of items) scene.add(place(it));
if (dusk) {
  scene.traverse((o) => {
    if ((o as THREE.HemisphereLight).isHemisphereLight) (o as THREE.HemisphereLight).intensity = 0.55;
    if ((o as THREE.DirectionalLight).isDirectionalLight) { (o as THREE.DirectionalLight).intensity = 0.5; (o as THREE.DirectionalLight).color.set('#9fb0ff'); }
  });
}
const fit = () => {
  const a = innerWidth / innerHeight;
  Object.assign(camera, { left: (-viewSize * a) / 2, right: (viewSize * a) / 2, top: viewSize / 2, bottom: -viewSize / 2 });
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
};
addEventListener('resize', fit);
fit();
const v = new THREE.Vector3();
loop(() => { for (const { el, p } of labels) { v.copy(p).project(camera); el.style.left = `${((v.x + 1) / 2) * innerWidth}px`; el.style.top = `${((1 - v.y) / 2) * innerHeight}px`; } });
(window as unknown as { __streetReady: boolean }).__streetReady = true;
