// Owner: T1b. Demand generation, itineraries, choice and reconsideration (spec §5.1, §5.4, §5.7).
import { describe, expect, it } from 'vitest';
import type { DemandGenerator, Itinerary, Leg, PassengerSpec, ScenarioDef, TownMap, Vec2, Zone } from '../src/contracts';
import { withConfig } from '../src/config';
import { distance } from '../src/map/geometry';
import { TOWN } from '../src/map/town';
import { stream } from '../src/rng';
import { SCENARIOS } from '../src/scenarios';
import { createTripPlanner, generatePassengers } from '../src/passengers/index';
import { profilePoints, sampleSpawnT } from '../src/passengers/demand';
import { STATION_TRANSFER_WALK_S, attractiveSet, candidatesFor } from '../src/passengers/planner';
import { LINE_TOWN } from './fixtures/passengersMap';

const CFG = withConfig();

/** A mid-range passenger with no choice noise (spec §5.4 draw midpoints). */
function typical(over: Partial<PassengerSpec> = {}): PassengerSpec {
  return {
    id: 0, spawnT: 0, origin: 'z_home', dest: 'z_univ', walkSpeed: 0.05,
    weights: { walk: 1.5, wait: 2, ride: 1 }, transferPenaltyS: 210, maxTransfers: 1,
    patienceS: 660, switchPenaltyS: 120, choiceNoise: 0, tint: 0, ...over,
  };
}

function shape(it: Itinerary): string {
  return it.legs.map((l) => {
    if (l.kind === 'walk') return 'walk';
    if (l.kind === 'bus') return `bus[${l.routes.join(',')}] ${l.board}→${l.alight}`;
    return `train ${l.board}→${l.alight}`;
  }).join(' > ');
}
const transitLegs = (it: Itinerary) => it.legs.filter((l): l is Exclude<Leg, { kind: 'walk' }> => l.kind !== 'walk');
const zone = (m: TownMap, id: string): Zone => m.zones.find((z) => z.id === id)!;
const near = (a: Vec2, b: Vec2) => distance(a, b) < 1e-9;

function placePos(m: TownMap, l: Exclude<Leg, { kind: 'walk' }>, end: 'board' | 'alight'): Vec2 {
  if (l.kind === 'bus') return m.stops.find((s) => s.id === l[end])!.p;
  return m.rail.stations.find((s) => s.id === l[end])!.platform;
}

/** A walk between a station platform and its paired stop (either direction): a capped transfer connection. */
function isStationTransfer(m: TownMap, a: Vec2, b: Vec2): boolean {
  return m.rail.stations.some((st) => {
    const stop = m.stops.find((s) => s.id === st.stopId);
    return !!stop && ((near(a, st.platform) && near(b, stop.p)) || (near(a, stop.p) && near(b, st.platform)));
  });
}

/** Structural checks every planned itinerary must pass. */
function checkItinerary(m: TownMap, spec: PassengerSpec, it: Itinerary): void {
  const from = zone(m, spec.origin).door;
  const to = zone(m, spec.dest).door;
  expect(it.legs.length).toBeGreaterThan(0);
  expect(it.legs[0]!.kind).toBe('walk');
  expect(it.legs[it.legs.length - 1]!.kind).toBe('walk');
  let pos = from;
  let transit = 0;
  for (const l of it.legs) {
    if (l.kind === 'walk') {
      expect(near(l.from, pos)).toBe(true);
      const walkS = Math.max(1, Math.round((distance(l.from, l.to) * CFG.walk.detourFactor) / spec.walkSpeed));
      expect(l.durationS).toBe(isStationTransfer(m, l.from, l.to) ? Math.min(STATION_TRANSFER_WALK_S, walkS) : walkS);
      pos = l.to;
      continue;
    }
    expect(near(placePos(m, l, 'board'), pos)).toBe(true);
    expect(l.board).not.toBe(l.alight);
    if (l.kind === 'bus') {
      expect(l.routes.length).toBeGreaterThan(0);
      for (const r of l.routes) {
        const route = m.routes.find((x) => x.id === r)!;
        expect(route.stops).toContain(l.board);
        expect(route.stops).toContain(l.alight);
      }
    }
    transit++;
    pos = placePos(m, l, 'alight');
  }
  expect(near(pos, to)).toBe(true);
  expect(it.transfers).toBe(Math.max(0, transit - 1));
  expect(it.transfers).toBeLessThanOrEqual(spec.maxTransfers);
  expect(Number.isFinite(it.expectedCostS)).toBe(true);
}

// ------------------------------------------------------------------------------------------------ demand
describe('generatePassengers', () => {
  const def = SCENARIOS.stadium_exit;
  const list = generatePassengers(TOWN, def, 1001, CFG);
  const isStadium = (zid: string) => zone(TOWN, zid).tags.includes('stadium');

  it('is deterministic per seed and differs across seeds', () => {
    expect(generatePassengers(TOWN, def, 1001, CFG)).toEqual(list);
    const other = generatePassengers(TOWN, def, 1002, CFG);
    expect(other).not.toEqual(list);
    expect(other.slice(0, 50).map((p) => p.spawnT)).not.toEqual(list.slice(0, 50).map((p) => p.spawnT));
  });

  it('numbers passengers 0..n-1 in spawn order inside the spawning window', () => {
    list.forEach((p, i) => {
      expect(p.id).toBe(i);
      expect(Number.isInteger(p.spawnT)).toBe(true);
      expect(p.spawnT).toBeGreaterThanOrEqual(0);
      expect(p.spawnT).toBeLessThan(def.durationS);
      if (i > 0) expect(p.spawnT).toBeGreaterThanOrEqual(list[i - 1]!.spawnT);
    });
  });

  it('scales every generator by the per-run demandScale draw (first draw of the demand stream), ±1', () => {
    for (const seed of [1001, 2002, 4003, 50000]) {
      const ps = generatePassengers(TOWN, def, seed, CFG);
      const scale = stream(seed, 'demand').range(...def.perturb.demandScale);
      const crowd = ps.filter((p) => isStadium(p.origin)).length;
      const total = (id: string) => def.demand.find((g) => g.id === id)!.total;
      expect(Math.abs(crowd - total('stadium_crowd') * scale)).toBeLessThanOrEqual(1);
      expect(Math.abs(ps.length - crowd - total('background') * scale)).toBeLessThanOrEqual(1);
    }
    const cc = SCENARIOS.class_change;
    const ps = generatePassengers(TOWN, cc, 1003, CFG);
    const scale = stream(1003, 'demand').range(...cc.perturb.demandScale);
    expect(Math.abs(ps.length - 900 * scale)).toBeLessThanOrEqual(2);
  });

  it('releases the stadium crowd as a pulse: from 600 s, peaking near 720 s, done by 1140 s', () => {
    const crowd = list.filter((p) => isStadium(p.origin));
    const inside = crowd.filter((p) => p.spawnT >= 600 && p.spawnT <= 1140).length;
    expect(inside / crowd.length).toBeGreaterThan(0.95);
    const bins = new Map<number, number>();
    for (const p of crowd) bins.set(Math.floor(p.spawnT / 60) * 60, (bins.get(Math.floor(p.spawnT / 60) * 60) ?? 0) + 1);
    const peak = [...bins.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
    expect(peak).toBeGreaterThanOrEqual(660);
    expect(peak).toBeLessThanOrEqual(780);
    // background is uniform over the whole window
    const bg = list.filter((p) => !isStadium(p.origin));
    expect(bg.filter((p) => p.spawnT < 900).length / bg.length).toBeGreaterThan(0.35);
    expect(bg.filter((p) => p.spawnT < 900).length / bg.length).toBeLessThan(0.65);
  });

  it('sends the crowd by the scenario shares and never to the origin zone', () => {
    const crowd = list.filter((p) => isStadium(p.origin));
    const share = (pred: (z: Zone) => boolean) => crowd.filter((p) => pred(zone(TOWN, p.dest))).length / crowd.length;
    expect(share((z) => z.neighborhood === 'apartments' && z.tags.includes('housing'))).toBeCloseTo(0.45, 1);
    expect(share((z) => z.neighborhood === 'downtown' && z.tags.includes('retail'))).toBeCloseTo(0.25, 1);
    expect(share((z) => z.neighborhood === 'campus' && z.tags.includes('hall'))).toBeCloseTo(0.15, 1);
    expect(share((z) => z.id === 'z_stn_central')).toBeCloseTo(0.15, 1);
    for (const p of list) {
      expect(p.origin).not.toBe(p.dest);
      expect(TOWN.zones.some((z) => z.id === p.origin)).toBe(true);
      expect(TOWN.zones.some((z) => z.id === p.dest)).toBe(true);
    }
    expect(list.filter((p) => !isStadium(p.origin)).every((p) => !isStadium(p.dest))).toBe(true);
  });

  it('draws personal attributes inside the spec ranges', () => {
    for (const p of list) {
      expect(p.walkSpeed).toBeGreaterThanOrEqual(CFG.walk.minSpeed);
      expect(p.walkSpeed).toBeLessThanOrEqual(CFG.walk.maxSpeed);
      expect(p.weights.walk).toBeGreaterThanOrEqual(1);
      expect(p.weights.walk).toBeLessThanOrEqual(2);
      expect(p.weights.wait).toBeGreaterThanOrEqual(1.5);
      expect(p.weights.wait).toBeLessThanOrEqual(2.5);
      expect(p.weights.ride).toBe(1);
      expect(p.transferPenaltyS).toBeGreaterThanOrEqual(120);
      expect(p.transferPenaltyS).toBeLessThanOrEqual(300);
      expect([0, 1]).toContain(p.maxTransfers);
      expect(p.patienceS).toBeGreaterThanOrEqual(420);
      expect(p.patienceS).toBeLessThanOrEqual(900);
      expect(p.switchPenaltyS).toBe(120);
      expect(Math.abs(p.choiceNoise)).toBeLessThanOrEqual(1);
      expect(Number.isInteger(p.tint) && p.tint >= 0 && p.tint <= 5).toBe(true);
    }
    const oneTransfer = list.filter((p) => p.maxTransfers === 1).length / list.length;
    expect(oneTransfer).toBeGreaterThan(0.8);
    expect(oneTransfer).toBeLessThan(0.9);
    const meanSpeed = list.reduce((s, p) => s + p.walkSpeed, 0) / list.length;
    expect(meanSpeed).toBeCloseTo(0.05, 2);
    expect(new Set(list.map((p) => p.tint)).size).toBe(6);
  });

  it('keeps a passenger\'s personal draws tied to (seed, id) only', () => {
    const a = generatePassengers(TOWN, SCENARIOS.stadium_exit, 777, CFG)[5]!;
    const b = generatePassengers(TOWN, SCENARIOS.class_change, 777, CFG)[5]!;
    const personal = (p: PassengerSpec) => ({ ...p, spawnT: 0, origin: '', dest: '' });
    expect(personal(a)).toEqual(personal(b));
  });

  it('generates every scenario inside the window, including the truncated second class pulse', () => {
    for (const d of Object.values(SCENARIOS)) {
      const ps = generatePassengers(TOWN, d, 2001, CFG);
      expect(ps.length).toBeGreaterThan(100);
      expect(ps.every((p) => p.spawnT >= 0 && p.spawnT < d.durationS)).toBe(true);
    }
    const cc = generatePassengers(TOWN, SCENARIOS.class_change, 2001, CFG);
    expect(cc.filter((p) => p.spawnT >= 1500).length).toBeGreaterThan(200);
  });

  it('resolves selectors on any map, redraws same-zone trips, and rejects empty selectors', () => {
    const gen = (g: Partial<DemandGenerator>): ScenarioDef => ({
      ...SCENARIOS.stadium_exit,
      demand: [{ id: 'g', from: { neighborhood: 'stadium' }, to: [{ sel: { tag: 'housing' }, share: 1 }], total: 100,
        profile: { kind: 'uniform', start: 0, end: 600 }, ...g }],
    });
    const ps = generatePassengers(LINE_TOWN, gen({}), 9, CFG);
    expect(ps.length).toBeGreaterThanOrEqual(89);
    expect(ps.every((p) => p.origin === 'z_gate' && p.dest === 'z_home' && p.spawnT < 600)).toBe(true);

    const swap = generatePassengers(LINE_TOWN, gen({
      from: { zones: ['z_home', 'z_shop'] },
      to: [{ sel: { zones: ['z_home'] }, share: 0.5 }, { sel: { zones: ['z_shop'] }, share: 0.5 }],
    }), 9, CFG);
    expect(swap.every((p) => (p.origin === 'z_home' ? p.dest === 'z_shop' : p.dest === 'z_home'))).toBe(true);
    expect(new Set(swap.map((p) => p.origin)).size).toBe(2);

    expect(() => generatePassengers(LINE_TOWN, gen({ from: { zones: ['z_nowhere'] } }), 9, CFG)).toThrow(/origin/);
    expect(() => generatePassengers(LINE_TOWN, gen({ from: { zones: ['z_home'] }, to: [{ sel: { zones: ['z_home'] }, share: 1 }] }), 9, CFG)).toThrow(/destination/);
  });
});

describe('spawn-time profiles', () => {
  it('inverts a uniform profile', () => {
    const pts = profilePoints({ kind: 'uniform', start: 0, end: 1800 });
    expect(sampleSpawnT(pts, 0, 1800)).toBe(0);
    expect(sampleSpawnT(pts, 0.5, 1800)).toBe(900);
    expect(sampleSpawnT(pts, 0.999999, 1800)).toBe(1799);
  });
  it('shapes a pulse as a ramp up then a linear decay', () => {
    const pts = profilePoints({ kind: 'pulse', at: 600, rampS: 120, decayS: 420 });
    expect(sampleSpawnT(pts, 0, 1800)).toBe(600);
    expect(Math.abs(sampleSpawnT(pts, 120 / 540, 1800) - 720)).toBeLessThanOrEqual(1);
    expect(sampleSpawnT(pts, 0.999999, 1800)).toBe(1139);
    let prev = -1;
    for (let u = 0; u < 1; u += 0.01) {
      const t = sampleSpawnT(pts, u, 1800);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
  });
  it('truncates at the end of the spawning window', () => {
    const pts = profilePoints({ kind: 'pulse', at: 1500, rampS: 90, decayS: 300 });
    expect(sampleSpawnT(pts, 0.999999, 1800)).toBe(1799);
    expect(sampleSpawnT(pts, 0, 1800)).toBe(1500);
  });
  it('follows a piecewise-linear rate', () => {
    const pts = profilePoints({ kind: 'piecewise', points: [[0, 0.5], [600, 1.4], [1200, 1.2], [1800, 0.4]] });
    expect(sampleSpawnT(pts, 0, 1800)).toBe(0);
    expect(Math.abs(sampleSpawnT(pts, 570 / 1830, 1800) - 600)).toBeLessThanOrEqual(1);
    expect(Math.abs(sampleSpawnT(pts, 1350 / 1830, 1800) - 1200)).toBeLessThanOrEqual(1);
  });
});

// ------------------------------------------------------------------------------------------------ planner (fixture)
describe('trip planner on a synthetic line town', () => {
  const planner = createTripPlanner(LINE_TOWN, CFG);

  it('enumerates walk, bus↔bus and bus↔train candidates for apartments → university', () => {
    expect(candidatesFor(LINE_TOWN, CFG, 'z_home', 'z_univ').map((c) => c.key)).toEqual([
      'walk',
      'bb:stop_apts_south>stop_central_stn>stop_university_stn',
      'bt:stop_apts_south>stn_central>stn_university',
    ]);
  });

  it('apartments → university with maxTransfers 1 chooses r2 + train', () => {
    const it1 = planner.plan(typical());
    expect(shape(it1)).toBe('walk > bus[r2] stop_apts_south→stop_central_stn > walk > train stn_central→stn_university > walk');
    expect(it1.transfers).toBe(1);
    // the stop → platform connection (50 s at walking pace) is capped at STATION_TRANSFER_WALK_S
    expect(it1.legs.filter((l) => l.kind === 'walk').map((l) => (l as Extract<Leg, { kind: 'walk' }>).durationS)).toEqual([150, STATION_TRANSFER_WALK_S, 175]);
    checkItinerary(LINE_TOWN, typical(), it1);
  });

  it('with maxTransfers 0 the same trip walks', () => {
    const it0 = planner.plan(typical({ maxTransfers: 0 }));
    expect(shape(it0)).toBe('walk');
    expect(it0.legs[0]).toEqual({ kind: 'walk', from: { x: 0, z: 6 }, to: { x: 60, z: 9 }, durationS: 1502 });
  });

  it('reports the generalized cost of the chosen itinerary (advertised headways only)', () => {
    // walks (150 + 20 + 175) s × 1.6 + waits (144/2 + 360/2) × 2 + rides (120 + 85) + transfer 210 = 1471
    expect(planner.plan(typical({ weights: { walk: 1.6, wait: 2, ride: 1 } })).expectedCostS).toBe(1471);
  });

  it('lists every attractive route serving a stop pair', () => {
    const it1 = planner.plan(typical({ origin: 'z_shop', dest: 'z_plaza' }));
    expect(shape(it1)).toBe('walk > bus[r2,r3] stop_downtown→stop_central_stn > walk');
  });

  it('drops a route whose ride is longer than waiting for the faster one (common lines)', () => {
    const w = { walk: 1.5, wait: 2, ride: 1 };
    expect(attractiveSet([{ route: 'r2', rideS: 50, headwayS: 144 }, { route: 'r1', rideS: 600, headwayS: 270 }], w))
      .toEqual({ routes: ['r2'], waitS: 72, rideS: 50 });
    const both = attractiveSet([{ route: 'r2', rideS: 50, headwayS: 144 }, { route: 'r3', rideS: 50, headwayS: 87 }], w);
    expect(both.routes).toEqual(['r2', 'r3']);
    expect(both.waitS).toBeCloseTo(0.5 / (1 / 144 + 1 / 87), 6);
    expect(both.rideS).toBeCloseTo(50, 6);
  });

  it('walks short hops', () => {
    expect(shape(planner.plan(typical({ origin: 'z_plaza', dest: 'z_gate' })))).toBe('walk');
  });

  it('is pure: same spec → same itinerary, unaffected by callers mutating results', () => {
    const a = planner.plan(typical());
    (a.legs[0] as Extract<Leg, { kind: 'walk' }>).from.x = 999;
    a.legs.length = 0;
    const b = planner.plan(typical());
    expect(b).toEqual(createTripPlanner(LINE_TOWN, CFG).plan(typical()));
    expect((b.legs[0] as Extract<Leg, { kind: 'walk' }>).from.x).toBe(0);
  });

  it('choice noise splits near-ties but never flips a clear winner', () => {
    const tie = (n: number) => shape(planner.plan(typical({ id: 7, origin: 'z_shop', dest: 'z_plaza', weights: { walk: 0.85, wait: 2, ride: 1 }, choiceNoise: n })));
    expect(tie(0)).toContain('bus');
    const seen = new Set<string>();
    for (let i = 0; i <= 100; i++) seen.add(tie(-1 + i / 50));
    expect(seen.size).toBe(2);
    for (let i = 0; i <= 100; i++) {
      expect(shape(planner.plan(typical({ id: i, choiceNoise: -1 + i / 50 })))).toContain('train');
    }
  });
});

// ------------------------------------------------------------------------------------------------ reconsideration
describe('reconsider', () => {
  const planner = createTripPlanner(LINE_TOWN, CFG);
  const centralPlatform = { x: 30, z: 2 };
  const toPlaza: Leg[] = [
    { kind: 'train', board: 'stn_central', alight: 'stn_stadium' },
    { kind: 'walk', from: { x: 45, z: 2 }, to: { x: 36, z: 8 }, durationS: 270 },
  ];
  const impatient = typical({ dest: 'z_plaza', patienceS: 420 });

  it('an impatient passenger near the destination walks away', () => {
    // stay: 180·2 + 20 + 270·1.5 = 785 · walk: 212·1.5 + 120 = 438
    expect(planner.reconsider(impatient, centralPlatform, 450, toPlaza))
      .toEqual({ kind: 'walk', from: { x: 30, z: 2 }, to: { x: 36, z: 8 }, durationS: 212 });
  });

  it('nobody reconsiders before their patience runs out', () => {
    expect(planner.reconsider(impatient, centralPlatform, 400, toPlaza)).toBeNull();
  });

  it('the switch penalty counts against walking', () => {
    expect(planner.reconsider({ ...impatient, switchPenaltyS: 400 }, centralPlatform, 450, toPlaza)).not.toBeNull();
    expect(planner.reconsider({ ...impatient, switchPenaltyS: 500 }, centralPlatform, 450, toPlaza)).toBeNull();
  });

  it('a passenger far from the destination never walks away', () => {
    const spec = typical({ patienceS: 420 });
    const remaining = planner.plan(spec).legs.slice(1);
    expect(planner.reconsider(spec, { x: 0, z: 0 }, 5000, remaining)).toBeNull();
    expect(planner.reconsider(typical({ patienceS: 900 }), { x: 0, z: 0 }, 600, remaining)).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------ planner (TOWN)
describe('trip planner on TOWN', () => {
  const planner = createTripPlanner(TOWN, CFG);
  const stopP = (id: string) => TOWN.stops.find((s) => s.id === id)!.p;
  const platformP = (id: string) => TOWN.rail.stations.find((s) => s.id === id)!.platform;
  const nearestZone = (pred: (z: Zone) => boolean, p: Vec2) =>
    TOWN.zones.filter(pred).sort((a, b) => distance(a.door, p) - distance(b.door, p))[0]!;
  const downtown = nearestZone((z) => z.neighborhood === 'downtown' && z.tags.includes('retail'), stopP('stop_central_stn'));
  const aptsSouth = nearestZone((z) => z.neighborhood === 'apartments' && z.tags.includes('housing'), stopP('stop_apts_south'));
  const university = nearestZone((z) => z.tags.includes('station') && z.neighborhood === 'campus', platformP('stn_university'));

  it('plans a well-formed itinerary for every zone pair and passenger type', () => {
    const types = [
      typical(), typical({ maxTransfers: 0 }), typical({ walkSpeed: 0.03 }), typical({ walkSpeed: 0.07, choiceNoise: 0.8 }),
      typical({ weights: { walk: 2, wait: 1.5, ride: 1 }, transferPenaltyS: 120 }),
    ];
    let transfers = 0;
    for (const o of TOWN.zones) {
      for (const d of TOWN.zones) {
        if (o.id === d.id) continue;
        for (const t of types) {
          const spec = { ...t, origin: o.id, dest: d.id };
          const it = planner.plan(spec);
          checkItinerary(TOWN, spec, it);
          transfers += it.transfers;
        }
      }
    }
    expect(transfers).toBeGreaterThan(0);
  });

  it('a downtown → apartments trip rides r2 for a typical passenger', () => {
    const it = planner.plan(typical({ origin: downtown.id, dest: aptsSouth.id }));
    const transit = transitLegs(it);
    expect(transit).toHaveLength(1);
    expect(transit[0]).toMatchObject({ kind: 'bus', routes: ['r2'] });
  });

  it('apartments → university: r2 + train is a candidate; with maxTransfers 1 a walk-averse rider transfers off r2', () => {
    const keys = candidatesFor(TOWN, CFG, aptsSouth.id, university.id).map((c) => c.key);
    expect(keys).toContain('bt:stop_apts_south>stn_central>stn_university');
    const averse = typical({ origin: aptsSouth.id, dest: university.id, weights: { walk: 2, wait: 1.5, ride: 1 }, transferPenaltyS: 120 });
    const it1 = planner.plan(averse);
    expect(it1.transfers).toBe(1);
    expect(transitLegs(it1)[0]).toMatchObject({ kind: 'bus', routes: ['r2'] });
    expect(planner.plan({ ...averse, maxTransfers: 0 }).transfers).toBe(0);
  });

  it('walks between neighbouring doors', () => {
    let best: [Zone, Zone] | null = null;
    for (const a of TOWN.zones) for (const b of TOWN.zones) {
      if (a.id !== b.id && (!best || distance(a.door, b.door) < distance(best[0].door, best[1].door))) best = [a, b];
    }
    expect(shape(planner.plan(typical({ origin: best![0].id, dest: best![1].id })))).toBe('walk');
  });

  it('an impatient rider at a transfer stop near home walks; one far away waits', () => {
    // Station Court is the housing zone nearest Apartments North; Central Station's stop is a short walk away.
    const home = nearestZone((z) => z.neighborhood === 'apartments' && z.tags.includes('housing'), stopP('stop_apts_north'));
    const door = home.door;
    const toHome: Leg[] = [
      { kind: 'bus', routes: ['r2'], board: 'stop_central_stn', alight: 'stop_apts_north' },
      { kind: 'walk', from: stopP('stop_apts_north'), to: door, durationS: Math.round((distance(stopP('stop_apts_north'), door) * 1.25) / 0.05) },
    ];
    // walking now (≈ 9 u) beats another r2 headway/2 of waiting + the ride + the last walk
    const impatient = typical({ dest: home.id, patienceS: 420, weights: { walk: 1, wait: 2.5, ride: 1 } });
    const walk = planner.reconsider(impatient, stopP('stop_central_stn'), 600, toHome);
    expect(walk).toMatchObject({ kind: 'walk', to: door });
    expect(walk!.from).toEqual(stopP('stop_central_stn'));

    const fromUniversity: Leg[] = [{ kind: 'bus', routes: ['r1'], board: 'stop_university_stn', alight: 'stop_central_stn' }, ...toHome];
    expect(planner.reconsider(typical({ dest: home.id, patienceS: 420 }), stopP('stop_university_stn'), 600, fromUniversity)).toBeNull();
  });

  it('plans a whole stadium_exit crowd quickly and uses transit for a real share of trips', () => {
    const ps = generatePassengers(TOWN, SCENARIOS.stadium_exit, 1001, CFG);
    let ms = Infinity; // best of 3 (shared box)
    let its: Itinerary[] = [];
    for (let i = 0; i < 3 && ms >= 150; i++) {
      const t0 = performance.now();
      const fresh = createTripPlanner(TOWN, CFG);
      its = ps.map((p) => fresh.plan(p));
      ms = Math.min(ms, performance.now() - t0);
    }
    const mode = (it: Itinerary) => {
      const tl = transitLegs(it);
      if (tl.length === 0) return 'walk';
      if (tl.length === 2) return 'transfer';
      return tl[0]!.kind;
    };
    const split: Record<string, number> = {};
    for (const it of its) split[mode(it)] = (split[mode(it)] ?? 0) + 1;
    console.log(`[passengers] stadium_exit seed 1001: ${ps.length} passengers planned in ${ms.toFixed(1)} ms; modes`, split);
    expect(ms).toBeLessThan(150);
    // Calibration-dependent (spec weights on TOWN give ~30% transit); this only guards "transit is used at all".
    expect(its.length - (split.walk ?? 0)).toBeGreaterThan(ps.length * 0.15);
  });
});
