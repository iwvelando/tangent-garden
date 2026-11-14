import { test, expect, type Page, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";
import * as journeys from "../web/journeys";
import { choosePreset, examplesButton, exportImage, open } from "./helpers";
import { decodeVideo, probe as videoProbe } from "./video";
import { copiedStudy, gallery, settled } from "./gallery-helpers";
import { decodePng } from "./png";
import { presetStudy } from "../web/tesseract/link";
import { tesseractPresets } from "../web/tesseract/presets";

// The Hopf-correspondence journey: one stop selects a point and its fiber,
// one changes the base path, and one edits an ordinary scalar. Its choice
// and selection come from the 4D object descriptor, never from titles.
const presetIndex = (name: string) => {
  const i = tesseractPresets.findIndex((p) => p.name === name);
  expect(i).toBeGreaterThanOrEqual(0);
  return i;
};
const latitude = presetIndex("A circle over every point");
const flower = presetIndex("A flower below, a bouquet above");
const flowing = presetIndex("Hopf circles, flowing forever");
const hopf = () => {
  const journey = journeys.journeys.find(
    (j) => j.title === "Every point owns a circle",
  );
  expect(journey).toBeDefined();
  return journey as journeys.StudyJourney;
};

test("the Hopf journey declares a selection, a descriptor choice and a scalar on existing presets", () => {
  const { steps } = hopf();
  expect(steps.map((s) => [s.notebook, s.preset])).toEqual([
    ["4d", latitude],
    ["4d", flower],
    ["4d", flowing],
  ]);
  expect(steps.map((s) => s.control)).toEqual([
    { kind: "selection", label: "Selected fiber" },
    { kind: "choice", label: "Base path", key: "path" },
    { kind: "scalar", label: "Latitude spread", path: ["weave", "spread"] },
  ]);
  // It follows the existing seven, which keep their order.
  expect(journeys.journeys.map((j) => j.title)).toEqual([
    "Light finding a cusp",
    "Threads becoming surfaces",
    "Order inside apparent chaos",
    "A glimpse of four dimensions",
    "What a shadow leaves out",
    "A thread learns the surface",
    "Rules that grow a garden",
    "Every point owns a circle",
    "When a crystal meets its dual",
  ]);
});

test("a selection edit changes only the selected fiber, as the notebook's selection does", () => {
  const step = hopf().steps[0];
  const preset = presetStudy(latitude);
  expect(journeys.journeyStudy(step)).toEqual(preset);
  const edited = journeys.journeyStudy(step, 7);
  expect(edited.config.weave!.selected).toBe(7);
  // Everything else is the preset's own study, including the motion that
  // then starts from the selected sample.
  expect({
    ...edited,
    config: {
      ...edited.config,
      weave: { ...edited.config.weave!, selected: 0 },
    },
  }).toEqual(preset);
  expect(edited.motion).toBe("trace");
  expect(edited.repeat).toBe("loop");
  // The last of twelve samples is the largest index; the edit does not
  // alter the preset descriptor's own study.
  expect(journeys.journeyStudy(step, 11).config.weave!.selected).toBe(11);
  expect(tesseractPresets[latitude].config.weave!.selected).toBe(0);
});

test("a selection outside the drawing's samples, fractional or textual, is refused rather than coerced", () => {
  const step = hopf().steps[0];
  for (const value of [12, -1, 1.5, Number.NaN, Infinity, "3"])
    expect(() => journeys.journeyStudy(step, value)).toThrow(/Selected fiber/);
});

test("a Base path choice switches the path as the notebook's select does and keeps the flower's own settings", () => {
  const step = hopf().steps[1];
  const preset = presetStudy(flower);
  expect(journeys.journeyStudy(step)).toEqual(preset);
  expect(journeys.journeyStudy(step, "flower")).toEqual(preset);
  const plain = journeys.journeyStudy(step, "latitude");
  expect(plain.config.weave).toEqual({
    ...preset.config.weave!,
    path: "latitude",
  });
  // The latitude ignores amplitude and petals but keeps them, so choosing
  // the flower again restores it exactly; the trace is offered on both.
  expect(plain.config.weave!.amplitude).toBe(Math.PI / 8);
  expect(plain.config.weave!.petals).toBe(5);
  expect(plain.motion).toBe("trace");
  expect(plain.repeat).toBe("loop");
  expect({ ...plain, config: preset.config }).toEqual(preset);
});

test("a choice outside the descriptor's values is refused, and a hidden choice cannot be a step", () => {
  const step = hopf().steps[1];
  for (const value of ["torus", "Latitude", "", 0, 1])
    expect(() => journeys.journeyStudy(step, value)).toThrow(/Base path/);
  // Weave family is hidden in Base sphere and fibers, so no step can offer
  // it; neither can a choice the object lacks, or a selection where the
  // descriptor shows none.
  expect(() =>
    journeys.shapeStep("A flower below, a bouquet above", "", "", {
      kind: "choice",
      key: "family",
    }),
  ).toThrow(/family/);
  expect(() =>
    journeys.shapeStep("A flower below, a bouquet above", "", "", {
      kind: "choice",
      key: "sheet",
    }),
  ).toThrow(/sheet/);
  expect(() =>
    journeys.shapeStep("Hopf circles, flowing forever", "", "", {
      kind: "selection",
    }),
  ).toThrow(/selection/);
});

test("an edit reconciles motion and repeat as the notebook does", () => {
  // A study holding Sweep latitudes on a latitude: the flower does not
  // offer it, so the first offered motion replaces it. A motion that does
  // not loop leaves Loop for Back and forth.
  const base = presetStudy(latitude);
  const sweeping = {
    ...base,
    motion: "latitude" as const,
    repeat: "loop" as const,
  };
  const toFlower = journeys.reconcileShapeStudy({
    ...sweeping,
    config: {
      ...sweeping.config,
      weave: { ...sweeping.config.weave!, path: "flower" },
    },
  });
  expect(toFlower.motion).toBe("trace");
  expect(toFlower.repeat).toBe("loop");
  const kept = journeys.reconcileShapeStudy(sweeping);
  expect(kept.motion).toBe("latitude");
  expect(kept.repeat).toBe("back-and-forth");
  // A selection beyond a reduced count is brought within it.
  const reduced = journeys.reconcileShapeStudy({
    ...base,
    config: {
      ...base.config,
      curves: 4,
      weave: { ...base.config.weave!, selected: 9 },
    },
  });
  expect(reduced.config.weave!.selected).toBe(3);
  expect(journeys.reconcileShapeStudy(base)).toEqual(base);
});

test("the existing journeys' studies are unchanged by the new experiment kinds", () => {
  for (const journey of journeys.journeys)
    if (
      journey.kind === undefined &&
      journey.title !== hopf().title &&
      journey.title !== "When a crystal meets its dual"
    )
      for (const step of journey.steps) {
        expect(["scalar", "probe"]).toContain(step.control.kind);
        const study = journeys.journeyStudy(step);
        expect(journeys.journeyStudy(step, undefined)).toEqual(study);
        if (step.control.kind !== "scalar") continue;
        const edited = journeys.journeyStudy(step, 0.375) as {
          config: Record<string, unknown>;
        };
        let at: unknown = edited.config;
        for (const key of step.control.path)
          at = (at as Record<string, unknown>)[key];
        expect(at).toBe(0.375);
      }
});

// The journey in the browser, through the same production paths as the
// 4D notebook's own Base sphere and fibers.
const title = "Every point owns a circle";
const preview = (page: Page) =>
  page.getByRole("dialog", { name: title, exact: true });
const ready = (dialog: Locator) =>
  expect(dialog.locator(".journey-art")).toHaveAttribute("aria-busy", "false");
async function enter(page: Page, step = 0) {
  await examplesButton(page).click();
  await gallery(page).getByRole("button", { name: title, exact: true }).click();
  const dialog = preview(page);
  await ready(dialog);
  for (let i = 0; i < step; i++) {
    await dialog
      .getByRole("button", { name: "Next step", exact: true })
      .click();
    await ready(dialog);
  }
  return dialog;
}
const pane = (scope: Page | Locator, mode: "base" | "stereo") =>
  scope.locator(`svg[data-representation="${mode}"]`);
// The pane's drawn correspondence, as its description records it.
const drawn = async (scope: Page | Locator, mode: "base" | "stereo") =>
  JSON.parse(
    (await pane(scope, mode).locator(":scope > desc").textContent()) ?? "{}",
  ).weave.correspondence;
// Which sample each pane draws in a role, such as moving or selected.
const role = (scope: Page | Locator, name: string) =>
  scope
    .locator(`[data-correspondence="${name}"]`)
    .evaluateAll((es) =>
      es.map((e) => [
        e
          .closest("svg[data-representation]")!
          .getAttribute("data-representation"),
        e.getAttribute("data-sample") ?? e.getAttribute("data-source"),
      ]),
    );
// A screen point on a drawn base marker's center or a fiber's vertex.
const pointOn = (scope: Locator, vertex = 0) =>
  scope.evaluate((e, vertex) => {
    const svg = (e as SVGElement).ownerSVGElement!;
    const m = svg.getScreenCTM()!;
    let x: number, y: number;
    if (e.tagName === "g") {
      const c = e.querySelector("circle:last-child") as SVGCircleElement;
      x = c.cx.baseVal.value;
      y = c.cy.baseVal.value;
    } else {
      const d = e
        .getAttribute("d")!
        .match(/-?\d+(?:\.\d+)?/g)!
        .map(Number);
      const i = Math.min(vertex, d.length / 2 - 1);
      x = d[2 * i];
      y = d[2 * i + 1];
    }
    return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
  }, vertex);
const selectedFiber = (scope: Page | Locator) =>
  scope.getByRole("spinbutton", { name: "Selected fiber", exact: true });

test("the selection stop edits one Selected fiber from the field, either pane and [ ], with the notebook's semantics", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await settled(page);
  const dialog = await enter(page);
  await expect(
    dialog.getByRole("heading", { name: "A circle over every point" }),
  ).toBeVisible();
  // One experiment: the descriptor's selection, a whole-number field.
  const control = dialog.locator('.journey-control[data-current="true"]');
  await expect(control.locator("input, select")).toHaveCount(1);
  await expect(selectedFiber(control)).toHaveValue("1");
  await expect(selectedFiber(control)).toHaveAttribute("min", "1");
  await expect(selectedFiber(control)).toHaveAttribute("max", "12");
  await expect(pane(dialog, "base")).toHaveCount(1);
  await expect(pane(dialog, "stereo")).toHaveCount(1);
  await expect(dialog.locator(".paired-view-labels span")).toHaveText([
    "1 / Base sphere S² (left)",
    "2 / Fibers in space (right)",
  ]);
  // The panes say how to select, as in the notebook.
  await expect(pane(dialog, "base")).toHaveAttribute(
    "aria-label",
    /Tap a point or fiber to select it; \[ and \] step the selection\./,
  );
  // A base point.
  const p4 = await pointOn(pane(dialog, "base").locator('g[data-sample="4"]'));
  await page.mouse.click(p4.x, p4.y);
  await ready(dialog);
  await expect(selectedFiber(dialog)).toHaveValue("5");
  expect((await drawn(dialog, "base")).selected).toBe(4);
  expect((await drawn(dialog, "stereo")).selected).toBe(4);
  // The still motion starts at the selected sample in both panes.
  expect(await role(dialog, "moving")).toEqual([
    ["base", "4"],
    ["stereo", "4"],
  ]);
  // Tapping it again keeps it.
  await page.mouse.click(p4.x, p4.y);
  await ready(dialog);
  await expect(selectedFiber(dialog)).toHaveValue("5");
  // A fiber, picked near one of its vertices.
  const p9 = await pointOn(
    pane(dialog, "stereo").locator('path[data-sample="9"]'),
    40,
  );
  await page.mouse.click(p9.x + 1, p9.y);
  await ready(dialog);
  await expect(selectedFiber(dialog)).toHaveValue("10");
  expect((await drawn(dialog, "base")).selected).toBe(9);
  // Keys step from the latest selection, wrapping, however quickly.
  await pane(dialog, "base").focus();
  await page.keyboard.press("]");
  await page.keyboard.press("]");
  await page.keyboard.press("]");
  await ready(dialog);
  await expect(selectedFiber(dialog)).toHaveValue("1");
  await page.keyboard.press("[");
  await ready(dialog);
  await expect(selectedFiber(dialog)).toHaveValue("12");
  expect((await drawn(dialog, "stereo")).selected).toBe(11);
  // The field. A number beyond the samples is not a selection: the field
  // keeps the last one, as the notebook's does.
  await selectedFiber(dialog).fill("3");
  await ready(dialog);
  expect((await drawn(dialog, "stereo")).selected).toBe(2);
  await selectedFiber(dialog).fill("13");
  await ready(dialog);
  await expect(selectedFiber(dialog)).toHaveValue("3");
  expect((await drawn(dialog, "stereo")).selected).toBe(2);
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Open study", exact: true }),
  ).toBeEnabled();
  await expect(dialog.locator(".journey-art text")).toHaveCount(0);
});

test("a selection edit during playback stops it at the new selection; revisits keep it and start still", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  const dialog = await enter(page);
  await dialog
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  const progress = dialog.getByLabel("Animation progress", { exact: true });
  await expect
    .poll(async () => Number(await progress.inputValue()))
    .toBeGreaterThan(0.02);
  await pane(dialog, "base").focus();
  await page.keyboard.press("]");
  await ready(dialog);
  await expect(
    dialog.getByRole("button", { name: "Pause", exact: true }),
  ).toHaveCount(0);
  await expect(progress).toHaveValue("0");
  await expect(selectedFiber(dialog)).toHaveValue("2");
  expect(await role(dialog, "moving")).toEqual([
    ["base", "1"],
    ["stereo", "1"],
  ]);
  // Away and back: the edit remains and nothing plays.
  await dialog.getByRole("button", { name: "Next step", exact: true }).click();
  await ready(dialog);
  await dialog
    .getByRole("button", { name: "Previous step", exact: true })
    .click();
  await ready(dialog);
  await expect(selectedFiber(dialog)).toHaveValue("2");
  expect((await drawn(dialog, "base")).selected).toBe(1);
  await expect(
    dialog.getByRole("button", { name: "Pause", exact: true }),
  ).toHaveCount(0);
});

test("the choice stop offers the descriptor's Base path, redraws the latitude, and restores the flower", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  const dialog = await enter(page, 1);
  await expect(
    dialog.getByRole("heading", { name: "A flower below, a bouquet above" }),
  ).toBeVisible();
  const control = dialog.locator('.journey-control[data-current="true"]');
  await expect(control.locator("input, select")).toHaveCount(1);
  const path = control.getByRole("combobox", {
    name: "Base path",
    exact: true,
  });
  await expect(path).toHaveValue("flower");
  await expect(path.locator("option")).toHaveText([
    "Latitude",
    "Spherical flower",
  ]);
  const opening = await drawn(dialog, "base");
  expect(opening).toMatchObject({ path: "flower", fibers: 20 });
  await path.selectOption("latitude");
  await ready(dialog);
  // The correspondence names only a flower path.
  const plain = await drawn(dialog, "base");
  expect(plain.path).toBeUndefined();
  expect(plain.fibers).toBe(20);
  await expect(pane(dialog, "base").locator("g[data-sample]")).toHaveCount(20);
  // The trace is offered on both paths; play it on the latitude.
  await dialog
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  const progress = dialog.getByLabel("Animation progress", { exact: true });
  await expect
    .poll(async () => Number(await progress.inputValue()))
    .toBeGreaterThan(0.02);
  await dialog.getByRole("button", { name: "Pause", exact: true }).click();
  await progress.fill("0.5");
  await expect(progress).toHaveValue("0.5");
  // Choosing again stops playback and restores the flower exactly.
  await path.selectOption("flower");
  await ready(dialog);
  await expect(progress).toHaveValue("0");
  expect(await drawn(dialog, "base")).toEqual(opening);
});

for (const item of [
  {
    step: 0,
    preset: "A circle over every point",
    edit: async (scope: Page | Locator) => selectedFiber(scope).fill("7"),
  },
  {
    step: 1,
    preset: "A flower below, a bouquet above",
    edit: async (scope: Page | Locator) =>
      scope
        .getByRole("combobox", { name: "Base path", exact: true })
        .selectOption("latitude"),
  },
])
  test(`adopting ${item.preset} equals the notebook's own edit, with both panes, image and history`, async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    // The independent edit is made in its own page, so the journey's
    // adoption below is the only thing that sets the 4D notebook's study
    // and example identity.
    const native = await context.newPage();
    await native.goto("/?study=4d");
    await choosePreset(native, { label: item.preset });
    await settled(native);
    await item.edit(native.locator(".app:visible"));
    await settled(native);
    await expect(native.locator(".app:visible .example-current")).toHaveText(
      "Custom study",
    );
    const expected = await copiedStudy(native);
    const plainDownload = native.waitForEvent("download");
    await exportImage(native, "PNG");
    const plain = decodePng(
      await readFile((await (await plainDownload).path())!),
    );
    await native.close();
    await page.goto("/");
    await settled(page);
    const source = await copiedStudy(page);
    const historyLength = await page.evaluate(() => history.length);
    const dialog = await enter(page, item.step);
    await item.edit(dialog);
    await ready(dialog);
    await dialog
      .getByRole("button", { name: "Open study", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await settled(page);
    expect(new URL(page.url()).searchParams.get("study")).toBe("4d");
    expect(await page.evaluate(() => history.length)).toBe(historyLength + 1);
    await expect(page.locator(".app:visible .example-current")).toHaveText(
      "Custom study",
    );
    expect((await copiedStudy(page)).study).toEqual(expected.study);
    await expect(pane(page, "base")).toHaveCount(1);
    await expect(pane(page, "stereo")).toHaveCount(1);
    const download = page.waitForEvent("download");
    await exportImage(page, "PNG");
    const png = decodePng(await readFile((await (await download).path())!));
    expect([png.width, png.height]).toEqual([plain.width, plain.height]);
    expect(Buffer.from(png.rgba).equals(Buffer.from(plain.rgba))).toBe(true);
    await page.goBack();
    await settled(page);
    expect((await copiedStudy(page)).study).toEqual(source.study);
  });

for (const colorScheme of ["light", "dark"] as const)
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ])
    test(`the Hopf journey keeps navigation steady and every control reachable in ${colorScheme} at ${viewport.width}x${viewport.height}`, async ({
      page,
    }, info) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.addInitScript(() =>
        localStorage.setItem("tangent-garden.color-scheme", "cobalt"),
      );
      await page.goto("/");
      await settled(page);
      const dialog = await enter(page);
      // The navigation's place in the scrolled dialog, at every step.
      const place = () =>
        dialog.evaluate((d) => {
          const r = d
            .querySelector(".journey-navigation")!
            .getBoundingClientRect();
          return [r.x + d.scrollLeft, r.y + d.scrollTop, r.width, r.height];
        });
      const places: number[][] = [];
      const stacked = viewport.width <= 700;
      for (let step = 0; step < 3; step++) {
        await ready(dialog);
        places.push(await place());
        // Still under reduced motion until Play.
        await expect(
          dialog.getByRole("button", { name: "Pause", exact: true }),
        ).toHaveCount(0);
        await expect(dialog.locator(".journey-art text")).toHaveCount(0);
        const control = dialog.locator('.journey-control[data-current="true"]');
        await expect(control.locator("input, select")).toHaveCount(1);
        expect(
          await dialog.evaluate((d) => d.scrollWidth - d.clientWidth),
        ).toBeLessThanOrEqual(0);
        if (step < 2) {
          await expect(pane(dialog, "base")).toHaveCount(1);
          await expect(dialog.locator(".paired-view-labels span")).toHaveText([
            `1 / Base sphere S² (${stacked ? "top" : "left"})`,
            `2 / Fibers in space (${stacked ? "bottom" : "right"})`,
          ]);
        }
        // The experiment, Play and Open study can all be reached.
        for (const target of [
          control.locator("input, select"),
          dialog.getByRole("button", { name: "Play animation", exact: true }),
          dialog.getByRole("button", { name: "Open study", exact: true }),
        ]) {
          await target.scrollIntoViewIfNeeded();
          const box = (await target.boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
          expect(box.y).toBeGreaterThanOrEqual(0);
          expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
        }
        // Keyboard operation of each experiment.
        if (step === 0) {
          await selectedFiber(dialog).focus();
          await page.keyboard.press("ArrowUp");
          await ready(dialog);
          await expect(selectedFiber(dialog)).toHaveValue("2");
          expect((await drawn(dialog, "stereo")).selected).toBe(1);
        } else if (step === 1) {
          await dialog
            .getByRole("combobox", { name: "Base path", exact: true })
            .selectOption("latitude");
          await ready(dialog);
          expect((await drawn(dialog, "base")).path).toBeUndefined();
        } else {
          await dialog
            .getByLabel("Latitude spread", { exact: true })
            .fill("1/8");
          await ready(dialog);
        }
        await expect(
          dialog.getByRole("button", { name: "Open study", exact: true }),
        ).toBeEnabled();
        await dialog.screenshot({ path: info.outputPath(`step-${step}.png`) });
        if (step < 2) {
          await dialog
            .getByRole("button", { name: "Next step", exact: true })
            .click();
        }
      }
      for (const place of places)
        place.forEach((n, i) =>
          expect(Math.abs(n - places[0][i])).toBeLessThanOrEqual(1),
        );
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(examplesButton(page)).toBeFocused();
    });

test("the adopted latitude exports an independently decoded motion that starts at the selected fiber", async ({
  page,
}, info) => {
  await page.goto("/");
  await settled(page);
  const dialog = await enter(page, 1);
  await dialog
    .getByRole("combobox", { name: "Base path", exact: true })
    .selectOption("latitude");
  await ready(dialog);
  await dialog.getByRole("button", { name: "Open study", exact: true }).click();
  await expect(dialog).toBeHidden();
  await settled(page);
  const app = page.locator(".app:visible");
  await expect(app.getByLabel("Base path", { exact: true })).toHaveValue(
    "latitude",
  );
  await expect(app.getByLabel("Selected fiber", { exact: true })).toHaveValue(
    "1",
  );
  // The adopted motion is the preset's trace, starting at the selection.
  expect(await role(page, "moving")).toEqual([
    ["base", "0"],
    ["stereo", "0"],
  ]);
  await app.getByLabel("Duration (seconds)", { exact: true }).fill("0.4");
  await open(page, "#shape-animation-section");
  await open(page, "#shape-export-settings");
  await app.getByLabel("Export resolution", { exact: true }).fill("1");
  await app.getByLabel("Export frame rate", { exact: true }).selectOption("15");
  await app.getByLabel("Export format", { exact: true }).selectOption("mp4");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Export MP4 video/ }).click();
  const file = await download;
  await file.saveAs(info.outputPath("latitude.mp4"));
  const path = (await file.path())!;
  const decoded = await decodeVideo(page, await readFile(path));
  expect(decoded.duration).toBeCloseTo(0.4, 3);
  expect(decoded.last.ink).toBeGreaterThan(100);
  const demuxed = videoProbe(path);
  // A looping trace drops its repeated last frame.
  if (demuxed) expect(demuxed.durations.reduce((a, b) => a + b, 0)).toBe(400);
});
