// Owner: D4. The stadium district (game day at the stadium) and the railway dressing for the whole loop.
//
// Stadium block (Main St / West Rd / South Rd / Atherton St): A4's lm.stadium where Task M's base scenery and the
// stadium zone doors expect it, main gate on the South Rd; banner flags and lamps at the gates; a paved fan plaza
// from the east gate to the Stadium Gate stop whose south half stays open for the crowd queue, with a fountain,
// benches and concession kiosks at its north end; two parking lots opening onto Atherton St; poplars on Main St.
// Railway (derived from TOWN + worldLayout, so it follows map edits): beside each platform a station building
// (lm.stationCentral at Central, lm.stationHalt at University and Stadium) on the arrival side, front on the platform
// edge, clear of the queue; a paved platform and a footpath from the paired bus stop; a station square and garden;
// lm.levelCrossing on every road/rail crossing outside the rail tunnel; lm.railSignal home/starter signals at each
// station and approach signals before each crossing, outside the loop, lamps facing oncoming trains.
// Rules (tested): validatePlacements clean (level crossings excepted), 2 u clear around every stop/platform and the
// first 5 u of its queue, nothing tall between a queue and the default camera (+x/+z).
import { pointAt, TOWN } from '@headway/sim';
import type { Station, Vec2 } from '@headway/sim';
import { CATALOG_BY_KIND } from '../assets/catalog';
import type { AssetParams, PlacedAsset } from '../assets/types';
import { footprintOf, validatePlacements } from '../assets/validate';
import { SCENERY } from '../scenery';
import { worldLayout } from '../world/layout';
import type { DistrictScenery, FootPath, GroundArea } from './types';

const HALF_PI = Math.PI / 2;
const v = (x: number, z: number): Vec2 => ({ x, z });
const r2 = (n: number) => Math.round(n * 100) / 100;
const add = (a: Vec2, b: Vec2, s = 1): Vec2 => v(a.x + b.x * s, a.z + b.z * s);
const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.z * b.z;
/** rotation.y that turns an asset's front (local +z) toward world direction d, snapped to quarter turns. */
const quarter = (d: Vec2) => Math.round(Math.atan2(d.x, d.z) / HALF_PI) * HALF_PI;
const rect = (x0: number, z0: number, x1: number, z1: number): Vec2[] =>
  [v(x0, z0), v(x1, z0), v(x1, z1), v(x0, z1)].map((p) => v(r2(p.x), r2(p.z)));

const items: PlacedAsset[] = [];
const paths: FootPath[] = [];
const areas: GroundArea[] = [];

// ---------------------------------------------------------------- placement rules
const QUEUE_LEN = 5, QUEUE_CLEAR = 2.05;
const queueLines = [
  ...TOWN.stops.map((s) => ({ a: s.p, d: s.queueDir })),
  ...TOWN.rail.stations.map((s) => ({ a: s.platform, d: s.queueDir })),
];
/** Thin poles never hide anyone; everything else taller than 1 u must not stand between a queue and the camera. */
const POLES = new Set(['st.flag', 'st.lamp', 'lm.railSignal']);
const CAM = v(Math.SQRT1_2, Math.SQRT1_2), CAM_SLOPE = Math.tan((35 * Math.PI) / 180);
function clearOfQueues(it: PlacedAsset): boolean {
  const f = footprintOf(it);
  const x0 = it.x - f.w / 2, x1 = it.x + f.w / 2, z0 = it.z - f.d / 2, z1 = it.z + f.d / 2;
  const h = (CATALOG_BY_KIND.get(it.kind)?.h ?? 1) * (it.scale ?? 1);
  const tall = h > 1 && !POLES.has(it.kind);
  for (const q of queueLines) for (let s = 0; s <= QUEUE_LEN; s += 0.25) {
    const p = add(q.a, q.d, s);
    if (Math.hypot(Math.max(x0 - p.x, 0, p.x - x1), Math.max(z0 - p.z, 0, p.z - z1)) < QUEUE_CLEAR) return false;
    if (!tall) continue;
    // where does the ray from this waiting person toward the camera enter the footprint, and how high is it there?
    let t0 = 0, t1 = Infinity;
    for (const [o, d, lo, hi] of [[p.x, CAM.x, x0, x1], [p.z, CAM.z, z0, z1]] as const) {
      const a = (lo - o) / d, b = (hi - o) / d;
      t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b));
    }
    if (t0 <= t1 && 0.4 + CAM_SLOPE * (t0 - 0.3) < 0.95 * h) return false;
  }
  return true;
}
/** Board, roads, rail, overlaps and queue clearance, for one candidate against what is already placed. */
function fits(it: PlacedAsset): boolean {
  if (validatePlacements(TOWN, [it]).length) return false;
  const f = footprintOf(it);
  for (const o of items) {
    const g = footprintOf(o);
    if (Math.abs(it.x - o.x) * 2 < f.w + g.w + 0.1 && Math.abs(it.z - o.z) * 2 < f.d + g.d + 0.1) return false;
  }
  return clearOfQueues(it);
}
function make(kind: string, p: Vec2, rot = 0, params?: AssetParams, scale?: number): PlacedAsset {
  const it: PlacedAsset = { kind, x: r2(p.x), z: r2(p.z) };
  if (rot) it.rot = rot;
  if (params) it.params = params;
  if (scale) it.scale = scale;
  return it;
}
/** Core pieces (stadium, stations, crossings) always go in; the tests hold them to the rules. */
const place = (kind: string, p: Vec2, rot = 0, params?: AssetParams, scale?: number) => { items.push(make(kind, p, rot, params, scale)); };
/** Dressing only goes in where it fits, so map edits drop a bench rather than block a queue. */
function dress(kind: string, p: Vec2, rot = 0, params?: AssetParams, scale?: number): boolean {
  const it = make(kind, p, rot, params, scale);
  if (!fits(it)) return false;
  items.push(it);
  return true;
}

// ---------------------------------------------------------------- anchors from the map
const node = (id: string, fb: Vec2): Vec2 => TOWN.roads.nodes.find((n) => n.id === id)?.p ?? fb;
const XW = node('j_main_west', v(-26.8, 0)).x;    // West Rd
const XA = node('j_main_atherton', v(-2, 0)).x;   // Atherton St
const ZM = node('j_main_west', v(-26.8, 0)).z;    // Main St
const ZS = node('j_south_atherton', v(-2, 14.6)).z; // South Rd
const baseStadium = SCENERY.find((s) => s.kind === 'stadium');
const hood = TOWN.neighborhoods.find((n) => n.id === 'stadium');
/** Stadium centre: where Task M's base scenery (and the stadium zone doors) put the bowl. */
const S = baseStadium ? v(baseStadium.x, baseStadium.z) : hood ? v(hood.center.x, hood.center.z) : v(-19.8, 7.3);
const gateStop = TOWN.stops.find((s) => s.id === 'stop_stadium_gate');
const G = gateStop ? gateStop.p : v(S.x + 8.3, ZS - 1.15);

// ---------------------------------------------------------------- the stadium block
const BOWL = { a: 5.0, b: 3.75 };                 // A4 STADIUM_BOWL half extents (outer facade)
place('lm.stadium', S);

// Main gate forecourt on the South Rd, paved through to the east gate plaza: banner flags either side of the gate,
// flowerbeds along the kerb with a gap on the gate axis (toward Stadium Station across the road), lamps.
const PX0 = S.x + BOWL.a + 0.35;
areas.push({ kind: 'plaza', polygon: rect(S.x - 3.3, S.z + BOWL.b - 0.2, PX0, ZS - 1.6) });
dress('st.flag', v(S.x - 2.2, S.z + BOWL.b + 0.75), 0, { color: 2 });
dress('st.flag', v(S.x + 2.2, S.z + BOWL.b + 0.75), 0, { color: 0 });
for (const s of [-1, 1]) {
  dress('veg.flowerbed', v(S.x + s * 2.25, ZS - 2.05), 0, { variant: 1 });
  dress('st.lamp', v(S.x + s * 3.95, ZS - 2.0));
}

// East gate plaza: paved from the east gate to the Stadium Gate stop, open for the crowd queue; banner flags flank
// the gate and line its north edge, lamps light its east (camera-side) edge.
const PX1 = G.x + 2.95, PZ1 = ZS - 1.6;
const PZM = S.z - 1.6;                                // plaza / lawn seam, just north of the east gate
areas.push({ kind: 'plaza', polygon: rect(PX0, PZM, PX1, PZ1) });
const east = S.x + BOWL.a + 0.75;
dress('st.flag', v(east, S.z + 1.75), 0, { color: 0 });
[0, 1, 2, 3].forEach((i) => dress('st.flag', v(east + i * ((PX1 - 0.35 - east) / 3), PZM + 0.2), 0, { color: i % 2 ? 0 : 2 }));
for (const z of [S.z + 0.6, PZ1 - 1.1]) dress('st.lamp', v(PX1 - 0.3, z));

// Tailgate lawn north of the flags: concession kiosks, picnic umbrellas, a bench.
const PZ0 = ZM + 2.4;
areas.push({ kind: 'lawn', polygon: rect(PX0, PZ0, PX1, PZM) });
dress('st.kiosk', v(PX0 + 1.0, PZ0 + 0.75), 0, { color: 0 });
dress('st.kiosk', v(PX1 - 1.0, PZ0 + 0.75), 0, { color: 2 });
dress('st.tableUmbrella', v((PX0 + PX1) / 2 - 0.85, PZM - 1.2), 0, { color: 0 });
dress('st.tableUmbrella', v((PX0 + PX1) / 2 + 0.95, PZM - 1.05), 0, { color: 1 });
dress('st.bench', v((PX0 + PX1) / 2 + 0.05, PZ0 + 0.45));
dress('st.bin', v((PX0 + PX1) / 2 + 1.0, PZ0 + 0.45));

// Parking along Atherton St (fronts open onto the street), filled for the game.
const lot = CATALOG_BY_KIND.get('res.parking')!;
const lotScale = Math.min(1, (ZS - ZM - 3.2 - 0.25) / (2 * lot.w));
const lotX = XA - 1.55 - (lot.d * lotScale) / 2;
dress('res.parking', v(lotX, ZM + 1.6 + (lot.w * lotScale) / 2), HALF_PI, { cars: 5 }, r2(lotScale));
dress('res.parking', v(lotX, ZS - 1.6 - (lot.w * lotScale) / 2), HALF_PI, { cars: 4 }, r2(lotScale));
// a low green seam between the plaza and the lots
for (const z of [PZ0 + 1.6, S.z + 2.2]) dress('veg.bush', v(PX1 + 0.65, z));

// Main St frontage behind the stadium: a lawn verge with poplars either side of the north door path.
areas.push({ kind: 'lawn', polygon: rect(S.x - BOWL.a - 0.3, ZM + 1.6, S.x + BOWL.a + 0.3, S.z - BOWL.b + 0.2) });
paths.push({ kind: 'footpath', width: 1.1, points: [v(S.x, r2(S.z - BOWL.b + 0.1)), v(S.x, ZM + 1.5)] });
for (const dx of [-4.6, -3.0, -1.4, 1.4, 3.0, 4.6]) dress('veg.poplar', v(S.x + dx, ZM + 1.95), 0, { variant: 2 });

// ---------------------------------------------------------------- railway: stations
const loop = TOWN.rail.loop;
const L = loop.length;
function tangent(d: number): Vec2 {
  const a = pointAt(loop, d - 0.3), b = pointAt(loop, d + 0.3);
  const n = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return v((b.x - a.x) / n, (b.z - a.z) / n);
}
const PLATFORM_EDGE = 1.05, PLATFORM_BACK = 3.55, BUILDING_EDGE = 1.12, CLEAR = 2.25;
const BUILDING: Record<string, string> = { stn_central: 'lm.stationCentral' };

/** Inward offset (from the rail) where the town-side road's kerb clearance begins, scanning along [a0, a1]. */
function roadReach(rail: Vec2, along: Vec2, inward: Vec2, a0: number, a1: number, from: number): number {
  const roadDist = (p: Vec2) => {
    let best = Infinity;
    for (const e of TOWN.roads.edges) {
      const P = e.path.points;
      for (let i = 0; i + 1 < P.length; i++) {
        const a = P[i]!, b = P[i + 1]!, vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz;
        const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / l2)) : 0;
        best = Math.min(best, Math.hypot(a.x + vx * t - p.x, a.z + vz * t - p.z));
      }
    }
    return best;
  };
  let n = from;
  while (n < from + 6) {
    const ok = [a0, (a0 + a1) / 2, a1].every((a) => roadDist(add(add(rail, along, a), inward, n + 0.05)) >= 1.75);
    if (!ok) break;
    n += 0.05;
  }
  return n;
}

/** Platform extent per station, as arc lengths along the loop (trains run toward increasing dist). */
const platformSpan: Array<{ depart: number; arrive: number }> = [];

function dressStation(s: Station): void {
  const rail = pointAt(loop, s.dist);
  const R = v(rail.x, rail.z);
  const t = tangent(s.dist);
  let inward = v(-t.z, t.x);
  if (dot(v(s.platform.x - R.x, s.platform.z - R.z), inward) < 0) inward = v(-inward.x, -inward.z);
  const along = v(-s.queueDir.x, -s.queueDir.z);          // the queue grows from the arrival end toward the centre
  const aQ = dot(v(s.platform.x - R.x, s.platform.z - R.z), along);
  const kind = BUILDING[s.id] ?? 'lm.stationHalt';
  const c = CATALOG_BY_KIND.get(kind)!;
  // the building: arrival side, past the queue point, front (local +z) on the platform edge facing the track
  const aB = aQ + CLEAR + c.w / 2;
  const nB = BUILDING_EDGE + c.d / 2;
  const rot = quarter(v(-inward.x, -inward.z));
  place(kind, add(add(R, along, aB), inward, nB), rot);
  // the platform: from beyond the queue's far end to the building's far end
  const a0 = aQ - QUEUE_LEN - 1.6, a1 = aB + c.w / 2;
  const k = Math.sign(dot(along, t)) || -1;               // +along runs against the direction of travel (k = -1)
  const ends = [s.dist + k * a0, s.dist + k * a1];
  platformSpan.push({ depart: Math.max(...ends), arrive: Math.min(...ends) });
  const P = (a: number, n: number) => add(add(R, along, a), inward, n);
  areas.push({ kind: 'plaza', polygon: [P(a0, PLATFORM_EDGE), P(a1, PLATFORM_EDGE), P(a1, PLATFORM_BACK), P(a0, PLATFORM_BACK)].map((p) => v(r2(p.x), r2(p.z))) });
  paths.push({ kind: 'plaza-edge', width: 0.18, points: [P(a0, PLATFORM_EDGE + 0.12), P(a1, PLATFORM_EDGE + 0.12)].map((p) => v(r2(p.x), r2(p.z))) });
  // footpath from the paired bus stop across to the platform queue
  const stop = TOWN.stops.find((x) => x.id === s.stopId);
  if (stop) {
    const from = add(stop.p, stop.queueDir, 0.6);
    paths.push({ kind: 'footpath', width: 1.2, points: [from, P(aQ, PLATFORM_BACK - 0.05)].map((p) => v(r2(p.x), r2(p.z))) });
  }
  // station square behind a halt (town entrance), out to the kerb clearance of the station road
  const back = nB + c.d / 2;
  const reach = roadReach(R, along, inward, aB - c.w / 2, aB + c.w / 2, back);
  if (reach - back > 1.2) {
    areas.push({ kind: 'plaza', polygon: [P(aB - c.w / 2, back - 0.1), P(aB + c.w / 2, back - 0.1), P(aB + c.w / 2, reach), P(aB - c.w / 2, reach)].map((p) => v(r2(p.x), r2(p.z))) });
    const mid = (back + reach) / 2;
    dress('st.lamp', P(aB - c.w / 2 + 0.45, reach - 0.35));
    dress('st.bikeRack', P(aB + c.w / 2 - 1.1, mid), rot);
    dress('veg.planter', P(aB + 0.9, back + 0.55));
    dress('st.bench', P(aB - 1.4, back + 0.45), rot + Math.PI);
  }
  // station garden along the back of the platform, beyond the stop footpath (low beds only: camera side)
  for (const a of [aQ - 3.1, aQ - 5.4]) dress('veg.flowerbed', P(a, PLATFORM_BACK + 1.45), rot);
  // trees at the platform's far end and past the building
  dress('veg.birch', P(a0 - 0.6, PLATFORM_BACK + 1.0));
  dress('veg.birch', P(a0 + 0.6, PLATFORM_BACK + 2.4));
  dress('veg.oak', P(a1 + 1.6, nB + 1.0));
  dress('veg.oak', P(a1 + 2.6, PLATFORM_BACK + 2.4));
}
for (const s of TOWN.rail.stations) dressStation(s);

// ---------------------------------------------------------------- railway: level crossings and signals
const tunnel = worldLayout(TOWN).railTunnel;
function inTunnel(d: number, margin: number): boolean {
  if (!tunnel) return false;
  const from = tunnel.fromDist - margin, to = tunnel.toDist + margin;
  const span = (((to - from) % L) + L) % L;
  return (((d - from) % L) + L) % L <= span;
}
/** Arc length of the loop point nearest p. */
function distOn(p: Vec2): number {
  const pts = loop.points;
  let best = { d: 0, e: Infinity };
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!, vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz;
    const tt = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / l2)) : 0;
    const e = Math.hypot(a.x + vx * tt - p.x, a.z + vz * tt - p.z);
    if (e < best.e) best = { d: loop.cum[i]! + Math.sqrt(l2) * tt, e };
  }
  return best.d;
}
function crossings(): Array<{ p: Vec2; dir: Vec2; d: number }> {
  const out: Array<{ p: Vec2; dir: Vec2; d: number }> = [];
  const R = loop.points;
  for (const e of TOWN.roads.edges) {
    const P = e.path.points;
    for (let i = 0; i + 1 < P.length; i++) for (let j = 0; j < R.length; j++) {
      const a = P[i]!, b = P[i + 1]!, c = R[j]!, d = R[(j + 1) % R.length]!;
      const rx = b.x - a.x, rz = b.z - a.z, sx = d.x - c.x, sz = d.z - c.z, den = rx * sz - rz * sx;
      if (Math.abs(den) < 1e-9) continue;
      const tt = ((c.x - a.x) * sz - (c.z - a.z) * sx) / den, u = ((c.x - a.x) * rz - (c.z - a.z) * rx) / den;
      if (tt < 0 || tt > 1 || u < 0 || u > 1) continue;
      const p = v(a.x + rx * tt, a.z + rz * tt);
      if (out.some((o) => Math.hypot(o.p.x - p.x, o.p.z - p.z) < 0.5)) continue;
      const n = Math.hypot(rx, rz);
      out.push({ p, dir: v(rx / n, rz / n), d: distOn(p) });
    }
  }
  return out;
}
const atGrade = crossings().filter((c) => !inTunnel(c.d, 2));
for (const c of atGrade) {
  // A4's crossing: road along local z, track along local x; a half turn is the same crossing.
  const rot = ((quarter(c.dir) % Math.PI) + Math.PI) % Math.PI;
  place('lm.levelCrossing', c.p, rot);
}
/** A colour-light signal outside the loop at arc length d, lamps toward trains arriving along +dist. */
function signal(d: number): void {
  const dd = ((d % L) + L) % L;
  if (inTunnel(dd, 3)) return;
  const p = pointAt(loop, dd), t = tangent(dd);
  const pos = add(v(p.x, p.z), v(t.z, -t.x), 1.5);
  if (items.some((o) => o.kind === 'lm.railSignal' && Math.hypot(o.x - pos.x, o.z - pos.z) < 4)) return;
  const it = make('lm.railSignal', pos, r2(Math.atan2(-t.x, -t.z)));
  if (fits(it)) items.push(it);
}
for (const p of platformSpan) {
  signal(p.depart + 1.5);                              // starter: just past the departure end of the platform
  signal(p.arrive - 2.2);                              // home: before the arrival end
}
for (const c of atGrade) signal(c.d - 6);              // approach: before each level crossing

// ---------------------------------------------------------------- the district
const stadiumStation = TOWN.rail.stations.find((s) => s.id === 'stn_stadium');
const railZ = stadiumStation ? pointAt(loop, stadiumStation.dist).z : ZS + 7.4;

export const STADIUM: DistrictScenery = {
  id: 'stadium',
  /** The stadium block (Main St, West Rd, South Rd, Atherton St) plus the Stadium Station square down to the rail. */
  region: { polygon: rect(XW, ZM, XA, railZ) },
  items,
  paths,
  areas,
};
