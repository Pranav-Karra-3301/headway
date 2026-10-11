// Owner: C1 (camera study). HUD-safe framing: the HUD panels as screen boxes (CSS px, from the shell tokens and the
// published HUD screens), the HUD-free rectangle that shows the content largest, and the orthographic fit of the
// transit network (rail loop + stops + their queue-marker anchors) into it with 4 % padding.
import type { TownMap } from '@headway/sim';
import { toImage, viewBasis, type V2, type V3 } from './views';

export interface Rect { x0: number; y0: number; x1: number; y1: number }
export type HudMode = 'watch' | 'play';
export interface HudOptions { mode?: HudMode; inspector?: boolean }
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

/** What the default framing must keep on screen: the rail loop (and a train on it), every stop and the queue markers. */
export function networkPoints(map: TownMap): V3[] {
  const pts: V3[] = [];
  for (const p of map.rail.loop.points) pts.push({ x: p.x, y: 0, z: p.z }, { x: p.x, y: 1.6, z: p.z });
  for (const s of map.stops) pts.push({ x: s.p.x, y: 0, z: s.p.z }, { x: s.p.x, y: 2.6, z: s.p.z });
  for (const st of map.rail.stations) pts.push({ x: st.platform.x, y: 3.4, z: st.platform.z });
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

export function fitView(view: { elev: number; az: number }, map: TownMap, viewport: { w: number; h: number }, hud: HudOptions = {}, pad = 0.04): Fit & { toScreen(q: V2): V2 } {
  const b = viewBasis(view);
  const content = contentRect(networkPoints(map).map((p) => toImage(b, p)));
  const s = safeRect(viewport.w, viewport.h, hudBoxes(viewport.w, viewport.h, hud), { w: content.x1 - content.x0, h: content.y1 - content.y0 }, pad);
  const cx = (s.inner.x0 + s.inner.x1) / 2, cy = (s.inner.y0 + s.inner.y1) / 2;
  const mid = { x: (content.x0 + content.x1) / 2, y: (content.y0 + content.y1) / 2 };
  const target = { x: mid.x + (viewport.w / 2 - cx) / s.scale, y: mid.y - (viewport.h / 2 - cy) / s.scale };
  const fit: Fit = { scale: s.scale, rect: s.rect, inner: s.inner, content, target, viewport: { ...viewport } };
  return { ...fit, toScreen: (q: V2) => screenOf(fit, q) };
}

/** CSS px of an image-plane point under a fit. */
export function screenOf(f: Fit, q: V2): V2 {
  return { x: f.viewport.w / 2 + (q.x - f.target.x) * f.scale, y: f.viewport.h / 2 - (q.y - f.target.y) * f.scale };
}
