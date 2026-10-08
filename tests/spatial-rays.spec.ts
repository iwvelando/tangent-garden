import {
  applyTracks,
  availableTargets,
  reveal,
  targetLabel,
} from "../web/spatial/animation";
import { spatialPresets } from "../web/spatial/presets";
import type {
  CausticSheet,
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
const dish = "34",
  coma = "35",
  bowl = "36",
  spheroid = "37",
  cup = "38";
const note = (page: Page) => page.getByTestId("rays-note");
const layer = (page: Page, name: string) =>
  page.getByRole("checkbox", { name, exact: true });

test("a mirror study has its own controls, layers and validated fields", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, coma);
  await settled(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "A mirror and its caustics",
  );
  await expect(page.getByLabel("Spatial definition")).toHaveValue("rays");
  // No curve construction, offset or normal line applies to a mirror.
  await expect(page.getByLabel("Construction", { exact: true })).toHaveCount(0);
  await expect(field(page, "Offset d")).toHaveCount(0);
  await expect(field(page, "Normal reach ℓ")).toHaveCount(0);
  await expect(page.getByTestId("surface-note")).toHaveCount(0);
  await expect(page.getByLabel("Mirror side", { exact: true })).toBeVisible();
  await expect(page.locator(".legend")).toContainText(
    "Mirror Reflected rays Caustic 1 Caustic 2",
  );
  await expect(page.locator(".spatial-status")).toHaveText(
    "96 × 96 cells · 9 parameter curves",
  );
  const original = await pixels(page);
  for (const name of [
    "Mirror",
    "Parameter curves",
    "Incident rays",
    "Reflected rays",
    "Caustic 1 · μ₁",
    "Caustic 2 · μ₂",
  ]) {
    await layer(page, name).uncheck();
    expect(await pixels(page)).not.toBe(original);
    await layer(page, name).check();
    expect(await pixels(page)).toBe(original);
  }
  // Both caustics are real here, so nothing is drawn behind the mirror.
  await layer(page, "Virtual rays & caustics").uncheck();
  expect(await pixels(page)).toBe(original);
  await layer(page, "Virtual rays & caustics").check();
  for (const [name, text, message] of [
    ["Azimuth α (°)", "1e6", "azimuth"],
    ["Elevation β (°)", "t", "t is not allowed"],
    ["Ray length ℓ", "-1", "ray length"],
    ["u to", "-2", "u domain"],
    ["Curvature k₁", "2e5", "curvatures"],
  ] as const) {
    const before = await field(page, name).inputValue();
    await field(page, name).fill(text);
    await expect(page.getByRole("alert")).toContainText(message);
    await field(page, name).fill(before);
    await settled(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  // A point source replaces the direction with its position.
  await page.getByLabel("Light", { exact: true }).selectOption("point");
  await settled(page);
  await expect(field(page, "Azimuth α (°)")).toHaveCount(0);
  await expect(layer(page, "Incident rays & source")).toBeVisible();
  await expect(field(page, "Source z")).toHaveValue("3");
  await field(page, "Source y").fill("2e5");
  await expect(page.getByRole("alert")).toContainText("source");
  await field(page, "Source y").fill("0");
  await settled(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  const lamp = await pixels(page);
  await layer(page, "Incident rays & source").uncheck();
  expect(await pixels(page)).not.toBe(lamp);
  await layer(page, "Incident rays & source").check();
  // The surface study and the mirror share the patch, and each keeps its
  // own settings.
  const study = await config(page);
  await page
    .getByLabel("Spatial definition", { exact: true })
    .selectOption("surface");
  await settled(page);
  await expect(field(page, "Offset d")).toBeVisible();
  await expect(page.getByLabel("Normal", { exact: true })).toBeVisible();
  expect((await config(page)).surface).toEqual(study.surface);
  await page
    .getByLabel("Spatial definition", { exact: true })
    .selectOption("rays");
  await settled(page);
  expect(await config(page)).toEqual(study);
});

test("notes report caustic shapes, virtual parts, and samples without a reflection", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, dish);
  await settled(page);
  await expect(note(page)).toHaveText(
    "Caustic 1 (μ₁) is real, ahead of the mirror: a point. Caustic 2 (μ₂) is real, ahead of the mirror: a point. 2,401 samples are stigmatic (μ₁ = μ₂): the outgoing wavefront bends equally every way there, and the two caustics meet.",
  );
  // From behind the mirror nothing is lit.
  await page.getByLabel("Mirror side", { exact: true }).selectOption("reverse");
  await settled(page);
  await expect(note(page)).toHaveText(
    "Caustic 1 (μ₁) lies wholly at infinity. Caustic 2 (μ₂) lies wholly at infinity. 2,401 samples are unlit: the light grazes the mirror there or arrives behind its mirror side.",
  );
  await page.getByLabel("Mirror side", { exact: true }).selectOption("forward");
  // A dome under the same light spreads it from a virtual focus, drawn
  // behind it.
  await field(page, "Curvature k₁").fill("-0.5");
  await field(page, "Curvature k₂").fill("-0.5");
  await settled(page);
  await expect(note(page)).toContainText(
    "Caustic 1 (μ₁) is virtual, behind the mirror: a point.",
  );
  const dome = await pixels(page);
  await layer(page, "Virtual rays & caustics").uncheck();
  expect(await pixels(page)).not.toBe(dome);
  await layer(page, "Virtual rays & caustics").check();
  // A saddle converges one way and diverges the other.
  await field(page, "Curvature k₁").fill("0.5");
  await settled(page);
  await expect(note(page)).toContainText(
    "Caustic 1 (μ₁) is real, ahead of the mirror: a curve. Caustic 2 (μ₂) is virtual, behind the mirror: a curve.",
  );
  // A plane images a point source; a sample at the source has no incident
  // direction, and its light grazes the rest of the plane.
  await field(page, "Curvature k₁").fill("0");
  await field(page, "Curvature k₂").fill("0");
  await page.getByLabel("Light", { exact: true }).selectOption("point");
  await settled(page);
  await expect(note(page)).toContainText(
    "Caustic 1 (μ₁) is virtual, behind the mirror: a point.",
  );
  await field(page, "Source z").fill("0");
  await settled(page);
  await expect(note(page)).toContainText(
    "2,400 samples are unlit: the light grazes the mirror there or arrives behind its mirror side. 1 sample lies at the source, with no incident direction.",
  );

  await choosePreset(page, bowl);
  await settled(page);
  await expect(note(page)).toHaveText(
    "Caustic 1 (μ₁) is real, ahead of the mirror: a surface. Caustic 2 (μ₂) is real, ahead of the mirror: a curve. 97 samples are chart singularities, with no normal and no reflection.",
  );
  await choosePreset(page, cup);
  await settled(page);
  await expect(note(page)).toHaveText(
    "Caustic 1 (μ₁) is real, ahead of the mirror: a surface. Caustic 2 (μ₂) lies wholly at infinity. 26 samples are unlit: the light grazes the mirror there or arrives behind its mirror side.",
  );
  // A monkey saddle's flat centre sends its caustics to infinity.
  await page.getByLabel("Surface", { exact: true }).selectOption("monkey");
  await page.getByLabel("Mirror side", { exact: true }).selectOption("forward");
  await field(page, "Elevation β (°)").fill("-90");
  await settled(page);
  await expect(note(page)).toContainText(
    "beyond 100 surface radii, treated as at infinity",
  );
  await expect(note(page)).toContainText("1 sample is stigmatic");
});

test("mirror reveal, pause, resume and edits invalidate stale playback", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, spheroid);
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
    `u = ${((3 * Math.PI) / 2).toPrecision(6)}`,
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
  await field(page, "Source x").fill("-0.9");
  await expect(stage(page)).not.toHaveAttribute("data-progress");
  await expect
    .poll(async () => (await config(page))?.rays?.source.x)
    .toBe(-0.9);
  // A replacement preset invalidates pending scalar work.
  await field(page, "Source z").fill("pi/4");
  await choosePreset(page, spheroid);
  await settled(page);
  expect((await config(page)).rays).toEqual(
    spatialPresets[+spheroid].config.rays,
  );
});

for (const camera of ["hold", "current", "follow", "fit"])
  test(`mirror playback reaches exact endpoints with the ${camera} camera`, async ({
    page,
  }) => {
    await ready(page);
    await choosePreset(page, coma);
    await settled(page);
    const base = await config(page);
    await openAnimation(page);
    await page
      .getByLabel("Animate", { exact: true })
      .selectOption("parameters");
    await page
      .getByLabel("Parameter 1", { exact: true })
      .selectOption("elevation");
    await page.getByLabel("Track 1 from").fill("-70");
    await page.getByLabel("Track 1 to").fill("-45-e");
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
    expect((await config(page)).rays.elevation).toBe(-70);
    const first = await framing();
    await slider.fill("1");
    await expect(stage(page)).toHaveAttribute("data-progress", "1");
    expect((await config(page)).rays.elevation).toBe(-45 - Math.E);
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

test("a mirror MP4 decodes with exact duration and a moving source", async ({
  page,
}) => {
  test.slow();
  await ready(page);
  await choosePreset(page, spheroid);
  await settled(page);
  await openAnimation(page);
  await page.getByLabel("Animate", { exact: true }).selectOption("parameters");
  await page.getByLabel("Parameter 1", { exact: true }).selectOption("sourceX");
  await page.getByLabel("Track 1 from").fill("-1");
  await page.getByLabel("Track 1 to").fill("-0.4");
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

test("mirror reveal grows the mirror, caustics and rays along u", () => {
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
  const part = (z: number, branch: 1 | 2, virtual: boolean): CausticSheet => ({
    ...sheet(z, false),
    branch,
    virtual,
    shape: "curve",
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
    rays: {
      surface: sheet(0),
      caustics: [
        part(3, 1, false),
        part(-3, 1, true),
        part(40, 2, false),
        part(-5, 2, true),
      ],
      lines: [0, 1, 2].map((i) => ({
        i,
        j: 0,
        start: at(i, 2),
        point: at(i),
        end: at(i, 1),
        back: at(i, -1),
        virtual: false,
        total: false,
      })),
      uCurves: [0, 1],
      vCurves: [0, 2],
      source: at(1, 6),
      singular: 0,
      unlit: 0,
      atSource: 0,
      stigmatic: 0,
      total: 0,
      clipped: [0, 0],
      receiver: null,
    },
  };
  const early = reveal(input, 0.5).rays!;
  expect(early.surface.points).toHaveLength(2);
  expect(early.surface.alongU).toHaveLength(1);
  expect(early.surface.faces).toHaveLength(1);
  expect(
    early.caustics.map((c) => [c.points.length, c.branch, c.virtual]),
  ).toEqual([
    [2, 1, false],
    [2, 1, true],
    [2, 2, false],
    [2, 2, true],
  ]);
  expect(early.lines.map((l) => l.i)).toEqual([0, 1]);
  expect(early.source).toEqual(input.rays!.source);
  expect(reveal(input, 0).rays!.surface.faces).toEqual([]);
  // The whole reveal frames the mirror, rays and source, then each caustic
  // part, as Go does.
  const whole = reveal(input, 1);
  expect(whole.rays).toEqual(input.rays);
  expect(whole.bounds.center.z).toBeCloseTo(17.5, 12);
  expect(input.rays!.surface.points).toHaveLength(3);
});

test("mirror tracks move the shape, light, chart and grid only", () => {
  const base = structuredClone(spatialPresets[+coma].config);
  expect(availableTargets(base)).toEqual([
    "surfaceA",
    "surfaceB",
    "azimuth",
    "elevation",
    "rayLength",
    "uMin",
    "uMax",
    "vMin",
    "vMax",
    "uSamples",
    "vSamples",
    "curves",
  ]);
  expect(targetLabel(base, "surfaceA")).toBe("Curvature k₁");
  expect(targetLabel(base, "azimuth")).toBe("Azimuth α (°)");
  expect(targetLabel(base, "rayLength")).toBe("Ray length ℓ");
  const lamp = structuredClone(spatialPresets[+spheroid].config);
  expect(availableTargets(lamp).slice(0, 7)).toEqual([
    "surfaceA",
    "surfaceB",
    "surfaceC",
    "sourceX",
    "sourceY",
    "sourceZ",
    "rayLength",
  ]);
  expect(targetLabel(lamp, "sourceZ")).toBe("Source z");
  const tracks = [
    { target: "surfaceA", from: 1, to: 2 },
    { target: "azimuth", from: 0, to: 90 },
    { target: "elevation", from: -90, to: -30 },
    { target: "rayLength", from: 1, to: 3 },
    { target: "sourceY", from: 0, to: 2 },
    { target: "curves", from: 2, to: 5 },
  ] as const;
  const middle = applyTracks(base, [...tracks], 0.5).config;
  expect(middle.rays.azimuth).toBe(45);
  const end = applyTracks(base, [...tracks], 1).config;
  expect(end.rays).toEqual({
    ...base.rays,
    azimuth: 90,
    elevation: -30,
    length: 3,
    source: { ...base.rays.source, y: 2 },
  });
  expect(end.surface).toEqual({ ...base.surface, a: 2, curves: 5 });
  expect(end.curve).toEqual(base.curve);
  expect(base.rays).toEqual(spatialPresets[+coma].config.rays);
});
