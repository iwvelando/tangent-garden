import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import { choosePreset, openShapeAnimation, openShapeExport } from "./helpers";
import { tesseractPresets } from "../web/tesseract/presets";
import { initialView } from "../web/tesseract/types";
import { motions } from "../web/tesseract/types";

// Seamless loops, back and forth, and easing in the 4D notebook, through
// the real notebook, worker, engine and exporter. Whole turns and slice
// passages, which end where they start, can loop; Play checks the drawing
// at both ends.
const stage = (page: Page) => page.locator(".tesseract-stage");
const settled = (page: Page) =>
  expect(stage(page)).toHaveAttribute("aria-busy", "false");
const motion = (page: Page) => page.getByLabel("Animate", { exact: true });
const repeat = (page: Page) => page.getByLabel("Repeat", { exact: true });
const pace = (page: Page) => page.getByLabel("Pace", { exact: true });
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const error = (page: Page) =>
  page.locator("#shape-animation-section .animation-error");
const status = (page: Page) =>
  page.locator("#shape-playback .timeline [role=status]");
const progress = async (page: Page) =>
  Number(await stage(page).getAttribute("data-progress"));
async function seek(page: Page, time: string) {
  await page.getByRole("slider", { name: "Animation progress" }).fill(time);
  await expect(stage(page)).toHaveAttribute("data-time", time);
  await settled(page);
}
const preset = (m: string) => tesseractPresets.findIndex((p) => p.motion === m);
const study = (i: number, extra: object = {}) => ({
  config: tesseractPresets[i].config,
  layers: { edges: true, guides: true, faces: true, selectedSection: 0 },
  view: initialView,
  diagramView: initialView,
  motion: tesseractPresets[i].motion,
  duration: 1,
  ...extra,
});
async function open(page: Page, value: unknown) {
  await page.goto(
    `/?study=4d#s=${deflateRawSync(
      Buffer.from(JSON.stringify({ v: 1, notebook: "4d", study: value })),
    ).toString("base64url")}`,
  );
  await settled(page);
  await expect(page.locator("#tesseract-artwork")).toBeVisible();
  await openShapeAnimation(page);
}

test("the repeat and pace default to once and steady; loop is offered only for motion that returns to its start", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  await settled(page);
  await openShapeAnimation(page);
  await expect(repeat(page)).toHaveValue("once");
  await expect(pace(page)).toHaveValue("steady");
  const options = () =>
    repeat(page)
      .locator("option")
      .evaluateAll((o) => o.map((e) => (e as HTMLOptionElement).value));
  expect(await options()).toEqual(["once", "loop", "back-and-forth"]);
  await repeat(page).selectOption("loop");
  await page.getByRole("button", { name: "About repeat" }).click();
  await expect(page.locator("#shape-animation-section")).toContainText(
    "the last frame must match the first",
  );
  // A lift's drift and a route start and end in different places.
  for (const m of ["drift", "route"]) {
    await open(page, study(preset(m)));
    expect(await options()).toEqual(["once", "back-and-forth"]);
  }
  // Leaving a loop for a motion that cannot loop keeps it repeating.
  const weave = tesseractPresets.findIndex((p) =>
    motions(p.config).some((c) => c.value === "latitude"),
  );
  await open(page, study(weave, { repeat: "loop" }));
  await expect(repeat(page)).toHaveValue("loop");
  await motion(page).selectOption("latitude");
  await expect(repeat(page)).toHaveValue("back-and-forth");
});

test("a whole turn loops without end, wrapping its time, until paused or stopped", async ({
  page,
}) => {
  await open(page, study(0, { repeat: "loop" }));
  await button(page, "Play animation").click();
  const times: number[] = [];
  const start = Date.now();
  while (Date.now() - start < 2500) {
    const t = await stage(page).getAttribute("data-time");
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
  await expect(button(page, "Resume")).toBeVisible();
});

test("every preset's whole turn passes the closure check, and a slice passage only when it starts and ends empty", async ({
  page,
}) => {
  // Every passage, a family's included, reaches beyond the shape by half
  // its spread, so none is refused.
  const refused = new Set<string>();
  for (const [i, p] of tesseractPresets.entries()) {
    const looping = motions(p.config).filter((c) => c.loops);
    for (const choice of looping) {
      const name = `${p.name} ${choice.value}`;
      await open(page, study(i, { motion: choice.value, repeat: "loop" }));
      await button(page, "Play animation").click();
      if (refused.has(name)) {
        await expect(error(page), name).toContainText(
          "Repeat can loop only motion that ends where it starts, but the drawing at the end has different pieces",
        );
        await expect(button(page, "Play animation")).toBeVisible();
        continue;
      }
      await expect(button(page, "Pause"), name).toBeVisible();
      await expect(error(page)).toHaveCount(0);
      await button(page, "Pause").click();
    }
  }
});

test("back and forth turns at the end halfway, and easing follows a half cosine", async ({
  page,
}) => {
  await open(page, study(0, { repeat: "back-and-forth", duration: 4 }));
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
    // The drawing is the motion's: xw turned by 2π times the progress.
    const drawn = JSON.parse((await stage(page).getAttribute("data-config"))!);
    expect(drawn.angles[3] - tesseractPresets[0].config.angles[3]).toBeCloseTo(
      2 * Math.PI * p,
      9,
    );
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
async function exportWebP(page: Page) {
  await openShapeExport(page);
  const format = page.getByLabel("Export format", { exact: true });
  if (
    !(await format.count()) ||
    !(await format.locator("option[value=webp]").count())
  )
    test.skip(true, "this browser cannot encode WebP");
  await format.selectOption("webp");
  await page.getByLabel("Export frame rate").selectOption("15");
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("0.5");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export animated WebP" }).click();
  return readFile((await (await download).path())!);
}
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
  await open(page, study(0, { repeat: "loop", duration: 0.4 }));
  const bytes = await exportWebP(page);
  await expect(
    page.getByRole("checkbox", { name: "Loop exported animation" }),
  ).toHaveCount(0);
  await expect(page.locator("#shape-export-settings")).toContainText(
    "loops forever",
  );
  const parts = chunks(bytes);
  expect(parts.find((c) => c.name === "ANIM")!.body.readUInt16LE(4)).toBe(0);
  const anmf = parts.filter((c) => c.name === "ANMF");
  expect(anmf).toHaveLength(6);
  expect(anmf.reduce((s, c) => s + c.body.readUIntLE(12, 3), 0)).toBe(400);
  const looped = await decode(page, bytes);
  expect(difference(looped[5], looped[0])).toBeGreaterThan(0.05);
  // A slice passage, out and back: frame i and frame n − i match.
  await open(
    page,
    study(preset("slice"), { repeat: "back-and-forth", duration: 0.4 }),
  );
  const f = await decode(page, await exportWebP(page));
  expect(f).toHaveLength(6);
  // The passage starts and ends empty, and is not empty between.
  expect(difference(f[0], f[3])).toBeLessThan(0.01);
  const apart = difference(f[0], f[2]);
  expect(apart).toBeGreaterThan(0.05);
  for (const i of [1, 2])
    expect(difference(f[i], f[6 - i])).toBeLessThan(0.1 * apart);
});

test("repeat and pace travel in a copied link", async ({ page }) => {
  await page.goto("/?study=4d");
  await settled(page);
  await openShapeAnimation(page);
  await repeat(page).selectOption("loop");
  await pace(page).selectOption("ease");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await button(page, "Copy link").click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const href = await page.evaluate(() => navigator.clipboard.readText());
  const other = await page.context().newPage();
  await other.goto(href);
  await settled(other);
  await openShapeAnimation(other);
  await expect(repeat(other)).toHaveValue("loop");
  await expect(pace(other)).toHaveValue("ease");
});

test("the loop preset brings its repeat and pace and passes the closure check; others play once", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  await settled(page);
  await openShapeAnimation(page);
  const looping = tesseractPresets.filter((p) => p.repeat === "loop");
  expect(looping.length).toBeGreaterThanOrEqual(1);
  for (const p of looping) {
    await choosePreset(page, { label: p.name });
    await settled(page);
    await expect(repeat(page)).toHaveValue("loop");
    await expect(pace(page)).toHaveValue(p.pace ?? "steady");
    await button(page, "Play animation").click();
    await expect(button(page, "Pause"), p.name).toBeVisible();
    await expect(error(page)).toHaveCount(0);
    await button(page, "Pause").click();
    await button(page, "Stop").click();
  }
  await choosePreset(page, { label: tesseractPresets[0].name });
  await settled(page);
  await expect(repeat(page)).toHaveValue("once");
  await expect(pace(page)).toHaveValue("steady");
});
