// Owner: T3c. Pure Play-mode logic: action legality, train dwell maths, pace, verdict, findings diff, formatting.
// Everything here reads only the Observation / snapshot the player already sees (no future information).
import { DEFAULT_CONFIG, clockAt, findingSentence } from '@headway/sim';
import type { DecisionRecord, FailureFinding, Observation, QueuePlace, RouteId, VehicleView } from '@headway/sim';

// ---------- legality ----------
export type Gate = { ok: true } | { ok: false; why: string };
const OK: Gate = { ok: true };
const no = (why: string): Gate => ({ ok: false, why });

export const ROUTES: readonly RouteId[] = ['r1', 'r2', 'r3'];
export const TRAIN_ID = 't1';
/** Pseudo vehicle id for depot intents (deploy names a route, not a bus) and the depot selection. */
export const DEPOT_ID = 'depot';

export interface Limits { maxHoldPerLoopS: number; minBusesPerRoute: number }
export const DEFAULT_LIMITS: Limits = { maxHoldPerLoopS: 180, minBusesPerRoute: 1 };

export interface DockLegality {
  target: { kind: 'bus' | 'train'; id: string } | null;
  dispatch: Gate; hold: Gate; reassign: Gate; train: Gate;
  reassignTo: Record<RouteId, Gate>;
  /** Send a reserve bus out of the depot (independent of the selection). */
  deploy: Gate;
  deployTo: Record<RouteId, Gate>;
}

// ---------- depot ----------
export interface DepotState { open: boolean; reserves: string[]; deploying: string[] }

/** The depot as observed (closed until the engine provides `obs.depot`). */
export function depotOf(obs: Observation | null): DepotState {
  const d = obs?.depot;
  return d ? { open: true, reserves: [...d.reserves], deploying: [...d.deploying] } : { open: false, reserves: [], deploying: [] };
}

/** True when the selection means "the depot": the depot itself or a parked reserve bus. */
export function isDepotPick(sel: { kind: string; id: string } | null | undefined, obs: Observation | null): boolean {
  if (!sel) return false;
  if (sel.kind === 'depot') return true;
  if (sel.kind !== 'bus') return false;
  if (sel.id === DEPOT_ID) return true;
  if (obs?.depot?.reserves.includes(sel.id)) return true;
  return obs?.buses.find((b) => b.id === sel.id)?.state === 'depot';
}

export function deployGate(obs: Observation | null, pending = 0, done = false): Gate {
  if (done) return no('Run finished');
  if (!obs) return no('Waiting for the simulator');
  if (!obs.depot) return no('The depot opens with the next sim update');
  return obs.depot.reserves.length - pending <= 0 ? no('No spare buses left in the depot') : OK;
}

/** Fleet sizes for copy (config defaults; v3 adds reserves and train cars). */
export function fleetFacts(): { buses: number; reserves: number; cars: number; trainCapacity: number } {
  const c = DEFAULT_CONFIG;
  return { buses: c.bus.count, reserves: c.bus.reserve ?? 2, cars: c.train.cars ?? 3, trainCapacity: c.train.capacity };
}

type Bus = Observation['buses'][number];

/** A bus is at its terminal while in layover, or while holding on a hold that a terminal decision raised. */
export function atTerminal(b: Bus, view?: VehicleView | null): boolean {
  if (b.state === 'layover') return true;
  return b.state === 'holding' && view?.lastDecision?.kind === 'bus_at_terminal';
}

export function legalActions(
  obs: Observation | null,
  selection: { kind: string; id: string } | null,
  opts: { view?: VehicleView | null; limits?: Limits; pendingAway?: Partial<Record<RouteId, number>>; pendingDeploys?: number; done?: boolean } = {},
): DockLegality {
  const limits = opts.limits ?? DEFAULT_LIMITS;
  const target = selection && (selection.kind === 'bus' || selection.kind === 'train')
    ? { kind: selection.kind as 'bus' | 'train', id: selection.id } : null;
  const dep = deployGate(obs, opts.pendingDeploys ?? 0, opts.done);
  const all = (g: Gate): DockLegality => ({
    target, dispatch: g, hold: g, reassign: g, train: g, reassignTo: { r1: g, r2: g, r3: g },
    deploy: dep, deployTo: { r1: dep, r2: dep, r3: dep },
  });
  if (opts.done) return all(no('Run finished'));
  if (!obs) return all(no('Waiting for the simulator'));

  const out = all(no(target?.kind === 'train' ? 'Select a bus — this is the train' : 'Select a bus first'));
  out.train = OK;
  if (target?.kind !== 'bus') return out;
  if (isDepotPick(target, obs)) {
    const why = 'Parked in the depot — deploy it to a route';
    return { ...out, dispatch: no(why), hold: no(why), reassign: no(why), reassignTo: { r1: no(why), r2: no(why), r3: no(why) } };
  }
  const b = obs.buses.find((x) => x.id === target.id);
  if (!b) return { ...out, dispatch: no('Bus not found'), hold: no('Bus not found'), reassign: no('Bus not found') };

  if (b.state === 'deadhead') {
    const why = 'Deadheading to its new route';
    return { ...out, dispatch: no(why), hold: no(why), reassign: no(why), reassignTo: { r1: no(why), r2: no(why), r3: no(why) } };
  }
  out.dispatch = atTerminal(b, opts.view) ? OK : no('Only at a terminal');
  out.hold = b.holdUsedS >= limits.maxHoldPerLoopS ? no('Hold budget used this loop') : OK;

  const onRoute = obs.routes.find((r) => r.id === b.routeId)?.buses.length ?? obs.buses.filter((x) => x.routeId === b.routeId).length;
  const remaining = onRoute - (opts.pendingAway?.[b.routeId] ?? 0);
  out.reassign = remaining <= limits.minBusesPerRoute ? no(`Last bus on ${b.routeId}`) : OK;
  for (const r of ROUTES) out.reassignTo[r] = !out.reassign.ok ? out.reassign : r === b.routeId ? no(`Already on ${r}`) : OK;
  return out;
}

// ---------- train departure ----------
export interface DwellRule { min: number; max: number; def: number; step: number }
export const DWELL: DwellRule = { min: 30, max: 120, def: 45, step: 30 };

export interface DwellPlan { dwellS: number; departAt: number | null; immediate: boolean; capped: boolean }

/** dwellS for "wait `extraS` longer" (extend, default +30 s) or "depart now" (now). While dwelling it applies at this
 *  station; otherwise at the next. */
export function trainDwellFor(obs: Observation, mode: 'extend' | 'now', last: DecisionRecord | null, rule: DwellRule = DWELL, extraS = rule.step): DwellPlan {
  const clamp = (s: number) => Math.min(rule.max, Math.max(rule.min, Math.round(s)));
  const tr = obs.train;
  const immediate = tr.state === 'dwelling' || tr.state === 'holding';
  if (!immediate) {
    const want = mode === 'extend' ? rule.def + extraS : rule.min;
    return { dwellS: clamp(want), departAt: null, immediate: false, capped: want > rule.max };
  }
  const arrival = last && last.kind === 'train_at_station'
    ? last.t - (last.features['dwell_s'] ?? 0)
    : tr.departAt !== null ? tr.departAt - rule.def : obs.t;
  const current = (tr.departAt ?? arrival + rule.def) - arrival;
  const want = mode === 'extend' ? current + extraS : obs.t - arrival;
  const dwellS = clamp(want);
  return { dwellS, departAt: arrival + dwellS, immediate: true, capped: want > rule.max };
}

// ---------- pace vs the AI ----------
export interface PacePoint { t: number; j: number }

export function paceAt(samples: readonly PacePoint[], t: number): number | null {
  if (samples.length === 0) return null;
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  if (t <= first.t) return first.j;
  if (t >= last.t) return last.j;
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid]!.t <= t) lo = mid; else hi = mid;
  }
  const a = samples[lo]!;
  const b = samples[hi]!;
  return b.t === a.t ? b.j : a.j + ((b.j - a.j) * (t - a.t)) / (b.t - a.t);
}

export const MINUS = '−';

/** Passenger-hours saved against the baseline over time, for you (at your samples) and the AI (at its samples). */
export function raceSeries(you: readonly PacePoint[], ai: readonly PacePoint[], base: readonly PacePoint[]) {
  const saved = (p: PacePoint) => ({ t: p.t, v: ((paceAt(base, p.t) ?? p.j) - p.j) / 3600 });
  return { you: you.map(saved), ai: ai.map(saved) };
}

/** Positive = you are ahead (fewer passenger-hours spent so far than the AI). */
export function paceDelta(youJ: number, aiJ: number): { paxH: number; ahead: boolean; even: boolean; text: string } {
  const paxH = (aiJ - youJ) / 3600;
  const even = Math.abs(paxH) < 0.05;
  const text = even ? 'even' : `${paxH > 0 ? '+' : MINUS}${Math.abs(paxH).toFixed(1)} pax-h`;
  return { paxH, ahead: paxH > 0 && !even, even, text };
}

// ---------- verdict ----------
export interface Verdict { tone: 'win' | 'partial' | 'tie' | 'loss'; headline: string; line: string }

const TIE = 0.05; // percent

/** "A beats B by p%": p relative to the loser's J. */
function margin(winner: number, loser: number): number {
  return loser > 0 ? ((loser - winner) / loser) * 100 : 0;
}

export function verdict(you: number, ai: number, base: number): Verdict {
  const baseCmp = Math.abs(margin(Math.min(you, base), Math.max(you, base))) < TIE ? 0 : you < base ? 1 : -1;
  const aiCmp = Math.abs(margin(Math.min(you, ai), Math.max(you, ai))) < TIE ? 0 : you < ai ? 1 : -1;
  const pBase = fmtPct(baseCmp > 0 ? margin(you, base) : margin(base, you));
  const pAi = fmtPct(aiCmp > 0 ? margin(you, ai) : margin(ai, you));
  const D = ' — ';

  if (aiCmp > 0) {
    const line = baseCmp > 0 ? `You beat the baseline by ${pBase}${D}the AI by ${pAi}`
      : baseCmp === 0 ? `You matched the baseline${D}and beat the AI by ${pAi}`
      : `You beat the AI by ${pAi}${D}but the baseline beat you by ${pBase}`;
    return { tone: 'win', headline: 'You beat the AI dispatcher', line };
  }
  if (aiCmp === 0) {
    const line = baseCmp > 0 ? `You beat the baseline by ${pBase}${D}level with the AI`
      : baseCmp === 0 ? 'Same score as the AI and the baseline'
      : `Level with the AI${D}the baseline beat you both by ${pBase}`;
    return { tone: 'tie', headline: 'Dead heat with the AI', line };
  }
  if (baseCmp > 0) return { tone: 'partial', headline: 'You beat the baseline', line: `You beat the baseline by ${pBase}${D}the AI wins by ${pAi}` };
  if (baseCmp === 0) return { tone: 'loss', headline: 'The AI wins', line: `You matched the baseline${D}the AI wins by ${pAi}` };
  return { tone: 'loss', headline: 'The AI wins', line: `The AI wins by ${pAi}${D}the baseline beat you by ${pBase}` };
}

// ---------- findings: where you and the AI differ ----------
const placeKey = (p: QueuePlace) => `${p.kind}:${p.id}`;

export function findingKey(f: FailureFinding): string {
  switch (f.kind) {
    case 'service_gap': return `service_gap:${f.stopId}:${f.routeId}`;
    case 'missed_transfer': return `missed_transfer:${placeKey(f.at)}:${f.from}:${f.to}`;
    case 'bunching': return `bunching:${f.routeId}:${f.stopId}`;
    case 'overload': return `overload:${placeKey(f.at)}:${f.routeId}`;
    case 'unused_capacity': return `unused_capacity:${f.routeId}`;
    case 'long_hold': return `long_hold:${f.vehicleId}:${f.stopId}`;
  }
}

export interface FindingDiff { key: string; worse: 'you' | 'ai'; finding: FailureFinding; youS: number; aiS: number; deltaS: number }

function byKey(fs: readonly FailureFinding[]): Map<string, { sum: number; top: FailureFinding }> {
  const m = new Map<string, { sum: number; top: FailureFinding }>();
  for (const f of fs) {
    const k = findingKey(f);
    const cur = m.get(k);
    if (!cur) m.set(k, { sum: f.impactS, top: f });
    else { cur.sum += f.impactS; if (f.impactS > cur.top.impactS) cur.top = f; }
  }
  return m;
}

/** The n findings where your run and the AI's differ most (passenger-seconds), largest first. */
export function differenceFindings(you: readonly FailureFinding[], ai: readonly FailureFinding[], n = 3): FindingDiff[] {
  const a = byKey(you);
  const b = byKey(ai);
  const keys = [...new Set([...a.keys(), ...b.keys()])];
  const out: FindingDiff[] = [];
  for (const key of keys) {
    const youS = a.get(key)?.sum ?? 0;
    const aiS = b.get(key)?.sum ?? 0;
    const deltaS = youS - aiS;
    if (deltaS === 0) continue;
    const worse = deltaS > 0 ? 'you' : 'ai';
    const finding = (worse === 'you' ? a.get(key) : b.get(key))!.top;
    out.push({ key, worse, finding, youS, aiS, deltaS });
  }
  out.sort((x, y) => Math.abs(y.deltaS) - Math.abs(x.deltaS) || (x.key < y.key ? -1 : 1));
  return out.slice(0, n);
}

// ---------- formatting ----------
export const fmtPaxH = (j: number) => (j / 3600).toFixed(1);
export const fmtMin = (s: number) => (s / 60).toFixed(1);

export function fmtMMSS(s: number): string {
  const v = Math.max(0, Math.round(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
}

export function fmtPct(p: number): string {
  const a = Math.abs(p);
  const s = a >= 10 ? String(Math.round(a)) : a.toFixed(1).replace(/\.0$/, '');
  return `${s}%`;
}

/** HH:MM for `clockStart` + t seconds (wall-clock display only). */
export function localClock(clockStart: string, t: number): string {
  const [h, m] = clockStart.split(':').map((x) => Number.parseInt(x, 10));
  const mins = ((((h ?? 0) * 60 + (m ?? 0) + Math.floor(Math.max(0, t) / 60)) % 1440) + 1440) % 1440;
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

/** The sim's `clockAt` when it is available, else a local fallback. */
export function clock(clockStart: string, t: number): string {
  try { return clockAt(clockStart, t); } catch { return localClock(clockStart, t); }
}

/** The sim's `findingSentence` when available, else the finding's own text. */
export function sentence(f: FailureFinding, clockStart: string): string {
  try { return findingSentence(f, clockStart); } catch { return f.text; }
}

// ---------- misc ----------
export function cleanName(raw: string): string | null {
  const s = raw.trim().replace(/\s+/g, ' ');
  return /^[A-Za-z0-9 _-]{1,16}$/.test(s) ? s : null;
}

/** Interpolate a distance along a path; closed loops take the short way across the wrap. */
export function lerpDist(a: number, b: number, alpha: number, length: number, closed: boolean): number {
  if (!closed || length <= 0) return a + (b - a) * alpha;
  let bb = b;
  if (bb < a - length / 2) bb += length;
  else if (bb > a + length / 2) bb -= length;
  const v = a + (bb - a) * alpha;
  return ((v % length) + length) % length;
}

// ---------- plain-language status (fleet board, action cards) ----------
type Names = { stop(id: string | null | undefined): string; station(id: string | null | undefined): string };

/** One short line about what a bus is doing right now, in plain words. */
export function busStatus(b: Bus, t: number, names: Names): string {
  switch (b.state) {
    case 'moving':
      return b.nextStopId
        ? `Driving to ${names.stop(b.nextStopId)}${b.etaNextStopS !== null ? ` · ${fmtMMSS(b.etaNextStopS)}` : ''}`
        : 'On the move';
    case 'dwelling': return b.nextStopId ? `Boarding at ${names.stop(b.nextStopId)}` : 'Boarding riders';
    case 'holding': return b.holdUntil !== null ? `Holding · ${fmtMMSS(b.holdUntil - t)} left` : 'Holding';
    case 'layover':
      return b.headwayAheadS !== null && b.headwayAheadS < 3600 ? `At the terminal · last bus left ${fmtMMSS(b.headwayAheadS)} ago` : 'At the terminal';
    case 'deadhead': return `Driving empty to join ${b.routeId}`;
    case 'depot': return 'Parked in the depot';
  }
}

export interface TrainStatus { at: boolean; line: string; departInS: number | null }

export function trainStatus(o: Observation, names: Names): TrainStatus {
  const tr = o.train;
  const at = tr.state === 'dwelling' || tr.state === 'holding';
  if (at) {
    const departInS = tr.departAt !== null ? Math.max(0, tr.departAt - o.t) : null;
    return { at, departInS, line: `At ${names.station(tr.stationId)}${departInS !== null ? ` · leaves in ${fmtMMSS(departInS)}` : ''}` };
  }
  return { at, departInS: null, line: `Next ${names.station(tr.stationId)} · ${fmtMMSS(tr.etaS)}` };
}
