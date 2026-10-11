// Owner: Task P. Sample evolution history for the Lab: generations g0…g4 promoted over rounds R1…R5 (R3 rejected:
// validation worse), 3 designer proposals per round, plus the baseline and the hand-written reference as chart lines.
// Scores are train = 8 runs (stadium_exit + class_change × 4 seeds), val = 4 runs. Treat as read-only.
import {
  EXAMPLE_G3, G0, validatePolicy,
  type Emphasis, type FailureFinding, type Generation, type Policy, type Proposal, type Round, type Rule, type SplitScore,
} from '@headway/sim';
import {
  CLOCK, F, FALLBACK_MODEL, LUMINAL_AUTHOR, OPENROUTER_AUTHOR, PRIMARY_MODEL, amend, narrate, pctChange, platform, score,
  signedPct, stop, variant, type MetricsSpec,
} from './build';

const SE = CLOCK.stadium_exit;
const CC = CLOCK.class_change;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const ruleIn = (p: Policy, id: string): Rule => p.rules.find((r) => r.id === id)!;

// ---------- policies ----------
const EVEN_HEADWAY = (): Rule => clone(G0.rules[0]!);
const ANTI_BUNCH = (): Rule => clone(ruleIn(EXAMPLE_G3, 'anti-bunch'));
const PRESTAGE = (): Rule => clone(ruleIn(EXAMPLE_G3, 'prestage-stadium'));
const MOVE_TO_BUSIEST = (): Rule => ({
  id: 'move-to-busiest', on: 'bus_at_terminal', priority: 20,
  when: [{ f: 'queue_ratio_other', op: '>=', v: 2 }, { f: 'max_other_route_queue', op: '>=', v: 30 }, { f: 'buses_on_route', op: '>=', v: 2 }],
  do: { type: 'reassign', to: 'busiest' },
  say: 'Moving to the busiest route ({to}): {max_other_route_queue} waiting there, {route_queue} here',
});
const HOLD_FOR_TRAIN = (): Rule => ({
  id: 'hold-for-train', on: 'bus_at_stop', priority: 20,
  when: [{ f: 'is_station', op: '==', v: 1 }, { f: 'train_eta_s', op: '<=', v: 30 }, { f: 'expected_transfers', op: '>=', v: 5 }],
  do: { type: 'hold', seconds: 30 },
  say: 'Holding {seconds}s for the train: {expected_transfers} transfers, {train_eta_s}s away',
});
const WAIT_FOR_TRAIN = (): Rule => ({
  id: 'wait-for-train', on: 'bus_at_stop', priority: 20,
  when: [{ f: 'train_eta_s', op: '<=', v: 60 }, { f: 'expected_transfers', op: '>=', v: 4 }],
  do: { type: 'hold', seconds: 60 },
  say: 'Holding {seconds}s: the train brings {expected_transfers} transfers in {train_eta_s}s',
});
const HOLD_FOR_CONNECTION_6 = (): Rule => ({
  id: 'hold-for-connection', on: 'bus_at_stop', priority: 20,
  when: [{ f: 'train_eta_s', op: '<=', v: 45 }, { f: 'expected_transfers', op: '>=', v: 6 }],
  do: { type: 'hold', seconds: 45 },
  say: 'Holding {seconds}s for the train ({train_eta_s}s away, {expected_transfers} transfers)',
});
const DISPATCH_BIG_QUEUE = (): Rule => ({
  id: 'dispatch-big-queue', on: 'bus_at_terminal', priority: 25,
  when: [{ f: 'route_queue', op: '>=', v: 40 }],
  do: { type: 'dispatch' },
  say: 'Leaving now: {route_queue} people are waiting for this route',
});
const RETURN_FROM_STADIUM = (): Rule => ({
  id: 'return-from-stadium', on: 'bus_at_terminal', priority: 25,
  when: [
    { f: 'event_in_s', op: '<=', v: -900 }, { f: 'route_queue', op: '<', v: 10 },
    { f: 'max_other_route_queue', op: '>=', v: 30 }, { f: 'buses_on_route', op: '>=', v: 3 },
  ],
  do: { type: 'reassign', to: 'busiest' },
  say: 'Crowd cleared ({route_queue} waiting): moving to {to}, where {max_other_route_queue} wait',
});

/** A designer's proposal: the champion plus at most 3 edits, stamped like the round runner does. */
function propose(champion: Policy, id: string, emphasis: Emphasis, summary: string, edit: (p: Policy) => void, author = LUMINAL_AUTHOR): Policy {
  const p = clone(champion);
  p.meta = { id, parent: champion.meta.id, generation: champion.meta.generation + 1, author, emphasis, summary };
  edit(p);
  return p;
}
/** A promoted copy: meta.id = gN, parent = the previous champion. */
const promote = (p: Policy, id: string): Policy => ({ ...clone(p), meta: { ...p.meta, id } });

const SUMMARY = {
  r1a: 'Space out bunched buses: hold at a stop until the target headway when less than half a headway behind the bus ahead, unless 40+ wait downstream.',
  r1b: 'Move a spare bus to the busiest route at the terminal when another route has twice the queue and 30+ waiting.',
  r1c: 'Hold up to 30 s at station stops when a train with 5+ transfers is under 30 s away.',
  r2a: 'Pre-stage a spare bus at Stadium Gate from 5 min before closing to 10 min after, when its own route has fewer than 25 waiting.',
  r2b: 'Hold 60 s at station stops for any train within a minute carrying 4+ transfers.',
  r2c: 'Tighten target headways on Apartments (240 s) and Stadium (210 s) so terminal holds release buses sooner.',
  r3a: 'Hold 45 s at station stops for a train within 45 s carrying 6+ transfers.',
  r3b: 'Widen anti-bunching: hold when under 60% of the target headway unless 60+ wait downstream.',
  r3c: 'Shift a bus from Campus Loop to Apartments (1/3/2) to close the Apartments South service gap.',
  r4a: "Gentler spacing: hold only below 45% of the target headway and only while the loop's hold budget has 60 s left.",
  r4b: 'Leave the terminal at once when 40+ people wait for the route, even if the headway is short.',
  r5a: 'Pre-stage for Stadium 7 min before closing, and send surplus Stadium buses to the busiest route once the crowd has cleared.',
  r5b: 'Let the train wait 90 s when a bus arrives within a minute and the platform is quiet.',
  r5c: 'Even out spacing with longer stop holds whenever a bus runs closer than 70% of the target headway.',
};

const G0_POLICY = clone(G0);
const R1A = propose(G0_POLICY, 'r1-a', 'spacing', SUMMARY.r1a, (p) => { p.rules = [ANTI_BUNCH(), EVEN_HEADWAY()]; });
const R1B = propose(G0_POLICY, 'r1-b', 'allocation', SUMMARY.r1b, (p) => { p.rules.unshift(MOVE_TO_BUSIEST()); });
const R1C = propose(G0_POLICY, 'r1-c', 'transfers', SUMMARY.r1c, (p) => { p.rules.unshift(HOLD_FOR_TRAIN()); });
const G1_POLICY = promote(R1A, 'g1');

const R2A = propose(G1_POLICY, 'r2-a', 'allocation', SUMMARY.r2a, (p) => { p.rules.unshift(PRESTAGE()); });
const R2B = propose(G1_POLICY, 'r2-b', 'transfers', SUMMARY.r2b, (p) => { p.rules.unshift(WAIT_FOR_TRAIN()); });
const R2C = propose(G1_POLICY, 'r2-c', 'spacing', SUMMARY.r2c, (p) => { p.params.targetHeadwayS = { r2: 240, r3: 210 }; });
const G2_POLICY = promote(R2A, 'g2');

const R3A = propose(G2_POLICY, 'r3-a', 'transfers', SUMMARY.r3a, (p) => { p.rules.splice(1, 0, HOLD_FOR_CONNECTION_6()); });
const R3B = propose(G2_POLICY, 'r3-b', 'spacing', SUMMARY.r3b, (p) => {
  ruleIn(p, 'anti-bunch').when = [{ f: 'headway_ratio', op: '<', v: 0.6 }, { f: 'downstream_queue', op: '<', v: 60 }];
});
const R3C = propose(G2_POLICY, 'r3-c', 'allocation', SUMMARY.r3c, (p) => { p.params.allocation = { r1: 1, r2: 3, r3: 2 }; });

const R4A = propose(G2_POLICY, 'r4-a', 'spacing', SUMMARY.r4a, (p) => {
  ruleIn(p, 'anti-bunch').when = [
    { f: 'headway_ratio', op: '<', v: 0.45 }, { f: 'downstream_queue', op: '<', v: 40 }, { f: 'hold_used_s', op: '<', v: 120 },
  ];
});
const R4B = propose(G2_POLICY, 'r4-b', 'allocation', SUMMARY.r4b, (p) => { p.rules.splice(1, 0, DISPATCH_BIG_QUEUE()); });
const G3_POLICY = clone(EXAMPLE_G3); // the spec §6 example is exactly g3
const R4C: Policy = { ...clone(G3_POLICY), meta: { ...G3_POLICY.meta, id: 'r4-c' } };

const R5A = propose(G3_POLICY, 'r5-a', 'allocation', SUMMARY.r5a, (p) => {
  ruleIn(p, 'prestage-stadium').when[0]!.v = 420;
  p.rules.splice(1, 0, RETURN_FROM_STADIUM());
});
const R5B = propose(G3_POLICY, 'r5-b', 'transfers', SUMMARY.r5b, (p) => {
  const r = ruleIn(p, 'train-meets-bus');
  r.when[0]!.v = 60;
  r.do = { type: 'setTrainDeparture', dwellS: 90 };
}, OPENROUTER_AUTHOR);
const G4_POLICY = promote(R5A, 'g4');

// r5-c never validates: the first reply and the repaired reply both break the DSL (errors come from the real validator).
const R5C_FIRST = propose(G3_POLICY, 'r5-c', 'spacing', SUMMARY.r5c, (p) => {
  ruleIn(p, 'anti-bunch').when[0] = { f: 'gap_ahead_s', op: '<', v: 120 };
  p.rules.push({
    id: 'even_spacing', on: 'bus_at_stop', priority: 15, when: [{ f: 'headway_ratio', op: '<', v: 0.7 }],
    do: { type: 'hold', seconds: 150 }, say: 'Holding {seconds}s to even out the gap to {bus_ahead}',
  });
});
const R5C_REPAIRED = propose(G3_POLICY, 'r5-c', 'spacing', SUMMARY.r5c, (p) => {
  p.rules.push({
    id: 'even-spacing', on: 'bus_at_stop', priority: 15, when: [{ f: 'headway_ratio', op: '<', v: 0.7 }],
    do: { type: 'hold', seconds: 120 }, say: 'Holding {seconds}s to even out the spacing',
  });
});
const errorsOf = (p: unknown): string[] => {
  const r = validatePolicy(p);
  return r.ok ? [] : r.errors;
};

// ---------- scores ----------
// train: 8 runs, 9,614 riders; val: 4 runs, 4,786 riders. ΔJ_train per generation −6.1 / −4.8 / −5.3 / −4.2 %.
const T0: MetricsSpec = {
  J: 12_418_560, spawned: 9614, completed: 8768, wait: [286, 1020, 1812], transfersMade: 1342, missedConnections: 212,
  leftBehind: 941, walkaways: 263, effort: [30184.6, 0, 15360, 7560],
};
const T1 = variant(T0, -6.1, { completed: 8835, wait: [262, 941, 1744], transfersMade: 1361, missedConnections: 205, leftBehind: 874, walkaways: 228, effort: [29912.3, 0, 17840, 7560] });
const T2 = variant(T1, -4.8, { completed: 8941, wait: [241, 873, 1688], transfersMade: 1377, missedConnections: 198, leftBehind: 702, walkaways: 187, effort: [30046.9, 512.4, 18120, 7560] });
const T3 = variant(T2, -5.3, { completed: 8999, wait: [229, 822, 1630], transfersMade: 1421, missedConnections: 121, leftBehind: 655, walkaways: 164, effort: [29874.1, 536.8, 20410, 8385] });
const T4 = variant(T3, -4.2, { completed: 9056, wait: [214, 776, 1571], transfersMade: 1433, missedConnections: 117, leftBehind: 571, walkaways: 139, effort: [29961.5, 694.2, 20180, 8410] });
const T_REF = variant(T0, -9.8, { completed: 8903, wait: [251, 902, 1705], transfersMade: 1352, missedConnections: 207, leftBehind: 763, walkaways: 201, effort: [30421.7, 388.5, 16950, 7560] });

const V0: MetricsSpec = {
  J: 6_190_240, spawned: 4786, completed: 4374, wait: [289, 1031, 1790], transfersMade: 668, missedConnections: 104,
  leftBehind: 455, walkaways: 129, effort: [15102.2, 0, 7710, 3780],
};
const V1 = variant(V0, -5.4, { completed: 4403, wait: [266, 954, 1731], transfersMade: 677, missedConnections: 101, leftBehind: 431, walkaways: 112, effort: [14967.5, 0, 8950, 3780] });
const V2 = variant(V1, -4.1, { completed: 4456, wait: [246, 889, 1676], transfersMade: 684, missedConnections: 97, leftBehind: 349, walkaways: 93, effort: [15031.8, 251.9, 9080, 3780] });
const V3 = variant(V2, -5.9, { completed: 4484, wait: [232, 834, 1624], transfersMade: 706, missedConnections: 63, leftBehind: 322, walkaways: 81, effort: [14940.6, 266, 10240, 4195] });
const V4 = variant(V3, -3.6, { completed: 4513, wait: [219, 788, 1566], transfersMade: 711, missedConnections: 60, leftBehind: 284, walkaways: 70, effort: [14988.3, 347.5, 10105, 4205] });
const V_REF = variant(V0, -8.7, { completed: 4437, wait: [254, 911, 1698], transfersMade: 671, missedConnections: 103, leftBehind: 377, walkaways: 99, effort: [15215.4, 193.1, 8470, 3780] });

const TRAIN = [T0, T1, T2, T3, T4].map((s) => score(s, 8));
const VAL = [V0, V1, V2, V3, V4].map((s) => score(s, 4));

// ---------- findings (top findings over the train runs; stadium_exit clock 21:30, class_change 11:45) ----------
const AT_GATE = stop('stop_stadium_gate');
const AT_CENTRAL = stop('stop_central_stn');
const FINDINGS: FailureFinding[][] = [
  amend([], [ // g0
    F.overload(AT_GATE, 'r3', 118, 214),
    F.gap(SE, 'stop_apts_south', 'r2', 1320, 2160, 52),
    F.missed(AT_CENTRAL, 'train', 'r2', 38, [1260, 1380]),
    F.unused('r1', 0.29, { stopId: 'stop_stadium_gate', queue: 214 }),
    F.bunching('r1', 'stop_old_main', 6, 25),
    F.gap(CC, 'stop_university_stn', 'r1', 1380, 2040, 23),
  ]),
  amend([], [ // g1: spacing holds
    F.overload(AT_GATE, 'r3', 109, 205),
    F.gap(SE, 'stop_apts_south', 'r2', 1380, 2160, 47),
    F.missed(AT_CENTRAL, 'train', 'r2', 36, [1260, 1380]),
    F.unused('r1', 0.31, { stopId: 'stop_stadium_gate', queue: 205 }),
    F.gap(CC, 'stop_university_stn', 'r1', 1440, 2040, 20),
    F.bunching('r1', 'stop_old_main', 2, 70),
    F.longHold('b2', 'stop_downtown', 52, 18, 0),
  ]),
  amend([], [ // g2: pre-staging for the stadium
    F.overload(AT_GATE, 'r3', 54, 131),
    F.gap(SE, 'stop_apts_south', 'r2', 1440, 2220, 44),
    F.missed(AT_CENTRAL, 'train', 'r2', 35, [1260, 1380]),
    F.gap(CC, 'stop_university_stn', 'r1', 1440, 2040, 20),
    F.bunching('r3', 'stop_downtown', 3, 50),
    F.unused('r1', 0.38, { stopId: 'stop_apts_south', queue: 44 }),
    F.longHold('b2', 'stop_downtown', 52, 18, 0),
  ]),
  amend([], [ // g3: transfer holds at Central, the train meets close buses
    F.overload(AT_GATE, 'r3', 49, 124),
    F.gap(SE, 'stop_apts_south', 'r2', 1500, 2220, 41),
    F.gap(CC, 'stop_university_stn', 'r1', 1500, 2040, 18),
    F.bunching('r3', 'stop_downtown', 3, 55),
    F.missed(AT_CENTRAL, 'train', 'r2', 9, [1270, 1350]),
    F.longHold('b2', 'stop_downtown', 52, 18, 0),
    F.longHold('b3', 'stop_central_stn', 45, 14, 19),
  ]),
  amend([], [ // g4: earlier pre-staging, surplus Stadium buses return
    F.overload(AT_GATE, 'r3', 31, 104),
    F.gap(SE, 'stop_apts_south', 'r2', 1500, 2160, 36),
    F.gap(CC, 'stop_university_stn', 'r1', 1500, 2040, 17),
    F.bunching('r3', 'stop_downtown', 2, 60),
    F.bunching('r2', 'stop_apts_north', 2, 45),
    F.missed(AT_CENTRAL, 'train', 'r2', 8, [1270, 1350]),
    F.longHold('b2', 'stop_downtown', 52, 18, 0),
    F.longHold('b3', 'stop_central_stn', 45, 13, 18),
  ]),
];

// ---------- proposals and rounds ----------
interface Champion { id: string; number: number; train: SplitScore; findings: FailureFinding[] }
interface Draft {
  emphasis: Emphasis; summary: string; rationale: string; policy: Policy | null; model?: string;
  train?: SplitScore; val?: SplitScore; findings?: FailureFinding[]; verdict: string; errors?: string[];
}

/** Narrative heads as streamed in `scored` events (before the round's verdict is appended). */
const SCORED: Record<string, string> = {};

function proposals(roundNumber: number, champ: Champion, drafts: [Draft, Draft, Draft]): Proposal[] {
  return drafts.map((d, i): Proposal => {
    const id = `r${roundNumber}-${'abc'[i]}`;
    const base = { id, roundId: `R${roundNumber}`, designer: i as 0 | 1 | 2, model: d.model ?? PRIMARY_MODEL, emphasis: d.emphasis, summary: d.summary, rationale: d.rationale };
    if (!d.policy || !d.train) {
      return { ...base, policy: null, valid: false, errors: d.errors ?? [], train: null, val: null, deltaTrainPct: null, findings: [], narrative: d.verdict };
    }
    const deltaTrainPct = pctChange(d.train.J, champ.train.J);
    const findings = d.findings ?? champ.findings;
    SCORED[id] = narrate(findings, champ.findings, deltaTrainPct);
    return {
      ...base, policy: d.policy, valid: true, errors: [], train: d.train, val: d.val ?? null, deltaTrainPct, findings,
      narrative: `${SCORED[id]} ${d.verdict}`,
    };
  });
}

const sibling = (champ: SplitScore, base: MetricsSpec, pct: number, over: Partial<MetricsSpec> = {}) => score(variant({ ...base, J: champ.J }, pct, over), champ.runs);

const champ = (n: number): Champion => ({ id: `g${n}`, number: n, train: TRAIN[n]!, findings: FINDINGS[n]! });
const C0 = champ(0);
const C1 = champ(1);
const C2 = champ(2);
const C3 = champ(3);

const R1_PROPOSALS = proposals(1, C0, [
  {
    emphasis: 'spacing', summary: SUMMARY.r1a, policy: R1A, train: TRAIN[1], val: VAL[1], findings: FINDINGS[1], verdict: 'Promoted to g1.',
    rationale: 'Route 1 buses arrive in pairs after the class change and at Downtown during the stadium surge, so one bus runs full while the next runs empty. Holding the follower until it is back on headway spreads the load; skipping the hold when 40+ wait downstream protects busy stops.',
  },
  {
    emphasis: 'allocation', summary: SUMMARY.r1b, policy: R1B, train: sibling(C0.train, T0, -3.2, { completed: 8801, leftBehind: 860, effort: [30310.4, 402.7, 15060, 7560] }),
    findings: amend(C0.findings, [F.overload(AT_GATE, 'r3', 97, 190), F.gap(CC, 'stop_university_stn', 'r1', 1320, 2100, 27)], [(f) => f.kind === 'unused_capacity']),
    verdict: 'Not promoted: r1-a was better.',
    rationale: 'Route 1 runs mostly empty while Stadium Gate queues 200+. Moving a spare bus to the route with twice the queue puts seats where the riders are.',
  },
  {
    emphasis: 'transfers', summary: SUMMARY.r1c, policy: R1C, train: sibling(C0.train, T0, -0.6, { missedConnections: 171, transfersMade: 1371, effort: [30102.8, 0, 16440, 7560] }),
    findings: amend(C0.findings, [F.missed(AT_CENTRAL, 'train', 'r2', 22, [1260, 1380]), F.longHold('b3', 'stop_central_stn', 30, 25, 14)]),
    verdict: 'Not promoted: r1-a was better.',
    rationale: 'Riders off the train reach Central just after the Route 2 bus leaves. A short hold when a train with transfers is about to arrive keeps the connection.',
  },
]);

const R2_PROPOSALS = proposals(2, C1, [
  {
    emphasis: 'allocation', summary: SUMMARY.r2a, policy: R2A, train: TRAIN[2], val: VAL[2], findings: FINDINGS[2], verdict: 'Promoted to g2.',
    rationale: 'The closing time is advertised, so the surge at Stadium Gate is predictable. Sending a lightly loaded bus there shortly before closing turns a 200-person queue into a few short waits.',
  },
  {
    emphasis: 'transfers', summary: SUMMARY.r2b, policy: R2B, train: sibling(C1.train, T1, 1.9, { completed: 8807, missedConnections: 168, wait: [279, 988, 1790], effort: [29640.2, 0, 21980, 7560] }),
    findings: amend(C1.findings, [
      F.missed(AT_CENTRAL, 'train', 'r2', 24, [1260, 1380]),
      F.gap(SE, 'stop_apts_south', 'r2', 1320, 2220, 51),
      F.longHold('b4', 'stop_central_stn', 60, 27, 9),
    ]),
    verdict: 'Not promoted: worse than g1.',
    rationale: 'Missed connections at Central still cost 36 riders 6+ minutes each. Holding a full minute for any train with transfers should catch nearly all of them.',
  },
  {
    emphasis: 'spacing', summary: SUMMARY.r2c, policy: R2C, train: sibling(C1.train, T1, -0.4, { effort: [30020.6, 0, 16980, 7560] }),
    findings: amend(C1.findings, [F.gap(SE, 'stop_apts_south', 'r2', 1440, 2160, 45), F.gap(CC, 'stop_university_stn', 'r1', 1380, 2040, 22)]),
    verdict: 'Not promoted: r2-a was better.',
    rationale: 'The derived target headway lets terminal holds idle buses too long on the two busiest routes. Tighter targets release them sooner.',
  },
]);

const R3_PROPOSALS = proposals(3, C2, [
  {
    emphasis: 'transfers', summary: SUMMARY.r3a, policy: R3A,
    train: sibling(C2.train, T2, -2.3, { missedConnections: 139, transfersMade: 1410, effort: [29950.3, 512.4, 19410, 7560] }),
    val: sibling(VAL[2]!, V2, 0.9, { missedConnections: 71 }),
    findings: amend(C2.findings, [
      F.missed(AT_CENTRAL, 'train', 'r2', 12, [1270, 1360]),
      F.gap(SE, 'stop_apts_south', 'r2', 1440, 2280, 46),
      F.longHold('b3', 'stop_central_stn', 45, 21, 15),
    ]),
    verdict: 'Rejected: validation worse.',
    rationale: 'Most missed connections happen at Central right after the closing surge. Holding 45 s for 6+ transfers catches the train without long waits for riders already aboard.',
  },
  {
    emphasis: 'spacing', summary: SUMMARY.r3b, policy: R3B, train: sibling(C2.train, T2, -1.6, { effort: [29990.1, 512.4, 19960, 7560] }),
    val: sibling(VAL[2]!, V2, 0.3),
    findings: amend(C2.findings, [F.bunching('r3', 'stop_downtown', 1, 80), F.longHold('b5', 'stop_old_main', 58, 24, 0)]),
    verdict: 'Rejected: validation worse.',
    rationale: 'Route 3 still bunches after pre-staging. A wider spacing band should keep the pre-staged buses apart.',
  },
  {
    emphasis: 'allocation', summary: SUMMARY.r3c, policy: R3C, train: sibling(C2.train, T2, 3.8, { completed: 8902, wait: [262, 948, 1975] }),
    findings: amend(C2.findings, [F.gap(CC, 'stop_university_stn', 'r1', 960, 2280, 44), F.gap(SE, 'stop_apts_south', 'r2', 1680, 2160, 30)]),
    verdict: 'Not promoted: worse than g2.',
    rationale: 'Apartments South has the worst service gap. A third Apartments bus should close it, and Campus Loop has spare capacity.',
  },
]);

const R4_PROPOSALS = proposals(4, C2, [
  {
    emphasis: 'spacing', summary: SUMMARY.r4a, policy: R4A, train: sibling(C2.train, T2, -1.1, { effort: [30080.5, 512.4, 17250, 7560] }),
    findings: amend(C2.findings, [F.bunching('r3', 'stop_downtown', 2, 60)]),
    verdict: 'Not promoted: r4-c was better.',
    rationale: "Spacing holds sometimes chain at several stops in one loop. Keeping 60 s of the loop's hold budget in reserve keeps buses moving.",
  },
  {
    emphasis: 'allocation', summary: SUMMARY.r4b, policy: R4B, train: sibling(C2.train, T2, -2.0, { completed: 8952, leftBehind: 671, effort: [30188.2, 512.4, 16890, 7560] }),
    findings: amend(C2.findings, [F.overload(AT_GATE, 'r3', 47, 122), F.bunching('r3', 'stop_downtown', 4, 35)]),
    verdict: 'Not promoted: r4-c was better.',
    rationale: 'Terminal holds keep buses waiting while 40+ people queue for the route. Leaving at once when the queue is long helps more than a perfect headway.',
  },
  {
    emphasis: 'transfers', summary: EXAMPLE_G3.meta.summary, policy: R4C, train: TRAIN[3], val: VAL[3], findings: FINDINGS[3], verdict: 'Promoted to g3.',
    rationale: 'Missed train connections at Central are the largest remaining transfer loss. Holding only for 8+ transfers when the next bus is 3+ minutes away gains connections without stranding riders, and the train waits for a bus under 40 s away when its platform is quiet.',
  },
]);

const R5C_ERRORS = errorsOf(R5C_REPAIRED);
const R5_PROPOSALS = proposals(5, C3, [
  {
    emphasis: 'allocation', summary: SUMMARY.r5a, policy: R5A, train: TRAIN[4], val: VAL[4], findings: FINDINGS[4], verdict: 'Promoted to g4.',
    rationale: 'Stadium Gate still overflows in the first minutes after closing because pre-staged buses arrive late. Starting 7 minutes early fixes that, and returning the extra buses once the crowd has cleared stops Route 3 running empty while Apartments South waits.',
  },
  {
    emphasis: 'transfers', summary: SUMMARY.r5b, policy: R5B, model: FALLBACK_MODEL,
    train: sibling(C3.train, T3, -1.4, { missedConnections: 104, transfersMade: 1438, effort: [29870.9, 536.8, 20410, 8960] }),
    findings: amend(C3.findings, [F.missed(AT_CENTRAL, 'train', 'r2', 6, [1270, 1340]), F.overload(platform('stn_central'), 'train', 14, 88)]),
    verdict: 'Not promoted: r5-a was better.',
    rationale: 'The train leaves Central seconds before buses arrive. Waiting up to 90 s when a bus is within a minute keeps more connections.',
  },
  {
    emphasis: 'spacing', summary: SUMMARY.r5c, policy: null, errors: R5C_ERRORS,
    verdict: `Invalid after one repair attempt: ${R5C_ERRORS[0]}`,
    rationale: 'Holding harder whenever buses run closer than 70% of the target headway should remove the remaining Route 3 bunching.',
  },
]);

const ROUND_TIMES: Array<[string, string]> = [
  ['2026-10-11T13:04:12.481Z', '2026-10-11T13:05:47.902Z'],
  ['2026-10-11T13:22:31.117Z', '2026-10-11T13:24:02.356Z'],
  ['2026-10-11T13:47:05.640Z', '2026-10-11T13:48:51.073Z'],
  ['2026-10-11T14:09:40.228Z', '2026-10-11T14:11:08.815Z'],
  ['2026-10-11T14:36:18.904Z', '2026-10-11T14:37:44.561Z'],
];
const roundOf = (n: number, before: string, after: string, ps: Proposal[]): Round => ({
  id: `R${n}`, number: n, championBefore: before, championAfter: after, status: 'done', proposals: ps,
  startedAt: ROUND_TIMES[n - 1]![0], finishedAt: ROUND_TIMES[n - 1]![1],
});

export const ROUNDS: Round[] = [
  roundOf(1, 'g0', 'g1', R1_PROPOSALS),
  roundOf(2, 'g1', 'g2', R2_PROPOSALS),
  roundOf(3, 'g2', 'g2', R3_PROPOSALS),
  roundOf(4, 'g2', 'g3', R4_PROPOSALS),
  roundOf(5, 'g3', 'g4', R5_PROPOSALS),
];

/** The latest round (R5): valid (promoted), valid (fallback model, not promoted), invalid after repair. */
export const ROUND: Round = ROUNDS[4]!;

// ---------- generations ----------
const modelLabel = (m: string) => (m === FALLBACK_MODEL ? 'DeepSeek V4 Pro on OpenRouter' : 'DeepSeek V4.1 Flash on Luminal');

function generation(n: number, policy: Policy, from: Proposal | null, createdAt: string): Generation {
  const train = TRAIN[n]!;
  const val = VAL[n]!;
  const explanation = from
    ? `${from.id} (${from.emphasis}, ${modelLabel(from.model)}): ${from.summary} ΔJ ${signedPct(from.deltaTrainPct!)} on training, ${signedPct(pctChange(val.J, VAL[n - 1]!.J))} on validation.`
    : `${policy.meta.summary} Evolution starts here.`;
  return { id: `g${n}`, number: n, parentId: n === 0 ? null : `g${n - 1}`, policy, fromProposal: from?.id ?? null, explanation, train, val, findings: FINDINGS[n]!, createdAt };
}

export const GENERATIONS: Generation[] = [
  generation(0, G0_POLICY, null, '2026-10-11T12:30:00.000Z'),
  generation(1, G1_POLICY, R1_PROPOSALS[0]!, ROUND_TIMES[0]![1]),
  generation(2, G2_POLICY, R2_PROPOSALS[0]!, ROUND_TIMES[1]![1]),
  generation(3, G3_POLICY, R4_PROPOSALS[2]!, ROUND_TIMES[3]![1]),
  generation(4, G4_POLICY, R5_PROPOSALS[0]!, ROUND_TIMES[4]![1]),
];

export const CHAMPION: Generation = GENERATIONS[4]!;

/** Chart lines for the Lab: the baseline (= g0) and the hand-written queue-responsive reference (−9.8% on train). */
export const BASELINE: { train: SplitScore; val: SplitScore } = { train: TRAIN[0]!, val: VAL[0]! };
export const REFERENCE: { train: SplitScore; val: SplitScore } = { train: score(T_REF, 8), val: score(V_REF, 4) };

/** What the round runner streamed for ROUND but did not persist (used to build EVOLVE_EVENTS). */
export const ROUND_TRACE = {
  scoredNarrative: SCORED,
  firstAttemptErrors: { 'r5-c': errorsOf(R5C_FIRST) } as Record<string, string[]>,
  decisionReason: `r5-a promoted to g4: ΔJ ${signedPct(R5_PROPOSALS[0]!.deltaTrainPct!)} on training, ${signedPct(pctChange(VAL[4]!.J, VAL[3]!.J))} on validation, completion ${TRAIN[4]!.metrics.completionPct}% (was ${TRAIN[3]!.metrics.completionPct}%).`,
};
