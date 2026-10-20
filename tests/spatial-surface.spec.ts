import {
  applyTracks,
  availableTargets,
  reveal,
  targetLabel,
} from "../web/spatial/animation";
import { spatialPresets } from "../web/spatial/presets";
import { surfaceDefaults } from "../web/spatial/surface";
import {
  buildScene,
  defaultLayers,
  sceneLayers,
  scenePasses,
} from "../web/spatial/scene";
import type {
  CuspidalEdge,
  FocalSheet,
  SpatialResult,
  SurfaceSheet,
  Vec3,
} from "../web/spatial/types";
import { test, expect, type Page } from "@playwright/test";
import { chooseColorScheme, choosePreset } from "./helpers";
import { readFile } from "node:fs/promises";
import { probe, decodeVideo } from "./video";
import { curveMesh } from "./curve-mesh";
const stage = (page: Page) => page.locator(".spatial-stage");
const field = (page: Page, name: string) =>
  page.getByRole("textbox", { name, exact: true });
async function ready(page: Page) {
  await page.goto("/?study=3d");
  await expect(page.locator("#spatial-artwork")).toBeVisible();
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
}
async function settled(page: Page) {
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
}
async function config(page: Page) {
  const text = await stage(page).getAttribute("data-config");
  return text ? JSON.parse(text) : undefined;
}
const pixels = (page: Page) =>
  page
    .locator("#spatial-artwork")
    .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
async function openAnimation(page: Page) {
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
}
const torus = "30",
  sphere = "31",
  ellipsoid = "32",
  cylinder = "33";
const note = (page: Page) => page.getByTestId("surface-note");
// The far half of the ellipsoid (1.5, 1, 0.7), preset 32: the half
// meridian x = 0 and the arc of y = 0 round the end of the long axis
// between umbilics (κ₁), and the arcs of y = 0 from the umbilics to the
// poles and the half equator (κ₂), none closed in the half.
const RIDGES_NOTE =
  "The patch has 5 ridges (2 of κ₁, 3 of κ₂), over which its focal sheets fold in cuspidal edges.";
const layer = (page: Page, name: string) =>
  page.getByRole("checkbox", { name, exact: true });
const count = (page: Page, name: string) =>
  page.getByRole("spinbutton", { name, exact: true });

test("a surface study has its own controls, layers and validated fields", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, torus);
  await settled(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "A surface and its centers of curvature",
  );
  await expect(page.getByLabel("Spatial definition")).toHaveValue("surface");
  // No curve construction applies to a surface.
  await expect(page.getByLabel("Construction", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Curve samples")).toHaveCount(0);
  await expect(page.locator(".legend")).toContainText(
    "Surface Focal sheet 1 Focal sheet 2",
  );
  await expect(page.locator(".spatial-status")).toHaveText(
    "216 × 24 cells · 13 parameter curves",
  );
  const original = await pixels(page);
  for (const name of [
    "Surface patch",
    "Parameter curves",
    "Normal lines",
    "Focal sheet 1 · κ₁",
    "Focal sheet 2 · κ₂",
  ]) {
    await layer(page, name).uncheck();
    expect(await pixels(page)).not.toBe(original);
    await layer(page, name).check();
    expect(await pixels(page)).toBe(original);
  }
  for (const [name, text, message] of [
    ["Minor radius r", "0", "minor radius"],
    ["Major radius R", "-1", "major radius"],
    ["u to", "0", "u domain"],
    ["v from", "2", "v domain"],
    ["Offset d", "2e5", "offset distance"],
    ["Normal reach ℓ", "-2e5", "normal reach"],
    ["v to", "t", "t is not allowed"],
  ] as const) {
    const before = await field(page, name).inputValue();
    await field(page, name).fill(text);
    await expect(page.getByRole("alert")).toContainText(message);
    await field(page, name).fill(before);
    await settled(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  await page.locator(".spatial-details > summary").last().click();
  for (const [name, text, message] of [
    ["u samples", "11", "12–240 samples"],
    ["v samples", "240", "at most 14,400 cells"],
    ["Parameter curves", "1", "parameter curves"],
    ["u samples", "12.5", "whole numbers"],
  ] as const) {
    const before = await count(page, name).inputValue();
    await count(page, name).fill(text);
    await expect(page.getByRole("alert")).toContainText(message);
    await count(page, name).fill(before);
    await settled(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  // Choosing a kind starts from its own shape and whole chart, with its own
  // fields, and keeps the grid, offset and reach.
  await page.getByLabel("Surface", { exact: true }).selectOption("ellipsoid");
  await settled(page);
  const study = (await config(page)).surface;
  expect(study).toEqual({
    ...spatialPresets[+torus].config.surface,
    kind: "ellipsoid",
    ...surfaceDefaults.ellipsoid,
  });
  await expect(field(page, "Axis c")).toHaveValue("0.7");
  await expect(field(page, "Minor radius r")).toHaveCount(0);
  // Returning to a curve keeps the surface for later.
  await page
    .getByLabel("Spatial definition", { exact: true })
    .selectOption("torus");
  await settled(page);
  await expect(page.getByLabel("Construction", { exact: true })).toBeVisible();
  expect((await config(page)).surface).toEqual(study);
});

test("notes report focal shapes, chart singularities, umbilics and folds", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, torus);
  await settled(page);
  await expect(note(page)).toHaveText(
    "Focal sheet 1 (κ₁) collapses to a curve. Focal sheet 2 (κ₂) collapses to a curve.",
  );
  // An offset past the core circle turns inside out everywhere.
  await field(page, "Offset d").fill("-1.2");
  await settled(page);
  await expect(note(page)).toContainText(
    "5,425 offset samples lie beyond one focal sheet",
  );
  const folded = await pixels(page);
  await layer(page, "Offset surface").uncheck();
  expect(await pixels(page)).not.toBe(folded);

  await choosePreset(page, sphere);
  await settled(page);
  await expect(note(page)).toContainText(
    "Focal sheet 1 (κ₁) collapses to a point. Focal sheet 2 (κ₂) collapses to a point.",
  );
  await expect(note(page)).toContainText(
    "434 samples are chart singularities, where X_u × X_v vanishes",
  );
  await expect(note(page)).toContainText("7,595 samples are umbilics");

  await choosePreset(page, cylinder);
  await settled(page);
  await expect(note(page)).toHaveText(
    "Focal sheet 1 (κ₁) lies wholly at infinity. Focal sheet 2 (κ₂) is a surface.",
  );
  // Reversing the normal swaps the sheets' numbers, not the geometry.
  const forward = await pixels(page);
  await page.getByLabel("Normal", { exact: true }).selectOption("reverse");
  await settled(page);
  await expect(note(page)).toHaveText(
    "Focal sheet 1 (κ₁) is a surface. Focal sheet 2 (κ₂) lies wholly at infinity.",
  );
  expect(await pixels(page)).not.toBe(forward);
  // A plane has no centers of curvature at all.
  await page.getByLabel("Surface", { exact: true }).selectOption("paraboloid");
  await field(page, "Curvature k₁").fill("0");
  await field(page, "Curvature k₂").fill("0");
  await settled(page);
  await expect(note(page)).toContainText(
    "Focal sheet 1 (κ₁) lies wholly at infinity. Focal sheet 2 (κ₂) lies wholly at infinity.",
  );
});

// The far half of the ellipsoid (1.5, 1, 0.7), offset inward by 0.6. Its
// larger curvature, against the outward normal, runs from a/c² ≈ 3.06 at
// the end of the long axis to b/c² ≈ 2.04 at the end of the middle one, all
// above 1/0.6 along the equator, so the offset meets the second focal sheet
// in two edges, north and south of the equator, each running the half's
// whole width.
test("an offset's cuspidal edges are located on request, drawn and named", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, ellipsoid);
  await settled(page);
  const check = page.getByRole("checkbox", {
    name: "Locate cuspidal edges",
    exact: true,
  });
  // A hidden legend entry keeps its place, out of sight.
  const named = page.locator('.legend [data-legend="cusps"]:not(.legend-off)');
  // An offset of 0 offers nothing to locate.
  await field(page, "Offset d").fill("0");
  await settled(page);
  await expect(check).toHaveCount(0);
  await field(page, "Offset d").fill("-0.6");
  await settled(page);
  await expect(check).not.toBeChecked();
  await expect(note(page)).not.toContainText("cuspidal");
  await expect(named).toHaveCount(0);
  await expect(layer(page, "Cuspidal edges")).toHaveCount(0);
  const before = await pixels(page);
  await check.check();
  await settled(page);
  expect((await config(page)).surface.edges).toBe(true);
  await expect(note(page)).toContainText(
    "The offset folds along 2 cuspidal edges (2 on focal sheet 2), where it touches the focal sheet.",
  );
  await expect(named).toHaveText("Cuspidal edges");
  await expect(
    page.locator(".bottom-note", { hasText: "normals at the crossings" }),
  ).toContainText("Gold curves are the offset's cuspidal edges.");
  // The note names the edges' color in the scheme they are drawn in.
  await chooseColorScheme(page, "forest");
  await expect(
    page.locator(".bottom-note", { hasText: "normals at the crossings" }),
  ).toContainText("Berry curves are the offset's cuspidal edges.");
  await chooseColorScheme(page, "default");
  const located = await pixels(page);
  expect(located).not.toBe(before);
  // Hidden, they leave exactly the drawing they were added to.
  await layer(page, "Cuspidal edges").uncheck();
  expect(await pixels(page)).toBe(before);
  await expect(named).toHaveCount(0);
  await layer(page, "Cuspidal edges").check();
  expect(await pixels(page)).toBe(located);
  // Short of every radius of curvature there are none, and the legend
  // names none.
  await field(page, "Offset d").fill("-0.1");
  await settled(page);
  await expect(note(page)).toContainText(
    "The offset has no cuspidal edge: d is neither radius of curvature anywhere on the patch.",
  );
  await expect(named).toHaveCount(0);
  // Unchecked, the field is dropped, as in links made before it.
  await check.uncheck();
  await settled(page);
  expect("edges" in (await config(page)).surface).toBe(false);
  await expect(note(page)).not.toContainText("cuspidal");
});

// The preset plays its own sweep with the edges located: each frame is
// the study at its own d, with its own edges, which the frame draws and
// hiding their layer takes away. The note describes the preset's own study,
// four closed edges at d = −1.2, two on each focal sheet.
test("the cuspidal edges preset plays its sweep with its edges located", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, {
    label: "The cuspidal edges of a parallel surface",
  });
  await settled(page);
  expect((await config(page)).surface.edges).toBe(true);
  await expect(note(page)).toContainText(
    "The offset folds along 4 cuspidal edges (2 on focal sheet 1, 2 on focal sheet 2), each a closed curve",
  );
  await expect(
    page.locator(".legend .legend-entry:not(.legend-off)"),
  ).toHaveText(["Cuspidal edges"]);
  const opening = await pixels(page);
  await openAnimation(page);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(stage(page)).toHaveAttribute("data-mode", "parameters");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Animation progress" });
  const frames: string[] = [];
  // Out to d = −0.35 as the sweep turns back half way, then home.
  for (const [time, d] of [
    ["0.5", -0.35],
    ["0", -1.2],
  ] as const) {
    await slider.fill(time);
    await expect(stage(page)).toHaveAttribute("data-time", time);
    await settled(page);
    expect((await config(page)).surface).toMatchObject({
      offset: d,
      edges: true,
    });
    const drawn = await pixels(page);
    await layer(page, "Cuspidal edges").uncheck();
    expect(await pixels(page)).not.toBe(drawn);
    await layer(page, "Cuspidal edges").check();
    expect(await pixels(page)).toBe(drawn);
    frames.push(drawn);
  }
  expect(frames[0]).not.toBe(frames[1]);
  expect(frames[1]).toBe(opening);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await settled(page);
  expect((await config(page)).surface.offset).toBe(-1.2);
});

// The far half of the ellipsoid (1.5, 1, 0.7). Its ridges are the arcs of
// its principal sections in the half: the equator, the ellipse x = 0 split
// by the poles, and the ellipse y = 0 broken at its umbilics. Over each,
// its focal sheet folds in a gold cuspidal edge, and the ridge itself is
// drawn on the surface in that sheet's ink. Ridges need no offset; with
// the offset's edges located too, the note names both in gold.
test("a surface's ridges are located on request, drawn and named", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, ellipsoid);
  await settled(page);
  expect((await config(page)).surface.offset).toBe(0);
  const check = page.getByRole("checkbox", {
    name: "Locate ridges",
    exact: true,
  });
  const named = (name: string) =>
    page.locator(`.legend [data-legend="${name}"]:not(.legend-off)`);
  const explanation = page.locator(".bottom-note", {
    hasText: "normals at the crossings",
  });
  await expect(check).not.toBeChecked();
  await expect(note(page)).not.toContainText("ridge");
  await expect(named("ridges")).toHaveCount(0);
  await expect(layer(page, "Ridges")).toHaveCount(0);
  await expect(layer(page, "Cuspidal edges")).toHaveCount(0);
  const before = await pixels(page);
  await check.check();
  await settled(page);
  expect((await config(page)).surface.ridges).toBe(true);
  await expect(note(page)).toContainText(RIDGES_NOTE);
  await expect(named("ridges")).toHaveText("Ridges");
  await expect(named("cusps")).toHaveText("Cuspidal edges");
  await expect(explanation).toContainText(
    "Gold curves are the focal sheets' cuspidal edges. Each ridge, where a principal curvature is extremal along its own line of curvature, is drawn on the surface in its focal sheet's color.",
  );
  // The note names the edges' color in the scheme they are drawn in.
  await chooseColorScheme(page, "forest");
  await expect(explanation).toContainText(
    "Berry curves are the focal sheets' cuspidal edges.",
  );
  await chooseColorScheme(page, "default");
  const located = await pixels(page);
  expect(located).not.toBe(before);
  // Each layer draws something of its own; hidden together they leave
  // exactly the drawing they were added to.
  for (const name of ["Ridges", "Cuspidal edges"]) {
    await layer(page, name).uncheck();
    expect(await pixels(page)).not.toBe(located);
    await layer(page, name).check();
    expect(await pixels(page)).toBe(located);
  }
  await layer(page, "Ridges").uncheck();
  await layer(page, "Cuspidal edges").uncheck();
  expect(await pixels(page)).toBe(before);
  await expect(named("ridges")).toHaveCount(0);
  await layer(page, "Ridges").check();
  await layer(page, "Cuspidal edges").check();
  // With the offset's edges too, gold names both.
  await field(page, "Offset d").fill("-0.6");
  await settled(page);
  await page
    .getByRole("checkbox", { name: "Locate cuspidal edges", exact: true })
    .check();
  await settled(page);
  await expect(explanation).toContainText(
    "Gold curves are the offset's and the focal sheets' cuspidal edges.",
  );
  await expect(note(page)).toContainText(RIDGES_NOTE);
  // Unchecked, the field is dropped, as in links made before it, and the
  // offset's edges remain.
  await check.uncheck();
  await settled(page);
  expect("ridges" in (await config(page)).surface).toBe(false);
  await expect(note(page)).not.toContainText("ridge");
  await expect(explanation).toContainText(
    "Gold curves are the offset's cuspidal edges.",
  );
  await expect(layer(page, "Ridges")).toHaveCount(0);
});

// The preset plays its own sweep of b with its ridges located: each frame
// is the study at its own b, with its own ridges and edges, which the
// frame draws and hiding their layers takes away.
test("the ridges preset plays its sweep with its ridges located", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, { label: "The ridges of an ellipsoid" });
  await settled(page);
  expect((await config(page)).surface.ridges).toBe(true);
  await expect(note(page)).toContainText(
    "The patch has 9 ridges (4 of κ₁, 5 of κ₂), 1 closed, over which its focal sheets fold in cuspidal edges.",
  );
  const opening = await pixels(page);
  await openAnimation(page);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(stage(page)).toHaveAttribute("data-mode", "parameters");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Animation progress" });
  const frames: string[] = [];
  // Out to b = 0.85 as the sweep turns back half way, then home.
  for (const [time, b] of [
    ["0.5", 0.85],
    ["0", 1.25],
  ] as const) {
    await slider.fill(time);
    await expect(stage(page)).toHaveAttribute("data-time", time);
    await settled(page);
    expect((await config(page)).surface).toMatchObject({ b, ridges: true });
    const drawn = await pixels(page);
    for (const name of ["Ridges", "Cuspidal edges"]) {
      await layer(page, name).uncheck();
      expect(await pixels(page)).not.toBe(drawn);
      await layer(page, name).check();
      expect(await pixels(page)).toBe(drawn);
    }
    frames.push(drawn);
  }
  expect(frames[0]).not.toBe(frames[1]);
  expect(frames[1]).toBe(opening);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await settled(page);
  expect((await config(page)).surface.b).toBe(1.25);
});

test("surface reveal, pause, resume and edits invalidate stale playback", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, ellipsoid);
  await settled(page);
  const full = await pixels(page);
  await openAnimation(page);
  await page.getByLabel("Animate", { exact: true }).selectOption("reveal");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Animation progress" });
  await slider.fill("0.5");
  await expect(stage(page)).toHaveAttribute("data-progress", "0.5");
  await expect(page.locator("#spatial-playback .animation-values")).toHaveText(
    `u = ${((16 * Math.PI) / 10).toPrecision(6)}`,
  );
  const halfway = await pixels(page);
  expect(halfway).not.toBe(full);
  await slider.fill("1");
  await expect(stage(page)).toHaveAttribute("data-progress", "1");
  expect(await pixels(page)).toBe(full);
  await slider.fill("0.5");
  expect(await pixels(page)).toBe(halfway);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect
    .poll(async () => +(await stage(page).getAttribute("data-progress"))!)
    .toBeGreaterThan(0.5);
  await field(page, "Axis b").fill("1.2");
  await expect(stage(page)).not.toHaveAttribute("data-progress");
  await expect.poll(async () => (await config(page))?.surface?.b).toBe(1.2);
  // A replacement preset invalidates pending scalar work.
  await field(page, "Axis c").fill("pi/4");
  await choosePreset(page, ellipsoid);
  await settled(page);
  expect((await config(page)).surface).toEqual(
    spatialPresets[+ellipsoid].config.surface,
  );
});

for (const camera of ["hold", "current", "follow", "fit"])
  test(`surface playback reaches exact endpoints with the ${camera} camera`, async ({
    page,
  }) => {
    await ready(page);
    await choosePreset(page, sphere);
    await settled(page);
    const base = await config(page);
    await openAnimation(page);
    await page
      .getByLabel("Animate", { exact: true })
      .selectOption("parameters");
    await page
      .getByLabel("Parameter 1", { exact: true })
      .selectOption("surfaceA");
    await page.getByLabel("Track 1 from").fill("1/2");
    await page.getByLabel("Track 1 to").fill("e");
    await page
      .getByLabel("Animation camera", { exact: true })
      .selectOption(camera);
    await page.getByLabel("Duration (seconds)").fill("5");
    await page.locator("#spatial-artwork").focus();
    await page.keyboard.press("+");
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const slider = page.getByRole("slider", { name: "Animation progress" });
    const framing = async () =>
      JSON.parse((await stage(page).getAttribute("data-camera"))!);
    await slider.fill("0");
    await expect(stage(page)).toHaveAttribute("data-progress", "0");
    expect((await config(page)).surface.a).toBe(1 / 2);
    const first = await framing();
    await slider.fill("1");
    await expect(stage(page)).toHaveAttribute("data-progress", "1");
    expect((await config(page)).surface.a).toBe(Math.E);
    const last = await framing();
    if (camera === "hold" || camera === "current") expect(last).toEqual(first);
    if (camera === "follow") expect(last.radius).toBe(first.radius);
    if (camera === "fit") expect(last.radius).not.toBe(first.radius);
    expect(first.zoom).toBe(camera === "current" ? 1.1 : 1);
    await slider.fill("0.5");
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(stage(page)).not.toHaveAttribute("data-progress");
    expect(await config(page)).toEqual(base);
  });

test("a surface MP4 decodes with exact duration and a moving offset", async ({
  page,
}) => {
  test.slow();
  await ready(page);
  await choosePreset(page, sphere);
  await settled(page);
  await openAnimation(page);
  await page.getByLabel("Animate", { exact: true }).selectOption("parameters");
  await page
    .getByLabel("Parameter 1", { exact: true })
    .selectOption("surfaceOffset");
  await page.getByLabel("Track 1 from").fill("-0.2");
  await page.getByLabel("Track 1 to").fill("-1");
  await page
    .getByLabel("Animation camera", { exact: true })
    .selectOption("hold");
  await page.getByLabel("Duration (seconds)").fill("0.4");
  await page.locator("#spatial-export-settings > summary").click();
  await page.getByLabel("Export format", { exact: true }).selectOption("mp4");
  await page.getByLabel("Export frame rate").selectOption("15");
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("1");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export MP4/ }).click();
  const file = await download,
    path = (await file.path())!;
  const data = probe(path);
  if (data) {
    expect(data.frames).toBe(6);
    expect(data.durations.reduce((a, b) => a + b, 0)).toBe(400);
  }
  const video = await decodeVideo(page, await readFile(path));
  expect(video.duration).toBeCloseTo(0.4, 3);
  expect(video.first.hash).not.toBe(video.last.hash);
});

test("surface reveal grows every sheet along u with its edges and lines", () => {
  const at = (x: number, z = 0): Vec3 => ({ x, y: 0, z });
  // Three samples along u, two along v.
  const sheet = (z: number, points = true): SurfaceSheet => ({
    points: [0, 1, 2].map((i) => [at(i, z), points ? at(i, z + 1) : null]),
    normals: [0, 1, 2].map(() => [at(0, 1), null]),
    alongU: [
      [true, points],
      [true, points],
    ],
    alongV: [[points], [points], [points]],
    faces: [[points], [points]],
  });
  const focal = (z: number): FocalSheet => ({
    ...sheet(z, false),
    shape: "curve",
    clipped: 0,
  });
  const origin = at(0);
  const input: SpatialResult = {
    base: [],
    minus: [],
    plus: [],
    mesh: curveMesh(),
    rulings: [],
    breaks: [],
    bounds: { center: origin, radius: 40 },
    radius: 40,
    invalid: 0,
    omitted: 0,
    surface: {
      surface: sheet(0),
      offset: sheet(5),
      focal: [focal(-3), focal(40)],
      lines: [0, 1, 2].map((i) => ({
        i,
        j: 0,
        point: at(i),
        end: at(i, 2),
      })),
      uCurves: [0, 1],
      vCurves: [0, 2],
      singular: 0,
      umbilics: 0,
      folded: 0,
    },
  };
  const early = reveal(input, 0.5).surface!;
  expect(early.surface.points).toHaveLength(2);
  expect(early.surface.alongU).toHaveLength(1);
  expect(early.surface.alongV).toHaveLength(2);
  expect(early.surface.faces).toHaveLength(1);
  expect(early.offset!.points).toHaveLength(2);
  expect(early.focal.map((f) => [f.points.length, f.shape])).toEqual([
    [2, "curve"],
    [2, "curve"],
  ]);
  expect(early.lines.map((l) => l.i)).toEqual([0, 1]);
  expect(early.uCurves).toEqual([0, 1]);
  expect(reveal(input, 0).surface!.surface.faces).toEqual([]);
  // The whole reveal frames every sheet, as Go does.
  const whole = reveal(input, 1);
  expect(whole.surface).toEqual(input.surface);
  expect(whole.bounds.center.z).toBeCloseTo(18.5, 12);
  expect(input.surface!.surface.points).toHaveLength(3);
});

// An offset's cuspidal edges: a closed loop of four points about row 1 and
// an open edge across rows 0 to 2. Revealed through row 1 the loop, whose
// points all stand at or before it, stays closed; the open edge keeps its
// first two points, and an edge split at a row is no longer closed.
// A ridge is revealed as an edge is, its feet split with its points.
test("surface reveal grows a ridge's feet with its points", () => {
  const at = (x: number, z = 0): Vec3 => ({ x, y: 0, z });
  const ridge: CuspidalEdge = {
    branch: 2,
    closed: false,
    points: [at(0, 3), at(1, 3), at(2, 3)],
    i: [0, 1, 2],
    j: [1, 1, 1],
    feet: [at(0), at(1), at(2)],
  };
  const sheet: SurfaceSheet = {
    points: [0, 1, 2].map((i) => [at(i), at(i, 1)]),
    normals: [0, 1, 2].map(() => [null, null]),
    alongU: [
      [true, true],
      [true, true],
    ],
    alongV: [[true], [true], [true]],
    faces: [[true], [true]],
  };
  const input: SpatialResult = {
    base: [],
    minus: [],
    plus: [],
    mesh: curveMesh(),
    rulings: [],
    breaks: [],
    bounds: { center: at(0), radius: 4 },
    radius: 4,
    invalid: 0,
    omitted: 0,
    surface: {
      surface: sheet,
      offset: null,
      focal: [],
      lines: [],
      uCurves: [],
      vCurves: [],
      singular: 0,
      umbilics: 0,
      folded: 0,
      ridges: [ridge],
    },
  };
  const revealed = reveal(input, 0.5).surface!;
  expect(revealed.ridges).toEqual([
    {
      ...ridge,
      points: ridge.points.slice(0, 2),
      i: [0, 1],
      j: [1, 1],
      feet: [at(0), at(1)],
    },
  ]);
  expect("edges" in revealed).toBe(false);
  expect(reveal(input, 1).surface!.ridges).toEqual([ridge]);
});

test("surface reveal grows an offset's cuspidal edges along u", () => {
  const at = (x: number, z = 0): Vec3 => ({ x, y: 0, z });
  const loop: CuspidalEdge = {
    branch: 1,
    closed: true,
    points: [at(0.5), at(1, 1), at(0.5, 2), at(0, 1)],
    i: [0.5, 1, 0.5, 0],
    j: [0, 0.5, 1, 0.5],
  };
  const open: CuspidalEdge = {
    branch: 2,
    closed: false,
    points: [at(0, 3), at(1, 3), at(1.5, 3), at(2, 3)],
    i: [0, 1, 1.5, 2],
    j: [1, 1, 1, 1],
  };
  // A loop round row 1, split where it runs past row 1.
  const later: CuspidalEdge = {
    branch: 1,
    closed: true,
    points: [at(1.5, 1), at(1), at(0.5, 1), at(1, 2)],
    i: [1.5, 1, 0.5, 1],
    j: [0.5, 0, 0.5, 1],
  };
  const sheet: SurfaceSheet = {
    points: [0, 1, 2].map((i) => [at(i), at(i, 1)]),
    normals: [0, 1, 2].map(() => [null, null]),
    alongU: [
      [true, true],
      [true, true],
    ],
    alongV: [[true], [true], [true]],
    faces: [[true], [true]],
  };
  const input: SpatialResult = {
    base: [],
    minus: [],
    plus: [],
    mesh: curveMesh(),
    rulings: [],
    breaks: [],
    bounds: { center: at(0), radius: 4 },
    radius: 4,
    invalid: 0,
    omitted: 0,
    surface: {
      surface: sheet,
      offset: sheet,
      focal: [],
      lines: [],
      uCurves: [],
      vCurves: [],
      singular: 0,
      umbilics: 0,
      folded: 0,
      edges: [loop, open, later],
    },
  };
  const edges = reveal(input, 0.5).surface!.edges!;
  expect(edges[0]).toEqual(loop);
  expect(edges[1]).toEqual({
    ...open,
    points: open.points.slice(0, 2),
    i: [0, 1],
    j: [1, 1],
  });
  // The split loop runs on from its point past row 1, open.
  expect(edges[2]).toEqual({
    ...later,
    closed: false,
    points: later.points.slice(1),
    i: [1, 0.5, 1],
    j: [0, 0.5, 1],
  });
  expect(edges).toHaveLength(3);
  // Split in its middle, a loop runs on across its own start.
  const wrapped = reveal(
    {
      ...input,
      surface: {
        ...input.surface!,
        edges: [{ ...later, i: [1, 1.5, 0.5, 1] }],
      },
    },
    0.5,
  ).surface!.edges!;
  expect(wrapped.map((e) => [e.closed, e.i, e.points])).toEqual([
    [false, [0.5, 1, 1], [later.points[2], later.points[3], later.points[0]]],
  ]);
  // A run of a single point is no edge.
  const dot = reveal(
    {
      ...input,
      surface: {
        ...input.surface!,
        edges: [{ ...later, i: [1.5, 2, 1.5, 1] }],
      },
    },
    0.5,
  ).surface!.edges;
  expect(dot).toEqual([]);
  expect(reveal(input, 1).surface!.edges).toEqual([loop, open, later]);
  // A study without located edges reveals without them.
  const plain = structuredClone(input);
  delete plain.surface!.edges;
  expect("edges" in reveal(plain, 0.5).surface!).toBe(false);
});

// The edges' pass: each closed edge back to its start, in the curves' ink,
// and only when there are edges, so a study without them draws, and pushes
// its sheets back, exactly as before.
test("an offset's cuspidal edges draw in their own layer, closed loops closed", () => {
  const at = (x: number, y: number): Vec3 => ({ x, y, z: 0 });
  const result = (edges?: CuspidalEdge[]): SpatialResult => ({
    base: [],
    minus: [],
    plus: [],
    mesh: curveMesh(),
    rulings: [],
    breaks: [],
    bounds: { center: at(0, 0), radius: 1 },
    radius: 1,
    invalid: 0,
    omitted: 0,
    surface: {
      surface: { points: [], normals: [], alongU: [], alongV: [], faces: [] },
      offset: { points: [], normals: [], alongU: [], alongV: [], faces: [] },
      focal: [],
      lines: [],
      uCurves: [],
      vCurves: [],
      singular: 0,
      umbilics: 0,
      folded: 0,
      ...(edges && { edges }),
    },
  });
  const square = [at(0, 0), at(1, 0), at(1, 1), at(0, 1)];
  const edge = (closed: boolean): CuspidalEdge => ({
    branch: 1,
    closed,
    points: square,
    i: [0, 1, 1, 0],
    j: [0, 0, 1, 1],
  });
  const cusps = (r: SpatialResult, layers = defaultLayers) =>
    scenePasses(buildScene(r), layers).filter((p) => p.layer === "cusps");
  for (const r of [result(), result([])]) {
    expect(cusps(r)).toEqual([]);
    expect(sceneLayers(buildScene(r)).has("cusps")).toBe(false);
  }
  // Seven floats a vertex, two vertices a segment: three segments open,
  // four closed.
  const [open] = cusps(result([edge(false)])),
    [closed] = cusps(result([edge(true)]));
  expect([open.batch.ink, open.batch.mode, open.sheet]).toEqual([
    2,
    "lines",
    false,
  ]);
  expect(open.batch.data.length).toBe(3 * 2 * 7);
  expect(closed.batch.data.length).toBe(4 * 2 * 7);
  expect(Array.from(closed.batch.data.slice(-7, -4))).toEqual([0, 0, 0]);
  expect(
    cusps(result([edge(true)]), { ...defaultLayers, cusps: false }),
  ).toEqual([]);
  expect(sceneLayers(buildScene(result([edge(true)]))).has("cusps")).toBe(true);
});

// Ridges' passes: each ridge on the surface, through its feet, in its focal
// sheet's ink (rust 5 for κ₁, slate 6 for κ₂), and the sheets' cuspidal
// edges over them, through their points, in the edges' gold pass; none
// without ridges.
test("ridges draw on the surface in their sheet's ink, their edges in gold", () => {
  const at = (x: number, y: number, z = 0): Vec3 => ({ x, y, z });
  const result = (ridges?: CuspidalEdge[]): SpatialResult => ({
    base: [],
    minus: [],
    plus: [],
    mesh: curveMesh(),
    rulings: [],
    breaks: [],
    bounds: { center: at(0, 0), radius: 1 },
    radius: 1,
    invalid: 0,
    omitted: 0,
    surface: {
      surface: { points: [], normals: [], alongU: [], alongV: [], faces: [] },
      offset: null,
      focal: [],
      lines: [],
      uCurves: [],
      vCurves: [],
      singular: 0,
      umbilics: 0,
      folded: 0,
      ...(ridges && { ridges }),
    },
  });
  const ridge = (branch: 1 | 2, closed: boolean): CuspidalEdge => ({
    branch,
    closed,
    points: [at(0, 0, branch), at(1, 0, branch), at(1, 1, branch)],
    i: [0, 1, 1],
    j: [0, 0, 1],
    feet: [at(0, 0, -branch), at(1, 0, -branch), at(1, 1, -branch)],
  });
  const passes = (r: SpatialResult, layer: string, layers = defaultLayers) =>
    scenePasses(buildScene(r), layers).filter((p) => p.layer === layer);
  for (const r of [result(), result([])]) {
    expect(passes(r, "ridges")).toEqual([]);
    expect(passes(r, "cusps")).toEqual([]);
  }
  const r = result([ridge(1, false), ridge(2, true)]);
  const ridges = passes(r, "ridges");
  expect(ridges.map((p) => [p.batch.ink, p.batch.mode, p.sheet])).toEqual([
    [5, "lines", false],
    [6, "lines", false],
  ]);
  // Seven floats a vertex: z is the third, rebased on the bounds' center.
  const zs = (data: ArrayLike<number>) =>
    Array.from(data).filter((_, k) => k % 7 === 2);
  expect(ridges[0].batch.data.length).toBe(2 * 2 * 7);
  expect(new Set(zs(ridges[0].batch.data))).toEqual(new Set([-1]));
  expect(ridges[1].batch.data.length).toBe(3 * 2 * 7);
  expect(new Set(zs(ridges[1].batch.data))).toEqual(new Set([-2]));
  const [gold] = passes(r, "cusps");
  expect(gold.batch.ink).toBe(2);
  expect(gold.batch.data.length).toBe((2 + 3) * 2 * 7);
  expect(new Set(zs(gold.batch.data))).toEqual(new Set([1, 2]));
  expect(passes(r, "ridges", { ...defaultLayers, ridges: false })).toEqual([]);
  expect(sceneLayers(buildScene(r)).has("ridges")).toBe(true);
});

test("surface tracks move the shape, chart, offset, reach and grid only", () => {
  const base = structuredClone(spatialPresets[+sphere].config);
  expect(availableTargets(base)).toEqual([
    "surfaceA",
    "surfaceB",
    "surfaceC",
    "surfaceOffset",
    "reach",
    "uMin",
    "uMax",
    "vMin",
    "vMax",
    "uSamples",
    "vSamples",
    "curves",
  ]);
  expect(targetLabel(base, "surfaceA")).toBe("Axis a");
  expect(targetLabel(base, "reach")).toBe("Normal reach ℓ");
  expect(targetLabel(base, "curves")).toBe("Parameter curves");
  const ring = structuredClone(spatialPresets[+torus].config);
  expect(availableTargets(ring).slice(0, 3)).toEqual([
    "surfaceA",
    "surfaceB",
    "surfaceOffset",
  ]);
  expect(targetLabel(ring, "surfaceB")).toBe("Minor radius r");
  const tracks = [
    { target: "surfaceA", from: 1, to: 2 },
    { target: "surfaceOffset", from: 0, to: -1 },
    { target: "uMax", from: 3, to: 6 },
    { target: "uSamples", from: 12, to: 40 },
    { target: "curves", from: 2, to: 5 },
  ] as const;
  const middle = applyTracks(base, [...tracks], 0.55).config;
  expect(middle.surface.uSamples).toBe(Math.round(12 + 28 * 0.55));
  expect(middle.surface.curves).toBe(4);
  const end = applyTracks(base, [...tracks], 1).config;
  expect(end.surface).toEqual({
    ...base.surface,
    a: 2,
    offset: -1,
    uMax: 6,
    uSamples: 40,
    curves: 5,
  });
  expect(end.curve).toEqual(base.curve);
  expect(end.frame).toEqual(base.frame);
  expect(base.surface).toEqual(spatialPresets[+sphere].config.surface);
});
