import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { applyTracks, availableTargets, reveal } from "../web/animation";
import { fitFrame } from "../web/Plot";
import { presets } from "../web/presets";
import type { Result, Vec } from "../web/types";
import { exportImage, openAnimation, choosePreset } from "./helpers";

const title = "Hypotrochoid & its evolute";
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
// Definition parameters are constant-expression text fields; counts are numeric.
const field = (page: Page, name: string) =>
  page.getByLabel(name, { exact: true });
const rolling = (page: Page) => page.getByTestId("rolling-circle");
const note = (page: Page) => page.getByTestId("closure-note");
const scale = async (page: Page) =>
  Number(await page.locator("#artwork").getAttribute("data-camera-scale"));
// Screen position of the world origin, from the camera center and scale.
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

test("the roulette preset is the reference hypotrochoid and animates its rolling geometry", () => {
  const preset = presets.find((p) => p.title === title)!.config;
  expect(preset.curve.format).toBe("roulette");
  expect(preset.curve.roulette).toEqual({
    roll: "inside",
    fixedRadius: 5,
    radius: 2,
    arm: 3,
    phase: 0,
  });
  expect([preset.curve.min, preset.curve.max]).toEqual([0, 4 * Math.PI]);
  const targets = availableTargets(preset);
  expect(targets.slice(0, 4)).toEqual([
    "rollArm",
    "rollPhase",
    "rollRadius",
    "rollFixed",
  ]);
  // A roulette's shape comes from its radii, not the expression coefficient.
  expect(targets).not.toContain("a");
  const line = {
    ...preset,
    curve: {
      ...preset.curve,
      roulette: { ...preset.curve.roulette, roll: "line" as const },
    },
  };
  expect(availableTargets(line)).not.toContain("rollFixed");
  expect(availableTargets(presets[0].config)).not.toContain("rollArm");
  const tracks = [
    { target: "rollArm" as const, from: 1 / 1.618, to: Math.PI / 2 },
    { target: "rollPhase" as const, from: 0, to: 2 * Math.PI },
    { target: "rollRadius" as const, from: 2, to: Math.SQRT2 },
    { target: "rollFixed" as const, from: 5, to: Math.E },
  ];
  expect(applyTracks(preset, tracks, 0, 1).config.curve.roulette).toEqual({
    roll: "inside",
    fixedRadius: 5,
    radius: 2,
    arm: 1 / 1.618,
    phase: 0,
  });
  expect(applyTracks(preset, tracks, 1, 1).config.curve.roulette).toEqual({
    roll: "inside",
    fixedRadius: Math.E,
    radius: Math.SQRT2,
    arm: Math.PI / 2,
    phase: 2 * Math.PI,
  });
  // The base study is never mutated.
  expect(preset.curve.roulette.arm).toBe(3);
});

test("reveal moves the rolling circle with the trace; framing holds the fixed circle", () => {
  const point = (x: number): Vec => ({ x, y: 0 });
  const position = (i: number) => ({
    sampleIndex: i,
    center: point(i),
    radius: 1,
    contact: point(i + 1),
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
    roulette: {
      roll: "inside",
      fixedRadius: 30,
      turns: 2,
      lobes: 5,
      positions: [0, 1, 3].map(position),
    },
    warnings: [],
    invalid: 1,
  };
  const half = reveal(result, 0.5);
  expect(half.roulette!.positions.map((s) => s.sampleIndex)).toEqual([0, 1]);
  expect(half.roulette!.turns).toBe(2);
  expect(reveal(result, 1)).toEqual(result);
  // Non-roulette results stay without one.
  expect(reveal({ ...result, roulette: undefined }, 0.5).roulette).toBe(
    undefined,
  );
  const config = presets.find((p) => p.title === title)!.config;
  // The fixed circle is framed in full although the trace is small.
  const frame = fitFrame(result, config);
  expect(frame.span).toBeGreaterThanOrEqual(60);
  expect(Math.abs(frame.cx)).toBeLessThan(1e-9);
  // Along a line only the rolling circles are framed: the line is unbounded.
  const line = fitFrame(
    { ...result, roulette: { ...result.roulette!, roll: "line" } },
    config,
  );
  expect(line.span).toBeLessThan(6);
});

test("the preset draws the fixed and rolling circles at the end of the trace", async ({
  page,
}) => {
  await ready(page);
  await expect(
    page.getByRole("combobox", { name: "Definition", exact: true }),
  ).toHaveValue("roulette");
  // Expressions and the shape coefficient do not apply to a roulette.
  await expect(page.getByRole("textbox", { name: "x(t)" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "y(t)" })).toHaveCount(0);
  await expect(field(page, "Shape parameter a")).toHaveCount(0);
  await expect(note(page)).toHaveText(
    "R/r = 5/2: the trace closes after 2 turns of the rolling center (t over 4π), with 5 arches.",
  );
  await expect(page.getByText(/omitted samples/)).toHaveCount(0);
  // Whole multiples of pi read as such in the domain fields.
  await expect(
    page.getByRole("textbox", { name: "to", exact: true }),
  ).toHaveValue("4*pi");
  const s = await scale(page);
  const origin = await toScreen(page, { x: 0, y: 0 });
  const [fx, fy, fr] = await circleAttributes(
    page,
    '[data-testid="fixed-circle"]',
  );
  expect(fx).toBeCloseTo(origin.x, 6);
  expect(fy).toBeCloseTo(origin.y, 6);
  expect(fr / s).toBeCloseTo(5, 9);
  // At t = 4π the rolling center is back at (3, 0), touching (5, 0), with the
  // arm pointing at the contact: the tracing point is at (6, 0).
  await expect(rolling(page)).toHaveAttribute("data-sample", "1999");
  const [rx, ry, rr] = await circleAttributes(
    page,
    '[data-testid="rolling-circle"] > circle:first-child',
  );
  const center = await toScreen(page, { x: 3, y: 0 });
  expect(rx).toBeCloseTo(center.x, 5);
  expect(ry).toBeCloseTo(center.y, 5);
  expect(rr / s).toBeCloseTo(2, 9);
  const [kx, ky] = await circleAttributes(
    page,
    '[data-testid="contact-point"]',
  );
  const contact = await toScreen(page, { x: 5, y: 0 });
  expect(kx).toBeCloseTo(contact.x, 5);
  expect(ky).toBeCloseTo(contact.y, 5);
  const [px, py] = await circleAttributes(
    page,
    '[data-testid="tracing-point"]',
  );
  const tracing = await toScreen(page, { x: 6, y: 0 });
  expect(px).toBeCloseTo(tracing.x, 5);
  expect(py).toBeCloseTo(tracing.y, 5);
  // The whole fixed circle and the evolute's star stay in view.
  expect(fx - fr).toBeGreaterThan(0);
  expect(fx + fr).toBeLessThan(1000);
  expect(fy - fr).toBeGreaterThan(0);
  expect(fy + fr).toBeLessThan(760);
  // Rolling geometry is construction geometry, hidden with the lines layer,
  // and hiding it never reframes the drawing.
  await page.getByRole("checkbox", { name: "Construction lines" }).uncheck();
  await expect(page.getByTestId("rolling-geometry")).toHaveCount(0);
  await expect(page.getByTestId("tracing-point")).toHaveCount(0);
  expect(await scale(page)).toBe(s);
  await page.getByRole("checkbox", { name: "Construction lines" }).check();
  await expect(rolling(page)).toBeVisible();
});

test("roulette controls validate, report closure, and trace a full period", async ({
  page,
}) => {
  await ready(page, "Ellipse & its evolute");
  const format = page.getByRole("combobox", {
    name: "Definition",
    exact: true,
  });
  await format.selectOption("roulette");
  await settled(page);
  await expect(page.getByTestId("fixed-circle")).toBeVisible();
  // The default is the reference hypotrochoid over the existing domain.
  expect((await definition(page)).curve.roulette.arm).toBe(3);
  const roll = page.getByRole("combobox", { name: "Rolling", exact: true });
  await roll.selectOption("outside");
  await field(page, "Rolling radius r").fill("2.2");
  await settled(page);
  await expect(note(page)).toContainText("R/r = 25/11");
  await expect(note(page)).toContainText("11 turns");
  // Close is not forced for a ratio without a small denominator.
  await field(page, "Fixed radius R").fill("5.123456789");
  await settled(page);
  await expect(note(page)).toContainText("never closes exactly");
  await expect(
    page.getByRole("button", { name: "Trace one full period" }),
  ).toHaveCount(0);
  await field(page, "Fixed radius R").fill("3");
  await field(page, "Rolling radius r").fill("1");
  await page.getByRole("textbox", { name: "to", exact: true }).fill("1");
  await settled(page);
  await expect(note(page)).toContainText("R/r = 3/1");
  await expect(note(page)).toContainText("after 1 turn ");
  await page.getByRole("button", { name: "Trace one full period" }).click();
  await settled(page);
  await expect(
    page.getByRole("textbox", { name: "to", exact: true }),
  ).toHaveValue("2*pi");
  expect((await definition(page)).curve.max).toBe(2 * Math.PI);
  // A start other than zero keeps its offset.
  await page.getByRole("textbox", { name: "t from" }).fill("pi/3");
  await page.getByRole("button", { name: "Trace one full period" }).click();
  await settled(page);
  expect((await definition(page)).curve.max).toBeCloseTo(
    Math.PI / 3 + 2 * Math.PI,
    12,
  );
  // Invalid inputs explain themselves.
  await roll.selectOption("inside");
  await field(page, "Rolling radius r").fill("3");
  await expect(page.getByRole("alert")).toContainText(
    "smaller than the fixed radius",
  );
  await field(page, "Rolling radius r").fill("1");
  await field(page, "Tracing distance d").fill("");
  await expect(page.getByRole("alert")).toContainText("finite number");
  await field(page, "Tracing distance d").fill("-1");
  await expect(page.getByRole("alert")).toContainText("tracing distance");
  await field(page, "Tracing distance d").fill("1");
  await settled(page);
  // Along a line there is no fixed radius and no closure.
  await roll.selectOption("line");
  await settled(page);
  await expect(field(page, "Fixed radius R")).toHaveCount(0);
  await expect(page.getByTestId("fixed-circle")).toHaveCount(0);
  await expect(page.getByTestId("fixed-line")).toHaveCount(1);
  await expect(note(page)).toContainText("never closes");
  // The fixed line crosses the whole drawing at y = 0.
  const [x1, y1, x2, y2] = await page
    .getByTestId("fixed-line")
    .locator("line")
    .evaluate((l) =>
      ["x1", "y1", "x2", "y2"].map((k) => Number(l.getAttribute(k))),
    );
  expect(x1).toBeLessThan(1e-6);
  expect(x2).toBeGreaterThan(1000 - 1e-6);
  expect(y1).toBeCloseTo((await toScreen(page, { x: 0, y: 0 })).y, 6);
  expect(y2).toBe(y1);
  // Every construction applies to the roulette, and the expressions survive.
  await page
    .getByRole("group", { name: "Construction" })
    .getByRole("button", { name: "offset", exact: true })
    .click();
  await settled(page);
  await expect(page.locator("#artwork > path")).toHaveCount(2);
  await format.selectOption("parametric");
  await settled(page);
  await expect(page.getByRole("textbox", { name: "x(t)" })).toHaveValue(
    "2*cos(t)",
  );
  await expect(page.getByTestId("rolling-geometry")).toHaveCount(0);
  await expect(note(page)).toHaveCount(0);
  expect((await definition(page)).curve.roulette.roll).toBe("line");
});

test("closure text stays put while unrelated inputs recompute", async ({
  page,
}) => {
  await ready(page);
  // Record every closure text and button presence the page ever shows.
  await page.evaluate(() => {
    const seen = new Set<string>();
    (window as any).closureSeen = seen;
    const record = () => {
      const note = document.querySelector('[data-testid="closure-note"]');
      const button = [...document.querySelectorAll("button")].some(
        (b) => b.textContent === "Trace one full period",
      );
      seen.add(`${note?.textContent} | ${button}`);
    };
    record();
    new MutationObserver(record).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
  const slider = page.getByRole("slider", { name: "Construction lines" });
  for (const lines of [50, 70, 90, 30, 40]) {
    await slider.fill(String(lines));
    await page.waitForTimeout(30);
  }
  await field(page, "Tracing distance d").fill("2.5");
  await field(page, "Phase φ (radians)").fill("1");
  await settled(page);
  expect(await page.evaluate(() => [...(window as any).closureSeen])).toEqual([
    "R/r = 5/2: the trace closes after 2 turns of the rolling center (t over 4π), with 5 arches. | true",
  ]);
  // Changing a radius does recheck closure.
  await field(page, "Rolling radius r").fill("2.2");
  await settled(page);
  await expect(note(page)).toContainText("R/r = 25/11");
});

test("an exported roulette keeps its rolling geometry and definition", async ({
  page,
}) => {
  await ready(page);
  await field(page, "Phase φ (radians)").fill("0.5");
  await settled(page);
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const file = await download;
  expect(file.suggestedFilename()).toBe("tangent-garden-evolute.svg");
  const svg = await readFile((await file.path())!, "utf8");
  const exported = await page.evaluate((s) => {
    const doc = new DOMParser().parseFromString(s, "image/svg+xml");
    return {
      config: JSON.parse(doc.querySelector("desc")!.textContent!),
      fixed: doc.querySelectorAll('[data-testid="fixed-circle"]').length,
      rolling: doc.querySelectorAll('[data-testid="rolling-circle"]').length,
    };
  }, svg);
  expect(exported.config.curve.format).toBe("roulette");
  expect(exported.config.curve.roulette.phase).toBe(0.5);
  expect(exported.fixed).toBe(1);
  expect(exported.rolling).toBe(1);
});

for (const camera of ["hold", "current", "follow", "fit"]) {
  test(`roulette phase animation reaches endpoints with ${camera} camera`, async ({
    page,
  }) => {
    await ready(page);
    const original = (await definition(page)).curve.roulette;
    await openAnimation(page);
    await page
      .getByRole("combobox", { name: "Animate", exact: true })
      .selectOption("parameters");
    const parameter = page.getByRole("combobox", {
      name: "Parameter 1",
      exact: true,
    });
    await expect(parameter).toHaveValue("rollArm");
    await parameter.selectOption("rollPhase");
    await page.getByRole("textbox", { name: "Track 1 from" }).fill("0");
    await page.getByRole("textbox", { name: "Track 1 to" }).fill("pi/5");
    await page.getByRole("button", { name: "Add parameter" }).click();
    await page
      .getByRole("combobox", { name: "Parameter 2", exact: true })
      .selectOption("rollArm");
    await page.getByRole("textbox", { name: "Track 2 from" }).fill("2");
    await page.getByRole("textbox", { name: "Track 2 to" }).fill("phi");
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
    const roulette = (await definition(page)).curve.roulette;
    expect(roulette.phase).toBe(Math.PI / 5);
    expect(roulette.arm).toBeCloseTo((1 + Math.sqrt(5)) / 2, 14);
    await expect(rolling(page)).toHaveAttribute("data-sample", "1999");
    await page.getByRole("button", { name: /^(Stop|Back to study)$/ }).click();
    expect((await definition(page)).curve.roulette).toEqual(original);
  });
}

test("reveal rolls the circle along, pauses, resumes, and an edit cancels", async ({
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
  // The circle sits at the last representative sample the trace has reached.
  const sample = Number(await rolling(page).getAttribute("data-sample"));
  expect(sample).toBeLessThanOrEqual(paused * 1999);
  expect(sample).toBeGreaterThan(paused * 1999 - 1999 / 39 - 1);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  await expect(rolling(page)).toHaveAttribute("data-sample", "1999");
  await page.getByRole("button", { name: "Replay", exact: true }).click();
  await expect.poll(() => progress(page)).toBeGreaterThan(0);
  await field(page, "Tracing distance d").fill("2");
  await settled(page);
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-progress",
  );
  expect((await definition(page)).curve.roulette.arm).toBe(2);
  await expect(rolling(page)).toHaveAttribute("data-sample", "1999");
});

for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`roulette layout in ${theme} at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme });
      await ready(page);
      await expect(field(page, "Phase φ (radians)")).toBeVisible();
      await expect(note(page)).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: testInfo.outputPath(`roulette-${theme}-${width}.png`),
        fullPage: true,
      });
    });
  }
}
