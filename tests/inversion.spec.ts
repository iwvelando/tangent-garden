import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { applyTracks, availableTargets, reveal } from "../web/animation";
import { fitFrame, pathData } from "../web/Plot";
import { presets } from "../web/presets";
import type { Config, Result, Vec } from "../web/types";
import { exportImage, openAnimation, choosePreset } from "./helpers";

const title = "Hyperbola into a lemniscate";
const preset = (name: string) => presets.find((p) => p.title === name)!.config;
async function ready(page: Page, name = title) {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await choosePreset(page, { label: name });
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
const field = (page: Page, name: string) =>
  page.getByLabel(name, { exact: true });
const source = (page: Page) =>
  page.getByRole("combobox", { name: "Construct on", exact: true });
const segments = (page: Page) => page.getByTestId("inversion-segment");
const image = (page: Page) => page.getByTestId("derived-curve");
const scale = async (page: Page) =>
  Number(await page.locator("#artwork").getAttribute("data-camera-scale"));
// Screen coordinates to world coordinates, and back.
async function camera(page: Page) {
  const [cx, cy] = (await page
    .locator("#artwork")
    .getAttribute("data-camera-center"))!
    .split(",")
    .map(Number);
  const s = await scale(page);
  return {
    world: ([x, y]: number[]): Vec => ({
      x: cx + (x - 500) / s,
      y: cy - (y - 380) / s,
    }),
    screen: (p: Vec) => ({ x: 500 + (p.x - cx) * s, y: 380 - (p.y - cy) * s }),
    s,
  };
}
// The vertices of an SVG path, split into its separately moved-to runs.
function runs(d: string) {
  return d
    .split("M")
    .filter((run) => run.trim())
    .map((run) =>
      run
        .trim()
        .split(/\s*L\s*/)
        .map((xy) => xy.split(/[ ,]+/).map(Number)),
    );
}
const point = (x: number, y = 0): Vec => ({ x, y });

test("the inversion presets invert a curve, a roulette, and a pedal; their parameters animate", () => {
  const lemniscate = preset(title);
  expect(lemniscate.kind).toBe("inversion");
  expect(lemniscate.inversion).toEqual({ center: { x: 0, y: 0 }, radius: 2 });
  expect(lemniscate.input).toBe("curve");
  expect(lemniscate.curve).toMatchObject({ x: "1/cos(t)", y: "tan(t)" });
  const rosette = preset("Hypotrochoid, turned inside out");
  expect(rosette.curve.format).toBe("roulette");
  expect(rosette.input).toBe("curve");
  const reciprocal = preset("An ellipse's pedal, inverted");
  expect(reciprocal.input).toBe("pedal");
  expect(reciprocal.inversion.radius).toBe(1);
  // Inverting about the pole gives the polar reciprocal.
  expect(reciprocal.inversion.center).toEqual(reciprocal.pole);
  // Every preset carries an inversion, so switching tabs has one to use.
  for (const p of presets) expect(p.config.inversion.radius).toBeGreaterThan(0);

  expect(availableTargets(lemniscate).slice(0, 3)).toEqual([
    "inversionX",
    "inversionY",
    "inversionRadius",
  ]);
  expect(availableTargets(lemniscate)).not.toContain("poleX");
  expect(availableTargets(reciprocal)).toContain("poleX");
  const offset: Config = { ...lemniscate, input: "offset" };
  expect(availableTargets(offset)).toContain("distance");
  const tracks = [
    { target: "inversionRadius" as const, from: 1, to: 2 * Math.PI },
    { target: "inversionX" as const, from: 0, to: -Math.E },
    { target: "inversionY" as const, from: 0, to: 0.1 },
  ];
  const end = applyTracks(lemniscate, tracks, 1, 1).config.inversion;
  expect(end).toEqual({ center: { x: -Math.E, y: 0.1 }, radius: 2 * Math.PI });
  expect(lemniscate.inversion.radius).toBe(2);
});

const inverted = (breaks: number[]): Result => ({
  base: [point(0), point(1), point(2), point(3)],
  derived: [point(0, 1), point(1, 1), point(1.01, 1), point(3, 1)],
  virtual: [false, false, false, false],
  rays: [],
  family: [],
  circles: [],
  rolling: [],
  warnings: [],
  invalid: 0,
  inversion: { center: point(0), radius: 20, breaks },
  input: [point(0, 2), point(1, 2), point(2, 2), point(3, 2)],
});

test("reveal keeps the circle and breaks; framing includes the circle and the inverted curve", () => {
  const half = reveal(inverted([2]), 0.5);
  expect(half.input).toEqual([point(0, 2), point(1, 2)]);
  expect(half.inversion!.breaks).toEqual([2]);
  expect(half.inversion!.radius).toBe(20);
  const config = preset(title);
  // The circle of radius 20 about O, as its own family.
  expect(fitFrame(inverted([]), config).span).toBeCloseTo(40, 9);
});

test("the image is left open at each break, even between close samples", () => {
  const points = inverted([]).derived;
  const xy = (p: Vec) => ({ x: 100 * p.x, y: 100 * p.y });
  expect(runs(pathData(points, xy))).toHaveLength(1);
  expect(
    runs(pathData(points, xy, undefined, new Set([2]))).map((r) => r.length),
  ).toEqual([2, 2]);
});

test("a hyperbola inverts into a lemniscate through the center, with each point joined to its image", async ({
  page,
}) => {
  await ready(page);
  await expect(
    page.getByRole("heading", { name: "Inversion in a circle" }),
  ).toBeVisible();
  await expect(page.getByText("03 / THE INVERSION")).toBeVisible();
  await expect(source(page)).toHaveValue("curve");
  await expect(
    page.getByRole("button", { name: "inversion", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/omitted samples/)).toHaveCount(0);
  const config = preset(title);
  const { world, screen, s } = await camera(page);
  // The circle of inversion, and its center.
  const circle = page.getByTestId("inversion-circle");
  const o = screen(point(0));
  expect(Number(await circle.getAttribute("cx"))).toBeCloseTo(o.x, 3);
  expect(Number(await circle.getAttribute("cy"))).toBeCloseTo(o.y, 3);
  expect(Number(await circle.getAttribute("r"))).toBeCloseTo(2 * s, 3);
  await expect(page.getByTestId("inversion-center")).toHaveCount(1);
  // The image lies on (x² + y²)² = R⁴(x² − y²), in one piece through O.
  const [piece, ...rest] = runs((await image(page).getAttribute("d"))!);
  expect(rest).toHaveLength(0);
  for (const xy of piece) {
    const p = world(xy);
    const r2 = p.x * p.x + p.y * p.y;
    expect(Math.abs(r2 * r2 - 16 * (p.x * p.x - p.y * p.y))).toBeLessThan(
      1e-3 * (1 + r2 * r2),
    );
  }
  // Each segment joins a point to its image along a ray from O, with the
  // product of their distances R² = 4.
  await expect(segments(page)).toHaveCount(config.lines);
  for (const segment of await segments(page).locator("line").all()) {
    const [x1, y1, x2, y2] = await Promise.all(
      ["x1", "y1", "x2", "y2"].map(async (k) =>
        Number(await segment.getAttribute(k)),
      ),
    );
    const a = world([x1, y1]),
      b = world([x2, y2]);
    expect(Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y)).toBeCloseTo(4, 2);
    expect(Math.abs(a.x * b.y - a.y * b.x)).toBeLessThan(1e-2);
  }
  // The construction layer hides segments and circle without reframing.
  await page.getByRole("checkbox", { name: "Construction lines" }).uncheck();
  await expect(segments(page)).toHaveCount(0);
  await expect(page.getByTestId("inversion-circle")).toHaveCount(0);
  expect(await scale(page)).toBe(s);
});

test("the inverted curve can be a derived curve, with its own parameters, and invalid inputs are reported", async ({
  page,
}) => {
  await ready(page, "Ellipse & its evolute");
  await page.getByRole("button", { name: "inversion", exact: true }).click();
  await settled(page);
  await expect(source(page)).toHaveValue("curve");
  await expect(page.getByTestId("construction-input")).toHaveCount(0);
  await expect(field(page, "Pole x")).toHaveCount(0);
  await source(page).selectOption("pedal");
  await settled(page);
  await expect(field(page, "Pole x")).toBeVisible();
  await expect(page.getByTestId("construction-input")).toHaveCount(1);
  expect((await definition(page)).input).toBe("pedal");
  await source(page).selectOption("offset");
  await settled(page);
  await expect(field(page, "Pole x")).toHaveCount(0);
  await field(page, "Offset distance d").fill("0.5");
  await settled(page);
  expect((await definition(page)).distance).toBe(0.5);
  await source(page).selectOption("evolute");
  await settled(page);
  await expect(page.getByTestId("construction-input")).toHaveCount(1);
  await field(page, "Inversion radius R").fill("0");
  await expect(page.getByRole("alert")).toContainText("inversion radius");
  await field(page, "Inversion radius R").fill("2");
  await settled(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  // The pedal selection is remembered by the pole tab, never overwritten.
  await page.getByRole("button", { name: "pedal", exact: true }).click();
  await settled(page);
  expect((await definition(page)).kind).toBe("pedal");
});

test("a circle through the center inverts into a line, left open at infinity", async ({
  page,
}) => {
  await ready(page);
  await field(page, "x(t)").fill("1+cos(t)");
  await field(page, "y(t)").fill("sin(t)");
  await settled(page);
  await page.getByText(/omitted samples/).click();
  await expect(
    page.locator(".diagnostics").getByText(/left open/),
  ).toBeVisible();
  // Every drawn point lies on the line x = R²/2 = 2.
  const { world } = await camera(page);
  for (const run of runs((await image(page).getAttribute("d"))!))
    for (const xy of run) expect(world(xy).x).toBeCloseTo(2, 2);
});

test("an exported inversion keeps its circle, segments, and definition", async ({
  page,
}) => {
  await ready(page, "An ellipse's pedal, inverted");
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const file = await download;
  expect(file.suggestedFilename()).toBe(
    "tangent-garden-inversion-of-pedal.svg",
  );
  const svg = await readFile((await file.path())!, "utf8");
  const exported = await page.evaluate((s) => {
    const doc = new DOMParser().parseFromString(s, "image/svg+xml");
    return {
      config: JSON.parse(doc.querySelector("desc")!.textContent!),
      circle: doc.querySelectorAll('[data-testid="inversion-circle"]').length,
      source: doc.querySelectorAll('[data-testid="construction-input"]').length,
      segments: doc.querySelectorAll('[data-testid="inversion-segment"]')
        .length,
    };
  }, svg);
  const config = preset("An ellipse's pedal, inverted");
  expect(exported.config.inversion).toEqual(config.inversion);
  expect(exported.circle).toBe(1);
  expect(exported.source).toBe(1);
  expect(exported.segments).toBe(config.lines);
});

for (const camera of ["hold", "current", "follow", "fit"]) {
  test(`the inversion radius animates to its endpoint with ${camera} camera`, async ({
    page,
  }) => {
    await ready(page);
    const original = await definition(page);
    await openAnimation(page);
    await page
      .getByRole("combobox", { name: "Animate", exact: true })
      .selectOption("parameters");
    await expect(
      page.getByRole("combobox", { name: "Parameter 1", exact: true }),
    ).toHaveValue("inversionX");
    await page
      .getByRole("combobox", { name: "Parameter 1", exact: true })
      .selectOption("inversionRadius");
    await page.getByRole("textbox", { name: "Track 1 from" }).fill("2");
    await page.getByRole("textbox", { name: "Track 1 to" }).fill("sqrt(2)");
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
    expect((await definition(page)).inversion.radius).toBe(Math.SQRT2);
    await expect(page.getByTestId("inversion-circle")).toHaveCount(1);
    await page.getByRole("button", { name: /^(Stop|Reset view)$/ }).click();
    expect((await definition(page)).inversion).toEqual(original.inversion);
  });
}

test("reveal draws the segments in order, pauses, resumes, and an edit cancels", async ({
  page,
}) => {
  await ready(page);
  const config = preset(title);
  await openAnimation(page);
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("2");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect.poll(() => progress(page)).toBeGreaterThan(0.1);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const paused = await progress(page);
  expect(paused).toBeLessThan(1);
  const last = Math.floor(paused * (config.samples - 1));
  const step = (config.samples - 1) / (config.lines - 1);
  await expect(segments(page)).toHaveCount(Math.floor(last / step + 1e-9) + 1);
  await expect(page.getByTestId("inversion-circle")).toHaveCount(1);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  await expect(segments(page)).toHaveCount(config.lines);
  await page.getByRole("button", { name: "Replay", exact: true }).click();
  await expect.poll(() => progress(page)).toBeGreaterThan(0);
  await field(page, "Inversion center x").fill("0.1");
  await settled(page);
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-progress",
  );
  expect((await definition(page)).inversion.center.x).toBe(0.1);
});

for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`inversion layout in ${theme} at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme });
      await ready(page, "An ellipse's pedal, inverted");
      await expect(field(page, "Inversion radius R")).toBeVisible();
      const section = page
        .locator("section")
        .filter({ hasText: "03 / THE INVERSION" });
      const bounds = (await section.boundingBox())!;
      for (const input of await section.locator("input, select").all()) {
        const box = (await input.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(bounds.x - 0.5);
        expect(box.x + box.width).toBeLessThanOrEqual(
          bounds.x + bounds.width + 0.5,
        );
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: testInfo.outputPath(`inversion-${theme}-${width}.png`),
        fullPage: true,
      });
    });
  }
}
