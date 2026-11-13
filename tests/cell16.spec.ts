import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { chooseColorScheme, exportImage, openShapeExport } from "./helpers";
import { decodeVideo, frameDifference, probe } from "./video";
import { writeStudyLink } from "../web/study-link";
import { presetStudy } from "../web/tesseract/link";
import { tesseractPresets } from "../web/tesseract/presets";
import { motions, sample } from "../web/tesseract/types";
import { colorSchemes } from "../web/color-schemes";
import { pair16MarkerBound, pair16PathBound } from "../web/tesseract/polytope";
import {
  artwork,
  counts,
  markerAt,
  meta,
  open,
  pathPoints,
  raster,
  screenOf,
  selected,
  settle,
  show,
  stage,
} from "./cell24-helpers";

// The tesseract and its polar 16-cell (docs/tesseracts.md): one selected
// cube, its four diagonals crossing at its center (a 16-cell vertex), the
// six cubes beside it, both whole polytopes, perspective and sections.

const cube = "Eight cubes, eight centers";
const hero = "Cube within a cube, and its dual";
const passage = "A tesseract meeting its dual";
const cubeField = (p: Page) =>
  p.getByRole("spinbutton", { name: "Selected cube", exact: true });
const viewMenu = (p: Page) =>
  p.getByRole("combobox", {
    name: "View of the tesseract and 16-cell",
    exact: true,
  });
const zeroAngles = async (p: Page) => {
  for (const axis of ["xy", "xz", "yz", "xw", "yw", "zw"])
    await p
      .getByRole("textbox", { name: `${axis} angle`, exact: true })
      .fill("0");
};
const link = async (p: Page, study: unknown) => {
  await p.goto("about:blank");
  await p.goto(`/?study=4d#s=${await writeStudyLink("4d", study)}`);
  await settle(p);
};

test("one cube, its four diagonals, its center and six neighbors draw, with no text in the artwork", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page, cube);
  expect(await counts(page)).toEqual({
    cell: 12,
    diagonal: 4,
    spoke: 6,
    vertex: 6,
    center: 1,
  });
  await expect(artwork(page).locator("text, foreignObject")).toHaveCount(0);
  const m = await meta(page);
  expect(m.config.object).toBe("cell16");
  expect(m.framingRadius).toBe(2);
  expect(m.polytope).toMatchObject({
    view: "cell",
    selectedCell: 0,
    center: [1, 0, 0, 0],
    primal: { circumradius: 2, edgeLength: 2 },
    dual: { circumradius: 1, edgeLength: Math.SQRT2 },
  });
  expect(m.polytope.cellVertices).toHaveLength(8);
  // Every neighbor is orthogonal to the center: never its opposite −e_x.
  expect(m.polytope.neighbors).not.toContain(7);
  const [cx, cy] = await markerAt(page, "cell16/dual/vertex/0");
  for (const d of await pathPoints(page, 'path[data-role="diagonal"]')) {
    expect(Math.abs((d[0] + d[2]) / 2 - cx)).toBeLessThan(0.002);
    expect(Math.abs((d[1] + d[3]) / 2 - cy)).toBeLessThan(0.002);
  }
  for (const d of await pathPoints(page, 'path[data-role="spoke"]')) {
    expect(Math.abs(d[0] - cx)).toBeLessThan(0.002);
    expect(Math.abs(d[1] - cy)).toBeLessThan(0.002);
  }
  const neighbors = await artwork(page)
    .locator('g[data-role="vertex"]')
    .evaluateAll((gs) => gs.map((g) => g.getAttribute("data-marker")));
  expect(neighbors.sort()).toEqual(
    m.polytope.neighbors.map((k: number) => `cell16/dual/vertex/${k}`).sort(),
  );
  await expect(page.locator(".lift-readout")).toContainText("1 of 8");
  await expect(page.locator(".lift-readout")).toContainText("Cube edges in 4D");
  await expect(page.locator(".tesseract-diagnostics")).toHaveText(
    "Cube 1 of 8 and its center, a vertex of the 16-cell.",
  );
  await expect(page.locator(".tesseract-legend")).toContainText(
    "The cube's center, a 16-cell vertex",
  );
});

test("both whole polytopes draw every edge once, within the fixed bound", async ({
  page,
}) => {
  await open(page, cube);
  await show(page).selectOption("crystal");
  await settle(page);
  expect(await counts(page)).toEqual({
    primal: 20,
    dual: 18,
    spoke: 6,
    cell: 12,
    diagonal: 4,
    vertex: 7,
    center: 1,
  });
  const sources = await artwork(page)
    .locator("path[data-source]")
    .evaluateAll((es) =>
      es
        .filter((e) => e.getAttribute("data-role") !== "diagonal")
        .map((e) => e.getAttribute("data-source")!),
    );
  expect(new Set(sources).size).toBe(sources.length);
  expect(
    sources.filter((s) => s.startsWith("cell16/primal/edge/")),
  ).toHaveLength(32);
  expect(sources.filter((s) => s.startsWith("cell16/dual/edge/"))).toHaveLength(
    24,
  );
  expect(
    await artwork(page).locator("path[data-source]").count(),
  ).toBeLessThanOrEqual(pair16PathBound);
  expect(
    await artwork(page).locator("g[data-marker]").count(),
  ).toBeLessThanOrEqual(pair16MarkerBound);
});

test("the field, [ and ], and tapping a center select a cube; coincident centers take turns", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page, cube);
  await cubeField(page).fill("8");
  await settle(page);
  expect(await selected(page)).toBe(7);
  for (const value of ["9", "0"]) {
    await cubeField(page).fill(value);
    await settle(page);
    expect(await selected(page)).toBe(7);
  }
  await artwork(page).focus();
  await page.keyboard.press("]");
  await settle(page);
  await expect(cubeField(page)).toHaveValue("1");
  await page.keyboard.press("[");
  await page.keyboard.press("[");
  await settle(page);
  await expect(cubeField(page)).toHaveValue("7");
  const neighbor = (await meta(page)).polytope.neighbors[2];
  const at = await screenOf(page, `cell16/dual/vertex/${neighbor}`);
  await page.mouse.click(at.x + 2, at.y - 2);
  await settle(page);
  expect(await selected(page)).toBe(neighbor);
  // Unrotated, +e_w and −e_w (16-cell vertices 3 and 4) share the
  // origin's shadow; repeated taps step through both.
  await zeroAngles(page);
  await show(page).selectOption("crystal");
  await cubeField(page).fill("1");
  await settle(page);
  expect(await markerAt(page, "cell16/dual/vertex/3")).toEqual(
    await markerAt(page, "cell16/dual/vertex/4"),
  );
  const origin = await screenOf(page, "cell16/dual/vertex/3");
  for (const expected of [3, 4, 3]) {
    await page.mouse.click(origin.x, origin.y);
    await settle(page);
    expect(await selected(page)).toBe(expected);
  }
  await expect(page.locator(".lift-readout")).toContainText("Center w: 1");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a tap selects on a phone, and nothing widens the page", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await open(page, cube);
  await artwork(page).evaluate((e) =>
    e.scrollIntoView({ block: "center", behavior: "instant" }),
  );
  const neighbor = (await meta(page)).polytope.neighbors[0];
  const at = await screenOf(page, `cell16/dual/vertex/${neighbor}`);
  await page.touchscreen.tap(at.x, at.y);
  await settle(page);
  expect(await selected(page)).toBe(neighbor);
  const fits = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    screen: document.documentElement.clientWidth,
    readouts: [...document.querySelectorAll(".lift-readout b")]
      .filter((b) => b.scrollWidth > b.clientWidth + 0.5)
      .map((b) => b.textContent),
  }));
  expect(fits.page).toBeLessThanOrEqual(fits.screen);
  expect(fits.readouts).toEqual([]);
  await context.close();
});

test("switching objects keeps each object's work; invalid entries stay under their field", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  await settle(page);
  const object = page.getByRole("combobox", { name: "4D object" });
  await object.selectOption("cell24");
  await settle(page);
  await page
    .getByRole("spinbutton", { name: "Selected cell", exact: true })
    .fill("9");
  await settle(page);
  await object.selectOption("cell16");
  await settle(page);
  let m = await meta(page);
  expect(m.config.cell16).toEqual({ selected: 0, view: "cell" });
  expect(m.config.cell24).toBeUndefined();
  await cubeField(page).fill("5");
  await show(page).selectOption("crystal");
  const xw = page.getByRole("textbox", { name: "xw angle", exact: true });
  await xw.fill("pi/");
  await expect(
    page.locator(".field").filter({ has: xw }).getByRole("alert"),
  ).toBeVisible();
  await xw.fill("pi/5");
  await settle(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await object.selectOption("cell24");
  await settle(page);
  expect((await meta(page)).config.cell24.selected).toBe(8);
  await object.selectOption("cell16");
  await settle(page);
  m = await meta(page);
  expect(m.config.cell16).toEqual({ selected: 4, view: "crystal" });
  expect(m.config.angles[3]).toBeCloseTo(Math.PI / 5, 15);
  // A fractional selection from a link is refused by name.
  const study = presetStudy(tesseractPresets.findIndex((p) => p.name === cube));
  await link(page, {
    ...study,
    config: { ...study.config, cell16: { selected: 2.5, view: "cell" } },
  });
  await expect(
    page
      .locator(".field")
      .filter({ has: cubeField(page) })
      .getByRole("alert"),
  ).toContainText("Selected cube must be a whole number from 1 to 8.");
});

test("perspective frames by distance alone, its diagonals meet at the center, and the distance is reconciled", async ({
  page,
}) => {
  await open(page, hero);
  let m = await meta(page);
  const framing = (d: number) => (2 * d) / Math.sqrt(d * d - 4);
  expect(m.config).toMatchObject({ mode: "perspective", distance: 2.5 });
  expect(m.framingRadius).toBeCloseTo(framing(2.5), 12);
  expect(m.polytope.projection).toContain("d = 2.5");
  // Lines stay lines: each diagonal passes through the drawn center.
  const [cx, cy] = await markerAt(
    page,
    `cell16/dual/vertex/${m.polytope.selectedCell}`,
  );
  for (const [x0, y0, x1, y1] of await pathPoints(
    page,
    'path[data-role="diagonal"]',
  )) {
    const cross = (x1 - x0) * (cy - y0) - (y1 - y0) * (cx - x0);
    expect(Math.abs(cross) / Math.hypot(x1 - x0, y1 - y0)).toBeLessThan(0.01);
  }
  const distance = page.getByRole("textbox", {
    name: "4D eye distance",
    exact: true,
  });
  await distance.fill("2");
  await expect(
    page.locator(".field").filter({ has: distance }).getByRole("alert"),
  ).toContainText("2.05");
  await distance.fill("2.05");
  await settle(page);
  expect((await meta(page)).framingRadius).toBeCloseTo(framing(2.05), 12);
  // An inactive distance from a link is clamped only on entering perspective.
  const study = presetStudy(tesseractPresets.findIndex((p) => p.name === cube));
  await link(page, { ...study, config: { ...study.config, distance: 99 } });
  await viewMenu(page).selectOption("perspective");
  await settle(page);
  m = await meta(page);
  expect(m.config.distance).toBe(20);
  expect(m.framingRadius).toBeCloseTo(framing(20), 12);
});

test("sections cut both polytopes in one real plane and restore edited work", async ({
  page,
}) => {
  await open(page, passage);
  let m = await meta(page);
  // Corner first through the center: an octahedron and a cuboctahedron.
  expect(
    m.sections.map((s: any) => [
      s.kind,
      s.dimension,
      s.vertices,
      s.edges,
      s.faces,
    ]),
  ).toEqual([
    ["primal", 3, 6, 12, 8],
    ["dual", 3, 12, 24, 14],
  ]);
  await expect(page.locator(".lift-readout")).toContainText("Tesseract V/E/F");
  await expect(page.locator(".lift-readout")).toContainText("16-cell V/E/F");
  await expect(
    artwork(page).locator('path[data-role="cell"]').first(),
  ).toBeVisible();
  await zeroAngles(page);
  const offset = page.getByRole("textbox", {
    name: "Slice offset h",
    exact: true,
  });
  await offset.fill("1/2");
  await settle(page);
  // Unrotated, w = ½ cuts the cube [−1, 1]³ and an octahedron of radius ½.
  m = await meta(page);
  expect(
    m.sections.map((s: any) => [s.dimension, s.vertices, s.edges, s.faces]),
  ).toEqual([
    [3, 8, 12, 6],
    [3, 6, 12, 8],
  ]);
  await offset.fill("1");
  await settle(page);
  expect((await meta(page)).sections.map((s: any) => s.dimension)).toEqual([
    3, 0,
  ]);
  await offset.fill("4.1");
  await expect(
    page.locator(".field").filter({ has: offset }).getByRole("alert"),
  ).toContainText("4.05");
  await offset.fill("0.25");
  await cubeField(page).fill("3");
  await settle(page);
  await viewMenu(page).selectOption("orthographic");
  await settle(page);
  await viewMenu(page).selectOption("section");
  await settle(page);
  expect((await meta(page)).config).toMatchObject({
    slice: 0.25,
    cell16: { selected: 2 },
  });
  await page.getByRole("checkbox", { name: "16-cell", exact: true }).uncheck();
  await expect(
    artwork(page).locator('[data-guide="true"], g[data-role="center"]'),
  ).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("the authored passage moves one plane and emphasis from absolute time without changing the source", () => {
  const preset = tesseractPresets.find((p) => p.name === passage)!;
  const c = preset.config,
    before = structuredClone(c);
  expect(preset.motion).toBe("crystal");
  expect(motions(c).find((m) => m.value === "crystal")).toMatchObject({
    label: "A tesseract meeting its dual",
    loops: true,
  });
  const frames = [0, 0.2, 0.5, 0.8, 1, 0.2].map((t) => sample(c, "crystal", t));
  expect(frames[0].slice).toBeCloseTo(-2.05, 12);
  expect(frames[4].slice).toBeCloseTo(2.05, 12);
  expect(frames[2].slice).toBe(0);
  expect(frames[2].cell16!.emphasis).toBe(1);
  expect(frames[1]).toEqual(frames[5]);
  for (const f of frames) expect(f.angles).toEqual(c.angles);
  expect(c).toEqual(before);
  // Another object's emphasis field is never touched.
  const other = sample(
    { ...c, cell24: { selected: 0, view: "cell" } },
    "crystal",
    0.5,
  );
  expect(other.cell24!.emphasis).toBeUndefined();
});

test("the passage seeks backward exactly, keeps the camera, and Stop restores the entered study", async ({
  page,
}) => {
  await open(page, passage);
  await artwork(page).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("+");
  const base = await meta(page);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const drawings: string[] = [];
  for (const t of [0, 0.3, 0.5, 1, 0.3]) {
    await page
      .getByRole("slider", { name: "Animation progress" })
      .fill(String(t));
    await expect(stage(page)).toHaveAttribute("data-time", String(t));
    await settle(page);
    const m = await meta(page);
    expect(m.view).toEqual(base.view);
    if (t === 0 || t === 1)
      expect(m.sections.every((s: any) => s.dimension === -1)).toBe(true);
    drawings.push(
      await artwork(page)
        .locator("path[data-source]")
        .evaluateAll((es) => es.map((e) => e.outerHTML).join("")),
    );
  }
  expect(drawings[1]).toBe(drawings[4]);
  expect(drawings[1]).not.toBe(drawings[2]);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await settle(page);
  expect((await meta(page)).config).toEqual(base.config);
});

test("each role keeps its own ink under every color scheme, matching the legend", async ({
  page,
}) => {
  await open(page, cube);
  await show(page).selectOption("crystal");
  await settle(page);
  const roles = ["primal", "cell", "dual", "spoke"];
  const labels = [
    "Tesseract",
    "Selected cube",
    "16-cell vertices and edges",
    "The cube's center, a 16-cell vertex",
  ];
  for (const { id } of colorSchemes) {
    if (id !== "default") {
      await chooseColorScheme(page, id);
      await settle(page);
    }
    const inks = await Promise.all(
      roles.map((r) =>
        artwork(page)
          .locator(`path[data-role="${r}"]`)
          .first()
          .getAttribute("stroke"),
      ),
    );
    expect(new Set(inks).size, id).toBe(4);
    for (const [i, label] of labels.entries()) {
      const swatch = await page
        .locator(".tesseract-legend span, .tesseract-legend li")
        .filter({ hasText: new RegExp(`^${label}$`) })
        .first()
        .locator("i")
        .evaluate((i) => getComputedStyle(i).backgroundColor);
      const ink = await page.evaluate((c) => {
        const d = document.createElement("i");
        d.style.color = c;
        document.body.append(d);
        const v = getComputedStyle(d).color;
        d.remove();
        return v;
      }, inks[i]!);
      expect(swatch, `${id}: ${label}`).toBe(ink);
    }
  }
});

test("a link and the still carry the selection, view, distance, layers and camera", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page, hero);
  await cubeField(page).fill("6");
  await page
    .getByRole("checkbox", { name: "Tesseract", exact: true })
    .uncheck();
  await artwork(page).focus();
  await page.keyboard.press("ArrowRight");
  await settle(page);
  const live = await meta(page);
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const svg = await readFile((await (await download).path())!, "utf8");
  expect(svg).not.toMatch(/<text|<foreignObject/);
  const exported = JSON.parse(
    svg.match(/<desc>([^<]*)<\/desc>/)![1].replace(/&quot;/g, '"'),
  );
  expect(exported.config).toEqual(live.config);
  expect(exported.view).toEqual(live.view);
  expect(exported.polytope).toEqual(live.polytope);
  expect(exported.polytope.ids).toContain("cell16/dual/vertex/k");
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  await page.goto("about:blank");
  await page.goto(url.replace(/^https?:\/\/[^/]+/, ""));
  await settle(page);
  await expect(cubeField(page)).toHaveValue("6");
  const reopened = await meta(page);
  expect(reopened.config).toEqual(live.config);
  expect(reopened.view).toEqual(live.view);
  expect(reopened.layers).toEqual(live.layers);
  // A link without the pair's own field opens cube 1, one cube.
  const study = presetStudy(tesseractPresets.findIndex((p) => p.name === cube));
  const { cell16: _, ...bare } = study.config;
  await link(page, { ...study, config: bare });
  expect((await meta(page)).config.cell16).toEqual({
    selected: 0,
    view: "cell",
  });
});

test("the perspective rotation passes its loop check and exports a decoded movie matching the live drawing", async ({
  page,
}) => {
  test.slow();
  await open(page, hero);
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("1");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.locator(".animation-error, [role=alert]")).toHaveCount(0);
  const references: number[][] = [];
  const radii: number[] = [];
  for (const s of [0, 0.4]) {
    await page
      .getByRole("slider", { name: "Animation progress" })
      .fill(String(s));
    await settle(page);
    radii.push((await meta(page)).framingRadius);
    references.push(await raster(page, 1000, 760));
  }
  // No breathing: the framing depends on d alone.
  expect(radii[0]).toBe(radii[1]);
  await openShapeExport(page);
  await page
    .getByRole("combobox", { name: "Export format" })
    .selectOption("mp4");
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("1");
  await page
    .getByRole("combobox", { name: "Export frame rate" })
    .selectOption("15");
  await page
    .getByRole("slider", { name: "Export quality", exact: true })
    .fill("100");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Export MP4 video/ }).click();
  const path = (await (await download).path())!;
  const p = probe(path);
  if (p) {
    expect([p.width, p.height, p.frames]).toEqual([1000, 760, 15]);
    expect(p.durations.reduce((a, b) => a + b, 0)).toBe(1000);
  }
  expect((await decodeVideo(page, await readFile(path))).duration).toBeCloseTo(
    1,
    3,
  );
  for (const [k, index] of [0, 6].entries()) {
    const d = frameDifference(path, 1000, 760, index, references[k]);
    if (d) {
      expect(d.meanDifference).toBeLessThan(6);
      expect(d.unmatchedInk).toBeLessThan(0.02);
    }
  }
});
