// Owner: A2. cp.library: limestone centre block with a hexastyle portico and a copper dome, brick wings.
// 7 × 5 footprint, about 4.6 tall (finial ≈ 5.3), front toward +z.
import * as THREE from 'three';
import type { AssetParams, KitContext } from '../../types';
import { archPanel, at, band, box, dome, door, finial, mats, onFace, portico, quoins, sashRow, type Block } from './parts';
import { pick } from './pick';

const BASE = 0.36, TOPC = 2.86, TOPW = 2.4; // podium, centre block wall top, wing wall top
const SHIFT = -0.14; // whole composition shifted back so portico + steps stay centred in the footprint

export function buildLibrary(k: KitContext, p: AssetParams): THREE.Group {
  const x = mats(k, pick(p.brick, 3, k), pick(p.roof, 3, k), 0);
  const g = new THREE.Group();
  const centre: Block = { cx: 0, cz: -0.5 + SHIFT, w: 3.5, d: 3.6 };
  const wings: Block[] = [-1, 1].map((s) => ({ cx: s * 2.47, cz: -0.62 + SHIFT, w: 1.46, d: 3.0 }));

  // Podium + masses.
  g.add(at(box(k, 6.7, BASE, 3.9, x.stone), 0, BASE / 2, -0.55 + SHIFT));
  g.add(at(k.rbox(centre.w, TOPC - BASE + 0.03, centre.d, 0.08, x.stone), centre.cx, BASE - 0.015 + (TOPC - BASE + 0.03) / 2, centre.cz));
  g.add(band(k, centre, TOPC + 0.05, 0.18, 0.08, x.trim));
  g.add(k.detail(band(k, centre, TOPC + 0.2, 0.12, 0.0, x.stone)));
  for (const b of wings) {
    g.add(at(k.rbox(b.w, TOPW - BASE + 0.03, b.d, 0.08, x.brick), b.cx, BASE - 0.015 + (TOPW - BASE + 0.03) / 2, b.cz));
    g.add(band(k, b, TOPW + 0.04, 0.14, 0.06, x.trim));
    g.add(at(box(k, b.w + 0.02, 0.22, b.d + 0.02, x.brick), b.cx, TOPW + 0.22, b.cz)); // parapet
    g.add(k.detail(at(box(k, b.w + 0.1, 0.06, b.d + 0.1, x.stone), b.cx, TOPW + 0.36, b.cz))); // coping
    g.add(quoins(k, x, b, BASE, TOPW - 0.02));
  }

  // Portico, steps, entrance.
  g.add(onFace(portico(k, x, {
    n: 6, width: 3.3, depth: 1.02, floor: BASE, colH: TOPC + 0.14 - 0.3 - BASE, r: 0.115, ent: 0.3, rise: 0.66, steps: 3, stepDepth: 0.15,
  }), centre, 'front', 0, 0));
  g.add(onFace(door(k, x, { w: 0.8, h: 1.3, double: true, surround: 'classic', step: false }), centre, 'front', 0, BASE));
  sashRow(g, k, x, centre, 'front', [-1.15, 1.15], BASE + 1.15, 0.46, 1.2, { arch: true, sill: true });

  // Tall round-headed windows: wings front/outer side/back, centre back.
  for (const [i, b] of wings.entries()) {
    sashRow(g, k, x, b, 'front', [0], BASE + 1.0, 0.62, 1.45, { arch: true });
    sashRow(g, k, x, b, i === 0 ? 'left' : 'right', [-0.7, 0.7], BASE + 1.0, 0.5, 1.35, { arch: true });
    sashRow(g, k, x, b, 'back', [0], BASE + 1.0, 0.55, 1.35, { arch: true });
    g.add(k.detail(onFace(at(box(k, 0.9, 0.16, 0.05, x.stone), 0, 0, 0.025), b, 'front', 0, TOPW - 0.22)));
  }
  sashRow(g, k, x, centre, 'back', [-1.0, 0, 1.0], BASE + 1.2, 0.5, 1.4, { arch: true });

  // Attic, drum, dome, lantern, finial.
  const y0 = TOPC + 0.26, cz = centre.cz - 0.15;
  g.add(at(box(k, 2.5, 0.26, 2.5, x.stone), 0, y0 + 0.13, cz));
  const drumY = y0 + 0.26, drumH = 0.56, R = 1.0;
  g.add(at(k.cyl(R, R, drumH, x.stone, 20), 0, drumY + drumH / 2, cz));
  g.add(k.detail(at(k.cyl(R + 0.05, R + 0.05, 0.06, x.trim, 20), 0, drumY + 0.03, cz)));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8, w = archPanel(k, 0.22, 0.34, i % 2 ? x.lit : x.dark);
    w.rotation.y = a;
    g.add(k.detail(at(w, Math.sin(a) * (R + 0.006), drumY + drumH * 0.5, cz + Math.cos(a) * (R + 0.006))));
  }
  g.add(at(k.cyl(R + 0.09, R + 0.09, 0.09, x.trim, 20), 0, drumY + drumH + 0.045, cz));
  const domeY = drumY + drumH + 0.09, squash = 0.92;
  g.add(at(dome(k, R + 0.02, x.copper, 18, 7, squash), 0, domeY, cz));
  const lanY = domeY + (R + 0.02) * squash - 0.04;
  g.add(at(k.cyl(0.19, 0.21, 0.28, x.trim, 8), 0, lanY + 0.14, cz));
  g.add(at(dome(k, 0.22, x.copper, 8, 3), 0, lanY + 0.28, cz));
  g.add(finial(k, x, 0.3, lanY + 0.47));
  return g;
}
