import { describe, expect, it } from 'vitest';
import type { RouteId, StationId, StopId, Vec2 } from '../src/contracts';
import { withConfig } from '../src/config';
import { distance, nearestDist, pointAt, polyline, projectOnPolyline, roundCorners } from '../src/map/geometry';
import { deadheadPath, shortestPath } from '../src/map/roadGraph';
import { nearestAccess, RAIL_SHORE_Z, RAIL_SPANS, routeById, stationById, stopById, TOWN, zoneById } from '../src/map/town';

const STOP_IDS: StopId[] = ['stop_stadium_gate', 'stop_stadium_stn', 'stop_university_stn', 'stop_old_main',
  'stop_downtown', 'stop_central_stn', 'stop_apts_north', 'stop_apts_south'];
const STATION_IDS: StationId[] = ['stn_stadium', 'stn_central', 'stn_university']; // rail travel order
const ROUTE_IDS: RouteId[] = ['r1', 'r2', 'r3'];
const off = (poly: ReturnType<typeof polyline>, p: Vec2) => projectOnPolyline(poly, p).d;

describe('geometry', () => {
  const square = polyline([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }], true);
  it('polyline measures open and closed lengths without repeating the first point', () => {
    expect(square.length).toBeCloseTo(40);
    expect(square.cum).toEqual([0, 10, 20, 30]);
    expect(square.points).toHaveLength(4);
    expect(polyline([{ x: 0, z: 0 }, { x: 3, z: 4 }], false).length).toBeCloseTo(5);
    expect(polyline([{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 0, z: 0 }], true).points).toHaveLength(2);
  });
  it('pointAt interpolates, wraps closed paths and clamps open ones', () => {
    expect(pointAt(square, 5)).toMatchObject({ x: 5, z: 0 });
    expect(pointAt(square, 45)).toMatchObject({ x: 5, z: 0 });
    expect(pointAt(square, -5).x).toBeCloseTo(0);
    expect(pointAt(square, -5).z).toBeCloseTo(5);
    expect(pointAt(square, 35).z).toBeCloseTo(5); // closing segment
    const open = polyline([{ x: 0, z: 0 }, { x: 10, z: 0 }], false);
    expect(pointAt(open, 99)).toMatchObject({ x: 10, z: 0 });
    expect(pointAt(open, -1)).toMatchObject({ x: 0, z: 0 });
  });
  it('heading turns a +x-forward model to face the travel direction (rotation.y)', () => {
    expect(pointAt(square, 5).heading).toBeCloseTo(0); // east
    expect(pointAt(square, 15).heading).toBeCloseTo(-Math.PI / 2); // south (+z)
    expect(Math.abs(pointAt(square, 25).heading)).toBeCloseTo(Math.PI); // west
  });
  it('nearestDist returns the arc length of the closest point', () => {
    expect(nearestDist(square, { x: 4, z: -1 })).toBeCloseTo(4);
    expect(nearestDist(square, { x: 11, z: 6 })).toBeCloseTo(16);
    expect(nearestDist(square, { x: -1, z: 3 })).toBeCloseTo(37);
    expect(off(square, { x: 4, z: -1 })).toBeCloseTo(1);
  });
  it('roundCorners fillets corners inside the original polygon and keeps straight runs', () => {
    const r = roundCorners([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }], 2, false, 6);
    expect(r[0]).toEqual({ x: 0, z: 0 });
    expect(r[r.length - 1]).toEqual({ x: 10, z: 10 });
    const p = polyline(r, false);
    expect(p.length).toBeLessThan(20);
    expect(p.length).toBeGreaterThan(19);
    for (const q of r) expect(distance(q, { x: 10, z: 0 })).toBeGreaterThan(0.5);
    expect(roundCorners([{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 10, z: 0 }], 2, false)).toHaveLength(3);
  });
});

describe('town topology', () => {
  it('lists every stop, station and route exactly once', () => {
    expect(TOWN.stops.map((s) => s.id).sort()).toEqual([...STOP_IDS].sort());
    expect(TOWN.rail.stations.map((s) => s.id)).toEqual(STATION_IDS); // travel order
    expect(TOWN.routes.map((r) => r.id)).toEqual(ROUTE_IDS);
    for (const id of STOP_IDS) expect(stopById(TOWN, id).id).toBe(id);
    for (const id of STATION_IDS) expect(stationById(TOWN, id).id).toBe(id);
    for (const id of ROUTE_IDS) expect(routeById(TOWN, id).id).toBe(id);
  });
  it('follows the spec §4 stop orders, colours and servedRoutes', () => {
    expect(routeById(TOWN, 'r1').stops).toEqual(['stop_central_stn', 'stop_downtown', 'stop_old_main', 'stop_university_stn']);
    expect(routeById(TOWN, 'r2').stops).toEqual(['stop_central_stn', 'stop_apts_north', 'stop_apts_south', 'stop_downtown']);
    expect(routeById(TOWN, 'r3').stops).toEqual(['stop_stadium_gate', 'stop_stadium_stn', 'stop_old_main', 'stop_downtown']);
    expect(TOWN.routes.map((r) => r.color)).toEqual(['#1FA99A', '#F0A830', '#8A6BD8']);
    for (const s of TOWN.stops) {
      const serving = TOWN.routes.filter((r) => r.stops.includes(s.id)).map((r) => r.id);
      expect(s.servedRoutes, s.id).toEqual(serving);
    }
    expect(routeById(TOWN, 'r1').terminalNode).toBe(routeById(TOWN, 'r2').terminalNode);
    expect(routeById(TOWN, 'r3').terminalNode).not.toBe(routeById(TOWN, 'r1').terminalNode);
  });
  it('pairs each station with its stop within 4 u of the platform', () => {
    for (const st of TOWN.rail.stations) {
      const stop = stopById(TOWN, st.stopId);
      expect(stop.stationId).toBe(st.id);
      expect(distance(stop.p, st.platform), st.id).toBeLessThanOrEqual(4);
    }
  });
});

describe('route geometry', () => {
  it('stops sit within 1.2 u of every serving route path', () => {
    for (const r of TOWN.routes) for (const sid of r.stops) {
      expect(off(r.path, stopById(TOWN, sid).p), `${r.id} ${sid}`).toBeLessThanOrEqual(1.2);
    }
  });
  it('stopDist is strictly increasing from the terminal and matches the stops', () => {
    for (const r of TOWN.routes) {
      expect(r.path.closed).toBe(true);
      expect(r.stopDist).toHaveLength(r.stops.length);
      expect(r.stopDist[0]!).toBeLessThan(0.01);
      for (let i = 1; i < r.stopDist.length; i++) expect(r.stopDist[i]!, r.id).toBeGreaterThan(r.stopDist[i - 1]!);
      expect(r.stopDist[r.stopDist.length - 1]!).toBeLessThan(r.path.length);
      r.stops.forEach((sid, i) => {
        const at = pointAt(r.path, r.stopDist[i]!);
        expect(distance(at, stopById(TOWN, sid).p), `${r.id} ${sid}`).toBeLessThanOrEqual(1.2);
      });
    }
  });
  it('route loops are 95–125 u and calibrated', () => {
    const cfg = withConfig();
    for (const r of TOWN.routes) {
      expect(r.path.length, r.id).toBeGreaterThanOrEqual(95);
      expect(r.path.length, r.id).toBeLessThanOrEqual(125);
      expect(r.nominalLoopS).toBe(Math.round(r.path.length / cfg.bus.speed + r.stops.length * 20));
      expect(r.advertisedHeadwayS).toBe(Math.round(r.nominalLoopS / 2));
      expect(r.nominalLoopS / 60).toBeGreaterThanOrEqual(6);
      expect(r.nominalLoopS / 60).toBeLessThanOrEqual(9);
    }
  });
  it('route paths follow road edges (every path point is on a road)', () => {
    const roads = TOWN.roads.edges.map((e) => e.path);
    for (const r of TOWN.routes) {
      for (let d = 0; d < r.path.length; d += 0.5) {
        const p = pointAt(r.path, d);
        const best = Math.min(...roads.map((e) => off(e, p)));
        expect(best, `${r.id} @${d.toFixed(1)}`).toBeLessThan(0.7);
      }
    }
  });
  it('path starts at the terminal node and the terminal stop', () => {
    for (const r of TOWN.routes) {
      const node = TOWN.roads.nodes.find((n) => n.id === r.terminalNode)!;
      expect(distance(r.path.points[0]!, node.p)).toBeLessThan(1e-9);
      expect(distance(node.p, stopById(TOWN, r.stops[0]!).p)).toBeLessThanOrEqual(1.2);
    }
  });
});

describe('rail', () => {
  const { loop, stations } = TOWN.rail;
  const L = loop.length;
  const b = TOWN.bounds;
  const offBoard = (p: Vec2) => p.x < b.minX || p.x > b.maxX || p.z < b.minZ || p.z > b.maxZ;
  const inSpan = (d: number, [a, c]: [number, number]) => d >= a && d <= c;
  it('is one closed regional loop of 220–250 u with stations in travel order Stadium → Central → University', () => {
    expect(loop.closed).toBe(true);
    expect(L).toBeGreaterThanOrEqual(220);
    expect(L).toBeLessThanOrEqual(250);
    const d = stations.map((s) => s.dist);
    expect(d[0]!).toBeLessThan(0.01); // the loop starts at Stadium's platform centre
    expect(d[0]!).toBeLessThan(d[1]!);
    expect(d[1]!).toBeLessThan(d[2]!);
    expect(d[2]!).toBeLessThan(L);
    // Stadium → Central is the lakeshore/bridge side; Central → University runs straight across the north
    expect(d[1]! - d[0]!).toBeLessThan(95);
    expect(d[2]! - d[1]!).toBeLessThan(65);
  });
  it('platforms face the town: inside the board, 0.75–3.15 u from the rail, queue along the track', () => {
    for (const st of stations) {
      expect(off(loop, st.platform)).toBeGreaterThan(0.75);
      expect(off(loop, st.platform)).toBeLessThan(3.15);
      expect(Math.abs(st.platform.x)).toBeLessThan(30);
      expect(Math.abs(st.platform.z)).toBeLessThan(22);
      expect(Math.hypot(st.queueDir.x, st.queueDir.z)).toBeCloseTo(1);
      const centre = pointAt(loop, st.dist);
      expect(distance(centre, st.platform)).toBeLessThan(4);
      expect(offBoard(centre)).toBe(false);
    }
  });
  it('a train loop takes about 5.5–7 min at the default speed and dwell, and the advertised headway matches it', () => {
    const cfg = withConfig();
    const loopS = L / cfg.train.speed + 3 * cfg.train.defaultDwellS;
    expect(loopS / 60).toBeGreaterThan(5.25);
    expect(loopS / 60).toBeLessThan(7);
    expect(Math.abs(TOWN.rail.advertisedHeadwayS - loopS)).toBeLessThan(0.1 * loopS);
  });
  it('curves smoothly: no curve radius under 6 u anywhere', () => {
    let minR = Infinity;
    for (let d = 0; d < L; d += 0.25) {
      const p = pointAt(loop, d - 1), q = pointAt(loop, d), r = pointAt(loop, d + 1);
      const area2 = Math.abs((q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x));
      if (area2 > 1e-9) minR = Math.min(minR, (distance(p, q) * distance(q, r) * distance(p, r)) / (2 * area2));
    }
    expect(minR).toBeGreaterThanOrEqual(6);
  });
  it('every station sits on a straight of at least ±5 u (its platform is 9 u long)', () => {
    for (const st of stations) {
      const c = pointAt(loop, st.dist);
      for (let k = -5; k <= 5; k += 0.5) {
        const p = pointAt(loop, st.dist + k);
        const sideways = Math.abs((p.x - c.x) * Math.sin(c.heading) + (p.z - c.z) * Math.cos(c.heading));
        expect(sideways, `${st.id} ${k}`).toBeLessThan(0.02);
      }
    }
  });
  it('leaves the board only through the north-west ridge tunnel and the south-east lakeshore + bay bridge', () => {
    expect(RAIL_SPANS.offBoard).toHaveLength(2);
    const [south, tunnel] = RAIL_SPANS.offBoard as [[number, number], [number, number]];
    expect(RAIL_SPANS.tunnel).toEqual(tunnel);
    for (let d = 0; d < L; d += 0.5) {
      const p = pointAt(loop, d);
      const off = inSpan(d, south) || inSpan(d, tunnel);
      if (!off) expect(offBoard(p), `on board @${d}`).toBe(false);
      if (inSpan(d + 0.2, tunnel) && inSpan(d - 0.2, tunnel)) expect(p.x < b.minX || p.z < b.minZ, `tunnel @${d}`).toBe(true);
      if (inSpan(d + 0.2, south) && inSpan(d - 0.2, south)) expect(p.z > b.maxZ || p.x > b.maxX, `south @${d}`).toBe(true);
      if (inSpan(d + 0.2, RAIL_SPANS.bridge) && inSpan(d - 0.2, RAIL_SPANS.bridge)) expect(p.z, `bridge @${d}`).toBeGreaterThan(RAIL_SHORE_Z);
    }
    expect(RAIL_SPANS.bridge[0]).toBeGreaterThan(south[0]);
    expect(RAIL_SPANS.bridge[1]).toBeLessThan(south[1]);
    expect(RAIL_SPANS.bridge[1] - RAIL_SPANS.bridge[0]).toBeGreaterThan(20); // a long bridge
    expect(tunnel[1] - tunnel[0]).toBeGreaterThan(30);
    for (const st of stations) for (const sp of RAIL_SPANS.offBoard) expect(inSpan(st.dist, sp), st.id).toBe(false);
  });
  it('level-crosses roads only square-on and keeps clear of stops, platforms, queue lines and doors', () => {
    const lp = loop.points;
    let crossings = 0;
    for (const e of TOWN.roads.edges) {
      const pts = e.path.points;
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i]!, c = pts[i + 1]!;
        for (let j = 0; j < lp.length; j++) {
          const p = lp[j]!, q = lp[(j + 1) % lp.length]!;
          const ax = c.x - a.x, az = c.z - a.z, bx = q.x - p.x, bz = q.z - p.z;
          const den = ax * bz - az * bx;
          if (Math.abs(den) < 1e-12) continue;
          const t = ((p.x - a.x) * bz - (p.z - a.z) * bx) / den, u = ((p.x - a.x) * az - (p.z - a.z) * ax) / den;
          if (t < 0 || t > 1 || u < 0 || u > 1) continue;
          crossings++;
          const cos = Math.abs(ax * bx + az * bz) / Math.hypot(ax, az) / Math.hypot(bx, bz);
          expect(cos, `${e.id} crossing`).toBeLessThan(Math.sin((10 * Math.PI) / 180)); // within 10° of square
        }
      }
    }
    expect(crossings).toBe(2); // Atherton St north exit, South Rd east exit (Atherton's south exit crosses on the beach)
    for (const s of TOWN.stops) {
      expect(off(loop, s.p), s.id).toBeGreaterThan(5);
      for (let k = 0; k <= 4; k += 0.5) expect(off(loop, { x: s.p.x + s.queueDir.x * k, z: s.p.z + s.queueDir.z * k }), `${s.id} queue`).toBeGreaterThan(1.5);
    }
    for (const st of stations) for (let k = 0; k <= 4; k += 0.5) {
      expect(off(loop, { x: st.platform.x + st.queueDir.x * k, z: st.platform.z + st.queueDir.z * k }), `${st.id} queue`).toBeGreaterThan(2);
    }
    for (const z of TOWN.zones) expect(off(loop, z.door), z.id).toBeGreaterThan(2);
  });
});

describe('roads', () => {
  const deg = new Map<string, number>();
  for (const e of TOWN.roads.edges) for (const n of [e.a, e.b]) deg.set(n, (deg.get(n) ?? 0) + 1);
  it('edges connect existing nodes and their paths start/end at them', () => {
    const nodes = new Map(TOWN.roads.nodes.map((n) => [n.id, n.p]));
    for (const e of TOWN.roads.edges) {
      expect(nodes.has(e.a) && nodes.has(e.b), e.id).toBe(true);
      expect(distance(e.path.points[0]!, nodes.get(e.a)!)).toBeLessThan(1e-9);
      expect(distance(e.path.points[e.path.points.length - 1]!, nodes.get(e.b)!)).toBeLessThan(1e-9);
      expect(e.path.closed).toBe(false);
    }
  });
  it('is connected with no dead ends except 3–4 board-edge exits', () => {
    const b = TOWN.bounds;
    const exits = TOWN.roads.nodes.filter((n) => deg.get(n.id) === 1);
    expect(exits.length).toBeGreaterThanOrEqual(3);
    expect(exits.length).toBeLessThanOrEqual(4);
    for (const n of exits) expect([b.minX, b.maxX].includes(n.p.x) || [b.minZ, b.maxZ].includes(n.p.z), n.id).toBe(true);
    for (const n of TOWN.roads.nodes) expect(deg.get(n.id) ?? 0, n.id).toBeGreaterThan(0);
    const seen = new Set([TOWN.roads.nodes[0]!.id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const e of TOWN.roads.edges) if (seen.has(e.a) !== seen.has(e.b)) { seen.add(e.a); seen.add(e.b); grew = true; }
    }
    expect(seen.size).toBe(TOWN.roads.nodes.length);
  });
  it('shortestPath runs between any two nodes along the roads', () => {
    const p = shortestPath(TOWN, 'x_west', 'x_east');
    expect(distance(p.points[0]!, { x: -36, z: 0 })).toBeLessThan(1e-9);
    expect(p.length).toBeGreaterThan(72);
    expect(p.length).toBeLessThan(100);
  });
});

describe('deadheads', () => {
  it('r1 → r3 runs from the r1 terminal stop to the r3 terminal stop', () => {
    const p = deadheadPath(TOWN, 'r1', 'r3');
    const s1 = stopById(TOWN, routeById(TOWN, 'r1').stops[0]!);
    const s3 = stopById(TOWN, routeById(TOWN, 'r3').stops[0]!);
    expect(distance(p.points[0]!, s1.p)).toBeLessThanOrEqual(3);
    expect(distance(p.points[p.points.length - 1]!, s3.p)).toBeLessThanOrEqual(3);
    expect(p.length).toBeGreaterThan(30);
    expect(deadheadPath(TOWN, 'r1', 'r3')).toBe(p); // cached
    const back = deadheadPath(TOWN, 'r3', 'r2');
    expect(distance(back.points[0]!, s3.p)).toBeLessThanOrEqual(3);
  });
  it('r1 ↔ r2 share a terminal: zero-length deadhead', () => {
    expect(deadheadPath(TOWN, 'r1', 'r2').length).toBe(0);
  });
});

describe('zones', () => {
  it('has 14–20 zones with the required tags', () => {
    expect(TOWN.zones.length).toBeGreaterThanOrEqual(14);
    expect(TOWN.zones.length).toBeLessThanOrEqual(20);
    expect(new Set(TOWN.zones.map((z) => z.id)).size).toBe(TOWN.zones.length);
    const tagged = (t: string) => TOWN.zones.filter((z) => z.tags.includes(t as never));
    expect(tagged('stadium').length).toBeGreaterThanOrEqual(3);
    expect(tagged('station')).toHaveLength(3);
    expect(tagged('hall').some((z) => z.name === 'Old Main')).toBe(true);
    for (const z of tagged('hall')) expect(z.neighborhood).toBe('campus');
    for (const z of tagged('retail')) expect(z.neighborhood).toBe('downtown');
    for (const z of tagged('housing')) expect(z.neighborhood).toBe('apartments');
    for (const z of tagged('stadium')) expect(z.neighborhood).toBe('stadium');
    for (const n of TOWN.neighborhoods) expect(TOWN.zones.some((z) => z.neighborhood === n.id)).toBe(true);
    expect(zoneById(TOWN, 'z_old_main').name).toBe('Old Main');
    for (const z of TOWN.zones) expect(z.weight).toBeGreaterThan(0);
  });
  it('every door is 5–12 u from its nearest stop or platform (within accessRadius)', () => {
    const cfg = withConfig();
    for (const z of TOWN.zones) {
      const a = nearestAccess(TOWN, z.door);
      expect(a.d, `${z.id} → ${a.at}`).toBeGreaterThanOrEqual(5);
      expect(a.d, `${z.id} → ${a.at}`).toBeLessThanOrEqual(12);
      expect(a.d).toBeLessThanOrEqual(cfg.walk.accessRadius);
    }
  });
  it('doors are off the roads and inside their neighbourhood', () => {
    for (const z of TOWN.zones) {
      for (const e of TOWN.roads.edges) expect(off(e.path, z.door), `${z.id} on ${e.id}`).toBeGreaterThan(1.2);
      const n = TOWN.neighborhoods.find((h) => h.id === z.neighborhood)!;
      if (!z.tags.includes('station')) expect(distance(z.door, n.center), z.id).toBeLessThanOrEqual(n.radius);
    }
  });
});

describe('bounds', () => {
  it('all geometry lies inside the board (the rail closes off the board; see the rail tests)', () => {
    const b = TOWN.bounds;
    expect(b).toEqual({ minX: -36, maxX: 36, minZ: -26, maxZ: 26 });
    const pts: Vec2[] = [
      ...TOWN.roads.nodes.map((n) => n.p), ...TOWN.roads.edges.flatMap((e) => e.path.points),
      ...TOWN.rail.stations.map((s) => s.platform), ...TOWN.stops.map((s) => s.p),
      ...TOWN.zones.map((z) => z.door), ...TOWN.routes.flatMap((r) => r.path.points),
    ];
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(b.minX);
      expect(p.x).toBeLessThanOrEqual(b.maxX);
      expect(p.z).toBeGreaterThanOrEqual(b.minZ);
      expect(p.z).toBeLessThanOrEqual(b.maxZ);
    }
  });
  it('stop queues grow away from the road', () => {
    for (const s of TOWN.stops) {
      expect(Math.hypot(s.queueDir.x, s.queueDir.z)).toBeCloseTo(1);
      const ahead = { x: s.p.x + s.queueDir.x * 2, z: s.p.z + s.queueDir.z * 2 };
      const roadsNear = TOWN.roads.edges.map((e) => off(e.path, ahead));
      expect(Math.min(...roadsNear), s.id).toBeGreaterThan(Math.min(...TOWN.roads.edges.map((e) => off(e.path, s.p))));
    }
  });
});
