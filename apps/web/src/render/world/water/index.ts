// Owner: E2. Nittany Lake: the bay on the south + east sides of the board, as one RenderLayer in 3 draw calls —
//   water:surface — the lake (stylised shader: depth tint, lapping foam, wave lines, glints, dusk reflections);
//   water:statics — beach, causeways, lighthouse point, marina boardwalk, huts, rocks, grass, lamps (baked, KitMaterial);
//   water:boats   — moored + sailing boats, buoys, floats and a duck family (one mesh, posed in the vertex shader).
// Pure layout lives in plan.ts (tested); the shore field (field.ts) feeds the shader. Day ↔ dusk eases on its own from
// the frame's light (and never lags the shared stage dusk), so the layer also works outside the Stage.
import * as THREE from 'three';
import type { TownMap } from '@headway/sim';
import type { FrameContext, RenderLayer } from '../../layers';
import { KitMaterial, shared } from '../../materials';
import { DEFAULT_PALETTE } from '../../palettes';
import type { LightMode, PaletteId } from '../../types';
import type { WorldLayout } from '../layout';
import { createTerrainField } from '../terrain/field';
import { buildBoats, boatSize, type BoatUniforms } from './boats';
import { WATER_COLORS } from './colors';
import { buildShoreField, type FieldOptions } from './field';
import { BEACH_Y, boatPose, planWater, WATER_Y, type WaterPlan } from './plan';
import { buildStatics } from './props';
import { buildSurface, MAX_LIGHTS, MAX_WAKES, type WaterUniforms } from './surface';

/** Lake surface height (board top is y = 0): other world parts (base cut edges, terrain headlands) meet it here. */
export const WATER_LEVEL = WATER_Y;
export { WATER_COLORS } from './colors';
export { planWater, BEACH_Y, LAKE_BED_Y, DECK_Y } from './plan';
export type { WaterPlan } from './plan';

export interface WaterOptions extends FieldOptions {
  palette?: PaletteId;
  /** Use the terrain's headland coastline for foam + shallows (default true; `landDist` overrides). */
  terrainCoast?: boolean;
}

/** The terrain headlands' coastline (E1), so foam and shallows wrap around them too. */
function terrainCoast(map: TownMap, layout: WorldLayout): ((x: number, z: number) => number) | undefined {
  try {
    const tf = createTerrainField(map, layout);
    return typeof tf.coast === 'function' ? (x, z) => tf.coast(x, z) : undefined;
  } catch {
    return undefined;
  }
}

export interface WaterLayer extends RenderLayer {
  readonly plan: WaterPlan;
  readonly uniforms: WaterUniforms & BoatUniforms;
  /** Index of a boat that sails a loop (tests, camera presets). */
  readonly movingBoat: number;
}

const TIDE_A = 0.035;

export function createWaterLayer(map: TownMap, layout: WorldLayout, opts: WaterOptions = {}): WaterLayer {
  let palette: PaletteId = opts.palette ?? DEFAULT_PALETTE;
  const plan = planWater(map, layout);
  const landDist = opts.landDist ?? (opts.terrainCoast === false ? undefined : terrainCoast(map, layout));
  const field = buildShoreField(plan, { ...opts, ...(landDist ? { landDist } : {}) });
  const dusk = { value: 0 };

  const surface = buildSurface(plan.regions, field, WATER_Y);
  const statics = buildStatics(plan, palette);
  const staticMat = new KitMaterial({ roughness: 0.82 });
  {
    const base = staticMat.onBeforeCompile;
    staticMat.onBeforeCompile = (shader, renderer) => { base.call(staticMat, shader, renderer); shader.uniforms.uDusk = dusk; };
  }
  const staticMesh = new THREE.Mesh(statics.geometry, staticMat);
  staticMesh.name = 'water:statics';
  staticMesh.castShadow = true;
  staticMesh.receiveShadow = true;
  const boats = buildBoats(plan.boats, palette, dusk);

  const object = new THREE.Group();
  object.name = 'water';
  object.add(surface.mesh, staticMesh, boats.mesh);

  const u = surface.uniforms;
  u.uLightCount.value = Math.min(MAX_LIGHTS, plan.lights.length);
  plan.lights.slice(0, MAX_LIGHTS).forEach((l, i) => u.uLights.value[i]!.set(l.x, l.y, l.z, l.strength));
  const wakes = plan.boats.map((b, i) => ({ b, i })).filter(({ b }) => b.loop || b.follow).slice(0, MAX_WAKES);
  u.uWakeCount.value = wakes.length;
  const movingBoat = wakes[0]?.i ?? 0;

  const applyPalette = () => {
    const C = WATER_COLORS[palette];
    u.uShallow.value.set(C.shallow);
    u.uMid.value.set(C.mid);
    u.uDeep.value.set(C.deep);
    u.uFoam.value.set(C.foam);
    u.uDuskNear.value.set(C.duskNear);
    u.uDuskFar.value.set(C.duskFar);
    u.uGlow.value.set(C.glow);
  };
  applyPalette();

  // beach slope at the waterline (for the foam to follow the tide): f = t² ⇒ dy/dd = 2·drop/width
  const slope = (2 * (BEACH_Y - WATER_Y)) / plan.shore.mean;
  let duskT = 0, goal = 0, started = false;
  const dir = new THREE.Vector3();

  const update = (ctx: FrameContext) => {
    const t = ctx.timeS;
    goal = ctx.light === 'dusk' ? 1 : 0;
    if (!started) { duskT = goal; started = true; }
    const k = 1 - Math.exp(-Math.min(Math.max(ctx.dtS, 0), 0.1) * 3.2);
    duskT += (goal - duskT) * k;
    if (Math.abs(goal - duskT) < 0.003) duskT = goal;
    const e = duskT * duskT * (3 - 2 * duskT);
    dusk.value = Math.max(e, shared.uDusk.value);
    u.uDusk.value = dusk.value;
    u.uTime.value = t;

    const tide = TIDE_A * Math.sin(t * 0.52) + 0.012 * Math.sin(t * 1.37 + 0.6);
    surface.mesh.position.y = WATER_Y + tide;
    u.uTideShift.value = tide / slope;

    ctx.camera.getWorldDirection(dir);
    const hz = Math.hypot(dir.x, dir.z);
    if (hz > 1e-4) {
      u.uView.value.set(dir.x / hz, dir.z / hz);
      u.uViewCot.value = Math.min(4, hz / Math.max(1e-3, -dir.y));
    }

    const P = boats.uniforms;
    plan.boats.forEach((b, i) => {
      const p = boatPose(plan, b, t);
      P.uBoatPose.value[i]!.set(p.x, WATER_Y + tide + p.heave, p.z, p.heading);
      P.uBoatTilt.value[i]!.set(p.roll, p.pitch, 1, 0);
    });
    wakes.forEach(({ b, i }, j) => {
      const q = P.uBoatPose.value[i]!;
      u.uWake.value[j]!.set(q.x, q.z, q.w, boatSize(b));
    });
  };

  return {
    name: 'water',
    object,
    plan,
    uniforms: { ...surface.uniforms, ...boats.uniforms },
    movingBoat,
    update,
    setPalette(p: PaletteId) {
      if (p === palette) return;
      palette = p;
      applyPalette();
      statics.recolor(p);
      boats.recolor(p);
    },
    setLight(l: LightMode) {
      goal = l === 'dusk' ? 1 : 0;
      if (!started) { duskT = goal; started = true; }
    },
    dispose() {
      for (const m of [surface.mesh, staticMesh, boats.mesh]) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
      u.uField.value.dispose();
    },
  };
}
