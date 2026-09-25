import { test, expect, type Page } from "@playwright/test";
import { openExportSettings } from "./helpers";
import { decodeVideo, probe } from "./video";
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
  await page
    .getByRole("combobox", { name: "Start with a notebook example" })
    .selectOption(preset);
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

for (const camera of ["hold", "current", "follow", "fit"]) {
  test(`saved ${camera} MP4 decodes with exact timing, endpoints, and theme`, async ({
    page,
  }) => {
    const parameterMode = camera === "follow";
    const dark = camera === "fit";
    await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
    await ready(page, parameterMode ? "2" : "1");
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
        Math.abs(frame.background[0] - (dark ? 20 : 255)),
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

test("60 fps is offered for MP4 only and returns when switching back", async ({
  page,
}) => {
  await ready(page);
  const rate = page.getByRole("combobox", { name: "Export frame rate" });
  const summary = page.locator("#export-settings > summary");
  await expect(rate).toHaveValue("30");
  await expect(rate.locator("option")).toHaveText([
    "60 fps · smoothest motion",
    "30 fps · smoother motion",
    "15 fps · smaller file",
  ]);
  await rate.selectOption("60");
  await expect(summary).toContainText("MP4 · 60 fps");
  await format(page).selectOption("webp");
  await expect(rate).toHaveValue("30");
  await expect(rate.locator("option")).toHaveText([
    "30 fps · smoother motion",
    "15 fps · smaller file",
  ]);
  await expect(summary).toContainText("WebP · 30 fps");
  await format(page).selectOption("mp4");
  await expect(rate).toHaveValue("60");
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

test("animated WebP refuses 60 fps even if asked directly", async () => {
  const { exportAnimation } = await import("../web/export-animation");
  await expect(
    exportAnimation({ format: "webp", fps: 60 } as any),
  ).rejects.toThrow("Animated WebP supports 15 or 30 fps.");
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
