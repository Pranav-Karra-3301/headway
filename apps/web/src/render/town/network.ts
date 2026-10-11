// Owner: T2.2. The transport network as kit parts (palette roles, baked with the rest of the ground):
// roads = flat strips along every road edge (the edges already carry rounded corners) with round junction pads and
// a subtle dashed centre line; the rail loop = ballast bed + 2 rails swept along `rail.loop`, ties every 0.6 u.
import * as THREE from 'three';
import { pointAt } from '@headway/sim';
import type { TownMap, Vec2 } from '@headway/sim';
import { at, box, cyl, detail, part } from '../kit/prims';
import { TRACK } from '../kit/transit';

/** Road surface half-width and top height; buses drive in the right-hand lane LANE_OFFSET from the centreline. */
export const ROAD = { half: 1.2, top: 0.04 } as const;
export const LANE_OFFSET = 0.6; // bus half-width 0.625: opposing buses just clear each other

type Profile = ReadonlyArray<readonly [lateral: number, y: number]>;

/**
 * Sweep a cross-section along a polyline (mitred joins). Profile points go left-bottom → … → right-bottom
 * (lateral + = right of the travel direction, y up) so faces point outward. Every profile segment gets its own
 * vertices (crisp profile edges, smooth along the path).
 */
export function sweep(points: readonly Vec2[], closed: boolean, profile: Profile): THREE.BufferGeometry {
  const n = points.length;
  const pos: number[] = [];
  const idx: number[] = [];
  if (n < 2 || profile.length < 2) return new THREE.BufferGeometry();
  // per-vertex right vector (mitred)
  const rights: Array<{ x: number; z: number; s: number }> = [];
  const dirAt = (i: number): Vec2 | null => {
    const a = points[i]!, b = points[(i + 1) % n]!;
    const dx = b.x - a.x, dz = b.z - a.z, L = Math.sqrt(dx * dx + dz * dz);
    return L > 1e-9 ? { x: dx / L, z: dz / L } : null;
  };
  for (let i = 0; i < n; i++) {
    const dIn = i > 0 || closed ? dirAt((i - 1 + n) % n) : null;
    const dOut = i < n - 1 || closed ? dirAt(i) : null;
    const d0 = dIn ?? dOut!, d1 = dOut ?? dIn!;
    const r0 = { x: -d0.z, z: d0.x }, r1 = { x: -d1.z, z: d1.x };
    let mx = r0.x + r1.x, mz = r0.z + r1.z;
    const ml = Math.sqrt(mx * mx + mz * mz) || 1;
    mx /= ml; mz /= ml;
    const s = 1 / Math.max(0.35, mx * r1.x + mz * r1.z);
    rights.push({ x: mx, z: mz, s });
  }
  const rings = closed ? n + 1 : n;
  for (let s = 0; s + 1 < profile.length; s++) {
    const base = pos.length / 3;
    for (let k = 0; k < rings; k++) {
      const i = k % n, p = points[i]!, r = rights[i]!;
      for (const [l, y] of [profile[s]!, profile[s + 1]!]) pos.push(p.x + r.x * l * r.s, y, p.z + r.z * l * r.s);
    }
    for (let k = 0; k + 1 < rings; k++) {
      const a = base + k * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Strip of width 2·half at height `top` with short skirts down to the board. */
const strip = (half: number, top: number, bottom = 0): Profile => [[-half, bottom], [-half, top], [half, top], [half, bottom]];

/** Every road edge as a strip, junction pads at inner nodes, dashed centre lines (detail) away from junctions. */
export function makeRoads(map: TownMap): THREE.Group {
  const g = new THREE.Group();
  g.name = 'roads';
  const b = map.bounds, eps = 0.5;
  for (const e of map.roads.edges) {
    g.add(part(sweep(e.path.points, e.path.closed, strip(ROAD.half, ROAD.top)), 'road'));
    // centre dashes: 0.55 long every 1.5 u, clear of both junctions
    const L = e.path.length;
    for (let d = 2.2; d < L - 2.0; d += 1.5) {
      const p = pointAt(e.path, d + 0.275);
      const dash = at(box(0.55, 0.012, 0.07, 'mark'), p.x, ROAD.top + 0.006, p.z);
      dash.rotation.y = p.heading;
      dash.castShadow = false;
      g.add(detail(dash));
    }
  }
  const degree = new Map<string, number>();
  for (const e of map.roads.edges) for (const id of [e.a, e.b]) degree.set(id, (degree.get(id) ?? 0) + 1);
  for (const n of map.roads.nodes) {
    const onEdge = n.p.x <= b.minX + eps || n.p.x >= b.maxX - eps || n.p.z <= b.minZ + eps || n.p.z >= b.maxZ - eps;
    if (onEdge || (degree.get(n.id) ?? 0) < 2) continue;
    const pad = at(cyl(ROAD.half, ROAD.half, ROAD.top, 'road', 0, 24), n.p.x, ROAD.top / 2, n.p.z);
    pad.castShadow = false;
    g.add(pad);
  }
  return g;
}

/** The rail loop: ballast bed, ties (every TRACK.tieSpacing) and two rails, base at y = 0. */
export function makeRail(map: TownMap): THREE.Group {
  const g = new THREE.Group();
  g.name = 'rail';
  const loop = map.rail.loop;
  const hw = TRACK.ballastW / 2;
  g.add(part(sweep(loop.points, loop.closed, [[-hw, 0], [-hw + 0.14, 0.1], [hw - 0.14, 0.1], [hw, 0]]), 'ballast'));
  for (const s of [-TRACK.gauge / 2, TRACK.gauge / 2]) {
    const rw = 0.045;
    g.add(part(sweep(loop.points, loop.closed, [[s - rw, 0.165], [s - rw, TRACK.railTop], [s + rw, TRACK.railTop], [s + rw, 0.165]]), 'rail'));
  }
  const n = Math.floor(loop.length / TRACK.tieSpacing);
  const step = loop.length / n;
  for (let i = 0; i < n; i++) {
    const p = pointAt(loop, i * step + step / 2);
    const tie = at(box(TRACK.tieW, 0.08, TRACK.tieL, 'ties'), p.x, 0.13, p.z);
    tie.rotation.y = p.heading;
    g.add(tie);
  }
  return g;
}
