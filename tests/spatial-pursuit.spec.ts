import {
  applyTracks,
  availableTargets,
  reveal,
  targetLabel,
} from "../web/spatial/animation";
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
const tetrahedron = "27",
  trefoil = "28",
  crown = "29";
const note = (page: Page) => page.getByTestId("pursuit-note");
const layer = (page: Page, name: string) =>
  page.getByRole("checkbox", { name, exact: true });

test("pursuers stand alone with their own layers and validated fields", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, tetrahedron);
  await settled(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Pursuers closing in space",
  );
  await expect(page.getByLabel("Spatial definition")).toHaveValue("pursuit");
  await expect(page.getByLabel("Construction", { exact: true })).toHaveValue(
    "none",
  );
  await expect(page.locator(".legend")).toContainText("Pursuer 1");
  await expect(page.locator(".legend")).toContainText("Other pursuers");
  const original = await pixels(page);
  for (const name of [
    "Other pursuers",
    "Connecting polygons",
    "Starts & capture",
  ]) {
    await layer(page, name).uncheck();
    expect(await pixels(page)).not.toBe(original);
    await layer(page, name).check();
    expect(await pixels(page)).toBe(original);
  }
  for (const [name, text, message] of [
    ["Capture distance ε", "0", "capture distance"],
    ["Capture distance ε", "2e5", "capture distance"],
    ["Start z₂", "2e5", "pursuer 2: the coordinates"],
    ["Speed v₃", "-1", "pursuer 3: the speed"],
    ["to", "0", "domain"],
    ["Start x₁", "t", "t is not allowed"],
  ] as const) {
    const before = await field(page, name).inputValue();
    await field(page, name).fill(text);
    await expect(page.getByRole("alert")).toContainText(message);
    await field(page, name).fill(before);
    await settled(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  // Pursuers are added up to sixteen and removed down to two.
  const add = page.getByRole("button", { name: "Add a pursuer" });
  for (let n = 4; n < 16; n++) await add.click();
  await expect(
    page.getByRole("button", { name: "At most 16 pursuers" }),
  ).toBeDisabled();
  await settled(page);
  const pursuers = (await config(page)).pursuit.pursuers;
  expect(pursuers).toHaveLength(16);
  // The fifth starts halfway back from the fourth to the first.
  expect(pursuers[4].x).toBeCloseTo(0.5, 12);
  expect(pursuers[4].y).toBeCloseTo(-0.5, 12);
  expect(pursuers[4].z).toBeCloseTo(0, 12);
  await expect(page.getByText("Pursuer 16, chasing 1")).toBeVisible();
  for (let n = 16; n > 2; n--)
    await page.getByRole("button", { name: `Remove pursuer ${n}` }).click();
  await expect(
    page.getByRole("button", { name: "Remove pursuer 1" }),
  ).toBeDisabled();
  await settled(page);
  expect((await config(page)).pursuit.pursuers).toEqual(
    spatialPresets[+tetrahedron].config.pursuit.pursuers.slice(0, 2),
  );
});

test("notes report captures, the carried construction and still pursuers", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, tetrahedron);
  await settled(page);
  await expect(note(page)).toContainText(
    "comes within the capture distance of pursuer",
  );
  await expect(note(page)).toContainText("t = 1.6");
  // The capture can end the interval.
  await page
    .getByRole("button", { name: "End the interval at the capture" })
    .click();
  await settled(page);
  expect((await config(page)).pursuit.max).toBeCloseTo(1.618, 2);
  await field(page, "to").fill("1");
  await settled(page);
  await expect(note(page)).toHaveText(
    "No pursuer comes within the capture distance of its target by the end of the interval.",
  );
  await expect(
    page.getByRole("button", { name: "End the interval at the capture" }),
  ).toHaveCount(0);
  // A pursuer that starts on its target ends the chase at once.
  await field(page, "Start x₂").fill("1");
  await field(page, "Start y₂").fill("0");
  await field(page, "Start z₂").fill("sqrt(2)/2");
  await settled(page);
  await expect(note(page)).toHaveText(
    "Pursuer 1 starts within the capture distance of pursuer 2, so the chase ends at once.",
  );

  await choosePreset(page, crown);
  await settled(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "A ribbon of tangent lines",
  );
  await expect(note(page)).toContainText(
    "The construction is built on pursuer 1’s path.",
  );
  await expect(layer(page, "Connecting polygons")).toBeVisible();
  // A still first pursuer carries nothing…
  await field(page, "Speed v₁").fill("0");
  await expect(page.getByRole("alert")).toContainText(
    "pursuer 1 has no regular sample",
  );
  // …but the chase still stands alone.
  await page.getByLabel("Construction", { exact: true }).selectOption("none");
  await settled(page);
  await expect(page.getByRole("alert")).toHaveCount(0);

  await choosePreset(page, trefoil);
  await settled(page);
  await expect(note(page)).toContainText("Pursuer 9 comes within");
});

test("pursuit reveal, pause, resume and edits invalidate stale playback", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, trefoil);
  await settled(page);
  const original = await config(page);
  const full = await pixels(page);
  await openAnimation(page);
  await page.getByLabel("Animate", { exact: true }).selectOption("reveal");
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
  await field(page, "Start z₁").fill("0.5");
  await expect(stage(page)).not.toHaveAttribute("data-progress");
  await expect
    .poll(async () => (await config(page))?.pursuit?.pursuers[0].z)
    .toBe(0.5);
  expect((await config(page)).pursuit.capture).toBe(original.pursuit.capture);
  // A replacement preset invalidates pending scalar work.
  await field(page, "Capture distance ε").fill("pi/100");
  await choosePreset(page, trefoil);
  await settled(page);
  expect((await config(page)).pursuit).toEqual(
    spatialPresets[+trefoil].config.pursuit,
  );
});

for (const camera of ["hold", "current", "follow", "fit"])
  test(`pursuit playback reaches exact endpoints with the ${camera} camera`, async ({
    page,
  }) => {
    await ready(page);
    await choosePreset(page, tetrahedron);
    await settled(page);
    const base = await config(page);
    await openAnimation(page);
    await page
      .getByLabel("Animate", { exact: true })
      .selectOption("parameters");
    await page
      .getByLabel("Parameter 1", { exact: true })
      .selectOption("pursuer1X");
    await page.getByLabel("Track 1 from").fill("1/2");
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
    expect((await config(page)).pursuit.pursuers[0].x).toBe(1 / 2);
    const first = await framing();
    await slider.fill("1");
    await expect(stage(page)).toHaveAttribute("data-progress", "1");
    expect((await config(page)).pursuit.pursuers[0].x).toBe(Math.E);
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

test("a pursuit MP4 decodes with exact duration and a moving capture", async ({
  page,
}) => {
  test.slow();
  await ready(page);
  await choosePreset(page, crown);
  await settled(page);
  await openAnimation(page);
  await page.getByLabel("Animate", { exact: true }).selectOption("parameters");
  await page.getByLabel("Parameter 1", { exact: true }).selectOption("capture");
  await page.getByLabel("Track 1 from").fill("0.005");
  await page.getByLabel("Track 1 to").fill("0.3");
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

test("pursuit reveal shows every pursuer to the same time", () => {
  const origin = { x: 0, y: 0, z: 0 },
    near = { x: 1, y: 0, z: 0 },
    far = { x: 40, y: 0, z: 0 };
  const input: SpatialResult = {
    base: [near, origin, null, null],
    minus: [],
    plus: [],
    mesh: [],
    rulings: [],
    breaks: [false, false, false, false],
    bounds: { center: origin, radius: 40 },
    radius: 40,
    invalid: 2,
    omitted: 0,
    pursuit: {
      // The chase stops between samples 1 and 2.
      paths: [
        [near, origin, null, null],
        [far, near, null, null],
      ],
      polygons: [0, 1].map((sampleIndex) => ({
        sampleIndex,
        points: [origin, near],
      })),
      capture: { time: 1.5, pursuer: 0, target: 1 },
      exhausted: false,
      end: 1.5,
      final: [origin, origin],
    },
  };
  const early = reveal(input, 0);
  expect(early.pursuit?.paths).toEqual([[near], [far]]);
  expect(early.pursuit?.polygons.map((g) => g.sampleIndex)).toEqual([0]);
  // The capture is not marked until the reveal passes it.
  expect(reveal(input, 1 / 3).pursuit?.final).toEqual([]);
  expect(reveal(input, 2 / 3).pursuit?.final).toEqual([origin, origin]);
  // Every path frames the reveal, as in Go.
  expect(early.bounds.radius).toBeGreaterThan(19);
  expect(input.pursuit?.paths[1]).toHaveLength(4);
});

test("pursuit tracks move starts, speeds, capture and time and leave the base intact", () => {
  const base = structuredClone(spatialPresets[+tetrahedron].config);
  const targets = availableTargets(base);
  expect(targets.slice(0, 5)).toEqual([
    "pursuer1X",
    "pursuer1Y",
    "pursuer1Z",
    "pursuer1Speed",
    "pursuer2X",
  ]);
  expect(targets.slice(-5)).toEqual([
    "capture",
    "min",
    "max",
    "samples",
    "lines",
  ]);
  expect(targets).toHaveLength(16 + 5);
  expect(targetLabel(base, "pursuer2Z")).toBe("Start z₂");
  expect(targetLabel(base, "pursuer4Speed")).toBe("Speed v₄");
  expect(targetLabel(base, "capture")).toBe("Capture distance ε");
  expect(targetLabel(base, "lines")).toBe("Connecting polygons");
  // With a construction, its own targets come first.
  const carried = structuredClone(spatialPresets[+crown].config);
  expect(availableTargets(carried)[0]).toBe("length");
  expect(targetLabel(carried, "lines")).toBe("Tangent lines");
  const tracks = [
    { target: "pursuer2Z", from: 0, to: 1 },
    { target: "pursuer3Speed", from: 1, to: 2 },
    { target: "capture", from: 0.01, to: 0.1 },
    { target: "max", from: 1, to: 3 },
    { target: "pursuer9X", from: 1, to: 3 },
  ] as const;
  const end = applyTracks(base, [...tracks], 1).config;
  const pursuers = structuredClone(base.pursuit.pursuers);
  pursuers[1].z = 1;
  pursuers[2].speed = 2;
  expect(end.pursuit).toEqual({
    ...base.pursuit,
    capture: 0.1,
    max: 3,
    pursuers,
  });
  expect(end.curve).toEqual(base.curve);
  expect(end.field).toEqual(base.field);
  expect(applyTracks(base, [...tracks], -1).config.pursuit.capture).toBe(0.01);
  expect(base.pursuit).toEqual(spatialPresets[+tetrahedron].config.pursuit);
});
