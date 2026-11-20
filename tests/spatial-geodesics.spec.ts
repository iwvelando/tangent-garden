import { readout as formatNumber } from "../web/number-format";
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  chooseColorScheme,
  choosePreset,
  open as openDetails,
} from "./helpers";
import { decodeVideo, frameDifference, probe } from "./video";
import { geodesicDefaults } from "../web/spatial/geodesics";
import { revealGeodesics } from "../web/spatial/geodesic-path";
import { spatialPresets } from "../web/spatial/presets";
import type { GeodesicResult, Vec3 } from "../web/spatial/types";

// Geodesic threads on every kind that carries them, through the real
// controls, worker and engine: their presets, launching them on an edited
// surface, refusals and unavailable surfaces, the arc-length reveal, links
// and the linework and movie exports.
const stage = (page: Page) => page.locator(".spatial-stage");
const field = (page: Page, name: string) =>
  page.getByRole("textbox", { name, exact: true });
const count = (page: Page, name: string) =>
  page.getByRole("spinbutton", { name, exact: true });
const layer = (page: Page, name: string) =>
  page.getByRole("checkbox", { name, exact: true });
const launch = (page: Page) => layer(page, "Launch geodesic threads");
const note = (page: Page) => page.getByTestId("geodesics-note");
const selected = (page: Page) => page.getByTestId("selected-thread");
const unavailable = (page: Page) => page.getByTestId("geodesics-unavailable");
async function ready(page: Page) {
  await page.goto("/?study=3d");
  await expect(page.locator("#spatial-artwork")).toBeVisible();
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
}
const settled = (page: Page) =>
  expect(stage(page)).toHaveAttribute("aria-busy", "false");
async function config(page: Page) {
  return JSON.parse((await stage(page).getAttribute("data-config"))!);
}
const pixels = (page: Page) =>
  page
    .locator("#spatial-artwork")
    .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
async function openAnimation(page: Page) {
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
}
const every = "Lines (SVG) · every line";
async function lines(page: Page) {
  await page.getByRole("button", { name: "Export image", exact: true }).click();
  const event = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: every, exact: true }).click();
  const svg = (await readFile((await (await event).path())!)).toString();
  // Each group's vertex count, by its layer.
  const groups: Record<string, number> = {};
  for (const m of svg.matchAll(/<g id="([a-z0-9-]+)"[^>]*>(.*?)<\/g>/gs))
    groups[m[1]] = (groups[m[1]] ?? 0) + [...m[2].matchAll(/[ML]-?\d/g)].length;
  return groups;
}
const torusThreads = { label: "Threads finding their way around a torus" };

test("the torus preset draws its fan, its selected thread and their notes", async ({
  page,
}) => {
  // Dense linework exports and canvas reads on CI's software WebGL took
  // 22–30 s on one runner and over 60 s on a runner half as fast.
  test.slow();
  await ready(page);
  await choosePreset(page, torusThreads);
  await settled(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Threads that go straight on a surface",
  );
  await expect(launch(page)).toBeChecked();
  expect((await config(page)).surface.geodesics).toEqual(
    spatialPresets.find((p) => p.name === torusThreads.label)!.config.surface
      .geodesics,
  );
  await expect(note(page)).toContainText(
    "16 threads on the torus, each 60 long, integrated in",
  );
  await expect(note(page)).toContainText(
    "Threads shade from teal to gold in fan order; the selected thread is drawn broad.",
  );
  // The selected thread, at 65 − 30/32 degrees, keeps ρ cos ψ = 2.8 cos β.
  const beta = 65 - 30 / 32;
  await expect(selected(page)).toContainText(
    `Thread 8 leaves at 64.0625° and runs its whole length; Clairaut's ρ cos ψ is ${formatNumber(2.8 * Math.cos((beta * Math.PI) / 180))}`,
  );
  await expect(selected(page)).not.toContainText("returns to its start");
  await expect(page.locator(".legend")).toContainText(
    "Surface Geodesic threads Selected thread",
  );
  // The note names its colors in the scheme they are drawn in.
  await chooseColorScheme(page, "forest");
  await expect(note(page)).not.toContainText("teal to gold");
  await chooseColorScheme(page, "default");
  // Each layer draws something of its own.
  const drawn = await pixels(page);
  for (const name of ["Geodesic threads", "Selected thread", "Surface patch"]) {
    await layer(page, name).uncheck();
    expect(await pixels(page)).not.toBe(drawn);
    await layer(page, name).check();
    expect(await pixels(page)).toBe(drawn);
  }
  // The linework export carries both layers, the fan with every thread.
  const groups = await lines(page);
  expect(groups.threads).toBeGreaterThan(16 * 1000);
  expect(groups.selected).toBeGreaterThan(1000);
});

test("threads launched on an edited torus take defaults, refuse bad fields by name and keep the drawing", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, { label: "A torus revealing its centers" });
  await settled(page);
  await field(page, "Minor radius r").fill("0.5");
  await settled(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "A surface and its centers of curvature",
  );
  const plain = await pixels(page);
  await launch(page).check();
  await settled(page);
  const surface = (await config(page)).surface;
  expect(surface.geodesics).toEqual(geodesicDefaults(surface));
  // Four turns of the outer equator, 8π(2 + 0.5), to three figures.
  expect(surface.geodesics.length).toBe(62.8);
  await expect(note(page)).toContainText(
    "12 threads on the torus, each 62.8 long",
  );
  await expect(selected(page)).toContainText("Thread 1 leaves at 17.5°");
  // Fewer threads keep the selection among them.
  await count(page, "Selected thread").fill("10");
  await settled(page);
  await count(page, "Threads").fill("4");
  await settled(page);
  expect((await config(page)).surface.geodesics).toMatchObject({
    count: 4,
    selected: 4,
  });
  const drawn = await pixels(page);
  expect(drawn).not.toBe(plain);
  for (const [name, text, message] of [
    ["Thread length L", "0", "length L"],
    ["Fan spread (°)", "400", "spread"],
    ["Start v₀", "1e6", "start v₀"],
  ] as const) {
    const before = await field(page, name).inputValue();
    await field(page, name).fill(text);
    await expect(page.getByRole("alert")).toContainText(message);
    expect(await pixels(page)).toBe(drawn);
    await field(page, name).fill(before);
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  await count(page, "Samples per thread").fill("20001");
  await expect(page.getByRole("alert")).toContainText("samples per thread");
  await count(page, "Samples per thread").fill("1200");
  await settled(page);
  expect(await pixels(page)).toBe(drawn);
  // A horn torus has no threads; the surface is still drawn, and the reason
  // stands under the checkbox in the error style, with no route away from
  // the edited study.
  await field(page, "Major radius R").fill("0.5");
  await settled(page);
  await expect(unavailable(page)).toHaveText(
    "Geodesic threads need a ring torus, with R above r: a horn or spindle torus meets its axis.",
  );
  await expect(unavailable(page)).toHaveClass(/field-error/);
  // Directly under the checkbox, above the fan's own fields.
  const [check, reason, start] = await Promise.all(
    [launch(page), unavailable(page), field(page, "Start u₀")].map(
      async (l) => (await l.boundingBox())!,
    ),
  );
  expect(reason.y).toBeGreaterThan(check.y + check.height - 1);
  expect(reason.y + reason.height).toBeLessThan(start.y);
  await expect(note(page)).toHaveCount(0);
  await expect(selected(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Open / })).toHaveCount(0);
  expect(await pixels(page)).not.toBe(drawn);
  // Turned off, the field is dropped, as in links made before it, and the
  // reason goes with it.
  await launch(page).uncheck();
  await settled(page);
  expect("geodesics" in (await config(page)).surface).toBe(false);
  await expect(unavailable(page)).toHaveCount(0);
  await launch(page).check();
  await field(page, "Major radius R").fill("0.5004");
  await settled(page);
  await expect(unavailable(page)).toContainText("at least 0.1% of r");
  // Back to a ring torus, the threads return on the edited study.
  await field(page, "Major radius R").fill("2");
  await settled(page);
  await expect(unavailable(page)).toHaveCount(0);
  expect((await config(page)).surface.b).toBe(0.5);
  await expect(note(page)).toContainText("12 threads on the torus");
  // Turned off again, the edited study draws as it did before the threads.
  await launch(page).uncheck();
  await settled(page);
  expect(await pixels(page)).toBe(plain);
});

// An ellipsoid carries threads over its whole surface; with equal axes
// they are the sphere's exact great circles. Its latitude is refused by
// field beyond a pole, a shape thinner than 1% is unavailable with its
// reason, and an arrow is carried only on a sphere.
test("an ellipsoid carries threads over its whole surface, and a sphere its great circles", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, torusThreads);
  await settled(page);
  await page.getByLabel("Surface", { exact: true }).selectOption("ellipsoid");
  await settled(page);
  await expect(unavailable(page)).toHaveCount(0);
  await expect(note(page)).toContainText(
    "16 threads over the whole ellipsoid, poles included, each 60 long, integrated in",
  );
  // Joachimsthal's p·D at the start, (1.4, 0, 0) heading 64.0625° from
  // +y toward +z: p = 1.4, D = 1/√(cos²β + sin²β/0.49).
  const beta = (64.0625 * Math.PI) / 180;
  const pD = 1.4 / Math.sqrt(Math.cos(beta) ** 2 + Math.sin(beta) ** 2 / 0.49);
  await expect(selected(page)).toContainText(
    `Thread 8 leaves at 64.0625° and runs its whole length; Joachimsthal's p·D is ${formatNumber(pD)}, and ends `,
  );
  await field(page, "Start v₀").fill("2");
  await expect(page.getByRole("alert")).toContainText(
    "on an ellipsoid v₀ is a latitude",
  );
  await field(page, "Start v₀").fill("pi/2");
  await settled(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(note(page)).toContainText("over the whole ellipsoid");
  // An arrow is carried along the selected thread here too.
  await layer(page, "Carry a tangent arrow").check();
  await settled(page);
  await expect(page.getByTestId("transport-unavailable")).toHaveCount(0);
  await expect(page.getByTestId("transport-note")).toContainText(
    "Along thread 8 the arrow keeps its 90° angle to the thread, as along any geodesic.",
  );
  await layer(page, "Carry a tangent arrow").uncheck();
  await settled(page);
  for (const axis of ["Axis a", "Axis b", "Axis c"])
    await field(page, axis).fill("1");
  await settled(page);
  await expect(note(page)).toContainText(
    "16 threads on the sphere, each a great circle traced exactly, 60 long.",
  );
  await field(page, "Axis c").fill("0.009");
  await settled(page);
  await expect(unavailable(page)).toHaveText(
    "Geodesic threads need an ellipsoid whose shortest semi-axis is at least 1% of its longest: a flatter or thinner one bends too sharply at its rim to trace.",
  );
  await field(page, "Axis c").fill("0.01");
  await settled(page);
  await expect(unavailable(page)).toHaveCount(0);
  await expect(note(page)).toContainText("16 threads over the whole ellipsoid");
});

test("switching a torus fan to an ellipsoid gives it an admitted latitude", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, torusThreads);
  await field(page, "Start v₀").fill("pi");
  await settled(page);
  const before = (await config(page)).surface.geodesics;
  expect(before.v).toBe(Math.PI);
  await page.getByLabel("Surface", { exact: true }).selectOption("ellipsoid");
  await expect(note(page)).toContainText("over the whole ellipsoid");
  await settled(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect((await config(page)).surface.geodesics).toEqual({ ...before, v: 0 });
  // A latitude already admitted on the ellipsoid keeps its entered value.
  await field(page, "Start v₀").fill("0.7");
  await settled(page);
  await page.getByLabel("Surface", { exact: true }).selectOption("torus");
  await settled(page);
  await page.getByLabel("Surface", { exact: true }).selectOption("ellipsoid");
  await settled(page);
  expect((await config(page)).surface.geodesics.v).toBe(0.7);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

// A paraboloid's threads start within its patch, at its middle by
// default, and stop at its edge; a kept fan's start moves into the patch,
// a start outside is refused by field and keeps the drawing, and no arrow
// is offered.
test("threads on a paraboloid start within its patch and stop at its edge", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, { label: "Helices rising round a cylinder" });
  await settled(page);
  await page.getByLabel("Surface", { exact: true }).selectOption("paraboloid");
  await settled(page);
  // u₀ = 4.7 lies beyond the saddle's [−1, 1]; v₀ = 0 stays.
  expect((await config(page)).surface.geodesics).toMatchObject({
    u: 0,
    v: 0,
    count: 24,
  });
  await expect(note(page)).toContainText("24 threads on the paraboloid");
  await launch(page).uncheck();
  await settled(page);
  await launch(page).check();
  await settled(page);
  const surface = (await config(page)).surface;
  expect(surface.geodesics).toEqual(geodesicDefaults(surface));
  // The saddle over [−1, 1]²: twice hypot(2, 2, 1), its heights running
  // from −1/2 to 1/2.
  expect(surface.geodesics).toMatchObject({ u: 0, v: 0, length: 6 });
  await expect(note(page)).toContainText(
    "12 threads on the paraboloid, each 6 long, integrated in",
  );
  await expect(note(page)).toContainText(
    "12 threads stop where they reach the patch's edge",
  );
  await expect(selected(page)).toContainText(
    "Thread 1 leaves at 17.5° and reaches the patch's edge u = 1 at",
  );
  // An arrow is offered, off until checked.
  await expect(layer(page, "Carry a tangent arrow")).not.toBeChecked();
  const drawn = await pixels(page);
  await field(page, "Start u₀").fill("1.2");
  await expect(page.getByRole("alert")).toContainText(
    "start u₀ must lie in the patch's u domain",
  );
  expect(await pixels(page)).toBe(drawn);
  await field(page, "Start u₀").fill("0");
  await expect(page.getByRole("alert")).toHaveCount(0);
  // A plane's threads are straight: the first, at 17.5°, leaves through
  // u = 1 after 1/cos 17.5°.
  await field(page, "Curvature k₁").fill("0");
  await field(page, "Curvature k₂").fill("0");
  await settled(page);
  await expect(selected(page)).toHaveText(
    `Thread 1 leaves at 17.5° and reaches the patch's edge u = 1 at ${formatNumber(1 / Math.cos((17.5 * Math.PI) / 180))}.`,
  );
  await page.getByLabel("Surface", { exact: true }).selectOption("monkey");
  await settled(page);
  await expect(unavailable(page)).toHaveText(
    "Geodesic threads are traced on an ellipsoid, a ring torus, a cylinder, a paraboloid or the helicoid–catenoid family.",
  );
});

test("the reveal draws every thread along its arc length; seeking and stopping agree", async ({
  page,
}) => {
  // Dense linework exports and canvas reads on CI's software WebGL took
  // 22–30 s on one runner and over 60 s on a runner half as fast.
  test.slow();
  await ready(page);
  await choosePreset(page, torusThreads);
  await settled(page);
  const full = await pixels(page);
  const whole = await lines(page);
  await openAnimation(page);
  await expect(page.getByLabel("Animate", { exact: true })).toHaveValue(
    "reveal",
  );
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Animation progress" });
  await slider.fill("0.5");
  await expect(stage(page)).toHaveAttribute("data-progress", "0.5");
  const halfway = await pixels(page);
  expect(halfway).not.toBe(full);
  const half = await lines(page);
  // The surface is drawn whole; the threads, half their length.
  expect(half.threads / whole.threads).toBeGreaterThan(0.45);
  expect(half.threads / whole.threads).toBeLessThan(0.55);
  await slider.fill("1");
  await expect(stage(page)).toHaveAttribute("data-progress", "1");
  expect(await pixels(page)).toBe(full);
  await slider.fill("0.5");
  expect(await pixels(page)).toBe(halfway);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await settled(page);
  expect(await pixels(page)).toBe(full);
});

// A reveal ends every thread on its drawn chord at the same arc length;
// a thread revealed short of its stop is partial, so the stop is not
// marked until the reveal reaches it.
test("a revealed thread ends at its arc length and is partial until its stop", () => {
  const line = (n: number, y: number): Vec3[] =>
    Array.from({ length: n }, (_, k) => ({ x: k, y, z: 0 }));
  const fan: GeodesicResult = {
    surface: "torus",
    length: 10,
    step: 1,
    selected: 1,
    steps: 0,
    threads: [
      {
        direction: 0,
        points: line(11, 0),
        tangents: line(11, 0).map(() => ({ x: 1, y: 0, z: 0 })),
        reason: "end",
        reached: 10,
        end: { x: 10, y: 0, z: 0 },
        endTangent: { x: 1, y: 0, z: 0 },
        endU: 0,
        endV: 0,
        steps: 0,
        return: { position: 10, direction: 0 },
        closes: false,
      },
      {
        direction: 1,
        points: line(4, 1),
        tangents: line(4, 1).map(() => ({ x: 1, y: 0, z: 0 })),
        reason: "exhausted",
        reached: 3.5,
        end: { x: 3.5, y: 1, z: 0 },
        endTangent: { x: 1, y: 0, z: 0 },
        endU: 0,
        endV: 0,
        steps: 9,
        return: { position: 0, direction: 0 },
        closes: false,
      },
    ],
  };
  const at = revealGeodesics(fan, 0.25, 10);
  expect(at.threads[0].points).toHaveLength(3);
  expect(at.threads[0].end).toEqual({ x: 2.5, y: 0, z: 0 });
  expect(at.threads[1].end).toEqual({ x: 2.5, y: 1, z: 0 });
  expect(at.threads.every((t) => t.partial)).toBe(true);
  // Past its stop, the stopped thread is whole, with its last piece.
  const later = revealGeodesics(fan, 0.36, 10);
  expect(later.threads[1]).toBe(fan.threads[1]);
  expect(later.threads[0].end.x).toBeCloseTo(3.6, 12);
  expect(revealGeodesics(fan, 1, 10)).toBe(fan);
});

// A still PNG's pixels, as RGBA.
async function still(page: Page) {
  await page.getByRole("button", { name: "Export image", exact: true }).click();
  const event = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /^PNG image/ }).click();
  const png = await readFile((await (await event).path())!);
  const rgba = await page.evaluate(async (input) => {
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
  }, png.toString("base64"));
  return Buffer.from(rgba, "base64");
}

// The movie of the reveal decodes with its duration, and its first, middle
// and last frames are the stills a direct seek draws at those progresses.
test("the reveal's movie agrees with stills at direct seeks", async ({
  page,
}) => {
  test.slow();
  await ready(page);
  await choosePreset(page, torusThreads);
  await settled(page);
  await openAnimation(page);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Animation progress" });
  // Ending mid-way, so playback stays paused rather than complete.
  const stills: Record<string, Buffer> = {};
  for (const p of ["1", "0", "0.4"]) {
    await slider.fill(p);
    await expect(stage(page)).toHaveAttribute("data-progress", p);
    stills[p] = await still(page);
  }
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await settled(page);
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
  const same = [
    match(0, stills["0"]),
    match(2, stills["0.4"]),
    match(5, stills["1"]),
  ];
  const swapped = [match(0, stills["1"]), match(5, stills["0"])];
  if (same.every(Boolean) && swapped.every(Boolean)) {
    console.log("Geodesic reveal frames", { same, swapped });
    // Every frame draws the whole surface, so only the threads differ:
    // matching frames measured 0.8–1.9 levels apart, within H.264's noise
    // (about one level on CI's encoder), and swapped ends about 7.9.
    for (const d of same) {
      expect(d!.meanDifference).toBeLessThan(4);
      expect(d!.unmatchedInk).toBeLessThan(0.02);
    }
    for (const d of swapped) expect(d!.meanDifference).toBeGreaterThan(6);
  }
});

// A cylinder and the helicoid–catenoid family carry threads within their
// patch: the controls appear with them, a fan starts in the patch's middle,
// a start outside it is refused under its own field, choosing such a
// surface moves a start that lies outside into it, a thread stops at the
// patch's edge unmarked, and no arrow is offered.
test("threads on a cylinder and the family's patch start within it and stop at its edge", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, { label: "A torus revealing its centers" });
  await settled(page);
  const kind = page.getByLabel("Surface", { exact: true });
  await kind.selectOption("cylinder");
  await settled(page);
  await launch(page).check();
  await settled(page);
  let surface = (await config(page)).surface;
  expect(surface.geodesics).toEqual(geodesicDefaults(surface));
  // The middle of [0, 2π] × [−1, 1], and twice the diagonal
  // hypot(1.4·2π, 2) of the patch, to three figures.
  expect(surface.geodesics).toMatchObject({ u: Math.PI, v: 0, length: 18 });
  await expect(note(page)).toContainText(
    "12 threads on the cylinder, each 18 long, integrated in",
  );
  await expect(note(page)).toContainText(
    "unrolled flat, each is a straight line",
  );
  await expect(note(page)).toContainText(
    "threads stop where they reach the patch's edge",
  );
  await expect(selected(page)).toContainText(
    "Thread 1 leaves at 17.5° and reaches the patch's edge v = 1 at",
  );
  // An arrow is offered, off until checked.
  await expect(layer(page, "Carry a tangent arrow")).not.toBeChecked();
  const drawn = await pixels(page);
  for (const [name, text, message] of [
    ["Start v₀", "1.5", "start v₀ must lie in the patch's v domain"],
    ["Start u₀", "-0.1", "start u₀ must lie in the patch's u domain"],
  ] as const) {
    const before = await field(page, name).inputValue();
    await field(page, name).fill(text);
    await expect(page.getByRole("alert")).toContainText(message);
    expect(await pixels(page)).toBe(drawn);
    await field(page, name).fill(before);
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  // The family's patch is [−π, π] × [−1.5, 1.5].
  await field(page, "Start v₀").fill("0.9");
  await field(page, "Start u₀").fill("4");
  await settled(page);
  await kind.selectOption("helicoid-catenoid");
  await settled(page);
  surface = (await config(page)).surface;
  // u₀ = 4 lies beyond π, so it moves to the middle; v₀ = 0.9 stays.
  expect(surface.geodesics).toMatchObject({ u: 0, v: 0.9 });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(note(page)).toContainText(
    "12 threads on the patch, each 18 long",
  );
  await expect(note(page)).toContainText(
    "Every angle θ bends the patch without stretching it, so they keep their route in (u, v).",
  );
  // An arrow is offered, off until checked.
  await expect(layer(page, "Carry a tangent arrow")).not.toBeChecked();
  // To a monkey saddle, the fan is kept and unavailable, with the reason.
  await kind.selectOption("monkey");
  await settled(page);
  await expect(unavailable(page)).toHaveText(
    "Geodesic threads are traced on an ellipsoid, a ring torus, a cylinder, a paraboloid or the helicoid–catenoid family.",
  );
});

const stair = { label: "A thread that keeps its way as a stair opens" };

// The signature: the family's members share their metric, so as the
// associate angle bends the stair into a throat, the selected thread is
// described identically, stopping at the same edge after the same length,
// while the drawing moves; the linework carries the threads.
test("bending the stair keeps each thread's route while the drawing moves", async ({
  page,
}) => {
  test.slow();
  await ready(page);
  await choosePreset(page, stair);
  await settled(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Threads that go straight on a surface",
  );
  const described = await selected(page).textContent();
  expect(described).toMatch(/^Thread 8 leaves at −50° and /);
  const route = await note(page).textContent();
  const helicoid = await pixels(page);
  const angle = field(page, "Associate angle θ");
  for (const theta of ["0.8", "pi/2"]) {
    await angle.fill(theta);
    await settled(page);
    await expect(selected(page)).toHaveText(described!);
    await expect(note(page)).toHaveText(route!);
    expect(await pixels(page)).not.toBe(helicoid);
  }
  const groups = await lines(page);
  expect(groups.threads).toBeGreaterThan(1000);
  expect(groups.selected).toBeGreaterThan(100);
});

// The film of the bending decodes at its duration, and its ends are the
// stills a seek draws at θ = 0 and π/2, threads included.
test("the bending stair's film agrees with seeked stills", async ({ page }) => {
  test.slow();
  await ready(page);
  await choosePreset(page, stair);
  await settled(page);
  await layer(page, "Surface patch").uncheck();
  await settled(page);
  await openAnimation(page);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Animation progress" });
  const stills: Record<string, Buffer> = {};
  for (const [t, p] of [
    ["0.5", "1"],
    ["0", "0"],
  ]) {
    await slider.fill(t);
    await expect(stage(page)).toHaveAttribute("data-progress", p);
    await settled(page);
    stills[p] = await still(page);
  }
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await settled(page);
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
    console.log("Bending stair film frames", { same, swapped });
    for (const d of same) {
      expect(d!.meanDifference).toBeLessThan(4);
      expect(d!.unmatchedInk).toBeLessThan(0.02);
    }
    for (const d of swapped) expect(d!.unmatchedInk).toBeGreaterThan(0.5);
  }
});

// An edited cylinder fan travels in a link and reopens as the same study
// and drawing; its reveal draws the threads along their length up to each
// edge stop.
test("an edited cylinder fan reopens from its link and reveals along its length", async ({
  page,
  context,
}) => {
  test.slow();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await ready(page);
  await choosePreset(page, { label: "Helices rising round a cylinder" });
  await settled(page);
  await field(page, "Start v₀").fill("0.5");
  await field(page, "Direction β (°)").fill("10");
  await settled(page);
  const study = (await config(page)).surface;
  const described = await selected(page).textContent();
  const drawn = await pixels(page);
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  const reopened = await context.newPage();
  await reopened.goto(link);
  await expect(reopened.locator("#spatial-artwork")).toBeVisible();
  await settled(reopened);
  expect((await config(reopened)).surface).toEqual(study);
  await expect(selected(reopened)).toHaveText(described!);
  expect(await pixels(reopened)).toBe(drawn);
  await reopened.close();
  // Halfway through the reveal, the threads are drawn to half their
  // length or to their edge stop, whichever comes first.
  const whole = await lines(page);
  await openAnimation(page);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Animation progress" });
  await slider.fill("0.5");
  await expect(stage(page)).toHaveAttribute("data-progress", "0.5");
  const half = await lines(page);
  expect(half.threads).toBeGreaterThan(0.2 * whole.threads);
  expect(half.threads).toBeLessThan(0.9 * whole.threads);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await settled(page);
  expect(await pixels(page)).toBe(drawn);
});

// Launch defaults must remain valid at the largest admitted scale, even when
// twice a patch's metric diagonal, or a turn around a whole ellipsoid or a
// torus, exceeds the thread length limit (#483).
test("large surfaces launch threads with a valid default length", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, { label: "A torus revealing its centers" });
  for (const [kind, fields] of [
    ["cylinder", [["Semi-axis a", "100000"]]],
    ["helicoid-catenoid", [["Scale s", "100000"]]],
    [
      "ellipsoid",
      [
        ["Axis a", "100000"],
        ["Axis b", "80000"],
        ["Axis c", "60000"],
      ],
    ],
    ["torus", [["Major radius R", "10000"]]],
  ] as const) {
    await page.getByLabel("Surface", { exact: true }).selectOption(kind);
    await settled(page);
    for (const [label, value] of fields) await field(page, label).fill(value);
    await expect
      .poll(async () => (await config(page)).surface.a)
      .toBe(Number(fields[0][1]));
    await settled(page);
    await launch(page).check();
    await settled(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
    const length = (await config(page)).surface.geodesics.length;
    expect(length).toBeGreaterThan(0);
    expect(length).toBeLessThanOrEqual(100000);
    await expect(note(page)).toContainText("12 threads");
    await launch(page).uncheck();
    await settled(page);
  }
});

const umbilic = {
  label: "Every thread from an umbilic meets at the opposite one",
};

// The signature: a fan from an umbilic of the ellipsoid (1.7, 1.3, 0.7)
// over its whole surface, each thread keeping Joachimsthal's p·D = ac;
// the reveal grows every thread together along its length.
test("every thread from an umbilic keeps p·D = ac, and the reveal grows them together", async ({
  page,
}) => {
  test.slow();
  await ready(page);
  await choosePreset(page, umbilic);
  await settled(page);
  await expect(note(page)).toContainText(
    "24 threads over the whole ellipsoid, poles included, each 3.9354 long, integrated in",
  );
  await expect(selected(page)).toContainText(
    `Thread 12 leaves at −7.5° and runs its whole length; Joachimsthal's p·D is ${formatNumber(1.7 * 0.7)}, and ends `,
  );
  const drawn = await pixels(page);
  const whole = await lines(page);
  expect(whole.threads).toBeGreaterThan(1000);
  await openAnimation(page);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Animation progress" });
  await slider.fill("0.5");
  await expect(stage(page)).toHaveAttribute("data-progress", "0.5");
  const half = await lines(page);
  expect(half.threads).toBeGreaterThan(0.3 * whole.threads);
  expect(half.threads).toBeLessThan(0.7 * whole.threads);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await settled(page);
  expect(await pixels(page)).toBe(drawn);
});

// An edited saddle fan travels in a link and reopens as the same study,
// notes and drawing.
test("an edited saddle fan reopens from its link", async ({
  page,
  context,
}) => {
  test.slow();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await ready(page);
  await choosePreset(page, { label: "A straight thread across a saddle" });
  await settled(page);
  await expect(selected(page)).toContainText(
    "Thread 13 leaves at 43.3755° and reaches the patch's edge v = 1.5 at",
  );
  await field(page, "Start v₀").fill("-0.4");
  await field(page, "Curvature k₂").fill("-0.8");
  await settled(page);
  const study = (await config(page)).surface;
  expect(study).toMatchObject({ b: -0.8, geodesics: { v: -0.4 } });
  const described = await selected(page).textContent();
  const drawn = await pixels(page);
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  const reopened = await context.newPage();
  await reopened.goto(link);
  await expect(reopened.locator("#spatial-artwork")).toBeVisible();
  await settled(reopened);
  expect((await config(reopened)).surface).toEqual(study);
  await expect(selected(reopened)).toHaveText(described!);
  expect(await pixels(reopened)).toBe(drawn);
  await reopened.close();
});

// A film of the umbilic fan while its middle axis b shrinks from 1.3 to
// 1.0, the threads launched afresh on every frame's ellipsoid, decodes at
// its duration, and its ends are the stills a seek draws there.
test("a film of the umbilic fan as its ellipsoid changes agrees with seeked stills", async ({
  page,
}) => {
  test.slow();
  const { presetStudy } = await import("../web/spatial/link");
  const { writeStudyLink } = await import("../web/study-link");
  const at = (name: string) => spatialPresets.findIndex((p) => p.name === name);
  const study = presetStudy(at(umbilic.label));
  study.animation = {
    ...presetStudy(at(stair.label)).animation,
    tracks: [{ target: "surfaceB", from: "1.3", to: "1" }],
  };
  await page.goto(`/?study=3d#s=${await writeStudyLink("3d", study)}`);
  // Headless Chromium draws a fan's first frame slowly: about 7 s alone
  // for this study, as for the torus fan preset (7.7 s), against 0.9 s
  // without its threads; under a full parallel run it has passed 15 s.
  await expect(page.locator("#spatial-artwork")).toBeVisible({
    timeout: 60000,
  });
  await settled(page);
  await layer(page, "Surface patch").uncheck();
  await settled(page);
  await openAnimation(page);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Animation progress" });
  const stills: Record<string, Buffer> = {};
  for (const [t, p] of [
    ["0.5", "1"],
    ["0", "0"],
  ]) {
    await slider.fill(t);
    await expect(stage(page)).toHaveAttribute("data-progress", p);
    await settled(page);
    stills[p] = await still(page);
  }
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await settled(page);
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
  // Back and forth over 0.4 s: frame 0 is b = 1.3 and frame 3, half way
  // through the time, is the far end b = 1.
  const same = [match(0, stills["0"]), match(3, stills["1"])];
  const swapped = [match(0, stills["1"]), match(3, stills["0"])];
  if (same.every(Boolean) && swapped.every(Boolean)) {
    console.log("Umbilic fan film frames", { same, swapped });
    for (const d of same) {
      expect(d!.meanDifference).toBeLessThan(4);
      expect(d!.unmatchedInk).toBeLessThan(0.02);
    }
    for (const d of swapped) expect(d!.unmatchedInk).toBeGreaterThan(0.5);
  }
});

// The other new presets play their own reveals: halfway, the band's one
// thread is drawn to about half its length, and the saddle's fan, most of
// whose threads reach the edge before half their length, is cut short only
// where a thread runs on; Stop restores the opening drawing.
for (const [label, threads, least, most] of [
  ["One thread weaves a band round an ellipsoid", "selected", 0.3, 0.75],
  ["A straight thread across a saddle", "threads", 0.5, 0.97],
] as const)
  test(`${label} plays its reveal`, async ({ page }) => {
    test.slow();
    await ready(page);
    await choosePreset(page, { label });
    await settled(page);
    await expect(unavailable(page)).toHaveCount(0);
    const drawn = await pixels(page);
    const whole = (await lines(page))[threads];
    expect(whole).toBeGreaterThan(500);
    await openAnimation(page);
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.getByRole("slider", { name: "Animation progress" }).fill("0.5");
    await expect(stage(page)).toHaveAttribute("data-progress", "0.5");
    const half = (await lines(page))[threads];
    expect(half).toBeGreaterThan(least * whole);
    expect(half).toBeLessThan(most * whole);
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await settled(page);
    expect(await pixels(page)).toBe(drawn);
  });
