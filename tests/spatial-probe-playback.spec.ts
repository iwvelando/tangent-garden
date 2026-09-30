import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { choosePreset } from "./helpers";
import { probe, decodeVideo, frameDifference } from "./video";

// Moving the parameter probe along t as an animation, through the real
// notebook, worker, engine and exporter.
const stage = (page: Page) => page.locator(".spatial-stage");
const settled = (page: Page) =>
  expect(stage(page)).toHaveAttribute("aria-busy", "false");
const probeSwitch = (page: Page) =>
  page.getByRole("checkbox", {
    name: "Frame, curvature & torsion at a point",
  });
const point = (page: Page) => page.getByRole("slider", { name: "Point" });
const readout = (page: Page) => page.locator(".probe-readout dd");
const mode = (page: Page) => page.getByLabel("Animate", { exact: true });
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const pixels = (page: Page) =>
  page
    .locator("#spatial-artwork")
    .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
const view = async (page: Page) =>
  JSON.parse((await stage(page).getAttribute("data-camera"))!);
async function seek(page: Page, p: string) {
  await page.getByRole("slider", { name: "Animation progress" }).fill(p);
  await expect(stage(page)).toHaveAttribute("data-progress", p);
}
const helix = { label: "Helix · a ribbon staircase" };
// The helix preset, r = (2 cos t, 2 sin t, t/3) on [−3π, 3π] with 960
// samples, with the probe on and the animation section open.
async function probing(page: Page) {
  await page.goto("/?study=3d");
  await expect(page.locator("#spatial-artwork")).toBeVisible();
  await settled(page);
  await choosePreset(page, helix);
  await probeSwitch(page).check();
  await settled(page);
  await expect(readout(page)).toHaveCount(3);
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
}
const options = (page: Page) =>
  mode(page)
    .locator("option")
    .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));

test("probe playback is offered only while the probe is on", async ({
  page,
}) => {
  await probing(page);
  expect(await options(page)).toEqual([
    "reveal",
    "parameters",
    "orbit",
    "probe",
  ]);
  await expect(mode(page)).toHaveValue("reveal");
  await mode(page).selectOption("probe");
  await expect(page.locator("#spatial-animation-section")).toContainText(
    "Move the probe from the start of the curve to its end",
  );
  // Turning the probe off falls back to revealing.
  await probeSwitch(page).uncheck();
  await settled(page);
  await expect(mode(page)).toHaveValue("reveal");
  expect(await options(page)).toEqual(["reveal", "parameters", "orbit"]);
  // And it plays as a reveal, not as the probe it no longer offers.
  await button(page, "Play animation").click();
  await expect(stage(page)).toHaveAttribute("data-mode", "reveal");
  await button(page, "Pause").click();
  await seek(page, "0.5");
  await button(page, "Stop").click();
  await expect(stage(page)).not.toHaveAttribute("data-mode");
  // So does a study without a probe, and it stays away there.
  await probeSwitch(page).check();
  await settled(page);
  await mode(page).selectOption("probe");
  await choosePreset(page, { label: "A torus revealing its centers" });
  await settled(page);
  await expect(mode(page)).toHaveValue("reveal");
  expect(await options(page)).not.toContain("probe");
});

test("probe playback visits every sample from the first to the last, then restores the probe", async ({
  page,
}) => {
  await probing(page);
  // The user's own probe, one step from the start.
  await point(page).focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  const mine = "t = -9.405, sample 1 of 960";
  await expect(point(page)).toHaveAttribute("aria-valuetext", mine);
  const study = await pixels(page);
  await mode(page).selectOption("probe");
  await page.getByLabel("Duration (seconds)").fill("5");
  await button(page, "Play animation").click();
  await expect(stage(page)).toHaveAttribute("data-mode", "probe");
  await button(page, "Pause").click();
  const paused = await stage(page).getAttribute("data-progress");
  await page.waitForTimeout(100);
  expect(await stage(page).getAttribute("data-progress")).toBe(paused);
  // The panel follows the animation's sample; its slider waits.
  await expect(point(page)).toBeDisabled();
  // 0.001 of 960 samples is 0.96 of a step: the nearest sample is 1.
  await seek(page, "0.001");
  await expect(point(page)).toHaveAttribute(
    "aria-valuetext",
    "t = -9.405, sample 1 of 960",
  );
  await seek(page, "0");
  await expect(point(page)).toHaveAttribute(
    "aria-valuetext",
    "t = -9.425, sample 0 of 960",
  );
  await expect(page.locator(".animation-values")).toHaveText(
    "Probe at t = -9.42478",
  );
  // κ and τ are constant on a helix.
  await expect(readout(page)).toHaveText(["0.4865", "2.056", "0.08108"]);
  const start = await pixels(page);
  expect(start).not.toBe(study);
  await seek(page, "0.5");
  await expect(point(page)).toHaveAttribute(
    "aria-valuetext",
    "t = 0, sample 480 of 960",
  );
  await expect(page.locator(".animation-values")).toHaveText("Probe at t = 0");
  const middle = await pixels(page);
  expect(middle).not.toBe(start);
  await seek(page, "1");
  await expect(point(page)).toHaveAttribute(
    "aria-valuetext",
    "t = 9.425, sample 960 of 960",
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
  await expect(point(page)).toBeEnabled();
  await expect(point(page)).toHaveAttribute("aria-valuetext", mine);
  expect(await pixels(page)).toBe(study);
});

test("turning the probe off during probe playback stops it", async ({
  page,
}) => {
  await probing(page);
  const study = await pixels(page);
  await mode(page).selectOption("probe");
  await button(page, "Play animation").click();
  await button(page, "Pause").click();
  await seek(page, "0.25");
  await probeSwitch(page).uncheck();
  await expect(stage(page)).not.toHaveAttribute("data-progress");
  await expect(button(page, "Play animation")).toBeEnabled();
  await probeSwitch(page).check();
  await settled(page);
  expect(await pixels(page)).toBe(study);
});

for (const camera of ["hold", "current", "follow", "fit"])
  test(`probe playback holds the ${camera} camera over the fixed study`, async ({
    page,
  }) => {
    await probing(page);
    await mode(page).selectOption("probe");
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
    const last = await view(page);
    // The geometry never changes, so neither does any camera.
    expect(last).toEqual(first);
    expect(first.zoom).toBe(camera === "current" ? 1.1 : 1);
    expect(first.panX === 0).toBe(camera !== "current");
    // Stop returns the manual camera and the user's probe.
    await seek(page, "0.5");
    await button(page, "Stop").click();
    await expect(stage(page)).not.toHaveAttribute("data-camera");
    expect(await pixels(page)).toBe(study);
  });

// A still PNG's pixels, as RGBA.
async function still(page: Page) {
  await button(page, "Export image").click();
  const event = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /^PNG image/ }).click();
  const bytes = await readFile((await (await event).path())!);
  return page.evaluate(async (input) => {
    const image = new Image();
    image.src = URL.createObjectURL(
      new Blob([new Uint8Array(input)], { type: "image/png" }),
    );
    await image.decode();
    const c = document.createElement("canvas");
    c.width = image.width;
    c.height = image.height;
    const g = c.getContext("2d")!;
    g.drawImage(image, 0, 0);
    return Array.from(g.getImageData(0, 0, c.width, c.height).data);
  }, Array.from(bytes));
}
// An MP4 at the still images' 2000 × 1520, six frames over 0.4 s.
async function exportVideo(page: Page) {
  await page.getByLabel("Duration (seconds)").fill("0.4");
  await page.locator("#spatial-export-settings > summary").click();
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

test("a probe playback export draws the probe at each frame's sample", async ({
  page,
}) => {
  test.slow();
  await probing(page);
  // Stills of the probe at the first and last samples, in the manual view
  // that the animation's current camera keeps.
  await point(page).focus();
  await page.keyboard.press("Home");
  const first = await still(page);
  await point(page).focus();
  await page.keyboard.press("End");
  const last = await still(page);
  await mode(page).selectOption("probe");
  await page
    .getByLabel("Animation camera", { exact: true })
    .selectOption("current");
  const { path, video } = await exportVideo(page);
  // The study is fixed: only the probe moves between frames.
  expect(video.first.hash).not.toBe(video.last.hash);
  const match = (index: number, reference: number[]) =>
    frameDifference(path, 2000, 1520, index, reference);
  const ends = [match(0, first), match(5, last)];
  const crossed = [match(0, last), match(5, first)];
  if (ends[0] && ends[1] && crossed[0] && crossed[1]) {
    console.log("Probe playback endpoints", { ends, crossed });
    for (const d of ends) {
      expect(d.meanDifference).toBeLessThan(6);
      expect(d.unmatchedInk).toBeLessThan(0.02);
    }
    // Swapping the ends leaves the probe's own ink unmatched.
    for (const [i, d] of crossed.entries()) {
      expect(d.unmatchedInk).toBeGreaterThan(0.003);
      expect(d.unmatchedInk).toBeGreaterThan(2 * ends[i]!.unmatchedInk);
    }
  }
  await expect(stage(page)).not.toHaveAttribute("data-progress");
  await expect(point(page)).toHaveAttribute(
    "aria-valuetext",
    "t = 9.425, sample 960 of 960",
  );
});

test("other animation exports still leave the probe out", async ({ page }) => {
  test.slow();
  await probing(page);
  await probeSwitch(page).uncheck();
  await settled(page);
  const bare = await still(page);
  await probeSwitch(page).check();
  await settled(page);
  await mode(page).selectOption("reveal");
  await page
    .getByLabel("Animation camera", { exact: true })
    .selectOption("current");
  const { path } = await exportVideo(page);
  // The last revealed frame is the whole study, without the probe.
  const d = frameDifference(path, 2000, 1520, 5, bare);
  if (d) {
    expect(d.meanDifference).toBeLessThan(6);
    expect(d.unmatchedInk).toBeLessThan(0.02);
  }
});
