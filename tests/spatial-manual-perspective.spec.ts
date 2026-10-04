import { test, expect } from "@playwright/test";
import {
  camera,
  clip,
  project,
  projections,
  type Projection,
  type View,
} from "../web/spatial/scene";
import { keyFromView } from "../web/spatial/path";
import { animationCamera, type AnimationView } from "../web/spatial/animation";
import { sameCamera } from "../web/spatial/loop";
import type { Bounds3, Vec3 } from "../web/spatial/types";

// The manual camera's perspective projection, observed through the
// drawing's own projection (scene.ts). Expected pixels come from the
// definition, computed here independently: the turntable's right, up and
// back directions; a target panned from the center along right and up; an
// eye at d = 1.16 radius / (zoom tan(fov/2)) behind it; and a pinhole that
// draws a point h to one side at distance D ahead of the eye h / (D
// tan(fov/2)) of the half page from the middle, along the shorter side.
const size = { width: 2000, height: 1520 };
const half = 760;
const at = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const add = (a: Vec3, b: Vec3, s = 1) =>
  at(a.x + s * b.x, a.y + s * b.y, a.z + s * b.z);
const view = (v: Partial<View> = {}): View => ({
  center: at(0.4, -1.2, 2),
  radius: 3,
  yaw: 0.7,
  pitch: -0.4,
  zoom: 1.3,
  panX: 0.5,
  panY: -0.8,
  ...v,
});
function pinhole(v: View, fov: number) {
  const c = Math.cos(v.yaw),
    s = Math.sin(v.yaw),
    a = Math.cos(v.pitch),
    b = Math.sin(v.pitch);
  const right = at(c, 0, s),
    up = at(b * s, a, -b * c),
    back = at(-a * s, b, a * c);
  const target = add(add(v.center, right, -v.panX), up, -v.panY);
  const tan = Math.tan((fov * Math.PI) / 360);
  const d = (1.16 * v.radius) / (v.zoom * tan);
  const eye = add(target, back, d);
  return {
    eye,
    d,
    right,
    up,
    back,
    draw(p: Vec3) {
      const q = add(p, eye, -1),
        D = -dot(q, back);
      return {
        x: 1000 + (dot(q, right) / (D * tan)) * half,
        y: 760 - (dot(q, up) / (D * tan)) * half,
      };
    },
  };
}
const perspectives = (Object.keys(projections) as Projection[]).filter(
  (p) => projections[p].fov,
);
const points = [
  at(0.4, -1.2, 2),
  at(2.1, 0.3, 1.1),
  at(-1.5, -2.2, 3.4),
  at(1, 1, 1),
  at(-0.2, -3, 0.5),
];

test("the projections are labelled, with orthographic first and three lenses", () => {
  expect(Object.keys(projections)).toEqual([
    "orthographic",
    "narrow",
    "normal",
    "wide",
  ]);
  expect(projections.orthographic).toEqual({ label: "Orthographic" });
  expect(perspectives.map((p) => projections[p].fov)).toEqual([30, 50, 90]);
  expect(projections.normal.label).toBe("Perspective · normal, 50°");
});

test("an orthographic projection draws exactly as a view without one", () => {
  const plain = view();
  expect(camera({ ...plain, projection: "orthographic" }, size)).toEqual(
    camera(plain, size),
  );
  expect(camera(plain, size).lens).toEqual([0, 0, 0]);
});

test("a perspective manual camera is a pinhole behind the panned target", () => {
  for (const p of perspectives) {
    const fov = projections[p].fov!;
    for (const v of [
      view(),
      view({ yaw: -2.4, pitch: 1.5, zoom: 0.2, panX: 0, panY: 0 }),
      view({ yaw: 3.1, pitch: -1.5, zoom: 8, panX: -1.4, panY: 2.2 }),
    ]) {
      const k = camera({ ...v, projection: p }, size),
        expected = pinhole(v, fov);
      for (const q of points) {
        // Only points ahead of the eye are drawn.
        if (-dot(add(q, expected.eye, -1), expected.back) <= 0) continue;
        const got = project(k, q),
          want = expected.draw(q);
        expect(got.x).toBeCloseTo(want.x, 6);
        expect(got.y).toBeCloseTo(want.y, 6);
      }
    }
  }
});

test("on the plane through the target, perspective draws at the orthographic scale", () => {
  for (const p of perspectives) {
    const v = view(),
      { right, up } = pinhole(v, projections[p].fov!);
    const ortho = camera(v, size),
      lens = camera({ ...v, projection: p }, size);
    for (const [h, k] of [
      [0, 0],
      [1.2, -0.4],
      [-2, 1.7],
    ]) {
      const q = add(add(v.center, right, h), up, k);
      expect(project(lens, q).x).toBeCloseTo(project(ortho, q).x, 6);
      expect(project(lens, q).y).toBeCloseTo(project(ortho, q).y, 6);
    }
    // Off that plane they differ: nearer points are drawn larger.
    const near = add(add(v.center, pinhole(v, 50).back, 1), right, 1);
    expect(
      Math.abs(project(lens, near).x - project(ortho, near).x),
    ).toBeGreaterThan(5);
  }
});

test("zooming dollies the eye toward the target", () => {
  for (const zoom of [0.2, 1, 3, 8]) {
    const v = view({ zoom }),
      k = camera({ ...v, projection: "wide" }, size),
      e = pinhole(v, 90);
    // A point halfway to the target along the line of sight is drawn at
    // the middle of the page; one just behind the eye is not drawn at all.
    const ahead = add(e.eye, e.back, -e.d / 2),
      behind = add(e.eye, e.back, e.d / 20);
    const c = clip(k, ahead.x, ahead.y, ahead.z);
    expect(Math.abs(c[2])).toBeLessThanOrEqual(c[3]);
    expect(project(k, ahead).x).toBeCloseTo(1000, 6);
    expect(project(k, ahead).y).toBeCloseTo(760, 6);
    const b = clip(k, behind.x, behind.y, behind.z);
    expect(b[3]).toBeLessThan(0);
  }
});

test("the clip volume holds the study, even with the eye inside it", () => {
  const sphere = (v: View) =>
    [
      at(1, 0, 0),
      at(-1, 0, 0),
      at(0, 1, 0),
      at(0, -1, 0),
      at(0, 0, 1),
      at(0, 0, -1),
      at(0.6, 0.6, 0.5),
      at(-0.5, 0.7, -0.5),
    ].map((u) => add(v.center, u, v.radius));
  // Far away through the narrow lens: every point of the study is inside.
  const far = view({ zoom: 0.2, panX: 0, panY: 0 });
  const kf = camera({ ...far, projection: "narrow" }, size);
  for (const q of sphere(far)) {
    const c = clip(kf, q.x, q.y, q.z);
    expect(Math.abs(c[2])).toBeLessThanOrEqual(c[3]);
  }
  // Far beyond the study's reach, 4 radii past its center, is outside.
  const e = pinhole(far, 30);
  const beyond = add(far.center, e.back, -4.5 * far.radius);
  const cb = clip(kf, beyond.x, beyond.y, beyond.z);
  expect(Math.abs(cb[2])).toBeGreaterThan(cb[3]);
  // Inside the study through the wide lens: the near plane is a hundredth
  // of the eye's distance to the target, so a point a fiftieth of it ahead
  // is drawn and a point two hundredths of a percent ahead is not.
  const inside = view({ zoom: 8, panX: 0, panY: 0 });
  const ki = camera({ ...inside, projection: "wide" }, size),
    ei = pinhole(inside, 90);
  expect(ei.d).toBeLessThan(inside.radius);
  const seen = add(ei.eye, ei.back, -ei.d / 50),
    unseen = add(ei.eye, ei.back, -ei.d / 500);
  const cs = clip(ki, seen.x, seen.y, seen.z),
    cu = clip(ki, unseen.x, unseen.y, unseen.z);
  expect(Math.abs(cs[2])).toBeLessThanOrEqual(cs[3]);
  expect(Math.abs(cu[2])).toBeGreaterThan(cu[3]);
  // And the far side of the study is still drawn.
  const across = add(inside.center, ei.back, -inside.radius);
  const ca = clip(ki, across.x, across.y, across.z);
  expect(Math.abs(ca[2])).toBeLessThanOrEqual(ca[3]);
});

test("a perspective view taken as a key view about other bounds keeps every point in place", () => {
  const bounds: Bounds3 = { center: at(1, -0.5, 0.25), radius: 3 };
  const shown: View = {
    center: at(-2, 1, 3),
    radius: 5,
    yaw: 0.9,
    pitch: 0.3,
    zoom: 2,
    panX: -0.4,
    panY: 0.6,
    projection: "normal",
  };
  const key = keyFromView(shown, bounds, "Here");
  const again: View = {
    ...bounds,
    yaw: key.yaw,
    pitch: key.pitch,
    zoom: key.zoom,
    panX: key.panX,
    panY: key.panY,
    projection: "normal",
  };
  const a = camera(shown, size),
    b = camera(again, size);
  for (const q of points) {
    expect(project(b, q).x).toBeCloseTo(project(a, q).x, 6);
    expect(project(b, q).y).toBeCloseTo(project(a, q).y, 6);
  }
  // About the study's own bounds, the view is copied as it is.
  expect(keyFromView({ ...shown, ...bounds }, bounds, "Same")).toMatchObject({
    zoom: 2,
    panX: -0.4,
    panY: 0.6,
  });
});

test("a camera path flies in the held view's projection, and a loop needs the same projection", () => {
  const bounds: Bounds3 = { center: at(0, 0, 0), radius: 2 };
  const held: View = { ...view(), ...bounds, projection: "wide" };
  const keys = [0, 1].map((i) => ({
    name: "",
    yaw: i,
    pitch: 0.2,
    zoom: 1 + i,
    panX: 0,
    panY: 0,
    turns: 0,
  }));
  const flown = animationCamera({
    path: { style: "steady", keys },
    around: bounds,
    progress: 0.5,
    heldView: held,
  } as unknown as AnimationView);
  expect(flown.projection).toBe("wide");
  const flat = animationCamera({
    path: { style: "steady", keys },
    around: bounds,
    progress: 0.5,
    heldView: { ...held, projection: undefined },
  } as unknown as AnimationView);
  expect(flat.projection ?? "orthographic").toBe("orthographic");
  expect(sameCamera(held, { ...held })).toBe(true);
  expect(sameCamera(held, { ...held, projection: "normal" })).toBe(false);
  expect(sameCamera(held, { ...held, projection: undefined })).toBe(false);
  expect(
    sameCamera(
      { ...held, projection: undefined },
      { ...held, projection: "orthographic" },
    ),
  ).toBe(true);
});
