import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  chooseColorScheme,
  choosePreset,
  exportImage,
  openShapeExport,
} from "./helpers";
import {
  correspondence,
  meta,
  openPreset,
  panel,
  pointOn,
  raster,
  roles,
  selectedField,
  settle,
} from "./hopf-helpers";
import { decodeVideo, frameDifference, probe } from "./video";

// The geodesic polygon base path of Base sphere and fibers
// (docs/tesseracts.md, "Geodesic polygons"). Expected points come from the
// vertex chart and spherical linear interpolation, written out here.
type Vertex = { u: number; v: number };
const latitude = "A circle over every point";
const triangle = "A spherical triangle, three stitched tori";
const star = "A star on the sphere, a crossing bouquet";

const chart = ({ u, v }: Vertex) => {
  const p = [Math.cos(v) * Math.cos(u), Math.cos(v) * Math.sin(u), Math.sin(v)];
  return Math.hypot(p[0], p[1]) <= 2e-12 ? [0, 0, Math.sign(p[2])] : p;
};
const dot = (a: number[], b: number[]) =>
  a.reduce((s, x, i) => s + x * b[i], 0);
// Arc length t from vertex 1 along the shorter arcs, by slerp; the side a
// vertex begins is the one departing from it.
function polygon(vs: Vertex[]) {
  const ps = vs.map(chart);
  const sides = ps.map((p, i) => Math.acos(dot(p, ps[(i + 1) % ps.length])));
  const corners = sides.map((_, i) =>
    sides.slice(0, i).reduce((a, b) => a + b, 0),
  );
  const length = sides.reduce((a, b) => a + b, 0);
  const side = (t: number) => {
    let i = 0;
    while (i + 1 < ps.length && t >= corners[i + 1] - 1e-12) i++;
    return i;
  };
  const at = (t: number) => {
    const i = side(t),
      a = ps[i],
      b = ps[(i + 1) % ps.length],
      s = t - corners[i];
    return a.map(
      (x, k) =>
        (Math.sin(sides[i] - s) * x + Math.sin(s) * b[k]) / Math.sin(sides[i]),
    );
  };
  return { length, corners, side, at };
}
const expectOn = (point: number[], want: number[]) =>
  point.forEach((v, i) => expect(v).toBeCloseTo(want[i], 12));
const basePath = (p: Page) =>
  p.getByRole("combobox", { name: "Base path", exact: true });
const field = (p: Page, name: string) =>
  p.getByRole("textbox", { name, exact: true });
const button = (p: Page, name: string) =>
  p.getByRole("button", { name, exact: true });
const vertexGroup = (p: Page, k: number) =>
  p.getByRole("group", { name: `Vertex ${k}`, exact: true });
const vertices = async (p: Page): Promise<Vertex[]> =>
  (await meta(p)).config.weave.vertices;
const sideReadout = (p: Page) =>
  p.locator(".lift-readout span", { hasText: "Moving point side" });
const motionLabels = (p: Page) =>
  p
    .getByRole("combobox", { name: "Animate", exact: true })
    .locator("option")
    .allTextContents();
const octant = [
  { u: 0, v: 0 },
  { u: Math.PI / 2, v: 0 },
  { u: 0, v: Math.PI / 2 },
];

test("the polygon opens from an edited latitude with the octant triangle, refuses bad vertices by field, and returns", async ({
  page,
}) => {
  await openPreset(page, latitude);
  const alpha = field(page, "Central latitude α");
  await alpha.fill("0.6");
  await expect
    .poll(async () => (await meta(page)).config.weave.alpha)
    .toBe(0.6);
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("latitude");
  await settle(page);
  const latitudeStudy = await meta(page);
  const latitudeBase = await correspondence(page);

  await basePath(page).selectOption("polygon");
  await settle(page);
  expect(await vertices(page)).toEqual(octant);
  await expect(alpha).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  for (const k of [1, 2, 3])
    await expect(button(page, `Remove vertex ${k}`)).toBeDisabled();
  await expect(
    page.getByRole("combobox", { name: "Animate", exact: true }),
  ).toHaveValue("trace");
  const offered = await motionLabels(page);
  expect(offered[0]).toBe("Trace the polygon");
  expect(offered).not.toContain("Sweep latitudes");
  let c = (await correspondence(page)).base;
  expect(c).toMatchObject({ path: "polygon", sides: 3, side: 0 });
  expect(c.period).toBeCloseTo((3 * Math.PI) / 2, 14);
  expectOn(c.base, [1, 0, 0]);
  await expect(sideReadout(page)).toHaveText("Moving point side: 1 of 3");

  // Each refusal is shown under the field it names: an expression that
  // is not a constant, a latitude beyond the pole, a side whose ends
  // coincide (named by its later vertex), and an opposite closing side
  // (named by vertex 1).
  for (const bad of ["t", "1/0"]) {
    await field(page, "Vertex 2 u").fill(bad);
    await expect(vertexGroup(page, 2).getByRole("alert")).toBeVisible();
  }
  await field(page, "Vertex 2 u").fill("pi/2");
  await field(page, "Vertex 3 v").fill("pi");
  await expect(vertexGroup(page, 3).getByRole("alert")).toContainText(
    "vertex 3: v is a latitude, within ±π/2",
  );
  await field(page, "Vertex 3 v").fill("0");
  await field(page, "Vertex 3 u").fill("pi/2");
  await expect(vertexGroup(page, 3).getByRole("alert")).toContainText(
    "vertices 2 and 3 coincide, so the side between them has no direction",
  );
  await field(page, "Vertex 3 u").fill("pi");
  await expect(vertexGroup(page, 1).getByRole("alert")).toContainText(
    "vertices 3 and 1 lie opposite, so no single shortest arc joins them",
  );
  await expect(vertexGroup(page, 3).getByRole("alert")).toHaveCount(0);
  await field(page, "Vertex 3 u").fill("0");
  await field(page, "Vertex 3 v").fill("pi/2");
  await settle(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await vertices(page)).toEqual(octant);

  // An added vertex is the middle of the closing side; then any one can
  // be removed, down to three.
  await button(page, "Add a vertex").click();
  await settle(page);
  expect(await vertices(page)).toEqual([...octant, { u: 0, v: Math.PI / 4 }]);
  await expect(field(page, "Vertex 4 v")).toHaveValue("pi/4");
  c = (await correspondence(page)).base;
  expect(c.sides).toBe(4);
  await button(page, "Remove vertex 2").click();
  await settle(page);
  expect(await vertices(page)).toEqual([
    octant[0],
    octant[2],
    { u: 0, v: Math.PI / 4 },
  ]);
  // Vertices 2 and 3 now lie on one meridian with vertex 1: a closed
  // back-and-forth path, admitted.
  await expect(page.getByRole("alert")).toHaveCount(0);
  await field(page, "Vertex 2 u").fill("pi/2");
  await field(page, "Vertex 2 v").fill("0");
  await field(page, "Vertex 3 v").fill("pi/2");
  await settle(page);

  // The latitude returns as it was; the polygon keeps its vertices.
  await basePath(page).selectOption("latitude");
  await settle(page);
  await expect(alpha).toHaveValue("0.6");
  await expect(field(page, "Vertex 1 u")).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("latitude");
  await settle(page);
  expect((await meta(page)).config).toEqual({
    ...latitudeStudy.config,
    weave: {
      ...latitudeStudy.config.weave,
      path: "latitude",
      vertices: octant,
    },
  });
  expect(await correspondence(page)).toEqual(latitudeBase);
  await basePath(page).selectOption("polygon");
  await settle(page);
  expect(await vertices(page)).toEqual(octant);
});

test("a polygon holds 3–12 vertices", async ({ page }) => {
  await openPreset(page, triangle);
  for (let k = 3; k < 12; k++) {
    await button(page, "Add a vertex").click();
    await expect(field(page, `Vertex ${k + 1} u`)).toBeVisible();
  }
  await settle(page);
  await expect(button(page, "At most 12 vertices")).toBeDisabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  const c = (await correspondence(page)).base;
  expect(c.sides).toBe(12);
  for (let k = 12; k > 3; k--) await button(page, `Remove vertex ${k}`).click();
  await settle(page);
  expect((await vertices(page)).length).toBe(3);
  await expect(button(page, "Remove vertex 1")).toBeDisabled();
});

// Adding or removing a vertex renumbers the fields after it, so an entry
// still being evaluated lands on the vertex it was typed into first.
test("a vertex removed while an entry is pending keeps that entry on its own vertex", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    (window as any).pendingScalars = 0;
    Worker.prototype.postMessage = function (q: any, ...rest: any[]) {
      if (q.action !== "scalars") return send.call(this, q, ...rest);
      (window as any).pendingScalars++;
      const finished = ({ data }: MessageEvent) => {
        if (data.id !== q.id) return;
        (window as any).pendingScalars--;
        this.removeEventListener("message", finished);
      };
      this.addEventListener("message", finished);
      setTimeout(() => send.call(this, q, ...rest), 250);
    };
  });
  await openPreset(page, star);
  const before = await vertices(page);
  await field(page, "Vertex 4 u").fill("pi/7");
  await expect
    .poll(() => page.evaluate(() => (window as any).pendingScalars))
    .toBeGreaterThan(0);
  await button(page, "Remove vertex 2").click();
  await expect
    .poll(() => page.evaluate(() => (window as any).pendingScalars))
    .toBe(0);
  await settle(page);
  expect(await vertices(page)).toEqual([
    before[0],
    before[2],
    { ...before[3], u: Math.PI / 7 },
    before[4],
  ]);
  await expect(field(page, "Vertex 3 u")).toHaveValue("pi/7");
});

for (const preset of [triangle, star])
  test(`${preset} traces across its corners, scrubs both ways and returns whole`, async ({
    page,
  }) => {
    await openPreset(page, preset);
    const initial = await meta(page);
    const path = polygon(initial.config.weave.vertices);
    const first = await roles(page);
    // Samples 0, 10 and 20 of 30 are the triangle's vertices.
    if (preset === triangle) {
      const markers = (await correspondence(page)).base;
      expect(markers.path).toBe("polygon");
      for (const [j, k] of [
        [10, 1],
        [20, 2],
      ]) {
        await selectedField(page).fill(String(j + 1));
        await settle(page);
        // Go's sine can differ from JavaScript's in the last bit; the
        // Go tests check that the sample is the vertex exactly.
        const at = (await correspondence(page)).base.base;
        chart(initial.config.weave.vertices[k]).forEach((x, i) =>
          expect(at[i]).toBeCloseTo(x, 15),
        );
      }
      await selectedField(page).fill("1");
      await settle(page);
    }
    await button(page, "Play animation").click();
    await expect(page.locator('[data-source="weave/moving"]')).toHaveCount(1);
    await button(page, "Pause").click();
    const sides = new Set<number>();
    for (const s of [0.3, 0.1, 0.6, 0.83, 0.2, 1, 0]) {
      await page
        .getByRole("slider", { name: "Animation progress" })
        .fill(String(s));
      await settle(page);
      const c = await correspondence(page);
      expect(c.base).toEqual(c.stereo);
      expect(c.base.parameter).toBeGreaterThanOrEqual(0);
      expect(c.base.parameter).toBeLessThan(c.base.period);
      expect(c.base.period).toBeCloseTo(path.length, 13);
      expectOn(c.base.base, path.at(c.base.parameter));
      expect(c.base.side).toBe(path.side(c.base.parameter));
      await expect(sideReadout(page)).toHaveText(
        `Moving point side: ${c.base.side + 1} of ${c.base.sides}`,
      );
      sides.add(c.base.side);
      if (s === 0 || s === 1) {
        expect(c.base.movingSample).toBe(0);
        expect(await roles(page)).toEqual(first);
      }
    }
    expect(sides.size).toBeGreaterThan(1);
    await page.getByRole("button", { name: /^(Stop|Back to study)$/ }).click();
    await settle(page);
    expect(await meta(page)).toEqual(initial);
  });

test("the triangle's traced loop exports both panes with its duration and endpoints", async ({
  page,
}) => {
  test.slow();
  await openPreset(page, triangle);
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("1");
  await button(page, "Play animation").click();
  await button(page, "Pause").click();
  const references: number[][] = [];
  for (const s of [0, 0.4]) {
    await page
      .getByRole("slider", { name: "Animation progress" })
      .fill(String(s));
    await settle(page);
    references.push(await raster(page, 1000, 380));
  }
  await openShapeExport(page);
  await page
    .getByRole("combobox", { name: "Export format" })
    .selectOption("mp4");
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("0.5");
  await page
    .getByRole("combobox", { name: "Export frame rate" })
    .selectOption("15");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Export MP4 video/ }).click();
  const file = (await (await download).path())!;
  const p = probe(file);
  if (p) {
    expect([p.width, p.height, p.frames]).toEqual([1000, 380, 15]);
    expect(p.durations.reduce((a, b) => a + b, 0)).toBe(1000);
  }
  expect((await decodeVideo(page, await readFile(file))).duration).toBeCloseTo(
    1,
    3,
  );
  for (const [k, index] of [0, 6].entries()) {
    const d = frameDifference(file, 1000, 380, index, references[k]);
    if (d) {
      expect(d.meanDifference).toBeLessThan(6);
      expect(d.unmatchedInk).toBeLessThan(0.02);
    }
  }
});

test("an edited polygon's link and still keep its vertices, selection and appearance", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openPreset(page, triangle);
  await field(page, "Vertex 2 v").fill("-pi/8");
  await settle(page);
  await button(page, "Add a vertex").click();
  await settle(page);
  // Selection by key and by tap on the base sphere.
  await panel(page, "base").focus();
  await page.keyboard.press("]");
  await settle(page);
  await expect(selectedField(page)).toHaveValue("2");
  const at = await pointOn(
    page,
    'svg[data-representation="base"] g[data-sample="7"]',
  );
  await page.mouse.click(at.x, at.y);
  await settle(page);
  await expect(selectedField(page)).toHaveValue("8");
  await chooseColorScheme(page, "cobalt");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(
    panel(page, "stereo").locator('[data-correspondence="moving"]'),
  ).toHaveAttribute("stroke", "#ff9fbd");
  await settle(page);
  const live = await meta(page);
  expect(live.config.weave).toMatchObject({ path: "polygon", selected: 7 });
  expect(live.config.weave.vertices).toHaveLength(4);
  expect(live.config.weave.vertices[1].v).toBe(-Math.PI / 8);
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const svg = await readFile((await (await download).path())!, "utf8");
  const m = JSON.parse(
    svg.match(/<desc>([^<]*)<\/desc>/)![1].replace(/&quot;/g, '"'),
  );
  expect(m.config).toEqual(live.config);
  expect(svg).not.toMatch(/<text|<foreignObject/);
  await button(page, "Copy link").click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  await page.goto("about:blank");
  await page.goto(url.replace(/^https?:\/\/[^/]+/, ""));
  await settle(page);
  expect((await meta(page)).config).toEqual(live.config);
  await expect(field(page, "Vertex 2 v")).toHaveValue("-pi/8");
});

for (const size of [
  { width: 1440, height: 650 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
])
  test(`polygon walkthrough keeps vertex controls and both panes reachable (${size.width}×${size.height})`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: size,
      hasTouch: size.width < 1000,
      isMobile: size.width < 1000,
    });
    const page = await context.newPage();
    await openPreset(page, star);
    await expect(panel(page, "base")).toBeVisible();
    await expect(panel(page, "stereo")).toBeVisible();
    const fits = () =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      );
    expect(await fits()).toBe(true);
    await button(page, "Add a vertex").scrollIntoViewIfNeeded();
    await button(page, "Add a vertex").click();
    await settle(page);
    await field(page, "Vertex 6 v").fill("pi");
    await expect(vertexGroup(page, 6).getByRole("alert")).toBeVisible();
    expect(await fits()).toBe(true);
    await field(page, "Vertex 6 v").fill("-pi/6");
    await settle(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
    // The two coordinates of a vertex share a row.
    const top = (name: string) =>
      field(page, name).evaluate((e) => e.getBoundingClientRect().top);
    expect(await top("Vertex 6 u")).toBe(await top("Vertex 6 v"));
    await panel(page, "base").scrollIntoViewIfNeeded();
    const at = await pointOn(
      page,
      'svg[data-representation="base"] g[data-sample="3"]',
    );
    if (size.width < 1000) await page.touchscreen.tap(at.x, at.y);
    else await page.mouse.click(at.x, at.y);
    await settle(page);
    await expect(selectedField(page)).toHaveValue("4");
    await button(page, "Play animation").click();
    await button(page, "Pause").click();
    await page.getByRole("slider", { name: "Animation progress" }).fill("0.37");
    await settle(page);
    expect(await fits()).toBe(true);
    await page.getByRole("button", { name: /^(Stop|Back to study)$/ }).click();
    await settle(page);
    await context.close();
  });

// Choosing an example replaces the whole study, vertices included.
test("an example replaces an edited polygon whole", async ({ page }) => {
  await openPreset(page, star);
  await field(page, "Vertex 1 v").fill("0.2");
  await settle(page);
  await choosePreset(page, { label: triangle });
  await settle(page);
  expect((await vertices(page)).map((v) => v.v)).toEqual([
    Math.PI / 6,
    Math.PI / 6,
    Math.PI / 6,
  ]);
});
