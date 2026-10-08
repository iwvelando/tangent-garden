import {
  applyTracks,
  availableTargets,
  reveal,
  targetLabel,
} from "../web/spatial/animation";
import { spatialPresets } from "../web/spatial/presets";
import { implicitGrid, implicitNote } from "../web/spatial/implicit";
import { implicitMesh } from "../web/spatial/renderer";
import type { ImplicitResult, SpatialResult } from "../web/spatial/types";
import { test, expect, type Page } from "@playwright/test";
import { choosePreset } from "./helpers";
import { engines, watchEngines, type EngineLog } from "./engines";
import { readFile } from "node:fs/promises";
import { probe, decodeVideo } from "./video";
import { curveMesh } from "./curve-mesh";
const stage = (page: Page) => page.locator(".spatial-stage");
const field = (page: Page, name: string) =>
  page.getByRole("textbox", { name, exact: true });
async function ready(page: Page) {
  await page.goto("/?study=3d");
  await expect(page.locator("#spatial-artwork")).toBeVisible();
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
}
async function settled(page: Page) {
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
}
async function config(page: Page) {
  const text = await stage(page).getAttribute("data-config");
  return text ? JSON.parse(text) : undefined;
}
const pixels = (page: Page) =>
  page
    .locator("#spatial-artwork")
    .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
async function openAnimation(page: Page) {
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
}
async function openSampling(page: Page) {
  const details = page.locator("summary", { hasText: "Sampling & definition" });
  if ((await details.locator("..").getAttribute("open")) === null)
    await details.click();
}
const latitudes = "43",
  spiric = "44",
  villarceau = "45",
  drops = "46",
  double = "47",
  tangle = "48",
  gyroid = "49",
  thread = "50";
const note = (page: Page) => page.getByTestId("implicit-note");
const layer = (page: Page, name: string) =>
  page.getByRole("checkbox", { name, exact: true });

test("an implicit study has its own controls, layers and validated fields", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, drops);
  await settled(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "A level surface and its sections",
  );
  await expect(page.getByLabel("Spatial definition")).toHaveValue("implicit");
  await expect(page.getByLabel("Construction", { exact: true })).toHaveCount(0);
  await expect(page.locator(".legend")).toContainText(
    "Level surface Section curves",
  );
  await expect(field(page, "F(x, y, z)")).toHaveValue(
    "((x - a)^2 + y^2 + z^2) * ((x + a)^2 + y^2 + z^2)",
  );
  await expect(field(page, "Level c")).toHaveValue("0.9");
  await expect(field(page, "Shape parameter a")).toHaveValue("1");
  await expect(field(page, "x from")).toHaveValue("-1.6");
  await expect(field(page, "z to")).toHaveValue("0.8");
  await expect(
    page.getByRole("spinbutton", { name: "Section planes", exact: true }),
  ).toHaveValue("3");
  await expect(field(page, "Normal z")).toHaveValue("1");
  await expect(page.locator(".spatial-status")).toHaveText(
    "64 × 32 × 32 cells · 3 section planes",
  );
  const original = await pixels(page);
  for (const name of [
    "Level surface",
    "Section curves",
    "Section planes",
    "Box, cuts & open edges",
  ]) {
    await layer(page, name).uncheck();
    expect(await pixels(page), name).not.toBe(original);
    await layer(page, name).check();
    expect(await pixels(page), name).toBe(original);
  }
  for (const [name, text, message] of [
    ["F(x, y, z)", "x + t", "cannot use t"],
    ["F(x, y, z)", "x^2 +", "F(x, y, z)"],
    ["Level c", "x", "x is not allowed"],
    ["x to", "-2", "the box needs"],
    ["y from", "-2e5", "within ±100000"],
    ["Normal x", "0", ""],
  ] as const) {
    const before = await field(page, name).inputValue();
    await field(page, name).fill(text);
    if (message) await expect(page.getByRole("alert")).toContainText(message);
    await field(page, name).fill(before);
    await settled(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  // A zero normal is refused only while there are sections.
  for (const axis of ["x", "y", "z"])
    await field(page, `Normal ${axis}`).fill("0");
  await expect(page.getByRole("alert")).toContainText("section normal");
  const planes = page.getByRole("spinbutton", {
    name: "Section planes",
    exact: true,
  });
  await planes.fill("0");
  await settled(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(field(page, "Normal x")).toHaveCount(0);
  await expect(field(page, "First offset d₀")).toHaveCount(0);
  expect((await config(page)).implicit.sections.count).toBe(0);
  await expect(note(page)).not.toContainText("section");
  await planes.fill("25");
  await expect(page.getByRole("alert")).toContainText("0–24 section planes");
  await planes.fill("2");
  for (const axis of ["x", "y", "z"])
    await field(page, `Normal ${axis}`).fill(axis === "y" ? "1" : "0");
  await settled(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  // Cells, in whole numbers and within the cap.
  await openSampling(page);
  const cells = page.getByLabel("Cells", { exact: true });
  await cells.fill("3");
  await expect(page.getByRole("alert")).toContainText("4–128 cells");
  await cells.fill("128");
  await expect(page.getByRole("alert")).toContainText("262,144 cells");
  await cells.fill("24.5");
  await expect(page.getByRole("alert")).toContainText(
    "Cell and plane counts must be whole numbers.",
  );
  await cells.fill("24");
  await settled(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".spatial-status")).toHaveText(
    "24 × 12 × 12 cells · 2 section planes",
  );
  expect((await config(page)).implicit).toMatchObject({
    cells: 24,
    sections: { normal: { x: 0, y: 1, z: 0 }, count: 2 },
  });
  await expect(note(page)).toContainText("from a 24 × 12 × 12 grid");
});

test("notes report each surface's pieces, genus and sections", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, latitudes);
  await settled(page);
  await expect(note(page)).toHaveText(
    "The mesh is one piece, closed, of genus 0 (Euler characteristic 2). It has 38,496 triangles on 19,250 vertices, from a 48 × 48 × 48 grid. The seven sections hold 7 closed curves.",
  );
  await choosePreset(page, spiric);
  await settled(page);
  await expect(note(page)).toContainText(
    "closed, of genus 1 (Euler characteristic 0)",
  );
  await expect(note(page)).toContainText(
    "The six sections hold 9 closed curves.",
  );
  await choosePreset(page, villarceau);
  await settled(page);
  await expect(note(page)).toContainText("The section holds 2 closed curves.");
  // The drops join as c passes a⁴ = 1.
  await choosePreset(page, drops);
  await settled(page);
  await expect(note(page)).toContainText(
    "The mesh has two pieces, each closed, of genus 0 (Euler characteristic 2).",
  );
  await field(page, "Level c").fill("1.2");
  await settled(page);
  await expect(note(page)).toContainText(
    "The mesh is one piece, closed, of genus 0",
  );
  await choosePreset(page, double);
  await settled(page);
  await expect(note(page)).toContainText(
    "The mesh is one piece, closed, of genus 2 (Euler characteristic −2).",
  );
  await expect(note(page)).toContainText("The section holds 3 closed curves.");
  // The tanglecube's cage falls apart into eight drops below −12.5.
  await choosePreset(page, tangle);
  await settled(page);
  await expect(note(page)).toContainText(
    "closed, of genus 5 (Euler characteristic −8)",
  );
  await field(page, "Level c").fill("-14");
  await settled(page);
  await expect(note(page)).toContainText(
    "The mesh has eight pieces, each closed, of genus 0",
  );
  await choosePreset(page, gyroid);
  await settled(page);
  await expect(note(page)).toContainText("The mesh is one piece, open");
  await expect(note(page)).toContainText("The box cuts it open along");
  await expect(note(page)).toContainText(
    "open curves; an open curve ends at the box or beside cells left out.",
  );
});

test("refinement joins a neck the grid misses, within its levels", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, thread);
  await settled(page);
  const status = page.locator(".spatial-status");
  await expect(status).toHaveText(
    "20 × 13 × 13 cells · 3 section planes · up to 3 refinement levels",
  );
  await expect(note(page)).toContainText(
    "The mesh is one piece, closed, of genus 0",
  );
  await expect(note(page)).toContainText(
    "Refinement bisected 582 tetrahedra, reaching 2 of 3 levels, where an edge's midpoint lay across the level from both its ends.",
  );
  await openSampling(page);
  const refinement = page.getByLabel("Refinement levels", { exact: true });
  await expect(refinement).toHaveValue("3");
  const refined = await pixels(page);
  // The grid alone misses the waist, which the section at x = 0 finds.
  await refinement.fill("0");
  await settled(page);
  await expect(note(page)).toContainText(
    "The mesh has two pieces, each closed, of genus 0",
  );
  await expect(note(page)).not.toContainText("Refinement");
  await expect(status).toHaveText("20 × 13 × 13 cells · 3 section planes");
  expect((await config(page)).implicit.refine).toBe(0);
  expect(await pixels(page)).not.toBe(refined);
  for (const [text, message] of [
    ["4", "0–3 refinement levels"],
    ["-1", "0–3 refinement levels"],
    ["1.5", "Refinement levels must be a whole number."],
    ["", "Refinement levels must be a whole number."],
  ] as const) {
    await refinement.fill(text);
    await expect(page.getByRole("alert")).toContainText(message);
  }
  await refinement.fill("1");
  await settled(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(note(page)).toContainText(
    "Refinement bisected 402 tetrahedra, reaching 1 of 1 level, where an edge's midpoint lay across the level from both its ends.",
  );
  await expect(note(page)).toContainText(
    "16 tetrahedra at the deepest level still disagree with a sample: the surface there is finer than refinement reaches.",
  );
  // Other edits keep the levels.
  await page.getByLabel("Cells", { exact: true }).fill("16");
  await settled(page);
  expect((await config(page)).implicit).toMatchObject({ cells: 16, refine: 1 });
  await expect(status).toHaveText(
    "16 × 11 × 11 cells · 3 section planes · up to 1 refinement level",
  );
  // A preset brings its own levels.
  await choosePreset(page, drops);
  await settled(page);
  expect((await config(page)).implicit.refine).toBe(0);
  await expect(note(page)).not.toContainText("Refinement");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("poles, undefined regions and ambiguous faces are reported, never meshed", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, latitudes);
  await settled(page);
  const f = field(page, "F(x, y, z)");
  await f.fill("1/(x - 0.0501)");
  await field(page, "Level c").fill("0");
  await settled(page);
  await expect(note(page)).toContainText("No surface: F − c keeps one sign");
  await expect(note(page)).toContainText(
    "9,409 grid edges change sign across a pole or a jump rather than a root: the first 4,096 are marked with crosses and never meshed.",
  );
  const marked = await pixels(page);
  await layer(page, "Box, cuts & open edges").uncheck();
  expect(await pixels(page)).not.toBe(marked);
  await layer(page, "Box, cuts & open edges").check();
  await expect(
    page.locator(".spatial-stage .bottom-note", {
      hasText:
        "never joined across a pole, a jump, or a point where F is undefined",
    }),
  ).toBeVisible();
  await f.fill("z - sqrt(x)");
  await settled(page);
  await expect(note(page)).toContainText(
    // Columns x < 0, 24 of the 49, each of 49 × 49 points.
    "F is not finite at 57,624 grid points: the cells beside them are left out, and the mesh stops there.",
  );
  // With the grid shifted off x = 0 and y = 0, the crossing planes of
  // xy = 0 pass through cells whose corners alternate.
  await f.fill("x*y");
  await field(page, "Level c").fill("0");
  await field(page, "x from").fill("-1.2");
  await field(page, "y from").fill("-1.2");
  await settled(page);
  await expect(note(page)).toContainText(
    "grid faces have corners alternating in sign",
  );
  // A double cone whose apex lies inside a cell is meshed as two nappes;
  // on a grid point, they meet at a vertex with no normal.
  await f.fill("x^2 + y^2 - z^2");
  await settled(page);
  await expect(note(page)).toContainText("The mesh has two pieces");
  await field(page, "x from").fill("-1.3");
  await field(page, "y from").fill("-1.3");
  await settled(page);
  await expect(note(page)).toContainText("The mesh is one piece");
  await expect(note(page)).toContainText("1 vertex has no normal");
});

test("reveal rises through the box, with the parts of the sections below", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, tangle);
  await settled(page);
  const full = await pixels(page);
  await openAnimation(page);
  await expect(page.getByLabel("Animate", { exact: true })).toContainText(
    "Rise through the box",
  );
  await page.getByLabel("Animate", { exact: true }).selectOption("reveal");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Animation progress" });
  await slider.fill("0");
  await expect(stage(page)).toHaveAttribute("data-progress", "0");
  const empty = await pixels(page);
  await slider.fill("0.5");
  await expect(stage(page)).toHaveAttribute("data-progress", "0.5");
  await expect(page.locator(".animation-values")).toHaveText("z = 0.00000");
  const half = await pixels(page);
  expect(half).not.toBe(empty);
  expect(half).not.toBe(full);
  await slider.fill("1");
  await expect(stage(page)).toHaveAttribute("data-progress", "1");
  expect(await pixels(page)).toBe(full);
  await slider.fill("0.5");
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await field(page, "Level c").fill("-12");
  await expect(stage(page)).not.toHaveAttribute("data-progress");
  await expect
    .poll(async () => (await config(page))?.implicit?.level)
    .toBe(-12);
});

for (const camera of ["hold", "current", "follow", "fit"])
  test(`level playback reaches exact endpoints with the ${camera} camera`, async ({
    page,
  }) => {
    await ready(page);
    await choosePreset(page, drops);
    await settled(page);
    const base = await config(page);
    await openAnimation(page);
    await page
      .getByLabel("Animate", { exact: true })
      .selectOption("parameters");
    await page.getByLabel("Parameter 1", { exact: true }).selectOption("level");
    await page.getByLabel("Track 1 from").fill("0.9");
    await page.getByLabel("Track 1 to").fill("1+pi/20");
    await page
      .getByLabel("Animation camera", { exact: true })
      .selectOption(camera);
    await page.getByLabel("Duration (seconds)").fill("5");
    await page.locator("#spatial-artwork").focus();
    await page.keyboard.press("+");
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const slider = page.getByRole("slider", { name: "Animation progress" });
    const framing = async () =>
      JSON.parse((await stage(page).getAttribute("data-camera"))!);
    await slider.fill("0");
    await expect(stage(page)).toHaveAttribute("data-progress", "0");
    expect((await config(page)).implicit.level).toBe(0.9);
    const first = await framing();
    await slider.fill("1");
    await expect(stage(page)).toHaveAttribute("data-progress", "1");
    expect((await config(page)).implicit.level).toBe(1 + Math.PI / 20);
    const last = await framing();
    if (camera === "hold" || camera === "current") expect(last).toEqual(first);
    // The box frames the study, so a fitted camera keeps its radius too.
    if (camera === "follow" || camera === "fit")
      expect(last.radius).toBe(first.radius);
    expect(first.zoom).toBe(camera === "current" ? 1.1 : 1);
    await slider.fill("0.5");
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(stage(page)).not.toHaveAttribute("data-progress");
    expect(await config(page)).toEqual(base);
  });

// Each engine's spatial requests.
const spatial = (e: EngineLog) => e.sent.spatial ?? 0;
async function levelTrack(page: Page, seconds: string) {
  await openAnimation(page);
  await page.getByLabel("Animate", { exact: true }).selectOption("parameters");
  await page.getByLabel("Parameter 1", { exact: true }).selectOption("level");
  await page.getByLabel("Track 1 from").fill("0.8");
  await page.getByLabel("Track 1 to").fill("1.3");
  await page.getByLabel("Duration (seconds)").fill(seconds);
}
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });

test("parameter playback shares frames with a second engine for its duration", async ({
  page,
}) => {
  await watchEngines(page, 8);
  await ready(page);
  await choosePreset(page, drops);
  await settled(page);
  const before = (await engines(page)).length;
  await levelTrack(page, "4");
  await button(page, "Play animation").click();
  await expect(stage(page)).toHaveAttribute("data-progress", "1", {
    timeout: 20000,
  });
  expect((await config(page)).implicit.level).toBe(1.3);
  let all = await engines(page);
  // One helper, released once playback completes; both engines calculated.
  expect(all).toHaveLength(before + 1);
  const helper = all.at(-1)!,
    app = all.filter((e) => spatial(e) && e !== helper);
  expect(helper.terminated).toBe(true);
  expect(spatial(helper)).toBeGreaterThan(1);
  // The helper prepares the end while the app's engine prepares the start.
  expect(helper.first.spatial.spatial.implicit.level).toBe(1.3);
  expect(app.some((e) => spatial(e) > 1 && !e.terminated)).toBe(true);

  // Pause and Stop release the helper; Resume starts a fresh one.
  await button(page, "Replay").click();
  await expect(button(page, "Pause")).toBeVisible();
  await expect.poll(async () => (await engines(page)).length).toBe(before + 2);
  await button(page, "Pause").click();
  all = await engines(page);
  expect(all.at(-1)!.terminated).toBe(true);
  // Scrubbing calculates on the app's engine alone.
  const scrubbed = all.map(spatial);
  const slider = page.getByRole("slider", { name: "Animation progress" });
  for (const p of ["0.3", "0.6", "0.45"]) await slider.fill(p);
  await expect(stage(page)).toHaveAttribute("data-progress", "0.45");
  all = await engines(page);
  expect(all).toHaveLength(before + 2);
  const grew = all.flatMap((e, i) => (spatial(e) > scrubbed[i] ? [i] : []));
  expect(grew).toHaveLength(1);
  expect(all[grew[0]].terminated).toBe(false);
  await button(page, "Resume").click();
  await expect.poll(async () => (await engines(page)).length).toBe(before + 3);
  await button(page, "Stop").click();
  await expect(stage(page)).not.toHaveAttribute("data-progress");
  all = await engines(page);
  expect(all.at(-1)!.terminated).toBe(true);
  expect(all.filter((e) => !e.terminated).length).toBe(
    all.slice(0, before).filter((e) => !e.terminated).length,
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("two cores, and playback without calculation, keep a single engine", async ({
  page,
}) => {
  await watchEngines(page, 2);
  await ready(page);
  await choosePreset(page, drops);
  await settled(page);
  const before = (await engines(page)).length;
  await levelTrack(page, "0.5");
  await button(page, "Play animation").click();
  await expect(stage(page)).toHaveAttribute("data-progress", "1");
  expect((await config(page)).implicit.level).toBe(1.3);
  await button(page, "Back to study").click();
  // Rising through the box reuses the drawn mesh.
  await page.getByLabel("Animate", { exact: true }).selectOption("reveal");
  await button(page, "Play animation").click();
  await expect(stage(page)).toHaveAttribute("data-progress", "1");
  expect(await engines(page)).toHaveLength(before);
});

test("a level-set MP4 decodes with exact duration and a changing surface", async ({
  page,
}) => {
  test.slow();
  await ready(page);
  await choosePreset(page, drops);
  await settled(page);
  await openAnimation(page);
  await page.getByLabel("Animate", { exact: true }).selectOption("parameters");
  await page.getByLabel("Parameter 1", { exact: true }).selectOption("level");
  await page.getByLabel("Track 1 from").fill("0.8");
  await page.getByLabel("Track 1 to").fill("1.3");
  await page
    .getByLabel("Animation camera", { exact: true })
    .selectOption("hold");
  await page.getByLabel("Duration (seconds)").fill("0.4");
  await page.locator("#spatial-export-settings > summary").click();
  await page.getByLabel("Export format", { exact: true }).selectOption("mp4");
  await page.getByLabel("Export frame rate").selectOption("15");
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("1");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export MP4/ }).click();
  const file = await download,
    path = (await file.path())!;
  const data = probe(path);
  if (data) {
    expect(data.frames).toBe(6);
    expect(data.durations.reduce((a, b) => a + b, 0)).toBe(400);
  }
  const video = await decodeVideo(page, await readFile(path));
  expect(video.duration).toBeCloseTo(0.4, 3);
  expect(video.first.hash).not.toBe(video.last.hash);
});

// A unit square in z = 0 and a slanted triangle rising to z = 1, with one
// section of a closed and an open path.
function study(): SpatialResult {
  const origin = { x: 0, y: 0, z: 0 };
  const implicit: ImplicitResult = {
    box: { xMin: 0, xMax: 1, yMin: 0, yMax: 1, zMin: 0, zMax: 1 },
    grid: [4, 4, 4],
    positions: new Float64Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1]),
    normals: new Float64Array(15),
    triangles: new Int32Array([0, 1, 2, 0, 2, 3, 0, 1, 4]),
    cut: new Int32Array([0, 1, 1, 4]),
    open: new Int32Array([2, 3]),
    components: [{ triangles: 3, euler: 1, closed: false }],
    sections: [
      {
        offset: 0.5,
        polygon: [origin, origin, origin],
        skipped: false,
        paths: [
          {
            closed: true,
            points: [0, 0.2, 0.4, 0.8, 0.6, 0.1].map((z) => ({
              x: z,
              y: 0,
              z,
            })),
          },
          {
            closed: false,
            points: [0.9, 0.1].map((z) => ({ x: z, y: 1, z })),
          },
        ],
      },
    ],
    marks: [origin, { x: 0, y: 0, z: 0.9 }],
    nonfinite: 0,
    discontinuities: 2,
    ambiguous: 0,
    singular: 0,
    sectionDiscontinuities: 0,
    sectionsSkipped: 0,
    truncated: false,
    refinement: {
      levels: 0,
      reached: 0,
      bisected: 0,
      unresolved: 0,
      exhausted: false,
    },
  };
  return {
    base: [],
    minus: [],
    plus: [],
    mesh: curveMesh(),
    rulings: [],
    breaks: [],
    bounds: { center: origin, radius: 1 },
    radius: 1,
    invalid: 0,
    omitted: 0,
    implicit,
  };
}

test("reveal keeps what lies below its height and splits sections there", () => {
  const input = study();
  expect(reveal(input, 1).implicit).toBe(input.implicit);
  const half = reveal(input, 0.5).implicit!;
  expect(half.triangles).toEqual(new Int32Array([0, 1, 2, 0, 2, 3]));
  expect(half.cut).toEqual(new Int32Array([0, 1]));
  expect(half.open).toEqual(new Int32Array([2, 3]));
  expect(half.marks).toEqual([{ x: 0, y: 0, z: 0 }]);
  // The closed path, cut above 0.5, becomes one open run from 0.1 around
  // to 0.4; the open path keeps only one point, which is not a curve.
  expect(half.sections[0].paths).toEqual([
    {
      closed: false,
      points: [0.1, 0, 0.2, 0.4].map((z) => ({ x: z, y: 0, z })),
    },
  ]);
  expect(reveal(input, 0.5).bounds).toBe(input.bounds);
  // Nothing lies below the floor but the floor.
  expect(reveal(input, 0).implicit!.triangles).toEqual(
    new Int32Array([0, 1, 2, 0, 2, 3]),
  );
});

// The GPU mesh keeps the engine's shared vertices. A corner without a
// normal (∇F vanished) is drawn with its triangle's own normal, so only such
// corners are copied; a triangle without area is left out.
test("an implicit mesh is drawn from shared vertices", () => {
  const m = study().implicit!;
  // Vertices 0–3 carry the normal +z, 4 (raised to z = 2) has none, and 5
  // lies on the line through 0 and 1, so the triangle 0, 1, 5 has no area.
  // The box runs from z = −1 to 3, so the phase is (z + 1)/4.
  m.box = { ...m.box, zMin: -1, zMax: 3 };
  m.positions = new Float64Array([...m.positions, 2, 0, 0]);
  m.positions[14] = 2;
  m.normals = new Float64Array(18);
  for (const v of [0, 1, 2, 3, 5]) m.normals[3 * v + 2] = 1;
  m.triangles = new Int32Array([0, 1, 2, 0, 2, 3, 0, 1, 4, 0, 1, 5]);
  const { vertices, indices } = implicitMesh(m);
  expect(indices).toBeInstanceOf(Uint32Array);
  // Six shared vertices and one copy of vertex 4 with the normal of 0, 1, 4.
  expect(vertices.length).toBe(7 * 7);
  expect(Array.from(indices)).toEqual([0, 1, 2, 0, 2, 3, 0, 1, 6]);
  const corner = (i: number) => Array.from(vertices.slice(7 * i, 7 * i + 7));
  for (const v of [0, 1, 2, 3, 5]) {
    const [x, y, z] = m.positions.slice(3 * v, 3 * v + 3);
    // Position, normal, and the height in the box as phase.
    expect(corner(v)).toEqual([x, y, z, 0, 0, 1, (z + 1) / 4]);
  }
  // The unit normal of 0, 1, 4, whose cross product has length 2.
  expect(corner(6)).toEqual([0, 0, 2, 0, -1, 0, 0.75]);
});

test("implicit tracks move the level, a, sections and cells", () => {
  const surface = structuredClone(spatialPresets[+drops].config);
  expect(availableTargets(surface)).toEqual([
    "level",
    "implicitA",
    "sectionFrom",
    "sectionTo",
    "cells",
    "sectionCount",
  ]);
  expect(targetLabel(surface, "level")).toBe("Level c");
  expect(targetLabel(surface, "implicitA")).toBe("Shape parameter a");
  expect(targetLabel(surface, "sectionFrom")).toBe("First offset d₀");
  expect(targetLabel(surface, "sectionTo")).toBe("Last offset d₁");
  expect(targetLabel(surface, "cells")).toBe("Cells");
  expect(targetLabel(surface, "sectionCount")).toBe("Section planes");
  const { config } = applyTracks(
    surface,
    [
      { target: "level", from: 0.9, to: 1.3 },
      { target: "implicitA", from: 1, to: 0.5 },
      { target: "sectionFrom", from: 0, to: -0.4 },
      { target: "sectionTo", from: 0.4, to: 0.8 },
      { target: "cells", from: 16, to: 33 },
      { target: "sectionCount", from: 1, to: 4 },
    ],
    0.5,
  );
  expect(config.implicit).toMatchObject({
    level: 1.1,
    a: 0.75,
    cells: 25,
    sections: { from: -0.2, to: 0.6000000000000001, count: 3 },
  });
  // The base is never changed.
  expect(surface).toEqual(spatialPresets[+drops].config);
  surface.implicit.sections.count = 0;
  expect(availableTargets(surface)).toEqual([
    "level",
    "implicitA",
    "cells",
    "sectionCount",
  ]);
});

test("the grid and the note follow Go's shapes and wording", () => {
  const box = {
    xMin: -1.6,
    xMax: 1.6,
    yMin: -0.8,
    yMax: 0.8,
    zMin: -0.8,
    zMax: 0.8,
  };
  expect(implicitGrid(box, 64)).toEqual([64, 32, 32]);
  expect(implicitGrid({ ...box, zMin: -0.001, zMax: 0.001 }, 64)).toEqual([
    64, 32, 1,
  ]);
  const r = study().implicit!;
  expect(implicitNote(r)).toEqual([
    "The mesh is one piece, open, with Euler characteristic 1.",
    "It has 3 triangles on 5 vertices, from a 4 × 4 × 4 grid.",
    "The box cuts it open along 2 edges.",
    "The mesh stops beside cells left out, along 1 edge.",
    "2 grid edges change sign across a pole or a jump rather than a root: they are marked with crosses and never meshed.",
    "The section holds 1 closed curve and 1 open one; an open curve ends at the box or beside cells left out.",
  ]);
  const mixed = {
    ...r,
    components: [
      { triangles: 1, euler: 2, closed: true },
      { triangles: 1, euler: -2, closed: true },
      { triangles: 1, euler: 2, closed: true },
    ],
    sections: [],
  };
  expect(implicitNote(mixed)[0]).toBe(
    "The mesh has three pieces: two closed, of genus 0 (Euler characteristic 2); one closed, of genus 2 (Euler characteristic −2).",
  );
  // Refinement, when asked for, and how it ended.
  const levels = (refinement: ImplicitResult["refinement"], more = {}) =>
    implicitNote({ ...r, ...more, sections: [], refinement });
  expect(levels({ ...r.refinement, levels: 2 })).toContain(
    "Refinement up to 2 levels split nothing: no edge's midpoint lay across the level from both its ends.",
  );
  expect(
    levels(
      {
        levels: 3,
        reached: 1,
        bisected: 12,
        unresolved: 30,
        exhausted: true,
      },
      { nonfinite: 7, ambiguous: 2 },
    ),
  ).toEqual([
    "The mesh is one piece, open, with Euler characteristic 1.",
    "It has 3 triangles on 5 vertices, from a 4 × 4 × 4 grid.",
    "Refinement bisected 12 tetrahedra, reaching 1 of 3 levels, where an edge's midpoint lay across the level from both its ends.",
    "Refinement stopped at its budget of 100,000 tetrahedra with 30 still disagreeing with a sample: use fewer cells or a smaller box.",
    "The box cuts it open along 2 edges.",
    "F is not finite at 7 points sampled: the cells beside them are left out, and the mesh stops there.",
    "2 grid edges change sign across a pole or a jump rather than a root: they are marked with crosses and never meshed.",
    "2 grid faces have corners alternating in sign; refinement samples each face's centre, and splits the face where the grid's diagonal disagrees with it.",
  ]);
});
