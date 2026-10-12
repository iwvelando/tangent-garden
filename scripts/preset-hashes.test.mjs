import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertMatchingPresets,
  assertReply,
  childOptions,
  digest,
  parseOptions,
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
});

test("child process options preserve the default unfiltered comparison", () => {
  const defaults = parseOptions([]);
  assert.deepEqual(parseOptions(childOptions("public/", defaults)), {
    ...defaults,
    child: "public/",
  });
  const filtered = parseOptions(["--only", "spring", "--runs", "3"]);
  assert.deepEqual(parseOptions(childOptions("public/", filtered)), {
    ...filtered,
    child: "public/",
  });
});
