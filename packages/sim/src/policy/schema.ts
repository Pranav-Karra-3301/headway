// Owner: Task P. zod schema + semantic validation (spec §6). Stub until filled.
import { z } from 'zod';
import type { Action, DecisionKind, Policy } from '../contracts';
function ni(what: string): never {
  throw new Error(`not implemented yet: ${what}`);
}

export const PolicySchema = z.custom<Policy>(() => ni('PolicySchema'));
export type ValidationResult = { ok: true; policy: Policy } | { ok: false; errors: string[] };
export function validatePolicy(input: unknown): ValidationResult { return ni('validatePolicy ' + typeof input); }
export function legalActionTypes(kind: DecisionKind): Action['type'][] { return ni('legalActionTypes ' + kind); }
export const POLICY_DSL_DOC = '';
