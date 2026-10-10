import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { choosePreset, imageButton } from "./helpers";
import { decodePng } from "./png";

// The drawing a visitor sees and the file they save are the same drawing:
// each notebook's live view, after the camera has been moved, against its
// still exports at 1 × the page. The page is pinned to 1000 × 760 CSS
// pixels (2000 × 760 for a 4D pair) at a device pixel ratio of 1, so the
// live drawing and the 1 × export have the same pixels to fill. Images are
// compared decoded, never as PNG bytes.

type Image = ReturnType<typeof decodePng>;
const digest = (image: Image) =>
  createHash("sha256").update(image.rgba).digest("hex");

// Pins an element to the page's size, so the live drawing fills exactly
// the pixels a 1 × export does.
async function pin(page: Page, selector: string, width = 1000, height = 760) {
  // Set through the CSSOM, which the page's style policy allows.
  await page.locator(selector).evaluate(
    (e: HTMLElement, [width, height]) => {
      for (const [name, value] of [
        ["width", `${width}px`],
        ["height", `${height}px`],
        ["min-height", "0"],
        ["max-height", "none"],
        ["flex", "none"],
      ])
        e.style.setProperty(name, value, "important");
      // A frame narrower than the page (a 4D pair's) would clip it.
      for (let up = e.parentElement; up; up = up.parentElement)
        up.style.setProperty("overflow", "visible", "important");
    },
    [width, height],
  );
  await expect
    .poll(() =>
      page
        .locator(selector)
        .evaluate((e) => [e.clientWidth, e.clientHeight].join(" × ")),
    )
    .toBe(`${width} × ${height}`);
}

// Chooses 1 × the page in the Export image menu, which stays open for
// settings, then saves one format from it.
async function save(page: Page, item: RegExp | string, size: string) {
  await imageButton(page).click();
  const menu = page.getByRole("menu", { name: "Export image" });
  const radio = menu.getByRole("menuitemradio", { name: size, exact: true });
  await radio.click();
  await expect(radio).toHaveAttribute("aria-checked", "true");
  const download = page.waitForEvent("download");
  await menu
    .getByRole("menuitem", { name: item, exact: typeof item === "string" })
    .click();
  const saved = await download;
  return readFile((await saved.path())!);
}

// The mean difference per channel.
function difference(a: Image, b: Image) {
  expect([b.width, b.height]).toEqual([a.width, a.height]);
  let sum = 0;
  for (let i = 0; i < a.rgba.length; i += 4)
    for (let c = 0; c < 3; c++) sum += Math.abs(a.rgba[i + c] - b.rgba[i + c]);
  return sum / (3 * (a.rgba.length / 4));
}
// 3D: the live WebGL canvas, read back (it preserves its drawing buffer).
const spatialStage = (page: Page) => page.locator(".spatial-stage");
const spatialSettled = (page: Page) =>
  expect(spatialStage(page)).toHaveAttribute("aria-busy", "false");
async function spatial(page: Page, label: string) {
  await page.goto("/?study=3d");
  await spatialSettled(page);
  await choosePreset(page, { label });
  await spatialSettled(page);
  await pin(page, ".spatial-canvas-wrap");
  // The renderer redraws on resize; wait for the canvas to take the size.
  await expect
    .poll(() =>
      page
        .locator("#spatial-artwork")
        .evaluate((c: HTMLCanvasElement) => `${c.width} × ${c.height}`),
    )
    .toBe("1000 × 760");
}
// A 4D pair's panels take focus; a single drawing takes it itself.
const focusable = (page: Page, artwork: string) =>
  page.locator(`${artwork}[tabindex], ${artwork} [tabindex]`).first();
// A camera that is not the preset's: orbited (panned in 2D), panned and
// zoomed from the keyboard.
async function moveCamera(page: Page, artwork: string) {
  await focusable(page, artwork).focus();
  for (const key of ["ArrowLeft", "ArrowUp", "+", "Shift+ArrowRight"])
    await page.keyboard.press(key);
}
async function liveCanvas(page: Page) {
  const url = await page
    .locator("#spatial-artwork")
    .evaluate((c: HTMLCanvasElement) => c.toDataURL("image/png"));
  return decodePng(Buffer.from(url.split(",")[1], "base64"));
}

const spatialCases = [
  // Exercise hairlines explicitly while retaining the regular-stroke case.
  { label: "Trefoil · (2, 3)", weight: "hairline" },
  { label: "Trefoil · (2, 3)", weight: "regular" },
  // Bold strokes, and lines dashed behind an opaque tube.
  { label: "An engraved trefoil tube", weight: "bold" },
  // See-through sheets, composited over the background.
  { label: "A Klein bottle passing through itself", weight: "regular" },
] as const;
for (const { label, weight } of spatialCases)
  for (const scheme of ["light", "dark"] as const)
    test(`3D ${label}, ${weight}, ${scheme}: the 1 × PNG is the live canvas, pixel for pixel`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await spatial(page, label);
      const weightControl = page
        .getByRole("group", { name: "Lines", exact: true })
        .getByLabel("Weight", { exact: true });
      await weightControl.selectOption(weight);
      await expect(weightControl).toHaveValue(weight);
      if (weight === "hairline")
        await expect(page.locator("#spatial-artwork")).not.toHaveAttribute(
          "data-strokes",
        );
      else
        await expect(page.locator("#spatial-artwork")).toHaveAttribute(
          "data-strokes",
          JSON.stringify({ weight }),
        );
      await moveCamera(page, "#spatial-artwork");
      const view = await page
        .locator("#spatial-artwork")
        .getAttribute("data-view");
      const live = await liveCanvas(page);
      const ink = inkMask(live);
      expect(ink.reduce((n, v) => n + v, 0) / ink.length).toBeGreaterThan(0.01);
      const file = decodePng(await save(page, /^PNG image/, "1000 × 760"));
      // The camera the export drew is the one still shown.
      await expect(page.locator("#spatial-artwork")).toHaveAttribute(
        "data-view",
        view!,
      );
      expect([file.width, file.height]).toEqual([1000, 760]);
      // The same renderer on the same device draws the same pixels.
      expect(digest(file)).toBe(digest(live));
    });

// An SVG file rasterized by Chromium's own decoder, on a blank page, at a
// size, and decoded here.
async function rasterize(
  app: Page,
  svg: Buffer,
  width: number,
  height: number,
) {
  const page = await app.context().newPage();
  try {
    const url = await page.evaluate(
      async ([svg, width, height]) => {
        const image = new Image();
        image.src = `data:image/svg+xml;base64,${svg}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d")!.drawImage(image, 0, 0, width, height);
        return canvas.toDataURL("image/png");
      },
      [svg.toString("base64"), width, height] as const,
    );
    return decodePng(Buffer.from(url.split(",")[1], "base64"));
  } finally {
    await page.close();
  }
}
// The most common color, which is the page's background: a corner can be
// clipped by the page's rounded frame.
function background(image: Image) {
  const counts = new Map<number, number>(),
    view = new DataView(image.rgba.buffer, image.rgba.byteOffset);
  for (let i = 0; i < image.rgba.length; i += 4) {
    const c = view.getUint32(i);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const top = [...counts].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  return [top >>> 24, (top >>> 16) & 255, (top >>> 8) & 255, top & 255];
}
// Pixels unlike the background, as a mask.
function inkMask(image: Image) {
  const d = image.rgba,
    bg = background(image),
    out = new Uint8Array(image.width * image.height);
  for (let i = 0; i < out.length; i++)
    out[i] =
      Math.abs(d[4 * i] - bg[0]) +
        Math.abs(d[4 * i + 1] - bg[1]) +
        Math.abs(d[4 * i + 2] - bg[2]) >
      60
        ? 1
        : 0;
  return out;
}
// The share of one mask's ink within r pixels of the other's.
function near(from: Uint8Array, to: Uint8Array, W: number, H: number, r = 2) {
  let total = 0,
    hit = 0;
  for (let y = r; y < H - r; y++)
    for (let x = r; x < W - r; x++) {
      if (!from[y * W + x]) continue;
      total++;
      search: for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++)
          if (to[(y + dy) * W + x + dx]) {
            hit++;
            break search;
          }
    }
  return { total, share: hit / total };
}

// The shown lines and the vector linework: with the sheet hidden, every
// pixel the live canvas inks is a line, so each drawing's ink should lie
// within a pixel of the other's.
for (const scheme of ["light", "dark"] as const)
  test(`3D, ${scheme}: the 1 × line drawing traces the lines the canvas shows`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await spatial(page, "Trefoil · (2, 3)");
    await page.getByRole("checkbox", { name: "Ribbon surface" }).uncheck();
    await spatialSettled(page);
    await moveCamera(page, "#spatial-artwork");
    const live = await liveCanvas(page);
    const svg = await save(page, "Lines (SVG) · every line", "1000 × 760");
    const text = svg.toString();
    expect(text).not.toMatch(/<image|<text|<foreignObject/);
    // The file is drawn at the page it records, from the camera shown.
    expect(text).toMatch(/<svg[^>]* width="1000" height="760"/);
    const meta = JSON.parse(
      text
        .match(/<desc>(.*?)<\/desc>/)![1]
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&amp;", "&"),
    );
    expect(meta.view).toEqual(
      JSON.parse(
        (await page.locator("#spatial-artwork").getAttribute("data-view"))!,
      ),
    );
    expect(meta.layers.surface).toBe(false);
    const drawn = await rasterize(page, svg, 1000, 760);
    expect(Array.from(drawn.rgba.subarray(0, 3))).toEqual(
      Array.from(live.rgba.subarray(0, 3)),
    );
    const shown = inkMask(live),
      lines = inkMask(drawn);
    const fromLive = near(shown, lines, 1000, 760, 1),
      fromFile = near(lines, shown, 1000, 760, 1);
    expect(fromLive.total).toBeGreaterThan(2000);
    expect(fromLive.share).toBeGreaterThan(0.99);
    expect(fromFile.share).toBeGreaterThan(0.99);
    // And each line in its own ink: where both drawings ink a pixel, their
    // colors agree.
    let both = 0,
      apart = 0;
    for (let i = 0; i < shown.length; i++)
      if (shown[i] && lines[i]) {
        both++;
        for (let c = 0; c < 3; c++)
          apart += Math.abs(live.rgba[4 * i + c] - drawn.rgba[4 * i + c]);
      }
    // About 7 levels a channel, from antialiasing; lines in the other
    // theme's inks differ by over 100.
    expect(apart / (3 * both)).toBeLessThan(20);
  });

// 2D and 4D: the live SVG as the page paints it (with the page's own
// styles) against the 1 × PNG. The saved SVG's coordinates match the live
// element's, and its rasterization matches the PNG, including viewport,
// primitive coordinates and rendering attributes the coordinate list omits.
const drawingOf = (svg: string) => ({
  paths: [...svg.matchAll(/ d="([^"]*)"/g)].map((m) => m[1]),
  transforms: [...svg.matchAll(/ transform="([^"]*)"/g)].map((m) => m[1]),
  points: [...svg.matchAll(/ points="([^"]*)"/g)].map((m) => m[1]),
});
async function vectorEquivalence(
  page: Page,
  artwork: string,
  size: [number, number],
  inkBound: number,
) {
  await pin(page, artwork, ...size);
  await moveCamera(page, artwork);
  // The focus ring is page chrome, not the drawing.
  await focusable(page, artwork).blur();
  await page.mouse.move(0, 0);
  // So are the buttons and readouts laid over the drawing: only the
  // drawing is left visible for its screenshot.
  await page.locator(artwork).evaluate((e) => {
    document.body.style.setProperty("visibility", "hidden", "important");
    (e as HTMLElement).style.setProperty("visibility", "visible", "important");
  });
  const live = decodePng(
    await page.locator(artwork).screenshot({ animations: "disabled" }),
  );
  await page.locator(artwork).evaluate((e) => {
    document.body.style.removeProperty("visibility");
    (e as HTMLElement).style.removeProperty("visibility");
  });
  const shown = drawingOf(
    await page.locator(artwork).evaluate((e) => e.outerHTML),
  );
  const label = `${size[0]} × ${size[1]}`;
  const file = decodePng(await save(page, /^PNG image/, label));
  const svgBytes = await save(page, /^SVG/, label);
  const svg = drawingOf(svgBytes.toString());
  expect(shown.paths.length).toBeGreaterThan(0);
  expect(svg).toEqual(shown);
  expect([file.width, file.height]).toEqual(size);
  // Both exports use the same image decoder, so their rasterized pixels
  // agree within half a level per channel, independently of the markup.
  const svgImage = await rasterize(page, svgBytes, ...size);
  expect(difference(file, svgImage)).toBeLessThan(0.5);
  // Both are Chromium's rasterization of the same vectors at the same
  // size, the page's compositor against an image decode, whose
  // antialiasing can differ by a fraction of a pixel. So the background
  // must match, and each one's ink must lie within a pixel of the other's.
  expect(background(file)).toEqual(background(live));
  const [W, H] = size,
    shownInk = inkMask(live),
    fileInk = inkMask(file);
  const fromLive = near(shownInk, fileInk, W, H, 1),
    fromFile = near(fileInk, shownInk, W, H, 1);
  expect(fromLive.total / (W * H)).toBeGreaterThan(0.005);
  expect(fromLive.share).toBeGreaterThan(0.99);
  expect(fromFile.share).toBeGreaterThan(0.99);
  // A drawing shifted by a pixel, or drawn with other widths, stays within
  // the shares above, but its strokes then differ where they are drawn.
  // Per inked pixel, unchanged drawings differ by under half a level a
  // channel in 2D and under 2.5 in 4D, whose thin colored lines antialias
  // differently; a pixel's shift costs about 50, and 2D strokes 2.5 units
  // wide about 3.
  const perInk = (difference(live, file) * W * H) / fromLive.total;
  expect(perInk).toBeLessThan(inkBound);
}

for (const scheme of ["light", "dark"] as const) {
  test(`2D, ${scheme}: the 1 × PNG and the SVG are the drawing shown`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    await expect(page.locator("#artwork")).toBeVisible();
    await expect(imageButton(page)).toBeEnabled();
    await vectorEquivalence(page, "#artwork", [1000, 760], 1.5);
  });

  test(`4D, ${scheme}: the 1 × PNG and the SVG are the drawing shown`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/?study=4d");
    await expect(page.locator(".tesseract-stage")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(imageButton(page)).toBeEnabled();
    await vectorEquivalence(page, "#tesseract-artwork", [1000, 760], 5);
  });
}

test("4D paired: the 1 × PNG and the SVG are both panels shown", async ({
  page,
}) => {
  await page.setViewportSize({ width: 2600, height: 1200 });
  await page.goto("/?study=4d");
  const settled = () =>
    expect(page.locator(".tesseract-stage")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  await settled();
  await choosePreset(page, { label: "Beside the wall" });
  await settled();
  await page
    .getByRole("combobox", { name: "View operation", exact: true })
    .selectOption("paired");
  await settled();
  await expect(imageButton(page)).toBeEnabled();
  await vectorEquivalence(page, "#tesseract-artwork", [2000, 760], 5);
});
