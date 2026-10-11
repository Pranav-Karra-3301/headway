// World preview: /world-dev.html?elev=35&az=45&view=80&light=day — town roads/rail/districts (basic kit) + the world layer.
import * as THREE from 'three';
import { TOWN } from '@headway/sim';
import type { SimSnapshot, Vec2 } from '@headway/sim';
import { createBasicKit } from '../assets/basicKit';
import { createRegistry } from '../assets/index';
import { kenneyIdsFor, preloadKenney } from '../assets/kenney';
import { DISTRICTS } from '../districts/index';
import type { LightMode } from '../types';
import { createWorldLayer } from './index';

const q = new URLSearchParams(location.search);
const elev = (Number(q.get('elev') ?? 35) * Math.PI) / 180;
const az = (Number(q.get('az') ?? 45) * Math.PI) / 180;
const view = Number(q.get('view') ?? 100);
const light = (q.get('light') === 'dusk' ? 'dusk' : 'day') as LightMode;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(light === 'dusk' ? '#2B3150' : '#DDEFE5');
const a = innerWidth / innerHeight;
const camera = new THREE.OrthographicCamera((-view * a) / 2, (view * a) / 2, view / 2, -view / 2, 0.1, 2000);
const r = 400;
camera.position.set(r * Math.cos(elev) * Math.sin(az), r * Math.sin(elev), r * Math.cos(elev) * Math.cos(az));
camera.lookAt(0, 0, 0);
scene.add(new THREE.HemisphereLight(0xffffff, 0xb9c4b0, light === 'dusk' ? 0.5 : 1.5));
const sun = new THREE.DirectionalLight(light === 'dusk' ? 0xffb07a : 0xfff1dc, light === 'dusk' ? 0.8 : 2.1);
sun.position.set(-40, 90, 60); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 110, bottom: -110, near: 1, far: 400 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
scene.add(sun);
const msg = document.getElementById('msg')!;
if (!TOWN.roads) {
  msg.textContent = 'TOWN not built yet.';
} else {
  const strip = (pts: Vec2[], closed: boolean, width: number, color: string, y: number) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const p = pts[i]!, c = pts[(i + 1) % pts.length]!, len = Math.hypot(c.x - p.x, c.z - p.z);
      if (len < 1e-3) continue;
      const seg = new THREE.Mesh(new THREE.BoxGeometry(len + width * 0.5, 0.04, width), m);
      seg.position.set((p.x + c.x) / 2, y, (p.z + c.z) / 2); seg.rotation.y = -Math.atan2(c.z - p.z, c.x - p.x); seg.receiveShadow = true; scene.add(seg);
    }
  };
  const b = TOWN.bounds;
  const board = new THREE.Mesh(new THREE.BoxGeometry(b.maxX - b.minX, 0.6, b.maxZ - b.minZ), new THREE.MeshStandardMaterial({ color: '#A8D8B9', roughness: 0.9 }));
  board.position.set((b.minX + b.maxX) / 2, -0.3, (b.minZ + b.maxZ) / 2); board.receiveShadow = true; scene.add(board);
  for (const e of TOWN.roads.edges) strip(e.path.points, e.path.closed, 2.4, '#515566', 0.02);
  strip(TOWN.rail.loop.points, true, 1.6, '#C9B79C', 0.03);
  const registry = createRegistry();
  await preloadKenney(kenneyIdsFor(DISTRICTS.flatMap((d) => d.items.map((it) => it.kind)))); // Kenney-backed builders need their models first
  const kit = createBasicKit(registry.roles);
  for (const d of DISTRICTS) for (const it of d.items) scene.add(registry.build(kit, it));
  const world = createWorldLayer(TOWN);
  world.setLight?.(light);
  scene.add(world.object);
  const empty = { t: 0, phase: 'running', vehicles: [], people: [], queues: [], running: { spawned: 0, completed: 0, waitingNow: 0, ridingNow: 0, meanWaitS: 0, missedConnections: 0, leftBehind: 0, jSoFar: 0 }, events: [] } as unknown as SimSnapshot;
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    world.update({ prev: empty, next: empty, alpha: 1, simT: 0, dtS: dt, timeS: clock.elapsedTime, map: TOWN, camera, light, highlightedRoute: null });
    renderer.render(scene, camera);
  });
  msg.textContent = `elev ${q.get('elev') ?? 35}° · az ${q.get('az') ?? 45}° · view ${view}`;
}
(window as unknown as { __worldReady: boolean }).__worldReady = true;
