import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  choosePreset,
  chooseNotebook,
  exportImage,
  openShapeExport,
} from "./helpers";
import { probe, decodeVideo, frameCoverage, frameDifference } from "./video";
const stage = (p: Page) => p.locator(".tesseract-stage");
const settle = (p: Page) =>
  expect(stage(p)).toHaveAttribute("aria-busy", "false");
const config = async (p: Page) =>
  JSON.parse((await stage(p).getAttribute("data-config"))!);
const meta = async (p: Page) =>
  JSON.parse((await p.locator("#tesseract-artwork desc").textContent())!);
const presets = ["A sphere in passing", "A ring in passing"];

for (const preset of presets) {
  test(`${preset}: exact sections, identity, custom counts and animation restoration`, async ({
    page,
  }) => {
    await page.goto("/?study=4d");
    await settle(page);
    await choosePreset(page, { label: preset });
    await settle(page);
    const base = await config(page),
      support = base.object === "ball" ? base.radius : base.tube;
    await expect(
      page.getByRole("textbox", { name: "xw angle", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("combobox", { name: "Animate" }).locator("option"),
    ).toHaveCount(1);
    await expect(
      page.getByRole("combobox", { name: "View operation" }).locator("option"),
    ).toHaveCount(1);
    await page.getByRole("spinbutton", { name: "Section count" }).fill("2");
    await page
      .getByRole("textbox", { name: "Section spread" })
      .fill(String(support));
    await settle(page);
    let m = await meta(page);
    expect(m.sections[0].id).not.toBe(m.sections[1].id);
    const paths = page.locator('#tesseract-artwork path[data-role="section"]');
    const first = await paths
      .filter({})
      .evaluateAll((els) =>
        els
          .filter((e) => e.getAttribute("data-section") === "section/0")
          .map((e) => e.getAttribute("d")),
      );
    const last = await paths.evaluateAll((els) =>
      els
        .filter((e) => e.getAttribute("data-section") === "section/1")
        .map((e) => e.getAttribute("d")),
    );
    expect(first).toEqual(last);
    await page.getByRole("spinbutton", { name: "Section count" }).fill("1");
    await page.getByRole("spinbutton", { name: "Curve samples" }).fill("96");
    await page
      .getByRole("spinbutton", { name: "Curves per direction" })
      .fill("6");
    await page
      .getByRole("textbox", { name: "Slice offset h" })
      .fill(String(support));
    await settle(page);
    await expect(page.locator(".tesseract-diagnostics")).toContainText(
      base.object === "ball" ? "Point contact" : "Core circle",
    );
    await expect(paths).toHaveCount(base.object === "ball" ? 0 : 1);
    await page
      .getByRole("textbox", { name: "Slice offset h" })
      .fill(String(support * 1.05));
    await settle(page);
    await expect(page.locator(".tesseract-diagnostics")).toContainText(
      "Empty section",
    );
    await expect(paths).toHaveCount(0);
    await choosePreset(page, { label: preset });
    await settle(page);
    const art = page.locator("#tesseract-artwork");
    await art.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowUp");
    await page.keyboard.press("+");
    const camera = (await meta(page)).view;
    await page
      .getByRole("spinbutton", { name: "Duration (seconds)" })
      .fill("1");
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await settle(page);
    const slider = page.getByRole("slider", { name: "Animation progress" });
    for (const p of [0, 0.5, 1, 0.5]) {
      await slider.fill(String(p));
      await settle(page);
      m = await meta(page);
      expect(m.view).toEqual(camera);
      expect(m.sections.every((s: any) => s.dimension === -1)).toBe(
        p === 0 || p === 1,
      );
      expect((await config(page)).slice).toBeCloseTo(
        (1.025 * support + base.spread / 2) * (2 * p - 1),
        10,
      );
    }
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Replay", exact: true }),
    ).toBeVisible();
    await settle(page);
    await page
      .getByRole("button", { name: "Back to study", exact: true })
      .click();
    await settle(page);
    expect(await config(page)).toEqual(base);
    expect((await meta(page)).view).toEqual(camera);
    await chooseNotebook(page, "2d");
    await chooseNotebook(page, "4d");
    await settle(page);
    expect(await config(page)).toEqual(base);
    await page.getByRole("spinbutton", { name: "Section count" }).fill("25");
    await page
      .getByRole("spinbutton", { name: "Curves per direction" })
      .fill("16");
    await settle(page);
    await expect(page.getByRole("alert")).toContainText("budget");
  });
}
for (const width of [1440, 390])
  for (const theme of ["light", "dark"] as const)
    test(`curved sections visuals ${width} ${theme}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/?study=4d");
      await settle(page);
      for (const preset of [...presets, "Section garden"]) {
        await choosePreset(page, { label: preset });
        await settle(page);
        await expect(page.getByRole("alert")).toHaveCount(0);
        expect((await meta(page)).emittedPoints).toBeGreaterThan(0);
        if (preset !== "Section garden") {
          await expect(page.locator(".section-identity")).toContainText(
            "Selected section",
          );
          await expect(
            page.locator(".tesseract-legend [data-section]"),
          ).toHaveCount(5);
        } else
          await expect(page.locator(".tesseract-diagnostics")).toHaveText(
            "17 of 17 sections intersect the tesseract.",
          );
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width);
        if (width === 1440) {
          const y = (await stage(page).boundingBox())!.y;
          await page
            .locator("aside")
            .evaluate((e) => (e.scrollTop = e.scrollHeight));
          expect((await stage(page).boundingBox())!.y).toBe(y);
        }
        await stage(page).scrollIntoViewIfNeeded();
        await page.screenshot({
          path: info.outputPath(`${preset}-${width}-${theme}.png`),
          fullPage: true,
        });
      }
    });
test("curved vector export records object, levels, operation, and limitations", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  await settle(page);
  await choosePreset(page, { label: presets[1] });
  await settle(page);
  const downloading = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const file = await downloading;
  const svg = await readFile((await file.path())!, "utf8");
  expect(svg).toContain('data-role="section"');
  expect(svg).not.toContain("<image");
  const m = await page.evaluate(
    (text) =>
      JSON.parse(
        new DOMParser()
          .parseFromString(text, "image/svg+xml")
          .querySelector("desc")!.textContent!,
      ),
    svg,
  );
  expect(m.object).toBe("tube");
  expect(m.operation).toBe("section");
  expect(m.sections).toHaveLength(5);
  expect(m.limitations).toContain("axis-aligned");
});
for (const format of ["mp4", "webp"] as const)
  test(`curved ${format} export has empty endpoints, interior sections and exact duration`, async ({
    page,
  }) => {
    test.slow();
    await page.goto("/?study=4d");
    await settle(page);
    await choosePreset(page, { label: presets[1] });
    await settle(page);
    await page
      .getByRole("spinbutton", { name: "Duration (seconds)" })
      .fill("1");
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
    await page
      .getByRole("spinbutton", { name: "Selected section", exact: true })
      .fill("2");
    expect((await meta(page)).layers.selectedSection).toBe(1);
    // The middle export frame has h = 0, matching this immutable live study.
    const reference = await page.evaluate(async () => {
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
    const downloading = page.waitForEvent("download");
    await page
      .getByRole("button", { name: /^Export (MP4 video|animated WebP)/ })
      .click();
    const file = await downloading;
    const path = (await file.path())!;
    const bytes = await readFile(path);
    if (format === "mp4") {
      const p = probe(path);
      if (p) {
        expect(p.width).toBe(500);
        expect(p.height).toBe(380);
        expect(p.frames).toBe(15);
        expect(p.durations.reduce((a, b) => a + b, 0)).toBe(1000);
      }
      const v = await decodeVideo(page, bytes);
      expect(v.duration).toBeCloseTo(1, 3);
      const difference = frameDifference(path, 500, 380, 7, reference);
      if (difference !== null) {
        console.log("Decoded MP4/live drawing parity", difference);
        // H.264 colour quantization/chroma subsampling can change thin strokes;
        // verify their positions in both directions with a one-pixel allowance.
        expect(difference.meanDifference).toBeLessThan(6);
        expect(difference.unmatchedInk).toBeLessThan(0.02);
      }
      const coverage = frameCoverage(path, 500, 380);
      if (coverage) {
        console.log("Curved MP4 decoded coverage", coverage);
        expect(coverage[0]).toBeLessThan(0.001);
        expect(coverage.at(-1)!).toBeLessThan(0.001);
        expect(coverage[7]).toBeGreaterThan(0.005);
      }
    } else {
      const decoded = await page.evaluate(
        async ({ input, reference }) => {
          const d = new (window as any).ImageDecoder({
            data: new Uint8Array(input),
            type: "image/webp",
          });
          await d.tracks.ready;
          const count = d.tracks.selectedTrack.frameCount;
          const c = document.createElement("canvas");
          c.width = 500;
          c.height = 380;
          const ctx = c.getContext("2d")!;
          let difference = 0;
          const hashes: number[] = [],
            durations: number[] = [];
          for (let i = 0; i < count; i++) {
            const { image } = await d.decode({ frameIndex: i });
            ctx.drawImage(image, 0, 0);
            let h = 0;
            const pixels = ctx.getImageData(0, 0, 500, 380).data;
            if (i === 7) {
              for (let j = 0; j < pixels.length; j++)
                if (j % 4 !== 3)
                  difference += Math.abs(pixels[j] - reference[j]);
              difference /= 500 * 380 * 3;
            }
            for (const v of pixels) h = (Math.imul(h, 31) + v) | 0;
            hashes.push(h);
            durations.push(image.duration);
            image.close();
          }
          d.close();
          return { count, hashes, durations, difference };
        },
        { input: Array.from(bytes), reference },
      );
      expect(decoded.difference).toBeLessThan(3);
      expect(decoded.count).toBe(15);
      expect(decoded.durations.reduce((a, b) => a + b, 0)).toBe(1000000);
      expect(decoded.hashes[0]).toBe(decoded.hashes.at(-1));
      expect(decoded.hashes[7]).not.toBe(decoded.hashes[0]);
    }
  });

test("largest curved family remains bounded through worker and SVG drawing", async ({
  page,
}, info) => {
  await page.goto("/?study=4d");
  await settle(page);
  await choosePreset(page, { label: presets[1] });
  await settle(page);
  await page.getByRole("textbox", { name: "Section spread" }).fill("0");
  await settle(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.collectGarbage");
  const before = await cdp.send("Runtime.getHeapUsage");
  const start = performance.now();
  await page.getByRole("spinbutton", { name: "Section count" }).fill("16");
  await page
    .getByRole("spinbutton", { name: "Curves per direction" })
    .fill("16");
  await page.getByRole("spinbutton", { name: "Curve samples" }).fill("127");
  await settle(page);
  const elapsed = performance.now() - start;
  expect(elapsed).toBeLessThan(10000);
  const m = await meta(page);
  expect(m.emittedPoints).toBe(65536);
  expect(m.evaluations).toBe(65024);
  await expect(
    page.locator('#tesseract-artwork path[data-role="section"]'),
  ).toHaveCount(512);
  await cdp.send("HeapProfiler.collectGarbage");
  const after = await cdp.send("Runtime.getHeapUsage");
  expect(after.usedSize - before.usedSize).toBeLessThan(64 * 1024 * 1024);
  const measured = {
    elapsedMs: elapsed,
    mainRetainedHeapDelta: after.usedSize - before.usedSize,
    mainHeapBytes: after.usedSize,
    embeddedGeometryPoints: m.emittedPoints,
    evaluations: m.evaluations,
  };
  console.log("Largest curved browser family", measured);
  await info.attach("curved-browser-budget", {
    body: JSON.stringify(measured),
    contentType: "application/json",
  });
  await cdp.detach();
});

test("object selector restores work and offers valid small-radius studies", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  await settle(page);
  await page
    .getByRole("textbox", { name: "xw angle", exact: true })
    .fill("pi/4");
  await page
    .getByRole("combobox", { name: "View of the tesseract" })
    .selectOption("stereo");
  await page.getByRole("spinbutton", { name: "Face grid lines" }).fill("7");
  await page
    .getByRole("textbox", { name: "Projection window radius" })
    .fill("6");
  await settle(page);
  const cube = await config(page);
  const object = page.getByRole("combobox", { name: "4D object", exact: true });
  for (const target of ["ball", "tube", "tesseract"]) {
    await object.selectOption(target);
    await settle(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(
      page.getByRole("combobox", { name: "Animate" }).locator("option"),
    ).toHaveCount(target === "tesseract" ? 2 : 1);
    await expect(
      page
        .getByRole("combobox", {
          name:
            target === "tesseract" ? "View of the tesseract" : "View operation",
        })
        .locator("option"),
    ).toHaveCount(target === "tesseract" ? 4 : 1);
  }
  expect(await config(page)).toEqual(cube);
});

test("object selector handles the small ring repro and low-radius ball to tube", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  await settle(page);
  await choosePreset(page, { label: presets[1] });
  await page
    .getByRole("textbox", { name: "Core radius R", exact: true })
    .fill("0.5");
  await page
    .getByRole("textbox", { name: "Tube radius r", exact: true })
    .fill("0.1");
  await settle(page);
  const object = page.getByRole("combobox", { name: "4D object", exact: true });
  await object.selectOption("ball");
  await settle(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.locator('#tesseract-artwork path[data-role="section"]'),
  ).not.toHaveCount(0);
  await page
    .getByRole("textbox", { name: "4-ball radius R", exact: true })
    .fill("0.002");
  await settle(page);
  for (const target of ["tube", "ball", "tube"]) {
    await object.selectOption(target);
    await settle(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect((await meta(page)).emittedPoints).toBeGreaterThan(0);
  }
});

test("object selector discards an outstanding scalar evaluation", async ({
  page,
}) => {
  // Hold the scalar request until after the object replacement, rather than racing a fast worker.
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      postMessage(data: any) {
        if ((window as any).holdScalar && data.action === "scalars") {
          (window as any).scalarPending = true;
          setTimeout(() => super.postMessage(data), 500);
        } else super.postMessage(data);
      }
    } as any;
  });
  await page.goto("/?study=4d");
  await settle(page);
  await choosePreset(page, { label: presets[0] });
  await settle(page);
  await page.evaluate(() => ((window as any).holdScalar = true));
  await page
    .getByRole("textbox", { name: "4-ball radius R", exact: true })
    .fill("e");
  await expect
    .poll(() => page.evaluate(() => (window as any).scalarPending))
    .toBe(true);
  await page
    .getByRole("combobox", { name: "4D object", exact: true })
    .selectOption("tube");
  await settle(page);
  const target = await config(page);
  await page.waitForTimeout(600);
  expect(await config(page)).toEqual(target);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("section diagnostics preserve concise tesseract and curved summaries", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  await settle(page);
  await choosePreset(page, { label: "Section garden" });
  await settle(page);
  await expect(page.locator(".tesseract-diagnostics")).toHaveText(
    "17 of 17 sections intersect the tesseract.",
  );
  await choosePreset(page, { label: "An octahedron within" });
  await settle(page);
  await expect(page.locator(".tesseract-diagnostics")).toHaveText(
    "h = 0.000 · 6 vertices · 12 edges · 8 faces",
  );
  await choosePreset(page, { label: presets[0] });
  await settle(page);
  await expect(page.locator(".tesseract-diagnostics")).toHaveText(
    "5 of 5 sections intersect the 4-ball.",
  );
});

test("section identity distinguishes coincident levels and survives scrub and SVG export", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  await settle(page);
  await choosePreset(page, { label: presets[0] });
  await settle(page);
  const styles = await page
    .locator('#tesseract-artwork path[data-role="section"]')
    .evaluateAll((els) =>
      Array.from(
        new Map(
          els.map((e) => [
            e.getAttribute("data-section"),
            [e.getAttribute("stroke"), e.getAttribute("stroke-dasharray")],
          ]),
        ).values(),
      ),
    );
  expect(new Set(styles.map((s) => JSON.stringify(s))).size).toBe(5);
  await page
    .getByRole("spinbutton", { name: "Selected section", exact: true })
    .fill("2");
  await expect(page.locator(".section-identity")).toContainText("h = −0.80000");
  await expect(
    page.locator('#tesseract-artwork path[data-section="section/1"]').first(),
  ).toHaveAttribute("data-selected", "true");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("slider", { name: "Animation progress" }).fill("0.5");
  await settle(page);
  expect((await meta(page)).layers.selectedSection).toBe(1);
  await expect(page.locator(".section-identity")).toContainText("h = −0.80000");
  const downloading = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const svg = await readFile((await (await downloading).path())!, "utf8");
  expect(svg).toContain('data-selected="true"');
  expect(svg).toContain('stroke-dasharray="7 5"');
  expect(svg).not.toMatch(/<(?:text|tspan|textPath|foreignObject)\b/);
});

for (const [preset, expected] of [
  ["An octahedron within", "h = 0.000 · 6 vertices · 12 edges · 8 faces"],
  [presets[0], "5 of 5 sections intersect the 4-ball."],
])
  test(`single and family diagnostic: ${preset}`, async ({ page }) => {
    await page.goto("/?study=4d");
    await settle(page);
    await choosePreset(page, { label: preset });
    await settle(page);
    await expect(page.locator(".tesseract-diagnostics")).toHaveText(expected);
  });
test("fresh low-radius ball switches to a valid tube", async ({ page }) => {
  await page.goto("/?study=4d");
  await settle(page);
  await page
    .getByRole("combobox", { name: "4D object", exact: true })
    .selectOption("ball");
  await page
    .getByRole("textbox", { name: "4-ball radius R", exact: true })
    .fill("0.1");
  await settle(page);
  await page
    .getByRole("combobox", { name: "4D object", exact: true })
    .selectOption("tube");
  await settle(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect((await config(page)).tube).toBeLessThan((await config(page)).radius);
});
test("tesseract slice help describes its own passage and SVG title has normal spacing", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  await settle(page);
  await choosePreset(page, { label: "An octahedron within" });
  await settle(page);
  await page
    .getByRole("button", { name: "About animation modes", exact: true })
    .click();
  await expect(page.locator("#shape-animation-section")).not.toContainText(
    "Curved families",
  );
  expect(await page.locator("#tesseract-artwork title").textContent()).toBe(
    "Tangent Garden — tesseract cross-sections",
  );
});

test("point-contact sections carry the selected identity in the drawing", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  await settle(page);
  await choosePreset(page, { label: presets[0] });
  await page.getByRole("spinbutton", { name: "Section count" }).fill("1");
  await page.getByRole("textbox", { name: "Slice offset h" }).fill("2");
  await settle(page);
  await expect(
    page.locator('#tesseract-artwork circle[data-section="section/0"]'),
  ).toHaveAttribute("data-selected", "true");
});

for (const preset of presets)
  test(`renderable viewport and exported SVG contain no visible text: ${preset}`, async ({
    page,
  }) => {
    await page.goto("/?study=4d");
    await settle(page);
    await choosePreset(page, { label: preset });
    await settle(page);
    const artwork = page.locator("#tesseract-artwork");
    await expect(
      artwork.locator("text, tspan, textPath, foreignObject"),
    ).toHaveCount(0);
    await page
      .getByRole("spinbutton", { name: "Selected section", exact: true })
      .fill("2");
    await expect(page.locator(".section-identity")).toContainText(
      "Selected section 2",
    );
    const downloading = page.waitForEvent("download");
    await exportImage(page, "SVG");
    const svg = await readFile((await (await downloading).path())!, "utf8");
    const exported = await page.evaluate((text) => {
      const svg = new DOMParser().parseFromString(text, "image/svg+xml");
      return {
        text: svg.querySelectorAll("text, tspan, textPath, foreignObject")
          .length,
        selected: JSON.parse(svg.querySelector("desc")!.textContent!).layers
          .selectedSection,
      };
    }, svg);
    expect(exported.text).toBe(0);
    expect(exported.selected).toBe(1);
  });
