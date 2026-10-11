// Owner: T1b. A small synthetic TownMap for passenger/planner tests, built with the real geometry helpers.
//
//   z_home (0,6)        z_shop (15,6)                     z_plaza (36,8)  z_gate (45,9)   z_univ (60,9)
//   stop_apts_south ── stop_downtown ── stop_central_stn ─── stop_stadium_stn ─── stop_university_stn   (z = 0)
//   (0,0)              (15,0)           (30,0)               (45,0)              (60,0)
//   rail along z = 3 from x = 30 to 60 (platforms at z = 2), closing via z = 20: Stadium → University → Central.
//
// r2: Central → Apts South → Downtown (loop via z = −4)   ~ apts_south → central 120 s
// r1: Central → University (slow detour via z = −45)      ~ central → university 400 s
// r3: Downtown → Central (short shuttle via z = 5)        ~ downtown → central 50 s
// Train Central → University passes Stadium: 30 u at 0.75 u/s + one 45 s dwell = 85 s.
import type { Route, RouteId, Station, StationId, Stop, StopId, TownMap, Vec2, Zone } from '../../src/contracts';
import { DEFAULT_CONFIG } from '../../src/config';
import { nearestDist, polyline } from '../../src/map/geometry';

const v = (x: number, z: number): Vec2 => ({ x, z });

const STOPS: Stop[] = [
  { id: 'stop_apts_south', name: 'Apts South', p: v(0, 0), queueDir: v(0, 1), neighborhood: 'apartments', servedRoutes: ['r2'] },
  { id: 'stop_downtown', name: 'Downtown', p: v(15, 0), queueDir: v(0, 1), neighborhood: 'downtown', servedRoutes: ['r2', 'r3'] },
  { id: 'stop_central_stn', name: 'Central Station', p: v(30, 0), queueDir: v(0, 1), neighborhood: 'downtown', servedRoutes: ['r1', 'r2', 'r3'], stationId: 'stn_central' },
  { id: 'stop_stadium_stn', name: 'Stadium Station', p: v(45, 0), queueDir: v(0, 1), neighborhood: 'stadium', servedRoutes: [], stationId: 'stn_stadium' },
  { id: 'stop_university_stn', name: 'University Station', p: v(60, 0), queueDir: v(0, 1), neighborhood: 'campus', servedRoutes: ['r1'], stationId: 'stn_university' },
];

function route(id: RouteId, stops: StopId[], points: Vec2[]): Route {
  const path = polyline(points, true);
  const stopDist = stops.map((sid, i) => (i === 0 ? 0 : nearestDist(path, STOPS.find((s) => s.id === sid)!.p)));
  const nominalLoopS = Math.round(path.length / DEFAULT_CONFIG.bus.speed + stops.length * 20);
  return {
    id, name: `Route ${id}`, color: '#888888', stops, path, stopDist, terminalNode: `n_${stops[0]}`,
    nominalLoopS, advertisedHeadwayS: Math.round(nominalLoopS / 2),
  };
}

const ROUTES: Route[] = [
  // length 150, stopDist [0, 120], nominal 540, advertised 270
  route('r1', ['stop_central_stn', 'stop_university_stn'], [v(30, 0), v(30, -45), v(60, -45), v(60, 0)]),
  // length 68, stopDist [0, 38, 53], nominal 287, advertised 144
  route('r2', ['stop_central_stn', 'stop_apts_south', 'stop_downtown'], [v(30, 0), v(30, -4), v(0, -4), v(0, 0), v(15, 0)]),
  // length 40, stopDist [0, 15], nominal 173, advertised 87
  route('r3', ['stop_downtown', 'stop_central_stn'], [v(15, 0), v(30, 0), v(30, 5), v(15, 5)]),
];

// Length 94: Stadium @0, University @15, Central @79 (travel order).
const RAIL_LOOP = polyline([v(45, 3), v(60, 3), v(60, 20), v(30, 20), v(30, 3)], true);
const station = (id: StationId, name: string, x: number, stopId: StopId): Station => ({
  id, name, dist: nearestDist(RAIL_LOOP, v(x, 3)), platform: v(x, 2), queueDir: v(1, 0), stopId,
});
const STATIONS: Station[] = [
  station('stn_stadium', 'Stadium', 45, 'stop_stadium_stn'),
  station('stn_university', 'University', 60, 'stop_university_stn'),
  station('stn_central', 'Central', 30, 'stop_central_stn'),
];

const ZONES: Zone[] = [
  { id: 'z_home', neighborhood: 'apartments', name: 'Home', door: v(0, 6), weight: 2, tags: ['housing'] },
  { id: 'z_shop', neighborhood: 'downtown', name: 'Shop', door: v(15, 6), weight: 1.5, tags: ['retail'] },
  { id: 'z_plaza', neighborhood: 'downtown', name: 'Plaza', door: v(36, 8), weight: 1.5, tags: ['retail'] },
  { id: 'z_gate', neighborhood: 'stadium', name: 'Gate', door: v(45, 9), weight: 3, tags: ['stadium'] },
  { id: 'z_univ', neighborhood: 'campus', name: 'University', door: v(60, 9), weight: 1, tags: ['station'] },
];

export const LINE_TOWN: TownMap = {
  version: 'fixture-line-1',
  bounds: { minX: -5, maxX: 65, minZ: -50, maxZ: 25 },
  neighborhoods: [
    { id: 'apartments', name: 'Apartments', center: v(0, 6), radius: 8 },
    { id: 'downtown', name: 'Downtown', center: v(25, 6), radius: 12 },
    { id: 'stadium', name: 'Stadium', center: v(45, 9), radius: 6 },
    { id: 'campus', name: 'Campus', center: v(60, 9), radius: 6 },
  ],
  zones: ZONES,
  roads: {
    nodes: STOPS.map((s) => ({ id: `n_${s.id}`, p: s.p })),
    edges: [],
  },
  rail: { loop: RAIL_LOOP, stations: STATIONS, advertisedHeadwayS: 360 },
  stops: STOPS,
  routes: ROUTES,
};
