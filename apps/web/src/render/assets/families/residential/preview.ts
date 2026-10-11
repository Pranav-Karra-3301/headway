// Owner: A3. Dev-only art-direction page for the residential family (not part of the app build):
//   /src/render/assets/families/residential/preview.html                     a small street vignette
//   ...?kind=res.house&n=8                                                   seeded variants of one kind
//   ...&palette=b|c  &zoom=<view size>  &cx=<x>&cz=<z>  &detail=min  &rot=<quarter turns>
// Colours resolve like the composer: town palette role first, then the family ROLES; clay material tweak on.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { devScene } from '../../devScene';
import { createRegistry } from '../../index';
import type { KitContext, PlacedAsset } from '../../types';
import { applyClay } from '../../../materials';
import { PALETTES } from '../../../palettes';

const q = new URLSearchParams(location.search);
const pal = (['a', 'b', 'c'].includes(q.get('palette') ?? '') ? q.get('palette') : 'a') as 'a' | 'b' | 'c';
const registry = createRegistry();
const P = PALETTES[pal] as unknown as Record<string, string | string[]>;
const pi = { a: 0, b: 1, c: 2 }[pal];

const mats = new Map<string, THREE.Material>();
function colour(role: string, idx: number): string {
  const v = P[role] ?? registry.roles[role]?.[pi] ?? '#ff00aa';
  return Array.isArray(v) ? v[((idx % v.length) + v.length) % v.length]! : v;
}
function kitFor(seed: number): KitContext {
  let s = (Math.imul(seed + 0x9e37, 2654435761) ^ 0x5bd1e995) >>> 0 || 1;
  for (let i = 0; i < 12; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; }
  const shadow = <T extends THREE.Mesh>(m: T): T => { m.castShadow = true; m.receiveShadow = true; return m; };
  return {
    mat(role, idx = 0) {
      const key = `${role}#${idx}`;
      let m = mats.get(key);
      if (!m) {
        const sm = new THREE.MeshStandardMaterial({ color: colour(role, idx), roughness: 0.82, metalness: 0 });
        if (q.get('dusk') && ((role === 'window' && idx === 1) || role === 'lamp')) { sm.emissive.set(PALETTES[pal].windowGlow); sm.emissiveIntensity = 1.2; }
        m = applyClay(sm);
        mats.set(key, m);
      }
      return m;
    },
    rbox: (w, h, d, r, m) => {
      const rr = Math.max(0.005, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
      return shadow(new THREE.Mesh(new RoundedBoxGeometry(w, h, d, rr >= 0.06 ? 2 : 1, rr), m));
    },
    cyl: (rt, rb, h, m, seg = 16) => shadow(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m)),
    sphere: (r, m, seg = 16) => shadow(new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(8, seg * 0.75)), m)),
    cone: (r, h, m, seg = 16) => shadow(new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), m)),
    detail(o) { o.userData.detail = true; return o; },
    rand() { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; },
  };
}

// Street vignette: a main street (z = 2.6) and a lane (z = 11.2) along x, one cross street (x = 1.2) along z.
const H = Math.PI / 2;
const STREET: PlacedAsset[] = [
  // North of the main street, fronts to the street (+z).
  { kind: 'res.tower', x: -15.2, z: -1.5, params: { floors: 6 } },
  { kind: 'res.garden', x: -10.0, z: -1.2 },
  { kind: 'res.townhouses', x: -3.85, z: -0.7 },
  { kind: 'res.townhouses', x: 6.3, z: -0.7 },
  { kind: 'res.house', x: 10.9, z: -0.7 },
  { kind: 'res.house', x: 14.2, z: -0.7 },
  // Back row.
  { kind: 'res.tower', x: -15.0, z: -8.6, params: { floors: 7 } },
  { kind: 'res.tower', x: -10.6, z: -8.6, params: { floors: 5 } },
  { kind: 'res.parking', x: -4.6, z: -6.9 },
  { kind: 'res.playground', x: 5.0, z: -6.4 },
  { kind: 'res.garden', x: 11.6, z: -6.6, params: { scheme: 'brick' } },
  // South of the main street, fronts to the lane (+z).
  { kind: 'res.house', x: -13.8, z: 7.8 },
  { kind: 'res.house', x: -10.5, z: 7.8 },
  { kind: 'res.house', x: -7.2, z: 7.8 },
  { kind: 'res.garden', x: 6.6, z: 7.4 },
  { kind: 'res.house', x: 12.6, z: 7.8 },
  // Context from other families (skipped if missing).
  { kind: 'veg.oak', x: -12.1, z: 8.6 }, { kind: 'veg.maple', x: -5.3, z: 8.2 }, { kind: 'veg.cherry', x: -8.85, z: 6.2 },
  { kind: 'veg.oak', x: 9.9, z: 7.0 }, { kind: 'veg.pine', x: 15.2, z: 7.6 }, { kind: 'veg.birch', x: 12.55, z: -2.9 },
  { kind: 'veg.oak', x: -7.4, z: -3.4 }, { kind: 'veg.maple', x: 1.2, z: -6.3 }, { kind: 'veg.cherry', x: 9.6, z: -3.4 },
  { kind: 'veg.oak', x: -2.2, z: 5.2 }, { kind: 'veg.oak', x: 3.6, z: 5.0 }, { kind: 'veg.poplar', x: -16.4, z: 5.2 },
  { kind: 'st.lamp', x: -12.0, z: 4.2 }, { kind: 'st.lamp', x: -4.0, z: 4.2 }, { kind: 'st.lamp', x: 4.0, z: 4.2 }, { kind: 'st.lamp', x: 12.0, z: 4.2 },
  { kind: 'st.lamp', x: -6.9, z: 1.0 }, { kind: 'st.lamp', x: 9.45, z: 1.0 },
  { kind: 'st.fence', x: -12.15, z: 7.0, rot: H, params: { length: 2.4 } }, { kind: 'st.fence', x: -8.85, z: 8.7, rot: H, params: { length: 2.0 } },
  // Tree belt beyond the lane.
  ...[-17, -13.4, -9.6, -6.2, -2.4, 1.6, 5.4, 9.2, 12.8, 16.4].map((x, i) => ({ kind: ['veg.oak', 'veg.pine', 'veg.maple', 'veg.oak', 'veg.birch', 'veg.cherry', 'veg.oak', 'veg.pine', 'veg.maple', 'veg.oak'][i]!, x, z: 14.2 + (i % 3) * 0.5 })),
  ...[-15.2, -7.9, 3.5, 11.0].map((x) => ({ kind: 'veg.bush', x, z: 13.6 })),
  { kind: 'st.mailbox', x: -14.6, z: 9.8 }, { kind: 'st.mailbox', x: 11.8, z: 9.8 }, { kind: 'st.bench', x: 2.7, z: -4.0, rot: Math.PI },
];
const ROADS: Array<{ x0: number; x1: number; z0: number; z1: number }> = [
  { x0: -20, x1: 20, z0: 1.4, z1: 3.8 }, { x0: -20, x1: 20, z0: 10.0, z1: 12.4 }, { x0: 0, x1: 2.4, z0: -12, z1: 10.0 },
];

function main(): void {
  const kind = q.get('kind');
  const n = Number(q.get('n') ?? 8);
  const rot = (Number(q.get('rot') ?? 0) * Math.PI) / 2;
  let items: PlacedAsset[];
  let view = 34;
  if (kind) {
    const def = registry.get(kind);
    const cell = Math.max(def?.footprint.w ?? 3, def?.footprint.d ?? 3) + 1.6;
    const cols = Math.min(n, 4);
    items = Array.from({ length: n }, (_, i) => ({ kind, x: (i % cols - (cols - 1) / 2) * cell, z: (Math.floor(i / cols) - (Math.ceil(n / cols) - 1) / 2) * cell, rot }));
    view = cell * Math.max(2.4, cols * 0.9);
  } else {
    items = STREET.map((it) => ({ ...it, rot: (it.rot ?? 0) + rot }));
  }
  view = Number(q.get('zoom') ?? view);
  const center = new THREE.Vector3(Number(q.get('cx') ?? 0), 0, Number(q.get('cz') ?? 0));
  const { scene, renderer, camera, loop } = devScene(view, center);
  const fit = () => {
    renderer.setSize(innerWidth, innerHeight);
    const a = innerWidth / innerHeight;
    Object.assign(camera, { left: (-view * a) / 2, right: (view * a) / 2, top: view / 2, bottom: -view / 2 });
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', fit);
  fit();
  scene.background = new THREE.Color(PALETTES[pal].bg);
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const board = new THREE.Mesh(new THREE.BoxGeometry(110, 0.6, 110), applyClay(new THREE.MeshStandardMaterial({ color: PALETTES[pal].board, roughness: 0.9 })));
  board.position.y = -0.3; board.receiveShadow = true; scene.add(board);
  if (!kind) {
    const roadM = applyClay(new THREE.MeshStandardMaterial({ color: PALETTES[pal].road, roughness: 0.95 }));
    const curbM = applyClay(new THREE.MeshStandardMaterial({ color: PALETTES[pal].curb, roughness: 0.95 }));
    const markM = new THREE.MeshStandardMaterial({ color: PALETTES[pal].mark });
    const slab = (x0: number, x1: number, z0: number, z1: number, y: number, h: number, m: THREE.Material) => {
      const o = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, h, z1 - z0), m);
      o.position.set((x0 + x1) / 2, y + h / 2, (z0 + z1) / 2); o.receiveShadow = true; scene.add(o);
    };
    for (const r of ROADS) {
      const alongX = r.x1 - r.x0 > r.z1 - r.z0;
      if (alongX) { slab(r.x0, r.x1, r.z0 - 0.8, r.z0, 0, 0.07, curbM); slab(r.x0, r.x1, r.z1, r.z1 + 0.8, 0, 0.07, curbM); }
      else { slab(r.x0 - 0.8, r.x0, r.z0, r.z1, 0, 0.07, curbM); slab(r.x1, r.x1 + 0.8, r.z0, r.z1, 0, 0.07, curbM); }
    }
    for (const r of ROADS) {
      slab(r.x0, r.x1, r.z0, r.z1, 0, 0.075, roadM);
      const alongX = r.x1 - r.x0 > r.z1 - r.z0, mid = alongX ? (r.z0 + r.z1) / 2 : (r.x0 + r.x1) / 2;
      for (let t = (alongX ? r.x0 : r.z0) + 0.6; t < (alongX ? r.x1 : r.z1) - 0.6; t += 1.6) {
        if (alongX && t > -0.4 && t < 2.8) continue;
        if (alongX) slab(t, t + 0.8, mid - 0.05, mid + 0.05, 0.075, 0.01, markM); else slab(mid - 0.05, mid + 0.05, t, t + 0.8, 0.075, 0.01, markM);
      }
    }
  }
  items.forEach((it, i) => {
    if (!registry.get(it.kind)) return;
    try {
      const o = registry.build(kitFor(i * 7 + 3 + Number(q.get('seed') ?? 0)), it);
      if (q.get('detail') === 'min') o.traverse((c) => { if (c.userData.detail) c.visible = false; });
      scene.add(o);
    } catch (e) { console.warn(it.kind, e); }
  });
  loop();
  (window as unknown as { __ready: boolean }).__ready = true;
}
main();
