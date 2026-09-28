import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { applyTracks, availableTargets } from "../web/animation";
import { presets } from "../web/presets";
import { exportImage, openAnimation, choosePreset } from "./helpers";

const title = "Flower & its offset";
async function ready(page: Page, preset = title) {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await choosePreset(page, { label: preset });
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
const distance = (page: Page) =>
  page.getByRole("textbox", { name: "Offset distance d", exact: true });
const segments = (page: Page) =>
  page.locator("#artwork > g line").evaluateAll((ls) =>
    ls.map((l) => ({
      length: Math.hypot(
        Number(l.getAttribute("x2")) - Number(l.getAttribute("x1")),
        Number(l.getAttribute("y2")) - Number(l.getAttribute("y1")),
      ),
      dashed: l.hasAttribute("stroke-dasharray"),
    })),
  );

test("the offset preset animates its distance first and needs no pole or source", () => {
  const preset = presets.find((p) => p.title === title)!.config;
  expect(preset.kind).toBe("offset");
  expect(availableTargets(preset)[0]).toBe("distance");
  expect(availableTargets(preset)).not.toContain("poleX");
  expect(availableTargets(preset)).not.toContain("sourceX");
  expect(availableTargets(preset)).not.toContain("offset");
  // Both endpoints are exact, not merely within rounding of the entered value.
  const track = { target: "distance" as const, from: -0.618, to: Math.PI / 5 };
  expect(applyTracks(preset, [track], 0, 1).config.distance).toBe(-0.618);
  expect(applyTracks(preset, [track], 1, 1).config.distance).toBe(Math.PI / 5);
  // The involute string offset is a different quantity.
  const involute = presets.find((p) => p.config.kind === "involute")!.config;
  expect(availableTargets(involute)).not.toContain("distance");
});

test("the offset tab edits a signed distance independent of the involute offset", async ({
  page,
}) => {
  await ready(page, "Ellipse & its evolute");
  const tabs = page.getByRole("group", { name: "Construction" });
  await tabs.getByRole("button", { name: "offset", exact: true }).click();
  await settled(page);
  await expect(
    tabs.getByRole("button", { name: "offset", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".explanation")).toContainText("normal");
  await expect(page.getByText("03 / THE OFFSET")).toBeVisible();
  await expect(page.getByText("04 / THE DRAWING")).toBeVisible();
  await distance(page).fill("-0.4");
  await settled(page);
  expect((await definition(page)).kind).toBe("offset");
  expect((await definition(page)).distance).toBe(-0.4);
  expect((await definition(page)).offset).toBe(0);
  await expect(page.getByTestId("pole-point")).toHaveCount(0);
  // Every construction segment runs along a normal for the same |d|.
  const lengths = (await segments(page)).map((s) => s.length);
  expect(lengths.length).toBe(48);
  expect(Math.max(...lengths) / Math.min(...lengths)).toBeCloseTo(1, 6);
  await distance(page).fill("");
  await expect(page.getByText(/finite number/)).toBeVisible();
  await distance(page).fill("0.25");
  await settled(page);
  expect((await definition(page)).distance).toBe(0.25);
  await tabs.getByRole("button", { name: "involute", exact: true }).click();
  await settled(page);
  await expect(distance(page)).toHaveCount(0);
  expect((await definition(page)).distance).toBe(0.25);
});

test("an offset shrinking a circle to its center draws a point, not a gap", async ({
  page,
}) => {
  await ready(page, "Light inside a circle");
  await page
    .getByRole("group", { name: "Construction" })
    .getByRole("button", { name: "offset", exact: true })
    .click();
  await distance(page).fill("1");
  await settled(page);
  await expect(page.getByTestId("focus-point")).toBeVisible();
  await expect(page.getByText(/omitted samples/)).toHaveCount(0);
});

test("offset construction segments are equal, solid, and the drawing stays framed", async ({
  page,
}) => {
  await ready(page);
  const preset = presets.find((p) => p.title === title)!.config;
  const lines = await segments(page);
  expect(lines.length).toBe(preset.lines);
  expect(lines.every((l) => !l.dashed)).toBe(true);
  const lengths = lines.map((l) => l.length);
  expect(Math.max(...lengths) / Math.min(...lengths)).toBeCloseTo(1, 6);
  // A short base arc with a distant offset keeps both arcs in view.
  await page.getByRole("textbox", { name: "to", exact: true }).fill("0.4");
  await distance(page).fill("-25");
  await settled(page);
  const bounds = await page
    .locator("#artwork > path")
    .evaluateAll((paths) =>
      paths.map((p) =>
        (p.getAttribute("d")!.match(/-?\d+(\.\d+)?(e-?\d+)?/g) ?? []).map(
          Number,
        ),
      ),
    );
  expect(bounds.length).toBe(2);
  for (const numbers of bounds) {
    expect(numbers.length).toBeGreaterThan(20);
    const xs = numbers.filter((_, i) => i % 2 === 0);
    const ys = numbers.filter((_, i) => i % 2 === 1);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(1000);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(760);
  }
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const file = await download;
  expect(file.suggestedFilename()).toBe("tangent-garden-offset.svg");
  const svg = await readFile((await file.path())!, "utf8");
  const config = await page.evaluate(
    (s) =>
      JSON.parse(
        new DOMParser()
          .parseFromString(s, "image/svg+xml")
          .querySelector("desc")!.textContent!,
      ),
    svg,
  );
  expect(config.kind).toBe("offset");
  expect(config.distance).toBe(-25);
});

for (const camera of ["hold", "current", "follow", "fit"]) {
  test(`offset distance animation reaches endpoints with ${camera} camera`, async ({
    page,
  }) => {
    await ready(page);
    const original = (await definition(page)).distance;
    await openAnimation(page);
    await page
      .getByRole("combobox", { name: "Animate", exact: true })
      .selectOption("parameters");
    await expect(
      page.getByRole("combobox", { name: "Parameter 1", exact: true }),
    ).toHaveValue("distance");
    await page.getByRole("textbox", { name: "Track 1 from" }).fill("-1/phi");
    await page.getByRole("textbox", { name: "Track 1 to" }).fill("pi/5");
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
    expect((await definition(page)).distance).toBe(Math.PI / 5);
    expect((await definition(page)).kind).toBe("offset");
    await page.getByRole("button", { name: /^(Stop|Reset view)$/ }).click();
    expect((await definition(page)).distance).toBe(original);
  });
}

for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`offset layout in ${theme} at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme });
      await ready(page);
      await expect(distance(page)).toBeVisible();
      await expect(
        page
          .getByRole("group", { name: "Construction" })
          .getByRole("button", { name: "offset", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: testInfo.outputPath(`offset-${theme}-${width}.png`),
        fullPage: true,
      });
    });
  }
}
