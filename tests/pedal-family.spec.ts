import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { availableTargets } from "../web/animation";
import { presets } from "../web/presets";
import { exportImage, openAnimation } from "./helpers";

async function ready(page: Page, preset: string) {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await page
    .getByRole("combobox", { name: "Start with a notebook example" })
    .selectOption({ label: preset });
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
const family = (page: Page) =>
  page.getByRole("combobox", { name: "Projection", exact: true });

// Segment vectors in screen coordinates for each representative construction.
function groups(page: Page) {
  return page.locator("#artwork > g").evaluateAll((gs) =>
    gs
      .map((g) =>
        Array.from(g.querySelectorAll("line")).map((l) => ({
          x1: Number(l.getAttribute("x1")),
          y1: Number(l.getAttribute("y1")),
          x2: Number(l.getAttribute("x2")),
          y2: Number(l.getAttribute("y2")),
          dashed: l.hasAttribute("stroke-dasharray"),
        })),
      )
      .filter((lines) => lines.length > 0),
  );
}
const cosine = (
  a: { x1: number; y1: number; x2: number; y2: number },
  b: { x1: number; y1: number; x2: number; y2: number },
) => {
  const u = [a.x2 - a.x1, a.y2 - a.y1];
  const v = [b.x2 - b.x1, b.y2 - b.y1];
  const n = Math.hypot(...u) * Math.hypot(...v);
  return n > 1e-6 ? Math.abs(u[0] * v[0] + u[1] * v[1]) / n : 0;
};

test("pedal-family presets and pole tracks share the independent pole", () => {
  for (const kind of ["contrapedal", "orthotomic"] as const) {
    const preset = presets.find((p) => p.config.kind === kind)!.config;
    expect(availableTargets(preset).slice(0, 2)).toEqual(["poleX", "poleY"]);
    expect(availableTargets(preset)).not.toContain("sourceX");
  }
});

test("one pedal tab selects the family and keeps the pole across variants", async ({
  page,
}) => {
  await ready(page, "Ellipse & its pedal");
  const tabs = page.getByRole("group", { name: "Construction" });
  await expect(tabs.getByRole("button")).toHaveText([
    "evolute",
    "involute",
    "catacaustic",
    "diacaustic",
    "pedal",
    "offset",
    "rolling",
  ]);
  await expect(family(page)).toHaveValue("pedal");
  await page.getByRole("spinbutton", { name: "Pole x", exact: true }).fill("1");
  await family(page).selectOption("contrapedal");
  await settled(page);
  await expect(
    tabs.getByRole("button", { name: "pedal", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".explanation")).toContainText("normal");
  expect((await definition(page)).kind).toBe("contrapedal");
  expect((await definition(page)).pole).toEqual({ x: 1, y: 0.3 });
  // Returning to the tab from another construction preserves the variant.
  await tabs.getByRole("button", { name: "evolute", exact: true }).click();
  await settled(page);
  await expect(family(page)).toHaveCount(0);
  await tabs.getByRole("button", { name: "pedal", exact: true }).click();
  await settled(page);
  await expect(family(page)).toHaveValue("contrapedal");
  await family(page).selectOption("orthotomic");
  await settled(page);
  expect((await definition(page)).kind).toBe("orthotomic");
  expect((await definition(page)).pole).toEqual({ x: 1, y: 0.3 });
  await expect(page.getByTestId("pole-point")).toBeVisible();
});

test("contrapedal projections are perpendicular to the normal segments", async ({
  page,
}) => {
  await ready(page, "Ellipse & its contrapedal");
  await expect(family(page)).toHaveValue("contrapedal");
  await expect(page.getByTestId("pole-point")).toBeVisible();
  const gs = await groups(page);
  expect(gs.length).toBe(64);
  const errors = gs
    .filter((g) => g.length === 2)
    .map(([normal, projection]) => cosine(normal, projection));
  expect(errors.length).toBeGreaterThan(50);
  expect(Math.max(...errors)).toBeLessThan(1e-6);
  expect(gs.flat().some((l) => l.dashed)).toBe(false);
});

test("orthotomic draws the projection, then a dashed reflected segment of equal length", async ({
  page,
}) => {
  await ready(page, "Ellipse & its orthotomic");
  const gs = await groups(page);
  expect(gs.length).toBe(64);
  const pole = await page
    .getByTestId("pole-point")
    .locator("circle")
    .first()
    .evaluate((c) => ({
      x: Number(c.getAttribute("cx")),
      y: Number(c.getAttribute("cy")),
    }));
  for (const [tangent, projection, reflected] of gs) {
    expect(tangent.dashed).toBe(false);
    expect(projection.dashed).toBe(false);
    expect(reflected.dashed).toBe(true);
    // The genuine foot is shared by all three segments.
    expect(tangent.x2).toBeCloseTo(projection.x2, 6);
    expect(reflected.x1).toBeCloseTo(projection.x2, 6);
    expect(reflected.y1).toBeCloseTo(projection.y2, 6);
    expect({ x: projection.x1, y: projection.y1 }).toEqual(pole);
    // P → H → Q is one straight line, bisected at the foot.
    expect(cosine(projection, reflected)).toBeCloseTo(1, 6);
    expect(
      Math.hypot(reflected.x2 - reflected.x1, reflected.y2 - reflected.y1),
    ).toBeCloseTo(
      Math.hypot(projection.x2 - projection.x1, projection.y2 - projection.y1),
      6,
    );
    if (Math.hypot(tangent.x2 - tangent.x1, tangent.y2 - tangent.y1) > 1e-3)
      expect(cosine(tangent, projection)).toBeLessThan(1e-6);
  }
  await page
    .getByRole("checkbox", { name: "Construction lines", exact: true })
    .uncheck();
  await expect(page.locator("#artwork > g line")).toHaveCount(0);
  await page
    .getByRole("checkbox", { name: "Construction lines", exact: true })
    .check();
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const file = await download;
  expect(file.suggestedFilename()).toBe("tangent-garden-orthotomic.svg");
  const svg = await readFile((await file.path())!, "utf8");
  const exported = await page.evaluate((s) => {
    const doc = new DOMParser().parseFromString(s, "image/svg+xml");
    return {
      config: JSON.parse(doc.querySelector("desc")!.textContent!),
      dashed: doc.querySelectorAll("line[stroke-dasharray]").length,
      pole: !!doc.querySelector('[data-testid="pole-point"]'),
    };
  }, svg);
  expect(exported.config.kind).toBe("orthotomic");
  expect(exported.dashed).toBe(64);
  expect(exported.pole).toBe(true);
});

for (const camera of ["hold", "current", "follow", "fit"]) {
  test(`orthotomic pole animation reaches endpoints with ${camera} camera`, async ({
    page,
  }) => {
    await ready(page, "Ellipse & its orthotomic");
    const original = (await definition(page)).pole;
    await openAnimation(page);
    await page
      .getByRole("combobox", { name: "Animate", exact: true })
      .selectOption("parameters");
    await expect(
      page.getByRole("combobox", { name: "Parameter 1", exact: true }),
    ).toHaveValue("poleX");
    await page.getByRole("textbox", { name: "Track 1 to" }).fill("-phi");
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
    expect((await definition(page)).pole.x).toBe(-(1 + Math.sqrt(5)) / 2);
    expect((await definition(page)).kind).toBe("orthotomic");
    await page.getByRole("button", { name: /^(Stop|Reset view)$/ }).click();
    expect((await definition(page)).pole).toEqual(original);
  });
}

for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`orthotomic layout in ${theme} at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme });
      await ready(page, "Ellipse & its orthotomic");
      await expect(family(page)).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: testInfo.outputPath(`orthotomic-${theme}-${width}.png`),
        fullPage: true,
      });
    });
  }
}
