import { test, expect } from "@playwright/test";
import {
  buildScene,
  camera,
  clip,
  project,
  type Lens,
  type View,
} from "../web/spatial/scene";
import { linework, type LineGroup } from "../web/spatial/linework";
import { defaultLayers } from "../web/spatial/renderer";
import { dashesPerUnit, dashOn } from "../web/spatial/sight";
import type { SpatialResult, Vec3 } from "../web/spatial/types";

// The perspective camera, which the camera that rides a ray looks through.
// Expected pixels come from the pinhole camera's definition: a point at
// distance D ahead of the eye and h to one side is drawn h / (D tan(fov/2))
// of the half page from the middle, along the page's shorter side, and its
// window depth is affine in 1/D, 0 at the near plane and 1 at the far one.
const O = { x: 0, y: 0, z: 0 };
const at = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const size = { width: 2000, height: 1520 };
const half = 760;
const lens = (l: Partial<Lens> = {}): Lens => ({
  projection: "perspective",
  eye: at(0, 0, 1),
  forward: at(1, 0, 0),
  up: at(0, 0, 1),
  fov: 60,
  near: 0.05,
  far: 40,
  ...l,
});
const view = (l: Partial<Lens> = {}): View => ({
  center: O,
  radius: 1,
  yaw: 0.3,
  pitch: 0.75,
  zoom: 1,
  panX: 0,
  panY: 0,
  lens: lens(l),
});
const t30 = Math.tan(Math.PI / 6);

test("the perspective camera draws a pinhole's picture along its eye, forward and up", () => {
  const k = camera(view(), size);
  // On the axis at any distance: the middle of the page.
  for (const d of [0.1, 1, 7, 30]) {
    const p = project(k, at(d, 0, 1));
    expect(p.x).toBeCloseTo(1000, 6);
    expect(p.y).toBeCloseTo(760, 6);
  }
  // Up is up the page; right is forward × up, here −y.
  const up = project(k, at(4, 0, 1 + 0.5));
  expect(up.x).toBeCloseTo(1000, 6);
  expect(up.y).toBeCloseTo(760 - (0.5 / (4 * t30)) * half, 6);
  const right = project(k, at(2, -0.3, 1));
  expect(right.x).toBeCloseTo(1000 + (0.3 / (2 * t30)) * half, 6);
  expect(right.y).toBeCloseTo(760, 6);
  // Window depth is affine in 1/D.
  const depth = (d: number) => (1 / 0.05 - 1 / d) / (1 / 0.05 - 1 / 40);
  for (const d of [0.05, 0.3, 2, 11, 40])
    expect(project(k, at(d, 0.2, 0.9)).depth).toBeCloseTo(depth(d), 6);
  // A portrait page measures the field across its width.
  const tall = camera(view(), { width: 1000, height: 2000 });
  expect(project(tall, at(2, -0.3, 1)).x).toBeCloseTo(
    500 + (0.3 / (2 * t30)) * 500,
    6,
  );
  // An up that leans along forward is made perpendicular to it.
  const leaning = camera(view({ up: at(0.4, 0, 2) }), size);
  for (const q of [at(4, 0, 1.5), at(2, -0.3, 1), at(3, 1, -2)]) {
    expect(project(leaning, q).x).toBeCloseTo(project(k, q).x, 6);
    expect(project(leaning, q).y).toBeCloseTo(project(k, q).y, 6);
  }
  // Points nearer than the near plane, or behind the eye, are outside the
  // clip volume.
  for (const q of [at(0.04, 0, 1), at(-1, 0, 1), at(41, 0, 1)]) {
    const c = clip(k, q.x, q.y, q.z);
    expect(Math.abs(c[2]) > c[3]).toBe(true);
  }
});

test("an orthographic view keeps unit w, so its drawing is unchanged", () => {
  const ortho: View = { ...view(), lens: undefined };
  const k = camera(ortho, size);
  const c = clip(k, 0.3, -0.2, 0.7);
  expect(c).toHaveLength(4);
  expect(c[3]).toBe(1);
});

function study(parts: Partial<SpatialResult>): SpatialResult {
  return {
    base: [],
    minus: [],
    plus: [],
    breaks: [],
    mesh: [],
    rulings: [],
    bounds: { center: O, radius: 1 },
    radius: 1,
    omitted: 0,
    invalid: 0,
    ...parts,
  };
}
// A floor at z = 0 reaching far behind the eye, as the surface's two
// triangles.
function floor(reach = 50) {
  const corner = (x: number, y: number) => ({
    position: at(x, y, 0),
    normal: at(0, 0, 1),
    phase: 0,
    sampleIndex: 0,
  });
  const [a, b, c, d] = [
    corner(-reach, -reach),
    corner(reach, -reach),
    corner(reach, reach),
    corner(-reach, reach),
  ];
  return [a, b, c, a, c, d];
}
const paths = (groups: LineGroup[], layer: string, hidden = false) =>
  groups
    .filter((g) => g.layer === layer && !!g.hidden === hidden)
    .flatMap((g) => g.strokes.flatMap((s) => s.paths));
function lines(
  result: SpatialResult,
  v: View,
  occlusion: "none" | "sampled",
  extra: Partial<Parameters<typeof linework>[4]> = {},
  cut?: Parameters<typeof linework>[6],
) {
  return linework(
    buildScene(result),
    v,
    { ...defaultLayers },
    false,
    { ...size, occlusion, ...extra },
    [],
    cut,
  );
}

test("linework projects through the perspective camera and is cut at its near plane", () => {
  const k = camera(view(), size);
  const ahead = [at(2, 0.5, 0.4), at(6, -1, 1.8), at(12, 2, 0.2)];
  const drawn = paths(
    lines(
      study({ base: ahead, breaks: [false, false, false] }),
      view(),
      "none",
    ),
    "base",
  );
  expect(drawn).toHaveLength(1);
  drawn[0].forEach(([x, y], i) => {
    expect(x).toBeCloseTo(project(k, ahead[i]).x, 3);
    expect(y).toBeCloseTo(project(k, ahead[i]).y, 3);
  });
  // From behind the eye to in front of it: drawn from where it crosses the
  // near plane, never as the inverted image of the part behind. The line
  // passes through Q on the near plane, halfway from B behind the eye to F.
  const Q = at(0.05, 0.01, 1),
    F = at(3, 0.3, 0.6),
    B = at(2 * Q.x - F.x, 2 * Q.y - F.y, 2 * Q.z - F.z);
  const through = paths(
    lines(study({ base: [B, F], breaks: [false, false] }), view(), "none"),
    "base",
  );
  expect(through).toHaveLength(1);
  const [first, last] = [through[0][0], through[0].at(-1)!];
  expect(first[0]).toBeCloseTo(project(k, Q).x, 3);
  expect(first[1]).toBeCloseTo(project(k, Q).y, 3);
  expect(last[0]).toBeCloseTo(project(k, F).x, 3);
  expect(last[1]).toBeCloseTo(project(k, F).y, 3);
  // Wholly behind the eye: nothing.
  expect(
    paths(
      lines(
        study({ base: [at(-3, 0, 1), at(-1, 0, 1)], breaks: [false, false] }),
        view(),
        "none",
      ),
      "base",
    ),
  ).toHaveLength(0);
});

test("a sheet reaching behind the eye hides only what it covers in perspective", () => {
  const result = (z: number) =>
    study({
      mesh: floor(),
      base: [at(1.5, 0, z), at(20, 0, z)],
      breaks: [false, false],
    });
  // Below the floor, the line is hidden along its whole length; above it,
  // nothing hides it. A floor whose corners behind the eye were projected
  // without clipping would cover the wrong part of the page.
  const below = lines(result(-0.4), view(), "sampled", { hidden: "faint" });
  expect(paths(below, "base")).toHaveLength(0);
  expect(paths(below, "base", true)).toHaveLength(1);
  const above = lines(result(0.4), view(), "sampled", { hidden: "faint" });
  expect(paths(above, "base")).toHaveLength(1);
  expect(paths(above, "base", true)).toHaveLength(0);
});

test("a cut sheet in perspective hides lines up to where its cut is seen", () => {
  // The floor is cut away beyond x = 5. Below it at z = −0.2, seen from the
  // eye at height 1, the floor covers the line where the sight line meets
  // the floor before x = 5: up to x = 5 × 1.2 = 6 along the line. A cut
  // interpolated affinely on the page, not as the drawing's perspective
  // varying, would put the change elsewhere.
  const k = camera(view(), size);
  const groups = lines(
    study({
      mesh: floor(),
      base: [at(2, 0, -0.2), at(30, 0, -0.2)],
      breaks: [false, false],
    }),
    view(),
    "sampled",
    { hidden: "faint" },
    {
      plane: { normal: at(1, 0, 0), offset: 5 },
      scope: "surface",
      edge: false,
    },
  );
  const hidden = paths(groups, "base", true),
    shown = paths(groups, "base");
  expect(hidden).toHaveLength(1);
  expect(shown).toHaveLength(1);
  const change = project(k, at(6, 0, -0.2));
  expect(Math.abs(hidden[0].at(-1)![1] - change.y)).toBeLessThan(1);
  expect(Math.abs(shown[0][0][1] - change.y)).toBeLessThan(1);
});

test("dashes behind a sheet keep their length in space under perspective", () => {
  // Dash k covers arc lengths k/λ to (k + dashOn)/λ along the line, with λ
  // dash periods per unit of length; the page shortens far dashes. A dash
  // placed by its fraction of the run on the page, not in space, would
  // drift from these points by several pixels.
  const k = camera(view(), size);
  const from = at(1.5, 0, -0.4),
    to = at(4, 0, -0.4);
  const length = to.x - from.x,
    perUnit = dashesPerUnit(view());
  const expected: { x: number; y: number }[] = [];
  for (let n = 0; n <= length * perUnit; n++)
    for (const a of [n / perUnit, (n + dashOn) / perUnit])
      if (a <= length) expected.push(project(k, at(from.x + a, 0, -0.4)));
  // Hidden along its whole length; with the floor cut away beyond x = 2.5,
  // hidden only up to x = 2.5 × 1.4 = 3.5, so the dashed run ends partway
  // along the segment; and with it cut away before x = 2.5, hidden only
  // from there, so the dashed run starts partway.
  const cut = (sign: number) => ({
    plane: { normal: at(sign, 0, 0), offset: 2.5 * sign },
    scope: "surface" as const,
    edge: false,
  });
  for (const c of [undefined, cut(1), cut(-1)]) {
    const groups = lines(
      study({ mesh: floor(), base: [from, to], breaks: [false, false] }),
      view(),
      "sampled",
      { hidden: "dashed" },
      c,
    );
    const dashed = paths(groups, "base", true);
    expect(dashed.length).toBeGreaterThan(c ? 10 : 50);
    if (c) {
      // Shown from where the floor's cut is seen, and dashed only before.
      const shown = paths(groups, "base"),
        change = project(k, at(3.5, 0, -0.4));
      expect(shown).toHaveLength(1);
      // Nearer points are lower on the page.
      const before = c.plane.normal.x > 0;
      expect(Math.abs(shown[0][before ? 0 : 1][1] - change.y)).toBeLessThan(1);
      for (const d of dashed)
        for (const [, y] of d)
          if (before) expect(y).toBeGreaterThan(change.y - 1);
          else expect(y).toBeLessThan(change.y + 1);
      // and reach it, within the page length of one dash period there.
      const period = Math.abs(
        project(k, at(3.5 + 1 / perUnit, 0, -0.4)).y - change.y,
      );
      const reach = Math.min(
        ...dashed.flatMap((d) => d.map(([, y]) => Math.abs(y - change.y))),
      );
      expect(reach).toBeLessThan(period);
    }
    const ends = dashed.flatMap((d) => [d[0], d.at(-1)!]).slice(1, -1);
    for (const [x, y] of ends) {
      const off = Math.min(
        ...expected.map((e) => Math.hypot(e.x - x, e.y - y)),
      );
      expect(off).toBeLessThan(0.05);
    }
  }
});
