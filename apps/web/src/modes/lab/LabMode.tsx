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
import { chartData, roundForGeneration } from './model';
import type { ChartStep } from './model';
import { DiffView, ErrorsView } from './components/DiffView';
import { EvolveButton } from './components/EvolveButton';
import { GenerationCard } from './components/GenerationCard';
import { JChart } from './components/JChart';
import { LiveRound } from './components/LiveRound';
import { RoundCard } from './components/RoundCard';
import { SealedCard } from './components/SealedCard';

const byNumber = <T extends { number: number }>(xs: T[]) => [...xs].sort((a, b) => a.number - b.number);

function replay(policy: Policy, id: string) {
  useApp.getState().replayPolicy(policy, `Replay ${id}`);
}

function pickStep(s: ChartStep) {
  if (s.running && useApp.getState().lab.evolveEvents.length) { useLab.setState({ liveOpen: true }); return; }
  useApp.getState().setLab({ selectedGenerationId: s.genId });
  useLab.setState({ focusRoundId: s.promoted ? null : s.roundId, focusProposalId: null, liveOpen: false });
}

function focusProposal(p: Proposal) {
  useLab.setState((s) => ({ focusProposalId: s.focusProposalId === p.id ? null : p.id }));
}

export function LabMode() {
  useEffect(() => { ensureLabData(); }, []);
  const lab = useApp((s) => s.lab);
  const local = useLab();
  return <LabView lab={lab} local={local} />;
}

/** Pure view over the shared Lab state and the Lab-local UI state (server-renderable for tests). */
export function LabView({ lab, local }: { lab: LabState; local: LabLocal }) {
  const gens = useMemo(() => byNumber(lab.generations), [lab.generations]);
  const rounds = useMemo(() => byNumber(lab.rounds), [lab.rounds]);
  const feed = useMemo(() => reduceFeed(lab.evolveEvents), [lab.evolveEvents]);
  const champion = gens[gens.length - 1] ?? null;
  const g0 = gens[0] ?? null;
  const selected = gens.find((g) => g.id === lab.selectedGenerationId) ?? champion;
  const parent = selected?.parentId ? gens.find((g) => g.id === selected.parentId) ?? null : null;

  const liveActive = lab.evolving || lab.evolveEvents.length > 0;
  const liveRoundKnown = feed.round !== null && rounds.some((r) => r.number === feed.round && r.status !== 'running');
  const chart = useMemo(() => chartData({
    generations: gens, rounds, reference: local.reference, baseline: local.baseline,
    live: liveActive && feed.round !== null && !liveRoundKnown ? { round: feed.round, scored: feed.scored } : null,
  }), [gens, rounds, local.reference, local.baseline, liveActive, feed.round, feed.scored, liveRoundKnown]);

  const focusRound: Round | null = (local.focusRoundId ? rounds.find((r) => r.id === local.focusRoundId) : undefined)
    ?? (selected ? roundForGeneration(selected, rounds) : null);
  const selectedStep = (local.focusRoundId ? chart.steps.find((s) => s.roundId === local.focusRoundId) : undefined)
    ?? chart.steps.find((s) => s.genId === selected?.id && s.promoted) ?? null;

  const emphasis = useMemo(() => {
    const m = new Map<string, Emphasis>();
    for (const r of rounds) for (const p of r.proposals) m.set(p.id, p.emphasis);
    for (const l of feed.lanes) if (l.proposalId && l.emphasis) m.set(l.proposalId, l.emphasis);
    return m;
  }, [rounds, feed.lanes]);

  const producer: Proposal | null = selected?.fromProposal
    ? rounds.flatMap((r) => r.proposals).find((p) => p.id === selected.fromProposal) ?? null : null;
  const producerRound = selected ? roundForGeneration(selected, rounds) : null;

  const fp = focusRound?.proposals.find((p) => p.id === local.focusProposalId) ?? null;
  const fpBase: Generation | null = fp && focusRound ? gens.find((g) => g.id === focusRound.championBefore) ?? null : null;
  const showLive = local.liveOpen && liveActive;

  return (
    <div className="lab" data-status={local.status}>
      <div className="lab-sheet">
        <header className="lab-head">
          <div className="lab-head__title">
            <h2 className="lab-title">Lab</h2>
            <p className="lab-lede">
              Each round, three DeepSeek designers on Luminal rewrite the town’s dispatch policy. A change survives only if it
              measurably helps on training seeds and holds up on validation seeds.
            </p>
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
            <EvolveButton evolving={lab.evolving} round={feed.round} />
          </div>
        </header>

        {gens.length === 0 ? (
          <div className="lab-card lab-empty-state">
            {local.status === 'ready'
              ? <p>No generations are published yet. Run <code>pnpm evolve --rounds 3 --publish</code> or press “Evolve next generation”.</p>
              : <p><span className="lab-spin lab-spin--ink" aria-hidden="true" /> Loading the lab…</p>}
          </div>
        ) : (
          <div className="lab-grid">
            <div className="lab-col lab-col--main">
              <section className="lab-card lab-chartcard" style={{ ['--n' as string]: 0 }}>
                <header className="lab-card__head">
                  <h3 className="lab-h3">Objective J by round<span className="lab-h3__sub">vs the g0 baseline · lower is better</span></h3>
                  <span className="lab-chip lab-chip--quiet">{gens.length} generations · {rounds.length} rounds</span>
                </header>
                <JChart data={chart} selectedStep={selectedStep?.step ?? null} onPick={pickStep}
                  emphasisOf={(id) => emphasis.get(id) ?? null} />
              </section>

              {showLive ? (
                <LiveRound feed={feed} events={lab.evolveEvents} evolving={lab.evolving} onClose={() => useLab.setState({ liveOpen: false })} />
              ) : focusRound ? (
                <RoundCard round={focusRound} generations={gens} focusProposalId={local.focusProposalId}
                  onFocus={focusProposal} onReplay={(p) => p.policy && replay(p.policy, p.id)} />
              ) : selected && selected.number > 0 ? (
                <section className="lab-card lab-note">
                  <h3 className="lab-h3">Round not published</h3>
                  <p>{selected.id} was promoted from {selected.fromProposal ?? 'a proposal'}, but its round record is not published, so the other proposals are not available.</p>
                </section>
              ) : (
                <section className="lab-card lab-note">
                  <h3 className="lab-h3">Where it starts</h3>
                  <p>
                    g0 is the hand-written baseline: two buses per route and terminal holds that keep headways even. Every
                    round, three designers each propose up to three focused rule changes to the current champion; the town
                    is simulated on 8 training runs, and the best survivor must not be worse on 4 validation runs.
                  </p>
                  <p className="lab-muted">Pick a generation or a round on the timeline to see its proposals.</p>
                </section>
              )}

              <SealedCard rows={local.sealed} championId={champion?.id ?? null} />
            </div>

            <div className="lab-col lab-col--side">
              {selected && (
                <GenerationCard gen={selected} parent={parent} g0={g0} isChampion={selected === champion}
                  proposal={producer} roundLabel={producerRound ? `Round ${producerRound.number}` : null}
                  onReplay={() => replay(selected.policy, selected.id)} />
              )}
              {fp ? (
                !fp.valid || !fp.policy
                  ? <ErrorsView title={`${fp.id} · validation errors`} errors={fp.errors} />
                  : <DiffView title={`${fp.id} vs ${fpBase?.id ?? 'champion'}`} diff={fpBase ? diffPolicies(fpBase.policy, fp.policy) : null} policy={fp.policy} />
              ) : selected ? (
                <DiffView title={parent ? `Rule diff ${parent.id} → ${selected.id}` : `Rules in ${selected.id}`}
                  diff={parent ? diffPolicies(parent.policy, selected.policy) : null} policy={selected.policy} />
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
