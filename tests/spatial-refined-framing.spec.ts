import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import { test, expect, type Page } from "@playwright/test";
import { choosePreset } from "./helpers";
import { curveMesh } from "./curve-mesh";
import { fitBounds, fitFamilies, reveal } from "../web/spatial/animation";
import { spatialPresets } from "../web/spatial/presets";
import { restore } from "../web/lifted";
import { camera, project } from "../web/spatial/scene";
import type { View } from "../web/spatial/renderer";
import type {
  RefinedPath,
  SpatialConfig,
  SpatialResult,
  Vec3,
} from "../web/spatial/types";

// Framing by the points between samples in the 3D notebook: with
// adaptiveFrame, Go reports each refined curve's reach (engine3/refine.go)
// and fits the bounds to it within each family's fences (engine3/curve.go,
// fitReach); a reveal fits the same, up to what it has reached.

const dandelion = { label: "A dandelion clock" };

const v = (x: number, y = 0, z = 0): Vec3 => ({ x, y, z });
// A refined path with nothing between samples but its reach.
const reached = (reach: Vec3[], reachAt: number[]): RefinedPath => ({
  points: [],
  at: [],
  tolerance: 1e-4,
  inserted: 0,
  breaks: 0,
  unresolved: 0,
  exhausted: false,
  reach,
  reachAt,
});
// 101 samples along the x axis from 0 to 1, with a tangent ribbon a unit
// above and below.
const line = Array.from({ length: 101 }, (_, i) => v(i / 100));
function study(adaptive?: SpatialResult["adaptive"]): SpatialResult {
  return {
    base: line,
    minus: line.map((p) => v(p.x, -1)),
    plus: line.map((p) => v(p.x, 1)),
    breaks: line.map(() => false),
    mesh: curveMesh(),
    rulings: [],
    bounds: fitBounds(
      line,
      line.map((p) => v(p.x, -1)),
      line.map((p) => v(p.x, 1)),
    ),
    radius: 0,
    omitted: 0,
    invalid: 0,
    adaptive,
  };
}

test("a family's reach joins it within the fences its samples set", () => {
  const plain = fitBounds(line);
  expect(fitFamilies([{ points: line }])).toEqual(plain);
  // The samples span x from 0 to 1, so their fence runs from −1.25 to
  // 2.25; y and z have no spread, so no fence.
  const near = fitFamilies([{ points: line, reach: [v(2, 0, 3), v(0.5)] }]);
  expect(near.center).toEqual(v(1, 0, 1.5));
  expect(near.radius).toBeCloseTo(Math.hypot(1, 1.5), 12);
  expect(fitFamilies([{ points: line, reach: [v(3)] }])).toEqual(plain);
  // A family of fewer than eight samples has no fence.
  const few = [v(0), v(1)];
  expect(fitFamilies([{ points: few, reach: [v(9)] }]).center).toEqual(v(4.5));
  // Each family's reach is judged by its own fence: a point within the
  // second family's but beyond the first's joins only the second.
  const wide = line.map((p) => v(10 * p.x, 5));
  const far = v(-5, 5);
  expect(
    fitFamilies([
      { points: line, reach: [far] },
      { points: wide, reach: [] },
    ]),
  ).toEqual(fitBounds(line, wide));
  expect(
    fitFamilies([
      { points: line, reach: [] },
      { points: wide, reach: [far] },
    ]).center,
  ).toEqual(v(2.5, 2.5));
});

test("a reveal frames each refined curve's reach as far as it has reached", () => {
  // The base reaches half a unit beyond x = 0 a tenth of the way along,
  // within the fence of the half revealed, which runs from −0.625, and the
  // ribbon's upper edge a unit above y = 1 nine tenths of the way along.
  const full = study({
    base: reached([v(-0.5)], [10.5]),
    plus: reached([v(0.9, 2)], [90.5]),
  });
  const half = reveal(full, 0.5);
  expect(half.adaptive!.base!.reach).toEqual([v(-0.5)]);
  expect(half.adaptive!.plus!.reach).toEqual([]);
  expect(half.bounds.center.x).toBeCloseTo(0, 12);
  expect(half.bounds.center.y).toBe(0);
  const all = reveal(full, 1);
  expect(all.bounds.center.x).toBeCloseTo(0.25, 12);
  expect(all.bounds.center.y).toBeCloseTo(0.5, 12);
  // A ruled surface's partner thread is its upper edge.
  const ruled = study({ partner: reached([v(0.9, 2)], [90.5]) });
  expect(reveal(ruled, 1).bounds.center.y).toBeCloseTo(0.5, 12);
  // Without a reach, a reveal frames its samples alone, as before.
  expect(reveal(study(), 1).bounds).toEqual(study().bounds);
});

// The real engine, run here as the worker runs it (built by `make build`).
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
function computed(config: SpatialConfig): SpatialResult {
  const reply = spatial(JSON.stringify(config));
  expect(typeof reply).toBe("object");
  const result = restore(JSON.parse(reply.json), reply.lifted);
  result.mesh = reply.mesh;
  return result;
}
// Every refined curve of a result, by name.
const paths = (a: NonNullable<SpatialResult["adaptive"]>) =>
  [
    a.base,
    a.parent,
    a.projection,
    a.image,
    a.partner,
    a.minus,
    a.plus,
    ...(a.involute ?? []),
    ...(a.strands ?? []),
    ...(a.meridians ?? []),
  ].filter((p): p is RefinedPath => !!p);

// The studies engine3/reach_test.go frames: a helix with a bump of height 1
// in z, 0.004 wide in t, 0.3 of a step past sample 100 of 240, under each
// construction that refines a curve of its own.
const helix: SpatialConfig = {
  ...spatialPresets[0].config,
  format: "parametric",
  construction: "none",
  samples: 240,
  adaptive: true,
  adaptiveFrame: true,
  curve: {
    x: "cos(t)",
    y: "sin(t)",
    z: "0.2*t + exp(-((t-a)/0.004)^2)",
    a: -Math.PI + (100.3 * 2 * Math.PI) / 240,
    min: -Math.PI,
    max: Math.PI,
  },
};
const constructions: Record<string, SpatialConfig> = {
  framed: {
    ...helix,
    construction: "framed",
    frame: { ...helix.frame, strands: 2, offset: 0.4, width: 0.3 },
    adaptiveSurface: true,
  },
  ruled: {
    ...helix,
    construction: "ruled",
    ruled: {
      partner: "thread",
      rate: 1,
      shift: 0,
      thread: {
        x: "2.4*cos(t)",
        y: "2.4*sin(t)",
        z: "1.6 + exp(-((t + pi - 100.25*pi/120)/0.001)^2)",
      },
    },
  },
  canal: {
    ...helix,
    construction: "canal",
    canal: { radius: 0.2, profile: "1", meridians: 3 },
  },
  involute: {
    ...helix,
    construction: "involute",
    involute: {
      anchor: Math.PI,
      offset: 0,
      family: { enabled: true, from: -1, to: 1, count: 3 },
    },
  },
  inversion: {
    ...helix,
    construction: "inversion",
    inversion: { center: v(0.3, -0.2, 0.5), radius: 1.7, input: "base" },
  },
  projection: { ...helix, construction: "orthotomic", pole: v(2, 2, 0) },
  composed: {
    ...helix,
    construction: "developable",
    length: 0.3,
    input: "tangent-foot",
    pole: v(0.2, 0.1, 0.3),
  },
};

test("a whole reveal frames each construction's reach as Go does", () => {
  for (const [name, config] of Object.entries(constructions)) {
    const result = computed(config);
    const reach = paths(result.adaptive!);
    expect(
      reach.some((p) => p.reach?.length),
      name,
    ).toBe(true);
    const revealed = reveal(result, 1).bounds;
    expect(revealed.radius, name).toBeCloseTo(result.bounds.radius, 12);
    for (const axis of ["x", "y", "z"] as const)
      expect(revealed.center[axis], name).toBeCloseTo(
        result.bounds.center[axis],
        12,
      );
    // Each family's reach decides the bounds: without the construction's
    // own, the reveal frames less.
    const withoutOwn = structuredClone(result);
    const base = withoutOwn.adaptive!.base;
    for (const p of paths(withoutOwn.adaptive!)) if (p !== base) delete p.reach;
    expect(reveal(withoutOwn, 1).bounds, name).not.toEqual(revealed);
  }
});

const stage = (page: Page) => page.locator(".spatial-stage");
const canvas = (page: Page) => page.locator("#spatial-artwork");
const settled = (page: Page) =>
  expect(stage(page)).toHaveAttribute("aria-busy", "false", {
    timeout: 20_000,
  });
const frameCheck = (page: Page) =>
  page.getByRole("checkbox", { name: "Frame the points between samples" });
async function shown(page: Page): Promise<View> {
  return JSON.parse((await canvas(page).getAttribute("data-view"))!);
}
async function size(page: Page) {
  return canvas(page).evaluate((c: HTMLCanvasElement) => ({
    width: c.clientWidth,
    height: c.clientHeight,
  }));
}
// The preset's sixty seeds: radius 1 + 1.2·exp(−1200(1 − cos(60t − π/10)))
// on a spiral turning seven times from pole to pole, each tip at
// t = (2πj + π/10)/60, a quarter of a step past a sample, at radius 2.2.
const tips = Array.from({ length: 60 }, (_, j) => {
  const t = (2 * Math.PI * j + Math.PI / 10) / 60;
  return v(
    2.2 * Math.sin(t / 2) * Math.cos(7 * t),
    2.2 * Math.sin(t / 2) * Math.sin(7 * t),
    2.2 * Math.cos(t / 2),
  );
});
async function tipsOnPage(page: Page) {
  const s = await size(page);
  const k = camera(await shown(page), s);
  return tips.filter((tip) => {
    const p = project(k, tip);
    return p.x >= 0 && p.x <= s.width && p.y >= 0 && p.y <= s.height;
  }).length;
}

test("the dandelion's seeds, found between samples, are framed whole, and only with the setting", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await settled(page);
  await choosePreset(page, dandelion);
  await settled(page);
  const details = page.locator(
    'details:has(> summary:text-is("Sampling & definition"))',
  );
  if ((await details.getAttribute("open")) === null)
    await details.locator(":scope > summary").click();
  await expect(frameCheck(page)).toBeChecked();
  const framed = await shown(page);
  // The seeds reach 2.2 from the center, the samples only about 1.
  expect(framed.radius).toBeGreaterThan(2.2);
  expect(framed.radius).toBeLessThan(2.3);
  expect(await tipsOnPage(page)).toBe(60);
  await frameCheck(page).uncheck();
  await settled(page);
  const samplesOnly = await shown(page);
  expect(samplesOnly.radius).toBeLessThan(1.05);
  // The samples alone frame the sphere, and leave about half the tips off
  // the page (32 of 60 at this page's size).
  expect(await tipsOnPage(page)).toBeLessThan(40);
  // Turned back on, it frames exactly as it did.
  await frameCheck(page).check();
  await settled(page);
  expect(await shown(page)).toEqual(framed);
});
