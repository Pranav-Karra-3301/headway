// Owner: Task P. Sample play-seed results (stadium_exit, seed 50000, clock 21:30) for the HUD and the Play results
// screen: the baseline g0, the champion g4 and a "sensible human" who plays g0 plus six interventions.
// Treat as read-only (structuredClone before editing).
import type { ControllerRef, FailureFinding, Intent, Replay, RunResult, StopStats } from '@headway/sim';
import { CLOCK, F, MAP_VERSION, SIM_VERSION, byImpact, fnv1a, metrics, platform, scaleJ, stop, type MetricsSpec } from './build';

export const PLAY_SEED = 50000;
const SE = CLOCK.stadium_exit;
const SPAWNED = 1524; // identical crowd for every controller on this seed

function run(controller: ControllerRef, spec: MetricsSpec, stops: StopStats[], findings: FailureFinding[], ruleFires: Record<string, number>): RunResult {
  const m = metrics(spec);
  const sorted = byImpact(findings);
  return {
    simVersion: SIM_VERSION, mapVersion: MAP_VERSION, scenarioId: 'stadium_exit', seed: PLAY_SEED, controller,
    metrics: m, stops, findings: sorted, ruleFires, hash: fnv1a({ metrics: m, stops, findings: sorted }),
  };
}

const J_G0 = 2_301_750;

/** Baseline g0: the stadium crowd overwhelms Route 3 and Apartments South waits 14 min for a bus. */
export const RUN_G0: RunResult = run(
  { kind: 'policy', policyId: 'g0' },
  { J: J_G0, spawned: SPAWNED, completed: 1339, wait: [312, 1086, 1742], transfersMade: 214, missedConnections: 47,
    leftBehind: 236, walkaways: 61, effort: [3786.4, 0, 1920, 945] },
  [
    { id: 'stop_stadium_gate', maxQueue: 188, meanWaitS: 512, maxGapS: { r3: 545 } },
    { id: 'stop_stadium_stn', maxQueue: 61, meanWaitS: 356, maxGapS: { r3: 560 } },
    { id: 'stop_university_stn', maxQueue: 23, meanWaitS: 218, maxGapS: { r1: 470 } },
    { id: 'stop_old_main', maxQueue: 39, meanWaitS: 241, maxGapS: { r1: 455, r3: 615 } },
    { id: 'stop_downtown', maxQueue: 58, meanWaitS: 236, maxGapS: { r1: 480, r2: 590, r3: 640 } },
    { id: 'stop_central_stn', maxQueue: 76, meanWaitS: 271, maxGapS: { r1: 430, r2: 565 } },
    { id: 'stop_apts_north', maxQueue: 33, meanWaitS: 294, maxGapS: { r2: 720 } },
    { id: 'stop_apts_south', maxQueue: 41, meanWaitS: 329, maxGapS: { r2: 840 } },
  ],
  [
    F.overload(stop('stop_stadium_gate'), 'r3', 96, 188),
    F.overload(platform('stn_stadium'), 'train', 74, 236),
    F.gap(SE, 'stop_apts_south', 'r2', 1320, 2160, 41),
    F.missed(stop('stop_central_stn'), 'train', 'r2', 38, [1250, 1370]),
    F.unused('r1', 0.29, { stopId: 'stop_stadium_gate', queue: 188 }),
    F.bunching('r1', 'stop_downtown', 4, 40),
  ],
  { 'even-headway': 14, default: 163 },
);

/** Champion g4: pre-staged Stadium buses, transfer holds at Central, the train waits for a close bus. */
export const RUN_CHAMPION: RunResult = run(
  { kind: 'policy', policyId: 'g4' },
  { J: scaleJ(J_G0, -17.1), spawned: SPAWNED, completed: 1436, wait: [241, 842, 1395], transfersMade: 236, missedConnections: 14,
    leftBehind: 92, walkaways: 22, effort: [3702.8, 118.6, 2310, 1170] },
  [
    { id: 'stop_stadium_gate', maxQueue: 104, meanWaitS: 341, maxGapS: { r3: 420 } },
    { id: 'stop_stadium_stn', maxQueue: 44, meanWaitS: 268, maxGapS: { r3: 455 } },
    { id: 'stop_university_stn', maxQueue: 21, meanWaitS: 209, maxGapS: { r1: 520 } },
    { id: 'stop_old_main', maxQueue: 31, meanWaitS: 214, maxGapS: { r1: 470, r3: 480 } },
    { id: 'stop_downtown', maxQueue: 47, meanWaitS: 205, maxGapS: { r1: 465, r2: 560, r3: 505 } },
    { id: 'stop_central_stn', maxQueue: 52, meanWaitS: 229, maxGapS: { r1: 440, r2: 545 } },
    { id: 'stop_apts_north', maxQueue: 28, meanWaitS: 247, maxGapS: { r2: 610 } },
    { id: 'stop_apts_south', maxQueue: 33, meanWaitS: 268, maxGapS: { r2: 660 } },
  ],
  [
    F.overload(stop('stop_stadium_gate'), 'r3', 31, 104),
    F.overload(platform('stn_stadium'), 'train', 38, 171),
    F.gap(SE, 'stop_apts_south', 'r2', 1500, 2160, 29),
    F.missed(stop('stop_central_stn'), 'train', 'r2', 9, [1260, 1350]),
    F.bunching('r3', 'stop_downtown', 2, 65),
    F.longHold('b3', 'stop_central_stn', 45, 14, 19),
  ],
  { 'prestage-stadium': 3, 'return-from-stadium': 2, 'hold-for-connection': 6, 'anti-bunch': 9, 'even-headway': 12, 'train-meets-bus': 4, default: 141 },
);

/** What the "sensible human" did (Play mode intents; clock = 21:30 + t). */
export const HUMAN_INTENTS: Array<{ t: number; intent: Intent }> = [
  { t: 300, intent: { type: 'reassign', vehicleId: 'b1', to: 'r3' } },      // pre-stage a Campus Loop bus for the stadium
  { t: 640, intent: { type: 'setTrainDeparture', dwellS: 75 } },             // let the train load more of the crowd
  { t: 790, intent: { type: 'hold', vehicleId: 'b3', seconds: 60 } },        // hold Route 2 at Central for the first train
  { t: 985, intent: { type: 'hold', vehicleId: 'b6', seconds: 30 } },        // hold Route 3 at Stadium Station for transfers
  { t: 1210, intent: { type: 'dispatch', vehicleId: 'b4' } },                // send Route 2 early, Apartments is queuing
  { t: 1630, intent: { type: 'reassign', vehicleId: 'b1', to: 'r1' } },      // give the bus back to Campus Loop
];

/** The human beat g0 by 7.4% but left University without Route 1 for 13 min. */
export const RUN_HUMAN: RunResult = run(
  { kind: 'human', basePolicyId: 'g0' },
  { J: scaleJ(J_G0, -7.4), spawned: SPAWNED, completed: 1381, wait: [281, 978, 1610], transfersMade: 222, missedConnections: 29,
    leftBehind: 158, walkaways: 41, effort: [3748.2, 64.3, 2040, 975] },
  [
    { id: 'stop_stadium_gate', maxQueue: 150, meanWaitS: 428, maxGapS: { r3: 470 } },
    { id: 'stop_stadium_stn', maxQueue: 52, meanWaitS: 311, maxGapS: { r3: 500 } },
    { id: 'stop_university_stn', maxQueue: 26, meanWaitS: 302, maxGapS: { r1: 780 } },
    { id: 'stop_old_main', maxQueue: 36, meanWaitS: 236, maxGapS: { r1: 610, r3: 540 } },
    { id: 'stop_downtown', maxQueue: 51, meanWaitS: 224, maxGapS: { r1: 600, r2: 580, r3: 560 } },
    { id: 'stop_central_stn', maxQueue: 66, meanWaitS: 257, maxGapS: { r1: 520, r2: 555 } },
    { id: 'stop_apts_north', maxQueue: 31, meanWaitS: 282, maxGapS: { r2: 700 } },
    { id: 'stop_apts_south', maxQueue: 37, meanWaitS: 301, maxGapS: { r2: 780 } },
  ],
  [
    F.overload(stop('stop_stadium_gate'), 'r3', 58, 150),
    F.overload(platform('stn_stadium'), 'train', 61, 214),
    F.gap(SE, 'stop_apts_south', 'r2', 1380, 2160, 37),
    F.gap(SE, 'stop_university_stn', 'r1', 900, 1680, 26),
    F.missed(stop('stop_central_stn'), 'train', 'r2', 21, [1250, 1360]),
    F.longHold('b3', 'stop_central_stn', 60, 22, 17),
  ],
  { 'even-headway': 13, human: HUMAN_INTENTS.length, default: 158 },
);

export const HUMAN_REPLAY: Replay = {
  simVersion: SIM_VERSION, mapVersion: MAP_VERSION, scenarioId: 'stadium_exit', seed: PLAY_SEED,
  controller: { kind: 'human', basePolicyId: 'g0' }, intents: HUMAN_INTENTS,
};

export const RUN_RESULTS: { g0: RunResult; champion: RunResult; human: RunResult } = { g0: RUN_G0, champion: RUN_CHAMPION, human: RUN_HUMAN };

/** Drop-in for the store's `play.results`. */
export const PLAY_RESULTS: { you: RunResult; champion: RunResult; baseline: RunResult } = { you: RUN_HUMAN, champion: RUN_CHAMPION, baseline: RUN_G0 };

/** `fetchLeaderboard(50000)` sample: lower J is better; one player beat the AI, one row is unverified. */
export const LEADERBOARD: Array<{ name: string; j: number; verified: boolean }> = [
  { name: 'jules', j: 1_889_940, verified: true },
  { name: 'mira', j: 1_986_300, verified: true },
  { name: 'transit-tom', j: RUN_HUMAN.metrics.J, verified: true },
  { name: 'bus_whisperer', j: 2_204_880, verified: true },
  { name: 'anon 42', j: 2_288_900, verified: false },
];
