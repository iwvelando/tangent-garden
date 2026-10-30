import assert from "node:assert/strict";
import { test } from "node:test";
import { parseShard, shardPattern, testNames } from "./go-race.mjs";

const listing = `TestB
TestA
ExampleParse
FuzzExpr
BenchmarkMesh
ok  	tangentgarden/engine	0.4s
TestA
TestC_underscore
?   	tangentgarden/cmd/wasm	[no test files]
ok  	tangentgarden/engine3	0.3s
`;

test("every test, example and fuzz target is listed once, in a fixed order", () => {
  assert.deepEqual(testNames(listing), [
    "ExampleParse",
    "FuzzExpr",
    "TestA",
    "TestB",
    "TestC_underscore",
  ]);
});

test("the shards together run every name exactly once", () => {
  const names = testNames(listing);
  for (const n of [1, 2, 3, 7]) {
    const runs = names.map((name) =>
      Array.from({ length: n }, (_, k) => k + 1).filter((k) =>
        new RegExp(shardPattern(names, k, n)).test(name),
      ),
    );
    assert.ok(
      runs.every((shards) => shards.length === 1),
      `${n} shards`,
    );
  }
  // Anchored, so TestA does not also run TestAB.
  assert.equal(new RegExp(shardPattern(["TestA"], 1, 1)).test("TestAB"), false);
  // A shard left with no names runs nothing rather than everything.
  assert.equal(new RegExp(shardPattern(["TestA"], 2, 2)).test("TestA"), false);
});

test("a shard is k/n with 1 ≤ k ≤ n", () => {
  assert.deepEqual(parseShard("2/3"), [2, 3]);
  for (const bad of ["", "3", "0/3", "4/3", "1/0", "a/b", "1.5/3"])
    assert.throws(() => parseShard(bad), /k\/n/);
});
