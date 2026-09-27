import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { applyTracks, availableTargets, reveal } from "../web/animation";
import { fitFrame } from "../web/Plot";
import { presets } from "../web/presets";
import type { Result, Vec } from "../web/types";
import { exportImage, openAnimation } from "./helpers";

const title = "Circles through a focus";
async function ready(page: Page, preset = title) {
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
async function progress(page: Page) {
  return Number(
    await page.locator("#artwork").getAttribute("data-animation-progress"),
  );
}
const field = (page: Page, name: string) =>
  page.getByLabel(name, { exact: true });
const family = (page: Page) =>
  page.getByRole("combobox", { name: "Family", exact: true });
const circles = (page: Page) =>
  page.getByTestId("generating-circles").locator("circle");
const radii = (page: Page) => page.getByTestId("envelope-radius");
const branches = (page: Page) =>
  page.getByTestId("envelope-branches").locator("path");
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

test("the circle presets center circles of radius R(t) on the curve, and a animates them", () => {
  const focus = presets.find((p) => p.title === title)!.config;
  expect(focus.kind).toBe("envelope");
  expect(focus.envelope).toMatchObject({ mode: "circle", radius: "t^2/4+1" });
  expect(focus.curve).toMatchObject({ x: "t", y: "t^2/4", min: -3, max: 3 });
  const breathing = presets.find(
    (p) => p.title === "Breathing circles",
  )!.config;
  expect(breathing.envelope).toMatchObject({
    mode: "circle",
    radius: "1+0.35*sin(a*t)",
  });
  // |R′| ≤ 0.35·5 stays below the center's speed 2: both branches are real.
  expect(breathing.curve.a).toBe(5);
  const swelling = presets.find((p) => p.title === "Swelling circles")!.config;
  expect(swelling.envelope.radius).toBe("1.6+1.2*sin(t)");
  const targets = availableTargets(breathing);
  expect(targets[0]).toBe("a");
  const tracks = [{ target: "a" as const, from: 5, to: 2 * Math.PI }];
  expect(applyTracks(breathing, tracks, 1, 1).config.curve.a).toBe(2 * Math.PI);
  expect(breathing.curve.a).toBe(5);
});

test("reveal keeps the branch names and draws the circles so far; framing includes every circle", () => {
  const point = (x: number, y = 0): Vec => ({ x, y });
  const result: Result = {
    base: [point(0), point(1), point(2), point(3)],
    derived: [],
    virtual: [],
    rays: [1, 2, 3].map((i) => ({
      sampleIndex: i,
      origin: point(i),
      direction: point(0),
      incident: point(0),
      target: point(i, 1),
      virtual: false,
      tir: false,
    })),
    family: [
      {
        distance: 0,
        branch: "left",
        points: [null, point(1, 1), point(2, 1), point(3, 1)],
      },
      {
        distance: 0,
        branch: "right",
        points: [null, point(1, -1), point(2, -1), point(3, -1)],
      },
    ],
    circles: [1, 2, 3].map((i) => ({
      sampleIndex: i,
      center: point(i),
      radius: 20,
    })),
    rolling: [],
    warnings: [],
    invalid: 1,
  };
  const half = reveal(result, 0.5);
  expect(half.family.map((p) => p.branch)).toEqual(["left", "right"]);
  expect(half.family[1].points).toEqual([null, point(1, -1)]);
  expect(half.circles.map((c) => c.sampleIndex)).toEqual([1]);
  const config = presets.find((p) => p.title === title)!.config;
  // x from 1 − 20 to 3 + 20.
  expect(fitFrame(result, config).span).toBeCloseTo(42, 9);
});

test("circles through a focus touch the directrix and all pass through the focus", async ({
  page,
}) => {
  await ready(page);
  await expect(
    page.getByRole("heading", { name: "The envelope of moving circles" }),
  ).toBeVisible();
  await expect(page.getByText("03 / THE FAMILY")).toBeVisible();
  await expect(family(page)).toHaveValue("circle");
  await expect(page.getByText(/omitted samples/)).toHaveCount(0);
  const config = presets.find((p) => p.title === title)!.config;
  await expect(circles(page)).toHaveCount(config.lines);
  await expect(radii(page)).toHaveCount(2 * config.lines);
  await expect(branches(page)).toHaveCount(2);
  await expect(branches(page).nth(0)).toHaveAttribute("data-branch", "left");
  await expect(branches(page).nth(1)).toHaveAttribute("data-branch", "right");
  // Each circle is centered on the parabola with radius t²/4 + 1.
  const s = await scale(page);
  for (const k of [0, 7, 12, 24]) {
    const j = Math.round((k * (config.samples - 1)) / (config.lines - 1));
    const t = -3 + (6 * j) / (config.samples - 1);
    const c = circles(page).nth(k);
    const center = await toScreen(page, { x: t, y: (t * t) / 4 });
    expect(Number(await c.getAttribute("cx"))).toBeCloseTo(center.x, 3);
    expect(Number(await c.getAttribute("cy"))).toBeCloseTo(center.y, 3);
    expect(Number(await c.getAttribute("r"))).toBeCloseTo(
      ((t * t) / 4 + 1) * s,
      3,
    );
  }
  // The right branch runs along the directrix y = −1; the left collapses to
  // the focus, drawn as a point.
  const directrix = (await toScreen(page, { x: 0, y: -1 })).y;
  for (const [, y] of runs((await branches(page).nth(1).getAttribute("d"))!)[0])
    expect(y).toBeCloseTo(directrix, 3);
  const focus = await toScreen(page, { x: 0, y: 1 });
  const dot = page.getByTestId("focus-point");
  await expect(dot).toHaveCount(1);
  expect(Number(await dot.getAttribute("cx"))).toBeCloseTo(focus.x, 3);
  expect(Number(await dot.getAttribute("cy"))).toBeCloseTo(focus.y, 3);
  // No virtual parts; circles and radii are construction lines, and hiding
  // them never reframes the drawing.
  await expect(
    page.getByRole("checkbox", { name: "Virtual extensions" }),
  ).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Construction lines" }).uncheck();
  await expect(circles(page)).toHaveCount(0);
  await expect(radii(page)).toHaveCount(0);
  expect(await scale(page)).toBe(s);
  await page.getByRole("checkbox", { name: "Derived curve" }).uncheck();
  await expect(branches(page)).toHaveCount(0);
});

test("the family selector switches to circles, validates the radius, and reports nesting", async ({
  page,
}) => {
  await ready(page, "Chords & a cardioid");
  await family(page).selectOption("circle");
  await settled(page);
  await expect(
    page.getByRole("heading", { name: "The envelope of moving circles" }),
  ).toBeVisible();
  await expect(field(page, "Second point x(t)")).toHaveCount(0);
  await expect(page.getByTestId("second-curve")).toHaveCount(0);
  await expect(page.getByTestId("envelope-line")).toHaveCount(0);
  await field(page, "Circle radius R(t)").fill("s");
  await expect(page.getByRole("alert")).toContainText("circle radius");
  // A constant radius on the unit circle: the offsets ±R, circles of 1/2 and
  // 3/2, each radius half a unit long.
  await field(page, "Circle radius R(t)").fill("0.5");
  await settled(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect((await definition(page)).envelope).toMatchObject({
    mode: "circle",
    radius: "0.5",
    x: "cos(a*t)",
  });
  const s = await scale(page);
  for (const radius of await radii(page).locator("line").all()) {
    const [x1, y1, x2, y2] = await Promise.all(
      ["x1", "y1", "x2", "y2"].map(async (k) =>
        Number(await radius.getAttribute(k)),
      ),
    );
    expect(Math.hypot(x2 - x1, y2 - y1)).toBeCloseTo(0.5 * s, 3);
  }
  // Circles growing faster than their centers move nest: no real envelope.
  await field(page, "Circle radius R(t)").fill("1+2*t");
  await settled(page);
  await expect(branches(page)).toHaveCount(2);
  expect(await branches(page).nth(0).getAttribute("d")).toBe("");
  await page.getByText(/omitted samples/).click();
  await expect(page.getByText(/no real envelope point/)).toBeVisible();
  // Back to chords, with their endpoints intact.
  await family(page).selectOption("chord");
  await settled(page);
  expect((await definition(page)).envelope.x).toBe("cos(a*t)");
  await expect(page.getByTestId("envelope-line")).toHaveCount(119);
  await expect(circles(page)).toHaveCount(0);
});

test("swelling circles leave gaps where the radius outruns the center", async ({
  page,
}) => {
  await ready(page, "Swelling circles");
  const config = presets.find((p) => p.title === "Swelling circles")!.config;
  // The circles are drawn everywhere; the branches break into runs.
  await expect(circles(page)).toHaveCount(config.lines);
  for (const branch of await branches(page).all())
    expect(runs((await branch.getAttribute("d"))!).length).toBeGreaterThan(2);
  await page.getByText(/omitted samples/).click();
  await expect(page.getByText(/no real envelope point/)).toBeVisible();
});

test("an exported circle envelope keeps its branches, circles, and definition", async ({
  page,
}) => {
  await ready(page, "Breathing circles");
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const file = await download;
  expect(file.suggestedFilename()).toBe("tangent-garden-envelope.svg");
  const svg = await readFile((await file.path())!, "utf8");
  const exported = await page.evaluate((s) => {
    const doc = new DOMParser().parseFromString(s, "image/svg+xml");
    return {
      config: JSON.parse(doc.querySelector("desc")!.textContent!),
      branches: doc.querySelectorAll('[data-testid="envelope-branches"] path')
        .length,
      circles: doc.querySelectorAll('[data-testid="generating-circles"] circle')
        .length,
      radii: doc.querySelectorAll('[data-testid="envelope-radius"]').length,
    };
  }, svg);
  const config = presets.find((p) => p.title === "Breathing circles")!.config;
  expect(exported.config.envelope).toMatchObject({
    mode: "circle",
    radius: "1+0.35*sin(a*t)",
  });
  expect(exported.branches).toBe(2);
  expect(exported.circles).toBe(config.lines);
  expect(exported.radii).toBe(2 * config.lines);
});

for (const camera of ["hold", "current", "follow", "fit"]) {
  test(`breathing circles animate a to its endpoint with ${camera} camera`, async ({
    page,
  }) => {
    await ready(page, "Breathing circles");
    const original = await definition(page);
    await openAnimation(page);
    await page
      .getByRole("combobox", { name: "Animate", exact: true })
      .selectOption("parameters");
    await expect(
      page.getByRole("combobox", { name: "Parameter 1", exact: true }),
    ).toHaveValue("a");
    await page.getByRole("textbox", { name: "Track 1 from" }).fill("5");
    await page.getByRole("textbox", { name: "Track 1 to" }).fill("2*pi");
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
    expect((await definition(page)).curve.a).toBe(2 * Math.PI);
    await expect(branches(page)).toHaveCount(2);
    await page.getByRole("button", { name: /^(Stop|Reset view)$/ }).click();
    const restored = await definition(page);
    expect(restored.curve).toEqual(original.curve);
    expect(restored.envelope).toEqual(original.envelope);
  });
}

test("reveal draws the circles in order, pauses, resumes, and an edit cancels", async ({
  page,
}) => {
  await ready(page, "Breathing circles");
  const config = presets.find((p) => p.title === "Breathing circles")!.config;
  await openAnimation(page);
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("2");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect.poll(() => progress(page)).toBeGreaterThan(0.1);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const paused = await progress(page);
  expect(paused).toBeLessThan(1);
  const last = Math.floor(paused * (config.samples - 1));
  const step = (config.samples - 1) / (config.lines - 1);
  const shown = Math.floor(last / step + 1e-9) + 1;
  await expect(circles(page)).toHaveCount(shown);
  await expect(radii(page)).toHaveCount(2 * shown);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  await expect(circles(page)).toHaveCount(config.lines);
  await page.getByRole("button", { name: "Replay", exact: true }).click();
  await expect.poll(() => progress(page)).toBeGreaterThan(0);
  await field(page, "Circle radius R(t)").fill("1+0.3*sin(a*t)");
  await settled(page);
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-progress",
  );
  expect((await definition(page)).envelope.radius).toBe("1+0.3*sin(a*t)");
  await expect(circles(page)).toHaveCount(config.lines);
});

for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`circle envelope layout in ${theme} at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme });
      await ready(page, "Breathing circles");
      await expect(field(page, "Circle radius R(t)")).toBeVisible();
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
        path: testInfo.outputPath(`circle-envelope-${theme}-${width}.png`),
        fullPage: true,
      });
    });
  }
}
