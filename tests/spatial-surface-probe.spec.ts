import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { choosePreset } from "./helpers";
import {
  defaultProbe,
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
  surfaceProbeReadout,
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

test("the probe describes a patch's surface, a canal's curve or surface, and other curves", () => {
  expect(probeSupport(config("none", "surface")).targets).toEqual(["surface"]);
  expect(probeSupport(config("none", "surface")).available).toBe(true);
  expect(probeSupport(config("canal")).targets).toEqual(["curve", "surface"]);
  expect(probeSupport(config("canal", "field")).targets).toEqual([
    "curve",
    "surface",
  ]);
  for (const c of ["developable", "framed", "ruled", "none"] as const)
    expect(probeSupport(config(c)).targets).toEqual(["curve"]);
  for (const f of ["rays", "implicit"] as const)
    expect(probeSupport(config("canal", f)).available).toBe(false);
  // A target the study lacks falls back to its first.
  const surface = { ...defaultProbe, target: "surface" as const };
  expect(probeTarget(config("canal"), surface)).toBe("surface");
  expect(probeTarget(config("developable"), surface)).toBe("curve");
  expect(probeTarget(config("none", "surface"), defaultProbe)).toBe("surface");
  // A straight canal spine points to the surface probe.
  expect(straightNote(config("canal"))).toMatch(
    /Choose to describe the surface to probe the canal surface itself\.$/,
  );
  expect(straightNote(config("ruled"))).not.toMatch(/Choose/);
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
  await expect(describe(page)).toHaveCount(0);
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
