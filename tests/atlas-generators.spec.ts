import { test, expect, type Page } from "@playwright/test";
import { deflateRawSync } from "node:zlib";
import { presets } from "../web/presets";
import type { Config } from "../web/types";
import type { PlanarStudy } from "../web/planar-link";
import { readFile } from "node:fs/promises";
import {
  copiedStudy,
  observeAtlasWorkers,
  openAtlas,
  settled,
} from "./gallery-helpers";
import { choosePreset, exportImage } from "./helpers";

// Lissajous whole frequencies, one Fourier term's whole frequency and
// radius, and an implicit curve's level and shape parameter in the planar
// atlas (docs/architecture.md, Reversible parameter atlas).

const presetIndex = (title: string) => {
  const index = presets.findIndex((p) => p.title === title);
  expect(index, title).toBeGreaterThanOrEqual(0);
  return index;
};
const lissajousTitle = "Lissajous 3 : 2 & its pedal";
const fourierTitle = "Epicycles, turned inside out";
const cassiniTitle = "Cassini ovals & the lemniscate";
const modesTitle = "Two modes trading places";
const config = (title: string): Config =>
  structuredClone(presets[presetIndex(title)].config);

test("atlas generator catalog admits only active whole frequencies, Fourier terms and a read shape parameter", async () => {
  const { atlasPairs, atlasPair } = await import("../web/atlas");
  const ids = (c: Config, facts = {}) => atlasPairs(c, facts).map((p) => p.id);

  // Lissajous: both frequencies whole and both amplitudes positive. The
  // generator pair comes before the construction's pole, as roulette does.
  const lissajous = config(lissajousTitle);
  expect(ids(lissajous)).toEqual(["lissajous", "pole"]);
  for (const [field, value] of [
    ["frequencyX", 2.5],
    ["frequencyY", Math.SQRT2],
    ["amplitudeX", 0],
    ["amplitudeY", 0],
    ["frequencyX", 2 ** 60],
  ] as const) {
    const c = structuredClone(lissajous);
    c.curve.lissajous[field] = value;
    expect(ids(c), `${field} ${value}`).toEqual(["pole"]);
  }
  const negative = structuredClone(lissajous);
  negative.curve.lissajous.frequencyX = -3;
  negative.curve.lissajous.frequencyY = 0;
  expect(ids(negative)).toEqual(["lissajous", "pole"]);
  // Dormant Lissajous fields never establish support for another format.
  expect(
    ids({ ...lissajous, curve: { ...lissajous.curve, format: "parametric" } }),
  ).toEqual(["pole"]);

  // Fourier: one entry per term with a whole frequency and positive radius,
  // only with two or more terms.
  const fourier = config(fourierTitle);
  expect(ids(fourier)).toEqual(["term-1", "term-2", "term-3"]);
  fourier.curve.terms[1].radius = 0;
  fourier.curve.terms[2].frequency = 6.5;
  expect(ids(fourier)).toEqual(["term-1"]);
  fourier.curve.terms = [fourier.curve.terms[0]];
  expect(ids(fourier)).toEqual([]);
  const sixteen = config(fourierTitle);
  sixteen.curve.terms = Array.from({ length: 16 }, (_, k) => ({
    frequency: 1 - 3 * k,
    radius: 1 / (k + 1),
    phase: 0,
  }));
  expect(ids(sixteen)).toEqual(
    Array.from({ length: 16 }, (_, k) => `term-${k + 1}`),
  );
  expect(atlasPair("term-16").axes.map((a) => a.path)).toEqual([
    ["curve", "terms", 15, "frequency"],
    ["curve", "terms", 15, "radius"],
  ]);
  expect(
    ids({ ...sixteen, curve: { ...sixteen.curve, format: "lissajous" } }),
  ).toEqual(["lissajous"]);

  // Implicit: only when the settled frame reports that F reads a.
  const cassini = config(cassiniTitle);
  expect(ids(cassini)).toEqual([]);
  expect(ids(cassini, { usesA: false })).toEqual([]);
  expect(ids(cassini, { usesA: true })).toEqual(["level"]);
  // A frame's fact never enables the pair on another format.
  expect(ids(lissajous, { usesA: true })).toEqual(["lissajous", "pole"]);
  expect(atlasPair("level").axes.map((a) => [a.path, !!a.integer])).toEqual([
    [["curve", "implicit", "level"], false],
    [["curve", "a"], false],
  ]);
  expect(atlasPair("lissajous").axes.map((a) => [a.path, !!a.integer])).toEqual(
    [
      [["curve", "lissajous", "frequencyX"], true],
      [["curve", "lissajous", "frequencyY"], true],
    ],
  );
  expect(atlasPair("term-2").axes.map((a) => [a.path, !!a.integer])).toEqual([
    [["curve", "terms", 1, "frequency"], true],
    [["curve", "terms", 1, "radius"], false],
  ]);
});

test("atlas facts come only from a settled implicit frame of the same F", async () => {
  const { atlasFacts } = await import("../web/atlas");
  const cassini = config(cassiniTitle);
  const frame = (usesA: boolean, f = cassini.curve.implicit.f) =>
    ({
      config: {
        ...cassini,
        curve: { ...cassini.curve, implicit: { ...cassini.curve.implicit, f } },
      },
      result: { contours: { usesA } },
    }) as any;
  expect(atlasFacts(frame(true), cassini)).toEqual({ usesA: true });
  expect(atlasFacts(frame(false), cassini)).toEqual({ usesA: false });
  expect(atlasFacts(frame(true, "x^2+y^2"), cassini)).toEqual({ usesA: false });
  expect(atlasFacts(null, cassini)).toEqual({ usesA: false });
  expect(
    atlasFacts({ config: cassini, result: { base: [] } } as any, cassini),
  ).toEqual({ usesA: false });
});

test("atlas whole-number axes take exact evenly spaced values and name the endpoint that breaks them", async () => {
  const { atlasRangeError, ParameterAtlas } = await import("../web/atlas");
  const { presetStudy } = await import("../web/planar-link");
  const lissajous = (x: [number, number], y: [number, number]) => ({
    m: x,
    n: y,
  });
  expect(
    atlasRangeError(lissajous([1, 5], [-3, 1]), "lissajous", 3),
  ).toBeNull();
  expect(
    atlasRangeError(lissajous([1, 5], [-3, 1]), "lissajous", 5),
  ).toBeNull();
  expect(atlasRangeError(lissajous([1, 3], [1, 3]), "lissajous", 3)).toBeNull();
  expect(atlasRangeError(lissajous([1, 3], [1, 5]), "lissajous", 5)).toEqual({
    label: "Frequency m to",
    message:
      "Frequency m to must exceed frequency m from by a multiple of 4, so every grid value is a whole number.",
  });
  expect(atlasRangeError(lissajous([1, 5], [1, 4]), "lissajous", 3)).toEqual({
    label: "Frequency n to",
    message:
      "Frequency n to must exceed frequency n from by a multiple of 2, so every grid value is a whole number.",
  });
  expect(atlasRangeError(lissajous([1.5, 5], [1, 5]), "lissajous", 3)).toEqual({
    label: "Frequency m from",
    message: "Frequency m from must be a whole number.",
  });
  expect(atlasRangeError(lissajous([1, 5.5], [1, 5]), "lissajous", 3)).toEqual({
    label: "Frequency m to",
    message:
      "Frequency m to must be a whole number greater than frequency m from.",
  });
  expect(atlasRangeError(lissajous([5, 1], [1, 5]), "lissajous", 3)).toEqual({
    label: "Frequency m to",
    message:
      "Frequency m to must be a whole number greater than frequency m from.",
  });
  expect(
    atlasRangeError(lissajous([1, 2 ** 60], [1, 5]), "lissajous", 3)?.label,
  ).toBe("Frequency m to");
  expect(
    atlasRangeError(lissajous([NaN, 5], [1, 5]), "lissajous", 3)?.label,
  ).toBe("Frequency m from");
  // A mixed pair validates its continuous axis as before.
  expect(
    atlasRangeError({ frequency: [-6, -2], radius: [0.5, 0.5] }, "term-2", 3),
  ).toEqual({
    label: "Radius r₂ to",
    message: "Radius r₂ to must be finite and greater than radius r₂ from.",
  });
  expect(
    atlasRangeError({ frequency: [-6, -2], radius: [0.3, 0.4] }, "term-2", 5),
  ).toBeNull();

  const study = presetStudy(presetIndex(lissajousTitle));
  const atlas = new ParameterAtlas(
    { compute: () => new Promise(() => {}) },
    () => {},
  );
  atlas.generate(
    study,
    { m: [-1, 7], n: [1000, 1004] },
    { pair: "lissajous", size: 5 },
  );
  expect(atlas.state.error).toBeUndefined();
  const values = atlas.state.cells.map((c) => c.values);
  expect(values.slice(0, 5).map((v) => v[0])).toEqual([-1, 1, 3, 5, 7]);
  expect(values.filter((_, i) => i % 5 === 0).map((v) => v[1])).toEqual([
    1000, 1001, 1002, 1003, 1004,
  ]);
  expect(values.flat().every(Number.isInteger)).toBe(true);
  // Whole-number values are exact even where weighted interpolation rounds.
  const top = Number.MAX_SAFE_INTEGER;
  atlas.generate(
    study,
    { m: [top - 8, top], n: [1, 5] },
    { pair: "lissajous", size: 5 },
  );
  expect(atlas.state.cells.slice(0, 5).map((c) => c.values[0])).toEqual([
    top - 8,
    top - 6,
    top - 4,
    top - 2,
    top,
  ]);
  // Endpoints more than 2^53 apart: divisibility and values use the exact
  // difference, never its rounded double. 2^54 − 3 is odd, though its double
  // is even; 2^54 − 4 divides by 4, but i · (to − from) rounds.
  for (const size of [3, 5] as const)
    expect(
      atlasRangeError(lissajous([-top, top - 1], [1, 5]), "lissajous", size)
        ?.label,
    ).toBe("Frequency m to");
  atlas.generate(
    study,
    { m: [-top, top - 1], n: [1, 5] },
    { pair: "lissajous", size: 3 },
  );
  expect(atlas.state.error).toMatch(/Frequency m to must exceed/);
  atlas.generate(
    study,
    { m: [1 - top, top - 1], n: [1, 5] },
    { pair: "lissajous", size: 5 },
  );
  expect(atlas.state.cells.slice(0, 5).map((c) => c.values[0])).toEqual([
    1 - top,
    -(top - 1) / 2,
    0,
    (top - 1) / 2,
    top - 1,
  ]);
  atlas.generate(
    study,
    { m: [-top, top - 2], n: [1, 5] },
    { pair: "lissajous", size: 5 },
  );
  expect(atlas.state.cells.slice(0, 5).map((c) => c.values[0])).toEqual([
    -top,
    -(2 ** 52),
    -1,
    2 ** 52 - 2,
    top - 2,
  ]);
  // An undivided range is refused rather than rounded.
  atlas.generate(
    study,
    { m: [1, 4], n: [1, 5] },
    { pair: "lissajous", size: 3 },
  );
  expect(atlas.state.error).toMatch(/Frequency m to must exceed/);
  expect(atlas.state.cells).toEqual([]);
  atlas.cancel();
});

test("atlas generator defaults center on the source, keep Lissajous frequencies on its side of zero and divide for both sizes", async () => {
  const { atlasDefaults, atlasRangeError } = await import("../web/atlas");
  const lissajous = config(lissajousTitle);
  const frequencies = (x: number, y: number) => {
    const c = structuredClone(lissajous);
    c.curve.lissajous.frequencyX = x;
    c.curve.lissajous.frequencyY = y;
    return atlasDefaults(c, "lissajous");
  };
  expect(frequencies(3, 2)).toEqual({ m: [1, 5], n: [1, 5] });
  expect(frequencies(1, 7)).toEqual({ m: [1, 5], n: [5, 9] });
  expect(frequencies(-2, -1)).toEqual({ m: [-5, -1], n: [-5, -1] });
  expect(frequencies(0, -3)).toEqual({ m: [-2, 2], n: [-5, -1] });
  expect(frequencies(999, -1000)).toEqual({ m: [997, 1001], n: [-1002, -998] });
  for (const size of [3, 5] as const)
    expect(atlasRangeError(frequencies(3, 2), "lissajous", size)).toBeNull();

  const fourier = config(fourierTitle);
  expect(atlasDefaults(fourier, "term-2")).toEqual({
    frequency: [-6, -2],
    radius: [0.3375, 0.5625],
  });
  expect(atlasDefaults(fourier, "term-1")).toEqual({
    frequency: [-1, 3],
    radius: [0.75, 1.25],
  });

  const cassini = config(cassiniTitle);
  expect(atlasDefaults(cassini, "level")).toEqual({
    level: [0.75, 1.25],
    a: [0.75, 1.25],
  });
  const modes = config(modesTitle);
  const ranges = atlasDefaults(modes, "level");
  expect(ranges.level).toEqual([-0.25, 0.25]);
  expect(ranges.a[0]).toBeCloseTo(Math.PI / 6 - 0.25, 15);
  expect(ranges.a[1]).toBeCloseTo(Math.PI / 6 + 0.25, 15);
});

test("atlas implicit previews cap only the grid and normals, and admission counts grid evaluations instead of dormant samples", async () => {
  const { atlasPreviewConfig, atlasBudget } = await import("../web/atlas");
  const facts = { usesA: true };
  const cassini = config(cassiniTitle);
  Object.assign(cassini, { samples: 20000, lines: 200, adaptive: true });
  cassini.curve.implicit.cells = 1024;
  for (const [size, cells, lines] of [
    [3, 256, 128],
    [5, 160, 64],
  ] as const) {
    const preview = atlasPreviewConfig(cassini, size);
    const expected = structuredClone(cassini);
    expected.curve.implicit.cells = cells;
    expected.lines = lines;
    // Dormant samples and refinement flags stay as the study has them.
    expect(preview).toEqual(expected);
  }
  const small = structuredClone(cassini);
  small.curve.implicit.cells = 96;
  small.lines = 12;
  expect(atlasPreviewConfig(small, 5)).toEqual(small);

  expect(atlasBudget(cassini, 5, facts)).toEqual({
    points: 0,
    work: 0,
    iterations: 0,
    density: 0,
    grid: 25 * 161 ** 2 + 1025 ** 2,
    error: undefined,
  });
  expect(atlasBudget(cassini, 3, facts).grid).toBe(9 * 257 ** 2 + 1025 ** 2);
  expect(atlasBudget(cassini, 5, facts).grid).toBe(1698650);
  // Without a read a, the study has no pair, whatever its work.
  expect(atlasBudget(cassini, 3).error).toMatch(/no curated parameter pair/);
  // The line limits still apply.
  expect(atlasBudget({ ...cassini, lines: 257 }, 3, facts).error).toMatch(
    /limit/,
  );
  // Ordinary curves are unchanged and reserve no grid.
  const lissajous = config(lissajousTitle);
  expect(atlasBudget(lissajous, 5).grid).toBe(0);
  expect(atlasBudget({ ...lissajous, samples: 8001 }).error).toMatch(/limit/);
});

test("atlas generator candidates change only their two fields, including one Fourier term", async () => {
  const { ParameterAtlas, atlasDefaults } = await import("../web/atlas");
  const { presetStudy } = await import("../web/planar-link");
  for (const [title, pair, facts] of [
    [fourierTitle, "term-2", {}],
    [lissajousTitle, "lissajous", {}],
    [cassiniTitle, "level", { usesA: true }],
  ] as const) {
    const study = presetStudy(presetIndex(title));
    const frozen = structuredClone(study);
    const calls: any[] = [];
    const atlas = new ParameterAtlas(
      {
        compute: async (config) => {
          calls.push(structuredClone(config));
          return { config, result: { base: [] } } as any;
        },
      },
      () => {},
    );
    atlas.generate(study, atlasDefaults(study.config, pair), {
      pair,
      size: 3,
      facts,
    });
    expect(atlas.state.error).toBeUndefined();
    await expect.poll(() => calls.length).toBe(9);
    atlas.inspect(8);
    await expect.poll(() => atlas.state.selection?.frame).toBeTruthy();
    const candidate = atlas.candidate()!;
    const expected = structuredClone(frozen);
    const [x, y] = atlas.state.cells[8].values;
    if (pair === "term-2") {
      expected.config.curve.terms[1].frequency = x;
      expected.config.curve.terms[1].radius = y;
      expect([x, y]).toEqual([-2, 0.5625]);
    } else if (pair === "lissajous") {
      expected.config.curve.lissajous.frequencyX = x;
      expected.config.curve.lissajous.frequencyY = y;
      expect([x, y]).toEqual([5, 5]);
    } else {
      expected.config.curve.implicit.level = x;
      expected.config.curve.a = y;
      expect([x, y]).toEqual([1.25, 1.25]);
    }
    expect(candidate).toEqual(expected);
    expect(study).toEqual(frozen);
    // Inspection runs at original quality.
    expect(calls.at(-1)).toEqual(expected.config);
    atlas.cancel();
  }
  // Without the fact, the implicit pair is refused at generation.
  const study = presetStudy(presetIndex(cassiniTitle));
  const atlas = new ParameterAtlas(
    { compute: async () => ({}) as any },
    () => {},
  );
  atlas.generate(study, atlasDefaults(study.config, "level"), {
    pair: "level",
  });
  expect(atlas.state.error).toMatch(/no curated parameter pair/);
});

// Opens a study from a link, with the edits given, in the planar notebook.
async function openStudy(page: Page, source: PlanarStudy) {
  await page.goto(
    `/#s=${deflateRawSync(JSON.stringify({ v: 1, notebook: "2d", study: source })).toString("base64url")}`,
  );
  await settled(page);
}

// Whole-number and mixed axes through the real worker: each cell equals an
// ordinary request assembled from the frozen source and entered grid, and its
// geometry satisfies the generator's own definition at the displayed values.
for (const [pair, title, labels, entered] of [
  [
    "lissajous",
    lissajousTitle,
    ["Frequency m", "Frequency n"],
    {
      3: [
        [2, 6],
        [1, 3],
      ],
      5: [
        [1, 5],
        [1, 5],
      ],
    },
  ],
  [
    "term-2",
    fourierTitle,
    ["Frequency k₂", "Radius r₂"],
    {
      3: [
        [-7, -3],
        [0.25, 0.75],
      ],
      5: [
        [-6, -2],
        [0.25, 0.75],
      ],
    },
  ],
  [
    "level",
    cassiniTitle,
    ["Level c", "Shape parameter a"],
    {
      3: [
        [0.5, 1.5],
        [0.75, 1.25],
      ],
      5: [
        [0.5, 1.5],
        [0.75, 1.25],
      ],
    },
  ],
] as const)
  for (const size of [3, 5] as const)
    test(`atlas ${pair} ${size} × ${size} previews and inspection equal ordinary requests and their definition`, async ({
      page,
    }, info) => {
      const { presetStudy } = await import("../web/planar-link");
      const source = presetStudy(presetIndex(title));
      source.config.samples = 4000;
      source.config.lines = 144;
      // Above both implicit preview caps.
      source.config.curve.implicit.cells = 400;
      await observeAtlasWorkers(page);
      await openStudy(page, source);
      const atlas = await openAtlas(page);
      await atlas
        .getByLabel("Parameter pair", { exact: true })
        .selectOption(pair);
      await atlas
        .getByLabel("Grid size", { exact: true })
        .selectOption(String(size));
      const ranges = entered[size];
      for (let i = 0; i < 2; i++) {
        // Widen before narrowing so intermediate ranges stay increasing.
        await atlas.getByLabel(`${labels[i]} to`, { exact: true }).fill("1000");
        await atlas
          .getByLabel(`${labels[i]} from`, { exact: true })
          .fill(String(ranges[i][0]));
        await atlas
          .getByLabel(`${labels[i]} to`, { exact: true })
          .fill(String(ranges[i][1]));
      }
      const generate = atlas.getByRole("button", {
        name: "Generate atlas",
        exact: true,
      });
      await expect(generate).toBeEnabled();
      await generate.click();
      await expect(
        atlas.locator('.atlas-cell[data-state="valid"]'),
      ).toHaveCount(size * size);
      await expect(atlas.locator(".atlas-quality")).toContainText(
        pair === "level"
          ? `${size === 3 ? 256 : 160} grid cells along the window's longer side, ${size === 3 ? 128 : 64} construction lines`
          : `${size === 3 ? "2,000" : "1,000"} samples, ${size === 3 ? 128 : 64} construction lines`,
      );
      if (pair === "level")
        await expect(atlas.locator(".atlas-quality")).toContainText(
          "A coarser grid can join or split contours near a saddle.",
        );
      else
        await expect(atlas.locator(".atlas-quality")).not.toContainText(
          "saddle",
        );
      const compare = (full: boolean) =>
        page.evaluate(
          async ({ source, pair, size, ranges, full }) => {
            const grid = (window as any).atlasWorkers[1];
            const requests = full
              ? [grid.requests.at(-1)]
              : grid.requests.slice(-size * size);
            const ordinary = new Worker(grid.url);
            const canonical = (v: any): any =>
              Array.isArray(v)
                ? v.map(canonical)
                : v && typeof v === "object"
                  ? Object.fromEntries(
                      Object.keys(v)
                        .sort()
                        .map((k) => [k, canonical(v[k])]),
                    )
                  : v;
            const outcomes = [];
            for (let i = 0; i < requests.length; i++) {
              // Assembled from the frozen source and the entered dyadic grid, never
              // from the request under test or an atlas helper.
              const config = structuredClone(source.config);
              const index = full ? size * size - 1 : i;
              const x =
                ranges[0][0] +
                ((ranges[0][1] - ranges[0][0]) * (index % size)) / (size - 1);
              const y =
                ranges[1][0] +
                ((ranges[1][1] - ranges[1][0]) * Math.floor(index / size)) /
                  (size - 1);
              if (pair === "lissajous")
                Object.assign(config.curve.lissajous, {
                  frequencyX: x,
                  frequencyY: y,
                });
              else if (pair === "term-2")
                Object.assign(config.curve.terms[1], {
                  frequency: x,
                  radius: y,
                });
              else {
                config.curve.implicit.level = x;
                config.curve.a = y;
              }
              if (!full) {
                config.lines = size === 3 ? 128 : 64;
                if (pair === "level")
                  config.curve.implicit.cells = size === 3 ? 256 : 160;
                else config.samples = size === 3 ? 2000 : 1000;
              }
              const expected: any = await new Promise((resolve) => {
                ordinary.onmessage = (e) => resolve(e.data);
                ordinary.postMessage({
                  id: 10000 + i,
                  action: "compute",
                  config,
                  bounds: source.bounds,
                  base: location.origin + "/",
                });
              });
              const actual = grid.replies.find(
                (r: any) => r.data.id === requests[i].data.id,
              ).data;
              // The definition at the displayed values, from the returned
              // geometry: the largest residual over every point drawn.
              let residual = 0,
                points = 0,
                pieces = 0;
              const c = actual.config.curve;
              if (pair === "level") {
                const a = y,
                  level = x;
                const F = (p: any) =>
                  ((p.x - a) ** 2 + p.y ** 2) * ((p.x + a) ** 2 + p.y ** 2);
                pieces = actual.result.contours.curve.contours.length;
                for (const contour of actual.result.contours.curve.contours)
                  for (const p of contour.points) {
                    residual = Math.max(residual, Math.abs(F(p) - level));
                    points++;
                  }
              } else {
                const base = actual.result.base;
                const n = base.length;
                for (let j = 0; j < n; j++) {
                  const t = c.min + ((c.max - c.min) * j) / (n - 1);
                  let ex: number, ey: number;
                  if (pair === "lissajous") {
                    const l = source.config.curve.lissajous;
                    ex = l.amplitudeX * Math.sin(x * t + l.phase);
                    ey = l.amplitudeY * Math.sin(y * t);
                  } else {
                    ex = ey = 0;
                    source.config.curve.terms.forEach(
                      (term: any, k: number) => {
                        const [f, r] =
                          k === 1 ? [x, y] : [term.frequency, term.radius];
                        ex += r * Math.cos(f * t + term.phase);
                        ey += r * Math.sin(f * t + term.phase);
                      },
                    );
                  }
                  residual = Math.max(
                    residual,
                    Math.hypot(base[j].x - ex, base[j].y - ey),
                  );
                  points++;
                }
              }
              outcomes.push({
                index,
                values: [x, y],
                same:
                  JSON.stringify(expected.result) ===
                    JSON.stringify(actual.result) &&
                  JSON.stringify(canonical(expected.config)) ===
                    JSON.stringify(canonical(actual.config)),
                error: expected.error ?? actual.error,
                residual,
                points,
                pieces,
                milliseconds: grid.replies.find(
                  (r: any) => r.data.id === requests[i].data.id,
                ).took,
              });
            }
            ordinary.terminate();
            return { outcomes, maximum: grid.maximum };
          },
          { source, pair, size, ranges, full },
        );
      const check = (outcomes: any[], full: boolean) => {
        for (const o of outcomes) {
          expect(o, JSON.stringify(o)).toMatchObject({
            same: true,
            error: undefined,
          });
          if (pair !== "level")
            expect(Number.isInteger(o.values[0]), JSON.stringify(o)).toBe(true);
          expect(o.points, JSON.stringify(o)).toBeGreaterThan(
            pair === "level" ? 100 : full ? 3999 : size === 3 ? 1999 : 999,
          );
          // Sample-time rounding for curves; level-set bisection is exact to
          // rounding in F, which reaches about 4 here.
          expect(o.residual, JSON.stringify(o)).toBeLessThan(1e-9);
          if (pair === "level") {
            // Cassini: two ovals below a⁴, one above (away from the
            // lemniscate itself, where the grid decides).
            const [level, a] = o.values;
            if (Math.abs(level - a ** 4) > 0.05)
              expect(o.pieces, JSON.stringify(o)).toBe(level < a ** 4 ? 2 : 1);
          }
        }
      };
      const previews = await compare(false);
      check(previews.outcomes, false);
      expect(previews.maximum).toBe(1);
      await atlas.screenshot({
        path: info.outputPath(`${pair}-${size}-grid.png`),
      });
      const last = `Inspect row ${size}, column ${size}`;
      await atlas.getByRole("button", { name: last, exact: true }).click();
      await expect(
        atlas.getByRole("button", { name: "Adopt variant", exact: true }),
      ).toBeEnabled();
      const inspection = await compare(true);
      check(inspection.outcomes, true);
      await info.attach("independent-atlas-observations", {
        body: JSON.stringify({ previews, inspection }, null, 2),
        contentType: "application/json",
      });
    });

test("atlas whole-number ranges show their error under the named endpoint and revalidate with grid size", async ({
  page,
}) => {
  await page.goto("/");
  await choosePreset(page, { label: lissajousTitle });
  await settled(page);
  const atlas = await openAtlas(page);
  await expect(atlas.getByLabel("Parameter pair", { exact: true })).toHaveValue(
    "lissajous",
  );
  await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(9);
  const generate = atlas.getByRole("button", {
    name: "Generate atlas",
    exact: true,
  });
  const field = (label: string) => atlas.getByLabel(label, { exact: true });
  const size = atlas.getByLabel("Grid size", { exact: true });
  const invalid = async (label: string, message: string) => {
    await expect(field(label)).toHaveAttribute("aria-invalid", "true");
    await expect(
      atlas
        .locator(".field", { has: page.getByLabel(label, { exact: true }) })
        .getByRole("alert"),
    ).toHaveText(message);
    await expect(generate).toBeDisabled();
  };
  const valid = async () => {
    await expect(atlas.locator('[aria-invalid="true"]')).toHaveCount(0);
    await expect(generate).toBeEnabled();
  };
  await field("Frequency m to").fill("4");
  await invalid(
    "Frequency m to",
    "Frequency m to must exceed frequency m from by a multiple of 2, so every grid value is a whole number.",
  );
  // A range edit retires the old grid at once.
  await expect(atlas.locator(".atlas-cell")).toHaveCount(0);
  await field("Frequency m to").fill("2+3");
  await valid();
  await size.selectOption("5");
  await valid();
  await field("Frequency n to").fill("3");
  await invalid(
    "Frequency n to",
    "Frequency n to must exceed frequency n from by a multiple of 4, so every grid value is a whole number.",
  );
  // Changing the size keeps the entered range and checks it again.
  await size.selectOption("3");
  await valid();
  await expect(field("Frequency n to")).toHaveValue("3");
  await field("Frequency m from").fill("1.5");
  await invalid("Frequency m from", "Frequency m from must be a whole number.");
  await field("Frequency m from").fill("pi");
  await invalid("Frequency m from", "Frequency m from must be a whole number.");
  await field("Frequency m from").fill("3");
  await valid();
  await generate.click();
  await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(9);
  await expect(atlas.locator(".atlas-values").first()).toHaveText("m = 3n = 1");
  await expect(atlas.locator(".atlas-values").last()).toHaveText("m = 5n = 3");
  // The whole-number help opens on its own field.
  const help = atlas.locator(".field", {
    has: page.getByLabel("Frequency m from", { exact: true }),
  });
  await help
    .getByRole("button", { name: "About Frequency m from", exact: true })
    .click();
  await expect(help.locator(".hint-brief")).toContainText(
    "Whole numbers, spaced evenly across the grid.",
  );
});

test("atlas implicit level and shape pair follows whether the settled F reads a", async ({
  page,
}) => {
  await page.goto("/");
  await choosePreset(page, { label: cassiniTitle });
  await settled(page);
  const entry = page.getByRole("button", {
    name: "Explore parameter atlas",
    exact: true,
  });
  await expect(entry).toBeEnabled();
  const f = page.getByLabel("F(x, y)", { exact: true });
  const original = await f.inputValue();
  await f.fill("x^2+y^2+atan(y)");
  await settled(page);
  await expect(entry).toBeDisabled();
  await f.fill(original.replaceAll("a)", "0.9*a)"));
  await settled(page);
  await expect(entry).toBeEnabled();
  const atlas = await openAtlas(page);
  const pair = atlas.getByLabel("Parameter pair", { exact: true });
  await expect(pair).toHaveValue("level");
  await expect(pair.locator("option")).toHaveText([
    "Implicit level c / shape parameter a",
  ]);
  await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(9);
  await expect(atlas.getByText(/^Your study stays here/)).toContainText(
    "Level c runs across columns; shape parameter a runs down rows.",
  );
  // No preview cap applies to 160 cells, so no saddle disclosure.
  await expect(atlas.locator(".atlas-quality")).toContainText(
    "160 grid cells along the window's longer side",
  );
  await expect(atlas.locator(".atlas-quality")).not.toContainText("saddle");
});

test("atlas generator unavailable cells keep their values unclamped beside valid ones", async ({
  page,
}) => {
  await page.goto("/");
  await choosePreset(page, { label: lissajousTitle });
  await settled(page);
  const atlas = await openAtlas(page);
  await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(9);
  await atlas.getByLabel("Frequency m to", { exact: true }).fill("1002");
  await atlas.getByLabel("Frequency m from", { exact: true }).fill("998");
  await atlas
    .getByRole("button", { name: "Generate atlas", exact: true })
    .click();
  await expect(atlas.getByText("9 of 9 variants ready.")).toBeVisible();
  await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(6);
  const unavailable = atlas.locator('.atlas-cell[data-state="invalid"]');
  await expect(unavailable).toHaveCount(3);
  for (let row = 0; row < 3; row++) {
    const cell = unavailable.nth(row);
    await expect(cell.locator(".atlas-values")).toHaveText(
      `m = 1002n = ${1 + 2 * row}`,
    );
    await expect(cell.locator(".field-error")).toContainText(
      "Lissajous frequencies m and n must be finite and within ±1000",
    );
    await expect(cell.getByRole("button")).toBeDisabled();
  }
  await expect(
    atlas.locator('.atlas-cell[data-state="valid"] .atlas-values').first(),
  ).toHaveText("m = 998n = 1");
});

for (const [pair, title, raw, text, change] of [
  [
    "lissajous",
    lissajousTitle,
    "Phase φ (radians)",
    "pi/3",
    (c: Config) =>
      Object.assign(c.curve.lissajous, { frequencyX: 1, frequencyY: 1 }),
  ],
  [
    "term-2",
    fourierTitle,
    "Phase φ₃",
    "pi/5",
    (c: Config) =>
      Object.assign(c.curve.terms[1], { frequency: -6, radius: 0.3375 }),
  ],
  [
    "level",
    cassiniTitle,
    "Window x from",
    "-2-0.25",
    (c: Config) => {
      c.curve.implicit.level = 0.75;
      c.curve.a = 0.75;
    },
  ],
] as const)
  test(`atlas ${pair} cancel and adoption keep the edited study through links and a real SVG export`, async ({
    page,
  }) => {
    const { presetStudy } = await import("../web/planar-link");
    const source = presetStudy(presetIndex(title));
    source.camera = { x: 31, y: -19, zoom: 1.4 };
    source.weight = "bold";
    source.layers.axes = true;
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await openStudy(page, source);
    const field = page.getByLabel(raw, { exact: true });
    await field.fill(text);
    await settled(page);
    const before = (await copiedStudy(page)).study;
    const inspectFirst = async () => {
      const atlas = await openAtlas(page);
      const choice = atlas.getByLabel("Parameter pair", { exact: true });
      if (pair === "term-2") {
        // The first term's pair opens; another term is one choice away.
        await expect(choice).toHaveValue("term-1");
        await choice.selectOption(pair);
        await atlas
          .getByRole("button", { name: "Generate atlas", exact: true })
          .click();
      }
      await expect(choice).toHaveValue(pair);
      await expect(
        atlas.locator('.atlas-cell[data-state="valid"]'),
      ).toHaveCount(9);
      await atlas
        .getByRole("button", { name: "Inspect row 1, column 1", exact: true })
        .click();
      await expect(
        atlas.getByRole("button", { name: "Adopt variant", exact: true }),
      ).toBeEnabled();
      return atlas;
    };
    await inspectFirst();
    await page.keyboard.press("Escape");
    expect((await copiedStudy(page)).study).toEqual(before);
    await expect(field).toHaveValue(text);
    const atlas = await inspectFirst();
    const drawing = await atlas
      .locator("#atlas-inspected")
      .evaluate((e) =>
        [...e.querySelectorAll("path")].map((p) => p.getAttribute("d")),
      );
    await atlas
      .getByRole("button", { name: "Adopt variant", exact: true })
      .click();
    await expect(page.locator(".plot-heading .eyebrow")).toHaveText(
      "YOUR OWN EXPLORATION",
    );
    await settled(page);
    const expected = structuredClone(before);
    change(expected.config);
    const adopted = await copiedStudy(page);
    expect(adopted.study).toEqual(expected);
    await expect(field).toHaveValue(text);
    expect(
      await page
        .locator("#artwork")
        .evaluate((e) =>
          [...e.querySelectorAll("path")].map((p) => p.getAttribute("d")),
        ),
    ).toEqual(drawing);
    const download = page.waitForEvent("download");
    await exportImage(page, "SVG");
    const svg = await readFile((await (await download).path())!, "utf8");
    expect(svg).not.toMatch(/<text\b/);
    const metadata = JSON.parse(
      svg
        .match(/<desc>(.*?)<\/desc>/s)![1]
        .replaceAll("&quot;", '"')
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&amp;", "&"),
    );
    expect(metadata.curve).toEqual(expected.config.curve);
    await page.goto(adopted.url);
    await settled(page);
    expect((await copiedStudy(page)).study).toEqual(expected);
  });

test("atlas generator range, pair and study replacement retire delayed previews and inspection", async ({
  page,
}) => {
  const { presetStudy } = await import("../web/planar-link");
  const source = presetStudy(presetIndex(fourierTitle));
  await observeAtlasWorkers(page, 150);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await openStudy(page, source);
  let atlas = await openAtlas(page);
  const pair = atlas.getByLabel("Parameter pair", { exact: true });
  const inspect = atlas.getByRole("button", {
    name: "Inspect row 1, column 1",
    exact: true,
  });
  const generate = atlas.getByRole("button", {
    name: "Generate atlas",
    exact: true,
  });
  await pair.selectOption("term-2");
  await atlas.getByLabel("Frequency k₂ from", { exact: true }).fill("-10");
  // A pair switch drops pending range evaluations and owns new fields.
  await pair.selectOption("term-3");
  await expect(
    atlas.getByLabel("Frequency k₃ from", { exact: true }),
  ).toHaveValue("4");
  await pair.selectOption("term-2");
  await expect(
    atlas.getByLabel("Frequency k₂ from", { exact: true }),
  ).toHaveValue("-6");
  await atlas.getByLabel("Grid size", { exact: true }).selectOption("5");
  await generate.click();
  await expect(inspect).toBeEnabled();
  await inspect.click();
  await expect(
    atlas.getByRole("button", { name: "Adopt variant", exact: true }),
  ).toBeDisabled();
  await atlas.getByRole("tab", { name: "Atlas grid", exact: true }).click();
  await atlas.getByLabel("Frequency k₂ to", { exact: true }).fill("2");
  await expect(atlas.locator(".atlas-cell")).toHaveCount(0);
  await expect(
    atlas.getByRole("tab", { name: "Selected variant", exact: true }),
  ).toBeDisabled();
  await generate.click();
  await expect(atlas.locator(".atlas-values").last()).toHaveText(
    "k₂ = 2r₂ = 0.5625",
  );
  await expect(inspect).toBeEnabled();
  await inspect.click();
  // A newer study from a link replaces the excursion and its late work.
  const replacement = presetStudy(presetIndex(cassiniTitle));
  replacement.config.curve.a = 1.1;
  await page.goto(
    `/#s=${deflateRawSync(JSON.stringify({ v: 1, notebook: "2d", study: replacement })).toString("base64url")}`,
  );
  await expect.poll(() => new URL(page.url()).hash).toBe("");
  await expect(atlas).toBeHidden();
  await settled(page);
  expect((await copiedStudy(page)).study).toEqual(replacement);
  expect(
    await page.evaluate(() => (window as any).atlasWorkers[1].terminated),
  ).toBe(true);
  atlas = await openAtlas(page);
  await expect(pair).toHaveValue("level");
  // The 5 × 5 choice is a remembered preference.
  await expect(
    atlas.getByLabel("Shape parameter a from", { exact: true }),
  ).toHaveValue("0.825");
  await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(
    25,
  );
  await page.keyboard.press("Escape");
  expect((await copiedStudy(page)).study).toEqual(replacement);
});

test("atlas entry admits an implicit study from the frame that settles after the request", async ({
  page,
}) => {
  await page.goto("/");
  await choosePreset(page, { label: "Hypotrochoid & its evolute" });
  await settled(page);
  // The request and a change to the default implicit F, which reads a,
  // arrive together; support comes from the frame computed for that F.
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Explore parameter atlas",
    )!;
    const label = [...document.querySelectorAll("label")].find((l) =>
      l.textContent?.startsWith("Definition"),
    )!;
    const select = (label.querySelector("select") ??
      document.getElementById(label.htmlFor)) as HTMLSelectElement;
    button.click();
    Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    )!.set!.call(select, "implicit");
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const atlas = page.getByRole("dialog", {
    name: "A field of possible flowers",
  });
  await expect(atlas).toBeVisible();
  await expect(atlas.getByLabel("Parameter pair", { exact: true })).toHaveValue(
    "level",
  );
  await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(9);
});
