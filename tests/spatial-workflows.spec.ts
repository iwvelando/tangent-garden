import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { probe, decodeVideo } from "./video";
const stage = (page: Page) => page.locator(".spatial-stage");
async function ready(page: Page) {
  await page.goto("/?study=3d");
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#spatial-artwork")).toBeVisible();
}
async function animation(page: Page) {
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
}
async function config(page: Page) {
  return JSON.parse((await stage(page).getAttribute("data-config"))!);
}
async function view(page: Page) {
  return JSON.parse((await stage(page).getAttribute("data-camera"))!);
}
async function seek(page: Page, p: string) {
  await page.getByRole("slider", { name: "Animation progress" }).fill(p);
  await expect(stage(page)).toHaveAttribute("data-progress", p);
}
async function imageDownload(page: Page, format: string) {
  await page.getByRole("button", { name: "Export image", exact: true }).click();
  const event = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: new RegExp("^" + format) }).click();
  return readFile((await (await event).path())!);
}

test("custom definitions, errors, and both notebooks preserve edits and views", async ({
  page,
}) => {
  await ready(page);
  await page.getByLabel("Starting curve").selectOption("3");
  await page.getByRole("textbox", { name: "z(t)", exact: true }).fill("a*t/4");
  await expect.poll(async () => (await config(page)).curve.z).toBe("a*t/4");
  await page.getByLabel("Spatial definition").selectOption("torus");
  await page.getByLabel("Spatial definition").selectOption("parametric");
  await expect(
    page.getByRole("textbox", { name: "z(t)", exact: true }),
  ).toHaveValue("a*t/4");
  await page
    .getByRole("textbox", { name: "z(t)", exact: true })
    .fill("unknown(t)");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Export image", exact: true }),
  ).toBeDisabled();
  await page.getByRole("textbox", { name: "z(t)", exact: true }).fill("a*t/4");
  await expect(page.getByRole("alert")).toHaveCount(0);
  const canvas = page.locator("#spatial-artwork");
  await canvas.focus();
  await page.keyboard.press("ArrowRight");
  const before = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
  await page.getByRole("button", { name: "2D curves", exact: true }).click();
  await expect(page.locator("#artwork")).toBeVisible();
  await page
    .getByRole("combobox", { name: "Start with a notebook example" })
    .selectOption({ label: "Flower & its offset" });
  await page.getByRole("button", { name: "3D curves", exact: true }).click();
  await expect(canvas).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "z(t)", exact: true }),
  ).toHaveValue("a*t/4");
  await expect
    .poll(
      async () =>
        (await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL())) ===
        before,
    )
    .toBe(true);
  await page.getByRole("button", { name: "Use dark background" }).click();
  await page.getByRole("button", { name: "2D curves", exact: true }).click();
  await expect(page.locator(".app:visible")).toHaveClass(/dark/);
  await expect(
    page
      .getByRole("combobox", { name: "Start with a notebook example" })
      .locator("option:checked"),
  ).toHaveText("Flower & its offset");
  await page.goBack();
  await expect(canvas).toBeVisible();
});

for (const camera of ["hold", "current", "follow", "fit"])
  test(`custom parameter playback, pause, scrubbing and ${camera} camera`, async ({
    page,
  }) => {
    await ready(page);
    await page.getByLabel("Starting curve").selectOption("3");
    await expect(stage(page)).toHaveAttribute("aria-busy", "false");
    await animation(page);
    await page
      .getByLabel("Animate", { exact: true })
      .selectOption("parameters");
    await page.getByLabel("Track 1 from").fill("1/2");
    await page.getByLabel("Track 1 to").fill("phi");
    await page
      .getByLabel("Animation camera", { exact: true })
      .selectOption(camera);
    await page.getByLabel("Duration (seconds)").fill("5");
    const base = await config(page);
    await page.locator("#spatial-artwork").focus();
    await page.keyboard.press("+");
    await page.keyboard.press("Shift+ArrowRight");
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await expect(stage(page)).toHaveAttribute("data-mode", "parameters");
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const stopped = await stage(page).getAttribute("data-progress");
    await page.waitForTimeout(100);
    expect(await stage(page).getAttribute("data-progress")).toBe(stopped);
    await seek(page, "0");
    expect((await config(page)).curve.a).toBe(0.5);
    const first = await view(page);
    await seek(page, "1");
    expect((await config(page)).curve.a).toBe((1 + Math.sqrt(5)) / 2);
    const last = await view(page);
    if (camera === "hold" || camera === "current") expect(last).toEqual(first);
    if (camera === "follow") expect(last.radius).toBe(first.radius);
    if (camera === "fit") expect(last.radius).not.toBe(first.radius);
    expect(first.zoom).toBe(camera === "current" ? 1.1 : 1);
    expect(first.panX === 0).toBe(camera !== "current");
    await seek(page, "0.5");
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await expect
      .poll(async () => Number(await stage(page).getAttribute("data-progress")))
      .toBeGreaterThan(0.5);
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(stage(page)).not.toHaveAttribute("data-progress");
    expect(await config(page)).toEqual(base);
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await page.getByRole("button", { name: "2D curves", exact: true }).click();
    await page.getByRole("button", { name: "3D curves", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Play animation", exact: true }),
    ).toBeEnabled();
    await expect(stage(page)).not.toHaveAttribute("data-progress");
  });

test("reveal and orbit share playback without changing the base study", async ({
  page,
}) => {
  await ready(page);
  await animation(page);
  const base = await config(page);
  for (const mode of ["reveal", "orbit"]) {
    await page.getByLabel("Animate", { exact: true }).selectOption(mode);
    await page.getByLabel("Duration (seconds)").fill("0.1");
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await expect(stage(page)).toHaveAttribute("data-progress", "1");
    await seek(page, "0");
    const first = await view(page);
    await seek(page, "0.5");
    const middle = await view(page);
    if (mode === "orbit")
      expect(middle.yaw - first.yaw).toBeCloseTo(Math.PI, 12);
    else expect(middle).toEqual(first);
    expect(await config(page)).toEqual(base);
    await page.getByRole("button", { name: "Stop", exact: true }).click();
  }
});

test("PNG and SVG render the current manual view at export resolution", async ({
  page,
}) => {
  await ready(page);
  await page.locator("#spatial-artwork").focus();
  await page.keyboard.press("+");
  await page.keyboard.press("Shift+ArrowRight");
  const png = await imageDownload(page, "PNG");
  expect(png.readUInt32BE(16)).toBe(2000);
  expect(png.readUInt32BE(20)).toBe(1520);
  const svg = (await imageDownload(page, "SVG")).toString();
  const metadata = JSON.parse(svg.match(/<desc>(.*?)<\/desc>/)![1]);
  expect(metadata.view.zoom).toBe(1.1);
  expect(metadata.view.panX).not.toBe(0);
  expect(metadata.rendering).toBe("embedded PNG");
  expect(svg).toContain('width="2000" height="1520"');
  const embedded = Buffer.from(
    svg.match(/href="data:image\/png;base64,([^"]+)/)![1],
    "base64",
  );
  const identical = await page.evaluate(
    async (inputs) => {
      const pixels = async (input: number[]) => {
        const bitmap = await createImageBitmap(
          new Blob([new Uint8Array(input)], { type: "image/png" }),
        );
        const c = document.createElement("canvas");
        c.width = bitmap.width;
        c.height = bitmap.height;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        return ctx.getImageData(0, 0, c.width, c.height).data;
      };
      const [a, b] = await Promise.all(inputs.map(pixels));
      return a.length === b.length && a.every((v, i) => v === b[i]);
    },
    [Array.from(png), Array.from(embedded)],
  );
  expect(identical).toBe(true);
});

for (const format of ["mp4", "webp"])
  test(`3D ${format} independently decodes with exact duration, frames and changing endpoints`, async ({
    page,
  }) => {
    test.slow();
    await ready(page);
    await animation(page);
    await page.getByLabel("Duration (seconds)").fill("0.4");
    await page.locator("#spatial-export-settings > summary").click();
    await page
      .getByLabel("Export format", { exact: true })
      .selectOption(format);
    await page.getByLabel("Export frame rate").selectOption("15");
    await page
      .getByRole("slider", { name: "Export resolution", exact: true })
      .fill("1");
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", {
        name: format === "mp4" ? /Export MP4/ : /Export animated WebP/,
      })
      .click();
    const file = await download,
      path = (await file.path())!,
      bytes = await readFile(path);
    if (format === "mp4") {
      const data = probe(path);
      if (data) {
        expect(data.frames).toBe(6);
        expect(data.width).toBe(1000);
        expect(data.height).toBe(760);
        expect(data.times[0]).toBe(0);
        expect(data.durations.reduce((a, b) => a + b, 0)).toBe(400);
      }
      const video = await decodeVideo(page, bytes);
      expect(video.duration).toBeCloseTo(0.4, 3);
      expect(video.first.hash).not.toBe(video.last.hash);
    } else {
      const data = await page.evaluate(async (input) => {
        const d = new (window as any).ImageDecoder({
          data: new Uint8Array(input),
          type: "image/webp",
        });
        await d.tracks.ready;
        const count = d.tracks.selectedTrack.frameCount;
        const durations: number[] = [],
          hashes: number[] = [];
        const c = document.createElement("canvas");
        c.width = 1000;
        c.height = 760;
        const ctx = c.getContext("2d")!;
        for (let i = 0; i < count; i++) {
          const { image } = await d.decode({ frameIndex: i });
          if (image.displayWidth !== 1000 || image.displayHeight !== 760)
            throw Error("Wrong size");
          durations.push(image.duration);
          ctx.drawImage(image, 0, 0);
          let h = 0;
          for (const value of ctx.getImageData(0, 0, 1000, 760).data)
            h = (Math.imul(h, 31) + value) | 0;
          hashes.push(h);
          image.close();
        }
        d.close();
        return { count, durations, hashes };
      }, Array.from(bytes));
      expect(data.count).toBe(6);
      expect(data.durations.reduce((a, b) => a + b, 0)).toBe(400000);
      expect(new Set(data.hashes).size).toBe(6);
    }
    await expect(stage(page)).not.toHaveAttribute("data-progress");
    await expect(
      page.getByRole("button", { name: "Play animation", exact: true }),
    ).toBeEnabled();
  });

test("canceling and editing an export discard output", async ({ page }) => {
  await ready(page);
  await animation(page);
  const downloads: string[] = [];
  page.on("download", (d) => downloads.push(d.suggestedFilename()));
  await page.getByLabel("Duration (seconds)").fill("20");
  await page.getByRole("button", { name: /Export MP4/ }).click();
  await page
    .getByRole("button", { name: "Cancel export", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Play animation", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: /Export MP4/ }).click();
  await page.getByLabel("Starting curve").selectOption("2");
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
  await expect(
    page.getByRole("button", { name: "Play animation", exact: true }),
  ).toBeEnabled();
  await page.waitForTimeout(200);
  expect(downloads).toEqual([]);
});

test("late frame clocks, multiple count tracks, scrub coalescing and edits stay bounded", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const request = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) =>
      request(() => cb(performance.now() - 50));
  });
  await ready(page);
  await animation(page);
  await page.getByLabel("Animate", { exact: true }).selectOption("parameters");
  await page.getByLabel("Parameter 1", { exact: true }).selectOption("samples");
  await page.getByLabel("Track 1 from").fill("240");
  await page.getByLabel("Track 1 to").fill("721");
  await page
    .getByRole("button", { name: "+ Add parameter", exact: true })
    .click();
  await page.getByLabel("Parameter 2", { exact: true }).selectOption("lines");
  await page.getByLabel("Track 2 from").fill("12");
  await page.getByLabel("Track 2 to").fill("117");
  await page.getByLabel("Duration (seconds)").fill("0.2");
  const seen: number[] = [];
  await page.exposeFunction("spatialProgress", (p: number) => seen.push(p));
  await page.evaluate(() => {
    new MutationObserver(() => {
      const p = document
        .querySelector(".spatial-stage")
        ?.getAttribute("data-progress");
      if (p != null) (window as any).spatialProgress(+p);
    }).observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-progress"],
    });
  });
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(stage(page)).toHaveAttribute("data-progress", "1");
  expect((await config(page)).samples).toBe(721);
  expect((await config(page)).lines).toBe(117);
  expect(seen.length).toBeGreaterThan(1);
  expect(Math.min(...seen)).toBe(0);
  expect(Math.max(...seen)).toBe(1);
  const slider = page.getByRole("slider", {
    name: "Animation progress",
    exact: true,
  });
  for (const p of ["0.1", "0.9", "0.2", "0.8", "0.3"]) await slider.fill(p);
  await expect(stage(page)).toHaveAttribute("data-progress", "0.3");
  expect((await config(page)).samples).toBe(384);
  expect((await config(page)).lines).toBe(44);
  await page
    .getByRole("textbox", { name: "Tangent reach L", exact: true })
    .fill("pi");
  await expect(stage(page)).not.toHaveAttribute("data-progress");
  await expect.poll(async () => (await config(page)).length).toBe(Math.PI);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

for (const width of [1440, 390])
  test(`spatial visual review at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await ready(page);
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator(".spatial-app")).toHaveClass(
        theme === "dark" ? /dark/ : /^app spatial-app$/,
      );
      await page.screenshot({
        path: info.outputPath(`spatial-${width}-${theme}.png`),
        fullPage: width === 390,
      });
    }
  });

test("a newly opened notebook inherits the chosen theme when storage is denied", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "localStorage", {
      get() {
        throw Error("Denied");
      },
    }),
  );
  await page.emulateMedia({ colorScheme: "light" });
  await ready(page);
  await page.getByRole("button", { name: "Use dark background" }).click();
  await page.getByRole("button", { name: "2D curves", exact: true }).click();
  await expect(page.locator(".app:visible")).toHaveClass(/dark/);
  await page
    .getByRole("button", { name: "Follow system", exact: true })
    .click();
  await page.getByRole("button", { name: "3D curves", exact: true }).click();
  await expect(page.locator(".spatial-app")).not.toHaveClass(/dark/);
});
