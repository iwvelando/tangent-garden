import { createHash } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  defaultPath,
  framedDepths,
  keyFromView,
  keyTimes,
  legRange,
  maxKeys,
  moveKey,
  pathError,
  pathLeg,
  pathView,
  removeKey,
  type CameraPath,
  type KeyView,
} from "../web/spatial/path";
import { animationCamera, type AnimationView } from "../web/spatial/animation";
import {
  buildScene,
  camera,
  clip,
  defaultLayers,
  page,
  project,
  projectionRecord,
  scenePasses,
  type Pass,
  type View,
} from "../web/spatial/scene";
import { linework } from "../web/spatial/linework";
import { curveMesh } from "./curve-mesh";
import { spatialPresets } from "../web/spatial/presets";
import type { CutSpec } from "../web/spatial/cut";
import type { Bounds3, SpatialResult, Vec3 } from "../web/spatial/types";

// The camera path's mathematics, observed through the drawing's own
// projection (scene.ts), never through a second copy of the path's
// formulas.
const bounds: Bounds3 = { center: { x: 1, y: -0.5, z: 0.25 }, radius: 3 };
const size = { width: 1000, height: 800 };
const key = (k: Partial<KeyView>): KeyView => ({
  name: "",
  yaw: 0,
  pitch: 0,
  zoom: 1,
  panX: 0,
  panY: 0,
  turns: 0,
  ...k,
});
const path = (keys: KeyView[], style: CameraPath["style"] = "steady") => ({
  style,
  keys,
});
// A few points around the study, near and far from its center.
const points: Vec3[] = [
  { x: 1, y: -0.5, z: 0.25 },
  { x: 3.5, y: 0.2, z: -1 },
  { x: -1.2, y: 2, z: 1.7 },
  { x: 0.4, y: -2.6, z: -2.2 },
];
const pages = (view: View) => {
  const k = camera(view, size);
  return points.map((p) => project(k, p));
};
// The largest distance in pixels (or depth) between two drawings of the
// points.
function apart(a: View, b: View, depth = true) {
  const pa = pages(a),
    pb = pages(b);
  return Math.max(
    ...pa.map((p, i) =>
      Math.max(
        Math.abs(p.x - pb[i].x),
        Math.abs(p.y - pb[i].y),
        depth ? Math.abs(p.depth - pb[i].depth) * size.width : 0,
      ),
    ),
  );
}
const manual = (k: KeyView): View => ({
  ...bounds,
  yaw: k.yaw,
  pitch: k.pitch,
  zoom: k.zoom,
  panX: k.panX,
  panY: k.panY,
});
const tour = [
  key({ name: "Start", yaw: 0.3, pitch: 0.75 }),
  key({ name: "Side", yaw: 1.9, pitch: -0.2, zoom: 2.5, panX: 0.4 }),
  key({ name: "Close", yaw: -2.8, pitch: 1.2, zoom: 6, panY: -0.7, turns: 1 }),
  key({ name: "Back", yaw: 0.3, pitch: 0.75, turns: -2 }),
];

test("eased key-view transitions settle both velocity and acceleration at every view", () => {
  for (const name of [
    "A rhumb line spiraling into its pole",
    "Viviani's curve, from every side",
  ]) {
    const original = spatialPresets.find((p) => p.name === name)!.flight!.path;
    for (const style of ["steady", "smooth"] as const) {
      const p = { ...original, style, ease: true };
      const times = keyTimes(p);
      for (const cyclic of [false, true]) {
        for (const lens of [{}, { projection: "normal" as const }]) {
          for (const depths of [undefined, p.keys.map(() => 0.05)]) {
            const at = (t: number) =>
              pages(pathView(p, bounds, t, cyclic, depths, lens)).flatMap(
                (v) => [v.x, v.y, v.depth],
              );
            times.forEach((t, k) => {
              expect(pathView(p, bounds, t, cyclic, depths, lens)).toEqual({
                ...manual(p.keys[k]),
                ...lens,
              });
              for (const side of [-1, 1]) {
                if (
                  (k === 0 && side < 0) ||
                  (k === times.length - 1 && side > 0)
                )
                  continue;
                const leg = side < 0 ? t - times[k - 1] : times[k + 1] - t;
                const rates = (fraction: number) => {
                  const h = leg * fraction * side,
                    a = at(t),
                    b = at(t + h),
                    c = at(t + 2 * h);
                  return [
                    Math.max(
                      ...a.map((v, i) => Math.abs(b[i] - v) / Math.abs(h)),
                    ),
                    Math.max(
                      ...a.map(
                        (v, i) => Math.abs(c[i] - 2 * b[i] + v) / (h * h),
                      ),
                    ),
                  ];
                };
                const full = rates(0.001),
                  half = rates(0.0005);
                // A settled join has O(h²) velocity and O(h) acceleration
                // estimates. Halving h distinguishes it from a hard stop
                // or ordinary cubic easing, even at the loop seam.
                expect(
                  half[0],
                  `${name}, view ${k}, side ${side}`,
                ).toBeLessThan(full[0] * 0.35 + 1e-5);
                expect(
                  half[1],
                  `${name}, view ${k}, side ${side}`,
                ).toBeLessThan(full[1] * 0.65 + 0.1);
              }
            });
          }
        }
      }
    }
  }
});

test("key-view easing keeps the existing route and is opt-in, including a two-view turn", () => {
  const p = path([tour[0], { ...tour[0], turns: 1 }]);
  // Independent orbit identity protects the original two-view flight.
  for (const f of [0, 0.125, 0.5, 0.875, 1]) {
    const plain = pathView(p, bounds, f);
    expect(
      apart(plain, { ...manual(tour[0]), yaw: tour[0].yaw + 2 * Math.PI * f }),
    ).toBeLessThan(1e-9);
    expect(pathView({ ...p, ease: false } as CameraPath, bounds, f)).toEqual(
      plain,
    );
  }
  const eased = { ...p, ease: true };
  // The same route, with a slower departure and unchanged midpoint/end.
  expect(pathView(eased, bounds, 0.125).yaw).toBeLessThan(
    pathView(p, bounds, 0.125).yaw,
  );
  for (const f of [0, 0.5, 1])
    expect(pathView(eased, bounds, f)).toEqual(pathView(p, bounds, f));
});

test("spatial easing factor keeps legacy paths, key times and pivots, and strengthens settling without a hold", () => {
  for (const style of ["steady", "smooth"] as const) {
    const original = {
      ...path(tour, style),
      keys: tour.map((k, i) => ({ ...k, leg: i ? [0, 0.5, 3, 1][i] : 1 })),
    };
    for (const cyclic of [false, true])
      for (const depths of [undefined, tour.map(() => 0.05)])
        for (const lens of [{}, { projection: "normal" as const }]) {
          const at = (p: CameraPath, t: number) =>
            pathView(p, bounds, t, cyclic, depths, lens);
          for (const easingFactor of [0, 0.25, 0.5, 0.75, 1]) {
            const eased = { ...original, ease: true, easingFactor };
            keyTimes(eased).forEach((t) =>
              expect(at(eased, t)).toEqual(at(original, t)),
            );
            for (let k = 0; k <= 40; k++) {
              const t = k / 40;
              if (easingFactor === 0)
                expect(at(eased, t)).toEqual(at(original, t));
              if (easingFactor === 0.5)
                expect(at(eased, t)).toEqual(
                  at({ ...original, ease: true }, t),
                );
              expect(at({ ...eased, ease: false }, t)).toEqual(at(original, t));
            }
          }
        }
    const two = path([key({}), key({ turns: 1 })], style);
    const q5 = 53 / 512,
      q9 = 6413 / 131072;
    for (const [easingFactor, fraction] of [
      [0, 0.25],
      [0.25, (0.25 + q5) / 2],
      [0.5, q5],
      [0.6, 0.8 * q5 + 0.2 * q9],
      [0.75, (q5 + q9) / 2],
      [1, q9],
    ])
      expect(
        pathView({ ...two, ease: true, easingFactor }, bounds, 0.25).yaw,
      ).toBeCloseTo(2 * Math.PI * fraction, 12);
    let previous = 0;
    for (let k = 1; k < 100; k++) {
      const yaw = pathView(
        { ...two, ease: true, easingFactor: 1 },
        bounds,
        k / 100,
      ).yaw;
      expect(yaw).toBeGreaterThan(previous);
      expect(yaw).toBeLessThan(2 * Math.PI);
      previous = yaw;
    }
  }
});

test("spatial easing factor validation names the field", () => {
  const p = path(tour);
  for (const ease of [true, false]) {
    for (const easingFactor of [-0.01, 1.01, NaN, Infinity])
      expect(pathError({ ...p, ease, easingFactor })).toEqual({
        field: "Easing factor",
        message: "must be from 0 to 1.",
      });
    for (const easingFactor of [undefined, 0, 0.5, 1])
      expect(pathError({ ...p, ease, easingFactor })).toBeNull();
  }
});

test("the camera stands exactly at each key view at its share of the duration, in either style", () => {
  for (const style of ["steady", "smooth"] as const) {
    const p = path(tour, style);
    tour.forEach((k, i) =>
      expect(pathView(p, bounds, i / (tour.length - 1))).toEqual(manual(k)),
    );
    // Progress outside the timeline holds the ends.
    expect(pathView(p, bounds, -0.5)).toEqual(manual(tour[0]));
    expect(pathView(p, bounds, 1.5)).toEqual(manual(tour[3]));
  }
});

test("a full turn between two equal unpanned views is the orbit animation", () => {
  // Unpanned, the middle of the page is the study's center, which the orbit
  // turns about too. A panned view differs by design: the orbit keeps the
  // pan on the page, the path turns about the framed point (below).
  const held = key({ yaw: 0.7, pitch: 0.4, zoom: 1.7 });
  const p = path([held, { ...held, turns: 1 }]);
  for (let i = 0; i <= 40; i++) {
    const progress = i / 40;
    const orbit = animationCamera({
      mode: "orbit",
      camera: "current",
      heldView: manual(held),
      progress,
    } as AnimationView);
    expect(apart(pathView(p, bounds, progress), orbit)).toBeLessThan(1e-9);
  }
});

test("each leg turns the shorter way unless turns are added, and a half turn goes the negative way", () => {
  const yaw = (p: CameraPath, at: number) => pathView(p, bounds, at).yaw;
  // 0.1 to −0.1 (entered as −0.1 + 6π) passes 0, not π.
  const across = [key({ yaw: 0.1 }), key({ yaw: -0.1 + 6 * Math.PI })];
  expect(Math.cos(yaw(path(across), 0.5))).toBeCloseTo(1, 12);
  // One added turn goes the long way, in the direction the orbit turns;
  // minus one the other way.
  const longer = (turns: number) => path([across[0], { ...across[1], turns }]);
  expect(Math.sin(yaw(longer(1), 0.25))).toBeCloseTo(
    Math.sin(0.05 + Math.PI / 2),
    12,
  );
  expect(Math.cos(yaw(longer(1), 0.5))).toBeCloseTo(-1, 12);
  expect(Math.sin(yaw(longer(-1), 0.25))).toBeCloseTo(
    Math.sin(0.05 - Math.PI / 2),
    12,
  );
  // Exactly half a turn: the negative way, or the positive way with one
  // more turn.
  const half = [key({ yaw: 0 }), key({ yaw: Math.PI })];
  expect(Math.sin(yaw(path(half), 0.5))).toBeCloseTo(-1, 12);
  expect(
    Math.sin(yaw(path([half[0], { ...half[1], turns: 1 }]), 0.5)),
  ).toBeCloseTo(1, 12);
  // A turn's yaw keeps increasing; it never jumps back by a whole turn.
  const turning = path([key({ yaw: 3 }), key({ yaw: 3, turns: 2 })]);
  let last = yaw(turning, 0.001);
  for (let i = 2; i < 1000; i++) {
    const next = yaw(turning, i / 1000);
    expect(next - last).toBeGreaterThan(0);
    expect(next - last).toBeLessThan(0.02);
    last = next;
  }
});

test("the drawing moves continuously through every view, in either style", () => {
  for (const style of ["steady", "smooth"] as const) {
    const p = path(tour, style);
    for (let i = 0; i < 3000; i++) {
      const a = pathView(p, bounds, i / 3000),
        b = pathView(p, bounds, (i + 1) / 3000);
      // A 1/3000 step of a path whose fastest leg turns 2 1/2 times and
      // zooms by 6 moves no point more than a few pixels.
      expect(apart(a, b)).toBeLessThan(25);
    }
  }
});

test("smooth passes through each view without stopping or overshooting it; with two views it is steady", () => {
  const tilt = [
    key({ pitch: 0, zoom: 1 }),
    key({ pitch: 0.6, zoom: 2 }),
    key({ pitch: 0.9, zoom: 6 }),
    key({ pitch: -0.4, zoom: 0.5 }),
  ];
  const smooth = path(tilt, "smooth"),
    steady = path(tilt, "steady");
  const pitch = (p: CameraPath, at: number) => pathView(p, bounds, at).pitch;
  // Slopes either side of the second view, in pitch per unit progress.
  const h = 1e-6,
    at = 1 / 3;
  const slope = (p: CameraPath, side: 1 | -1) =>
    (side * (pitch(p, at + side * h) - pitch(p, at))) / h;
  expect(Math.abs(slope(smooth, 1) - slope(smooth, -1))).toBeLessThan(1e-3);
  expect(slope(smooth, 1)).toBeGreaterThan(0);
  expect(Math.abs(slope(steady, 1) - slope(steady, -1))).toBeGreaterThan(0.5);
  // The third view is the highest: smooth stops there rather than rising
  // past it, and no leg leaves the range of its two views.
  for (let i = 0; i <= 3000; i++) {
    const p = i / 3000,
      leg = Math.min(2, Math.floor(p * 3));
    const v = pathView(smooth, bounds, p);
    const [a, b] = [tilt[leg], tilt[leg + 1]];
    expect(v.pitch).toBeGreaterThanOrEqual(Math.min(a.pitch, b.pitch) - 1e-15);
    expect(v.pitch).toBeLessThanOrEqual(Math.max(a.pitch, b.pitch) + 1e-15);
    expect(v.zoom).toBeGreaterThanOrEqual(
      Math.min(a.zoom, b.zoom) * (1 - 1e-12),
    );
    expect(v.zoom).toBeLessThanOrEqual(Math.max(a.zoom, b.zoom) * (1 + 1e-12));
  }
  const peak = 2 / 3;
  expect(
    Math.abs(pitch(smooth, peak + h) - pitch(smooth, peak)) / h,
  ).toBeLessThan(1e-3);
  // Two views: one leg, the same either way.
  for (let i = 0; i <= 20; i++)
    expect(
      apart(
        pathView(path(tilt.slice(1, 3), "smooth"), bounds, i / 20),
        pathView(path(tilt.slice(1, 3), "steady"), bounds, i / 20),
      ),
    ).toBeLessThan(1e-9);
});

test("zooming into a framed point carries it straight to the middle of the page", () => {
  // The second view zooms 8 times onto a point off the center, panned to
  // the middle of the page. With the same orientation, every point keeps
  // to a straight line through one fixed point of the page; the framed
  // point moves steadily inward, never out of view first.
  const target: Vec3 = { x: 3.4, y: 0.9, z: 0.25 };
  const start = key({ yaw: 0, pitch: 0 }),
    view0 = manual(start);
  const k0 = camera(view0, size);
  const shown = project(k0, target);
  // Pan the target to the middle at the second view: its offset from the
  // middle in world units at zoom 1.
  const unit = (bounds.radius * 1.16 * 2) / Math.min(size.width, size.height);
  const close = key({
    zoom: 8,
    panX: -(shown.x - size.width / 2) * unit,
    panY: (shown.y - size.height / 2) * unit,
  });
  const middle = project(camera(manual(close), size), target);
  expect(middle.x).toBeCloseTo(size.width / 2, 9);
  expect(middle.y).toBeCloseTo(size.height / 2, 9);
  for (const style of ["steady", "smooth"] as const) {
    const p = path([start, close], style);
    let last = Infinity;
    for (let i = 0; i <= 200; i++) {
      const at = project(camera(pathView(p, bounds, i / 200), size), target);
      const dx = at.x - size.width / 2,
        dy = at.y - size.height / 2;
      const distance = Math.hypot(dx, dy);
      expect(distance).toBeLessThanOrEqual(last + 1e-9);
      // On the line from where it started to the middle.
      expect(
        Math.abs(
          dx * (shown.y - size.height / 2) - dy * (shown.x - size.width / 2),
        ) / Math.hypot(shown.x - size.width / 2, shown.y - size.height / 2),
      ).toBeLessThan(1e-6);
      last = distance;
    }
  }
});

test("a turn about a framed point keeps it in the middle of the page", () => {
  // The camera turns about the point at the middle of the page on the
  // plane through the study's center facing the camera. A point on that
  // plane, panned to the middle, stays there through the whole turn.
  const node: Vec3 = { x: 2.6, y: -0.5, z: 0.25 };
  const base = key({ yaw: 0, pitch: 0.4, zoom: 4 });
  const k = camera(manual(base), size);
  const at = project(k, node);
  const unit =
    (bounds.radius * 1.16 * 2) / (Math.min(size.width, size.height) * 4);
  const framed = {
    ...base,
    panX: -(at.x - size.width / 2) * unit,
    panY: (at.y - size.height / 2) * unit,
  };
  const p = path([framed, { ...framed, turns: 1 }], "smooth");
  for (let i = 0; i <= 64; i++) {
    const v = pathView(p, bounds, i / 64);
    const q = project(camera(v, size), node);
    expect(q.x).toBeCloseTo(size.width / 2, 6);
    expect(q.y).toBeCloseTo(size.height / 2, 6);
    // The study's own center keeps the depth range.
    expect(v.center).toEqual(bounds.center);
    expect(v.radius).toBe(bounds.radius);
  }
});

// Geometry as the drawing draws it: positions with a normal and a phase.
const vertexData = (ps: Vec3[]) =>
  new Float32Array(ps.flatMap((q) => [q.x, q.y, q.z, 0, 0, 1, 0]));
const linesPass = (ps: Vec3[], layer: Pass["layer"] = "base"): Pass => ({
  layer,
  sheet: false,
  batch: { mode: "lines", data: vertexData(ps), ink: 0 },
});
const sheetPass = (ps: Vec3[]): Pass => ({
  layer: "surface",
  sheet: true,
  batch: { mode: "triangles", data: vertexData(ps), ink: 0 },
});
// A view panned so that a point is drawn in the middle of the page.
function framing(base: KeyView, node: Vec3): KeyView {
  const at = project(camera(manual(base), size), node);
  const unit =
    (bounds.radius * 1.16 * 2) /
    (Math.min(size.width, size.height) * base.zoom);
  return {
    ...base,
    panX: -(at.x - size.width / 2) * unit,
    panY: (at.y - size.height / 2) * unit,
  };
}
const off = (q: Vec3, d: number[]): Vec3 => ({
  x: q.x + d[0],
  y: q.y + d[1],
  z: q.z + d[2],
});
const lineScene = (points: Vec3[]) =>
  buildScene({
    base: points,
    minus: [],
    plus: [],
    breaks: points.map(() => false),
    mesh: curveMesh(),
    rulings: [],
    bounds,
    radius: 1,
    omitted: 0,
    invalid: 0,
  } as SpatialResult);

test("turning about the geometry keeps an off-plane detail in the middle of the page, orthographic or through a lens", () => {
  // A detail far in front of the plane through the study's center, framed
  // in the middle: turning about the plane carries it away, turning about
  // the geometry holds it there all the way round.
  const node: Vec3 = { x: 2.2, y: 0.4, z: 1.9 };
  const detail = linesPass([
    off(node, [-0.03, -0.02, 0.01]),
    off(node, [0.03, 0.02, -0.01]),
  ]);
  for (const projection of [undefined, "normal", "chosen"] as const) {
    const lens = projection
      ? { projection, ...(projection === "chosen" && { lensAngle: 20 }) }
      : {};
    const lensed = (v: View): View => ({ ...v, ...lens });
    // Panned to the middle orthographically, the node is on the line of
    // sight through the middle, which a lens looks along too.
    const framed = framing(key({ yaw: 0.2, pitch: 0.4, zoom: 4 }), node);
    const start = project(camera(lensed(manual(framed)), size), node);
    expect(Math.abs(start.x - size.width / 2)).toBeLessThan(1e-6);
    expect(Math.abs(start.y - size.height / 2)).toBeLessThan(1e-6);
    for (const style of ["steady", "smooth"] as const) {
      const plane = path([framed, { ...framed, turns: 1 }], style);
      const geometry = { ...plane, pivot: "geometry" as const };
      const depths = framedDepths(geometry, [detail], bounds, lens);
      expect(depths[0]).toBeGreaterThan(1);
      expect(depths[1]).toBe(depths[0]);
      // Through a wide lens this close, the eye stands in front of the
      // detail, which is not drawn: the view turns about the plane.
      expect(
        framedDepths(geometry, [detail], bounds, {
          projection: "chosen",
          lensAngle: 120,
        }),
      ).toEqual([0, 0]);
      // The plane pivot keeps depths of 0.
      expect(framedDepths(plane, [detail], bounds, lens)).toEqual([0, 0]);
      let drift = 0;
      for (let i = 0; i <= 64; i++) {
        const view = animationCamera({
          mode: "path",
          camera: "hold",
          frame: { result: { bounds } },
          final: { result: { bounds } },
          path: geometry,
          around: bounds,
          depths,
          heldView: lensed(manual(framed)),
          progress: i / 64,
        } as unknown as AnimationView);
        expect(view.projection).toBe(projection);
        expect(view.lensAngle).toBe(projection === "chosen" ? 20 : undefined);
        const c = clip(camera(view, size), node.x, node.y, node.z);
        expect(c[3]).toBeGreaterThan(0);
        expect(Math.abs(c[2])).toBeLessThanOrEqual(c[3]);
        const drawn = linework(
          lineScene([
            off(node, [-0.03, -0.02, 0.01]),
            off(node, [0.03, 0.02, -0.01]),
          ]),
          view,
          defaultLayers,
          false,
          { ...size, occlusion: "none" },
        );
        expect(
          drawn.find((g) => g.layer === "base")?.strokes.flatMap((s) => s.paths)
            .length ?? 0,
        ).toBeGreaterThan(0);
        const held = project(camera(view, size), node);
        // Within the single precision the drawing stores the detail in.
        expect(Math.abs(held.x - size.width / 2)).toBeLessThan(1e-2);
        expect(Math.abs(held.y - size.height / 2)).toBeLessThan(1e-2);
        const loose = project(
          camera(lensed(pathView(plane, bounds, i / 64)), size),
          node,
        );
        drift = Math.max(
          drift,
          Math.hypot(loose.x - size.width / 2, loose.y - size.height / 2),
        );
      }
      // About the plane the detail leaves the middle by hundreds of pixels.
      expect(drift).toBeGreaterThan(200);
    }
  }
});

test("geometry pivots use visible cut-line remnants within reach", () => {
  const at = (x: number, z = 1) => ({
    x: bounds.center.x + x,
    y: bounds.center.y,
    z: bounds.center.z + z,
  });
  const scene = lineScene([at(-0.2, 0.8), at(0.2, 1.2)]);
  const p = {
    ...path([key({}), key({ turns: 1 })]),
    pivot: "geometry" as const,
  };
  const cut: CutSpec = {
    plane: { normal: { x: -1, y: 0, z: 0 }, offset: -bounds.center.x - 0.02 },
    scope: "all",
    edge: false,
  };
  const drawn = linework(
    scene,
    manual(p.keys[0]),
    defaultLayers,
    false,
    { width: 1000, height: 1000, occlusion: "none" },
    [],
    cut,
  );
  const paths = drawn
    .find((g) => g.layer === "base")!
    .strokes.flatMap((s) => s.paths);
  expect(paths[0][0][0] - 500).toBeGreaterThan(0);
  expect(paths[0][0][0] - 500).toBeLessThan(25);
  const depths = framedDepths(
    p,
    scenePasses(scene, defaultLayers),
    bounds,
    {},
    cut,
  );
  expect(depths[0]).toBeCloseTo(1.02, 5);
  expect(depths[1]).toBe(depths[0]);
  expect(
    framedDepths(
      p,
      scenePasses(scene, defaultLayers),
      bounds,
      {},
      {
        ...cut,
        plane: { ...cut.plane, offset: -bounds.center.x - 0.3 },
      },
    ),
  ).toEqual([0, 0]);
});

test("geometry pivots choose the nearest visible depth of sight-parallel lines in either vertex order", () => {
  const p = {
    ...path([key({}), key({ turns: 1 })]),
    pivot: "geometry" as const,
  };
  const lens = { projection: "normal" as const };
  for (const zs of [
    [-2, 2],
    [2, -2],
  ]) {
    const scene = lineScene(
      zs.map((z) => ({
        x: bounds.center.x + 0.1,
        y: bounds.center.y,
        z: bounds.center.z + z,
      })),
    );
    const drawn = linework(
      scene,
      { ...manual(p.keys[0]), ...lens },
      defaultLayers,
      false,
      { width: 1000, height: 1000, occlusion: "none" },
    );
    const points = drawn.find((g) => g.layer === "base")!.strokes[0].paths[0];
    expect(Math.abs(points[1][0] - points[0][0])).toBeGreaterThan(1);
    for (const [x, y] of points)
      expect(Math.hypot(x - 500, y - 500)).toBeLessThan(25);
    expect(
      framedDepths(p, scenePasses(scene, defaultLayers), bounds, lens),
    ).toEqual([2, 2]);
  }
});

test("geometry pivots clip lines at every cut plane and the camera before finding their closest point", () => {
  const p = {
    ...path([key({}), key({ turns: 1 })]),
    pivot: "geometry" as const,
  };
  const at = (x: number, z: number) => off(bounds.center, [x, 0, z]);
  const keptRight = {
    normal: { x: -1, y: 0, z: 0 },
    offset: -bounds.center.x - 0.02,
  };
  for (const reversed of [false, true]) {
    const endpoints = [at(-0.2, 0), at(0.2, 2)];
    if (reversed) endpoints.reverse();
    const pass = linesPass(endpoints);
    // A box keeps [.02,.12]; a notch removes [-.02,.02]. Both frame the
    // point at x=.02 and depth 1.1, whichever endpoint comes first.
    for (const beyond of ["any", "every"] as const) {
      const cut: CutSpec = {
        plane: keptRight,
        others: [
          {
            normal: { x: 1, y: 0, z: 0 },
            offset: bounds.center.x + (beyond === "any" ? 0.12 : -0.02),
          },
        ],
        beyond,
        scope: "all",
        edge: false,
      };
      const depths = framedDepths(p, [pass], bounds, {}, cut);
      expect(depths[0]).toBeCloseTo(1.1, 5);
      expect(depths[1]).toBe(depths[0]);
      expect(
        framedDepths(p, [pass], bounds, {}, { ...cut, scope: "sheets" })[0],
      ).toBeCloseTo(1, 5);
    }
    // The closest point on the uncut line is past the far clip plane, but
    // its visible remnant starts inside reach, exactly at depth -12.
    const far = [at(-0.01, -13), at(0.1, -11)];
    if (reversed) far.reverse();
    expect(framedDepths(p, [linesPass(far)], bounds)[0]).toBeCloseTo(-12, 5);
    // Through a lens, the closest point is behind the eye. The kept part
    // meets the near plane on the line of sight, so it still supplies a pivot.
    const distance = (1.16 * bounds.radius) / Math.tan((25 * Math.PI) / 180);
    const near = [at(0, distance + 1), at(0, distance - 1)];
    if (reversed) near.reverse();
    expect(
      framedDepths(p, [linesPass(near)], bounds, { projection: "normal" })[0],
    ).toBeCloseTo(distance * 0.99, 5);
  }
});

test("a sight-parallel line's nearest eligible depth stops at the reach boundary", () => {
  const p = {
    ...path([key({}), key({ turns: 1 })]),
    pivot: "geometry" as const,
  };
  const lens = { projection: "normal" as const };
  for (const zs of [
    [-2, 5],
    [5, -2],
  ]) {
    const pass = linesPass(zs.map((z) => off(bounds.center, [0.1, 0, z])));
    const [s] = framedDepths(p, [pass], bounds, lens);
    // Independent pinhole: x/(d-s)/tan(25°) = .05 at the reach boundary.
    const tan = Math.tan((25 * Math.PI) / 180);
    expect(s).toBeCloseTo((1.16 * bounds.radius) / tan - 0.1 / (0.05 * tan), 5);
    const q = project(
      camera({ ...manual(p.keys[0]), ...lens }, size),
      off(bounds.center, [0.1, 0, s]),
    );
    expect(q.x - size.width / 2).toBeCloseTo((0.05 * size.height) / 2, 4);
  }
});

test("perspective geometry paths preserve key cameras, interpolate positive eye distances and convert captured views", () => {
  const lens = { projection: "normal" as const };
  const keys = [
    key({ yaw: 0.2, pitch: 0.4, zoom: 4, panX: -0.7, panY: -0.4 }),
    key({ yaw: 1.2, pitch: -0.2, zoom: 2, panX: 0.5, panY: 0.1, leg: 0.5 }),
    key({ yaw: 2, pitch: 0.3, zoom: 3, panX: -0.2, panY: 0.3, leg: 3 }),
  ];
  const depths = [1.5, 0, 0.8];
  const scale = (1.16 * bounds.radius) / Math.tan((25 * Math.PI) / 180);
  const distances = keys.map((k, i) => scale / k.zoom - depths[i]);
  for (const style of ["steady", "smooth"] as const) {
    const p = { ...path(keys, style), pivot: "geometry" as const };
    const times = keyTimes(p);
    times.forEach((t, k) =>
      expect(pathView(p, bounds, t, false, depths, lens)).toEqual({
        ...manual(keys[k]),
        ...lens,
      }),
    );
    // A zero-depth path, and all old center-plane studies, stay bit-identical
    // through the lens, including their clip range and stroke reference.
    for (let i = 0; i <= 100; i++) {
      const progress = i / 100;
      expect(pathView(p, bounds, progress, false, [0, 0, 0], lens)).toEqual({
        ...pathView(p, bounds, progress),
        ...lens,
      });
      const v = pathView(p, bounds, progress, false, depths, lens);
      const leg = progress < times[1] ? 0 : 1;
      const distance =
        v.framedTarget?.distance ??
        distances[progress === 0 ? 0 : progress === 1 ? 2 : 1];
      expect(distance).toBeGreaterThan(0);
      expect(distance).toBeGreaterThanOrEqual(
        Math.min(distances[leg], distances[leg + 1]) - 1e-12,
      );
      expect(distance).toBeLessThanOrEqual(
        Math.max(distances[leg], distances[leg + 1]) + 1e-12,
      );
      const captured = keyFromView(v, bounds, "Captured");
      // These views all convert within the manual camera's zoom bounds.
      for (const point of points) {
        const a = project(camera(v, size), point);
        const b = project(
          camera({ ...manual(captured), ...lens }, size),
          point,
        );
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-6);
      }
    }
    if (style === "steady") {
      const v = pathView(p, bounds, times[1] / 2, false, depths, lens);
      expect(v.framedTarget!.distance).toBeCloseTo(
        Math.sqrt(distances[0] * distances[1]),
        12,
      );
      expect(projectionRecord(v)).toEqual({
        name: "normal",
        statement:
          "A pinhole perspective, 50° across the page's shorter side, with the eye at the recorded positive distance behind the framed geometry point; zoom sets the reference distance for strokes that taper with depth.",
      });
    }
    // The physical camera and taper reference meet each exact key from both
    // sides, even though the key itself has no transient target.
    times.forEach((t, k) => {
      const exact = camera({ ...manual(keys[k]), ...lens }, size);
      for (const dt of [-1e-9, 1e-9]) {
        const v = pathView(
          p,
          bounds,
          Math.max(0, Math.min(1, t + dt)),
          false,
          depths,
          lens,
        );
        const near = camera(v, size);
        expect(near.focus).toBeCloseTo(exact.focus, 6);
        for (const point of points) {
          const a = project(near, point),
            b = project(exact, point);
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.001);
          expect(Math.abs(a.depth - b.depth)).toBeLessThan(1e-6);
        }
      }
    });
  }
});

test("the framed point is the geometry nearest the viewer in the middle of a view, a sheet it crosses, or the plane", () => {
  const base = key({ yaw: -0.7, pitch: 0.3, zoom: 2, panX: 0.3, panY: -0.2 });
  const [r, u, b] = [
    [Math.cos(base.yaw), 0, Math.sin(base.yaw)],
    [
      Math.sin(base.pitch) * Math.sin(base.yaw),
      Math.cos(base.pitch),
      -Math.sin(base.pitch) * Math.cos(base.yaw),
    ],
    [
      -Math.cos(base.pitch) * Math.sin(base.yaw),
      Math.sin(base.pitch),
      Math.cos(base.pitch) * Math.cos(base.yaw),
    ],
  ];
  // The framed point on the plane, and a point at depth s along the line
  // of sight, offset across it.
  const on = off(bounds.center, [
    -base.panX * r[0] - base.panY * u[0],
    -base.panX * r[1] - base.panY * u[1],
    -base.panX * r[2] - base.panY * u[2],
  ]);
  const at = (s: number, x = 0, y = 0) =>
    off(
      on,
      [0, 1, 2].map((i) => s * b[i] + x * r[i] + y * u[i]),
    );
  const p = { ...path([base, key({ yaw: 1 })]), pivot: "geometry" as const };
  const one = (passes: Pass[], cut: CutSpec | null = null) =>
    framedDepths(p, passes, bounds, {}, cut)[0];
  // Half the page's shorter side, in world units at this zoom.
  const half = (bounds.radius * 1.16) / base.zoom;
  // A line crossing the line of sight across the page, at depth 1.3.
  const across = linesPass([at(1.3, -1, 0.2), at(1.3, 1, -0.2)]);
  expect(one([across])).toBeCloseTo(1.3, 5);
  // Of two lines, the one nearer the viewer; a line tilted in depth is met
  // where it passes the middle.
  const behind = linesPass([at(-2, 0, -1), at(-2, 0, 1)]);
  const tilted = linesPass([at(0.2, -1, 0), at(2.2, 1, 0)]);
  expect(one([behind, across])).toBeCloseTo(1.3, 5);
  expect(one([behind, tilted])).toBeCloseTo(1.2, 5);
  // A line within reach of the middle counts at its nearest point; one
  // just beyond reach does not.
  const near = (x: number) => linesPass([at(0.9, x, -1), at(0.9, x, 1)]);
  expect(one([near(0.04 * half)])).toBeCloseTo(0.9, 5);
  expect(one([near(0.06 * half)])).toBe(0);
  // A sheet the line of sight crosses, at the crossing, however far from
  // the middle its corners are; a sheet beside it does not count.
  const sheet = sheetPass([at(-0.5, -2, -2), at(1.5, 2, -2), at(0.5, 0, 3)]);
  // Its corners, across and along the line of sight, span the plane
  // s = 0.5 + x/2, met at the middle at 0.5.
  expect(one([sheet])).toBeCloseTo(0.5, 5);
  // A sheet beside it does not count, whichever corner comes first.
  const corners = [at(1, 0.5, -1), at(1, 2, -1), at(1, 1, 1)];
  for (let k = 0; k < 3; k++)
    expect(one([sheetPass([0, 1, 2].map((j) => corners[(j + k) % 3]))])).toBe(
      0,
    );
  // Nothing in the middle: the plane.
  expect(one([])).toBe(0);
  // Geometry beyond the view's clip volume (four radii past the center)
  // is not drawn, so does not count.
  expect(one([linesPass([at(-11, -1, 0), at(-11, 1, 0)])])).toBeCloseTo(-11, 5);
  expect(one([linesPass([at(-13, -1, 0), at(-13, 1, 0)])])).toBe(0);
  // The cut hides the nearer line, so the farther one is framed; a cut that
  // reaches only sheets leaves it.
  const cut: CutSpec = {
    plane: {
      normal: { x: b[0], y: b[1], z: b[2] },
      offset: b[0] * on.x + b[1] * on.y + b[2] * on.z,
    },
    scope: "all",
    edge: false,
  };
  expect(one([behind, across], cut)).toBeCloseTo(-2, 5);
  expect(one([behind, across], { ...cut, scope: "sheets" })).toBeCloseTo(
    1.3,
    5,
  );
});

test("a sheet's framed point is where the line of sight crosses it", () => {
  // A level square sheet through y = 0.7, seen from above at a tilt: the
  // line of sight through the middle meets it where y = 0.7.
  const view = key({ yaw: 0.4, pitch: 1.1, zoom: 1.5, panX: 0.2, panY: 0.1 });
  const y = 0.7,
    w = 6;
  const corners = [
    { x: -w, y, z: -w },
    { x: w, y, z: -w },
    { x: w, y, z: w },
    { x: -w, y, z: w },
  ];
  const sheet = sheetPass([
    corners[0],
    corners[1],
    corners[2],
    corners[0],
    corners[2],
    corners[3],
  ]);
  const p = { ...path([view, key({ yaw: 1 })]), pivot: "geometry" as const };
  const [s] = framedDepths(p, [sheet], bounds);
  // The framed point at that depth lies on the sheet and is drawn in the
  // middle of the page.
  const k = camera(manual(view), size);
  const b = [
      -Math.cos(view.pitch) * Math.sin(view.yaw),
      Math.sin(view.pitch),
      Math.cos(view.pitch) * Math.cos(view.yaw),
    ],
    r = [Math.cos(view.yaw), 0, Math.sin(view.yaw)],
    u = [
      Math.sin(view.pitch) * Math.sin(view.yaw),
      Math.cos(view.pitch),
      -Math.sin(view.pitch) * Math.cos(view.yaw),
    ];
  const framed = off(
    bounds.center,
    [0, 1, 2].map((i) => -view.panX * r[i] - view.panY * u[i] + s * b[i]),
  );
  // Within the drawing's single precision.
  expect(framed.y).toBeCloseTo(y, 6);
  const q = project(k, framed);
  expect(q.x).toBeCloseTo(size.width / 2, 6);
  expect(q.y).toBeCloseTo(size.height / 2, 6);
});

test("framed depths of 0 fly exactly as the plane does, and every view stands where it was", () => {
  for (const style of ["steady", "smooth"] as const) {
    const p = path(tour, style);
    for (let i = 0; i <= 200; i++) {
      const progress = i / 200;
      expect(pathView(p, bounds, progress, false, [0, 0, 0, 0])).toEqual(
        pathView(p, bounds, progress),
      );
      expect(pathView(p, bounds, progress, true, [0, 0, 0, 0])).toEqual(
        pathView(p, bounds, progress, true),
      );
    }
    // Whatever their depths, the views themselves are unchanged: only the
    // legs between them turn about other points.
    const depths = [0.8, -1.1, 2.4, 0.3];
    keyTimes(p).forEach((t, k) =>
      expect(pathView(p, bounds, t, false, depths)).toEqual(manual(tour[k])),
    );
  }
});

test("a path flown with framed depths carries them to the animation camera", () => {
  const p = { ...path(tour, "smooth"), pivot: "geometry" as const };
  const depths = [0.8, -1.1, 2.4, 0.3];
  const frame = { result: { bounds } };
  for (let i = 0; i <= 20; i++) {
    const view = animationCamera({
      mode: "path",
      camera: "hold",
      frame,
      final: frame,
      path: p,
      around: bounds,
      depths,
      progress: i / 20,
    } as unknown as AnimationView);
    expect(view).toEqual(pathView(p, bounds, i / 20, false, depths));
  }
});

test("a view becomes a key that draws the same, whatever bounds it was drawn about", () => {
  const view = {
    ...bounds,
    yaw: 2.2,
    pitch: -0.7,
    zoom: 3,
    panX: 0.5,
    panY: 1,
  };
  // About the study's own bounds, the view is copied as it is.
  expect(keyFromView(view, bounds, "Here")).toEqual({
    name: "Here",
    yaw: 2.2,
    pitch: -0.7,
    zoom: 3,
    panX: 0.5,
    panY: 1,
    turns: 0,
  });
  // A finished animation's camera about other bounds draws every point
  // where it did.
  const other: View = {
    center: { x: -2, y: 1, z: 3 },
    radius: 5,
    yaw: 0.9,
    pitch: 0.3,
    zoom: 2,
    panX: -0.4,
    panY: 0.6,
  };
  expect(
    apart(manual(keyFromView(other, bounds, "")), other, false),
  ).toBeLessThan(1e-9);
});

test("a path names what keeps it from playing", () => {
  expect(defaultPath).toEqual({ style: "steady", keys: [] });
  expect(pathError(defaultPath)).toEqual({
    field: "Key views",
    message: "need at least two views to fly between.",
  });
  expect(pathError(path([tour[0]]))?.field).toBe("Key views");
  expect(pathError(path(tour))).toBeNull();
  expect(
    pathError(path(Array.from({ length: maxKeys + 1 }, () => key({})))),
  ).toEqual({
    field: "Key views",
    message: `hold at most ${maxKeys} views.`,
  });
  const turns = (t: number) =>
    pathError(path([tour[0], tour[1], { ...tour[2], turns: t }]));
  expect(turns(1.5)).toEqual({
    field: "View 3 turns",
    message: "must be a whole number from −8 to 8.",
  });
  expect(turns(9)?.field).toBe("View 3 turns");
  expect(turns(-8)).toBeNull();
  expect(turns(Number.NaN)?.field).toBe("View 3 turns");
});

test("the readout names the views a leg flies between, or the view it stands at", () => {
  const p = path(tour);
  expect(pathLeg(p, 0)).toBe("Start");
  expect(pathLeg(p, 0.2)).toBe("Start → Side");
  expect(pathLeg(p, 1 / 3)).toBe("Side");
  expect(pathLeg(p, 0.9)).toBe("Close → Back");
  expect(pathLeg(p, 1)).toBe("Back");
  // An unnamed view is named by its place.
  expect(pathLeg(path([key({}), key({ name: "  " })]), 0.5)).toBe(
    "View 1 → View 2",
  );
});

test("a moved view keeps its turns and leg time, unless it becomes the first", () => {
  const a = key({ name: "A", yaw: 0.2 });
  const b = key({ name: "B", yaw: 1, turns: 2, leg: 3 });
  const c = key({ name: "C", yaw: 2, pitch: 0.4, turns: -1, leg: 0.5 });
  const p = path([a, b, c], "smooth");
  const later = moveKey(p, 2, 1);
  expect(later).toEqual(path([a, c, b], "smooth"));
  // The legs arrive at the same views, now in the new order: C after A
  // takes 0.5, then B takes 3.
  expect(keyTimes(later)).toEqual([0, 0.5 / 3.5, 1]);
  expect(pathLeg(later, 0.5)).toBe("C → B");
  // A view moved to the front has no leg before it; the one it passes keeps
  // the defaults it had as the first.
  const first = moveKey(p, 1, 0);
  expect(first.keys).toEqual([key({ name: "B", yaw: 1 }), a, c]);
  expect(first.keys[0]).not.toHaveProperty("leg");
  expect(pathError(first)).toBeNull();
  expect(moveKey(p, 0, 1).keys).toEqual([key({ name: "B", yaw: 1 }), a, c]);
  // Moves past either end change nothing, and the path given is untouched.
  expect(moveKey(p, 0, -1)).toBe(p);
  expect(moveKey(p, 2, 3)).toBe(p);
  expect(p.keys).toEqual([a, b, c]);
  // Removing the first view clears the turns and leg time of the next.
  expect(removeKey(p, 0).keys).toEqual([key({ name: "B", yaw: 1 }), c]);
  expect(removeKey(p, 1).keys).toEqual([a, c]);
});

test("smooth never overshoots, however unequal its legs", () => {
  // Pitch at an interior view between a short and a steep leg, and at the
  // first view before a reversal: monotone cubic slopes keep every leg
  // within its two views where a mean slope or an unclamped end would
  // overshoot.
  for (const pitches of [
    [0, 0.05, 1.4],
    [0, 0.1, -0.9],
    [1.4, 0.05, 0, 0.02],
  ]) {
    const p = path(
      pitches.map((pitch) => key({ pitch })),
      "smooth",
    );
    const legs = pitches.length - 1;
    for (let i = 0; i <= 3000; i++) {
      const at = i / 3000,
        leg = Math.min(legs - 1, Math.floor(at * legs));
      const [a, b] = [pitches[leg], pitches[leg + 1]];
      const v = pathView(p, bounds, at).pitch;
      expect(v).toBeGreaterThanOrEqual(Math.min(a, b) - 1e-15);
      expect(v).toBeLessThanOrEqual(Math.max(a, b) + 1e-15);
    }
  }
});

test("the first view has no turns", () => {
  expect(pathError(path([{ ...tour[0], turns: 1 }, tour[1]]))).toEqual({
    field: "View 1 turns",
    message: "must be 0: the first view has no leg before it.",
  });
});

test("a path flown while the geometry moves is the same camera about the study as drawn, whatever each frame's bounds", () => {
  // A frame of a parameter animation, reveal or trace has bounds of its own,
  // and the hold and fit cameras frame them; the path ignores them and the
  // held view, and flies about the bounds its views were taken about.
  const p = path(tour, "smooth");
  const elsewhere: Bounds3 = { center: { x: -4, y: 2, z: 7 }, radius: 0.4 };
  const frame = { result: { bounds: elsewhere } };
  for (const mode of ["reveal", "parameters", "trace", "probe", "cut"] as const)
    for (let i = 0; i <= 30; i++) {
      const progress = i / 30;
      const view = animationCamera({
        mode,
        camera: "path",
        frame,
        final: frame,
        heldView: {
          ...elsewhere,
          yaw: 2,
          pitch: -1,
          zoom: 3,
          panX: 1,
          panY: 1,
        },
        path: p,
        around: bounds,
        progress,
      } as unknown as AnimationView);
      expect(apart(view, pathView(p, bounds, progress))).toBeLessThan(1e-9);
    }
  // At its ends it stands at the first and last views exactly.
  const at = (progress: number) =>
    animationCamera({
      mode: "parameters",
      camera: "path",
      frame,
      final: frame,
      path: p,
      around: bounds,
      progress,
    } as unknown as AnimationView);
  expect(at(0)).toEqual(manual(tour[0]));
  expect(at(1)).toEqual(manual(tour[3]));
});

test("in a loop, a smooth closed path passes through the view where it ends and starts again without stopping", () => {
  // A closed tour: the last view is the first, one turn on.
  const ring = [
    key({ yaw: 0.3, pitch: 0.2, zoom: 1 }),
    key({ yaw: 2.1, pitch: 0.7, zoom: 2.2 }),
    key({ yaw: -2.2, pitch: -0.3, zoom: 1.4 }),
    key({ yaw: 0.3, pitch: 0.2, zoom: 1, turns: 0 }),
  ];
  const smooth = path(ring, "smooth");
  const h = 1e-6;
  const rates = (cyclic: boolean) => {
    const at = (p: number) => pathView(smooth, bounds, p, cyclic);
    // At exactly 1 the camera is the last view as entered, its yaw not
    // unwrapped along the path, so the end's rate is taken just before it.
    const [a0, a1, b0, b1] = [at(0), at(h), at(1 - 2 * h), at(1 - h)];
    return {
      start: [
        (a1.yaw - a0.yaw) / h,
        (a1.pitch - a0.pitch) / h,
        Math.log(a1.zoom / a0.zoom) / h,
      ],
      end: [
        (b1.yaw - b0.yaw) / h,
        (b1.pitch - b0.pitch) / h,
        Math.log(b1.zoom / b0.zoom) / h,
      ],
    };
  };
  // Not cyclic, the ends take one-sided slopes that disagree at the seam.
  const open = rates(false);
  expect(
    Math.max(...open.start.map((r, i) => Math.abs(r - open.end[i]))),
  ).toBeGreaterThan(0.5);
  // Cyclic, the seam is one more interior view: the same rate either side.
  const closed = rates(true);
  for (let i = 0; i < 3; i++)
    expect(Math.abs(closed.start[i] - closed.end[i])).toBeLessThan(1e-3);
  // Still exactly at every view, and the same drawing at both ends.
  ring.forEach((k, i) =>
    expect(
      apart(pathView(smooth, bounds, i / 3, true), manual(k)),
    ).toBeLessThan(1e-9),
  );
  // And never beyond the two views of a leg.
  for (let i = 0; i <= 3000; i++) {
    const p = i / 3000,
      leg = Math.min(2, Math.floor(p * 3));
    const v = pathView(smooth, bounds, p, true);
    const [a, b] = [ring[leg], ring[leg + 1]];
    expect(v.pitch).toBeGreaterThanOrEqual(Math.min(a.pitch, b.pitch) - 1e-15);
    expect(v.pitch).toBeLessThanOrEqual(Math.max(a.pitch, b.pitch) + 1e-15);
  }
});

test("a loop changes neither a steady path nor a path of two views", () => {
  for (const keys of [tour, tour.slice(0, 2)])
    for (const style of ["steady", "smooth"] as const) {
      if (style === "smooth" && keys.length > 2) continue;
      for (let i = 0; i <= 50; i++)
        expect(
          apart(
            pathView(path(keys, style), bounds, i / 50, true),
            pathView(path(keys, style), bounds, i / 50),
          ),
        ).toBe(0);
    }
  for (let i = 0; i <= 50; i++)
    expect(
      apart(
        pathView(path(tour, "steady"), bounds, i / 50, true),
        pathView(path(tour, "steady"), bounds, i / 50),
      ),
    ).toBe(0);
});

test("a loop's camera at its seam is the path's own", () => {
  const view = (cyclic?: boolean): AnimationView => ({
    frame: null as never,
    final: null as never,
    camera: "path",
    length: 0,
    progress: 0.999,
    mode: "path",
    complete: false,
    path: path(tour, "smooth"),
    around: bounds,
    ...(cyclic !== undefined && { cyclic }),
  });
  expect(
    apart(
      animationCamera(view(true)),
      pathView(path(tour, "smooth"), bounds, 0.999, true),
    ),
  ).toBe(0);
  expect(
    apart(
      animationCamera(view()),
      pathView(path(tour, "smooth"), bounds, 0.999),
    ),
  ).toBe(0);
  expect(
    apart(animationCamera(view(true)), animationCamera(view())),
  ).toBeGreaterThan(1e-6);
});

test("in a loop, a seam that is a turning point rests there instead of overshooting it", () => {
  // The pitch rises from the seam on the first leg and falls back to it on
  // the last, so the seam is its lowest view.
  const dip = [
    key({ pitch: 0.2 }),
    key({ yaw: 2, pitch: 0.9 }),
    key({ yaw: 4, pitch: 0.6 }),
    key({ pitch: 0.2 }),
  ];
  const p = path(dip, "smooth");
  for (let i = 0; i <= 3000; i++) {
    const at = i / 3000,
      leg = Math.min(2, Math.floor(at * 3));
    const v = pathView(p, bounds, at, true).pitch;
    const [a, b] = [dip[leg].pitch, dip[leg + 1].pitch];
    expect(v).toBeGreaterThanOrEqual(Math.min(a, b) - 1e-15);
    expect(v).toBeLessThanOrEqual(Math.max(a, b) + 1e-15);
  }
  const h = 1e-6;
  expect(Math.abs(pathView(p, bounds, h, true).pitch - 0.2) / h).toBeLessThan(
    1e-3,
  );
});

// Leg times: a key view's leg (the one arriving at it) takes its share of
// the duration in proportion to its time; a view without one counts 1.
const timed = [
  tour[0],
  { ...tour[1], leg: 2 },
  { ...tour[2], leg: 0.5 },
  { ...tour[3], leg: 1.5 },
];

test("each view is reached at its legs' share of the duration, exactly, in either style", () => {
  expect(keyTimes(path(tour))).toEqual([0, 1 / 3, 2 / 3, 1]);
  expect(keyTimes(path(timed))).toEqual([0, 0.5, 0.625, 1]);
  expect(keyTimes(path([]))).toEqual([]);
  expect(keyTimes(path([tour[0]]))).toEqual([0]);
  for (const style of ["steady", "smooth"] as const)
    for (const keys of [
      timed,
      // Times whose sums are not exact in binary; with 0.1, 1.3 and 1.3 the
      // third view's progress times the total falls just short of its time.
      timed.map((k, i) => (i ? { ...k, leg: [0.1, 0.7, 3.3][i - 1] } : k)),
      timed.map((k, i) => (i ? { ...k, leg: [0.1, 1.3, 1.3][i - 1] } : k)),
    ]) {
      const p = path(keys, style);
      const times = keyTimes(p);
      keys.forEach((k, i) =>
        expect(pathView(p, bounds, times[i])).toEqual(manual(k)),
      );
      expect(pathLeg(p, times[1])).toBe("Side");
      expect(pathLeg(p, (times[1] + times[2]) / 2)).toBe("Side → Close");
    }
});

test("a leg's time stretches that leg alone; equal times fly as the default", () => {
  // Steady flies each leg the same way whatever its time: the same camera
  // at the same fraction of the leg.
  const equal = path(tour),
    stretched = path(timed);
  // Leg times 2, 0.5 and 1.5 of 4.
  const [a, b] = [
    [0, 1 / 3, 2 / 3, 1],
    [0, 0.5, 0.625, 1],
  ];
  for (let leg = 0; leg < 3; leg++)
    for (let i = 1; i < 20; i++) {
      const f = i / 20;
      expect(
        apart(
          pathView(stretched, bounds, b[leg] + (b[leg + 1] - b[leg]) * f),
          pathView(equal, bounds, a[leg] + (a[leg + 1] - a[leg]) * f),
        ),
      ).toBeLessThan(1e-9);
    }
  // A view without a time is a view whose time is 1, field for field; equal
  // times of any size fly the same path.
  const ones = path(
    tour.map((k, i) => (i ? { ...k, leg: 1 } : k)),
    "smooth",
  );
  const scaled = path(
    tour.map((k, i) => (i ? { ...k, leg: 2.5 } : k)),
    "smooth",
  );
  for (let i = 0; i <= 300; i++) {
    expect(pathView(ones, bounds, i / 300)).toEqual(
      pathView(path(tour, "smooth"), bounds, i / 300),
    );
    expect(
      apart(
        pathView(scaled, bounds, i / 300),
        pathView(path(tour, "smooth"), bounds, i / 300),
      ),
    ).toBeLessThan(1e-9);
  }
});

test("smooth keeps its rate through a view between a short leg and a long one, and never overshoots", () => {
  // Pitch rises over a quick leg and then a slow one: in time, the rate
  // either side of the view between them is the same.
  const rise = [
    key({ pitch: 0, zoom: 1 }),
    key({ pitch: 0.3, zoom: 2, leg: 0.5 }),
    key({ pitch: 1.2, zoom: 5, leg: 3 }),
    key({ pitch: -0.6, zoom: 0.4, leg: 1 }),
  ];
  const p = path(rise, "smooth");
  // Leg times 0.5, 3 and 1 of 4.5.
  const times = [0, 0.5 / 4.5, 3.5 / 4.5, 1],
    h = 1e-7;
  const at = (x: number) => pathView(p, bounds, x);
  const rate = (x: number, side: 1 | -1) => {
    const [v0, v1] = [at(x), at(x + side * h)];
    return [
      (side * (v1.pitch - v0.pitch)) / h,
      (side * Math.log(v1.zoom / v0.zoom)) / h,
    ];
  };
  const [before, after] = [rate(times[1], -1), rate(times[1], 1)];
  expect(before[0]).toBeGreaterThan(0);
  for (let i = 0; i < 2; i++)
    expect(Math.abs(before[i] - after[i])).toBeLessThan(
      1e-4 * Math.abs(before[i]),
    );
  // No leg leaves the range of its two views; the highest view is a rest.
  for (let i = 0; i <= 3000; i++) {
    const x = i / 3000,
      leg = Math.max(
        0,
        times.findLastIndex((t) => t <= x && t < 1),
      );
    const v = at(x),
      [a, b] = [rise[leg], rise[leg + 1]];
    expect(v.pitch).toBeGreaterThanOrEqual(Math.min(a.pitch, b.pitch) - 1e-15);
    expect(v.pitch).toBeLessThanOrEqual(Math.max(a.pitch, b.pitch) + 1e-15);
    expect(v.zoom).toBeGreaterThanOrEqual(
      Math.min(a.zoom, b.zoom) * (1 - 1e-12),
    );
    expect(v.zoom).toBeLessThanOrEqual(Math.max(a.zoom, b.zoom) * (1 + 1e-12));
  }
  expect(Math.abs(rate(times[2], 1)[0])).toBeLessThan(1e-4);
  // Continuity, however short a leg: no point jumps.
  for (let i = 0; i < 3000; i++)
    expect(apart(at(i / 3000), at((i + 1) / 3000))).toBeLessThan(25);
});

test("in a loop, a smooth path with unequal legs passes its seam at one rate", () => {
  const ring = [
    key({ yaw: 0.3, pitch: 0.2, zoom: 1 }),
    key({ yaw: 2.1, pitch: 0.7, zoom: 2.2, leg: 0.4 }),
    key({ yaw: -2.2, pitch: -0.3, zoom: 1.4, leg: 2 }),
    key({ yaw: 0.3, pitch: 0.2, zoom: 1, leg: 3 }),
  ];
  const p = path(ring, "smooth"),
    h = 1e-7;
  const at = (x: number) => pathView(p, bounds, x, true);
  // Leg times 0.4, 2 and 3 of 5.4.
  [0, 0.4 / 5.4, 2.4 / 5.4, 1].forEach((x, i) =>
    expect(apart(at(x), manual(ring[i]))).toBeLessThan(1e-9),
  );
  const [a0, a1, b0, b1] = [at(0), at(h), at(1 - 2 * h), at(1 - h)];
  const start = [(a1.yaw - a0.yaw) / h, (a1.pitch - a0.pitch) / h],
    end = [(b1.yaw - b0.yaw) / h, (b1.pitch - b0.pitch) / h];
  for (let i = 0; i < 2; i++)
    expect(Math.abs(start[i] - end[i])).toBeLessThan(
      1e-4 * Math.max(1, Math.abs(start[i])),
    );
});

test("leg times are refused outside their limits, and on the first view", () => {
  const leg = (t: number) =>
    pathError(path([tour[0], tour[1], { ...tour[2], leg: t }]));
  const message = `must be from ${legRange[0]} to ${legRange[1]}.`;
  for (const t of [legRange[0] / 2, legRange[1] * 1.01, 0, -1, Number.NaN])
    expect(leg(t)).toEqual({ field: "View 3 leg time", message });
  for (const t of [legRange[0], 1, legRange[1]]) expect(leg(t)).toBeNull();
  expect(pathError(path([{ ...tour[0], leg: 2 }, tour[1]]))).toEqual({
    field: "View 1 leg time",
    message: "must be 1: the first view has no leg before it.",
  });
  expect(pathError(path([{ ...tour[0], leg: 1 }, tour[1]]))).toBeNull();
});

test("smooth's slopes at a view and at the ends weigh the legs' times as pchip does", () => {
  // Pitch 0, 0.1, 0.7 over legs of 1 and 3, so the legs' rates are 0.1 and
  // 0.2 per unit of leg time. Moler's pchip (Numerical Computing with
  // MATLAB, section 3.4) gives the view between them the slope
  // (w1 + w2)/(w1/0.1 + w2/0.2) with w1 = 2·3 + 1 and w2 = 3 + 2·1, that
  // is 12/95, and the first view ((2·1 + 3)·0.1 − 1·0.2)/(1 + 3) = 0.075.
  // In progress, over a total leg time of 4, they are four times as large.
  const p = path(
    [key({ pitch: 0 }), key({ pitch: 0.1 }), key({ pitch: 0.7, leg: 3 })],
    "smooth",
  );
  const h = 1e-7,
    pitch = (x: number) => pathView(p, bounds, x).pitch;
  const rate = (x: number) => (pitch(x + h) - pitch(x - h)) / (2 * h);
  expect(rate(0.25)).toBeCloseTo((4 * 12) / 95, 6);
  expect((pitch(h) - pitch(0)) / h).toBeCloseTo(4 * 0.075, 5);
  // The last view: ((2·3 + 1)·0.2 − 3·0.1)/(3 + 1) = 0.275.
  expect((pitch(1 - h) - pitch(1 - 2 * h)) / h).toBeCloseTo(4 * 0.275, 5);
  // In a loop the seam is a view between the last leg and the first. Pitch
  // 0.2, 0.7, −0.3, 0.2 over legs of 0.4, 2 and 3: rates 0.5/3 before the
  // seam and 1.25 after it, w1 = 2·0.4 + 3 and w2 = 0.4 + 2·3, a slope of
  // 10.2/(3.8·6 + 6.4/1.25) per unit of leg time, over a total of 5.4.
  const ring = path(
    [
      key({ pitch: 0.2 }),
      key({ yaw: 2, pitch: 0.7, leg: 0.4 }),
      key({ yaw: 4, pitch: -0.3, leg: 2 }),
      key({ pitch: 0.2, leg: 3 }),
    ],
    "smooth",
  );
  const seam = (pathView(ring, bounds, h, true).pitch - 0.2) / h;
  expect(seam).toBeCloseTo((5.4 * 10.2) / (3.8 * 6 + 6.4 / 1.25), 4);
});

test("only a smooth flight about the geometry changes how its framed point moves: every other flight is the camera it was", () => {
  // Paths in both styles, open and looped, orthographic and through a
  // lens, with depths of 0 as the plane pivot gives them, and every steady
  // path or path of two views with depths besides; and smooth paths about
  // the geometry where it found none. At 1,001 progresses and each view's
  // time, against the views these paths flew before the smooth framed point
  // kept its rate (recorded as this fingerprint). Each number is rounded to
  // six significant figures, and to 0 below 10⁻⁹, so that a last-place
  // difference in a platform's Math functions does not change the
  // fingerprint, while any change in how a framed point moves does.
  const flights = [
    { path: path(tour), lens: {} },
    { path: path(tour), lens: { projection: "normal" as const } },
    {
      path: path(
        tour.map((k, i) => (i ? { ...k, leg: [0.4, 3, 1.7][i - 1] } : k)),
      ),
      lens: { projection: "chosen" as const, lensAngle: 35 },
    },
    { path: path(tour.slice(0, 2)), lens: {} },
    { path: path([tour[1], { ...tour[1], turns: 1, leg: 2 }]), lens: {} },
  ];
  const lenses: Pick<View, "projection" | "lensAngle">[] = [
    {},
    { projection: "normal" },
    { projection: "chosen", lensAngle: 20 },
  ];
  const around: Bounds3[] = [
    bounds,
    { center: { x: 0, y: 0, z: 0 }, radius: 1.5 },
  ];
  const views: View[] = [];
  const fly = (
    p: CameraPath,
    cyclic: boolean,
    depths: number[] | undefined,
    lens: Pick<View, "projection" | "lensAngle">,
  ) => {
    const progresses = [
      ...Array.from({ length: 1001 }, (_, i) => i / 1000),
      ...keyTimes(p),
    ];
    for (const b of around)
      for (const x of progresses)
        views.push(pathView(p, b, x, cyclic, depths, lens));
  };
  for (const { path: base, lens } of flights)
    for (const style of ["steady", "smooth"] as const)
      for (const cyclic of [false, true]) {
        const p = { ...base, style },
          zeros = p.keys.map(() => 0);
        fly(p, cyclic, undefined, lens);
        fly({ ...p, pivot: "plane" }, cyclic, zeros, lens);
        fly({ ...p, pivot: "geometry" }, cyclic, zeros, lens);
        if (style === "steady" || p.keys.length === 2)
          for (const l of lenses)
            fly(
              { ...p, pivot: "geometry" },
              cyclic,
              p.keys.map((_, k) => 0.35 * Math.sin(1.7 * k + 0.4)),
              l,
            );
      }
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify(views, (_, x) =>
        typeof x === "number"
          ? Math.abs(x) < 1e-9
            ? 0
            : Number(x.toPrecision(6))
          : x,
      ),
    )
    .digest("hex");
  expect(fingerprint).toBe(
    "225f9eead0d023fc4b1443256723e632d9dbd415680ea8cc868b1fdf1c256316",
  );
});

test("smooth about the geometry moves the framed point at one rate through every view, and through a loop's seam", () => {
  // The rate at which each point crosses the page, either side of a time:
  // smooth turns, tilts and zooms at one rate through a view, so a change
  // in it there is the framed point's.
  // One-sided differences of second order, which a view where the camera
  // rests, accelerating differently either side, does not mistake for a
  // change of rate.
  const step = 1e-6;
  // A lattice through the study, so that some points stay drawn when a
  // lens comes close.
  const lattice: Vec3[] = [];
  for (let i = 0; i < 125; i++)
    lattice.push(
      off(bounds.center, [
        1.5 * ((i % 5) - 2),
        1.5 * ((Math.floor(i / 5) % 5) - 2),
        1.5 * (Math.floor(i / 25) - 2),
      ]),
    );
  const drawn = (view: View) => {
    const k = camera(view, size);
    return lattice.map((p) => {
      const c = clip(k, p.x, p.y, p.z);
      return c[3] > 0 && Math.abs(c[2]) <= c[3]
        ? page(k, c)
        : { x: NaN, y: NaN, depth: NaN };
    });
  };
  // The farthest any drawn point moves on the page between two views.
  const onPage = (p: { x: number; y: number }) =>
    p.x >= 0 && p.x <= size.width && p.y >= 0 && p.y <= size.height;
  const moved = (a: View, b: View) => {
    const [pa, pb] = [drawn(a), drawn(b)];
    return Math.max(
      0,
      ...pa.map((p, i) =>
        onPage(p) && onPage(pb[i])
          ? Math.hypot(p.x - pb[i].x, p.y - pb[i].y)
          : 0,
      ),
    );
  };
  const pageRate = (view: (x: number) => View, x: number, side: 1 | -1) => {
    const [a, b, c] = [0, 1, 2].map((j) => drawn(view(x + j * side * step)));
    const rate = (p: number, q: number, r: number) =>
      (side * (-3 * p + 4 * q - r)) / (2 * step);
    return a.flatMap((p, i) => [
      rate(p.x, b[i].x, c[i].x),
      rate(p.y, b[i].y, c[i].y),
    ]);
  };
  // Through a lens, points behind the eye are not drawn, and not compared.
  const jump = (before: number[], after: number[]) => {
    const both = before
      .map((r, i) => [r, after[i]])
      .filter((pair) => pair.every(Number.isFinite));
    expect(both.length).toBeGreaterThan(1);
    return (
      Math.max(...both.map(([r, s]) => Math.abs(r - s))) /
      Math.max(1, ...both.map(([r]) => Math.abs(r)))
    );
  };
  // A climb that turns, tilts and zooms in throughout, so that the camera
  // rests at no view, with equal legs and with unequal ones.
  const climb = [
    key({ yaw: 0.2, pitch: -0.3, zoom: 1, panX: 0.2 }),
    key({ yaw: 1.1, pitch: 0.1, zoom: 1.8, panY: 0.5 }),
    key({ yaw: 2.3, pitch: 0.5, zoom: 2.6, panX: -0.6 }),
    key({ yaw: 2.9, pitch: 0.9, zoom: 4, panY: -0.3 }),
  ];
  const legs = [
    climb[0],
    { ...climb[1], leg: 0.5 },
    { ...climb[2], leg: 3 },
    climb[3],
  ];
  // In front of every view's eye through the normal lens, as found depths
  // are.
  const depths = [0.8, -1.1, 0.9, 0.3];
  for (const lens of [
    {},
    { projection: "normal" as const },
    { projection: "chosen" as const, lensAngle: 20 },
  ])
    for (const keys of [climb, legs]) {
      const geometry = {
        ...path(keys, "smooth"),
        pivot: "geometry" as const,
      };
      const view = (x: number) =>
        pathView(geometry, bounds, x, false, depths, lens);
      const plane = (x: number) =>
        pathView(geometry, bounds, x, false, [0, 0, 0, 0], lens);
      const times = keyTimes(geometry);
      let corner = 0;
      for (const t of times.slice(1, -1)) {
        expect(jump(pageRate(view, t, -1), pageRate(view, t, 1))).toBeLessThan(
          1e-6,
        );
        corner = Math.max(
          corner,
          jump(pageRate(plane, t, -1), pageRate(plane, t, 1)),
        );
        // Through a lens, the framed point itself keeps its rate.
        if (lens.projection) {
          const rate = (side: 1 | -1) => {
            // At the view itself the camera is the key's, framed about
            // the plane, so its framed point is the leg's limit there.
            const [a, b] = [1, 2].map(
              (j) => view(t + j * side * step).framedTarget!.point,
            );
            const p = view(t + side * 1e-12).framedTarget!.point;
            return (["x", "y", "z"] as const).map(
              (c) => (side * (-3 * p[c] + 4 * a[c] - b[c])) / (2 * step),
            );
          };
          expect(jump(rate(-1), rate(1))).toBeLessThan(1e-4);
        }
      }
      // About the plane, the framed point still turns its corner at a view
      // where the camera does not rest, as it always has.
      expect(corner).toBeGreaterThan(1e-2);
      // Still exactly each view at its time, and no jump between.
      times.forEach((t, k) =>
        expect(pathView(geometry, bounds, t, false, depths)).toEqual(
          manual(keys[k]),
        ),
      );
      // Nothing jumps: no point on the page moves more than 25 px in a
      // three-thousandth of the path.
      for (let i = 0; i < 3000; i++)
        expect(moved(view(i / 3000), view((i + 1) / 3000))).toBeLessThan(25);
    }
  // A loop: its last view is its first, a turn on, and its seam is one more
  // view between legs.
  const ring = [
    key({ yaw: 0.3, pitch: 0.2, zoom: 1, panX: 0.3 }),
    key({ yaw: 2.1, pitch: 0.7, zoom: 2.2, panY: -0.4, leg: 0.4 }),
    key({ yaw: -2.2, pitch: -0.3, zoom: 1.4, panX: -0.5, leg: 2 }),
    key({ yaw: 0.3, pitch: 0.2, zoom: 1, panX: 0.3, turns: 1, leg: 3 }),
  ];
  const loop = { ...path(ring, "smooth"), pivot: "geometry" as const },
    seam = [1.3, -0.6, 0.9, 1.3];
  const looped = (x: number) => pathView(loop, bounds, x, true, seam);
  const [start, end] = [pageRate(looped, 0, 1), pageRate(looped, 1 - step, -1)];
  expect(jump(start, end)).toBeLessThan(1e-4);
  // Open, the same path's ends need not agree.
  const open = (x: number) => pathView(loop, bounds, x, false, seam);
  expect(
    jump(pageRate(open, 0, 1), pageRate(open, 1 - step, -1)),
  ).toBeGreaterThan(1e-2);
  for (const t of keyTimes(loop).slice(1, -1))
    expect(jump(pageRate(looped, t, -1), pageRate(looped, t, 1))).toBeLessThan(
      1e-4,
    );
});

test("smooth about the geometry holds a detail in the middle through several views that frame it", () => {
  // Three views of one small detail far off the plane, each framing it
  // from another side and zoom: the framed points nearly coincide, so the
  // framed point barely moves, whatever its rate at each view.
  const node: Vec3 = { x: 2.2, y: 0.4, z: 1.9 };
  const ends = [
    off(node, [-0.002, 0.001, 0.001]),
    off(node, [0.002, -0.001, 0]),
  ];
  const keys = [
    framing(key({ yaw: 0.2, pitch: 0.4, zoom: 3 }), node),
    { ...framing(key({ yaw: 2.4, pitch: -0.3, zoom: 5 }), node), leg: 0.6 },
    {
      ...framing(key({ yaw: -0.9, pitch: 0.9, zoom: 2 }), node),
      turns: 1,
      leg: 2,
    },
  ];
  const geometry = { ...path(keys, "smooth"), pivot: "geometry" as const };
  const depths = framedDepths(geometry, [linesPass(ends)], bounds);
  depths.forEach((s) => expect(Math.abs(s)).toBeGreaterThan(0.5));
  for (const cyclic of [false, true]) {
    let [held, loose] = [0, 0];
    for (let i = 0; i <= 600; i++) {
      const x = i / 600;
      const at = (view: View) => {
        const p = project(camera(view, size), node);
        return Math.hypot(p.x - size.width / 2, p.y - size.height / 2);
      };
      held = Math.max(held, at(pathView(geometry, bounds, x, cyclic, depths)));
      loose = Math.max(loose, at(pathView(geometry, bounds, x, cyclic)));
    }
    expect(held).toBeLessThan(2);
    expect(loose).toBeGreaterThan(20);
  }
});

test("smooth about the geometry flies a path backward as its views reversed, open or looped, with a leg that keeps its zoom", () => {
  // Reversed, each view keeps the time of the leg that left it, and the
  // turns of the leg that arrived at the next.
  const reverse = (keys: KeyView[]): KeyView[] =>
    keys
      .map((k, i) => ({
        ...k,
        turns: -(keys[i + 1]?.turns ?? 0),
        leg: keys[i + 1]?.leg ?? 1,
      }))
      .reverse()
      .map((k, i) => (i ? k : { ...k, turns: 0, leg: 1 }));
  // Zoom rises through the seam, so that the loop does not rest there.
  const level = [
    key({ yaw: 0.2, pitch: -0.3, zoom: 2, panX: 0.2 }),
    key({ yaw: 1.1, pitch: 0.1, zoom: 3, panY: 0.5, leg: 0.5 }),
    key({ yaw: 2.3, pitch: 0.5, zoom: 3, panX: -0.6, leg: 3 }),
    key({ yaw: 2.9, pitch: 0.9, zoom: 1, panY: -0.3, turns: 1, leg: 1.5 }),
    key({ yaw: 0.2, pitch: -0.3, zoom: 2, panX: 0.2, leg: 0.8 }),
  ];
  const depths = [0.8, -1.1, 0.9, 0.3, 0.8];
  const forward = { ...path(level, "smooth"), pivot: "geometry" as const },
    backward = { ...forward, keys: reverse(level) };
  const back = depths.slice().reverse();
  for (const cyclic of [false, true])
    for (let i = 0; i <= 400; i++) {
      const x = i / 400;
      expect(
        apart(
          pathView(forward, bounds, x, cyclic, depths),
          pathView(backward, bounds, 1 - x, cyclic, back),
        ),
      ).toBeLessThan(1e-6);
    }
  // The leg that keeps its zoom passes its views at one rate too.
  const step = 1e-6;
  const rate = (x: number, side: 1 | -1) => {
    const [a, b, c] = [0, 1, 2].map((j) =>
      pages(pathView(forward, bounds, x + j * side * step, false, depths)),
    );
    return a.flatMap((p, k) =>
      (["x", "y"] as const).map(
        (q) => (side * (-3 * p[q] + 4 * b[k][q] - c[k][q])) / (2 * step),
      ),
    );
  };
  for (const t of keyTimes(forward).slice(1, -1)) {
    const [before, after] = [rate(t, -1), rate(t, 1)];
    const most = Math.max(1, ...before.map(Math.abs));
    before.forEach((r, k) =>
      expect(Math.abs(r - after[k])).toBeLessThan(1e-4 * most),
    );
  }
});

test("fitted to each frame, a flight draws every frame as the path draws it moved onto the starting study, the fit fading as 1/z once zoomed in", () => {
  // The frame's bounds: the geometry has grown 3.7 times about a moved
  // center. At zoom z the fit is applied with weight w = min(1, 1/z): the
  // bounds it fits to are C + w(C′ − C) with radius r(r′/r)^w, and each
  // point X of the frame must be drawn where the unfitted camera draws
  // C + (r/r_w)(X − C_w). At zoom 1 or wider that is the similarity that
  // takes the frame's bounds onto the starting study's.
  const grown: Bounds3 = { center: { x: -2.4, y: 3.1, z: 0.9 }, radius: 11.1 };
  const moved =
    (zoom: number) =>
    (p: Vec3): Vec3 => {
      const w = Math.min(1, 1 / zoom);
      const r = bounds.radius * (grown.radius / bounds.radius) ** w;
      const c = {
        x: bounds.center.x + w * (grown.center.x - bounds.center.x),
        y: bounds.center.y + w * (grown.center.y - bounds.center.y),
        z: bounds.center.z + w * (grown.center.z - bounds.center.z),
      };
      const k = bounds.radius / r;
      return {
        x: bounds.center.x + k * (p.x - c.x),
        y: bounds.center.y + k * (p.y - c.y),
        z: bounds.center.z + k * (p.z - c.z),
      };
    };
  const far: Vec3[] = [
    grown.center,
    { x: 6.2, y: -4, z: 3.3 },
    { x: -9.5, y: 8.8, z: -2 },
    { x: -1, y: 0.4, z: 7.6 },
  ];
  let faded = 0;
  for (const projection of [undefined, "normal", "chosen"] as const) {
    const lens = projection
      ? { projection, ...(projection === "chosen" && { lensAngle: 20 }) }
      : {};
    for (const style of ["steady", "smooth"] as const) {
      for (const depths of [undefined, [0.4, -0.3, 0.8, 0.1]]) {
        const p = { ...path(tour, style), fit: true };
        const view = (progress: number, mode: string, fit = true) =>
          animationCamera({
            mode,
            camera: "hold",
            frame: { result: { bounds: grown } },
            final: { result: { bounds: grown } },
            path: fit ? p : { ...p, fit: false },
            around: bounds,
            ...(depths && { depths }),
            heldView: { ...manual(tour[0]), ...lens },
            progress,
          } as unknown as AnimationView);
        for (const progress of [0, 0.17, 0.5, 2 / 3, 0.91, 1]) {
          const unfitted = pathView(p, bounds, progress, false, depths, lens);
          const plain = camera(unfitted, size);
          const fitted = camera(view(progress, "parameters"), size);
          if (unfitted.zoom > 1) faded++;
          for (const x of far) {
            const a = project(fitted, x),
              b = project(plain, moved(unfitted.zoom)(x));
            const at = `${projection} ${style} ${depths} ${progress}`;
            expect(Math.abs(a.x - b.x), at).toBeLessThan(1e-6);
            expect(Math.abs(a.y - b.y), at).toBeLessThan(1e-6);
            expect(Math.abs(a.depth - b.depth), at).toBeLessThan(1e-9);
          }
          // Unfitted, or while the geometry is fixed, the path is flown
          // about the starting study exactly as before.
          expect(view(progress, "parameters", false)).toEqual(unfitted);
          for (const mode of ["reveal", "trace", "probe", "cut"])
            expect(view(progress, mode)).toEqual(unfitted);
        }
      }
    }
  }
  // Both sides of 1× were flown.
  expect(faded).toBeGreaterThan(20);
});

test("zoomed in, fitting moves a framed detail on the page no more than it does at the fitted framing", () => {
  // A frame whose bounds shifted a twentieth of a radius and grew 2%, as a
  // shape changing other than as a whole shifts them: a detail held in
  // the middle of views from 1× to 1,000× moves on the page about as far
  // as at 1×, where the full similarity would carry it off the page.
  const shifted: Bounds3 = {
    center: {
      x: bounds.center.x + 0.15,
      y: bounds.center.y,
      z: bounds.center.z,
    },
    radius: bounds.radius * 1.02,
  };
  const detail: Vec3 = { x: 2.2, y: 0.4, z: 1.1 };
  const moves = [1, 3, 28, 79.4, 1000].map((zoom) => {
    const framed = framing(key({ yaw: 0.6, pitch: 0.4, zoom }), detail);
    const p = { ...path([framed, { ...framed, yaw: 0.9 }]), fit: true };
    const view = (fit: boolean) =>
      camera(
        animationCamera({
          mode: "parameters",
          camera: "hold",
          frame: { result: { bounds: shifted } },
          final: { result: { bounds: shifted } },
          path: { ...p, fit },
          around: bounds,
          heldView: manual(framed),
          progress: 0,
        } as unknown as AnimationView),
        size,
      );
    const [a, b] = [project(view(true), detail), project(view(false), detail)];
    return Math.hypot(a.x - b.x, a.y - b.y);
  });
  expect(moves[0]).toBeGreaterThan(5);
  for (const m of moves.slice(1)) expect(m).toBeLessThan(1.5 * moves[0]);
});

test("a fitted frame with the starting study's own bounds is the path's own camera", () => {
  const p = { ...path(tour, "smooth"), fit: true };
  for (const progress of [0, 0.3, 0.75, 1])
    expect(
      animationCamera({
        mode: "parameters",
        camera: "hold",
        frame: { result: { bounds } },
        final: { result: { bounds } },
        path: p,
        around: bounds,
        heldView: manual(tour[0]),
        progress,
      } as unknown as AnimationView),
    ).toEqual(pathView(p, bounds, progress));
});
