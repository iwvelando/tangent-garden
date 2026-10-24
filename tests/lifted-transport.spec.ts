import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import { test, expect } from "@playwright/test";
import { restore, type Place } from "../web/lifted";
import { choosePreset } from "./helpers";
import { digest } from "../scripts/preset-hashes.mjs";
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
      study: { base: null, rays: null },
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
        // study.base: a 2D point and a gap; study.rays: a 2D vector.
        1.5,
        -2.5,
        nan,
        nan,
        3,
        4,
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
        { path: ["study", "base"], kind: "point2", offset: 29, count: 2 },
        { path: ["study", "rays"], kind: "vector2", offset: 33, count: 1 },
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
    study: { base: [{ x: 1.5, y: -2.5 }, null], rays: [{ x: 3, y: 4 }] },
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
      // of JSON; geometry and topology now both travel typed.
      if (p.name === "The whole focal surface of an ellipsoid")
        expect(reply.json.length, p.name).toBeLessThan(1_000_000);
    }
  expect([...kinds].sort()).toEqual([
    "flags",
    "maybe",
    "number",
    "point",
    "point2",
    "ray",
    "vector",
  ]);
  // Most of what the presets send is now lifted: a float is about 18
  // characters of JSON.
  expect(18 * floats).toBeGreaterThan(4 * text);
});

test("ray records restore every coordinate, index and optical flag", () => {
  const records = Array.from({ length: 4 }, (_, i) => [
    i * 3,
    240 - i,
    0.125,
    -2.75,
    1e-200,
    -3.125,
    1e100,
    -0,
    7.5,
    -8.25,
    9.125,
    -10.5,
    11.25,
    -12.125,
    i & 1,
    (i >> 1) & 1,
  ]);
  const result = restore(
    { rays: {} },
    lifted(
      [99, ...records.flat(), 123],
      [
        {
          path: ["rays", "lines"],
          kind: "ray",
          offset: 1,
          rows: [1, -1, 0, 3],
        },
        { path: ["rays", "after"], kind: "number", offset: 65, count: 1 },
      ],
    ),
  );
  const expected = records.map((r) => ({
    i: r[0],
    j: r[1],
    start: { x: 0.125, y: -2.75, z: 1e-200 },
    point: { x: -3.125, y: 1e100, z: -0 },
    end: { x: 7.5, y: -8.25, z: 9.125 },
    back: { x: -10.5, y: 11.25, z: -12.125 },
    virtual: r[14] === 1,
    total: r[15] === 1,
  }));
  expect(result).toEqual({
    rays: { lines: [[expected[0]], null, [], expected.slice(1)], after: [123] },
  });
  expect(Object.is((result.rays as any).lines[3][2].point.z, -0)).toBe(true);
});

// Captured from untouched main, before ray lifting. These hash every
// coordinate, index and optical flag, including each number's exact bits.
for (const [name, count, hash] of [
  [
    "Riding a ray through coma",
    81,
    "d1a34e3a9d1e3c7221fec6661077d09a267a759b1031f1d3bc0be2f3f1edc83e",
  ],
  [
    "A spherical bowl's cusped caustic",
    132,
    "32eff938eddd76d9f738c3f1286a4dc9811bfc0840a991e842aec313c334c7c8",
  ],
  [
    "A glass dome's ring of light",
    72,
    "86e21312ae0f54e3ac1331ed347ba9ee6cf5743d4759b261519c960ad3981850",
  ],
] as const)
  test(`typed ray reply preserves ${name}`, () => {
    const config = spatialPresets.find((p) => p.name === name)!.config;
    const reply = spatial(JSON.stringify(config));
    expect(typeof reply).toBe("object");
    const places: Place[] = JSON.parse(reply.lifted.places);
    expect(places.find((p) => p.path.join(".") === "rays.lines")?.kind).toBe(
      "ray",
    );
    const result = restore(JSON.parse(reply.json), reply.lifted);
    expect(result.rays.lines).toHaveLength(count);
    expect(digest(result.rays.lines)).toBe(hash);
  });

test("editing the ray family transfers 2304 typed rays through the browser worker", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).rayReplies = [];
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          if (data.lifted)
            (window as any).rayReplies.push(JSON.parse(data.lifted.places));
        });
      }
    };
  });
  await page.goto("/?study=3d");
  const stage = page.locator(".spatial-stage");
  await expect(stage).toHaveAttribute("aria-busy", "false");
  await choosePreset(page, { label: "Riding a ray through coma" });
  await expect(stage).toHaveAttribute("aria-busy", "false");
  await page.getByText("Sampling & definition", { exact: true }).click();
  await page
    .getByRole("spinbutton", { name: "Parameter curves", exact: true })
    .fill("48");
  await expect
    .poll(
      async () =>
        JSON.parse((await stage.getAttribute("data-config"))!).surface.curves,
    )
    .toBe(48);
  await expect(stage).toHaveAttribute("aria-busy", "false");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).rayReplies.some((places: Place[]) =>
          places.some(
            (p) =>
              p.path.join(".") === "rays.lines" &&
              p.kind === "ray" &&
              p.count === 2304,
          ),
        ),
      ),
    )
    .toBe(true);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("packed topology preserves high bits, row tails and neighboring numbers", () => {
  const result = restore(
    { grids: [{ faces: null }], before: null, after: null },
    lifted(
      [0.5, -0, 2147483649, 1, 2147483647, 4294967295, 1, 0, 2147483648, 3.25],
      [
        { path: ["before"], kind: "number", offset: 0, count: 2 },
        {
          path: ["grids", 0, "faces"],
          kind: "flags",
          offset: 2,
          rows: [33, -1, 0, 31, 32, 1, 64],
        },
        { path: ["after"], kind: "number", offset: 9, count: 1 },
        { path: ["optional"], kind: "flags", offset: 2, count: 33 },
      ],
    ),
  );
  const ends = Array.from(
    { length: 33 },
    (_, k) => k === 0 || k === 31 || k === 32,
  );
  expect(result.grids[0].faces).toEqual([
    ends,
    null,
    [],
    Array(31).fill(true),
    Array(32).fill(true),
    [true],
    Array.from({ length: 64 }, (_, k) => k === 63),
  ]);
  expect((result as any).optional).toEqual(ends);
  expect(result.before).toEqual([0.5, -0]);
  expect(Object.is(result.before![1], -0)).toBe(true);
  expect(result.after).toEqual([3.25]);
});

test("a real surface reply packs topology and reconstructs its analytic grid", () => {
  const preset = spatialPresets.find(
    (p) => p.name === "The whole focal surface of an ellipsoid",
  )!;
  const reply = spatial(JSON.stringify(preset.config));
  expect(typeof reply).toBe("object");
  const places: Place[] = JSON.parse(reply.lifted.places);
  const flags = places.filter((p) => p.kind === "flags");
  expect(flags.some((p) => p.path.join(".") === "surface.surface.faces")).toBe(
    true,
  );
  expect(reply.json.length).toBeLessThan(50_000);
  const result = restore(JSON.parse(reply.json), reply.lifted);
  const sheet = result.surface.surface;
  const { uSamples: nu, vSamples: nv } = preset.config.surface;
  expect(sheet.faces).toHaveLength(nu);
  // This ellipsoid excludes the poles; every patch cell is regular and
  // its four boundary edges stay joined after the real WASM reply.
  for (const grid of [sheet.faces, sheet.alongU, sheet.alongV])
    for (const row of grid) {
      expect(row.every((value: unknown) => typeof value === "boolean")).toBe(
        true,
      );
      expect(row.every(Boolean)).toBe(true);
    }
  expect(sheet.faces[0]).toHaveLength(nv);
});
