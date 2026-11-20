import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  chooseColorScheme,
  chooseNotebook,
  choosePreset,
  exportImage,
  openShapeExport,
} from "./helpers";
import {
  correspondence,
  meta,
  openPreset,
  panel,
  pointOn,
  raster,
  roles,
  selectedField,
  settle,
} from "./hopf-helpers";
import { decodeVideo, frameDifference, probe } from "./video";
import { tesseractPresets } from "../web/tesseract/presets";
import { initialView } from "../web/tesseract/types";

// The great circle and spherical Lissajous base paths of Base sphere and
// fibers (docs/tesseracts.md, "Great circles and spherical Lissajous
// curves"). Expected points are the documented formulas, written out here.
const latitude = "A circle over every point";
const great = "A great circle, a leaning torus";
const lissajous = "A Lissajous path, a woven bouquet";
const greatAt = (beta: number, t: number) => [
  Math.cos(t),
  Math.cos(beta) * Math.sin(t),
  Math.sin(beta) * Math.sin(t),
];
const lissajousAt = (m1: number, m2: number, t: number) => [
  Math.sin(m2 * t) * Math.cos(m1 * t),
  Math.sin(m2 * t) * Math.sin(m1 * t),
  Math.cos(m2 * t),
];
const expectOn = (point: number[], want: number[]) =>
  point.forEach((v, i) => expect(v).toBeCloseTo(want[i], 12));
const basePath = (p: Page) =>
  p.getByRole("combobox", { name: "Base path", exact: true });
const tilt = (p: Page) =>
  p.getByRole("textbox", { name: "Tilt β", exact: true });
const azimuthal = (p: Page) =>
  p.getByRole("spinbutton", { name: "Azimuthal frequency m₁", exact: true });
const polar = (p: Page) =>
  p.getByRole("spinbutton", { name: "Polar frequency m₂", exact: true });
const motionLabels = (p: Page) =>
  p
    .getByRole("combobox", { name: "Animate", exact: true })
    .locator("option")
    .allTextContents();

test("each new path opens from an edited latitude with only its own controls, and returns", async ({
  page,
}) => {
  await openPreset(page, latitude);
  const alpha = page.getByRole("textbox", {
    name: "Central latitude α",
    exact: true,
  });
  await alpha.fill("0.6");
  await expect
    .poll(async () => (await meta(page)).config.weave.alpha)
    .toBe(0.6);
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("latitude");
  await settle(page);

  await basePath(page).selectOption("great-circle");
  await settle(page);
  // Only the great circle's tilt; the latitude's α, sweep and endpoints
  // are not part of this path.
  await expect(tilt(page)).toHaveValue("0");
  await expect(alpha).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Latitude start", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Animate", exact: true }),
  ).toHaveValue("trace");
  const offered = await motionLabels(page);
  expect(offered[0]).toBe("Trace the great circle");
  expect(offered).not.toContain("Sweep latitudes");
  await expect(
    page.getByRole("spinbutton", {
      name: "Fibers on the great circle",
      exact: true,
    }),
  ).toHaveValue("12");
  let c = (await correspondence(page)).base;
  expect(c).toMatchObject({ path: "great-circle", period: 2 * Math.PI });
  expectOn(c.base, [1, 0, 0]);

  // Sample 4 of 12 is t = π/2: on a meridian, the exact north pole.
  await tilt(page).fill("pi/2");
  await expect
    .poll(async () => (await meta(page)).config.weave.tilt)
    .toBe(Math.PI / 2);
  await selectedField(page).fill("4");
  await settle(page);
  expect((await correspondence(page)).base.base).toEqual([0, 0, 1]);
  for (const bad of ["4", "-0.1", "t", "1/0"]) {
    await tilt(page).fill(bad);
    await expect(page.getByRole("alert")).toBeVisible();
  }
  await tilt(page).fill("4");
  await expect(page.getByRole("alert")).toContainText(
    "Tilt β must be between 0 and π",
  );
  await tilt(page).fill("3*pi/4");
  await settle(page);
  await expect(page.getByRole("alert")).toHaveCount(0);

  await basePath(page).selectOption("lissajous");
  await settle(page);
  await expect(azimuthal(page)).toHaveValue("2");
  await expect(polar(page)).toHaveValue("1");
  await expect(tilt(page)).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  for (const [field, bad, message] of [
    [azimuthal, "2.5", "Azimuthal frequency m₁ must be a whole number"],
    [azimuthal, "9", "Azimuthal frequency m₁"],
    [azimuthal, "0", "Azimuthal frequency m₁"],
    [polar, "9", "Polar frequency m₂"],
  ] as const) {
    await field(page).fill(bad);
    await expect(page.getByRole("alert")).toContainText(message);
    await field(page).fill(field === azimuthal ? "2" : "1");
    await settle(page);
  }
  // m = (1, 2) at 8 samples returns to each pole twice: those samples
  // share one drawn fiber, and the entered selection is kept.
  await azimuthal(page).fill("1");
  await polar(page).fill("2");
  await page
    .getByRole("spinbutton", {
      name: "Fibers on the Lissajous curve",
      exact: true,
    })
    .fill("8");
  await settle(page);
  await selectedField(page).fill("5");
  await settle(page);
  c = (await correspondence(page)).base;
  expect(c).toMatchObject({
    path: "lissajous",
    selected: 4,
    coincident: true,
    base: [0, 0, 1],
    aliases: [0, 1, 2, 3, 0, 5, 2, 7],
  });
  await expect(panel(page, "base").locator("g[data-sample]")).toHaveCount(6);
  await expect(
    panel(page, "base").locator('[data-correspondence="moving"]'),
  ).toHaveAttribute("data-sample", "4");

  // Each path keeps its own edits; the latitude's α and sweep return.
  await basePath(page).selectOption("great-circle");
  await settle(page);
  expect((await meta(page)).config.weave.tilt).toBe((3 * Math.PI) / 4);
  await basePath(page).selectOption("latitude");
  await settle(page);
  await expect(alpha).toHaveValue("0.6");
  expect(await motionLabels(page)).toContain("Sweep latitudes");
});

for (const { preset, motion, at } of [
  {
    preset: great,
    motion: "phrase",
    at: (c: any, t: number) => greatAt(c.weave.tilt, t),
  },
  {
    preset: lissajous,
    motion: "trace",
    at: (c: any, t: number) => lissajousAt(c.weave.azimuthal, c.weave.polar, t),
  },
])
  test(`${preset} traces its path, scrubs both ways and returns whole`, async ({
    page,
  }) => {
    await openPreset(page, preset);
    const initial = await meta(page);
    await expect(
      page.getByRole("combobox", { name: "Animate", exact: true }),
    ).toHaveValue(motion);
    const first = await roles(page);
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await expect(page.locator('[data-source="weave/moving"]')).toHaveCount(1);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    // The great circle's phrase traces over its first 6 of 16 seconds,
    // then tilts the whole circle and its torus.
    for (const s of [0.3, 0.1, 0.6, 0.83, 0.2, 1, 0]) {
      await page
        .getByRole("slider", { name: "Animation progress" })
        .fill(String(s));
      await settle(page);
      const c = await correspondence(page);
      expect(c.base).toEqual(c.stereo);
      const config = (await meta(page)).config;
      expect(c.base.parameter).toBeGreaterThanOrEqual(0);
      expect(c.base.parameter).toBeLessThan(c.base.period);
      expectOn(c.base.base, at(config, c.base.parameter));
      if (s === 0 || s === 1) {
        expect(c.base.movingSample).toBe(0);
        expect(await roles(page)).toEqual(first);
      }
    }
    await page.getByRole("button", { name: /^(Stop|Back to study)$/ }).click();
    await settle(page);
    expect(await meta(page)).toEqual(initial);
  });

test("the great circle's phrase offers its tilt as a track", async ({
  page,
}) => {
  await openPreset(page, great);
  const c = (await meta(page)).config;
  expect(c.weave).toMatchObject({ path: "great-circle", selected: 0 });
  expect(c.weave.tilt).toBeCloseTo((3 * Math.PI) / 4, 15);
  await expect(page.getByText("Tilt over the poles")).toBeVisible();
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("slider", { name: "Animation progress" }).fill("0.687");
  await settle(page);
  // 8 ms before the eased tilt ends at 11 of 16 seconds, the circle is
  // within 10⁻⁴ of π/4.
  expect((await meta(page)).config.weave.tilt).toBeCloseTo(Math.PI / 4, 4);
});

for (const preset of [great, lissajous])
  test(`the traced motion of ${preset} exports both panes with its duration and endpoints`, async ({
    page,
  }) => {
    test.slow();
    await openPreset(page, preset);
    await page
      .getByRole("combobox", { name: "Animate", exact: true })
      .selectOption("trace");
    await page
      .getByRole("combobox", { name: "Repeat", exact: true })
      .selectOption("loop");
    await page
      .getByRole("spinbutton", { name: "Duration (seconds)" })
      .fill("1");
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const references: number[][] = [];
    for (const s of [0, 0.4]) {
      await page
        .getByRole("slider", { name: "Animation progress" })
        .fill(String(s));
      await settle(page);
      references.push(await raster(page, 1000, 380));
    }
    await openShapeExport(page);
    await page
      .getByRole("combobox", { name: "Export format" })
      .selectOption("mp4");
    await page
      .getByRole("slider", { name: "Export resolution", exact: true })
      .fill("0.5");
    await page
      .getByRole("combobox", { name: "Export frame rate" })
      .selectOption("15");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /^Export MP4 video/ }).click();
    const path = (await (await download).path())!;
    const p = probe(path);
    if (p) {
      expect([p.width, p.height, p.frames]).toEqual([1000, 380, 15]);
      expect(p.durations.reduce((a, b) => a + b, 0)).toBe(1000);
    }
    expect(
      (await decodeVideo(page, await readFile(path))).duration,
    ).toBeCloseTo(1, 3);
    for (const [k, index] of [0, 6].entries()) {
      const d = frameDifference(path, 1000, 380, index, references[k]);
      if (d) {
        expect(d.meanDifference).toBeLessThan(6);
        expect(d.unmatchedInk).toBeLessThan(0.02);
      }
    }
  });

test("an edited Lissajous link and still preserve both cameras, controls and appearance", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openPreset(page, lissajous);
  await azimuthal(page).fill("3");
  await polar(page).fill("2");
  await settle(page);
  await selectedField(page).fill("9");
  await panel(page, "base").focus();
  await page.keyboard.press("ArrowUp");
  await panel(page, "stereo").focus();
  await page.keyboard.press("ArrowRight");
  await settle(page);
  await chooseColorScheme(page, "cobalt");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(
    panel(page, "stereo").locator('[data-correspondence="moving"]'),
  ).toHaveAttribute("stroke", "#ff9fbd");
  await settle(page);
  const live = await meta(page);
  expect(live.config.weave).toMatchObject({
    path: "lissajous",
    azimuthal: 3,
    polar: 2,
    selected: 8,
  });
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const svg = await readFile((await (await download).path())!, "utf8");
  const m = JSON.parse(
    svg.match(/<desc>([^<]*)<\/desc>/)![1].replace(/&quot;/g, '"'),
  );
  expect(m.config).toEqual(live.config);
  expect(m.views).toEqual(live.views);
  expect(svg).not.toMatch(/<text|<foreignObject/);
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  await page.goto("about:blank");
  await page.goto(url.replace(/^https?:\/\/[^/]+/, ""));
  await settle(page);
  expect((await meta(page)).config).toEqual(live.config);
  expect((await meta(page)).views).toEqual(live.views);
});

for (const size of [
  { width: 1440, height: 650 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
])
  test(`great circle walkthrough keeps controls, both panes and paired export reachable (${size.width}×${size.height})`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: size,
      hasTouch: size.width < 1000,
      isMobile: size.width < 1000,
    });
    const page = await context.newPage();
    await openPreset(page, great);
    await expect(panel(page, "base")).toBeVisible();
    await expect(panel(page, "stereo")).toBeVisible();
    const fits = () =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      );
    expect(await fits()).toBe(true);
    await tilt(page).fill("pi+0.01");
    await expect(page.getByRole("alert")).toBeVisible();
    await tilt(page).fill("2*pi/3");
    await settle(page);
    await panel(page, "base").scrollIntoViewIfNeeded();
    const at = await pointOn(
      page,
      'svg[data-representation="base"] g[data-sample="3"]',
    );
    if (size.width < 1000) await page.touchscreen.tap(at.x, at.y);
    else await page.mouse.click(at.x, at.y);
    await settle(page);
    await expect(selectedField(page)).toHaveValue("4");
    await page
      .getByRole("combobox", { name: "Animate", exact: true })
      .selectOption("trace");
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await expect(page.locator('[data-source="weave/moving"]')).toHaveCount(1);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.getByRole("slider", { name: "Animation progress" }).fill("0.37");
    await settle(page);
    expect(await fits()).toBe(true);
    await page.getByRole("button", { name: /^(Stop|Back to study)$/ }).click();
    await settle(page);
    const entered = await meta(page);
    await chooseNotebook(page, "2d");
    await chooseNotebook(page, "4d");
    await settle(page);
    expect((await meta(page)).config).toEqual(entered.config);
    expect((await meta(page)).views).toEqual(entered.views);
    const download = page.waitForEvent("download");
    await exportImage(page, "SVG");
    const svg = await readFile((await (await download).path())!, "utf8");
    expect(svg).toContain('data-representation="base"');
    expect(svg).toContain('data-representation="stereo"');
    await context.close();
  });

test("opening either frequency's help never moves the field beside it", async ({
  page,
}) => {
  await openPreset(page, lissajous);
  // Within their shared row, so sidebar scrolling cannot move the measure.
  const inRow = (field: ReturnType<typeof polar>) =>
    field.evaluate(
      (e) =>
        e.getBoundingClientRect().top -
        e.closest(".pair")!.getBoundingClientRect().top,
    );
  for (const [about, beside] of [
    ["About Azimuthal frequency m₁", polar],
    ["About Polar frequency m₂", azimuthal],
  ] as const) {
    const before = await inRow(beside(page));
    await page.getByRole("button", { name: about, exact: true }).click();
    expect(await inRow(beside(page))).toBe(before);
    await page.getByRole("button", { name: about, exact: true }).click();
  }
});

// The Lissajous example opens at its own two cameras. Reset view and each
// pane's Home return there while the study is the example's, as a 3D
// example's do; another example or a link replaces them.
test("the Lissajous example opens at its own cameras, and Reset view and Home return there", async ({
  page,
}) => {
  const preset = tesseractPresets.find((p) => p.name === lissajous)!;
  const cameras = async () => {
    const [base, stereo] = (await meta(page)).views;
    return { diagramView: base.view, view: stereo.view };
  };
  const authored = { diagramView: preset.diagramView, view: preset.view };
  expect(authored.view).toBeDefined();
  await openPreset(page, lissajous);
  expect(await cameras()).toEqual(authored);
  for (const mode of ["stereo", "base"] as const) {
    await panel(page, mode).focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("+");
  }
  // An edit keeps the example's cameras as home.
  await selectedField(page).fill("3");
  await settle(page);
  expect(await cameras()).not.toEqual(authored);
  await page.getByRole("button", { name: "Reset view", exact: true }).click();
  expect(await cameras()).toEqual(authored);
  await panel(page, "base").focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Home");
  await panel(page, "stereo").focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Home");
  expect(await cameras()).toEqual(authored);
  // Another example opens and resets to the default cameras.
  await choosePreset(page, { label: latitude });
  await settle(page);
  const plain = { diagramView: initialView, view: initialView };
  expect(await cameras()).toEqual(plain);
  await panel(page, "stereo").focus();
  await page.keyboard.press("ArrowLeft");
  await page.getByRole("button", { name: "Reset view", exact: true }).click();
  expect(await cameras()).toEqual(plain);
});

// An example's own cameras are part of its picture: its thumbnail goes
// stale when they change. Examples without them keep the fingerprints they
// had before 4D examples could carry cameras.
test("a 4D example's thumbnail fingerprint covers its own cameras", async ({
  page,
}) => {
  const fnv = (value: unknown) => {
    let hash = 0x811c9dc5;
    for (const c of JSON.stringify(value))
      hash = Math.imul(hash ^ c.codePointAt(0)!, 0x01000193) >>> 0;
    return hash.toString(16).padStart(8, "0");
  };
  await page.goto("/?study=4d");
  await page
    .getByRole("button", { name: "Browse notebook examples", exact: true })
    .click();
  const card = (name: string) =>
    page
      .getByRole("dialog", { name: "Notebook examples" })
      .getByRole("button", { name, exact: true });
  // Hashed here from exact constants; transcendental values can differ in
  // their last bit between Node and the browser, so the gallery spec checks
  // every other recorded fingerprint against the browser's own.
  const named = (name: string) =>
    tesseractPresets.find((p) => p.name === name)!;
  const own = named(lissajous);
  await expect(card(lissajous)).toHaveAttribute(
    "data-fingerprint",
    fnv({ config: own.config, view: own.view, diagramView: own.diagramView }),
  );
  expect(
    fnv({ config: own.config, view: own.view, diagramView: own.diagramView }),
  ).not.toBe(fnv(own.config));
  for (const name of [great, latitude])
    await expect(card(name)).toHaveAttribute(
      "data-fingerprint",
      fnv(named(name).config),
    );
});
