// District preview: /districts-dev.html?d=campus (default: all). Roads/rail as flat strips + district items + paths/areas.
import * as THREE from 'three';
import { TOWN } from '@headway/sim';
import type { Vec2 } from '@headway/sim';
import { createBasicKit } from '../assets/basicKit';
import { createRegistry } from '../assets/index';
import { devScene } from '../assets/devScene';
import { DISTRICTS } from './index';

const msg = document.getElementById('msg')!;
const only = new URLSearchParams(location.search).get('d');
if (!TOWN.roads) {
  msg.textContent = 'TOWN not built yet (Task M in progress).';
} else {
  const ds = DISTRICTS.filter((d) => !only || d.id === only);
  const focus = only && ds[0] && 'center' in ds[0].region ? ds[0].region : null;
  const center = focus ? new THREE.Vector3(focus.center.x, 0, focus.center.z) : new THREE.Vector3();
  const { scene, loop } = devScene(focus ? Math.max(24, focus.radius * 2.4) : 64, center);
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
  for (const e of TOWN.roads.edges) strip(e.path.points, e.path.closed, 2.4, '#F4EBDD', 0.02);
  strip(TOWN.rail.loop.points, true, 1.6, '#C9B79C', 0.03);
  const registry = createRegistry();
  const kit = createBasicKit(registry.roles);
  let count = 0;
  for (const d of ds) {
    for (const p of d.paths) strip(p.points, false, p.width, '#EADCC6', 0.025);
    for (const a of d.areas) {
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
