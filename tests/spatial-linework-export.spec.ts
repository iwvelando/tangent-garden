import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { choosePreset } from "./helpers";

// The 3D notebook's vector linework export, through the real menu, worker
// and engine: the file is compared with the PNG of the same view, and the
// two occlusion modes with each other.
const stage = (page: Page) => page.locator(".spatial-stage");
async function ready(page: Page) {
  await page.goto("/?study=3d");
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#spatial-artwork")).toBeVisible();
}
const settled = (page: Page) =>
  expect(stage(page)).toHaveAttribute("aria-busy", "false");
const every = "Lines (SVG) · every line",
  shown = "Lines (SVG) · visible only, sampled";
async function download(page: Page, item: string) {
  await page.getByRole("button", { name: "Export image", exact: true }).click();
  const event = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: item, exact: true }).click();
  const saved = await event;
  return {
    name: saved.suggestedFilename(),
    bytes: await readFile((await saved.path())!),
  };
}
const png = (page: Page) => download(page, "PNG image · 2000 × 1520");
function parse(svg: string) {
  const desc = svg.match(/<desc>(.*?)<\/desc>/)![1];
  const meta = JSON.parse(
    desc
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&amp;", "&"),
  );
  const groups = [...svg.matchAll(/<g id="([a-z0-9]+)"/g)].map((m) => m[1]);
  const points = [...svg.matchAll(/([ML])(-?[\d.]+) (-?[\d.]+)/g)];
  const vertices = points.length;
  // Total stroke length on the page.
  let length = 0;
  points.forEach((m, i) => {
    if (m[1] === "L")
      length += Math.hypot(
        +m[2] - +points[i - 1][2],
        +m[3] - +points[i - 1][3],
      );
  });
  const fill = svg.match(/<rect [^>]*fill="(#[0-9a-f]{6})"/)?.[1];
  const strokes = [...svg.matchAll(/stroke="(#[0-9a-f]{6})"/g)].map(
    (m) => m[1],
  );
  return { meta, groups, vertices, length, fill, strokes };
}
const trefoil = { label: "Trefoil · (2, 3)" };

test("the 3D export menu offers both line drawings beside the image exports", async ({
  page,
}) => {
  await ready(page);
  await page.getByRole("button", { name: "Export image", exact: true }).click();
  await expect(page.getByRole("menuitem")).toHaveText([
    "PNG image · 2000 × 1520",
    "SVG · embedded 3D image",
    every,
    shown,
  ]);
  await page.keyboard.press("End");
  await expect(page.getByRole("menuitem", { name: shown })).toBeFocused();
  await page.keyboard.press("Escape");
  // The embedded image keeps its label and its honest metadata.
  const embedded = (await download(page, "SVG · embedded 3D image")).bytes;
  expect(embedded.toString()).toContain("<image");
  expect(parse(embedded.toString()).meta.rendering).toBe("embedded PNG");
});

test("both line drawings are paths of the shown layers; sampled hiding removes lines behind the sheet", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, trefoil);
  await settled(page);
  const all = await download(page, every);
  const visible = await download(page, shown);
  expect(all.name).toBe("tangent-garden-spatial-lines.svg");
  expect(visible.name).toBe("tangent-garden-spatial-visible-lines.svg");
  const a = parse(all.bytes.toString()),
    v = parse(visible.bytes.toString());
  for (const [file, occlusion] of [
    [all.bytes.toString(), "none"],
    [visible.bytes.toString(), "sampled"],
  ] as const) {
    expect(file).not.toMatch(/<image|<text|<foreignObject/);
    const { meta, groups } = parse(file);
    expect(meta.rendering).toBe("vector linework");
    expect(meta.occlusion.mode).toBe(occlusion);
    expect(meta.config.format).toBe("torus");
    expect(meta.layers.surface).toBe(true);
    expect(groups).toEqual(["rulings", "edges", "base"]);
  }
  expect(a.meta.occlusion.statement).toMatch(/every shown line/i);
  expect(v.meta.occlusion.statement).toMatch(/not exact/i);
  // The sheet hides part of the rulings and edges, but not all of them.
  expect(v.length).toBeLessThan(a.length * 0.9);
  expect(v.length).toBeGreaterThan(a.length * 0.25);
  // Hiding the sheet leaves nothing to hide behind.
  await page.getByRole("checkbox", { name: "Ribbon surface" }).uncheck();
  const bare = parse((await download(page, shown)).bytes.toString());
  expect(bare.vertices).toBe(a.vertices);
  expect(bare.length).toBeCloseTo(a.length, 3);
  expect(bare.meta.layers.surface).toBe(false);
});

// Rasterizes the PNG and the SVG in Chromium's own decoders and compares
// their ink: pixels differing from the background.
async function inkAgreement(app: Page, image: Buffer, svg: Buffer) {
  const page = await app.context().newPage();
  try {
    return await page.evaluate(
      async ([image, svg]) => {
        const ink = async (bytes: number[], type: string) => {
          const blob = new Blob([new Uint8Array(bytes)], { type });
          const source =
            type === "image/png"
              ? await createImageBitmap(blob)
              : await (async () => {
                  const img = new Image();
                  img.src = URL.createObjectURL(blob);
                  await img.decode();
                  return img;
                })();
          const canvas = document.createElement("canvas");
          canvas.width = 2000;
          canvas.height = 1520;
          const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
          ctx.drawImage(source, 0, 0, 2000, 1520);
          const d = ctx.getImageData(0, 0, 2000, 1520).data;
          const bg = [d[0], d[1], d[2]];
          const out = new Uint8Array(2000 * 1520);
          for (let i = 0; i < out.length; i++)
            out[i] =
              Math.abs(d[4 * i] - bg[0]) +
                Math.abs(d[4 * i + 1] - bg[1]) +
                Math.abs(d[4 * i + 2] - bg[2]) >
              60
                ? 1
                : 0;
          return { out, bg };
        };
        const a = await ink(image, "image/png"),
          b = await ink(svg, "image/svg+xml");
        // The share of one image's ink within two pixels of the other's.
        const near = (from: Uint8Array, to: Uint8Array) => {
          let total = 0,
            hit = 0;
          for (let y = 2; y < 1518; y++)
            for (let x = 2; x < 1998; x++) {
              if (!from[y * 2000 + x]) continue;
              total++;
              search: for (let dy = -2; dy <= 2; dy++)
                for (let dx = -2; dx <= 2; dx++)
                  if (to[(y + dy) * 2000 + x + dx]) {
                    hit++;
                    break search;
                  }
            }
          return { total, share: hit / total };
        };
        return {
          background: [a.bg, b.bg],
          pngInk: near(a.out, b.out),
          svgInk: near(b.out, a.out),
        };
      },
      [Array.from(image), Array.from(svg)] as const,
    );
  } finally {
    await page.close();
  }
}

for (const scheme of ["light", "dark"] as const) {
  test(`every line lands where the PNG draws it, in the ${scheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await ready(page);
    await choosePreset(page, { label: "A knot shedding filaments" });
    await settled(page);
    await page.locator("#spatial-artwork").focus();
    await page.keyboard.press("+");
    await page.keyboard.press("Shift+ArrowRight");
    const image = (await png(page)).bytes;
    const svg = (await download(page, every)).bytes;
    const { meta, fill, strokes, groups } = parse(svg.toString());
    expect(meta.dark).toBe(scheme === "dark");
    expect(fill).toBe(scheme === "dark" ? "#0b1517" : "#f3f1ea");
    expect(groups).toContain("filaments");
    expect(new Set(strokes).size).toBeGreaterThan(2);
    const agreement = await inkAgreement(page, image, svg);
    expect(agreement.background[0]).toEqual(agreement.background[1]);
    expect(agreement.pngInk.total).toBeGreaterThan(5000);
    expect(agreement.pngInk.share).toBeGreaterThan(0.95);
    expect(agreement.svgInk.share).toBeGreaterThan(0.95);
  });
}

test("a paused reveal exports the lines drawn so far", async ({ page }) => {
  await ready(page);
  await choosePreset(page, { label: "A knot shedding filaments" });
  await settled(page);
  const full = parse((await download(page, every)).bytes.toString());
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("slider", { name: "Animation progress" }).fill("0.5");
  await expect(stage(page)).toHaveAttribute("data-progress", "0.5");
  const half = parse((await download(page, every)).bytes.toString());
  expect(half.vertices).toBeLessThan(full.vertices * 0.75);
  expect(half.vertices).toBeGreaterThan(full.vertices * 0.25);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  const again = parse((await download(page, every)).bytes.toString());
  expect(again.vertices).toBe(full.vertices);
});
