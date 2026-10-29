import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  applyTracks,
  availableTargets,
  reveal,
  targetLabel,
  targetValue,
} from "../web/animation";
import { contourNote } from "../web/contour";
import { fitFrame } from "../web/Plot";
import { presets } from "../web/presets";
import type { ContourResult, Result, Vec } from "../web/types";
import {
  exportImage,
  openAnimation,
  choosePreset,
  openExportSettings,
  chooseColorScheme,
  imageButton,
} from "./helpers";
import { wireStudy } from "./study-link-wire";

const cassini = "Cassini ovals & the lemniscate";
const circles = "Circles through two points";
const nodalTitles = [
  "Two modes trading places",
  "A lattice changing its mind",
  "An engraving of standing waves",
];
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
const note = (page: Page) => page.getByTestId("contour-note");
const curves = (page: Page) => page.getByTestId("contour-path");
const family = (page: Page) => page.getByTestId("contour-family");
const normals = (page: Page) => page.getByTestId("contour-normal");
const scale = async (page: Page) =>
  Number(await page.locator("#artwork").getAttribute("data-camera-scale"));
// Drawing coordinates of a screen point, from the camera's center and scale.
async function camera(page: Page) {
  const [cx, cy] = (await page
    .locator("#artwork")
    .getAttribute("data-camera-center"))!
    .split(",")
    .map(Number);
  const s = await scale(page);
  return {
    screen: (p: Vec) => ({ x: 500 + (p.x - cx) * s, y: 380 - (p.y - cy) * s }),
    plot: ([x, y]: number[]) => ({
      x: cx + (x - 500) / s,
      y: cy - (y - 380) / s,
    }),
  };
}
// Each drawn contour's vertices in screen units, and whether it is closed.
const drawn = (page: Page, id = "contour-path") =>
  page.getByTestId(id).evaluateAll((all) =>
    all.map((p) => {
      const d = p.getAttribute("d")!;
      return {
        closed: d.endsWith("Z"),
        points: d
          .replace("Z", "")
          .split(/[ML]/)
          .filter(Boolean)
          .map((xy) => xy.split(",").map(Number)),
      };
    }),
  );
const cassiniF = (p: Vec) =>
  ((p.x - 1) ** 2 + p.y ** 2) * ((p.x + 1) ** 2 + p.y ** 2);

test("three nodal studies carry literal equal-eigenvalue modes and full-period animations", () => {
  const pairs = [
    [1, 2],
    [2, 3],
    [3, 5],
  ];
  expect(presets).toHaveLength(72);
  for (const [i, title] of nodalTitles.entries()) {
    const p = presets.find((p) => p.title === title);
    expect(p, title).toBeDefined();
    const [m, n] = pairs[i];
    expect(p!.config.curve.format).toBe("implicit");
    expect(p!.config.curve.implicit.f).toBe(
      `cos(a)*sin(${m}*pi*x)*sin(${n}*pi*y)+sin(a)*sin(${n}*pi*x)*sin(${m}*pi*y)`,
    );
    expect(p!.config.curve.implicit.level).toBe(0);
    expect(p!.animation).toMatchObject({
      mode: "parameters",
      camera: "hold",
      repeat: "loop",
      pace: "steady",
      tracks: [{ target: "a" }],
    });
  }
  expect(preset(nodalTitles[0]).curve.implicit.family.enabled).toBe(false);
  expect(preset(nodalTitles[2]).curve.implicit.family.enabled).toBe(true);
  expect(preset(nodalTitles[2]).curve.implicit).toMatchObject({
    cells: 96,
    stableNormals: true,
  });
});

test("anchored normals are editable, move only the arrows, and travel in a copied link", async ({
  page,
}) => {
  await ready(page, nodalTitles[2]);
  const stable = page.getByRole("checkbox", {
    name: "Anchor contour normals",
    exact: true,
  });
  await expect(stable).toBeChecked();
  const arrows = () =>
    normals(page).evaluateAll((all) => all.map((n) => n.outerHTML));
  const geometry = await drawn(page);
  const anchored = await arrows();
  await stable.uncheck();
  await expect
    .poll(async () => (await definition(page)).curve.implicit.stableNormals)
    .toBe(false);
  await settled(page);
  await expect.poll(arrows).not.toEqual(anchored);
  expect(await drawn(page)).toEqual(geometry);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  const other = await page.context().newPage();
  await other.goto(link);
  await expect(
    other.getByRole("checkbox", {
      name: "Anchor contour normals",
      exact: true,
    }),
  ).not.toBeChecked();
  await other.close();
  await choosePreset(page, { label: nodalTitles[2] });
  await expect(stable).toBeChecked();
  await settled(page);
  await expect.poll(arrows).toEqual(anchored);
});

for (const theme of ["light", "dark"] as const)
  test(`contour checkbox labels match existing checkbox text in ${theme}`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ colorScheme: theme });
    await ready(page, nodalTitles[2]);
    const textStyle = async (name: string) =>
      page
        .getByRole("checkbox", { name, exact: true })
        .evaluate((input: HTMLInputElement) => {
          const style = getComputedStyle(input.labels![0]);
          return {
            color: style.color,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
          };
        });
    const expected = await textStyle("Family of levels");
    expect(await textStyle("Anchor contour normals")).toEqual(expected);
    // Stacked checkboxes are spaced as the drawing's layer checkboxes are,
    // box to box, within a pixel: a label's line height, which centers each
    // box, differs between platforms' fonts (13px here on macOS, 14px on
    // Linux), while the help toggle beside the anchor does not.
    const top = (name: string) =>
      page.getByRole("checkbox", { name, exact: true }).evaluate((input) => {
        const r = input.getBoundingClientRect();
        return { y: r.top, height: r.height };
      });
    const family = await top("Family of levels");
    const anchor = await top("Anchor contour normals");
    const curve = await top("Curve F = c");
    const construction = await top("Construction lines");
    const gap = anchor.y - (family.y + family.height);
    const layers = construction.y - (curve.y + curve.height);
    expect(
      Math.abs(gap - layers),
      `${gap} beside ${layers}`,
    ).toBeLessThanOrEqual(1);
    await page
      .locator(".check-setting")
      .first()
      .screenshot({ path: info.outputPath(`checkbox-${theme}.png`) });
  });

for (const [index, title] of nodalTitles.entries()) {
  test(`${title}: its own animation keeps enabled geometry, pauses, scrubs, stops, and invalidates on edit`, async ({
    page,
  }) => {
    await ready(page, title);
    const original = await definition(page);
    const opening = await drawn(page);
    expect(opening.length).toBeGreaterThan(0);
    expect(opening.flatMap((c) => c.points).length).toBeGreaterThan(40);
    await expect(normals(page)).toHaveCount(preset(title).lines);
    await expect(page.locator("#artwork text")).toHaveCount(0);
    await expect(page.locator("#artwork")).not.toHaveAttribute(
      "data-animation-progress",
    );
    await openAnimation(page);
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Pause", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".animation-error")).toHaveCount(0);
    await expect.poll(() => progress(page)).toBeGreaterThan(0.01);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const paused = await progress(page);
    await expect.poll(() => progress(page)).toBe(paused);
    await page.getByRole("slider", { name: "Animation progress" }).fill("0.25");
    await expect(page.locator("#artwork")).toHaveAttribute(
      "data-animation-progress",
      "0.25",
    );
    const quarter = await definition(page);
    expect(quarter.curve.a).toBeCloseTo(original.curve.a + Math.PI / 2, 12);
    expect(await drawn(page)).not.toEqual(opening);
    await expect(normals(page)).toHaveCount(preset(title).lines);
    if (index === 2) expect(await family(page).count()).toBeGreaterThan(6);
    else await expect(family(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await expect.poll(() => progress(page)).not.toBe(0.25);
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await settled(page);
    expect(await definition(page)).toEqual(original);
    expect(await drawn(page)).toEqual(opening);
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await expect.poll(() => progress(page)).toBeGreaterThan(0);
    await input(page, "Shape parameter a").fill("pi/7");
    await expect
      .poll(async () => (await definition(page)).curve.a)
      .toBeCloseTo(Math.PI / 7, 12);
    await expect(page.locator("#artwork")).not.toHaveAttribute(
      "data-animation-progress",
    );
    await input(page, "Level c").fill("1/10");
    await expect
      .poll(async () => (await definition(page)).curve.implicit.level)
      .toBe(0.1);
    await input(page, "Grid cells").fill("96");
    await expect
      .poll(async () => (await definition(page)).curve.implicit.cells)
      .toBe(96);
    await settled(page);
    expect((await drawn(page)).flatMap((c) => c.points).length).toBeGreaterThan(
      40,
    );
    // Copy the edited study, then replace it with an example before opening
    // its link in another tab. Read the link with an independent decoder.
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "Copy link", exact: true }).click();
    await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    const saved = wireStudy(link.split("#s=")[1]);
    expect(saved.config.curve.implicit.cells).toBe(96);
    expect(saved.config.curve.implicit.level).toBe(0.1);
    await choosePreset(page, { label: title });
    await expect.poll(() => definition(page)).toEqual(original);
    const other = await page.context().newPage();
    await other.goto(link);
    await expect.poll(() => other.evaluate(() => location.hash)).toBe("");
    await expect.poll(() => definition(other)).toEqual(saved.config);
    expect(await drawn(other)).not.toEqual(opening);
    await other.close();
  });
}

test("pending scalar edits cannot overwrite any nodal preset replacement", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    (window as any).holdNodalScalars = false;
    (window as any).releaseNodalScalar = null;
    Worker.prototype.postMessage = function (message: any, ...rest: any[]) {
      if ((window as any).holdNodalScalars && message.action === "scalars")
        (window as any).releaseNodalScalar = () =>
          send.call(this, message, ...rest);
      else send.call(this, message, ...rest);
    };
  });
  await ready(page, cassini);
  for (const title of nodalTitles) {
    await page.evaluate(() => {
      (window as any).holdNodalScalars = true;
      (window as any).releaseNodalScalar = null;
    });
    await input(page, "Level c").fill("pi/13");
    await expect
      .poll(() => page.evaluate(() => !!(window as any).releaseNodalScalar))
      .toBe(true);
    await choosePreset(page, { label: title });
    await page.evaluate(() => {
      (window as any).holdNodalScalars = false;
      (window as any).releaseNodalScalar();
    });
    await expect(input(page, "Level c")).toHaveValue("0");
    await expect.poll(() => definition(page)).toEqual(preset(title));
    // Round-trip a fresh scalar request so the superseded reply has arrived.
    await input(page, "Shape parameter a").fill("pi/7");
    await expect
      .poll(async () => (await definition(page)).curve.a)
      .toBeCloseTo(Math.PI / 7, 12);
    expect((await definition(page)).curve.implicit.level).toBe(0);
  }
});

test("nodal still exports preserve the actual paths, nearby levels and metadata", async ({
  page,
}) => {
  await ready(page, nodalTitles[2]);
  const live = await page
    .locator("#artwork path")
    .evaluateAll((all) => all.map((p) => p.getAttribute("d")));
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const svg = await readFile((await (await download).path())!, "utf8");
  const saved = await page.evaluate((s) => {
    const doc = new DOMParser().parseFromString(s, "image/svg+xml");
    return {
      config: JSON.parse(doc.querySelector("desc")!.textContent!),
      paths: [...doc.querySelectorAll("path")].map((p) => p.getAttribute("d")),
      text: doc.querySelectorAll("text").length,
    };
  }, svg);
  expect(saved.config).toEqual(preset(nodalTitles[2]));
  expect(saved.paths).toEqual(live);
  expect(saved.paths.length).toBeGreaterThan(12);
  expect(saved.text).toBe(0);
});

test("a full-period nodal WebP decodes with exact duration and matching endpoints", async ({
  page,
}) => {
  await ready(page, nodalTitles[2]);
  await imageButton(page).click();
  await page
    .getByRole("menuitemradio", { name: "1000 × 760", exact: true })
    .click();
  const stillDownload = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /^PNG image/ }).click();
  const still = await readFile((await (await stillDownload).path())!);
  const opening = await page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 250;
    canvas.height = 190;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0, 250, 190);
    return Array.from(ctx.getImageData(0, 0, 250, 190).data);
  }, still.toString("base64"));
  await openExportSettings(page);
  await input(page, "Repeat").selectOption("once");
  await input(page, "Duration (seconds)").fill(".4");
  await input(page, "Export frame rate").selectOption("15");
  await input(page, "Export resolution").fill("1");
  await input(page, "Export format").selectOption("webp");
  await input(page, "Export quality").fill("100");
  await input(page, "Loop exported animation").uncheck();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Export animated WebP/ }).click();
  const bytes = await readFile((await (await download).path())!);
  const frames = await page.evaluate(async (data) => {
    const decoder = new (window as any).ImageDecoder({
      data: new Uint8Array(data),
      type: "image/webp",
    });
    await decoder.tracks.ready;
    const out: { duration: number; pixels: number[] }[] = [];
    const canvas = document.createElement("canvas");
    canvas.width = 250;
    canvas.height = 190;
    const ctx = canvas.getContext("2d")!;
    for (let i = 0; i < decoder.tracks.selectedTrack.frameCount; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      ctx.drawImage(image, 0, 0, 250, 190);
      out.push({
        duration: image.duration / 1000,
        pixels: Array.from(ctx.getImageData(0, 0, 250, 190).data),
      });
      image.close();
    }
    decoder.close();
    return out;
  }, Array.from(bytes));
  expect(frames).toHaveLength(6);
  expect(frames.reduce((s, f) => s + f.duration, 0)).toBe(400);
  const difference = (a: number[], b: number[]) =>
    a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;
  expect(difference(frames[0].pixels, opening)).toBeLessThan(0.3);
  expect(difference(frames[0].pixels, frames[5].pixels)).toBeLessThan(0.15);
  expect(difference(frames[0].pixels, frames[2].pixels)).toBeGreaterThan(0.5);
  await expect.poll(() => definition(page)).toEqual(preset(nodalTitles[2]));
});

for (const theme of ["light", "dark"] as const)
  test(`nodal artwork stays readable at phone width in ${theme} with an alternate palette`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: theme });
    await ready(page, nodalTitles[0]);
    await chooseColorScheme(page, "cobalt");
    for (const title of nodalTitles) {
      await choosePreset(page, { label: title });
      await expect.poll(() => definition(page)).toEqual(preset(title));
      await settled(page);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(390);
      await expect(page.locator("#artwork text")).toHaveCount(0);
      await page.locator("#artwork").screenshot({
        path: info.outputPath(`${nodalTitles.indexOf(title)}-${theme}.png`),
      });
    }
  });

test("the implicit presets are Cassini ovals and circles through two points", () => {
  const ovals = preset(cassini);
  expect(ovals.curve.format).toBe("implicit");
  expect(ovals.curve.a).toBe(1);
  expect(ovals.curve.implicit).toEqual({
    f: "((x-a)^2+y^2)*((x+a)^2+y^2)",
    level: 1,
    family: { enabled: true, from: 0.2, to: 2.6, count: 9 },
    window: { xMin: -2, xMax: 2, yMin: -1.5, yMax: 1.5 },
    cells: 160,
  });
  expect(ovals.lines).toBe(48);
  const pole = preset(circles);
  expect(pole.curve.implicit.f).toBe("y/(x^2+y^2-a^2)");
  expect(pole.curve.implicit.family).toEqual({
    enabled: true,
    from: -2,
    to: 2,
    count: 9,
  });
  expect(pole.curve.implicit.window).toEqual({
    xMin: -2.5,
    xMax: 2.5,
    yMin: -2,
    yMax: 2,
  });
});

test("the level, window, family, and grid are animatable, and so is a", () => {
  const config = preset(cassini);
  const targets = availableTargets(config);
  expect(targets.slice(0, 9)).toEqual([
    "contourLevel",
    "windowXMin",
    "windowXMax",
    "windowYMin",
    "windowYMax",
    "levelsFrom",
    "levelsTo",
    "levelsCount",
    "contourCells",
  ]);
  // F may use a; the domain and samples play no part, and neither does
  // any construction.
  expect(targets).toContain("a");
  expect(targets).toContain("lines");
  for (const t of ["min", "max", "samples", "poleX", "offset"] as const)
    expect(targets).not.toContain(t);
  expect(availableTargets({ ...config, kind: "pedal" }).includes("poleX")).toBe(
    false,
  );
  const single = {
    ...config,
    curve: {
      ...config.curve,
      implicit: {
        ...config.curve.implicit,
        family: { ...config.curve.implicit.family, enabled: false },
      },
    },
  };
  expect(availableTargets(single)).not.toContain("levelsFrom");
  expect(targetLabel("contourLevel")).toBe("Level c");
  expect(targetLabel("windowYMax")).toBe("Window y to");
  expect(targetLabel("levelsCount")).toBe("Level count");
  expect(targetLabel("contourCells")).toBe("Grid cells");
  expect(targetValue(config, "contourLevel", 1)).toBe(1);
  expect(targetValue(config, "windowXMin", 1)).toBe(-2);
  expect(targetValue(config, "levelsTo", 1)).toBe(2.6);
  expect(targetValue(config, "contourCells", 1)).toBe(160);
  const tracks = [
    { target: "contourLevel" as const, from: 1, to: Math.PI / 4 },
    { target: "windowXMax" as const, from: 2, to: Math.E },
    { target: "levelsCount" as const, from: 9, to: 4 },
    { target: "contourCells" as const, from: 160, to: 40 },
    { target: "a" as const, from: 1, to: 1.2 },
  ];
  const end = applyTracks(config, tracks, 1, 1).config;
  expect(end.curve.implicit.level).toBe(Math.PI / 4);
  expect(end.curve.implicit.window.xMax).toBe(Math.E);
  expect(end.curve.implicit.family.count).toBe(4);
  expect(end.curve.implicit.cells).toBe(40);
  expect(end.curve.a).toBe(1.2);
  // Counts are whole numbers throughout.
  const mid = applyTracks(config, tracks, 0.3, 1).config;
  expect(Number.isInteger(mid.curve.implicit.family.count)).toBe(true);
  expect(Number.isInteger(mid.curve.implicit.cells)).toBe(true);
  expect(applyTracks(config, tracks, 0, 1).config).toEqual(config);
  expect(config.curve.implicit.level).toBe(1);
});

test("the contour note counts pieces, poles, and undefined points", () => {
  const result = (
    closed: boolean[],
    discontinuities = 0,
    nonfinite = 0,
  ): ContourResult => ({
    window: { xMin: 0, xMax: 1, yMin: 0, yMax: 1 },
    columns: 10,
    rows: 10,
    curve: {
      level: 1,
      contours: closed.map((c) => ({ points: [], closed: c })),
    },
    family: [],
    normals: [],
    discontinuities: Array.from({ length: discontinuities }, () => ({
      x: 0,
      y: 0,
    })),
    nonfinite,
  });
  expect(contourNote(result([]))).toBe(
    "F does not cross the level anywhere in the window, so there is no curve here. A level F only touches, at an isolated point or along a fold, is not drawn.",
  );
  expect(contourNote(result([true]))).toBe("The curve is one closed contour.");
  expect(contourNote(result([false]))).toBe(
    "The curve is one open contour, cut off at the window's edge or beside cells left out.",
  );
  expect(contourNote(result([true, true]))).toBe(
    "The curve has 2 closed contours.",
  );
  expect(contourNote(result([false, false, false]))).toBe(
    "The curve has 3 open contours, cut off at the window's edge or beside cells left out.",
  );
  expect(contourNote(result([true, false, true], 1, 1))).toBe(
    "The curve has 3 contours: 2 closed and 1 open, cut off at the window's edge or beside cells left out. " +
      "F changes sign without reaching the level across 1 grid edge, marked ×: a pole or a jump, not a curve, so no contour is drawn there. " +
      "F is not a finite number at 1 grid point of 121; the cells beside them are left out.",
  );
  expect(contourNote(result([true], 1312))).toContain("1,312 grid edges");
});

test("reveal draws every contour along together; the window frames the drawing", () => {
  const point = (x: number, y = 0): Vec => ({ x, y });
  const contours: ContourResult = {
    window: { xMin: -4, xMax: 4, yMin: -1, yMax: 3 },
    columns: 8,
    rows: 4,
    curve: {
      level: 1,
      contours: [
        { points: [0, 1, 2, 3].map((x) => point(x)), closed: true },
        { points: [point(0, 1), point(1, 1)], closed: false },
      ],
    },
    family: [
      {
        level: 2,
        contours: [
          {
            points: [0, 1, 2, 3, 4, 5, 6, 7].map((x) => point(x)),
            closed: true,
          },
        ],
      },
    ],
    normals: [0, 1, 2, 3].map((x) => ({ point: point(x), gradient: point(1) })),
    discontinuities: [point(9, 9)],
    nonfinite: 0,
  };
  const result: Result = {
    base: [],
    derived: [],
    virtual: [],
    rays: [],
    family: [],
    circles: [],
    rolling: [],
    contours,
    warnings: [],
    invalid: 0,
  };
  const half = reveal(result, 0.5);
  const shown = half.contours!;
  // A partly drawn loop is open until it is complete.
  expect(shown.curve.contours.map((c) => [c.points.length, c.closed])).toEqual([
    [2, false],
    [1, false],
  ]);
  expect(shown.family[0].contours[0].points).toHaveLength(4);
  expect(shown.normals.map((n) => n.point.x)).toEqual([0, 1]);
  expect(shown.window).toEqual(contours.window);
  expect(shown.discontinuities).toEqual(contours.discontinuities);
  expect(reveal(result, 0).contours!.normals).toEqual([]);
  expect(reveal(result, 1)).toEqual(result);
  // The window frames the drawing, wherever the contours are, and a pole
  // left over from another construction does not.
  const config = { ...preset(cassini), kind: "pedal" as const };
  config.pole = { x: 30, y: 0 };
  const frame = fitFrame(result, config);
  expect(frame.cx).toBe(0);
  expect(frame.cy).toBe(1);
  expect(frame.span).toBe(8);
});

test("the Cassini preset draws the lemniscate, its family, and normals", async ({
  page,
}) => {
  await ready(page, cassini);
  await expect(note(page)).toHaveText("The curve has 2 closed contours.");
  const { screen, plot } = await camera(page);
  const lobes = (await drawn(page)).map((c) => ({
    closed: c.closed,
    points: c.points.map(plot),
  }));
  // The lemniscate's two lobes meet at the origin, a grid point.
  expect(lobes).toHaveLength(2);
  for (const lobe of lobes) {
    expect(lobe.closed).toBe(true);
    const worst = Math.max(
      ...lobe.points.map((p) => Math.abs(cassiniF(p) - 1)),
    );
    expect(worst).toBeLessThan(1e-4);
    const side = Math.sign(lobe.points.find((p) => Math.abs(p.x) > 0.1)!.x);
    expect(lobe.points.every((p) => p.x * side >= -1e-6)).toBe(true);
  }
  // Nine family levels: two ovals each below the lemniscate, one above.
  const members = await drawn(page, "contour-family");
  expect(members).toHaveLength(3 * 2 + 6);
  // Each normal starts on the curve and points up F's gradient.
  const arrows = await normals(page).evaluateAll((all) =>
    all.map((p) =>
      p
        .getAttribute("d")!
        .split("M")[1]
        .split("L")
        .map((xy) => xy.split(",").map(Number)),
    ),
  );
  expect(arrows).toHaveLength(48);
  for (const [tail, tip] of arrows) {
    const p = plot(tail);
    expect(Math.abs(cassiniF(p) - 1)).toBeLessThan(1e-4);
    const g = {
      x:
        2 * (p.x - 1) * ((p.x + 1) ** 2 + p.y ** 2) +
        2 * (p.x + 1) * ((p.x - 1) ** 2 + p.y ** 2),
      y: 2 * p.y * ((p.x + 1) ** 2 + p.y ** 2 + (p.x - 1) ** 2 + p.y ** 2),
    };
    // Very near the saddle the gradient vanishes; elsewhere it is exact.
    if (Math.hypot(g.x, g.y) < 0.05) continue;
    const angle = Math.atan2(-(tip[1] - tail[1]), tip[0] - tail[0]);
    const off = Math.abs(
      ((angle - Math.atan2(g.y, g.x) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI,
    );
    expect(off).toBeLessThan(2e-3);
  }
  // The window's frame.
  const frame = page.getByTestId("contour-window");
  const corner = screen({ x: -2, y: 1.5 });
  expect(Number(await frame.getAttribute("x"))).toBeCloseTo(corner.x, 6);
  expect(Number(await frame.getAttribute("y"))).toBeCloseTo(corner.y, 6);
  expect(Number(await frame.getAttribute("width"))).toBeCloseTo(
    4 * (await scale(page)),
    6,
  );
  // No construction applies: its tabs are disabled, and so are its layers.
  for (const tab of ["evolute", "pedal", "inversion"])
    await expect(
      page.getByRole("button", { name: tab, exact: true }),
    ).toBeDisabled();
  await expect(page.getByText("03 / THE DRAWING")).toBeVisible();
  await expect(page.locator(".legend")).toHaveText("Curve F = c Other levels");
  await expect(page.getByLabel("Numerical samples")).toHaveCount(0);
  await expect(page.getByLabel("t from", { exact: true })).toHaveCount(0);
});

test("the level splits and joins the ovals; the family, grid, and errors", async ({
  page,
}) => {
  await ready(page, cassini);
  await input(page, "Level c").fill("0.9^4");
  await settled(page);
  expect((await definition(page)).curve.implicit.level).toBeCloseTo(0.6561, 15);
  await expect(note(page)).toHaveText("The curve has 2 closed contours.");
  const { plot } = await camera(page);
  const split = (await drawn(page)).map((c) => c.points.map(plot));
  expect(split).toHaveLength(2);
  // Nothing is joined across the saddle.
  for (const oval of split) {
    const side = Math.sign(oval[0].x);
    expect(oval.every((p) => p.x * side > 0)).toBe(true);
  }
  await input(page, "Level c").fill("1.1^4");
  await settled(page);
  await expect(note(page)).toHaveText("The curve is one closed contour.");
  await expect(curves(page)).toHaveCount(1);
  // The family goes; a coarser grid still finds the oval.
  await page.getByRole("checkbox", { name: "Family of levels" }).uncheck();
  await settled(page);
  await expect(family(page)).toHaveCount(0);
  await expect(input(page, "Levels from")).toHaveCount(0);
  await input(page, "Grid cells").fill("8");
  await settled(page);
  expect((await definition(page)).curve.implicit.cells).toBe(8);
  await expect(curves(page)).toHaveCount(1);
  await input(page, "Window x to").fill("0");
  await settled(page);
  await expect(note(page)).toHaveText(
    "The curve is one open contour, cut off at the window's edge or beside cells left out.",
  );
  await page.getByRole("textbox", { name: "F(x, y)" }).fill("x+t");
  await expect(page.getByRole("alert")).toContainText(
    "F(x, y) cannot use t; animate a or the level instead",
  );
  await page.getByRole("textbox", { name: "F(x, y)" }).fill("x+z");
  await expect(page.getByRole("alert")).toContainText(
    'F(x, y): unknown name "z"',
  );
  await page.getByRole("textbox", { name: "F(x, y)" }).fill("x^2+y^2");
  await input(page, "Window x from").fill("1");
  await expect(page.getByRole("alert")).toContainText("the window needs");
  await input(page, "Window x from").fill("-2");
  await input(page, "Level c").fill("-1");
  await settled(page);
  await expect(note(page)).toContainText("F does not cross the level");
  await expect(normals(page)).toHaveCount(0);
  // Constructions come back with a parametrized curve.
  await page
    .getByRole("combobox", { name: "Definition" })
    .selectOption("parametric");
  await settled(page);
  await expect(
    page.getByRole("button", { name: "pedal", exact: true }),
  ).toBeEnabled();
  await expect(curves(page)).toHaveCount(0);
});

test("circles through two points stop at the pole circle", async ({ page }) => {
  await ready(page, circles);
  await expect(note(page)).toHaveText(
    "The curve has 2 open contours, cut off at the window's edge or beside cells left out. " +
      "F changes sign without reaching the level across 312 grid edges, marked ×: a pole or a jump, not a curve, so no contour is drawn there. " +
      "F is not a finite number at 4 grid points of 32,361; the cells beside them are left out.",
  );
  const { plot } = await camera(page);
  // Level 1 is the circle through (±1, 0) about (0, ½): every drawn point
  // is on it, and none on the pole circle x² + y² = 1 in between.
  const arcs = (await drawn(page)).map((c) => c.points.map(plot));
  for (const arc of arcs)
    for (const p of arc) {
      expect(
        Math.abs(Math.hypot(p.x, p.y - 0.5) - Math.sqrt(1.25)),
      ).toBeLessThan(1e-4);
    }
  await expect(normals(page)).toHaveCount(40);
  // Each discontinuity is marked on the pole circle.
  const marks = await page
    .getByTestId("contour-break")
    .evaluateAll((all) =>
      all.map((m) => [
        Number(m.getAttribute("data-x")),
        Number(m.getAttribute("data-y")),
      ]),
    );
  expect(marks).toHaveLength(312);
  for (const [x, y] of marks)
    expect(Math.abs(Math.hypot(x, y) - 1)).toBeLessThan(1e-12);
});

test("an exported implicit curve keeps its contours, family, and normals", async ({
  page,
}) => {
  await ready(page, cassini);
  await input(page, "Level c").fill("pi/4");
  await settled(page);
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const saved = await download;
  expect(saved.suggestedFilename()).toBe("tangent-garden-implicit.svg");
  const svg = await readFile((await saved.path())!, "utf8");
  const exported = await page.evaluate((s) => {
    const doc = new DOMParser().parseFromString(s, "image/svg+xml");
    const count = (id: string) =>
      doc.querySelectorAll(`[data-testid="${id}"]`).length;
    return {
      config: JSON.parse(doc.querySelector("desc")!.textContent!),
      curves: count("contour-path"),
      family: count("contour-family"),
      normals: count("contour-normal"),
      window: count("contour-window"),
    };
  }, svg);
  expect(exported.config.curve.format).toBe("implicit");
  expect(exported.config.curve.implicit.level).toBe(Math.PI / 4);
  expect(exported.curves).toBe(2);
  expect(exported.family).toBe(await family(page).count());
  expect(exported.normals).toBe(48);
  expect(exported.window).toBe(1);
});

for (const mode of ["hold", "current", "follow", "fit"]) {
  test(`level animation reaches endpoints with ${mode} camera`, async ({
    page,
  }) => {
    await ready(page, cassini);
    const original = (await definition(page)).curve;
    await openAnimation(page);
    await page
      .getByRole("combobox", { name: "Animate", exact: true })
      .selectOption("parameters");
    const parameter = page.getByRole("combobox", {
      name: "Parameter 1",
      exact: true,
    });
    await expect(parameter).toHaveValue("contourLevel");
    await page.getByRole("textbox", { name: "Track 1 to" }).fill("pi/4");
    await page.getByRole("button", { name: "Add parameter" }).click();
    await page
      .getByRole("combobox", { name: "Parameter 2", exact: true })
      .selectOption({ label: "Window x to" });
    await page.getByRole("textbox", { name: "Track 2 to" }).fill("e");
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
    expect(curve.implicit.level).toBe(Math.PI / 4);
    expect(curve.implicit.window.xMax).toBe(Math.E);
    // Two ovals at the end, and the window drawn at its animated size.
    await expect(curves(page)).toHaveCount(2);
    expect(
      Number(await page.getByTestId("contour-window").getAttribute("width")),
    ).toBeCloseTo((2 + Math.E) * (await scale(page)), 6);
    await page.getByRole("button", { name: /^(Stop|Back to study)$/ }).click();
    expect((await definition(page)).curve).toEqual(original);
  });
}

test("reveal draws the contours along, pauses, resumes, and an edit cancels", async ({
  page,
}) => {
  await ready(page, cassini);
  const full = (await drawn(page)).map((c) => c.points.length);
  await openAnimation(page);
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("2");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect.poll(() => progress(page)).toBeGreaterThan(0.1);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const paused = await progress(page);
  expect(paused).toBeLessThan(1);
  const partial = await drawn(page);
  for (const [k, c] of partial.entries()) {
    expect(c.closed).toBe(false);
    expect(
      Math.abs(c.points.length - Math.ceil(paused * full[k])),
    ).toBeLessThanOrEqual(1);
  }
  const shownNormals = await normals(page).count();
  expect(Math.abs(shownNormals - Math.floor(paused * 48))).toBeLessThanOrEqual(
    1,
  );
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  await expect(normals(page)).toHaveCount(48);
  expect((await drawn(page)).every((c) => c.closed)).toBe(true);
  await page.getByRole("button", { name: "Replay", exact: true }).click();
  await expect.poll(() => progress(page)).toBeGreaterThan(0);
  await input(page, "Level c").fill("2");
  await settled(page);
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-progress",
  );
  expect((await definition(page)).curve.implicit.level).toBe(2);
});

for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`implicit layout in ${theme} at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme });
      await ready(page, circles);
      await expect(note(page)).toBeVisible();
      // Paired fields share one row, even on a phone.
      for (const [a, b] of [
        ["Window x from", "Window x to"],
        ["Window y from", "Window y to"],
        ["Levels from", "Levels to"],
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
        path: testInfo.outputPath(`implicit-${theme}-${width}.png`),
        fullPage: true,
      });
    });
  }
}
