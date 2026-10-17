import { presetStudy } from "../web/spatial/link";
import { defaultLayers } from "../web/spatial/scene";
import { spatialPresets } from "../web/spatial/presets";
import { test, expect, type Page } from "@playwright/test";
import { choosePreset } from "./helpers";
import { readFile } from "node:fs/promises";

const stage = (page: Page) => page.locator(".spatial-stage");
const layer = (page: Page, name: string) =>
  page.getByRole("checkbox", { name, exact: true });
async function ready(page: Page) {
  await page.goto("/?study=3d");
  await expect(page.locator("#spatial-artwork")).toBeVisible();
  await settled(page);
}
// The Klein bottle's mesh and 24 sections take about 2.5 s locally and
// several times that on CI, past the default 5 s.
async function settled(page: Page) {
  await expect(stage(page)).toHaveAttribute("aria-busy", "false", {
    timeout: 30_000,
  });
}
// The layers an SVG export records, which are the layers it was drawn with.
async function exported(page: Page) {
  await page.getByRole("button", { name: "Export image", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /^SVG/ }).click();
  const svg = await readFile((await (await downloading).path())!, "utf8");
  return JSON.parse(svg.match(/<desc>(.*?)<\/desc>/s)![1]).layers;
}
const layered = spatialPresets.flatMap((p, i) => (p.layers ? [i] : []));
const cinquefoil = spatialPresets.findIndex(
  (p) => p.name === "Cinquefoil · (2, 5)",
);
const focal = spatialPresets.findIndex(
  (p) => p.name === "The whole focal surface of an ellipsoid",
);

test("the Go similarity fixture covers every current spatial preset", async () => {
  const fixture = JSON.parse(
    await readFile("engine3/testdata/presets.json", "utf8"),
  );
  expect(fixture).toEqual(
    Object.fromEntries(spatialPresets.map((p) => [p.name, p.config])),
  );
});

test("presets that set layers hide only layers their study draws", () => {
  expect(layered.length).toBeGreaterThanOrEqual(3);
  for (const i of layered) {
    const layers = spatialPresets[i].layers!;
    // Each names at least one hidden layer, and only the layers it changes.
    expect(Object.values(layers)).toContain(false);
    for (const [key, shown] of Object.entries(layers)) {
      expect(Object.keys(defaultLayers)).toContain(key);
      expect(shown).not.toBe(defaultLayers[key as keyof typeof defaultLayers]);
    }
  }
});

test("a preset opens with its own layers, and one without shows every layer", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await ready(page);
  // Your own layers on the opening trefoil.
  await layer(page, "Tangent rulings").uncheck();
  expect((await exported(page)).rulings).toBe(false);
  // A preset without layers draws as its picture, every layer shown.
  await choosePreset(page, cinquefoil);
  await settled(page);
  await expect(layer(page, "Tangent rulings")).toBeChecked();
  await expect(stage(page)).not.toHaveAttribute("data-layers", /./);
  expect(await exported(page)).toEqual(defaultLayers);
  // From one preset with layers straight to another, the second's own.
  const other = layered.find((i) => i !== focal)!;
  await choosePreset(page, other);
  await settled(page);
  await expect(stage(page)).toHaveAttribute(
    "data-layers",
    JSON.stringify(spatialPresets[other].layers),
  );
  // The focal surface's shell is hidden and its sheets shown, and the
  // checkboxes say so and still work.
  await choosePreset(page, focal);
  await settled(page);
  expect(await exported(page)).toEqual({
    ...defaultLayers,
    ...spatialPresets[focal].layers,
  });
  await expect(layer(page, "Surface patch")).not.toBeChecked();
  await expect(layer(page, "Focal sheet 1 · κ₁")).toBeChecked();
  await expect(layer(page, "Focal sheet 2 · κ₂")).toBeChecked();
  await layer(page, "Surface patch").check();
  expect((await exported(page)).surface).toBe(true);
  // The preset's own layers stay its fingerprint while you edit them.
  await expect(stage(page)).toHaveAttribute(
    "data-layers",
    JSON.stringify(spatialPresets[focal].layers),
  );
  // Leaving for a preset without layers shows them all again.
  await layer(page, "Surface patch").uncheck();
  await choosePreset(page, cinquefoil);
  await settled(page);
  expect(await exported(page)).toEqual(defaultLayers);
});

// Each preset with layers opens with them, in the drawing and its export.
// One test each, so no test sweeps every heavy preset on a slow runner.
for (const i of layered)
  test(`${spatialPresets[i].name} opens with its own layers`, async ({
    page,
  }) => {
    await ready(page);
    await choosePreset(page, i);
    await settled(page);
    await expect(stage(page)).toHaveAttribute(
      "data-layers",
      JSON.stringify(spatialPresets[i].layers),
    );
    expect(await exported(page)).toEqual({
      ...defaultLayers,
      ...spatialPresets[i].layers,
    });
  });

// These are deliberate opening choices: presetStudy is also what choosing
// an example restores after edits and what a copied study link records.
test("smoother surface presets open with their requested u sample counts", () => {
  for (const [name, count] of [
    ["A torus revealing its centers", 216],
    ["A sphere collapsing to one focus", 216],
    ["The focal sheets of an ellipsoid", 150],
    ["An elliptic cylinder and its evolute", 216],
    ["An ellipsoid hiding its centers", 150],
    ["An ellipsoid with a corner cut away", 150],
    ["Where an ellipsoid's curvatures meet", 150],
    ["A paraboloid gathering light", 150],
    ["A tilted beam folding into coma", 150],
    ["A spherical bowl's cusped caustic", 150],
    ["An ellipsoid refocusing its lamp", 150],
    ["A cup's nephroid", 216],
    ["A lamp sealed in an ellipsoid", 216],
    ["A glass ellipsoid focusing a beam", 216],
    ["A glass dome's ring of light", 150],
    ["A lamp in water over air", 150],
    ["A cup's nephroid on its floor", 216],
  ] as const) {
    const i = spatialPresets.findIndex((p) => p.name === name);
    expect(i, name).toBeGreaterThanOrEqual(0);
    expect.soft(presetStudy(i).config.surface.uSamples, name).toBe(count);
  }
});

test("refined presets open with smooth skins, tapered tube lines and a continuous focal probe", () => {
  const study = (name: string) =>
    presetStudy(spatialPresets.findIndex((p) => p.name === name));
  for (const name of [
    "A screw band coiled round a ring",
    "Treads folding into cones round a ring",
    "A coiled cord round a trefoil",
  ]) {
    expect
      .soft(study(name).config, name)
      .toMatchObject({ adaptive: true, adaptiveSurface: true });
  }
  expect.soft(study("Inside a trefoil's tube").sight.depth).toBe("taper");
  expect
    .soft(study("The curvature of an ellipsoid's focal sheet").probe)
    .toMatchObject({
      enabled: true,
      target: "focal1",
      betweenGrid: true,
    });
});

test("a preset's composed opening view survives its default reveal", () => {
  for (const [i, preset] of spatialPresets.entries()) {
    if (
      !preset.view ||
      (preset.flight && preset.flight.animate?.mode !== "reveal")
    )
      continue;
    expect.soft(presetStudy(i).animation.camera, preset.name).toBe("current");
  }
});

test("parameter presets with composed views retain their opening camera", () => {
  for (const name of [
    "Treads folding into cones round a ring",
    "A cord twisted round a spring",
    "An ellipsoid's parallel surface",
    "A spheroid's evolute, spun about its axis",
    "A coiled cord round a trefoil",
  ]) {
    const i = spatialPresets.findIndex((p) => p.name === name);
    expect.soft(presetStudy(i).animation.camera, name).toBe("current");
  }
});

test("detail presets approach the detail with the whole geometry present", () => {
  for (const name of [
    "A braided cable running to the horizon",
    "A coiled tube running into the distance",
    "A spring folded into a cusp",
    "A corridor of loops",
  ]) {
    const i = spatialPresets.findIndex((p) => p.name === name),
      study = presetStudy(i);
    expect.soft(study.animation.mode, name).toBe("path");
    const keys = study.animation.path.keys;
    expect.soft(keys.length, name).toBeGreaterThanOrEqual(2);
    expect.soft(keys.at(-1), name).toMatchObject(study.view);
    expect.soft(study.animation.repeat, name).toBe("back-and-forth");
  }
});
