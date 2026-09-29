import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  applyTracks,
  availableTargets,
  revealConfig,
  targetLabel,
  targetValue,
} from "../web/animation";
import { attractorNote, densityPixels } from "../web/attractor";
import { fitFrame } from "../web/Plot";
import { presets } from "../web/presets";
import type { AttractorResult, Config, Result } from "../web/types";
import { exportImage, openAnimation, choosePreset } from "./helpers";

const clifford = "Clifford attractor";
const dejong = "De Jong attractor";
const henon = "Hénon map";
const preset = (title: string) =>
  presets.find((p) => p.title === title)!.config;
async function ready(page: Page, title: string) {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await choosePreset(page, { label: title });
  await settled(page);
}
async function settled(page: Page) {
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.locator("#artwork")).toBeVisible();
}
async function definition(page: Page) {
  return JSON.parse((await page.locator("#artwork desc").textContent())!);
}
async function progress(page: Page) {
  return Number(
    await page.locator("#artwork").getAttribute("data-animation-progress"),
  );
}
const input = (page: Page, name: string) =>
  page.getByLabel(name, { exact: true });
const note = (page: Page) => page.getByTestId("attractor-note");
const density = (page: Page) => page.getByTestId("attractor-density");
const orbit = (page: Page) => page.getByTestId("attractor-orbit");
const scale = async (page: Page) =>
  Number(await page.locator("#artwork").getAttribute("data-camera-scale"));
const accumulated = async (page: Page) =>
  Number(await density(page).getAttribute("data-accumulated"));
// The density image's pixels, decoded by the browser from its data URL: how
// many are shaded, and the most opaque.
async function decoded(page: Page, href: string) {
  return page.evaluate(async (href) => {
    const image = new Image();
    image.src = href;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let shaded = 0,
      opaque = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) shaded++;
      opaque = Math.max(opaque, data[i]);
    }
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      shaded,
      opaque,
    };
  }, href);
}
const visited = (text: string) =>
  Number(/visit ([\d,]+) of/.exec(text)![1].replaceAll(",", ""));

const grid = (
  counts: number[],
  columns: number,
  extra: Partial<AttractorResult> = {},
): AttractorResult => ({
  window: { xMin: 0, xMax: columns, yMin: 0, yMax: counts.length / columns },
  columns,
  rows: counts.length / columns,
  counts,
  max: Math.max(...counts),
  accumulated: counts.reduce((a, b) => a + b, 0),
  outside: 0,
  escape: 0,
  orbit: [],
  ...extra,
});

test("the attractor presets are Clifford, de Jong, and Hénon maps", () => {
  const study = preset(clifford);
  expect(study.curve.format).toBe("attractor");
  // The reference study: 1,000 iterates discarded, 800,000 accumulated.
  expect(study.curve.attractor).toEqual({
    map: "clifford",
    a: -1.4,
    b: 1.6,
    c: 1,
    d: 0.7,
    start: { x: 0.1, y: 0.1 },
    discard: 1000,
    iterates: 800000,
    fit: true,
    window: { xMin: -2, xMax: 2, yMin: -1.7, yMax: 1.7 },
    cells: 600,
  });
  expect(preset(dejong).curve.attractor).toMatchObject({
    map: "dejong",
    a: 1.4,
    b: -2.3,
    c: 2.4,
    d: -2.1,
  });
  expect(preset(henon).curve.attractor).toMatchObject({
    map: "henon",
    a: 1.4,
    b: 0.3,
    start: { x: 0, y: 0 },
  });
});

test("coefficients, start, iterates, window, and grid are animatable", () => {
  const config = preset(clifford);
  expect(availableTargets(config)).toEqual([
    "mapA",
    "mapB",
    "mapC",
    "mapD",
    "startX",
    "startY",
    "discard",
    "iterates",
    "contourCells",
    "lines",
  ]);
  const at = (patch: Partial<Config["curve"]["attractor"]>) => ({
    ...config,
    curve: {
      ...config.curve,
      attractor: { ...config.curve.attractor, ...patch },
    },
  });
  // Hénon's map has no c or d; a given window can move.
  expect(availableTargets(at({ map: "henon" }))).not.toContain("mapC");
  expect(availableTargets(at({ fit: false }))).toContain("windowYMax");
  expect(availableTargets(config)).not.toContain("a");
  expect(targetLabel("mapA")).toBe("Coefficient a");
  expect(targetLabel("mapD")).toBe("Coefficient d");
  expect(targetLabel("startY")).toBe("Start y₀");
  expect(targetLabel("discard")).toBe("Discarded iterates");
  expect(targetLabel("iterates")).toBe("Accumulated iterates");
  expect(targetValue(config, "mapB", 1)).toBe(1.6);
  expect(targetValue(config, "startX", 1)).toBe(0.1);
  expect(targetValue(config, "iterates", 1)).toBe(800000);
  expect(targetValue(config, "contourCells", 1)).toBe(600);
  expect(targetValue(config, "windowYMax", 1)).toBe(1.7);
  const tracks = [
    { target: "mapA" as const, from: -1.4, to: -Math.PI / 2 },
    { target: "startY" as const, from: 0.1, to: Math.E / 10 },
    { target: "discard" as const, from: 1000, to: 7 },
    { target: "iterates" as const, from: 800000, to: 1234 },
    { target: "contourCells" as const, from: 600, to: 97 },
    { target: "windowXMin" as const, from: -2, to: -3 },
  ];
  const end = applyTracks(config, tracks, 1, 1).config.curve.attractor;
  expect(end.a).toBe(-Math.PI / 2);
  expect(end.start.y).toBe(Math.E / 10);
  expect([end.discard, end.iterates, end.cells]).toEqual([7, 1234, 97]);
  expect(end.window.xMin).toBe(-3);
  // The implicit curve's window and grid are untouched.
  expect(applyTracks(config, tracks, 1, 1).config.curve.implicit).toEqual(
    config.curve.implicit,
  );
  const mid = applyTracks(config, tracks, 0.3, 1).config.curve.attractor;
  for (const n of [mid.discard, mid.iterates, mid.cells])
    expect(Number.isInteger(n)).toBe(true);
  expect(applyTracks(config, tracks, 0, 1).config).toEqual(config);
});

test("reveal accumulates a prefix of the iterates in the final window", () => {
  const config = preset(clifford);
  const final = grid([1, 2, 3, 4], 2, {
    window: { xMin: -1.9, xMax: 1.8, yMin: -1.6, yMax: 1.5 },
  });
  const half = revealConfig(config, final, 0.3).curve.attractor;
  expect(half.iterates).toBe(240000);
  expect(half.fit).toBe(false);
  expect(half.window).toEqual(final.window);
  expect(half.discard).toBe(1000);
  expect(revealConfig(config, final, 0).curve.attractor.iterates).toBe(0);
  expect(revealConfig(config, final, 1).curve.attractor.iterates).toBe(800000);
  expect(config.curve.attractor.fit).toBe(true);
});

test("density shades each cell by log visits, top row first", () => {
  // Two rows of three: the bottom row is (0, 1, 3), the top (7, 0, 1).
  const pixels = densityPixels(grid([0, 1, 3, 7, 0, 1], 3), "#186b6b");
  expect(pixels).toHaveLength(6 * 4);
  const alpha = (n: number) => Math.round((255 * Math.log1p(n)) / Math.log(8));
  expect(Array.from(pixels.filter((_, i) => i % 4 === 3))).toEqual([
    alpha(7),
    0,
    alpha(1),
    0,
    alpha(1),
    alpha(3),
  ]);
  expect(alpha(7)).toBe(255);
  expect(Array.from(pixels.slice(0, 3))).toEqual([0x18, 0x6b, 0x6b]);
  // Nothing accumulated: every cell is clear.
  expect(
    densityPixels(grid([0, 0], 2), "#ffffff").every(
      (v, i) => i % 4 !== 3 || v === 0,
    ),
  ).toBe(true);
});

test("the attractor note counts iterates, cells, and where they stop", () => {
  const counts = [0, 1, 3, 7, 0, 1];
  expect(attractorNote(grid(counts, 3), 1000)).toBe(
    "12 iterates, after 1,000 discarded, visit 4 of 6 cells; the busiest has 7 visits.",
  );
  expect(attractorNote(grid([1, 0], 2), 0)).toBe(
    "1 iterate visits 1 of 2 cells; the busiest has 1 visit.",
  );
  expect(
    attractorNote(
      grid(counts, 3, { accumulated: 12 + 1234, outside: 1234 }),
      5,
    ),
  ).toBe(
    "1,246 iterates, after 5 discarded, visit 4 of 6 cells; the busiest has 7 visits. 1,234 of them lie outside the window and are not drawn.",
  );
  expect(
    attractorNote(grid([0, 0], 2, { accumulated: 0, escape: 4, max: 0 }), 10),
  ).toBe(
    "No iterates are accumulated. The orbit left |x|, |y| ≤ 100,000 at iterate 4 and stops there.",
  );
});

test("the window frames an attractor", () => {
  const result: Result = {
    base: [],
    derived: [],
    virtual: [],
    rays: [],
    family: [],
    circles: [],
    rolling: [],
    attractor: grid([1, 2], 2, {
      window: { xMin: -4, xMax: 4, yMin: -1, yMax: 3 },
      orbit: [{ x: 90, y: 90 }],
    }),
    warnings: [],
    invalid: 0,
  };
  const frame = fitFrame(result, { ...preset(clifford), kind: "pedal" });
  expect([frame.cx, frame.cy, frame.span]).toEqual([0, 1, 8]);
});

test("the Clifford preset draws its density, window, and first iterates", async ({
  page,
}) => {
  await ready(page, clifford);
  const text = (await note(page).textContent())!;
  expect(text).toMatch(
    /^800,000 iterates, after 1,000 discarded, visit [\d,]+ of [\d,]+ cells; the busiest has [\d,]+ visits\.$/,
  );
  const image = density(page);
  const href = (await image.getAttribute("href"))!;
  expect(href).toMatch(/^data:image\/png;base64,/);
  const columns = Number(await image.getAttribute("data-columns"));
  const rows = Number(await image.getAttribute("data-rows"));
  expect(Math.max(columns, rows)).toBe(600);
  expect(await accumulated(page)).toBe(800000);
  expect(await image.getAttribute("image-rendering")).toBe("pixelated");
  // One pixel per cell, shaded where the orbit visits and fully opaque at
  // the busiest cell.
  const pixels = await decoded(page, href);
  expect([pixels.width, pixels.height]).toEqual([columns, rows]);
  expect(pixels.shaded).toBe(visited(text));
  expect(pixels.opaque).toBe(255);
  // The image covers the window, which lies within 1 + |c| by 1 + |d|.
  const s = await scale(page);
  const width = Number(await image.getAttribute("width"));
  const height = Number(await image.getAttribute("height"));
  expect(width / s).toBeLessThanOrEqual(4);
  expect(height / s).toBeLessThanOrEqual(3.4);
  expect(width / height).toBeCloseTo(columns / rows, 1);
  const frame = page.getByTestId("attractor-window");
  expect(Number(await frame.getAttribute("width"))).toBeCloseTo(width, 6);
  // The start and the first 40 iterates, as dots: never joined.
  await expect(orbit(page)).toHaveCount(41);
  await expect(page.getByTestId("attractor-start")).toHaveCount(1);
  await expect(
    page.locator("#artwork path[data-testid^='attractor']"),
  ).toHaveCount(0);
  // No construction applies: tabs, samples, and the domain go.
  for (const tab of ["evolute", "pedal", "inversion"])
    await expect(
      page.getByRole("button", { name: tab, exact: true }),
    ).toBeDisabled();
  await expect(page.getByText("03 / THE DRAWING")).toBeVisible();
  await expect(page.locator(".legend")).toHaveText("Visit density");
  await expect(page.getByLabel("Numerical samples")).toHaveCount(0);
  await expect(page.getByLabel("t from", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Shape parameter a")).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", { name: "Derived curve" }),
  ).toHaveCount(0);
  await expect(page.locator("h1")).toHaveText(
    "The visit density of an iterated map",
  );
});

test("maps, coefficients, windows, escapes, and errors", async ({ page }) => {
  await ready(page, clifford);
  // Choosing a map loads its curated coefficients; Hénon's map has no c, d.
  await page.getByRole("combobox", { name: "Map" }).selectOption("henon");
  await settled(page);
  expect((await definition(page)).curve.attractor).toMatchObject({
    map: "henon",
    a: 1.4,
    b: 0.3,
  });
  await expect(input(page, "Coefficient c")).toHaveCount(0);
  await expect(input(page, "Coefficient a")).toHaveValue("1.4");
  await expect(page.locator(".formula")).toContainText("1 − a x² + y");
  await input(page, "Coefficient a").fill("1.4^1");
  // A given window: iterates beyond it are counted, not drawn.
  await page
    .getByRole("checkbox", { name: "Fit the window to the iterates" })
    .uncheck();
  await input(page, "Window x to").fill("0");
  await settled(page);
  await expect(note(page)).toContainText(
    "of them lie outside the window and are not drawn.",
  );
  const image = density(page);
  expect(Number(await image.getAttribute("width"))).toBeCloseTo(
    2 * (await scale(page)),
    6,
  );
  // An orbit from (2, 0) leaves the bound at its fourth iterate.
  await input(page, "Start x₀").fill("2");
  await settled(page);
  await expect(note(page)).toContainText(
    "The orbit left |x|, |y| ≤ 100,000 at iterate 4 and stops there.",
  );
  await expect(orbit(page)).toHaveCount(4);
  await input(page, "Start x₀").fill("0");
  await input(page, "Accumulated iterates").fill("5000001");
  await expect(page.getByRole("alert")).toContainText(
    "accumulate 0–5,000,000 iterates",
  );
  await input(page, "Accumulated iterates").fill("2.5");
  await expect(page.getByRole("alert")).toContainText(
    "Grid cells and iterate counts must be whole numbers.",
  );
  await input(page, "Accumulated iterates").fill("20000");
  await input(page, "Grid cells").fill("40");
  await settled(page);
  expect(await accumulated(page)).toBe(20000);
  // The window is 2 wide and 3.4 high: 40 cells run along y.
  expect(Number(await density(page).getAttribute("data-rows"))).toBe(40);
  expect(Number(await density(page).getAttribute("data-columns"))).toBe(24);
  await page.getByRole("combobox", { name: "Map" }).selectOption("dejong");
  await settled(page);
  await expect(input(page, "Coefficient d")).toHaveValue("-2.1");
  // Constructions come back with a parametrized curve.
  await page
    .getByRole("combobox", { name: "Definition" })
    .selectOption("parametric");
  await settled(page);
  await expect(
    page.getByRole("button", { name: "pedal", exact: true }),
  ).toBeEnabled();
  await expect(density(page)).toHaveCount(0);
});

test("exports embed the density as a PNG of its cells, under the policy", async ({
  page,
}) => {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (m.text().includes("Content Security Policy")) violations.push(m.text());
  });
  await ready(page, dejong);
  const columns = Number(await density(page).getAttribute("data-columns"));
  const rows = Number(await density(page).getAttribute("data-rows"));
  const text = (await note(page).textContent())!;
  await page.getByRole("button", { name: "Export image" }).click();
  await expect(page.getByRole("menuitem", { name: /^SVG/ })).toHaveText(
    "SVG · vectors, density as an embedded PNG",
  );
  await page.keyboard.press("Escape");
  const svgDownload = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const svg = await svgDownload;
  expect(svg.suggestedFilename()).toBe("tangent-garden-attractor.svg");
  const markup = await readFile((await svg.path())!, "utf8");
  const href =
    /data-testid="attractor-density"[^>]*href="([^"]+)"|href="([^"]+)"[^>]*data-testid="attractor-density"/.exec(
      markup,
    )!;
  const embedded = await decoded(page, href[1] ?? href[2]);
  expect([embedded.width, embedded.height]).toEqual([columns, rows]);
  expect(embedded.shaded).toBe(visited(text));
  // The PNG is drawn from the vectors and the cells at 2000 × 1520: the
  // busiest cells are the preset's own colour.
  const pngDownload = page.waitForEvent("download");
  await exportImage(page, "PNG");
  const png = await readFile((await (await pngDownload).path())!);
  const raster = await page.evaluate(async (bytes) => {
    const bitmap = await createImageBitmap(
      new Blob([new Uint8Array(bytes)], { type: "image/png" }),
    );
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let shaded = 0;
    for (let i = 0; i < data.length; i += 4)
      if (data[i] !== data[0] || data[i + 1] !== data[1]) shaded++;
    return { size: [bitmap.width, bitmap.height], shaded };
  }, Array.from(png));
  expect(raster.size).toEqual([2000, 1520]);
  // Far more of the raster is shaded than lines alone would cover.
  expect(raster.shaded / (2000 * 1520)).toBeGreaterThan(0.1);
  expect(violations).toEqual([]);
});

for (const mode of ["hold", "current", "follow", "fit"]) {
  test(`coefficient animation reaches endpoints with ${mode} camera`, async ({
    page,
  }) => {
    await ready(page, clifford);
    await input(page, "Accumulated iterates").fill("100000");
    await settled(page);
    const original = (await definition(page)).curve;
    await openAnimation(page);
    await page
      .getByRole("combobox", { name: "Animate", exact: true })
      .selectOption("parameters");
    await expect(
      page.getByRole("combobox", { name: "Parameter 1", exact: true }),
    ).toHaveValue("mapA");
    await page.getByRole("textbox", { name: "Track 1 to" }).fill("-pi/2");
    await page.getByRole("button", { name: "Add parameter" }).click();
    await page
      .getByRole("combobox", { name: "Parameter 2", exact: true })
      .selectOption({ label: "Accumulated iterates" });
    await page.getByRole("textbox", { name: "Track 2 to" }).fill("30001");
    await page
      .getByRole("combobox", { name: "Animation camera" })
      .selectOption(mode);
    await page
      .getByRole("spinbutton", { name: "Duration (seconds)" })
      .fill(".2");
    await page.getByRole("button", { name: "Play animation" }).click();
    await expect(
      page.getByRole("button", { name: "Replay", exact: true }),
    ).toBeVisible();
    const curve = (await definition(page)).curve;
    expect(curve.attractor.a).toBe(-Math.PI / 2);
    expect(curve.attractor.iterates).toBe(30001);
    expect(await accumulated(page)).toBe(30001);
    await page.getByRole("button", { name: /^(Stop|Back to study)$/ }).click();
    expect((await definition(page)).curve).toEqual(original);
    expect(await accumulated(page)).toBe(100000);
  });
}

test("reveal accumulates the iterates in order, pauses, resumes, and an edit cancels", async ({
  page,
}) => {
  await ready(page, henon);
  const final = {
    width: await density(page).getAttribute("width"),
    height: await density(page).getAttribute("height"),
  };
  const total = await accumulated(page);
  await openAnimation(page);
  await expect(
    page.getByRole("combobox", { name: "Animate", exact: true }),
  ).toHaveValue("reveal");
  await expect(
    page.getByRole("option", { name: "Accumulate the iterates" }),
  ).toHaveCount(1);
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("3");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect.poll(() => progress(page)).toBeGreaterThan(0.1);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const paused = await progress(page);
  expect(paused).toBeLessThan(1);
  // A prefix of the iterates, in the final window: the image stays put.
  expect(await accumulated(page)).toBe(Math.round(paused * total));
  expect(await density(page).getAttribute("width")).toBe(final.width);
  expect(await density(page).getAttribute("height")).toBe(final.height);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  expect(await accumulated(page)).toBe(total);
  await page.getByRole("button", { name: "Replay", exact: true }).click();
  await expect.poll(() => progress(page)).toBeGreaterThan(0);
  await input(page, "Grid cells").fill("300");
  await settled(page);
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-progress",
  );
  expect((await definition(page)).curve.attractor.cells).toBe(300);
  expect(Number(await density(page).getAttribute("data-columns"))).toBe(300);
  expect(await accumulated(page)).toBe(total);
});

for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`attractor layout in ${theme} at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme });
      await ready(page, clifford);
      await page
        .getByRole("checkbox", { name: "Fit the window to the iterates" })
        .uncheck();
      await settled(page);
      await expect(note(page)).toBeVisible();
      // Paired fields share one row, even on a phone.
      for (const [a, b] of [
        ["Coefficient a", "Coefficient b"],
        ["Coefficient c", "Coefficient d"],
        ["Start x₀", "Start y₀"],
        ["Discarded iterates", "Accumulated iterates"],
        ["Window x from", "Window x to"],
        ["Window y from", "Window y to"],
      ]) {
        const [first, second] = await Promise.all(
          [a, b].map(async (name) => (await input(page, name).boundingBox())!),
        );
        expect(Math.abs(first.y - second.y)).toBeLessThan(1);
        expect(first.x).toBeLessThan(second.x);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: testInfo.outputPath(`attractor-${theme}-${width}.png`),
        fullPage: true,
      });
    });
  }
}
