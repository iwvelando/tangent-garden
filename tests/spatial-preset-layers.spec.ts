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
  // Each preset with layers opens with them, in the drawing and its export.
  for (const i of layered) {
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
  }
  // The focal surface's shell is hidden and its sheets shown, and the
  // checkboxes say so and still work.
  await choosePreset(page, focal);
  await settled(page);
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
