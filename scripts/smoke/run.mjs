#!/usr/bin/env node
// Headway web smoke test. Usage: node scripts/smoke/run.mjs --url <base> [--routes /,/play,/lab] [--api] [--help]
// Exit codes: 0 all checks passed, 1 a check failed, 2 harness error (bad arguments, Chrome missing or not starting).
import { execFileSync } from 'node:child_process';
import { parseArgs, REPO_ROOT, USAGE } from './args.mjs';
import { formatReport, runSmoke } from './smoke.mjs';

let opts;
try {
  opts = parseArgs(process.argv.slice(2));
} catch (e) {
  console.error(`smoke: ${e.message}\n\n${USAGE}`);
  process.exit(2);
}
if (opts.help) {
  console.log(USAGE);
  process.exit(0);
}

// process.exit runs the launcher's 'exit' hook, which kills Chrome.
for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => process.exit(130));

/** Node's RunResult.hash for the run the browser repeats in window.__headway.hash() (g0, stadium_exit, seed 4001). */
function nodeHash() {
  const out = execFileSync('pnpm', ['-s', 'sim:run', '--policy', 'g0', '--scenario', 'stadium_exit', '--seed', '4001', '--json'],
    { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  const hash = JSON.parse(out).hash;
  if (typeof hash !== 'string' || !hash) throw new Error('pnpm sim:run --json printed no hash');
  return hash;
}

try {
  let expectHash = null;
  if (opts.hash) {
    try { expectHash = nodeHash(); } catch (e) { throw new Error(`--hash: could not compute the Node hash: ${e.message}`); }
    console.error(`smoke: Node hash (g0, stadium_exit 4001) = ${expectHash}`);
  }
  const report = await runSmoke({ ...opts, expectHash, log: (line) => console.error(line) });
  console.log(formatReport(report));
  process.exitCode = report.ok ? 0 : 1;
} catch (e) {
  console.error(`smoke: harness error: ${e.message}`);
  process.exitCode = 2;
}
