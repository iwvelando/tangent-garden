import { test, expect, type Page } from "@playwright/test";
import { deflateRawSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { choosePreset, open as openDetails } from "./helpers";
import { decodeVideo, frameDifference, probe } from "./video";
import { observeSpatial } from "./spatial-family-helpers";
import { restore } from "../web/lifted";
import { spatialPresets } from "../web/spatial/presets";
import { presetStudy } from "../web/spatial/link";
import { probeSupport } from "../web/spatial/probe";
import type { SurfaceResult } from "../web/spatial/types";

// The helicoid–catenoid family's offset, cuspidal edges, focal sheets and
// ridges, through the real controls, worker and engine: focal sheets only on
// request, ridges with them, the offset and its edges as on other surfaces,
// transitions between kinds, links made before them, and both presets'
// own animations with their constructions on.
const stage = (page: Page) => page.locator(".spatial-stage");
const canvas = (page: Page) => page.locator("#spatial-artwork");
const check = (page: Page, name: string) =>
  page.getByRole("checkbox", { name, exact: true });
const focal = (page: Page) => check(page, "Focal sheets");
const ridges = (page: Page) => check(page, "Locate ridges");
const edges = (page: Page) => check(page, "Locate cuspidal edges");
const note = (page: Page) => page.getByTestId("surface-note");
const legend = (page: Page) => page.locator(".legend");
const settled = (page: Page) =>
  expect(stage(page)).toHaveAttribute("aria-busy", "false");
const staircase = { label: "A staircase becoming a throat" };
const unwinding = { label: "A double helix of centers unwinding" };
const folding = { label: "A stair's offset folding along two helices" };
async function ready(page: Page) {
  await observeSpatial(page);
  await page.goto("/?study=3d");
  await expect(canvas(page)).toBeVisible();
  await settled(page);
}
async function config(page: Page) {
  return JSON.parse((await stage(page).getAttribute("data-config"))!);
}
// The latest study a worker answered whose surface meets want (any, by
// default), and its surface result. A frame the scrubber asks for comes
// from its own worker, and one that Pause overtook can be answered after
// it, so a test names the frame it reads.
type Want = (surface: Record<string, any>) => boolean;
async function answered(page: Page, want: string) {
  return page.evaluate((want) => {
    const test = new Function("s", `return ${want}`);
    const logs = (window as any).spatialWorkers as any[];
    const found = logs
      .flatMap((w) =>
        w.replies.map((r: any) => {
          const q = w.requests.find((q: any) => q.id === r.id);
          return { q, r, at: q.observedAt + r.observedElapsed };
        }),
      )
      .filter(({ q }) => test(q.spatial.surface))
      .sort((a, b) => a.at - b.at)
      .at(-1);
    return found
      ? {
          request: found.q.spatial,
          result: found.r.result,
          lifted: {
            places: found.r.lifted.places,
            floats: Array.from(found.r.lifted.floats as Float64Array),
          },
        }
      : null;
  }, want);
}
async function drawn(page: Page, want: Want = () => true) {
  let reply: Awaited<ReturnType<typeof answered>> = null;
  await expect
    .poll(async () => (reply = await answered(page, `(${want})(s)`)) !== null)
    .toBe(true);
  await settled(page);
  const result = restore(reply!.result, {
    ...reply!.lifted,
    floats: new Float64Array(reply!.lifted.floats),
  }) as any;
  return {
    request: reply!.request,
    surface: result.surface as SurfaceResult,
  };
}
async function openStudy(page: Page, study: unknown) {
  await page.goto("about:blank");
  await page.goto(
    `/?study=3d#s=${deflateRawSync(
      Buffer.from(JSON.stringify({ v: 1, notebook: "3d", study })),
    ).toString("base64url")}`,
  );
  await expect(canvas(page)).toBeVisible();
  await settled(page);
}
async function openAnimation(page: Page) {
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
}
async function seek(page: Page, t: string) {
  await page.getByRole("slider", { name: "Animation progress" }).fill(t);
  await expect(stage(page)).toHaveAttribute("data-time", t);
  await settled(page);
}

test("the family's focal sheets come on request, ridges with them, and its offset folds", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, staircase);
  await settled(page);
  // As before: no focal sheet computed, drawn, described or probed.
  let d = await drawn(page, (s) => s.focal === undefined);
  expect(d.request.surface.focal).toBeUndefined();
  expect(d.surface.focal).toEqual([]);
  await expect(focal(page)).not.toBeChecked();
  await expect(ridges(page)).toHaveCount(0);
  await expect(legend(page)).not.toContainText("Focal sheet");
  expect(probeSupport(await config(page)).targets).toEqual(["surface"]);
  await expect(page.getByRole("textbox", { name: "Offset d" })).toHaveValue(
    "0",
  );
  await expect(edges(page)).toHaveCount(0);

  await focal(page).check();
  await settled(page);
  d = await drawn(page, (s) => s.focal === true);
  expect(d.request.surface.focal).toBe(true);
  expect(d.surface.focal.map((f) => f.shape)).toEqual(["surface", "surface"]);
  await expect(legend(page)).toContainText("Focal sheet 1");
  await expect(legend(page)).toContainText("Focal sheet 2");
  await expect(note(page)).toContainText("Focal sheet 2 (κ₂) is a surface.");
  expect(probeSupport(await config(page)).targets).toEqual([
    "surface",
    "focal1",
    "focal2",
  ]);
  await ridges(page).check();
  await settled(page);
  await expect(note(page)).toContainText("The patch has 2 ridges");
  d = await drawn(page, (s) => s.ridges === true);
  expect(d.surface.ridges!.map((r) => r.branch)).toEqual([1, 2]);

  // Off again: the ridges go with them, and nothing of them is computed.
  await focal(page).uncheck();
  await settled(page);
  const off = (await config(page)).surface;
  expect("focal" in off).toBe(false);
  expect("ridges" in off).toBe(false);
  await expect(ridges(page)).toHaveCount(0);
  d = await drawn(page, (s) => s.focal === undefined && s.ridges === undefined);
  expect(d.surface.focal).toEqual([]);
  expect(d.surface.ridges).toBeUndefined();

  // The offset at d = 2 folds along v = ±acosh √2.
  const offset = page.getByRole("textbox", { name: "Offset d" });
  await offset.fill("2");
  await offset.press("Enter");
  await settled(page);
  await edges(page).check();
  await settled(page);
  await expect(note(page)).toContainText(
    "The offset folds along 2 cuspidal edges (2 on focal sheet 1)",
  );
  d = await drawn(page, (s) => s.offset === 2 && s.edges === true);
  const q = d.request.surface;
  for (const e of d.surface.edges!)
    for (const j of e.j)
      expect(
        Math.abs(
          Math.abs(q.vMin + (j * (q.vMax - q.vMin)) / q.vSamples) -
            Math.acosh(Math.SQRT2),
        ),
      ).toBeLessThan(1e-9);
  expect(probeSupport(await config(page)).targets).toEqual([
    "surface",
    "offset",
  ]);
});

test("choosing a kind from or to the family keeps what each offers", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, staircase);
  await settled(page);
  await focal(page).check();
  await settled(page);
  await ridges(page).check();
  await settled(page);
  const offset = page.getByRole("textbox", { name: "Offset d" });
  await offset.fill("1.5");
  await offset.press("Enter");
  await settled(page);
  await edges(page).check();
  await settled(page);
  const kind = page.getByLabel("Surface", { exact: true });
  // Every other kind has its focal sheets: the request goes, the ridges
  // and the offset stay.
  await kind.selectOption("torus");
  await settled(page);
  let s = (await config(page)).surface;
  expect("focal" in s).toBe(false);
  expect(s).toMatchObject({ ridges: true, offset: 1.5, edges: true });
  await expect(focal(page)).toHaveCount(0);
  expect(
    (await drawn(page, (s) => s.kind === "torus")).surface.focal,
  ).toHaveLength(2);
  // Back on the family its sheets start off, so its ridges go.
  await kind.selectOption("helicoid-catenoid");
  await settled(page);
  s = (await config(page)).surface;
  expect("focal" in s).toBe(false);
  expect("ridges" in s).toBe(false);
  expect(s).toMatchObject({ offset: 1.5, edges: true });
  await expect(focal(page)).not.toBeChecked();
  expect(
    (await drawn(page, (s) => s.kind === "helicoid-catenoid")).surface.focal,
  ).toEqual([]);
});

test("a family link made before its focal sheets draws as it did", async ({
  page,
}) => {
  await ready(page);
  const index = spatialPresets.findIndex((p) => p.name === staircase.label);
  const study = presetStudy(index);
  await openStudy(page, study);
  const d = await drawn(page, (s) => s.kind === "helicoid-catenoid");
  expect("focal" in d.request.surface).toBe(false);
  expect(d.surface.focal).toEqual([]);
  // A link asking for ridges without focal sheets opens without them.
  const asked = structuredClone(study) as any;
  asked.config.surface.ridges = true;
  await openStudy(page, asked);
  expect("ridges" in (await config(page)).surface).toBe(false);
  expect(
    (await drawn(page, (s) => s.kind === "helicoid-catenoid")).surface.ridges,
  ).toBeUndefined();
});

test("the double helix of centers unwinds with the family, one sheet falling into the axis", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, unwinding);
  await settled(page);
  await expect(focal(page)).toBeChecked();
  await expect(ridges(page)).toBeChecked();
  // The ridges' centers are the helices of radius 1 ± sin θ.
  const radii = (s: SurfaceResult) =>
    s.ridges!.map(
      (r) =>
        r.points.map((p) => Math.hypot(p.x, p.y)).reduce((a, b) => a + b, 0) /
        r.points.length,
    );
  let d = await drawn(page, (s) => s.b === 0 && s.focal === true);
  expect(d.surface.focal.map((f) => f.shape)).toEqual(["surface", "surface"]);
  for (const r of radii(d.surface)) expect(r).toBeCloseTo(1, 9);
  await openAnimation(page);
  await page.getByRole("button", { name: "Play animation" }).click();
  await page.getByRole("button", { name: "Pause" }).click();
  // Back and forth reaches the catenoid at the middle.
  await seek(page, "0.5");
  d = await drawn(page, (s) => s.b === Math.PI / 2);
  expect(d.request.surface.focal).toBe(true);
  expect(d.surface.focal.map((f) => f.shape)).toEqual(["surface", "curve"]);
  expect(d.surface.ridges!.map((r) => r.branch)).toEqual([1]);
  expect(radii(d.surface)[0]).toBeCloseTo(2, 9);
  await seek(page, "0.25");
  d = await drawn(page, (s) => s.b > 0.1 && s.b < Math.PI / 2 - 0.1);
  const theta = d.request.surface.b;
  expect(radii(d.surface).sort()).toEqual([
    expect.closeTo(1 - Math.sin(theta), 9),
    expect.closeTo(1 + Math.sin(theta), 9),
  ]);
});

test("the offset stair's edges close in on its waist and vanish", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, folding);
  await settled(page);
  await expect(edges(page)).toBeChecked();
  await expect(focal(page)).not.toBeChecked();
  let d = await drawn(page, (s) => s.offset === 2.5);
  expect(d.surface.focal).toEqual([]);
  expect(d.surface.edges).toHaveLength(2);
  await openAnimation(page);
  await page.getByRole("button", { name: "Play animation" }).click();
  await page.getByRole("button", { name: "Pause" }).click();
  // d runs from 2.5 to 0.6: within 1 there is no fold.
  await seek(page, "0.5");
  d = await drawn(page, (s) => s.offset === 0.6);
  expect(d.surface.edges).toEqual([]);
  expect(d.surface.folded).toBe(0);
  await seek(page, "0.2");
  d = await drawn(page, (s) => s.offset > 1.1 && s.offset < 2.4);
  const offset = d.request.surface.offset;
  const q = d.request.surface;
  expect(d.surface.edges).toHaveLength(2);
  for (const e of d.surface.edges!)
    for (const j of e.j)
      expect(
        Math.abs(
          Math.abs(q.vMin + (j * (q.vMax - q.vMin)) / q.vSamples) -
            Math.acosh(Math.sqrt(offset)),
        ),
      ).toBeLessThan(1e-9);
});

// A still PNG's pixels, as RGBA.
async function still(page: Page) {
  await page.getByRole("button", { name: "Export image", exact: true }).click();
  const event = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /^PNG image/ }).click();
  const png = await readFile((await (await event).path())!);
  const rgba = await page.evaluate(async (input) => {
    const image = new Image();
    image.src = `data:image/png;base64,${input}`;
    await image.decode();
    const c = document.createElement("canvas");
    c.width = image.width;
    c.height = image.height;
    const g = c.getContext("2d")!;
    g.drawImage(image, 0, 0);
    const data = g.getImageData(0, 0, c.width, c.height).data;
    let text = "";
    for (let i = 0; i < data.length; i += 0x8000)
      text += String.fromCharCode(...data.subarray(i, i + 0x8000));
    return btoa(text);
  }, png.toString("base64"));
  return Buffer.from(rgba, "base64");
}

// The unfolding's movie decodes with its duration and frame count. Going
// out and back, it loops, so its eight frames stand at eighths of the
// timeline, and they are the stills a direct seek draws: the helicoid at
// the start, the stair half bent a quarter in, the catenoid at the middle,
// and the way back at three quarters matching the way out at one.
test("the double helix's movie agrees with stills at direct seeks", async ({
  page,
}) => {
  test.slow();
  await ready(page);
  await choosePreset(page, unwinding);
  await settled(page);
  await openAnimation(page);
  await page.getByRole("button", { name: "Play animation" }).click();
  await page.getByRole("button", { name: "Pause" }).click();
  const stills: Record<string, Buffer> = {};
  for (const p of ["0", "0.25", "0.5"]) {
    await seek(page, p);
    stills[p] = await still(page);
  }
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await settled(page);
  await page.getByLabel("Duration (seconds)").fill("0.5");
  await openDetails(page, "#spatial-export-settings");
  await page.getByLabel("Export format", { exact: true }).selectOption("mp4");
  await page.getByLabel("Export frame rate").selectOption("15");
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("2");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export MP4/ }).click();
  const path = (await (await download).path())!;
  const data = probe(path);
  if (data) {
    expect(data.frames).toBe(8);
    expect([data.width, data.height]).toEqual([2000, 1520]);
  }
  const video = await decodeVideo(page, await readFile(path));
  expect(video.duration).toBeCloseTo(0.5, 3);
  const frames: [number, string][] = [
    [0, "0"],
    [2, "0.25"],
    [4, "0.5"],
    [6, "0.25"],
  ];
  const keys = Object.keys(stills);
  const table = frames.map(([index, own]) => ({
    own,
    to: Object.fromEntries(
      keys.map((k) => [k, frameDifference(path, 2000, 1520, index, stills[k])]),
    ),
  }));
  if (table.every((row) => keys.every((k) => row.to[k]))) {
    console.log("Double helix movie frames", JSON.stringify(table));
    for (const { own, to } of table) {
      expect(to[own]!.meanDifference).toBeLessThan(4);
      expect(to[own]!.unmatchedInk).toBeLessThan(0.02);
      for (const k of keys)
        if (k !== own)
          expect(to[own]!.meanDifference, `${own} against ${k}`).toBeLessThan(
            to[k]!.meanDifference,
          );
    }
  } else throw new Error("ffmpeg is needed to compare the movie's frames");
});
