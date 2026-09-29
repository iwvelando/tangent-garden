import {
  applyTracks,
  availableTargets,
  reveal,
  targetLabel,
} from "../web/spatial/animation";
import { spatialPresets } from "../web/spatial/presets";
import { receiverShade } from "../web/spatial/renderer";
import type { SpatialResult, Vec3 } from "../web/spatial/types";
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
const lens = "39",
  dome = "40",
  water = "41",
  floor = "42";
const note = (page: Page) => page.getByTestId("rays-note");
const layer = (page: Page, name: string) =>
  page.getByRole("checkbox", { name, exact: true });

test("an interface study has its own controls, layers and validated fields", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, lens);
  await settled(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "An interface and its caustics",
  );
  await expect(page.getByLabel("Spatial definition")).toHaveValue("rays");
  await expect(page.getByLabel("Interaction", { exact: true })).toHaveValue(
    "refract",
  );
  await expect(page.getByLabel("Incident side", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Mirror side", { exact: true })).toHaveCount(0);
  await expect(field(page, "Index n₁")).toHaveValue("1");
  await expect(field(page, "Index n₂")).toHaveValue("1.5");
  await expect(page.locator(".legend")).toContainText(
    "Interface Transmitted rays Caustic 1 Caustic 2",
  );
  // No receiver: its fields and layer stay hidden.
  await expect(page.getByLabel("Receiver", { exact: true })).toHaveValue(
    "none",
  );
  await expect(field(page, "Plane at c")).toHaveCount(0);
  await expect(layer(page, "Receiver irradiance")).toHaveCount(0);
  const original = await pixels(page);
  for (const name of [
    "Interface",
    "Parameter curves",
    "Incident rays",
    "Transmitted rays",
    "Caustic 2 · μ₂",
  ]) {
    await layer(page, name).uncheck();
    expect(await pixels(page)).not.toBe(original);
    await layer(page, name).check();
    expect(await pixels(page)).toBe(original);
  }
  // Both caustics are the focus, drawn as coincident crosses: the second's
  // hides the first's until it is hidden itself.
  await layer(page, "Caustic 2 · μ₂").uncheck();
  const first = await pixels(page);
  await layer(page, "Caustic 1 · μ₁").uncheck();
  expect(await pixels(page)).not.toBe(first);
  await layer(page, "Caustic 1 · μ₁").check();
  await layer(page, "Caustic 2 · μ₂").check();
  expect(await pixels(page)).toBe(original);
  for (const [name, text, message] of [
    ["Index n₁", "0", "refractive indices"],
    ["Index n₂", "101", "refractive indices"],
    ["Index n₂", "t", "t is not allowed"],
  ] as const) {
    const before = await field(page, name).inputValue();
    await field(page, name).fill(text);
    await expect(page.getByRole("alert")).toContainText(message);
    await field(page, name).fill(before);
    await settled(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  // The same patch as a mirror reads no indices, and keeps them.
  const glass = await config(page);
  await page.getByLabel("Interaction", { exact: true }).selectOption("reflect");
  await settled(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "A mirror and its caustics",
  );
  await expect(field(page, "Index n₁")).toHaveCount(0);
  await expect(page.getByLabel("Mirror side", { exact: true })).toBeVisible();
  await expect(layer(page, "Reflected rays")).toBeVisible();
  await page.getByLabel("Interaction", { exact: true }).selectOption("refract");
  await settled(page);
  expect(await config(page)).toEqual(glass);
});

test("a receiver has its own controls, layer and validation", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, floor);
  await settled(page);
  await expect(page.getByLabel("Receiver", { exact: true })).toHaveValue("z");
  await expect(field(page, "Plane at c")).toHaveValue("-0.5");
  await expect(field(page, "Window size s")).toHaveValue("3.2");
  await expect(field(page, "Centre x")).toHaveValue("0");
  await expect(field(page, "Centre y")).toHaveValue("0");
  await expect(page.getByLabel("Bins", { exact: true })).toHaveValue("160");
  const original = await pixels(page);
  await layer(page, "Receiver irradiance").uncheck();
  expect(await pixels(page)).not.toBe(original);
  await layer(page, "Receiver irradiance").check();
  expect(await pixels(page)).toBe(original);
  for (const [name, text, message] of [
    ["Window size s", "0", "receiver's size"],
    ["Plane at c", "2e5", "receiver's position"],
    ["Centre y", "x", "x is not allowed"],
  ] as const) {
    const before = await field(page, name).inputValue();
    await field(page, name).fill(text);
    await expect(page.getByRole("alert")).toContainText(message);
    await field(page, name).fill(before);
    await settled(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  await page.getByLabel("Bins", { exact: true }).fill("7");
  await expect(page.getByRole("alert")).toContainText("8–240 bins");
  await page.getByLabel("Bins", { exact: true }).fill("24");
  await settled(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  const coarse = await pixels(page);
  expect(coarse).not.toBe(original);
  expect((await config(page)).rays.receiver.bins).toBe(24);
  // The window's centre is named in the plane's own coordinates.
  await page.getByLabel("Receiver", { exact: true }).selectOption("x");
  await settled(page);
  await expect(field(page, "Centre y")).toBeVisible();
  await expect(field(page, "Centre z")).toBeVisible();
  await expect(field(page, "Centre x")).toHaveCount(0);
  await page.getByLabel("Receiver", { exact: true }).selectOption("none");
  await settled(page);
  await expect(field(page, "Plane at c")).toHaveCount(0);
  await expect(layer(page, "Receiver irradiance")).toHaveCount(0);
  await expect(note(page)).not.toContainText("receiver");
});

test("notes report total internal reflection and where the receiver's light went", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, water);
  await settled(page);
  await expect(note(page)).toHaveText(
    "Caustic 1 (μ₁) is virtual, behind the interface: a curve. Caustic 2 (μ₂) is virtual, behind the interface: a surface. 6,516 samples are at or beyond the critical angle, where sin θ₁ ≥ n₂/n₁: nothing is transmitted, and their rays are drawn totally reflected, in grey. 1 sample is stigmatic (μ₁ = μ₂): the outgoing wavefront bends equally every way there, and the two caustics meet.",
  );
  const trapped = await pixels(page);
  // Grey totally reflected rays are drawn with the transmitted ones.
  await layer(page, "Transmitted rays").uncheck();
  expect(await pixels(page)).not.toBe(trapped);
  await layer(page, "Transmitted rays").check();
  // From air into water nothing is trapped, and from behind nothing is lit.
  await field(page, "Index n₁").fill("1");
  await field(page, "Index n₂").fill("1.33");
  await settled(page);
  await expect(note(page)).not.toContainText("critical angle");
  await page
    .getByLabel("Incident side", { exact: true })
    .selectOption("reverse");
  await settled(page);
  await expect(note(page)).toContainText(
    "samples are unlit: the light grazes the interface there or arrives behind its incident side.",
  );

  await choosePreset(page, dome);
  await settled(page);
  await expect(note(page)).toHaveText(
    "Caustic 1 (μ₁) is real, ahead of the interface: a surface. Caustic 2 (μ₂) is real, ahead of the interface: a curve. 121 samples are chart singularities, with no normal and no refraction. The receiver on z = -1.9 collects over 99.9% of the light the surface intercepts (4.82 units of beam area); under 0.1% falls in cells at the edge of the light. Its shade is irradiance on a logarithmic scale over three decades up to its peak, 233 times the beam's own, averaged over each bin, with no Fresnel losses or shadows.",
  );
  await choosePreset(page, floor);
  await settled(page);
  await expect(note(page)).toContainText(
    "The receiver on z = -0.5 collects 87.0% of the light the surface intercepts (2.72 units of beam area); 4.7% lands on the plane outside the window, 8.3% never crosses the plane ahead of its rays and under 0.1% falls in cells at the edge of the light.",
  );
  // A lamp's flux is a solid angle, and a plane behind the rays gets
  // nothing.
  await page.getByLabel("Light", { exact: true }).selectOption("point");
  await field(page, "Source z").fill("0.4");
  await field(page, "Plane at c").fill("2");
  await settled(page);
  await expect(note(page)).toContainText("sr)");
  await field(page, "Plane at c").fill("-3");
  await field(page, "Source z").fill("-2");
  await settled(page);
  await expect(note(page)).toContainText("No light lands in its window.");
});

test("a receiver appears only once its whole ray family is revealed", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, dome);
  await settled(page);
  const full = await pixels(page);
  await layer(page, "Receiver irradiance").uncheck();
  const bare = await pixels(page);
  await layer(page, "Receiver irradiance").check();
  await openAnimation(page);
  await page.getByLabel("Animate", { exact: true }).selectOption("reveal");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Animation progress" });
  await slider.fill("0.99");
  await expect(stage(page)).toHaveAttribute("data-progress", "0.99");
  const nearly = await pixels(page);
  await slider.fill("1");
  await expect(stage(page)).toHaveAttribute("data-progress", "1");
  expect(await pixels(page)).toBe(full);
  // Toggling the layer mid-reveal changes nothing: no receiver is drawn.
  await slider.fill("0.99");
  await expect(stage(page)).toHaveAttribute("data-progress", "0.99");
  await layer(page, "Receiver irradiance").uncheck();
  expect(await pixels(page)).toBe(nearly);
  await slider.fill("1");
  expect(await pixels(page)).toBe(bare);
  await layer(page, "Receiver irradiance").check();
  await slider.fill("0.5");
  await expect(stage(page)).toHaveAttribute("data-progress", "0.5");
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await field(page, "Plane at c").fill("-2.1");
  await expect(stage(page)).not.toHaveAttribute("data-progress");
  await expect
    .poll(async () => (await config(page))?.rays?.receiver.at)
    .toBe(-2.1);
});

for (const camera of ["hold", "current", "follow", "fit"])
  test(`interface playback reaches exact endpoints with the ${camera} camera`, async ({
    page,
  }) => {
    await ready(page);
    await choosePreset(page, lens);
    await settled(page);
    const base = await config(page);
    await openAnimation(page);
    await page
      .getByLabel("Animate", { exact: true })
      .selectOption("parameters");
    await page.getByLabel("Parameter 1", { exact: true }).selectOption("n2");
    await page.getByLabel("Track 1 from").fill("1.5");
    await page.getByLabel("Track 1 to").fill("1+pi/5");
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
    expect((await config(page)).rays.n2).toBe(1.5);
    const first = await framing();
    await slider.fill("1");
    await expect(stage(page)).toHaveAttribute("data-progress", "1");
    expect((await config(page)).rays.n2).toBe(1 + Math.PI / 5);
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

test("a receiver MP4 decodes with exact duration and a moving plane", async ({
  page,
}) => {
  test.slow();
  await ready(page);
  await choosePreset(page, floor);
  await settled(page);
  await openAnimation(page);
  await page.getByLabel("Animate", { exact: true }).selectOption("parameters");
  await page
    .getByLabel("Parameter 1", { exact: true })
    .selectOption("receiverAt");
  await page.getByLabel("Track 1 from").fill("-0.5");
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

test("reveal withholds the receiver until the end, and frames it as Go does", () => {
  const at = (x: number, z = 0): Vec3 => ({ x, y: 0, z });
  const sheet = {
    points: [0, 1, 2].map((i) => [at(i), at(i, 1)]),
    normals: [0, 1, 2].map(() => [null, null]),
    alongU: [
      [true, true],
      [true, true],
    ],
    alongV: [[true], [true], [true]],
    faces: [[true], [true]],
  };
  const receiver = {
    plane: "z" as const,
    corners: [at(-30, -2), at(30, -2), at(30, -2), at(-30, -2)] as [
      Vec3,
      Vec3,
      Vec3,
      Vec3,
    ],
    size: 60,
    irradiance: [
      [0, 1],
      [2, 0],
    ],
    peak: 2,
    emitted: 3,
    received: 3,
    outside: 0,
    away: 0,
    total: 0,
    edge: 0,
  };
  const origin = at(0);
  const input: SpatialResult = {
    base: [],
    minus: [],
    plus: [],
    mesh: [],
    rulings: [],
    breaks: [],
    bounds: { center: origin, radius: 40 },
    radius: 40,
    invalid: 0,
    omitted: 0,
    rays: {
      surface: sheet,
      caustics: [],
      lines: [],
      uCurves: [0, 1],
      vCurves: [0, 2],
      source: null,
      singular: 0,
      unlit: 0,
      atSource: 0,
      stigmatic: 0,
      total: 0,
      clipped: [0, 0],
      receiver,
    },
  };
  expect(reveal(input, 0.9).rays!.receiver).toBeNull();
  expect(reveal(input, 0.9).bounds.radius).toBeLessThan(5);
  const whole = reveal(input, 1);
  expect(whole.rays!.receiver).toBe(receiver);
  // The corners fit on their own, never trimmed as the mirror's outliers.
  expect(whole.bounds.radius).toBeGreaterThan(30);
  // Shades run from a thousandth of the peak to the peak; no light is −1.
  expect(receiverShade(2, 2)).toBe(1);
  expect(receiverShade(0.002, 2)).toBe(0);
  expect(receiverShade(0.0002, 2)).toBe(0);
  expect(receiverShade(Math.sqrt(0.002 * 2), 2)).toBeCloseTo(0.5, 12);
  expect(receiverShade(0, 2)).toBe(-1);
  expect(receiverShade(0, 0)).toBe(-1);
});

test("refraction and receiver tracks move the indices and the plane", () => {
  const glass = structuredClone(spatialPresets[+lens].config);
  expect(availableTargets(glass).slice(0, 8)).toEqual([
    "surfaceA",
    "surfaceB",
    "surfaceC",
    "n1",
    "n2",
    "azimuth",
    "elevation",
    "rayLength",
  ]);
  expect(targetLabel(glass, "n1")).toBe("Index n₁");
  expect(targetLabel(glass, "n2")).toBe("Index n₂");
  const lit = structuredClone(spatialPresets[+floor].config);
  expect(availableTargets(lit)).not.toContain("n1");
  expect(availableTargets(lit).slice(2, 7)).toEqual([
    "azimuth",
    "elevation",
    "rayLength",
    "receiverAt",
    "receiverSize",
  ]);
  expect(targetLabel(lit, "receiverAt")).toBe("Plane at c");
  expect(targetLabel(lit, "receiverSize")).toBe("Window size s");
  const tracks = [
    { target: "n1", from: 1, to: 1.2 },
    { target: "n2", from: 1.5, to: 2 },
    { target: "receiverAt", from: -1, to: 1 },
    { target: "receiverSize", from: 2, to: 4 },
  ] as const;
  const middle = applyTracks(lit, [...tracks], 0.5).config;
  expect(middle.rays.receiver.at).toBe(0);
  const end = applyTracks(lit, [...tracks], 1).config;
  expect(end.rays).toEqual({
    ...lit.rays,
    n1: 1.2,
    n2: 2,
    receiver: { ...lit.rays.receiver, at: 1, size: 4 },
  });
  expect(lit.rays).toEqual(spatialPresets[+floor].config.rays);
});
