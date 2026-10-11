// Owner: E2. "Nittany Lake" as pure data (no three.js): water level, the beach profile and its along-shore
// coordinates, causeways for the water-side road exits, the lighthouse point, the marina, beach scenery, boats and
// their motion, warm lights (dusk reflections) and foam obstacles. Built once from (map, layout); every mesh and the
// water shader read from it, and the tests check it (nothing on the board, nothing tall hiding gameplay).
//
// Frame: board top y = 0, x east, z south; the camera looks from +x/+z, so the lake (south + east) is the foreground.
import { pointAt } from '@headway/sim';
import type { TownMap, Vec2 } from '@headway/sim';
import type { Side, WorldLayout } from '../layout';

/** Water surface height (board top is y = 0). */
export const WATER_Y = -0.75;
/** Sand height where the beach meets the board edge (a hair under the grass so the board edge reads). */
export const BEACH_Y = -0.04;
/** Lake bed: the beach keeps sloping down to here. */
export const LAKE_BED_Y = -2.4;
/** Road deck top on the causeways (flush with the roads on the board). */
export const DECK_Y = 0.04;
/** Marina boardwalk top. */
export const PIER_Y = 0.14;
/** Lamp head height above its base (matches the street lamp). */
export const LAMP_HEAD_Y = 1.99;

export interface Box2 { minX: number; maxX: number; minZ: number; maxZ: number }
/** Segment a→b swept by radius r (a = b for a disc). */
export interface Capsule { a: Vec2; b: Vec2; r: number }

export interface Shore {
  /** Along-shore coordinate range covered by the beach (west end of the south beach → north end of the east beach). */
  sMin: number;
  sMax: number;
  /** Mean beach width (board edge → waterline). */
  mean: number;
  /** Distance outside the board quadrant {x ≤ maxX, z ≤ maxZ} (negative inside). */
  boardDist(x: number, z: number): number;
  /** Along-shore coordinate of (x, z): x on the south edge, an arc around the SE corner, then down the east edge. */
  along(x: number, z: number): number;
  /** Beach width at along-shore coordinate s. */
  width(s: number): number;
  /** Ground height of the beach (sand, then lake bed) at (x, z). */
  ground(x: number, z: number): number;
  /** Point at along-shore s, d units out from the board edge, with the outward normal. */
  at(s: number, d: number): { x: number; z: number; nx: number; nz: number };
}

export interface Bridge {
  edgeId: string;
  side: Side;
  /** Road exit point on the board edge, unit direction away from the board, length to the diorama edge. */
  from: Vec2;
  dir: Vec2;
  len: number;
  /** Deck width (road + sidewalks + parapets). */
  width: number;
  /** Distance along `dir` where the abutment ends and the bridge leaves the beach. */
  shoreAt: number;
  /** Pier centres (distance along `dir`). */
  piers: number[];
  lamps: Array<{ at: number; side: 1 | -1 }>;
  /** Distance ranges along `dir` with no parapets (level crossings where the rail runs across the causeway). */
  gaps: Array<[number, number]>;
}

/** One stretch of the off-board rail: on a deck over the water, or on a ballast berm across the beach. */
export interface RailRun { kind: 'deck' | 'berm'; pts: Vec2[] }
/** The rail where the loop leaves the board over the beach and the bay: track runs, piers (with unit tangent). */
export interface Viaduct {
  runs: RailRun[];
  piers: Array<{ x: number; z: number; dx: number; dz: number }>;
  /** Deck top (the track's ballast sits on it at y = 0) and overall deck width incl. parapets. */
  deckTop: number;
  width: number;
}

export type PropKind =
  | 'hut' | 'umbrella' | 'towel' | 'lifeguard' | 'rowboat' | 'castle' | 'rock' | 'grass' | 'driftwood'
  | 'boathouse' | 'lamp' | 'flag' | 'bench' | 'lighthouse' | 'cottage' | 'pierDeck' | 'pile' | 'bollard' | 'lifering' | 'crates'
  | 'xsign';

/** One static thing. y = base height; w × d footprint (x × z before `rot`), h = height above the base. */
export interface Prop { kind: PropKind; x: number; z: number; y: number; rot: number; v: number; w: number; d: number; h: number }

export type BoatKind = 'sail' | 'motor' | 'buoy' | 'float' | 'duck' | 'duckling';
export interface BoatLoop { cx: number; cz: number; rx: number; rz: number; period: number; phase: number; cw: boolean }
export interface Boat {
  kind: BoatKind;
  /** Colour variant. */
  v: number;
  /** Mooring spot (or where the loop starts) and heading (rotation about +y; local +x is the bow). */
  x: number;
  z: number;
  heading: number;
  loop?: BoatLoop;
  /** Trail another boat's loop (ducklings): index into `boats` + time lag (s). */
  follow?: { lead: number; lag: number };
  /** Bob amplitude (1 = boat). */
  bob: number;
  seed: number;
}
export interface BoatPose { x: number; z: number; heading: number; roll: number; pitch: number; heave: number }

/** Warm light that reflects in the water at dusk. */
export interface LightSpot { x: number; y: number; z: number; strength: number; kind: 'lamp' | 'beacon' | 'window' }

export interface Marina { x: number; root: number; waterline: number; rows: number[]; head: number; finger: number }

export interface WaterPlan {
  board: Box2;
  extent: Box2;
  shore: Shore;
  /** The rocky point the lighthouse stands on (part of the land). */
  point: Capsule;
  marina: Marina;
  bridges: Bridge[];
  /** The rail loop's lakeshore + bay crossing (empty when the loop stays on the board). */
  viaduct: Viaduct;
  props: Prop[];
  boats: Boat[];
  lights: LightSpot[];
  /** Small things standing in the water (piers, piles, moored hulls, rocks): the water draws foam rings around them. */
  foam: Capsule[];
  /** Rectangles the water surface covers (south strip, east strip), slightly tucked under the beach. */
  regions: Box2[];
  /** Signed distance to the nearest land (beach, board, point) at the mean water level: > 0 on water. */
  waterDist(x: number, z: number): number;
}

// ---------------------------------------------------------------- helpers
export function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x, abz = b.z - a.z, l2 = abx * abx + abz * abz;
  const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / l2)) : 0;
  return Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t));
}
/** Signed distance from p to a capsule (negative inside). */
export function capsuleDist(p: Vec2, c: Capsule): number {
  return segDist(p, c.a, c.b) - c.r;
}
function prng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- shore
export function makeShore(board: Box2, mean: number): Shore {
  const { maxX, maxZ, minX, minZ } = board;
  const arc = (Math.PI / 2) * mean;
  const boardDist = (x: number, z: number): number => {
    const dx = x - maxX, dz = z - maxZ;
    return dx > 0 && dz > 0 ? Math.hypot(dx, dz) : Math.max(dx, dz);
  };
  const along = (x: number, z: number): number => {
    const dx = x - maxX, dz = z - maxZ;
    if (dx <= 0) return x;
    if (dz <= 0) return maxX + arc + (maxZ - z);
    return maxX + (Math.atan2(dx, dz) / (Math.PI / 2)) * arc;
  };
  // Gentle meanders (±0.75 u) so the waterline is hand-made, not ruled.
  const width = (s: number): number =>
    mean + 0.42 * Math.sin(0.165 * s + 1.1) + 0.24 * Math.sin(0.43 * s + 0.4) + 0.08 * Math.sin(1.07 * s + 2.3);
  const drop = BEACH_Y - WATER_Y;
  const ground = (x: number, z: number): number => {
    const d = boardDist(x, z);
    if (d <= 0) return BEACH_Y;
    const t = d / width(along(x, z));
    // dry sand stays nearly flat, then the bank steepens into the water (slope keeps going under the surface)
    const f = t <= 1 ? t * t : 1 + 2 * (t - 1);
    return Math.max(LAKE_BED_Y, BEACH_Y - drop * f);
  };
  const at = (s: number, d: number) => {
    if (s <= maxX) return { x: s, z: maxZ + d, nx: 0, nz: 1 };
    if (s >= maxX + arc) return { x: maxX + d, z: maxZ - (s - maxX - arc), nx: 1, nz: 0 };
    const th = ((s - maxX) / arc) * (Math.PI / 2);
    const nx = Math.sin(th), nz = Math.cos(th);
    return { x: maxX + nx * d, z: maxZ + nz * d, nx, nz };
  };
  return { sMin: minX - 8, sMax: maxX + arc + (maxZ - (minZ - 8)), mean, boardDist, along, width, ground, at };
}

// ---------------------------------------------------------------- the rail over the beach + bay
/** Deck top: a hair under the track's ballast (base y = 0). */
export const RAIL_DECK_Y = -0.01;
const RAIL_STEP = 0.5;

/** Where the rail loop leaves the board on the lake side (south / east, not the west tunnel): sample it every 0.5 u,
 *  split it into beach runs (a ballast berm) and water runs (a deck on piers), overlapping by one sample. */
export function planViaduct(map: TownMap, board: Box2, shore: Shore): Viaduct {
  const loop = map.rail.loop;
  const L = loop.length;
  const n = Math.max(1, Math.floor(L / RAIL_STEP));
  const step = L / n;
  const off = (p: Vec2) => shore.boardDist(p.x, p.z) > 0.01 && p.x > board.minX && p.z > board.minZ;
  const pts = Array.from({ length: n }, (_, i) => pointAt(loop, i * step));
  const runs: RailRun[] = [];
  const piers: Viaduct['piers'] = [];
  const result: Viaduct = { runs, piers, deckTop: RAIL_DECK_Y, width: 2.7 };
  const start = pts.findIndex((p) => !off(p));
  if (start < 0) return result;
  // walk the loop once from an on-board sample, collecting contiguous off-board stretches
  let cur: number[] | null = null;
  const stretches: number[][] = [];
  for (let k = 1; k <= n; k++) {
    const i = (start + k) % n;
    if (off(pts[i]!)) (cur ??= []).push(i);
    else if (cur) { stretches.push(cur); cur = null; }
  }
  const wet = (p: Vec2) => shore.ground(p.x, p.z) < WATER_Y + 0.25;
  for (const st of stretches) {
    // one sample back onto the board at each end so the berm meets the board edge
    const idx = [(st[0]! - 1 + n) % n, ...st, (st[st.length - 1]! + 1) % n];
    let run: RailRun | null = null;
    idx.forEach((i) => {
      const p = pts[i]!;
      const kind: RailRun['kind'] = wet(p) ? 'deck' : 'berm';
      if (!run || run.kind !== kind) {
        const prev: Vec2 | undefined = run?.pts[run.pts.length - 1];
        run = { kind, pts: prev ? [prev] : [] };
        runs.push(run);
      }
      run.pts.push(p);
    });
  }
  // piers under the decks, every ~4.4 u of arc, only where the water is deep enough
  for (const run of runs) {
    if (run.kind !== 'deck') continue;
    let acc = 0, next = 1.4;
    for (let k = 1; k < run.pts.length; k++) {
      const a = run.pts[k - 1]!, b = run.pts[k]!;
      acc += Math.hypot(b.x - a.x, b.z - a.z);
      if (acc < next) continue;
      if (shore.ground(b.x, b.z) >= WATER_Y - 0.35) { next = acc + 0.5; continue; }
      const c = run.pts[Math.min(run.pts.length - 1, k + 1)]!, o = run.pts[Math.max(0, k - 1)]!;
      const tl = Math.hypot(c.x - o.x, c.z - o.z) || 1;
      piers.push({ x: b.x, z: b.z, dx: (c.x - o.x) / tl, dz: (c.z - o.z) / tl });
      next = acc + 4.4;
    }
  }
  return result;
}

// ---------------------------------------------------------------- plan
export function planWater(map: TownMap, layout: WorldLayout): WaterPlan {
  const board: Box2 = { ...map.bounds };
  const extent: Box2 = { ...layout.extent };
  const mean = Math.max(3.2, Math.min(4.8, ((layout.shore.south - board.maxZ) + (layout.shore.east - board.maxX)) / 2));
  const shore = makeShore(board, mean);
  const rnd = prng(0x1a4e);

  // The rocky point: off the east beach on Main St's axis, so the street leads the eye to the lighthouse.
  const pz = 0;
  const point: Capsule = { a: { x: board.maxX + 2.4, z: pz + 0.6 }, b: { x: board.maxX + 10.2, z: pz - 0.9 }, r: 2.05 };
  const waterDist = (x: number, z: number): number => {
    const beach = shore.boardDist(x, z) - shore.width(shore.along(x, z));
    return Math.min(beach, capsuleDist({ x, z }, point));
  };

  const props: Prop[] = [];
  const foam: Capsule[] = [];
  const lights: LightSpot[] = [];
  const boats: Boat[] = [];
  const add = (p: Partial<Prop> & { kind: PropKind; x: number; z: number }): Prop => {
    const full: Prop = { y: shore.ground(p.x, p.z), rot: 0, v: 0, w: 1, d: 1, h: 0.5, ...p };
    props.push(full);
    return full;
  };
  const disc = (x: number, z: number, r: number) => foam.push({ a: { x, z }, b: { x, z }, r });

  // ---- the rail loop off the board's south edge: a ballast berm across the beach, a viaduct over the bay
  const viaduct = planViaduct(map, board, shore);
  const loop = map.rail.loop;
  const railPts: Vec2[] = [];
  for (let d = 0; d < loop.length; d += 0.25) {
    const p = pointAt(loop, d);
    if (p.z > board.maxZ - 8 || p.x > board.maxX - 8) railPts.push(p); // only the stretches near the lake matter
  }
  /** Distance to the rail centreline (near the lake). */
  const railDist = (x: number, z: number): number => {
    let m = Infinity;
    for (const p of railPts) { const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z); if (d < m) m = d; }
    return Math.sqrt(m);
  };
  for (const pr of viaduct.piers) {
    const nx = -pr.dz, nz = pr.dx, hw = viaduct.width / 2 - 0.3;
    foam.push({ a: { x: pr.x - nx * hw, z: pr.z - nz * hw }, b: { x: pr.x + nx * hw, z: pr.z + nz * hw }, r: 0.42 });
  }
  for (const run of viaduct.runs) {
    if (run.kind !== 'deck') continue;
    for (const p of [run.pts[0]!, run.pts[run.pts.length - 1]!]) if (shore.ground(p.x, p.z) < WATER_Y + 0.1) disc(p.x, p.z, 1.2);
  }

  // ---- causeways: one per water-side road exit, from the board edge to the diorama edge
  const bridges: Bridge[] = [];
  for (const e of layout.exits) {
    if (e.kind !== 'bridge') continue;
    const dir = { x: e.dir.x, z: e.dir.z };
    const ts: number[] = [];
    if (dir.x > 1e-6) ts.push((extent.maxX - e.p.x) / dir.x);
    if (dir.x < -1e-6) ts.push((extent.minX - e.p.x) / dir.x);
    if (dir.z > 1e-6) ts.push((extent.maxZ - e.p.z) / dir.z);
    if (dir.z < -1e-6) ts.push((extent.minZ - e.p.z) / dir.z);
    const len = Math.min(...ts);
    let shoreAt = 0;
    while (shoreAt < len && shore.ground(e.p.x + dir.x * shoreAt, e.p.z + dir.z * shoreAt) > WATER_Y) shoreAt += 0.05;
    shoreAt += 0.7; // the abutment's toe stands in the shallows
    const piers: number[] = [];
    for (let at = shoreAt + 3.1; at < len - 1.6; at += 4.6) piers.push(at);
    // level crossings: where the rail runs across the causeway, open the parapets (±2 u) and keep lamps away
    const gaps: Array<[number, number]> = [];
    for (let at = 0; at <= len; at += 0.05) {
      if (railDist(e.p.x + dir.x * at, e.p.z + dir.z * at) > 1.6) continue;
      const last = gaps[gaps.length - 1];
      if (last && at - 0.4 <= last[1] + 0.1) last[1] = at + 0.4;
      else gaps.push([Math.max(0, at - 0.4), at + 0.4]);
    }
    const lamps: Bridge['lamps'] = [];
    let side: 1 | -1 = 1;
    for (let at = 1.8; at < len - 2.5; at += 8.6) {
      let a = at;
      while (a < len - 2.5 && railDist(e.p.x + dir.x * a, e.p.z + dir.z * a) < 2.4) a += 0.5;
      if (a >= len - 2.5) continue;
      lamps.push({ at: a, side });
      side = side === 1 ? -1 : 1;
    }
    const br: Bridge = { edgeId: e.edgeId, side: e.side, from: { x: e.p.x, z: e.p.z }, dir, len, width: 3.5, shoreAt, piers, lamps, gaps };
    bridges.push(br);
    const nx = -dir.z, nz = dir.x;
    // a level-crossing sign past each crossing, on the camera-side sidewalk (so it never hides the track)
    for (const [, c] of gaps) {
      const off = br.width / 2 - 0.3, at = c + 0.35;
      const cands = [1, -1].map((sd) => ({ x: e.p.x + dir.x * at + nx * off * sd, z: e.p.z + dir.z * at + nz * off * sd }));
      const q = cands[0]!.x + cands[0]!.z > cands[1]!.x + cands[1]!.z ? cands[0]! : cands[1]!;
      if (at < len - 1) add({ kind: 'xsign', x: q.x, z: q.z, y: DECK_Y + 0.07, rot: Math.atan2(dir.x, dir.z) + Math.PI, w: 0.5, d: 0.2, h: 1.45 });
    }
    for (const at of piers) {
      const cx = e.p.x + dir.x * at, cz = e.p.z + dir.z * at, hw = br.width / 2 - 0.25;
      foam.push({ a: { x: cx - nx * hw, z: cz - nz * hw }, b: { x: cx + nx * hw, z: cz + nz * hw }, r: 0.42 });
    }
    // the abutment toe and its riprap
    {
      const cx = e.p.x + dir.x * shoreAt, cz = e.p.z + dir.z * shoreAt, hw = br.width / 2;
      foam.push({ a: { x: cx - nx * hw, z: cz - nz * hw }, b: { x: cx + nx * hw, z: cz + nz * hw }, r: 0.35 });
      for (const s of [-1, 1]) {
        for (let k = 0; k < 3; k++) {
          const at = shoreAt - 1.6 + k * 0.9 + rnd() * 0.3;
          const off = hw + 0.35 + rnd() * 0.35;
          const x = e.p.x + dir.x * at + nx * off * s, z = e.p.z + dir.z * at + nz * off * s;
          add({ kind: 'rock', x, z, y: Math.max(shore.ground(x, z), WATER_Y - 0.25), v: k + (s > 0 ? 0 : 1), w: 0.9 - k * 0.15, d: 0.8, h: 0.55 - k * 0.08, rot: rnd() * 6.28 });
        }
      }
    }
    for (const l of lamps) {
      const off = br.width / 2 - 0.3;
      const x = e.p.x + dir.x * l.at + nx * off * l.side, z = e.p.z + dir.z * l.at + nz * off * l.side;
      add({ kind: 'lamp', x, z, y: DECK_Y + 0.1, w: 0.4, d: 0.4, h: 2.4 });
      lights.push({ x, y: DECK_Y + 0.1 + LAMP_HEAD_Y, z, strength: 1, kind: 'lamp' });
    }
  }
  const inBridgeCorridor = (x: number, z: number, pad: number): boolean =>
    bridges.some((br) => {
      const rx = x - br.from.x, rz = z - br.from.z;
      const along = rx * br.dir.x + rz * br.dir.z, across = Math.abs(rx * br.dir.z - rz * br.dir.x);
      return along > -pad && along < br.len + pad && across < br.width / 2 + pad;
    });

  // ---- marina: a boardwalk from the south-west beach (the rail viaduct owns the south-east), two finger rows, a T head
  const MX = -14.5;
  const zw = board.maxZ + shore.width(MX);
  const marina: Marina = { x: MX, root: board.maxZ + 1.3, waterline: zw, rows: [zw + 3.1, zw + 6.2], head: zw + 9.2, finger: 4.3 };
  {
    const deckH = 0.2;
    const mainLen = marina.head - marina.root;
    add({ kind: 'pierDeck', x: MX, z: (marina.root + marina.head) / 2, y: PIER_Y - deckH, w: 1.4, d: mainLen + 0.6, h: deckH });
    for (const rz of marina.rows) {
      for (const s of [-1, 1]) {
        add({ kind: 'pierDeck', x: MX + s * (0.7 + marina.finger / 2), z: rz, y: PIER_Y - deckH, w: marina.finger, d: 0.8, h: deckH });
        add({ kind: 'pile', x: MX + s * (0.7 + marina.finger - 0.15), z: rz + 0.42, y: WATER_Y - 0.3, w: 0.22, d: 0.22, h: PIER_Y + 0.45 - (WATER_Y - 0.3) });
        disc(MX + s * (0.7 + marina.finger - 0.15), rz + 0.42, 0.13);
        add({ kind: 'bollard', x: MX + s * (0.7 + marina.finger * 0.55), z: rz - 0.25, y: PIER_Y, w: 0.16, d: 0.16, h: 0.2 });
      }
      foam.push({ a: { x: MX - 0.7 - marina.finger, z: rz }, b: { x: MX + 0.7 + marina.finger, z: rz }, r: 0.08 });
    }
    // T head
    const headW = 2 * (0.7 + marina.finger) + 1.6;
    add({ kind: 'pierDeck', x: MX, z: marina.head, y: PIER_Y - deckH, w: headW, d: 1.2, h: deckH });
    foam.push({ a: { x: MX - headW / 2, z: marina.head }, b: { x: MX + headW / 2, z: marina.head }, r: 0.12 });
    for (const s of [-1, 1]) {
      for (let z = zw - 0.4; z < marina.head; z += 2.3) {
        add({ kind: 'pile', x: MX + s * 0.78, z, y: WATER_Y - 0.3, w: 0.2, d: 0.2, h: PIER_Y + 0.12 - (WATER_Y - 0.3) });
        disc(MX + s * 0.78, z, 0.12);
      }
      for (const fx of [0.4, 0.75, 1]) {
        const x = MX + s * (headW / 2) * fx - s * 0.2;
        add({ kind: 'pile', x, z: marina.head + 0.68, y: WATER_Y - 0.3, w: 0.22, d: 0.22, h: PIER_Y + 0.4 - (WATER_Y - 0.3) });
        disc(x, marina.head + 0.68, 0.13);
      }
    }
    foam.push({ a: { x: MX, z: zw - 0.3 }, b: { x: MX, z: marina.head }, r: 0.1 });
    // shore end: boathouse, lamps, flag, life ring, crates
    add({ kind: 'boathouse', x: MX + 3.1, z: board.maxZ + 1.7, w: 2.5, d: 2.2, h: 2.35 });
    lights.push({ x: MX + 3.1, y: 1.85, z: board.maxZ + 2.7, strength: 0.45, kind: 'window' });
    add({ kind: 'flag', x: MX + 4.6, z: board.maxZ + 0.9, w: 0.3, d: 0.3, h: 3.2 });
    add({ kind: 'lifering', x: MX - 1.05, z: zw - 0.55, y: PIER_Y - 0.1, w: 0.3, d: 0.3, h: 0.9 });
    add({ kind: 'crates', x: MX - 1.7, z: board.maxZ + 1.2, rot: 0.3, w: 0.9, d: 0.7, h: 0.6 });
    for (const [x, z] of [[MX - 0.55, zw + 1.6], [MX + 0.55, marina.rows[1]! + 1.5], [MX - 0.55, marina.head + 0.4]] as const) {
      add({ kind: 'lamp', x, z, y: PIER_Y, w: 0.4, d: 0.4, h: 2.4 });
      lights.push({ x, y: PIER_Y + LAMP_HEAD_Y, z, strength: 0.9, kind: 'lamp' });
    }
    // moored boats: slips between the rows, one alongside the head
    const slips: Array<[number, number, number, BoatKind, number]> = [
      [MX - 2.85, (marina.rows[0]! + marina.rows[1]!) / 2, 0, 'sail', 0],
      [MX + 2.85, (marina.rows[0]! + marina.rows[1]!) / 2, Math.PI, 'motor', 1],
      [MX - 2.85, (marina.rows[1]! + marina.head) / 2, 0, 'motor', 0],
      [MX + 2.85, (marina.rows[1]! + marina.head) / 2, Math.PI, 'sail', 2],
      [MX - 3.2, marina.head + 1.45, Math.PI, 'sail', 1],
    ];
    for (const [x, z, heading, kind, v] of slips) {
      boats.push({ kind, v, x, z, heading, bob: 1, seed: boats.length * 1.7 + 0.3 });
      const fx = Math.cos(heading), fz = -Math.sin(heading);
      foam.push({ a: { x: x - fx * 0.75, z: z - fz * 0.75 }, b: { x: x + fx * 0.75, z: z + fz * 0.75 }, r: 0.4 });
    }
    // channel buoys
    boats.push({ kind: 'buoy', v: 0, x: MX + 7.2, z: marina.head + 0.8, heading: 0, bob: 0.8, seed: 11.1 });
    boats.push({ kind: 'buoy', v: 1, x: MX + 7.4, z: marina.rows[0]! + 0.4, heading: 0, bob: 0.8, seed: 12.7 });
  }

  // ---- beach huts on the south-west beach, with a swim-zone float line off them
  const hutZ = (x: number) => board.maxZ + 1.25 + (shore.width(x) - mean) * 0.2;
  for (let i = 0; i < 5; i++) {
    const x = -31.2 + i * 2.05;
    add({ kind: 'hut', x, z: hutZ(x), v: i, w: 1.5, d: 1.3, h: 2.05 });
  }
  for (let k = 0; k < 5; k++) {
    const x = -33 + k * 2.2;
    boats.push({ kind: 'float', v: k % 2, x, z: board.maxZ + shore.width(x) + 1.7 + Math.sin(k * 1.3) * 0.15, heading: 0, bob: 0.6, seed: 31 + k });
  }
  // ---- the lagoon beach: sheltered behind the rail viaduct (south-east): umbrellas, towels, a lifeguard chair, a
  //      sandcastle, a beached rowboat, driftwood, and a duck family paddling in the lagoon
  const umbrellas: Array<[number, number, number]> = [[12.4, 2.0, 0], [15.9, 2.35, 1], [19.3, 1.95, 2]];
  for (const [x, d, v] of umbrellas) {
    add({ kind: 'umbrella', x, z: board.maxZ + d, v, w: 1.4, d: 1.4, h: 1.55 });
    add({ kind: 'towel', x: x + 0.55, z: board.maxZ + d + 0.55, v: v + 1, rot: 0.25 - v * 0.2, w: 0.6, d: 1.1, h: 0.02 });
  }
  add({ kind: 'lifeguard', x: 22.6, z: board.maxZ + 1.7, w: 1.0, d: 1.0, h: 2.3 });
  add({ kind: 'castle', x: 14.1, z: board.maxZ + 2.75, w: 0.7, d: 0.7, h: 0.5 });
  add({ kind: 'rowboat', x: 24.9, z: board.maxZ + 2.4, rot: 0.35, w: 1.5, d: 0.7, h: 0.45 });
  add({ kind: 'driftwood', x: 10.4, z: board.maxZ + 2.7, rot: -0.4, w: 1.6, d: 0.3, h: 0.2 });
  add({ kind: 'bench', x: 10.2, z: board.maxZ + 0.9, rot: 0, w: 1.3, d: 0.5, h: 0.6 });
  {
    const lead = boats.length;
    const cz = board.maxZ + mean + 2.35;
    boats.push({ kind: 'duck', v: 0, x: 17, z: cz, heading: 0, bob: 0.5, seed: 21.3, loop: { cx: 17.2, cz, rx: 3.2, rz: 0.6, period: 74, phase: 0.4, cw: false } });
    for (let k = 1; k <= 3; k++) boats.push({ kind: 'duckling', v: 0, x: 17, z: cz, heading: 0, bob: 0.5, seed: 21.3 + k, follow: { lead, lag: k * 1.55 } });
  }

  // ---- the lighthouse point
  {
    const { a, b } = point;
    add({ kind: 'lighthouse', x: b.x, z: b.z, y: 0.12, w: 2.0, d: 2.0, h: 5.9 });
    lights.push({ x: b.x, y: 0.12 + 4.85, z: b.z, strength: 2.2, kind: 'beacon' });
    const cx = a.x + (b.x - a.x) * 0.42, cz = a.z + (b.z - a.z) * 0.42 - 0.35;
    add({ kind: 'cottage', x: cx, z: cz, y: 0.12, rot: -0.19, w: 2.0, d: 1.7, h: 2.15 });
    lights.push({ x: cx + 0.1, y: 0.9, z: cz + 0.9, strength: 0.5, kind: 'window' });
    add({ kind: 'bench', x: a.x + (b.x - a.x) * 0.72, z: a.z + (b.z - a.z) * 0.72 + 1.25, y: 0.12, rot: 0.08, w: 1.3, d: 0.5, h: 0.6 });
    // boulders around the rim
    const len = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
    const per = 2 * len + 2 * Math.PI * point.r;
    for (let k = 0; k < 17; k++) {
      const u = (k / 17) * per + rnd() * 0.5;
      let x: number, z: number;
      if (u < len) { x = a.x + ux * u + uz * point.r; z = a.z + uz * u - ux * point.r; }
      else if (u < len + Math.PI * point.r) {
        const th = (u - len) / point.r; // around the tip
        const c = Math.cos(th), s = Math.sin(th);
        x = b.x + (uz * c + ux * s) * point.r; z = b.z + (-ux * c + uz * s) * point.r;
      } else if (u < 2 * len + Math.PI * point.r) {
        const w = u - len - Math.PI * point.r;
        x = b.x - ux * w - uz * point.r; z = b.z - uz * w + ux * point.r;
      } else continue; // the root side meets the beach
      if (x < board.maxX + 1.6) continue;
      const s = 0.75 + rnd() * 0.55;
      add({ kind: 'rock', x, z, y: WATER_Y - 0.2, v: k % 4, rot: rnd() * 6.28, w: s * 1.1, d: s, h: 0.6 + s * 0.35 });
    }
  }

  // ---- rocks: the SE corner, a few stepping out of the shallows
  const shoreRocks: Array<[number, number, number]> = [[board.maxX + 0.6, 1.0, 1.0], [board.maxX + 1.7, 0.7, 0.8], [board.maxX + 2.9, 1.25, 1.1], [-34.2, 1.1, 0.9], [16.8, 1.15, 0.8], [board.maxX + 2.2 + mean * 1.5 + 4.0, 1.3, 1.25]];
  for (const [s, k, sc] of shoreRocks) {
    const p = shore.at(s, shore.width(s) * k);
    add({ kind: 'rock', x: p.x, z: p.z, y: Math.max(WATER_Y - 0.2, shore.ground(p.x, p.z)), v: Math.round(s) & 3, rot: s, w: sc * 1.1, d: sc, h: 0.55 * sc + 0.2 });
    if (k > 0.95) disc(p.x, p.z, sc * 0.5);
  }
  // east beach, north of the point: a quiet cove with driftwood
  {
    const s = board.maxX + (Math.PI / 2) * mean + (board.maxZ - -14.5);
    const p = shore.at(s, 2.3);
    add({ kind: 'driftwood', x: p.x, z: p.z, rot: 1.2, w: 1.6, d: 0.3, h: 0.2 });
  }

  // ---- dune grass along the dry sand (skipping props, the causeways and the point's root)
  const blocked = (x: number, z: number, r: number) =>
    inBridgeCorridor(x, z, r + 0.4) ||
    railDist(x, z) < r + 1.5 ||
    capsuleDist({ x, z }, point) < r + 0.6 ||
    props.some((p) => p.kind !== 'grass' && p.kind !== 'pile' && Math.hypot(p.x - x, p.z - z) < r + Math.max(p.w, p.d) / 2 + 0.25);
  for (let s = board.minX + 1.2; s < shore.sMax - 10; s += 1.15 + rnd() * 1.4) {
    if (s > board.maxX + 2 * mean + 36 + 5) break;
    const d = 0.35 + rnd() * 0.9;
    const p = shore.at(s, d);
    if (p.z < board.minZ + 1.5) continue;
    if (blocked(p.x, p.z, 0.35)) continue;
    if (rnd() < 0.35) continue;
    add({ kind: 'grass', x: p.x, z: p.z, v: Math.floor(rnd() * 3), rot: rnd() * 6.28, w: 0.6, d: 0.6, h: 0.45 });
  }

  // ---- sailing: two yachts tacking slow loops on open water
  boats.push({ kind: 'sail', v: 3, x: 0, z: 0, heading: 0, bob: 1.1, seed: 41.5, loop: { cx: 10.5, cz: board.maxZ + 20.5, rx: 6.2, rz: 3.3, period: 88, phase: 0.6, cw: false } });
  boats.push({ kind: 'sail', v: 4, x: 0, z: 0, heading: 0, bob: 1.1, seed: 47.9, loop: { cx: board.maxX + 19.5, cz: -14.0, rx: 4.0, rz: 6.3, period: 96, phase: 2.4, cw: true } });
  boats.push({ kind: 'motor', v: 2, x: 0, z: 0, heading: 0, bob: 0.9, seed: 53.1, loop: { cx: -25, cz: board.maxZ + 20, rx: 7, rz: 3, period: 72, phase: 3.9, cw: true } });
  for (const bt of boats) if (bt.loop && !bt.follow) { const p = boatPose({ boats } as WaterPlan, bt, 0); bt.x = p.x; bt.z = p.z; bt.heading = p.heading; }

  const regions: Box2[] = [
    { minX: extent.minX, maxX: extent.maxX, minZ: board.maxZ - 0.5, maxZ: extent.maxZ },
    { minX: board.maxX - 0.5, maxX: extent.maxX, minZ: extent.minZ, maxZ: board.maxZ - 0.5 },
  ];
  return { board, extent, shore, point, marina, bridges, viaduct, props, boats, lights, foam, regions, waterDist };
}

// ---------------------------------------------------------------- motion
/** Where a boat is at real time t (s): loop position + heading for moving boats, a slow drift on the lines for moored
 *  ones, plus a gentle bob (heave, roll, pitch). Pure, so the shader wakes and the meshes agree. */
export function boatPose(plan: Pick<WaterPlan, 'boats'>, bt: Boat, t: number): BoatPose {
  const src = bt.follow ? plan.boats[bt.follow.lead] ?? bt : bt;
  const tt = bt.follow ? t - bt.follow.lag : t;
  let x = bt.x, z = bt.z, heading = bt.heading;
  const s = bt.seed;
  if (src.loop) {
    const L = src.loop, w = ((2 * Math.PI) / L.period) * (L.cw ? -1 : 1);
    const th = L.phase + w * tt;
    x = L.cx + L.rx * Math.cos(th);
    z = L.cz + L.rz * Math.sin(th);
    const vx = -L.rx * Math.sin(th) * w, vz = L.rz * Math.cos(th) * w;
    heading = Math.atan2(-vz, vx);
  } else {
    x += 0.11 * Math.sin(t * 0.23 + s);
    z += 0.09 * Math.sin(t * 0.19 + s * 1.3);
    heading += 0.05 * Math.sin(t * 0.17 + s * 0.6);
  }
  const k = bt.bob;
  const heave = k * (0.045 * Math.sin(t * 1.3 + s) + 0.02 * Math.sin(t * 2.3 + s * 1.7));
  const roll = k * (0.055 * Math.sin(t * 1.05 + s * 0.7) + 0.02 * Math.sin(t * 2.7 + s));
  const pitch = k * 0.03 * Math.sin(t * 1.6 + s * 2.3);
  return { x, z, heading, roll, pitch, heave };
}
