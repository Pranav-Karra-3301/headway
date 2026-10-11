// Owner: T2.4. The town FX layer: route ribbons, ground variation, clock hands, street lamps (+ dusk glow), stadium
// floodlight cones and pitch light at dusk, and the closing-time confetti burst. Draw calls: 3–4 by day (ribbons,
// ground, hands, kerb lamps), +3 at dusk (halos, pools, cones), +1 while confetti flies.
import * as THREE from 'three';
import type { TownMap } from '@headway/sim';
import { LAMP } from '../kit';
import type { FrameContext, RenderLayer } from '../layers';
import { shared } from '../materials';
import { PALETTES } from '../palettes';
import type { LightMode, PaletteId } from '../types';
import { DISTRICTS } from '../districts';
import { SCENERY } from '../scenery';
import { districtOwns, fxAnchors, keptScenery, type FxAnchors, type FxSources } from './anchors';
import { createClockHands, parseClock } from './clock';
import { createConfetti, crossedClosing } from './confetti';
import { createCones, createHalos, createPools, type GlowItem } from './glow';
import { createGroundFx } from './ground';
import { createLampPosts, kerbLamps, type KerbLamp } from './lamps';
import { createRibbons } from './ribbons';
import { currentFxScenario, stadiumClosingT } from './scenario';

export interface TownFxOptions {
  /** Scenery the composer renders (default: base SCENERY + DISTRICTS). */
  sources?: FxSources;
  palette?: PaletteId;
  /** Line the streets with kit lamps where no district owns the ground (default true). */
  kerbLamps?: boolean;
}

export interface TownFxLayer extends RenderLayer {
  readonly anchors: FxAnchors;
  readonly kerb: readonly KerbLamp[];
}

const FLOOD = '#FFF4DC';

export function createTownFx(map: TownMap, opts: TownFxOptions = {}): TownFxLayer {
  const sources = opts.sources ?? { scenery: SCENERY, districts: DISTRICTS };
  let palette: PaletteId = opts.palette ?? 'a';
  const anchors = fxAnchors(map, sources);
  const kerb = opts.kerbLamps === false ? [] : kerbLamps(map, {
    scenery: keptScenery(sources.scenery, sources.districts),
    blocked: (p) => districtOwns(sources.districts, p),
  });

  const object = new THREE.Group();
  object.name = `fx:${map.version}`;
  const time = { value: 0 };

  const ribbons = createRibbons(map, palette);
  const ground = createGroundFx(map, anchors.lawns, palette);
  const hands = createClockHands(anchors.clockFaces, palette);
  const posts = kerb.length ? createLampPosts(kerb, palette) : null;

  const lampHeads = [
    ...anchors.lamps.map((l) => ({ x: l.x, y: l.headY, z: l.z })),
    ...kerb.map((l) => ({ x: l.x, y: LAMP.globeY, z: l.z })),
  ];
  const floods = anchors.stadiums.flatMap((s) => s.floods);
  const lampColor = () => PALETTES[palette].lamp;
  const haloItems: GlowItem[] = [
    ...lampHeads.map((p) => ({ p, size: 0.85, color: lampColor(), strength: 1.15 })),
    ...floods.map((f) => ({ p: f.head, size: 1.7, color: FLOOD, strength: 1.5 })),
  ];
  const poolItems: GlowItem[] = [
    ...lampHeads.map((p) => ({ p: { x: p.x, y: 0.1, z: p.z }, size: 1.7, color: lampColor(), strength: 0.34 })),
    ...anchors.stadiums.map((s) => ({ p: { x: s.x, y: s.pitch.y + 0.04, z: s.z }, size: 1, sx: s.pitch.a * 1.08, sz: s.pitch.b * 1.15, yaw: s.rot, color: FLOOD, strength: 0.42 })),
  ];
  const halos = createHalos(haloItems);
  const pools = createPools(poolItems);
  const cones = createCones(floods, FLOOD, 0.36, time, 2.0 * (anchors.stadiums[0]?.scale ?? 1));
  const confetti = createConfetti(palette);

  object.add(ground.mesh, ribbons.mesh, hands.mesh, pools.mesh, cones.mesh, halos.mesh, confetti.mesh);
  if (posts) object.add(posts.mesh);
  const glows = [halos, pools, cones];

  let fade = 0, lastSimT = NaN, bursts = 0;

  const recolorGlows = () => {
    const nLamps = lampHeads.length;
    halos.recolor((i) => (i < nLamps ? lampColor() : FLOOD));
    pools.recolor((i) => (i < nLamps ? lampColor() : FLOOD));
  };

  return {
    name: 'fx',
    object,
    anchors,
    kerb,
    update(ctx: FrameContext) {
      const dt = Math.min(Math.max(ctx.dtS, 0), 0.1);
      const k = 1 - Math.exp(-dt * 9);
      fade += ((ctx.highlightedRoute ? 1 : 0) - fade) * k;
      if (Math.abs(fade - (ctx.highlightedRoute ? 1 : 0)) < 1e-3) fade = ctx.highlightedRoute ? 1 : 0;
      time.value = ctx.timeS;
      ribbons.update(dt, ctx.highlightedRoute, ctx.timeS);
      ground.setFade(fade);
      hands.material.fade.value = 0.6 * fade;
      if (posts) posts.material.fade.value = 0.6 * fade;

      const intensity = shared.uDusk.value * (1 - 0.45 * fade);
      for (const g of glows) {
        g.material.uniforms.uI!.value = intensity;
        g.mesh.visible = intensity > 0.004 && g.mesh.count > 0;
      }

      const sc = currentFxScenario();
      hands.update(parseClock(sc?.clockStart ?? '12:00'), ctx.simT);
      const st = anchors.stadiums[0];
      if (st && crossedClosing(lastSimT, ctx.simT, stadiumClosingT(sc))) {
        confetti.fire({ x: st.x, y: 2.3 * st.scale, z: st.z }, 1009 + 7919 * bursts++);
      }
      lastSimT = ctx.simT;
      confetti.step(dt);
    },
    setPalette(p: PaletteId) {
      palette = p;
      ribbons.setPalette(p);
      ground.setPalette(p);
      hands.setPalette(p);
      posts?.setPalette(p);
      confetti.setPalette(p);
      recolorGlows();
    },
    setLight(_l: LightMode) { /* dusk amount is eased by Stage into shared.uDusk; glows follow it every frame */ },
    dispose() {
      ribbons.dispose(); ground.dispose(); hands.dispose(); posts?.dispose(); confetti.dispose();
      for (const g of glows) g.dispose();
      object.clear();
    },
  };
}
