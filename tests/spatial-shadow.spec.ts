import { test, expect, type Page } from "@playwright/test";
import { reveal } from "../web/spatial/animation";
import { buildScene, defaultLayers, scenePasses } from "../web/spatial/scene";
import { sheetOffset } from "../web/spatial/sight";
import { spatialPresets } from "../web/spatial/presets";
import { shadowAt } from "../web/spatial/shadow";
import type { SpatialResult, ShadowPath } from "../web/spatial/types";
import { chooseColorScheme, choosePreset } from "./helpers";

const stage = (page: Page) => page.locator(".spatial-stage");
const settled = (page: Page) =>
  expect(stage(page)).toHaveAttribute("aria-busy", "false");
async function config(page: Page) {
  const text = await stage(page).getAttribute("data-config");
  return text ? JSON.parse(text) : undefined;
}
const pixels = (page: Page) =>
  page
    .locator("#spatial-artwork")
    .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
const plane = (page: Page) => page.getByLabel("Shadow on", { exact: true });
const at = (page: Page) =>
  page.getByRole("textbox", { name: "Plane at c", exact: true });
const note = (page: Page) => page.getByTestId("shadow-note");
const layer = (page: Page, name: string) =>
  page.getByRole("checkbox", { name, exact: true });
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const shape = (page: Page) =>
  page.getByRole("textbox", { name: "Shape parameter a", exact: true });
async function open(page: Page, name: string) {
  await page.goto("/?study=3d");
  await settled(page);
  await choosePreset(page, { label: name });
  await settled(page);
}
async function openAnimation(page: Page) {
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
}
const staircase = "A staircase's shadow, unwinding",
  trefoil = "A trefoil's feet and their shadow",
  ring = "A rippling ring, inverted, and its shadow";

test("a plane casts the study's shadow beside its 2D construction, and taking it away restores the drawing", async ({
  page,
}) => {
  await open(page, "A knot through perpendiculars");
  const original = await pixels(page);
  const legend = page.locator(".legend");
  await expect(note(page)).toHaveCount(0);
  await expect(legend).not.toContainText("Shadow");
  await plane(page).selectOption("z");
  await settled(page);
  // Just below the knot, which reaches 0.85 below its middle.
  const { shadow } = await config(page);
  expect(shadow.plane).toBe("z");
  expect(shadow.at).toBeLessThan(-0.85);
  await expect(at(page)).toHaveValue(String(shadow.at));
  await expect(note(page)).toHaveText(
    /^The shadow of the 3D tangent-foot curve parts from the 2D pedal of the shadow, by up to \d+% of its size\. Rust is the 2D construction, slate the 3D one's shadow\.$/,
  );
  for (const entry of ["Shadow", "2D construction", "3D construction's shadow"])
    await expect(legend).toContainText(entry);
  const cast = await pixels(page);
  expect(cast).not.toBe(original);
  // Each of the shadow's layers draws something of its own.
  for (const name of [
    "Shadow & plane",
    "2D pedal of the shadow",
    "Shadow of the 3D tangent-foot curve",
  ]) {
    await layer(page, name).uncheck();
    expect(await pixels(page), name).not.toBe(cast);
    await layer(page, name).check();
    expect(await pixels(page)).toBe(cast);
  }
  // Moving the plane moves the drawing; a plane on another axis stands
  // just beyond the study on that axis.
  await at(page).fill("-6");
  await settled(page);
  expect((await config(page)).shadow).toEqual({ plane: "z", at: -6 });
  expect(await pixels(page)).not.toBe(cast);
  await plane(page).selectOption("x");
  await settled(page);
  const moved = (await config(page)).shadow;
  expect(moved.plane).toBe("x");
  expect(moved.at).toBeLessThan(-3.25);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await plane(page).selectOption("none");
  await settled(page);
  expect((await config(page)).shadow).toBeUndefined();
  await expect(note(page)).toHaveCount(0);
  await expect(at(page)).toHaveCount(0);
  await expect(legend).not.toContainText("Shadow");
  expect(await pixels(page)).toBe(original);
});

test("a flat curve's shadow reduces exactly, and a lifted one parts", async ({
  page,
}) => {
  for (const [name, own, planar] of [
    [staircase, "involutes", "involutes"],
    [ring, "sphere inversion", "circle inversion"],
  ] as const) {
    await open(page, name);
    await expect(note(page)).toContainText(
      `The shadow of the 3D ${own} parts from the 2D ${planar} of the shadow`,
    );
    await shape(page).fill("0");
    await settled(page);
    await expect(note(page)).toHaveText(
      new RegExp(
        `^The shadow of the 3D ${own} lies on the 2D ${planar} of the shadow, within \\d × 10⁻[⁰¹²³⁴⁵⁶⁷⁸⁹]+ of its size\\.`,
      ),
    );
    await shape(page).fill("0.05");
    await settled(page);
    await expect(note(page)).toContainText("parts from");
  }
});

test("a construction with no 2D counterpart casts the curve's shadow alone", async ({
  page,
}) => {
  await open(page, "Trefoil · (2, 3)");
  await plane(page).selectOption("y");
  await settled(page);
  await expect(note(page)).toHaveText(
    "This construction has no 2D counterpart; the plane shows the curve's shadow alone.",
  );
  await expect(layer(page, "Shadow & plane")).toBeChecked();
  await expect(page.locator(".shadow-layers input")).toHaveCount(1);
  await expect(page.locator(".legend")).not.toContainText("2D construction");
});

test("a surface study offers no shadow", async ({ page }) => {
  await open(page, "Through an ellipsoid's umbilic");
  await expect(plane(page)).toHaveCount(0);
});

test("the note names the colors of the chosen scheme", async ({ page }) => {
  await open(page, trefoil);
  await chooseColorScheme(page, "cobalt");
  await expect(note(page)).toContainText(
    "Violet is the 2D construction, ochre the 3D one's shadow.",
  );
});

test("each shadow example plays its own animation with the shadow on", async ({
  page,
}) => {
  // Three examples, each played and scrubbed.
  test.slow();
  for (const [name, target, start, end] of [
    [staircase, "a", "1.2", "0"],
    [trefoil, "poleZ", "2", "-2"],
    [ring, "a", "0.8", "0"],
  ] as const) {
    const preset = spatialPresets.find((p) => p.name === name)!;
    expect(preset.flight?.animate).toEqual({
      mode: "parameters",
      tracks: [{ target, from: start, to: end }],
    });
    expect(preset.flight?.repeat).toBe("back-and-forth");
    // The animation starts from the study the preset opens with.
    const opening =
      target === "a" ? preset.config.curve.a : preset.config.pole.z;
    expect(opening).toBe(Number(start));
    await open(page, name);
    const before = await config(page);
    expect(before.shadow).toBeDefined();
    await openAnimation(page);
    await button(page, "Play animation").click();
    await expect(stage(page)).toHaveAttribute("data-mode", "parameters");
    await button(page, "Pause").click();
    // Out to its end at the middle of the time, and back.
    for (const [time, holds] of [
      ["0.5", target === "a"],
      ["0", false],
    ] as const) {
      await page.getByRole("slider", { name: "Animation progress" }).fill(time);
      await expect(stage(page)).toHaveAttribute("data-time", time);
      await settled(page);
      await expect(note(page), `${name} at ${time}`).toContainText(
        holds ? "lies on" : "parts from",
      );
    }
    await button(page, "Stop").click();
    await settled(page);
    expect(await config(page)).toEqual(before);
  }
});

test("the shadow examples open on a plane clear of what casts it", () => {
  for (const name of [staircase, trefoil, ring]) {
    const shadow = spatialPresets.find((p) => p.name === name)!.config.shadow;
    expect(shadow, name).toBeDefined();
    // Each lies past the curve's own reach of 2 on its axis.
    expect(shadow!.at, name).toBeLessThan(-2);
  }
  expect(shadowAt("z", { center: { x: 0, y: 0, z: 1 }, radius: 2 })).toBe(-1.4);
  expect(shadowAt("x")).toBe(-3);
});

test("a reveal draws the shadow with the curve and keeps the plane whole", () => {
  const points = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ x: i, y: 0, z: -1 }));
  const path = (n: number): ShadowPath => ({
    points: points(n),
    breaks: Array(n).fill(false),
  });
  const corners = [
    { x: -1, y: -1, z: -1 },
    { x: 11, y: -1, z: -1 },
    { x: 11, y: 1, z: -1 },
    { x: -1, y: 1, z: -1 },
  ] as const;
  const result = {
    base: points(11).map((p) => ({ ...p, z: 1 })),
    minus: [],
    plus: [],
    breaks: Array(11).fill(false),
    mesh: {
      vertices: new Float64Array(),
      triangles: new Int32Array(),
      sampleIndex: new Int32Array(),
    },
    rulings: [],
    bounds: { center: { x: 5, y: 0, z: 0 }, radius: 6 },
    radius: 6,
    omitted: 0,
    invalid: 0,
    shadow: {
      plane: "z",
      at: -1,
      corners: [...corners],
      curve: path(11),
      kind: "pedal",
      planar: [path(11)],
      cast: [path(11)],
      compared: 11,
      size: 5,
      notes: [],
    },
  } as unknown as SpatialResult;
  // A study without a shadow has none of its passes, so the 2D
  // construction's broad stroke never pushes its sheets further back.
  const { shadow: _, ...plain } = result;
  const size = { width: 1000, height: 760 };
  const lines = (r: SpatialResult) =>
    scenePasses(buildScene(r), defaultLayers)
      .filter((p) => !p.sheet)
      .map((p) => p.batch);
  const passes = scenePasses(buildScene(plain as SpatialResult), defaultLayers);
  expect(
    passes.filter((p) => ["shadow", "planar", "cast"].includes(p.layer)),
  ).toHaveLength(0);
  expect(sheetOffset(lines(plain as SpatialResult), "regular", size)).toBe(
    1 + 2.2 / 2,
  );
  expect(sheetOffset(lines(result), "regular", size)).toBe(1 + 2.6 / 2);
  const half = reveal(result, 0.5).shadow!;
  expect(half.curve.points).toHaveLength(6);
  expect(half.curve.breaks).toHaveLength(6);
  expect(half.planar[0].points).toHaveLength(6);
  expect(half.cast[0].points).toHaveLength(6);
  expect(half.corners).toEqual(corners);
  expect(reveal(result, 0).bounds.radius).toBeGreaterThan(5.9);
});

test("a refined shadow is drawn from its points between samples, and revealed with the curve", () => {
  // Three samples on the plane z = −1, and each path refined with a point
  // off the chord between the last two, at 1.5 sample steps.
  const sampled = (): ShadowPath => ({
    points: [0, 1, 2].map((x) => ({ x, y: 0, z: -1 })),
    breaks: [false, false, false],
  });
  const refined = (k: number) => ({
    points: [0, 1, 1.5, 2].map((x) => ({ x, y: x === 1.5 ? k + 1 : 0, z: -1 })),
    at: [0, 1, 1.5, 2],
    tolerance: 0.001,
    inserted: 1,
    breaks: 0,
    unresolved: 0,
    exhausted: false,
  });
  const result = {
    base: [0, 1, 2].map((x) => ({ x, y: 0, z: 1 })),
    minus: [],
    plus: [],
    breaks: [false, false, false],
    mesh: {
      vertices: new Float64Array(),
      triangles: new Int32Array(),
      sampleIndex: new Int32Array(),
    },
    rulings: [],
    bounds: { center: { x: 1, y: 0, z: 0 }, radius: 3 },
    radius: 3,
    omitted: 0,
    invalid: 0,
    shadow: {
      plane: "z",
      at: -1,
      corners: [
        { x: -1, y: -1, z: -1 },
        { x: 3, y: -1, z: -1 },
        { x: 3, y: 4, z: -1 },
        { x: -1, y: 4, z: -1 },
      ],
      curve: sampled(),
      kind: "involute",
      planar: [sampled(), sampled()],
      cast: [sampled(), sampled()],
      compared: 3,
      size: 1,
      notes: [],
      adaptive: {
        curve: refined(0),
        planar: [refined(1), refined(2)],
        cast: [refined(3), refined(4)],
      },
    },
  } as unknown as SpatialResult;
  // Every refined point is drawn, joined in order: three segments a path.
  const ys = (data: Float32Array) =>
    new Set(Array.from(data).filter((_, i) => i % 7 === 1));
  const scene = buildScene(result);
  expect(scene.shadowCurve.data.length).toBe(3 * 2 * 7);
  expect(ys(scene.shadowCurve.data)).toEqual(new Set([0, 1]));
  expect(scene.planar.data.length).toBe(2 * 3 * 2 * 7);
  expect(ys(scene.planar.data)).toEqual(new Set([0, 2, 3]));
  expect(ys(scene.cast.data)).toEqual(new Set([0, 4, 5]));
  // Revealed through the first sample step, the point between the last
  // two is not yet drawn.
  const half = reveal(result, 0.5).shadow!.adaptive!;
  for (const p of [half.curve!, ...half.planar!, ...half.cast!])
    expect(p.at).toEqual([0, 1]);
});

test("refinement draws an edge-on shadow's swings between samples", async ({
  page,
}) => {
  await open(page, staircase);
  // A nearly flat helix, cast on a wall it is seen edge on from.
  await plane(page).selectOption("x");
  await settled(page);
  await shape(page).fill("0.0012");
  await settled(page);
  // The 2D involutes alone, beside the curve.
  for (const name of [
    "Involute filaments",
    "Unwinding strings",
    "Shadow & plane",
    "Shadow of the 3D involutes",
  ])
    await layer(page, name).uncheck();
  const sampled = await pixels(page);
  const sampling = page.locator("summary", {
    hasText: "Sampling & definition",
  });
  if ((await sampling.locator("..").getAttribute("open")) === null)
    await sampling.click();
  await layer(page, "Refine between samples").check();
  await settled(page);
  expect((await config(page)).adaptive).toBe(true);
  await expect(page.getByRole("alert")).toHaveCount(0);
  const refined = await pixels(page);
  expect(refined).not.toBe(sampled);
  // What changed is the plane's: without its 2D involutes, refining
  // changes nothing the samples did not already draw round.
  await layer(page, "2D involutes of the shadow").uncheck();
  const bare = await pixels(page);
  await layer(page, "Refine between samples").uncheck();
  await settled(page);
  expect(await pixels(page)).toBe(bare);
});
