// Owner: T1c. A small synthetic TownMap with the canonical ids (spec §4 topology) for the metrics tests. Geometry is
// crude (routes are polygons through their stops) because the collector only reads names, served routes and stop
// order. Stop names follow the spec §8.4 examples ("Central", "Apartments South", …) so sentences can be checked
// verbatim against the templates.
import type {
  QueuePlace, Route, RouteId, ScenarioDef, Station, StationId, Stop, StopId, TownMap, Vec2, Zone,
} from '../../src/contracts';
import { polyline } from '../../src/map/geometry';

const v = (x: number, z: number): Vec2 => ({ x, z });

const STOPS: Array<[StopId, string, Vec2, Stop['neighborhood'], RouteId[], StationId?]> = [
  ['stop_stadium_gate', 'Stadium Gate', v(-20, 10), 'stadium', ['r3']],
  ['stop_stadium_stn', 'Stadium Station', v(-20, 20), 'stadium', ['r3'], 'stn_stadium'],
  ['stop_university_stn', 'University', v(-10, -20), 'campus', ['r1'], 'stn_university'],
  ['stop_old_main', 'Old Main', v(-10, 0), 'campus', ['r1', 'r3']],
  ['stop_downtown', 'Downtown', v(0, 0), 'downtown', ['r1', 'r2', 'r3']],
  ['stop_central_stn', 'Central', v(20, -10), 'downtown', ['r1', 'r2'], 'stn_central'],
  ['stop_apts_north', 'Apartments North', v(20, 5), 'apartments', ['r2']],
  ['stop_apts_south', 'Apartments South', v(20, 15), 'apartments', ['r2']],
];
const stops: Stop[] = STOPS.map(([id, name, p, neighborhood, servedRoutes, stationId]) => ({
  id, name, p, queueDir: v(0, 1), neighborhood, servedRoutes, ...(stationId ? { stationId } : {}),
}));
const posOf = (id: StopId): Vec2 => stops.find((s) => s.id === id)!.p;

const ROUTES: Array<[RouteId, string, string, StopId[]]> = [
  ['r1', 'Campus Loop', '#1FA99A', ['stop_central_stn', 'stop_downtown', 'stop_old_main', 'stop_university_stn']],
  ['r2', 'Apartments', '#F0A830', ['stop_central_stn', 'stop_apts_north', 'stop_apts_south', 'stop_downtown']],
  ['r3', 'Stadium', '#8A6BD8', ['stop_stadium_gate', 'stop_stadium_stn', 'stop_old_main', 'stop_downtown']],
];
const routes: Route[] = ROUTES.map(([id, name, color, ss]) => {
  const path = polyline(ss.map(posOf), true);
  const nominalLoopS = Math.round(path.length / 0.3 + ss.length * 20);
  return {
    id, name, color, stops: ss, path, stopDist: path.cum.slice(0, ss.length), terminalNode: `n_${ss[0]}`,
    nominalLoopS, advertisedHeadwayS: Math.round(nominalLoopS / 2),
  };
});

const PLATFORMS: Array<[StationId, string, Vec2, StopId]> = [
  ['stn_stadium', 'Stadium', v(-22, 22), 'stop_stadium_stn'],
  ['stn_university', 'University', v(-12, -22), 'stop_university_stn'],
  ['stn_central', 'Central', v(22, -12), 'stop_central_stn'],
];
const railLoop = polyline(PLATFORMS.map(([, , p]) => p), true);
const stations: Station[] = PLATFORMS.map(([id, name, platform, stopId], i) => ({
  id, name, dist: railLoop.cum[i]!, platform, queueDir: v(1, 0), stopId,
}));

const zones: Zone[] = [
  { id: 'z_stadium', neighborhood: 'stadium', name: 'Stadium', door: v(-26, 10), weight: 1, tags: ['stadium'] },
  { id: 'z_hall', neighborhood: 'campus', name: 'Hall', door: v(-10, -6), weight: 1, tags: ['hall'] },
  { id: 'z_shops', neighborhood: 'downtown', name: 'Shops', door: v(0, 6), weight: 1, tags: ['retail'] },
  { id: 'z_homes', neighborhood: 'apartments', name: 'Homes', door: v(26, 10), weight: 1, tags: ['housing'] },
];

export const METRICS_TOWN: TownMap = {
  version: 'metrics-fixture',
  bounds: { minX: -36, maxX: 36, minZ: -26, maxZ: 26 },
  neighborhoods: [
    { id: 'campus', name: 'Campus', center: v(-10, -10), radius: 10 },
    { id: 'downtown', name: 'Downtown', center: v(10, -5), radius: 10 },
    { id: 'apartments', name: 'Apartments', center: v(20, 10), radius: 10 },
    { id: 'stadium', name: 'Stadium', center: v(-20, 15), radius: 10 },
  ],
  zones,
  roads: { nodes: stops.map((s) => ({ id: `n_${s.id}`, p: s.p })), edges: [] },
  rail: { loop: railLoop, stations, advertisedHeadwayS: 360 },
  stops,
  routes,
};

/** A minimal stadium-exit-like scenario (clock 21:30, 1,800 s + 900 s clearing). */
export function metricsScenario(over: Partial<ScenarioDef> = {}): ScenarioDef {
  return {
    id: 'stadium_exit', kind: 'stadium_exit', name: 'Stadium exit', clockStart: '21:30', durationS: 1800, clearingS: 900,
    demand: [], advertised: [{ kind: 'stadium_closing', t: 600, label: 'Stadium closes' }],
    perturb: {
      demandScale: [1, 1], trafficScale: [1, 1], stadiumCongestion: null, trainDelay: { chance: 0, extraS: [0, 0] },
    },
    ...over,
  };
}

export const stop = (id: StopId): QueuePlace => ({ kind: 'stop', id });
export const platform = (id: StationId): QueuePlace => ({ kind: 'platform', id });
