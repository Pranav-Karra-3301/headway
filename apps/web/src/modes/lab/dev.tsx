// Owner: T3d. Dev-only harness (not in the production build): /src/modes/lab/dev.html?state=<name> renders LabView
// over fixture data in a given state, for screenshots. States: default, g0, rejected, invalid, live, done, token, empty;
// add &light=dusk for the dusk theme.
import '../../styles/index.css';
import { createRoot } from 'react-dom/client';
import type { EvolveEvent } from '@headway/sim';
import { BASELINE, EVOLVE_EVENTS, GENERATIONS, REFERENCE, ROUNDS } from '../../fixtures';
import { applyTheme } from '../../styles/theme';
import type { LabState } from '../../state/store';
import { LabView } from './LabMode';
import { useLab } from './labStore';
import type { LabLocal } from './labStore';

const params = new URLSearchParams(location.search);
const state = params.get('state') ?? 'default';
applyTheme('a', params.get('light') === 'dusk' ? 'dusk' : 'day');
const rejected = ROUNDS.find((r) => r.championAfter === r.championBefore) ?? null;
const last = ROUNDS[ROUNDS.length - 1]!;
const invalid = last.proposals.find((p) => !p.valid) ?? null;
const mid = EVOLVE_EVENTS.findIndex((e) => e.type === 'scored');
const liveEvents: EvolveEvent[] = state === 'live' ? EVOLVE_EVENTS.slice(0, Math.max(mid + 2, 6)) : state === 'done' ? EVOLVE_EVENTS : [];

const lab: LabState = {
  generations: state === 'empty' ? [] : GENERATIONS,
  rounds: state === 'empty' ? [] : ROUNDS,
  selectedGenerationId: state === 'g0' ? 'g0' : state === 'rejected' && rejected ? rejected.championBefore : null,
  evolveEvents: liveEvents,
  evolving: state === 'live',
};
const local: LabLocal = {
  status: 'ready', source: 'sample', baseline: BASELINE.train, reference: REFERENCE.train,
  sealed: [
    { policyId: 'g0', J: BASELINE.val.J, metrics: BASELINE.val.metrics, runs: 6, simVersion: null, createdAt: null },
    { policyId: 'ref', J: REFERENCE.val.J, metrics: REFERENCE.val.metrics, runs: 6, simVersion: null, createdAt: null },
    { policyId: GENERATIONS[GENERATIONS.length - 1]!.id, J: GENERATIONS[GENERATIONS.length - 1]!.val.J, metrics: GENERATIONS[GENERATIONS.length - 1]!.val.metrics, runs: 6, simVersion: null, createdAt: null },
  ],
  focusRoundId: state === 'rejected' && rejected ? rejected.id : state === 'invalid' ? last.id : null,
  focusProposalId: state === 'invalid' && invalid ? invalid.id : null,
  tokenOpen: state === 'token',
  liveOpen: state === 'live' || state === 'done',
};
useLab.setState(local);

function Dev() {
  const tokenOpen = useLab((s) => s.tokenOpen);
  return (
    <div className="hw-app" style={{ background: 'var(--bg)' }}>
      <LabView lab={lab} local={{ ...local, tokenOpen }} />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Dev />);
