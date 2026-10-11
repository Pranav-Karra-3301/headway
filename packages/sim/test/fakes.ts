// Owner: T1a. Minimal stand-ins for the T1b (passengers) and T1c (metrics) seams, used by the engine tests while
// those modules are stubs. `engineHooks()` returns hooks that fall back to these fakes ONLY for modules that still
// throw "not implemented", so the same tests run against the real modules as soon as they land.
import type {
  Itinerary, Leg, Metrics, PassengerSpec, QueuePlace, RunResult, ScenarioDef, SimConfig, SimEvent, Stop, TownMap, Vec2,
  Zone, ZoneSelector,
} from '../src/contracts';
import type { Collector, CollectorInit, Mode, TripPlanner } from '../src/internal';
import { withConfig } from '../src/config';
import type { EngineTestHooks } from '../src/engine/engine';
import { distance } from '../src/map/geometry';
import { TOWN } from '../src/map/town';
import { createCollector } from '../src/metrics/index';
import { createTripPlanner, generatePassengers } from '../src/passengers/index';
import { stream } from '../src/rng';
import { scenarioDef } from '../src/scenarios';

const notImplemented = (e: unknown) => /not implemented/.test(String(e instanceof Error ? e.message : e));

/** Which real modules are usable right now. */
export function realModules(): { passengers: boolean; planner: boolean; collector: boolean } {
  const cfg = withConfig();
  const def = scenarioDef('stadium_exit');
  const probe = (f: () => unknown) => {
    try { f(); return true; } catch (e) { if (notImplemented(e)) return false; throw e; }
  };
  return {
    passengers: probe(() => generatePassengers(TOWN, def, 1, cfg)),
    planner: probe(() => createTripPlanner(TOWN, cfg)),
    collector: probe(() => createCollector({ map: TOWN, scenario: def, seed: 1, cfg, targetHeadwayS: () => 240 })),
  };
}

/** Engine hooks using the real T1b/T1c modules where implemented, fakes otherwise. */
export function engineHooks(extra: EngineTestHooks = {}): EngineTestHooks {
  const real = realModules();
  const h: EngineTestHooks = {};
  if (!real.passengers) h.passengers = fakeGeneratePassengers;
  if (!real.planner) h.planner = fakeTripPlanner;
  if (!real.collector) h.collector = fakeCollector;
  return { ...h, ...extra };
}

// ---------------------------------------------------------------- demand
function zonesFor(map: TownMap, sel: ZoneSelector): Zone[] {
  if (sel.zones) return map.zones.filter((z) => sel.zones!.includes(z.id));
  return map.zones.filter((z) => (!sel.neighborhood || z.neighborhood === sel.neighborhood) && (!sel.tag || z.tags.includes(sel.tag)));
}

export function fakeGeneratePassengers(map: TownMap, def: ScenarioDef, seed: number, cfg: SimConfig): PassengerSpec[] {
  const rng = stream(seed, 'demand');
  const scale = rng.range(def.perturb.demandScale[0], def.perturb.demandScale[1]);
  const out: Array<Omit<PassengerSpec, 'id'>> = [];
  for (const g of def.demand) {
    const n = Math.round(g.total * scale);
    const from = zonesFor(map, g.from);
    if (!from.length) continue;
    for (let i = 0; i < n; i++) {
      let spawnT: number;
      const p = g.profile;
      if (p.kind === 'uniform') spawnT = Math.floor(p.start + ((p.end - p.start) * i) / Math.max(1, n));
      else if (p.kind === 'pulse') spawnT = Math.floor(p.at + rng.range(0, p.rampS + p.decayS));
      else spawnT = Math.floor(rng.range(p.points[0]![0], p.points[p.points.length - 1]![0]));
      spawnT = Math.min(def.durationS - 1, Math.max(0, spawnT));
      const o = rng.weighted(from, from.map((z) => z.weight));
      const target = rng.weighted(g.to, g.to.map((x) => x.share));
      const dests = zonesFor(map, target.sel).filter((z) => z.id !== o.id);
      if (!dests.length) continue;
      const d = rng.weighted(dests, dests.map((z) => z.weight));
      out.push({
        spawnT, origin: o.id, dest: d.id,
        walkSpeed: Math.min(cfg.walk.maxSpeed, Math.max(cfg.walk.minSpeed, rng.normal(cfg.walk.meanSpeed, cfg.walk.sdSpeed))),
        weights: { walk: 1.5, wait: 2, ride: 1 }, transferPenaltyS: 180, maxTransfers: 1,
        patienceS: 600, switchPenaltyS: 120, choiceNoise: 0, tint: i % 6,
      });
    }
  }
  out.sort((a, b) => a.spawnT - b.spawnT);
  return out.map((s, id) => ({ ...s, id }));
}

// ---------------------------------------------------------------- planner (walk / one bus leg / one train leg)
export function fakeTripPlanner(map: TownMap, cfg: SimConfig): TripPlanner {
  const door = new Map(map.zones.map((z) => [z.id, z.door] as const));
  const walkS = (a: Vec2, b: Vec2, v: number) => Math.max(1, Math.round((distance(a, b) * cfg.walk.detourFactor) / v));
  const near = <T>(xs: T[], pos: (x: T) => Vec2, p: Vec2) => xs.filter((x) => distance(pos(x), p) <= cfg.walk.accessRadius);
  const busRide = (r: TownMap['routes'][number], a: Stop, b: Stop) => {
    const i = r.stops.indexOf(a.id), j = r.stops.indexOf(b.id);
    const L = r.path.length;
    const d = (((r.stopDist[j]! - r.stopDist[i]!) % L) + L) % L;
    return d / cfg.bus.speed + 20 * ((j - i + r.stops.length) % r.stops.length - 1);
  };
  return {
    plan(spec) {
      const O = door.get(spec.origin)!, D = door.get(spec.dest)!;
      const v = spec.walkSpeed;
      let best: Itinerary = { legs: [{ kind: 'walk', from: O, to: D, durationS: walkS(O, D, v) }], expectedCostS: spec.weights.walk * walkS(O, D, v), transfers: 0 };
      for (const s1 of near(map.stops, (s) => s.p, O)) for (const s2 of near(map.stops, (s) => s.p, D)) {
        if (s1.id === s2.id) continue;
        const routes = map.routes.filter((r) => r.stops.includes(s1.id) && r.stops.includes(s2.id));
        if (!routes.length) continue;
        const ride = Math.min(...routes.map((r) => busRide(r, s1, s2)));
        const hw = Math.min(...routes.map((r) => r.advertisedHeadwayS));
        const cost = spec.weights.walk * (walkS(O, s1.p, v) + walkS(s2.p, D, v)) + spec.weights.wait * hw / 2 + ride;
        if (cost < best.expectedCostS) {
          best = {
            legs: [
              { kind: 'walk', from: O, to: s1.p, durationS: walkS(O, s1.p, v) },
              { kind: 'bus', routes: routes.map((r) => r.id), board: s1.id, alight: s2.id },
              { kind: 'walk', from: s2.p, to: D, durationS: walkS(s2.p, D, v) },
            ],
            expectedCostS: cost, transfers: 0,
          };
        }
      }
      const L = map.rail.loop.length;
      for (const p1 of near(map.rail.stations, (s) => s.platform, O)) for (const p2 of near(map.rail.stations, (s) => s.platform, D)) {
        if (p1.id === p2.id) continue;
        const ride = ((((p2.dist - p1.dist) % L) + L) % L) / cfg.train.speed + 45;
        const cost = spec.weights.walk * (walkS(O, p1.platform, v) + walkS(p2.platform, D, v)) + spec.weights.wait * map.rail.advertisedHeadwayS / 2 + ride;
        if (cost < best.expectedCostS) {
          best = {
            legs: [
              { kind: 'walk', from: O, to: p1.platform, durationS: walkS(O, p1.platform, v) },
              { kind: 'train', board: p1.id, alight: p2.id },
              { kind: 'walk', from: p2.platform, to: D, durationS: walkS(p2.platform, D, v) },
            ],
            expectedCostS: cost, transfers: 0,
          };
        }
      }
      return best;
    },
    reconsider(spec, from, _waitedS, remaining: Leg[]) {
      const D = door.get(spec.dest)!;
      const w = walkS(from, D, spec.walkSpeed);
      const rest = remaining.reduce((s, l) => s + (l.kind === 'walk' ? l.durationS : 300), 0);
      return spec.weights.walk * w + spec.switchPenaltyS < rest ? { kind: 'walk', from, to: D, durationS: w } : null;
    },
  };
}

// ---------------------------------------------------------------- collector
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function canonical(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(canonical);
  if (x && typeof x === 'object') {
    return Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, canonical((x as Record<string, unknown>)[k])]));
  }
  if (typeof x === 'number') return Math.round(x * 1000) / 1000;
  return x;
}

export interface FakeCollector extends Collector {
  log: {
    holds: Array<{ vehicleId: string; at: QueuePlace; seconds: number; t: number }>;
    departures: Array<{ vehicleId: string; mode: Mode; at: QueuePlace; t: number; onboard: number }>;
  };
}

export function fakeCollector(init: CollectorInit): FakeCollector {
  const spawnT = new Map<number, number>();
  const arriveT = new Map<number, number>();
  const waits: number[] = [];
  const lastDep = new Map<string, number>();
  const leftKeys = new Set<string>();
  const ruleFires: Record<string, number> = {};
  const key = (at: QueuePlace) => `${at.kind}:${at.id}`;
  let waiting = 0, riding = 0, missed = 0, left = 0, walkaways = 0, transfers = 0, busDist = 0, deadDist = 0, holdS = 0, trainDwell = 0;
  const log: FakeCollector['log'] = { holds: [], departures: [] };
  return {
    log,
    spawn(pid, t) { spawnT.set(pid, t); },
    queueJoin(pid, at, accepts, from, t): SimEvent | null {
      waiting++;
      if (from === null) return null;
      for (const m of accepts) {
        const d = lastDep.get(`${key(at)}|${m}`);
        if (d !== undefined && t - d < init.cfg.objective.missedWindowS) { missed++; return { t, kind: 'missed_connection', personId: pid, at }; }
      }
      return null;
    },
    board(pid, _v, _m, at, t, waitedS, wasTransfer): SimEvent | null {
      waiting--; riding++; waits.push(waitedS);
      if (!wasTransfer) return null;
      transfers++;
      return { t, kind: 'transfer_made', personId: pid, at };
    },
    leftBehind(pid, at, _m, t): SimEvent | null {
      const k = `${pid}|${key(at)}`;
      if (leftKeys.has(k)) return null;
      leftKeys.add(k); left++;
      return { t, kind: 'left_behind', personId: pid, at };
    },
    alight() { riding--; },
    walkaway() { waiting--; walkaways++; },
    arrive(pid, t) { arriveT.set(pid, t); },
    departure(vehicleId, mode, at, t, onboard) { lastDep.set(`${key(at)}|${mode}`, t); log.departures.push({ vehicleId, mode, at, t, onboard }); },
    hold(vehicleId, at, seconds, _o, _x, t) { holdS += seconds; log.holds.push({ vehicleId, at, seconds, t }); },
    decision(rec) { ruleFires[rec.ruleId] = (ruleFires[rec.ruleId] ?? 0) + 1; },
    distance(_v, du, deadhead) { if (deadhead) deadDist += du; else busDist += du; },
    trainDwell(s) { trainDwell += s; },
    queueSample() {},
    running() {
      let j = 0;
      for (const [pid, a] of arriveT) j += a - spawnT.get(pid)!;
      return {
        spawned: spawnT.size, completed: arriveT.size, waitingNow: waiting, ridingNow: riding,
        meanWaitS: waits.length ? waits.reduce((s, x) => s + x, 0) / waits.length : 0,
        missedConnections: missed, leftBehind: left, jSoFar: j,
      };
    },
    finalize(tEnd, unfinished, meta): RunResult {
      let J = 0;
      for (const [pid, a] of arriveT) J += a - spawnT.get(pid)!;
      for (const u of unfinished) J += tEnd - u.spawnT + init.cfg.objective.unfinishedPenaltyS;
      const sorted = [...waits].sort((a, b) => a - b);
      const spawned = spawnT.size;
      const completed = arriveT.size;
      const metrics: Metrics = {
        J, spawned, completed, unfinished: unfinished.length, completionPct: spawned ? (100 * completed) / spawned : 0,
        meanJourneyS: completed ? [...arriveT].reduce((s, [p, a]) => s + a - spawnT.get(p)!, 0) / completed : 0,
        meanWaitS: sorted.length ? sorted.reduce((s, x) => s + x, 0) / sorted.length : 0,
        p95WaitS: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))]! : 0,
        maxWaitS: sorted.length ? sorted[sorted.length - 1]! : 0,
        transfersMade: transfers, missedConnections: missed, leftBehind: left, walkaways,
        effort: { busDistanceU: busDist, deadheadDistanceU: deadDist, holdS, trainDwellS: trainDwell },
      };
      const hash = fnv1a(JSON.stringify(canonical({ metrics, stops: [], findings: [] })));
      return { ...meta, metrics, stops: [], findings: [], ruleFires, hash };
    },
  };
}
