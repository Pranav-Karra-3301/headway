// Asset registry: families register AssetDefs; the composer and dev pages look them up.
import * as THREE from 'three';
import { CATALOG_BY_KIND } from './catalog';
import type { AssetDef, KitContext, PlacedAsset, RoleColors } from './types';

export class AssetRegistry {
  private defs = new Map<string, AssetDef>();
  readonly roles: RoleColors = {};
  register(def: AssetDef): void { this.defs.set(def.kind, def); }
  addRoles(r: RoleColors): void { Object.assign(this.roles, r); }
  get(kind: string): AssetDef | undefined { return this.defs.get(kind); }
  kinds(): string[] { return [...this.defs.keys()].sort(); }
  /** Build a placed asset; unknown kinds become a translucent placeholder box with the catalog footprint. */
  build(k: KitContext, p: PlacedAsset): THREE.Object3D {
    const def = this.defs.get(p.kind);
    const obj = def ? def.build(k, p.params ?? {}) : placeholder(p.kind);
    obj.position.set(p.x, 0, p.z);
    obj.rotation.y = p.rot ?? 0;
    if (p.scale) obj.scale.setScalar(p.scale);
    obj.userData.kind = p.kind;
    return obj;
  }
}

function placeholder(kind: string): THREE.Object3D {
  const c = CATALOG_BY_KIND.get(kind);
  const w = c?.w ?? 1, d = c?.d ?? 1, h = c?.h ?? 1;
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: 0xff00aa, transparent: true, opacity: 0.35 }));
  m.position.y = h / 2;
  const g = new THREE.Group(); g.add(m); g.userData.placeholder = true;
  return g;
}
