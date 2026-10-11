// Play orchestration against a fake sim: start → tour → intents → Finish fast-forward → results, with the AI runs mocked.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Intent, Observation, Policy, Replay, RunResult, Sim, SimSnapshot } from '@headway/sim';

vi.mock('../aiRuns', () => {
  const run = (who: 'champion' | 'baseline', J: number) => ({
    who, policyId: who === 'champion' ? 'g5' : 'g0', ms: 1, stub: false,
    samples: [{ t: 0, j: 0 }, { t: 150, j: J / 2 }, { t: 300, j: J }],
    result: { metrics: { J }, findings: [] } as unknown as RunResult,
  });
  return { aiRunsFor: vi.fn(async () => ({ champion: run('champion', 2400), baseline: run('baseline', 3600) })) };
});
vi.mock('../../../api', () => ({
  fetchChampion: vi.fn(async () => ({ policy: { meta: { id: 'g5' } }, generation: null })),
  fetchLeaderboard: vi.fn(async () => [{ name: 'Ada', j: 3000, verified: true }]),
  submitRun: vi.fn(async () => ({ ok: true, j: 3000 })),
}));

const { frame } = await import('../../../state/frame');
const { useApp } = await import('../../../state/store');
const { SimRunner } = await import('../../../sim/runner');
const game = await import('../game');
const { usePlay } = await import('../playStore');

type Bus = Observation['buses'][number];
const bus = (id: string, state: Bus['state'], routeId: Bus['routeId'] = 'r1'): Bus => ({
  id, routeId, state, onboard: 5, capacity: 40, nextStopId: 'stop_downtown', etaNextStopS: 30,
  holdUntil: null, headwayAheadS: 300, headwayBehindS: 300, holdUsedS: 0,
});

function fakeSim(end = 300): Sim & { intents: Intent[] } {
  let t = 0;
  const intents: Intent[] = [];
  const running = () => ({ spawned: 10, completed: 0, waitingNow: 0, ridingNow: 0, meanWaitS: 0, missedConnections: 0, leftBehind: 0, jSoFar: t * 10 });
  return {
    intents,
    get t() { return t; },
    get done() { return t >= end; },
    step() { if (t < end) t += 1; return { pending: null }; },
    resolve() {},
    intent(i: Intent) { intents.push(i); },
    observe(): Observation {
      return {
        t, phase: 'running',
        scenario: { id: 'stadium_exit', kind: 'stadium_exit', name: 'Stadium exit', clockStart: '21:30', durationS: 200, clearingS: 100, advertised: [] },
        buses: [bus('b1', 'dwelling'), bus('b2', 'layover'), bus('b3', 'moving', 'r2'), bus('b4', 'moving', 'r2'), bus('b5', 'moving', 'r3'), bus('b6', 'moving', 'r3')],
        train: { state: 'moving', stationId: 'stn_central', etaS: 40, onboard: 20, capacity: 160, departAt: null, alightingNext: 0, transfersNext: {},
          platformQueue: { stn_stadium: 0, stn_university: 0, stn_central: 0 } },
        stops: [],
        routes: [{ id: 'r1', buses: ['b1', 'b2'], targetHeadwayS: 240, queue: 3 }, { id: 'r2', buses: ['b3', 'b4'], targetHeadwayS: 240, queue: 0 },
          { id: 'r3', buses: ['b5', 'b6'], targetHeadwayS: 240, queue: 9 }],
        running: running(),
      };
    },
    snapshot(): SimSnapshot { return { t, phase: t >= end ? 'done' : 'running', vehicles: [], people: [], queues: [], events: [], running: running() }; },
    passenger() { return null; },
    result(): RunResult { return { metrics: { J: t * 10 }, findings: [] } as unknown as RunResult; },
    replay(): Replay { return { simVersion: '1', mapVersion: '1', scenarioId: 'stadium_exit', seed: 50000, controller: { kind: 'human', basePolicyId: 'g0' }, intents: intents.map((intent) => ({ t: 0, intent })) }; },
  };
}

let sim: ReturnType<typeof fakeSim>;
let now = 0;
const tick = (n = 1) => { for (let i = 0; i < n; i++) { now += 300; game.tick(now); } };
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  sim = fakeSim();
  frame.runner = new SimRunner(() => sim, 8);
  useApp.setState({
    mode: 'play', selection: null, paused: true, speed: 8,
    champion: { policy: { meta: { id: 'g5' } } as unknown as Policy, generation: null },
    play: { phase: 'intro', seed: 50000, intents: [], pace: [], results: null },
  });
  game.resetLocal();
  usePlay.getState().set({ ai: { status: 'idle', champion: null, baseline: null, championId: '', key: '', error: null }, tour: null, board: { status: 'idle', rows: [] } });
  game.enterPlay();
  await flush();
});

describe('play orchestration', () => {
  it('runs the AI on the same crowd at entry and publishes its pace curves for the top-bar chip', () => {
    const ai = usePlay.getState().ai;
    expect(ai.status).toBe('done');
    expect(ai.champion?.policyId).toBe('g5');
    expect(ai.baseline?.policyId).toBe('g0');
    const pace = useApp.getState().play.pace;
    expect(pace.map((p) => p.champion)).toEqual([0, 1200, 2400]);
    expect(pace.every((p) => Number.isNaN(p.you))).toBe(true); // nothing played yet
  });

  it('starts with the tour paused, then the clock runs', () => {
    game.start();
    expect(useApp.getState().play.phase).toBe('playing');
    expect(usePlay.getState().tour).toBe(0);
    expect(useApp.getState().paused).toBe(true);
    game.setTour(null);
    expect(usePlay.getState().tour).toBeNull();
    expect(useApp.getState().paused).toBe(false);
    expect(frame.runner!.paused).toBe(false);
  });

  it('explains disabled actions instead of sending them', () => {
    game.start({ tour: false });
    game.setTour(null);
    tick();
    expect(game.act({ kind: 'dispatch' })).toBe(true);
    expect(sim.intents).toEqual([]);
    expect(usePlay.getState().nudge).toMatchObject({ text: 'Select a bus first', tone: 'warn' });
    useApp.getState().select({ kind: 'bus', id: 'b3' });
    game.act({ kind: 'dispatch' });
    expect(usePlay.getState().nudge?.text).toBe('Only at a terminal');
    expect(sim.intents).toEqual([]);
  });

  it('sends legal intents, logs them and tracks immediate application', () => {
    game.start();
    game.setTour(null);
    tick();
    useApp.getState().select({ kind: 'bus', id: 'b1' }); // dwelling → hold applies now
    game.act({ kind: 'hold', seconds: 30 });
    useApp.getState().select({ kind: 'bus', id: 'b2' }); // layover → dispatch is legal
    game.act({ kind: 'dispatch' });
    game.act({ kind: 'train', mode: 'extend' }); // moving train → 75 s at the next station
    expect(sim.intents).toEqual([
      { type: 'hold', vehicleId: 'b1', seconds: 30 },
      { type: 'dispatch', vehicleId: 'b2' },
      { type: 'setTrainDeparture', dwellS: 75 },
    ]);
    expect(useApp.getState().play.intents.map((x) => x.intent.type)).toEqual(['hold', 'dispatch', 'setTrainDeparture']);
    expect(usePlay.getState().tracked.map((x) => x.status)).toEqual(['applied', 'applied', 'pending']);
  });

  it('opens the reassign picker and refuses the bus’s own route', () => {
    game.start();
    game.setTour(null);
    tick();
    useApp.getState().select({ kind: 'bus', id: 'b3' });
    game.act({ kind: 'reassign-open' });
    expect(usePlay.getState().picker).toBe('reassign');
    game.act({ kind: 'reassign', to: 'r2' });
    expect(usePlay.getState().nudge?.text).toBe('Already on r2');
    game.act({ kind: 'reassign', to: 'r3' });
    expect(sim.intents).toEqual([{ type: 'reassign', vehicleId: 'b3', to: 'r3' }]);
    expect(usePlay.getState().picker).toBeNull();
  });

  it('Finish fast-forwards to the end and shows You / AI / Baseline', async () => {
    game.start();
    game.setTour(null);
    tick();
    game.finish();
    expect(useApp.getState().play.phase).toBe('finishing');
    expect(useApp.getState().paused).toBe(false); // the clock visibly races; nothing is "paused"
    tick(40);
    expect(sim.done).toBe(true);
    expect(useApp.getState().play.phase).toBe('results');
    expect(useApp.getState().paused).toBe(true);
    const local = usePlay.getState();
    expect(local.you?.metrics.J).toBe(3000);
    expect(local.youPace.map((p) => p.t).filter((t) => t % 30 === 0).length).toBeGreaterThanOrEqual(9);
    const res = useApp.getState().play.results;
    expect(res?.champion.metrics.J).toBe(2400);
    expect(res?.baseline.metrics.J).toBe(3600);
    const pace = useApp.getState().play.pace;
    expect(pace.map((p) => [p.t, p.champion, p.baseline])).toEqual([[0, 0, 0], [150, 1200, 1800], [300, 2400, 3600]]);
    expect(pace[1]!.you).toBe(1500); // your jSoFar (t * 10) at t = 150
    await flush();
    expect(usePlay.getState().board.rows).toHaveLength(1);
  });

  it('submits a validated name with the replay', async () => {
    game.start();
    game.setTour(null);
    game.finish();
    tick(40);
    await game.submitScore('bad name!');
    expect(usePlay.getState().submit.status).toBe('error');
    await game.submitScore('Ada');
    expect(usePlay.getState().submit).toMatchObject({ status: 'done', name: 'Ada', j: 3000 });
  });

  it('keyboard: ignores keys outside play and in text fields, handles D/space when playing', () => {
    game.start();
    game.setTour(null);
    tick();
    const ev = (key: string, target: unknown = { tagName: 'DIV', isContentEditable: false }, repeat = false) => {
      const e = { key, code: key === ' ' ? 'Space' : '', shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, isComposing: false,
        repeat, defaultPrevented: false, target, preventDefault: vi.fn(), stopPropagation: vi.fn() };
      game.handleKey(e as unknown as KeyboardEvent);
      return e;
    };
    expect(ev('d', { tagName: 'INPUT', isContentEditable: false }).preventDefault).not.toHaveBeenCalled();
    const space = ev(' ');
    expect(space.preventDefault).toHaveBeenCalled();
    expect(useApp.getState().paused).toBe(true);
    ev(']');
    expect(useApp.getState().selection).toEqual({ kind: 'bus', id: 'b1' });
    ev('h', undefined, true); // auto-repeat: swallowed, nothing sent
    expect(sim.intents).toEqual([]);
    ev('h');
    expect(sim.intents).toEqual([{ type: 'hold', vehicleId: 'b1', seconds: 30 }]);
  });
});
