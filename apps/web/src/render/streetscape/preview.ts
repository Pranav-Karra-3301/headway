// Owner: S1. Dev-only streetscape preview through T2.1's Stage (the real look pipeline). Not part of the app build.
//   /src/render/streetscape/preview.html?zoom=1&x=0&z=0&light=day|dusk&palette=a|b|c
//     &demo=1 (demo paths/areas while districts are stubs; default: on when no district has paths/areas)
//     &ctx=0 (no buildings) &roads=0 (no stand-in road strips) &post=0
// Stand-ins for what T2.2 will compose: board, rail track, road strips with centre dashes, stops, stations,
// base SCENERY (outside district regions) and district items.
import * as THREE from 'three';
import { stationPlacement, TOWN } from '@headway/sim';
import { createRegistry } from '../assets';
import { createBasicKit } from '../assets/basicKit';
import { DISTRICTS } from '../districts';
import {
  at, bakeGeometry, makeBoard, makeBuilding, makeClockTower, makeStadium, makeStation, makeStop, makeTree, type BuildingType,
} from '../kit';
import { KitMaterial } from '../materials';
import { Stage } from '../post';
import { SCENERY } from '../scenery';
import { makeRail, makeRoads } from '../town/network';
import type { LightMode, PaletteId } from '../types';
import { DEMO } from './demo';
import { createStreetscapeLayer, STREETSCAPE } from './index';

const q = new URLSearchParams(location.search);
const palette = (['a', 'b', 'c'].includes(q.get('palette') ?? '') ? q.get('palette') : 'a') as PaletteId;
const light = (q.get('light') === 'dusk' ? 'dusk' : 'day') as LightMode;
const b = TOWN.bounds;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const stage = new Stage(canvas, {
  palette, light, quality: 'high', bounds: b, maxHeight: 9, post: q.get('post') !== '0', autoQuality: false,
  preserveDrawingBuffer: true,
  camera: { zoom: Number(q.get('zoom') ?? 1) || 1, target: { x: Number(q.get('x') ?? 0) || 0, z: Number(q.get('z') ?? 0) || 0 } },
});

const districtsHaveGround = DISTRICTS.some((d) => d.paths.length || d.areas.length);
const useDemo = q.get('demo') === '1' || (q.get('demo') !== '0' && !districtsHaveGround);
const districts = useDemo ? [...DISTRICTS, DEMO] : DISTRICTS;

// ---------------------------------------------------------------- stand-in statics (what T2.2 will draw)
const statics = new THREE.Group();
statics.add(at(makeBoard(b.maxX - b.minX, b.maxZ - b.minZ), (b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2));
// rail + roads: T2.2's real builders (same heights as the game: road top 0.04, dashes just above)
statics.add(makeRail(TOWN));
if (q.get('roads') !== '0') statics.add(makeRoads(TOWN));
// stops: platform road-side edge on the curb, shelter away from the road
for (const s of TOWN.stops) {
  const st = makeStop(s.servedRoutes.map((r) => Number(r.slice(1)) - 1));
  const qd = s.queueDir;
  st.position.set(s.p.x + qd.x * 0.95, 0, s.p.z + qd.z * 0.95);
  st.rotation.y = Math.atan2(-qd.x, -qd.z);
  statics.add(st);
}
const ctx = q.get('ctx') !== '0';
if (ctx) {
  const inDistrict = (x: number, z: number) => districts.some((d) => d.items.length && ('center' in d.region
    ? Math.hypot(x - d.region.center.x, z - d.region.center.z) < d.region.radius : false));
  for (const it of SCENERY) {
    if (it.kind !== 'station' && inDistrict(it.x, it.z)) continue;
    let o: THREE.Object3D | null = null;
    if (it.kind === 'station' && it.stationId) {
      const p = stationPlacement(it.stationId);
      o = makeStation({ track: false }); o.position.set(p.x, 0, p.z); o.rotation.y = p.rot; statics.add(o); continue;
    }
    if (it.kind === 'small' || it.kind === 'tall' || it.kind === 'hall') o = makeBuilding((it.building ?? it.kind) as BuildingType, { wall: it.wall, roof: it.roof, seed: Math.round(it.x * 10 + it.z) });
    else if (it.kind === 'clockTower') o = makeClockTower();
    else if (it.kind === 'stadium') o = makeStadium();
    else if (it.kind === 'tree') o = makeTree(it.variant ?? 0, it.leaf ?? 0);
    if (!o) continue;
    o.position.set(it.x, 0, it.z); o.rotation.y = it.rot ?? 0;
    if (it.scale) o.scale.setScalar(it.scale);
    statics.add(o);
  }
  const registry = createRegistry();
  const kit = createBasicKit(registry.roles);
  for (const d of districts) for (const it of d.items) statics.add(registry.build(kit, it));
}
const baked = bakeGeometry(statics, palette);
const mesh = new THREE.Mesh(baked.geometry, new KitMaterial());
mesh.castShadow = mesh.receiveShadow = true;
stage.scene.add(mesh);

// ---------------------------------------------------------------- the streetscape
const t0 = performance.now();
const layer = createStreetscapeLayer(TOWN, districts);
const ms = performance.now() - t0;
layer.setPalette?.(palette);
stage.scene.add(layer.object);
let tris = 0;
layer.object.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) tris += (m.geometry.index?.count ?? 0) / 3; });
const msg = document.getElementById('msg')!;
msg.textContent = `streetscape · ${Math.round(tris).toLocaleString()} tris · built in ${ms.toFixed(0)} ms · ${(layer.object.userData.crossings as unknown[]).length} crossings · ${useDemo ? 'demo ground' : 'district ground'} · walk ${STREETSCAPE.walk} u`;

// Render a handful of frames (headless screenshots run on a software rasteriser), then only on interaction.
let frames = Number(q.get('frames') ?? 6) || 6;
let last = performance.now();
const tick = () => {
  const t = performance.now();
  stage.render(Math.min(0.05, (t - last) / 1000));
  last = t;
  if (--frames > 0) requestAnimationFrame(tick);
};
const wake = () => { if (frames <= 0) { frames = 30; last = performance.now(); requestAnimationFrame(tick); } else frames = Math.max(frames, 30); };
stage.rig.controls?.addEventListener('change', wake);
addEventListener('resize', () => { stage.resize(); wake(); });
requestAnimationFrame(tick);
(window as unknown as { __streetscapeReady: boolean }).__streetscapeReady = true;
