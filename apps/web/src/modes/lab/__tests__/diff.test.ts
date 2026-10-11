import { describe, expect, it } from 'vitest';
import { EXAMPLE_G3, G0, REF } from '@headway/sim';
import type { Policy, Rule } from '@headway/sim';
import { describeAction, describeCondition, diffPolicies } from '../diff';

const clone = (p: Policy): Policy => structuredClone(p);
const rule = (p: Policy, id: string): Rule => p.rules.find((r) => r.id === id)!;

describe('diffPolicies', () => {
  it('reports nothing for identical policies (meta is ignored)', () => {
    const b = clone(EXAMPLE_G3);
    b.meta = { ...b.meta, id: 'g4', parent: 'g3', generation: 4, summary: 'other words' };
    const d = diffPolicies(EXAMPLE_G3, b);
    expect(d.empty).toBe(true);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.changed).toEqual([]);
    expect(d.params).toEqual([]);
    expect(d.defaults).toEqual([]);
    expect(d.unchanged).toBe(EXAMPLE_G3.rules.length);
  });

  it('finds added and removed rules by id', () => {
    const d = diffPolicies(G0, EXAMPLE_G3);
    expect(d.added.map((r) => r.id).sort()).toEqual(['anti-bunch', 'hold-for-connection', 'prestage-stadium', 'train-meets-bus']);
    expect(d.removed).toEqual([]);
    expect(d.changed).toEqual([]); // even-headway is identical in both
    expect(d.unchanged).toBe(1);
    expect(d.empty).toBe(false);

    const back = diffPolicies(EXAMPLE_G3, G0);
    expect(back.removed.map((r) => r.id).sort()).toEqual(['anti-bunch', 'hold-for-connection', 'prestage-stadium', 'train-meets-bus']);
    expect(back.added).toEqual([]);
  });

  it('reports a changed threshold as a changed condition, not remove + add', () => {
    const b = clone(EXAMPLE_G3);
    rule(b, 'anti-bunch').when[0] = { f: 'headway_ratio', op: '<', v: 0.4 };
    const d = diffPolicies(EXAMPLE_G3, b);
    expect(d.changed).toHaveLength(1);
    const c = d.changed[0]!;
    expect(c.id).toBe('anti-bunch');
    expect(c.conditions).toEqual([
      { kind: 'changed', f: 'headway_ratio', from: { f: 'headway_ratio', op: '<', v: 0.5 }, to: { f: 'headway_ratio', op: '<', v: 0.4 } },
    ]);
    expect(c.fields).toEqual([]);
    expect(c.before.id).toBe('anti-bunch');
    expect(c.after.when[0]!.v).toBe(0.4);
  });

  it('reports added and removed conditions inside a rule', () => {
    const b = clone(EXAMPLE_G3);
    const r = rule(b, 'hold-for-connection');
    r.when = r.when.filter((c) => c.f !== 'onboard');
    r.when.push({ f: 'downstream_queue', op: '<', v: 60 });
    const d = diffPolicies(EXAMPLE_G3, b);
    expect(d.changed).toHaveLength(1);
    const kinds = d.changed[0]!.conditions.map((c) => `${c.kind}:${c.f}`).sort();
    expect(kinds).toEqual(['added:downstream_queue', 'removed:onboard']);
  });

  it('pairs repeated features sensibly (exact match first, then same op)', () => {
    const b = clone(EXAMPLE_G3);
    const r = rule(b, 'prestage-stadium');
    // event_in_s <= 300 becomes <= 240; event_in_s >= -600 untouched; order swapped to make pairing non-trivial
    r.when = [
      { f: 'event_in_s', op: '>=', v: -600 },
      { f: 'event_in_s', op: '<=', v: 240 },
      { f: 'buses_on_route', op: '>=', v: 2 },
      { f: 'route_queue', op: '<', v: 25 },
    ];
    const d = diffPolicies(EXAMPLE_G3, b);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0]!.conditions).toEqual([
      { kind: 'changed', f: 'event_in_s', from: { f: 'event_in_s', op: '<=', v: 300 }, to: { f: 'event_in_s', op: '<=', v: 240 } },
    ]);
  });

  it('reports action, priority and say changes as rule fields', () => {
    const b = clone(EXAMPLE_G3);
    const r = rule(b, 'hold-for-connection');
    r.do = { type: 'hold', seconds: 60 };
    r.priority = 25;
    r.say = 'Holding {seconds}s for {expected_transfers} transfers';
    const d = diffPolicies(EXAMPLE_G3, b);
    expect(d.changed).toHaveLength(1);
    const fields = d.changed[0]!.fields;
    expect(fields.map((f) => f.field)).toEqual(['priority', 'do', 'say']);
    expect(fields[0]).toEqual({ field: 'priority', from: 20, to: 25 });
    expect(fields[1]).toEqual({ field: 'do', from: { type: 'hold', seconds: 45 }, to: { type: 'hold', seconds: 60 } });
  });

  it('reports param changes per route and per field', () => {
    const b = clone(EXAMPLE_G3);
    b.params.allocation = { r1: 1, r2: 2, r3: 3 };
    b.params.maxHoldS = 75;
    b.params.targetHeadwayS = { r2: 420 };
    const d = diffPolicies(EXAMPLE_G3, b);
    expect(d.params).toEqual([
      { path: 'allocation.r1', from: 2, to: 1 },
      { path: 'allocation.r3', from: 2, to: 3 },
      { path: 'maxHoldS', from: 60, to: 75 },
      { path: 'targetHeadwayS.r2', from: undefined, to: 420 },
    ]);
    expect(d.empty).toBe(false);
  });

  it('reports default action changes per decision kind', () => {
    const b = clone(G0);
    b.defaults.train_at_station = { type: 'setTrainDeparture', dwellS: 60 };
    const d = diffPolicies(G0, b);
    expect(d.defaults).toEqual([
      { kind: 'train_at_station', from: { type: 'setTrainDeparture', dwellS: 45 }, to: { type: 'setTrainDeparture', dwellS: 60 } },
    ]);
  });

  it('reports advisor changes', () => {
    const a = clone(EXAMPLE_G3);
    const b = clone(EXAMPLE_G3);
    b.advisor = { provider: 'jev', enabled: true, askWhen: [{ f: 'train_eta_s', op: '<=', v: 120 }], holdOptionsS: [0, 20, 40, 60], instructions: 'Hold for big transfers.' };
    const d = diffPolicies(a, b);
    expect(d.advisor.map((p) => p.path)).toContain('advisor.enabled');
    expect(d.empty).toBe(false);
  });

  it('works from g0 to ref (removed nothing, added three)', () => {
    const d = diffPolicies(G0, REF);
    expect(d.added.map((r) => r.id).sort()).toEqual(['anti-bunch', 'dispatch-big-queue', 'move-to-busiest']);
    expect(d.unchanged).toBe(1);
  });
});

describe('describeAction / describeCondition', () => {
  it('reads like plain dispatch language', () => {
    expect(describeAction({ type: 'hold', seconds: 45 })).toBe('hold 45 s');
    expect(describeAction({ type: 'hold', until: 'target_headway' })).toBe('hold to target headway');
    expect(describeAction({ type: 'reassign', to: 'r3' })).toBe('reassign → r3');
    expect(describeAction({ type: 'reassign', to: 'busiest' })).toBe('reassign → busiest route');
    expect(describeAction({ type: 'setTrainDeparture', dwellS: 75 })).toBe('train dwells 75 s');
    expect(describeAction({ type: 'dispatch' })).toBe('dispatch');
    expect(describeAction({ type: 'continue' })).toBe('continue');
    expect(describeCondition({ f: 'headway_ratio', op: '<', v: 0.5 })).toBe('headway_ratio < 0.5');
    expect(describeCondition({ f: 'event_in_s', op: '>=', v: -600 })).toBe('event_in_s ≥ −600');
    expect(describeCondition({ f: 'route_queue', op: '<=', v: 25 })).toBe('route_queue ≤ 25');
    expect(describeCondition({ f: 'is_station', op: '==', v: 1 })).toBe('is_station = 1');
  });
});
