// Owner: S1. Dev-only demo paths/areas for the streetscape preview while the district files are stubs.
// Placed around the base SCENERY so nothing collides: campus quad with criss-cross paths, a stadium forecourt
// plaza, a lot beside the stadium, a pitch north of West Halls, and a few gardens.
import type { Vec2 } from '@headway/sim';
import type { DistrictScenery } from '../districts/types';

const rect = (x0: number, z0: number, x1: number, z1: number): Vec2[] =>
  [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
const P = (...xz: number[]): Vec2[] => xz.reduce<Vec2[]>((a, v, i) => (i % 2 ? (a[a.length - 1]!.z = v, a) : [...a, { x: v, z: 0 }]), []);

export const DEMO: DistrictScenery = {
  id: 'outskirts',
  region: { center: { x: 0, z: 0 }, radius: 0 },
  items: [],
  paths: [
    // campus quad: Old Main stop → clock tower, two diagonals, a spur to the North Rd sidewalk
    { kind: 'footpath', width: 1.0, points: P(-10.5, -1.9, -10.5, -7.7) },
    { kind: 'footpath', width: 0.75, points: P(-12.9, -2.4, -8.1, -7.4) },
    { kind: 'footpath', width: 0.75, points: P(-8.1, -2.4, -12.9, -7.4) },
    { kind: 'footpath', width: 0.8, points: P(-10.5, -10.3, -10.5, -12.8) },
    { kind: 'footpath', width: 0.7, points: P(-12.9, -10.9, -11.6, -10.3, -9.4, -10.3, -8.1, -10.9) },
    // pitch → North Rd
    { kind: 'footpath', width: 0.7, points: P(-21.9, -16.4, -21.9, -14.6 + 1.8) },
    // stadium forecourt ring
    { kind: 'plaza-edge', width: 0.35, points: P(-8.2, 4.6, -4.6, 4.6, -4.6, 10.2, -8.2, 10.2, -8.2, 4.6) },
  ],
  areas: [
    { kind: 'lawn', polygon: rect(-13.0, -7.5, -8.0, -2.5) },
    { kind: 'lawn', polygon: rect(-13.0, -12.2, -8.0, -10.6) },
    { kind: 'plaza', polygon: rect(-8.2, 4.6, -4.6, 10.2) },
    { kind: 'parking', polygon: rect(-23.5, 3.6, -19.9, 10.6) },
    { kind: 'sports', polygon: rect(-25.4, -20.4, -18.4, -16.6) },
    { kind: 'garden', polygon: rect(-5.6, -20.2, -3.6, -17.0) },
    { kind: 'garden', polygon: rect(17.0, 9.4, 20.0, 12.0) },
  ],
};
