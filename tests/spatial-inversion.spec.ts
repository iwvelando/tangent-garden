import {
  applyTracks,
  availableTargets,
  reveal,
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
const staircase = "9",
  trefoil = "10",
  perpendiculars = "11";

for (const [preset, derived] of [
  [staircase, false],
  [perpendiculars, true],
] as const)
  test(`sphere inversion of ${derived ? "a derived path" : "the base"} has independent layers and validated controls`, async ({
    page,
  }) => {
    await ready(page);
    await choosePreset(page, preset);
    await settled(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "A curve inverted in a sphere",
    );
    await expect(field(page, "Tangent reach L")).toHaveCount(0);
    await expect(field(page, "Pole z")).toHaveCount(derived ? 1 : 0);
    const layers = [
      "Inverted curve",
      "Correspondence segments",
      "Inversion sphere & center",
      ...(derived ? ["Projection & pole"] : []),
    ];
    await expect(
      page.getByRole("checkbox", { name: "Projection & pole", exact: true }),
    ).toHaveCount(derived ? 1 : 0);
    const original = await pixels(page);
    for (const layer of layers) {
      const box = page.getByRole("checkbox", { name: layer, exact: true });
      await box.uncheck();
      expect(await pixels(page)).not.toBe(original);
      await box.check();
      expect(await pixels(page)).toBe(original);
    }
    for (const [name, text, message] of [
      ["Sphere radius R", "0", "radius"],
      ["Sphere radius R", "-1", "radius"],
      ["Center z", "100001", "±100000"],
      ...(derived ? ([["Pole x", "-100001", "±100000"]] as const) : []),
    ] as const) {
      const before = await field(page, name).inputValue();
      await field(page, name).fill(text);
      await expect(page.getByRole("alert")).toContainText(message);
      await field(page, name).fill(before);
      await settled(page);
      await expect(page.getByRole("alert")).toHaveCount(0);
    }
    await page
      .getByLabel("Curve to invert", { exact: true })
      .selectOption(derived ? "base" : "orthotomic");
    await settled(page);
    await expect(field(page, "Pole z")).toHaveCount(derived ? 0 : 1);
    expect((await config(page))?.inversion.input).toBe(
      derived ? "base" : "orthotomic",
    );
    await page.getByText("Sampling & definition", { exact: true }).click();
    await page.getByLabel("Curve samples", { exact: true }).fill("721");
    await page.getByLabel("Correspondences", { exact: true }).fill("37");
    await expect(page.getByRole("status")).toHaveText(
      "721 samples · 37 correspondences",
    );
  });

test("a curve through the center is reported, not joined across infinity", async ({
  page,
}) => {
  await ready(page);
  await page
    .getByLabel("Construction", { exact: true })
    .selectOption("inversion");
  await settled(page);
  // Put the center on the trefoil between its first two samples (t = 0 and
  // 2π/960), so the curve passes through it between samples.
  const t = 0.001,
    h = 2.4 + 0.85 * Math.cos(3 * t);
  for (const [axis, value] of [
    ["x", h * Math.cos(2 * t)],
    ["y", h * Math.sin(2 * t)],
    ["z", 0.85 * Math.sin(3 * t)],
  ] as const)
    await field(page, `Center ${axis}`).fill(String(value));
  await expect
    .poll(async () => (await config(page))?.inversion?.center?.z)
    .toBeCloseTo(0.85 * Math.sin(3 * t), 12);
  await settled(page);
  await expect(page.getByText(/1 passages through the center/)).toBeVisible();
});

test("inversion reveal, pause/resume and edits preserve the original study", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, trefoil);
  await settled(page);
  const original = await config(page),
    full = await pixels(page);
  await openAnimation(page);
  await page.getByLabel("Duration (seconds)").fill("5");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Animation progress" });
  await slider.fill("0.5");
  await expect(stage(page)).toHaveAttribute("data-progress", "0.5");
  expect(await pixels(page)).not.toBe(full);
  const halfway = await pixels(page);
  await slider.fill("1");
  await expect(stage(page)).toHaveAttribute("data-progress", "1");
  expect(await pixels(page)).toBe(full);
  await slider.fill("0.5");
  await expect(stage(page)).toHaveAttribute("data-progress", "0.5");
  expect(await pixels(page)).toBe(halfway);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect
    .poll(async () => +(await stage(page).getAttribute("data-progress"))!)
    .toBeGreaterThan(0.5);
  await field(page, "Sphere radius R").fill("e");
  await expect(stage(page)).not.toHaveAttribute("data-progress");
  await expect
    .poll(async () => (await config(page))?.inversion?.radius)
    .toBe(Math.E);
  expect((await config(page)).inversion.center).toEqual(
    original.inversion.center,
  );
  // A replacement preset invalidates pending scalar work.
  await field(page, "Center x").fill("pi");
  await choosePreset(page, staircase);
  await settled(page);
  expect((await config(page)).inversion).toEqual(
    spatialPresets[+staircase].config.inversion,
  );
});

for (const camera of ["hold", "current", "follow", "fit"])
  test(`inversion playback reaches exact endpoints with the ${camera} camera`, async ({
    page,
  }) => {
    await ready(page);
    await page
      .getByLabel("Construction", { exact: true })
      .selectOption("inversion");
    await settled(page);
    const base = await config(page);
    await openAnimation(page);
    await page
      .getByLabel("Animate", { exact: true })
      .selectOption("parameters");
    await page
      .getByLabel("Parameter 1", { exact: true })
      .selectOption("sphere");
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
    expect((await config(page)).inversion.radius).toBe(
      1 / ((1 + Math.sqrt(5)) / 2),
    );
    const first = await framing();
    await slider.fill("1");
    await expect(stage(page)).toHaveAttribute("data-progress", "1");
    expect((await config(page)).inversion.radius).toBe(Math.E);
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

test("an inversion MP4 decodes with exact duration and a moving center", async ({
  page,
}) => {
  test.slow();
  await ready(page);
  await choosePreset(page, trefoil);
  await settled(page);
  await openAnimation(page);
  await page.getByLabel("Animate", { exact: true }).selectOption("parameters");
  await expect(page.getByLabel("Parameter 1", { exact: true })).toHaveValue(
    "centerX",
  );
  await page.getByLabel("Track 1 from").fill("0");
  await page.getByLabel("Track 1 to").fill("1.5");
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
    expect(data.width).toBe(1000);
    expect(data.height).toBe(760);
    expect(data.durations.reduce((a, b) => a + b, 0)).toBe(400);
  }
  const video = await decodeVideo(page, await readFile(path));
  expect(video.duration).toBeCloseTo(0.4, 3);
  expect(video.first.hash).not.toBe(video.last.hash);
});

test("inversion reveal keeps image breaks, correspondences and the center in frame", () => {
  const origin = { x: 0, y: 0, z: 0 },
    center = { x: -100, y: 20, z: -30 },
    far = { x: 90, y: 30, z: -10 };
  const points = [far, null, far, far];
  const input: SpatialResult = {
    base: [origin, origin, origin, origin],
    minus: [],
    plus: [],
    mesh: [],
    rulings: [],
    breaks: [false, false, false, false],
    bounds: { center: origin, radius: 100 },
    radius: 100,
    invalid: 0,
    omitted: 0,
    inversion: {
      center,
      radius: 3,
      input: "base",
      source: [origin, origin, origin, origin],
      points,
      breaks: [false, false, true, false],
      invalid: 1,
      crossings: 1,
      collapsed: false,
      correspondences: [0, 2, 3].map((sampleIndex) => ({
        sampleIndex,
        source: origin,
        image: points[sampleIndex]!,
      })),
    },
  };
  const prefix = reveal(input, 2 / 3);
  expect(prefix.inversion?.points).toEqual(points.slice(0, 3));
  expect(prefix.inversion?.breaks).toEqual([false, false, true]);
  expect(prefix.inversion?.correspondences.map((c) => c.sampleIndex)).toEqual([
    0, 2,
  ]);
  expect(prefix.inversion?.center).toEqual(center);
  expect(prefix.bounds.center.x).toBeLessThan(0);
  expect(prefix.bounds.radius).toBeGreaterThan(90);
  expect(input.inversion?.points).toHaveLength(4);

  const base = structuredClone(spatialPresets[+perpendiculars].config);
  expect(availableTargets(base).slice(0, 7)).toEqual([
    "centerX",
    "centerY",
    "centerZ",
    "sphere",
    "poleX",
    "poleY",
    "poleZ",
  ]);
  expect(
    availableTargets({
      ...base,
      inversion: { ...base.inversion, input: "base" },
    }),
  ).not.toContain("poleX");
  const tracks = [
    { target: "centerX", from: -Math.PI, to: Math.E },
    { target: "centerZ", from: 2, to: 7 },
    { target: "sphere", from: 0.5, to: 4 },
  ] as const;
  const start = applyTracks(base, [...tracks], -0.01).config.inversion;
  expect(start.center).toEqual({ x: -Math.PI, y: 0, z: 2 });
  expect(start.radius).toBe(0.5);
  const end = applyTracks(base, [...tracks], 1).config.inversion;
  expect(end.center).toEqual({ x: Math.E, y: 0, z: 7 });
  expect(end.radius).toBe(4);
  expect(base.inversion).toEqual(
    spatialPresets[+perpendiculars].config.inversion,
  );
});

test("sphere inversion SVG export preserves the sphere layer and construction name", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, trefoil);
  await settled(page);
  await page
    .getByRole("checkbox", { name: "Inversion sphere & center", exact: true })
    .uncheck();
  await page.getByRole("button", { name: "Export image", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /^SVG/ }).click();
  const svg = await readFile((await (await downloading).path())!, "utf8");
  expect(svg).toContain(
    "<title>Tangent Garden — spatial sphere inversion</title>",
  );
  const metadata = JSON.parse(svg.match(/<desc>(.*?)<\/desc>/s)![1]);
  expect(metadata.config).toEqual(await config(page));
  expect(metadata.layers.sphere).toBe(false);
  const png = Buffer.from(svg.match(/base64,([^"]+)/)![1], "base64");
  expect(png.readUInt32BE(16)).toBe(2000);
  expect(png.readUInt32BE(20)).toBe(1520);
});
