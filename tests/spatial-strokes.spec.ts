import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import { probe, frameDifference } from "./video";
import { choosePreset } from "./helpers";
import {
  defaultSight,
  inkWeight,
  lineWeights,
  strokeRecord,
  strokeUnit,
  strokeJoins,
  strokeWidth,
  weightScale,
  type LineWeight,
  type Sight,
} from "../web/spatial/sight";
import { defaultLayers } from "../web/spatial/renderer";
import { spatialPresets } from "../web/spatial/presets";
import { lineColor, palette } from "../web/spatial/palette";
import { defaultCut, type Cut } from "../web/spatial/cut";
import { decodePng } from "./png";

// Line weights: strokes drawn as screen-space quads whose width is a share
// of the page, as the 2D notebook's strokes are, or hairlines one device
// pixel wide, as every 3D drawing was before weights.
const stage = (page: Page) => page.locator(".spatial-stage");
const settled = (page: Page) =>
  expect(stage(page)).toHaveAttribute("aria-busy", "false");
const weightBox = (page: Page) => page.getByRole("group", { name: "Lines" });
const page2000 = { width: 2000, height: 1520 };

test("a stroke's width is its weight on a 1000 × 760 page, scaled with the page", () => {
  expect(strokeUnit(page2000)).toBe(2);
  expect(strokeUnit({ width: 1000, height: 760 })).toBe(1);
  expect(strokeUnit({ width: 1000, height: 380 })).toBe(0.5);
  expect(strokeUnit({ width: 500, height: 760 })).toBe(0.5);
  expect(lineWeights.map((w) => w.value)).toEqual([
    "hairline",
    "fine",
    "regular",
    "bold",
  ]);
  expect(defaultSight.weight).toBe("regular");
  const curve = { ink: 2 };
  expect(strokeWidth(curve, "regular", page2000)).toBeCloseTo(
    2 * inkWeight(2),
    12,
  );
  expect(strokeWidth(curve, "bold", page2000)).toBeCloseTo(
    2 * inkWeight(2) * weightScale.bold,
    12,
  );
  expect(strokeWidth(curve, "fine", page2000)).toBeCloseTo(
    2 * inkWeight(2) * weightScale.fine,
    12,
  );
  expect(weightScale.fine).toBeLessThan(1);
  expect(weightScale.regular).toBe(1);
  expect(weightScale.bold).toBeGreaterThan(1);
  // Hairlines have no width to scale: one device pixel at any size.
  expect(strokeWidth(curve, "hairline", page2000)).toBeUndefined();
  // A batch may set its own weight.
  expect(strokeWidth({ ink: 2, weight: 1 }, "regular", page2000)).toBe(2);
  // The curve outweighs its families, which outweigh construction lines.
  expect(inkWeight(2)).toBeGreaterThan(inkWeight(3));
  expect(inkWeight(3)).toBeGreaterThan(inkWeight(1));
  expect(inkWeight(1)).toBeGreaterThanOrEqual(inkWeight(4));
  for (const ink of [8, 9, 10, 11, 12])
    expect(inkWeight(ink)).toBeGreaterThan(inkWeight(1));
  // Exports record weights only when they draw strokes.
  expect(strokeRecord({ ...defaultSight, weight: "hairline" })).toBeUndefined();
  expect(strokeRecord(defaultSight)).toMatchObject({ weight: "regular" });
});

test("each segment knows the neighbors it joins, so strokes mitre only where a polyline continues", () => {
  const p = (x: number, y: number) => [x, y, 0, 0, 0, 1, 0];
  // A polyline of three segments, a break, then one lone segment.
  const data = new Float32Array([
    ...p(0, 0),
    ...p(1, 0),
    ...p(1, 0),
    ...p(2, 1),
    ...p(2, 1),
    ...p(3, 1),
    ...p(5, 5),
    ...p(6, 5),
  ]);
  const j = strokeJoins(data);
  expect(j.length).toBe(4 * 8);
  const at = (v: number) => [...j.subarray(4 * v, 4 * v + 4)];
  // Starts: the first has no neighbor; the next two join their previous
  // segment's start; the lone one starts anew.
  expect(at(0)[3]).toBe(0);
  expect(at(2)).toEqual([0, 0, 0, 1]);
  expect(at(4)).toEqual([1, 0, 0, 1]);
  expect(at(6)[3]).toBe(0);
  // Ends: joined to the next segment's end, except at a break and the last.
  expect(at(1)).toEqual([2, 1, 0, 1]);
  expect(at(3)).toEqual([3, 1, 0, 1]);
  expect(at(5)[3]).toBe(0);
  expect(at(7)[3]).toBe(0);
});

// A circle of radius 2 in the xy-plane, seen face on: its leftmost point,
// on the page's middle row, has a vertical tangent, so the row crosses the
// stroke at right angles.
const circle = (sight: Partial<Sight>, layers = false) => ({
  config: {
    ...structuredClone(spatialPresets[0].config),
    format: "parametric",
    curve: {
      x: "2*cos(t)",
      y: "2*sin(t)",
      z: "0",
      a: 1,
      min: 0,
      max: 2 * Math.PI,
    },
  },
  layers: Object.fromEntries(
    Object.keys(defaultLayers).map((k) => [k, layers]),
  ),
  view: { yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 },
  animation: { mode: "reveal", camera: "hold", duration: 10, tracks: [] },
  sight: { ...defaultSight, ...sight },
});
const linkTo = (study: unknown) =>
  `/?study=3d#s=${deflateRawSync(
    Buffer.from(JSON.stringify({ v: 1, notebook: "3d", study })),
  ).toString("base64url")}`;
async function openLink(page: Page, study: unknown) {
  await page.goto(linkTo(study));
  await settled(page);
  await expect(page.locator("#spatial-artwork")).toBeVisible();
}
async function download(page: Page, item: string | RegExp) {
  await page.getByRole("button", { name: "Export image", exact: true }).click();
  const event = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: item, exact: typeof item === "string" })
    .click();
  return readFile((await (await event).path())!);
}
const png = "PNG image · 2000 × 1520";
const scale255 = (c: readonly number[]) => c.map((v) => v * 255);
// The stroke's width in pixels across a row: each pixel's share of the way
// from the background to the curve's color, summed over the left half.
function widthAcross(
  row: number[],
  ink: readonly number[],
  ground: readonly number[],
) {
  const d = [0, 1, 2].map((k) => ink[k] - ground[k]);
  const dd = d.reduce((s, v) => s + v * v, 0);
  let sum = 0;
  for (let x = 0; x < row.length / 8; x++) {
    let dot = 0;
    for (let k = 0; k < 3; k++) dot += (row[4 * x + k] - ground[k]) * d[k];
    sum += Math.max(0, Math.min(1, dot / dd));
  }
  return sum;
}
// The middle row of the live drawing, and the drawing's size.
async function liveRow(page: Page) {
  return page.locator("#spatial-artwork").evaluate((c: HTMLCanvasElement) => {
    const copy = document.createElement("canvas");
    copy.width = c.width;
    copy.height = c.height;
    const g = copy.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(c, 0, 0);
    const y = Math.floor(c.height / 2);
    return {
      width: c.width,
      height: c.height,
      row: [...g.getImageData(0, y, c.width, 1).data],
    };
  });
}
async function pngRow(page: Page, bytes: Buffer, y?: number) {
  const other = await page.context().newPage();
  try {
    return await other.evaluate(
      async ([bytes, y]) => {
        const bitmap = await createImageBitmap(
          new Blob([new Uint8Array(bytes)], { type: "image/png" }),
        );
        const c = document.createElement("canvas");
        c.width = bitmap.width;
        c.height = bitmap.height;
        const g = c.getContext("2d", { willReadFrequently: true })!;
        g.drawImage(bitmap, 0, 0);
        return [
          ...g.getImageData(0, y ?? Math.floor(c.height / 2), c.width, 1).data,
        ];
      },
      [Array.from(bytes), y ?? null] as const,
    );
  } finally {
    await other.close();
  }
}

test("a stroke is as wide as its weight, live and in a still, and a hairline stays one pixel", async ({
  page,
}) => {
  const ground = scale255(palette.background[0]),
    ink = scale255(lineColor(2, 0, false));
  await openLink(page, circle({ weight: "hairline" }));
  const select = weightBox(page).getByLabel("Weight", { exact: true });
  await expect(select).toHaveValue("hairline");
  const measured: Record<string, { live: number; still: number }> = {};
  for (const weight of ["hairline", "fine", "regular", "bold"] as const) {
    await select.selectOption(weight);
    await expect
      .poll(async () =>
        JSON.parse(
          (await page
            .locator("#spatial-artwork")
            .getAttribute("data-strokes")) ?? "null",
        ),
      )
      .toEqual(weight === "hairline" ? null : { weight });
    const live = await liveRow(page);
    const still = await pngRow(page, await download(page, png));
    measured[weight] = {
      live: widthAcross(live.row, ink, ground),
      still: widthAcross(still, ink, ground),
    };
    const m = measured[weight];
    if (weight === "hairline") {
      // One device pixel at any size.
      expect(m.live).toBeGreaterThan(0.6);
      expect(m.live).toBeLessThan(1.4);
      expect(m.still).toBeGreaterThan(0.6);
      expect(m.still).toBeLessThan(1.4);
      continue;
    }
    const expected = (size: { width: number; height: number }) =>
      strokeWidth({ ink: 2 }, weight, size)!;
    const near = (got: number, want: number) =>
      expect(
        Math.abs(got - want),
        `${weight}: ${got} for ${want}`,
      ).toBeLessThan(Math.max(0.35, 0.1 * want));
    // A stroke thinner than a pixel is drawn one pixel wide at that share
    // of its color, so its sum is its width either way.
    near(m.live, expected(live));
    near(m.still, expected(page2000));
  }
  console.log("Stroke widths", measured);
  // A still twice the size draws its strokes twice as wide.
  expect(measured.bold.still / measured.fine.still).toBeCloseTo(
    weightScale.bold / weightScale.fine,
    0,
  );
});

test("a stroke narrower than a pixel keeps its width as coverage, and perspective keeps a stroke's width", async ({
  page,
}) => {
  const ground = scale255(palette.background[0]),
    ink = scale255(lineColor(2, 0, false));
  // A phone's canvas at one device pixel per CSS pixel: a fine curve is
  // under half a pixel wide, drawn a pixel wide at that share.
  await page.setViewportSize({ width: 390, height: 844 });
  await openLink(page, circle({ weight: "fine" }));
  const live = await liveRow(page);
  const want = strokeWidth({ ink: 2 }, "fine", live)!;
  expect(want).toBeLessThan(0.75);
  const got = widthAcross(live.row, ink, ground);
  console.log("Sub-pixel stroke", { want, got });
  expect(Math.abs(got - want)).toBeLessThan(0.2);
  // Through a lens the circle, in the plane through the framed point, is
  // drawn at the orthographic scale; its stroke keeps its width on the page.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openLink(page, {
    ...circle({ weight: "regular" }),
    projection: "normal",
  });
  const still = widthAcross(
    await pngRow(page, await download(page, png)),
    ink,
    ground,
  );
  const wide = strokeWidth({ ink: 2 }, "regular", page2000)!;
  console.log("Perspective stroke", { want: wide, got: still });
  expect(Math.abs(still - wide)).toBeLessThan(0.1 * wide);
});

// A helix coiled around a perspective eye: its segments pass beside and
// behind the eye, and each stroke shows only the part of its segment ahead
// of the near plane, along that part's direction on the page.
test("strokes passing behind a perspective eye keep only their visible part", async ({
  page,
}) => {
  const helix = {
    ...circle({ weight: "bold" }),
    view: { yaw: 0, pitch: 0, zoom: 4, panX: 0, panY: 0 },
    projection: "wide",
  };
  helix.config.curve = {
    x: "2*cos(t)",
    y: "2*sin(t)",
    z: "0.5*t",
    a: 1,
    min: -4 * Math.PI,
    max: 4 * Math.PI,
  };
  await openLink(page, helix);
  const drawn = await download(page, png);
  const every = (await download(page, "Lines (SVG) · every line")).toString(
    "utf8",
  );
  const blank = { ...helix, view: { ...helix.view, panX: 1e4 } };
  await openLink(page, blank);
  const { ink } = await inkMask(page, drawn, await download(page, png));
  const any = reach(visibleSegments(every), page2000.width, page2000.height);
  const stray = ink.filter((i) => !any[i]).length;
  console.log("Strokes around the eye", { ink: ink.length, stray });
  expect(ink.length).toBeGreaterThan(20_000);
  expect(stray / ink.length).toBeLessThan(0.005);
});

// A plane seen obliquely, with its parameter curves lying on it: each
// stroke is as wide over the sheet as over the background, not cut along
// one side by the sheet's slope beneath it.
test("strokes lying on an oblique sheet stay whole", async ({ page }) => {
  const sphere = spatialPresets.find(
    (p) => p.name === "A sphere collapsing to one focus",
  )!;
  const plane = (surface: boolean, curves: boolean) => ({
    config: {
      ...structuredClone(sphere.config),
      surface: {
        ...sphere.config.surface,
        kind: "paraboloid",
        a: 0,
        b: 0,
        c: 0,
        uMin: -1,
        uMax: 1,
        vMin: -1,
        vMax: 1,
        uSamples: 24,
        vSamples: 24,
        curves: 12,
        offset: 0,
      },
    },
    layers: Object.fromEntries(
      Object.keys(defaultLayers).map((k) => [
        k,
        k === "surface" ? surface : k === "curves" ? curves : false,
      ]),
    ),
    view: { yaw: 0.4, pitch: 1.3, zoom: 1, panX: 0, panY: 0 },
    animation: { mode: "reveal", camera: "hold", duration: 10, tracks: [] },
    sight: { ...defaultSight, weight: "bold" },
  });
  const shot = async (surface: boolean, curves: boolean) => {
    await openLink(page, plane(surface, curves));
    return download(page, png);
  };
  const onSheet = (
    await inkMask(page, await shot(true, true), await shot(true, false))
  ).ink.length;
  const alone = (
    await inkMask(page, await shot(false, true), await shot(false, false))
  ).ink.length;
  console.log("Strokes on a sheet", { onSheet, alone });
  expect(alone).toBeGreaterThan(10_000);
  expect(onSheet / alone).toBeGreaterThan(0.9);
});

// The drawing's lines against the vector export's visible lines, sampled
// on the CPU at the same page size: every pixel the strokes ink lies within
// a stroke's reach of a visible line, and the visible lines are inked. A
// trefoil's tube hides the back of each contact circle and meridian; a
// perspective camera close in sees lines pass behind the eye.
const tube = spatialPresets.find(
  (p) => p.name === "A tube around the trefoil",
)!;
const tubeStudy = (
  lines: boolean,
  view = { yaw: 0.3, pitch: 0.75, zoom: 1, panX: 0, panY: 0 },
  projection = "orthographic",
) => ({
  config: structuredClone(tube.config),
  layers: {
    ...defaultLayers,
    circles: lines,
    meridians: lines,
    frames: lines,
    seam: lines,
  },
  view,
  animation: { mode: "reveal", camera: "hold", duration: 10, tracks: [] },
  sight: { ...defaultSight, weight: "bold" },
  projection,
});
// The pixels where lines change the drawing without them, and which of
// those lie over a sheet rather than the background or a sheet's edge.
async function inkMask(page: Page, a: Buffer, b: Buffer) {
  const ground = scale255(palette.background[0]);
  const other = await page.context().newPage();
  try {
    return await other.evaluate(
      async ([a, b, ground]) => {
        const read = async (bytes: number[]) => {
          const bitmap = await createImageBitmap(
            new Blob([new Uint8Array(bytes)], { type: "image/png" }),
          );
          const c = document.createElement("canvas");
          c.width = bitmap.width;
          c.height = bitmap.height;
          const g = c.getContext("2d", { willReadFrequently: true })!;
          g.drawImage(bitmap, 0, 0);
          return g.getImageData(0, 0, c.width, c.height).data;
        };
        const [p, q] = [await read(a), await read(b)];
        const ink: number[] = [],
          sheet: number[] = [];
        for (let i = 0; i < p.length; i += 4) {
          const d = Math.max(
            Math.abs(p[i] - q[i]),
            Math.abs(p[i + 1] - q[i + 1]),
            Math.abs(p[i + 2] - q[i + 2]),
          );
          if (d <= 10) continue;
          ink.push(i / 4);
          const s = Math.max(
            Math.abs(q[i] - ground[0]),
            Math.abs(q[i + 1] - ground[1]),
            Math.abs(q[i + 2] - ground[2]),
          );
          if (s > 100) sheet.push(i / 4);
        }
        return { ink, sheet };
      },
      [Array.from(a), Array.from(b), ground] as const,
    );
  } finally {
    await other.close();
  }
}
// Pixels within reach of these lines: a half width plus a pixel and a half
// for coverage at the edge and the sampled visibility's step.
function reach(
  segments: ReturnType<typeof visibleSegments>,
  width: number,
  height: number,
) {
  const near = new Uint8Array(width * height);
  for (const { a, b, half } of segments) {
    const r = half + 1.5;
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0]) - r)),
      x1 = Math.min(width - 1, Math.ceil(Math.max(a[0], b[0]) + r)),
      y0 = Math.max(0, Math.floor(Math.min(a[1], b[1]) - r)),
      y1 = Math.min(height - 1, Math.ceil(Math.max(a[1], b[1]) + r));
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      l2 = dx * dx + dy * dy;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5 - a[0],
          py = y + 0.5 - a[1];
        const t = l2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / l2)) : 0;
        if (Math.hypot(px - t * dx, py - t * dy) <= r) near[y * width + x] = 1;
      }
  }
  return near;
}
function visibleSegments(svg: string) {
  const out: { a: [number, number]; b: [number, number]; half: number }[] = [];
  for (const g of svg.matchAll(/<g id="([a-z0-9-]+)"([^>]*)>(.*?)<\/g>/gs)) {
    if (g[1].startsWith("hidden-")) continue;
    const groupWidth = +(g[2].match(/stroke-width="([\d.]+)"/)?.[1] ?? 1.5);
    for (const p of g[3].matchAll(/<path([^>]*)\/>/g)) {
      const width = +(p[1].match(/stroke-width="([\d.]+)"/)?.[1] ?? groupWidth);
      const d = p[1].match(/ d="([^"]*)"/)![1];
      let last: [number, number] | undefined;
      for (const m of d.matchAll(/([ML])(-?[\d.]+) (-?[\d.]+)/g)) {
        const at: [number, number] = [+m[2], +m[3]];
        if (m[1] === "L" && last) out.push({ a: last, b: at, half: width / 2 });
        last = at;
      }
    }
  }
  return out;
}
async function agreeWithLinework(
  page: Page,
  study: object,
  // The same study with its line layers hidden.
  bareStudy: object,
) {
  await openLink(page, study);
  const lined = await download(page, png);
  const svg = (
    await download(page, "Lines (SVG) · visible only, sampled")
  ).toString("utf8");
  const every = (await download(page, "Lines (SVG) · every line")).toString(
    "utf8",
  );
  await openLink(page, bareStudy);
  const bare = await download(page, png);
  const { ink, sheet } = await inkMask(page, lined, bare);
  const mask = ink;
  const segments = visibleSegments(svg);
  const { width, height } = page2000;
  // Over a sheet, ink belongs to a visible line. Elsewhere a wide stroke
  // may show beside the sheet that hides its center, so ink belongs to some
  // line; a stroke thrown across the page belongs to none.
  const near = reach(segments, width, height),
    any = reach(visibleSegments(every), width, height);
  const over = new Uint8Array(width * height);
  for (const i of sheet) over[i] = 1;
  const stray = mask.filter((i) => (over[i] ? !near[i] : !any[i])).length;
  // Visible lines, away from where they turn hidden, are inked.
  const inked = new Uint8Array(width * height);
  for (const i of mask) inked[i] = 1;
  let tried = 0,
    hit = 0;
  for (const { a, b } of segments) {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let s = 0; s <= length; s += 3) {
      const x = a[0] + ((b[0] - a[0]) * s) / Math.max(length, 1e-9),
        y = a[1] + ((b[1] - a[1]) * s) / Math.max(length, 1e-9);
      const px = Math.floor(x),
        py = Math.floor(y);
      if (px < 1 || py < 1 || px >= width - 1 || py >= height - 1) continue;
      tried++;
      let found = false;
      for (let v = -1; v <= 1 && !found; v++)
        for (let u = -1; u <= 1 && !found; u++)
          found = !!inked[(py + v) * width + px + u];
      if (found) hit++;
    }
  }
  return { ink: mask.length, stray, tried, hit };
}

test("strokes ink only lines the vector export finds visible, and ink those, orthographic and close in perspective", async ({
  page,
}) => {
  test.slow();
  for (const [name, study] of [
    ["orthographic", tubeStudy(true)],
    [
      "perspective",
      tubeStudy(
        true,
        { yaw: 0.3, pitch: 0.75, zoom: 3, panX: 0.4, panY: 0 },
        "wide",
      ),
    ],
  ] as const) {
    const r = await agreeWithLinework(
      page,
      study,
      tubeStudy(false, study.view, study.projection),
    );
    console.log("Strokes against linework", name, r);
    expect(r.ink, name).toBeGreaterThan(20_000);
    expect(r.tried, name).toBeGreaterThan(2_000);
    // The back halves of the circles alone would be a third of the ink.
    // What strays is a sliver along sheets' outlines, where the sheets'
    // offset lets a stroke just behind show by up to its half width.
    expect(r.stray / r.ink, name).toBeLessThan(0.02);
    expect(r.hit / r.tried, name).toBeGreaterThan(0.97);
  }
});

// Reflection in depth exchanges the two arms but leaves exactly the same
// retained line on the page. A removed arm must never own its neighbor's
// ink, including when the cut crosses the interior of their first segment.
for (const [name, cut] of [
  ["one plane", { offset: 0 }],
  ["inside a segment", { offset: 0.002 }],
  ["perspective inside a segment", { offset: 0.002 }],
  [
    "six planes",
    {
      offset: -2,
      others: [
        { normal: { x: 1, y: 0, z: 0 }, offset: -0.1 },
        { normal: { x: -1, y: 0, z: 0 }, offset: -2 },
        { normal: { x: 0, y: 1, z: 0 }, offset: -1 },
        { normal: { x: 0, y: -1, z: 0 }, offset: -1 },
        { normal: { x: 0, y: 0, z: 1 }, offset: 0 },
      ],
      beyond: "every",
    },
  ],
  [
    "beyond every plane",
    {
      offset: 0,
      others: [{ normal: { x: 1, y: 0, z: 0 }, offset: -0.1 }],
      beyond: "every",
    },
  ],
  [
    "beyond any plane",
    {
      offset: 0,
      others: [{ normal: { x: 1, y: 0, z: 0 }, offset: 0.1 }],
      beyond: "any",
    },
  ],
] as [string, Partial<Cut>][]) {
  test(`a round joint keeps the retained arm with ${name}`, async ({
    page,
  }) => {
    await page.emulateMedia({
      colorScheme: name === "beyond any plane" ? "dark" : "light",
    });
    for (const weight of ["fine", "bold"] as const) {
      const captures = [];
      for (const z of ["t", "-t"]) {
        const study = {
          ...circle({ weight }),
          ...(name.startsWith("perspective") && {
            projection: "normal",
            sight: { ...defaultSight, weight, depth: "taper" },
          }),
          cut: {
            ...defaultCut,
            ...cut,
            enabled: true,
            cuts: "all",
            edge: false,
          },
        };
        study.config.curve = {
          x: "abs(t)",
          y: "0",
          z,
          a: 1,
          min: -1,
          max: 1,
        };
        study.config.samples = 240;
        study.view.zoom = 4;
        study.view.panX = 0.5;
        if (name === "one plane" && z === "-t") {
          await page.getByLabel("z(t)", { exact: true }).fill(z);
          await page.getByLabel("z(t)", { exact: true }).blur();
          await expect
            .poll(
              async () =>
                JSON.parse(
                  (await stage(page).getAttribute("data-config")) ?? "{}",
                ).curve?.z,
            )
            .toBe(z);
          await settled(page);
        } else await openLink(page, study);
        const live = await page
          .locator("#spatial-artwork")
          .evaluate((c: HTMLCanvasElement) => c.toDataURL("image/png"));
        captures.push({
          live: decodePng(Buffer.from(live.split(",")[1], "base64")),
          still: decodePng(await download(page, png)),
        });
      }
      expect([captures[0].still.width, captures[0].still.height]).toEqual([
        2000, 1520,
      ]);
      for (const output of ["live", "still"] as const) {
        const [a, b] = captures.map((c) => c[output]);
        expect([b.width, b.height]).toEqual([a.width, a.height]);
        const ground = [...a.rgba.slice(0, 3)];
        let changed = 0,
          inked = 0;
        for (let i = 0; i < a.rgba.length; i += 4) {
          const difference = [0, 1, 2].reduce(
            (sum, k) => sum + Math.abs(a.rgba[i + k] - b.rgba[i + k]),
            0,
          );
          const ink = [0, 1, 2].reduce(
            (sum, k) => sum + Math.abs(a.rgba[i + k] - ground[k]),
            0,
          );
          if (difference > 20) changed++;
          if (ink > 100) inked++;
        }
        // Ignore at most four boundary pixels of sample-rounding noise, but
        // demand substantial retained geometry so two blank images cannot pass.
        expect(inked, `${weight} ${output}`).toBeGreaterThan(
          output === "live" && name === "beyond any plane"
            ? 20
            : output === "live" || name === "beyond any plane"
              ? 50
              : 500,
        );
        expect(changed, `${weight} ${output}`).toBeLessThan(5);
        if (!name.startsWith("perspective")) {
          // A retained arm has one stroke's coverage, even though the
          // uncut fold would paint its two distant arms on top of each other.
          const dark = name === "beyond any plane",
            ink = scale255(lineColor(2, 0, dark)),
            delta = ink.map((v, k) => v - ground[k]),
            dd = delta.reduce((sum, v) => sum + v * v, 0),
            x = Math.floor(a.width * (dark ? 0.51 : 0.75));
          let coverage = 0;
          for (let y = 0; y < a.height; y++) {
            let dot = 0;
            for (let k = 0; k < 3; k++)
              dot += (a.rgba[4 * (y * a.width + x) + k] - ground[k]) * delta[k];
            coverage += Math.max(0, Math.min(1, dot / dd));
          }
          const width = strokeWidth({ ink: 2 }, weight, a)!;
          expect(
            Math.abs(coverage - width),
            `${weight} ${output} coverage`,
          ).toBeLessThan(Math.max(0.35, width * 0.1));
        }
      }
    }
  });
}

test("exports record the weight; vector lines carry each stroke's width; hairlines leave files as they were", async ({
  page,
}) => {
  await openLink(page, tubeStudy(true));
  const meta = (svg: string) =>
    JSON.parse(
      svg
        .match(/<desc>(.*?)<\/desc>/s)![1]
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&amp;", "&"),
    );
  const embedded = (await download(page, /^SVG · embedded/)).toString("utf8");
  expect(meta(embedded).strokes).toMatchObject({ weight: "bold" });
  const lines = (await download(page, "Lines (SVG) · every line")).toString(
    "utf8",
  );
  expect(meta(lines).strokes).toMatchObject({ weight: "bold" });
  const widths = new Set(
    [...lines.matchAll(/<path[^>]*stroke-width="([\d.]+)"/g)].map((m) => +m[1]),
  );
  const want = (ink: number) =>
    Math.round(strokeWidth({ ink }, "bold", page2000)! * 100) / 100;
  // The base curve, the circles (construction) and meridians (a family).
  for (const ink of [2, 1, 3]) expect(widths).toContain(want(ink));
  await weightBox(page)
    .getByLabel("Weight", { exact: true })
    .selectOption("hairline");
  const plain = (await download(page, "Lines (SVG) · every line")).toString(
    "utf8",
  );
  expect(meta(plain).strokes).toBeUndefined();
  expect(plain).not.toMatch(/<path[^>]*stroke-width/);
  expect(
    meta((await download(page, /^SVG · embedded/)).toString("utf8")).strokes,
  ).toBeUndefined();
});

test("an animation export draws the weight it began with, ending on the still", async ({
  page,
}) => {
  test.slow();
  const orbit = (weight: LineWeight) => ({
    ...tubeStudy(true),
    animation: { mode: "orbit", camera: "current", duration: 5, tracks: [] },
    sight: { ...defaultSight, weight },
  });
  await openLink(page, orbit("hairline"));
  const hair = await pngRow(page, await download(page, png));
  await openLink(page, orbit("bold"));
  const boldRow = await pngRow(page, await download(page, png));
  expect(boldRow).not.toEqual(hair);
  const still = await download(page, png);
  // The still's pixels, carried as base64: a 2000 × 1520 image as an
  // array of numbers is too slow to pass between Node and the page.
  const full = await page.context().newPage();
  const rgba = Buffer.from(
    await full
      .evaluate(async (input) => {
        const image = new Image();
        image.src = `data:image/png;base64,${input}`;
        await image.decode();
        const c = document.createElement("canvas");
        c.width = image.width;
        c.height = image.height;
        const g = c.getContext("2d")!;
        g.drawImage(image, 0, 0);
        const data = g.getImageData(0, 0, c.width, c.height).data;
        let text = "";
        for (let i = 0; i < data.length; i += 0x8000)
          text += String.fromCharCode(...data.subarray(i, i + 0x8000));
        return btoa(text);
      }, still.toString("base64"))
      .finally(() => full.close()),
    "base64",
  );
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
  await page.getByLabel("Duration (seconds)").fill("0.4");
  const settings = page.locator("#spatial-export-settings");
  if ((await settings.getAttribute("open")) === null)
    await settings.locator(":scope > summary").click();
  await page.getByLabel("Export format", { exact: true }).selectOption("mp4");
  await page.getByLabel("Export frame rate").selectOption("15");
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("2");
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export MP4/ }).click();
  // Changing the weight once the export has begun does not reach it.
  await weightBox(page)
    .getByLabel("Weight", { exact: true })
    .selectOption("hairline");
  const path = (await (await event).path())!;
  const data = probe(path);
  if (data) expect([data.width, data.height]).toEqual([2000, 1520]);
  const d = frameDifference(path, 2000, 1520, 5, rgba);
  if (d) {
    console.log("Stroke export", d);
    expect(d.meanDifference).toBeLessThan(3);
  }
});

test("the weight control offers every weight, and presets bring their own", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await settled(page);
  const select = weightBox(page).getByLabel("Weight", { exact: true });
  await expect(select).toHaveValue("regular");
  await expect(select.locator("option")).toHaveText(
    lineWeights.map((w) => w.label),
  );
  await select.selectOption("bold");
  for (const p of spatialPresets.filter((p) => p.sight?.weight)) {
    await choosePreset(page, { label: p.name });
    await settled(page);
    await expect(select, p.name).toHaveValue(p.sight!.weight);
  }
  // A preset without its own sight returns to the default weight.
  await choosePreset(page, 0);
  await expect(select).toHaveValue("regular");
});

// Strokes behind a sheet blend at the faint or dashed opacity times their
// coverage, with butt ends whose fringes sum to one where segments meet: a
// pixel of the knot inside the tube goes no further toward the knot's color
// than that opacity, where a doubled joint would reach 1 − (1 − 0.35)² ≈
// 0.58, except where the knot crosses itself on the page. The stroke's
// interior reaches the opacity.
test("strokes behind sheets never pass their opacity where segments meet", async ({
  page,
}) => {
  const only = Object.fromEntries(
    Object.keys(defaultLayers).map((k) => [k, k === "surface"]),
  );
  const study = (hidden: Sight["hidden"]) => ({
    ...tubeStudy(true),
    layers: only,
    sight: { ...defaultSight, weight: "regular", hidden },
  });
  const shots: Record<string, Buffer> = {};
  for (const hidden of ["hide", "faint", "dashed"] as const) {
    await openLink(page, study(hidden));
    shots[hidden] = await download(page, png);
  }
  const L = scale255(lineColor(2, 0, false));
  const other = await page.context().newPage();
  const seen = await other
    .evaluate(
      async ([shots, L]) => {
        const read = async (bytes: number[]) => {
          const bitmap = await createImageBitmap(
            new Blob([new Uint8Array(bytes)], { type: "image/png" }),
          );
          const c = document.createElement("canvas");
          c.width = bitmap.width;
          c.height = bitmap.height;
          const g = c.getContext("2d", { willReadFrequently: true })!;
          g.drawImage(bitmap, 0, 0);
          return {
            data: g.getImageData(0, 0, c.width, c.height).data,
            w: c.width,
          };
        };
        const A = await read(shots.hide);
        const width = A.w,
          a = A.data;
        // Where the knot shows in the opaque drawing, and near it: left out.
        const shown = new Uint8Array(a.length / 4);
        for (let i = 0; i < a.length; i += 4)
          if (
            Math.abs(a[i] - L[0]) +
              Math.abs(a[i + 1] - L[1]) +
              Math.abs(a[i + 2] - L[2]) <
            90
          ) {
            const p = i / 4,
              x = p % width,
              y = Math.floor(p / width);
            for (let v = -8; v <= 8; v++)
              for (let u = -8; u <= 8; u++) {
                const q = (y + v) * width + x + u;
                if (q >= 0 && q < shown.length) shown[q] = 1;
              }
          }
        const over: number[] = [];
        const out: Record<string, { changed: number; full: number }> = {};
        for (const name of ["faint", "dashed"]) {
          const f = (await read(shots[name])).data;
          let changed = 0,
            full = 0;
          for (let i = 0; i < a.length; i += 4) {
            if (shown[i / 4]) continue;
            const d = [0, 1, 2].map((k) => L[k] - a[i + k]);
            const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
            // A pixel already near the knot's color says little.
            if (dd < 900) continue;
            const t =
              ((f[i] - a[i]) * d[0] +
                (f[i + 1] - a[i + 1]) * d[1] +
                (f[i + 2] - a[i + 2]) * d[2]) /
              dd;
            if (Math.abs(t) < 0.02) continue;
            changed++;
            if (t > (name === "faint" ? 0.3 : 0.7)) full++;
            if (t > (name === "faint" ? 0.35 : 0.8) + 0.03 && name === "faint")
              over.push(i / 4);
          }
          out[name] = { changed, full };
        }
        return {
          ...out,
          over: over.map((p) => [p % width, Math.floor(p / width)]),
        };
      },
      [
        Object.fromEntries(
          Object.entries(shots).map(([k, v]) => [k, Array.from(v)]),
        ),
        L,
      ] as const,
    )
    .finally(() => other.close());
  // Past the opacity only where the knot crosses itself on the page, two
  // stretches of it overlapping: the trefoil's three crossings. Doubled
  // joints would fill the whole knot.
  const over = (seen as unknown as { over: [number, number][] }).over;
  const crossings: [number, number][][] = [];
  for (const p of over) {
    const near = crossings.find((c) =>
      c.some(([x, y]) => Math.hypot(x - p[0], y - p[1]) < 30),
    );
    if (near) near.push(p);
    else crossings.push([p]);
  }
  delete (seen as unknown as { over?: unknown }).over;
  console.log("Strokes behind sheets", seen);
  expect(seen.faint.changed).toBeGreaterThan(5_000);
  expect(crossings.length).toBeLessThanOrEqual(3);
  for (const c of crossings) expect(c.length).toBeLessThan(80);
  expect(seen.faint.full).toBeGreaterThan(1_000);
  expect(seen.dashed.changed).toBeGreaterThan(2_000);
  expect(seen.dashed.full).toBeGreaterThan(500);
});

// Thin strokes blend and write no depth: where the veil's strings cross in
// front of its filaments, the filaments still show beneath them instead of
// being cut by the strings' faint fringes.
test("thin strokes crossing in front leave the strokes behind them whole", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const veil = spatialPresets.find(
    (p) => p.name === "A helix unwound into a veil",
  )!;
  const study = (strings: boolean) => ({
    config: structuredClone(veil.config),
    layers: { ...defaultLayers, strings },
    view: { yaw: 0.3, pitch: 0.75, zoom: 1, panX: 0, panY: 0 },
    animation: { mode: "reveal", camera: "hold", duration: 10, tracks: [] },
    sight: veil.sight,
  });
  await openLink(page, study(false));
  const bare = await download(page, png);
  await openLink(page, study(true));
  const strung = await download(page, png);
  const ground = scale255(palette.background[1]);
  const other = await page.context().newPage();
  const seen = await other
    .evaluate(
      async ([a, b, ground]) => {
        const read = async (bytes: number[]) => {
          const bitmap = await createImageBitmap(
            new Blob([new Uint8Array(bytes)], { type: "image/png" }),
          );
          const c = document.createElement("canvas");
          c.width = bitmap.width;
          c.height = bitmap.height;
          const g = c.getContext("2d", { willReadFrequently: true })!;
          g.drawImage(bitmap, 0, 0);
          return g.getImageData(0, 0, c.width, c.height).data;
        };
        const [p, q] = [await read(a), await read(b)];
        const away = (d: Uint8ClampedArray, i: number) =>
          Math.max(
            Math.abs(d[i] - ground[0]),
            Math.abs(d[i + 1] - ground[1]),
            Math.abs(d[i + 2] - ground[2]),
          );
        let inked = 0,
          lost = 0;
        for (let i = 0; i < p.length; i += 4) {
          // A filament's well-covered pixels, which strings may tint but
          // must never return to the background.
          if (away(p, i) < 150) continue;
          inked++;
          if (away(q, i) < 40) lost++;
        }
        return { inked, lost };
      },
      [Array.from(bare), Array.from(strung), ground] as const,
    )
    .finally(() => other.close());
  console.log("Strokes behind thin strokes", seen);
  expect(seen.inked).toBeGreaterThan(5_000);
  expect(seen.lost / seen.inked).toBeLessThan(0.002);
});

// A polyline turning sharply, seen face on: a V with a sample at its
// point, its arms turning there by 152° and 170°, and a line folded back on
// itself (slope 0), turning by 180°, judged past the fold, since its arms
// lie on one another and double as any line drawn twice does. Each pixel
// near the turn is covered as the round-joined stroke would cover it, the distance to the
// nearer arm against the stroke's half width, read from the vector export's
// own segments at the same page size: no notch where the stroke parts, and
// no doubled ink where both segments' quads draw. A thin stroke blends, so
// doubled ink shows; a bold one uses sample coverage.
test("strokes turning sharper than 120° are joined round, neither parting nor doubling", async ({
  page,
}) => {
  const vee = (slope: number, weight: LineWeight) => {
    const study = circle({ weight });
    study.config.curve = {
      x: slope ? "t" : "abs(t)",
      y: slope ? `${slope}*abs(t)` : "0",
      z: "0",
      a: 1,
      min: -1,
      max: 1,
    };
    study.config.samples = 240;
    return study;
  };
  const ground = scale255(palette.background[0]),
    ink = scale255(lineColor(2, 0, false));
  const seen: Record<string, unknown> = {};
  for (const [slope, weight, scale, clipped] of [
    [3, "fine", 1],
    [12, "fine", 1],
    [0, "fine", 1],
    [3, "bold", 2],
    [12, "bold", 2],
    [0, "bold", 2],
    [12, "fine", 1, true],
    [12, "fine", 1, "six planes"],
  ] as const) {
    const study = {
      ...vee(slope, weight),
      ...(clipped && {
        cut: {
          ...defaultCut,
          enabled: true,
          cuts: "all",
          edge: false,
          normal: { x: 1, y: 0, z: 0 },
          ...(clipped === "six planes" && {
            offset: -2,
            others: [
              { normal: { x: 0, y: 1, z: 0 }, offset: -2 },
              { normal: { x: 0, y: -1, z: 0 }, offset: -14 },
              { normal: { x: 0, y: 0, z: 1 }, offset: -1 },
              { normal: { x: 0, y: 0, z: -1 }, offset: -1 },
              { normal: { x: 1, y: 0, z: 0 }, offset: 0 },
            ],
            beyond: "every",
          }),
        },
      }),
    };
    await openLink(page, study);
    const size = { width: 1000 * scale, height: 760 * scale };
    await page
      .getByRole("button", { name: "Export image", exact: true })
      .click();
    await page
      .getByRole("menuitemradio", { name: `${size.width} × ${size.height}` })
      .click();
    if (await page.getByRole("menu", { name: "Export image" }).isVisible())
      await page.keyboard.press("Escape");
    const still = await download(
      page,
      `PNG image · ${size.width} × ${size.height}`,
    );
    const svg = (await download(page, "Lines (SVG) · every line")).toString(
      "utf8",
    );
    const segments = visibleSegments(svg);
    // The turn: the V's point, lowest on the page for y = slope·|t| drawn
    // upward, or the fold, leftmost for x = |t|.
    const point = segments
      .flatMap((s) => [s.a, s.b])
      .reduce((p, q) => (slope ? (q[1] > p[1] ? q : p) : q[0] < p[0] ? q : p));
    const half = segments[0].half;
    const R = 4 * half + 8;
    const x0 = Math.floor(point[0] - R),
      y0 = Math.floor(point[1] - R),
      n = Math.ceil(2 * R);
    const pixels = await page
      .context()
      .newPage()
      .then(async (other) => {
        try {
          return await other.evaluate(
            async ([bytes, x0, y0, n]) => {
              const bitmap = await createImageBitmap(
                new Blob([new Uint8Array(bytes)], { type: "image/png" }),
              );
              const c = document.createElement("canvas");
              c.width = bitmap.width;
              c.height = bitmap.height;
              const g = c.getContext("2d", { willReadFrequently: true })!;
              g.drawImage(bitmap, 0, 0);
              return [...g.getImageData(x0, y0, n, n).data];
            },
            [Array.from(still), x0, y0, n] as const,
          );
        } finally {
          await other.close();
        }
      });
    const d = [0, 1, 2].map((k) => ink[k] - ground[k]);
    const dd = d.reduce((s, v) => s + v * v, 0);
    let worst = 0,
      measured = 0,
      ideal = 0;
    for (let v = 0; v < n; v++)
      for (let u = 0; u < n; u++) {
        const px = x0 + u + 0.5,
          py = y0 + v + 0.5;
        if (!slope && px > point[0]) continue;
        let dist = Infinity;
        for (const { a, b } of segments) {
          const dx = b[0] - a[0],
            dy = b[1] - a[1],
            l2 = dx * dx + dy * dy;
          const t = l2
            ? Math.max(
                0,
                Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2),
              )
            : 0;
          dist = Math.min(
            dist,
            Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy),
          );
        }
        const want =
          Math.max(0, Math.min(1, half + 0.5 - dist)) * Math.min(1, 2 * half);
        const i = 4 * (v * n + u);
        let dot = 0;
        for (let k = 0; k < 3; k++) dot += (pixels[i + k] - ground[k]) * d[k];
        const got = Math.max(0, Math.min(1, dot / dd));
        measured += got;
        ideal += want;
        worst = Math.max(worst, Math.abs(got - want));
      }
    const name = `${weight}, slope ${slope}${clipped ? `, cut arm${clipped === "six planes" ? " with six planes" : ""}` : ""}`;
    seen[name] = { half, measured, ideal, worst };
  }
  console.log("Sharp joins", seen);
  for (const [name, r] of Object.entries(seen) as [
    string,
    { half: number; measured: number; ideal: number; worst: number },
  ][]) {
    expect(r.ideal, name).toBeGreaterThan(
      name.endsWith(" 0") ? r.half : 20 * r.half,
    );
    expect(Math.abs(r.measured - r.ideal) / r.ideal, name).toBeLessThan(0.03);
    // Sample coverage counts whole samples, a quarter at a time with four.
    expect(r.worst, name).toBeLessThan(name.startsWith("fine") ? 0.05 : 0.3);
  }
});
