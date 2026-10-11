// Owner: K0. Kenney sampler rows: /assets-dev.html?family=kenney[&p=a|b|c][&view=34][&row=N&u=0][&still=1]
// Our approved bus + people (+ a kit car, kit house and A5 trees) next to recoloured, clay-shaded Kenney models for
// scale and palette checks, then every `kn.*` catalog kind (K2/K3) built through the registry.
import * as THREE from 'three';
import { bakeGeometry, makeBuilding, makeBus, makeCar, makePerson } from '../../kit';
import { KitMaterial } from '../../materials';
import { PALETTES } from '../../palettes';
import type { PaletteId } from '../../types';
import { createBasicKit } from '../basicKit';
import { CATALOG } from '../catalog';
import { devScene } from '../devScene';
import { createRegistry } from '../index';
import { kenneyIdsFor, kenneyModel, kenneyReady, preloadKenney, setKenneyPalette, type KenneyId } from './index';

const q = new URLSearchParams(location.search);
const pal = (['a', 'b', 'c'].includes(q.get('p') ?? '') ? q.get('p') : 'a') as PaletteId;
const P = PALETTES[pal];
setKenneyPalette(pal);

type Make = () => THREE.Object3D;
interface Item { label: string; make: Make; w: number; yaw?: number; y?: number; id?: KenneyId }
const S = Math.SQRT1_2;
/** Screen-aligned layout: u runs left→right on screen, v top→bottom (camera from +x+z). */
const iso = (u: number, v: number) => new THREE.Vector3((u + v) * S, 0, (v - u) * S);
const ALONG_U = Math.PI / 4;          // +x-forward kit vehicles drive along the row
const KENNEY_ALONG_U = (3 * Math.PI) / 4; // +z-forward Kenney vehicles drive along the row

const kit = (root: THREE.Object3D) => () => {
  const m = new THREE.Mesh(bakeGeometry(root, pal).geometry, new KitMaterial());
  m.castShadow = true; m.receiveShadow = true;
  return m;
};
const kn = (id: KenneyId, label = id.split('/')[1]!, w = 1.6, yaw = 0, y = 0): Item => ({ id, label, w, yaw, y, make: () => kenneyModel(id) });
const registry = createRegistry();
const basic = createBasicKit(registry.roles, ({ a: 0, b: 1, c: 2 } as const)[pal], 7);
const reg = (kind: string, w: number): Item => ({ label: kind, w, make: () => registry.build(basic, { kind, x: 0, z: 0 }) });

const ROWS: Array<{ title: string; v: number; items: Item[]; water?: boolean }> = [
  { title: 'scale: our bus · people · kit car  |  Kenney cars', v: -16, items: [
    { label: 'our bus', w: 3.6, yaw: ALONG_U, make: kit(makeBus(0)) },
    { label: 'people', w: 0.5, make: kit(makePerson(0)) }, { label: '', w: 0.5, make: kit(makePerson(1)) }, { label: '', w: 0.9, make: kit(makePerson(3)) },
    { label: 'kit car', w: 2.2, yaw: ALONG_U, make: kit(makeCar(0, 0)) },
    kn('car-kit/sedan', 'sedan', 2.1, KENNEY_ALONG_U), kn('car-kit/hatchback-sports', 'hatchback', 2.2, KENNEY_ALONG_U),
    kn('car-kit/suv', 'suv', 2.1, KENNEY_ALONG_U), kn('car-kit/van', 'van', 2.1, KENNEY_ALONG_U),
    kn('car-kit/taxi', 'taxi', 2.1, KENNEY_ALONG_U), kn('car-kit/truck', 'truck', 2.2, KENNEY_ALONG_U),
    kn('car-kit/delivery', 'delivery', 2.4, KENNEY_ALONG_U),
  ] },
  { title: 'trees: A5 oak · maple · pine  |  Kenney nature kit', v: -8, items: [
    reg('veg.oak', 2.0), reg('veg.maple', 2.0), reg('veg.pine', 1.8),
    kn('nature-kit/tree_oak', 'tree_oak'), kn('nature-kit/tree_default', 'tree_default'), kn('nature-kit/tree_detailed', 'tree_detailed', 1.8),
    kn('nature-kit/tree_fat', 'tree_fat'), kn('nature-kit/tree_plateau', 'tree_plateau'), kn('nature-kit/tree_thin', 'tree_thin', 1.6),
    kn('nature-kit/tree_simple', 'tree_simple', 1.2), kn('nature-kit/tree_cone', 'tree_cone', 1.3), kn('nature-kit/tree_blocks', 'tree_blocks', 1.4),
    kn('nature-kit/tree_pineRoundA', 'pineRound', 1.4), kn('nature-kit/tree_default_fall', 'default_fall', 1.6),
  ] },
  { title: 'bushes · rocks · flowers · props', v: 0, items: [
    kn('nature-kit/plant_bushDetailed', 'bushDetailed', 1.3), kn('nature-kit/plant_bushLarge', 'bushLarge', 1.0), kn('nature-kit/plant_bush', 'bush', 1.0),
    kn('nature-kit/rock_largeA', 'rock_largeA', 1.9), kn('nature-kit/stone_largeB', 'stone_largeB', 1.8), kn('nature-kit/rock_tallA', 'rock_tallA', 2.0),
    kn('nature-kit/stone_tallE', 'stone_tallE', 1.1), kn('nature-kit/flower_redA', 'flowers', 0.5), kn('nature-kit/flower_yellowB', '', 0.5),
    kn('nature-kit/flower_purpleA', '', 0.7), kn('nature-kit/log_stack', 'log_stack', 1.0), kn('nature-kit/stump_round', 'stump', 0.9),
    kn('nature-kit/fence_simple', 'fence', 2.1), kn('survival-kit/barrel', 'barrel', 0.7), kn('survival-kit/box-large', 'crate', 0.9),
    kn('city-kit-roads/light-square', 'street light', 0.9), kn('city-kit-roads/road-sign-stop', 'sign', 0.8),
  ] },
  { title: 'buildings: our kit house · person  |  Kenney suburban · commercial · industrial', v: 8.5, items: [
    { label: 'kit house', w: 3.2, make: kit(makeBuilding('house', { wall: 0, roof: 0, seed: 1 })) },
    { label: 'person', w: 0.8, make: kit(makePerson(2)) },
    kn('city-kit-suburban/building-type-a', 'suburban a', 3.8), kn('city-kit-suburban/building-type-h', 'suburban h', 3.6),
    kn('city-kit-suburban/building-type-c', 'suburban c', 3.7), kn('city-kit-commercial/building-c', 'commercial c', 3.0),
    kn('city-kit-commercial/building-a', 'commercial a', 2.7), kn('city-kit-industrial/building-h', 'industrial h', 3.8),
    kn('city-kit-suburban/planter', 'planter', 1.2), kn('city-kit-suburban/fence-1x3', 'fence', 3.4),
  ] },
  { title: 'boats (marina)', v: 17.5, water: true, items: [
    kn('watercraft-pack/boat-sail-a', 'sail', 2.6), kn('watercraft-pack/boat-speed-a', 'speed', 2.4), kn('watercraft-pack/boat-row-small', 'row', 2.2),
    kn('watercraft-pack/boat-fishing-small', 'fishing', 2.6), kn('watercraft-pack/boat-tug-b', 'tug', 2.6), kn('watercraft-pack/boat-house-a', 'house boat', 3.2),
    { label: 'our bus', w: 3.6, yaw: ALONG_U, make: kit(makeBus(1)) },
  ] },
];

const knKinds = CATALOG.filter((c) => c.kind.startsWith('kn.'));
const rowIds = ROWS.flatMap((r) => r.items).flatMap((it) => (it.id ? [it.id] : []));
await preloadKenney([...rowIds, ...kenneyIdsFor(knKinds.map((c) => c.kind))]);

const extraRows = Math.ceil(knKinds.length / 8);
const focus = q.get('row');
const focusRow = focus !== null ? ROWS[Number(focus)] : undefined;
const view = Number(q.get('view') ?? (focusRow ? 13 : 38 + extraRows * 6));
const { renderer, scene, camera, loop } = devScene(view, focusRow ? iso(Number(q.get('u') ?? 0), focusRow.v) : iso(0, 1 + extraRows * 3));
scene.background = new THREE.Color(P.bg);
document.documentElement.style.background = P.bg;
// Keep canvas + ortho frustum in sync with the viewport (headless screenshots resize after load).
const fit = () => {
  const a = innerWidth / innerHeight;
  renderer.setSize(innerWidth, innerHeight);
  Object.assign(camera, { left: (-view * a) / 2, right: (view * a) / 2, top: view / 2, bottom: -view / 2 });
  camera.updateProjectionMatrix();
};
addEventListener('resize', fit);

const board = new THREE.Mesh(new THREE.BoxGeometry(46, 0.6, 46 + extraRows * 8), new THREE.MeshStandardMaterial({ color: P.board, roughness: 0.9 }));
board.position.copy(iso(0, 1 + extraRows * 4)); board.position.y = -0.3; board.rotation.y = Math.PI / 4; board.receiveShadow = true; scene.add(board);

const labels: Array<{ el: HTMLElement; p: THREE.Vector3 }> = [];
const label = (text: string, p: THREE.Vector3, cls = 'l') => {
  if (!text) return;
  const el = document.createElement('div'); el.className = cls; el.textContent = text;
  document.getElementById('labels')!.append(el); labels.push({ el, p });
};

let missing = 0;
const place = (items: Item[], v: number, title: string, water = false) => {
  const total = items.reduce((s, it) => s + it.w, 0);
  let u = -total / 2;
  if (water) {
    const sea = new THREE.Mesh(new THREE.BoxGeometry(total + 3, 0.1, 5.2), new THREE.MeshStandardMaterial({ color: '#8FD0E6', roughness: 0.4 }));
    sea.position.copy(iso(0, v)); sea.position.y = 0.0; sea.rotation.y = Math.PI / 4; sea.receiveShadow = true; scene.add(sea);
  }
  label(title, iso(-total / 2 - 0.6, v - 2.2), 'l t');
  for (const it of items) {
    const c = iso(u + it.w / 2, v);
    let obj: THREE.Object3D;
    try { obj = it.make(); } catch { missing++; obj = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshStandardMaterial({ color: '#ff00aa' })); }
    obj.position.add(c);
    obj.position.y += (it.y ?? 0) + (water ? 0.05 : 0);
    obj.rotation.y += it.yaw ?? 0;
    scene.add(obj);
    label(it.label, iso(u + it.w / 2, v + 1.3));
    u += it.w;
  }
};
for (const r of ROWS) place(r.items, r.v, r.title, r.water);

// K2/K3 kinds: every kn.* catalog entry through the registry (basic kit), 8 per row.
knKinds.forEach((c, i) => {
  const col = i % 8, row = Math.floor(i / 8);
  const pos = iso((col - 3.5) * 5, 20 + row * 6);
  const obj = registry.build(basic, { kind: c.kind, x: pos.x, z: pos.z });
  scene.add(obj);
  label(c.kind + (registry.get(c.kind) ? '' : ' (todo)'), iso((col - 3.5) * 5, 20 + row * 6 + 2.4));
});

const css = document.createElement('style');
css.textContent = '.l.t{font-weight:700;background:#1F2A44;color:#FFFBF2;font-size:12px}';
document.head.append(css);
const hud = document.createElement('div');
hud.className = 'l t';
hud.style.cssText = 'left:14px;top:10px;transform:none;font-size:13px';
hud.textContent = `Kenney sampler · palette ${pal} (${P.name}) · ${missing ? `${missing} not loaded` : 'all models loaded'}`;
document.body.append(hud);

// ?still=1 (screenshots): render a few frames, then stop the loop so headless capture stays cheap.
const still = q.get('still') === '1';
if (still) {
  renderer.setPixelRatio(1);
  scene.traverse((o) => { if ((o as THREE.DirectionalLight).isDirectionalLight) (o as THREE.DirectionalLight).shadow.mapSize.set(2048, 2048); });
}
let frames = 0;
const v = new THREE.Vector3();
loop(() => {
  for (const { el, p } of labels) { v.copy(p).project(camera); el.style.left = `${((v.x + 1) / 2) * innerWidth}px`; el.style.top = `${((1 - v.y) / 2) * innerHeight}px`; }
  if (still && ++frames === 4) requestAnimationFrame(() => renderer.setAnimationLoop(null));
});
(window as unknown as { __assetsReady: boolean; __kenneyReady: (id: KenneyId) => boolean }).__assetsReady = true;
(window as unknown as { __kenneyReady: (id: KenneyId) => boolean }).__kenneyReady = kenneyReady;
