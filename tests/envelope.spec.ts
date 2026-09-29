import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { applyTracks, availableTargets, reveal } from "../web/animation";
import { fitFrame } from "../web/Plot";
import { presets } from "../web/presets";
import type { Result, Vec } from "../web/types";
import { exportImage, openAnimation, choosePreset } from "./helpers";

const title = "Chords & a cardioid";
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
const lines = (page: Page) => page.getByTestId("envelope-line");
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
// Whether a point lies beyond the drawing's view box.
const outside = (x: number, y: number) => x < 0 || x > 1000 || y < 0 || y > 760;
// Each drawn line's endpoints in drawing pixels.
async function segments(page: Page) {
  return lines(page)
    .locator("line")
    .evaluateAll((all) =>
      all.map((l) =>
        ["x1", "y1", "x2", "y2"].map((k) => Number(l.getAttribute(k))),
      ),
    );
}

test("the chord presets join angle t to angle a·t, and a animates the multiplication table", () => {
  const cardioid = presets.find((p) => p.title === title)!.config;
  expect(cardioid.kind).toBe("envelope");
  expect(cardioid.curve).toMatchObject({
    format: "parametric",
    x: "cos(t)",
    y: "sin(t)",
    a: 2,
    min: 0,
    max: 2 * Math.PI,
  });
  expect(cardioid.envelope).toMatchObject({
    mode: "chord",
    x: "cos(a*t)",
    y: "sin(a*t)",
    extend: false,
  });
  // Evenly spaced phases land exactly on samples.
  expect((cardioid.samples - 1) % (cardioid.lines - 1)).toBe(0);
  const four = presets.find((p) => p.title === "Chords of four")!.config;
  expect(four.curve.a).toBe(4);
  expect([four.samples, four.lines]).toEqual([2001, 201]);
  const fold = presets.find((p) => p.title === "Folding a parabola")!.config;
  expect(fold.envelope).toMatchObject({ mode: "angle", angle: "atan(x)" });
  expect(fold.curve).toMatchObject({ format: "cartesian", y: "0" });
  const targets = availableTargets(cardioid);
  expect(targets[0]).toBe("a");
  const tracks = [{ target: "a" as const, from: 2, to: 1 + Math.E }];
  expect(applyTracks(cardioid, tracks, 0, 1).config.curve.a).toBe(2);
  expect(applyTracks(cardioid, tracks, 1, 1).config.curve.a).toBe(1 + Math.E);
  expect(cardioid.curve.a).toBe(2);
});

test("reveal draws the chords and second points so far; framing includes the second points", () => {
  const point = (x: number): Vec => ({ x, y: 0 });
  const ray = (i: number) => ({
    sampleIndex: i,
    origin: point(i),
    direction: point(1),
    incident: point(0),
    target: point(i),
    virtual: false,
    tir: false,
    end: point(20),
  });
  const result: Result = {
    base: [point(0), point(1), point(2), point(3)],
    derived: [null, point(1), point(2), point(3)],
    virtual: [false, false, false, false],
    rays: [1, 2, 3].map(ray),
    family: [],
    circles: [],
    rolling: [],
    second: [point(0), point(10), point(20), point(30)],
    warnings: [],
    invalid: 1,
  };
  const half = reveal(result, 0.5);
  expect(half.rays.map((r) => r.sampleIndex)).toEqual([1]);
  expect(half.second).toEqual([point(0), point(10)]);
  expect(reveal(result, 1)).toEqual(result);
  const config = presets.find((p) => p.title === title)!.config;
  expect(fitFrame(result, config).span).toBeCloseTo(30, 9);
  expect(fitFrame({ ...result, second: undefined }, config).span).toBe(3);
});

test("the cardioid preset draws each chord between its endpoints and gaps the coincident ones", async ({
  page,
}) => {
  await ready(page);
  await expect(tab(page, "envelope")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("03 / THE FAMILY")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "The envelope of chords" }),
  ).toBeVisible();
  // 121 phases from 0 to 2π; the first and last join a point to itself.
  await expect(lines(page)).toHaveCount(119);
  await expect(page.getByTestId("second-curve")).toBeVisible();
  await page.getByText(/omitted samples/).click();
  await expect(
    page.getByText(/At 2 samples the chord's endpoints coincide/),
  ).toBeVisible();
  const drawn = await segments(page);
  for (const k of [1, 30, 60, 97]) {
    const t = (2 * Math.PI * k) / 120;
    const from = await toScreen(page, { x: Math.cos(t), y: Math.sin(t) });
    const to = await toScreen(page, {
      x: Math.cos(2 * t),
      y: Math.sin(2 * t),
    });
    const [x1, y1, x2, y2] = drawn[k - 1];
    expect(x1).toBeCloseTo(from.x, 3);
    expect(y1).toBeCloseTo(from.y, 3);
    expect(x2).toBeCloseTo(to.x, 3);
    expect(y2).toBeCloseTo(to.y, 3);
  }
  // Only unextended chords have virtual parts to show.
  await expect(
    page.getByRole("checkbox", { name: "Virtual extensions" }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Incident rays" }),
  ).toHaveCount(0);
  // Chords are construction lines: hiding them never reframes the drawing.
  const s = await scale(page);
  await page.getByRole("checkbox", { name: "Construction lines" }).uncheck();
  await expect(lines(page)).toHaveCount(0);
  expect(await scale(page)).toBe(s);
  await page.getByRole("checkbox", { name: "Base curve" }).uncheck();
  await expect(page.getByTestId("second-curve")).toHaveCount(0);
  expect(await scale(page)).toBe(s);
});

test("envelope controls switch to angles, extend chords, dash virtual points, and validate", async ({
  page,
}) => {
  await ready(page);
  const derived = page.locator('#artwork > path[stroke-dasharray="6 4"]');
  await expect(derived).toHaveCount(1);
  expect(await derived.getAttribute("d")).toBe("");
  // Chords t → −1.5t touch their envelope behind the segments: dashed.
  await field(page, "Shape parameter a").fill("-1.5");
  await settled(page);
  expect((await derived.getAttribute("d"))!.length).toBeGreaterThan(100);
  await page.getByRole("checkbox", { name: "Virtual extensions" }).uncheck();
  await expect(derived).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Virtual extensions" }).check();
  // Extended chords are full lines, drawn past the view.
  await page
    .getByRole("checkbox", { name: "Extend chords to full lines" })
    .check();
  await settled(page);
  expect((await definition(page)).envelope.extend).toBe(true);
  await expect(
    page.getByRole("checkbox", { name: "Virtual extensions" }),
  ).toHaveCount(0);
  await expect(derived).toHaveCount(0);
  for (const [x1, y1, x2, y2] of await segments(page))
    expect(outside(x1, y1) && outside(x2, y2)).toBe(true);
  // The chord's second point is validated in Go.
  await field(page, "Second point x(t)").fill("cos(");
  await expect(page.getByRole("alert")).toContainText("second endpoint x");
  await field(page, "Second point x(t)").fill("cos(a*t)");
  await settled(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  // Angles: each line through the curve's point, turned to θ(t).
  await page
    .getByRole("combobox", { name: "Family", exact: true })
    .selectOption("angle");
  await settled(page);
  await expect(
    page.getByRole("heading", { name: "The envelope of turning lines" }),
  ).toBeVisible();
  await expect(field(page, "Second point x(t)")).toHaveCount(0);
  await expect(page.getByTestId("second-curve")).toHaveCount(0);
  await field(page, "Direction angle θ(t)").fill("s");
  await expect(page.getByRole("alert")).toContainText("direction angle");
  await field(page, "Direction angle θ(t)").fill("t+pi/2");
  await settled(page);
  expect((await definition(page)).envelope).toMatchObject({
    mode: "angle",
    angle: "t+pi/2",
    x: "cos(a*t)",
  });
  // Tangent lines of the unit circle envelope the circle itself; none of
  // them has a chord's far end or a virtual part.
  await expect(lines(page)).toHaveCount(121);
  await expect(page.getByText(/omitted samples/)).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", { name: "Virtual extensions" }),
  ).toHaveCount(0);
});

test("folding a parabola draws the creases across the whole view", async ({
  page,
}) => {
  await ready(page, "Folding a parabola");
  await expect(page.getByText(/omitted samples/)).toHaveCount(0);
  await expect(lines(page)).toHaveCount(41);
  // Every crease through (t, 0) runs off the drawing at both ends.
  for (const [x1, y1, x2, y2] of await segments(page)) {
    expect(outside(x1, y1) && outside(x2, y2)).toBe(true);
  }
  // Each crease crosses the axis at its own point (t, 0) with slope t.
  const drawn = await segments(page);
  for (const k of [0, 10, 20, 33, 40]) {
    const t = -4 + (Math.round((k * 999) / 40) * 8) / 999;
    const [x1, y1, x2, y2] = drawn[k];
    const foot = await toScreen(page, { x: t, y: 0 });
    // Screen y grows downward.
    expect((y1 - y2) / (x2 - x1)).toBeCloseTo(t, 6);
    expect(y1 + ((foot.x - x1) * (y2 - y1)) / (x2 - x1)).toBeCloseTo(foot.y, 3);
  }
});

test("an exported chord envelope keeps its drawing and definition", async ({
  page,
}) => {
  await ready(page);
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const file = await download;
  expect(file.suggestedFilename()).toBe("tangent-garden-envelope.svg");
  const svg = await readFile((await file.path())!, "utf8");
  const exported = await page.evaluate((s) => {
    const doc = new DOMParser().parseFromString(s, "image/svg+xml");
    return {
      config: JSON.parse(doc.querySelector("desc")!.textContent!),
      lines: doc.querySelectorAll('[data-testid="envelope-line"]').length,
      second: doc.querySelectorAll('[data-testid="second-curve"]').length,
    };
  }, svg);
  expect(exported.config.envelope.mode).toBe("chord");
  expect(exported.config.curve.a).toBe(2);
  expect(exported.lines).toBe(119);
  expect(exported.second).toBe(1);
});

for (const camera of ["hold", "current", "follow", "fit"]) {
  test(`chord multiplier animation reaches its endpoints with ${camera} camera`, async ({
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
    ).toHaveValue("a");
    await page.getByRole("textbox", { name: "Track 1 from" }).fill("2");
    await page.getByRole("textbox", { name: "Track 1 to" }).fill("1+phi");
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
    expect((await definition(page)).curve.a).toBe(1 + (1 + Math.sqrt(5)) / 2);
    await page.getByRole("button", { name: /^(Stop|Back to study)$/ }).click();
    const restored = await definition(page);
    expect(restored.curve).toEqual(original.curve);
    expect(restored.envelope).toEqual(original.envelope);
  });
}

test("reveal draws the chords in order, pauses, resumes, and an edit cancels", async ({
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
  const count = await lines(page).count();
  // Chords k = 1… up to the revealed sample, 20 samples apart.
  expect(count).toBe(Math.floor((paused * 2400) / 20));
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  await expect(lines(page)).toHaveCount(119);
  await page.getByRole("button", { name: "Replay", exact: true }).click();
  await expect.poll(() => progress(page)).toBeGreaterThan(0);
  await field(page, "Second point y(t)").fill("sin(a*t+0.1)");
  await settled(page);
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-progress",
  );
  expect((await definition(page)).envelope.y).toBe("sin(a*t+0.1)");
  await expect(lines(page)).toHaveCount(121);
});

for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`envelope layout in ${theme} at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme });
      await ready(page);
      for (const name of ["Second point x(t)", "Second point y(t)"])
        await expect(field(page, name)).toBeVisible();
      const section = page
        .locator("section")
        .filter({ hasText: "03 / THE FAMILY" });
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
        path: testInfo.outputPath(`envelope-${theme}-${width}.png`),
        fullPage: true,
      });
    });
  }
}
