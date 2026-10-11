// Owner: T2.1. Visual-only ambient cars (traffic layer). Local frame like the bus: +x forward, y = 0 road top,
// +z = right-hand side. Body panels are tint()-tagged: in an InstancedMesh with instanceColor they take the
// instance colour (palette role `car`), everything else (glass, tyres, lights) keeps its role colour.
import * as THREE from 'three';
import { at, box, cyl, detail, rbox, tint } from './prims';

export const CAR_VARIANTS = ['hatchback', 'van', 'pickup'] as const;
export type CarVariant = (typeof CAR_VARIANTS)[number];

/** Overall size per variant (x = length, y = height, z = width), for spacing and lane offsets. */
export const CAR_SIZE: Record<CarVariant, { length: number; width: number; height: number }> = {
  hatchback: { length: 1.72, width: 0.88, height: 0.7 },
  van: { length: 2.12, width: 0.96, height: 0.93 },
  pickup: { length: 1.97, width: 0.88, height: 0.74 },
};

function wheels(g: THREE.Group, xs: number[], z: number, r: number): void {
  for (const x of xs) for (const s of [-1, 1]) {
    const w = cyl(r, r, 0.12, 'tire', 0, 12); w.rotation.x = Math.PI / 2; g.add(at(w, x, r, s * z));
    const h = cyl(r * 0.5, r * 0.5, 0.02, 'hub', 0, 8); h.rotation.x = Math.PI / 2; g.add(detail(at(h, x, r, s * (z + 0.065))));
  }
}

function lights(g: THREE.Group, front: number, rear: number, y: number, z: number): void {
  for (const s of [-1, 1]) {
    g.add(at(box(0.02, 0.07, 0.13, 'headlight'), front, y, s * z));
    g.add(at(box(0.02, 0.07, 0.1, 'taillight'), rear, y + 0.02, s * z));
  }
}

function hatchback(colorIdx: number): THREE.Group {
  const g = new THREE.Group();
  g.add(tint(at(rbox(1.7, 0.32, 0.85, 0.1, 'car', colorIdx), 0, 0.26, 0)));
  g.add(at(rbox(1.0, 0.26, 0.74, 0.08, 'glass'), -0.14, 0.53, 0));
  g.add(tint(at(rbox(0.94, 0.07, 0.78, 0.03, 'car', colorIdx), -0.14, 0.665, 0)));
  g.add(detail(tint(at(box(0.05, 0.26, 0.76, 'car', colorIdx), 0.12, 0.53, 0))));
  lights(g, 0.855, -0.855, 0.3, 0.27);
  wheels(g, [-0.55, 0.55], 0.38, 0.14);
  return g;
}

function van(colorIdx: number): THREE.Group {
  const g = new THREE.Group();
  g.add(tint(at(rbox(2.1, 0.76, 0.95, 0.13, 'car', colorIdx), 0, 0.5, 0)));
  g.add(at(box(1.5, 0.24, 0.962, 'glass'), -0.2, 0.7, 0));
  g.add(at(box(0.02, 0.26, 0.78, 'glass'), 1.051, 0.7, 0));
  g.add(detail(tint(at(box(0.05, 0.24, 0.97, 'car', colorIdx), 0.3, 0.7, 0))));
  g.add(detail(at(box(0.3, 0.02, 0.965, 'stripe'), -0.2, 0.4, 0)));
  g.add(detail(at(rbox(1.2, 0.05, 0.7, 0.02, 'metal'), -0.25, 0.905, 0)));
  lights(g, 1.055, -1.055, 0.36, 0.32);
  wheels(g, [-0.68, 0.68], 0.42, 0.15);
  return g;
}

function pickup(colorIdx: number): THREE.Group {
  const g = new THREE.Group();
  g.add(tint(at(rbox(1.95, 0.3, 0.86, 0.08, 'car', colorIdx), 0, 0.28, 0)));
  g.add(at(rbox(0.66, 0.22, 0.8, 0.06, 'glass'), 0.28, 0.54, 0));
  g.add(tint(at(rbox(0.7, 0.08, 0.82, 0.03, 'car', colorIdx), 0.28, 0.69, 0)));
  // Open bed: side walls + tailgate.
  for (const s of [-1, 1]) g.add(tint(at(box(0.92, 0.14, 0.05, 'car', colorIdx), -0.5, 0.49, s * 0.405)));
  g.add(tint(at(box(0.05, 0.14, 0.86, 'car', colorIdx), -0.95, 0.49, 0)));
  g.add(detail(at(rbox(0.5, 0.12, 0.5, 0.04, 'trunk'), -0.52, 0.48, 0)));
  lights(g, 0.98, -0.98, 0.31, 0.29);
  wheels(g, [-0.62, 0.6], 0.38, 0.15);
  return g;
}

/** Car of a variant (index into CAR_VARIANTS or name). `colorIdx` picks the palette `car` colour for unbaked/
 *  non-instanced use; instanced traffic overrides body colour per instance via instanceColor. */
export function makeCar(variant: number | CarVariant = 0, colorIdx = 0): THREE.Group {
  const name = typeof variant === 'number' ? CAR_VARIANTS[((variant % CAR_VARIANTS.length) + CAR_VARIANTS.length) % CAR_VARIANTS.length]! : variant;
  const g = name === 'van' ? van(colorIdx) : name === 'pickup' ? pickup(colorIdx) : hatchback(colorIdx);
  g.name = `car:${name}`;
  return g;
}
