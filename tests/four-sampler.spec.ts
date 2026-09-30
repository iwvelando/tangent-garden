import { test } from "@playwright/test";
import assert from "node:assert/strict";
import {
  sample as sampler,
  passageExtent as extent,
  type Config,
} from "../web/tesseract/types";
import { objects } from "../web/tesseract/objects";
test("4D sampler preserves definitions and exact support-relative endpoints", () => {
  const base: Config = {
    object: "ball",
    radius: 2,
    tube: 0.6,
    curves: 5,
    mode: "section",
    angles: [0, 0, 0, 0, 0, 0],
    slice: 0.1,
    spread: 0.8,
    count: 5,
    grid: 0,
    samples: 64,
    clip: 4,
    distance: 4,
  };
  for (const object of ["ball", "tube"] as const)
    for (const radius of [0.002, 2, 100])
      for (const count of [1, 25]) {
        const support = object === "ball" ? radius : radius * 0.5;
        const q: Config = {
          ...structuredClone(base),
          object,
          radius,
          tube: radius * 0.5,
          count,
          spread: 4 * support,
        };
        const original = structuredClone(q);
        const expected = 1.025 * support + (count > 1 ? q.spread / 2 : 0);
        assert.equal(extent(q), expected);
        for (const [progress, clamped] of [
          [-0.1, 0],
          [0, 0],
          [0.25, 0.25],
          [0.5, 0.5],
          [1, 1],
          [1.1, 1],
        ]) {
          const sampled = sampler(q, "slice", progress);
          assert.equal(sampled.slice, expected * (2 * clamped - 1));
          assert.equal(sampled.radius, q.radius);
          assert.equal(sampled.tube, q.tube);
          assert.deepEqual(sampled.angles, q.angles);
          assert.deepEqual(q, original);
        }
        assert.deepEqual(sampler(q, "double", 0.5), q);
        assert.deepEqual(sampler(q, "xw", 0.5), q);
      }
  const cube: Config = { ...base, object: "tesseract" };
  assert.equal(extent(cube), 2.05);
  assert.equal(sampler(cube, "slice", 0).slice, -2.05);
  assert.equal(sampler(cube, "slice", 1).slice, 2.05);
  assert.equal(sampler(cube, "double", 0.5).angles[2], Math.PI);
  assert.equal(sampler(cube, "double", 0.5).angles[3], Math.PI);
  assert.equal(sampler(cube, "xw", 0.5).angles[2], 0);
});
test("localized lift sampler shares immutable linked views and exact entered endpoints", () => {
  const base = objects.lift.defaults(objects.tesseract.defaults({} as Config));
  base.lift!.from = [3, -2, 1];
  base.lift!.to = [-4, 5, -6];
  base.lift!.radiusFrom = 4;
  base.lift!.radiusTo = 0.05;
  const original = structuredClone(base);
  for (const mode of ["reference", "lifted"] as const)
    for (const p of [0, 0.25, 0.5, 1]) {
      const q = { ...base, mode };
      const drift = sampler(q, "drift", p),
        support = sampler(q, "support", p);
      assert.deepEqual(drift.lift!.center, [
        3 * (1 - p) - 4 * p,
        -2 * (1 - p) + 5 * p,
        1 * (1 - p) - 6 * p,
      ]);
      assert.equal(support.lift!.support, 4 * (1 - p) + 0.05 * p);
      assert.equal(drift.lift!.height, 0.32);
      assert.equal(support.lift!.height, 0.32);
      assert.deepEqual(base, original);
    }
  assert.deepEqual(sampler(base, "drift", -1).lift!.center, base.lift!.from);
  assert.deepEqual(sampler(base, "drift", 2).lift!.center, base.lift!.to);
});
