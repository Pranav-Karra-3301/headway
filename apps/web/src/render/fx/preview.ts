// Owner: T2.4. Dev-only preview of the town FX (not in the app bundle): /src/render/fx/preview.html
//   ?light=day|dusk &palette=a|b|c &hl=r1|r2|r3 &t=<sim start s> &speed=8 &burst=1 (closing time ~6 s after load)
//   &models=a4|kit (A4 clock tower + stadium as district items, default a4) &zoom=1 &x=0 &z=0 &post=0 &labels=0
// A stand-in town (roads, rail, base scenery on the kit, buses from the stub sim) so the FX can be judged in place.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createStubSim, pointAt, ROAD_WIDTH, TOWN, type Polyline, type RouteId, type SimSnapshot } from '@headway/sim';
import { SimRunner } from '../../sim/runner';
import { frame } from '../../state/frame';
import { createRegistry } from '../assets';
import type { KitContext, PlacedAsset } from '../assets/types';
import type { DistrictScenery } from '../districts/types';
import {
  bakeGeometry, createForest, makeBoard, makeBuilding, makeBus, makeClockTower, makeLawn, makeStadium, makeStation, makeTrain,
  recolorBaked, type Baked, type BuildingType, type TreePlacement,
} from '../kit';
import { KitMaterial } from '../materials';
import { PALETTES, type Palette } from '../palettes';
import { Stage } from '../post';
import { SCENERY, type SceneryItem } from '../scenery';
import type { LightMode, PaletteId } from '../types';
import { keptScenery } from './anchors';
import { createTownFx } from './layer';
import { offsetPath } from './ribbons';

const q = new URLSearchParams(location.search);
const pick = <T extends string>(k: string, ok: readonly T[], d: T): T => (ok.includes(q.get(k) as T) ? (q.get(k) as T) : d);
const state = {
  light: pick<LightMode>('light', ['day', 'dusk'], 'day'),
  palette: pick<PaletteId>('palette', ['a', 'b', 'c'], 'a'),
  hl: pick<'' | RouteId>('hl', ['', 'r1', 'r2', 'r3'], ''),
};
const models = pick<'a4' | 'kit'>('models', ['a4', 'kit'], 'a4');
const speed = Number(q.get('speed') ?? 8) || 8;
if (q.get('labels') === '0') document.body.classList.add('nolabels');

// ---------------------------------------------------------------- stage
const canvas = document.getElementById('c') as HTMLCanvasElement;
const stage = new Stage(canvas, {
  palette: state.palette, light: state.light, bounds: TOWN.bounds, maxHeight: 9, post: q.get('post') !== '0',
  autoQuality: false, preserveDrawingBuffer: true,
  camera: { zoom: Number(q.get('zoom') ?? 1) || 1, target: { x: Number(q.get('x') ?? 0) || 0, z: Number(q.get('z') ?? 0) || 0 } },
});

// ---------------------------------------------------------------- a stand-in town (baked, KitMaterial)
const roleMat = new Map<string, THREE.MeshStandardMaterial>();
function tagged(role: string, idx = 0): THREE.MeshStandardMaterial {
  const key = `${role}#${idx}`;
  let m = roleMat.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial({ color: '#cccccc' }); m.name = key; m.userData.role = role; m.userData.idx = idx; roleMat.set(key, m); }
  return m;
}
function strip(poly: Polyline, half: number, y: number, role: string): THREE.Mesh {
  const l = offsetPath(poly, -half), r = offsetPath(poly, half), n = poly.points.length;
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i < n; i++) pos.push(l.points[i]!.x, y, l.points[i]!.z, r.points[i]!.x, y, r.points[i]!.z);
  const segs = poly.closed ? n : n - 1;
  for (let i = 0; i < segs; i++) { const a = i * 2, b = ((i + 1) % n) * 2; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, tagged(role));
  m.receiveShadow = true;
  return m;
}
const place = <T extends THREE.Object3D>(o: T, x: number, z: number, rot = 0): T => { o.position.set(x, 0, z); o.rotation.y = rot; return o; };

/** Role-tagged KitContext so A4 builders bake with palette colours + dusk glow (a stand-in for T2.2's adapter). */
function roleKit(seed: number): KitContext {
  let s = seed >>> 0 || 1;
  const sh = <T extends THREE.Mesh>(m: T): T => { m.castShadow = true; m.receiveShadow = true; return m; };
  return {
    mat: (role, idx = 0) => tagged(role, idx),
    rbox: (w, h, d, r, m) => sh(new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.max(0.005, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3))), m)),
    cyl: (rt, rb, h, m, seg = 16) => sh(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m)),
    sphere: (r, m, seg = 16) => sh(new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(8, seg * 0.75)), m)),
    cone: (r, h, m, seg = 16) => sh(new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), m)),
    detail(o) { o.userData.detail = true; return o; },
    rand() { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; },
  };
}

const registry = createRegistry();
const tower = SCENERY.find((it) => it.kind === 'clockTower')!;
const stadium = SCENERY.find((it) => it.kind === 'stadium')!;
const districts: DistrictScenery[] = models === 'a4'
  ? [
    { id: 'campus', region: { center: { x: tower.x, z: tower.z }, radius: 1.5 }, items: [{ kind: 'lm.clockTower', x: tower.x, z: tower.z, rot: tower.rot ?? 0, params: { hands: false } }], paths: [], areas: [] },
    { id: 'stadium', region: { center: { x: stadium.x, z: stadium.z }, radius: 2 }, items: [{ kind: 'lm.stadium', x: stadium.x, z: stadium.z, rot: stadium.rot ?? 0 }], paths: [], areas: [] },
  ]
  : [];
const sources = { scenery: SCENERY, districts };

const statics = new THREE.Group();
statics.add(makeBoard(TOWN.bounds.maxX - TOWN.bounds.minX, TOWN.bounds.maxZ - TOWN.bounds.minZ));
for (const e of TOWN.roads.edges) statics.add(strip(e.path, ROAD_WIDTH / 2, 0.06, 'road'));
for (const n of TOWN.roads.nodes) {
  const d = new THREE.Mesh(new THREE.CylinderGeometry(ROAD_WIDTH / 2, ROAD_WIDTH / 2, 0.06, 24), tagged('road'));
  d.position.set(n.p.x, 0.03, n.p.z); d.receiveShadow = true; statics.add(d);
}
statics.add(strip(TOWN.rail.loop, 0.95, 0.04, 'ballast'));
for (const s of [-0.36, 0.36]) statics.add(strip(offsetPathAsPoly(TOWN.rail.loop, s), 0.045, 0.13, 'rail'));
{
  const L = TOWN.rail.loop.length, n = Math.floor(L / 0.7);
  const ties = new THREE.InstancedMesh(new THREE.BoxGeometry(0.28, 0.06, 1.25), tagged('ties'), n);
  const m = new THREE.Matrix4(), qq = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  for (let i = 0; i < n; i++) { const a = pointAt(TOWN.rail.loop, (i * L) / n); ties.setMatrixAt(i, m.compose(p.set(a.x, 0.08, a.z), qq.setFromAxisAngle(up, a.heading), one)); }
  statics.add(ties);
}
function offsetPathAsPoly(poly: Polyline, d: number): Polyline {
  const o = offsetPath(poly, d);
  return { points: o.points, cum: o.cum, length: o.length, closed: poly.closed };
}

const trees: TreePlacement[] = [];
for (const it of keptScenery(SCENERY, districts) as SceneryItem[]) {
  const rot = it.rot ?? 0;
  if (it.kind === 'tree') trees.push({ x: it.x, z: it.z, variant: it.variant ?? 0, leaf: it.leaf ?? 0, scale: it.scale ?? 1 });
  else if (it.kind === 'lawn') { const g = new THREE.Group(); g.add(makeLawn(it.w ?? 2, it.d ?? 2)); statics.add(place(g, it.x, it.z)); }
  else if (it.kind === 'clockTower') statics.add(place(makeClockTower({ hands: false }), it.x, it.z, rot));
  else if (it.kind === 'stadium') statics.add(place(makeStadium(), it.x, it.z, rot));
  else if (it.kind === 'station') statics.add(place(makeStation({ hands: false }), it.x, it.z, rot));
  else statics.add(place(makeBuilding((it.building ?? it.kind) as BuildingType, { wall: it.wall ?? 0, roof: it.roof ?? 0, seed: Math.round(it.x * 10 + it.z) }), it.x, it.z, rot));
}
const kit = roleKit(7);
for (const d of districts) for (const it of d.items as PlacedAsset[]) statics.add(registry.build(kit, it));
const palIdx = (p: Palette) => (p === PALETTES.b ? 1 : p === PALETTES.c ? 2 : 0);
const resolve = (role: string, idx: number, p: Palette): string | undefined => {
  const v = registry.roles[role]?.[palIdx(p)];
  return Array.isArray(v) ? v[idx % v.length] : v;
};
const bakes: Baked[] = [bakeGeometry(statics, state.palette, { resolve })];
const staticMesh = new THREE.Mesh(bakes[0]!.geometry, new KitMaterial());
staticMesh.castShadow = staticMesh.receiveShadow = true;
stage.scene.add(staticMesh);
const forest = createForest(trees, { palette: state.palette, seed: 5 });
stage.scene.add(forest.object);

// ---------------------------------------------------------------- sim (stub) → buses + train, and the FX layer
const instance = { scenarioId: 'stadium_exit', seed: 11, split: 'showcase' as const };
const runner = new SimRunner(() => createStubSim({ map: TOWN, scenario: instance }), speed as 1 | 4 | 8 | 16);
const closeT = runner.sim.observe().scenario.advertised.find((a) => a.kind === 'stadium_closing')?.t ?? 600;
const t0 = q.get('burst') === '1' ? closeT - speed * 6.2 : Number(q.get('t') ?? 300) || 0;
while (runner.sim.t < t0 && !runner.sim.done) runner.sim.step();
runner.next = runner.prev = runner.sim.snapshot();
frame.runner = runner; // the FX read clockStart + advertised closing time from here (as in the app)

const busMat = new KitMaterial();
const busBakes = TOWN.routes.map((_, i) => bakeGeometry(makeBus(i), state.palette));
const trainBake = bakeGeometry(makeTrain(), state.palette);
bakes.push(...busBakes, trainBake);
const vehicleMeshes = new Map<string, THREE.Mesh>();
function vehicle(id: string, geo: THREE.BufferGeometry): THREE.Mesh {
  let m = vehicleMeshes.get(id);
  if (!m) { m = new THREE.Mesh(geo, busMat); m.castShadow = m.receiveShadow = true; stage.scene.add(m); vehicleMeshes.set(id, m); }
  return m;
}
function placeVehicles(prev: SimSnapshot, next: SimSnapshot, alpha: number): void {
  for (const v of next.vehicles) {
    const pv = prev.vehicles.find((x) => x.id === v.id);
    const path = v.path.kind === 'route' ? TOWN.routes.find((r) => r.id === (v.path as { routeId: RouteId }).routeId)?.path : v.path.kind === 'rail' ? TOWN.rail.loop : undefined;
    if (!path) continue;
    let d0 = pv && pv.path.kind === v.path.kind ? pv.dist : v.dist;
    if (Math.abs(v.dist - d0) > path.length / 2) d0 += v.dist > d0 ? path.length : -path.length;
    const a = pointAt(path, d0 + (v.dist - d0) * alpha);
    const ri = TOWN.routes.findIndex((r) => r.id === v.routeId);
    const m = vehicle(v.id, v.kind === 'train' ? trainBake.geometry : busBakes[Math.max(0, ri)]!.geometry);
    const lane = v.kind === 'bus' ? 0.6 : 0;
    m.position.set(a.x + Math.sin(a.heading) * lane, v.kind === 'train' ? 0.16 : 0.06, a.z + Math.cos(a.heading) * lane);
    m.rotation.y = a.heading;
  }
}

const fx = createTownFx(TOWN, { sources, palette: state.palette });
stage.scene.add(fx.object);

// ---------------------------------------------------------------- UI
const sub = document.getElementById('sub')!;
function apply(): void {
  for (const b of bakes) recolorBaked(b, state.palette);
  forest.setPalette(state.palette);
  fx.setPalette?.(state.palette);
  stage.setPalette(state.palette);
  stage.setLight(state.light);
  fx.setLight?.(state.light);
  document.body.classList.toggle('dusk', state.light === 'dusk');
  document.body.style.background = state.light === 'dusk' ? PALETTES[state.palette].duskBg : PALETTES[state.palette].bg;
  sub.textContent = `town fx · ${state.light} · palette ${state.palette}${state.hl ? ` · ${state.hl} highlighted` : ''}`;
  document.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((b) => b.classList.toggle('on', state[b.dataset.k as keyof typeof state] === b.dataset.v));
}
document.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((b) => b.addEventListener('click', () => {
  const k = b.dataset.k as keyof typeof state;
  (state as Record<string, string>)[k] = b.dataset.v!;
  apply();
}));
document.getElementById('burst')!.addEventListener('click', () => {
  if (runner.sim.t > closeT) runner.reset(() => createStubSim({ map: TOWN, scenario: instance }));
  while (runner.sim.t < closeT - speed * 1.5 && !runner.sim.done) runner.sim.step();
  runner.next = runner.prev = runner.sim.snapshot();
});
apply();
stage.setLight(state.light, true);
addEventListener('resize', () => stage.resize());

// ---------------------------------------------------------------- loop
const clockEl = document.getElementById('clock')!, stats = document.getElementById('stats')!;
const [hh, mm] = runner.sim.observe().scenario.clockStart.split(':').map(Number);
const startMin = hh! * 60 + mm!;
const fmt = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
let last = performance.now(), timeS = 0, frames = 0, fpsT = 0, fps = 0;
function loop(now: number): void {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  timeS += dt;
  runner.frame(dt);
  placeVehicles(runner.prev, runner.next, runner.alpha);
  fx.update({ prev: runner.prev, next: runner.next, alpha: runner.alpha, simT: runner.simT, dtS: dt, timeS, map: TOWN, camera: stage.camera, light: state.light, highlightedRoute: state.hl || null });
  stage.render(dt, runner.simT);
  clockEl.textContent = `${fmt(startMin + runner.simT / 60)}  ·  stadium closes ${fmt(startMin + closeT / 60)}`;
  frames++; fpsT += dt;
  if (fpsT > 0.5) { fps = Math.round(frames / fpsT); frames = 0; fpsT = 0; }
  let calls = 0;
  fx.object.traverseVisible((o) => { if ((o as THREE.Mesh).isMesh) calls++; });
  stats.textContent = `${fps} fps · fx draw calls ${calls} · ${fx.anchors.clockFaces.length} clock faces · ${fx.kerb.length + fx.anchors.lamps.length} lamps · ${fx.anchors.stadiums.length} stadium`;
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
(window as unknown as { __fx: unknown }).__fx = { stage, fx, runner, ready: true };
