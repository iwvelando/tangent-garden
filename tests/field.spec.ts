import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  applyTracks,
  availableTargets,
  reveal,
  targetLabel,
  targetValue,
} from "../web/animation";
import { endNote, nextSeed } from "../web/flow";
import { fitFrame } from "../web/Plot";
import { presets } from "../web/presets";
import type { FieldResult, Result, Vec } from "../web/types";
import { exportImage, openAnimation, choosePreset } from "./helpers";

const vanDerPol = "Van der Pol limit cycle";
const pendulum = "Pendulum phase portrait";
const preset = (title: string) =>
  presets.find((p) => p.title === title)!.config;
async function ready(page: Page, title: string) {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await choosePreset(page, { label: title });
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
const input = (page: Page, name: string) =>
  page.getByLabel(name, { exact: true });
const note = (page: Page) => page.getByTestId("field-note");
const arrows = (page: Page) => page.getByTestId("field-arrow");
const directions = (page: Page) => page.getByTestId("field-direction");
const scale = async (page: Page) =>
  Number(await page.locator("#artwork").getAttribute("data-camera-scale"));
// Screen and drawing coordinates, from the camera's center and scale.
async function camera(page: Page) {
  const [cx, cy] = (await page
    .locator("#artwork")
    .getAttribute("data-camera-center"))!
    .split(",")
    .map(Number);
  const s = await scale(page);
  return {
    screen: (p: Vec) => ({ x: 500 + (p.x - cx) * s, y: 380 - (p.y - cy) * s }),
    plot: ([x, y]: number[]) => ({
      x: cx + (x - 500) / s,
      y: cy - (y - 380) / s,
    }),
  };
}
// Each trajectory's drawn vertices, in screen units.
const trajectories = (page: Page) =>
  page.getByTestId("field-path").evaluateAll((all) =>
    all.map((p) =>
      p
        .getAttribute("d")!
        .split(/[ML]/)
        .filter(Boolean)
        .map((xy) => xy.split(",").map(Number)),
    ),
  );
const lastArrow = async (page: Page) =>
  Math.max(
    ...(await arrows(page).evaluateAll((all) =>
      all.map((a) => Number(a.getAttribute("data-sample"))),
    )),
  );

test("the field presets are a Van der Pol oscillator and a pendulum", () => {
  const vdp = preset(vanDerPol);
  expect(vdp.curve.format).toBe("field");
  expect(vdp.curve.field).toEqual({
    x: "y",
    y: "a*(1-x^2)*y-x",
    seeds: [
      { x: 0.1, y: 0 },
      { x: 3, y: 3 },
    ],
    escape: 10,
  });
  expect(vdp.curve.a).toBe(1);
  expect(vdp.kind).toBe("offset");
  expect(vdp.stack).toEqual({ enabled: true, from: -0.3, to: 0.3, count: 7 });
  const swing = preset(pendulum);
  expect(swing.kind).toBe("evolute");
  expect(swing.curve.field.y).toBe("-sin(x)");
  expect(swing.curve.field.seeds.map((s) => s.y)).toEqual([
    1.2, 0.6, 1.8, 2.2, -2.2, 2.8, -2.8,
  ]);
  expect(swing.curve.field.escape).toBe(7);
  expect([swing.curve.min, swing.curve.max]).toEqual([0, 9.2]);
});

test("each seed and the escape radius are animatable, and so is a", () => {
  const config = preset(pendulum);
  const targets = availableTargets(config);
  expect(targets.slice(0, 15)).toEqual([
    ...[1, 2, 3, 4, 5, 6, 7].flatMap((k) => [`seed${k}X`, `seed${k}Y`]),
    "fieldEscape",
  ]);
  // The field's expressions may use a.
  expect(targets).toContain("a");
  expect(targetLabel("seed2X")).toBe("Seed x₂");
  expect(targetLabel("seed14Y")).toBe("Seed y₁₄");
  expect(targetLabel("fieldEscape")).toBe("Escape radius R");
  expect(targetValue(config, "seed4Y", 1)).toBe(2.2);
  expect(targetValue(config, "seed9X", 1)).toBeNaN();
  expect(targetValue(config, "fieldEscape", 1)).toBe(7);
  const tracks = [
    { target: "seed1Y" as const, from: 1.2, to: 1 / 3 },
    { target: "fieldEscape" as const, from: 7, to: 9 },
    { target: "a" as const, from: 1, to: 2 },
    // A seed that no longer exists is left alone.
    { target: "seed9X" as const, from: 0, to: 1 },
  ];
  const end = applyTracks(config, tracks, 1, 1).config;
  expect(end.curve.field.seeds[0]).toEqual({ x: 0, y: 1 / 3 });
  expect(end.curve.field.escape).toBe(9);
  expect(end.curve.a).toBe(2);
  expect(end.curve.field.seeds).toHaveLength(7);
  expect(applyTracks(config, tracks, 0, 1).config).toEqual(config);
  expect(config.curve.field.seeds[0].y).toBe(1.2);
});

test("the end note and added seeds", () => {
  const flow = (ends: FieldResult["ends"], timed = false): FieldResult => ({
    paths: [],
    arrows: [],
    ends,
    timed,
    grid: { spacing: 0, points: [] },
  });
  expect(endNote(flow([{ time: 3, reason: "end" }]), 0)).toBe(
    "The trajectory runs to the end of the domain.",
  );
  expect(
    endNote(
      flow([
        { time: 3, reason: "end" },
        { time: 3, reason: "end" },
      ]),
      0,
    ),
  ).toBe("Every trajectory runs to the end of the domain.");
  expect(
    endNote(
      flow([
        { time: 3, reason: "end" },
        { time: 1.234567891, reason: "escape" },
        { time: -1, reason: "escape" },
        { time: 0.5, reason: "singular" },
        { time: -1, reason: "singular" },
        { time: 2, reason: "exhausted" },
      ]),
      -1,
    ),
  ).toBe(
    "Trajectory 2 leaves the escape circle at t = 1.23457. " +
      "Seed 3 is outside the escape circle, so it has no path. " +
      "Trajectory 4 stops at t = 0.5, where the field stops being finite or changes too fast to follow. " +
      "The field is not finite at seed 5, so it has no path. " +
      "Trajectory 6 ran out of integration steps at t = 2; a shorter domain needs fewer. " +
      "The others run to the end of the domain.",
  );
  expect(endNote(flow([{ time: 3, reason: "end" }], true), 0)).toBe(
    "The trajectory runs to the end of the domain. The field changes with t, so no single direction field is drawn.",
  );
  // One more step along the last two seeds, or beside a single one.
  expect(
    nextSeed([
      { x: 0, y: 1 },
      { x: 0, y: 1.5 },
    ]),
  ).toEqual({ x: 0, y: 2 });
  expect(nextSeed([{ x: 1, y: 2 }])).toEqual({ x: 1.5, y: 2 });
  expect(nextSeed([{ x: NaN, y: 2 }])).toEqual({ x: 0, y: 0 });
});

test("reveal gives every trajectory the same time; framing holds each one", () => {
  const point = (x: number, y = 0): Vec => ({ x, y });
  const arrow = (sampleIndex: number, seed: number) => ({
    sampleIndex,
    seed,
    point: point(sampleIndex),
    velocity: point(1),
  });
  const result: Result = {
    base: [point(0), point(1), point(2), point(3)],
    derived: [null, null, null, null],
    virtual: [false, false, false, false],
    rays: [],
    family: [],
    circles: [],
    rolling: [],
    field: {
      paths: [
        [point(0), point(1), point(2), point(3)],
        [point(0, 40), point(0, 38), null, null],
      ],
      arrows: [arrow(0, 0), arrow(0, 1), arrow(3, 0)],
      ends: [
        { time: 3, reason: "end" },
        { time: 1.5, reason: "escape" },
      ],
      timed: false,
      grid: {
        spacing: 1,
        points: [{ point: point(9, 9), velocity: point(1) }],
      },
    },
    warnings: [],
    invalid: 0,
  };
  const half = reveal(result, 0.5);
  expect(half.field!.paths.map((p) => p.length)).toEqual([2, 2]);
  expect(half.field!.arrows.map((a) => a.sampleIndex)).toEqual([0, 0]);
  expect(half.field!.ends).toEqual(result.field!.ends);
  expect(half.field!.grid).toEqual(result.field!.grid);
  expect(reveal(result, 1)).toEqual(result);
  // The second trajectory, far above the base, is framed as its own
  // family; the direction field and the escape circle are not framed.
  const frame = fitFrame(result, preset(pendulum));
  expect(frame.cy).toBeGreaterThan(15);
  expect(frame.span).toBeGreaterThanOrEqual(40);
  expect(frame.span).toBeLessThan(60);
});

test("the pendulum preset draws swings, escapes, and the direction field", async ({
  page,
}) => {
  await ready(page, pendulum);
  await expect(page.getByTestId("field-path")).toHaveCount(7);
  await expect(page.getByTestId("seed")).toHaveCount(7);
  await expect(note(page)).toHaveText(
    "Trajectory 4 leaves the escape circle at t = 4.39178. " +
      "Trajectory 5 leaves the escape circle at t = 4.39178. " +
      "Trajectory 6 leaves the escape circle at t = 2.70898. " +
      "Trajectory 7 leaves the escape circle at t = 2.70898. " +
      "The others run to the end of the domain.",
  );
  const { screen, plot } = await camera(page);
  const s = await scale(page);
  const circle = page.getByTestId("escape-circle");
  expect(Number(await circle.getAttribute("r"))).toBeCloseTo(7 * s, 6);
  const center = screen({ x: 0, y: 0 });
  expect(Number(await circle.getAttribute("cx"))).toBeCloseTo(center.x, 6);
  const drawn = (await trajectories(page)).map((path) => path.map(plot));
  // Energy y²/2 − cos x is conserved along every trajectory, to the
  // drawing's precision.
  for (const [k, path] of drawn.entries()) {
    const seed = preset(pendulum).curve.field.seeds[k];
    const energy = seed.y ** 2 / 2 - Math.cos(seed.x);
    const drift = Math.max(
      ...path.map((p) => Math.abs(p.y ** 2 / 2 - Math.cos(p.x) - energy)),
    );
    expect(drift).toBeLessThan(1e-4);
  }
  // The swings close; the others stop at the escape circle.
  for (const k of [0, 1, 2]) {
    const [first, last] = [drawn[k][0], drawn[k].at(-1)!];
    expect(Math.hypot(first.x, first.y)).toBeGreaterThan(0.5);
    expect(Math.hypot(last.x, last.y)).toBeLessThan(7);
  }
  for (const k of [3, 4, 5, 6]) {
    const r = Math.hypot(drawn[k].at(-1)!.x, drawn[k].at(-1)!.y);
    expect(r).toBeLessThanOrEqual(7 + 1e-3);
    expect(r).toBeGreaterThan(6.98);
  }
  // Mirror seeds have mirror trajectories: the field is odd.
  for (const [a, b] of [
    [3, 4],
    [5, 6],
  ]) {
    expect(drawn[a]).toHaveLength(drawn[b].length);
    const worst = Math.max(
      ...drawn[a].map((p, j) =>
        Math.hypot(p.x + drawn[b][j].x, p.y + drawn[b][j].y),
      ),
    );
    expect(worst).toBeLessThan(1e-4);
  }
  // Each direction is the field's at its lattice point, (y, −sin x).
  const lattice = await directions(page).evaluateAll((all) =>
    all.map((p) => {
      const [start, tip] = p
        .getAttribute("d")!
        .split("M")[1]
        .split("L")
        .map((xy) => xy.split(",").map(Number));
      return { start, tip };
    }),
  );
  expect(lattice.length).toBeGreaterThan(150);
  const off = lattice.map(({ start, tip }) => {
    const mid = plot([(start[0] + tip[0]) / 2, (start[1] + tip[1]) / 2]);
    const angle = Math.atan2(-(tip[1] - start[1]), tip[0] - start[0]);
    const want = Math.atan2(-Math.sin(mid.x), mid.y);
    return Math.abs(((angle - want + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
  });
  expect(Math.max(...off)).toBeLessThan(2e-3);
  // Chevrons along the trajectories point the way they run.
  expect(await arrows(page).count()).toBe(108);
});

test("seeds are added, edited, and removed; errors and a timed field", async ({
  page,
}) => {
  await ready(page, vanDerPol);
  await expect(note(page)).toHaveText(
    "Every trajectory runs to the end of the domain.",
  );
  await expect(directions(page)).toHaveCount(420);
  await page.getByRole("button", { name: "Add a seed" }).click();
  await settled(page);
  expect((await definition(page)).curve.field.seeds[2]).toEqual({
    x: 5.9,
    y: 6,
  });
  await expect(page.getByTestId("field-path")).toHaveCount(3);
  await input(page, "Seed y₃").fill("-sqrt(2)");
  await input(page, "Seed x₃").fill("-pi");
  await settled(page);
  expect((await definition(page)).curve.field.seeds[2]).toEqual({
    x: -Math.PI,
    y: -Math.SQRT2,
  });
  await page.getByRole("button", { name: "Remove seed 1" }).click();
  await settled(page);
  expect((await definition(page)).curve.field.seeds).toEqual([
    { x: 3, y: 3 },
    { x: -Math.PI, y: -Math.SQRT2 },
  ]);
  // A seed outside the escape circle has no path.
  await input(page, "Escape radius R").fill("4");
  await settled(page);
  await expect(note(page)).toHaveText(
    "Seed 1 is outside the escape circle, so it has no path. The others run to the end of the domain.",
  );
  await page.getByRole("button", { name: "Remove seed 1" }).click();
  await settled(page);
  await expect(
    page.getByRole("button", { name: "Remove seed 1" }),
  ).toBeDisabled();
  // A field that reads t has no single direction field.
  await page.getByRole("textbox", { name: "dx/dt" }).fill("y*cos(t)");
  await settled(page);
  await expect(note(page)).toContainText(
    "The field changes with t, so no single direction field is drawn.",
  );
  await expect(directions(page)).toHaveCount(0);
  await expect(arrows(page).first()).toBeAttached();
  // Sixteen seeds at most.
  for (let n = 1; n < 16; n++)
    await page.getByRole("button", { name: "Add a seed" }).click();
  await expect(
    page.getByRole("button", { name: "At most 16 seeds" }),
  ).toBeDisabled();
  await settled(page);
  expect((await definition(page)).curve.field.seeds).toHaveLength(16);
  await page.getByRole("textbox", { name: "dy/dt" }).fill("x*z");
  await expect(page.getByRole("alert")).toContainText(
    'dy/dt: unknown name "z"',
  );
  await page.getByRole("textbox", { name: "dy/dt" }).fill("-x");
  await input(page, "Escape radius R").fill("0");
  await expect(page.getByRole("alert")).toContainText(
    "the escape radius must be finite, positive, and at most 100000",
  );
});

test("an exported field keeps every trajectory and direction", async ({
  page,
}) => {
  await ready(page, pendulum);
  await input(page, "Seed y₂").fill("1/2");
  await settled(page);
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const svg = await readFile((await (await download).path())!, "utf8");
  const exported = await page.evaluate((s) => {
    const doc = new DOMParser().parseFromString(s, "image/svg+xml");
    return {
      config: JSON.parse(doc.querySelector("desc")!.textContent!),
      paths: doc.querySelectorAll('[data-testid="field-path"]').length,
      directions: doc.querySelectorAll('[data-testid="field-direction"]')
        .length,
      arrows: doc.querySelectorAll('[data-testid="field-arrow"]').length,
      circle: doc.querySelectorAll('[data-testid="escape-circle"]').length,
    };
  }, svg);
  expect(exported.config.curve.format).toBe("field");
  expect(exported.config.curve.field.seeds[1]).toEqual({ x: 0, y: 0.5 });
  expect(exported.paths).toBe(7);
  expect(exported.directions).toBe(await directions(page).count());
  expect(exported.arrows).toBe(await arrows(page).count());
  expect(exported.circle).toBe(1);
});

for (const mode of ["hold", "current", "follow", "fit"]) {
  test(`seed animation reaches endpoints with ${mode} camera`, async ({
    page,
  }) => {
    await ready(page, pendulum);
    const original = (await definition(page)).curve;
    await openAnimation(page);
    await page
      .getByRole("combobox", { name: "Animate", exact: true })
      .selectOption("parameters");
    const parameter = page.getByRole("combobox", {
      name: "Parameter 1",
      exact: true,
    });
    await expect(parameter).toHaveValue("seed1X");
    await parameter.selectOption({ label: "Seed y₁" });
    await page.getByRole("textbox", { name: "Track 1 to" }).fill("phi");
    await page.getByRole("button", { name: "Add parameter" }).click();
    await page
      .getByRole("combobox", { name: "Parameter 2", exact: true })
      .selectOption({ label: "Escape radius R" });
    await page.getByRole("textbox", { name: "Track 2 to" }).fill("2*pi");
    await page
      .getByRole("combobox", { name: "Animation camera" })
      .selectOption(mode);
    await page
      .getByRole("spinbutton", { name: "Duration (seconds)" })
      .fill(".2");
    await page.getByRole("button", { name: "Play animation" }).click();
    await expect(
      page.getByRole("button", { name: "Replay", exact: true }),
    ).toBeVisible();
    const curve = (await definition(page)).curve;
    expect(curve.field.seeds[0].y).toBe((1 + Math.sqrt(5)) / 2);
    expect(curve.field.escape).toBe(2 * Math.PI);
    // The escape circle is drawn at the animated radius.
    const circle = page.getByTestId("escape-circle");
    expect(Number(await circle.getAttribute("r"))).toBeCloseTo(
      2 * Math.PI * (await scale(page)),
      6,
    );
    await page.getByRole("button", { name: /^(Stop|Reset view)$/ }).click();
    expect((await definition(page)).curve).toEqual(original);
  });
}

test("reveal runs the trajectories along, pauses, resumes, and an edit cancels", async ({
  page,
}) => {
  await ready(page, vanDerPol);
  await openAnimation(page);
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("2");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect.poll(() => progress(page)).toBeGreaterThan(0.1);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const paused = await progress(page);
  expect(paused).toBeLessThan(1);
  const sample = await lastArrow(page);
  expect(sample).toBeLessThanOrEqual(paused * 5999);
  expect(sample).toBeGreaterThan(paused * 5999 - 5999 / 39 - 1);
  // Both trajectories have run for the same time.
  const lengths = (await trajectories(page)).map((p) => p.length);
  expect(Math.abs(lengths[0] - lengths[1])).toBeLessThanOrEqual(2);
  await expect(directions(page)).toHaveCount(420);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  expect(await lastArrow(page)).toBe(5999);
  await page.getByRole("button", { name: "Replay", exact: true }).click();
  await expect.poll(() => progress(page)).toBeGreaterThan(0);
  await input(page, "Seed x₂").fill("-3");
  await settled(page);
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-progress",
  );
  expect((await definition(page)).curve.field.seeds[1].x).toBe(-3);
});

for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`field layout in ${theme} at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme });
      await ready(page, pendulum);
      await expect(input(page, "Seed y₇")).toBeVisible();
      await expect(note(page)).toBeVisible();
      // A seed's two fields share one row, even on a phone.
      const [x, y] = await Promise.all(
        ["Seed x₁", "Seed y₁"].map(
          async (name) => (await input(page, name).boundingBox())!,
        ),
      );
      expect(Math.abs(x.y - y.y)).toBeLessThan(1);
      expect(x.x).toBeLessThan(y.x);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: testInfo.outputPath(`field-${theme}-${width}.png`),
        fullPage: true,
      });
    });
  }
}
