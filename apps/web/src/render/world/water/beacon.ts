// Owner: E2 (v13). The lighthouse beacon: two opposed soft light beams that sweep round the lantern, plus a lantern
// halo that flares as a beam swings toward the camera. Day and dusk alike (subtle by day, glowing at dusk) — one
// additive mesh. Vertices are *parameters* (beam: along / cos / sin; halo: quad corner) expanded in the vertex
// shader, so the raw geometry stays a tiny box around the lantern (cheap bounds, nothing pokes into the town).
// Deterministic: the sweep angle is a pure function of time — no noise, so it never flickers.
import * as THREE from 'three';

const VS = /* glsl */ `
uniform float uAngle, uLen, uR0, uR1, uHalo;
attribute float aHalo;
varying float vAlong, vFace, vHalo, vFlash;
varying vec2 vQ;
void main() {
	vec3 dir = vec3( cos( uAngle ), -0.07, sin( uAngle ) );
	dir = normalize( dir );
	vec3 vdir = normalize( mat3( viewMatrix ) * dir );
	vFlash = pow( abs( vdir.z ), 10.0 );
	vHalo = aHalo;
	vQ = position.xy;
	if ( aHalo > 0.5 ) {
		vec4 c = modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
		c.xy += position.xy * uHalo * ( 1.0 + 0.6 * vFlash );
		c.z += 1.2;
		gl_Position = projectionMatrix * c;
		vAlong = 0.0; vFace = 1.0;
		return;
	}
	float s = sign( position.x );
	float t = abs( position.x );
	vec3 d = dir * s;
	vec3 perp = normalize( cross( d, vec3( 0.0, 1.0, 0.0 ) ) );
	vec3 up = cross( perp, d );
	vec3 rim = perp * position.y + up * position.z;
	float r = mix( uR0, uR1, t );
	vec3 p = d * t * uLen + rim * r;
	vAlong = t;
	vFace = abs( normalize( mat3( viewMatrix ) * rim ).z );
	gl_Position = projectionMatrix * modelViewMatrix * vec4( p, 1.0 );
}
`;

const FS = /* glsl */ `
uniform vec3 uColor;
uniform float uI;
varying float vAlong, vFace, vHalo, vFlash;
varying vec2 vQ;
void main() {
	float a;
	if ( vHalo > 0.5 ) {
		float r = length( vQ );
		a = pow( max( 0.0, 1.0 - r ), 2.2 ) * ( 0.55 + 0.9 * vFlash );
	} else {
		a = pow( vFace, 1.6 ) * pow( 1.0 - vAlong, 1.3 ) * smoothstep( 0.0, 0.06, vAlong ) * 0.55;
	}
	gl_FragColor = vec4( uColor * uI * a, a );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}
`;

export interface Beacon {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  /** timeS: seconds; dusk: 0 = day … 1 = dusk. */
  update(timeS: number, dusk: number): void;
}

/** Beam cone (2 opposed, `seg` sides, `rings` along) + one halo quad, as parameter vertices. */
function beaconGeometry(seg = 18, rings = 6): THREE.BufferGeometry {
  const pos: number[] = [], halo: number[] = [], idx: number[] = [];
  for (const s of [1, -1]) {
    const base = pos.length / 3;
    for (let i = 0; i <= rings; i++) {
      const t = 0.02 + (0.98 * i) / rings;
      for (let k = 0; k <= seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        pos.push(s * t, Math.cos(a), Math.sin(a));
        halo.push(0);
      }
    }
    for (let i = 0; i < rings; i++) {
      for (let k = 0; k < seg; k++) {
        const a = base + i * (seg + 1) + k, b = a + seg + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const h = pos.length / 3;
  for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) { pos.push(x, y, 0); halo.push(1); }
  idx.push(h, h + 1, h + 2, h, h + 2, h + 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aHalo', new THREE.Float32BufferAttribute(halo, 1));
  g.setIndex(idx);
  return g;
}

/** The sweeping beacon at the lantern centre (world position). */
export function createBeacon(x: number, y: number, z: number): Beacon {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uAngle: { value: 0 }, uLen: { value: 10.5 }, uR0: { value: 0.22 }, uR1: { value: 1.7 }, uHalo: { value: 0.9 },
      uColor: { value: new THREE.Color('#FFE6A8') }, uI: { value: 0.3 },
    },
    vertexShader: VS, fragmentShader: FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(beaconGeometry(), material);
  mesh.name = 'water:beacon';
  mesh.position.set(x, y, z);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 6;
  // Keep it out of override-material passes (GTAO normals/depth) so the light never casts ambient occlusion.
  let saved = -1;
  mesh.onBeforeRender = (_r, scene, _c, geometry, mat) => {
    if (scene.overrideMaterial && mat === scene.overrideMaterial) { saved = geometry.drawRange.count; geometry.drawRange.count = 0; }
  };
  mesh.onAfterRender = (_r, _s, _c, geometry) => {
    if (saved !== -1) { geometry.drawRange.count = saved; saved = -1; }
  };
  return {
    mesh, material,
    update(timeS, dusk) {
      const d = Math.max(0, Math.min(1, dusk));
      material.uniforms.uAngle!.value = (timeS * 0.7) % (Math.PI * 2);
      material.uniforms.uI!.value = 0.45 + 0.55 * d;
    },
  };
}
