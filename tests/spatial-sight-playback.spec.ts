import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import { probe, decodeVideo, frameDifference } from "./video";
import { spatialPresets } from "../web/spatial/presets";
import { defaultLayers } from "../web/spatial/renderer";
import { defaultSight, type Sight } from "../web/spatial/sight";

// Seeing through during playback and in animation exports: every mode
// draws the entered sight, and an export keeps the one it began with.
const stage = (page: Page) => page.locator(".spatial-stage");
const settled = (page: Page) =>
  expect(stage(page)).toHaveAttribute("aria-busy", "false");
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const box = (page: Page) => page.getByRole("group", { name: "See through" });
const drawnSight = async (page: Page) => {
  const v = await page.locator("#spatial-artwork").getAttribute("data-sight");
  return v === null ? null : JSON.parse(v);
};
const tube = spatialPresets.find(
  (p) => p.name === "A tube around the trefoil",
)!;
function study(sight: Partial<Sight> | null, mode = "orbit") {
  return {
    config: structuredClone(tube.config),
    layers: { ...defaultLayers },
    view: { yaw: 0.3, pitch: 0.75, zoom: 1, panX: 0, panY: 0 },
    animation: { mode, camera: "current", duration: 5, tracks: [] },
    ...(sight && { sight: { ...defaultSight, ...sight } }),
  };
}
async function open(page: Page, s: unknown) {
  await page.goto(
    `/?study=3d#s=${deflateRawSync(
      Buffer.from(JSON.stringify({ v: 1, notebook: "3d", study: s })),
    ).toString("base64url")}`,
  );
  await expect(page.locator("#spatial-artwork")).toBeVisible();
  await settled(page);
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
}
async function still(page: Page) {
  await button(page, "Export image").click();
  const event = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /^PNG image/ }).click();
  const png = await readFile((await (await event).path())!);
  const rgba = await page.evaluate(async (input) => {
    const image = new Image();
    image.src = `data:image/png;base64,${input}`;
    await image.decode();
    const c = document.createElement("canvas");
    c.width = image.width;
    c.height = image.height;
    const g = c.getContext("2d")!;
    g.drawImage(image, 0, 0);
    const data = g.getImageData(0, 0, c.width, c.height).data;
    let text = "";
    for (let i = 0; i < data.length; i += 0x8000)
      text += String.fromCharCode(...data.subarray(i, i + 0x8000));
    return btoa(text);
  }, png.toString("base64"));
  return Buffer.from(rgba, "base64");
}
const through = { sheets: "through", opacity: 0.35, hidden: "dashed" } as const;

test("playback draws the entered sight in every mode, and Stop leaves it", async ({
  page,
}) => {
  await open(page, study(through, "reveal"));
  const mode = page.getByLabel("Animate", { exact: true });
  for (const m of ["reveal", "parameters", "orbit"]) {
    await mode.selectOption(m);
    await button(page, "Play animation").click();
    await expect(stage(page)).toHaveAttribute("data-mode", m);
    await button(page, "Pause").click();
    await page.getByRole("slider", { name: "Animation progress" }).fill("0.5");
    await expect(stage(page)).toHaveAttribute("data-progress", "0.5");
    expect(await drawnSight(page)).toEqual(through);
    // Changed while paused, the drawing follows.
    await box(page)
      .getByLabel("Lines behind sheets", { exact: true })
      .selectOption("faint");
    await expect
      .poll(() => drawnSight(page))
      .toEqual({ ...through, hidden: "faint" });
    await box(page)
      .getByLabel("Lines behind sheets", { exact: true })
      .selectOption("dashed");
    await button(page, "Stop").click();
    await expect(stage(page)).not.toHaveAttribute("data-progress");
    expect(await drawnSight(page)).toEqual(through);
  }
});

test("an orbit's export draws the sight it began with and ends on the still", async ({
  page,
}) => {
  test.slow();
  await open(page, study(through));
  const seen = await still(page);
  await open(page, study(null));
  const opaque = await still(page);
  await open(page, study(through));
  await page.getByLabel("Duration (seconds)").fill("0.4");
  const settings = page.locator("#spatial-export-settings");
  if ((await settings.getAttribute("open")) === null)
    await settings.locator(":scope > summary").click();
  await page.getByLabel("Export format", { exact: true }).selectOption("mp4");
  await page.getByLabel("Export frame rate").selectOption("15");
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("2");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export MP4/ }).click();
  // Changing the sight once the export has begun does not reach it.
  await box(page).getByLabel("Sheets", { exact: true }).selectOption("opaque");
  const path = (await (await download).path())!;
  const data = probe(path);
  if (data) {
    expect(data.frames).toBe(6);
    expect([data.width, data.height]).toEqual([2000, 1520]);
  }
  const video = await decodeVideo(page, await readFile(path));
  expect(video.duration).toBeCloseTo(0.4, 3);
  // A full turn later, the last frame is the see-through still, not the
  // opaque one.
  const d = frameDifference(path, 2000, 1520, 5, seen);
  const other = frameDifference(path, 2000, 1520, 5, opaque);
  if (d && other) {
    console.log("Sight export", { d, other });
    expect(d.meanDifference).toBeLessThan(3);
    expect(other.meanDifference).toBeGreaterThan(3 * d.meanDifference);
  }
});
