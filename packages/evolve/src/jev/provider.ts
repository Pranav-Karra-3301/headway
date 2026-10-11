// Owner: T6. Jev (TypeSafe System One) via OpenRouter /systemone. Stub until filled.
import type { DecisionProvider } from '@headway/sim';
function ni(what: string): never {
  throw new Error(`not implemented yet: ${what}`);
}

export function createJevProvider(o: { baseUrl: string; apiKey: string; model: string; fetchImpl?: typeof fetch }): DecisionProvider { return ni('createJevProvider ' + o.model); }
export function withCache(p: DecisionProvider): DecisionProvider { return ni('withCache ' + String(!!p)); }
