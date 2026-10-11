// Owner: A2. cp.hall: Georgian classroom hall, 7 × 3.5 footprint, about 3.8 tall, front (portico) toward +z.
import * as THREE from 'three';
import type { AssetParams, KitContext } from '../../types';
import {
  at, band, box, bays, chimney, cupola, door, gableRoof, hipRoof, mats, onFace, pediment, portico, quoins, sash, sashRow,
  roundel, triPanel, type Block, type Mats,
} from './parts';
import { pick } from './pick';

const W = 6.5, D = 2.5, BASE = 0.24, G1 = 1.22, G2 = 1.1, EAVE = BASE + G1 + G2;
const CZ = -0.42; // body centre: front wall at z = 0.83, portico + steps in front of it
const ROOF_RISE = 0.95, TOP = EAVE + 0.12; // roof springs from the cornice top

/**
 * params: `variant` 0 = hip roof + cupola + giant portico, 1 = gable roof + paired end chimneys + giant portico,
 * 2 = hip roof + dormers + entrance porch; `brick`, `roof`, `door` pick colour variants (0..2).
 * Unset params vary per placement.
 */
export function buildHall(k: KitContext, p: AssetParams): THREE.Group {
  const variant = pick(p.variant, 3, k);
  const x = mats(k, pick(p.brick, 3, k), pick(p.roof, 3, k), pick(p.door, 3, k));
  const g = new THREE.Group();
  const body: Block = { cx: 0, cz: CZ, w: W, d: D };

  g.add(at(k.rbox(W + 0.14, BASE, D + 0.14, 0.05, x.stone), 0, BASE / 2, CZ));
  g.add(at(k.rbox(W, EAVE - BASE + 0.04, D, 0.08, x.brick), 0, BASE - 0.02 + (EAVE - BASE + 0.04) / 2, CZ));
  g.add(k.detail(band(k, body, BASE + G1, 0.07, 0.025, x.stone)));
  g.add(band(k, body, EAVE + 0.04, 0.16, 0.09, x.trim));
  g.add(quoins(k, x, body, BASE, EAVE - 0.02));

  // Roof.
  if (variant === 1) {
    g.add(at(gableRoof(k, W, D + 0.18, ROOF_RISE + 0.05, x.roof, x.brick, 0.14), 0, TOP, CZ));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(at(chimney(k, x, 0.34, 0.42, 1.25), sx * (W / 2 - 0.22), EAVE, CZ + sz * 0.6));
  } else {
    g.add(at(hipRoof(k, W + 0.3, D + 0.3, ROOF_RISE, x.roof), 0, TOP, CZ));
    for (const sx of [-1, 1]) g.add(at(chimney(k, x, 0.36, 0.3, 1.05), sx * 2.35, TOP - 0.1, CZ - 0.38));
    if (variant === 0) g.add(at(cupola(k, x, 0.62, 0.24), 0, TOP + ROOF_RISE - 0.24, CZ));
  }

  // Front: entrance + windows either side.
  const yA = BASE + 0.6, yB = BASE + G1 + 0.47, ww = 0.5, hA = 0.82, hB = 0.7;
  sashRow(g, k, x, body, 'front', [-2.6, -1.75, 1.75, 2.6], yA, ww, hA, { lintel: true });
  sashRow(g, k, x, body, 'front', [-2.6, -1.75, 1.75, 2.6], yB, ww, hB, { lintel: true });
  if (variant === 2) {
    g.add(onFace(entrancePorch(k, x), body, 'front', 0, 0));
    g.add(onFace(dormers(k, x), body, 'front', 0, 0));
    g.add(k.detail(onFace(roundel(k, x, 0.2), body, 'front', 0, yB + 0.2)));
  } else {
    g.add(onFace(portico(k, x, { n: 4, width: 2.5, depth: 0.78, floor: BASE, colH: EAVE - 0.18 - BASE, r: 0.11, ent: 0.3, rise: 0.62, steps: 2, stepDepth: 0.12 }), body, 'front', 0, 0));
    g.add(onFace(door(k, x, { w: 0.72, h: 1.12, double: true, surround: 'plain', step: false }), body, 'front', 0, BASE));
    g.add(onFace(sash(k, x, ww, hB, { sill: false }), body, 'front', 0, yB));
  }

  // Back and sides.
  const back = bays(5, 5.0);
  sashRow(g, k, x, body, 'back', back, yA, ww, hA);
  sashRow(g, k, x, body, 'back', back, yB, ww, hB);
  for (const f of ['left', 'right'] as const) {
    sashRow(g, k, x, body, f, [-0.55, 0.55], yA, ww, hA);
    sashRow(g, k, x, body, f, [-0.55, 0.55], yB, ww, hB);
  }
  return g;
}

/** Single-storey porch: 2 columns, pediment, steps, double door (variant 2). Back on the wall at z = 0. */
function entrancePorch(k: KitContext, x: Mats): THREE.Group {
  const g = new THREE.Group();
  g.add(portico(k, x, { n: 2, width: 1.5, depth: 0.62, floor: BASE, colH: 1.12, r: 0.08, ent: 0.16, rise: 0.3, steps: 2, stepDepth: 0.12, oculus: false }));
  g.add(door(k, x, { w: 0.66, h: 1.0, double: true, surround: 'plain', step: false, fanlight: false }).translateY(BASE));
  return g;
}

/** Two pedimented dormers on the front roof slope (variant 2), positioned relative to the front wall at z = 0. */
function dormers(k: KitContext, x: Mats): THREE.Group {
  const g = new THREE.Group(), slope = ROOF_RISE / ((D + 0.3) / 2), t = 0.42;
  const y0 = TOP + (t - 0.15) * slope - 0.06;
  for (const u of [-1.7, 1.7]) {
    const d = new THREE.Group();
    d.add(at(box(k, 0.56, 0.5, 0.9, x.trim), 0, 0.25, -0.45));
    d.add(at(pediment(k, 0.72, 0.26, 1.0, x.roof), 0, 0.5, -0.47));
    d.add(k.detail(at(triPanel(k, 0.5, 0.17, x.trim), 0, 0.53, 0.035)));
    d.add(at(sash(k, x, 0.32, 0.3, { sill: false }), 0, 0.24, 0));
    g.add(at(d, u, y0, -t + 0.15));
  }
  return g;
}
