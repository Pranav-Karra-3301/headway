// Owner: T3b. HTML queue markers: count + longest wait + severity colour, anchored above every stop and platform.
// React renders the elements once; a rAF loop reads frame.runner / frame.renderer and writes transforms + text.
import { useEffect, useMemo, useRef } from 'react';
import type { QueueView } from '@headway/sim';
import { frame } from '../../state/frame';
import { useApp } from '../../state/store';
import { hudVars, townMap } from './format';
import { markerPlaces, markerText, placeKey } from './markers';
import type { MarkerPlace } from './markers';
import './hud.css';

interface Els { root: HTMLElement; count: HTMLElement; wait: HTMLElement; last: { count: string; wait: string; sev: string; show: string; tf: string } }

function bind(root: HTMLElement): Els {
  return {
    root,
    count: root.querySelector('.hud-marker-count') as HTMLElement,
    wait: root.querySelector('.hud-marker-wait') as HTMLElement,
    last: { count: '', wait: '', sev: '', show: '', tf: '' },
  };
}

interface Item { els: Els; q: QueueView; place: MarkerPlace; x: number; y: number; w: number; count: string; wait: string }

const BUBBLE_H = 30;

/** Rough bubble width from its text (Gumball digits ~9 px, wait text ~7 px/char, dot + paddings). */
const widthOf = (count: string, wait: string) => 44 + 9 * count.length + 7 * wait.length;

/** Pushes overlapping markers upward. Earlier items keep their spot (stops before platforms): a fixed order, so
 *  two markers never swap places frame to frame while the camera pans. */
export function declutter(items: Array<{ x: number; y: number; w: number }>): void {
  const placed: Array<{ x: number; y: number; w: number }> = [];
  for (const it of items) {
    for (let pass = 0; pass < 6; pass++) {
      const hit = placed.find((o) => Math.abs(o.x - it.x) < (o.w + it.w) / 2 + 4 && Math.abs(o.y - it.y) < BUBBLE_H + 2);
      if (!hit) break;
      it.y = hit.y - BUBBLE_H - 2;
    }
    placed.push(it);
  }
}

function write(els: Els, it: Item | null): void {
  const show = String(!!it);
  if (it) {
    const tf = `translate3d(${it.x.toFixed(1)}px, ${it.y.toFixed(1)}px, 0)`;
    if (tf !== els.last.tf) { els.root.style.transform = tf; els.last.tf = tf; }
    if (it.count !== els.last.count) { els.count.textContent = it.count; els.last.count = it.count; }
    if (it.wait !== els.last.wait) { els.wait.textContent = it.wait; els.last.wait = it.wait; }
    if (it.q.severity !== els.last.sev) { els.root.dataset.sev = it.q.severity; els.last.sev = it.q.severity; }
    const label = `${it.place.name}: ${it.count} waiting, longest ${it.wait}`;
    if (els.root.title !== label) els.root.title = label;
  }
  if (show !== els.last.show) { els.root.dataset.show = show; els.last.show = show; }
}

export function QueueMarkers() {
  const mode = useApp((s) => s.mode);
  const palette = useApp((s) => s.palette);
  const places = useMemo(() => markerPlaces(townMap()), []);
  const layer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = layer.current;
    if (!host || mode === 'lab' || places.length === 0) return;
    const els = new Map<string, Els>();
    host.querySelectorAll<HTMLElement>('[data-key]').forEach((el) => els.set(el.dataset.key!, bind(el)));
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const r = frame.renderer;
      const queues = frame.runner?.next.queues ?? [];
      const byKey = new Map<string, QueueView>();
      for (const q of queues) byKey.set(placeKey(q.at), q);
      const rect = frame.canvas?.getBoundingClientRect() ?? { left: 0, top: 0 };
      const items: Item[] = [];
      const hidden: Els[] = [];
      for (const place of places) {
        const e = els.get(place.key);
        if (!e) continue;
        const q = byKey.get(place.key);
        const pr = q && q.count > 0 && r ? r.project(place.x, place.y, place.z) : null;
        if (!q || !pr || !pr.visible || !Number.isFinite(pr.x) || !Number.isFinite(pr.y)) { hidden.push(e); continue; }
        const txt = markerText(q);
        items.push({ els: e, q, place, x: rect.left + pr.x, y: rect.top + pr.y, w: widthOf(txt.count, txt.wait), count: txt.count, wait: txt.wait });
      }
      declutter(items);
      for (const it of items) write(it.els, it);
      for (const e of hidden) write(e, null);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode, places]);

  if (mode === 'lab') return null;
  const select = (p: MarkerPlace) => {
    if (p.stopId) useApp.getState().select({ kind: 'stop', id: p.stopId });
  };
  return (
    <div ref={layer} className="hud-root hud-markers" style={hudVars(palette)} aria-label="Queues">
      {places.map((p) => (
        <div key={p.key} data-key={p.key} className="hud-marker" data-show="false" data-sev="ok" data-platform={p.at.kind === 'platform'}>
          <button type="button" className="hud-marker-b" tabIndex={-1} onClick={() => select(p)} title={p.name}>
            <span className="hud-marker-dot" aria-hidden />
            <span className="hud-marker-count">0</span>
            <span className="hud-marker-wait">0s</span>
          </button>
        </div>
      ))}
    </div>
  );
}
