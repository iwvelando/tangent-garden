import {
  applyTracks,
  availableTargets,
  reveal,
  targetLabel,
} from "../web/spatial/animation";
import { spatialPresets } from "../web/spatial/presets";
import type { SpatialResult } from "../web/spatial/types";
import { test, expect, type Page } from "@playwright/test";
import { choosePreset } from "./helpers";
import { readFile } from "node:fs/promises";
import { probe, decodeVideo } from "./video";
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
const vortex = "24",
  lorenz = "25",
  rossler = "26";
const note = (page: Page) => page.getByTestId("field-note");
const layer = (page: Page, name: string) =>
  page.getByRole("checkbox", { name, exact: true });

test("trajectories stand alone with their own layers and validated fields", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, lorenz);
  await settled(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Paths that follow a field",
  );
  await expect(page.getByLabel("Construction", { exact: true })).toHaveValue(
    "none",
  );
  await expect(layer(page, "Ribbon surface")).toHaveCount(0);
  await expect(page.getByLabel("Tangent reach L")).toHaveCount(0);
  const original = await pixels(page);
  for (const name of [
    "Other trajectories",
    "Field directions",
    "Seeds & early stops",
  ]) {
    await layer(page, name).uncheck();
    expect(await pixels(page)).not.toBe(original);
    await layer(page, name).check();
    expect(await pixels(page)).toBe(original);
  }
  for (const [name, text, message] of [
    ["dz/dt", "x*w", "dz/dt"],
    ["dx/dt", "10*(y-", "dx/dt"],
    ["Escape radius R", "0", "escape radius"],
    ["Escape radius R", "2e5", "escape radius"],
    ["Seed x₂", "2e5", "seed 2"],
    ["to", "0", "domain"],
    ["Shape parameter a", "t", "t is not allowed"],
  ] as const) {
    const before = await field(page, name).inputValue();
    await field(page, name).fill(text);
    await expect(page.getByRole("alert")).toContainText(message);
    await field(page, name).fill(before);
    await settled(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  // Seeds are added up to twelve and removed down to one.
  const add = page.getByRole("button", { name: "Add a seed" });
  for (let n = 2; n < 12; n++) await add.click();
  await expect(
    page.getByRole("button", { name: "At most 12 seeds" }),
  ).toBeDisabled();
  await settled(page);
  expect((await config(page)).field.seeds).toHaveLength(12);
  // The third seed continues the line through the first two.
  const third = (await config(page)).field.seeds[2];
  expect(third.x).toBeCloseTo(1.002, 12);
  expect([third.y, third.z]).toEqual([1, 20]);
  for (let n = 12; n > 1; n--)
    await page.getByRole("button", { name: `Remove seed ${n}` }).click();
  await expect(
    page.getByRole("button", { name: "Remove seed 1" }),
  ).toBeDisabled();
  await settled(page);
  expect((await config(page)).field.seeds).toEqual([{ x: 1, y: 1, z: 20 }]);
});

test("notes report ends, escapes, equilibria, timed fields and the carried construction", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, lorenz);
  await settled(page);
  await expect(note(page)).toHaveText(
    "Every trajectory runs to the end of the interval.",
  );
  // The origin is an equilibrium of Lorenz's equations.
  for (const axis of ["x", "y", "z"])
    await field(page, `Seed ${axis}₂`).fill("0");
  await settled(page);
  await expect(note(page)).toContainText(
    "Seed 2 sits at an equilibrium, where the field's speed is below 10⁻⁹",
  );
  await field(page, "Escape radius R").fill("30");
  await settled(page);
  await expect(note(page)).toContainText(
    "Trajectory 1 leaves the escape sphere at t = ",
  );
  await expect(note(page)).toContainText(
    "The others run to the end of the interval.",
  );

  await choosePreset(page, vortex);
  await settled(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "A ribbon of tangent lines",
  );
  await expect(note(page)).toContainText(
    "The construction is built on trajectory 1.",
  );
  await field(page, "dz/dt").fill("a*cos(t)");
  await settled(page);
  await expect(note(page)).toContainText("The field changes with t");
  // A first seed outside the escape sphere leaves nothing to build on…
  await field(page, "Seed x₁").fill("30");
  await expect(page.getByRole("alert")).toContainText(
    "trajectory 1 has no regular sample",
  );
  // …but the trajectories can still stand alone.
  await page.getByLabel("Construction", { exact: true }).selectOption("none");
  await settled(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(note(page)).toContainText(
    "Seed 1 is outside the escape sphere, so it has no path.",
  );
  await field(page, "dx/dt").fill("sqrt(x)");
  await settled(page);
  await expect(note(page)).toContainText(
    "The field is not finite at seed 3, so it has no path.",
  );

  await choosePreset(page, rossler);
  await settled(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "A ribbon carried by a frame",
  );
  await expect(note(page)).toContainText(
    "The trajectory runs to the end of the interval.",
  );
});

test("field reveal, pause, resume and edits invalidate stale playback", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, lorenz);
  await settled(page);
  const original = await config(page);
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
  await field(page, "Seed z₁").fill("21");
  await expect(stage(page)).not.toHaveAttribute("data-progress");
  await expect
    .poll(async () => (await config(page))?.field?.seeds[0].z)
    .toBe(21);
  expect((await config(page)).field.x).toBe(original.field.x);
  // A replacement preset invalidates pending scalar work.
  await field(page, "Shape parameter a").fill("pi");
  await choosePreset(page, lorenz);
  await settled(page);
  expect((await config(page)).field).toEqual(
    spatialPresets[+lorenz].config.field,
  );
});

for (const camera of ["hold", "current", "follow", "fit"])
  test(`field playback reaches exact endpoints with the ${camera} camera`, async ({
    page,
  }) => {
    await ready(page);
    await choosePreset(page, vortex);
    await settled(page);
    const base = await config(page);
    await openAnimation(page);
    await page
      .getByLabel("Animate", { exact: true })
      .selectOption("parameters");
    await page.getByLabel("Parameter 1", { exact: true }).selectOption("a");
    await page.getByLabel("Track 1 from").fill("1/8");
    await page.getByLabel("Track 1 to").fill("1/e");
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
    expect((await config(page)).field.a).toBe(1 / 8);
    const first = await framing();
    await slider.fill("1");
    await expect(stage(page)).toHaveAttribute("data-progress", "1");
    expect((await config(page)).field.a).toBe(1 / Math.E);
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

test("a field MP4 decodes with exact duration and moving seeds", async ({
  page,
}) => {
  test.slow();
  await ready(page);
  await choosePreset(page, vortex);
  await settled(page);
  await openAnimation(page);
  await page.getByLabel("Animate", { exact: true }).selectOption("parameters");
  await page.getByLabel("Parameter 1", { exact: true }).selectOption("seed1Z");
  await page.getByLabel("Track 1 from").fill("0");
  await page.getByLabel("Track 1 to").fill("1");
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

test("field reveal shows every trajectory to the same time", () => {
  const origin = { x: 0, y: 0, z: 0 },
    far = { x: 40, y: 0, z: 0 },
    near = { x: 1, y: 0, z: 0 };
  const input: SpatialResult = {
    base: [origin, near, near, near],
    minus: [],
    plus: [],
    mesh: [],
    rulings: [],
    breaks: [false, false, false, false],
    bounds: { center: origin, radius: 40 },
    radius: 40,
    invalid: 0,
    omitted: 0,
    field: {
      // The second trajectory escapes between samples 1 and 2; the third
      // reaches far only at the end.
      paths: [
        [origin, near, near, near],
        [near, origin, null, null],
        [origin, origin, origin, far],
      ],
      arrows: [0, 1, 2, 3].map((sampleIndex) => ({
        sampleIndex,
        seed: 0,
        point: origin,
        velocity: near,
      })),
      ends: [
        { time: 3, reason: "end", point: near, steps: 4 },
        { time: 1.5, reason: "escape", point: origin, steps: 2 },
        { time: 3, reason: "end", point: far, steps: 4 },
      ],
      resting: [false, false, false],
      timed: false,
    },
  };
  const early = reveal(input, 1 / 3);
  expect(early.field?.paths).toEqual([
    [origin, near],
    [near, origin],
    [origin, origin],
  ]);
  expect(early.field?.arrows.map((a) => a.sampleIndex)).toEqual([0, 1]);
  // The escape is not marked until the reveal passes it.
  expect(early.field?.ends[1].point).toBeNull();
  expect(reveal(input, 2 / 3).field?.ends[1].point).toEqual(origin);
  // Every trajectory frames the reveal, as in Go.
  expect(early.bounds.radius).toBeLessThan(1);
  expect(reveal(input, 1).bounds.radius).toBeGreaterThan(19);
  expect(input.field?.paths[2]).toHaveLength(4);
});

test("field tracks move a, seeds, escape and time and leave the base intact", () => {
  const base = structuredClone(spatialPresets[+lorenz].config);
  const targets = availableTargets(base);
  expect(targets).toEqual([
    "a",
    "seed1X",
    "seed1Y",
    "seed1Z",
    "seed2X",
    "seed2Y",
    "seed2Z",
    "escape",
    "min",
    "max",
    "samples",
    "lines",
  ]);
  expect(targetLabel(base, "seed2Z")).toBe("Seed z₂");
  expect(targetLabel(base, "escape")).toBe("Escape radius R");
  expect(targetLabel(base, "lines")).toBe("Field arrows");
  // With a construction, its own targets follow a.
  const carried = structuredClone(spatialPresets[+vortex].config);
  expect(availableTargets(carried).slice(0, 2)).toEqual(["a", "length"]);
  expect(targetLabel(carried, "lines")).toBe("Tangent lines");
  const tracks = [
    { target: "a", from: 20, to: 28 },
    { target: "seed2X", from: 1, to: 2 },
    { target: "escape", from: 50, to: 100 },
    { target: "max", from: 10, to: 20 },
  ] as const;
  const end = applyTracks(base, [...tracks], 1).config;
  expect(end.field).toEqual({
    ...base.field,
    a: 28,
    escape: 100,
    max: 20,
    seeds: [base.field.seeds[0], { ...base.field.seeds[1], x: 2 }],
  });
  expect(end.curve).toEqual(base.curve);
  expect(applyTracks(base, [...tracks], -1).config.field.a).toBe(20);
  expect(base.field).toEqual(spatialPresets[+lorenz].config.field);
});

test("any curve can stand alone, with no construction, layers or reach", async ({
  page,
}) => {
  await ready(page);
  const original = await pixels(page);
  await page.getByLabel("Construction", { exact: true }).selectOption("none");
  await settled(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "A curve in space",
  );
  await expect(page.locator(".spatial-layers")).toHaveCount(0);
  await expect(page.getByLabel("Tangent reach L")).toHaveCount(0);
  await expect(page.getByLabel("Representative samples")).toHaveCount(1);
  expect(await pixels(page)).not.toBe(original);
  const shown = await config(page);
  expect(shown.construction).toBe("none");
  expect(availableTargets(shown)).toEqual([
    "radius",
    "tube",
    "samples",
    "lines",
  ]);
  expect(targetLabel(shown, "lines")).toBe("Representative samples");
  // A harmonic curve alone keeps its vector sums and ellipses.
  await page
    .getByLabel("Spatial definition", { exact: true })
    .selectOption("harmonic");
  await settled(page);
  await expect(layer(page, "Vector sums")).toBeVisible();
});
