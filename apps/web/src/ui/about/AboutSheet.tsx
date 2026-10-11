// Owner: T7. The honest explainer (presentational). Every claim here traces to the design spec
// (docs/superpowers/specs/2026-10-11-headway-design.md §1, §5–§9); tunable numbers come in through `facts`.
import type { ReactNode } from 'react';
import type { Generation } from '@headway/sim';
import { DESIGNER_MODEL, FALLBACK_MODEL, championLine, type AboutFacts, type ChampionInfo } from './facts';

export interface AboutSheetProps {
  facts: AboutFacts;
  champion: ChampionInfo;
  generations: Generation[];
  onClose(): void;
}

type Tone = 'r1' | 'r2' | 'r3' | 'accent' | 'ink';

function Section({ tone, title, children }: { tone: Tone; title: string; children: ReactNode }) {
  return (
    <section className={`hwa-sec hwa-sec--${tone}`}>
      <h3 className="hwa-h"><span className="hwa-dot" aria-hidden="true" />{title}</h3>
      {children}
    </section>
  );
}

export function AboutSheet({ facts: f, champion, generations, onClose }: AboutSheetProps) {
  const line = championLine(champion, generations);
  const seeds = f.seedsPerScenario ? `, ${f.seedsPerScenario} seeds each` : '';
  return (
    <div className="hwa-sheet" role="dialog" aria-modal="true" aria-labelledby="hwa-title" tabIndex={-1}>
      <header className="hwa-head">
        <div>
          <p className="hwa-eyebrow">About this experiment</p>
          <h2 className="hwa-title" id="hwa-title">How Headway works</h2>
        </div>
        <button type="button" className="hwa-close" aria-label="Close About" onClick={onClose}>
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div className="hwa-body">
        <p className="hwa-lead">
          Headway is a small transit-dispatch game set in a fictional, State College–inspired college town. What
          improves over time is the town&apos;s <b>dispatch policy</b>, a short rulebook, not the AI models that write it:
          the models are never retrained. Watch and Play run that rulebook right here in your browser, with no model
          calls.
        </p>
        {line && (
          <p className="hwa-status">
            <span className="hwa-live" aria-hidden="true" />
            Current champion: <b>{line}</b>
          </p>
        )}

        <figure className="hwa-loopbox">
          <figcaption>One evolution round</figcaption>
          <ol className="hwa-loop">
            <li>Champion rulebook and evidence</li>
            <li>3 designers propose</li>
            <li>Schema check, 1 repair</li>
            <li>{`${f.trainRuns} training runs`}</li>
            <li>{`${f.valRuns} hidden validation runs`}</li>
            <li>Promote or keep</li>
          </ol>
        </figure>

        <Section tone="r1" title="A town of individual riders">
          <p>
            {`4 neighborhoods, 8 stops, 3 bus routes run by ${f.buses} buses, and a two-car train on a 3-station loop. `}
            Every rider is simulated one by one with fixed rules: they plan with the published timetable, queue, board
            first-come-first-served, transfer, and may give up and walk when a wait outlasts their patience. No language
            model plays the riders.
          </p>
        </Section>

        <Section tone="r2" title="The rulebook is what evolves">
          <p>
            The dispatch policy is versioned JSON: up to 24 rules of the form “when these measured conditions hold, do
            this”. A rule can hold a bus, dispatch it, move it to another route, or set when the train leaves
            {`; a hold at a stop is capped at ${f.maxHoldS} s. `}
            When a rule fires, its explanation is the rule&apos;s own sentence filled in with the real numbers, for
            example “Holding 45 s for the train (34 s away, 14 transfers)”, never written after the fact.
          </p>
        </Section>

        <Section tone="r3" title="Who writes the rules">
          <p>
            {`Each round, three policy designers, all ${DESIGNER_MODEL} served by Luminal, read the champion's rules and `}
            an evidence digest from its training runs: metrics for the champion, the baseline and the reference, the
            costliest failures, queues and service gaps per stop, and how often each rule fired. Each designer gets a
            different focus (transfers, spacing or bus allocation) and is asked for at most 3 focused changes.
            {` If Luminal times out, rate-limits or fails, that call falls back once to ${FALLBACK_MODEL} on OpenRouter, `}
            and the proposal records which model answered. Every answer must pass the policy schema; a broken one gets
            one repair attempt.
          </p>
        </Section>

        <Section tone="accent" title="How a change survives">
          <p>{`Every valid proposal is simulated on the same ${f.trainRuns} training runs (${f.trainScenarios}${seeds}). The best one is promoted only if:`}</p>
          <ul className="hwa-list">
            <li>it cuts total passenger time J by at least 1% on training;</li>
            <li>{`it is no worse on ${f.valRuns} validation runs the designers never see;`}</li>
            <li>completion falls by at most 1 percentage point; and</li>
            <li>no stop goes longer without a bus than the champion&apos;s worst gap or 15 minutes, whichever is longer.</li>
          </ul>
          <p>
            If the best fails validation, the runner-up gets one try; otherwise the champion stays. Designers only hear
            “promoted” or “rejected: validation worse”, never the validation numbers.
          </p>
        </Section>

        <Section tone="ink" title="The score">
          <p>
            J is total passenger time: door-to-door time for everyone who got home, plus, for anyone still travelling
            {` when the run ends, their time so far and a ${f.penaltyMin}-minute penalty. `}
            Lower is better. J is always shown next to mean and p95 wait, completion, missed connections, people left
            behind, walkaways and operating effort, and each proposal&apos;s report lists what got worse next to what
            got better.
          </p>
        </Section>

        <Section tone="r1" title="A fair fight">
          <p>
            Every random draw (the crowd, traffic, train delays) is made from a seed before the run starts, so every
            controller faces the identical crowd, and the same seed with the same decisions always gives the same
            result. In Play you take over the baseline g0 on the same seed the champion and the baseline are scored on:
            doing nothing scores exactly the baseline, and you see only what the AI sees, nothing from the future.
          </p>
        </Section>

        <Section tone="r2" title="Jev, for station holds">
          <p>
            One narrow decision can be handed to Jev, TypeSafe&apos;s fast decision model, served via OpenRouter. At the
            three stops beside train stations, when a train is due soon (within 2 minutes by default), a policy that
            switches Jev on asks it: leave now, or hold for 20, 40 or 60 seconds (the default options)? Code generates
            only legal options; Jev returns a choice with probabilities. If Jev errors or misses its deadline, the rules
            decide instead. Every Jev decision is logged, so a replay never calls Jev again. What evolves here is the
            plain-language instructions Jev follows and when it is asked, not Jev itself.
          </p>
        </Section>

        <Section tone="r3" title="The sealed test">
          <p>
            Three more seeds are kept secret, outside this repository. They never appear in a prompt or in the
            evolution code. Only once optimization is done are the champion, the baseline and the reference scored on
            them, for people to read: the Lab panel that shows them is labelled “never shown to agents”.
          </p>
        </Section>

        <Section tone="ink" title="What this is not">
          <ul className="hwa-list hwa-list--not">
            <li><b>Not a real network.</b> It is a toy town with synthetic demand; gains are measured in this simulator only.</li>
            <li>
              <b>Not a strawman baseline.</b> g0 runs 2 buses per route and holds at the terminal to keep even spacing.
              The reference, ref, is a hand-written queue-responsive policy shown for comparison and never used as a
              parent.
            </li>
            <li>
              <b>Not an LLM driving buses.</b> Designers write rules between games; at run time the rules decide, with
              Jev only for station holds where a policy switches it on.
            </li>
          </ul>
        </Section>

        <footer className="hwa-foot">
          <p className="hwa-built">Built with</p>
          <ul className="hwa-chips">
            <li>TypeScript sim shared by browser, Node and Worker</li>
            <li>Three.js</li>
            <li>React</li>
            <li>Cloudflare Workers + D1</li>
            <li>{`Luminal · ${DESIGNER_MODEL}`}</li>
            <li>OpenRouter · fallback and Jev</li>
            <li>TypeSafe Jev</li>
          </ul>
          <p className="hwa-hint">Press <kbd>?</kbd> any time to open this panel, <kbd>Esc</kbd> to close it.</p>
        </footer>
      </div>
    </div>
  );
}
