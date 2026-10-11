// ---------- ids ----------
export type Vec2 = { x: number; z: number };
export type RouteId = 'r1' | 'r2' | 'r3';
export type StopId =
  | 'stop_stadium_gate' | 'stop_stadium_stn' | 'stop_university_stn' | 'stop_old_main'
  | 'stop_downtown' | 'stop_central_stn' | 'stop_apts_north' | 'stop_apts_south';
export type StationId = 'stn_stadium' | 'stn_university' | 'stn_central';
export type NeighborhoodId = 'campus' | 'downtown' | 'apartments' | 'stadium';
export type ZoneTag = 'hall' | 'housing' | 'retail' | 'stadium' | 'station' | 'lawn';
export type QueuePlace = { kind: 'stop'; id: StopId } | { kind: 'platform'; id: StationId };

// ---------- map ----------
export interface Polyline { points: Vec2[]; cum: number[]; length: number; closed: boolean } // cum[i] = arc length at points[i]
export interface Neighborhood { id: NeighborhoodId; name: string; center: Vec2; radius: number }
export interface Zone { id: string; neighborhood: NeighborhoodId; name: string; door: Vec2; weight: number; tags: ZoneTag[] }
export interface RoadNode { id: string; p: Vec2 }
export interface RoadEdge { id: string; a: string; b: string; path: Polyline }
export interface Stop {
  id: StopId; name: string; p: Vec2; queueDir: Vec2;     // unit vector the queue line grows along
  neighborhood: NeighborhoodId; servedRoutes: RouteId[]; stationId?: StationId;
}
export interface Station { id: StationId; name: string; dist: number; platform: Vec2; queueDir: Vec2; stopId: StopId }
export interface Route {
  id: RouteId; name: string; color: string;
  stops: StopId[];             // loop order; stops[0] is the terminal
  path: Polyline;              // closed loop starting at the terminal
  stopDist: number[];          // arc distance of each stop along path
  terminalNode: string;        // road node at the terminal (deadhead pathing)
  nominalLoopS: number;        // measured loop time incl. nominal dwells (calibrated in Wave 0)
  advertisedHeadwayS: number;  // = nominalLoopS / 2; published to passengers; independent of any controller
}
export interface TownMap {
  version: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  neighborhoods: Neighborhood[]; zones: Zone[];
  roads: { nodes: RoadNode[]; edges: RoadEdge[] };
  rail: { loop: Polyline; stations: Station[]; advertisedHeadwayS: number }; // stations in travel order
  stops: Stop[]; routes: Route[];
}

// ---------- scenarios ----------
export type Split = 'train' | 'val' | 'test' | 'showcase' | 'play';
export type ScenarioKind = 'stadium_exit' | 'class_change' | 'evening_commute';
export type ZoneSelector = { neighborhood?: NeighborhoodId; tag?: ZoneTag; zones?: string[] }; // weighted by zone.weight
export type TimeProfile =
  | { kind: 'uniform'; start: number; end: number }
  | { kind: 'pulse'; at: number; rampS: number; decayS: number }
  | { kind: 'piecewise'; points: Array<[t: number, rate: number]> };
export interface DemandGenerator { id: string; from: ZoneSelector; to: Array<{ sel: ZoneSelector; share: number }>; total: number; profile: TimeProfile }
export interface AdvertisedEvent { kind: 'stadium_closing' | 'class_change'; t: number; label: string }
export interface Perturbations {
  demandScale: [number, number];                // per-run multiplier
  trafficScale: [number, number];               // per road edge, redrawn every 300 s
  stadiumCongestion: { radius: number; speedScale: number; fromT: number; toT: number } | null;
  trainDelay: { chance: number; extraS: [number, number] };   // per station departure
}
export interface ScenarioDef {
  id: string; kind: ScenarioKind; name: string; clockStart: string; // e.g. '21:30' for HUD display only
  durationS: number; clearingS: number;         // spawning window, then no-spawn clearing period
  demand: DemandGenerator[]; advertised: AdvertisedEvent[]; perturb: Perturbations;
}
export interface ScenarioInstance { scenarioId: string; seed: number; split: Split }

// ---------- config & passengers ----------
export interface SimConfig {
  simVersion: string;
  bus: { count: number; capacity: number; speed: number; boardS: number; alightS: number; minDwellS: number;
         /** v3: reserve buses parked in the depot, deployable by human or AI (default 2). */ reserve?: number };
  train: { /** v3: linked cars (default 3); capacity is the whole train. */ cars?: number; capacity: number; speed: number; minDwellS: number; maxDwellS: number; defaultDwellS: number;
           boardS: number; alightS: number; carSpacing: number };
  walk: { meanSpeed: number; sdSpeed: number; minSpeed: number; maxSpeed: number; detourFactor: number; accessRadius: number };
  limits: { maxHoldS: number; maxHoldPerLoopS: number; maxLayoverS: number; minBusesPerRoute: number };
  objective: { unfinishedPenaltyS: number; missedWindowS: number; bunchingFraction: number };
}
export interface PassengerSpec {        // generated before the run; identical for every controller
  id: number; spawnT: number; origin: string; dest: string;   // zone ids
  walkSpeed: number;
  weights: { walk: number; wait: number; ride: number };      // multipliers on seconds
  transferPenaltyS: number; maxTransfers: 0 | 1;
  patienceS: number; switchPenaltyS: number;
  choiceNoise: number;                                         // fixed per-passenger draw
  tint: number;                                                // 0..5 visual variety
}
export type Leg =
  | { kind: 'walk'; from: Vec2; to: Vec2; durationS: number }
  | { kind: 'bus'; routes: RouteId[]; board: StopId; alight: StopId }   // any listed route is acceptable
  | { kind: 'train'; board: StationId; alight: StationId };
export interface Itinerary { legs: Leg[]; expectedCostS: number; transfers: number }

// ---------- decisions ----------
export type VehicleState = 'layover' | 'moving' | 'dwelling' | 'holding' | 'deadhead' | 'depot';
export type DecisionKind = 'bus_at_stop' | 'bus_at_terminal' | 'train_at_station' | 'depot_check';
export type Action =
  | { type: 'continue' }                              // bus_at_stop: leave now (the implicit default)
  | { type: 'dispatch' }                              // bus_at_terminal: start the next loop now
  | { type: 'hold'; seconds: number }                 // stop: 5..maxHoldS · terminal: 10..120
  | { type: 'hold'; until: 'target_headway' }         // seconds = clamp(target_headway_s - headway_ahead_s)
  | { type: 'reassign'; to: RouteId | 'busiest' }     // terminal only; deadheads to the new terminal
  | { type: 'setTrainDeparture'; dwellS: number }     // train_at_station: 30..120 after arrival
  | { type: 'deploy'; to: RouteId | 'busiest' };      // depot_check (v3): send one reserve bus to a route
export type FeatureVector = Record<string, number>;
export interface DecisionPoint {
  id: number; t: number; kind: DecisionKind; vehicleId: string;
  stopId?: StopId; stationId?: StationId; routeId?: RouteId;
  features: FeatureVector;                            // exactly the whitelist for `kind` (§6)
}
export type DecisionSource = 'policy' | 'default' | 'human' | 'jev' | 'fallback' | 'replay';
export interface Decision { action: Action; ruleId: string; explanation: string; source: DecisionSource }
export interface DecisionRecord extends Decision { dpId: number; t: number; kind: DecisionKind; vehicleId: string; features: FeatureVector }
export type Intent =                                  // human dispatcher input (§5.6)
  | { type: 'dispatch'; vehicleId: string }
  | { type: 'hold'; vehicleId: string; seconds: number }
  | { type: 'reassign'; vehicleId: string; to: RouteId }
  | { type: 'setTrainDeparture'; dwellS: number }
  | { type: 'deploy'; to: RouteId };                  // v3: send one reserve bus from the depot

// ---------- observation (identical for human and AI; no future information) ----------
export interface RunningMetrics { spawned: number; completed: number; waitingNow: number; ridingNow: number;
  meanWaitS: number; missedConnections: number; leftBehind: number; jSoFar: number }
export interface Observation {
  t: number; phase: 'running' | 'clearing';
  scenario: { id: string; kind: ScenarioKind; name: string; clockStart: string; durationS: number; clearingS: number; advertised: AdvertisedEvent[] };
  buses: Array<{ id: string; routeId: RouteId; state: VehicleState; onboard: number; capacity: number;
    nextStopId: StopId | null; etaNextStopS: number | null; holdUntil: number | null;
    headwayAheadS: number | null; headwayBehindS: number | null; holdUsedS: number }>;
  train: { state: VehicleState; stationId: StationId; etaS: number;   // current station (eta 0) or next
    onboard: number; capacity: number; departAt: number | null;
    alightingNext: number; transfersNext: Partial<Record<RouteId, number>>; platformQueue: Record<StationId, number> };
  stops: Array<{ id: StopId; queue: number; queueByRoute: Partial<Record<RouteId, number>>; longestWaitS: number;
    lastDepartureT: Partial<Record<RouteId, number>> }>;
  routes: Array<{ id: RouteId; buses: string[]; targetHeadwayS: number; queue: number }>;
  running: RunningMetrics;
  /** v3: reserve buses parked in the depot and those driving out to a route. */
  depot?: { reserves: string[]; deploying: string[] };
}

// ---------- controllers ----------
export interface Controller { id: string; async?: false; decide(dp: DecisionPoint, obs: Observation): Decision }
export interface AsyncController { id: string; async: true; decide(dp: DecisionPoint, obs: Observation): Promise<Decision> }
export type ControllerRef =
  | { kind: 'policy'; policyId: string }              // 'g0' baseline, 'ref', 'g7', 'r3-b'
  | { kind: 'human'; basePolicyId: 'g0' }             // baseline defaults + human intents
  | { kind: 'jev'; policyId: string; model: string };

// ---------- viewer snapshot ----------
export type PathRef = { kind: 'route'; routeId: RouteId } | { kind: 'deadhead'; from: RouteId; to: RouteId } | { kind: 'rail' };
export interface VehicleView { id: string; kind: 'bus' | 'train'; routeId: RouteId | null; path: PathRef; dist: number;
  state: VehicleState; onboard: number; capacity: number; nextStopId: StopId | null; holdUntil: number | null;
  lastDecision: DecisionRecord | null }
export interface PersonView { id: number; state: 'walking' | 'waiting' | 'arrived'; tint: number;
  from?: Vec2; to?: Vec2; t0?: number; t1?: number;  // walking: straight segment over [t0,t1]; arrived: fade at `to` for 3 s
  at?: QueuePlace; slot?: number; since?: number }    // waiting: queue slot index, wait start
export interface QueueView { at: QueuePlace; count: number; longestWaitS: number; severity: 'ok' | 'warn' | 'bad' }
export type SimEvent =
  | { t: number; kind: 'board' | 'alight'; personId: number; vehicleId: string; at: QueuePlace }
  | { t: number; kind: 'transfer_made' | 'missed_connection' | 'left_behind' | 'walkaway' | 'arrive'; personId: number; at?: QueuePlace }
  | { t: number; kind: 'decision'; record: DecisionRecord };
export interface SimSnapshot { t: number; phase: 'running' | 'clearing' | 'done'; vehicles: VehicleView[];
  people: PersonView[]; queues: QueueView[]; running: RunningMetrics; events: SimEvent[] }  // riders are not listed
export interface PassengerInfo { id: number; origin: string; dest: string; itinerary: Itinerary; legIndex: number;
  status: string; waitedS: number; patienceS: number; reason: string }  // "why am I waiting", for the inspector

// ---------- results ----------
export interface Metrics {
  J: number; spawned: number; completed: number; unfinished: number; completionPct: number;
  meanJourneyS: number; meanWaitS: number; p95WaitS: number; maxWaitS: number;
  transfersMade: number; missedConnections: number; leftBehind: number; walkaways: number;
  effort: { busDistanceU: number; deadheadDistanceU: number; holdS: number; trainDwellS: number };
}
export interface StopStats { id: StopId; maxQueue: number; meanWaitS: number; maxGapS: Partial<Record<RouteId, number>> }
export type Finding<K extends string, P> = { kind: K; impactS: number; text: string } & P;  // impactS = passenger-seconds, for ranking
export type FailureFinding =
  | Finding<'service_gap', { stopId: StopId; routeId: RouteId; gapS: number; fromT: number; toT: number; affected: number }>
  | Finding<'missed_transfer', { at: QueuePlace; from: RouteId | 'train'; to: RouteId | 'train'; count: number; window: [number, number] }>
  | Finding<'bunching', { routeId: RouteId; stopId: StopId; events: number; minHeadwayS: number }>
  | Finding<'overload', { at: QueuePlace; routeId: RouteId | 'train'; leftBehind: number; peakQueue: number }>
  | Finding<'unused_capacity', { routeId: RouteId; meanLoad: number; elsewhere: { stopId: StopId; queue: number } }>
  | Finding<'long_hold', { vehicleId: string; stopId: StopId; holdS: number; delayedOnboard: number; transfersGained: number }>;
export interface RunResult { simVersion: string; mapVersion: string; scenarioId: string; seed: number; controller: ControllerRef;
  metrics: Metrics; stops: StopStats[]; findings: FailureFinding[]; ruleFires: Record<string, number>; hash: string }
export interface Replay { simVersion: string; mapVersion: string; scenarioId: string; seed: number; controller: ControllerRef;
  intents?: Array<{ t: number; intent: Intent }>; decisions?: Array<{ dpId: number; action: Action }> }

// ---------- policy (validated by zod in policy/schema.ts, §6) ----------
export type Op = '<' | '<=' | '>' | '>=' | '==';
export interface Condition { f: string; op: Op; v: number }
export interface Rule { id: string; on: DecisionKind; priority: number; when: Condition[]; do: Action; say: string }
export type Emphasis = 'transfers' | 'spacing' | 'allocation';
export interface Policy {
  meta: { id: string; parent: string | null; generation: number; author: string;
          emphasis: Emphasis | 'baseline' | 'reference'; summary: string };
  params: { allocation: Record<RouteId, number>; maxHoldS: number; trainDefaultDwellS: number;
            targetHeadwayS?: Partial<Record<RouteId, number>> };
  rules: Rule[];
  /** Policies written before v3 have no depot_check default: treat a missing entry as { type: 'continue' } (never deploy). */
  defaults: Partial<Record<DecisionKind, Action>> & Record<Exclude<DecisionKind, 'depot_check'>, Action>;
  advisor?: { provider: 'jev'; enabled: boolean; askWhen: Condition[]; holdOptionsS: number[]; instructions: string };
}

// ---------- evolution records (evolve writes; worker stores; web reads) ----------
export interface SplitScore { J: number; metrics: Metrics; runs: number }  // J summed over the split's runs
export interface Proposal { id: string; roundId: string; designer: 0 | 1 | 2; model: string; emphasis: Emphasis;
  summary: string; rationale: string; policy: Policy | null; valid: boolean; errors: string[];
  train: SplitScore | null; val: SplitScore | null; deltaTrainPct: number | null; findings: FailureFinding[]; narrative: string }
export interface Round { id: string; number: number; championBefore: string; championAfter: string;
  status: 'running' | 'done' | 'failed'; proposals: Proposal[]; startedAt: string; finishedAt: string | null }
export interface Generation { id: string; number: number; parentId: string | null; policy: Policy; fromProposal: string | null;
  explanation: string; train: SplitScore; val: SplitScore; findings: FailureFinding[]; createdAt: string }
export type EvolveEvent =
  | { type: 'round_start'; round: number; champion: string }
  | { type: 'proposal'; designer: number; model: string; emphasis: Emphasis; status: 'requested' | 'received' | 'repaired' | 'invalid'; summary?: string; errors?: string[] }
  | { type: 'eval'; proposalId: string; split: 'train' | 'val'; done: number; total: number }
  | { type: 'scored'; proposalId: string; deltaTrainPct: number; narrative: string }
  | { type: 'decision'; promoted: string | null; reason: string }
  | { type: 'error'; message: string };

// ---------- sim API (implemented in packages/sim/src/engine) ----------
export interface Sim {
  readonly t: number; readonly done: boolean;
  step(): { pending: DecisionPoint | null };   // one tick; a no-op while an async decision is pending
  resolve(dpId: number, decision: Decision): void;
  intent(i: Intent): void;                     // logged with the current tick
  observe(): Observation; snapshot(): SimSnapshot; passenger(id: number): PassengerInfo | null;
  result(): RunResult; replay(): Replay;
}
export interface CreateSimArgs { map: TownMap; scenario: ScenarioInstance; config?: Partial<SimConfig>;
  controller: Controller | AsyncController; intents?: Replay['intents']; decisions?: Replay['decisions'] }
// export function createSim(a: CreateSimArgs): Sim
// export function runSync(a: CreateSimArgs & { controller: Controller }): RunResult            // headless, sync only
// export function runAsync(a: CreateSimArgs): Promise<RunResult>                               // awaits async decisions
// export function deadheadPath(map: TownMap, from: RouteId, to: RouteId): Polyline              // shortest road path, cached
