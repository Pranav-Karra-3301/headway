// Owner: A6 street. Park bench + café table with umbrella. Front faces +z; base at y = 0.
import * as THREE from 'three';
import type { AssetParams, KitContext } from '../../types';
import { variants } from './roles';
import { at, box, coneSector, extrude, group, pick, rotX, rotY, rotZ } from './prims';

/** Cast-iron bench side in the z-y plane (front at +z): front leg, seat rail, raked back leg rising into the back support. */
function benchSide(): THREE.Shape {
  const pts: Array<[number, number]> = [[0.18, 0], [0.18, 0.255], [-0.125, 0.255], [-0.185, 0.52], [-0.235, 0.51], [-0.17, 0], [-0.115, 0], [-0.09, 0.205], [0.13, 0.205], [0.13, 0]];
  const s = new THREE.Shape();
  pts.forEach(([u, v], i) => (i ? s.lineTo(u, v) : s.moveTo(u, v)));
  s.closePath();
  return s;
}

/** Park bench (1.2 × 0.5): three wooden seat slats, two raked back slats, cast-iron sides with armrests. Faces +z. */
export function buildBench(k: KitContext, _p: AssetParams): THREE.Object3D {
  const iron = k.mat('post'), wood = k.mat('bench');
  const g = group('st.bench');
  for (const z of [0.14, 0.03, -0.08]) g.add(at(box(k, 1.16, 0.04, 0.1, wood), 0, 0.275, z));
  const rake = Math.atan2(0.06, 0.265);
  for (const y of [0.37, 0.47]) g.add(at(rotX(box(k, 1.16, 0.08, 0.03, wood), -rake), 0, y, -0.125 - (0.06 * (y - 0.255)) / 0.265 + 0.012));
  for (const x of [-0.47, 0.47]) {
    g.add(at(rotY(extrude(k, 'benchSide', benchSide, 0.04, iron, 0.006, 1), -Math.PI / 2), x, 0.006, 0));
    g.add(k.detail(at(box(k, 0.055, 0.035, 0.33, iron), x, 0.385, -0.02)));
    g.add(k.detail(at(box(k, 0.04, 0.12, 0.04, iron), x, 0.32, 0.12)));
  }
  return g;
}

/** Café table with a striped umbrella and two bistro chairs. params.color picks the awning colour (0–2). */
export function buildTableUmbrella(k: KitContext, p: AssetParams): THREE.Object3D {
  const iron = k.mat('post'), paint = k.mat('stPaint');
  const c = pick(k, p, variants('awning'));
  const cloth = k.mat('awning', c), stripe = k.mat('stripe');
  const g = group('st.tableUmbrella');
  // table
  g.add(at(k.cyl(0.13, 0.15, 0.03, iron, 10), 0, 0.015, 0));
  g.add(at(k.cyl(0.024, 0.024, 0.4, iron, 6), 0, 0.22, 0));
  g.add(at(k.cyl(0.3, 0.3, 0.035, paint, 16), 0, 0.43, 0));
  // umbrella: pole, 8 alternating panels, valance, finial
  g.add(at(k.cyl(0.017, 0.017, 0.88, k.mat('stPaint'), 6), 0, 0.88, 0));
  const panels = 8, R = 0.58, H = 0.25, y0 = 1.1;
  for (let i = 0; i < panels; i++) g.add(at(coneSector(k, R, H, (i * Math.PI * 2) / panels, (Math.PI * 2) / panels, i % 2 ? stripe : cloth), 0, y0, 0));
  g.add(k.detail(at(k.cyl(R * 0.985, R * 0.985, 0.06, cloth, 16), 0, y0 - 0.025, 0)));
  g.add(k.detail(at(k.cone(0.03, 0.07, paint, 6), 0, y0 + H + 0.03, 0)));
  // two chairs facing the table
  for (const s of [-1, 1]) {
    const chair = group('chair');
    chair.add(at(k.cyl(0.1, 0.1, 0.03, paint, 10), 0, 0.25, 0));
    chair.add(at(k.cyl(0.018, 0.022, 0.24, iron, 5), 0, 0.12, 0));
    chair.add(at(rotZ(box(k, 0.025, 0.13, 0.17, paint), -0.18), 0.1, 0.34, 0));
    chair.add(k.detail(at(rotZ(box(k, 0.02, 0.1, 0.02, iron), -0.18), 0.095, 0.295, 0)));
    chair.add(k.detail(at(k.cyl(0.07, 0.08, 0.02, iron, 8), 0, 0.01, 0)));
    chair.position.x = s * 0.43;
    chair.rotation.y = s > 0 ? 0 : Math.PI;
    g.add(chair);
  }
  return g;
}
