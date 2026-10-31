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

// Geodesic threads on a sphere or ring torus, through the real controls,
// worker and engine: their presets, launching them on an edited surface,
// refusals and unavailable surfaces, the arc-length reveal and the
// linework export.
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
    `Thread 8 leaves at 64.06° and runs its whole length; Clairaut's ρ cos ψ is ${(2.8 * Math.cos((beta * Math.PI) / 180)).toPrecision(4)}`,
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
});

test("an ellipsoid with unequal axes has no threads until it is a sphere", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, torusThreads);
  await settled(page);
  await page.getByLabel("Surface", { exact: true }).selectOption("ellipsoid");
  await settled(page);
  await expect(unavailable(page)).toHaveText(
    "Geodesic threads need a sphere: give the ellipsoid equal axes a = b = c.",
  );
  // The start was a torus's; on a sphere v₀ is a latitude.
  for (const axis of ["Axis a", "Axis b", "Axis c"])
    await field(page, axis).fill("1");
  await settled(page);
  await expect(note(page)).toContainText("16 threads on the sphere");
  await field(page, "Start v₀").fill("2");
  await expect(page.getByRole("alert")).toContainText(
    "on a sphere v₀ is a latitude",
  );
  await field(page, "Start v₀").fill("pi/2");
  await settled(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await field(page, "Axis c").fill("0.9");
  await settled(page);
  await expect(unavailable(page)).toContainText("equal axes");
  await field(page, "Axis c").fill("1");
  await settled(page);
  await expect(unavailable(page)).toHaveCount(0);
  await expect(selected(page)).toContainText("Thread 8 leaves at 64.06°");
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
