// Owner: G1. The highway plan: pure data (no three.js, no DOM, deterministic), derived from G0's grid seam.
//
// The Mt Nittany Expressway runs east–west through G0's northern band (rows 0–3): a dual carriageway centred on
// the row 1 / row 2 boundary (eastbound south, westbound north — right-hand traffic), two lanes each way, a concrete
// median, guardrails. West: a twin-bore tunnel portal in a hillside at the grid's west edge. East: off the grid
// edge toward the lakeshore.
//
// Interchange (a diamond with frontage slip roads) where North Gate Circle's north arm (G0's 'highway' port) meets
// it: the expressway rises on embankments (12 u ramps) to an overpass deck over the North Rd link; slip roads at
// grade in row 3 (eastbound off/on) and row 0 (westbound off/on) meet the link at two signalised junctions.
//
//    row 0  ═══════wb-on════════╦J0══════wb-off═══════        (westbound slip road, at grade)
//    row 1  ── wb ──────────/‾‾‾‾║‾‾‾‾\──────────── wb ──    (expressway: ramps up to the overpass)
//    row 2  ── eb ──────────/____║____\──────────── eb ──
//    row 3  ═══════eb-off═══════╬J3═══════eb-on═══════        (eastbound slip road, at grade)
//                               ║ North Rd → North Gate Circle (G0 port at the band edge)
import type { TownMap, Vec2 } from '@headway/sim';
import { cellOf, greaterGrid, lanePath, rightOf, type GreaterGrid, type Lane, type Port } from '../grid';

/** Highway name (a nod to State College's US 322). */
export const HIGHWAY_NAME = 'Mt Nittany Expwy';
export const LINK_NAME = 'North Rd';

/** Cross-section and profile constants (u). Lateral offsets are from the highway centreline, + = south. */
export const HW = {
  /** Overpass road-surface height and deck thickness. */
  H: 2.0,
  deckT: 0.42,
  /** Flat deck half-length either side of the link road, and the ramp (embankment) length. */
  flatHalf: 6,
  slant: 12,
  /** Lane centres within a carriageway (from the highway centreline). */
  lanes: [1.2, 2.8] as const,
  /** Median asphalt half-width (the jersey barrier sits on it), carriageway asphalt outer edge, outer barrier edge. */
  median: 0.4,
  edge: 3.6,
  outer: 3.95,
  roadTop: 0.04,
  /** Slip-road diverge/merge geometry relative to the link road x (EB; WB mirrored). */
  divergeStart: 36,
  divergeEnd: 26,
  mergeStart: 22,
  mergeEnd: 32,
  /** Lanes start/end this far inside the tunnel (hidden behind the portal). */
  tunnelIn: 3,
  /** One-lane ramp asphalt half-width, the junction-arm half-width it widens to, and the taper length. */
  rampHalf: 1.15,
  armHalf: 1.6,
  taper: 4,
} as const;

export interface HighwayLane extends Lane {
  /** Height (y) of every path point; omitted = flat at y = 0. Use laneHeightAt(lane, d). */
  y?: number[];
}
/** A world exit of the expressway: traffic enters / leaves the region here (all its lanes, slow lane first). */
export interface HighwayPort extends Port {
  inLanes: string[];
  outLanes: string[];
}

export interface SlipRoad {
  id: 'eb-off' | 'eb-on' | 'wb-off' | 'wb-on';
  /** Road centreline (y = 0), drawn in the direction of travel. */
  path: Vec2[];
  /** Asphalt half-width per path point: one lane (HW.rampHalf), widening to a Kenney street arm at the junction. */
  half: number[];
  /** Traffic lane offset (right of travel) per path point: centred on the ramp, KERB.lane at the junction. */
  laneOff: number[];
  /** Path-point index range [from, to] where the road runs clear of the expressway (inner kerb drawn). */
  innerKerb: [number, number];
  /** Path-point index range of the outer kerb (it starts / ends a little into the S-curve, off the expressway). */
  outerKerb: [number, number];
  /** Side of travel the expressway lies on (+1 right, −1 left). */
  hwSide: 1 | -1;
}

export interface Junction3 {
  id: 'j-n' | 'j-s';
  /** Grid cell and centre. */
  c: number;
  r: number;
  center: Vec2;
  /** Open arms (Kenney tile: 'tee' w/e/s or 'cross'). */
  arms: Array<'n' | 'e' | 's' | 'w'>;
}

export interface Prop {
  kind: 'light' | 'gantry' | 'gantryWide' | 'pillar' | 'signal' | 'pine' | 'tree' | 'bush' | 'rock';
  x: number;
  y: number;
  z: number;
  /** Rotation about +y. */
  rot: number;
  /** Uniform scale multiplier (1 = kit scale). */
  s: number;
  /** Variant pick (trees / rocks). */
  v: number;
  /** Pillars: column height (top = deck underside). */
  h?: number;
}

export interface HighwayPlan {
  grid: GreaterGrid;
  /** Band rows in world z, highway centreline, carriageway centres. */
  z0: number;
  z1: number;
  zc: number;
  zEB: number;
  zWB: number;
  /** Slip road centres (row 3 / row 0). */
  zS: number;
  zN: number;
  /** Link road x (North Gate Circle's north arm). */
  xn: number;
  /** Tunnel portal face x (west), highway west end (inside the tunnel), east end (grid edge). */
  xPortal: number;
  xw: number;
  xe: number;
  /** Elevation profile of the through carriageways. */
  heightAt(x: number): number;
  /** Elevated span (ramps + deck) and the flat deck span. */
  elevated: [number, number];
  deck: [number, number];
  slips: SlipRoad[];
  junctions: Junction3[];
  /** North Rd under the overpass (cells between the two junctions), centreline south → north. */
  link: Vec2[];
  lanes: HighwayLane[];
  ports: HighwayPort[];
  props: Prop[];
  /** Hillside over the tunnel: footprint the layer's heightfield covers (west of the portal it may spill south of
   *  the band: that is mountain land beyond the grid; east of the portal it stays inside the band, z ≤ bandMaxZ). */
  hill: { minX: number; maxX: number; minZ: number; maxZ: number; bandMaxZ: number };
}

const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Small deterministic hash → [0, 1). */
export function hash01(a: number, b = 0): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x165667b1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** S-curve from a (heading ±x) to b (heading ±x): lateral smoothstep. Includes both ends. */
function sCurve(a: Vec2, b: Vec2, segs = 12): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * smooth(t) });
  }
  return out;
}

/** Points along x from x0 to x1 (either direction) at z, densified to `step` where `dense(x)` is true. */
function along(x0: number, x1: number, z: number, step: number, dense: (x: number) => boolean): Vec2[] {
  const out: Vec2[] = [{ x: x0, z }];
  const dir = Math.sign(x1 - x0);
  let x = x0;
  while ((x1 - x) * dir > 1e-6) {
    const nx = dense(x) || dense(x + dir * step) ? x + dir * step : x + dir * Math.min(Math.abs(x1 - x), 8);
    x = (x1 - nx) * dir < 0 ? x1 : nx;
    out.push({ x, z });
  }
  return out;
}

const cache = new WeakMap<TownMap, HighwayPlan>();

/** The highway plan for a map (memoised). Throws if G0's grid has no highway port. */
export function highwayPlan(map: TownMap): HighwayPlan {
  const hit = cache.get(map);
  if (hit) return hit;
  const g = greaterGrid(map);
  const T = g.tile;
  const z0 = g.origin.z, z1 = z0 + g.highway.h * T;
  const zc = z0 + 2 * T, zEB = zc + 2, zWB = zc - 2, zS = z1 - T / 2, zN = z0 + T / 2;
  const port = g.ports.find((p) => p.kind === 'highway');
  if (!port) throw new Error('highway: G0 grid has no highway port');
  const xn = port.p.x;
  const cn = cellOf(g, xn, zS).c;
  const xPortal = g.bounds.minX;
  const xw = xPortal - HW.tunnelIn;
  const xe = g.bounds.maxX;
  const { H, flatHalf: F, slant: S } = HW;

  const heightAt = (x: number): number => {
    const d = Math.abs(x - xn);
    if (d <= F) return H;
    if (d >= F + S) return 0;
    return H * smooth((F + S - d) / S);
  };
  const elevated: [number, number] = [xn - F - S, xn + F + S];
  const deck: [number, number] = [xn - F, xn + F];
  const inRamp = (x: number) => x > elevated[0] - 0.5 && x < elevated[1] + 0.5;

  // ---- slip roads (centrelines, y = 0)
  const D0 = HW.divergeStart, D1 = HW.divergeEnd, M0 = HW.mergeStart, M1 = HW.mergeEnd;
  // one-lane ramps: off = S-curve off the slow lane (points 0–12), straight, then a taper widening to the junction
  // arm; on = taper narrowing from the junction arm, straight, S-curve into the slow lane
  const [lFast, lSlow] = HW.lanes;
  const ebF = zc + lFast, ebS = zc + lSlow, wbF = zc - lFast, wbS = zc - lSlow;
  const rl = 0.6; // slip-road / link lane offset (G0 street convention)
  const taperPts = (xEdge: number, dir: 1 | -1, z: number): Vec2[] => {
    const out: Vec2[] = [];
    for (let i = 0; i <= 8; i++) out.push({ x: xEdge - dir * HW.taper * (1 - i / 8), z });
    return out; // from the taper start to the junction edge (direction of travel = dir)
  };
  const offRamp = (id: 'eb-off' | 'wb-off', dir: 1 | -1, laneZ: number, slipZ: number): SlipRoad => {
    const xEdge = xn - dir * T / 2;
    const path = [...sCurve({ x: xn - dir * D0, z: laneZ }, { x: xn - dir * D1, z: slipZ }), ...taperPts(xEdge, dir, slipZ)];
    const n = path.length, t0 = n - 9;
    const k = (i: number) => (i < t0 ? 0 : smooth((i - t0) / 8));
    return {
      id, path, hwSide: -1, innerKerb: [12, n - 1], outerKerb: [3, n - 1],
      half: path.map((_, i) => HW.rampHalf + (HW.armHalf - HW.rampHalf) * k(i)), laneOff: path.map((_, i) => rl * k(i)),
    };
  };
  const onRamp = (id: 'eb-on' | 'wb-on', dir: 1 | -1, laneZ: number, slipZ: number): SlipRoad => {
    const xEdge = xn + dir * T / 2;
    const taper: Vec2[] = [];
    for (let i = 0; i <= 8; i++) taper.push({ x: xEdge + dir * HW.taper * (i / 8), z: slipZ });
    const path = [...taper, ...sCurve({ x: xn + dir * M0, z: slipZ }, { x: xn + dir * M1, z: laneZ })];
    const n = path.length;
    const k = (i: number) => (i > 8 ? 0 : smooth(1 - i / 8));
    return {
      id, path, hwSide: -1, innerKerb: [0, 9], outerKerb: [0, n - 3],
      half: path.map((_, i) => HW.rampHalf + (HW.armHalf - HW.rampHalf) * k(i)), laneOff: path.map((_, i) => rl * k(i)),
    };
  };
  const slips: SlipRoad[] = [onRamp('eb-on', 1, ebS, zS), offRamp('eb-off', 1, ebS, zS), offRamp('wb-off', -1, wbS, zN), onRamp('wb-on', -1, wbS, zN)];

  const junctions: Junction3[] = [
    { id: 'j-s', c: cn, r: g.highway.r + g.highway.h - 1, center: { x: xn, z: zS }, arms: ['n', 'e', 's', 'w'] },
    { id: 'j-n', c: cn, r: g.highway.r, center: { x: xn, z: zN }, arms: ['w', 'e', 's'] },
  ];
  const link: Vec2[] = [{ x: xn, z: zS - T / 2 }, { x: xn, z: zN + T / 2 }];

  // ---- lanes
  const lanes: HighwayLane[] = [];
  const mk = (id: string, kind: Lane['kind'], pts: Vec2[], street: string, elevatedLane = false): HighwayLane => {
    const path = lanePath(pts);
    const lane: HighwayLane = { id: `hw:${id}`, kind, path, speed: kind === 'highway' ? 9 : kind === 'ramp' ? 5 : 3.5, next: [], street };
    if (elevatedLane) lane.y = path.points.map((p) => heightAt(p.x));
    lanes.push(lane);
    return lane;
  };
  const slipLane = (sid: SlipRoad['id']): Vec2[] => {
    const sr = slips.find((x) => x.id === sid)!;
    return sr.path.map((p, i) => {
      const a = sr.path[Math.max(0, i - 1)]!, b = sr.path[Math.min(sr.path.length - 1, i + 1)]!;
      const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const r = rightOf({ x: (b.x - a.x) / L, z: (b.z - a.z) / L });
      return { x: p.x + r.x * sr.laneOff[i]!, z: p.z + r.z * sr.laneOff[i]! };
    });
  };
  // eastbound (+x)
  mk('eb-fast', 'highway', along(xw, xe, ebF, 1, inRamp), HIGHWAY_NAME, true);
  mk('eb-slow-1', 'highway', [{ x: xw, z: ebS }, { x: xn - D0, z: ebS }], HIGHWAY_NAME);
  mk('eb-slow-2', 'highway', along(xn - D0, xn + M1, ebS, 1, inRamp), HIGHWAY_NAME, true);
  mk('eb-slow-3', 'highway', [{ x: xn + M1, z: ebS }, { x: xe, z: ebS }], HIGHWAY_NAME);
  mk('eb-off', 'ramp', slipLane('eb-off'), `${HIGHWAY_NAME} exit`);
  mk('eb-on', 'ramp', slipLane('eb-on'), `${HIGHWAY_NAME} entry`);
  // westbound (−x)
  mk('wb-fast', 'highway', along(xe, xw, wbF, 1, inRamp), HIGHWAY_NAME, true);
  mk('wb-slow-1', 'highway', [{ x: xe, z: wbS }, { x: xn + D0, z: wbS }], HIGHWAY_NAME);
  mk('wb-slow-2', 'highway', along(xn + D0, xn - M1, wbS, 1, inRamp), HIGHWAY_NAME, true);
  mk('wb-slow-3', 'highway', [{ x: xn - M1, z: wbS }, { x: xw, z: wbS }], HIGHWAY_NAME);
  mk('wb-off', 'ramp', slipLane('wb-off'), `${HIGHWAY_NAME} exit`);
  mk('wb-on', 'ramp', slipLane('wb-on'), `${HIGHWAY_NAME} entry`);
  // North Rd under the overpass
  mk('link-n', 'radial', [{ x: xn + rl, z: zS - T / 2 }, { x: xn + rl, z: zN + T / 2 }], LINK_NAME);
  mk('link-s', 'radial', [{ x: xn - rl, z: zN + T / 2 }, { x: xn - rl, z: zS - T / 2 }], LINK_NAME);
  // junction turns (G0 convention: arm in-lane ends KERB.lane right of the arm midpoint, out-lanes start likewise)
  const DV: Record<'n' | 'e' | 's' | 'w', Vec2> = { n: { x: 0, z: -1 }, e: { x: 1, z: 0 }, s: { x: 0, z: 1 }, w: { x: -1, z: 0 } };
  const turns: Record<Junction3['id'], Array<['n' | 'e' | 's' | 'w', 'n' | 'e' | 's' | 'w']>> = {
    // j-s: W in (eb-off), E out (eb-on), N/S two-way. j-n: E in (wb-off), W out (wb-on), S two-way.
    'j-s': [['w', 'e'], ['w', 's'], ['s', 'e'], ['s', 'n'], ['n', 's']],
    'j-n': [['e', 'w'], ['e', 's'], ['s', 'w']],
  };
  for (const j of junctions) {
    const mid = (d: 'n' | 'e' | 's' | 'w'): Vec2 => ({ x: j.center.x + DV[d].x * T / 2, z: j.center.z + DV[d].z * T / 2 });
    const inEnd = (d: 'n' | 'e' | 's' | 'w'): Vec2 => { const r = rightOf({ x: -DV[d].x, z: -DV[d].z }); const m = mid(d); return { x: m.x + r.x * rl, z: m.z + r.z * rl }; };
    const outStart = (d: 'n' | 'e' | 's' | 'w'): Vec2 => { const r = rightOf(DV[d]); const m = mid(d); return { x: m.x + r.x * rl, z: m.z + r.z * rl }; };
    for (const [a, b] of turns[j.id]) {
      const p0 = inEnd(a), p3 = outStart(b);
      const d0 = { x: -DV[a].x, z: -DV[a].z }, d3 = DV[b];
      let pts: Vec2[];
      if (DV[a].x === -DV[b].x && DV[a].z === -DV[b].z) pts = [p0, p3];
      else {
        const h = 0.39 * Math.hypot(p3.x - p0.x, p3.z - p0.z);
        const p1 = { x: p0.x + d0.x * h, z: p0.z + d0.z * h }, p2 = { x: p3.x - d3.x * h, z: p3.z - d3.z * h };
        pts = [];
        for (let i = 0; i <= 8; i++) {
          const t = i / 8, u = 1 - t, A = u * u * u, B = 3 * u * u * t, C = 3 * u * t * t, Dd = t * t * t;
          pts.push({ x: A * p0.x + B * p1.x + C * p2.x + Dd * p3.x, z: A * p0.z + B * p1.z + C * p2.z + Dd * p3.z });
        }
      }
      mk(`${j.id}:${a}>${b}`, 'junction', pts, LINK_NAME);
    }
  }

  const id = (s: string) => `hw:${s}`;
  const ports: HighwayPort[] = [
    {
      id: 'highway-w', kind: 'highway', side: 'w', p: { x: xw, z: zc }, dir: { x: -1, z: 0 }, street: HIGHWAY_NAME,
      inLane: id('eb-slow-1'), outLane: id('wb-slow-3'), inLanes: [id('eb-slow-1'), id('eb-fast')], outLanes: [id('wb-slow-3'), id('wb-fast')],
    },
    {
      id: 'highway-e', kind: 'highway', side: 'e', p: { x: xe, z: zc }, dir: { x: 1, z: 0 }, street: HIGHWAY_NAME,
      inLane: id('wb-slow-1'), outLane: id('eb-slow-3'), inLanes: [id('wb-slow-1'), id('wb-fast')], outLanes: [id('eb-slow-3'), id('eb-fast')],
    },
  ];

  // ---- props
  const props: Prop[] = [];
  const P = (kind: Prop['kind'], x: number, z: number, rot = 0, s = 1, v = 0, y = 0, h?: number) => {
    const p: Prop = { kind, x, y, z, rot, s, v };
    if (h !== undefined) p.h = h;
    props.push(p);
  };
  // median lights every 12 u from the portal approach to the east end (on the deck too)
  for (let x = xPortal + 10; x <= xe - 4; x += 12) P('light', x, zc, 0, 1, 0, heightAt(x));
  // gantries between the lights: exit signs ahead of the slip roads (EB faces −x; WB rotated π), route signs after
  P('gantry', xn - 46, zEB, 0);
  P('gantry', xn + 50, zWB, Math.PI);
  P('gantryWide', xn + 38, zEB, 0);
  P('gantryWide', xn - 34, zWB, Math.PI);
  // overpass pillars: two rows just outside the link road's sidewalks
  for (const sx of [-1, 1]) for (const dz of [-3.1, -1.05, 1.05, 3.1]) P('pillar', xn + sx * 3.4, zc + dz, 0, 1, 0, 0, H - HW.deckT);
  // signals at the slip-road junction corners away from the deck
  P('signal', xn - T / 2 + 0.35, zS + T / 2 - 0.35, Math.PI / 2);
  P('signal', xn + T / 2 - 0.35, zS + T / 2 - 0.35, 0);
  P('signal', xn + T / 2 - 0.35, zN - T / 2 + 0.35, -Math.PI / 2);
  P('signal', xn - T / 2 + 0.35, zN - T / 2 + 0.35, Math.PI);

  // verges: a tree belt on the north (back) verge, low planting on the south (camera) side; never on slip roads
  const slipSpanN: [number, number] = [xn - M1 - 1, xn + D0 + 1];
  const slipSpanS: [number, number] = [xn - D0 - 1, xn + M1 + 1];
  const hill = { minX: xPortal - 16, maxX: xPortal + 7.5, minZ: z0 - 6, maxZ: z1 + 10, bandMaxZ: z1 - 0.4 };
  let k = 0;
  for (let x = hill.maxX + 2; x < xe - 1; x += 2.6) {
    k++;
    const r = hash01(k, 7), r2 = hash01(k, 11), r3 = hash01(k, 13);
    if (x > slipSpanN[0] && x < slipSpanN[1]) continue;
    if (r < 0.22) continue;
    const zt = zN + (r2 - 0.5) * 1.6;
    P(r3 < 0.55 ? 'pine' : 'tree', x + (r - 0.5) * 1.2, zt, r2 * Math.PI * 2, 0.85 + r3 * 0.3, Math.floor(r * 97));
  }
  k = 0;
  for (let x = hill.maxX + 3; x < xe - 1; x += 3.4) {
    k++;
    const r = hash01(k, 17), r2 = hash01(k, 19);
    if (x > slipSpanS[0] && x < slipSpanS[1]) continue;
    if (r < 0.35) continue;
    P(r < 0.75 ? 'bush' : 'tree', x + (r2 - 0.5), zS + 0.6 + (r - 0.5) * 1.4, r2 * Math.PI * 2, r < 0.75 ? 0.9 + r2 * 0.4 : 0.75, Math.floor(r2 * 97));
  }
  // pines and rocks on the hillside over the tunnel (kept off the cutting in front of the portal)
  k = 0;
  for (let i = 0; i < 120 && k < 34; i++) {
    const x = hill.minX + 1 + hash01(i, 23) * (hill.maxX - hill.minX - 2);
    const z = hill.minZ + 1 + hash01(i, 29) * (hill.maxZ - hill.minZ - 2);
    const inCut = x > xPortal - 1.6 && Math.abs(z - zc) < HW.outer + 2.2;
    const front = x > xPortal - 0.5 && Math.abs(z - zc) < 6.8;
    if (inCut || front || (x > xPortal - 1 && z > z1 - 1.4) || z > z1 + 7) continue;
    k++;
    P(hash01(i, 31) < 0.85 ? 'pine' : 'rock', x, z, hash01(i, 37) * Math.PI * 2, 0.9 + hash01(i, 41) * 0.45, Math.floor(hash01(i, 43) * 97));
  }

  const plan: HighwayPlan = {
    grid: g, z0, z1, zc, zEB, zWB, zS, zN, xn, xPortal, xw, xe, heightAt, elevated, deck, slips, junctions, link, lanes, ports, props, hill,
  };
  cache.set(map, plan);
  return plan;
}

/** Height of a lane at arc distance d (0 for lanes without a profile, e.g. G0's). */
export function laneHeightAt(lane: Lane & { y?: number[] }, d: number): number {
  const y = lane.y;
  if (!y || !y.length) return 0;
  const cum = lane.path.cum;
  if (d <= 0) return y[0]!;
  const n = cum.length;
  if (d >= cum[n - 1]!) return y[n - 1]!;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (cum[m]! <= d) lo = m; else hi = m;
  }
  const t = (d - cum[lo]!) / (cum[hi]! - cum[lo]! || 1);
  return y[lo]! + (y[hi]! - y[lo]!) * t;
}
