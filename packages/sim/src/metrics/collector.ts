// Owner: T1c. Metrics collector: counting rules (spec §5.4), the objective J (§7), per-stop stats and ranked failure
// findings (§4 FailureFinding, §8.4). The engine (T1a) feeds it through the frozen `Collector` seam (internal.ts).
//
// Definitions
// - J = Σ completed (arriveT − spawnT) + Σ unfinished ((tEnd − spawnT) + unfinishedPenaltyS). Unfinished = the
//   engine's list ∪ everyone spawned here who never arrived.
// - A wait is one queue stay: queueJoin → board (the engine's waitedS) | walkaway | still waiting at tEnd. Mean, p95
//   (nearest rank on the sorted waits) and max cover every wait, so stranded riders are not hidden.
// - Queue sizes are tracked exactly from joins and leaves (a rider counts once per place, and under every mode they
//   accept for per-mode counts); `queueSample` can only raise the peaks.
// - Service gaps per (stop, route) are the intervals between departures, including [0, first] and [last, tEnd].
// - busDistanceU is all bus distance (deadhead included); deadheadDistanceU is the deadhead part.
// - `running()` counts ongoing waits and journeys up to the latest tick the collector has seen.
// - `finalize` is pure: it can be called repeatedly (and mid-run) without changing the collector.
import type {
  FailureFinding, Metrics, QueuePlace, RouteId, RunResult, RunningMetrics, SimEvent, StopId, StopStats,
} from '../contracts';
import type { Collector, CollectorInit, Mode } from '../internal';
import { canonicalHash } from './hash';
import { sentenceFor } from './sentences';

const GAP_FINDING_S = 600; // service_gap: no departure for longer than this
const LONG_HOLD_S = 30; // long_hold: holds at least this long, with riders aboard
const UNUSED_LOAD = 0.3; // unused_capacity: mean departure load (spawning window) below this …
const UNUSED_QUEUE = 40; // … while another route's queue at some stop peaked above this
const ROUTE_IDS: RouteId[] = ['r1', 'r2', 'r3'];
const KIND_ORDER: Array<FailureFinding['kind']> = [
  'service_gap', 'missed_transfer', 'bunching', 'overload', 'unused_capacity', 'long_hold',
];

const placeKey = (p: QueuePlace): string => `${p.kind}:${p.id}`;
const copyPlace = (p: QueuePlace): QueuePlace => (p.kind === 'stop' ? { kind: 'stop', id: p.id } : { kind: 'platform', id: p.id });
const isRoute = (m: Mode): m is RouteId => m !== 'train';
const round2 = (x: number): number => Math.round(x * 100) / 100;
const round3 = (x: number): number => Math.round(x * 1000) / 1000;

/** One queue stay. */
interface Episode {
  place: string; at: QueuePlace; accepts: Mode[]; joinT: number;
  leaveT: number | null; // null while still waiting
  waitS: number; // once left: the wait (the engine's waitedS when boarding)
  missed: string | null; // missed_transfer group key
  lb: string | null; // overload group key (place|mode) of the first left-behind during this stay
  lbT: number;
}
interface Pax { spawnT: number; state: 'walking' | 'waiting' | 'riding' | 'arrived'; ep: Episode | null; lastVehicle: string | null; lbPlaces: string[] | null }
interface Dep { t: number; mode: Mode; vehicleId: string }
interface Hold { place: string; at: QueuePlace; vehicleId: string; t: number; holdS: number; onboard: number; gained: number }
interface Bunch { stopId: StopId; h: number; target: number }
interface MissedGroup { at: QueuePlace; from: Mode; to: Mode; count: number; first: number; last: number }
interface LbGroup { at: QueuePlace; mode: Mode; count: number }
interface Load { busy: number; busyN: number; all: number; allN: number }

export function createCollector(init: CollectorInit): Collector {
  const { map, scenario, cfg } = init;
  const windowS = cfg.objective.missedWindowS;
  const penaltyS = cfg.objective.unfinishedPenaltyS;
  const bunchingFraction = cfg.objective.bunchingFraction;

  const pax = new Map<number, Pax>();
  const episodes: Episode[] = [];
  const depsAt = new Map<string, Dep[]>(); // place → departures in call (time) order
  const lastDep = new Map<string, Dep>(); // place|mode → latest departure
  const qNow = new Map<string, number>(); // place → riders waiting now
  const qPeak = new Map<string, number>(); // place → peak (tracked, or the largest sampled per-mode count)
  const qmNow = new Map<string, number>(); // place|mode → riders waiting now who accept mode
  const qmPeak = new Map<string, number>(); // place|mode → peak (tracked or sampled)
  const boards = new Map<string, number>(); // place|mode → boardings
  const loads = new Map<RouteId, Load>();
  const bunches = new Map<RouteId, Bunch[]>();
  const missedGroups = new Map<string, MissedGroup>();
  const lbGroups = new Map<string, LbGroup>();
  const holds: Hold[] = [];
  const activeHold = new Map<string, Hold>(); // vehicle → its latest hold, until the vehicle departs
  const trainIds = new Set<string>();
  const ruleFires = new Map<string, number>();

  let spawned = 0, completed = 0, waitingNow = 0, ridingNow = 0;
  let missedN = 0, leftBehindN = 0, walkaways = 0, transfers = 0;
  let journeySum = 0; // Σ (arriveT − spawnT) over completed
  let openSpawnSum = 0; // Σ spawnT over riders not yet arrived
  let doneWaitSum = 0, doneWaitN = 0; // finished waits
  let openJoinSum = 0; // Σ joinT over current waits
  let busDist = 0, deadDist = 0, holdS = 0, trainDwellS = 0;
  let tNow = 0; // latest tick seen

  const see = (t: number): void => {
    if (t > tNow) tNow = t;
  };
  const inc = (m: Map<string, number>, k: string, d = 1): number => {
    const v = (m.get(k) ?? 0) + d;
    m.set(k, v);
    return v;
  };
  const raise = (m: Map<string, number>, k: string, v: number): void => {
    if (v > (m.get(k) ?? 0)) m.set(k, v);
  };

  function paxOf(pid: number, t: number): Pax {
    let p = pax.get(pid);
    if (!p) {
      p = { spawnT: t, state: 'walking', ep: null, lastVehicle: null, lbPlaces: null };
      pax.set(pid, p);
      spawned++;
      openSpawnSum += t;
    }
    return p;
  }
  function setState(p: Pax, s: Pax['state']): void {
    if (p.state === 'riding') ridingNow--;
    if (s === 'riding') ridingNow++;
    p.state = s;
  }
  /** Ends the rider's current queue stay (if any). */
  function leave(p: Pax, t: number, waitS: number): void {
    const ep = p.ep;
    if (!ep) return;
    ep.leaveT = t;
    ep.waitS = waitS;
    inc(qNow, ep.place, -1);
    for (const m of ep.accepts) inc(qmNow, `${ep.place}|${m}`, -1);
    waitingNow--;
    openJoinSum -= ep.joinT;
    doneWaitSum += waitS;
    doneWaitN++;
    p.ep = null;
  }

  function finalize(
    tEnd: number,
    unfinished: Array<{ pid: number; spawnT: number }>,
    meta: Parameters<Collector['finalize']>[2],
  ): RunResult {
    // ---- passengers and J
    let J = journeySum;
    let nSpawned = spawned;
    let nUnfinished = 0;
    for (const p of pax.values()) {
      if (p.state === 'arrived') continue;
      J += tEnd - p.spawnT + penaltyS;
      nUnfinished++;
    }
    const extra = new Set<number>();
    for (const u of unfinished) {
      if (pax.has(u.pid) || extra.has(u.pid)) continue;
      extra.add(u.pid);
      J += tEnd - u.spawnT + penaltyS;
      nUnfinished++;
      nSpawned++;
    }

    // ---- waits (stays still open run to tEnd)
    const waitOf = (ep: Episode): number => (ep.leaveT === null ? Math.max(0, tEnd - ep.joinT) : ep.waitS);
    const leaveOf = (ep: Episode): number => ep.leaveT ?? tEnd;
    const waits = episodes.map(waitOf).sort((a, b) => a - b);
    const waitSum = waits.reduce((a, w) => a + w, 0);
    const metrics: Metrics = {
      J, spawned: nSpawned, completed, unfinished: nUnfinished,
      completionPct: nSpawned > 0 ? round2((100 * completed) / nSpawned) : 0,
      meanJourneyS: completed > 0 ? round2(journeySum / completed) : 0,
      meanWaitS: waits.length > 0 ? round2(waitSum / waits.length) : 0,
      p95WaitS: waits.length > 0 ? waits[Math.ceil(0.95 * waits.length) - 1]! : 0,
      maxWaitS: waits.length > 0 ? waits[waits.length - 1]! : 0,
      transfersMade: transfers, missedConnections: missedN, leftBehind: leftBehindN, walkaways,
      effort: { busDistanceU: round2(busDist), deadheadDistanceU: round2(deadDist), holdS, trainDwellS },
    };

    const found: Array<{ f: FailureFinding; key: string }> = [];
    const push = (f: FailureFinding, key: string): void => {
      found.push({ f, key });
    };
    const epsAt = new Map<string, Episode[]>();
    const missedImpact = new Map<string, number>();
    const lbImpact = new Map<string, number>();
    for (const ep of episodes) {
      const l = epsAt.get(ep.place);
      if (l) l.push(ep);
      else epsAt.set(ep.place, [ep]);
      if (ep.missed) inc(missedImpact, ep.missed, waitOf(ep));
      if (ep.lb) inc(lbImpact, ep.lb, Math.max(0, leaveOf(ep) - ep.lbT));
    }

    // ---- per-stop stats and service gaps
    const stops: StopStats[] = [];
    for (const s of map.stops) {
      const place = `stop:${s.id}`;
      const eps = epsAt.get(place) ?? [];
      const deps = (depsAt.get(place) ?? []).filter((d) => d.t <= tEnd);
      const routes = [...new Set<RouteId>([...s.servedRoutes, ...deps.map((d) => d.mode).filter(isRoute)])].sort();
      const maxGapS: Partial<Record<RouteId, number>> = {};
      for (const r of routes) {
        let max = 0;
        const gap = (from: number, to: number): void => {
          const gapS = to - from;
          if (gapS > max) max = gapS;
          if (gapS <= GAP_FINDING_S) return;
          let affected = 0;
          let impact = 0;
          for (const ep of eps) {
            if (!ep.accepts.includes(r)) continue;
            const overlap = Math.min(leaveOf(ep), to) - Math.max(ep.joinT, from);
            if (overlap > 0) {
              affected++;
              impact += overlap;
            }
          }
          if (affected > 0) {
            push({ kind: 'service_gap', impactS: Math.round(impact), text: '', stopId: s.id, routeId: r, gapS, fromT: from, toT: to, affected },
              `${s.id}|${r}|${String(from).padStart(8, '0')}`);
          }
        };
        let prev = 0;
        for (const t of deps.filter((d) => d.mode === r).map((d) => d.t).sort((a, b) => a - b)) {
          gap(prev, t);
          prev = t;
        }
        gap(prev, tEnd);
        maxGapS[r] = max;
      }
      const w = eps.map(waitOf);
      stops.push({
        id: s.id, maxQueue: qPeak.get(place) ?? 0,
        meanWaitS: w.length > 0 ? round2(w.reduce((a, x) => a + x, 0) / w.length) : 0, maxGapS,
      });
    }

    // ---- missed transfers (by place, from, to)
    for (const [key, g] of missedGroups) {
      push({ kind: 'missed_transfer', impactS: Math.round(missedImpact.get(key) ?? 0), text: '', at: copyPlace(g.at), from: g.from, to: g.to, count: g.count, window: [g.first, g.last] }, key);
    }

    // ---- bunching (one finding per route; impact ≈ extra waiting in the gap a bunched pair leaves behind)
    for (const r of [...bunches.keys()].sort()) {
      const evs = bunches.get(r)!;
      const order = map.routes.find((x) => x.id === r)?.stops ?? [];
      const rank = (sid: StopId): number => (order.includes(sid) ? order.indexOf(sid) : order.length);
      const perStop = new Map<StopId, number>();
      let minH = Infinity;
      let impact = 0;
      for (const e of evs) {
        perStop.set(e.stopId, (perStop.get(e.stopId) ?? 0) + 1);
        if (e.h < minH) minH = e.h;
        const rate = (boards.get(`stop:${e.stopId}|${r}`) ?? 0) / Math.max(1, tEnd); // boardings per second here
        impact += (rate * (2 * e.target - e.h) * Math.max(0, e.target - e.h)) / 2;
      }
      let stopId = evs[0]!.stopId;
      let most = 0;
      for (const [sid, n] of perStop) {
        if (n > most || (n === most && rank(sid) < rank(stopId))) {
          most = n;
          stopId = sid;
        }
      }
      push({ kind: 'bunching', impactS: Math.round(impact), text: '', routeId: r, stopId, events: evs.length, minHeadwayS: Math.round(minH) }, r);
    }

    // ---- overload (left behind, by place and mode; impact = extra wait after the first refusal)
    for (const [key, g] of lbGroups) {
      push({ kind: 'overload', impactS: Math.round(lbImpact.get(key) ?? 0), text: '', at: copyPlace(g.at), routeId: g.mode, leftBehind: g.count, peakQueue: qmPeak.get(key) ?? 0 }, key);
    }

    // ---- unused capacity (impact ≈ riders the spare seats could take × half the busy route's headway)
    for (const r of [...loads.keys()].sort()) {
      const L = loads.get(r)!;
      const meanLoad = L.busyN > 0 ? L.busy / L.busyN : L.all / L.allN;
      if (!(meanLoad < UNUSED_LOAD)) continue;
      let best: { stopId: StopId; route: RouteId; queue: number } | null = null;
      for (const s of map.stops) {
        for (const other of ROUTE_IDS) {
          if (other === r) continue;
          const q = qmPeak.get(`stop:${s.id}|${other}`) ?? 0;
          if (q > UNUSED_QUEUE && (!best || q > best.queue)) best = { stopId: s.id, route: other, queue: q };
        }
      }
      if (!best) continue;
      const spare = cfg.bus.capacity * (1 - meanLoad);
      push({
        kind: 'unused_capacity', impactS: Math.round((Math.min(best.queue, spare) * init.targetHeadwayS(best.route)) / 2), text: '',
        routeId: r, meanLoad: round3(meanLoad), elsewhere: { stopId: best.stopId, queue: best.queue },
      }, r);
    }

    // ---- long holds (impact = riders aboard × hold)
    for (const h of holds) {
      const at = h.at;
      if (h.holdS < LONG_HOLD_S || h.onboard <= 0 || at.kind !== 'stop') continue;
      push({ kind: 'long_hold', impactS: Math.round(h.holdS * h.onboard), text: '', vehicleId: h.vehicleId, stopId: at.id, holdS: h.holdS, delayedOnboard: h.onboard, transfersGained: h.gained },
        `${h.vehicleId}|${String(h.t).padStart(8, '0')}`);
    }

    found.sort((a, b) =>
      b.f.impactS - a.f.impactS || KIND_ORDER.indexOf(a.f.kind) - KIND_ORDER.indexOf(b.f.kind) ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const findings: FailureFinding[] = found.map(({ f }) => ({ ...f, text: sentenceFor(f, scenario.clockStart, map) }));

    const fires: Record<string, number> = {};
    for (const k of [...ruleFires.keys()].sort()) fires[k] = ruleFires.get(k)!;
    return {
      simVersion: meta.simVersion, mapVersion: meta.mapVersion, scenarioId: meta.scenarioId, seed: meta.seed,
      controller: { ...meta.controller }, metrics, stops, findings, ruleFires: fires,
      hash: canonicalHash({ metrics, stops, findings }),
    };
  }

  return {
    spawn(pid, t) {
      see(t);
      paxOf(pid, t);
    },

    queueJoin(pid, at, accepts, transferFrom, t) {
      see(t);
      const p = paxOf(pid, t);
      if (p.state === 'arrived') return null;
      if (p.ep) leave(p, t, t - p.ep.joinT); // re-queued without leaving: close the previous stay
      setState(p, 'waiting');
      const place = placeKey(at);
      const ep: Episode = {
        place, at: copyPlace(at), accepts: [...new Set(accepts)], joinT: t, leaveT: null, waitS: 0, missed: null, lb: null, lbT: 0,
      };
      episodes.push(ep);
      p.ep = ep;
      raise(qPeak, place, inc(qNow, place));
      for (const m of ep.accepts) {
        const k = `${place}|${m}`;
        raise(qmPeak, k, inc(qmNow, k));
      }
      waitingNow++;
      openJoinSum += t;
      if (transferFrom === null) return null;
      // Missed connection: a vehicle of an accepted mode left here < missedWindowS ago (not the one just left).
      const deps = depsAt.get(place) ?? [];
      for (let i = deps.length - 1; i >= 0; i--) {
        const d = deps[i]!;
        if (t - d.t >= windowS) break;
        if (d.t > t || d.vehicleId === p.lastVehicle || !ep.accepts.includes(d.mode)) continue;
        missedN++;
        const key = `${place}|${transferFrom}|${d.mode}`;
        const g = missedGroups.get(key);
        if (g) {
          g.count++;
          g.first = Math.min(g.first, t);
          g.last = Math.max(g.last, t);
        } else {
          missedGroups.set(key, { at: copyPlace(at), from: transferFrom, to: d.mode, count: 1, first: t, last: t });
        }
        ep.missed = key;
        const ev: SimEvent = { t, kind: 'missed_connection', personId: pid, at: copyPlace(at) };
        return ev;
      }
      return null;
    },

    board(pid, vehicleId, mode, at, t, waitedS, wasTransfer) {
      see(t);
      const p = paxOf(pid, t);
      const place = placeKey(at);
      if (p.ep) {
        leave(p, t, waitedS);
      } else {
        // boarded without a recorded queue join: still one wait
        episodes.push({ place, at: copyPlace(at), accepts: [mode], joinT: t - waitedS, leaveT: t, waitS: waitedS, missed: null, lb: null, lbT: 0 });
        doneWaitSum += waitedS;
        doneWaitN++;
      }
      setState(p, 'riding');
      inc(boards, `${place}|${mode}`);
      if (!wasTransfer) return null;
      transfers++;
      const h = activeHold.get(vehicleId);
      if (h && h.place === place && t >= h.t && t <= h.t + h.holdS) h.gained++;
      const ev: SimEvent = { t, kind: 'transfer_made', personId: pid, at: copyPlace(at) };
      return ev;
    },

    leftBehind(pid, at, mode, t) {
      see(t);
      const p = paxOf(pid, t);
      const place = placeKey(at);
      if (p.lbPlaces?.includes(place)) return null;
      (p.lbPlaces ??= []).push(place);
      leftBehindN++;
      const key = `${place}|${mode}`;
      const g = lbGroups.get(key);
      if (g) g.count++;
      else lbGroups.set(key, { at: copyPlace(at), mode, count: 1 });
      if (p.ep && p.ep.place === place && p.ep.lb === null) {
        p.ep.lb = key;
        p.ep.lbT = t;
      }
      const ev: SimEvent = { t, kind: 'left_behind', personId: pid, at: copyPlace(at) };
      return ev;
    },

    alight(pid, vehicleId, _at, t) {
      see(t);
      const p = paxOf(pid, t);
      if (p.state === 'arrived') return;
      setState(p, 'walking');
      p.lastVehicle = vehicleId;
    },

    walkaway(pid, _at, t) {
      see(t);
      const p = paxOf(pid, t);
      walkaways++;
      if (p.ep) leave(p, t, t - p.ep.joinT);
      if (p.state !== 'arrived') setState(p, 'walking');
    },

    arrive(pid, t) {
      see(t);
      const p = paxOf(pid, t);
      if (p.state === 'arrived') return;
      if (p.ep) leave(p, t, t - p.ep.joinT);
      setState(p, 'arrived');
      completed++;
      journeySum += t - p.spawnT;
      openSpawnSum -= p.spawnT;
    },

    departure(vehicleId, mode, at, t, onboard, capacity) {
      see(t);
      const place = placeKey(at);
      const h = activeHold.get(vehicleId);
      if (h) {
        const end = h.t + h.holdS;
        if (h.place === place && t < end) { // dispatched before the hold ran out
          const cut = end - Math.max(t, h.t);
          h.holdS -= cut;
          holdS -= cut;
        }
        activeHold.delete(vehicleId);
      }
      if (mode === 'train') trainIds.add(vehicleId);
      const dep: Dep = { t, mode, vehicleId };
      const list = depsAt.get(place);
      if (list) list.push(dep);
      else depsAt.set(place, [dep]);
      const lk = `${place}|${mode}`;
      const prev = lastDep.get(lk);
      lastDep.set(lk, dep);
      if (!isRoute(mode) || at.kind !== 'stop') return;
      if (prev && prev.vehicleId !== vehicleId) {
        const target = init.targetHeadwayS(mode);
        const headway = t - prev.t;
        if (target > 0 && headway < bunchingFraction * target) {
          const ev: Bunch = { stopId: at.id, h: headway, target };
          const b = bunches.get(mode);
          if (b) b.push(ev);
          else bunches.set(mode, [ev]);
        }
      }
      if (capacity > 0) {
        let L = loads.get(mode);
        if (!L) loads.set(mode, (L = { busy: 0, busyN: 0, all: 0, allN: 0 }));
        const f = onboard / capacity;
        L.all += f;
        L.allN++;
        if (t <= scenario.durationS) {
          L.busy += f;
          L.busyN++;
        }
      }
    },

    hold(vehicleId, at, seconds, onboard, _transfersExpected, t) {
      see(t);
      if (!(seconds > 0)) return;
      const place = placeKey(at);
      const cur = activeHold.get(vehicleId);
      if (cur && cur.place === place && t <= cur.t + cur.holdS) {
        // re-raised at (or overridden before) the end of a hold here: one continuous hold ending at t + seconds
        holdS += seconds - (cur.t + cur.holdS - t);
        cur.holdS = t + seconds - cur.t;
        cur.onboard = Math.max(cur.onboard, onboard);
        return;
      }
      holdS += seconds;
      const h: Hold = { place, at: copyPlace(at), vehicleId, t, holdS: seconds, onboard, gained: 0 };
      holds.push(h);
      activeHold.set(vehicleId, h);
    },

    decision(rec) {
      see(rec.t);
      inc(ruleFires, rec.ruleId);
    },

    distance(vehicleId, du, deadhead) {
      if (trainIds.has(vehicleId) || vehicleId.startsWith('t')) return; // the train is not bus effort
      busDist += du;
      if (deadhead) deadDist += du;
    },

    trainDwell(seconds) {
      trainDwellS += seconds;
    },

    queueSample(t, at, byMode) {
      see(t);
      const place = placeKey(at);
      for (const [m, n] of Object.entries(byMode)) {
        if (typeof n !== 'number') continue;
        raise(qmPeak, `${place}|${m}`, n);
        raise(qPeak, place, n);
      }
    },

    running(): RunningMetrics {
      const n = doneWaitN + waitingNow;
      const openWait = waitingNow * tNow - openJoinSum;
      return {
        spawned, completed, waitingNow, ridingNow,
        meanWaitS: n > 0 ? round2((doneWaitSum + openWait) / n) : 0,
        missedConnections: missedN, leftBehind: leftBehindN,
        jSoFar: journeySum + (spawned - completed) * tNow - openSpawnSum,
      };
    },

    finalize,
  };
}
