import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { tesseractPresets } from "../web/tesseract/presets";
import { fieldLabel } from "../web/tesseract/fields";
import type { TesseractStudy } from "../web/tesseract/link";
import { initialView, type Config } from "../web/tesseract/types";
import { studyHref, writeStudyLink } from "../web/study-link";
import { choosePreset } from "./helpers";

// An error is shown where it can be fixed: under the control it names,
// marked invalid, as the page's one alert. The drawing keeps the previous
// valid study, marked as such, as the 3D notebook does.
const stage = (page: Page) => page.locator(".tesseract-stage");
const textbox = (page: Page, name: string) =>
  page.getByRole("textbox", { name, exact: true });
const control = (page: Page, name: string) =>
  page.getByLabel(name, { exact: true });
const fieldOf = (page: Page, name: string) =>
  page.locator(".field").filter({ has: control(page, name) });
async function settled(page: Page) {
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
}
const preset = (name: string) =>
  String(tesseractPresets.findIndex((p) => p.name === name));
async function shownAt(page: Page, name: string, text: string | RegExp) {
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(fieldOf(page, name).getByRole("alert")).toContainText(text);
  await expect(control(page, name)).toHaveAttribute("aria-invalid", "true");
  await expect(fieldOf(page, name).getByRole("alert")).toBeInViewport({
    ratio: 1,
  });
  await expect(page.locator("#tesseract-artwork")).toBeVisible();
  await expect(stage(page).locator(".stale-study")).toHaveText(
    "Previous valid study",
  );
  await expect(stage(page).locator(".error")).toHaveCount(0);
}

for (const [width, height] of [
  [1440, 1000],
  [390, 844],
] as const)
  test(`an engine error appears under the field it names (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/?study=4d");
    await choosePreset(page, preset("Beside the wall"));
    await settled(page);
    // Its pair neighbour does not move: compared with the field itself,
    // since the page may scroll to bring the error into view.
    const offset = async () => {
      const a = (await textbox(page, "Inner radius a").boundingBox())!;
      const b = (await textbox(page, "Outer radius b").boundingBox())!;
      return [a.x - b.x, a.y - b.y, a.width, a.height];
    };
    const before = await offset();
    await textbox(page, "Outer radius b").fill("0.5");
    await shownAt(page, "Outer radius b", "must exceed a");
    expect(await offset()).toEqual(before);
    await textbox(page, "Outer radius b").fill("2");
    await settled(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(control(page, "Outer radius b")).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

test("a constant that does not parse is shown under its field", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?study=4d");
  await settled(page);
  await textbox(page, "xw angle").fill("t");
  await shownAt(page, "xw angle", /t/);
});

test("an error naming no field appears under the control just changed", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  await choosePreset(page, preset("Beside the wall"));
  await settled(page);
  // The outside point's radius must exceed b: a limit of the two together.
  await textbox(page, "Outer radius b").fill("4");
  await shownAt(page, "Outer radius b", "Outside point radius");
});

// Every field the engine names in a validation error has a control that
// shows the error: each study is opened from a link, with one field out of
// range, and its error must stand under the control with this label. The
// labels are written out here, not derived from the notebook's own table
// (web/tesseract/fields.ts).
type Case = [
  field: string,
  preset: (c: Config) => boolean,
  change: (c: Config) => void,
  label: string,
];
const object = (o: Config["object"], mode?: Config["mode"]) => (c: Config) =>
  c.object === o && (!mode || c.mode === mode);
const cases: Case[] = [
  [
    "angles.4",
    object("tesseract", "perspective"),
    (c) => (c.angles[4] = 2e6),
    "yw angle",
  ],
  [
    "distance",
    object("tesseract", "perspective"),
    (c) => (c.distance = 2),
    "4D eye distance",
  ],
  [
    "grid",
    object("tesseract", "perspective"),
    (c) => (c.grid = 13),
    "Face grid lines",
  ],
  [
    "clip",
    object("tesseract", "stereo"),
    (c) => (c.clip = 1),
    "Projection window radius",
  ],
  [
    "samples",
    object("tesseract", "stereo"),
    (c) => (c.samples = 7),
    "Arc samples",
  ],
  [
    "slice",
    object("tesseract", "section"),
    (c) => (c.slice = 4.1),
    "Slice offset h",
  ],
  [
    "spread",
    object("tesseract", "section"),
    (c) => (c.spread = 5),
    "Section spread",
  ],
  [
    "count",
    object("tesseract", "section"),
    (c) => (c.count = 26),
    "Section count",
  ],
  ["radius", object("ball"), (c) => (c.radius = 0), "4-ball radius R"],
  ["tube", object("tube"), (c) => (c.tube = 9), "Tube radius r"],
  ["curves", object("ball"), (c) => (c.curves = 2), "Curves per direction"],
  // Whole-number counts are checked in the worker, before Go.
  ["curves", object("ball"), (c) => (c.curves = 4.5), "Curves per direction"],
  ["samples", object("lift"), (c) => (c.samples = 40.5), "Thread samples"],
  ["count", object("weave"), (c) => (c.count = 2.5), "Latitudes"],
  ["samples", object("tube"), (c) => (c.samples = 300), "Curve samples"],
  ["slice", object("ball"), (c) => (c.slice = 99), "Slice offset h"],
  ["count", object("tube"), (c) => (c.count = 0), "Section count"],
  [
    "lift.center.1",
    object("lift"),
    (c) => (c.lift!.center[1] = 21),
    "Lift center y",
  ],
  [
    "lift.support",
    object("lift"),
    (c) => (c.lift!.support = 0),
    "Lift support radius L",
  ],
  [
    "lift.height",
    object("lift"),
    (c) => (c.lift!.height = 11),
    "Lift height A",
  ],
  ["lift.to.0", object("lift"), (c) => (c.lift!.to[0] = -30), "Drift end x"],
  [
    "lift.radiusFrom",
    object("lift"),
    (c) => (c.lift!.radiusFrom = 21),
    "Support start",
  ],
  ["samples", object("lift"), (c) => (c.samples = 7), "Thread samples"],
  [
    "bypass.inner",
    object("bypass"),
    (c) => (c.bypass!.inner = 0),
    "Inner radius a",
  ],
  [
    "bypass.extent",
    object("bypass"),
    (c) => (c.bypass!.extent = 6),
    "Fourth-coordinate extent ε",
  ],
  [
    "bypass.height",
    object("bypass"),
    (c) => (c.bypass!.height = -1),
    "Route height H",
  ],
  [
    "bypass.position",
    object("bypass"),
    (c) => (c.bypass!.position = 2),
    "Route position s",
  ],
  [
    "bypass.outside.2",
    object("bypass"),
    (c) => (c.bypass!.outside[2] = 21),
    "Outside point z",
  ],
  [
    "bypass.w2",
    object("bypass"),
    (c) => (c.bypass!.w2 = 21),
    "Second comparison w",
  ],
  ["samples", object("bypass"), (c) => (c.samples = 300), "Shell samples"],
  ["count", object("weave"), (c) => (c.count = 10), "Latitudes"],
  [
    "curves",
    (c) => c.weave?.family === "tori",
    (c) => (c.curves = 0),
    "Curves per direction",
  ],
  [
    "curves",
    (c) => c.weave?.family === "fibers",
    (c) => (c.curves = 17),
    "Fibers per latitude",
  ],
  ["samples", object("weave"), (c) => (c.samples = 7), "Arc samples"],
  ["clip", object("weave"), (c) => (c.clip = 13), "Projection window radius"],
  [
    "weave.spread",
    (c) => c.object === "weave" && c.count > 1,
    (c) => (c.weave!.spread = 2),
    "Latitude spread",
  ],
  [
    "weave.alpha",
    object("weave"),
    (c) => (c.weave!.alpha = 1.6),
    "Central latitude α",
  ],
  [
    "weave.alphaTo",
    object("weave"),
    (c) => (c.weave!.alphaTo = 1.6),
    "Latitude end",
  ],
  ["angles.3", object("weave"), (c) => (c.angles[3] = 2e6), "xw angle"],
];

const study = (config: Config, motion: TesseractStudy["motion"]) =>
  ({
    config,
    layers: { edges: true, guides: true, faces: true, selectedSection: 0 },
    view: initialView,
    diagramView: initialView,
    motion,
    duration: 12,
  }) satisfies TesseractStudy;

test("validation errors stand under the control they name", async ({
  page,
}) => {
  test.setTimeout(120_000);
  for (const [path, which, change, label] of cases) {
    const found = tesseractPresets.find((p) => which(p.config));
    expect(found, path).toBeDefined();
    const config = structuredClone(found!.config);
    change(config);
    const token = await writeStudyLink("4d", study(config, found!.motion));
    await page.goto("about:blank");
    await page.goto(
      studyHref("http://localhost/?study=4d", "4d", token).replace(
        "http://localhost",
        "",
      ),
    );
    await expect(page.getByRole("alert"), path).toHaveCount(1);
    const field = page.locator(".field").filter({
      has: page.locator(".field-label > label").getByText(label, {
        exact: true,
      }),
    });
    await expect(
      field.getByRole("alert"),
      `${path} under ${label}`,
    ).toHaveCount(1);
    await expect(
      field.locator("input, select, textarea").first(),
      path,
    ).toHaveAttribute("aria-invalid", "true");
  }
});

// Every field the engine's own validation table names (engine4's
// fielderror_test.go) has a control, for the object it belongs to.
test("every field the engine names has a control", () => {
  const go = readFileSync("engine4/fielderror_test.go", "utf8");
  const rows = [
    ...go.matchAll(
      /^\t\t\{"([^"]+)", "([^"]+)", func\(\) Request \{ (?:q := )?(\w+)/gm,
    ),
  ];
  expect(rows.length).toBeGreaterThan(40);
  const builders: Record<string, Config["object"]> = {
    request: "tesseract",
    section: "tesseract",
    curvedRequest: "ball",
    weaving: "weave",
    lift: "lift",
    route: "bypass",
  };
  for (const [, name, path, builder] of rows) {
    const o =
      /curvedRequest/.test(builder) && /tube/.test(name)
        ? "tube"
        : builders[builder];
    expect(o, name).toBeDefined();
    const config = structuredClone(
      tesseractPresets.find((p) => p.config.object === o)!.config,
    );
    expect(fieldLabel(config, path), `${name}: ${path}`).toEqual(
      expect.any(String),
    );
  }
});

const openedStudy = async (
  page: Page,
  which: (c: Config) => boolean,
  change: (c: Config) => void,
) => {
  const found = tesseractPresets.find((p) => which(p.config))!;
  const config = structuredClone(found.config);
  change(config);
  const token = await writeStudyLink("4d", study(config, found.motion));
  await page.goto(
    studyHref("http://localhost/?study=4d", "4d", token).replace(
      "http://localhost",
      "",
    ),
  );
};

// With no valid study yet, the drawing asks for one.
test("a study opened invalid asks for its definition", async ({ page }) => {
  await openedStudy(page, object("bypass"), (c) => (c.bypass!.inner = 0));
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(fieldOf(page, "Inner radius a").getByRole("alert")).toHaveCount(
    1,
  );
  await expect(stage(page)).toContainText(
    "Check the study definition to begin.",
  );
  await expect(stage(page).getByRole("alert")).toHaveCount(0);
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
    await openedStudy(
      page,
      object("bypass"),
      (c) => (c.bypass!.outside = [1.5, 0, 0]),
    );
    const alert = page.getByRole("alert");
    await expect(alert).toHaveCount(1);
    await expect(alert).toContainText("Outside point radius");
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
