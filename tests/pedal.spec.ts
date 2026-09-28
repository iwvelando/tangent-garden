import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { applyTracks, availableTargets } from "../web/animation";
import { presets } from "../web/presets";
import { exportImage, openAnimation, choosePreset } from "./helpers";

async function ready(page: Page) {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await choosePreset(page, { label: "Ellipse & its pedal" });
  await settled(page);
}
async function settled(page: Page) {
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.locator("#artwork")).toBeVisible();
}
async function definition(page: Page) {
  return JSON.parse((await page.locator("#artwork desc").textContent())!);
}
async function progress(page: Page) {
  return Number(
    await page.locator("#artwork").getAttribute("data-animation-progress"),
  );
}

test("pole tracks are independent of light sources and preserve the base study", () => {
  const base = presets.find((p) => p.config.kind === "pedal")!.config;
  expect(availableTargets(base)).toContain("poleX");
  expect(availableTargets(base)).not.toContain("sourceX");
  expect(availableTargets(presets[0].config)).not.toContain("poleX");
  const { config } = applyTracks(
    base,
    [
      { target: "poleX", from: 0, to: 2 },
      { target: "poleY", from: 1, to: -1 },
    ],
    0.5,
    0.8,
  );
  expect(config.pole).toEqual({ x: 1, y: 0 });
  expect(config.source).toEqual(base.source);
  expect(base.pole).toEqual({ x: 1.65, y: 0.3 });
});

test("pedal projections, custom controls, invalid input recovery, and SVG export", async ({
  page,
}) => {
  await ready(page);
  await expect(page.getByTestId("pole-point")).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Incident rays" }),
  ).toHaveCount(0);
  // Equal plot scales preserve the defining right angles on screen.
  const errors = await page.locator("#artwork > g").evaluateAll((groups) =>
    groups.flatMap((g) => {
      const lines = Array.from(g.querySelectorAll("line"));
      if (lines.length !== 2) return [];
      const v = lines.map((l) => [
        Number(l.getAttribute("x2")) - Number(l.getAttribute("x1")),
        Number(l.getAttribute("y2")) - Number(l.getAttribute("y1")),
      ]);
      const lengths = Math.hypot(...v[0]) * Math.hypot(...v[1]);
      return lengths > 1e-6
        ? [Math.abs(v[0][0] * v[1][0] + v[0][1] * v[1][1]) / lengths]
        : [];
    }),
  );
  expect(errors.length).toBeGreaterThan(50);
  expect(Math.max(...errors)).toBeLessThan(1e-6);
  await page.getByRole("radio", { name: "Expert mode" }).check();
  await page.getByRole("spinbutton", { name: "Numerical samples" }).fill("777");
  await page
    .getByRole("spinbutton", { name: "Construction lines", exact: true })
    .fill("73");
  await page.getByRole("textbox", { name: "to", exact: true }).fill("2*pi");
  await settled(page);
  await expect(page.locator("#artwork line")).toHaveCount(146);
  await page.getByRole("textbox", { name: "Pole x", exact: true }).fill("");
  await expect(page.getByRole("alert")).toContainText("finite number");
  await page.getByRole("textbox", { name: "Pole x", exact: true }).fill("1.25");
  await settled(page);
  const source = (await definition(page)).source;
  await page.getByRole("button", { name: "catacaustic", exact: true }).click();
  await settled(page);
  expect((await definition(page)).source).toEqual(source);
  await page.getByRole("button", { name: "pedal", exact: true }).click();
  await settled(page);
  expect((await definition(page)).pole.x).toBe(1.25);
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const file = await download;
  expect(file.suggestedFilename()).toBe("tangent-garden-pedal.svg");
  const svg = await readFile((await file.path())!, "utf8");
  const exported = await page.evaluate((s) => {
    const doc = new DOMParser().parseFromString(s, "image/svg+xml");
    return {
      config: JSON.parse(doc.querySelector("desc")!.textContent!),
      lines: doc.querySelectorAll("line").length,
      pole: !!doc.querySelector('[data-testid="pole-point"]'),
      error: !!doc.querySelector("parsererror"),
    };
  }, svg);
  expect(exported.error).toBe(false);
  expect(exported.pole).toBe(true);
  expect(exported.lines).toBe(146);
  expect(exported.config.pole).toEqual({ x: 1.25, y: 0.3 });
  expect(exported.config.curve.max).toBe(2 * Math.PI);
});

for (const camera of ["hold", "current", "follow", "fit"]) {
  test(`pedal pole animation reaches scalar endpoints with ${camera} camera`, async ({
    page,
  }) => {
    await ready(page);
    await openAnimation(page);
    await page
      .getByRole("combobox", { name: "Animate", exact: true })
      .selectOption("parameters");
    await expect(
      page.getByRole("combobox", { name: "Parameter 1", exact: true }),
    ).toHaveValue("poleX");
    await page.getByRole("textbox", { name: "Track 1 to" }).fill("phi");
    await page.getByRole("button", { name: "+ Add parameter" }).click();
    await page
      .getByRole("combobox", { name: "Parameter 2", exact: true })
      .selectOption("poleY");
    await page.getByRole("textbox", { name: "Track 2 to" }).fill("-1/2");
    await page
      .getByRole("combobox", { name: "Animation camera" })
      .selectOption(camera);
    await page
      .getByRole("spinbutton", { name: "Duration (seconds)" })
      .fill(".2");
    await page.getByRole("button", { name: "Play animation" }).click();
    await expect(
      page.getByRole("button", { name: "Replay", exact: true }),
    ).toBeVisible();
    expect((await definition(page)).pole).toEqual({
      x: (1 + Math.sqrt(5)) / 2,
      y: -0.5,
    });
    expect(await progress(page)).toBe(1);
    await page
      .getByRole("slider", { name: "Animation progress", exact: true })
      .press("Home");
    await expect.poll(() => progress(page)).toBe(0);
    expect((await definition(page)).pole).toEqual({ x: 1.65, y: 0.3 });
    await page.getByRole("button", { name: /^(Stop|Reset view)$/ }).click();
    expect((await definition(page)).pole).toEqual({ x: 1.65, y: 0.3 });
  });
}

test("pedal reveal pauses and resumes, and editing cancels moving-pole playback", async ({
  page,
}) => {
  await ready(page);
  await openAnimation(page);
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("2");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect.poll(() => progress(page)).toBeGreaterThan(0.1);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const paused = await progress(page);
  expect(paused).toBeLessThan(1);
  expect(await page.locator("#artwork line").count()).toBeLessThan(128);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#artwork line")).toHaveCount(128);
  await page.getByRole("button", { name: /^(Stop|Reset view)$/ }).click();
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("parameters");
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("30");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect.poll(() => progress(page)).toBeGreaterThan(0);
  await page.getByRole("textbox", { name: "Pole x", exact: true }).fill("-2");
  await settled(page);
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-progress",
  );
  expect((await definition(page)).pole.x).toBe(-2);
  await expect(
    page.getByRole("button", { name: "Play animation" }),
  ).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`pedal layout in ${theme} at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme });
      await ready(page);
      await expect(
        page.getByRole("textbox", { name: "Pole x", exact: true }),
      ).toHaveValue("1.65");
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      if (width === 1440) {
        const before = await page.locator("#artwork").boundingBox();
        await page
          .locator("aside")
          .evaluate((el) => (el.scrollTop = el.scrollHeight));
        expect(await page.locator("#artwork").boundingBox()).toEqual(before);
      }
      await page.screenshot({
        path: testInfo.outputPath(`pedal-${theme}-${width}.png`),
        fullPage: true,
      });
    });
  }
}
