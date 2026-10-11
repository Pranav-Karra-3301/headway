// Owner: T4. One evolution round (spec §8.1). Stub until filled.
import type { EvolveEvent, Generation, Policy, Proposal, Round, RunResult, SplitScore } from '@headway/sim';
import type { LlmClient } from './llm';
function ni(what: string): never {
  throw new Error(`not implemented yet: ${what}`);
}

export interface EvolveStore {
  champion(): Promise<Generation>;
  history(limit: number): Promise<Proposal[]>;
  nextRoundNumber(): Promise<number>;
  saveRound(r: Round): Promise<void>;
  saveGeneration(g: Generation): Promise<void>;
}
export interface RoundDeps {
  llm: LlmClient; model: string; store: EvolveStore; emit(e: EvolveEvent): void; now(): string;
  evaluate(policy: Policy, split: 'train' | 'val'): Promise<{ score: SplitScore; results: RunResult[] }>;
  temperatures?: [number, number, number];
}
export function runRound(deps: RoundDeps): Promise<{ round: Round; generation: Generation | null }> { return ni('runRound ' + deps.model); }
