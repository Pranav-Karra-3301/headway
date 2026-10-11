// Owner: T3b. Observation → alert toasts, rate-limited (Play mechanics "Alerts").
// Pure and deterministic in sim time: feed it every HUD observation (4 Hz); it returns the toasts to push.
import type { Observation, TownMap } from '@headway/sim';
import type { Toast } from '../../state/store';
import { mmss, stationName, stopName, townMap } from './format';

export type AlertToast = Omit<Toast, 'id'>;

export interface AlertOptions {
  /** Warn this long before an advertised event (closing time, class change). */
  leadS: number;
  /** A stop with a queue and no departure for this long raises a service-gap alert… */
  gapAlertS: number;
  /** …if at least this many people are waiting there… */
  gapMinQueue: number;
  /** …and the same stop is not re-alerted for this long. */
  gapRepeatS: number;
  /** A train within this many seconds of a station… */
  trainEtaS: number;
  /** …carrying at least this many transfers is announced… */
  trainMinTransfers: number;
  /** …at most once per station per this long. */
  trainCooldownS: number;
  /** People left behind (since the last full-vehicle alert) before a "full" alert. */
  leftBehindMin: number;
  fullCooldownS: number;
  /** Minimum sim seconds between two non-event alerts (events always pass). */
  minGapS: number;
  /** Map used for names (default: the canonical town). */
  map: TownMap | null;
}

export const ALERT_DEFAULTS: Omit<AlertOptions, 'map'> = {
  leadS: 120,
  gapAlertS: 480, gapMinQueue: 5, gapRepeatS: 240,
  trainEtaS: 60, trainMinTransfers: 10, trainCooldownS: 240,
  leftBehindMin: 5, fullCooldownS: 150,
  minGapS: 40,
};

export interface Alerts {
  update(obs: Observation): AlertToast[];
  reset(): void;
}

interface Candidate { key: string; cooldownS: number; text: string; onFire?: () => void }

export function createAlerts(opts: Partial<AlertOptions> = {}): Alerts {
  const o: AlertOptions = { ...ALERT_DEFAULTS, map: townMap(), ...opts };
  let fired = new Set<string>();
  let cooldownUntil = new Map<string, number>();
  let lastT = -1;
  let lastAlertT = Number.NEGATIVE_INFINITY;
  let lastLeftBehind: number | null = null;
  let pendingLeftBehind = 0;

  const reset = () => {
    fired = new Set();
    cooldownUntil = new Map();
    lastT = -1;
    lastAlertT = Number.NEGATIVE_INFINITY;
    lastLeftBehind = null;
    pendingLeftBehind = 0;
  };

  const update = (obs: Observation): AlertToast[] => {
    if (obs.t < lastT) reset();
    lastT = obs.t;
    const t = obs.t;
    const out: AlertToast[] = [];
    const alert = (text: string): AlertToast => ({ kind: 'alert', text, simT: t });

    // 1. Advertised events: a lead warning and the moment itself. Never rate-limited.
    for (const ev of obs.scenario.advertised ?? []) {
      const lead = `ev:${ev.kind}:${ev.t}:lead`;
      const now = `ev:${ev.kind}:${ev.t}:now`;
      if (t >= ev.t) {
        if (!fired.has(now) && t < ev.t + 60) out.push(alert(`${ev.label} now`));
        fired.add(lead);
        fired.add(now);
      } else if (!fired.has(lead) && t >= ev.t - o.leadS) {
        fired.add(lead);
        out.push(alert(`${ev.label} in ${mmss(Math.ceil((ev.t - t) / 10) * 10)}`));
      }
    }

    // 2. Candidates, highest priority first.
    const cands: Candidate[] = [];
    const tr = obs.train;
    const transfers = Object.values(tr.transfersNext ?? {}).reduce<number>((a, b) => a + (b ?? 0), 0);
    if (tr.state === 'moving' && tr.etaS > 0 && tr.etaS <= o.trainEtaS && transfers >= o.trainMinTransfers) {
      cands.push({
        key: `train:${tr.stationId}`, cooldownS: o.trainCooldownS,
        text: `Train arriving ${stationName(tr.stationId, o.map)} with ${transfers} transfers`,
      });
    }

    const lb = obs.running.leftBehind;
    if (lastLeftBehind !== null && lb > lastLeftBehind) pendingLeftBehind += lb - lastLeftBehind;
    lastLeftBehind = lb;
    if (pendingLeftBehind >= o.leftBehindMin) {
      const full = obs.buses.find((b) => b.onboard >= b.capacity);
      const n = pendingLeftBehind;
      const onFire = () => { pendingLeftBehind = 0; };
      if (full) cands.push({ key: `full:${full.id}`, cooldownS: o.fullCooldownS, text: `Bus ${full.id} full — ${n} left behind`, onFire });
      else if (tr.onboard >= tr.capacity) cands.push({ key: 'full:train', cooldownS: o.fullCooldownS, text: `Train full — ${n} left behind`, onFire });
      else pendingLeftBehind = 0; // nobody is full any more: stale
    }

    for (const s of obs.stops) {
      if (s.queue < o.gapMinQueue) continue;
      const deps = Object.values(s.lastDepartureT ?? {}).filter((x): x is number => typeof x === 'number');
      const gap = t - (deps.length ? Math.max(...deps) : 0);
      if (gap >= o.gapAlertS) {
        cands.push({ key: `gap:${s.id}`, cooldownS: o.gapRepeatS, text: `${stopName(s.id, o.map)}: ${Math.floor(gap / 60)} min without a bus` });
      }
    }

    if (t - lastAlertT >= o.minGapS) {
      const c = cands.find((x) => (cooldownUntil.get(x.key) ?? Number.NEGATIVE_INFINITY) <= t);
      if (c) {
        cooldownUntil.set(c.key, t + c.cooldownS);
        lastAlertT = t;
        c.onFire?.();
        out.push(alert(c.text));
      }
    }
    return out;
  };

  return { update, reset };
}
