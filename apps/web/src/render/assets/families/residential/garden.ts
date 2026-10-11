// Owner: A3. res.garden — a 3-storey garden-apartment walk-up (6 × 3.5): central entrance with stair windows,
// stacked balconies on the outer bays, ground-floor patios behind low hedges, a gable roof.
// Params: scheme ('brick' | 'painted'), roof (idx), accent (idx).
import * as THREE from 'three';
import type { AssetParams } from '../../types';
import { at, big, box, doorUnit, gable, type K, onFace, pick, sidingsFor, soft, windowUnit } from './parts';

const num = (v: unknown, d: number): number => (typeof v === 'number' ? v : d);

/** Balcony facing +z, floor at y = 0, back flush with z = 0: slab, solid front + side panels, a door behind. */
function balcony(k: K, bw: number, bd: number, panel: [string, number], lit: boolean): THREE.Group {
  const g = new THREE.Group();
  g.add(at(box(k, bw, 0.08, bd, 'resStone'), 0, 0.04, bd / 2));
  g.add(at(box(k, bw, 0.32, 0.05, panel[0], panel[1]), 0, 0.24, bd - 0.025));
  for (const s of [-1, 1]) g.add(at(box(k, 0.05, 0.32, bd - 0.05, panel[0], panel[1]), s * (bw / 2 - 0.025), 0.24, (bd - 0.05) / 2));
  g.add(at(box(k, bw + 0.04, 0.05, 0.08, 'resFrame'), 0, 0.42, bd - 0.03));
  const door = windowUnit(k, 0.46, 0.8, lit, { sill: false, mullion: false });
  g.add(at(door, -bw * 0.18, 0.48, 0));
  return k.detail(g);
}

export function garden(k: K, p: AssetParams): THREE.Group {
  const r = Array.from({ length: 6 }, () => k.rand());
  const painted = p.scheme === 'painted' || (p.scheme !== 'brick' && r[0]! < 0.5);
  const roof = num(p.roof, pick(r[1]!, 3));
  const acc = num(p.accent, pick(r[2]!, 4));
  const ok = sidingsFor(roof), tone = ok[pick(r[3]!, ok.length)]!;
  const lit = (i: number) => ((r[4]! * 983 + i * 0.31) % 1) < 0.4;
  const body: [string, number] = painted ? ['resSiding', tone] : ['brick', tone % 2];
  // Brick → white balconies; cream → accent balconies; pastel → white balconies.
  const panel: [string, number] = painted && tone === 0 ? ['resAccent', acc] : ['resFrame', 0];

  const g = new THREE.Group();
  const w = 5.6, d = 2.5, cz = -0.25, fz = cz + d / 2, g0 = 1.15, fh = 1.1, H = g0 + 2 * fh;
  g.add(at(big(k, w, H - 0.12, d, 0.08, body[0], body[1]), 0, 0.12 + (H - 0.12) / 2, cz));
  g.add(at(soft(k, w + 0.06, 0.14, d + 0.06, 0.03, 'resStone'), 0, 0.07, cz));
  for (const y of [g0, g0 + fh]) g.add(k.detail(at(box(k, w + 0.04, 0.06, d + 0.04, 'resTrim'), 0, y, cz)));
  g.add(at(box(k, w + 0.06, 0.1, d + 0.06, 'resTrim'), 0, H - 0.02, cz));
  gable(k, g, { w, d, y: H, z: cz, rise: 0.66, ridge: 'x', roofIdx: roof, endRole: body[0], endIdx: body[1], over: 0.18, bigSlabs: true });
  for (const s of [-1, 1]) {
    g.add(at(soft(k, 0.3, 0.6, 0.34, 0.04, 'brick', 1), s * 1.55, H + 0.66, cz - 0.2));
    g.add(k.detail(at(box(k, 0.36, 0.05, 0.4, 'resStone'), s * 1.55, H + 0.98, cz - 0.2)));
  }

  // Front: entrance + stair windows in the middle, windows either side, balconies/patios on the outer bays.
  g.add(onFace(doorUnit(k, { w: 0.62, h: 1.0, role: 'resAccent', idx: acc, step: false, lamp: true }), 'front', w, d, 0, 0.14, 0, cz));
  g.add(at(soft(k, 1.0, 0.08, 0.5, 0.03, 'resAccent', acc), 0, 1.33, fz + 0.24));
  g.add(at(box(k, 1.0, 0.07, 0.34, 'resStone'), 0, 0.105, fz + 0.17));
  g.add(at(box(k, 1.0, 0.07, 0.24, 'resStone'), 0, 0.035, fz + 0.43));
  for (const [i, y] of [1.82, 2.92].entries()) g.add(onFace(windowUnit(k, 0.36, 0.62, lit(i), { sill: false }), 'front', w, d, 0, y, 0, cz));
  for (let f = 0; f < 3; f++) for (const s of [-1, 1]) {
    const y = f === 0 ? 0.7 : g0 + (f - 1) * fh + 0.58;
    g.add(onFace(windowUnit(k, 0.62, 0.56, lit(2 + f * 2 + (s + 1) / 2)), 'front', w, d, s * 0.98, y, 0, cz));
  }
  for (const s of [-1, 1]) {
    for (let f = 1; f < 3; f++) g.add(at(balcony(k, 1.24, 0.5, panel, lit(10 + f + s)), s * 2.02, g0 + (f - 1) * fh, fz));
    // Ground-floor patio: paving, a glass door, a low hedge.
    g.add(k.detail(at(box(k, 1.3, 0.04, 0.5, 'resStone'), s * 2.02, 0.02, fz + 0.25)));
    g.add(onFace(windowUnit(k, 0.5, 0.82, lit(14 + s), { sill: false, mullion: false }), 'front', w, d, s * 2.02 - 0.22, 0.6, 0, cz));
    g.add(at(soft(k, 1.3, 0.32, 0.26, 0.06, 'resHedge'), s * 2.02, 0.16, fz + 0.58));
  }
  // Back and side windows.
  for (let f = 0; f < 3; f++) {
    const y = f === 0 ? 0.7 : g0 + (f - 1) * fh + 0.58;
    for (const [i, u] of [-2.0, -0.75, 0.75, 2.0].entries()) g.add(onFace(windowUnit(k, 0.56, 0.54, lit(20 + f * 4 + i), { sill: false }), 'back', w, d, u, y, 0, cz));
    for (const fc of ['left', 'right'] as const) g.add(onFace(windowUnit(k, 0.56, 0.54, lit(40 + f + fc.length)), fc, w, d, 0, y, 0, cz));
  }
  return g;
}
