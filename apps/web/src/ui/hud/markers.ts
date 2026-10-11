// Owner: T3b. Queue-marker anchors (world space) and compact marker text.
import type { QueuePlace, StopId, TownMap } from '@headway/sim';
import { placeName, waitShort } from './format';

export interface MarkerPlace {
  key: string;
  at: QueuePlace;
  name: string;
  /** World anchor (y up), above the shelter / platform canopy. */
  x: number; y: number; z: number;
  /** Stop to select when the marker is clicked (platforms select their paired stop). */
  stopId: StopId | null;
}

export const MARKER_Y = { stop: 2.6, platform: 3.4 } as const;

export const placeKey = (at: QueuePlace): string => `${at.kind}:${at.id}`;

export function markerPlaces(map: TownMap | null): MarkerPlace[] {
  if (!map || !Array.isArray(map.stops)) return [];
  const out: MarkerPlace[] = map.stops.map((s) => {
    const at: QueuePlace = { kind: 'stop', id: s.id };
    return { key: placeKey(at), at, name: placeName(at, map), x: s.p.x, y: MARKER_Y.stop, z: s.p.z, stopId: s.id };
  });
  for (const st of map.rail?.stations ?? []) {
    const at: QueuePlace = { kind: 'platform', id: st.id };
    out.push({ key: placeKey(at), at, name: placeName(at, map), x: st.platform.x, y: MARKER_Y.platform, z: st.platform.z, stopId: st.stopId ?? null });
  }
  return out;
}

export function markerText(q: { count: number; longestWaitS: number }): { count: string; wait: string } {
  return { count: String(Math.max(0, Math.round(q.count))), wait: waitShort(q.longestWaitS) };
}
