// Runs one shard of the native race pass, so CI can spread it across
// runners: `node scripts/go-race.mjs 2/3` runs the second of three shards.
// Go lists every test, example and fuzz target in every package; sorted by
// name, every nth one goes to the same shard, which spreads neighboring
// names (often one family of slow tests) across the shards. A name in two
// packages runs in the same shard for both, so the shards together run
// every test exactly once. `make test-go` runs the whole pass unsharded.
import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function parseShard(spec) {
  const match = /^(\d+)\/(\d+)$/.exec(spec ?? "");
  const [k, n] = match ? [Number(match[1]), Number(match[2])] : [0, 0];
  if (!(n >= 1 && k >= 1 && k <= n))
    throw new Error(`The shard must be k/n with 1 ≤ k ≤ n, not "${spec}"`);
  return [k, n];
}

// `go test -list .` prints each package's names and then its status line.
// Benchmarks are left out: -run never starts them.
export function testNames(listing) {
  const names = listing
    .split("\n")
    .filter((line) => /^(Test|Example|Fuzz)\w*$/.test(line));
  return [...new Set(names)].sort();
}

// An anchored pattern for the kth of n shards; ^$ matches no test.
export function shardPattern(names, k, n) {
  const mine = names.filter((_, i) => i % n === k - 1);
  return mine.length ? `^(${mine.join("|")})$` : "^$";
}

function main() {
  const [k, n] = parseShard(process.argv[2]);
  // Listing builds the race-instrumented test binaries the run then reuses.
  const listing = execFileSync("go", ["test", "-race", "-list", ".", "./..."], {
    encoding: "utf8",
    maxBuffer: 1 << 24,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const names = testNames(listing);
  if (!names.length) throw new Error("go test -list found no tests");
  console.log(
    `Race shard ${k}/${n}: ${Math.ceil((names.length - k + 1) / n)} of ${names.length} names`,
  );
  const run = spawnSync(
    "go",
    [
      "test",
      "-race",
      "-timeout",
      "20m",
      "-run",
      shardPattern(names, k, n),
      "./...",
    ],
    { stdio: "inherit" },
  );
  process.exitCode = run.status ?? 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
