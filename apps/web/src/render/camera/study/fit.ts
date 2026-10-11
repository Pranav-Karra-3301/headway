// Owner: C1 (camera study). HUD-safe framing (CSS px): the HUD panels as screen boxes (shell tokens + published HUD
// screens) and the orthographic fit of the transit network into the HUD-safe rect with 4 % padding, as the art
// bible §1.4 specifies (docs/research/iso-art-direction.md): rect = (14, --hw-top + 36) – (W − 14, H − 14), the
// inspector and the Play dock cut it, corner panels (legend, Watch card) are test-only: when a stop or platform lands
// under one, zoom out 3 % and refit (≤ 5 times). `strict: true` instead fits into the largest rect clear of every panel.
import { pointAt } from '@headway/sim';
import type { TownMap } from '@headway/sim';
import { toImage, viewBasis, type V2, type V3 } from './views';

export interface Rect { x0: number; y0: number; x1: number; y1: number }
export type HudMode = 'watch' | 'play';
export interface HudOptions { mode?: HudMode; inspector?: boolean; /** largest rect clear of every panel instead of the bible rect */ strict?: boolean }
export type HudBox = Rect & { id: 'topbar' | 'legend' | 'bottom' | 'inspector' };

/** Shell layout (styles/tokens.css): gap 14, bar 52 → --hw-top 80; legend 236 wide; inspector 332 wide. */
export const HUD = {
  gap: 14, top: 80, legend: { w: 236, h: 200 }, card: { w: 760, h: 100 }, dock: { w: 780, h: 140 }, inspector: { w: 332, h: 400 },
} as const;

export function hudBoxes(w: number, h: number, o: HudOptions = {}): HudBox[] {
  const g = HUD.gap;
  const bottom = o.mode === 'play' ? HUD.dock : HUD.card;
  const bw = Math.min(bottom.w, w - 2 * g);
  const out: HudBox[] = [
    { id: 'topbar', x0: 0, y0: 0, x1: w, y1: HUD.top },
    { id: 'legend', x0: 0, y0: h - g - HUD.legend.h - g, x1: g + HUD.legend.w + g, y1: h },
    { id: 'bottom', x0: w / 2 - bw / 2 - g, y0: h - g - bottom.h - g, x1: w / 2 + bw / 2 + g, y1: h },
  ];
  if (o.inspector) out.push({ id: 'inspector', x0: w - g - HUD.inspector.w - g, y0: HUD.top - g, x1: w, y1: HUD.top + HUD.inspector.h + g });
  return out;
}

export const overlaps = (a: Rect, b: Rect): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

export function contentRect(pts: readonly V2[]): Rect {
  const r = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const p of pts) { r.x0 = Math.min(r.x0, p.x); r.x1 = Math.max(r.x1, p.x); r.y0 = Math.min(r.y0, p.y); r.y1 = Math.max(r.y1, p.y); }
  return r;
}

export const shrink = (r: Rect, pad: number): Rect => {
  const px = (r.x1 - r.x0) * pad, py = (r.y1 - r.y0) * pad;
  return { x0: r.x0 + px, y0: r.y0 + py, x1: r.x1 - px, y1: r.y1 - py };
};

/** Largest-scale HUD-free rectangle for content of size w × h (any units), padded by `pad` of each side. */
export function safeRect(w: number, h: number, boxes: readonly Rect[], content: { w: number; h: number }, pad = 0.04): { rect: Rect; inner: Rect; scale: number } {
  const xs0 = [0, ...boxes.map((b) => b.x1)], xs1 = [w, ...boxes.map((b) => b.x0)];
  const ys0 = [0, ...boxes.map((b) => b.y1)], ys1 = [h, ...boxes.map((b) => b.y0)];
  let best: { rect: Rect; inner: Rect; scale: number; area: number } | null = null;
  for (const x0 of xs0) for (const x1 of xs1) for (const y0 of ys0) for (const y1 of ys1) {
    if (x0 < 0 || y0 < 0 || x1 > w || y1 > h || x1 - x0 < 16 || y1 - y0 < 16) continue;
    const rect = { x0, y0, x1, y1 };
    if (boxes.some((b) => overlaps(rect, b))) continue;
    const inner = shrink(rect, pad);
    const scale = Math.min((inner.x1 - inner.x0) / Math.max(content.w, 1e-9), (inner.y1 - inner.y0) / Math.max(content.h, 1e-9));
    const area = (x1 - x0) * (y1 - y0);
    if (!best || scale > best.scale + 1e-9 || (Math.abs(scale - best.scale) <= 1e-9 && area > best.area)) best = { rect, inner, scale, area };
  }
  if (!best) { const rect = { x0: 0, y0: 0, x1: w, y1: h }; const inner = shrink(rect, pad); return { rect, inner, scale: Math.min((inner.x1 - inner.x0) / content.w, (inner.y1 - inner.y0) / content.h) }; }
  return { rect: best.rect, inner: best.inner, scale: best.scale };
}

/** Bible §1.4 safe rect: below the top bar with 36 px of room for queue markers, 14 px from the other edges, cut by
 *  the open inspector and (in Play) the dock. */
export function bibleSafeRect(w: number, h: number, o: HudOptions = {}): Rect {
  const g = HUD.gap;
  return { x0: g, y0: HUD.top + 36, x1: o.inspector ? w - g - HUD.inspector.w - g : w - g, y1: o.mode === 'play' ? h - g - HUD.dock.h - g : h - g };
}

/** Bible §1.4 overview points: the rail loop every 2 u at y 0 and 2.6, every stop and platform at y 0 and 2.2. */
export function networkPoints(map: TownMap): V3[] {
  const pts: V3[] = [];
  const loop = map.rail.loop;
  for (let d = 0; d < loop.length; d += 2) { const p = pointAt(loop, d); pts.push({ x: p.x, y: 0, z: p.z }, { x: p.x, y: 2.6, z: p.z }); }
  for (const s of map.stops) pts.push({ x: s.p.x, y: 0, z: s.p.z }, { x: s.p.x, y: 2.2, z: s.p.z });
  for (const st of map.rail.stations) pts.push({ x: st.platform.x, y: 0, z: st.platform.z }, { x: st.platform.x, y: 2.2, z: st.platform.z });
  return pts;
}

export interface Fit {
  /** CSS px per world unit on the image plane. */
  scale: number;
  rect: Rect; inner: Rect;
  /** Content bounds on the image plane (world units). */
  content: Rect;
  /** Image-plane point at the canvas centre (camera target). */
  target: V2;
  viewport: { w: number; h: number };
}

export function fitView(view: { elev: number; az: number }, map: TownMap, viewport: { w: number; h: number }, hud: HudOptions = {}, pad = 0.04): Fit & { toScreen(q: V2): V2; refits: number } {
  const b = viewBasis(view);
  const content = contentRect(networkPoints(map).map((p) => toImage(b, p)));
  const cw = content.x1 - content.x0, ch = content.y1 - content.y0;
  const boxes = hudBoxes(viewport.w, viewport.h, hud);
  let s: { rect: Rect; inner: Rect; scale: number };
  if (hud.strict) s = safeRect(viewport.w, viewport.h, boxes, { w: cw, h: ch }, pad);
  else {
    const rect = bibleSafeRect(viewport.w, viewport.h, hud), inner = shrink(rect, pad);
    s = { rect, inner, scale: Math.min((inner.x1 - inner.x0) / cw, (inner.y1 - inner.y0) / ch) };
  }
  const cx = (s.inner.x0 + s.inner.x1) / 2, cy = (s.inner.y0 + s.inner.y1) / 2;
  const mid = { x: (content.x0 + content.x1) / 2, y: (content.y0 + content.y1) / 2 };
  const make = (scale: number): Fit => ({
    scale, rect: s.rect, inner: s.inner, content, viewport: { ...viewport },
    target: { x: mid.x + (viewport.w / 2 - cx) / scale, y: mid.y - (viewport.h / 2 - cy) / scale },
  });
  let fit = make(s.scale), refits = 0;
  // corner panels are test-only: zoom out 3 % while a stop or platform sits under one (bible §1.4)
  const corner = boxes.filter((x) => x.id === 'legend' || (x.id === 'bottom' && hud.mode !== 'play'));
  const places = [...map.stops.map((x) => x.p), ...map.rail.stations.map((x) => x.platform)].map((p) => toImage(b, { x: p.x, y: 0, z: p.z }));
  while (!hud.strict && refits < 5 && places.some((q) => { const p = screenOf(fit, q); return corner.some((r) => p.x > r.x0 && p.x < r.x1 && p.y > r.y0 && p.y < r.y1); })) {
    fit = make(fit.scale * 0.97);
    refits++;
  }
  return { ...fit, refits, toScreen: (q: V2) => screenOf(fit, q) };
}

/** CSS px of an image-plane point under a fit. */
export function screenOf(f: Fit, q: V2): V2 {
  return { x: f.viewport.w / 2 + (q.x - f.target.x) * f.scale, y: f.viewport.h / 2 - (q.y - f.target.y) * f.scale };
}

// ---------------------------------------------------------------- silhouette fit (study aside)
function hull(pts: readonly V2[]): V2[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: V2, a: V2, b: V2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo: V2[] = [], hi: V2[] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]!; while (hi.length >= 2 && cross(hi[hi.length - 2]!, hi[hi.length - 1]!, q) <= 0) hi.pop(); hi.push(q); }
  return [...lo.slice(0, -1), ...hi.slice(0, -1)];
}

/** Separating-axis test: convex polygon vs axis-aligned rect. */
export function polyHitsRect(poly: readonly V2[], r: Rect): boolean {
  const axes: V2[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }];
  for (let i = 0; i < poly.length; i++) { const a = poly[i]!, b = poly[(i + 1) % poly.length]!; axes.push({ x: -(b.y - a.y), y: b.x - a.x }); }
  const corners = [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }];
  for (const ax of axes) {
    let p0 = Infinity, p1 = -Infinity, q0 = Infinity, q1 = -Infinity;
    for (const v of poly) { const d = v.x * ax.x + v.y * ax.y; p0 = Math.min(p0, d); p1 = Math.max(p1, d); }
    for (const v of corners) { const d = v.x * ax.x + v.y * ax.y; q0 = Math.min(q0, d); q1 = Math.max(q1, d); }
    if (p1 <= q0 || q1 <= p0) return false;
  }
  return true;
}

/** Largest px/u at which the network's actual silhouette (convex hull) fits on screen without touching a HUD panel
 *  (margin = `pad` of the short screen side) — what a shape-aware fit could gain over the rectangle fit. */
export function silhouetteScale(view: { elev: number; az: number }, map: TownMap, viewport: { w: number; h: number }, hud: HudOptions = {}, pad = 0.04): number {
  const b = viewBasis(view);
  const img = hull(networkPoints(map).map((p) => toImage(b, p)));
  const c = contentRect(img);
  const m = pad * Math.min(viewport.w, viewport.h);
  const boxes = hudBoxes(viewport.w, viewport.h, hud).map((x) => ({ x0: x.x0 - m, y0: x.y0 - m, x1: x.x1 + m, y1: x.y1 + m }));
  const fits = (s: number): boolean => {
    const w = (c.x1 - c.x0) * s, h = (c.y1 - c.y0) * s;
    const ox0 = m, ox1 = viewport.w - m - w, oy0 = m, oy1 = viewport.h - m - h;
    if (ox1 < ox0 || oy1 < oy0) return false;
    const N = 20;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const ox = ox0 + ((ox1 - ox0) * i) / N, oy = oy0 + ((oy1 - oy0) * j) / N;
      const poly = img.map((p) => ({ x: ox + (p.x - c.x0) * s, y: oy + (c.y1 - p.y) * s }));
      if (!boxes.some((r) => polyHitsRect(poly, r))) return true;
    }
    return false;
  };
  let lo = fitView(view, map, viewport, hud, pad).scale * 0.9, hi = lo * 2.5;
  for (let k = 0; k < 16; k++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
  return lo;
}
