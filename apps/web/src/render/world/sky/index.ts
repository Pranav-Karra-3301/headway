// Owner: E3. Sky layer = 2 draw calls:
//   1. backdrop — a screen-space gradient (day mint → cream, dusk indigo → peach) drawn first behind everything, with
//      a faint sun glow, a few dusk stars and the diorama's soft drop shadow on the void below it (an SDF of the
//      plinth footprint on a plane under the base, so it costs nothing extra);
//   2. props — 3 layered low-poly distant ridges wrapped round the back (north + west) of the diorama with aerial
//      perspective + misty feet that melt into the gradient, and a few slow faceted clouds drifting high behind the
//      mountains. Bands only show while they are behind the diorama as seen from the camera (rotation-safe).
// Neither mesh takes part in picking or in override passes (GTAO normals), and neither casts shadows.
import * as THREE from 'three';
import type { TownMap } from '@headway/sim';
import type { FrameContext, RenderLayer } from '../../layers';
import type { LightMode, PaletteId } from '../../types';
import { BASE } from '../base/profile';
import type { WorldLayout } from '../layout';
import { appendClouds, cloudSpecs } from './clouds';
import { createSkyMix, mixSky } from './colors';
import { DuskEase } from './ease';
import { BACKDROP_FRAG, BACKDROP_VERT, PROPS_FRAG, PROPS_VERT } from './glsl';
import { appendRidge, emptyAttribs, RIDGE_LAYERS, ridgeBand, toGeometry } from './ridges';

export { mixSky, skyAt, SKY_LOOKS } from './colors';
export { RIDGE_LAYERS } from './ridges';

const SUN_DAY = new THREE.Vector3(-14, 34, 22).normalize();
const SUN_DUSK = new THREE.Vector3(-30, 12, 14).normalize();
const GLOW_DAY = new THREE.Vector2(-0.72, 0.78);
const GLOW_DUSK = new THREE.Vector2(-0.95, -0.05);
/** Drop shadow: plane depth below the plinth, shift (toward the lower right on screen), corner radius, blur. */
const SHADOW = { below: 4, dx: 2.5, dz: 1.5, radius: 9, blur: 10 };

/** Skip drawing when an override material (e.g. GTAO's normal pass) replaces ours. */
function onlyOwnMaterial(mesh: THREE.Mesh, own: THREE.Material, before?: (r: THREE.WebGLRenderer, c: THREE.Camera) => void): void {
  mesh.onBeforeRender = (renderer, _scene, camera, geometry, material) => {
    if (material !== own) { geometry.setDrawRange(0, 0); return; }
    geometry.setDrawRange(0, Infinity);
    before?.(renderer, camera);
  };
}

export function createSkyLayer(map: TownMap, layout: WorldLayout): RenderLayer {
  const object = new THREE.Group();
  object.name = 'sky';
  object.userData.mapVersion = map.version;
  let palette: PaletteId = 'a';
  const ease = new DuskEase();
  const mix = createSkyMix();
  const E = layout.extent;

  const sky = { uSky0: { value: mix.stops[0] }, uSky1: { value: mix.stops[1] }, uSky2: { value: mix.stops[2] }, uSky3: { value: mix.stops[3] } };
  const time = { value: 0 };
  const dusk = { value: 0 };

  // ---------------------------------------------------------------- backdrop
  const hx = (E.maxX - E.minX) / 2 + BASE.plinthOut, hz = (E.maxZ - E.minZ) / 2 + BASE.plinthOut;
  const bd = {
    ...sky,
    uInvViewProj: { value: new THREE.Matrix4() },
    uShadowRect: { value: new THREE.Vector4((E.minX + E.maxX) / 2 + SHADOW.dx, (E.minZ + E.maxZ) / 2 + SHADOW.dz, hx, hz) },
    uShadowParams: { value: new THREE.Vector4(BASE.bottom - BASE.plinthH - SHADOW.below, SHADOW.radius, SHADOW.blur, 0.5) },
    uShadowTint: { value: mix.shadow },
    uGlow: { value: mix.glow },
    uGlowAmt: { value: 0 },
    uGlowPos: { value: new THREE.Vector2() },
    uAspect: { value: 1.6 },
    uDusk: dusk,
    uTime: time,
    uPixel: { value: 1 },
  };
  const bdMat = new THREE.ShaderMaterial({ name: 'world-sky', uniforms: bd, vertexShader: BACKDROP_VERT, fragmentShader: BACKDROP_FRAG, depthTest: false, depthWrite: false });
  const bdGeo = new THREE.BufferGeometry();
  bdGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const backdrop = new THREE.Mesh(bdGeo, bdMat);
  backdrop.name = 'sky:backdrop';
  backdrop.frustumCulled = false;
  backdrop.renderOrder = -1e6;
  backdrop.raycast = () => {};
  const viewport = new THREE.Vector4();
  onlyOwnMaterial(backdrop, bdMat, (renderer, camera) => {
    bd.uInvViewProj.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
    renderer.getCurrentViewport(viewport);
    bd.uAspect.value = viewport.z / Math.max(1, viewport.w);
    bd.uPixel.value = renderer.getPixelRatio();
  });

  // ---------------------------------------------------------------- distant ridges + clouds
  const attrs = emptyAttribs();
  for (const spec of RIDGE_LAYERS) appendRidge(attrs, ridgeBand(layout, spec), spec);
  appendClouds(attrs, cloudSpecs(layout));
  const pr = {
    ...sky,
    uRidgeLit: { value: mix.ridgeLit },
    uRidgeShade: { value: mix.ridgeShade },
    uCloudLit: { value: mix.cloudLit },
    uCloudShade: { value: mix.cloudShade },
    uLightDir: { value: SUN_DAY.clone() },
    uCamBack: { value: new THREE.Vector3(0.6, 0.53, 0.6) },
    uCamFwd: { value: new THREE.Vector2(-Math.SQRT1_2, -Math.SQRT1_2) },
    uTime: time,
  };
  const prMat = new THREE.ShaderMaterial({ name: 'world-sky-props', uniforms: pr, vertexShader: PROPS_VERT, fragmentShader: PROPS_FRAG, side: THREE.DoubleSide });
  const props = new THREE.Mesh(toGeometry(attrs), prMat);
  props.name = 'sky:props';
  props.frustumCulled = false; // clouds drift in the vertex shader
  props.raycast = () => {};
  const fwd = new THREE.Vector3();
  onlyOwnMaterial(props, prMat, (_r, camera) => {
    camera.getWorldDirection(fwd);
    pr.uCamBack.value.copy(fwd).negate();
    const l = Math.hypot(fwd.x, fwd.z);
    if (l > 1e-4) pr.uCamFwd.value.set(fwd.x / l, fwd.z / l);
  });

  object.add(backdrop, props);

  // ---------------------------------------------------------------- looks
  const apply = () => {
    const t = ease.amount;
    mixSky(palette, t, mix);
    dusk.value = t;
    bd.uGlowAmt.value = mix.glowAmt;
    bd.uGlowPos.value.copy(GLOW_DAY).lerp(GLOW_DUSK, t);
    bd.uShadowParams.value.w = mix.shadowAmt;
    pr.uLightDir.value.copy(SUN_DAY).lerp(SUN_DUSK, t).normalize();
  };
  apply();
  let applied = ease.amount;

  return {
    name: 'sky',
    object,
    update(ctx: FrameContext) {
      const t = ease.step(ctx.light, ctx.dtS);
      if (t !== applied) { applied = t; apply(); }
      time.value = ctx.timeS;
    },
    setPalette(p: PaletteId) { palette = p; apply(); },
    setLight(l: LightMode) { ease.set(l); applied = ease.amount; apply(); },
    dispose() {
      bdGeo.dispose();
      bdMat.dispose();
      props.geometry.dispose();
      prMat.dispose();
    },
  };
}
