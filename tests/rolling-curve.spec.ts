import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { applyTracks, availableTargets, reveal } from "../web/animation";
import { fitFrame } from "../web/Plot";
import { presets } from "../web/presets";
import type { Result, Vec } from "../web/types";
import { exportImage, openAnimation, choosePreset } from "./helpers";

const title = "Ellipse rolling on an ellipse";
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
async function progress(page: Page) {
  return Number(
    await page.locator("#artwork").getAttribute("data-animation-progress"),
  );
}
const field = (page: Page, name: string) =>
  page.getByLabel(name, { exact: true });
const rolling = (page: Page) => page.getByTestId("rolling-curve");
const tab = (page: Page, name: string) =>
  page
    .getByRole("group", { name: "Construction" })
    .getByRole("button", { name, exact: true });
const scale = async (page: Page) =>
  Number(await page.locator("#artwork").getAttribute("data-camera-scale"));
async function toScreen(page: Page, p: Vec) {
  const [cx, cy] = (await page
    .locator("#artwork")
    .getAttribute("data-camera-center"))!
    .split(",")
    .map(Number);
  const s = await scale(page);
  return { x: 500 + (p.x - cx) * s, y: 380 - (p.y - cy) * s };
}
async function circleAttributes(page: Page, selector: string) {
  return page
    .locator(selector)
    .evaluate((c) => ["cx", "cy", "r"].map((k) => Number(c.getAttribute(k))));
}

test("the rolling-curve preset rolls an ellipse on its twin and animates its tracing point", () => {
  const preset = presets.find((p) => p.title === title)!.config;
  expect(preset.kind).toBe("rolling");
  expect(preset.curve).toMatchObject({
    format: "parametric",
    x: "2*cos(t)",
    y: "1.2*sin(t)",
  });
  expect(preset.rolling).toMatchObject({
    side: "right",
    shape: "curve",
    curve: { x: "2*cos(t)", y: "1.2*sin(t)", min: 0, max: 2 * Math.PI },
    point: { x: 1.6, y: 0 },
  });
  // The tracing point is the rolling ellipse's focus.
  expect(Math.hypot(2, 1.2) ** 2 - 2 * 1.2 ** 2).toBeCloseTo(1.6 ** 2, 12);
  const targets = availableTargets(preset);
  expect(targets.slice(0, 3)).toEqual([
    "rollingPointX",
    "rollingPointY",
    "rollingStart",
  ]);
  expect(targets).not.toContain("rollingRadius");
  expect(targets).toContain("a");
  const tracks = [
    { target: "rollingPointX" as const, from: 1 / 1.618, to: Math.PI / 2 },
    { target: "rollingPointY" as const, from: 0, to: -Math.E },
    { target: "rollingStart" as const, from: 0.25, to: 2 * Math.PI },
  ];
  expect(applyTracks(preset, tracks, 0, 1).config.rolling).toMatchObject({
    point: { x: 1 / 1.618, y: 0 },
    curve: { start: 0.25 },
  });
  expect(applyTracks(preset, tracks, 1, 1).config.rolling).toMatchObject({
    point: { x: Math.PI / 2, y: -Math.E },
    curve: { start: 2 * Math.PI },
  });
  expect(preset.rolling.point.x).toBe(1.6);
});

test("reveal moves the rolling curve along; framing encloses every placement", () => {
  const point = (x: number): Vec => ({ x, y: 0 });
  const placement = (i: number) => ({
    sampleIndex: i,
    origin: point(10 * i),
    angle: i,
    contact: point(i),
    point: point(i),
  });
  const result: Result = {
    base: [point(0), null, point(2), point(3)],
    derived: [point(0), null, point(2), point(3)],
    virtual: [false, false, false, false],
    rays: [],
    family: [],
    circles: [],
    rolling: [],
    moving: {
      path: [point(-20), null, point(20)],
      closed: false,
      positions: [0, 1, 3].map(placement),
    },
    warnings: [],
    invalid: 1,
  };
  expect(
    reveal(result, 0.5).moving!.positions.map((s) => s.sampleIndex),
  ).toEqual([0, 1]);
  expect(reveal(result, 1)).toEqual(result);
  const config = presets.find((p) => p.title === title)!.config;
  // The rolling curve's enclosing circle, radius 20, at origins 0 to 30.
  expect(fitFrame(result, config).span).toBeCloseTo(70, 9);
  expect(fitFrame({ ...result, moving: undefined }, config).span).toBeLessThan(
    4,
  );
});

test("the preset draws the rolling ellipse mirrored across the tangent at the end", async ({
  page,
}) => {
  await ready(page);
  await expect(tab(page, "rolling")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("03 / THE ROLLING CURVE")).toBeVisible();
  await expect(page.getByText(/omitted samples/)).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "A curve, rolled along the curve" }),
  ).toBeVisible();
  await expect(
    page.locator("#artwork > g:not([data-testid]) > line"),
  ).toHaveCount(48);
  await expect(page.getByTestId("rolling-construction")).toHaveCount(0);
  // After one lap the contact is back at the vertex (2, 0) with a vertical
  // tangent, and the rolling ellipse is the fixed one reflected across it:
  // centered at (4, 0), with its focus at (2.4, 0).
  await expect(rolling(page)).toHaveAttribute("data-sample", "1999");
  const s = await scale(page);
  const box = await rolling(page)
    .locator("path")
    .evaluate((p: SVGPathElement) => {
      const b = p.getBBox();
      return [b.x, b.y, b.width, b.height];
    });
  const corner = await toScreen(page, { x: 2, y: 1.2 });
  expect(box[0]).toBeCloseTo(corner.x, 0);
  expect(box[1]).toBeCloseTo(corner.y, 0);
  expect(box[2] / s).toBeCloseTo(4, 2);
  expect(box[3] / s).toBeCloseTo(2.4, 2);
  const [kx, ky] = await circleAttributes(
    page,
    '[data-testid="rolling-curve"] [data-testid="contact-point"]',
  );
  const contact = await toScreen(page, { x: 2, y: 0 });
  expect(kx).toBeCloseTo(contact.x, 3);
  expect(ky).toBeCloseTo(contact.y, 3);
  const [px, py] = await circleAttributes(
    page,
    '[data-testid="rolling-construction-point"]',
  );
  const focus = await toScreen(page, { x: 2.4, y: 0 });
  expect(px).toBeCloseTo(focus.x, 2);
  expect(py).toBeCloseTo(focus.y, 2);
  // The rolling curve is construction geometry: hidden with the lines layer,
  // and hiding it never reframes the drawing.
  await page.getByRole("checkbox", { name: "Construction lines" }).uncheck();
  await expect(rolling(page)).toHaveCount(0);
  await expect(page.getByTestId("rolling-construction-point")).toHaveCount(0);
  expect(await scale(page)).toBe(s);
  await page.getByRole("checkbox", { name: "Construction lines" }).check();
  await expect(rolling(page)).toBeVisible();
});

test("rolling-curve controls switch shape, validate, stop at the domain's end, and keep circle settings", async ({
  page,
}) => {
  await ready(page, "Flower & a rolling circle");
  const circle = (await definition(page)).rolling;
  const shape = page.getByRole("combobox", { name: "Rolling shape" });
  await expect(shape).toHaveValue("circle");
  await shape.selectOption("curve");
  await settled(page);
  await expect(page.getByText("03 / THE ROLLING CURVE")).toBeVisible();
  await expect(rolling(page)).toBeVisible();
  await expect(page.getByTestId("rolling-construction")).toHaveCount(0);
  await expect(field(page, "Circle radius ρ")).toHaveCount(0);
  // The default is a small ellipse tracing its focus, inside the flower.
  await expect(field(page, "Rolling x(t)")).toHaveValue("0.3*cos(t)");
  await expect(field(page, "Rolling t to")).toHaveValue("2*pi");
  await expect(field(page, "Tracing point x")).toHaveValue("0.24");
  await field(page, "Rolling y(t)").fill("0.1*sin(t)");
  await field(page, "Tracing point y").fill("0.05");
  await settled(page);
  expect((await definition(page)).rolling).toMatchObject({
    shape: "curve",
    side: "left",
    curve: { x: "0.3*cos(t)", y: "0.1*sin(t)", min: 0, start: 0 },
    point: { x: 0.24, y: 0.05 },
  });
  await expect(page.getByText(/omitted samples/)).toHaveCount(0);
  // Invalid inputs explain themselves.
  await field(page, "Rolling x(t)").fill("cos(");
  await expect(page.getByRole("alert")).toContainText("rolling curve x");
  await field(page, "Rolling x(t)").fill("0.3*cos(t)");
  await field(page, "Contact starts at t").fill("7");
  await expect(page.getByRole("alert")).toContainText("outside its domain");
  await field(page, "Contact starts at t").fill("pi");
  await settled(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  // Half an ellipse is open: the contact runs out at its end and says so.
  await field(page, "Rolling t to").fill("3*pi/2");
  await settled(page);
  await page.getByText(/omitted samples/).click();
  await expect(
    page.getByText(/contact reached the end of the rolling curve's domain/),
  ).toBeVisible();
  // Switching back restores the circle as it was.
  await shape.selectOption("circle");
  await settled(page);
  await expect(page.getByTestId("rolling-construction")).toBeVisible();
  await expect(rolling(page)).toHaveCount(0);
  expect((await definition(page)).rolling).toMatchObject({
    shape: "circle",
    radius: circle.radius,
    arm: circle.arm,
    phase: circle.phase,
    curve: { max: (3 * Math.PI) / 2, start: Math.PI },
  });
});

test("an exported rolling curve keeps its drawing and definition", async ({
  page,
}) => {
  await ready(page);
  await field(page, "Tracing point y").fill("0.5");
  await settled(page);
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const file = await download;
  expect(file.suggestedFilename()).toBe("tangent-garden-rolling.svg");
  const svg = await readFile((await file.path())!, "utf8");
  const exported = await page.evaluate((s) => {
    const doc = new DOMParser().parseFromString(s, "image/svg+xml");
    return {
      config: JSON.parse(doc.querySelector("desc")!.textContent!),
      curves: doc.querySelectorAll('[data-testid="rolling-curve"]').length,
    };
  }, svg);
  expect(exported.config.rolling.shape).toBe("curve");
  expect(exported.config.rolling.point.y).toBe(0.5);
  expect(exported.curves).toBe(1);
});

for (const camera of ["hold", "current", "follow", "fit"]) {
  test(`rolling-curve tracing point animation reaches endpoints with ${camera} camera`, async ({
    page,
  }) => {
    await ready(page);
    const original = (await definition(page)).rolling;
    await openAnimation(page);
    await page
      .getByRole("combobox", { name: "Animate", exact: true })
      .selectOption("parameters");
    const parameter = page.getByRole("combobox", {
      name: "Parameter 1",
      exact: true,
    });
    await expect(parameter).toHaveValue("rollingPointX");
    await page.getByRole("textbox", { name: "Track 1 from" }).fill("1.6");
    await page.getByRole("textbox", { name: "Track 1 to" }).fill("phi");
    await page.getByRole("button", { name: "Add parameter" }).click();
    await page
      .getByRole("combobox", { name: "Parameter 2", exact: true })
      .selectOption("rollingStart");
    await page.getByRole("textbox", { name: "Track 2 from" }).fill("0");
    await page.getByRole("textbox", { name: "Track 2 to" }).fill("pi/7");
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
    const rolled = (await definition(page)).rolling;
    expect(rolled.point.x).toBe((1 + Math.sqrt(5)) / 2);
    expect(rolled.curve.start).toBe(Math.PI / 7);
    await expect(rolling(page)).toHaveAttribute("data-sample", "1999");
    await page.getByRole("button", { name: /^(Stop|Back to study)$/ }).click();
    expect((await definition(page)).rolling).toEqual(original);
  });
}

test("reveal rolls the curve along, pauses, resumes, and an edit cancels", async ({
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
  const sample = Number(await rolling(page).getAttribute("data-sample"));
  expect(sample).toBeLessThanOrEqual(paused * 1999);
  expect(sample).toBeGreaterThan(paused * 1999 - 1999 / 47 - 1);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  await expect(rolling(page)).toHaveAttribute("data-sample", "1999");
  await page.getByRole("button", { name: "Replay", exact: true }).click();
  await expect.poll(() => progress(page)).toBeGreaterThan(0);
  await field(page, "Tracing point x").fill("0");
  await settled(page);
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-progress",
  );
  expect((await definition(page)).rolling.point.x).toBe(0);
  await expect(rolling(page)).toHaveAttribute("data-sample", "1999");
});

for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`rolling-curve layout in ${theme} at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme });
      await ready(page);
      for (const name of [
        "Rolling x(t)",
        "Rolling t to",
        "Contact starts at t",
        "Tracing point y",
      ])
        await expect(field(page, name)).toBeVisible();
      const section = page
        .locator("section")
        .filter({ hasText: "03 / THE ROLLING CURVE" });
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
        path: testInfo.outputPath(`rolling-curve-${theme}-${width}.png`),
        fullPage: true,
      });
    });
  }
}

test("an ellipse a fifth of the flower's length rolls inside it with its cusps on the petal tips", async ({
  page,
}) => {
  const preset = presets.find(
    (p) => p.title === "Ellipse rolling in a flower",
  )!.config;
  // Perimeters by the midpoint rule, which is spectrally accurate here.
  const length = (speed: (t: number) => number) => {
    const n = 100000;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += speed(((i + 0.5) * 2 * Math.PI) / n);
    return (sum * 2 * Math.PI) / n;
  };
  const flower = length((t) =>
    Math.hypot(1 + 0.18 * Math.cos(5 * t), -0.9 * Math.sin(5 * t)),
  );
  const ellipse = length((t) =>
    Math.hypot(0.3 * Math.sin(t), 0.1616 * Math.cos(t)),
  );
  expect(Math.abs(flower / 5 - ellipse)).toBeLessThan(1e-6);
  expect(preset.rolling).toMatchObject({
    side: "left",
    shape: "curve",
    point: { x: 0.3, y: 0 },
  });
  await ready(page, "Ellipse rolling in a flower");
  await expect(page.getByText(/omitted samples/)).toHaveCount(0);
  // After five laps of the ellipse its vertex is back on the petal tip.
  await expect(rolling(page)).toHaveAttribute("data-sample", "1999");
  const [px, py] = await circleAttributes(
    page,
    '[data-testid="rolling-construction-point"]',
  );
  const tip = await toScreen(page, { x: 1.18, y: 0 });
  expect(px).toBeCloseTo(tip.x, 2);
  expect(py).toBeCloseTo(tip.y, 2);
});
