// Owner: C2 (camera rig). Critically damped springs (no overshoot) for camera moves: exact closed-form step, so the
// motion is frame-rate independent. `settleS` is the time to get within 0.1 % of the goal (1 % at ~0.7 × settleS).

export interface Spring { x: number; v: number }

/** ω for a critically damped spring that settles to 0.1 % in `settleS` ((1 + ωt)e^(−ωt) = 0.001 at ωt ≈ 9.23). */
export const omegaFor = (settleS: number): number => 9.23 / Math.max(1e-3, settleS);

/** Advance `s` toward `goal` by dt seconds (in place). */
export function stepSpring(s: Spring, goal: number, omega: number, dt: number): Spring {
  const e = Math.exp(-omega * dt);
  const d = s.x - goal;
  const j = s.v + omega * d;
  s.x = goal + (d + j * dt) * e;
  s.v = (s.v - omega * j * dt) * e;
  return s;
}

/** A group of springs that move together and report when all have settled. */
export class SpringSet<K extends string> {
  readonly s: Record<K, Spring>;
  goal: Record<K, number>;
  omega: number;

  constructor(init: Record<K, number>, settleS: number) {
    this.s = Object.fromEntries(Object.entries(init).map(([k, v]) => [k, { x: v as number, v: 0 }])) as Record<K, Spring>;
    this.goal = { ...init };
    this.omega = omegaFor(settleS);
  }

  /** Restart from `from` (velocities kept unless reset) toward `goal`. */
  start(from: Record<K, number>, goal: Record<K, number>, keepVelocity = true): void {
    for (const k of Object.keys(from) as K[]) { this.s[k].x = from[k]; if (!keepVelocity) this.s[k].v = 0; }
    this.goal = { ...goal };
  }

  step(dt: number): void {
    for (const k of Object.keys(this.goal) as K[]) stepSpring(this.s[k], this.goal[k], this.omega, dt);
  }

  value(k: K): number { return this.s[k].x; }

  /** All springs within `eps` of their goals and nearly still. */
  settled(eps = 1e-3): boolean {
    return (Object.keys(this.goal) as K[]).every((k) => Math.abs(this.s[k].x - this.goal[k]) < eps && Math.abs(this.s[k].v) < eps * 10);
  }

  snap(): void { for (const k of Object.keys(this.goal) as K[]) { this.s[k].x = this.goal[k]; this.s[k].v = 0; } }
}
