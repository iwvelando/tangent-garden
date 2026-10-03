import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import { probe, decodeVideo, frameDifference } from "./video";
import { open as openDetails } from "./helpers";
import { spatialPresets } from "../web/spatial/presets";
import { defaultLayers } from "../web/spatial/renderer";
import { defaultPath } from "../web/spatial/path";
import { defaultRide } from "../web/spatial/ride";

// Riding a ray while light is traced, through the real notebook, worker,
// engine and exporter. The ray's head is where its traced light has
// reached, the end of its drawn segment; the camera looks along that
// segment from behind, so the head is drawn in the middle of the page.
const stage = (page: Page) => page.locator(".spatial-stage");
const canvas = (page: Page) => page.locator("#spatial-artwork");
const settled = (page: Page) =>
  expect(stage(page)).toHaveAttribute("aria-busy", "false");
const mode = (page: Page) => page.getByLabel("Animate", { exact: true });
const cameraField = (page: Page) =>
  page.getByLabel("Animation camera", { exact: true });
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const values = (page: Page) => page.locator(".animation-values");
const shownView = async (page: Page) =>
  JSON.parse((await canvas(page).getAttribute("data-view"))!);
async function seek(page: Page, p: string) {
  await page.getByRole("slider", { name: "Animation progress" }).fill(p);
  await expect(stage(page)).toHaveAttribute("data-progress", p);
}
async function openPanel(page: Page) {
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
}
const coma = spatialPresets.findIndex(
  (p) => p.name === "A tilted beam folding into coma",
);
const manual = { yaw: -0.4, pitch: 0.2, zoom: 1.3, panX: 0.2, panY: 0.1 };
const study = (animation: object = {}) => ({
  config: spatialPresets[coma].config,
  layers: defaultLayers,
  view: manual,
  animation: {
    mode: "trace",
    camera: "ride",
    duration: 4,
    tracks: [],
    path: defaultPath,
    ride: { i: 72, j: 48, follow: 0.1, turn: 0.2 },
    ...animation,
  },
});
async function open(page: Page, s: unknown) {
  await page.goto(
    `/?study=3d#s=${deflateRawSync(
      Buffer.from(JSON.stringify({ v: 1, notebook: "3d", study: s })),
    ).toString("base64url")}`,
  );
  await expect(canvas(page)).toBeVisible();
  await settled(page);
  await openPanel(page);
}
// A layer's polylines in a line drawing of the shown view, at 2000 × 1520.
async function linework(page: Page, layer: string, visible = false) {
  await button(page, "Export image").click();
  const event = page.waitForEvent("download");
  await page
    .getByRole("menuitem", {
      name: visible
        ? "Lines (SVG) · visible only, sampled"
        : "Lines (SVG) · every line",
      exact: true,
    })
    .click();
  const svg = (await readFile((await (await event).path())!)).toString();
  const group = svg.match(new RegExp(`<g id="${layer}"[^>]*>(.*?)</g>`));
  if (!group) return [];
  return [...group[1].matchAll(/ d="([^"]*)"/g)].flatMap((m) =>
    m[1]
      .split(/(?=M)/)
      .filter(Boolean)
      .map((line) =>
        [...line.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map(
          (v) => [+v[1], +v[2]] as const,
        ),
      ),
  );
}
// How far the nearest end of any of a layer's polylines is from the middle
// of the page.
async function headOffCenter(page: Page, layer: string) {
  const ends = (await linework(page, layer)).flatMap((l) => [l[0], l.at(-1)!]);
  expect(ends.length).toBeGreaterThan(0);
  return Math.min(...ends.map(([x, y]) => Math.hypot(x - 1000, y - 760)));
}

test("a ray is ridden only while light is traced, chosen at a crossing, with its distances under the camera", async ({
  page,
}) => {
  await open(page, study({ camera: "hold", ride: defaultRide }));
  await expect(mode(page)).toHaveValue("trace");
  await expect(cameraField(page).locator("option[value='ride']")).toHaveCount(
    1,
  );
  await cameraField(page).selectOption("ride");
  await expect(page.locator("#spatial-animation-section")).toContainText(
    "perspective",
  );
  // The middle crossing of the coma's 9 × 9 curves, by default.
  const u = page.getByLabel("Ray at u", { exact: true }),
    v = page.getByLabel("Ray at v", { exact: true });
  await expect(u).toHaveValue("48");
  await expect(v).toHaveValue("48");
  await expect(u.locator("option")).toHaveCount(9);
  await expect(u.locator("option").nth(6)).toHaveText("u = 0.8");
  await page.getByLabel("Follow distance", { exact: true }).fill("0");
  await button(page, "Play animation").click();
  await expect(page.locator(".animation-error")).toContainText(
    "Follow distance must be more than 0 and at most 4 radii.",
  );
  await page.getByLabel("Follow distance", { exact: true }).fill("0.1");
  // Another animation has no ray to ride: the camera falls back, and the
  // ride's fields go.
  for (const other of ["reveal", "orbit"]) {
    await mode(page).selectOption(other);
    await expect(cameraField(page)).toHaveValue("hold");
    await expect(cameraField(page).locator("option[value='ride']")).toHaveCount(
      0,
    );
    await expect(u).toHaveCount(0);
    // A select shows its first option for a value it lacks, so the camera
    // is checked once the ride is offered again.
    await mode(page).selectOption("trace");
    await expect(cameraField(page)).toHaveValue("hold");
    await cameraField(page).selectOption("ride");
  }
});

test("each frame looks along the ridden ray from behind its head, which stays in the middle of the page", async ({
  page,
}) => {
  await open(page, study());
  await expect(cameraField(page)).toHaveValue("ride");
  await expect(page.getByLabel("Ray at u", { exact: true })).toHaveValue("72");
  const idle = await shownView(page);
  expect(idle.lens).toBeUndefined();
  await page.keyboard.press("Escape");
  await button(page, "Play animation").click();
  await expect(page.locator(".spatial-stage")).toContainText(
    "Perspective · riding a ray",
  );
  await button(page, "Pause").click();
  // Early, falling with the light; at the end, resting behind the head at
  // the ray's drawn end, along its reflection.
  await seek(page, "0.1");
  await expect(values(page)).toContainText(
    "Riding the ray at u = 0.8, v = 0 · incident",
  );
  const falling = await shownView(page);
  expect(falling.lens.projection).toBe("perspective");
  expect(await headOffCenter(page, "incident")).toBeLessThan(0.5);
  // The shaded drawing, through the vertex shader's own perspective, has
  // ink wherever the line drawing's visible lines are.
  expect(await agreement(page)).toBeGreaterThan(0.9);
  // Pausing holds the camera.
  await page.waitForTimeout(150);
  expect(await shownView(page)).toEqual(falling);
  await seek(page, "1");
  await expect(values(page)).toContainText("· reflected");
  expect(await headOffCenter(page, "reflected")).toBeLessThan(0.5);
  // The finished ride hands over its camera; orbiting leaves the ray for
  // the orthographic view it was held about, and Home returns to the ray.
  const released = await shownView(page);
  expect(released.lens).toBeTruthy();
  await expect(page.locator(".spatial-stage")).toContainText(
    "Perspective from the ray",
  );
  await canvas(page).focus();
  // A key that moves no camera keeps the ray, as the next drawing (here
  // after a resize) shows.
  await page.keyboard.press("a");
  const size = page.viewportSize()!;
  for (const width of [size.width - 40, size.width]) {
    const before = await canvas(page).evaluate((c) => c.clientWidth);
    await page.setViewportSize({ ...size, width });
    await expect
      .poll(() => canvas(page).evaluate((c) => c.clientWidth))
      .not.toBe(before);
    await canvas(page).evaluate(
      () =>
        new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done)),
        ),
    );
    expect((await shownView(page)).lens).toEqual(released.lens);
  }
  await page.keyboard.press("ArrowLeft");
  const orbited = await shownView(page);
  expect(orbited.lens).toBeUndefined();
  expect(orbited.yaw).toBeCloseTo(manual.yaw - 0.1, 12);
  await page.keyboard.press("Home");
  expect(await shownView(page)).toEqual(released);
  // Back to study restores the study and its manual camera.
  await button(page, "Back to study").click();
  await expect.poll(async () => (await shownView(page)).lens).toBeUndefined();
  expect(await shownView(page)).toEqual(idle);
});

// The share of points along the visible mirror curves and rays of the line
// drawing (sampled every 4 px, away from the page's edges) that have ink in
// the shaded still within a pixel: the same projection drawn twice, once by
// the vertex shader and once by scene.ts.
async function agreement(page: Page) {
  const lines = [
    ...(await linework(page, "curves", true)),
    ...(await linework(page, "incident", true)),
    ...(await linework(page, "reflected", true)),
  ];
  const rgba = await still(page);
  const points: [number, number][] = [];
  for (const line of lines)
    for (let k = 1; k < line.length; k++) {
      const [a, b] = [line[k - 1], line[k]];
      const n = Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4);
      for (let m = 0; m < n; m++) {
        const x = a[0] + ((b[0] - a[0]) * m) / n,
          y = a[1] + ((b[1] - a[1]) * m) / n;
        if (x > 4 && x < 1996 && y > 4 && y < 1516) points.push([x, y]);
      }
    }
  expect(points.length).toBeGreaterThan(200);
  const inked = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const i = 4 * ((Math.round(y) + dy) * 2000 + Math.round(x) + dx);
        if (
          Math.abs(rgba[i] - rgba[0]) +
            Math.abs(rgba[i + 1] - rgba[1]) +
            Math.abs(rgba[i + 2] - rgba[2]) >
          30
        )
          return true;
      }
    return false;
  };
  return points.filter(([x, y]) => inked(x, y)).length / points.length;
}

async function still(page: Page) {
  await button(page, "Export image").click();
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

test("an exported ride starts and ends with the stills of its first and last frames", async ({
  page,
}) => {
  await open(page, study());
  await page.keyboard.press("Escape");
  await button(page, "Play animation").click();
  await button(page, "Pause").click();
  await seek(page, "0");
  const first = await still(page);
  await seek(page, "1");
  const last = await still(page);
  await button(page, "Back to study").click();
  await page.getByLabel("Duration (seconds)").fill("0.4");
  await openDetails(page, "#spatial-export-settings");
  await page.getByLabel("Export format", { exact: true }).selectOption("mp4");
  await page.getByLabel("Export frame rate").selectOption("15");
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("2");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export MP4/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("tangent-garden-spatial-trace.mp4");
  const path = (await file.path())!;
  const data = probe(path);
  if (data) {
    expect(data.frames).toBe(6);
    expect(data.durations.reduce((a, b) => a + b, 0)).toBe(400);
  }
  const video = await decodeVideo(page, await readFile(path));
  expect(video.duration).toBeCloseTo(0.4, 3);
  const match = (index: number, reference: Buffer) =>
    frameDifference(path, 2000, 1520, index, reference);
  const ends = [match(0, first), match(5, last)];
  const crossed = [match(0, last), match(5, first)];
  if (ends[0] && ends[1] && crossed[0] && crossed[1]) {
    console.log("Ride endpoints", { ends, crossed });
    for (const d of ends) {
      expect(d.meanDifference).toBeLessThan(3);
      expect(d.unmatchedInk).toBeLessThan(0.05);
    }
    for (const d of crossed) expect(d.unmatchedInk).toBeGreaterThan(0.3);
  }
});

test("the coma ride's example brings its ray and rides it to its drawn end", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await settled(page);
  await openPanel(page);
  await page.getByRole("button", { name: "Browse notebook examples" }).click();
  await page
    .locator(`[data-example-title="Riding a ray through coma"]`)
    .click();
  await settled(page);
  await expect(mode(page)).toHaveValue("trace");
  await expect(cameraField(page)).toHaveValue("ride");
  await expect(page.getByLabel("Ray at u", { exact: true })).toHaveValue("72");
  await expect(page.getByLabel("Ray at v", { exact: true })).toHaveValue("48");
  await page.keyboard.press("Escape");
  await button(page, "Play animation").click();
  await button(page, "Pause").click();
  await seek(page, "1");
  await expect(values(page)).toContainText("· reflected");
  expect(await headOffCenter(page, "reflected")).toBeLessThan(0.5);
});
