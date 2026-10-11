// Owner: Task P. Explanation templates filled from real values at decision time (spec §6).
import type { Action, FeatureVector } from '../contracts';

const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

function num(v: number): string {
  if (Number.isInteger(v)) return String(v);
  if (!Number.isFinite(v)) return String(v);
  const s = v.toFixed(1);
  return s === '-0.0' ? '0.0' : s;
}

function actionParam(name: string, action: Action, features: FeatureVector): string | undefined {
  if (name === 'seconds' && action.type === 'hold') {
    if ('seconds' in action) return num(action.seconds);
    // Unresolved `hold until target_headway`: seconds = target_headway_s − headway_ahead_s (the engine may clamp further).
    const target = features.target_headway_s;
    const ahead = features.headway_ahead_s;
    if (typeof target === 'number' && typeof ahead === 'number') return num(Math.max(0, Math.round(target - ahead)));
    return undefined;
  }
  if (name === 'dwellS' && action.type === 'setTrainDeparture') return num(action.dwellS);
  if (name === 'to' && (action.type === 'reassign' || action.type === 'deploy')) return action.to;
  return undefined;
}

/**
 * Fills a rule's `say` template. `{feature}` → the feature value (integers as integers, else one decimal);
 * `{seconds}` / `{dwellS}` / `{to}` → the action parameter (pass the resolved action when you have it).
 * Unknown or unfillable placeholders stay verbatim.
 */
export function explain(say: string, features: FeatureVector, action: Action): string {
  return say.replace(PLACEHOLDER, (whole, name: string) => {
    const param = actionParam(name, action, features);
    if (param !== undefined) return param;
    if (Object.hasOwn(features, name)) {
      const v = features[name];
      if (typeof v === 'number') return num(v);
    }
    return whole;
  });
}
