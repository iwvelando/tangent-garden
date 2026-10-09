import { test, expect, type Page } from "@playwright/test";
import {
  cutEdges,
  cutRecord,
  cutSpec,
  defaultCut,
  maxCutPlanes,
  sweepExtent,
  type Cut,
  type CutError,
  type CutSpec,
  type Plane,
} from "../web/spatial/cut";
import { buildScene, type Batch, type Pass } from "../web/spatial/scene";
import { linework, type LineGroup } from "../web/spatial/linework";
import { defaultLayers } from "../web/spatial/renderer";
import { spatialPresets } from "../web/spatial/presets";
import { choosePreset } from "./helpers";
import { readFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import type { SpatialResult, Vec3 } from "../web/spatial/types";
import { curveMesh } from "./curve-mesh";

// A cut of several planes. Hidden beyond every plane, it removes the
// intersection of their far sides (a notch: a wedge or a corner); hidden
// beyond any, it keeps the intersection of their near sides (a slab or a
// box). One plane is the cut it always was. Every expected value follows
// from those two definitions on hand-built meshes.
const at = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const cut = (c: Partial<Cut> = {}): Cut => ({
  ...defaultCut,
  enabled: true,
  ...c,
});
const P = (x: number, y: number, z: number, offset: number): Plane => {
  const l = Math.hypot(x, y, z);
  return { normal: at(x / l, y / l, z / l), offset };
};

// The unit cube [0, 1]³'s faces, each split into a 4 × 4 grid of squares
// (two triangles each), so the planes at 0.25, 0.5 and 0.75 run along
// grid lines and the sections are exact.
function gridCube(n = 4): Batch {
  const out: number[] = [];
  const put = (p: number[]) => out.push(p[0], p[1], p[2], 0, 0, 1, 0);
  for (let axis = 0; axis < 3; axis++)
    for (const side of [0, 1])
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          const corner = (a: number, b: number) => {
            const p = [0, 0, 0];
            p[axis] = side;
            p[(axis + 1) % 3] = a / n;
            p[(axis + 2) % 3] = b / n;
            return p;
          };
          const [a, b, c, d] = [
            corner(i, j),
            corner(i + 1, j),
            corner(i + 1, j + 1),
            corner(i, j + 1),
          ];
          [a, b, c, a, c, d].forEach(put);
        }
  return { mode: "triangles", data: new Float32Array(out), ink: 0 };
}
const sheet = (batch: Batch): Pass => ({
  layer: "surface",
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
const length = (s: [Vec3, Vec3][]) =>
  s.reduce((n, [a, b]) => n + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), 0);

test("a cut's other planes are checked and named, and recorded only when there are some", () => {
  // One plane: the spec it always was, with nothing added.
  expect(cutSpec(cut({ offset: 0.5 })).spec).toEqual({
    plane: P(0, 0, 1, 0.5),
    scope: "sheets",
    edge: true,
  });
  expect(cutSpec(cut({ others: [] })).spec).toEqual(cutSpec(cut()).spec);
  // More planes, normalized like the first, with the side they hide.
  const notch = cut({
    others: [
      { normal: at(2, 0, 0), offset: 0.5 },
      { normal: at(0, -3, 4), offset: -1 },
    ],
    beyond: "any",
  });
  expect(cutSpec(notch).spec).toEqual({
    plane: P(0, 0, 1, 0),
    others: [P(1, 0, 0, 0.5), P(0, -3, 4, -1)],
    beyond: "any",
    scope: "sheets",
    edge: true,
  });
  // Beyond every plane unless chosen otherwise.
  expect(
    cutSpec(cut({ others: [{ normal: at(1, 0, 0), offset: 0 }] })).spec!.beyond,
  ).toBe("every");
  // Each refusal names its own plane's field.
  const refused = (others: Cut["others"]) =>
    cutSpec(cut({ others })).error as CutError;
  expect(refused([{ normal: at(0, 0, 0), offset: 0 }])).toMatchObject({
    field: "Cut plane 2 normal",
    message: expect.stringMatching(/not be zero/),
  });
  expect(
    refused([
      { normal: at(1, 0, 0), offset: 0 },
      { normal: at(1, NaN, 0), offset: 0 },
    ]).field,
  ).toBe("Cut plane 3 normal y");
  expect(refused([{ normal: at(1, 0, 0), offset: 1e6 }]).field).toBe(
    "Cut plane 2 offset d",
  );
  expect(
    cutSpec(cut({ others: [{ normal: at(0, 0, 0), offset: 0 }] })).spec,
  ).toBeNull();
  // Six planes bound a box; no more are drawn.
  expect(maxCutPlanes).toBe(6);
  const seven = Array.from({ length: 6 }, () => ({
    normal: at(1, 0, 0),
    offset: 0,
  }));
  expect(cutSpec(cut({ others: seven })).error).toMatchObject({
    field: "Cut planes",
  });
});

test("a peel moves every plane together, by the first plane's offset", () => {
  const spec = cutSpec(
    cut({
      offset: 0.5,
      others: [
        { normal: at(1, 0, 0), offset: 0.25 },
        { normal: at(0, 1, 0), offset: -1 },
      ],
    }),
    2,
  ).spec!;
  expect(spec.plane.offset).toBe(2);
  expect(spec.others!.map((p) => p.offset)).toEqual([1.75, 0.5]);
});

test("beyond every plane, the edge is the notch's boundary on the sheet", () => {
  // The corner x, y, z > 0.5 cut from the cube: on each of the faces x = 1,
  // y = 1 and z = 1 the edge is two half-unit sides of the missing
  // quarter, so it is 3 long; every point lies on one plane and on the
  // far side of the other two, never in the kept part of a plane.
  const planes = [P(1, 0, 0, 0.5), P(0, 1, 0, 0.5), P(0, 0, 1, 0.5)];
  const edge = segments(
    cutEdges(
      [sheet(gridCube())],
      planes[0],
      "sheets",
      planes.slice(1),
      "every",
    ),
  );
  expect(length(edge)).toBeCloseTo(3, 6);
  for (const q of edge.flat()) {
    const c = [q.x, q.y, q.z];
    expect(Math.min(...c)).toBeCloseTo(0.5, 6);
    expect(Math.max(...c)).toBeCloseTo(1, 6);
  }
  // Two planes make a wedge: x, z > 0.5, its edge running round the
  // cube's faces y = 0, y = 1, x = 1 and z = 1 as two L shapes and two
  // straight sides, 4 long.
  const wedge = segments(
    cutEdges([sheet(gridCube())], planes[0], "sheets", [planes[2]], "every"),
  );
  expect(length(wedge)).toBeCloseTo(4, 6);
  // Planes whose far sides never meet on the cube leave no edge.
  expect(
    cutEdges(
      [sheet(gridCube())],
      P(1, 0, 0, 0.75),
      "sheets",
      [P(-1, 0, 0, -0.25)],
      "every",
    ),
  ).toBeNull();
});

test("beyond any plane, the edge is the kept box's boundary on the sheet", () => {
  // The slab 0.25 ≤ x ≤ 0.75 keeps two square sections of the cube.
  const slab = segments(
    cutEdges(
      [sheet(gridCube())],
      P(1, 0, 0, 0.75),
      "sheets",
      [P(-1, 0, 0, -0.25)],
      "any",
    ),
  );
  expect(length(slab)).toBeCloseTo(8, 6);
  for (const q of slab.flat()) expect(Math.abs(q.x - 0.5)).toBeCloseTo(0.25, 6);
  // Keeping x, z ≤ 0.5: each plane's square section is kept where the
  // other plane keeps it, half of its perimeter, 2 each.
  const kept = segments(
    cutEdges(
      [sheet(gridCube())],
      P(1, 0, 0, 0.5),
      "sheets",
      [P(0, 0, 1, 0.5)],
      "any",
    ),
  );
  expect(length(kept)).toBeCloseTo(4, 6);
  for (const q of kept.flat()) {
    expect(q.x).toBeLessThanOrEqual(0.5 + 1e-7);
    expect(q.z).toBeLessThanOrEqual(0.5 + 1e-7);
  }
  // A box inside the cube, [0.25, 0.75]³, reaches no face: no edge, and
  // one that crosses no sheet leaves none either.
  const box = [
    P(1, 0, 0, 0.75),
    P(-1, 0, 0, -0.25),
    P(0, 1, 0, 0.75),
    P(0, -1, 0, -0.25),
    P(0, 0, 1, 0.75),
    P(0, 0, -1, -0.25),
  ];
  expect(
    cutEdges([sheet(gridCube())], box[0], "sheets", box.slice(1), "any"),
  ).toBeNull();
});

test("one plane's edge and peel are unchanged by an empty list of others", () => {
  const p = P(1, 2, 3, 0.71);
  const passes = [sheet(gridCube())];
  expect(cutEdges(passes, p, "sheets", [], "any")).toEqual(
    cutEdges(passes, p, "sheets"),
  );
  expect(sweepExtent(passes, p, "sheets", [], "every")).toEqual(
    sweepExtent(passes, p, "sheets"),
  );
});

test("the peel starts with nothing hidden and ends with everything hidden", () => {
  const passes = [sheet(gridCube())];
  // The corner notch through the center: the first plane's offset runs
  // from 1, where the far corner is just kept, to 0, where only the near
  // corner is.
  const corner = [P(1, 0, 0, 0.5), P(0, 1, 0, 0.5), P(0, 0, 1, 0.5)];
  expect(
    sweepExtent(passes, corner[0], "sheets", corner.slice(1), "every"),
  ).toEqual([1, 0]);
  // The slab 0.25 ≤ x ≤ 0.75, kept: at 1, each side 0.25 further out, it
  // keeps the whole cube; at 0.5 its sides meet at x = 0.5 and nothing but
  // that section is kept.
  const [hi, lo] = sweepExtent(
    passes,
    P(1, 0, 0, 0.75),
    "sheets",
    [P(-1, 0, 0, -0.25)],
    "any",
  )!;
  expect(hi).toBeCloseTo(1, 12);
  expect(lo).toBeCloseTo(0.5, 12);
});

test("the cut's record names its other planes only when there are some", () => {
  const one = cutSpec(cut()).spec!;
  expect(Object.keys(cutRecord(one))).toEqual([
    "normal",
    "offset",
    "cuts",
    "edge",
    "statement",
  ]);
  const notch = cutSpec(
    cut({ others: [{ normal: at(1, 0, 0), offset: 0 }] }),
  ).spec!;
  const record = cutRecord(notch);
  expect(record.others).toEqual([P(1, 0, 0, 0)]);
  expect(record.beyond).toBe("every");
  expect(record.statement).toMatch(/beyond every plane/);
  const box = cutSpec(
    cut({ others: [{ normal: at(1, 0, 0), offset: 0 }], beyond: "any" }),
  ).spec!;
  expect(cutRecord(box).statement).toMatch(/beyond any plane/);
});

// Linework: the view looks down −z with 760/1.16 px per unit, so page
// x = 1000 + x·unit.
const unit = 760 / 1.16;
const xOf = (v: number) => 1000 + v * unit;
const front = {
  center: at(0, 0, 0),
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
    mesh: curveMesh([a, b, c, a, c, d]),
    rulings: [],
    bounds: { center: at(0, 0, 0), radius: 1 },
    radius: 1,
    omitted: 0,
    invalid: 0,
  };
}
const drawn = (
  result: SpatialResult,
  occlusion: "none" | "sampled",
  spec: CutSpec,
) =>
  linework(
    buildScene(result),
    front,
    defaultLayers,
    false,
    { width: 2000, height: 1520, occlusion },
    [],
    spec,
  );
const linePaths = (groups: LineGroup[], layer: string) =>
  groups.find((g) => g.layer === layer)?.strokes.flatMap((s) => s.paths) ?? [];
const spanX = (paths: [number, number][][]) =>
  paths.map((p) => [p[0][0], p.at(-1)![0]].sort((a, b) => a - b));
const several = (
  others: Plane[],
  beyond: "every" | "any",
  scope: CutSpec["scope"] = "all",
  first = P(1, 0, 0, -0.3),
): CutSpec => ({ plane: first, others, beyond, scope, edge: false });

test("cut lines keep what every plane keeps, or what any plane keeps", () => {
  // −0.3 < x < 0.3 is beyond both x > −0.3 and x < 0.3: hidden beyond
  // every plane, the line loses its middle and leaves two pieces.
  for (const occlusion of ["none", "sampled"] as const) {
    const pieces = spanX(
      linePaths(
        drawn(
          squareStudy(0.2),
          occlusion,
          several([P(-1, 0, 0, -0.3)], "every"),
        ),
        "base",
      ),
    );
    expect(pieces).toHaveLength(2);
    expect(pieces[0][0]).toBeCloseTo(xOf(-1), 6);
    expect(pieces[0][1]).toBeCloseTo(xOf(-0.3), 6);
    expect(pieces[1][0]).toBeCloseTo(xOf(0.3), 6);
    expect(pieces[1][1]).toBeCloseTo(xOf(1), 6);
    // Beyond any of x > 0.3 and x < −0.3, only the middle is kept.
    const middle = spanX(
      linePaths(
        drawn(
          squareStudy(0.2),
          occlusion,
          several([P(-1, 0, 0, 0.3)], "any", "all", P(1, 0, 0, 0.3)),
        ),
        "base",
      ),
    );
    expect(middle).toHaveLength(1);
    expect(middle[0][0]).toBeCloseTo(xOf(-0.3), 6);
    expect(middle[0][1]).toBeCloseTo(xOf(0.3), 6);
  }
  // Beyond any of x > −0.3 and x < 0.3 is everywhere: nothing is left.
  expect(
    linePaths(
      drawn(squareStudy(0.2), "none", several([P(-1, 0, 0, -0.3)], "any")),
      "base",
    ),
  ).toEqual([]);
});

test("a sheet is hidden where the planes together hide it, in the depth raster", () => {
  // The line at y = 0.1 runs behind the square. Hidden beyond both x > 0
  // and y > 0, the square loses its quadrant x, y > 0, through which the
  // line shows; with y > 0.2 instead the quadrant misses the line, which
  // stays hidden behind the whole square.
  const behind = (others: Plane[], beyond: "every" | "any") =>
    spanX(
      linePaths(
        drawn(
          squareStudy(-0.2),
          "sampled",
          several(others, beyond, "sheets", P(1, 0, 0, 0)),
        ),
        "base",
      ),
    );
  const notch = behind([P(0, 1, 0, 0)], "every");
  expect(notch).toHaveLength(2);
  expect(Math.abs(notch[0][1] - xOf(-0.5))).toBeLessThan(1);
  expect(Math.abs(notch[1][0] - xOf(0))).toBeLessThan(1);
  const missed = behind([P(0, 1, 0, 0.2)], "every");
  expect(missed).toHaveLength(2);
  expect(Math.abs(missed[0][1] - xOf(-0.5))).toBeLessThan(1);
  expect(Math.abs(missed[1][0] - xOf(0.5))).toBeLessThan(1);
  // Beyond any of x > 0 and y > 0.2, the half x > 0 is gone as for x > 0
  // alone; beyond any of x > 0 and y > 0, the line's whole row is, and it
  // is drawn whole.
  expect(behind([P(0, 1, 0, 0.2)], "any")).toEqual(notch);
  const open = behind([P(0, 1, 0, 0)], "any");
  expect(open).toHaveLength(1);
  expect(open[0][0]).toBeCloseTo(xOf(-1), 6);
  expect(open[0][1]).toBeCloseTo(xOf(1), 6);
});

// Through the app.
const cutBox = (page: Page) => page.getByRole("group", { name: "Cut away" });
const drawnCut = async (page: Page) => {
  const value = await page.locator("#spatial-artwork").getAttribute("data-cut");
  return value === null ? null : JSON.parse(value);
};
const settled = (page: Page) =>
  expect(page.locator(".spatial-stage")).toHaveAttribute("aria-busy", "false");

test("the panel adds planes along free axes through the center, names their fields, and removes them", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await settled(page);
  const box = cutBox(page);
  await box.getByRole("checkbox", { name: "Cut with a plane" }).check();
  const add = box.getByRole("button", { name: "Add a plane" });
  // One plane: nothing about others, here or in the drawing.
  await expect(box.getByLabel("Hidden", { exact: true })).toHaveCount(0);
  await expect(box.getByRole("button", { name: "Remove" })).toHaveCount(0);
  await expect
    .poll(() => drawnCut(page))
    .toEqual({
      plane: { normal: { x: 0, y: 0, z: 1 }, offset: 0 },
      scope: "sheets",
      edge: true,
    });
  const view = JSON.parse(
    (await page.locator("#spatial-artwork").getAttribute("data-view"))!,
  );
  await add.click();
  const second = box.getByRole("group", { name: "Plane 2" });
  await expect(second.getByLabel("Normal x", { exact: true })).toHaveValue("1");
  await expect(second.getByLabel("Normal z", { exact: true })).toHaveValue("0");
  await expect
    .poll(async () => (await drawnCut(page))?.others)
    .toEqual([{ normal: { x: 1, y: 0, z: 0 }, offset: view.center.x }]);
  expect((await drawnCut(page)).beyond).toBe("every");
  // The first plane faces +z, so the next free axis is y.
  await add.click();
  const third = box.getByRole("group", { name: "Plane 3" });
  await expect(third.getByLabel("Normal y", { exact: true })).toHaveValue("1");
  // Its own buttons act on it alone.
  await third.getByRole("button", { name: "Flip" }).click();
  await expect
    .poll(async () => (await drawnCut(page))?.others[1].normal)
    .toEqual({ x: 0, y: -1, z: 0 });
  expect((await drawnCut(page)).plane.normal).toEqual({ x: 0, y: 0, z: 1 });
  // Hidden beyond any plane.
  const hidden = box.getByLabel("Hidden", { exact: true });
  await hidden.selectOption("any");
  await expect.poll(async () => (await drawnCut(page))?.beyond).toBe("any");
  // A refusal names the plane's own field.
  await third.getByLabel("Normal y", { exact: true }).fill("0");
  await expect(box.getByRole("alert")).toHaveText(
    "Cut plane 3 normal: must not be zero.",
  );
  await expect.poll(() => drawnCut(page)).toBeNull();
  await third.getByLabel("Normal x", { exact: true }).fill("t");
  await expect(page.getByRole("alert").first()).toContainText(
    "Cut plane 3 normal x",
  );
  await third.getByLabel("Normal x", { exact: true }).fill("1");
  await expect.poll(async () => (await drawnCut(page))?.others).toHaveLength(2);
  // Six planes in all, then no more.
  for (let i = 0; i < 3; i++) await add.click();
  await expect(box.getByRole("group", { name: "Plane 6" })).toBeVisible();
  await expect(add).toBeDisabled();
  // Removing planes down to one leaves the cut as it was with one.
  while ((await box.getByRole("button", { name: "Remove" }).count()) > 0)
    await box.getByRole("button", { name: "Remove" }).last().click();
  await expect(box.getByLabel("Hidden", { exact: true })).toHaveCount(0);
  await expect
    .poll(() => drawnCut(page))
    .toEqual({
      plane: { normal: { x: 0, y: 0, z: 1 }, offset: 0 },
      scope: "sheets",
      edge: true,
    });
  expect(
    JSON.parse(
      (await page.locator(".spatial-stage").getAttribute("data-cut"))!,
    ),
  ).not.toHaveProperty("others");
});

// A whole sphere of radius R about the origin, seen down −z from a link with
// an exact camera, so each pixel follows from the camera and the planes.
const R = 1.2;
function sphereLink(c: Partial<Cut>) {
  const config = structuredClone(
    spatialPresets.find((p) => p.name === "A sphere collapsing to one focus")!
      .config,
  );
  config.surface = {
    ...config.surface,
    a: R,
    b: R,
    c: R,
    uMin: 0,
    uMax: 2 * Math.PI,
    vMin: -Math.PI / 2,
    vMax: Math.PI / 2,
    uSamples: 48,
    vSamples: 24,
  };
  const study = {
    config,
    layers: Object.fromEntries(
      Object.keys(defaultLayers).map((k) => [k, k === "surface"]),
    ),
    view: { yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 },
    animation: { mode: "reveal", camera: "hold", duration: 10, tracks: [] },
    cut: { ...defaultCut, enabled: true, ...c },
  };
  return `/?study=3d#s=${deflateRawSync(
    Buffer.from(JSON.stringify({ v: 1, notebook: "3d", study })),
  ).toString("base64url")}`;
}
async function download(page: Page, item: string) {
  await page.getByRole("button", { name: "Export image", exact: true }).click();
  const event = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: item, exact: true }).click();
  return readFile((await (await event).path())!);
}
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

test("the drawing and its lines hide a notch beyond every plane, and all but a box beyond any", async ({
  page,
}) => {
  const scale = 760 / (1.16 * R),
    px = (x: number) => Math.round(1000 + x * scale);
  // x > 0 and z > 0, the viewer's side: hidden beyond both, the sphere's
  // near right quarter is gone and its inside shows there; beyond either,
  // its whole right half and its near left quarter are.
  const planes = {
    normal: at(1, 0, 0),
    offset: 0,
    others: [{ normal: at(0, 0, 1), offset: 0 }],
  };
  const sample: [number, number][] = [
    [px(0.6 * R), 760],
    [px(-0.6 * R), 760],
    [5, 5],
  ];
  const differs = (a: number[], b: number[]) =>
    Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 30;
  const look = async (beyond: "every" | "any" | undefined) => {
    await page.goto(
      sphereLink(beyond ? { ...planes, beyond } : { normal: at(1, 0, 0) }),
    );
    await settled(page);
    await expect(page.locator("#spatial-artwork")).toBeVisible();
    const [right, left, background] = await decode(
      page,
      await download(page, "PNG image · 2000 × 1520"),
      sample,
    );
    const lines = svgParts(
      (await download(page, "Lines (SVG) · every line")).toString(),
    );
    return {
      right: differs(right, background),
      left: differs(left, background),
      lines,
    };
  };
  const one = await look(undefined);
  expect([one.right, one.left]).toEqual([false, true]);
  expect(one.lines.meta.cut).not.toHaveProperty("others");

  const notch = await look("every");
  expect([notch.right, notch.left]).toEqual([true, true]);
  expect(notch.lines.meta.cut).toMatchObject({
    others: [{ normal: at(0, 0, 1), offset: 0 }],
    beyond: "every",
  });
  // Its edge: the near half of the meridian x = 0, down the page's middle,
  // and the right half of the equator z = 0, which faces the viewer as the
  // outline's right half. Nothing lies left of the middle.
  const notchEdge = notch.lines.groups.cut;
  expect(notchEdge.length).toBeGreaterThan(20);
  for (const [x] of notchEdge) expect(x).toBeGreaterThan(1000 - 1);
  expect(Math.max(...notchEdge.map(([x]) => x))).toBeCloseTo(
    1000 + R * scale,
    -1,
  );

  // Six planes, the last alone reaching the sphere: beyond any, it hides
  // the right half as one plane would. Every plane slot is drawn.
  {
    const far = (x: number, y: number, z: number) => ({
      normal: at(x, y, z),
      offset: 5,
    });
    await page.goto(
      sphereLink({
        ...far(0, 1, 0),
        others: [
          far(0, -1, 0),
          far(0, 0, 1),
          far(0, 0, -1),
          far(-1, 0, 0),
          { normal: at(1, 0, 0), offset: 0 },
        ],
        beyond: "any",
      }),
    );
    await settled(page);
    const [right, left, background] = await decode(
      page,
      await download(page, "PNG image · 2000 × 1520"),
      sample,
    );
    expect([differs(right, background), differs(left, background)]).toEqual([
      false,
      true,
    ]);
  }

  const box = await look("any");
  expect([box.right, box.left]).toEqual([false, true]);
  expect(box.lines.meta.cut.beyond).toBe("any");
  // Its edge: the far half of the meridian and the left half of the
  // equator, so nothing lies right of the middle.
  const boxEdge = box.lines.groups.cut;
  expect(boxEdge.length).toBeGreaterThan(20);
  for (const [x] of boxEdge) expect(x).toBeLessThan(1000 + 1);
  expect(Math.min(...boxEdge.map(([x]) => x))).toBeCloseTo(
    1000 - R * scale,
    -1,
  );
});

const presetNamed = (name: string) =>
  spatialPresets.find((p) => p.name === name)!;

test("the corner preset cuts the octant facing the view from the shell and both sheets", async ({
  page,
}) => {
  const name = "An ellipsoid with a corner cut away";
  await page.goto("/?study=3d");
  await settled(page);
  await choosePreset(page, { label: name });
  await settled(page);
  const preset = presetNamed(name);
  expect(await drawnCut(page)).toEqual(cutSpec(preset.cut!).spec);
  const box = cutBox(page);
  for (const k of [1, 2, 3])
    await expect(box.getByRole("group", { name: `Plane ${k}` })).toBeVisible();
  await expect(box.getByLabel("Hidden", { exact: true })).toHaveValue("every");
  // Every plane faces the viewer, so the octant cut is the one in front.
  const view = JSON.parse(
    (await page.locator("#spatial-artwork").getAttribute("data-view"))!,
  );
  const toward = at(
    -Math.cos(view.pitch) * Math.sin(view.yaw),
    Math.sin(view.pitch),
    Math.cos(view.pitch) * Math.cos(view.yaw),
  );
  for (const p of [preset.cut!, ...preset.cut!.others!])
    expect(
      p.normal.x * toward.x + p.normal.y * toward.y + p.normal.z * toward.z,
    ).toBeGreaterThan(0.2);
  // The sheets of centers lie inside the shell: they show through the
  // notch, and with the cut off the shell hides every pixel of them.
  const png = () => download(page, "PNG image · 2000 × 1520");
  const sheets = ["Focal sheet 1 · κ₁", "Focal sheet 2 · κ₂"].map((label) =>
    page.getByRole("checkbox", { name: label, exact: true }),
  );
  const toggled = async () => {
    const shown = await png();
    for (const s of sheets) await s.uncheck();
    const hidden = await png();
    for (const s of sheets) await s.check();
    return shown.equals(hidden);
  };
  expect(await toggled()).toBe(false);
  await box.getByRole("checkbox", { name: "Cut with a plane" }).uncheck();
  expect(await toggled()).toBe(true);
});

// The focal surface of an ellipsoid x²/a² + y²/b² + z²/c² = 1 near its
// principal plane z = 0. The normal at (x, y, z) is the line
// (x(1 − t/a²), y(1 − t/b²), z(1 − t/c²)). One sheet crosses the plane
// transversally in the evolute of the middle ellipse,
// (ax)^(2/3) + (by)^(2/3) = (a² − b²)^(2/3). The other has the value
// t = c² + O(z²), so its centers rise only O(z³) while they move O(z²)
// inward from the ellipse of semi-axes A = (a² − c²)/a, B = (b² − c²)/b:
// that ellipse is a cuspidal edge lying in the plane, and a plane at height
// h meets the sheet about h^(2/3) inside it.
test("the slab keeps the evolute of the middle ellipse, and a band whose edge closes on the second sheet's cuspidal ellipse as h^(2/3)", async ({
  page,
}) => {
  const name = "An ellipsoid's centers, sliced to its middle";
  const preset = presetNamed(name);
  await page.goto("/?study=3d");
  await settled(page);
  await choosePreset(page, { label: name });
  await settled(page);
  expect(await drawnCut(page)).toEqual(cutSpec(preset.cut!).spec);
  await expect(cutBox(page).getByLabel("Hidden", { exact: true })).toHaveValue(
    "any",
  );
  const { a, b, c } = preset.config.surface;
  const A = (a * a - c * c) / a,
    B = (b * b - c * c) / b;
  const evolute = ([x, y]: number[]) =>
    Math.pow(
      Math.pow(Math.abs(a * x), 2 / 3) + Math.pow(Math.abs(b * y), 2 / 3),
      3 / 2,
    ) /
      (a * a - b * b) -
    1;
  const inside = ([x, y]: number[]) => 1 - Math.hypot(x / A, y / B);
  // The edge on the slab's faces z = ±h, seen down −z, where page and
  // plane share their axes.
  const edge = async (h: number) => {
    const study = {
      config: preset.config,
      layers: { ...defaultLayers, ...preset.layers },
      view: { yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 },
      animation: { mode: "reveal", camera: "hold", duration: 10, tracks: [] },
      cut: {
        ...preset.cut,
        offset: h,
        others: [{ normal: at(0, 0, -1), offset: h }],
      },
    };
    await page.goto(
      `/?study=3d#s=${deflateRawSync(
        Buffer.from(JSON.stringify({ v: 1, notebook: "3d", study })),
      ).toString("base64url")}`,
    );
    await settled(page);
    const { meta, groups } = svgParts(
      (await download(page, "Lines (SVG) · every line")).toString(),
    );
    const { center, zoom, radius } = meta.view;
    const scale = (760 * zoom) / (1.16 * radius);
    const world = groups.cut.map(([x, y]) => [
      (x - 1000) / scale + center.x,
      (760 - y) / scale + center.y,
    ]);
    const near = world.filter((p) => Math.abs(evolute(p)) < 0.03);
    const band = world
      .filter((p) => Math.abs(evolute(p)) >= 0.03)
      .map(inside)
      .sort((x, y) => x - y);
    return { world, near, band };
  };
  const thick = await edge(preset.cut!.offset),
    thin = await edge(preset.cut!.offset / 4);
  for (const { world, near, band } of [thick, thin]) {
    expect(world.length).toBeGreaterThan(1000);
    // About half the edge follows the evolute out to its cusps at
    // (0, ±(a² − b²)/b); the rest lies inside the ellipse, never outside.
    expect(near.length).toBeGreaterThan(world.length / 3);
    expect(Math.max(...near.map((p) => Math.abs(p[1])))).toBeCloseTo(
      (a * a - b * b) / b,
      2,
    );
    expect(band.length).toBeGreaterThan(world.length / 3);
    expect(band[0]).toBeGreaterThan(0);
    expect(band.at(-1)!).toBeLessThan(0.25);
  }
  // A quarter of the thickness brings the band's edge in by 4^(2/3) ≈ 2.52
  // everywhere along it: its nearest, middle and farthest points alike.
  for (const q of [0, 0.5, 1]) {
    const at = (band: number[]) =>
      band[Math.min(band.length - 1, Math.floor(q * band.length))];
    const ratio = at(thick.band) / at(thin.band);
    expect(ratio, `quantile ${q}`).toBeGreaterThan(2.2);
    expect(ratio, `quantile ${q}`).toBeLessThan(2.8);
  }
});
