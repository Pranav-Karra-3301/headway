// Golden journey (spec §12): one passenger Apartments South → University via r2 + train, itinerary forced through
// the engine's test hook. Event order and timings must match the rules.
import { afterEach, describe, expect, it } from 'vitest';
import type { Itinerary, Leg, PassengerSpec, SimEvent, Vec2 } from '../src/contracts';
import { DEFAULT_CONFIG } from '../src/config';
import { PolicyController } from '../src/controllers/policy';
import { __forceItinerary, __setEngineTestHooks, createSim } from '../src/engine/index';
import { distance } from '../src/map/geometry';
import { TOWN, routeById, stationById, stopById, zoneById } from '../src/map/town';
import { STATION_TRANSFER_WALK_S } from '../src/passengers/planner';
import { G0 } from '../src/policy/builtin';
import { engineHooks } from './fakes';

const cfg = DEFAULT_CONFIG;
const ORIGIN = 'z_parkside';
const DEST = 'z_stn_university';
const SPEED = 0.05;
const walkS = (a: Vec2, b: Vec2) => Math.max(1, Math.round((distance(a, b) * cfg.walk.detourFactor) / SPEED));
/** Platform ↔ paired-stop connections are capped (planner and engine alike). */
const connectS = (a: Vec2, b: Vec2) => Math.min(STATION_TRANSFER_WALK_S, walkS(a, b));

const spec: PassengerSpec = {
  id: 0, spawnT: 120, origin: ORIGIN, dest: DEST, walkSpeed: SPEED,
  weights: { walk: 1.5, wait: 2, ride: 1 }, transferPenaltyS: 180, maxTransfers: 1,
  patienceS: 5000, switchPenaltyS: 120, choiceNoise: 0, tint: 2,
};

const door = zoneById(TOWN, ORIGIN).door;
const destDoor = zoneById(TOWN, DEST).door;
const aptsSouth = stopById(TOWN, 'stop_apts_south');
const centralStop = stopById(TOWN, 'stop_central_stn');
const central = stationById(TOWN, 'stn_central');
const univ = stationById(TOWN, 'stn_university');

function itinerary(explicitTransferWalk: boolean): Itinerary {
  const legs: Leg[] = [
    { kind: 'walk', from: door, to: aptsSouth.p, durationS: walkS(door, aptsSouth.p) },
    { kind: 'bus', routes: ['r2'], board: 'stop_apts_south', alight: 'stop_central_stn' },
    ...(explicitTransferWalk ? [{ kind: 'walk' as const, from: centralStop.p, to: central.platform, durationS: connectS(centralStop.p, central.platform) }] : []),
    { kind: 'train', board: 'stn_central', alight: 'stn_university' },
    { kind: 'walk', from: univ.platform, to: destDoor, durationS: walkS(univ.platform, destDoor) },
  ];
  return { legs, expectedCostS: 0, transfers: 1 };
}

function journey(explicitTransferWalk: boolean) {
  __setEngineTestHooks(engineHooks({ passengers: () => [spec] }));
  __forceItinerary((s) => (s.id === 0 ? itinerary(explicitTransferWalk) : null));
  const sim = createSim({ map: TOWN, scenario: { scenarioId: 'stadium_exit', seed: 1001, split: 'train' }, controller: new PolicyController(G0) });
  const events: SimEvent[] = [];
  const statuses: string[] = [];
  const reasons: string[] = [];
  while (!sim.done) {
    sim.step();
    events.push(...sim.snapshot().events.filter((e) => e.kind !== 'decision'));
    const info = sim.passenger(0);
    if (info && statuses[statuses.length - 1] !== info.status) { statuses.push(info.status); reasons.push(info.reason); }
  }
  return { sim, events, statuses, reasons, result: sim.result() };
}

afterEach(() => { __setEngineTestHooks(null); });

describe('golden journey: Apartments South → University via r2 + train', () => {
  for (const explicit of [false, true]) {
    it(`walk → wait → r2 → central → walk → train → university → walk → arrive (${explicit ? 'planner' : 'engine'} transfer walk)`, () => {
      const { events, statuses, reasons, result } = journey(explicit);
      const mine = events.filter((e) => 'personId' in e && e.personId === 0);
      const seq = mine.filter((e) => e.kind === 'board' || e.kind === 'alight' || e.kind === 'arrive');
      expect(seq.map((e) => e.kind)).toEqual(['board', 'alight', 'board', 'alight', 'arrive']);
      const [b1, a1, b2, a2, arr] = seq as Array<Extract<SimEvent, { kind: 'board' | 'alight' }>>;
      expect(b1!.at).toEqual({ kind: 'stop', id: 'stop_apts_south' });
      expect(['b3', 'b4']).toContain(b1!.vehicleId); // the r2 buses under the 2/2/2 allocation
      expect(a1!.at).toEqual({ kind: 'stop', id: 'stop_central_stn' });
      expect(a1!.vehicleId).toBe(b1!.vehicleId);
      expect(b2).toMatchObject({ vehicleId: 't1', at: { kind: 'platform', id: 'stn_central' } });
      expect(a2).toMatchObject({ vehicleId: 't1', at: { kind: 'platform', id: 'stn_university' } });
      expect(mine.some((e) => e.kind === 'transfer_made' && e.t === b2!.t)).toBe(true);
      expect(statuses).toEqual(['walking', 'waiting', 'riding', 'walking', 'waiting', 'riding', 'walking', 'arrived']);
      expect(reasons[1]).toMatch(/^Waiting for Route 2 — (next bus in ~\d+ min|no bus on the way)$/);
      expect(reasons[2]).toBe('Riding Route 2 to Central Station');
      expect(reasons[3]).toBe('Transferring: walking to Central Station platform');
      expect(reasons[5]).toBe('Riding the train to University Station');

      // timings inside computed bounds
      const walk1 = walkS(door, aptsSouth.p);
      expect(b1!.t).toBeGreaterThanOrEqual(spec.spawnT + walk1);
      expect(b1!.t).toBeLessThanOrEqual(spec.spawnT + walk1 + routeById(TOWN, 'r2').nominalLoopS + 300);
      const r2 = routeById(TOWN, 'r2');
      const rideU = r2.path.length - r2.stopDist[r2.stops.indexOf('stop_apts_south')]!; // apts_south → terminal (central)
      const vMax = cfg.bus.speed * 1.15, vMin = cfg.bus.speed * 0.85;
      expect(a1!.t - b1!.t).toBeGreaterThanOrEqual(Math.floor(rideU / vMax) + cfg.bus.minDwellS);
      expect(a1!.t - b1!.t).toBeLessThanOrEqual(Math.ceil(rideU / vMin) + 2 * (cfg.bus.minDwellS + 30) + 60);
      const transferWalk = connectS(centralStop.p, central.platform);
      expect(transferWalk).toBe(STATION_TRANSFER_WALK_S); // 3.85 u at walking pace would take ~96 s
      expect(b2!.t).toBeGreaterThanOrEqual(a1!.t + transferWalk);
      const L = TOWN.rail.loop.length;
      const railU = (((univ.dist - central.dist) % L) + L) % L; // central → stadium → university
      const minRide = railU / cfg.train.speed + cfg.train.minDwellS; // one intermediate stop (stadium)
      const maxRide = railU / cfg.train.speed + 3 * (cfg.train.maxDwellS + 60);
      expect(a2!.t - b2!.t).toBeGreaterThanOrEqual(Math.floor(minRide));
      expect(a2!.t - b2!.t).toBeLessThanOrEqual(Math.ceil(maxRide));
      expect(b2!.t - (a1!.t + transferWalk)).toBeLessThanOrEqual(L / cfg.train.speed + 3 * (cfg.train.maxDwellS + 60)); // ≤ one train loop of waiting
      expect(arr!.t - a2!.t).toBe(walkS(univ.platform, destDoor));

      expect(result.metrics.spawned).toBe(1);
      expect(result.metrics.completed).toBe(1);
      expect(result.metrics.transfersMade).toBe(1);
      expect(result.metrics.J).toBe(arr!.t - spec.spawnT);
    });
  }

  it('the forced-itinerary hook is cleared by passing null', () => {
    __forceItinerary(() => itinerary(false));
    __forceItinerary(null);
    __setEngineTestHooks(engineHooks({ passengers: () => [spec] }));
    const sim = createSim({ map: TOWN, scenario: { scenarioId: 'stadium_exit', seed: 1001, split: 'train' }, controller: new PolicyController(G0) });
    sim.step();
    while (!sim.passenger(0)) sim.step();
    expect(sim.passenger(0)!.itinerary.legs.length).toBeGreaterThan(0);
  });
});
