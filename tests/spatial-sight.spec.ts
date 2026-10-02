import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import { choosePreset } from "./helpers";
import {
  arcLengths,
  defaultSight,
  isPlain,
  sightRecord,
  sightSpec,
  type HiddenLines,
  type Sight,
} from "../web/spatial/sight";
import { buildScene } from "../web/spatial/scene";
import { linework, linesSvg, type LineGroup } from "../web/spatial/linework";
import { defaultLayers } from "../web/spatial/renderer";
import type { SpatialResult, Vec3 } from "../web/spatial/types";
import { spatialPresets } from "../web/spatial/presets";
import { defaultCut, type Cut } from "../web/spatial/cut";
import { hex, lineColor, palette } from "../web/spatial/palette";

// Seeing through the drawing. Studies drawn with opaque sheets and hidden
// lines hidden must not change. Their line drawings are computed on the CPU
// and were recorded before seeing through existed. Their PNGs depend on the
// machine's rasterizer (they matched main at 0e7ad8f on macOS, not on CI's
// SwiftShader), so here each must come back byte-identical after the
// setting has been changed and returned to plain.
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
const png = "PNG image · 2000 × 1520",
  shown = "Lines (SVG) · visible only, sampled";
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

// Line drawings recorded from main at 0e7ad8f, before seeing through.
const recorded: Record<string, string> = {
  "The focal sheets of an ellipsoid":
    "f7ef384c68a1ce46ed25942bb4691645c19a75b7024791881f10d3a785c3779f",
  "A tube around the trefoil":
    "90d24495b3d7c85e94e564c1b1ac4aa7a1d741787be9f49bce99557c0f125ea5",
  "A gyroid, cut open":
    "4c1a8b9fc31085e41e181039519499b93cb5c3fd42133356dc7e642715fff02f",
  "A lamp sealed in an ellipsoid":
    "8654adbeaf6abe349c7524cb54b11e86e23f8df6ec13b7537a8913525516fc99",
};

test("studies drawn opaque with hidden lines hidden are unchanged", async ({
  page,
}) => {
  await ready(page);
  const box = page.getByRole("group", { name: "See through" });
  const sheets = box.getByLabel("Sheets", { exact: true }),
    behind = box.getByLabel("Lines behind sheets", { exact: true });
  const seen: Record<string, string> = {};
  for (const label of Object.keys(recorded)) {
    await choosePreset(page, { label });
    await settled(page);
    seen[label] = sha(await download(page, shown));
    const plain = await download(page, png);
    await sheets.selectOption("through");
    await behind.selectOption("dashed");
    expect((await download(page, png)).equals(plain), label).toBe(false);
    await sheets.selectOption("opaque");
    await behind.selectOption("hide");
    expect((await download(page, png)).equals(plain), label).toBe(true);
  }
  expect(seen).toEqual(recorded);
});

// The setting itself: what it shows and what it refuses. Opacity is read
// only when sheets are seen through, and an invalid one leaves them opaque.
const through = (opacity: number): Sight => ({
  ...defaultSight,
  sheets: "through",
  opacity,
});
test("the default sees nothing through; an invalid opacity is named and leaves sheets opaque", () => {
  expect(defaultSight).toEqual({
    sheets: "opaque",
    opacity: 0.35,
    hidden: "hide",
  });
  expect(isPlain(defaultSight)).toBe(true);
  expect(isPlain({ ...defaultSight, hidden: "faint" })).toBe(false);
  expect(isPlain(through(0.35))).toBe(false);
  expect(sightSpec(defaultSight)).toEqual({ spec: defaultSight });
  for (const opacity of [0.05, 0.35, 0.8])
    expect(sightSpec(through(opacity))).toEqual({ spec: through(opacity) });
  for (const opacity of [NaN, Infinity, 0, 0.049, 0.801, -0.3, 1]) {
    const { spec, error } = sightSpec({
      ...through(opacity),
      hidden: "dashed",
    });
    expect(error?.field).toBe("Sheet opacity α");
    expect(error?.message).toMatch(/0\.05.*0\.8|finite/);
    // The lines keep their setting; the sheets stay opaque.
    expect(spec).toEqual({ sheets: "opaque", opacity, hidden: "dashed" });
  }
  // Opaque sheets never read the opacity.
  expect(sightSpec({ ...defaultSight, opacity: NaN })).toEqual({
    spec: { ...defaultSight, opacity: NaN },
  });
});

test("arc length runs along each polyline in space and restarts where it breaks", () => {
  const pairs = (points: [Vec3, Vec3][]) =>
    new Float32Array(
      points.flatMap(([a, b]) =>
        [a, b].flatMap((p) => [p.x, p.y, p.z, 0, 0, 1, 0]),
      ),
    );
  const p = (x: number, y: number, z: number) => ({ x, y, z });
  const arcs = arcLengths(
    pairs([
      [p(0, 0, 0), p(1, 0, 0)],
      [p(1, 0, 0), p(1, 2, 0)],
      [p(1, 2, 0), p(1, 2, 2)],
      // A gap: this one starts somewhere else.
      [p(5, 5, 5), p(5, 5, 6)],
      // Joined only nearly: a new polyline.
      [p(5, 5, 6.001), p(8, 9, 6.001)],
    ]),
  );
  expect(Array.from(arcs)).toEqual([0, 1, 1, 3, 3, 5, 0, 1, 0, 5]);
  expect(arcLengths(new Float32Array())).toHaveLength(0);
});

// Linework, as in the cut's tests: the square x, y ∈ [−0.5, 0.5] at z = 0
// faces the view, which looks down −z with 760/1.16 px per unit, so page
// x = 1000 + x·unit. The base runs along y = 0.1 behind it (z < 0), from
// x = −1 to 1 through x = 0.
const unit = 760 / 1.16;
const px = (x: number) => 1000 + x * unit;
const at = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
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
function squareStudy(base: Vec3[]): SpatialResult {
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
    base,
    breaks: base.map(() => false),
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
const behind = [at(-1, 0.1, -0.2), at(0, 0.1, -0.2), at(1, 0.1, -0.2)];
function drawn(
  result: SpatialResult,
  occlusion: "none" | "sampled",
  hidden?: HiddenLines,
  view = front,
) {
  return linework(buildScene(result), view, defaultLayers, false, {
    ...page,
    occlusion,
    ...(hidden && { hidden }),
  });
}
const shownGroups = (groups: LineGroup[]) => groups.filter((g) => !g.hidden);
const hiddenPaths = (groups: LineGroup[], layer: string) =>
  groups
    .find((g) => g.layer === layer && g.hidden)
    ?.strokes.flatMap((s) => s.paths) ?? [];

test("faint hidden lines are exactly the parts the sampled test leaves out", () => {
  const plain = drawn(squareStudy(behind), "sampled");
  expect(drawn(squareStudy(behind), "sampled", "hide")).toEqual(plain);
  const faint = drawn(squareStudy(behind), "sampled", "faint");
  // The visible parts are unchanged, and the hidden ones come first.
  expect(shownGroups(faint)).toEqual(plain);
  expect(faint[0]).toMatchObject({ layer: "base", hidden: "faint" });
  // Hidden across the square, x ∈ [−0.5, 0.5], as one path through x = 0.
  const [only, ...rest] = hiddenPaths(faint, "base");
  expect(rest).toHaveLength(0);
  expect(Math.abs(only[0][0] - px(-0.5))).toBeLessThan(1);
  expect(Math.abs(only.at(-1)![0] - px(0.5))).toBeLessThan(1);
  // Each end meets a visible part: together they are the whole line.
  const visible = plain[0].strokes[0].paths;
  expect(visible[0].at(-1)![0]).toBeCloseTo(only[0][0], 9);
  expect(visible[1][0][0]).toBeCloseTo(only.at(-1)![0], 9);
  // Every line is drawn without hiding, whatever the setting.
  const every = drawn(squareStudy(behind), "none");
  for (const hidden of ["faint", "dashed"] as const)
    expect(drawn(squareStudy(behind), "none", hidden)).toEqual(every);
  // In front of the square, nothing is hidden.
  const before = behind.map((p) => ({ ...p, z: 0.2 }));
  expect(drawn(squareStudy(before), "sampled", "faint")).toEqual(
    drawn(squareStudy(before), "sampled"),
  );
  // The file draws them beneath the rest, at 35% opacity.
  const svg = linesSvg(faint, {
    ...page,
    dark: false,
    title: "t",
    metadata: {},
  });
  expect(svg).toMatch(
    /<rect[^>]*\/><g id="hidden-base"[^>]* stroke-opacity="0\.35"[^>]*>.*<\/g><g id="base"/,
  );
  expect(svg.match(/<g id="base"[^>]*>/)![0]).not.toMatch(/opacity/);
});

test("dashed hidden lines are dashes measured along the line in space, one per 1% of the page's shorter side", () => {
  // A period is 15.2 px on a 2000 × 1520 page, the dash its first 55%,
  // counted from where the base starts, at s = x + 1.
  for (const zoom of [1, 2]) {
    const view = { ...front, zoom };
    const scale = unit * zoom,
      period = 15.2 / scale,
      on = 0.55 * period;
    const s = (pageX: number) => (pageX - 1000) / scale + 1;
    const dashes = hiddenPaths(
      drawn(squareStudy(behind), "sampled", "dashed", view),
      "base",
    );
    // Hidden over s ∈ [0.5, 1.5]: every dash lies within the "on" part of
    // one period, and the dash crossing x = 0, where two samples meet,
    // stays one path.
    expect(dashes.length).toBeGreaterThan(Math.floor(1 / period) - 2);
    for (const dash of dashes) {
      expect(dash.every(([, y]) => y === dash[0][1])).toBe(true);
      const a = s(dash[0][0]),
        b = s(dash.at(-1)![0]);
      expect(a).toBeGreaterThan(0.5 - 1 / scale);
      expect(b).toBeLessThan(1.5 + 1 / scale);
      const k = Math.floor(a / period + 1e-9);
      expect(a).toBeGreaterThanOrEqual(k * period - 1e-9);
      expect(b).toBeLessThanOrEqual(k * period + on + 1e-9);
      // Whole dashes, away from where the hidden part begins and ends,
      // span 8.36 px on the page whatever the zoom.
      if (a > 0.5 + 1 / scale && b < 1.5 - 1 / scale)
        expect((b - a) * scale).toBeCloseTo(8.36, 6);
    }
  }
  // Receding in depth, a line's dashes are measured in space, so they are
  // shorter on the page by the cosine of its tilt.
  const tilted = [at(-1, 0.1, -0.2), at(1, 0.1, -0.9)];
  const cos = 2 / Math.hypot(2, 0.7);
  const dashes = hiddenPaths(
    drawn(squareStudy(tilted), "sampled", "dashed"),
    "base",
  );
  const lengths = dashes
    .map((d) => d.at(-1)![0] - d[0][0])
    .sort((a, b) => b - a);
  expect(lengths[1]).toBeCloseTo(8.36 * cos, 6);
  const svg = linesSvg(drawn(squareStudy(behind), "sampled", "dashed"), {
    ...page,
    dark: false,
    title: "t",
    metadata: {},
  });
  expect(svg).toMatch(/<g id="hidden-base"[^>]* stroke-opacity="0\.8"/);
});

test("an export records seeing through only when it is on, and states its rule", () => {
  expect(sightRecord(defaultSight, true)).toBeUndefined();
  const xray = sightRecord(through(0.35), true)!;
  expect(xray).toMatchObject({
    sheets: "through",
    opacity: 0.35,
    hidden: "hide",
  });
  expect(xray.statement).toMatch(/mean/);
  expect(xray.statement).toMatch(/1 − \(1 − α\)ⁿ/);
  expect(xray.statement).toMatch(/order/);
  const lost = sightRecord(through(0.35), false)!;
  expect(lost.sheets).toBe("opaque");
  expect(lost.statement).toMatch(/could not.*opaque/);
  const faint = sightRecord({ ...defaultSight, hidden: "faint" }, true)!;
  expect(faint).toEqual({
    sheets: "opaque",
    hidden: "faint",
    statement: expect.stringMatching(/35%/),
  });
  expect(
    sightRecord({ ...defaultSight, hidden: "dashed" }, true)!.statement,
  ).toMatch(/1% of the shorter side/);
});

// Through the real app, from links with exact cameras.
const linkTo = (study: unknown) =>
  `/?study=3d#s=${deflateRawSync(
    Buffer.from(JSON.stringify({ v: 1, notebook: "3d", study })),
  ).toString("base64url")}`;
async function openLink(page: Page, study: unknown) {
  await page.goto(linkTo(study));
  await settled(page);
  await expect(page.locator("#spatial-artwork")).toBeVisible();
}
const onlyLayers = (...on: string[]) =>
  Object.fromEntries(
    Object.keys(defaultLayers).map((k) => [k, on.includes(k)]),
  );
const R = 1.2;

function sphereStudy(sight?: Partial<Sight>, cut?: Partial<Cut>) {
  const preset = spatialPresets.find(
    (p) => p.name === "A sphere collapsing to one focus",
  )!;
  const config = structuredClone(preset.config);
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
  return {
    config,
    layers: onlyLayers("surface"),
    view: { yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 },
    animation: { mode: "reveal", camera: "hold", duration: 10, tracks: [] },
    ...(sight && { sight: { ...defaultSight, ...sight } }),
    ...(cut && { cut: { ...defaultCut, enabled: true, ...cut } }),
  };
}
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
        return points.map(([x, y]) => [
          ...ctx.getImageData(x, y, 1, 1).data.slice(0, 3),
        ]);
      },
      [Array.from(png), points] as const,
    );
  } finally {
    await other.close();
  }
}
const rgb = (c: readonly number[]) => c.map((v) => Math.round(255 * v));

test("see-through sheets lay the mean of every layer over the background by 1 − (1 − α)ⁿ, whatever their order", async ({
  page,
}) => {
  const alpha = 0.4;
  // The sphere seen from +z has two layers inside its outline: the near
  // half and the far one. Each is drawn alone, opaque, by cutting the
  // other away, so the expected colors come from the drawing's own
  // shading, not a copy of it.
  await openLink(page, sphereStudy());
  const view = JSON.parse(
    (await page.locator("#spatial-artwork").getAttribute("data-view"))!,
  );
  const scale = (760 * view.zoom) / (1.16 * view.radius);
  // Away from the poles at the page's center, where the chart's triangles
  // converge and the opaque drawing's multisampling blends many of them.
  const points: [number, number][] = [
    [Math.round(1000 + 0.3 * scale), Math.round(760 - 0.4 * scale)],
    [Math.round(1000 + 0.6 * scale), 760],
    [1000, Math.round(760 - 0.8 * scale)],
    [Math.round(1000 - 0.5 * scale), Math.round(760 + 0.5 * scale)],
    [5, 5],
  ];
  const near = await decode(page, await download(page, png), points);
  await openLink(
    page,
    sphereStudy(undefined, { normal: at(0, 0, 1), offset: 0, edge: false }),
  );
  const far = await decode(page, await download(page, png), points);
  await openLink(page, sphereStudy({ sheets: "through", opacity: alpha }));
  await expect(page.locator("#spatial-artwork")).toHaveAttribute(
    "data-sight",
    JSON.stringify({ sheets: "through", opacity: alpha, hidden: "hide" }),
  );
  const both = await decode(page, await download(page, png), points);
  await openLink(
    page,
    sphereStudy(
      { sheets: "through", opacity: alpha },
      { normal: at(0, 0, 1), offset: 0, edge: false },
    ),
  );
  const one = await decode(page, await download(page, png), points);
  const background = rgb(palette.background[0]);
  expect(near[4]).toEqual(background);
  expect(both[4]).toEqual(background);
  for (let i = 0; i < 4; i++) {
    // The two halves differ, so the mean is a real test.
    expect(
      Math.max(...near[i].map((v, c) => Math.abs(v - far[i][c]))),
    ).toBeGreaterThan(8);
    const two = 1 - (1 - alpha) ** 2;
    for (let c = 0; c < 3; c++) {
      const b = background[c];
      expect(
        Math.abs(
          both[i][c] - (b * (1 - two) + ((near[i][c] + far[i][c]) / 2) * two),
        ),
      ).toBeLessThan(2);
      expect(
        Math.abs(one[i][c] - (b * (1 - alpha) + far[i][c] * alpha)),
      ).toBeLessThan(2);
    }
  }
  // The embedded-image SVG records it; the opaque one records nothing.
  const svg = (await download(page, "SVG · embedded 3D image")).toString();
  expect(svg).toMatch(/&quot;sight&quot;|"sight"/);
  await openLink(page, sphereStudy());
  expect(
    (await download(page, "SVG · embedded 3D image")).toString(),
  ).not.toMatch(/sight/);
});

// The trefoil's tube hides the knot inside it (about 1500 pixels fully in
// the knot's ink at this camera). Its pixels with and without
// the tube give, at each pixel, the tube's color A and whether the knot
// covers it fully in its ink L; lines behind sheets must then be A
// unchanged, (1 − o)·A + o·L, or for dashes either.
const tubePreset = spatialPresets.find(
  (p) => p.name === "A tube around the trefoil",
)!;
const tube = (layers: Record<string, boolean>, sight?: Partial<Sight>) => ({
  config: structuredClone(tubePreset.config),
  layers,
  view: { yaw: 0.3, pitch: 0.75, zoom: 1, panX: 0, panY: 0 },
  animation: { mode: "reveal", camera: "hold", duration: 10, tracks: [] },
  ...(sight && { sight: { ...defaultSight, ...sight } }),
});
async function compare(
  page: Page,
  images: Record<string, Buffer>,
  ink: number[],
) {
  const other = await page.context().newPage();
  try {
    return await other.evaluate(
      async ([images, L]) => {
        const read = async (bytes: number[]) => {
          const bitmap = await createImageBitmap(
            new Blob([new Uint8Array(bytes)], { type: "image/png" }),
          );
          const canvas = document.createElement("canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
          ctx.drawImage(bitmap, 0, 0);
          return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
        };
        const [A, C, F, D, B, T, TF] = await Promise.all(
          [
            "opaque",
            "knot",
            "faint",
            "dashed",
            "background",
            "through",
            "throughFaint",
          ].map((k) => read(images[k])),
        );
        const near = (
          p: ArrayLike<number>,
          i: number,
          q: number[],
          tol: number,
        ) =>
          Math.abs(p[i] - q[0]) <= tol &&
          Math.abs(p[i + 1] - q[1]) <= tol &&
          Math.abs(p[i + 2] - q[2]) <= tol;
        const at = (p: ArrayLike<number>, i: number) => [
          p[i],
          p[i + 1],
          p[i + 2],
        ];
        const mix = (a: number[], o: number) =>
          a.map((v, c) => (1 - o) * v + o * L[c]);
        const out = {
          hidden: 0,
          faint: 0,
          dash: 0,
          gap: 0,
          odd: 0,
          visible: 0,
          kept: 0,
          plain: 0,
          same: 0,
          seen: 0,
          shows: 0,
        };
        for (let i = 0; i < A.length; i += 4) {
          const a = at(A, i);
          const knot = near(C, i, L, 2);
          if (knot && !near(A, i, L, 40)) {
            out.hidden++;
            if (near(F, i, mix(a, 0.35), 3)) out.faint++;
            if (near(D, i, mix(a, 0.8), 3)) out.dash++;
            else if (near(D, i, a, 1)) out.gap++;
            else out.odd++;
            // Seen through, the knot is still behind the nearest sheet.
            if (near(TF, i, mix(at(T, i), 0.35), 3)) out.seen++;
            if (near(T, i, L, 20)) out.shows++;
          } else if (knot && near(A, i, L, 2)) {
            out.visible++;
            if (near(F, i, a, 2) && near(D, i, a, 2)) out.kept++;
          } else if (near(C, i, at(B, i), 0)) {
            out.plain++;
            if (near(F, i, a, 1) && near(D, i, a, 1)) out.same++;
          }
        }
        return out;
      },
      [
        Object.fromEntries(
          Object.entries(images).map(([k, v]) => [k, Array.from(v)]),
        ),
        ink,
      ] as const,
    );
  } finally {
    await other.close();
  }
}

test("lines behind sheets are drawn faint or dashed over the sheet in front, and nothing else changes", async ({
  page,
}) => {
  const images: Record<string, Buffer> = {};
  for (const [name, study] of [
    ["opaque", tube(onlyLayers("surface"))],
    ["knot", tube(onlyLayers())],
    ["faint", tube(onlyLayers("surface"), { hidden: "faint" })],
    ["dashed", tube(onlyLayers("surface"), { hidden: "dashed" })],
    ["through", tube(onlyLayers("surface"), { sheets: "through" })],
    [
      "throughFaint",
      tube(onlyLayers("surface"), { sheets: "through", hidden: "faint" }),
    ],
  ] as const) {
    await openLink(page, study);
    images[name] = await download(page, png);
  }
  // A blank page of the background, for comparison.
  const blank = structuredClone(tube(onlyLayers()));
  blank.view.panX = 1000;
  await openLink(page, blank);
  images.background = await download(page, png);
  const L = rgb(lineColor(2, 0, false));
  const seen = await compare(page, images, L);
  // The knot is mostly inside the tube.
  expect(seen.hidden).toBeGreaterThan(1000);
  expect(seen.faint / seen.hidden).toBeGreaterThan(0.97);
  expect(seen.odd / seen.hidden).toBeLessThan(0.03);
  expect(seen.seen / seen.hidden).toBeGreaterThan(0.97);
  expect(seen.shows).toBe(0);
  // Dashes take 55% of each period along the knot in space; the tilt of
  // the view shortens them unevenly on the page (54% measured), while the
  // gaps alone would be 45%.
  expect(seen.dash / seen.hidden).toBeGreaterThan(0.5);
  expect(seen.dash / seen.hidden).toBeLessThan(0.6);
  expect(seen.kept).toBe(seen.visible);
  expect(seen.plain).toBeGreaterThan(2_000_000);
  expect(seen.same / seen.plain).toBeGreaterThan(0.999);
});

const sightBox = (page: Page) =>
  page.getByRole("group", { name: "See through" });
const drawnSight = async (page: Page) => {
  const v = await page.locator("#spatial-artwork").getAttribute("data-sight");
  return v === null ? null : JSON.parse(v);
};

test("the panel sets how sheets and lines behind them are drawn, names an invalid opacity, and resets with a preset", async ({
  page,
}) => {
  await ready(page);
  const box = sightBox(page);
  const sheets = box.getByLabel("Sheets", { exact: true }),
    behind = box.getByLabel("Lines behind sheets", { exact: true });
  await expect(sheets).toHaveValue("opaque");
  await expect(behind).toHaveValue("hide");
  await expect(box.getByLabel("Opacity α")).toHaveCount(0);
  expect(await drawnSight(page)).toBeNull();
  await behind.selectOption("dashed");
  await expect
    .poll(() => drawnSight(page))
    .toEqual({ sheets: "opaque", opacity: 0.35, hidden: "dashed" });
  await sheets.selectOption("through");
  const opacity = box.getByLabel("Opacity α", { exact: true });
  await expect(opacity).toHaveValue("0.35");
  await expect
    .poll(() => drawnSight(page))
    .toEqual({ sheets: "through", opacity: 0.35, hidden: "dashed" });
  await expect(page.locator(".spatial-stage")).toHaveAttribute(
    "data-sight",
    JSON.stringify({ sheets: "through", opacity: 0.35, hidden: "dashed" }),
  );
  // Constant expressions, like every scalar field.
  await opacity.fill("1/phi^2");
  await expect
    .poll(async () => (await drawnSight(page))?.opacity)
    .toBeCloseTo(1 / ((1 + Math.sqrt(5)) / 2) ** 2, 12);
  // Out of range: named, and the sheets are drawn opaque meanwhile.
  await opacity.fill("0.9");
  await expect(box.getByRole("alert")).toHaveText(
    "Sheet opacity α: must be from 0.05 to 0.8.",
  );
  await expect
    .poll(async () => (await drawnSight(page))?.sheets)
    .toBe("opaque");
  await opacity.fill("0.6");
  await expect(box.getByRole("alert")).toHaveCount(0);
  await expect
    .poll(() => drawnSight(page))
    .toEqual({ sheets: "through", opacity: 0.6, hidden: "dashed" });
  // Layers do not disturb it.
  await page.getByRole("checkbox", { name: "Tangent rulings" }).uncheck();
  expect((await drawnSight(page)).hidden).toBe("dashed");
  // A preset brings its own, here the plain drawing.
  await choosePreset(page, { label: "Cinquefoil · (2, 5)" });
  await settled(page);
  await expect(sheets).toHaveValue("opaque");
  await expect(behind).toHaveValue("hide");
  expect(await drawnSight(page)).toBeNull();
  await expect(page.locator(".spatial-stage")).not.toHaveAttribute(
    "data-sight",
    /./,
  );
});

test("without half-float targets, see-through sheets are drawn opaque and say so, and the lines' setting still applies", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const get = WebGLRenderingContext.prototype.getExtension;
    WebGLRenderingContext.prototype.getExtension = function (name: string) {
      return /half_float|texture_float|color_buffer_float/i.test(name)
        ? null
        : get.call(this, name);
    } as typeof get;
  });
  await openLink(page, sphereStudy());
  const opaque = await download(page, png);
  await openLink(page, sphereStudy({ sheets: "through", opacity: 0.4 }));
  const box = sightBox(page);
  await expect(box.getByText(/cannot draw see-through sheets/)).toBeVisible();
  expect((await download(page, png)).equals(opaque)).toBe(true);
  const svg = (await download(page, "SVG · embedded 3D image")).toString();
  expect(svg).toMatch(/could not draw them/);
  // Back to opaque, the note goes.
  await box.getByLabel("Sheets", { exact: true }).selectOption("opaque");
  await expect(box.getByText(/cannot draw see-through sheets/)).toHaveCount(0);
});

test("the visible-lines export draws lines behind sheets as the drawing does, and records how", async ({
  page,
}) => {
  await openLink(
    page,
    tube(onlyLayers("surface", "meridians"), { hidden: "dashed" }),
  );
  const svg = (await download(page, shown)).toString();
  expect(svg).toMatch(/<g id="hidden-base"[^>]*stroke-opacity="0.8"/);
  expect(svg).toMatch(/<g id="hidden-meridians"/);
  expect(svg).toMatch(/dashed at 80% opacity/);
  // Every line is drawn whole, and says nothing of hidden lines.
  const every = (await download(page, "Lines (SVG) · every line")).toString();
  expect(every).not.toMatch(/hidden-/);
});

test("the Klein bottle opens seen through, its sections inside its wall dashed", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, { label: "A Klein bottle passing through itself" });
  await settled(page);
  const box = sightBox(page);
  await expect(box.getByLabel("Sheets", { exact: true })).toHaveValue(
    "through",
  );
  await expect(
    box.getByLabel("Lines behind sheets", { exact: true }),
  ).toHaveValue("dashed");
  await expect
    .poll(() => drawnSight(page))
    .toEqual({
      sheets: "through",
      opacity: 0.3,
      hidden: "dashed",
    });
  // The usual immersion (Stewart, via MathWorld), with x and y exchanged
  // so the default camera looks into the neck: the neck re-enters the body,
  // so section planes across it meet the surface in nested curves, the
  // inner ones behind the wall.
  const svg = (await download(page, shown)).toString();
  const dashes =
    svg.match(/<g id="hidden-sections"[^>]*>(.*?)<\/g>/s)?.[1] ?? "";
  expect(dashes.match(/M/g)?.length ?? 0).toBeGreaterThan(100);
  expect(svg).toMatch(/<g id="sections"/);
});
