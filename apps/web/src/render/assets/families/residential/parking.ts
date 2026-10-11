// Owner: A3. res.parking (6 × 4): a surface lot with five painted stalls along the back, wheel stops, planted
// end islands, a front hedge with a driveway gap, and a few parked cars (nose in).
// Params: cars (0-5, default 2-4 seeded per placement).
import * as THREE from 'three';
import type { AssetParams } from '../../types';
import { at, big, box, bush, cyl, type K, named, pick, soft } from './parts';

/** Parked car, +x forward, wheels on y = 0, ~1.56 × 0.8 × 0.62. Hatchback or sedan. */
function car(k: K, colour: number, sedan: boolean): THREE.Group {
  const g = new THREE.Group();
  g.add(at(soft(k, 1.56, 0.26, 0.8, 0.08, 'car', colour), 0, 0.23, 0));
  const cx = sedan ? -0.06 : -0.2, cl = sedan ? 0.84 : 0.98;
  g.add(at(soft(k, cl, 0.23, 0.7, 0.07, 'window', 0), cx, 0.465, 0));
  g.add(at(box(k, cl - 0.06, 0.05, 0.72, 'car', colour), cx, 0.595, 0));
  for (const x of [-0.5, 0.5]) for (const s of [-1, 1]) {
    const w = cyl(k, 0.11, 0.11, 0.1, 'resTire', 0, 6);
    w.rotation.x = Math.PI / 2;
    g.add(at(w, x, 0.11, s * 0.36));
  }
  for (const s of [-1, 1]) g.add(k.detail(at(box(k, 0.02, 0.06, 0.14, 'resTrim'), 0.785, 0.27, s * 0.26)));
  return named(g, 'car');
}

export function parking(k: K, p: AssetParams): THREE.Group {
  const r = Array.from({ length: 4 }, () => k.rand());
  const n = typeof p.cars === 'number' ? Math.max(0, Math.min(5, Math.round(p.cars))) : 2 + pick(r[0]!, 3);
  const g = new THREE.Group();
  const W = 6, D = 4, stall = 1.04, x0 = -2.5 * stall, sz = -1.0;
  g.add(at(big(k, W, 0.06, D, 0.03, 'resLot'), 0, 0.03, 0));
  // Stall lines + wheel stops along the back.
  for (let i = 0; i <= 5; i++) g.add(at(box(k, 0.05, 0.012, 1.72, 'mark'), x0 + i * stall, 0.066, sz - 0.04));
  g.add(at(box(k, 5 * stall + 0.05, 0.012, 0.05, 'mark'), 0, 0.066, sz + 0.84));
  for (let i = 0; i < 5; i++) g.add(k.detail(at(box(k, 0.5, 0.05, 0.08, 'resStone'), x0 + (i + 0.5) * stall, 0.085, sz - 0.74)));
  // Planted end islands and a back kerb.
  for (const s of [-1, 1]) {
    g.add(at(box(k, 0.36, 0.12, 1.86, 'resStone'), s * 2.8, 0.06, sz - 0.04));
    g.add(at(box(k, 0.28, 0.02, 1.78, 'lawn'), s * 2.8, 0.125, sz - 0.04));
    g.add(bush(k, 0.24, 0, s * 2.8, sz - 0.5, 0.13));
    g.add(bush(k, 0.17, 2, s * 2.8, sz + 0.25, 0.13));
  }
  g.add(at(box(k, 5 * stall, 0.1, 0.1, 'resStone'), 0, 0.05, -D / 2 + 0.06));
  // Front hedge with a driveway gap in the middle.
  for (const s of [-1, 1]) g.add(at(soft(k, 1.9, 0.3, 0.24, 0.08, 'leaf', 2), s * 1.95, 0.15 + 0.03, D / 2 - 0.16));
  // Parked cars in seeded stalls, nose in (car +x → -z).
  const order = [0, 1, 2, 3, 4].sort((a, b) => ((a * 7 + r[1]! * 13) % 5) - ((b * 7 + r[1]! * 13) % 5));
  for (let i = 0; i < n; i++) {
    const s = order[i]!;
    const c = car(k, pick((r[2]! + i * 0.37) % 1, 6), ((r[3]! + i * 0.53) % 1) < 0.5);
    c.rotation.y = Math.PI / 2;
    g.add(at(c, x0 + (s + 0.5) * stall + (((r[3]! * 10 + i * 0.618) % 1) - 0.5) * 0.08, 0.06, sz - 0.06));
  }
  return g;
}
