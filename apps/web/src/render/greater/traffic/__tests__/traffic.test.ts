// Owner: G4. Greater-town traffic: graph (world exits only, boxes, signals, level crossing) and model invariants.
import { describe, expect, it } from 'vitest';
import { pointAt, TOWN } from '@headway/sim';
import { greaterGrid } from '../../grid';
import { buildTrafficGraph, signalGreen, type TLane } from '../graph';
import { createGreaterTrafficModel, MIN_GAP, type GreaterCar, type GreaterTrafficModel } from '../model';

const g = greaterGrid(TOWN);
const graph = buildTrafficGraph(TOWN);
const outside = (p: { x: number; z: number }) => p.x < g.bounds.minX || p.x > g.bounds.maxX || p.z < g.bounds.minZ || p.z > g.bounds.maxZ;

describe('greater traffic graph', () => {
  it('spawns and despawns only beyond the grid edge at world exits', () => {
    expect(graph.sources.length).toBeGreaterThanOrEqual(4);
    expect(graph.sinks.length).toBeGreaterThanOrEqual(4);
    for (const l of [...graph.sources, ...graph.sinks]) {
      expect(l.board).toBeNull();
      expect(l.port && !l.port.startsWith('board')).toBeTruthy();
    }
    for (const s of graph.sources) expect(outside(s.poly.points[0]!)).toBe(true);
    for (const s of graph.sinks) expect(outside(s.poly.points[s.poly.points.length - 1]!)).toBe(true);
    // every lane anyone can drive has a way out
    for (const s of graph.sources) expect(graph.sinks.some((k) => graph.distTo(k).has(s))).toBe(true);
    // board ports are hand-off points, not spawns
    expect(graph.boardIn.size).toBe(4);
    expect(graph.boardOut.size).toBe(4);
    expect(buildTrafficGraph(TOWN)).toBe(graph);
    // G0's memoised lanes are untouched
    expect(g.lanes.some((l) => l.id.includes('~'))).toBe(false);
  });

  it('finds junction box conflicts, signals and the level crossing', () => {
    const box = graph.lanes.filter((l) => l.box);
    expect(box.length).toBeGreaterThan(20);
    for (const l of box) for (const q of l.conflicts) expect(q.conflicts).toContain(l);
    expect(box.some((l) => l.conflicts.length > 0)).toBe(true);
    expect([...graph.signals.keys()].sort()).toEqual(g.junctions.filter((j) => j.signals).map((j) => j.id).sort());
    const sig = [...graph.signals.values()][0]!;
    const seen = new Set<string>();
    for (let t = 0; t < 40; t += 0.5) seen.add(String(signalGreen(sig, t)));
    expect([...seen].sort()).toEqual(['0', '1', 'null']);
    expect(graph.crossings.length).toBe(g.roads.filter((t) => t.railCrossing).length);
    expect(graph.lanes.filter((l) => l.crossings.length).length).toBeGreaterThanOrEqual(2);
  });

  it('merges extra lanes (e.g. a highway) without touching G0 lanes', () => {
    const port = g.ports.find((p) => p.kind === 'highway')!;
    const inL = g.lanes.find((l) => l.id === port.inLane)!;
    const outL = g.lanes.find((l) => l.id === port.outLane)!;
    const a = inL.path.points[0]!, b = outL.path.points[outL.path.points.length - 1]!;
    const lanes = [
      { id: 'hw:in', kind: 'highway' as const, path: { points: [{ x: a.x, z: a.z - 6 }, a], cum: [0, 6], length: 6, closed: false }, speed: 9, next: [] },
      { id: 'hw:out', kind: 'highway' as const, path: { points: [b, { x: b.x, z: b.z - 6 }], cum: [0, 6], length: 6, closed: false }, speed: 9, next: [] },
    ];
    const gx = buildTrafficGraph(TOWN, { lanes });
    expect(gx.byId.get('hw:in')!.next.map((l) => l.id)).toContain(port.inLane);
    expect(gx.byId.get(port.outLane!)!.next.map((l) => l.id)).toContain('hw:out');
    expect(gx.sources.some((s) => s.id === 'hw:in~in')).toBe(true);
    expect(g.lanes.find((l) => l.id === port.outLane)!.next).toEqual([]);
  });
});

function checkInvariants(m: GreaterTrafficModel): void {
  const byLane = new Map<TLane, GreaterCar[]>();
  for (const c of m.cars) (byLane.get(c.lane) ?? byLane.set(c.lane, []).get(c.lane)!).push(c);
  for (const list of byLane.values()) {
    list.sort((a, b) => a.s - b.s);
    for (let i = 0; i + 1 < list.length; i++) {
      const a = list[i]!, b = list[i + 1]!;
      expect(b.s - b.halfLen - (a.s + a.halfLen)).toBeGreaterThan(MIN_GAP - 0.05);
    }
  }
  // no two cars in conflicting box lanes
  const inBox = m.cars.filter((c) => c.lane.box);
  for (const a of inBox) for (const b of inBox) if (a !== b) expect(a.lane.conflicts).not.toContain(b.lane);
  for (const c of m.cars) {
    expect(c.lane.board).toBeNull();
    expect(Number.isFinite(c.x) && Number.isFinite(c.z)).toBe(true);
  }
}

describe('greater traffic model', () => {
  it('fills the network from the exits and keeps every invariant for 10 minutes', () => {
    const m = createGreaterTrafficModel(graph, { seed: 3, cars: 40 });
    const seenIds = new Set<number>();
    const spawnedOn = new Set<string>();
    m.warm(1);
    for (const c of m.cars) { seenIds.add(c.id); spawnedOn.add(c.lane.id); }
    let maxWait = 0;
    for (let i = 0; i < 600 * 4; i++) {
      m.step(0.25);
      for (const c of m.cars) {
        if (!seenIds.has(c.id)) { seenIds.add(c.id); spawnedOn.add(c.lane.id); }
        maxWait = Math.max(maxWait, c.wait);
      }
      if (i % 8 === 0) checkInvariants(m);
    }
    for (const id of spawnedOn) expect(graph.byId.get(id)!.source).toBe(true);
    expect(m.cars.length).toBeGreaterThanOrEqual(30);
    expect(seenIds.size).toBeGreaterThan(150); // they come and go
    expect(maxWait).toBeLessThan(30);
    // traffic reaches the local streets too
    const kinds = new Set(m.cars.map((c) => c.lane.kind));
    expect(kinds.has('roundabout')).toBe(true);
  });

  it('is deterministic for a seed', () => {
    const a = createGreaterTrafficModel(graph, { seed: 11 }), b = createGreaterTrafficModel(graph, { seed: 11 });
    a.warm(60); b.warm(60);
    expect(a.cars.map((c) => [c.id, c.lane.id, c.s.toFixed(4)])).toEqual(b.cars.map((c) => [c.id, c.lane.id, c.s.toFixed(4)]));
  });

  it('stops cars at the level crossing while the train passes', () => {
    const x = graph.crossings[0]!;
    const m = createGreaterTrafficModel(graph, { seed: 5, cars: 50 });
    m.warm(90);
    const trainDist = (x.railDist - 4 + graph.railLength) % graph.railLength;
    expect(m.crossingClosed(x.id)).toBe(false);
    m.step(0.01, { trainDist });
    expect(m.crossingClosed(x.id)).toBe(true);
    const before = new Map(m.cars.map((c) => [c.id, c.s + c.halfLen] as const));
    for (let i = 0; i < 80; i++) {
      m.step(0.25, { trainDist });
      for (const c of m.cars) {
        const xs = c.lane.crossings.find((k) => k.id === x.id);
        const f0 = before.get(c.id);
        if (!xs || f0 === undefined) continue;
        if (f0 <= xs.s - 1.5 + 0.05) expect(c.s + c.halfLen).toBeLessThanOrEqual(xs.s - 1.5 + 0.06);
      }
    }
    m.step(0.01, { trainDist: null });
    expect(m.crossingClosed(x.id)).toBe(false);
  });

  it('hands cars to and from the town only when asked', () => {
    const exits: string[] = [];
    const m = createGreaterTrafficModel(graph, { seed: 9, cars: 30, onBoardExit: (p) => exits.push(p) });
    m.warm(240);
    expect(exits.length).toBeGreaterThan(0);
    expect(exits.every((p) => graph.boardOut.has(p))).toBe(true);
    const port = [...graph.boardIn.keys()][0]!;
    const n = m.cars.length;
    expect(m.admit(port)).toBe(true);
    expect(m.cars.length).toBe(n + 1);
    const car = m.cars[m.cars.length - 1]!;
    expect(car.lane).toBe(graph.boardIn.get(port));
    expect(car.dest.board).toBeNull();
    const p = pointAt(car.lane.poly, 0);
    expect(Math.hypot(p.x - car.x, p.z - car.z)).toBeLessThan(1e-6);
  });
});
