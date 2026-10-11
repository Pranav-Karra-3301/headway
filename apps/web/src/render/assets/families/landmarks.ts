// Owner: A4. Registers every 'landmarks' kind from catalog.ts: the stadium showpiece, the campus clock tower,
// the two station buildings, the water tower and the railway furniture. Builders live in ./landmarks/*.
import { CATALOG } from '../catalog';
import { PALETTES, type Role } from '../../palettes';
import type { AssetRegistry } from '../registry';
import type { AssetDef, RoleColors } from '../types';
import { buildClockTower, CLOCK_TOWER_FACES } from './landmarks/clockTower';
import { buildLevelCrossing, buildRailSignal } from './landmarks/rail';
import { buildStadium, STADIUM_BOWL } from './landmarks/stadium';
import { buildStationCentral, buildStationHalt } from './landmarks/stations';
import { buildWaterTower } from './landmarks/waterTower';

export { CLOCK_TOWER_FACES, STADIUM_BOWL };

/** Composer palette roles this family uses that the basic dev kit lacks (copied so previews match the town). */
const SHARED: Role[] = [
  'stadium', 'mast', 'clock', 'hands', 'tower', 'towerRoof', 'post', 'frame', 'canopy', 'platform', 'safety', 'display',
  'curb', 'rail', 'paper', 'accent', 'stripe', 'bench', 'taillight', 'column', 'hub',
];
const fromPalettes = (role: Role): RoleColors[string] => [PALETTES.a[role], PALETTES.b[role], PALETTES.c[role]];

/** Extra palette roles this family needs (palette a, b, c). `lm*` roles are landmark-only paints. */
export const ROLES: RoleColors = {
  ...Object.fromEntries(SHARED.map((r) => [r, fromPalettes(r)])),
  lmStone: ['#EDE3CF', '#E6DCC6', '#E9E2D2'],
  lmBanner: [['#E9785A', '#2E5BDA', '#F2C14E'], ['#8C2F39', '#2F7F7A', '#D9A441'], ['#0B2A5B', '#F5F5F2', '#E07A2E']],
  lmEndzone: ['#2E5BDA', '#8C2F39', '#0B2A5B'],
  lmTurf: ['#7DCB8C', '#A8C38A', '#8BBE78'],
  lmTank: ['#F4EEDF', '#E9E0CF', '#F5F5F2'],
  lmTankBand: ['#3FA796', '#2F7F7A', '#0B2A5B'],
  lmLeg: ['#DCD3C0', '#B9AE98', '#C9CED6'],
  lmRed: ['#E25A50', '#B8463C', '#C9452E'],
  lmGreen: ['#3FBF7F', '#4E9A6A', '#3FA36B'],
};

const BUILDERS: Record<string, Pick<AssetDef, 'build' | 'instanced'>> = {
  'lm.stadium': { build: buildStadium },
  'lm.clockTower': { build: buildClockTower },
  'lm.stationCentral': { build: buildStationCentral },
  'lm.stationHalt': { build: buildStationHalt },
  'lm.waterTower': { build: buildWaterTower },
  'lm.levelCrossing': { build: buildLevelCrossing },
  'lm.railSignal': { build: buildRailSignal, instanced: true },
};

export function register(r: AssetRegistry): void {
  r.addRoles(ROLES);
  for (const c of CATALOG) {
    if (c.family !== 'landmarks') continue;
    const b = BUILDERS[c.kind];
    if (!b) continue;
    r.register({ kind: c.kind, family: 'landmarks', footprint: { w: c.w, d: c.d }, height: c.h, build: b.build, ...(b.instanced ? { instanced: true } : {}) });
  }
}
