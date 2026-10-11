// Owner: T3d. Loads the Lab's data: api.fetchGenerations (/api → /data) → bundled sample fixtures, plus sealed results.
import type { Generation, Round, SplitScore } from '@headway/sim';
import { fetchGenerations } from '../../api';
import { useApp } from '../../state/store';
import { useLab } from './labStore';
import { loadSealed } from './sealed';

export interface LabData {
  generations: Generation[]; rounds: Round[];
  baseline: SplitScore | null; reference: SplitScore | null;
  source: 'live' | 'sample';
}

async function sample(): Promise<LabData> {
  const f = await import('../../fixtures');
  return { generations: f.GENERATIONS, rounds: f.ROUNDS, baseline: f.BASELINE.train, reference: f.REFERENCE.train, source: 'sample' };
}

export async function loadLabData(): Promise<LabData> {
  try {
    const g = await fetchGenerations();
    if (g.generations.length) {
      return { generations: g.generations, rounds: g.rounds, baseline: g.baseline ?? null, reference: g.reference ?? null, source: 'live' };
    }
  } catch { /* fall through to the sample */ }
  return sample();
}

/** Fetch (or re-fetch) everything and publish it to the stores. Concurrent calls share one request. */
let inflight: Promise<LabData> | null = null;
export function refreshLab(): Promise<LabData> {
  if (inflight) return inflight;
  useLab.setState((s) => ({ status: s.status === 'ready' ? 'ready' : 'loading' }));
  inflight = loadLabData()
    .catch((): LabData => ({ generations: [], rounds: [], baseline: null, reference: null, source: 'live' }))
    .then((d) => {
      useApp.getState().setLab({ generations: d.generations, rounds: d.rounds });
      useLab.setState({ status: 'ready', source: d.generations.length ? d.source : null, baseline: d.baseline, reference: d.reference });
      return d;
    })
    .finally(() => { inflight = null; });
  loadSealed().then((rows) => useLab.setState({ sealed: rows })).catch(() => useLab.setState({ sealed: [] }));
  return inflight;
}

/** First Lab visit in this page session loads the data; later visits reuse it. */
export function ensureLabData(): void {
  if (useLab.getState().status === 'idle') void refreshLab();
}
