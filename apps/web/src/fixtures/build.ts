// Owner: Task P. Internal builders for the web fixtures (not part of the public fixture API; import from './index').
// Findings use the spec §8.4 sentence templates; metrics derive meanJourneyS from J so every number stays consistent
// with J = Σ completed journeys + Σ unfinished ((T_end − spawnT) + penalty).
import type { FailureFinding, Metrics, QueuePlace, RouteId, SplitScore, StationId, StopId } from '@headway/sim';

export const SIM_VERSION = '1';
export const MAP_VERSION = '1';
export const T_END = 2700;
const PENALTY_S = 2700;
/** Riders still travelling at T_end spawned at ~1250 s on average, so each costs (2700 − 1250) + 2700 s. */
const UNFINISHED_COST_S = T_END - 1250 + PENALTY_S;

export const CLOCK = { stadium_exit: '21:30', class_change: '11:45' } as const;
export const PRIMARY_MODEL = 'deepseek-ai/DeepSeek-V4.1-Flash';
export const FALLBACK_MODEL = 'deepseek/deepseek-v4-pro';
export const LUMINAL_AUTHOR = 'deepseek-v4.1-flash@luminal';
export const OPENROUTER_AUTHOR = 'deepseek-v4-pro@openrouter';

// ---------- names (for sentences only) ----------
const STOP_NAME: Record<StopId, string> = {
  stop_stadium_gate: 'Stadium Gate', stop_stadium_stn: 'Stadium Station', stop_university_stn: 'University',
  stop_old_main: 'Old Main', stop_downtown: 'Downtown', stop_central_stn: 'Central',
  stop_apts_north: 'Apartments North', stop_apts_south: 'Apartments South',
};
const PLATFORM_NAME: Record<StationId, string> = {
  stn_stadium: 'Stadium platform', stn_university: 'University platform', stn_central: 'Central platform',
};
const routeName = (r: RouteId) => `Route ${r.slice(1)}`;
const modeName = (m: RouteId | 'train') => (m === 'train' ? 'the train' : routeName(m));
const placeName = (p: QueuePlace) => (p.kind === 'stop' ? STOP_NAME[p.id] : PLATFORM_NAME[p.id]);
export const stop = (id: StopId): QueuePlace => ({ kind: 'stop', id });
export const platform = (id: StationId): QueuePlace => ({ kind: 'platform', id });

export function clockAt(clockStart: string, t: number): string {
  const [h, m] = clockStart.split(':').map(Number) as [number, number];
  const mins = (h * 60 + m + Math.floor(t / 60)) % (24 * 60);
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

// ---------- findings (impactS = passenger-seconds, rough but monotone) ----------
export const F = {
  gap(clock: string, stopId: StopId, routeId: RouteId, fromT: number, toT: number, affected: number): FailureFinding {
    const gapS = toT - fromT;
    return {
      kind: 'service_gap', stopId, routeId, gapS, fromT, toT, affected, impactS: Math.round((affected * gapS) / 2),
      text: `${STOP_NAME[stopId]} went ${Math.round(gapS / 60)} min without a ${routeName(routeId)} bus (${clockAt(clock, fromT)}–${clockAt(clock, toT)}).`,
    };
  },
  missed(at: QueuePlace, from: RouteId | 'train', to: RouteId | 'train', count: number, window: [number, number]): FailureFinding {
    return {
      kind: 'missed_transfer', at, from, to, count, window, impactS: count * 300,
      text: `${count} riders reached ${placeName(at)} from ${modeName(from)} just after ${modeName(to)} left.`,
    };
  },
  bunching(routeId: RouteId, stopId: StopId, events: number, minHeadwayS: number): FailureFinding {
    return {
      kind: 'bunching', routeId, stopId, events, minHeadwayS, impactS: events * 1500,
      text: `${routeName(routeId)} buses bunched ${events}× (as close as ${minHeadwayS} s).`,
    };
  },
  overload(at: QueuePlace, routeId: RouteId | 'train', leftBehind: number, peakQueue: number): FailureFinding {
    return {
      kind: 'overload', at, routeId, leftBehind, peakQueue, impactS: leftBehind * 420,
      text: `${leftBehind} people were left behind at ${placeName(at)}; the queue peaked at ${peakQueue}.`,
    };
  },
  unused(routeId: RouteId, meanLoad: number, elsewhere: { stopId: StopId; queue: number }): FailureFinding {
    return {
      kind: 'unused_capacity', routeId, meanLoad, elsewhere, impactS: elsewhere.queue * 50,
      text: `${routeName(routeId)} ran ${Math.round((1 - meanLoad) * 100)}% empty while ${STOP_NAME[elsewhere.stopId]} queued ${elsewhere.queue}.`,
    };
  },
  longHold(vehicleId: string, stopId: StopId, holdS: number, delayedOnboard: number, transfersGained: number): FailureFinding {
    return {
      kind: 'long_hold', vehicleId, stopId, holdS, delayedOnboard, transfersGained, impactS: delayedOnboard * holdS,
      text: `Holding ${vehicleId} ${holdS} s at ${STOP_NAME[stopId]} gained ${transfersGained} transfers but delayed ${delayedOnboard} riders.`,
    };
  },
};

export const byImpact = (fs: FailureFinding[]): FailureFinding[] => [...fs].sort((a, b) => b.impactS - a.impactS);

/** Kind + place, the way evolve matches findings between policies (spec §8.4). */
function findingKey(f: FailureFinding): string {
  const place = (p: QueuePlace) => `${p.kind}:${p.id}`;
  switch (f.kind) {
    case 'service_gap': return `service_gap|${f.stopId}|${f.routeId}`;
    case 'missed_transfer': return `missed_transfer|${place(f.at)}|${f.from}|${f.to}`;
    case 'bunching': return `bunching|${f.routeId}`;
    case 'overload': return `overload|${place(f.at)}|${f.routeId}`;
    case 'unused_capacity': return `unused_capacity|${f.routeId}`;
    case 'long_hold': return `long_hold|${f.stopId}`;
  }
}

/** The champion's findings with some replaced (same kind + place), some added, and `drop` keys removed. */
export function amend(base: FailureFinding[], changes: FailureFinding[], drop: Array<(f: FailureFinding) => boolean> = []): FailureFinding[] {
  const keys = new Set(changes.map(findingKey));
  return byImpact([...base.filter((f) => !keys.has(findingKey(f)) && !drop.some((d) => d(f))), ...changes]);
}

// ---------- narratives (same shape as packages/evolve narrative: head + top 2 gains + top 2 costs) ----------
export function signedPct(x: number): string {
  const r = Math.round(x * 10) / 10;
  if (r === 0) return '0.0%';
  return `${r < 0 ? '−' : '+'}${Math.abs(r).toFixed(1)}%`;
}

function size(f: FailureFinding): string {
  switch (f.kind) {
    case 'service_gap': return `${Math.round(f.gapS / 60)} min`;
    case 'missed_transfer': return `${f.count} riders`;
    case 'bunching': return `${f.events}×`;
    case 'overload': return `${f.leftBehind} left behind`;
    case 'unused_capacity': return `${Math.round((1 - f.meanLoad) * 100)}% empty`;
    case 'long_hold': return `${f.holdS} s hold`;
  }
}
const noDot = (s: string) => s.trim().replace(/[.\s]+$/, '');

/** "ΔJ −6.1% on training." + eased/fixed gains and worse/new costs versus the champion's findings. */
export function narrate(candidate: FailureFinding[], champion: FailureFinding[], deltaPct: number): string {
  const group = (fs: FailureFinding[]) => {
    const m = new Map<string, { top: FailureFinding; impactS: number }>();
    for (const f of fs) {
      const g = m.get(findingKey(f));
      if (!g) m.set(findingKey(f), { top: f, impactS: f.impactS });
      else { g.impactS += f.impactS; if (f.impactS > g.top.impactS) g.top = f; }
    }
    return m;
  };
  const cand = group(candidate);
  const champ = group(champion);
  const changes: Array<{ delta: number; c?: FailureFinding; p?: FailureFinding }> = [];
  for (const key of new Set([...cand.keys(), ...champ.keys()])) {
    const c = cand.get(key);
    const p = champ.get(key);
    const delta = (c?.impactS ?? 0) - (p?.impactS ?? 0);
    if (Math.abs(delta) >= 60) changes.push({ delta, ...(c ? { c: c.top } : {}), ...(p ? { p: p.top } : {}) });
  }
  const gains = changes.filter((x) => x.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 2);
  const costs = changes.filter((x) => x.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 2);
  const parts = [`ΔJ ${signedPct(deltaPct)} on training.`];
  for (const { c, p } of gains) parts.push(c ? `Eased: ${noDot(p!.text)} (now ${size(c)}).` : `Fixed: ${noDot(p!.text)}.`);
  for (const { c, p } of costs) parts.push(p ? `Worse: ${noDot(c!.text)} (was ${size(p)}).` : `New: ${noDot(c!.text)}.`);
  if (parts.length === 1) parts.push('No finding changed noticeably.');
  return parts.join(' ');
}

// ---------- metrics ----------
export interface MetricsSpec {
  J: number; spawned: number; completed: number;
  wait: [mean: number, p95: number, max: number];
  transfersMade: number; missedConnections: number; leftBehind: number; walkaways: number;
  effort: [busDistanceU: number, deadheadDistanceU: number, holdS: number, trainDwellS: number];
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
export const scaleJ = (J: number, pct: number) => Math.round(J * (1 + pct / 100));
export const pctChange = (a: number, b: number) => round(((a - b) / b) * 100, 2);

export function metrics(s: MetricsSpec): Metrics {
  const unfinished = s.spawned - s.completed;
  return {
    J: s.J, spawned: s.spawned, completed: s.completed, unfinished,
    completionPct: round((100 * s.completed) / s.spawned, 2),
    meanJourneyS: round((s.J - unfinished * UNFINISHED_COST_S) / s.completed, 1),
    meanWaitS: s.wait[0], p95WaitS: s.wait[1], maxWaitS: s.wait[2],
    transfersMade: s.transfersMade, missedConnections: s.missedConnections, leftBehind: s.leftBehind, walkaways: s.walkaways,
    effort: { busDistanceU: s.effort[0], deadheadDistanceU: s.effort[1], holdS: s.effort[2], trainDwellS: s.effort[3] },
  };
}

export const score = (s: MetricsSpec, runs: number): SplitScore => ({ J: s.J, metrics: metrics(s), runs });

/** A sibling result: J moved by `pct`, everything else from `base` unless overridden. */
export const variant = (base: MetricsSpec, pct: number, over: Partial<MetricsSpec> = {}): MetricsSpec => ({ ...base, ...over, J: scaleJ(base.J, pct) });

/** FNV-1a 32-bit over JSON — a stable, plausible-looking RunResult.hash. */
export function fnv1a(x: unknown): string {
  const s = JSON.stringify(x);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
