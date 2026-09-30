import { test, expect } from "@playwright/test";
import { buildScene, camera, project } from "../web/spatial/scene";
import { linework, linesSvg, type LineGroup } from "../web/spatial/linework";
import { lineColor, hex } from "../web/spatial/palette";
import { defaultLayers, type View } from "../web/spatial/renderer";
import type { SpatialResult, Vec3 } from "../web/spatial/types";

// Vector linework: the drawing's own line geometry, projected by the drawing's
// camera, as SVG paths. These tests build results by hand, so every expected
// pixel comes from the orthographic camera's definition, not the code.
const O = { x: 0, y: 0, z: 0 };
const size = { width: 2000, height: 1520 };
// With zoom 1 and radius 1 the drawing spans radius × 1.16 across the
// shorter side: 760 / 1.16 pixels per unit, the same on both axes.
const unit = 760 / 1.16;
const at = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
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
const view = (v: Partial<View> = {}): View => ({
  center: O,
  radius: 1,
  yaw: 0,
  pitch: 0,
  zoom: 1,
  panX: 0,
  panY: 0,
  ...v,
});
function lines(
  result: SpatialResult,
  options: {
    v?: View;
    layers?: Partial<typeof defaultLayers>;
    dark?: boolean;
    occlusion?: "none" | "sampled";
    limit?: number;
  } = {},
): LineGroup[] {
  return linework(
    buildScene(result),
    options.v ?? view(),
    { ...defaultLayers, ...options.layers },
    options.dark ?? false,
    { ...size, occlusion: options.occlusion ?? "none", limit: options.limit },
  );
}
const group = (groups: LineGroup[], layer: string) =>
  groups.find((g) => g.layer === layer);
const paths = (groups: LineGroup[], layer: string) =>
  group(groups, layer)?.strokes.flatMap((s) => s.paths) ?? [];
// A square in the plane z = f(x), as the surface's two triangles.
function square(z: (x: number) => number, half = 0.5) {
  const corner = (x: number, y: number) => ({
    position: at(x, y, z(x)),
    normal: at(0, 0, 1),
    phase: 0,
    sampleIndex: 0,
  });
  const [a, b, c, d] = [
    corner(-half, -half),
    corner(half, -half),
    corner(half, half),
    corner(-half, half),
  ];
  return [a, b, c, a, c, d];
}

test("the camera projects with the drawing's orthographic scale, pan and zoom", () => {
  const front = camera(view(), size);
  expect(project(front, at(0, 0, 0))).toMatchObject({ x: 1000, y: 760 });
  const p = project(front, at(1, 0.5, 0));
  expect(p.x).toBeCloseTo(1000 + unit, 6);
  // Screen y grows downward.
  expect(p.y).toBeCloseTo(760 - 0.5 * unit, 6);
  // The view center is drawn at the middle; pan moves the drawing.
  const moved = camera(
    view({ center: at(2, 3, 4), panX: 0.25, panY: -0.5, zoom: 2 }),
    size,
  );
  const q = project(moved, at(2, 3, 4));
  expect(q.x).toBeCloseTo(1000 + 0.25 * 2 * unit, 6);
  expect(q.y).toBeCloseTo(760 + 0.5 * 2 * unit, 6);
  // A quarter turn of yaw carries +z to the right and +x away from the
  // viewer: nearer points have smaller depth.
  const turned = camera(view({ yaw: Math.PI / 2 }), size);
  expect(project(turned, at(0, 0, 1)).x).toBeCloseTo(1000 + unit, 6);
  expect(project(turned, at(1, 0, 0)).x).toBeCloseTo(1000, 6);
  expect(project(turned, at(1, 0, 0)).depth).toBeCloseTo(0.625, 6);
  expect(project(turned, at(-1, 0, 0)).depth).toBeCloseTo(0.375, 6);
  // A portrait page scales by its width instead.
  const tall = camera(view(), { width: 1000, height: 2000 });
  expect(project(tall, at(1, 1, 0)).x).toBeCloseTo(500 + 500 / 1.16, 6);
  expect(project(tall, at(1, 1, 0)).y).toBeCloseTo(1000 - 500 / 1.16, 6);
});

test("paths follow the engine's points and never join across gaps or breaks", () => {
  const points = [
    at(-0.9, 0, 0),
    at(-0.6, 0.2, 0),
    at(-0.3, 0, 0),
    null,
    at(0.1, 0.1, 0),
    at(0.4, -0.2, 0),
    at(0.7, 0.3, 0),
  ];
  const result = study({
    base: points,
    breaks: [false, false, false, false, false, true, false],
  });
  // breaks[i] separates sample i from the one before it.
  const drawn = paths(lines(result), "base");
  const cam = camera(view(), size);
  const expected = (ps: Vec3[]) =>
    ps.map((p) => {
      const q = project(cam, p);
      return [q.x, q.y];
    });
  expect(drawn).toHaveLength(2);
  const close = (a: number[][], b: number[][]) => {
    expect(a).toHaveLength(b.length);
    a.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(b[i][0], 3);
      expect(p[1]).toBeCloseTo(b[i][1], 3);
    });
  };
  close(drawn[0], expected(points.slice(0, 3) as Vec3[]));
  close(drawn[1], expected(points.slice(5, 7) as Vec3[]));
});

test("only shown layers are drawn, with the base always present", () => {
  const result = study({
    base: [at(0, 0, 0), at(0.5, 0, 0)],
    breaks: [false, false],
    involute: {
      members: [
        {
          offset: 1,
          points: [at(0, 0.2, 0), at(0.5, 0.2, 0)],
          collapsed: false,
        },
      ],
      strings: [{ from: at(0, 0, 0), to: at(0, 0.2, 0), sampleIndex: 0 }],
      unreached: 0,
    },
  });
  const all = lines(result);
  expect(all.map((g) => g.layer)).toEqual(["strings", "filaments", "base"]);
  const some = lines(result, { layers: { filaments: false, strings: false } });
  expect(some.map((g) => g.layer)).toEqual(["base"]);
});

test("lines are clipped to the page and to the drawing's depth range", () => {
  const across = paths(
    lines(study({ base: [at(0, 0, 0), at(10, 0, 0)], breaks: [false, false] })),
    "base",
  );
  expect(across).toHaveLength(1);
  expect(across[0][0]).toEqual([1000, 760]);
  expect(across[0][1][0]).toBeCloseTo(2000, 6);
  expect(across[0][1][1]).toBeCloseTo(760, 6);
  // The drawing keeps depths within four radii of the center.
  const deep = paths(
    lines(
      study({ base: [at(-1, 0, -10), at(1, 0, 10)], breaks: [false, false] }),
    ),
    "base",
  );
  expect(deep[0][0][0]).toBeCloseTo(1000 - 0.4 * unit, 6);
  expect(deep[0][1][0]).toBeCloseTo(1000 + 0.4 * unit, 6);
  const gone = lines(
    study({ base: [at(3, 0, 0), at(4, 0, 0)], breaks: [false, false] }),
  );
  expect(paths(gone, "base")).toHaveLength(0);
});

test("a family's members keep the drawing's colors in either theme", () => {
  const members = [0, 1, 2].map((k) => ({
    offset: k,
    points: [at(-0.5, 0.1 * k, 0), at(0.5, 0.1 * k, 0)],
    collapsed: false,
  }));
  const result = study({
    base: [at(-0.5, -0.3, 0), at(0.5, -0.3, 0)],
    breaks: [false, false],
    involute: { members, strings: [], unreached: 0 },
  });
  for (const dark of [false, true]) {
    const filaments = group(lines(result, { dark }), "filaments")!;
    expect(filaments.strokes.map((s) => s.color)).toEqual(
      [0, 0.5, 1].map((u) => hex(lineColor(3, u, dark))),
    );
    expect(group(lines(result, { dark }), "base")!.strokes[0].color).toBe(
      hex(lineColor(2, 0, dark)),
    );
  }
  expect(hex(lineColor(3, 0, false))).not.toBe(hex(lineColor(3, 0, true)));
});

test("sampled visibility hides only what a shown sheet covers", () => {
  const sheet = square(() => 0);
  const line = (z: number, y = 0.1) =>
    study({
      base: [at(-1, y, z), at(1, y, z)],
      breaks: [false, false],
      mesh: sheet,
    });
  const edge = (x: number) => 1000 + x * unit;
  // Behind the sheet: split where the square's sides project.
  const behind = paths(lines(line(-0.2), { occlusion: "sampled" }), "base");
  expect(behind).toHaveLength(2);
  expect(behind[0][0][0]).toBeCloseTo(edge(-1), 6);
  expect(Math.abs(behind[0].at(-1)![0] - edge(-0.5))).toBeLessThan(1);
  expect(Math.abs(behind[1][0][0] - edge(0.5))).toBeLessThan(1);
  expect(behind[1].at(-1)![0]).toBeCloseTo(edge(1), 6);
  // In the sheet, in front of it, with the surface hidden, or with every
  // line requested: whole.
  for (const whole of [
    lines(line(0), { occlusion: "sampled" }),
    lines(line(0.2), { occlusion: "sampled" }),
    lines(line(-0.2), { occlusion: "sampled", layers: { surface: false } }),
    lines(line(-0.2), { occlusion: "none" }),
  ]) {
    const drawn = paths(whole, "base");
    expect(drawn).toHaveLength(1);
    expect(drawn[0][0][0]).toBeCloseTo(edge(-1), 6);
    expect(drawn[0].at(-1)![0]).toBeCloseTo(edge(1), 6);
  }
});

test("a line lying on a steep sheet stays visible; one just behind it does not", () => {
  const slope = 3;
  const sheet = square((x) => slope * x);
  const on = study({
    base: [at(-0.4, 0.1, -0.4 * slope), at(0.4, 0.1, 0.4 * slope)],
    breaks: [false, false],
    mesh: sheet,
  });
  const drawn = paths(lines(on, { occlusion: "sampled" }), "base");
  expect(drawn).toHaveLength(1);
  // Behind by a tenth of a unit along the view: hidden over the sheet.
  const below = study({
    base: [at(-0.4, 0.1, -0.4 * slope - 0.1), at(0.4, 0.1, 0.4 * slope - 0.1)],
    breaks: [false, false],
    mesh: sheet,
  });
  expect(paths(lines(below, { occlusion: "sampled" }), "base")).toHaveLength(0);
});

test("visibility testing stops at its work limit instead of saving part", () => {
  const result = study({
    base: [at(-1, 0.1, -0.2), at(1, 0.1, -0.2)],
    breaks: [false, false],
    mesh: square(() => 0),
  });
  expect(() => lines(result, { occlusion: "sampled", limit: 1000 })).toThrow(
    /work limit/,
  );
  expect(() => lines(result, { occlusion: "none", limit: 1000 })).not.toThrow();
});

test("the SVG holds paths and metadata, with no text or embedded image", () => {
  const result = study({
    base: [at(-0.5, 0, 0), at(0, 0.3, 0), at(0.5, 0, 0)],
    breaks: [false, false, false],
  });
  for (const dark of [false, true]) {
    const svg = linesSvg(lines(result, { dark }), {
      ...size,
      dark,
      title: "Tangent Garden — spatial curve <test>",
      metadata: { note: "a & b" },
    });
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toContain('viewBox="0 0 2000 1520"');
    expect(svg).not.toMatch(/<text|<image|<foreignObject/);
    expect(svg).toContain(
      "<title>Tangent Garden — spatial curve &lt;test&gt;</title>",
    );
    const desc = svg.match(/<desc>(.*)<\/desc>/)![1];
    const meta = JSON.parse(
      desc
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&amp;", "&"),
    );
    expect(meta.note).toBe("a & b");
    expect(svg).toContain('<g id="base"');
    expect(svg).toContain(`stroke="${hex(lineColor(2, 0, dark))}"`);
    expect(svg).toMatch(/d="M1000 760|d="M[0-9.]+ [0-9.]+L[0-9.]+ [0-9.]+L/);
    // Coordinates are rounded to hundredths of a pixel.
    expect(svg).not.toMatch(/\d\.\d{3}/);
  }
});

// A cylinder x = cos θ, z = sin θ, meshed in rows along y like a ruled
// surface, with its rulings (mesh edges) drawn as lines. From the front, the
// near half's rulings lie on the sheet and must stay whole, even where it
// turns edge-on; the far half's are hidden behind it.
test("rulings lying on a curved sheet stay whole where it turns edge-on", () => {
  const columns = 96,
    rows = 12;
  const point = (k: number, j: number) => {
    const t = (2 * Math.PI * k) / columns;
    return at(Math.cos(t), -0.5 + j / rows, Math.sin(t));
  };
  const normal = (k: number) => {
    const t = (2 * Math.PI * k) / columns;
    return at(Math.cos(t), 0, Math.sin(t));
  };
  const mesh: SpatialResult["mesh"] = [];
  for (let k = 0; k < columns; k++)
    for (let j = 0; j < rows; j++) {
      const corner = (dk: number, dj: number) => ({
        position: point(k + dk, j + dj),
        normal: normal(k + dk),
        phase: 0,
        sampleIndex: k,
      });
      const [a, b, c, d] = [
        corner(0, 0),
        corner(1, 0),
        corner(1, 1),
        corner(0, 1),
      ];
      mesh.push(a, b, c, a, c, d);
    }
  const rulings = Array.from({ length: columns }, (_, k) => ({
    from: point(k, 0),
    to: point(k, rows),
    sampleIndex: k,
  }));
  const result = study({ mesh, rulings });
  for (const pitch of [0, 0.3]) {
    const drawn = group(
      lines(result, { occlusion: "sampled", v: view({ pitch }) }),
      "rulings",
    )!.strokes.flatMap((s) => s.paths);
    // Every ruling on the near half (sin θ > 0) is one unbroken path. Head
    // on, the far half's (sin θ < 0) are gone, apart from where the sheet
    // turns edge-on at θ = 0 and π.
    const near = rulings.filter(
      (_, k) => Math.sin((2 * Math.PI * k) / columns) > 0.05,
    );
    // Seen from above, the open cylinder shows the far wall's inside over
    // its rim, so only the head-on view bounds the count.
    if (pitch === 0) expect(drawn.length).toBeLessThanOrEqual(near.length + 6);
    expect(drawn.length).toBeGreaterThanOrEqual(near.length);
    const cam = camera(view({ pitch }), size);
    for (const r of near) {
      const [a, b] = [r.from, r.to].map((p) => project(cam, p));
      const whole = drawn.some(
        (path) =>
          path.length === 2 &&
          Math.hypot(path[0][0] - a.x, path[0][1] - a.y) < 1e-3 &&
          Math.hypot(path[1][0] - b.x, path[1][1] - b.y) < 1e-3,
      );
      expect(whole, `ruling at x ${r.from.x.toFixed(3)}`).toBe(true);
    }
  }
});

// A hyperbolic paraboloid z = x·y/…, meshed like a ruled surface between two
// twisted threads: long, thin triangles whose planes differ sharply from
// their neighbours'. Seen near edge-on, each ruling (a mesh edge) lies on
// the sheet and must not flicker in and out along its length.
test("rulings on a twisted, thinly meshed sheet stay whole", () => {
  const columns = 160,
    twist = 2.5;
  const a = (k: number) => at(-0.9 + (1.8 * k) / columns, -0.6, 0);
  const b = (k: number) => {
    const x = -0.9 + (1.8 * k) / columns;
    return at(x, 0.6, twist * x);
  };
  const mesh: SpatialResult["mesh"] = [];
  const v = (position: Vec3) => ({
    position,
    normal: at(0, 0, 1),
    phase: 0,
    sampleIndex: 0,
  });
  for (let k = 0; k < columns; k++)
    mesh.push(v(a(k)), v(a(k + 1)), v(b(k + 1)), v(a(k)), v(b(k + 1)), v(b(k)));
  const rulings = Array.from({ length: columns + 1 }, (_, k) => ({
    from: a(k),
    to: b(k),
    sampleIndex: k,
  }));
  const result = study({ mesh, rulings });
  const length = (ps: number[][][]) =>
    ps.reduce(
      (sum, p) => sum + Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]),
      0,
    );
  for (const [yaw, pitch] of [
    [0, 0],
    [0.3, 0.2],
    [0.2, 0.4],
    [0.35, 0.1],
    [0.38, 0.05],
    [0.3, 0.75],
    [1.2, 0.2],
  ]) {
    const cam = camera(view({ yaw, pitch }), size);
    // The strip folds over itself on the page where its triangles' page
    // orientations disagree; only then can it hide its own rulings.
    const turn = (p: Vec3, q: Vec3, r: Vec3) => {
      const [u, v, w] = [p, q, r].map((x) => project(cam, x));
      return Math.sign((v.x - u.x) * (w.y - u.y) - (v.y - u.y) * (w.x - u.x));
    };
    const folds =
      new Set(
        Array.from({ length: columns }, (_, k) => [
          turn(a(k), a(k + 1), b(k + 1)),
          turn(a(k), b(k + 1), b(k)),
        ]).flat(),
      ).size > 1;
    const all = paths(lines(result, { v: view({ yaw, pitch }) }), "rulings");
    const shown = paths(
      lines(result, { occlusion: "sampled", v: view({ yaw, pitch }) }),
      "rulings",
    );
    const where = `yaw ${yaw}, pitch ${pitch}`;
    if (folds) {
      expect(length(shown), where).toBeLessThan(length(all) * 0.99);
      continue;
    }
    // Unfolded, no ruling is hidden by the sheet it lies on: sampled hiding
    // keeps every one whole, like drawing every line.
    expect(shown.length, where).toBe(all.length);
    expect(length(shown), where).toBeCloseTo(length(all), 6);
  }
});

test("a break between points one above another still separates them", () => {
  const drawn = paths(
    lines(
      study({
        base: [at(0, -0.4, 0), at(0, -0.2, 0), at(0, 0.2, 0), at(0, 0.4, 0)],
        breaks: [false, false, true, false],
      }),
    ),
    "base",
  );
  expect(drawn).toHaveLength(2);
  expect(drawn.map((p) => p.length)).toEqual([2, 2]);
});

test("sheets are never drawn as lines, and hide nothing within the drawing's offset", () => {
  const slope = 3;
  // One pixel across the page changes the sheet's depth by slope / 8 per
  // unit, over `unit` pixels per unit; along the view, depth is z / 8.
  const offset = (8 * (slope / 8)) / unit;
  const behind = (by: number) =>
    study({
      base: [at(-0.4, 0.1, -0.4 * slope - by), at(0.4, 0.1, 0.4 * slope - by)],
      breaks: [false, false],
      mesh: square((x) => slope * x),
    });
  const near = lines(behind(offset / 2), { occlusion: "sampled" });
  expect(near.map((g) => g.layer)).toEqual(["base"]);
  expect(paths(near, "base")).toHaveLength(1);
  expect(
    paths(lines(behind(offset * 3), { occlusion: "sampled" }), "base"),
  ).toHaveLength(0);
});

test("line samples count toward the work limit too", () => {
  const result = study({
    base: [at(-1, 0, 0), at(1, 0, 0)],
    breaks: [false, false],
  });
  expect(() => lines(result, { occlusion: "sampled", limit: 1000 })).toThrow(
    /work limit/,
  );
  expect(paths(lines(result, { occlusion: "sampled" }), "base")).toHaveLength(
    1,
  );
});

test("a sheet of triangles smaller than a pixel still hides what is behind it", () => {
  // A patch 60 pixels across, in cells a fifth of a pixel wide.
  const half = 30 / unit,
    cells = 300,
    step = (2 * half) / cells;
  const mesh: SpatialResult["mesh"] = [];
  const v = (x: number, y: number) => ({
    position: at(x, y, 0.1),
    normal: at(0, 0, 1),
    phase: 0,
    sampleIndex: 0,
  });
  for (let i = 0; i < cells; i++)
    for (let j = 0; j < cells; j++) {
      const x = -half + i * step,
        y = -half + j * step;
      mesh.push(
        v(x, y),
        v(x + step, y),
        v(x + step, y + step),
        v(x, y),
        v(x + step, y + step),
        v(x, y + step),
      );
    }
  const result = study({
    base: [at(-2 * half, 0.3 * half, 0), at(2 * half, 0.3 * half, 0)],
    breaks: [false, false],
    mesh,
  });
  const drawn = paths(lines(result, { occlusion: "sampled" }), "base");
  expect(drawn).toHaveLength(2);
  expect(Math.abs(drawn[0][1][0] - (1000 - 30))).toBeLessThan(1.5);
  expect(Math.abs(drawn[1][0][0] - (1000 + 30))).toBeLessThan(1.5);
});
