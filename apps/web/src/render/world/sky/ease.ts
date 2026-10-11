// Owner: E3. Day ↔ dusk easing for world layers, matching Stage (post/stage.ts): exponential approach at rate 3.2/s
// with dt clamped to 0.1 s, then smoothstep. The goal follows `setLight` and any change of `ctx.light`; the very
// first frame snaps (a layer created for dusk does not fade in from day).
import type { LightMode } from '../../types';

export class DuskEase {
  /** Raw eased amount 0 … 1 (before smoothstep). */
  value = 0;
  goal = 0;
  private started = false;
  private explicit = false;
  private lastCtx: LightMode | null = null;

  set(l: LightMode): void {
    this.goal = l === 'dusk' ? 1 : 0;
    this.explicit = true;
    if (!this.started) this.value = this.goal;
  }

  /** Advance one frame; returns the smoothstepped dusk amount. */
  step(ctxLight: LightMode, dtS: number): number {
    if (!this.started) {
      if (!this.explicit) this.goal = ctxLight === 'dusk' ? 1 : 0;
      this.value = this.goal;
      this.started = true;
      this.lastCtx = ctxLight;
    } else if (ctxLight !== this.lastCtx) {
      this.lastCtx = ctxLight;
      this.goal = ctxLight === 'dusk' ? 1 : 0;
    }
    if (this.value !== this.goal) {
      const k = 1 - Math.exp(-Math.min(Math.max(dtS, 0), 0.1) * 3.2);
      this.value += (this.goal - this.value) * k;
      if (Math.abs(this.goal - this.value) < 0.003) this.value = this.goal;
    }
    return this.amount;
  }

  get amount(): number {
    const t = this.value;
    return t * t * (3 - 2 * t);
  }
}
