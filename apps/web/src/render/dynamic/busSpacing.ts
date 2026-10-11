// Visual bus queueing (render-only, the sim and scores never see it). The sim lets bunched buses share a stop or a
// terminal; on screen the trailing bus waits a bus length behind instead of drawing through the one ahead.
// Shared by the bus renderer (render/dynamic) and ambient traffic (render/traffic), so cars queue behind the bus
// where it is drawn.
import { pointAt } from '@headway/sim';
import type { Polyline } from '@headway/sim';

/** Bumper gap between queued buses. */
export const BUS_GAP = 0.7;
/** Buses further apart sideways than this are on different roads (or opposite lanes). */
const SAME_LANE = 1.0;

export interface BusSlot { id: string; path: Polyline; dist: number }

function wrap(path: Polyline, d: number): number {
  const L = path.length;
  if (!(L > 0)) return 0;
  return path.closed ? ((d % L) + L) % L : Math.min(L, Math.max(0, d));
}

/** Drawn arc distance per bus: a bus closer than `length + BUS_GAP` behind another in its lane (drawn `lane` right of
 *  the path) is moved back along its path. */
export function spaceBuses(slots: readonly BusSlot[], length: number, lane = 0.6): Map<string, number> {
  const out = slots.map((s) => ({ ...s }));
  const need = length + BUS_GAP;
  // drawn centres: right of the path by `lane`
  const at = (s: BusSlot) => {
    const p = pointAt(s.path, s.dist);
    return { x: p.x + Math.sin(p.heading) * lane, z: p.z + Math.cos(p.heading) * lane, heading: p.heading };
  };
  const pts = out.map(at);
  for (let iter = 0; iter < 4; iter++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = pts[i]!, b = pts[j]!;
        const dx = b.x - a.x, dz = b.z - a.z;
        if (dx * dx + dz * dz >= need * need) continue;
        if (Math.cos(a.heading - b.heading) < 0.5) continue; // opposite lanes or crossing paths
        const ax = Math.cos(a.heading), az = -Math.sin(a.heading);
        const along = dx * ax + dz * az; // b ahead of a when > 0
        if (Math.abs(dx * az - dz * ax) > SAME_LANE) continue;
        const back = along > 1e-3 ? i : along < -1e-3 ? j : out[i]!.id > out[j]!.id ? i : j;
        const push = need - Math.abs(along);
        if (push <= 1e-3) continue;
        const s = out[back]!;
        s.dist = wrap(s.path, s.dist - push);
        pts[back] = at(s);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return new Map(out.map((s) => [s.id, s.dist] as const));
}
