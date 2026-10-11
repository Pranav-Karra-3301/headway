// Town-art seam (coordinator). Asset families register builders; districts place them; the composer (T2.2) renders them.
import type * as THREE from 'three';

export type FamilyId = 'downtown' | 'campus' | 'residential' | 'landmarks' | 'vegetation' | 'street';
export type AssetParams = Record<string, number | string | boolean>;

/** One placed thing in the town. Front faces +z at rot 0; rot in radians (multiples of PI/2 for buildings). */
export interface PlacedAsset { kind: string; x: number; z: number; rot?: number; scale?: number; params?: AssetParams }

/** Material + primitive helpers every builder uses, so all families share one look (the composer swaps in the clay materials). */
export interface KitContext {
  /** Role-based shared material; idx picks from array roles. Unknown roles fall back to declared family ROLES, then grey. */
  mat(role: string, idx?: number): THREE.Material;
  rbox(w: number, h: number, d: number, r: number, m: THREE.Material): THREE.Mesh;
  cyl(rt: number, rb: number, h: number, m: THREE.Material, seg?: number): THREE.Mesh;
  sphere(r: number, m: THREE.Material, seg?: number): THREE.Mesh;
  cone(r: number, h: number, m: THREE.Material, seg?: number): THREE.Mesh;
  /** Mark small detail parts (hidden at detail 'min'). */
  detail<T extends THREE.Object3D>(o: T): T;
  /** Seeded variety per placement, 0..1 (stable for the same x/z/kind). */
  rand(): number;
}

export interface AssetDef {
  kind: string;                 // e.g. 'dt.shopRow' (see catalog.ts)
  family: FamilyId;
  footprint: { w: number; d: number }; // at rot 0, scale 1 (x by z)
  height: number;               // approximate, for sorting and validation
  build(k: KitContext, params: AssetParams): THREE.Object3D;
  /** Instance-friendly assets (trees, lamps, benches) may be drawn as InstancedMeshes by the composer. */
  instanced?: boolean;
  /** Animated wind sway for vegetation crowns (composer applies the shared sway material tweak). */
  sway?: boolean;
}

/** Per-family extra palette roles: role -> [palette a, palette b, palette c] colours (hex) or arrays of them. */
export type RoleColors = Record<string, [string | string[], string | string[], string | string[]]>;
