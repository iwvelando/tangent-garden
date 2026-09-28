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
// The stage has no configuration until Go's first result arrives.
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
const band = "15",
  braid = "16",
  seam = "17";
const note = (page: Page) => page.getByTestId("frame-note");

test("a framed ribbon has its own layers and validated fields", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, band);
  await settled(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "A ribbon carried by a frame",
  );
  const original = await pixels(page);
  for (const layer of [
    "Ribbon surface",
    "Cross-lines",
    "Ribbon edges",
    "Strands",
    "Frames",
  ]) {
    const box = page.getByRole("checkbox", { name: layer, exact: true });
    await box.uncheck();
    expect(await pixels(page)).not.toBe(original);
    await box.check();
    expect(await pixels(page)).toBe(original);
  }
  for (const [name, text, message] of [
    ["Twist (turns)", "101", "twist must be"],
    ["Angle θ₀", "1001", "angle θ₀"],
    ["Offset d", "-1", "offset distance"],
    ["Half-width w", "100001", "half-width"],
    ["N₀ x", "1e6", "reference normal"],
  ] as const) {
    const before = await field(page, name).inputValue();
    await field(page, name).fill(text);
    await expect(page.getByRole("alert")).toContainText(message);
    await field(page, name).fill(before);
    await settled(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  for (const axis of ["x", "y", "z"]) await field(page, `N₀ ${axis}`).fill("0");
  await expect(page.getByRole("alert")).toContainText("reference normal");
});

test("a closed loop shows its seam, or distributes the correction, and Frenet is a diagnostic", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, seam);
  await settled(page);
  await expect(note(page)).toContainText("returns turned by −156.6°");
  await expect(note(page)).toContainText("The seam is left visible");
  const exposed = await pixels(page);
  const box = page.getByRole("checkbox", { name: "Seam", exact: true });
  await box.uncheck();
  expect(await pixels(page)).not.toBe(exposed);
  await box.check();
  await page
    .getByLabel("Closed-loop seam", { exact: true })
    .selectOption("distribute");
  await settled(page);
  await expect(note(page)).toContainText("156.6° of twist is spread");
  expect(await pixels(page)).not.toBe(exposed);
  // Half a turn of twist cannot close, and the seam says so.
  await field(page, "Twist (turns)").fill("1/2");
  await settled(page);
  await expect(note(page)).toContainText("does not close: its ends differ by");
  await field(page, "Twist (turns)").fill("0");
  await page.getByLabel("Frame", { exact: true }).selectOption("frenet");
  await settled(page);
  await expect(note(page)).toContainText("Frenet frame");
  await expect(field(page, "N₀ x")).toHaveCount(0);
  await expect(
    page.getByLabel("Closed-loop seam", { exact: true }),
  ).toHaveCount(0);
  // An open curve has no seam to show.
  await choosePreset(page, braid);
  await settled(page);
  await expect(note(page)).toContainText("open");
  await expect(page.getByRole("checkbox", { name: "Seam" })).toHaveCount(0);
});

test("strand counts are whole numbers and a straight run leaves Frenet undefined", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, braid);
  await settled(page);
  const strands = page.getByLabel("Offset strands", { exact: true });
  await strands.fill("5");
  await expect.poll(async () => (await config(page))?.frame?.strands).toBe(5);
  await strands.fill("13");
  await expect(page.getByRole("alert")).toContainText("0–12 offset strands");
  await strands.fill("0");
  await settled(page);
  await page
    .getByLabel("Spatial definition", { exact: true })
    .selectOption("parametric");
  await page.getByRole("textbox", { name: "x(t)" }).fill("t");
  await page.getByRole("textbox", { name: "y(t)" }).fill("(t+abs(t))^3/8");
  await page.getByRole("textbox", { name: "z(t)" }).fill("0");
  await field(page, "t from").fill("-1");
  await field(page, "to").fill("1");
  await page.getByLabel("Frame", { exact: true }).selectOption("frenet");
  await settled(page);
  await expect(note(page)).toContainText("samples without a Frenet normal");
});

test("framed reveal, pause, resume and edits invalidate stale playback", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, band);
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
  await field(page, "Angle θ₀").fill("pi/3");
  await expect(stage(page)).not.toHaveAttribute("data-progress");
  await expect
    .poll(async () => (await config(page))?.frame?.angle)
    .toBe(Math.PI / 3);
  expect((await config(page)).frame.width).toBe(original.frame.width);
  // A replacement preset invalidates pending scalar work.
  await field(page, "N₀ y").fill("pi");
  await choosePreset(page, band);
  await settled(page);
  expect((await config(page)).frame).toEqual(
    spatialPresets[+band].config.frame,
  );
});

for (const camera of ["hold", "current", "follow", "fit"])
  test(`framed playback reaches exact endpoints with the ${camera} camera`, async ({
    page,
  }) => {
    await ready(page);
    await choosePreset(page, braid);
    await settled(page);
    const base = await config(page);
    await openAnimation(page);
    await page
      .getByLabel("Animate", { exact: true })
      .selectOption("parameters");
    await page
      .getByLabel("Parameter 1", { exact: true })
      .selectOption("distance");
    await page.getByLabel("Track 1 from").fill("1/phi");
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
    expect((await config(page)).frame.offset).toBe(
      1 / ((1 + Math.sqrt(5)) / 2),
    );
    const first = await framing();
    await slider.fill("1");
    await expect(stage(page)).toHaveAttribute("data-progress", "1");
    expect((await config(page)).frame.offset).toBe(Math.E);
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

test("a framed MP4 decodes with exact duration and a turning ribbon", async ({
  page,
}) => {
  test.slow();
  await ready(page);
  await choosePreset(page, band);
  await settled(page);
  await openAnimation(page);
  await page.getByLabel("Animate", { exact: true }).selectOption("parameters");
  await page.getByLabel("Parameter 1", { exact: true }).selectOption("angle");
  await page.getByLabel("Track 1 from").fill("0");
  await page.getByLabel("Track 1 to").fill("pi/2");
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

test("framed reveal keeps strands and frames up to the tip, and the seam only when complete", () => {
  const origin = { x: 0, y: 0, z: 0 },
    far = { x: 40, y: 0, z: 0 },
    axis = { x: 0, y: 0, z: 1 };
  const glyph = (sampleIndex: number) => ({
    sampleIndex,
    point: origin,
    tangent: { x: 1, y: 0, z: 0 },
    normal: { x: 0, y: 1, z: 0 },
    binormal: axis,
  });
  const input: SpatialResult = {
    base: [origin, origin, origin, origin],
    minus: [origin, origin, origin, origin],
    plus: [origin, origin, origin, origin],
    mesh: [],
    rulings: [],
    breaks: [false, false, false, false],
    bounds: { center: origin, radius: 40 },
    radius: 40,
    invalid: 0,
    omitted: 0,
    frame: {
      kind: "rotation-minimizing",
      frames: [0, 2, 3].map(glyph),
      strands: [[origin, origin, far, far]],
      breaks: [false, false, true, false],
      length: 3,
      pieces: 1,
      undefined: 0,
      flips: 0,
      fallbacks: 0,
      closed: true,
      holonomy: 0.5,
      correction: 0,
      seam: { point: origin, start: axis, end: axis, angle: 0.5 },
    },
  };
  const prefix = reveal(input, 2 / 3);
  expect(prefix.frame?.frames.map((g) => g.sampleIndex)).toEqual([0, 2]);
  expect(prefix.frame?.strands[0]).toEqual([origin, origin, far]);
  expect(prefix.frame?.breaks).toEqual([false, false, true]);
  expect(prefix.frame?.seam).toBeUndefined();
  // The curve is a point; the strand reaches 40 away.
  expect(prefix.bounds.radius).toBeGreaterThan(19);
  expect(reveal(input, 1).frame?.seam).toEqual(input.frame!.seam);
  expect(input.frame?.frames).toHaveLength(3);
});

test("framed tracks move the frame fields and leave the base study intact", () => {
  const base = structuredClone(spatialPresets[+band].config);
  const targets = availableTargets(base);
  expect(targets.slice(0, 8)).toEqual([
    "angle",
    "twist",
    "width",
    "distance",
    "strands",
    "normalX",
    "normalY",
    "normalZ",
  ]);
  expect(targets).not.toContain("length");
  expect(targetLabel(base, "twist")).toBe("Twist (turns)");
  expect(targetLabel(base, "normalY")).toBe("N₀ y");
  expect(targetLabel(base, "lines")).toBe("Frames & cross-lines");
  const frenet = { ...base, frame: { ...base.frame, kind: "frenet" as const } };
  expect(availableTargets(frenet)).not.toContain("normalX");
  const tracks = [
    { target: "angle", from: -Math.PI, to: Math.E },
    { target: "twist", from: 0, to: 3 },
    { target: "width", from: 0.1, to: 0.5 },
    { target: "distance", from: 0, to: 1 },
    { target: "strands", from: 1, to: 6 },
    { target: "normalX", from: 0, to: 1 },
  ] as const;
  const start = applyTracks(base, [...tracks], -0.01).config;
  expect(start.frame.angle).toBe(-Math.PI);
  expect(start.frame.strands).toBe(1);
  expect(start.involute.offset).toBe(base.involute.offset);
  const middle = applyTracks(base, [...tracks], 0.45).config;
  expect(middle.frame.strands).toBe(3);
  const end = applyTracks(base, [...tracks], 1).config;
  expect(end.frame).toEqual({
    ...base.frame,
    angle: Math.E,
    twist: 3,
    width: 0.5,
    offset: 1,
    strands: 6,
    reference: { ...base.frame.reference, x: 1 },
  });
  expect(base.frame).toEqual(spatialPresets[+band].config.frame);
});
