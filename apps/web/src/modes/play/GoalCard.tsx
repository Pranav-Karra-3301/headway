// Owner: T3c (v13: U2). The goal card shown before a Play run: three visual steps, then three tiny facts.
import { useApp } from '../../state/store';
import { clock } from './logic';
import { playScenario, start, tourDone } from './game';
import { usePlay } from './playStore';
import { Steps } from '../../ui/landing/Steps';
import { BusIcon, ClockIcon, PlayIcon, ScaleIcon, playFacts } from './ui';

export function GoalCard() {
  const simKind = useApp((s) => s.simKind);
  const ai = usePlay((s) => s.ai);
  const scenario = playScenario();
  const facts = playFacts(scenario.scenarioId);
  const closing = clock(facts.clockStart, facts.closingT);
  const seen = tourDone();

  return (
    <div className="pl-modal" role="dialog" aria-modal="true" aria-labelledby="pl-goal-title">
      <div className="pl-goal hw-card">
        <div className="pl-goal__eyebrow">
          <span className="hw-label">Play · {facts.name} · tonight {facts.clockStart}</span>
          <span className="pl-seed">Tonight&rsquo;s game crowd</span>
        </div>
        <h1 id="pl-goal-title" className="pl-goal__title">
          Get the crowd home.
          <span>Beat the AI.</span>
        </h1>

        <Steps className="pl-steps" />

        <div className="pl-chips">
          <span className="pl-chip" title={`${facts.crowd.toLocaleString('en-US')} people head home`}>
            <ClockIcon /><span className="hw-num">{closing}</span>
          </span>
          <span className="pl-chip" title="2 per route, plus 1 train on the rail loop"><BusIcon /><span className="hw-num">× 6</span></span>
          <span className="pl-chip" title="Do nothing and you score the baseline"><ScaleIcon />Same crowd as the AI</span>
        </div>

        <div className="pl-goal__actions">
          <span className="pl-goal__status" data-state={ai.status}>
            {ai.status === 'done' ? 'AI score ready'
              : ai.status === 'error' ? 'AI score unavailable'
              : 'AI is playing this crowd…'}
            {simKind === 'stub' ? ' (preview sim)' : ''}
          </span>
          {seen && <button type="button" className="hw-btn hw-btn--ghost" onClick={() => start({ tour: true })}>Show me how</button>}
          <button type="button" className="hw-btn hw-btn--primary pl-start" autoFocus onClick={() => start()}>
            <PlayIcon /> Start dispatching
          </button>
        </div>
      </div>
    </div>
  );
}
