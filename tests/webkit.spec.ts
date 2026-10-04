import { test, expect, devices, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { exportImage, openExportSettings, choosePreset, open } from "./helpers";
import { decodeVideo, probe, frameCoverage } from "./video";
import { exportTiming } from "../web/export-quality";
import { deflateRawSync } from "node:zlib";
import { spatialPresets } from "../web/spatial/presets";
import { defaultLayers } from "../web/spatial/renderer";
import { defaultSight, strokeWidth } from "../web/spatial/sight";
import { lineColor, palette } from "../web/spatial/palette";

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

test("the cut plane draws, exports and peels through WebKit WebGL and H.264", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await choosePreset(page, { label: "An ellipsoid hiding its centers" });
  const stage = page.locator(".spatial-stage");
  await expect(stage).toHaveAttribute("aria-busy", "false");
  await expect(page.getByRole("alert")).toHaveCount(0);
  const png = async () => {
    const image = page.waitForEvent("download");
    await exportImage(page, "PNG");
    return readFile((await (await image).path())!);
  };
  const cut = await png();
  expect([cut.readUInt32BE(16), cut.readUInt32BE(20)]).toEqual([2000, 1520]);
  const enable = page.getByRole("checkbox", { name: "Cut with a plane" });
  await enable.uncheck();
  const whole = await png();
  expect(whole.equals(cut)).toBe(false);
  await enable.check();
  expect((await png()).equals(cut)).toBe(true);
  // A peel exported as H.264 runs from the whole shell to none of it.
  await open(page, "#spatial-animation-section");
  await page.getByLabel("Animate", { exact: true }).selectOption("cut");
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

test("see-through sheets and dashed hidden lines draw and export through WebKit WebGL and H.264", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await choosePreset(page, { label: "A Klein bottle passing through itself" });
  const stage = page.locator(".spatial-stage");
  await expect(stage).toHaveAttribute("aria-busy", "false");
  await expect(page.getByRole("alert")).toHaveCount(0);
  // WebKit renders to half-float targets, so the sheets are seen through,
  // not drawn opaque in their place.
  await expect(page.locator("#spatial-artwork")).toHaveAttribute(
    "data-sight",
    JSON.stringify({ sheets: "through", opacity: 0.3, hidden: "dashed" }),
  );
  const box = page.getByRole("group", { name: "See through" });
  await expect(box.getByText(/cannot draw see-through/)).toHaveCount(0);
  const png = async () => {
    const image = page.waitForEvent("download");
    await exportImage(page, "PNG");
    return readFile((await (await image).path())!);
  };
  const seen = await png();
  expect([seen.readUInt32BE(16), seen.readUInt32BE(20)]).toEqual([2000, 1520]);
  const sheets = box.getByLabel("Sheets", { exact: true });
  await sheets.selectOption("opaque");
  const opaque = await png();
  expect(opaque.equals(seen)).toBe(false);
  await sheets.selectOption("through");
  expect((await png()).equals(seen)).toBe(true);
  await open(page, "#spatial-animation-section");
  await page.getByLabel("Animate", { exact: true }).selectOption("reveal");
  await page.getByLabel("Duration (seconds)").fill("0.4");
  await open(page, "#spatial-export-settings");
  await page.getByLabel("Export frame rate").selectOption("15");
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("0.5");
  const path = (await save(page))!;
  const data = probe(path);
  if (data) expect(data.frames).toBe(6);
  const video = await decodeVideo(page, await readFile(path));
  expect(video.duration).toBeCloseTo(0.4, 3);
  expect(video.first.hash).not.toBe(video.last.hash);
});

test("riding a ray draws in perspective and exports through WebKit WebGL and H.264", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await choosePreset(page, { label: "Riding a ray through coma" });
  const stage = page.locator(".spatial-stage");
  await expect(stage).toHaveAttribute("aria-busy", "false");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await open(page, "#spatial-animation-section");
  await expect(
    page.getByLabel("Animation camera", { exact: true }),
  ).toHaveValue("ride");
  await page.getByRole("button", { name: "Play animation" }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("slider", { name: "Animation progress" }).fill("0.1");
  await expect(stage).toHaveAttribute("data-progress", "0.1");
  const view = JSON.parse(
    (await page.locator("#spatial-artwork").getAttribute("data-view"))!,
  );
  expect(view.lens.projection).toBe("perspective");
  // The shaded still has ink wherever the line drawing's visible mirror
  // curves are: WebKit's vertex shader projects as scene.ts does.
  const svgFile = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export image", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Lines (SVG) · visible only, sampled" })
    .click();
  const svg = (await readFile((await (await svgFile).path())!)).toString();
  const group = svg.match(/<g id="curves"[^>]*>(.*?)<\/g>/)![1];
  const points: [number, number][] = [];
  for (const d of group.matchAll(/ d="([^"]*)"/g))
    for (const line of d[1].split(/(?=M)/).filter(Boolean)) {
      const v = [...line.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map(
        (m) => [+m[1], +m[2]] as const,
      );
      for (let k = 1; k < v.length; k++) {
        const [a, b] = [v[k - 1], v[k]];
        const n = Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4);
        for (let m = 0; m < n; m++) {
          const x = a[0] + ((b[0] - a[0]) * m) / n,
            y = a[1] + ((b[1] - a[1]) * m) / n;
          if (x > 4 && x < 1996 && y > 4 && y < 1516) points.push([x, y]);
        }
      }
    }
  expect(points.length).toBeGreaterThan(200);
  const image = page.waitForEvent("download");
  await exportImage(page, "PNG");
  const png = await readFile((await (await image).path())!);
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([2000, 1520]);
  const agreement = await page.evaluate(
    async ([input, at]) => {
      const picture = new Image();
      picture.src = `data:image/png;base64,${input}`;
      await picture.decode();
      const c = document.createElement("canvas");
      c.width = picture.width;
      c.height = picture.height;
      const g = c.getContext("2d")!;
      g.drawImage(picture, 0, 0);
      const data = g.getImageData(0, 0, c.width, c.height).data;
      const inked = (x: number, y: number) => {
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const i = 4 * ((Math.round(y) + dy) * c.width + Math.round(x) + dx);
            if (
              Math.abs(data[i] - data[0]) +
                Math.abs(data[i + 1] - data[1]) +
                Math.abs(data[i + 2] - data[2]) >
              30
            )
              return true;
          }
        return false;
      };
      return at.filter(([x, y]) => inked(x, y)).length / at.length;
    },
    [png.toString("base64"), points] as const,
  );
  expect(agreement).toBeGreaterThan(0.9);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByLabel("Duration (seconds)").fill("0.4");
  await open(page, "#spatial-export-settings");
  await page.getByLabel("Export frame rate").selectOption("15");
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("0.5");
  const path = (await save(page))!;
  const data = probe(path);
  if (data) expect(data.frames).toBe(6);
  const video = await decodeVideo(page, await readFile(path));
  expect(video.duration).toBeCloseTo(0.4, 3);
  expect(video.first.hash).not.toBe(video.last.hash);
});

test("the manual camera draws through a perspective lens in WebKit WebGL", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await choosePreset(page, { label: "A spiral stair, down its well" });
  const stage = page.locator(".spatial-stage");
  await expect(stage).toHaveAttribute("aria-busy", "false");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("Projection", { exact: true })).toHaveValue(
    "wide",
  );
  await expect(stage.locator(".plot-meta > span")).toHaveText(
    /^Drag to orbit · /,
  );
  // The shaded still has ink wherever the line drawing's visible curve and
  // rulings are: WebKit's vertex shader projects through the manual lens as
  // scene.ts does.
  const svgFile = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export image", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Lines (SVG) · visible only, sampled" })
    .click();
  const svg = (await readFile((await (await svgFile).path())!)).toString();
  expect(svg).toContain('"projection":"wide"');
  const points: [number, number][] = [];
  for (const layer of ["base", "rulings"]) {
    const group = svg.match(new RegExp(`<g id="${layer}"[^>]*>(.*?)</g>`))![1];
    for (const d of group.matchAll(/ d="([^"]*)"/g))
      for (const line of d[1].split(/(?=M)/).filter(Boolean)) {
        const v = [...line.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map(
          (m) => [+m[1], +m[2]] as const,
        );
        for (let k = 1; k < v.length; k++) {
          const [a, b] = [v[k - 1], v[k]];
          const n = Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4);
          for (let m = 0; m < n; m++) {
            const x = a[0] + ((b[0] - a[0]) * m) / n,
              y = a[1] + ((b[1] - a[1]) * m) / n;
            if (x > 4 && x < 1996 && y > 4 && y < 1516) points.push([x, y]);
          }
        }
      }
  }
  expect(points.length).toBeGreaterThan(200);
  const image = page.waitForEvent("download");
  await exportImage(page, "PNG");
  const png = await readFile((await (await image).path())!);
  const agreement = await page.evaluate(
    async ([input, at]) => {
      const picture = new Image();
      picture.src = `data:image/png;base64,${input}`;
      await picture.decode();
      const c = document.createElement("canvas");
      c.width = picture.width;
      c.height = picture.height;
      const g = c.getContext("2d")!;
      g.drawImage(picture, 0, 0);
      const data = g.getImageData(0, 0, c.width, c.height).data;
      const inked = (x: number, y: number) => {
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const i = 4 * ((Math.round(y) + dy) * c.width + Math.round(x) + dx);
            if (
              Math.abs(data[i] - data[0]) +
                Math.abs(data[i + 1] - data[1]) +
                Math.abs(data[i + 2] - data[2]) >
              30
            )
              return true;
          }
        return false;
      };
      return at.filter(([x, y]) => inked(x, y)).length / at.length;
    },
    [png.toString("base64"), points] as const,
  );
  expect(agreement).toBeGreaterThan(0.9);
});

// Strokes need instanced drawing, which WebKit's WebGL offers: a bold
// curve is drawn its weight wide, a share of the page, in a still.
test("line weights draw strokes in WebKit WebGL", async ({ page }) => {
  await page.goto("/?study=3d");
  await choosePreset(page, { label: "An engraved trefoil tube" });
  const art = page.locator("#spatial-artwork");
  await expect(art).toHaveAttribute("data-strokes", '{"weight":"bold"}');
  const study = {
    config: {
      ...structuredClone(spatialPresets[0].config),
      format: "parametric",
      curve: {
        x: "2*cos(t)",
        y: "2*sin(t)",
        z: "0",
        a: 1,
        min: 0,
        max: 2 * Math.PI,
      },
    },
    layers: Object.fromEntries(
      Object.keys(defaultLayers).map((k) => [k, false]),
    ),
    view: { yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 },
    animation: { mode: "reveal", camera: "hold", duration: 10, tracks: [] },
    sight: { ...defaultSight, weight: "bold" },
  };
  await page.goto(
    `/?study=3d#s=${deflateRawSync(
      Buffer.from(JSON.stringify({ v: 1, notebook: "3d", study })),
    ).toString("base64url")}`,
  );
  await expect(page.locator(".spatial-stage")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(art).toHaveAttribute("data-strokes", '{"weight":"bold"}');
  const image = page.waitForEvent("download");
  await exportImage(page, "PNG");
  const png = await readFile((await (await image).path())!);
  const ground = palette.background[0].map((v) => v * 255),
    ink = lineColor(2, 0, false).map((v) => v * 255);
  const width = await page.evaluate(
    async ([input, ink, ground]) => {
      const picture = new Image();
      picture.src = `data:image/png;base64,${input}`;
      await picture.decode();
      const c = document.createElement("canvas");
      c.width = picture.width;
      c.height = picture.height;
      const g = c.getContext("2d")!;
      g.drawImage(picture, 0, 0);
      // The circle's leftmost point is on the middle row, its tangent
      // vertical: each pixel's share of the way to the curve's color.
      const row = g.getImageData(0, c.height >> 1, c.width >> 1, 1).data;
      const d = [0, 1, 2].map((k) => ink[k] - ground[k]);
      const dd = d.reduce((s, v) => s + v * v, 0);
      let sum = 0;
      for (let i = 0; i < row.length; i += 4) {
        let dot = 0;
        for (let k = 0; k < 3; k++) dot += (row[i + k] - ground[k]) * d[k];
        sum += Math.max(0, Math.min(1, dot / dd));
      }
      return sum;
    },
    [png.toString("base64"), ink, ground] as const,
  );
  const want = strokeWidth({ ink: 2 }, "bold", { width: 2000, height: 1520 })!;
  console.log("WebKit bold stroke", { want, width });
  expect(Math.abs(width - want)).toBeLessThan(0.15 * want);
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

// iOS WebKit ignores padding and height on a select drawn natively, so it
// shrank to about 21 px and clipped its text until tapped. Every select, in
// every notebook, must keep the fields' 36 px and padding on a phone.
// This file already runs in WebKit, so only the phone's viewport, scale,
// touch and mobile layout are taken from the device.
const { defaultBrowserType: _, ...iPhone } = devices["iPhone 16 Pro Max"];
test.describe("on an iPhone", () => {
  test.use(iPhone);
  for (const [study, setup] of [
    ["2d", async () => {}],
    [
      "3d",
      async (page: Page) =>
        page.getByRole("checkbox", { name: "Cut with a plane" }).check(),
    ],
    ["4d", async () => {}],
  ] as const)
    test(`every ${study} select keeps the fields' height`, async ({ page }) => {
      await page.goto(`/?study=${study}`);
      await expect(page.locator("select:visible").first()).toBeVisible();
      await setup(page);
      const selects = await page
        .locator(".app:visible select")
        .evaluateAll((els) =>
          els
            .filter((e) => (e as HTMLElement).offsetParent !== null)
            .map((e) => {
              const s = getComputedStyle(e);
              return {
                name: e.getAttribute("aria-label") ?? e.id ?? "",
                height: Math.round(e.getBoundingClientRect().height),
                padding: s.paddingTop,
              };
            }),
        );
      expect(selects.length).toBeGreaterThan(1);
      for (const s of selects) {
        expect(s.height, s.name).toBeGreaterThanOrEqual(36);
        expect(s.padding, s.name).toBe("7px");
      }
    });
});
