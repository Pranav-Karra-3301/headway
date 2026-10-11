// Owner: T2.2. Pure helpers for the dynamic layer (no three, no DOM; unit-tested in __tests__/project.test.ts):
// vehicle `dist` interpolation with loop wrap, straight walks over [t0, t1], queue slots along `queueDir`,
// easing of rendered positions, and where the kit bus-stop model stands relative to its queue line.
import type { Vec2 } from '@headway/sim';

/** Interpolated sim time between two snapshots. */
export function simTimeAt(prevT: number, nextT: number, alpha: number): number {
  return prevT + (nextT - prevT) * alpha;
}

/**
 * Interpolate an arc distance from `a` (prev) to `b` (next) by `alpha` on a path of `length`.
 * Closed paths take the short way (forward across the seam) and return a value in [0, length);
 * open paths lerp and clamp to [0, length].
 */
export function lerpDist(a: number, b: number, alpha: number, length: number, closed: boolean): number {
  if (!(length > 0)) return 0;
  if (!closed) {
    const v = a + (b - a) * alpha;
    return v < 0 ? 0 : v > length ? length : v;
  }
  let d = b - a;
  if (d > length / 2) d -= length;
  else if (d < -length / 2) d += length;
  let v = (a + d * alpha) % length;
  if (v < 0) v += length;
  return v >= length ? 0 : v;
}

/** Position on a straight walk from `from` (at t0) to `to` (at t1), clamped outside [t0, t1]. */
export function walkAt(from: Vec2, to: Vec2, t0: number, t1: number, t: number): Vec2 {
  if (!(t1 > t0) || t >= t1) return { x: to.x, z: to.z };
  if (t <= t0) return { x: from.x, z: from.z };
  const k = (t - t0) / (t1 - t0);
  return { x: from.x + (to.x - from.x) * k, z: from.z + (to.z - from.z) * k };
}

/** Most figures drawn per stop / platform: longer queues compress to the head of the line (the HUD marker shows
 *  the full count), so crowds stay readable and never spill onto roads. Each drawn figure is one sim rider. */
export const QUEUE_VISIBLE = 24;

/** Whether a waiting rider at queue slot `slot` (0 = head) is drawn. */
export function queueVisible(slot: number | undefined): boolean {
  return (slot ?? 0) < QUEUE_VISIBLE;
}

/** Deterministic per-person value in [-1, 1). */
export function personJitter(id: number): number {
  let h = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return ((h >>> 0) / 0x100000000) * 2 - 1;
}

/**
 * `walkAt` plus a per-person sideways offset (up to `width` either side) so a crowd leaving one door walks as a
 * band, not single file. The offset ramps in/out over the first/last `ramp` units, so walks still start at the
 * door and end exactly at the stop.
 */
export function crowdWalkAt(from: Vec2, to: Vec2, t0: number, t1: number, t: number, id: number, width = 0.55, ramp = 1.2): Vec2 {
  const p = walkAt(from, to, t0, t1, t);
  const dx = to.x - from.x, dz = to.z - from.z;
  const L = Math.sqrt(dx * dx + dz * dz);
  if (!(t1 > t0) || L < 1e-6 || t <= t0 || t >= t1) return p;
  const k = (t - t0) / (t1 - t0);
  const w = Math.max(0, Math.min(1, (k * L) / ramp, ((1 - k) * L) / ramp));
  const off = personJitter(id) * width * w;
  // left of travel = (dz, -dx) / L
  return { x: p.x + (dz / L) * off, z: p.z - (dx / L) * off };
}

export interface QueueSlotOptions {
  /** Distance between people along the line. */
  spacing?: number;
  /** People per line before a parallel line starts. */
  perRow?: number;
  /** Distance between parallel lines. */
  rowGap?: number;
  /** Distance of slot 0 from the stop point along queueDir. */
  offset?: number;
  /** Where extra lines go, facing along queueDir: 1 = left (default), -1 = right, 0 = alternate left/right. */
  side?: 1 | -1 | 0;
}

/** Bus stops: lines grow away from the road; extra lines go left (away from the stop's route sign). */
export const STOP_QUEUE: Required<QueueSlotOptions> = { spacing: 0.42, perRow: 8, rowGap: 0.46, offset: 0.9, side: 1 };
/** Platforms: one long line along the platform toward its centre, extra lines on alternate sides. */
export const PLATFORM_QUEUE: Required<QueueSlotOptions> = { spacing: 0.42, perRow: 14, rowGap: 0.46, offset: 0.9, side: 0 };

/** World position of queue slot `slot` (0 = head) for a queue at `p` growing along `dir`. */
export function queueSlot(p: Vec2, dir: Vec2, slot: number, o: QueueSlotOptions = {}): Vec2 {
  const spacing = o.spacing ?? STOP_QUEUE.spacing;
  const perRow = Math.max(1, Math.floor(o.perRow ?? STOP_QUEUE.perRow));
  const rowGap = o.rowGap ?? STOP_QUEUE.rowGap;
  const offset = o.offset ?? STOP_QUEUE.offset;
  const side = o.side ?? STOP_QUEUE.side;
  const len = Math.sqrt(dir.x * dir.x + dir.z * dir.z) || 1;
  const dx = dir.x / len, dz = dir.z / len;
  const i = Math.max(0, Math.floor(slot));
  const row = Math.floor(i / perRow), col = i % perRow;
  const along = offset + col * spacing;
  let across: number;
  if (side === 0) across = row === 0 ? 0 : (row % 2 === 1 ? 1 : -1) * Math.ceil(row / 2) * rowGap;
  else across = side * row * rowGap;
  // left of dir (facing along it) = (dz, -dx)
  return { x: p.x + dx * along + dz * across, z: p.z + dz * along - dx * across };
}

/** Exponential ease of a rendered position toward its target; snaps when farther than `snap`. */
export function approach(cur: Vec2, target: Vec2, dtS: number, rate: number, snap: number): Vec2 {
  const dx = target.x - cur.x, dz = target.z - cur.z;
  if (dx * dx + dz * dz > snap * snap) return { x: target.x, z: target.z };
  const k = 1 - Math.exp(-Math.max(0, dtS) * rate);
  return { x: cur.x + dx * k, z: cur.z + dz * k };
}

/** Lateral distance of the queue line from the kit stop's centre (the shelter is 2.4 wide, its posts at ±1.0). */
export const STOP_SHELTER_SHIFT = 1.45;
/** Depth of the kit stop platform from its centre to its kerb edge (1.8 deep) + the gap between stop.p and the road edge. */
const STOP_KERB_IN = 0.95;

/**
 * Where the kit stop model goes for a stop at `p` whose queue grows along `dir`: its kerb edge on the road edge,
 * local +z (the road side) facing back toward the road, and shifted sideways so the queue line runs beside the
 * shelter (queue rows go the other way, see STOP_QUEUE.side).
 */
export function stopFrame(p: Vec2, dir: Vec2): { x: number; z: number; rot: number } {
  const len = Math.sqrt(dir.x * dir.x + dir.z * dir.z) || 1;
  const dx = dir.x / len, dz = dir.z / len;
  const rot = Math.atan2(-dx, -dz);
  // model local +x = (cos rot, −sin rot) = (−dz, dx); the line sits at local x = −STOP_SHELTER_SHIFT
  return { x: p.x + dx * STOP_KERB_IN - dz * STOP_SHELTER_SHIFT, z: p.z + dz * STOP_KERB_IN + dx * STOP_SHELTER_SHIFT, rot };
}

/** Small deterministic hash of a string → uint32 (renderer-local; never used by the sim). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
