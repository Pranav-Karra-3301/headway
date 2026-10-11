// Owner: E1. Terrain preview: /src/render/world/terrain/preview.html?elev=35&az=45&view=100&x=-4&z=-6&light=day|dusk
// &palette=a|b|c&train=30,40&post=1&clean=1&shadow=board|world&frames=N — the town blockout (board, roads, rail, stations,
// base scenery) baked into one mesh, a stand-in lake + beach, and the terrain layer, through the real Stage look.
import * as THREE from 'three';
import { pointAt, stationPlacement, TOWN } from '@headway/sim';
import type { Vec2 } from '@headway/sim';
import { bakeGeometry, box, createForest, makeBuilding, makeClockTower, makeStadium, makeStation, makeTrain, TRAIN, type BuildingType, type TreePlacement } from '../../kit';
import { KitMaterial } from '../../materials';
import { PALETTES } from '../../palettes';
import { Stage } from '../../post';
import { SCENERY } from '../../scenery';
import type { LightMode, PaletteId } from '../../types';
import { worldLayout } from '../layout';
import { WATER_LEVEL } from './field';
import { createTerrainLayer } from './index';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.get(k) !== null && q.get(k) !== '' ? Number(q.get(k)) : d);
const elev = num('elev', 35.26), az = num('az', 45), view = num('view', 100);
const light: LightMode = q.get('light') === 'dusk' ? 'dusk' : 'day';
const palette = (['a', 'b', 'c'].includes(q.get('palette') ?? '') ? q.get('palette') : 'a') as PaletteId;
const tx = num('x', -4), tz = num('z', -6);
if (q.get('clean') === '1') document.body.classList.add('clean');
document.getElementById('sub')!.textContent = `E1 · terrain · elev ${elev}° · az ${az}° · view ${view} · ${PALETTES[palette].name} · ${light}`;

const B = TOWN.bounds;
const layout = worldLayout(TOWN);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const stage = new Stage(canvas, {
  palette, light, bounds: B, maxHeight: 10, post: q.get('post') !== '0', autoQuality: false, preserveDrawingBuffer: true,
  camera: { view, interactive: false, bounds: undefined },
});
if (q.get('shadow') === 'world') stage.lights.fit(layout.extent, 24);
const cam = stage.camera;
const el = (elev * Math.PI) / 180, a = (az * Math.PI) / 180;
cam.position.set(tx, 0, tz).addScaledVector(new THREE.Vector3(Math.cos(el) * Math.sin(a), Math.sin(el), Math.cos(el) * Math.cos(a)), 320);
cam.lookAt(tx, 0, tz);
cam.near = 1;
cam.far = 1000;
cam.updateProjectionMatrix();

// ---------------------------------------------------------------- town blockout (one baked mesh)
const statics = new THREE.Group();
const slab = box(B.maxX - B.minX, 1, B.maxZ - B.minZ, 'board');
slab.position.set((B.minX + B.maxX) / 2, -0.5, (B.minZ + B.maxZ) / 2);
statics.add(slab);
const strip = (pts: Vec2[], closed: boolean, w: number, h: number, y: number, role: 'road' | 'ballast' | 'rail', off = 0) => {
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const p = pts[i]!, c = pts[(i + 1) % pts.length]!, len = Math.hypot(c.x - p.x, c.z - p.z);
    if (len < 1e-3) continue;
    const nx = -(c.z - p.z) / len, nz = (c.x - p.x) / len;
    const m = box(len + (role === 'rail' ? 0.02 : w * 0.5), h, w, role);
    m.position.set((p.x + c.x) / 2 + nx * off, y, (p.z + c.z) / 2 + nz * off);
    m.rotation.y = -Math.atan2(c.z - p.z, c.x - p.x);
    statics.add(m);
  }
};
for (const e of TOWN.roads.edges) strip(e.path.points, false, 2.4, 0.04, 0.02, 'road');
strip(TOWN.rail.loop.points, true, 1.8, 0.1, 0.05, 'ballast');
for (const o of [-0.45, 0.45]) strip(TOWN.rail.loop.points, true, 0.09, 0.09, 0.21, 'rail', o);
for (const s of TOWN.rail.stations) {
  const p = stationPlacement(s.id);
  const g = makeStation({ track: false });
  g.position.set(p.x, 0, p.z);
  g.rotation.y = p.rot;
  statics.add(g);
}
const trees: TreePlacement[] = [];
for (const it of SCENERY) {
  if (it.kind === 'tree') { trees.push({ x: it.x, z: it.z, variant: it.variant ?? 0, scale: it.scale ?? 1, leaf: it.leaf ?? 0 }); continue; }
  if (it.kind === 'lawn' || it.kind === 'station') continue;
  const g = it.kind === 'clockTower' ? makeClockTower() : it.kind === 'stadium' ? makeStadium()
    : makeBuilding((it.building ?? it.kind) as BuildingType, { wall: it.wall ?? 0, roof: it.roof ?? 0, seed: Math.round(it.x * 10 + it.z) });
  g.position.set(it.x, 0, it.z);
  g.rotation.y = it.rot ?? 0;
  statics.add(g);
}
// trains (to check the tunnel): ?train=dist,dist
for (const d of (q.get('train') ?? '').split(',').filter(Boolean).map(Number)) {
  const p = pointAt(TOWN.rail.loop, d);
  const t = makeTrain();
  t.position.set(p.x, TRAIN.deckY, p.z);
  t.rotation.y = p.heading;
  statics.add(t);
}
const town = new THREE.Mesh(bakeGeometry(statics, palette).geometry, new KitMaterial());
town.castShadow = town.receiveShadow = true;
stage.scene.add(town);
const forest = createForest(trees, { palette, seed: 5 });
stage.scene.add(forest.object);

// ---------------------------------------------------------------- stand-in lake + beach (E2 owns the real ones)
const E = layout.extent;
const lake = new THREE.Mesh(new THREE.PlaneGeometry(E.maxX - E.minX, E.maxZ - E.minZ), new THREE.MeshStandardMaterial({ color: '#7CC6D6', roughness: 0.35 }));
lake.rotation.x = -Math.PI / 2;
lake.position.set((E.minX + E.maxX) / 2, WATER_LEVEL, (E.minZ + E.maxZ) / 2);
stage.scene.add(lake);
const sandMat = new THREE.MeshStandardMaterial({ color: '#EFE3C6', roughness: 0.95 });
const south = new THREE.Mesh(new THREE.BoxGeometry(B.maxX - B.minX + 12, 0.8, 4), sandMat);
south.position.set((B.minX + B.maxX) / 2 + 2, -0.44, B.maxZ + 2);
const east = new THREE.Mesh(new THREE.BoxGeometry(4, 0.8, B.maxZ - B.minZ + 12), sandMat);
east.position.set(B.maxX + 2, -0.44, (B.minZ + B.maxZ) / 2 - 2);
stage.scene.add(south, east);

// ---------------------------------------------------------------- the terrain layer
const t0 = performance.now();
const terrain = createTerrainLayer(TOWN, layout);
terrain.setPalette?.(palette);
const buildMs = performance.now() - t0;
stage.scene.add(terrain.object);
let calls = 0;
terrain.object.traverse((o) => { if ((o as THREE.Mesh).isMesh) calls++; });
console.info(`[terrain] built in ${buildMs.toFixed(0)} ms, ${calls} draw calls`);

// ?frames=N stops after N frames (headless screenshots with SwiftShader stay fast)
const maxFrames = num('frames', Infinity);
const clock = new THREE.Clock();
let frames = 0;
const loop = () => {
  stage.render(Math.min(clock.getDelta(), 1 / 30), 0);
  frames++;
  if (frames === Math.min(30, maxFrames)) (window as unknown as { __terrainReady: boolean }).__terrainReady = true;
  if (frames < maxFrames) requestAnimationFrame(loop);
};
loop();
addEventListener('resize', () => stage.resize());
