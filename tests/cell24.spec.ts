import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import {
  chooseColorScheme,
  choosePreset,
  exportImage,
  openShapeExport,
} from "./helpers";
import { decodeVideo, frameDifference, pixelDifference, probe } from "./video";
import { writeStudyLink } from "../web/study-link";
import { presetStudy } from "../web/tesseract/link";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Drawing } from "../web/tesseract/Drawing";
import { defaultConfig } from "../web/tesseract/objects";
import { initialView, sample, motions } from "../web/tesseract/types";
import { tesseractPresets } from "../web/tesseract/presets";
import { colorSchemes } from "../web/color-schemes";
import {
  polytopeMarkerBound,
  polytopePathBound,
} from "../web/tesseract/polytope";
import {
  artwork,
  counts,
  crystal,
  markerAt,
  meta,
  open,
  pathPoints,
  raster,
  screenOf,
  selected,
  selectedField,
  settle,
  show,
  signature,
  stage,
} from "./cell24-helpers";

// The 24-cell and its polar dual (docs/tesseracts.md): one selected
// octahedral cell, its center (a dual vertex), and both whole crystals.
// The perspective shadow has its own spec, cell24-perspective.spec.ts.

test("one cell, its diagonals and its center draw, with no text in the artwork", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  expect(await counts(page)).toEqual({
    cell: 12,
    diagonal: 3,
    spoke: 8,
    vertex: 8,
    center: 1,
  });
  await expect(artwork(page).locator("text, foreignObject")).toHaveCount(0);
  const m = await meta(page);
  expect(m.polytope).toMatchObject({
    view: "cell",
    selectedCell: 0,
    center: [1, 0, 0, 0],
    primal: { circumradius: Math.SQRT2, edgeLength: Math.SQRT2 },
    dual: { circumradius: 1, edgeLength: 1 },
  });
  expect(m.polytope.cellVertices).toHaveLength(6);
  expect(m.polytope.neighbors).toHaveLength(8);
  // The center is the midpoint of each diagonal's shadow.
  const [cx, cy] = await markerAt(page, "cell24/dual/vertex/0");
  for (const d of await pathPoints(page, 'path[data-role="diagonal"]')) {
    expect(Math.abs((d[0] + d[2]) / 2 - cx)).toBeLessThan(0.002);
    expect(Math.abs((d[1] + d[3]) / 2 - cy)).toBeLessThan(0.002);
  }
  // Each dual edge starts at the center and ends at a drawn neighbor.
  const neighbors = await artwork(page)
    .locator('g[data-role="vertex"]')
    .evaluateAll((gs) => gs.map((g) => g.getAttribute("data-marker")));
  expect(neighbors.sort()).toEqual(
    m.polytope.neighbors.map((k: number) => `cell24/dual/vertex/${k}`).sort(),
  );
  for (const d of await pathPoints(page, 'path[data-role="spoke"]')) {
    expect(Math.abs(d[0] - cx)).toBeLessThan(0.002);
    expect(Math.abs(d[1] - cy)).toBeLessThan(0.002);
  }
  await expect(page.locator(".lift-readout")).toContainText("1 of 24");
  for (const [axis, value] of ["1", "0", "0", "0"].entries())
    await expect(
      page.locator(".lift-readout > span").filter({
        hasText: `Center ${"xyzw"[axis]}:`,
      }),
    ).toHaveText(`Center ${"xyzw"[axis]}: ${value}`);
  await expect(page.locator(".tesseract-diagnostics")).toHaveText(
    "Cell 1 of 24 and its center, a vertex of the dual.",
  );
  await expect(page.locator(".tesseract-legend")).toContainText(
    "Selected octahedral cell",
  );
});

test("the whole crystal draws every edge of both once, within the fixed bound", async ({
  page,
}) => {
  await open(page, crystal);
  const c = await counts(page);
  expect(c).toEqual({
    primal: 84,
    dual: 88,
    spoke: 8,
    cell: 12,
    diagonal: 3,
    vertex: 23,
    center: 1,
  });
  const sources = await artwork(page)
    .locator("path[data-source]")
    .evaluateAll((es) =>
      es
        .filter((e) => e.getAttribute("data-role") !== "diagonal")
        .map((e) => e.getAttribute("data-source")!),
    );
  // 96 distinct edges of each, none drawn twice.
  expect(new Set(sources).size).toBe(sources.length);
  expect(
    sources.filter((s) => s.startsWith("cell24/primal/edge/")),
  ).toHaveLength(96);
  expect(sources.filter((s) => s.startsWith("cell24/dual/edge/"))).toHaveLength(
    96,
  );
  expect(
    await artwork(page).locator("path[data-source]").count(),
  ).toBeLessThanOrEqual(polytopePathBound);
  expect(
    await artwork(page).locator("g[data-marker]").count(),
  ).toBeLessThanOrEqual(polytopeMarkerBound);
  // Switching back to one cell keeps the selection and draws only it.
  await show(page).selectOption("cell");
  await settle(page);
  expect((await counts(page)).primal).toBeUndefined();
  expect(await selected(page)).toBe(0);
});

test("the field, [ and ], and tapping a center select a cell; coincident centers take turns", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  await selectedField(page).fill("24");
  await settle(page);
  expect(await selected(page)).toBe(23);
  // Out of range edits are ignored.
  for (const value of ["25", "0"]) {
    await selectedField(page).fill(value);
    await settle(page);
    expect(await selected(page)).toBe(23);
  }
  await artwork(page).focus();
  await page.keyboard.press("]");
  await settle(page);
  await expect(selectedField(page)).toHaveValue("1");
  await page.keyboard.press("[");
  await page.keyboard.press("[");
  await settle(page);
  await expect(selectedField(page)).toHaveValue("23");
  // Tap a neighboring center: its cell becomes the selection, and its
  // neighbors include the cell just left.
  const neighbor = (await meta(page)).polytope.neighbors[3];
  const at = await screenOf(page, `cell24/dual/vertex/${neighbor}`);
  await page.mouse.click(at.x + 3, at.y - 2);
  await settle(page);
  expect(await selected(page)).toBe(neighbor);
  expect((await meta(page)).polytope.neighbors).toContain(22);
  // A drag orbits and keeps it.
  const yaw = (await meta(page)).view.yaw;
  const box = (await artwork(page).boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 90, { steps: 5 });
  await page.mouse.up();
  await settle(page);
  expect((await meta(page)).view.yaw).not.toBe(yaw);
  expect(await selected(page)).toBe(neighbor);
  // Empty space selects nothing.
  await page.mouse.click(box.x + 8, box.y + 8);
  await settle(page);
  expect(await selected(page)).toBe(neighbor);
  // Unrotated, ±e_w (dual vertices 11 and 12) share the origin's shadow.
  for (const axis of ["xy", "xz", "yz", "xw", "yw", "zw"])
    await page
      .getByRole("textbox", { name: `${axis} angle`, exact: true })
      .fill("0");
  await show(page).selectOption("crystal");
  await selectedField(page).fill("1");
  await settle(page);
  expect(await markerAt(page, "cell24/dual/vertex/11")).toEqual(
    await markerAt(page, "cell24/dual/vertex/12"),
  );
  const origin = await screenOf(page, "cell24/dual/vertex/11");
  for (const expected of [11, 12, 11]) {
    await page.mouse.click(origin.x, origin.y);
    await settle(page);
    expect(await selected(page)).toBe(expected);
  }
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
  await open(page);
  await artwork(page).evaluate((e) =>
    e.scrollIntoView({ block: "center", behavior: "instant" }),
  );
  const neighbor = (await meta(page)).polytope.neighbors[0];
  const at = await screenOf(page, `cell24/dual/vertex/${neighbor}`);
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

test("every cell center fits the readout columns with different font metrics", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await open(page);
  // A fixed-width fallback exposes the tuple exceeding the 10ch value
  // column on macOS too; Linux's default sans-serif exposed it in CI.
  await page.evaluate(() => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(".lift-readout { font-family: monospace }");
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  });
  for (const width of [390, 844, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    for (let k = 0; k < 24; k++) {
      await selectedField(page).fill(String(k + 1));
      await expect.poll(() => selected(page)).toBe(k);
      const overflow = await page
        .locator(".lift-readout b")
        .evaluateAll((bs) =>
          bs
            .filter((b) => b.scrollWidth > b.clientWidth + 0.5)
            .map((b) => b.textContent),
        );
      expect(overflow, `${width}px, cell ${k + 1}`).toEqual([]);
    }
  }
});

test("angle expressions rotate both crystals; the latest edit wins and errors stay under their field", async ({
  page,
}) => {
  await open(page);
  const xw = page.getByRole("textbox", { name: "xw angle", exact: true });
  // Quick edits: only the last reaches the drawing.
  await xw.fill("pi/3");
  await selectedField(page).fill("5");
  await xw.fill("-pi/4");
  await settle(page);
  const m = await meta(page);
  expect(m.config.angles[3]).toBeCloseTo(-Math.PI / 4, 15);
  expect(m.config.cell24.selected).toBe(4);
  expect(m.polytope.selectedCell).toBe(4);
  // An unfinished expression keeps the last valid drawing.
  await xw.fill("pi/");
  await expect(
    page.locator(".field").filter({ has: xw }).getByRole("alert"),
  ).toBeVisible();
  await expect(stage(page).locator(".stale-study")).toBeVisible();
  await xw.fill("0.25");
  await settle(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect((await meta(page)).config.angles[3]).toBe(0.25);
});

test("switching objects keeps each object's work and opens valid defaults", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  await settle(page);
  const object = page.getByRole("combobox", { name: "4D object" });
  const xy = page.getByRole("textbox", { name: "xy angle", exact: true });
  await xy.fill("0.4");
  await settle(page);
  await object.selectOption("cell24");
  await settle(page);
  // The 24-cell opens with its own defaults, not the tesseract's angles.
  let m = await meta(page);
  expect(m.config.object).toBe("cell24");
  expect(m.config.cell24).toEqual({ selected: 0, view: "cell" });
  expect(m.config.angles[0]).toBe(0.3);
  await selectedField(page).fill("7");
  await show(page).selectOption("crystal");
  await settle(page);
  await object.selectOption("tesseract");
  await settle(page);
  expect((await meta(page)).config.angles[0]).toBe(0.4);
  await object.selectOption("cell24");
  await settle(page);
  m = await meta(page);
  expect(m.config.cell24).toEqual({ selected: 6, view: "crystal" });
  // From an edited Hopf pair, too.
  await choosePreset(page, { label: "A circle over every point" });
  await settle(page);
  await page
    .getByRole("spinbutton", { name: "Selected fiber", exact: true })
    .fill("3");
  await settle(page);
  await object.selectOption("cell24");
  await settle(page);
  expect((await meta(page)).config.object).toBe("cell24");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await object.selectOption("weave");
  await settle(page);
  await expect(
    page.getByRole("spinbutton", { name: "Selected fiber", exact: true }),
  ).toHaveValue("3");
});

test("layers hide the 24-cell or its dual, and the legend names only what is drawn", async ({
  page,
}) => {
  await open(page, crystal);
  const legend = page.locator(".tesseract-legend");
  await page.getByRole("checkbox", { name: "Dual 24-cell" }).uncheck();
  await settle(page);
  let c = await counts(page);
  expect([c.dual, c.spoke, c.vertex, c.center]).toEqual([
    undefined,
    undefined,
    undefined,
    undefined,
  ]);
  expect(c.primal).toBe(84);
  await expect(legend.getByText("Dual vertices and edges")).toBeHidden();
  await page.getByRole("checkbox", { name: "Dual 24-cell" }).check();
  await page.getByRole("checkbox", { name: "24-cell", exact: true }).uncheck();
  await settle(page);
  c = await counts(page);
  expect([c.primal, c.cell, c.diagonal]).toEqual([
    undefined,
    undefined,
    undefined,
  ]);
  expect(c.center).toBe(1);
  await expect(legend.getByText("Selected octahedral cell")).toBeHidden();
  await expect(legend.getByText("Dual vertices and edges")).toBeVisible();
});

test("each role keeps its own ink under every color scheme, matching the legend", async ({
  page,
}) => {
  await open(page, crystal);
  const roles = ["primal", "cell", "dual", "spoke"];
  const labels = [
    "24-cell",
    "Selected octahedral cell",
    "Dual vertices and edges",
    "The cell's center, a dual vertex",
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
    const normalize = (c: string) =>
      page.evaluate((c) => {
        const d = document.createElement("i");
        d.style.color = c;
        document.body.append(d);
        const v = getComputedStyle(d).color;
        d.remove();
        return v;
      }, c);
    for (const [i, label] of labels.entries()) {
      const swatch = await page
        .locator(".tesseract-legend span, .tesseract-legend li")
        .filter({ hasText: label })
        .first()
        .locator("i")
        .evaluate((i) => getComputedStyle(i).backgroundColor);
      expect(swatch, `${id}: ${label}`).toBe(await normalize(inks[i]!));
    }
  }
});

test("a link and the still carry the selection, view, layers and camera", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page, crystal);
  await selectedField(page).fill("17");
  await page.getByRole("checkbox", { name: "24-cell", exact: true }).uncheck();
  await artwork(page).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("+");
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
  expect(exported.layers.edges).toBe(false);
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  await page.goto("about:blank");
  await page.goto(url.replace(/^https?:\/\/[^/]+/, ""));
  await settle(page);
  await expect(selectedField(page)).toHaveValue("17");
  await expect(show(page)).toHaveValue("crystal");
  const reopened = await meta(page);
  expect(reopened.config).toEqual(live.config);
  expect(reopened.view).toEqual(live.view);
  expect(reopened.layers).toEqual(live.layers);
});

for (const preset of [signature, crystal])
  test(`the looping rotation of ${preset} passes its loop check and exports with its duration and frames`, async ({
    page,
  }) => {
    test.slow();
    await open(page, preset);
    await page
      .getByRole("spinbutton", { name: "Duration (seconds)" })
      .fill("1");
    // Play checks the whole frame at both ends of the loop.
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(page.locator(".animation-error, [role=alert]")).toHaveCount(0);
    const references: number[][] = [];
    for (const s of [0, 0.4]) {
      await page
        .getByRole("slider", { name: "Animation progress" })
        .fill(String(s));
      await settle(page);
      references.push(await raster(page, 1000, 760));
    }
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
    // The whole crystal's faint hairlines soften below the ink threshold
    // at the default quality; at 100 frames compare with the live drawing.
    await page
      .getByRole("slider", { name: "Export quality", exact: true })
      .fill("100");
    const download = page.waitForEvent("download");
    const started = Date.now();
    await page.getByRole("button", { name: /^Export MP4 video/ }).click();
    const path = (await (await download).path())!;
    console.log(
      `${preset}: 1s / 15fps / 1000×760 MP4 saved in ${Date.now() - started} ms`,
    );
    const p = probe(path);
    // A loop leaves out its last frame, which is its first.
    if (p) {
      expect([p.width, p.height, p.frames]).toEqual([1000, 760, 15]);
      expect(p.durations.reduce((a, b) => a + b, 0)).toBe(1000);
    }
    expect(
      (await decodeVideo(page, await readFile(path))).duration,
    ).toBeCloseTo(1, 3);
    for (const [k, index] of [0, 6].entries()) {
      const d = frameDifference(path, 1000, 760, index, references[k]);
      if (d) {
        expect(d.meanDifference).toBeLessThan(6);
        expect(d.unmatchedInk).toBeLessThan(0.02);
      }
    }
  });

// The densest presentation, the whole crystal: control-to-drawing time for
// a selection edit, with a generous bound. A measurement, not a benchmark.
test("a selection edit in the whole crystal redraws promptly", async ({
  page,
}) => {
  await open(page, crystal);
  const times: number[] = [];
  for (const n of ["9", "10", "11", "12", "13"]) {
    const start = Date.now();
    await selectedField(page).fill(n);
    await expect
      .poll(async () => (await meta(page)).polytope.selectedCell)
      .toBe(Number(n) - 1);
    times.push(Date.now() - start);
  }
  console.log(`24-cell crystal control-to-drawing: ${times.join(", ")} ms`);
  expect(Math.max(...times)).toBeLessThan(10000);
});

test("24-cell sections use one real plane, retain selected provenance and restore edited work", async ({
  page,
}) => {
  await open(page, crystal);
  const mode = page.getByRole("combobox", { name: "View of the 24-cell" });
  await expect(mode.locator('option[value="section"]')).toHaveCount(1);
  await mode.selectOption("section");
  for (const axis of ["xy", "xz", "yz", "xw", "yw", "zw"])
    await page
      .getByRole("textbox", { name: `${axis} angle`, exact: true })
      .fill("0");
  await expect
    .poll(async () => (await meta(page)).config)
    .toMatchObject({ mode: "section", angles: [0, 0, 0, 0, 0, 0] });
  await settle(page);
  let m = await meta(page);
  expect(
    m.sections.map((s: any) => [
      s.kind,
      s.dimension,
      s.vertices,
      s.edges,
      s.faces,
    ]),
  ).toEqual([
    ["primal", 3, 12, 24, 14],
    ["dual", 3, 14, 24, 12],
  ]);
  expect(
    await artwork(page).locator('path[data-role="cell"]').count(),
  ).toBeGreaterThan(0);
  expect(
    await artwork(page).locator('path[data-role="spoke"]').count(),
  ).toBeGreaterThan(0);
  await expect(artwork(page).locator("text, foreignObject")).toHaveCount(0);

  await page
    .getByRole("checkbox", { name: "Dual 24-cell", exact: true })
    .uncheck();
  await expect(
    artwork(page).locator('[data-guide="true"], g[data-role="center"]'),
  ).toHaveCount(0);
  await page
    .getByRole("checkbox", { name: "Dual 24-cell", exact: true })
    .check();
  await page.getByRole("checkbox", { name: "24-cell", exact: true }).uncheck();
  await expect(artwork(page).locator('[data-guide="false"]')).toHaveCount(0);
  await page.getByRole("checkbox", { name: "24-cell", exact: true }).check();
  await show(page).selectOption("cell");
  await settle(page);
  await expect(
    artwork(page).locator('path[data-role="primal"], path[data-role="dual"]'),
  ).toHaveCount(0);
  await show(page).selectOption("crystal");
  await settle(page);
  const offset = page.getByRole("textbox", {
    name: "Slice offset h",
    exact: true,
  });
  await offset.fill("1");
  await settle(page);
  m = await meta(page);
  expect(m.sections.map((s: any) => s.dimension)).toEqual([3, 0]);
  await offset.fill("sqrt(2)+0.01");
  await settle(page);
  expect((await meta(page)).sections.map((s: any) => s.dimension)).toEqual([
    -1, -1,
  ]);
  await expect(
    artwork(page).locator("path[data-source], g[data-marker]"),
  ).toHaveCount(0);
  await offset.fill("0.25");
  await selectedField(page).fill("9");
  await settle(page);
  await mode.selectOption("orthographic");
  await settle(page);
  await mode.selectOption("section");
  await settle(page);
  expect((await meta(page)).config.slice).toBe(0.25);
  expect(await selected(page)).toBe(8);
  const object = page.getByRole("combobox", { name: "4D object" });
  await object.selectOption("tesseract");
  await settle(page);
  await object.selectOption("cell24");
  await settle(page);
  expect((await meta(page)).config).toMatchObject({
    mode: "section",
    slice: 0.25,
    cell24: { selected: 8 },
  });
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("the authored crystal passage moves one plane and emphasis from absolute time without changing the source", () => {
  const preset = tesseractPresets.find(
    (p) => p.name === "A crystal meeting its own dual",
  );
  expect(preset).toBeDefined();
  const c = preset!.config,
    before = structuredClone(c);
  expect(c.mode).toBe("section");
  expect(c.cell24!.view).toBe("crystal");
  expect(preset!.motion).toBe("crystal");
  expect(motions(c).find((m) => m.value === "crystal")?.loops).toBe(true);
  const frames = [0, 0.2, 0.5, 0.8, 1, 0.2].map((t) => sample(c, "crystal", t));
  expect(frames[0].slice).toBeLessThan(-Math.SQRT2);
  expect(frames[4].slice).toBeGreaterThan(Math.SQRT2);
  expect(frames[2].slice).toBe(0);
  expect(frames[2].cell24!.emphasis).toBe(1);
  expect(frames[1]).toEqual(frames[5]);
  for (const f of frames) {
    expect(f.angles).toEqual(c.angles);
    expect(f.cell24!.selected).toBe(c.cell24!.selected);
  }
  expect(c).toEqual(before);
});

test("the signature opens with both selected roles, section counts and accurate selection instructions", async ({
  page,
}, info) => {
  await open(page, "A crystal meeting its own dual");
  await expect(
    artwork(page).locator('path[data-role="cell"]').first(),
  ).toBeVisible();
  await expect(
    artwork(page).locator('path[data-role="spoke"]').first(),
  ).toBeVisible();
  await expect(page.locator(".lift-readout")).toContainText("24-cell V/E/F");
  await expect(artwork(page)).not.toHaveAttribute("aria-label", /fiber/);
  await page.screenshot({ path: info.outputPath("signature-checkpoint.png") });
});

const passage = "A crystal meeting its own dual";
const seekCrystal = async (p: Page, t: number) => {
  await p.getByRole("slider", { name: "Animation progress" }).fill(String(t));
  await expect(stage(p)).toHaveAttribute("data-time", String(t));
  await settle(p);
};

test("the section passage seeks backward exactly, pauses, resumes, keeps the camera and restores edits", async ({
  page,
}) => {
  await open(page, passage);
  await artwork(page).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowUp");
  await page.keyboard.press("+");
  const base = await meta(page);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.locator(".animation-error, [role=alert]")).toHaveCount(0);
  const drawings: string[] = [];
  for (const t of [0, 0.3, 0.5, 0.8, 1, 0.3]) {
    await seekCrystal(page, t);
    const m = await meta(page);
    expect(m.view).toEqual(base.view);
    expect(m.config.angles).toEqual(base.config.angles);
    if (t === 0 || t === 1) {
      expect(m.sections.every((s: any) => s.dimension === -1)).toBe(true);
      await expect(
        artwork(page).locator(
          "path[data-source],path[data-face],g[data-marker]",
        ),
      ).toHaveCount(0);
    } else {
      expect(m.sections.some((s: any) => s.dimension === 3)).toBe(true);
      expect(
        await artwork(page).locator("path[data-source]").count(),
      ).toBeGreaterThan(0);
    }
    drawings.push(
      await artwork(page)
        .locator("path[data-source]")
        .evaluateAll((es) => es.map((e) => e.outerHTML).join("")),
    );
  }
  expect(drawings[1]).toBe(drawings[5]);
  expect(drawings[1]).not.toBe(drawings[2]);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => Number(await stage(page).getAttribute("data-time")))
    .toBeGreaterThan(0.3);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await settle(page);
  expect((await meta(page)).config).toEqual(base.config);
  await page
    .getByRole("textbox", { name: "Slice offset h", exact: true })
    .fill("0.2");
  await expect.poll(async () => (await meta(page)).config.slice).toBe(0.2);
  expect((await meta(page)).config.cell24.emphasis).toBeUndefined();
});

for (const format of ["mp4", "webp"] as const)
  test(`the crystal passage exports an ordinary ${format} with both sections, emphasis and honest empty endpoints`, async ({
    page,
  }, info) => {
    test.slow();
    await open(page, passage);
    await page
      .getByRole("spinbutton", { name: "Duration (seconds)" })
      .fill("1");
    await page
      .getByRole("combobox", { name: "Repeat", exact: true })
      .selectOption("once");
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Replay", exact: true }),
    ).toBeVisible();
    const references: number[][] = [];
    for (const t of [0, 0.5, 1]) {
      await seekCrystal(page, t);
      references.push(await raster(page, 1000, 760));
    }
    await openShapeExport(page);
    await page
      .getByRole("combobox", { name: "Export format" })
      .selectOption(format);
    await page
      .getByRole("slider", { name: "Export resolution", exact: true })
      .fill("1");
    await page
      .getByRole("combobox", { name: "Export frame rate" })
      .selectOption("15");
    await page
      .getByRole("slider", { name: "Export quality", exact: true })
      .fill("100");
    const download = page.waitForEvent("download"),
      start = Date.now();
    await page
      .getByRole("button", {
        name: format === "mp4" ? /^Export MP4 video/ : /^Export .*WebP/,
      })
      .click();
    const path = (await (await download).path())!;
    console.log(
      `crystal passage ${format}: 1s/15fps/1000×760 saved in ${Date.now() - start} ms`,
    );
    await info.attach(`crystal-passage.${format}`, {
      path,
      contentType: format === "mp4" ? "video/mp4" : "image/webp",
    });
    // ffprobe decodes the MP4; CI's ffmpeg predates animated WebP decoding,
    // so the WebP's container is read directly and Chromium's ImageDecoder,
    // independent of the encoder, decodes its frames.
    let frame: (index: number) => Promise<ArrayLike<number>>;
    if (format === "mp4") {
      const p = probe(path);
      expect(p, "independent decoder is available").not.toBeNull();
      expect([p!.width, p!.height, p!.frames]).toEqual([1000, 760, 15]);
      expect(p!.durations.reduce((a, b) => a + b, 0)).toBe(1000);
      frame = async (index) =>
        execFileSync(
          "ffmpeg",
          [
            "-v",
            "error",
            "-i",
            path,
            "-vf",
            `select=eq(n\\,${index})`,
            "-frames:v",
            "1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-",
          ],
          { maxBuffer: 1000 * 760 * 3 + 1024 },
        );
    } else {
      const bytes = await readFile(path);
      const parts: { name: string; body: Buffer }[] = [];
      for (let offset = 12; offset < bytes.length;) {
        const length = bytes.readUInt32LE(offset + 4);
        parts.push({
          name: bytes.toString("ascii", offset, offset + 4),
          body: bytes.subarray(offset + 8, offset + 8 + length),
        });
        offset += 8 + length + (length % 2);
      }
      const vp8x = parts.find((c) => c.name === "VP8X")!.body;
      expect([vp8x.readUIntLE(4, 3) + 1, vp8x.readUIntLE(7, 3) + 1]).toEqual([
        1000, 760,
      ]);
      const anmf = parts.filter((c) => c.name === "ANMF");
      expect(anmf).toHaveLength(15);
      expect(anmf.reduce((s, c) => s + c.body.readUIntLE(12, 3), 0)).toBe(1000);
      frame = (index) =>
        page.evaluate(
          async ({ input, index }) => {
            const decoder = new (window as any).ImageDecoder({
              data: new Uint8Array(input),
              type: "image/webp",
            });
            await decoder.tracks.ready;
            if (decoder.tracks.selectedTrack.frameCount !== 15)
              throw new Error("Chromium decoded a different frame count");
            const { image } = await decoder.decode({ frameIndex: index });
            const canvas = new OffscreenCanvas(1000, 760);
            canvas.getContext("2d")!.drawImage(image, 0, 0);
            image.close();
            const rgba = canvas
              .getContext("2d")!
              .getImageData(0, 0, 1000, 760).data;
            return Array.from(rgba);
          },
          { input: Array.from(bytes), index },
        );
    }
    const stride = format === "mp4" ? 3 : 4;
    for (const [k, index] of [0, 7, 14].entries()) {
      const pixels = await frame(index);
      const d = pixelDifference(pixels, stride, 1000, 760, references[k]);
      expect(d.meanDifference).toBeLessThan(6);
      if (index === 7) expect(d.unmatchedInk).toBeLessThan(0.03);
      else {
        // pixelDifference's ink match is meaningless without ink. Require
        // every pixel of an empty endpoint to be background instead.
        let ink = 0;
        for (let i = 0; i < pixels.length; i += stride)
          if (
            Math.abs(pixels[i] - pixels[0]) +
              Math.abs(pixels[i + 1] - pixels[1]) +
              Math.abs(pixels[i + 2] - pixels[2]) >
            30
          )
            ink++;
        // H.264's predictive color rounding left 30 residual pixels in
        // this empty frame. At most 0.01% of a frame may exceed 30 levels;
        // a stale middle section covers tens of thousands of pixels.
        expect(ink).toBeLessThanOrEqual(format === "mp4" ? 76 : 0);
      }
    }
  });

test("maximum section families stay bounded in the worker and drawing, and cancellation discards a movie", async ({
  page,
}) => {
  test.slow();
  await open(page, passage);
  await page
    .getByRole("textbox", { name: "Section spread", exact: true })
    .fill("0");
  await settle(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.collectGarbage");
  const before = await cdp.send("Runtime.getHeapUsage");
  const start = Date.now();
  await page
    .getByRole("spinbutton", { name: "Section count", exact: true })
    .fill("25");
  await expect.poll(async () => (await meta(page)).sections.length).toBe(50);
  await settle(page);
  const m = await meta(page),
    elapsed = Date.now() - start;
  expect(m.evaluations).toBe(48 + 2 * 25 * (96 + 24 * 12));
  expect(m.emittedPoints).toBe(64 * 25);
  expect(await artwork(page).locator("path[data-source]").count()).toBe(
    96 * 25,
  );
  await expect(artwork(page).locator("path[data-face]")).toHaveCount(0);
  await cdp.send("HeapProfiler.collectGarbage");
  const after = await cdp.send("Runtime.getHeapUsage");
  expect(after.usedSize - before.usedSize).toBeLessThan(32 * 1024 * 1024);
  expect(elapsed).toBeLessThan(10000);
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("double");
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("60");
  await openShapeExport(page);
  const downloads: string[] = [];
  page.on("download", (d) => downloads.push(d.suggestedFilename()));
  await page.getByRole("button", { name: /^Export MP4 video/ }).click();
  await expect(
    page.getByRole("button", { name: "Cancel export", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      Number(
        (
          await page
            .locator("#shape-playback .timeline [role=status]")
            .textContent()
        )?.match(/(\d+) \/ 1800/)?.[1] ?? 0,
      ),
    )
    .toBeGreaterThanOrEqual(20);
  await cdp.send("HeapProfiler.collectGarbage");
  const movieHeap = await cdp.send("Runtime.getHeapUsage");
  expect(movieHeap.usedSize - after.usedSize).toBeLessThan(64 * 1024 * 1024);
  const canceled = Date.now();
  await page
    .getByRole("button", { name: "Cancel export", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /^Export MP4 video/ }),
  ).toBeEnabled();
  const cancelMs = Date.now() - canceled;
  await cdp.send("HeapProfiler.collectGarbage");
  const canceledHeap = await cdp.send("Runtime.getHeapUsage");
  expect(canceledHeap.usedSize - after.usedSize).toBeLessThan(32 * 1024 * 1024);
  await selectedField(page).fill("5");
  await expect.poll(() => selected(page)).toBe(4);
  expect(downloads).toEqual([]);
  console.log(
    `24-cell 25-plane family: ${elapsed} ms control-to-drawing; ${((after.usedSize - before.usedSize) / 1024).toFixed(0)} KiB main-page retained heap; maximum-geometry movie after 20 frames ${((movieHeap.usedSize - after.usedSize) / 1024).toFixed(0)} KiB additional retained heap; cancellation ${cancelMs} ms, after cancellation ${((canceledHeap.usedSize - after.usedSize) / 1024).toFixed(0)} KiB`,
  );
});

test("inactive 24-cell presentation fields cannot change another study's drawing or motions", () => {
  const c = structuredClone(defaultConfig);
  c.mode = "section";
  const dormant = {
    ...c,
    cell24: { selected: 0, view: "crystal" as const, emphasis: 0.5 },
  };
  expect(motions(dormant)).toEqual(motions(c));
  const result: any = {
    object: "tesseract",
    operation: "section",
    paths: [
      {
        points: [
          [0, 0, 0],
          [1, 1, 0],
        ],
        family: 0,
        guide: false,
        source: "edge",
        branch: "0",
        role: "section",
      },
    ],
    faces: [],
    points: [],
    sections: [],
    radius: 2,
    emittedPoints: 2,
    evaluations: 0,
    clipped: 0,
  };
  const draw = (config: typeof c) =>
    renderToStaticMarkup(
      createElement(Drawing, {
        config,
        result,
        view: initialView,
        layers: { edges: true, guides: true, faces: true },
        dark: false,
      }),
    ).split("</desc>")[1];
  expect(draw(dormant)).toBe(draw(c));
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 1440, height: 650 },
])
  test(`section controls, gestures and ordinary still export remain reachable at ${viewport.width}×${viewport.height}`, async ({
    browser,
  }, info) => {
    const context = await browser.newContext({ viewport, hasTouch: true });
    const page = await context.newPage();
    await open(page, passage);
    const offset = page.getByRole("textbox", {
      name: "Slice offset h",
      exact: true,
    });
    await offset.fill("1/5");
    await expect.poll(async () => (await meta(page)).config.slice).toBe(0.2);
    const spread = page.getByRole("textbox", {
      name: "Section spread",
      exact: true,
    });
    // Both controls in one layout: two boundingBox calls can straddle a
    // reflow above the pair (the slice edit's readouts), which moves both.
    const count = page.getByRole("spinbutton", {
      name: "Section count",
      exact: true,
    });
    const pairOffset = async () =>
      spread.evaluate(
        (s, c) =>
          Math.round(
            s.getBoundingClientRect().y - c!.getBoundingClientRect().y,
          ),
        await count.elementHandle(),
      );
    const before = await pairOffset();
    await page
      .getByRole("button", { name: "About Section spread", exact: true })
      .click();
    expect(await pairOffset()).toBe(before);
    await page
      .getByRole("button", { name: "About Section spread", exact: true })
      .click();
    await selectedField(page).fill("5");
    await expect.poll(() => selected(page)).toBe(4);
    await artwork(page).focus();
    await page.keyboard.press("]");
    await expect.poll(() => selected(page)).toBe(5);
    const original = await meta(page);
    if (viewport.width <= 700) {
      const nav = page.getByRole("navigation", { name: "Notebook sections" });
      await nav.getByRole("button", { name: "Drawing", exact: true }).click();
      await nav
        .getByRole("button", { name: "Adjust view", exact: true })
        .click();
    }
    await artwork(page).evaluate((e) => e.scrollIntoView({ block: "center" }));
    const box = (await artwork(page).boundingBox())!;
    const cdp = await context.newCDPSession(page);
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x + 30, y: y + 20 }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect
      .poll(async () => (await meta(page)).view.yaw)
      .not.toBe(original.view.yaw);
    await page.getByRole("button", { name: "Front", exact: true }).click();
    const front = await meta(page);
    expect(front.view.yaw).toBe(0);
    expect(front.config).toEqual(original.config);
    const download = page.waitForEvent("download");
    await exportImage(page, "SVG");
    const path = (await (await download).path())!,
      svg = await readFile(path, "utf8");
    expect(svg).toContain('data-face="cell24/');
    expect(svg).not.toMatch(/<text|<foreignObject/);
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);

    if (viewport.width === 390) {
      await page
        .getByRole("spinbutton", { name: "Duration (seconds)" })
        .fill("0.4");
      await page
        .getByRole("combobox", { name: "Repeat", exact: true })
        .selectOption("once");
      await page
        .getByRole("button", { name: "Play animation", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Replay", exact: true }),
      ).toBeVisible();
      await openShapeExport(page);
      await page
        .getByRole("slider", { name: "Export resolution", exact: true })
        .fill("1");
      await page
        .getByRole("combobox", { name: "Export frame rate" })
        .selectOption("15");
      const movie = page.waitForEvent("download");
      await page.getByRole("button", { name: /^Export MP4 video/ }).click();
      const saved = (await (await movie).path())!,
        decoded = probe(saved);
      expect([decoded!.frames, decoded!.width, decoded!.height]).toEqual([
        6, 1000, 760,
      ]);
      expect(decoded!.durations.reduce((a, b) => a + b, 0)).toBe(400);
      await info.attach("phone-layout-passage.mp4", {
        path: saved,
        contentType: "video/mp4",
      });
      await page
        .getByRole("button", { name: "Back to study", exact: true })
        .click();
      await settle(page);
    }
    await page.emulateMedia({ colorScheme: "dark" });
    await chooseColorScheme(page, colorSchemes[1].id);
    await settle(page);
    await page.screenshot({
      path: info.outputPath("section-layout.png"),
      fullPage: true,
    });
    await context.close();
  });

test("stop and scalar edits reject a delayed section frame and rapid seeks stay coalesced", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    (window as any).holdCrystal = false;
    (window as any).heldCrystal = [];
    Worker.prototype.postMessage = function (q: any, ...rest: any[]) {
      if (
        (window as any).holdCrystal &&
        q.action === "tesseract" &&
        q.tesseract?.cell24?.emphasis !== undefined
      )
        (window as any).heldCrystal.push(() => send.call(this, q, ...rest));
      else return send.call(this, q, ...rest);
    };
    (window as any).releaseCrystal = () => {
      (window as any).holdCrystal = false;
      for (const send of (window as any).heldCrystal.splice(0)) send();
    };
  });
  await open(page, passage);
  for (const action of ["stop", "edit"]) {
    const base = await meta(page);
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.evaluate(() => ((window as any).holdCrystal = true));
    for (const t of [0.2, 0.3, 0.4, 0.6, 0.7])
      await page
        .getByRole("slider", { name: "Animation progress" })
        .fill(String(t));
    await expect
      .poll(() => page.evaluate(() => (window as any).heldCrystal.length))
      .toBe(1);
    if (action === "stop")
      await page.getByRole("button", { name: "Stop", exact: true }).click();
    else
      await page
        .getByRole("textbox", { name: "xw angle", exact: true })
        .fill("pi/4");
    await page.evaluate(() => (window as any).releaseCrystal());
    await expect
      .poll(async () => (await meta(page)).config)
      .toEqual(
        action === "stop"
          ? base.config
          : {
              ...base.config,
              angles: base.config.angles.map((v: number, i: number) =>
                i === 3 ? Math.PI / 4 : v,
              ),
            },
      );
    expect((await meta(page)).config.cell24.emphasis).toBeUndefined();
  }
});

test("a pre-section 24-cell link enters valid sections and keeps later edited section settings", async ({
  page,
}) => {
  const legacy = presetStudy(
    tesseractPresets.findIndex((p) => p.name === signature),
  );
  legacy.config.spread = 3.4; // The hidden default shipped by R12.1.
  const token = await writeStudyLink("4d", legacy);
  await page.goto(`/?study=4d#s=${token}`);
  await expect(page).not.toHaveURL(/#s=/);
  await settle(page);
  const mode = page.getByRole("combobox", { name: "View of the 24-cell" });
  await mode.selectOption("section");
  await expect.poll(async () => (await meta(page)).operation).toBe("section");
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect((await meta(page)).config.spread).toBeLessThanOrEqual(2 * Math.SQRT2);
  await page
    .getByRole("textbox", { name: "Section spread", exact: true })
    .fill("2");
  await page
    .getByRole("spinbutton", { name: "Section count", exact: true })
    .fill("7");
  await page
    .getByRole("textbox", { name: "Slice offset h", exact: true })
    .fill(".4");
  await expect
    .poll(async () => (await meta(page)).config)
    .toMatchObject({ spread: 2, count: 7, slice: 0.4 });
  const edited = (await meta(page)).config;
  await mode.selectOption("orthographic");
  await settle(page);
  await mode.selectOption("section");
  await settle(page);
  expect((await meta(page)).config).toEqual(edited);
});

test("contact roles preserve selection and whole-cell faces, with section identities in export metadata", async ({
  page,
}) => {
  await open(page, passage);
  for (const axis of ["xy", "xz", "yz", "xw", "yw", "zw"])
    await page
      .getByRole("textbox", { name: `${axis} angle`, exact: true })
      .fill("0");
  await page
    .getByRole("textbox", { name: "Slice offset h", exact: true })
    .fill("1");
  await expect
    .poll(async () => (await meta(page)).sections.map((s: any) => s.dimension))
    .toEqual([3, 0]);
  expect.soft((await meta(page)).polytope.ids).toContain("section/i");
  await expect
    .soft(artwork(page).locator('g[data-role="center"]'))
    .toHaveCount(0);
  await expect
    .soft(artwork(page).locator('g[data-role="vertex"]'))
    .toHaveCount(1);
  await selectedField(page).fill("12");
  await expect.poll(() => selected(page)).toBe(11); // e_w: the entire primal cell lies in w=1.
  await expect
    .soft(artwork(page).locator('g[data-role="center"]'))
    .toHaveCount(1);
  const accent = await artwork(page)
    .locator('path[data-role="cell"]')
    .first()
    .getAttribute("stroke");
  const fills = await artwork(page)
    .locator('path[data-face][data-guide="false"]')
    .evaluateAll((es) => es.map((e) => e.getAttribute("fill")));
  expect.soft(fills).toHaveLength(8);
  expect.soft(new Set(fills)).toEqual(new Set([accent]));
});

test("zero link emphasis is the neutral entered drawing, with no playback presentation", async ({
  page,
}) => {
  await open(page, passage);
  const geometry = () =>
    artwork(page)
      .locator("[data-source],[data-face],[data-marker]")
      .evaluateAll((es) => es.map((e) => e.outerHTML));
  const before = await geometry();
  const neutral = presetStudy(
    tesseractPresets.findIndex((p) => p.name === passage),
  );
  neutral.config.cell24!.emphasis = 0;
  const token = await writeStudyLink("4d", neutral);
  await page.goto(`/?study=4d#s=${token}`);
  await expect(page).not.toHaveURL(/#s=/);
  await settle(page);
  await expect
    .poll(async () => (await meta(page)).config.cell24.emphasis)
    .toBe(0);
  expect(await geometry()).toEqual(before);
});
