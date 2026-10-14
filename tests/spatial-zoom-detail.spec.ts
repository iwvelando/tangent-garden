import { test, expect, type Page } from "@playwright/test";
import { choosePreset } from "./helpers";
import {
  camera,
  clip,
  project,
  type Batch,
  type Pass,
  type View,
} from "../web/spatial/scene";
import { pickAt, zoomAbout, zoomReach } from "../web/spatial/zoom";
import { keyFromView } from "../web/spatial/path";
import { animationCamera, type AnimationView } from "../web/spatial/animation";
import { sameCamera } from "../web/spatial/loop";
import type { Vec3 } from "../web/spatial/types";
import type { CutSpec } from "../web/spatial/cut";

// Zooming the manual camera about the point under the pointer (zoom.ts).
// Expectations come from the lens's definition, computed here: the
// turntable's rows, a target T = C − p_x r̂ − p_y û + s b̂ with s the target
// depth, and an eye d = 1.16 r / (z tan(α/2)) behind it.
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
  zoom: 1,
  panX: 0.5,
  panY: -0.8,
  projection: "normal",
  ...v,
});
function rows(v: View) {
  const c = Math.cos(v.yaw),
    s = Math.sin(v.yaw),
    a = Math.cos(v.pitch),
    b = Math.sin(v.pitch);
  return {
    right: at(c, 0, s),
    up: at(b * s, a, -b * c),
    back: at(-a * s, b, a * c),
  };
}
function pinhole(v: View, fov: number) {
  const { right, up, back } = rows(v);
  const target = add(
    add(add(v.center, right, -v.panX), up, -v.panY),
    back,
    v.targetDepth ?? 0,
  );
  const tan = Math.tan((fov * Math.PI) / 360);
  const d = (1.16 * v.radius) / (v.zoom * tan);
  const eye = add(target, back, d);
  return {
    eye,
    ahead: (p: Vec3) => -dot(add(p, eye, -1), back),
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
const points = [
  at(0.4, -1.2, 2),
  at(2.1, 0.3, 1.1),
  at(-1.5, -2.2, 3.4),
  at(1, 1, 1),
  at(-0.2, -3, 0.5),
];
// The point at a depth s toward the viewer from the plane through the
// center, a and b across and up from the middle of the unpanned page.
function placed(v: View, a: number, b: number, s: number) {
  const { right, up, back } = rows(v);
  return add(add(add(v.center, right, a), up, b), back, s);
}
function batch(mode: Batch["mode"], ...corners: Vec3[]): Batch {
  return {
    mode,
    ink: 0,
    data: Float32Array.from(
      corners.flatMap((p) => [p.x, p.y, p.z, 0, 0, 1, 0]),
    ),
  };
}
const sheet = (...corners: Vec3[]): Pass => ({
  layer: "surface",
  sheet: true,
  batch: batch("triangles", ...corners),
});
const line = (a: Vec3, b: Vec3): Pass => ({
  layer: "base",
  sheet: false,
  batch: batch("lines", a, b),
});
// A small triangle about p, facing the viewer of v, and a short line
// through it across the page.
function detail(v: View, p: Vec3, r: number): Pass[] {
  const { right, up } = rows(v);
  return [
    sheet(
      add(p, up, r),
      add(add(p, right, -r), up, -r),
      add(add(p, right, r), up, -r),
    ),
    line(add(p, right, -r), add(p, right, r)),
  ];
}
// The point of the line of sight through p that stands s farther from
// the eye of v.
function beyond(v: View, p: Vec3, s: number) {
  const { eye, ahead } = pinhole(v, 50);
  const q = add(p, eye, -1);
  return add(eye, q, (ahead(p) + s) / ahead(p));
}
const scale = (a: Vec3, s: number) => at(a.x * s, a.y * s, a.z * s);
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

test("a target depth moves a lens's target along its line of sight", () => {
  for (const targetDepth of [-2.2, 0, 1.7])
    for (const zoom of [0.4, 1, 6]) {
      const v = view({ targetDepth, zoom }),
        k = camera(v, size),
        expected = pinhole(v, 50);
      let drawn = 0;
      for (const q of points) {
        if (expected.ahead(q) <= 0) continue;
        const got = project(k, q),
          want = expected.draw(q);
        expect(distance(got, want)).toBeLessThan(1e-6);
        drawn++;
      }
      expect(drawn).toBeGreaterThan(0);
    }
});

test("orthographic views ignore the target depth", () => {
  const plain = view({ projection: undefined });
  expect(camera({ ...plain, targetDepth: 2.5 }, size)).toEqual(
    camera(plain, size),
  );
});

test("zooming through a lens dives into a detail far in front of the center plane", () => {
  // At zoom 1 through the normal lens the eye is 7.46 in front of the
  // center plane; this detail stands 5 in front of it, off to one side.
  // Zooming toward the plane would carry the eye past it by zoom 3.
  let v = view();
  const p = placed(v, 1.1, -0.6, 5);
  const passes = detail(v, p, 0.01);
  const pointer = project(camera(v, size), p);
  const across = (w: View) => {
    const { right } = rows(w),
      k = camera(w, size);
    return distance(project(k, p), project(k, add(p, right, 1e-4)));
  };
  const start = across(v);
  let factor = 1;
  for (let step = 0; step < 40; step++) {
    const picked = pickAt(passes, v, size, pointer);
    expect(picked).not.toBeNull();
    v = { ...v, ...zoomAbout(v, size, pointer, 1.25, 1000, picked) };
    factor *= 1.25;
    // The detail stays under the pointer, drawn ahead of the eye.
    const c = clip(camera(v, size), p.x, p.y, p.z);
    expect(c[3]).toBeGreaterThan(0);
    expect(Math.abs(c[2])).toBeLessThanOrEqual(c[3]);
    expect(distance(project(camera(v, size), p), pointer)).toBeLessThan(1e-3);
    // Each step magnifies it by the step's factor until the limit. The
    // picked point is the sheet's single-precision position, about 10⁻⁷
    // from p, which is 10⁻⁵ of the eye's distance at the deepest zoom.
    if (v.zoom < 1000)
      expect(Math.abs(across(v) / start / factor - 1)).toBeLessThan(1e-5);
  }
  // At the limit the detail is drawn 1,000 times its target plane's
  // orthographic scale at zoom 1, the zoom's own meaning.
  expect(v.zoom).toBe(1000);
  const { right } = rows(v);
  const unit = (1e-4 * half) / (1.16 * v.radius);
  expect(Math.abs(across(v) / unit / 1000 - 1)).toBeLessThan(1e-5);
  expect(dot(right, rows(view()).right)).toBeCloseTo(1, 12);
});

test("a line picked beside the pointer stays where it is drawn as the zoom dives", () => {
  let v = view();
  const p = placed(v, -0.7, 0.4, 4);
  const k = camera(v, size),
    drawn = project(k, p);
  // A short line through p across the page, the pointer 7 px above it.
  const { right } = rows(v);
  const passes = [line(add(p, right, -0.01), add(p, right, 0.01))];
  const pointer = { x: drawn.x, y: drawn.y - 7 };
  for (let step = 0; step < 20; step++) {
    const picked = pickAt(passes, v, size, pointer);
    expect(picked).not.toBeNull();
    v = { ...v, ...zoomAbout(v, size, pointer, 1.25, 1000, picked) };
    // The line is drawn in single precision, a few 10⁻⁷ from p, which
    // the deepest zoom here magnifies about 300 times.
    expect(distance(project(camera(v, size), p), drawn)).toBeLessThan(0.02);
  }
  expect(v.zoom).toBeGreaterThan(100);
});

test("zooming out through a lens backs away from the detail under the pointer", () => {
  let v = view({ zoom: 40 });
  const p = placed(v, 0.3, 0.2, -2);
  const passes = detail(v, p, 0.001);
  const pointer = project(camera(v, size), p);
  expect(pickAt(passes, v, size, pointer)).not.toBeNull();
  for (let step = 0; step < 10; step++) {
    const picked = pickAt(passes, v, size, pointer);
    v = { ...v, ...zoomAbout(v, size, pointer, 0.8, 1000, picked) };
    expect(distance(project(camera(v, size), p), pointer)).toBeLessThan(1e-3);
  }
});

test("anchoring at a detail without zooming moves nothing", () => {
  for (const s of [-2.5, 0.4, 7.3]) {
    // The last stands 0.16 ahead of the eye, nearer than the zoom limit
    // allows the target, so the target stops at the limit's plane.
    const v = view({ zoom: 1 }),
      p = placed(v, 0.02, 0.01, s),
      pointer = project(camera(v, size), p);
    const after = { ...v, ...zoomAbout(v, size, pointer, 1, 8, p) };
    expect(after.zoom).toBeLessThanOrEqual(8);
    const before = camera(v, size),
      moved = camera(after, size);
    for (const q of [...points, p]) {
      if (pinhole(v, 50).ahead(q) <= 0) continue;
      expect(distance(project(moved, q), project(before, q))).toBeLessThan(
        1e-6,
      );
    }
  }
});

test("with nothing under the pointer, or without a lens, zoom keeps its target plane", () => {
  const pointer = { x: 1400, y: 500 };
  const unit = (2 * 3 * 1.16) / 1520;
  for (const v of [view(), view({ projection: undefined })]) {
    const z = zoomAbout(v, size, pointer, 1.5, 8, null);
    expect(z).toEqual({
      zoom: 1.5,
      panX: 0.5 - 400 * unit * (1 - 1 / 1.5),
      panY: -0.8 + -260 * unit * (1 - 1 / 1.5),
    });
  }
  // Orthographic zoom has no depth to move, whatever is under the pointer.
  const flat = view({ projection: undefined });
  expect(zoomAbout(flat, size, pointer, 1.5, 8, placed(flat, 1, 1, 2))).toEqual(
    zoomAbout(flat, size, pointer, 1.5, 8, null),
  );
});

test("the pick takes the nearest geometry drawn under the pointer", () => {
  const v = view({ zoom: 2 });
  const near = placed(v, 0.5, 0.5, 1),
    far = beyond(v, near, 2);
  const k = camera(v, size),
    pointer = project(k, near);
  const big = (p: Vec3) => detail(v, p, 0.4)[0];
  expect(distance(project(k, far), pointer)).toBeLessThan(1e-6);
  const alone = pickAt([big(far)], v, size, pointer)!;
  expect(dot(add(alone, far, -1), rows(v).back)).toBeCloseTo(0, 6);
  // Nearest first or last, the nearer sheet wins.
  for (const passes of [
    [big(near), big(far)],
    [big(far), big(near)],
  ]) {
    const got = pickAt(passes, v, size, pointer)!;
    expect(distance(project(k, got), pointer)).toBeLessThan(1e-6);
    expect(dot(add(got, near, -1), rows(v).back)).toBeCloseTo(0, 6);
  }
  // A line within reach of the pointer counts at its point nearest it.
  const { right, up } = rows(v);
  const beside = (px: number) => {
    // A line along right, px pixels below the pointer at the near depth:
    // at a distance D ahead of the eye, h across is drawn h / (D tan(α/2))
    // of the half page from the middle.
    const D = pinhole(v, 50).ahead(near),
      shift = (px * D * Math.tan((50 * Math.PI) / 360)) / half;
    const o = add(near, up, -shift);
    return line(add(o, right, -0.3), add(o, right, 0.3));
  };
  const close = pickAt([beside(zoomReach / 2)], v, size, pointer)!;
  expect(close).not.toBeNull();
  expect(distance(project(k, close), pointer)).toBeCloseTo(zoomReach / 2, 3);
  expect(pickAt([beside(zoomReach * 1.5)], v, size, pointer)).toBeNull();
  // A line receding from the eye under the pointer is picked where it
  // passes under it, its point found along it in space, not on the page.
  const slant = add(scale(rows(v).back, -1.5), right, -0.3);
  const receding = line(add(near, slant, -1), add(near, slant, 2));
  const along = pickAt([receding], v, size, pointer)!;
  expect(along).not.toBeNull();
  expect(
    Math.hypot(along.x - near.x, along.y - near.y, along.z - near.z),
  ).toBeLessThan(1e-5);
  // A sheet the pointer lies just beyond the third edge of, within reach
  // of both others, is not under it; a larger one is.
  const corner = (dx: number, dy: number) => add(add(near, right, dx), up, dy);
  expect(
    pickAt(
      [sheet(corner(-0.3, -0.3), corner(0.075, -0.3), corner(-0.3, 0.075))],
      v,
      size,
      pointer,
    ),
  ).toBeNull();
  expect(
    pickAt(
      [sheet(corner(-0.3, -0.3), corner(0.4, -0.3), corner(-0.3, 0.4))],
      v,
      size,
      pointer,
    ),
  ).not.toBeNull();
  expect(pickAt([big(far)], v, size, { x: 10, y: 10 })).toBeNull();
});

test("the pick prefers what is drawn under the pointer to anything nearer the viewer beside it", () => {
  const v = view({ zoom: 2 });
  const under = placed(v, 0.5, 0.5, -1),
    near = beyond(v, under, -2.5);
  const k = camera(v, size),
    pointer = project(k, under);
  const { right, up } = rows(v);
  // A line across the page through a point, shifted px pixels down.
  const across = (p: Vec3, px: number) => {
    const D = pinhole(v, 50).ahead(p),
      o = add(p, up, (-px * D * Math.tan((50 * Math.PI) / 360)) / half);
    return line(add(o, right, -0.3), add(o, right, 0.3));
  };
  const depth = (p: Vec3) => pinhole(v, 50).ahead(p);
  const sheetAt = (p: Vec3) => detail(v, p, 0.4)[0];
  // A far line under the pointer beats a near one 8 px away.
  const a = pickAt([across(near, 8), across(under, 0)], v, size, pointer)!;
  expect(depth(a)).toBeCloseTo(depth(under), 6);
  // A far sheet under the pointer beats a near line 5 px away.
  const b = pickAt([across(near, 5), sheetAt(under)], v, size, pointer)!;
  expect(depth(b)).toBeCloseTo(depth(under), 6);
  // Within a pixel, the nearer wins.
  const c = pickAt([sheetAt(under), across(near, 0.5)], v, size, pointer)!;
  expect(depth(c)).toBeCloseTo(depth(near), 6);
});

test("the pick skips what the drawing does not show", () => {
  const v = view({ zoom: 2 });
  const near = placed(v, 0.5, 0.5, 1),
    far = beyond(v, near, 2);
  const k = camera(v, size),
    pointer = project(k, near);
  const big = (p: Vec3) => detail(v, p, 0.4)[0];
  // A cut hiding everything nearer than the center plane.
  const { back } = rows(v);
  const cut: CutSpec = {
    plane: { normal: back, offset: dot(back, v.center) },
    scope: "all",
    edge: false,
  };
  const got = pickAt([big(near), big(far)], v, size, pointer, cut)!;
  expect(dot(add(got, far, -1), back)).toBeCloseTo(0, 6);
  // Geometry behind the eye is not drawn.
  const eye = pinhole(v, 50).eye;
  for (const s of [0.01, 1, 10, 100]) {
    const behind = beyond(v, near, -pinhole(v, 50).ahead(near) - s);
    expect(pickAt([big(behind)], v, size, project(k, near))).toBeNull();
  }
  expect(eye).toBeDefined();
});

test("the pick finds the same point in geometry measured from a drawing origin", () => {
  const origin = at(5000, -3000, 4000);
  const v = view({ center: add(at(0.4, -1.2, 2), origin) });
  const p = placed(v, 0.5, 0.5, 1);
  const k = camera(v, size),
    pointer = project(k, p);
  const plain = detail(v, p, 0.05);
  const moved = plain.map((pass) => ({
    ...pass,
    batch: {
      ...pass.batch,
      origin,
      data: pass.batch.data.map((x, i) =>
        i % 7 === 0
          ? x - origin.x
          : i % 7 === 1
            ? x - origin.y
            : i % 7 === 2
              ? x - origin.z
              : x,
      ),
    },
  }));
  const got = pickAt(moved, v, size, pointer)!;
  expect(got).not.toBeNull();
  expect(Math.hypot(got.x - p.x, got.y - p.y, got.z - p.z)).toBeLessThan(1e-3);
});

test("a view anchored at a detail keeps every point as a key view", () => {
  const v = view({ zoom: 3, targetDepth: 2.1 });
  const bounds = { center: at(0.1, 0.2, 0.3), radius: 2.5 };
  const key = keyFromView(v, bounds, "", 1000);
  const again = camera({ ...bounds, ...key, projection: "normal" }, size);
  const before = camera(v, size);
  for (const q of points) {
    if (pinhole(v, 50).ahead(q) <= 0) continue;
    expect(distance(project(again, q), project(before, q))).toBeLessThan(1e-6);
  }
});

test("an animation holds the target depth only with the current view", () => {
  const held = view({ targetDepth: 1.5 });
  const frame = {
    result: { bounds: { center: held.center, radius: held.radius } },
  };
  const of = (camera: string) =>
    animationCamera({
      camera,
      mode: "parameters",
      progress: 0.5,
      heldView: held,
      frame,
      final: frame,
    } as unknown as AnimationView);
  expect(of("current").targetDepth).toBe(1.5);
  for (const c of ["hold", "fit", "follow"])
    expect(of(c).targetDepth ?? 0).toBe(0);
  expect(sameCamera(held, { ...held, targetDepth: 1.5 })).toBe(true);
  expect(sameCamera(held, { ...held, targetDepth: 1.6 })).toBe(false);
  expect(sameCamera(view(), { ...view(), targetDepth: 0 })).toBe(true);
});

// In the drawing: the corridor of loops, seen through the wide lens from
// inside its helix, which the wheel and keys zoom into.
const corridor = { label: "A corridor of loops" };
const stage = (page: Page) => page.locator(".spatial-stage");
const canvas = (page: Page) => page.locator("#spatial-artwork");
const settled = (page: Page) =>
  expect(stage(page)).toHaveAttribute("aria-busy", "false", {
    timeout: 20_000,
  });
async function shown(page: Page): Promise<View> {
  return JSON.parse((await canvas(page).getAttribute("data-view"))!);
}
async function drawnSize(page: Page) {
  return canvas(page).evaluate((c: HTMLCanvasElement) => ({
    width: c.clientWidth,
    height: c.clientHeight,
  }));
}
// The preset's curve: a helix of radius 2 rising 0.7 a radian, wound with
// a circle of radius 0.3 turning 24 times a turn.
const loops = (t: number): Vec3 => {
  const r = 2 + 0.3 * Math.cos(24 * t);
  return at(r * Math.cos(t), r * Math.sin(t), 0.7 * t + 0.3 * Math.sin(24 * t));
};

test("the wheel dives into a loop between the eye and the center plane", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await settled(page);
  await choosePreset(page, corridor);
  await settled(page);
  const before = await shown(page),
    page0 = await drawnSize(page);
  expect(before.projection).toBe("wide");
  // The outer edge of a loop about four units in front of the center
  // plane, five behind the eye.
  const q = loops((2 * Math.PI * 22) / 24);
  const lens = pinhole(before, 90);
  expect(lens.ahead(q)).toBeGreaterThan(4);
  expect(lens.ahead(q)).toBeLessThan(7);
  const target = project(camera(before, page0), q);
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.move(box.x + target.x, box.y + target.y);
  for (let k = 0; k < 12; k++) await page.mouse.wheel(0, -200);
  await expect.poll(async () => (await shown(page)).zoom).toBeGreaterThan(20);
  await settled(page);
  const after = await shown(page);
  // The target stands at the loop's depth (the nearest part of it drawn
  // within reach of the pointer, which may be its other side, a loop's
  // width away), and the curve is still drawn under the pointer, ahead of
  // the eye, at the target's depth. Zooming toward the center plane would
  // have carried the eye past the loop near zoom 3.
  const { back } = rows(after);
  const depthOf = (p: Vec3) => dot(add(p, after.center, -1), back);
  expect(Math.abs((after.targetDepth ?? 0) - depthOf(q))).toBeLessThan(0.7);
  const k = camera(after, page0),
    eye = pinhole(after, 90);
  let nearest = { distance: Infinity, depth: 0 };
  const t0 = (2 * Math.PI * 22) / 24;
  for (let t = t0 - 0.3; t <= t0 + 0.3; t += 1e-5) {
    const p = loops(t);
    if (eye.ahead(p) <= 0) continue;
    const gap = distance(project(k, p), target);
    if (gap < nearest.distance) nearest = { distance: gap, depth: depthOf(p) };
  }
  expect(nearest.distance).toBeLessThan(2);
  expect(Math.abs(nearest.depth - after.targetDepth!)).toBeLessThan(0.02);
});

test("the keys zoom toward the geometry in the middle, and Home returns to the plane", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await settled(page);
  await choosePreset(page, corridor);
  await settled(page);
  await canvas(page).focus();
  // The middle of the page looks down the corridor to its far end, behind
  // the center plane.
  await page.keyboard.press("+");
  await expect
    .poll(async () => (await shown(page)).targetDepth ?? 0)
    .toBeLessThan(-5);
  await page.keyboard.press("Home");
  await expect
    .poll(async () => "targetDepth" in (await shown(page)))
    .toBe(false);
  // Orthographic, the keys keep the center plane.
  await page
    .getByRole("combobox", { name: "Projection" })
    .selectOption("orthographic");
  await canvas(page).focus();
  await page.keyboard.press("+");
  await expect.poll(async () => (await shown(page)).zoom).toBeCloseTo(1.76, 6);
  expect("targetDepth" in (await shown(page))).toBe(false);
});
