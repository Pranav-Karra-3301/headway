// Owner: A2. cp.library: limestone centre block with a hexastyle portico and a copper dome, brick wings.
// 7 × 5 footprint, about 4.6 tall (finial ≈ 5.3), front toward +z.
import * as THREE from 'three';
import type { AssetParams, KitContext } from '../../types';
import { archPanel, at, band, box, dome, door, finial, flatRoof, mats, onFace, portico, quoins, sashRow, topiary, type Block } from './parts';
import { pick } from './pick';

const BASE = 0.36, TOPC = 2.86, TOPW = 2.4; // podium, centre block wall top, wing wall top
const SHIFT = -0.14; // whole composition shifted back so portico + steps stay centred in the footprint

export function buildLibrary(k: KitContext, p: AssetParams): THREE.Group {
  const x = mats(k, pick(p.brick, 3, k), typeof p.roof === 'number' ? pick(p.roof, 3, k) : 1, 0); // slate deck: the copper dome pops
  const g = new THREE.Group();
  const centre: Block = { cx: 0, cz: -0.5 + SHIFT, w: 3.5, d: 3.6 };
  const sides = [-1, 1] as const;
  const wings: Block[] = sides.map((s) => ({ cx: s * 2.47, cz: -0.62 + SHIFT, w: 1.46, d: 3.0 }));

  // Podium + masses.
  g.add(at(box(k, 6.7, BASE, 3.9, x.stone), 0, BASE / 2, -0.55 + SHIFT));
  g.add(at(k.rbox(centre.w, TOPC - BASE + 0.03, centre.d, 0.08, x.stone), centre.cx, BASE - 0.015 + (TOPC - BASE + 0.03) / 2, centre.cz));
  g.add(band(k, centre, TOPC + 0.05, 0.18, 0.08, x.trim));
  g.add(flatRoof(k, x, { ...centre, w: centre.w + 0.04, d: centre.d + 0.04 }, TOPC + 0.14, 0.14, x.stone, x.roof, 0.1));
  for (const [i, b] of wings.entries()) {
    // Plain box: its edges are covered by quoins, cornice and parapet anyway (keeps the budget for the dome).
    g.add(at(box(k, b.w, TOPW - BASE + 0.03, b.d, x.brick), b.cx, BASE - 0.015 + (TOPW - BASE + 0.03) / 2, b.cz));
    g.add(band(k, b, TOPW + 0.04, 0.14, 0.06, x.trim));
    g.add(flatRoof(k, x, b, TOPW + 0.11, 0.2, x.brick, x.roof, 0.12));
    g.add(quoins(k, x, b, BASE, TOPW - 0.02, [[sides[i]!, -1], [sides[i]!, 1]]));
  }

  // Portico, steps, entrance.
  g.add(onFace(portico(k, x, {
    n: 6, width: 3.3, depth: 1.02, floor: BASE, colH: TOPC + 0.14 - 0.3 - BASE, r: 0.115, ent: 0.3, rise: 0.66, steps: 3, stepDepth: 0.15, seg: 8,
    backRoof: { m: x.roof, len: 0.75 },
  }), centre, 'front', 0, 0));
  g.add(onFace(door(k, x, { w: 0.8, h: 1.3, double: true, surround: 'classic', step: false }), centre, 'front', 0, BASE));
  sashRow(g, k, x, centre, 'front', [-1.15, 1.15], BASE + 1.15, 0.46, 1.2, { arch: true, sill: true });
  for (const s of [-1, 1]) g.add(at(topiary(k, x), s * 1.95, 0, centre.cz + centre.d / 2 + 0.55));

  // Tall round-headed windows: wings front/outer side/back, centre back.
  for (const [i, b] of wings.entries()) {
    sashRow(g, k, x, b, 'front', [0], BASE + 1.0, 0.62, 1.45, { arch: true });
    sashRow(g, k, x, b, i === 0 ? 'left' : 'right', [-0.7, 0.7], BASE + 1.0, 0.5, 1.35, { arch: true, sill: false });
    sashRow(g, k, x, b, 'back', [0], BASE + 1.0, 0.55, 1.35, { arch: true, sill: false });
    g.add(k.detail(onFace(box(k, 0.9, 0.16, 0.05, x.stone), b, 'front', 0, TOPW - 0.22, 0.025)));
  }
  sashRow(g, k, x, centre, 'back', [-1.0, 0, 1.0], BASE + 1.2, 0.5, 1.4, { arch: true, sill: false });

  // Roof decks, round stepped base, drum, dome, lantern, finial.
  g.add(at(box(k, centre.w - 0.1, 0.05, centre.d - 0.1, x.roof), centre.cx, TOPC + 0.285, centre.cz));
  const cz = centre.cz - 0.15, R = 1.0;
  g.add(at(k.cyl(R + 0.2, R + 0.24, 0.16, x.stone, 16), 0, TOPC + 0.26 + 0.08, cz));
  const drumY = TOPC + 0.42, drumH = 0.54;
  g.add(at(k.cyl(R, R, drumH, x.stone, 16), 0, drumY + drumH / 2, cz));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8, w = archPanel(k, 0.2, 0.3, i % 2 ? x.lit : x.dark, 4);
    w.rotation.y = a;
    g.add(k.detail(at(w, Math.sin(a) * (R + 0.006), drumY + 0.24, cz + Math.cos(a) * (R + 0.006))));
  }
  g.add(at(k.cyl(R + 0.08, R + 0.08, 0.08, x.trim, 16), 0, drumY + drumH + 0.04, cz));
  const domeY = drumY + drumH + 0.08, squash = 0.9;
  g.add(at(dome(k, R + 0.02, x.copper, 16, 6, squash), 0, domeY, cz));
  const lanY = domeY + (R + 0.02) * squash - 0.04;
  g.add(at(k.cyl(0.19, 0.21, 0.26, x.trim, 8), 0, lanY + 0.13, cz));
  g.add(at(dome(k, 0.22, x.copper, 8, 3), 0, lanY + 0.26, cz));
  g.add(finial(k, x, 0.24, lanY + 0.44).translateZ(cz));
  return g;
}
