// Owner: T2.4. Clock hands driven by the sim clock (scenario clockStart + simT) on every clock face the town shows
// without hands (kit clock tower + kit station clocks built with { hands: false }, A4 lm.clockTower with
// params.hands = false). One InstancedMesh (2 hands per face) on the shared KitMaterial (palette role `hands`).
import * as THREE from 'three';
import { bakeGeometry, box, recolorBaked, type Baked } from '../kit';
import { KitMaterial } from '../materials';
import type { PaletteId } from '../types';
import type { ClockFaceAnchor } from './anchors';

const DAY = 24 * 3600;

/** 'HH:MM' → seconds since midnight (invalid → 12:00). */
export function parseClock(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return 12 * 3600;
  return ((Number(m[1]) % 24) * 3600 + (Number(m[2]) % 60) * 60) % DAY;
}

/** Hand angles (rotation.z of a hand pointing +y on a face looking along +z): 0 = 12 o'clock, clockwise negative. */
export function clockAngles(clockStartS: number, simT: number): { hour: number; minute: number } {
  const t = (((clockStartS + simT) % DAY) + DAY) % DAY;
  return { hour: (-2 * Math.PI * (t % 43200)) / 43200, minute: (-2 * Math.PI * (t % 3600)) / 3600 };
}

/** Hand proportions relative to the face radius (matches the A4 / kit faces). */
const HOUR = { len: 0.55, w: 0.12, z: 0.056 }, MINUTE = { len: 0.84, w: 0.085, z: 0.07 };

export interface ClockHands {
  readonly mesh: THREE.InstancedMesh;
  readonly material: KitMaterial;
  update(clockStartS: number, simT: number): void;
  setPalette(p: PaletteId): void;
  dispose(): void;
}

export function createClockHands(faces: readonly ClockFaceAnchor[], palette: PaletteId = 'a'): ClockHands {
  // unit hand: 1 wide, 1 long from the pivot up (+y), 0.02 deep
  const unit = box(1, 1, 0.02, 'hands');
  unit.position.set(0, 0.5, 0);
  const g = new THREE.Group();
  g.add(unit);
  const baked: Baked = bakeGeometry(g, palette);
  const material = new KitMaterial({ roughness: 0.6 });
  const mesh = new THREE.InstancedMesh(baked.geometry, material, Math.max(1, faces.length * 2));
  mesh.count = faces.length * 2;
  mesh.name = 'fx:clockHands';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const faceM = faces.map((f) => new THREE.Matrix4().compose(
    new THREE.Vector3(f.x, f.y, f.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.rotY), new THREE.Vector3(1, 1, 1)));
  const m = new THREE.Matrix4(), h = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const zAxis = new THREE.Vector3(0, 0, 1);
  let last = NaN;

  const hand = (i: number, face: number, spec: typeof HOUR, angle: number) => {
    const r = faces[face]!.r;
    q.setFromAxisAngle(zAxis, angle);
    h.compose(p.set(0, 0, spec.z), q, s.set(spec.w * r, spec.len * r, 1));
    m.multiplyMatrices(faceM[face]!, h);
    mesh.setMatrixAt(i, m);
  };

  return {
    mesh, material,
    update(clockStartS, simT) {
      const key = Math.round((clockStartS + simT) * 4); // ¼ s of clock time
      if (key === last) return;
      last = key;
      const a = clockAngles(clockStartS, simT);
      for (let f = 0; f < faces.length; f++) {
        hand(f * 2, f, HOUR, a.hour);
        hand(f * 2 + 1, f, MINUTE, a.minute);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    setPalette(pal) { recolorBaked(baked, pal); },
    dispose() { baked.geometry.dispose(); material.dispose(); },
  };
}
