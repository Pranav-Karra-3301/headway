// Owner: T2.4. What the FX need to know about the running scenario (FrameContext carries no scenario): the clock
// start (clock hands) and the advertised events (confetti at `stadium_closing`). Read once per sim instance from
// the app's runner (`frame.runner`, set by the canvas host); `setFxScenario` overrides it (dev pages, tests).
import type { AdvertisedEvent } from '@headway/sim';
import { frame } from '../../state/frame';

export interface FxScenario { clockStart: string; advertised: readonly AdvertisedEvent[] }

let override: FxScenario | null = null;
let lastSim: unknown = null;
let lastInfo: FxScenario | null = null;

export function setFxScenario(s: FxScenario | null): void { override = s; }

export function currentFxScenario(): FxScenario | null {
  if (override) return override;
  const sim = frame.runner?.sim;
  if (!sim) return null;
  if (sim !== lastSim) {
    lastSim = sim;
    try {
      const o = sim.observe();
      lastInfo = { clockStart: o.scenario.clockStart, advertised: o.scenario.advertised };
    } catch {
      lastInfo = null;
    }
  }
  return lastInfo;
}

/** Advertised stadium closing time (sim seconds) of the running scenario, or null. */
export function stadiumClosingT(s: FxScenario | null): number | null {
  const e = s?.advertised.find((a) => a.kind === 'stadium_closing');
  return e ? e.t : null;
}
