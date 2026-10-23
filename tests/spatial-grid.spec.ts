import { test, expect, type Page } from "@playwright/test";
import {
  flat,
  framing,
  grow,
  gridLayout,
  gridViews,
  planeRect,
} from "../web/spatial/grid";
import { spatialPresets } from "../web/spatial/presets";
import { withShadowPlane } from "../web/spatial/shadow";
import { readFile } from "node:fs/promises";
import { chooseColorScheme, choosePreset, imageButton } from "./helpers";
import { decodePng } from "./png";
import { decodeVideo, probe } from "./video";
import { execFileSync } from "node:child_process";
import { hex, spatialPalette } from "../web/spatial/palette";
import { plotPalette } from "../web/palette";
import type { ShadowResult, SpatialConfig } from "../web/spatial/types";

const staircase = "A staircase's shadow, unwinding",
  trefoil = "A trefoil's feet and their shadow";
const preset = (name: string) =>
  spatialPresets.find((p) => p.name === name)!.config;

test("the grid shows the plane face on three ways where the construction reduces, and once where it does not", () => {
  const feet = preset(trefoil);
  expect(gridViews(feet)).toBeNull();
  const grid = (c: SpatialConfig): SpatialConfig => ({
    ...c,
    shadow: { ...c.shadow!, grid: true },
  });
  expect(gridViews(grid(feet))).toEqual(["planar", "cast", "overlay"]);
  expect(gridLayout(gridViews(grid(feet))!)).toBe("grid");
  // The trefoil's tangent developable, and an involute of a coil, have no
  // 2D counterpart: the plane shows the shadow alone, beside the drawing.
  for (const c of [
    { ...feet, construction: "developable" },
    { ...feet, construction: "involute", input: "coil" },
  ] as SpatialConfig[]) {
    expect(gridViews(grid(c))).toEqual(["shadow"]);
    expect(gridLayout(gridViews(grid(c))!)).toBe("pair");
  }
  // A surface casts no shadow, so it has no grid.
  expect(gridViews(grid({ ...feet, format: "surface" }))).toBeNull();
  // Without a plane there is nothing to show.
  const { shadow: _, ...plain } = feet;
  expect(gridViews(plain as SpatialConfig)).toBeNull();
});

test("the face-on coordinates are the 2D engine's on each plane, seen from the side its normal points to", () => {
  const p = { x: 1, y: 2, z: 3 };
  expect(flat("x", p)).toEqual({ x: 2, y: 3 });
  expect(flat("y", p)).toEqual({ x: 3, y: 1 });
  expect(flat("z", p)).toEqual({ x: 1, y: 2 });
});

test("the plane's frame holds its window, and grows during playback without shrinking", () => {
  const corners = (x0: number, y0: number, x1: number, y1: number) =>
    [
      { x: x0, y: y0, z: -2 },
      { x: x1, y: y0, z: -2 },
      { x: x1, y: y1, z: -2 },
      { x: x0, y: y1, z: -2 },
    ] as ShadowResult["corners"];
  const shadow = (c: ShadowResult["corners"]) =>
    ({ plane: "z", at: -2, corners: c }) as ShadowResult;
  const a = planeRect(shadow(corners(-1, -2, 3, 1)))!;
  expect(a).toEqual({ x0: -1, y0: -2, x1: 3, y1: 1 });
  const b = planeRect(shadow(corners(0, -5, 1, 0)))!;
  expect(grow(a, b)).toEqual({ x0: -1, y0: -5, x1: 3, y1: 1 });
  // In either order: each side is the farther of the two.
  expect(grow(b, a)).toEqual({ x0: -1, y0: -5, x1: 3, y1: 1 });
  expect(grow(null, b)).toEqual(b);
  // The drawing's 1000 × 760 page holds the window, centered, with equal
  // axis scale; the camera pans in page units and zooms about the middle.
  const f = framing(a, { x: 0, y: 0, zoom: 1 });
  expect(f.cx).toBe(1);
  expect(f.cy).toBe(-0.5);
  expect(4 * f.scale).toBeLessThanOrEqual(1000);
  expect(3 * f.scale).toBeLessThanOrEqual(760);
  expect(Math.max(4 * f.scale, (3 * f.scale * 1000) / 760)).toBeCloseTo(
    1000 * 0.94,
  );
  const moved = framing(a, { x: 100, y: -50, zoom: 2 });
  expect(moved.scale).toBe(2 * f.scale);
  expect(moved.cx).toBeCloseTo(1 - 100 / moved.scale);
  expect(moved.cy).toBeCloseTo(-0.5 - 50 / moved.scale);
});

test("choosing another plane keeps the grid on", () => {
  const c = preset(trefoil);
  const on = { ...c, shadow: { ...c.shadow!, grid: true } };
  expect(withShadowPlane(on, "x").shadow?.grid).toBe(true);
  expect(withShadowPlane(c, "x").shadow?.grid).toBeUndefined();
});

const stage = (page: Page) => page.locator(".spatial-stage");
const settled = (page: Page) =>
  expect(stage(page)).toHaveAttribute("aria-busy", "false");
const gridBox = (page: Page) =>
  page.getByRole("checkbox", {
    name: "Face-on views beside the drawing",
    exact: true,
  });
const view = (page: Page, name: string) =>
  page.locator(`svg[data-plane-view="${name}"]`);
const captions = (page: Page) =>
  page.locator(".spatial-canvas-wrap figcaption");
async function open(page: Page, name: string) {
  await page.goto("/?study=3d");
  await settled(page);
  await choosePreset(page, { label: name });
  await settled(page);
}
// A path's points on the page, from its d attribute.
const points = (d: string) =>
  [...d.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map((m) => [+m[1], +m[2]]);
async function pathPoints(page: Page, testid: string, within: string) {
  const ds = await view(page, within)
    .getByTestId(testid)
    .evaluateAll((paths) => paths.map((p) => p.getAttribute("d") ?? ""));
  return ds.map(points);
}

test("the grid shows the drawing beside three face-on views that pan and zoom together", async ({
  page,
}) => {
  await open(page, trefoil);
  const canvas = page.locator("#spatial-artwork");
  const single = await canvas.boundingBox();
  await expect(captions(page)).toHaveCount(0);
  await gridBox(page).check();
  await settled(page);
  await expect(page.locator(".spatial-canvas-wrap")).toHaveAttribute(
    "data-layout",
    "grid",
  );
  await expect(captions(page)).toHaveText([
    "The 3D drawing",
    "2D pedal of the shadow",
    "Shadow of the 3D tangent-foot curve",
    "Both, face on",
  ]);
  // The 2D notebook's own drawing: its curve, construction and lines.
  const planar = view(page, "planar");
  await expect(planar.getByTestId("base-curve")).toHaveCount(1);
  await expect(planar.getByTestId("derived-curve")).toHaveCount(1);
  expect(await planar.locator("line").count()).toBeGreaterThan(10);
  // The cast and overlay views draw the 3D construction's shadow; the
  // overlay has the 2D construction beneath it, the same rust path the
  // 3D drawing lays on the plane.
  await expect(view(page, "cast").getByTestId("plane-cast")).toHaveCount(1);
  await expect(view(page, "cast").getByTestId("plane-planar")).toHaveCount(0);
  await expect(view(page, "overlay").getByTestId("plane-planar")).toHaveCount(
    1,
  );
  const [castAlone] = await pathPoints(page, "plane-cast", "cast");
  const [castOver] = await pathPoints(page, "plane-cast", "overlay");
  expect(castOver).toEqual(castAlone);
  // The 2D drawing and the overlay draw the 2D construction at the same
  // place on the page: its derived curve is the overlay's rust path.
  const derived = points(
    (await planar.getByTestId("derived-curve").first().getAttribute("d"))!,
  );
  const [rust] = await pathPoints(page, "plane-planar", "overlay");
  expect(derived.length).toBeGreaterThan(100);
  const near = (p: number[]) =>
    Math.min(...rust.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])));
  for (const p of derived.filter((_, i) => i % 25 === 0))
    expect(near(p)).toBeLessThan(0.05);
  // The 3D drawing shrinks to its cell.
  const cell = await canvas.boundingBox();
  expect(cell!.width).toBeLessThan(single!.width * 0.6);
  // A wheel over one face-on view zooms all three alike; the 3D drawing
  // keeps its own camera.
  const scales = () =>
    page
      .locator("svg[data-plane-view]")
      .evaluateAll((svgs) =>
        svgs.map((s) => s.getAttribute("data-camera-scale")),
      );
  const fitted = await scales();
  expect(new Set(fitted).size).toBe(1);
  const box = (await view(page, "cast").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => (await scales())[0]).not.toBe(fitted[0]);
  const zoomed = await scales();
  expect(new Set(zoomed).size).toBe(1);
  // A drag over another pans all three; Home fits them again.
  const centers = () =>
    page
      .locator("svg[data-plane-view]")
      .evaluateAll((svgs) =>
        svgs.map((s) => s.getAttribute("data-camera-center")),
      );
  const before = await centers();
  const over = (await view(page, "overlay").boundingBox())!;
  await page.mouse.move(over.x + 100, over.y + 100);
  await page.mouse.down();
  await page.mouse.move(over.x + 160, over.y + 130, { steps: 4 });
  await page.mouse.up();
  const after = await centers();
  expect(after[0]).not.toBe(before[0]);
  expect(new Set(after).size).toBe(1);
  await page.locator(".plane-view").first().focus();
  await page.keyboard.press("Home");
  await expect.poll(scales).toEqual(fitted);
  // Turning the grid off restores the one drawing at its full size.
  await gridBox(page).uncheck();
  await settled(page);
  await expect(captions(page)).toHaveCount(0);
  await expect(page.locator("svg[data-plane-view]")).toHaveCount(0);
  // (The page may have scrolled.)
  const restored = (await canvas.boundingBox())!;
  expect([restored.width, restored.height]).toEqual([
    single!.width,
    single!.height,
  ]);
});

test("a construction without a 2D counterpart shows the shadow face on beside the drawing", async ({
  page,
}) => {
  await open(page, trefoil);
  await gridBox(page).check();
  await settled(page);
  await page
    .getByLabel("Construction", { exact: true })
    .selectOption("developable");
  await settled(page);
  await expect(page.locator(".spatial-canvas-wrap")).toHaveAttribute(
    "data-layout",
    "pair",
  );
  await expect(captions(page)).toHaveText([
    "The 3D drawing",
    "The shadow, face on",
  ]);
  await expect(view(page, "shadow").getByTestId("plane-shadow")).toHaveCount(1);
  // Back to a construction that reduces, the grid returns.
  await page
    .getByLabel("Construction", { exact: true })
    .selectOption("tangent-foot");
  await settled(page);
  await expect(page.locator(".spatial-canvas-wrap")).toHaveAttribute(
    "data-layout",
    "grid",
  );
});

test("on a phone the views stack at the page's proportions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, trefoil);
  await gridBox(page).check();
  await settled(page);
  const cells = page.locator(".spatial-canvas-wrap .cell-drawing");
  await expect(cells).toHaveCount(4);
  const boxes = await cells.evaluateAll((els) =>
    els.map((e) => e.getBoundingClientRect().toJSON()),
  );
  for (let k = 0; k < boxes.length; k++) {
    expect(boxes[k].width).toBeGreaterThan(300);
    expect(boxes[k].height / boxes[k].width).toBeCloseTo(760 / 1000, 1);
    if (k) expect(boxes[k].top).toBeGreaterThan(boxes[k - 1].bottom);
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

const circle = "A tilting circle's cardioid, face on",
  rose = "A rippling rose's mirror images, face on";

test("the grid's examples open in the grid, on a plane clear of the study, and animate toward a flat curve", () => {
  for (const name of [circle, rose]) {
    const p = spatialPresets.find((p) => p.name === name)!;
    expect(gridViews(p.config), name).toEqual(["planar", "cast", "overlay"]);
    expect(p.flight?.animate).toEqual({
      mode: "parameters",
      tracks: [{ target: "a", from: String(p.config.curve.a), to: "0" }],
    });
    expect(p.flight?.repeat).toBe("back-and-forth");
    expect(p.config.shadow!.at).toBeLessThan(-2);
  }
});

for (const [name, enable] of [
  [staircase, true],
  [circle, false],
  [rose, false],
] as const)
  test(`every view draws the animation's frame, and the two constructions coincide face on only when the curve is flat (${name})`, async ({
    page,
  }) => {
    test.slow();
    await open(page, name);
    if (enable) await gridBox(page).check();
    await expect(gridBox(page)).toBeChecked();
    await settled(page);
    const panel = page.locator("#spatial-animation-section");
    if ((await panel.getAttribute("open")) === null)
      await panel.locator(":scope > summary").click();
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    // While playing, the face-on views are framed by the animation.
    await expect(page.locator(".plane-view").first()).toHaveAttribute(
      "data-locked",
      "true",
    );
    // The deviation of the furthest-apart samples, in page units.
    const apart = async () => {
      const planar = await pathPoints(page, "plane-planar", "overlay"),
        cast = await pathPoints(page, "plane-cast", "overlay");
      expect(planar.length).toBe(cast.length);
      let worst = 0;
      planar.forEach((path, k) =>
        path.forEach((p) => {
          const near = Math.min(
            ...cast[k].map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])),
          );
          worst = Math.max(worst, near);
        }),
      );
      return worst;
    };
    // The face-on views frame every window shown since playback began, so
    // they only ever zoom out while it plays.
    const scale = async () =>
      Number(await view(page, "cast").getAttribute("data-camera-scale"));
    const scales = [await scale()];
    for (const [time, flat] of [
      ["0.5", true],
      ["0", false],
      ["0.25", undefined],
    ] as const) {
      await page.getByRole("slider", { name: "Animation progress" }).fill(time);
      await expect(stage(page)).toHaveAttribute("data-time", time);
      await settled(page);
      const progress = await stage(page).getAttribute("data-progress");
      for (const name of ["planar", "cast", "overlay"])
        await expect(view(page, name)).toHaveAttribute(
          "data-animation-progress",
          progress!,
        );
      if (flat) expect(await apart()).toBeLessThan(0.5);
      else if (flat === false) expect(await apart()).toBeGreaterThan(5);
      scales.push(await scale());
    }
    for (let k = 1; k < scales.length; k++)
      expect(scales[k]).toBeLessThanOrEqual(scales[k - 1]);
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await settled(page);
    await expect(page.locator(".plane-view").first()).not.toHaveAttribute(
      "data-locked",
    );
  });

async function save(page: Page, item: RegExp | string) {
  await imageButton(page).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: item, exact: typeof item === "string" })
    .click();
  return readFile((await (await download).path())!);
}
const rgb = (color: string) =>
  [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
// The pixels of an image's cell (column, row) near a color.
function inked(
  png: ReturnType<typeof decodePng>,
  cell: { column: number; row: number; width: number; height: number },
  color: string,
) {
  const [r, g, b] = rgb(color);
  let n = 0;
  for (let y = cell.row * cell.height; y < (cell.row + 1) * cell.height; y += 2)
    for (
      let x = cell.column * cell.width;
      x < (cell.column + 1) * cell.width;
      x += 2
    ) {
      const i = 4 * (y * png.width + x);
      if (
        Math.abs(png.rgba[i] - r) +
          Math.abs(png.rgba[i + 1] - g) +
          Math.abs(png.rgba[i + 2] - b) <
        40
      )
        n++;
    }
  return n;
}

test("a still of the grid holds every view in its cell, the face-on ones drawn from vectors at its size", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await open(page, trefoil);
  await gridBox(page).check();
  await settled(page);
  const png = decodePng(await save(page, /^PNG image/));
  // Two cells of 2000 × 1520 a side at the default size.
  expect([png.width, png.height]).toEqual([4000, 3040]);
  const cell = (column: number, row: number) => ({
    column,
    row,
    width: 2000,
    height: 1520,
  });
  const rust = plotPalette(false).derived,
    slate = hex(spatialPalette().slate[0]);
  // The 2D drawing's construction is in its cell, top right; the cast
  // construction's slate alone below it on the left; both at the bottom
  // right; and the 3D drawing, top left, has the plane's rust and slate.
  expect(inked(png, cell(1, 0), rust)).toBeGreaterThan(2000);
  expect(inked(png, cell(0, 1), slate)).toBeGreaterThan(1000);
  expect(inked(png, cell(0, 1), rust)).toBeLessThan(50);
  expect(inked(png, cell(1, 1), slate)).toBeGreaterThan(500);
  expect(inked(png, cell(1, 1), hex(spatialPalette().rust[0]))).toBeGreaterThan(
    2000,
  );
  expect(inked(png, cell(0, 0), hex(spatialPalette().rust[0]))).toBeGreaterThan(
    200,
  );
  const meta = (svg: string) =>
    JSON.parse(
      svg
        .match(/<desc>(.*?)<\/desc>/)![1]
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&amp;", "&"),
    );
  // The SVG embeds the 3D drawing at a cell's size and keeps the face-on
  // views as vectors, recording the grid.
  const svg = (await save(page, /^SVG · embedded/)).toString();
  expect(svg).toMatch(
    /^<svg [^>]*width="4000" height="3040" viewBox="0 0 2000 1520"/,
  );
  expect(meta(svg).grid).toMatchObject({
    layout: "grid",
    views: ["drawing", "planar", "cast", "overlay"],
    plane: { plane: "z" },
  });
  const embedded = decodePng(
    Buffer.from(
      svg.match(/href="data:image\/png;base64,([^"]+)"/)![1],
      "base64",
    ),
  );
  expect([embedded.width, embedded.height]).toEqual([2000, 1520]);
  for (const view of ["planar", "cast", "overlay"])
    expect(svg).toContain(`data-plane-view="${view}"`);
  expect(svg).toMatch(/data-testid="derived-curve" d="M/);
  // The lines keep the 3D drawing as vectors too, and a transparent file
  // leaves out every background.
  await imageButton(page).click();
  await page
    .getByRole("menu", { name: "Export image" })
    .getByRole("menuitemcheckbox", { name: "Transparent background" })
    .click();
  await page.keyboard.press("Escape");
  const lines = (await save(page, "Lines (SVG) · every line")).toString();
  expect(meta(lines).background).toBe("transparent");
  expect(lines).not.toContain("<image");
  expect(lines).toMatch(
    /<svg x="0" y="0" width="1000" height="760" viewBox="0 0 2000 1520"/,
  );
  expect(lines).not.toMatch(/<rect width="(2000|1000)" height="(1520|760)"/);
});

test("a video of the grid draws every view at each frame", async ({ page }) => {
  test.setTimeout(180_000);
  await open(page, staircase);
  await gridBox(page).check();
  await settled(page);
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
  const settings = page.locator("#spatial-export-settings");
  if ((await settings.getAttribute("open")) === null)
    await settings.locator(":scope > summary").click();
  await page.getByRole("slider", { name: "Export resolution" }).fill("0.5");
  // Two rows of two pages, at half size.
  await expect(settings.getByText("1000 × 760", { exact: true })).toBeVisible();
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill(".4");
  await page
    .getByRole("combobox", { name: "Export frame rate" })
    .selectOption("15");
  await page
    .getByRole("combobox", { name: "Export format" })
    .selectOption("mp4");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export MP4 video" }).click();
  const path = (await (await download).path())!;
  const decoded = await decodeVideo(page, await readFile(path));
  expect([decoded.width, decoded.height]).toEqual([1000, 760]);
  expect(decoded.duration).toBeCloseTo(0.4, 3);
  expect(decoded.first.hash).not.toBe(decoded.last.hash);
  // Decoded independently, every frame draws in each of its four cells.
  const frames = cellInk(path, 1000, 760);
  if (frames) {
    expect(frames).toHaveLength(6);
    for (const cells of frames)
      for (const ink of cells) expect(ink).toBeGreaterThan(0.002);
  }
});

// The share of each cell's pixels off the background, cell by cell in
// reading order, for every frame of a grid video, or null without ffmpeg.
function cellInk(path: string, width: number, height: number) {
  if (!probe(path)) return null;
  const bytes = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const size = width * height * 3,
    frames: number[][] = [];
  for (let from = 0; from < bytes.length; from += size) {
    const bg = [bytes[from], bytes[from + 1], bytes[from + 2]];
    const cells = [0, 0, 0, 0];
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = from + 3 * (y * width + x);
        if (
          Math.abs(bytes[i] - bg[0]) +
            Math.abs(bytes[i + 1] - bg[1]) +
            Math.abs(bytes[i + 2] - bg[2]) >
          30
        )
          cells[(y < height / 2 ? 0 : 2) + (x < width / 2 ? 0 : 1)]++;
      }
    frames.push(cells.map((n) => n / ((width * height) / 4)));
  }
  return frames;
}

test("the face-on views take the chosen color scheme's inks, as the note names them", async ({
  page,
}) => {
  await open(page, circle);
  await chooseColorScheme(page, "cobalt");
  await settled(page);
  await expect(page.getByTestId("shadow-note")).toContainText(
    "Violet is the 2D construction, ochre the 3D one's shadow.",
  );
  const palette = spatialPalette("cobalt");
  await expect(
    view(page, "overlay").getByTestId("plane-planar").first(),
  ).toHaveAttribute("stroke", hex(palette.rust[0]));
  await expect(
    view(page, "overlay").getByTestId("plane-cast").first(),
  ).toHaveAttribute("stroke", hex(palette.slate[0]));
  // The 2D drawing takes the scheme's 2D inks.
  await expect(
    view(page, "planar").getByTestId("derived-curve"),
  ).toHaveAttribute("stroke", plotPalette(false, "cobalt").derived);
});

// A phone held sideways shows the notebook's wide layout on a short
// screen: playing, the drawing comes into view with every one of its
// views whole within the drawing's column.
for (const [width, height] of [
  [932, 430],
  [844, 390],
])
  test(`held sideways at ${width} × ${height}, playback shows every view at once`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await open(page, circle);
    const panel = page.locator("#spatial-animation-section");
    if ((await panel.getAttribute("open")) === null)
      await panel.locator(":scope > summary").click();
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const column = (await page
      .locator(".spatial-app article")
      .evaluate((e) => e.getBoundingClientRect().toJSON())) as DOMRect;
    const cells = await page
      .locator(".spatial-canvas-wrap .grid-cell")
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
    expect(cells).toHaveLength(4);
    for (const cell of cells) {
      expect(cell.top).toBeGreaterThanOrEqual(column.top - 0.5);
      expect(cell.bottom).toBeLessThanOrEqual(column.bottom + 0.5);
      expect(cell.height).toBeGreaterThan(100);
    }
  });

test("a video of the grid can name its views, in a band above each row outside the drawings", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await open(page, circle);
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
  const settings = page.locator("#spatial-export-settings");
  if ((await settings.getAttribute("open")) === null)
    await settings.locator(":scope > summary").click();
  const captions = page.getByRole("checkbox", {
    name: "Include view captions",
    exact: true,
  });
  await expect(captions).not.toBeChecked();
  await captions.check();
  await page.getByRole("slider", { name: "Export resolution" }).fill("0.5");
  // Each row of pages gains a band 40 units high: 2000 × 1600 at half size.
  await expect(settings.getByText("1000 × 800", { exact: true })).toBeVisible();
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill(".4");
  await page
    .getByRole("combobox", { name: "Export frame rate" })
    .selectOption("15");
  await page
    .getByRole("combobox", { name: "Export format" })
    .selectOption("mp4");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export MP4 video" }).click();
  const path = (await (await download).path())!;
  const decoded = await decodeVideo(page, await readFile(path));
  expect([decoded.width, decoded.height]).toEqual([1000, 800]);
  // Decoded independently: the caption text inks each band in both columns,
  // and below each band its drawings start, with the 3D drawing's own
  // background, as in a video without captions.
  const frames = bandInk(path, 1000, 800, 20, 400);
  if (frames)
    for (const bands of frames)
      for (const ink of bands) expect(ink).toBeGreaterThan(30);
  // The setting is off again for a study without the grid.
  await page
    .getByRole("checkbox", { name: "Face-on views beside the drawing" })
    .uncheck();
  await settled(page);
  await expect(captions).toHaveCount(0);
});

// For each frame of a grid video with captions, the inked pixels in each
// row's band (band pixels high, every rowHeight pixels), per column.
function bandInk(
  path: string,
  width: number,
  height: number,
  band: number,
  rowHeight: number,
) {
  if (!probe(path)) return null;
  const bytes = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const size = width * height * 3,
    frames: number[][] = [];
  for (let from = 0; from < bytes.length; from += size) {
    const bg = [bytes[from], bytes[from + 1], bytes[from + 2]];
    const bands = [0, 0, 0, 0];
    for (let row = 0; row < height / rowHeight; row++)
      for (let y = row * rowHeight; y < row * rowHeight + band; y++)
        for (let x = 0; x < width; x++) {
          const i = from + 3 * (y * width + x);
          if (
            Math.abs(bytes[i] - bg[0]) +
              Math.abs(bytes[i + 1] - bg[1]) +
              Math.abs(bytes[i + 2] - bg[2]) >
            60
          )
            bands[2 * row + (x < width / 2 ? 0 : 1)]++;
        }
    frames.push(bands);
  }
  return frames;
}
