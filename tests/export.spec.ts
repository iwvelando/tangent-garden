import { test, expect, type Page } from "@playwright/test";
import { openExportSettings } from "./helpers";
import { readFile } from "node:fs/promises";
import { AnimatedWebP } from "../web/animated-webp";
import { exportEncoding, exportTiming } from "../web/export-quality";

test("export settings reject nonfinite and out-of-range values before encoding", () => {
  for (const scale of [NaN, Infinity, 0, 0.49, 2.01])
    expect(() => exportEncoding({ scale, quality: 95 })).toThrow("resolution");
  for (const quality of [NaN, Infinity, 0, 101, 95.5])
    expect(() => exportEncoding({ scale: 1, quality })).toThrow("quality");
});

async function ready(page: Page, preset = "1") {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await openExportSettings(page);
  await page
    .getByRole("combobox", { name: "Export format" })
    .selectOption("webp");
  await page
    .getByRole("combobox", { name: "Start with a notebook example" })
    .selectOption(preset);
  await expect(
    page.getByRole("button", { name: "Export animated WebP" }),
  ).toBeEnabled();
}

test("export timing includes endpoints, preserves milliseconds, and bounds work", async () => {
  for (const duration of [0.1, 0.1234, 1, 30, 240]) {
    for (const fps of [15, 30, 60]) {
      if (duration * fps > 7200) continue; // Checked at the cap below.
      const frames = exportTiming(duration, fps);
      expect(frames[0].progress).toBe(0);
      expect(frames.at(-1)!.progress).toBe(1);
      expect(frames.reduce((sum, f) => sum + f.duration, 0)).toBe(
        Math.round(duration * 1000),
      );
      expect(frames.every((f) => f.duration >= 11)).toBe(true);
    }
  }
  expect(() => exportTiming(NaN, 30)).toThrow("Duration");
  expect(() => exportTiming(241, 30)).toThrow("7,200");
  expect(exportTiming(120, 60)).toHaveLength(7200);
  expect(() => exportTiming(121, 60)).toThrow("lower frame rate");
  expect(() => exportTiming(1, 90)).toThrow("15, 30, or 60");
  const writer = new AnimatedWebP(1000, 760, false);
  await expect(
    writer.add(new Blob([], { type: "image/png" }), 33),
  ).rejects.toThrow("can't save animated WebP files");
  await expect(
    writer.add(new Blob(["RIFF"], { type: "image/webp" }), 33),
  ).rejects.toThrow("invalid WebP");
  expect(() => writer.finish()).toThrow("at least two");
});

for (const camera of ["hold", "current", "follow", "fit"]) {
  test(`saved ${camera} animation decodes with correct timing, appearance, and loop count`, async ({
    page,
  }) => {
    const parameterMode = camera === "follow";
    await page.emulateMedia({
      colorScheme: camera === "fit" ? "dark" : "light",
    });
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
    await page
      .getByRole("checkbox", { name: "Loop exported animation" })
      .setChecked(camera === "fit");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export animated WebP" }).click();
    const saved = await download;
    expect(saved.suggestedFilename()).toMatch(/\.webp$/);
    const bytes = await readFile((await saved.path())!);
    expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
    expect(bytes.readUInt32LE(4)).toBe(bytes.length - 8);
    expect(bytes.toString("ascii", 8, 12)).toBe("WEBP");
    const chunks = [];
    for (let offset = 12; offset < bytes.length;) {
      const length = bytes.readUInt32LE(offset + 4);
      chunks.push({
        name: bytes.toString("ascii", offset, offset + 4),
        body: bytes.subarray(offset + 8, offset + 8 + length),
      });
      offset += 8 + length + (length % 2);
    }
    expect(chunks.filter((c) => c.name !== "ICCP").map((c) => c.name)).toEqual([
      "VP8X",
      "ANIM",
      ...Array(6).fill("ANMF"),
    ]);
    expect(chunks.find((c) => c.name === "ANIM")!.body.readUInt16LE(4)).toBe(
      camera === "fit" ? 0 : 1,
    );
    expect(
      chunks
        .filter((c) => c.name === "ANMF")
        .reduce((sum, c) => sum + c.body.readUIntLE(12, 3), 0),
    ).toBe(400);
    const decoded = await page.evaluate(async (input) => {
      // Exercise Chromium's independent WebP decoder, not our container parser.
      const decoder = new (window as any).ImageDecoder({
        data: new Uint8Array(input),
        type: "image/webp",
      });
      await decoder.tracks.ready;
      const count = decoder.tracks.selectedTrack.frameCount;
      const durations: number[] = [];
      const fingerprints: number[] = [];
      let background: number[] = [];
      const canvas = document.createElement("canvas");
      canvas.width = 1000;
      canvas.height = 760;
      const ctx = canvas.getContext("2d")!;
      for (let i = 0; i < count; i++) {
        const { image } = await decoder.decode({ frameIndex: i });
        if (image.displayWidth !== 1000 || image.displayHeight !== 760)
          throw new Error("Wrong dimensions");
        durations.push(image.duration);
        ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(0, 0, 1000, 760).data;
        background = Array.from(pixels.slice(0, 4));
        let hash = 0;
        for (let j = 0; j < pixels.length; j += 4)
          hash = (Math.imul(hash, 31) + pixels[j]) | 0;
        fingerprints.push(hash);
        image.close();
      }
      decoder.close();
      return { count, durations, fingerprints, background };
    }, Array.from(bytes));
    expect(decoded.count).toBe(6);
    expect(decoded.durations.reduce((a, b) => a + b, 0)).toBe(400000);
    expect(new Set(decoded.fingerprints).size).toBe(6);
    expect(decoded.background[3]).toBe(255);
    expect(decoded.background[0]).toBe(camera === "fit" ? 20 : 255);
    await expect(page.getByText(/Saved animated WebP/)).toBeVisible();
    expect(await page.locator("#artwork").innerHTML()).toBe(original);
    await expect(
      page.getByRole("button", { name: "Play animation" }),
    ).toBeEnabled();
  });
}

test("export can be canceled and input edits discard in-flight frames without downloads", async ({
  page,
}) => {
  await ready(page);
  const downloads: string[] = [];
  page.on("download", (d) => downloads.push(d.suggestedFilename()));
  await page.getByRole("button", { name: "Export animated WebP" }).click();
  await page.getByRole("button", { name: "Cancel export" }).click();
  await expect(
    page.getByRole("button", { name: "Export animated WebP" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Export animated WebP" }).click();
  await expect(
    page.getByRole("button", { name: "Cancel export" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "x(t)", exact: true })
    .fill("2*cos(t)");
  await expect(
    page.getByRole("button", { name: "Export animated WebP" }),
  ).toBeEnabled();
  await page.waitForTimeout(200);
  expect(downloads).toEqual([]);
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-progress",
  );
});

test("unsupported encoders and oversized exports fail visibly and recover", async ({
  page,
}) => {
  await ready(page);
  await page
    .getByRole("spinbutton", { name: "Duration (seconds)" })
    .fill("241");
  await page.getByRole("button", { name: "Export animated WebP" }).click();
  await expect(page.getByRole("alert")).toContainText("7,200");
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill(".1");
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.toBlob = function (callback) {
      callback(new Blob([], { type: "image/png" }));
    };
  });
  await page.getByRole("button", { name: "Export animated WebP" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "This browser can't save animated WebP files.",
  );
  await expect(
    page.getByRole("button", { name: "Play animation" }),
  ).toBeEnabled();
});
