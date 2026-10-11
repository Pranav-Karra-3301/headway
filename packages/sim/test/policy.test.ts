import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DecisionKind, Policy, Rule } from '../src/contracts';
import { EXAMPLE_G3, G0, REF } from '../src/policy/builtin';
import { explain } from '../src/policy/explain';
import { FEATURES, PLACEHOLDERS } from '../src/policy/features';
import { POLICY_DSL_DOC, PolicySchema, legalActionTypes, validatePolicy } from '../src/policy/schema';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const KINDS: DecisionKind[] = ['bus_at_stop', 'bus_at_terminal', 'train_at_station', 'depot_check'];

function errorsOf(p: unknown): string[] {
  const r = validatePolicy(p);
  if (r.ok) throw new Error('expected validation to fail');
  return r.errors;
}

/** Asserts ≥ 1 error line starts with `path` and (optionally) one of those lines contains `includes`. */
function expectErrorAt(p: unknown, path: string, includes?: string): string[] {
  const errs = errorsOf(p);
  const hits = errs.filter((e) => e.startsWith(path));
  expect(hits.length, `no error at ${path}; got:\n${errs.join('\n')}`).toBeGreaterThan(0);
  if (includes) expect(hits.join('\n')).toContain(includes);
  return errs;
}

function g3(): Policy {
  return clone(EXAMPLE_G3);
}

describe('built-in policies', () => {
  it.each([
    ['G0', G0],
    ['REF', REF],
    ['EXAMPLE_G3', EXAMPLE_G3],
  ])('%s validates', (_name, p) => {
    const r = validatePolicy(p);
    expect(r.ok ? [] : r.errors).toEqual([]);
    expect(r.ok && r.policy).toEqual(p);
    expect(PolicySchema.safeParse(p).success).toBe(true);
  });

  it('EXAMPLE_G3 is the spec §6 example verbatim', () => {
    const spec = readFileSync(new URL('../../../docs/superpowers/specs/2026-10-11-headway-design.md', import.meta.url), 'utf8');
    const m = /\*\*Example policy \(complete\):\*\*\s*```json\n([\s\S]*?)```/.exec(spec);
    expect(m).not.toBeNull();
    expect(EXAMPLE_G3).toEqual(JSON.parse(m![1]!));
  });

  it('G0 is the spec baseline', () => {
    expect(G0.meta).toMatchObject({ id: 'g0', parent: null, generation: 0, emphasis: 'baseline' });
    expect(G0.params.allocation).toEqual({ r1: 2, r2: 2, r3: 2 });
    expect(G0.rules).toHaveLength(1);
    expect(G0.rules[0]).toMatchObject({
      on: 'bus_at_terminal',
      when: [{ f: 'headway_ratio', op: '<', v: 1 }],
      do: { type: 'hold', until: 'target_headway' },
    });
    expect(G0.defaults).toEqual({
      bus_at_stop: { type: 'continue' },
      bus_at_terminal: { type: 'dispatch' },
      train_at_station: { type: 'setTrainDeparture', dwellS: 45 },
    });
  });

  it('REF is queue-responsive and otherwise behaves like G0', () => {
    expect(REF.meta).toMatchObject({ id: 'ref', emphasis: 'reference' });
    // sim tuning: REF starts the Campus Loop's spare bus on the Stadium route (1/2/3); otherwise G0's params
    expect(REF.params).toEqual({ ...G0.params, allocation: { r1: 1, r2: 2, r3: 3 } });
    expect(G0.params.allocation).toEqual({ r1: 2, r2: 2, r3: 2 });
    expect(REF.defaults).toEqual(G0.defaults);
    const byAction = (t: string) => REF.rules.filter((r) => r.do.type === t);
    expect(byAction('dispatch')[0]).toMatchObject({ on: 'bus_at_terminal', when: [{ f: 'route_queue', op: '>=', v: 40 }] });
    expect(byAction('reassign')[0]).toMatchObject({
      on: 'bus_at_terminal',
      do: { type: 'reassign', to: 'busiest' },
      when: [
        { f: 'queue_ratio_other', op: '>=', v: 2 },
        { f: 'max_other_route_queue', op: '>=', v: 30 },
        { f: 'buses_on_route', op: '>=', v: 2 },
      ],
    });
    const stopHold = REF.rules.find((r) => r.on === 'bus_at_stop');
    expect(stopHold).toMatchObject({
      do: { type: 'hold', until: 'target_headway' },
      when: [
        { f: 'headway_ratio', op: '<', v: 0.4 },
        { f: 'downstream_queue', op: '<', v: 30 },
      ],
    });
    // g0's terminal rule is kept, below the queue rules
    const g0Rule = REF.rules.find((r) => r.id === G0.rules[0]!.id)!;
    expect(g0Rule).toEqual(G0.rules[0]);
    expect(byAction('dispatch')[0]!.priority).toBeGreaterThan(g0Rule.priority);
  });
});

describe('validatePolicy rejections name the path', () => {
  it('unknown feature', () => {
    const p = g3();
    p.rules[2]!.when[0]!.f = 'train_eta';
    expectErrorAt(p, 'rules[2].when[0].f: unknown feature "train_eta" for bus_at_stop');
  });

  it('feature from another decision kind', () => {
    const p = g3();
    p.rules[2]!.when[0]!.f = 'platform_queue';
    expectErrorAt(p, 'rules[2].when[0].f', 'unknown feature "platform_queue" for bus_at_stop');
  });

  it('value out of range', () => {
    const p = g3();
    p.rules[2]!.when[0]!.v = 50; // headway_ratio 0–10
    expectErrorAt(p, 'rules[2].when[0].v', 'headway_ratio');
  });

  it('bad op', () => {
    const p = clone(p0());
    (p.rules[0]!.when[0] as { op: string }).op = '!=';
    expectErrorAt(p, 'rules[0].when[0].op');
  });

  it('allocation not summing to 6', () => {
    const p = g3();
    p.params.allocation = { r1: 3, r2: 2, r3: 2 };
    expectErrorAt(p, 'params.allocation', '6');
  });

  it('allocation with a zero or fractional route', () => {
    const p = g3();
    p.params.allocation = { r1: 0, r2: 3.5, r3: 2.5 };
    expectErrorAt(p, 'params.allocation.r1');
    expectErrorAt(p, 'params.allocation.r2');
  });

  it('25 rules', () => {
    const p = g3();
    const base = p.rules[2]!;
    p.rules = Array.from({ length: 25 }, (_, i): Rule => ({ ...clone(base), id: `rule-${i}` }));
    expectErrorAt(p, 'rules:', '24');
  });

  it('7 conditions in a rule', () => {
    const p = g3();
    p.rules[2]!.when = Array.from({ length: 7 }, () => ({ f: 'queue_here', op: '>=' as const, v: 1 }));
    expectErrorAt(p, 'rules[2].when:', '6');
  });

  it('unknown placeholder', () => {
    const p = g3();
    p.rules[1]!.say = 'Holding {seconds}s for {nonsense}';
    expectErrorAt(p, 'rules[1].say', '{nonsense}');
  });

  it('action placeholder the action cannot fill', () => {
    const p = g3();
    p.rules[1]!.say = 'Moving to {to}';
    expectErrorAt(p, 'rules[1].say', '{to}');
  });

  it('say over 140 characters', () => {
    const p = g3();
    p.rules[1]!.say = 'x'.repeat(141);
    expectErrorAt(p, 'rules[1].say', '140');
  });

  it('hold seconds 200 at a stop', () => {
    const p = g3();
    p.rules[1]!.do = { type: 'hold', seconds: 200 };
    expectErrorAt(p, 'rules[1].do.seconds', '200');
  });

  it('stop hold above params.maxHoldS', () => {
    const p = g3();
    p.rules[1]!.do = { type: 'hold', seconds: 75 }; // maxHoldS is 60
    expectErrorAt(p, 'rules[1].do.seconds', 'maxHoldS');
  });

  it('terminal hold outside 10–120', () => {
    const p = g3();
    p.rules[3]!.do = { type: 'hold', seconds: 150 };
    expectErrorAt(p, 'rules[3].do.seconds', '120');
  });

  it('reassign on bus_at_stop', () => {
    const p = g3();
    p.rules[1]!.do = { type: 'reassign', to: 'r3' };
    expectErrorAt(p, 'rules[1].do', 'bus_at_stop');
  });

  it('setTrainDeparture outside 30–120 and in defaults', () => {
    const p = g3();
    p.rules[4]!.do = { type: 'setTrainDeparture', dwellS: 10 };
    p.defaults.train_at_station = { type: 'setTrainDeparture', dwellS: 500 };
    expectErrorAt(p, 'rules[4].do.dwellS');
    expectErrorAt(p, 'defaults.train_at_station.dwellS');
  });

  it('illegal default action and missing default', () => {
    const p = g3() as unknown as { defaults: Record<string, unknown> };
    p.defaults.bus_at_terminal = { type: 'continue' };
    delete p.defaults.train_at_station;
    expectErrorAt(p, 'defaults.bus_at_terminal', 'bus_at_terminal');
    expectErrorAt(p, 'defaults.train_at_station');
  });

  it('bad and duplicate rule ids', () => {
    const p = g3();
    p.rules[0]!.id = 'Hold_Train';
    p.rules[4]!.id = p.rules[2]!.id;
    expectErrorAt(p, 'rules[0].id');
    expectErrorAt(p, 'rules[4].id', 'duplicate');
  });

  it('params limits', () => {
    const p = g3();
    p.params.maxHoldS = 120;
    p.params.trainDefaultDwellS = 20;
    p.params.targetHeadwayS = { r1: 30 };
    expectErrorAt(p, 'params.maxHoldS', '90');
    expectErrorAt(p, 'params.trainDefaultDwellS');
    expectErrorAt(p, 'params.targetHeadwayS.r1');
  });

  it('summary and advisor limits', () => {
    const p = g3();
    p.meta.summary = 'y'.repeat(201);
    p.advisor = {
      provider: 'jev',
      enabled: true,
      askWhen: [{ f: 'route_queue', op: '>=', v: 1 }],
      holdOptionsS: [0, 20, 40, 60],
      instructions: 'z'.repeat(1201),
    };
    expectErrorAt(p, 'meta.summary', '200');
    expectErrorAt(p, 'advisor.instructions', '1200');
    expectErrorAt(p, 'advisor.askWhen[0].f', 'route_queue');
  });

  it('reports every error in one pass, including structural ones', () => {
    const p = g3() as unknown as { rules: Array<Record<string, unknown>>; params: Record<string, unknown> };
    p.rules[0]!.on = 'bus_at_station';
    p.rules[1]!.when = [{ f: 'train_eta', op: '!=', v: '45' }];
    p.params.allocation = { r1: 4, r2: 2, r3: 2 };
    const errs = errorsOf(p);
    for (const path of ['rules[0].on', 'rules[1].when[0].f', 'rules[1].when[0].op', 'rules[1].when[0].v', 'params.allocation']) {
      expect(errs.some((e) => e.startsWith(path)), `${path} missing in\n${errs.join('\n')}`).toBe(true);
    }
  });

  it('rejects non-objects without throwing', () => {
    for (const x of [null, 42, 'policy', [], { rules: 'nope' }]) {
      expect(validatePolicy(x).ok).toBe(false);
    }
  });

  it('tolerates and strips unknown keys (LLM chatter)', () => {
    const p = { ...g3(), changes: ['x'], notes: 'hi' };
    const r = validatePolicy(p);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.policy).toEqual(EXAMPLE_G3);
  });

  it('PolicySchema agrees with validatePolicy', () => {
    const bad = g3();
    bad.rules[1]!.do = { type: 'reassign', to: 'r3' };
    expect(PolicySchema.safeParse(bad).success).toBe(false);
    expect(PolicySchema.safeParse(g3()).success).toBe(true);
  });
});

function p0(): Policy {
  return clone(G0);
}

describe('features, placeholders, legal actions', () => {
  it('whitelists the spec §6 features with ranges', () => {
    expect(Object.keys(FEATURES.bus_at_stop).sort()).toEqual(
      [
        'onboard', 'load_factor', 'queue_here', 'headway_ahead_s', 'headway_behind_s', 'target_headway_s', 'headway_ratio',
        'train_eta_s', 'expected_transfers', 'downstream_queue', 'hold_used_s', 'is_station', 'event_in_s',
      ].sort(),
    );
    expect(Object.keys(FEATURES.bus_at_terminal).sort()).toEqual(
      [
        'route_queue', 'max_other_route_queue', 'queue_ratio_other', 'buses_on_route', 'headway_ahead_s', 'target_headway_s',
        'headway_ratio', 'layover_s', 'event_in_s',
      ].sort(),
    );
    expect(Object.keys(FEATURES.train_at_station).sort()).toEqual(
      ['onboard', 'platform_queue', 'buses_here_or_due_60s', 'next_bus_eta_s', 'transfers_alighted', 'dwell_s', 'event_in_s'].sort(),
    );
    expect(FEATURES.bus_at_stop.train_eta_s).toMatchObject({ min: 0, max: 9999 });
    expect(FEATURES.bus_at_stop.event_in_s).toMatchObject({ min: -9999, max: 9999 });
    expect(FEATURES.bus_at_terminal.buses_on_route).toMatchObject({ min: 1, max: 6 });
    expect(FEATURES.train_at_station.onboard).toMatchObject({ min: 0, max: 160 });
    for (const k of KINDS) for (const s of Object.values(FEATURES[k])) expect(s.desc.length).toBeGreaterThan(3);
  });

  it('placeholders are the features plus the action parameters of the kind', () => {
    expect(PLACEHOLDERS.bus_at_stop).toEqual([...Object.keys(FEATURES.bus_at_stop), 'seconds']);
    expect(PLACEHOLDERS.bus_at_terminal).toEqual([...Object.keys(FEATURES.bus_at_terminal), 'seconds', 'to']);
    expect(PLACEHOLDERS.train_at_station).toEqual([...Object.keys(FEATURES.train_at_station), 'dwellS']);
  });

  it('legal action types per kind', () => {
    expect(legalActionTypes('bus_at_stop')).toEqual(['continue', 'hold']);
    expect(legalActionTypes('bus_at_terminal')).toEqual(['dispatch', 'hold', 'reassign']);
    expect(legalActionTypes('train_at_station')).toEqual(['setTrainDeparture']);
  });
});

describe('explain', () => {
  it('fills features and action parameters (plan example)', () => {
    expect(explain('Holding {seconds}s ({train_eta_s}s away)', { train_eta_s: 34 }, { type: 'hold', seconds: 45 })).toBe(
      'Holding 45s (34s away)',
    );
  });

  it('integers stay integers, other numbers get one decimal', () => {
    expect(explain('{headway_ratio} / {load_factor} / {onboard}', { headway_ratio: 0.4567, load_factor: 0.25, onboard: 18 }, { type: 'continue' })).toBe(
      '0.5 / 0.3 / 18',
    );
  });

  it('fills dwellS and to', () => {
    expect(explain('Train waits {dwellS}s: a bus arrives in {next_bus_eta_s}s', { next_bus_eta_s: 22 }, { type: 'setTrainDeparture', dwellS: 75 })).toBe(
      'Train waits 75s: a bus arrives in 22s',
    );
    expect(explain('Moving to {to}', {}, { type: 'reassign', to: 'r3' })).toBe('Moving to r3');
  });

  it('resolves {seconds} for an unresolved hold-until from the features', () => {
    expect(
      explain('Waiting {seconds}s to keep a {target_headway_s}s headway', { target_headway_s: 300, headway_ahead_s: 120 }, { type: 'hold', until: 'target_headway' }),
    ).toBe('Waiting 180s to keep a 300s headway');
  });

  it('leaves unknown placeholders verbatim', () => {
    expect(explain('Hi {nobody} {seconds} {constructor}', { onboard: 3 }, { type: 'continue' })).toBe('Hi {nobody} {seconds} {constructor}');
  });

  it('explains every built-in rule without leftover placeholders', () => {
    for (const p of [G0, REF, EXAMPLE_G3]) {
      for (const r of p.rules) {
        const features = Object.fromEntries(Object.entries(FEATURES[r.on]).map(([k, s]) => [k, Math.min(s.max, Math.max(s.min, 30))]));
        const action = r.do.type === 'hold' && 'until' in r.do ? { type: 'hold' as const, seconds: 30 } : r.do;
        expect(explain(r.say, features, action)).not.toMatch(/\{[A-Za-z_]+\}/);
      }
    }
  });
});

describe('POLICY_DSL_DOC', () => {
  it('is compact and covers kinds, every feature, actions and limits', () => {
    expect(POLICY_DSL_DOC.length).toBeGreaterThan(1500);
    expect(POLICY_DSL_DOC.length).toBeLessThanOrEqual(5400); // v3: + depot_check (4th kind, 13 features)
    for (const k of KINDS) {
      expect(POLICY_DSL_DOC).toContain(k);
      for (const f of Object.keys(FEATURES[k])) expect(POLICY_DSL_DOC).toContain(f);
    }
    for (const t of ['continue', 'dispatch', 'hold', 'target_headway', 'reassign', 'busiest', 'setTrainDeparture', 'deploy']) {
      expect(POLICY_DSL_DOC).toContain(t);
    }
    for (const s of ['24', '140', '200', '1200', 'priority', 'defaults', 'allocation']) expect(POLICY_DSL_DOC).toContain(s);
  });
});
