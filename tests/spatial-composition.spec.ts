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
import { choosePreset, examplesButton } from "./helpers";
import { readFile } from "node:fs/promises";

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
const cusp = preset("Filaments off a cusp"),
  horn = preset("A horn of perpendicular feet"),
  chords = preset("Chords across a knot's reflection");
// The involute's own showcases, in the same gallery family (see
// spatial-involute-input.spec.ts).
const unwound = [
  preset("Where a helix's tangents land"),
  preset("A trefoil's string, unwound"),
  preset("A sheet of Viviani's normals"),
];
const composedLayers = [
  "Base curve",
  "Perpendiculars & tangent feet",
  "Pole marker",
];

test("every construction built on a curve can be built on a derived curve, with its own layers and a validated pole", async ({
  page,
}) => {
  // Five constructions, each built on two derived curves with every layer
  // toggled: about 16 s locally and twice that on CI, where it outgrew the
  // default 30 s.
  test.slow();
  await ready(page);
  const trefoil = await pixels(page);
  await expect(builtOn(page)).toHaveValue("base");
  await expect(field(page, "Pole z")).toHaveCount(0);
  for (const name of composedLayers)
    await expect(layer(page, name)).toHaveCount(0);
  await expect(page.locator(".composition-note")).toHaveCount(0);
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
    await builtOn(page).selectOption("tangent-foot");
    await settled(page);
    expect(await config(page)).toMatchObject({
      construction,
      input: "tangent-foot",
    });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    await expect(page.locator(".legend")).toContainText("Tangent-foot curve");
    await expect(page.locator(".legend")).toContainText("Base curve");
    await expect(page.locator(".composition-note")).toContainText(
      "Built on the tangent-foot curve",
    );
    await expect(field(page, "Pole z")).toHaveCount(1);
    // Above the knot, where no surface hides the pole's marker.
    await field(page, "Pole z").fill("3");
    await settled(page);
    const original = await pixels(page);
    for (const name of composedLayers) {
      const box = layer(page, name);
      await box.uncheck();
      expect(await pixels(page), `${construction}: ${name}`).not.toBe(original);
      await box.check();
      expect(await pixels(page)).toBe(original);
    }
    await builtOn(page).selectOption("orthotomic");
    await settled(page);
    await expect(page.locator(".legend")).toContainText(
      "Tangent-line orthotomic",
    );
    expect(await pixels(page)).not.toBe(original);
    await builtOn(page).selectOption("base");
    await settled(page);
    await expect(field(page, "Pole z")).toHaveCount(0);
  }
  // The pole is validated by name, and an invalid pole leaves the study.
  await builtOn(page).selectOption("orthotomic");
  await settled(page);
  for (const [name, text] of [
    ["Pole x", "100001"],
    ["Pole z", "-100001"],
  ] as const) {
    const before = await field(page, name).inputValue();
    await field(page, name).fill(text);
    await expect(page.getByRole("alert")).toContainText("±100000");
    await field(page, name).fill(before);
    await settled(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  // Back on the base, the trefoil's drawing returns exactly.
  await page
    .getByLabel("Construction", { exact: true })
    .selectOption("developable");
  await builtOn(page).selectOption("base");
  await settled(page);
  expect(await pixels(page)).toBe(trefoil);
});

test("constructions without an input hide the choice and ignore it", async ({
  page,
}) => {
  await ready(page);
  await builtOn(page).selectOption("orthotomic");
  await settled(page);
  for (const construction of [
    "tangent-foot",
    "orthotomic",
    "inversion",
    "none",
  ] as const) {
    await page
      .getByLabel("Construction", { exact: true })
      .selectOption(construction);
    await settled(page);
    await expect(builtOn(page)).toHaveCount(0);
    await expect(page.locator(".composition-note")).toHaveCount(0);
    await expect(layer(page, "Base curve")).toHaveCount(0);
    expect((await config(page)).input).toBe("orthotomic");
    const kept = await pixels(page);
    // The same study built on the base draws the same.
    await page
      .getByLabel("Construction", { exact: true })
      .selectOption("developable");
    await builtOn(page).selectOption("base");
    await page
      .getByLabel("Construction", { exact: true })
      .selectOption(construction);
    await settled(page);
    expect(await pixels(page)).toBe(kept);
    await page
      .getByLabel("Construction", { exact: true })
      .selectOption("developable");
    await builtOn(page).selectOption("orthotomic");
    await settled(page);
  }
});

test("earlier presets are built on the base and keep their layers", async ({
  page,
}) => {
  const added = new Set([+cusp, +horn, +chords, ...unwound.map(Number)]);
  spatialPresets.forEach((p, k) => {
    if (!added.has(k)) expect(p.config.input, p.name).toBe("base");
  });
  expect(added.has(-1)).toBe(false);
  await ready(page);
  for (const k of [0, 6, 22]) {
    await choosePreset(page, String(k));
    await settled(page);
    expect((await config(page)).input).toBe("base");
    for (const name of composedLayers)
      await expect(layer(page, name)).toHaveCount(0);
    await expect(page.locator(".legend")).toContainText("Base curve");
  }
});

test("the cusp preset reports its cusp, and every showcase builds on a derived curve", async ({
  page,
}) => {
  await ready(page);
  // The gallery gathers them as their own family.
  await examplesButton(page).click();
  const gallery = page.getByRole("dialog", { name: "Notebook examples" });
  await gallery
    .getByRole("group", { name: "Example family" })
    .getByRole("button", { name: /Built on a derived curve/ })
    .click();
  await expect(gallery.locator("[data-example]")).toHaveCount(6);
  expect(
    await gallery
      .locator("[data-example]")
      .evaluateAll((cards) =>
        cards.map((c) => (c as HTMLElement).dataset.example),
      ),
  ).toEqual([cusp, horn, chords, ...unwound]);
  await page.keyboard.press("Escape");
  await gallery.waitFor({ state: "hidden" });
  for (const [k, input, text] of [
    [cusp, "tangent-foot", "1 cusp"],
    [horn, "tangent-foot", ""],
    [chords, "orthotomic", ""],
  ] as const) {
    await choosePreset(page, k);
    await settled(page);
    expect((await config(page)).input).toBe(input);
    await expect(page.getByRole("alert")).toHaveCount(0);
    const note = page.locator(".composition-note");
    await expect(note).toBeVisible();
    if (text) await expect(note).toContainText(text);
    else await expect(note).not.toContainText("cusp");
    for (const name of composedLayers)
      await expect(layer(page, name)).toBeChecked();
  }
});

test("composed reveal keeps the base, its connectors and the pole in step and in frame", () => {
  const at = (x: number) => ({ x, y: 0, z: 0 }),
    pole = { x: -50, y: 40, z: 0 };
  const input: SpatialResult = {
    base: [at(0), at(1), null, at(3)],
    minus: [],
    plus: [],
    mesh: [],
    rulings: [],
    breaks: [false, false, true, true],
    bounds: { center: at(0), radius: 60 },
    radius: 60,
    invalid: 1,
    omitted: 0,
    composition: {
      input: "tangent-foot",
      pole,
      curve: [at(0), at(2), at(4), at(6)],
      breaks: [false, false, false, false],
      constructions: [0, 1, 3].map((sampleIndex) => ({
        sampleIndex,
        contact: at(2 * sampleIndex),
        foot: at(sampleIndex),
        image: at(sampleIndex),
      })),
      cusps: 1,
    },
  };
  const prefix = reveal(input, 2 / 3);
  expect(prefix.composition?.curve).toEqual([at(0), at(2), at(4)]);
  expect(prefix.composition?.breaks).toEqual([false, false, false]);
  expect(prefix.composition?.constructions.map((c) => c.sampleIndex)).toEqual([
    0, 1,
  ]);
  expect(prefix.composition?.pole).toEqual(pole);
  // The pole frames the prefix, as Go frames the whole study.
  expect(prefix.bounds.center.x).toBeLessThan(0);
  expect(prefix.bounds.radius).toBeGreaterThan(30);
  expect(input.composition?.curve).toHaveLength(4);
  expect(reveal(input, 1).composition).toEqual(input.composition);
  // The base is drawn with its own breaks, not the input's: 0–1, 1–2, 2–3,
  // as three segments of seven floats a vertex.
  expect(buildScene(input).parent.data).toHaveLength(3 * 2 * 7);
  // Its connectors run base point → foot → pole → foot → foot → image.
  expect(buildScene(input).connectors.data).toHaveLength(3 * 6 * 7);
});

test("a composed study offers pole tracks after its own, and the developable keeps its reach", () => {
  const base = structuredClone(spatialPresets[0].config);
  expect(availableTargets(base)).not.toContain("poleX");
  const composed = { ...base, input: "orthotomic" as const };
  expect(availableTargets(composed).slice(0, 4)).toEqual([
    "length",
    "poleX",
    "poleY",
    "poleZ",
  ]);
  // Composition does not rename the construction's own lines.
  expect(targetLabel(composed, "lines")).toBe("Tangent lines");
  const involute = structuredClone(spatialPresets[+cusp].config);
  expect(availableTargets(involute)).toEqual(
    expect.arrayContaining(["from", "to", "count", "anchor", "poleX"]),
  );
  // An unsupported construction ignores the input and offers no pole.
  expect(availableTargets({ ...composed, construction: "none" })).not.toContain(
    "poleX",
  );
  const end = applyTracks(
    composed,
    [{ target: "poleZ", from: -1, to: Math.PI }],
    1,
  ).config;
  expect(end.pole).toEqual({ ...composed.pole, z: Math.PI });
  expect(end.input).toBe("orthotomic");
  expect(composed.pole).toEqual(base.pole);
});

for (const camera of ["hold", "fit"])
  test(`a pole track plays to exact endpoints and Stop restores the study (${camera} camera)`, async ({
    page,
  }) => {
    await ready(page);
    await choosePreset(page, horn);
    await settled(page);
    const original = await config(page),
      drawn = await pixels(page);
    await openAnimation(page);
    await page
      .getByLabel("Animate", { exact: true })
      .selectOption("parameters");
    await page.getByLabel("Parameter 1", { exact: true }).selectOption("poleX");
    await page.getByLabel("Track 1 from").fill("-1/phi");
    await page.getByLabel("Track 1 to").fill("pi/3");
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
    expect((await config(page)).pole.x).toBe(-1 / ((1 + Math.sqrt(5)) / 2));
    await slider.fill("1");
    await expect(stage(page)).toHaveAttribute("data-progress", "1");
    expect((await config(page)).pole.x).toBe(Math.PI / 3);
    expect((await config(page)).input).toBe("tangent-foot");
    await slider.fill("0.5");
    await expect(stage(page)).toHaveAttribute("data-progress", "0.5");
    expect(await pixels(page)).not.toBe(drawn);
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(stage(page)).not.toHaveAttribute("data-progress");
    expect(await config(page)).toEqual(original);
    expect(await pixels(page)).toBe(drawn);
  });

test("a composed SVG names its input and records it in the metadata", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, chords);
  await settled(page);
  await layer(page, "Base curve").uncheck();
  await page.getByRole("button", { name: "Export image", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /^SVG/ }).click();
  const svg = await readFile((await (await downloading).path())!, "utf8");
  expect(svg).toContain(
    "<title>Tangent Garden — spatial ruled surface on the tangent-line orthotomic</title>",
  );
  const metadata = JSON.parse(svg.match(/<desc>(.*?)<\/desc>/s)![1]);
  expect(metadata.config).toEqual(await config(page));
  expect(metadata.layers.parent).toBe(false);
});
