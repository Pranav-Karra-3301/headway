// Owner: A4. lm.waterTower — a classic small-town water tower in the town colours (2.5 × 2.5 × ~6.3):
// four splayed legs on footings with ring and cross braces, a riser pipe with a ladder, a balcony with a
// railing, a cylindrical tank with a coloured band and emblem, a conical roof and a finial.
import * as THREE from 'three';
import type { AssetParams } from '../../types';
import { at, box, cyl, disc, group, type Kit, mesh, rodBetween, sphere } from './parts';

const LEG_TOP = 4.12, BALCONY_Y = 4.16, TANK_Y0 = 4.3, TANK_H = 1.22, TANK_R = 1.06;

export function buildWaterTower(k: Kit, _params: AssetParams): THREE.Object3D {
  const g = group('waterTower');
  const foot = 0.92, top = 0.64;
  const legAt = (sx: number, sz: number, y: number) => {
    const t = y / LEG_TOP, r = foot + (top - foot) * t;
    return new THREE.Vector3(sx * r, y, sz * r);
  };
  const corners: Array<[number, number]> = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  for (const [sx, sz] of corners) {
    g.add(at(box(k, 0.3, 0.14, 0.3, 'curb'), sx * foot, 0.07, sz * foot));
    const leg = rodBetween(k, legAt(sx, sz, 0.1), legAt(sx, sz, LEG_TOP), 0.075, 'lmLeg', 0, 8);
    leg.name = 'leg';
    g.add(leg);
  }
  // ring braces + X braces between neighbouring legs
  const levels = [0.14, 1.45, 2.8, LEG_TOP - 0.05];
  for (let c = 0; c < 4; c++) {
    const [ax, az] = corners[c]!, [bx, bz] = corners[(c + 1) % 4]!;
    for (let l = 1; l < levels.length - 1; l++) g.add(rodBetween(k, legAt(ax, az, levels[l]!), legAt(bx, bz, levels[l]!), 0.035, 'lmLeg', 0, 6));
    for (let l = 0; l < levels.length - 2; l++) {
      g.add(k.detail(rodBetween(k, legAt(ax, az, levels[l]!), legAt(bx, bz, levels[l + 1]!), 0.018, 'lmLeg', 0, 4)));
      g.add(k.detail(rodBetween(k, legAt(bx, bz, levels[l]!), legAt(ax, az, levels[l + 1]!), 0.018, 'lmLeg', 0, 4)));
    }
  }
  // riser pipe + ladder up its front
  g.add(at(cyl(k, 0.15, 0.17, BALCONY_Y, 'lmLeg', 0, 10), 0, BALCONY_Y / 2, 0));
  const ladder = group('ladder');
  for (const x of [-0.11, 0.11]) ladder.add(at(box(k, 0.025, BALCONY_Y - 0.1, 0.025, 'rail'), x, (BALCONY_Y - 0.1) / 2 + 0.05, 0));
  for (let y = 0.4; y < BALCONY_Y - 0.1; y += 0.34) ladder.add(at(box(k, 0.22, 0.02, 0.02, 'rail'), 0, y, 0));
  g.add(k.detail(at(ladder, 0, 0, 0.21)));
  // balcony + railing
  g.add(at(cyl(k, 1.2, 1.2, 0.06, 'rail', 0, 24), 0, BALCONY_Y, 0));
  const rail = group('railing');
  const ring = mesh(k, new THREE.TorusGeometry(1.17, 0.018, 4, 28), 'rail');
  ring.rotation.x = Math.PI / 2;
  rail.add(at(ring, 0, BALCONY_Y + 0.26, 0));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    rail.add(at(box(k, 0.025, 0.26, 0.025, 'rail'), Math.cos(a) * 1.17, BALCONY_Y + 0.13, Math.sin(a) * 1.17));
  }
  g.add(k.detail(rail));
  // tank: bottom cone, drum, town-colour band + emblem, roof, finial
  const tank = group('tank');
  const bottom = cyl(k, TANK_R, 0.12, 0.36, 'lmTank', 0, 24);
  tank.add(at(bottom, 0, TANK_Y0 - 0.18, 0));
  tank.add(at(cyl(k, TANK_R, TANK_R, TANK_H, 'lmTank', 0, 28), 0, TANK_Y0 + TANK_H / 2, 0));
  tank.add(at(cyl(k, TANK_R + 0.015, TANK_R + 0.015, 0.36, 'lmTankBand', 0, 28), 0, TANK_Y0 + 0.66, 0));
  tank.add(k.detail(at(cyl(k, TANK_R + 0.02, TANK_R + 0.02, 0.05, 'lmTank', 0, 28), 0, TANK_Y0 + 0.88, 0)));
  tank.add(k.detail(at(cyl(k, TANK_R + 0.02, TANK_R + 0.02, 0.05, 'lmTank', 0, 28), 0, TANK_Y0 + 0.44, 0)));
  for (const a of [0, Math.PI]) {
    const em = group('emblem');
    em.add(at(disc(k, 0.24, 0.03, 'lmTank', 0, 16), 0, 0, 0));
    em.add(at(disc(k, 0.16, 0.03, 'lmTankBand', 0, 16), 0, 0, 0.012));
    em.add(at(disc(k, 0.08, 0.03, 'safety', 0, 10), 0, 0, 0.024));
    em.rotation.y = a;
    tank.add(k.detail(at(em, Math.sin(a) * (TANK_R + 0.02), TANK_Y0 + 0.66, Math.cos(a) * (TANK_R + 0.02))));
  }
  const roofY = TANK_Y0 + TANK_H;
  tank.add(at(k.cone(TANK_R + 0.08, 0.62, k.mat('towerRoof'), 28), 0, roofY + 0.31, 0));
  tank.add(k.detail(at(cyl(k, TANK_R + 0.1, TANK_R + 0.1, 0.05, 'towerRoof', 0, 28), 0, roofY + 0.02, 0)));
  tank.add(at(sphere(k, 0.09, 'lmTankBand', 0, 10), 0, roofY + 0.66, 0));
  tank.add(k.detail(at(cyl(k, 0.012, 0.012, 0.26, 'post', 0, 4), 0, roofY + 0.86, 0)));
  g.add(tank);
  return g;
}
