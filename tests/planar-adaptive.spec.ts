import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import { choosePreset, exportImage, openAnimation } from "./helpers";
import { reveal } from "../web/animation";
import { presets } from "../web/presets";
import type { Result, Vec } from "../web/types";

// Refinement between samples in the 2D notebook: Go inserts points between
// the uniform samples (engine/adaptive.go); the drawing draws them in place
// of the samples of the base curve, a derived input, and a pedal-type or
// inverted curve.

const ripples = "Ripples hidden between samples",
  petals = "Petals that miss the center";

const art = (page: Page) => page.locator("#artwork");
const ready = (page: Page) =>
  expect(page.locator(".plot-wrap")).toHaveAttribute("aria-busy", "false");
const refine = (page: Page) =>
  page.getByRole("checkbox", { name: "Refine between samples" });
const readout = (page: Page) => page.locator(".refinement-readout");
const definition = async (page: Page) =>
  JSON.parse((await art(page).locator("desc").textContent())!);
// The vertices of a drawn path: one per M or L command.
const vertices = (d: string | null) => (d?.match(/[ML]/g) ?? []).length;
const base = (page: Page) => art(page).getByTestId("base-curve");

test("reveal shows refined points up to the last revealed sample", () => {
  const p = (x: number): Vec => ({ x, y: 0 });
  const refined = {
    points: [p(0), p(0.5), p(1), null, p(2), p(2.25), p(2.5), p(3)],
    at: [0, 0.5, 1, 1.5, 2, 2.25, 2.5, 3],
    tolerance: 1e-3,
    inserted: 3,
    breaks: 0,
    unresolved: 0,
    exhausted: false,
  };
  const result: Result = {
    base: [p(0), p(1), p(2), p(3)],
    derived: [p(0), p(1), p(2), p(3)],
    virtual: [false, false, false, false],
    rays: [],
    family: [],
    circles: [],
    rolling: [],
    warnings: [],
    invalid: 0,
    input: [p(0), p(1), p(2), p(3)],
    adaptive: { base: refined, input: refined, derived: refined },
  };
  // Two of three intervals: through sample 2, before the points beyond it.
  const shown = reveal(result, 2 / 3).adaptive!;
  for (const path of [shown.base!, shown.input!, shown.derived!]) {
    expect(path.at).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(path.points).toEqual([p(0), p(0.5), p(1), null, p(2)]);
  }
  expect(reveal(result, 1).adaptive).toEqual(result.adaptive);
  expect(reveal({ ...result, adaptive: undefined }, 0.5).adaptive).toBe(
    undefined,
  );
});

test("the control appears only for curves refinable between samples, and toggles back to the same drawing", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await expect(refine(page)).not.toBeChecked();
  const before = await art(page).evaluate((svg) => svg.outerHTML);
  const uniform = vertices(await base(page).getAttribute("d"));
  await refine(page).check();
  await ready(page);
  await expect(readout(page)).toContainText("added between samples");
  expect((await definition(page)).adaptive).toBe(true);
  // The ellipse is smooth: refinement adds a few points, never removes one.
  expect(vertices(await base(page).getAttribute("d"))).toBeGreaterThanOrEqual(
    uniform,
  );
  await refine(page).uncheck();
  await ready(page);
  await expect(readout(page)).toHaveCount(0);
  expect((await definition(page)).adaptive).toBe(false);
  const after = await art(page).evaluate((svg) => svg.outerHTML);
  // Only the recorded setting differs.
  expect(after.replace(',"adaptive":false', "")).toBe(before);

  // Integrated curves and those without a parameter offer no refinement.
  for (const format of ["pursuit", "field", "implicit", "attractor"]) {
    const i = presets.findIndex((p) => p.config.curve.format === format);
    expect(i, format).toBeGreaterThanOrEqual(0);
    await choosePreset(page, String(i));
    await ready(page);
    await expect(refine(page)).toHaveCount(0);
  }
});

test("ripples aliased by the samples appear when refined", async ({ page }) => {
  await page.goto("/");
  await choosePreset(page, { label: ripples });
  await ready(page);
  // The example opens refined.
  await expect(refine(page)).toBeChecked();
  const refined = vertices(await base(page).getAttribute("d"));
  await expect(readout(page)).toHaveText(
    /^[\d,]+ points added between samples\.$/,
  );
  // The SVG export carries the refined points.
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const svg = (await readFile((await (await download).path())!)).toString();
  const paths = [...svg.matchAll(/ d="([^"]*)"/g)].map((m) => vertices(m[1]));
  expect(Math.max(...paths)).toBeGreaterThanOrEqual(refined);
  await refine(page).uncheck();
  await ready(page);
  const uniform = vertices(await base(page).getAttribute("d"));
  expect(uniform).toBe(240);
  expect(refined).toBeGreaterThan(10 * uniform);
});

test("petals that miss the center throw out round loops when refined, and travel in a link", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await choosePreset(page, { label: petals });
  await ready(page);
  const image = art(page).getByTestId("derived-curve");
  await expect(refine(page)).toBeChecked();
  const drawn = await image.getAttribute("d");
  await refine(page).uncheck();
  await ready(page);
  const uniform = vertices(await image.getAttribute("d"));
  expect(vertices(drawn)).toBeGreaterThan(2 * uniform);
  await refine(page).check();
  await ready(page);
  await expect(image).toHaveAttribute("d", drawn!);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const href = await page.evaluate(() => navigator.clipboard.readText());
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const other = await context.newPage();
  await other.goto(href);
  await ready(other);
  await expect(refine(other)).toBeChecked();
  await expect(art(other).getByTestId("derived-curve")).toHaveAttribute(
    "d",
    drawn!,
  );
  await context.close();
});

test("a paused reveal of a refined study draws its refined points up to the revealed sample", async ({
  page,
}) => {
  await page.goto("/");
  await choosePreset(page, { label: ripples });
  await ready(page);
  const whole = vertices(await base(page).getAttribute("d"));
  await openAnimation(page);
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("reveal");
  await page.getByRole("button", { name: "Play animation" }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("slider", { name: "Animation progress" }).fill("0.5");
  await expect(art(page)).toHaveAttribute("data-animation-progress", "0.5");
  const half = vertices(await base(page).getAttribute("d"));
  expect(half).toBeGreaterThan(0.4 * whole);
  expect(half).toBeLessThan(0.6 * whole);
});

// A link encoded independently, as a sender's browser would.
const linkTo = (study: unknown) =>
  `/#s=${deflateRawSync(
    Buffer.from(JSON.stringify({ v: 1, notebook: "2d", study })),
  ).toString("base64url")}`;

test("a derived input is drawn from its refined points", async ({ page }) => {
  const ripple = presets.find((p) => p.title === ripples)!.config;
  await page.goto(
    linkTo({
      config: { ...ripple, kind: "evolute", input: "offset", distance: 0.01 },
      bounds: { min: "0", max: "2*pi" },
    }),
  );
  await ready(page);
  const input = art(page).getByTestId("construction-input");
  await expect(refine(page)).toBeChecked();
  const refined = vertices(await input.getAttribute("d"));
  await refine(page).uncheck();
  await ready(page);
  const uniform = vertices(await input.getAttribute("d"));
  expect(uniform).toBeLessThanOrEqual(240);
  expect(refined).toBeGreaterThan(10 * uniform);
});
