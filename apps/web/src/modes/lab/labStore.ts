// Owner: T3d. Lab-local UI state. Shared data (generations, rounds, selection, evolve events) lives in useApp().lab.
import { create } from 'zustand';
import type { SplitScore } from '@headway/sim';
import type { SealedRow } from './sealed';

export interface LabLocal {
  status: 'idle' | 'loading' | 'ready';
  /** 'live' = /api or /data; 'sample' = bundled fixtures because nothing is published yet. */
  source: 'live' | 'sample' | null;
  reference: SplitScore | null;
  baseline: SplitScore | null;
  sealed: SealedRow[] | null;
  /** A round picked on the timeline (overrides the selected generation's round). */
  focusRoundId: string | null;
  /** A proposal card picked for the diff view. */
  focusProposalId: string | null;
  tokenOpen: boolean;
  /** Show the live evolve lanes instead of the round's proposal cards. */
  liveOpen: boolean;
}

export const useLab = create<LabLocal>()(() => ({
  status: 'idle', source: null, reference: null, baseline: null, sealed: null,
  focusRoundId: null, focusProposalId: null, tokenOpen: false, liveOpen: false,
}));
