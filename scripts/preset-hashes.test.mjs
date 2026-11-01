import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import {
  assertMatchingPresets,
  assertReply,
  childOptions,
  digest,
  parseOptions,
  withRefinement,
} from "./preset-hashes.mjs";

test("comparison requires the same nonempty set of successful presets", () => {
  const row = { name: "2D circle", hash: "same" };
  assert.deepEqual(assertMatchingPresets([row], [row]), []);
  assert.deepEqual(
    assertMatchingPresets([row], [{ ...row, hash: "changed" }]),
    [row.name],
  );
  assert.throws(() => assertMatchingPresets([], []), /No presets/);
  assert.throws(
    () => assertMatchingPresets([row], [{ ...row, name: "other" }]),
    /missing.*2D circle/i,
  );
  assert.throws(
    () => assertMatchingPresets([row], [row, { ...row, name: "extra" }]),
    /extra/i,
  );
  assert.throws(() => assertMatchingPresets([row, row], [row]), /duplicate/i);
  assert.throws(
    () => assertMatchingPresets([{ ...row, error: "refused" }], [row]),
    /refused/i,
  );
});

test("a worker refusal or missing result cannot count as an unchanged drawing", () => {
  assert.doesNotThrow(() => assertReply("circle", { result: { points: [] } }));
  for (const reply of [
    { error: "bad curve" },
    { result: { error: "bad curve" } },
  ])
    assert.throws(() => assertReply("circle", reply), /circle.*bad curve/);
  assert.throws(() => assertReply("circle", { id: 1 }), /circle.*result/);
});

test("digests preserve numeric bits and geometry while ignoring object key order", () => {
  assert.notEqual(digest([0]), digest([-0]));
  assert.notEqual(digest([1]), digest([1 + Number.EPSILON]));
  assert.notEqual(digest([Infinity]), digest([-Infinity]));
  assert.notEqual(digest([1, 2]), digest([2, 1]));
  assert.notEqual(digest([1]), digest([1, null]));
  assert.equal(digest({ x: 1, y: 2 }), digest({ y: 2, x: 1 }));
  assert.equal(digest([1, 2]), digest(new Float64Array([1, 2])));
  const bits = new DataView(new ArrayBuffer(8));
  bits.setBigUint64(0, 0xfff8000000000001n);
  assert.equal(digest([NaN]), digest([bits.getFloat64(0)]));
  assert.match(digest([1]), /^[0-9a-f]{64}$/);
});

test("options reject missing values and nonfinite or fractional run counts", () => {
  assert.equal(parseOptions(["--runs", "3", "--only", "spring"]).runs, 3);
  for (const value of ["Infinity", "NaN", "0", "-1", "1.5"])
    assert.throws(() => parseOptions(["--runs", value]), /runs/);
  assert.throws(() => parseOptions(["--compare"]), /value/);
  assert.throws(() => parseOptions(["--only", "--runs", "2"]), /value/);
  assert.throws(() => parseOptions(["--unknown", "x"]), /Unknown/);
  assert.equal(parseOptions([]).refine, "preset");
  for (const value of ["on", "off"])
    assert.equal(parseOptions(["--refine", value]).refine, value);
  assert.throws(() => parseOptions(["--refine", "yes"]), /refine/);
});

test("refinement can be forced either way without changing the preset", () => {
  const config = { curve: "x", adaptive: false, samples: 9 };
  const on = withRefinement(config, "on");
  assert.deepEqual(on, { ...config, adaptive: true });
  assert.equal(config.adaptive, false);
  assert.equal(withRefinement(on, "off").adaptive, false);
  assert.equal(withRefinement({ curve: "x" }, "off").adaptive, false);
  assert.equal(withRefinement(config, "preset"), config);
});

test("child process options preserve the default unfiltered comparison", () => {
  const defaults = parseOptions([]);
  assert.deepEqual(parseOptions(childOptions("public/", defaults)), {
    ...defaults,
    child: "public/",
  });
  const filtered = parseOptions([
    "--only",
    "spring",
    "--runs",
    "3",
    "--refine",
    "on",
    "--skip",
    "staircase, one net",
  ]);
  assert.equal(filtered.skip, "staircase, one net");
  assert.deepEqual(parseOptions(childOptions("public/", filtered)), {
    ...filtered,
    child: "public/",
  });
});

test("a child's reply reaches its parent whole through a pipe", () => {
  // Far beyond a pipe's buffer, as every preset's results are; macOS writes
  // to a pipe asynchronously, so exiting before the write ends truncates it.
  // The child builds them itself: Linux refuses an argument over 128 KiB.
  const build = `Array.from({ length: 4000 }, (_, i) => ({
    name: "preset " + i,
    hash: "0".repeat(64),
    time: i,
  }))`;
  const results = new Function(`return ${build}`)();
  const out = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { reply } from ${JSON.stringify(import.meta.resolve("./preset-hashes.mjs"))};
       reply(${build});`,
    ],
    { encoding: "utf8", maxBuffer: 1 << 24 },
  );
  assert.deepEqual(JSON.parse(out), results);
});
