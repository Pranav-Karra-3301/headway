// Mounts the town canvas and starts the host loop (sim/host.ts) for the lifetime of the app.
// A fresh <canvas> per mount: StrictMode's mount → unmount → mount must not reuse a disposed WebGL context.
// Kenney-backed asset builders need their models loaded before the static town is built (T2.2), so the host starts
// once preloadTownAssets() settles; it never rejects, and the host starts anyway after PRELOAD_CAP_MS.
import { useEffect, useRef } from 'react';
import { preloadTownAssets } from '../../render/index';
import { startHost } from '../../sim/host';

const PRELOAD_CAP_MS = 8000;

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
    let live = true;
    let stop: (() => void) | null = null;
    let cap: ReturnType<typeof setTimeout> | undefined;
    const go = () => {
      clearTimeout(cap);
      if (live && !stop) stop = startHost({ canvas, container: el });
    };
    cap = setTimeout(go, PRELOAD_CAP_MS);
    preloadTownAssets().then(go, go);
    return () => { live = false; clearTimeout(cap); stop?.(); canvas.remove(); };
  }, []);

  return (
    <div ref={box} className="hw-stage">
      <div className="hw-backdrop" aria-hidden="true" />
    </div>
  );
}
