import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { exportImage, imageButton, openAnimation } from "./helpers";

async function ready(page: Page) {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await expect(imageButton(page)).toBeEnabled();
}
async function save(page: Page, kind: "PNG" | "SVG") {
  const download = page.waitForEvent("download");
  await exportImage(page, kind);
  const saved = await download;
  return {
    name: saved.suggestedFilename(),
    bytes: await readFile((await saved.path())!),
  };
}

// Chromium's own image decoders, on a blank page: the PNG, and the exported
// SVG rasterized directly at 2000 × 1520 as the reference.
async function compare(app: Page, png: Buffer, svg: Buffer) {
  const page = await app.context().newPage();
  try {
    return await page.evaluate(
      async ([png, svg]) => {
        const pixels = async (bytes: number[], type: string) => {
          const blob = new Blob([new Uint8Array(bytes)], { type });
          let source: CanvasImageSource;
          if (type === "image/png") source = await createImageBitmap(blob);
          else {
            const image = new Image();
            image.src = URL.createObjectURL(blob);
            await image.decode();
            source = image;
          }
          const canvas = document.createElement("canvas");
          canvas.width = 2000;
          canvas.height = 1520;
          const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
          ctx.drawImage(source, 0, 0, 2000, 1520);
          return {
            size:
              source instanceof ImageBitmap
                ? [source.width, source.height]
                : [],
            data: ctx.getImageData(0, 0, 2000, 1520).data,
          };
        };
        const a = await pixels(png, "image/png");
        const b = await pixels(svg, "image/svg+xml");
        let difference = 0,
          drawn = 0,
          hash = 0;
        const background = Array.from(a.data.slice(0, 4));
        for (let i = 0; i < a.data.length; i += 4) {
          difference += Math.abs(a.data[i] - b.data[i]);
          if (a.data[i] !== background[0]) drawn++;
          hash = (Math.imul(hash, 31) + a.data[i]) | 0;
        }
        return {
          size: a.size,
          background,
          drawn: drawn / (a.data.length / 4),
          meanDifference: difference / (a.data.length / 4),
          hash,
        };
      },
      [Array.from(png), Array.from(svg)] as const,
    );
  } finally {
    await page.close();
  }
}

for (const scheme of ["light", "dark"] as const) {
  test(`PNG export in ${scheme} theme is a 2000 × 1520 raster of the vector drawing`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await ready(page);
    const png = await save(page, "PNG");
    expect(png.name).toBe("tangent-garden-evolute.png");
    expect(png.bytes.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(png.bytes.toString("ascii", 12, 16)).toBe("IHDR");
    expect([png.bytes.readUInt32BE(16), png.bytes.readUInt32BE(20)]).toEqual([
      2000, 1520,
    ]);
    const svg = await save(page, "SVG");
    expect(svg.name).toBe("tangent-garden-evolute.svg");
    const result = await compare(page, png.bytes, svg.bytes);
    expect(result.size).toEqual([2000, 1520]);
    const fill = await page.locator("#artwork > rect").getAttribute("fill");
    const hex = fill!.match(/[0-9a-f]{2}/gi)!.map((h) => parseInt(h, 16));
    expect(result.background).toEqual([...hex, 255]);
    expect(result.drawn).toBeGreaterThan(0.005);
    // Rendered from vectors at full size, not an upscaled screen raster.
    expect(result.meanDifference).toBeLessThan(0.5);
  });
}

test("a paused animation frame exports as PNG, distinct from the full study", async ({
  page,
}) => {
  await ready(page);
  const full = await save(page, "PNG");
  await openAnimation(page);
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("20");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect(imageButton(page)).toBeDisabled();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(imageButton(page)).toBeEnabled();
  const paused = await save(page, "PNG");
  expect(paused.bytes.equals(full.bytes)).toBe(false);
});

test("the Export image menu works by keyboard and closes on outside clicks", async ({
  page,
}) => {
  await ready(page);
  const button = imageButton(page);
  const menu = page.getByRole("menu");
  const png = page.getByRole("menuitem", { name: "PNG image · 2000 × 1520" });
  const svg = page.getByRole("menuitem", { name: "SVG · vector, scalable" });
  await expect(button).toHaveAttribute("aria-haspopup", "menu");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toHaveCount(0);
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(png).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(svg).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(png).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(svg).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(button).toBeFocused();
  await button.click();
  await expect(menu).toBeVisible();
  await page.locator("h1").click();
  await expect(menu).toHaveCount(0);
  await button.click();
  const download = page.waitForEvent("download");
  await page.keyboard.press("Enter");
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
  await expect(menu).toHaveCount(0);
});

test("a failed PNG encode shows a plain error and recovers", async ({
  page,
}) => {
  await ready(page);
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.toBlob = function (callback) {
      callback(null);
    };
  });
  await exportImage(page, "PNG");
  await expect(page.getByRole("alert")).toHaveText(
    "This browser couldn't save the PNG image. SVG export may still work.",
  );
  const svg = page.waitForEvent("download");
  await exportImage(page, "SVG");
  await svg;
  await expect(page.getByRole("alert")).toHaveCount(0);
});
