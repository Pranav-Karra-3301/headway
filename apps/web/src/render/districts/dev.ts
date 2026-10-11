// District preview: /districts-dev.html?d=campus (default: all; &view=30&cx=0&cz=0 for close-ups;
// &street=0 for flat path/area stand-ins instead of S1's streetscape). Roads/rail as flat strips + district items + paths/areas.
import * as THREE from 'three';
import { TOWN } from '@headway/sim';
import type { Vec2 } from '@headway/sim';
import { createBasicKit } from '../assets/basicKit';
import { createRegistry } from '../assets/index';
import { kenneyIdsFor, preloadKenney } from '../assets/kenney';
import { devScene } from '../assets/devScene';
import { createStreetscapeLayer } from '../streetscape/index';
import { DISTRICTS } from './index';

const msg = document.getElementById('msg')!;
const only = new URLSearchParams(location.search).get('d');
if (!TOWN.roads) {
  msg.textContent = 'TOWN not built yet (Task M in progress).';
} else {
  const ds = DISTRICTS.filter((d) => !only || d.id === only);
  const focus = only && ds[0] && 'center' in ds[0].region ? ds[0].region : null;
  // close-ups of the whole town: &view=<ortho height in u>&cx=<x>&cz=<z>
  const qs = new URLSearchParams(location.search), num = (k: string) => (qs.has(k) ? Number(qs.get(k)) : NaN);
  const center = Number.isFinite(num('cx')) ? new THREE.Vector3(num('cx'), 0, num('cz') || 0)
    : focus ? new THREE.Vector3(focus.center.x, 0, focus.center.z) : new THREE.Vector3();
  const { scene, loop } = devScene(num('view') > 0 ? num('view') : focus ? Math.max(24, focus.radius * 2.4) : 64, center);
  const b = TOWN.bounds;
  const board = new THREE.Mesh(new THREE.BoxGeometry(b.maxX - b.minX + 4, 0.6, b.maxZ - b.minZ + 4), new THREE.MeshStandardMaterial({ color: '#A8D8B9', roughness: 0.9 }));
  board.position.set((b.minX + b.maxX) / 2, -0.3, (b.minZ + b.maxZ) / 2); board.receiveShadow = true; scene.add(board);
  const strip = (pts: Vec2[], closed: boolean, width: number, color: string, y: number) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i]!, c = pts[(i + 1) % pts.length]!, len = Math.hypot(c.x - a.x, c.z - a.z);
      if (len < 1e-3) continue;
      const seg = new THREE.Mesh(new THREE.BoxGeometry(len + width * 0.5, 0.04, width), m);
      seg.position.set((a.x + c.x) / 2, y, (a.z + c.z) / 2); seg.rotation.y = -Math.atan2(c.z - a.z, c.x - a.x); seg.receiveShadow = true; scene.add(seg);
    }
  };
  for (const e of TOWN.roads.edges) strip(e.path.points, e.path.closed, 2.4, '#515566', 0.02);
  // rail: ballast + two steel rails, only over the board (the world layer carries it off-board)
  const onBoard = (p: Vec2) => p.x >= b.minX - 2 && p.x <= b.maxX + 2 && p.z >= b.minZ - 2 && p.z <= b.maxZ + 2;
  const railRuns: Vec2[][] = [];
  const R = TOWN.rail.loop.points;
  for (let i = 0; i <= R.length; i++) {
    const p = R[i % R.length]!;
    if (!onBoard(p)) { railRuns.push([]); continue; }
    if (!railRuns.length) railRuns.push([]);
    railRuns[railRuns.length - 1]!.push(p);
  }
  const offset = (pts: Vec2[], d: number): Vec2[] => pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]!, c = pts[Math.min(pts.length - 1, i + 1)]!, l = Math.hypot(c.x - a.x, c.z - a.z) || 1;
    return { x: p.x - ((c.z - a.z) / l) * d, z: p.z + ((c.x - a.x) / l) * d };
  });
  for (const run of railRuns.filter((r) => r.length > 1)) {
    strip(run, false, 1.5, '#B4A592', 0.03);
    for (const d of [-0.32, 0.32]) strip(offset(run, d), false, 0.09, '#6E7480', 0.06);
  }
  // &street=0: flat stand-ins for paths/areas instead of S1's streetscape (sidewalks, zebras, flagstones, beds)
  const street = new URLSearchParams(location.search).get('street') !== '0';
  if (street) scene.add(createStreetscapeLayer(TOWN, ds).object);
  const registry = createRegistry();
  await preloadKenney(kenneyIdsFor(ds.flatMap((d) => d.items.map((it) => it.kind)))); // Kenney-backed builders need their models first
  const kit = createBasicKit(registry.roles);
  let count = 0;
  for (const d of ds) {
    if (!street) for (const p of d.paths) strip(p.points, false, p.width, '#EADCC6', 0.025);
    if (!street) for (const a of d.areas) {
      const shape = new THREE.Shape(a.polygon.map((p) => new THREE.Vector2(p.x, -p.z)));
      const g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI / 2);
      const col = { lawn: '#8FCB9B', plaza: '#EFE4D2', parking: '#C9CCD1', sports: '#6FC07F', garden: '#9BD3A8' }[a.kind];
      const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: col, roughness: 0.95 })); mesh.position.y = 0.015; mesh.receiveShadow = true; scene.add(mesh);
    }
    for (const it of d.items) { scene.add(registry.build(kit, it)); count++; }
  }
  msg.textContent = `${only ?? 'all districts'} · ${count} items`;
  loop();
}
(window as unknown as { __districtsReady: boolean }).__districtsReady = true;
