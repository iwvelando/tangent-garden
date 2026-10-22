// Writes tests/test-durations.json, each spec file's test seconds, from
// Playwright JSON reports: the chromium-test-timings artifacts of CI runs.
// Each argument is one run, either a directory holding its shards' reports
// or a single report. Within a run a file's tests are summed; across runs
// each file takes the mean of the runs that recorded it, since one runner
// can run the same files half again as long as another. CI packs its
// Chromium shards by these durations (tests/shards.ts), so refresh them when
// the shards drift apart (`make test-durations RUN="<run id>..."`).
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const runs = process.argv.slice(2);
if (runs.length === 0) {
  console.error(
    "usage: node scripts/test-durations.mjs <run dir | report.json>...",
  );
  process.exit(2);
}
// A run's reports: the argument itself, or every .json file beneath it.
function reports(path) {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { recursive: true })
    .filter((name) => name.endsWith(".json"))
    .map((name) => join(path, name));
}
// A helper can declare tests for several spec files; the top-level suite
// names the file that actually runs them and belongs in the shard plan.
function walk(suite, seconds, file = suite.file) {
  for (const spec of suite.specs ?? [])
    for (const test of spec.tests)
      for (const result of test.results)
        seconds[file] = (seconds[file] ?? 0) + result.duration / 1000;
  for (const child of suite.suites ?? []) walk(child, seconds, file);
}
const total = {};
const recorded = {};
for (const run of runs) {
  const seconds = {};
  for (const report of reports(run))
    for (const suite of JSON.parse(readFileSync(report, "utf8")).suites)
      walk(suite, seconds);
  for (const [file, s] of Object.entries(seconds)) {
    total[file] = (total[file] ?? 0) + s;
    recorded[file] = (recorded[file] ?? 0) + 1;
  }
}
const files = Object.keys(total).sort();
const mean = Object.fromEntries(files.map((f) => [f, total[f] / recorded[f]]));
const out = Object.fromEntries(
  files.map((f) => [f, Math.max(1, Math.round(mean[f]))]),
);
writeFileSync("tests/test-durations.json", JSON.stringify(out, null, 2) + "\n");
console.log(
  `${files.length} files from ${runs.length} ${runs.length === 1 ? "run" : "runs"}, ${Math.round(Object.values(mean).reduce((a, b) => a + b, 0))} s`,
);
