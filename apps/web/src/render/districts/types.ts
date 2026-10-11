// District dressing seam (coordinator). Each district file owns the final scenery of its area.
import type { NeighborhoodId, Vec2 } from '@headway/sim';
import type { PlacedAsset } from '../assets/types';

export type DistrictId = NeighborhoodId | 'outskirts';
export interface FootPath { points: Vec2[]; width: number; kind: 'footpath' | 'plaza-edge' }
export interface GroundArea { polygon: Vec2[]; kind: 'lawn' | 'plaza' | 'parking' | 'sports' | 'garden' }
export interface DistrictScenery {
  id: DistrictId;
  /** Region this district owns: the composer drops base SCENERY items inside it when `items` is non-empty. */
  region: { center: Vec2; radius: number } | { polygon: Vec2[] };
  items: PlacedAsset[];
  paths: FootPath[];
  areas: GroundArea[];
}
