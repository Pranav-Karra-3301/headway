# Headway — Design Spec

- **Date:** 2026-10-11 · **Status:** approved to build (user steering live; Luminal kept for designers, OpenRouter added for fallback + Jev)
- **Visual source:** model kit `.superpowers/wip/kit-sheet.html` (palettes A Wooden Toy / B Miniature Railway / C State College Autumn; palette pick pending). Fonts: **Gumball Rounded** (wordmark + system UI) and Avenir Next Rounded Std / Nunito (body).
- **Provider facts (verified live 2026-10-11):** Luminal `https://flash.luminal.cloud/v1` (OpenAI-compatible; only model `deepseek-ai/DeepSeek-V4.1-Flash`; `response_format: json_object` works; ~2.5 s small calls; `reasoning_content` returned separately). OpenRouter `https://openrouter.ai/api/v1` (fallback `deepseek/deepseek-v4-pro` 1.4 s; optional `z-ai/glm-5.3-flash` needs ≥4k max tokens because it reasons first). Jev via OpenRouter `POST https://openrouter.ai/api/v1/systemone`, model `typesafe/jev-1.13`, ~0.3 s, returns choice + probabilities + confidence. Details: `docs/research/llm-providers.md`.
- Values marked *(tunable)* are deliberate starting points, not open questions.

---

## 1. Pitch and demo story

Headway is a small isometric transit-dispatch game set in a fictional, State College–inspired college town. Visitors watch the town run, play dispatcher themselves, or replay how successive AI-designed controllers handled the same rush hour. Between games, a team of LLM **policy designers** (DeepSeek V4.1 Flash served by Luminal, with OpenRouter as fallback) rewrites the town's **dispatch policy** — a bounded, versioned JSON rulebook — and only changes that measurably help survive. The language models are never retrained; the policy improves, and it runs in the browser with no LLM calls.

**Demo story (~4 min):**
1. **Watch:** the champion runs a stadium exit. Click a bus and read the rule that actually fired, e.g. "Holding 45 s for the train (34 s away, 14 transfers)".
2. **Play:** the presenter dispatches the same stadium crowd at 16×, then sees their score next to the champion's and the baseline's on the identical seed.
3. **Lab:** generations g0→gN with the objective falling, the rule diff of each generation, and failure notes such as "Holding at Central gained 41 transfers but left Apartments South without service for 14 min". The next generation fixes the problem.
4. **Finale:** the same crowd faces the baseline, the evolved champion and the human. Sealed-test numbers (never shown to the agents) close the loop.

Pitch line: *"A team of AI planners teaches the town's dispatcher, and you can try to beat it."*

## 2. Scope

**Constraints.** Hackathon with hours left on 2026-10-11. Policy designers run DeepSeek V4.1 Flash on Luminal (sponsor); OpenRouter is the fallback and also serves Jev (TypeSafe), the fast runtime decision model. Keys: `LUMINAL_API_KEY`, `OPENROUTER_API_KEY` in the gitignored root `.env`. Deploy on Cloudflare; render with Three.js (orthographic isometric).

**Environment.**
- The global npm registry points at an internal CodeArtifact whose token has expired, so the repo `.npmrc` pins `registry=https://registry.npmjs.org/`.
- wrangler 4.149.0 is logged in.
- The Workers plan tier (Free or Paid) is unverified; Wave 0 checks it (see §11).

**In (demo path):**
- One fixed town: 4 neighborhoods, 8 stops, 3 bus routes with 6 buses, and 1 two-car train on a 3-station rail loop.
- Individual simulated passengers with fixed behavioral rules.
- Scenarios: `stadium_exit` (must be excellent) and `class_change`.
- The 4 dispatcher controls.
- Controllers: baseline, queue-responsive reference, and evolved rule policies.
- The 3-designer evolution loop with train, val and sealed test splits.
- Modes: Watch, Play and Lab.
- A leaderboard with server re-simulation, if the Workers plan allows the CPU (§11).
- Cloudflare deploy.
- Jev for station-hold decisions, with a recorded comparison.

**Cut:**
- Route or road construction
- Steering individual vehicles
- Multiple maps
- User accounts (an admin token only)
- A live shared town over Durable Objects or WebSockets
- V-JEPA
- LLM-driven passengers
- Mobile layout and sound

**Stretch:**
- `evening_commute` scenario
- 3-way split-screen finale
- Live Jev in Watch mode
- Per-person "personality" decisions via Jev
- An OpenAI Decisions provider
- Cloudflare Workflows for durable evolve runs

## 3. Architecture

```
headway/
  package.json  pnpm-workspace.yaml  .npmrc  tsconfig.base.json  .gitignore (.superpowers/, .dev.vars, .env*)
  packages/sim/      @headway/sim     contracts, town map, scenarios, engine, controllers, policy schema+interpreter, metrics, findings
  packages/evolve/   @headway/evolve  LlmClient (OpenAI-compatible: Luminal primary, OpenRouter fallback), prompts, extraction/repair, rounds, narratives, Jev provider, CLI
  apps/web/          @headway/web     Vite + React HUD + Three.js TownRenderer; SimRunner; sim Web Worker for headless runs
  apps/worker/       @headway/worker  Cloudflare Worker: static assets (SPA) + Hono /api/*, D1 migrations
  data/policies/     g0.json (baseline), ref.json (queue-responsive); data/generations/*.json (CLI output)
  docs/              specs, research
```

**Dependency rules (enforced by package.json deps + review):**
- `sim` depends only on `zod`. It has no DOM, no three, no network, no `Date`, no `Math.random`. It must run identically in the browser, in Node and in a Worker.
- `evolve` depends on `sim` and talks to models only through `LlmClient` and `DecisionProvider` (fetch-based). Its core imports no Node built-ins, so it also runs in the Worker. Only `evolve/src/cli/*` may use `node:fs`.
- `web` depends on `sim`, `three`, `react` and `zustand`. It never imports `evolve`.
- `worker` depends on `sim`, `evolve` and `hono`.

**Data flow.**
- **Browser:** the HUD and `TownRenderer` read a store that is fed by `SimRunner` (`@headway/sim`).
- **Worker:** Hono `/api/*` sits over D1.
  - The leaderboard re-simulates submissions with `@headway/sim`.
  - `/api/evolve` runs `@headway/evolve`, which calls Luminal.
  - `/api/jev/decide` proxies to Jev via OpenRouter `/api/v1/systemone`.
- **CLI (Node):** `pnpm evolve`, `pnpm sim:run` and `pnpm eval:sealed` run the same code locally and publish through `/api/admin/publish`.

## 4. Contracts (`packages/sim/src/contracts.ts`)

This is the single source of truth for every track; Wave 0 commits it verbatim. Units: board units `u` (x east, z south, y up in the viewer); time is integer seconds `s` from scenario start. Visual scale is decoupled: vehicles are drawn oversized for readability.

```ts
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
  bus: { count: number; capacity: number; speed: number; boardS: number; alightS: number; minDwellS: number };
  train: { capacity: number; speed: number; minDwellS: number; maxDwellS: number; defaultDwellS: number;
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
export type VehicleState = 'layover' | 'moving' | 'dwelling' | 'holding' | 'deadhead';
export type DecisionKind = 'bus_at_stop' | 'bus_at_terminal' | 'train_at_station';
export type Action =
  | { type: 'continue' }                              // bus_at_stop: leave now (the implicit default)
  | { type: 'dispatch' }                              // bus_at_terminal: start the next loop now
  | { type: 'hold'; seconds: number }                 // stop: 5..maxHoldS · terminal: 10..120
  | { type: 'hold'; until: 'target_headway' }         // seconds = clamp(target_headway_s - headway_ahead_s)
  | { type: 'reassign'; to: RouteId | 'busiest' }     // terminal only; deadheads to the new terminal
  | { type: 'setTrainDeparture'; dwellS: number };    // train_at_station: 30..120 after arrival
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
  | { type: 'setTrainDeparture'; dwellS: number };

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
  defaults: Record<DecisionKind, Action>;
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
```

**Canonical topology.** The IDs and stop orders are fixed here. Geometry is authored in Wave 0 to fit this topology and the kit's scale (`.superpowers/wip/kit-sheet.html`: bus 3 u long, person ≈ 0.8 u tall). Bounds are about 72 × 52 u *(tunable)*.

| Route | Name | Stops in loop order (first = terminal) | Buses (g0) |
|---|---|---|---|
| r1 | Campus Loop | central_stn → downtown → old_main → university_stn | 2 |
| r2 | Apartments | central_stn → apts_north → apts_south → downtown | 2 |
| r3 | Stadium | stadium_gate → stadium_stn → old_main → downtown | 2 |

- **Rail line:** travel order stadium → central → university (`rail.stations` lists them in that order; the loop starts at Stadium's platform). It is a regional line, not a ring: the three station runs cross the board (south, east and north sides), and the loop closes off the board, with a long bridge over the bay to the south-east plus a lakeshore run, and a tunnel through the north-west ridge. `RAIL_SPANS` in `map/town.ts` gives the off-board, bridge and tunnel arc spans. Curves have radius ≥ 6 u, and roads level-cross it square-on. Each station pairs with a bus stop: `stn_stadium`↔`stop_stadium_stn`, `stn_university`↔`stop_university_stn` and `stn_central`↔`stop_central_stn`.
- **Shared stops create transfer choices:** downtown is served by all three routes; central by r1 and r2; old_main by r1 and r3.
- **Terminals:** r1 and r2 share Central, so reassigning between them needs no deadhead. r3's terminal is Stadium Gate, so a reassignment to or from r3 deadheads along the road graph. This creates the key dispatcher move: pre-staging buses before the advertised closing time.

## 5. Simulation rules

**5.1 Time and determinism**
- The sim advances in 1 s integer ticks. A run is `durationS = 1800` of spawning plus `clearingS = 900` of clearing, so `T_end = 2700`.
- **PRNG:** `sfc32`, seeded by `cyrb128(`${seed}:${stream}`)`. The named streams are:
  - `demand`: generates the passenger list.
  - `traffic`: draws per-edge speed multipliers, redrawn every 300 s.
  - `train`: draws train delays.
  - `behavior:${pid}`: per-passenger choice noise and patience.
- All random draws happen **before** the run (the passenger list, traffic table and train delay table). Every controller therefore faces the identical crowd and the identical perturbations.
- Controller decisions never consume randomness.
- The sim never uses `Math.random`, `Date`, unordered iteration or transcendental math in state updates (positions use `sqrt` only).
- Ties resolve by id. `simVersion` (start `'1'`) bumps on any behavior change; replays and leaderboard rows carry it.

**5.2 Tick order**
1. Spawn passengers whose `spawnT == t` (id order).
2. Walkers whose `t1 == t` join a queue or arrive.
3. Vehicles in id order (buses `b1…b6`, then the train `t1`): move, arrive, alight, board (FIFO among passengers who accept this route), then raise decision points.
4. Each decision point resolves in this order:
   - a logged replay decision, if one exists;
   - otherwise a pending human intent;
   - otherwise the controller.

   Sync controllers resolve inline. Async controllers return `pending`, and `step()` halts until `resolve()` is called.
5. Patience checks (id order).
6. Metric accumulation.

**5.3 Defaults** *(SimConfig, all tunable)*

| Group | Values |
|---|---|
| bus | count 6, capacity 40, speed 0.30 u/s, boardS 2, alightS 1.5, minDwellS 8 |
| train | 2 cars, capacity 160, speed 0.75 u/s, dwell window 30–120 s, default dwell 45 s, boardS 0.5, alightS 0.4, carSpacing 4.6 u |
| walk | speed N(0.05, 0.01) clamped to 0.03–0.07 u/s, detourFactor 1.25, accessRadius 14 u |
| limits | maxHoldS 90, maxHoldPerLoopS 180, maxLayoverS 300 (then forced dispatch), minBusesPerRoute 1 |
| objective | unfinishedPenaltyS 2700, missedWindowS 120, bunchingFraction 0.25 |

- **Calibration targets:**
  - a bus loop takes 6–9 sim-min;
  - the train loop takes about 6 sim-min;
  - a typical walk from door to stop takes 2–4 sim-min, so zone doors sit 5–10 u from their stops.
- Traffic multipliers range from 0.85 to 1.15. Stadium congestion applies a 0.6× speed scale within 10 u of the stadium from the closing time until +600 s.
- **Dwell** = max(minDwellS, boardS·boarders + alightS·alighters).
- Advertised headways are the map's fixed loop time divided by 2 for buses, and 360 s for the train.

**5.4 Passengers**
- **Itineraries.** Candidate itineraries per (origin zone, destination zone) are precomputed at map load. The options are:
  - walk only;
  - one bus leg (the best boarding and alighting stop pair within accessRadius, listing every route that serves both stops);
  - one train leg (station platforms within accessRadius);
  - two legs with exactly one transfer, either bus↔bus at a shared stop or bus↔train at a paired station stop.

  Walk duration = distance × detourFactor / walkSpeed, rounded.
- **Choice.** The passenger takes the minimum of `w.walk·walkS + w.wait·(advertisedHeadway/2) + w.ride·rideS + transferPenaltyS·transfers + 60·choiceNoise`. Itineraries with more than `maxTransfers` are excluded. Choice uses **advertised** headways only, so no controller can move demand by changing what passengers are told.
- **Personal draws** (behavior stream):
  - w.walk ∈ [1.0, 2.0], w.wait ∈ [1.5, 2.5], w.ride = 1;
  - transferPenaltyS ∈ [120, 300];
  - maxTransfers = 1 with probability 0.85;
  - patienceS ∈ [420, 900];
  - switchPenaltyS = 120.
- **Reconsideration.** This happens at most once. When waited > patienceS, the passenger compares the remaining planned cost (assuming another advertisedHeadway/2 of waiting) with walking from the current position plus switchPenaltyS. If walking is cheaper, they become a walker (`walkaway` event).
- **Boarding** is FIFO among the queue members who accept the arriving route. A passenger refused because the vehicle is full counts once as `left_behind`.
- **Transfers.** Alighting at a transfer point starts a short walk between the platform and the stop. A `missed_connection` is counted when a transferring passenger joins a queue within `missedWindowS` after a vehicle they would have boarded departed.
- **End of run.** Spawning stops at 1800 s. Anyone not arrived at T_end is unfinished.

**5.5 Vehicles**
- A bus loop starts at its terminal in `layover`.
- At each stop, after boarding and alighting, the bus raises `bus_at_stop`. At its terminal it raises `bus_at_terminal`, which is re-raised when a terminal hold ends.
- **Holds** are clamped. A stop hold cannot exceed maxHoldS or the per-loop hold budget. Terminal layover is capped at maxLayoverS, after which the bus is dispatched automatically.
- **reassign** applies only at a terminal. It is not applicable when:
  - the target is the bus's own route, or
  - the source route would drop below minBusesPerRoute.

  `busiest` = the route with the largest total queue across its stops, excluding the bus's own route. A reassigned bus deadheads with doors closed.
- The train loops continuously. At each station it alights, boards, then raises `train_at_station`. `setTrainDeparture.dwellS` is clamped to 30–120, and pre-drawn delays are added on departure.
- **Initial positions and ids.** Buses `b1…b6` are assigned to routes in order by `params.allocation`, and all start in layover at their route's terminal. With no prior departure, `headway_ahead_s = 3600`, so g0 dispatches the first bus at t = 0 and holds the next ones toward the target headway. The train has id `t1` and starts at `stn_stadium`. Unknown headways in features are reported as 3600.

**5.6 Human intents (Play)**
- Play runs the `g0` policy defaults, and human intents override them. Intents are logged with the tick they were issued (`Replay.intents`).
- How each intent applies:
  - `hold`: applies now if the bus is dwelling or holding (sets `holdUntil = t + seconds`, clamped). Otherwise it applies at that bus's next `bus_at_stop`.
  - `dispatch`: applies now if the bus is in layover or holding at a terminal. Otherwise the UI disables it.
  - `reassign`: applies at that bus's next terminal.
  - `setTrainDeparture`: applies now if the train is dwelling. Otherwise it applies at the next station.
- Decisions made from intents carry `source: 'human'`. Because the semantics live in the sim, the server can re-simulate a replay exactly.

**5.7 Scenarios** *(totals tunable)*

| id | Demand | Advertised |
|---|---|---|
| `stadium_exit` | 1,030 fans, pulse at 600 s (ramp 120 s). **East and North Gates, 600** (decay 420 s): Eastview 24% / Allen Corner 16% / Garden Row 10% / Station Court 10% / Central station 10% / Central Plaza 8% / Parkside 6% / Beaver Ave 6% / Main St Market 5% / campus halls 5%. **South Gate (beside Stadium Station), 430** (decay 600 s): Garden Row 52% / Central station 14% / Parkside 12% / Station Court 8% / University station 8% / downtown shops 6%. Plus background 300, uniform across zones | stadium closing at 600 s, clock 21:30 |
| `class_change` | 2 pulses × 350 from halls (at 300 s and 1500 s) to downtown / apartments / university station; background 200 | class changes at 300 s and 1500 s, clock 11:45 |
| `evening_commute` *(stretch)* | 700 piecewise, campus/downtown → apartments, plus train arrivals | none |

The stadium-exit crunch is intentional. About 1.3k riders (× 0.9–1.1) meet roughly 6 buses × 3.5 loops × 40 seats plus about 6 train loops × 160 seats.
- The East and North Gate crowd queues at Stadium Gate and Old Main for r3 and r1. This is the crunch a pre-staged bus relieves.
- The South Gate crowd takes the train to Central, and many continue on r2 to Apartments South. These are the train↔bus transfers that holding at Central protects.
- Under g0: about 25% of fans ride the train, about 9% transfer between train and bus, about 28% walk, Central and University see 45 or more missed connections per run, and completion is about 88%.
- Tuning record: `docs/research/sim-tuning.md`.

## 6. Controllers and the policy format

- **Baseline `g0`:** allocation 2/2/2. One rule holds at the terminal until the target headway: `bus_at_terminal`, `headway_ratio < 1` → hold until the target headway. The defaults are continue, dispatch and a 45 s train dwell. Evolution starts from g0.
- **Reference `ref` (queue-responsive, hand-written):**
  - At the terminal: dispatch immediately if `route_queue ≥ 40`.
  - At the terminal: reassign to `busiest` if `queue_ratio_other ≥ 2`, `max_other_route_queue ≥ 30` and `buses_on_route ≥ 2`.
  - At a stop: hold until the target headway if `headway_ratio < 0.4` and `downstream_queue < 30`.
  - Otherwise behave like g0.
- `ref` is shown as a reference line in the Lab and is never used as a parent.

Both are stored as policy JSON in `data/policies/` and are interpreted by the same `PolicyController`.

**Semantics.**
1. At a decision point of kind *k*, the rules with `on == k` are tried in descending `priority`, with ties broken by array order.
2. The first rule whose conditions all hold **and** whose action is applicable fires.
3. Otherwise `defaults[k]` applies, with `ruleId 'default'`.
4. The explanation is the rule's `say` template, filled with the actual feature values and the resolved action parameters (`{seconds}`, `{dwellS}`, `{to}`). It is never generated after the fact.

**Validation (zod plus semantic checks):**
- at most 24 rules and at most 6 conditions per rule;
- rule ids must match `^[a-z0-9-]{3,32}$` and be unique;
- features come from the whitelist for that `on` kind, and each `v` must lie within the feature's range;
- actions must be legal for that kind and lie within bounds;
- `allocation` uses integers ≥ 1 that sum to 6;
- `maxHoldS` ≤ 90, `trainDefaultDwellS` must lie within 30–120;
- `say` is at most 140 characters and uses only known placeholders;
- `summary` is at most 200 characters;
- `advisor.instructions` is at most 1,200 characters.

**Feature whitelist** (computed by the sim from the Observation, so the human inspector shows the same numbers):

| `bus_at_stop` | meaning | range |
|---|---|---|
| onboard, load_factor | riders aboard after boarding; onboard/capacity | 0–40; 0–1 |
| queue_here | still waiting here for this route | 0–500 |
| headway_ahead_s, headway_behind_s | since the previous same-route departure here; ETA of the next same-route bus (3600 if none) | 0–3600 |
| target_headway_s, headway_ratio | params.targetHeadwayS[route] ?? round(nominalLoopS / buses_on_route); headway_ahead_s/target | 60–1800; 0–10 |
| train_eta_s, expected_transfers | train arrival at this stop's station (9999 if none or > 900 s); riders aboard the train who will transfer to this route here | 0–9999; 0–160 |
| downstream_queue | waiting for this route at the next 2 stops | 0–1000 |
| hold_used_s, is_station, event_in_s | hold used this loop; 1 if paired with a station; s to the next advertised event (negative after the last one, 9999 if none) | 0–180; 0–1; ±9999 |

| `bus_at_terminal` | meaning | range |
|---|---|---|
| route_queue, max_other_route_queue | total waiting for this route; the largest such total on another route | 0–2000 |
| queue_ratio_other | max_other_route_queue / max(route_queue, 1) | 0–2000 |
| buses_on_route | buses assigned, including this one | 1–6 |
| headway_ahead_s, target_headway_s, headway_ratio | since the last terminal departure on this route | as above |
| layover_s, event_in_s | time at the terminal so far; as above | 0–300; ±9999 |

| `train_at_station` | meaning | range |
|---|---|---|
| onboard, platform_queue | riders aboard; waiting on this platform | 0–160; 0–1000 |
| buses_here_or_due_60s, next_bus_eta_s | buses at the paired stop or arriving within 60 s; minimum ETA (3600 if none) | 0–6; 0–3600 |
| transfers_alighted, dwell_s, event_in_s | riders who just alighted heading for buses here; dwell so far; as above | 0–160; 0–120; ±9999 |

**Example policy (complete):**

```json
{
  "meta": { "id": "g3", "parent": "g2", "generation": 3, "author": "deepseek-v4.1-flash@luminal", "emphasis": "transfers",
            "summary": "Hold at Central for an arriving train only with 8+ transfers and the next bus 3+ min away; pre-stage r3 before closing." },
  "params": { "allocation": { "r1": 2, "r2": 2, "r3": 2 }, "maxHoldS": 60, "trainDefaultDwellS": 45 },
  "rules": [
    { "id": "prestage-stadium", "on": "bus_at_terminal", "priority": 30,
      "when": [ { "f": "event_in_s", "op": "<=", "v": 300 }, { "f": "event_in_s", "op": ">=", "v": -600 },
                { "f": "buses_on_route", "op": ">=", "v": 2 }, { "f": "route_queue", "op": "<", "v": 25 } ],
      "do": { "type": "reassign", "to": "r3" },
      "say": "Moving to Stadium: closing in {event_in_s}s, only {route_queue} waiting here" },
    { "id": "hold-for-connection", "on": "bus_at_stop", "priority": 20,
      "when": [ { "f": "train_eta_s", "op": "<=", "v": 45 }, { "f": "expected_transfers", "op": ">=", "v": 8 },
                { "f": "onboard", "op": "<=", "v": 25 }, { "f": "headway_behind_s", "op": ">=", "v": 180 } ],
      "do": { "type": "hold", "seconds": 45 },
      "say": "Holding {seconds}s for the train ({train_eta_s}s away, {expected_transfers} transfers)" },
    { "id": "anti-bunch", "on": "bus_at_stop", "priority": 10,
      "when": [ { "f": "headway_ratio", "op": "<", "v": 0.5 }, { "f": "downstream_queue", "op": "<", "v": 40 } ],
      "do": { "type": "hold", "until": "target_headway" },
      "say": "Spacing out: only {headway_ahead_s}s behind the bus ahead" },
    { "id": "even-headway", "on": "bus_at_terminal", "priority": 10,
      "when": [ { "f": "headway_ratio", "op": "<", "v": 1 } ],
      "do": { "type": "hold", "until": "target_headway" },
      "say": "Waiting {seconds}s at the terminal to keep a {target_headway_s}s headway" },
    { "id": "train-meets-bus", "on": "train_at_station", "priority": 10,
      "when": [ { "f": "next_bus_eta_s", "op": "<=", "v": 40 }, { "f": "platform_queue", "op": "<", "v": 30 } ],
      "do": { "type": "setTrainDeparture", "dwellS": 75 },
      "say": "Train waits {dwellS}s: a bus arrives in {next_bus_eta_s}s" }
  ],
  "defaults": { "bus_at_stop": { "type": "continue" }, "bus_at_terminal": { "type": "dispatch" },
                "train_at_station": { "type": "setTrainDeparture", "dwellS": 45 } }
}
```

## 7. Evaluation protocol

- **Objective (lower is better):** `J = Σ_completed (arriveT − spawnT) + Σ_unfinished ((T_end − spawnT) + 2700)`. The 2,700 s penalty is *(tunable)*. In the HUD, J is shown as passenger-hours and as the mean journey in minutes.
- **Secondary metrics, always shown next to J:**
  - mean and p95 wait;
  - completion %;
  - missed connections, left-behind count and walkaways;
  - operating effort: bus distance, deadhead distance, total hold seconds and train dwell, all with the same 6-bus fleet and 1 train.

| Split | Scenarios × seeds | Who sees results |
|---|---|---|
| train | stadium_exit, class_change × 1001–1004 (8 runs) | designers (evidence digest) |
| val | same scenarios × 2001–2002 (4 runs) | promotion gate only; designers see only "promoted / rejected: validation worse" |
| test (sealed) | same scenarios (+ evening_commute if built) × 3 seeds from secret `SEALED_TEST_SEEDS` | humans in the Lab after optimization; never in prompts or `evolve` code paths |
| showcase | stadium_exit, class_change × 4001–4003 | Watch mode |
| play | stadium_exit × (50000 + UTC days since 2026-10-11) | Play mode and leaderboard |

- All controllers are compared on identical (scenario, seed) pairs, and champion scores are cached per `(policyId, simVersion, split)`.
- **Promotion:** take the best valid proposal by J_train. Promote it only if all of these hold:
  - J_train is at least 1% better than the champion's *(tunable)*;
  - J_val is no worse than the champion's;
  - training completion % has not dropped by more than 1 percentage point;
  - the worst per-stop maximum service gap is ≤ max(the champion's worst, 900 s).

  If the best proposal fails validation, the second-best gets one validation attempt.
- Every report lists the failures alongside the gains (§8.4).
- `evolve` only accepts the `'train' | 'val'` splits at the type level, and the test seeds never exist in the repo.

## 8. Evolution loop (`packages/evolve`)

**8.1 Round.** Each round runs these steps:
1. Load the champion and its cached train results.
2. Build the evidence digest.
3. Call 3 designers in parallel.
4. Extract and validate their output, with one repair attempt each.
5. Evaluate the valid proposals on train (8 runs each).
6. Validate the best one (4 runs).
7. Promote or reject.
8. Write narratives and persist the `Round`, the `Proposal`s and any new `Generation`.
9. Emit an `EvolveEvent` at every step.

A failed designer does not fail the round. If all three fail, the champion is unchanged and the round is marked `failed`.

**8.2 Designers.**
- Designer *i* in round *r* gets emphasis `EMPHASES[(i + r) % 3]`, where the emphases are `[transfers, spacing, allocation]`.
- All three designers use `deepseek-ai/DeepSeek-V4.1-Flash` on Luminal; diversity comes from the rotating emphasis and per-designer temperature `[0.4, 0.7, 1.0]`. Each call falls back once to OpenRouter `deepseek/deepseek-v4-pro` on timeout, 429 or 5xx (recorded as the proposal's `model`). Optional: `OPENROUTER_GLM=1` swaps designer 2 to `z-ai/glm-5.3-flash`.
- Settings: max tokens 8,000 (reasoning tokens count), `response_format: { type: 'json_object' }`, timeout 90 s *(tunable)*. Luminal allows 60 req/min — far above the 3–6 calls per round.
- Models are reached through `LlmClient`:

  ```ts
  interface LlmClient {
    complete(req: { model: string; system: string; user: string; temperature?: number;
                    maxTokens?: number; json?: boolean; timeoutMs?: number }):
      Promise<{ text: string; latencyMs: number }>;
  }
  ```

  One adapter covers both providers (OpenAI-compatible chat completions); `reasoning_content` is ignored, `content` is parsed.

**8.3 Prompts.**
- **System:** the designer's role, then the DSL spec (§6 semantics, the feature tables, action bounds and validation rules), then the output contract. The model must return JSON only: `{ "summary": "...", "rationale": "...", "changes": ["≤3 items"], "policy": Policy }`. It should make at most 3 focused, attributable changes to the champion and must never violate the minimum service guarantees.
- **User:** the emphasis directive (e.g. "TRANSFERS: reduce missed train↔bus connections without starving other stops"), then the champion JSON, then the evidence digest.
- **Evidence digest** (≤ 6k characters):
  - a metrics table for champion, g0 and ref on train;
  - the top 8 findings by `impactS`, as sentences;
  - per-stop maximum queue and maximum gap;
  - rule fire counts;
  - the last 2 rounds' proposals (summary, ΔJ_train %, promoted or rejected with the reason).
- **Extraction and repair.** Extraction strips code fences and parses the first balanced `{…}`. On a zod or semantic failure, the model gets one repair message listing up to 20 error lines. If that still fails, the proposal is recorded with `valid: false` and its errors.

**8.4 Narratives.** These are deterministic templates over typed findings, using clock times (`clockStart + t`):

| Finding | Template |
|---|---|
| `service_gap` | "Apartments South went 14 min without a Route 2 bus (21:52–22:06)." |
| `missed_transfer` | "38 riders reached Central from the train just after Route 2 left." |
| `bunching` | "Route 1 buses bunched 4× (as close as 40 s)." |
| `overload` | "23 people were left behind at Stadium Gate; the queue peaked at 140." |
| `unused_capacity` | "Route 3 ran 71% empty while Downtown queued 60." |
| `long_hold` | "Holding b4 45 s at Central gained 12 transfers but delayed 31 riders." |

A proposal's narrative is "ΔJ −6.1% on training" plus its top 2 gains and top 2 costs versus the champion. Gains and costs are matched by finding kind and place and ranked by the change in `impactS`. Together these produce sentences like "Holding at Central helped transfers but left Apartments without service for 14 minutes".

**8.5 Records and ids.**
- Generations are `g0…gN`. A promoted policy is copied with `meta.id = gN` and `parent = gN-1`.
- Proposals are `r{round}-{a|b|c}`; rounds are `R{n}`. Timestamps are stamped by the runner.

**8.6 Where it runs.** The same `runRound(deps)` function runs in two places:
- `pnpm evolve --rounds N [--publish]` (Node) writes `data/generations/` and `data/rounds/`, and with `--publish` POSTs them to `/api/admin/publish`.
- `POST /api/evolve` runs it in the Worker (§11).

Budget per round: 3–6 LLM calls and about 30 sim runs. Target: a 150 ms stadium-exit run in Node, so evaluation stays under 6 s.

## 9. Jev track (TypeSafe)

- **Scope:** Jev decides only `bus_at_stop` at the 3 station stops, when the policy's `advisor.enabled` is set and `advisor.askWhen` holds (default: `train_eta_s ≤ 120`). Every other decision comes from the rules.
- **Legal options are generated by code** from `advisor.holdOptionsS` (default `[0, 20, 40, 60]`, clamped by limits), e.g. "Depart now", "Hold 20 s"…
- **Situation text** is a fixed template over features. Example: "Bus b4 (Route 2) at Central Station. 18 aboard of 40. Train arrives in 34 s with 14 riders transferring to Route 2. Next Route 2 bus is 6 min behind. 3 still waiting here; 41 waiting at the next two stops."
- **Interface:**

  ```ts
  interface DecisionProvider {
    choose(req: { instructions: string; situation: string; options: string[] }):
      Promise<{ index: number; probs: number[]; latencyMs: number }>;
  }
  ```

  `DecisionProvider` and `JevController` live in `packages/sim/src/controllers/advisor.ts`. `JevController` is an `AsyncController` that wraps `PolicyController`, and its provider is injected, so the sim stays network-free.
  - `JevProvider` (direct TypeSafe fetch, used by the CLI and the Worker) lives in `packages/evolve/src/jev`.
  - `ProxyDecisionProvider` (calls `/api/jev/decide`, used in the browser) lives in `apps/web` (stretch).
  - An `OpenAIDecisionsProvider` is interface-only (stretch).
  - `PolicyController` itself ignores `advisor`.
- **Deciding:** take the argmax (ties go to the lowest index). The explanation reads "Jev chose Hold 40 s (p 0.71) under instructions v3". The source is `jev`. On a timeout (800 ms in the browser, 5 s in the CLI) or an error, fall back to the rules with source `fallback`.
- **Determinism:** every Jev decision is logged in `Replay.decisions`. Replays and the Lab re-apply the logged decisions without calling Jev. Identical requests are cached by a SHA-256 of `{instructions, situation, options}`.
- **What evolves:** `advisor.instructions` and the `askWhen` thresholds. Jev-track rounds let designers edit only `advisor`, and evaluate on stadium_exit × 2 train seeds to bound the number of calls *(tunable)*.
- **Comparison shown in the Lab:** the rules-only champion vs Jev with fixed generic instructions vs Jev with evolved instructions, all on the same seeds.
- **Keys and endpoint:** the browser calls the Worker proxy (§11), never OpenRouter directly. The CLI reads `OPENROUTER_API_KEY` from the root `.env`. Request: `POST https://openrouter.ai/api/v1/systemone` with `{ model: 'typesafe/jev-1.13', state, questions: { decision: { type: 'choice', instructions, criteria: { optionId: description } } } }`; response `answers.decision = { choice, probabilities, confidence }` (verified: 0.3 s).

## 10. Web app (`apps/web`)

- **Stack:** Vite + TypeScript + React 19 HUD + zustand store, and a `TownRenderer` class (imperative Three.js, pinned `three@0.186.1`). Routes: `/` (Watch), `/play`, `/lab`, `/lab/:generationId`.
- **TownRenderer**
  - Constructor: `(canvas, map, palette)`.
  - Methods: `render(prev: SimSnapshot, next: SimSnapshot, alpha)`, `pick(x, y) → { kind: 'bus' | 'train' | 'stop' | 'person', id }`, `highlightRoute(id | null)`, `setPalette`, `setDetail`, `setLight`, `dispose`.
  - It uses an orthographic isometric camera with pan and zoom only. The kit (bus, train car, stop, station, building modules, tree, clock tower, stadium, role-based materials, the 3 palettes) is lifted from `.superpowers/wip/kit-sheet.html`.
  - Typography: **Gumball Rounded** (self-hosted `apps/web/public/fonts/GumballRounded.ttf`) for the wordmark, chips, labels, metric numbers and queue markers; Avenir Next Rounded Std → Nunito for body copy.
  - People use 2 InstancedMeshes (body and head). Positions are interpolated between ticks: vehicles by `dist` (with loop wrap), walkers by `t0/t1`, waiting people by queue slot along `queueDir`.
  - A waiting→riding transition plays a 1 s walk-to-door before the person is hidden.
  - **Highlight:** the selected route gets brighter; other routes and scenery lerp 60% toward the background.
- **SimRunner:** a fixed-step accumulator at 1×, 4×, 8× or 16× (default 8×). It pushes snapshots to the renderer every frame and to the HUD at 4 Hz. Headless full runs (champion and baseline on the same seed, finish-fast-forward) run in a Web Worker.
- **HUD:**
  - Top bar: wordmark, mode tabs, scenario chip with clock, speed chips, and metrics (mean wait, p95 wait, completion %, missed connections).
  - Legend: route chips that toggle highlighting.
  - Queue markers: count and longest wait as text, plus a severity color (ok < 180 s ≤ warn < 420 s ≤ bad).
  - Inspector:
    - **vehicle:** occupancy bar, next stop, latest `DecisionRecord.explanation`;
    - **stop:** queue by route, longest wait, next arrivals;
    - **person:** `PassengerInfo` journey and the reason they are waiting.
  - Toasts for transfer made, missed connection and walkaway.
  - Dispatcher dock (Play only): Dispatch · Hold 30 s · Reassign ▸ · Set train departure, each enabled only when legal.
- **Watch:** the champion policy loops through the showcase seeds; the user can switch the controller (g0 / ref / champion).
- **Play:**
  1. Run `stadium_exit` on the play seed. The results for the champion and g0 on the same seed are computed in the Web Worker at start.
  2. A "Finish" button fast-forwards the rest headlessly.
  3. The results screen compares You / Champion / Baseline (J plus the secondary metrics).
  4. Optionally submit a name and replay to the leaderboard. The player leaderboard is separate from the formal sealed evaluation.
- **Lab:**
  - A generation timeline and a J_train / J_val chart with horizontal reference lines for g0 and ref.
  - Per round: 3 proposal cards (model, emphasis, summary, valid, ΔJ, narrative).
  - A rule-level policy diff: added, removed and changed conditions, thresholds, actions and params.
  - "Replay on stadium exit" loads that policy into the viewer.
  - "Evolve next generation" asks for an admin token and streams `EvolveEvent`s.
  - A sealed-test panel, labeled "never shown to agents".
- **Performance budget:** 60 fps with ≤ 1,500 people, ≤ 10 draw calls for people and vehicles, average tick < 0.5 ms.
- **Stretch finale:** three sims (g0, champion, human replay) on one seed, rendered in 3 scissored viewports. The static scene is shared; each sim has its own dynamic layers.

## 11. Cloudflare (`apps/worker`)

- **Single Worker** named `headway`.
  - Assets: `assets: { directory: "../web/dist", binding: "ASSETS", not_found_handling: "single-page-application", run_worker_first: ["/api/*"] }`.
  - Hono router, `compatibility_flags: ["nodejs_compat"]`, `observability.enabled = true`.
  - `vars`: `SIM_VERSION`, `LUMINAL_BASE_URL`, `LUMINAL_MODEL`, `OPENROUTER_BASE_URL`, `JEV_MODEL`.
  - The D1 binding `DB` (database `headway`) uses the id printed by `wrangler d1 create headway` in Wave 0.
  - Rate-limiting binding: 30 req/min/IP on `/api/jev/decide` and 5/min/IP on leaderboard POSTs.
- **Secrets:** `LUMINAL_API_KEY`, `OPENROUTER_API_KEY`, `ADMIN_TOKEN`, `SEALED_TEST_SEEDS` (JSON). Local development uses `apps/worker/.dev.vars` (copied from the root `.env`); both are gitignored.

| Endpoint | Behavior |
|---|---|
| `GET /api/champion` | `{ policy, generation, train, val }` |
| `GET /api/generations` | `{ generations: summaries[], baseline: SplitScore, reference: SplitScore }` |
| `GET /api/generations/:id` | `{ generation, round }` (round includes its proposals) |
| `POST /api/evolve` (Bearer ADMIN_TOKEN) | runs 1 round. The response is an NDJSON stream of `EvolveEvent`. Each step is persisted to D1. One running round at a time, tracked in `rounds.status`; the lock goes stale after 10 min. |
| `GET /api/leaderboard?seed=` | top 20 for that play seed |
| `POST /api/leaderboard` | `{ name, replay }`. The server checks simVersion and mapVersion and confirms the seed is a play seed from the last 7 days. It re-simulates and stores the verified J. The name is at most 16 characters of `[A-Za-z0-9 _-]`. |
| `POST /api/jev/decide` | proxy to Jev via OpenRouter `/api/v1/systemone`: rate-limited, cached via the Cache API keyed by the request hash |
| `POST /api/admin/publish`, `POST /api/admin/sealed-eval`, `GET /api/sealed` | CLI publish; sealed evaluation of champion, g0 and ref; read the sealed results |

**D1 schema (migration `0001_init.sql`):**

```sql
CREATE TABLE rounds (id TEXT PRIMARY KEY, number INTEGER NOT NULL, champion_before TEXT NOT NULL, champion_after TEXT,
  status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, events_json TEXT NOT NULL DEFAULT '[]');
CREATE TABLE proposals (id TEXT PRIMARY KEY, round_id TEXT NOT NULL REFERENCES rounds(id), designer INTEGER NOT NULL,
  model TEXT NOT NULL, emphasis TEXT NOT NULL, summary TEXT, rationale TEXT, policy_json TEXT, valid INTEGER NOT NULL,
  errors_json TEXT, j_train REAL, j_val REAL, delta_train_pct REAL, metrics_json TEXT, findings_json TEXT, narrative TEXT);
CREATE TABLE generations (id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE, parent_id TEXT, from_proposal TEXT,
  policy_json TEXT NOT NULL, explanation TEXT NOT NULL, j_train REAL NOT NULL, j_val REAL NOT NULL,
  train_json TEXT NOT NULL, val_json TEXT NOT NULL, findings_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE leaderboard (id TEXT PRIMARY KEY, name TEXT NOT NULL, scenario_id TEXT NOT NULL, seed INTEGER NOT NULL,
  sim_version TEXT NOT NULL, j REAL NOT NULL, metrics_json TEXT NOT NULL, replay_json TEXT NOT NULL,
  verified INTEGER NOT NULL, champion_j REAL, ip_hash TEXT, created_at TEXT NOT NULL);
CREATE TABLE sealed_results (id TEXT PRIMARY KEY, policy_id TEXT NOT NULL, sim_version TEXT NOT NULL,
  j_test REAL NOT NULL, metrics_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX leaderboard_seed_j ON leaderboard(seed, j);
```

**CPU plan (checked in Wave 0).**
- **Workers Paid:** set `limits.cpu_ms = 60000`. Server-side evolve and leaderboard verification run in the Worker.
- **Workers Free** (10 ms CPU per request): no sims run in the Worker.
  - Evolution runs only in the CLI, followed by `--publish`.
  - Leaderboard rows are stored with `verified = 0` and shown with a badge.
  - `pnpm verify:leaderboard` re-simulates them from the CLI.
  - The Lab's Evolve button becomes "runs offline" text.

## 12. Testing and verification

- **Determinism (sim):** the same `(map, scenario, seed, controller)` run twice gives an identical `RunResult.hash`. The hash is FNV-1a over the canonical JSON of the metrics, stops and findings. The web smoke test checks that the in-browser hash equals the Node hash for one showcase seed.
- **Golden journey (sim):** a one-passenger scenario from Apartments South to University, with the itinerary forced through the sim's internal test hook. Its event sequence must be walk → wait → board r2 → alight central → walk to platform → board train → alight university → walk → arrive, with timings inside computed bounds.
- **Policy:** `g0`, `ref` and the §6 example validate. Rejection tests cover an unknown feature, an out-of-range value, a bad op, an allocation that doesn't sum to 6, more than 24 rules and an unknown placeholder. An "LLM-style" response in a fenced block with trailing prose must still extract.
- **Sanity gates (tuning):**
  - On train, `ref` must beat `g0` by at least 5% J, otherwise demand or fleet need retuning.
  - g0's stadium_exit completion must be at least 85%.
  - g0 must produce at least one service gap over 10 min and at least 10 missed connections, so the problem is visible.
  - A stadium_exit run must take under 150 ms in Node.
- **Evolve:** runs against a fake `LlmClient` returning canned JSON, both valid and broken, and checks the repair path, the promotion rule, the narratives and the emitted events.
- **Worker:** `vitest` with the Workers pool, covering endpoint shapes, admin auth and leaderboard re-simulation.
- **Web smoke:** headless Chrome loads the dev URL or the deployed URL. The canvas must not be blank, there must be no console errors, and Watch must advance sim time.
- **Deploy smoke:** `curl` checks that `/api/champion` validates and `/api/generations` returns at least 1 entry.

## 13. Build waves and checkpoints

**Wave 0: foundation** (1 agent, sequential, about 45 min)
- Monorepo scaffold, `.npmrc` and `.gitignore`.
- All known dependencies installed up front, so Wave 1 never touches the root `package.json` or lockfile.
- `contracts.ts` verbatim from §4.
- `town.ts`: §4 topology with geometry authored to the kit's scale, plus a top-down map overlay render for review.
- Scenario defs, the policy zod schema, and `g0.json` / `ref.json`.
- A stub `createSim` that satisfies `Sim`, moving vehicles along their paths with fake queues, so the web track can start.
- `wrangler d1 create`, a Workers plan check, and a hello-world deploy.

**Checkpoint A:** palette pick, the map overlay screenshot and the hello-world URL.

**Wave 1: parallel tracks** (workflow, one agent per track, disjoint directories)

| Track | Owns | Consumes | Delivers |
|---|---|---|---|
| T1 Sim engine | `packages/sim/src/{engine,passengers,controllers,policy,metrics,findings}` | contracts, town, scenarios | `createSim/runSync/runAsync`, g0/ref/PolicyController, findings, tests in §12 |
| T2 Renderer | `apps/web/src/render` | contracts, town, stub sim | TownRenderer per §10, against stub snapshots |
| T3 HUD and modes | `apps/web/src/{ui,app,state}` | contracts, fixtures (`RunResult`, `Generation`, `EvolveEvent`) | Watch/Play/Lab shells, dispatcher dock, inspector, results, Lab chart/diff |
| T4 Evolve | `packages/evolve` | contracts, policy schema, the `runSync` signature | LlmClient (Luminal + OpenRouter fallback), prompts, extraction/repair, `runRound`, narratives, CLI, fake-LLM tests |
| T5 Worker | `apps/worker` | contracts, the evolve and sim signatures | Hono API, D1 migration, NDJSON evolve, leaderboard verify, Jev proxy, deploy script |
| T6 Jev | `packages/evolve/src/jev`, `packages/sim/src/controllers/advisor.ts` | contracts, research brief, PolicyController | `JevProvider`, `JevController` (wrapping PolicyController), situation templates, decision logging |

T2 and T3 integrate through the store. T4 and T5 run against stubs until T1 lands.

**Checkpoint B:**
- the golden journey is visible in the browser;
- the determinism and validator tests are green;
- the first real Luminal proposals validate;
- the API is live with fixtures.

**Wave 2: integration** (2–3 agents, about 60 min)
- Wire the real sim into the web app: Watch, Play end-to-end with results and leaderboard, and Lab with real data.
- Tune scenarios until the §12 sanity gates pass.
- Run 3–6 evolution rounds via the CLI, publish them, and deploy.

**Checkpoint C:** the user plays the deployed URL.

**Wave 3: polish and demo** (parallel)
- Readability polish: queue markers, toasts, inspector copy, dusk lighting for stadium exit.
- Sealed evaluation.
- Jev comparison runs.
- Stretch finale.
- Demo script plus a recorded backup.

**Checkpoint D:** demo rehearsal.

**Cut order if time runs short:**
1. 3-way finale
2. Live Jev in the browser (keep the recorded comparison)
3. Worker-side evolve (use the CLI and publish)
4. Leaderboard verification (keep unverified rows)
5. class_change polish (keep it only as a training scenario)

## 14. Risks and fallbacks

| Risk | Fallback |
|---|---|
| Luminal latency or malformed JSON | Extraction plus one repair; 90 s timeout; partial rounds are allowed. Run rounds via the CLI ahead of the demo so the Lab never depends on a live call. |
| Luminal outage or rate limit (60 req/min) | Per-call fallback to OpenRouter `deepseek/deepseek-v4-pro`; the proposal records which model answered. |
| Workers CPU limits (Free plan) | The §11 Free-plan path: CLI evolve + publish, unverified leaderboard plus CLI verification. |
| Evolve stream drops mid-round | Each step is persisted. A stale `running` round becomes `failed` after 10 min, and the champion changes only on a completed promotion. Cloudflare Workflows is the stretch upgrade. |
| Jev latency or availability | Rules fallback after 800 ms; decisions are cached and logged; the demo uses recorded Jev replays. |
| Evolution shows no gain | The §12 gates guarantee headroom (ref beats g0 by ≥ 5%). Keep a manual "seed idea" emphasis and ≥ 4 rounds before the demo. |
| Overfitting to training seeds | Val gate on promotion; sealed test is reported separately; failures are shown alongside gains. |
| Performance with about 1.5k people | Instancing, no per-person React state, headless runs in a Web Worker. Cap stadium_exit at 1,200 plus background if needed. |
| Browser and Worker determinism drift | Integer ticks, pre-drawn randomness, no transcendental math in state updates, `simVersion` on every replay, cross-runtime hash test. |
| Parallel agents collide | Disjoint directory ownership, pre-installed dependencies, contracts frozen after Wave 0 (changes go through the parent only). |
| npm registry auth | Repo `.npmrc` pins the public registry. |
