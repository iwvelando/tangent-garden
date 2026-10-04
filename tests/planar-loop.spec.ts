import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import { choosePreset, open as openDetails, openAnimation } from "./helpers";
import { presets } from "../web/presets";

// Seamless loops, back and forth, and easing in the 2D notebook, through
// the real notebook, worker, engine and exporter. A loop plays only when
// its last frame is its first, judged on the drawing at both ends.
const artwork = (page: Page) => page.locator("#artwork");
const settled = (page: Page) =>
  expect(page.locator(".plot-wrap")).toHaveAttribute("aria-busy", "false");
const mode = (page: Page) => page.getByLabel("Animate", { exact: true });
const repeat = (page: Page) => page.getByLabel("Repeat", { exact: true });
const pace = (page: Page) => page.getByLabel("Pace", { exact: true });
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const error = (page: Page) => page.locator(".animation-error");
const status = (page: Page) => page.locator(".timeline [role=status]");
const progress = async (page: Page) =>
  Number(await artwork(page).getAttribute("data-animation-progress"));
async function seek(page: Page, time: string) {
  await page.getByRole("slider", { name: "Animation progress" }).fill(time);
  await expect(artwork(page)).toHaveAttribute("data-animation-time", time);
}
async function open(page: Page, study: unknown) {
  await page.goto(
    `/#s=${deflateRawSync(
      Buffer.from(JSON.stringify({ v: 1, notebook: "2d", study })),
    ).toString("base64url")}`,
  );
  await expect(artwork(page)).toBeVisible();
  await settled(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await openAnimation(page);
}
// An ellipse's evolute with a phase-shifted third harmonic: every a draws
// a different curve, and a + 2π the same one, sample for sample.
const phased = {
  ...structuredClone(presets[0].config),
  samples: 400,
  lines: 24,
  curve: {
    ...structuredClone(presets[0].config.curve),
    x: "2*cos(t)+0.3*cos(3*t+a)",
    y: "3*sin(t)+0.3*sin(3*t+a)",
    a: 0,
  },
};
type Track = { target: string; from: string; to: string };
// An ellipse whose width breathes with a: its evolute keeps its cusps at
// the same samples, so a part period moves the drawing without changing
// its pieces.
const breathing = {
  ...phased,
  curve: { ...phased.curve, x: "(2+0.4*sin(a))*cos(t)", y: "3*sin(t)" },
};
const study = (
  animation: Record<string, unknown>,
  config: object = phased,
) => ({
  config,
  bounds: { min: "0", max: "2*pi" },
  animation: {
    mode: "reveal",
    camera: "hold",
    duration: 1,
    tracks: [] as Track[],
    ...animation,
  },
});
const turn = (to: string, target = "a", from = "0") => ({
  mode: "parameters",
  repeat: "loop",
  tracks: [{ target, from, to }],
});

test("the repeat and pace default to once and steady; loop is offered only for parameter tracks", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  await openAnimation(page);
  await expect(repeat(page)).toHaveValue("once");
  await expect(pace(page)).toHaveValue("steady");
  const options = () =>
    repeat(page)
      .locator("option")
      .evaluateAll((o) => o.map((e) => (e as HTMLOptionElement).value));
  // Drawing along the curve starts empty and ends complete.
  expect(await options()).toEqual(["once", "back-and-forth"]);
  await mode(page).selectOption("parameters");
  expect(await options()).toEqual(["once", "loop", "back-and-forth"]);
  await repeat(page).selectOption("loop");
  // Leaving for a motion that cannot loop keeps it repeating, back and forth.
  await mode(page).selectOption("reveal");
  await expect(repeat(page)).toHaveValue("back-and-forth");
  await mode(page).selectOption("parameters");
  await repeat(page).selectOption("loop");
  await page.getByRole("button", { name: "About repeat" }).click();
  await expect(page.locator("#animation-section")).toContainText(
    "needs the last frame to match the first",
  );
});

test("a parameter loop plays without end when its track runs one period, wrapping its time", async ({
  page,
}) => {
  await open(page, study(turn("2*pi")));
  await expect(repeat(page)).toHaveValue("loop");
  await button(page, "Play animation").click();
  const times: number[] = [];
  const start = Date.now();
  while (Date.now() - start < 2500) {
    const t = await artwork(page).getAttribute("data-animation-time");
    if (t !== null) times.push(Number(t));
    await page.waitForTimeout(40);
  }
  const wraps = times.filter((t, i) => i && t < times[i - 1] - 0.5).length;
  expect(wraps).toBeGreaterThanOrEqual(2);
  expect(Math.max(...times)).toBeLessThan(1);
  await expect(button(page, "Pause")).toBeVisible();
  await expect(error(page)).toHaveCount(0);
  await button(page, "Pause").click();
  await expect(status(page)).toHaveText("Paused");
  // Scrubbed to its end, a loop is at its start again, not complete.
  await seek(page, "1");
  await expect(status(page)).toHaveText("Paused");
  await button(page, "Stop").click();
  await expect(artwork(page)).not.toHaveAttribute("data-animation-time");
});

test("a parameter loop that does not return is refused, naming what differs", async ({
  page,
}) => {
  // A quarter period draws a wider ellipse.
  await open(page, study(turn("pi/2"), breathing));
  await button(page, "Play animation").click();
  await expect(error(page)).toContainText(
    /Repeat can loop only motion that ends where it starts, but the drawing at the end lies up to [0-9.e+]+ pixels from the drawing at the start/,
  );
  await expect(error(page)).toContainText("from 0 to 2*pi");
  await expect(button(page, "Play animation")).toBeVisible();
  // Half a period of the phase moves the cusps to other samples.
  await open(page, study(turn("pi")));
  await button(page, "Play animation").click();
  await expect(error(page)).toContainText("has different pieces");
  // More construction lines are more pieces.
  await open(page, study(turn("30", "lines", "24")));
  await button(page, "Play animation").click();
  await expect(error(page)).toContainText("has different pieces");
  // Back and forth plays it.
  await repeat(page).selectOption("back-and-forth");
  await button(page, "Play animation").click();
  await expect(button(page, "Pause")).toBeVisible();
  await expect(error(page)).toHaveCount(0);
});

test("back and forth turns at the end halfway, and easing follows a half cosine", async ({
  page,
}) => {
  await open(page, study({ repeat: "back-and-forth", duration: 4 }));
  await button(page, "Play animation").click();
  await button(page, "Pause").click();
  for (const [time, p] of [
    ["0.25", 0.5],
    ["0.5", 1],
    ["0.75", 0.5],
    ["1", 0],
  ] as const) {
    await seek(page, time);
    expect(await progress(page)).toBeCloseTo(p, 12);
  }
  await expect(status(page)).toHaveText("Paused");
  await button(page, "Stop").click();
  await repeat(page).selectOption("once");
  await pace(page).selectOption("ease");
  await button(page, "Play animation").click();
  await button(page, "Pause").click();
  for (const t of [0.1, 0.25, 0.5, 0.9]) {
    await seek(page, String(t));
    expect(await progress(page)).toBeCloseTo(
      (1 - Math.cos(Math.PI * t)) / 2,
      12,
    );
  }
  await seek(page, "1");
  expect(await progress(page)).toBe(1);
  await expect(status(page)).toHaveText("Complete");
});

// The chunks of a WebP file, by the RIFF container's own layout.
function chunks(bytes: Buffer) {
  const out: { name: string; body: Buffer }[] = [];
  for (let offset = 12; offset < bytes.length;) {
    const length = bytes.readUInt32LE(offset + 4);
    out.push({
      name: bytes.toString("ascii", offset, offset + 4),
      body: bytes.subarray(offset + 8, offset + 8 + length),
    });
    offset += 8 + length + (length % 2);
  }
  return out;
}
async function exportWebP(page: Page, fps = "15") {
  await openDetails(page, "#export-settings");
  const format = page.getByLabel("Export format", { exact: true });
  if (
    !(await format.count()) ||
    !(await format.locator("option[value=webp]").count())
  )
    test.skip(true, "this browser cannot encode WebP");
  await format.selectOption("webp");
  await page.getByLabel("Export frame rate").selectOption(fps);
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("0.5");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export animated WebP" }).click();
  return readFile((await (await download).path())!);
}
// Every frame, decoded by Chromium, as small RGBA images.
const decode = (page: Page, bytes: Buffer) =>
  page.evaluate(async (input) => {
    const decoder = new (window as any).ImageDecoder({
      data: new Uint8Array(input),
      type: "image/webp",
    });
    await decoder.tracks.ready;
    const n = decoder.tracks.selectedTrack.frameCount;
    const out: number[][] = [];
    for (let i = 0; i < n; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      const c = new OffscreenCanvas(200, 152);
      c.getContext("2d")!.drawImage(image, 0, 0, 200, 152);
      image.close();
      out.push(
        Array.from(c.getContext("2d")!.getImageData(0, 0, 200, 152).data),
      );
    }
    return out;
  }, Array.from(bytes));
const difference = (a: number[], b: number[]) =>
  a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;

test("a repeating WebP loops forever and leaves out the seam's duplicate frame; back and forth retraces itself", async ({
  page,
}) => {
  await open(page, study({ ...turn("2*pi"), duration: 0.4 }));
  await openDetails(page, "#export-settings");
  const bytes = await exportWebP(page);
  await expect(
    page.getByRole("checkbox", { name: "Loop exported animation" }),
  ).toHaveCount(0);
  await expect(page.locator("#export-settings")).toContainText("loops forever");
  const parts = chunks(bytes);
  expect(parts.find((c) => c.name === "ANIM")!.body.readUInt16LE(4)).toBe(0);
  const anmf = parts.filter((c) => c.name === "ANMF");
  expect(anmf).toHaveLength(6);
  expect(anmf.reduce((s, c) => s + c.body.readUIntLE(12, 3), 0)).toBe(400);
  const looped = await decode(page, bytes);
  // The last frame is a step before the first, not the first again.
  expect(difference(looped[5], looped[0])).toBeGreaterThan(0.05);
  // Back and forth: frame i and frame n − i are drawn at the same progress.
  await open(page, study({ repeat: "back-and-forth", duration: 0.4 }));
  const f = await decode(page, await exportWebP(page));
  expect(f).toHaveLength(6);
  const apart = difference(f[0], f[3]);
  for (const i of [1, 2])
    expect(difference(f[i], f[6 - i])).toBeLessThan(0.1 * apart);
});

test("repeat and pace travel in a copied link", async ({ page }) => {
  await open(
    page,
    study({
      mode: "parameters",
      tracks: [{ target: "a", from: "0", to: "2*pi" }],
    }),
  );
  await repeat(page).selectOption("loop");
  await pace(page).selectOption("ease");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await button(page, "Copy link").click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const href = await page.evaluate(() => navigator.clipboard.readText());
  const other = await page.context().newPage();
  await other.goto(href);
  await settled(other);
  await openAnimation(other);
  await expect(mode(other)).toHaveValue("parameters");
  await expect(repeat(other)).toHaveValue("loop");
  await expect(pace(other)).toHaveValue("ease");
});

test("the loop preset brings its tracks, repeat and pace, and passes the closure check; others play once", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  await openAnimation(page);
  const looping = presets.filter((p) => p.animation?.repeat === "loop");
  expect(looping.length).toBeGreaterThanOrEqual(1);
  for (const p of looping) {
    await choosePreset(page, { label: p.title });
    await settled(page);
    await expect(mode(page)).toHaveValue(p.animation!.mode);
    await expect(repeat(page)).toHaveValue("loop");
    await expect(pace(page)).toHaveValue(p.animation!.pace);
    await button(page, "Play animation").click();
    await expect(button(page, "Pause"), p.title).toBeVisible();
    await expect(error(page)).toHaveCount(0);
    await button(page, "Stop").click();
  }
  // A preset without an animation setup keeps the tracks it can, and plays
  // once, steadily.
  await choosePreset(page, "0");
  await settled(page);
  await expect(repeat(page)).toHaveValue("once");
  await expect(pace(page)).toHaveValue("steady");
});
