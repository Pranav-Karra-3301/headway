// Owner: Task M. Road graph pathing (deadheads). Stub until filled.
import type { Polyline, RouteId, TownMap } from '../contracts';
function ni(what: string): never {
  throw new Error(`not implemented yet: ${what}`);
}

export function shortestPath(m: TownMap, fromNode: string, toNode: string): Polyline { return ni(`roadGraph.shortestPath ${m.version} ${fromNode} ${toNode}`); }
export function deadheadPath(m: TownMap, from: RouteId, to: RouteId): Polyline { return ni(`roadGraph.deadheadPath ${m.version} ${from} ${to}`); }
