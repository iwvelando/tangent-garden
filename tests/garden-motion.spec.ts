import { test, expect } from "@playwright/test";

// The Apollonian garden's reveal and zoom detail: the reveal's membership
// rule and the view-to-request policy, with expectations worked by hand
// rather than by the production formulas; then the notebook's playback,
// seeking, export and zoom refinement in the browser.

test("the reveal shows the seeds, then the first n circles, then holds the whole packing", async () => {
  const { revealCount, revealHold, revealLoops } =
    await import("../web/garden/model");
  expect(revealHold).toEqual({ start: 0.06, end: 0.14 });
  const n = 1273;
  // The opening hold shows the four seeds, the closing hold every circle.
  for (const p of [0, 0.03, 0.06]) expect(revealCount(n, p)).toBe(4);
  for (const p of [0.86, 0.9, 1]) expect(revealCount(n, p)).toBe(n);
  // Halfway through the growth, at p = 0.06 + 0.8 / 2: 4 · √(1273 / 4)
  // = 71.36, so 71 circles; a quarter of the way, 4 · (1273/4)^¼ = 16.9.
  expect(revealCount(n, 0.46)).toBe(71);
  expect(revealCount(n, 0.26)).toBe(16);
  // Just inside each hold's edge the count has moved by at most one.
  expect(revealCount(n, 0.0601)).toBe(4);
  expect(revealCount(n, 0.8599)).toBeGreaterThan(n - 3);
  expect(revealCount(n, 0.8599)).toBeLessThan(n);
  // Never decreasing, and every count from 4 to n is reached in order.
  let last = 4;
  for (let i = 0; i <= 20000; i++) {
    const c = revealCount(n, i / 20000);
    expect(c >= last && c <= last + 1 && c <= n).toBe(true);
    last = c;
  }
  // The same time gives the same count from any history.
  expect([0.7, 0.2, 0.7].map((p) => revealCount(n, p))).toEqual([
    revealCount(n, 0.7),
    revealCount(n, 0.2),
    revealCount(n, 0.7),
  ]);
  // Only a reveal whose ends show the same circles can loop.
  expect(revealCount(4, 0)).toBe(4);
  expect(revealCount(4, 1)).toBe(4);
  expect(revealLoops(4)).toBe(true);
  expect(revealLoops(5)).toBe(false);
  expect(revealLoops(n)).toBe(false);
});

test("detail maps the view to a finer cutoff and a snapped window, and is off by default", async () => {
  const { detailFor, detailLevel, gardenRequest, defaultGarden } =
    await import("../web/garden/model");
  // Each half octave begins its level exactly.
  for (let k = 1; k <= 13; k++) {
    expect(detailLevel(2 ** (k / 2))).toBe(k);
    expect(detailLevel(2 ** (k / 2) * (1 - 1e-12))).toBe(k - 1);
  }
  const at = (view: { x: number; y: number; zoom: number }, extra = {}) => ({
    ...defaultGarden,
    view,
    detail: true as const,
    ...extra,
  });
  // Off, or zoomed no further than the whole packing: the static request.
  const plain = gardenRequest(defaultGarden);
  expect(plain).toEqual({
    seed: "-1,2,2,3",
    depth: 12,
    minRadius: 0.002,
    maxCircles: 5000,
  });
  expect(
    gardenRequest({ ...defaultGarden, view: { x: 40, y: 9, zoom: 30 } }),
  ).toEqual(plain);
  for (const zoom of [0.5, 1, 1.4142])
    expect(gardenRequest(at({ x: 0, y: 0, zoom }))).toEqual(plain);
  // Levels are half octaves: √2 (just above, against rounding), 2, 100.
  const cases: [number, number][] = [
    [Math.SQRT2 * (1 + 1e-12), Math.SQRT2],
    [2, 2],
    [2.5, 2],
    [2.9, 2 * Math.SQRT2],
    [100, 2 ** 6.5],
  ];
  for (const [zoom, factor] of cases) {
    const d = detailFor(at({ x: 0, y: 0, zoom }))!;
    expect(d.factor).toBeCloseTo(factor, 12);
    expect(gardenRequest(at({ x: 0, y: 0, zoom })).minRadius).toBeCloseTo(
      0.002 / factor,
      15,
    );
    // On screen the smallest circle is the cutoff's radius at 1× zoom,
    // to at most √2 times it.
    const screen = (0.002 / factor) * 350 * zoom;
    expect(screen).toBeGreaterThanOrEqual(0.7 - 1e-9);
    expect(screen).toBeLessThan(0.7 * Math.SQRT2);
  }
  // The window covers the view, in model units, with a margin; the view
  // is the 1000 × 760 page at 350 units per model unit and the zoom.
  for (const view of [
    { x: 0, y: 0, zoom: 4 },
    { x: -1200, y: 640, zoom: 7.3 },
    { x: 33, y: -17, zoom: 100 },
  ]) {
    const q = gardenRequest(at(view));
    const k = 350 * view.zoom;
    const seen = {
      xMin: (-500 - view.x) / k,
      xMax: (500 - view.x) / k,
      yMin: (view.y - 380) / k,
      yMax: (view.y + 380) / k,
    };
    const w = q.window!;
    const margin = (1000 / k) * 0.2;
    expect(w.xMin).toBeLessThanOrEqual(seen.xMin - margin);
    expect(w.xMax).toBeGreaterThanOrEqual(seen.xMax + margin);
    expect(w.yMin).toBeLessThanOrEqual(seen.yMin - margin);
    expect(w.yMax).toBeGreaterThanOrEqual(seen.yMax + margin);
    // Not much larger than the view: at most 8 × 7 quarter-view cells.
    expect(w.xMax - w.xMin).toBeLessThanOrEqual((8 * 1000) / k / 4 + 1e-12);
  }
  // A small pan within a cell asks for the same request, so a revisited
  // view is the same computation; a pan across cells moves the window.
  const a = gardenRequest(at({ x: 100, y: 50, zoom: 8 }));
  const b = gardenRequest(at({ x: 101, y: 50.5, zoom: 8 }));
  const c = gardenRequest(at({ x: 400, y: 50, zoom: 8 }));
  expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  expect(c.window!.xMin).not.toBe(a.window!.xMin);
  // Panned far beyond the packing, the window stays valid and small.
  for (const x of [1e7, -1e7]) {
    const w = gardenRequest(at({ x, y: -1e7, zoom: 50 })).window!;
    expect(w.xMax).toBeGreaterThan(w.xMin);
    expect(w.yMax).toBeGreaterThan(w.yMin);
    for (const v of Object.values(w)) expect(Math.abs(v)).toBeLessThan(3);
  }
  // A selection outside the window is kept, with its gaps; one inside the
  // window needs nothing more.
  const selected = { curvature: 23, x: 8, y: 12 };
  const away = gardenRequest(at({ x: 2000, y: 0, zoom: 10 }, { selected }));
  expect(away.keep).toEqual(selected);
  const k = 3500;
  const near = gardenRequest(
    at({ x: -(8 / 23) * k, y: (12 / 23) * k, zoom: 10 }, { selected }),
  );
  expect(near.keep).toBeUndefined();
});

// The browser tests open the rose window from the gallery, as garden.spec.ts
// does, and read membership from the circles drawn.
import type { Page, Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { decodeVideo, frameDifference, probe } from "./video";

const rose = "A rose window made only of circles";
async function openGarden(page: Page, title = rose) {
  await page.goto("/");
  await page.getByRole("button", { name: "Browse notebook examples" }).click();
  const gallery = page.getByRole("dialog", { name: "Notebook examples" });
  await gallery
    .locator(`[data-garden-example][data-example-title="${title}"]`)
    .click();
  await gallery.waitFor({ state: "hidden" });
  const d = page.getByRole("dialog", { name: "The Apollonian garden" });
  await ready(d);
  return d;
}
const ready = (d: Locator) =>
  expect(d.locator("#garden-artwork")).toHaveAttribute("aria-busy", "false");
const art = (d: Locator) => d.locator("#garden-artwork");
// The breadth-first indices of the circles drawn.
const drawn = (root: Locator) =>
  root.evaluate((svg) =>
    Array.from(svg.querySelectorAll("circle"), (c) =>
      Number(c.getAttribute("data-circle")),
    ).sort((a, b) => a - b),
  );
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
// The documented membership rule, restated: four seeds through 6% of the
// motion, all N from 86%, and floor(4·(N/4)^s) between, s = (p − 0.06)/0.8.
const expected = (total: number, p: number) => {
  if (p <= 0.06) return 4;
  if (p >= 0.86) return total;
  return Math.floor(4 * (total / 4) ** ((p - 0.06) / 0.8));
};
const slider = (d: Locator) =>
  d.getByRole("slider", { name: "Animation progress" });
async function seek(d: Locator, time: string) {
  await slider(d).fill(time);
  await expect(d.locator(".garden-view")).toHaveAttribute(
    "data-reveal-time",
    time,
  );
}
const total = async (d: Locator) =>
  Number(
    (await d.locator(".garden-summary").textContent())!
      .match(/^([\d,]+) circles/)![1]
      .replace(/,/g, ""),
  );

test("seeking, pausing, resuming and stopping the reveal show the same circles at the same time", async ({
  page,
}) => {
  const d = await openGarden(page);
  const n = await total(d);
  expect(n).toBe(1273);
  // Static before any reveal: every circle, no frame count.
  expect(await drawn(art(d))).toEqual(range(n));
  await expect(art(d)).not.toHaveAttribute("data-count", /.*/);
  // Endpoints, holds and a middle time, then backward: the drawn circles
  // are exactly the first n in breadth-first order.
  // (The static drawing's slider already reads 0, so start elsewhere.)
  for (const t of ["0.3", "0", "0.06", "0.7", "0.86", "1", "0.3", "0"]) {
    await seek(d, t);
    expect(await drawn(art(d))).toEqual(range(expected(n, +t)));
  }
  await expect(d.locator(".garden-reveal-status")).toContainText(
    "0.0 / 8 s · 4 of 1,273 circles · Paused",
  );
  // Play from 0.3 and pause: time moves forward, then holds still.
  await seek(d, "0.3");
  await d.getByRole("button", { name: "Resume reveal" }).click();
  const view = d.locator(".garden-view");
  await expect
    .poll(async () => Number(await view.getAttribute("data-reveal-time")))
    .toBeGreaterThan(0.33);
  await d.getByRole("button", { name: "Pause reveal" }).click();
  const paused = Number(await view.getAttribute("data-reveal-time"));
  expect(paused).toBeGreaterThan(0.3);
  expect(paused).toBeLessThan(1);
  await page.waitForTimeout(300);
  expect(Number(await view.getAttribute("data-reveal-time"))).toBe(paused);
  expect(await drawn(art(d))).toEqual(range(expected(n, paused)));
  // Resume continues from the paused time.
  await d.getByRole("button", { name: "Resume reveal" }).click();
  await expect
    .poll(async () => Number(await view.getAttribute("data-reveal-time")))
    .toBeGreaterThan(paused);
  // Seeking while playing pauses at the time sought, even backward.
  await seek(d, "0.2");
  await expect(d.getByRole("button", { name: "Resume reveal" })).toBeVisible();
  await page.waitForTimeout(300);
  await expect(view).toHaveAttribute("data-reveal-time", "0.2");
  expect(await drawn(art(d))).toEqual(range(expected(n, 0.2)));
  await d.getByRole("button", { name: "Resume reveal" }).click();
  // Stop restores the static drawing.
  await d.getByRole("button", { name: "Stop reveal" }).click();
  await expect(view).not.toHaveAttribute("data-reveal-time", /.*/);
  expect(await drawn(art(d))).toEqual(range(n));
  await expect(slider(d)).toHaveValue("0");
  // A short reveal plays once to its end, restores the static drawing and
  // leaves its slider at the end; playing again starts over.
  await d.getByLabel("Reveal duration", { exact: true }).fill("0.4");
  await d.getByRole("button", { name: "Play reveal" }).click();
  await expect(d.getByRole("button", { name: "Play reveal" })).toBeVisible();
  await expect(view).not.toHaveAttribute("data-reveal-time", /.*/);
  await expect(slider(d)).toHaveValue("1");
  expect(await drawn(art(d))).toEqual(range(n));
});

test("back and forth reverses within the duration, and a loop is refused unless its ends match", async ({
  page,
}) => {
  const d = await openGarden(page);
  const n = await total(d);
  const repeat = d.getByLabel("Repeat", { exact: true });
  await repeat.selectOption("back-and-forth");
  // At time ¾ the motion is halfway back: progress ½.
  await seek(d, "0.75");
  expect(await drawn(art(d))).toEqual(range(expected(n, 0.5)));
  await seek(d, "1");
  expect(await drawn(art(d))).toEqual(range(4));
  // A loop would jump from every circle back to the seeds.
  await repeat.selectOption("loop");
  await expect(repeat).toHaveAttribute("aria-invalid", "true");
  const refusal = d.getByRole("alert").filter({ hasText: "loop only" });
  await expect(refusal).toContainText(
    "Repeat can loop only motion that ends where it starts, but the reveal starts with the 4 seed circles and ends with all 1,273.",
  );
  await expect(
    d.getByRole("button", { name: /reveal$/ }).first(),
  ).toBeDisabled();
  await expect(
    d.getByRole("button", { name: /^Export (MP4 video|animated WebP)/ }),
  ).toBeDisabled();
  // With only the seeds, both ends match, and the loop plays.
  await d.getByRole("button", { name: "Stop reveal" }).click();
  await d.getByLabel("Circle limit", { exact: true }).fill("4");
  await ready(d);
  await expect(refusal).toHaveCount(0);
  await expect(repeat).not.toHaveAttribute("aria-invalid", "true");
  await d.getByRole("button", { name: "Play reveal" }).click();
  await expect(d.getByRole("button", { name: "Pause reveal" })).toBeVisible();
  expect(await drawn(art(d))).toEqual(range(4));
  await d.getByRole("button", { name: "Stop reveal" }).click();
});

test("selection, presentation and camera keep a reveal; cutoff and detail edits end it", async ({
  page,
}) => {
  const d = await openGarden(page);
  const n = await total(d);
  const view = d.locator(".garden-view");
  await seek(d, "0.4");
  const at = range(expected(n, 0.4));
  // Selecting a revealed circle highlights it without changing membership.
  await d.getByLabel("Circle", { exact: true }).fill("10");
  await expect(art(d)).toHaveAttribute("data-selected", "9");
  expect(await drawn(art(d))).toEqual(at);
  await expect(art(d).locator('[data-role="selected"]')).toHaveCount(1);
  // One not yet revealed is selected but not drawn.
  await d.getByLabel("Circle", { exact: true }).fill(String(at.length + 5));
  expect(await drawn(art(d))).toEqual(at);
  await expect(art(d).locator('[data-role="selected"]')).toHaveCount(0);
  await d.getByLabel("Presentation", { exact: true }).selectOption("selected");
  await d.getByLabel("Presentation", { exact: true }).selectOption("complete");
  // The camera moves over the frozen circles, even with detail on.
  await art(d).focus();
  await page.keyboard.press("+");
  await page.keyboard.press("ArrowLeft");
  await expect(view).toHaveAttribute("data-reveal-time", "0.4");
  expect(await drawn(art(d))).toEqual(at);
  // Turning detail on is a generation edit: it ends the reveal.
  await d.getByLabel("Finer circles when zoomed in").check();
  await expect(view).not.toHaveAttribute("data-reveal-time", /.*/);
  await ready(d);
  // So is a cutoff edit, and the edited packing is drawn whole.
  await seek(d, "0.4");
  await d.getByLabel("Depth", { exact: true }).fill("5");
  await expect(view).not.toHaveAttribute("data-reveal-time", /.*/);
  await ready(d);
  const shallow = await total(d);
  expect(shallow).toBeLessThan(n);
  expect(await drawn(art(d))).toEqual(range(shallow));
});

// Every circle drawn, in page units before the pan.
const geometry = (d: Locator) =>
  art(d).evaluate((svg) =>
    Array.from(svg.querySelectorAll("circle"), (c) => ({
      role: c.getAttribute("data-role")!,
      cx: +c.getAttribute("cx")!,
      cy: +c.getAttribute("cy")!,
      r: +c.getAttribute("r")!,
    })),
  );
const summary = (d: Locator) => d.locator(".garden-summary");
// Opens the explained preset's circle (curvature 23) in the whole packing.
async function explained(page: Page) {
  const d = await openGarden(page, "One circle and the three that made it");
  await d.getByLabel("Presentation", { exact: true }).selectOption("complete");
  return d;
}

test("zooming in with detail grows finer circles for the view, keeps the selection, and zooming out restores the packing", async ({
  page,
}) => {
  const d = await explained(page);
  const before = JSON.stringify(await geometry(d));
  // At 1× zoom, detail changes nothing.
  await d.getByLabel("Finer circles when zoomed in").check();
  await ready(d);
  expect(JSON.stringify(await geometry(d))).toBe(before);
  await expect(summary(d)).not.toContainText("Finer circles");
  // Follow the selected curvature-23 circle: the view frames it at zoom
  // 95 / (350/23) = 6.24, level 5, so the cutoff is 0.002 / 2^2.5 and the
  // smallest circles reach 0.002 / 2^2.5 · 350 · 6.24 = 0.77 drawing units.
  await expect(d.locator(".garden-facts")).toContainText("Curvature 23");
  await d.getByLabel("Follow selection").check();
  await expect
    .poll(async () => Number(await art(d).getAttribute("data-zoom")))
    .toBeCloseTo(95 / (350 / 23), 9);
  await ready(d);
  await expect(summary(d)).toContainText(
    "Finer circles for this view reach 0.77 drawing units in radius.",
  );
  const zoomed = await geometry(d);
  const radii = zoomed.filter((c) => c.role === "base").map((c) => c.r);
  const smallest = Math.min(...radii);
  expect(smallest).toBeGreaterThanOrEqual(0.7);
  expect(smallest).toBeLessThan(0.7 * Math.SQRT2);
  // Without detail the smallest at this zoom would be 0.002 · 350 · 6.24.
  expect(smallest).toBeLessThan(0.002 * 350 * 6.2);
  const selected = zoomed.find((c) => c.role === "selected")!;
  expect(selected.r).toBeCloseTo(95, 9);
  expect(zoomed.filter((c) => c.role === "generator")).toHaveLength(3);
  // Pan the circle out of view: it stays selected and explained, with its
  // generators, kept outside the view's window.
  await art(d).focus();
  // Beyond the window too, whose margin reaches up to two cells (here
  // 550 drawing units) past the view.
  for (let i = 0; i < 90; i++) await page.keyboard.press("ArrowRight");
  await ready(d);
  await expect(summary(d)).toContainText(
    "the selected circle and its generators are kept",
  );
  await expect(d.locator(".garden-facts")).toContainText("Curvature 23");
  await expect(
    d.getByRole("group", { name: "Generating circles" }).getByRole("button"),
  ).toHaveCount(3);
  // Turning following off returns to the 1× view: the static packing
  // again, circle for circle.
  await d.getByLabel("Follow selection").uncheck();
  await expect(art(d)).toHaveAttribute("data-zoom", "1");
  await ready(d);
  await expect.poll(async () => JSON.stringify(await geometry(d))).toBe(before);
});

// Delays each garden request's delivery to the worker and records it, so
// zoom gestures overlap pending work. One request runs at a time.
async function instrument(page: Page, delay: number) {
  await page.addInitScript((delay) => {
    const w = window as any;
    w.gardenPosts = [];
    w.gardenRunning = 0;
    w.gardenPeak = 0;
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (q: any, ...rest: any[]) {
      if (q?.action !== "garden") return send.call(this, q, ...rest);
      w.gardenPosts.push(q.garden);
      w.gardenRunning++;
      w.gardenPeak = Math.max(w.gardenPeak, w.gardenRunning);
      const done = (e: MessageEvent) => {
        if (e.data?.id !== q.id) return;
        w.gardenRunning--;
        this.removeEventListener("message", done);
      };
      this.addEventListener("message", done);
      if (w.failWindowed && q.garden.window) {
        // A fatal worker error, as when the engine crashes.
        setTimeout(() => this.onerror?.(new ErrorEvent("error")), delay);
        w.gardenRunning--;
        return;
      }
      setTimeout(() => send.call(this, q, ...rest), delay);
    };
  }, delay);
}

test("rapid zoom gestures keep one request, coalesce the rest, and show only the newest view's packing", async ({
  page,
}) => {
  await instrument(page, 250);
  const d = await openGarden(page);
  await d.getByLabel("Finer circles when zoomed in").check();
  await page.evaluate(() => ((window as any).gardenPosts.length = 0));
  const box = (await art(d).boundingBox())!;
  // Into the gap beside curvature 23, at (0.335, 0.505) in model units.
  await page.mouse.move(
    box.x + ((500 + 0.335 * 350) * box.width) / 1000,
    box.y + ((380 - 0.505 * 350) * box.height) / 760,
  );
  const previous = await art(d).locator("circle").count();
  for (let i = 0; i < 24; i++) {
    await page.mouse.wheel(0, -150);
    await page.waitForTimeout(25);
  }
  // While pending, the last complete drawing stays.
  await expect(art(d)).toHaveAttribute("aria-busy", "true");
  expect(await art(d).locator("circle").count()).toBe(previous);
  await ready(d);
  const posts: any[] = await page.evaluate(() => (window as any).gardenPosts);
  expect(await page.evaluate(() => (window as any).gardenPeak)).toBe(1);
  // 24 wheel steps cross many detail levels; only the first and the newest
  // intents reach the worker, with at most one replaced in between.
  expect(posts.length).toBeLessThanOrEqual(3);
  const zoom = Number(await art(d).getAttribute("data-zoom"));
  const level = Math.floor(2 * Math.log2(zoom));
  expect(level).toBeGreaterThan(6);
  expect(posts.at(-1).minRadius).toBeCloseTo(0.002 / 2 ** (level / 2), 15);
  // The drawn packing answers that newest request: its summary gives the
  // smallest radius on screen at this zoom.
  await expect(summary(d)).toContainText(
    `reach ${((0.002 / 2 ** (level / 2)) * 350 * zoom).toFixed(2)} drawing units`,
  );
  // Zooming back past 1.4× needs no detail: the static packing returns.
  await art(d).focus();
  await page.keyboard.press("Home");
  await ready(d);
  expect(await total(d)).toBe(1273);
});

test("a circle limit or depth truncates deep detail and the summary says why", async ({
  page,
}) => {
  const d = await explained(page);
  await d.getByLabel("Finer circles when zoomed in").check();
  await d.getByLabel("Circle limit", { exact: true }).fill("300");
  await ready(d);
  await d.getByLabel("Follow selection").check();
  await expect
    .poll(async () => Number(await art(d).getAttribute("data-zoom")))
    .toBeGreaterThan(6);
  await ready(d);
  await expect(summary(d)).toContainText(
    "Stopped at the 300-circle limit with",
  );
  expect(await total(d)).toBe(300);
  // At the cusp where the two large seeds touch, depth binds instead.
  await d.getByLabel("Follow selection").uncheck();
  await d.getByLabel("Circle limit", { exact: true }).fill("5000");
  await ready(d);
  await art(d).focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press("+");
  await ready(d);
  await expect(summary(d)).toContainText(
    "Zooming further adds nothing beyond depth 12, the most allowed.",
  );
});

test("a fatal worker error during zoom keeps the last drawing, and the garden recovers", async ({
  page,
}) => {
  await instrument(page, 50);
  const d = await openGarden(page);
  await d.getByLabel("Finer circles when zoomed in").check();
  const before = await art(d).locator("circle").count();
  await page.evaluate(() => ((window as any).failWindowed = true));
  await art(d).focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press("+");
  await expect(d.getByRole("alert")).toContainText("engine");
  expect(await art(d).locator("circle").count()).toBe(before);
  await page.evaluate(() => ((window as any).failWindowed = false));
  await d.getByRole("button", { name: "Try again", exact: true }).click();
  await ready(d);
  await expect(d.getByRole("alert")).toHaveCount(0);
  await expect(summary(d)).toContainText("Finer circles for this view");
});

// Each zoom replaces the shown packing, and each reveal holds only that
// packing; nothing accumulates. The heap after garbage collection is the
// evidence, with a generous bound: the largest packing's arrays are about
// 0.5 MB, and the drawing's elements a few MB.
test("repeated zoom and reveal sessions keep the retained heap bounded", async ({
  page,
}) => {
  const d = await openGarden(page);
  await d.getByLabel("Finer circles when zoomed in").check();
  const cdp = await page.context().newCDPSession(page);
  const heap = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    return (await cdp.send("Runtime.getHeapUsage")).usedSize;
  };
  const cycle = async () => {
    await art(d).focus();
    for (let i = 0; i < 12; i++) await page.keyboard.press("+");
    await ready(d);
    await seek(d, "0.5");
    await d.getByRole("button", { name: "Resume reveal" }).click();
    await page.waitForTimeout(150);
    await d.getByRole("button", { name: "Stop reveal" }).click();
    await art(d).focus();
    await page.keyboard.press("Home");
    await ready(d);
  };
  await cycle();
  const start = await heap();
  for (let i = 0; i < 8; i++) await cycle();
  const end = await heap();
  console.log("Garden retained heap (bytes, Chromium):", { start, end });
  expect(end - start).toBeLessThan(4_000_000);
});

// The live drawing rasterized from its vector markup at a target size.
const raster = (d: Locator, width: number, height: number) =>
  art(d).evaluate(
    async (live, [width, height]) => {
      const svg = live.cloneNode(true) as SVGSVGElement;
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
        c.getContext("2d")!.drawImage(image, 0, 0);
        return Array.from(
          c.getContext("2d")!.getImageData(0, 0, width, height).data,
        );
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    [width, height],
  );
async function saveImage(page: Page, d: Locator, format: "SVG" | "PNG") {
  const download = page.waitForEvent("download");
  await d.getByRole("button", { name: "Export image" }).click();
  await page.getByRole("menuitem", { name: new RegExp(format) }).click();
  return (await download).path();
}
async function exportMovie(
  page: Page,
  d: Locator,
  format: "mp4" | "webp",
  scale: string,
) {
  const settings = d.locator("#garden-export-settings");
  if (!(await settings.evaluate((e) => (e as HTMLDetailsElement).open)))
    await settings.locator("summary").click();
  await d.getByLabel("Export format", { exact: true }).selectOption(format);
  await d.getByRole("slider", { name: "Export resolution" }).fill(scale);
  await d.getByLabel("Export frame rate", { exact: true }).selectOption("15");
  const download = page.waitForEvent("download");
  await d
    .getByRole("button", { name: /^Export (MP4 video|animated WebP)/ })
    .click();
  const path = (await (await download).path())!;
  return { path, bytes: await readFile(path) };
}

test("the SVG still and decoded movie frames show the drawing's circles at each time", async ({
  page,
}) => {
  const d = await openGarden(page);
  const n = await total(d);
  // 1.4 s at 15 fps is 21 frames at times i/20, which the slider's
  // 0.001 steps reach exactly.
  await d.getByLabel("Reveal duration", { exact: true }).fill("1.4");
  // A paused frame's still is that frame: the same circles, recorded.
  await seek(d, "0.5");
  const live = await drawn(art(d));
  expect(live).toEqual(range(expected(n, 0.5)));
  const text = await readFile((await saveImage(page, d, "SVG"))!, "utf8");
  const still = await page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    return {
      record: JSON.parse(doc.querySelector("svg > desc")!.textContent!),
      circles: Array.from(doc.querySelectorAll("circle"), (c) =>
        Number(c.getAttribute("data-circle")),
      ).sort((a, b) => a - b),
    };
  }, text);
  expect(still.circles).toEqual(live);
  expect(still.record.reveal).toMatchObject({
    duration: 1.4,
    repeat: "once",
    total: n,
    time: 0.5,
    shown: live.length,
  });
  // References at the times of frames 0, 6, 10, 14 and 20, and at
  // neighboring times for contrast.
  const references = new Map<number, number[]>();
  for (const t of [0, 0.3, 0.4, 0.5, 0.6, 0.7, 1]) {
    await seek(d, String(t));
    references.set(t, await raster(d, 500, 380));
  }
  await d.getByRole("button", { name: "Stop reveal" }).click();
  const mp4 = await exportMovie(page, d, "mp4", "0.5");
  expect(mp4.bytes.includes(Buffer.from('"kind":"apollonian-garden"'))).toBe(
    true,
  );
  const timing = probe(mp4.path);
  if (timing) {
    expect([timing.width, timing.height, timing.frames]).toEqual([
      500, 380, 21,
    ]);
    expect(timing.durations.reduce((a, b) => a + b, 0)).toBe(1400);
  }
  expect((await decodeVideo(page, mp4.bytes)).duration).toBeCloseTo(1.4, 3);
  const compare = (frame: number, t: number) =>
    frameDifference(mp4.path, 500, 380, frame, references.get(t)!);
  for (const [frame, t] of [
    [0, 0],
    [6, 0.3],
    [10, 0.5],
    [14, 0.7],
    [20, 1],
  ] as const) {
    const same = compare(frame, t);
    if (!same) continue;
    expect(same.meanDifference).toBeLessThan(2);
    expect(same.unmatchedInk).toBeLessThan(0.02);
  }
  // A frame matches its own time's circles better than its neighbors'.
  const own = compare(10, 0.5);
  if (own) {
    for (const t of [0.4, 0.6])
      expect(compare(10, t)!.unmatchedInk).toBeGreaterThan(
        own.unmatchedInk + 0.02,
      );
  }
  // Animated WebP at twice the page: frames drawn from vectors at that
  // size, matching the drawing rasterized there, not an enlarged raster.
  // The paused frame at the end stays on screen to rasterize.
  await d.getByLabel("Reveal duration", { exact: true }).fill("0.2");
  await seek(d, "1");
  const webp = await exportMovie(page, d, "webp", "2");
  const decoded = await art(d).evaluate(
    async (live, { input }) => {
      const svg = live.cloneNode(true) as SVGSVGElement;
      svg.setAttribute("width", "2000");
      svg.setAttribute("height", "1520");
      const url = URL.createObjectURL(
        new Blob([new XMLSerializer().serializeToString(svg)], {
          type: "image/svg+xml",
        }),
      );
      const vector = new Image();
      vector.src = url;
      await vector.decode();
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = 2000;
      canvas.height = 1520;
      const draw = canvas.getContext("2d", { willReadFrequently: true })!;
      draw.drawImage(vector, 0, 0);
      const reference = draw.getImageData(0, 0, 2000, 1520).data;
      const decoder = new (window as any).ImageDecoder({
        data: new Uint8Array(input),
        type: "image/webp",
      });
      await decoder.tracks.ready;
      const count = decoder.tracks.selectedTrack.frameCount;
      let duration = 0,
        difference = 0,
        size: number[] = [];
      for (let i = 0; i < count; i++) {
        const { image } = await decoder.decode({ frameIndex: i });
        duration += image.duration;
        if (i === count - 1) {
          size = [image.displayWidth, image.displayHeight];
          const c = document.createElement("canvas");
          c.width = size[0];
          c.height = size[1];
          const ctx = c.getContext("2d")!;
          ctx.drawImage(image, 0, 0);
          const px = ctx.getImageData(0, 0, size[0], size[1]).data;
          for (let k = 0; k < px.length; k += 4)
            for (let j = 0; j < 3; j++)
              difference += Math.abs(px[k + j] - reference[k + j]);
          difference /= size[0] * size[1] * 3;
        }
        image.close();
      }
      decoder.close();
      return { count, duration, size, difference };
    },
    { input: Array.from(webp.bytes) },
  );
  expect(decoded.count).toBe(3);
  expect(decoded.duration).toBe(200000);
  expect(decoded.size).toEqual([2000, 1520]);
  expect(decoded.difference).toBeLessThan(2);
});

test("the finer-circles preset opens zoomed with detail and plays its reveal over the frozen view", async ({
  page,
}) => {
  await instrument(page, 0);
  const d = await openGarden(page, "Finer circles in one gap");
  await expect(d.getByLabel("Finer circles when zoomed in")).toBeChecked();
  await expect(art(d)).toHaveAttribute("data-zoom", "24");
  await expect(summary(d)).toContainText(
    "Finer circles for this view reach 0.74 drawing units in radius.",
  );
  const n = await total(d);
  const [last] = (await page.evaluate(
    () => (window as any).gardenPosts,
  )) as any[];
  expect(last.minRadius).toBeCloseTo(0.002 / 2 ** 4.5, 15);
  expect(last.window).toBeTruthy();
  // The reveal plays the view's packing; zooming while it plays moves the
  // camera over the same circles and asks for nothing.
  const posts = await page.evaluate(() => (window as any).gardenPosts.length);
  await d.getByRole("button", { name: "Play reveal" }).click();
  await art(d).focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("+");
  await d.getByRole("button", { name: "Pause reveal" }).click();
  const time = Number(
    await d.locator(".garden-view").getAttribute("data-reveal-time"),
  );
  expect(await drawn(art(d))).toEqual(range(expected(n, time)));
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as any).gardenPosts.length)).toBe(
    posts,
  );
  // Stopping refines for the zoomed view.
  await d.getByRole("button", { name: "Stop reveal" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).gardenPosts.length))
    .toBe(posts + 1);
  await ready(d);
});

// Observations, not benchmarks: worker preparation and round trips for the
// largest admitted detail request, a dense frame's redraw and teardown,
// playback frames drawn in two seconds of headless Chromium, and how soon a
// canceled export stops. The assertions are the enforced limits and that a
// canceled export saves nothing.
test("garden reveal and detail production measurements stay within their limits", async ({
  page,
}) => {
  await instrument(page, 0);
  await page.addInitScript(() => {
    const w = window as any;
    w.gardenReplies = [];
    const Native = Worker;
    window.Worker = class extends Native {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        this.addEventListener("message", (e) => {
          const r = e.data?.result;
          // The client restores the lifted arrays after this listener.
          if (r?.seed)
            setTimeout(() =>
              w.gardenReplies.push({
                circles: r.curvature.length,
                processed: r.processed,
                view: r.omitted.view,
                prepare: e.data.timings?.prepare,
                bytes: e.data.timings?.bytes,
              }),
            );
        });
      }
    } as typeof Worker;
  });
  const d = await openGarden(page, "Finer circles in one gap");
  // The most an admitted detail request can do: the circle limit at the
  // smallest cutoff, zoomed to the limit.
  await d.getByLabel("Minimum radius", { exact: true }).fill("1e-9");
  await ready(d);
  // Twice as close about the drawing's center, by the wheel.
  const box = (await art(d).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -693);
  await ready(d);
  expect(await total(d)).toBe(5000);
  const time = (fn: () => Promise<unknown>) =>
    page
      .evaluate(() => performance.now())
      .then(async (start) => {
        await fn();
        return (await page.evaluate(() => performance.now())) - start;
      });
  const paint = () =>
    page.evaluate(
      () =>
        new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done)),
        ),
    );
  // A dense frame: every circle, from a sparse frame, and back.
  await seek(d, "0.3");
  const dense = await time(async () => {
    await seek(d, "1");
    await paint();
  });
  const teardown = await time(async () => {
    await d.getByRole("button", { name: "Stop reveal" }).click();
    await expect(d.locator(".garden-view")).not.toHaveAttribute(
      "data-reveal-time",
      /.*/,
    );
    await paint();
  });
  // Frames drawn while the 5,000-circle reveal plays for two seconds.
  const frames = await d.locator(".garden-view").evaluate(async (view) => {
    let n = 0;
    const seen = new MutationObserver(() => n++);
    seen.observe(view, {
      attributes: true,
      attributeFilter: ["data-reveal-time"],
    });
    (
      document.querySelector(
        ".garden .animation-buttons button",
      ) as HTMLButtonElement
    ).click();
    await new Promise((r) => setTimeout(r, 2000));
    seen.disconnect();
    return n;
  });
  await d.getByRole("button", { name: "Stop reveal" }).click();
  // Cancel a large export a second in; nothing is saved.
  let saved = false;
  page.on("download", () => (saved = true));
  const settings = d.locator("#garden-export-settings");
  await settings.locator("summary").click();
  await d.getByRole("slider", { name: "Export resolution" }).fill("2");
  await d
    .getByRole("button", { name: /^Export (MP4 video|animated WebP)/ })
    .click();
  await expect(d.getByText(/Exporting .*%/)).toBeVisible();
  await page.waitForTimeout(1000);
  const cancel = await time(async () => {
    await d.getByRole("button", { name: "Cancel export" }).click();
    await expect(d.getByText(/Exporting .*%/)).toHaveCount(0);
  });
  await page.waitForTimeout(500);
  expect(saved).toBe(false);
  const replies: any[] = await page.evaluate(
    () => (window as any).gardenReplies,
  );
  expect(replies.length).toBeGreaterThanOrEqual(3);
  for (const r of replies) {
    expect(r.circles).toBeLessThanOrEqual(5000);
    expect(r.processed).toBeLessThanOrEqual(20000);
  }
  expect(await page.evaluate(() => (window as any).gardenPeak)).toBe(1);
  console.log(
    "Garden reveal and detail measurements (milliseconds, bytes; headless Chromium on local Mac):",
    JSON.stringify({
      replies,
      dense,
      teardown,
      playbackFramesIn2s: frames,
      cancel,
    }),
  );
});
