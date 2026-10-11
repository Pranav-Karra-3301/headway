// Owner: A2. cp.chapel: brick nave with a white pedimented front, columned porch, belfry tower and copper spire,
// round apse at the back. 3 × 5 footprint, about 5.5 tall (finial ≈ 6.5), front toward +z.
import * as THREE from 'three';
import type { AssetParams, KitContext } from '../../types';
import { apse, archPanel, at, band, box, door, finial, gableRoof, halfCone, mats, onFace, portico, roundel, sashRow, topiary, type Block, type Mats } from './parts';
import { pick } from './pick';

const BASE = 0.2, EAVE = 2.45, RISE = 1.15;

export function buildChapel(k: KitContext, p: AssetParams): THREE.Group {
  const x = mats(k, pick(p.brick, 3, k), pick(p.roof, 3, k), pick(p.door, 3, k));
  const g = new THREE.Group();
  const nave: Block = { cx: 0, cz: -0.15, w: 2.5, d: 3.2 };
  const front = nave.cz + nave.d / 2, back = nave.cz - nave.d / 2;

  g.add(at(box(k, nave.w + 0.14, BASE, nave.d + 0.14, x.stone), 0, BASE / 2, nave.cz));
  g.add(at(k.rbox(nave.w, EAVE - BASE + 0.03, nave.d, 0.07, x.brick), 0, BASE - 0.015 + (EAVE - BASE + 0.03) / 2, nave.cz));
  g.add(band(k, nave, EAVE + 0.05, 0.12, 0.07, x.trim));
  const roof = gableRoof(k, nave.d, nave.w, RISE, x.roof, x.trim, 0.14);
  roof.rotation.y = Math.PI / 2;
  g.add(at(roof, 0, EAVE + 0.11, nave.cz));

  // Front: porch, door, oculus in the white gable.
  g.add(onFace(portico(k, x, { n: 4, width: 2.2, depth: 0.72, floor: BASE, colH: 1.72, r: 0.075, ent: 0.18, rise: 0.42, steps: 2, stepDepth: 0.12, oculus: false }), nave, 'front', 0, 0));
  g.add(onFace(door(k, x, { w: 0.62, h: 1.08, double: true, surround: 'plain', step: false }), nave, 'front', 0, BASE));
  g.add(k.detail(onFace(roundel(k, x, 0.2), nave, 'front', 0, EAVE + 0.55)));
  for (const s of [-1, 1]) g.add(onFace(topiary(k, x), nave, 'front', s * 1.22, 0, 0.62));

  // Sides: tall round-headed windows. Back: apse with two small windows.
  for (const f of ['left', 'right'] as const) sashRow(g, k, x, nave, f, [-1.0, 0, 1.0], BASE + 1.12, 0.44, 1.36, { arch: true, lit: 0.6 });
  g.add(at(apse(k, 0.8, EAVE - 0.25, x.brick, 10), 0, 0, back));
  g.add(at(halfCone(k, 0.88, 0.55, x.roof, 10), 0, EAVE - 0.25, back));
  g.add(k.detail(at(apse(k, 0.86, 0.08, x.trim, 10), 0, EAVE - 0.3, back)));
  for (const a of [-0.15 * Math.PI, 0.15 * Math.PI]) { // face centres of the 10-segment apse
    const w = archPanel(k, 0.26, 0.7, x.lit), r = 0.8 * Math.cos(Math.PI / 20) + 0.008;
    w.rotation.y = Math.PI - a;
    g.add(k.detail(at(w, Math.sin(a) * r, BASE + 1.05, back - Math.cos(a) * r)));
  }

  // Tower: brick stage through the roof, white belfry, lantern, copper spire.
  g.add(tower(k, x, front - 0.62));
  return g;
}

function tower(k: KitContext, x: Mats, tz: number): THREE.Group {
  const g = new THREE.Group(), s = 0.96, y0 = 3.05, y1 = 4.18;
  g.add(at(box(k, s, y1 - y0, s, x.brick), 0, (y0 + y1) / 2, tz));
  g.add(at(box(k, s + 0.12, 0.1, s + 0.12, x.trim), 0, y1 + 0.05, tz));
  for (let i = 0; i < 4; i++) { // stone-framed louvre slit on each face of the brick stage
    const a = (i * Math.PI) / 2, f = new THREE.Group();
    f.add(at(archPanel(k, 0.3, 0.46, x.stone), 0, 0, 0.008), at(archPanel(k, 0.2, 0.36, x.dark), 0, -0.02, 0.014));
    f.rotation.y = a;
    g.add(k.detail(at(f, Math.sin(a) * (s / 2), y1 - 0.42, tz + Math.cos(a) * (s / 2))));
  }
  const b0 = y1 + 0.1, bh = 0.66, bs = 0.82;
  g.add(at(box(k, bs, bh, bs, x.trim), 0, b0 + bh / 2, tz));
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2, lv = archPanel(k, 0.34, 0.48, x.dark);
    lv.rotation.y = a;
    g.add(at(lv, Math.sin(a) * (bs / 2 + 0.006), b0 + bh * 0.47, tz + Math.cos(a) * (bs / 2 + 0.006)));
  }
  g.add(at(box(k, bs + 0.12, 0.08, bs + 0.12, x.trim), 0, b0 + bh + 0.04, tz));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(k.detail(at(k.cone(0.06, 0.2, x.trim, 6), sx * 0.4, b0 + bh + 0.18, tz + sz * 0.4)));
  const l0 = b0 + bh + 0.08, lh = 0.34;
  g.add(at(k.cyl(0.29, 0.33, lh, x.trim, 8), 0, l0 + lh / 2, tz));
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 8, w = archPanel(k, 0.12, 0.2, x.dark);
    w.rotation.y = a;
    g.add(k.detail(at(w, Math.sin(a) * 0.3, l0 + lh * 0.5, tz + Math.cos(a) * 0.3)));
  }
  const sp0 = l0 + lh, sh = 1.16;
  g.add(at(k.cone(0.31, sh, x.copper, 8), 0, sp0 + sh / 2, tz));
  g.add(finial(k, x, 0.24, sp0 + sh - 0.04).translateZ(tz));
  return g;
}
