import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import { createServer } from "vite";
import { fitFrame, framingPoints, type Layers } from "../web/Plot";
import { presets } from "../web/presets";
import { sampleProbe } from "../web/planar-probe";
import { viewZoom } from "../web/refinement";
import type { Config, Result, Vec } from "../web/types";

// A 2D study and its image under a similarity p ↦ s·p + c draw the same
// picture: the drawing frames, places and refines what it is given by the
// study's own size and position, never by constants in world units (see
// docs/mathematics.md, "Scale and translation", Drawing). Each test takes
// a preset's result from the real engine, maps it, and the configuration
// fields the drawing reads, as the engine's own copies are mapped
// (engine/scale_test.go), and compares the two SVGs number by number on
// the page. The engine's copies are checked against their originals there;
// mapping the result here isolates the drawing from the engine's rounding.
type Similarity = { name: string; s: number; c: Vec };
const copies: Similarity[] = [
  { name: "tiny", s: 2 ** -20, c: { x: 0, y: 0 } },
  { name: "huge", s: 2 ** 13, c: { x: 0, y: 0 } },
  { name: "far", s: 1, c: { x: 700, y: -500 } },
  {
    name: "tiny and far",
    s: 2 ** -20,
    c: { x: 700 * 2 ** -20, y: -500 * 2 ** -20 },
  },
  { name: "very far", s: 1, c: { x: 30000, y: -20000 } },
];
// How far a copy's page coordinates may lie from the original's: the
// drawing writes them to a thousandth of a page unit.
const tolerance = 0.002;

let compute: (json: string) => string;
let plotMarkup: typeof import("./plot-markup").plotMarkup;
test.beforeAll(async () => {
  const vite = await createServer({
    logLevel: "silent",
    server: { ws: false },
  });
  ({ plotMarkup } = await vite.ssrLoadModule("/tests/plot-markup.tsx"));
  await vite.close();
  // An iterated map's density is an image of its counts alone, which a
  // similarity leaves as they are; a stand-in canvas encodes it as nothing.
  Object.assign(globalThis, {
    ImageData: class {},
    document: {
      createElement: () => ({
        getContext: () => ({ putImageData: () => {} }),
        toDataURL: () => "data:,",
      }),
    },
  });
  runInThisContext(readFileSync("public/wasm_exec.js", "utf8"));
  const go = new (globalThis as any).Go();
  const { instance } = await WebAssembly.instantiate(
    readFileSync("public/engine.wasm"),
    go.importObject,
  );
  void go.run(instance);
  compute = (globalThis as any).tangentGardenCompute;
});

// A preset's result as the worker returns it, with its configuration.
function study(config: Config, extra: object = {}) {
  config = structuredClone(config);
  const result = JSON.parse(
    compute(JSON.stringify({ ...config, ...extra })),
  ) as Result & { error?: string };
  expect(result.error).toBeUndefined();
  if (result.sourcePosition) config.source.position = result.sourcePosition;
  return { config, result };
}

// Directions are free vectors, which neither scale nor move.
const directions = new Set([
  "direction",
  "incident",
  "gradient",
  "velocity",
  "tangent",
  "normal",
]);
const lengths = new Set([
  "radius",
  "fixedRadius",
  "radii",
  "distance",
  "tolerance",
  "spacing",
  "length",
]);
// Parameters, indices, counts, flags, levels and angles, which a similarity
// leaves alone. Every number of a result is one of these, a length, a
// curvature or a window's edge: anything new must be placed here.
const unchanged = new Set([
  "sampleIndex",
  "breaks",
  "inserted",
  "unresolved",
  "exhausted",
  "at",
  "reachAt",
  "virtual",
  "tir",
  "accumulated",
  "columns",
  "rows",
  "counts",
  "escape",
  "max",
  "min",
  "outside",
  "closed",
  "level",
  "nonfinite",
  "clipped",
  "flat",
  "unknown",
  "invalid",
  "seed",
  "time",
  "timed",
  "constant",
  "period",
  "whole",
  "angle",
  "lobes",
  "turns",
  "pursuer",
  "target",
  "end",
]);
const isVec = (v: any): v is Vec =>
  !!v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).sort().join() === "x,y";

// The result's image under m: positions mapped, lengths scaled, curvature
// divided by s, everything else as it was. A rolling curve's own outline
// is in its own frame, which its placements carry, so it is only scaled.
function mapResult(value: any, m: Similarity, key = "", body = false): any {
  const at = (p: Vec) =>
    body
      ? { x: m.s * p.x, y: m.s * p.y }
      : { x: m.s * p.x + m.c.x, y: m.s * p.y + m.c.y };
  if (value === null || typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((v) => mapResult(v, m, key, body));
  if (isVec(value)) return directions.has(key) ? value : at(value);
  if (key === "window") return mapWindow(value, m);
  if (typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        mapResult(v, m, k, body || (key === "moving" && k === "path")),
      ]),
    );
  if (typeof value === "boolean") return value;
  if (lengths.has(key)) return value * m.s;
  if (key === "curvature") return value / m.s;
  if (unchanged.has(key)) return value;
  throw new Error(`Place the result's ${key} in planar-rebase.spec.ts`);
}
function mapWindow(w: Record<string, number>, m: Similarity) {
  return {
    xMin: m.s * w.xMin + m.c.x,
    xMax: m.s * w.xMax + m.c.x,
    yMin: m.s * w.yMin + m.c.y,
    yMax: m.s * w.yMax + m.c.y,
  };
}
function mapStudy(config: Config, result: Result, m: Similarity) {
  const mapped = mapResult(result, m) as Result;
  const at = (p: Vec) => ({ x: m.s * p.x + m.c.x, y: m.s * p.y + m.c.y });
  const copy = structuredClone(config);
  copy.pole = at(config.pole);
  copy.source.position = at(config.source.position);
  copy.curve.field.seeds = config.curve.field.seeds.map(at);
  copy.curve.field.escape = config.curve.field.escape * m.s;
  return { config: copy, result: mapped };
}

// A roulette's fixed circle or line and a field's escape circle are drawn
// about the origin by their definitions, which a translation cannot carry
// (the engine rewrites such a translated study as a parametric curve).
const translatable = (config: Config) =>
  config.curve.format !== "roulette" && config.curve.format !== "field";

const layers: Layers = {
  base: true,
  derived: true,
  lines: true,
  incident: true,
  virtual: true,
  axes: false,
};

type Drawn = {
  config: Config;
  result: Result;
  camera?: { x: number; y: number; zoom: number };
  axes?: boolean;
};
function draw({ config, result, camera, axes = false }: Drawn) {
  const j = Math.floor((result.base.length - 1) / 3);
  const probe = result.diagnostics ? sampleProbe(result, j) : null;
  return plotMarkup({
    result,
    config,
    layers: { ...layers, axes },
    dark: false,
    length: 0.8,
    reset: 0,
    refineView: true,
    ...(camera && { initialCamera: { reset: 0, camera } }),
    ...(probe && { probe }),
  });
}

// The drawing's elements and attributes, with page geometry as numbers.
// Left out: the configuration in its description and the readouts in
// world units, which a copy changes by design.
const geometry = new Set([
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "width",
  "height",
]);
const skipped = new Set([
  "data-camera-scale",
  "data-camera-center",
  "data-x",
  "data-y",
  "data-distance",
]);
type Token = string | number;
function tokens(svg: string): Token[] {
  const out: Token[] = [];
  const body = svg.replace(/<desc>[\s\S]*?<\/desc>/, "");
  for (const [, name, attributes] of body.matchAll(/<(\w+)([^>]*)>/g)) {
    out.push(`<${name}`);
    for (const [, key, value] of attributes.matchAll(/([\w:-]+)="([^"]*)"/g)) {
      if (skipped.has(key)) continue;
      out.push(key);
      if (geometry.has(key)) out.push(Number(value));
      else if (key === "d")
        for (const part of value.match(/[A-Za-z]|-?[\d.]+(?:e-?\d+)?/g) ?? [])
          out.push(/[A-Za-z]/.test(part) ? part : Number(part));
      else out.push(value);
    }
  }
  return out;
}
// The largest gap between corresponding page numbers of two drawings,
// which must otherwise agree element by element.
function pageGap(a: string, b: string, label: string) {
  const x = tokens(a),
    y = tokens(b);
  expect(y.length, `${label}: tokens`).toBe(x.length);
  let gap = 0;
  x.forEach((u, i) => {
    const v = y[i];
    if (typeof u === "number" && typeof v === "number") {
      if (Number.isNaN(u)) expect(v, `${label}: token ${i}`).toBeNaN();
      else gap = Math.max(gap, Math.abs(u - v));
    } else if (u !== v)
      throw new Error(
        `${label}: token ${i} is ${String(v)}, want ${String(u)} (${x
          .slice(Math.max(0, i - 6), i + 2)
          .join(" ")})`,
      );
  });
  expect(x.length, label).toBeGreaterThan(20);
  return gap;
}

for (const [index, preset] of presets.entries())
  test(`${preset.title} draws alike at any scale and position`, () => {
    const studies = [
      study(preset.config, { diagnostics: true }),
      study(preset.config, { adaptive: true, adaptiveFrame: true }),
    ];
    for (const [k, original] of studies.entries())
      for (const m of copies) {
        if (m.c.x !== 0 && !translatable(original.config)) continue;
        const copy = mapStudy(original.config, original.result, m);
        // Fitted, and zoomed in all the way beside the middle.
        for (const camera of [undefined, { x: 140, y: -90, zoom: viewZoom }]) {
          const label = `${index} ${preset.title} (${k ? "refined" : "probed"}, ${m.name}${camera ? ", zoomed" : ""})`;
          const gap = pageGap(
            draw({ ...original, camera }),
            draw({ ...copy, camera }),
            label,
          );
          expect(gap, label).toBeLessThanOrEqual(tolerance);
        }
      }
  });

// The indices of a family's points that frame the drawing.
const framed = (points: Vec[]) => {
  const kept = new Set(framingPoints(points));
  return points.flatMap((p, i) => (kept.has(p) ? [i] : []));
};
const image = (points: Vec[], m: Similarity) =>
  points.map((p) => ({ x: m.s * p.x + m.c.x, y: m.s * p.y + m.c.y }));
const unit: Similarity = { name: "unit", s: 1, c: { x: 0, y: 0 } };

test("a family that hardly spreads along an axis is fenced a fifth of its size apart there", () => {
  // A line 3 long, its interquartile range 1.5: its size is the power of
  // two below, 1, so it is fenced 0.6 beyond its quartiles across it. A
  // point 0.5 off it is kept, one 0.7 off is not, at every scale and
  // position.
  const line = Array.from({ length: 31 }, (_, i) => ({ x: i / 10, y: 0 }));
  const points = [...line, { x: 1.5, y: 0.5 }, { x: 1.5, y: 0.7 }];
  for (const m of [unit, ...copies])
    expect(framed(image(points, m)), m.name).toEqual(
      Array.from({ length: 32 }, (_, i) => i),
    );
});

test("a family mostly at one point is measured by its full range", () => {
  // Twelve points at one place and a tail 2 long: no interquartile range,
  // so its size is the power of two at or below its range, 2, and points
  // within 1.2 of the place are kept.
  const points = [
    ...Array.from({ length: 12 }, () => ({ x: 5, y: 5 })),
    ...[1, 2, 3, 4].map((k) => ({ x: 5 + 0.5 * k, y: 5 })),
  ];
  for (const m of [unit, ...copies])
    expect(framed(image(points, m)), m.name).toEqual(
      Array.from({ length: 14 }, (_, i) => i),
    );
});

test("a family collapsed to a point within rounding is measured by its magnitude", () => {
  // A point near (3, 3), spread only by rounding, is measured as 3 is, by
  // 2, and fenced 1.2 beyond: a point 1 off it is kept, one 1.5 off is
  // not, at any power-of-two scale. Its size depends on where it lies.
  const points = [
    ...Array.from({ length: 12 }, (_, k) => ({
      x: 3 + k * 2 ** -50,
      y: 3 - k * 2 ** -50,
    })),
    { x: 4, y: 3 },
    { x: 4.5, y: 3 },
  ];
  for (const m of [unit, ...copies.filter((m) => m.c.x === 0)])
    expect(framed(image(points, m)), m.name).toEqual(
      Array.from({ length: 13 }, (_, i) => i),
    );
});

test("a drawing that is a point is framed 0.1 across about it, wherever it is", () => {
  const empty: Result = {
    base: [],
    derived: [],
    virtual: [],
    rays: [],
    family: [],
    circles: [],
    rolling: [],
    warnings: [],
    invalid: 0,
  };
  const config = presets[0].config;
  for (const m of [unit, ...copies]) {
    const p = { x: m.s * 0.75 + m.c.x, y: m.s * -0.5 + m.c.y };
    // A point exactly, and within rounding of one.
    for (const q of [p, { x: p.x * (1 + 2 ** -50), y: p.y }]) {
      const frame = fitFrame(
        { ...empty, base: Array.from({ length: 9 }, (_, i) => (i ? q : p)) },
        config,
      );
      expect(frame.span, m.name).toBe(0.1);
      expect(frame.scale, m.name).toBeCloseTo((760 * 0.78) / 0.1, 6);
    }
  }
  // A short horizontal line is framed by its length alone.
  for (const m of [unit, ...copies]) {
    const line = image(
      Array.from({ length: 9 }, (_, i) => ({ x: i / 8, y: 0 })),
      m,
    );
    const frame = fitFrame({ ...empty, base: line }, config);
    expect(frame.span, m.name).toBe(m.s);
    expect(frame.scale * m.s, m.name).toBeCloseTo(1000 * 0.78, 6);
  }
});

test("the grid is a grid at any scale and position", () => {
  const original = study(presets[0].config);
  const W = 1000;
  for (const m of copies)
    for (const camera of [undefined, { x: 140, y: -90, zoom: viewZoom }]) {
      const label = `${m.name}${camera ? ", zoomed" : ""}`;
      const svg = draw({
        ...mapStudy(original.config, original.result, m),
        camera,
        axes: true,
      });
      const scale = Number(svg.match(/data-camera-scale="([^"]+)"/)![1]);
      const [cx] = svg
        .match(/data-camera-center="([^"]+)"/)![1]
        .split(",")
        .map(Number);
      // The light theme's grid ink.
      const xs = [
        ...svg.matchAll(
          /<line x1="([^"]+)"[^>]*x2="([^"]+)"[^>]*stroke="#e8e5dd"/g,
        ),
      ]
        .filter(([, a, b]) => a === b)
        .map(([, a]) => Number(a));
      expect(xs.length, label).toBeGreaterThan(4);
      const gaps = xs.slice(1).map((x, i) => x - xs[i]);
      const decade = Math.log10(gaps[0] / scale);
      // A power of ten, a fiftieth to a fifth of the span apart (at most
      // 160 page units), evenly.
      expect(Math.abs(decade - Math.round(decade)), label).toBeLessThan(1e-9);
      const step = 10 ** Math.round(decade);
      expect(gaps[0], label).toBeGreaterThan(5);
      expect(gaps[0], label).toBeLessThan(160);
      for (const gap of gaps)
        expect(Math.abs(gap - gaps[0]), label).toBeLessThan(tolerance);
      // Each at a multiple of the step.
      for (const x of xs) {
        const k = (cx + (x - W / 2) / scale) / step;
        expect(Math.abs(k - Math.round(k)), label).toBeLessThan(1e-3);
      }
    }
});
