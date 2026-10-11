// Owner: T3d. Lab mode (spec §10): generation timeline + J_train/J_val chart (g0 and ref lines), per-round proposal
// cards, rule-level policy diff, "Replay on stadium exit", "Evolve next generation" (token → live EvolveEvent feed),
// and the sealed-test panel. Mounted by App in .hw-app; positions itself under the top bar.
import './lab.css';
import { useEffect, useMemo } from 'react';
import type { Emphasis, Generation, Policy, Proposal, Round } from '@headway/sim';
import { useApp } from '../../state/store';
import type { LabState } from '../../state/store';
import { ensureLabData } from './data';
import { diffPolicies } from './diff';
import { reduceFeed } from './feed';
import { useLab } from './labStore';
import type { LabLocal } from './labStore';
import { chartData } from './model';
import type { ChartStep } from './model';
import { DiffView, ErrorsView } from './components/DiffView';
import { EvolveButton } from './components/EvolveButton';
import { ChampionCard } from './components/ChampionCard';
import { JChart } from './components/JChart';
import { LiveRound } from './components/LiveRound';
import { RoundTimeline } from './components/RoundTimeline';
import { SealedCard } from './components/SealedCard';

const byNumber = <T extends { number: number }>(xs: T[]) => [...xs].sort((a, b) => a.number - b.number);

function replay(policy: Policy, id: string) {
  useApp.getState().replayPolicy(policy, `Replay ${id}`);
}

function pickStep(s: ChartStep) {
  if (s.running && useApp.getState().lab.evolveEvents.length) { useLab.setState({ liveOpen: true }); return; }
  useApp.getState().setLab({ selectedGenerationId: s.genId });
  useLab.setState({ focusRoundId: s.roundId, focusProposalId: null, liveOpen: false });
}

function toggleRound(r: Round) {
  useLab.setState((s) => ({ focusRoundId: s.focusRoundId === r.id ? null : r.id, focusProposalId: null }));
}

function focusProposal(p: Proposal) {
  useLab.setState((s) => ({ focusProposalId: s.focusProposalId === p.id ? null : p.id }));
}

function pickGeneration(g: Generation) {
  useApp.getState().setLab({ selectedGenerationId: g.id });
  useLab.setState({ focusRoundId: null, focusProposalId: null, liveOpen: false });
}

/** Evolving needs an admin token, so the button only appears with `?admin=1`. */
const isAdmin = () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('admin') === '1';

export function LabMode() {
  useEffect(() => { ensureLabData(); }, []);
  const lab = useApp((s) => s.lab);
  const local = useLab();
  const admin = useMemo(isAdmin, []);
  return <LabView lab={lab} local={local} admin={admin} />;
}

/** Pure view over the shared Lab state and the Lab-local UI state (server-renderable for tests). */
export function LabView({ lab, local, admin = false }: { lab: LabState; local: LabLocal; admin?: boolean }) {
  const gens = useMemo(() => byNumber(lab.generations), [lab.generations]);
  const rounds = useMemo(() => byNumber(lab.rounds), [lab.rounds]);
  const feed = useMemo(() => reduceFeed(lab.evolveEvents), [lab.evolveEvents]);
  const champion = gens[gens.length - 1] ?? null;
    const selected = gens.find((g) => g.id === lab.selectedGenerationId) ?? champion;
  const parent = selected?.parentId ? gens.find((g) => g.id === selected.parentId) ?? null : null;

  const liveActive = lab.evolving || lab.evolveEvents.length > 0;
  const liveRoundKnown = feed.round !== null && rounds.some((r) => r.number === feed.round && r.status !== 'running');
  const chart = useMemo(() => chartData({
    generations: gens, rounds, reference: local.reference, baseline: local.baseline,
    live: liveActive && feed.round !== null && !liveRoundKnown ? { round: feed.round, scored: feed.scored } : null,
  }), [gens, rounds, local.reference, local.baseline, liveActive, feed.round, feed.scored, liveRoundKnown]);

  const openRound: Round | null = local.focusRoundId ? rounds.find((r) => r.id === local.focusRoundId) ?? null : null;
  const selectedStep = (local.focusRoundId ? chart.steps.find((s) => s.roundId === local.focusRoundId) : undefined)
    ?? chart.steps.find((s) => s.genId === selected?.id && s.promoted) ?? null;

  const emphasis = useMemo(() => {
    const m = new Map<string, Emphasis>();
    for (const r of rounds) for (const p of r.proposals) m.set(p.id, p.emphasis);
    for (const l of feed.lanes) if (l.proposalId && l.emphasis) m.set(l.proposalId, l.emphasis);
    return m;
  }, [rounds, feed.lanes]);

  const fp = openRound?.proposals.find((p) => p.id === local.focusProposalId) ?? null;
  const fpBase: Generation | null = fp && openRound ? gens.find((g) => g.id === openRound.championBefore) ?? null : null;
  const showLive = local.liveOpen && liveActive;

  return (
    <div className="lab" data-status={local.status}>
      <div className="lab-sheet">
        <header className="lab-head">
          <div className="lab-head__title">
            <h2 className="lab-title">Lab</h2>
          </div>
          <div className="lab-head__right">
            {local.source === 'sample' && (
              <span className="lab-chip lab-chip--sample" title="No evolution rounds are published yet; showing bundled sample data">sample data</span>
            )}
            {liveActive && !showLive && (
              <button type="button" className="lab-btn lab-btn--ghost lab-btn--sm" onClick={() => useLab.setState({ liveOpen: true })}>
                Live round{feed.round !== null ? ` ${feed.round}` : ''}
              </button>
            )}
            {admin && <EvolveButton evolving={lab.evolving} round={feed.round} />}
          </div>
        </header>

        {gens.length === 0 ? (
          <div className="lab-card lab-empty-state">
            {local.status === 'ready'
              ? <p>No generations are published yet.</p>
              : <p><span className="lab-spin lab-spin--ink" aria-hidden="true" /> Loading the lab…</p>}
          </div>
        ) : (
          <div className="lab-stack">
            {champion && (
              <ChampionCard gen={champion} gens={gens} refPct={chart.ref} selectedId={lab.selectedGenerationId}
                onPick={pickGeneration} onReplay={() => replay(champion.policy, champion.id)} />
            )}

            <section className="lab-card lab-chartcard">
              <header className="lab-card__head">
                <h3 className="lab-h3">Total passenger time by round<span className="lab-h3__sub">lower is better</span></h3>
              </header>
              <JChart data={chart} selectedStep={selectedStep?.step ?? null} onPick={pickStep}
                emphasisOf={(id) => emphasis.get(id) ?? null} />
            </section>

            {showLive && (
              <LiveRound feed={feed} events={lab.evolveEvents} evolving={lab.evolving} onClose={() => useLab.setState({ liveOpen: false })} />
            )}

            <details className="lab-card lab-more" open={!!local.focusRoundId || !!local.focusProposalId || !!lab.selectedGenerationId || undefined}>
              <summary className="lab-more__sum">Every round &amp; rule change<span className="lab-h3__sub">{rounds.length} rounds</span></summary>
              <RoundTimeline rounds={rounds} generations={gens} openRoundId={local.focusRoundId} focusProposalId={local.focusProposalId}
                onToggle={toggleRound} onFocus={focusProposal} onReplay={(p) => p.policy && replay(p.policy, p.id)} />

              {fp ? (
                !fp.valid || !fp.policy
                  ? <ErrorsView title={`${fp.id} · validation errors`} errors={fp.errors} />
                  : <DiffView title={`Rule diff ${fpBase?.id ?? 'champion'} → ${fp.id}`} diff={fpBase ? diffPolicies(fpBase.policy, fp.policy) : null} policy={fp.policy} />
              ) : selected ? (
                <DiffView title={parent ? `Rule diff ${parent.id} → ${selected.id}` : `Rules in ${selected.id}`}
                  diff={parent ? diffPolicies(parent.policy, selected.policy) : null} policy={selected.policy} />
              ) : null}
            </details>

            <SealedCard rows={local.sealed} championId={champion?.id ?? null} />
          </div>
        )}
      </div>
    </div>
  );
}
