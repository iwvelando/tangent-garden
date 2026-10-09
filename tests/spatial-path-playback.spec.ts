import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import { probe, decodeVideo, frameDifference } from "./video";
import { open as openDetails } from "./helpers";
import { spatialPresets } from "../web/spatial/presets";
import { defaultLayers } from "../web/spatial/renderer";
import { pathView, type CameraPath } from "../web/spatial/path";

// Flying the camera through key views, through the real notebook, worker,
// engine and exporter. The geometry stays fixed; only the camera moves.
const stage = (page: Page) => page.locator(".spatial-stage");
const canvas = (page: Page) => page.locator("#spatial-artwork");
const settled = (page: Page) =>
  expect(stage(page)).toHaveAttribute("aria-busy", "false");
const mode = (page: Page) => page.getByLabel("Animate", { exact: true });
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const views = (page: Page) => page.getByRole("group", { name: "Key views" });
const shownView = async (page: Page) =>
  JSON.parse((await canvas(page).getAttribute("data-view"))!);
const animationCamera = async (page: Page) =>
  JSON.parse((await stage(page).getAttribute("data-camera"))!);
const pixels = (page: Page) =>
  canvas(page).evaluate((c: HTMLCanvasElement) => c.toDataURL());
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
const study = (path: CameraPath = flight, duration = 5) => ({
  config: spatialPresets[0].config,
  layers: defaultLayers,
  view: manual,
  animation: { mode: "path", camera: "hold", duration, tracks: [], path },
});
const at = (bounds: object, key: CameraPath["keys"][number]) => ({
  ...bounds,
  yaw: key.yaw,
  pitch: key.pitch,
  zoom: key.zoom,
  panX: key.panX,
  panY: key.panY,
});

test("key views are taken from the drawing, shown, set again and removed", async ({
  page,
}) => {
  await ready(page);
  await mode(page).selectOption("path");
  await expect(page.locator("#spatial-animation-section")).toContainText(
    "Fly the camera through your key views",
  );
  // The path is the camera: there is no other to choose.
  await expect(
    page.getByLabel("Animation camera", { exact: true }),
  ).toHaveCount(0);
  await button(page, "Play animation").click();
  await expect(page.locator(".animation-error")).toContainText(
    "Key views need at least two views to fly between.",
  );
  const add = button(page, "+ Add the drawing's view");
  await add.click();
  await expect(views(page)).toContainText("yaw 17°, pitch 43°, zoom 1.00×");
  // The first view has no leg before it, so no turns.
  await expect(page.getByLabel("View 1 turns", { exact: true })).toHaveCount(0);
  await canvas(page).focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("+");
  await add.click();
  await expect(views(page)).toContainText("yaw 46°, pitch 43°, zoom 1.10×");
  await expect(page.getByLabel("View 2 turns", { exact: true })).toHaveValue(
    "0",
  );
  // Showing a view puts the drawing's camera there, to adjust it.
  await button(page, "Show view 1").click();
  await expect.poll(async () => (await shownView(page)).yaw).toBe(0.3);
  expect((await shownView(page)).zoom).toBe(1);
  await canvas(page).focus();
  await page.keyboard.press("ArrowDown");
  await button(page, "Set view 2 to the drawing's view").click();
  await expect(views(page)).toContainText("yaw 17°, pitch 49°, zoom 1.00×");
  await page.getByLabel("View 2 name", { exact: true }).fill("Lower");
  // A third view, two turns after the second.
  await add.click();
  await page.getByLabel("View 3 turns", { exact: true }).fill("2");
  await page.getByLabel("View 3 turns", { exact: true }).fill("2.5");
  await button(page, "Play animation").click();
  await expect(page.locator(".animation-error")).toContainText(
    "View 3 turns must be a whole number from −8 to 8.",
  );
  await page.getByLabel("View 3 turns", { exact: true }).fill("2");
  // Removing the first view clears the turns of the one after it: the
  // remaining two play.
  await page.getByLabel("View 2 turns", { exact: true }).fill("3");
  await button(page, "Remove view 1").click();
  await expect(page.getByLabel("View 1 name", { exact: true })).toHaveValue(
    "Lower",
  );
  await expect(page.getByLabel("View 1 turns", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("View 2 turns", { exact: true })).toHaveValue(
    "2",
  );
  await button(page, "Play animation").click();
  await expect(stage(page)).toHaveAttribute("data-mode", "path");
  await button(page, "Stop").click();
  // Twelve views at most.
  for (let k = 2; k < 12; k++) await add.click();
  await expect(add).toBeDisabled();
});

test("the flight stands at each view exactly, passes between them, and Stop and Back to study restore the manual camera", async ({
  page,
}) => {
  await open(page, study());
  await expect(mode(page)).toHaveValue("path");
  await expect(page.getByLabel("Path", { exact: true })).toHaveValue("smooth");
  const idle = await shownView(page);
  expect(idle).toMatchObject(manual);
  const bounds = { center: idle.center, radius: idle.radius };
  await page.keyboard.press("Escape");
  await button(page, "Play animation").click();
  await expect(stage(page)).toHaveAttribute("data-mode", "path");
  await button(page, "Pause").click();
  // At each view, the camera is that view about the study's bounds, and the
  // drawing is the one its manual camera draws.
  const ends: string[] = [];
  for (const [p, k] of [
    ["0", 0],
    ["0.5", 1],
  ] as const) {
    await seek(page, p);
    expect(await animationCamera(page)).toEqual(at(bounds, flight.keys[k]));
    await expect(page.locator(".animation-values")).toHaveText(
      flight.keys[k].name,
    );
    ends.push(await pixels(page));
  }
  // Between views, the path's camera, named by its leg.
  await seek(page, "0.25");
  const between = await animationCamera(page),
    expected = pathView(flight, bounds as never, 0.25);
  for (const key of ["yaw", "pitch", "zoom", "panX", "panY"] as const)
    expect(between[key]).toBeCloseTo(expected[key], 12);
  await expect(page.locator(".animation-values")).toHaveText("Start → Side");
  // Stop restores the manual camera.
  await button(page, "Stop").click();
  await expect.poll(async () => (await shownView(page)).yaw).toBe(manual.yaw);
  expect(await shownView(page)).toEqual(idle);
  // The drawing at a view, with the manual camera there.
  for (const k of [0, 1]) {
    await button(page, `Show view ${k + 1}`).click();
    await expect
      .poll(async () => (await shownView(page)).yaw)
      .toBe(flight.keys[k].yaw);
    expect(await pixels(page)).toBe(ends[k]);
  }
  // Playing to the end releases the last view to explore; Back to study
  // restores the manual camera, here the second view as shown.
  await page.getByLabel("Duration (seconds)").fill("0.4");
  await button(page, "Play animation").click();
  await expect(button(page, "Back to study")).toBeVisible();
  expect(await shownView(page)).toEqual(at(bounds, flight.keys[2]));
  await expect(page.locator(".animation-values")).toHaveText("Away");
  await button(page, "Back to study").click();
  await expect
    .poll(async () => await shownView(page))
    .toEqual(at(bounds, flight.keys[1]));
});

test("leg times set each leg's share of the flight: the camera keeps to them, the views say when they are reached, and a link carries them", async ({
  page,
}) => {
  await open(page, study());
  const leg = (k: number, p: Page = page) =>
    p.getByLabel(`View ${k} leg time`, { exact: true });
  // The first view has no leg before it; the others take 1 until set.
  await expect(leg(1)).toHaveCount(0);
  await expect(leg(2)).toHaveValue("1");
  await expect(views(page)).toContainText("reached 50% of the way");
  await leg(2).fill("3");
  await expect(views(page)).toContainText("reached 75% of the way");
  await expect(views(page)).not.toContainText("reached 50% of the way");
  const timed: CameraPath = {
    ...flight,
    keys: flight.keys.map((k, i) => (i === 1 ? { ...k, leg: 3 } : k)),
  };
  const idle = await shownView(page);
  const bounds = { center: idle.center, radius: idle.radius };
  await page.keyboard.press("Escape");
  await button(page, "Play animation").click();
  await button(page, "Pause").click();
  // The second view is reached three quarters of the way through.
  await seek(page, "0.75");
  expect(await animationCamera(page)).toEqual(at(bounds, flight.keys[1]));
  await expect(page.locator(".animation-values")).toHaveText("Side");
  await seek(page, "0.5");
  await expect(page.locator(".animation-values")).toHaveText("Start → Side");
  const between = await animationCamera(page),
    expected = pathView(timed, bounds as never, 0.5);
  for (const key of ["yaw", "pitch", "zoom", "panX", "panY"] as const)
    expect(between[key]).toBeCloseTo(expected[key], 12);
  await seek(page, "0.875");
  await expect(page.locator(".animation-values")).toHaveText("Side → Away");
  await button(page, "Stop").click();
  // A time outside its limits is named, and the views stop saying when
  // they are reached.
  await leg(3).fill("20");
  await expect(views(page)).not.toContainText("reached");
  await button(page, "Play animation").click();
  await expect(page.locator(".animation-error")).toContainText(
    "View 3 leg time must be from 0.1 to 10.",
  );
  await leg(3).fill("0.5");
  await expect(views(page)).toContainText("reached 0% of the way");
  await expect(views(page)).toContainText("reached 86% of the way");
  // A copied link carries the times.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await button(page, "Copy link").click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const href = await page.evaluate(() => navigator.clipboard.readText());
  const other = await page.context().newPage();
  await other.goto(href);
  await expect(canvas(other)).toBeVisible();
  await settled(other);
  await openPanel(other);
  await expect(leg(2, other)).toHaveValue("3");
  await expect(leg(3, other)).toHaveValue("0.5");
  // Removing the first view drops the new first view's time with its leg,
  // and setting a view to the drawing keeps its time.
  await button(page, "Set view 3 to the drawing's view").click();
  await expect(leg(3)).toHaveValue("0.5");
  await button(page, "Remove view 1").click();
  await expect(leg(1)).toHaveCount(0);
  await expect(leg(2)).toHaveValue("0.5");
  await expect(views(page)).toContainText("reached 100% of the way");
});

test("a path's export starts at its first view and ends at its last", async ({
  page,
}) => {
  await open(page, study());
  // Stills at the two ends, from the manual camera.
  const stills: Buffer[] = [];
  for (const k of [1, 3]) {
    await button(page, `Show view ${k}`).click();
    await expect
      .poll(async () => (await shownView(page)).yaw)
      .toBe(flight.keys[k - 1].yaw);
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
  expect(file.suggestedFilename()).toBe("tangent-garden-spatial-path.mp4");
  const path = (await file.path())!;
  const data = probe(path);
  if (data) {
    expect(data.frames).toBe(6);
    expect([data.width, data.height]).toEqual([2000, 1520]);
    expect(data.durations.reduce((a, b) => a + b, 0)).toBe(400);
  }
  const video = await decodeVideo(page, await readFile(path));
  expect(video.duration).toBeCloseTo(0.4, 3);
  expect(video.first.hash).not.toBe(video.last.hash);
  const match = (index: number, reference: Buffer) =>
    frameDifference(path, 2000, 1520, index, reference);
  const ends = [match(0, stills[0]), match(5, stills[1])];
  const crossed = [match(0, stills[1]), match(5, stills[0])];
  if (ends[0] && ends[1] && crossed[0] && crossed[1]) {
    console.log("Path endpoints", { ends, crossed });
    for (const d of ends) {
      expect(d.meanDifference).toBeLessThan(3);
      expect(d.unmatchedInk).toBeLessThan(0.05);
    }
    for (const d of crossed) expect(d.unmatchedInk).toBeGreaterThan(0.3);
  }
  // The export leaves the study and its manual camera as they were.
  await expect(stage(page)).not.toHaveAttribute("data-progress");
  expect((await shownView(page)).yaw).toBe(flight.keys[2].yaw);
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

test("the path and its views travel in a copied link", async ({ page }) => {
  await open(page, study());
  await page.getByLabel("View 2 name", { exact: true }).fill("Edge on");
  await page.getByLabel("Path", { exact: true }).selectOption("steady");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await button(page, "Copy link").click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const href = await page.evaluate(() => navigator.clipboard.readText());
  const other = await page.context().newPage();
  await other.goto(href);
  await expect(canvas(other)).toBeVisible();
  await settled(other);
  await openPanel(other);
  await expect(mode(other)).toHaveValue("path");
  await expect(other.getByLabel("Path", { exact: true })).toHaveValue("steady");
  await expect(other.getByLabel("View 2 name", { exact: true })).toHaveValue(
    "Edge on",
  );
  await expect(other.getByLabel("View 3 turns", { exact: true })).toHaveValue(
    "1",
  );
});

test("views move up and down with their turns and leg times, and travel in their new order", async ({
  page,
}) => {
  await open(page, study());
  const name = (k: number) =>
    page.getByLabel(`View ${k} name`, { exact: true });
  const field = (k: number, f: string) =>
    page.getByLabel(`View ${k} ${f}`, { exact: true });
  await expect(button(page, "Move view 1 up")).toBeDisabled();
  await expect(button(page, "Move view 3 down")).toBeDisabled();
  await field(3, "leg time").fill("2");
  await button(page, "Move view 3 up").click();
  await expect(name(2)).toHaveValue("Away");
  await expect(name(3)).toHaveValue("Side");
  // Turns and leg time move with their view, and the readout follows the
  // legs' new times: 2 then 1.
  await expect(field(2, "turns")).toHaveValue("1");
  await expect(field(2, "leg time")).toHaveValue("2");
  await expect(field(3, "turns")).toHaveValue("0");
  await expect(field(3, "leg time")).toHaveValue("1");
  await expect(views(page)).toContainText("reached 67% of the way");
  // Focus follows the view moved.
  await expect(button(page, "Move view 2 up")).toBeFocused();
  // The new order plays and travels in a copied link.
  await button(page, "Play animation").click();
  await expect(stage(page)).toHaveAttribute("data-mode", "path");
  await button(page, "Stop").click();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await button(page, "Copy link").click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const href = await page.evaluate(() => navigator.clipboard.readText());
  const other = await page.context().newPage();
  await other.goto(href);
  await expect(canvas(other)).toBeVisible();
  await settled(other);
  await openPanel(other);
  for (const [k, value] of ["Start", "Away", "Side"].entries())
    await expect(
      other.getByLabel(`View ${k + 1} name`, { exact: true }),
    ).toHaveValue(value);
  await expect(
    other.getByLabel("View 2 leg time", { exact: true }),
  ).toHaveValue("2");
  await other.close();
  // A view moved to the front has no leg before it; the view it passes
  // starts from no turns and a leg of 1.
  await button(page, "Move view 2 up").click();
  await expect(name(1)).toHaveValue("Away");
  await expect(name(2)).toHaveValue("Start");
  await expect(field(1, "turns")).toHaveCount(0);
  await expect(field(2, "turns")).toHaveValue("0");
  await expect(field(2, "leg time")).toHaveValue("1");
  await expect(button(page, "Move view 1 down")).toBeFocused();
  await button(page, "Move view 1 down").click();
  await expect(name(1)).toHaveValue("Start");
  await expect(name(2)).toHaveValue("Away");
  await expect(button(page, "Move view 2 down")).toBeFocused();
});

test("focus follows a moved view the way it went, even when the press did not focus the button", async ({
  page,
}) => {
  await open(page, study());
  // Safari, on a tap or a click, leaves a pressed button unfocused.
  const press = async (name: string) => {
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    await button(page, name).evaluate((b: HTMLButtonElement) => b.click());
  };
  await press("Move view 1 down");
  await expect(page.getByLabel("View 2 name", { exact: true })).toHaveValue(
    "Start",
  );
  await expect(button(page, "Move view 2 down")).toBeFocused();
  await press("Move view 3 up");
  await expect(page.getByLabel("View 2 name", { exact: true })).toHaveValue(
    "Away",
  );
  await expect(button(page, "Move view 2 up")).toBeFocused();
  // At the end it can go no further, so focus takes the other way.
  await press("Move view 2 down");
  await expect(button(page, "Move view 3 up")).toBeFocused();
});

test("long view names wrap in full at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const long = "A long look along the curve's axis, from below the base";
  await open(
    page,
    study({
      ...flight,
      keys: flight.keys.map((key, k) =>
        k === 1 ? { ...key, name: long } : key,
      ),
    }),
  );
  const name = page.getByLabel("View 2 name", { exact: true });
  await expect(name).toHaveValue(long);
  const fits = () =>
    name.evaluate((e) => ({
      x: e.scrollWidth <= e.clientWidth,
      y: e.scrollHeight <= e.clientHeight,
    }));
  const height = (k: number, f: string) =>
    page
      .getByLabel(`View ${k} ${f}`, { exact: true })
      .evaluate((e) => e.getBoundingClientRect().height);
  // A short name takes one line, as high as the fields beside it.
  const line = await height(2, "turns");
  expect(await height(1, "name")).toBe(line);
  // The long one shows whole, on more lines.
  expect(await fits()).toEqual({ x: true, y: true });
  expect(await height(2, "name")).toBeGreaterThan(line);
  // Enter adds no line of its own.
  await name.press("End");
  await name.press("Enter");
  await expect(name).toHaveValue(long);
  // The fields beneath move down to make room rather than lie under it.
  const below = async () => {
    const [n, t] = await Promise.all([
      name.boundingBox(),
      page.getByLabel("View 2 turns", { exact: true }).boundingBox(),
    ]);
    return t!.y - (n!.y + n!.height);
  };
  const gap = await below();
  expect(gap).toBeGreaterThan(0);
  await name.fill("Short");
  await expect.poll(fits).toMatchObject({ x: true, y: true });
  expect(await height(2, "name")).toBe(line);
  expect(await below()).toBeCloseTo(gap, 0);
});

test("pausing holds the camera, resuming continues, and a change of study stops the flight", async ({
  page,
}) => {
  await open(page, study(flight, 3));
  await button(page, "Play animation").click();
  await expect(stage(page)).toHaveAttribute("data-mode", "path");
  await button(page, "Pause").click();
  const held = await animationCamera(page);
  const progress = await stage(page).getAttribute("data-progress");
  await page.waitForTimeout(150);
  expect(await animationCamera(page)).toEqual(held);
  expect(await stage(page).getAttribute("data-progress")).toBe(progress);
  await button(page, "Resume").click();
  await expect
    .poll(async () => Number(await stage(page).getAttribute("data-progress")))
    .toBeGreaterThan(Number(progress));
  // Editing the study stops the flight and restores the manual camera.
  await page
    .getByRole("textbox", { name: "Major radius R", exact: true })
    .fill("2.5");
  await expect(stage(page)).not.toHaveAttribute("data-mode", "path");
  await expect.poll(async () => (await shownView(page)).yaw).toBe(manual.yaw);
});

// The base curve's vertices in a line drawing of the shown view, in page
// pixels.
async function baseCurve(page: Page) {
  await button(page, "Export image").click();
  const event = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Lines (SVG) · every line", exact: true })
    .click();
  const svg = (await readFile((await (await event).path())!)).toString();
  const group = svg.match(/<g id="base"[^>]*>(.*?)<\/g>/)![1];
  return [...group.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map(
    (m) => [+m[1], +m[2]] as const,
  );
}
const extent = (values: number[]) => [Math.min(...values), Math.max(...values)];

test("Viviani's curve flies from its circle to its figure-eight and around its crossing, as drawn", async ({
  page,
}) => {
  await ready(page);
  await page.getByRole("button", { name: "Browse notebook examples" }).click();
  await page
    .locator(`[data-example-title="Viviani's curve, from every side"]`)
    .click();
  await settled(page);
  // The preset brings its flight.
  await expect(mode(page)).toHaveValue("path");
  await expect(page.getByLabel("Path", { exact: true })).toHaveValue("smooth");
  await expect(page.getByLabel("Duration (seconds)")).toHaveValue("30");
  await expect(page.getByLabel("View 7 name", { exact: true })).toHaveValue(
    "Oblique again",
  );
  await expect(page.getByLabel("View 6 turns", { exact: true })).toHaveValue(
    "1",
  );
  const a = 1.5;
  // End-on, the curve is the cylinder's circle: every vertex at one
  // distance from the middle of its extent.
  await button(page, "Show view 2").click();
  await expect.poll(async () => (await shownView(page)).zoom).toBe(1.6);
  const circle = await baseCurve(page);
  const [x0, x1] = extent(circle.map((p) => p[0])),
    [y0, y1] = extent(circle.map((p) => p[1]));
  const radius = (x1 - x0) / 2;
  expect(radius).toBeGreaterThan(200);
  for (const [x, y] of circle)
    expect(
      Math.abs(Math.hypot(x - (x0 + x1) / 2, y - (y0 + y1) / 2) - radius),
    ).toBeLessThan(0.05);
  // Side-on, the figure-eight y² = z²(1 − (z / 2a)²), with z across the
  // page (4a wide) and y up it.
  await button(page, "Show view 3").click();
  await expect.poll(async () => (await shownView(page)).zoom).toBe(1.3);
  const eight = await baseCurve(page);
  const [u0, u1] = extent(eight.map((p) => p[0])),
    [v0, v1] = extent(eight.map((p) => p[1]));
  const scale = (u1 - u0) / (4 * a);
  expect((v1 - v0) / scale).toBeCloseTo(2 * a, 2);
  for (const [u, v] of eight) {
    const z = (u - (u0 + u1) / 2) / scale,
      y = ((v0 + v1) / 2 - v) / scale;
    expect(Math.abs(y * y - z * z * (1 - (z / (2 * a)) ** 2))).toBeLessThan(
      2e-3,
    );
  }
  // Halfway around the crossing (3, 0, 0), it stays in the middle of the
  // page: the curve passes through it there.
  await page.keyboard.press("Escape");
  await button(page, "Play animation").click();
  await button(page, "Pause").click();
  await seek(page, "0.75");
  await expect(page.locator(".animation-values")).toHaveText(
    "The crossing → Around the crossing",
  );
  const around = await baseCurve(page);
  const nearest = Math.min(
    ...around.map(([x, y]) => Math.hypot(x - 1000, y - 760)),
  );
  expect(nearest).toBeLessThan(3);
  // Choosing another example clears the flight.
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByRole("button", { name: "Browse notebook examples" }).click();
  await page.locator(`[data-example="0"]`).click();
  await settled(page);
  await expect(mode(page)).toHaveValue("reveal");
  await mode(page).selectOption("path");
  await expect(page.getByLabel("View 1 name", { exact: true })).toHaveCount(0);
});

test("a rhumb line's flight drops above its pole quickly, sinks in slowly with the pole held in the middle, and returns quickly", async ({
  page,
}) => {
  await ready(page);
  await page.getByRole("button", { name: "Browse notebook examples" }).click();
  await page
    .locator(`[data-example-title="A rhumb line spiraling into its pole"]`)
    .click();
  await settled(page);
  await expect(mode(page)).toHaveValue("path");
  await expect(page.getByLabel("Path", { exact: true })).toHaveValue("steady");
  await expect(page.getByLabel("Repeat", { exact: true })).toHaveValue("loop");
  for (const [k, time] of [
    [2, "1"],
    [3, "6"],
    [4, "0.8"],
  ] as const)
    await expect(
      page.getByLabel(`View ${k} leg time`, { exact: true }),
    ).toHaveValue(time);
  const { center, radius } = await shownView(page);
  await page.keyboard.press("Escape");
  await button(page, "Play animation").click();
  await button(page, "Pause").click();
  // Legs of 1, 6 and 0.8: the pole is reached at 1/7.8 and left at 7/7.8.
  const [above, into] = [1 / 7.8, 7 / 7.8];
  for (const [p, leg] of [
    ["0.1", "Beside the sphere → Above the pole"],
    ["0.2", "Above the pole → Into the spiral"],
    ["0.5", "Above the pole → Into the spiral"],
    ["0.88", "Above the pole → Into the spiral"],
    ["0.92", "Into the spiral → Beside the sphere again"],
  ] as const) {
    await seek(page, p);
    await expect(page.locator(".animation-values")).toHaveText(leg);
    if (leg !== "Above the pole → Into the spiral") continue;
    // Looking straight down the z axis, zooming by equal factors in equal
    // times, with the pole (0, 0, 1) framed: its offset from the framed
    // point, in page pixels at this zoom, is under a pixel.
    const view = await animationCamera(page);
    expect(view.yaw).toBe(0);
    expect(view.pitch).toBe(0);
    expect(view.zoom).toBeCloseTo(8 ** ((+p - above) / (into - above)), 9);
    const size = await canvas(page).boundingBox();
    const perUnit =
      (Math.min(size!.width, size!.height) / 2) * (view.zoom / (1.16 * radius));
    const off = Math.hypot(center.x - view.panX - 0, center.y - view.panY - 0);
    expect(off * perUnit).toBeLessThan(1);
  }
});
