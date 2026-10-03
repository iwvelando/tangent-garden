import { test, expect } from "@playwright/test";
import {
  defaultPath,
  keyFromView,
  maxKeys,
  pathError,
  pathLeg,
  pathView,
  type CameraPath,
  type KeyView,
} from "../web/spatial/path";
import { animationCamera, type AnimationView } from "../web/spatial/animation";
import { camera, project, type View } from "../web/spatial/scene";
import type { Bounds3, Vec3 } from "../web/spatial/types";

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
