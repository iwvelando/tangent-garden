import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// CI's Chromium shards, packed by each spec file's recorded duration.
// Playwright's own --shard splits the alphabetical list of tests into
// blocks of equal count, so a run of heavy files (the every-preset sweeps,
// the spatial studies) makes one shard far slower than the rest. Here each
// spec file goes, longest first, to the shard with the least time so far.
// Every spec file on disk is placed, so a new file is never left out; one
// with no recorded duration counts as the average. Refresh the durations
// with `make test-durations RUN=<run id>` when shards drift apart.

const here = dirname(fileURLToPath(import.meta.url));

// The spec files in tests/ that the Chromium project runs, sorted.
export function specFiles(ignore: RegExp): string[] {
  return readdirSync(here)
    .filter((f) => f.endsWith(".spec.ts") && !ignore.test(f))
    .sort();
}

// The files split into `total` shards of about equal recorded time.
export function packShards(
  files: string[],
  durations: Record<string, number>,
  total: number,
): string[][] {
  const known = files.filter((f) => durations[f] !== undefined);
  const average = known.length
    ? known.reduce((s, f) => s + durations[f], 0) / known.length
    : 1;
  const time = (f: string) => durations[f] ?? average;
  const order = [...files].sort(
    (a, b) => time(b) - time(a) || (a < b ? -1 : a > b ? 1 : 0),
  );
  const shards = Array.from({ length: total }, () => ({
    load: 0,
    files: [] as string[],
  }));
  for (const f of order) {
    // The least loaded shard, the first of equals.
    const shard = shards.reduce((best, s) => (s.load < best.load ? s : best));
    shard.load += time(f);
    shard.files.push(f);
  }
  return shards.map((s) => s.files.sort());
}

// The files of one shard, given as "current/total" (TEST_SHARD).
export function shardFiles(shard: string, ignore: RegExp): string[] {
  const m = /^([1-9]\d*)\/([1-9]\d*)$/.exec(shard);
  if (!m || Number(m[1]) > Number(m[2]))
    throw new Error(
      `TEST_SHARD must be "current/total", such as 2/6, not "${shard}".`,
    );
  const path = join(here, "test-durations.json");
  const durations = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : {};
  return packShards(specFiles(ignore), durations, Number(m[2]))[
    Number(m[1]) - 1
  ];
}
