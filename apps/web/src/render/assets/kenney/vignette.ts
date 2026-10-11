// Owner: K0. /assets-dev.html?family=kenney&scene=vignette[&p=a|b|c][&still=1][&view=19][&raw=1]
// One small diorama for the scale/palette check, world-aligned like the game (road along x, camera from +x+z):
// OUR board, road, stop, people, bus and a kit car among recoloured, clay-shaded Kenney trees, rocks, bushes, a
// suburban house (roof → palette `roof` by default), cars, boats and props. Car paints and a few leaf variants use
// recolorKenney the way K1/K2/traffic do (&raw=1 shows pipeline defaults only).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { bakeGeometry, makeBoard, makeBus, makeCar, makePerson, makeRoad, makeStop } from '../../kit';
import { KitMaterial } from '../../materials';
import { PALETTES } from '../../palettes';
import type { PaletteId } from '../../types';
import { devScene } from '../devScene';
import { kenneyColor } from './colors';
import { kenneyModel, kenneyReady, preloadKenney, recolorKenney, setKenneyPalette, type KenneyId, type KenneyRecolor } from './index';

const q = new URLSearchParams(location.search);
const pal = (['a', 'b', 'c'].includes(q.get('p') ?? '') ? q.get('p') : 'a') as PaletteId;
const P = PALETTES[pal];
const raw = q.get('raw') === '1';
setKenneyPalette(pal);

const E = Math.PI / 2; // Kenney vehicles face +z: yaw +π/2 drives +x, −π/2 drives −x
const LAND_Z = 4; // land z −10…4, lake z 4…10; water top at y = −0.2
const paint = (idx: number): KenneyRecolor => (p) => (p.paint ? { role: 'car', idx, shade: 0 } : null);
const leaf = (idx: number): KenneyRecolor => (p) => (p.role === 'leaf' ? { role: 'leaf', idx } : null); // K1-style variety

type Spec = [id: KenneyId, x: number, z: number, yaw?: number, scale?: number, recolor?: KenneyRecolor];
const KN: Spec[] = [
  // north of the road: a house with its garden, trees, rocks, props
  ['city-kit-suburban/building-type-a', -5.4, -5.6, 0],
  ['city-kit-suburban/fence-1x3', -8.3, -3.2, 0], ['city-kit-suburban/fence-1x3', -2.5, -3.2, 0],
  ['city-kit-suburban/planter', -3.6, -2.7, 0],
  ['nature-kit/tree_oak', -9.0, -8.6, 0.6], ['nature-kit/tree_default', -8.8, -5.2, 2.1, 0.9, leaf(1)],
  ['nature-kit/tree_detailed', -1.4, -8.8, 1.2], ['nature-kit/tree_fat', 0.4, -5.6, 0.3, 0.95, leaf(2)],
  ['nature-kit/tree_pineRoundA', 2.6, -8.9, 0], ['nature-kit/tree_cone', 4.3, -6.2, 1.0, 1, leaf(3)],
  ['nature-kit/tree_plateau', 6.9, -8.6, 2.5, 1, leaf(1)], ['nature-kit/tree_default_fall', 8.6, -5.6, 0.9, 0.95],
  ['nature-kit/tree_thin', -0.6, -3.1, 0.2, 0.9, leaf(2)],
  ['nature-kit/plant_bushDetailed', 1.6, -2.7, 0.4], ['nature-kit/plant_bushLarge', 2.6, -3.4, 1.3],
  ['nature-kit/flower_redA', -1.6, -2.3], ['nature-kit/flower_yellowB', -1.2, -2.0, 1], ['nature-kit/flower_purpleA', 0.9, -2.2],
  ['nature-kit/rock_largeA', 6.2, -3.2, 0.4], ['nature-kit/stone_largeB', 8.4, -2.6, 1.9, 0.8], ['nature-kit/stone_tallE', 9.2, -4.0, 0.7],
  ['nature-kit/log_stack', 4.4, -2.9, 0.3], ['nature-kit/stump_round', 3.4, -2.2],
  ['survival-kit/barrel', -9.2, -1.9], ['survival-kit/box-large', -8.5, -1.7, 0.4],
  // the road: Kenney cars share it with our bus; a Kenney street light and sign on the kerb
  ['car-kit/sedan', 2.2, 0.35, E, 1, paint(0)], ['car-kit/taxi', 6.0, 1.55, -E], ['car-kit/van', 8.6, 0.35, E, 1, paint(2)],
  ['city-kit-roads/light-square', 1.0, -0.85, Math.PI], ['city-kit-roads/road-sign-stop', 5.4, -0.9, 0],
  // south: a grass verge with bushes, the lake with boats and shore rocks
  ['nature-kit/plant_bush', -3.0, 2.9, 0.7], ['nature-kit/plant_bushDetailed', 3.9, 3.0, 2.0], ['nature-kit/flower_yellowA', 4.7, 2.6],
  ['watercraft-pack/boat-sail-a', -6.0, 7.0, E + 0.3], ['watercraft-pack/boat-row-small', -2.0, 5.7, E - 0.6],
  ['watercraft-pack/boat-speed-a', 2.8, 7.6, -E - 0.2], ['watercraft-pack/boat-fishing-small', 7.4, 6.4, E + 0.15],
  ['nature-kit/rock_smallA', -9.0, 4.4, 0.3], ['nature-kit/rock_smallB', 9.2, 4.5, 1.4], ['nature-kit/stone_smallC', 0.6, 4.4],
];

await preloadKenney(KN.map((s) => s[0]));

const view = Number(q.get('view') ?? 19.5);
const center = new THREE.Vector3(0.6, 0, 0.2);
const { renderer, scene, camera, loop } = devScene(view, center);
scene.background = new THREE.Color(P.bg);
document.documentElement.style.background = P.bg;
const fit = () => { // keep canvas + ortho frustum in sync with the viewport (headless screenshots resize after load)
  const a = innerWidth / innerHeight;
  renderer.setSize(innerWidth, innerHeight);
  Object.assign(camera, { left: (-view * a) / 2, right: (view * a) / 2, top: view / 2, bottom: -view / 2 });
  camera.updateProjectionMatrix();
};
addEventListener('resize', fit);

const kitMat = new KitMaterial();
const kit = (root: THREE.Object3D, x: number, z: number, yaw = 0, y = 0) => {
  const m = new THREE.Mesh(bakeGeometry(root, pal).geometry, kitMat);
  m.castShadow = true; m.receiveShadow = true;
  m.position.set(x, y, z); m.rotation.y = yaw;
  scene.add(m);
  return m;
};

// ours: board, road, stop + people, bus, a kit car
kit(makeBoard(20, 14), 0, LAND_Z - 7);
kit(makeRoad(20), 0, 0.95);
const water = new THREE.Mesh(new RoundedBoxGeometry(20.8, 1.0, 7.4, 3, 0.45), new THREE.MeshStandardMaterial({ color: kenneyColor('knWater', 0, pal), roughness: 0.35 }));
water.position.set(0, -0.7, LAND_Z + 3.0); water.receiveShadow = true; scene.add(water);
kit(makeStop([0, 1]), -5.6, -1.25);
for (const [x, z, s] of [[-6.1, -0.6, 0], [-5.5, -0.8, 1], [-4.9, -0.55, 3], [-9.4, -0.7, 4], [-2.2, 2.6, 2]] as const) kit(makePerson(s), x, z, 0.4);
kit(makeBus(0), -2.0, 0.35);
kit(makeCar(0, 1), -7.8, 1.55, Math.PI);

let missing = 0;
for (const [id, x, z, yaw = 0, s = 1, recolor] of KN) {
  if (!kenneyReady(id)) { missing++; continue; }
  const o = kenneyModel(id, { scale: s });
  if (recolor && !raw) recolorKenney(o, recolor);
  o.position.set(x, id.startsWith('watercraft') ? -0.34 : z > LAND_Z ? -0.28 : 0, z);
  o.rotation.y = yaw;
  scene.add(o);
}

// labels: only ours, so everything else reads as "the town"
const css = document.createElement('style');
css.textContent = '.l.t{font-weight:700;background:#1F2A44;color:#FFFBF2;font-size:13px}';
document.head.append(css);
const labels: Array<{ el: HTMLElement; p: THREE.Vector3 }> = [];
const label = (text: string, p: THREE.Vector3) => {
  const el = document.createElement('div'); el.className = 'l'; el.textContent = text;
  document.getElementById('labels')!.append(el); labels.push({ el, p });
};
label('our bus', new THREE.Vector3(-2.0, 0, 2.0)); label('our stop + people', new THREE.Vector3(-5.6, 0, -0.1));
label('our kit car', new THREE.Vector3(-7.8, 0, 2.6));
const hud = document.createElement('div');
hud.className = 'l t';
hud.style.cssText = 'left:14px;top:10px;transform:none';
hud.textContent = `Kenney kits through the K0 pipeline · palette ${pal} (${P.name})${raw ? ' · raw defaults' : ''}${missing ? ` · ${missing} not loaded` : ''}`;
document.body.append(hud);

const still = q.get('still') === '1';
if (still) renderer.setPixelRatio(1);
let frames = 0;
const tmp = new THREE.Vector3();
loop(() => {
  for (const { el, p } of labels) { tmp.copy(p).project(camera); el.style.left = `${((tmp.x + 1) / 2) * innerWidth}px`; el.style.top = `${((1 - tmp.y) / 2) * innerHeight}px`; }
  if (still && ++frames === 4) requestAnimationFrame(() => renderer.setAnimationLoop(null));
});
(window as unknown as { __assetsReady: boolean }).__assetsReady = true;
export {};
