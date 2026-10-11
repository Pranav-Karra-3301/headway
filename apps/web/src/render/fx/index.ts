// Owner: T2.4. Town shader FX: flowing route ribbons (+ highlight glow / desaturate), street lamps with dusk glow,
// clock-tower hands from the sim clock, stadium floodlight cones at dusk, procedural board/lawn variation, and a
// confetti burst over the stadium at the advertised closing time. See ./layer.ts.
//
// Composer contract (T2.2): add `layer.object` to the scene, call `update(ctx)` every frame and `setPalette` on
// palette changes; day ↔ dusk follows `shared.uDusk` (Stage). Build clock faces WITHOUT hands so FX can drive them:
// kit `makeClockTower({ hands: false })`, kit `makeStation({ hands: false })`, A4 `lm.clockTower` with
// `params.hands = false`. The clock start + closing time come from `frame.runner` (or `setFxScenario`).
import type { TownMap } from '@headway/sim';
import type { RenderLayer } from '../layers';
import { createTownFx } from './layer';

export function createTownFxLayer(map: TownMap): RenderLayer {
  return createTownFx(map);
}

export { createTownFx, type TownFxLayer, type TownFxOptions } from './layer';
export { setFxScenario, type FxScenario } from './scenario';
export { fxAnchors, type FxAnchors, type FxSources } from './anchors';
export { RIBBON } from './ribbons';
