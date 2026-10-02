import { test, expect, type Page } from "@playwright/test";
import { spatialPresets } from "../web/spatial/presets";
import { choosePreset } from "./helpers";
import { fieldLabel } from "../web/spatial/fields";
import { readFileSync } from "node:fs";

// An error is shown where it can be fixed: under the control it names,
// marked invalid, as the page's one alert.
const stage = (page: Page) => page.locator(".spatial-stage");
const textbox = (page: Page, name: string) =>
  page.getByRole("textbox", { name, exact: true });
const control = (page: Page, name: string) =>
  page.getByLabel(name, { exact: true });
const fieldOf = (page: Page, name: string) =>
  page.locator(".field").filter({ has: control(page, name) });
async function ready(page: Page) {
  await page.goto("/?study=3d");
  await expect(page.locator("#spatial-artwork")).toBeVisible();
  await settled(page);
}
async function settled(page: Page) {
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
}
const preset = (name: string) =>
  String(spatialPresets.findIndex((p) => p.name === name));
async function shownAt(page: Page, name: string, text: string | RegExp) {
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(fieldOf(page, name).getByRole("alert")).toContainText(text);
  await expect(control(page, name)).toHaveAttribute("aria-invalid", "true");
  await expect(fieldOf(page, name).getByRole("alert")).toBeInViewport();
}

for (const [width, height] of [
  [1440, 1000],
  [390, 844],
] as const)
  test(`an engine error appears under the field it names (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await ready(page);
    await control(page, "Built on").selectOption("involute");
    await settled(page);
    // Its pair neighbour does not move: compared with the field itself,
    // since the page may scroll to bring the error into view.
    const offset = async () => {
      const a = (await textbox(page, "Input anchor t₀").boundingBox())!;
      const c = (await textbox(page, "Input string c").boundingBox())!;
      return [a.x - c.x, a.y - c.y, a.width, a.height];
    };
    const before = await offset();
    await textbox(page, "Input string c").fill("100001");
    await shownAt(page, "Input string c", "input's string length");
    expect(await offset()).toEqual(before);
    await textbox(page, "Input string c").fill("1");
    await settled(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(control(page, "Input string c")).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

test("a switch that makes a field invalid shows the error at that field", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await choosePreset(page, preset("A trefoil's string, unwound"));
  await settled(page);
  // The input involute has its cusp at t₀ = 0, where the involute's own
  // anchor also sits.
  await control(page, "Construction").selectOption("involute");
  await shownAt(page, "Anchor t₀", "anchor t₀");
  await textbox(page, "Anchor t₀").fill("1");
  await settled(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a constant that does not parse is shown under its field", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await textbox(page, "Tangent reach L").fill("t");
  await shownAt(page, "Tangent reach L", "Tangent reach L");
});

test("an error naming no field appears under the control just changed", async ({
  page,
}) => {
  await ready(page);
  await control(page, "Spatial definition").selectOption("parametric");
  await settled(page);
  for (const axis of ["x", "y"]) await textbox(page, `${axis}(t)`).fill("0");
  await settled(page);
  await textbox(page, "z(t)").fill("0");
  await shownAt(page, "z(t)", "no regular finite samples");
});

// Every field the engine's own validation table names (engine3's
// fielderror_test.go) has a control label, for some study that shows it.
test("every field the engine names has a control", () => {
  const go = readFileSync("engine3/fielderror_test.go", "utf8");
  const paths = [...go.matchAll(/^\t\t\{"[^"]+", "([^"]+)", func/gm)].map(
    (m) => m[1],
  );
  expect(paths.length).toBeGreaterThan(80);
  const config = structuredClone(spatialPresets[0].config);
  for (const path of paths)
    expect(fieldLabel(config, path), path).toEqual(expect.any(String));
});
