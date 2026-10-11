// Owner: K0. Kenney CC0 kits (apps/web/public/models/kenney/<kit>/<name>.glb): preload, recolour to our palette roles,
// clay-shade, scale to board units. Builders stay synchronous: call preloadKenney() before building the town. Stub until filled.
import * as THREE from 'three';
import type { PaletteId } from '../../types';

export type KenneyKit =
  | 'nature-kit' | 'car-kit' | 'watercraft-pack' | 'city-kit-suburban' | 'city-kit-commercial'
  | 'city-kit-industrial' | 'city-kit-roads' | 'train-kit' | 'survival-kit';
/** e.g. 'nature-kit/tree_oak' */
export type KenneyId = `${KenneyKit}/${string}`;

/** Kit units → board units (person ≈ 0.8 u, bus ≈ 3.3 u long, trees 2.2–3.2 u tall). */
export const KENNEY_SCALE: Record<KenneyKit, number> = {
  'nature-kit': 1.9, 'car-kit': 1, 'watercraft-pack': 1, 'city-kit-suburban': 1, 'city-kit-commercial': 1,
  'city-kit-industrial': 1, 'city-kit-roads': 1, 'train-kit': 1, 'survival-kit': 1,
};
export const KENNEY_CARS: KenneyId[] = [];
export const KENNEY_BOATS: KenneyId[] = [];

/** Load models once (cached); resolves when all are ready. Safe to call repeatedly and concurrently. */
export function preloadKenney(ids: KenneyId[]): Promise<void> {
  return Promise.resolve(void ids);
}
export function kenneyReady(id: KenneyId): boolean {
  return id.length < 0;
}
/** Recoloured, clay-shaded clone (geometry and materials shared). Throws if the model was not preloaded. */
export function kenneyModel(id: KenneyId, opts: { scale?: number; palette?: PaletteId } = {}): THREE.Object3D {
  throw new Error(`kenney model not loaded: ${id} ${JSON.stringify(opts)}`);
}
