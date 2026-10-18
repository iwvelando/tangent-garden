import { test, expect } from "@playwright/test";
import {
  asFirst,
  flightPieces,
  pieceAt,
  keyCamera,
  keyFromViewport,
  planarPathError,
  planarPathView,
  type Fit,
  type PlanarKeyView,
  type PlanarPath,
} from "../web/planar-path";
import { keyTimes, moveKeys, pathLeg, removeKeys } from "../web/key-views";

// The 2D camera path (planar-path.ts): the camera at each progress, observed
// as the page position Plot draws a point at, W/2 + (p − c)·scale across.

const fit: Fit = { cx: 0.25, cy: -0.5, scale: 90, span: 9 };
const key = (x: number, y: number, zoom: number, leg?: number) =>
  ({
    name: "",
    x,
    y,
    zoom,
    ...(leg !== undefined && { leg }),
  }) as PlanarKeyView;
const path = (
  keys: PlanarKeyView[],
  style: "steady" | "smooth" = "steady",
): PlanarPath => ({ style, keys });
// Where the drawing puts a point of the plane, relative to the page's
// middle, in page units.
const onPage = (
  v: { cx: number; cy: number; scale: number },
  p: { x: number; y: number },
) => ({ x: (p.x - v.cx) * v.scale, y: -(p.y - v.cy) * v.scale });

test("eased planar flights settle a pan before zooming, keeping key times and their route", () => {
  for (const style of ["steady", "smooth"] as const) {
    const p = {
      ...path([key(0, 0, 1), key(2, 1, 1, 0.5), key(2, 1, 8, 3)], style),
      ease: true,
    };
    const time = keyTimes(p)[1];
    const at = (t: number) => onPage(planarPathView(p, fit, t), { x: 3, y: 2 });
    for (const side of [-1, 1]) {
      const h = side * 1e-4;
      const a = at(time),
        b = at(time + h),
        c = at(time + h / 2);
      const full = Math.hypot(b.x - a.x, b.y - a.y),
        half = Math.hypot(c.x - a.x, c.y - a.y);
      expect(half).toBeLessThan(full * 0.2 + 1e-10);
    }
    keyTimes(p).forEach((t, k) => {
      const v = planarPathView(p, fit, t);
      expect(v).toEqual({
        cx: p.keys[k].x,
        cy: p.keys[k].y,
        scale: fit.scale * p.keys[k].zoom,
        span: fit.span / p.keys[k].zoom,
      });
    });
    const early = planarPathView(p, fit, time / 4);
    expect(early.cx).toBeLessThan(0.5);
    expect(early.cy / early.cx).toBeCloseTo(0.5, 12);
  }
});

test("a path stands exactly at each view at its time, in both styles", () => {
  const keys = [key(0.25, -0.5, 1), key(3.9, 0, 800, 3), key(-1, 2, 4, 0.5)];
  for (const style of ["steady", "smooth"] as const) {
    const times = keyTimes(path(keys, style));
    expect(times).toEqual([0, 3 / 3.5, 1]);
    times.forEach((t, k) =>
      expect(planarPathView(path(keys, style), fit, t)).toEqual({
        cx: keys[k].x,
        cy: keys[k].y,
        scale: fit.scale * keys[k].zoom,
        span: fit.span / keys[k].zoom,
      }),
    );
  }
  expect(pathLeg(path(keys), 0.2)).toBe("View 1 → View 2");
  expect(pathLeg(path(keys), 3 / 3.5)).toBe("View 2");
});

test("a key view is the drawing's manual camera and the view it shows", () => {
  const k = key(3.958, 0.001, 812.5);
  const camera = keyCamera(k, fit);
  const scale = fit.scale * camera.zoom;
  // As Plot reports the view its manual camera shows.
  const shown = {
    cx: fit.cx - camera.x / scale,
    cy: fit.cy + camera.y / scale,
    scale,
    span: fit.span / camera.zoom,
  };
  const back = keyFromViewport(shown, fit);
  expect(back.zoom).toBe(k.zoom);
  expect(Math.abs(back.x - k.x)).toBeLessThan(1e-12);
  expect(Math.abs(back.y - k.y)).toBeLessThan(1e-12);
});

test("steady zooms by equal factors in equal times, and the framed place comes straight to the middle", () => {
  const a = key(0, 0, 1),
    b = key(3.9, 0.4, 800);
  const p = path([a, b]);
  let last = Infinity;
  for (let k = 0; k <= 100; k++) {
    const v = planarPathView(p, fit, k / 100);
    // ln zoom linear in progress.
    expect(Math.log(v.scale / fit.scale)).toBeCloseTo(
      (Math.log(800) * k) / 100,
      9,
    );
    // The place framed at the end lies on the line from where it starts
    // through the middle of the page, and only approaches the middle.
    const at = onPage(v, b),
      start = onPage(planarPathView(p, fit, 0), b);
    const cross = at.x * start.y - at.y * start.x;
    expect(Math.abs(cross)).toBeLessThan(
      1e-9 * Math.hypot(start.x, start.y) ** 2,
    );
    const r = Math.hypot(at.x, at.y);
    expect(r).toBeLessThanOrEqual(last + 1e-9);
    last = r;
  }
  expect(last).toBe(0);
  // Every point of the page moves on a straight line through one fixed
  // point while a leg zooms: three points' page paths are lines that meet.
  // The point (z₁p₁ − z₀p₀)/(z₁ − z₀) of the plane stays where it is on the
  // page, and every other point moves on a straight line.
  const fixed = {
    x: (800 * 3.9 - 0) / (800 - 1),
    y: (800 * 0.4 - 0) / (800 - 1),
  };
  const still = onPage(planarPathView(p, fit, 0), fixed);
  for (const s of [0.2, 0.5, 0.9]) {
    const q = onPage(planarPathView(p, fit, s), fixed);
    expect(Math.hypot(q.x - still.x, q.y - still.y)).toBeLessThan(1e-6);
  }
  for (const pt of [
    { x: 1, y: 2 },
    { x: -3, y: 0.5 },
  ]) {
    const q0 = onPage(planarPathView(p, fit, 0), pt),
      q1 = onPage(planarPathView(p, fit, 0.3), pt),
      q2 = onPage(planarPathView(p, fit, 0.7), pt);
    const cross = (q1.x - q0.x) * (q2.y - q0.y) - (q1.y - q0.y) * (q2.x - q0.x);
    expect(Math.abs(cross)).toBeLessThan(
      1e-9 * Math.hypot(q2.x - q0.x, q2.y - q0.y) ** 2,
    );
  }
});

test("a leg that keeps its zoom pans at a steady rate", () => {
  const p = path([key(0, 0, 5), key(2, -1, 5)]);
  const v = planarPathView(p, fit, 0.25);
  expect(v.cx).toBeCloseTo(0.5, 12);
  expect(v.cy).toBeCloseTo(-0.25, 12);
  expect(v.scale).toBe(fit.scale * 5);
});

test("smooth passes through a view at one rate and never zooms beyond a leg's views", () => {
  const keys = [key(0, 0, 1), key(1, 0, 10), key(2, 0, 400, 2)];
  const steady = path(keys),
    smooth = path(keys, "smooth");
  const t = keyTimes(smooth)[1],
    e = 1e-6;
  const lz = (q: PlanarPath, s: number) =>
    Math.log(planarPathView(q, fit, s).scale / fit.scale);
  const rate = (q: PlanarPath, s: number) => (lz(q, s + e) - lz(q, s)) / e;
  const before = rate(smooth, t - e),
    after = rate(smooth, t);
  expect(Math.abs(before - after) / Math.abs(after)).toBeLessThan(1e-3);
  expect(
    Math.abs(rate(steady, t - e) - rate(steady, t)) / rate(steady, t),
  ).toBeGreaterThan(0.1);
  for (let k = 0; k <= 400; k++) {
    const s = k / 400,
      z = lz(smooth, s);
    const [lo, hi] = s <= t ? [0, Math.log(10)] : [Math.log(10), Math.log(400)];
    expect(z).toBeGreaterThanOrEqual(lo - 1e-12);
    expect(z).toBeLessThanOrEqual(hi + 1e-12);
  }
  // A view where the zoom turns back is a rest.
  const peak = path([key(0, 0, 1), key(0, 0, 50), key(0, 0, 2)], "smooth");
  const tp = keyTimes(peak)[1];
  expect(Math.abs(lz(peak, tp + e) - lz(peak, tp)) / e).toBeLessThan(1e-3);
});

test("moving or removing a view keeps its leg, unless it becomes the first", () => {
  const keys = [key(0, 0, 1), key(1, 0, 2, 3), key(2, 0, 3, 0.5)];
  expect(moveKeys(keys, 0, 2, asFirst)).toEqual([
    key(1, 0, 2),
    key(2, 0, 3, 0.5),
    key(0, 0, 1),
  ]);
  expect(removeKeys(keys, 0, asFirst)).toEqual([
    key(1, 0, 2),
    key(2, 0, 3, 0.5),
  ]);
});

test("a path refuses what it cannot fly, naming the view", () => {
  const ok = [key(0, 0, 1), key(1, 0, 15)];
  expect(planarPathError(path(ok), 20)).toBeNull();
  expect(planarPathError(path([ok[0]]), 20)?.field).toBe("Key views");
  expect(planarPathError(path([ok[0], key(1, 0, 800)]), 20)).toEqual({
    field: "View 2",
    message: "zooms past 20×; refine the study to its view to zoom further.",
  });
  expect(planarPathError(path([ok[0], key(1, 0, 800)]), 1000)).toBeNull();
  expect(planarPathError(path([ok[0], key(1, 0, 1001)]), 1000)?.field).toBe(
    "View 2",
  );
  expect(planarPathError(path([ok[0], key(NaN, 0, 2)]), 20)?.field).toBe(
    "View 2",
  );
  expect(planarPathError(path([key(0, 0, 1, 2), ok[1]]), 20)?.field).toBe(
    "View 1 leg time",
  );
  expect(planarPathError(path([ok[0], key(1, 0, 2, 11)]), 20)?.field).toBe(
    "View 2 leg time",
  );
  expect(
    planarPathError(path([{ ...ok[0], name: "x".repeat(61) }, ok[1]]), 20)
      ?.field,
  ).toBe("View 1 name");
});

// A flight is refined in pieces: each a stretch of progress over which the
// zoom changes by at most 2× and the view drifts little, refined once to
// the area its frames show, as finely as its deepest frame.
test("a flight's pieces cover every zoomed frame with its area, as finely as it needs", async () => {
  const W = 1000,
    H = 760;
  const rect = (v: { cx: number; cy: number; scale: number }) => ({
    x0: v.cx - W / 2 / v.scale,
    x1: v.cx + W / 2 / v.scale,
    y0: v.cy - H / 2 / v.scale,
    y1: v.cy + H / 2 / v.scale,
  });
  const half = (r: ReturnType<typeof rect>) =>
    Math.hypot(r.x1 - r.x0, r.y1 - r.y0) / 2;
  for (const [name, p, most] of [
    ["into a point", path([key(0, 0, 1), key(3.9585, 0, 800)]), 16],
    [
      "smooth there and back",
      path([key(0, 0, 1), key(3.9585, 0, 800), key(0, 0, 0.5)], "smooth"),
      24,
    ],
    ["a long pan at one zoom", path([key(-3, 0, 50), key(3, 1, 50)]), 400],
  ] as const) {
    const pieces = flightPieces(p, fit, false, rect);
    expect(pieces.length, name).toBeGreaterThan(1);
    expect(pieces.length, name).toBeLessThanOrEqual(most);
    for (let k = 1; k < pieces.length; k++)
      expect(pieces[k].from, name).toBeGreaterThanOrEqual(pieces[k - 1].to);
    // The worst of every frame, sampled more finely than the pieces were
    // cut: how far its rectangle reaches past its piece's area grown by
    // half (as Go grows it), as a share of that growth; how much finer than
    // it needs its piece is refined, and how much coarser (above 1 is too
    // coarse); and each piece's span of zoom.
    let reach = 0,
      finer = 1,
      coarser = 0;
    const zooms = new Map<number, [number, number]>();
    for (let k = 0; k <= 5000; k++) {
      const s = k / 5000,
        v = planarPathView(p, fit, s);
      if (v.scale <= fit.scale) continue;
      const i = pieceAt(pieces, s),
        area = pieces[i].view,
        own = rect(v);
      const mx = (area.x1 - area.x0) / 2,
        my = (area.y1 - area.y0) / 2;
      reach = Math.max(
        reach,
        (area.x0 - own.x0) / mx - 1,
        (own.x1 - area.x1) / mx - 1,
        (area.y0 - own.y0) / my - 1,
        (own.y1 - area.y1) / my - 1,
      );
      finer = Math.min(finer, area.radius / half(own));
      coarser = Math.max(coarser, area.radius / half(own));
      const seen = zooms.get(i) ?? [Infinity, 0];
      zooms.set(i, [Math.min(seen[0], v.scale), Math.max(seen[1], v.scale)]);
    }
    expect(reach, name).toBeLessThanOrEqual(0);
    expect(coarser, name).toBeLessThanOrEqual(1 + 1e-12);
    expect(finer, name).toBeGreaterThanOrEqual(1 / 2.05);
    for (const [low, high] of zooms.values())
      expect(high / low, name).toBeLessThanOrEqual(2.05);
  }
});
