import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  chooseColorScheme,
  choosePreset,
  exportImage,
  openShapeExport,
} from "./helpers";
import { decodeVideo, frameDifference, probe } from "./video";
import { colorSchemes } from "../web/color-schemes";
import {
  polytopeMarkerBound,
  polytopePathBound,
} from "../web/tesseract/polytope";

// The 24-cell and its polar dual (docs/tesseracts.md): one selected
// octahedral cell, its center (a dual vertex), and both whole crystals.
const signature = "The heart of a cell";
const crystal = "A crystal and its companion";
const stage = (p: Page) => p.locator(".tesseract-stage");
const settle = (p: Page) =>
  expect(stage(p)).toHaveAttribute("aria-busy", "false");
const artwork = (p: Page) => p.locator("#tesseract-artwork");
const meta = async (p: Page) =>
  JSON.parse((await p.locator("#tesseract-artwork > desc").textContent())!);
const selectedField = (p: Page) =>
  p.getByRole("spinbutton", { name: "Selected cell", exact: true });
const show = (p: Page) =>
  p.getByRole("combobox", { name: "Show", exact: true });
const open = async (p: Page, preset = signature) => {
  await p.goto("/?study=4d");
  await settle(p);
  await choosePreset(p, { label: preset });
  await settle(p);
};
// Drawn paths by role, and markers by role.
const counts = (p: Page) =>
  artwork(p).evaluate((svg) => {
    const out: Record<string, number> = {};
    for (const e of svg.querySelectorAll("path[data-role], g[data-role]")) {
      const r = e.getAttribute("data-role")!;
      out[r] = (out[r] ?? 0) + 1;
    }
    return out;
  });
// Screen-independent drawing coordinates of a path's points or a marker's
// center, in the 1000 × 760 viewBox.
const pathPoints = (p: Page, selector: string) =>
  artwork(p)
    .locator(selector)
    .evaluateAll((es) =>
      es.map((e) =>
        e
          .getAttribute("d")!
          .match(/-?\d+(?:\.\d+)?/g)!
          .map(Number),
      ),
    );
const markerAt = (p: Page, id: string) =>
  artwork(p)
    .locator(`g[data-marker="${id}"] circle:last-child`)
    .evaluate((c) => [
      Number(c.getAttribute("cx")),
      Number(c.getAttribute("cy")),
    ]);
// A marker's position on the page.
const screenOf = (p: Page, id: string) =>
  artwork(p)
    .locator(`g[data-marker="${id}"] circle:last-child`)
    .evaluate((c) => {
      const m = (c as SVGCircleElement).ownerSVGElement!.getScreenCTM()!;
      const x = Number(c.getAttribute("cx")),
        y = Number(c.getAttribute("cy"));
      return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
    });
const selected = async (p: Page) => (await meta(p)).polytope.selectedCell;

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
  await expect(page.locator(".lift-readout")).toContainText("(1, 0, 0, 0)");
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

// The live drawing rasterized as export rasterizes it.
const raster = (page: Page, width: number, height: number) =>
  page.evaluate(
    async ({ width, height }) => {
      const svg = document
        .getElementById("tesseract-artwork")!
        .cloneNode(true) as SVGSVGElement;
      svg.setAttribute("width", String(width));
      svg.setAttribute("height", String(height));
      const url = URL.createObjectURL(
        new Blob([new XMLSerializer().serializeToString(svg)], {
          type: "image/svg+xml",
        }),
      );
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        const c = document.createElement("canvas");
        c.width = width;
        c.height = height;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(image, 0, 0);
        return Array.from(ctx.getImageData(0, 0, width, height).data);
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    { width, height },
  );

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
