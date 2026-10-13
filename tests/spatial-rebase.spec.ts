import { test, expect, type Page } from "@playwright/test";
import { deflateRawSync } from "node:zlib";
import { decodePng } from "./png";
import { buildScene, scenePasses, type Batch } from "../web/spatial/scene";
import { linework, type LineGroup } from "../web/spatial/linework";
import { cutEdges, sweepExtent, type CutSpec } from "../web/spatial/cut";
import { drawingGap } from "../web/spatial/loop";
import { probeBatches, type CurveProbe } from "../web/spatial/probe";
import { spatialPresets } from "../web/spatial/presets";
import { defaultLayers, type View } from "../web/spatial/renderer";
import type { SpatialResult, Vec3 } from "../web/spatial/types";
import { curveMesh, type MeshVertex } from "./curve-mesh";

// A study far from the origin is drawn as the same study at the origin:
// positions are measured from a point near the study before they become
// single precision (see docs/mathematics.md, "Spatial scale and
// translation"). Each test builds a study by hand and its copy moved by T,
// as far out as the engine's own translated copies (engine3's
// similarity_test.go), and compares what the drawing is made of. In single
// precision a coordinate near 7,000 is held to about 0.0005, a sixth of a
// pixel here at zoom 1 and far more zoomed in.
const T: Vec3 = { x: 5000, y: -3000, z: 4000 };
const O: Vec3 = { x: 0, y: 0, z: 0 };
const size = { width: 2000, height: 1520 };
const at = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const moved = (p: Vec3, by: Vec3) => at(p.x + by.x, p.y + by.y, p.z + by.z);

// A helix of radius 0.8, its tangent ribbon as a mesh, and a few rulings,
// within a unit of the origin, with a square sheet facing the camera in
// front of it, beyond the cut's plane, then moved by `by`. Its bounds'
// center moves by `by` and `aside`.
function study(by: Vec3 = O, aside: Vec3 = O): SpatialResult {
  const n = 96,
    point = (k: number) => {
      const t = -Math.PI + (2 * Math.PI * k) / n;
      return at(0.8 * Math.cos(t), 0.8 * Math.sin(t), 0.15 * t);
    };
  const tangent = (k: number) => {
    const t = -Math.PI + (2 * Math.PI * k) / n;
    return at(-0.8 * Math.sin(t), 0.8 * Math.cos(t), 0.15);
  };
  const base = Array.from({ length: n + 1 }, (_, k) => moved(point(k), by));
  const out = (k: number) => {
    const p = point(k),
      d = tangent(k);
    return moved(at(p.x + 0.5 * d.x, p.y + 0.5 * d.y, p.z + 0.5 * d.z), by);
  };
  const corners: MeshVertex[] = [];
  const corner = (position: Vec3, k: number): MeshVertex => ({
    position,
    normal: at(Math.cos(k / 7), Math.sin(k / 7), 0.3),
    phase: k / n,
    sampleIndex: k,
  });
  for (let k = 0; k < n; k++) {
    const [a, b, c, d] = [base[k], base[k + 1], out(k + 1), out(k)];
    corners.push(corner(a, k), corner(b, k), corner(c, k));
    corners.push(corner(a, k), corner(c, k), corner(d, k));
  }
  // The square: 0.6 across, about 0.9 toward the viewer and 0.5 along the
  // cut's normal, whose side n̂·p − 0.1 is at least 0.2 at every corner.
  const back = at(-0.321, 0.565, 0.76),
    right = at(0.921, 0, 0.389),
    up = at(0.22, 0.825, -0.52),
    middle = at(0.9 * back.x + 0.475, 0.9 * back.y + 0.145, 0.9 * back.z + 0.1);
  const square = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([i, j]) =>
    moved(
      at(
        middle.x + 0.3 * (i * right.x + j * up.x),
        middle.y + 0.3 * (i * right.y + j * up.y),
        middle.z + 0.3 * (i * right.z + j * up.z),
      ),
      by,
    ),
  );
  for (const k of [0, 1, 2, 0, 2, 3])
    corners.push({
      position: square[k],
      normal: back,
      phase: 0,
      sampleIndex: 0,
    });
  return {
    base,
    minus: base,
    plus: Array.from({ length: n + 1 }, (_, k) => out(k)),
    breaks: base.map(() => false),
    mesh: curveMesh(corners),
    rulings: [0, 24, 48, 72, 96].map((k) => ({ from: base[k], to: out(k) })),
    bounds: {
      center: moved(moved(at(0.1, -0.05, 0.02), by), aside),
      radius: 1.2,
    },
    radius: 1.2,
    omitted: 0,
    invalid: 0,
  };
}
const view = (center: Vec3, v: Partial<View> = {}): View => ({
  center,
  radius: 1.2,
  yaw: 0.4,
  pitch: 0.6,
  zoom: 1.3,
  panX: 0.05,
  panY: -0.02,
  ...v,
});
// A batch's vertex v in world coordinates.
const world = (b: Batch, v: number): Vec3 => {
  const o = b.origin ?? O;
  return at(
    b.data[7 * v] + o.x,
    b.data[7 * v + 1] + o.y,
    b.data[7 * v + 2] + o.z,
  );
};
// The largest distance between corresponding page points of two lineworks,
// which must have the same layers, colors, widths and paths.
function pageGap(a: LineGroup[], b: LineGroup[], least = 100) {
  expect(b.map((g) => [g.layer, g.hidden])).toEqual(
    a.map((g) => [g.layer, g.hidden]),
  );
  let gap = 0,
    points = 0;
  a.forEach((g, i) => {
    const h = b[i];
    expect(h.strokes.map((s) => [s.color, s.width, s.paths.length])).toEqual(
      g.strokes.map((s) => [s.color, s.width, s.paths.length]),
    );
    g.strokes.forEach((s, j) =>
      s.paths.forEach((path, k) => {
        const other = h.strokes[j].paths[k];
        expect(other.length).toBe(path.length);
        path.forEach(([x, y], m) => {
          gap = Math.max(gap, Math.hypot(x - other[m][0], y - other[m][1]));
          points++;
        });
      }),
    );
  });
  expect(points).toBeGreaterThan(least);
  return gap;
}
const n = (() => {
  const v = at(1, 0.3, 0.2),
    l = Math.hypot(v.x, v.y, v.z);
  return at(v.x / l, v.y / l, v.z / l);
})();
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cutAt = (by: Vec3, scope: CutSpec["scope"] = "all"): CutSpec => ({
  plane: { normal: n, offset: 0.1 + dot(n, by) },
  scope,
  edge: true,
});

test("a study near the origin is uploaded as before, in world coordinates", () => {
  const r = study(),
    scene = buildScene(r);
  for (const { batch } of scenePasses(scene, defaultLayers)) {
    expect(batch.origin).toBeUndefined();
  }
  // The ribbon's first corner, exactly as single precision holds it.
  expect(Array.from(scene.mesh.data.subarray(0, 3))).toEqual(
    [r.base[0].x, r.base[0].y, r.base[0].z].map(Math.fround),
  );
});

for (const [name, v, center] of [
  ["orthographic", {}, at(0.1, -0.05, 0.02)],
  ["perspective", { projection: "normal" }, at(0.1, -0.05, 0.02)],
  ["zoomed in", { zoom: 10 }, at(-0.8, 0.05, 0.45)],
] as const)
  test(`a study far from the origin draws the same lines, ${name}`, () => {
    // Cutting lines too, or only sheets, when the square cut away in front
    // must not hide the lines behind it.
    const lines = (
      by: Vec3,
      occlusion: "none" | "sampled",
      scope: CutSpec["scope"],
    ) =>
      linework(
        buildScene(study(by)),
        view(moved(center, by), v),
        defaultLayers,
        false,
        { ...size, occlusion, hidden: "dashed", weight: "regular" },
        [],
        cutAt(by, scope),
      );
    for (const occlusion of ["none", "sampled"] as const)
      for (const scope of ["all", "sheets"] as const)
        expect(
          pageGap(
            lines(O, occlusion, scope),
            lines(T, occlusion, scope),
            name === "zoomed in" ? 10 : 100,
          ),
        ).toBeLessThan(1e-3);
  });

test("a study far from the origin keeps its cut edge and peel", () => {
  const edge = (by: Vec3) =>
    cutEdges(
      scenePasses(buildScene(study(by)), defaultLayers),
      cutAt(by).plane,
      "all",
    )!;
  const near = edge(O),
    far = edge(T);
  expect(far.data.length).toBe(near.data.length);
  expect(near.data.length).toBeGreaterThan(0);
  for (let v = 0; v < near.data.length / 7; v++) {
    const p = world(near, v),
      q = world(far, v);
    expect(
      Math.hypot(q.x - T.x - p.x, q.y - T.y - p.y, q.z - T.z - p.z),
    ).toBeLessThan(1e-6);
  }
  // Two planes as well, hidden beyond every one.
  const two = (by: Vec3) =>
    cutEdges(
      scenePasses(buildScene(study(by)), defaultLayers),
      cutAt(by).plane,
      "all",
      [{ normal: at(0, 0, 1), offset: by.z }],
    )!;
  const a = two(O),
    b = two(T);
  expect(a.data.length).toBeGreaterThan(0);
  expect(b.data.length).toBe(a.data.length);
  for (let v = 0; v < a.data.length / 7; v++) {
    const p = world(a, v),
      q = world(b, v);
    expect(
      Math.hypot(q.x - T.x - p.x, q.y - T.y - p.y, q.z - T.z - p.z),
    ).toBeLessThan(1e-6);
  }
  // The peel's range of n̂·p moves by n̂·T.
  const [hi, lo] = sweepExtent(
    scenePasses(buildScene(study()), defaultLayers),
    cutAt(O).plane,
    "all",
  )!;
  const [farHi, farLo] = sweepExtent(
    scenePasses(buildScene(study(T)), defaultLayers),
    cutAt(T).plane,
    "all",
  )!;
  expect(Math.abs(farHi - dot(n, T) - hi)).toBeLessThan(1e-6);
  expect(Math.abs(farLo - dot(n, T) - lo)).toBeLessThan(1e-6);
});

test("a level set far from the origin is measured from the study", () => {
  // Two triangles of a square tilted in z, in a box from z = −1 to 1.
  const corners = [
    at(-0.5, -0.5, -0.25),
    at(0.5, -0.5, 0.25),
    at(0.5, 0.5, 0.25),
    at(-0.5, 0.5, -0.25),
  ];
  const level = (by: Vec3) =>
    ({
      box: {
        xMin: by.x - 1,
        xMax: by.x + 1,
        yMin: by.y - 1,
        yMax: by.y + 1,
        zMin: by.z - 1,
        zMax: by.z + 1,
      },
      positions: Float64Array.from(
        corners.flatMap((c) => [c.x + by.x, c.y + by.y, c.z + by.z]),
      ),
      normals: Float64Array.from(corners.flatMap(() => [-0.45, 0, 0.9])),
      triangles: Int32Array.from([0, 1, 2, 0, 2, 3]),
      cut: new Int32Array(),
      open: new Int32Array(),
      sections: [],
      marks: [],
    }) as unknown as NonNullable<SpatialResult["implicit"]>;
  const sheet = (by: Vec3) =>
    buildScene({ ...study(by), implicit: level(by) }).levelSheet;
  const near = sheet(O),
    far = sheet(T);
  expect(near.origin).toBeUndefined();
  expect(far.data.length).toBe(near.data.length);
  for (let v = 0; v < near.data.length / 7; v++) {
    const p = world(near, v),
      q = world(far, v);
    expect(
      Math.hypot(q.x - T.x - p.x, q.y - T.y - p.y, q.z - T.z - p.z),
    ).toBeLessThan(1e-6);
    // The phase is the height in the box, the same in both.
    expect(far.data[7 * v + 6]).toBe(near.data[7 * v + 6]);
  }
});

test("sheets measured from different origins share one cut edge", () => {
  // A plane through both studies: its normal is perpendicular to T.
  const m = at(3 / Math.hypot(3, 5), 5 / Math.hypot(3, 5), 0);
  const plane = { normal: m, offset: 0.1 };
  const sheets = (by: Vec3) =>
    scenePasses(buildScene(study(by)), defaultLayers).filter((p) => p.sheet);
  const near = cutEdges(sheets(O), plane, "all")!,
    both = cutEdges([...sheets(O), ...sheets(T)], plane, "all")!;
  expect(both.data.length).toBe(2 * near.data.length);
  // The far sheet's edge, moved to the near sheet's world coordinates,
  // which hold it to single precision at |T|.
  const half = near.data.length / 7;
  for (let v = 0; v < half; v++) {
    const p = world(near, v),
      q = world(both, half + v);
    expect(
      Math.hypot(q.x - T.x - p.x, q.y - T.y - p.y, q.z - T.z - p.z),
    ).toBeLessThan(1e-3);
  }
});

test("a loop check far from the origin sees a thousandth of the radius", () => {
  const drawn = (by: Vec3) =>
    scenePasses(buildScene(study(by)), defaultLayers).map((p) => p.batch);
  expect(drawingGap(drawn(T), drawn(T), 1.2)).toBe(0);
  // The same drawing a thousandth of its radius further along x, its
  // bounds' center, and so its origin, moved further still.
  const step = moved(T, at(1.2e-3, 0, 0));
  const gap = drawingGap(
    drawn(T),
    scenePasses(buildScene(study(step, at(1e-3, 2e-3, 0))), defaultLayers).map(
      (p) => p.batch,
    ),
    1.2,
  );
  expect(typeof gap).toBe("number");
  expect(Math.abs((gap as number) - 1e-3)).toBeLessThan(1e-5);
});

test("the probe far from the origin draws where it does at the origin", () => {
  const config = spatialPresets.find(
    (p) => p.name === "Helix · a ribbon staircase",
  )!.config;
  const probe = (by: Vec3): CurveProbe => ({
    t: 0.3,
    point: moved(at(0.6, 0.5, 0.05), by),
    tangent: at(-0.6, 0.7, 0.39),
    normal: at(-0.77, -0.64, 0),
    binormal: at(0.25, -0.3, 0.92),
    center: moved(at(0.2, 0.1, 0.05), by),
    curvature: 1.6,
    torsion: 0.3,
    length: null,
    minus: moved(at(0.6, 0.5, 0.05), by),
    plus: moved(at(0.3, 0.85, 0.25), by),
  });
  const lines = (by: Vec3) => {
    const r = study(by);
    return linework(
      buildScene(r),
      view(moved(at(0.6, 0.5, 0.05), by), { zoom: 20 }),
      { ...defaultLayers, surface: false },
      false,
      { ...size, occlusion: "none" },
      probeBatches(r, config, probe(by)),
    ).filter((g) => g.layer === "probe");
  };
  expect(pageGap(lines(O), lines(T), 20)).toBeLessThan(1e-3);
});

// The live drawing: a preset and its copy under p ↦ s p + T, with s = 2⁻⁶,
// so the copy spans a few hundredths of a unit 7,000 units out, where
// single precision holds a coordinate to a fiftieth of its size. Every
// length in the drawing is a fraction of the study's radius, so the copy
// is drawn with the original's pixels.
const s = 2 ** -6;
const helix = spatialPresets.find(
  (p) => p.name === "Helix · a ribbon staircase",
)!.config;
const copy = {
  ...helix,
  length: helix.length * s,
  curve: {
    ...helix.curve,
    x: `${T.x}+${s}*(${helix.curve.x})`,
    y: `${T.y}+${s}*(${helix.curve.y})`,
    z: `${T.z}+${s}*(${helix.curve.z})`,
  },
};
function link(config: typeof helix, extra: object) {
  const study = {
    config,
    view: { yaw: 0.5, pitch: 0.6, zoom: 1, panX: 0, panY: 0 },
    ...extra,
  };
  return `/?study=3d#s=${deflateRawSync(
    Buffer.from(JSON.stringify({ v: 1, notebook: "3d", study })),
  ).toString("base64url")}`;
}
// Each study in a page of its own: changing only the fragment would not
// reload the notebook.
async function canvas(page: Page, href: string) {
  page = await page.context().newPage();
  await page.goto(href);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
  await expect(page.locator(".spatial-stage")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  const url = await page
    .locator("#spatial-artwork")
    .evaluate((c: HTMLCanvasElement) => c.toDataURL("image/png"));
  return decodePng(Buffer.from(url.split(",")[1], "base64"));
}
for (const [name, extra] of [
  ["hairlines", {}],
  [
    "regular strokes dashed behind a cut sheet",
    {
      sight: { weight: "regular", hidden: "dashed" },
      cut: { enabled: true, normal: at(0, 0, 1), offset: 0.5, cuts: "all" },
    },
  ],
] as const)
  test(`the live drawing of a study far from the origin is the original's, ${name}`, async ({
    page,
  }) => {
    const moved = (e: typeof extra) =>
      "cut" in e ? { ...e, cut: { ...e.cut, offset: T.z + s * 0.5 } } : e;
    const a = await canvas(page, link(helix, extra)),
      b = await canvas(page, link(copy, moved(extra)));
    expect([b.width, b.height]).toEqual([a.width, a.height]);
    // Pixels that differ visibly in any channel, and the mean difference:
    // only rounding at the copy's edges, not lines moved by a pixel.
    let differ = 0,
      inked = 0,
      sum = 0;
    for (let i = 0; i < a.rgba.length; i += 4) {
      let most = 0;
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(a.rgba[i + c] - b.rgba[i + c]);
        most = Math.max(most, d);
        sum += d;
      }
      if (most > 48) differ++;
      if (a.rgba[i] !== a.rgba[0] || a.rgba[i + 1] !== a.rgba[1]) inked++;
    }
    expect(inked).toBeGreaterThan(5000);
    expect(differ / inked).toBeLessThan(0.002);
    expect(sum / (3 * (a.rgba.length / 4))).toBeLessThan(0.05);
  });
