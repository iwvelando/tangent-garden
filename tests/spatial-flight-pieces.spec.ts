import { test, expect } from "@playwright/test";
import {
  flightPieces,
  pathError,
  pathView,
  pieceAt,
  pieceViews,
  type CameraPath,
  type KeyView,
} from "../web/spatial/path";
import { refinementView } from "../web/spatial/scene";
import type { Bounds3, RefinementView, Vec3 } from "../web/spatial/types";

// A 3D flight refined in pieces: each a stretch of progress whose zoomed-in
// frames are refined once, to a few of its frames' own views (Go refines
// each piece of curve as finely as the finest of those it meets). Each
// frame's needs are read from the drawing's own refinementView, and checked
// here against the engine's documented rule (engine3.View), not against the
// pieces' code.
const bounds: Bounds3 = { center: { x: 1, y: -0.5, z: 0.25 }, radius: 3 };
const size = { width: 1000, height: 760 };
const key = (k: Partial<KeyView>): KeyView => ({
  name: "",
  yaw: 0.3,
  pitch: 0.75,
  zoom: 1,
  panX: 0,
  panY: 0,
  turns: 0,
  ...k,
});
const path = (
  keys: KeyView[],
  style: CameraPath["style"] = "steady",
): CameraPath => ({ style, keys });

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a: Vec3, b: Vec3) => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});
const cross = (a: Vec3, b: Vec3) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
// engine3.View's rule: a point's page coordinates scaled by w, and w; the
// tolerance a view refines it to (2 × 10⁻⁴ of its half diagonal, times w
// but at least the near distance's), and whether it lies within the
// view's margin, ahead of its near distance.
function onPage(v: RefinementView, p: Vec3) {
  const d = sub(p, v.center),
    forward = cross(v.up, v.right);
  const w = v.distance ? 1 + dot(forward, d) / v.distance : 1;
  return { x: dot(v.right, d) / v.width, y: dot(v.up, d) / v.height, w };
}
const tolerance = (v: RefinementView, p: Vec3) => {
  const { w } = onPage(v, p);
  const nearest = v.distance ? v.near! / v.distance : 0;
  return 2e-4 * Math.hypot(v.width, v.height) * Math.max(w, nearest);
};
const inMargin = (v: RefinementView, p: Vec3) => {
  const { x, y, w } = onPage(v, p);
  const nearest = v.distance ? v.near! / v.distance : 0;
  return (
    Math.abs(x) <= 2 * w &&
    Math.abs(y) <= 2 * w &&
    (!v.distance || w >= nearest)
  );
};
// Points a frame draws: across its page (middle, edges, corners) at a few
// depths about its own plane (w of a half to twice its own in a
// perspective; anywhere in the study's depth, within its radius of the
// plane through its center, in an orthographic view, which draws all of it).
function drawn(v: RefinementView): Vec3[] {
  const forward = cross(v.up, v.right),
    out: Vec3[] = [];
  const depths = v.distance
    ? [0.5, 1, 2].map((w) => (w - 1) * v.distance!)
    : [-1, -0.5, 0, 0.5, 1]
        .map((d) => d * bounds.radius)
        .concat([-v.width / 2, v.width / 2]);
  for (const z of depths) {
    const w = v.distance ? 1 + z / v.distance : 1;
    for (const x of [-1, 0, 1])
      for (const y of [-1, 0, 1])
        out.push({
          x:
            v.center.x +
            x * v.width * w * v.right.x +
            y * v.height * w * v.up.x +
            z * forward.x,
          y:
            v.center.y +
            x * v.width * w * v.right.y +
            y * v.height * w * v.up.y +
            z * forward.y,
          z:
            v.center.z +
            x * v.width * w * v.right.z +
            y * v.height * w * v.up.z +
            z * forward.z,
        });
  }
  return out;
}

for (const [name, p, lens, most, depths] of [
  [
    "orthographic, into a detail",
    path([key({}), key({ zoom: 800, panX: 1.2, panY: -0.7 })]),
    {},
    24,
  ],
  [
    "orthographic, turning at depth",
    path([key({ zoom: 200 }), key({ zoom: 200, yaw: 2.3, pitch: -0.4 })]),
    {},
    // Turning at 200× sweeps the study's far depths across the page.
    40,
  ],
  [
    "perspective, smooth there and back",
    path(
      [key({}), key({ zoom: 400, panX: -0.8, yaw: 1 }), key({ zoom: 0.5 })],
      "smooth",
    ),
    { projection: "normal" as const },
    48,
  ],
  [
    "orthographic, a long pan at one zoom",
    path([
      key({ zoom: 50, panX: -1, panY: 0.2 }),
      key({ zoom: 50, panX: 1, panY: -0.4 }),
    ]),
    {},
    24,
  ],
  [
    "through a lens, about geometry off the center plane",
    path([key({}), key({ zoom: 100, panX: 0.6, yaw: 0.8 })], "smooth"),
    { projection: "wide" as const },
    48,
    [0, 0.02],
  ],
] as const) {
  test(`${name}: every zoomed frame is refined at least as finely as it shows`, () => {
    const pieces = flightPieces(
      p,
      bounds,
      false,
      size,
      depths as number[] | undefined,
      lens,
    );
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.length).toBeLessThanOrEqual(most);
    for (let k = 1; k < pieces.length; k++)
      expect(pieces[k].from).toBeGreaterThanOrEqual(pieces[k - 1].to);
    for (const piece of pieces) {
      expect(piece.views.length).toBeGreaterThan(0);
      expect(piece.views.length).toBeLessThanOrEqual(pieceViews);
    }
    // Every frame, sampled more finely than the pieces were cut: each point
    // it draws is in the margin of a view of its piece whose tolerance
    // there is at most a little coarser than the frame's own.
    let worst = 0,
      zoomed = 0;
    for (let k = 0; k <= 4000; k++) {
      const s = k / 4000,
        view = pathView(
          p,
          bounds,
          s,
          false,
          depths as number[] | undefined,
          lens,
        );
      if (!(view.zoom > 1)) continue;
      zoomed++;
      const own = refinementView(view, size),
        piece = pieces[pieceAt(pieces, s)];
      for (const point of drawn(own)) {
        const best = Math.min(
          ...piece.views
            .filter((g) => inMargin(g, point))
            .map((g) => tolerance(g, point)),
        );
        worst = Math.max(worst, best / tolerance(own, point));
      }
    }
    expect(zoomed).toBeGreaterThan(100);
    expect(worst).toBeLessThanOrEqual(1.1);
    // Each piece spans a zoom of at most 2×.
    const zooms = new Map<number, number[]>();
    for (let k = 0; k <= 4000; k++) {
      const s = k / 4000,
        view = pathView(
          p,
          bounds,
          s,
          false,
          depths as number[] | undefined,
          lens,
        );
      if (!(view.zoom > 1)) continue;
      const i = pieceAt(pieces, s);
      if (pieces[i].to === s && i + 1 < pieces.length) continue;
      zooms.set(i, [...(zooms.get(i) ?? []), view.zoom]);
    }
    for (const z of zooms.values())
      expect(Math.max(...z) / Math.min(...z)).toBeLessThanOrEqual(2.05);
  });
}

// Frames at the fitted zoom or wider need no piece.
test("a flight that never zooms in has no pieces", () => {
  const p = path([key({ zoom: 0.5 }), key({ zoom: 1, yaw: 2 })]);
  expect(flightPieces(p, bounds, false, size)).toEqual([]);
});

// Key views zoom as far as the drawing does: 8×, or 1,000× in a study
// refined to its view.
test("key views zoom to the drawing's limit", () => {
  const deep = path([key({}), key({ zoom: 500 })]);
  expect(pathError(deep, 1000)).toBeNull();
  expect(pathError(deep, 8)?.message).toMatch(/refine the study to its view/);
  expect(pathError(path([key({}), key({ zoom: 1001 })]), 1000)).not.toBeNull();
  expect(pathError(path([key({}), key({ zoom: 8 })]), 8)).toBeNull();
});
