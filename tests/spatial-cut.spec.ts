import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import { choosePreset } from "./helpers";
import {
  cutEdges,
  cutInk,
  cutPlane,
  cutSpec,
  defaultCut,
  isCut,
  sweepExtent,
  sweepOffset,
  type Cut,
  type CutError,
  type CutScope,
  type CutSpec,
} from "../web/spatial/cut";
import { buildScene, type Batch, type Pass } from "../web/spatial/scene";
import { linework, type LineGroup } from "../web/spatial/linework";
import { defaultLayers } from "../web/spatial/renderer";
import { spatialPresets } from "../web/spatial/presets";
import { hex, lineColor } from "../web/spatial/palette";
import type { SpatialResult, Vec3 } from "../web/spatial/types";

// The cutaway plane. Studies drawn without a cut must not change: these
// line drawings were recorded before the cut existed.
const stage = (page: Page) => page.locator(".spatial-stage");
const settled = (page: Page) =>
  expect(stage(page)).toHaveAttribute("aria-busy", "false");
async function ready(page: Page) {
  await page.goto("/?study=3d");
  await settled(page);
  await expect(page.locator("#spatial-artwork")).toBeVisible();
}
async function download(page: Page, item: string) {
  await page.getByRole("button", { name: "Export image", exact: true }).click();
  const event = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: item, exact: true }).click();
  return readFile((await (await event).path())!);
}
const every = "Lines (SVG) · every line",
  shown = "Lines (SVG) · visible only, sampled";
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
// The recordings predate the metadata's construction input and its base
// curve layer, which a study built on the base records as "base" and shown,
// and the involute input's unwinding, which it records at its default.
const predating = (b: Buffer) =>
  Buffer.from(
    b
      .toString("utf8")
      .replace('"input":"base",', "")
      .replace('"unwinding":{"anchor":0,"offset":1},', "")
      .replace('"parent":true,', ""),
  );

// Recorded from main at 672ef89, before the cut. Regenerate only when a
// study's own geometry or the linework format changes deliberately.
const recorded: Record<string, { every: string; shown: string }> = {
  "The focal sheets of an ellipsoid": {
    every: "987408e059ca98134e810502cbfc208e9b35fde8985d3cbbb4c796fab549c079",
    shown: "f7ef384c68a1ce46ed25942bb4691645c19a75b7024791881f10d3a785c3779f",
  },
  "A spherical bowl's cusped caustic": {
    every: "24d96debbacda4ae9f66bd9d14d4989afc760ececaaf917f8cd08fff00d0beae",
    shown: "a469a7b3c4855ae8dc853977ff5728cc6e8e10227d6840eae4b58b8d85ddfed7",
  },
};

test("line drawings of studies without a cut are unchanged", async ({
  page,
}) => {
  await ready(page);
  const seen: Record<string, { every: string; shown: string }> = {};
  for (const label of Object.keys(recorded)) {
    await choosePreset(page, { label });
    await settled(page);
    seen[label] = {
      every: sha(predating(await download(page, every))),
      shown: sha(predating(await download(page, shown))),
    };
  }
  expect(seen).toEqual(recorded);
});

// The plane, which passes it cuts, the edge it leaves on drawn sheets, and
// the peel's range. Hand-built meshes give every expected value from the
// definitions n̂·p = d and "hidden where n̂·p > d".
const at = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cut = (c: Partial<Cut> = {}): Cut => ({
  ...defaultCut,
  enabled: true,
  ...c,
});
const plane = (c: Partial<Cut>) => {
  const p = cutPlane(cut(c));
  if ("message" in p) throw new Error(p.message);
  return p;
};
// The unit cube [0, 1]³'s six faces as twelve triangles (7 floats per
// corner), or as one indexed mesh over its eight corners.
const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((k) =>
  at(k & 1, (k >> 1) & 1, (k >> 2) & 1),
);
const faces = [
  [0, 1, 3, 2],
  [4, 6, 7, 5],
  [0, 4, 5, 1],
  [2, 3, 7, 6],
  [0, 2, 6, 4],
  [1, 5, 7, 3],
].flatMap(([a, b, c, d]) => [a, b, c, a, c, d]);
const flat = (points: Vec3[]) =>
  new Float32Array(points.flatMap((p) => [p.x, p.y, p.z, 0, 0, 1, 0]));
const cube = (): Batch => ({
  mode: "triangles",
  data: flat(faces.map((k) => corners[k])),
  ink: 0,
});
const indexedCube = (): Batch => ({
  mode: "triangles",
  data: flat(corners),
  ink: 0,
  indices: new Uint32Array(faces),
});
const sheet = (batch: Batch, layer: Pass["layer"] = "surface"): Pass => ({
  layer,
  batch,
  sheet: true,
});
function segments(b: Batch | null): [Vec3, Vec3][] {
  const out: [Vec3, Vec3][] = [];
  if (!b) return out;
  for (let i = 0; i + 13 < b.data.length; i += 14)
    out.push([
      at(b.data[i], b.data[i + 1], b.data[i + 2]),
      at(b.data[i + 7], b.data[i + 8], b.data[i + 9]),
    ]);
  return out;
}
const perimeter = (s: [Vec3, Vec3][]) =>
  s.reduce((n, [a, b]) => n + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), 0);

test("the plane is n̂·p = d with a unit normal; invalid fields are named", () => {
  expect(plane({ normal: at(0, 0, 2), offset: 1 })).toEqual({
    normal: at(0, 0, 1),
    offset: 1,
  });
  const p = plane({ normal: at(3, -4, 0), offset: -2 });
  expect(p.normal.x).toBeCloseTo(0.6, 15);
  expect(p.normal.y).toBeCloseTo(-0.8, 15);
  expect(p.offset).toBe(-2);
  const refused = (c: Partial<Cut>) => cutPlane(cut(c)) as CutError;
  expect(refused({ normal: at(0, 0, 0) })).toMatchObject({
    field: "Cut normal",
    message: expect.stringMatching(/not be zero/),
  });
  expect(refused({ normal: at(1, NaN, 0) }).field).toBe("Cut normal y");
  expect(refused({ normal: at(Infinity, 0, 0) }).field).toBe("Cut normal x");
  expect(refused({ normal: at(0, 0, 100001) })).toMatchObject({
    field: "Cut normal z",
    message: expect.stringMatching(/100000/),
  });
  expect(refused({ offset: NaN }).field).toBe("Cut offset d");
  expect(refused({ offset: -100001 }).field).toBe("Cut offset d");
  // The limits themselves are allowed.
  expect(plane({ normal: at(-100000, 0, 0), offset: 100000 }).offset).toBe(
    100000,
  );
  // An off cut draws nothing, valid or not; an invalid one draws nothing
  // either and reports why.
  expect(cutSpec({ ...cut(), enabled: false })).toEqual({ spec: null });
  expect(cutSpec(cut({ normal: at(0, 0, 0) }))).toMatchObject({
    spec: null,
    error: { field: "Cut normal" },
  });
  expect(cutSpec(cut({ offset: 0.5, cuts: "all", edge: false }))).toEqual({
    spec: {
      plane: { normal: at(0, 0, 1), offset: 0.5 },
      scope: "all",
      edge: false,
    },
  });
  // An animation's offset replaces the entered one.
  expect(cutSpec(cut({ offset: 0.5 }), -3).spec!.plane.offset).toBe(-3);
});

test("each scope cuts its own passes, and never the probe or the edge", () => {
  const cases: [Pass["layer"], boolean, CutScope, boolean][] = [
    ["surface", true, "surface", true],
    ["offset", true, "surface", false],
    ["focal1", true, "surface", false],
    ["surface", false, "surface", false],
    ["offset", true, "sheets", true],
    ["receiver", true, "sheets", true],
    ["rulings", false, "sheets", false],
    ["base", false, "sheets", false],
    ["base", false, "all", true],
    ["rulings", false, "all", true],
    ["focal2", true, "all", true],
    ["probe", false, "all", false],
    ["cut", false, "all", false],
  ];
  for (const [layer, isSheet, scope, expected] of cases)
    expect(isCut({ layer, sheet: isSheet }, scope), `${layer} ${scope}`).toBe(
      expected,
    );
});

test("the edge is where the drawn triangles cross the plane", () => {
  for (const batch of [cube(), indexedCube()]) {
    const p = plane({ normal: at(0, 0, 1), offset: 0.25 });
    const edge = cutEdges([sheet(batch)], p, "sheets")!;
    expect(edge.mode).toBe("lines");
    expect(edge.ink).toBe(cutInk);
    const s = segments(edge);
    // Two triangles on each of the four sides.
    expect(s).toHaveLength(8);
    for (const q of s.flat()) {
      expect(Math.abs(dot(p.normal, q) - p.offset)).toBeLessThan(1e-7);
      // On the cube's boundary.
      expect(Math.max(Math.abs(q.x - 0.5), Math.abs(q.y - 0.5))).toBeCloseTo(
        0.5,
        7,
      );
    }
    expect(perimeter(s)).toBeCloseTo(4, 6);
    // Neighboring triangles share their endpoints exactly, so the loop
    // closes: every point appears twice.
    const seen = new Map<string, number>();
    for (const q of s.flat()) {
      const key = `${q.x},${q.y},${q.z}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    expect([...seen.values()].every((n) => n === 2)).toBe(true);
  }
  // A tilted plane: the hexagon of the cube's section x + y + z = 1.5,
  // with side √2/2.
  const tilted = plane({ normal: at(1, 1, 1), offset: 1.5 / Math.sqrt(3) });
  const hexagon = segments(cutEdges([sheet(cube())], tilted, "sheets"));
  expect(perimeter(hexagon)).toBeCloseTo(6 * (Math.SQRT2 / 2), 5);
  // Crossings at fractions with no exact binary form still close: both
  // triangles on an edge round its point identically.
  for (const offset of [0.37, 0.71, 1.13]) {
    const s = segments(
      cutEdges(
        [sheet(cube())],
        plane({ normal: at(1, 2, 3), offset }),
        "sheets",
      ),
    );
    expect(s.length).toBeGreaterThan(2);
    const seen = new Map<string, number>();
    for (const q of s.flat()) {
      const key = `${q.x},${q.y},${q.z}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    expect(
      [...seen.values()].every((n) => n === 2),
      String(offset),
    ).toBe(true);
  }
});

test("corners on the plane, coplanar faces and missing corners leave no stray edge", () => {
  // The bottom face lies in the plane z = 0 and is kept; the sides meet it
  // along its four edges, once each, with no zero-length pieces.
  const floor = segments(
    cutEdges([sheet(cube())], plane({ offset: 0 }), "sheets"),
  );
  expect(floor).toHaveLength(4);
  expect(perimeter(floor)).toBeCloseTo(4, 6);
  for (const [a, b] of floor) {
    expect(a.z).toBe(0);
    expect(b.z).toBe(0);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(1, 6);
  }
  // A plane beyond the cube, or one it lies wholly behind: no edge.
  expect(cutEdges([sheet(cube())], plane({ offset: 1 }), "sheets")).toBeNull();
  expect(cutEdges([sheet(cube())], plane({ offset: 2 }), "sheets")).toBeNull();
  expect(cutEdges([sheet(cube())], plane({ offset: -1 }), "sheets")).toBeNull();
  // A triangle with a nonfinite corner is skipped.
  const broken = flat([at(0, 0, 0), at(1, 0, 1), at(NaN, 1, 1)]);
  expect(
    cutEdges(
      [sheet({ mode: "triangles", data: broken, ink: 0 })],
      plane({ offset: 0.5 }),
      "sheets",
    ),
  ).toBeNull();
  // Only the passes the scope cuts leave an edge; lines never do.
  const line: Pass = {
    layer: "rulings",
    sheet: false,
    batch: { mode: "lines", data: flat([at(0, 0, 0), at(0, 0, 1)]), ink: 1 },
  };
  const p = plane({ offset: 0.5 });
  expect(cutEdges([sheet(cube(), "offset"), line], p, "surface")).toBeNull();
  expect(
    segments(cutEdges([sheet(cube(), "offset"), line], p, "all")),
  ).toHaveLength(8);
});

test("the peel runs from the farthest drawn point along n̂ to the nearest, exactly", () => {
  const up = plane({ normal: at(0, 0, 1) });
  expect(sweepExtent([sheet(cube())], up, "sheets")).toEqual([1, 0]);
  const down = plane({ normal: at(0, 0, -1) });
  expect(sweepExtent([sheet(indexedCube())], down, "sheets")).toEqual([0, -1]);
  const diagonal = plane({ normal: at(1, 1, 1) });
  const [hi, lo] = sweepExtent([sheet(cube())], diagonal, "sheets")!;
  expect(hi).toBeCloseTo(Math.sqrt(3), 12);
  expect(lo).toBe(0);
  // Passes the scope leaves alone do not count; with none, nothing peels.
  expect(sweepExtent([sheet(cube(), "offset")], up, "surface")).toBeNull();
  const extent: [number, number] = [0.7, -0.3];
  expect(sweepOffset(0, extent)).toBe(0.7);
  expect(sweepOffset(1, extent)).toBe(-0.3);
  expect(sweepOffset(0.25, extent)).toBeCloseTo(0.45, 15);
});

// Linework with a cut: the same plane hides sheet pixels in the depth
// raster, clips lines when they are cut, and adds the edge. The view looks
// down −z with 760/1.16 px per unit, so page x = 1000 + x·unit.
const unit = 760 / 1.16;
const O = at(0, 0, 0);
const page = { width: 2000, height: 1520 };
const front = {
  center: O,
  radius: 1,
  yaw: 0,
  pitch: 0,
  zoom: 1,
  panX: 0,
  panY: 0,
};
function squareStudy(lineZ: number): SpatialResult {
  const corner = (x: number, y: number) => ({
    position: at(x, y, 0),
    normal: at(0, 0, 1),
    phase: 0,
    sampleIndex: 0,
  });
  const [a, b, c, d] = [
    corner(-0.5, -0.5),
    corner(0.5, -0.5),
    corner(0.5, 0.5),
    corner(-0.5, 0.5),
  ];
  return {
    base: [at(-1, 0.1, lineZ), at(1, 0.1, lineZ)],
    breaks: [false, false],
    minus: [],
    plus: [],
    mesh: [a, b, c, a, c, d],
    rulings: [],
    bounds: { center: O, radius: 1 },
    radius: 1,
    omitted: 0,
    invalid: 0,
  };
}
function drawn(
  result: SpatialResult,
  occlusion: "none" | "sampled",
  spec?: CutSpec | null,
) {
  return linework(
    buildScene(result),
    front,
    defaultLayers,
    false,
    { ...page, occlusion },
    [],
    spec,
  );
}
const linePaths = (groups: LineGroup[], layer: string) =>
  groups.find((g) => g.layer === layer)?.strokes.flatMap((s) => s.paths) ?? [];
const halfX = (scope: CutScope, edge = true): CutSpec => ({
  plane: { normal: at(1, 0, 0), offset: 0 },
  scope,
  edge,
});

test("linework without a cut is unchanged by the cut's arguments", () => {
  for (const occlusion of ["none", "sampled"] as const) {
    const plain = drawn(squareStudy(-0.2), occlusion);
    expect(drawn(squareStudy(-0.2), occlusion, null)).toEqual(plain);
    expect(drawn(squareStudy(-0.2), occlusion, undefined)).toEqual(plain);
  }
});

test("a cut sheet hides nothing where it is cut away", () => {
  const x = (v: number) => 1000 + v * unit;
  // Behind the square: hidden across x ∈ [−0.5, 0.5] uncut, but only
  // across [−0.5, 0] once the half x > 0 is cut away.
  const whole = linePaths(drawn(squareStudy(-0.2), "sampled"), "base");
  expect(whole).toHaveLength(2);
  const cutAway = linePaths(
    drawn(squareStudy(-0.2), "sampled", halfX("sheets")),
    "base",
  );
  expect(cutAway).toHaveLength(2);
  expect(cutAway[0][0][0]).toBeCloseTo(x(-1), 6);
  expect(Math.abs(cutAway[0].at(-1)![0] - x(-0.5))).toBeLessThan(1);
  expect(Math.abs(cutAway[1][0][0] - x(0))).toBeLessThan(1);
  expect(cutAway[1].at(-1)![0]).toBeCloseTo(x(1), 6);
  // Cutting the other side hides the other half.
  const other = linePaths(
    drawn(squareStudy(-0.2), "sampled", {
      ...halfX("sheets"),
      plane: { normal: at(-1, 0, 0), offset: 0 },
    }),
    "base",
  );
  expect(Math.abs(other[0].at(-1)![0] - x(0))).toBeLessThan(1);
  expect(Math.abs(other[1][0][0] - x(0.5))).toBeLessThan(1);
  // "The surface" cuts the mesh, which is the study's surface.
  expect(
    linePaths(drawn(squareStudy(-0.2), "sampled", halfX("surface")), "base"),
  ).toEqual(cutAway);
});

test("cutting lines too clips them exactly at the plane", () => {
  const x = (v: number) => 1000 + v * unit;
  // In front of the square, nothing hides the line, so only the plane
  // shortens it: it ends where it meets x = 0.
  for (const occlusion of ["none", "sampled"] as const) {
    const [only, ...rest] = linePaths(
      drawn(squareStudy(0.2), occlusion, halfX("all")),
      "base",
    );
    expect(rest).toHaveLength(0);
    expect(only[0][0]).toBeCloseTo(x(-1), 6);
    expect(only.at(-1)![0]).toBeCloseTo(x(0), 6);
  }
  // Sheets alone leave lines whole.
  const [whole] = linePaths(
    drawn(squareStudy(0.2), "none", halfX("sheets")),
    "base",
  );
  expect(whole.at(-1)![0]).toBeCloseTo(x(1), 6);
  // A line wholly on the hidden side is gone; one on the plane is kept.
  const beyond = squareStudy(0.2);
  beyond.base = [at(0.2, 0.1, 0.2), at(1, 0.1, 0.2)];
  expect(linePaths(drawn(beyond, "none", halfX("all")), "base")).toEqual([]);
  beyond.base = [at(0, -1, 0.2), at(0, 1, 0.2)];
  expect(linePaths(drawn(beyond, "none", halfX("all")), "base")).toHaveLength(
    1,
  );
});

test("the edge is drawn on its own sheet and stays visible there", () => {
  const y = (v: number) => 760 - v * unit;
  for (const occlusion of ["none", "sampled"] as const) {
    const edge = linePaths(
      drawn(squareStudy(-0.2), occlusion, halfX("sheets")),
      "cut",
    );
    expect(edge).toHaveLength(1);
    const ends = [edge[0][0], edge[0].at(-1)!].sort((a, b) => a[1] - b[1]);
    expect(ends[0][0]).toBeCloseTo(1000, 6);
    expect(ends[0][1]).toBeCloseTo(y(0.5), 4);
    expect(ends[1][1]).toBeCloseTo(y(-0.5), 4);
  }
  expect(
    linePaths(drawn(squareStudy(-0.2), "none", halfX("sheets", false)), "cut"),
  ).toEqual([]);
  // A plane missing the sheet leaves no edge.
  expect(
    linePaths(
      drawn(squareStudy(-0.2), "none", {
        ...halfX("sheets"),
        plane: { normal: at(1, 0, 0), offset: 0.9 },
      }),
      "cut",
    ),
  ).toEqual([]);
});

// Through the real app: a sphere of radius R, opened from a link with an
// exact camera, so every expected pixel follows from the orthographic
// camera and the plane.
const linkTo = (study: unknown) =>
  `/?study=3d#s=${deflateRawSync(
    Buffer.from(JSON.stringify({ v: 1, notebook: "3d", study })),
  ).toString("base64url")}`;
const R = 1.2;
const sphereIndex = spatialPresets.findIndex(
  (p) => p.name === "A sphere collapsing to one focus",
);
function sphereStudy(
  c: Partial<Cut> | null,
  samples: [number, number] = [48, 24],
  view = { yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 },
  // Longitudes drawn, the whole sphere by default.
  u: [number, number] = [0, 2 * Math.PI],
) {
  const config = structuredClone(spatialPresets[sphereIndex].config);
  config.surface = {
    ...config.surface,
    a: R,
    b: R,
    c: R,
    uMin: u[0],
    uMax: u[1],
    vMin: -Math.PI / 2,
    vMax: Math.PI / 2,
    uSamples: samples[0],
    vSamples: samples[1],
  };
  const layers = Object.fromEntries(
    Object.keys(defaultLayers).map((k) => [k, k === "surface"]),
  );
  return {
    config,
    layers,
    view,
    animation: { mode: "reveal", camera: "hold", duration: 10, tracks: [] },
    ...(c && { cut: { ...defaultCut, enabled: true, ...c } }),
  };
}
async function openLink(page: Page, study: unknown) {
  await page.goto(linkTo(study));
  await settled(page);
  await expect(page.locator("#spatial-artwork")).toBeVisible();
}
function svgParts(svg: string) {
  const desc = svg.match(/<desc>(.*?)<\/desc>/s)![1];
  const meta = JSON.parse(
    desc
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&amp;", "&"),
  );
  const groups: Record<string, [number, number][]> = {};
  for (const g of svg.matchAll(/<g id="([a-z0-9]+)"[^>]*>(.*?)<\/g>/gs))
    groups[g[1]] = [...g[2].matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [
      +m[1],
      +m[2],
    ]);
  return { meta, groups };
}

test("a sphere cut at z = h has the circle of radius √(R² − h²) as its edge, converging as the mesh refines", async ({
  page,
}) => {
  const h = 0.5,
    exact = Math.sqrt(R * R - h * h);
  const deficits: number[] = [];
  for (const samples of [
    [48, 24],
    [96, 48],
  ] as [number, number][]) {
    await openLink(
      page,
      sphereStudy({ normal: at(0, 0, 1), offset: h, cuts: "surface" }, samples),
    );
    const { meta, groups } = svgParts((await download(page, every)).toString());
    expect(meta.cut).toMatchObject({
      normal: { x: 0, y: 0, z: 1 },
      offset: h,
      cuts: "surface",
      edge: true,
    });
    expect(meta.cut.statement).toMatch(/not a refined section curve/);
    // Seen from +z, the circle lies flat on the page, centered where the
    // axis x = y = 0 projects: x = 1000 + (0 − cₓ)·scale, y = 760 − (0 − c_y)·scale.
    const { center, zoom, radius } = meta.view;
    const scale = (760 * zoom) / (1.16 * radius);
    const cx = 1000 - center.x * scale,
      cy = 760 + center.y * scale;
    const points = groups.cut;
    expect(points.length).toBeGreaterThan(2 * samples[0]);
    const radii = points.map(([x, y]) => Math.hypot(x - cx, y - cy) / scale);
    // Chords lie inside the sphere: never beyond the circle, and short of
    // it by at most the sag of the longest (diagonal) mesh edge.
    const du = (2 * Math.PI) / samples[0],
      dv = Math.PI / samples[1],
      sag = R * (1 - Math.cos(Math.hypot(du, dv) / 2));
    for (const r of radii) {
      expect(r).toBeLessThan(exact + 0.02 / scale);
      expect(r).toBeGreaterThan(exact - sag - 0.02 / scale);
    }
    deficits.push(Math.max(...radii.map((r) => exact - r)));
  }
  // Second order: halving the cells divides the largest deficit by about 4
  // (3.3 measured, the maximum being sampled where the plane crosses each grid).
  expect(deficits[0] / deficits[1]).toBeGreaterThan(2.5);
  expect(deficits[0] / deficits[1]).toBeLessThan(6);
});

test("the drawing hides the sheet beyond the plane and draws the edge on it, in the PNG and the lines alike", async ({
  page,
}) => {
  // The half x ≥ 0, so the view's center is off the origin and the plane
  // must be placed relative to it.
  const h = 0.3,
    half: [number, number] = [-Math.PI / 2, Math.PI / 2];
  await openLink(
    page,
    sphereStudy({ normal: at(1, 0, 0), offset: h }, undefined, undefined, half),
  );
  const view = JSON.parse(
    (await page.locator("#spatial-artwork").getAttribute("data-view"))!,
  );
  expect(view.center.x).toBeGreaterThan(0.2);
  const scale = (760 * view.zoom) / (1.16 * view.radius);
  const px = (x: number) => Math.round(1000 + (x - view.center.x) * scale);
  const image = await download(page, "PNG image · 2000 × 1520");
  const pixels = await decode(page, image, [
    [px(h + 0.15), 760],
    [px(h - 0.15), 760],
    [px(0.05), 760],
    [5, 5],
  ]);
  const background = pixels[3];
  const differs = (a: number[], b: number[]) =>
    Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 30;
  // Beyond the plane: background; before it: the sheet.
  expect(differs(pixels[0], background)).toBe(false);
  expect(differs(pixels[1], background)).toBe(true);
  expect(differs(pixels[2], background)).toBe(true);
  // The edge runs down the page at x = h, in the cut's ink: about a pixel
  // wide and antialiased, so it is compared with the same drawing without
  // the edge, which has no pixel near that ink there.
  const near = [-2, -1, 0, 1, 2].map(
    (d) => [px(h) + d, 760] as [number, number],
  );
  const ink = hex(lineColor(cutInk, 0, false));
  const rgb = [1, 3, 5].map((i) => parseInt(ink.slice(i, i + 2), 16));
  const closest = (pixels: number[][]) =>
    Math.min(
      ...pixels.map(
        (c) =>
          Math.abs(c[0] - rgb[0]) +
          Math.abs(c[1] - rgb[1]) +
          Math.abs(c[2] - rgb[2]),
      ),
    );
  const withEdge = closest(await decode(page, image, near));
  // The visible-only lines draw the same edge at the same place.
  const { groups, meta } = svgParts((await download(page, shown)).toString());
  expect(meta.cut.cuts).toBe("sheets");
  for (const [x] of groups.cut)
    expect(Math.abs(x - (1000 + (h - view.center.x) * scale))).toBeLessThan(1);
  await openLink(
    page,
    sphereStudy(
      { normal: at(1, 0, 0), offset: h, edge: false },
      undefined,
      undefined,
      half,
    ),
  );
  const bare = await download(page, "PNG image · 2000 × 1520");
  expect(closest(await decode(page, bare, near))).toBeGreaterThan(
    withEdge + 100,
  );
  expect(
    svgParts((await download(page, every)).toString()).groups.cut,
  ).toBeUndefined();
  // Opened without the cut, or with a plane beyond the sphere, the PNG is
  // the same image, and the lines record no cut.
  await openLink(page, sphereStudy(null, undefined, undefined, half));
  const plain = await download(page, "PNG image · 2000 × 1520");
  expect(svgParts((await download(page, every)).toString()).meta.cut).toBe(
    undefined,
  );
  await openLink(
    page,
    sphereStudy(
      { normal: at(1, 0, 0), offset: 2 * R },
      undefined,
      undefined,
      half,
    ),
  );
  expect((await download(page, "PNG image · 2000 × 1520")).equals(plain)).toBe(
    true,
  );
});

// The RGB of a PNG's pixels, decoded by the browser.
async function decode(page: Page, png: Buffer, points: [number, number][]) {
  const other = await page.context().newPage();
  try {
    return await other.evaluate(
      async ([bytes, points]) => {
        const bitmap = await createImageBitmap(
          new Blob([new Uint8Array(bytes)], { type: "image/png" }),
        );
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(bitmap, 0, 0);
        return points.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
      },
      [Array.from(png), points] as const,
    );
  } finally {
    await other.close();
  }
}

const cutBox = (page: Page) => page.getByRole("group", { name: "Cut away" });
const drawnCut = async (page: Page) => {
  const value = await page.locator("#spatial-artwork").getAttribute("data-cut");
  return value === null ? null : JSON.parse(value);
};

test("the panel's controls set the plane, refuse a zero normal, and reset with a preset", async ({
  page,
}) => {
  await ready(page);
  const box = cutBox(page);
  const enable = box.getByRole("checkbox", { name: "Cut with a plane" });
  await expect(enable).not.toBeChecked();
  await expect(box.getByLabel("Normal x")).toHaveCount(0);
  expect(await drawnCut(page)).toBeNull();
  await enable.check();
  for (const [label, value] of [
    ["Normal x", "0"],
    ["Normal y", "0"],
    ["Normal z", "1"],
    ["Offset d", "0"],
  ])
    await expect(box.getByLabel(label, { exact: true })).toHaveValue(value);
  await expect
    .poll(() => drawnCut(page))
    .toEqual({
      plane: { normal: { x: 0, y: 0, z: 1 }, offset: 0 },
      scope: "sheets",
      edge: true,
    });
  // A zero normal is named, and nothing is cut meanwhile.
  await box.getByLabel("Normal z", { exact: true }).fill("0");
  await expect(box.getByRole("alert")).toHaveText(
    "Cut normal: must not be zero.",
  );
  await expect.poll(() => drawnCut(page)).toBeNull();
  await box.getByLabel("Normal y", { exact: true }).fill("2*2");
  await expect(box.getByRole("alert")).toHaveCount(0);
  await expect
    .poll(async () => (await drawnCut(page))?.plane.normal)
    .toEqual({ x: 0, y: 1, z: 0 });
  // Facing the view: toward the viewer of the shown camera.
  const view = JSON.parse(
    (await page.locator("#spatial-artwork").getAttribute("data-view"))!,
  );
  await box.getByRole("button", { name: "Face the view" }).click();
  const toward = [
    -Math.cos(view.pitch) * Math.sin(view.yaw),
    Math.sin(view.pitch),
    Math.cos(view.pitch) * Math.cos(view.yaw),
  ].map((v) => Math.round(v * 1000) / 1000);
  for (const [i, axis] of ["x", "y", "z"].entries())
    await expect(box.getByLabel(`Normal ${axis}`, { exact: true })).toHaveValue(
      String(toward[i]),
    );
  // Through the center of the study's bounds.
  await box.getByRole("button", { name: "Through the center" }).click();
  const length = Math.hypot(...toward);
  const through =
    (toward[0] * view.center.x +
      toward[1] * view.center.y +
      toward[2] * view.center.z) /
    length;
  await expect
    .poll(async () => (await drawnCut(page))?.plane.offset)
    .toBeCloseTo(through, 5);
  // Flip keeps the plane and cuts the other side.
  const before = (await drawnCut(page)).plane;
  await box.getByRole("button", { name: "Flip" }).click();
  await expect
    .poll(async () => (await drawnCut(page))?.plane.offset)
    .toBeCloseTo(-before.offset, 9);
  expect((await drawnCut(page)).plane.normal.x).toBeCloseTo(
    -before.normal.x,
    9,
  );
  await box.getByLabel("What it cuts", { exact: true }).selectOption("all");
  await box.getByRole("checkbox", { name: "Draw the cut edge" }).uncheck();
  await expect
    .poll(async () => {
      const c = await drawnCut(page);
      return [c?.scope, c?.edge];
    })
    .toEqual(["all", false]);
  // Layers do not disturb the cut.
  await page.getByRole("checkbox", { name: "Tangent rulings" }).uncheck();
  expect((await drawnCut(page)).scope).toBe("all");
  // A preset brings its own cut, here none.
  await choosePreset(page, { label: "Cinquefoil · (2, 5)" });
  await settled(page);
  await expect(enable).not.toBeChecked();
  expect(await drawnCut(page)).toBeNull();
});

test("the ellipsoid hides its whole focal surface until the cut opens it", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, { label: "An ellipsoid hiding its centers" });
  await settled(page);
  const preset = spatialPresets.find(
    (p) => p.name === "An ellipsoid hiding its centers",
  )!;
  await expect(
    cutBox(page).getByRole("checkbox", { name: "Cut with a plane" }),
  ).toBeChecked();
  expect(await drawnCut(page)).toEqual(cutSpec(preset.cut!).spec);
  const png = () => download(page, "PNG image · 2000 × 1520");
  const sheets = ["Focal sheet 1 · κ₁", "Focal sheet 2 · κ₂"].map((name) =>
    page.getByRole("checkbox", { name, exact: true }),
  );
  const toggled = async () => {
    const shown = await png();
    for (const s of sheets) await s.uncheck();
    const hidden = await png();
    for (const s of sheets) await s.check();
    return shown.equals(hidden);
  };
  // Opened, the sheets are in view.
  expect(await toggled()).toBe(false);
  // Closed, the shell hides every one of their pixels: they lie inside it.
  await cutBox(page)
    .getByRole("checkbox", { name: "Cut with a plane" })
    .uncheck();
  expect(await toggled()).toBe(true);
});
