// Mounts the town canvas and starts the host loop (sim/host.ts) for the lifetime of the app.
// A fresh <canvas> per mount: StrictMode's mount → unmount → mount must not reuse a disposed WebGL context.
import { useEffect, useRef } from 'react';
import { startHost } from '../../sim/host';

export function CanvasHost() {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'hw-canvas';
    canvas.setAttribute('aria-label', 'The town of Headway: buses, a train and people');
    canvas.tabIndex = -1;
    el.appendChild(canvas);
    const stop = startHost({ canvas, container: el });
    return () => { stop(); canvas.remove(); };
  }, []);

  return (
    <div ref={box} className="hw-stage">
      <div className="hw-backdrop" aria-hidden="true" />
    </div>
  );
}
