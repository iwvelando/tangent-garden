import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { choosePreset } from "./helpers";
import {
  defaultProbe,
  describeHelp,
  gridded,
  lightProbeReadout,
  probeLegend,
  probeOptions,
  targetName,
  probeDrawing,
  probeInk,
  probeRecord,
  probeSteps,
  probeSupport,
  probeTarget,
  straightNote,
  surfaceInk,
  surfaceProbeAt,
  surfaceProbeBatches,
  surfaceProbeHelp,
  surfaceProbeReadout,
  surfaceTerms,
} from "../web/spatial/probe";
import type { Batch } from "../web/spatial/scene";
import { spatialPresets } from "../web/spatial/presets";
import type {
  SpatialConfig,
  SpatialResult,
  SurfaceDiagnostics,
  Vec3,
} from "../web/spatial/types";

// The surface probe: a point's principal directions, curvatures and
// centres, on a canal or a surface patch. Expected values follow from the
// definitions, not from the code under test.
const at = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const sub = (a: Vec3, b: Vec3) => at(a.x - b.x, a.y - b.y, a.z - b.z);
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const length = (a: Vec3) => Math.sqrt(dot(a, a));
const f32 = 1e-6;
const config = (
  construction: SpatialConfig["construction"],
  format: SpatialConfig["format"] = "parametric",
): SpatialConfig => ({
  ...structuredClone(spatialPresets[0].config),
  format,
  construction,
});
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

// One row of a sphere-like grid, by hand: at p = (1, 0, 0) with n = x, the
// curvatures −1 and −1/2 along y and z put their centres at the origin and
// at (−1, 0, 0). The second column has no point; the third no normal; the
// fourth is an umbilic; the fifth has its second centre at infinity.
function grid(kind: "patch" | "canal" = "patch"): SpatialResult {
  const p = at(1, 0, 0),
    n = at(1, 0, 0);
  const d: SurfaceDiagnostics = {
    kind,
    along: [0],
    u: [0.25],
    v: [0, 1, 2, 3, 4],
    periodic: kind === "canal",
    points: [[p, null, p, p, p]],
    normals: [[n, null, null, n, n]],
    curvature: [[[-1, null, null, -1, -1]], [[-0.5, null, null, -1, 0]]],
    direction: [
      [[at(0, 1, 0), null, null, null, at(0, 1, 0)]],
      [[at(0, 0, 1), null, null, null, at(0, 0, 1)]],
    ],
    focal: [
      [[at(0, 0, 0), null, null, at(0, 0, 0), at(0, 0, 0)]],
      [[at(-1, 0, 0), null, null, at(0, 0, 0), null]],
    ],
    singular: 1,
    umbilics: 1,
    unknown: 0,
    clipped: [0, 1],
  };
  return {
    base: [],
    minus: [],
    plus: [],
    breaks: [],
    mesh: [],
    rulings: [],
    bounds: { center: at(0, 0, 0), radius: 2 },
    radius: 2,
    omitted: 0,
    invalid: 0,
    surfaceDiagnostics: d,
  };
}

test("the probe describes a patch's surface, the curve or surface built on it, and other curves", () => {
  expect(probeSupport(config("none", "surface")).targets).toEqual([
    "surface",
    "focal1",
    "focal2",
  ]);
  expect(probeSupport(config("none", "surface")).available).toBe(true);
  expect(probeSupport(config("canal")).targets).toEqual(["curve", "surface"]);
  expect(probeSupport(config("canal", "field")).targets).toEqual([
    "curve",
    "surface",
  ]);
  // The ruled surfaces built on a curve: the developable, the ruled
  // surface, and the framed ribbon while it has a width.
  for (const c of ["developable", "framed", "ruled"] as const)
    expect(probeSupport(config(c)).targets).toEqual(["curve", "surface"]);
  const narrow = config("framed");
  narrow.frame.width = 0;
  expect(probeSupport(narrow).targets).toEqual(["curve"]);
  for (const c of ["involute", "inversion", "none"] as const)
    expect(probeSupport(config(c)).targets).toEqual(["curve"]);
  expect(probeSupport(config("canal", "implicit")).available).toBe(false);
  // A mirror or interface: the light leaving it, by default, or the
  // mirror itself.
  expect(probeSupport(config("canal", "rays")).targets).toEqual([
    "light",
    "mirror",
  ]);
  expect(probeSupport(config("canal", "rays")).highlight).toBeNull();
  // A target the study lacks falls back to its first.
  const surface = { ...defaultProbe, target: "surface" as const };
  expect(probeTarget(config("canal"), surface)).toBe("surface");
  expect(probeTarget(config("developable"), surface)).toBe("surface");
  expect(probeTarget(narrow, surface)).toBe("curve");
  expect(probeTarget(config("involute"), surface)).toBe("curve");
  expect(probeTarget(config("none", "surface"), defaultProbe)).toBe("surface");
  // A straight canal spine points to the surface probe.
  expect(straightNote(config("canal"))).toMatch(
    /Choose to describe the surface to probe the canal surface itself\.$/,
  );
  expect(straightNote(config("ruled"))).toMatch(
    /Choose to describe the surface to probe the ruled surface itself\.$/,
  );
  expect(straightNote(narrow)).not.toMatch(/Choose/);
  expect(straightNote(config("involute"))).not.toMatch(/Choose/);
});

test("each surface names its parameters, branches and limits", () => {
  const developable = surfaceTerms(config("developable"), "surface");
  expect(developable.surface).toBe("tangent ribbon");
  expect([developable.along, developable.around]).toEqual(["t", "u"]);
  expect(developable.branches).toEqual(["κ along the ruling", "κ across it"]);
  expect(developable.sliders).toEqual(["Along t", "Across the ruling"]);
  for (const c of ["framed", "ruled"] as const) {
    const terms = surfaceTerms(config(c), "surface");
    expect(terms.branches).toEqual(["κ₁", "κ₂"]);
    expect([terms.along, terms.around]).toEqual(["t", "u"]);
  }
  expect(surfaceTerms(config("framed"), "surface").surface).toBe(
    "framed ribbon",
  );
  expect(surfaceTerms(config("ruled"), "surface").surface).toBe(
    "ruled surface",
  );
  // The patch and the canal keep their words.
  expect(surfaceTerms(config("none", "surface"), "surface").branches).toEqual([
    "κ₁",
    "κ₂",
  ]);
  expect(surfaceTerms(config("canal"), "surface").branches).toEqual([
    "κ around the circle",
    "κ across it",
  ]);
  // Help states the limits the engine enforces.
  const help = surfaceProbeHelp(config("developable"), "surface");
  expect(help).toMatch(/edge of regression/);
  expect(help).toMatch(/u = ±L·k\/12/);
  expect(help).toMatch(/binormal/);
  expect(surfaceProbeHelp(config("framed"), "surface")).toMatch(
    /25 points across/,
  );
  expect(surfaceProbeHelp(config("framed"), "surface")).toMatch(/K ≤ 0/);
  expect(surfaceProbeHelp(config("ruled"), "surface")).toMatch(/S_t × S_u/);
  for (const c of ["developable", "framed", "ruled", "canal"] as const)
    expect(surfaceTerms(config(c), "surface").unknown).toMatch(/unstable/);
});

// A ruled grid of two rows along the x axis, whose rulings run along y
// from y = −1 to y = 1; the second row's middle column has no point.
function ruledGrid(kind: "developable" | "framed" | "ruled"): SpatialResult {
  const result = grid();
  const d = result.surfaceDiagnostics!;
  const row = (x: number, gap: boolean) =>
    [-1, -0.5, 0, 0.5, 1].map((y) => (gap && y === 0 ? null : at(x, y, 0)));
  const n = at(0, 0, 1);
  result.surfaceDiagnostics = {
    ...d,
    kind,
    along: [0, 1],
    u: [0, 1],
    v: [-1, -0.5, 0, 0.5, 1],
    periodic: false,
    points: [row(0, false), row(1, true)],
    normals: [Array(5).fill(n), Array(5).fill(n)],
    curvature: [
      [Array(5).fill(0), Array(5).fill(0)],
      [Array(5).fill(-0.5), Array(5).fill(-0.5)],
    ],
    direction: [
      [Array(5).fill(at(0, 1, 0)), Array(5).fill(at(0, 1, 0))],
      [Array(5).fill(at(1, 0, 0)), Array(5).fill(at(1, 0, 0))],
    ],
    focal: [
      [Array(5).fill(null), Array(5).fill(null)],
      [Array(5).fill(at(0, 0, -2)), Array(5).fill(at(0, 0, -2))],
    ],
    singular: 0,
    umbilics: 0,
    clipped: [10, 0],
  };
  return result;
}

test("the readout shows a curvature lost in rounding as 0", () => {
  const result = ruledGrid("developable");
  const d = result.surfaceDiagnostics!;
  d.curvature[0][0][2] = 6.9e-18;
  d.curvature[1][0][2] = 0.5;
  const r = surfaceProbeReadout(result, 0, 2)!;
  expect(r.curvature).toEqual([0, 0.5]);
  expect(r.radius).toEqual([null, 2]);
  expect([r.gauss, r.mean]).toEqual([0, 0.25]);
  // Small but resolved curvatures are kept, as is a flat point's zero.
  d.curvature[0][0][2] = 1e-9;
  expect(surfaceProbeReadout(result, 0, 2)!.curvature).toEqual([1e-9, 0.5]);
  d.curvature[0][0][2] = 1e-20;
  d.curvature[1][0][2] = -3e-20;
  expect(surfaceProbeReadout(result, 0, 2)!.curvature).toEqual([1e-20, -3e-20]);
});

test("on a ruled surface the probe draws the ruling through the point", () => {
  for (const kind of ["developable", "framed", "ruled"] as const) {
    const marked = byInk(
      surfaceProbeBatches(ruledGrid(kind), 0, 3),
      probeInk.mark,
    );
    // The ruling runs from the row's first point to its last.
    expect(marked).toContainEqual([at(0, -1, 0), at(0, 1, 0)]);
    // Across a missing point it still joins the row's ends.
    const gapped = byInk(
      surfaceProbeBatches(ruledGrid(kind), 1, 1),
      probeInk.mark,
    );
    expect(gapped).toContainEqual([at(1, -1, 0), at(1, 1, 0)]);
  }
  // A patch has no ruling to draw: only the point's cross.
  expect(byInk(surfaceProbeBatches(grid(), 0, 0), probeInk.mark)).toHaveLength(
    3,
  );
});

test("the surface probe snaps to the nearest row and column, wrapping around a canal", () => {
  const d = grid().surfaceDiagnostics!;
  const many = { ...d, u: Array(481).fill(0), v: Array(24).fill(0) };
  expect(surfaceProbeAt(many, 0.5, 0.5)).toEqual({ row: 240, column: 12 });
  expect(surfaceProbeAt(many, 1, 1)).toEqual({ row: 480, column: 23 });
  expect(surfaceProbeAt(many, 0.0011, 0.02)).toEqual({ row: 1, column: 0 });
  const ring = { ...many, periodic: true };
  // 24 turns: the fraction 1 is the turn 0 again, and 0.99 is nearer it.
  expect(surfaceProbeAt(ring, 0, 1).column).toBe(0);
  expect(surfaceProbeAt(ring, 0, 0.99).column).toBe(0);
  expect(surfaceProbeAt(ring, 0, 0.5).column).toBe(12);
  expect(surfaceProbeAt(ring, 0, 0.96).column).toBe(23);
  expect(surfaceProbeAt(ring, Number.NaN, Number.NaN)).toEqual({
    row: 240,
    column: 12,
  });
});

test("the surface probe draws the normal line, directions, centres and principal circles", () => {
  const r = grid(),
    glyph = r.bounds.radius * 0.2;
  const batches = surfaceProbeBatches(r, 0, 0);
  // The normal line runs from the farther centre, (−1, 0, 0), past the
  // point by the glyph length.
  const normal = byInk(batches, probeInk.normal);
  expect(normal).toHaveLength(1);
  expect(length(sub(normal[0][0], at(-1, 0, 0)))).toBeLessThan(f32);
  expect(length(sub(normal[0][1], at(1 + glyph, 0, 0)))).toBeLessThan(f32);
  const branch = (b: 0 | 1) => byInk(batches, surfaceInk[b]);
  // Each branch: its direction glyph first, then a cross at its centre,
  // then its circle through the point in the plane of n and its direction.
  for (const [b, e, centre, radius, flat] of [
    [0, at(0, 1, 0), at(0, 0, 0), 1, "z"],
    [1, at(0, 0, 1), at(-1, 0, 0), 2, "y"],
  ] as const) {
    const s = branch(b);
    expect(length(sub(s[0][0], at(1, 0, 0)))).toBeLessThan(f32);
    expect(
      length(sub(s[0][1], at(1 + e.x * glyph, e.y * glyph, e.z * glyph))),
    ).toBeLessThan(f32);
    const circle = s.slice(4);
    expect(circle).toHaveLength(128);
    expect(length(sub(circle[0][0], at(1, 0, 0)))).toBeLessThan(f32);
    expect(length(sub(circle[127][1], at(1, 0, 0)))).toBeLessThan(f32);
    for (const [q] of circle) {
      expect(Math.abs(length(sub(q, centre)) - radius)).toBeLessThan(f32);
      expect(Math.abs(q[flat])).toBeLessThan(f32);
    }
    // The cross at the centre.
    const arms = s.slice(1, 4);
    for (const [a, c] of arms) {
      const mid = at((a.x + c.x) / 2, (a.y + c.y) / 2, (a.z + c.z) / 2);
      expect(length(sub(mid, centre))).toBeLessThan(f32);
    }
  }
  // The point's mark, and a patch has no ring.
  expect(byInk(batches, probeInk.mark)).toHaveLength(3);
  // A canal's contact circle joins the row's points, skipping gaps.
  const ring = byInk(surfaceProbeBatches(grid("canal"), 0, 0), probeInk.mark);
  expect(ring).toHaveLength(3 + 3);
});

test("missing, singular, umbilic and infinite points draw only what is defined", () => {
  const r = grid();
  expect(surfaceProbeBatches(r, 0, 1)).toEqual([]);
  expect(
    surfaceProbeBatches({ ...r, surfaceDiagnostics: undefined }, 0, 0),
  ).toEqual([]);
  // Singular: the mark alone.
  const singular = surfaceProbeBatches(r, 0, 2);
  expect(singular.map((b) => b.ink)).toEqual([probeInk.mark]);
  // Umbilic: no directions or circles, only both centres (one point).
  const umbilic = surfaceProbeBatches(r, 0, 3);
  expect(byInk(umbilic, surfaceInk[0])).toHaveLength(3);
  expect(byInk(umbilic, surfaceInk[1])).toHaveLength(3);
  // κ = 0: the second branch has its direction, but no centre or circle,
  // and the normal line reaches only the first centre.
  const flat = surfaceProbeBatches(r, 0, 4);
  expect(byInk(flat, surfaceInk[1])).toHaveLength(1);
  expect(byInk(flat, surfaceInk[0])).toHaveLength(1 + 3 + 128);
  const normal = byInk(flat, probeInk.normal)[0];
  expect(length(sub(normal[0], at(0, 0, 0)))).toBeLessThan(f32);
});

test("the surface readout gives curvatures, radii, K and H, and marks undefined values", () => {
  const r = grid();
  expect(surfaceProbeReadout(r, 0, 0)).toEqual({
    u: 0.25,
    v: 0,
    missing: false,
    singular: false,
    umbilic: false,
    folded: false,
    curvature: [-1, -0.5],
    radius: [-1, -2],
    infinite: [false, false],
    gauss: 0.5,
    mean: -0.75,
  });
  expect(surfaceProbeReadout(r, 0, 1)).toMatchObject({
    missing: true,
    singular: false,
    gauss: null,
  });
  expect(surfaceProbeReadout(r, 0, 2)).toMatchObject({
    missing: false,
    singular: true,
    curvature: [null, null],
    // An unknown curvature has no centre, but not one at infinity.
    infinite: [false, false],
  });
  expect(surfaceProbeReadout(r, 0, 3)).toMatchObject({ umbilic: true });
  expect(surfaceProbeReadout(r, 0, 4)).toMatchObject({
    curvature: [-1, 0],
    radius: [-1, null],
    infinite: [false, true],
    gauss: -0,
  });
});

test("drawing, steps and export records follow the probe's target", () => {
  const r = grid("canal"),
    c = config("canal"),
    surface = { ...defaultProbe, target: "surface" as const, across: 0.8 };
  expect(probeSteps(r, "surface")).toBe(0);
  expect(probeSteps(r, "curve")).toBeNull();
  // across 0.8 of five turns is column 4.
  expect(probeDrawing(r, c, surface, 0)).toEqual(surfaceProbeBatches(r, 0, 4));
  expect(probeRecord(r, c, surface, 0)).toEqual({
    target: "surface",
    row: 0,
    column: 4,
    u: 0.25,
    v: 4,
  });
  // The curve probe on the same study draws nothing without its
  // diagnostics.
  expect(probeDrawing(r, c, defaultProbe, 0)).toEqual([]);
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
const surfaceSwitch = (page: Page) =>
  page.getByRole("checkbox", {
    name: "Principal curvatures & centres at a point",
  });
const describe = (page: Page) => page.getByLabel("Describe", { exact: true });
// The targets the Describe menu offers, by value.
const offered = (page: Page) =>
  describe(page)
    .locator("option")
    .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
const along = (page: Page, name: string) =>
  page.getByRole("slider", { name, exact: true });
const readout = (page: Page) => page.locator(".probe-readout dd");
const pixels = (page: Page) =>
  page
    .locator("#spatial-artwork")
    .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
const short = (v: number) => String(Number(v.toPrecision(4)));
const beads = { label: "Beads that lose their envelope" };

// The beads: spheres of radius R = 0.7(1 + 0.8 sin 2t) on the x-axis, a
// surface of revolution with, across each contact circle, the curvature
// R″/(1 − R′² − RR″) against the outward normal. 960 samples on [−2π, 2π]
// make 481 rows, t = −2π + πr/120.
function beadReadout(t: number) {
  const R = 0.7 * (1 + 0.8 * Math.sin(2 * t)),
    r1 = 1.12 * Math.cos(2 * t),
    r2 = -2.24 * Math.sin(2 * t);
  const around = -1 / R,
    across = r2 / (1 - r1 * r1 - R * r2);
  return [
    short(around),
    short(across),
    `${short(1 / around)}, ${short(1 / across)}`,
    `${short(around * across)}, ${short((around + across) / 2)}`,
  ];
}

async function probeBeads(page: Page) {
  await ready(page);
  await choosePreset(page, beads);
  await settled(page);
  await describe(page).selectOption("surface");
  await surfaceSwitch(page).check();
  await settled(page);
}

test("the beads' surface reads its principal curvatures at a bead and a neck", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, beads);
  await settled(page);
  const original = await pixels(page);
  // The curve probe remains the default.
  await expect(describe(page)).toHaveValue("curve");
  await describe(page).selectOption("surface");
  await surfaceSwitch(page).check();
  await settled(page);
  // The middle row is t = 0, where R′ = 1.12 > 1: no envelope there.
  const row = along(page, "Along t");
  await expect(row).toHaveAttribute("aria-valuetext", "t = 0, row 240 of 480");
  await expect(page.getByTestId("probe-status")).toHaveText(
    "No surface here: no real contact circle at this t.",
  );
  await expect(readout(page)).toHaveText(["—", "—", "—", "—"]);
  // A bead's widest point, t = π/4, and a neck, t = −π/4.
  await row.fill("270");
  await expect(row).toHaveAttribute(
    "aria-valuetext",
    "t = 0.7854, row 270 of 480",
  );
  await expect(readout(page)).toHaveText(beadReadout(Math.PI / 4));
  const bead = await pixels(page);
  expect(bead).not.toBe(original);
  await row.fill("210");
  await expect(readout(page)).toHaveText(beadReadout(-Math.PI / 4));
  // On a surface of revolution the turn around the circle changes nothing.
  const turn = along(page, "Around");
  await expect(turn).toHaveAttribute(
    "aria-valuetext",
    "θ − θ₀ = 3.142, column 12 of 23",
  );
  await turn.fill("5");
  await expect(turn).toHaveAttribute(
    "aria-valuetext",
    "θ − θ₀ = 1.309, column 5 of 23",
  );
  await expect(readout(page)).toHaveText(beadReadout(-Math.PI / 4));
  await expect(page.locator(".probe-plot figcaption")).toHaveCount(2);
  // The steep stretches have no envelope; counted, not drawn.
  await expect(page.locator(".probe-notes")).toHaveCount(0);
  // Back to the curve: the straight-curve note, and its own place.
  await describe(page).selectOption("curve");
  await settled(page);
  await expect(page.getByTestId("probe-straight")).toContainText(
    "Choose to describe the surface to probe the canal surface itself.",
  );
  // Both stand at the same place along t: row 210 is sample 420.
  await expect(page.getByRole("slider", { name: "Point" })).toHaveAttribute(
    "aria-valuetext",
    "t = -0.7854, sample 420 of 960",
  );
  await page
    .getByRole("checkbox", { name: "Frame, curvature & torsion at a point" })
    .uncheck();
  await settled(page);
  expect(await pixels(page)).toBe(original);
});

// Chromium ends a range drag when a child is inserted directly into the
// slider's fieldset, as the readout replacing "no surface here" once was.
test("dragging along t carries on across the edge of a gap", async ({
  page,
}) => {
  await probeBeads(page);
  const row = along(page, "Along t");
  await row.scrollIntoViewIfNeeded();
  const box = (await row.boundingBox())!,
    y = box.y + box.height / 2;
  // From the middle row (t = 0, no surface) to the right, past row 249,
  // the first with a contact circle.
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  for (let k = 1; k <= 8; k++)
    await page.mouse.move(box.x + box.width * (0.5 + k / 20), y, {
      steps: 3,
    });
  await expect(readout(page)).toHaveCount(4);
  expect(Number(await row.inputValue())).toBeGreaterThan(300);
  await page.mouse.up();
});

// The readout keeps its height wherever the probe stands, so the controls
// below it, such as Pause and Stop during probe playback, never move.
test("controls below the surface probe stay put as it crosses gaps", async ({
  page,
}) => {
  await probeBeads(page);
  const row = along(page, "Along t");
  const below = page.getByLabel("Animate", { exact: true });
  const top = async () => (await below.boundingBox())!.y;
  const status = page.getByTestId("probe-status");
  const places: number[] = [];
  // A gap (t = 0), a bead (t = π/4), a neck (t = −π/4) and the gap again.
  for (const r of ["240", "270", "210", "245"]) {
    await row.fill(r);
    await expect(row).toHaveValue(r);
    places.push(await top());
  }
  await expect(status).toHaveText(
    "No surface here: no real contact circle at this t.",
  );
  expect(new Set(places).size).toBe(1);
});

test("edits reach the surface probe through pending scalar evaluation", async ({
  page,
}) => {
  await probeBeads(page);
  await along(page, "Along t").fill("270");
  await expect(readout(page)).toHaveText(beadReadout(Math.PI / 4));
  // Doubling the sphere radius doubles R and its derivatives.
  await page
    .getByRole("textbox", { name: "Tube radius R", exact: true })
    .fill("1.4*phi/phi");
  await settled(page);
  const t = Math.PI / 4,
    R = 1.4 * 1.8,
    r2 = -4.48;
  const around = -1 / R,
    across = r2 / (1 - R * r2);
  await expect(readout(page).first()).toHaveText(short(around));
  await expect(readout(page).nth(1)).toHaveText(short(across));
  expect(t).toBeCloseTo(0.785, 3);
});

// The torus preset: R = 2, r = 0.8, u over the whole circle in 72 steps and
// v from −π/3 to π/3 in 24, with the outward normal: κ₁ = −cos v/(2 +
// 0.8 cos v) and κ₂ = −1/0.8.
test("a torus patch reads κ₁ and κ₂ against the closed form", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, { label: "A torus revealing its centers" });
  await settled(page);
  // The patch is described first; its focal sheets are offered beside it.
  await expect(describe(page)).toHaveValue("surface");
  expect(await offered(page)).toEqual(["surface", "focal1", "focal2"]);
  await surfaceSwitch(page).check();
  await settled(page);
  const v = along(page, "Along v");
  await expect(along(page, "Along u")).toHaveAttribute(
    "aria-valuetext",
    "u = 3.142, row 36 of 72",
  );
  await expect(v).toHaveAttribute("aria-valuetext", "v = 0, column 12 of 24");
  const expected = (v: number) => {
    const k1 = -Math.cos(v) / (2 + 0.8 * Math.cos(v)),
      k2 = -1 / 0.8;
    return [
      short(k1),
      short(k2),
      `${short(1 / k1)}, ${short(1 / k2)}`,
      `${short(k1 * k2)}, ${short((k1 + k2) / 2)}`,
    ];
  };
  await expect(readout(page)).toHaveText(expected(0));
  await v.fill("24");
  await expect(v).toHaveAttribute(
    "aria-valuetext",
    "v = 1.047, column 24 of 24",
  );
  await expect(readout(page)).toHaveText(expected(Math.PI / 3));
  // Reversing the normal reverses the curvatures, and their order.
  await page.getByLabel("Normal", { exact: true }).selectOption("reverse");
  await settled(page);
  const k1 = Math.cos(Math.PI / 3) / (2 + 0.4);
  await expect(readout(page).first()).toHaveText(short(1.25));
  await expect(readout(page).nth(1)).toHaveText(short(k1));
});

// The same torus offset by d is the torus of tube radius r + d: at u = π,
// v = 0 its curvatures are −1/(R + r + d) and −1/(r + d), numbered as the
// patch's. Past the core circle (r + d < 0) it has folded; at r + d = 0 it
// has collapsed onto the core circle, a cuspidal edge, and is singular.
test("a torus's offset reads the offset torus through the Offset d control", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, { label: "A torus revealing its centers" });
  await settled(page);
  await surfaceSwitch(page).check();
  await settled(page);
  expect(await offered(page)).toEqual(["surface", "focal1", "focal2"]);
  const offset = page.getByRole("textbox", { name: "Offset d", exact: true });
  const status = page.getByTestId("probe-status");
  const torus = (tube: number) => {
    const k1 = -1 / (2 + tube),
      k2 = -1 / tube;
    return [
      short(k1),
      short(k2),
      `${short(1 / k1)}, ${short(1 / k2)}`,
      `${short(k1 * k2)}, ${short((k1 + k2) / 2)}`,
    ];
  };
  await offset.fill("0.4");
  await settled(page);
  // The patch is still described until the offset is chosen.
  await expect(describe(page)).toHaveValue("surface");
  await expect(readout(page)).toHaveText(torus(0.8));
  await expect(page.locator(".spatial-probe legend")).toHaveText(
    "Probe the surface, its offset or its focal sheets",
  );
  expect(await offered(page)).toEqual([
    "surface",
    "offset",
    "focal1",
    "focal2",
  ]);
  await describe(page).selectOption("offset");
  await settled(page);
  await expect(along(page, "Along u")).toHaveAttribute(
    "aria-valuetext",
    "u = 3.142, row 36 of 72",
  );
  await expect(readout(page)).toHaveText(torus(1.2));
  await expect(status).toHaveText("");
  // Past the core circle: turned inside out.
  await offset.fill("-1.2");
  await settled(page);
  await expect(readout(page)).toHaveText(torus(-0.4));
  await expect(status).toHaveText(
    "Folded here: the offset lies beyond one focal sheet, turned inside out.",
  );
  await expect(page.locator(".probe-notes")).toContainText(
    "1,825 points have folded, beyond a focal sheet",
  );
  // On the core circle itself.
  await offset.fill("-0.8");
  await settled(page);
  await expect(status).toHaveText(
    "Singular here: no normal or principal curvatures.",
  );
  // Without an offset the probe describes the patch again.
  await offset.fill("0");
  await settled(page);
  await expect(describe(page)).toHaveValue("surface");
  expect(await offered(page)).toEqual(["surface", "focal1", "focal2"]);
  await expect(readout(page)).toHaveText(torus(0.8));
});

// A spheroid (a, a, c) has meridians (a cos v, c sin v), so its meridians'
// centers, focal sheet 2 while c < a, are the surface of revolution of the
// evolute (r, z) = ((a² − c²)/a cos³v, (c² − a²)/c sin³v). With the unit
// normal (−z′, r′)/|γ′| in the meridian plane, a surface of revolution's
// meridian curvature is (r′z″ − z′r″)/|γ′|³ and its parallel's z′/(r|γ′|);
// the sheet's normal may point either way, so K and |κ| are compared.
function spunEvolute(a: number, c: number, v: number) {
  const k = (a * a - c * c) / a,
    l = (c * c - a * a) / c;
  const [cv, sv] = [Math.cos(v), Math.sin(v)];
  const r = k * cv ** 3,
    dr = -3 * k * cv * cv * sv,
    dz = 3 * l * sv * sv * cv,
    ddr = -3 * k * (cv ** 3 - 2 * cv * sv * sv),
    ddz = 3 * l * (2 * sv * cv * cv - sv ** 3),
    speed = Math.hypot(dr, dz);
  const meridian = (dr * ddz - dz * ddr) / speed ** 3,
    parallel = dz / (r * speed);
  return {
    sizes: [Math.abs(meridian), Math.abs(parallel)].sort((x, y) => x - y),
    gauss: meridian * parallel,
  };
}
// The readout's |κ₁|, |κ₂| in order, and K.
async function sheetReadout(page: Page) {
  const [k1, k2, , kh] = await readout(page).allTextContents();
  return {
    sizes: [Math.abs(Number(k1)), Math.abs(Number(k2))].sort((x, y) => x - y),
    gauss: Number(kh.split(", ")[0]),
  };
}
const fourFigures = (got: number, want: number) =>
  expect(Math.abs(got - want)).toBeLessThanOrEqual(
    5e-4 * Math.abs(want) + 1e-12,
  );

test("a spheroid's second focal sheet reads its spun evolute's curvatures", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, {
    label: "A spheroid's evolute, spun about its axis",
  });
  await settled(page);
  await expect(describe(page)).toHaveValue("focal2");
  await expect(surfaceSwitch(page)).toBeChecked();
  await expect(page.locator(".spatial-probe legend")).toHaveText(
    "Probe the surface or its focal sheets",
  );
  const status = page.getByTestId("probe-status");
  await expect(along(page, "Along v")).toHaveAttribute(
    "aria-valuetext",
    "v = 0.5236, column 48 of 72",
  );
  const check = async (c: number, v: number) => {
    const want = spunEvolute(1.2, c, v),
      got = await sheetReadout(page);
    fourFigures(got.gauss, want.gauss);
    got.sizes.forEach((x, b) => fourFigures(x, want.sizes[b]));
  };
  await expect(status).toHaveText("");
  await check(0.6, Math.PI / 6);
  // Through the Axis c control, from the preset's edited value.
  const axis = page.getByRole("textbox", { name: "Axis c", exact: true });
  await axis.fill("0.8");
  await settled(page);
  await expect(describe(page)).toHaveValue("focal2");
  await check(0.8, Math.PI / 6);
  await along(page, "Along v").fill("60");
  await expect(along(page, "Along v")).toHaveAttribute(
    "aria-valuetext",
    "v = 1.047, column 60 of 72",
  );
  await check(0.8, Math.PI / 3);
  // The rim over the equator is a cuspidal edge, and the poles have no
  // normal, so no centers.
  await along(page, "Along v").fill("36");
  await expect(status).toHaveText(
    "Singular here: no tangent plane, as on a cuspidal edge.",
  );
  await expect(readout(page).first()).toHaveText("—");
  await along(page, "Along v").fill("72");
  await expect(status).toHaveText(
    "No point here: the patch's center lies at infinity, or the patch has no normal.",
  );
  // The parallels' centers, the first sheet, are the axis: singular at
  // every point, and counted.
  await along(page, "Along v").fill("48");
  await describe(page).selectOption("focal1");
  await settled(page);
  await expect(status).toHaveText(
    "Singular here: no tangent plane, as on a cuspidal edge.",
  );
  await expect(page.locator(".probe-notes")).toContainText(
    "4,331 points are singular, without a normal",
  );
  // Back on the patch, the readout is the spheroid's own: the meridian's
  // a c/(a² sin²v + c² cos²v)^{3/2} and the parallel's c/(a√(…)).
  await describe(page).selectOption("surface");
  await settled(page);
  const q = 1.44 * 0.25 + 0.64 * 0.75;
  const [k1, k2] = (await readout(page).allTextContents()).map(Number);
  fourFigures(k1, -0.8 / (1.2 * Math.sqrt(q)));
  fourFigures(k2, -(1.2 * 0.8) / q ** 1.5);
});

// The preset's ellipsoid has 100 rows, putting u = 3π/2 and 2π, its
// planes of symmetry x = 0 and y = 0, on rows 40 and 90. There the
// ellipsoid's κ₁ is stationary along its own line of curvature, so the
// first sheet has a cuspidal edge; beside it the sheet's own curvature
// grows without bound.
test("the probe rides an ellipsoid's focal sheet over its cuspidal edges", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, {
    label: "The curvature of an ellipsoid's focal sheet",
  });
  await settled(page);
  await expect(describe(page)).toHaveValue("focal1");
  const u = along(page, "Along u"),
    status = page.getByTestId("probe-status");
  await expect(along(page, "Along v")).toHaveAttribute(
    "aria-valuetext",
    "v = 0.3927, column 60 of 96",
  );
  const largest = async () =>
    Math.max(
      ...(await readout(page).allTextContents())
        .slice(0, 2)
        .map((t) => Math.abs(Number(t))),
    );
  await u.fill("20");
  await expect(status).toHaveText("");
  // Nearing the edge one curvature grows steadily, while the other falls
  // towards 0, its center at infinity.
  const away = await largest();
  let before = away;
  for (const row of [30, 35, 38, 39]) {
    await u.fill(String(row));
    await expect(u).toHaveAttribute(
      "aria-valuetext",
      new RegExp(`row ${row} of 100$`),
    );
    const now = await largest();
    expect(now).toBeGreaterThan(before);
    before = now;
  }
  expect(before).toBeGreaterThan(10 * away);
  await expect(status).toHaveText(
    "A centre lies beyond 100 study radii, at infinity: its circle is not drawn.",
  );
  for (const row of ["40", "90"]) {
    await u.fill(row);
    await expect(status).toHaveText(
      "Singular here: no tangent plane, as on a cuspidal edge.",
    );
  }
  // The animation moves the probe along the sheet, over both edges.
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
  const mode = page.getByLabel("Animate", { exact: true });
  await expect(mode).toHaveValue("probe");
  await expect(mode.locator('option[value="probe"]')).toHaveText(
    "Move the probe along the first focal sheet",
  );
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(stage(page)).toHaveAttribute("data-mode", "probe");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  // Back and forth at a steady pace, time 0.2 is progress 0.4, row 40,
  // and time 0.45 progress 0.9, row 90.
  for (const [time, row] of [
    ["0.2", 40],
    ["0.45", 90],
  ] as const) {
    await page.getByRole("slider", { name: "Animation progress" }).fill(time);
    await expect(stage(page)).toHaveAttribute("data-time", time);
    await expect(u).toHaveAttribute(
      "aria-valuetext",
      new RegExp(`row ${row} of 100$`),
    );
    await expect(status).toHaveText(
      "Singular here: no tangent plane, as on a cuspidal edge.",
    );
  }
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(stage(page)).not.toHaveAttribute("data-progress");
  await expect(u).toHaveAttribute("aria-valuetext", /row 90 of 100$/);
});

// The preset's ellipsoid (1.5, 1, 0.7) offset by d = −0.25: the offset
// shares the patch's normal and centers, so at every point each radius of
// curvature of the offset is the patch's less d. At the bottom of the
// bowl, (0, −1, 0) on the ellipsoid, those radii are −a²/b and −c²/b.
test("an ellipsoid's parallel surface keeps the ellipsoid's centers", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, { label: "An ellipsoid's parallel surface" });
  await settled(page);
  await expect(describe(page)).toHaveValue("offset");
  await expect(surfaceSwitch(page)).toBeChecked();
  await expect(along(page, "Along u")).toHaveAttribute(
    "aria-valuetext",
    "u = 4.712, row 32 of 80",
  );
  await expect(along(page, "Along v")).toHaveAttribute(
    "aria-valuetext",
    "v = 0, column 40 of 80",
  );
  const d = -0.25;
  await expect(readout(page).nth(2)).toHaveText(
    `${short(-2.25 - d)}, ${short(-0.49 - d)}`,
  );
  const radii = async () =>
    (await readout(page).nth(2).textContent())!.split(", ").map(Number);
  for (const column of ["40", "20", "70"]) {
    await along(page, "Along v").fill(column);
    await describe(page).selectOption("surface");
    await settled(page);
    const own = await radii();
    await describe(page).selectOption("offset");
    await settled(page);
    const parallel = await radii();
    own.forEach((r, b) =>
      expect(Math.abs(parallel[b] - (r - d))).toBeLessThan(
        1e-3 * Math.max(1, Math.abs(r)),
      ),
    );
  }
});

test("still exports record the surface probe; a link carries it", async ({
  page,
  browser,
}) => {
  await probeBeads(page);
  await along(page, "Along t").fill("270");
  await along(page, "Around").fill("6");
  await expect(readout(page)).toHaveText(beadReadout(Math.PI / 4));
  await page.getByRole("button", { name: "Export image", exact: true }).click();
  const event = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Lines (SVG) · every line", exact: true })
    .click();
  const svg = (await readFile((await (await event).path())!)).toString();
  expect(svg).toContain('<g id="probe"');
  const meta = JSON.parse(
    svg
      .match(/<desc>(.*?)<\/desc>/)![1]
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&amp;", "&"),
  );
  expect(meta.probe).toMatchObject({ target: "surface", row: 270, column: 6 });
  expect(meta.probe.u).toBeCloseTo(Math.PI / 4, 12);
  expect(meta.probe.v).toBeCloseTo(Math.PI / 2, 12);
  // The link reopens the same point on the surface.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const other = await context.newPage();
  await other.goto(link);
  await settled(other);
  await expect(describe(other)).toHaveValue("surface");
  await expect(surfaceSwitch(other)).toBeChecked();
  await expect(along(other, "Along t")).toHaveAttribute(
    "aria-valuetext",
    "t = 0.7854, row 270 of 480",
  );
  await expect(along(other, "Around")).toHaveAttribute(
    "aria-valuetext",
    "θ − θ₀ = 1.571, column 6 of 23",
  );
  await expect(readout(other)).toHaveText(beadReadout(Math.PI / 4));
  await context.close();
});

test("the surface probe moves along t as an animation and returns on Stop", async ({
  page,
}) => {
  await probeBeads(page);
  await along(page, "Along t").fill("270");
  const study = await pixels(page);
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
  const mode = page.getByLabel("Animate", { exact: true });
  await expect(mode.locator('option[value="probe"]')).toHaveText(
    "Move the probe along the canal surface",
  );
  await mode.selectOption("probe");
  await page.getByLabel("Duration (seconds)").fill("5");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(stage(page)).toHaveAttribute("data-mode", "probe");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const seek = async (p: string) => {
    await page.getByRole("slider", { name: "Animation progress" }).fill(p);
    await expect(stage(page)).toHaveAttribute("data-progress", p);
  };
  await expect(along(page, "Along t")).toBeDisabled();
  await expect(along(page, "Around")).toBeDisabled();
  await expect(describe(page)).toBeDisabled();
  await seek("0");
  await expect(along(page, "Along t")).toHaveAttribute(
    "aria-valuetext",
    "t = -6.283, row 0 of 480",
  );
  await expect(page.locator(".animation-values")).toHaveText(
    "Probe at t = -6.28319, θ − θ₀ = 3.14159",
  );
  await seek("1");
  await expect(along(page, "Along t")).toHaveAttribute(
    "aria-valuetext",
    "t = 6.283, row 480 of 480",
  );
  // Progress 0.562 is row 269.76 of 480: the nearest is 270, t = π/4.
  await seek("0.562");
  await expect(readout(page)).toHaveText(beadReadout(Math.PI / 4));
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(stage(page)).not.toHaveAttribute("data-progress");
  await expect(along(page, "Along t")).toBeEnabled();
  await expect(along(page, "Along t")).toHaveAttribute(
    "aria-valuetext",
    "t = 0.7854, row 270 of 480",
  );
  expect(await pixels(page)).toBe(study);
});

test("the surface probe's colours hold in the dark theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await probeBeads(page);
  await along(page, "Along t").fill("270");
  await expect(readout(page)).toHaveText(beadReadout(Math.PI / 4));
  const legend = page.locator(".probe-legend li");
  await expect(legend).toHaveText([
    "Normal",
    "κ around the circle: direction, circle & centre",
    "κ across it: direction, circle & centre",
    "Point & contact circle",
  ]);
});

// The ruled surfaces built on a curve, through the real notebook.
const staircase = { label: "Helix · a ribbon staircase" };
const seam = { label: "The seam of a carried frame" };
const band = { label: "A band around the trefoil" };
const halfTurns = { label: "Chords of a rising helix" };
const gauss = async (page: Page) =>
  Number((await readout(page).nth(3).textContent())!.split(", ")[0]);
// The readout as numbers: both curvatures, K and H. A custom curve's r‴ is
// differenced, so curvatures that need it hold to about 5·10⁻⁵ inside the
// domain and less at its ends, and the readout's fourth digit can turn.
async function numbers(page: Page) {
  await expect(readout(page).first()).not.toHaveText("—");
  const [k0, k1, , kh] = await readout(page).allTextContents();
  const [K, H] = kh.split(", ").map(Number);
  return { k0: Number(k0), k1: Number(k1), K, H };
}
const within = (got: number, want: number, tol = 1e-3) =>
  expect(Math.abs(got - want)).toBeLessThanOrEqual(tol * Math.abs(want));
async function probeSurface(page: Page, preset: { label: string }) {
  await ready(page);
  await choosePreset(page, preset);
  await settled(page);
  await expect(describe(page)).toHaveValue("curve");
  await describe(page).selectOption("surface");
  await surfaceSwitch(page).check();
  await settled(page);
}

// The helix (2 cos t, 2 sin t, t/3): a = 2, b = 1/3, so across each tangent
// ruling κ = τ/(κ_c|u|) = b/(a|u|) = 1/(6|u|), and along it κ = 0. The
// ruling's columns are u = ±1.5k/12; the default is u = 0.125, next to the
// edge of regression.
test("a helix's tangent ribbon reads τ/(κ|u|) across its rulings and K = 0", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, staircase);
  await settled(page);
  const original = await pixels(page);
  await describe(page).selectOption("surface");
  await surfaceSwitch(page).check();
  await settled(page);
  await expect(along(page, "Along t")).toHaveAttribute(
    "aria-valuetext",
    "t = 0, row 240 of 480",
  );
  const across = along(page, "Across the ruling");
  await expect(across).toHaveAttribute(
    "aria-valuetext",
    "u = 0.125, column 12 of 23",
  );
  await expect(readout(page).nth(2)).toHaveText("∞, 0.75");
  let r = await numbers(page);
  expect([r.k0, r.K]).toEqual([0, 0]);
  within(r.k1, 4 / 3);
  within(r.H, 2 / 3);
  await expect(page.getByTestId("probe-status")).toHaveText(
    "A centre lies beyond 100 study radii, at infinity: its circle is not drawn.",
  );
  expect(await pixels(page)).not.toBe(original);
  // The far edge on the other sheet, u = −1.5: κ = 1/9, with the normal −B.
  await across.fill("0");
  await expect(across).toHaveAttribute(
    "aria-valuetext",
    "u = -1.5, column 0 of 23",
  );
  r = await numbers(page);
  expect([r.k0, r.K]).toEqual([0, 0]);
  within(r.k1, 1 / 9);
  within(r.H, 1 / 18);
  // The same along t: the helix is homogeneous.
  await along(page, "Along t").fill("90");
  within((await numbers(page)).k1, 1 / 9);
  await expect(page.locator(".probe-plot figcaption")).toHaveText([
    "κ along the ruling along t: constant at 0",
    `κ across it along t: constant at ${short(1 / 9)}`,
  ]);
  await expect(page.locator(".probe-legend li")).toHaveText([
    "Normal",
    "κ along the ruling: direction, circle & centre",
    "κ across it: direction, circle & centre",
    "Point & ruling",
  ]);
  await expect(page.locator(".probe-notes")).toHaveText(
    "11,544 centres of κ along the ruling lie beyond 100 study radii, at infinity.",
  );
  // Back to the curve: its probe stands at the same t, unchanged.
  await describe(page).selectOption("curve");
  await settled(page);
  await expect(page.getByRole("slider", { name: "Point" })).toHaveAttribute(
    "aria-valuetext",
    `t = ${short(-3 * Math.PI + (6 * Math.PI * 180) / 960)}, sample 180 of 960`,
  );
  await page
    .getByRole("checkbox", { name: "Frame, curvature & torsion at a point" })
    .uncheck();
  await settled(page);
  expect(await pixels(page)).toBe(original);
});

// A rotation-minimizing frame turns only toward T, so an untwisted ribbon
// is developable (K = 0); twisted, its rulings turn about T and K < 0.
test("a framed ribbon is flat untwisted and negatively curved when twisted", async ({
  page,
}) => {
  await probeSurface(page, seam);
  await expect(along(page, "Across the ribbon")).toHaveAttribute(
    "aria-valuetext",
    "u = 0, column 12 of 24",
  );
  for (const row of ["40", "240", "400"]) {
    await along(page, "Along t").fill(row);
    for (const column of ["0", "12", "24"]) {
      await along(page, "Across the ribbon").fill(column);
      expect(Math.abs(await gauss(page))).toBeLessThan(1e-6);
    }
  }
  await probeSurface(page, band);
  for (const row of ["40", "240", "400"]) {
    await along(page, "Along t").fill(row);
    expect(await gauss(page)).toBeLessThan(-0.01);
  }
  // Without a ribbon there is only the curve to describe.
  await page.getByLabel("Half-width w", { exact: true }).fill("0");
  await settled(page);
  await expect(describe(page)).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", {
      name: "Frame, curvature & torsion at a point",
    }),
  ).toBeChecked();
});

// Half-turn chords of (2 cos t, 2 sin t, t/3) pass through the axis at
// u = 1/2: S_t = (0, 0, 1/3), S_u = d = (−4 cos t, −4 sin t, π/3) and
// S_tu = (4 sin t, −4 cos t, 0), S_tt = 0. With n along S_t × S_u,
// EG − F² = 16/9, M = 4 and L = N = 0, so K = −M²/(EG − F²) = −9 and
// H = −MF/(EG − F²) = −π/4 at every t.
test("half-turn chords of a helix cross its axis with K = −9", async ({
  page,
}) => {
  await probeSurface(page, halfTurns);
  await expect(along(page, "Along the ruling")).toHaveAttribute(
    "aria-valuetext",
    "u = 0.5, column 12 of 24",
  );
  for (const row of ["100", "240"]) {
    await along(page, "Along t").fill(row);
    await expect(readout(page).nth(3)).toHaveText(`-9, ${short(-Math.PI / 4)}`);
  }
  // A ruled surface is never positively curved.
  for (const column of ["0", "6", "18", "24"]) {
    await along(page, "Along the ruling").fill(column);
    expect(await gauss(page)).toBeLessThanOrEqual(1e-9);
  }
});

test("a tangent ribbon's probe moves along t, returns on Stop, and travels in a link", async ({
  page,
  browser,
}) => {
  await probeSurface(page, staircase);
  await along(page, "Across the ruling").fill("3");
  const study = await pixels(page);
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
  const mode = page.getByLabel("Animate", { exact: true });
  await expect(mode.locator('option[value="probe"]')).toHaveText(
    "Move the probe along the tangent ribbon",
  );
  await mode.selectOption("probe");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  for (const [p, valuetext] of [
    ["0", `t = ${short(-3 * Math.PI)}, row 0 of 480`],
    ["1", `t = ${short(3 * Math.PI)}, row 480 of 480`],
  ]) {
    await page.getByRole("slider", { name: "Animation progress" }).fill(p);
    await expect(stage(page)).toHaveAttribute("data-progress", p);
    await expect(along(page, "Along t")).toHaveAttribute(
      "aria-valuetext",
      valuetext,
    );
    // u = −1.5 + 3·0.125 = −1.125: κ across = 1/(6·1.125).
    within((await numbers(page)).k1, 1 / 6.75);
  }
  await page.getByRole("slider", { name: "Animation progress" }).fill("0.5");
  await expect(stage(page)).toHaveAttribute("data-progress", "0.5");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(stage(page)).not.toHaveAttribute("data-progress");
  expect(await pixels(page)).toBe(study);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const other = await context.newPage();
  await other.goto(link);
  await settled(other);
  await expect(describe(other)).toHaveValue("surface");
  await expect(along(other, "Across the ruling")).toHaveAttribute(
    "aria-valuetext",
    "u = -1.125, column 3 of 23",
  );
  within((await numbers(other)).k1, 1 / 6.75);
  await context.close();
});

// The light probe on a mirror or interface, by hand: one row, X at the
// origin, the surface's normal +z and ℓ = 1.5.
//  0 reflected straight back up, R = +z, μ = (2, −1): a real focus at
//    (0, 0, 0.5) and a virtual one at (0, 0, −1), along x and y;
//  1 stigmatic, μ₁ = μ₂ = 1, both foci at (0, 0, 1);
//  2 beyond the critical angle, totally reflected from I = (0.8, 0, −0.6);
//  3 unlit; 4 a chart singularity;
//  5 transmitted straight through, R = −z, with μ₂'s focus at infinity.
function lit(): SpatialResult {
  const o = at(0, 0, 0),
    up = at(0, 0, 1),
    down = at(0, 0, -1),
    slant = at(0.8, 0, -0.6);
  const d: SurfaceDiagnostics = {
    kind: "wavefront",
    along: [0],
    u: [0.25],
    v: [0, 1, 2, 3, 4, 5],
    periodic: false,
    points: [[o, o, o, o, o, o]],
    normals: [[up, up, null, null, null, down]],
    curvature: [
      [[2, 1, null, null, null, -3]],
      [[-1, 1, null, null, null, 1e-3]],
    ],
    direction: [
      [[at(1, 0, 0), null, null, null, null, at(1, 0, 0)]],
      [[at(0, 1, 0), null, null, null, null, at(0, 1, 0)]],
    ],
    focal: [
      [[at(0, 0, 0.5), up, null, null, null, at(0, 0, 1 / 3)]],
      [[down, up, null, null, null, null]],
    ],
    singular: 1,
    umbilics: 1,
    unknown: 0,
    clipped: [0, 1],
    light: {
      length: 1.5,
      incident: [[down, down, slant, at(0, 0, 1), null, down]],
      surface: [[up, up, up, up, null, up]],
      outgoing: [[up, up, at(0.8, 0, 0.6), null, null, down]],
      state: [[0, 0, 2, 1, 4, 0]],
      unlit: 1,
      total: 1,
      atSource: 0,
    },
  };
  return { ...grid(), surfaceDiagnostics: d };
}
const rays = (interaction: "reflect" | "refract" = "reflect") => {
  const c = config("none", "rays");
  c.rays.interaction = interaction;
  return c;
};
const close = (a: Vec3, b: Vec3) => length(sub(a, b)) < f32;

test("a mirror's probe describes the light or the mirror, in their own words", () => {
  const mirror = rays(),
    glass = rays("refract");
  expect(probeTarget(mirror, defaultProbe)).toBe("light");
  // A surface's target falls back to the light; the mirror is kept.
  expect(probeTarget(mirror, { ...defaultProbe, target: "surface" })).toBe(
    "light",
  );
  expect(probeTarget(mirror, { ...defaultProbe, target: "mirror" })).toBe(
    "mirror",
  );
  expect(
    probeTarget(config("canal"), { ...defaultProbe, target: "light" }),
  ).toBe("curve");
  expect(
    ["curve", "surface", "light", "mirror"].map((t) => gridded(t as never)),
  ).toEqual([false, true, true, true]);
  expect(probeOptions("curve")).toEqual({ diagnostics: true });
  expect(probeOptions("surface")).toEqual({ surfaceDiagnostics: true });
  expect(probeOptions("mirror")).toEqual({ surfaceDiagnostics: true });
  expect(probeOptions("light")).toEqual({ lightDiagnostics: true });
  expect(targetName(mirror, "mirror")).toBe("The mirror");
  expect(targetName(glass, "mirror")).toBe("The interface");
  expect(targetName(glass, "light")).toBe("The light");
  expect(probeLegend(glass, "light")).toBe("Probe the light or interface");
  expect(probeLegend(config("canal"), "curve")).toBe(
    "Probe the curve or surface",
  );
  expect(describeHelp(mirror)).toMatch(/^The light: .* The mirror: /);
  expect(describeHelp(config("canal"))).toMatch(/canal surface's principal/);
  const light = surfaceTerms(glass, "light");
  expect(light.surface).toBe("interface");
  expect(light.switch).toBe("Wavefront, foci & rays at a point");
  expect(light.branches).toEqual(["μ₁", "μ₂"]);
  const own = surfaceTerms(mirror, "mirror");
  expect(own.surface).toBe("mirror");
  expect(own.switch).toBe("Principal curvatures & centres at a point");
  expect(own.branches).toEqual(["κ₁", "κ₂"]);
  // Help states what the engine does: θ′ and the critical angle only where
  // light is transmitted.
  const reflecting = surfaceProbeHelp(mirror, "light"),
    refracting = surfaceProbeHelp(glass, "light");
  expect(reflecting).toMatch(/X \+ R\/μ/);
  expect(reflecting).toMatch(/real focus ahead of the mirror where μ > 0/);
  expect(reflecting).toMatch(/negative for a virtual focus/);
  expect(reflecting).not.toMatch(/θ′|critical/);
  expect(refracting).toMatch(/θ′ the angle of transmission/);
  expect(refracting).toMatch(/beyond the critical angle/);
  expect(refracting).toMatch(/Move the probe along the interface/);
  expect(surfaceProbeHelp(mirror, "mirror")).toMatch(
    /^Describes the mirror at a point/,
  );
});

// A patch offset by d = 0.5: the same row as grid(), its points moved
// along n, with the fifth column folded.
function offsetGrid(): SpatialResult {
  const r = grid();
  const d = r.surfaceDiagnostics!;
  return {
    ...r,
    surfaceDiagnostics: {
      ...d,
      kind: "offset",
      distance: 0.5,
      folds: [[false, false, false, false, true]],
    },
  };
}
const patchStudy = (offset: number) => {
  const c = config("none", "surface");
  c.surface.offset = offset;
  return c;
};

test("a patch with an offset probes the patch or its offset, in their own words", () => {
  const offset = { ...defaultProbe, target: "offset" as const };
  const sheets = ["focal1", "focal2"];
  expect(probeSupport(patchStudy(0)).targets).toEqual(["surface", ...sheets]);
  expect(probeSupport(patchStudy(0.4)).targets).toEqual([
    "surface",
    "offset",
    ...sheets,
  ]);
  expect(probeSupport(patchStudy(-0.4)).targets).toEqual([
    "surface",
    "offset",
    ...sheets,
  ]);
  // A mirror reads its patch but not the offset.
  const mirror = rays();
  mirror.surface.offset = 0.4;
  expect(probeSupport(mirror).targets).toEqual(["light", "mirror"]);
  expect(probeTarget(mirror, offset)).toBe("light");
  // The offset is kept while the study has one, and falls back to the
  // patch once it has none.
  expect(probeTarget(patchStudy(0.4), offset)).toBe("offset");
  expect(probeTarget(patchStudy(0.4), defaultProbe)).toBe("surface");
  expect(probeTarget(patchStudy(0), offset)).toBe("surface");
  expect(probeTarget(config("canal"), offset)).toBe("curve");
  expect(gridded("offset")).toBe(true);
  expect(probeOptions("offset")).toEqual({ offsetDiagnostics: true });
  const c = patchStudy(0.4);
  expect(targetName(c, "surface")).toBe("The surface");
  expect(targetName(c, "offset")).toBe("The offset");
  expect(probeLegend(c, "offset")).toBe(
    "Probe the surface, its offset or its focal sheets",
  );
  expect(probeLegend(c, "surface")).toBe(
    "Probe the surface, its offset or its focal sheets",
  );
  expect(probeLegend(patchStudy(0), "surface")).toBe(
    "Probe the surface or its focal sheets",
  );
  expect(describeHelp(c)).toMatch(/^The surface: .* The offset: /);
  expect(describeHelp(patchStudy(0))).not.toMatch(/offset/);
  const own = surfaceTerms(c, "offset");
  expect(own.surface).toBe("offset surface");
  expect(own.switch).toBe("Principal curvatures & centres at a point");
  expect(own.branches).toEqual(["κ₁", "κ₂"]);
  expect(own.sliders).toEqual(["Along u", "Along v"]);
  expect(surfaceTerms(c, "surface").surface).toBe("surface");
  // Help states the engine's rule: curvatures κᵢ/(1 − dκᵢ) numbered as
  // the patch's, the patch's centers, the cuspidal edge and the fold.
  const help = surfaceProbeHelp(c, "offset");
  expect(help).toMatch(/^Describes the offset surface at a point/);
  expect(help).toMatch(/κᵢ\/\(1 − dκᵢ\)/);
  expect(help).toMatch(/focal sheet of the same number/);
  expect(help).toMatch(/cuspidal edge/);
  expect(help).toMatch(/folded/);
  expect(help).toMatch(/Move the probe along the offset surface/);
});

test("the offset's steps, records and drawing need its own diagnostics", () => {
  const r = offsetGrid(),
    c = patchStudy(0.5),
    offset = { ...defaultProbe, target: "offset" as const, across: 0 };
  expect(probeSteps(r, "offset")).toBe(0);
  expect(probeSteps(r, "surface")).toBeNull();
  expect(probeSteps(grid(), "offset")).toBeNull();
  expect(probeSteps(grid(), "surface")).toBe(0);
  expect(probeRecord(r, c, offset, 0)).toEqual({
    target: "offset",
    row: 0,
    column: 0,
    u: 0.25,
    v: 0,
  });
  expect(probeDrawing(r, c, offset, 0)).toEqual(surfaceProbeBatches(r, 0, 0));
  // The normal line runs on back to the patch's point, d behind the
  // offset's along n, and a cross marks it.
  const batches = surfaceProbeBatches(r, 0, 4),
    glyph = r.bounds.radius * 0.2;
  const normal = byInk(batches, probeInk.normal);
  expect(normal).toHaveLength(1);
  expect(length(sub(normal[0][0], at(0, 0, 0)))).toBeLessThan(f32);
  expect(length(sub(normal[0][1], at(1 + glyph, 0, 0)))).toBeLessThan(f32);
  const marks = byInk(batches, probeInk.mark);
  expect(marks).toHaveLength(6);
  for (const [center, arms] of [
    [at(1, 0, 0), marks.slice(0, 3)],
    [at(0.5, 0, 0), marks.slice(3)],
  ] as const)
    for (const [a, b] of arms)
      expect(
        length(
          sub(at((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2), center),
        ),
      ).toBeLessThan(f32);
  // Behind the farther center, the line reaches the patch's point.
  const behind = surfaceProbeBatches(
    {
      ...r,
      surfaceDiagnostics: { ...r.surfaceDiagnostics!, distance: 3 },
    },
    0,
    0,
  );
  expect(
    length(sub(byInk(behind, probeInk.normal)[0][0], at(-2, 0, 0))),
  ).toBeLessThan(f32);
  // A patch's own probe marks only its point.
  expect(byInk(surfaceProbeBatches(grid(), 0, 4), probeInk.mark)).toHaveLength(
    3,
  );
  // The readout says where the offset has folded.
  expect(surfaceProbeReadout(r, 0, 4)).toMatchObject({ folded: true });
  expect(surfaceProbeReadout(r, 0, 0)).toMatchObject({ folded: false });
  expect(surfaceProbeReadout(grid(), 0, 4)).toMatchObject({ folded: false });
});

// Focal sheet 1 of a patch, by hand: the row of grid() moved to the
// patch's first centers, with each point's foot, the patch's point X at
// (2, 0, 0), one patch radius out along the patch's normal x.
function focalGrid(sheet: 1 | 2 = 1): SpatialResult {
  const r = grid();
  const d = r.surfaceDiagnostics!;
  const foot = at(2, 0, 0);
  return {
    ...r,
    surfaceDiagnostics: {
      ...d,
      kind: "focal",
      sheet,
      feet: [[foot, null, foot, foot, foot]],
    },
  };
}

test("a patch probes its focal sheets, each in its own words", () => {
  const c = patchStudy(0),
    first = { ...defaultProbe, target: "focal1" as const },
    second = { ...defaultProbe, target: "focal2" as const };
  expect(probeTarget(c, first)).toBe("focal1");
  expect(probeTarget(c, second)).toBe("focal2");
  // Neither a curve study nor a mirror has focal sheets to probe.
  expect(probeTarget(config("canal"), second)).toBe("curve");
  expect(probeTarget(rays(), first)).toBe("light");
  expect(gridded("focal1")).toBe(true);
  expect(probeOptions("focal1")).toEqual({ focalDiagnostics: 1 });
  expect(probeOptions("focal2")).toEqual({ focalDiagnostics: 2 });
  expect(targetName(c, "focal1")).toBe("Focal sheet 1");
  expect(targetName(c, "focal2")).toBe("Focal sheet 2");
  expect(probeLegend(c, "focal2")).toBe(
    "Probe the surface or its focal sheets",
  );
  expect(describeHelp(c)).toMatch(/Focal sheet 1 or 2: /);
  for (const [target, name] of [
    ["focal1", "first focal sheet"],
    ["focal2", "second focal sheet"],
  ] as const) {
    const own = surfaceTerms(c, target);
    expect(own.surface).toBe(name);
    expect(own.branches).toEqual(["κ₁", "κ₂"]);
    expect(own.sliders).toEqual(["Along u", "Along v"]);
    expect(own.through).toBe("the patch's normal line");
    expect(own.singular).toBe(
      "Singular here: no tangent plane, as on a cuspidal edge.",
    );
    // Help states the engine's rule: the sheet's normal is the patch's
    // principal direction, oriented along u; curvatures need the third
    // derivatives; ridges give cuspidal edges, umbilics join the sheets,
    // and a zero curvature puts the sheet at infinity.
    const help = surfaceProbeHelp(c, target);
    expect(help).toMatch(new RegExp(`^Describes the ${name} at a point`));
    expect(help).toMatch(
      /principal direction eᵢ, oriented continuously along u/,
    );
    expect(help).toMatch(/third derivatives/);
    expect(help).toMatch(/ridge/);
    expect(help).toMatch(/cuspidal edge/);
    expect(help).toMatch(/umbilic/);
    expect(help).toMatch(/at infinity and has no point/);
    expect(help).toMatch(new RegExp(`Move the probe along the ${name}`));
  }
  // The patch and the offset keep their own status words.
  expect(surfaceTerms(c, "surface").singular).toBeUndefined();
  expect(surfaceTerms(patchStudy(0.4), "offset").singular).toBeUndefined();
});

test("a focal sheet's steps, records and drawing need its own diagnostics", () => {
  const r = focalGrid(),
    c = patchStudy(0),
    first = { ...defaultProbe, target: "focal1" as const, across: 0 };
  expect(probeSteps(r, "focal1")).toBe(0);
  // The other sheet's, the patch's or the offset's diagnostics do not do.
  expect(probeSteps(r, "focal2")).toBeNull();
  expect(probeSteps(focalGrid(2), "focal1")).toBeNull();
  expect(probeSteps(focalGrid(2), "focal2")).toBe(0);
  expect(probeSteps(r, "surface")).toBeNull();
  expect(probeSteps(r, "offset")).toBeNull();
  expect(probeSteps(grid(), "focal1")).toBeNull();
  expect(probeSteps(offsetGrid(), "focal1")).toBeNull();
  expect(probeRecord(r, c, first, 0)).toEqual({
    target: "focal1",
    row: 0,
    column: 0,
    u: 0.25,
    v: 0,
  });
  expect(probeDrawing(r, c, first, 0)).toEqual(surfaceProbeBatches(r, 0, 0));
  // Crosses mark the point and the patch's point, joined by the patch's
  // normal line, which touches the sheet there.
  const marks = byInk(surfaceProbeBatches(r, 0, 4), probeInk.mark);
  expect(marks).toHaveLength(7);
  for (const [center, arms] of [
    [at(1, 0, 0), marks.slice(0, 3)],
    [at(2, 0, 0), marks.slice(3, 6)],
  ] as const)
    for (const [a, b] of arms)
      expect(
        length(
          sub(at((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2), center),
        ),
      ).toBeLessThan(f32);
  expect(length(sub(marks[6][0], at(2, 0, 0)))).toBeLessThan(f32);
  expect(length(sub(marks[6][1], at(1, 0, 0)))).toBeLessThan(f32);
  // A singular point still shows where it lies and whose center it is.
  expect(byInk(surfaceProbeBatches(r, 0, 2), probeInk.mark)).toHaveLength(7);
  // The sheet's own normal line and circles are drawn as a patch's.
  expect(byInk(surfaceProbeBatches(r, 0, 4), probeInk.normal)).toEqual(
    byInk(surfaceProbeBatches(grid(), 0, 4), probeInk.normal),
  );
  expect(surfaceProbeReadout(r, 0, 2)).toMatchObject({ singular: true });
});

test("the light probe draws its rays, foci and wavefront circles", () => {
  const r = lit(),
    p = at(0, 0, 0);
  const at0 = surfaceProbeBatches(r, 0, 0);
  // The incident ray from ℓ back, and the outgoing ray from the virtual
  // focus behind the mirror to ℓ ahead, past the real focus.
  expect(byInk(at0, probeInk.normal)).toEqual([
    [at(0, 0, 1.5), p],
    [at(0, 0, -1), at(0, 0, 1.5)],
  ]);
  // Each wavefront circle passes through the point, centred on its focus,
  // in the plane of the ray and its direction.
  for (const [b, centre, radius, flat] of [
    [0, at(0, 0, 0.5), 0.5, "y"],
    [1, at(0, 0, -1), 1, "x"],
  ] as const) {
    const pairs = byInk(at0, surfaceInk[b]),
      ends = pairs.flat();
    expect(ends.length).toBeGreaterThan(200);
    // The focus is marked by a cross centred on it.
    expect(
      pairs.filter(([a, c]) =>
        close(at((a.x + c.x) / 2, (a.y + c.y) / 2, (a.z + c.z) / 2), centre),
      ).length,
    ).toBe(3);
    const ring = ends.filter(
      (q) => Math.abs(length(sub(q, centre)) - radius) < f32,
    );
    expect(ring.length).toBeGreaterThan(250);
    expect(ring.every((q) => Math.abs(q[flat]) < f32)).toBe(true);
    expect(ring.some((q) => close(q, p))).toBe(true);
  }
  // From a point source, the incident ray starts there.
  const lamp = { ...r, rays: { source: at(0, 2, 3) } } as SpatialResult;
  expect(byInk(surfaceProbeBatches(lamp, 0, 0), probeInk.normal)[0]).toEqual([
    at(0, 2, 3),
    p,
  ]);
  // Stigmatic: no direction, so no circle; the focus is marked.
  const one = surfaceProbeBatches(r, 0, 1);
  expect(byInk(one, surfaceInk[0]).length).toBe(3);
  // Totally reflected: the incident and reflected rays, nothing else.
  const total = surfaceProbeBatches(r, 0, 2),
    reflected = byInk(total, probeInk.normal);
  expect(reflected.length).toBe(2);
  expect(close(reflected[0][0], at(-1.2, 0, 0.9))).toBe(true);
  expect(close(reflected[1][1], at(1.2, 0, 0.9))).toBe(true);
  expect(
    total.filter((b) => b.ink !== probeInk.normal && b.ink !== probeInk.mark),
  ).toEqual([]);
  // Unlit: the incident ray only. Singular: the mark only.
  expect(byInk(surfaceProbeBatches(r, 0, 3), probeInk.normal)).toEqual([
    [at(0, 0, -1.5), p],
  ]);
  expect(surfaceProbeBatches(r, 0, 4).map((b) => b.ink)).toEqual([
    probeInk.mark,
  ]);
  // Transmitted, with a virtual focus 1/3 behind and the other at
  // infinity: the ray runs from that focus to ℓ ahead, and the circle at
  // infinity is not drawn, only its direction.
  const through = byInk(surfaceProbeBatches(r, 0, 5), probeInk.normal)[1];
  expect(close(through[0], at(0, 0, 1 / 3))).toBe(true);
  expect(close(through[1], at(0, 0, -1.5))).toBe(true);
  expect(byInk(surfaceProbeBatches(r, 0, 5), surfaceInk[1]).length).toBe(1);
});

test("the light readout gives foci, their interval, the angles and the state", () => {
  const r = lit(),
    read = (k: number) => lightProbeReadout(r, 0, k)!;
  expect(read(0)).toMatchObject({
    state: "traced",
    curvature: [2, -1],
    distance: [0.5, -1],
    virtual: [false, true],
    infinite: [false, false],
    stigmatic: false,
    interval: 1.5,
    theta: 0,
    // Reflected light leaves on the normal's side: no angle of transmission.
    thetaPrime: null,
  });
  expect(read(1)).toMatchObject({ stigmatic: true, interval: 0 });
  const total = read(2);
  expect(total.state).toBe("total");
  expect(total.theta).toBeCloseTo((Math.acos(0.6) * 180) / Math.PI, 12);
  expect(total.thetaPrime).toBeNull();
  expect(total.curvature).toEqual([null, null]);
  expect(read(3)).toMatchObject({ state: "unlit", theta: null });
  expect(read(4)).toMatchObject({ state: "singular", theta: null });
  expect(read(5)).toMatchObject({
    state: "traced",
    infinite: [false, true],
    virtual: [true, false],
    interval: null,
    theta: 0,
    thetaPrime: 0,
  });
  // Without the light's diagnostics there is no light readout.
  expect(lightProbeReadout(grid(), 0, 0)).toBeNull();
});

test("the light's steps and records need the light's diagnostics", () => {
  const r = lit(),
    c = rays(),
    light = { ...defaultProbe, target: "light" as const, across: 0 };
  expect(probeSteps(r, "light")).toBe(0);
  expect(probeSteps(r, "mirror")).toBeNull();
  expect(probeSteps(grid(), "light")).toBeNull();
  expect(probeSteps(grid(), "mirror")).toBe(0);
  expect(probeRecord(r, c, light, 0)).toEqual({
    target: "light",
    row: 0,
    column: 0,
    u: 0.25,
    v: 0,
  });
  expect(probeDrawing(r, c, light, 0)).toEqual(surfaceProbeBatches(r, 0, 0));
});

// The spherical bowl: radius R = 1.5 with its inward normal, under light
// straight down. Row 48 of 96 and column 24 of 48 is v = −11π/36, where
// the angle of incidence is θ = 35°, and Coddington's equations give the
// reflected wavefront μ_t = 2/(R cos θ) and μ_s = 2 cos θ/R.
const lightSwitch = (page: Page) =>
  page.getByRole("checkbox", { name: "Wavefront, foci & rays at a point" });
const bowl = { label: "A spherical bowl's cusped caustic" };
function coddington(theta: number) {
  const R = 1.5,
    cos = Math.cos((theta * Math.PI) / 180);
  const mu = [2 / (R * cos), (2 * cos) / R];
  return [
    short(mu[0]),
    short(mu[1]),
    `${short(1 / mu[0])}, ${short(1 / mu[1])}`,
    short(1 / mu[1] - 1 / mu[0]),
    `${short(theta)}°`,
  ];
}

test("a spherical bowl's light reads Coddington's foci; its mirror is umbilic", async ({
  page,
  browser,
}) => {
  await ready(page);
  await choosePreset(page, bowl);
  await settled(page);
  const original = await pixels(page);
  await expect(page.locator(".spatial-probe legend")).toHaveText(
    "Probe the light or mirror",
  );
  await expect(describe(page)).toHaveValue("light");
  await lightSwitch(page).check();
  await settled(page);
  await expect(along(page, "Along u")).toHaveAttribute(
    "aria-valuetext",
    "u = 4.712, row 48 of 96",
  );
  await expect(along(page, "Along v")).toHaveAttribute(
    "aria-valuetext",
    "v = -0.9599, column 24 of 48",
  );
  await expect(readout(page)).toHaveText(coddington(35));
  await expect(page.getByTestId("probe-status")).toHaveText("");
  // The bowl is a surface of revolution under axial light, and u turns
  // around its axis: along u nothing changes, and the plots say so.
  const [mu1, mu2] = coddington(35);
  await expect(page.locator(".probe-plot figcaption")).toHaveText([
    `μ₁ along u: constant at ${mu1}`,
    `μ₂ along u: constant at ${mu2}`,
  ]);
  expect(await pixels(page)).not.toBe(original);
  // Nearer the rim, column 40: v = −π/2 + 35π/108, θ = 58.33°.
  await along(page, "Along v").fill("40");
  await expect(readout(page)).toHaveText(coddington(175 / 3));
  // The lowest point is the chart's pole: singular.
  await along(page, "Along v").fill("0");
  await expect(page.getByTestId("probe-status")).toHaveText(
    "Singular here: the mirror has no normal, so no ray leaves.",
  );
  await expect(readout(page)).toHaveText(["—", "—", "—", "—", "—"]);
  await expect(page.locator(".probe-notes")).toHaveText(
    "97 points are singular, without a normal.",
  );
  await along(page, "Along v").fill("24");
  // The mirror itself: a sphere seen from inside, κ = 1/R everywhere.
  await describe(page).selectOption("mirror");
  await settled(page);
  await expect(surfaceSwitch(page)).toBeChecked();
  await expect(readout(page)).toHaveText([
    "0.6667",
    "0.6667",
    "1.5, 1.5",
    "0.4444, 0.6667",
  ]);
  await expect(page.getByTestId("probe-status")).toHaveText(
    "An umbilic: every direction is principal, so none is drawn.",
  );
  await describe(page).selectOption("light");
  await settled(page);
  await expect(readout(page)).toHaveText(coddington(35));
  // A still export records the light probe.
  await page.getByRole("button", { name: "Export image", exact: true }).click();
  const event = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Lines (SVG) · every line", exact: true })
    .click();
  const svg = (await readFile((await (await event).path())!)).toString();
  const meta = JSON.parse(
    svg
      .match(/<desc>(.*?)<\/desc>/)![1]
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&amp;", "&"),
  );
  expect(meta.probe).toMatchObject({ target: "light", row: 48, column: 24 });
  // The link names the light, though the probe was never told to describe
  // it, and reopens the same point.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const other = await context.newPage();
  await other.goto(link);
  await settled(other);
  await expect(describe(other)).toHaveValue("light");
  await expect(lightSwitch(other)).toBeChecked();
  await expect(readout(other)).toHaveText(coddington(35));
  await context.close();
  await lightSwitch(page).uncheck();
  await settled(page);
  expect(await pixels(page)).toBe(original);
});

// A lamp 1 above still water (n₁ = 1.33) over air: the plane z = 0, on a
// 96 × 96 grid over [−1.8, 1.8]². Straight below the lamp the light is
// stigmatic, imaged virtually at n₂/n₁ of its height; beyond tan θ = 1.8 ·
// sin θ_c = 1/1.33 it is totally reflected. Off axis the plane's
// closed form gives μ = −n₁cos²θ/(n₂ s cos²θ′) across and −n₁/(n₂ s) around,
// with s the distance from the lamp.
test("a lamp under water reads its virtual foci, Snell's angles and the critical angle", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, { label: "A lamp in water over air" });
  await settled(page);
  await expect(page.locator(".spatial-probe legend")).toHaveText(
    "Probe the light or interface",
  );
  await lightSwitch(page).check();
  await settled(page);
  const image = short(-1 / 1.33);
  await expect(readout(page)).toHaveText([
    short(-1.33),
    short(-1.33),
    `${image}, ${image}`,
    "0",
    "0°, 0°",
  ]);
  await expect(page.getByTestId("probe-status")).toHaveText(
    "Stigmatic: both foci coincide, so no direction is drawn.",
  );
  // Column 60 is y = 0.45.
  await along(page, "Along v").fill("60");
  const s = Math.hypot(1, 0.45),
    sin1 = 0.45 / s,
    sin2 = 1.33 * sin1,
    cos1 = 1 / s,
    cos2 = Math.sqrt(1 - sin2 * sin2);
  const mu = [-(1.33 * cos1 * cos1) / (s * cos2 * cos2), -1.33 / s].sort(
    (a, b) => b - a,
  );
  const degrees = (x: number) => (x * 180) / Math.PI;
  await expect(readout(page)).toHaveText([
    short(mu[0]),
    short(mu[1]),
    `${short(1 / mu[0])}, ${short(1 / mu[1])}`,
    short(Math.abs(1 / mu[0] - 1 / mu[1])),
    `${short(degrees(Math.asin(sin1)))}°, ${short(degrees(Math.asin(sin2)))}°`,
  ]);
  // The edge, y = 1.8, is beyond the critical angle.
  await along(page, "Along v").fill("96");
  await expect(page.getByTestId("probe-status")).toHaveText(
    "Beyond the critical angle: the light is totally reflected, and nothing is transmitted.",
  );
  await expect(readout(page)).toHaveText([
    "—",
    "—",
    "—",
    "—",
    `${short(degrees(Math.atan(1.8)))}°, —`,
  ]);
  await expect(page.locator(".probe-notes")).toContainText(
    "beyond the critical angle",
  );
});

test("the light probe moves along the mirror as an animation and returns on Stop", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, bowl);
  await settled(page);
  await lightSwitch(page).check();
  await settled(page);
  await along(page, "Along v").fill("40");
  const study = await pixels(page);
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
  const mode = page.getByLabel("Animate", { exact: true });
  await expect(mode.locator('option[value="probe"]')).toHaveText(
    "Move the probe along the mirror",
  );
  await mode.selectOption("probe");
  await page.getByLabel("Duration (seconds)").fill("5");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(stage(page)).toHaveAttribute("data-mode", "probe");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const seek = async (p: string) => {
    await page.getByRole("slider", { name: "Animation progress" }).fill(p);
    await expect(stage(page)).toHaveAttribute("data-progress", p);
  };
  await expect(describe(page)).toBeDisabled();
  await seek("0");
  await expect(along(page, "Along u")).toHaveAttribute(
    "aria-valuetext",
    "u = 3.142, row 0 of 96",
  );
  // The bowl is a surface of revolution under axial light: every row reads
  // the same at its column.
  await expect(readout(page)).toHaveText(coddington(175 / 3));
  await seek("1");
  await expect(along(page, "Along u")).toHaveAttribute(
    "aria-valuetext",
    "u = 6.283, row 96 of 96",
  );
  await expect(readout(page)).toHaveText(coddington(175 / 3));
  await seek("0.25");
  await expect(along(page, "Along u")).toHaveAttribute(
    "aria-valuetext",
    "u = 3.927, row 24 of 96",
  );
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(stage(page)).not.toHaveAttribute("data-progress");
  await expect(along(page, "Along u")).toHaveAttribute(
    "aria-valuetext",
    "u = 4.712, row 48 of 96",
  );
  expect(await pixels(page)).toBe(study);
});

// A canal's rows are its mesh rings, every other base sample on the beads:
// row 250 is base sample 500, at t = −2π + 250π/120. A reveal draws the
// surface probe once it has drawn that sample, not that row's number.
test("a reveal draws a canal's surface probe once it reaches the probe's row", async ({
  page,
}) => {
  await probeBeads(page);
  const row = along(page, "Along t");
  await row.fill("250");
  const mine = `t = ${short(-2 * Math.PI + (250 * Math.PI) / 120)}, row 250 of 480`;
  await expect(row).toHaveAttribute("aria-valuetext", mine);
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
  await page.getByLabel("Animate", { exact: true }).selectOption("reveal");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Animation progress" });
  // Through sample 480 of 960: row 250 is not drawn yet.
  await slider.fill("0.5");
  await expect(stage(page)).toHaveAttribute("data-progress", "0.5");
  await expect(page.locator(".spatial-probe")).toContainText(
    "The drawing has not reached the probe yet.",
  );
  await expect(readout(page)).toHaveCount(0);
  // Through sample 508: it is.
  await slider.fill("0.53");
  await expect(stage(page)).toHaveAttribute("data-progress", "0.53");
  await expect(row).toHaveAttribute("aria-valuetext", mine);
  await expect(row).toBeDisabled();
  await expect(readout(page)).toHaveText(
    beadReadout(-2 * Math.PI + (250 * Math.PI) / 120),
  );
});
