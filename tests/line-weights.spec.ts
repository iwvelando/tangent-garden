import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  choosePreset,
  exportImage,
  openAnimation,
  openExportSettings,
  openShapeAnimation,
  openShapeExport,
} from "./helpers";
import { frameCoverage, probe } from "./video";
import { svgStroke, weightScale } from "../web/line-weight";

// Line weights in the 2D and 4D notebooks: the 3D notebook's Lines → Weight
// choices (web/line-weight.ts) applied to their SVG drawings. Regular is the
// drawing as it always was; fine and bold scale every stroke; a hairline is
// one pixel at any size.

test("an SVG stroke keeps its width at regular, scales at fine and bold, and is one unscaled pixel as a hairline", () => {
  for (const width of [0.9, 1, 1.25, 2.3, 2.6]) {
    expect(svgStroke("regular")(width)).toEqual({ strokeWidth: width });
    expect(svgStroke("fine")(width).strokeWidth).toBeCloseTo(width * 0.6, 4);
    expect(svgStroke("bold")(width).strokeWidth).toBeCloseTo(width * 1.6, 4);
    expect(svgStroke("hairline")(width)).toEqual({
      strokeWidth: 1,
      vectorEffect: "non-scaling-stroke",
    });
  }
  // An unstroked mark stays unstroked at every weight.
  for (const w of ["hairline", "fine", "regular", "bold"] as const)
    expect(svgStroke(w)(0).strokeWidth).toBe(0);
  // Widths are written briefly, without binary residue.
  expect(String(svgStroke("bold")(2.6).strokeWidth)).toBe("4.16");
  expect(weightScale).toEqual({ fine: 0.6, regular: 1, bold: 1.6 });
});

// Every stroked element of a drawing, in order: its width and whether it
// scales with the drawing.
async function strokes(page: Page, svg: string) {
  return page.locator(svg).evaluate((root) =>
    [...root.querySelectorAll("[stroke-width]")].map((e) => ({
      width: Number(e.getAttribute("stroke-width")),
      fixed: e.getAttribute("vector-effect") === "non-scaling-stroke",
    })),
  );
}
const markup = (page: Page, svg: string) =>
  page.locator(svg).evaluate((root) => root.outerHTML);

// The ink of a PNG: pixels unlike its corner, the background.
async function pngInk(app: Page, bytes: Buffer) {
  const page = await app.context().newPage();
  try {
    return await page.evaluate(async (input) => {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(input)], { type: "image/png" }),
      );
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(bitmap, 0, 0);
      const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
      let ink = 0;
      for (let i = 0; i < data.length; i += 4)
        if (
          Math.abs(data[i] - data[0]) +
            Math.abs(data[i + 1] - data[1]) +
            Math.abs(data[i + 2] - data[2]) >
          30
        )
          ink++;
      return ink / (data.length / 4);
    }, Array.from(bytes));
  } finally {
    await page.close();
  }
}
async function download(page: Page, start: () => Promise<void>) {
  const saved = page.waitForEvent("download", { timeout: 60000 });
  await start();
  const file = await saved;
  return {
    path: (await file.path())!,
    bytes: await readFile((await file.path())!),
  };
}

type Notebook = {
  name: string;
  svg: string;
  open: (page: Page) => Promise<void>;
  settle: (page: Page) => Promise<void>;
};
const notebooks: Notebook[] = [
  {
    name: "2D",
    svg: "#artwork",
    open: async (page) => {
      await page.goto("/");
      await expect(page.locator("#artwork")).toBeVisible();
    },
    settle: (page) =>
      expect(page.locator(".plot-wrap")).toHaveAttribute("aria-busy", "false"),
  },
  {
    name: "4D",
    svg: "#tesseract-artwork",
    open: async (page) => {
      await page.goto("/?study=4d");
      await expect(page.locator("#tesseract-artwork")).toBeVisible();
    },
    settle: (page) =>
      expect(page.locator(".tesseract-stage")).toHaveAttribute(
        "aria-busy",
        "false",
      ),
  },
];
const weightControl = (page: Page) =>
  page.locator(".app:visible").getByRole("combobox", { name: "Line weight" });

for (const notebook of notebooks)
  test(`${notebook.name}: every stroke follows the line weight, and regular is the drawing as before`, async ({
    page,
  }) => {
    await notebook.open(page);
    await notebook.settle(page);
    await expect(weightControl(page)).toHaveValue("regular");
    const regular = await strokes(page, notebook.svg),
      before = await markup(page, notebook.svg);
    expect(regular.length).toBeGreaterThan(4);
    expect(regular.every((s) => !s.fixed)).toBe(true);
    for (const weight of ["fine", "bold"] as const) {
      await weightControl(page).selectOption(weight);
      const scaled = await strokes(page, notebook.svg);
      expect(scaled).toHaveLength(regular.length);
      scaled.forEach((s, i) => {
        expect(s.fixed).toBe(false);
        expect(s.width).toBeCloseTo(regular[i].width * weightScale[weight], 4);
      });
    }
    await weightControl(page).selectOption("hairline");
    const hair = await strokes(page, notebook.svg);
    expect(hair).toHaveLength(regular.length);
    hair.forEach((s, i) =>
      expect(s).toEqual(
        regular[i].width > 0
          ? { width: 1, fixed: true }
          : { width: 0, fixed: false },
      ),
    );
    // Back at regular the drawing is exactly what it was.
    await weightControl(page).selectOption("regular");
    expect(await markup(page, notebook.svg)).toBe(before);
  });

for (const notebook of notebooks)
  test(`${notebook.name}: still exports draw the chosen weight`, async ({
    page,
  }) => {
    await notebook.open(page);
    await notebook.settle(page);
    const ink: Record<string, number> = {};
    for (const weight of ["regular", "bold", "hairline"] as const) {
      await weightControl(page).selectOption(weight);
      const png = await download(page, () => exportImage(page, "PNG"));
      ink[weight] = await pngInk(page, png.bytes);
      const svg = (await download(page, () => exportImage(page, "SVG"))).bytes
        .toString()
        .replace(/<desc>[\s\S]*?<\/desc>/, "");
      if (weight === "hairline")
        expect(svg).toContain('vector-effect="non-scaling-stroke"');
      else expect(svg).not.toContain("non-scaling-stroke");
    }
    // Bold strokes are 1.6 times as wide; a hairline is one pixel of the
    // 2000 × 1520 export against regular strokes of several.
    expect(ink.bold / ink.regular).toBeGreaterThan(1.3);
    expect(ink.bold / ink.regular).toBeLessThan(1.8);
    expect(ink.hairline / ink.regular).toBeLessThan(0.6);
  });

// The smallest video export, to decode quickly.
async function small(page: Page) {
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("1");
  await page
    .getByRole("combobox", { name: "Export frame rate" })
    .selectOption("15");
}

test("2D animation exports draw the chosen weight", async ({ page }) => {
  test.slow();
  await notebooks[0].open(page);
  await openAnimation(page);
  await choosePreset(page, "1");
  await notebooks[0].settle(page);
  await page
    .getByRole("spinbutton", { name: "Duration (seconds)" })
    .fill("0.5");
  await openExportSettings(page);
  await small(page);
  const coverage: Record<string, number[]> = {};
  for (const weight of ["regular", "bold"] as const) {
    await weightControl(page).selectOption(weight);
    const video = await download(page, () =>
      page
        .getByRole("button", { name: /^Export (MP4 video|animated WebP)/ })
        .click(),
    );
    const info = probe(video.path);
    test.skip(!info, "ffmpeg is not available");
    coverage[weight] = frameCoverage(video.path, info!.width, info!.height)!;
  }
  const last = (w: string) => coverage[w].at(-1)!;
  expect(last("bold") / last("regular")).toBeGreaterThan(1.3);
});

test("4D animation exports draw the chosen weight", async ({ page }) => {
  test.slow();
  await notebooks[1].open(page);
  await notebooks[1].settle(page);
  await openShapeAnimation(page);
  await page
    .getByRole("spinbutton", { name: "Duration (seconds)" })
    .fill("0.5");
  await openShapeExport(page);
  await small(page);
  const coverage: Record<string, number[]> = {};
  for (const weight of ["regular", "bold"] as const) {
    await weightControl(page).selectOption(weight);
    const video = await download(page, () =>
      page
        .getByRole("button", { name: /^Export (MP4 video|animated WebP)/ })
        .click(),
    );
    const info = probe(video.path);
    test.skip(!info, "ffmpeg is not available");
    coverage[weight] = frameCoverage(video.path, info!.width, info!.height)!;
  }
  const last = (w: string) => coverage[w].at(-1)!;
  expect(last("bold") / last("regular")).toBeGreaterThan(1.3);
});

for (const notebook of notebooks)
  test(`${notebook.name}: a copied link reopens its line weight`, async ({
    page,
    browser,
  }) => {
    await notebook.open(page);
    await notebook.settle(page);
    await weightControl(page).selectOption("bold");
    const sent = await strokes(page, notebook.svg);
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await page
      .locator(".app:visible")
      .getByRole("button", { name: "Copy link", exact: true })
      .click();
    await expect(
      page.locator(".app:visible").getByText("Link copied", { exact: true }),
    ).toBeVisible();
    const href = await page.evaluate(() => navigator.clipboard.readText());
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const other = await context.newPage();
    await other.goto(href);
    await notebook.settle(other);
    await expect(weightControl(other)).toHaveValue("bold");
    expect(await strokes(other, notebook.svg)).toEqual(sent);
    await context.close();
  });
