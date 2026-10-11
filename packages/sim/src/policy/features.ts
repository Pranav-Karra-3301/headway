// Owner: Task P. Feature whitelist per decision kind (spec §6). Stub until filled.
import type { DecisionKind } from '../contracts';

export interface FeatureSpec { min: number; max: number; desc: string }
export const FEATURES = { bus_at_stop: {}, bus_at_terminal: {}, train_at_station: {} } as Record<DecisionKind, Record<string, FeatureSpec>>;
export const PLACEHOLDERS = { bus_at_stop: [], bus_at_terminal: [], train_at_station: [] } as Record<DecisionKind, string[]>;
