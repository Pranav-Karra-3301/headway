// Owner: G1. The whole visual traffic network: G0's street lanes + the expressway, interchange and North Rd link,
// relinked, with the expressway's two world exits replacing G0's internal 'highway' band port. Pure data.
import type { TownMap } from '@headway/sim';
import { greaterGrid, linkLanes, type Lane, type Port } from '../grid';
import { highwayPlan, type HighwayLane, type HighwayPort } from './plan';

export interface GreaterNetwork {
  /** Every lane (copies of G0's lanes + the highway's), `next` relinked across the band edge. */
  lanes: HighwayLane[];
  /** G0's ports without its band-edge 'highway' port, plus the expressway's west (tunnel) and east exits. */
  ports: Array<Port | HighwayPort>;
  byId: Map<string, HighwayLane>;
}

const cache = new WeakMap<TownMap, GreaterNetwork>();

/** G0 lanes + highway lanes, linked (memoised; G0's own lane objects are not mutated). */
export function greaterLanes(map: TownMap): GreaterNetwork {
  const hit = cache.get(map);
  if (hit) return hit;
  const g = greaterGrid(map);
  const plan = highwayPlan(map);
  const lanes: HighwayLane[] = [...g.lanes.map((l) => ({ ...l, next: [...l.next] })), ...plan.lanes.map((l) => ({ ...l, next: [] }))];
  linkLanes(lanes);
  const ports: Array<Port | HighwayPort> = [...g.ports.filter((p) => p.kind !== 'highway'), ...plan.ports];
  const net = { lanes, ports, byId: new Map(lanes.map((l) => [l.id, l] as const)) };
  cache.set(map, net);
  return net;
}

export type { Lane };
