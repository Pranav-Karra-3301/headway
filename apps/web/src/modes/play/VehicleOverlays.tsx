// Owner: T3c. HTML overlays over vehicles: pending-intent badges, hold ring timers, and the deadhead preview path while
// choosing a reassign target. React renders the set at 4 Hz; positions update every frame via renderer.project.
import { useEffect, useRef } from 'react';
import { TOWN, deadheadPath, pointAt, routeById } from '@headway/sim';
import type { PathRef, Polyline, VehicleView } from '@headway/sim';
import { frame } from '../../state/frame';
import { useApp } from '../../state/store';
import { badgeFor } from './intents';
import { lerpDist } from './logic';
import { usePlay } from './playStore';

const RING_R = 15;
const RING_C = 2 * Math.PI * RING_R;
const LIFT = { bus: 2.1, train: 2.8 } as const;
const TRAIN_MID = 2.25; // half the car pitch: the badge sits over the coupling

function polyFor(p: PathRef): Polyline | null {
  try {
    if (p.kind === 'route') return routeById(TOWN, p.routeId).path;
    if (p.kind === 'rail') return TOWN.rail.loop;
    return deadheadPath(TOWN, p.from, p.to);
  } catch {
    return null;
  }
}

const samePath = (a: PathRef, b: PathRef) =>
  a.kind === b.kind && (a.kind !== 'route' || a.routeId === (b as typeof a).routeId)
  && (a.kind !== 'deadhead' || (a.from === (b as typeof a).from && a.to === (b as typeof a).to));

export function VehicleOverlays() {
  const obs = usePlay((s) => s.obs);
  const tracked = usePlay((s) => s.tracked);
  const picker = usePlay((s) => s.picker);
  const preview = usePlay((s) => s.preview);
  const selection = useApp((s) => s.selection);
  const els = useRef(new Map<string, HTMLDivElement>());
  const holds = useRef(new Map<string, { until: number; start: number }>());
  const pathRef = useRef<SVGPathElement | null>(null);

  // vehicles worth an overlay: a pending intent or a running hold
  const items: Array<{ id: string; badge: string | null; holding: boolean; human: boolean }> = [];
  if (obs) {
    for (const b of obs.buses) {
      const badge = badgeFor(tracked, b.id);
      const holding = b.holdUntil !== null && b.holdUntil > obs.t;
      if (badge || holding) {
        const human = tracked.some((x) => x.status === 'applied' && x.intent.type === 'hold' && x.intent.vehicleId === b.id && (x.appliedT ?? 0) >= obs.t - 130);
        items.push({ id: b.id, badge, holding, human });
      }
    }
    const tb = badgeFor(tracked, 't1');
    if (tb) items.push({ id: 't1', badge: tb, holding: false, human: true });
  }
  const selBus = selection?.kind === 'bus' ? obs?.buses.find((b) => b.id === selection.id) ?? null : null;
  const deadhead = picker === 'reassign' && preview && selBus && preview !== selBus.routeId ? { from: selBus.routeId, to: preview } : null;

  // remember when each hold started (for the ring's fraction)
  useEffect(() => {
    if (!obs) return;
    for (const b of obs.buses) {
      if (b.holdUntil === null || b.holdUntil <= obs.t) { holds.current.delete(b.id); continue; }
      const h = holds.current.get(b.id);
      if (!h || h.until !== b.holdUntil) holds.current.set(b.id, { until: b.holdUntil, start: h && h.until < b.holdUntil && h.until > obs.t ? h.start : obs.t });
    }
  }, [obs]);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const r = frame.runner;
      const R = frame.renderer;
      if (!r || !R) return;
      const simT = r.simT;
      const prev = new Map<string, VehicleView>();
      for (const v of r.prev.vehicles ?? []) prev.set(v.id, v);
      for (const v of r.next.vehicles ?? []) {
        const el = els.current.get(v.id);
        if (!el) continue;
        const poly = polyFor(v.path);
        if (!poly || poly.length <= 0) { el.style.opacity = '0'; continue; }
        const pv = prev.get(v.id);
        let d = pv && samePath(pv.path, v.path) ? lerpDist(pv.dist, v.dist, r.alpha, poly.length, poly.closed) : v.dist;
        if (v.kind === 'train') d -= TRAIN_MID;
        if (poly.closed) d = ((d % poly.length) + poly.length) % poly.length;
        else d = Math.min(poly.length, Math.max(0, d));
        try {
          const p = pointAt(poly, d);
          const s = R.project(p.x, v.kind === 'train' ? LIFT.train : LIFT.bus, p.z);
          if (!s.visible) { el.style.opacity = '0'; continue; }
          el.style.opacity = '1';
          el.style.transform = `translate3d(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px, 0)`;
        } catch {
          el.style.opacity = '0';
          continue;
        }
        const arc = el.querySelector<SVGCircleElement>('.pl-ring__arc');
        const label = el.querySelector<HTMLElement>('.pl-ring__s');
        const h = holds.current.get(v.id);
        if (arc && h) {
          const left = Math.max(0, h.until - simT);
          const frac = Math.min(1, left / Math.max(1, h.until - h.start));
          arc.style.strokeDashoffset = String(RING_C * (1 - frac));
          if (label) label.textContent = String(Math.ceil(left));
        }
      }
      const path = pathRef.current;
      if (path) {
        const dh = path.dataset.from && path.dataset.to ? { from: path.dataset.from, to: path.dataset.to } : null;
        let dAttr = '';
        if (dh) {
          try {
            const poly = deadheadPath(TOWN, dh.from as never, dh.to as never);
            const pts = poly.points.map((q) => R.project(q.x, 0.15, q.z));
            if (pts.some((q) => q.visible)) dAttr = pts.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join(' ');
          } catch { dAttr = ''; }
        }
        path.setAttribute('d', dAttr);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="pl-ov" aria-hidden="true">
      <svg className="pl-ov__svg">
        <path ref={pathRef} className="pl-deadhead" data-from={deadhead?.from ?? ''} data-to={deadhead?.to ?? ''} d="" />
      </svg>
      {items.map((it) => (
        <div key={it.id} className="pl-tag" data-human={it.human || undefined}
          ref={(el) => { if (el) els.current.set(it.id, el); else els.current.delete(it.id); }}>
          {it.holding && (
            <span className="pl-ring">
              <svg width="38" height="38" viewBox="0 0 38 38">
                <circle className="pl-ring__track" cx="19" cy="19" r={RING_R} />
                <circle className="pl-ring__arc" cx="19" cy="19" r={RING_R} strokeDasharray={RING_C} strokeDashoffset="0" />
              </svg>
              <span className="pl-ring__s hw-num" />
            </span>
          )}
          {it.badge && <span className="pl-badge">{it.badge}</span>}
        </div>
      ))}
    </div>
  );
}
