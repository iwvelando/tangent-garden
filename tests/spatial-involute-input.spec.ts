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
const helix = preset("Where a helix's tangents land"),
  trefoil = preset("A trefoil's string, unwound"),
  viviani = preset("A sheet of Viviani's normals");

test("every construction built on a curve can be built on its involute, with strings and no pole", async ({
  page,
}) => {
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
    await builtOn(page).selectOption("involute");
    await settled(page);
    expect(await config(page)).toMatchObject({
      construction,
      input: "involute",
      unwinding: { anchor: 0, offset: 1 },
    });
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    await expect(page.locator(".legend")).toContainText("Involute");
    await expect(page.locator(".composition-note")).toContainText(
      "Built on the involute",
    );
    // The involute uses no pole: neither its fields nor its marker.
    await expect(field(page, "Pole z")).toHaveCount(0);
    await expect(layer(page, "Pole marker")).toHaveCount(0);
    await expect(layer(page, "Perpendiculars & tangent feet")).toHaveCount(0);
    await expect(field(page, "Input anchor t₀")).toHaveCount(1);
    const original = await pixels(page);
    for (const name of ["Base curve", "Strings from the base"]) {
      const box = layer(page, name);
      await box.uncheck();
      expect(await pixels(page), `${construction}: ${name}`).not.toBe(original);
      await box.check();
      expect(await pixels(page)).toBe(original);
    }
    // A longer string unwinds a different curve.
    await field(page, "Input string c").fill("2");
    await settled(page);
    expect(await pixels(page)).not.toBe(original);
    await field(page, "Input string c").fill("1");
    await builtOn(page).selectOption("base");
    await settled(page);
    await expect(field(page, "Input anchor t₀")).toHaveCount(0);
  }
});

test("the involute input's fields are validated by name and recover", async ({
  page,
}) => {
  await ready(page);
  await builtOn(page).selectOption("involute");
  await settled(page);
  const drawn = await pixels(page);
  for (const [name, text, message] of [
    ["Input string c", "100001", "input's string length"],
    ["Input anchor t₀", "7", "input's anchor"],
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

test("choosing the involute keeps an anchor inside the domain and otherwise centers it", async ({
  page,
}) => {
  await ready(page);
  await page
    .getByLabel("Spatial definition", { exact: true })
    .selectOption("parametric");
  await settled(page);
  // An edited anchor inside the domain is kept.
  await builtOn(page).selectOption("involute");
  await field(page, "Input anchor t₀").fill("pi/5");
  await settled(page);
  await builtOn(page).selectOption("base");
  await settled(page);
  await builtOn(page).selectOption("involute");
  await settled(page);
  expect((await config(page)).unwinding.anchor).toBe(Math.PI / 5);
  // A domain edited away from the anchor, still evaluating when the input
  // is chosen in the same task, moves the anchor to its resolved middle.
  await builtOn(page).selectOption("base");
  await settled(page);
  const handles = await Promise.all(
    [field(page, "t from"), field(page, "to"), builtOn(page)].map((l) =>
      l.elementHandle(),
    ),
  );
  await page.evaluate(([from, to, select]) => {
    const type = (input: HTMLInputElement, text: string) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    type(from as HTMLInputElement, "pi");
    type(to as HTMLInputElement, "2*pi");
    (select as HTMLSelectElement).value = "involute";
    select!.dispatchEvent(new Event("change", { bubbles: true }));
  }, handles);
  await settled(page);
  expect((await config(page)).unwinding.anchor).toBe((3 * Math.PI) / 2);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("the involute presets build on the involute, report their cusps, and leave older presets alone", async ({
  page,
}) => {
  const added = new Set([+helix, +trefoil, +viviani]);
  expect(added.has(-1)).toBe(false);
  spatialPresets.forEach((p, k) => {
    if (!added.has(k)) expect(p.config.input, p.name).not.toBe("involute");
  });
  await ready(page);
  for (const [k, cusps] of [
    [helix, ""],
    [trefoil, ""],
    [viviani, "1 cusp"],
  ] as const) {
    await choosePreset(page, k);
    await settled(page);
    expect((await config(page)).input).toBe("involute");
    await expect(page.getByRole("alert")).toHaveCount(0);
    const note = page.locator(".composition-note");
    await expect(note).toContainText("Built on the involute");
    if (cusps) await expect(note).toContainText(cusps);
    else await expect(note).not.toContainText("cusp");
    await expect(note).not.toContainText("beyond the involute's reach");
    for (const name of ["Base curve", "Strings from the base"])
      await expect(layer(page, name)).toBeChecked();
  }
});

test("an involute input draws strings, not perpendiculars, and reveals them with its base", () => {
  const at = (x: number) => ({ x, y: 0, z: 0 });
  const input: SpatialResult = {
    base: [at(0), at(1), null, at(3)],
    minus: [],
    plus: [],
    mesh: [],
    rulings: [],
    breaks: [false, false, true, true],
    bounds: { center: at(0), radius: 6 },
    radius: 6,
    invalid: 1,
    omitted: 0,
    composition: {
      input: "involute",
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
      unreached: 1,
    },
  };
  const scene = buildScene(input);
  // One segment a string, contact → image, of seven floats a vertex.
  expect(scene.connectors.data).toHaveLength(3 * 2 * 7);
  expect(scene.feet.data).toHaveLength(0);
  expect(scene.pole.data).toHaveLength(0);
  const prefix = reveal(input, 2 / 3);
  expect(prefix.composition?.curve).toEqual([at(0), at(2), at(4)]);
  expect(prefix.composition?.constructions.map((c) => c.sampleIndex)).toEqual([
    0, 1,
  ]);
  expect(prefix.composition?.unreached).toBe(1);
  expect(reveal(input, 1).composition).toEqual(input.composition);
});

test("an involute input offers its string and anchor as tracks, and no pole", () => {
  const composed = structuredClone(spatialPresets[+viviani].config);
  const targets = availableTargets(composed);
  expect(targets.slice(0, 4)).toEqual([
    "a",
    "length",
    "inputOffset",
    "inputAnchor",
  ]);
  expect(targets).not.toContain("poleX");
  expect(targetLabel(composed, "inputOffset")).toBe("Input string c");
  expect(targetLabel(composed, "inputAnchor")).toBe("Input anchor t₀");
  // The involute construction keeps its own anchor and length beside them.
  const twice = { ...composed, construction: "involute" as const };
  expect(availableTargets(twice)).toEqual(
    expect.arrayContaining(["offset", "anchor", "inputOffset", "inputAnchor"]),
  );
  // On the base, or a construction that takes no input, they are not offered.
  expect(availableTargets({ ...composed, input: "base" })).not.toContain(
    "inputOffset",
  );
  expect(availableTargets({ ...composed, construction: "none" })).not.toContain(
    "inputOffset",
  );
  const end = applyTracks(
    composed,
    [
      { target: "inputOffset", from: -1, to: Math.E },
      { target: "inputAnchor", from: 1, to: 3 * Math.PI },
    ],
    1,
  ).config;
  expect(end.unwinding).toEqual({ anchor: 3 * Math.PI, offset: Math.E });
  expect(end.involute).toEqual(composed.involute);
  expect(composed.unwinding).toEqual({ anchor: 2 * Math.PI, offset: 0 });
});

for (const camera of ["hold", "fit"])
  test(`an input string track plays to exact endpoints and Stop restores the study (${camera} camera)`, async ({
    page,
  }) => {
    await ready(page);
    await choosePreset(page, viviani);
    await settled(page);
    const original = await config(page),
      drawn = await pixels(page);
    await openAnimation(page);
    await page
      .getByLabel("Animate", { exact: true })
      .selectOption("parameters");
    await page
      .getByLabel("Parameter 1", { exact: true })
      .selectOption("inputOffset");
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
    expect((await config(page)).unwinding.offset).toBe(
      -1 / ((1 + Math.sqrt(5)) / 2),
    );
    await slider.fill("1");
    await expect(stage(page)).toHaveAttribute("data-progress", "1");
    expect((await config(page)).unwinding.offset).toBe(Math.PI / 3);
    expect((await config(page)).input).toBe("involute");
    await slider.fill("0.5");
    await expect(stage(page)).toHaveAttribute("data-progress", "0.5");
    expect(await pixels(page)).not.toBe(drawn);
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(stage(page)).not.toHaveAttribute("data-progress");
    expect(await config(page)).toEqual(original);
    expect(await pixels(page)).toBe(drawn);
  });

test("an SVG built on an involute names it and records it in the metadata", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, helix);
  await settled(page);
  await page.getByRole("button", { name: "Export image", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /^SVG/ }).click();
  const svg = await readFile((await (await downloading).path())!, "utf8");
  expect(svg).toContain(
    "<title>Tangent Garden — spatial canal surface on the involute</title>",
  );
  const metadata = JSON.parse(svg.match(/<desc>(.*?)<\/desc>/s)![1]);
  expect(metadata.config).toEqual(await config(page));
  expect(metadata.config.unwinding).toEqual({ anchor: 0, offset: 0 });
});
