// Minimal KitContext for dev pages and tests (palette A colours). The composer (T2.2) provides the clay-material version.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { KitContext, RoleColors } from './types';

const BASE_A: Record<string, string | string[]> = {
  board: '#A8D8B9', lawn: '#8FCB9B', road: '#515566', curb: '#B9BDC9', mark: '#FFFFFF',
  wall: ['#F6EEDC', '#F1E4C8', '#FBF6EA'], brick: ['#C8694C', '#B5553C', '#D27A5A'], stone: '#E6DCC6',
  roof: ['#E9785A', '#3FA796', '#F2C14E'], window: '#2C3A55', glass: '#3B5878', door: '#9B6B43', trim: '#FFFFFF',
  awning: ['#E9785A', '#3FA796', '#F2C14E', '#5A8BD6'], metal: '#7E848E', dark: '#3D4250',
  trunk: '#9B6B43', leaf: ['#4FAF6E', '#66BF7A', '#3E9A5F'], flower: ['#F28CA8', '#F6C945', '#FFFFFF', '#B58CF2'],
  car: ['#E9785A', '#5A8BD6', '#F2C14E', '#7FB8A4', '#F4F1EA'], seats: ['#5A8BD6', '#7FA6E6'], field: '#6FC07F', lamp: '#FFF3C4',
};

export function createBasicKit(extraRoles: RoleColors = {}, palette: 0 | 1 | 2 = 0, seed = 1): KitContext {
  const cache = new Map<string, THREE.Material>();
  let s = seed >>> 0 || 1;
  const colorOf = (role: string, idx: number): string => {
    const v = extraRoles[role]?.[palette] ?? BASE_A[role] ?? '#9AA0A6';
    return Array.isArray(v) ? v[idx % v.length]! : v;
  };
  const shadow = <T extends THREE.Mesh>(m: T): T => { m.castShadow = true; m.receiveShadow = true; return m; };
  return {
    mat(role, idx = 0) {
      const key = role + '#' + idx;
      let m = cache.get(key);
      if (!m) { m = new THREE.MeshStandardMaterial({ color: colorOf(role, idx), roughness: 0.82, metalness: 0 }); cache.set(key, m); }
      return m;
    },
    rbox(w, h, d, r, m) {
      const rr = Math.max(0.005, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
      return shadow(new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, rr), m));
    },
    cyl: (rt, rb, h, m, seg = 16) => shadow(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m)),
    sphere: (r, m, seg = 16) => shadow(new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(8, seg * 0.75)), m)),
    cone: (r, h, m, seg = 16) => shadow(new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), m)),
    detail(o) { o.userData.detail = true; return o; },
    rand() { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; },
  };
}
