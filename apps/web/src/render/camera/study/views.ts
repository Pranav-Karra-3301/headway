// Owner: C1 (camera study). The views under study and the orthographic camera basis for each.
// Angles in degrees. Elevation = angle of the view ray above the ground; azimuth = angle of the camera's ground
// direction from +z toward +x (45° = classic iso from the south-east, 35° = more from the south, 55° = more from the east).
export interface V3 { x: number; y: number; z: number }
export interface V2 { x: number; y: number }
export interface ViewSpec { id: string; elev: number; az: number; label?: string }
/** Unit vectors: d points from the target toward the camera; right/up span the image plane (three.js lookAt, up = +y). */
export interface Basis { d: V3; right: V3; up: V3 }

const RAD = Math.PI / 180;
/** True isometric elevation: atan(1/√2) ≈ 35.264°. */
export const ISO_ELEV = Math.atan(1 / Math.SQRT2) / RAD;
export const STUDY_ELEVS = [30, ISO_ELEV, 45] as const;
export const STUDY_AZS = [35, 45, 55] as const;

const elevTag = (e: number) => (Math.abs(e - ISO_ELEV) < 1e-6 ? 'iso' : String(Math.round(e)));
export const viewId = (elev: number, az: number) => `e${elevTag(elev)}-a${Math.round(az)}`;
export const viewLabel = (elev: number, az: number) =>
  `${Math.abs(elev - ISO_ELEV) < 1e-6 ? '35.26' : +elev.toFixed(2)}° · az ${+az.toFixed(1)}°`;

export const STUDY_VIEWS: ViewSpec[] = STUDY_ELEVS.flatMap((elev) =>
  STUDY_AZS.map((az) => ({ id: viewId(elev, az), elev, az, label: viewLabel(elev, az) })),
);

/** The rig shipped by T2.1 (render/camera.ts ISO_DIR = (70, 62, 70)): ≈ 32.05° at 45°. Reference row only. */
export const CURRENT_RIG_VIEW: ViewSpec = {
  id: 'rig-now', elev: Math.atan2(62, Math.hypot(70, 70)) / RAD, az: 45, label: 'current rig 32.05° · az 45°',
};

export function viewBasis(v: { elev: number; az: number }): Basis {
  const e = v.elev * RAD, a = v.az * RAD;
  const ce = Math.cos(e), se = Math.sin(e), ca = Math.cos(a), sa = Math.sin(a);
  return {
    d: { x: ce * sa, y: se, z: ce * ca },
    right: { x: ca, y: 0, z: -sa },
    up: { x: -se * sa, y: ce, z: -se * ca },
  };
}

/** Image-plane coordinates (world units; x right, y up) of a world point. */
export function toImage(b: Basis, p: V3): V2 {
  return { x: p.x * b.right.x + p.y * b.right.y + p.z * b.right.z, y: p.x * b.up.x + p.y * b.up.y + p.z * b.up.z };
}
