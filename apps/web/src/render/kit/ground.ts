// Owner: T2.1. Board slab (the toy table the town sits on) and lawns. Board top is y = 0.
import * as THREE from 'three';
import { at, rbox } from './prims';

/** Board slab w × d (top at y = 0) on a slightly larger darker skirt. */
export function makeBoard(w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'board';
  g.add(at(rbox(w, 1.0, d, 0.5, 'board'), 0, -0.5, 0));
  g.add(at(rbox(w + 0.8, 1.0, d + 0.8, 0.6, 'boardEdge'), 0, -1.05, 0));
  return g;
}

/** Flat lawn patch w × d, 0.06 thick, rounded corners. */
export function makeLawn(w: number, d: number): THREE.Mesh {
  return at(rbox(w, 0.06, d, Math.min(0.5, w / 2 - 0.01, d / 2 - 0.01), 'lawn'), 0, 0.03, 0);
}
