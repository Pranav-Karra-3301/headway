// Owner: T2.4. Pure helpers of the town FX layer (no WebGL).
import { describe, expect, it } from 'vitest';
import { pointAt, polyline, projectOnPolyline, TOWN, type Vec2 } from '@headway/sim';
import { CLOCK_TOWER, STADIUM, STATION_CLOCK } from '../../kit';
import { CLOCK_TOWER_FACES, STADIUM_FLOODLIGHTS } from '../../assets/families/landmarks';
import { LAMP_HEAD } from '../../assets/families/street';
import type { SceneryItem } from '../../scenery';
import { STREETSCAPE } from '../../streetscape';
import type { DistrictScenery } from '../../districts/types';
import { fxAnchors, insideRegion, keptScenery } from '../anchors';
import { clockAngles, parseClock } from '../clock';
import { ConfettiSim, crossedClosing } from '../confetti';
import { kerbLamps } from '../lamps';
import { buildRibbonData, offsetPath, RIBBON, routeIndex } from '../ribbons';

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

describe('offsetPath', () => {
  // travels east, south, west, north (clockwise seen from above); right of travel = inside
  const sq = polyline([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }], true);
  it('offsets to the right of travel with mitred corners', () => {
    const o = offsetPath(sq, 1);
    expect(o.points).toHaveLength(4);
    expect(o.points[0]!.x).toBeCloseTo(1); expect(o.points[0]!.z).toBeCloseTo(1);
    expect(o.points[1]!.x).toBeCloseTo(9); expect(o.points[1]!.z).toBeCloseTo(1);
    expect(o.points[2]!.x).toBeCloseTo(9); expect(o.points[2]!.z).toBeCloseTo(9);
    expect(o.length).toBeCloseTo(32);
  });
  it('keeps every offset point at the offset distance from a smooth path', () => {
    for (const r of TOWN.routes) {
      const o = offsetPath(r.path, 0.6);
      for (const p of o.points) expect(projectOnPolyline(r.path, p).d).toBeCloseTo(0.6, 1);
    }
  });
  it('handles open paths (road strips) without NaN', () => {
    const e = TOWN.roads.edges[0]!;
    const o = offsetPath(e.path, -1.2);
    expect(o.points).toHaveLength(e.path.points.length);
    for (const p of o.points) { expect(Number.isFinite(p.x)).toBe(true); expect(Number.isFinite(p.z)).toBe(true); }
    expect(o.length).toBeGreaterThan(0);
  });
});

describe('route ribbons', () => {
  const data = buildRibbonData(TOWN);
  it('maps route ids to palette route indices', () => {
    expect(routeIndex(TOWN, 'r1')).toBe(0);
    expect(routeIndex(TOWN, 'r2')).toBe(1);
    expect(routeIndex(TOWN, 'r3')).toBe(2);
  });
  it('builds one closed strip per route with a seamless dash period', () => {
    expect(data.routes).toHaveLength(TOWN.routes.length);
    for (const r of data.routes) {
      const cycles = r.length / r.period;
      expect(Math.abs(cycles - Math.round(cycles))).toBeLessThan(1e-6);
      expect(r.period).toBeGreaterThan(RIBBON.period * 0.8);
      expect(r.period).toBeLessThan(RIBBON.period * 1.25);
    }
    const n = data.position.length / 3;
    expect(data.rib.length / 4).toBe(n);
    expect(data.side.length / 2).toBe(n);
    for (let i = 0; i < data.index.length; i++) expect(data.index[i]!).toBeLessThan(n);
    for (let i = 0; i < n; i++) expect(data.position[i * 3 + 1]).toBeCloseTo(RIBBON.y);
  });
  it('arc coordinate u runs 0 → loop length along each route', () => {
    const n = data.position.length / 3;
    for (let ri = 0; ri < TOWN.routes.length; ri++) {
      let prev = -1, max = 0;
      for (let i = 0; i < n; i++) {
        if (data.rib[i * 4] !== ri || data.rib[i * 4 + 2]! > 0) continue;
        const u = data.rib[i * 4 + 1]!;
        expect(u).toBeGreaterThanOrEqual(prev);
        prev = u; max = Math.max(max, u);
      }
      expect(max).toBeCloseTo(data.routes[ri]!.length, 5);
    }
  });
  it('routes sharing a road sit side by side (never on top of each other)', () => {
    const lane = (ri: number, d: number) => {
      const r = TOWN.routes[ri]!;
      const a = pointAt(r.path, d), b = pointAt(r.path, d + 0.05);
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const tx = (b.x - a.x) / len, tz = (b.z - a.z) / len;
      const off = RIBBON.lanes[ri]!;
      return { p: { x: a.x, z: a.z }, c: { x: a.x - tz * off, z: a.z + tx * off }, t: { x: tx, z: tz } };
    };
    let shared = 0;
    for (let a = 0; a < TOWN.routes.length; a++) for (let b = a + 1; b < TOWN.routes.length; b++) {
      const A = TOWN.routes[a]!, B = TOWN.routes[b]!;
      for (let d = 0; d < A.path.length; d += 0.5) {
        const la = lane(a, d);
        const pb = projectOnPolyline(B.path, la.p);
        if (pb.d > 0.05) continue;
        const lb = lane(b, pb.dist);
        if (Math.abs(la.t.x * lb.t.x + la.t.z * lb.t.z) < 0.985) continue; // crossing at a junction
        shared++;
        // a highlighted stripe (1.4 x wide) next to a normal one still leaves a gap
        expect(dist(la.c, lb.c)).toBeGreaterThanOrEqual(RIBBON.width * 1.2 + 0.04);
      }
    }
    expect(shared).toBeGreaterThan(20); // Main St etc. really are shared
  });
  it('keeps every lane (plus a highlighted stripe) on the 2.4 u road', () => {
    for (const off of RIBBON.lanes) expect(off + RIBBON.width * 0.7).toBeLessThan(1.2);
  });
});

describe('clock', () => {
  it('parses HH:MM clock strings', () => {
    expect(parseClock('21:30')).toBe(77400);
    expect(parseClock('00:00')).toBe(0);
    expect(parseClock('9:05')).toBe(32700);
    expect(parseClock('nonsense')).toBe(parseClock('12:00'));
  });
  it('turns clockwise (negative angles, 0 = 12 o\'clock) from the scenario start + sim time', () => {
    const a = clockAngles(parseClock('21:30'), 0);
    expect(a.minute).toBeCloseTo(-Math.PI);
    expect(a.hour).toBeCloseTo((-2 * Math.PI * 9.5) / 12);
    const b = clockAngles(0, 90);
    expect(b.minute).toBeCloseTo((-2 * Math.PI * 90) / 3600);
    const c = clockAngles(parseClock('11:45'), 15 * 60);
    expect(near(c.minute, 0) || near(c.minute, -2 * Math.PI)).toBe(true);
    expect(near(c.hour, 0) || near(c.hour, -2 * Math.PI)).toBe(true);
  });
});

describe('fx anchors', () => {
  const tower: SceneryItem = { kind: 'clockTower', x: -10.5, z: -9, rot: 0 };
  const stadium: SceneryItem = { kind: 'stadium', x: -19.8, z: 7.3, rot: 0 };
  const lawn: SceneryItem = { kind: 'lawn', x: 1, z: 2, w: 4, d: 2 };
  const district = (items: DistrictScenery['items'], region: DistrictScenery['region'], areas: DistrictScenery['areas'] = []): DistrictScenery =>
    ({ id: 'campus', region, items, paths: [], areas });

  it('tests circle and polygon regions', () => {
    expect(insideRegion({ center: { x: 0, z: 0 }, radius: 2 }, { x: 1, z: 1 })).toBe(true);
    expect(insideRegion({ center: { x: 0, z: 0 }, radius: 1 }, { x: 1, z: 1 })).toBe(false);
    const poly = { polygon: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }] };
    expect(insideRegion(poly, { x: 2, z: 2 })).toBe(true);
    expect(insideRegion(poly, { x: 5, z: 2 })).toBe(false);
  });
  it('drops base scenery inside a district region only when the district has items', () => {
    const region = { center: { x: -10, z: -9 }, radius: 4 };
    expect(keptScenery([tower, stadium], [district([], region)])).toHaveLength(2);
    expect(keptScenery([tower, stadium], [district([{ kind: 'st.bench', x: -10, z: -6 }], region)])).toEqual([stadium]);
  });
  it('puts four kit clock faces on a base clock tower, rotated with it', () => {
    const a = fxAnchors(TOWN, { scenery: [tower], districts: [] });
    expect(a.clockFaces).toHaveLength(4);
    const f = a.clockFaces[0]!;
    expect(f.x).toBeCloseTo(-10.5); expect(f.z).toBeCloseTo(-9 + CLOCK_TOWER.faces[0].z); expect(f.y).toBeCloseTo(CLOCK_TOWER.faces[0].y);
    expect(f.r).toBeCloseTo(CLOCK_TOWER.faceR);
    const r = fxAnchors(TOWN, { scenery: [{ ...tower, rot: Math.PI / 2 }], districts: [] }).clockFaces[0]!;
    expect(r.x).toBeCloseTo(-10.5 + CLOCK_TOWER.faces[0].z); expect(r.z).toBeCloseTo(-9); expect(r.rotY).toBeCloseTo(Math.PI / 2);
  });
  it('uses A4 clock faces for a district lm.clockTower (scaled), and kit station clocks for base stations', () => {
    const d = district([{ kind: 'lm.clockTower', x: -10, z: -9, rot: Math.PI, scale: 1.1, params: { hands: false } }], { center: { x: -10, z: -9 }, radius: 4 });
    const a = fxAnchors(TOWN, { scenery: [tower], districts: [d] });
    expect(a.clockFaces).toHaveLength(4);
    const f = a.clockFaces[0]!;
    expect(f.x).toBeCloseTo(-10); expect(f.z).toBeCloseTo(-9 - CLOCK_TOWER_FACES[0]!.z * 1.1);
    expect(f.y).toBeCloseTo(CLOCK_TOWER_FACES[0]!.y * 1.1); expect(f.r).toBeCloseTo(CLOCK_TOWER_FACES[0]!.r * 1.1);
    // A4 builds static hands unless params.hands === false: FX must not draw a second pair over them
    for (const params of [{ hands: true }, undefined]) {
      const withHands = district([{ kind: 'lm.clockTower', x: -10, z: -9, ...(params ? { params } : {}) }], { center: { x: -10, z: -9 }, radius: 4 });
      expect(fxAnchors(TOWN, { scenery: [], districts: [withHands] }).clockFaces).toHaveLength(0);
    }
    const st: SceneryItem = { kind: 'station', stationId: 'stn_central', x: 28.25, z: -2, rot: Math.PI / 2 };
    const s = fxAnchors(TOWN, { scenery: [st], districts: [] }).clockFaces;
    expect(s).toHaveLength(1);
    expect(s[0]!.r).toBeCloseTo(STATION_CLOCK.r);
    expect(s[0]!.y).toBeCloseTo(STATION_CLOCK.y);
  });
  it('aims four floodlights from mast heads down onto the pitch (kit and A4 stadiums)', () => {
    const kit = fxAnchors(TOWN, { scenery: [stadium], districts: [] }).stadiums;
    expect(kit).toHaveLength(1);
    expect(kit[0]!.floods).toHaveLength(STADIUM.masts.length);
    const a4 = fxAnchors(TOWN, { scenery: [], districts: [district([{ kind: 'lm.stadium', x: -18, z: 8, rot: Math.PI / 2 }], { center: { x: -18, z: 8 }, radius: 8 })] }).stadiums;
    expect(a4[0]!.floods).toHaveLength(STADIUM_FLOODLIGHTS.length);
    for (const s of [...kit, ...a4]) {
      for (const f of s.floods) {
        expect(f.head.y).toBeGreaterThan(3);
        expect(f.target.y).toBeLessThan(0.2);
        expect(Math.hypot(f.target.x - s.x, f.target.z - s.z)).toBeLessThan(Math.hypot(f.head.x - s.x, f.head.z - s.z));
      }
    }
  });
  it('collects district lamps (head height scaled) and lawns from base scenery + district areas', () => {
    const d = district([{ kind: 'st.lamp', x: 3, z: 4, scale: 1.2 }, { kind: 'st.lamp', x: 6, z: 4 }], { center: { x: 50, z: 50 }, radius: 1 },
      [{ kind: 'lawn', polygon: [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 3 }] }, { kind: 'parking', polygon: [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }] }]);
    const a = fxAnchors(TOWN, { scenery: [lawn], districts: [d] });
    expect(a.lamps).toHaveLength(2);
    expect(a.lamps[0]!.headY).toBeCloseTo(LAMP_HEAD.y * 1.2);
    expect(a.lawns).toHaveLength(2);
    expect(a.lawns[0]!.polygon).toHaveLength(4);
    // decals sit just above the surface they tint: kit lawn top 0.06, streetscape lawn top STREETSCAPE.heights.lawn
    expect(a.lawns[0]!.y).toBeGreaterThan(0.06); expect(a.lawns[0]!.y).toBeLessThan(0.07);
    expect(a.lawns[1]!.y).toBeGreaterThan(STREETSCAPE.heights.lawn);
    expect(a.lawns[1]!.y).toBeLessThan(STREETSCAPE.heights.footpath); // footpaths across a lawn stay untinted
  });
  it('rotates an offset lamp head with its placement', () => {
    const d = district([{ kind: 'st.lamp', x: 3, z: 4, rot: Math.PI / 2 }], { center: { x: 50, z: 50 }, radius: 1 });
    const a = fxAnchors(TOWN, { scenery: [], districts: [d] }, { head: { x: 0, y: 2, z: 0.5 } });
    expect(a.lamps[0]!.x).toBeCloseTo(3.5); expect(a.lamps[0]!.z).toBeCloseTo(4); expect(a.lamps[0]!.headY).toBeCloseTo(2);
  });
});

describe('fx anchors on the real town (SCENERY + DISTRICTS)', () => {
  const a = fxAnchors(TOWN);
  it('finds one stadium with floodlights, the district street lamps and the lawns', () => {
    expect(a.stadiums).toHaveLength(1);
    expect(a.stadiums[0]!.floods.length).toBeGreaterThanOrEqual(4);
    expect(a.lamps.length).toBeGreaterThan(5);
    expect(a.lawns.length).toBeGreaterThan(2);
    const b = TOWN.bounds;
    for (const l of a.lamps) { expect(l.x).toBeGreaterThan(b.minX - 1); expect(l.x).toBeLessThan(b.maxX + 1); }
  });
  it('never puts two clock faces on top of each other', () => {
    for (let i = 0; i < a.clockFaces.length; i++) for (let j = i + 1; j < a.clockFaces.length; j++) {
      const p = a.clockFaces[i]!, q = a.clockFaces[j]!;
      expect(Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)).toBeGreaterThan(0.3);
    }
  });
});

describe('kerb lamps (fallback where no district places lamps)', () => {
  const lamps = kerbLamps(TOWN);
  const segDist = (p: Vec2, a: Vec2, b: Vec2) => {
    const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2)) : 0;
    return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
  };
  it('lines the streets', () => {
    expect(lamps.length).toBeGreaterThan(12);
    expect(lamps.length).toBeLessThan(80);
  });
  it('stands on the kerb: off every road, rail, stop and queue line, inside the board', () => {
    const b = TOWN.bounds;
    for (const l of lamps) {
      const nearestRoad = Math.min(...TOWN.roads.edges.map((e) => projectOnPolyline(e.path, l).d));
      expect(nearestRoad).toBeGreaterThan(1.45);
      expect(nearestRoad).toBeLessThan(2.2);
      expect(projectOnPolyline(TOWN.rail.loop, l).d).toBeGreaterThan(1.5);
      for (const s of TOWN.stops) {
        expect(dist(l, s.p)).toBeGreaterThan(2.4);
        expect(segDist(l, s.p, { x: s.p.x + s.queueDir.x * 5, z: s.p.z + s.queueDir.z * 5 })).toBeGreaterThan(0.9);
      }
      for (const s of TOWN.rail.stations) expect(dist(l, s.platform)).toBeGreaterThan(2.4);
      for (const n of TOWN.roads.nodes) expect(dist(l, n.p)).toBeGreaterThan(2.4);
      expect(l.x).toBeGreaterThan(b.minX + 1); expect(l.x).toBeLessThan(b.maxX - 1);
      expect(l.z).toBeGreaterThan(b.minZ + 1); expect(l.z).toBeLessThan(b.maxZ - 1);
    }
  });
  it('respects a blocked() predicate and is deterministic', () => {
    expect(kerbLamps(TOWN)).toEqual(lamps);
    const west = kerbLamps(TOWN, { blocked: (p) => p.x < 0 });
    expect(west.every((l) => l.x >= 0)).toBe(true);
    expect(west.length).toBeLessThan(lamps.length);
  });
});

describe('confetti', () => {
  it('fires once when the sim clock crosses the advertised closing time', () => {
    expect(crossedClosing(590, 601, 600)).toBe(true);
    expect(crossedClosing(599.5, 600, 600)).toBe(true);
    expect(crossedClosing(601, 610, 600)).toBe(false);
    expect(crossedClosing(0, 2000, 600)).toBe(false); // jumped far past it (fast-forward): no burst
    expect(crossedClosing(590, 601, null)).toBe(false);
  });
  it('bursts up and outward, falls, and is gone after its lifetime (deterministic per seed)', () => {
    const run = (seed: number) => {
      const s = new ConfettiSim(256);
      s.burst({ x: 2, y: 2, z: -1 }, 180, seed);
      expect(s.alive).toBe(180);
      let top = 0, far = 0;
      for (let i = 0; i < 60; i++) {
        s.step(1 / 30);
        for (const p of s.particles) if (p.life > 0) { top = Math.max(top, p.y); far = Math.max(far, Math.hypot(p.x - 2, p.z + 1)); }
      }
      const snap = s.particles.slice(0, 5).map((p) => [p.x, p.y, p.z]);
      for (let i = 0; i < 300; i++) s.step(1 / 30);
      return { top, far, snap, alive: s.alive };
    };
    const a = run(7), b = run(7), c = run(8);
    expect(a.top).toBeGreaterThan(4);
    expect(a.far).toBeGreaterThan(1.5);
    expect(a.far).toBeLessThan(9);
    expect(a.alive).toBe(0);
    expect(a.snap).toEqual(b.snap);
    expect(a.snap).not.toEqual(c.snap);
  });
});
