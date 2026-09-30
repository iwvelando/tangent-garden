import { exportEncoding } from "../web/export-quality";
import { test, expect, type Page } from "@playwright/test";
import {
  choosePreset,
  chooseNotebook,
  exportImage,
  openShapeExport,
} from "./helpers";
import { readFile } from "node:fs/promises";
import { probe, decodeVideo, frameDifference } from "./video";
const settle = (p: Page) =>
  expect(p.locator(".tesseract-stage")).toHaveAttribute("aria-busy", "false");
const meta = async (p: Page) =>
  JSON.parse((await p.locator("#tesseract-artwork > desc").textContent())!);
const panel = (p: Page, mode: string) =>
  p.locator(`svg[data-representation="${mode}"]`);
const paired = async (p: Page) => {
  await p.goto("/?study=4d");
  await settle(p);
  await choosePreset(p, { label: "Beside the wall" });
  await settle(p);
  await p
    .getByRole("combobox", { name: "View operation", exact: true })
    .selectOption("paired");
  await settle(p);
};
test("paired bypass is opt-in and commits matching points in both representations", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  await settle(page);
  await choosePreset(page, { label: "Beside the wall" });
  await settle(page);
  const single = await meta(page);
  await expect(page.locator('svg[data-representation="diagram"]')).toHaveCount(
    0,
  );
  await page
    .getByRole("combobox", { name: "View operation", exact: true })
    .selectOption("paired");
  await settle(page);
  await expect(panel(page, "shadow")).toHaveCount(1);
  await expect(panel(page, "diagram")).toHaveCount(1);
  await expect(
    page.locator("#tesseract-artwork text, #tesseract-artwork foreignObject"),
  ).toHaveCount(0);
  const pairedMeta = await meta(page);
  expect(pairedMeta.views[0].bypass).toEqual(single.bypass);
  expect(pairedMeta.views[0].bypass).toEqual(pairedMeta.views[1].bypass);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  for (const motion of ["route", "return"]) {
    if (motion === "return") {
      await page
        .getByRole("button", { name: "Back to study", exact: true })
        .click();
      await page
        .getByRole("combobox", { name: "Animate", exact: true })
        .selectOption(motion);
      await page
        .getByRole("button", { name: "Play animation", exact: true })
        .click();
      await page.getByRole("button", { name: "Pause", exact: true }).click();
    }
    for (const s of [0, 0.333, 0.5, 0.667, 1]) {
      await page
        .getByRole("slider", { name: "Animation progress" })
        .fill(String(s));
      await settle(page);
      const m = await meta(page);
      expect(m.views[0].bypass).toEqual(m.views[1].bypass);
      expect(m.views[0].bypass.position).toBe(motion === "route" ? s : 1 - s);
      for (const mode of ["shadow", "diagram"]) {
        const d = JSON.parse(
          (await panel(page, mode).locator(":scope > desc").textContent())!,
        );
        expect(d.bypass).toEqual(m.views[0].bypass);
      }
    }
  }
  await page
    .getByRole("button", { name: "Back to study", exact: true })
    .click();
  await settle(page);
  expect((await meta(page)).views[0].bypass.position).toBe(0.5);
  await page
    .getByRole("combobox", { name: "View operation", exact: true })
    .selectOption("shadow");
  await settle(page);
  expect((await meta(page)).bypass).toEqual(single.bypass);
});

test("paired export dimensions preserve each panel's axis scale", () => {
  const paired = exportEncoding({
    scale: 0.5,
    quality: 60,
    layout: "columns",
  } as Parameters<typeof exportEncoding>[0]);
  expect([paired.width, paired.height]).toEqual([1000, 380]);
  const stacked = exportEncoding({
    scale: 2,
    quality: 60,
    layout: "rows",
  } as Parameters<typeof exportEncoding>[0]);
  expect([stacked.width, stacked.height]).toEqual([2000, 3040]);
  expect(exportEncoding({ scale: 2, quality: 60 })).toEqual({
    width: 2000,
    height: 1520,
    scale: 2,
    compression: 0.6,
  });
});

test("paired cameras remain independent through playback, resizing and view switches", async ({
  page,
}) => {
  await paired(page);
  await panel(page, "shadow").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("+");
  await page.keyboard.press("+");
  await panel(page, "diagram").focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("+");
  const start = await meta(page),
    box = (await panel(page, "diagram").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width * 0.6 + 30,
    box.y + box.height * 0.6 + 20,
  );
  await page.mouse.up();
  await expect
    .poll(async () => (await meta(page)).views[1].view.panX)
    .toBeCloseTo(start.views[1].view.panX + (30 * 1000) / box.width, 6);
  const camera = await meta(page);
  expect(camera.views[0].view).toEqual(start.views[0].view);
  expect(camera.views[1].view.yaw).toBe(start.views[1].view.yaw);
  expect(camera.views[1].view.pitch).toBe(start.views[1].view.pitch);
  expect(camera.views[1].view.panX - start.views[1].view.panX).toBeCloseTo(
    (30 * 1000) / box.width,
    6,
  );
  expect(camera.views[1].view.panY - start.views[1].view.panY).toBeCloseTo(
    (20 * 1000) / box.width,
    6,
  );
  for (const mode of ["shadow", "diagram"])
    await expect(panel(page, mode)).toHaveAttribute("overflow", "hidden");
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill(".5");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect
    .poll(async () => {
      const snapshot = await page.evaluate(() =>
        [...document.querySelectorAll("#tesseract-artwork svg > desc")].map(
          (d) => JSON.parse(d.textContent!).bypass,
        ),
      );
      expect(snapshot[0]).toEqual(snapshot[1]);
      return snapshot[0].position;
    })
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("slider", { name: "Animation progress" }).fill("0.4");
  await settle(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#tesseract-artwork")).toHaveAttribute(
    "data-layout",
    "rows",
  );
  expect((await meta(page)).views.map((v: any) => v.view)).toEqual(
    camera.views.map((v: any) => v.view),
  );
  expect((await meta(page)).views[0].bypass.position).toBe(0.4);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  expect((await meta(page)).views[0].bypass.position).toBe(1);
  await page
    .getByRole("button", { name: "Back to study", exact: true })
    .click();
  await settle(page);
  expect((await meta(page)).views[0].bypass.position).toBe(0.5);
  await page
    .getByRole("combobox", { name: "View operation", exact: true })
    .selectOption("diagram");
  await settle(page);
  expect((await meta(page)).view).toEqual(camera.views[1].view);
  await page
    .getByRole("combobox", { name: "View operation", exact: true })
    .selectOption("paired");
  await settle(page);
  expect((await meta(page)).views.map((v: any) => v.view)).toEqual(
    camera.views.map((v: any) => v.view),
  );
  await chooseNotebook(page, "2d");
  await chooseNotebook(page, "4d");
  await settle(page);
  expect((await meta(page)).views.map((v: any) => v.view)).toEqual(
    camera.views.map((v: any) => v.view),
  );
});
for (const width of [1440, 390])
  for (const theme of ["light", "dark"] as const)
    test(`paired layout ${width}px ${theme} preserves panel scale and external labels`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme });
      await paired(page);
      const a = (await panel(page, "shadow").boundingBox())!,
        b = (await panel(page, "diagram").boundingBox())!;
      expect(a.width / a.height).toBeCloseTo(1000 / 760, 6);
      expect(b.width / b.height).toBeCloseTo(1000 / 760, 6);
      if (width > 700) {
        expect(b.x).toBeCloseTo(a.x + a.width, 3);
        expect(b.y).toBeCloseTo(a.y, 3);
      } else {
        expect(b.y).toBeCloseTo(a.y + a.height, 3);
        expect(b.x).toBeCloseTo(a.x, 3);
      }
      await expect(page.locator(".paired-view-labels")).toContainText(
        "XYZ shadow",
      );
      await expect(page.locator(".paired-view-labels")).toContainText(
        "Coordinate diagram",
      );
      await expect(
        page.locator(
          "#tesseract-artwork text, #tesseract-artwork foreignObject",
        ),
      ).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page
        .getByText("Same shadow, different points", { exact: true })
        .click();
      await page
        .locator(".tesseract-stage")
        .screenshot({ path: info.outputPath("paired.png") });
      const vector = page.waitForEvent("download");
      await exportImage(page, "SVG");
      const svg = await readFile((await (await vector).path())!, "utf8");
      expect(svg).toContain('data-representation="shadow"');
      expect(svg).toContain('data-representation="diagram"');
      expect(svg).toContain(
        `viewBox="0 0 ${width > 700 ? "2000 760" : "1000 1520"}"`,
      );
      expect(svg).not.toMatch(/<(?:text|tspan|textPath|foreignObject)\b/);
      const image = page.waitForEvent("download");
      await exportImage(page, "PNG");
      const png = await readFile((await (await image).path())!);
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual(
        width > 700 ? [4000, 1520] : [2000, 3040],
      );
    });

const raster = (page: Page, width: number, height: number) =>
  page.evaluate(
    async ({ width, height }) => {
      const svg = document
        .getElementById("tesseract-artwork")!
        .cloneNode(true) as SVGSVGElement;
      svg.setAttribute("width", String(width));
      svg.setAttribute("height", String(height));
      const url = URL.createObjectURL(
        new Blob([new XMLSerializer().serializeToString(svg)], {
          type: "image/svg+xml",
        }),
      );
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        const c = document.createElement("canvas");
        c.width = width;
        c.height = height;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(image, 0, 0);
        return Array.from(ctx.getImageData(0, 0, width, height).data);
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    { width, height },
  );

for (const layout of ["columns", "rows"] as const)
  for (const format of ["mp4", "webp"] as const)
    test(`paired ${layout} ${format} export preserves duration, endpoints, guides and the linked midpoint`, async ({
      page,
    }) => {
      test.slow();
      if (layout === "rows")
        await page.setViewportSize({ width: 390, height: 1000 });
      await paired(page);
      const width = layout === "columns" ? 1000 : 500,
        height = layout === "columns" ? 380 : 760;
      await panel(page, "shadow").focus();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("+");
      await panel(page, "diagram").focus();
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("ArrowUp");
      await page.keyboard.press("+");
      await page.keyboard.press("+");
      await page
        .getByRole("checkbox", { name: "Comparison points", exact: true })
        .check();
      await page
        .getByRole("checkbox", {
          name: "Shell and coordinate guides",
          exact: true,
        })
        .check();
      if (format === "webp")
        await page
          .getByRole("combobox", { name: "Animate", exact: true })
          .selectOption("return");
      await page
        .getByRole("spinbutton", { name: "Duration (seconds)" })
        .fill("1");
      await page
        .getByRole("button", { name: "Play animation", exact: true })
        .click();
      await page.getByRole("button", { name: "Pause", exact: true }).click();
      const references: number[][] = [];
      for (const p of [0, 0.5, 1]) {
        await page
          .getByRole("slider", { name: "Animation progress" })
          .fill(String(p));
        await settle(page);
        references.push(await raster(page, width, height));
      }
      await openShapeExport(page);
      await page
        .getByRole("combobox", { name: "Export format" })
        .selectOption(format);
      await page
        .getByRole("slider", { name: "Export resolution", exact: true })
        .fill("0.5");
      await page
        .getByRole("combobox", { name: "Export frame rate" })
        .selectOption("15");
      const download = page.waitForEvent("download");
      await page
        .getByRole("button", { name: /^Export (MP4 video|animated WebP)/ })
        .click();
      const path = (await (await download).path())!;
      const bytes = await readFile(path);
      if (format === "mp4") {
        const p = probe(path);
        if (p) {
          expect([p.width, p.height, p.frames]).toEqual([width, height, 15]);
          expect(p.durations.reduce((a, b) => a + b, 0)).toBe(1000);
        }
        expect((await decodeVideo(page, bytes)).duration).toBeCloseTo(1, 3);
        for (const [k, index] of [0, 7, 14].entries()) {
          const d = frameDifference(path, width, height, index, references[k]);
          if (d) {
            expect(d.meanDifference).toBeLessThan(6);
            expect(d.unmatchedInk).toBeLessThan(0.02);
          }
        }
      } else {
        const decoded = await page.evaluate(
          async ({ input, references, width, height }) => {
            const decoder = new (window as any).ImageDecoder({
              data: new Uint8Array(input),
              type: "image/webp",
            });
            await decoder.tracks.ready;
            const count = decoder.tracks.selectedTrack.frameCount;
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d")!;
            const durations: number[] = [],
              differences: number[] = [],
              overlaps: number[] = [];
            for (let i = 0; i < count; i++) {
              const { image } = await decoder.decode({ frameIndex: i });
              durations.push(image.duration);
              const k = [0, 7, 14].indexOf(i);
              if (k >= 0) {
                ctx.drawImage(image, 0, 0);
                const pixels = ctx.getImageData(0, 0, width, height).data,
                  ref = references[k];
                let sum = 0,
                  ink = 0,
                  matched = 0;
                const isInk = (data: ArrayLike<number>, j: number) =>
                  Math.abs(data[j] - ref[0]) +
                    Math.abs(data[j + 1] - ref[1]) +
                    Math.abs(data[j + 2] - ref[2]) >
                  30;
                for (let j = 0; j < pixels.length; j += 4) {
                  sum +=
                    Math.abs(pixels[j] - ref[j]) +
                    Math.abs(pixels[j + 1] - ref[j + 1]) +
                    Math.abs(pixels[j + 2] - ref[j + 2]);
                  if (isInk(ref, j)) {
                    ink++;
                    if (isInk(pixels, j)) matched++;
                  }
                }
                differences.push(sum / (width * height * 3));
                overlaps.push(matched / Math.max(1, ink));
              }
              image.close();
            }
            decoder.close();
            return { count, durations, differences, overlaps };
          },
          { input: Array.from(bytes), references, width, height },
        );
        expect(decoded.count).toBe(15);
        expect(decoded.durations.reduce((a, b) => a + b, 0)).toBe(1000000);
        for (const d of decoded.differences) expect(d).toBeLessThan(3);
        for (const overlap of decoded.overlaps)
          expect(overlap).toBeGreaterThan(0.85);
      }
    });

test("paired maximum sampling includes companion work and both cameras in metadata", async ({
  page,
}) => {
  await paired(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.collectGarbage");
  const before = await cdp.send("Runtime.getHeapUsage"),
    start = performance.now();
  await page
    .getByRole("spinbutton", { name: "Shell samples", exact: true })
    .fill("256");
  await page
    .getByRole("textbox", { name: "Route height H", exact: true })
    .fill("20");
  await page
    .getByRole("combobox", { name: "Obstacle", exact: true })
    .selectOption("radial");
  await settle(page);
  const m = await meta(page);
  expect(m.views[0].bypass.state).toBe("crossing");
  expect(m.views[0].bypass).toEqual(m.views[1].bypass);
  expect(m.emittedPoints).toBeLessThan(4000);
  expect(m.evaluations).toBeLessThan(5000);
  const counts = await page.evaluate(() =>
    [...document.querySelectorAll("#tesseract-artwork svg > desc")].map((d) =>
      JSON.parse(d.textContent!),
    ),
  );
  expect(m.emittedPoints).toBe(
    counts[0].emittedPoints + counts[1].emittedPoints,
  );
  expect(m.evaluations).toBe(counts[0].evaluations + counts[1].evaluations);
  const elapsed = performance.now() - start;
  expect(elapsed).toBeLessThan(10000);
  await cdp.send("HeapProfiler.collectGarbage");
  const after = await cdp.send("Runtime.getHeapUsage");
  expect(after.usedSize - before.usedSize).toBeLessThan(32 * 1024 * 1024);
  console.log("Paired bypass maximum sampling", {
    elapsed,
    heapDelta: after.usedSize - before.usedSize,
    points: m.emittedPoints,
    evaluations: m.evaluations,
  });
});
test("paired edits and view changes cancel exports and retain edited study", async ({
  page,
}) => {
  await paired(page);
  await page
    .getByRole("textbox", { name: "Outside point y", exact: true })
    .fill("phi");
  await settle(page);
  const original = (await meta(page)).config;
  let downloads = 0;
  page.on("download", () => downloads++);
  await openShapeExport(page);
  for (const action of ["cancel", "edit", "view"]) {
    await page
      .getByRole("button", { name: /^Export (MP4 video|animated WebP)/ })
      .click();
    await expect(
      page.getByRole("button", { name: "Cancel export", exact: true }),
    ).toBeVisible();
    if (action === "cancel")
      await page
        .getByRole("button", { name: "Cancel export", exact: true })
        .click();
    else if (action === "edit")
      await page
        .getByRole("textbox", { name: "Route height H", exact: true })
        .fill("pi");
    else
      await page
        .getByRole("combobox", { name: "View operation", exact: true })
        .selectOption("shadow");
    await expect(
      page.getByRole("button", { name: "Cancel export", exact: true }),
    ).toHaveCount(0);
    await settle(page);
  }
  expect(downloads).toBe(0);
  await page
    .getByRole("combobox", { name: "View operation", exact: true })
    .selectOption("paired");
  await settle(page);
  expect((await meta(page)).config.bypass.outside).toEqual(
    original.bypass.outside,
  );
  expect((await meta(page)).config.bypass.height).toBe(Math.PI);
  await page
    .getByRole("combobox", { name: "4D object", exact: true })
    .selectOption("lift");
  await settle(page);
  await page
    .getByRole("combobox", { name: "4D object", exact: true })
    .selectOption("bypass");
  await settle(page);
  expect((await meta(page)).config.bypass.height).toBe(Math.PI);
  await expect(panel(page, "diagram")).toHaveCount(1);
});

for (const width of [1440, 390])
  test(`paired captions sit beside their own panels at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await paired(page);
    const captions = page.locator(".paired-view-labels > span");
    await expect(captions).toHaveCount(2);
    const [first, second] = [
      (await captions.nth(0).boundingBox())!,
      (await captions.nth(1).boundingBox())!,
    ];
    const diagram = (await panel(page, "diagram").boundingBox())!;
    if (width > 700) {
      await expect(captions.nth(0)).toContainText("XYZ shadow (left)");
      await expect(captions.nth(1)).toContainText("Coordinate diagram (right)");
      expect(second.y).toBeCloseTo(first.y, 0);
      expect(second.x).toBeGreaterThanOrEqual(diagram.x - 1);
    } else {
      await expect(captions.nth(0)).toContainText("XYZ shadow (top)");
      await expect(captions.nth(1)).toContainText(
        "Coordinate diagram (bottom)",
      );
      expect(second.y).toBeGreaterThanOrEqual(first.y + first.height - 1);
      expect(second.x).toBeCloseTo(first.x, 0);
    }
  });

test("radial shell shadow is the filled ball, stated in every view", async ({
  page,
}) => {
  await paired(page);
  await page
    .getByRole("combobox", { name: "Obstacle", exact: true })
    .selectOption("radial");
  await settle(page);
  const legend = page.locator(".tesseract-app .plot-meta");
  const note = page.locator(".tesseract-explanation .note");
  for (const mode of ["shadow", "paired", "diagram"]) {
    await page
      .getByRole("combobox", { name: "View operation", exact: true })
      .selectOption(mode);
    await settle(page);
    await expect(note).toContainText("|p| ≤ b");
    if (mode === "shadow")
      await expect(legend).not.toContainText("Inner boundary");
    else await expect(legend).toContainText("Inner boundary");
  }
  // The embedded shell's shadow is its own 3D shell, bounded at both radii.
  await page
    .getByRole("combobox", { name: "Obstacle", exact: true })
    .selectOption("embedded");
  await page
    .getByRole("combobox", { name: "View operation", exact: true })
    .selectOption("shadow");
  await settle(page);
  await expect(legend).toContainText("Inner boundary");
  await expect(note).toContainText("a ≤ |p| ≤ b");
});

test("leaving the diagram for the shadow discards the stored paired camera", async ({
  page,
}) => {
  await paired(page);
  await panel(page, "shadow").focus();
  await page.keyboard.press("ArrowRight");
  const stored = (await meta(page)).views[0].view;
  const operation = page.getByRole("combobox", {
    name: "View operation",
    exact: true,
  });
  await operation.selectOption("diagram");
  await settle(page);
  await operation.selectOption("shadow");
  await settle(page);
  await page.locator("#tesseract-artwork").focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await operation.selectOption("diagram");
  await settle(page);
  const current = (await meta(page)).view;
  expect(current).not.toEqual(stored);
  await operation.selectOption("paired");
  await settle(page);
  const views = (await meta(page)).views.map((v: any) => v.view);
  // The most recent camera continues in both panels; the stale one is gone.
  expect(views[0]).toEqual(current);
  expect(views[1]).toEqual(current);
});
