import { test, expect, type Page } from "@playwright/test";
import { availableTargets, reveal } from "../web/animation";
import { presets } from "../web/presets";
import {
  inputAllowed,
  studyName,
  type Config,
  type Result,
  type Vec,
} from "../web/types";
import { openAnimation, choosePreset } from "./helpers";

const preset = (name: string) => presets.find((p) => p.title === name)!.config;
async function ready(page: Page, name: string) {
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
async function definition(page: Page): Promise<Config> {
  return JSON.parse((await page.locator("#artwork desc").textContent())!);
}
async function progress(page: Page) {
  return Number(
    await page.locator("#artwork").getAttribute("data-animation-progress"),
  );
}
const constructOn = (page: Page) =>
  page.getByRole("combobox", { name: "Construct on", exact: true });
const inputCurve = (page: Page) => page.getByTestId("construction-input");
// Screen coordinates to world coordinates.
async function world(page: Page) {
  const artwork = page.locator("#artwork");
  const [cx, cy] = (await artwork.getAttribute("data-camera-center"))!
    .split(",")
    .map(Number);
  const s = Number(await artwork.getAttribute("data-camera-scale"));
  return ([x, y]: number[]): Vec => ({
    x: cx + (x - 500) / s,
    y: cy - (y - 380) / s,
  });
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

test("the combination presets name their input, which brings its own tracks", () => {
  expect(presets.slice(39, 43).map((p) => p.title)).toEqual([
    "Cayley's sextic, a second pedal",
    "Unwinding an evolute",
    "Rolling on an ellipse's pedal",
    "Offsets of an evolute",
  ]);
  const cayley = preset("Cayley's sextic, a second pedal");
  expect([cayley.kind, cayley.input, cayley.pole]).toEqual([
    "pedal",
    "pedal",
    { x: 0, y: 0 },
  ]);
  const unwinding = preset("Unwinding an evolute");
  expect([unwinding.kind, unwinding.input]).toEqual(["involute", "evolute"]);
  // The radius of curvature of the spiral at t = 0.
  expect(unwinding.offset).toBe(Math.sqrt(1 + 0.15 ** 2));
  const rolling = preset("Rolling on an ellipse's pedal");
  expect([rolling.kind, rolling.input]).toEqual(["rolling", "pedal"]);
  const offsets = preset("Offsets of an evolute");
  expect([offsets.kind, offsets.input, offsets.stack.enabled]).toEqual([
    "offset",
    "evolute",
    true,
  ]);
  // Every earlier study acts on the curve itself, except an inverted pedal.
  expect(
    presets.slice(0, 39).filter((p) => p.config.input !== "curve"),
  ).toEqual([presets.find((p) => p.title === "An ellipse's pedal, inverted")]);

  // The pole follows the rolling circle's own tracks; a pedal of a pedal has
  // one pole; an offset stack of an offset adds the input's distance.
  const targets = availableTargets(rolling);
  expect(targets.slice(0, 5)).toEqual([
    "rollingArm",
    "rollingPhase",
    "rollingRadius",
    "poleX",
    "poleY",
  ]);
  expect(availableTargets(cayley).filter((t) => t === "poleX").length).toBe(1);
  expect(availableTargets(offsets)).not.toContain("distance");
  expect(availableTargets({ ...offsets, input: "offset" })).toContain(
    "distance",
  );
  expect(availableTargets({ ...cayley, kind: "offset" })).toEqual(
    expect.arrayContaining(["distance", "poleX", "poleY"]),
  );

  // An evolute feeds only constructions needing at most one more derivative.
  for (const kind of ["evolute", "catacaustic", "diacaustic"] as const)
    expect(inputAllowed(kind, "evolute")).toBe(false);
  for (const kind of ["involute", "pedal", "offset", "rolling"] as const)
    expect(inputAllowed(kind, "evolute")).toBe(true);
  expect(inputAllowed("evolute", "pedal")).toBe(true);

  expect(studyName(cayley)).toBe("pedal-of-pedal");
  expect(studyName(preset("Ellipse & its evolute"))).toBe("evolute");
  expect(
    studyName({
      ...cayley,
      curve: { ...cayley.curve, format: "implicit" },
    }),
  ).toBe("implicit");
});

test("reveal slices the input like the curve", () => {
  const p = (x: number): Vec => ({ x, y: 0 });
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
    input: [p(5), null, p(7), p(8)],
  };
  expect(reveal(result, 0.5).input).toEqual([p(5), null]);
  expect(reveal(result, 1).input).toEqual(result.input);
});

test("the second pedal of a circle through its pole is Cayley's sextic, drawn with the cardioid it comes from", async ({
  page,
}) => {
  await ready(page, "Cayley's sextic, a second pedal");
  await expect(inputCurve(page)).toHaveCount(1);
  await expect(page.getByTestId("pole-point")).toHaveCount(1);
  await expect(page.getByTestId("input-description")).toContainText(
    "curve’s pedal",
  );
  const toWorld = await world(page);
  const d = (await page.getByTestId("derived-curve").getAttribute("d"))!;
  let checked = 0;
  for (const run of runs(d))
    for (const xy of run) {
      const { x, y } = toWorld(xy);
      const r = Math.hypot(x, y);
      // It reaches the origin along the y-axis, where the drawn point's
      // angle is meaningless.
      if (r < 0.05) continue;
      const theta = Math.atan2(y, x);
      // r = 2cos³(θ/3) for θ in (−3π/2, 3π/2); the inner loop has |θ| > π.
      const off = Math.min(
        ...[-1, 0, 1].map((k) => {
          const c = Math.cos((theta + 2 * Math.PI * k) / 3);
          return c > 0 ? Math.abs(r - 2 * c ** 3) : Infinity;
        }),
      );
      expect(off).toBeLessThan(5e-3);
      checked++;
    }
  expect(checked).toBeGreaterThan(1000);
  // The input is the cardioid r = 1 + cos θ, so r = r² − x.
  for (const run of runs((await inputCurve(page).getAttribute("d"))!))
    for (const xy of run) {
      const { x, y } = toWorld(xy);
      const rr = x * x + y * y;
      expect(Math.abs(Math.sqrt(rr) - (rr - x))).toBeLessThan(5e-3);
    }
});

test("offsets of an evolute are left open at its cusps, never joined across", async ({
  page,
}) => {
  await ready(page, "Offsets of an evolute");
  const members = page.getByTestId("offset-family").locator("path");
  await expect(members).toHaveCount(9);
  for (const member of await members.all()) {
    const pieces = runs((await member.getAttribute("d"))!);
    // Cusps at the three vertices between samples; the ends are cusps too.
    expect(pieces).toHaveLength(4);
    for (const run of pieces)
      for (let k = 1; k < run.length; k++)
        expect(
          Math.hypot(run[k][0] - run[k - 1][0], run[k][1] - run[k - 1][1]),
        ).toBeLessThan(20);
  }
  await page.getByText(/omitted samples/).click();
  await expect(
    page.locator(".diagnostics").getByText(/tangent reverses between samples/),
  ).toBeVisible();
});

test("the input is chosen once for every construction, and an evolute cannot feed a second-order one", async ({
  page,
}) => {
  await ready(page, "Ellipse & its evolute");
  await expect(constructOn(page)).toHaveValue("curve");
  await expect(inputCurve(page)).toHaveCount(0);
  await expect(page.getByTestId("input-description")).toHaveCount(0);
  // The evolute's evolute would need the fourth derivative.
  await expect(
    constructOn(page).locator('option[value="evolute"]'),
  ).toBeDisabled();
  await constructOn(page).selectOption("orthotomic");
  await settled(page);
  expect((await definition(page)).input).toBe("orthotomic");
  await expect(inputCurve(page)).toHaveCount(1);
  // The pole is the input's, shown with it and marked on the drawing.
  await page.getByLabel("Pole x", { exact: true }).fill("0.5");
  await settled(page);
  expect((await definition(page)).pole.x).toBe(0.5);
  await expect(page.getByTestId("pole-point")).toHaveCount(1);
  // The input carries over to other constructions.
  await page.getByRole("button", { name: "involute", exact: true }).click();
  await settled(page);
  expect((await definition(page)).input).toBe("orthotomic");
  await constructOn(page).selectOption("evolute");
  await settled(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(inputCurve(page)).toHaveCount(1);
  // Moving to a construction it cannot feed returns to the curve itself.
  await page.getByRole("button", { name: "catacaustic", exact: true }).click();
  await settled(page);
  expect((await definition(page)).input).toBe("curve");
  await expect(constructOn(page)).toHaveValue("curve");
  await expect(inputCurve(page)).toHaveCount(0);
  await expect(page.getByTestId("pole-point")).toHaveCount(0);
  // Formats with no parameter have nothing to construct on.
  await page
    .getByRole("combobox", { name: "Definition" })
    .selectOption("implicit");
  await settled(page);
  await expect(constructOn(page)).toHaveCount(0);
});

for (const camera of ["hold", "current", "follow", "fit"]) {
  test(`the input's pole animates to its endpoint with ${camera} camera`, async ({
    page,
  }) => {
    await ready(page, "Rolling on an ellipse's pedal");
    const original = await definition(page);
    await openAnimation(page);
    await page
      .getByRole("combobox", { name: "Animate", exact: true })
      .selectOption("parameters");
    await page
      .getByRole("combobox", { name: "Parameter 1", exact: true })
      .selectOption("poleX");
    await page.getByRole("textbox", { name: "Track 1 from" }).fill("0");
    await page.getByRole("textbox", { name: "Track 1 to" }).fill("pi/10");
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
    expect((await definition(page)).pole.x).toBe(Math.PI / 10);
    await expect(inputCurve(page)).toHaveCount(1);
    await page.getByRole("button", { name: /^(Stop|Back to study)$/ }).click();
    expect((await definition(page)).pole).toEqual(original.pole);
  });
}

test("reveal unwinds the evolute's string in order, pauses, resumes, and an edit cancels", async ({
  page,
}) => {
  await ready(page, "Unwinding an evolute");
  const config = preset("Unwinding an evolute");
  const vertices = async () =>
    runs((await inputCurve(page).getAttribute("d"))!).flat().length;
  expect(await vertices()).toBe(config.samples);
  await openAnimation(page);
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("2");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect.poll(() => progress(page)).toBeGreaterThan(0.1);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const paused = await progress(page);
  expect(paused).toBeLessThan(1);
  expect(await vertices()).toBe(Math.floor(paused * (config.samples - 1)) + 1);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  expect(await vertices()).toBe(config.samples);
  await page.getByRole("button", { name: "Replay", exact: true }).click();
  await expect.poll(() => progress(page)).toBeGreaterThan(0);
  await page.getByLabel("Initial string offset c", { exact: true }).fill("1");
  await settled(page);
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-progress",
  );
  expect((await definition(page)).offset).toBe(1);
});
