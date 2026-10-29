import { test, expect, type Page } from "@playwright/test";
import { openExportSettings, choosePreset } from "./helpers";
import { decodeVideo, probe, frameDifference } from "./video";
import { exportImage } from "./helpers";
import { decodePng } from "./png";
import { readFile } from "node:fs/promises";
import { presets } from "../web/presets";
import { watchEngines, engines } from "./engines";
import { exportTiming } from "../web/export-quality";

// Safari and every iOS browser return PNG when asked for a WebP canvas image.
const withoutWebP = () => {
  const toDataURL = HTMLCanvasElement.prototype.toDataURL;
  const toBlob = HTMLCanvasElement.prototype.toBlob;
  const png = (type?: string) => (type === "image/webp" ? "image/png" : type);
  HTMLCanvasElement.prototype.toDataURL = function (type, quality) {
    return toDataURL.call(this, png(type), quality);
  };
  HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
    toBlob.call(this, callback, png(type), quality);
  };
};
const withoutVideo = () => {
  delete (window as any).VideoEncoder;
};

// The export button is disabled while the preset computes and until format
// detection finishes; a browser that can export nothing never enables it.
async function ready(page: Page, preset = "1", exports = true) {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await openExportSettings(page);
  await choosePreset(page, preset);
  if (exports)
    await expect(
      page.getByRole("button", { name: /^Export (animated WebP|MP4 video)/ }),
    ).toBeEnabled();
}
const format = (page: Page) =>
  page.getByRole("combobox", { name: "Export format" });
const loop = (page: Page) =>
  page.getByRole("checkbox", { name: "Loop exported animation" });
const exportWebP = (page: Page) =>
  page.getByRole("button", { name: "Export animated WebP" });
const exportMP4 = (page: Page) =>
  page.getByRole("button", { name: "Export MP4 video" });

// Pole studies animate the pole's x coordinate from their preset.
// Construction studies animate their own first track from a preset.
const studies: Record<string, string> = {
  pedal: "8",
  orthotomic: "10",
  offset: "11",
  "offset stack": "12",
  roulette: "14",
  rolling: "15",
  "rolling curve": "16",
  chords: "18",
  circles: "22",
  inversion: "24",
  lissajous: "27",
  fourier: "28",
  pursuit: "30",
  field: "33",
  implicit: "34",
  attractor: "36",
  combination: "41",
};
for (const study of [
  "hold",
  "current",
  "follow",
  "fit",
  "pedal",
  "orthotomic",
  "offset",
  "offset stack",
  "roulette",
  "rolling",
  "rolling curve",
  "chords",
  "circles",
  "inversion",
  "lissajous",
  "fourier",
  "pursuit",
  "field",
  "implicit",
  "attractor",
  "combination",
]) {
  const studyPreset = studies[study];
  const camera = studyPreset ? "hold" : study;
  test(`saved ${study} MP4 decodes with exact timing, endpoints, and theme`, async ({
    page,
  }) => {
    const parameterMode = camera === "follow" || !!studyPreset;
    const dark = camera === "fit";
    await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
    await ready(page, studyPreset ?? (parameterMode ? "2" : "1"));
    const original = await page.locator("#artwork").innerHTML();
    if (parameterMode) {
      await page
        .getByRole("combobox", { name: "Animate", exact: true })
        .selectOption("parameters");
      await page.getByRole("textbox", { name: "Track 1 to" }).fill(".75");
    }
    await page
      .getByRole("combobox", { name: "Animation camera" })
      .selectOption(camera);
    await page
      .getByRole("spinbutton", { name: "Duration (seconds)" })
      .fill(".4");
    await page
      .getByRole("combobox", { name: "Export frame rate" })
      .selectOption("15");
    await format(page).selectOption("mp4");
    const download = page.waitForEvent("download");
    await exportMP4(page).click();
    const saved = await download;
    expect(saved.suggestedFilename()).toMatch(/^tangent-garden-.*\.mp4$/);
    const path = (await saved.path())!;
    const bytes = await (await import("node:fs/promises")).readFile(path);
    expect(bytes.toString("ascii", 4, 8)).toBe("ftyp");

    const probed = probe(path);
    if (probed) {
      expect(probed.codec).toBe("h264");
      expect(probed.profile).toBe("Constrained Baseline");
      expect(probed.bFrames).toBe(0);
      expect([probed.width, probed.height]).toEqual([2000, 1520]);
      expect(probed.frames).toBe(6);
      // Endpoints on the first and last frames, with exact millisecond delays.
      const durations = exportTiming(0.4, 15).map((f) => f.duration);
      expect(probed.durations).toEqual(durations);
      expect(probed.times).toEqual(
        durations.map((_, i) =>
          durations.slice(0, i).reduce((a, b) => a + b, 0),
        ),
      );
      expect(probed.keyframes[0]).toBe(0);
    }
    const decoded = await decodeVideo(page, bytes);
    expect(decoded.duration).toBeCloseTo(0.4, 3);
    expect([decoded.width, decoded.height]).toEqual([2000, 1520]);
    expect(decoded.first.hash).not.toBe(decoded.last.hash);
    for (const frame of [decoded.first, decoded.last]) {
      expect(frame.background[3]).toBe(255);
      expect(
        Math.abs(frame.background[0] - (dark ? 11 : 243)),
      ).toBeLessThanOrEqual(3);
    }
    await expect(page.getByText(/Saved MP4 video · \d/)).toBeVisible();
    expect(await page.locator("#artwork").innerHTML()).toBe(original);
    await expect(
      page.getByRole("button", { name: "Play animation" }),
    ).toBeEnabled();
  });
}

test("both formats offer a choice that defaults to MP4; only WebP can loop", async ({
  page,
}) => {
  await ready(page);
  await expect(format(page)).toHaveValue("mp4");
  await expect(format(page).locator("option")).toHaveText([
    "MP4 video · small files, plays anywhere",
    "Animated WebP · can loop",
  ]);
  await expect(exportMP4(page)).toBeEnabled();
  await expect(loop(page)).toHaveCount(0);
  await expect(page.getByText(/players decide whether to loop/)).toBeVisible();
  const summary = page.locator("#export-settings > summary");
  await expect(summary).toContainText("MP4 · 30 fps");
  await format(page).selectOption("webp");
  await expect(exportWebP(page)).toBeEnabled();
  await expect(exportMP4(page)).toHaveCount(0);
  await expect(loop(page)).toBeVisible();
  await expect(summary).toContainText("WebP");
  await format(page).selectOption("mp4");
  await expect(loop(page)).toHaveCount(0);
});

test("60 fps is offered for both formats, and WebP names its cost", async ({
  page,
}) => {
  await ready(page);
  const rate = page.getByRole("combobox", { name: "Export frame rate" });
  const summary = page.locator("#export-settings > summary");
  const cost = page
    .locator("#export-settings")
    .getByText("WebP stores every frame whole");
  await expect(rate).toHaveValue("30");
  await expect(rate.locator("option")).toHaveText([
    "60 fps · smoothest motion",
    "30 fps · smoother motion",
    "15 fps · smaller file",
  ]);
  await rate.selectOption("60");
  await expect(summary).toContainText("MP4 · 60 fps");
  await expect(cost).toHaveCount(0);
  // The choice is kept, and its cost is said.
  await format(page).selectOption("webp");
  await expect(rate).toHaveValue("60");
  await expect(rate.locator("option")).toHaveText([
    "60 fps · larger file",
    "30 fps · smoother motion",
    "15 fps · smaller file",
  ]);
  await expect(summary).toContainText("WebP · 60 fps");
  await expect(cost).toBeVisible();
  await rate.selectOption("30");
  await expect(cost).toHaveCount(0);
});

test("a 60 fps WebP has exact frame timing, and Chromium decodes it at that timing", async ({
  page,
}) => {
  await ready(page);
  await format(page).selectOption("webp");
  await page
    .getByRole("combobox", { name: "Export frame rate" })
    .selectOption("60");
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill(".2");
  const download = page.waitForEvent("download");
  await exportWebP(page).click();
  const bytes = await (
    await import("node:fs/promises")
  ).readFile((await (await download).path())!);
  const durations = exportTiming(0.2, 60).map((f) => f.duration);
  // Twelve delays of 16 or 17 ms, a sixtieth of a second each to the
  // millisecond, summing to the duration.
  expect(durations).toHaveLength(12);
  for (const d of durations) expect([16, 17]).toContain(d);
  expect(durations.reduce((a, b) => a + b)).toBe(200);
  // Frame durations as the RIFF container stores them.
  const stored: number[] = [];
  for (let offset = 12; offset < bytes.length;) {
    const length = bytes.readUInt32LE(offset + 4);
    if (bytes.toString("ascii", offset, offset + 4) === "ANMF")
      stored.push(bytes.readUIntLE(offset + 8 + 12, 3));
    offset += 8 + length + (length % 2);
  }
  expect(stored).toEqual(durations);
  // Browsers replace delays of 10 ms or less; these are above it, so the
  // decoder reports them unchanged.
  const decoded = await page.evaluate(async (input) => {
    const decoder = new (window as any).ImageDecoder({
      data: new Uint8Array(input),
      type: "image/webp",
    });
    await decoder.tracks.ready;
    const n = decoder.tracks.selectedTrack.frameCount;
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      out.push(image.duration / 1000);
      image.close();
    }
    return out;
  }, Array.from(bytes));
  expect(decoded).toEqual(durations);
});

test("a 60 fps MP4 has exact frame timing and decodes", async ({ page }) => {
  await ready(page);
  await page
    .getByRole("combobox", { name: "Export frame rate" })
    .selectOption("60");
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill(".2");
  const download = page.waitForEvent("download");
  await exportMP4(page).click();
  const path = (await (await download).path())!;
  const probed = probe(path);
  if (probed) {
    const durations = exportTiming(0.2, 60).map((f) => f.duration);
    expect(probed.frames).toBe(12);
    expect(probed.durations).toEqual(durations);
  }
  const decoded = await decodeVideo(
    page,
    await (await import("node:fs/promises")).readFile(path),
  );
  expect(decoded.duration).toBeCloseTo(0.2, 3);
  expect(decoded.first.hash).not.toBe(decoded.last.hash);
});

test("without canvas WebP, as on iOS, MP4 is the only format and exports", async ({
  page,
}) => {
  await page.addInitScript(withoutWebP);
  await ready(page);
  await expect(exportMP4(page)).toBeEnabled();
  await expect(format(page)).toHaveCount(0);
  await expect(loop(page)).toHaveCount(0);
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill(".1");
  const download = page.waitForEvent("download");
  await exportMP4(page).click();
  expect((await download).suggestedFilename()).toMatch(/\.mp4$/);
  await expect(page.getByText(/Saved MP4 video/)).toBeVisible();
  await expect(page.getByText(/WebP/)).toHaveCount(0);
});

test("without a video encoder, WebP is the only format", async ({ page }) => {
  await page.addInitScript(withoutVideo);
  await ready(page);
  await expect(exportWebP(page)).toBeEnabled();
  await expect(format(page)).toHaveCount(0);
  await expect(loop(page)).toBeVisible();
});

test("with neither format, export is disabled with a plain explanation", async ({
  page,
}) => {
  await page.addInitScript(withoutWebP);
  await page.addInitScript(withoutVideo);
  await ready(page, "1", false);
  const button = page.getByRole("button", { name: /^Export (animated|MP4)/ });
  await expect(button).toBeDisabled();
  await expect(
    page.getByText(
      "This browser can't save animations. You can still save single frames as SVG.",
    ),
  ).toBeVisible();
});

test("an MP4 size the encoder refuses is explained, not silently switched", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const check = VideoEncoder.isConfigSupported.bind(VideoEncoder);
    VideoEncoder.isConfigSupported = async (config) =>
      config.width > 1000 ? { supported: false, config } : check(config);
  });
  await ready(page, "1", false);
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("1");
  await format(page).selectOption("mp4");
  await expect(exportMP4(page)).toBeEnabled();
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("2");
  await expect(format(page)).toHaveValue("mp4");
  await expect(exportMP4(page)).toBeDisabled();
  await expect(
    page.getByText(
      "This browser can't save MP4 video at 2000 × 1520. Choose a lower export resolution or another format.",
    ),
  ).toBeVisible();
  await format(page).selectOption("webp");
  await expect(exportWebP(page)).toBeEnabled();
});

test("MP4 export can be canceled and input edits discard in-flight frames", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ready(page);
  await format(page).selectOption("mp4");
  const downloads: string[] = [];
  page.on("download", (d) => downloads.push(d.suggestedFilename()));
  await exportMP4(page).click();
  await expect(page.getByText("Exporting MP4…")).toBeVisible();
  await page.getByRole("button", { name: "Cancel export" }).click();
  await expect(exportMP4(page)).toBeEnabled();
  await exportMP4(page).click();
  await expect(
    page.getByRole("button", { name: "Cancel export" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "x(t)", exact: true })
    .fill("2*cos(t)");
  await expect(exportMP4(page)).toBeEnabled();
  await page.waitForTimeout(300);
  expect(downloads).toEqual([]);
  expect(errors).toEqual([]);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a failing video encoder reports a plain error and recovers", async ({
  page,
}) => {
  await ready(page);
  await format(page).selectOption("mp4");
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill(".1");
  await page.evaluate(() => {
    VideoEncoder.prototype.encode = function () {
      throw new DOMException("Encoder is broken", "EncodingError");
    };
  });
  await exportMP4(page).click();
  await expect(page.getByRole("alert")).toContainText(
    "This browser couldn't save the MP4 video",
  );
  await expect(exportMP4(page)).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Play animation" }),
  ).toBeEnabled();
});

test("each format starts at its own quality default and keeps edits when switching", async ({
  page,
}) => {
  await ready(page);
  const quality = page.getByRole("slider", {
    name: "Export quality",
    exact: true,
  });
  const reset = page.getByRole("button", { name: /^Reset export settings/ });
  const summary = page.locator("#export-settings > summary");
  await expect(quality).toHaveValue("60");
  await expect(summary).toContainText("quality 60");
  await expect(reset).toHaveText(
    "Reset export settings to 2000 × 1520 · quality 60",
  );
  await expect(reset).toBeDisabled();
  await format(page).selectOption("webp");
  await expect(quality).toHaveValue("85");
  await expect(reset).toHaveText(
    "Reset export settings to 2000 × 1520 · quality 85",
  );
  await expect(reset).toBeDisabled();
  await format(page).selectOption("mp4");
  await quality.fill("70");
  await format(page).selectOption("webp");
  await expect(quality).toHaveValue("85");
  await quality.fill("90");
  await format(page).selectOption("mp4");
  await expect(quality).toHaveValue("70");
  await expect(reset).toBeEnabled();
  await reset.click();
  await expect(quality).toHaveValue("60");
  await format(page).selectOption("webp");
  await expect(quality).toHaveValue("90");
  await reset.click();
  await expect(quality).toHaveValue("85");
});

test("encoders that round frame timestamps, as WebKit does, still export exact timing", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Frame = window.VideoFrame;
    window.VideoFrame = function (source: any, init?: any) {
      const shifted = init?.timestamp
        ? { ...init, timestamp: init.timestamp - 1 }
        : init;
      return new Frame(source, shifted);
    } as any;
    window.VideoFrame.prototype = Frame.prototype;
  });
  await ready(page);
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill(".4");
  await page
    .getByRole("combobox", { name: "Export frame rate" })
    .selectOption("15");
  const download = page.waitForEvent("download");
  await exportMP4(page).click();
  const probed = probe((await (await download).path())!);
  if (probed) {
    const durations = exportTiming(0.4, 15).map((f) => f.duration);
    expect(probed.durations).toEqual(durations);
    expect(probed.frames).toBe(6);
  }
});

test("a dropped encoder frame is still refused", async ({ page }) => {
  await page.addInitScript(() => {
    const encode = VideoEncoder.prototype.encode;
    let calls = 0;
    VideoEncoder.prototype.encode = function (frame, options) {
      if (++calls !== 3) encode.call(this, frame, options);
    };
  });
  await ready(page);
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill(".4");
  await exportMP4(page).click();
  await expect(page.getByRole("alert")).toContainText(
    "This browser couldn't save the MP4 video (the encoder dropped or reordered frames).",
  );
  await expect(exportMP4(page)).toBeEnabled();
});

for (const caption of [false, true])
  test(`phrase MP4 and SVG preserve reveal, exact endpoints and a decoded stationary hold${caption ? " with caption" : ""}`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    const index = presets.findIndex(
      (p) => p.title === "A circle's caustic, opened",
    );
    await ready(page, String(index));
    if (caption)
      await page
        .getByRole("checkbox", { name: "Stage label in drawing", exact: true })
        .check();
    await page
      .getByRole("combobox", { name: "Export format", exact: true })
      .selectOption("mp4");
    await page
      .getByRole("combobox", { name: "Export frame rate", exact: true })
      .selectOption("15");
    const durations = [0.1, 0.2, 0.2, 0.3, 0.3, 0.6, 0.3];
    for (const [i, duration] of durations.entries())
      await page
        .getByRole("spinbutton", {
          name: `Phase ${i + 1} duration`,
          exact: true,
        })
        .fill(String(duration));
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const slider = page.getByRole("slider", {
      name: "Animation progress",
      exact: true,
    });
    const stills = [];
    for (const time of ["0", "0.7", "1"]) {
      await slider.fill(time);
      await expect(page.locator("#artwork")).toHaveAttribute(
        "data-animation-time",
        time,
      );
      const metadata = JSON.parse(
        (await page.locator("#artwork desc").textContent())!,
      );
      expect(metadata.source.position.x).toBe(
        time === "0" ? 1 : time === "0.7" ? 0.65 : 0.95,
      );
      if (time === "0.7") {
        expect(metadata.animation.phrase.phase).toBe("Hold the cusps");
        const saved = page.waitForEvent("download");
        await exportImage(page, "SVG");
        const svg = await readFile((await (await saved).path())!, "utf8");
        expect(svg).toContain('"phase":"Hold the cusps"');
        expect(svg).toContain('"construction":1');
        if (caption) {
          expect(svg).toMatch(/<text[\s>]/);
          expect(svg).toContain('data-phrase-caption="true"');
          expect(svg).toContain('"inDrawing":true');
          expect(svg).toContain("Hold the cusps");
          expect(svg).toContain("Source x = 0.650000");
        } else expect(svg).not.toMatch(/<text[\s>]/);
      }
      const saved = page.waitForEvent("download");
      await exportImage(page, "PNG");
      stills.push(decodePng(await readFile((await (await saved).path())!)));
    }
    await page
      .getByRole("button", { name: "Back to study", exact: true })
      .click();
    const download = page.waitForEvent("download");
    await exportMP4(page).click();
    const file = await download;
    const path = (await file.path())!;
    const data = probe(path);
    if (data) {
      expect(data.frames).toBe(30);
      expect(data.durations.reduce((a, b) => a + b, 0)).toBe(2000);
      expect(data.times[0]).toBe(0);
      const match = (i: number, reference: (typeof stills)[number]) =>
        frameDifference(path, 2000, 1520, i, reference.rgba)!;
      for (const [i, reference] of [
        [0, stills[0]],
        [20, stills[1]],
        [23, stills[1]],
        [29, stills[2]],
      ] as const) {
        const difference = match(i, reference);
        expect(difference.meanDifference).toBeLessThan(3);
        expect(difference.unmatchedInk).toBeLessThan(0.05);
      }
      // A wrong held frame must fail even though both stills show a caustic.
      expect(match(20, stills[2]).unmatchedInk).toBeGreaterThan(0.3);
    }
    const video = await decodeVideo(page, await readFile(path));
    expect(video.duration).toBeCloseTo(2, 3);
    expect(video.first.hash).not.toBe(video.last.hash); // reveal has changed layers
  });

test("editing an exporting phrase cancels pending geometry and suppresses its download", async ({
  page,
}) => {
  await watchEngines(page, 8, { compute: 100 });
  await ready(
    page,
    String(presets.findIndex((p) => p.title === "A circle's caustic, opened")),
  );
  let downloads = 0;
  page.on("download", () => downloads++);
  for (let i = 1; i <= 7; i++)
    await page
      .getByRole("spinbutton", { name: `Phase ${i} duration`, exact: true })
      .fill("10");
  await page
    .getByRole("combobox", { name: "Export format", exact: true })
    .selectOption("mp4");
  await page
    .getByRole("combobox", { name: "Export frame rate", exact: true })
    .selectOption("15");
  await exportMP4(page).click();
  await expect(
    page.getByRole("button", { name: "Cancel export", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Phase 4 key", exact: true })
    .fill("0.9");
  await expect(
    page.getByRole("button", { name: "Play animation", exact: true }),
  ).toBeEnabled();
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-progress",
  );
  await page.waitForTimeout(400); // longer than the deliberately delayed obsolete calculation
  expect(downloads).toBe(0);
  const workers = await engines(page);
  expect(workers.filter((e) => !e.terminated)).toHaveLength(1);
  await expect(
    page.getByRole("textbox", { name: "Phase 4 key", exact: true }),
  ).toHaveValue("0.9");
});

test("changing phrase caption placement during export discards its old presentation", async ({
  page,
}) => {
  await watchEngines(page, 8, { compute: 100 });
  await ready(
    page,
    String(presets.findIndex((p) => p.title === "A circle's caustic, opened")),
  );
  let downloads = 0;
  page.on("download", () => downloads++);
  for (let i = 1; i <= 7; i++)
    await page
      .getByRole("spinbutton", { name: `Phase ${i} duration`, exact: true })
      .fill("10");
  await page
    .getByRole("combobox", { name: "Export format", exact: true })
    .selectOption("mp4");
  await page
    .getByRole("combobox", { name: "Export frame rate", exact: true })
    .selectOption("15");
  await exportMP4(page).click();
  await expect(
    page.getByRole("button", { name: "Cancel export", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: "Stage label in drawing", exact: true })
    .check();
  await expect(
    page.getByRole("button", { name: "Play animation", exact: true }),
  ).toBeEnabled();
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-progress",
  );
  await page.waitForTimeout(400);
  expect(downloads).toBe(0);
  expect((await engines(page)).filter((e) => !e.terminated)).toHaveLength(1);
});
