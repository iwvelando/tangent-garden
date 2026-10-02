import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import { probe, decodeVideo, frameDifference } from "./video";
import { open as openDetails } from "./helpers";
import { spatialPresets } from "../web/spatial/presets";
import { defaultLayers } from "../web/spatial/renderer";
import { defaultCut, type Cut } from "../web/spatial/cut";

// Peeling the drawing away with the cut plane, through the real notebook,
// worker, engine and exporter. The study is a sphere of radius 1.2 about
// the origin whose grid has samples at x = ±1.2, so with n = (1, 0, 0) the
// peel runs from d = 1.2 to d = −1.2, as the mesh's float32 points hold
// them.
const R = 1.2;
const stage = (page: Page) => page.locator(".spatial-stage");
const settled = (page: Page) =>
  expect(stage(page)).toHaveAttribute("aria-busy", "false");
const mode = (page: Page) => page.getByLabel("Animate", { exact: true });
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const box = (page: Page) => page.getByRole("group", { name: "Cut away" });
const enable = (page: Page) =>
  box(page).getByRole("checkbox", { name: "Cut with a plane" });
const pixels = (page: Page) =>
  page
    .locator("#spatial-artwork")
    .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
const view = async (page: Page) =>
  JSON.parse((await stage(page).getAttribute("data-camera"))!);
const drawnCut = async (page: Page) => {
  const value = await page.locator("#spatial-artwork").getAttribute("data-cut");
  return value === null ? null : JSON.parse(value);
};
const offset = async (page: Page) => (await drawnCut(page))?.plane.offset;
async function seek(page: Page, p: string) {
  await page.getByRole("slider", { name: "Animation progress" }).fill(p);
  await expect(stage(page)).toHaveAttribute("data-progress", p);
}
const options = (page: Page) =>
  mode(page)
    .locator("option")
    .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
const sphereIndex = spatialPresets.findIndex(
  (p) => p.name === "A sphere collapsing to one focus",
);
function sphere(cut: Partial<Cut>, animation = "cut") {
  const config = structuredClone(spatialPresets[sphereIndex].config);
  config.surface = {
    ...config.surface,
    a: R,
    b: R,
    c: R,
    uMin: 0,
    uMax: 2 * Math.PI,
    vMin: -Math.PI / 2,
    vMax: Math.PI / 2,
    uSamples: 48,
    vSamples: 24,
  };
  return {
    config,
    layers: Object.fromEntries(
      Object.keys(defaultLayers).map((k) => [k, k === "surface"]),
    ),
    view: { yaw: 0.3, pitch: 0.5, zoom: 1, panX: 0, panY: 0 },
    animation: { mode: animation, camera: "hold", duration: 5, tracks: [] },
    cut: { ...defaultCut, enabled: true, cuts: "surface", ...cut },
  };
}
async function open(page: Page, study: unknown) {
  await page.goto(
    `/?study=3d#s=${deflateRawSync(
      Buffer.from(JSON.stringify({ v: 1, notebook: "3d", study })),
    ).toString("base64url")}`,
  );
  await expect(page.locator("#spatial-artwork")).toBeVisible();
  await settled(page);
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
}
const mine = { normal: { x: 1, y: 0, z: 0 }, offset: 0.3 };

test("peeling is offered only while the cut is on and valid", async ({
  page,
}) => {
  await open(page, sphere(mine));
  await expect(mode(page)).toHaveValue("cut");
  expect(await options(page)).toEqual(["reveal", "parameters", "orbit", "cut"]);
  await expect(page.locator("#spatial-animation-section")).toContainText(
    "Move the cut plane along its normal",
  );
  // A zero normal leaves nothing to peel with: back to revealing.
  for (const axis of ["x", "y", "z"])
    await box(page).getByLabel(`Normal ${axis}`, { exact: true }).fill("0");
  await expect(mode(page)).toHaveValue("reveal");
  expect(await options(page)).not.toContain("cut");
  await box(page).getByLabel("Normal x", { exact: true }).fill("1");
  await mode(page).selectOption("cut");
  // Turning the cut off does the same, and plays as a reveal.
  await enable(page).uncheck();
  await expect(mode(page)).toHaveValue("reveal");
  await button(page, "Play animation").click();
  await expect(stage(page)).toHaveAttribute("data-mode", "reveal");
  await button(page, "Stop").click();
  // A cut that reaches nothing drawn cannot peel.
  await enable(page).check();
  await mode(page).selectOption("cut");
  await page
    .getByRole("checkbox", { name: "Surface patch", exact: true })
    .uncheck();
  await button(page, "Play animation").click();
  await expect(page.locator(".animation-error")).toContainText(
    "The cut reaches nothing drawn",
  );
});

test("the peel runs from the farthest drawn point to the nearest, exactly, then restores the plane", async ({
  page,
}) => {
  await open(page, sphere(mine));
  expect(await offset(page)).toBe(0.3);
  const study = await pixels(page);
  await button(page, "Play animation").click();
  await expect(stage(page)).toHaveAttribute("data-mode", "cut");
  await button(page, "Pause").click();
  const paused = await stage(page).getAttribute("data-progress");
  await page.waitForTimeout(100);
  expect(await stage(page).getAttribute("data-progress")).toBe(paused);
  // The entered plane waits while the animation moves it.
  await expect(
    box(page).getByLabel("Offset d", { exact: true }),
  ).toBeDisabled();
  await expect(box(page).getByLabel("Offset d", { exact: true })).toHaveValue(
    "0.3",
  );
  await seek(page, "0");
  expect(await offset(page)).toBe(Math.fround(R));
  await expect(page.locator(".animation-values")).toHaveText(
    "Cut at d = 1.20000",
  );
  const start = await pixels(page);
  // Nothing is hidden yet, so it draws as the uncut sphere; the entered
  // plane at 0.3 hid part of it.
  expect(start).not.toBe(study);
  await seek(page, "0.5");
  expect(Math.abs(await offset(page))).toBeLessThan(1e-7);
  const middle = await pixels(page);
  expect(middle).not.toBe(start);
  await seek(page, "1");
  expect(await offset(page)).toBe(Math.fround(-R));
  await expect(page.locator(".animation-values")).toHaveText(
    "Cut at d = -1.20000",
  );
  expect(await pixels(page)).not.toBe(middle);
  // Resume carries on from the scrubbed time.
  await seek(page, "0.5");
  await button(page, "Resume").click();
  await expect
    .poll(async () => Number(await stage(page).getAttribute("data-progress")))
    .toBeGreaterThan(0.5);
  await button(page, "Stop").click();
  await expect(stage(page)).not.toHaveAttribute("data-progress");
  await expect(box(page).getByLabel("Offset d", { exact: true })).toBeEnabled();
  expect(await offset(page)).toBe(0.3);
  expect(await pixels(page)).toBe(study);
});

test("turning the cut off during a peel stops it", async ({ page }) => {
  await open(page, sphere(mine));
  const study = await pixels(page);
  await button(page, "Play animation").click();
  await button(page, "Pause").click();
  await seek(page, "0.25");
  await enable(page).uncheck();
  await expect(stage(page)).not.toHaveAttribute("data-progress");
  await expect(button(page, "Play animation")).toBeEnabled();
  await enable(page).check();
  expect(await offset(page)).toBe(0.3);
  expect(await pixels(page)).toBe(study);
});

for (const camera of ["hold", "current", "follow", "fit"])
  test(`a peel holds the ${camera} camera over the fixed study`, async ({
    page,
  }) => {
    await open(page, sphere(mine));
    await page
      .getByLabel("Animation camera", { exact: true })
      .selectOption(camera);
    await page.locator("#spatial-artwork").focus();
    await page.keyboard.press("+");
    await page.keyboard.press("Shift+ArrowRight");
    const study = await pixels(page);
    await button(page, "Play animation").click();
    await button(page, "Pause").click();
    await seek(page, "0");
    const first = await view(page);
    await seek(page, "1");
    expect(await view(page)).toEqual(first);
    expect(first.zoom).toBe(camera === "current" ? 1.1 : 1);
    expect(first.panX === 0).toBe(camera !== "current");
    await seek(page, "0.5");
    await button(page, "Stop").click();
    await expect(stage(page)).not.toHaveAttribute("data-camera");
    expect(await pixels(page)).toBe(study);
  });

test("the entered cut stays put through other animations", async ({ page }) => {
  await open(page, sphere(mine, "orbit"));
  await expect(mode(page)).toHaveValue("orbit");
  const entered = await drawnCut(page);
  await button(page, "Play animation").click();
  await button(page, "Pause").click();
  for (const p of ["0", "1", "0.5"]) {
    await seek(page, p);
    expect(await drawnCut(page)).toEqual(entered);
  }
  await button(page, "Stop").click();
  await mode(page).selectOption("reveal");
  await button(page, "Play animation").click();
  await button(page, "Pause").click();
  await seek(page, "0.5");
  expect(await drawnCut(page)).toEqual(entered);
  await button(page, "Stop").click();
});

// A still PNG's pixels, as RGBA (see spatial-probe-playback.spec.ts).
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
async function exportVideo(page: Page) {
  await page.getByLabel("Duration (seconds)").fill("0.4");
  // Opened once; a second export finds it open.
  await openDetails(page, "#spatial-export-settings");
  await page.getByLabel("Export format", { exact: true }).selectOption("mp4");
  await page.getByLabel("Export frame rate").selectOption("15");
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("2");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export MP4/ }).click();
  const path = (await (await download).path())!;
  const data = probe(path);
  if (data) {
    expect(data.frames).toBe(6);
    expect([data.width, data.height]).toEqual([2000, 1520]);
    expect(data.durations.reduce((a, b) => a + b, 0)).toBe(400);
  }
  const video = await decodeVideo(page, await readFile(path));
  expect(video.duration).toBeCloseTo(0.4, 3);
  return { path, video };
}

test("a peel's export starts whole and ends with the surface gone; other exports keep the entered cut", async ({
  page,
}) => {
  test.slow();
  await open(page, sphere(mine));
  const offsetField = box(page).getByLabel("Offset d", { exact: true });
  // Stills at the peel's ends, in the manual view the current camera keeps.
  await offsetField.fill("1.2");
  await expect.poll(() => offset(page)).toBe(1.2);
  const first = await still(page);
  await offsetField.fill("-1.2");
  await expect.poll(() => offset(page)).toBe(-1.2);
  const last = await still(page);
  await offsetField.fill("0.3");
  await expect.poll(() => offset(page)).toBe(0.3);
  const entered = await still(page);
  await page
    .getByLabel("Animation camera", { exact: true })
    .selectOption("current");
  const { path, video } = await exportVideo(page);
  expect(video.first.hash).not.toBe(video.last.hash);
  const match = (index: number, reference: Buffer) =>
    frameDifference(path, 2000, 1520, index, reference);
  const ends = [match(0, first), match(5, last)];
  const crossed = [match(0, last), match(5, first)];
  if (ends[0] && ends[1] && crossed[0] && crossed[1]) {
    console.log("Peel endpoints", { ends, crossed });
    // The first frame is the whole sphere. The last has almost no ink
    // left, so a share of unmatched ink means little there; its pixels
    // match the still's instead.
    expect(ends[0].meanDifference).toBeLessThan(6);
    expect(ends[0].unmatchedInk).toBeLessThan(0.02);
    expect(ends[1].meanDifference).toBeLessThan(0.5);
    // Swapped, the ends differ by the whole sphere.
    for (const d of crossed) {
      expect(d.meanDifference).toBeGreaterThan(20);
      expect(d.unmatchedInk).toBeGreaterThan(0.5);
    }
  }
  await expect(stage(page)).not.toHaveAttribute("data-progress");
  expect(await offset(page)).toBe(0.3);
  // An orbit export draws the entered cut: its last frame, a full turn
  // later, is the still at 0.3.
  await mode(page).selectOption("orbit");
  const orbit = await exportVideo(page);
  const d = frameDifference(orbit.path, 2000, 1520, 5, entered);
  const uncut = frameDifference(orbit.path, 2000, 1520, 5, first);
  if (d && uncut) {
    expect(d.meanDifference).toBeLessThan(6);
    expect(d.unmatchedInk).toBeLessThan(0.02);
    expect(uncut.unmatchedInk).toBeGreaterThan(2 * d.unmatchedInk);
  }
});
