import { test, expect, type Page } from "@playwright/test";
import {
  choosePreset,
  chooseNotebook,
  exportImage,
  openShapeExport,
} from "./helpers";
import { readFile } from "node:fs/promises";
import { probe, decodeVideo, frameDifference } from "./video";
const stage = (p: Page) => p.locator(".tesseract-stage");
const settle = (p: Page) =>
  expect(stage(p)).toHaveAttribute("aria-busy", "false");
const meta = async (p: Page) =>
  JSON.parse((await p.locator("#tesseract-artwork desc").textContent())!);
const snapshot = (p: Page) =>
  p
    .locator("#tesseract-artwork path[data-source]")
    .evaluateAll((es) =>
      es.map((e) => [
        e.getAttribute("data-source"),
        e.getAttribute("data-role"),
        e.getAttribute("d"),
      ]),
    );

for (const width of [1440, 390])
  for (const theme of ["light", "dark"] as const)
    test(`lift coordinates share labeled rows at ${width}px ${theme}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/?study=4d");
      await settle(page);
      await choosePreset(page, { label: "The missing middle" });
      await settle(page);
      await page.getByText("Lift motion endpoints", { exact: true }).click();
      for (const label of ["Lift center", "Drift start", "Drift end"]) {
        const group = page.getByRole("group", { name: label, exact: true });
        await expect(group).toBeVisible();
        const controls = group.getByRole("textbox");
        await expect(controls).toHaveCount(3);
        const boxes = await controls.evaluateAll((es) =>
          es.map((e) => e.getBoundingClientRect().toJSON()),
        );
        for (const b of boxes) expect(b.y).toBeCloseTo(boxes[0].y, 1);
        for (const axis of ["x", "y", "z"])
          await expect(
            group.getByRole("textbox", {
              name: `${label} ${axis}`,
              exact: true,
            }),
          ).toBeVisible();
        await group.screenshot({ path: info.outputPath(`${label}.png`) });
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page
        .getByRole("textbox", { name: "Lift center z", exact: true })
        .fill("");
      await expect(page.getByRole("alert")).toContainText(
        "Lift center z must be a finite constant.",
      );
    });

test("circle seam contacts and wrapped arcs have connected readout counts in live drawing and export", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  await settle(page);
  await choosePreset(page, { label: "The missing middle" });
  await settle(page);
  await page
    .getByRole("textbox", { name: "Lift center x", exact: true })
    .fill("-1.75");
  await page
    .getByRole("textbox", { name: "Lift center z", exact: true })
    .fill("0.5");
  await settle(page);
  for (const [support, count, pieces] of [
    ["3.5/sqrt(0.75)", 6, 1],
    ["1", 9, 2],
  ] as const) {
    await page
      .getByRole("textbox", { name: "Lift support radius L", exact: true })
      .fill(support);
    await settle(page);
    for (const mode of ["reference", "lifted"] as const) {
      await page
        .getByRole("combobox", { name: "View operation", exact: true })
        .selectOption(mode);
      await settle(page);
      await expect(
        page
          .locator(".lift-readout")
          .getByText(`Present intervals: ${count}`, { exact: true }),
      ).toBeVisible();
      expect((await meta(page)).lift.visibleIntervals).toBe(count);
      await expect(
        page.locator(
          `#tesseract-artwork path[data-source="lift/circle"][data-role="${mode}"]`,
        ),
      ).toHaveCount(mode === "reference" ? pieces : 1);
      const download = page.waitForEvent("download");
      await exportImage(page, "SVG");
      const svg = await readFile((await (await download).path())!, "utf8");
      const exported = await page.evaluate(
        (s) =>
          JSON.parse(
            new DOMParser()
              .parseFromString(s, "image/svg+xml")
              .querySelector("desc")!.textContent!,
          ),
        svg,
      );
      expect(exported.lift.visibleIntervals).toBe(count);
      expect(
        exported.intervals.filter(
          (p: { source: string }) => p.source === "lift/circle",
        ),
      ).toHaveLength(mode === "reference" ? pieces : 1);
    }
    await page
      .getByRole("combobox", { name: "View operation", exact: true })
      .selectOption("reference");
    await settle(page);
  }
});

test("localized lift links exact visible intervals to a connected construction", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  await settle(page);
  const cube = await snapshot(page);
  await page
    .getByRole("combobox", { name: "4D object", exact: true })
    .selectOption("lift");
  await settle(page);
  await choosePreset(page, { label: "The missing middle" });
  await settle(page);
  const source = page.locator(
    '#tesseract-artwork path[data-source="lift/thread/2"][data-role="reference"]',
  );
  await expect(source).toHaveCount(2);
  const reference = await snapshot(page);
  expect((await meta(page)).lift.missingRadius).toBeCloseTo(Math.sqrt(3), 10);
  await expect(page.locator("#tesseract-artwork text")).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "View operation", exact: true })
    .selectOption("lifted");
  await settle(page);
  await expect(
    page.locator('#tesseract-artwork path[data-role="lifted"]'),
  ).toHaveCount(6);
  await expect(
    page.getByRole("textbox", { name: "Presentation xw angle", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: "Displacement connectors", exact: true })
    .check();
  expect(
    await page
      .locator('#tesseract-artwork path[data-role="displacement"]')
      .count(),
  ).toBeGreaterThan(0);
  await page
    .getByRole("combobox", { name: "View operation", exact: true })
    .selectOption("reference");
  await settle(page);
  expect(await snapshot(page)).toEqual(reference);
  await page
    .getByRole("checkbox", { name: "Missing-region guide", exact: true })
    .check();
  await expect(
    page.locator('#tesseract-artwork path[data-role="missing-guide"]'),
  ).toHaveCount(3);
  await page
    .getByRole("textbox", { name: "Lift height A", exact: true })
    .fill(".02");
  await settle(page);
  await expect(source).toHaveCount(1);
  expect((await meta(page)).lift.missingRadius).toBe(0);
  await page
    .getByRole("combobox", { name: "4D object", exact: true })
    .selectOption("tesseract");
  await settle(page);
  expect(await snapshot(page)).toEqual(cube);
  await page
    .getByRole("combobox", { name: "4D object", exact: true })
    .selectOption("lift");
  await settle(page);
  expect((await meta(page)).config.lift.height).toBe(0.02);
});
test("lift motions use explicit endpoints, reverse exactly and restore the camera and study", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  await settle(page);
  await choosePreset(page, { label: "The missing middle" });
  await settle(page);
  const base = (await meta(page)).config;
  const art = page.locator("#tesseract-artwork");
  await art.focus();
  await page.keyboard.press("+");
  await page.keyboard.press("Shift+ArrowUp");
  const view = (await meta(page)).view;
  for (const motion of ["drift", "support"]) {
    await page
      .getByRole("combobox", { name: "Animate", exact: true })
      .selectOption(motion);
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const slider = page.getByRole("slider", { name: "Animation progress" });
    let middle: unknown;
    let radius: number | undefined;
    for (const p of [0, 0.5, 1, 0.5, 0]) {
      await slider.fill(String(p));
      await settle(page);
      const m = await meta(page);
      expect(m.view).toEqual(view);
      radius ??= m.framingRadius;
      expect(m.framingRadius).toBe(radius);
      if (motion === "drift")
        expect(m.config.lift.center).toEqual(
          base.lift.from.map(
            (n: number, i: number) => n * (1 - p) + base.lift.to[i] * p,
          ),
        );
      else
        expect(m.config.lift.support).toBe(
          base.lift.radiusFrom * (1 - p) + base.lift.radiusTo * p,
        );
      if (p === 0.5) {
        if (middle) expect(await snapshot(page)).toEqual(middle);
        else middle = await snapshot(page);
        await page
          .getByRole("combobox", { name: "View operation", exact: true })
          .selectOption("lifted");
        await settle(page);
        expect((await meta(page)).config.lift).toEqual(m.config.lift);
        expect(await stage(page).getAttribute("data-progress")).toBe("0.5");
        await page
          .getByRole("combobox", { name: "View operation", exact: true })
          .selectOption("reference");
        await settle(page);
        expect(await snapshot(page)).toEqual(middle);
      }
    }
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await settle(page);
    expect((await meta(page)).config).toEqual(base);
  }
  await chooseNotebook(page, "2d");
  await chooseNotebook(page, "4d");
  await settle(page);
  expect((await meta(page)).view).toEqual(view);
});

const raster = (page: Page) =>
  page.evaluate(async () => {
    const svg = document
      .getElementById("tesseract-artwork")!
      .cloneNode(true) as SVGSVGElement;
    svg.setAttribute("width", "500");
    svg.setAttribute("height", "380");
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
      c.width = 500;
      c.height = 380;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      return Array.from(ctx.getImageData(0, 0, 500, 380).data);
    } finally {
      URL.revokeObjectURL(url);
    }
  });

test("reference membership ignores invalid inactive presentation and object replacement drops delayed scalars", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Native = window.Worker;
    window.Worker = class extends Native {
      postMessage(data: any) {
        if ((window as any).holdScalar && data.action === "scalars") {
          (window as any).pendingScalar = true;
          setTimeout(() => super.postMessage(data), 500);
        } else super.postMessage(data);
      }
    } as any;
  });
  await page.goto("/?study=4d");
  await settle(page);
  await choosePreset(page, { label: "The missing middle" });
  await settle(page);
  await page
    .getByRole("combobox", { name: "View operation", exact: true })
    .selectOption("lifted");
  await settle(page);
  await page
    .getByRole("textbox", { name: "Presentation xw angle", exact: true })
    .fill("1000001");
  await settle(page);
  await expect(page.getByRole("alert")).toContainText("xw angle");
  await page
    .getByRole("combobox", { name: "View operation", exact: true })
    .selectOption("reference");
  await settle(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.evaluate(() => ((window as any).holdScalar = true));
  await page
    .getByRole("textbox", { name: "Lift height A", exact: true })
    .fill("e");
  await expect
    .poll(() => page.evaluate(() => (window as any).pendingScalar))
    .toBe(true);
  await page
    .getByRole("combobox", { name: "4D object", exact: true })
    .selectOption("ball");
  await settle(page);
  const before = (await meta(page)).config;
  await page.waitForTimeout(600);
  expect((await meta(page)).config).toEqual(before);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("maximum lift sampling has bounded worker cost and matching vector metadata", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  await settle(page);
  await choosePreset(page, { label: "The missing middle" });
  await settle(page);
  await page
    .getByRole("combobox", { name: "View operation", exact: true })
    .selectOption("lifted");
  await settle(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.collectGarbage");
  const before = await cdp.send("Runtime.getHeapUsage"),
    start = performance.now();
  await page
    .getByRole("spinbutton", { name: "Thread samples", exact: true })
    .fill("256");
  await page
    .getByRole("textbox", { name: "Lift height A", exact: true })
    .fill("10");
  await settle(page);
  const elapsed = performance.now() - start,
    m = await meta(page);
  expect(elapsed).toBeLessThan(10000);
  expect(m.emittedPoints).toBeLessThan(2500);
  expect(m.evaluations).toBeLessThan(2700);
  expect(m.intervals).toHaveLength(6);
  await cdp.send("HeapProfiler.collectGarbage");
  const after = await cdp.send("Runtime.getHeapUsage");
  expect(after.usedSize - before.usedSize).toBeLessThan(32 * 1024 * 1024);
  console.log("Lift browser maximum sampling", {
    elapsed,
    heapDelta: after.usedSize - before.usedSize,
    points: m.emittedPoints,
    evaluations: m.evaluations,
  });
  await page
    .getByRole("checkbox", { name: "Missing-region guide", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "Displacement connectors", exact: true })
    .check();
  const svgDownload = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const svg = await readFile((await (await svgDownload).path())!, "utf8");
  expect(svg).toContain('data-role="lifted"');
  expect(svg).toContain('data-role="displacement"');
  expect(svg).toContain('data-role="missing-guide"');
  expect(svg).not.toMatch(/<(?:text|tspan|textPath|foreignObject)\b/);
  expect(svg.match(/<path /g)?.length).toBe(
    await page.locator("#tesseract-artwork path[data-source]").count(),
  );
  const pngDownload = page.waitForEvent("download");
  await exportImage(page, "PNG");
  const png = await readFile((await (await pngDownload).path())!);
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([2000, 1520]);
});
for (const mode of ["reference", "lifted"] as const)
  for (const format of ["mp4", "webp"] as const)
    test(`lift ${mode} ${format} export preserves duration, endpoints, guides and the linked midpoint`, async ({
      page,
    }) => {
      test.slow();
      await page.goto("/?study=4d");
      await settle(page);
      await choosePreset(page, { label: "The missing middle" });
      await settle(page);
      await page
        .getByRole("combobox", { name: "View operation", exact: true })
        .selectOption(mode);
      await settle(page);
      await page
        .getByRole("checkbox", { name: "Missing-region guide", exact: true })
        .check();
      if (mode === "lifted")
        await page
          .getByRole("checkbox", {
            name: "Displacement connectors",
            exact: true,
          })
          .check();
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
        references.push(await raster(page));
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
          expect([p.width, p.height, p.frames]).toEqual([500, 380, 15]);
          expect(p.durations.reduce((a, b) => a + b, 0)).toBe(1000);
        }
        expect((await decodeVideo(page, bytes)).duration).toBeCloseTo(1, 3);
        for (const [k, index] of [0, 7, 14].entries()) {
          const d = frameDifference(path, 500, 380, index, references[k]);
          if (d) {
            expect(d.meanDifference).toBeLessThan(6);
            expect(d.unmatchedInk).toBeLessThan(0.02);
          }
        }
      } else {
        const decoded = await page.evaluate(
          async ({ input, references }) => {
            const decoder = new (window as any).ImageDecoder({
              data: new Uint8Array(input),
              type: "image/webp",
            });
            await decoder.tracks.ready;
            const count = decoder.tracks.selectedTrack.frameCount;
            const canvas = document.createElement("canvas");
            canvas.width = 500;
            canvas.height = 380;
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
                const pixels = ctx.getImageData(0, 0, 500, 380).data,
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
                differences.push(sum / (500 * 380 * 3));
                overlaps.push(matched / Math.max(1, ink));
              }
              image.close();
            }
            decoder.close();
            return { count, durations, differences, overlaps };
          },
          { input: Array.from(bytes), references },
        );
        expect(decoded.count).toBe(15);
        expect(decoded.durations.reduce((a, b) => a + b, 0)).toBe(1000000);
        for (const d of decoded.differences) expect(d).toBeLessThan(3);
        for (const overlap of decoded.overlaps)
          expect(overlap).toBeGreaterThan(0.85);
      }
    });

for (const width of [1440, 390])
  for (const theme of ["light", "dark"] as const)
    test(`lift linked views and readouts remain legible ${width} ${theme}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/?study=4d");
      await settle(page);
      await choosePreset(page, { label: "The missing middle" });
      await settle(page);
      for (const mode of ["reference", "lifted"]) {
        await page
          .getByRole("combobox", { name: "View operation", exact: true })
          .selectOption(mode);
        await settle(page);
        await page
          .getByRole("checkbox", { name: "Missing-region guide", exact: true })
          .check();
        if (mode === "lifted")
          await page
            .getByRole("checkbox", {
              name: "Displacement connectors",
              exact: true,
            })
            .check();
        await expect(page.locator("#tesseract-artwork text")).toHaveCount(0);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await stage(page).screenshot({ path: info.outputPath(`${mode}.png`) });
      }
    });

test("lift playback edits and cancellations suppress stale output", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  await settle(page);
  await choosePreset(page, { label: "The missing middle" });
  await settle(page);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Lift center x", exact: true })
    .fill("phi");
  await settle(page);
  expect((await meta(page)).config.lift.center[0]).toBe((1 + Math.sqrt(5)) / 2);
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toHaveCount(0);
  let downloads = 0;
  page.on("download", () => downloads++);
  await openShapeExport(page);
  for (const action of ["cancel", "edit", "switch"]) {
    await page
      .getByRole("button", { name: /^Export (MP4 video|animated WebP)/ })
      .click();
    await expect(
      page.getByRole("button", { name: "Cancel export" }),
    ).toBeVisible();
    if (action === "cancel")
      await page.getByRole("button", { name: "Cancel export" }).click();
    else if (action === "edit")
      await page
        .getByRole("textbox", { name: "Lift height A", exact: true })
        .fill("1/e");
    else {
      await chooseNotebook(page, "2d");
      await chooseNotebook(page, "4d");
    }
    await expect(
      page.getByRole("button", { name: "Cancel export" }),
    ).toHaveCount(0);
    await settle(page);
  }
  expect(downloads).toBe(0);
});
