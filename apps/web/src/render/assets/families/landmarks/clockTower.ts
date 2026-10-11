// Owner: A4. lm.clockTower — the campus clock tower ("Old Main"), 2.3 × 2.3 × ~8.7, front (door) = +z.
// Limestone plinth, brick shaft with stone quoin pilasters and arched windows, a cream clock stage with four
// faces, an open belfry, a pyramid spire and a gold finial. Hands are separate meshes named 'clockHand'
// (omit them with params.hands = false so FX can drive its own from the sim clock at CLOCK_TOWER_FACES).
import * as THREE from 'three';
import type { AssetParams } from '../../types';
import { archWindow, at, box, clockFace, cyl, doorUnit, group, type Kit, onFace, pyramid, rbox, sphere, type Face } from './parts';

const PLINTH_H = 0.36, SHAFT_W = 1.7, SHAFT_H = 4.3;
const SHAFT_TOP = PLINTH_H + SHAFT_H;            // 4.66
const STAGE_Y0 = SHAFT_TOP + 0.16, STAGE_H = 1.5, STAGE_W = 1.82;
const FACE_Y = STAGE_Y0 + STAGE_H / 2;           // 5.57
const FACE_OUT = STAGE_W / 2 + 0.04;
const FACE_R = 0.6;

/** Clock faces in tower-local coordinates (unscaled, rot 0): centre + yaw; the dial looks along its rotated +z. */
export const CLOCK_TOWER_FACES: ReadonlyArray<{ x: number; y: number; z: number; rotY: number; r: number }> = [
  { x: 0, y: FACE_Y, z: FACE_OUT, rotY: 0, r: FACE_R },
  { x: FACE_OUT, y: FACE_Y, z: 0, rotY: Math.PI / 2, r: FACE_R },
  { x: 0, y: FACE_Y, z: -FACE_OUT, rotY: Math.PI, r: FACE_R },
  { x: -FACE_OUT, y: FACE_Y, z: 0, rotY: -Math.PI / 2, r: FACE_R },
];

export function buildClockTower(k: Kit, params: AssetParams): THREE.Object3D {
  const g = group('clockTower');
  const hands = params.hands !== false;
  const lit = () => k.rand() < 0.4;
  // plinth + entrance step
  g.add(at(rbox(k, 2.3, PLINTH_H, 2.3, 0.08, 'lmStone'), 0, PLINTH_H / 2, 0));
  g.add(k.detail(at(box(k, 0.96, 0.08, 0.2, 'lmStone'), 0, PLINTH_H + 0.04, SHAFT_W / 2 + 0.1)));
  // brick shaft + limestone quoin pilasters + string course
  g.add(at(rbox(k, SHAFT_W, SHAFT_H, SHAFT_W, 0.06, 'brick'), 0, PLINTH_H + SHAFT_H / 2, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(at(box(k, 0.2, SHAFT_H, 0.2, 'lmStone'), sx * 0.79, PLINTH_H + SHAFT_H / 2, sz * 0.79));
  g.add(k.detail(at(box(k, 1.8, 0.1, 1.8, 'lmStone'), 0, 2.62, 0)));
  g.add(k.detail(at(box(k, 1.78, 0.08, 1.78, 'lmStone'), 0, PLINTH_H + 0.12, 0)));
  // door with stone surround, lanterns and a plaque on the front; arched windows elsewhere
  const door = doorUnit(k, { w: 0.6, h: 1.08, canopy: null, step: false });
  g.add(onFace(door, 'front', SHAFT_W, SHAFT_W, 0, PLINTH_H));
  g.add(k.detail(onFace(at(box(k, 0.84, 0.12, 0.08, 'lmStone'), 0, 0, 0.04), 'front', SHAFT_W, SHAFT_W, 0, PLINTH_H + 1.2)));
  g.add(k.detail(onFace(at(box(k, 0.5, 0.2, 0.03, 'lmStone'), 0, 0, 0.015), 'front', SHAFT_W, SHAFT_W, 0, 1.95)));
  for (const u of [-0.46, 0.46]) g.add(k.detail(onFace(at(box(k, 0.09, 0.15, 0.09, 'lamp'), 0, 0, 0.06), 'front', SHAFT_W, SHAFT_W, u, PLINTH_H + 0.82)));
  for (const f of ['front', 'right', 'back', 'left'] as Face[]) {
    if (f !== 'front') g.add(onFace(archWindow(k, 0.4, 0.92, lit()), f, SHAFT_W, SHAFT_W, 0, 1.6));
    g.add(onFace(archWindow(k, 0.4, 0.92, lit()), f, SHAFT_W, SHAFT_W, 0, 3.62));
  }
  // cornice + clock stage
  g.add(at(rbox(k, 1.96, 0.16, 1.96, 0.05, 'lmStone'), 0, SHAFT_TOP + 0.08, 0));
  g.add(at(rbox(k, STAGE_W, STAGE_H, STAGE_W, 0.07, 'tower'), 0, STAGE_Y0 + STAGE_H / 2, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(k.detail(at(box(k, 0.18, STAGE_H, 0.18, 'lmStone'), sx * 0.86, STAGE_Y0 + STAGE_H / 2, sz * 0.86)));
  for (const f of CLOCK_TOWER_FACES) {
    const c = clockFace(k, f.r, hands);
    c.rotation.y = f.rotY;
    g.add(at(c, f.x, f.y, f.z));
  }
  // cornice + open belfry (piers around a dark core) + entablature
  const top = STAGE_Y0 + STAGE_H;
  g.add(at(rbox(k, 2.02, 0.16, 2.02, 0.05, 'lmStone'), 0, top + 0.08, 0));
  const by = top + 0.16, bh = 0.9;
  g.add(at(box(k, 1.0, bh - 0.04, 1.0, 'window'), 0, by + bh / 2, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(at(box(k, 0.26, bh, 0.26, 'column'), sx * 0.62, by + bh / 2, sz * 0.62));
  g.add(k.detail(at(box(k, 1.48, 0.1, 1.48, 'column'), 0, by + 0.05, 0)));
  for (const f of ['front', 'right', 'back', 'left'] as Face[]) {
    g.add(k.detail(onFace(at(cyl(k, 0.012, 0.012, 0.32, 'column', 0, 4), 0, 0.16, 0), f, 1.2, 1.2, -0.25, by + 0.1)));
    g.add(k.detail(onFace(at(cyl(k, 0.012, 0.012, 0.32, 'column', 0, 4), 0, 0.16, 0), f, 1.2, 1.2, 0.25, by + 0.1)));
  }
  g.add(at(box(k, 1.56, 0.18, 1.56, 'column'), 0, by + bh + 0.09, 0));
  // spire + finial
  const sy = by + bh + 0.18;
  g.add(at(pyramid(k, 1.5, 1.5, 1.08, 'towerRoof'), 0, sy, 0));
  g.add(k.detail(at(cyl(k, 0.014, 0.014, 0.34, 'safety', 0, 4), 0, sy + 1.2, 0)));
  g.add(at(sphere(k, 0.075, 'safety', 0, 8), 0, sy + 1.1, 0));
  return g;
}
