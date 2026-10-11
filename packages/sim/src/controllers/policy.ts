// Owner: T1a. Interprets a Policy at decision points (spec §6 semantics):
// rules with `on == kind` in descending priority (ties by array order); the first whose conditions all hold AND
// whose action is applicable fires; otherwise `defaults[kind]` with ruleId 'default'. The explanation is the rule's
// `say` filled with the real feature values and the resolved action parameters.
import { DEFAULT_CONFIG } from '../config';
import type { Condition, Controller, Decision, DecisionKind, DecisionPoint, Observation, Policy, RouteId, Rule } from '../contracts';
import { defaultExplanation, resolveAction, safeAction, type ResolveCtx } from '../engine/actions';
import { explain } from '../policy/explain';

const KINDS: DecisionKind[] = ['bus_at_stop', 'bus_at_terminal', 'train_at_station'];

function holds(c: Condition, f: DecisionPoint['features']): boolean {
  const x = f[c.f];
  if (typeof x !== 'number' || Number.isNaN(x)) return false;
  switch (c.op) {
    case '<': return x < c.v;
    case '<=': return x <= c.v;
    case '>': return x > c.v;
    case '>=': return x >= c.v;
    case '==': return x === c.v;
  }
  return false;
}

export class PolicyController implements Controller {
  readonly id: string;
  private readonly byKind: Record<DecisionKind, Rule[]>;

  constructor(readonly policy: Policy) {
    this.id = policy.meta?.id ?? 'policy';
    const rules = Array.isArray(policy.rules) ? policy.rules : [];
    this.byKind = Object.fromEntries(KINDS.map((k) => [
      k,
      rules
        .map((r, i) => ({ r, i }))
        .filter((x) => x.r.on === k)
        .sort((a, b) => (b.r.priority - a.r.priority) || (a.i - b.i))
        .map((x) => x.r),
    ])) as Record<DecisionKind, Rule[]>;
  }

  decide(dp: DecisionPoint, obs: Observation): Decision {
    const ctx = this.ctx(dp, obs);
    for (const rule of this.byKind[dp.kind]) {
      if (!rule.when.every((c) => holds(c, dp.features))) continue;
      const action = resolveAction(rule.do, ctx);
      if (!action) continue;
      return { action, ruleId: rule.id, explanation: explain(rule.say, dp.features, action), source: 'policy' };
    }
    const action = resolveAction(this.policy.defaults?.[dp.kind], ctx)
      ?? safeAction(dp.kind, this.policy.params?.trainDefaultDwellS ?? DEFAULT_CONFIG.train.defaultDwellS);
    return { action, ruleId: 'default', explanation: defaultExplanation(action), source: 'default' };
  }

  private ctx(dp: DecisionPoint, obs: Observation): ResolveCtx {
    const lim = DEFAULT_CONFIG.limits;
    const routes = obs?.routes ?? [];
    const routeIds = routes.length ? routes.map((r) => r.id) : (['r1', 'r2', 'r3'] as RouteId[]);
    return {
      kind: dp.kind,
      features: dp.features,
      routeId: dp.routeId,
      routeIds,
      routeQueue: (r) => routes.find((x) => x.id === r)?.queue ?? 0,
      maxHoldS: Math.min(lim.maxHoldS, this.policy.params?.maxHoldS ?? lim.maxHoldS),
      maxHoldPerLoopS: lim.maxHoldPerLoopS,
      maxLayoverS: lim.maxLayoverS,
      minBusesPerRoute: lim.minBusesPerRoute,
      trainMinDwellS: DEFAULT_CONFIG.train.minDwellS,
      trainMaxDwellS: DEFAULT_CONFIG.train.maxDwellS,
    };
  }
}

