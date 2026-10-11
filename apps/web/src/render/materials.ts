// Owner: T2. Role-based material registry. One shared MeshStandardMaterial per (role, variant);
// palette, light mode and highlight fade are applied by recolouring these materials in place,
// so merged static geometry and instanced meshes never need rebuilding.
import * as THREE from 'three';
import { colorOf, GLOW, PALETTES, type Palette, type Role } from './palettes';
import type { LightMode, PaletteId } from './types';

interface Entry { role: Role; idx: number; m: THREE.MeshStandardMaterial }
export type ShaderHook = (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void;

const ROUGH: Partial<Record<Role, number>> = { window: 0.45, glass: 0.4, rail: 0.5, hub: 0.55, display: 0.6 };
const tmp = new THREE.Color();
const bgTmp = new THREE.Color();

export class Materials {
  palette: PaletteId;
  light: LightMode;
  private entries = new Map<string, Entry>();
  private extra = new Set<THREE.Material>();
  private fadeAmt = 0;
  private keep: ((role: Role, idx: number) => boolean) | null = null;
  private listeners = new Set<() => void>();
  private hook: ShaderHook | null = null;
  private hookKey = '';

  constructor(opts: { palette?: PaletteId; light?: LightMode } = {}) {
    this.palette = opts.palette ?? 'a';
    this.light = opts.light ?? 'day';
  }

  get P(): Palette { return PALETTES[this.palette]; }

  /** Shared material for a role/variant. Never dispose it yourself; call `dispose()` on the registry. */
  get(role: Role, idx = 0): THREE.MeshStandardMaterial {
    const i = Array.isArray(this.P[role]) ? idx : (GLOW[role]?.onlyIdx !== undefined ? idx : 0);
    const key = `${role}#${i}`;
    let e = this.entries.get(key);
    if (!e) {
      const m = new THREE.MeshStandardMaterial({ roughness: ROUGH[role] ?? 0.82, metalness: 0 });
      m.name = key;
      e = { role, idx: i, m };
      this.entries.set(key, e);
      this.installHook(m);
      this.apply(e);
    }
    return e.m;
  }

  /** Register a non-role material (e.g. white instanced foliage) so it shares the shader hook and is disposed with us. */
  adopt<M extends THREE.Material>(m: M): M {
    this.extra.add(m);
    this.installHook(m);
    return m;
  }

  /** Effective colour of a role right now (palette + fade), e.g. for instance tints. */
  color(role: Role, idx = 0, target = new THREE.Color()): THREE.Color {
    target.set(colorOf(this.P, role, idx));
    const f = this.fadeFor(role, idx);
    if (f > 0) target.lerp(bgTmp.set(this.P.bg), f);
    return target;
  }

  setPalette(id: PaletteId): void { if (id !== this.palette) { this.palette = id; this.applyAll(); } }
  setLight(mode: LightMode): void { if (mode !== this.light) { this.light = mode; this.applyAll(); } }

  /** Lerp every role except `keep` toward the background by `amount` (0..1). `fade(0)` restores everything. */
  fade(amount: number, keep: ((role: Role, idx: number) => boolean) | null = null): void {
    this.fadeAmt = Math.max(0, Math.min(1, amount));
    this.keep = keep;
    this.applyAll();
  }

  /** Called after any recolour (palette, light, fade). Returns an unsubscribe function. */
  onChange(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  /** Install a shared onBeforeCompile hook (the LOOK "clay" tweak) on every current and future material. */
  setShaderHook(hook: ShaderHook | null, cacheKey = 'clay'): void {
    this.hook = hook;
    this.hookKey = hook ? cacheKey : '';
    for (const e of this.entries.values()) this.installHook(e.m);
    for (const m of this.extra) this.installHook(m);
  }

  forEach(fn: (m: THREE.MeshStandardMaterial, role: Role, idx: number) => void): void {
    for (const e of this.entries.values()) fn(e.m, e.role, e.idx);
  }

  dispose(): void {
    for (const e of this.entries.values()) e.m.dispose();
    for (const m of this.extra) m.dispose();
    this.entries.clear();
    this.extra.clear();
    this.listeners.clear();
  }

  private fadeFor(role: Role, idx: number): number {
    if (this.fadeAmt <= 0) return 0;
    if (role === 'bg') return 0;
    return this.keep && this.keep(role, idx) ? 0 : this.fadeAmt;
  }

  private installHook(m: THREE.Material): void {
    const hook = this.hook;
    if (hook) {
      m.onBeforeCompile = (shader, renderer) => hook(shader, renderer);
      const key = this.hookKey;
      m.customProgramCacheKey = () => key;
    } else {
      m.onBeforeCompile = () => {};
      m.customProgramCacheKey = () => '';
    }
    m.needsUpdate = true;
  }

  private applyAll(): void {
    for (const e of this.entries.values()) this.apply(e);
    for (const fn of this.listeners) fn();
  }

  private apply(e: Entry): void {
    this.color(e.role, e.idx, tmp);
    e.m.color.copy(tmp);
    const g = GLOW[e.role];
    const glows = !!g && this.light === 'dusk' && (g.onlyIdx === undefined || g.onlyIdx === e.idx);
    if (glows && g) {
      e.m.emissive.set(g.color);
      e.m.emissiveIntensity = g.intensity * (1 - 0.7 * this.fadeFor(e.role, e.idx));
    } else {
      e.m.emissive.setRGB(0, 0, 0);
      e.m.emissiveIntensity = 0;
    }
  }
}
