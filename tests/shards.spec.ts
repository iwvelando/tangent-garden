import { test, expect } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { packShards, shardFiles, specFiles } from "./shards";

// CI's Chromium shards are packed by each spec file's recorded duration
// (tests/test-durations.json), not by test count: every spec file runs in
// exactly one shard whatever is recorded, and the recorded files balance.

const durations: Record<string, number> = JSON.parse(
  readFileSync("tests/test-durations.json", "utf8"),
);
const webkitOnly = /webkit\.spec\.ts$/;

test("every Chromium spec file runs in exactly one shard", () => {
  const all = readdirSync("tests")
    .filter((f) => f.endsWith(".spec.ts") && !webkitOnly.test(f))
    .sort();
  expect(specFiles(webkitOnly)).toEqual(all);
  for (const total of [1, 2, 6, 8]) {
    const shards = Array.from({ length: total }, (_, i) =>
      shardFiles(`${i + 1}/${total}`, webkitOnly),
    );
    for (const shard of shards) expect(shard.length).toBeGreaterThan(0);
    expect(shards.flat().sort()).toEqual(all);
  }
});

test("a file with no recorded duration is placed, at the average", () => {
  const shards = packShards(
    ["a.spec.ts", "b.spec.ts", "c.spec.ts", "new.spec.ts"],
    { "a.spec.ts": 20, "b.spec.ts": 10, "c.spec.ts": 10, "gone.spec.ts": 500 },
    2,
  );
  // The new file counts as 13⅓, the average of the three still on disk:
  // a (20) first, then the new file, then b with it and c with a.
  expect(shards).toEqual([
    ["a.spec.ts", "c.spec.ts"],
    ["b.spec.ts", "new.spec.ts"],
  ]);
});

test("packing is the same every time, whatever order files are listed in", () => {
  const files = specFiles(webkitOnly);
  const once = packShards(files, durations, 6);
  expect(packShards([...files].reverse(), durations, 6)).toEqual(once);
});

// Only recorded files are packed here: a new file has no duration to
// balance, and the packer would place it at the average while the loads
// counted it as nothing, judging a packing the shards don't run. A new
// file is recorded by refreshing the durations (AGENTS.md).
test("the recorded durations pack into shards of about equal length", () => {
  const files = specFiles(webkitOnly).filter((f) => f in durations);
  const total = files.reduce((s, f) => s + durations[f], 0);
  for (const n of [6, 8]) {
    const loads = packShards(files, durations, n).map((shard) =>
      shard.reduce((s, f) => s + durations[f], 0),
    );
    expect(Math.max(...loads)).toBeLessThanOrEqual((1.05 * total) / n);
  }
});

test("a malformed shard is refused", () => {
  for (const shard of ["", "3", "0/6", "7/6", "2/0", "a/b", "1.5/6"])
    expect(() => shardFiles(shard, webkitOnly)).toThrow(/TEST_SHARD/);
});
