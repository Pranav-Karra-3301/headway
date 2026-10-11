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
  let s = (seed * 2654435761) >>> 0 || 1;
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

const STREET: PlacedAsset[] = [
  { kind: 'res.tower', x: -9.5, z: -7, params: { floors: 7 } },
  { kind: 'res.tower', x: -5.4, z: -7, params: { floors: 6, accent: 0 } },
  { kind: 'res.garden', x: 0.6, z: -7 },
  { kind: 'res.garden', x: 7.4, z: -7, params: { scheme: 'brick' } },
  { kind: 'res.townhouses', x: -8.2, z: 0.6 },
  { kind: 'res.townhouses', x: -1.6, z: 0.6 },
  { kind: 'res.house', x: 3.4, z: 0.6 },
  { kind: 'res.house', x: 6.4, z: 0.6 },
  { kind: 'res.house', x: 9.4, z: 0.6 },
  { kind: 'res.playground', x: -7.6, z: 7.6 },
  { kind: 'res.parking', x: -1.6, z: 7.6 },
  { kind: 'res.house', x: 3.4, z: 7.6 },
  { kind: 'res.house', x: 6.4, z: 7.6 },
  { kind: 'res.house', x: 9.4, z: 7.6 },
];
const ROADS = [-3.6, 3.9, 10.9];

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
  const { scene, renderer, loop } = devScene(view, center);
  scene.background = new THREE.Color(PALETTES[pal].bg);
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const board = new THREE.Mesh(new THREE.BoxGeometry(60, 0.6, 60), applyClay(new THREE.MeshStandardMaterial({ color: PALETTES[pal].board, roughness: 0.9 })));
  board.position.y = -0.3; board.receiveShadow = true; scene.add(board);
  if (!kind) for (const z of ROADS) {
    const road = new THREE.Mesh(new THREE.BoxGeometry(40, 0.04, 2.4), new THREE.MeshStandardMaterial({ color: PALETTES[pal].road, roughness: 0.95 }));
    road.position.set(0, 0.02, z); road.receiveShadow = true; scene.add(road);
    for (let x = -19; x < 20; x += 1.6) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.02, 0.1), new THREE.MeshStandardMaterial({ color: PALETTES[pal].mark }));
      dash.position.set(x, 0.05, z); scene.add(dash);
    }
  }
  items.forEach((it, i) => {
    const o = registry.build(kitFor(i * 7 + 3 + Number(q.get('seed') ?? 0)), it);
    if (q.get('detail') === 'min') o.traverse((c) => { if (c.userData.detail) c.visible = false; });
    scene.add(o);
  });
  loop();
  (window as unknown as { __ready: boolean }).__ready = true;
}
main();
