// Owner: T6. Jev-backed station-hold controller (spec §9).
// Jev decides only `bus_at_stop` at station stops, when the policy's `advisor.enabled` is set and every `advisor.askWhen`
// condition holds (default: train_eta_s <= 120). Code generates the legal options from `advisor.holdOptionsS`; Jev picks
// one (argmax of its probabilities, ties → lowest index). Every other decision, and any timeout or error, comes from
// the rules (`PolicyController`). The provider is injected, so the sim stays network-free; the engine logs each async
// decision in `Replay.decisions`, so replays never call Jev again.
import { DEFAULT_CONFIG } from '../config';
import type {
  Action, AsyncController, Condition, Decision, DecisionPoint, FeatureVector, Observation, Policy, RouteId, SimConfig, TownMap,
} from '../contracts';
import { STOP_HOLD_MIN_S } from '../engine/actions';
import { TOWN } from '../map/town';
import { PolicyController } from './policy';

export interface DecisionProvider {
  choose(req: { instructions: string; situation: string; options: string[] }): Promise<{ index: number; probs: number[]; latencyMs: number }>;
}

const DEFAULT_HOLD_OPTIONS_S = [0, 20, 40, 60];
const DEFAULT_ASK_WHEN: Condition[] = [{ f: 'train_eta_s', op: '<=', v: 120 }];
const DEFAULT_TIMEOUT_MS = 800;
const DEFAULT_MODEL = 'typesafe/jev-1.13';
const MAX_OPTIONS = 8;

/** Timers without DOM/Node typings (the sim compiles against ES2022 only). Looked up per call so fake timers work. */
type TimerHost = { setTimeout(cb: () => void, ms: number): unknown; clearTimeout(h: unknown): void };
const timers = (): TimerHost => globalThis as unknown as TimerHost;

function holds(c: Condition, f: FeatureVector): boolean {
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

// ------------------------------------------------------------------------------------------------ options
/**
 * The legal hold choices for a `bus_at_stop` decision: `advisor.holdOptionsS` (default [0, 20, 40, 60]) clamped like the
 * engine clamps holds (5 s minimum, min(cfg, policy) maxHoldS, the hold budget left this loop), sorted, de-duplicated.
 * 0 → "Depart now" (continue). Other decision kinds have no hold options.
 */
export function holdOptions(policy: Policy, dp: DecisionPoint, cfg: SimConfig): Array<{ label: string; action: Action }> {
  if (dp.kind !== 'bus_at_stop') return [];
  const raw = Array.isArray(policy.advisor?.holdOptionsS) && policy.advisor.holdOptionsS.length > 0
    ? policy.advisor.holdOptionsS : DEFAULT_HOLD_OPTIONS_S;
  const policyMax = policy.params?.maxHoldS;
  const maxHold = Math.floor(Math.min(cfg.limits.maxHoldS, typeof policyMax === 'number' ? policyMax : cfg.limits.maxHoldS));
  const budget = cfg.limits.maxHoldPerLoopS - (dp.features.hold_used_s ?? 0);
  const seconds = new Set<number>();
  for (const v of raw) {
    const s0 = Number(v);
    if (!Number.isFinite(s0) || s0 < 0) continue;
    if (s0 === 0) { seconds.add(0); continue; }
    const s = Math.min(Math.min(Math.max(Math.round(s0), STOP_HOLD_MIN_S), maxHold), budget);
    if (s > 0) seconds.add(s);
  }
  return [...seconds].sort((a, b) => a - b).slice(0, MAX_OPTIONS).map((s) => (s === 0
    ? { label: 'Depart now', action: { type: 'continue' } }
    : { label: `Hold ${s} s`, action: { type: 'hold', seconds: s } }));
}

// ------------------------------------------------------------------------------------------------ situation
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "34 s" below 100 s, else minutes to the nearest half minute ("2.5 min", "6 min"). */
function dur(s: number): string {
  const x = Math.max(0, Math.round(s));
  if (x < 100) return `${x} s`;
  return `${Math.round(x / 30) / 2} min`;
}

function routeLabel(r: RouteId | undefined): string {
  return r ? `Route ${r.replace(/^r/, '')}` : 'this route';
}

function eventLabel(obs: Observation, dp: DecisionPoint, inS: number): string {
  const at = dp.t + inS;
  const evs = obs?.scenario?.advertised ?? [];
  const exact = evs.find((e) => e.t === at);
  const near = exact ?? [...evs].sort((a, b) => Math.abs(a.t - at) - Math.abs(b.t - at))[0];
  return near?.label ?? 'advertised event';
}

function describe(dp: DecisionPoint, obs: Observation, map: TownMap): string {
  const f = dp.features;
  const n = (k: string, d = 0) => (typeof f[k] === 'number' && Number.isFinite(f[k]) ? f[k] : d);
  const route = routeLabel(dp.routeId);
  const stop = dp.stopId ? map.stops.find((s) => s.id === dp.stopId) : undefined;
  const where = stop?.name ?? dp.stopId ?? 'a stop';
  const bus = obs?.buses?.find((b) => b.id === dp.vehicleId);
  const capacity = bus?.capacity ?? DEFAULT_CONFIG.bus.capacity;
  const out: string[] = [`Bus ${dp.vehicleId} (${route}) at ${where}.`, `${n('onboard')} aboard of ${capacity}.`];

  const eta = n('train_eta_s', 9999);
  const xfer = plural(n('expected_transfers'), 'rider', 'riders');
  if (eta >= 9999) out.push('No train due here in the next 15 min.');
  else if (eta <= 0) out.push(`Train is at the platform now with ${xfer} transferring to ${route}.`);
  else out.push(`Train arrives in ${dur(eta)} with ${xfer} transferring to ${route}.`);

  const behind = n('headway_behind_s', 3600);
  out.push(behind >= 3600 ? `No other ${route} bus is behind this one.` : `Next ${route} bus is ${dur(behind)} behind.`);
  const ahead = n('headway_ahead_s', 3600);
  const target = n('target_headway_s', 0);
  const spacing = target > 0 ? ` (target spacing ${dur(target)})` : '';
  out.push(ahead >= 3600 ? `No ${route} bus has left here yet${spacing}.` : `Previous ${route} bus left ${dur(ahead)} ago${spacing}.`);

  out.push(`${n('queue_here')} still waiting here; ${n('downstream_queue')} waiting at the next two stops.`);
  const used = n('hold_used_s');
  if (used > 0) out.push(`This bus already held ${Math.round(used)} s this loop.`);
  const ev = n('event_in_s', 9999);
  if (ev > 0 && ev < 9999) out.push(`Event "${eventLabel(obs, dp, ev)}" in ${dur(ev)}.`);
  else if (ev <= 0 && ev > -9999) out.push(`Event "${eventLabel(obs, dp, ev)}" was ${dur(-ev)} ago.`);
  return out.join(' ');
}

/** The fixed-template description Jev reads (spec §9), built from the decision's features. */
export function situationText(dp: DecisionPoint, obs: Observation): string {
  return describe(dp, obs, TOWN);
}

// ------------------------------------------------------------------------------------------------ controller
const TIMEOUT = Symbol('jev-timeout');

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  if (!Number.isFinite(ms)) return p;
  return new Promise<T>((resolve, reject) => {
    const h = timers().setTimeout(() => reject(TIMEOUT), Math.max(0, ms));
    p.then(
      (v) => { timers().clearTimeout(h); resolve(v); },
      (e: unknown) => { timers().clearTimeout(h); reject(e); },
    );
  });
}

/** Argmax of usable probabilities (ties → lowest index), else the provider's index, else null. */
function pickOption(res: unknown, count: number): { index: number; p: number | null } | null {
  if (!res || typeof res !== 'object') return null;
  const { index, probs } = res as { index?: unknown; probs?: unknown };
  const usable = Array.isArray(probs) && probs.length === count && probs.every((x) => typeof x === 'number' && Number.isFinite(x))
    ? (probs as number[]) : null;
  if (usable && usable.some((x) => x > 0)) {
    let best = 0;
    for (let i = 1; i < count; i++) if (usable[i]! > usable[best]!) best = i;
    return { index: best, p: usable[best]! };
  }
  if (typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < count) {
    return { index, p: usable ? usable[index]! : null };
  }
  return null;
}

export interface JevStats {
  /** Decisions sent to the provider. */
  asked: number;
  /** Decisions Jev made (source 'jev'). */
  answered: number;
  timeouts: number;
  errors: number;
  /** Chosen option label → count. */
  chosen: Record<string, number>;
  /** Sum of provider-reported latencies of answered calls. */
  latencyMs: number;
}

export class JevController implements AsyncController {
  readonly async = true as const;
  readonly id: string;
  /** Reported in `RunResult.controller` (the engine reads `model`). */
  readonly model: string;
  readonly stats: JevStats = { asked: 0, answered: 0, timeouts: 0, errors: 0, chosen: {}, latencyMs: 0 };
  private readonly rules: PolicyController;

  constructor(readonly policy: Policy, readonly provider: DecisionProvider, readonly opts: { timeoutMs?: number; map?: TownMap } = {}) {
    this.id = 'jev:' + (policy.meta?.id ?? 'policy');
    const m = (provider as { model?: unknown }).model;
    this.model = typeof m === 'string' && m ? m : DEFAULT_MODEL;
    this.rules = new PolicyController(policy);
  }

  /** True when Jev (not the rules) should make this decision. */
  private asks(dp: DecisionPoint): boolean {
    const a = this.policy.advisor;
    if (!a?.enabled || dp.kind !== 'bus_at_stop') return false;
    const map = this.opts.map ?? TOWN;
    const stop = dp.stopId ? map.stops.find((s) => s.id === dp.stopId) : undefined;
    const isStation = stop ? !!stop.stationId : dp.features.is_station === 1;
    if (!isStation) return false;
    const when = Array.isArray(a.askWhen) ? a.askWhen : DEFAULT_ASK_WHEN;
    return when.every((c) => holds(c, dp.features));
  }

  private fallback(dp: DecisionPoint, obs: Observation, why: string): Decision {
    const d = this.rules.decide(dp, obs);
    return { ...d, explanation: `${why}: ${d.explanation}`, source: 'fallback' };
  }

  async decide(dp: DecisionPoint, obs: Observation): Promise<Decision> {
    if (!this.asks(dp)) return this.rules.decide(dp, obs);
    const options = holdOptions(this.policy, dp, DEFAULT_CONFIG);
    if (options.length < 2) return this.rules.decide(dp, obs);
    const req = {
      instructions: this.policy.advisor?.instructions ?? '',
      situation: describe(dp, obs, this.opts.map ?? TOWN),
      options: options.map((o) => o.label),
    };
    this.stats.asked++;
    let res: Awaited<ReturnType<DecisionProvider['choose']>>;
    try {
      let call: Promise<Awaited<ReturnType<DecisionProvider['choose']>>>;
      try { call = Promise.resolve(this.provider.choose(req)); } catch (e) { call = Promise.reject(e); }
      res = await withTimeout(call, this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    } catch (e) {
      if (e === TIMEOUT) { this.stats.timeouts++; return this.fallback(dp, obs, 'Jev timed out'); }
      this.stats.errors++;
      return this.fallback(dp, obs, 'Jev error');
    }
    const pick = pickOption(res, options.length);
    if (!pick) { this.stats.errors++; return this.fallback(dp, obs, 'Jev error'); }
    const opt = options[pick.index]!;
    this.stats.answered++;
    this.stats.chosen[opt.label] = (this.stats.chosen[opt.label] ?? 0) + 1;
    const lat = (res as { latencyMs?: unknown }).latencyMs;
    if (typeof lat === 'number' && Number.isFinite(lat)) this.stats.latencyMs += lat;
    const p = pick.p === null ? '' : ` (p ${pick.p.toFixed(2)})`;
    return { action: opt.action, ruleId: 'jev', explanation: `Jev chose ${opt.label}${p}`, source: 'jev' };
  }
}
