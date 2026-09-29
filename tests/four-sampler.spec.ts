import { test } from "@playwright/test";
import assert from "node:assert/strict";
import {
  sample as sampler,
  passageExtent as extent,
  type Config,
} from "../web/tesseract/types";
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
