// Owner: A3. res.playground (4 × 3): soft rubber pad with timber edging, an A-frame swing set, a slide tower
// with a pointed roof and ladder, a sandbox with a mound and bucket, and a spring rider.
import * as THREE from 'three';
import type { AssetParams } from '../../types';
import { at, ball, big, box, cyl, type K, pick, soft } from './parts';

export function playground(k: K, _p: AssetParams): THREE.Group {
  const r = Array.from({ length: 3 }, () => k.rand());
  const a0 = pick(r[0]!, 4), mirror = r[1]! < 0.5 ? 1 : -1;
  const acc = (i: number) => (a0 + i) % 4;
  const g = new THREE.Group();
  const W = 4, D = 3;
  g.add(at(big(k, W - 0.1, 0.06, D - 0.1, 0.03, 'resPad'), 0, 0.03, 0));
  for (const s of [-1, 1]) {
    g.add(at(box(k, W, 0.1, 0.08, 'resWood', 0), 0, 0.05, s * (D / 2 - 0.04)));
    g.add(at(box(k, 0.08, 0.1, D - 0.16, 'resWood', 0), s * (W / 2 - 0.04), 0.05, 0));
  }
  // Equipment layout mirrors in x per placement (positions only, so no negative scales reach the composer).
  const play = { add: (o: THREE.Object3D) => { o.position.x *= mirror; g.add(o); } };

  // Swing set (back left): A-frames, top bar, two swings.
  const sz = -0.62, top = 1.1, spread = 0.38, lean = Math.atan2(spread, top - 0.06), legL = Math.hypot(spread, top - 0.06);
  const bar = cyl(k, 0.04, 0.04, 1.86, 'resAccent', acc(1), 8); bar.rotation.z = Math.PI / 2;
  play.add(at(bar, -0.86, top, sz));
  for (const x of [-1.76, 0.04]) for (const s of [-1, 1]) {
    const leg = cyl(k, 0.035, 0.035, legL, 'resAccent', acc(1), 6);
    leg.rotation.x = -s * lean;
    play.add(at(leg, x, 0.06 + (top - 0.06) / 2, sz + s * spread / 2));
  }
  for (const x of [-1.3, -0.42]) {
    play.add(at(box(k, 0.34, 0.04, 0.16, 'resAccent', acc(0)), x, 0.36, sz));
    for (const s of [-1, 1]) play.add(k.detail(at(box(k, 0.018, top - 0.38, 0.018, 'resMetal'), x + s * 0.14, (top + 0.38) / 2, sz)));
  }

  // Slide tower (back right): posts, deck, pyramid roof, ladder, chute.
  const tx = 1.18, tzc = -0.6, deckY = 0.62;
  for (const sx of [-1, 1]) for (const s of [-1, 1]) play.add(at(cyl(k, 0.035, 0.035, 1.04, 'resFrame', 0, 6), tx + sx * 0.3, 0.06 + 0.52, tzc + s * 0.3));
  play.add(at(box(k, 0.72, 0.07, 0.72, 'resWood', 1), tx, deckY, tzc));
  const roof = k.cone(0.56, 0.34, k.mat('resAccent', acc(0)), 4); roof.rotation.y = Math.PI / 4;
  play.add(at(roof, tx, 1.1 + 0.17, tzc));
  for (const sx of [-1, 1]) play.add(k.detail(at(box(k, 0.04, 0.2, 0.62, 'resAccent', acc(1)), tx + sx * 0.3, deckY + 0.14, tzc)));
  for (const sx of [-1, 1]) play.add(at(box(k, 0.04, 0.74, 0.04, 'resWood', 1), tx + sx * 0.17, 0.06 + 0.37, tzc - 0.42));
  for (const y of [0.22, 0.4, 0.58]) play.add(k.detail(at(box(k, 0.34, 0.03, 0.03, 'resWood', 1), tx, y, tzc - 0.42)));
  const run = 1.2, drop = deckY - 0.14, ang = Math.atan2(drop, run), len = Math.hypot(drop, run);
  const chute = new THREE.Group();
  chute.add(soft(k, 0.38, 0.05, len, 0.02, 'resAccent', acc(2)));
  for (const s of [-1, 1]) chute.add(k.detail(at(box(k, 0.035, 0.09, len, 'resAccent', acc(2)), s * 0.19, 0.045, 0)));
  chute.rotation.x = ang;
  play.add(at(chute, tx, (deckY + 0.14) / 2 + 0.03, tzc + 0.36 + run / 2));
  play.add(at(box(k, 0.38, 0.05, 0.24, 'resAccent', acc(2)), tx, 0.12, tzc + 0.36 + run + 0.1));

  // Sandbox (front left): timber frame, sand, a mound, a bucket.
  const bx = -0.95, bz = 0.72;
  for (const s of [-1, 1]) {
    play.add(at(box(k, 1.42, 0.14, 0.1, 'resWood', 0), bx, 0.11, bz + s * 0.45));
    play.add(at(box(k, 0.1, 0.14, 0.8, 'resWood', 0), bx + s * 0.66, 0.11, bz));
  }
  play.add(at(box(k, 1.22, 0.08, 0.8, 'resSand'), bx, 0.1, bz));
  const mound = ball(k, 0.26, 'resSand', 0, 8); mound.scale.y = 0.45;
  play.add(k.detail(at(mound, bx + 0.22, 0.14, bz - 0.05)));
  play.add(k.detail(at(cyl(k, 0.075, 0.055, 0.13, 'resAccent', acc(3), 8), bx - 0.3, 0.205, bz + 0.12)));

  // Spring rider (front middle): a chunky little duck on a spring.
  const rx = 0.28, rz = 0.78;
  play.add(at(cyl(k, 0.045, 0.045, 0.22, 'resMetal', 0, 6), rx, 0.17, rz));
  play.add(at(soft(k, 0.4, 0.2, 0.18, 0.07, 'resAccent', acc(3)), rx, 0.37, rz));
  play.add(at(ball(k, 0.1, 'resAccent', acc(3), 8), rx + 0.17, 0.52, rz));
  play.add(k.detail(at(box(k, 0.08, 0.04, 0.06, 'resBrass'), rx + 0.28, 0.52, rz)));
  return g;
}
