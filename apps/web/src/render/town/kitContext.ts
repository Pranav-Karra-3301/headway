// Owner: T2.2. The clay-material KitContext adapter: asset-family builders (render/assets) draw through it, the
// composer bakes what they build into vertex-coloured geometry (kit/bake) and renders it with the shared clay
// KitMaterial. Materials only carry a palette role (userData.role/idx + name "role#idx"); colours come from the
// T2.1 palettes for kit roles and from the registry's family ROLES for the rest (recoloured in place on palette
// switches). Geometries are cached by size so thousands of placements stay cheap to build.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { RoleColors, KitContext } from '../assets/types';
import { prng } from '../kit/prims';
import type { RoleResolver } from '../kit/bake';
import { colorOf, PALETTES, type Palette, type Role } from '../palettes';
import type { PaletteId } from '../types';
import { hashString } from '../dynamic/interp';

/** Last-resort colours for roles neither the palette nor any family declares (palette a, b, c). */
const FALLBACK: RoleColors = {
  stone: ['#E6DCC6', '#DCCFB6', '#E2DDD0'],
  dark: ['#3D4250', '#3E3A36', '#2B3340'],
  flower: [['#F28CA8', '#F6C945', '#FFFFFF', '#B58CF2'], ['#C96F5B', '#D9A441', '#F5EFE3', '#8F7AA6'], ['#E9B03B', '#A8483A', '#F5F2EA', '#8B5FB0']],
  grass: ['#8FCB9B', '#B9C99A', '#A9C48A'],
  water: ['#7EC8E3', '#8FB3BF', '#7FA9C9'],
  sand: ['#F1E1BE', '#E6D4B0', '#E8DCC2'],
  wood: ['#B58256', '#8C6B4E', '#7B5B43'],
  white: ['#FFFFFF', '#F5EFE3', '#FFFFFF'],
};

const paletteIndex = (P: Palette): 0 | 1 | 2 => (P === PALETTES.b || P.name === PALETTES.b.name ? 1 : P === PALETTES.c || P.name === PALETTES.c.name ? 2 : 0);

const pickIdx = (v: string | string[], idx: number): string => (Array.isArray(v) ? v[((idx % v.length) + v.length) % v.length]! : v);

/** Colour resolver for bakeGeometry: family roles (registry.roles), then FALLBACK; undefined → bake's grey. */
export function roleResolver(roles: RoleColors): RoleResolver {
  return (role, idx, P) => {
    const entry = roles[role] ?? FALLBACK[role];
    if (!entry) return undefined;
    return pickIdx(entry[paletteIndex(P)], idx);
  };
}

/** Hex colour of any role (palette first, then family roles), for unbaked fallbacks and previews. */
export function anyRoleColor(role: string, idx: number, palette: PaletteId, roles: RoleColors): string {
  const P = PALETTES[palette];
  if (role in P && role !== 'name') return colorOf(P, role as Role, idx);
  return roleResolver(roles)(role, idx, P) ?? '#9AA0A6';
}

export interface ClayKitShared {
  roles: RoleColors;
  palette: PaletteId;
  materials: Map<string, THREE.MeshStandardMaterial>;
  geometries: Map<string, THREE.BufferGeometry>;
}

export function createClayKitShared(roles: RoleColors, palette: PaletteId): ClayKitShared {
  return { roles, palette, materials: new Map(), geometries: new Map() };
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Seed for a placement's `rand()` stream: stable for the same kind and position. */
export function placementSeed(kind: string, x: number, z: number): number {
  return hashString(`${kind}@${x.toFixed(2)},${z.toFixed(2)}`);
}

/** A KitContext for one placement (its own `rand()` stream; materials and geometries shared). */
export function createClayKit(shared: ClayKitShared, seed: number): KitContext {
  const rand = prng(seed);
  const geo = (key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry => {
    let g = shared.geometries.get(key);
    if (!g) { g = make(); shared.geometries.set(key, g); }
    return g;
  };
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh => {
    const o = new THREE.Mesh(g, m);
    o.castShadow = true;
    o.receiveShadow = true;
    return o;
  };
  return {
    mat(role, idx = 0) {
      const key = `${role}#${idx}`;
      let m = shared.materials.get(key);
      if (!m) {
        m = new THREE.MeshStandardMaterial({ color: anyRoleColor(role, idx, shared.palette, shared.roles), roughness: 0.82, metalness: 0 });
        m.name = key;
        m.userData.role = role;
        m.userData.idx = idx;
        shared.materials.set(key, m);
      }
      return m;
    },
    rbox(w, h, d, r, m) {
      const rr = Math.max(0.005, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
      const seg = rr >= 0.2 ? 3 : rr >= 0.06 ? 2 : 1;
      return mesh(geo(`rb:${r3(w)},${r3(h)},${r3(d)},${r3(rr)},${seg}`, () => new RoundedBoxGeometry(w, h, d, seg, rr)), m);
    },
    cyl: (rt, rb, h, m, seg = 16) => mesh(geo(`cy:${r3(rt)},${r3(rb)},${r3(h)},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)), m),
    sphere: (r, m, seg = 16) => {
      const hs = Math.max(6, Math.round(seg * 0.7));
      return mesh(geo(`sp:${r3(r)},${seg},${hs}`, () => new THREE.SphereGeometry(r, seg, hs)), m);
    },
    cone: (r, h, m, seg = 16) => mesh(geo(`co:${r3(r)},${r3(h)},${seg}`, () => new THREE.ConeGeometry(r, h, seg)), m),
    detail(o) { o.userData.detail = true; return o; },
    rand: () => rand(),
  };
}

export function disposeClayKitShared(shared: ClayKitShared): void {
  for (const m of shared.materials.values()) m.dispose();
  for (const g of shared.geometries.values()) g.dispose();
  shared.materials.clear();
  shared.geometries.clear();
}
