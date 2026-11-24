import { test, expect, type Page, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";

// Zoom detail for the hyperbolic lace (docs/mathematics.md, Hyperbolic
// lace, Detail for a view). A view past 1.4× gets the tiles drawn in it at
// least the tiling's detail radius, however deep, beside the cutoffs'
// patch; the engine's invariants are engine/lace_view_test.go's. Here the
// drawing, its path independence, selection, motion and still record are
// checked through the page.

const lace = (page: Page) =>
  page.getByRole("dialog", { name: "Hyperbolic lace" });
const art = (d: Locator) => d.locator("#lace-artwork");
const ready = (d: Locator) =>
  expect(art(d)).toHaveAttribute("aria-busy", "false");
const summary = (d: Locator) => d.locator(".lace-summary");
const detail = (d: Locator) =>
  d.getByRole("checkbox", { name: "Deeper tiles when zoomed in" });
// The camera that puts the model point ρe^{iθ} at the middle of the page.
const at = (rho: number, theta: number, zoom: number) => {
  const k = 350 * zoom;
  return {
    x: -rho * Math.cos(theta) * k,
    y: rho * Math.sin(theta) * k,
    zoom,
  };
};
async function openStudy(page: Page, change: object) {
  const { presetStudy } = await import("../web/planar-link");
  const { presetLace } = await import("../web/lace/model");
  const { studyHref, writeStudyLink } = await import("../web/study-link");
  const token = await writeStudyLink("2d", {
    ...presetStudy(0),
    lace: { ...presetLace(0), ...change },
  });
  await page.goto("/");
  await page.goto(
    studyHref("http://localhost/", "2d", token).replace("http://localhost", ""),
  );
  const d = lace(page);
  await ready(d);
  return d;
}
// The drawing's paths, as role, taper level and commands.
const runs = (d: Locator) =>
  art(d).evaluate((svg) =>
    Array.from(
      svg.querySelectorAll("path"),
      (p) =>
        `${p.getAttribute("data-role")} ${p.getAttribute("data-level")} ${p.getAttribute("d")}`,
    ),
  );
// Every drawn segment with an end on the page, as its two ends in page
// units, rounded to a hundredth: an edge may be placed by another of its
// tiles in a windowed patch, and drawn the other way.
async function segments(d: Locator) {
  const [px, py] = (await art(d).getAttribute("data-pan"))!
    .split(",")
    .map(Number);
  const out = new Set<string>();
  for (const r of await runs(d))
    for (const m of r.matchAll(
      /M(-?[\d.]+) (-?[\d.]+)(?:A-?[\d.]+ -?[\d.]+ 0 0 [01] |L)(-?[\d.]+) (-?[\d.]+)/g,
    )) {
      const ends = [
        [+m[1], +m[2]],
        [+m[3], +m[4]],
      ];
      if (
        !ends.some(
          ([x, y]) =>
            x + px >= 0 && x + px <= 1000 && y + py >= 0 && y + py <= 760,
        )
      )
        continue;
      out.add(
        ends
          .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
          .sort()
          .join(" "),
      );
    }
  return out;
}
const gap = async (d: Locator) =>
  Number(
    (await summary(d).textContent())!
      .match(/outermost corners lie ([\d.e−-]+) inside/)![1]
      .replace("−", "-"),
  );
const deepest = async (d: Locator) =>
  Number((await summary(d).textContent())!.match(/at depths 0–(\d+)/)![1]);

test("detail is off by default and in older links, and the checkbox turns it on and off", async ({
  page,
}) => {
  const { planarStudy, presetStudy } = await import("../web/planar-link");
  const { LinkError } = await import("../web/study-link");
  const { presetLace, lacePresets } = await import("../web/lace/model");
  for (const p of lacePresets) expect(p.study.detail).toBeUndefined();
  // A link written before the option opens without it.
  expect(
    planarStudy({ ...presetStudy(0), lace: presetLace(0) }).lace!.detail,
  ).toBeUndefined();
  let error: unknown;
  try {
    planarStudy({
      ...presetStudy(0),
      lace: { ...presetLace(0), detail: "yes" as any },
    });
  } catch (e) {
    error = e;
  }
  expect(error instanceof LinkError && error.field).toBe("lace.detail");
  const view = at(1, 2.6, 20);
  const d = await openStudy(page, { view });
  await expect(detail(d)).not.toBeChecked();
  const plain = await runs(d);
  const plainDepth = await deepest(d);
  await detail(d).check();
  await ready(d);
  await expect(summary(d)).toContainText("this view's tiles reach");
  expect(await deepest(d)).toBeGreaterThan(plainDepth);
  await detail(d).uncheck();
  await ready(d);
  expect(await runs(d)).toEqual(plain);
});

test("past 1.4× detail draws deeper tiles to the rim and keeps every drawn tile of the patch; below it, nothing changes", async ({
  page,
}) => {
  const view = at(1, 1.1, 30);
  const plain = await openStudy(page, { view });
  const plainSegments = await segments(plain);
  const plainGap = await gap(plain);
  expect(await deepest(plain)).toBe(5);
  const d = await openStudy(page, { view, detail: true });
  await expect(detail(d)).toBeChecked();
  await expect(summary(d)).toContainText(
    "Beyond the cutoffs' patch, this view's tiles reach",
  );
  // Deeper than any cutoff, and far nearer the rim.
  expect(await deepest(d)).toBeGreaterThan(8);
  expect(await gap(d)).toBeLessThan(plainGap / 10);
  const detailed = await segments(d);
  for (const s of plainSegments) expect(detailed.has(s)).toBe(true);
  expect(detailed.size).toBeGreaterThan(plainSegments.size);
  // At 1.2× the request is the static one: the drawing is the plain one.
  const near = at(0.9, 1.1, 1.2);
  const plainNear = await runs(await openStudy(page, { view: near }));
  expect(
    await runs(await openStudy(page, { view: near, detail: true })),
  ).toEqual(plainNear);
  // So is a lace moved off center, at any zoom.
  const isometry = { offset: 0.3, direction: 0.4, rotation: 0 };
  const moved = await runs(await openStudy(page, { view, isometry }));
  const m = await openStudy(page, { view, isometry, detail: true });
  expect(await runs(m)).toEqual(moved);
  await expect(m.locator(".garden-gestures")).toContainText(
    "a lace moved off center keeps its patch",
  );
});

test("the same final view draws the same tiles however it was reached, after rapid gestures", async ({
  page,
}) => {
  const d = await openStudy(page, { view: at(0.97, 2.3, 1), detail: true });
  await art(d).focus();
  // A burst through many levels and cells, without waiting.
  for (const key of [
    ..."++++++++++++".split(""),
    "ArrowRight",
    "ArrowRight",
    "-",
    "ArrowUp",
    "+",
    "+",
    "ArrowLeft",
  ])
    await page.keyboard.press(key);
  await ready(d);
  const zoom = Number(await art(d).getAttribute("data-zoom"));
  const [x, y] = (await art(d).getAttribute("data-pan"))!
    .split(",")
    .map(Number);
  expect(zoom).toBeGreaterThan(8);
  const reached = await runs(d);
  const tiles = await art(d).getAttribute("data-tiles");
  // The same view opened directly.
  const direct = await openStudy(page, {
    view: { x, y, zoom },
    detail: true,
  });
  expect(await art(direct).getAttribute("data-tiles")).toBe(tiles);
  expect(await runs(direct)).toEqual(reached);
});

test("a deep selection keeps its address when its view is left and revisited, and in a link", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as any).copied = value;
        },
      },
    }),
  );
  const view = at(1, -0.7, 40);
  const d = await openStudy(page, {
    tiling: "3,7",
    depth: 10,
    view,
    detail: true,
  });
  // The last tile breadth-first is among the deepest in view.
  const count = Number(await art(d).getAttribute("data-tiles"));
  const field = d.getByLabel("Tile", { exact: true });
  await field.fill(String(count));
  await field.blur();
  const address = d.locator(".garden-about .garden-facts").last();
  const text = (await address.textContent())!;
  const sides = text.split(":")[1].split("→").length;
  expect(sides).toBeGreaterThan(11);
  await expect(d.locator(".garden-about h3")).toContainText("of this view");
  // Pan a view and a half away (25 units a key): the tile leaves the
  // window, and its address is kept.
  await art(d).focus();
  for (let i = 0; i < 64; i++) await page.keyboard.press("ArrowRight");
  await ready(d);
  await expect(
    d.getByText(
      "The selected tile lies beyond the cutoffs and outside this view.",
    ),
  ).toBeVisible();
  for (let i = 0; i < 64; i++) await page.keyboard.press("ArrowLeft");
  await ready(d);
  await expect(address).toHaveText(text);
  // A link carries the deep address and the option, and reopens them.
  const { wireStudy } = await import("./study-link-wire");
  await d.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(d.getByText("Link copied", { exact: true })).toBeVisible();
  const link: string = await page.evaluate(() => (window as any).copied);
  const saved = wireStudy(new URL(link).hash.slice(3));
  expect(saved.lace.detail).toBe(true);
  expect(saved.lace.selected).toHaveLength(sides);
  await page.goto("/");
  await page.goto(link.replace(/^https?:\/\/[^/]+/, ""));
  await ready(lace(page));
  await expect(
    lace(page).locator(".garden-about .garden-facts").last(),
  ).toHaveText(text);
});

test("a motion freezes the view's tiles until it stops, then the view is detailed again", async ({
  page,
}) => {
  // Count the generation requests the page sends to its workers.
  await page.addInitScript(() => {
    (window as any).laceRequests = 0;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (
      this: Worker,
      m: any,
      ...rest: any[]
    ) {
      if (m?.action === "lace") (window as any).laceRequests++;
      return post.call(this, m, ...(rest as []));
    };
  });
  const d = await openStudy(page, { view: at(0.98, 0.6, 8), detail: true });
  const tiles = await art(d).getAttribute("data-tiles");
  const requests = () => page.evaluate(() => (window as any).laceRequests);
  const before = await requests();
  await d.getByRole("button", { name: "Play motion" }).click();
  await expect(d.locator(".garden-gestures")).toContainText(
    "only enlarges the motion's tiles until it stops",
  );
  await art(d).focus();
  await page.keyboard.press("+");
  await page.keyboard.press("+");
  await page.waitForTimeout(400);
  await expect(art(d)).toHaveAttribute("data-tiles", tiles!);
  // Zooming while it plays asks for no new tiles.
  expect(await requests()).toBe(before);
  await d.getByRole("button", { name: "Stop motion" }).click();
  await ready(d);
  await expect(art(d)).not.toHaveAttribute("data-tiles", tiles!);
});

test("the SVG still draws the detailed view and records its request", async ({
  page,
}) => {
  const d = await openStudy(page, { view: at(1, 2, 20), detail: true });
  const live = await runs(d);
  const download = page.waitForEvent("download");
  await d.getByRole("button", { name: "Export image" }).click();
  await page.getByRole("menuitem", { name: /SVG/ }).click();
  const text = await readFile((await (await download).path())!, "utf8");
  const exported = await page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    return {
      desc: JSON.parse(doc.querySelector("svg > desc")!.textContent!),
      runs: Array.from(
        doc.querySelectorAll("path"),
        (p) =>
          `${p.getAttribute("data-role")} ${p.getAttribute("data-level")} ${p.getAttribute("d")}`,
      ),
    };
  }, text);
  expect(exported.runs).toEqual(live);
  expect(exported.desc.detail).toBe(true);
  const { level, factor, window, minRadius } = exported.desc.detailRequest;
  // Zoom 20 lies at level ⌊2 log₂ 20⌋ = 8, factor 2⁴ = 16, and {7,3}'s
  // detail radius is 3 drawing units: 3/(350·16) in model units.
  expect(level).toBe(8);
  expect(factor).toBe(16);
  expect(minRadius).toBeCloseTo(3 / (350 * 16), 15);
  // The window holds the view.
  const k = 350 * 20,
    cx = Math.cos(2),
    cy = Math.sin(2);
  expect(window.xMin).toBeLessThanOrEqual(cx - 500 / k);
  expect(window.xMax).toBeGreaterThanOrEqual(cx + 500 / k);
  expect(window.yMin).toBeLessThanOrEqual(cy - 380 / k);
  expect(window.yMax).toBeGreaterThanOrEqual(cy + 380 / k);
});

test("the detail policy snaps zoom to half octaves and the window to quarter-view cells, so small pans and revisits ask for the same request", async () => {
  const { laceDetailView } = await import("../web/lace/model");
  // Below √2 there is no detail.
  expect(laceDetailView("7,3", { x: 0, y: 0, zoom: 1.41 })).toBeUndefined();
  expect(laceDetailView("7,3", { x: 0, y: 0, zoom: 1.415 })!.level).toBe(1);
  // Zoom 20: level ⌊2 log₂ 20⌋ = 8, factor 16, cells 1000/(350·16)/4
  // model units. The view, ±500/7000 by ±380/7000 about the center, is
  // ±1.6 by ±1.22 cells: snapped out and one more, ±3 cells both ways.
  const d = laceDetailView("7,3", { x: 0, y: 0, zoom: 20 })!;
  const cell = 1000 / (350 * 16) / 4;
  expect(d.level).toBe(8);
  expect(d.factor).toBe(16);
  expect(d.minRadius).toBeCloseTo(3 / (350 * 16), 15);
  expect(d.window).toEqual({
    xMin: -3 * cell,
    xMax: 3 * cell,
    yMin: -3 * cell,
    yMax: 3 * cell,
  });
  // {3,7}'s triangles stop at 4 drawing units.
  expect(
    laceDetailView("3,7", { x: 0, y: 0, zoom: 20 })!.minRadius,
  ).toBeCloseTo(4 / (350 * 16), 15);
  // A pan within a cell, a zoom within the level, and a revisit ask for
  // the same request.
  expect(laceDetailView("7,3", { x: 10, y: -10, zoom: 20 })).toEqual(d);
  expect(laceDetailView("7,3", { x: 0, y: 0, zoom: 22 })!.window).toEqual(
    d.window,
  );
  expect(laceDetailView("7,3", { x: 0, y: 0, zoom: 20 })).toEqual(d);
  // A view beyond the disk keeps a one-cell window outside it: cells
  // reach ⌈1/cell⌉ + 1 = 24 from the center.
  const far = laceDetailView("7,3", { x: -5 * 7000, y: 0, zoom: 20 })!;
  expect(far.window.xMin).toBeCloseTo(24 * cell, 12);
  expect(far.window.xMax).toBeCloseTo(25 * cell, 12);
  // The window holds every view's part within the disk's square, at every
  // level and place; beyond it, the window is clamped to the cells
  // around the disk.
  for (let level = 1; level <= 13; level++)
    for (const [cx, cy] of [
      [0.3, -0.2],
      [0.99, 0.05],
      [-0.6, 0.79],
    ]) {
      const zoom = Math.min(100, 2 ** (level / 2) * 1.3);
      const k = 350 * zoom;
      const v = laceDetailView("5,4", { x: -cx * k, y: cy * k, zoom })!;
      const clip = (v: number) => Math.max(-1, Math.min(1, v));
      expect(v.window.xMin).toBeLessThanOrEqual(clip(cx - 500 / k));
      expect(v.window.xMax).toBeGreaterThanOrEqual(clip(cx + 500 / k));
      expect(v.window.yMin).toBeLessThanOrEqual(clip(cy - 380 / k));
      expect(v.window.yMax).toBeGreaterThanOrEqual(clip(cy + 380 / k));
    }
});
