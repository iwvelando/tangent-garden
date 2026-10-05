import { reveal } from "../web/spatial/animation";
import { buildScene } from "../web/spatial/scene";
import type { RefinedPath, SpatialResult, Vec3 } from "../web/spatial/types";
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { choosePreset } from "./helpers";

const at = (x: number): Vec3 => ({ x, y: x * x, z: 0 });
// Line pairs in a batch: seven floats a vertex, two vertices a segment.
const segments = (data: Float32Array) => data.length / 14;
// The segments' x coordinates, in order.
const xs = (data: Float32Array) =>
  Array.from({ length: data.length / 7 }, (_, k) => data[7 * k]);

function refined(points: (number | null)[], positions: number[]): RefinedPath {
  return {
    points: points.map((x) => (x === null ? null : at(x))),
    at: positions,
    tolerance: 1e-3,
    inserted: positions.filter((u) => u !== Math.trunc(u)).length,
    breaks: 0,
    unresolved: 0,
    exhausted: false,
  };
}

// Four uniform samples at x = 0, 1, 2, 3, the interval 2–3 broken; the
// refinement inserts two points in 0–1 and one in 1–2, and keeps the break.
function study(): SpatialResult {
  const base = [0, 1, 2, 3].map(at);
  return {
    base,
    minus: [],
    plus: [],
    breaks: [false, false, false, true],
    mesh: [],
    rulings: [],
    bounds: { center: { x: 1.5, y: 4.5, z: 0 }, radius: 5 },
    radius: 5,
    omitted: 0,
    invalid: 0,
    adaptive: {
      base: refined(
        [0, 0.25, 0.5, 1, 1.5, 2, null, 3],
        [0, 0.25, 0.5, 1, 1.5, 2, 2.5, 3],
      ),
    },
  };
}

test("the drawing joins a refined curve's points in order, and never across its breaks", () => {
  const scene = buildScene(study());
  expect(segments(scene.base.data)).toBe(5);
  expect(xs(scene.base.data)).toEqual([
    0, 0.25, 0.25, 0.5, 0.5, 1, 1, 1.5, 1.5, 2,
  ]);
  // Without refinement the uniform samples are drawn, as before.
  const uniform = { ...study(), adaptive: undefined };
  expect(xs(buildScene(uniform).base.data)).toEqual([0, 1, 1, 2]);
});

test("each refined curve is drawn in place of its uniform samples", () => {
  const input = study();
  const twoPoints = [at(0), at(1)];
  input.projection = {
    pole: at(9),
    points: twoPoints,
    feet: twoPoints,
    constructions: [],
    collapsed: false,
    invalid: 0,
  };
  input.inversion = {
    center: at(9),
    radius: 1,
    input: "base",
    source: twoPoints,
    points: twoPoints,
    breaks: [false, false],
    correspondences: [],
    collapsed: false,
    invalid: 0,
    crossings: 0,
  };
  input.composition = {
    input: "tangent-foot",
    pole: at(9),
    curve: twoPoints,
    breaks: [false, false],
    constructions: [],
    cusps: 0,
    unreached: 0,
  };
  // Each curve its own refinement, so none can be drawn from another's.
  const refinedAt = (x: number) => refined([0, x, 1], [0, x, 1]);
  input.adaptive = {
    ...input.adaptive,
    projection: refinedAt(0.5),
    image: refinedAt(0.25),
    parent: refinedAt(0.75),
  };
  const scene = buildScene(input);
  expect(xs(scene.projection.data)).toEqual([0, 0.5, 0.5, 1]);
  expect(xs(scene.inverse.data)).toEqual([0, 0.25, 0.25, 1]);
  expect(xs(scene.parent.data)).toEqual([0, 0.75, 0.75, 1]);
});

test("reveal shows the refined points up to the revealed sample, and frames the study as before", () => {
  const input = study();
  const uniform = { ...study(), adaptive: undefined };
  for (const [p, shown] of [
    [0, [0]],
    [1 / 3, [0, 0.25, 0.5, 1]],
    [2 / 3, [0, 0.25, 0.5, 1, 1.5, 2]],
    [1, [0, 0.25, 0.5, 1, 1.5, 2, 2.5, 3]],
  ] as const) {
    const frame = reveal(input, p);
    expect(frame.adaptive?.base?.at).toEqual(shown);
    expect(frame.adaptive?.base?.points).toHaveLength(shown.length);
    expect(frame.bounds).toEqual(reveal(uniform, p).bounds);
  }
  expect(reveal(input, 1).adaptive).toEqual(input.adaptive);
});

const stage = (page: Page) => page.locator(".spatial-stage");
const settled = (page: Page) =>
  expect(stage(page)).toHaveAttribute("aria-busy", "false");
async function ready(page: Page) {
  await page.goto("/?study=3d");
  await expect(page.locator("#spatial-artwork")).toBeVisible();
  await settled(page);
}
async function config(page: Page) {
  const text = await stage(page).getAttribute("data-config");
  return text ? JSON.parse(text) : undefined;
}
const pixels = (page: Page) =>
  page
    .locator("#spatial-artwork")
    .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
const refine = (page: Page) =>
  page.getByRole("checkbox", { name: "Refine between samples", exact: true });
const readout = (page: Page) => page.locator(".refinement-readout");
async function openSampling(page: Page) {
  const section = page.locator("details", {
    has: page.locator(":scope > summary", { hasText: "Sampling & definition" }),
  });
  if ((await section.getAttribute("open")) === null)
    await section.locator(":scope > summary").click();
}

test("refining between samples is offered for curves given by formulas, and changes only the drawn curve", async ({
  page,
}) => {
  await ready(page);
  await openSampling(page);
  await page.getByLabel("Curve samples", { exact: true }).fill("240");
  await settled(page);
  await expect(refine(page)).not.toBeChecked();
  await expect(readout(page)).toHaveCount(0);
  const uniform = await pixels(page);
  await refine(page).check();
  await settled(page);
  expect((await config(page)).adaptive).toBe(true);
  await expect(readout(page)).toHaveText(
    /^[\d,]+ points added between samples\.$/,
  );
  expect(await pixels(page)).not.toBe(uniform);
  // The status line still names the even samples, not the points added.
  await expect(page.getByRole("status")).toHaveText(
    "240 samples · 96 tangents",
  );
  await refine(page).uncheck();
  await settled(page);
  expect(await pixels(page)).toBe(uniform);
  // Integrated paths, surfaces and level sets have nothing to refine.
  for (const format of ["field", "pursuit", "surface", "rays", "implicit"]) {
    await page
      .getByLabel("Spatial definition", { exact: true })
      .selectOption(format);
    await settled(page);
    await openSampling(page);
    await expect(refine(page)).toHaveCount(0);
  }
});

test("the coil's preset is refined, and its even samples alias the coil away", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, { label: "A coil hidden between samples" });
  await settled(page);
  await openSampling(page);
  await expect(refine(page)).toBeChecked();
  const added = Number(
    (await readout(page).textContent())!
      .match(/^([\d,]+) points/)![1]
      .replace(/,/g, ""),
  );
  // 233 turns of the coil need thousands of points; the budget is 16,384.
  expect(added).toBeGreaterThan(233 * 10);
  expect(added).toBeLessThan(16384);
  await expect(readout(page)).not.toContainText("coarser");
  const refined = await pixels(page);
  await refine(page).uncheck();
  await settled(page);
  expect(await pixels(page)).not.toBe(refined);
  // A coil of 997 turns needs more points than the budget allows, and the
  // readout says what is left.
  await refine(page).check();
  await page
    .getByRole("textbox", { name: "Frequency ω₄", exact: true })
    .fill("997");
  await settled(page);
  await expect(readout(page)).toHaveText(
    /^16,384 points added between samples\. [\d,]+ pieces stay coarser than the tolerance: the budget of 16,384 points ran out\.$/,
  );
});

// The SVG line drawing projects the drawing's own lines, so it carries the
// points refinement added.
async function lines(page: Page) {
  await page.getByRole("button", { name: "Export image", exact: true }).click();
  const event = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Lines (SVG) · every line", exact: true })
    .click();
  const svg = (await readFile((await (await event).path())!)).toString();
  return [...svg.matchAll(/[ML]-?[\d.]+ -?[\d.]+/g)].length;
}

test("the rose's inverted loops are exported with their refined points", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, { label: "A rose that misses the center" });
  await settled(page);
  await openSampling(page);
  await expect(refine(page)).toBeChecked();
  const added = Number(
    (await readout(page).textContent())!
      .match(/^([\d,]+) points/)![1]
      .replace(/,/g, ""),
  );
  // Zoomed out until the largest loop is on the page, where nothing clips.
  await page.locator("#spatial-artwork").focus();
  for (let k = 0; k < 6; k++) await page.keyboard.press("-");
  const refined = await lines(page);
  await refine(page).uncheck();
  await settled(page);
  const uniform = await lines(page);
  // Each added point lies inside a joined run, adding one segment.
  expect(refined - uniform).toBeGreaterThanOrEqual(added);
});

test("each involute is drawn from its own refinement, and revealed with it", () => {
  const input = study();
  const twoPoints = [at(0), at(1)];
  input.breaks = [false, false];
  input.involute = {
    members: [0, 1].map((offset) => ({
      offset,
      points: twoPoints,
      collapsed: false,
    })),
    strings: [],
    unreached: 0,
  };
  input.adaptive = {
    involute: [
      refined([0, 0.5, 1], [0, 0.5, 1]),
      refined([0, 0.25, 0.75, 1], [0, 0.25, 0.75, 1]),
    ],
  };
  const scene = buildScene(input);
  expect(xs(scene.filaments.data)).toEqual([
    0, 0.5, 0.5, 1, 0, 0.25, 0.25, 0.75, 0.75, 1,
  ]);
  // Without refinement each member joins its uniform samples, as before.
  expect(
    xs(buildScene({ ...input, adaptive: undefined }).filaments.data),
  ).toEqual([0, 1, 0, 1]);
  const frame = reveal(input, 0);
  expect(frame.adaptive?.involute?.map((path) => path.at)).toEqual([[0], [0]]);
  expect(reveal(input, 1).adaptive).toEqual(input.adaptive);
});

async function openAnimation(page: Page) {
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
}
const hat = "Strings swung round a three-cornered hat",
  crown = "A string swept across a four-cornered crown";

test("the three-cornered hat's involutes open refined and are exported with their refined points", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, { label: hat });
  await settled(page);
  await openSampling(page);
  await expect(refine(page)).toBeChecked();
  await expect(readout(page)).not.toContainText("coarser");
  const added = Number(
    (await readout(page).textContent())!
      .match(/^([\d,]+) points/)![1]
      .replace(/,/g, ""),
  );
  // The base and each of the four involutes swing round three corners.
  expect(added).toBeGreaterThan(5 * 3 * 10);
  const refined = await lines(page);
  await refine(page).uncheck();
  await settled(page);
  const uniform = await lines(page);
  expect(refined - uniform).toBeGreaterThanOrEqual(added);
  await refine(page).check();
  await settled(page);
  expect(await lines(page)).toBe(refined);
});

test("the four-cornered crown's string stays refined to the end of its track", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, { label: crown });
  await settled(page);
  await openSampling(page);
  await expect(refine(page)).toBeChecked();
  const opening = await readout(page).textContent();
  expect(opening).toMatch(/^[\d,]+ points added between samples\.$/);
  await openAnimation(page);
  await expect(page.getByLabel("Animate", { exact: true })).toHaveValue(
    "parameters",
  );
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  // Back and forth: halfway through its time it reaches the track's end,
  // the longest string.
  await page.getByRole("slider", { name: "Animation progress" }).fill("0.5");
  await expect(stage(page)).toHaveAttribute("data-time", "0.5");
  await expect(stage(page)).toHaveAttribute("data-progress", "1");
  await expect(readout(page)).toHaveText(
    /^[\d,]+ points added between samples\.$/,
  );
  await expect(readout(page)).not.toHaveText(opening!);
});
