// Owner: T1c. Metrics collector, findings, hashing, sentences (spec §5.4, §7, §8.4, §12).
// Public surface (stub-table signatures): createCollector(init) · canonicalHash(x) · findingSentence(f, clockStart) ·
// clockAt(clockStart, t). Helpers in the sibling files stay internal to the package.
export { createCollector } from './collector';
export { canonicalHash } from './hash';
export { clockAt, findingSentence } from './sentences';
