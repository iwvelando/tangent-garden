import {
  applyTracks,
  availableTargets,
  reveal,
  targetLabel,
} from "../web/spatial/animation";
import { nextHarmonicTerm } from "../web/spatial/harmonic";
import { spatialPresets } from "../web/spatial/presets";
import type { SpatialResult } from "../web/spatial/types";
import { test, expect, type Page } from "@playwright/test";
import { choosePreset } from "./helpers";
import { readFile } from "node:fs/promises";
import { probe, decodeVideo } from "./video";
const stage = (page: Page) => page.locator(".spatial-stage");
const field = (page: Page, name: string) =>
  page.getByRole("textbox", { name, exact: true });
async function ready(page: Page) {
  await page.goto("/?study=3d");
  await expect(page.locator("#spatial-artwork")).toBeVisible();
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
}
async function settled(page: Page) {
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
}
// The stage has no configuration until Go's first result arrives.
async function config(page: Page) {
  const text = await stage(page).getAttribute("data-config");
  return text ? JSON.parse(text) : undefined;
}
const pixels = (page: Page) =>
  page
    .locator("#spatial-artwork")
    .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
async function openAnimation(page: Page) {
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
}
const trefoil = "12",
  tilted = "13",
  open = "14";
const note = (page: Page) => page.getByTestId("closure-note");

test("a harmonic curve has its own layers, closure note and validated terms", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, trefoil);
  await settled(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "A ribbon of tangent lines",
  );
  await expect(note(page)).toContainText("drawn closed");
  const original = await pixels(page);
  for (const layer of ["Vector sums", "Generating ellipses"]) {
    const box = page.getByRole("checkbox", { name: layer, exact: true });
    await box.uncheck();
    expect(await pixels(page)).not.toBe(original);
    await box.check();
    expect(await pixels(page)).toBe(original);
  }
  for (const [name, text, message] of [
    ["Frequency ω₂", "1001", "term 2: the frequency"],
    ["A₁ x", "100001", "term 1: A coordinates"],
    ["B₃ y", "-100001", "term 3: B coordinates"],
    ["c₀ z", "200000", "center c₀"],
    ["to", "0", "domain"],
  ] as const) {
    const before = await field(page, name).inputValue();
    await field(page, name).fill(text);
    await expect(page.getByRole("alert")).toContainText(message);
    await field(page, name).fill(before);
    await settled(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  // Nothing turns once every frequency is zero.
  for (const k of ["₁", "₂", "₃"])
    await field(page, `Frequency ω${k}`).fill("0");
  await expect(page.getByRole("alert")).toContainText("nothing turns");
});

test("the domain decides closure, and one full period can be traced", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, trefoil);
  await settled(page);
  await field(page, "to").fill("pi");
  await settled(page);
  await expect(note(page)).toContainText("drawn as an open arc");
  await expect(note(page)).toContainText("repeats after t spans 2π");
  await field(page, "t from").fill("1");
  await settled(page);
  await page
    .getByRole("button", { name: "Trace one full period (2π)", exact: true })
    .click();
  await expect
    .poll(async () => (await config(page))?.harmonic?.max)
    .toBe(1 + 2 * Math.PI);
  await settled(page);
  await expect(note(page)).toContainText(
    "spans one period, so it is drawn closed",
  );
  await expect(
    page.getByRole("button", { name: /Trace one full period/ }),
  ).toHaveCount(0);
  await choosePreset(page, open);
  await settled(page);
  await expect(note(page)).toContainText("never repeats exactly");
  await expect(
    page.getByRole("button", { name: /Trace one full period/ }),
  ).toHaveCount(0);
});

test("adding and removing terms renumbers fields after pending evaluations land", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, trefoil);
  await settled(page);
  const add = page.getByRole("button", { name: "Add a term", exact: true });
  await add.click();
  await expect(field(page, "Frequency ω₄")).toHaveValue("-4");
  await expect
    .poll(async () => (await config(page))?.harmonic?.terms?.length)
    .toBe(4);
  // A value still being evaluated moves with its term when an earlier term
  // is removed.
  await field(page, "A₃ x").fill("pi/4");
  await page
    .getByRole("button", { name: "Remove term 1", exact: true })
    .click();
  await expect
    .poll(async () => (await config(page))?.harmonic?.terms?.length)
    .toBe(3);
  await settled(page);
  const terms = (await config(page)).harmonic.terms;
  expect(terms.map((t: { frequency: number }) => t.frequency)).toEqual([
    -2, 3, -4,
  ]);
  expect(terms[1].cosine.x).toBe(Math.PI / 4);
  await expect(field(page, "Frequency ω₁")).toHaveValue("-2");
  await expect(field(page, "Frequency ω₄")).toHaveCount(0);
  for (let k = 3; k < 8; k++) await add.click();
  await expect(
    page.getByRole("button", { name: "At most 8 terms", exact: true }),
  ).toBeDisabled();
  await expect
    .poll(async () => (await config(page))?.harmonic?.terms?.length)
    .toBe(8);
  await settled(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("switching the definition keeps the harmonic study and its layers", async ({
  page,
}) => {
  await ready(page);
  const definition = page.getByLabel("Spatial definition", { exact: true });
  await expect(
    page.getByRole("checkbox", { name: "Vector sums", exact: true }),
  ).toHaveCount(0);
  await definition.selectOption("harmonic");
  await settled(page);
  expect((await config(page)).format).toBe("harmonic");
  expect((await config(page)).harmonic).toEqual(
    spatialPresets[0].config.harmonic,
  );
  await expect(
    page.getByRole("checkbox", { name: "Vector sums", exact: true }),
  ).toHaveCount(1);
  // Under any construction.
  await page
    .getByLabel("Construction", { exact: true })
    .selectOption("inversion");
  await settled(page);
  await expect(
    page.getByRole("checkbox", { name: "Generating ellipses", exact: true }),
  ).toHaveCount(1);
  await definition.selectOption("torus");
  await settled(page);
  await expect(
    page.getByRole("checkbox", { name: "Vector sums", exact: true }),
  ).toHaveCount(0);
  expect((await config(page)).format).toBe("torus");
});

test("harmonic reveal, pause/resume and edits preserve the original study", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, tilted);
  await settled(page);
  const original = await config(page),
    full = await pixels(page);
  await openAnimation(page);
  await page.getByLabel("Duration (seconds)").fill("5");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Animation progress" });
  await slider.fill("0.5");
  await expect(stage(page)).toHaveAttribute("data-progress", "0.5");
  const halfway = await pixels(page);
  expect(halfway).not.toBe(full);
  await slider.fill("1");
  await expect(stage(page)).toHaveAttribute("data-progress", "1");
  expect(await pixels(page)).toBe(full);
  await slider.fill("0.5");
  expect(await pixels(page)).toBe(halfway);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect
    .poll(async () => +(await stage(page).getAttribute("data-progress"))!)
    .toBeGreaterThan(0.5);
  await field(page, "B₂ z").fill("1/e");
  await expect(stage(page)).not.toHaveAttribute("data-progress");
  await expect
    .poll(async () => (await config(page))?.harmonic?.terms?.[1]?.sine?.z)
    .toBe(1 / Math.E);
  expect((await config(page)).harmonic.terms[0]).toEqual(
    original.harmonic.terms[0],
  );
  // A replacement preset invalidates pending scalar work.
  await field(page, "c₀ x").fill("pi");
  await choosePreset(page, trefoil);
  await settled(page);
  expect((await config(page)).harmonic).toEqual(
    spatialPresets[+trefoil].config.harmonic,
  );
});

for (const camera of ["hold", "current", "follow", "fit"])
  test(`harmonic playback reaches exact endpoints with the ${camera} camera`, async ({
    page,
  }) => {
    await ready(page);
    await choosePreset(page, trefoil);
    await settled(page);
    const base = await config(page);
    await openAnimation(page);
    await page
      .getByLabel("Animate", { exact: true })
      .selectOption("parameters");
    // The larger, faster circle keeps the curve moving throughout.
    await page
      .getByLabel("Parameter 1", { exact: true })
      .selectOption("harmonic1Ax");
    await page.getByLabel("Track 1 from").fill("1/phi");
    await page.getByLabel("Track 1 to").fill("e");
    await page
      .getByLabel("Animation camera", { exact: true })
      .selectOption(camera);
    await page.getByLabel("Duration (seconds)").fill("5");
    await page.locator("#spatial-artwork").focus();
    await page.keyboard.press("+");
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const slider = page.getByRole("slider", { name: "Animation progress" });
    const framing = async () =>
      JSON.parse((await stage(page).getAttribute("data-camera"))!);
    await slider.fill("0");
    await expect(stage(page)).toHaveAttribute("data-progress", "0");
    expect((await config(page)).harmonic.terms[0].cosine.x).toBe(
      1 / ((1 + Math.sqrt(5)) / 2),
    );
    const first = await framing();
    await slider.fill("1");
    await expect(stage(page)).toHaveAttribute("data-progress", "1");
    expect((await config(page)).harmonic.terms[0].cosine.x).toBe(Math.E);
    const last = await framing();
    if (camera === "hold" || camera === "current") expect(last).toEqual(first);
    if (camera === "follow") expect(last.radius).toBe(first.radius);
    if (camera === "fit") expect(last.radius).not.toBe(first.radius);
    expect(first.zoom).toBe(camera === "current" ? 1.1 : 1);
    await slider.fill("0.5");
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(stage(page)).not.toHaveAttribute("data-progress");
    expect(await config(page)).toEqual(base);
  });

test("a harmonic MP4 decodes with exact duration and a moving center", async ({
  page,
}) => {
  test.slow();
  await ready(page);
  await choosePreset(page, trefoil);
  await settled(page);
  await openAnimation(page);
  await page.getByLabel("Animate", { exact: true }).selectOption("parameters");
  await page.getByLabel("Parameter 1", { exact: true }).selectOption("c0z");
  await page.getByLabel("Track 1 from").fill("0");
  await page.getByLabel("Track 1 to").fill("2");
  await page
    .getByLabel("Animation camera", { exact: true })
    .selectOption("hold");
  await page.getByLabel("Duration (seconds)").fill("0.4");
  await page.locator("#spatial-export-settings > summary").click();
  await page.getByLabel("Export format", { exact: true }).selectOption("mp4");
  await page.getByLabel("Export frame rate").selectOption("15");
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("1");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export MP4/ }).click();
  const file = await download,
    path = (await file.path())!;
  const data = probe(path);
  if (data) {
    expect(data.frames).toBe(6);
    expect(data.durations.reduce((a, b) => a + b, 0)).toBe(400);
  }
  const video = await decodeVideo(page, await readFile(path));
  expect(video.duration).toBeCloseTo(0.4, 3);
  expect(video.first.hash).not.toBe(video.last.hash);
});

test("harmonic reveal keeps positions up to the tip and frames the vectors", () => {
  const origin = { x: 0, y: 0, z: 0 },
    far = { x: 50, y: 0, z: 0 };
  const input: SpatialResult = {
    base: [origin, origin, origin, origin],
    minus: [],
    plus: [],
    mesh: [],
    rulings: [],
    breaks: [false, false, false, false],
    bounds: { center: origin, radius: 50 },
    radius: 50,
    invalid: 0,
    omitted: 0,
    harmonic: {
      center: origin,
      terms: [
        {
          frequency: 1,
          cosine: { x: 50, y: 0, z: 0 },
          sine: { x: 0, y: 50, z: 0 },
        },
        {
          frequency: -1,
          cosine: { x: -50, y: 0, z: 0 },
          sine: { x: 0, y: 50, z: 0 },
        },
      ],
      period: 2 * Math.PI,
      whole: true,
      closed: false,
      positions: [0, 2, 3].map((sampleIndex) => ({
        sampleIndex,
        joints: [origin, far],
        point: origin,
      })),
    },
  };
  const prefix = reveal(input, 2 / 3);
  expect(prefix.harmonic?.positions.map((s) => s.sampleIndex)).toEqual([0, 2]);
  expect(prefix.harmonic?.terms).toEqual(input.harmonic!.terms);
  // The curve itself is a point; the vectors and ellipses reach 100 away.
  expect(prefix.bounds.radius).toBeGreaterThan(49);
  expect(input.harmonic?.positions).toHaveLength(3);
  const empty = reveal({ ...input, harmonic: undefined }, 1);
  expect(empty.harmonic).toBeUndefined();
  expect(empty.bounds.radius).toBeLessThan(1);
});

test("harmonic tracks target terms by number and leave the base study intact", () => {
  const base = structuredClone(spatialPresets[+trefoil].config);
  const targets = availableTargets(base);
  expect(targets.slice(0, 4)).toEqual(["length", "c0x", "c0y", "c0z"]);
  expect(targets).toContain("harmonic3Bz");
  expect(targets).not.toContain("harmonic4Frequency");
  expect(targets).not.toContain("a");
  expect(targets.slice(-4)).toEqual(["min", "max", "samples", "lines"]);
  expect(targetLabel(base, "harmonic2Frequency")).toBe("Frequency ω₂");
  expect(targetLabel(base, "harmonic3Ay")).toBe("A₃ y");
  expect(targetLabel(base, "c0z")).toBe("c₀ z");
  const tracks = [
    { target: "c0y", from: -Math.PI, to: Math.E },
    { target: "harmonic2Frequency", from: -2, to: -3 },
    { target: "harmonic3Bz", from: 0, to: 0.5 },
    { target: "harmonic9Ax", from: 0, to: 1 },
    { target: "max", from: Math.PI, to: 2 * Math.PI },
  ] as const;
  const start = applyTracks(base, [...tracks], -0.01).config;
  expect(start.harmonic.center.y).toBe(-Math.PI);
  expect(start.harmonic.terms[1].frequency).toBe(-2);
  expect(start.harmonic.max).toBe(Math.PI);
  expect(start.curve.max).toBe(base.curve.max);
  const end = applyTracks(base, [...tracks], 1).config;
  expect(end.harmonic.terms[2].sine.z).toBe(0.5);
  expect(end.harmonic.terms[1].frequency).toBe(-3);
  expect(end.harmonic.terms).toHaveLength(3);
  expect(end.harmonic.max).toBe(2 * Math.PI);
  expect(base.harmonic).toEqual(spatialPresets[+trefoil].config.harmonic);
  // Parametric domain tracks still move the expression domain.
  const helix = structuredClone(spatialPresets[3].config);
  expect(
    applyTracks(helix, [{ target: "max", from: 1, to: 2 }], 1).config.curve.max,
  ).toBe(2);
});

test("the next term turns the other way, faster, with halved vectors", () => {
  const terms = spatialPresets[+trefoil].config.harmonic.terms;
  expect(nextHarmonicTerm(terms)).toEqual({
    frequency: -4,
    cosine: { x: 0, y: 0, z: 0.5 },
    sine: { x: 0, y: 0, z: 0 },
  });
  expect(nextHarmonicTerm([])).toEqual({
    frequency: 1,
    cosine: { x: 0.5, y: 0, z: 0 },
    sine: { x: 0, y: 0.5, z: 0 },
  });
});
