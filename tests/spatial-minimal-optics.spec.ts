import { test, expect, type Page } from "@playwright/test";
import { deflateRawSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { choosePreset } from "./helpers";
import { copiedStudy } from "./gallery-helpers";
import { decodeVideo, probe } from "./video";
import { exportTiming } from "../web/export-quality";
import { spatialPresets } from "../web/spatial/presets";
import { presetStudy } from "../web/spatial/link";
import { surfaceDefaults } from "../web/spatial/surface";
import type { SpatialConfig } from "../web/spatial/types";

// The helicoid–catenoid family as a mirror or interface, through the real
// controls, worker and engine: its presets, choosing it in a ray study and
// lighting a surface study of it, refraction, θ edits and motion, links and
// exports. Its single event, and that its presets are free of shadows, are
// engine3's (TestMinimalOpticsPresetsShadowFree).
const signature = "A half-turn mirror opening into a throat";
const stage = (page: Page) => page.locator(".spatial-stage");
const settled = (page: Page) =>
  expect(stage(page)).toHaveAttribute("aria-busy", "false", {
    timeout: 60000,
  });
const config = async (page: Page): Promise<SpatialConfig> =>
  JSON.parse((await stage(page).getAttribute("data-config"))!);
const note = (page: Page) => page.getByTestId("rays-note");
const field = (page: Page, name: string) =>
  page.getByLabel(name, { exact: true });
const pixels = (page: Page) =>
  page
    .locator("#spatial-artwork")
    .evaluate((c: HTMLCanvasElement) => c.toDataURL());
const familyRays = spatialPresets.filter(
  (p) =>
    p.config.format === "rays" && p.config.surface.kind === "helicoid-catenoid",
);
async function openAnimation(page: Page) {
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
}
async function ready(page: Page) {
  await page.goto("/?study=3d");
  await settled(page);
}
async function openStudy(page: Page, study: unknown) {
  await page.goto("about:blank");
  await page.goto(
    `/?study=3d#s=${deflateRawSync(
      Buffer.from(JSON.stringify({ v: 1, notebook: "3d", study })),
    ).toString("base64url")}`,
  );
  await settled(page);
}

// engine3's shadow-free test samples θ over [0, π/2], so it covers every
// frame only of presets that animate θ alone within it; and each animates
// θ, not the draw-along reveal.
test("every family ray preset animates θ alone, within the angles the shadow test covers", () => {
  expect(familyRays.map((p) => p.name)).toContain(signature);
  for (const p of familyRays) {
    expect(p.flight?.animate).toEqual({
      mode: "parameters",
      tracks: [{ target: "surfaceB", from: "0", to: "pi/2" }],
    });
  }
});

test("the half-turn mirror opens lit from above and says what its single event leaves out", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, { label: signature });
  await settled(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "A mirror and its caustics",
  );
  // Lit on its reversed side, v > 0: the samples with v ≤ 0 are unlit,
  // 61 × 31 of 121 × 61.
  await expect(note(page)).toContainText(
    "Caustic 1 (μ₁) is real, ahead of the mirror",
  );
  await expect(note(page)).toContainText("3,751 samples are unlit");
  // The Light help keeps its essentials, and adds the family's limit.
  const toggle = page.getByRole("button", { name: "About Light", exact: true });
  await toggle.click();
  const help = page.locator(`#${await toggle.getAttribute("aria-controls")}`);
  await expect(help.locator(".hint-brief")).toHaveText(
    /^Parallel light, as from a distant source, or a point source\./,
  );
  await help.getByRole("button", { name: "Show more" }).click();
  await expect(help.locator(".hint-more")).toHaveText(
    "Either reflects once; nothing blocks it on the way in or out. Here much of what is drawn may lie in shadow: a vertical line meets the helicoid every half turn, so a stair longer than that, or a catenoid lit from outside, shades itself.",
  );
  // Another surface's Light help says nothing of it.
  await field(page, "Surface").selectOption("paraboloid");
  await settled(page);
  await expect(help.locator(".hint-more")).toHaveText(
    "Either reflects once; nothing blocks it on the way in or out.",
  );
});

test("the half turn plays θ to the catenoid and back, and scrubbing makes no control blink", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, { label: signature });
  await settled(page);
  const opening = await pixels(page);
  await openAnimation(page);
  await expect(field(page, "Animate")).toHaveValue("parameters");
  await expect(field(page, "Parameter 1")).toHaveValue("surfaceB");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Animation progress" });
  // Out and back: the middle of the timeline is the catenoid, where the
  // light gathers onto the axis.
  for (const [t, progress] of [
    ["0.5", 1],
    ["0", 0],
  ] as const) {
    await slider.fill(t);
    await expect(stage(page)).toHaveAttribute("data-time", t);
    await expect
      .poll(async () => Number(await stage(page).getAttribute("data-progress")))
      .toBeCloseTo(progress, 12);
    await settled(page);
    if (progress === 1) expect(await pixels(page)).not.toBe(opening);
  }
  await slider.fill("0.2");
  await settled(page);
  await page.evaluate(() => {
    Object.assign(window, { buttonChanges: [] });
    new MutationObserver((ms) => {
      for (const m of ms)
        if ((m.target as HTMLElement).tagName === "BUTTON")
          (window as any).buttonChanges.push(
            (m.target as HTMLElement).outerHTML,
          );
    }).observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled"],
    });
  });
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  expect(await page.evaluate(() => (window as any).buttonChanges)).toEqual([]);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await settled(page);
  expect((await config(page)).surface.b).toBe(0);
});

test("choosing the family in a ray study starts from its own shape, keeps the light, and refracts", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, { label: "A paraboloid gathering light" });
  await settled(page);
  await field(page, "Ray length ℓ").fill("1.25");
  await settled(page);
  const before = await config(page);
  await expect(field(page, "Surface").locator("option")).toContainText([
    "Helicoid · catenoid family",
  ]);
  await field(page, "Surface").selectOption("helicoid-catenoid");
  await settled(page);
  const chosen = await config(page);
  expect(chosen.surface).toMatchObject({
    kind: "helicoid-catenoid",
    ...surfaceDefaults["helicoid-catenoid"],
    uSamples: before.surface.uSamples,
    vSamples: before.surface.vSamples,
  });
  expect(chosen.rays).toEqual(before.rays);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(note(page)).toContainText("Caustic 1 (μ₁)");
  // Edited from there: the angle and the scale take expressions.
  await field(page, "Associate angle θ").fill("pi/4");
  await field(page, "Scale s").fill("1.5");
  await settled(page);
  expect((await config(page)).surface).toMatchObject({
    a: 1.5,
    b: Math.PI / 4,
  });
  const reflected = await pixels(page);
  // Refraction and back keep the surface.
  await field(page, "Interaction").selectOption("refract");
  await settled(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "An interface and its caustics",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect((await config(page)).surface).toMatchObject({ a: 1.5 });
  expect(await pixels(page)).not.toBe(reflected);
  await field(page, "Interaction").selectOption("reflect");
  await settled(page);
  expect((await config(page)).surface).toMatchObject({
    kind: "helicoid-catenoid",
    a: 1.5,
    b: Math.PI / 4,
  });
  // Choosing another kind returns to its own shape, as before.
  await field(page, "Surface").selectOption("paraboloid");
  await settled(page);
  expect((await config(page)).surface).toMatchObject({
    kind: "paraboloid",
    ...surfaceDefaults.paraboloid,
  });
});

test("a hand-written link to a family ray study opens, and its copied link round-trips", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const study = presetStudy(
    spatialPresets.findIndex((p) => p.name === signature),
  );
  study.config.surface.b = 0.6;
  study.config.rays = {
    ...study.config.rays,
    interaction: "refract",
    n1: 1,
    n2: 1.5,
    light: "point",
    source: { x: 0.2, y: -0.1, z: 3 },
  };
  await openStudy(page, study);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await config(page)).toEqual(study.config);
  await expect(note(page)).toContainText("Caustic 1 (μ₁)");
  const { study: copied } = await copiedStudy(page);
  expect(copied.config).toEqual(study.config);
});

test("the half turn's θ motion exports an MP4 that decodes with exact timing", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, { label: signature });
  await settled(page);
  await openAnimation(page);
  await page.locator("#spatial-export-settings > summary").click();
  await page.getByLabel("Duration (seconds)").fill(".4");
  await page
    .getByRole("combobox", { name: "Export frame rate" })
    .selectOption("15");
  const exportMP4 = page.getByRole("button", { name: "Export MP4 video" });
  await expect(exportMP4).toBeEnabled();
  const download = page.waitForEvent("download");
  await exportMP4.click();
  const saved = await download;
  const path = (await saved.path())!;
  const probed = probe(path);
  if (probed) {
    expect(probed.frames).toBe(6);
    expect(probed.durations).toEqual(
      exportTiming(0.4, 15).map((f) => f.duration),
    );
  }
  const decoded = await decodeVideo(page, await readFile(path));
  expect(decoded.duration).toBeCloseTo(0.4, 3);
  // The last frame begins at 1/3 s, on the way to the catenoid.
  expect(decoded.first.hash).not.toBe(decoded.last.hash);
});
