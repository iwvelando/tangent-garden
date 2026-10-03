import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import { probe, decodeVideo, frameDifference } from "./video";
import { open as openDetails } from "./helpers";
import { spatialPresets } from "../web/spatial/presets";
import { defaultLayers } from "../web/spatial/renderer";
import { pathView, type CameraPath } from "../web/spatial/path";

// Flying the camera through key views while the geometry moves, through the
// real notebook, worker, engine and exporter: the path is the animation
// camera of a reveal, a parameter animation or a trace.
const stage = (page: Page) => page.locator(".spatial-stage");
const canvas = (page: Page) => page.locator("#spatial-artwork");
const settled = (page: Page) =>
  expect(stage(page)).toHaveAttribute("aria-busy", "false");
const mode = (page: Page) => page.getByLabel("Animate", { exact: true });
const cameraField = (page: Page) =>
  page.getByLabel("Animation camera", { exact: true });
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const views = (page: Page) => page.getByRole("group", { name: "Key views" });
const shownView = async (page: Page) =>
  JSON.parse((await canvas(page).getAttribute("data-view"))!);
// What the drawing shows at one moment: its time, camera and study, read
// together.
const snapshot = (page: Page) =>
  stage(page).evaluate((s) => ({
    progress: s.getAttribute("data-progress"),
    camera: s.getAttribute("data-camera"),
    config: s.getAttribute("data-config"),
  }));
async function seek(page: Page, p: string) {
  await page.getByRole("slider", { name: "Animation progress" }).fill(p);
  await expect(stage(page)).toHaveAttribute("data-progress", p);
}
async function openPanel(page: Page) {
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
}
async function ready(page: Page) {
  await page.goto("/?study=3d");
  await expect(canvas(page)).toBeVisible();
  await settled(page);
  await openPanel(page);
}
async function open(page: Page, study: unknown) {
  await page.goto(
    `/?study=3d#s=${deflateRawSync(
      Buffer.from(JSON.stringify({ v: 1, notebook: "3d", study })),
    ).toString("base64url")}`,
  );
  await expect(canvas(page)).toBeVisible();
  await settled(page);
  await openPanel(page);
}
const manual = { yaw: -0.4, pitch: 0.2, zoom: 1.3, panX: 0.2, panY: 0.1 };
const flight: CameraPath = {
  style: "smooth",
  keys: [
    {
      name: "Start",
      yaw: 0.3,
      pitch: 0.75,
      zoom: 1,
      panX: 0,
      panY: 0,
      turns: 0,
    },
    {
      name: "Side",
      yaw: 1.9,
      pitch: -0.3,
      zoom: 2.4,
      panX: 0.8,
      panY: -0.5,
      turns: 0,
    },
    {
      name: "Away",
      yaw: 0.3,
      pitch: 1.1,
      zoom: 0.7,
      panX: 0,
      panY: 0,
      turns: 1,
    },
  ],
};
type Track = { target: string; from: string; to: string };
const study = (
  animation: { mode: string; tracks?: Track[]; duration?: number },
  config = spatialPresets[0].config,
) => ({
  config,
  layers: defaultLayers,
  view: manual,
  animation: {
    camera: "path",
    duration: 5,
    tracks: [],
    path: flight,
    ...animation,
  },
});
const at = (bounds: object, key: CameraPath["keys"][number]) => ({
  ...bounds,
  yaw: key.yaw,
  pitch: key.pitch,
  zoom: key.zoom,
  panX: key.panX,
  panY: key.panY,
});
const close = (a: Record<string, number>, b: Record<string, number>) => {
  for (const key of ["yaw", "pitch", "zoom", "panX", "panY"])
    expect(a[key]).toBeCloseTo(b[key], 9);
};

test("every mode that moves the geometry can fly the key views; the orbit and the path itself cannot", async ({
  page,
}) => {
  await ready(page);
  await expect(mode(page)).toHaveValue("reveal");
  await cameraField(page).selectOption("path");
  // The key views are edited under the camera that flies them.
  await expect(views(page)).toBeVisible();
  await expect(page.locator("#spatial-animation-section")).toContainText(
    "while the geometry moves",
  );
  await button(page, "Play animation").click();
  await expect(page.locator(".animation-error")).toContainText(
    "Key views need at least two views to fly between.",
  );
  await mode(page).selectOption("parameters");
  await expect(cameraField(page)).toHaveValue("path");
  await expect(views(page)).toBeVisible();
  // The orbit turns the camera itself: it offers no path, and leaves it.
  await mode(page).selectOption("orbit");
  await expect(cameraField(page)).toHaveValue("hold");
  await expect(cameraField(page).locator("option[value='path']")).toHaveCount(
    0,
  );
  await expect(views(page)).toHaveCount(0);
  // Leaving the orbit keeps the camera it fell back to, and a link copied
  // there opens.
  await mode(page).selectOption("reveal");
  await expect(cameraField(page)).toHaveValue("hold");
  await expect(views(page)).toHaveCount(0);
  // The path mode flies the views with the geometry fixed: no camera to
  // choose.
  await cameraField(page).selectOption("path");
  await page.getByRole("button", { name: "+ Add the drawing's view" }).click();
  await mode(page).selectOption("path");
  await expect(cameraField(page)).toHaveCount(0);
  await expect(page.getByLabel("View 1 name", { exact: true })).toBeVisible();
  await mode(page).selectOption("reveal");
  await expect(cameraField(page)).toHaveValue("path");
  await expect(page.getByLabel("View 1 name", { exact: true })).toBeVisible();
});

test("each frame of a parameter animation is drawn with the camera of its own time, about the study as drawn", async ({
  page,
}) => {
  // The tube's radius moves the knot's bounds; the camera keeps the bounds
  // its views were taken about.
  await open(
    page,
    study({
      mode: "parameters",
      duration: 3,
      tracks: [{ target: "tube", from: "0.4", to: "1.2" }],
    }),
  );
  await expect(mode(page)).toHaveValue("parameters");
  await expect(cameraField(page)).toHaveValue("path");
  const idle = await shownView(page);
  expect(idle).toMatchObject(manual);
  const bounds = { center: idle.center, radius: idle.radius };
  await page.keyboard.press("Escape");
  await button(page, "Play animation").click();
  await expect(stage(page)).toHaveAttribute("data-mode", "parameters");
  await button(page, "Pause").click();
  const tubes: number[] = [];
  for (const [p, k] of [
    ["0", 0],
    ["0.5", 1],
    ["1", 2],
  ] as const) {
    await seek(page, p);
    const shown = await snapshot(page);
    expect(JSON.parse(shown.camera!)).toEqual(at(bounds, flight.keys[k]));
    tubes.push(JSON.parse(shown.config!).tube);
    await expect(page.locator(".animation-values")).toContainText(
      `· ${flight.keys[k].name}`,
    );
  }
  expect(tubes).toEqual([0.4, 0.8, 1.2]);
  await seek(page, "0.25");
  close(
    JSON.parse((await snapshot(page)).camera!),
    pathView(flight, bounds as never, 0.25) as never,
  );
  await expect(page.locator(".animation-values")).toHaveText(
    /^Minor radius r = 0\.6\d* · Start → Side$/,
  );
  // While it plays, each drawn frame pairs its geometry with its camera,
  // however late the engine delivers it.
  await seek(page, "0");
  await button(page, "Resume").click();
  const seen = new Set<string>();
  while (seen.size < 6) {
    const shown = await snapshot(page);
    if (!shown.progress || seen.has(shown.progress)) continue;
    const p = Number(shown.progress);
    seen.add(shown.progress);
    expect(JSON.parse(shown.config!).tube).toBeCloseTo(0.4 + 0.8 * p, 12);
    close(
      JSON.parse(shown.camera!),
      pathView(flight, bounds as never, p) as never,
    );
    if (p === 1) break;
  }
  // Stop restores the study and its manual camera.
  await button(page, "Stop").click();
  await expect.poll(async () => (await shownView(page)).yaw).toBe(manual.yaw);
  expect(await shownView(page)).toEqual(idle);
});

test("a reveal and a trace fly the views as they draw, and pausing holds both", async ({
  page,
}) => {
  await open(page, study({ mode: "reveal", duration: 3 }));
  const idle = await shownView(page);
  const bounds = { center: idle.center, radius: idle.radius };
  await page.keyboard.press("Escape");
  await button(page, "Play animation").click();
  await button(page, "Pause").click();
  await seek(page, "0.5");
  expect(JSON.parse((await snapshot(page)).camera!)).toEqual(
    at(bounds, flight.keys[1]),
  );
  await expect(page.locator(".animation-values")).toHaveText(
    /^t = 3\.14159\d* · Side$/,
  );
  // Pausing holds the camera and the drawing; resuming continues both.
  const held = await snapshot(page);
  await page.waitForTimeout(150);
  expect(await snapshot(page)).toEqual(held);
  await button(page, "Resume").click();
  await expect
    .poll(async () => Number(await stage(page).getAttribute("data-progress")))
    .toBeGreaterThan(0.5);
  await button(page, "Stop").click();

  // Light traced into a mirror, with the camera flying.
  const bowl = spatialPresets.findIndex(
    (p) => p.name === "A spherical bowl's cusped caustic",
  );
  await open(page, study({ mode: "trace" }, spatialPresets[bowl].config));
  await expect(mode(page)).toHaveValue("trace");
  await expect(cameraField(page)).toHaveValue("path");
  const mirror = await shownView(page);
  await page.keyboard.press("Escape");
  await button(page, "Play animation").click();
  await button(page, "Pause").click();
  await seek(page, "0.5");
  expect(JSON.parse((await snapshot(page)).camera!)).toEqual(
    at({ center: mirror.center, radius: mirror.radius }, flight.keys[1]),
  );
  await expect(page.locator(".animation-values")).toHaveText(
    /^Optical path τ = .* caustic points reached · Side$/,
  );
});

test("an export flying the views starts at the first view on the first frame and ends at the last on the last", async ({
  page,
}) => {
  // The number of tangent lines leaves the bounds as they are, so a view
  // shown with either count stands where the flight does.
  const config = { ...spatialPresets[0].config, lines: 30 };
  await open(
    page,
    study(
      {
        mode: "parameters",
        tracks: [{ target: "lines", from: "30", to: "90" }],
      },
      config,
    ),
  );
  const idle = await shownView(page);
  await page.getByText("Sampling & definition", { exact: true }).click();
  const stills: Buffer[] = [];
  for (const [k, lines] of [
    [1, "30"],
    [3, "90"],
  ] as const) {
    await page
      .getByRole("spinbutton", { name: "Tangent lines", exact: true })
      .fill(lines);
    await settled(page);
    await button(page, `Show view ${k}`).click();
    await expect
      .poll(async () => (await shownView(page)).yaw)
      .toBe(flight.keys[k - 1].yaw);
    const shown = await shownView(page);
    expect([shown.center, shown.radius]).toEqual([idle.center, idle.radius]);
    stills.push(await still(page));
  }
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
  expect(file.suggestedFilename()).toBe(
    "tangent-garden-spatial-parameters.mp4",
  );
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
  const ends = [match(0, stills[0]), match(5, stills[1])];
  const crossed = [match(0, stills[1]), match(5, stills[0])];
  if (ends[0] && ends[1] && crossed[0] && crossed[1]) {
    console.log("Flight endpoints", { ends, crossed });
    for (const d of ends) {
      expect(d.meanDifference).toBeLessThan(3);
      expect(d.unmatchedInk).toBeLessThan(0.05);
    }
    for (const d of crossed) expect(d.unmatchedInk).toBeGreaterThan(0.3);
  }
});

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

test("choosing an example without a flight returns the camera to holding the final view", async ({
  page,
}) => {
  await open(page, study({ mode: "reveal" }));
  await expect(cameraField(page)).toHaveValue("path");
  await page.getByRole("button", { name: "Browse notebook examples" }).click();
  await page.locator(`[data-example="1"]`).click();
  await settled(page);
  await expect(mode(page)).toHaveValue("reveal");
  await expect(cameraField(page)).toHaveValue("hold");
  await expect(views(page)).toHaveCount(0);
});

// A layer's polylines in a line drawing of the shown view, in page pixels.
async function linework(page: Page, layer: string) {
  await button(page, "Export image").click();
  const event = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Lines (SVG) · every line", exact: true })
    .click();
  const svg = (await readFile((await (await event).path())!)).toString();
  const group = svg.match(new RegExp(`<g id="${layer}"[^>]*>(.*?)</g>`))![1];
  // Each stroke's d holds its polylines, each begun by M.
  return [...group.matchAll(/ d="([^"]*)"/g)].flatMap((m) =>
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
async function chooseExample(page: Page, title: string) {
  await page.getByRole("button", { name: "Browse notebook examples" }).click();
  await page.locator(`[data-example-title="${title}"]`).click();
  await settled(page);
}

test("a helix's string stays level: edge-on, its involute is one line that climbs as the string lengthens", async ({
  page,
}) => {
  await ready(page);
  await chooseExample(page, "A helix's string, always level");
  // The preset brings its flight, flown while the string length moves.
  await expect(mode(page)).toHaveValue("parameters");
  await expect(cameraField(page)).toHaveValue("path");
  await expect(page.getByLabel("Duration (seconds)")).toHaveValue("24");
  await expect(page.getByLabel("Track 1 from", { exact: true })).toHaveValue(
    "-pi*sqrt(2.81)",
  );
  await expect(page.getByLabel("View 3 name", { exact: true })).toHaveValue(
    "From above: a circle's involute",
  );
  await page.keyboard.press("Escape");
  await button(page, "Play animation").click();
  await button(page, "Pause").click();
  // The first leg turns around the helix at its own level, pitch 0, so the
  // involute's plane is seen edge-on throughout.
  const heights: number[] = [];
  for (const p of ["0", "0.1", "0.2", "0.3"]) {
    await seek(page, p);
    expect(JSON.parse((await snapshot(page)).camera!).pitch).toBe(0);
    const ys = (await linework(page, "filaments")).flat().map((v) => v[1]);
    expect(ys.length).toBeGreaterThan(100);
    const [low, high] = [Math.min(...ys), Math.max(...ys)];
    expect(high - low).toBeLessThan(0.05);
    heights.push(low);
  }
  // Page y grows downward: the level climbs.
  for (let k = 1; k < heights.length; k++)
    expect(heights[k]).toBeLessThan(heights[k - 1] - 10);
});

test("light followed into a trough: end-on, every cross-section is one circle and the light falls straight down the page", async ({
  page,
}) => {
  await ready(page);
  await chooseExample(page, "Following light into a trough");
  await expect(mode(page)).toHaveValue("trace");
  await expect(cameraField(page)).toHaveValue("path");
  await expect(page.getByLabel("Duration (seconds)")).toHaveValue("24");
  await page.keyboard.press("Escape");
  await button(page, "Play animation").click();
  await button(page, "Pause").click();
  // Between its two end-on views the camera looks along the trough.
  await seek(page, "0.5");
  const curves = (await linework(page, "curves")).flat();
  const [x0, x1] = [
    Math.min(...curves.map((v) => v[0])),
    Math.max(...curves.map((v) => v[0])),
  ];
  const radius = (x1 - x0) / 2,
    middle = (x0 + x1) / 2,
    // The rims are level with the axis.
    top = Math.min(...curves.map((v) => v[1]));
  expect(radius).toBeGreaterThan(150);
  for (const [x, y] of curves)
    expect(Math.abs(Math.hypot(x - middle, y - top) - radius)).toBeLessThan(
      0.05,
    );
  // Each incident ray falls straight down the page.
  const rays = await linework(page, "incident");
  expect(rays.length).toBeGreaterThan(10);
  for (const ray of rays)
    for (const [x] of ray) expect(Math.abs(x - ray[0][0])).toBeLessThan(0.05);
  // The light reaches the caustic near the rims first and its cusp last:
  // late in the flight it is still arriving.
  const reached = async () =>
    Number(
      /· ([\d,]+) caustic points reached/
        .exec((await page.locator(".animation-values").textContent())!)![1]
        .replace(/,/g, ""),
    );
  const midway = await reached();
  await seek(page, "0.83");
  const late = await reached();
  await seek(page, "1");
  const all = await reached();
  expect(midway).toBeGreaterThan(0);
  expect(late).toBeGreaterThan(midway);
  expect(all).toBeGreaterThan(late);
  await expect(page.locator(".animation-values")).toContainText(
    "· Down onto the cusp",
  );
});
