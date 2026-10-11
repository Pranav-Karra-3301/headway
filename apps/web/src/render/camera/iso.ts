// Owner: C2 (camera rig). The game camera's angles and tuning, in one place. Elevation/azimuth are C1's measured
// recommendation (camera study, /camera-study.html): true isometric 35.264° at azimuth 45° (south-east, looking
// north-west). Change the numbers here; everything else (rig, fit, x-ray rays, previews) reads them.
import * as THREE from 'three';

/** True isometric elevation, atan(1/√2) ≈ 35.264°: 30° ground lines, equal 0.816 foreshortening on all axes. */
export const ISO_ELEVATION_DEG = (Math.atan(Math.SQRT1_2) * 180) / Math.PI;

export const CAMERA = {
  /** View-ray angle above the ground (C1: 35.264°). */
  elevationDeg: ISO_ELEVATION_DEG,
  /** Camera ground direction, measured from +z toward +x (C1: 45° = south-east). */
  azimuthDeg: 45,
  /** Target → camera distance; outside the diorama's ~95 u bounding sphere. */
  distance: 400,
  near: 1,
  far: 1000,
  /** World units visible vertically at zoom 1 (zoom is the only scale control). */
  viewH: 40,
  /** Margin inside the HUD-safe rect, as a fraction of its size on each side. */
  pad: 0.04,
  /** Zoom range relative to the Overview fit. */
  minZoomK: 0.8,
  maxZoomK: 4,
  /** Below this fraction of Overview the pan clamp lets the diorama's cut edge show (bible §1.4). */
  edgeClampK: 0.85,
  /** Spring settle time (s, to 0.1 %) for presets, focus and refits; zoom springs in log space. */
  springS: 0.7,
  /** Hold Q / E to peek: swing the azimuth by this much, spring back on release (no 90° steps, bible §1.6). */
  peekDeg: 20,
  /** Focus (double-click / F): entity ± radius, at least this × Overview. */
  focusRadius: 6,
  focusZoomK: 2.5,
  /** Wheel zoom factor per notch. */
  wheelStep: 1.1,
  /** Ensure-visible margin (CSS px) and follow dead zone (inner fraction of the safe rect). */
  ensureMarginPx: 48,
  followInner: 0.6,
  /** HUD defaults (CSS px) used until the HUD reports its real rect: top bar incl. gap, queue-marker headroom, gap. */
  hudTop: 80,
  hudMarkers: 36,
  hudGap: 14,
  /** Pan clamp: the top of the safe rect may look at ridges this tall (u); the extent shrinks by `extentInset`. */
  ridgeY: 14,
  extentInset: 2,
} as const;

export interface V3 { x: number; y: number; z: number }

/** Unit vector from the look-at target toward the camera; azimuth from +z toward +x. (1,1,1)/√3 at the defaults. */
export function viewDir(elevationDeg: number = CAMERA.elevationDeg, azimuthDeg: number = CAMERA.azimuthDeg, out = new THREE.Vector3()): THREE.Vector3 {
  const e = THREE.MathUtils.degToRad(elevationDeg), a = THREE.MathUtils.degToRad(azimuthDeg);
  return out.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a));
}

/** Orthonormal image-plane basis for a view: `right`/`up` span the screen, `dir` points target → camera. */
export interface ViewBasis { right: V3; up: V3; dir: V3 }

export function viewBasis(elevationDeg: number = CAMERA.elevationDeg, azimuthDeg: number = CAMERA.azimuthDeg): ViewBasis {
  const e = THREE.MathUtils.degToRad(elevationDeg), a = THREE.MathUtils.degToRad(azimuthDeg);
  const ce = Math.cos(e), se = Math.sin(e), ca = Math.cos(a), sa = Math.sin(a);
  return {
    dir: { x: ce * sa, y: se, z: ce * ca },
    right: { x: ca, y: 0, z: -sa },
    up: { x: -se * sa, y: ce, z: -se * ca },
  };
}

/** Put an orthographic camera `distance` from `target` along the view direction, looking at it. */
export function placeCamera(cam: THREE.Camera, target: V3, elevationDeg: number = CAMERA.elevationDeg, azimuthDeg: number = CAMERA.azimuthDeg, distance: number = CAMERA.distance): void {
  const d = viewDir(elevationDeg, azimuthDeg);
  cam.position.set(target.x + d.x * distance, target.y + d.y * distance, target.z + d.z * distance);
  cam.up.set(0, 1, 0);
  cam.lookAt(target.x, target.y, target.z);
  cam.updateMatrixWorld(true);
}
