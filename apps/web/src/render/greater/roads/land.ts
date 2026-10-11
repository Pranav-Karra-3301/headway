// Owner: G0. Land around the board, derived from the town map (pure data, deterministic):
//  - the BAY: water to the south-east of an organic shoreline that runs from the grid's east edge (an NE headland),
//    hugs the board's south-east 4 u out (the beach the rail runs on; the rail bridge crosses open water at z > 30),
//    then swings south round the south-west land and leaves through the grid's west edge;
//  - the RAIL off the board: the beach run (south), the bay bridge (over water) and the ridge tunnel (west);
//  - the RIDGE SPUR: hill cells over the rail tunnel, from the rail out to the board's west edge (portals there).
import { projectOnPolyline } from '@headway/sim';
import type { TownMap, Vec2 } from '@headway/sim';
import { cellRect, inRect, type GridFrame } from './cells';

export type RailKind = 'board' | 'beach' | 'bridge' | 'tunnel';

export interface Land {
  /** Shoreline, open polyline from the grid's east edge to its west edge; water lies on its south / east side. */
  shore: Vec2[];
  /** The bay inside the grid: closed polygon (shore + the grid's south-east corners, 1 u beyond the grid). */
  water: Vec2[];
  isWater(p: Vec2): boolean;
  /** Nearest rail point (and what the rail is doing there). */
  railNear(p: Vec2): { d: number; kind: RailKind; at: Vec2 };
}

/** Catmull-Rom densify (uniform, `segs` per span); keeps the end points. */
function smooth(pts: Vec2[], segs = 6): Vec2[] {
  const out: Vec2[] = [pts[0]!];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = pts[Math.max(0, i - 1)]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[Math.min(pts.length - 1, i + 2)]!;
    for (let s = 1; s <= segs; s++) {
      const t = s / segs, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  return out;
}

export function pointInPolygon(poly: readonly Vec2[], p: Vec2): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export function buildLand(map: TownMap, g: GridFrame): Land {
  const b = map.bounds, G = g.bounds;
  const sZ = b.maxZ + 4; // beach line: the rail runs on the beach, its bridge over water beyond (town.ts RAIL_SHORE_Z)
  // control points, relative to the board / grid edges
  const ctrl: Vec2[] = [
    { x: G.maxX, z: b.minZ + 30 },
    { x: b.maxX + 24, z: b.minZ + 34 },
    { x: b.maxX + 20, z: b.minZ + 40 },
    { x: b.maxX + 18, z: b.maxZ - 4 },
    { x: b.maxX + 13, z: b.maxZ - 0.5 },
    { x: b.maxX + 6, z: b.maxZ + 1.2 },
    { x: b.maxX + 1, z: sZ - 0.6 },
    { x: b.maxX - 4, z: sZ },
    { x: 20, z: sZ },
    { x: 6.4, z: sZ },
    { x: 7.2, z: sZ + 4 },
    { x: 8.6, z: sZ + 8.5 },
    { x: 8.8, z: sZ + 12 },
    { x: 6, z: sZ + 16.5 },
    { x: 0, z: sZ + 19.4 },
    { x: -10, z: sZ + 20.4 },
    { x: -22, z: sZ + 22.2 },
    { x: -36, z: sZ + 20.6 },
    { x: -50, z: sZ + 21.8 },
    { x: G.minX, z: sZ + 20.8 },
  ];
  const shore = smooth(ctrl, 5);
  const water: Vec2[] = [
    ...shore,
    { x: G.minX - 1, z: shore[shore.length - 1]!.z },
    { x: G.minX - 1, z: G.maxZ + 1 },
    { x: G.maxX + 1, z: G.maxZ + 1 },
    { x: G.maxX + 1, z: shore[0]!.z },
  ];
  const isWater = (p: Vec2) => pointInPolygon(water, p);
  const onBoard = (p: Vec2) => p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ;
  const rail = map.rail.loop;
  const railNear = (p: Vec2) => {
    const q = projectOnPolyline(rail, p);
    const at = { x: q.x, z: q.z };
    const kind: RailKind = onBoard(at) ? 'board' : at.x < b.minX ? 'tunnel' : isWater(at) ? 'bridge' : 'beach';
    return { d: q.d, kind, at };
  };
  return { shore, water, isWater, railNear };
}

/** Rail samples every `step` u (for cell masks). */
export function railSamples(map: TownMap, step = 0.5): Vec2[] {
  const pts = map.rail.loop.points, n = pts.length, out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i]!, c = pts[(i + 1) % n]!;
    const L = Math.hypot(c.x - a.x, c.z - a.z), k = Math.max(1, Math.ceil(L / step));
    for (let s = 0; s < k; s++) out.push({ x: a.x + ((c.x - a.x) * s) / k, z: a.z + ((c.z - a.z) * s) / k });
  }
  return out;
}

/**
 * Cell masks: `rail` = off-board cells the beach/bridge rail passes within `railM` u of; `hill` = the ridge spur over
 * the tunnel (bounding box of the off-board tunnel run, grown 4 u away from the board, clipped to the board edge).
 */
export function landMasks(map: TownMap, g: GridFrame, land: Land, railM = 1.4): { rail: Uint8Array; hill: Uint8Array } {
  const { cols, rows } = g;
  const rail = new Uint8Array(cols * rows), hill = new Uint8Array(cols * rows);
  const b = map.bounds;
  const tun = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const p of railSamples(map)) {
    const off = p.x < b.minX || p.x > b.maxX || p.z < b.minZ || p.z > b.maxZ;
    if (!off) continue;
    if (p.x < b.minX) {
      tun.minX = Math.min(tun.minX, p.x); tun.maxX = Math.max(tun.maxX, p.x);
      tun.minZ = Math.min(tun.minZ, p.z); tun.maxZ = Math.max(tun.maxZ, p.z);
      continue;
    }
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (inRect(g.board, c, r)) continue;
      const R = cellRect(g, c, r);
      if (p.x > R.minX - railM && p.x < R.maxX + railM && p.z > R.minZ - railM && p.z < R.maxZ + railM) rail[r * cols + c] = 1;
    }
  }
  if (tun.minX < Infinity) {
    const box = { minX: tun.minX - 4, maxX: b.minX, minZ: tun.minZ - 2.5, maxZ: tun.maxZ + 2.5 };
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (inRect(g.board, c, r)) continue;
      const R = cellRect(g, c, r), cx = (R.minX + R.maxX) / 2, cz = (R.minZ + R.maxZ) / 2;
      if (cx > box.minX && cx < box.maxX && cz > box.minZ && cz < box.maxZ && !land.isWater({ x: cx, z: cz })) hill[r * cols + c] = 1;
    }
  }
  return { rail, hill };
}
