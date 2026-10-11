// Owner: T1a. The deterministic engine (spec §5): 1 s ticks, buses + train, passengers, decision points,
// human intents, async controllers, replays. All randomness is drawn before the run (passengers, traffic table,
// train delays); controllers never consume randomness; ties resolve by id.
import { DEPOT, withConfig } from '../config';
import type {
  Action, AsyncController, Controller, ControllerRef, CreateSimArgs, Decision, DecisionKind, DecisionPoint,
  DecisionRecord, FeatureVector, Intent, Itinerary, Leg, Observation, PassengerInfo, PassengerSpec, PersonView, Policy,
  Polyline, QueuePlace, QueueView, Replay, Route, RouteId, RunResult, ScenarioDef, Sim, SimConfig, SimEvent, SimSnapshot,
  Station, StationId, StopId, TownMap, Vec2, VehicleState, VehicleView,
} from '../contracts';
import type { Collector, CollectorInit, Mode, TripPlanner } from '../internal';
import { distance, polyline } from '../map/geometry';
import { deadheadPath } from '../map/roadGraph';
import { createCollector } from '../metrics/index';
import { createTripPlanner, generatePassengers } from '../passengers/index';
import { STATION_TRANSFER_WALK_S } from '../passengers/planner';
import { G0 } from '../policy/builtin';
import { FEATURES } from '../policy/features';
import { stream } from '../rng';
import { scenarioDef } from '../scenarios';
import { defaultExplanation, resolveAction, safeAction, type ResolveCtx } from './actions';
import { binAt, pathProfile, type PathProfile } from './speed';

// ---------------------------------------------------------------- test hooks
/** Engine test seams (spec §12 golden journey, spies, synthetic scenarios). Captured at createSim time; production
 *  sims always use the real generatePassengers / createTripPlanner / createCollector. */
export interface EngineTestHooks {
  passengers?: (map: TownMap, def: ScenarioDef, seed: number, cfg: SimConfig) => PassengerSpec[];
  planner?: (map: TownMap, cfg: SimConfig) => TripPlanner;
  collector?: (init: CollectorInit) => Collector;
  /** Replaces `scenarioDef(scenario.scenarioId)`. */
  scenario?: ScenarioDef;
  /** Forces a passenger's itinerary (return null to let the planner choose). */
  itinerary?: (spec: PassengerSpec) => Itinerary | null;
}
let HOOKS: EngineTestHooks = {};
export function setEngineTestHooks(h: EngineTestHooks | null): void { HOOKS = h ? { ...h } : {}; }
export function engineTestHooks(): EngineTestHooks { return HOOKS; }

// ---------------------------------------------------------------- constants
const MI: Record<Mode, number> = { r1: 0, r2: 1, r3: 2, train: 3 };
const TRAIN = 3;
const NONE = -1e9;
const NOMINAL_DWELL_S = 20;      // per-stop allowance used by ETAs (same as nominalLoopS)
const UNKNOWN_S = 3600;
const QUEUE_SAMPLE_S = 30;
const ARRIVED_KEEP_S = 3;
const EVENT_BUFFER = 5000;
const TRAIN_DELAY_SLOTS = 256;

// 'depot' = a reserve parked in the depot lot; 'depotOut' = a deployed reserve pulling out of the lot (both VehicleState
// 'depot'; the deployed one already belongs to its route and has holdUntil = when it reaches Central).
type Phase = 'move' | 'deadhead' | 'arrive' | 'layover' | 'thold' | 'board0' | 'b0hold' | 'serve' | 'shold' | 'depot' | 'depotOut';
const STATE: Record<Phase, VehicleState> = {
  move: 'moving', deadhead: 'deadhead', arrive: 'dwelling', layover: 'layover', thold: 'holding',
  board0: 'dwelling', b0hold: 'holding', serve: 'dwelling', shold: 'holding', depot: 'depot', depotOut: 'depot',
};

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const fwd = (from: number, to: number, L: number) => (L > 0 ? (((to - from) % L) + L) % L : 0);
const routeLabel = (ids: readonly string[]) => `Route ${ids.map((r) => r.replace(/^r/, '')).join(' or ')}`;
const minutes = (s: number) => `~${Math.max(1, Math.round(s / 60))} min`;

interface Place {
  idx: number; at: QueuePlace; pos: Vec2; name: string;
  stopId: StopId | null; stationId: StationId | null;
  queue: number[]; counts: number[]; lastDep: number[];
  served: number;     // mode bitmask
  paired: number;     // paired stop <-> platform place, -1 if none
}
interface RouteRt {
  id: RouteId; m: number; route: Route; stopPlace: number[]; uniquePlaces: number[];
  profile: PathProfile; lastTerminalDep: number;
}
interface Bus {
  id: string; r: RouteRt; phase: Phase; pos: number; stopIdx: number;
  riders: number[]; alightQ: number[]; served: number; budget: number;
  holdUntil: number; holdUsedS: number; layoverStart: number;
  dead: { from: RouteId; to: RouteId; path: Polyline; profile: PathProfile } | null;
  reassigned: boolean; decidedAt: number;
  pendingHold: number | null; pendingReassign: RouteId | null;
  lastDecision: DecisionRecord | null;
  /** Deployed from the depot and not yet at its route's terminal (Observation.depot.deploying). */
  fromDepot: boolean;
}
interface Train {
  id: string; phase: 'arrive' | 'dwell' | 'move'; pos: number; stationIdx: number; remaining: number;
  riders: number[]; arrivalT: number; departAt: number | null; delayDone: boolean; decided: boolean;
  departures: number; lastA: number; lastB: number; transfersAlighted: number;
  pendingDwell: number | null; lastDecision: DecisionRecord | null;
}
interface Pax {
  spec: PassengerSpec; it: Itinerary | null; legIdx: number;
  state: 'pending' | 'walking' | 'waiting' | 'riding' | 'arrived';
  pos: Vec2; walkFrom: Vec2; walkTo: Vec2; t0: number; t1: number; walkKind: 'leg' | 'transfer' | 'walkaway';
  place: number; joinT: number; mask: number; leftBehind: boolean;
  vehicle: string | null; alightPlace: number;
  lastMode: Mode | null; vehicleLegsDone: number; boardedLeg: number;
  reconsidered: boolean; arriveT: number;
}

export class Engine implements Sim {
  t = 0;
  done = false;

  private readonly map: TownMap;
  private readonly def: ScenarioDef;
  private readonly seed: number;
  private readonly scenarioId: string;
  private readonly cfg: SimConfig;
  private readonly policy: Policy;
  private readonly controller: Controller | AsyncController;
  private readonly collector: Collector;
  private readonly planner: TripPlanner;
  private readonly forceIt: ((spec: PassengerSpec) => Itinerary | null) | undefined;
  private readonly tEnd: number;
  private readonly maxHoldS: number;
  private readonly trainDwellEst: number;

  private readonly places: Place[] = [];
  private readonly placeOfStop = new Map<string, number>();
  private readonly placeOfStation = new Map<string, number>();
  private readonly routes: RouteRt[] = [];
  private readonly routeRt = new Map<RouteId, RouteRt>();
  private readonly routeIds: RouteId[] = [];
  private readonly buses: Bus[] = [];
  private readonly busById = new Map<string, Bus>();
  /** The route whose terminal the depot sits beside (deploys start there). */
  private readonly depotRoute: RouteId | null;
  private readonly stations: Station[];
  private readonly stationPlace: number[];
  private readonly train: Train;
  private readonly doors = new Map<string, Vec2>();
  private readonly zoneName = new Map<string, string>();

  private readonly specs: PassengerSpec[];
  private readonly pax: Pax[] = [];
  private spawnPtr = 0;
  private readonly walkEnds: Array<number[] | undefined>;
  private readonly patienceAt: Array<number[] | undefined>;
  private readonly transferWalkers = new Set<number>();

  private readonly traffic: Float64Array[];
  private readonly delays: number[];
  private readonly cong: ScenarioDef['perturb']['stadiumCongestion'];
  private readonly congCenter: Vec2 | null;
  private readonly nearCache = new Map<PathProfile, Uint8Array>();

  private dpSeq = 0;
  private nowSeq = 0;
  private cursor = -1;   // vehicle index inside a paused tick, -1 between ticks
  private pending: { dp: DecisionPoint; wait: Promise<void>; release: () => void } | null = null;
  private readonly replayDecisions = new Map<number, Action>();
  private readonly captured: Array<{ dpId: number; action: Action }> = [];
  private readonly intentLog: Array<{ t: number; intent: Intent }> = [];
  private readonly intentsAt = new Map<number, Intent[]>();
  private events: SimEvent[] = [];
  private cached: RunResult | null = null;

  constructor(a: CreateSimArgs, hooks: EngineTestHooks = HOOKS) {
    this.map = a.map;
    this.cfg = withConfig(a.config);
    this.def = hooks.scenario ?? scenarioDef(a.scenario.scenarioId);
    this.scenarioId = a.scenario.scenarioId;
    this.seed = a.scenario.seed;
    this.tEnd = this.def.durationS + this.def.clearingS;
    this.controller = a.controller;
    this.policy = (a.controller as { policy?: Policy }).policy ?? G0;
    const params = this.policy.params ?? G0.params;
    this.maxHoldS = Math.min(this.cfg.limits.maxHoldS, params.maxHoldS ?? this.cfg.limits.maxHoldS);
    this.trainDwellEst = params.trainDefaultDwellS ?? this.cfg.train.defaultDwellS;
    this.forceIt = hooks.itinerary;
    const map = this.map;

    for (const z of map.zones) { this.doors.set(z.id, z.door); this.zoneName.set(z.id, z.name); }

    // places: stops (map order) then platforms (travel order)
    for (const s of map.stops) {
      const idx = this.places.length;
      this.placeOfStop.set(s.id, idx);
      this.places.push({
        idx, at: { kind: 'stop', id: s.id }, pos: s.p, name: s.name, stopId: s.id, stationId: s.stationId ?? null,
        queue: [], counts: [0, 0, 0, 0], lastDep: [NONE, NONE, NONE, NONE], served: 0, paired: -1,
      });
    }
    this.stations = map.rail.stations;
    this.stationPlace = this.stations.map((st) => {
      const idx = this.places.length;
      this.placeOfStation.set(st.id, idx);
      this.places.push({
        idx, at: { kind: 'platform', id: st.id }, pos: st.platform, name: st.name, stopId: null, stationId: st.id,
        queue: [], counts: [0, 0, 0, 0], lastDep: [NONE, NONE, NONE, NONE], served: 1 << TRAIN, paired: -1,
      });
      const sp = this.placeOfStop.get(st.stopId);
      if (sp !== undefined) { this.places[idx]!.paired = sp; this.places[sp]!.paired = idx; }
      return idx;
    });

    // routes (id order)
    for (const r of [...map.routes].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))) {
      const stopPlace = r.stops.map((s) => this.placeOfStop.get(s) ?? -1);
      const rt: RouteRt = {
        id: r.id, m: MI[r.id], route: r, stopPlace, uniquePlaces: [...new Set(stopPlace.filter((p) => p >= 0))],
        profile: pathProfile(map, 'route:' + r.id, r.path), lastTerminalDep: NONE,
      };
      for (const p of rt.uniquePlaces) this.places[p]!.served |= 1 << rt.m;
      this.routes.push(rt);
      this.routeRt.set(r.id, rt);
      this.routeIds.push(r.id);
    }

    // buses b1..bN by allocation (route id order), filled round-robin if the allocation is short
    const order: RouteRt[] = [];
    for (const rt of this.routes) for (let i = 0; i < Math.max(0, Math.floor(params.allocation?.[rt.id] ?? 0)); i++) order.push(rt);
    for (let i = 0; order.length < this.cfg.bus.count && this.routes.length; i++) order.push(this.routes[i % this.routes.length]!);
    const addBus = (rt: RouteRt, phase: Phase) => {
      const b: Bus = {
        id: `b${this.buses.length + 1}`, r: rt, phase, pos: 0, stopIdx: 0, riders: [], alightQ: [], served: 0, budget: 0,
        holdUntil: 0, holdUsedS: 0, layoverStart: 0, dead: null, reassigned: false, decidedAt: -1,
        pendingHold: null, pendingReassign: null, lastDecision: null, fromDepot: false,
      };
      this.buses.push(b);
      this.busById.set(b.id, b);
    };
    for (const rt of order.slice(0, this.cfg.bus.count)) addBus(rt, 'layover');
    // reserves b7, b8, … parked in the depot (their route is a placeholder until deployed)
    this.depotRoute = this.routeRt.get(DEPOT.fromRoute)?.id ?? this.routes[0]?.id ?? null;
    if (this.routes.length) {
      const home = this.routeRt.get(this.depotRoute!)!;
      for (let i = 0; i < Math.max(0, Math.floor(this.cfg.bus.reserve ?? 0)); i++) addBus(home, 'depot');
    }

    // the train starts at the first station in travel order
    const st0 = this.stations[0];
    this.train = {
      id: 't1', phase: 'arrive', pos: st0 ? st0.dist : 0, stationIdx: 0, remaining: 0, riders: [], arrivalT: 0,
      departAt: null, delayDone: false, decided: false, departures: 0, lastA: 0, lastB: 0, transfersAlighted: 0,
      pendingDwell: null, lastDecision: null,
    };

    // pre-drawn randomness: traffic table and train delays (demand is drawn by the passenger generator)
    const pert = this.def.perturb;
    const tr = stream(this.seed, 'traffic');
    const periods = Math.ceil(this.tEnd / 300) + 1;
    this.traffic = [];
    for (let p = 0; p < periods; p++) {
      const row = new Float64Array(map.roads.edges.length);
      for (let e = 0; e < row.length; e++) row[e] = tr.range(pert.trafficScale[0], pert.trafficScale[1]);
      this.traffic.push(row);
    }
    const td = stream(this.seed, 'train');
    this.delays = [];
    for (let j = 0; j < TRAIN_DELAY_SLOTS; j++) {
      const u = td.next();
      const x = td.int(pert.trainDelay.extraS[0], pert.trainDelay.extraS[1]);
      this.delays.push(u < pert.trainDelay.chance ? x : 0);
    }
    this.cong = pert.stadiumCongestion;
    this.congCenter = map.neighborhoods.find((n) => n.id === 'stadium')?.center ?? null;

    // passengers, planner, collector
    this.planner = (hooks.planner ?? createTripPlanner)(map, this.cfg);
    const specs = (hooks.passengers ?? generatePassengers)(map, this.def, this.seed, this.cfg);
    this.specs = [...specs].sort((x, y) => x.spawnT - y.spawnT || x.id - y.id);
    for (const spec of this.specs) {
      const door = this.doors.get(spec.origin) ?? { x: 0, z: 0 };
      this.pax[spec.id] = {
        spec, it: null, legIdx: 0, state: 'pending', pos: door, walkFrom: door, walkTo: door, t0: 0, t1: 0, walkKind: 'leg',
        place: -1, joinT: 0, mask: 0, leftBehind: false, vehicle: null, alightPlace: -1, lastMode: null,
        vehicleLegsDone: 0, boardedLeg: -1, reconsidered: false, arriveT: -1,
      };
    }
    this.walkEnds = new Array(this.tEnd + 1);
    this.patienceAt = new Array(this.tEnd + 1);
    this.collector = (hooks.collector ?? createCollector)({
      map, scenario: this.def, seed: this.seed, cfg: this.cfg, targetHeadwayS: (r) => this.targetHeadwayOf(r),
    });

    for (const d of a.decisions ?? []) this.replayDecisions.set(d.dpId, d.action);
    for (const x of a.intents ?? []) this.logIntent(x.t, x.intent);
  }

  // ================================================================ Sim API
  step(): { pending: DecisionPoint | null } {
    if (this.pending) return { pending: this.pending.dp };
    if (this.done) return { pending: null };
    if (this.cursor < 0) { this.beginTick(); this.cursor = 0; }
    const nb = this.buses.length;   // fixed for the run (reserves are buses from the start)
    const n = nb + 2;               // buses, the train, the depot
    while (this.cursor < n) {
      const vi = this.cursor++;
      const dp = vi < nb ? this.busTick(this.buses[vi]!) : vi === nb ? this.trainTick() : this.depotTick();
      if (!dp) continue;
      const dec = this.resolveNow(dp);
      if (dec) this.apply(dp, dec, false);
      else { this.requestAsync(dp); return { pending: dp }; }
    }
    this.endTick();
    this.cursor = -1;
    return { pending: null };
  }

  resolve(dpId: number, decision: Decision): void {
    const p = this.pending;
    if (!p || p.dp.id !== dpId) return;
    this.pending = null;
    this.apply(p.dp, decision, true);
    p.release();
  }

  intent(i: Intent): void {
    if (this.done || !i || typeof i !== 'object') return;
    this.logIntent(this.cursor >= 0 ? this.t + 1 : this.t, i);
  }

  /** Resolves once the pending async decision (if any) has been resolved. */
  waitPending(): Promise<void> { return this.pending ? this.pending.wait : Promise.resolve(); }

  observe(): Observation {
    const t = this.t;
    const cap = this.cfg.bus.capacity;
    const buses = this.buses.filter((b) => b.phase !== 'depot').map((b) => {
      const n = b.r.route.stops.length;
      const nextIdx = this.nextStopIdx(b);
      const gaps = this.busGaps(b);
      return {
        id: b.id, routeId: b.r.id, state: STATE[b.phase], onboard: b.riders.length, capacity: cap,
        nextStopId: n ? b.r.route.stops[nextIdx]! : null,
        etaNextStopS: n ? Math.round(this.etaBus(b, nextIdx)) : null,
        holdUntil: this.holdUntilOf(b),
        headwayAheadS: gaps.ahead, headwayBehindS: gaps.behind, holdUsedS: b.holdUsedS,
      };
    });
    const tr = this.train;
    const sp = this.stationPlace[tr.stationIdx] ?? -1;
    let alightingNext = 0;
    const transfersNext: Partial<Record<RouteId, number>> = {};
    for (const pid of tr.riders) {
      const p = this.pax[pid]!;
      if (p.alightPlace !== sp) continue;
      alightingNext++;
      const nl = this.nextVehicleLeg(p, p.legIdx + 1);
      if (nl?.kind === 'bus') for (const r of nl.routes) transfersNext[r] = (transfersNext[r] ?? 0) + 1;
    }
    const platformQueue = {} as Record<StationId, number>;
    this.stations.forEach((st, i) => { platformQueue[st.id] = this.places[this.stationPlace[i]!]!.queue.length; });
    return {
      t, phase: t < this.def.durationS ? 'running' : 'clearing',
      scenario: {
        id: this.def.id, kind: this.def.kind, name: this.def.name, clockStart: this.def.clockStart,
        durationS: this.def.durationS, clearingS: this.def.clearingS, advertised: this.def.advertised,
      },
      buses,
      train: {
        state: tr.phase === 'move' ? 'moving' : 'dwelling',
        stationId: (this.stations[tr.stationIdx]?.id ?? 'stn_stadium') as StationId,
        etaS: tr.phase === 'move' ? Math.round(this.etaTrain(tr.stationIdx)) : 0,
        onboard: tr.riders.length, capacity: this.cfg.train.capacity,
        departAt: tr.phase === 'dwell' ? tr.departAt : null,
        alightingNext, transfersNext, platformQueue,
      },
      stops: this.map.stops.map((s) => {
        const pl = this.places[this.placeOfStop.get(s.id)!]!;
        const queueByRoute: Partial<Record<RouteId, number>> = {};
        const lastDepartureT: Partial<Record<RouteId, number>> = {};
        for (const rt of this.routes) {
          if (!(pl.served & (1 << rt.m))) continue;
          queueByRoute[rt.id] = pl.counts[rt.m]!;
          if (pl.lastDep[rt.m]! > NONE) lastDepartureT[rt.id] = pl.lastDep[rt.m]!;
        }
        return { id: s.id, queue: pl.queue.length, queueByRoute, longestWaitS: this.longestWait(pl), lastDepartureT };
      }),
      routes: this.routes.map((rt) => ({
        id: rt.id, buses: this.buses.filter((b) => b.r === rt && b.phase !== 'depot').map((b) => b.id),
        targetHeadwayS: this.targetHeadway(rt), queue: this.routeQueue(rt.id),
      })),
      running: this.collector.running(),
      depot: {
        reserves: this.buses.filter((b) => b.phase === 'depot').map((b) => b.id),
        deploying: this.buses.filter((b) => b.fromDepot).map((b) => b.id),
      },
    };
  }

  snapshot(): SimSnapshot {
    const t = this.t;
    // Depot buses (state 'depot'): parked → routeId null, holdUntil null; pulling out → routeId = its new route,
    // holdUntil = when it reaches Central. Both sit at dist 0 of the depot route's path (Central) for path-only renderers.
    const vehicles: VehicleView[] = this.buses.map((b) => {
      const inDepot = b.phase === 'depot' || b.phase === 'depotOut';
      return {
        id: b.id, kind: 'bus', routeId: b.phase === 'depot' ? null : b.r.id,
        path: inDepot ? { kind: 'route', routeId: this.depotRoute ?? b.r.id }
          : b.phase === 'deadhead' && b.dead ? { kind: 'deadhead', from: b.dead.from, to: b.dead.to } : { kind: 'route', routeId: b.r.id },
        dist: inDepot ? 0 : b.pos, state: STATE[b.phase], onboard: b.riders.length, capacity: this.cfg.bus.capacity,
        nextStopId: b.phase !== 'depot' && b.r.route.stops.length ? b.r.route.stops[this.nextStopIdx(b)]! : null,
        holdUntil: this.holdUntilOf(b), lastDecision: b.lastDecision,
      };
    });
    const tr = this.train;
    vehicles.push({
      id: tr.id, kind: 'train', routeId: null, path: { kind: 'rail' }, dist: tr.pos,
      state: tr.phase === 'move' ? 'moving' : 'dwelling', onboard: tr.riders.length, capacity: this.cfg.train.capacity,
      nextStopId: null, holdUntil: tr.phase === 'dwell' ? tr.departAt : null, lastDecision: tr.lastDecision,
    });
    const slot = new Map<number, number>();
    for (const pl of this.places) pl.queue.forEach((pid, i) => slot.set(pid, i));
    const people: PersonView[] = [];
    for (let i = 0; i < this.spawnPtr; i++) {
      const p = this.pax[this.specs[i]!.id]!;
      const tint = p.spec.tint;
      if (p.state === 'walking') people.push({ id: p.spec.id, state: 'walking', tint, from: p.walkFrom, to: p.walkTo, t0: p.t0, t1: p.t1 });
      else if (p.state === 'waiting') people.push({ id: p.spec.id, state: 'waiting', tint, at: this.places[p.place]!.at, slot: slot.get(p.spec.id) ?? 0, since: p.joinT });
      else if (p.state === 'arrived' && t - p.arriveT <= ARRIVED_KEEP_S) people.push({ id: p.spec.id, state: 'arrived', tint, to: p.pos, t1: p.arriveT });
    }
    const queues: QueueView[] = this.places.map((pl) => {
      const longestWaitS = this.longestWait(pl);
      const count = pl.queue.length;
      const severity = longestWaitS >= 600 || count >= 40 ? 'bad' : longestWaitS >= 300 || count >= 15 ? 'warn' : 'ok';
      return { at: pl.at, count, longestWaitS, severity };
    });
    const events = this.events;
    this.events = [];
    return {
      t, phase: this.done ? 'done' : t < this.def.durationS ? 'running' : 'clearing',
      vehicles, people, queues, running: this.collector.running(), events,
    };
  }

  passenger(id: number): PassengerInfo | null {
    const p = this.pax[id];
    if (!p || p.state === 'pending' || !p.it) return null;
    return {
      id, origin: p.spec.origin, dest: p.spec.dest, itinerary: p.it, legIndex: p.legIdx,
      status: p.state === 'walking' && p.walkKind === 'walkaway' ? 'walking away' : p.state,
      waitedS: p.state === 'waiting' ? this.t - p.joinT : 0, patienceS: p.spec.patienceS, reason: this.reason(p),
    };
  }

  result(): RunResult {
    if (this.cached) return this.cached;
    const unfinished: Array<{ pid: number; spawnT: number }> = [];
    const upto = this.done ? this.specs.length : this.spawnPtr;
    for (let i = 0; i < upto; i++) {
      const spec = this.specs[i]!;
      if (this.pax[spec.id]!.state !== 'arrived') unfinished.push({ pid: spec.id, spawnT: spec.spawnT });
    }
    unfinished.sort((x, y) => x.pid - y.pid);
    const r = this.collector.finalize(this.done ? this.tEnd : this.t, unfinished, {
      controller: this.controllerRef(), simVersion: this.cfg.simVersion, mapVersion: this.map.version,
      scenarioId: this.scenarioId, seed: this.seed,
    });
    if (this.done) this.cached = r;
    return r;
  }

  replay(): Replay {
    const r: Replay = {
      simVersion: this.cfg.simVersion, mapVersion: this.map.version, scenarioId: this.scenarioId, seed: this.seed,
      controller: this.controllerRef(),
    };
    if (this.intentLog.length) r.intents = this.intentLog.map((x) => ({ t: x.t, intent: { ...x.intent } }));
    if (this.captured.length) r.decisions = this.captured.map((x) => ({ dpId: x.dpId, action: { ...x.action } }));
    return r;
  }

  /** The §6 feature vector for a vehicle right now (what the HUD inspector shows). */
  featuresFor(kind: DecisionKind, vehicleId: string): FeatureVector {
    if (kind === 'train_at_station') return this.featTrain();
    if (kind === 'depot_check') return this.featDepot();
    const b = this.busById.get(vehicleId);
    if (!b) return {};
    return kind === 'bus_at_stop' ? this.featStop(b) : this.featTerminal(b);
  }

  // ================================================================ tick phases
  private beginTick(): void {
    const t = this.t;
    const intents = this.intentsAt.get(t);
    if (intents) { this.intentsAt.delete(t); for (const i of intents) this.applyIntent(i); }
    while (this.spawnPtr < this.specs.length && this.specs[this.spawnPtr]!.spawnT <= t) this.spawn(this.specs[this.spawnPtr++]!);
    const ends = this.walkEnds[t];
    if (ends) {
      this.walkEnds[t] = undefined;
      ends.sort((x, y) => x - y);
      for (const pid of ends) {
        const p = this.pax[pid]!;
        if (p.state === 'walking' && p.t1 === t) this.walkEnd(p);
      }
    }
  }

  private endTick(): void {
    const t = this.t;
    const due = this.patienceAt[t];
    if (due) {
      this.patienceAt[t] = undefined;
      due.sort((x, y) => x - y);
      for (const pid of due) this.checkPatience(this.pax[pid]!);
    }
    if (t % QUEUE_SAMPLE_S === 0) {
      for (const pl of this.places) {
        const by: Partial<Record<Mode, number>> = {};
        if (pl.stationId && !pl.stopId) by.train = pl.counts[TRAIN]!;
        else for (const rt of this.routes) if (pl.served & (1 << rt.m)) by[rt.id] = pl.counts[rt.m]!;
        this.collector.queueSample(t, pl.at, by);
      }
    }
    this.t = t + 1;
    if (this.t >= this.tEnd) this.done = true;
  }

  // ================================================================ passengers
  private spawn(spec: PassengerSpec): void {
    const p = this.pax[spec.id]!;
    let it: Itinerary | null = null;
    try { it = this.forceIt?.(spec) ?? this.planner.plan(spec); } catch { it = null; }
    if (!it || !Array.isArray(it.legs)) {
      const to = this.doors.get(spec.dest) ?? p.pos;
      it = { legs: [{ kind: 'walk', from: p.pos, to, durationS: this.walkS(p, p.pos, to) }], expectedCostS: 0, transfers: 0 };
    }
    p.it = it;
    p.legIdx = 0;
    this.collector.spawn(spec.id, this.t);
    this.advance(p);
  }

  private walkS(p: Pax, a: Vec2, b: Vec2): number {
    const v = p.spec.walkSpeed > 0 ? p.spec.walkSpeed : this.cfg.walk.meanSpeed;
    return Math.max(1, Math.round((distance(a, b) * this.cfg.walk.detourFactor) / v));
  }

  /** Starts the current leg (and skips through zero-length walks). */
  private advance(p: Pax): void {
    const legs = p.it!.legs;
    for (;;) {
      if (p.legIdx >= legs.length) { this.arrive(p); return; }
      const leg = legs[p.legIdx]!;
      if (leg.kind === 'walk') {
        const dur = Math.max(0, Math.round(leg.durationS));
        if (dur === 0) { p.pos = leg.to; p.legIdx++; continue; }
        this.walk(p, leg.to, dur, 'leg');
        return;
      }
      const pi = this.legPlace(leg);
      if (pi < 0) { p.legIdx++; continue; }
      const place = this.places[pi]!;
      if (distance(p.pos, place.pos) > 0.5) { this.walk(p, place.pos, this.connectS(p, place), 'transfer'); return; }
      this.join(p, place, leg, false, p.lastMode);
      return;
    }
  }

  /** Walk to a boarding place; a station transfer (from the paired platform / stop) is capped like the planner's. */
  private connectS(p: Pax, place: Place): number {
    const s = this.walkS(p, p.pos, place.pos);
    const other = place.paired >= 0 ? this.places[place.paired]! : null;
    return other && distance(p.pos, other.pos) <= 0.5 ? Math.min(STATION_TRANSFER_WALK_S, s) : s;
  }

  private legPlace(leg: Leg): number {
    if (leg.kind === 'bus') return this.placeOfStop.get(leg.board) ?? -1;
    if (leg.kind === 'train') return this.placeOfStation.get(leg.board) ?? -1;
    return -1;
  }

  private walk(p: Pax, to: Vec2, dur: number, kind: Pax['walkKind']): void {
    p.state = 'walking';
    p.walkFrom = p.pos;
    p.walkTo = to;
    p.t0 = this.t;
    p.t1 = this.t + dur;
    p.walkKind = kind;
    if (p.t1 <= this.tEnd) (this.walkEnds[p.t1] ??= []).push(p.spec.id);
    const between = kind === 'transfer' || (kind === 'leg' && p.vehicleLegsDone > 0 && this.nextVehicleLeg(p, p.legIdx + 1) !== null);
    if (between) this.transferWalkers.add(p.spec.id);
  }

  private walkEnd(p: Pax): void {
    p.pos = p.walkTo;
    this.transferWalkers.delete(p.spec.id);
    if (p.walkKind === 'walkaway') { this.arrive(p); return; }
    if (p.walkKind === 'leg') { p.legIdx++; this.advance(p); return; }
    const leg = p.it!.legs[p.legIdx];
    const pi = leg ? this.legPlace(leg) : -1;
    if (!leg || pi < 0) { p.legIdx++; this.advance(p); return; }
    this.join(p, this.places[pi]!, leg, false, p.lastMode);
  }

  private join(p: Pax, place: Place, leg: Leg, front: boolean, transferFrom: Mode | null): void {
    let accepts: Mode[];
    if (leg.kind === 'train') accepts = ['train'];
    else if (leg.kind === 'bus') {
      accepts = leg.routes.filter((r) => (place.served & (1 << MI[r])) !== 0);
      if (!accepts.length) accepts = [...leg.routes];
    } else accepts = [];
    p.mask = 0;
    for (const m of accepts) p.mask |= 1 << MI[m];
    p.state = 'waiting';
    p.place = place.idx;
    p.joinT = this.t;
    p.leftBehind = false;
    if (front) place.queue.unshift(p.spec.id);
    else place.queue.push(p.spec.id);
    this.count(place, p.mask, 1);
    const e = this.collector.queueJoin(p.spec.id, place.at, accepts, transferFrom, this.t);
    if (e) this.ev(e);
    if (!p.reconsidered) {
      const at = this.t + Math.floor(p.spec.patienceS) + 1;
      if (at <= this.tEnd) (this.patienceAt[at] ??= []).push(p.spec.id);
    }
  }

  private count(place: Place, mask: number, d: number): void {
    for (let m = 0; m < 4; m++) if (mask & (1 << m)) place.counts[m]! += d;
  }

  private unqueue(place: Place, qi: number): number {
    const pid = place.queue[qi]!;
    place.queue.splice(qi, 1);
    this.count(place, this.pax[pid]!.mask, -1);
    return pid;
  }

  private firstAcceptor(place: Place, m: number): number {
    if (place.counts[m]! <= 0) return -1;
    const bit = 1 << m;
    const q = place.queue;
    for (let i = 0; i < q.length; i++) if (this.pax[q[i]!]!.mask & bit) return i;
    return -1;
  }

  private arrive(p: Pax): void {
    p.state = 'arrived';
    p.arriveT = this.t;
    this.transferWalkers.delete(p.spec.id);
    this.collector.arrive(p.spec.id, this.t);
    this.ev({ t: this.t, kind: 'arrive', personId: p.spec.id });
  }

  private checkPatience(p: Pax): void {
    if (p.state !== 'waiting' || p.reconsidered) return;
    const waited = this.t - p.joinT;
    if (!(waited > p.spec.patienceS)) return;
    p.reconsidered = true;
    const place = this.places[p.place]!;
    let leg: Extract<Leg, { kind: 'walk' }> | null = null;
    try { leg = this.planner.reconsider(p.spec, place.pos, waited, p.it!.legs.slice(p.legIdx)); } catch { leg = null; }
    if (!leg) return;
    const qi = place.queue.indexOf(p.spec.id);
    if (qi < 0) return;
    this.unqueue(place, qi);
    this.collector.walkaway(p.spec.id, place.at, this.t);
    this.ev({ t: this.t, kind: 'walkaway', personId: p.spec.id, at: place.at });
    p.legIdx = p.it!.legs.length;
    const dur = Math.max(0, Math.round(leg.durationS));
    if (dur === 0) { p.pos = leg.to; this.arrive(p); } else this.walk(p, leg.to, dur, 'walkaway');
  }

  private nextVehicleLeg(p: Pax, from: number): Leg | null {
    const legs = p.it?.legs ?? [];
    for (let i = from; i < legs.length; i++) if (legs[i]!.kind !== 'walk') return legs[i]!;
    return null;
  }

  /** Boards the queue member at `qi` onto a vehicle. */
  private board(vehicleId: string, mode: Mode, place: Place, qi: number, riders: number[]): void {
    const pid = this.unqueue(place, qi);
    const p = this.pax[pid]!;
    const leg = p.it!.legs[p.legIdx];
    p.state = 'riding';
    p.vehicle = vehicleId;
    p.alightPlace = leg && leg.kind !== 'walk'
      ? (leg.kind === 'bus' ? this.placeOfStop.get(leg.alight) : this.placeOfStation.get(leg.alight)) ?? -1
      : -1;
    const wasTransfer = p.vehicleLegsDone > 0 && p.boardedLeg !== p.legIdx;
    p.boardedLeg = p.legIdx;
    riders.push(pid);
    this.ev({ t: this.t, kind: 'board', personId: pid, vehicleId, at: place.at });
    const e = this.collector.board(pid, vehicleId, mode, place.at, this.t, this.t - p.joinT, wasTransfer);
    if (e) this.ev(e);
  }

  private alight(vehicleId: string, mode: Mode, place: Place, pid: number): void {
    const p = this.pax[pid]!;
    p.vehicle = null;
    p.lastMode = mode;
    p.vehicleLegsDone++;
    p.pos = place.pos;
    this.ev({ t: this.t, kind: 'alight', personId: pid, vehicleId, at: place.at });
    this.collector.alight(pid, vehicleId, place.at, this.t);
    p.legIdx++;
    this.advance(p);
  }

  // ================================================================ buses
  private mult(prof: PathProfile, d: number): number {
    const i = binAt(prof, d);
    const e = prof.edge[i]!;
    const row = this.traffic[Math.min(Math.floor(this.t / 300), this.traffic.length - 1)];
    let m = e >= 0 && row ? row[e]! : 1;
    const c = this.cong;
    if (c && this.congCenter && this.t >= c.fromT && this.t < c.toT && this.near(prof)[i]) m *= c.speedScale;
    return m;
  }

  private near(prof: PathProfile): Uint8Array {
    let f = this.nearCache.get(prof);
    if (!f) {
      const c = this.cong!;
      const ctr = this.congCenter!;
      f = new Uint8Array(prof.pts.length);
      prof.pts.forEach((p, i) => { f![i] = distance(p, ctr) <= c.radius ? 1 : 0; });
      this.nearCache.set(prof, f);
    }
    return f;
  }

  private busTick(b: Bus): DecisionPoint | null {
    const t = this.t;
    if (b.phase === 'depot') return null;
    if (b.phase === 'depotOut') {
      if (t < b.holdUntil) return null;
      this.leaveDepot(b);
    }
    if (b.phase === 'move') {
      const route = b.r.route;
      const n = route.stops.length;
      const target = b.stopIdx < n ? route.stopDist[b.stopIdx]! : route.path.length;
      const ds = this.cfg.bus.speed * this.mult(b.r.profile, b.pos);
      this.collector.distance(b.id, Math.min(ds, Math.max(0, target - b.pos)), false);
      if (b.pos + ds >= target - 1e-9) {
        if (b.stopIdx >= n) { b.pos = 0; b.stopIdx = 0; this.enterStop(b, 'arrive'); }
        else { b.pos = target; this.enterStop(b, 'serve'); }
      } else b.pos += ds;
    } else if (b.phase === 'deadhead' && b.dead) {
      const L = b.dead.path.length;
      const ds = this.cfg.bus.speed * this.mult(b.dead.profile, b.pos);
      this.collector.distance(b.id, Math.min(ds, Math.max(0, L - b.pos)), true);
      if (b.pos + ds >= L - 1e-9) { b.dead = null; b.pos = 0; b.stopIdx = 0; b.phase = 'layover'; b.layoverStart = t; b.fromDepot = false; }
      else b.pos += ds;
    }
    switch (b.phase) {
      case 'arrive':
        this.service(b, true);
        if (!b.alightQ.length) { b.phase = 'layover'; b.layoverStart = t; }
        break;
      case 'serve':
        this.service(b, false);
        if (this.serviceDone(b)) return this.raise('bus_at_stop', b);
        break;
      case 'shold':
        this.service(b, false);
        if (t >= b.holdUntil && this.serviceDone(b)) this.departStop(b);
        break;
      case 'board0':
        this.service(b, false);
        if (this.serviceDone(b)) this.departTerminal(b);
        break;
      case 'b0hold':
        this.service(b, false);
        if (t >= b.holdUntil && this.serviceDone(b)) this.departTerminal(b);
        break;
      case 'thold':
        if (t >= b.holdUntil) b.phase = 'layover';
        break;
      default:
        break;
    }
    if (b.phase === 'layover' && b.decidedAt !== t) {
      if (t - b.layoverStart >= this.cfg.limits.maxLayoverS) {
        this.recordNow('bus_at_terminal', b.id, this.featTerminal(b), { type: 'dispatch' },
          `Layover limit (${this.cfg.limits.maxLayoverS}s): dispatching`, 'default', 'max-layover');
        this.dispatch(b);
        return null;
      }
      return this.raise('bus_at_terminal', b);
    }
    return null;
  }

  private busPlace(b: Bus): Place { return this.places[b.r.stopPlace[b.stopIdx] ?? b.r.stopPlace[0]!]!; }

  private enterStop(b: Bus, phase: 'arrive' | 'serve'): void {
    b.phase = phase;
    b.served = 0;
    b.budget = 0;
    const pi = this.busPlace(b).idx;
    b.alightQ = b.riders.filter((pid) => this.pax[pid]!.alightPlace === pi);
  }

  /** One second of doors-open service: alighters first, then FIFO boarding of passengers who accept this route. */
  private service(b: Bus, alightOnly: boolean): void {
    const place = this.busPlace(b);
    const { alightS, boardS, capacity } = this.cfg.bus;
    b.served += 1;
    b.budget += 1;
    for (;;) {
      if (b.alightQ.length) {
        if (b.budget + 1e-9 < alightS) break;
        b.budget -= alightS;
        const pid = b.alightQ.shift()!;
        const ri = b.riders.indexOf(pid);
        if (ri < 0) continue;
        b.riders.splice(ri, 1);
        this.alight(b.id, b.r.id, place, pid);
        continue;
      }
      if (alightOnly || b.riders.length >= capacity) break;
      const qi = this.firstAcceptor(place, b.r.m);
      if (qi < 0 || b.budget + 1e-9 < boardS) break;
      b.budget -= boardS;
      this.board(b.id, b.r.id, place, qi, b.riders);
    }
    if (this.busIdle(b, place, alightOnly)) b.budget = 0;
  }

  private busIdle(b: Bus, place: Place, alightOnly: boolean): boolean {
    return b.alightQ.length === 0 && (alightOnly || b.riders.length >= this.cfg.bus.capacity || place.counts[b.r.m]! <= 0);
  }

  private serviceDone(b: Bus): boolean {
    return this.busIdle(b, this.busPlace(b), false) && b.served >= this.cfg.bus.minDwellS;
  }

  private departed(vehicleId: string, mode: Mode, place: Place, onboard: number, cap: number): void {
    const m = MI[mode];
    place.lastDep[m] = this.t;
    this.collector.departure(vehicleId, mode, place.at, this.t, onboard, cap);
    if (onboard >= cap && place.counts[m]! > 0) {
      for (const pid of place.queue) {
        const p = this.pax[pid]!;
        if (!(p.mask & (1 << m))) continue;
        p.leftBehind = true;
        const e = this.collector.leftBehind(pid, place.at, mode, this.t);
        if (e) this.ev(e);
      }
    }
  }

  private departStop(b: Bus): void {
    this.departed(b.id, b.r.id, this.busPlace(b), b.riders.length, this.cfg.bus.capacity);
    b.phase = 'move';
    b.stopIdx += 1;
    b.holdUntil = 0;
  }

  private departTerminal(b: Bus): void {
    this.departed(b.id, b.r.id, this.busPlace(b), b.riders.length, this.cfg.bus.capacity);
    b.phase = 'move';
    b.stopIdx = 1;
    b.pos = 0;
    b.holdUntil = 0;
    b.holdUsedS = 0;
    b.reassigned = false;
  }

  /** Start the next loop: the terminal departure is logged now (headways), then the bus boards and leaves. */
  private dispatch(b: Bus): void {
    b.r.lastTerminalDep = this.t;
    b.phase = 'board0';
    b.served = 0;
    b.budget = 0;
    b.holdUntil = 0;
    b.alightQ = [];
  }

  private reassign(b: Bus, to: RouteId): void {
    const from = b.r.id;
    const dest = this.routeRt.get(to);
    if (!dest) return;
    // through-riders get off at the terminal and wait at the head of its queue (doors close for the deadhead)
    if (b.riders.length) {
      const place = this.busPlace(b);
      const riders = b.riders.splice(0);
      for (const pid of riders) {
        this.ev({ t: this.t, kind: 'alight', personId: pid, vehicleId: b.id, at: place.at });
        this.collector.alight(pid, b.id, place.at, this.t);
        const p = this.pax[pid]!;
        p.vehicle = null;
        p.pos = place.pos;
      }
      for (let i = riders.length - 1; i >= 0; i--) {
        const p = this.pax[riders[i]!]!;
        const leg = p.it!.legs[p.legIdx]!;
        this.join(p, place, leg, true, null);
      }
    }
    let path: Polyline;
    try { path = deadheadPath(this.map, from, to); } catch {
      path = polyline([this.busPlace(b).pos, this.places[dest.stopPlace[0]!]!.pos], false);
    }
    b.r = dest;
    b.reassigned = true;
    b.stopIdx = 0;
    b.pos = 0;
    b.holdUntil = 0;
    b.alightQ = [];
    if (path.length <= 1e-6) { b.phase = 'layover'; b.dead = null; }
    else { b.phase = 'deadhead'; b.dead = { from, to, path, profile: pathProfile(this.map, `dead:${from}>${to}`, path) }; }
  }

  /** Sends a parked reserve out of the depot to `to` (it pulls out for DEPOT.exitS, then joins at Central). */
  private deploy(b: Bus, to: RouteId): void {
    const rt = this.routeRt.get(to);
    if (!rt || b.phase !== 'depot') return;
    b.r = rt;
    b.phase = 'depotOut';
    b.fromDepot = true;
    b.holdUntil = this.t + DEPOT.exitS;
    b.pos = 0;
    b.stopIdx = 0;
    b.reassigned = false;
  }

  /** The deployed reserve reaches Central: a layover there (r1/r2) or a deadhead to its terminal (r3). */
  private leaveDepot(b: Bus): void {
    const from = this.depotRoute ?? b.r.id;
    const path = this.depotPath(b.r.id);
    b.holdUntil = 0;
    b.pos = 0;
    b.stopIdx = 0;
    if (path.length <= 1e-6) { b.phase = 'layover'; b.layoverStart = this.t; b.dead = null; b.fromDepot = false; }
    else { b.phase = 'deadhead'; b.dead = { from, to: b.r.id, path, profile: pathProfile(this.map, `dead:${from}>${b.r.id}`, path) }; }
  }

  /** Road path from the depot's terminal (Central) to route `to`'s terminal (length 0 when shared). */
  private depotPath(to: RouteId): Polyline {
    const from = this.depotRoute ?? to;
    try { return deadheadPath(this.map, from, to); } catch {
      const a = this.routeRt.get(from);
      const b = this.routeRt.get(to);
      return a && b ? polyline([this.places[a.stopPlace[0]!]!.pos, this.places[b.stopPlace[0]!]!.pos], false) : polyline([{ x: 0, z: 0 }, { x: 0, z: 0 }], false);
    }
  }

  /** Parked reserves in id order; `prefer` first when it is still parked. */
  private parked(prefer?: string): Bus | null {
    const p = prefer ? this.busById.get(prefer) : undefined;
    if (p && p.phase === 'depot') return p;
    return this.buses.find((b) => b.phase === 'depot') ?? null;
  }

  private holdUntilOf(b: Bus): number | null {
    return this.isHolding(b) || b.phase === 'depotOut' ? b.holdUntil : null;
  }

  private isHolding(b: Bus): boolean { return b.phase === 'shold' || b.phase === 'thold' || b.phase === 'b0hold'; }

  private nextStopIdx(b: Bus): number {
    const n = Math.max(1, b.r.route.stops.length);
    switch (b.phase) {
      case 'move': return b.stopIdx % n;
      case 'serve': case 'shold': return (b.stopIdx + 1) % n;
      case 'deadhead': case 'depot': case 'depotOut': return 0;
      default: return 1 % n;
    }
  }

  // ================================================================ train
  private trainTick(): DecisionPoint | null {
    const tr = this.train;
    if (!this.stations.length) return null;
    const L = this.map.rail.loop.length;
    if (tr.phase === 'move') {
      const step = Math.min(this.cfg.train.speed, tr.remaining);
      tr.pos = L > 0 ? (tr.pos + step) % L : 0;
      tr.remaining -= step;
      if (tr.remaining <= 1e-9) { tr.pos = this.stations[tr.stationIdx]!.dist; tr.phase = 'arrive'; }
    }
    if (tr.phase === 'arrive') {
      this.trainArrive(tr);
      return this.raise('train_at_station', null);
    }
    if (tr.phase === 'dwell' && tr.decided) {
      this.trainBoard(tr);
      if (tr.departAt !== null && this.t >= tr.departAt) {
        if (!tr.delayDone) {
          tr.delayDone = true;
          const d = this.delays[tr.departures % TRAIN_DELAY_SLOTS] ?? 0;
          if (d > 0) { tr.departAt += d; return null; }
        }
        this.trainDepart(tr);
      }
    }
    return null;
  }

  private trainArrive(tr: Train): void {
    tr.phase = 'dwell';
    tr.arrivalT = this.t;
    tr.departAt = null;
    tr.delayDone = false;
    tr.decided = false;
    const place = this.places[this.stationPlace[tr.stationIdx]!]!;
    const off = tr.riders.filter((pid) => this.pax[pid]!.alightPlace === place.idx);
    let transfers = 0;
    if (off.length) {
      const set = new Set(off);
      tr.riders = tr.riders.filter((pid) => !set.has(pid));
      for (const pid of off) {
        const p = this.pax[pid]!;
        const nl = this.nextVehicleLeg(p, p.legIdx + 1);
        if (nl?.kind === 'bus' && place.paired >= 0 && this.placeOfStop.get(nl.board) === place.paired) transfers++;
        this.alight(tr.id, 'train', place, pid);
      }
    }
    tr.lastA = off.length;
    tr.lastB = this.trainBoard(tr);
    tr.transfersAlighted = transfers;
  }

  private trainBoard(tr: Train): number {
    const place = this.places[this.stationPlace[tr.stationIdx]!]!;
    let n = 0;
    while (tr.riders.length < this.cfg.train.capacity) {
      const qi = this.firstAcceptor(place, TRAIN);
      if (qi < 0) break;
      this.board(tr.id, 'train', place, qi, tr.riders);
      n++;
    }
    return n;
  }

  private trainDepart(tr: Train): void {
    const place = this.places[this.stationPlace[tr.stationIdx]!]!;
    this.departed(tr.id, 'train', place, tr.riders.length, this.cfg.train.capacity);
    this.collector.trainDwell(this.t - tr.arrivalT);
    tr.departures++;
    tr.phase = 'move';
    tr.departAt = null;
    tr.stationIdx = (tr.stationIdx + 1) % this.stations.length;
    const L = this.map.rail.loop.length;
    tr.remaining = fwd(tr.pos, this.stations[tr.stationIdx]!.dist, L);
    if (tr.remaining <= 1e-9) tr.remaining = L;
  }

  private setDeparture(tr: Train, dwellS: number): void {
    const { minDwellS, maxDwellS, boardS, alightS } = this.cfg.train;
    const dwell = clamp(dwellS, minDwellS, maxDwellS);
    const busy = Math.ceil(alightS * tr.lastA + boardS * tr.lastB);
    tr.departAt = tr.arrivalT + Math.min(maxDwellS, Math.max(dwell, busy));
    tr.decided = true;
  }

  // ================================================================ decisions
  private raise(kind: DecisionKind, b: Bus | null): DecisionPoint {
    const dp: DecisionPoint = { id: ++this.dpSeq, t: this.t, kind, vehicleId: b ? b.id : this.train.id, features: {} };
    if (b) {
      b.decidedAt = this.t;
      dp.routeId = b.r.id;
      dp.stopId = b.r.route.stops[b.stopIdx] ?? b.r.route.stops[0];
      dp.features = kind === 'bus_at_stop' ? this.featStop(b) : this.featTerminal(b);
    } else {
      dp.stationId = this.stations[this.train.stationIdx]!.id;
      dp.features = this.featTrain();
    }
    return dp;
  }

  /** Replay decision → pending human intent → sync controller. Null means "ask the async controller". */
  private resolveNow(dp: DecisionPoint): Decision | null {
    const rep = this.replayDecisions.get(dp.id);
    if (rep) return { action: rep, ruleId: 'replay', explanation: 'Replayed decision', source: 'replay' };
    const human = this.humanDecision(dp);
    if (human) return human;
    if (this.controller.async) return null;
    try {
      return (this.controller as Controller).decide(dp, this.observe());
    } catch {
      return this.fallback(dp, 'Controller error');
    }
  }

  private humanDecision(dp: DecisionPoint): Decision | null {
    if (dp.kind === 'train_at_station') {
      const d = this.train.pendingDwell;
      if (d === null) return null;
      this.train.pendingDwell = null;
      return { action: { type: 'setTrainDeparture', dwellS: d }, ruleId: 'human', explanation: `Dispatcher: train leaves ${d}s after arrival`, source: 'human' };
    }
    const b = this.busById.get(dp.vehicleId);
    if (!b) return null;
    if (dp.kind === 'bus_at_stop' && b.pendingHold !== null) {
      const s = b.pendingHold;
      b.pendingHold = null;
      return { action: { type: 'hold', seconds: s }, ruleId: 'human', explanation: `Dispatcher hold: ${s}s`, source: 'human' };
    }
    if (dp.kind === 'bus_at_terminal' && b.pendingReassign !== null) {
      const to = b.pendingReassign;
      b.pendingReassign = null;
      if (!b.reassigned && resolveAction({ type: 'reassign', to }, this.rctx(dp))) {
        return { action: { type: 'reassign', to }, ruleId: 'human', explanation: `Dispatcher: move to ${routeLabel([to])}`, source: 'human' };
      }
    }
    return null;
  }

  private fallback(dp: DecisionPoint, why: string): Decision {
    const ctx = this.rctx(dp);
    const action = resolveAction(this.policy.defaults?.[dp.kind], ctx) ?? safeAction(dp.kind, this.cfg.train.defaultDwellS);
    return { action, ruleId: 'default', explanation: `${why}: ${defaultExplanation(action)}`, source: 'fallback' };
  }

  private requestAsync(dp: DecisionPoint): void {
    let release!: () => void;
    const wait = new Promise<void>((res) => { release = res; });
    this.pending = { dp, wait, release };
    let pr: Promise<Decision>;
    try { pr = Promise.resolve((this.controller as AsyncController).decide(dp, this.observe())); } catch (e) { pr = Promise.reject(e); }
    pr.then(
      (d) => this.resolve(dp.id, d && typeof d === 'object' ? d : this.fallback(dp, 'Advisor unavailable')),
      () => this.resolve(dp.id, this.fallback(dp, 'Advisor unavailable')),
    );
  }

  private rctx(dp: { kind: DecisionKind; features: FeatureVector; routeId?: RouteId }): ResolveCtx {
    const lim = this.cfg.limits;
    return {
      kind: dp.kind, features: dp.features, routeId: dp.routeId, routeIds: this.routeIds,
      routeQueue: (r) => this.routeQueue(r), maxHoldS: this.maxHoldS, maxHoldPerLoopS: lim.maxHoldPerLoopS,
      maxLayoverS: lim.maxLayoverS, minBusesPerRoute: lim.minBusesPerRoute,
      trainMinDwellS: this.cfg.train.minDwellS, trainMaxDwellS: this.cfg.train.maxDwellS,
    };
  }

  /** Applies a decision (clamped; inapplicable → the policy default), records it. */
  private apply(dp: DecisionPoint, dec: Decision, fromAsync: boolean): void {
    const ctx = this.rctx(dp);
    const b = dp.kind === 'train_at_station' ? null : this.busById.get(dp.vehicleId) ?? null;
    const ok = (x: Action | null) => (x && x.type === 'reassign' && b?.reassigned ? null : x);
    let eff = ok(resolveAction(dec?.action, ctx));
    let d: Decision;
    if (eff) {
      d = { action: eff, ruleId: dec.ruleId ?? 'unknown', explanation: dec.explanation ?? '', source: dec.source ?? 'policy' };
    } else {
      eff = ok(resolveAction(this.policy.defaults?.[dp.kind], ctx)) ?? safeAction(dp.kind, this.cfg.train.defaultDwellS);
      d = { action: eff, ruleId: 'default', explanation: defaultExplanation(eff), source: dec?.source === 'fallback' ? 'fallback' : 'default' };
    }
    if (fromAsync || dec?.source === 'replay') this.captured.push({ dpId: dp.id, action: eff });
    this.record(dp, d);
    if (dp.kind === 'train_at_station') {
      this.setDeparture(this.train, eff.type === 'setTrainDeparture' ? eff.dwellS : this.cfg.train.defaultDwellS);
      return;
    }
    if (!b) return;
    if (dp.kind === 'bus_at_stop') {
      if (eff.type === 'hold' && 'seconds' in eff) {
        b.phase = 'shold';
        b.holdUntil = this.t + eff.seconds;
        b.holdUsedS += eff.seconds;
        this.collector.hold(b.id, this.busPlace(b).at, eff.seconds, b.riders.length, dp.features.expected_transfers ?? 0, this.t);
      } else this.departStop(b);
      return;
    }
    if (eff.type === 'hold' && 'seconds' in eff) { b.phase = 'thold'; b.holdUntil = this.t + eff.seconds; }
    else if (eff.type === 'reassign' && eff.to !== 'busiest') this.reassign(b, eff.to);
    else this.dispatch(b);
  }

  private record(dp: DecisionPoint, d: Decision): DecisionRecord {
    const rec: DecisionRecord = {
      action: d.action, ruleId: d.ruleId, explanation: d.explanation, source: d.source,
      dpId: dp.id, t: dp.t, kind: dp.kind, vehicleId: dp.vehicleId, features: dp.features,
    };
    this.collector.decision(rec);
    this.ev({ t: dp.t, kind: 'decision', record: rec });
    if (dp.kind === 'train_at_station') this.train.lastDecision = rec;
    else { const b = this.busById.get(dp.vehicleId); if (b) b.lastDecision = rec; }
    return rec;
  }

  /** A decision taken outside a decision point (intents applied immediately, the layover limit). */
  private recordNow(kind: DecisionKind, vehicleId: string, features: FeatureVector, action: Action, explanation: string,
    source: Decision['source'] = 'human', ruleId = 'human'): void {
    this.record({ id: -(++this.nowSeq), t: this.t, kind, vehicleId, features }, { action, ruleId, explanation, source });
  }

  // ================================================================ intents (§5.6)
  private logIntent(t: number, intent: Intent): void {
    const i = { ...intent } as Intent;
    this.intentLog.push({ t, intent: i });
    const list = this.intentsAt.get(t);
    if (list) list.push(i); else this.intentsAt.set(t, [i]);
  }

  private applyIntent(i: Intent): void {
    const t = this.t;
    if (i.type === 'setTrainDeparture') {
      const tr = this.train;
      if (tr.phase === 'dwell' && tr.decided) {
        const ctx = this.rctx({ kind: 'train_at_station', features: this.featTrain() });
        const eff = resolveAction({ type: 'setTrainDeparture', dwellS: i.dwellS }, ctx);
        if (!eff || eff.type !== 'setTrainDeparture') return;
        this.setDeparture(tr, eff.dwellS);
        this.recordNow('train_at_station', tr.id, ctx.features, eff, `Dispatcher: train leaves ${eff.dwellS}s after arrival`);
      } else this.train.pendingDwell = i.dwellS;
      return;
    }
    const b = this.busById.get(i.vehicleId);
    if (!b) return;
    if (i.type === 'hold') {
      if (b.phase === 'serve' || b.phase === 'shold' || b.phase === 'board0' || b.phase === 'b0hold') {
        const f = this.featStop(b);
        const remaining = b.phase === 'shold' || b.phase === 'b0hold' ? Math.max(0, b.holdUntil - t) : 0;
        const used = Math.max(0, b.holdUsedS - remaining);
        const eff = resolveAction({ type: 'hold', seconds: i.seconds }, this.rctx({ kind: 'bus_at_stop', features: { ...f, hold_used_s: used }, routeId: b.r.id }));
        if (!eff || eff.type !== 'hold' || !('seconds' in eff)) return;
        b.holdUsedS = used + eff.seconds;
        b.holdUntil = t + eff.seconds;
        b.phase = b.phase === 'board0' || b.phase === 'b0hold' ? 'b0hold' : 'shold';
        if (eff.seconds > remaining) {
          this.collector.hold(b.id, this.busPlace(b).at, eff.seconds - remaining, b.riders.length, f.expected_transfers ?? 0, t);
        }
        this.recordNow('bus_at_stop', b.id, f, eff, `Dispatcher hold: ${eff.seconds}s`);
      } else if (b.phase === 'thold') {
        const f = this.featTerminal(b);
        const eff = resolveAction({ type: 'hold', seconds: i.seconds }, this.rctx({ kind: 'bus_at_terminal', features: f, routeId: b.r.id }));
        if (!eff || eff.type !== 'hold' || !('seconds' in eff)) return;
        b.holdUntil = t + eff.seconds;
        this.recordNow('bus_at_terminal', b.id, f, eff, `Dispatcher hold: ${eff.seconds}s at the terminal`);
      } else b.pendingHold = i.seconds;
      return;
    }
    if (i.type === 'dispatch') {
      if (b.phase === 'layover' || b.phase === 'thold') {
        this.recordNow('bus_at_terminal', b.id, this.featTerminal(b), { type: 'dispatch' }, 'Dispatcher: start the next loop now');
        this.dispatch(b);
        b.decidedAt = t;
      } else if (b.phase === 'b0hold') {
        this.recordNow('bus_at_terminal', b.id, this.featTerminal(b), { type: 'dispatch' }, 'Dispatcher: leave now');
        b.phase = 'board0';
        b.holdUntil = 0;
      }
      return;
    }
    if (i.type === 'reassign') {
      if (b.phase === 'layover' || b.phase === 'thold') {
        const f = this.featTerminal(b);
        const eff = b.reassigned ? null : resolveAction({ type: 'reassign', to: i.to }, this.rctx({ kind: 'bus_at_terminal', features: f, routeId: b.r.id }));
        if (!eff || eff.type !== 'reassign' || eff.to === 'busiest') return;
        this.recordNow('bus_at_terminal', b.id, f, eff, `Dispatcher: move to ${routeLabel([eff.to])}`);
        this.reassign(b, eff.to);
        b.decidedAt = t;
      } else b.pendingReassign = i.to;
    }
  }

  // ================================================================ features (§6 whitelist)
  private finish(kind: DecisionKind, f: Record<string, number>): FeatureVector {
    const out: FeatureVector = {};
    for (const [k, spec] of Object.entries(FEATURES[kind])) out[k] = clamp(f[k] ?? 0, spec.min, spec.max);
    return out;
  }

  private eventIn(): number {
    let next = Infinity;
    let last = -Infinity;
    for (const e of this.def.advertised) {
      if (e.t >= this.t) next = Math.min(next, e.t - this.t);
      else last = Math.max(last, e.t);
    }
    if (next < Infinity) return clamp(next, -9999, 9999);
    if (last > -Infinity) return clamp(last - this.t, -9999, 9999);
    return 9999;
  }

  private busesOn(r: RouteId): number {
    let n = 0;
    for (const b of this.buses) if (b.r.id === r) n++;
    return n;
  }

  private targetHeadway(rt: RouteRt): number {
    const p = this.policy.params?.targetHeadwayS?.[rt.id];
    const v = typeof p === 'number' && p > 0 ? p : Math.round(rt.route.nominalLoopS / Math.max(1, this.busesOn(rt.id)));
    return clamp(v, 60, 1800);
  }

  private targetHeadwayOf(r: RouteId): number {
    const rt = this.routeRt.get(r);
    return rt ? this.targetHeadway(rt) : 600;
  }

  private routeQueue(r: RouteId): number {
    const rt = this.routeRt.get(r);
    if (!rt) return 0;
    let s = 0;
    for (const pi of rt.uniquePlaces) s += this.places[pi]!.counts[rt.m]!;
    return s;
  }

  private longestWait(pl: Place): number {
    let min = Infinity;
    for (const pid of pl.queue) { const j = this.pax[pid]!.joinT; if (j < min) min = j; }
    return min === Infinity ? 0 : this.t - min;
  }

  private stationIdxOfPlace(pi: number): number { return this.stationPlace.indexOf(pi); }

  private featStop(b: Bus): FeatureVector {
    const rt = b.r;
    const m = rt.m;
    const k = b.stopIdx;
    const n = rt.route.stops.length;
    const place = this.busPlace(b);
    const onboard = b.riders.length;
    const last = place.lastDep[m]!;
    const ahead = last <= NONE ? UNKNOWN_S : clamp(this.t - last, 0, UNKNOWN_S);
    let behind = Infinity;
    for (const o of this.buses) if (o !== b && o.r === rt) behind = Math.min(behind, this.etaBus(o, k));
    const target = this.targetHeadway(rt);
    let trainEta = 9999;
    let expected = 0;
    const si = place.paired >= 0 ? this.stationIdxOfPlace(place.paired) : -1;
    if (si >= 0) {
      const e = this.etaTrain(si);
      trainEta = e > 900 ? 9999 : Math.round(e);
      expected = this.expectedTransfers(si, place.idx, rt.id);
    }
    let down = 0;
    for (let j = 1; j <= 2; j++) {
      const pj = rt.stopPlace[(k + j) % n]!;
      if (pj !== place.idx && pj >= 0) down += this.places[pj]!.counts[m]!;
    }
    return this.finish('bus_at_stop', {
      onboard, load_factor: r3(onboard / this.cfg.bus.capacity), queue_here: place.counts[m]!,
      headway_ahead_s: ahead, headway_behind_s: Number.isFinite(behind) ? Math.round(behind) : UNKNOWN_S,
      target_headway_s: target, headway_ratio: r3(ahead / target), train_eta_s: trainEta, expected_transfers: expected,
      downstream_queue: down, hold_used_s: b.holdUsedS, is_station: place.paired >= 0 ? 1 : 0, event_in_s: this.eventIn(),
    });
  }

  /** Riders who will board `route` at stop place `stopPi`: aboard the train for its paired station, or walking there now. */
  private expectedTransfers(si: number, stopPi: number, route: RouteId): number {
    let n = 0;
    const sp = this.stationPlace[si];
    const wants = (leg: Leg | null) => leg?.kind === 'bus' && leg.routes.includes(route) && this.placeOfStop.get(leg.board) === stopPi;
    for (const pid of this.train.riders) {
      const p = this.pax[pid]!;
      if (p.alightPlace === sp && wants(this.nextVehicleLeg(p, p.legIdx + 1))) n++;
    }
    for (const pid of this.transferWalkers) {
      const p = this.pax[pid]!;
      if (wants(this.nextVehicleLeg(p, p.walkKind === 'transfer' ? p.legIdx : p.legIdx + 1))) n++;
    }
    return n;
  }

  private featTerminal(b: Bus): FeatureVector {
    const rt = b.r;
    const rq = this.routeQueue(rt.id);
    let maxOther = 0;
    for (const o of this.routes) if (o !== rt) maxOther = Math.max(maxOther, this.routeQueue(o.id));
    const last = rt.lastTerminalDep;
    const ahead = last <= NONE ? UNKNOWN_S : clamp(this.t - last, 0, UNKNOWN_S);
    const target = this.targetHeadway(rt);
    return this.finish('bus_at_terminal', {
      route_queue: rq, max_other_route_queue: maxOther, queue_ratio_other: r3(maxOther / Math.max(rq, 1)),
      buses_on_route: this.busesOn(rt.id), headway_ahead_s: ahead, target_headway_s: target,
      headway_ratio: r3(ahead / target), layover_s: this.t - b.layoverStart, event_in_s: this.eventIn(),
    });
  }

  private featTrain(): FeatureVector {
    const tr = this.train;
    const place = this.places[this.stationPlace[tr.stationIdx]!]!;
    let due = 0;
    let minEta = Infinity;
    if (place.paired >= 0) {
      for (const b of this.buses) {
        const k = b.r.stopPlace.indexOf(place.paired);
        if (k < 0) continue;
        const e = this.etaBus(b, k);
        if (e <= 60) due++;
        if (e < minEta) minEta = e;
      }
    }
    return this.finish('train_at_station', {
      onboard: tr.riders.length, platform_queue: place.queue.length, buses_here_or_due_60s: due,
      next_bus_eta_s: Number.isFinite(minEta) ? Math.round(minEta) : UNKNOWN_S, transfers_alighted: tr.transfersAlighted,
      dwell_s: tr.phase === 'move' ? 0 : this.t - tr.arrivalT, event_in_s: this.eventIn(),
    });
  }

  // ================================================================ ETAs (nominal speeds, 20 s per intermediate stop)
  private etaBus(o: Bus, k: number): number {
    const route = o.r.route;
    const sd = route.stopDist;
    const n = sd.length;
    const L = route.path.length;
    const v = this.cfg.bus.speed;
    let at = -1;
    let w = 0;
    switch (o.phase) {
      case 'move': break;
      case 'serve': at = o.stopIdx; w = Math.max(0, this.cfg.bus.minDwellS - o.served); break;
      case 'shold': at = o.stopIdx; w = Math.max(0, o.holdUntil - this.t); break;
      case 'arrive': case 'layover': at = 0; w = NOMINAL_DWELL_S; break;
      case 'thold': at = 0; w = Math.max(0, o.holdUntil - this.t) + NOMINAL_DWELL_S; break;
      case 'board0': at = 0; w = Math.max(0, this.cfg.bus.minDwellS - o.served); break;
      case 'b0hold': at = 0; w = Math.max(0, o.holdUntil - this.t); break;
      case 'deadhead': {
        const rem = Math.max(0, (o.dead?.path.length ?? 0) - o.pos) / v;
        if (k === 0) return rem;
        at = 0;
        w = rem + NOMINAL_DWELL_S;
        break;
      }
    }
    if (at >= 0) {
      if (at === k) return o.phase === 'deadhead' ? w : 0;
      return w + fwd(sd[at]!, sd[k]!, L) / v + ((k - at - 1 + n) % n) * NOMINAL_DWELL_S;
    }
    const next = o.stopIdx % n;
    let d = fwd(o.pos, sd[k]!, L);
    if (k !== next && d < 1e-9) d = L;
    return d / v + ((k - next + n) % n) * NOMINAL_DWELL_S;
  }

  private etaTrain(si: number): number {
    const tr = this.train;
    const st = this.stations;
    const nS = st.length;
    if (!nS) return Infinity;
    const L = this.map.rail.loop.length;
    const v = this.cfg.train.speed;
    const dw = this.trainDwellEst;
    if (tr.phase !== 'move') {
      if (tr.stationIdx === si) return 0;
      const w = Math.max(0, (tr.departAt ?? tr.arrivalT + dw) - this.t);
      return w + fwd(st[tr.stationIdx]!.dist, st[si]!.dist, L) / v + ((si - tr.stationIdx - 1 + nS) % nS) * dw;
    }
    let d = fwd(tr.pos, st[si]!.dist, L);
    if (si !== tr.stationIdx && d < 1e-9) d = L;
    return d / v + ((si - tr.stationIdx + nS) % nS) * dw;
  }

  /** Time gaps (nominal speed) to the nearest same-route bus ahead / behind along the loop. */
  private busGaps(b: Bus): { ahead: number | null; behind: number | null } {
    const lam = (o: Bus): number | null =>
      o.phase === 'deadhead' ? null : o.phase === 'move' ? o.pos : o.phase === 'serve' || o.phase === 'shold' ? o.r.route.stopDist[o.stopIdx]! : 0;
    const lb = lam(b);
    if (lb === null) return { ahead: null, behind: null };
    const L = b.r.route.path.length;
    let ahead = Infinity;
    let behind = Infinity;
    for (const o of this.buses) {
      if (o === b || o.r !== b.r) continue;
      const lo = lam(o);
      if (lo === null) continue;
      ahead = Math.min(ahead, fwd(lb, lo, L));
      behind = Math.min(behind, fwd(lo, lb, L));
    }
    const v = this.cfg.bus.speed;
    return {
      ahead: Number.isFinite(ahead) ? Math.round(ahead / v) : null,
      behind: Number.isFinite(behind) ? Math.round(behind / v) : null,
    };
  }

  // ================================================================ misc
  private ev(e: SimEvent): void {
    this.events.push(e);
    if (this.events.length > 2 * EVENT_BUFFER) this.events.splice(0, this.events.length - EVENT_BUFFER);
  }

  private controllerRef(): ControllerRef {
    if (this.intentLog.length) return { kind: 'human', basePolicyId: 'g0' };
    const c = this.controller as { async?: boolean; model?: string; opts?: { model?: string } };
    const policyId = this.policy.meta?.id ?? this.controller.id;
    if (c.async) return { kind: 'jev', policyId, model: c.model ?? c.opts?.model ?? 'typesafe/jev-1.13' };
    return { kind: 'policy', policyId };
  }

  private placeName(pi: number): string {
    const pl = this.places[pi];
    if (!pl) return 'the stop';
    return pl.at.kind === 'platform' ? `${pl.name} Station platform` : pl.name;
  }

  private reason(p: Pax): string {
    const destName = this.zoneName.get(p.spec.dest) ?? p.spec.dest;
    switch (p.state) {
      case 'arrived': return `Arrived at ${destName}`;
      case 'riding': {
        const placeName = this.placeName(p.alightPlace);
        if (p.vehicle === this.train.id) return `Riding the train to ${placeName.replace(/ platform$/, '')}`;
        const b = p.vehicle ? this.busById.get(p.vehicle) : undefined;
        return `Riding ${b ? routeLabel([b.r.id]) : 'the bus'} to ${placeName}`;
      }
      case 'walking': {
        if (p.walkKind === 'walkaway') return `Gave up waiting: walking to ${destName}`;
        const nl = this.nextVehicleLeg(p, p.walkKind === 'transfer' ? p.legIdx : p.legIdx + 1);
        if (!nl) return `Walking to ${destName}`;
        const target = this.placeName(this.legPlace(nl));
        return p.vehicleLegsDone > 0 ? `Transferring: walking to ${target}` : `Walking to ${target}`;
      }
      case 'waiting': {
        const place = this.places[p.place]!;
        if (p.mask & (1 << TRAIN)) {
          const si = this.stationIdxOfPlace(place.idx);
          const eta = si >= 0 ? this.etaTrain(si) : Infinity;
          return `Waiting for the train — ${Number.isFinite(eta) ? `next train in ${minutes(eta)}` : 'no train on the way'}`;
        }
        const ids = this.routes.filter((rt) => p.mask & (1 << rt.m)).map((rt) => rt.id);
        let eta = Infinity;
        for (const b of this.buses) {
          if (!(p.mask & (1 << b.r.m))) continue;
          const k = b.r.stopPlace.indexOf(place.idx);
          if (k >= 0) eta = Math.min(eta, this.etaBus(b, k));
        }
        const next = Number.isFinite(eta) ? `next bus in ${minutes(eta)}` : 'no bus on the way';
        return p.leftBehind ? `Left behind by a full bus — waiting for ${routeLabel(ids)}, ${next}` : `Waiting for ${routeLabel(ids)} — ${next}`;
      }
      default: return '';
    }
  }
}

