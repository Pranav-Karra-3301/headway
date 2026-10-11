// Owner: Task M. SimConfig defaults (spec §5.3). Stub until filled.
import type { SimConfig } from './contracts';

export const DEFAULT_CONFIG = {} as SimConfig;
export function withConfig(p?: Partial<SimConfig>): SimConfig { return { ...DEFAULT_CONFIG, ...p } as SimConfig; }
