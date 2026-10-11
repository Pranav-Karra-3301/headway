// Owner: E1. Vertex paint for the terrain mesh (linear colours), from the per-vertex info written by `mesh.ts`:
// surface = board-matching foot → grass → meadow → forest floor → cool upper slopes → rock (steep / summits),
// sand + wet sand at the headland shores, aerial haze with distance; skirts = masonry courses (rail-tunnel walls),
// rock bands (road-portal cliffs) or soil strata under a grass lip (the diorama's cut edges).
import * as THREE from 'three';
import type { TerrainRamp } from './colors';
import { smooth, WATER_LEVEL } from './field';
import { INFO, KIND } from './mesh';

const c = new THREE.Color();

export function paintTerrain(info: Float32Array, count: number, out: Float32Array, R: TerrainRamp, autumn: boolean): void {
  for (let v = 0; v < count; v++) {
    const o = v * INFO;
    const kind = info[o]!;
    if (kind === KIND.surface) {
      const h = info[o + 1]!, slope = info[o + 2]!, d = info[o + 3]!, L = info[o + 4]!, forest = info[o + 5]!, n = info[o + 6]!, n2 = info[o + 7]!;
      // painted-model zones with fairly crisp borders: foot (= board) → grass → meadow → forest floor → upper sage
      c.copy(R.foot);
      c.lerp(R.grass, smooth(0.08, 0.9, h));
      c.lerp(R.meadow, smooth(1, 4.5, h) * (0.5 + 0.5 * smooth(-0.5, 0.5, n2)));
      if (autumn) c.lerp(R.accent, smooth(0.1, 0.45, n2) * smooth(1, 3.5, h) * (1 - smooth(9, 13, h)) * 0.55);
      c.lerp(R.forest, smooth(0.22, 0.55, forest) * 0.9);
      c.lerp(R.upper, smooth(9, 15, h) * 0.55);
      // bare rock: crags (steep, unforested) and the summit caps
      const crag = smooth(1.3, 1.75, slope) * (1 - 0.7 * smooth(0.3, 0.6, forest));
      const cap = smooth(16.8, 19.2, h + 0.8 * n);
      c.lerp(R.rock, Math.max(crag, cap));
      // shores: rocky where steep, sandy coves where flat; darker below the waterline
      const shore = smooth(2.4, 0.6, L) * smooth(1.6, 0.3, h);
      if (shore > 0) c.lerp(slope > 0.55 ? R.cliff : R.sand, shore * (slope > 0.55 ? 0.85 : 1));
      if (h < WATER_LEVEL + 0.2) c.lerp(R.cliff, smooth(WATER_LEVEL + 0.2, WATER_LEVEL - 0.9, h) * 0.6);
      c.lerp(R.haze, smooth(10, 34, d) * 0.4);
      c.multiplyScalar(1 + 0.04 * n);
    } else if (kind === KIND.stone) {
      const row = info[o + 1]!, r = info[o + 5]!;
      c.copy(R.stone[row % 2 ? 1 : 0]!).lerp(R.stone[2]!, r * 0.45);
    } else if (kind === KIND.rock) {
      const r = info[o + 5]!;
      c.copy(R.cliff).lerp(R.rock, 0.25 + 0.6 * r);
    } else {
      const row = info[o + 1]!, lip = info[o + 4]! > 0, r = info[o + 5]!;
      if (lip) c.copy(R.forest);
      else c.copy(R.strata[1 + (row % 3)]!).lerp(R.strata[row % 2 ? 1 : 3]!, 0.18 + 0.2 * r);
    }
    out[v * 3] = c.r;
    out[v * 3 + 1] = c.g;
    out[v * 3 + 2] = c.b;
  }
}
