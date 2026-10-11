// Owner: T2.1. The post chain ("look"):
//   RenderPass → GTAOPass (soft contact darkening) → tilt-shift X/Y (miniature focus band) → UnrealBloomPass
//   (dusk only: windows, lamps, headlights) → warm grade (lift, saturation, vignette, grain) → OutputPass → SMAA.
// Quality tiers: 'high' = full chain at device pixel ratio ≤ 2; 'low' = Render → Grade → Output at ratio 1.
// Auto-downgrade: frame time > 22 ms sustained for 2 s switches to 'low' (onQualityChange fires).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { gradeShader, tiltShiftShader } from './shaders';

export type Quality = 'high' | 'low';

export interface LookOptions {
  quality?: Quality;
  /** Auto-downgrade to 'low' on sustained slow frames (default true). */
  autoQuality?: boolean;
  onQualityChange?: (q: Quality) => void;
}

const SLOW_MS = 22, SLOW_FOR_MS = 2000;

export class Look {
  readonly composer: EffectComposer;
  quality: Quality;
  autoQuality: boolean;
  onQualityChange: ((q: Quality) => void) | null;
  private readonly renderPass: RenderPass;
  private readonly gtao: GTAOPass;
  private readonly tiltX: ShaderPass;
  private readonly tiltY: ShaderPass;
  private readonly bloom: UnrealBloomPass;
  private readonly grade: ShaderPass;
  private readonly output: OutputPass;
  private readonly smaa: SMAAPass;
  private width = 1;
  private height = 1;
  private dusk = 0;
  private lastT = 0;
  private slowSince = -1;

  constructor(private readonly renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, opts: LookOptions = {}) {
    this.quality = opts.quality ?? 'high';
    this.autoQuality = opts.autoQuality ?? true;
    this.onQualityChange = opts.onQualityChange ?? null;
    const size = renderer.getSize(new THREE.Vector2());
    this.width = Math.max(1, size.x);
    this.height = Math.max(1, size.y);
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.gtao = new GTAOPass(scene, camera, this.width, this.height);
    this.gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 12, distanceFallOff: 1.0, screenSpaceRadius: false });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1, rings: 2, samples: 12 });
    this.gtao.blendIntensity = 0.75;
    this.tiltX = new ShaderPass(tiltShiftShader('x'));
    this.tiltY = new ShaderPass(tiltShiftShader('y'));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(this.width, this.height), 0.0, 0.55, 0.82);
    this.grade = new ShaderPass(gradeShader());
    this.output = new OutputPass();
    this.smaa = new SMAAPass();
    this.rebuild();
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(this.width, this.height);
    const pr = this.renderer.getPixelRatio();
    // AO is low-frequency: run it at CSS-pixel resolution even on hi-DPI screens (4× cheaper at DPR 2).
    if (pr > 1) this.gtao.setSize(this.width, this.height);
    for (const p of [this.tiltX, this.tiltY]) p.uniforms.uTexel!.value.set(1 / (this.width * pr), 1 / (this.height * pr));
    this.grade.uniforms.uAspect!.value = this.width / this.height;
  }

  /** 0 = day … 1 = dusk: bloom strength, grade warmth/lift/vignette. */
  setDusk(t: number): void {
    this.dusk = Math.max(0, Math.min(1, t));
    const d = this.dusk;
    this.bloom.strength = 0.75 * d;
    this.bloom.enabled = this.quality === 'high' && d > 0.02;
    const u = this.grade.uniforms;
    u.uWarmth!.value = 0.035 + 0.03 * d;
    u.uSaturation!.value = 1.08 + 0.1 * d;
    u.uVignette!.value = 0.22 + 0.16 * d;
    (u.uLift!.value as THREE.Color).setRGB(0.009 + 0.01 * d, 0.007 + 0.009 * d, 0.012 + 0.028 * d);
    (u.uShadowTint!.value as THREE.Color).setRGB(0.985 - 0.07 * d, 0.995 - 0.01 * d, 1.025 + 0.11 * d);
    (u.uHighlightTint!.value as THREE.Color).setRGB(1.02 + 0.07 * d, 1.0 + 0.01 * d, 0.975 - 0.06 * d);
    this.gtao.blendIntensity = 0.75 - 0.2 * d;
  }

  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.rebuild();
    this.onQualityChange?.(q);
  }

  /** Render one frame through the chain. Call instead of renderer.render. */
  render(dtS: number): void {
    this.grade.uniforms.uTime!.value += dtS;
    this.composer.render(dtS);
    this.watchdog();
  }

  dispose(): void {
    this.gtao.dispose();
    this.bloom.dispose();
    this.smaa.dispose();
    this.output.dispose();
    this.tiltX.dispose();
    this.tiltY.dispose();
    this.grade.dispose();
    this.composer.dispose();
  }

  private rebuild(): void {
    const c = this.composer;
    for (const p of [...c.passes]) c.removePass(p);
    const high = this.quality === 'high';
    c.addPass(this.renderPass);
    if (high) {
      c.addPass(this.gtao);
      c.addPass(this.tiltX);
      c.addPass(this.tiltY);
      c.addPass(this.bloom);
    }
    c.addPass(this.grade);
    c.addPass(this.output);
    if (high) c.addPass(this.smaa);
    this.setDusk(this.dusk);
    this.setSize(this.width, this.height);
  }

  private watchdog(): void {
    const now = performance.now();
    const dt = this.lastT ? now - this.lastT : 0;
    this.lastT = now;
    if (!this.autoQuality || this.quality === 'low' || dt <= 0 || dt > 1000) { this.slowSince = -1; return; }
    if (dt > SLOW_MS) {
      if (this.slowSince < 0) this.slowSince = now;
      else if (now - this.slowSince > SLOW_FOR_MS) { this.slowSince = -1; this.setQuality('low'); }
    } else {
      this.slowSince = -1;
    }
  }
}
