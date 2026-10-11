// Owner: A3. res.townhouses — a row of 3 painted two-storey townhouses with varied roofs (6 × 2.5).
// Each unit: own siding colour and height, a coloured front door on a stoop, window boxes; roofs mix a steep
// front gable, a shallow gable and a flat parapet roof. Params: wall (first siding idx), roof (roof idx).
import * as THREE from 'three';
import type { AssetParams } from '../../types';
import { at, big, box, cyl, doorUnit, gable, type K, onFace, pick, soft, windowUnit } from './parts';

const num = (v: unknown, d: number): number => (typeof v === 'number' ? v : d);
type RoofType = 'steep' | 'low' | 'flat';
const PATTERNS: RoofType[][] = [
  ['steep', 'flat', 'steep'], ['flat', 'steep', 'low'], ['low', 'steep', 'flat'], ['steep', 'low', 'flat'],
];
const HEIGHTS = [[2.2, 2.38, 2.26], [2.32, 2.2, 2.4], [2.26, 2.34, 2.2]];

export function townhouses(k: K, p: AssetParams): THREE.Group {
  const r = Array.from({ length: 8 }, () => k.rand());
  const wall0 = num(p.wall, pick(r[0]!, 4));
  const roof = num(p.roof, pick(r[1]!, 3));
  const pattern = PATTERNS[pick(r[2]!, PATTERNS.length)]!;
  const heights = HEIGHTS[pick(r[3]!, HEIGHTS.length)]!;
  const acc0 = pick(r[4]!, 4), flowerUnit = pick(r[5]!, 3), mirror = r[6]! < 0.5 ? 1 : -1;
  const lit = (i: number) => ((r[7]! * 991 + i * 0.29) % 1) < 0.4;

  const g = new THREE.Group();
  const uw = 2.0, d = 1.9, cz = -0.22, fz = cz + d / 2;
  for (let i = 0; i < 3; i++) {
    const x = -uw + uw * i, h = heights[i]!, type = pattern[i]!;
    const wall = (wall0 + i) % 4, side = (i % 2 ? 1 : -1) * mirror;
    g.add(at(big(k, uw - 0.03, h - 0.12, d, 0.05, 'resSiding', wall), x, 0.12 + (h - 0.12) / 2, cz));
    g.add(at(box(k, uw, 0.12, d + 0.04, 'resStone'), x, 0.06, cz));
    g.add(k.detail(at(box(k, uw + 0.01, 0.05, d + 0.03, 'resTrim'), x, 1.16, cz)));
    // Roof.
    if (type === 'flat') {
      g.add(at(box(k, uw + 0.04, 0.1, d + 0.06, 'resTrim'), x, h + 0.02, cz));
      g.add(at(soft(k, uw, 0.2, d + 0.02, 0.04, 'roof', roof), x, h + 0.17, cz));
      g.add(k.detail(at(soft(k, 0.5, 0.28, 0.4, 0.04, 'brick'), x - side * 0.5, h + 0.4, cz - 0.45)));
    } else {
      const rise = type === 'steep' ? 0.82 : 0.5;
      gable(k, g, { w: uw - 0.03, d, y: h, x, z: cz, rise, ridge: 'z', roofIdx: roof, endRole: 'resSiding', endIdx: wall, over: 0.09 });
      const ow = type === 'steep' ? 0.3 : 0.4, oh = type === 'steep' ? 0.32 : 0.18;
      g.add(onFace(windowUnit(k, ow, oh, lit(10 + i), { sill: false }), 'front', uw, d, x + 0, h + (type === 'steep' ? 0.3 : 0.18), 0, cz));
    }
    // Front: coloured door on a stoop, a ground window, two upper windows (one unit gets window boxes).
    const acc = (acc0 + i) % 4;
    g.add(onFace(doorUnit(k, { w: 0.5, h: 0.94, role: 'resAccent', idx: acc, canopy: { role: 'resTrim' }, step: false, lamp: i === 1 }), 'front', uw, d, x + side * 0.45, 0.12, 0, cz));
    g.add(at(box(k, 0.74, 0.12, 0.3, 'resStone'), x + side * 0.45, 0.06, fz + 0.15));
    g.add(at(box(k, 0.74, 0.06, 0.22, 'resStone'), x + side * 0.45, 0.03, fz + 0.4));
    g.add(onFace(windowUnit(k, 0.62, 0.56, lit(i * 3)), 'front', uw, d, x - side * 0.4, 0.7, 0, cz));
    for (const [j, u] of [-0.45, 0.45].entries()) {
      const box_ = i === flowerUnit ? { flowers: (i + j) % 4 } : {};
      g.add(onFace(windowUnit(k, 0.44, 0.56, lit(i * 3 + 1 + j), box_), 'front', uw, d, x + u, 1.76, 0, cz));
    }
    // Back windows.
    for (const [j, u] of [-0.45, 0.45].entries()) g.add(onFace(windowUnit(k, 0.44, 0.52, lit(20 + i * 2 + j)), 'back', uw, d, -(x + u), 1.74, 0, cz));
    g.add(onFace(windowUnit(k, 0.5, 0.5, lit(30 + i)), 'back', uw, d, -(x - side * 0.3), 0.72, 0, cz));
  }
  // End walls.
  for (const f of ['left', 'right'] as const) for (const y of [0.72, 1.74]) g.add(onFace(windowUnit(k, 0.44, 0.5, lit(y > 1 ? 40 : 41)), f, 3 * uw, d, 0, y, 0, cz));
  // A tiny front-yard tree pit planter on the end units' outer side.
  for (const s of [-1, 1]) {
    g.add(k.detail(at(box(k, 0.36, 0.16, 0.36, 'resStone'), s * 2.72, 0.08, fz + 0.32)));
    g.add(k.detail(at(cyl(k, 0.15, 0.15, 0.08, 'leaf', 1, 8), s * 2.72, 0.2, fz + 0.32)));
  }
  return g;
}
