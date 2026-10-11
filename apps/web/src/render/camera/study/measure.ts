// Owner: C1 (camera study). Per-view measurements: hidden fractions per sample class (ray toward the camera vs
// occluder boxes, plus an optional mesh test for the world layer), queues hidden behind a vehicle dwelling at their
// own stop/platform, and on-screen readability at the HUD-safe default framing.
import type { TownMap, Vec2 } from '@headway/sim';
import { fitView, screenOf, type Fit, type HudOptions, type Rect } from './fit';
import { firstOccluder, type Box } from './occlusion';
import { railFrame, SAMPLE_CLASSES, type Sample, type SampleClass } from './samples';
import { toImage, viewBasis, type V2, type V3, type ViewSpec } from './views';

export interface StudyInput {
  map: TownMap;
  samples: Sample[];
  boxes: Box[];
  viewport: { w: number; h: number };
  hud?: HudOptions;
  /** Extra occlusion test (e.g. raycast against the world layer's meshes): a label when the ray is blocked. */
  extraHit?: (p: V3, d: V3) => string | null;
}

export interface ClassStat { n: number; hidden: number; frac: number; /** hidden by buildings/landmarks/terrain only (no trees) */ solid: number }
export interface PlaceStat {
  place: string; name: string; kind: 'stop' | 'platform';
  queueN: number; queueHidden: number; spotN: number; spotHidden: number; behindVehicle: number;
  by: string[];
}
export interface ScreenStats {
  /** Person height on screen (px). */ personPx: number;
  /** Mean linear ground resolution, px per world unit (scale × √sin elev). */ groundPx: number;
  /** Ground foreshortening (sin elev): 1 = top-down. */ depth: number;
  /** Projected rail-loop area as % of the viewport / of the safe rect. */ networkPct: number; fillPct: number;
  /** Screen distance between neighbouring queue slots (px). */ queueSpacingMinPx: number; queueSpacingMeanPx: number;
  /** Queue-marker chips (72 × 30 px above every stop/platform) that overlap another chip. */ markerOverlaps: number; markerPairs: number; markersInvolved: number;
  /** Screen length of a unit E–W street over a unit N–S street (1 = balanced). */ streetRatio: number;
}
export interface ViewResult {
  view: ViewSpec;
  hidden: Record<SampleClass, ClassStat>;
  behindVehicle: { n: number; hidden: number; frac: number };
  /** Default fit for the study viewport, plus px/u when the inspector is open, in Play (dock), and on other screens. */
  fit: Fit & { refits: number; inspectorScale: number; playScale: number; alt: Record<string, number> };
  screen: ScreenStats;
  perPlace: PlaceStat[];
  /** Every hidden sample, its occluder's label and (when a catalog/station box hid it) that box. */
  hiddenPoints: Array<{ cls: SampleClass; p: V3; by: string; box?: Box }>;
  score: number;
}

/** A bus dwelling at each stop (on the road centreline, 1.15 u from the kerb) and the 2-car train at each platform. */
export function dwellingVehicles(map: TownMap): Map<string, Box> {
  const out = new Map<string, Box>();
  for (const s of map.stops) {
    const road = { x: -s.queueDir.z, z: s.queueDir.x };
    out.set(s.id, { cx: s.p.x - s.queueDir.x * 1.15, cz: s.p.z - s.queueDir.z * 1.15, hx: 1.65, hz: 0.625, y0: 0, y1: 1.1, rot: Math.atan2(-road.z, road.x), cls: 'vehicle', kind: 'bus' });
  }
  for (const st of map.rail.stations) {
    const f = railFrame(map, st.dist);
    out.set(st.id, { cx: f.p.x, cz: f.p.z, hx: 4.4, hz: 0.68, y0: 0, y1: 1.82, rot: Math.atan2(-f.along.z, f.along.x), cls: 'vehicle', kind: 'train' });
  }
  return out;
}

const CHIP = { w: 72, h: 30, lift: 6 };
/** Other screens the default fit must work on (projector, full HD). */
export const ALT_VIEWPORTS = [{ w: 1280, h: 720 }, { w: 1920, h: 1080 }] as const;
const MARKER_Y = { stop: 2.6, platform: 3.4 };

function polyArea(pts: readonly V2[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j]!.x + pts[i]!.x) * (pts[j]!.y - pts[i]!.y);
  return Math.abs(a) / 2;
}
const rectArea = (r: Rect) => (r.x1 - r.x0) * (r.y1 - r.y0);

export function measureView(view: ViewSpec, input: StudyInput): ViewResult {
  const { map, samples, viewport } = input;
  const b = viewBasis(view);
  const d = b.d;
  const solidBoxes = input.boxes.filter((x) => x.cls !== 'tree');
  const vehicles = dwellingVehicles(map);
  const hidden = Object.fromEntries(SAMPLE_CLASSES.map((c) => [c, { n: 0, hidden: 0, frac: 0, solid: 0 }])) as Record<SampleClass, ClassStat>;
  const places = new Map<string, PlaceStat>();
  for (const s of map.stops) places.set(s.id, { place: s.id, name: s.name, kind: 'stop', queueN: 0, queueHidden: 0, spotN: 0, spotHidden: 0, behindVehicle: 0, by: [] });
  for (const st of map.rail.stations) places.set(st.id, { place: st.id, name: `${st.name} platform`, kind: 'platform', queueN: 0, queueHidden: 0, spotN: 0, spotHidden: 0, behindVehicle: 0, by: [] });
  const hiddenPoints: ViewResult['hiddenPoints'] = [];
  const behind = { n: 0, hidden: 0, frac: 0 };

  for (const s of samples) {
    const st = hidden[s.cls];
    st.n++;
    const hit = firstOccluder(s.p, d, input.boxes);
    const by = hit ? hit.kind : input.extraHit?.(s.p, d) ?? null;
    if (by) {
      st.hidden++;
      if (!hit || hit.cls !== 'tree' || firstOccluder(s.p, d, solidBoxes)) st.solid++;
      hiddenPoints.push(hit ? { cls: s.cls, p: s.p, by, box: hit } : { cls: s.cls, p: s.p, by });
    }
    const pl = places.get(s.place);
    if (!pl) continue;
    if (s.cls === 'queue' || s.cls === 'platformQueue') {
      pl.queueN++;
      if (by) pl.queueHidden++;
      const v = vehicles.get(s.place);
      behind.n++;
      if (v && firstOccluder(s.p, d, [v])) { behind.hidden++; pl.behindVehicle++; }
    } else if (s.cls === 'stop' || s.cls === 'platform') {
      pl.spotN++;
      if (by) pl.spotHidden++;
    }
    if (by && !pl.by.includes(by)) pl.by.push(by);
  }
  for (const c of SAMPLE_CLASSES) hidden[c].frac = hidden[c].n ? hidden[c].hidden / hidden[c].n : 0;
  behind.frac = behind.n ? behind.hidden / behind.n : 0;

  // ---- framing + screen readability
  const f = fitView(view, map, viewport, input.hud);
  const fit: ViewResult['fit'] = {
    scale: f.scale, rect: f.rect, inner: f.inner, content: f.content, target: f.target, viewport: f.viewport, refits: f.refits,
    inspectorScale: fitView(view, map, viewport, { ...input.hud, inspector: true }).scale,
    playScale: fitView(view, map, viewport, { ...input.hud, mode: 'play' }).scale,
    alt: Object.fromEntries(ALT_VIEWPORTS.map((v) => [`${v.w}×${v.h}`, fitView(view, map, v, input.hud).scale])),
  };
  const scr = (p: V3) => screenOf(fit, toImage(b, p));
  const se = Math.sin((view.elev * Math.PI) / 180), ce = Math.cos((view.elev * Math.PI) / 180);
  const loopPx = map.rail.loop.points.map((p) => scr({ x: p.x, y: 0, z: p.z }));
  const spacings: number[] = [];
  const queueOf = (p: Vec2, dir: Vec2, y: number) => {
    const a = scr({ x: p.x + dir.x * 0.8, y, z: p.z + dir.z * 0.8 }), c = scr({ x: p.x + dir.x * 1.22, y, z: p.z + dir.z * 1.22 });
    spacings.push(Math.hypot(c.x - a.x, c.y - a.y));
  };
  for (const s of map.stops) queueOf(s.p, s.queueDir, 0.4);
  for (const st of map.rail.stations) queueOf(st.platform, st.queueDir, 0.95);
  const chips = [
    ...map.stops.map((s) => scr({ x: s.p.x, y: MARKER_Y.stop, z: s.p.z })),
    ...map.rail.stations.map((st) => scr({ x: st.platform.x, y: MARKER_Y.platform, z: st.platform.z })),
  ].map((p) => ({ x0: p.x - CHIP.w / 2, x1: p.x + CHIP.w / 2, y0: p.y - CHIP.lift - CHIP.h, y1: p.y - CHIP.lift }));
  let markerOverlaps = 0;
  const involved = new Set<number>();
  for (let i = 0; i < chips.length; i++) for (let j = i + 1; j < chips.length; j++) {
    const A = chips[i]!, B = chips[j]!;
    if (A.x0 < B.x1 && B.x0 < A.x1 && A.y0 < B.y1 && B.y0 < A.y1) { markerOverlaps++; involved.add(i); involved.add(j); }
  }
  const ex = toImage(b, { x: 1, y: 0, z: 0 }), ez = toImage(b, { x: 0, y: 0, z: 1 });
  const screen: ScreenStats = {
    personPx: 0.8 * ce * fit.scale,
    groundPx: fit.scale * Math.sqrt(se),
    depth: se,
    networkPct: (100 * polyArea(loopPx)) / (viewport.w * viewport.h),
    fillPct: (100 * polyArea(loopPx)) / rectArea(fit.rect),
    queueSpacingMinPx: Math.min(...spacings),
    queueSpacingMeanPx: spacings.reduce((a, x) => a + x, 0) / spacings.length,
    markerOverlaps, markerPairs: (chips.length * (chips.length - 1)) / 2, markersInvolved: involved.size,
    streetRatio: Math.hypot(ex.x, ex.y) / Math.hypot(ez.x, ez.y),
  };
  const r: ViewResult = { view, hidden, behindVehicle: behind, fit, screen, perPlace: [...places.values()], hiddenPoints, score: 0 };
  r.score = scoreOf(r, fit.scale);
  return r;
}

/** Weights of the readability score: visibility first, then on-screen size (px per world unit at the HUD-safe
 *  default fit, relative to the largest view — x-ray can fade occluders later, nothing recovers lost pixels),
 *  then queue spacing and queue-marker clashes. */
export const SCORE_WEIGHTS = {
  visibility: 0.45, size: 0.35, queueSpacing: 0.1, markers: 0.1,
  hidden: { queue: 0.3, platformQueue: 0.15, stop: 0.15, platform: 0.1, route: 0.2, rail: 0.1 } as Record<SampleClass, number>,
} as const;

export function visibilityOf(r: Pick<ViewResult, 'hidden'>): number {
  let v = 1;
  for (const c of SAMPLE_CLASSES) v -= SCORE_WEIGHTS.hidden[c] * r.hidden[c].frac;
  return v;
}

function scoreOf(r: ViewResult, maxScale: number): number {
  const W = SCORE_WEIGHTS;
  const size = maxScale > 0 ? Math.min(1, r.fit.scale / maxScale) : 0;
  const sep = Math.min(1, r.screen.queueSpacingMinPx / 6);
  const markers = 1 - r.screen.markersInvolved / Math.max(1, r.perPlace.length);
  return 100 * (W.visibility * visibilityOf(r) + W.size * size + W.queueSpacing * sep + W.markers * markers);
}

/** Scores relative to the largest view in the set, best first. */
export function rankViews(rs: readonly ViewResult[]): ViewResult[] {
  const maxScale = Math.max(...rs.map((r) => r.fit.scale));
  return rs.map((r) => ({ ...r, score: scoreOf(r, maxScale) })).sort((a, b) => b.score - a.score);
}

/** Boxes that hide at least one gameplay sample of the given classes (stop queues, stops, platforms by default). */
export function culprits(r: Pick<ViewResult, 'hiddenPoints'>, classes: readonly SampleClass[] = ['queue', 'platformQueue', 'stop', 'platform']): Box[] {
  const out = new Set<Box>();
  for (const h of r.hiddenPoints) if (h.box && classes.includes(h.cls)) out.add(h.box);
  return [...out];
}
