#!/usr/bin/env node
// Headway web smoke test. Usage: node scripts/smoke/run.mjs --url <base> [--routes /,/play,/lab] [--api] [--help]
// Exit codes: 0 all checks passed, 1 a check failed, 2 harness error (bad arguments, Chrome missing or not starting).
import { parseArgs, USAGE } from './args.mjs';
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

try {
  const report = await runSmoke({ ...opts, log: (line) => console.error(line) });
  console.log(formatReport(report));
  process.exitCode = report.ok ? 0 : 1;
} catch (e) {
  console.error(`smoke: harness error: ${e.message}`);
  process.exitCode = 2;
}
