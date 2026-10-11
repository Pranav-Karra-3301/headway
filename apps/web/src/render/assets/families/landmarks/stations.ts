// Owner: A4. Station buildings. Front (+z) faces the platform/track; the town entrance is on the back (-z).
//  lm.stationCentral (9 × 4.5): gabled central hall with a clock in each gable, two hipped wings, a long red
//    platform canopy on posts with benches and hanging lamps, a paved apron, a town-side entrance porch.
//  lm.stationHalt (6 × 2.6): a small gabled halt — ticket office at one end, open shelter with benches.
import * as THREE from 'three';
import type { AssetParams } from '../../types';
import {
  archWindow, at, bench, box, clockFace, cyl, doorUnit, group, hipRoof, type Kit, onFace, prism, pyramid, rbox, sphere,
  windowUnit,
} from './parts';

/** Gable roof (ridge along z) over a w × d block whose walls top out at y: wall-coloured gable prism + 2 slabs. */
function gableZ(k: Kit, w: number, d: number, y: number, rise: number, roofRole: string, roofIdx: number, wallRole: string, wallIdx: number, over = 0.14): THREE.Group {
  const g = group('roof');
  g.add(at(prism(k, w, rise, d - 0.02, 'z', wallRole, wallIdx), 0, y, 0));
  const half = w / 2, slant = Math.hypot(half, rise), ang = Math.atan2(rise, half);
  const sn = Math.sin(ang), cs = Math.cos(ang);
  for (const s of [-1, 1]) {
    const slab = rbox(k, slant + over, 0.1, d + over * 2, 0.035, roofRole, roofIdx);
    slab.rotation.z = -s * ang;
    g.add(at(slab, s * (half / 2 + 0.05 * sn + (over / 2) * cs), y + rise / 2 + 0.05 * cs - (over / 2) * sn, 0));
  }
  g.add(k.detail(at(box(k, 0.12, 0.08, d + over * 2 + 0.02, 'trim'), 0, y + rise + 0.05, 0)));
  return g;
}

/** Gable roof with the ridge along x (eaves front/back). */
function gableX(k: Kit, w: number, d: number, y: number, rise: number, roofRole: string, roofIdx: number, wallRole: string, wallIdx: number, over = 0.14, slabRole?: [string, string]): THREE.Group {
  const g = group('roof');
  g.add(at(prism(k, d, rise, w - 0.02, 'x', wallRole, wallIdx), 0, y, 0));
  const half = d / 2, slant = Math.hypot(half, rise), ang = Math.atan2(rise, half);
  const sn = Math.sin(ang), cs = Math.cos(ang);
  for (const s of [-1, 1]) {
    const slab = rbox(k, w + over * 2, 0.1, slant + over, 0.035, roofRole, roofIdx);
    slab.rotation.x = s * ang;
    slab.name = slabRole ? (s > 0 ? slabRole[0] : slabRole[1]) : '';
    g.add(at(slab, 0, y + rise / 2 + 0.05 * cs - (over / 2) * sn, s * (half / 2 + 0.05 * sn + (over / 2) * cs)));
  }
  g.add(k.detail(at(box(k, w + over * 2 + 0.02, 0.08, 0.12, 'trim'), 0, y + rise + 0.05, 0)));
  return g;
}

export function buildStationCentral(k: Kit, _params: AssetParams): THREE.Object3D {
  const g = group('stationCentral');
  const lit = () => k.rand() < 0.45;
  // ---- central hall ----
  const hw = 3.2, hd = 2.6, hh = 2.6, hz = -0.75;
  const hall = group('hall');
  hall.add(at(rbox(k, hw, hh, hd, 0.1, 'wall', 0), 0, hh / 2, 0));
  hall.add(k.detail(at(box(k, hw + 0.04, 0.22, hd + 0.04, 'lmStone'), 0, 0.11, 0)));
  hall.add(k.detail(at(box(k, hw + 0.06, 0.1, hd + 0.06, 'lmStone'), 0, hh - 0.05, 0)));
  hall.add(gableZ(k, hw, hd, hh, 0.9, 'roof', 1, 'wall', 0));
  // platform side (+z): double doors flanked by tall arched windows; gable clock
  hall.add(onFace(doorUnit(k, { w: 0.9, h: 1.25, canopy: null }), 'front', hw, hd, 0, 0));
  for (const u of [-1.05, 1.05]) hall.add(onFace(archWindow(k, 0.5, 1.3, lit()), 'front', hw, hd, u, 1.0));
  // town side (-z): entrance with a porch canopy, sign board, arched windows
  hall.add(onFace(doorUnit(k, { w: 0.9, h: 1.25, canopy: 'canopy', step: true }), 'back', hw, hd, 0, 0));
  hall.add(k.detail(onFace(at(box(k, 1.5, 0.3, 0.05, 'paper'), 0, 0, 0.025), 'back', hw, hd, 0, 1.85)));
  hall.add(k.detail(onFace(at(box(k, 1.22, 0.08, 0.02, 'accent'), 0, 0, 0.06), 'back', hw, hd, 0, 1.85)));
  for (const u of [-1.05, 1.05]) hall.add(onFace(archWindow(k, 0.5, 1.3, lit()), 'back', hw, hd, u, 1.0));
  for (const f of ['front', 'back'] as const) {
    const c = clockFace(k, 0.3, true);
    c.name = 'clockFace';
    hall.add(onFace(c, f, hw, hd, 0, hh + 0.36, 0.06));
  }
  // cupola on the ridge
  const cup = group('cupola');
  cup.add(at(box(k, 0.42, 0.32, 0.42, 'wall', 2), 0, 0.16, 0));
  for (const r of [0, Math.PI / 2]) { const l = box(k, 0.44, 0.16, 0.02, 'window', 1); l.rotation.y = r; cup.add(k.detail(at(l, 0, 0.18, 0))); }
  cup.add(at(pyramid(k, 0.56, 0.56, 0.3, 'roof', 1), 0, 0.32, 0));
  cup.add(k.detail(at(sphere(k, 0.05, 'safety', 0, 8), 0, 0.65, 0)));
  hall.add(at(cup, 0, hh + 0.8, 0));
  g.add(at(hall, 0, 0, hz));

  // ---- wings ----
  const ww = 2.75, wd = 2.2, wh = 2.0;
  for (const s of [-1, 1]) {
    const wing = group('wing');
    wing.add(at(rbox(k, ww, wh, wd, 0.08, 'wall', 1), 0, wh / 2, 0));
    wing.add(k.detail(at(box(k, ww + 0.04, 0.2, wd + 0.04, 'lmStone'), 0, 0.1, 0)));
    wing.add(at(hipRoof(k, ww + 0.26, wd + 0.26, 0.66, 'roof', 1), 0, wh, 0));
    wing.add(k.detail(at(box(k, ww + 0.28, 0.06, wd + 0.28, 'trim'), 0, wh + 0.03, 0)));
    for (const u of [-0.7, 0.7]) {
      wing.add(onFace(windowUnit(k, 0.52, 0.72, lit()), 'front', ww, wd, u, 1.0));
      wing.add(onFace(windowUnit(k, 0.52, 0.72, lit()), 'back', ww, wd, u, 1.0));
    }
    wing.add(onFace(windowUnit(k, 0.52, 0.72, lit()), s > 0 ? 'right' : 'left', ww, wd, 0, 1.0));
    wing.add(k.detail(at(box(k, 0.26, 0.62, 0.26, 'brick'), s * 0.7, wh + 0.5, -0.55)));
    wing.add(k.detail(at(box(k, 0.32, 0.06, 0.32, 'trim'), s * 0.7, wh + 0.83, -0.55)));
    g.add(at(wing, s * (hw / 2 + ww / 2), 0, hz));
  }

  // ---- platform canopy (lighter, shallower), apron, benches, lamps ----
  const cz0 = 0.32, cz1 = 1.72, cy = 1.8, cw = 8.6;
  g.add(at(box(k, 8.9, 0.05, 2.2 - cz0 + 0.04, 'platform'), 0, 0.025, (cz0 + 2.2) / 2));
  g.add(k.detail(at(box(k, 8.9, 0.012, 0.08, 'curb'), 0, 0.056, 2.1)));
  const canopy = group('canopy');
  const slab = rbox(k, cw, 0.08, cz1 - cz0, 0.03, 'canopy');
  slab.rotation.x = 0.06;
  canopy.add(at(slab, 0, cy, (cz0 + cz1) / 2));
  canopy.add(k.detail(at(box(k, cw, 0.09, 0.03, 'stripe'), 0, cy - 0.11, cz1 - 0.01)));
  for (const x of [-3.9, -1.3, 1.3, 3.9]) {
    canopy.add(at(cyl(k, 0.045, 0.055, cy - 0.06, 'post', 0, 8), x, (cy - 0.06) / 2 + 0.05, cz1 - 0.22));
    const br = box(k, 0.04, 0.04, 0.42, 'post'); br.rotation.x = -0.7;
    canopy.add(k.detail(at(br, x, cy - 0.2, cz1 - 0.4)));
    canopy.add(k.detail(at(sphere(k, 0.085, 'lamp', 0, 8), x * 0.67, cy - 0.27, (cz0 + cz1) / 2 + 0.05)));
    canopy.add(k.detail(at(cyl(k, 0.008, 0.008, 0.18, 'post', 0, 4), x * 0.67, cy - 0.13, (cz0 + cz1) / 2 + 0.05)));
  }
  canopy.add(k.detail(at(box(k, 1.4, 0.24, 0.04, 'paper'), 0, cy - 0.27, cz1 - 0.04)));
  canopy.add(k.detail(at(box(k, 1.1, 0.07, 0.02, 'accent'), 0, cy - 0.27, cz1 - 0.015)));
  g.add(canopy);
  // upper hall windows above the canopy line, on the platform side
  for (const u of [-0.9, 0, 0.9]) hall.add(onFace(archWindow(k, 0.3, 0.42, lit()), 'front', hw, hd, u, 2.2));
  for (const x of [-3.0, 3.0]) g.add(at(bench(k, 0.95), x, 0.05, 0.62));
  g.add(k.detail(at(box(k, 0.22, 0.42, 0.22, 'post'), -1.9, 0.26, 0.5)));
  g.add(k.detail(at(box(k, 0.24, 0.03, 0.24, 'trim'), -1.9, 0.49, 0.5)));
  // luggage trolley on the apron
  const trolley = group('trolley');
  trolley.add(at(box(k, 0.5, 0.05, 0.3, 'bench'), 0, 0.2, 0));
  for (const x of [-0.17, 0.17]) trolley.add(at(cyl(k, 0.06, 0.06, 0.34, 'post', 0, 8), x, 0.08, 0).rotateX(Math.PI / 2));
  trolley.add(at(box(k, 0.3, 0.16, 0.2, 'door'), -0.05, 0.31, 0));
  trolley.add(at(box(k, 0.18, 0.12, 0.16, 'lmBanner', 0), 0.15, 0.29, 0.02));
  g.add(k.detail(at(trolley, 2.1, 0.05, 1.95)));
  return g;
}

export function buildStationHalt(k: Kit, _params: AssetParams): THREE.Object3D {
  const g = group('stationHalt');
  const lit = () => k.rand() < 0.5;
  const W = 5.9, wallH = 1.75, rise = 0.62, D = 2.36;
  // paved floor
  g.add(at(box(k, W - 0.1, 0.05, D - 0.1, 'platform'), 0, 0.025, 0));
  // ticket office (right end)
  const ow = 1.7, od = 1.6, ox = W / 2 - ow / 2 - 0.05, oz = -0.3;
  const office = group('office');
  office.add(at(rbox(k, ow, wallH, od, 0.07, 'wall', 2), 0, wallH / 2, 0));
  office.add(k.detail(at(box(k, ow + 0.04, 0.18, od + 0.04, 'lmStone'), 0, 0.09, 0)));
  office.add(onFace(doorUnit(k, { w: 0.55, h: 1.0, canopy: null }), 'front', ow, od, 0.4, 0.05));
  office.add(onFace(windowUnit(k, 0.55, 0.5, lit()), 'front', ow, od, -0.35, 1.0));
  office.add(k.detail(onFace(at(box(k, 0.7, 0.05, 0.16, 'bench'), 0, 0, 0.08), 'front', ow, od, -0.35, 0.68)));
  office.add(onFace(windowUnit(k, 0.55, 0.5, lit()), 'right', ow, od, 0, 1.0));
  office.add(onFace(windowUnit(k, 0.55, 0.5, lit()), 'back', ow, od, 0, 1.0));
  g.add(at(office, ox, 0, oz));
  // shelter back wall (town side) with windows, and front posts
  const sw = W - ow - 0.1, sx = -W / 2 + sw / 2;
  const wall = group('shelterWall');
  wall.add(at(rbox(k, sw, wallH, 0.14, 0.04, 'wall', 1), 0, wallH / 2, 0));
  for (const u of [-1.3, 0, 1.3]) wall.add(onFace(windowUnit(k, 0.6, 0.5, false, { sill: false }), 'front', sw, 0.14, u, 1.15));
  g.add(at(wall, sx, 0, -0.98));
  for (const x of [-W / 2 + 0.25, -0.6]) g.add(at(cyl(k, 0.05, 0.06, wallH, 'post', 0, 8), x, wallH / 2, 0.95));
  // gable roof: the front slab is the platform canopy (+z)
  const roof = gableX(k, W, D, wallH, rise, 'roof', 1, 'wall', 1, 0.06, ['canopy', 'roofBack']);
  g.add(roof);
  for (const x of [-W / 2 + 0.25, -0.6, W / 2 - 0.1]) g.add(k.detail(at(box(k, 0.06, 0.06, D, 'post'), x, wallH - 0.03, 0)));
  g.add(at(box(k, W + 0.1, 0.12, 0.04, 'canopy'), 0, wallH - 0.02, D / 2 + 0.03));
  g.add(k.detail(at(box(k, W + 0.1, 0.04, 0.045, 'stripe'), 0, wallH - 0.1, D / 2 + 0.035)));
  // benches, lamps, name board, bin
  for (const x of [-2.15, -1.05]) g.add(at(bench(k, 0.8), x, 0.05, -0.68));
  for (const x of [-2.2, 0.25]) {
    g.add(k.detail(at(cyl(k, 0.008, 0.008, 0.22, 'post', 0, 4), x, wallH - 0.1, 0.55)));
    g.add(k.detail(at(sphere(k, 0.085, 'lamp', 0, 8), x, wallH - 0.25, 0.55)));
  }
  g.add(at(box(k, 1.3, 0.26, 0.05, 'paper'), -1.6, wallH - 0.28, 1.06));
  g.add(k.detail(at(box(k, 1.04, 0.07, 0.02, 'accent'), -1.6, wallH - 0.28, 1.09)));
  g.add(k.detail(at(cyl(k, 0.1, 0.09, 0.36, 'post', 0, 8), -0.2, 0.23, 0.85)));
  // hanging platform clock, timetable board, office chimney and a planter by the door
  const clock = clockFace(k, 0.17, true);
  g.add(at(clock, 0.0, wallH - 0.3, 1.0));
  g.add(k.detail(at(cyl(k, 0.01, 0.01, 0.12, 'post', 0, 4), 0.0, wallH - 0.08, 1.0)));
  g.add(k.detail(at(box(k, 0.5, 0.36, 0.03, 'panel'), -0.3, 1.05, -0.9)));
  g.add(k.detail(at(box(k, 0.56, 0.42, 0.02, 'post'), -0.3, 1.05, -0.915)));
  g.add(at(box(k, 0.26, 0.5, 0.26, 'brick'), ox + 0.45, wallH + rise * 0.55, oz - 0.35));
  g.add(k.detail(at(box(k, 0.32, 0.05, 0.32, 'trim'), ox + 0.45, wallH + rise * 0.55 + 0.27, oz - 0.35)));
  g.add(k.detail(at(box(k, 0.46, 0.22, 0.22, 'brick'), ox - 0.6, 0.16, oz + od / 2 + 0.16)));
  g.add(k.detail(at(sphere(k, 0.17, 'leaf', 1, 10), ox - 0.6, 0.36, oz + od / 2 + 0.16)));
  return g;
}
