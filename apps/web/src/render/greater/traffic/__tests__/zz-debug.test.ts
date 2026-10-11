import { it } from 'vitest';
import { TOWN } from '@headway/sim';
import { buildTrafficGraph } from '../graph';
import { createGreaterTrafficModel } from '../model';
it('debug', () => {
  const graph = buildTrafficGraph(TOWN);
  console.log('sources', graph.sources.map((s) => s.id).join(' '), '\nsinks', graph.sinks.map((s) => s.id).join(' '));
  console.log('crossings', JSON.stringify(graph.crossings), graph.lanes.filter((l) => l.crossings.length).map((l) => l.id + '@' + l.crossings[0]!.s.toFixed(1) + '/' + l.len.toFixed(1)).join(' '));
  console.log('signal lanes', graph.lanes.filter((l) => l.signal).map((l) => l.id + ':' + JSON.stringify(l.signal)).join(' '));
  console.log('streets', graph.streets.length);
  const t0 = performance.now();
  const m = createGreaterTrafficModel(graph, { seed: 3, cars: 40 });
  m.warm(120);
  console.log('warm ms', (performance.now() - t0).toFixed(1), 'cars', m.cars.length);
  const kinds = new Map<string, number>(); let stopped = 0, done = 0; const seen = new Set<number>();
  const xs = graph.crossings[0]!;
  let laneHits = new Map<string, number>();
  for (let i = 0; i < 2400; i++) {
    const td = (i * 0.25 * 9.6) % graph.railLength;
    m.step(0.25, { trainDist: td });
    for (const c of m.cars) { seen.add(c.id); kinds.set(c.lane.kind, (kinds.get(c.lane.kind) ?? 0) + 1); if (c.v < 0.05) stopped++; laneHits.set(c.lane.id, (laneHits.get(c.lane.id) ?? 0) + 1); }
  }
  console.log('kinds', JSON.stringify([...kinds]), 'stoppedFrac', (stopped / [...kinds.values()].reduce((a, b) => a + b)).toFixed(3), 'seen', seen.size);
  const unused = graph.lanes.filter((l) => !laneHits.has(l.id) && !l.board).map((l) => l.id);
  console.log('unused lanes', unused.length, unused.join(' '));
  const waits = m.cars.map((c) => c.wait.toFixed(1)).join(' ');
  console.log('waits now', waits);
  const t1 = performance.now(); for (let i = 0; i < 600; i++) m.step(1 / 60); console.log('per-step ms', ((performance.now() - t1) / 600).toFixed(3));
});
