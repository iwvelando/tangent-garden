import { test } from "@playwright/test";
import assert from "node:assert/strict";
import {
  heldProbe,
  probeMotions,
  defaultProbe,
  type Probe,
} from "../web/spatial/probe";
import type { SpatialResult } from "../web/spatial/types";
import { spatialPresets } from "../web/spatial/presets";

// Where the probe stands in each frame of a parameter animation: the rules
// that choose its sample, on diagnostics shaped like Go's. The notebook's
// own playback is covered in spatial-probe-tracks.spec.ts.

// A curve result over [min, max] with n + 1 samples, whose arc length at
// sample i is length(i), or null where the curve is not drawn.
function curve(
  min: number,
  max: number,
  n: number,
  length: (i: number) => number | null = (i) => i,
): SpatialResult {
  const series = Array.from({ length: n + 1 }, (_, i) => length(i));
  return {
    diagnostics: {
      min,
      max,
      curvature: series.map(() => 1),
      torsion: series.map(() => 0),
      tangent: series.map(() => null),
      normal: series.map(() => null),
      binormal: series.map(() => null),
      center: series.map(() => null),
      length: series,
      flat: 0,
      unknown: 0,
      clipped: 0,
    },
  } as unknown as SpatialResult;
}
const at = (position: number): Probe => ({
  ...defaultProbe,
  enabled: true,
  position,
});

test("a probe that stays keeps its t as the domain moves", () => {
  // The user's sample 3 of 10 on [0, 1] is t = 0.3.
  const start = curve(0, 1, 10);
  const held = (frame: SpatialResult) =>
    heldProbe(start, at(0.3), "curve", "stays", frame, 0.5);
  // The same domain with more samples: t = 0.3 is sample 6 of 20.
  assert.equal(held(curve(0, 1, 20)), 6);
  // A domain twice as long: t = 0.3 is sample 3 of 20.
  assert.equal(held(curve(0, 2, 20)), 3);
  // Exactly at the start of the domain.
  assert.equal(held(curve(0.3, 1.3, 10)), 0);
  // And at its end.
  assert.equal(held(curve(-0.7, 0.3, 10)), 10);
  // Nearest sample, not the floor: t = 0.3 is 2.7 steps into [0.03, 1.03].
  assert.equal(held(curve(0.03, 1.03, 10)), 3);
  // Outside the domain, it has no sample, and says why.
  const away = held(curve(0.5, 1.5, 10));
  assert.equal(typeof away, "string");
  assert.match(away as string, /t = 0\.3 lies outside/);
  assert.equal(typeof held(curve(-1.5, 0.2, 10)), "string");
  // Within half a step of the end it rounds onto it.
  assert.equal(held(curve(-0.72, 0.28, 20)), 20);
});

test("a probe that keeps its share of the length finds it on each frame", () => {
  // Sample 3 of 10, where the length is 3 of 10: three tenths along.
  const start = curve(0, 1, 10);
  const held = (frame: SpatialResult) =>
    heldProbe(start, at(0.3), "curve", "length", frame, 0.9);
  // Length i² over 10 samples: three tenths of 100 is nearest 25 (i = 5).
  assert.equal(held(curve(0, 1, 10, (i) => i * i)), 5);
  // Uniform length over another domain: sample 6 of 20.
  assert.equal(held(curve(-4, 9, 20)), 6);
  // Undrawn samples are passed over; the nearest drawn one is chosen.
  assert.equal(
    held(curve(0, 1, 10, (i) => (i === 3 || i === 4 ? null : i))),
    2,
  );
  // On a tie, the first: 3 lies halfway between 2 and 4.
  assert.equal(held(curve(0, 1, 10, (i) => (i === 3 ? null : i))), 2);
  // The share is of the length, not of the samples: on a start whose
  // length is i², sample 3 is 9/100 of the way along, which is 1.8 of 20
  // uniform steps.
  assert.equal(
    heldProbe(
      curve(0, 1, 10, (i) => i * i),
      at(0.3),
      "curve",
      "length",
      curve(0, 1, 20),
      0,
    ),
    2,
  );
  // An undrawn sample is never chosen, even where its place would match:
  // at the start of the length, the first drawn sample.
  assert.equal(
    heldProbe(
      start,
      at(0),
      "curve",
      "length",
      curve(0, 1, 10, (i) => (i === 0 ? null : i - 1)),
      0,
    ),
    1,
  );
  // A frame with no length to share has no sample, and says so.
  assert.equal(typeof held(curve(0, 1, 10, () => 0)), "string");
  assert.equal(typeof held(curve(0, 1, 10, () => null)), "string");
  // A start whose own sample is not drawn has no share to keep.
  const undrawn = curve(0, 1, 10, (i) => (i === 3 ? null : i));
  assert.equal(
    typeof heldProbe(undrawn, at(0.3), "curve", "length", curve(0, 1, 10), 0),
    "string",
  );
});

test("a probe that moves goes along the frame's own samples", () => {
  const start = curve(0, 1, 10);
  const along = (frame: SpatialResult, p: number) =>
    heldProbe(start, at(0.3), "curve", "along", frame, p);
  assert.equal(along(curve(0, 1, 960), 0), 0);
  assert.equal(along(curve(0, 1, 960), 0.25), 240);
  assert.equal(along(curve(5, 7, 960), 1), 960);
  // 0.001 of 960 samples is 0.96 of a step: the nearest sample is 1.
  assert.equal(along(curve(0, 1, 960), 0.001), 1);
});

test("a probe on a grid stays at its row and column, or moves along the rows", () => {
  const grid = (rows: number) =>
    ({
      surfaceDiagnostics: {
        kind: "surface",
        u: Array.from({ length: rows + 1 }, (_, i) => i),
        v: Array.from({ length: 9 }, (_, i) => i),
      },
    }) as unknown as SpatialResult;
  const probe = { ...at(0.25), target: "surface" as const, across: 0.5 };
  assert.equal(
    heldProbe(grid(8), probe, "surface", "stays", grid(40), 0.9),
    10,
  );
  assert.equal(
    heldProbe(grid(8), probe, "surface", "along", grid(40), 0.9),
    36,
  );
  // Without the surface's diagnostics there is nothing to stand on.
  assert.equal(
    typeof heldProbe(grid(8), probe, "surface", "stays", curve(0, 1, 10), 0),
    "string",
  );
});

test("the choices name what the probe holds, and a grid has no length", () => {
  const helix = spatialPresets.find(
    (p) => p.name === "Helix · a ribbon staircase",
  )!.config;
  assert.deepEqual(
    probeMotions(helix, "curve").map((m) => m.value),
    ["stays", "length", "along"],
  );
  assert.deepEqual(
    probeMotions(helix, "curve").map((m) => m.label),
    [
      "Stays at its t",
      "Keeps its share of the length",
      "Moves along the curve",
    ],
  );
  const patch = spatialPresets.find(
    (p) => p.config.format === "surface",
  )!.config;
  assert.deepEqual(
    probeMotions(patch, "surface").map((m) => m.value),
    ["stays", "along"],
  );
});
