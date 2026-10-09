import { test, expect } from "@playwright/test";
import {
  defaultPath,
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
