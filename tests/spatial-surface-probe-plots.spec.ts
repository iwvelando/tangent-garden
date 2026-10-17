import { test, expect, type Page } from "@playwright/test";
import { choosePreset } from "./helpers";
import { helpText } from "../web/help";
import {
  defaultProbe,
  surfacePlotOptions,
  surfacePlots,
  surfacePlotSeries,
  surfacePlotsHelp,
  surfaceTerms,
} from "../web/spatial/probe";
import { spatialPresets } from "../web/spatial/presets";
import type { SpatialConfig, SurfaceDiagnostics } from "../web/spatial/types";

// The surface probe's plots: along its rows, as it has always drawn them,
// across its columns, or both. The values come from the grid's own
// curvatures; the expected ones below follow from the definitions.
const config = (
  construction: SpatialConfig["construction"],
  format: SpatialConfig["format"] = "parametric",
): SpatialConfig => ({
  ...structuredClone(spatialPresets[0].config),
  format,
  construction,
});

// A grid of three rows and four columns whose curvatures name their place:
// branch b at (r, c) is (b + 1)(10 + r) + c/10, with (1, 2) unknown on the
// first branch.
function grid(periodic = false): SurfaceDiagnostics {
  const k = (b: number) =>
    [0, 1, 2].map((r) =>
      [0, 1, 2, 3].map((c) =>
        b === 0 && r === 1 && c === 2 ? null : (b + 1) * (10 + r) + c / 10,
      ),
    );
  const none = [0, 1, 2].map(() => [null, null, null, null]);
  return {
    kind: periodic ? "canal" : "patch",
    along: [0, 1, 2],
    u: [0, 0.5, 1],
    v: [0, 1, 2, 3],
    periodic,
    points: none,
    normals: none,
    curvature: [k(0), k(1)],
    direction: [none, none],
    focal: [none, none],
    singular: 0,
    umbilics: 0,
    unknown: 1,
    clipped: [0, 0],
  };
}

test("the surface probe plots along its column, across its row, or both", () => {
  const d = grid(),
    terms = surfaceTerms(config("none", "surface"), "surface");
  // Along the rows, as before: column 2, the probe at row 1, at 10⁻⁴ of
  // the column's largest curvature, 2·12 + 0.2.
  const along = [
    {
      values: [10.2, null, 12.2],
      at: 1,
      label: "κ₁ along u",
      resolution: 1e-4 * 24.2,
    },
    {
      values: [20.2, 22.2, 24.2],
      at: 1,
      label: "κ₂ along u",
      resolution: 1e-4 * 24.2,
    },
  ];
  expect(surfacePlotSeries(d, terms, 1, 2)).toEqual(along);
  expect(surfacePlotSeries(d, terms, 1, 2, "along")).toEqual(along);
  // Across the columns: row 1, the probe at column 2, at 10⁻⁴ of the
  // row's largest, 2·11 + 0.3.
  const around = [
    {
      values: [11, 11.1, null, 11.3],
      at: 2,
      label: "κ₁ along v",
      resolution: 1e-4 * 22.3,
    },
    {
      values: [22, 22.1, 22.2, 22.3],
      at: 2,
      label: "κ₂ along v",
      resolution: 1e-4 * 22.3,
    },
  ];
  expect(surfacePlotSeries(d, terms, 1, 2, "around")).toEqual(around);
  expect(surfacePlotSeries(d, terms, 1, 2, "both")).toEqual([
    ...along,
    ...around,
  ]);
  // The grid itself is untouched.
  expect(d.curvature[0][1]).toEqual([11, 11.1, null, 11.3]);
});

test("around a canal's contact circle the plot closes the turn", () => {
  const d = grid(true),
    terms = surfaceTerms(config("canal"), "surface");
  const [first, second] = surfacePlotSeries(d, terms, 2, 3, "around");
  expect(first).toEqual({
    values: [12, 12.1, 12.2, 12.3, 12],
    at: 3,
    label: "κ around the circle along θ − θ₀",
    resolution: 1e-4 * 24.3,
  });
  expect(second.values).toEqual([24, 24.1, 24.2, 24.3, 24]);
  // Along t a canal's plot is as a patch's.
  expect(surfacePlotSeries(d, terms, 2, 3)[0].values).toEqual([
    10.3, 11.3, 12.3,
  ]);
});

test("the plots' choice is named by each surface's own sliders", () => {
  const named = (c: SpatialConfig, target: "surface" | "light" = "surface") =>
    surfacePlotOptions(surfaceTerms(c, target)).map((o) => o.label);
  expect(named(config("none", "surface"))).toEqual([
    "Along u",
    "Along v",
    "Both",
  ]);
  expect(named(config("canal"))).toEqual(["Along t", "Around", "Both"]);
  expect(named(config("developable"))).toEqual([
    "Along t",
    "Across the ruling",
    "Both",
  ]);
  expect(named(config("framed"))).toEqual([
    "Along t",
    "Across the ribbon",
    "Both",
  ]);
  expect(named(config("ruled"))).toEqual([
    "Along t",
    "Along the ruling",
    "Both",
  ]);
  expect(named(config("none", "rays"), "light")).toEqual([
    "Along u",
    "Along v",
    "Both",
  ]);
  // A probe without the field plots along the rows.
  expect(surfacePlots(defaultProbe)).toBe("along");
  expect(surfacePlots({ ...defaultProbe, plots: "both" })).toBe("both");
  // The help names the branches and both parameters; only a canal's
  // mentions the closed turn.
  const canal = helpText(surfacePlotsHelp(config("canal"), "surface"));
  expect(canal).toContain(
    "Plots κ around the circle and κ across it through the point along t, along θ − θ₀, or both.",
  );
  expect(canal).toContain("back to θ₀");
  expect(helpText(surfacePlotsHelp(config("none", "rays"), "light"))).toContain(
    "Plots μ₁ and μ₂ through the point along u, along v, or both.",
  );
  expect(
    helpText(surfacePlotsHelp(config("none", "surface"), "surface")),
  ).not.toContain("θ₀");
});

// Through the real notebook, worker and engine.
const stage = (page: Page) => page.locator(".spatial-stage");
const settled = (page: Page) =>
  expect(stage(page)).toHaveAttribute("aria-busy", "false");
async function ready(page: Page) {
  await page.goto("/?study=3d");
  await expect(page.locator("#spatial-artwork")).toBeVisible();
  await settled(page);
}
const slider = (page: Page, name: string) =>
  page.getByRole("slider", { name, exact: true });
const plots = (page: Page) => page.getByLabel("Plots", { exact: true });
const captions = (page: Page) => page.locator(".probe-plot figcaption");
// Where each plot marks the probe, as a share of its width, to 6 places.
const places = (x: number) => Math.round(x * 1e6) / 1e6;
const marks = (page: Page) =>
  page
    .locator(".probe-plot svg")
    .evaluateAll((svgs) =>
      svgs.map(
        (svg) =>
          Math.round(
            (Number(svg.querySelector("line[stroke]")!.getAttribute("x1")) /
              240) *
              1e6,
          ) / 1e6,
      ),
    );
// How many samples each plot's series joins, over all its runs.
const joined = (page: Page) =>
  page
    .locator(".probe-plot svg")
    .evaluateAll((svgs) =>
      svgs.map((svg) =>
        [...svg.querySelectorAll("polyline")].reduce(
          (n, p) => n + p.getAttribute("points")!.split(" ").length,
          0,
        ),
      ),
    );
const short = (v: number) => String(Number(v.toPrecision(4)));
const curvatureSwitch = (page: Page) =>
  page.getByRole("checkbox", {
    name: "Principal curvatures & centers at a point",
  });

// The torus preset: R = 2, r = 0.8, u over the whole circle in 216 steps and
// v from −π/3 to π/3 in 24, with the outward normal: κ₁ = −cos v/(2 +
// 0.8 cos v), constant along u, and κ₂ = −1/0.8 everywhere.
test("a torus plots κ₁ varying along v and constant along u", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, { label: "A torus revealing its centers" });
  await settled(page);
  await curvatureSwitch(page).check();
  await settled(page);
  const k1 = (v: number) => -Math.cos(v) / (2 + 0.8 * Math.cos(v));
  // Today's plots, along u, by default.
  await expect(plots(page)).toHaveValue("along");
  await expect(captions(page)).toHaveText([
    `κ₁ along u: constant at ${short(k1(0))}`,
    "κ₂ along u: constant at -1.25",
  ]);
  expect(await marks(page)).toEqual([0.5, 0.5]);
  await plots(page).selectOption("around");
  await expect(captions(page)).toHaveText([
    `κ₁ along v from ${short(k1(0))} to ${short(k1(Math.PI / 3))}`,
    "κ₂ along v: constant at -1.25",
  ]);
  expect(await joined(page)).toEqual([25, 25]);
  // The mark follows the column, and the row leaves the plot alone.
  await slider(page, "Along v").fill("6");
  await expect.poll(() => marks(page)).toEqual([0.25, 0.25]);
  await slider(page, "Along u").fill("10");
  await expect(captions(page).first()).toHaveText(
    `κ₁ along v from ${short(k1(0))} to ${short(k1(Math.PI / 3))}`,
  );
  await plots(page).selectOption("both");
  await expect(captions(page)).toHaveText([
    `κ₁ along u: constant at ${short(k1(-Math.PI / 6))}`,
    "κ₂ along u: constant at -1.25",
    `κ₁ along v from ${short(k1(0))} to ${short(k1(Math.PI / 3))}`,
    "κ₂ along v: constant at -1.25",
  ]);
  expect(await marks(page)).toEqual(
    [10 / 216, 10 / 216, 0.25, 0.25].map(places),
  );
  // Back to the rows: exactly today's plots.
  await plots(page).selectOption("along");
  await expect(captions(page)).toHaveCount(2);
  await expect(captions(page).first()).toHaveText(
    `κ₁ along u: constant at ${short(k1(-Math.PI / 6))}`,
  );
});

// The beads: spheres of radius R = 0.7(1 + 0.8 sin 2t), so around each
// contact circle κ = −1/R, and a surface of revolution, so across it κ
// does not change with the turn. Row 270 is t = π/4.
test("around a canal's contact circle both curvatures are constant over the full turn", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, { label: "Beads that lose their envelope" });
  await settled(page);
  await page.getByLabel("Describe", { exact: true }).selectOption("surface");
  await curvatureSwitch(page).check();
  await settled(page);
  await slider(page, "Along t").fill("270");
  await plots(page).selectOption("around");
  const t = Math.PI / 4,
    R = 0.7 * (1 + 0.8 * Math.sin(2 * t)),
    r1 = 1.12 * Math.cos(2 * t),
    r2 = -2.24 * Math.sin(2 * t);
  await expect(captions(page)).toHaveText([
    `κ around the circle along θ − θ₀: constant at ${short(-1 / R)}`,
    `κ across it along θ − θ₀: constant at ${short(r2 / (1 - r1 * r1 - R * r2))}`,
  ]);
  // 24 turns and the first again; the probe at column 12 of 24 steps.
  expect(await joined(page)).toEqual([25, 25]);
  expect(await marks(page)).toEqual([0.5, 0.5]);
  await slider(page, "Around").fill("23");
  await expect.poll(() => marks(page)).toEqual([23 / 24, 23 / 24].map(places));
});

// A helix's tangent ribbon: along each ruling κ = 0 at every u, and across
// it κ = 1/(6|u|), largest beside the edge of regression (|u| = 0.125) and
// smallest at the far edges (|u| = 1.5).
test("a tangent ribbon plots its curvatures along its ruling", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, { label: "Helix · a ribbon staircase" });
  await settled(page);
  await page.getByLabel("Describe", { exact: true }).selectOption("surface");
  await curvatureSwitch(page).check();
  await settled(page);
  await plots(page).selectOption("around");
  await expect(captions(page).first()).toHaveText(
    "κ along the ruling along u: constant at 0",
  );
  await expect(captions(page).nth(1)).toContainText(
    `κ across it along u from ${short(1 / 9)}`,
  );
  expect(await joined(page)).toEqual([24, 24]);
});

// Every surface the probe describes offers the choice, keeps it across its
// sliders, and draws both pairs of plots in its own words.
for (const [preset, target, name, words] of [
  [
    "A torus revealing its centers",
    "surface",
    "Principal curvatures & centers at a point",
    ["κ₁", "κ₂", "u", "v"],
  ],
  [
    "Beads that lose their envelope",
    "surface",
    "Principal curvatures & centers at a point",
    ["κ around the circle", "κ across it", "t", "θ − θ₀"],
  ],
  [
    "Helix · a ribbon staircase",
    "surface",
    "Principal curvatures & centers at a point",
    ["κ along the ruling", "κ across it", "t", "u"],
  ],
  [
    "The seam of a carried frame",
    "surface",
    "Principal curvatures & centers at a point",
    ["κ₁", "κ₂", "t", "u"],
  ],
  [
    "Chords of a rising helix",
    "surface",
    "Principal curvatures & centers at a point",
    ["κ₁", "κ₂", "t", "u"],
  ],
  [
    "The curvature of an ellipsoid's focal sheet",
    "focal1",
    "Principal curvatures & centers at a point",
    ["κ₁", "κ₂", "u", "v"],
  ],
  [
    "A spherical bowl's cusped caustic",
    "light",
    "Wavefront, foci & rays at a point",
    ["μ₁", "μ₂", "u", "v"],
  ],
  [
    "A lamp in water over air",
    "mirror",
    "Principal curvatures & centers at a point",
    ["κ₁", "κ₂", "u", "v"],
  ],
] as const)
  test(`the probe plots both ways · ${preset} · ${target}`, async ({
    page,
  }) => {
    await ready(page);
    await choosePreset(page, { label: preset });
    await settled(page);
    const describe = page.getByLabel("Describe", { exact: true });
    if ((await describe.count()) && (await describe.inputValue()) !== target)
      await describe.selectOption(target);
    await page.getByRole("checkbox", { name }).check();
    await settled(page);
    // The beads' middle row has no contact circle, so nothing to plot
    // across it: a bead's widest row has.
    const row = page.locator(".spatial-probe input[type=range]").first();
    if (preset === "Beads that lose their envelope") await row.fill("270");
    await plots(page).selectOption("both");
    const [one, two, along, around] = words;
    const labels = (await captions(page).allTextContents()).map(
      (c) => c.split(/:| from /)[0],
    );
    expect(labels).toEqual([
      `${one} along ${along}`,
      `${two} along ${along}`,
      `${one} along ${around}`,
      `${two} along ${around}`,
    ]);
    // The choice outlasts a step across the columns.
    await page
      .locator(".spatial-probe input[type=range]")
      .nth(1)
      .press("ArrowLeft");
    await settled(page);
    await expect(plots(page)).toHaveValue("both");
    await expect(captions(page)).toHaveCount(4);
  });

// An offset: the patch's normal moved by d, here the torus's.
test("a torus's offset plots both ways", async ({ page }) => {
  await ready(page);
  await choosePreset(page, { label: "A torus revealing its centers" });
  await settled(page);
  await page
    .getByRole("textbox", { name: "Offset d", exact: true })
    .fill("0.2");
  await settled(page);
  await page.getByLabel("Describe", { exact: true }).selectOption("offset");
  await curvatureSwitch(page).check();
  await settled(page);
  await plots(page).selectOption("around");
  // The offset torus has tube radius r + d = 1: κ₂ = −1 everywhere, and
  // κ₁ = −cos v/(2 + cos v).
  await expect(captions(page)).toHaveText([
    `κ₁ along v from ${short(-1 / 3)} to ${short(-0.5 / 2.5)}`,
    "κ₂ along v: constant at -1",
  ]);
});

// The choice travels with the study.
test("a link carries the plots across the columns", async ({
  page,
  browser,
}) => {
  await ready(page);
  await choosePreset(page, { label: "A torus revealing its centers" });
  await settled(page);
  await curvatureSwitch(page).check();
  await settled(page);
  await plots(page).selectOption("both");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const other = await context.newPage();
  await other.goto(link);
  await settled(other);
  await expect(plots(other)).toHaveValue("both");
  await expect(captions(other)).toHaveCount(4);
  await context.close();
});

// The ellipsoid (1.5, 1, 0.7) on its meridian u = 2π, in the plane of its
// longest and shortest axes. Its umbilic there has κ₁ = κ₂ = −ac/b³; the
// probe opens on column 49, within 2·10⁻³ of it in v. At the equator, the
// point (a, 0, 0), the curvatures are −a/b² and −a/c².
test("an ellipsoid's curvatures meet at an umbilic down its meridian", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, { label: "Where an ellipsoid's curvatures meet" });
  await settled(page);
  await expect(curvatureSwitch(page)).toBeChecked();
  await expect(plots(page)).toHaveValue("both");
  await expect(slider(page, "Along u")).toHaveAttribute(
    "aria-valuetext",
    "u = 6.283, row 135 of 150",
  );
  await expect(slider(page, "Along v")).toHaveAttribute(
    "aria-valuetext",
    "v = 0.5672, column 49 of 72",
  );
  const [a, b, c] = [1.5, 1, 0.7];
  const k = async () =>
    (await page.locator(".probe-readout dd").allTextContents())
      .slice(0, 2)
      .map(Number);
  const [k1, k2] = await k();
  expect(Math.abs(k1 - (-a * c) / b ** 3)).toBeLessThan(0.01);
  expect(Math.abs(k2 - (-a * c) / b ** 3)).toBeLessThan(0.01);
  await expect(captions(page)).toHaveCount(4);
  await slider(page, "Along v").fill("36");
  await expect(page.locator(".probe-readout dd").first()).toHaveText(
    short(-a / b ** 2),
  );
  await expect(page.locator(".probe-readout dd").nth(1)).toHaveText(
    short(-a / c ** 2),
  );
});
