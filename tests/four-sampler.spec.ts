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
  // A single tesseract section passes 2.5% beyond the circumradius 2; a
  // family's middle passes half its spread further, so its nearest section
  // is as far out and every section is empty at both ends.
  const single: Config = { ...base, object: "tesseract", count: 1 };
  assert.equal(extent(single), 2.05);
  assert.equal(sampler(single, "slice", 0).slice, -2.05);
  assert.equal(sampler(single, "slice", 1).slice, 2.05);
  for (const [count, spread] of [
    [5, 0.8],
    [17, 4],
    [25, 0],
  ]) {
    const family: Config = { ...base, object: "tesseract", count, spread };
    assert.equal(extent(family), 2.05 + spread / 2);
    for (const end of [0, 1]) {
      const h = sampler(family, "slice", end).slice;
      for (let i = 0; i < count; i++) {
        const level = h + spread * (i / (count - 1) - 0.5);
        assert.ok(Math.abs(level) >= 2.05 - 1e-12, `section ${i} at ${end}`);
      }
    }
  }
  const cube: Config = { ...base, object: "tesseract" };
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

test("bypass sampler preserves the study and clamps synchronized forward/reverse route position", () => {
  const base = objects.bypass.defaults({} as Config),
    before = structuredClone(base);
  for (const mode of ["shadow", "diagram", "paired"] as const)
    for (const p of [-1, 0, 1 / 3, 0.5, 2 / 3, 1, 2]) {
      const clamped = Math.max(0, Math.min(1, p));
      for (const motion of ["route", "return"] as const) {
        const q = sampler({ ...base, mode }, motion, p);
        assert.equal(
          q.bypass!.position,
          motion === "route" ? clamped : 1 - clamped,
        );
        assert.equal(q.bypass!.height, 1.2);
        assert.deepEqual(base, before);
      }
    }
});
