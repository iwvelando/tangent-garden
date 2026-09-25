import { test, expect } from "@playwright/test";
import { openAnimation, openExportSettings } from "./helpers";
import { readFile } from "node:fs/promises";
import { fitFrame, framingPoints } from "../web/Plot";
import { presets } from "../web/presets";
import { reveal } from "../web/animation";
import type { Result } from "../web/types";
import { exportEncoding } from "../web/export-quality";
import { videoBitrate } from "../web/mp4-video";
import { decodeVideo, probe } from "./video";

test("offset involute fits both curves throughout reveal, with fixed follow zoom", () => {
  const config = structuredClone(presets[1].config);
  config.offset = 5;
  const result: Result = {
    base: [],
    derived: [],
    virtual: [],
    rays: [],
    warnings: [],
    invalid: 0,
  };
  for (let i = 0; i <= 1000; i++) {
    const t = (i * 2 * Math.PI) / 1000;
    result.base.push({ x: Math.cos(t), y: Math.sin(t) });
    result.derived.push({
      x: Math.cos(t) + (t + 5) * Math.sin(t),
      y: Math.sin(t) - (t + 5) * Math.cos(t),
    });
    result.virtual.push(false);
  }
  const final = fitFrame(result, config);
  for (const progress of [0, 0.001, 0.01, 0.1, 0.33, 0.5, 0.85, 0.95, 1]) {
    const current = reveal(result, progress);
    const frame = fitFrame(current, config);
    for (const scale of [frame.scale, final.scale]) {
      for (const p of [...current.base, ...current.derived]) {
        expect(Math.abs(p!.x - frame.cx) * scale).toBeLessThan(500);
        expect(Math.abs(p!.y - frame.cy) * scale).toBeLessThan(380);
      }
    }
  }
});

test("robust framing rejects isolated asymptotic tails but keeps a distant coherent curve", () => {
  const base = Array.from({ length: 101 }, (_, i) => ({ x: i / 100, y: 0 }));
  const derived = base.map((p) => ({ x: p.x + 100, y: 50 + p.x }));
  derived.push({ x: 1e8, y: -1e8 });
  expect(framingPoints(derived)).toHaveLength(101);
  const frame = fitFrame(
    { base, derived, virtual: [], rays: [], warnings: [], invalid: 0 },
    presets[0].config,
  );
  expect(frame.cx).toBe(50.5);
  expect(frame.span).toBe(101);
});

test("help, branding, and completed animation settings are usable without stopping", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Tangent Garden/);
  await expect(page.locator(".brand-symbol")).toHaveAttribute(
    "src",
    /tangent-garden\.svg$/,
  );
  await page.getByRole("button", { name: "About control modes" }).click();
  await expect(page.getByText(/Expert mode takes exact/)).toBeVisible();
  await page.getByRole("button", { name: "About shape parameter a" }).click();
  await expect(
    page.getByRole("spinbutton", { name: "Shape parameter a" }),
  ).toHaveAccessibleDescription(/Expressions without a are unaffected/);
  await page.getByText("Expression reference", { exact: true }).click();
  await expect(
    page.locator("details var").filter({ hasText: "a" }).first(),
  ).toBeVisible();
  await openAnimation(page);
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill(".1");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect(
    page.getByRole("button", { name: "Reset view", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Animation camera" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("spinbutton", { name: "Duration (seconds)" }),
  ).toBeEnabled();
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill(".2");
  await expect(
    page.getByRole("button", { name: "Play animation" }),
  ).toBeEnabled();
  await page
    .getByRole("combobox", { name: "Animation camera" })
    .selectOption("fit");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  expect(
    JSON.parse((await page.locator("#artwork desc").textContent())!).animation
      .camera,
  ).toBe("fit");
});

for (const [scale, quality, width, height] of [
  [0.5, 70, 500, 380],
  [1.5, 95, 1500, 1140],
  [2, 100, 2000, 1520],
]) {
  test(`animation export at ${width} × ${height} and quality ${quality} decodes correctly`, async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("#artwork")).toBeVisible();
    await openExportSettings(page);
    await page
      .getByRole("combobox", { name: "Export format" })
      .selectOption("webp");
    const resolution = page.getByRole("slider", {
      name: "Export resolution",
      exact: true,
    });
    const compression = page.getByRole("slider", {
      name: "Export quality",
      exact: true,
    });
    await expect(resolution).toHaveValue("1");
    await expect(compression).toHaveValue("85");
    await resolution.fill(String(scale));
    await expect(compression).toHaveValue("85");
    await compression.fill(String(quality));
    await expect(resolution).toHaveValue(String(scale));
    await expect(resolution).toHaveAttribute(
      "aria-valuetext",
      `${width} by ${height} pixels`,
    );
    await page.evaluate(() => {
      (window as any).encodedFrames = [];
      const encode = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
        (window as any).encodedFrames.push([this.width, this.height, quality]);
        encode.call(this, callback, type, quality);
      };
    });
    await page
      .getByRole("spinbutton", { name: "Duration (seconds)" })
      .fill(".1");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export animated WebP" }).click();
    const saved = await download;
    expect(saved.suggestedFilename()).toMatch(/^tangent-garden-/);
    const bytes = await readFile((await saved.path())!);
    const decoded = await page.evaluate(async (data) => {
      const decoder = new (window as any).ImageDecoder({
        data: new Uint8Array(data),
        type: "image/webp",
      });
      await decoder.tracks.ready;
      const count = decoder.tracks.selectedTrack.frameCount;
      const durations: number[] = [];
      const dimensions: number[][] = [];
      for (let i = 0; i < count; i++) {
        const { image } = await decoder.decode({ frameIndex: i });
        dimensions.push([image.displayWidth, image.displayHeight]);
        durations.push(image.duration);
        image.close();
      }
      decoder.close();
      return { count, dimensions, durations };
    }, Array.from(bytes));
    expect(decoded.count).toBe(3);
    expect(decoded.dimensions).toEqual(Array(3).fill([width, height]));
    expect(decoded.durations.reduce((sum, duration) => sum + duration, 0)).toBe(
      100000,
    );
    expect(await page.evaluate(() => (window as any).encodedFrames)).toEqual(
      Array(3).fill([width, height, quality / 100]),
    );
    await page.getByRole("button", { name: "Reset export settings" }).click();
    await expect(resolution).toHaveValue("1");
    await expect(compression).toHaveValue("85");
  });
}

for (const [scale, quality, width, height, codec] of [
  [0.5, 70, 500, 380, "avc1.42E01F"],
  [2, 100, 2000, 1520, "avc1.42E032"],
] as const) {
  test(`MP4 export at ${width} × ${height} and quality ${quality} uses a fitting level and bitrate`, async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("#artwork")).toBeVisible();
    await openExportSettings(page);
    await page
      .getByRole("combobox", { name: "Export format" })
      .selectOption("mp4");
    await page
      .getByRole("slider", { name: "Export resolution", exact: true })
      .fill(String(scale));
    await page
      .getByRole("slider", { name: "Export quality", exact: true })
      .fill(String(quality));
    await page.evaluate(() => {
      (window as any).configs = [];
      const configure = VideoEncoder.prototype.configure;
      VideoEncoder.prototype.configure = function (config) {
        (window as any).configs.push(config);
        configure.call(this, config);
      };
    });
    await page
      .getByRole("spinbutton", { name: "Duration (seconds)" })
      .fill(".1");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export MP4 video" }).click();
    const path = (await (await download).path())!;
    const [config] = await page.evaluate(() => (window as any).configs);
    expect(config).toMatchObject({ codec, width, height, framerate: 30 });
    expect(config.bitrate).toBe(
      videoBitrate(exportEncoding({ scale, quality }), 30),
    );
    const probed = probe(path);
    if (probed) {
      expect([probed.width, probed.height]).toEqual([width, height]);
      expect(probed.frames).toBe(3);
    }
    const decoded = await decodeVideo(page, await readFile(path));
    expect([decoded.width, decoded.height]).toEqual([width, height]);
    expect(decoded.duration).toBeCloseTo(0.1, 3);
  });
}
