// Owner: T7. The title card's content (presentational; Landing.tsx owns visibility, keys and motion).
import type { CSSProperties, ReactNode } from 'react';
import type { Generation } from '@headway/sim';
import type { Mode } from '../../state/store';
import { DESIGNER_MODEL, PITCH, championLine, type ChampionInfo } from '../about/facts';
import { Steps } from './Steps';

export interface LandingCardProps {
  onChoose(mode: Mode): void;
  onAbout(): void;
  champion: ChampionInfo;
  generations: Generation[];
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function BusIcon() {
  return (
    <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true" {...stroke}>
      <rect x="6" y="3.5" width="16" height="18" rx="4.5" />
      <path d="M6 13.5h16M10 7.5h8M10 21.5v2.5M18 21.5v2.5" />
      <circle cx="10" cy="17.5" r="0.6" fill="currentColor" />
      <circle cx="18" cy="17.5" r="0.6" fill="currentColor" />
    </svg>
  );
}

function StopwatchIcon() {
  return (
    <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true" {...stroke}>
      <circle cx="14" cy="15.5" r="8.5" />
      <path d="M14 15.5v-4.5M11.5 3.5h5M14 3.5V7M21.2 8.3l1.5-1.5" />
    </svg>
  );
}

function FlaskIcon() {
  return (
    <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true" {...stroke}>
      <path d="M10.5 3.5h7M12 3.5v6.8l-5.4 9.3a2.6 2.6 0 0 0 2.3 3.9h10.2a2.6 2.6 0 0 0 2.3-3.9L16 10.3V3.5" />
      <path d="M8.8 17h10.4" />
    </svg>
  );
}

function Arrow() {
  return (
    <svg className="hwl-arrow" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" {...stroke} strokeWidth={2}>
      <path d="M3 8h9.5M9 4.5 12.5 8 9 11.5" />
    </svg>
  );
}

interface ModeCard { mode: Mode; tone: 'r1' | 'r2' | 'r3'; kicker: string; title: string; cta: string; icon: ReactNode }

const CARDS: ModeCard[] = [
  {
    mode: 'watch', tone: 'r1', kicker: 'Watch', title: 'Watch the AI', icon: <BusIcon />,
    cta: 'Start watching',
  },
  {
    mode: 'play', tone: 'r2', kicker: 'Play', title: 'Beat the AI', icon: <StopwatchIcon />,
    cta: 'Play dispatcher',
  },
  {
    mode: 'lab', tone: 'r3', kicker: 'Lab', title: 'See how it learned', icon: <FlaskIcon />,
    cta: 'Open the Lab',
  },
];

const step = (i: number) => ({ '--i': i }) as CSSProperties;

export function LandingCard({ onChoose, onAbout, champion, generations }: LandingCardProps) {
  const line = championLine(champion, generations);
  return (
    <div className="hwl-stage">
      <p className="hwl-eyebrow" style={step(0)}>
        A transit-dispatch game
      </p>
      <h1 className="hwl-wordmark" id="hwl-title" style={step(1)}>HEADWAY</h1>
      <p className="hwl-pitch" style={step(2)}>{PITCH}</p>
      {line && (
        <p className="hwl-champion" style={step(3)}>
          <span className="hwl-live" aria-hidden="true" />
          Now dispatching: <b>{line}</b>
        </p>
      )}
      <div className="hwl-steps" style={step(4)}><Steps /></div>
      <div className="hwl-cards">
        {CARDS.map((c, i) => (
          <button
            key={c.mode}
            type="button"
            className={`hwl-card hwl-card--${c.tone}`}
            style={step(5 + i)}
            data-mode={c.mode}
            onClick={() => onChoose(c.mode)}
          >
            <span className="hwl-card-head">
              <span className="hwl-badge">{c.icon}</span>
              <span className="hwl-kicker">{c.kicker}</span>
              {c.mode === 'watch' && <kbd className="hwl-kbd">Enter</kbd>}
            </span>
            <span className="hwl-card-title">{c.title}</span>
            <span className="hwl-cta">{c.cta}<Arrow /></span>
          </button>
        ))}
      </div>
      <div className="hwl-foot" style={step(8)}>
        <p className="hwl-claims">
          <span>Rules written by {DESIGNER_MODEL} on Luminal</span>
          <span>The models are never retrained; the rulebook evolves</span>
          <span>It runs in your browser with no model calls</span>
        </p>
        <button type="button" className="hwl-about" onClick={onAbout}>
          <span className="hwl-q" aria-hidden="true">?</span>
          How it works
        </button>
      </div>
    </div>
  );
}
