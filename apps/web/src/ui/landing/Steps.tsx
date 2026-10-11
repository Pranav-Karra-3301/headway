// Owner: U2 (v13). The 3-step "how to play" strip, shared by the landing card, the Play goal card and About.
import type { CSSProperties, ReactNode } from 'react';
import { BusIcon, MissedIcon, PersonIcon, StopIcon, TrainIcon } from '../hud/icons';
import './steps.css';

export const STEPS: Array<{ text: string; tone: string; icons: ReactNode }> = [
  { text: 'People wait at stops', tone: 'var(--route-r1, #1fa99a)', icons: <><PersonIcon /><StopIcon /></> },
  { text: 'You send buses and time the train', tone: 'var(--route-r2, #f0a830)', icons: <><BusIcon /><TrainIcon /></> },
  { text: 'Lower total travel time wins', tone: 'var(--route-r3, #8a6bd8)', icons: <MissedIcon size={20} /> },
];

export function Steps({ className }: { className?: string }) {
  return (
    <ol className={`hw-steps${className ? ` ${className}` : ''}`} aria-label="How it works">
      {STEPS.map((s, i) => (
        <li key={s.text} className="hw-step" style={{ '--tone': s.tone } as CSSProperties}>
          <span className="hw-step__icons" aria-hidden="true">{s.icons}</span>
          <span className="hw-step__n">{i + 1}</span>
          <span className="hw-step__text">{s.text}</span>
        </li>
      ))}
    </ol>
  );
}
