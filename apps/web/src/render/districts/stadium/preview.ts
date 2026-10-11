// D4 dev-only close-up (not part of the app bundle): /src/render/districts/stadium/preview.html
//   ?view=<world units>&cx=&cz=  framing (default: the stadium block)   ?shot=stadium|central|university|loop
//   &palette=0|1|2  &people=0  &dusk=1
// Draws TOWN roads, the kit track around the loop, kit bus stops, a few queued people, a train and a bus, plus the
// stadium district's items, footpaths and ground areas, with town palette roles (like the composer's clay adapter).
import * as THREE from 'three';
import { pointAt, TOWN } from '@headway/sim';
import type { Vec2 } from '@headway/sim';
import { createBasicKit } from '../../assets/basicKit';
import { devScene } from '../../assets/devScene';
import { createRegistry } from '../../assets/index';
import type { RoleColors } from '../../assets/types';
import { makeBus, makePerson, makeStop, makeTrack, makeTrain, partOf, TRAIN } from '../../kit';
import { glowOf, PALETTES, type Role } from '../../palettes';
import { STADIUM } from '../stadium';

const q = new URLSearchParams(location.search);
const palette = Number(q.get('palette') ?? 0) as 0 | 1 | 2;
const P = PALETTES['abc'[palette] as 'a' | 'b' | 'c'];
const dusk = q.get('dusk') === '1';
const SHOTS: Record<string, [number, number, number]> = {
  stadium: [-14, 11, 34], central: [27, -6, 26], university: [-15, -18, 24], loop: [0, 0, 80], station: [-15, 18, 22],
};
const shot = SHOTS[q.get('shot') ?? 'stadium'] ?? SHOTS.stadium!;
const cx = Number(q.get('cx') ?? shot[0]), cz = Number(q.get('cz') ?? shot[1]), view = Number(q.get('view') ?? shot[2]);
const { scene, renderer, camera, loop } = devScene(view, new THREE.Vector3(cx, 0, cz));
// headless Chrome settles the viewport after load: keep the canvas and the ortho frustum in step with the window
const fit = () => {
  renderer.setSize(innerWidth, innerHeight);
  const a = innerWidth / innerHeight;
  Object.assign(camera, { left: (-view * a) / 2, right: (view * a) / 2, top: view / 2, bottom: -view / 2 });
  camera.updateProjectionMatrix();
};
addEventListener('resize', fit);
setTimeout(fit, 50);
scene.background = new THREE.Color(dusk ? P.duskBg : P.bg);
if (dusk) {
  renderer.toneMappingExposure = 0.9;
  scene.traverse((o) => {
    const l = o as THREE.Light;
    if (!l.isLight) return;
    l.intensity *= (l as THREE.HemisphereLight).isHemisphereLight ? 0.35 : 0.3;
    if ((l as THREE.DirectionalLight).isDirectionalLight) l.color.set('#FFB27A');
  });
}
/** Dusk: give glow roles (lamps, lit windows, signal lenses) an emissive colour, like the clay material does. */
function glowMat(m: THREE.Material, role: string, idx: number): THREE.Material {
  const g = dusk ? glowOf(P, role as Role, idx) : null;
  if (!g) return m;
  const c = (m as THREE.MeshStandardMaterial).clone();
  c.emissive.set(g.color); c.emissiveIntensity = g.intensity * 0.9;
  return c;
}
function duskify(o: THREE.Object3D): THREE.Object3D {
  if (!dusk) return o;
  o.traverse((n) => {
    const part = partOf(n);
    if (part && (n as THREE.Mesh).isMesh) (n as THREE.Mesh).material = glowMat((n as THREE.Mesh).material as THREE.Material, part.role, part.idx);
  });
  return o;
}

// ---- board, roads, track
const b = TOWN.bounds;
const board = new THREE.Mesh(new THREE.BoxGeometry(b.maxX - b.minX + 4, 0.6, b.maxZ - b.minZ + 4), new THREE.MeshStandardMaterial({ color: P.board, roughness: 0.9 }));
board.position.set((b.minX + b.maxX) / 2, -0.3, (b.minZ + b.maxZ) / 2); board.receiveShadow = true; scene.add(board);
const flat = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
function strip(pts: Vec2[], closed: boolean, width: number, m: THREE.Material, y: number, h = 0.04): void {
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!, c = pts[(i + 1) % pts.length]!, len = Math.hypot(c.x - a.x, c.z - a.z);
    if (len < 1e-3) continue;
    const seg = new THREE.Mesh(new THREE.BoxGeometry(len + width * 0.5, h, width), m);
    seg.position.set((a.x + c.x) / 2, y, (a.z + c.z) / 2); seg.rotation.y = -Math.atan2(c.z - a.z, c.x - a.x); seg.receiveShadow = true; scene.add(seg);
  }
}
const curb = flat(P.curb), road = flat(P.road);
for (const e of TOWN.roads.edges) strip(e.path.points, e.path.closed, 3.4, curb, 0.03, 0.06);
for (const e of TOWN.roads.edges) strip(e.path.points, e.path.closed, 2.4, road, 0.04, 0.07);
const R = TOWN.rail.loop.points;
for (let i = 0; i < R.length; i++) {
  const a = R[i]!, c = R[(i + 1) % R.length]!, len = Math.hypot(c.x - a.x, c.z - a.z);
  const t = makeTrack(len + 0.05);
  t.position.set((a.x + c.x) / 2, 0, (a.z + c.z) / 2); t.rotation.y = -Math.atan2(c.z - a.z, c.x - a.x); scene.add(t);
}

// ---- district ground: areas + paths
const areaColor: Record<string, string> = { lawn: P.lawn, plaza: '#EFE4D2', parking: '#C9CCD1', sports: P.field, garden: '#9BD3A8' };
for (const a of STADIUM.areas) {
  const shape = new THREE.Shape(a.polygon.map((p) => new THREE.Vector2(p.x, -p.z)));
  const g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, flat(areaColor[a.kind] ?? '#EFE4D2')); m.position.y = 0.012; m.receiveShadow = true; scene.add(m);
}
for (const p of STADIUM.paths) strip(p.points, false, p.width, flat(p.kind === 'plaza-edge' ? P.safety : '#EADCC6'), 0.018, 0.012);

// ---- district items (town palette roles first, like the composer's clay adapter)
const registry = createRegistry();
const roles: RoleColors = { ...registry.roles };
for (const role of Object.keys(PALETTES.a) as Array<keyof typeof PALETTES.a>) {
  if (role === 'name') continue;
  roles[role] = [PALETTES.a[role], PALETTES.b[role], PALETTES.c[role]] as RoleColors[string];
}
for (const it of STADIUM.items) {
  // per-placement seed, like the composer (stable for x/z/kind)
  const seed = (Math.abs(Math.round(it.x * 73.1 + it.z * 31.7)) + it.kind.length * 977) % 100000 + 1;
  const base = createBasicKit(roles, palette, seed);
  const cache = new Map<string, THREE.Material>();
  const kit = { ...base, mat: (role: string, idx = 0) => {
    const key = role + '#' + idx;
    if (!cache.has(key)) cache.set(key, glowMat(base.mat(role, idx), role, idx));
    return cache.get(key)!;
  } };
  scene.add(registry.build(kit, it));
}

// ---- transit: stops, queued people, a train, a bus
const routeIdx = (r: string) => ['r1', 'r2', 'r3'].indexOf(r);
for (const s of TOWN.stops) {
  const st = makeStop(s.servedRoutes.map(routeIdx));
  st.position.set(s.p.x, 0, s.p.z); st.rotation.y = Math.atan2(-s.queueDir.x, -s.queueDir.z); scene.add(duskify(st));
}
if (q.get('people') !== '0') {
  const crowd: Record<string, number> = { stop_stadium_gate: 16, stop_stadium_stn: 6, stn_stadium: 12, stn_university: 4, stn_central: 6, stop_old_main: 3, stop_university_stn: 2 };
  const lines = [
    ...TOWN.stops.map((s) => ({ id: s.id, p: s.p, d: s.queueDir })),
    ...TOWN.rail.stations.map((s) => ({ id: s.id, p: s.platform, d: s.queueDir })),
  ];
  let shirt = 0;
  for (const l of lines) {
    const n = crowd[l.id] ?? 0;
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / 8), col = i % 8;
      const side = { x: -l.d.z, z: l.d.x };
      const p = makePerson(shirt++ % 6);
      p.position.set(l.p.x + l.d.x * (0.9 + col * 0.45) + side.x * row * 0.5, 0, l.p.z + l.d.z * (0.9 + col * 0.45) + side.z * row * 0.5);
      scene.add(p);
    }
  }
}
const stn = TOWN.rail.stations.find((s) => s.id === 'stn_stadium')!;
const tp = pointAt(TOWN.rail.loop, stn.dist - 1.2);
const train = makeTrain(); train.position.set(tp.x, TRAIN.deckY, tp.z); train.rotation.y = tp.heading; scene.add(duskify(train));
const gate = TOWN.stops.find((s) => s.id === 'stop_stadium_gate')!;
const bus = makeBus(2); bus.position.set(gate.p.x + 1.4, 0.05, gate.p.z + 1.15); bus.rotation.y = Math.PI; scene.add(duskify(bus));

document.getElementById('msg')!.textContent = `stadium + rail · ${STADIUM.items.length} items · ${STADIUM.areas.length} areas · ${STADIUM.paths.length} paths`;
loop();
(window as unknown as { __ready: boolean }).__ready = true;
