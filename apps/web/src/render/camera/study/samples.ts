// Owner: C1 (camera study). Gameplay sample points whose visibility the study measures — the art bible's §2.3 set
// (docs/research/iso-art-direction.md): stop queue slots, platform queue slots, route paths every 1 u, the rail
// every 1 u outside the tunnel — plus the stops themselves and the platforms' track-side edges.
import { pointAt } from '@headway/sim';
import type { TownMap, Vec2 } from '@headway/sim';
import type { V3 } from './views';

export type SampleClass = 'stop' | 'queue' | 'platformQueue' | 'platform' | 'route' | 'rail';
export const SAMPLE_CLASSES: SampleClass[] = ['stop', 'queue', 'platformQueue', 'platform', 'route', 'rail'];
export interface Sample { cls: SampleClass; place: string; p: V3 }

export interface QueueSlotOptions { spacing?: number; perRow?: number; rowGap?: number; offset?: number }
export interface SampleOptions extends QueueSlotOptions {
  /** Queue slots sampled per stop / platform (default 8, single file as in the bible). */
  slots?: number;
  routeStep?: number;
  railStep?: number;
  /** Rail span inside the foothill tunnel (excluded: hidden on purpose). */
  railTunnel?: { fromDist: number; toDist: number } | null;
}

/** Torso centre of a 0.8 u person; platform deck height (kit station). */
export const PERSON_Y = 0.4;
export const DECK_Y = 0.55;
/** Bible §2.3: slot i at p + dir·(0.25 + 0.5 i); longer queues continue in parallel rows. */
const SLOT = { spacing: 0.5, perRow: 8, rowGap: 0.45, offset: 0.25 } as const;

/** Queue slot i: rows of `perRow` along `dir` starting `offset` from the stop; later rows step to the left of `dir`. */
export function queueSlot(p: Vec2, dir: Vec2, i: number, o: QueueSlotOptions = {}): Vec2 {
  const spacing = o.spacing ?? SLOT.spacing, perRow = o.perRow ?? SLOT.perRow, rowGap = o.rowGap ?? SLOT.rowGap, offset = o.offset ?? SLOT.offset;
  const row = Math.floor(i / perRow), k = i % perRow, along = offset + k * spacing, side = row * rowGap;
  return { x: p.x + dir.x * along - dir.z * side, z: p.z + dir.z * along + dir.x * side };
}

/** Rail frame at an arc distance: unit tangent from a symmetric difference. */
export function railFrame(map: TownMap, dist: number): { p: Vec2; along: Vec2 } {
  const L = map.rail.loop.length;
  const a = pointAt(map.rail.loop, (dist - 0.5 + L) % L), b = pointAt(map.rail.loop, (dist + 0.5) % L), c = pointAt(map.rail.loop, dist);
  const n = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { p: { x: c.x, z: c.z }, along: { x: (b.x - a.x) / n, z: (b.z - a.z) / n } };
}

/** Platform track-side edge: 9 u long, 0.75 u in from the rail centreline toward the platform (kit station). */
export function platformEdge(map: TownMap, stationId: string): { a: Vec2; b: Vec2; inward: Vec2 } {
  const st = map.rail.stations.find((s) => s.id === stationId)!;
  const f = railFrame(map, st.dist);
  let n = { x: -f.along.z, z: f.along.x };
  if ((st.platform.x - f.p.x) * n.x + (st.platform.z - f.p.z) * n.z < 0) n = { x: -n.x, z: -n.z };
  const c = { x: f.p.x + n.x * 0.75, z: f.p.z + n.z * 0.75 };
  return { a: { x: c.x - f.along.x * 4.5, z: c.z - f.along.z * 4.5 }, b: { x: c.x + f.along.x * 4.5, z: c.z + f.along.z * 4.5 }, inward: n };
}

function inSpan(d: number, span: { fromDist: number; toDist: number }, L: number): boolean {
  const { fromDist: a, toDist: b } = span;
  return a <= b ? d >= a && d <= b : d >= a || d <= b || d >= L;
}

export function studySamples(map: TownMap, o: SampleOptions = {}): Sample[] {
  const slots = o.slots ?? 8, routeStep = o.routeStep ?? 1, railStep = o.railStep ?? 1;
  const out: Sample[] = [];
  for (const s of map.stops) {
    const kerb = { x: -s.queueDir.z, z: s.queueDir.x };
    for (const k of [-1, 0, 1]) out.push({ cls: 'stop', place: s.id, p: { x: s.p.x + kerb.x * k, y: 0.6, z: s.p.z + kerb.z * k } });
    for (let i = 0; i < slots; i++) {
      const q = queueSlot(s.p, s.queueDir, i, o);
      out.push({ cls: 'queue', place: s.id, p: { x: q.x, y: PERSON_Y, z: q.z } });
    }
  }
  for (const st of map.rail.stations) {
    for (let i = 0; i < slots; i++) {
      const q = queueSlot(st.platform, st.queueDir, i, o);
      out.push({ cls: 'platformQueue', place: st.id, p: { x: q.x, y: DECK_Y + PERSON_Y, z: q.z } });
    }
    const e = platformEdge(map, st.id);
    for (let k = 0; k <= 18; k++) {
      const t = k / 18;
      out.push({ cls: 'platform', place: st.id, p: { x: e.a.x + (e.b.x - e.a.x) * t, y: DECK_Y + 0.05, z: e.a.z + (e.b.z - e.a.z) * t } });
    }
  }
  for (const r of map.routes) {
    for (let d = 0; d < r.path.length; d += routeStep) {
      const q = pointAt(r.path, d);
      out.push({ cls: 'route', place: r.id, p: { x: q.x, y: 0.55, z: q.z } });
    }
  }
  const L = map.rail.loop.length;
  for (let d = 0; d < L; d += railStep) {
    if (o.railTunnel && inSpan(d, o.railTunnel, L)) continue;
    const q = pointAt(map.rail.loop, d);
    out.push({ cls: 'rail', place: 'rail', p: { x: q.x, y: 0.7, z: q.z } });
  }
  return out;
}
