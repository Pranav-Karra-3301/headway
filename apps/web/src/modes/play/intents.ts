// Owner: T3c. Tracks the player's intents from "issued" to "applied" (pure). The sim applies them (spec §5.6);
// this only follows along for pending badges and the results timeline, from human DecisionRecords or observed state.
import type { DecisionRecord, Intent, Observation } from '@headway/sim';
import { TRAIN_ID } from './logic';

export type IntentStatus = 'pending' | 'applied' | 'replaced' | 'expired';
export interface TrackedIntent {
  id: number; t: number; intent: Intent;
  status: IntentStatus; appliedT: number | null; result: string | null;
  /** The vehicle has been seen moving since the intent was issued (guards the observation fallback). */
  sawMoving: boolean;
}

export const vehicleOf = (i: Intent): string => (i.type === 'setTrainDeparture' ? TRAIN_ID : i.vehicleId);

export function describeIntent(i: Intent): string {
  switch (i.type) {
    case 'dispatch': return `Dispatch ${i.vehicleId}`;
    case 'hold': return `Hold ${i.vehicleId} ${i.seconds} s`;
    case 'reassign': return `Move ${i.vehicleId} to ${i.to}`;
    case 'setTrainDeparture': return `Train dwell ${i.dwellS} s`;
  }
}

export function addIntent(
  list: readonly TrackedIntent[],
  next: { id: number; t: number; intent: Intent },
  now: { applied: boolean; result?: string },
): TrackedIntent[] {
  const v = vehicleOf(next.intent);
  const out = list.map((x) =>
    x.status === 'pending' && x.intent.type === next.intent.type && vehicleOf(x.intent) === v ? { ...x, status: 'replaced' as const } : x);
  out.push({
    ...next,
    status: now.applied ? 'applied' : 'pending',
    appliedT: now.applied ? next.t : null,
    result: now.result ?? null,
    sawMoving: false,
  });
  return out;
}

const matches = (i: Intent, r: DecisionRecord) => {
  if (r.source !== 'human' || r.vehicleId !== vehicleOf(i)) return false;
  return i.type === 'setTrainDeparture' ? r.action.type === 'setTrainDeparture' : r.action.type === i.type;
};

/** Human decision records resolve the oldest matching pending intent issued at or before the record. */
export function resolveWithDecisions(list: readonly TrackedIntent[], records: readonly DecisionRecord[]): TrackedIntent[] {
  let out = list as TrackedIntent[];
  for (const r of records) {
    const idx = out.findIndex((x) => x.status === 'pending' && x.t <= r.t && matches(x.intent, r));
    if (idx < 0) continue;
    if (out === list) out = [...list];
    out[idx] = { ...out[idx]!, status: 'applied', appliedT: r.t, result: r.explanation || out[idx]!.result };
  }
  return out;
}

/** Fallback when the sim does not surface a record: infer application from the vehicle's observed state. */
export function resolveWithObservation(list: readonly TrackedIntent[], obs: Observation): TrackedIntent[] {
  let changed = false;
  const out = list.map((x) => {
    if (x.status !== 'pending' || obs.t < x.t) return x;
    const i = x.intent;
    let sawMoving = x.sawMoving;
    let applied: string | null = null;
    if (i.type === 'setTrainDeparture') {
      const tr = obs.train;
      if (tr.state === 'moving') sawMoving = true;
      else if (sawMoving && tr.state === 'dwelling' && tr.departAt !== null) applied = 'Train dwell set';
    } else {
      const b = obs.buses.find((y) => y.id === i.vehicleId);
      if (b) {
        if (b.state === 'moving') sawMoving = true;
        if (i.type === 'reassign' && (b.routeId === i.to || b.state === 'deadhead')) applied = `Moving to ${i.to}`;
        else if (i.type === 'hold' && sawMoving && b.state === 'holding' && b.holdUntil !== null) applied = 'Holding';
        else if (i.type === 'dispatch' && b.state === 'moving') applied = 'Dispatched';
      }
    }
    if (applied !== null) { changed = true; return { ...x, sawMoving, status: 'applied' as const, appliedT: obs.t, result: x.result ?? applied }; }
    if (sawMoving !== x.sawMoving) { changed = true; return { ...x, sawMoving }; }
    return x;
  });
  return changed ? out : (list as TrackedIntent[]);
}

export function expirePending(list: readonly TrackedIntent[]): TrackedIntent[] {
  return list.map((x) => (x.status === 'pending' ? { ...x, status: 'expired' as const } : x));
}

/** Small label for the vehicle's pending intent (latest wins), e.g. "H30", "→r3", "GO", "+75". */
export function badgeFor(list: readonly TrackedIntent[], vehicleId: string): string | null {
  for (let k = list.length - 1; k >= 0; k--) {
    const x = list[k]!;
    if (x.status !== 'pending' || vehicleOf(x.intent) !== vehicleId) continue;
    const i = x.intent;
    switch (i.type) {
      case 'hold': return `H${i.seconds}`;
      case 'reassign': return `→${i.to}`;
      case 'dispatch': return 'GO';
      case 'setTrainDeparture': return `${i.dwellS}s`;
    }
  }
  return null;
}
