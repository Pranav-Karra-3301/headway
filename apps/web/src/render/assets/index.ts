// Builds the full registry from every family.
import { AssetRegistry } from './registry';
import * as campus from './families/campus';
import * as downtown from './families/downtown';
import * as landmarks from './families/landmarks';
import * as residential from './families/residential';
import * as street from './families/street';
import * as vegetation from './families/vegetation';

export function createRegistry(): AssetRegistry {
  const r = new AssetRegistry();
  for (const f of [downtown, campus, residential, landmarks, vegetation, street]) f.register(r);
  return r;
}
export * from './types';
export * from './catalog';
export { AssetRegistry } from './registry';
