// Snapshot/observation → the 4 Hz HUD feed (T3a). Pure helpers; the canvas host calls them.
import { clockAt } from '@headway/sim';
import type { Observation, SimSnapshot } from '@headway/sim';
import type { HudMetrics } from './store';

/** 'HH:MM' + whole sim minutes, wrapping at midnight. */
export function formatClock(clockStart: string, t: number): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(clockStart.trim());
  const start = m ? Number(m[1]) * 60 + Number(m[2]) : 0;
  const total = (((start + Math.floor(Math.max(0, t) / 60)) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** The sim's `clockAt` (T1c) when available, else the local formatter. */
export function safeClock(clockStart: string, t: number): string {
  try {
    const s = clockAt(clockStart, t);
    if (typeof s === 'string' && s) return s;
  } catch { /* metrics module not ready */ }
  return formatClock(clockStart, t);
}

export function buildHud(snap: SimSnapshot, obs: Observation | null, p95WaitS: number): HudMetrics {
  const r = snap.running;
  return {
    t: snap.t,
    clock: safeClock(obs?.scenario?.clockStart ?? '00:00', snap.t),
    phase: snap.phase,
    meanWaitS: r.meanWaitS,
    completionPct: r.spawned > 0 ? (r.completed / r.spawned) * 100 : 0,
    missedConnections: r.missedConnections,
    waitingNow: r.waitingNow,
    ridingNow: r.ridingNow,
    jSoFar: r.jSoFar,
    p95WaitS,
    spawned: r.spawned, completed: r.completed, leftBehind: r.leftBehind,
  };
}

/** Tracks waits from snapshots: a person leaving the waiting state finishes a wait; current waits count too. */
export class WaitTracker {
  private waiting = new Map<number, number>(); // id → since
  private finished: number[] = [];
  private lastT = 0;

  observe(snap: SimSnapshot): void {
    const seen = new Set<number>();
    for (const p of snap.people) {
      if (p.state !== 'waiting') continue;
      seen.add(p.id);
      if (!this.waiting.has(p.id)) this.waiting.set(p.id, p.since ?? snap.t);
    }
    for (const [id, since] of this.waiting) {
      if (!seen.has(id)) { this.finished.push(Math.max(0, snap.t - since)); this.waiting.delete(id); }
    }
    this.lastT = snap.t;
  }

  /** Nearest-rank p95 over finished waits and people still waiting at time t. */
  p95(t: number = this.lastT): number {
    const all = this.finished.slice();
    for (const since of this.waiting.values()) all.push(Math.max(0, t - since));
    if (all.length === 0) return 0;
    all.sort((a, b) => a - b);
    return all[Math.ceil(0.95 * all.length) - 1]!;
  }

  reset(): void { this.waiting.clear(); this.finished = []; this.lastT = 0; }
}
