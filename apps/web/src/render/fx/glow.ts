// Owner: T2.4. Additive dusk light: camera-facing halos (lamp globes, floodlight heads), soft pools of light on the
// ground (under lamps, on the stadium pitch) and floodlight cones. Each is one InstancedMesh; per-instance colour
// carries colour × strength; one `uI` uniform scales everything with dusk and the highlight fade. Kept out of
// override-material passes (GTAO normals/depth) so the glows never cast ambient occlusion.
import * as THREE from 'three';
import type { FloodAnchor, Vec3 } from './anchors';

/** Skip a mesh in passes that render the scene with `scene.overrideMaterial` (GTAO G-buffer, outlines). */
export function hideFromOverride(mesh: THREE.Mesh): void {
  let saved = -1;
  mesh.onBeforeRender = (_r, scene, _c, geometry, material) => {
    if (scene.overrideMaterial && material === scene.overrideMaterial) { saved = geometry.drawRange.count; geometry.drawRange.count = 0; }
  };
  mesh.onAfterRender = (_r, _s, _c, geometry) => {
    if (saved !== -1) { geometry.drawRange.count = saved; saved = -1; }
  };
}

const FRAG_TAIL = /* glsl */ `
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
`;

const HALO_VS = /* glsl */ `
varying vec2 vUv;
varying vec3 vCol;
void main() {
	vec4 c = modelViewMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
	float s = length( instanceMatrix[ 0 ].xyz );
	c.xy += position.xy * s;
	c.z += s * 0.6; // in front of the lamp head it surrounds
	gl_Position = projectionMatrix * c;
	vUv = uv;
	vCol = instanceColor;
}
`;
const HALO_FS = /* glsl */ `
uniform float uI;
varying vec2 vUv;
varying vec3 vCol;
void main() {
	float r = length( vUv - 0.5 ) * 2.0;
	float a = pow( max( 0.0, 1.0 - r ), 2.4 ) + 0.6 * pow( max( 0.0, 1.0 - r * 2.2 ), 2.0 );
	gl_FragColor = vec4( vCol * uI, a );
	${FRAG_TAIL}
}
`;

const POOL_VS = /* glsl */ `
varying vec2 vUv;
varying vec3 vCol;
void main() {
	gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
	vUv = uv;
	vCol = instanceColor;
}
`;
const POOL_FS = /* glsl */ `
uniform float uI;
varying vec2 vUv;
varying vec3 vCol;
void main() {
	float r = length( vUv - 0.5 ) * 2.0;
	float a = smoothstep( 1.0, 0.0, r );
	a *= a;
	gl_FragColor = vec4( vCol * uI, a );
	${FRAG_TAIL}
}
`;

const CONE_VS = /* glsl */ `
varying float vAlong;
varying float vFace;
varying vec3 vCol;
void main() {
	vAlong = 1.0 - uv.y;
	mat3 im = mat3( instanceMatrix );
	vec3 sc = vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	vec3 n = normalize( normalMatrix * ( im * ( normal / sc ) ) ); // inverse-transpose of R·S
	vFace = abs( n.z );
	vCol = instanceColor;
	gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
}
`;
const CONE_FS = /* glsl */ `
uniform float uI;
uniform float uFxTime;
varying float vAlong;
varying float vFace;
varying vec3 vCol;
void main() {
	float a = pow( vFace, 1.7 ) * pow( 1.0 - vAlong, 1.25 ) * smoothstep( 0.0, 0.08, vAlong );
	a *= 0.9 + 0.1 * sin( uFxTime * 2.3 + vAlong * 9.0 );
	gl_FragColor = vec4( vCol * uI, a );
	${FRAG_TAIL}
}
`;

function additive(vs: string, fs: string, extra: Record<string, THREE.IUniform> = {}, side: THREE.Side = THREE.FrontSide): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uI: { value: 1 }, ...extra },
    vertexShader: vs, fragmentShader: fs,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side,
  });
}

export interface GlowItem { p: Vec3; size: number; color: THREE.ColorRepresentation; strength: number; /** pools: x/z half extents + yaw */ sx?: number; sz?: number; yaw?: number }

export interface GlowSet {
  readonly mesh: THREE.InstancedMesh;
  readonly material: THREE.ShaderMaterial;
  /** Re-tint every instance (e.g. on a palette change). */
  recolor(color: (i: number) => THREE.ColorRepresentation): void;
  dispose(): void;
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.ShaderMaterial, items: readonly GlowItem[], name: string, place: (m: THREE.Matrix4, it: GlowItem) => void): GlowSet {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  mesh.count = items.length;
  mesh.visible = items.length > 0;
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3 * Math.max(1, items.length)), 3);
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  const m = new THREE.Matrix4(), c = new THREE.Color();
  items.forEach((it, i) => {
    place(m, it);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.set(it.color).multiplyScalar(it.strength));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  hideFromOverride(mesh);
  return {
    mesh, material: mat,
    recolor(color) {
      items.forEach((it, i) => mesh.setColorAt(i, c.set(color(i)).multiplyScalar(it.strength)));
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

/** Camera-facing soft halos (size = diameter in u). */
export function createHalos(items: readonly GlowItem[]): GlowSet {
  const q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const set = instanced(new THREE.PlaneGeometry(1, 1), additive(HALO_VS, HALO_FS), items, 'fx:halos',
    (m, it) => m.compose(p.set(it.p.x, it.p.y, it.p.z), q.identity(), s.setScalar(it.size)));
  set.mesh.renderOrder = 6;
  return set;
}

/** Flat light pools on the ground (ellipses: sx/sz half extents, yaw). */
export function createPools(items: readonly GlowItem[]): GlowSet {
  const geo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const set = instanced(geo, additive(POOL_VS, POOL_FS), items, 'fx:pools',
    (m, it) => m.compose(p.set(it.p.x, it.p.y, it.p.z), q.setFromAxisAngle(up, it.yaw ?? 0), s.set(it.sx ?? it.size, 1, it.sz ?? it.size)));
  set.mesh.renderOrder = 3;
  return set;
}

/** Volumetric-looking floodlight cones from each head to its target (radius at the far end = `spread`). */
export function createCones(floods: readonly FloodAnchor[], color: THREE.ColorRepresentation, strength: number, time: THREE.IUniform<number>, spread = 2.1): GlowSet {
  const headR = 0.32;
  const geo = new THREE.CylinderGeometry(headR / spread, 1, 1, 28, 1, true).translate(0, -0.5, 0);
  const down = new THREE.Vector3(0, -1, 0), dir = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const items: GlowItem[] = floods.map((f) => ({ p: f.head, size: 1, color, strength }));
  const set = instanced(geo, additive(CONE_VS, CONE_FS, { uFxTime: time }, THREE.DoubleSide), items, 'fx:cones', (m, it) => {
    const f = floods[items.indexOf(it)]!;
    dir.set(f.target.x - f.head.x, f.target.y - f.head.y, f.target.z - f.head.z);
    const len = dir.length();
    q.setFromUnitVectors(down, dir.normalize());
    m.compose(p.set(f.head.x, f.head.y, f.head.z), q, s.set(spread, len, spread));
  });
  set.mesh.renderOrder = 5;
  return set;
}
