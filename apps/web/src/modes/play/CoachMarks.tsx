// Owner: T3c. Three-step coach-mark tour (pick a vehicle → watch the queues → time the train). Skippable; remembered.
import { useEffect, useState } from 'react';
import { TOWN } from '@headway/sim';
import { frame } from '../../state/frame';
import { setTour } from './game';

interface Box { x: number; y: number; w: number; h: number }
const STEPS = [
  { title: 'Pick a vehicle', body: 'Click a bus on the map, or one of these chips. Then choose an action below, or press its key.', target: 'fleet' },
  { title: 'Watch the queues', body: 'Each stop shows how many people wait and the longest wait. Amber after 3 minutes, red after 7.', target: 'queue' },
  { title: 'Time the train', body: 'Hold the train so transfers make their bus, or send it early when nobody is coming. Press T.', target: 'train' },
] as const;

function targetBox(target: (typeof STEPS)[number]['target']): Box | null {
  if (target === 'queue') {
    const stop = TOWN?.stops?.find((s) => s.id === 'stop_stadium_gate');
    const R = frame.renderer;
    const canvas = frame.canvas?.getBoundingClientRect();
    if (!stop || !R) return null;
    const s = R.project(stop.p.x, 0, stop.p.z);
    if (!s.visible) return null;
    return { x: (canvas?.left ?? 0) + s.x - 46, y: (canvas?.top ?? 0) + s.y - 64, w: 92, h: 72 };
  }
  const el = document.querySelector(`[data-coach="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
}

const CARD_W = 320;

export function CoachMarks({ step }: { step: number }) {
  const s = STEPS[Math.min(step, STEPS.length - 1)]!;
  const [box, setBox] = useState<Box | null>(null);
  const [vw, setVw] = useState(() => window.innerWidth);
  const [vh, setVh] = useState(() => window.innerHeight);

  useEffect(() => {
    const find = () => { setBox(targetBox(s.target)); setVw(window.innerWidth); setVh(window.innerHeight); };
    find();
    const id = setInterval(find, 300);
    window.addEventListener('resize', find);
    return () => { clearInterval(id); window.removeEventListener('resize', find); };
  }, [s.target]);

  const last = step >= STEPS.length - 1;
  const pad = 6;
  let style: React.CSSProperties = { left: (vw - CARD_W) / 2, top: vh * 0.32 };
  let arrow: { x: number; side: 'down' | 'up' } | null = null;
  if (box) {
    const cx = box.x + box.w / 2;
    const left = Math.min(vw - CARD_W - 16, Math.max(16, cx - CARD_W / 2));
    const above = box.y > 240;
    style = above ? { left, bottom: vh - box.y + pad + 14 } : { left, top: box.y + box.h + pad + 14 };
    arrow = { x: Math.min(CARD_W - 22, Math.max(22, cx - left)), side: above ? 'down' : 'up' };
  }

  return (
    <div className="pl-coach-layer">
      {box && <div className="pl-spot" style={{ left: box.x - pad, top: box.y - pad, width: box.w + pad * 2, height: box.h + pad * 2 }} />}
      <div className="pl-coach hw-card" style={{ ...style, width: CARD_W }} role="dialog" aria-label={`Tour step ${step + 1} of 3`} key={step}>
        {arrow && <i className="pl-coach__arrow" data-side={arrow.side} style={{ left: arrow.x }} />}
        <div className="pl-coach__top">
          <span className="hw-label">Step {step + 1} of {STEPS.length}</span>
          <span className="pl-steps" aria-hidden="true">{STEPS.map((_, i) => <i key={i} data-on={i <= step || undefined} />)}</span>
        </div>
        <h3>{s.title}</h3>
        <p>{s.body}</p>
        <div className="pl-coach__actions">
          <button type="button" className="hw-btn hw-btn--ghost" onClick={() => setTour(null)}>Skip tour</button>
          <button type="button" className="hw-btn hw-btn--primary" autoFocus onClick={() => setTour(last ? null : step + 1)}>
            {last ? 'Start the clock' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
