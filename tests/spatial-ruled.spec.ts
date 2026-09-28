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
const loom = "18",
  trefoil = "19",
  helix = "20";
const note = (page: Page) => page.getByTestId("ruled-note");

test("a ruled surface has its own layers and validated fields", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, loom);
  await settled(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "A surface of straight threads",
  );
  const original = await pixels(page);
  for (const layer of ["Ruled surface", "Rulings", "Partner thread"]) {
    const box = page.getByRole("checkbox", { name: layer, exact: true });
    await box.uncheck();
    expect(await pixels(page)).not.toBe(original);
    await box.check();
    expect(await pixels(page)).toBe(original);
  }
  for (const [name, text, message] of [
    ["Rate m", "101", "rate m"],
    ["Shift δ", "-2e6", "shift δ"],
    ["b y(t)", "sin(", "b y(t)"],
    ["b z(t)", "a*t", "b z(t)"],
    ["b x(t)", "sqrt(-1-t^2)", "no finite points"],
  ] as const) {
    const before = await field(page, name).inputValue();
    await field(page, name).fill(text);
    await expect(page.getByRole("alert")).toContainText(message);
    await field(page, name).fill(before);
    await settled(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
});

test("notes report closure, stops, collapse, cones and developability", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, loom);
  await settled(page);
  await expect(note(page)).toContainText("second thread at b(mt + δ)");
  await expect(note(page)).toContainText("Both threads close");
  await expect(note(page)).toContainText("not developable");
  // A constant thread is a cone: singular at its apex, but developable.
  for (const [axis, text] of [
    ["x", "0"],
    ["y", "0"],
    ["z", "3"],
  ])
    await field(page, `b ${axis}(t)`).fill(text);
  await settled(page);
  await expect(note(page)).toContainText("S_t × S_u vanishes");
  await expect(note(page)).toContainText("The surface is developable");
  // Chords that leave an open domain stop there.
  await choosePreset(page, helix);
  await settled(page);
  await expect(note(page)).toContainText("Chords join each point");
  await expect(note(page)).toContainText("The curve is open");
  await expect(note(page)).toContainText(
    "160 chords would reach beyond the open domain",
  );
  await expect(field(page, "b x(t)")).toHaveCount(0);
  // A fractional rate on a closed curve leaves a seam; a zero shift, nothing.
  await choosePreset(page, trefoil);
  await settled(page);
  await expect(note(page)).toContainText("Both threads close");
  await field(page, "Rate m").fill("3/2");
  await settled(page);
  await expect(note(page)).toContainText("so the surface has a seam");
  await field(page, "Rate m").fill("1");
  await field(page, "Shift δ").fill("0");
  await settled(page);
  await expect(note(page)).toContainText("Every ruling has zero length");
  await page.getByLabel("Partner", { exact: true }).selectOption("thread");
  await settled(page);
  await expect(field(page, "b z(t)")).toHaveValue("1.6");
  await expect(note(page)).toContainText("second thread");
});

test("ruled reveal, pause, resume and edits invalidate stale playback", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, loom);
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
  await field(page, "Shift δ").fill("pi/3");
  await expect(stage(page)).not.toHaveAttribute("data-progress");
  await expect
    .poll(async () => (await config(page))?.ruled?.shift)
    .toBe(Math.PI / 3);
  expect((await config(page)).ruled.rate).toBe(original.ruled.rate);
  // A replacement preset invalidates pending scalar work.
  await field(page, "Rate m").fill("pi");
  await choosePreset(page, loom);
  await settled(page);
  expect((await config(page)).ruled).toEqual(
    spatialPresets[+loom].config.ruled,
  );
});

for (const camera of ["hold", "current", "follow", "fit"])
  test(`ruled playback reaches exact endpoints with the ${camera} camera`, async ({
    page,
  }) => {
    await ready(page);
    await choosePreset(page, loom);
    await settled(page);
    // A rising thread, so the rate changes how far the partner reaches.
    await field(page, "b z(t)").fill("0.9+t/4");
    await settled(page);
    const base = await config(page);
    await openAnimation(page);
    await page
      .getByLabel("Animate", { exact: true })
      .selectOption("parameters");
    await page.getByLabel("Parameter 1", { exact: true }).selectOption("rate");
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
    expect((await config(page)).ruled.rate).toBe(1 / ((1 + Math.sqrt(5)) / 2));
    const first = await framing();
    await slider.fill("1");
    await expect(stage(page)).toHaveAttribute("data-progress", "1");
    expect((await config(page)).ruled.rate).toBe(Math.E);
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

test("a ruled MP4 decodes with exact duration and a turning weave", async ({
  page,
}) => {
  test.slow();
  await ready(page);
  await choosePreset(page, loom);
  await settled(page);
  await openAnimation(page);
  await page.getByLabel("Animate", { exact: true }).selectOption("parameters");
  await page.getByLabel("Parameter 1", { exact: true }).selectOption("shift");
  await page.getByLabel("Track 1 from").fill("0");
  await page.getByLabel("Track 1 to").fill("pi");
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

test("ruled reveal keeps the partner and its breaks up to the tip", () => {
  const origin = { x: 0, y: 0, z: 0 },
    far = { x: 40, y: 0, z: 0 };
  const input: SpatialResult = {
    base: [origin, origin, origin, origin],
    minus: [],
    plus: [origin, origin, far, far],
    mesh: [],
    rulings: [0, 2, 3].map((sampleIndex) => ({
      sampleIndex,
      from: origin,
      to: far,
    })),
    breaks: [false, false, false, false],
    bounds: { center: origin, radius: 40 },
    radius: 40,
    invalid: 0,
    omitted: 1,
    ruled: {
      partner: "thread",
      breaks: [false, false, true, false],
      closed: false,
      gap: 0,
      outside: 0,
      coincident: 0,
      singular: 0,
      developable: false,
      deviation: 0.5,
    },
  };
  const prefix = reveal(input, 2 / 3);
  expect(prefix.plus).toEqual([origin, origin, far]);
  expect(prefix.ruled?.breaks).toEqual([false, false, true]);
  expect(prefix.rulings.map((r) => r.sampleIndex)).toEqual([0, 2]);
  // The curve is a point; the partner reaches 40 away.
  expect(prefix.bounds.radius).toBeGreaterThan(19);
  expect(input.ruled?.breaks).toHaveLength(4);
});

test("ruled tracks move the shift and rate and leave the base study intact", () => {
  const base = structuredClone(spatialPresets[+loom].config);
  const targets = availableTargets(base);
  expect(targets.slice(0, 2)).toEqual(["shift", "rate"]);
  expect(targets).not.toContain("length");
  expect(targetLabel(base, "shift")).toBe("Shift δ");
  expect(targetLabel(base, "rate")).toBe("Rate m");
  expect(targetLabel(base, "lines")).toBe("Rulings");
  const tracks = [
    { target: "shift", from: -Math.PI, to: Math.E },
    { target: "rate", from: 1, to: 3 },
  ] as const;
  expect(applyTracks(base, [...tracks], -0.01).config.ruled.shift).toBe(
    -Math.PI,
  );
  const end = applyTracks(base, [...tracks], 1).config;
  expect(end.ruled).toEqual({ ...base.ruled, shift: Math.E, rate: 3 });
  expect(end.frame).toEqual(base.frame);
  expect(base.ruled).toEqual(spatialPresets[+loom].config.ruled);
});
