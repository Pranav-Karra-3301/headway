import { describe, expect, it } from 'vitest';
import type { QueuePlace, SimEvent } from '@headway/sim';
import { createEventToaster } from '../eventToasts';

const central: QueuePlace = { kind: 'platform', id: 'stn_central' };
const downtown: QueuePlace = { kind: 'stop', id: 'stop_downtown' };
const name = (at: QueuePlace) => (at.id === 'stn_central' ? 'Central Station' : 'Downtown');
const ev = (t: number, kind: 'transfer_made' | 'missed_connection' | 'walkaway' | 'arrive', at?: QueuePlace): SimEvent =>
  ({ t, kind, personId: t, at });

describe('event toasts', () => {
  it('turns one transfer into one toast naming the place', () => {
    const tz = createEventToaster({ placeName: name });
    const out = tz.ingest([ev(10, 'transfer_made', central)], 0);
    expect(out).toEqual([{ kind: 'transfer', text: 'Transfer made at Central Station', simT: 10 }]);
  });

  it('aggregates a burst and rate-limits per kind', () => {
    const tz = createEventToaster({ placeName: name, minGapMs: 5000 });
    expect(tz.ingest([ev(1, 'transfer_made', central)], 0)).toHaveLength(1);
    // within the gap: held back, counted
    expect(tz.ingest([ev(2, 'transfer_made', central), ev(3, 'transfer_made', downtown), ev(4, 'transfer_made', central)], 1000)).toEqual([]);
    const later = tz.ingest([], 6000);
    expect(later).toEqual([{ kind: 'transfer', text: '3 transfers made, most at Central Station', simT: 4 }]);
    expect(tz.ingest([], 20_000)).toEqual([]);
  });

  it('handles missed connections and walkaways; ignores other events', () => {
    const tz = createEventToaster({ placeName: name });
    const out = tz.ingest([ev(5, 'missed_connection', downtown), ev(6, 'walkaway', central), ev(7, 'walkaway', central), ev(8, 'arrive')], 0);
    expect(out).toContainEqual({ kind: 'missed', text: 'Missed connection at Downtown', simT: 5 });
    expect(out).toContainEqual({ kind: 'walkaway', text: '2 people gave up waiting at Central Station and walked', simT: 7 });
    expect(out).toHaveLength(2);
  });

  it('reset clears pending counts and the rate limit', () => {
    const tz = createEventToaster({ placeName: name, minGapMs: 5000 });
    tz.ingest([ev(1, 'missed_connection', downtown)], 0);
    tz.ingest([ev(2, 'missed_connection', downtown)], 100);
    tz.reset();
    expect(tz.ingest([], 10_000)).toEqual([]);
    expect(tz.ingest([ev(3, 'missed_connection', central)], 10_001)).toEqual([{ kind: 'missed', text: 'Missed connection at Central Station', simT: 3 }]);
  });
});
