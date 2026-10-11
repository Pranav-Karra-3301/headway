// Owner: T3c. Shown while the champion replays the player's crowd ("Watch the AI on this crowd").
import { useEffect } from 'react';
import { useApp } from '../../state/store';
import { backToResults } from './game';
import { EyeIcon } from './ui';

export function SpectateBanner() {
  const id = useApp((s) => s.champion?.policy.meta.id ?? 'g0');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') backToResults(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="pl-spectate hw-card" role="status">
      <EyeIcon />
      <span>Watching <b>the AI dispatcher</b> <span className="pl-muted">({id})</span> on your crowd</span>
      <button type="button" className="hw-btn hw-btn--primary" onClick={() => backToResults()}>Back to results</button>
    </div>
  );
}
