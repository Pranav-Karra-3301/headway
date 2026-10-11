// Owner: T4. OpenAI-compatible LLM client (Luminal primary, OpenRouter fallback). Stub until filled.
function ni(what: string): never {
  throw new Error(`not implemented yet: ${what}`);
}

export interface LlmRequest { model: string; system: string; user: string; temperature?: number; maxTokens?: number; json?: boolean; timeoutMs?: number }
export interface LlmResponse { text: string; latencyMs: number; model: string; provider: string }
export interface LlmClient { complete(req: LlmRequest): Promise<LlmResponse> }
export function createOpenAICompatClient(o: { baseUrl: string; apiKey: string; provider: string; headers?: Record<string, string>; fetchImpl?: typeof fetch }): LlmClient { return ni('createOpenAICompatClient ' + o.provider); }
export function withFallback(primary: LlmClient, fallback: LlmClient, fallbackModel: string): LlmClient { return ni('withFallback ' + fallbackModel + String(!!primary && !!fallback)); }
