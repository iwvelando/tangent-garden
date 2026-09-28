import { applyTracks, reveal } from "../web/spatial/animation";
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
  return JSON.parse((await stage(page).getAttribute("data-config"))!);
}
const pixels = (page: Page) =>
  page
    .locator("#spatial-artwork")
    .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());

for (const [preset, kind, label] of [
  ["7", "tangent-foot", "Tangent-foot curve"],
  ["8", "orthotomic", "Tangent-line orthotomic"],
] as const)
  test(`${kind} has independent layers, pole controls and restored edits`, async ({
    page,
  }) => {
    await ready(page);
    await choosePreset(page, preset);
    await settled(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(label);
    await expect(field(page, "Tangent reach L")).toHaveCount(0);
    await expect(page.getByLabel("Ribbon surface")).toHaveCount(0);
    const original = await pixels(page);
    for (const layer of [
      label,
      "Perpendiculars & tangent feet",
      "Pole marker",
    ]) {
      const box = page.getByRole("checkbox", { name: layer, exact: true });
      await box.uncheck();
      expect(await pixels(page)).not.toBe(original);
      await box.check();
      expect(await pixels(page)).toBe(original);
    }
    await field(page, "Pole z").fill("100001");
    await expect(page.getByRole("alert")).toContainText("±100000");
    await field(page, "Pole z").fill("pi");
    await settled(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page
      .getByLabel("Construction", { exact: true })
      .selectOption("developable");
    await settled(page);
    await page.getByLabel("Construction", { exact: true }).selectOption(kind);
    await settled(page);
    expect((await config(page)).pole.z).toBe(Math.PI);
    await page.getByText("Sampling & definition", { exact: true }).click();
    await page.getByLabel("Curve samples", { exact: true }).fill("721");
    await page
      .getByLabel("Projection constructions", { exact: true })
      .fill("37");
    await expect(page.getByRole("status")).toHaveText(
      "721 samples · 37 projections",
    );
  });

test("projection reveal, pause/resume and edits preserve the original study", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, "7");
  await settled(page);
  const original = await config(page),
    full = await pixels(page);
  await page.locator("#spatial-animation-section > summary").click();
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
  await field(page, "Pole x").fill("e");
  await expect(stage(page)).not.toHaveAttribute("data-progress");
  await expect.poll(async () => (await config(page)).pole.x).toBe(Math.E);
  expect((await config(page)).pole.y).toBe(original.pole.y);
  // A replacement preset invalidates pending scalar work.
  await field(page, "Pole y").fill("pi");
  await choosePreset(page, "8");
  await settled(page);
  expect((await config(page)).pole).toEqual({ x: 1.5, y: 0, z: 0 });
});

for (const camera of ["hold", "current", "follow", "fit"])
  test(`pole playback reaches exact endpoints with the ${camera} camera`, async ({
    page,
  }) => {
    await ready(page);
    await page
      .getByLabel("Construction", { exact: true })
      .selectOption("orthotomic");
    await settled(page);
    const base = await config(page);
    const panel = page.locator("#spatial-animation-section");
    if ((await panel.getAttribute("open")) === null)
      await panel.locator(":scope > summary").click();
    await page
      .getByLabel("Animate", { exact: true })
      .selectOption("parameters");
    await expect(page.getByLabel("Parameter 1", { exact: true })).toHaveValue(
      "poleX",
    );
    await page.getByLabel("Track 1 from").fill("-pi");
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
    expect((await config(page)).pole.x).toBe(-Math.PI);
    const first = await framing();
    await slider.fill("1");
    await expect(stage(page)).toHaveAttribute("data-progress", "1");
    expect((await config(page)).pole.x).toBe(Math.E);
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

test("a tangent-foot MP4 decodes with exact duration and changing pole projections", async ({
  page,
}) => {
  test.slow();
  await ready(page);
  await choosePreset(page, "7");
  await settled(page);
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
  await page.getByLabel("Animate", { exact: true }).selectOption("parameters");
  await page.getByLabel("Track 1 from").fill("0");
  await page.getByLabel("Track 1 to").fill("-4");
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
  expect(file.suggestedFilename()).toBe(
    "tangent-garden-spatial-parameters.mp4",
  );
});

test("projection reveal keeps correspondence, gaps and independent bounds", () => {
  const origin = { x: 0, y: 0, z: 0 },
    pole = { x: 100, y: 20, z: -30 };
  const points = [pole, null, { x: 90, y: 30, z: -10 }, pole];
  const input: SpatialResult = {
    base: [origin, origin, origin, origin],
    minus: [],
    plus: [],
    mesh: [],
    rulings: [],
    breaks: [false, true, true, false],
    bounds: { center: origin, radius: 100 },
    radius: 100,
    invalid: 0,
    omitted: 0,
    projection: {
      pole,
      points,
      feet: points,
      invalid: 1,
      collapsed: false,
      constructions: [0, 2, 3].map((sampleIndex) => ({
        sampleIndex,
        contact: origin,
        foot: points[sampleIndex]!,
        image: points[sampleIndex]!,
      })),
    },
  };
  const prefix = reveal(input, 2 / 3);
  expect(prefix.projection?.points).toEqual(points.slice(0, 3));
  expect(prefix.projection?.constructions.map((c) => c.sampleIndex)).toEqual([
    0, 2,
  ]);
  expect(prefix.breaks).toEqual([false, true, true]);
  expect(prefix.bounds.radius).toBeGreaterThan(50);
  expect(prefix.projection?.pole).toEqual(pole);
  expect(input.projection?.points).toHaveLength(4);
  const base = structuredClone(spatialPresets[7].config);
  const tracks = [
    { target: "poleX", from: -Math.PI, to: Math.E },
    { target: "poleY", from: 2, to: 7 },
    { target: "poleZ", from: -3, to: 4 },
  ] as const;
  expect(applyTracks(base, [...tracks], -0.01).config.pole).toEqual({
    x: -Math.PI,
    y: 2,
    z: -3,
  });
  expect(applyTracks(base, [...tracks], 1).config.pole).toEqual({
    x: Math.E,
    y: 7,
    z: 4,
  });
  expect(base.pole).toEqual({ x: 0, y: 0, z: 2 });
});

for (const [preset, title] of [
  ["7", "spatial tangent-foot projection"],
  ["8", "spatial tangent-line orthotomic"],
])
  test(`${title} SVG export preserves pole, layers and construction name`, async ({
    page,
  }) => {
    await ready(page);
    await choosePreset(page, preset);
    await settled(page);
    await page
      .getByRole("checkbox", { name: "Pole marker", exact: true })
      .uncheck();
    await page
      .getByRole("button", { name: "Export image", exact: true })
      .click();
    const downloading = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: /^SVG/ }).click();
    const svg = await readFile((await (await downloading).path())!, "utf8");
    expect(svg).toContain(`<title>Tangent Garden — ${title}</title>`);
    const metadata = JSON.parse(svg.match(/<desc>(.*?)<\/desc>/s)![1]);
    expect(metadata.config).toEqual(await config(page));
    expect(metadata.layers.pole).toBe(false);
    const png = Buffer.from(svg.match(/base64,([^"]+)/)![1], "base64");
    expect(png.readUInt32BE(16)).toBe(2000);
    expect(png.readUInt32BE(20)).toBe(1520);
  });
