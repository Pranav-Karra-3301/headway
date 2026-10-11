// Owner: A3. res.tower — a 5–7 storey apartment tower (3.5 × 3.5): glazed lobby under a canopy, two stacks
// of coloured balconies on the front, floor bands, a parapet roof with a lift hut and a wooden water tank.
// Params: floors (5-7), wall (idx), accent (idx).
import * as THREE from 'three';
import type { AssetParams } from '../../types';
import { at, big, box, cyl, doorUnit, type K, onFace, pick, soft, windowUnit } from './parts';

const num = (v: unknown, d: number): number => (typeof v === 'number' ? v : d);

export function tower(k: K, p: AssetParams): THREE.Group {
  const r = Array.from({ length: 6 }, () => k.rand());
  const floors = Math.max(5, Math.min(7, Math.round(num(p.floors, 5 + pick(r[0]!, 3)))));
  const wall = num(p.wall, pick(r[1]!, 3));
  const acc = num(p.accent, pick(r[2]!, 4));
  const tankSide = r[3]! < 0.5 ? -1 : 1;
  const roof = num(p.roof, [0, 1, 2, 2][acc % 4]!); // roof-coloured lid that matches the balconies
  const lit = (i: number) => ((r[4]! * 977 + i * 0.23) % 1) < 0.38;

  const g = new THREE.Group();
  const w = 3.0, d = 3.0, cz = -0.22, fz = cz + d / 2, g0 = 1.35, fh = 1.05, H = g0 + (floors - 1) * fh;
  // Stone ground storey, painted upper storeys.
  const gw = w + 0.08, gd = d + 0.08, gz = cz + gd / 2;
  g.add(at(soft(k, gw, g0, gd, 0.05, 'resStone'), 0, g0 / 2, cz));
  g.add(at(big(k, w, H - g0 + 0.02, d, 0.12, 'wall', wall), 0, g0 - 0.02 + (H - g0 + 0.02) / 2, cz));
  for (let f = 1; f < floors; f++) g.add(k.detail(at(box(k, w + 0.04, 0.05, d + 0.04, 'resTrim'), 0, g0 + (f - 1) * fh, cz)));
  // Parapet roof, lift hut, water tank.
  g.add(at(box(k, w + 0.06, 0.08, d + 0.06, 'resTrim'), 0, H - 0.02, cz));
  g.add(at(soft(k, w + 0.2, 0.24, d + 0.2, 0.06, 'roof', roof), 0, H + 0.12, cz));
  g.add(at(box(k, w - 0.1, 0.03, d - 0.1, 'resStone'), 0, H + 0.25, cz));
  const top = H + 0.24;
  g.add(at(soft(k, 1.05, 0.52, 0.85, 0.05, 'wall', wall), -tankSide * 0.62, top + 0.26, cz - 0.55));
  g.add(at(box(k, 1.15, 0.06, 0.95, 'roof', roof), -tankSide * 0.62, top + 0.55, cz - 0.55));
  g.add(k.detail(at(box(k, 0.5, 0.26, 0.36, 'resMetal'), tankSide * 0.55, top + 0.13, cz + 0.75)));
  g.add(k.detail(at(cyl(k, 0.07, 0.07, 0.34, 'resMetal', 0, 6), -tankSide * 0.85, top + 0.17, cz + 0.55)));
  g.add(k.detail(at(box(k, 0.36, 0.42, 0.04, 'door'), -tankSide * 0.62, top + 0.21, cz - 0.55 + 0.43)));
  const tx = tankSide * 0.72, tz = cz - 0.5;
  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) g.add(at(box(k, 0.05, 0.18, 0.05, 'resWood', 1), tx + sx * 0.2, top + 0.09, tz + sz * 0.2));
  g.add(at(cyl(k, 0.31, 0.31, 0.4, 'resWood', 0, 10), tx, top + 0.38, tz));
  g.add(at(k.cone(0.36, 0.16, k.mat('resWood', 1), 10), tx, top + 0.66, tz));

  // Ground floor: glazed lobby + canopy on the front, windows around.
  g.add(onFace(doorUnit(k, { w: 0.72, h: 1.0, role: 'window', idx: 1, step: false }), 'front', gw, gd, 0, 0.1, 0, cz));
  for (const s of [-1, 1]) g.add(onFace(windowUnit(k, 0.34, 0.86, true, { sill: false, mullion: false }), 'front', gw, gd, s * 0.62, 0.56, 0, cz));
  g.add(at(soft(k, 1.9, 0.08, 0.58, 0.035, 'resAccent', acc), 0, 1.24, gz + 0.28));
  g.add(at(box(k, 1.4, 0.07, 0.36, 'resStone'), 0, 0.035, gz + 0.18));
  for (const f of ['left', 'right', 'back'] as const) for (const u of [-0.75, 0.75]) g.add(onFace(windowUnit(k, 0.6, 0.54, lit(u + (f === 'back' ? 3 : f === 'left' ? 5 : 7)), { sill: false }), f, gw, gd, u, 0.7, 0, cz));

  // Upper floors: balconies on the front, two windows on every other face.
  for (let f = 1; f < floors; f++) {
    const y0 = g0 + (f - 1) * fh;
    for (const s of [-1, 1]) {
      const b = new THREE.Group();
      b.add(at(box(k, 1.02, 0.07, 0.44, 'resStone'), 0, 0.035, 0.22));
      b.add(at(box(k, 1.02, 0.3, 0.05, 'resAccent', acc), 0, 0.22, 0.415));
      for (const t of [-1, 1]) b.add(at(box(k, 0.05, 0.3, 0.39, 'resAccent', acc), t * 0.485, 0.22, 0.195));
      b.add(at(windowUnit(k, 0.44, 0.78, lit(f * 9 + s), { sill: false, mullion: false }), s * 0.18, 0.46, 0));
      g.add(k.detail(at(b, s * 0.76, y0, fz)));
    }
    for (const fc of ['left', 'right', 'back'] as const) for (const u of [-0.75, 0.75]) {
      g.add(onFace(windowUnit(k, 0.6, 0.52, lit(f * 13 + u + fc.length), { sill: false }), fc, w, d, u, y0 + 0.55, 0, cz));
    }
  }
  return g;
}
