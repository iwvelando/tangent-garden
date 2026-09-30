import { test, expect, type Page } from "@playwright/test";
import {
  choosePreset,
  chooseNotebook,
  exportImage,
  openShapeExport,
} from "./helpers";
import { probe, decodeVideo, frameDifference } from "./video";
import { readFile } from "node:fs/promises";
const stage = (p: Page) => p.locator(".tesseract-stage");
const settle = (p: Page) =>
  expect(stage(p)).toHaveAttribute("aria-busy", "false");
const meta = async (p: Page) =>
  JSON.parse((await p.locator("#tesseract-artwork desc").textContent())!);

test("shell bypass verifies the full route and links shadow and coordinate diagram", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  await settle(page);
  const before = await meta(page);
  await page
    .getByRole("combobox", { name: "4D object", exact: true })
    .selectOption("bypass");
  await settle(page);
  await choosePreset(page, { label: "Beside the wall" });
  await settle(page);
  expect((await meta(page)).bypass.state).toBe("clear");
  expect((await meta(page)).bypass.clearance).toBeCloseTo(1, 10);
  await page
    .getByRole("textbox", { name: "Route position s", exact: true })
    .fill("0.5");
  await settle(page);
  const middle = (await meta(page)).bypass.current;
  await page
    .getByRole("combobox", { name: "View operation", exact: true })
    .selectOption("diagram");
  await settle(page);
  expect((await meta(page)).bypass.current).toEqual(middle);
  await expect(
    page.getByRole("button", { name: "Rotate view", exact: true }),
  ).toBeDisabled();
  const view = (await meta(page)).view;
  await page.locator("#tesseract-artwork").focus();
  await page.keyboard.press("ArrowUp");
  expect((await meta(page)).view.pitch).toBe(view.pitch);
  await page
    .getByRole("textbox", { name: "Route height H", exact: true })
    .fill("0.1");
  await settle(page);
  expect((await meta(page)).bypass.state).toBe("crossing");
  await expect(
    page.locator('#tesseract-artwork path[data-role="collision"]'),
  ).toHaveCount(1);
  await page
    .getByRole("textbox", { name: "Route height H", exact: true })
    .fill("0.15");
  await settle(page);
  expect((await meta(page)).bypass.state).toBe("contact");
  await page
    .getByRole("textbox", { name: "Route height H", exact: true })
    .fill("4");
  await settle(page);
  await page
    .getByRole("combobox", { name: "Obstacle", exact: true })
    .selectOption("radial");
  await settle(page);
  expect((await meta(page)).bypass.state).toBe("crossing");
  await page
    .getByRole("combobox", { name: "4D object", exact: true })
    .selectOption("tesseract");
  await settle(page);
  expect((await meta(page)).config).toEqual(before.config);
  await expect(page.locator("#tesseract-artwork text")).toHaveCount(0);
});

test("route traversal shares endpoints, reversed positions, manual camera and restored study", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  await settle(page);
  await choosePreset(page, { label: "Beside the wall" });
  await settle(page);
  const base = (await meta(page)).config;
  await page.locator("#tesseract-artwork").focus();
  await page.keyboard.press("+");
  await page.keyboard.press("Shift+ArrowLeft");
  const camera = (await meta(page)).view;
  for (const motion of ["route", "return"]) {
    await page
      .getByRole("combobox", { name: "Animate", exact: true })
      .selectOption(motion);
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    for (const p of [0, 0.333, 0.5, 0.667, 1, 0.5]) {
      await page
        .getByRole("slider", { name: "Animation progress" })
        .fill(String(p));
      await settle(page);
      const m = await meta(page);
      expect(m.bypass.position).toBe(motion === "route" ? p : 1 - p);
      expect(m.view).toEqual(camera);
      await page
        .getByRole("combobox", { name: "View operation", exact: true })
        .selectOption("diagram");
      await settle(page);
      expect((await meta(page)).bypass).toEqual(m.bypass);
      expect(await stage(page).getAttribute("data-progress")).toBe(String(p));
      await page
        .getByRole("combobox", { name: "View operation", exact: true })
        .selectOption("shadow");
      await settle(page);
      expect((await meta(page)).bypass).toEqual(m.bypass);
    }
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await settle(page);
    expect((await meta(page)).config).toEqual(base);
  }
  await chooseNotebook(page, "2d");
  await chooseNotebook(page, "4d");
  await settle(page);
  expect((await meta(page)).view).toEqual(camera);
});

test("same XYZ shadow retains distinct point identities and independent fourth-coordinate distance", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  await settle(page);
  await choosePreset(page, { label: "Beside the wall" });
  await settle(page);
  await page
    .getByRole("checkbox", { name: "Comparison points", exact: true })
    .check();
  const q1 = page.locator('[data-marker="bypass/q1"]'),
    q2 = page.locator('[data-marker="bypass/q2"]');
  expect(await q1.getAttribute("cx")).toBe(await q2.getAttribute("cx"));
  expect(await q1.getAttribute("cy")).toBe(await q2.getAttribute("cy"));
  expect(await q1.getAttribute("r")).not.toBe(await q2.getAttribute("r"));
  await page
    .getByText("Same shadow, different points", { exact: true })
    .click();
  await expect(
    page.getByText("4D separation: 1.2000", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "First comparison w", exact: true })
    .fill("-phi");
  await page
    .getByRole("textbox", { name: "Second comparison w", exact: true })
    .fill("pi");
  await settle(page);
  expect((await meta(page)).bypass.distance).toBeCloseTo(
    Math.PI + (1 + Math.sqrt(5)) / 2,
    12,
  );
  const previous = (await meta(page)).markers.map(
    (m: { fourPoint: number[] }) => m.fourPoint,
  );
  await page
    .getByRole("combobox", { name: "View operation", exact: true })
    .selectOption("diagram");
  await settle(page);
  expect(await q1.getAttribute("cy")).not.toBe(await q2.getAttribute("cy"));
  expect(
    (await meta(page)).markers.map((m: { fourPoint: number[] }) => m.fourPoint),
  ).toEqual(previous);
  const diagram = await meta(page);
  // A common affine scale must preserve the declared diagram coordinates,
  // independently of the retained 3D camera's yaw/pitch.
  const marker = diagram.markers.find(
    (m: { id: string }) => m.id === "bypass/q1",
  );
  const scale = (310 * diagram.view.zoom) / diagram.framingRadius;
  expect(Number(await q1.getAttribute("cx"))).toBeCloseTo(
    500 + scale * marker.point[0] + diagram.view.panX,
    8,
  );
  expect(Number(await q1.getAttribute("cy"))).toBeCloseTo(
    380 - scale * marker.point[1] + diagram.view.panY,
    8,
  );
  await page
    .getByRole("checkbox", { name: "Route and moving point", exact: true })
    .uncheck();
  await expect(q1).toHaveAttribute("r", "6");
  await expect(q2).toHaveAttribute("r", "9");
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const svg = await readFile((await (await download).path())!, "utf8");
  expect(svg).toContain('data-marker="bypass/q1"');
  expect(svg).toContain('data-marker="bypass/q2"');
  expect(svg).not.toMatch(/<(?:text|tspan|textPath|foreignObject)\b/);
});

for (const width of [1440, 390])
  for (const theme of ["light", "dark"] as const)
    test(`bypass representations and controls at ${width}px ${theme}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/?study=4d");
      await settle(page);
      await choosePreset(page, { label: "Beside the wall" });
      await settle(page);
      await page
        .getByRole("checkbox", { name: "Comparison points", exact: true })
        .check();
      for (const mode of ["shadow", "diagram"]) {
        await page
          .getByRole("combobox", { name: "View operation", exact: true })
          .selectOption(mode);
        await settle(page);
        await expect(page.locator("#tesseract-artwork text")).toHaveCount(0);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await stage(page).screenshot({ path: info.outputPath(`${mode}.png`) });
      }
      const group = page.getByRole("group", {
        name: "Outside point",
        exact: true,
      });
      await expect(group.getByRole("textbox")).toHaveCount(3);
      await group.screenshot({ path: info.outputPath("outside-point.png") });
    });

test("bypass edits and cancellation suppress pending exports", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  await settle(page);
  await choosePreset(page, { label: "Beside the wall" });
  await settle(page);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Route height H", exact: true })
    .fill("phi");
  await settle(page);
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
        .getByRole("textbox", { name: "Route height H", exact: true })
        .fill("pi");
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

for (const mode of ["shadow", "diagram"] as const)
  for (const format of ["mp4", "webp"] as const)
    test(`bypass ${mode} ${format} export preserves duration, endpoints, guides and the linked midpoint`, async ({
      page,
    }) => {
      test.slow();
      await page.goto("/?study=4d");
      await settle(page);
      await choosePreset(page, { label: "Beside the wall" });
      await settle(page);
      await page
        .getByRole("combobox", { name: "View operation", exact: true })
        .selectOption(mode);
      await settle(page);
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

test("radial switches ignore unfinished embedded extent and object replacement drops delayed scalars", async ({
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
  await choosePreset(page, { label: "Beside the wall" });
  await settle(page);
  await page
    .getByRole("textbox", { name: "Fourth-coordinate extent ε", exact: true })
    .fill("6");
  await settle(page);
  await expect(page.getByRole("alert")).toContainText(
    "Fourth-coordinate extent",
  );
  await page
    .getByRole("combobox", { name: "Obstacle", exact: true })
    .selectOption("radial");
  await settle(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect((await meta(page)).bypass.state).toBe("crossing");
  await page.evaluate(() => ((window as any).holdScalar = true));
  await page
    .getByRole("textbox", { name: "Route height H", exact: true })
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

test("maximum bypass study has bounded whole-study cost and geometry-only still exports", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  await settle(page);
  await choosePreset(page, { label: "Beside the wall" });
  await settle(page);
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
  const elapsed = performance.now() - start,
    m = await meta(page);
  expect(elapsed).toBeLessThan(10000);
  expect(m.bypass.state).toBe("crossing");
  expect(m.emittedPoints).toBeLessThan(2000);
  expect(m.evaluations).toBeLessThan(2500);
  expect(m.markers).toHaveLength(3);
  await cdp.send("HeapProfiler.collectGarbage");
  const after = await cdp.send("Runtime.getHeapUsage");
  expect(after.usedSize - before.usedSize).toBeLessThan(32 * 1024 * 1024);
  console.log("Bypass browser maximum sampling", {
    elapsed,
    heapDelta: after.usedSize - before.usedSize,
    points: m.emittedPoints,
    evaluations: m.evaluations,
  });
  await page
    .getByRole("checkbox", { name: "Comparison points", exact: true })
    .check();
  const vector = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const svg = await readFile((await (await vector).path())!, "utf8");
  expect(svg).toContain('data-role="collision"');
  expect(svg).toContain('data-marker="bypass/moving"');
  expect(svg).not.toMatch(/<(?:text|tspan|textPath|foreignObject)\b/);
  const image = page.waitForEvent("download");
  await exportImage(page, "PNG");
  const bytes = await readFile((await (await image).path())!);
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([
    2000, 1520,
  ]);
});
