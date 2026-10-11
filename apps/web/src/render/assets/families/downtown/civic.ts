// Owner: A1. Downtown civic buildings: dt.theater, dt.bank, dt.garage.
// Footprint centred on the origin, ground at y = 0, street front toward +z.
import * as THREE from 'three';
import type { AssetParams } from '../../types';
import {
  acUnit, at, DARK, doorUnit, Dk, flatRoof, IRON, onFace, plainWindow, pottedShrub, scheme, STONE, STONE_DARK, TRIM, tinyCar,
  vent, windowUnit, type Face, type RoleRef,
} from './parts';

const TRIM_REF: RoleRef = TRIM;
const CANVAS_RED: RoleRef = ['dtAwning', 0];

// ------------------------------------------------------------------------------------------------ dt.theater

export function buildTheater(p: Dk, _params: AssetParams): THREE.Group {
  const g = new THREE.Group();
  const s = scheme(p, p.chance(0.6) ? 'paint' : 'brick');
  const W = 4.7, D = 3.15, cz = -2 + D / 2, fz = cz + D / 2, H = 3.05;
  const dress: RoleRef = s.brick ? STONE : TRIM;
  const marquee = p.pick([0, 1, 2, 4]);
  g.add(at(p.rbox(W, H, D, 0.09, s.wall), 0, H / 2, cz));
  // Stage house: the taller block at the back gives the theatre its stepped silhouette.
  g.add(at(p.rbox(3.2, H + 0.45, 1.2, 0.08, s.wall), 0, (H + 0.45) / 2, cz - D / 2 + 0.62));
  flatRoof(g, p, 3.2, 1.2, H + 0.45, 0, cz - D / 2 + 0.62, 1, dress);
  const top = flatRoof(g, p, W, D, H, 0, cz, 0, dress);
  // Deco pilasters framing the entrance bay, rising past the parapet with stepped caps.
  for (const x of [-2.12, -1.5, 1.5, 2.12]) {
    const ph = H + (Math.abs(x) < 2 ? 0.42 : 0.24);
    g.add(at(p.box(0.22, ph, 0.12, dress), x, ph / 2, fz + 0.05));
    g.add(p.detail(at(p.box(0.3, 0.08, 0.18, dress), x, ph + 0.04, fz + 0.05)));
  }
  // Raised centre parapet behind the blade sign.
  g.add(at(p.box(2.8, 0.36, 0.22, s.wall), 0, H + 0.18 + 0.1, fz - 0.12));
  g.add(at(p.box(2.9, 0.07, 0.3, dress), 0, H + 0.1 + 0.4, fz - 0.12));
  for (const x of [-0.9, 0.9]) g.add(p.detail(at(p.box(0.08, 0.26, 0.03, dress), x, H + 0.26, fz + 0.005)));
  // Entrance: recessed lobby, two pairs of glass doors, a ticket booth in the middle.
  g.add(at(p.box(2.7, 1.35, 0.04, DARK), 0, 0.675, fz + 0.02));
  for (const x of [-0.85, 0.85]) {
    g.add(at(doorUnit(p, { w: 0.62, h: 1.05, leaf: ['dtFront', s.front], glass: true, recess: false, transom: true, surround: TRIM }), x, 0, fz + 0.03));
  }
  const booth = new THREE.Group();
  booth.add(at(p.soft(0.6, 0.62, 0.48, 0.06, ['dtFront', s.front]), 0, 0.31, 0));
  booth.add(at(p.box(0.54, 0.36, 0.42, ['window', 1]), 0, 0.8, 0));
  booth.add(at(p.soft(0.68, 0.08, 0.56, 0.05, ['dtSign', marquee]), 0, 1.02, 0));
  g.add(at(booth, 0, 0, fz + 0.32));
  // Poster cases between the pilasters.
  for (const x of [-1.81, 1.81]) {
    g.add(at(p.box(0.42, 0.66, 0.04, TRIM), x, 0.78, fz + 0.02));
    g.add(at(p.box(0.34, 0.56, 0.02, ['dtSign', p.int(5)]), x, 0.78, fz + 0.05));
    g.add(p.detail(at(p.box(0.22, 0.08, 0.01, ['dtInk', 2]), x, 0.92, fz + 0.065)));
    g.add(p.detail(at(p.disc(0.07, 0.01, ['dtInk', 1], 10), x, 0.68, fz + 0.06)));
  }
  // Marquee: coloured box, white letter boards with shape "letters", a glowing soffit and edge strip.
  const mw = 3.0, md = 0.78, my = 1.48, mh = 0.42;
  g.add(at(p.box(mw, mh, md, ['dtSign', marquee]), 0, my + mh / 2, fz + md / 2));
  g.add(at(p.box(mw - 0.1, 0.03, md - 0.1, ['lamp', 0]), 0, my - 0.005, fz + md / 2));
  g.add(at(p.box(mw + 0.04, 0.05, md + 0.04, ['lamp', 0]), 0, my + mh + 0.025, fz + md / 2));
  g.add(at(p.box(mw - 0.2, mh - 0.14, 0.02, ['dtInk', 2]), 0, my + mh / 2, fz + md + 0.01));
  for (const sx of [-1, 1]) g.add(at(p.box(0.02, mh - 0.14, md - 0.2, ['dtInk', 2]), sx * (mw / 2 + 0.01), my + mh / 2, fz + md / 2 + 0.04));
  const rows = [my + mh / 2 + 0.06, my + mh / 2 - 0.06];
  rows.forEach((y, r) => {
    let x = -mw / 2 + 0.25 + r * 0.12;
    while (x < mw / 2 - 0.35) {
      const w = 0.1 + p.int(4) * 0.06;
      g.add(p.detail(at(p.box(w, 0.06, 0.012, ['dtSign', 0]), x + w / 2, y, fz + md + 0.025)));
      x += w + 0.08 + (p.chance(0.25) ? 0.12 : 0);
    }
  });
  // Vertical blade sign standing on the marquee: letters as stacked discs, a bulb strip, a star on top.
  const vy0 = my + mh + 0.05, vh = 2.1, vz = fz + 0.42, blade = p.pick([0, 1, 2, 4].filter((i) => i !== marquee));
  g.add(at(p.box(0.14, vh, 0.62, ['dtSign', blade]), 0, vy0 + vh / 2, vz));
  g.add(at(p.box(0.16, vh, 0.05, ['lamp', 0]), 0, vy0 + vh / 2, vz + 0.33));
  g.add(at(p.box(0.16, 0.05, 0.62, ['lamp', 0]), 0, vy0 + vh + 0.025, vz));
  for (let i = 0; i < 4; i++) {
    const d = p.cyl(0.16, 0.16, 0.18, ['dtInk', p.chance(0.5) ? 0 : 2], 12);
    d.rotation.z = Math.PI / 2;
    g.add(at(d, 0, vy0 + 0.38 + i * 0.44, vz - 0.02));
  }
  g.add(at(p.sphere(0.11, ['lamp', 0], 8), 0, vy0 + vh + 0.16, vz));
  // Plain sides: an exit door with a little canopy on the right, a few high windows.
  g.add(onFace(doorUnit(p, { w: 0.55, leaf: ['dtDoor', 0], glass: false, main: false }), 'right', W, D, 0.6, 0, 0, cz));
  for (const face of ['right', 'left'] as Face[]) for (const u of [-0.9, 0.1, 1.1]) g.add(onFace(plainWindow(p, 0.32, 0.4, dress), face, W, D, u, 2.45, 0, cz));
  g.add(at(acUnit(p), 1.4, top, cz + 0.3));
  g.add(at(vent(p), -1.5, top, cz + 0.5));
  return g;
}

// ------------------------------------------------------------------------------------------------ dt.bank

export function buildBank(p: Dk, _params: AssetParams): THREE.Group {
  const g = new THREE.Group();
  const stone: RoleRef = ['dtStone', p.chance(0.75) ? 0 : 1];
  const accent = p.int(5);
  const bw = 3.5, bd = 2.75, bz = -1.95 + 0.1 + bd / 2, fz = bz + bd / 2, base = 0.3, bh = 2.55;
  // Plinth, body, rusticated base courses, cornice, copper hip roof.
  g.add(at(p.soft(bw + 0.2, base, bd + 0.2, 0.06, STONE_DARK), 0, base / 2, bz));
  g.add(at(p.rbox(bw, bh, bd, 0.06, stone), 0, base + bh / 2, bz));
  for (const y of [0.62, 0.95]) {
    g.add(p.detail(at(p.box(bw + 0.01, 0.03, bd + 0.01, STONE_DARK), 0, base + y, bz)));
  }
  const ct = base + bh;
  g.add(at(p.box(bw + 0.24, 0.16, bd + 0.24, TRIM), 0, ct + 0.08, bz));
  g.add(p.detail(at(p.box(bw + 0.12, 0.06, bd + 0.12, STONE_DARK), 0, ct - 0.02, bz)));
  g.add(at(p.hip(bw + 0.1, bd + 0.1, 0.5, 0.75, ['dtCopper', 0]), 0, ct + 0.16, bz));
  // Portico: three steps, four columns with bases and capitals, entablature, pediment with a clock.
  const pz0 = fz, pd = 1.05, pw = 2.6;
  for (let i = 0; i < 3; i++) g.add(at(p.box(pw + 0.3 - i * 0.12, 0.1, pd + 0.02 - i * 0.16, STONE_DARK), 0, 0.05 + i * 0.1, pz0 + (pd + 0.02 - i * 0.16) / 2 - 0.01));
  const colH = 1.95, colY = base;
  for (const x of [-1.0, -0.34, 0.34, 1.0]) {
    g.add(at(p.cyl(0.11, 0.125, colH, TRIM, 10), x, colY + colH / 2, pz0 + 0.62));
    g.add(p.detail(at(p.box(0.3, 0.07, 0.3, TRIM), x, colY + 0.035, pz0 + 0.62)));
    g.add(p.detail(at(p.box(0.3, 0.08, 0.3, TRIM), x, colY + colH - 0.04, pz0 + 0.62)));
  }
  const ey = colY + colH;
  g.add(at(p.box(pw + 0.1, 0.3, 0.86, TRIM), 0, ey + 0.15, pz0 + 0.42));
  g.add(p.detail(at(p.box(pw + 0.12, 0.05, 0.04, STONE_DARK), 0, ey + 0.07, pz0 + 0.86)));
  g.add(at(p.gable(pw + 0.2, 0.5, 0.86, TRIM), 0, ey + 0.3, pz0 - 0.01));
  const clock = new THREE.Group();
  clock.add(at(p.disc(0.16, 0.03, ['dtSign', 0], 16), 0, 0, 0));
  clock.add(at(p.disc(0.13, 0.04, TRIM, 16), 0, 0, 0));
  const hand = (len: number, ang: number) => {
    const h = p.box(0.025, len, 0.01, ['dtSign', 0]);
    h.geometry.translate(0, len / 2, 0);
    h.rotation.z = ang;
    return at(h, 0, 0, 0.045);
  };
  clock.add(hand(0.07, 2.1), hand(0.11, -0.5));
  g.add(p.detail(at(clock, 0, ey + 0.48, pz0 + 0.85)));
  // Bronze doors with a transom behind the columns; lamp globes on posts by the steps.
  g.add(at(doorUnit(p, { w: 0.74, h: 1.3, leaf: ['dtDoor', accent === 1 ? 2 : 0], glass: false, transom: true, surround: STONE_DARK, recess: true }), 0, base, fz));
  for (const sx of [-1, 1]) {
    const lamp = new THREE.Group();
    lamp.add(at(p.cyl(0.035, 0.05, 0.62, IRON, 8), 0, 0.31, 0));
    lamp.add(at(p.sphere(0.09, ['lamp', 0], 8), 0, 0.7, 0));
    g.add(p.detail(at(lamp, sx * 1.42, 0.0, pz0 + 0.98)));
  }
  // Tall windows: two on each side flanking the portico on the front, three down each side, three at the back.
  const tall = (o: Face, u: number) => g.add(onFace(windowUnit(p, 0.38, 1.0, { lintel: STONE_DARK, sill: STONE_DARK, bars: 'cross', frame: TRIM }), o, bw, bd, u, base + 1.15, 0, bz));
  for (const u of [-1.5, 1.5]) tall('front', u);
  for (const u of [-0.85, 0, 0.85]) { tall('right', u); tall('left', u); tall('back', u); }
  for (const sx of [-1, 1]) g.add(at(pottedShrub(p, 0.16), sx * 1.62, 0, pz0 + 0.62));
  return g;
}

// ------------------------------------------------------------------------------------------------ dt.garage

export function buildGarage(p: Dk, _params: AssetParams): THREE.Group {
  const g = new THREE.Group();
  const conc: RoleRef = ['dtConcrete', 0], conc2: RoleRef = ['dtConcrete', 1];
  const brick: RoleRef = ['dtBrick', p.int(4)];
  const x0 = -3.0, x1 = 2.0, z0 = -2.45, z1 = 2.45, dw = x1 - x0, dd = z1 - z0, dcx = (x0 + x1) / 2;
  const levels = [0.95, 1.9, 2.85];
  const slab = 0.12, wallH = 0.32;
  // Ground pad, slabs, spandrel bands (the horizontal stripes of a parking deck), columns.
  g.add(at(p.box(dw, 0.04, dd, conc2), dcx, 0.02, 0));
  for (const y of levels) {
    g.add(at(p.box(dw, slab, dd, conc2), dcx, y - slab / 2, 0));
    const bandY = y + wallH / 2;
    g.add(at(p.box(dw + 0.06, wallH, 0.12, conc), dcx, bandY, z1 - 0.03));
    g.add(at(p.box(dw + 0.06, wallH, 0.12, conc), dcx, bandY, z0 + 0.03));
    g.add(at(p.box(0.12, wallH, dd - 0.06, conc), x0 + 0.03, bandY, 0));
    g.add(at(p.box(0.12, wallH, dd - 0.06, conc), x1 - 0.03, bandY, 0));
    g.add(p.detail(at(p.box(dw + 0.08, 0.035, 0.15, STONE_DARK), dcx, y + wallH + 0.017, z1 - 0.03)));
  }
  const colXs = [x0 + 0.1, x0 + dw / 3, x0 + (2 * dw) / 3, x1 - 0.1];
  for (let l = 0; l < levels.length; l++) {
    const yb = l === 0 ? 0 : levels[l - 1]!, yt = levels[l]! - slab;
    for (const x of colXs) for (const z of [z0 + 0.1, z1 - 0.1]) g.add(at(p.box(0.14, yt - yb, 0.14, conc), x, (yb + yt) / 2, z));
  }
  // Entrance: barrier arm and pay post on the front, ground floor; a low wall either side.
  const ex = x0 + 1.25;
  const post = p.soft(0.22, 0.5, 0.22, 0.05, ['dtFront', 4]);
  post.userData.entrance = true;
  g.add(at(post, ex - 0.75, 0.25, z1 - 0.1));
  for (let i = 0; i < 5; i++) g.add(at(p.box(0.22, 0.05, 0.05, i % 2 ? CANVAS_RED : TRIM_REF), ex - 0.55 + i * 0.22, 0.46, z1 - 0.1));
  g.add(at(p.box(dw - 2.1, 0.3, 0.12, conc), x1 - (dw - 2.1) / 2, 0.15, z1 - 0.03));
  // Stair + lift tower (brick) on the front-right corner, with a glazed slot and the P sign.
  const tw = 0.95, td = 1.3, th = 3.55, tx = x1 + tw / 2 + 0.02, tz = z1 - td / 2;
  g.add(at(p.rbox(tw, th, td, 0.07, brick), tx, th / 2, tz));
  g.add(at(p.soft(tw + 0.1, 0.12, td + 0.1, 0.05, STONE), tx, th + 0.06, tz));
  for (let i = 0; i < 3; i++) g.add(at(p.box(0.3, 0.6, 0.04, ['window', i === 1 ? 1 : 0]), tx, 0.95 + i * 0.95, z1 + 0.02));
  g.add(onFace(doorUnit(p, { w: 0.5, leaf: ['dtDoor', 2], glass: true, surround: STONE, main: false }), 'right', tw, td, 0.1, 0, tx, tz));
  const sign = new THREE.Group();
  sign.add(at(p.box(0.62, 0.62, 0.06, ['dtSign', 4]), 0, 0, 0.03));
  const white: RoleRef = ['dtInk', 2];
  sign.add(at(p.box(0.08, 0.4, 0.02, white), -0.09, 0, 0.07));
  sign.add(at(p.box(0.2, 0.07, 0.02, white), 0.0, 0.165, 0.07));
  sign.add(at(p.box(0.2, 0.07, 0.02, white), 0.0, 0.015, 0.07));
  sign.add(at(p.box(0.07, 0.22, 0.02, white), 0.1, 0.09, 0.07));
  g.add(at(sign, tx, th - 0.5, z1 + 0.01));
  g.add(p.detail(at(sign.clone(), tx + tw / 2 + 0.01, th - 0.5, tz)).rotateY(Math.PI / 2));
  // Parked cars on every deck (more on the roof), bay lines on the roof deck, two lamp posts.
  const bays = [x0 + 0.5, x0 + 1.35, x0 + 2.2, x0 + 3.05, x0 + 3.9, x0 + 4.6];
  const rowsZ = [z0 + 0.82, z1 - 0.82];
  const decks = [0.04, ...levels];
  decks.forEach((y, l) => {
    // A few cars per deck in random free bays (more on the roof), never in front of the entrance.
    const free: Array<[number, number]> = [];
    rowsZ.forEach((z, r) => bays.forEach((x, b) => {
      if ((l === 0 && r === 1 && b < 3) || x > x1 - 0.4) return;
      free.push([x, r]);
    }));
    const want = l === decks.length - 1 ? 3 + p.int(2) : 2 + p.int(2);
    for (let i = 0; i < want && free.length; i++) {
      const [x, r] = free.splice(p.int(free.length), 1)[0]!;
      const car = tinyCar(p, p.int(5));
      car.rotation.y = r === 0 ? 0 : Math.PI;
      g.add(p.detail(at(car, x, y, rowsZ[r]!)));
    }
  });
  const roofY = levels[levels.length - 1]!;
  for (const x of bays.slice(0, 5)) for (const z of rowsZ) g.add(p.detail(at(p.box(0.03, 0.01, 1.1, TRIM_REF), x + 0.42, roofY + 0.005, z)));
  for (const [lx, lz] of [[x0 + 1.0, 0], [x1 - 1.4, 0]] as const) {
    g.add(at(p.cyl(0.035, 0.045, 0.75, IRON, 8), lx, roofY + 0.375, lz));
    g.add(at(p.box(0.28, 0.06, 0.12, ['lamp', 0]), lx, roofY + 0.77, lz));
  }
  return g;
}

