// Task P: the web fixtures must be typed, realistic and mutually consistent (plan "Task P", spec §6–§8.4).
import { describe, expect, it } from 'vitest';
import {
  EXAMPLE_G3, G0, validatePolicy,
  type Emphasis, type EvolveEvent, type FailureFinding, type Metrics, type Proposal, type RouteId, type StopId,
} from '@headway/sim';
import {
  BASELINE, CHAMPION, EVOLVE_EVENTS, GENERATIONS, HUMAN_INTENTS, HUMAN_REPLAY, LEADERBOARD, PLAY_RESULTS, REFERENCE,
  ROUND, ROUNDS, RUN_CHAMPION, RUN_G0, RUN_HUMAN, RUN_RESULTS,
} from '../index';

const T_END = 2700;
const PENALTY = 2700;
const EMPHASES: Emphasis[] = ['transfers', 'spacing', 'allocation'];
const SERVED: Record<StopId, RouteId[]> = {
  stop_stadium_gate: ['r3'], stop_stadium_stn: ['r3'], stop_university_stn: ['r1'], stop_old_main: ['r1', 'r3'],
  stop_downtown: ['r1', 'r2', 'r3'], stop_central_stn: ['r1', 'r2'], stop_apts_north: ['r2'], stop_apts_south: ['r2'],
};
const ALL_PROPOSALS = ROUNDS.flatMap((r) => r.proposals);

/** Same format as the evolve narrative head: "−6.1%" with a real minus sign. */
function signedPct(x: number): string {
  const r = Math.round(x * 10) / 10;
  if (r === 0) return '0.0%';
  return `${r < 0 ? '−' : '+'}${Math.abs(r).toFixed(1)}%`;
}
const pct = (a: number, b: number) => ((a - b) / b) * 100;

function checkMetrics(m: Metrics, runs: number) {
  expect(m.completed + m.unfinished).toBe(m.spawned);
  expect(m.completionPct).toBeCloseTo((100 * m.completed) / m.spawned, 1);
  // J = Σ completed journeys + Σ unfinished ((T_END − spawnT) + penalty), spawnT ∈ [0, 1800]
  const perUnfinished = (m.J - m.completed * m.meanJourneyS) / Math.max(1, m.unfinished);
  expect(perUnfinished).toBeGreaterThanOrEqual(T_END - 1800 + PENALTY - 1);
  expect(perUnfinished).toBeLessThanOrEqual(T_END + PENALTY + 1);
  expect(m.meanWaitS).toBeLessThan(m.p95WaitS);
  expect(m.p95WaitS).toBeLessThanOrEqual(m.maxWaitS);
  expect(m.meanJourneyS).toBeGreaterThan(m.meanWaitS);
  expect(m.maxWaitS).toBeLessThanOrEqual(T_END);
  for (const v of [m.transfersMade, m.missedConnections, m.leftBehind, m.walkaways, m.effort.holdS, m.effort.trainDwellS]) {
    expect(Number.isInteger(v) && v >= 0).toBe(true);
  }
  expect(m.effort.busDistanceU).toBeGreaterThan(m.effort.deadheadDistanceU);
  // 6 buses at 0.30 u/s can drive at most 6 × 0.3 × 2700 u per run
  expect(m.effort.busDistanceU).toBeLessThanOrEqual(6 * 0.3 * T_END * runs);
}

const TEMPLATES: Record<FailureFinding['kind'], RegExp> = {
  service_gap: /^.+ went (\d+) min without a Route [123] bus \(\d\d:\d\d–\d\d:\d\d\)\.$/,
  missed_transfer: /^(\d+) riders reached .+ from (the train|Route [123]) just after (Route [123]|the train) left\.$/,
  bunching: /^Route [123] buses bunched (\d+)× \(as close as (\d+) s\)\.$/,
  overload: /^(\d+) people were left behind at .+; the queue peaked at (\d+)\.$/,
  unused_capacity: /^Route [123] ran (\d+)% empty while .+ queued (\d+)\.$/,
  long_hold: /^Holding (b\d) (\d+) s at .+ gained (\d+) transfers but delayed (\d+) riders\.$/,
};

function checkFinding(f: FailureFinding) {
  const m = TEMPLATES[f.kind].exec(f.text);
  expect(m, `${f.kind}: "${f.text}"`).not.toBeNull();
  expect(f.impactS).toBeGreaterThan(0);
  switch (f.kind) {
    case 'service_gap':
      expect(f.gapS).toBe(f.toT - f.fromT);
      expect(Number(m![1])).toBe(Math.round(f.gapS / 60));
      expect(SERVED[f.stopId]).toContain(f.routeId);
      break;
    case 'missed_transfer':
      expect(Number(m![1])).toBe(f.count);
      expect(f.window[0]).toBeLessThan(f.window[1]);
      expect(f.from).not.toBe(f.to);
      break;
    case 'bunching':
      expect([Number(m![1]), Number(m![2])]).toEqual([f.events, f.minHeadwayS]);
      expect(SERVED[f.stopId]).toContain(f.routeId);
      break;
    case 'overload':
      expect([Number(m![1]), Number(m![2])]).toEqual([f.leftBehind, f.peakQueue]);
      break;
    case 'unused_capacity':
      expect([Number(m![1]), Number(m![2])]).toEqual([Math.round((1 - f.meanLoad) * 100), f.elsewhere.queue]);
      break;
    case 'long_hold':
      expect([m![1], Number(m![2]), Number(m![3]), Number(m![4])]).toEqual([f.vehicleId, f.holdS, f.transfersGained, f.delayedOnboard]);
      break;
  }
}

function checkFindings(fs: FailureFinding[]) {
  expect(fs.length).toBeGreaterThan(0);
  fs.forEach(checkFinding);
  const impacts = fs.map((f) => f.impactS);
  expect(impacts).toEqual([...impacts].sort((a, b) => b - a));
}

describe('play-seed run results (stadium_exit, seed 50000)', () => {
  const runs = [RUN_G0, RUN_CHAMPION, RUN_HUMAN];

  it('share the scenario, seed, versions and crowd', () => {
    for (const r of runs) {
      expect(r).toMatchObject({ scenarioId: 'stadium_exit', seed: 50000, simVersion: RUN_G0.simVersion, mapVersion: RUN_G0.mapVersion });
      expect(r.metrics.spawned).toBe(RUN_G0.metrics.spawned);
      expect(r.hash).toMatch(/^[0-9a-f]{8}$/);
      checkMetrics(r.metrics, 1);
      checkFindings(r.findings);
    }
    expect(new Set(runs.map((r) => r.hash)).size).toBe(3);
  });

  it('name the right controllers', () => {
    expect(RUN_G0.controller).toEqual({ kind: 'policy', policyId: 'g0' });
    expect(RUN_CHAMPION.controller).toEqual({ kind: 'policy', policyId: CHAMPION.id });
    expect(RUN_HUMAN.controller).toEqual({ kind: 'human', basePolicyId: 'g0' });
    expect(RUN_RESULTS).toEqual({ g0: RUN_G0, champion: RUN_CHAMPION, human: RUN_HUMAN });
    expect(PLAY_RESULTS).toEqual({ you: RUN_HUMAN, champion: RUN_CHAMPION, baseline: RUN_G0 });
  });

  it('rank champion < human < g0, with the human 3–10% better than g0', () => {
    expect(RUN_CHAMPION.metrics.J).toBeLessThan(RUN_HUMAN.metrics.J);
    const human = pct(RUN_HUMAN.metrics.J, RUN_G0.metrics.J);
    expect(human).toBeLessThanOrEqual(-3);
    expect(human).toBeGreaterThanOrEqual(-10);
    expect(RUN_G0.metrics.completionPct).toBeGreaterThanOrEqual(85);
  });

  it('report every stop once with gaps for exactly its routes', () => {
    for (const r of runs) {
      expect(r.stops.map((s) => s.id).sort()).toEqual(Object.keys(SERVED).sort());
      for (const s of r.stops) {
        expect(Object.keys(s.maxGapS).sort()).toEqual([...SERVED[s.id]].sort());
        expect(s.maxQueue).toBeGreaterThan(0);
      }
    }
  });

  it('count rule fires for rules the controller actually has', () => {
    const ids = (p: typeof G0) => new Set([...p.rules.map((r) => r.id), 'default']);
    for (const k of Object.keys(RUN_G0.ruleFires)) expect(ids(G0).has(k)).toBe(true);
    for (const k of Object.keys(RUN_CHAMPION.ruleFires)) expect(ids(CHAMPION.policy).has(k)).toBe(true);
    expect(RUN_HUMAN.ruleFires.human).toBe(HUMAN_INTENTS.length);
  });

  it('carry the human intents and a matching replay', () => {
    const ts = HUMAN_INTENTS.map((i) => i.t);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    for (const { t, intent } of HUMAN_INTENTS) {
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(T_END);
      if ('vehicleId' in intent) expect(intent.vehicleId).toMatch(/^b[1-6]$/);
    }
    expect(HUMAN_REPLAY).toMatchObject({ scenarioId: 'stadium_exit', seed: 50000, controller: RUN_HUMAN.controller, intents: HUMAN_INTENTS });
    expect(HUMAN_REPLAY.simVersion).toBe(RUN_HUMAN.simVersion);
  });

  it('leaderboard is sorted by J and includes the human run', () => {
    const js = LEADERBOARD.map((r) => r.j);
    expect(js).toEqual([...js].sort((a, b) => a - b));
    expect(js).toContain(RUN_HUMAN.metrics.J);
    for (const r of LEADERBOARD) expect(r.name).toMatch(/^[A-Za-z0-9 _-]{1,16}$/);
  });
});

describe('generations g0…g4', () => {
  it('form a parent chain whose policies validate', () => {
    expect(GENERATIONS.map((g) => g.id)).toEqual(['g0', 'g1', 'g2', 'g3', 'g4']);
    GENERATIONS.forEach((g, i) => {
      expect(g.number).toBe(i);
      expect(g.parentId).toBe(i === 0 ? null : `g${i - 1}`);
      expect(g.policy.meta).toMatchObject({ id: g.id, parent: g.parentId, generation: i });
      const v = validatePolicy(g.policy);
      expect(v.ok ? [] : v.errors).toEqual([]);
      expect(g.explanation.length).toBeGreaterThan(20);
      checkMetrics(g.train.metrics, g.train.runs);
      checkMetrics(g.val.metrics, g.val.runs);
      expect([g.train.runs, g.val.runs]).toEqual([8, 4]);
      expect(g.train.J).toBe(g.train.metrics.J);
      expect(g.val.J).toBe(g.val.metrics.J);
      checkFindings(g.findings);
    });
    expect(GENERATIONS[0]!.policy).toEqual(G0);
    expect(GENERATIONS[3]!.policy).toEqual(EXAMPLE_G3);
    expect(CHAMPION).toBe(GENERATIONS[4]);
  });

  it('J_train falls 4–8% per generation; validation and completion never get worse', () => {
    for (let i = 1; i < GENERATIONS.length; i++) {
      const [a, b] = [GENERATIONS[i - 1]!, GENERATIONS[i]!];
      const d = pct(b.train.J, a.train.J);
      expect(d).toBeLessThanOrEqual(-4);
      expect(d).toBeGreaterThanOrEqual(-8);
      expect(b.val.J).toBeLessThan(a.val.J);
      expect(b.train.metrics.completionPct).toBeGreaterThanOrEqual(a.train.metrics.completionPct - 1);
    }
  });

  it('reference beats the baseline by ≥ 5% and BASELINE is g0', () => {
    expect(BASELINE).toEqual({ train: GENERATIONS[0]!.train, val: GENERATIONS[0]!.val });
    expect(pct(REFERENCE.train.J, BASELINE.train.J)).toBeLessThanOrEqual(-5);
    expect(REFERENCE.val.J).toBeLessThan(BASELINE.val.J);
    checkMetrics(REFERENCE.train.metrics, REFERENCE.train.runs);
    checkMetrics(REFERENCE.val.metrics, REFERENCE.val.runs);
  });

  it('each promoted generation is a copy of its proposal with the same scores', () => {
    for (const g of GENERATIONS.slice(1)) {
      const p = ALL_PROPOSALS.find((x) => x.id === g.fromProposal);
      expect(p, `${g.id} from ${g.fromProposal}`).toBeDefined();
      const round = ROUNDS.find((r) => r.id === p!.roundId)!;
      expect(round).toMatchObject({ championBefore: g.parentId, championAfter: g.id });
      expect(g.createdAt).toBe(round.finishedAt);
      const { meta: pm, ...pRest } = p!.policy!;
      const { meta: gm, ...gRest } = g.policy;
      expect(gRest).toEqual(pRest);
      expect({ ...gm, id: pm.id, parent: pm.parent }).toEqual(pm);
      expect(g.train).toEqual(p!.train);
      expect(g.val).toEqual(p!.val);
      expect(p!.narrative).toContain(`Promoted to ${g.id}.`);
    }
    expect(GENERATIONS[0]!.fromProposal).toBeNull();
    const created = GENERATIONS.map((g) => g.createdAt);
    expect(created).toEqual([...created].sort());
  });
});

describe('rounds R1…R5', () => {
  it('have 3 designers each with rotating emphases', () => {
    expect(ROUNDS.map((r) => r.id)).toEqual(['R1', 'R2', 'R3', 'R4', 'R5']);
    for (const r of ROUNDS) {
      expect(r.status).toBe('done');
      expect(r.finishedAt! > r.startedAt).toBe(true);
      expect(r.proposals.map((p) => p.id)).toEqual(['a', 'b', 'c'].map((s) => `r${r.number}-${s}`));
      r.proposals.forEach((p, i) => {
        expect(p).toMatchObject({ roundId: r.id, designer: i, emphasis: EMPHASES[(i + r.number) % 3] });
        expect(p.summary.length).toBeLessThanOrEqual(200);
        expect(p.model).toMatch(/deepseek/i);
      });
    }
    const starts = ROUNDS.map((r) => r.startedAt);
    expect(starts).toEqual([...starts].sort());
  });

  it('chain champions, with exactly one rejected round', () => {
    let champ = 'g0';
    for (const r of ROUNDS) {
      expect(r.championBefore).toBe(champ);
      champ = r.championAfter;
    }
    expect(champ).toBe(CHAMPION.id);
    const rejected = ROUNDS.filter((r) => r.championAfter === r.championBefore);
    expect(rejected).toHaveLength(1);
    const validated = rejected[0]!.proposals.filter((p) => p.val);
    expect(validated.length).toBeGreaterThan(0);
    const champVal = GENERATIONS.find((g) => g.id === rejected[0]!.championBefore)!.val.J;
    for (const p of validated) {
      expect(p.val!.J).toBeGreaterThan(champVal);
      expect(p.narrative).toContain('Rejected: validation worse.');
    }
  });

  it('valid proposals carry validated policies, scores and narratives', () => {
    for (const r of ROUNDS) {
      const champ = GENERATIONS.find((g) => g.id === r.championBefore)!;
      for (const p of r.proposals.filter((x) => x.valid)) {
        const v = validatePolicy(p.policy);
        expect(v.ok ? [] : v.errors).toEqual([]);
        expect(p.policy!.meta).toMatchObject({ id: p.id, parent: champ.id, generation: champ.number + 1, emphasis: p.emphasis });
        expect(p.errors).toEqual([]);
        expect(p.train!.runs).toBe(8);
        checkMetrics(p.train!.metrics, 8);
        expect(p.deltaTrainPct!).toBeCloseTo(pct(p.train!.J, champ.train.J), 1);
        expect(p.narrative.startsWith(`ΔJ ${signedPct(p.deltaTrainPct!)} on training.`)).toBe(true);
        expect(p.rationale.length).toBeGreaterThan(20);
        checkFindings(p.findings);
        if (p.val) expect(p.val.runs).toBe(4);
      }
    }
  });

  it('ROUND is the latest round: valid, valid, invalid', () => {
    expect(ROUND).toBe(ROUNDS.at(-1));
    expect(ROUND.proposals.map((p) => p.valid)).toEqual([true, true, false]);
    const bad = ROUND.proposals[2]!;
    expect(bad).toMatchObject({ policy: null, train: null, val: null, deltaTrainPct: null, findings: [] });
    expect(bad.errors.length).toBeGreaterThan(0);
    for (const e of bad.errors) expect(e).toMatch(/^[A-Za-z_][\w.[\]]*: \S/);
    expect(bad.narrative.length).toBeGreaterThan(0);
  });
});

describe('EVOLVE_EVENTS (one full round = ROUND)', () => {
  const ev = EVOLVE_EVENTS;
  const idx = (pred: (e: EvolveEvent) => boolean) => ev.findIndex(pred);
  const statuses = (d: number) => ev.flatMap((e) => (e.type === 'proposal' && e.designer === d ? [e.status] : []));

  it('starts with round_start and ends with the decision', () => {
    expect(ev[0]).toEqual({ type: 'round_start', round: ROUND.number, champion: ROUND.championBefore });
    const last = ev.at(-1)!;
    expect(last).toMatchObject({ type: 'decision', promoted: ROUND.championAfter });
    const promoted = GENERATIONS.find((g) => g.id === ROUND.championAfter)!;
    expect((last as Extract<EvolveEvent, { type: 'decision' }>).reason).toContain(promoted.fromProposal!);
    expect(ev.filter((e) => e.type === 'round_start' || e.type === 'decision')).toHaveLength(2);
  });

  it('requests all designers first, then reports each proposal', () => {
    const requested = ev.flatMap((e, i) => (e.type === 'proposal' && e.status === 'requested' ? [i] : []));
    const received = ev.flatMap((e, i) => (e.type === 'proposal' && e.status === 'received' ? [i] : []));
    expect(requested.map((i) => (ev[i] as { designer: number }).designer)).toEqual([0, 1, 2]);
    expect(Math.max(...requested)).toBeLessThan(Math.min(...received));
    ROUND.proposals.forEach((p: Proposal, d) => {
      expect(statuses(d)).toEqual(p.valid ? ['requested', 'received'] : ['requested', 'received', 'invalid']);
      for (const e of ev) if (e.type === 'proposal' && e.designer === d) expect(e.emphasis).toBe(p.emphasis);
      const got = ev.find((e) => e.type === 'proposal' && e.designer === d && e.status === 'received') as Extract<EvolveEvent, { type: 'proposal' }>;
      expect(got.model).toBe(p.model);
      expect(got.summary).toBe(p.summary);
      if (!p.valid) {
        expect(got.errors!.length).toBeGreaterThan(0);
        const inv = ev.find((e) => e.type === 'proposal' && e.designer === d && e.status === 'invalid') as Extract<EvolveEvent, { type: 'proposal' }>;
        expect(inv.errors).toEqual(p.errors);
      }
    });
  });

  it('evaluates each valid proposal 0…8 on train, scores it, then validates the winner 0…4', () => {
    const lastReceived = Math.max(...ev.flatMap((e, i) => (e.type === 'proposal' && e.status !== 'requested' ? [i] : [])));
    const scoredAt: number[] = [];
    for (const p of ROUND.proposals) {
      const train = ev.filter((e) => e.type === 'eval' && e.proposalId === p.id && e.split === 'train') as Array<Extract<EvolveEvent, { type: 'eval' }>>;
      if (!p.valid) {
        expect(train).toHaveLength(0);
        expect(idx((e) => e.type === 'scored' && e.proposalId === p.id)).toBe(-1);
        continue;
      }
      expect(train.map((e) => [e.done, e.total])).toEqual(Array.from({ length: 9 }, (_, i) => [i, 8]));
      const first = ev.indexOf(train[0]!);
      expect(first).toBeGreaterThan(lastReceived);
      const s = idx((e) => e.type === 'scored' && e.proposalId === p.id);
      expect(s).toBeGreaterThan(ev.indexOf(train.at(-1)!));
      const scored = ev[s] as Extract<EvolveEvent, { type: 'scored' }>;
      expect(scored.deltaTrainPct).toBe(p.deltaTrainPct);
      expect(p.narrative.startsWith(scored.narrative)).toBe(true);
      expect(scored.narrative).not.toContain('Promoted');
      scoredAt.push(s);
    }
    const winner = GENERATIONS.find((g) => g.id === ROUND.championAfter)!.fromProposal!;
    const val = ev.filter((e) => e.type === 'eval' && e.split === 'val') as Array<Extract<EvolveEvent, { type: 'eval' }>>;
    expect(val.map((e) => [e.proposalId, e.done, e.total])).toEqual(Array.from({ length: 5 }, (_, i) => [winner, i, 4]));
    expect(ev.indexOf(val[0]!)).toBeGreaterThan(Math.max(...scoredAt));
  });
});
