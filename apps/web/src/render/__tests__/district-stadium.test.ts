// D4 stadium + rail: the stadium district (showpiece bowl, plaza, parking, flags) plus the railway dressing for
// the whole loop (station buildings aligned to platforms, level crossings at every road/rail crossing, signals).
// Geometry is re-derived here from TOWN so the test checks the district against the map, not against itself.
import { describe, expect, it } from 'vitest';
import { nearestDist, pointAt, TOWN } from '@headway/sim';
import type { Vec2 } from '@headway/sim';
import { createBasicKit } from '../assets/basicKit';
import { CATALOG_BY_KIND } from '../assets/catalog';
import { createRegistry } from '../assets/index';
import type { PlacedAsset } from '../assets/types';
import { footprintOf, validatePlacements } from '../assets/validate';
import { STADIUM } from '../districts/stadium';
import { worldLayout } from '../world/layout';

const items = STADIUM.items;
const ofKind = (kind: string) => items.filter((i) => i.kind === kind);
const loop = TOWN.rail.loop;
const L = loop.length;

// ---------------------------------------------------------------- geometry helpers (independent of the district)
function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x, vz = b.z - a.z, wx = p.x - a.x, wz = p.z - a.z;
  const l2 = vx * vx + vz * vz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, (wx * vx + wz * vz) / l2)) : 0;
  return Math.hypot(a.x + vx * t - p.x, a.z + vz * t - p.z);
}
function polyDist(p: Vec2, pts: Vec2[], closed: boolean): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) best = Math.min(best, segDist(p, pts[i]!, pts[i + 1]!));
  if (closed) best = Math.min(best, segDist(p, pts[pts.length - 1]!, pts[0]!));
  return best;
}
const roadDist = (p: Vec2) => Math.min(...TOWN.roads.edges.map((e) => polyDist(p, e.path.points, e.path.closed)));
const railDist = (p: Vec2) => polyDist(p, loop.points, true);
/** Unit tangent of the loop (direction of travel = increasing dist) at arc length d. */
function tangent(d: number): Vec2 {
  const a = pointAt(loop, d - 0.3), b = pointAt(loop, d + 0.3);
  const n = Math.hypot(b.x - a.x, b.z - a.z);
  return { x: (b.x - a.x) / n, z: (b.z - a.z) / n };
}
/** World direction of an asset's local +z (its front) for a rotation about y. */
const front = (rot = 0): Vec2 => ({ x: Math.sin(rot), z: Math.cos(rot) });
const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.z * b.z;
function segX(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const r = { x: b.x - a.x, z: b.z - a.z }, s = { x: d.x - c.x, z: d.z - c.z };
  const den = r.x * s.z - r.z * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * s.z - (c.z - a.z) * s.x) / den, u = ((c.x - a.x) * r.z - (c.z - a.z) * r.x) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { x: a.x + r.x * t, z: a.z + r.z * t } : null;
}
/** Every road-centreline × rail-centreline intersection with the road's direction there. */
function roadRailCrossings(): Array<{ p: Vec2; roadDir: Vec2; edge: string }> {
  const out: Array<{ p: Vec2; roadDir: Vec2; edge: string }> = [];
  const R = loop.points;
  for (const e of TOWN.roads.edges) {
    const P = e.path.points;
    for (let i = 0; i + 1 < P.length; i++) for (let j = 0; j < R.length; j++) {
      const p = segX(P[i]!, P[i + 1]!, R[j]!, R[(j + 1) % R.length]!);
      if (!p || out.some((o) => Math.hypot(o.p.x - p.x, o.p.z - p.z) < 0.5)) continue;
      const n = Math.hypot(P[i + 1]!.x - P[i]!.x, P[i + 1]!.z - P[i]!.z);
      out.push({ p, roadDir: { x: (P[i + 1]!.x - P[i]!.x) / n, z: (P[i + 1]!.z - P[i]!.z) / n }, edge: e.id });
    }
  }
  return out;
}
const tunnel = worldLayout(TOWN).railTunnel;
/** True when arc length d lies in the rail tunnel span (plus a margin past each portal). */
function inTunnel(d: number, margin = 0): boolean {
  if (!tunnel) return false;
  const from = tunnel.fromDist - margin, to = tunnel.toDist + margin;
  const span = (((to - from) % L) + L) % L;
  return (((d - from) % L) + L) % L <= span;
}
/** Axis-aligned footprint rectangle of a placed asset (the validator's convention). */
function rect(a: PlacedAsset) {
  const f = footprintOf(a);
  return { x0: a.x - f.w / 2, x1: a.x + f.w / 2, z0: a.z - f.d / 2, z1: a.z + f.d / 2 };
}
function rectDist(p: Vec2, r: ReturnType<typeof rect>): number {
  const dx = Math.max(r.x0 - p.x, 0, p.x - r.x1), dz = Math.max(r.z0 - p.z, 0, p.z - r.z1);
  return Math.hypot(dx, dz);
}
function insidePoly(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
function polyArea(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += (poly[j]!.x + poly[i]!.x) * (poly[j]!.z - poly[i]!.z);
  return Math.abs(s) / 2;
}
/** Points along a polyline / polygon outline every ~0.25 u. */
function samples(pts: Vec2[], closed: boolean): Vec2[] {
  const out: Vec2[] = [];
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
    const k = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.25));
    for (let s = 0; s <= k; s++) out.push({ x: a.x + ((b.x - a.x) * s) / k, z: a.z + ((b.z - a.z) * s) / k });
  }
  return out;
}

// ---------------------------------------------------------------- tests
describe('district stadium: data', () => {
  it('is the stadium district with a region that holds the stadium neighbourhood and no other', () => {
    expect(STADIUM.id).toBe('stadium');
    expect('polygon' in STADIUM.region).toBe(true);
    const poly = (STADIUM.region as { polygon: Vec2[] }).polygon;
    expect(polyArea(poly)).toBeGreaterThan(100);
    for (const n of TOWN.neighborhoods) expect(insidePoly(n.center, poly), n.id).toBe(n.id === 'stadium');
    const b = TOWN.bounds;
    for (const p of poly) {
      expect(p.x).toBeGreaterThanOrEqual(b.minX); expect(p.x).toBeLessThanOrEqual(b.maxX);
      expect(p.z).toBeGreaterThanOrEqual(b.minZ); expect(p.z).toBeLessThanOrEqual(b.maxZ);
    }
  });

  it('places only catalog kinds that the registry implements, with finite transforms', () => {
    const reg = createRegistry();
    expect(items.length).toBeGreaterThan(40);
    for (const it of items) {
      expect(CATALOG_BY_KIND.has(it.kind), it.kind).toBe(true);
      expect(reg.get(it.kind), it.kind).toBeDefined();
      expect(Number.isFinite(it.x) && Number.isFinite(it.z) && Number.isFinite(it.rot ?? 0)).toBe(true);
    }
  });

  it('passes validatePlacements (level crossings excepted: they sit on the road/rail crossing by design)', () => {
    const errs = validatePlacements(TOWN, items).filter((e) => !/lm\.levelCrossing on (road|rail)/.test(e));
    expect(errs).toEqual([]);
  });

  it('every item builds with the basic kit', () => {
    const reg = createRegistry();
    const kit = createBasicKit(reg.roles);
    for (const it of items) expect(() => reg.build(kit, it), it.kind).not.toThrow();
  });
});

describe('district stadium: the stadium', () => {
  it('has one stadium, inside the region, front gate facing the South Rd', () => {
    const s = ofKind('lm.stadium');
    expect(s).toHaveLength(1);
    const st = s[0]!;
    expect(insidePoly(st, (STADIUM.region as { polygon: Vec2[] }).polygon)).toBe(true);
    const f = front(st.rot);
    const gate = { x: st.x + f.x * 4.6, z: st.z + f.z * 4.6 };
    expect(roadDist(gate)).toBeLessThan(3.6);
    // its gates meet the stadium zone doors
    for (const z of TOWN.zones.filter((zz) => zz.tags.includes('stadium'))) expect(Math.hypot(z.door.x - st.x, z.door.z - st.z)).toBeLessThan(7);
  });

  it('dresses game day: flags, lamps, parking lots, concessions and trees', () => {
    expect(ofKind('st.flag').length).toBeGreaterThanOrEqual(6);
    expect(ofKind('st.lamp').length).toBeGreaterThanOrEqual(6);
    expect(ofKind('res.parking').length).toBeGreaterThanOrEqual(2);
    expect(ofKind('st.kiosk').length).toBeGreaterThanOrEqual(1);
    expect(items.filter((i) => i.kind.startsWith('veg.')).length).toBeGreaterThanOrEqual(12);
    // parking lots open onto a street (front hedge gap faces a road within reach)
    for (const p of ofKind('res.parking')) {
      const f = front(p.rot), half = (CATALOG_BY_KIND.get('res.parking')!.d * (p.scale ?? 1)) / 2;
      expect(roadDist({ x: p.x + f.x * (half + 1.6), z: p.z + f.z * (half + 1.6) })).toBeLessThan(1.3);
    }
  });

  it('paves a plaza and draws footpaths, all on the board and off the carriageways and track', () => {
    expect(STADIUM.areas.some((a) => a.kind === 'plaza')).toBe(true);
    expect(STADIUM.paths.length).toBeGreaterThanOrEqual(3);
    const b = TOWN.bounds;
    for (const a of STADIUM.areas) {
      expect(a.polygon.length).toBeGreaterThanOrEqual(3);
      expect(polyArea(a.polygon)).toBeGreaterThan(0.5);
      for (const p of samples(a.polygon, true)) {
        expect(p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ).toBe(true);
        expect(roadDist(p), `${a.kind} area at ${p.x.toFixed(2)},${p.z.toFixed(2)}`).toBeGreaterThanOrEqual(1.55);
        expect(railDist(p), `${a.kind} area at ${p.x.toFixed(2)},${p.z.toFixed(2)}`).toBeGreaterThanOrEqual(0.95);
      }
    }
    for (const path of STADIUM.paths) {
      expect(path.points.length).toBeGreaterThanOrEqual(2);
      expect(path.width).toBeGreaterThan(0);
      for (const p of samples(path.points, false)) {
        expect(roadDist(p), `path at ${p.x.toFixed(2)},${p.z.toFixed(2)}`).toBeGreaterThanOrEqual(1.45);
        expect(railDist(p), `path at ${p.x.toFixed(2)},${p.z.toFixed(2)}`).toBeGreaterThanOrEqual(0.95);
      }
    }
  });
});

describe('district stadium: railway', () => {
  it('puts lm.stationCentral at Central and lm.stationHalt at University and Stadium, aligned to the platforms', () => {
    expect(ofKind('lm.stationCentral')).toHaveLength(1);
    expect(ofKind('lm.stationHalt')).toHaveLength(2);
    const want: Record<string, string> = { stn_central: 'lm.stationCentral', stn_university: 'lm.stationHalt', stn_stadium: 'lm.stationHalt' };
    for (const s of TOWN.rail.stations) {
      const rail = pointAt(loop, s.dist);
      const kind = want[s.id]!;
      const b = ofKind(kind).sort((u, v) => Math.hypot(u.x - rail.x, u.z - rail.z) - Math.hypot(v.x - rail.x, v.z - rail.z))[0]!;
      const c = CATALOG_BY_KIND.get(kind)!;
      const f = front(b.rot);
      const t = tangent(s.dist);
      // front faces the track: local +z points from the building to the rail, perpendicular to the track
      const toRail = { x: rail.x - b.x, z: rail.z - b.z };
      expect(dot(f, toRail), s.id).toBeGreaterThan(0);
      expect(Math.abs(dot(f, t)), s.id).toBeLessThan(1e-6);
      // front edge on the platform edge (1.0–1.4 u from the rail centreline), building on the town side
      const frontEdge = { x: b.x + f.x * (c.d / 2), z: b.z + f.z * (c.d / 2) };
      const fe = railDist(frontEdge);
      expect(fe, s.id).toBeGreaterThanOrEqual(1.0);
      expect(fe, s.id).toBeLessThanOrEqual(1.4);
      // beside its own platform: centre within 14 u of the platform centre along the track
      expect(Math.abs(dot({ x: b.x - rail.x, z: b.z - rail.z }, t)), s.id).toBeLessThan(14);
    }
  });

  it('paves each platform and links it to its paired bus stop', () => {
    for (const s of TOWN.rail.stations) {
      const plat = STADIUM.areas.find((a) => a.kind === 'plaza' && insidePoly(s.platform, a.polygon));
      expect(plat, `platform area for ${s.id}`).toBeDefined();
      const stop = TOWN.stops.find((x) => x.id === s.stopId)!;
      const link = STADIUM.paths.find((p) => {
        const a = p.points[0]!, z = p.points[p.points.length - 1]!;
        return Math.min(Math.hypot(a.x - stop.p.x, a.z - stop.p.z), Math.hypot(z.x - stop.p.x, z.z - stop.p.z)) < 1.2 &&
          Math.min(Math.hypot(a.x - s.platform.x, a.z - s.platform.z), Math.hypot(z.x - s.platform.x, z.z - s.platform.z)) < 1.6;
      });
      expect(link, `stop→platform path for ${s.id}`).toBeDefined();
    }
  });

  it('has a level crossing on every road/rail crossing outside the rail tunnel, road along its local z', () => {
    const crossings = roadRailCrossings();
    expect(crossings.length).toBeGreaterThanOrEqual(3);
    const lc = ofKind('lm.levelCrossing');
    const atGrade = crossings.filter((c) => !inTunnel(nearestDist(loop, c.p), 2));
    expect(lc).toHaveLength(atGrade.length);
    for (const c of atGrade) {
      const m = lc.find((l) => Math.hypot(l.x - c.p.x, l.z - c.p.z) < 0.05);
      expect(m, `crossing on ${c.edge}`).toBeDefined();
      expect(Math.abs(dot(front(m!.rot), c.roadDir)), c.edge).toBeCloseTo(1, 6);
    }
  });

  it('dresses the loop with rail signals that face oncoming trains, beside the track, outside the tunnel', () => {
    const sig = ofKind('lm.railSignal');
    expect(sig.length).toBeGreaterThanOrEqual(5);
    for (const s of sig) {
      const d = nearestDist(loop, s);
      expect(railDist(s)).toBeGreaterThanOrEqual(1.3);
      expect(railDist(s)).toBeLessThanOrEqual(1.8);
      expect(inTunnel(d, 2)).toBe(false);
      // lamps (local +z) face trains coming along increasing dist
      expect(dot(front(s.rot), tangent(d))).toBeLessThan(-0.9);
    }
  });
});

describe('district stadium: gameplay stays readable', () => {
  const QLEN = 5; // the first ~11 queue slots (0.45 u apart) stay clear
  const lines: Array<{ id: string; a: Vec2; b: Vec2 }> = [
    ...TOWN.stops.map((s) => ({ id: s.id, a: s.p, b: { x: s.p.x + s.queueDir.x * QLEN, z: s.p.z + s.queueDir.z * QLEN } })),
    ...TOWN.rail.stations.map((s) => ({ id: s.id, a: s.platform, b: { x: s.platform.x + s.queueDir.x * QLEN, z: s.platform.z + s.queueDir.z * QLEN } })),
  ];
  it('keeps 2 u clear around every stop, platform and queue line', () => {
    const bad: string[] = [];
    for (const it of items) {
      const r = rect(it);
      for (const q of lines) {
        const d = Math.min(...samples([q.a, q.b], false).map((p) => rectDist(p, r)));
        if (d < 2) bad.push(`${it.kind}@${it.x.toFixed(1)},${it.z.toFixed(1)} is ${d.toFixed(2)} u from ${q.id}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('never hides a queue from the default camera (orthographic, from +x/+z at ~35°)', () => {
    // Ray from a waiting person's chest (y 0.4) toward the camera: rises tan(35°) per unit of plan distance.
    // An item hides the person when the ray enters its footprint below ~90 % of the item's catalog height.
    const v = { x: Math.SQRT1_2, z: Math.SQRT1_2 }, slope = Math.tan((35 * Math.PI) / 180);
    const entry = (q: Vec2, r: ReturnType<typeof rect>): number | null => {
      let t0 = 0, t1 = Infinity;
      for (const [o, d, lo, hi] of [[q.x, v.x, r.x0, r.x1], [q.z, v.z, r.z0, r.z1]] as const) {
        const a = (lo - o) / d, b = (hi - o) / d;
        t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b));
      }
      return t0 <= t1 ? t0 : null;
    };
    const bad: string[] = [];
    for (const it of items) {
      const h = (CATALOG_BY_KIND.get(it.kind)?.h ?? 0) * (it.scale ?? 1);
      if (h <= 1.0 || it.kind === 'st.flag' || it.kind === 'st.lamp' || it.kind === 'lm.railSignal') continue; // poles are thin
      const r = rect(it);
      for (const q of lines) for (const p of samples([q.a, q.b], false)) {
        const s = entry(p, r);
        if (s !== null && 0.4 + slope * s < 0.9 * h) { bad.push(`${it.kind}@${it.x.toFixed(1)},${it.z.toFixed(1)} hides ${q.id}`); break; }
      }
    }
    expect([...new Set(bad)]).toEqual([]);
  });
});
