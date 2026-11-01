import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { choosePreset, open as openDetails } from "./helpers";
import { decodeVideo, frameDifference, probe } from "./video";
import { engines, watchEngines } from "./engines";
import { probeDrawing, probeInk } from "../web/spatial/probe";
import { spatialPresets } from "../web/spatial/presets";
import type { Batch } from "../web/spatial/scene";
import type {
  SpatialConfig,
  SpatialResult,
  SurfaceDiagnostics,
  Vec3,
} from "../web/spatial/types";

// The helicoid–catenoid associated family through the real controls,
// worker and engine: its preset, the angle control, what the family does
// not offer, choosing it from an edited study, playback and its exports.
// Expected curvatures follow from κ = ±1/(s cosh²v), not from the code.
const staircase = { label: "A staircase becoming a throat" };
const stage = (page: Page) => page.locator(".spatial-stage");
const settled = (page: Page) =>
  expect(stage(page)).toHaveAttribute("aria-busy", "false");
async function ready(page: Page) {
  await page.goto("/?study=3d");
  await expect(page.locator("#spatial-artwork")).toBeVisible();
  await settled(page);
}
async function config(page: Page): Promise<SpatialConfig> {
  return JSON.parse((await stage(page).getAttribute("data-config"))!);
}
const field = (page: Page, name: string) =>
  page.getByRole("textbox", { name, exact: true });
const checkbox = (page: Page, name: string) =>
  page.getByRole("checkbox", { name, exact: true });
const surface = (page: Page) => page.getByLabel("Surface", { exact: true });
const readout = (page: Page) => page.locator(".probe-readout dd");
const pixels = (page: Page) =>
  page
    .locator("#spatial-artwork")
    .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
const short = (v: number) => String(Number(v.toPrecision(4)));
// The readout at v for scale s: κ₁, κ₂, the radii, and K, H.
const minimal = (s: number, v: number) => {
  const k = 1 / (s * Math.cosh(v) ** 2);
  return [
    short(k),
    short(-k),
    `${short(1 / k)}, ${short(-1 / k)}`,
    `${short(-k * k)}, 0`,
  ];
};
async function openAnimation(page: Page) {
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
}
// Turns the probe on, at u = 0 (row 48 of 96) and column 34 of the
// staircase's 48, v = −1.2 + 2.4·34/48 = 0.5.
async function probeAt(page: Page) {
  await page
    .getByRole("checkbox", {
      name: "Principal curvatures & centers at a point",
    })
    .check();
  await settled(page);
  await page.getByRole("slider", { name: "Along v", exact: true }).fill("34");
  await settled(page);
}
const layers = (page: Page) =>
  page
    .locator(".spatial-layers label")
    .evaluateAll((ls) => ls.map((l) => l.textContent!.trim()));

test("the staircase opens a helicoid whose angle bends it into a catenoid with unchanged curvature readouts", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, staircase);
  await settled(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "A minimal surface bent, not stretched",
  );
  const preset = spatialPresets.find((p) => p.name === staircase.label)!;
  expect((await config(page)).surface).toEqual(preset.config.surface);
  await expect(surface(page)).toHaveValue("helicoid-catenoid");
  // What the family does not offer has no control, layer, legend entry or
  // probe target.
  await expect(field(page, "Normal reach ℓ")).toBeVisible();
  await expect(field(page, "Offset d")).toHaveCount(0);
  await expect(checkbox(page, "Locate ridges")).toHaveCount(0);
  await expect(page.getByLabel("Describe", { exact: true })).toHaveCount(0);
  expect(await layers(page)).toEqual([
    "Surface patch",
    "Parameter curves",
    "Normal lines",
  ]);
  await expect(page.locator(".legend")).toHaveText(/^Surface/);
  await expect(page.locator(".legend")).not.toContainText("Focal");
  await expect(page.getByTestId("surface-note")).toHaveCount(0);
  // The preset opens without the probe; on at (0, 0.5) it reads
  // κ = ±1/cosh²(0.5) and H = 0.
  await expect(readout(page)).toHaveCount(0);
  await probeAt(page);
  await expect(readout(page)).toHaveText(minimal(1, 0.5));
  const helicoid = await pixels(page);
  // The same readout at every angle: the family shares its curvature.
  for (const [text, theta] of [
    ["pi/2", Math.PI / 2],
    ["0.6", 0.6],
  ] as const) {
    await field(page, "Associate angle θ").fill(text);
    await settled(page);
    expect((await config(page)).surface.b).toBe(theta);
    await expect(readout(page)).toHaveText(minimal(1, 0.5));
  }
  expect(await pixels(page)).not.toBe(helicoid);
  // Between samples, Go's crossing curves arrive through the worker: at
  // the preset's grid sample they draw what the grid's row and column do,
  // and the probe without them draws less.
  const snapped = await pixels(page);
  const between = checkbox(page, "At any u and v, between samples");
  await between.check();
  await settled(page);
  await expect(page.locator(".probe-readout dd").first()).toHaveText(
    minimal(1, 0.5)[0],
  );
  expect(await pixels(page)).toBe(snapped);
  await between.uncheck();
  await settled(page);
  // The scale divides the curvature.
  await field(page, "Scale s").fill("2.5");
  await settled(page);
  await expect(readout(page)).toHaveText(minimal(2.5, 0.5));
  // Reversing the normal swaps the branches' signs, so the readout is the
  // same set.
  await page.getByLabel("Normal", { exact: true }).selectOption("reverse");
  await settled(page);
  await expect(readout(page)).toHaveText(minimal(2.5, 0.5));
});

test("the angle and domain refuse values beyond the family's limits under their own controls", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, staircase);
  await settled(page);
  await probeAt(page);
  const alert = page.getByRole("alert");
  for (const [name, text, message] of [
    [
      "Associate angle θ",
      "pi/2+0.001",
      "the associate angle θ must be within 0–π/2",
    ],
    ["Associate angle θ", "-0.1", "the associate angle θ must be within 0–π/2"],
    [
      "Scale s",
      "0",
      "the scale s must be finite, positive, and at most 100000",
    ],
    [
      "u to",
      "4*pi+0.01",
      "u domain: the start must be below the end, within ±4π, at least 0.000001 wide",
    ],
    [
      "v from",
      "-4.5",
      "v domain: the start must be below the end, within ±4, at least 0.000001 wide",
    ],
  ] as const) {
    const before = (await config(page)).surface;
    await field(page, name).fill(text);
    await expect(alert).toHaveText(message);
    // The error stands under its own control.
    await expect(
      page
        .locator(".field")
        .filter({ has: field(page, name) })
        .getByRole("alert"),
    ).toHaveCount(1);
    await field(page, name).fill(String(before[keyOf(name)]));
    await expect(alert).toHaveCount(0);
    await settled(page);
  }
  // The extreme admitted values draw.
  await field(page, "u from").fill("-4*pi");
  await field(page, "u to").fill("4*pi");
  await field(page, "v from").fill("-4");
  await field(page, "v to").fill("4");
  await field(page, "Scale s").fill("100000");
  await settled(page);
  await expect(alert).toHaveCount(0);
  // The probe keeps its place, column 34 of 48: v = −4 + 8·34/48.
  await expect(readout(page)).toHaveText(minimal(1e5, -4 + (8 * 34) / 48));
});
function keyOf(name: string): keyof SpatialConfig["surface"] {
  return (
    {
      "Associate angle θ": "b",
      "Scale s": "a",
      "u to": "uMax",
      "v from": "vMin",
    } as const
  )[name as "Scale s"];
}

test("choosing the family from an edited torus drops what it does not offer, and lighting it starts from a mirror", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, { label: "A torus revealing its centers" });
  await settled(page);
  await field(page, "Offset d").fill("0.3");
  await settled(page);
  await checkbox(page, "Locate ridges").check();
  await checkbox(page, "Locate cuspidal edges").check();
  await settled(page);
  // The probe on a focal sheet, and the offset animated.
  const probeSwitch = page.getByRole("checkbox", {
    name: "Principal curvatures & centers at a point",
  });
  if (!(await probeSwitch.isChecked())) await probeSwitch.check();
  await page.getByLabel("Describe", { exact: true }).selectOption("focal1");
  await settled(page);
  await openAnimation(page);
  await page.getByLabel("Animate", { exact: true }).selectOption("parameters");
  await page
    .getByLabel("Parameter 1", { exact: true })
    .selectOption("surfaceOffset");
  await surface(page).selectOption("helicoid-catenoid");
  await settled(page);
  const s = (await config(page)).surface;
  expect(s).toMatchObject({
    kind: "helicoid-catenoid",
    a: 1,
    b: 0,
    uMin: -Math.PI,
    uMax: Math.PI,
    vMin: -1.5,
    vMax: 1.5,
    offset: 0,
  });
  expect(s.edges).toBeUndefined();
  expect(s.ridges).toBeUndefined();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "A minimal surface bent, not stretched",
  );
  // The probe describes the surface, honestly labeled, and no animation
  // target names the offset.
  await expect(page.getByLabel("Describe", { exact: true })).toHaveCount(0);
  await expect(page.locator(".spatial-probe legend")).toHaveText(
    "Probe the surface",
  );
  await expect(readout(page).nth(3)).toHaveText(/, 0$/);
  const targets = await page
    .getByLabel("Parameter 1", { exact: true })
    .locator("option")
    .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  expect(targets).not.toContain("surfaceOffset");
  expect(targets).toContain("surfaceB");
  // A mirror or interface starts from the first surface that can be lit.
  await page
    .getByLabel("Spatial definition", { exact: true })
    .selectOption("rays");
  await settled(page);
  expect((await config(page)).surface.kind).toBe("ellipsoid");
  await expect(page.getByRole("alert")).toHaveCount(0);
  const offeredLit = await surface(page)
    .locator("option")
    .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  expect(offeredLit).not.toContain("helicoid-catenoid");
  // Back on a surface patch, the family is offered again, with its
  // controls and none of the others'.
  await page
    .getByLabel("Spatial definition", { exact: true })
    .selectOption("surface");
  await surface(page).selectOption("helicoid-catenoid");
  await settled(page);
  await expect(field(page, "Offset d")).toHaveCount(0);
  await surface(page).selectOption("torus");
  await settled(page);
  await expect(field(page, "Offset d")).toBeVisible();
  await expect(checkbox(page, "Locate ridges")).not.toBeChecked();
});

// Seeks forward and backward draw the same frames, the held view never
// moves, and the endpoints are the declared helicoid and catenoid.
test("playback seeks agree in both directions and hold the opening view", async ({
  page,
}) => {
  test.slow();
  await ready(page);
  await choosePreset(page, staircase);
  await settled(page);
  await probeAt(page);
  const opening = JSON.parse((await stage(page).getAttribute("data-opening"))!);
  let camera: string | null = null;
  await openAnimation(page);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Animation progress" });
  const seen: Record<string, string> = {};
  // The slider is the timeline: out and back, so its middle is the far
  // end, θ = π/2, and its ends are the helicoid.
  const far: Record<string, string> = { "0": "0", "0.25": "0.5", "0.5": "1" };
  for (const t of ["0.5", "0", "0.25", "0.5", "0.25", "0"]) {
    await slider.fill(t);
    await expect(stage(page)).toHaveAttribute("data-time", t);
    await expect
      .poll(async () => Number(await stage(page).getAttribute("data-progress")))
      .toBeCloseTo(Number(far[t]), 12);
    await settled(page);
    // Every frame keeps the opening view, about one center and radius.
    const held = await stage(page).getAttribute("data-camera");
    camera ??= held;
    expect(held).toBe(camera);
    expect(JSON.parse(held!)).toMatchObject(opening);
    const drawn = await pixels(page);
    if (t in seen) expect(drawn).toBe(seen[t]);
    seen[t] = drawn;
    // The probe stays on the same point, with the family's readout.
    await expect(readout(page)).toHaveText(minimal(1, 0.5));
  }
  expect(new Set(Object.values(seen)).size).toBe(3);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await settled(page);
  // Stopping returns to the opening helicoid.
  expect((await config(page)).surface.b).toBe(0);
  expect(await pixels(page)).toBe(seen["0"]);
});

// Frames of the angle still calculating when playback stops are dropped:
// with every calculation reaching the worker late, Stop leaves the opening
// helicoid drawn, and no reply drawn after it.
test("a frame still calculating when playback stops never lands", async ({
  page,
}) => {
  test.slow();
  await watchEngines(page, 2, { spatial: 700 });
  await ready(page);
  await choosePreset(page, staircase);
  await settled(page);
  const opening = await pixels(page);
  const sent = async () =>
    (await engines(page)).reduce((n, e) => n + (e.sent.spatial ?? 0), 0);
  const before = await sent();
  await openAnimation(page);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  // Wait until frames are in flight past the first, then stop.
  await expect.poll(sent).toBeGreaterThan(before + 2);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  // Every delayed request has reached the worker and been answered.
  await page.waitForTimeout(2500);
  await settled(page);
  await expect(stage(page)).not.toHaveAttribute("data-progress", /./);
  expect((await config(page)).surface.b).toBe(0);
  expect(await pixels(page)).toBe(opening);
});

async function still(page: Page) {
  await page.getByRole("button", { name: "Export image", exact: true }).click();
  const event = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /^PNG image/ }).click();
  return readFile((await (await event).path())!);
}
async function rgba(page: Page, png: Buffer) {
  const data = await page.evaluate(async (input) => {
    const image = new Image();
    image.src = `data:image/png;base64,${input}`;
    await image.decode();
    const c = document.createElement("canvas");
    c.width = image.width;
    c.height = image.height;
    const g = c.getContext("2d")!;
    g.drawImage(image, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let text = "";
    for (let i = 0; i < d.length; i += 0x8000)
      text += String.fromCharCode(...d.subarray(i, i + 0x8000));
    return { text: btoa(text), width: image.width, height: image.height };
  }, png.toString("base64"));
  return { ...data, pixels: Buffer.from(data.text, "base64") };
}

// The grid alone shows the correspondence: its film decodes at its
// duration and target size, and its ends match stills seeked to them.
test("the grid-only film decodes at its size and agrees with seeked stills", async ({
  page,
}) => {
  test.slow();
  await ready(page);
  await choosePreset(page, staircase);
  await settled(page);
  await checkbox(page, "Surface patch").uncheck();
  await settled(page);
  await openAnimation(page);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Animation progress" });
  // Stills at the far end (the timeline's middle) and the start, drawn at
  // twice the view's size, as the film is below.
  const stills: Record<string, Buffer> = {};
  for (const [t, p] of [
    ["0.5", "1"],
    ["0", "0"],
  ]) {
    await slider.fill(t);
    await expect(stage(page)).toHaveAttribute("data-progress", p);
    await settled(page);
    const image = await rgba(page, await still(page));
    expect([image.width, image.height]).toEqual([2000, 1520]);
    stills[p] = image.pixels;
  }
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await settled(page);
  // The stopped study is the opening helicoid, drawn at the same size.
  expect((await rgba(page, await still(page))).pixels.equals(stills["0"])).toBe(
    true,
  );
  await page.getByLabel("Duration (seconds)").fill("0.4");
  await openDetails(page, "#spatial-export-settings");
  await page.getByLabel("Export format", { exact: true }).selectOption("mp4");
  await page.getByLabel("Export frame rate").selectOption("15");
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("2");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export MP4/ }).click();
  const path = (await (await download).path())!;
  const data = probe(path);
  if (data) {
    expect(data.frames).toBe(6);
    expect([data.width, data.height]).toEqual([2000, 1520]);
  }
  const video = await decodeVideo(page, await readFile(path));
  expect(video.duration).toBeCloseTo(0.4, 3);
  expect(video.first.hash).not.toBe(video.last.hash);
  const match = (index: number, reference: Buffer) =>
    frameDifference(path, 2000, 1520, index, reference);
  // Back and forth over 0.4 s: frame 0 is θ = 0 and frame 3, half way
  // through the time, is the far end θ = π/2.
  const same = [match(0, stills["0"]), match(3, stills["1"])];
  const swapped = [match(0, stills["1"]), match(3, stills["0"])];
  if (same.every(Boolean) && swapped.every(Boolean)) {
    console.log("Grid-only film frames", { same, swapped });
    // The grid's sparse lines leave most of the frame blank, so the ink
    // tells them apart: matching frames measured 1.1–1.3 levels apart
    // with under 0.1% of their ink unmatched, and swapped ends 5.7 levels
    // with about 80% unmatched.
    for (const d of same) {
      expect(d!.meanDifference).toBeLessThan(4);
      expect(d!.unmatchedInk).toBeLessThan(0.02);
    }
    for (const d of swapped) expect(d!.unmatchedInk).toBeGreaterThan(0.5);
  }
});

// The probe's correspondence: on the family it draws the u- and v-curves
// through its point, from the grid at a sample and from Go's crossing
// between samples; on another patch it draws neither.
test("the family's probe draws the parameter curves through its point", () => {
  const p = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
  // A 3 × 3 grid of points, one row a u sample and one column a v sample.
  const points = [0, 1, 2].map((i) => [0, 1, 2].map((j) => p(i, j, i * j)));
  const n = p(0, 0, 1);
  const grid = (d: Partial<SurfaceDiagnostics>): SurfaceDiagnostics => ({
    kind: "patch",
    along: [0, 1, 2],
    u: [0, 1, 2],
    v: [0, 1, 2],
    periodic: false,
    points,
    normals: points.map((r) => r.map(() => n)),
    curvature: [0, 1].map(() => points.map((r) => r.map(() => 0.5))) as [
      (number | null)[][],
      (number | null)[][],
    ],
    direction: [p(1, 0, 0), p(0, 1, 0)].map((e) =>
      points.map((r) => r.map(() => e)),
    ) as [(Vec3 | null)[][], (Vec3 | null)[][]],
    focal: [0, 1].map(() => points.map((r) => r.map(() => null))) as [
      (Vec3 | null)[][],
      (Vec3 | null)[][],
    ],
    singular: 0,
    umbilics: 0,
    unknown: 0,
    clipped: [0, 0],
    ...d,
  });
  const result = (d: SurfaceDiagnostics) =>
    ({
      bounds: { center: p(1, 1, 1), radius: 2 },
      surfaceDiagnostics: d,
    }) as unknown as SpatialResult;
  const family = structuredClone(
    spatialPresets.find((q) => q.name === staircase.label)!.config,
  );
  const ellipsoid: SpatialConfig = {
    ...family,
    surface: { ...family.surface, kind: "ellipsoid", a: 1, b: 1, c: 1 },
  };
  const probe = {
    enabled: true,
    position: 0.5,
    target: "surface" as const,
    across: 0.5,
  };
  // Mark segments at the probe's point (1, 1) beyond its own cross.
  const marks = (c: SpatialConfig, r: SpatialResult, at: number) =>
    probeDrawing(r, c, probe, at)
      .filter((b: Batch) => b.ink === probeInk.mark)
      .reduce((total, b) => total + b.data.length / 14, 0);
  const cross = marks(ellipsoid, result(grid({})), 1);
  expect(cross).toBe(3);
  // Row 1 and column 1 each add two segments.
  expect(marks(family, result(grid({})), 1)).toBe(cross + 4);
  // Between samples, Go's crossing is drawn, not the grid's.
  const one = grid({
    along: [1],
    u: [1.5],
    v: [0.5],
    points: [[p(1.5, 0.5, 0.75)]],
    normals: [[n]],
    curvature: [[[0.5]], [[-0.5]]],
    direction: [[[p(1, 0, 0)]], [[p(0, 1, 0)]]],
    focal: [[[null]], [[null]]],
    crossing: [
      [p(0, 0.5, 0), p(1, 0.5, 0.5), p(2, 0.5, 1), p(3, 0.5, 1.5)],
      [p(1.5, 0, 0), p(1.5, 1, 1.5)],
    ],
  });
  const at = { grid: one, u: 1.5, v: 0.5 };
  expect(
    probeDrawing(result(grid({})), family, probe, at as never)
      .filter((b: Batch) => b.ink === probeInk.mark)
      .reduce((total, b) => total + b.data.length / 14, 0),
  ).toBe(cross + 3 + 1);
  expect(
    probeDrawing(result(grid({})), ellipsoid, probe, at as never)
      .filter((b: Batch) => b.ink === probeInk.mark)
      .reduce((total, b) => total + b.data.length / 14, 0),
  ).toBe(cross);
});
