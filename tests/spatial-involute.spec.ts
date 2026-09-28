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

test("the involute construction draws filaments and strings with their own layers", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await ready(page);
  await page
    .getByLabel("Construction", { exact: true })
    .selectOption("involute");
  await settled(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Filaments unwound from a curve",
  );
  await expect(page.locator(".plot-meta .legend")).toContainText(
    "Involute filaments",
  );
  await expect(field(page, "Tangent reach L")).toHaveCount(0);
  await expect(page.getByLabel("Ribbon surface")).toHaveCount(0);
  await expect(page.getByLabel("Unwinding strings").first()).toBeVisible();
  const original = await pixels(page);
  for (const layer of ["Involute filaments", "Unwinding strings"]) {
    const box = page.getByRole("checkbox", { name: layer, exact: true });
    await box.uncheck();
    expect(await pixels(page)).not.toBe(original);
    await box.check();
    expect(await pixels(page)).toBe(original);
  }
  // Tangent developable edits survive the round trip.
  await page
    .getByLabel("Construction", { exact: true })
    .selectOption("developable");
  await expect(field(page, "Tangent reach L")).toHaveValue("2.3");
  expect(errors).toEqual([]);
});

test("anchors, string lengths, and family counts are validated", async ({
  page,
}) => {
  await ready(page);
  await page
    .getByLabel("Construction", { exact: true })
    .selectOption("involute");
  await field(page, "Anchor t₀").fill("7");
  await expect(page.getByRole("alert")).toContainText("anchor");
  await field(page, "Anchor t₀").fill("pi");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await field(page, "String length c").fill("100001");
  await expect(page.getByRole("alert")).toContainText("±100000");
  await field(page, "String length c").fill("2");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect.poll(async () => (await config(page))?.involute?.offset).toBe(2);
  await page.getByRole("checkbox", { name: "Family of involutes" }).check();
  await expect(field(page, "String length c")).toHaveCount(0);
  const count = page.getByLabel("Involutes", { exact: true });
  await count.fill("2.5");
  await expect(page.getByRole("alert")).toContainText("whole number");
  await count.fill("25");
  await expect(page.getByRole("alert")).toContainText("2–24");
  await page.getByText("Sampling & definition", { exact: true }).click();
  await page.getByLabel("Curve samples", { exact: true }).fill("2400");
  await count.fill("24");
  await expect(page.getByRole("alert")).toContainText("48000 points");
  await page.getByLabel("Curve samples", { exact: true }).fill("960");
  await count.fill("3");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("960 samples · 96 strings");
  await settled(page);
  expect((await config(page)).involute.family).toEqual({
    enabled: true,
    from: -2,
    to: 2,
    count: 3,
  });
});

test("involute presets animate string lengths to exact endpoints and reveal from the anchor's grid", async ({
  page,
}) => {
  await ready(page);
  for (const preset of ["5", "6"]) {
    await choosePreset(page, preset);
    await settled(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
  await page.getByLabel("Animate", { exact: true }).selectOption("parameters");
  await expect(page.getByLabel("Parameter 1", { exact: true })).toHaveValue(
    "from",
  );
  await page.getByLabel("Parameter 1", { exact: true }).selectOption("count");
  await page.getByLabel("Track 1 from").fill("2");
  await page.getByLabel("Track 1 to").fill("5");
  await page.getByRole("button", { name: "Add parameter" }).click();
  await page.getByLabel("Parameter 2", { exact: true }).selectOption("to");
  await page.getByLabel("Track 2 from").fill("1");
  await page.getByLabel("Track 2 to").fill("2*pi");
  await page.getByLabel("Duration (seconds)").fill("5");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(stage(page)).toHaveAttribute("data-mode", "parameters");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Animation progress" });
  await slider.fill("0");
  await expect(stage(page)).toHaveAttribute("data-progress", "0");
  expect((await config(page)).involute.family).toMatchObject({
    count: 2,
    to: 1,
  });
  await slider.fill("1");
  await expect(stage(page)).toHaveAttribute("data-progress", "1");
  expect((await config(page)).involute.family).toMatchObject({
    count: 5,
    to: 2 * Math.PI,
  });
  await slider.fill("0.5");
  await expect(stage(page)).toHaveAttribute("data-progress", "0.5");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(stage(page)).not.toHaveAttribute("data-mode");
  expect((await config(page)).involute.family).toMatchObject({
    count: 7,
    to: 6,
  });
  // Reveal truncates the final filaments without re-measuring arc length.
  await page.getByLabel("Animate", { exact: true }).selectOption("reveal");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await slider.fill("0.5");
  await expect(stage(page)).toHaveAttribute("data-progress", "0.5");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

for (const camera of ["hold", "current", "follow", "fit"])
  test(`string length playback reaches exact endpoints with the ${camera} camera`, async ({
    page,
  }) => {
    await ready(page);
    await page
      .getByLabel("Construction", { exact: true })
      .selectOption("involute");
    await settled(page);
    const base = await config(page);
    const panel = page.locator("#spatial-animation-section");
    if ((await panel.getAttribute("open")) === null)
      await panel.locator(":scope > summary").click();
    await page
      .getByLabel("Animate", { exact: true })
      .selectOption("parameters");
    await expect(page.getByLabel("Parameter 1", { exact: true })).toHaveValue(
      "offset",
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
    expect((await config(page)).involute.offset).toBe(-Math.PI);
    const first = await framing();
    await slider.fill("1");
    await expect(stage(page)).toHaveAttribute("data-progress", "1");
    expect((await config(page)).involute.offset).toBe(Math.E);
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

test("an involute MP4 decodes with exact duration and changing filaments", async ({
  page,
}) => {
  test.slow();
  await ready(page);
  await choosePreset(page, "6");
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
