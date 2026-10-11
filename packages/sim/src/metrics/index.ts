// Owner: T1c. Metrics collector, findings, hashing, sentences (spec §7, §8.4). Stub until filled.
import type { FailureFinding } from '../contracts';
import type { Collector, CollectorInit } from '../internal';
function ni(what: string): never {
  throw new Error(`not implemented yet: ${what}`);
}

export function createCollector(init: CollectorInit): Collector { return ni('createCollector ' + init.scenario.id); }
export function canonicalHash(x: unknown): string { return ni('canonicalHash ' + typeof x); }
export function findingSentence(f: FailureFinding, clockStart: string): string { return ni(`findingSentence ${f.kind} ${clockStart}`); }
export function clockAt(clockStart: string, t: number): string { return ni(`clockAt ${clockStart} ${t}`); }
