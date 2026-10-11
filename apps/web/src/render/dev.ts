// Owner: T2.1. Render dev page (apps/web/render-dev.html): every kit piece on a board, rendered exactly like the
// town will be — static pieces baked into ONE geometry, trees/cars/people instanced, all on KitMaterial, through
// Stage (lights, sky, drop shadow, post chain). URL: ?palette=a|b|c&detail=toy|min&light=day|dusk&quality=high|low
// &post=0&auto=0&labels=0&zoom=1.4&x=0&z=0&anim=0
import * as THREE from 'three';
import {
  bakeGeometry, BUS, CAR_VARIANTS, createForest, makeBoard, makeBuilding, makeBus, makeCar, makeClockTower, makeLawn,
  makePersonBody, makePersonHead, makeRoad, makeStadium, makeStation, makeStop, makeStreetLamp, makeTrain, recolorBaked,
  setBakedDetail, TRAIN, TREE_VARIANTS, type Baked, type BuildingType, type TreePlacement,
} from './kit';
import { KitMaterial } from './materials';
import { colorOf, DEFAULT_DETAIL, DEFAULT_LIGHT, DEFAULT_PALETTE, PALETTES } from './palettes';
import { Stage } from './post';
import type { Quality } from './post';
import type { DetailMode, LightMode, PaletteId } from './types';

const q = new URLSearchParams(location.search);
const pick = <T extends string>(k: string, ok: readonly T[], d: T): T => (ok.includes(q.get(k) as T) ? (q.get(k) as T) : d);
const state = {
  palette: pick<PaletteId>('palette', ['a', 'b', 'c'], DEFAULT_PALETTE),
  detail: pick<DetailMode>('detail', ['min', 'toy'], DEFAULT_DETAIL),
  light: pick<LightMode>('light', ['day', 'dusk'], DEFAULT_LIGHT),
  quality: pick<Quality>('quality', ['high', 'low'], 'high'),
};
const anim = q.get('anim') !== '0';
if (q.get('labels') === '0') document.body.classList.add('nolabels');

const BW = 48, BD = 36;
const bounds = { minX: -BW / 2, maxX: BW / 2, minZ: -BD / 2, maxZ: BD / 2 };
const canvas = document.getElementById('c') as HTMLCanvasElement;
const stage = new Stage(canvas, {
  palette: state.palette, light: state.light, quality: state.quality, bounds, maxHeight: 9,
  post: q.get('post') !== '0', autoQuality: q.get('auto') !== '0', preserveDrawingBuffer: true,
  camera: { view: 46, zoom: Number(q.get('zoom') ?? 1) || 1, target: { x: Number(q.get('x') ?? 1) || 0, z: Number(q.get('z') ?? -1) || 0 } },
  onQualityChange: (qq) => { state.quality = qq; syncChips(); },
});

// ---------------------------------------------------------------- static board (one baked geometry)
const tags: Array<{ el: HTMLElement; pos: THREE.Vector3 }> = [];
function tag(text: string, sub: string, x: number, y: number, z: number): void {
  const el = document.createElement('div');
  el.className = 'tag gb';
  el.innerHTML = text + (sub ? `<small>${sub}</small>` : '');
  document.getElementById('tags')!.append(el);
  tags.push({ el, pos: new THREE.Vector3(x, y, z) });
}
const place = <T extends THREE.Object3D>(o: T, x: number, z: number, rot = 0, y = 0): T => { o.position.set(x, y, z); o.rotation.y = rot; return o; };

const statics = new THREE.Group();
statics.add(makeBoard(BW, BD));
const lawn = makeLawn(14, 7.5); lawn.position.set(-10, 0.03, -12.2); statics.add(lawn);

// Row A: civic + landmarks.
const rowA: Array<[BuildingType, number, number, number, number, string, string]> = [
  ['small', -20.2, -12.6, 0, 0, 'Small block', '2 storeys'],
  ['tall', -15.6, -12.6, 2, 1, 'Apartments', '5 storeys'],
  ['hall', -8.4, -13.4, 0, 0, 'Campus hall', 'portico'],
  ['library', -0.4, -13.2, 0, 0, 'Library', 'dome + columns'],
];
for (const [t, x, z, wall, roof, label, sub] of rowA) {
  statics.add(place(makeBuilding(t, { wall, roof, seed: Math.round(x * 10) }), x, z));
  tag(label, sub, x, t === 'tall' ? 7.2 : t === 'library' ? 6.2 : t === 'hall' ? 4.4 : 3.6, z);
}
statics.add(place(makeClockTower(), 6.2, -13));
tag('Clock tower', 'landmark', 6.2, 10, -13);

// Row B: street buildings.
const rowB: Array<[BuildingType, number, number, number, number, string, string]> = [
  ['shop', -20.4, -4.6, 1, 0, 'Shop', 'awning'],
  ['house', -16.4, -4.6, 0, 0, 'House', 'gable + chimney'],
  ['townhouses', -10.9, -4.6, 0, 0, 'Townhouses', '×3 roofs'],
  ['cafe', -5.0, -4.3, 2, 1, 'Café', 'terrace'],
  ['dorm', 0.8, -4.6, 0, 0, 'Dorm', 'roof garden'],
];
for (const [t, x, z, wall, roof, label, sub] of rowB) {
  statics.add(place(makeBuilding(t, { wall, roof, seed: Math.round(x * 10) + 3 }), x, z));
  tag(label, sub, x, ({ shop: 1.9, house: 4.6, townhouses: 3.5, cafe: 2.0, dorm: 5.6 } as Record<string, number>)[t] ?? 3, z);
}
for (const x of [5.2, 7.4]) statics.add(place(makeStreetLamp(), x, -3.2));
tag('Lamps', 'glow at dusk', 6.3, 2.6, -3.2);

// Row C: transit.
statics.add(place(makeRoad(22), -13, 6.6));
statics.add(place(makeStop([0, 1]), -15.5, 4.3));
tag('Bus stop', 'route chips · queue', -15.5, 2.9, 4.3);
statics.add(place(makeStation(), 3.2, 3.6));
tag('Station', 'platform · clock', 1.6, 3.4, 1.4);
statics.add(place(makeStadium(), 17.6, 2.4));
tag('Stadium', 'floodlights', 17.6, 5.6, 2.4);

// Row D: the long road for vehicles.
statics.add(place(makeRoad(48), 0, 12.6));

const staticBaked = bakeGeometry(statics, state.palette);
const staticMat = new KitMaterial();
const staticMesh = new THREE.Mesh(staticBaked.geometry, staticMat);
staticMesh.castShadow = true;
staticMesh.receiveShadow = true;
stage.scene.add(staticMesh);

// ---------------------------------------------------------------- trees (instanced, swaying)
const trees: TreePlacement[] = TREE_VARIANTS.map((v, i) => ({ x: 11.5 + i * 2.6, z: -13.2, variant: v, rot: i * 0.7, leaf: i }));
const grove = [[13, -6.8], [15.2, -7.6], [17.5, -6.4], [19.8, -7.4], [21.9, -6.2], [14.2, -4.9], [21, -4.4], [-22, 1.2], [-21.5, 9.2], [10.5, 9.4], [-3.2, 9.3]];
grove.forEach(([x, z], i) => trees.push({ x: x!, z: z!, variant: [0, 1, 2, 3, 0, 4, 1, 2, 3, 4, 0][i]!, scale: 0.85 + (i % 3) * 0.12 }));
for (let i = 0; i < 7; i++) trees.push({ x: -15.5 + i * 1.05, z: -9.3, variant: 'bush', scale: 0.7 });
const forest = createForest(trees, { palette: state.palette, seed: 11 });
stage.scene.add(forest.object);
tag('Trees', '5 variants · sway', 16.7, 3.4, -13.2);

// ---------------------------------------------------------------- vehicles
const dynMat = new KitMaterial();
const bakes: Baked[] = [staticBaked];
const buses: Array<{ mesh: THREE.Mesh; x0: number; speed: number; z: number; dir: number }> = [];
const addBus = (route: number, x: number, z: number, dir: number, speed: number) => {
  const b = bakeGeometry(makeBus(route), state.palette);
  bakes.push(b);
  const m = new THREE.Mesh(b.geometry, dynMat);
  m.castShadow = m.receiveShadow = true;
  m.position.set(x, 0.06, z);
  m.rotation.y = dir > 0 ? 0 : Math.PI;
  stage.scene.add(m);
  buses.push({ mesh: m, x0: x, speed, z, dir });
};
addBus(0, -11.5, 6.0, -1, 0);           // at the stop, door facing the shelter
addBus(1, -21, 13.2, 1, 1.6);
addBus(2, -13.5, 13.2, 1, 1.6);
tag('Bus', `${BUS.length} × ${BUS.width} · ${BUS.height} tall`, -11.5, 1.9, 6.0);

const trainBaked = bakeGeometry(makeTrain(), state.palette);
bakes.push(trainBaked);
const train = new THREE.Mesh(trainBaked.geometry, dynMat);
train.castShadow = train.receiveShadow = true;
train.position.set(3.2, TRAIN.deckY, 3.6 + 1.75);
stage.scene.add(train);
tag('Train', '2 cars', 3.2, 2.5, 5.4);

// Cars: one InstancedMesh per variant, body colour per instance (palette role `car`).
const carMeshes: Array<{ mesh: THREE.InstancedMesh; cars: Array<{ x: number; z: number; dir: number; speed: number; color: number }> }> = [];
const carPlan: Array<[number, number, number, number, number]> = [ // variant, x, lane z, dir, colour
  [0, -4, 12.0, -1, 0], [1, 2.5, 12.0, -1, 1], [2, 9, 12.0, -1, 2], [0, 15.5, 12.0, -1, 3],
  [1, -2, 13.2, 1, 4], [2, 5, 13.2, 1, 5], [0, 19, 13.2, 1, 1],
];
CAR_VARIANTS.forEach((_, v) => {
  const list = carPlan.filter((c) => c[0] === v).map(([, x, z, dir, color]) => ({ x, z, dir, speed: 2.2 + (color % 3) * 0.3, color }));
  const b = bakeGeometry(makeCar(v), state.palette);
  bakes.push(b);
  const mesh = new THREE.InstancedMesh(b.geometry, dynMat, list.length);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  stage.scene.add(mesh);
  carMeshes.push({ mesh, cars: list });
});
tag('Cars', '3 variants', 9, 1.5, 12.0);

// People: 2 InstancedMeshes (body tinted by shirt colour, head).
const people: Array<{ x: number; z: number; phase: number; walk: boolean; shirt: number }> = [];
[-1.2, -0.62, -0.04, 0.54, 1.12].forEach((dx, i) => people.push({ x: -15.5 + dx, z: 4.7, phase: i, walk: false, shirt: i }));
[[9.4, -1.6], [10.1, -0.9], [8.8, -0.5], [9.8, 0.1], [10.8, -1.8], [8.6, 0.6], [10.9, 0.5]].forEach(([x, z], i) =>
  people.push({ x: x!, z: z!, phase: i * 1.7, walk: true, shirt: i + 2 }));
tag('People', '0.8 tall', 9.8, 1.6, -0.6);
const bodyB = bakeGeometry(makePersonBody(), state.palette), headB = bakeGeometry(makePersonHead(), state.palette);
bakes.push(bodyB, headB);
const bodies = new THREE.InstancedMesh(bodyB.geometry, dynMat, people.length);
const heads = new THREE.InstancedMesh(headB.geometry, dynMat, people.length);
for (const m of [bodies, heads]) { m.castShadow = m.receiveShadow = true; m.frustumCulled = false; stage.scene.add(m); }

// ---------------------------------------------------------------- palette / detail / light / quality
const col = new THREE.Color();
function recolorInstances(): void {
  const P = PALETTES[state.palette];
  for (const { mesh, cars } of carMeshes) { cars.forEach((c, i) => mesh.setColorAt(i, col.set(colorOf(P, 'car', c.color)))); if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
  people.forEach((p, i) => bodies.setColorAt(i, col.set(colorOf(P, 'shirt', p.shirt))));
  if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
}
function apply(): void {
  for (const b of bakes) { recolorBaked(b, state.palette); setBakedDetail(b, state.detail === 'toy'); }
  forest.setPalette(state.palette);
  forest.setDetail(state.detail);
  recolorInstances();
  stage.setPalette(state.palette);
  const P = PALETTES[state.palette], r = document.documentElement.style;
  r.setProperty('--ink', P.ink); r.setProperty('--paper', P.paper); r.setProperty('--accent', P.accent);
  document.body.style.background = state.light === 'dusk' ? P.duskBg : P.bg;
  document.body.classList.toggle('dusk', state.light === 'dusk');
  syncChips();
}
function syncChips(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((b) => b.classList.toggle('on', state[b.dataset.k as keyof typeof state] === b.dataset.v));
}
document.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((b) => b.addEventListener('click', () => {
  const k = b.dataset.k as keyof typeof state, v = b.dataset.v!;
  if (k === 'palette') state.palette = v as PaletteId;
  if (k === 'detail') state.detail = v as DetailMode;
  if (k === 'light') { state.light = v as LightMode; stage.setLight(state.light); }
  if (k === 'quality') { state.quality = v as Quality; stage.setQuality(state.quality); }
  apply();
}));
apply();
addEventListener('resize', () => stage.resize());

// ---------------------------------------------------------------- loop
const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), p3 = new THREE.Vector3();
const stats = document.getElementById('stats')!;
let t = 0, last = performance.now(), frames = 0, fpsT = 0, fps = 0;
const wrap = (x: number) => ((((x + BW / 2) % BW) + BW) % BW) - BW / 2;
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (anim) t += dt;
  for (const b of buses) if (b.speed) b.mesh.position.x = wrap(b.x0 + b.dir * b.speed * t);
  for (const { mesh, cars } of carMeshes) {
    cars.forEach((c, i) => {
      qt.setFromAxisAngle(up, c.dir > 0 ? 0 : Math.PI);
      m4.compose(p3.set(wrap(c.x + c.dir * c.speed * t), 0.06, c.z), qt, one);
      mesh.setMatrixAt(i, m4);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }
  train.position.x = 3.2 + Math.sin(t * 0.5) * 1.2;
  people.forEach((p, i) => {
    const s = t * 0.8 + p.phase;
    const x = p.walk ? p.x + Math.sin(s) * 0.45 : p.x;
    const y = (p.walk ? Math.abs(Math.sin(s * 6)) * 0.05 : Math.abs(Math.sin(t * 2.2 + i)) * 0.025) + (p.walk ? 0 : 0.12);
    qt.setFromAxisAngle(up, p.walk ? (Math.cos(s) > 0 ? 0 : Math.PI) : Math.PI / 2);
    m4.compose(p3.set(x, y, p.z), qt, one);
    bodies.setMatrixAt(i, m4);
    heads.setMatrixAt(i, m4);
  });
  bodies.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;

  stage.render(dt, t * 8);
  for (const { el, pos } of tags) {
    const s = stage.project(pos.x, pos.y, pos.z);
    el.style.left = `${s.x}px`;
    el.style.top = `${s.y}px`;
    el.style.display = s.visible ? '' : 'none';
  }
  frames++;
  fpsT += dt;
  if (fpsT > 0.5) { fps = Math.round(frames / fpsT); frames = 0; fpsT = 0; }
  let meshes = 0;
  stage.scene.traverseVisible((o) => { if ((o as THREE.Mesh).isMesh) meshes++; });
  stats.textContent = `${fps} fps · ${stage.quality} · ${meshes} scene draw calls · static board = 1 mesh, ${staticBaked.geometry.getAttribute('position').count.toLocaleString()} verts`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

(window as unknown as { __dev: unknown }).__dev = { stage, state, ready: true };
