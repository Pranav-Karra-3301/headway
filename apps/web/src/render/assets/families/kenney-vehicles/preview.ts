// Owner: K2. Dev-only showcase (not part of the build): /src/render/assets/families/kenney-vehicles/preview.html
//   ?scene=street (default)  a small diorama: our road, bus, stop and people with kn.car.* traffic, a parking lot of
//                            kn.car.random, a service corner, and a marina of kn.boat.* — everything through the registry
//   ?scene=lineup            every kn.car.* / kn.boat.* kind in rows next to our bus, kit car and people, plus the
//                            v7 train evaluation (our train vs Kenney train-kit passenger sets)
//   &at=x,z camera target  &p=a|b|c palette  &still=1 (screenshots: render a few frames, then stop)  &view=<ortho size>  &raw=1 (no models)
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { bakeGeometry, makeBoard, makeBus, makeCar, makePerson, makeRoad, makeStop, makeStreetLamp, makeTrain, TRAIN } from '../../../kit';
import { KitMaterial } from '../../../materials';
import { PALETTES } from '../../../palettes';
import type { PaletteId } from '../../../types';
import { createBasicKit } from '../../basicKit';
import { CATALOG_BY_KIND } from '../../catalog';
import { devScene } from '../../devScene';
import { createRegistry } from '../../index';
import { kenneyColor, kenneyIdsFor, kenneyModel, kenneyReady, kenneyTemplate, preloadKenney, setKenneyPalette, type KenneyId } from '../../kenney';
import type { PlacedAsset } from '../../types';
import { register as registerVehicles, VEHICLE_KINDS } from '../kenney-vehicles';

const q = new URLSearchParams(location.search);
const pal = (['a', 'b', 'c'].includes(q.get('p') ?? '') ? q.get('p') : 'a') as PaletteId;
const P = PALETTES[pal];
const scene = q.get('scene') === 'lineup' ? 'lineup' : 'street';
const raw = q.get('raw') === '1';
setKenneyPalette(pal);
document.documentElement.style.background = P.bg;
document.getElementById('sub')!.textContent = `K2 · Kenney car-kit + watercraft-pack · ${P.name} · ${scene}`;

const registry = createRegistry();
registerVehicles(registry); // idempotent; keeps this page working while families/kenney.ts is being edited
const PI = { a: 0, b: 1, c: 2 } as const;
let seed = 11;
const E = Math.PI / 2; // Kenney/kn.* vehicles face +z: rot +π/2 drives +x, −π/2 drives −x
const WATER_TOP = -0.22;

const DECOR: KenneyId[] = [
  'nature-kit/tree_oak', 'nature-kit/tree_default', 'nature-kit/tree_detailed', 'nature-kit/tree_fat', 'nature-kit/plant_bushDetailed',
  'nature-kit/plant_bushLarge', 'nature-kit/rock_smallA', 'nature-kit/flower_yellowA', 'city-kit-roads/light-square',
];
const TRAINS: KenneyId[] = [
  'train-kit/train-electric-city-a', 'train-kit/train-electric-city-c', 'train-kit/train-electric-subway-a', 'train-kit/train-electric-subway-c',
  'train-kit/train-tram-modern', 'train-kit/train-locomotive-passenger-a',
];
if (!raw) await preloadKenney([...kenneyIdsFor(VEHICLE_KINDS), ...DECOR, ...(scene === 'lineup' ? TRAINS : [])]);

const view = Number(q.get('view') ?? (scene === 'street' ? 22 : 36));
const at0 = (q.get('at') ?? '').split(',').map(Number);
const center = at0.length === 2 && at0.every(Number.isFinite) ? new THREE.Vector3(at0[0], 0, at0[1])
  : scene === 'street' ? new THREE.Vector3(0.3, 0, 0.6) : new THREE.Vector3(0, 0, 2);
const { renderer, scene: s3, camera, loop } = devScene(view, center);
s3.background = new THREE.Color(P.bg);
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
  s3.add(m);
  return m;
};
const flat = (w: number, d: number, color: string, x: number, z: number, y = 0, h = 0.04, r = 0.02) => {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, r), new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
  m.position.set(x, y + h / 2, z); m.receiveShadow = true; m.castShadow = h > 0.1;
  s3.add(m);
  return m;
};
const place = (p: PlacedAsset, y = 0) => {
  const o = registry.build(createBasicKit(registry.roles, PI[pal], seed++), p);
  o.position.y = y;
  s3.add(o);
  return o;
};
const decor = (id: KenneyId, x: number, z: number, yaw = 0, sc = 1) => {
  if (!kenneyReady(id)) return;
  const o = kenneyModel(id, { scale: sc }); o.position.set(x, 0, z); o.rotation.y = yaw; s3.add(o);
};
const labels: Array<{ el: HTMLElement; p: THREE.Vector3 }> = [];
const label = (text: string, x: number, z: number, cls = 'l') => {
  const el = document.createElement('div'); el.className = cls; el.textContent = text;
  document.getElementById('labels')!.append(el); labels.push({ el, p: new THREE.Vector3(x, 0, z) });
};

if (scene === 'street') street(); else lineup();

// &debug=1: part table of every K2 model (role, source block, shade, triangles, paint) for chrome --dump-dom
if (q.get('debug') === '1') {
  const pre = document.createElement('pre'); pre.id = 'dbg'; pre.style.display = 'none';
  pre.textContent = JSON.stringify(Object.fromEntries(kenneyIdsFor(VEHICLE_KINDS).map((id) => {
    const t = kenneyTemplate(id);
    return [id, t ? t.parts.map((p) => {
      const b = p.geometry.boundingBox!;
      return `${p.info.role}${p.info.paint ? '*' : ''} ${p.info.source} s${p.info.shade} t${p.tris} y${b.min.y.toFixed(2)}..${b.max.y.toFixed(2)}`;
    }) : null];
  })), null, 1);
  document.body.append(pre);
}

function street(): void {
  const LAND = 3.2; // land z −10…3.2, water beyond
  kit(makeBoard(28, 13.2), 0, LAND - 6.6);
  const water = new THREE.Mesh(new RoundedBoxGeometry(28.8, 1.0, 8.2, 3, 0.45), new THREE.MeshStandardMaterial({ color: kenneyColor('knWater', 0, pal), roughness: 0.35 }));
  water.position.set(0, WATER_TOP - 0.5, LAND + 3.9); water.receiveShadow = true; s3.add(water);
  // quay edge
  flat(28, 0.5, kenneyColor('knStone', 0, pal), 0, LAND - 0.25, 0, 0.08, 0.03);

  // the road: ours, with our bus, stop and people; kn.car traffic in both lanes (right-hand: +x on the +z lane)
  kit(makeRoad(28), 0, 0);
  kit(makeBus(0), -3.4, 0.6, 0);
  kit(makeStop([0, 1]), -3.2, -2.25);
  for (const [x, z, sh] of [[-3.8, -1.7, 0], [-3.1, -1.8, 1], [-2.5, -1.6, 3], [6.2, 2.2, 2], [-10.5, -1.6, 4]] as const) kit(makePerson(sh), x, z, 0.4);
  place({ kind: 'kn.car.sedan', x: 1.4, z: 0.6, rot: E });
  place({ kind: 'kn.car.taxi', x: 4.6, z: -0.6, rot: -E });
  place({ kind: 'kn.car.van', x: 8.0, z: 0.6, rot: E, params: { paint: 2 } });
  place({ kind: 'kn.car.hatchback', x: 11.2, z: -0.6, rot: -E, params: { paint: 1 } });
  place({ kind: 'kn.car.delivery', x: -8.4, z: 0.6, rot: E });
  place({ kind: 'kn.car.suv', x: -12.0, z: -0.6, rot: -E, params: { paint: 3 } });
  kit(makeCar(0, 1), -0.9, -0.6, Math.PI); // a kit car for comparison
  for (const x of [-6.2, 2.8, 9.6]) kit(makeStreetLamp(), x, -1.55);

  // parking lot (north-west): two facing rows of random parked cars
  const lotX = -7.6, lotZ = -6.2, bays = 6, bay = 1.35;
  flat(bays * bay + 0.8, 5.4, P.road, lotX, lotZ, 0, 0.05, 0.04);
  flat(1.0, 1.75, P.road, lotX + 2.4, -2.3, 0, 0.05, 0.02); // driveway to the road
  for (let i = 0; i <= bays; i++) {
    const x = lotX + (i - bays / 2) * bay;
    flat(0.06, 1.9, P.mark, x, lotZ - 1.55, 0.05, 0.012, 0.005);
    flat(0.06, 1.9, P.mark, x, lotZ + 1.55, 0.05, 0.012, 0.005);
  }
  for (let i = 0; i < bays; i++) {
    const x = lotX + (i - bays / 2 + 0.5) * bay;
    if (i !== 2) place({ kind: 'kn.car.random', x, z: lotZ - 1.5, rot: 0 });
    if (i !== 4) place({ kind: 'kn.car.random', x, z: lotZ + 1.5, rot: Math.PI });
  }
  for (const [x, z] of [[-12.6, -8.6], [-12.4, -4.4]] as const) decor('nature-kit/tree_default', x, z, x);
  decor('nature-kit/plant_bushDetailed', -2.9, -3.0, 0.5); decor('nature-kit/plant_bushLarge', -12.5, -2.6, 1.1);

  // service corner (north-east): fire truck, ambulance, police, garbage truck on a pad; a tractor at the field
  flat(8.6, 4.4, kenneyColor('knStone', 0, pal), 3.6, -6.0, 0, 0.05, 0.05);
  place({ kind: 'kn.car.firetruck', x: 0.6, z: -6.3, rot: 0 });
  place({ kind: 'kn.car.ambulance', x: 2.1, z: -6.3, rot: 0 });
  place({ kind: 'kn.car.police', x: 3.6, z: -6.0, rot: 0 });
  place({ kind: 'kn.car.garbage', x: 5.6, z: -6.6, rot: 0.15 });
  place({ kind: 'kn.car.pickup', x: 7.0, z: -5.6, rot: -0.1 });
  flat(4.4, 5.0, kenneyColor('knDirt', 0, pal), 11.0, -6.6, 0, 0.06, 0.08);
  for (let r = 0; r < 4; r++) flat(3.8, 0.28, P.lawn, 11.0, -8.4 + r * 1.2, 0.06, 0.1, 0.05);
  place({ kind: 'kn.car.tractor', x: 10.2, z: -4.2, rot: E + 0.3 });
  for (const [x, z, id] of [[0.4, -9.0, 'nature-kit/tree_oak'], [4.0, -9.2, 'nature-kit/tree_detailed'], [7.6, -8.8, 'nature-kit/tree_fat'], [13.0, -2.8, 'nature-kit/tree_default']] as const) decor(id, x, z, x * 0.7);
  decor('nature-kit/flower_yellowA', 8.4, -3.0); decor('nature-kit/rock_smallA', 12.6, -9.2, 0.4);

  // marina (south): a pier with moored boats, rowing boats by the quay, a buoy and a cargo ship out in the bay
  const pierX = 1.2;
  flat(1.3, 4.6, kenneyColor('knWood', 0, pal), pierX, LAND + 2.2, WATER_TOP + 0.18, 0.12, 0.03);
  for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.7, 8), new THREE.MeshStandardMaterial({ color: kenneyColor('knWoodDark', 0, pal), roughness: 0.9 }));
    post.position.set(pierX + sx * 0.6, WATER_TOP + 0.12, LAND + 0.6 + i * 1.3); post.castShadow = true; s3.add(post);
  }
  place({ kind: 'kn.boat.random', x: pierX - 1.55, z: LAND + 1.6, rot: Math.PI }, WATER_TOP);
  place({ kind: 'kn.boat.sail', x: pierX - 1.55, z: LAND + 4.2, rot: Math.PI, params: { paint: 0 } }, WATER_TOP);
  place({ kind: 'kn.boat.random', x: pierX + 1.55, z: LAND + 1.7, rot: Math.PI, params: { model: 0 } }, WATER_TOP);
  place({ kind: 'kn.boat.fishing', x: pierX + 1.6, z: LAND + 4.3, rot: Math.PI, params: { paint: 2 } }, WATER_TOP);
  place({ kind: 'kn.boat.row', x: -5.6, z: LAND + 1.0, rot: E + 0.2, params: { paint: 1 } }, WATER_TOP);
  place({ kind: 'kn.boat.rowLarge', x: -8.0, z: LAND + 1.1, rot: E - 0.15, params: { paint: 4 } }, WATER_TOP);
  place({ kind: 'kn.boat.house', x: -11.0, z: LAND + 2.2, rot: E }, WATER_TOP);
  place({ kind: 'kn.boat.sailLarge', x: -4.6, z: LAND + 4.6, rot: -E - 0.4, params: { paint: 3 } }, WATER_TOP);
  place({ kind: 'kn.boat.speed', x: 5.4, z: LAND + 3.6, rot: E - 0.5, params: { paint: 0 } }, WATER_TOP);
  place({ kind: 'kn.boat.tug', x: 7.4, z: LAND + 1.4, rot: -E }, WATER_TOP);
  place({ kind: 'kn.boat.buoy', x: 3.6, z: LAND + 6.4 }, WATER_TOP);
  place({ kind: 'kn.boat.cargoShip', x: 11.0, z: LAND + 4.6, rot: -E + 0.06 }, WATER_TOP);

  label('our bus', -3.4, 1.9); label('our stop', -3.2, -1.1); label('kit car', -0.9, 0.7);
  label('kn.car.random', lotX, lotZ + 3.4); label('service + farm', 6.0, -3.4); label('kn.boat.*', -1.4, LAND + 6.4);
}

function lineup(): void {
  const S = Math.SQRT1_2;
  const iso = (u: number, v: number) => new THREE.Vector3((u + v) * S, 0, (v - u) * S);
  const ALONG = (3 * Math.PI) / 4; // +z-forward vehicles drive along the row (left → right on screen)
  const board = new THREE.Mesh(new RoundedBoxGeometry(44, 0.6, 40, 3, 0.25), new THREE.MeshStandardMaterial({ color: P.board, roughness: 0.9 }));
  board.position.copy(iso(0, 2)); board.position.y = -0.3; board.rotation.y = Math.PI / 4; board.receiveShadow = true; s3.add(board);
  const row = (v: number, title: string, items: Array<{ w: number; label?: string; make: () => THREE.Object3D; yaw?: number; y?: number }>, water = false) => {
    const total = items.reduce((t, it) => t + it.w, 0);
    if (water) {
      const sea = new THREE.Mesh(new THREE.BoxGeometry(total + 2, 0.1, 4.6), new THREE.MeshStandardMaterial({ color: kenneyColor('knWater', 0, pal), roughness: 0.35 }));
      sea.position.copy(iso(0, v)); sea.position.y = WATER_TOP - 0.05; sea.rotation.y = Math.PI / 4; sea.receiveShadow = true; s3.add(sea);
    }
    const t = iso(-total / 2 - 0.4, v - 2.1);
    label(title, t.x, t.z, 'l t');
    let u = -total / 2;
    for (const it of items) {
      const c = iso(u + it.w / 2, v);
      const o = it.make();
      o.position.add(c); o.position.y += it.y ?? 0; o.rotation.y += it.yaw ?? 0;
      s3.add(o);
      if (it.label) { const l = iso(u + it.w / 2, v + 1.5); label(it.label, l.x, l.z); }
      u += it.w;
    }
  };
  const reg = (kind: string, y = 0) => ({
    w: Math.max(1.9, (CATALOG_BY_KIND.get(kind)?.d ?? 2) + 0.9), label: kind.replace(/^kn\./, ''), yaw: ALONG, y,
    make: () => registry.build(createBasicKit(registry.roles, PI[pal], seed++), { kind, x: 0, z: 0 }),
  });
  const baked = (root: THREE.Object3D) => () => { const m = new THREE.Mesh(bakeGeometry(root, pal).geometry, kitMat); m.castShadow = true; return m; };
  const cars = VEHICLE_KINDS.filter((k) => k.startsWith('kn.car.'));
  const boats = VEHICLE_KINDS.filter((k) => k.startsWith('kn.boat.') && k !== 'kn.boat.cargoShip');
  row(-12, 'scale: our bus · kit car · people | kn.car.*', [
    { w: 3.8, label: 'our bus', yaw: Math.PI / 4, make: baked(makeBus(0)) },
    { w: 2.3, label: 'kit car', yaw: Math.PI / 4, make: baked(makeCar(0, 0)) },
    { w: 0.6, make: baked(makePerson(0)) }, { w: 0.6, label: 'people', make: baked(makePerson(2)) },
    ...cars.slice(0, 8).map((k) => reg(k)),
  ]);
  row(-5, 'kn.car.* (trucks, service, farm, random)', [...cars.slice(8).map((k) => reg(k)), { w: 3.8, label: 'our bus', yaw: Math.PI / 4, make: baked(makeBus(1)) }]);
  row(2.5, 'kn.boat.* (origin = waterline)', boats.map((k) => reg(k, WATER_TOP)), true);
  const train = (id: KenneyId) => ({ w: 3.2, label: id.split('/')[1]!.replace('train-', ''), yaw: ALONG, make: () => (kenneyReady(id) ? kenneyModel(id) : new THREE.Group()) });
  row(10, 'v7 train check: our train (kept) | Kenney train-kit passenger sets', [
    { w: 9.4, label: 'our train', yaw: Math.PI / 4, y: TRAIN.deckY, make: baked(makeTrain()) },
    ...TRAINS.map(train),
  ]);
}

const hud = document.createElement('div');
hud.className = 'l t';
hud.style.cssText = 'right:16px;top:14px;left:auto';
const missing = raw ? 0 : kenneyIdsFor(VEHICLE_KINDS).filter((id) => !kenneyReady(id)).length;
hud.textContent = `palette ${pal} · ${raw ? 'toy fallbacks (raw)' : missing ? `${missing} models not loaded` : 'all models loaded'}`;
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
