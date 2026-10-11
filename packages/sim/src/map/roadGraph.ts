// Owner: Task M. Road graph pathing (deadheads, ambient traffic helpers).
// Dijkstra over road edges (undirected), ties broken by node id, results cached per map. Paths are rounded at the
// junctions they turn through (same radius as route turns), so deadheading buses corner smoothly.
import type { Polyline, RouteId, TownMap, Vec2 } from '../contracts';
import { polyline, roundCorners } from './geometry';
import { ROAD_CORNER_RADIUS, routeById } from './town';

const cache = new WeakMap<TownMap, Map<string, Polyline>>();

function cacheFor(m: TownMap): Map<string, Polyline> {
  let c = cache.get(m);
  if (!c) { c = new Map(); cache.set(m, c); }
  return c;
}

/** Shortest road route between two nodes as an open polyline from `fromNode` to `toNode`. */
export function shortestPath(m: TownMap, fromNode: string, toNode: string): Polyline {
  const key = `${fromNode}>${toNode}`;
  const c = cacheFor(m);
  const hit = c.get(key);
  if (hit) return hit;

  const nodes = new Map(m.roads.nodes.map((n) => [n.id, n.p] as const));
  const from = nodes.get(fromNode);
  const to = nodes.get(toNode);
  if (!from || !to) throw new Error(`roadGraph: unknown node ${from ? toNode : fromNode}`);
  if (fromNode === toNode) {
    const p = polyline([from, { x: from.x, z: from.z }], false);
    c.set(key, p);
    return p;
  }

  type Adj = { to: string; edge: number; forward: boolean; len: number };
  const adj = new Map<string, Adj[]>();
  m.roads.edges.forEach((e, i) => {
    (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push({ to: e.b, edge: i, forward: true, len: e.path.length });
    (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push({ to: e.a, edge: i, forward: false, len: e.path.length });
  });

  const dist = new Map<string, number>([[fromNode, 0]]);
  const prev = new Map<string, Adj & { from: string }>();
  const done = new Set<string>();
  for (;;) {
    let cur: string | null = null;
    let best = Infinity;
    for (const [id, d] of dist) {
      if (done.has(id)) continue;
      if (d < best - 1e-9 || (Math.abs(d - best) <= 1e-9 && cur !== null && id < cur)) { best = d; cur = id; }
    }
    if (cur === null) throw new Error(`roadGraph: no path ${fromNode} → ${toNode}`);
    if (cur === toNode) break;
    done.add(cur);
    for (const a of adj.get(cur) ?? []) {
      if (done.has(a.to)) continue;
      const nd = best + a.len;
      const od = dist.get(a.to);
      if (od === undefined || nd < od - 1e-9) { dist.set(a.to, nd); prev.set(a.to, { ...a, from: cur }); }
    }
  }

  const chain: Array<Adj & { from: string }> = [];
  for (let n = toNode; n !== fromNode; ) {
    const p = prev.get(n)!;
    chain.unshift(p);
    n = p.from;
  }
  const raw: Vec2[] = [];
  chain.forEach((step, i) => {
    const pts = m.roads.edges[step.edge]!.path.points;
    const seq = step.forward ? pts : [...pts].reverse();
    raw.push(...(i === 0 ? seq : seq.slice(1)));
  });
  const p = polyline(roundCorners(raw, ROAD_CORNER_RADIUS, false, 8), false);
  c.set(key, p);
  return p;
}

/** Road path a reassigned bus drives from its old route's terminal to the new route's terminal (length 0 when shared). */
export function deadheadPath(m: TownMap, from: RouteId, to: RouteId): Polyline {
  return shortestPath(m, routeById(m, from).terminalNode, routeById(m, to).terminalNode);
}
