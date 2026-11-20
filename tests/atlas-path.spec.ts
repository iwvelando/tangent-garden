import { test, expect, type Page } from "@playwright/test";
import { deflateRawSync } from "node:zlib";
import { presets } from "../web/presets";
import type { Config } from "../web/types";
import type { PlanarStudy } from "../web/planar-link";
import { copiedStudy, openAtlas, settled } from "./gallery-helpers";
import {
  choosePreset,
  exportImage,
  openAnimation,
  openExportSettings,
} from "./helpers";
import { decodeVideo, frameDifference, probe } from "./video";
import { decodePng } from "./png";
import { readFile } from "node:fs/promises";
import { exportTiming } from "../web/export-quality";

// A bounded path through atlas cells becomes an ordinary phrase: its stops,
// limits and phases (web/atlas-path.ts), and each notebook's mapping from
// atlas axes to phrase parameters (docs/architecture.md, Reversible
// parameter atlas).

const presetIndex = (title: string) => {
  const index = presets.findIndex((p) => p.title === title);
  expect(index, title).toBeGreaterThanOrEqual(0);
  return index;
};
const planar = (title: string): Config =>
  structuredClone(presets[presetIndex(title)].config);
// A 3 × 3 grid's cells, row-major: x across columns, y down rows.
const grid = (xs: number[], ys: number[]) =>
  ys.flatMap((y) =>
    xs.map((x) => ({ values: [x, y] as [number, number], frame: {} })),
  );

test("stops are added within 12, never twice in a row, and removed or cleared", async () => {
  const { addStop, removeStop, emptyPath, maxPathStops } =
    await import("../web/atlas-path");
  expect(maxPathStops).toBe(12);
  let path = emptyPath();
  expect(path).toEqual({ stops: [], closed: false, seconds: 2 });
  path = addStop(path, 4);
  // The same cell again is not a move.
  expect(addStop(path, 4)).toBe(path);
  path = addStop(addStop(path, 0), 4);
  expect(path.stops).toEqual([4, 0, 4]);
  for (let i = 0; i < 20; i++) path = addStop(path, i % 2 ? 1 : 2);
  expect(path.stops).toHaveLength(12);
  expect(addStop(path, 7)).toBe(path);
  expect(removeStop(path, 0).stops).toEqual(path.stops.slice(1));
  expect(removeStop(path, 99)).toBe(path);
  // Removing a stop between two equal neighbors leaves no zero move.
  expect(removeStop({ ...emptyPath(), stops: [3, 5, 3, 8] }, 1).stops).toEqual([
    3, 8,
  ]);
  expect(removeStop({ ...emptyPath(), stops: [3, 5, 3] }, 1).stops).toEqual([
    3,
  ]);
});

test("a path's phases move to each stop's exact values and hold an unchanged axis", async () => {
  const { pathTimeline, pathError, emptyPath } =
    await import("../web/atlas-path");
  const cells = grid([0.75, 1, 1.25], [-0.5, 0, 0.1 + 0.2]);
  const path = { ...emptyPath(), stops: [0, 1, 4, 3], seconds: 1.5 };
  expect(pathError(path, cells)).toBeNull();
  const timeline = pathTimeline(path, cells, ["sourceX", "sourceY"]);
  expect(timeline).toEqual({
    target: "sourceX",
    also: ["sourceY"],
    phases: [
      { name: "To stop 2", duration: 1.5, pace: "ease", key: "1" },
      {
        name: "To stop 3",
        duration: 1.5,
        pace: "ease",
        keys: { sourceY: "0" },
      },
      { name: "To stop 4", duration: 1.5, pace: "ease", key: "0.75" },
    ],
  });
  // Every key reads back as the cell's own number, binary tail included.
  const tail = pathTimeline({ ...path, stops: [0, 8] }, cells, ["u", "v"]);
  expect(tail.phases[0]).toMatchObject({
    key: "1.25",
    keys: { v: String(0.1 + 0.2) },
  });
  expect(Number(tail.phases[0].keys!.v)).toBe(0.1 + 0.2);
  // Negative zero keeps its sign.
  const zero = grid([-0, 1, 2], [0, 1, 2]);
  expect(
    pathTimeline({ ...path, stops: [1, 0] }, zero, ["u", "v"]).phases[0].key,
  ).toBe("-0");
});

test("returning to the first stop closes the loop exactly and only once", async () => {
  const { pathTimeline, pathCloses, emptyPath, maxPathStops } =
    await import("../web/atlas-path");
  const cells = grid([1, 2, 3], [4, 5, 6]);
  const open = { ...emptyPath(), stops: [0, 4, 8] };
  expect(pathCloses(open)).toBe(false);
  const closed = { ...open, closed: true };
  expect(pathCloses(closed)).toBe(true);
  const phases = pathTimeline(closed, cells, ["u", "v"]).phases;
  expect(phases.map((p) => p.name)).toEqual([
    "To stop 2",
    "To stop 3",
    "Return to stop 1",
  ]);
  expect(phases.at(-1)).toMatchObject({ key: "1", keys: { v: "4" } });
  // A path that already ends where it began adds no return.
  const back = { ...emptyPath(), stops: [0, 4, 0], closed: true };
  expect(pathCloses(back)).toBe(true);
  // It closes whether or not the return is also chosen.
  expect(pathCloses({ ...back, closed: false })).toBe(true);
  expect(pathTimeline(back, cells, ["u", "v"]).phases).toHaveLength(2);
  // Twelve stops and the return make twelve phases, the timeline's limit.
  const full = {
    ...emptyPath(),
    stops: Array.from({ length: maxPathStops }, (_, i) => i % 9),
    closed: true,
  };
  expect(pathTimeline(full, cells, ["u", "v"]).phases).toHaveLength(12);
});

test("a path needs two valid stops and a step of 0.1 to 300 seconds", async () => {
  const { pathError, emptyPath } = await import("../web/atlas-path");
  const cells: { values: [number, number]; frame?: object; error?: string }[] =
    grid([1, 2, 3], [4, 5, 6]);
  cells[5] = { values: [3, 5], error: "Refused." };
  const path = (stops: number[], seconds = 2) => ({
    ...emptyPath(),
    stops,
    seconds,
  });
  expect(pathError(path([]), cells)).toBe(
    "Choose at least two cells for a path.",
  );
  expect(pathError(path([3]), cells)).toBe(
    "Choose at least two cells for a path.",
  );
  expect(pathError(path([3, 5]), cells)).toBe(
    "Stop 2 is unavailable; remove it.",
  );
  expect(pathError(path([3, 9]), cells)).toBe(
    "Stop 2 is unavailable; remove it.",
  );
  expect(pathError(path([3, 4], 0.05), cells)).toBe(
    "Seconds per step must be 0.1–300.",
  );
  expect(pathError(path([3, 4], 301), cells)).toBe(
    "Seconds per step must be 0.1–300.",
  );
  expect(pathError(path([3, 4], NaN), cells)).toBe(
    "Seconds per step must be 0.1–300.",
  );
  expect(pathError(path([3, 4], 300), cells)).toBeNull();
});

test("planar axes name the phrase parameter they move, and a pair paths only when both are phrase parameters", async () => {
  const { atlasPairs, atlasPair, atlasPathRefusal } =
    await import("../web/atlas");
  const { axisField } = await import("../web/atlas-queue");
  const { targetValue } = await import("../web/animation");
  const studies: [string, Config, { usesA?: boolean }][] = [
    ["Lissajous 3 : 2 & its pedal", planar("Lissajous 3 : 2 & its pedal"), {}],
    [
      "Epicycles, turned inside out",
      planar("Epicycles, turned inside out"),
      {},
    ],
    ["Two modes trading places", planar("Two modes trading places"), {}],
    ...presets
      .filter((p) => ["roulette", "attractor"].includes(p.config.curve.format))
      .map(
        (p) =>
          [p.title, structuredClone(p.config), {}] as [string, Config, object],
      ),
    // The circle's caustic with a lamp at (1, 0).
    [presets[2].title, structuredClone(presets[2].config), {}],
  ];
  const tracks: Record<string, string[]> = {};
  for (const [title, config, facts] of studies)
    for (const pair of atlasPairs(config, facts)) {
      tracks[pair.id] = pair.axes.map((a) => a.track!);
      // Each axis's track reads the very field the axis writes.
      for (const axis of pair.axes)
        expect(
          targetValue(config, axis.track as any, 1),
          `${title} ${pair.id} ${axis.key}`,
        ).toBe(axisField(config, axis));
      const refusal = atlasPathRefusal(config, pair.id);
      if (config.curve.format === "attractor")
        expect(refusal, title).toBe(
          "Coefficient a is not a phrase parameter in this study, so this pair has no path.",
        );
      else expect(refusal, `${title} ${pair.id}`).toBeNull();
    }
  expect(tracks).toMatchObject({
    roulette: ["rollRadius", "rollArm"],
    lissajous: ["lissajousM", "lissajousN"],
    "term-2": ["term2Frequency", "term2Radius"],
    pole: ["poleX", "poleY"],
    light: ["sourceX", "sourceY"],
    clifford: ["mapA", "mapB"],
    dejong: ["mapA", "mapB"],
  });
  expect(atlasPair("level").axes.map((a) => a.track)).toEqual([
    "contourLevel",
    "a",
  ]);
  // The implicit pair paths when F visibly reads a, as its phrase does.
  const cassini = planar("Cassini ovals & the lemniscate");
  expect(atlasPathRefusal(cassini, "level")).toBeNull();
  cassini.curve.implicit.f = "x^2 + y^2";
  expect(atlasPathRefusal(cassini, "level")).toBe(
    "Shape parameter a is not a phrase parameter in this study, so this pair has no path.",
  );
});

test("3D axes name their phrase parameter; torus-knot windings have no path", async () => {
  const { spatialAtlasPair, spatialPathRefusal } =
    await import("../web/spatial/atlas");
  const { spatialPresets } = await import("../web/spatial/presets");
  const { axisField } = await import("../web/atlas-queue");
  const { targetValue } = await import("../web/spatial/animation");
  const find = (test: (c: any) => boolean) =>
    structuredClone(spatialPresets.find((p) => test(p.config))!.config);
  const ellipsoid = find(
    (c) => c.format === "surface" && c.surface.kind === "ellipsoid",
  );
  const implicit = find((c) => c.format === "implicit");
  implicit.implicit.f = "x^2 + y^2 + z^2 - a";
  const knot = find((c) => c.format === "torus");
  expect(spatialAtlasPair("ellipsoid").axes.map((a) => a.track)).toEqual([
    "surfaceA",
    "surfaceB",
  ]);
  expect(spatialAtlasPair("level").axes.map((a) => a.track)).toEqual([
    "level",
    "implicitA",
  ]);
  expect(spatialAtlasPair("windings").axes.map((a) => a.track)).toEqual([
    undefined,
    undefined,
  ]);
  for (const [config, id] of [
    [ellipsoid, "ellipsoid"],
    [implicit, "level"],
  ] as const)
    for (const axis of spatialAtlasPair(id).axes)
      expect(targetValue(config, axis.track as any), axis.key).toBe(
        axisField(config, axis),
      );
  expect(spatialPathRefusal(ellipsoid, "ellipsoid")).toBeNull();
  expect(spatialPathRefusal(implicit, "level")).toBeNull();
  expect(spatialPathRefusal(knot, "windings")).toBe(
    "Windings around p is not a phrase parameter in this study, so this pair has no path.",
  );
});

test("4D axes name their phrase parameter, and only objects with phrases path", async () => {
  const { tesseractAtlasPairs, tesseractPathRefusal } =
    await import("../web/tesseract/atlas");
  const { objects } = await import("../web/tesseract/objects");
  const { tesseractTargetValue } = await import("../web/tesseract/phrase");
  const { axisField } = await import("../web/atlas-queue");
  const outcomes: Record<string, (string | null)[]> = {};
  for (const [object, descriptor] of Object.entries(objects)) {
    if (!descriptor.atlas) continue;
    const base = descriptor.defaults();
    for (const mode of descriptor.modes) {
      const config = { ...structuredClone(base), mode } as typeof base;
      for (const flower of [false, true]) {
        if (flower && !(config.mode === "paired" && config.weave)) continue;
        // The atlas's snapshot always carries the flower's amplitude.
        if (flower)
          config.weave = { ...config.weave!, path: "flower", amplitude: 0.2 };
        for (const pair of tesseractAtlasPairs(config)) {
          const refusal = tesseractPathRefusal(config, pair.id);
          (outcomes[`${object} ${mode} ${pair.id}`] ??= []).push(refusal);
          if (refusal) continue;
          for (const axis of pair.axes)
            expect(
              tesseractTargetValue(config, axis.track as any),
              `${object} ${mode} ${axis.key}`,
            ).toBe(axisField(config, axis));
        }
      }
    }
  }
  const paths = Object.entries(outcomes)
    .filter(([, r]) => r.every((x) => x === null))
    .map(([k]) => k);
  const refused = Object.entries(outcomes)
    .filter(([, r]) => r.every((x) => x !== null))
    .map(([k]) => k.split(" ")[0]);
  // The objects without phrases never path; every admitted object paths
  // every pair it offers.
  expect(new Set(refused)).toEqual(new Set(["cell24", "cell16"]));
  for (const object of ["tesseract", "weave", "root"])
    expect(
      paths.some((k) => k.startsWith(`${object} `)),
      object,
    ).toBe(true);
});

async function openPlanar(page: Page, source: PlanarStudy) {
  await page.goto(
    `/#s=${deflateRawSync(JSON.stringify({ v: 1, notebook: "2d", study: source })).toString("base64url")}`,
  );
  await settled(page);
}
const definition = async (page: Page) =>
  JSON.parse((await page.locator("#artwork desc").textContent())!);
async function seek(page: Page, time: string) {
  await page
    .getByRole("slider", { name: "Animation progress", exact: true })
    .fill(time);
  await expect(page.locator("#artwork")).toHaveAttribute(
    "data-animation-time",
    time,
  );
}
async function planPath(atlas: ReturnType<Page["getByRole"]>, cells: string[]) {
  await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(9);
  await atlas.getByRole("radio", { name: "Plan a path", exact: true }).check();
  for (const cell of cells)
    await atlas
      .getByRole("button", { name: `Add ${cell} to the path` })
      .click();
}

// The circle's caustic with a lamp at (1, 0): the light pair's default
// ranges are x 0–2 and y −1–1, so the 3 × 3 cells are x ∈ {0, 1, 2} across
// columns and y ∈ {−1, 0, 1} down rows.
test("a planned path plays as the study's phrase through each cell's exact values, and cancel keeps the study", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const { presetStudy } = await import("../web/planar-link");
  const source = presetStudy(2);
  source.camera = { x: 12, y: -7, zoom: 1.2 };
  source.layers.axes = true;
  await openPlanar(page, source);
  const before = (await copiedStudy(page)).study;

  // Cancel keeps the source study, path and all.
  let atlas = await openAtlas(page);
  await planPath(atlas, ["row 1, column 1", "row 2, column 2"]);
  await page.keyboard.press("Escape");
  expect((await copiedStudy(page)).study).toEqual(before);

  atlas = await openAtlas(page);
  await planPath(atlas, [
    "row 1, column 1",
    "row 2, column 2",
    "row 3, column 3",
    "row 3, column 1",
  ]);
  const panel = atlas.getByRole("region", { name: "Path", exact: true });
  await expect(panel.locator("li")).toHaveText([
    /^Stop 1 · x = 0, y = −1/,
    /^Stop 2 · x = 1, y = 0/,
    /^Stop 3 · x = 2, y = 1/,
    /^Stop 4 · x = 0, y = 1/,
  ]);
  await expect(atlas.locator(".atlas-cell .atlas-stops")).toHaveText([
    "1",
    "2",
    "4",
    "3",
  ]);
  // No whole-number axis here, so no sweep note.
  await expect(panel.locator(".atlas-path-whole")).toHaveCount(0);
  await panel.getByLabel("Return to the first stop", { exact: true }).check();
  await panel.getByLabel("Seconds per step", { exact: true }).fill("1");
  await panel
    .getByRole("button", { name: "Animate this path", exact: true })
    .click();
  await expect(atlas).toBeHidden();
  await settled(page);

  // The adopted study opens at stop 1 and plays the path as its phrase;
  // nothing else of the source changes.
  const adopted = (await copiedStudy(page)).study;
  const expected = structuredClone(before);
  expected.config.source.position = { x: 0, y: -1 };
  expected.animation = {
    ...expected.animation,
    mode: "phrase",
    duration: 4,
    phrase: {
      target: "sourceX",
      also: ["sourceY"],
      opening: { base: 1, construction: 1, derived: 1 },
      phases: [
        {
          name: "To stop 2",
          duration: 1,
          pace: "ease",
          key: "1",
          keys: { sourceY: "0" },
        },
        {
          name: "To stop 3",
          duration: 1,
          pace: "ease",
          key: "2",
          keys: { sourceY: "1" },
        },
        // Only x changes; y holds.
        { name: "To stop 4", duration: 1, pace: "ease", key: "0" },
        {
          name: "Return to stop 1",
          duration: 1,
          pace: "ease",
          keys: { sourceY: "-1" },
        },
      ],
    },
  };
  expect(adopted).toEqual(expected);
  await openAnimation(page);
  await expect(
    page.getByRole("combobox", { name: "Animate", exact: true }),
  ).toHaveValue("phrase");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  // Every phase end is its cell exactly; a moving frame lies between, eased.
  for (const [time, x, y] of [
    ["0", 0, -1],
    ["0.375", 1.5, 0.5],
    ["0.25", 1, 0],
    ["0.5", 2, 1],
    ["0.75", 0, 1],
    ["1", 0, -1],
    ["0.875", 0, 0],
    ["0.125", 0.5, -0.5],
  ] as const) {
    await seek(page, time);
    const shown = await definition(page);
    if (Number(time) % 0.25 === 0)
      expect(shown.source.position, time).toEqual({ x, y });
    else {
      expect(shown.source.position.x, time).toBeCloseTo(x, 12);
      expect(shown.source.position.y, time).toBeCloseTo(y, 12);
    }
    // Only the pair moves: the curve and construction are the source's.
    expect(shown.curve, time).toEqual(expected.config.curve);
    expect(shown.kind, time).toBe(expected.config.kind);
  }
  // Returning to the first stop closes the loop exactly, so it repeats.
  await page.getByRole("button", { name: /^(Stop|Back to study)$/ }).click();
  await page.getByLabel("Repeat", { exact: true }).selectOption("loop");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".animation-error")).toHaveCount(0);
});

// Stops at the four corners' path: (1, 1), (2, 2), (3, 3), (3, 1) and back,
// four phases whose ends fall on the progress slider's 0.001 steps.
const cornerPath = [
  "row 1, column 1",
  "row 2, column 2",
  "row 3, column 3",
  "row 3, column 1",
];
const cornerCells = [0, 4, 8, 6, 0];
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });

// An ellipsoid with semi-axes a = 1.5, b = 1: its pair's default ranges are
// a 0.75–2.25 and b 0.5–1.5.
test("a 3D path adopts as the study's phrase, keeping its view, and lands on each cell exactly", async ({
  page,
}) => {
  test.setTimeout(180000);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const { presetStudy } = await import("../web/spatial/link");
  const { spatialPresets } = await import("../web/spatial/presets");
  const source = presetStudy(
    spatialPresets.findIndex(
      (p) => p.name === "The focal sheets of an ellipsoid",
    ),
  );
  source.view = { ...source.view, yaw: source.view.yaw + 0.4 };
  const stage = page.locator(".spatial-stage");
  const settledStage = () =>
    expect(stage).toHaveAttribute("aria-busy", "false", { timeout: 60000 });
  await page.goto(
    `/?study=3d#s=${deflateRawSync(JSON.stringify({ v: 1, notebook: "3d", study: source })).toString("base64url")}`,
  );
  await settledStage();
  await button(page, "Explore parameter atlas").click();
  const atlas = page.getByRole("dialog", {
    name: "A field of possible forms",
    exact: true,
  });
  await expect(atlas.getByLabel("Parameter pair", { exact: true })).toHaveValue(
    "ellipsoid",
  );
  await planPath(atlas, cornerPath);
  await atlas.getByLabel("Return to the first stop", { exact: true }).check();
  await atlas
    .getByRole("button", { name: "Animate this path", exact: true })
    .click();
  await expect(atlas).toBeHidden();
  await settledStage();
  const a = [0.75, 1.5, 2.25],
    b = [0.5, 1, 1.5];
  const cell = (i: number) => [a[i % 3], b[Math.floor(i / 3)]];
  const config = async () =>
    JSON.parse((await stage.getAttribute("data-config"))!);
  await expect
    .poll(async () => {
      const c = await config();
      return [c.surface.a, c.surface.b];
    })
    .toEqual(cell(0));
  await settledStage();
  const opening = await config();
  // The view, layers and everything but the pair and the phrase are kept.
  const adopted = (await copiedStudy(page)).study;
  expect(adopted.view).toEqual(source.view);
  expect(adopted.layers).toEqual(source.layers);
  expect(adopted.animation.phrase).toEqual({
    target: "surfaceA",
    also: ["surfaceB"],
    opening: 1,
    phases: [
      {
        name: "To stop 2",
        duration: 2,
        pace: "ease",
        key: "1.5",
        keys: { surfaceB: "1" },
      },
      {
        name: "To stop 3",
        duration: 2,
        pace: "ease",
        key: "2.25",
        keys: { surfaceB: "1.5" },
      },
      { name: "To stop 4", duration: 2, pace: "ease", key: "0.75" },
      {
        name: "Return to stop 1",
        duration: 2,
        pace: "ease",
        keys: { surfaceB: "0.5" },
      },
    ],
  });
  expect({ ...opening.surface, a: 0, b: 0 }).toEqual({
    ...source.config.surface,
    a: 0,
    b: 0,
  });
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
  await expect(
    page.getByRole("combobox", { name: "Animate", exact: true }),
  ).toHaveValue("phrase");
  await button(page, "Play animation").click();
  await button(page, "Pause").click({ timeout: 60000 });
  for (const [k, index] of cornerCells.entries()) {
    const time = String(k / 4);
    await page.getByRole("slider", { name: "Animation progress" }).fill(time);
    await expect(stage).toHaveAttribute("data-progress", time, {
      timeout: 60000,
    });
    await settledStage();
    const shown = JSON.parse((await stage.getAttribute("data-config"))!);
    expect([shown.surface.a, shown.surface.b], time).toEqual(cell(index));
  }
});

// A Hopf bouquet over a spherical flower: the flower pair moves the
// central latitude α and the flower's amplitude A.
test("a 4D path adopts as the study's phrase without touching its cameras, and lands on each cell exactly", async ({
  page,
}) => {
  test.setTimeout(180000);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const { presetStudy } = await import("../web/tesseract/link");
  const { tesseractPresets } = await import("../web/tesseract/presets");
  const { tesseractAtlasDefaults } = await import("../web/tesseract/atlas");
  const { axisValues } = await import("../web/atlas-queue");
  const source = presetStudy(
    tesseractPresets.findIndex((p) => p.name === "A bouquet answers its path"),
  );
  const ranges = tesseractAtlasDefaults(source.config, "flower");
  const alphas = axisValues(ranges.alpha, source.config.weave!.alpha, 3);
  const amplitudes = axisValues(
    ranges.amplitude,
    source.config.weave!.amplitude!,
    3,
  );
  const cell = (i: number) => [alphas[i % 3], amplitudes[Math.floor(i / 3)]];
  const stage = page.locator(".tesseract-stage");
  const settledStage = () =>
    expect(stage).toHaveAttribute("aria-busy", "false", { timeout: 60000 });
  await page.goto(
    `/?study=4d#s=${deflateRawSync(JSON.stringify({ v: 1, notebook: "4d", study: source })).toString("base64url")}`,
  );
  await settledStage();
  await button(page, "Explore parameter atlas").click();
  const atlas = page.getByRole("dialog", {
    name: "A field of possible worlds",
    exact: true,
  });
  await expect(atlas.getByLabel("Parameter pair", { exact: true })).toHaveValue(
    "flower",
  );
  await planPath(atlas, cornerPath);
  await atlas.getByLabel("Return to the first stop", { exact: true }).check();
  await atlas
    .getByRole("button", { name: "Animate this path", exact: true })
    .click();
  await expect(atlas).toBeHidden();
  await settledStage();
  const config = async () =>
    JSON.parse((await stage.getAttribute("data-config"))!);
  await expect
    .poll(async () => {
      const c = await config();
      return [c.weave.alpha, c.weave.amplitude];
    })
    .toEqual(cell(0));
  await settledStage();
  const opening = await config();
  expect(opening.angles).toEqual(source.config.angles);
  // Both cameras, layers and timing are kept; the phrase is the path's.
  const adopted = (await copiedStudy(page)).study;
  expect(adopted.view).toEqual(source.view);
  expect(adopted.diagramView).toEqual(source.diagramView);
  expect(adopted.layers).toEqual(source.layers);
  expect(adopted.duration).toEqual(source.duration);
  expect(adopted.motion).toBe("phrase");
  expect(adopted.phrase.target).toBe("weave.alpha");
  expect(adopted.phrase.also).toEqual(["weave.amplitude"]);
  expect(
    adopted.phrase.phases.map((p: any) => [
      p.key && Number(p.key),
      p.keys && Number(p.keys["weave.amplitude"]),
    ]),
  ).toEqual(
    cornerCells.slice(1).map((index, k) => {
      const [x, y] = cell(index);
      const [px, py] = cell(cornerCells[k]);
      return [x === px ? undefined : x, y === py ? undefined : y];
    }),
  );
  const section = page.locator("#shape-animation-section");
  if ((await section.getAttribute("open")) === null)
    await section.locator(":scope > summary").click();
  await expect(page.getByLabel("Animate", { exact: true })).toHaveValue(
    "phrase",
  );
  await button(page, "Play animation").click();
  await button(page, "Pause").click({ timeout: 60000 });
  for (const [k, index] of cornerCells.entries()) {
    const time = String(k / 4);
    await page.getByRole("slider", { name: "Animation progress" }).fill(time);
    await expect(stage).toHaveAttribute("data-time", time, {
      timeout: 60000,
    });
    await settledStage();
    const shown = JSON.parse((await stage.getAttribute("data-config"))!);
    expect([shown.weave.alpha, shown.weave.amplitude], time).toEqual(
      cell(index),
    );
  }
});

// Lissajous 3 : 2: its whole frequencies' default ranges are m 1–5 and
// n 1–5, so the cells are m, n ∈ {1, 3, 5}.
test("whole frequencies sweep through fractional values, said plainly in the atlas and the phrase, and an open path does not loop", async ({
  page,
}) => {
  const { presetStudy } = await import("../web/planar-link");
  await openPlanar(
    page,
    presetStudy(presetIndex("Lissajous 3 : 2 & its pedal")),
  );
  const atlas = await openAtlas(page);
  await expect(atlas.getByLabel("Parameter pair", { exact: true })).toHaveValue(
    "lissajous",
  );
  await planPath(atlas, ["row 2, column 2", "row 3, column 3"]);
  const panel = atlas.getByRole("region", { name: "Path", exact: true });
  await expect(panel.locator(".atlas-path-whole")).toHaveText(
    "Between stops, m and n sweep through fractional values: genuine curves that generally do not close. Only the stops are whole.",
  );
  // A range edit regenerates the cells, so the path starts again.
  await atlas.getByLabel("Frequency m to", { exact: true }).fill("7");
  await expect(panel.locator("li")).toHaveCount(0);
  await expect(panel).toContainText("Choose cells in the order to visit them.");
  await atlas.getByLabel("Frequency m to", { exact: true }).fill("5");
  await atlas
    .getByRole("button", { name: "Generate atlas", exact: true })
    .click();
  await planPath(atlas, ["row 2, column 2", "row 2, column 3"]);
  await panel
    .getByRole("button", { name: "Animate this path", exact: true })
    .click();
  await settled(page);
  await openAnimation(page);
  await expect(page.locator(".phrase-phases + .note")).toContainText(
    "Frequency m and Frequency n move through fractional values, where the curve generally does not close.",
  );
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await seek(page, "0");
  expect((await definition(page)).curve.lissajous).toMatchObject({
    frequencyX: 3,
    frequencyY: 3,
  });
  await seek(page, "0.25");
  const between = (await definition(page)).curve.lissajous;
  expect(between.frequencyX).toBeGreaterThan(3);
  expect(between.frequencyX).toBeLessThan(5);
  expect(Number.isInteger(between.frequencyX)).toBe(false);
  await seek(page, "1");
  expect((await definition(page)).curve.lissajous).toMatchObject({
    frequencyX: 5,
    frequencyY: 3,
  });
  // The path ends away from its start, so it cannot loop.
  await page.getByRole("button", { name: /^(Stop|Back to study)$/ }).click();
  await page.getByLabel("Repeat", { exact: true }).selectOption("loop");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(page.locator(".animation-error")).toContainText(
    "Repeat can loop only motion that ends where it starts",
  );
});

test("a pair whose parameters no phrase moves offers no path and says why", async ({
  page,
}) => {
  const { presetStudy } = await import("../web/planar-link");
  const index = presets.findIndex((p) => p.config.curve.format === "attractor");
  await openPlanar(page, presetStudy(index));
  const atlas = await openAtlas(page);
  await expect(
    atlas.getByRole("radio", { name: "Plan a path", exact: true }),
  ).toBeDisabled();
  await expect(atlas.locator(".atlas-choice-note")).toHaveText(
    "Coefficient a is not a phrase parameter in this study, so this pair has no path.",
  );
  await expect(
    atlas.getByRole("radio", { name: "Inspect a variant", exact: true }),
  ).toBeChecked();
  await expect(atlas.getByRole("region", { name: "Path" })).toHaveCount(0);
});

test("after a path is animated, Play comes into view once it is ready, taking focus only after keyboard use", async ({
  page,
}) => {
  const { presetStudy } = await import("../web/planar-link");
  for (const via of ["keyboard", "pointer"] as const) {
    await openPlanar(page, presetStudy(2));
    const atlas = await openAtlas(page);
    await planPath(atlas, ["row 1, column 1", "row 2, column 2"]);
    const animate = atlas.getByRole("button", {
      name: "Animate this path",
      exact: true,
    });
    if (via === "keyboard") {
      await animate.focus();
      await page.keyboard.press("Enter");
    } else await animate.click();
    await expect(atlas).toBeHidden();
    await settled(page);
    const play = page.getByRole("button", {
      name: "Play animation",
      exact: true,
    });
    await expect(play).toBeEnabled();
    if (via === "keyboard") await expect(play).toBeFocused();
    else {
      await expect(play).toBeInViewport();
      await expect(play).not.toBeFocused();
    }
  }
});

// An ordinary adoption, like Cancel, returns focus to the atlas button, and
// it stays there while the adopted study computes and after it settles: the
// button stays enabled meanwhile, as a focused button that is disabled
// drops focus to the page (#480). Focus is quiet after a pointer, ringed
// after the keyboard.
for (const [notebook, preset, name, stage] of [
  [
    "2d",
    "Hypotrochoid & its evolute",
    "A field of possible flowers",
    ".plot-wrap",
  ],
  [
    "3d",
    "The focal sheets of an ellipsoid",
    "A field of possible forms",
    ".spatial-stage",
  ],
  [
    "4d",
    "A flower below, a bouquet above",
    "A field of possible worlds",
    ".tesseract-stage",
  ],
])
  test(`after adopting a ${notebook} variant, focus stays on the atlas button by pointer and keyboard`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(notebook === "2d" ? "/" : `/?study=${notebook}`);
    await choosePreset(page, { label: preset });
    const busy = page.locator(`${stage}[aria-busy]`).first();
    await expect(busy).toHaveAttribute("aria-busy", "false");
    const entry = page.getByRole("button", {
      name: "Explore parameter atlas",
      exact: true,
    });
    const atlas = page.getByRole("dialog", { name, exact: true });
    for (const via of ["pointer", "keyboard"] as const) {
      await entry.click();
      await expect(atlas).toBeVisible();
      const generate = atlas.getByRole("button", {
        name: "Generate atlas",
        exact: true,
      });
      await expect(
        atlas.locator('.atlas-cell[data-state="valid"]').first(),
      ).toBeVisible();
      await expect(generate).toBeVisible();
      await atlas
        .getByRole("button", { name: "Inspect row 1, column 1", exact: true })
        .click();
      const adopt = atlas.getByRole("button", {
        name: "Adopt variant",
        exact: true,
      });
      await expect(adopt).toBeEnabled();
      // Record every place focus lands, and the entry's disabled changes,
      // from the adoption until the stage settles.
      await page.evaluate(() => {
        const w = window as unknown as { trail: string[] };
        w.trail = [];
        const note = () =>
          w.trail.push(
            document.activeElement?.textContent?.trim() ||
              document.activeElement?.tagName ||
              "",
          );
        document.addEventListener("focusin", note, true);
        document.addEventListener("focusout", () => setTimeout(note), true);
      });
      if (via === "keyboard") {
        await adopt.focus();
        await page.keyboard.press("Enter");
      } else await adopt.click();
      await expect(atlas).toBeHidden();
      await expect(busy).toHaveAttribute("aria-busy", "false");
      await page.waitForTimeout(300);
      await expect(entry).toBeFocused();
      const trail = await page.evaluate(
        () => (window as unknown as { trail: string[] }).trail,
      );
      expect(trail.at(-1)).toBe("Explore parameter atlas");
      expect(trail).not.toContain("BODY");
      if (via === "pointer")
        await expect(page.locator(".atlas-entry").first()).toHaveAttribute(
          "data-quiet",
          "",
        );
      else
        await expect(page.locator(".atlas-entry").first()).not.toHaveAttribute(
          "data-quiet",
          "",
        );
    }
  });

// The light pair's cells again: (0, −1), then (1, 0), then (2, 1), 1.1 s
// each. At 15 frames a second, 33 frames put frame 16 on the middle stop.
test("a path's MP4 matches direct seeks at its stops, decoded independently", async ({
  page,
}) => {
  test.setTimeout(120000);
  const { presetStudy } = await import("../web/planar-link");
  await openPlanar(page, presetStudy(2));
  const atlas = await openAtlas(page);
  await planPath(atlas, [
    "row 1, column 1",
    "row 2, column 2",
    "row 3, column 3",
  ]);
  await atlas.getByLabel("Seconds per step", { exact: true }).fill("1.1");
  await atlas
    .getByRole("button", { name: "Animate this path", exact: true })
    .click();
  await settled(page);
  await openExportSettings(page);
  await page
    .getByRole("combobox", { name: "Export format", exact: true })
    .selectOption("mp4");
  await page
    .getByRole("combobox", { name: "Export frame rate", exact: true })
    .selectOption("15");
  await page
    .getByRole("slider", { name: "Export quality", exact: true })
    .fill("100");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  expect(exportTiming(2.2, 15)[16].progress).toBe(0.5);
  const stills = [];
  for (const [time, x, y] of [
    ["0", 0, -1],
    ["0.5", 1, 0],
    ["1", 2, 1],
  ] as const) {
    await seek(page, time);
    expect((await definition(page)).source.position).toEqual({ x, y });
    const saved = page.waitForEvent("download");
    await exportImage(page, "PNG");
    stills.push(decodePng(await readFile((await (await saved).path())!)));
  }
  await page.getByRole("button", { name: /^(Stop|Back to study)$/ }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export MP4 video" }).click();
  const path = (await (await download).path())!;
  const data = probe(path);
  if (data) {
    expect(data.frames).toBe(33);
    expect(data.durations.reduce((a, b) => a + b, 0)).toBe(2200);
    const match = (i: number, still: (typeof stills)[number]) =>
      frameDifference(path, 2000, 1520, i, still.rgba)!;
    for (const [i, still] of [
      [0, stills[0]],
      [16, stills[1]],
      [32, stills[2]],
    ] as const) {
      const difference = match(i, still);
      expect(difference.meanDifference, `frame ${i}`).toBeLessThan(3);
      expect(difference.unmatchedInk, `frame ${i}`).toBeLessThan(0.05);
    }
    // Each stop is its own caustic.
    expect(match(16, stills[0]).unmatchedInk).toBeGreaterThan(0.3);
    expect(match(32, stills[1]).unmatchedInk).toBeGreaterThan(0.3);
  }
  const video = await decodeVideo(page, await readFile(path));
  expect(video.duration).toBeCloseTo(2.2, 3);
  expect(video.first.hash).not.toBe(video.last.hash);
});
