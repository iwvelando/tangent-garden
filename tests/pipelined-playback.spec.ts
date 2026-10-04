import { test, expect, type Page } from "@playwright/test";
import { choosePreset, openAnimation, openShapeAnimation } from "./helpers";
import { engines, watchEngines } from "./engines";

// Live playback of calculated frames in the 2D and 4D notebooks shares the
// 3D notebook's loop (web/playback.ts): a helper engine calculates while the
// app's engine draws, alive only while playback runs. The helper takes a
// frame only while the app's engine is still busy, so the studies are made
// slow to calculate.

const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });

async function planar(page: Page) {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await openAnimation(page);
  await choosePreset(page, "2");
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
}
const planarProgress = (page: Page) =>
  page.locator("#artwork").getAttribute("data-animation-progress");
const planarDefinition = async (page: Page) =>
  JSON.parse((await page.locator("#artwork desc").textContent())!);
async function lightTrack(page: Page, seconds: string) {
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("parameters");
  await expect(
    page.getByRole("combobox", { name: "Parameter 1", exact: true }),
  ).toHaveValue("sourceX");
  await page.getByRole("textbox", { name: "Track 1 to" }).fill(".75");
  await page
    .getByRole("spinbutton", { name: "Duration (seconds)" })
    .fill(seconds);
}

test("2D parameter playback shares frames with a second engine for its duration", async ({
  page,
}) => {
  await watchEngines(page, 8, { compute: 80 });
  await planar(page);
  const before = (await engines(page)).length;
  await lightTrack(page, "3");
  await button(page, "Play animation").click();
  await expect(button(page, "Replay")).toBeVisible({ timeout: 20000 });
  expect(await planarProgress(page)).toBe("1");
  expect((await planarDefinition(page)).source.position.x).toBe(0.75);
  let all = await engines(page);
  // One helper, released once playback completes; both engines calculated.
  expect(all).toHaveLength(before + 1);
  const helper = all.at(-1)!;
  expect(helper.terminated).toBe(true);
  expect(helper.sent.compute).toBeGreaterThan(1);
  // The helper prepares the end while the app's engine prepares the start.
  expect(helper.first.compute.config.source.position.x).toBe(0.75);
  expect(
    all.some((e) => e !== helper && e.sent.compute > 1 && !e.terminated),
  ).toBe(true);

  // Pause and Stop release the helper; Resume starts a fresh one.
  await button(page, "Replay").click();
  await expect(button(page, "Pause")).toBeVisible();
  await expect.poll(async () => (await engines(page)).length).toBe(before + 2);
  await button(page, "Pause").click();
  all = await engines(page);
  expect(all.at(-1)!.terminated).toBe(true);
  // Scrubbing calculates on the app's engine alone.
  const scrubbed = all.map((e) => e.sent.compute ?? 0);
  const slider = page.getByRole("slider", { name: "Animation progress" });
  for (const p of ["0.3", "0.6", "0.45"]) await slider.fill(p);
  await expect.poll(() => planarProgress(page)).toBe("0.45");
  all = await engines(page);
  expect(all).toHaveLength(before + 2);
  const grew = all.flatMap((e, i) =>
    (e.sent.compute ?? 0) > scrubbed[i] ? [i] : [],
  );
  expect(grew).toHaveLength(1);
  expect(all[grew[0]].terminated).toBe(false);
  await button(page, "Resume").click();
  await expect.poll(async () => (await engines(page)).length).toBe(before + 3);
  await button(page, "Stop").click();
  all = await engines(page);
  expect(all.at(-1)!.terminated).toBe(true);
  expect(all.filter((e) => !e.terminated).length).toBe(
    all.slice(0, before).filter((e) => !e.terminated).length,
  );
  expect((await planarDefinition(page)).source.position.x).toBe(1);
});

test("2D playback stays on one engine without spare cores or calculation", async ({
  page,
}) => {
  await watchEngines(page, 2);
  await planar(page);
  const before = (await engines(page)).length;
  await lightTrack(page, "0.5");
  await button(page, "Play animation").click();
  await expect(button(page, "Replay")).toBeVisible({ timeout: 20000 });
  expect((await planarDefinition(page)).source.position.x).toBe(0.75);
  expect(await engines(page)).toHaveLength(before);
});

// A reveal draws from the prepared study, so it calculates nothing.
test("2D reveal needs no helper engine even with spare cores", async ({
  page,
}) => {
  await watchEngines(page, 8);
  await planar(page);
  const before = (await engines(page)).length;
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("reveal");
  await page
    .getByRole("spinbutton", { name: "Duration (seconds)" })
    .fill("0.5");
  await button(page, "Play animation").click();
  await expect(button(page, "Replay")).toBeVisible({ timeout: 20000 });
  expect(await engines(page)).toHaveLength(before);
});

const stage = (page: Page) => page.locator(".tesseract-stage");
async function tesseract(page: Page) {
  await page.goto("/?study=4d");
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
  await openShapeAnimation(page);
}

test("4D motion playback shares frames with a second engine for its duration", async ({
  page,
}) => {
  await watchEngines(page, 8, { tesseract: 80 });
  await tesseract(page);
  const before = (await engines(page)).length;
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("3");
  await button(page, "Play animation").click();
  await expect(button(page, "Replay")).toBeVisible({ timeout: 20000 });
  await expect(stage(page)).toHaveAttribute("data-progress", "1");
  let all = await engines(page);
  expect(all).toHaveLength(before + 1);
  const helper = all.at(-1)!;
  expect(helper.terminated).toBe(true);
  expect(helper.sent.tesseract).toBeGreaterThan(1);
  expect(
    all.some((e) => e !== helper && e.sent.tesseract > 1 && !e.terminated),
  ).toBe(true);

  await button(page, "Replay").click();
  await expect(button(page, "Pause")).toBeVisible();
  await expect.poll(async () => (await engines(page)).length).toBe(before + 2);
  await button(page, "Pause").click();
  all = await engines(page);
  expect(all.at(-1)!.terminated).toBe(true);
  await button(page, "Resume").click();
  await expect.poll(async () => (await engines(page)).length).toBe(before + 3);
  await button(page, "Stop").click();
  all = await engines(page);
  expect(all.at(-1)!.terminated).toBe(true);
  expect(all.filter((e) => !e.terminated).length).toBe(
    all.slice(0, before).filter((e) => !e.terminated).length,
  );
});

test("4D playback stays on one engine without spare cores", async ({
  page,
}) => {
  await watchEngines(page, 2);
  await tesseract(page);
  const before = (await engines(page)).length;
  await page
    .getByRole("spinbutton", { name: "Duration (seconds)" })
    .fill("0.5");
  await button(page, "Play animation").click();
  await expect(button(page, "Replay")).toBeVisible({ timeout: 20000 });
  await expect(stage(page)).toHaveAttribute("data-progress", "1");
  expect(await engines(page)).toHaveLength(before);
});
