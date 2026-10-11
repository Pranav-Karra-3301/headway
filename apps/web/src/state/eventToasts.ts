// Sim events → toasts (T3a): transfer made, missed connection, walkaway. Bursts are aggregated and each kind is
// rate-limited, so a stadium crowd produces a readable trickle instead of a flood.
import type { QueuePlace, SimEvent } from '@headway/sim';
import type { Toast } from './store';

type Kind = 'transfer' | 'missed' | 'walkaway';
const KIND_OF: Partial<Record<SimEvent['kind'], Kind>> = { transfer_made: 'transfer', missed_connection: 'missed', walkaway: 'walkaway' };

interface Pending { count: number; lastT: number; places: Map<string, { at: QueuePlace; n: number }> }

export interface EventToaster {
  /** Feed one snapshot's events; returns the toasts to show now. */
  ingest(events: readonly SimEvent[], nowMs: number): Array<Omit<Toast, 'id'>>;
  reset(): void;
}

function text(kind: Kind, n: number, place: string | null): string {
  const at = place ? ` at ${place}` : '';
  const most = place ? `, most at ${place}` : '';
  if (kind === 'transfer') return n === 1 ? `Transfer made${at}` : `${n} transfers made${most}`;
  if (kind === 'missed') return n === 1 ? `Missed connection${at}` : `${n} missed connections${most}`;
  return n === 1 ? `Someone gave up waiting${at} and walked` : `${n} people gave up waiting${at} and walked`;
}

export function createEventToaster(opts: { placeName: (at: QueuePlace) => string; minGapMs?: number }): EventToaster {
  const gap = opts.minGapMs ?? 5000;
  let pending = new Map<Kind, Pending>();
  let lastShown = new Map<Kind, number>();

  return {
    ingest(events, nowMs) {
      for (const e of events) {
        const kind = KIND_OF[e.kind];
        if (!kind) continue;
        let p = pending.get(kind);
        if (!p) { p = { count: 0, lastT: e.t, places: new Map() }; pending.set(kind, p); }
        p.count++;
        p.lastT = Math.max(p.lastT, e.t);
        const at = 'at' in e ? e.at : undefined;
        if (at) {
          const key = `${at.kind}:${at.id}`;
          const slot = p.places.get(key) ?? { at, n: 0 };
          slot.n++;
          p.places.set(key, slot);
        }
      }
      const out: Array<Omit<Toast, 'id'>> = [];
      for (const kind of ['missed', 'walkaway', 'transfer'] as const) {
        const p = pending.get(kind);
        if (!p || p.count === 0) continue;
        const last = lastShown.get(kind);
        if (last !== undefined && nowMs - last < gap) continue;
        let top: { at: QueuePlace; n: number } | null = null;
        for (const s of p.places.values()) if (!top || s.n > top.n) top = s;
        out.push({ kind, text: text(kind, p.count, top ? opts.placeName(top.at) : null), simT: p.lastT });
        lastShown.set(kind, nowMs);
        pending.delete(kind);
      }
      return out;
    },
    reset() { pending = new Map(); lastShown = new Map(); },
  };
}
