import { test, expect } from "@playwright/test";
import { trace, traceTimeline } from "../web/spatial/raytrace";
import {
  defaultRide,
  rideChoices,
  rideError,
  ridePath,
  ridePose,
  rideReadout,
  rideView,
  snapRide,
  type Ride,
} from "../web/spatial/ride";
import { animationCamera, type AnimationView } from "../web/spatial/animation";
import { camera, project, type View } from "../web/spatial/scene";
import { spatialPresets } from "../web/spatial/presets";
import type {
  Bounds3,
  CausticSheet,
  RaysConfig,
  RaysResult,
  SpatialConfig,
  SpatialResult,
  SurfaceSheet,
  Vec3,
} from "../web/spatial/types";

// The camera that rides a ray, observed through the drawing's projection
// (scene.ts) and the trace's own geometry (raytrace.ts): the head of the
// traced ray is where the drawn ray ends, and the camera's picture of it is
// what the page shows.
const add = (a: Vec3, b: Vec3, s = 1) => ({
  x: a.x + b.x * s,
  y: a.y + b.y * s,
  z: a.z + b.z * s,
});
const sub = (a: Vec3, b: Vec3) => add(a, b, -1);
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const size = (v: Vec3) => Math.hypot(v.x, v.y, v.z);
const unit = (v: Vec3) => add({ x: 0, y: 0, z: 0 }, v, 1 / size(v));
const angle = (a: Vec3, b: Vec3) => Math.atan2(size(cross(a, b)), dot(a, b));
const near = (a: Vec3, b: Vec3, digits = 9) => {
  for (const k of ["x", "y", "z"] as const)
    expect(a[k]).toBeCloseTo(b[k], digits);
};
const n = 9;
function sheet(at: (i: number, j: number) => Vec3 | null): SurfaceSheet {
  const grid = <T>(r: number, c: number, f: (i: number, j: number) => T) =>
    Array.from({ length: r }, (_, i) =>
      Array.from({ length: c }, (_, j) => f(i, j)),
    );
  const points = grid(n, n, at);
  return {
    points,
    normals: grid(n, n, () => ({ x: 0, y: 0, z: 1 })),
    alongU: grid(n - 1, n, () => true),
    alongV: grid(n, n - 1, () => true),
    faces: grid(n - 1, n - 1, () => true),
  };
}
const none = (branch: 1 | 2, virtual: boolean): CausticSheet => ({
  ...sheet(() => null),
  branch,
  virtual,
  shape: "surface",
});
type Line = RaysResult["lines"][number];
function mirror(
  surface: SurfaceSheet,
  lines: Line[],
  bounds: Bounds3,
  source: Vec3 | null = null,
): SpatialResult {
  return {
    base: [],
    minus: [],
    plus: [],
    mesh: [],
    rulings: [],
    breaks: [],
    bounds,
    radius: bounds.radius,
    invalid: 0,
    omitted: 0,
    rays: {
      surface,
      caustics: [none(1, false), none(1, true), none(2, false), none(2, true)],
      lines,
      uCurves: [0, 4, 8],
      vCurves: [0, 4, 8],
      source,
      singular: 0,
      unlit: 0,
      atSource: 0,
      stigmatic: 0,
      total: 0,
      clipped: [0, 0],
      receiver: null,
    },
  };
}
function lit(rays: Partial<RaysConfig> = {}): SpatialConfig {
  const config = structuredClone(spatialPresets[0].config);
  return {
    ...config,
    format: "rays",
    surface: {
      ...config.surface,
      uMin: -2,
      uMax: 2,
      vMin: -2,
      vMax: 2,
      uSamples: n - 1,
      vSamples: n - 1,
    },
    rays: {
      ...config.rays,
      interaction: "reflect",
      light: "parallel",
      azimuth: 0,
      elevation: -90,
      n1: 1,
      n2: 1,
      ...rays,
    },
  };
}
const grid = (i: number) => -2 + (4 * i) / (n - 1);
// z = (x² + y²)/4, whose focus is (0, 0, 1), under light falling straight
// down; every representative ray is reflected toward the focus.
const dish = sheet((i, j) => ({
  x: grid(i),
  y: grid(j),
  z: (grid(i) ** 2 + grid(j) ** 2) / 4,
}));
const focus = { x: 0, y: 0, z: 1 };
const toward = (surface: SurfaceSheet, to: (p: Vec3) => Vec3, reach = 3) =>
  [0, 4, 8].flatMap((i) =>
    [0, 4, 8].map((j): Line => {
      const point = surface.points[i][j]!;
      const d = unit(sub(to(point), point));
      return {
        i,
        j,
        start: add(point, { x: 0, y: 0, z: 1 }, 5),
        point,
        end: add(point, d, reach),
        back: add(point, d, -reach),
        virtual: false,
        total: false,
      };
    }),
  );
const bounds = { center: focus, radius: 3 };
const paraboloid = mirror(
  dish,
  toward(dish, () => focus),
  bounds,
);
const held: View = {
  ...bounds,
  yaw: 0.3,
  pitch: 0.75,
  zoom: 1,
  panX: 0,
  panY: 0,
};
const page = { width: 1200, height: 900 };
const setup = (r: Partial<Ride> = {}): Ride => ({
  i: 8,
  j: 4,
  follow: 0.3,
  turn: 0.6,
  ...r,
});
function ride(
  result: SpatialResult,
  config: SpatialConfig,
  r: Partial<Ride> = {},
) {
  const timeline = traceTimeline(result, config, result.bounds);
  const path = ridePath(result, timeline, setup(r), result.bounds)!;
  return { timeline, path };
}
// Where the traced ray (i, j) has reached at τ: the head the camera follows.
function head(
  result: SpatialResult,
  timeline: ReturnType<typeof traceTimeline>,
  i: number,
  j: number,
  tau: number,
) {
  const line = trace(result, timeline, tau / timeline.total).rays!.lines.find(
    (l) => l.i === i && l.j === j,
  )!;
  return line.end;
}

test("the ray's head stays in the middle of the page while the camera shares its segment", () => {
  const config = lit();
  const { timeline, path } = ride(paraboloid, config);
  // The ray at (8, 4) meets the dish at (2, 0, 1) at τ = 3, falling from
  // the wavefront at z = 4, and turns toward the focus along −x.
  near(path.point, { x: 2, y: 0, z: 1 });
  expect(path.hit).toBeCloseTo(3, 12);
  const d = 0.3 * 3,
    window = 0.6 * 3;
  const taus = [
    // eye and head both falling
    d + 0.1,
    1.5,
    3 - 0.01,
    // eye and head both on the reflected segment, past the turn
    3 + d + window / 2 + 0.01,
    3 + 2.6,
  ];
  for (const tau of taus) {
    const view = rideView(path, bounds, held, tau);
    const k = camera(view, page);
    const h = head(paraboloid, timeline, 8, 4, tau);
    const p = project(k, h);
    expect(p.x).toBeCloseTo(600, 6);
    expect(p.y).toBeCloseTo(450, 6);
    // In front of the eye, a follow distance away along the ray.
    expect(p.depth).toBeGreaterThan(0);
    expect(p.depth).toBeLessThan(1);
    expect(size(sub(h, view.lens!.eye))).toBeCloseTo(d, 9);
  }
  // Looking straight down the falling ray, then straight along the
  // reflected one, exactly.
  near(ridePose(path, 1.5).forward, { x: 0, y: 0, z: -1 }, 12);
  near(ridePose(path, 3 + 2.6).forward, { x: -1, y: 0, z: 0 }, 12);
  expect(ridePose(path, 1.5).stage).toBe("incident");
  expect(ridePose(path, 3 + 2.6).stage).toBe("reflected");
});

test("the camera turns at the interaction over its declared window, continuously and without rolling", () => {
  const { path } = ride(paraboloid, lit());
  const d = 0.9,
    window = 1.8,
    hit = 3;
  // The turn is centered on the eye's arrival at the surface, τ − d = hit.
  const begins = hit + d - window / 2,
    ends = hit + d + window / 2;
  near(ridePose(path, begins).forward, { x: 0, y: 0, z: -1 }, 12);
  near(ridePose(path, ends).forward, { x: -1, y: 0, z: 0 }, 12);
  expect(
    angle(ridePose(path, hit + d).forward, { x: 0, y: 0, z: -1 }),
  ).toBeCloseTo(Math.PI / 4, 12);
  expect(ridePose(path, hit + d).stage).toBe("turning");
  // It starts and ends at rest: a tenth of the way through the window it
  // has turned 3(0.1)² − 2(0.1)³ = 0.028 of the way.
  for (const [s, f] of [
    [0.1, 0.028],
    [0.9, 0.972],
  ])
    expect(
      angle(ridePose(path, begins + s * window).forward, { x: 0, y: 0, z: -1 }),
    ).toBeCloseTo(f * (Math.PI / 2), 12);
  // From τ = 0 to well past the turn: the angle turned grows monotonically
  // from 0 to the deflection, each small step turns a little (smoothstep's
  // steepest rate is 1.5 × deflection / window), and the camera's right,
  // forward × up, never changes.
  const steps = 2000,
    span = 8,
    right0 = cross(ridePose(path, 0).forward, ridePose(path, 0).up);
  let last = 0,
    previous = ridePose(path, 0).forward;
  for (let s = 1; s <= steps; s++) {
    const pose = ridePose(path, (span * s) / steps);
    const turned = angle({ x: 0, y: 0, z: -1 }, pose.forward);
    expect(turned).toBeGreaterThanOrEqual(last - 1e-12);
    expect(angle(previous, pose.forward)).toBeLessThanOrEqual(
      (1.5 * (Math.PI / 2) * (span / steps)) / window + 1e-9,
    );
    expect(dot(pose.forward, pose.up)).toBeCloseTo(0, 12);
    near(cross(pose.forward, pose.up), right0, 12);
    last = turned;
    previous = pose.forward;
  }
  expect(last).toBeCloseTo(Math.PI / 2, 12);
  // Up starts toward the side the ray turns to, so the turn is a pitch.
  near(ridePose(path, 0).up, { x: -1, y: 0, z: 0 }, 12);
});

test("the eye follows the ray's own polyline, the follow distance of optical path behind its head", () => {
  const { path } = ride(paraboloid, lit());
  // Before τ = d the eye is still upstream of the starting wavefront, on the
  // drawn incident line.
  near(ridePose(path, 0).eye, { x: 2, y: 0, z: 4 + 0.9 });
  near(ridePose(path, 0).head, { x: 2, y: 0, z: 4 });
  // Past the surface, on the reflected ray.
  near(ridePose(path, 3 + 0.9 + 0.5).eye, { x: 1.5, y: 0, z: 1 });
  // The ride ends where the drawn ray ends: the head stops at its end, 3
  // along, and the camera rests a follow distance behind it.
  const end = ridePose(path, 3 + 3);
  near(end.head, { x: -1, y: 0, z: 1 });
  near(end.eye, { x: -0.1, y: 0, z: 1 });
  for (const later of [6.5, 9, 40]) {
    near(ridePose(path, later).eye, end.eye, 12);
    near(ridePose(path, later).forward, end.forward, 12);
  }
});

test("past an interface the eye travels at the transmitted index, and under total reflection at the incident one", () => {
  const flat = sheet((i, j) => ({ x: grid(i), y: grid(j), z: 0 }));
  const box = { center: { x: 0, y: 0, z: 0 }, radius: 3 };
  // Straight down into glass: no turn, and n₂ = 1.5 after the surface.
  const glass = lit({ interaction: "refract", n1: 1, n2: 1.5 });
  const down = mirror(
    flat,
    toward(flat, (p) => add(p, { x: 0, y: 0, z: -1 })),
    box,
  );
  const into = ride(down, glass, { i: 4, j: 4 }).path;
  // The wavefront starts at z = 3, so the surface is reached at τ = 3.
  expect(into.hit).toBeCloseTo(3, 12);
  expect(into.outgoing).toBe("refracted");
  near(ridePose(into, 3 + 0.9 + 0.6).eye, { x: 0, y: 0, z: -0.4 });
  expect(ridePose(into, 5).stage).toBe("refracted");
  // From glass toward air beyond the critical angle: reflected, slowed by
  // n₁ = 1.5 on the way back.
  const inside = lit({ interaction: "refract", n1: 1.5, n2: 1 });
  const lines = toward(flat, (p) => add(p, { x: 1, y: 0, z: 1 })).map((l) => ({
    ...l,
    back: l.point,
    total: true,
  }));
  const reflected = ride(mirror(flat, lines, box), inside, { i: 4, j: 4 }).path;
  expect(reflected.outgoing).toBe("totally reflected");
  expect(reflected.hit).toBeCloseTo(4.5, 12);
  const pose = ridePose(reflected, 4.5 + 0.9 + 1.5);
  near(pose.eye, add({ x: 0, y: 0, z: 0 }, unit({ x: 1, y: 0, z: 1 }), 1));
  expect(pose.stage).toBe("totally reflected");
  expect(
    rideReadout(reflected, mirror(flat, lines, box), inside, 4.5 + 0.9 + 1.5),
  ).toContain("totally reflected");
});

test("the eye never takes a ray's virtual extension behind the surface", () => {
  // A dome, z = −(x² + y²)/4, reflects straight-down light away from a
  // virtual focus behind it at (0, 0, −1).
  const dome = sheet((i, j) => ({
    x: grid(i),
    y: grid(j),
    z: -(grid(i) ** 2 + grid(j) ** 2) / 4,
  }));
  const virtualFocus = { x: 0, y: 0, z: -1 };
  const lines = toward(dome, (p) => add(p, sub(p, virtualFocus))).map((l) => ({
    ...l,
    virtual: true,
  }));
  const result = mirror(dome, lines, bounds);
  const { path } = ride(result, lit(), { i: 8, j: 4 });
  const line = lines.find((l) => l.i === 8 && l.j === 4)!;
  const out = unit(sub(line.end, line.point));
  for (let tau = path.hit; tau < path.hit + 8; tau += 0.05) {
    const { eye, forward } = ridePose(path, tau);
    if (tau - 0.9 <= path.hit) continue;
    // On the real reflected ray, ahead of the surface, looking along it.
    expect(dot(sub(eye, line.point), out)).toBeGreaterThan(0);
    expect(size(cross(sub(eye, line.point), out))).toBeLessThan(1e-9);
    expect(dot(forward, out)).toBeGreaterThan(0);
  }
});

test("light returned straight back turns over a declared up, and a grazing ray barely turns", () => {
  const flat = sheet((i, j) => ({ x: grid(i), y: grid(j), z: 0 }));
  const box = { center: { x: 0, y: 0, z: 0 }, radius: 3 };
  const back = mirror(
    flat,
    toward(flat, (p) => add(p, { x: 0, y: 0, z: 1 })),
    box,
  );
  const { path } = ride(back, lit(), { i: 4, j: 4 });
  // Straight down and straight back up: the plane of the turn is not set by
  // the light, so up is +z made perpendicular to the ray or, as here where
  // the ray is vertical, +y; the camera turns over toward it.
  near(ridePose(path, 0).up, { x: 0, y: 1, z: 0 }, 12);
  near(ridePose(path, 3 + 0.9).forward, { x: 0, y: 1, z: 0 }, 12);
  near(ridePose(path, 3 + 0.9 + 0.9).forward, { x: 0, y: 0, z: 1 }, 12);
  // Light at 89.9° from the normal: it turns by 0.2°.
  const tilt = (89.9 * Math.PI) / 180;
  const graze = lit({ elevation: -0.1 });
  const lines = toward(flat, (p) =>
    add(p, { x: Math.sin(tilt), y: 0, z: Math.cos(tilt) }),
  );
  const g = ride(mirror(flat, lines, box), graze, { i: 4, j: 4 }).path;
  let previous = ridePose(g, 0).forward,
    total = 0;
  for (let tau = 0; tau < 20; tau += 0.01) {
    const f = ridePose(g, tau).forward;
    total += angle(previous, f);
    previous = f;
  }
  expect(total).toBeCloseTo((0.2 * Math.PI) / 180, 9);
});

test("the ride's lens sees its head: a near plane well inside the follow distance and a far plane past the study", () => {
  // Following 0.3 behind in glass of index 1.5 is 0.2 behind in length.
  const { path } = ride(
    paraboloid,
    lit({ interaction: "refract", n1: 1, n2: 1.5 }),
    { follow: 0.1 },
  );
  const view = rideView(path, bounds, held, 4);
  const lens = view.lens!;
  expect(lens.projection).toBe("perspective");
  expect(lens.fov).toBe(60);
  expect(lens.near).toBeGreaterThan(0);
  expect(lens.near).toBeLessThanOrEqual((0.25 * 0.3) / 1.5 + 1e-12);
  expect(lens.far).toBeGreaterThanOrEqual(
    size(sub(lens.eye, bounds.center)) + 4 * bounds.radius,
  );
  // The rest of the view is the held one, about the study's bounds, so a
  // released ride's orbit continues from the user's own turntable.
  expect({ ...view, lens: undefined }).toEqual({ ...held, lens: undefined });
});

test("the animation camera rides the ray at its own progress, exactly at both ends", () => {
  const config = lit();
  const { timeline, path } = ride(paraboloid, config);
  const frame = { config, result: paraboloid };
  const at = (progress: number): AnimationView => ({
    frame,
    final: frame,
    camera: "ride",
    heldView: held,
    length: 0,
    progress,
    mode: "trace",
    complete: progress === 1,
    ride: { path, around: bounds, total: timeline.total },
  });
  for (const p of [0, 0.37, 1])
    expect(animationCamera(at(p))).toEqual(
      rideView(path, bounds, held, p * timeline.total),
    );
});

test("a ray is chosen at a crossing of parameter curves and refused where there is none", () => {
  const config = lit();
  const choices = rideChoices(paraboloid, config);
  expect(choices.u.map((c) => c.index)).toEqual([0, 4, 8]);
  expect(choices.u.map((c) => c.value)).toEqual([-2, 0, 2]);
  expect(choices.v.map((c) => c.index)).toEqual([0, 4, 8]);
  // The middle crossing by default, and the nearest otherwise.
  expect(snapRide(paraboloid, defaultRide)).toMatchObject({ i: 4, j: 4 });
  expect(snapRide(paraboloid, setup({ i: 7, j: 1 }))).toMatchObject({
    i: 8,
    j: 0,
  });
  expect(rideError(paraboloid, setup())).toBeNull();
  // An unlit crossing has no ray.
  const unlit = mirror(
    dish,
    paraboloid.rays!.lines.filter((l) => !(l.i === 8 && l.j === 4)),
    bounds,
  );
  expect(rideError(unlit, setup())).toEqual({
    field: "Ray at u",
    message: "meets no light at this v, so there is no ray to ride.",
  });
  expect(
    ridePath(unlit, traceTimeline(unlit, config, bounds), setup(), bounds),
  ).toBeNull();
  for (const [field, bad] of [
    ["Follow distance", { follow: 0 }],
    ["Follow distance", { follow: Number.NaN }],
    ["Follow distance", { follow: 5 }],
    ["Turn window", { turn: 0 }],
    ["Turn window", { turn: 4.5 }],
  ] as const)
    expect(rideError(paraboloid, setup(bad))?.field).toBe(field);
  expect(
    rideReadout(ride(paraboloid, config).path, paraboloid, config, 1.5),
  ).toBe("Riding the ray at u = 2, v = 0 · incident");
});
