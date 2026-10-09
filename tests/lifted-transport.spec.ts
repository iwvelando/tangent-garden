import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import { test, expect } from "@playwright/test";
import { restore, type Place } from "../web/lifted";
import { spatialPresets } from "../web/spatial/presets";

// A spatial or 4D result's large numeric arrays cross from Go as one
// Float64Array beside the JSON (cmd/wasm/lift), and the page puts each back
// where JSON would have put it (web/lifted.ts). Go's tests check, for
// every kind of study, that the arrays put back equal the JSON bit for bit;
// these check the page's half.

const lifted = (floats: number[], places: Place[]) => ({
  floats: new Float64Array(floats),
  places: JSON.stringify(places),
});

test("each kind of array comes back where it was, with its nulls", () => {
  const nan = NaN;
  const result = restore(
    {
      base: null,
      canal: { meridians: null, circles: [{ points: null }, { points: [] }] },
      paths: [{ points: null, family: 2 }],
      probe: { curvature: [null, null] },
      count: 7,
    },
    lifted(
      [
        // base: a point, a gap, a point with −0.
        1,
        2,
        3,
        nan,
        nan,
        nan,
        -0,
        5,
        6,
        // canal.meridians: a row of one point, a null row, an empty row.
        7,
        8,
        9,
        // canal.circles[0].points: two vectors.
        1,
        0,
        0,
        0,
        1,
        0,
        // paths[0].points: a triple; paths[0].fourPoints, left out of the
        // JSON when empty, a quad.
        1,
        2,
        3,
        1,
        2,
        3,
        4,
        // probe.curvature[1]: a number and a missing one; probe.u, numbers.
        0.5,
        nan,
        0.25,
        0.75,
      ],
      [
        { path: ["base"], kind: "point", offset: 0, count: 3 },
        {
          path: ["canal", "meridians"],
          kind: "point",
          offset: 9,
          rows: [1, -1, 0],
        },
        {
          path: ["canal", "circles", 0, "points"],
          kind: "vector",
          offset: 12,
          count: 2,
        },
        { path: ["paths", 0, "points"], kind: "triple", offset: 18, count: 1 },
        {
          path: ["paths", 0, "fourPoints"],
          kind: "quad",
          offset: 21,
          count: 1,
        },
        {
          path: ["probe", "curvature", 1],
          kind: "maybe",
          offset: 25,
          rows: [2],
        },
        { path: ["probe", "u"], kind: "number", offset: 27, count: 2 },
      ],
    ),
  );
  expect(result).toEqual({
    base: [{ x: 1, y: 2, z: 3 }, null, { x: -0, y: 5, z: 6 }],
    canal: {
      meridians: [[{ x: 7, y: 8, z: 9 }], null, []],
      circles: [
        {
          points: [
            { x: 1, y: 0, z: 0 },
            { x: 0, y: 1, z: 0 },
          ],
        },
        { points: [] },
      ],
    },
    paths: [
      {
        points: [[1, 2, 3]],
        family: 2,
        fourPoints: [[1, 2, 3, 4]],
      },
    ],
    probe: { curvature: [null, [[0.5, null]]], u: [0.25, 0.75] },
    count: 7,
  });
  // −0 stays −0, as JSON delivers it.
  expect(Object.is(result.base![2]!.x, -0)).toBe(true);
  // Nothing lifted is nothing changed.
  const plain = { base: [{ x: 1, y: 2, z: 3 }] };
  expect(restore(plain, undefined)).toEqual({ base: [{ x: 1, y: 2, z: 3 }] });
  expect(restore(plain, lifted([], []))).toBe(plain);
});

let spatial: (json: string) => any;
test.beforeAll(async () => {
  runInThisContext(readFileSync("public/wasm_exec.js", "utf8"));
  const go = new (globalThis as any).Go();
  const { instance } = await WebAssembly.instantiate(
    readFileSync("public/engine.wasm"),
    go.importObject,
  );
  void go.run(instance);
  spatial = (globalThis as any).tangentGardenSpatial;
});

test("every preset's lifted arrays come back, leaving the JSON small", () => {
  test.slow();
  const kinds = new Set<string>();
  let floats = 0,
    text = 0;
  for (const p of spatialPresets)
    for (const options of [{}, { surfaceDiagnostics: true }]) {
      const reply = spatial(JSON.stringify({ ...p.config, ...options }));
      // A refusal is JSON alone (a curve without a surface has no probe).
      if (typeof reply === "string") continue;
      const places: Place[] = JSON.parse(reply.lifted.places);
      const result = restore(JSON.parse(reply.json), reply.lifted);
      for (const place of places) {
        kinds.add(place.kind);
        let value: any = result;
        for (const key of place.path) value = value[key];
        expect(Array.isArray(value), `${p.name}: ${place.path}`).toBe(true);
        expect(value.length).toBe(place.rows?.length ?? place.count);
      }
      floats += reply.lifted.floats.length;
      text += reply.json.length;
      // An ellipsoid's surface, its focal sheets and their probe were 7 MB
      // of JSON; what is left is mostly their grids of flags.
      if (p.name === "The whole focal surface of an ellipsoid")
        expect(reply.json.length, p.name).toBeLessThan(1_000_000);
    }
  expect([...kinds].sort()).toEqual(["maybe", "number", "point", "vector"]);
  // Most of what the presets send is now lifted: a float is about 18
  // characters of JSON.
  expect(18 * floats).toBeGreaterThan(4 * text);
});
