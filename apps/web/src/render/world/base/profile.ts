// Owner: E3. The diorama base's cut-edge profile: what the knife cut through along the four edges of the world
// extent — land (top of the ground) and, on the lake sides, a water column over the lake bed. Defaults come from the
// world layout (mountain sides at board level, a beach strip sloping to the shore, a lake bed deepening away from
// it); at runtime the base re-samples its sibling terrain (E1) and water (E2) meshes so the cut follows whatever
// they built: mountains are sliced through, headlands too, and the water column tops out at E2's water level.
import * as THREE from 'three';
import type { Side, WorldLayout } from '../layout';

export const BASE = {
  /** Wall bottom = top face of the wooden plinth (world y). */
  bottom: -10,
  plinthH: 1.6,
  /** How far the plinth sticks out past the cut walls, and its corner radius in plan. */
  plinthOut: 1.5,
  plinthR: 3.2,
  /** Ground beyond the board on the land sides (just under the board top, y = 0). */
  floorY: -0.03,
  /** Default water surface (E2's water mesh overrides it when found). */
  waterLevel: -0.35,
  /** Floor height at the shoreline (under E2's beach) and the lake bed at the far cut edges. */
  beachY: -0.85,
  bedY: -4.6,
  /** The bed drops from the shore to `bedY` over this distance. */
  shelf: 12,
  /** Cut-edge sample spacing (u). */
  step: 1,
  /** Samples of sibling meshes are taken this far inside the extent (avoids their own edge faces). */
  inset: 0.05,
} as const;

export interface EdgeSample {
  x: number;
  z: number;
  /** Top of the ground (land, beach, lake bed or terrain) at the cut. */
  ground: number;
  /** Water surface over this sample, or null when dry. */
  water: number | null;
}
export interface EdgeProfile {
  side: Side;
  /** Outward normal of the cut face. */
  nx: number;
  nz: number;
  samples: EdgeSample[];
}

const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

/** Signed distance past the shoreline into the lake (> 0 = water). */
export function waterDistance(layout: WorldLayout, x: number, z: number): number {
  return Math.max(z - layout.shore.south, x - layout.shore.east);
}

export function isWater(layout: WorldLayout, x: number, z: number): boolean {
  return waterDistance(layout, x, z) > 0;
}

/** Default ground height: board level on the mountain sides, a beach strip sloping down to the shore, then a lake
 *  bed that deepens over `BASE.shelf` to `BASE.bedY`. */
export function groundAt(layout: WorldLayout, x: number, z: number): number {
  const d = waterDistance(layout, x, z);
  if (d > 0) return BASE.beachY + (BASE.bedY - BASE.beachY) * smooth(d / BASE.shelf);
  const b = layout.board, s = layout.shore;
  if (x < b.minX || z < b.minZ) return BASE.floorY;
  const t = Math.max((z - b.maxZ) / Math.max(1e-6, s.south - b.maxZ), (x - b.maxX) / Math.max(1e-6, s.east - b.maxX));
  if (t > 0) return BASE.floorY + (BASE.beachY - BASE.floorY) * Math.min(1, t);
  return BASE.floorY;
}

/** The four cut edges, clockwise from above: north (heading east), east (south), south (west), west (north).
 *  Consecutive edges share their corner sample. */
export function defaultProfile(layout: WorldLayout, step: number = BASE.step): EdgeProfile[] {
  const E = layout.extent;
  const edge = (side: Side, nx: number, nz: number, x0: number, z0: number, x1: number, z1: number): EdgeProfile => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.ceil(len / step - 1e-9));
    const samples: EdgeSample[] = [];
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, z = z0 + ((z1 - z0) * i) / n;
      const ground = groundAt(layout, x, z);
      const wet = isWater(layout, x, z) && BASE.waterLevel > ground;
      samples.push({ x, z, ground, water: wet ? BASE.waterLevel : null });
    }
    return { side, nx, nz, samples };
  };
  return [
    edge('north', 0, -1, E.minX, E.minZ, E.maxX, E.minZ),
    edge('east', 1, 0, E.maxX, E.minZ, E.maxX, E.maxZ),
    edge('south', 0, 1, E.maxX, E.maxZ, E.minX, E.maxZ),
    edge('west', -1, 0, E.minX, E.maxZ, E.minX, E.minZ),
  ];
}

/** Sample points just inside the extent, one per profile sample, in profile order. */
export function samplePoints(sides: EdgeProfile[]): Array<{ x: number; z: number }> {
  const out: Array<{ x: number; z: number }> = [];
  for (const s of sides) for (const p of s.samples) out.push({ x: p.x - s.nx * BASE.inset, z: p.z - s.nz * BASE.inset });
  return out;
}

/**
 * Highest surface above each point among the visible, non-instanced meshes under `roots` (world space), or null where
 * none covers it. Instanced meshes (trees, rocks, boats) and vertical faces are ignored. Cost ~ one pass over the
 * triangles: points are bucketed in a 2 u grid, so only triangles near the points are tested.
 */
export function sampleTops(roots: THREE.Object3D[], pts: Array<{ x: number; z: number }>): Array<number | null> {
  const out: Array<number | null> = pts.map(() => null);
  if (!pts.length) return out;
  const CELL = 2;
  const key = (cx: number, cz: number) => (cx + 4096) * 8192 + (cz + 4096);
  const grid = new Map<number, number[]>();
  pts.forEach((p, i) => {
    const k = key(Math.floor(p.x / CELL), Math.floor(p.z / CELL));
    const list = grid.get(k);
    if (list) list.push(i); else grid.set(k, [i]);
  });
  const v = new THREE.Vector3();
  for (const root of roots) {
    root.updateWorldMatrix(true, true);
    root.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) return;
      const pos = m.geometry?.getAttribute('position');
      if (!pos || pos.itemSize < 3) return;
      const n = pos.count;
      const wx = new Float32Array(n), wy = new Float32Array(n), wz = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        wx[i] = v.x; wy[i] = v.y; wz[i] = v.z;
      }
      const index = m.geometry.getIndex();
      const triCount = Math.floor((index ? index.count : n) / 3);
      for (let t = 0; t < triCount; t++) {
        const a = index ? index.getX(3 * t) : 3 * t;
        const b = index ? index.getX(3 * t + 1) : 3 * t + 1;
        const c = index ? index.getX(3 * t + 2) : 3 * t + 2;
        const ax = wx[a]!, az = wz[a]!, bx = wx[b]!, bz = wz[b]!, cx = wx[c]!, cz = wz[c]!;
        const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(det) < 1e-9) continue;
        const x0 = Math.floor(Math.min(ax, bx, cx) / CELL), x1 = Math.floor(Math.max(ax, bx, cx) / CELL);
        const z0 = Math.floor(Math.min(az, bz, cz) / CELL), z1 = Math.floor(Math.max(az, bz, cz) / CELL);
        if ((x1 - x0 + 1) * (z1 - z0 + 1) > 4096) continue; // absurdly large triangle: skip rather than stall
        for (let gx = x0; gx <= x1; gx++) {
          for (let gz = z0; gz <= z1; gz++) {
            const list = grid.get(key(gx, gz));
            if (!list) continue;
            for (const i of list) {
              const p = pts[i]!;
              const l1 = ((bz - cz) * (p.x - cx) + (cx - bx) * (p.z - cz)) / det;
              const l2 = ((cz - az) * (p.x - cx) + (ax - cx) * (p.z - cz)) / det;
              const l3 = 1 - l1 - l2;
              if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
              const y = l1 * wy[a]! + l2 * wy[b]! + l3 * wy[c]!;
              const cur = out[i];
              if (cur === null || cur === undefined || y > cur) out[i] = y;
            }
          }
        }
      }
    });
  }
  return out;
}

/** Most common value (to 0.05 u) of the non-null entries, or null. */
export function modeLevel(values: Array<number | null>): number | null {
  const counts = new Map<number, number>();
  let best: number | null = null, bestN = 0;
  for (const v of values) {
    if (v === null) continue;
    const k = Math.round(v * 20);
    const c = (counts.get(k) ?? 0) + 1;
    counts.set(k, c);
    if (c > bestN) { bestN = c; best = k; }
  }
  return best === null ? null : best / 20;
}

/** Median of three; missing neighbours count as `fallback` (so a lone spike among default ground is dropped). */
const median3 = (a: number, b: number, c: number): number => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));

/**
 * Re-fit the default profile to sampled sibling surfaces (both arrays in `samplePoints` order):
 * - ground follows the terrain tops where terrain covers the cut (median-of-3 filtered, so a lone rock is ignored);
 * - the water level is the most common water-mesh height (a bridge deck crossing the cut does not raise it);
 * - when the water layer covers any of the cut, water is present exactly where it does; otherwise the layout's lake.
 */
export function adaptProfile(sides: EdgeProfile[], terrainTops: Array<number | null>, waterTops: Array<number | null>): EdgeProfile[] {
  const level = modeLevel(waterTops) ?? BASE.waterLevel;
  const anyWater = waterTops.some((w) => w !== null);
  let k = 0;
  return sides.map((side) => {
    const n = side.samples.length;
    const t = terrainTops.slice(k, k + n), w = waterTops.slice(k, k + n);
    k += n;
    const at = (i: number) => {
      const v = t[i];
      return v === null || v === undefined ? side.samples[i]!.ground : v;
    };
    const samples = side.samples.map((s, i) => {
      const v = t[i];
      const top = v === null || v === undefined ? null : median3(i > 0 ? at(i - 1) : v, v, i + 1 < n ? at(i + 1) : v);
      const ground = Math.max(BASE.bottom + 1.5, Math.min(80, top ?? s.ground));
      const wet = anyWater ? w[i] !== null && w[i] !== undefined : s.water !== null;
      return { x: s.x, z: s.z, ground, water: wet && level > ground + 0.02 ? level : null };
    });
    return { ...side, samples };
  });
}
