// Owner: S1. The streetscape: everything on the ground between the buildings.
// - Sidewalks + curbs along every road edge: raised stone slabs with a chamfered toy edge, rounded curb corners
//   at junctions, cut clear of the rail, clipped to the board.
// - Road fill in the rounded curb corners (the composer's strips + round junction pads leave a square corner there);
//   top at STREETSCAPE.roadTop, just below the composer's road top, so its strips + centre dashes stay on top.
// - Zebra crossings on every arm of the junctions nearest the stops, and a painted bay at every bus stop.
// - District `paths` as gravel footpaths (smooth unions where paths meet, flared where they join a sidewalk) and
//   plaza-edge bands; district `areas` as lawn / plaza (flagstone checker) / parking (painted bays) / sports (pitch
//   lines) / garden (small: flowerbed; big: allotment rows). Paving joints groove the sidewalks (detail).
// - Colours adapt to the palette's road value (roles.ts): light stone + white zebras on asphalt, darker on cream.
// Everything is baked into ONE kit geometry (vertex colours by palette role) drawn with one KitMaterial.
// `heightAt(x, z)` (also on `layer.object.userData.heightAt`) gives the walking-surface height for people/props.
import * as THREE from 'three';
import { pointAt, ROAD_WIDTH } from '@headway/sim';
import type { TownMap, Vec2 } from '@headway/sim';
import type { DistrictScenery, FootPath, GroundArea } from '../districts/types';
import { bakeGeometry, recolorBaked, type Baked } from '../kit/bake';
import type { RenderLayer } from '../layers';
import { KitMaterial } from '../materials';
import type { PaletteId } from '../types';
import { type AreaOutline, buildAreas } from './areas';
import { field, makeGrid, pointInLoop, polyDist, regions, smin, stampPolyline, windowOf } from './field';
import {
  armsByNode, type Bay, cornersOf, type Crossing, crossingsNearStops, rectsOverlap, roadS, stampCornerZones, stampRoads, stopBays,
} from './network';
import { ROAD } from '../town/network';
import { resolveRole } from './roles';
import { Mesher, paintQuad, slab } from './slab';

export type { Bay, Crossing } from './network';

type SurfaceKind = GroundArea['kind'] | FootPath['kind'];

/** Streetscape dimensions (u) and surface heights (top y). Board top = 0, kit road top = 0.06. */
export const STREETSCAPE: {
  roadHalf: number; walk: number; walkTop: number; bevel: number; cornerR: number; roadTop: number; markTop: number;
  paintTop: number; railClear: number; grid: number; heights: Record<SurfaceKind, number>;
} = {
  roadHalf: ROAD_WIDTH / 2,
  /** Sidewalk width from the curb. */
  walk: 1.0,
  walkTop: 0.1,
  bevel: 0.045,
  /** Curb corner radius at junctions. */
  cornerR: 0.45,
  /** Road fill in the rounded curb corners, just under the composer's road strips (town/network ROAD.top). */
  roadTop: ROAD.top - 0.008,
  /** Top of zebra stripes and bay paint, just above the composer's road top. */
  markTop: ROAD.top + 0.01,
  /** Paint / inlay thickness above an area surface. */
  paintTop: 0.012,
  /** No sidewalk within this distance of the rail centreline. */
  railClear: 1.15,
  /** Field sampling step. */
  grid: 0.1,
  heights: { lawn: 0.03, sports: 0.035, parking: 0.04, footpath: 0.045, plaza: 0.05, 'plaza-edge': 0.056, garden: 0.06 },
};

const ZEBRA = { stripes: 5, pitch: 0.44, width: 0.26, depth: 0.75, setback: 0.25 } as const;
const BAY = { len: 3.4, wid: 0.72, line: 0.075 } as const;

export interface StreetscapeBuild {
  baked: Baked;
  crossings: Crossing[];
  bays: Bay[];
  /** Walking-surface height at (x, z): sidewalk / path / area top, 0 on the bare board and on the carriageway. */
  heightAt(x: number, z: number): number;
  stats: { triangles: number; ms: number; parkingBays: number; sportsLines: number; plazaFlags: number; gardenRows: number; joints: number };
}

class Parts {
  private map = new Map<string, { role: string; idx: number; detail: boolean; m: Mesher }>();
  get = (role: string, idx = 0, detail = false): Mesher => {
    const key = `${role}#${idx}#${detail ? 1 : 0}`;
    let e = this.map.get(key);
    if (!e) { e = { role, idx, detail, m: new Mesher() }; this.map.set(key, e); }
    return e.m;
  };
  group(): THREE.Group {
    const g = new THREE.Group();
    for (const e of this.map.values()) {
      const geo = e.m.geometry();
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo);
      mesh.userData.part = { role: e.role, idx: e.idx };
      if (e.detail) mesh.userData.detail = true;
      g.add(mesh);
    }
    return g;
  }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Build the merged streetscape geometry for a map and its districts (pure; no DOM). */
export function buildStreetscape(map: TownMap, districts: DistrictScenery[], palette: PaletteId = 'a'): StreetscapeBuild {
  const t0 = now();
  const S = STREETSCAPE;
  const h = S.roadHalf, w = S.walk, rc = S.cornerR;
  const b = map.bounds;
  const parts = new Parts();

  // ---- fields on one grid over the board
  const arms = armsByNode(map);
  const corners = cornersOf(map, arms, h, rc);
  const g = makeGrid(b, S.grid);
  const road = field(g, 0), zone = field(g, 1);
  stampRoads(g, road, map, corners, h, rc, h + w + 0.8);
  stampCornerZones(g, zone, corners, h, rc);
  const rail = field(g, S.railClear + 1);
  stampPolyline(g, rail, map.rail.loop.points, true, S.railClear + 1);
  const bed = field(g, 1), walk = field(g, 1);
  for (let j = 0; j < g.nz; j++) {
    const z = g.z0 + j * g.c;
    for (let i = 0; i < g.nx; i++) {
      const x = g.x0 + i * g.c, k = j * g.nx + i;
      const out = Math.max(b.minX - x, x - b.maxX, b.minZ - z, z - b.maxZ);
      const s = road[k]!;
      bed[k] = Math.max(s, zone[k]!, out); // the fillets only (tucked 0.1 under the composer's strips)
      walk[k] = Math.max(-s, s - w, S.railClear - rail[k]!, out);
    }
  }

  // ---- corner road fill + sidewalks
  slab(regions(g, bed, undefined, 0.002, 0.0005), { top: S.roadTop }, parts.get('road'), parts.get('road'));
  slab(regions(g, walk), { top: S.walkTop, bevel: S.bevel }, parts.get('ssWalk'), parts.get('ssCurb'));
  const joints = sidewalkJoints(map, g, walk, parts.get('ssJoint', 0, true));

  // ---- bus-stop bays and zebra crossings (skipping any crossing that would overlap a bay)
  const bays = stopBays(map, h, BAY.len, BAY.wid);
  for (const bay of bays) bayPaint(bay, parts.get('ssBay'));
  const zebraRect = (c: Crossing) => ({ x: c.x, z: c.z, u: { x: c.ux, z: c.uz }, hu: ZEBRA.depth / 2 + 0.15, hv: h });
  const bayRect = (q: Bay) => ({ x: q.x, z: q.z, u: q.u, hu: q.len / 2 + 0.15, hv: q.wid / 2 + 0.1 });
  const crossings = crossingsNearStops(map, arms, { near: 9, far: 14, from: h + ZEBRA.setback + ZEBRA.depth / 2 })
    .filter((c) => !bays.some((q) => rectsOverlap(zebraRect(c), bayRect(q))));
  for (const c of crossings) {
    const u = { x: c.ux, z: c.uz }, n = { x: -c.uz, z: c.ux };
    for (let s = 0; s < ZEBRA.stripes; s++) {
      const off = (s - (ZEBRA.stripes - 1) / 2) * ZEBRA.pitch;
      paintQuad(parts.get('ssZebra'), c.x + n.x * off, c.z + n.z * off, u, ZEBRA.depth, ZEBRA.width, S.markTop);
    }
  }

  // ---- district footpaths and plaza-edge bands
  const allPaths = districts.flatMap((d) => d.paths ?? []).filter((p) => p.points.length >= 2 && p.width > 0);
  const pathFields: Array<{ kind: FootPath['kind']; f: (p: Vec2) => number }> = [];
  for (const kind of ['footpath', 'plaza-edge'] as const) {
    const list = allPaths.filter((p) => p.kind === kind);
    if (!list.length) continue;
    const top = S.heights[kind];
    const kU = 0.5, kFlare = 0.45;
    const maxHalf = Math.max(...list.map((p) => p.width / 2));
    const reach = maxHalf + kU + kFlare + 0.6;
    const xs = list.flatMap((p) => p.points.map((q) => q.x)), zs = list.flatMap((p) => p.points.map((q) => q.z));
    const win = windowOf(g, Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), reach + 0.3);
    const acc = field(g, reach), tmp = field(g, reach);
    for (const p of list) {
      tmp.fill(reach);
      stampPolyline(g, tmp, p.points, false, reach, -p.width / 2);
      for (let j = win[1]; j <= win[3]; j++) for (let i = win[0]; i <= win[2]; i++) {
        const k = j * g.nx + i;
        acc[k] = kind === 'footpath' ? smin(acc[k]!, tmp[k]!, kU) : Math.min(acc[k]!, tmp[k]!);
      }
    }
    const F = field(g, 1);
    for (let j = win[1]; j <= win[3]; j++) {
      const z = g.z0 + j * g.c;
      for (let i = win[0]; i <= win[2]; i++) {
        const x = g.x0 + i * g.c, k = j * g.nx + i;
        const P = acc[k]!, Q = road[k]! - w;
        const out = Math.max(b.minX - x, x - b.maxX, b.minZ - z, z - b.maxZ, S.railClear - rail[k]!);
        const flare = kind === 'footpath' ? Math.max(smin(P, Q, kFlare), -Q - 0.05, P - kFlare) : 1;
        const under = Math.max(P, -Q - 0.3);
        F[k] = Math.max(Math.min(flare, under), out);
      }
    }
    // keep the window border outside so every loop closes
    for (let i = win[0]; i <= win[2]; i++) { F[win[1] * g.nx + i] = 1; F[win[3] * g.nx + i] = 1; }
    for (let j = win[1]; j <= win[3]; j++) { F[j * g.nx + win[0]] = 1; F[j * g.nx + win[2]] = 1; }
    const polys = regions(g, F, win);
    const roleTop = kind === 'footpath' ? 'ssPath' : 'ssPlazaEdge';
    slab(polys, { top, bevel: 0.014 }, parts.get(roleTop), parts.get(roleTop));
    pathFields.push({ kind, f: (q: Vec2) => Math.min(...list.map((p) => polyDist(q, p.points, false) - p.width / 2)) });
  }

  // ---- district areas
  const H = S.heights;
  const { stats: areaStats, outlines } = buildAreas(districts.flatMap((d) => d.areas ?? []), H, parts.get);

  // ---- bake
  const root = parts.group();
  const baked = bakeGeometry(root, palette, { resolve: resolveRole });
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
  const index = baked.geometry.index;
  const triangles = (index ? index.count : baked.geometry.getAttribute('position').count) / 3;

  const heightAt = (x: number, z: number): number => surfaceHeight(map, corners, outlines, pathFields, x, z);
  return { baked, crossings, bays, heightAt, stats: { triangles, ms: now() - t0, ...areaStats, joints } };
}

/** Paving joints: a thin groove across both sidewalks every JOINT u along each road edge, only where the whole
 *  joint lies on sidewalk (so none cross a junction corner, the rail gap or the board edge). */
const JOINT = { pitch: 1.2, wid: 0.05, inset: 0.1 } as const;
function sidewalkJoints(map: TownMap, g: ReturnType<typeof makeGrid>, walk: Float32Array, m: Mesher): number {
  const S = STREETSCAPE, h = S.roadHalf, w = S.walk;
  let count = 0;
  const at = (x: number, z: number) => {
    const i = Math.round((x - g.x0) / g.c), j = Math.round((z - g.z0) / g.c);
    return i < 0 || j < 0 || i >= g.nx || j >= g.nz ? 1 : walk[j * g.nx + i]!;
  };
  const nodes = map.roads.nodes.map((n) => n.p);
  for (const e of map.roads.edges) {
    const n0 = Math.floor((e.path.length - 1.2) / JOINT.pitch);
    if (n0 < 1) continue;
    const start = (e.path.length - n0 * JOINT.pitch) / 2;
    for (let k = 0; k <= n0; k++) {
      const d = start + k * JOINT.pitch;
      const p = pointAt(e.path, d), q = pointAt(e.path, Math.min(e.path.length, d + 0.05));
      const L = Math.hypot(q.x - p.x, q.z - p.z);
      if (L < 1e-6) continue;
      const n = { x: -(q.z - p.z) / L, z: (q.x - p.x) / L };
      if (nodes.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < h + w + 0.4)) continue;
      for (const side of [-1, 1]) {
        const r0 = h + JOINT.inset, r1 = h + w - JOINT.inset * 0.6;
        const a = { x: p.x + n.x * side * r0, z: p.z + n.z * side * r0 }, b = { x: p.x + n.x * side * r1, z: p.z + n.z * side * r1 };
        const c = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
        if (at(a.x, a.z) > -0.03 || at(b.x, b.z) > -0.03 || at(c.x, c.z) > -0.03) continue;
        paintQuad(m, c.x, c.z, { x: n.x * side, z: n.z * side }, r1 - r0, JOINT.wid, S.walkTop + 0.004);
        count++;
      }
    }
  }
  return count;
}

/** Painted bay: an open box along the kerb (long line on the road side, two end ticks) + corner ticks. */
function bayPaint(q: Bay, m: Mesher): void {
  const y = STREETSCAPE.markTop, L = BAY.line;
  const inner = { x: q.x - q.n.x * (q.wid / 2), z: q.z - q.n.z * (q.wid / 2) };
  paintQuad(m, inner.x, inner.z, q.u, q.len, L, y);
  for (const s of [-1, 1]) {
    const e = { x: q.x + q.u.x * s * (q.len / 2 - L / 2), z: q.z + q.u.z * s * (q.len / 2 - L / 2) };
    paintQuad(m, e.x, e.z, q.n, q.wid, L, y);
  }
}

function surfaceHeight(
  map: TownMap, corners: ReturnType<typeof cornersOf>, outlines: AreaOutline[],
  paths: Array<{ kind: FootPath['kind']; f: (p: Vec2) => number }>, x: number, z: number,
): number {
  const S = STREETSCAPE, b = map.bounds, p = { x, z };
  if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return 0;
  const s = roadS(map, corners, S.roadHalf, S.cornerR, p);
  if (s < 0) return 0;
  const railD = polyDist(p, map.rail.loop.points, true);
  if (s < S.walk && railD > S.railClear) return S.walkTop;
  let y = 0;
  for (const a of outlines) if (a.top > y && pointInLoop(p, a.loop)) y = a.top;
  for (const pf of paths) if (S.heights[pf.kind] > y && pf.f(p) < 0 && railD > S.railClear) y = S.heights[pf.kind];
  return y;
}

/** The streetscape as a render layer: one mesh, recoloured in place on palette switches. */
export function createStreetscapeLayer(map: TownMap, districts: DistrictScenery[]): RenderLayer {
  const built = buildStreetscape(map, districts);
  const material = new KitMaterial();
  const mesh = new THREE.Mesh(built.baked.geometry, material);
  mesh.name = 'streetscape-ground';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.matrixAutoUpdate = false;
  const object = new THREE.Group();
  object.name = `streetscape:${map.version}:${districts.length}`;
  object.add(mesh);
  object.userData.heightAt = built.heightAt;
  object.userData.crossings = built.crossings;
  object.userData.bays = built.bays;
  return {
    name: 'streetscape',
    object,
    update() {},
    setPalette(p: PaletteId) { recolorBaked(built.baked, p); },
    dispose() { built.baked.geometry.dispose(); material.dispose(); },
  };
}
