// Owner: A3. res.house — a gabled clapboard cottage with chimney, porch and a stepping-stone path (2.5 × 2.5).
// Params (all optional, otherwise seeded per placement): wall (siding idx 0-3), roof (idx 0-2),
// style ('side' gable eaves to the street | 'front' gable end to the street), porch ('left' | 'right').
import * as THREE from 'three';
import type { AssetParams } from '../../types';
import { at, big, box, bush, cyl, doorUnit, gable, type K, onFace, pick, soft, windowUnit } from './parts';

const num = (v: unknown, d: number): number => (typeof v === 'number' ? v : d);

export function house(k: K, p: AssetParams): THREE.Group {
  const r = Array.from({ length: 8 }, () => k.rand());
  const wall = num(p.wall, pick(r[0]!, 4));
  const roof = num(p.roof, pick(r[1]!, 3));
  const frontGable = p.style === 'front' || (p.style !== 'side' && r[2]! < 0.45);
  const side = p.porch === 'left' ? -1 : p.porch === 'right' ? 1 : r[3]! < 0.5 ? -1 : 1;
  const acc = pick(r[4]!, 4);
  const lit = (i: number) => ((r[5]! * 997 + i * 0.37) % 1) < 0.4;

  const g = new THREE.Group();
  const w = 2.0, d = 1.5, h = 1.3, cz = -0.32, fz = cz + d / 2;
  // Body on a low stone foundation.
  g.add(at(big(k, w, h - 0.1, d, 0.06, 'resSiding', wall), 0, 0.1 + (h - 0.1) / 2, cz));
  g.add(at(soft(k, w + 0.06, 0.14, d + 0.06, 0.03, 'resStone'), 0, 0.07, cz));
  g.add(k.detail(at(box(k, w + 0.04, 0.06, d + 0.04, 'resTrim'), 0, h - 0.03, cz)));

  // Roof + chimney.
  if (frontGable) {
    gable(k, g, { w, d, y: h, z: cz, rise: 0.92, ridge: 'z', roofIdx: roof, endRole: 'resSiding', endIdx: wall, over: 0.14, bigSlabs: true });
    const ox = new THREE.Group(); // round attic window in the street-facing gable
    const ring = cyl(k, 0.19, 0.19, 0.04, 'resFrame', 0, 12); ring.rotation.x = Math.PI / 2; ox.add(at(ring, 0, 0, 0.02));
    const pane = cyl(k, 0.14, 0.14, 0.04, 'window', lit(9) ? 1 : 0, 12); pane.rotation.x = Math.PI / 2; ox.add(at(pane, 0, 0, 0.035));
    g.add(k.detail(at(ox, 0, h + 0.34, fz)));
    g.add(at(soft(k, 0.26, 0.95, 0.26, 0.04, 'brick'), -side * 0.55, h + 0.38, cz - 0.3));
    g.add(k.detail(at(box(k, 0.32, 0.05, 0.32, 'resStone'), -side * 0.55, h + 0.88, cz - 0.3)));
  } else {
    gable(k, g, { w, d, y: h, z: cz, rise: 0.86, ridge: 'x', roofIdx: roof, endRole: 'resSiding', endIdx: wall, over: 0.15, bigSlabs: true });
    for (const f of ['left', 'right'] as const) g.add(onFace(windowUnit(k, 0.3, 0.3, lit(f === 'left' ? 7 : 8), { sill: false }), f, w, d, 0, h + 0.3, 0, cz));
    g.add(at(soft(k, 0.26, 1.0, 0.26, 0.04, 'brick'), -side * 0.58, h + 0.5, cz - 0.28));
    g.add(k.detail(at(box(k, 0.32, 0.05, 0.32, 'resStone'), -side * 0.58, h + 1.02, cz - 0.28)));
  }

  // Porch on the door side: deck, two posts, a little roof, steps.
  const px = side * 0.44, deckH = 0.14, pd = 0.6;
  g.add(at(soft(k, 1.16, deckH, pd, 0.03, 'resWood', 0), px, deckH / 2, fz + pd / 2));
  for (const s of [-1, 1]) g.add(at(cyl(k, 0.04, 0.045, 0.98, 'resFrame', 0, 8), px + s * 0.5, deckH + 0.49, fz + pd - 0.07));
  const proof = soft(k, 1.3, 0.07, 0.76, 0.025, 'roof', roof);
  proof.rotation.x = 0.2;
  g.add(at(proof, px, deckH + 1.07, fz + 0.36));
  g.add(k.detail(at(box(k, 0.04, 0.05, pd - 0.1, 'resFrame'), px + side * 0.5, 0.52, fz + pd / 2 - 0.02)));
  g.add(k.detail(at(box(k, 0.04, 0.05, pd - 0.1, 'resFrame'), px + side * 0.5, 0.32, fz + pd / 2 - 0.02)));
  g.add(at(box(k, 0.62, 0.07, 0.22, 'resStone'), px, 0.035, fz + pd + 0.11));
  g.add(onFace(doorUnit(k, { w: 0.48, h: 0.92, role: 'resAccent', idx: acc, step: false, lamp: true }), 'front', w, d, px, deckH, 0, cz));

  // Windows: front (with shutters or flowers), sides, back.
  const shut = r[6]! < 0.55;
  g.add(onFace(windowUnit(k, 0.46, 0.5, lit(0), shut ? { shutters: acc } : { flowers: pick(r[7]!, 4) }), 'front', w, d, -side * 0.5, 0.74, 0, cz));
  for (const f of ['left', 'right'] as const) g.add(onFace(windowUnit(k, 0.46, 0.46, lit(f === 'left' ? 1 : 2)), f, w, d, 0, 0.72, 0, cz));
  for (const [i, u] of [-0.5, 0.5].entries()) g.add(onFace(windowUnit(k, 0.46, 0.46, lit(3 + i)), 'back', w, d, u, 0.72, 0, cz));

  // Front garden: bushes by the window side.
  g.add(bush(k, 0.24, 0, -side * 0.82, fz + 0.3));
  g.add(bush(k, 0.17, 2, -side * 0.42, fz + 0.36));
  g.add(bush(k, 0.16, 1, side * 0.98, fz + 0.18));
  return g;
}
