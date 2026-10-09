import {
  applyTracks,
  availableTargets,
  reveal,
  targetLabel,
} from "../web/spatial/animation";
import { spatialPresets } from "../web/spatial/presets";
import { surfaceDefaults } from "../web/spatial/surface";
import type {
  FocalSheet,
  SpatialResult,
  SurfaceSheet,
  Vec3,
} from "../web/spatial/types";
import { test, expect, type Page } from "@playwright/test";
import { choosePreset } from "./helpers";
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
    "72 × 24 cells · 13 parameter curves",
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
    "1,825 offset samples lie beyond one focal sheet",
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
    "110 samples are chart singularities, where X_u × X_v vanishes",
  );
  await expect(note(page)).toContainText("1,925 samples are umbilics");

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
  // A plane has no centres of curvature at all.
  await page.getByLabel("Surface", { exact: true }).selectOption("paraboloid");
  await field(page, "Curvature k₁").fill("0");
  await field(page, "Curvature k₂").fill("0");
  await settled(page);
  await expect(note(page)).toContainText(
    "Focal sheet 1 (κ₁) lies wholly at infinity. Focal sheet 2 (κ₂) lies wholly at infinity.",
  );
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
