// Owner: K1/K2/K3 (see plan v5). Registers kn.* kinds and Kenney upgrades of veg.* kinds. Stub until filled.
import type { AssetRegistry } from '../registry';
import type { RoleColors } from '../types';

export const ROLES: RoleColors = {};

export function register(r: AssetRegistry): void {
  r.addRoles(ROLES);
}
