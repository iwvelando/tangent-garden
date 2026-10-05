import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import { choosePreset } from "./helpers";
import { spatialPresets } from "../web/spatial/presets";
import { defaultLayers, initialView } from "../web/spatial/renderer";
import { defaultPath } from "../web/spatial/path";
import { defaultRide } from "../web/spatial/ride";

// The manual camera's Projection, through the real notebook, worker,
// renderer and exporter.
const stage = (page: Page) => page.locator(".spatial-stage");
const canvas = (page: Page) => page.locator("#spatial-artwork");
const settled = (page: Page) =>
  expect(stage(page)).toHaveAttribute("aria-busy", "false");
const projection = (page: Page) =>
  page.getByLabel("Projection", { exact: true });
const caption = (page: Page) => page.locator(".plot-meta > span");
const angle = (page: Page) => page.getByRole("slider", { name: "Lens angle" });
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const shownView = async (page: Page) =>
  JSON.parse((await canvas(page).getAttribute("data-view"))!);
async function openPanel(page: Page) {
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
}
const manual = { yaw: -0.4, pitch: 0.5, zoom: 1.3, panX: 0.2, panY: 0.1 };
const study = (s: object = {}) => ({
  config: spatialPresets[0].config,
  layers: defaultLayers,
  view: manual,
  animation: {
    mode: "reveal",
    camera: "hold",
    duration: 4,
    tracks: [],
    path: defaultPath,
    ride: defaultRide,
  },
  ...s,
});
async function open(page: Page, s: unknown) {
  await page.goto(
    `/?study=3d#s=${deflateRawSync(
      Buffer.from(JSON.stringify({ v: 1, notebook: "3d", study: s })),
    ).toString("base64url")}`,
  );
  await expect(canvas(page)).toBeVisible();
  await settled(page);
}
async function download(page: Page, item: RegExp | string) {
  await button(page, "Export image").click();
  const event = page.waitForEvent("download");
  await page
    .getByRole("menuitem", {
      name: item,
      ...(typeof item === "string" && { exact: true }),
    })
    .click();
  return readFile((await (await event).path())!);
}
// Polylines of the given layers in the visible-lines drawing.
async function lines(page: Page, layers: string[]) {
  const svg = (
    await download(page, "Lines (SVG) · visible only, sampled")
  ).toString();
  return {
    svg,
    lines: layers.flatMap((layer) => {
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
    }),
  };
}
async function still(page: Page) {
  const png = await download(page, /^PNG image/);
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
// The share of points along the line drawing's visible lines (every 4 px,
// away from the edges) with ink in the shaded still within a pixel: the
// same projection drawn by the vertex shader and by scene.ts.
function agreement(
  rgba: Buffer,
  polylines: (readonly (readonly [number, number])[])[],
) {
  const points: [number, number][] = [];
  for (const line of polylines)
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

test("Projection is orthographic by default and offers three labelled lenses", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await settled(page);
  await expect(projection(page)).toHaveValue("orthographic");
  await expect(projection(page).locator("option")).toHaveText([
    "Orthographic",
    "Perspective · narrow, 30°",
    "Perspective · normal, 50°",
    "Perspective · wide, 90°",
    "Perspective · chosen angle",
  ]);
  await expect(angle(page)).toHaveCount(0);
  expect((await shownView(page)).projection).toBeUndefined();
  await expect(caption(page)).toHaveText(
    "Drag to orbit · shift-drag or two fingers to pan · scroll or pinch to zoom · keys: arrows, + / −, Home",
  );
  await projection(page).selectOption("normal");
  await expect
    .poll(async () => (await shownView(page)).projection)
    .toBe("normal");
  await expect(caption(page)).toHaveText(
    "Drag to orbit · shift-drag or two fingers to pan · scroll or pinch to zoom · keys: arrows, + / −, Home",
  );
  await projection(page).selectOption("orthographic");
  await expect
    .poll(async () => (await shownView(page)).projection)
    .toBeUndefined();
});

test("orbit, zoom and Reset view move the camera and keep its projection", async ({
  page,
}) => {
  await open(page, study({ projection: "wide" }));
  await expect(projection(page)).toHaveValue("wide");
  const before = await shownView(page);
  expect(before).toMatchObject({ ...manual, projection: "wide" });
  await canvas(page).focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("+");
  await page.keyboard.press("Shift+ArrowUp");
  const moved = await shownView(page);
  expect(moved.yaw).toBeCloseTo(manual.yaw - 0.1, 12);
  expect(moved.zoom).toBeCloseTo(manual.zoom * 1.1, 12);
  expect(moved.panY).toBeGreaterThan(manual.panY);
  expect(moved.projection).toBe("wide");
  // A drag orbits as before.
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
  const dragged = await shownView(page);
  expect(dragged.yaw).toBeCloseTo(moved.yaw + 50 * 0.008, 6);
  expect(dragged.projection).toBe("wide");
  await button(page, "Reset view").click();
  await expect
    .poll(async () => (await shownView(page)).yaw)
    .toBe(initialView.yaw);
  expect(await shownView(page)).toMatchObject({
    ...initialView,
    projection: "wide",
  });
  await expect(projection(page)).toHaveValue("wide");
  await page.keyboard.press("Home");
  expect((await shownView(page)).projection).toBe("wide");
});

test("the shaded still and the line drawing share the perspective, unlike the orthographic one", async ({
  page,
}) => {
  await open(page, study({ projection: "wide", view: { ...manual, zoom: 1 } }));
  const wide = await lines(page, ["base", "rulings"]);
  const shaded = await still(page);
  expect(agreement(shaded, wide.lines)).toBeGreaterThan(0.9);
  // The files record the projection; the orthographic ones do not.
  expect(wide.svg).toContain('"projection":"wide"');
  expect(wide.svg).toContain("perspective, 90° across the page's shorter side");
  const embedded = (await download(page, /^SVG/)).toString();
  expect(embedded).toContain('"projection":"wide"');
  await projection(page).selectOption("orthographic");
  await expect
    .poll(async () => (await shownView(page)).projection)
    .toBeUndefined();
  const flat = await lines(page, ["base", "rulings"]);
  expect(flat.svg).not.toMatch(/"projection":"/);
  expect(flat.svg).not.toContain("across the page's shorter side");
  // The perspective still is not the orthographic one.
  expect(agreement(await still(page), wide.lines)).toBeLessThan(0.75);
});

test("animations draw in the projection, which cannot change meanwhile, and Stop restores the manual camera", async ({
  page,
}) => {
  await open(
    page,
    study({
      projection: "normal",
      animation: {
        ...study().animation,
        mode: "orbit",
        duration: 6,
      },
    }),
  );
  await openPanel(page);
  const idle = await shownView(page);
  await button(page, "Play animation").click();
  await expect(projection(page)).toBeDisabled();
  await button(page, "Pause").click();
  await page.getByRole("slider", { name: "Animation progress" }).fill("0.25");
  await expect(stage(page)).toHaveAttribute("data-progress", "0.25");
  const turning = await shownView(page);
  expect(turning.projection).toBe("normal");
  expect(turning.yaw).toBeCloseTo(manual.yaw + Math.PI / 2, 6);
  await button(page, "Stop").click();
  await expect(projection(page)).toBeEnabled();
  await expect.poll(() => shownView(page)).toEqual(idle);
});

test("a camera path flies in the drawing's projection, and a finished one is explored in it", async ({
  page,
}) => {
  const keys = [
    { name: "Out", yaw: 0, pitch: 0.2, zoom: 1, panX: 0, panY: 0, turns: 0 },
    { name: "In", yaw: 1, pitch: 0.6, zoom: 4, panX: 0, panY: 0, turns: 0 },
  ];
  await open(
    page,
    study({
      projection: "wide",
      animation: {
        ...study().animation,
        mode: "path",
        duration: 4,
        path: { style: "steady", keys },
      },
    }),
  );
  await openPanel(page);
  await button(page, "Play animation").click();
  await button(page, "Pause").click();
  await page.getByRole("slider", { name: "Animation progress" }).fill("0.5");
  await expect(stage(page)).toHaveAttribute("data-progress", "0.5");
  const mid = await shownView(page);
  expect(mid).toMatchObject({ projection: "wide", yaw: 0.5, pitch: 0.4 });
  expect(mid.zoom).toBeCloseTo(2, 9);
  await page.getByRole("slider", { name: "Animation progress" }).fill("1");
  await expect(stage(page)).toHaveAttribute("data-progress", "1");
  await expect(button(page, "Back to study")).toBeVisible();
  await canvas(page).focus();
  await page.keyboard.press("ArrowLeft");
  const explored = await shownView(page);
  expect(explored.projection).toBe("wide");
  expect(explored.yaw).toBeCloseTo(0.9, 12);
  await button(page, "Back to study").click();
  await expect
    .poll(async () => (await shownView(page)).yaw)
    .toBeCloseTo(manual.yaw, 12);
});

test("a link carries the projection, and a preset without one opens orthographic", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await settled(page);
  await projection(page).selectOption("narrow");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await button(page, "Copy link").click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const href = await page.evaluate(() => navigator.clipboard.readText());
  const other = await page.context().newPage();
  await other.goto(href);
  await settled(other);
  await expect(projection(other)).toHaveValue("narrow");
  expect((await shownView(other)).projection).toBe("narrow");
  await choosePreset(other, 1);
  await settled(other);
  await expect(projection(other)).toHaveValue("orthographic");
  expect((await shownView(other)).projection).toBeUndefined();
});

test("the perspective presets open in their own projection and view, and fly in it", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await settled(page);
  await openPanel(page);
  const progress = page.getByRole("slider", { name: "Animation progress" });
  // The stair seen down its well, through the wide lens.
  await choosePreset(page, { label: "A spiral stair, down its well" });
  await settled(page);
  await expect(projection(page)).toHaveValue("wide");
  await expect.poll(async () => (await shownView(page)).pitch).toBe(1.5);
  expect(await shownView(page)).toMatchObject({
    yaw: 0.3,
    pitch: 1.5,
    zoom: 1.2,
    panX: 0,
    panY: 0,
    projection: "wide",
  });
  // Reset view returns to the default view, through the same lens.
  await button(page, "Reset view").click();
  await expect
    .poll(async () => (await shownView(page)).pitch)
    .toBe(initialView.pitch);
  expect((await shownView(page)).projection).toBe("wide");
  // The dive flies out and back through the normal lens: halfway through
  // its duration it is at its last view, inside the stair.
  await choosePreset(page, { label: "Diving down the stairwell" });
  await settled(page);
  await expect(projection(page)).toHaveValue("normal");
  await expect(page.getByLabel("Animate", { exact: true })).toHaveValue("path");
  await expect(page.getByLabel("Repeat", { exact: true })).toHaveValue(
    "back-and-forth",
  );
  await button(page, "Play animation").click();
  await button(page, "Pause").click();
  await progress.fill("0.5");
  await expect(stage(page)).toHaveAttribute("data-time", "0.5");
  expect(await shownView(page)).toMatchObject({
    yaw: 3.3,
    pitch: 1.2,
    zoom: 8,
    projection: "normal",
  });
  await button(page, "Stop").click();
  // The tube turns once about the knot's axis, and loops.
  await choosePreset(page, { label: "Inside a trefoil's tube" });
  await settled(page);
  await expect(projection(page)).toHaveValue("wide");
  await expect(page.getByLabel("Repeat", { exact: true })).toHaveValue("loop");
  await button(page, "Play animation").click();
  await expect(button(page, "Pause")).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".animation-error")).toHaveCount(0);
  await button(page, "Pause").click();
  await progress.fill("0.5");
  await expect(stage(page)).toHaveAttribute("data-time", "0.5");
  const half = await shownView(page);
  expect(half.yaw).toBeCloseTo(1.2 + Math.PI, 9);
  expect(half.zoom).toBeCloseTo(3, 12);
  expect(half).toMatchObject({ pitch: 0.3, projection: "wide" });
  await button(page, "Stop").click();
  // An older preset opens orthographic, from the default view.
  await choosePreset(page, { label: "Trefoil · (2, 3)" });
  await settled(page);
  await expect(projection(page)).toHaveValue("orthographic");
  await expect
    .poll(async () => (await shownView(page)).projection)
    .toBeUndefined();
  expect(await shownView(page)).toMatchObject(initialView);
});

test("the chosen angle offers a lens angle beside the named views, from the lens shown before", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await settled(page);
  // From orthographic it starts at the normal lens's angle.
  await projection(page).selectOption("chosen");
  await expect(angle(page)).toHaveValue("50");
  await expect(angle(page)).toHaveAttribute("min", "1");
  await expect(angle(page)).toHaveAttribute("max", "150");
  await expect(page.locator(".lens-angle output")).toHaveText("50°");
  await expect
    .poll(async () => (await shownView(page)).projection)
    .toBe("chosen");
  expect((await shownView(page)).lensAngle).toBe(50);
  // Each step of the slider redraws through its angle.
  await angle(page).fill("140");
  await expect(page.locator(".lens-angle output")).toHaveText("140°");
  await expect.poll(async () => (await shownView(page)).lensAngle).toBe(140);
  await angle(page).focus();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => (await shownView(page)).lensAngle).toBe(139);
  // A named lens hides it, and the drawing keeps no angle of its own.
  await projection(page).selectOption("narrow");
  await expect(angle(page)).toHaveCount(0);
  await expect
    .poll(async () => (await shownView(page)).projection)
    .toBe("narrow");
  expect((await shownView(page)).lensAngle).toBeUndefined();
  // Choosing the angle from a named lens starts at that lens's angle, so
  // the drawing does not move.
  const narrow = await shownView(page);
  await projection(page).selectOption("chosen");
  await expect(angle(page)).toHaveValue("30");
  await expect
    .poll(async () => (await shownView(page)).projection)
    .toBe("chosen");
  expect(await shownView(page)).toEqual({
    ...narrow,
    projection: "chosen",
    lensAngle: 30,
  });
  // From orthographic, the angle last chosen.
  await angle(page).fill("12");
  await projection(page).selectOption("orthographic");
  await expect(angle(page)).toHaveCount(0);
  await projection(page).selectOption("chosen");
  await expect(angle(page)).toHaveValue("12");
});

for (const [width, height] of [
  [1440, 1000],
  [390, 844],
])
  test(`the lens angle moves no control as it appears, ${width} px wide`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/?study=3d");
    await settled(page);
    const boxes = async () =>
      Promise.all(
        [
          projection(page),
          button(page, "Rotate view"),
          button(page, "Reset view"),
          button(page, "Front"),
          button(page, "Isometric"),
          canvas(page),
        ].map(async (l) => (await l.boundingBox())!),
      );
    await projection(page).selectOption("wide");
    const before = await boxes();
    await projection(page).selectOption("chosen");
    await expect(angle(page)).toBeVisible();
    expect(await boxes()).toEqual(before);
    // It sits outside the drawing, below the named views or beside them.
    const slider = (await angle(page).boundingBox())!,
      front = before[3],
      drawing = before[5];
    expect(slider.y).toBeGreaterThanOrEqual(drawing.y + drawing.height);
    expect(slider.y + slider.height / 2).toBeGreaterThanOrEqual(front.y);
    expect(slider.x + slider.width).toBeLessThanOrEqual(width);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });

test("a link and Reset view keep the chosen angle, an animation holds it, and exports record it", async ({
  page,
}) => {
  await open(
    page,
    study({
      projection: "chosen",
      lensAngle: 120,
      // The eye 1.16 / (0.6 tan 60°) = 1.12 radii from the middle, outside
      // the study, where the visible lines stay within their work limit.
      view: { ...manual, zoom: 0.6 },
      animation: { ...study().animation, mode: "orbit", duration: 6 },
    }),
  );
  await expect(projection(page)).toHaveValue("chosen");
  await expect(angle(page)).toHaveValue("120");
  expect(await shownView(page)).toMatchObject({
    projection: "chosen",
    lensAngle: 120,
  });
  // The shaded still and the line drawing share it, and both record it.
  const wide = await lines(page, ["base", "rulings"]);
  expect(agreement(await still(page), wide.lines)).toBeGreaterThan(0.9);
  expect(wide.svg).toContain('"angle":120');
  expect(wide.svg).toContain(
    "perspective, 120° across the page's shorter side",
  );
  await angle(page).fill("20");
  await expect.poll(async () => (await shownView(page)).lensAngle).toBe(20);
  const narrower = await lines(page, ["base", "rulings"]);
  expect(narrower.svg).toContain('"angle":20');
  expect(agreement(await still(page), narrower.lines)).toBeGreaterThan(0.9);
  expect(agreement(await still(page), wide.lines)).toBeLessThan(0.75);
  // Reset view keeps it.
  await button(page, "Reset view").click();
  await expect
    .poll(async () => (await shownView(page)).yaw)
    .toBe(initialView.yaw);
  expect(await shownView(page)).toMatchObject({
    projection: "chosen",
    lensAngle: 20,
  });
  // An orbit draws through it and cannot change it meanwhile.
  await openPanel(page);
  await button(page, "Play animation").click();
  await expect(angle(page)).toBeDisabled();
  await button(page, "Pause").click();
  await page.getByRole("slider", { name: "Animation progress" }).fill("0.25");
  await expect(stage(page)).toHaveAttribute("data-progress", "0.25");
  expect(await shownView(page)).toMatchObject({
    projection: "chosen",
    lensAngle: 20,
  });
  await button(page, "Stop").click();
  await expect(angle(page)).toBeEnabled();
  // A copied link carries it.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await button(page, "Copy link").click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const href = await page.evaluate(() => navigator.clipboard.readText());
  const other = await page.context().newPage();
  await other.goto(href);
  await settled(other);
  await expect(projection(other)).toHaveValue("chosen");
  await expect(angle(other)).toHaveValue("20");
  expect(await shownView(other)).toMatchObject({
    projection: "chosen",
    lensAngle: 20,
  });
  // A preset without its own angle opens orthographic; choosing the angle
  // again starts at the normal lens's.
  await choosePreset(other, 1);
  await settled(other);
  await expect(projection(other)).toHaveValue("orthographic");
  await projection(other).selectOption("chosen");
  await expect(angle(other)).toHaveValue("50");
});

test("the tunnel opens through its own chosen angle with the eye inside the tube, and loops once around", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await settled(page);
  await openPanel(page);
  await choosePreset(page, { label: "Down a torus's tunnel" });
  await settled(page);
  await expect(projection(page)).toHaveValue("chosen");
  await expect(angle(page)).toHaveValue("140");
  await expect.poll(async () => (await shownView(page)).panX).toBe(2);
  const v = await shownView(page);
  expect(v).toMatchObject({
    yaw: Math.PI,
    pitch: 0,
    zoom: 1.5,
    panX: 2,
    panY: 0,
    projection: "chosen",
    lensAngle: 140,
  });
  // The eye, from the turntable's definition: behind the panned target by
  // d = 1.16 r / (zoom tan 70°). The tube is every point within 0.6 of the
  // circle of radius 2 about y in the xz-plane.
  const right = [Math.cos(v.yaw), 0, Math.sin(v.yaw)],
    back = [-Math.sin(v.yaw), 0, Math.cos(v.yaw)];
  const d = (1.16 * v.radius) / (v.zoom * Math.tan((70 * Math.PI) / 180));
  const eye = [0, 1, 2].map(
    (k) =>
      [v.center.x, v.center.y, v.center.z][k] - v.panX * right[k] + d * back[k],
  );
  const offCore = Math.hypot(Math.hypot(eye[0], eye[2]) - 2, eye[1]);
  expect(offCore).toBeLessThan(0.3);
  await expect(page.getByLabel("Animate", { exact: true })).toHaveValue("path");
  await expect(page.getByLabel("Repeat", { exact: true })).toHaveValue("loop");
  await button(page, "Play animation").click();
  await expect(button(page, "Pause")).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".animation-error")).toHaveCount(0);
  await button(page, "Pause").click();
  await page.getByRole("slider", { name: "Animation progress" }).fill("0.5");
  await expect(stage(page)).toHaveAttribute("data-time", "0.5");
  // Halfway, the target has gone half around the core circle.
  const half = await shownView(page);
  expect(half.yaw).toBeCloseTo(2 * Math.PI, 9);
  expect(half).toMatchObject({ projection: "chosen", lensAngle: 140 });
  await button(page, "Stop").click();
  // Another preset opens orthographic again.
  await choosePreset(page, { label: "Inside a trefoil's tube" });
  await settled(page);
  await expect(projection(page)).toHaveValue("wide");
  await expect(angle(page)).toHaveCount(0);
});
