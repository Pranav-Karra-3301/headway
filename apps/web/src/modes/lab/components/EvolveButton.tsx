// Owner: T3d. "Evolve next generation" with an admin-token prompt (spec §10, §11).
import { useEffect, useRef, useState } from 'react';
import { runEvolve, savedToken } from '../evolve';
import { useLab } from '../labStore';
import { IconSpark } from './icons';

export function EvolveButton({ evolving, round }: { evolving: boolean; round: number | null }) {
  const open = useLab((s) => s.tokenOpen);
  const [token, setToken] = useState('');
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setToken(savedToken());
    const t = window.setTimeout(() => input.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') useLab.setState({ tokenOpen: false }); };
    const onDown = (e: PointerEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) useLab.setState({ tokenOpen: false }); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => { window.clearTimeout(t); window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown); };
  }, [open]);

  return (
    <div className="lab-evolve" ref={wrap}>
      <button type="button" className="lab-btn lab-btn--primary lab-btn--evolve" disabled={evolving} aria-expanded={open}
        onClick={() => useLab.setState({ tokenOpen: !open })}>
        {evolving ? <span className="lab-spin" aria-hidden="true" /> : <IconSpark />}
        {evolving ? `Evolving${round !== null ? ` round ${round}` : ''}…` : 'Evolve next generation'}
      </button>
      {open && !evolving && (
        <form className="lab-pop" onSubmit={(e) => { e.preventDefault(); if (token.trim()) void runEvolve(token.trim()); }}>
          <label className="lab-pop__label" htmlFor="lab-token">Admin token</label>
          <input id="lab-token" ref={input} className="lab-input" type="password" autoComplete="off" spellCheck={false}
            value={token} onChange={(e) => setToken(e.target.value)} placeholder="Bearer token" />
          <p className="lab-pop__note">
            Runs one round live: three DeepSeek V4.1 Flash designers on Luminal each rewrite the policy, then about 30
            simulations decide whether anything is promoted.
          </p>
          <div className="lab-pop__row">
            <button type="button" className="lab-btn lab-btn--ghost lab-btn--sm" onClick={() => useLab.setState({ tokenOpen: false })}>Cancel</button>
            <button type="submit" className="lab-btn lab-btn--primary lab-btn--sm" disabled={!token.trim()}>Start round</button>
          </div>
        </form>
      )}
    </div>
  );
}
