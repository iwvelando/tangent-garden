import { test, expect, type Page, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { journeys, journeyStudy, type StudyJourney } from "../web/journeys";
import { presetStudy } from "../web/tesseract/link";
import { tesseractPresets } from "../web/tesseract/presets";
import { sample } from "../web/tesseract/types";
import { progressAt } from "../web/timing";
import { choosePreset, examplesButton, exportImage, open } from "./helpers";
import { copiedStudy, gallery, settled } from "./gallery-helpers";
import { decodeVideo, frameDifference, probe } from "./video";
import { raster } from "./cell24-helpers";

const title = "When a crystal meets its dual";
const names = [
  "Into the crystal",
  "Cube within a cube, and its dual",
  "A tesseract meeting its dual",
];
const labels = ["Selected cell", "Selected cube", "Slice offset h"];
const index = (name: string) => {
  const i = tesseractPresets.findIndex((p) => p.name === name);
  expect(i).toBeGreaterThanOrEqual(0);
  return i;
};
const crystal = () => {
  const journey = journeys.find((j) => j.title === title);
  expect(journey).toBeDefined();
  return journey as StudyJourney;
};

test("crystal comparison declares exactly one descriptor experiment per existing study", () => {
  const { steps } = crystal();
  expect(steps.map((s) => [s.notebook, s.preset])).toEqual(
    names.map((name) => ["4d", index(name)]),
  );
  expect(steps.map((s) => s.control)).toEqual([
    { kind: "selection", label: "Selected cell" },
    { kind: "selection", label: "Selected cube" },
    { kind: "scalar", label: "Slice offset h", path: ["slice"] },
  ]);
  expect(steps[0].note).toMatch(/self-dual/);
  expect(steps[1].note).toMatch(/tetrahedra/);
  expect(steps[2].note).toMatch(/cuboctahedron/);
  expect(steps[2].note).toMatch(/cube/);
});

test("crystal comparison edits preserve exact whole studies and native motion without mutating examples", () => {
  const original = structuredClone(tesseractPresets);
  for (const [i, step] of crystal().steps.entries()) {
    const expected = presetStudy(index(names[i]));
    expect(journeyStudy(step)).toEqual(expected);
    const value = i === 0 ? 23 : i === 1 ? 7 : 0.25;
    if (i === 0) expected.config.cell24!.selected = value;
    else if (i === 1) expected.config.cell16!.selected = value;
    else expected.config.slice = value;
    expect(journeyStudy(step, value)).toEqual(expected);
    expect(expected.motion).toBe(i === 2 ? "crystal" : "double");
    expect(expected.repeat).toBe("loop");
  }
  expect(tesseractPresets).toEqual(original);
  for (const [i, count] of [24, 8].entries())
    for (const value of [-1, count, 0.5, "1", NaN, Infinity])
      expect(() => journeyStudy(crystal().steps[i], value)).toThrow(labels[i]);
});

const art = (scope: Locator) => scope.locator("svg[data-representation]");
const metadata = async (scope: Locator) =>
  JSON.parse((await art(scope).locator(":scope > desc").textContent())!);
const ready = (dialog: Locator) =>
  expect(dialog.locator(".journey-art")).toHaveAttribute("aria-busy", "false");
async function enter(page: Page, stop = 0) {
  await examplesButton(page).click();
  await gallery(page).getByRole("button", { name: title, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: title, exact: true });
  await ready(dialog);
  for (let i = 0; i < stop; i++) await next(dialog, i + 1);
  return dialog;
}
async function next(dialog: Locator, i: number) {
  await dialog.getByRole("button", { name: "Next step", exact: true }).click();
  await expect(dialog.locator(".journey-step")).toHaveText(
    `Step ${i + 1} of 3`,
  );
  await ready(dialog);
}
const experiment = (scope: Locator, i: number) =>
  scope.getByRole(i === 2 ? "textbox" : "spinbutton", {
    name: labels[i],
    exact: true,
  });

for (const i of [0, 1])
  test(`crystal selection ${i + 1} uses returned incidence, pointer and keyboard selection and cancels motion`, async ({
    page,
  }) => {
    await page.goto("/");
    await settled(page);
    const dialog = await enter(page, i);
    const field = experiment(dialog, i);
    const count = i === 0 ? 24 : 8;
    const prefix = i === 0 ? "cell24" : "cell16";
    await expect(field).toHaveAttribute("max", String(count));
    const m = await metadata(dialog);
    expect(m.config.mode).toBe("perspective");
    expect(m.polytope.cellVertices).toHaveLength(i === 0 ? 6 : 8);
    await expect(art(dialog).locator('path[data-role="cell"]')).toHaveCount(12);
    await expect(art(dialog).locator('path[data-role="diagonal"]')).toHaveCount(
      i === 0 ? 3 : 4,
    );
    await expect(art(dialog).locator('path[data-role="spoke"]')).toHaveCount(
      i === 0 ? 8 : 6,
    );
    const point = await art(dialog)
      .locator(`g[data-marker="${prefix}/dual/vertex/0"] circle:last-child`)
      .evaluate((c) => {
        const m = (c as SVGCircleElement).ownerSVGElement!.getScreenCTM()!;
        const x = Number(c.getAttribute("cx")),
          y = Number(c.getAttribute("cy"));
        return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
      });
    await page.mouse.click(point.x, point.y);
    await expect(field).toHaveValue("1");
    await expect
      .poll(async () => (await metadata(dialog)).polytope.selectedCell)
      .toBe(0);
    await field.fill(String(count));
    await expect
      .poll(async () => (await metadata(dialog)).polytope.selectedCell)
      .toBe(count - 1);
    await art(dialog).focus();
    await page.keyboard.press("]");
    await expect(field).toHaveValue("1");
    await page.keyboard.press("[");
    await expect(field).toHaveValue(String(count));
    await dialog
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    const progress = dialog.getByLabel("Animation progress", { exact: true });
    await expect
      .poll(async () => Number(await progress.inputValue()))
      .toBeGreaterThan(0.01);
    await field.fill("2");
    await expect(progress).toHaveValue("0");
    await expect(
      dialog.getByRole("button", { name: "Pause", exact: true }),
    ).toHaveCount(0);
    await expect
      .poll(async () => (await metadata(dialog)).polytope.selectedCell)
      .toBe(1);
    await field.fill(String(count + 1));
    await expect(field).toHaveValue("2");
    await art(dialog).focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("+");
    const moved = await metadata(dialog);
    expect(moved.view.yaw).not.toBe(m.view.yaw);
    expect(moved.view.zoom).toBeGreaterThan(m.view.zoom);
  });

test("the genuine section is an octahedron and cuboctahedron; edits, refusals, revisit, backward seek and Stop preserve its still", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  const dialog = await enter(page, 2);
  const original = await metadata(dialog);
  expect(
    original.sections.map((s: any) => [s.kind, s.vertices, s.edges, s.faces]),
  ).toEqual([
    ["primal", 6, 12, 8],
    ["dual", 12, 24, 14],
  ]);
  const field = experiment(dialog, 2);
  await field.fill("1/4");
  await expect
    .poll(async () => (await metadata(dialog)).config.slice)
    .toBe(0.25);
  await field.fill("4.1");
  await expect(dialog.locator(".field-error")).toContainText("4.05");
  await expect(
    dialog.getByRole("button", { name: "Open study", exact: true }),
  ).toBeDisabled();
  await field.fill("0");
  await ready(dialog);
  await dialog
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Pause", exact: true }).click();
  const progress = dialog.getByLabel("Animation progress", { exact: true });
  const frames = [];
  for (const t of [0.3, 0.5, 0.3]) {
    await progress.fill(String(t));
    const study = presetStudy(index(names[2]));
    const config = sample(
      study.config,
      study.motion,
      progressAt(t, study.repeat, study.pace),
    );
    await expect
      .poll(async () => (await metadata(dialog)).config.slice)
      .toBe(config.slice);
    frames.push(await metadata(dialog));
  }
  expect(frames[0]).toEqual(frames[2]);
  await dialog.getByRole("button", { name: "Stop", exact: true }).click();
  await expect.poll(() => metadata(dialog)).toEqual(original);
  await field.fill("1/4");
  await expect
    .poll(async () => (await metadata(dialog)).config.slice)
    .toBe(0.25);
  await dialog
    .getByRole("button", { name: "Previous step", exact: true })
    .click();
  await expect(dialog.locator(".journey-step")).toHaveText("Step 2 of 3");
  await next(dialog, 2);
  await expect(field).toHaveValue("1/4");
  await expect
    .poll(async () => (await metadata(dialog)).config.slice)
    .toBe(0.25);
});

for (const i of [0, 1, 2])
  test(`adopted crystal stop ${i + 1} equals an ordinary edit, link and SVG`, async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const native = await context.newPage();
    await native.goto("/?study=4d");
    await choosePreset(native, { label: names[i] });
    await settled(native);
    await experiment(native.locator(".app:visible"), i).fill(
      i === 2 ? "1/4" : "7",
    );
    const expected = await copiedStudy(native);
    await native.close();
    await page.goto("/");
    await settled(page);
    const dialog = await enter(page, i);
    await experiment(dialog, i).fill(i === 2 ? "1/4" : "7");
    await ready(dialog);
    await dialog
      .getByRole("button", { name: "Open study", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await settled(page);
    await expect(page.locator(".app:visible .example-current")).toHaveText(
      "Custom study",
    );
    const adopted = await copiedStudy(page);
    expect(adopted.study).toEqual(expected.study);
    const download = page.waitForEvent("download");
    await exportImage(page, "SVG");
    const svg = await readFile((await (await download).path())!, "utf8");
    expect(svg).not.toMatch(/<text|<foreignObject/);
    const meta = JSON.parse(
      svg.match(/<desc>([^<]*)<\/desc>/)![1].replace(/&quot;/g, '"'),
    );
    expect(meta.config).toEqual((adopted.study as any).config);
    await page.goto("about:blank");
    await page.goto(adopted.url);
    await settled(page);
    expect((await copiedStudy(page)).study).toEqual(expected.study);
  });

for (const colorScheme of ["light", "dark"] as const)
  for (const viewport of [
    { width: 1280, height: 600 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ])
    test(`crystal walkthrough in ${colorScheme} at ${viewport.width}x${viewport.height}`, async ({
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
      const places = [];
      for (let i = 0; i < 3; i++) {
        await expect(
          dialog.getByRole("heading", { name: names[i], exact: true }),
        ).toBeVisible();
        places.push(
          await dialog.evaluate((d) => {
            const r = d
              .querySelector(".journey-navigation")!
              .getBoundingClientRect();
            return [r.x + d.scrollLeft, r.y + d.scrollTop, r.width, r.height];
          }),
        );
        await expect(
          dialog.locator('.journey-control[data-current="true"] input'),
        ).toHaveCount(1);
        await expect(
          dialog.getByRole("button", { name: "Pause", exact: true }),
        ).toHaveCount(0);
        await expect(art(dialog).locator("text, foreignObject")).toHaveCount(0);
        for (const target of [
          experiment(dialog, i),
          dialog.getByRole("button", { name: "Play animation", exact: true }),
          dialog.getByRole("button", { name: "Open study", exact: true }),
        ]) {
          // Follow real keyboard navigation: a delayed focus reveal must
          // track the target being inspected, not the preceding field.
          await target.focus();
          await target.scrollIntoViewIfNeeded();
          await expect(target).toBeInViewport({ ratio: 1 });
        }
        await experiment(dialog, i).fill(i === 2 ? "1/4" : "7");
        await ready(dialog);
        await dialog.screenshot({ path: info.outputPath(`crystal-${i}.png`) });
        if (i < 2) await next(dialog, i + 1);
      }
      for (const place of places)
        place.forEach((n, i) =>
          expect(Math.abs(n - places[0][i])).toBeLessThanOrEqual(1),
        );
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(examplesButton(page)).toBeFocused();
    });

test("an adopted cube selection exports a timed, independently decoded native rotation", async ({
  page,
}, info) => {
  await page.goto("/");
  await settled(page);
  const dialog = await enter(page, 1);
  await experiment(dialog, 1).fill("7");
  await ready(dialog);
  await dialog.getByRole("button", { name: "Open study", exact: true }).click();
  await expect(dialog).toBeHidden();
  await settled(page);
  const reference = await raster(page, 1000, 760);
  const app = page.locator(".app:visible");
  await open(page, "#shape-animation-section");
  await app.getByLabel("Duration (seconds)", { exact: true }).fill("0.4");
  await open(page, "#shape-export-settings");
  await app.getByLabel("Export resolution", { exact: true }).fill("1");
  await app.getByLabel("Export frame rate", { exact: true }).selectOption("15");
  await app.getByLabel("Export format", { exact: true }).selectOption("mp4");
  await app.getByLabel("Export quality", { exact: true }).fill("100");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Export MP4 video/ }).click();
  const file = await download;
  await file.saveAs(info.outputPath("cube-rotation.mp4"));
  const path = (await file.path())!;
  const decoded = await decodeVideo(page, await readFile(path));
  expect(decoded.duration).toBeCloseTo(0.4, 3);
  expect(decoded.first.ink).toBeGreaterThan(100);
  expect(decoded.last.ink).toBeGreaterThan(100);
  expect(decoded.first.hash).not.toBe(decoded.last.hash);
  const demuxed = probe(path);
  if (demuxed) {
    expect([demuxed.width, demuxed.height, demuxed.frames]).toEqual([
      1000, 760, 6,
    ]);
    expect(demuxed.durations.reduce((a, b) => a + b, 0)).toBe(400);
  }
  const difference = frameDifference(path, 1000, 760, 0, reference);
  if (difference) {
    expect(difference.meanDifference).toBeLessThan(6);
    expect(difference.unmatchedInk).toBeLessThan(0.02);
  }
});
