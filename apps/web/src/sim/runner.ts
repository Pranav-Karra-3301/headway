// Fixed-step sim driver with render interpolation (T3a owns).
import type { Intent, Sim, SimSnapshot } from '@headway/sim';

export type Speed = 1 | 4 | 8 | 16;
const MAX_STEPS_PER_FRAME = 64;

export class SimRunner {
  sim: Sim;
  prev: SimSnapshot;
  next: SimSnapshot;
  /** Interpolation factor between prev and next for the renderer. */
  alpha = 1;
  speed: Speed;
  paused = false;
  private acc = 0;

  constructor(create: () => Sim, speed: Speed = 8) {
    this.sim = create();
    this.speed = speed;
    this.next = this.sim.snapshot();
    this.prev = this.next;
  }

  /** Display time in sim seconds (fractional). */
  get simT(): number {
    return this.prev.t + (this.next.t - this.prev.t) * this.alpha;
  }

  setSpeed(s: Speed): void { this.speed = s; }
  pause(): void { this.paused = true; }
  resume(): void { this.paused = false; }

  reset(create: () => Sim): void {
    this.sim = create();
    this.acc = 0;
    this.alpha = 1;
    this.next = this.sim.snapshot();
    this.prev = this.next;
  }

  /** Advance by real seconds: steps = floor(acc), at most 64 per frame; one snapshot per frame. */
  frame(dtS: number): void {
    if (this.paused || this.sim.done) { this.alpha = 1; return; }
    this.acc += Math.min(Math.max(dtS, 0), 0.25) * this.speed;
    let steps = Math.floor(this.acc);
    if (steps > MAX_STEPS_PER_FRAME) { steps = MAX_STEPS_PER_FRAME; this.acc = steps; }
    if (steps > 0) {
      this.prev = this.next;
      for (let i = 0; i < steps && !this.sim.done; i++) {
        if (this.sim.step().pending) break; // async decision outstanding: the host resolves it
      }
      this.next = this.sim.snapshot();
      this.acc -= steps;
    }
    const span = this.next.t - this.prev.t;
    const display = this.next.t - 1 + this.acc;
    this.alpha = span > 0 ? Math.min(1, Math.max(0, (display - this.prev.t) / span)) : 1;
  }

  intent(i: Intent): void { this.sim.intent(i); }
}
