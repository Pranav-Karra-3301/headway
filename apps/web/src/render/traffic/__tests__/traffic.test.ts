// Owner: T2.3. Pure traffic helpers (no WebGL): lane graph, stepping, spacing, road-graph containment, exits,
// level crossings, buses, the stadium surge and determinism.
import { describe, expect, it } from 'vitest';
import { TOWN, pointAt, projectOnPolyline } from '@headway/sim';
import type { Vec2 } from '@headway/sim';
import { JUNCTION_TRIM, LANE_OFFSET, ROAD_HALF_WIDTH, buildLaneGraph, type LaneGraph } from '../lanes';
import { MIN_SPACING, createTrafficModel, mapBuses, type BusPose, type TrafficCar, type TrafficModel } from '../model';
import { mulberry32 } from '../rng';

const graph: LaneGraph = buildLaneGraph(TOWN);
const STADIUM = TOWN.neighborhoods.find((n) => n.id === 'stadium')!.center;
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

/** Along-path centre distance from `a` forward to `b` when they share a piece or adjacent pieces, else null. */
function pathGap(a: TrafficCar, b: TrafficCar): number | null {
  if (a.conn && b.conn) return a.conn === b.conn && b.s > a.s ? b.s - a.s : null;
  if (!a.conn && !b.conn) return a.lane === b.lane && b.s > a.s ? b.s - a.s : null;
  if (!a.conn && b.conn) return b.conn.from === a.lane ? a.lane.len - a.s + b.s : null;
  if (a.conn && !b.conn) return a.conn.to === b.lane ? a.conn.len - a.s + b.s : null;
  return null;
}

function nearestRoad(p: Vec2): number {
  let best = Infinity;
  for (const e of TOWN.roads.edges) best = Math.min(best, projectOnPolyline(e.path, p).d);
  return best;
}

function run(model: TrafficModel, seconds: number, dt: number, env: (t: number) => { buses?: BusPose[]; trainDist?: number | null } = () => ({}),
  each?: (t: number) => void, t0 = 0): number {
  let t = t0;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    t += dt;
    model.step(dt, { simT: t, ...env(t) });
    each?.(t);
  }
  return t;
}

describe('mulberry32', () => {
  it('is deterministic per seed and spreads over [0, 1)', () => {
    const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43);
    const xs = Array.from({ length: 200 }, () => a());
    expect(xs).toEqual(Array.from({ length: 200 }, () => b()));
    expect(xs.slice(0, 5)).not.toEqual(Array.from({ length: 5 }, () => c()));
    for (const x of xs) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
    expect(Math.min(...xs)).toBeLessThan(0.1);
    expect(Math.max(...xs)).toBeGreaterThan(0.9);
  });
});

describe('buildLaneGraph', () => {
  it('has a lane per road edge and direction, offset to the right of travel', () => {
    expect(graph.lanes.length).toBe(TOWN.roads.edges.length * 2);
    for (const lane of graph.lanes) {
      expect(lane.len).toBeGreaterThan(0.5);
      const mid = pointAt(lane.poly, lane.len / 2);
      const c = projectOnPolyline(lane.centre, mid);
      expect(c.d).toBeCloseTo(LANE_OFFSET, 1);
      // Right of travel: (−dz, dx) of the centreline direction points at the lane.
      const h = pointAt(lane.centre, c.dist);
      const dx = Math.cos(h.heading), dz = -Math.sin(h.heading);
      expect((mid.x - c.x) * -dz + (mid.z - c.z) * dx).toBeGreaterThan(0);
    }
  });

  it('trims lanes at junctions only, and finds the 4 board exits as entries', () => {
    for (const lane of graph.lanes) {
      const from = graph.nodes.get(lane.from)!, to = graph.nodes.get(lane.to)!;
      const p0 = lane.poly.points[0]!, p1 = lane.poly.points[lane.poly.points.length - 1]!;
      if (from.junction) expect(dist(p0, from.p)).toBeGreaterThan(JUNCTION_TRIM - 0.05);
      else expect(dist(p0, from.p)).toBeLessThan(LANE_OFFSET + 0.3);
      if (to.junction) expect(dist(p1, to.p)).toBeGreaterThan(JUNCTION_TRIM - 0.05);
    }
    expect(graph.entries.map((l) => l.from).sort()).toEqual(['x_east', 'x_north', 'x_south', 'x_west']);
    for (const l of graph.lanes) expect(l.exit).toBe(graph.nodes.get(l.to)!.exit);
  });

  it('connects every non-exit lane onward, never by a U-turn, with smooth turns', () => {
    for (const lane of graph.lanes) {
      const out = graph.out.get(lane.id)!;
      if (lane.exit) expect(out.length).toBe(0);
      else expect(out.length).toBeGreaterThan(0);
      for (const c of out) {
        expect(c.from).toBe(lane);
        expect(c.to.edgeId).not.toBe(lane.edgeId);
        expect(c.to.from).toBe(lane.to);
        const pts = c.poly.points;
        if (pts.length < 3) continue;
        for (let i = 1; i + 1 < pts.length; i++) {
          const a = Math.atan2(pts[i]!.z - pts[i - 1]!.z, pts[i]!.x - pts[i - 1]!.x);
          const b = Math.atan2(pts[i + 1]!.z - pts[i]!.z, pts[i + 1]!.x - pts[i]!.x);
          const turn = Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
          expect(turn).toBeLessThan((25 * Math.PI) / 180);
        }
      }
    }
    const turns = new Set(graph.connectors.map((c) => c.turn));
    expect(turns).toEqual(new Set(['straight', 'left', 'right']));
  });

  it('keeps every lane and connector point on the road surface', () => {
    for (const l of graph.lanes) for (const p of l.poly.points) expect(nearestRoad(p)).toBeLessThan(ROAD_HALF_WIDTH + 0.02);
    for (const c of graph.connectors) for (const p of c.poly.points) expect(nearestRoad(p)).toBeLessThan(ROAD_HALF_WIDTH + 0.02);
  });

  it('marks crossing movements at a junction as conflicting, and opposite straights as compatible', () => {
    const j = 'j_main_atherton';
    const at = graph.connectors.filter((c) => c.node === j);
    const straights = at.filter((c) => c.turn === 'straight');
    const ew = straights.filter((c) => c.from.edgeId.startsWith('main'));
    expect(ew.length).toBe(2);
    expect(ew[0]!.conflicts.has(ew[1]!.id)).toBe(false);
    const ns = straights.find((c) => c.from.edgeId.startsWith('ath'))!;
    expect(ew[0]!.conflicts.has(ns.id)).toBe(true);
    for (const c of at) for (const d of at) if (c !== d && (c.from === d.from || c.to === d.to)) expect(c.conflicts.has(d.id)).toBe(true);
  });

  it('finds the level crossings where exit roads cross the rail loop', () => {
    expect(graph.crossings.length).toBe(8); // 4 exit roads × 2 directions
    for (const x of graph.crossings) {
      const p = pointAt(x.lane.poly, x.s);
      const r = pointAt(TOWN.rail.loop, x.railDist);
      expect(dist(p, r)).toBeLessThan(0.05);
    }
  });
});

describe('mapBuses', () => {
  it('puts a bus on the lane matching its heading, not the opposite one', () => {
    const lane = graph.laneById.get('main_3:f')!;
    const c = pointAt(lane.centre, 7);
    const bus: BusPose = { id: 'b1', x: c.x, z: c.z, dx: Math.cos(c.heading), dz: -Math.sin(c.heading), halfLen: 1.65, stopped: false };
    const m = mapBuses(graph, [bus]);
    const on = m.lanes.get('main_3:f') ?? [];
    expect(on.length).toBe(1);
    expect(on[0]!.s).toBeCloseTo(7 - lane.trimStart, 0);
    expect(m.lanes.get('main_3:r') ?? []).toHaveLength(0);
  });
  it('marks a junction blocked while a bus is in its box', () => {
    const n = graph.nodes.get('j_main_allen')!;
    const m = mapBuses(graph, [{ id: 'b2', x: n.p.x + 0.3, z: n.p.z, dx: 1, dz: 0, halfLen: 1.65, stopped: false }]);
    expect(m.blockedNodes.has('j_main_allen')).toBe(true);
  });
});

describe('traffic model', () => {
  it('fills to the requested count (14–24) right away and never exceeds 24', () => {
    for (const n of [14, 18, 24]) {
      const m = createTrafficModel(graph, { seed: 7, carCount: n });
      m.step(0.1, { simT: 0.1 });
      expect(m.cars.length).toBe(n);
    }
    const m = createTrafficModel(graph, { seed: 7, carCount: 40 });
    m.step(0.1, { simT: 0.1 });
    expect(m.cars.length).toBeLessThanOrEqual(24);
    const d = createTrafficModel(graph, { seed: 7 });
    d.step(0.1, { simT: 0.1 });
    expect(d.cars.length).toBeGreaterThanOrEqual(14);
    expect(d.cars.length).toBeLessThanOrEqual(24);
  });

  it('keeps ≥ 2.5 u spacing on shared lanes/connectors, never overlaps, never leaves the road graph', () => {
    const m = createTrafficModel(graph, { seed: 11, carCount: 24 });
    let checks = 0, k = 0;
    run(m, 1500, 0.25, () => ({}), () => {
      const cars = m.cars;
      const road = k++ % 3 === 0;
      for (const a of cars) {
        if (road) expect(nearestRoad(a)).toBeLessThan(ROAD_HALF_WIDTH + 0.05);
        expect(Number.isFinite(a.heading)).toBe(true);
        for (const b of cars) {
          if (a === b) continue;
          const g = pathGap(a, b);
          if (g !== null) { expect(g).toBeGreaterThanOrEqual(MIN_SPACING - 1e-6); checks++; }
          expect(dist(a, b)).toBeGreaterThan(1.0);
        }
      }
    });
    expect(checks).toBeGreaterThan(100);
  }, 60_000);

  it('never makes a U-turn and never lets conflicting movements share a junction', () => {
    const m = createTrafficModel(graph, { seed: 5, carCount: 22 });
    const lastLane = new Map<number, TrafficCar['lane']>();
    let changes = 0;
    run(m, 1200, 0.25, () => ({}), () => {
      for (const c of m.cars) {
        if (c.conn) { expect(c.conn.to.edgeId).not.toBe(c.conn.from.edgeId); continue; }
        const prev = lastLane.get(c.id);
        if (prev && prev !== c.lane) { expect(c.lane.edgeId).not.toBe(prev.edgeId); changes++; }
        lastLane.set(c.id, c.lane);
      }
      const onConn = m.cars.filter((c) => c.conn);
      for (const a of onConn) for (const b of onConn) {
        if (a === b || a.conn!.node !== b.conn!.node || a.conn === b.conn) continue;
        expect(a.conn!.conflicts.has(b.conn!.id)).toBe(false);
      }
    });
    expect(changes).toBeGreaterThan(50);
  });

  it('cars leave at board-edge exits and new cars enter there', () => {
    const m = createTrafficModel(graph, { seed: 3, carCount: 16 });
    m.step(0.1, { simT: 0.1 });
    const seen = new Map(m.cars.map((c) => [c.id, c] as const));
    let left = 0, entered = 0;
    run(m, 2400, 0.25, () => ({}), () => {
      const now = new Map(m.cars.map((c) => [c.id, c] as const));
      for (const [id, c] of seen) if (!now.has(id) && c.lane.exit && !c.conn && c.s > c.lane.len - 1.5) left++;
      for (const [id, c] of now) if (!seen.has(id)) {
        expect(c.lane.entry && !c.conn && c.s < 1.5).toBe(true);
        entered++;
      }
      seen.clear();
      for (const [id, c] of now) seen.set(id, { ...c });
    }, 0.1);
    expect(left).toBeGreaterThan(3);
    expect(entered).toBeGreaterThan(3);
  });

  it('is deterministic for a seed and differs across seeds', () => {
    const snap = (seed: number) => {
      const m = createTrafficModel(graph, { seed, carCount: 18 });
      run(m, 300, 0.2);
      return m.cars.map((c) => `${c.id}:${c.x.toFixed(4)},${c.z.toFixed(4)}`).join('|');
    };
    expect(snap(99)).toBe(snap(99));
    expect(snap(99)).not.toBe(snap(100));
  });

  it('keeps spacing behind a bus on the same lane and waits behind a stopped bus', () => {
    const lane = graph.laneById.get('main_2:f')!;
    const c = pointAt(lane.centre, lane.trimStart + lane.len - 3);
    const bus: BusPose = { id: 'b1', x: c.x, z: c.z, dx: Math.cos(c.heading), dz: -Math.sin(c.heading), halfLen: 1.65, stopped: false };
    const m = createTrafficModel(graph, { seed: 21, carCount: 24 });
    let behind = 0;
    run(m, 600, 0.25, () => ({ buses: [bus] }), () => {
      for (const car of m.cars) {
        if (car.conn || car.lane !== lane) continue;
        const busS = lane.len - 3;
        if (car.s < busS) { expect(busS - car.s).toBeGreaterThanOrEqual(Math.max(MIN_SPACING, 1.65 + car.halfLen + 0.4) - 1e-6); behind++; }
      }
    });
    expect(behind).toBeGreaterThan(0);
  });

  it('stops before a level crossing while the train is on it', () => {
    const x = graph.crossings[0]!;
    const m = createTrafficModel(graph, { seed: 8, carCount: 24 });
    let waited = 0;
    run(m, 900, 0.25, () => ({ trainDist: x.railDist }), (t) => {
      if (t < 30) return;
      for (const car of m.cars) {
        if (car.conn || car.lane !== x.lane) continue;
        const front = car.s + car.halfLen, rear = car.s - car.halfLen;
        expect(front <= x.s - 0.9 || rear >= x.s + 0.9).toBe(true);
        if (front <= x.s - 0.9 && car.v < 0.01) waited++;
      }
    });
    expect(waited).toBeGreaterThan(0);
  });

  it('brings more cars to the stadium after the advertised closing time', () => {
    const near = (m: TrafficModel) => m.cars.filter((c) => dist(c, STADIUM) < 16).length;
    const withClose = createTrafficModel(graph, { seed: 13, carCount: 16, closingT: 600 });
    const without = createTrafficModel(graph, { seed: 13, carCount: 16, closingT: null });
    let a = 0, b = 0, maxCars = 0;
    run(withClose, 1200, 0.25, () => ({}), (t) => { if (t > 640) { a += near(withClose); maxCars = Math.max(maxCars, withClose.cars.length); } });
    run(without, 1200, 0.25, () => ({}), (t) => { if (t > 640) b += near(without); });
    expect(a).toBeGreaterThan(b * 1.3);
    expect(maxCars).toBeGreaterThan(16);
    expect(maxCars).toBeLessThanOrEqual(24);
    expect(withClose.cars.some((c) => c.surge)).toBe(true);
  });

  it('swaps car models in place: cars keep their spot and take the new lengths', () => {
    const m = createTrafficModel(graph, { seed: 6, carCount: 18 });
    run(m, 60, 0.25);
    const where = m.cars.map((c) => `${c.id}:${c.x},${c.z}`).join('|');
    m.setVariants([{ length: 1.66, weight: 0.6 }, { length: 1.8, weight: 0.4 }]);
    expect(m.cars.map((c) => `${c.id}:${c.x},${c.z}`).join('|')).toBe(where);
    for (const c of m.cars) {
      expect(c.variant).toBeLessThan(2);
      expect(c.halfLen).toBeCloseTo([0.83, 0.9][c.variant]!, 6);
    }
    run(m, 300, 0.25, () => ({}), undefined, 60);
    for (const c of m.cars) expect(c.variant).toBeLessThan(2);
  });

  it('copes with a huge or negative time step without breaking the invariants', () => {
    const m = createTrafficModel(graph, { seed: 2, carCount: 20 });
    m.step(0.1, { simT: 0.1 });
    m.step(500, { simT: 500 });
    m.step(-30, { simT: 470 });
    m.step(0, { simT: 470 });
    for (const a of m.cars) {
      expect(nearestRoad(a)).toBeLessThan(ROAD_HALF_WIDTH + 0.05);
      for (const b of m.cars) { const g = a === b ? null : pathGap(a, b); if (g !== null) expect(g).toBeGreaterThanOrEqual(MIN_SPACING - 1e-6); }
    }
  });
});
