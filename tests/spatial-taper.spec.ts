import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import { choosePreset } from "./helpers";
import {
  defaultSight,
  sheetOffset,
  sightHelp,
  strokeDepths,
  strokeRecord,
  strokeTaper,
  strokeWidth,
  taperBound,
  taperRange,
  taperStep,
  type Sight,
} from "../web/spatial/sight";
import { buildScene, camera, clip, type View } from "../web/spatial/scene";
import { linework, type LineGroup } from "../web/spatial/linework";
import { defaultLayers } from "../web/spatial/renderer";
import { spatialPresets } from "../web/spatial/presets";
import { lineColor, palette } from "../web/spatial/palette";
import type { SpatialResult, Vec3 } from "../web/spatial/types";
import { curveMesh } from "./curve-mesh";

// Strokes that taper with depth: through a perspective lens a stroke is its
// weight's width where it crosses the plane through the view's target, and
// wider or thinner in proportion to how much nearer or farther from the eye
// it is, as a line of fixed thickness in space would look. Orthographic
// views, and the even setting, draw every stroke at its weight's width.
const size = { width: 2000, height: 1520 };
const O = { x: 0, y: 0, z: 0 };
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
// The turntable's target distance behind a lens of this angle, from the
// projection's definition (scene.ts): the plane through the target is
// drawn at the orthographic scale.
const targetDistance = (v: View, fov: number) =>
  (1.16 * v.radius) / (v.zoom * Math.tan((fov * Math.PI) / 360));

test("a stroke's taper is the target's distance over the point's, within its range", () => {
  expect(strokeDepths.map((d) => d.value)).toEqual(["even", "taper"]);
  expect(defaultSight.depth).toBeUndefined();
  expect(taperRange).toEqual([0.25, 4]);
  // Yaw and pitch 0 look down −z from an eye at z = d.
  for (const v of [view(), view({ zoom: 2.5, radius: 3 })]) {
    const lensed = { ...v, projection: "normal" as const };
    const k = camera(lensed, size),
      d = targetDistance(v, 50);
    // A point at distance D ahead of the eye, off the axis.
    const at = (D: number) => clip(k, 0.3 * v.radius, -0.2, d - D)[3];
    for (const D of [d, 0.5 * d, 2 * d, 0.3 * d, 3.7 * d])
      expect(strokeTaper(k, at(D), "taper")).toBeCloseTo(d / D, 9);
    // Nearer than a quarter of the target's distance, or farther than four
    // times it, the width stops changing.
    expect(strokeTaper(k, at(d / 10), "taper")).toBe(4);
    expect(strokeTaper(k, at(10 * d), "taper")).toBe(0.25);
    // Even strokes, and links made before tapering, keep their width.
    for (const D of [d / 10, 0.5 * d, 3 * d]) {
      expect(strokeTaper(k, at(D), "even")).toBe(1);
      expect(strokeTaper(k, at(D), undefined)).toBe(1);
    }
    // An orthographic view has every point at the same scale.
    const flat = camera(v, size);
    for (const z of [-3, 0, 0.9])
      expect(strokeTaper(flat, clip(flat, 0, 0, z)[3], "taper")).toBe(1);
  }
});

test("sheets are pushed back by the widest tapered stroke the study's bounds allow", () => {
  const v = view({ projection: "normal" }),
    k = camera(v, size),
    d = targetDistance(v, 50);
  // The bounds' nearest point is a radius nearer than its center, which is
  // at the target's distance: d/(d − 1).
  expect(taperBound(k, v, "taper")).toBeCloseTo(d / (d - 1), 9);
  expect(taperBound(k, v, "even")).toBe(1);
  expect(taperBound(camera(view(), size), view(), "taper")).toBe(1);
  // Bounds reaching past a quarter of d, or behind the eye, allow the most.
  expect(taperBound(k, { center: O, radius: 0.8 * d }, "taper")).toBe(4);
  expect(taperBound(k, { center: O, radius: 2 * d }, "taper")).toBe(4);
  const lines = [{ ink: 2 }, { ink: 1 }];
  expect(sheetOffset(lines, "regular", size, 3)).toBeCloseTo(
    1 + (3 * strokeWidth({ ink: 2 }, "regular", size)!) / 2,
    12,
  );
  expect(sheetOffset(lines, "regular", size)).toBe(
    sheetOffset(lines, "regular", size, 1),
  );
  expect(sheetOffset(lines, "hairline", size, 3)).toBe(1);
});

// A line from near the eye to far behind the target, a tenth of a unit to
// the side of the view's axis, through the wide lens (90°): the eye is
// d = 1.16 behind the target, near enough that the far plane, four radii
// past the center, lies beyond four times d. The line's page distance from
// the middle is proportional to 1/D, so at the target's distance it is a
// tenth of the orthographic scale's unit (760 / 1.16 px) and anywhere else
// that times d/D, the taper itself.
const unit = 760 / 1.16,
  side = 0.1;
function receding(n = 200): SpatialResult {
  const base: Vec3[] = [];
  for (let i = 0; i <= n; i++)
    base.push({ x: side, y: 0, z: 1.01 - (4.95 * i) / n });
  return {
    base,
    breaks: base.map(() => false),
    minus: [],
    plus: [],
    mesh: curveMesh(),
    rulings: [],
    bounds: { center: O, radius: 1 },
    radius: 1,
    omitted: 0,
    invalid: 0,
  };
}
const lines = (v: View, sight: Partial<Sight>, occlusion = "none" as const) =>
  linework(buildScene(receding()), v, defaultLayers, false, {
    ...size,
    occlusion,
    weight: sight.weight ?? "regular",
    depth: sight.depth,
  });
const baseStrokes = (groups: LineGroup[]) =>
  groups.find((g) => g.layer === "base" && !g.hidden)!.strokes;

test("the line drawing tapers each stroke as the drawing does, in steps no coarser than its taper step", () => {
  const lensed = view({ projection: "wide" });
  const nominal = strokeWidth({ ink: 2 }, "regular", size)!;
  // Even strokes: one width throughout, as before.
  const even = baseStrokes(lines(lensed, { depth: "even" }));
  expect(even.map((s) => s.width)).toEqual([nominal]);
  expect(lines(lensed, {})).toEqual(lines(lensed, { depth: "even" }));
  // Orthographic views draw tapered strokes exactly as even ones.
  expect(lines(view(), { depth: "taper" })).toEqual(
    lines(view(), { depth: "even" }),
  );
  // Hairlines do not taper.
  expect(lines(lensed, { weight: "hairline", depth: "taper" })).toEqual(
    lines(lensed, { weight: "hairline" }),
  );
  const tapered = baseStrokes(lines(lensed, { depth: "taper" }));
  expect(tapered.length).toBeGreaterThan(10);
  let points = 0,
    widest = 0,
    thinnest = Infinity;
  for (const s of tapered) {
    widest = Math.max(widest, s.width!);
    thinnest = Math.min(thinnest, s.width!);
    for (const path of s.paths)
      for (const [x] of path) {
        // The taper at this point, from where it is on the page.
        const want =
          nominal *
          Math.min(
            taperRange[1],
            Math.max(taperRange[0], (x - size.width / 2) / (side * unit)),
          );
        expect(
          Math.abs(Math.log(s.width! / want)),
          `${s.width} px at x = ${x} for ${want}`,
        ).toBeLessThanOrEqual(Math.log(taperStep) / 2 + 2e-3);
        points++;
      }
  }
  expect(points).toBeGreaterThan(200);
  // Every step is a power of the taper step, or an end of the range.
  for (const s of tapered) {
    const f = s.width! / nominal,
      k = Math.log(f) / Math.log(taperStep);
    if (f !== taperRange[0] && f !== taperRange[1])
      expect(Math.abs(k - Math.round(k)), `${f}`).toBeLessThan(1e-3);
  }
  // The line passes from beyond four times the target's distance to within
  // its quarter, so it spans the whole range.
  expect(widest / nominal).toBeCloseTo(taperRange[1], 2);
  expect(thinnest / nominal).toBeCloseTo(taperRange[0], 2);
  // The steps join end to end: each path starts where another ends, except
  // the line's own ends.
  const ends = tapered.flatMap((s) => s.paths.map((p) => p.at(-1)!.join()));
  const starts = tapered.flatMap((s) => s.paths.map((p) => p[0].join()));
  expect(starts.filter((p) => !ends.includes(p))).toHaveLength(1);
  // The sampled visible-only drawing tapers the same, with nothing to hide.
  expect(lines(lensed, { depth: "taper" }, "sampled" as "none")).toEqual(
    lines(lensed, { depth: "taper" }),
  );
});

test("exports record a taper only when strokes taper", () => {
  expect(strokeRecord(defaultSight)).not.toHaveProperty("depth");
  expect(strokeRecord({ ...defaultSight, depth: "even" })).toEqual(
    strokeRecord(defaultSight),
  );
  expect(strokeRecord({ ...defaultSight, depth: "taper" })).toMatchObject({
    weight: "regular",
    depth: "taper",
    statement: expect.stringMatching(/distance/),
  });
  expect(
    strokeRecord({ ...defaultSight, weight: "hairline", depth: "taper" }),
  ).toBeUndefined();
});

// A circle of radius 2 in the xy-plane, turned by yaw ψ through a lens: the
// page's middle row crosses it at (±2, 0, 0), where its tangent is vertical,
// at distances d ∓ 2 sin ψ from the eye.
const stage = (page: Page) => page.locator(".spatial-stage");
const settled = (page: Page) =>
  expect(stage(page)).toHaveAttribute("aria-busy", "false");
const linesBox = (page: Page) => page.getByRole("group", { name: "Lines" });
const yaw = 0.6;
const circle = (sight: Partial<Sight>) => ({
  config: {
    ...structuredClone(spatialPresets[0].config),
    format: "parametric",
    curve: {
      x: "2*cos(t)",
      y: "2*sin(t)",
      z: "0",
      a: 1,
      // The curve's ends meet at (0, −2), away from the middle row.
      min: -Math.PI / 2,
      max: (3 * Math.PI) / 2,
    },
  },
  layers: Object.fromEntries(Object.keys(defaultLayers).map((k) => [k, false])),
  view: { yaw, pitch: 0, zoom: 1, panX: 0, panY: 0 },
  animation: { mode: "reveal", camera: "hold", duration: 10, tracks: [] },
  sight: { ...defaultSight, ...sight },
  projection: "normal",
});
const linkTo = (study: unknown) =>
  `/?study=3d#s=${deflateRawSync(
    Buffer.from(JSON.stringify({ v: 1, notebook: "3d", study })),
  ).toString("base64url")}`;
async function download(page: Page, item: string | RegExp) {
  await page.getByRole("button", { name: "Export image", exact: true }).click();
  const event = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: item, exact: typeof item === "string" })
    .click();
  return readFile((await (await event).path())!);
}
async function pngRow(page: Page, bytes: Buffer) {
  return page.evaluate(async (bytes) => {
    const bitmap = await createImageBitmap(
      new Blob([new Uint8Array(bytes)], { type: "image/png" }),
    );
    const c = document.createElement("canvas");
    c.width = bitmap.width;
    c.height = bitmap.height;
    const g = c.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(bitmap, 0, 0);
    return [...g.getImageData(0, Math.floor(c.height / 2), c.width, 1).data];
  }, Array.from(bytes));
}
async function liveRow(page: Page) {
  return page.locator("#spatial-artwork").evaluate((c: HTMLCanvasElement) => {
    const copy = document.createElement("canvas");
    copy.width = c.width;
    copy.height = c.height;
    const g = copy.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(c, 0, 0);
    const y = Math.floor(c.height / 2);
    return [...g.getImageData(0, y, c.width, 1).data];
  });
}
// The stroke's width in pixels across each half of a row: each pixel's
// share of the way from the background to the curve's color, summed.
function halves(row: number[]) {
  const ground = palette.background[0].map((v) => v * 255),
    ink = lineColor(2, 0, false).map((v) => v * 255);
  const d = [0, 1, 2].map((k) => ink[k] - ground[k]);
  const dd = d.reduce((s, v) => s + v * v, 0);
  const n = row.length / 4,
    sums = [0, 0];
  for (let x = 0; x < n; x++) {
    let dot = 0;
    for (let k = 0; k < 3; k++) dot += (row[4 * x + k] - ground[k]) * d[k];
    sums[x < n / 2 ? 0 : 1] += Math.max(0, Math.min(1, dot / dd));
  }
  return sums;
}

test("a tapered stroke is wider where it is nearer, live and in a still, by the ratio of distances", async ({
  page,
}) => {
  await page.goto(linkTo(circle({ depth: "taper" })));
  await settled(page);
  const select = linesBox(page).getByLabel("Depth", { exact: true });
  await expect(select).toHaveValue("taper");
  await expect(page.locator("#spatial-artwork")).toHaveAttribute(
    "data-strokes",
    JSON.stringify({ weight: "regular", depth: "taper" }),
  );
  const shown = JSON.parse(
    (await page.locator("#spatial-artwork").getAttribute("data-view"))!,
  ) as View;
  // The circle's own center is the view's.
  expect(
    Math.hypot(shown.center.x, shown.center.y, shown.center.z),
  ).toBeLessThan(1e-6);
  const d = targetDistance(shown, 50),
    s = 2 * Math.sin(yaw);
  // Turned by ψ, (2, 0, 0) recedes and (−2, 0, 0) approaches; the page's
  // left half holds the nearer.
  const near = d / (d - s),
    far = d / (d + s);
  const nominal = strokeWidth({ ink: 2 }, "regular", size)!;
  const [left, right] = halves(
    await pngRow(page, await download(page, /^PNG/)),
  );
  console.log("Tapered still", { left, right, near, far, nominal });
  expect(Math.abs(left / (nominal * near) - 1)).toBeLessThan(0.08);
  expect(Math.abs(right / (nominal * far) - 1)).toBeLessThan(0.08);
  // The live drawing agrees in proportion.
  const [l, r] = halves(await liveRow(page));
  expect(Math.abs(l / r / (near / far) - 1)).toBeLessThan(0.1);
  // The line drawing records the taper and draws the near side wider, in
  // steps between the two sides' widths.
  const svg = (await download(page, "Lines (SVG) · every line")).toString(
    "utf8",
  );
  const meta = JSON.parse(
    svg
      .match(/<desc>(.*?)<\/desc>/s)![1]
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&amp;", "&"),
  );
  expect(meta.strokes).toMatchObject({ weight: "regular", depth: "taper" });
  const widths = [...svg.matchAll(/<path[^>]*stroke-width="([\d.]+)"/g)].map(
    (m) => +m[1],
  );
  expect(new Set(widths).size).toBeGreaterThan(5);
  expect(Math.max(...widths) / (nominal * near)).toBeGreaterThan(0.97);
  expect(Math.min(...widths) / (nominal * far)).toBeLessThan(1.03);
  // Even strokes are one width on both sides.
  await select.selectOption("even");
  await expect(page.locator("#spatial-artwork")).toHaveAttribute(
    "data-strokes",
    JSON.stringify({ weight: "regular" }),
  );
  const [el, er] = halves(await pngRow(page, await download(page, /^PNG/)));
  expect(Math.abs(el / nominal - 1)).toBeLessThan(0.08);
  expect(Math.abs(er / nominal - 1)).toBeLessThan(0.08);
});

// A straight line receding along the view's axis from a quarter of the
// target's distance to twice it, panned to one side: on the page it runs
// along the middle row, and each column's offset from the middle is the
// pan at the orthographic scale times d/D, the taper itself. Down each
// column the stroke's coverage sums to its width: four times the weight's
// where the eye is nearer than a quarter of d, and the weight's times d/D
// elsewhere, as the GPU interpolates it along each segment.
test("a tapered stroke's width follows 1/distance along a line, held at four times its weight near the eye", async ({
  page,
}) => {
  const pan = 0.5,
    zoom = 0.95;
  const line = {
    ...circle({ depth: "taper" }),
    view: { yaw: 0, pitch: 0, zoom, panX: pan, panY: 0 },
    projection: "wide",
  };
  line.config.construction = "none";
  line.config.curve = { x: "0", y: "0", z: "t", a: 1, min: -2, max: 2 };
  await page.goto(linkTo(line));
  await settled(page);
  const shown = JSON.parse(
    (await page.locator("#spatial-artwork").getAttribute("data-view"))!,
  ) as View;
  const perUnit = (760 * zoom) / (1.16 * shown.radius);
  const nominal = strokeWidth({ ink: 2 }, "regular", size)!;
  const bytes = await download(page, /^PNG/);
  const columns = await page.evaluate(async (bytes) => {
    const bitmap = await createImageBitmap(
      new Blob([new Uint8Array(bytes)], { type: "image/png" }),
    );
    const c = document.createElement("canvas");
    c.width = bitmap.width;
    c.height = bitmap.height;
    const g = c.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(bitmap, 0, 0);
    return [...g.getImageData(0, c.height / 2 - 40, c.width, 80).data];
  }, Array.from(bytes));
  const ground = palette.background[0].map((v) => v * 255),
    ink = lineColor(2, 0, false).map((v) => v * 255);
  const d = [0, 1, 2].map((k) => ink[k] - ground[k]);
  const dd = d.reduce((s, v) => s + v * v, 0);
  const widthAt = (x: number) => {
    let sum = 0;
    for (let y = 0; y < 80; y++) {
      const i = 4 * (y * size.width + x);
      let dot = 0;
      for (let k = 0; k < 3; k++) dot += (columns[i + k] - ground[k]) * d[k];
      sum += Math.max(0, Math.min(1, dot / dd));
    }
    return sum;
  };
  // The line's ends, z = ∓2, and their tapers, less a margin for their
  // caps. The eye is d along +z from the view's center.
  const reach = targetDistance(shown, 90),
    eye = shown.center.z + reach,
    ends = [reach / (eye + 2), reach / (eye - 2)];
  expect(ends[0]).toBeLessThan(0.6);
  expect(ends[1]).toBeGreaterThan(5);
  let held = 0,
    tapered = 0;
  for (let x = size.width / 2 + 20; x < size.width - 20; x += 7) {
    // The line's direction is the view's, so the page's x carries d/D.
    const g = (x - size.width / 2) / (pan * perUnit);
    if (g < ends[0] + 0.1 || (g > 3.8 && g < 4.3) || g > ends[1] - 0.2)
      continue;
    const want = nominal * Math.min(4, g),
      got = widthAt(x);
    // Sample coverage counts quarters of a pixel, as in the strokes tests.
    expect(Math.abs(got - want), `x = ${x}: ${got} for ${want}`).toBeLessThan(
      Math.max(0.35, 0.06 * want),
    );
    if (g > 4.3) held++;
    else tapered++;
  }
  console.log("Tapered line", { held, tapered });
  expect(held).toBeGreaterThan(5);
  expect(tapered).toBeGreaterThan(20);
});

test("the depth control offers both ways, says when it cannot show, and presets bring their own", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await settled(page);
  const select = linesBox(page).getByLabel("Depth", { exact: true });
  await expect(select).toHaveValue("even");
  await expect(select.locator("option")).toHaveText(
    strokeDepths.map((d) => d.label),
  );
  // Orthographic views have nothing to taper, and say so.
  await select.selectOption("taper");
  await expect(linesBox(page).locator(".spatial-caption")).toHaveText(
    sightHelp.flat,
  );
  const tapered = spatialPresets.filter((p) => p.sight?.depth === "taper");
  expect(tapered.length).toBeGreaterThan(0);
  for (const p of tapered) {
    await choosePreset(page, { label: p.name });
    await settled(page);
    await expect(select, p.name).toHaveValue("taper");
    expect(p.projection ?? p.flight?.ride, p.name).toBeTruthy();
    await expect(linesBox(page).locator(".spatial-caption")).toHaveCount(0);
  }
  // A preset without its own sight returns to even strokes.
  await choosePreset(page, 0);
  await expect(select).toHaveValue("even");
});
