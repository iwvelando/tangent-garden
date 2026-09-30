import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { choosePreset } from "./helpers";
import {
  probeBatches,
  probeIndex,
  probeInk,
  probeReadout,
  probeSupport,
  probeHelp,
  probeStraight,
  plotScale,
} from "../web/spatial/probe";
import { buildScene, scenePasses, type Batch } from "../web/spatial/scene";
import { linework } from "../web/spatial/linework";
import { lineColor, hex } from "../web/spatial/palette";
import { defaultLayers, type View } from "../web/spatial/renderer";
import { spatialPresets } from "../web/spatial/presets";
import type {
  DiagnosticsResult,
  SpatialConfig,
  SpatialResult,
  Vec3,
} from "../web/spatial/types";

// The probe's geometry, built by hand from results whose every expected
// point follows from the definitions, not from the code under test.
const O = { x: 0, y: 0, z: 0 };
const at = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const sub = (a: Vec3, b: Vec3) => at(a.x - b.x, a.y - b.y, a.z - b.z);
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const length = (a: Vec3) => Math.sqrt(dot(a, a));
const config = (
  construction: SpatialConfig["construction"],
  format: SpatialConfig["format"] = "parametric",
): SpatialConfig => ({
  ...structuredClone(spatialPresets[0].config),
  format,
  construction,
});

// Three samples on the unit circle in the xy-plane at t = −1, 0, 1 (radians),
// with the middle one flat when asked: κ = 1, N toward the origin, B = +z.
function circle(flatMiddle = false): SpatialResult {
  const ts = [-1, 0, 1];
  const base = ts.map((t) => at(Math.cos(t), Math.sin(t), 0));
  const tangent = ts.map((t) => at(-Math.sin(t), Math.cos(t), 0));
  const normal = ts.map((t) => at(-Math.cos(t), -Math.sin(t), 0));
  const d: DiagnosticsResult = {
    min: -1,
    max: 1,
    curvature: [1, flatMiddle ? 0 : 1, 1],
    torsion: [0, flatMiddle ? null : 0, 0],
    tangent,
    normal: normal.map((n, i) => (flatMiddle && i === 1 ? null : n)),
    binormal: ts.map((_, i) => (flatMiddle && i === 1 ? null : at(0, 0, 1))),
    center: ts.map((_, i) => (flatMiddle && i === 1 ? null : O)),
    flat: flatMiddle ? 1 : 0,
    unknown: 0,
    clipped: 0,
  };
  return {
    base,
    minus: base.map((p, i) => sub(p, tangent[i])),
    plus: base.map((p, i) => at(p.x + tangent[i].x, p.y + tangent[i].y, 0)),
    breaks: [false, false, false],
    mesh: [],
    rulings: [],
    bounds: { center: O, radius: 2 },
    radius: 2,
    omitted: 0,
    invalid: 0,
    diagnostics: d,
  };
}
// Line segments of a batch as point pairs.
function segments(b: Batch): [Vec3, Vec3][] {
  const out: [Vec3, Vec3][] = [];
  for (let i = 0; i + 13 < b.data.length; i += 14)
    out.push([
      at(b.data[i], b.data[i + 1], b.data[i + 2]),
      at(b.data[i + 7], b.data[i + 8], b.data[i + 9]),
    ]);
  return out;
}
const byInk = (batches: Batch[], ink: number) =>
  batches.filter((b) => b.ink === ink).flatMap(segments);
const close = (a: Vec3, b: Vec3, tol = 1e-6) =>
  expect(length(sub(a, b))).toBeLessThan(tol);
// Float32 vertex data holds about seven digits.
const f32 = 1e-6;

test("the probe index snaps a position to the nearest sample", () => {
  expect(probeIndex(0, 480)).toBe(0);
  expect(probeIndex(1, 480)).toBe(480);
  expect(probeIndex(0.5, 480)).toBe(240);
  expect(probeIndex(0.1004, 480)).toBe(48);
  expect(probeIndex(0.999, 480)).toBe(480);
  expect(probeIndex(0.2995, 10)).toBe(3);
  expect(probeIndex(-3, 480)).toBe(0);
  expect(probeIndex(7, 480)).toBe(480);
  expect(probeIndex(Number.NaN, 480)).toBe(240);
});

test("the probe draws the Frenet frame and osculating circle at its sample", () => {
  const r = circle();
  const batches = probeBatches(r, config("none"), 1);
  expect(batches.every((b) => b.mode === "lines")).toBe(true);
  const arm = r.bounds.radius * 0.2;
  const p = at(1, 0, 0);
  // T, N and B start at the point and run their glyph length along each.
  for (const [ink, d] of [
    [probeInk.tangent, at(0, 1, 0)],
    [probeInk.normal, at(-1, 0, 0)],
    [probeInk.binormal, at(0, 0, 1)],
  ] as const) {
    const s = byInk(batches, ink);
    expect(s).toHaveLength(1);
    close(s[0][0], p, f32);
    close(s[0][1], at(p.x + d.x * arm, p.y + d.y * arm, p.z + d.z * arm), f32);
  }
  // The osculating circle: every vertex at radius 1/κ from the centre, in
  // the osculating plane (normal to B through the point), passing through
  // the point itself.
  const circleSegments = byInk(batches, probeInk.mark).filter(
    ([a, b]) => Math.abs(length(a) - 1) < f32 && Math.abs(length(b) - 1) < f32,
  );
  expect(circleSegments.length).toBeGreaterThanOrEqual(96);
  for (const [a, b] of circleSegments) {
    expect(Math.abs(a.z) + Math.abs(b.z)).toBeLessThan(f32);
  }
  expect(circleSegments.some(([a]) => length(sub(a, p)) < f32)).toBe(true);
  // Its segments are short arcs, not chords across it.
  for (const [a, b] of circleSegments)
    expect(length(sub(a, b))).toBeLessThan(((2 * Math.PI) / 128) * 1.01);
  // Its segments close into a loop: each end is the next start.
  const ends = circleSegments.map(([, b]) => b);
  for (const [a] of circleSegments)
    expect(ends.some((e) => length(sub(e, a)) < f32)).toBe(true);
});

test("a flat sample draws only its point and tangent", () => {
  const batches = probeBatches(circle(true), config("none"), 1);
  expect(byInk(batches, probeInk.normal)).toHaveLength(0);
  expect(byInk(batches, probeInk.binormal)).toHaveLength(0);
  expect(byInk(batches, probeInk.tangent)).toHaveLength(1);
  // Only the point's three-axis mark remains in the probe ink.
  const mark = byInk(batches, probeInk.mark);
  expect(mark).toHaveLength(3);
  for (const [a, b] of mark)
    close(
      at((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2),
      at(1, 0, 0),
      f32,
    );
});

test("a centre at infinity draws the frame without a circle", () => {
  const r = circle();
  r.diagnostics!.center[1] = null;
  const batches = probeBatches(r, config("none"), 1);
  expect(byInk(batches, probeInk.normal)).toHaveLength(1);
  expect(byInk(batches, probeInk.mark)).toHaveLength(3);
});

test("nothing is drawn without diagnostics or a sample", () => {
  const r = circle();
  expect(
    probeBatches({ ...r, diagnostics: undefined }, config("none"), 1),
  ).toEqual([]);
  r.base[2] = null;
  expect(probeBatches(r, config("none"), 2)).toEqual([]);
});

// The highlighted construction at the sample, in the probe ink, excluding
// the point's own three-axis mark and the osculating circle.
function highlight(r: SpatialResult, c: SpatialConfig, j: number) {
  const plain = probeBatches(r, config("none"), j);
  const count = byInk(plain, probeInk.mark).length;
  const all = byInk(probeBatches(r, c, j), probeInk.mark);
  // The construction's segments come first.
  return all.slice(0, all.length - count);
}

test("each supported construction highlights its lines at the sample", () => {
  const r = circle();
  const j = 2;
  // The tangent ruling and a framed cross-line join minus and plus there.
  for (const construction of ["developable", "framed"] as const) {
    const s = highlight(r, config(construction), j);
    expect(s).toHaveLength(1);
    close(s[0][0], r.minus[j]!, f32);
    close(s[0][1], r.plus[j]!, f32);
  }
  // A ruling joins the base to its partner (plus).
  const ruled = highlight(r, config("ruled"), j);
  expect(ruled).toHaveLength(1);
  close(ruled[0][0], r.base[j]!, f32);
  close(ruled[0][1], r.plus[j]!, f32);
  // Each involute member's unwinding string, skipping unreached members.
  const inv: SpatialResult = {
    ...r,
    involute: {
      members: [
        { offset: 0, points: [null, null, at(3, 0, 0)], collapsed: false },
        { offset: 1, points: [null, null, null], collapsed: false },
        { offset: 2, points: [null, null, at(0, 3, 0)], collapsed: false },
      ],
      strings: [],
      unreached: 0,
    },
  };
  const strings = highlight(inv, config("involute"), j);
  expect(strings).toHaveLength(2);
  close(strings[0][1], at(3, 0, 0), f32);
  close(strings[1][1], at(0, 3, 0), f32);
  for (const [a] of strings) close(a, r.base[j]!, f32);
  // A tangent projection: contact to foot, pole to foot, foot to image.
  const pole = at(0, 0, 5),
    foot = at(1, 1, 0),
    image = at(2, 2, 0);
  const projected: SpatialResult = {
    ...r,
    projection: {
      pole,
      points: [null, null, image],
      feet: [null, null, foot],
      constructions: [],
      collapsed: false,
      invalid: 0,
    },
  };
  for (const construction of ["tangent-foot", "orthotomic"] as const) {
    const s = highlight(projected, config(construction), j);
    expect(s.map(([a, b]) => [a, b])).toHaveLength(3);
    close(s[0][0], r.base[j]!, f32);
    close(s[0][1], foot, f32);
    close(s[1][0], pole, f32);
    close(s[1][1], foot, f32);
    close(s[2][0], foot, f32);
    close(s[2][1], image, f32);
  }
  // Inversion: the source point to its image.
  const inverted: SpatialResult = {
    ...r,
    inversion: {
      center: O,
      radius: 1,
      input: "base",
      source: [null, null, at(0.5, 0, 0)],
      points: [null, null, at(2, 0, 0)],
      breaks: [false, false, false],
      correspondences: [],
      collapsed: false,
      invalid: 0,
      crossings: 0,
    },
  };
  const s = highlight(inverted, config("inversion"), j);
  expect(s).toHaveLength(1);
  close(s[0][0], at(0.5, 0, 0), f32);
  close(s[0][1], at(2, 0, 0), f32);
  // A missing image draws nothing for it.
  inverted.inversion!.points[j] = null;
  expect(highlight(inverted, config("inversion"), j)).toHaveLength(0);
  // A canal study has no highlight.
  expect(highlight(r, config("canal"), j)).toHaveLength(0);
});

test("a pursuit highlights the connecting polygon at the sample's time", () => {
  const r = circle();
  const paths = [r.base, [null, null, at(0, 2, 0)], [null, null, at(0, 0, 2)]];
  const chase: SpatialResult = {
    ...r,
    pursuit: {
      paths,
      polygons: [],
      capture: null,
      exhausted: false,
      end: 1,
      final: [],
    },
  };
  const s = highlight(chase, config("none", "pursuit"), 2);
  expect(s).toHaveLength(3);
  close(s[0][0], r.base[2]!, f32);
  close(s[0][1], at(0, 2, 0), f32);
  close(s[2][1], r.base[2]!, f32);
  // A pursuer without a position then leaves the polygon out.
  paths[2][2] = null;
  expect(highlight(chase, config("none", "pursuit"), 2)).toHaveLength(0);
});

test("the support table names each construction's highlight", () => {
  for (const c of [
    "developable",
    "involute",
    "tangent-foot",
    "orthotomic",
    "inversion",
    "framed",
    "ruled",
  ] as const)
    expect(probeSupport(config(c)).highlight).toBeTruthy();
  expect(probeSupport(config("canal")).highlight).toBeNull();
  expect(probeSupport(config("none")).highlight).toBeNull();
  expect(probeSupport(config("none", "pursuit")).highlight).toBeTruthy();
  expect(
    probeSupport(config("developable", "harmonic")).highlight,
  ).toBeTruthy();
  expect(probeSupport(config("none", "surface")).available).toBe(false);
  expect(probeSupport(config("none", "rays")).available).toBe(false);
  expect(probeSupport(config("none", "implicit")).available).toBe(false);
  expect(probeSupport(config("canal", "field")).available).toBe(true);
});

test("a curve is straight only when every known curvature is zero", () => {
  const d = circle(true).diagnostics!;
  expect(probeStraight(d)).toBe(false);
  // Flat everywhere, with an unknown sample among them.
  const line = { ...d, curvature: [0, null, 0], flat: 2 };
  expect(probeStraight(line)).toBe(true);
  // Nothing known is not straight.
  expect(probeStraight({ ...d, curvature: [null, null, null] })).toBe(false);
});

test("the help says the probe describes the base curve", () => {
  for (const c of [config("canal"), config("developable"), config("none")])
    expect(probeHelp(c)).toMatch(/the curve itself, not the surface/);
});

test("the readout reports the sample's parameter and marks undefined values", () => {
  const r = circle(true);
  expect(probeReadout(r, 2)).toEqual({
    t: 1,
    curvature: 1,
    radius: 1,
    torsion: 0,
    flat: false,
    infinite: false,
  });
  expect(probeReadout(r, 1)).toEqual({
    t: 0,
    curvature: 0,
    radius: null,
    torsion: null,
    flat: true,
    infinite: false,
  });
  r.diagnostics!.center[0] = null;
  expect(probeReadout(r, 0)?.infinite).toBe(true);
  // t is sampled as Go samples it, lo(1 − i/n) + hi·i/n: exact at the middle
  // of a symmetric domain.
  const d = circle().diagnostics!;
  const wide: SpatialResult = {
    ...circle(),
    diagnostics: {
      ...d,
      min: -2 * Math.PI,
      max: 2 * Math.PI,
      curvature: Array(961).fill(1),
      torsion: Array(961).fill(0),
      center: Array(961).fill(O),
    },
  };
  expect(probeReadout(wide, 480)!.t).toBe(0);
  r.diagnostics!.curvature[0] = null;
  expect(probeReadout(r, 0)).toMatchObject({ curvature: null, flat: false });
  expect(probeReadout({ ...r, diagnostics: undefined }, 0)).toBeNull();
});

test("plots break at undefined samples and pin outliers to their edge", () => {
  // κ ranges up from zero.
  const k = plotScale([0.5, 1, null, 2, 1.5], true);
  expect(k.lo).toBe(0);
  expect(k.hi).toBe(2);
  expect(k.runs).toEqual([
    [
      [0, 0.5],
      [1, 1],
    ],
    [
      [3, 2],
      [4, 1.5],
    ],
  ]);
  expect(k.pinned).toBe(0);
  // τ near a flat point: two outliers beyond the fences are pinned, and the
  // range stays that of the rest.
  const values = Array.from({ length: 40 }, (_, i) => Math.sin(i / 6));
  values[10] = 4000;
  values[11] = -9000;
  // Beyond the outer fence (3 IQR past the quartiles), though not far.
  values[12] = 8;
  values[13] = -8;
  const tau = plotScale(values, false);
  expect(tau.pinned).toBe(4);
  expect(tau.hi).toBeLessThan(1.01);
  expect(tau.lo).toBeGreaterThan(-1.01);
  const flat = tau.runs.flat();
  expect(flat.find(([i]) => i === 10)![1]).toBe(tau.hi);
  expect(flat.find(([i]) => i === 11)![1]).toBe(tau.lo);
  // A zero series draws from 0 up, or around 0.
  expect(plotScale([0, 0, 0], true)).toMatchObject({ lo: 0, hi: 1 });
  expect(plotScale([0, 0, 0], false)).toMatchObject({ lo: -1, hi: 1 });
  // A constant series still has a range to draw in.
  const constant = plotScale([0.2, 0.2, 0.2], false);
  expect(constant.hi).toBeGreaterThan(constant.lo);
  // No values at all.
  expect(plotScale([null, null], false).runs).toEqual([]);
});

test("the probe adds passes last and changes nothing when absent", () => {
  const r = circle();
  const scene = buildScene(r);
  const plain = scenePasses(scene, defaultLayers);
  expect(scenePasses(scene, defaultLayers, [])).toEqual(plain);
  const probe = probeBatches(r, config("developable"), 1);
  const passes = scenePasses(scene, defaultLayers, probe);
  expect(passes.slice(0, plain.length)).toEqual(plain);
  expect(passes.slice(plain.length).map((p) => p.layer)).toEqual(
    probe.map(() => "probe"),
  );
  expect(passes.slice(plain.length).every((p) => !p.sheet)).toBe(true);
});

test("probe inks have their own colours, in the live drawing and in linework", () => {
  const inks = [
    probeInk.mark,
    probeInk.tangent,
    probeInk.normal,
    probeInk.binormal,
  ];
  for (const dark of [false, true]) {
    const colours = inks.map((ink) => hex(lineColor(ink, 0, dark)));
    const existing = [1, 2, 3, 4, 5, 6].map((ink) =>
      hex(lineColor(ink, 0, dark)),
    );
    expect(new Set(colours).size).toBe(4);
    for (const c of colours) expect(existing).not.toContain(c);
  }
  const r = circle();
  const view: View = {
    center: O,
    radius: 2,
    yaw: 0,
    pitch: 0,
    zoom: 1,
    panX: 0,
    panY: 0,
  };
  const size = { width: 400, height: 300, occlusion: "none" as const };
  const without = linework(buildScene(r), view, defaultLayers, false, size);
  expect(without.map((g) => g.layer)).not.toContain("probe");
  const probe = probeBatches(r, config("none"), 1);
  const groups = linework(
    buildScene(r),
    view,
    defaultLayers,
    false,
    size,
    probe,
  );
  const group = groups.find((g) => g.layer === "probe")!;
  expect(group.strokes.map((s) => s.color).sort()).toEqual(
    inks.map((ink) => hex(lineColor(ink, 0, false))).sort(),
  );
  expect(groups.filter((g) => g.layer !== "probe")).toEqual(without);
});

// Through the real notebook, worker and engine.
const stage = (page: Page) => page.locator(".spatial-stage");
const settled = (page: Page) =>
  expect(stage(page)).toHaveAttribute("aria-busy", "false");
async function ready(page: Page) {
  await page.goto("/?study=3d");
  await expect(page.locator("#spatial-artwork")).toBeVisible();
  await settled(page);
}
const probeSwitch = (page: Page) =>
  page.getByRole("checkbox", {
    name: "Frame, curvature & torsion at a point",
  });
const point = (page: Page) => page.getByRole("slider", { name: "Point" });
const readout = (page: Page) => page.locator(".probe-readout dd");
const pixels = (page: Page) =>
  page
    .locator("#spatial-artwork")
    .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
// Pixels within a small distance of a colour, in an image's data URL.
function coloured(page: Page, url: string, rgb: [number, number, number]) {
  return page.evaluate(
    async ({ url, rgb }) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const g = canvas.getContext("2d")!;
      g.drawImage(image, 0, 0);
      const data = g.getImageData(0, 0, image.width, image.height).data;
      let n = 0;
      for (let i = 0; i < data.length; i += 4)
        if (
          Math.abs(data[i] - rgb[0]) +
            Math.abs(data[i + 1] - rgb[1]) +
            Math.abs(data[i + 2] - rgb[2]) <
          24
        )
          n++;
      return n;
    },
    { url, rgb },
  );
}
const probeColour = (dark = false) =>
  lineColor(probeInk.mark, 0, dark).map((c) => Math.round(c * 255)) as [
    number,
    number,
    number,
  ];
const helix = { label: "Helix · a ribbon staircase" };

test("the helix's probe reads its analytic curvature and torsion", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, helix);
  await settled(page);
  const original = await pixels(page);
  expect(await coloured(page, original, probeColour())).toBe(0);
  await expect(point(page)).toHaveCount(0);
  await probeSwitch(page).check();
  await settled(page);
  // r = (2 cos t, 2 sin t, t/3): κ = 2/(4 + 1/9) = 18/37 and τ =
  // (1/3)/(4 + 1/9) = 3/37 at every point, radius 37/18.
  await expect(readout(page)).toHaveText(["0.4865", "2.056", "0.08108"]);
  await expect(point(page)).toHaveAttribute("aria-valuetext", /^t = 0, /);
  const centred = await pixels(page);
  // One-pixel lines: the circle alone spans more than 50 pixels.
  expect(await coloured(page, centred, probeColour())).toBeGreaterThan(50);
  // The last sample, t = 3π, where the curvature is the same.
  await point(page).focus();
  await page.keyboard.press("End");
  await expect(point(page)).toHaveAttribute("aria-valuetext", /^t = 9\.425, /);
  await expect(readout(page)).toHaveText(["0.4865", "2.056", "0.08108"]);
  expect(await pixels(page)).not.toBe(centred);
  await expect(page.locator(".probe-plot figcaption").first()).toHaveText(
    /^κ from 0 to 0\.4865/,
  );
  // Switching the probe off restores the drawing exactly.
  await probeSwitch(page).uncheck();
  await settled(page);
  expect(await pixels(page)).toBe(original);
});

test("edits reach the probe through pending scalar evaluation", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, helix);
  await probeSwitch(page).check();
  await settled(page);
  // a = 2 gives z = 2t/3: κ = 2/(4 + 4/9) = 9/20, τ = (2/3)/(40/9) = 3/20.
  const a = page.getByRole("textbox", { name: "Shape parameter a" });
  await a.fill("2*phi/phi");
  await settled(page);
  await expect(readout(page)).toHaveText(["0.45", "2.222", "0.15"]);
});

test("a straight base curve says so, and a curved one does not", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, { label: "Beads that lose their envelope" });
  await probeSwitch(page).check();
  await settled(page);
  const note = page.getByTestId("probe-straight");
  await expect(note).toHaveText(
    "This curve is straight: its curvature is zero everywhere, so it has no normal, binormal, torsion or osculating circle. The probe describes the curve the canal surface is built on, not the surface.",
  );
  await expect(readout(page)).toHaveText([
    "0 (flat: N, B and τ undefined)",
    "undefined",
    "undefined",
  ]);
  // The count of flat samples would only repeat it, and flat plots would
  // show nothing.
  await expect(page.locator(".probe-notes")).toHaveCount(0);
  await expect(page.locator(".probe-plot")).toHaveCount(0);
  // The middle of [−2π, 2π] is exactly 0, as Go samples it.
  await expect(point(page)).toHaveAttribute("aria-valuetext", /^t = 0, /);
  await choosePreset(page, { label: "A necklace of spheres" });
  await settled(page);
  await expect(readout(page)).toHaveText(["0.4865", "2.056", "0.08108"]);
  await expect(note).toHaveCount(0);
});

test("the probe follows presets and formats, and leaves surfaces alone", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, helix);
  await probeSwitch(page).check();
  await settled(page);
  await point(page).focus();
  await page.keyboard.press("Home");
  await expect(point(page)).toHaveAttribute("aria-valuetext", /^t = -9\.425, /);
  // Another preset keeps the probe on, at the middle of its curve.
  await choosePreset(page, { label: "Trefoil · (2, 3)" });
  await settled(page);
  await expect(probeSwitch(page)).toBeChecked();
  await expect(point(page)).toHaveAttribute("aria-valuetext", /^t = 3\.142, /);
  await expect(readout(page)).toHaveCount(3);
  // A surface study has no probe.
  await choosePreset(page, { label: "A torus revealing its centers" });
  await settled(page);
  await expect(probeSwitch(page)).toHaveCount(0);
  // Back on a curve, it returns as it was.
  await choosePreset(page, { label: "Chords of a rising helix" });
  await settled(page);
  await expect(probeSwitch(page)).toBeChecked();
  await expect(readout(page)).toHaveText(["0.4865", "2.056", "0.08108"]);
});

test("still exports include the probe as drawn; animation hides it", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, helix);
  await settled(page);
  const download = async (item: string) => {
    await page
      .getByRole("button", { name: "Export image", exact: true })
      .click();
    const event = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: item, exact: true }).click();
    return readFile((await (await event).path())!);
  };
  const lines = "Lines (SVG) · every line";
  const before = (await download(lines)).toString();
  expect(before).not.toContain('<g id="probe"');
  await probeSwitch(page).check();
  await settled(page);
  await point(page).focus();
  await page.keyboard.press("End");
  const svg = (await download(lines)).toString();
  expect(svg).toContain('<g id="probe"');
  const desc = svg
    .match(/<desc>(.*?)<\/desc>/)![1]
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
  const meta = JSON.parse(desc);
  expect(meta.probe.index).toBe(960);
  expect(meta.probe.t).toBeCloseTo(3 * Math.PI, 12);
  for (const ink of [
    probeInk.mark,
    probeInk.tangent,
    probeInk.normal,
    probeInk.binormal,
  ])
    expect(svg).toContain(`stroke="${hex(lineColor(ink, 0, false))}"`);
  // The PNG carries the probe's ink as the live drawing does.
  const png = await download("PNG image · 2000 × 1520");
  const url = `data:image/png;base64,${png.toString("base64")}`;
  expect(await coloured(page, url, probeColour())).toBeGreaterThan(200);
  // Playback shows the animation's own frames, without the probe, and Stop
  // brings it back.
  const probed = await pixels(page);
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
  await page.getByLabel("Animate", { exact: true }).selectOption("reveal");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.locator(".spatial-probe")).toContainText(
    "returns when the animation stops",
  );
  const slider = page.getByRole("slider", { name: "Animation progress" });
  await slider.fill("0.5");
  await expect(stage(page)).toHaveAttribute("data-progress", "0.5");
  expect(await coloured(page, await pixels(page), probeColour())).toBe(0);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(stage(page)).not.toHaveAttribute("data-progress");
  await expect(readout(page)).toHaveCount(3);
  expect(await pixels(page)).toBe(probed);
});

test("the probe's colours hold in the dark theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await ready(page);
  await choosePreset(page, helix);
  await probeSwitch(page).check();
  await settled(page);
  await expect(readout(page)).toHaveCount(3);
  expect(
    await coloured(page, await pixels(page), probeColour(true)),
  ).toBeGreaterThan(50);
});

test("a link carries the probe; links without it open with it off", async ({
  page,
  browser,
}) => {
  await ready(page);
  await choosePreset(page, helix);
  await probeSwitch(page).check();
  await settled(page);
  await point(page).focus();
  await page.keyboard.press("Home");
  for (let i = 0; i < 24; i++) await page.keyboard.press("ArrowRight");
  const where = await point(page).getAttribute("aria-valuetext");
  expect(where).toMatch(/^t = -8\.954, sample 24 of 960$/);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const href = await page.evaluate(() => navigator.clipboard.readText());
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const other = await context.newPage();
  await other.goto(href);
  await settled(other);
  await expect(probeSwitch(other)).toBeChecked();
  await expect(point(other)).toHaveAttribute("aria-valuetext", where!);
  await expect(readout(other)).toHaveText(["0.4865", "2.056", "0.08108"]);
  // The same study without a probe field, as links made before it were.
  const study = JSON.parse(
    inflateRawSync(Buffer.from(href.split("#s=")[1], "base64url")).toString(),
  );
  delete study.study.probe;
  await other.goto(
    `/?study=3d#s=${deflateRawSync(Buffer.from(JSON.stringify(study))).toString("base64url")}`,
  );
  await other.reload();
  await settled(other);
  await expect(probeSwitch(other)).not.toBeChecked();
  await expect(readout(other)).toHaveCount(0);
  await context.close();
});
