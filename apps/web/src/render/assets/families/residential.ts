// Owner: A3. Registers every 'residential' kind from catalog.ts. Stub until filled.
import type { AssetRegistry } from '../registry';
import type { RoleColors } from '../types';

/** Extra palette roles this family needs (palette a, b, c). */
export const ROLES: RoleColors = {};

export function register(r: AssetRegistry): void {
  r.addRoles(ROLES);
}
