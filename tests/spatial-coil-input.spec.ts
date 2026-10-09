import {
  applyTracks,
  availableTargets,
  reveal,
  targetLabel,
} from "../web/spatial/animation";
import { buildScene } from "../web/spatial/scene";
import { spatialPresets } from "../web/spatial/presets";
import type { SpatialResult } from "../web/spatial/types";
import { test, expect, type Page } from "@playwright/test";
import { choosePreset } from "./helpers";
import { readFile } from "node:fs/promises";
import { curveMesh } from "./curve-mesh";

const stage = (page: Page) => page.locator(".spatial-stage");
const field = (page: Page, name: string) =>
  page.getByRole("textbox", { name, exact: true });
const builtOn = (page: Page) => page.getByLabel("Built on", { exact: true });
const layer = (page: Page, name: string) =>
  page.getByRole("checkbox", { name, exact: true });
async function ready(page: Page) {
  await page.goto("/?study=3d");
  await expect(page.locator("#spatial-artwork")).toBeVisible();
  await settled(page);
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
const preset = (name: string) =>
  String(spatialPresets.findIndex((p) => p.name === name));
const cord = preset("A coiled cord round a trefoil"),
  rope = preset("Threads twisted round a coiled helix");

test("every construction built on a curve can be built on a coil, with arms and no pole", async ({
  page,
}) => {
  // Five constructions, each with two layers and three fields.
  test.slow();
  await ready(page);
  for (const [construction, heading] of [
    ["developable", "A ribbon of tangent lines"],
    ["involute", "Filaments unwound from a curve"],
    ["framed", "A ribbon carried by a frame"],
    ["ruled", "A surface of straight threads"],
    ["canal", "A surface enveloping spheres"],
  ] as const) {
    await page
      .getByLabel("Construction", { exact: true })
      .selectOption(construction);
    await settled(page);
    await builtOn(page).selectOption("coil");
    await settled(page);
    expect(await config(page)).toMatchObject({
      construction,
      input: "coil",
      coil: { radius: 0.3, angle: 0, turns: 8 },
    });
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    await expect(page.locator(".legend")).toContainText("Coil");
    await expect(page.locator(".composition-note")).toContainText(
      "Built on the coil",
    );
    // The coil uses no pole, and none of the involute's fields.
    await expect(field(page, "Pole z")).toHaveCount(0);
    await expect(field(page, "Input anchor t₀")).toHaveCount(0);
    await expect(layer(page, "Pole marker")).toHaveCount(0);
    await expect(layer(page, "Perpendiculars & tangent feet")).toHaveCount(0);
    // The default tube (R = 0.35) would enclose the arms, 0.3 long.
    if (construction === "canal") {
      await field(page, "Tube radius R").fill("0.1");
      await settled(page);
    }
    const original = await pixels(page);
    for (const name of ["Base curve", "Coil arms"]) {
      const box = layer(page, name);
      await box.uncheck();
      expect(await pixels(page), `${construction}: ${name}`).not.toBe(original);
      await box.check();
      expect(await pixels(page)).toBe(original);
    }
    // Each of the coil's own fields moves it.
    for (const [name, text] of [
      ["Coil radius d", "0.5"],
      ["Coil angle θ₀", "pi/2"],
      ["Coil turns", "3"],
    ] as const) {
      const before = await field(page, name).inputValue();
      await field(page, name).fill(text);
      await settled(page);
      expect(await pixels(page), `${construction}: ${name}`).not.toBe(original);
      await field(page, name).fill(before);
      await settled(page);
    }
    expect(await pixels(page)).toBe(original);
    if (construction === "canal")
      await field(page, "Tube radius R").fill("0.35");
    await builtOn(page).selectOption("base");
    await settled(page);
    await expect(field(page, "Coil turns")).toHaveCount(0);
  }
});

test("the coil's default builds a valid study from every curve definition, edited or not", async ({
  page,
}) => {
  await ready(page);
  const definition = page.getByLabel("Spatial definition", { exact: true });
  for (const format of [
    "torus",
    "parametric",
    "harmonic",
    "field",
    "pursuit",
  ] as const) {
    await definition.selectOption(format);
    await settled(page);
    await page
      .getByLabel("Construction", { exact: true })
      .selectOption("canal");
    await settled(page);
    await builtOn(page).selectOption("coil");
    await settled(page);
    expect((await config(page)).input, format).toBe("coil");
    await expect(page.getByRole("alert"), format).toHaveCount(0);
    await builtOn(page).selectOption("base");
    await settled(page);
  }
  // From edited, non-default values: a short, small curve keeps them, and
  // the coil winding round it is still regular.
  await definition.selectOption("parametric");
  await settled(page);
  await field(page, "t from").fill("0");
  await field(page, "to").fill("1/4");
  await settled(page);
  await builtOn(page).selectOption("coil");
  await field(page, "Coil radius d").fill("2*e");
  await field(page, "Coil turns").fill("-5/2");
  await settled(page);
  expect((await config(page)).coil).toEqual({
    radius: 2 * Math.E,
    angle: 0,
    turns: -2.5,
  });
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("the coil input's fields are validated by name and recover", async ({
  page,
}) => {
  await ready(page);
  await builtOn(page).selectOption("coil");
  await settled(page);
  const drawn = await pixels(page);
  for (const [name, text, message] of [
    ["Coil radius d", "-1", "coil's radius"],
    ["Coil angle θ₀", "1001", "coil's angle"],
    ["Coil turns", "101", "coil's turns"],
  ] as const) {
    const before = await field(page, name).inputValue();
    await field(page, name).fill(text);
    await expect(page.getByRole("alert")).toContainText(message);
    await field(page, name).fill(before);
    await settled(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  expect(await pixels(page)).toBe(drawn);
});

test("the coil presets build on a coil, close where they should, and leave older presets alone", async ({
  page,
}) => {
  const added = new Set([+cord, +rope]);
  expect(added.has(-1)).toBe(false);
  spatialPresets.forEach((p, k) => {
    if (!added.has(k)) expect(p.config.input, p.name).not.toBe("coil");
  });
  await ready(page);
  for (const k of [cord, rope]) {
    await choosePreset(page, k);
    await settled(page);
    expect((await config(page)).input).toBe("coil");
    await expect(page.getByRole("alert")).toHaveCount(0);
    const note = page.locator(".composition-note");
    await expect(note).toContainText("Built on the coil");
    await expect(note).not.toContainText("cusp");
    await expect(layer(page, "Base curve")).toBeChecked();
    await expect(layer(page, "Coil arms")).not.toBeChecked();
  }
  // The cord's whole number of turns closes the tube around the knot.
  await choosePreset(page, cord);
  await settled(page);
  await expect(
    page.getByText(
      "The curve and the radius both close, so the surface closes.",
    ),
  ).toBeVisible();
});

test("a coil input draws coil arms, not perpendiculars, and reveals them with its base", () => {
  const at = (x: number) => ({ x, y: 0, z: 0 });
  const input: SpatialResult = {
    base: [at(0), at(1), at(2), at(3)],
    minus: [],
    plus: [],
    mesh: curveMesh(),
    rulings: [],
    breaks: [false, false, false, false],
    bounds: { center: at(0), radius: 6 },
    radius: 6,
    invalid: 0,
    omitted: 0,
    composition: {
      input: "coil",
      pole: at(0),
      curve: [at(0), at(2), at(4), at(6)],
      breaks: [false, false, false, false],
      constructions: [0, 1, 3].map((sampleIndex) => ({
        sampleIndex,
        contact: at(2 * sampleIndex),
        foot: at(2 * sampleIndex),
        image: at(sampleIndex),
      })),
      cusps: 0,
      unreached: 0,
    },
  };
  const scene = buildScene(input);
  // One segment an arm, contact → coil, of seven floats a vertex.
  expect(scene.connectors.data).toHaveLength(3 * 2 * 7);
  expect(scene.feet.data).toHaveLength(0);
  expect(scene.pole.data).toHaveLength(0);
  const prefix = reveal(input, 2 / 3);
  expect(prefix.composition?.curve).toEqual([at(0), at(2), at(4)]);
  expect(prefix.composition?.constructions.map((c) => c.sampleIndex)).toEqual([
    0, 1,
  ]);
  expect(reveal(input, 1).composition).toEqual(input.composition);
  // The projections keep their perpendiculars, feet and pole.
  const projected = structuredClone(input);
  projected.composition!.input = "tangent-foot";
  const perpendiculars = buildScene(projected);
  expect(perpendiculars.connectors.data).toHaveLength(3 * 6 * 7);
  expect(perpendiculars.pole.data.length).toBeGreaterThan(0);
});

test("a coil input offers its radius, angle and turns as tracks, and no pole", () => {
  const composed = structuredClone(spatialPresets[+cord].config);
  const targets = availableTargets(composed);
  // After the tube's own tracks, which end with its frame's N₀.
  const own = targets.indexOf("normalZ");
  expect(targets.slice(own + 1, own + 4)).toEqual([
    "inputRadius",
    "inputAngle",
    "inputTurns",
  ]);
  expect(targets).not.toContain("poleX");
  expect(targets).not.toContain("inputOffset");
  expect(targetLabel(composed, "inputRadius")).toBe("Coil radius d");
  expect(targetLabel(composed, "inputAngle")).toBe("Coil angle θ₀");
  expect(targetLabel(composed, "inputTurns")).toBe("Coil turns");
  // On the base, or a construction that takes no input, they are not offered.
  expect(availableTargets({ ...composed, input: "base" })).not.toContain(
    "inputTurns",
  );
  expect(availableTargets({ ...composed, construction: "none" })).not.toContain(
    "inputTurns",
  );
  const end = applyTracks(
    composed,
    [
      { target: "inputRadius", from: 0.1, to: Math.E / 10 },
      { target: "inputAngle", from: 0, to: -Math.PI },
      { target: "inputTurns", from: 0, to: 36 },
    ],
    1,
  ).config;
  expect(end.coil).toEqual({
    radius: Math.E / 10,
    angle: -Math.PI,
    turns: 36,
  });
  expect(end.frame).toEqual(composed.frame);
  expect(composed.coil).toEqual({ radius: 0.34, angle: 0, turns: 36 });
});

for (const camera of ["hold", "fit"])
  test(`a coil turns track plays to exact endpoints and Stop restores the study (${camera} camera)`, async ({
    page,
  }) => {
    await ready(page);
    await choosePreset(page, rope);
    await settled(page);
    const original = await config(page),
      drawn = await pixels(page);
    await openAnimation(page);
    await page
      .getByLabel("Animate", { exact: true })
      .selectOption("parameters");
    await page
      .getByLabel("Parameter 1", { exact: true })
      .selectOption("inputTurns");
    await page.getByLabel("Track 1 from").fill("-1/phi");
    await page.getByLabel("Track 1 to").fill("4*pi");
    await page
      .getByLabel("Animation camera", { exact: true })
      .selectOption(camera);
    await page.getByLabel("Duration (seconds)").fill("5");
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const slider = page.getByRole("slider", { name: "Animation progress" });
    await slider.fill("0");
    await expect(stage(page)).toHaveAttribute("data-progress", "0");
    expect((await config(page)).coil.turns).toBe(-1 / ((1 + Math.sqrt(5)) / 2));
    await slider.fill("1");
    await expect(stage(page)).toHaveAttribute("data-progress", "1");
    expect((await config(page)).coil.turns).toBe(4 * Math.PI);
    expect((await config(page)).input).toBe("coil");
    await slider.fill("0.5");
    await expect(stage(page)).toHaveAttribute("data-progress", "0.5");
    expect(await pixels(page)).not.toBe(drawn);
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(stage(page)).not.toHaveAttribute("data-progress");
    expect(await config(page)).toEqual(original);
    expect(await pixels(page)).toBe(drawn);
  });

test("the cord's own animation winds the coil up from 0 to 36 turns", () => {
  const flight = spatialPresets[+cord].flight!;
  expect(flight.animate).toEqual({
    mode: "parameters",
    tracks: [{ target: "inputTurns", from: "0", to: "36" }],
  });
});

test("an SVG built on a coil names it and records it in the metadata", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, rope);
  await settled(page);
  await page.getByRole("button", { name: "Export image", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /^SVG/ }).click();
  const svg = await readFile((await (await downloading).path())!, "utf8");
  expect(svg).toContain(
    "<title>Tangent Garden — spatial framed ribbon on the coil</title>",
  );
  const metadata = JSON.parse(svg.match(/<desc>(.*?)<\/desc>/s)![1]);
  expect(metadata.config).toEqual(await config(page));
  expect(metadata.config.coil).toEqual({ radius: 0.6, angle: 0, turns: 10 });
});

test("the cord opens without the probe the gallery's previous example leaves on", async ({
  page,
}) => {
  // The example before it probes a focal sheet; a preset without its own
  // probe keeps the probe on, which would mark the cord's picture.
  expect(spatialPresets[+cord - 1].probe?.enabled).toBe(true);
  await ready(page);
  await choosePreset(page, String(+cord - 1));
  await settled(page);
  await choosePreset(page, cord);
  await settled(page);
  await expect(
    layer(page, "Frame, curvature & torsion at a point"),
  ).not.toBeChecked();
  await expect(page.locator(".probe-readout")).toHaveCount(0);
});
