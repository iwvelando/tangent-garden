// Writes tests/test-durations.json, each spec file's total test seconds,
// from Playwright JSON reports: the chromium-test-timings artifacts of one
// CI run, all of its shards together. CI packs its Chromium shards by these
// durations (tests/shards.ts), so refresh them when the shards drift apart
// (`make test-durations RUN=<run id>`).
import { readFileSync, writeFileSync } from "node:fs";

const reports = process.argv.slice(2);
if (reports.length === 0) {
  console.error("usage: node scripts/test-durations.mjs <report.json>...");
  process.exit(2);
}
const seconds = {};
// A helper can declare tests for several spec files; the top-level suite
// names the file that actually runs them and belongs in the shard plan.
function walk(suite, file = suite.file) {
  for (const spec of suite.specs ?? [])
    for (const test of spec.tests)
      for (const result of test.results)
        seconds[file] = (seconds[file] ?? 0) + result.duration / 1000;
  for (const child of suite.suites ?? []) walk(child, file);
}
for (const report of reports)
  for (const suite of JSON.parse(readFileSync(report, "utf8")).suites)
    walk(suite);
const files = Object.keys(seconds).sort();
const out = Object.fromEntries(
  files.map((f) => [f, Math.max(1, Math.round(seconds[f]))]),
);
writeFileSync("tests/test-durations.json", JSON.stringify(out, null, 2) + "\n");
console.log(
  `${files.length} files, ${Math.round(Object.values(seconds).reduce((a, b) => a + b, 0))} s`,
);
