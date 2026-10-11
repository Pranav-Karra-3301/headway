// Owner: Task M. The canonical town (spec §4 topology). Stub until filled.
import type { RouteId, Route, StationId, Station, Stop, StopId, TownMap, Zone } from '../contracts';
function ni(what: string): never {
  throw new Error(`not implemented yet: ${what}`);
}

export const TOWN = {} as TownMap;
export function stopById(m: TownMap, id: StopId): Stop { return m.stops.find((s) => s.id === id) ?? ni('stop ' + id); }
export function stationById(m: TownMap, id: StationId): Station { return m.rail.stations.find((s) => s.id === id) ?? ni('station ' + id); }
export function routeById(m: TownMap, id: RouteId): Route { return m.routes.find((r) => r.id === id) ?? ni('route ' + id); }
export function zoneById(m: TownMap, id: string): Zone { return m.zones.find((z) => z.id === id) ?? ni('zone ' + id); }
