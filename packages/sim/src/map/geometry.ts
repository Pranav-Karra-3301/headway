// Owner: Task M. Polyline helpers. Stub until filled.
import type { Polyline, Vec2 } from '../contracts';
function ni(what: string): never {
  throw new Error(`not implemented yet: ${what}`);
}

export function polyline(points: Vec2[], closed: boolean): Polyline { return ni(`geometry.polyline ${points.length} ${closed}`); }
export function pointAt(poly: Polyline, dist: number): { x: number; z: number; heading: number } { return ni(`geometry.pointAt ${poly.length} ${dist}`); }
export function nearestDist(poly: Polyline, p: Vec2): number { return ni(`geometry.nearestDist ${poly.length} ${p.x}`); }
export function roundCorners(points: Vec2[], radius: number, closed: boolean, segments?: number): Vec2[] { return ni(`geometry.roundCorners ${points.length} ${radius} ${closed} ${segments}`); }
export function distance(a: Vec2, b: Vec2): number { return Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2); }
