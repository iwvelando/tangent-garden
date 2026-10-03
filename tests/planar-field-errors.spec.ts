import { test, expect, type Page } from "@playwright/test";
import { presets } from "../web/presets";
import { choosePreset } from "./helpers";
import { defaultAnimation, defaultLayers } from "../web/planar-link";
import { studyHref, writeStudyLink } from "../web/study-link";
import { fieldLabel } from "../web/planar-fields";
import { readFileSync } from "node:fs";

// An error is shown where it can be fixed: under the control it names,
// marked invalid, as the page's one alert. The drawing keeps the previous
// valid study, marked as such, as the 3D notebook does.
const plot = (page: Page) => page.locator(".plot-wrap");
const textbox = (page: Page, name: string) =>
  page.getByRole("textbox", { name, exact: true });
const control = (page: Page, name: string) =>
  page.getByLabel(name, { exact: true });
const fieldOf = (page: Page, name: string) =>
  page.locator(".field").filter({ has: control(page, name) });
async function settled(page: Page) {
  await expect(plot(page)).toHaveAttribute("aria-busy", "false");
}
const preset = (title: string) =>
  String(presets.findIndex((p) => p.title === title));
async function shownAt(page: Page, name: string, text: string | RegExp) {
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(fieldOf(page, name).getByRole("alert")).toContainText(text);
  await expect(control(page, name)).toHaveAttribute("aria-invalid", "true");
  await expect(fieldOf(page, name).getByRole("alert")).toBeInViewport({
    ratio: 1,
  });
  await expect(page.locator("#artwork")).toBeVisible();
  await expect(plot(page).locator(".stale-study")).toHaveText(
    "Previous valid study",
  );
  await expect(plot(page).locator(".error")).toHaveCount(0);
}

for (const [width, height] of [
  [1440, 1000],
  [390, 844],
] as const)
  test(`an engine error appears under the field it names (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await choosePreset(page, preset("Hypotrochoid & its evolute"));
    await settled(page);
    // Its pair neighbour does not move: compared with the field itself,
    // since the page may scroll to bring the error into view.
    const offset = async () => {
      const a = (await textbox(page, "Fixed radius R").boundingBox())!;
      const b = (await textbox(page, "Rolling radius r").boundingBox())!;
      return [a.x - b.x, a.y - b.y, a.width, a.height];
    };
    const before = await offset();
    await textbox(page, "Rolling radius r").fill("100");
    await shownAt(page, "Rolling radius r", "smaller than the fixed radius R");
    expect(await offset()).toEqual(before);
    await textbox(page, "Rolling radius r").fill("2");
    await settled(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(control(page, "Rolling radius r")).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(page.locator("#artwork")).toBeVisible();
    await expect(plot(page).locator(".stale-study")).toHaveCount(0);
  });

test("a bound that does not parse is shown under its field", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await settled(page);
  await textbox(page, "t from").fill("t");
  await shownAt(page, "t from", /t/);
});

test("a constant that does not parse is shown under its field", async ({
  page,
}) => {
  await page.goto("/");
  await choosePreset(page, preset("Hypotrochoid & its evolute"));
  await settled(page);
  await textbox(page, "Tracing distance d").fill("t");
  await shownAt(page, "Tracing distance d", "Tracing distance d");
});

test("an error naming no field appears under the control just changed", async ({
  page,
}) => {
  await page.goto("/");
  await control(page, "Definition").selectOption("implicit");
  await settled(page);
  await control(page, "Grid cells").fill("");
  await shownAt(page, "Grid cells", "finite number");
});

// Every field the engine's own validation table names (engine's
// fielderror_test.go) has a control, but the construction, chosen by tabs.
test("every field the engine names has a control", () => {
  const go = readFileSync("engine/fielderror_test.go", "utf8");
  const paths = [...go.matchAll(/^\t\t\{"[^"]+", "([^"]+)", func/gm)].map(
    (m) => m[1],
  );
  expect(paths.length).toBeGreaterThan(80);
  const config = structuredClone(presets[0].config);
  for (const path of paths.filter((p) => p !== "kind"))
    expect(fieldLabel(config, path), path).toEqual(expect.any(String));
});

const opened = async (
  page: Page,
  change: (c: (typeof presets)[0]["config"]) => void,
  title = "Ellipse & its evolute",
) => {
  const config = structuredClone(presets[Number(preset(title))].config);
  change(config);
  const token = await writeStudyLink("2d", {
    config,
    bounds: { min: String(config.curve.min), max: String(config.curve.max) },
    length: 0.8,
    poleKind: "pedal",
    layers: defaultLayers,
    camera: { x: 0, y: 0, zoom: 1 },
    animation: defaultAnimation,
  });
  await page.goto(
    studyHref("http://localhost/", "2d", token).replace("http://localhost", ""),
  );
};

// With no valid study yet, the drawing asks for one.
test("a study opened invalid asks for its definition", async ({ page }) => {
  await opened(page, (c) => (c.samples = 10));
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(
    fieldOf(page, "Numerical samples").getByRole("alert"),
  ).toHaveCount(1);
  await expect(plot(page)).toContainText(
    "Check the study definition to begin.",
  );
  await expect(plot(page).getByRole("alert")).toHaveCount(0);
});

// An error that no field shows stands after the study's controls, compact,
// never over the drawing.
for (const [width, height] of [
  [1440, 1000],
  [390, 844],
] as const)
  test(`an error no field shows stands after the controls, in view (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    // A chase of one: the number of pursuers, of no one field.
    await opened(
      page,
      (c) => (c.curve.pursuit.pursuers = c.curve.pursuit.pursuers.slice(0, 1)),
      "Seven pursuers & an evolute",
    );
    const alert = page.getByRole("alert");
    await expect(alert).toHaveCount(1);
    await expect(alert).toContainText("2–16 pursuers");
    await expect(page.locator("aside").getByRole("alert")).toHaveCount(1);
    await expect(page.locator(".field").getByRole("alert")).toHaveCount(0);
    expect((await alert.boundingBox())!.height).toBeLessThan(120);
    // Brought into view, wherever the controls end.
    // Whole, and clear of the screen's edge.
    await expect(alert).toBeInViewport({ ratio: 1 });
    const box = (await alert.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(
      page.viewportSize()!.height - 16,
    );
    // On a desktop only the sidebar scrolls; the drawing stays put.
    if (width > 700) expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

// A polar source whose link leaves out its angle opens with the angle its
// field shows, 0, rather than failing on a value the reader cannot see is
// missing.
test("a polar source opened without its angle draws at the angle shown", async ({
  page,
}) => {
  await opened(
    page,
    (c) => {
      c.source.coordinates = "polar";
      c.source.radius = 1;
      delete (c.source as { theta?: number }).theta;
    },
    "Light inside a circle",
  );
  await settled(page);
  await expect(textbox(page, "Source theta θ (radians)")).toHaveValue("0");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator("#artwork")).toBeVisible();
});
