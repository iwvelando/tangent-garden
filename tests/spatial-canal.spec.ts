import {
  applyTracks,
  availableTargets,
  integerTargets,
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
const tube = "21",
  necklace = "22",
  beads = "23";
const note = (page: Page) => page.getByTestId("canal-note");
const layer = (page: Page, name: string) =>
  page.getByRole("checkbox", { name, exact: true });

test("a canal surface has its own layers and validated fields", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, tube);
  await settled(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "A surface enveloping spheres",
  );
  const surface = layer(page, "Canal surface");
  const original = await pixels(page);
  await surface.uncheck();
  const bare = await pixels(page);
  expect(bare).not.toBe(original);
  // The frames and seam sit inside the tube, so test the rest without it.
  for (const name of ["Contact circles", "Meridians", "Frames", "Seam"]) {
    await layer(page, name).uncheck();
    expect(await pixels(page)).not.toBe(bare);
    await layer(page, name).check();
    expect(await pixels(page)).toBe(bare);
  }
  await surface.check();
  expect(await pixels(page)).toBe(original);
  for (const [name, text, message] of [
    ["Tube radius R", "0", "radius R"],
    ["Tube radius R", "2e5", "radius R"],
    ["Twist (turns)", "101", "twist"],
    ["Profile ρ(t)", "sin(", "ρ(t)"],
    ["Profile ρ(t)", "a*t", "ρ(t)"],
    ["Profile ρ(t)", "-1", "never positive"],
  ] as const) {
    const before = await field(page, name).inputValue();
    await field(page, name).fill(text);
    await expect(page.getByRole("alert")).toContainText(message);
    await field(page, name).fill(before);
    await settled(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  const meridians = page.getByRole("spinbutton", {
    name: "Meridians",
    exact: true,
  });
  await meridians.fill("13");
  await expect(page.getByRole("alert")).toContainText("meridians");
  await meridians.fill("2.5");
  await expect(page.getByRole("alert")).toContainText("whole number");
  await meridians.fill("4");
  await settled(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("notes report tubes, closure, seams, lost envelopes, collapse and folds", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, tube);
  await settled(page);
  await expect(note(page)).toContainText("A tube: every sphere");
  await expect(note(page)).toContainText("the surface closes");
  await expect(note(page)).toContainText("the frame returns turned by");
  await expect(note(page)).toContainText("the meridians do not close");
  await page
    .getByLabel("Closed-loop seam", { exact: true })
    .selectOption("distribute");
  await settled(page);
  await expect(note(page)).toContainText("spread evenly along the loop");
  await expect(layer(page, "Seam")).toBeVisible();
  // A Frenet frame chosen for a ribbon does not carry the tube.
  await page.getByLabel("Construction", { exact: true }).selectOption("framed");
  await page.getByLabel("Frame", { exact: true }).selectOption("frenet");
  await page.getByLabel("Construction", { exact: true }).selectOption("canal");
  await settled(page);
  await expect(note(page)).toContainText("Rotation-minimizing frame");
  await expect(field(page, "N₀ x")).toBeVisible();

  await choosePreset(page, necklace);
  await settled(page);
  await expect(note(page)).toContainText("set back along the tangent");
  await expect(note(page)).toContainText("The curve is open");
  await expect(note(page)).not.toContainText("no real envelope");
  // Wider than the helix can turn: 1/κ = 2.06.
  await field(page, "Profile ρ(t)").fill("1");
  await field(page, "Tube radius R").fill("2.2");
  await settled(page);
  await expect(note(page)).toContainText(
    "The tube folds back through itself on 961 samples",
  );

  await choosePreset(page, beads);
  await settled(page);
  await expect(note(page)).toContainText("|R′| > v");
  await expect(note(page)).toContainText("no real envelope");
  await expect(note(page)).toContainText("folds back on itself");
  // R = t on a unit-speed line: half the spheres vanish, the rest collapse.
  await field(page, "Tube radius R").fill("1");
  await field(page, "Profile ρ(t)").fill("t");
  await settled(page);
  await expect(note(page)).toContainText(
    "not a positive, finite radius with a finite slope on 481 samples",
  );
  await expect(note(page)).toContainText(
    "On 480 samples |R′| = v, and the contact circle collapses to a point",
  );
});

test("canal reveal, pause, resume and edits invalidate stale playback", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, necklace);
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
  await field(page, "Tube radius R").fill("1/e");
  await expect(stage(page)).not.toHaveAttribute("data-progress");
  await expect
    .poll(async () => (await config(page))?.canal?.radius)
    .toBe(1 / Math.E);
  expect((await config(page)).canal.profile).toBe(original.canal.profile);
  // A replacement preset invalidates pending scalar work.
  await field(page, "Tube radius R").fill("pi");
  await choosePreset(page, necklace);
  await settled(page);
  expect((await config(page)).canal).toEqual(
    spatialPresets[+necklace].config.canal,
  );
});

for (const camera of ["hold", "current", "follow", "fit"])
  test(`canal playback reaches exact endpoints with the ${camera} camera`, async ({
    page,
  }) => {
    await ready(page);
    await choosePreset(page, tube);
    await settled(page);
    const base = await config(page);
    await openAnimation(page);
    await page
      .getByLabel("Animate", { exact: true })
      .selectOption("parameters");
    await page
      .getByLabel("Parameter 1", { exact: true })
      .selectOption("sphereRadius");
    await page.getByLabel("Track 1 from").fill("1/5");
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
    expect((await config(page)).canal.radius).toBe(1 / 5);
    const first = await framing();
    await slider.fill("1");
    await expect(stage(page)).toHaveAttribute("data-progress", "1");
    expect((await config(page)).canal.radius).toBe(1 / Math.E);
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

test("a canal MP4 decodes with exact duration and turning meridians", async ({
  page,
}) => {
  test.slow();
  await ready(page);
  await choosePreset(page, tube);
  await settled(page);
  await openAnimation(page);
  await page.getByLabel("Animate", { exact: true }).selectOption("parameters");
  await page.getByLabel("Parameter 1", { exact: true }).selectOption("twist");
  await page.getByLabel("Track 1 from").fill("0");
  await page.getByLabel("Track 1 to").fill("1/2");
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

test("canal reveal keeps circles, meridians and breaks up to the tip", () => {
  const origin = { x: 0, y: 0, z: 0 },
    far = { x: 40, y: 0, z: 0 };
  const circle = (sampleIndex: number, real: boolean) => ({
    sampleIndex,
    real,
    sphere: 1,
    center: origin,
    radius: real ? 1 : 0,
    points: real ? [origin, far, origin] : [],
  });
  const input: SpatialResult = {
    base: [origin, origin, origin, origin],
    minus: [],
    plus: [],
    mesh: [],
    rulings: [],
    breaks: [false, false, false, false],
    bounds: { center: origin, radius: 40 },
    radius: 40,
    invalid: 0,
    omitted: 1,
    canal: {
      circles: [circle(0, true), circle(2, false), circle(3, true)],
      meridians: [[origin, origin, null, far]],
      breaks: [false, false, true, true],
      constant: false,
      closed: false,
      gap: 0,
      steepest: 1.2,
      undefined: 0,
      imaginary: 1,
      between: 0,
      collapsed: 0,
      folded: 0,
    },
  };
  const prefix = reveal(input, 2 / 3);
  expect(prefix.canal?.meridians).toEqual([[origin, origin, null]]);
  expect(prefix.canal?.breaks).toEqual([false, false, true]);
  expect(prefix.canal?.circles.map((g) => g.sampleIndex)).toEqual([0, 2]);
  // The curve is a point; the first circle reaches 40 away.
  expect(prefix.bounds.radius).toBeGreaterThan(19);
  expect(input.canal?.meridians[0]).toHaveLength(4);
});

test("canal tracks move the radius, frame and meridians and leave the base intact", () => {
  const base = structuredClone(spatialPresets[+tube].config);
  const targets = availableTargets(base);
  expect(targets.slice(0, 7)).toEqual([
    "sphereRadius",
    "angle",
    "twist",
    "meridians",
    "normalX",
    "normalY",
    "normalZ",
  ]);
  expect(targets).not.toContain("length");
  expect(targets).not.toContain("width");
  expect(integerTargets).toContain("meridians");
  expect(targetLabel(base, "sphereRadius")).toBe("Tube radius R");
  expect(targetLabel(base, "meridians")).toBe("Meridians");
  expect(targetLabel(base, "lines")).toBe("Contact circles");
  const tracks = [
    { target: "sphereRadius", from: 0.1, to: 0.5 },
    { target: "meridians", from: 0, to: 12 },
    { target: "twist", from: 0, to: 2 },
  ] as const;
  expect(applyTracks(base, [...tracks], -0.01).config.canal.radius).toBe(0.1);
  expect(applyTracks(base, [...tracks], 0.49).config.canal.meridians).toBe(6);
  const end = applyTracks(base, [...tracks], 1).config;
  expect(end.canal).toEqual({ ...base.canal, radius: 0.5, meridians: 12 });
  expect(end.frame).toEqual({ ...base.frame, twist: 2 });
  expect(base.canal).toEqual(spatialPresets[+tube].config.canal);
});
