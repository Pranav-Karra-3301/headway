// Owner: E3. Sky layer = 2 draw calls (art bible §6.5):
//   1. backdrop — a full-screen pass drawn first behind everything. Its gradient is world-anchored: each pixel's
//      view ray is followed to the farthest ridge curtain, and the height where it crosses (above the horizon line)
//      picks the colour, so the lightest haze band always hugs the ridge line, deepening toward the top (day mint,
//      dusk indigo → peach). It also paints a few dusk stars and the diorama's soft contact shadow on the void below
//      the base (an SDF of the plinth footprint, offset to screen right like the key light).
//   2. props — three flat distant-ridge silhouettes wrapped round the back (N + W) of the diorama, mixed toward the
//      haze (t = 0.35 / 0.55 / 0.75) with misty feet melting into the sky and a thin peach rim at dusk, plus four
//      slow smooth clouds high in the haze band. Bands show only while behind the diorama (peek-safe).
// Neither mesh is pickable, joins override passes (GTAO normals) or casts shadows.
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
/** The horizon line sits this far above the farthest ridge layer's mean crest. */
const HORIZON_LIFT = 2.5;
/** Contact shadow: plane depth below the plinth, shift toward screen right (+x −z), corner radius, blur. */
const SHADOW = { below: 2.2, shift: 1.6, radius: 7, blur: 6 };

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
  const far = RIDGE_LAYERS[RIDGE_LAYERS.length - 1]!;

  const viewDir = { value: new THREE.Vector3(-1, -1, -1).normalize() };
  const sky = {
    uSky0: { value: mix.stops[0] }, uSky1: { value: mix.stops[1] }, uSky2: { value: mix.stops[2] }, uSky3: { value: mix.stops[3] }, uSky4: { value: mix.stops[4] },
    uFar: { value: new THREE.Vector4(E.minX - far.offset, E.minZ - far.offset, far.offset, far.base + HORIZON_LIFT) },
    uCorner: { value: new THREE.Vector2(E.minX, E.minZ) },
    uViewDir: viewDir,
  };
  const time = { value: 0 };

  // ---------------------------------------------------------------- backdrop
  const hx = (E.maxX - E.minX) / 2 + BASE.plinthOut, hz = (E.maxZ - E.minZ) / 2 + BASE.plinthOut;
  const bd = {
    ...sky,
    uInvViewProj: { value: new THREE.Matrix4() },
    uShadowRect: { value: new THREE.Vector4((E.minX + E.maxX) / 2 + SHADOW.shift, (E.minZ + E.maxZ) / 2 - SHADOW.shift, hx, hz) },
    uShadowParams: { value: new THREE.Vector4(BASE.bottom - BASE.plinthH - SHADOW.below, SHADOW.radius, SHADOW.blur, 0.5) },
    uShadowTint: { value: mix.shadow },
    uStars: { value: 0 },
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

  // ---------------------------------------------------------------- distant ridges + clouds
  const attrs = emptyAttribs();
  RIDGE_LAYERS.forEach((spec, i) => appendRidge(attrs, ridgeBand(layout, spec), spec, i));
  appendClouds(attrs, cloudSpecs(layout));
  const pr = {
    ...sky,
    uRidge0: { value: mix.ridges[0] }, uRidge1: { value: mix.ridges[1] }, uRidge2: { value: mix.ridges[2] },
    uRim: { value: mix.rim },
    uRimAmt: { value: 0 },
    uCloudLit: { value: mix.cloudLit },
    uCloudShade: { value: mix.cloudShade },
    uLightDir: { value: SUN_DAY.clone() },
    uCamFwd: { value: new THREE.Vector2(-Math.SQRT1_2, -Math.SQRT1_2) },
    uTime: time,
  };
  const prMat = new THREE.ShaderMaterial({ name: 'world-sky-props', uniforms: pr, vertexShader: PROPS_VERT, fragmentShader: PROPS_FRAG, side: THREE.DoubleSide });
  const props = new THREE.Mesh(toGeometry(attrs), prMat);
  props.name = 'sky:props';
  props.frustumCulled = false; // clouds drift in the vertex shader
  props.raycast = () => {};

  const setView = (camera: THREE.Camera) => {
    camera.getWorldDirection(viewDir.value);
    const l = Math.hypot(viewDir.value.x, viewDir.value.z);
    if (l > 1e-4) pr.uCamFwd.value.set(viewDir.value.x / l, viewDir.value.z / l);
  };
  onlyOwnMaterial(backdrop, bdMat, (renderer, camera) => {
    setView(camera);
    bd.uInvViewProj.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
    bd.uPixel.value = renderer.getPixelRatio();
  });
  onlyOwnMaterial(props, prMat, (_r, camera) => setView(camera));

  object.add(backdrop, props);

  // ---------------------------------------------------------------- looks
  const apply = () => {
    const t = ease.amount;
    mixSky(palette, t, mix);
    bd.uShadowParams.value.w = mix.shadowAmt;
    bd.uStars.value = mix.stars;
    pr.uRimAmt.value = mix.rimAmt;
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
