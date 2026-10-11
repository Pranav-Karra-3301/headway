// Owner: Task M. The canonical town (spec §4 topology) authored to the kit's scale.
//
// Layout (x east, z south; board 72 × 52 u):
// - A toy railway rings the town (rounded rectangle, anticlockwise seen north-up: Stadium → Central → University).
// - A ring road runs inside the railway (7.4 u in from the rail) so every station has a road alongside its platform.
// - Main St (E–W, exits west) ends at Central Station; Atherton St (N–S arterial) exits north and south; the South
//   Rd continues east off the board. Side streets: Burrowes St (campus), Beaver Ave + Allen St (downtown), Park Ave
//   (south side).
// - Campus NW (Old Main clock tower on the quad), Downtown centre/east on Main St, Apartments SE around Central
//   Station, Stadium far SW (its gates 35–45 u from the apartments, so the crowd rides rather than walks).
//
// Conventions: road and route paths are road centrelines; stop.p sits on the kerb (1.15 u from the centreline) and
// `queueDir` points away from the road. A station's `dist` is its platform centre along `rail.loop`; `platform` is the
// queue point on the platform (2.4 u from the rail, 2.4 u along the track from the centre) right across from the
// paired stop; its `queueDir` runs along the platform toward the platform centre.
import { DEFAULT_CONFIG } from '../config';
import type {
  Neighborhood, NeighborhoodId, Polyline, RoadEdge, RoadNode, Route, RouteId, Station, StationId, Stop, StopId,
  TownMap, Vec2, Zone, ZoneTag,
} from '../contracts';
import { distance, nearestDist, pointAt, polyline, roundCorners } from './geometry';

function fail(what: string): never {
  throw new Error(`town: unknown ${what}`);
}
const v = (x: number, z: number): Vec2 => ({ x, z });

// ---------------------------------------------------------------- layout constants
/** Visual road width (u) and the corner radius used for road bends and route turns. */
export const ROAD_WIDTH = 2.4;
export const ROAD_CORNER_RADIUS = 2;
const ROAD_SEGS = 8;
/** Stops sit this far from the road centreline (≤ 1.2 so every serving path passes within reach). */
const KERB = 1.15;

const BOUNDS = { minX: -36, maxX: 36, minZ: -26, maxZ: 26 };
const RAIL_HX = 30, RAIL_HZ = 22, RAIL_R = 6, RAIL_SEGS = 12;
const RING_INSET = 7.4;
const XW = -26.8;                   // West Rd (no station on the west side: hugs the rail)
const XE = RAIL_HX - RING_INSET;    // East Rd (22.6), Central Station side
const ZN = -(RAIL_HZ - RING_INSET); // North Rd (-14.6), University Station side
const ZS = RAIL_HZ - RING_INSET;    // South Rd (14.6), Stadium Station side
const X_BURROWES = -19.5, X_ATHERTON = -2, X_ALLEN = 12;
const Z_BEAVER = -8, Z_MAIN = 0, Z_PARK = 6.8;

/** Platform centres along the rail straights (see header). */
const STATION_AT: Record<StationId, { side: 'n' | 'e' | 's'; at: number }> = {
  stn_stadium: { side: 's', at: -19 },
  stn_university: { side: 'n', at: -12 },
  stn_central: { side: 'e', at: -2 },
};
/** Platform queue point / paired stop: distance in from the rail and along the track from the platform centre. */
const PLATFORM_IN = 2.4, PLATFORM_ALONG = 2.4;

// ---------------------------------------------------------------- road graph
const NODES: Array<[string, number, number]> = [
  // board-edge exits
  ['x_west', BOUNDS.minX, Z_MAIN], ['x_north', X_ATHERTON, BOUNDS.minZ], ['x_south', X_ATHERTON, BOUNDS.maxZ], ['x_east', BOUNDS.maxX, ZS],
  // Main St
  ['j_main_west', XW, Z_MAIN], ['j_main_burrowes', X_BURROWES, Z_MAIN], ['j_main_atherton', X_ATHERTON, Z_MAIN],
  ['j_main_allen', X_ALLEN, Z_MAIN], ['j_main_east', XE, Z_MAIN],
  // North Rd
  ['j_north_burrowes', X_BURROWES, ZN], ['j_north_atherton', X_ATHERTON, ZN], ['j_north_allen', X_ALLEN, ZN],
  // Beaver Ave, Park Ave
  ['j_beaver_atherton', X_ATHERTON, Z_BEAVER], ['j_beaver_allen', X_ALLEN, Z_BEAVER],
  ['j_park_atherton', X_ATHERTON, Z_PARK], ['j_park_allen', X_ALLEN, Z_PARK],
  // South Rd
  ['j_south_atherton', X_ATHERTON, ZS], ['j_south_allen', X_ALLEN, ZS], ['j_south_east', XE, ZS],
  // terminals (mid-street, so routes pass straight through them)
  ['t_central', XE, STATION_AT.stn_central.at - PLATFORM_ALONG], ['t_stadium_gate', -11.5, ZS],
];

/** [id, name, from, to, bends] — bends are rounded corners inside an edge. */
const EDGES: Array<[string, string, string, string, Vec2[]?]> = [
  ['main_w', 'Main St', 'x_west', 'j_main_west'],
  ['main_1', 'Main St', 'j_main_west', 'j_main_burrowes'],
  ['main_2', 'Main St', 'j_main_burrowes', 'j_main_atherton'],
  ['main_3', 'Main St', 'j_main_atherton', 'j_main_allen'],
  ['main_4', 'Main St', 'j_main_allen', 'j_main_east'],
  ['ath_n', 'Atherton St', 'x_north', 'j_north_atherton'],
  ['ath_1', 'Atherton St', 'j_north_atherton', 'j_beaver_atherton'],
  ['ath_2', 'Atherton St', 'j_beaver_atherton', 'j_main_atherton'],
  ['ath_3', 'Atherton St', 'j_main_atherton', 'j_park_atherton'],
  ['ath_4', 'Atherton St', 'j_park_atherton', 'j_south_atherton'],
  ['ath_s', 'Atherton St', 'j_south_atherton', 'x_south'],
  ['west_n', 'West Rd', 'j_main_west', 'j_north_burrowes', [v(XW, ZN)]],
  ['north_1', 'North Rd', 'j_north_burrowes', 'j_north_atherton'],
  ['north_2', 'North Rd', 'j_north_atherton', 'j_north_allen'],
  ['north_e', 'North Rd', 'j_north_allen', 't_central', [v(XE, ZN)]],
  ['east_1', 'Station Rd', 't_central', 'j_main_east'],
  ['east_2', 'Station Rd', 'j_main_east', 'j_south_east'],
  ['south_e', 'South Rd', 'j_south_east', 'j_south_allen'],
  ['south_1', 'South Rd', 'j_south_allen', 'j_south_atherton'],
  ['south_2', 'South Rd', 'j_south_atherton', 't_stadium_gate'],
  ['west_s', 'West Rd', 't_stadium_gate', 'j_main_west', [v(XW, ZS)]],
  ['south_x', 'South Rd', 'j_south_east', 'x_east'],
  ['burrowes', 'Burrowes St', 'j_north_burrowes', 'j_main_burrowes'],
  ['beaver', 'Beaver Ave', 'j_beaver_atherton', 'j_beaver_allen'],
  ['allen_1', 'Allen St', 'j_north_allen', 'j_beaver_allen'],
  ['allen_2', 'Allen St', 'j_beaver_allen', 'j_main_allen'],
  ['allen_3', 'Allen St', 'j_main_allen', 'j_park_allen'],
  ['allen_4', 'Allen St', 'j_park_allen', 'j_south_allen'],
  ['park', 'Park Ave', 'j_park_atherton', 'j_park_allen'],
];

/** Street names per edge id (for labels and the map preview). */
export const STREET_NAMES: Record<string, string> = Object.fromEntries(EDGES.map(([id, name]) => [id, name]));

const nodePos = new Map(NODES.map(([id, x, z]) => [id, v(x, z)] as const));
const posOf = (id: string): Vec2 => nodePos.get(id) ?? fail('road node ' + id);
const rawEdge = new Map<string, Vec2[]>();
for (const [id, , a, b, bends] of EDGES) rawEdge.set(id, [posOf(a), ...(bends ?? []), posOf(b)]);

const roadNodes: RoadNode[] = NODES.map(([id, x, z]) => ({ id, p: v(x, z) }));
const roadEdges: RoadEdge[] = EDGES.map(([id, , a, b]) => ({
  id, a, b, path: polyline(roundCorners(rawEdge.get(id)!, ROAD_CORNER_RADIUS, false, ROAD_SEGS), false),
}));

/** Raw (unrounded) points from node `from` to node `to` along the edge joining them. */
function rawBetween(from: string, to: string): Vec2[] {
  for (const [id, , a, b] of EDGES) {
    if (a === from && b === to) return rawEdge.get(id)!;
    if (a === to && b === from) return [...rawEdge.get(id)!].reverse();
  }
  return fail(`road edge ${from}–${to}`);
}

// ---------------------------------------------------------------- rail
/** Travel order (spec §4): Stadium → Central → University, so the stadium crowd reaches Central (and its r1/r2
 *  connections) on the short side of the loop, and Apartments → Central → University is direct. */
const RAIL_ORDER: StationId[] = ['stn_stadium', 'stn_central', 'stn_university'];
function railLoop(): Polyline {
  const start = v(STATION_AT.stn_stadium.at, RAIL_HZ); // the loop starts at Stadium's platform centre, heading east
  const corners = [start, v(RAIL_HX, RAIL_HZ), v(RAIL_HX, -RAIL_HZ), v(-RAIL_HX, -RAIL_HZ), v(-RAIL_HX, RAIL_HZ)];
  return polyline(roundCorners(corners, RAIL_R, true, RAIL_SEGS), true);
}
const RAIL_LOOP = railLoop();

/** Rail point at a platform centre, the unit normal pointing into town, and the kit's local +x (along the track). */
function stationFrame(id: StationId): { rail: Vec2; inward: Vec2; along: Vec2 } {
  const { side, at } = STATION_AT[id];
  if (side === 's') return { rail: v(at, RAIL_HZ), inward: v(0, -1), along: v(1, 0) };
  if (side === 'n') return { rail: v(at, -RAIL_HZ), inward: v(0, 1), along: v(-1, 0) };
  return { rail: v(RAIL_HX, at), inward: v(-1, 0), along: v(0, -1) };
}

// ---------------------------------------------------------------- stops
interface StopDef {
  id: StopId; name: string; neighborhood: NeighborhoodId; servedRoutes: RouteId[]; stationId?: StationId;
  road: Vec2;      // point on the road centreline
  away: Vec2;      // unit vector from the road toward the kerb the stop stands on
}
const stationStop = (id: StationId): { road: Vec2; away: Vec2 } => {
  const f = stationFrame(id);
  const kerbFromRail = RING_INSET;
  const road = v(f.rail.x + f.inward.x * kerbFromRail + f.along.x * PLATFORM_ALONG, f.rail.z + f.inward.z * kerbFromRail + f.along.z * PLATFORM_ALONG);
  return { road, away: v(-f.inward.x, -f.inward.z) };
};
const STOP_DEFS: StopDef[] = [
  { id: 'stop_stadium_gate', name: 'Stadium Gate', neighborhood: 'stadium', servedRoutes: ['r3'], road: posOf('t_stadium_gate'), away: v(0, -1) },
  { id: 'stop_stadium_stn', name: 'Stadium Station', neighborhood: 'stadium', servedRoutes: ['r3'], stationId: 'stn_stadium', ...stationStop('stn_stadium') },
  { id: 'stop_university_stn', name: 'University Station', neighborhood: 'campus', servedRoutes: ['r1'], stationId: 'stn_university', ...stationStop('stn_university') },
  { id: 'stop_old_main', name: 'Old Main', neighborhood: 'campus', servedRoutes: ['r1', 'r3'], road: v(-9, Z_MAIN), away: v(0, -1) },
  { id: 'stop_downtown', name: 'Downtown', neighborhood: 'downtown', servedRoutes: ['r1', 'r2', 'r3'], road: v(6.5, Z_MAIN), away: v(0, 1) },
  { id: 'stop_central_stn', name: 'Central Station', neighborhood: 'downtown', servedRoutes: ['r1', 'r2'], stationId: 'stn_central', ...stationStop('stn_central') },
  { id: 'stop_apts_north', name: 'Apartments North', neighborhood: 'apartments', servedRoutes: ['r2'], road: v(XE, 5.0), away: v(-1, 0) },
  { id: 'stop_apts_south', name: 'Apartments South', neighborhood: 'apartments', servedRoutes: ['r2'], road: v(XE, 10.6), away: v(-1, 0) },
];
const STOPS: Stop[] = STOP_DEFS.map((s) => ({
  id: s.id, name: s.name, p: v(s.road.x + s.away.x * KERB, s.road.z + s.away.z * KERB), queueDir: s.away,
  neighborhood: s.neighborhood, servedRoutes: s.servedRoutes, ...(s.stationId ? { stationId: s.stationId } : {}),
}));

// ---------------------------------------------------------------- routes
const ROUTE_DEFS: Array<{ id: RouteId; name: string; color: string; stops: StopId[]; nodes: string[] }> = [
  {
    id: 'r1', name: 'Campus Loop', color: '#1FA99A',
    stops: ['stop_central_stn', 'stop_downtown', 'stop_old_main', 'stop_university_stn'],
    nodes: ['t_central', 'j_main_east', 'j_main_allen', 'j_main_atherton', 'j_main_burrowes',
      'j_north_burrowes', 'j_north_atherton', 'j_north_allen', 't_central'],
  },
  {
    id: 'r2', name: 'Apartments', color: '#F0A830',
    stops: ['stop_central_stn', 'stop_apts_north', 'stop_apts_south', 'stop_downtown'],
    nodes: ['t_central', 'j_main_east', 'j_south_east', 'j_south_allen', 'j_south_atherton',
      'j_park_atherton', 'j_main_atherton', 'j_main_allen', 'j_beaver_allen', 'j_north_allen', 't_central'],
  },
  {
    id: 'r3', name: 'Stadium', color: '#8A6BD8',
    stops: ['stop_stadium_gate', 'stop_stadium_stn', 'stop_old_main', 'stop_downtown'],
    nodes: ['t_stadium_gate', 'j_main_west', 'j_main_burrowes', 'j_main_atherton', 'j_main_allen', 'j_park_allen',
      'j_south_allen', 'j_south_atherton', 't_stadium_gate'],
  },
];

function routePath(nodes: string[]): Polyline {
  const raw: Vec2[] = [];
  for (let i = 0; i + 1 < nodes.length; i++) {
    const seg = rawBetween(nodes[i]!, nodes[i + 1]!);
    raw.push(...(i === 0 ? seg : seg.slice(1)));
  }
  return polyline(roundCorners(raw, ROAD_CORNER_RADIUS, true, ROAD_SEGS), true);
}

const ROUTES: Route[] = ROUTE_DEFS.map((d) => {
  const path = routePath(d.nodes);
  const stopDist = d.stops.map((sid, i) => (i === 0 ? 0 : nearestDist(path, STOPS.find((s) => s.id === sid)!.p)));
  const nominalLoopS = Math.round(path.length / DEFAULT_CONFIG.bus.speed + d.stops.length * 20);
  return {
    id: d.id, name: d.name, color: d.color, stops: d.stops, path, stopDist, terminalNode: d.nodes[0]!,
    nominalLoopS, advertisedHeadwayS: Math.round(nominalLoopS / 2),
  };
});

// ---------------------------------------------------------------- stations
const STATION_NAMES: Record<StationId, { name: string; stopId: StopId }> = {
  stn_stadium: { name: 'Stadium', stopId: 'stop_stadium_stn' },
  stn_university: { name: 'University', stopId: 'stop_university_stn' },
  stn_central: { name: 'Central', stopId: 'stop_central_stn' },
};
const STATIONS: Station[] = RAIL_ORDER.map((id) => {
  const f = stationFrame(id);
  return {
    id, name: STATION_NAMES[id].name, dist: nearestDist(RAIL_LOOP, f.rail),
    platform: v(f.rail.x + f.inward.x * PLATFORM_IN + f.along.x * PLATFORM_ALONG, f.rail.z + f.inward.z * PLATFORM_IN + f.along.z * PLATFORM_ALONG),
    queueDir: v(-f.along.x, -f.along.z),
    stopId: STATION_NAMES[id].stopId,
  };
});

/** Where the kit's station model goes: origin and rotation (local +z = away from town, track at local z = +1.75). */
export function stationPlacement(id: StationId): { x: number; z: number; rot: number } {
  const f = stationFrame(id);
  const rot = f.inward.z < 0 ? 0 : f.inward.z > 0 ? Math.PI : Math.PI / 2;
  return { x: f.rail.x + f.inward.x * 1.75, z: f.rail.z + f.inward.z * 1.75, rot };
}

// ---------------------------------------------------------------- neighbourhoods and zones
const NEIGHBORHOODS: Neighborhood[] = [
  { id: 'campus', name: 'Campus', center: v(-13.5, -8), radius: 10.5 },
  { id: 'downtown', name: 'Downtown', center: v(9, -6.5), radius: 12 },
  { id: 'apartments', name: 'Apartments', center: v(20.5, 7.5), radius: 9 },
  { id: 'stadium', name: 'Stadium', center: v(-17.5, 9.5), radius: 10 },
];

const Z = (id: string, neighborhood: NeighborhoodId, name: string, x: number, z: number, weight: number, tags: ZoneTag[]): Zone =>
  ({ id, neighborhood, name, door: v(x, z), weight, tags });
/** Doors sit at building fronts (see apps/web/src/render/scenery.ts), 5–12 u from the nearest stop or platform. */
const ZONES: Zone[] = [
  // campus halls (Old Main is the clock tower on the quad)
  Z('z_old_main', 'campus', 'Old Main', -10.5, -7.7, 2, ['hall']),
  Z('z_willard', 'campus', 'Willard Hall', -18.1, -7.0, 2, ['hall']),
  Z('z_pattee', 'campus', 'Pattee Library', -3.4, -8.2, 2, ['hall']),
  Z('z_west_halls', 'campus', 'West Halls', -21.4, -10.5, 1.5, ['hall']),
  // downtown retail (Main St, Beaver Ave, Allen St)
  Z('z_main_market', 'downtown', 'Main St Market', 1.4, -1.6, 2, ['retail']),
  Z('z_beaver_shops', 'downtown', 'Beaver Ave Shops', 5, -9.6, 1.5, ['retail']),
  Z('z_allen_corner', 'downtown', 'Allen Corner', 13.4, -5.2, 1.5, ['retail']),
  Z('z_central_plaza', 'downtown', 'Central Plaza', 19.0, -13.1, 1.5, ['retail']),
  // apartments around Central Station (SE)
  Z('z_eastview', 'apartments', 'Eastview Towers', 15.3, 1.6, 2, ['housing']),
  Z('z_parkside', 'apartments', 'Parkside Towers', 15.3, 12.5, 2, ['housing']),
  Z('z_southside', 'apartments', 'Station Court', 26.6, 4.3, 2, ['housing']),
  Z('z_garden_row', 'apartments', 'Garden Row', 26.6, 12.9, 1.5, ['housing']),
  // stadium gates
  Z('z_stadium_east', 'stadium', 'Stadium East Gate', -14.0, 7.3, 3, ['stadium']),
  Z('z_stadium_south', 'stadium', 'Stadium South Gate', -20.5, 11.8, 2, ['stadium']),
  Z('z_stadium_north', 'stadium', 'Stadium North Gate', -19.8, 2.8, 1, ['stadium']),
  // stations (station squares beside the station buildings)
  Z('z_stn_stadium', 'stadium', 'Stadium Station', -10.8, 19.0, 1, ['station']),
  Z('z_stn_university', 'campus', 'University Station', -8, -17.6, 1, ['station']),
  Z('z_stn_central', 'downtown', 'Central Station', 24.6, -11.5, 1.5, ['station']),
];

// ---------------------------------------------------------------- the map
export const TOWN: TownMap = {
  version: '1',
  bounds: BOUNDS,
  neighborhoods: NEIGHBORHOODS,
  zones: ZONES,
  roads: { nodes: roadNodes, edges: roadEdges },
  rail: { loop: RAIL_LOOP, stations: STATIONS, advertisedHeadwayS: 360 },
  stops: STOPS,
  routes: ROUTES,
};

export function stopById(m: TownMap, id: StopId): Stop { return m.stops.find((s) => s.id === id) ?? fail('stop ' + id); }
export function stationById(m: TownMap, id: StationId): Station { return m.rail.stations.find((s) => s.id === id) ?? fail('station ' + id); }
export function routeById(m: TownMap, id: RouteId): Route { return m.routes.find((r) => r.id === id) ?? fail('route ' + id); }
export function zoneById(m: TownMap, id: string): Zone { return m.zones.find((z) => z.id === id) ?? fail('zone ' + id); }

/** Distance from a zone door to its nearest stop or platform (map tooling and tests). */
export function nearestAccess(m: TownMap, p: Vec2): { at: string; d: number } {
  let best = { at: '', d: Infinity };
  for (const s of m.stops) { const d = distance(p, s.p); if (d < best.d) best = { at: s.id, d }; }
  for (const s of m.rail.stations) { const d = distance(p, s.platform); if (d < best.d) best = { at: s.id, d }; }
  return best;
}

/** Point on the rail at a station's platform centre (for renderers). */
export function stationPoint(m: TownMap, id: StationId): { x: number; z: number; heading: number } {
  return pointAt(m.rail.loop, stationById(m, id).dist);
}
