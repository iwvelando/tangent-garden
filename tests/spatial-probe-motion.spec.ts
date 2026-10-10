import { test } from "@playwright/test";
import assert from "node:assert/strict";
import {
  columnShare,
  heldProbe,
  surfaceProbeAt,
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

// A grid whose rows are at u = uMin + i·(uMax − uMin)/rows and whose
// columns are at v = vMin + k·(vMax − vMin)/columns, or around a full turn
// when periodic, as Go lays out a canal's contact circle.
function surface(
  uMin: number,
  uMax: number,
  rows: number,
  vMin: number,
  vMax: number,
  columns: number,
  periodic = false,
): SpatialResult {
  return {
    surfaceDiagnostics: {
      kind: periodic ? "canal" : "patch",
      periodic,
      u: Array.from(
        { length: rows + 1 },
        (_, i) => uMin + ((uMax - uMin) * i) / rows,
      ),
      v: periodic
        ? Array.from({ length: columns }, (_, k) => (2 * Math.PI * k) / columns)
        : Array.from(
            { length: columns + 1 },
            (_, k) => vMin + ((vMax - vMin) * k) / columns,
          ),
    },
  } as unknown as SpatialResult;
}

test("a probe on a grid can stay at its own u and v as the domain moves", () => {
  // The user's row 3 of 10 and column 6 of 8 on [0, 1] × [0, 4] are
  // u = 0.3 and v = 3.
  const probe = { ...at(0.3), target: "surface" as const, across: 0.75 };
  const start = surface(0, 1, 10, 0, 4, 8);
  const held = (frame: SpatialResult) =>
    heldProbe(start, probe, "surface", "point", frame, 0.5);
  // The same domain: the same row and column.
  assert.deepEqual(held(surface(0, 1, 10, 0, 4, 8)), { row: 3, column: 6 });
  // A domain twice as long each way: u = 0.3 is row 3 of 20, v = 3 is
  // column 6 of 16, where staying at its share would take row 6, column 12.
  assert.deepEqual(held(surface(0, 2, 20, 0, 8, 16)), { row: 3, column: 6 });
  assert.equal(
    heldProbe(start, probe, "surface", "stays", surface(0, 2, 20, 0, 8, 16), 0),
    6,
  );
  // Nearest sample, not the floor: u = 0.3 is 2.7 steps into [0.03, 1.03].
  assert.deepEqual(held(surface(0.03, 1.03, 10, 0, 4, 8)), {
    row: 3,
    column: 6,
  });
  // A reversed domain counts its rows from its own start.
  assert.deepEqual(held(surface(1, 0, 10, 4, 0, 8)), { row: 7, column: 2 });
  // Within half a step of an end it rounds onto it.
  assert.deepEqual(held(surface(-0.72, 0.28, 20, 0, 4, 8)), {
    row: 20,
    column: 6,
  });
  // Outside the domain along either parameter it has no point, and says
  // which parameter left it out.
  const outU = held(surface(0.5, 1.5, 10, 0, 4, 8));
  assert.equal(outU, "u = 0.3 lies outside this frame's domain, [0.5, 1.5].");
  const outV = held(surface(0, 1, 10, 3.5, 6, 8));
  assert.equal(outV, "v = 3 lies outside this frame's domain, [3.5, 6].");
  // A canal's turn around its contact circle wraps: the last column is
  // nearer the first than the one before it.
  const canal = { ...probe, target: "surface" as const, across: 23 / 24 };
  const ring = surface(0, 1, 10, 0, 0, 24, true);
  assert.deepEqual(
    heldProbe(
      ring,
      canal,
      "surface",
      "point",
      surface(0, 2, 20, 0, 0, 24, true),
      0,
    ),
    { row: 3, column: 23 },
  );
  assert.deepEqual(
    heldProbe(
      surface(0, 1, 10, 0, 0, 96, true),
      { ...canal, across: 95 / 96 },
      "surface",
      "point",
      ring,
      0,
    ),
    { row: 3, column: 0 },
  );
  // Without the surface's diagnostics there is nothing to stand on.
  assert.equal(typeof held(curve(0, 1, 10)), "string");
  // The frame draws its column as the share across that picks it, on an
  // open grid and around a contact circle alike.
  for (const grid of [surface(0, 1, 10, 0, 4, 8), ring])
    for (const column of [0, 1, 5, grid.surfaceDiagnostics!.v.length - 1])
      assert.equal(
        surfaceProbeAt(
          grid.surfaceDiagnostics!,
          0,
          columnShare(grid.surfaceDiagnostics!, column),
        ).column,
        column,
      );
});

test("the curve probe holding its point stays at its t", () => {
  const start = curve(0, 1, 10);
  assert.equal(
    heldProbe(start, at(0.3), "curve", "point", curve(0, 2, 20), 0.5),
    3,
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
  assert.deepEqual(probeMotions(patch, "surface"), [
    { value: "stays", label: "Stays at its row and column" },
    { value: "point", label: "Stays at its u and v" },
    { value: "along", label: "Moves along the surface" },
  ]);
  const canal = spatialPresets.find(
    (p) => p.config.construction === "canal",
  )!.config;
  assert.equal(
    probeMotions(canal, "surface")[1].label,
    "Stays at its t and θ − θ₀",
  );
});
