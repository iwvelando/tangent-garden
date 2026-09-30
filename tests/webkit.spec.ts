import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { exportImage, openExportSettings, choosePreset, open } from "./helpers";
import { decodeVideo, probe, frameCoverage } from "./video";
import { exportTiming } from "../web/export-quality";

// Safari's engine, which every iOS browser also uses: no canvas WebP, and its
// own H.264 encoder and VideoFrame behavior. Runs in the WebKit project only
// (`make test-webkit`, and the macOS CI job).

const exportMP4 = (page: Page) =>
  page.getByRole("button", { name: "Export MP4 video" });

async function ready(page: Page) {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await openExportSettings(page);
  expect(
    await page.evaluate(() => typeof VideoEncoder),
    "WebKit here has no WebCodecs video encoder",
  ).toBe("function");
}
// Resolves with the download, or fails at once with the page's own error.
async function save(page: Page) {
  await expect(exportMP4(page)).toBeEnabled();
  const download = page.waitForEvent("download", { timeout: 120000 });
  const alert = page
    .getByRole("alert")
    .waitFor({ timeout: 120000 })
    .then(async () => {
      throw new Error(await page.getByRole("alert").innerText());
    });
  alert.catch(() => {});
  await exportMP4(page).click();
  return (await Promise.race([download, alert])).path();
}

test("WebKit offers MP4 only, with 60 fps and no loop setting", async ({
  page,
}) => {
  await ready(page);
  await expect(exportMP4(page)).toBeEnabled();
  await expect(
    page.getByRole("combobox", { name: "Export format" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", { name: "Loop exported animation" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Export frame rate" }).locator("option"),
  ).toHaveText([
    "60 fps · smoothest motion",
    "30 fps · smoother motion",
    "15 fps · smaller file",
  ]);
});

// The reported Safari failure: WebKit rounds VideoFrame timestamps, first at
// 8.033 s of a 10 s export. The file must be complete with exact timing.
test("a 10 s parameter animation exports every frame with exact timing", async ({
  page,
}) => {
  test.setTimeout(180000);
  await ready(page);
  await choosePreset(page, "2");
  await page
    .getByRole("combobox", { name: "Source coordinates" })
    .selectOption("polar");
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("parameters");
  await page
    .getByRole("combobox", { name: "Parameter 1", exact: true })
    .selectOption("sourceTheta");
  await page.getByRole("textbox", { name: "Track 1 from" }).fill("0");
  await page.getByRole("textbox", { name: "Track 1 to" }).fill("pi/4");
  // Timestamps do not depend on size; a small frame keeps the job quick.
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("0.5");
  const path = (await save(page))!;
  const durations = exportTiming(10, 30).map((f) => f.duration);
  const probed = probe(path);
  if (probed) {
    expect(probed.codec).toBe("h264");
    // A macOS VM's encoder reports plain Baseline, hardware Constrained
    // Baseline. Neither allows B-frames, which is what the writer relies on.
    expect(probed.profile).toMatch(/^(Constrained )?Baseline$/);
    expect(probed.bFrames).toBe(0);
    expect([probed.width, probed.height]).toEqual([500, 380]);
    expect(probed.frames).toBe(300);
    expect(probed.durations).toEqual(durations);
  }
  // WebKit's own demuxer and decoder.
  const decoded = await decodeVideo(page, await readFile(path));
  expect(decoded.duration).toBeCloseTo(10, 3);
  expect(decoded.first.hash).not.toBe(decoded.last.hash);
});

test("a 60 fps MP4 decodes with exact timing", async ({ page }) => {
  await ready(page);
  await page
    .getByRole("combobox", { name: "Export frame rate" })
    .selectOption("60");
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("0.5");
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("1");
  const path = (await save(page))!;
  const probed = probe(path);
  if (probed) {
    expect(probed.frames).toBe(60);
    expect(probed.durations).toEqual(
      exportTiming(1, 60).map((f) => f.duration),
    );
  }
  const decoded = await decodeVideo(page, await readFile(path));
  expect(decoded.duration).toBeCloseTo(1, 3);
});

test("PNG export works in WebKit", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  const download = page.waitForEvent("download");
  await exportImage(page, "PNG");
  const bytes = await readFile((await (await download).path())!);
  expect(bytes.toString("ascii", 12, 16)).toBe("IHDR");
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([
    2000, 1520,
  ]);
});

for (const [preset, name] of [
  ["3", "custom developable"],
  ["7", "tangent-foot projection"],
  ["8", "tangent-line orthotomic"],
  ["11", "sphere inversion of a projection"],
  ["12", "harmonic generator with vectors and ellipses"],
  ["17", "framed ribbon with an exposed seam"],
  ["18", "ruled harmonic loom"],
  ["23", "canal surface with a vanishing envelope"],
  ["25", "vector-field trajectories standing alone"],
  ["27", "spatial cyclic pursuit with connecting polygons"],
  ["32", "surface with its focal sheets"],
  ["35", "mirror with its caustic sheets"],
  ["40", "refracting dome with its receiver"],
  ["48", "level surface with its sections"],
])
  test(`spatial ${name} renders and exports through WebKit WebGL and H.264`, async ({
    page,
  }) => {
    await page.goto("/?study=3d");
    await choosePreset(page, preset);
    await expect(page.locator(".spatial-stage")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(page.getByRole("alert")).toHaveCount(0);
    const image = page.waitForEvent("download");
    await exportImage(page, "PNG");
    const bytes = await readFile((await (await image).path())!);
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([
      2000, 1520,
    ]);
    await open(page, "#spatial-animation-section");
    await page.getByLabel("Duration (seconds)").fill("0.4");
    await open(page, "#spatial-export-settings");
    await page.getByLabel("Export frame rate").selectOption("15");
    await page
      .getByRole("slider", { name: "Export resolution", exact: true })
      .fill("0.5");
    const path = (await save(page))!;
    const data = probe(path);
    if (data) {
      expect(data.frames).toBe(6);
      expect(data.durations.reduce((a, b) => a + b, 0)).toBe(400);
    }
    const video = await decodeVideo(page, await readFile(path));
    expect(video.duration).toBeCloseTo(0.4, 3);
    expect(video.first.hash).not.toBe(video.last.hash);
  });

// An iterated map's density is a PNG embedded in the SVG; drawing that SVG
// to a canvas must keep it and must not taint the canvas.
test("PNG export keeps an iterated map's embedded density in WebKit", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await choosePreset(page, { label: "Clifford attractor" });
  await expect(page.getByTestId("attractor-density")).toHaveCount(1);
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const download = page.waitForEvent("download");
  await exportImage(page, "PNG");
  const bytes = await readFile((await (await download).path())!);
  const shaded = await page.evaluate(async (png) => {
    const bitmap = await createImageBitmap(
      new Blob([new Uint8Array(png)], { type: "image/png" }),
    );
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let n = 0;
    for (let i = 0; i < data.length; i += 4)
      if (data[i] !== data[0] || data[i + 1] !== data[1]) n++;
    return n / (data.length / 4);
  }, Array.from(bytes));
  expect(shaded).toBeGreaterThan(0.1);
});

for (const name of ["A sphere in passing", "A ring in passing"])
  test(`curved 4D ${name} renders and exports through WebKit`, async ({
    page,
  }) => {
    await page.goto("/?study=4d");
    await choosePreset(page, { label: name });
    await expect(page.locator(".tesseract-stage")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(page.getByRole("alert")).toHaveCount(0);
    const image = page.waitForEvent("download");
    await exportImage(page, "PNG");
    const bytes = await readFile((await (await image).path())!);
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([
      2000, 1520,
    ]);
    await page.getByLabel("Duration (seconds)").fill(".4");
    await open(page, "#shape-export-settings");
    await page.getByLabel("Export frame rate").selectOption("15");
    await page
      .getByRole("slider", { name: "Export resolution", exact: true })
      .fill("0.5");
    const path = (await save(page))!;
    const data = probe(path);
    if (data) {
      expect(data.frames).toBe(6);
      expect(data.durations.reduce((a, b) => a + b, 0)).toBe(400);
    }
    const video = await decodeVideo(page, await readFile(path));
    expect(video.duration).toBeCloseTo(0.4, 3);
    const coverage = frameCoverage(path, 500, 380);
    if (coverage) {
      console.log("WebKit curved decoded coverage", coverage);
      expect(coverage[0]).toBeLessThan(0.001);
      expect(coverage.at(-1)!).toBeLessThan(0.001);
      expect(coverage[2]).toBeGreaterThan(0.005);
    }
  });

for (const mode of ["reference", "lifted"])
  test(`localized lift ${mode} renders and exports through WebKit`, async ({
    page,
  }) => {
    await page.goto("/?study=4d");
    await choosePreset(page, { label: "The missing middle" });
    const settle = () =>
      expect(page.locator(".tesseract-stage")).toHaveAttribute(
        "aria-busy",
        "false",
      );
    await settle();
    await page
      .getByRole("combobox", { name: "View operation", exact: true })
      .selectOption(mode);
    await settle();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.locator("#tesseract-artwork text")).toHaveCount(0);
    await page
      .getByRole("checkbox", { name: "Missing-region guide", exact: true })
      .check();
    if (mode === "lifted")
      await page
        .getByRole("checkbox", { name: "Displacement connectors", exact: true })
        .check();
    const image = page.waitForEvent("download");
    await exportImage(page, "PNG");
    const bytes = await readFile((await (await image).path())!);
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([
      2000, 1520,
    ]);
    await page.getByLabel("Duration (seconds)").fill(".4");
    await open(page, "#shape-export-settings");
    await page.getByLabel("Export frame rate").selectOption("15");
    await page
      .getByRole("slider", { name: "Export resolution", exact: true })
      .fill("0.5");
    const path = (await save(page))!,
      data = probe(path);
    if (data) {
      expect(data.frames).toBe(6);
      expect(data.durations.reduce((a, b) => a + b, 0)).toBe(400);
    }
    const video = await decodeVideo(page, await readFile(path));
    expect(video.duration).toBeCloseTo(0.4, 3);
    expect(video.first.hash).not.toBe(video.last.hash);
  });

for (const name of ["Rings from a sphere", "Tori between two circles"])
  test(`spherical weave ${name} renders and exports through WebKit`, async ({
    page,
  }) => {
    await page.goto("/?study=4d");
    await choosePreset(page, { label: name });
    const settle = () =>
      expect(page.locator(".tesseract-stage")).toHaveAttribute(
        "aria-busy",
        "false",
      );
    await settle();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.locator("#tesseract-artwork text")).toHaveCount(0);
    await expect(
      page.locator('#tesseract-artwork path[data-role="window"]'),
    ).toHaveCount(3);
    const image = page.waitForEvent("download");
    await exportImage(page, "PNG");
    const bytes = await readFile((await (await image).path())!);
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([
      2000, 1520,
    ]);
    // A full rotation returns to its start; the latitude sweep does not.
    await page
      .getByRole("combobox", { name: "Animate", exact: true })
      .selectOption("latitude");
    await page.getByLabel("Duration (seconds)").fill(".4");
    await open(page, "#shape-export-settings");
    await page.getByLabel("Export frame rate").selectOption("15");
    await page
      .getByRole("slider", { name: "Export resolution", exact: true })
      .fill("0.5");
    const path = (await save(page))!,
      data = probe(path);
    if (data) {
      expect(data.frames).toBe(6);
      expect(data.durations.reduce((a, b) => a + b, 0)).toBe(400);
    }
    const video = await decodeVideo(page, await readFile(path));
    expect(video.duration).toBeCloseTo(0.4, 3);
    expect(video.first.hash).not.toBe(video.last.hash);
  });

for (const mode of ["shadow", "diagram"])
  test(`shell bypass ${mode} renders and exports through WebKit`, async ({
    page,
  }) => {
    await page.goto("/?study=4d");
    await choosePreset(page, { label: "Beside the wall" });
    const settle = () =>
      expect(page.locator(".tesseract-stage")).toHaveAttribute(
        "aria-busy",
        "false",
      );
    await settle();
    await page
      .getByRole("combobox", { name: "View operation", exact: true })
      .selectOption(mode);
    await settle();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.locator("#tesseract-artwork text")).toHaveCount(0);
    await page
      .getByRole("checkbox", { name: "Comparison points", exact: true })
      .check();
    const image = page.waitForEvent("download");
    await exportImage(page, "PNG");
    const bytes = await readFile((await (await image).path())!);
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([
      2000, 1520,
    ]);
    await page.getByLabel("Duration (seconds)").fill(".4");
    await open(page, "#shape-export-settings");
    await page.getByLabel("Export frame rate").selectOption("15");
    await page
      .getByRole("slider", { name: "Export resolution", exact: true })
      .fill("0.5");
    const path = (await save(page))!,
      data = probe(path);
    if (data) {
      expect(data.frames).toBe(6);
      expect(data.durations.reduce((a, b) => a + b, 0)).toBe(400);
    }
    const video = await decodeVideo(page, await readFile(path));
    expect(video.duration).toBeCloseTo(0.4, 3);
    expect(video.first.hash).not.toBe(video.last.hash);
  });

for (const width of [1440, 390])
  test(`paired bypass ${width}px exports synchronized geometry through WebKit`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/?study=4d");
    await choosePreset(page, { label: "Beside the wall" });
    const settle = () =>
      expect(page.locator(".tesseract-stage")).toHaveAttribute(
        "aria-busy",
        "false",
      );
    await settle();
    await page
      .getByRole("combobox", { name: "View operation", exact: true })
      .selectOption("paired");
    await settle();
    await expect(
      page.locator("#tesseract-artwork svg[data-representation]"),
    ).toHaveCount(2);
    await expect(page.locator("#tesseract-artwork text")).toHaveCount(0);
    await page
      .getByRole("spinbutton", { name: "Duration (seconds)" })
      .fill(".4");
    await open(page, "#shape-export-settings");
    await page.getByLabel("Export frame rate").selectOption("15");
    await page
      .getByRole("slider", { name: "Export resolution", exact: true })
      .fill("0.5");
    const path = (await save(page))!,
      data = probe(path);
    if (data) {
      expect([data.width, data.height, data.frames]).toEqual(
        width > 700 ? [1000, 380, 6] : [500, 760, 6],
      );
      expect(data.durations.reduce((a, b) => a + b, 0)).toBe(400);
    }
    const video = await decodeVideo(page, await readFile(path));
    expect(video.duration).toBeCloseTo(0.4, 3);
    expect(video.first.hash).not.toBe(video.last.hash);
  });

test("WebKit opens a study link made elsewhere and copies its own", async ({
  page,
}) => {
  // Encoded by Node's zlib, as another browser's deflate-raw stream would be.
  const { deflateRawSync } = await import("node:zlib");
  const { presets } = await import("../web/presets");
  const config = structuredClone(presets[1].config);
  config.curve.a = 1.25;
  const token = deflateRawSync(
    Buffer.from(
      JSON.stringify({
        v: 1,
        notebook: "2d",
        study: { config, bounds: { min: "0", max: "2*pi" } },
      }),
    ),
  ).toString("base64url");
  await page.goto(`/#s=${token}`);
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  const shown = JSON.parse(
    (await page.locator("#artwork desc").textContent())!,
  );
  expect(shown.curve.a).toBe(1.25);
  expect(new URL(page.url()).hash).toBe("");
  // Its own encoder round-trips through its decoder.
  const reopened = await page.evaluate(async () => {
    const stream = new Blob([new TextEncoder().encode('{"v":1}')])
      .stream()
      .pipeThrough(new CompressionStream("deflate-raw"))
      .pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(stream).text();
  });
  expect(reopened).toBe('{"v":1}');
});
