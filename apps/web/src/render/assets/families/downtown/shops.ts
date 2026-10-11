// Owner: A1. Main-street storefront buildings: dt.shop, dt.shopRow, dt.cafe, dt.corner, dt.midrise.
// Footprint centred on the origin, ground at y = 0, street front toward +z. Ground storey G (shopfront), upper S.
import * as THREE from 'three';
import type { AssetParams } from '../../types';
import {
  acUnit, at, bladeSign, cafeTable, chimney, cornice, doorUnit, Dk, flatRoof, flowerBox, IRON, onFace, parapetCrest, plainWindow,
  pottedShrub, roofGarden, scheme, signBoard, skylight, STONE, STONE_DARK, stairHut, storefront, TRIM, vent, wallLamp, waterTank, windowUnit,
  type Face, type ParapetStyle, type RoleRef, type Scheme, type V2,
} from './parts';

export const G = 1.35;
export const S = 1.05;
/** Wall above the top windows, under the cornice. */
export const FRIEZE = 0.25;

/** Lintel/sill colour that reads on the wall: stone on brick, white trim on paint. */
const dressing = (s: Scheme): RoleRef => (s.brick ? STONE : TRIM);

/** Scatter 1-3 rooftop items on a roof rectangle (x0..x1, z0..z1) at height y. */
function roofClutter(g: THREE.Group, p: Dk, y: number, x0: number, x1: number, z0: number, z1: number, wall: RoleRef, n = 2): void {
  const slots: Array<[number, number]> = [[0.28, 0.3], [0.72, 0.32], [0.3, 0.72], [0.7, 0.7]];
  const used = new Set<number>();
  for (let i = 0; i < n; i++) {
    let si = p.int(slots.length);
    while (used.has(si)) si = (si + 1) % slots.length;
    used.add(si);
    const [fx, fz] = slots[si]!;
    const x = x0 + (x1 - x0) * fx, z = z0 + (z1 - z0) * fz;
    const kind = p.int(4);
    if (kind === 0) g.add(at(acUnit(p), x, y, z));
    else if (kind === 1) g.add(at(vent(p), x, y, z));
    else if (kind === 2 && x1 - x0 > 1.6) g.add(at(skylight(p, 0.7, 0.55), x, y, z));
    else g.add(at(chimney(p, wall, 0.32), x, y, z));
  }
}

/** Upper-storey windows across one face: n windows per storey, `storeys` storeys starting at y0. */
function upperWindows(g: THREE.Group, p: Dk, face: Face, w: number, d: number, cx: number, cz: number, us: number[], y0: number, storeys: number, ww: number, wh: number, s: Scheme, arched = false, plain = false): void {
  for (let f = 0; f < storeys; f++) {
    const top = arched && f === storeys - 1;
    for (const u of us) {
      const win = plain
        ? plainWindow(p, ww, wh, dressing(s))
        : windowUnit(p, ww, top ? wh - ww * 0.3 : wh, { lintel: dressing(s), sill: dressing(s), arch: top ? dressing(s) : null, bars: ww > 0.55 ? 'cross' : ww >= 0.45 ? 'h' : 'none' });
      g.add(onFace(win, face, w, d, u, y0 + f * S + S * 0.5 - (top ? ww * 0.15 : 0), cx, cz));
    }
  }
}

/** Faded painted advert on an exposed side wall (charming when the neighbour is missing). */
function ghostSign(p: Dk, w: number, h: number, s: Scheme): THREE.Group {
  const g = new THREE.Group();
  g.add(at(p.box(w, h, 0.015, ['dtPaint', s.wall[1] % 2 === 0 ? 0 : 1]), 0, 0, 0.0075));
  g.add(at(p.box(w * 0.7, h * 0.18, 0.01, ['dtSign', s.sign]), 0, h * 0.12, 0.018));
  g.add(at(p.box(w * 0.45, h * 0.1, 0.01, ['dtSign', s.sign]), 0, -h * 0.2, 0.018));
  return p.detail(g);
}

// ------------------------------------------------------------------------------------------------ dt.shop

export function buildShop(p: Dk, params: AssetParams): THREE.Group {
  const g = new THREE.Group();
  const s = scheme(p);
  const storeys = params.storeys === 1 || params.storeys === 2 ? params.storeys : p.chance(0.7) ? 2 : 1;
  const W = 2.9, D = 2.4, cz = -1.45 + D / 2, fz = cz + D / 2;
  const H = storeys === 2 ? G + S + FRIEZE : G + 0.8;
  g.add(at(p.rbox(W, H, D, 0.08, s.wall), 0, H / 2, cz));
  const door = p.pick(['left', 'right', 'center'] as const);
  g.add(at(storefront(p, W - 0.16, G, { scheme: s, door, sign: storeys === 2 }), 0, 0, fz));
  if (storeys === 2) {
    const layout = p.int(3);
    if (layout === 0) {
      upperWindows(g, p, 'front', W, D, 0, cz, [-0.7, 0.7], G, 1, 0.5, 0.62, s);
      if (p.chance(0.5)) for (const u of [-0.7, 0.7]) g.add(at(flowerBox(p, 0.6, p.int(5)), u, G + 0.17, fz + 0.02));
    }
    else if (layout === 1) upperWindows(g, p, 'front', W, D, 0, cz, [-0.85, 0, 0.85], G, 1, 0.4, 0.62, s, p.chance(0.5));
    else g.add(at(windowUnit(p, 1.5, 0.6, { lintel: dressing(s), sill: dressing(s), bars: 'v' }), 0, G + 0.52, fz));
    if (p.chance(0.55)) {
      const side = door === 'left' ? 1 : -1;
      g.add(at(bladeSign(p, s.sign, s.ink, p.chance(0.5) ? 'disc' : 'board'), side * (W / 2 - 0.22), G + 0.88, fz));
    }
  } else {
    // One storey with a tall false front carrying the big shop sign.
    g.add(at(signBoard(p, W * 0.74, 0.36, s.sign, s.ink), 0, G + 0.36, fz));
  }
  g.add(at(cornice(p, W - 0.1, dressing(s), s.brick), 0, H, fz));
  const crest = p.pick<ParapetStyle>(['flat', 'stepped', 'peak', 'arch']);
  const top = flatRoof(g, p, W, D, H, 0, cz, p.int(2), dressing(s));
  g.add(at(parapetCrest(p, W, crest, s.wall, dressing(s)), 0, H + 0.1, fz - 0.02));
  if (p.chance(0.3)) g.add(at(roofGarden(p, 1.6), p.range(-0.3, 0.3), top, cz - 0.55));
  else roofClutter(g, p, top, -W / 2 + 0.3, W / 2 - 0.3, cz - D / 2 + 0.3, fz - 0.45, s.wall, 1 + p.int(2));
  // Back: service door + windows; exposed right side may carry a faded painted ad.
  g.add(onFace(doorUnit(p, { w: 0.5, leaf: ['dtDoor', 0], glass: false, surround: null, main: false }), 'back', W, D, 0.7, 0, 0, cz));
  g.add(onFace(wallLamp(p), 'back', W, D, 0.7, 1.2, 0, cz));
  g.add(onFace(plainWindow(p, 0.5, 0.4, dressing(s)), 'back', W, D, -0.5, 0.75, 0, cz));
  if (storeys === 2) for (const u of [-0.7, 0.4]) g.add(onFace(plainWindow(p, 0.46, 0.55, dressing(s)), 'back', W, D, u, G + 0.5, 0, cz));
  if (s.brick && p.chance(0.4)) g.add(onFace(ghostSign(p, 1.3, Math.min(0.7, H - G - 0.1), s), 'right', W, D, 0, (H + G) / 2 + 0.05, 0, cz));
  if (p.chance(0.5)) g.add(at(pottedShrub(p), door === 'right' ? -1.18 : 1.18, 0, fz + 0.32));
  return g;
}

// ------------------------------------------------------------------------------------------------ dt.shopRow

export function buildShopRow(p: Dk, _params: AssetParams): THREE.Group {
  const g = new THREE.Group();
  const total = 7, gap = 0.04;
  const w1 = 2.25 + p.range(0, 0.35), w3 = 2.25 + p.range(0, 0.35), w2 = total - w1 - w3;
  const widths = [w1, w2, w3];
  // Skyline: one 3-storey unit, the others 2-storey with crests; never three equal heights.
  const tall = p.int(3);
  let x = -total / 2;
  let prevAwning = -1;
  let roundUsed = false;
  widths.forEach((uw, i) => {
    const s = scheme(p);
    if (s.awning === prevAwning) s.awning = (s.awning + 1) % 5;
    prevAwning = s.awning;
    const fz = 0.95, W = uw - gap, D = 2.4 - p.range(0, 0.15), cx = x + uw / 2, cz = fz - D / 2;
    const storeys = i === tall ? 2 : 1;
    const H = G + S * storeys + (storeys === 2 ? 0.12 : FRIEZE);
    g.add(at(p.soft(W, H, D, 0.08, s.wall), cx, H / 2, cz));
    const door = p.pick(['left', 'right', 'center'] as const);
    let aw = p.pick(['shed', 'round', s.striped ? 'shed' : 'none'] as const);
    if (aw === 'round' && roundUsed) aw = 'shed';
    roundUsed ||= aw === 'round';
    g.add(at(storefront(p, W - 0.14, G, { scheme: s, door, awning: aw }), cx, 0, fz));
    const n = W > 2.3 ? 3 : 2, span = W - 0.9;
    const us = n === 3 ? [-span / 2, 0, span / 2] : [-span / 3, span / 3];
    upperWindows(g, p, 'front', W, D, cx, cz, us, G, storeys, n === 3 ? 0.4 : 0.44, 0.6, s, storeys === 1 && n === 2 && p.chance(0.5));
    g.add(at(cornice(p, W - 0.08, dressing(s), false), cx, H, fz));
    const top = flatRoof(g, p, W, D, H, cx, cz, p.int(2), dressing(s));
    if (storeys === 1) g.add(at(parapetCrest(p, W, p.pick<ParapetStyle>(['stepped', 'peak', 'arch', 'flat']), s.wall, dressing(s)), cx, H + 0.1, fz - 0.02));
    if (storeys === 1) roofClutter(g, p, top, cx - W / 2 + 0.3, cx + W / 2 - 0.3, cz - D / 2 + 0.3, fz - 0.4, s.wall, 1);
    if (storeys === 2 && p.chance(0.5)) g.add(at(bladeSign(p, s.sign, s.ink, 'board'), cx + (door === 'left' ? 1 : -1) * (W / 2 - 0.2), G + 0.9, fz));
    g.add(onFace(plainWindow(p, 0.44, 0.55, dressing(s)), 'back', W, D, 0, G + 0.5, cx, cz));
    const bu = p.range(-0.4, 0.4);
    g.add(onFace(doorUnit(p, { w: 0.48, leaf: ['dtDoor', 0], glass: false, surround: null, main: false }), 'back', W, D, bu, 0, cx, cz));
    if (i !== 1) g.add(onFace(wallLamp(p), 'back', W, D, bu, 1.2, cx, cz));
    x += uw;
  });
  return g;
}

// ------------------------------------------------------------------------------------------------ dt.cafe

export function buildCafe(p: Dk, _params: AssetParams): THREE.Group {
  const g = new THREE.Group();
  const s = scheme(p, p.chance(0.6) ? 'paint' : 'brick');
  s.striped = true;
  const W = 2.9, D = 1.9, cz = -1.45 + D / 2, fz = cz + D / 2, H = G + S + 0.1;
  g.add(at(p.rbox(W, H, D, 0.08, s.wall), 0, H / 2, cz));
  const door = p.pick(['left', 'right'] as const);
  g.add(at(storefront(p, W - 0.16, G, { scheme: s, door, awning: 'shed' }), 0, 0, fz));
  // Upstairs: two windows with flower boxes, a round blade sign.
  for (const u of [-0.68, 0.68]) {
    g.add(at(windowUnit(p, 0.5, 0.56, { lintel: dressing(s), sill: null, bars: 'cross' }), u, G + 0.55, fz));
    g.add(at(flowerBox(p, 0.62, p.int(5)), u, G + 0.22, fz));
  }
  g.add(at(bladeSign(p, s.sign, s.ink, 'disc'), (door === 'left' ? 1 : -1) * (W / 2 - 0.2), G + 0.92, fz));
  g.add(at(cornice(p, W - 0.1, dressing(s), false), 0, H, fz));
  const top = flatRoof(g, p, W, D, H, 0, cz, p.int(2), dressing(s));
  g.add(at(parapetCrest(p, W, p.pick<ParapetStyle>(['peak', 'stepped']), s.wall, dressing(s)), 0, H + 0.1, fz - 0.02));
  g.add(at(p.chance(0.5) ? acUnit(p) : vent(p), p.range(-0.8, 0.8), top, cz - 0.3));
  // Terrace: two tables with chairs, potted shrubs at the corners, a menu board.
  const chair: RoleRef = p.chance(0.5) ? ['dtWood', 0] : ['dtFront', s.front];
  g.add(at(cafeTable(p, chair), -0.72, 0, fz + 0.55));
  g.add(at(cafeTable(p, chair), 0.72, 0, fz + 0.6));
  for (const sx of [-1, 1]) g.add(at(pottedShrub(p, 0.15), sx * 1.28, 0, fz + 0.86));
  const board = new THREE.Group();
  for (const sz of [-1, 1]) {
    const leaf = p.box(0.26, 0.4, 0.03, ['dtSign', 0]);
    leaf.rotation.x = sz * 0.16;
    board.add(at(leaf, 0, 0.19, sz * 0.035));
  }
  board.add(at(p.box(0.18, 0.2, 0.01, ['dtInk', 2]), 0, 0.22, 0.07));
  g.add(p.detail(at(board, 0, 0, fz + 0.95)));
  g.add(onFace(doorUnit(p, { w: 0.48, leaf: ['dtDoor', 0], glass: false, surround: null, main: false }), 'back', W, D, 0.6, 0, 0, cz));
  g.add(onFace(wallLamp(p), 'back', W, D, 0.6, 1.2, 0, cz));
  g.add(onFace(plainWindow(p, 0.46, 0.5, dressing(s)), 'back', W, D, -0.6, G + 0.5, 0, cz));
  return g;
}

// ------------------------------------------------------------------------------------------------ dt.corner

/** Square footprint (half-side a) with its +x/+z corner cut by a chamfer of leg c. */
function chamferPoly(a: number, c: number): V2[] {
  return [[-a, -a], [a, -a], [a, a - c], [a - c, a], [-a, a]];
}

export function buildCorner(p: Dk, _params: AssetParams): THREE.Group {
  const g = new THREE.Group();
  const s = scheme(p, p.chance(0.8) ? 'brick' : 'paint');
  const a = 1.65, c = 1.0, H = G + 2 * S + 0.2, side = 2 * a;
  g.add(p.extrudeY(chamferPoly(a, c), H, s.wall, 0.04));
  // Roof: chamfered coping + membrane.
  const d = 0.05;
  g.add(at(p.extrudeY(chamferPoly(a + d, c + d * (2 - Math.SQRT2)), 0.1, dressing(s), 0.02), 0, H, 0));
  g.add(at(p.extrudeY(chamferPoly(a - 0.14, Math.max(0.2, c - 0.14 * (2 - Math.SQRT2))), 0.02, ['dtRoof', p.int(2)], 0), 0, H + 0.1, 0));
  const top = H + 0.12;
  // Two street faces: storefronts with matching awnings, two storeys of windows, cornice, belt course.
  const faceW = side - c, mid = -a + faceW / 2;
  const sfW = faceW - 0.35, sfC = mid - 0.08;
  for (const face of ['front', 'right'] as Face[]) {
    const u = face === 'front' ? sfC : -sfC;
    g.add(onFace(storefront(p, sfW, G, { scheme: s, door: face === 'front' ? 'left' : 'right', awning: s.striped ? 'shed' : 'round' }), face, side, side, u, 0));
    const us = [-1.22, -0.5, 0.22].map((x) => (face === 'front' ? x : -x));
    upperWindows(g, p, face, side, side, 0, 0, us, G - 0.02, 2, 0.46, 0.6, s);
    g.add(onFace(cornice(p, faceW - 0.1, dressing(s), s.brick), face, side, side, face === 'front' ? mid - 0.05 : -(mid - 0.05), H));
    g.add(p.detail(onFace(p.box(faceW - 0.1, 0.07, 0.05, dressing(s)), face, side, side, face === 'front' ? mid - 0.05 : -(mid - 0.05), G + 0.04)));
  }
  // Chamfer: entrance under an engaged turret with a copper cap.
  const m = a - c / 2, rot = Math.PI / 4;
  const entry = doorUnit(p, { w: 0.58, h: 0.95, leaf: ['dtDoor', s.door], transom: false, surround: dressing(s), step: STONE_DARK });
  entry.rotation.y = rot;
  g.add(at(entry, m, 0, m));
  const tr = 0.5, yb = G + 0.15, yt = H + 0.2;
  const corbel = p.cone(tr, 0.42, s.wall, 12);
  corbel.rotation.x = Math.PI;
  g.add(at(corbel, m, yb - 0.21, m));
  g.add(at(p.cyl(tr, tr, yt - yb, s.wall, 12), m, (yb + yt) / 2, m));
  g.add(at(p.cyl(tr + 0.04, tr + 0.04, 0.08, dressing(s), 12), m, yt - 0.04, m));
  g.add(p.detail(at(p.cyl(tr + 0.03, tr + 0.03, 0.06, dressing(s), 12), m, yb + 0.03, m)));
  g.add(at(p.cone(tr + 0.1, 0.5, ['dtCopper', 0], 12), m, yt + 0.25, m));
  g.add(p.detail(at(p.sphere(0.05, ['dtInk', 1], 6), m, yt + 0.52, m)));
  for (const f of [0, 1]) for (const da of [-0.62, 0, 0.62]) {
    const th = rot + da, win = windowUnit(p, 0.24, 0.48, { lintel: null, sill: dressing(s), bars: 'none' });
    win.rotation.y = th;
    g.add(at(win, m + Math.sin(th) * (tr - 0.012), G + 0.525 + f * S, m + Math.cos(th) * (tr - 0.012)));
  }
  // Quiet back and left faces.
  for (const face of ['back', 'left'] as Face[]) for (let f = 0; f < 2; f++) for (const u of [-0.7, 0.7]) {
    g.add(onFace(plainWindow(p, 0.44, 0.55, dressing(s)), face, side, side, u, G + 0.525 + f * S));
  }
  g.add(onFace(doorUnit(p, { w: 0.5, leaf: ['dtDoor', 0], glass: false, surround: null, main: false }), 'back', side, side, 0, 0));
  g.add(onFace(wallLamp(p), 'back', side, side, 0, 1.2));
  if (p.chance(0.35)) {
    g.add(at(roofGarden(p, 1.5), -0.45, top, -a + 0.55));
    g.add(at(acUnit(p), -1.05, top, 0.1));
  } else roofClutter(g, p, top, -a + 0.35, a - 0.9, -a + 0.35, a - 0.9, s.wall, 2);
  return g;
}

// ------------------------------------------------------------------------------------------------ dt.midrise

export function buildMidrise(p: Dk, _params: AssetParams): THREE.Group {
  const g = new THREE.Group();
  const s = scheme(p, p.chance(0.75) ? 'brick' : 'paint');
  const W = 3.9, D = 3.45, cz = -1.85 + D / 2, fz = cz + D / 2, floors = 3, H = G + S * floors + FRIEZE;
  g.add(at(p.rbox(W, H, D, 0.09, s.wall), 0, H / 2, cz));
  const sideDoor = p.pick(['left', 'right'] as const);
  g.add(at(storefront(p, W - 0.18, G, { scheme: s, door: 'center', sideDoor }), 0, 0, fz));
  const style = p.pick(['grid', 'bays', 'pilasters'] as const);
  const dress = dressing(s);
  if (style === 'bays') {
    // Two three-storey bay windows framing a narrow centre column.
    for (const u of [-1.05, 1.05]) {
      const bh = S * floors - 0.18, bw = 1.0, bd = 0.3;
      g.add(at(p.soft(bw, bh, bd, 0.05, s.brick ? STONE : s.wall), u, G + 0.08 + bh / 2, fz + bd / 2));
      g.add(at(p.box(bw + 0.1, 0.08, bd + 0.08, ['dtCopper', 0]), u, G + 0.12 + bh, fz + bd / 2 + 0.02));
      for (let f = 0; f < floors; f++) g.add(at(windowUnit(p, 0.66, 0.58, { lintel: null, sill: null, bars: 'v', frame: TRIM }), u, G + 0.55 + f * S, fz + bd));
    }
    upperWindows(g, p, 'front', W, D, 0, cz, [0], G, floors, 0.34, 0.6, s);
  } else {
    upperWindows(g, p, 'front', W, D, 0, cz, [-1.15, 0, 1.15], G, floors, 0.5, 0.62, s, style === 'pilasters' && p.chance(0.6));
    if (style === 'pilasters') {
      for (const u of [-1.78, -0.58, 0.58, 1.78]) g.add(at(p.box(0.14, S * floors - 0.05, 0.06, dress), u, G + (S * floors) / 2 - 0.02, fz + 0.03));
    } else {
      for (let f = 1; f < floors; f++) g.add(p.detail(at(p.box(W - 0.1, 0.06, 0.04, dress), 0, G + f * S - 0.02, fz + 0.02)));
    }
  }
  g.add(p.detail(at(p.box(W - 0.06, 0.09, 0.06, dress), 0, G + 0.03, fz + 0.03)));
  g.add(at(cornice(p, W - 0.08, dress, true, 0.2), 0, H, fz));
  const top = flatRoof(g, p, W, D, H, 0, cz, p.int(2), dress);
  if (p.chance(0.5)) g.add(at(parapetCrest(p, W, 'stepped', s.wall, dress), 0, H + 0.1, fz - 0.02));
  // Sides and back.
  for (const face of ['right', 'left'] as Face[]) upperWindows(g, p, face, W, D, 0, cz, [-0.9, 0.9], G, floors, 0.44, 0.58, s, false, true);
  for (let f = 0; f < floors; f++) for (const u of [-1.2, 0, 1.2]) g.add(onFace(plainWindow(p, 0.44, 0.56, dress), 'back', W, D, u, G + 0.55 + f * S, 0, cz));
  g.add(onFace(doorUnit(p, { w: 0.5, leaf: ['dtDoor', 0], glass: false, surround: null, main: false }), 'back', W, D, 0.6, 0, 0, cz));
  g.add(onFace(wallLamp(p), 'back', W, D, 0.6, 1.2, 0, cz));
  if (p.chance(0.5)) g.add(onFace(fireEscape(p, floors), 'back', W, D, -0.6, G - 0.1, 0, cz));
  // Roof: a wooden water tank or a stair hut, plus a unit.
  if (p.chance(0.6)) g.add(at(waterTank(p), p.range(-0.9, 0.9), top, cz - 0.55));
  else g.add(at(stairHut(p, s.wall), -0.9, top, cz - 0.6));
  g.add(at(acUnit(p), 0.95, top, cz + 0.65));
  return g;
}

/** Iron fire escape facing +z: a landing + rail per storey and stair flights between them. */
function fireEscape(p: Dk, floors: number): THREE.Group {
  const g = new THREE.Group();
  const dep = 0.32;
  for (let f = 0; f < floors; f++) {
    const y = f * S;
    g.add(at(p.box(1.3, 0.03, dep, IRON), 0, y, dep / 2));
    g.add(at(p.box(1.3, 0.03, 0.02, IRON), 0, y + 0.26, dep));
    if (f > 0) {
      const flight = p.box(1.3, 0.03, 0.24, IRON);
      flight.rotation.z = (f % 2 ? 1 : -1) * 0.75;
      g.add(at(flight, 0.05, y - S / 2, dep / 2 + 0.02));
    }
  }
  return p.detail(g);
}

