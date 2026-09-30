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
const readout = (p: Page, label: string) =>
  p
    .locator(".lift-readout span")
    .filter({ hasText: `${label}:` })
    .locator("b");

for (const width of [1440, 390])
  for (const theme of ["light", "dark"] as const)
    test(`rings from a sphere draws latitude-coloured fibers with readouts outside the viewport at ${width}px ${theme}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/?study=4d");
      await settle(page);
      await choosePreset(page, { label: "Rings from a sphere" });
      await settle(page);
      const m = await meta(page);
      expect(m.object).toBe("weave");
      expect(m.weave.family).toBe("fibers");
      const fibers = page.locator('#tesseract-artwork path[data-role="fiber"]');
      await expect(fibers).toHaveCount(40);
      // Each latitude has its own colour, matching its key entry.
      const keys = page.locator(".tesseract-legend > span[data-section]");
      await expect(keys).toHaveCount(4);
      const inks = await fibers.evaluateAll((es) => {
        const bySection = new Map<string, Set<string>>();
        for (const e of es) {
          const id = e.getAttribute("data-section")!;
          bySection.set(
            id,
            (bySection.get(id) ?? new Set()).add(e.getAttribute("stroke")!),
          );
        }
        return [...bySection.values()].map((strokes) => [...strokes]);
      });
      // One colour per latitude, and a different colour for every latitude.
      expect(inks).toHaveLength(4);
      for (const strokes of inks) expect(strokes).toHaveLength(1);
      expect(new Set(inks.flat()).size).toBe(4);
      await expect(keys.first()).toContainText("1: α = 0.390");
      await expect(keys.first()).toContainText("(torus)");
      // Window guides share the guide layer.
      await expect(
        page.locator('#tesseract-artwork path[data-role="window"]'),
      ).toHaveCount(3);
      await page
        .getByRole("checkbox", { name: "Projection window", exact: true })
        .uncheck();
      await expect(
        page.locator('#tesseract-artwork path[data-role="window"]'),
      ).toHaveCount(0);
      // Readouts come from the returned diagnostics; the viewport has no text.
      await expect(readout(page, "Complete circles")).toHaveText(
        String(m.weave.completeCircles),
      );
      await expect(readout(page, "Open arcs")).toHaveText(
        String(m.weave.retainedArcs),
      );
      expect(m.weave.completeCircles + m.weave.retainedArcs).toBeGreaterThan(0);
      await expect(page.locator("#tesseract-artwork text")).toHaveCount(0);
      await expect(page.getByRole("status")).toHaveText(
        "40 source circles on the unit 3-sphere. Open ends mark the projection window, not broken curves.",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({ path: info.outputPath("weave.png") });
    });

test("direct controls switch families, collapse endpoint latitudes and name invalid fields", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  await settle(page);
  await page
    .getByRole("combobox", { name: "4D object", exact: true })
    .selectOption("weave");
  await settle(page);
  expect((await meta(page)).config.weave.family).toBe("fibers");
  await expect(
    page.getByRole("spinbutton", { name: "Fibers per latitude", exact: true }),
  ).toBeVisible();
  // The family choice leads the construction, before the latitude fields.
  expect(
    await page
      .getByRole("combobox", { name: "Weave family", exact: true })
      .evaluate(
        (family, alpha) =>
          !!(
            family.compareDocumentPosition(alpha!) &
            Node.DOCUMENT_POSITION_FOLLOWING
          ),
        await page
          .getByRole("textbox", { name: "Central latitude α", exact: true })
          .elementHandle(),
      ),
  ).toBe(true);
  await page
    .getByRole("combobox", { name: "Weave family", exact: true })
    .selectOption("tori");
  await settle(page);
  await expect(
    page.getByRole("spinbutton", { name: "Curves per direction", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('#tesseract-artwork path[data-role="fixed-u"]'),
  ).toHaveCount(40);
  await expect(page.locator(".tesseract-explanation h2")).toHaveText(
    "Tori on a sphere",
  );
  // One latitude at π/2 collapses to one circle; spread is then ignored.
  await page
    .getByRole("spinbutton", { name: "Latitudes", exact: true })
    .fill("1");
  await page
    .getByRole("textbox", { name: "Latitude spread", exact: true })
    .fill("");
  await page
    .getByRole("textbox", { name: "Central latitude α", exact: true })
    .fill("pi/2");
  await page.getByText("Latitude motion endpoints", { exact: true }).click();
  await page
    .getByRole("textbox", { name: "Latitude start", exact: true })
    .fill("pi/2");
  await page
    .getByRole("textbox", { name: "Latitude end", exact: true })
    .fill("0");
  await settle(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  const m = await meta(page);
  expect(m.sections).toEqual([
    {
      id: "weave/latitude/0",
      kind: "circle",
      level: Math.PI / 2,
      dimension: 1,
    },
  ]);
  await expect(
    page.locator('#tesseract-artwork path[data-role="collapsed"]'),
  ).toHaveCount(1);
  await expect(page.locator(".tesseract-legend")).toContainText(
    "1: α = 1.57 (one circle)",
  );
  await expect(readout(page, "Open arcs")).toHaveText(
    String(m.weave.retainedArcs),
  );
  // Validation names the offending field.
  await page
    .getByRole("spinbutton", { name: "Latitudes", exact: true })
    .fill("3");
  await expect(page.getByRole("alert")).toContainText(
    "Latitude spread must be a finite constant.",
  );
  await page
    .getByRole("textbox", { name: "Latitude spread", exact: true })
    .fill("1");
  await expect(page.getByRole("alert")).toContainText(
    "Central latitude α must keep every latitude within 0 and π/2",
  );
  await page
    .getByRole("textbox", { name: "Central latitude α", exact: true })
    .fill("pi/4");
  await expect(page.getByRole("alert")).toContainText("Latitude start");
  await page
    .getByRole("textbox", { name: "Latitude start", exact: true })
    .fill("0.5");
  await expect(page.getByRole("alert")).toContainText("Latitude end");
  await page
    .getByRole("textbox", { name: "Latitude end", exact: true })
    .fill("pi/2 - 0.5");
  await settle(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page
    .getByRole("spinbutton", { name: "Arc samples", exact: true })
    .fill("256");
  await page
    .getByRole("spinbutton", { name: "Latitudes", exact: true })
    .fill("9");
  await page
    .getByRole("spinbutton", { name: "Curves per direction", exact: true })
    .fill("16");
  await expect(page.getByRole("alert")).toContainText("65,536 points");
});

test("latitude sweep and rotation use explicit endpoints, reverse exactly and restore the camera and study", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  await settle(page);
  await choosePreset(page, { label: "Tori between two circles" });
  await settle(page);
  const base = (await meta(page)).config;
  const art = page.locator("#tesseract-artwork");
  await art.focus();
  await page.keyboard.press("+");
  await page.keyboard.press("Shift+ArrowUp");
  const view = (await meta(page)).view;
  for (const motion of ["latitude", "double"]) {
    await page
      .getByRole("combobox", { name: "Animate", exact: true })
      .selectOption(motion);
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const slider = page.getByRole("slider", { name: "Animation progress" });
    let middle: unknown;
    for (const p of [0, 0.5, 1, 0.5, 0]) {
      await slider.fill(String(p));
      await settle(page);
      const m = await meta(page);
      expect(m.view).toEqual(view);
      expect(m.framingRadius).toBe(base.clip);
      if (motion === "latitude") {
        expect(m.config.weave.alpha).toBe(
          base.weave.alphaFrom * (1 - p) + base.weave.alphaTo * p,
        );
        expect(m.config.angles).toEqual(base.angles);
        // The start collapses the first latitude, the end the last.
        expect(m.sections.map((s: { kind: string }) => s.kind)).toEqual(
          p === 0
            ? ["circle", "torus", "torus"]
            : p === 1
              ? ["torus", "torus", "circle"]
              : ["torus", "torus", "torus"],
        );
      } else {
        expect(m.config.angles[3]).toBeCloseTo(
          base.angles[3] + 2 * Math.PI * p,
          12,
        );
        expect(m.config.angles[2]).toBeCloseTo(
          base.angles[2] + 2 * Math.PI * p,
          12,
        );
        expect(m.config.weave).toEqual(base.weave);
      }
      if (p === 0.5) {
        if (middle) expect(await snapshot(page)).toEqual(middle);
        else middle = await snapshot(page);
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
  expect((await meta(page)).config).toEqual(base);
});

test("object switching restores an edited weave and existing stereographic diagnostics are unchanged", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  await settle(page);
  await choosePreset(page, { label: "Spherical loom" });
  await settle(page);
  const loom = await snapshot(page);
  const status = await page.getByRole("status").textContent();
  expect(status).toMatch(
    /^\d+ source curves clipped at the projection window\. Open ends are intentional\.$/,
  );
  await page
    .getByRole("combobox", { name: "4D object", exact: true })
    .selectOption("weave");
  await settle(page);
  await page
    .getByRole("textbox", { name: "Central latitude α", exact: true })
    .fill("0.7");
  await settle(page);
  const edited = (await meta(page)).config;
  await page
    .getByRole("combobox", { name: "4D object", exact: true })
    .selectOption("tesseract");
  await settle(page);
  expect(await snapshot(page)).toEqual(loom);
  await expect(page.getByRole("status")).toHaveText(status!);
  await page
    .getByRole("combobox", { name: "4D object", exact: true })
    .selectOption("weave");
  await settle(page);
  expect((await meta(page)).config).toEqual(edited);
});

test("vector exports record the weave definition, arcs and window with the live drawing", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  await settle(page);
  await choosePreset(page, { label: "Tori between two circles" });
  await settle(page);
  const live = await meta(page);
  expect(live.weave.projection).toContain("stereographic");
  expect(live.arcs).toHaveLength(live.weave.sources - live.weave.absentSources);
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const svg = await readFile((await (await download).path())!, "utf8");
  const exported = await page.evaluate((s) => {
    const doc = new DOMParser().parseFromString(s, "image/svg+xml");
    return {
      desc: JSON.parse(doc.querySelector("desc")!.textContent!),
      paths: [...doc.querySelectorAll("path[data-source]")].map((e) => [
        e.getAttribute("data-source"),
        e.getAttribute("data-role"),
        e.getAttribute("d"),
      ]),
      text: doc.querySelectorAll("text").length,
    };
  }, svg);
  expect(exported.desc.weave).toEqual(live.weave);
  expect(exported.desc.arcs).toEqual(live.arcs);
  expect(exported.paths).toEqual(await snapshot(page));
  expect(exported.text).toBe(0);
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

for (const format of ["mp4", "webp"] as const)
  test(`weave latitude sweep ${format} export preserves duration, endpoints and midpoint`, async ({
    page,
  }) => {
    test.slow();
    await page.goto("/?study=4d");
    await settle(page);
    await choosePreset(page, { label: "Tori between two circles" });
    await settle(page);
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
    // Dense thin linework: compare geometry, not quality-60 compression.
    await page
      .getByRole("slider", { name: "Export quality", exact: true })
      .fill("100");
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
    // The endpoints differ: the first and last latitudes collapse in turn.
    const change = references[0].reduce(
      (s, v, i) => s + Math.abs(v - references[2][i]),
      0,
    );
    expect(change / references[0].length).toBeGreaterThan(1);
  });

test("maximum weave sampling has bounded worker cost and matching counts", async ({
  page,
}) => {
  test.slow();
  await page.goto("/?study=4d");
  await settle(page);
  await choosePreset(page, { label: "Tori between two circles" });
  await settle(page);
  await page
    .getByRole("textbox", { name: "Latitude spread", exact: true })
    .fill("1.2");
  await page.getByText("Latitude motion endpoints", { exact: true }).click();
  await page
    .getByRole("textbox", { name: "Latitude start", exact: true })
    .fill("pi/4");
  await page
    .getByRole("textbox", { name: "Latitude end", exact: true })
    .fill("pi/4");
  await page
    .getByRole("textbox", { name: "Projection window radius" })
    .fill("12");
  for (const name of ["xz angle", "xw angle", "yw angle"])
    await page.getByRole("textbox", { name, exact: true }).fill("0");
  await settle(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.collectGarbage");
  const before = await cdp.send("Runtime.getHeapUsage");
  const start = Date.now();
  await page
    .getByRole("spinbutton", { name: "Arc samples", exact: true })
    .fill("256");
  await page
    .getByRole("spinbutton", { name: "Latitudes", exact: true })
    .fill("9");
  await page
    .getByRole("spinbutton", { name: "Curves per direction", exact: true })
    .fill("13");
  await settle(page);
  const elapsed = Date.now() - start;
  const m = await meta(page);
  // All 234 source circles are complete: the largest accepted study.
  expect(m.weave.completeCircles).toBe(234);
  expect(m.emittedPoints).toBe(237 * 257);
  expect(m.evaluations).toBe(237 * 257);
  await expect(
    page.locator("#tesseract-artwork path[data-source]"),
  ).toHaveCount(237);
  expect(elapsed).toBeLessThan(10_000);
  await cdp.send("HeapProfiler.collectGarbage");
  const after = await cdp.send("Runtime.getHeapUsage");
  console.log(
    `Weave maximum: ${elapsed} ms control-to-drawing; ${((after.usedSize - before.usedSize) / 1024).toFixed(0)} KB retained main-page heap`,
  );
  expect(after.usedSize - before.usedSize).toBeLessThan(32 * 1024 * 1024);
});
