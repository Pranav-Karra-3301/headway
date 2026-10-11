// Owner: T2.4. A small celebratory confetti burst over the stadium when the sim clock crosses the advertised
// closing time (`stadium_closing`). Visual only, real-time physics, seeded (renderer-local PRNG). One InstancedMesh,
// drawn only while paper is in the air.
import * as THREE from 'three';
import { shared } from '../materials';
import { colorOf, PALETTES } from '../palettes';
import type { PaletteId } from '../types';
import type { Vec3 } from './anchors';

/** True when the sim clock just crossed `closeT` (not when it jumped far past it, e.g. a fast-forward). */
export function crossedClosing(prevT: number, t: number, closeT: number | null, maxLateS = 90): boolean {
  return closeT !== null && prevT < closeT && t >= closeT && t - closeT <= maxLateS;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Paper {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  rx: number; ry: number; rz: number; wx: number; wy: number; wz: number;
  /** Seconds left (> 0 = alive); `delay` seconds before it launches. */
  life: number; maxLife: number; delay: number; color: number; size: number; phase: number;
}

const G = 7.2, DRAG = 0.9, FALL = 1.25;

export class ConfettiSim {
  readonly particles: Paper[] = [];
  private t = 0;
  constructor(readonly capacity: number) {}

  get alive(): number { let n = 0; for (const p of this.particles) if (p.life > 0) n++; return n; }

  burst(o: Vec3, count: number, seed: number, colors = 8): void {
    const rnd = mulberry32(seed);
    for (const p of this.particles) p.life = 0;
    this.particles.length = 0;
    for (let i = 0; i < Math.min(count, this.capacity); i++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.7, h = 1.2 + rnd() * 2.1, up = 5.4 + rnd() * 2.6;
      const life = 3.6 + rnd() * 1.6;
      this.particles.push({
        x: o.x + Math.cos(a) * r, y: o.y, z: o.z + Math.sin(a) * r,
        vx: Math.cos(a) * h, vy: up, vz: Math.sin(a) * h,
        rx: rnd() * 6.28, ry: rnd() * 6.28, rz: rnd() * 6.28,
        wx: (rnd() - 0.5) * 16, wy: (rnd() - 0.5) * 10, wz: (rnd() - 0.5) * 16,
        life, maxLife: life, delay: i < count * 0.6 ? 0 : 0.18 + rnd() * 0.2,
        color: Math.floor(rnd() * colors), size: 0.8 + rnd() * 0.5, phase: rnd() * 6.28,
      });
    }
  }

  step(dt: number): void {
    if (dt <= 0) return;
    this.t += dt;
    const drag = Math.exp(-DRAG * dt), settle = 1 - Math.exp(-4 * dt);
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      if (p.delay > 0) { p.delay -= dt; continue; }
      p.life -= dt;
      p.vy -= G * dt;
      p.vx *= drag; p.vz *= drag;
      if (p.vy < -FALL) p.vy += (-FALL - p.vy) * settle; // paper flutters down at a terminal speed
      const sway = p.vy < 0 ? Math.sin(this.t * 3.1 + p.phase) * 0.55 : 0;
      p.x += (p.vx + sway) * dt; p.y += p.vy * dt; p.z += (p.vz + Math.cos(this.t * 2.7 + p.phase) * sway * 0.6) * dt;
      if (p.y < 0.04) { p.y = 0.04; p.vx = p.vy = p.vz = 0; p.wx = p.wy = p.wz = 0; }
      p.rx += p.wx * dt; p.ry += p.wy * dt; p.rz += p.wz * dt;
    }
  }
}

export interface Confetti {
  readonly mesh: THREE.InstancedMesh;
  readonly sim: ConfettiSim;
  fire(o: Vec3, seed: number): void;
  step(dtS: number): void;
  setPalette(p: PaletteId): void;
  dispose(): void;
}

const COUNT = 260;

function paletteColors(p: PaletteId): THREE.Color[] {
  const P = PALETTES[p];
  return [colorOf(P, 'route', 0), colorOf(P, 'route', 1), colorOf(P, 'route', 2), colorOf(P, 'roof', 0), colorOf(P, 'stop'),
    colorOf(P, 'awning', 1), colorOf(P, 'paper'), colorOf(P, 'accent')].map((c) => new THREE.Color(c));
}

export function createConfetti(palette: PaletteId = 'a'): Confetti {
  const sim = new ConfettiSim(COUNT);
  const geo = new THREE.PlaneGeometry(0.21, 0.13);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (s) => {
    s.uniforms.uDusk = shared.uDusk;
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uDusk;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * ( 0.12 + 0.45 * uDusk );');
  };
  mat.customProgramCacheKey = () => 'hw-fx-confetti';
  const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 3), 3);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.visible = false;
  mesh.name = 'fx:confetti';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  let colors = paletteColors(palette);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();

  const write = () => {
    let n = 0;
    for (const k of sim.particles) {
      if (k.life <= 0 || k.delay > 0) continue;
      const fade = Math.min(1, k.life / 0.5) * Math.min(1, (k.maxLife - k.life) / 0.08 + 0.2);
      q.setFromEuler(e.set(k.rx, k.ry, k.rz));
      m.compose(p.set(k.x, k.y, k.z), q, s.setScalar(k.size * fade));
      mesh.setMatrixAt(n, m);
      mesh.setColorAt(n, colors[k.color % colors.length]!);
      n++;
    }
    mesh.count = n;
    mesh.visible = n > 0 || sim.alive > 0;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };

  return {
    mesh, sim,
    fire(o, seed) { sim.burst(o, COUNT, seed, colors.length); write(); },
    step(dtS) { if (sim.particles.length === 0) return; sim.step(Math.min(dtS, 0.1)); write(); if (sim.alive === 0) sim.particles.length = 0; },
    setPalette(pal) { colors = paletteColors(pal); },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}
