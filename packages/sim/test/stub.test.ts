import { describe, expect, it } from 'vitest';
import type { SimEvent, SimSnapshot } from '../src/contracts';
import { TOWN } from '../src/map/town';
import { playInstance, SCENARIOS, scenarioDef, SEEDS } from '../src/scenarios';
import { createStubSim } from '../src/stub';

const make = (scenarioId = 'stadium_exit', seed = 4001) =>
  createStubSim({ map: TOWN, scenario: { scenarioId, seed, split: 'showcase' } });

function run(n: number, sim = make()) {
  const events: SimEvent[] = [];
  let snap: SimSnapshot = sim.snapshot();
  for (let i = 0; i < n; i++) {
    sim.step();
    if (i % 10 === 9) { snap = sim.snapshot(); events.push(...snap.events); }
  }
  snap = sim.snapshot();
  events.push(...snap.events);
  return { sim, snap, events };
}

describe('scenarios', () => {
  it('defines the three scenarios and the seed splits', () => {
    expect(Object.keys(SCENARIOS).sort()).toEqual(['class_change', 'evening_commute', 'stadium_exit']);
    const se = scenarioDef('stadium_exit');
    expect(se.clockStart).toBe('21:30');
    expect(se.durationS + se.clearingS).toBe(2700);
    // total tuned from the spec's 1,200 in Wave 1 integration (g0 completion gate)
    expect(se.demand.find((d) => d.id === 'stadium_crowd')).toMatchObject({ total: 1000, profile: { kind: 'pulse', at: 600, rampS: 120, decayS: 420 } });
    expect(se.demand.find((d) => d.id === 'background')?.total).toBe(300);
    expect(se.advertised).toEqual([{ kind: 'stadium_closing', t: 600, label: 'Stadium closes' }]);
    const shares = se.demand[0]!.to.map((t) => t.share);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    const cc = scenarioDef('class_change');
    expect(cc.demand.filter((d) => d.profile.kind === 'pulse').map((d) => [d.total, (d.profile as { at: number }).at])).toEqual([[350, 300], [350, 1500]]);
    expect(SEEDS.train.map((s) => s.seed)).toEqual([1001, 1002, 1003, 1004, 1001, 1002, 1003, 1004]);
    expect(SEEDS.train.every((s) => s.split === 'train')).toBe(true);
    expect(SEEDS.val).toHaveLength(4);
    expect(SEEDS.showcase).toHaveLength(6);
    expect(new Set(SEEDS.showcase.map((s) => s.scenarioId))).toEqual(new Set(['stadium_exit', 'class_change']));
    expect(playInstance(3)).toEqual({ scenarioId: 'stadium_exit', seed: 50003, split: 'play' });
    expect(() => scenarioDef('nope')).toThrow();
  });
  it('demand selectors reference existing zones and tags', () => {
    const ids = new Set(TOWN.zones.map((z) => z.id));
    for (const def of Object.values(SCENARIOS)) for (const g of def.demand) {
      for (const sel of [g.from, ...g.to.map((t) => t.sel)]) {
        for (const z of sel.zones ?? []) expect(ids.has(z), `${def.id}/${g.id}: ${z}`).toBe(true);
        const n = TOWN.zones.filter((z) => (sel.zones ? sel.zones.includes(z.id) : (!sel.neighborhood || z.neighborhood === sel.neighborhood) && (!sel.tag || z.tags.includes(sel.tag))));
        expect(n.length, `${def.id}/${g.id}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('stub sim', () => {
  it('after 300 steps: 6 buses + 1 train moving, people walking and waiting', () => {
    const sim = make();
    const s0 = sim.snapshot();
    const { snap } = run(300, sim);
    expect(snap.t).toBe(300);
    expect(snap.phase).toBe('running');
    const buses = snap.vehicles.filter((v) => v.kind === 'bus');
    expect(buses).toHaveLength(6);
    expect(snap.vehicles.filter((v) => v.kind === 'train')).toHaveLength(1);
    const moved = buses.filter((b) => b.dist !== s0.vehicles.find((v) => v.id === b.id)!.dist);
    expect(moved.length).toBeGreaterThanOrEqual(4);
    expect(snap.people.some((p) => p.state === 'walking')).toBe(true);
    expect(snap.people.some((p) => p.state === 'waiting')).toBe(true);
    for (const b of buses) {
      expect(b.routeId).not.toBeNull();
      expect(b.path).toEqual({ kind: 'route', routeId: b.routeId });
      expect(b.dist).toBeGreaterThanOrEqual(0);
      expect(b.dist).toBeLessThan(TOWN.routes.find((r) => r.id === b.routeId)!.path.length);
    }
    const counts = new Map<string, number>();
    for (const b of buses) counts.set(b.routeId!, (counts.get(b.routeId!) ?? 0) + 1);
    expect([...counts.values()]).toEqual([2, 2, 2]);
  });
  it('people walk on straight timed segments and wait in queue slots', () => {
    const { snap } = run(400);
    for (const p of snap.people) {
      if (p.state === 'walking') {
        expect(p.from && p.to).toBeTruthy();
        expect(p.t0!).toBeLessThanOrEqual(snap.t);
        expect(p.t1!).toBeGreaterThan(p.t0!);
      }
      if (p.state === 'waiting') {
        expect(p.at).toBeTruthy();
        expect(p.slot!).toBeGreaterThanOrEqual(0);
        expect(p.since!).toBeLessThanOrEqual(snap.t);
      }
    }
    for (const q of snap.queues) {
      const waiting = snap.people.filter((p) => p.state === 'waiting' && p.at!.kind === q.at.kind && p.at!.id === q.at.id);
      expect(q.count).toBe(waiting.length);
      expect(waiting.map((p) => p.slot).sort((a, b) => a! - b!)).toEqual(waiting.map((_, i) => i));
    }
  });
  it('emits board events, then alight and arrive', () => {
    const { events, snap } = run(1500);
    expect(events.some((e) => e.kind === 'board')).toBe(true);
    expect(events.some((e) => e.kind === 'alight')).toBe(true);
    expect(events.some((e) => e.kind === 'arrive')).toBe(true);
    expect(snap.running.spawned).toBeGreaterThan(50);
    expect(snap.running.completed).toBeGreaterThan(0);
  });
  it('observe() and passenger() are plausible', () => {
    const { sim, snap } = run(300);
    const obs = sim.observe();
    expect(obs.t).toBe(300);
    expect(obs.buses).toHaveLength(6);
    expect(obs.stops).toHaveLength(8);
    expect(obs.routes.map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
    expect(obs.scenario.id).toBe('stadium_exit');
    expect(Object.keys(obs.train.platformQueue).sort()).toEqual(['stn_central', 'stn_stadium', 'stn_university']);
    const waiter = snap.people.find((p) => p.state === 'waiting')!;
    const info = sim.passenger(waiter.id)!;
    expect(info.id).toBe(waiter.id);
    expect(info.reason).toMatch(/Waiting for/);
    expect(sim.passenger(999999)).toBeNull();
  });
  it('is deterministic and done after 2,700 steps with a plausible result', () => {
    const a = run(2700);
    const b = run(2700);
    expect(a.sim.done).toBe(true);
    expect(a.snap.phase).toBe('done');
    expect(a.sim.t).toBe(2700);
    a.sim.step();
    expect(a.sim.t).toBe(2700);
    const ra = a.sim.result();
    expect(ra.hash).toBe(b.sim.result().hash);
    expect(ra.metrics.spawned).toBeGreaterThan(100);
    expect(ra.metrics.completionPct).toBeGreaterThan(0);
    expect(ra.metrics.completionPct).toBeLessThanOrEqual(100);
    expect(ra.stops).toHaveLength(8);
    expect(ra.mapVersion).toBe(TOWN.version);
    expect(a.sim.replay()).toMatchObject({ scenarioId: 'stadium_exit', seed: 4001 });
  });
  it('runs class_change and accepts intents', () => {
    const sim = make('class_change', 1001);
    sim.intent({ type: 'hold', vehicleId: 'b1', seconds: 30 });
    const { snap } = run(600, sim);
    expect(snap.vehicles).toHaveLength(7);
    expect(sim.replay().intents).toEqual([{ t: 0, intent: { type: 'hold', vehicleId: 'b1', seconds: 30 } }]);
  });
});
