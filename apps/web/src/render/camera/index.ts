// Owner: C2 (camera rig). Barrel for the game camera: angles (iso), framing math (fit), presets, springs, the rig and
// the x-ray occlusion helper. Note: `render/camera.ts` (T2.1's original rig) shadows `./camera` imports — import
// from './camera/index' or './camera/rig' explicitly.
export { CAMERA, ISO_ELEVATION_DEG, placeCamera, viewBasis, viewDir, type V3, type ViewBasis } from './iso';
export {
  avoidCorners, boxPoints, clampTarget, ensureVisibleDelta, fitPoints, fitToSafeArea, fromScreen, groundAt, hudSafeRect, imageBounds,
  insetsToRect, networkPoints, sanitizeRect, targetFor, toScreen, type FitResult, type Insets, type PlanRect, type Rect, type Viewport,
} from './fit';
export { PRESETS, PRESET_BY_ID, presetPoints, type PresetDef, type PresetId } from './presets';
export { omegaFor, SpringSet, stepSpring, type Spring } from './spring';
export { CameraRig, type Bounds, type CameraMode, type CameraRigOptions, type SafeAreaOptions } from './rig';
export {
  boxContains, boxesFromPlacements, patchXrayMaterial, queueTriggerPoints, rayHitsBox, XRAY_BAYER_GLSL, XRAY_ID0, XRAY_STRENGTH,
  XRAY_MAX_WINDOWS, XRAY_TIMING, xrayDefaultFilter, XrayTracker, type XrayBox, type XrayOptions, type XrayTrigger, type XrayView,
} from './xray';
