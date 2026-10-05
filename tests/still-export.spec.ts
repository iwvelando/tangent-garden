import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { choosePreset, imageButton } from "./helpers";
import { decodePng } from "./png";

// Still exports at a chosen size and with a transparent background, in all
// three notebooks, decoded independently of the browser (tests/png.ts).

type Setup = {
  name: string;
  open: (page: Page) => Promise<void>;
  // The drawing's own page at 1×: 1000 × 760, or a 4D pair's.
  base: [number, number];
};
const planarReady = async (page: Page) => {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await expect(imageButton(page)).toBeEnabled();
};
const spatialSettled = (page: Page) =>
  expect(page.locator(".spatial-stage")).toHaveAttribute("aria-busy", "false");
const spatial = (label: string) => async (page: Page) => {
  await page.goto("/?study=3d");
  await spatialSettled(page);
  await choosePreset(page, { label });
  await spatialSettled(page);
  await expect(imageButton(page)).toBeEnabled();
};
const fourSettled = (page: Page) =>
  expect(page.locator(".tesseract-stage")).toHaveAttribute(
    "aria-busy",
    "false",
  );
const fourReady = async (page: Page) => {
  await page.goto("/?study=4d");
  await fourSettled(page);
  await expect(imageButton(page)).toBeEnabled();
};
const fourPaired = async (page: Page) => {
  await fourReady(page);
  await choosePreset(page, { label: "Beside the wall" });
  await fourSettled(page);
  await page
    .getByRole("combobox", { name: "View operation", exact: true })
    .selectOption("paired");
  await fourSettled(page);
};
const setups: Setup[] = [
  { name: "2D", open: planarReady, base: [1000, 760] },
  // Strokes drawn by sample coverage.
  { name: "3D strokes", open: spatial("Trefoil · (2, 3)"), base: [1000, 760] },
  // Bold strokes, and lines dashed behind an opaque tube.
  {
    name: "3D dashed",
    open: spatial("An engraved trefoil tube"),
    base: [1000, 760],
  },
  // See-through sheets, composited over the background.
  {
    name: "3D see-through",
    open: spatial("A Klein bottle passing through itself"),
    base: [1000, 760],
  },
  { name: "4D", open: fourReady, base: [1000, 760] },
  { name: "4D paired", open: fourPaired, base: [2000, 760] },
];

const size = ([w, h]: [number, number], k: number) => `${w * k} × ${h * k}`;

// Chooses the size and background in the Export image menu, which stays
// open for settings, then closes it.
async function choose(
  page: Page,
  settings: { size?: string; transparent?: boolean },
) {
  await imageButton(page).click();
  const menu = page.getByRole("menu", { name: "Export image" });
  if (settings.size) {
    const radio = menu.getByRole("menuitemradio", {
      name: settings.size,
      exact: true,
    });
    await radio.click();
    await expect(radio).toHaveAttribute("aria-checked", "true");
  }
  if (settings.transparent !== undefined) {
    const box = menu.getByRole("menuitemcheckbox", {
      name: "Transparent background",
    });
    if (
      ((await box.getAttribute("aria-checked")) === "true") !==
      settings.transparent
    )
      await box.click();
    await expect(box).toHaveAttribute(
      "aria-checked",
      String(settings.transparent),
    );
  }
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
}
async function save(page: Page, item: RegExp | string) {
  await imageButton(page).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("menuitem", {
      name: item,
      exact: typeof item === "string",
    })
    .click();
  const saved = await download;
  return {
    name: saved.suggestedFilename(),
    bytes: await readFile((await saved.path())!),
  };
}
const savePng = async (page: Page) =>
  decodePng((await save(page, /^PNG image/)).bytes);

// The transparent image laid over the opaque one's background color, in
// straight alpha, against the opaque image: the mean and the worst
// difference per channel, overall and where the transparent one is opaque.
function overBackground(
  clear: ReturnType<typeof decodePng>,
  solid: ReturnType<typeof decodePng>,
) {
  const bg = Array.from(solid.rgba.subarray(0, 3));
  let sum = 0,
    inked = 0,
    inkedSum = 0,
    inkedWorst = 0;
  for (let i = 0; i < clear.rgba.length; i += 4) {
    const a = clear.rgba[i + 3] / 255;
    for (let c = 0; c < 3; c++) {
      const composite = clear.rgba[i + c] * a + bg[c] * (1 - a);
      const d = Math.abs(composite - solid.rgba[i + c]);
      sum += d;
      if (clear.rgba[i + 3] === 255) {
        inkedSum += d;
        inkedWorst = Math.max(inkedWorst, d);
      }
    }
    if (clear.rgba[i + 3] === 255) inked++;
  }
  const pixels = clear.rgba.length / 4;
  return {
    mean: sum / (3 * pixels),
    inkedMean: inkedSum / (3 * Math.max(inked, 1)),
    inkedWorst,
  };
}
function alphaShares(image: ReturnType<typeof decodePng>) {
  let clear = 0,
    solid = 0;
  for (let i = 3; i < image.rgba.length; i += 4) {
    if (image.rgba[i] === 0) clear++;
    else if (image.rgba[i] === 255) solid++;
  }
  const n = image.rgba.length / 4;
  return { clear: clear / n, solid: solid / n };
}

for (const setup of setups) {
  test(`${setup.name}: a chosen size and a transparent background reach the PNG`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await setup.open(page);
    // The default, labelled with its real size.
    await imageButton(page).click();
    await expect(
      page.getByRole("menuitem", {
        name: `PNG image · ${size(setup.base, 2)}`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitemradio", { name: size(setup.base, 2) }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      page.getByRole("menuitemcheckbox", { name: "Transparent background" }),
    ).toHaveAttribute("aria-checked", "false");
    await page.keyboard.press("Escape");
    const full = await savePng(page);
    expect([full.width, full.height]).toEqual([
      setup.base[0] * 2,
      setup.base[1] * 2,
    ]);
    expect(alphaShares(full).solid).toBe(1);

    await choose(page, { size: size(setup.base, 1) });
    await imageButton(page).click();
    await expect(
      page.getByRole("menuitem", {
        name: `PNG image · ${size(setup.base, 1)}`,
        exact: true,
      }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    const solid = await savePng(page);
    expect([solid.width, solid.height]).toEqual(setup.base);
    expect(alphaShares(solid).solid).toBe(1);

    await choose(page, { transparent: true });
    const clear = await savePng(page);
    expect([clear.width, clear.height]).toEqual(setup.base);
    expect(clear.alpha).toBe(true);
    const shares = alphaShares(clear);
    // The page's corner is background, now left clear, and so is most of
    // the page; the ink stays opaque.
    expect(clear.rgba[3]).toBe(0);
    expect(shares.clear).toBeGreaterThan(0.3);
    expect(1 - shares.clear).toBeGreaterThan(0.005);
    expect(shares.solid).toBeGreaterThan(0);
    // Over its own background the transparent image is the opaque one, to
    // within 8-bit rounding: a level where the ink is opaque, and a third of
    // a level on average across the page, fringes included.
    const match = overBackground(clear, solid);
    expect(match.inkedWorst).toBeLessThanOrEqual(1);
    expect(match.mean).toBeLessThan(0.34);
  });
}

// The PNG against the exported SVG rasterized directly at the PNG's size,
// in a blank page, and against the default PNG enlarged to that size.
async function againstVector(
  app: Page,
  png: Buffer,
  small: Buffer,
  svg: Buffer,
) {
  const page = await app.context().newPage();
  try {
    return await page.evaluate(
      async ([png, small, svg]) => {
        const blob = (bytes: number[], type: string) =>
          new Blob([new Uint8Array(bytes)], { type });
        const big = await createImageBitmap(blob(png, "image/png"));
        const { width, height } = big;
        const pixels = (source: CanvasImageSource) => {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
          ctx.drawImage(source, 0, 0, width, height);
          return ctx.getImageData(0, 0, width, height).data;
        };
        const image = new Image();
        image.src = URL.createObjectURL(blob(svg, "image/svg+xml"));
        await image.decode();
        const reference = pixels(image),
          drawn = pixels(big),
          enlarged = pixels(await createImageBitmap(blob(small, "image/png")));
        let a = 0,
          b = 0;
        for (let i = 0; i < reference.length; i++) {
          if (i % 4 === 3) continue;
          a += Math.abs(drawn[i] - reference[i]);
          b += Math.abs(enlarged[i] - reference[i]);
        }
        const n = (reference.length / 4) * 3;
        return { width, height, drawn: a / n, enlarged: b / n };
      },
      [Array.from(png), Array.from(small), Array.from(svg)] as const,
    );
  } finally {
    await page.close();
  }
}

test("a larger PNG is drawn at its size, not enlarged from a smaller one", async ({
  page,
}) => {
  test.setTimeout(180_000);
  for (const setup of [setups[0], setups[4], setups[5]]) {
    await setup.open(page);
    const small = (await save(page, /^PNG image/)).bytes;
    await choose(page, { size: size(setup.base, 4) });
    const big = (await save(page, /^PNG image/)).bytes;
    const svg = (await save(page, /^SVG/)).bytes;
    const decoded = decodePng(big);
    expect([decoded.width, decoded.height]).toEqual([
      setup.base[0] * 4,
      setup.base[1] * 4,
    ]);
    const result = await againstVector(page, big, small, svg);
    expect([result.width, result.height]).toEqual([
      decoded.width,
      decoded.height,
    ]);
    // Drawn from the vectors it matches them, and far more closely than
    // the default image enlarged, whose every edge is twice as soft.
    expect(result.drawn).toBeLessThan(0.5);
    expect(result.drawn).toBeLessThan(result.enlarged / 4);
  }
});

test("2D and 4D SVG files leave out the background when it is transparent", async ({
  page,
}) => {
  for (const [open, selector, small] of [
    [planarReady, "#artwork", "1000 × 760"],
    [fourReady, "#tesseract-artwork", "1000 × 760"],
    [fourPaired, "#tesseract-artwork", "2000 × 760"],
  ] as const) {
    await open(page);
    const opaque = (await save(page, /^SVG/)).bytes.toString();
    const live = await page.locator(selector).evaluate((e) => e.outerHTML);
    expect(opaque.match(/<rect/g)?.length).toBe(live.match(/<rect/g)?.length);
    expect(opaque).not.toContain('"background"');
    await choose(page, { size: small, transparent: true });
    const clear = (await save(page, /^SVG/)).bytes.toString();
    // Every page-filling background rectangle is gone, root or panel, and
    // nothing else.
    const full =
      /<rect width="(1000|2000)" height="(760|1520)" fill="[^"]+"\s*\/>/g;
    expect(opaque.match(full)?.length).toBeGreaterThan(0);
    expect(clear.match(full)).toBeNull();
    expect(clear.match(/<rect/g)?.length ?? 0).toBe(
      (opaque.match(/<rect/g)?.length ?? 0) - opaque.match(full)!.length,
    );
    expect(clear).not.toMatch(/style="[^"]*background/);
    const desc = clear.match(/<desc>(.*?)<\/desc>/s)![1];
    expect(
      JSON.parse(
        desc
          .replaceAll("&quot;", '"')
          .replaceAll("&lt;", "<")
          .replaceAll("&gt;", ">")
          .replaceAll("&amp;", "&"),
      ).background,
    ).toBe("transparent");
    // A vector file has no pixel size: the size setting leaves it alone.
    const root = (svg: string) =>
      svg.match(/<svg[^>]*>/)![0].replace(/ style="[^"]*"/, "");
    expect(root(clear)).toBe(root(opaque));
  }
});

test("3D SVG files record a chosen size and background, and only then", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await spatial("Trefoil · (2, 3)")(page);
  const meta = (svg: string) =>
    JSON.parse(
      svg
        .match(/<desc>(.*?)<\/desc>/)![1]
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&amp;", "&"),
    );
  const items = [
    /^SVG · embedded/,
    "Lines (SVG) · every line",
    "Lines (SVG) · visible only, sampled",
  ];
  const before = [];
  for (const item of items) {
    const svg = (await save(page, item)).bytes.toString();
    expect(svg).toContain('width="2000" height="1520"');
    expect(meta(svg).image).toBeUndefined();
    expect(meta(svg).background).toBeUndefined();
    before.push(svg);
  }
  expect(before[1]).toMatch(/<rect width="2000" height="1520" fill=/);
  await choose(page, { size: "3000 × 2280", transparent: true });
  for (const [i, item] of items.entries()) {
    const svg = (await save(page, item)).bytes.toString();
    expect(svg).toContain('width="3000" height="2280" viewBox="0 0 3000 2280"');
    expect(meta(svg).image).toEqual({ width: 3000, height: 2280 });
    expect(meta(svg).background).toBe("transparent");
    expect(svg).not.toMatch(/<rect width="3000" height="2280"/);
    if (i === 0) {
      const png = decodePng(
        Buffer.from(
          svg.match(/href="data:image\/png;base64,([^"]+)"/)![1],
          "base64",
        ),
      );
      expect([png.width, png.height, png.alpha]).toEqual([3000, 2280, true]);
      expect(png.rgba[3]).toBe(0);
    }
  }
});

test("the size and background are menu settings that keep the menu open", async ({
  page,
}) => {
  await planarReady(page);
  const button = imageButton(page);
  const menu = page.getByRole("menu", { name: "Export image" });
  await button.focus();
  await page.keyboard.press("Enter");
  const png = page.getByRole("menuitem", { name: /^PNG image/ });
  await expect(png).toBeFocused();
  const radios = menu.getByRole("menuitemradio");
  await expect(radios).toHaveText([
    "1000 × 760",
    "2000 × 1520",
    "3000 × 2280",
    "4000 × 3040",
  ]);
  await expect(menu.getByRole("group", { name: "PNG size" })).toBeVisible();
  // Down past the formats to the sizes.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(radios.nth(0)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press(" ");
  await expect(menu).toBeVisible();
  await expect(radios.nth(2)).toHaveAttribute("aria-checked", "true");
  await expect(radios.nth(1)).toHaveAttribute("aria-checked", "false");
  await expect(radios.nth(2)).toBeFocused();
  await expect(png).toHaveText("PNG image · 3000 × 2280");
  const box = menu.getByRole("menuitemcheckbox", {
    name: "Transparent background",
  });
  await page.keyboard.press("End");
  await expect(box).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(box).toHaveAttribute("aria-checked", "true");
  await expect(png).toHaveText("PNG image · 3000 × 2280, transparent");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(button).toBeFocused();
  // Kept for the next export.
  await button.click();
  await expect(png).toHaveText("PNG image · 3000 × 2280, transparent");
});

test("a size the browser cannot draw names the limit instead of saving a blank file", async ({
  page,
}) => {
  await planarReady(page);
  // As iOS Safari does past its canvas area: no context at all.
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: Parameters<typeof original>
    ) {
      if (this.width * this.height > 8_000_000) return null;
      return original.apply(this, args);
    } as typeof original;
  });
  let downloads = 0;
  page.on("download", () => downloads++);
  await choose(page, { size: "4000 × 3040" });
  await imageButton(page).click();
  await page.getByRole("menuitem", { name: /^PNG image/ }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "This browser can't draw a 4000 × 3040 image. Choose a smaller size.",
  );
  // A canvas that is made but stays blank is caught the same way.
  await page.evaluate(() => {
    const original = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function (
      this: CanvasRenderingContext2D,
      ...args: Parameters<typeof original>
    ) {
      const data = original.apply(this, args);
      if (this.canvas.width * this.canvas.height > 5_000_000) data.data.fill(0);
      return data;
    } as typeof original;
  });
  await choose(page, { size: "3000 × 2280" });
  await imageButton(page).click();
  await page.getByRole("menuitem", { name: /^PNG image/ }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "This browser can't draw a 3000 × 2280 image. Choose a smaller size.",
  );
  expect(downloads).toBe(0);
  await choose(page, { size: "2000 × 1520" });
  const png = await savePng(page);
  expect(png.width).toBe(2000);
});

test("a 3D size past the WebGL drawing buffer names the limit", async ({
  page,
}) => {
  await spatial("Trefoil · (2, 3)")(page);
  // A device whose drawing buffer stops at 3000 pixels a side.
  await page.evaluate(() => {
    for (const name of ["drawingBufferWidth", "drawingBufferHeight"]) {
      const real = Object.getOwnPropertyDescriptor(
        WebGLRenderingContext.prototype,
        name,
      )!.get!;
      Object.defineProperty(WebGLRenderingContext.prototype, name, {
        get() {
          return Math.min(3000, real.call(this));
        },
      });
    }
  });
  let downloads = 0;
  page.on("download", () => downloads++);
  await choose(page, { size: "4000 × 3040" });
  await imageButton(page).click();
  await page.getByRole("menuitem", { name: /^PNG image/ }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "This device could draw only 3000 × 3000 of the 4000 × 3040 3D image. Choose a smaller size.",
  );
  expect(downloads).toBe(0);
  await choose(page, { size: "2000 × 1520" });
  expect((await savePng(page)).width).toBe(2000);
});
