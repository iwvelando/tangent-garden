import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { chooseColorScheme, exportImage, openShapeExport } from "./helpers";
import {
  correspondence,
  desc,
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
import { weaveAtlasPoints } from "../web/tesseract/atlas-pairs";
import { objects } from "../web/tesseract/objects";

// Neighborhood sampling of Base sphere and fibers (docs/tesseracts.md,
// "Neighborhoods"): k fibers at the centers of k equal cells of the
// stretch [c − wT/2, c + wT/2] around the moving point's parameter c.
// Expected parameters and points are written out here from the documented
// formulas.
const lissajous = "A Lissajous path, a woven bouquet";
const fan = "A short stretch, an opening fan";

const lissajousAt = (m1: number, m2: number, t: number) => {
  const p = [
    Math.sin(m2 * t) * Math.cos(m1 * t),
    Math.sin(m2 * t) * Math.sin(m1 * t),
    Math.cos(m2 * t),
  ];
  return Math.hypot(p[0], p[1]) <= 2e-12 ? [0, 0, Math.sign(p[2])] : p;
};
const reduced = (t: number, period: number) => {
  t -= period * Math.floor(t / period);
  return t >= period ? t - period : t;
};
const cells = (c: number, width: number, period: number, k: number) =>
  Array.from({ length: k }, (_, i) =>
    reduced(c + (width * period * (i - (k - 1) / 2)) / k, period),
  );
const gap = (a: number, b: number, period: number) => {
  const d = Math.abs(a - b);
  return Math.min(d, period - d);
};
const expectOn = (point: number[], want: number[]) =>
  point.forEach((v, i) => expect(v).toBeCloseTo(want[i], 12));

const sampling = (p: Page) =>
  p.getByRole("combobox", { name: "Fiber sampling", exact: true });
const width = (p: Page) =>
  p.getByRole("textbox", { name: "Neighborhood width", exact: true });
const nearby = (p: Page) =>
  p.getByRole("spinbutton", {
    name: "Fibers in the neighborhood",
    exact: true,
  });
const count = (p: Page, name: string) =>
  p.getByRole("spinbutton", { name, exact: true });
const fieldOf = (p: Page, control: ReturnType<typeof width>) =>
  p.locator(".field").filter({ has: control });
const button = (p: Page, name: string) =>
  p.getByRole("button", { name, exact: true });
const readout = (p: Page, label: string) =>
  p.locator(".lift-readout span", { hasText: label });

// Checks a neighborhood's returned markers against the Lissajous curve at
// the documented cell centers around the moving point.
async function expectCells(page: Page, m1: number, m2: number) {
  const c = (await correspondence(page)).base;
  const h = c.neighborhood;
  const period = c.period;
  const want = cells(c.parameter, h.width, period, h.fibers);
  expect(h.parameters).toHaveLength(h.fibers);
  h.parameters.forEach((s: number, i: number) =>
    expect(gap(s, want[i], period)).toBeLessThan(1e-14),
  );
  expect(h.from).toBeCloseTo(c.parameter - (h.width * period) / 2, 14);
  expect(h.to).toBeCloseTo(c.parameter + (h.width * period) / 2, 14);
  const base = await desc(page, "base");
  const near = base.markers.filter((m: any) => m.role === "near");
  const center = h.fibers % 2 ? (h.fibers - 1) / 2 : -1;
  expect(near).toHaveLength(h.fibers - (center >= 0 ? 1 : 0));
  for (const m of near) {
    const i = Number(/^weave\/near\/(\d+)\/base$/.exec(m.id)![1]);
    expect(i).not.toBe(center);
    expectOn(m.point, lissajousAt(m1, m2, h.parameters[i]));
  }
  return c;
}

// An atlas reserves at least the engine's own count before evaluation
// (engine4 neighborhoodPoints): k cells and the moving fiber, the window
// and globe guides, the base curve with its corners, the path's n points
// and the stretch. The largest is k = n = 32 at 256 arc samples on a
// 12-vertex polygon, 10,658 points.
test("an atlas reserves a neighborhood's counted points", () => {
  const c = objects.weave.defaults({} as any);
  c.mode = "paired";
  c.curves = 32;
  c.samples = 256;
  c.weave = {
    ...c.weave!,
    path: "polygon",
    vertices: Array.from({ length: 12 }, (_, i) => ({ u: i / 2, v: 0.5 })),
    sampling: "neighborhood",
    width: 0.9,
    nearby: 32,
  };
  const counted = (k: number, n: number, N: number, B: number, m: number) =>
    (k + 1) * (N + 2) +
    3 * (N + 1) +
    (N + 1) +
    3 * (N + 1) +
    k +
    1 +
    (B - N) +
    m +
    n +
    (B + m + 2);
  expect(counted(32, 32, 256, 256, 11)).toBe(10658);
  expect(weaveAtlasPoints(c)).toBeGreaterThanOrEqual(10658);
  for (const [k, n, N] of [
    [1, 32, 8],
    [32, 1, 8],
    [25, 32, 128],
  ]) {
    c.weave.nearby = k;
    c.curves = n;
    c.samples = N;
    expect(weaveAtlasPoints(c)).toBeGreaterThanOrEqual(counted(k, n, N, N, 11));
  }
});

test("a neighborhood opens from an edited whole path, keeps its selection, refuses bad entries by field, and returns", async ({
  page,
}) => {
  await openPreset(page, lissajous);
  await count(page, "Azimuthal frequency m₁").fill("3");
  await selectedField(page).fill("6");
  await settle(page);
  const whole = await meta(page);
  const wholeBase = await correspondence(page);
  const wholeRoles = await roles(page);
  await expect(width(page)).toHaveCount(0);

  await sampling(page).selectOption("neighborhood");
  await settle(page);
  // The absent fields show their defaults; the path's count now names its
  // points, and the selection is the same sample.
  await expect(width(page)).toHaveValue("0.125");
  await expect(nearby(page)).toHaveValue("17");
  await expect(count(page, "Points on the Lissajous curve")).toHaveValue("32");
  await expect(count(page, "Fibers on the Lissajous curve")).toHaveCount(0);
  await expect(selectedField(page)).toHaveValue("6");
  let c = await expectCells(page, 3, 1);
  expect(c).toMatchObject({ selected: 5, movingSample: 5 });
  expect(c.parameter).toBe(wholeBase.base.parameter);
  expect(c.neighborhood).toMatchObject({ width: 0.125, fibers: 17 });
  // Space draws the 16 cells beside the center and the moving fiber, which
  // is the selected sample's own; the base keeps the path's 32 points.
  const stereo = panel(page, "stereo");
  await expect(stereo.locator('[data-role="near"]')).toHaveCount(16);
  await expect(stereo.locator("[data-sample]")).toHaveCount(1);
  await expect(
    stereo.locator('[data-sample="5"][data-correspondence="moving"]'),
  ).toHaveCount(1);
  await expect(panel(page, "base").locator("g[data-sample]")).toHaveCount(32);
  await expect(
    panel(page, "base").locator('[data-role="neighborhood"]'),
  ).toHaveCount(1);
  await expect(readout(page, "Neighborhood from")).toBeVisible();
  await expect(readout(page, "Neighborhood to")).toBeVisible();
  await expect(page.locator(".tesseract-diagnostics")).toHaveText(
    "17 fibers over a stretch of one Lissajous curve of S², around the moving point. Open ends mark the projection window, not broken curves.",
  );

  // Each refusal stands under the field it names.
  for (const [bad, message] of [
    ["0", "Neighborhood width must be greater than 0 and at most 1"],
    ["1.5", "Neighborhood width must be greater than 0 and at most 1"],
    ["t", ""],
  ]) {
    await width(page).fill(bad);
    await expect(fieldOf(page, width(page)).getByRole("alert")).toContainText(
      message,
    );
  }
  await width(page).fill("1/5");
  for (const [bad, message] of [
    ["0", "Fibers in the neighborhood must be a whole number from 1 to 32"],
    ["33", "Fibers in the neighborhood must be a whole number from 1 to 32"],
    ["2.5", "Fibers in the neighborhood must be a whole number"],
  ]) {
    await nearby(page).fill(bad);
    await expect(fieldOf(page, nearby(page)).getByRole("alert")).toContainText(
      message,
    );
  }
  await nearby(page).fill("8");
  await settle(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  c = await expectCells(page, 3, 1);
  expect(c.neighborhood).toMatchObject({ width: 0.2, fibers: 8 });
  // An even count has no cell on the moving point: all eight are drawn.
  await expect(stereo.locator('[data-role="near"]')).toHaveCount(8);

  // The whole path returns as it was, keeping the neighborhood's fields.
  await sampling(page).selectOption("path");
  await settle(page);
  await expect(width(page)).toHaveCount(0);
  await expect(count(page, "Fibers on the Lissajous curve")).toHaveValue("32");
  expect((await meta(page)).config).toEqual({
    ...whole.config,
    weave: {
      ...whole.config.weave,
      sampling: "path",
      width: 0.2,
      nearby: 8,
    },
  });
  expect(await correspondence(page)).toEqual(wholeBase);
  expect(await roles(page)).toEqual(wholeRoles);
  await sampling(page).selectOption("neighborhood");
  await settle(page);
  await expect(width(page)).toHaveValue("0.2");
  await expect(nearby(page)).toHaveValue("8");
});

test("selecting a point on the base sphere moves the neighborhood, and its fibers are not selection targets", async ({
  page,
}) => {
  await openPreset(page, fan);
  await expect(selectedField(page)).toHaveValue("11");
  await expectCells(page, 2, 1);
  // A tap on the path's point 4 centers the neighborhood there.
  const at = await pointOn(
    page,
    'svg[data-representation="base"] g[data-sample="3"]',
  );
  await page.mouse.click(at.x, at.y);
  await settle(page);
  await expect(selectedField(page)).toHaveValue("4");
  let c = await expectCells(page, 2, 1);
  expect(c.parameter).toBe((2 * Math.PI * 3) / 32);
  // A key steps it on by one point.
  await panel(page, "stereo").focus();
  await page.keyboard.press("]");
  await settle(page);
  await expect(selectedField(page)).toHaveValue("5");
  c = await expectCells(page, 2, 1);
  expect(c.parameter).toBe((2 * Math.PI * 4) / 32);
  // A tap on a cell's fiber, far from the moving fiber, selects nothing.
  const far = await panel(page, "stereo").evaluate((svg: SVGSVGElement) => {
    const vertices = (e: Element) => {
      const d = e
        .getAttribute("d")!
        .match(/-?\d+(?:\.\d+)?/g)!
        .map(Number);
      return Array.from({ length: d.length / 2 }, (_, i) => [
        d[2 * i],
        d[2 * i + 1],
      ]);
    };
    const moving = vertices(
      svg.querySelector('[data-correspondence="moving"]')!,
    );
    let best = { d: -1, x: 0, y: 0 };
    for (const e of svg.querySelectorAll('[data-role="near"]'))
      for (const [x, y] of vertices(e)) {
        const d = Math.min(...moving.map(([a, b]) => Math.hypot(a - x, b - y)));
        if (d > best.d) best = { d, x, y };
      }
    const m = svg.getScreenCTM()!;
    return {
      d: best.d,
      x: m.a * best.x + m.c * best.y + m.e,
      y: m.b * best.x + m.d * best.y + m.f,
    };
  });
  expect(far.d).toBeGreaterThan(60);
  const before = await meta(page);
  await page.mouse.click(far.x, far.y);
  await settle(page);
  await expect(selectedField(page)).toHaveValue("5");
  expect((await meta(page)).config).toEqual(before.config);
});

test("the opening fan's phrase carries its neighborhood around the path, opens it whole and loops", async ({
  page,
}) => {
  await openPreset(page, fan);
  const initial = await meta(page);
  expect(initial.config.weave).toMatchObject({
    sampling: "neighborhood",
    width: 0.12,
    nearby: 25,
    selected: 10,
  });
  const first = await roles(page);
  await expectCells(page, 2, 1);
  await button(page, "Play animation").click();
  await expect(
    panel(page, "stereo").locator('[data-source="weave/moving"]'),
  ).toHaveCount(1);
  await button(page, "Pause").click();
  // The phases last 10, 5 and 5 seconds: the trace fills the first half,
  // and the width is whole at three quarters.
  for (const [s, w] of [
    [0.13, 0.12],
    [0.37, 0.12],
    [0.75, 1],
    [0.62, undefined],
    [1, 0.12],
    [0, 0.12],
  ] as const) {
    await page
      .getByRole("slider", { name: "Animation progress" })
      .fill(String(s));
    await settle(page);
    const c = await correspondence(page);
    expect(c.base).toEqual(c.stereo);
    expect(c.base.parameter).toBeGreaterThanOrEqual(0);
    expect(c.base.parameter).toBeLessThan(2 * Math.PI);
    await expectCells(page, 2, 1);
    if (w !== undefined) expect(c.base.neighborhood.width).toBe(w);
    else {
      expect(c.base.neighborhood.width).toBeGreaterThan(0.12);
      expect(c.base.neighborhood.width).toBeLessThan(1);
    }
    if (s === 0 || s === 1) {
      expect(c.base.movingSample).toBe(10);
      expect(await roles(page)).toEqual(first);
    }
  }
  await page.getByRole("button", { name: /^(Stop|Back to study)$/ }).click();
  await settle(page);
  expect(await meta(page)).toEqual(initial);
});

test("scrubbing the fan's phrase keeps redrawing without making a control blink", async ({
  page,
}) => {
  await openPreset(page, fan);
  await button(page, "Play animation").click();
  await button(page, "Pause").click();
  const { shown, flickered } = await page.evaluate(async () => {
    const slider = document.querySelector(
      'input[aria-label="Animation progress"]',
    ) as HTMLInputElement;
    const stage = document.querySelector(".tesseract-stage")!;
    const seen = new Set<string | null>();
    const buttons = [...document.querySelectorAll("button")].filter(
      (b) => b.closest("header") || b.closest("#shape-playback"),
    );
    const states = new Map(buttons.map((b) => [b, b.disabled]));
    let flickered = 0;
    const look = () => {
      seen.add(stage.getAttribute("data-config"));
      for (const b of buttons)
        if (b.disabled !== states.get(b)) {
          flickered++;
          states.set(b, b.disabled);
        }
    };
    const watch = new MutationObserver(look);
    watch.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ["data-config", "disabled"],
    });
    const set = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    for (let i = 0; i < 90; i++) {
      set.call(slider, (0.5 + 0.45 * Math.sin(i / 8)).toFixed(3));
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 16));
    }
    await new Promise((r) => setTimeout(r, 300));
    watch.disconnect();
    return { shown: seen.size, flickered };
  });
  expect(flickered).toBe(0);
  expect(shown).toBeGreaterThan(5);
});

test("the fan's traced loop exports both panes with its duration and endpoints", async ({
  page,
}) => {
  test.slow();
  await openPreset(page, fan);
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("trace");
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("1");
  await button(page, "Play animation").click();
  await button(page, "Pause").click();
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
  const file = (await (await download).path())!;
  const p = probe(file);
  if (p) {
    expect([p.width, p.height, p.frames]).toEqual([1000, 380, 15]);
    expect(p.durations.reduce((a, b) => a + b, 0)).toBe(1000);
  }
  expect((await decodeVideo(page, await readFile(file))).duration).toBeCloseTo(
    1,
    3,
  );
  for (const [k, index] of [0, 6].entries()) {
    const d = frameDifference(file, 1000, 380, index, references[k]);
    if (d) {
      expect(d.meanDifference).toBeLessThan(6);
      expect(d.unmatchedInk).toBeLessThan(0.02);
    }
  }
});

test("an edited neighborhood's link and still keep its fields, selection and appearance", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openPreset(page, fan);
  await width(page).fill("3/20");
  await nearby(page).fill("9");
  await selectedField(page).fill("20");
  await settle(page);
  // Under another scheme and theme, the cells' points, fibers and stretch
  // keep the path's own ink, and the moving fiber the accent.
  await chooseColorScheme(page, "cobalt");
  await page.emulateMedia({ colorScheme: "dark" });
  await settle(page);
  // The accent follows first, so the inks read below are the new ones.
  await expect(
    panel(page, "stereo").locator('[data-correspondence="moving"]'),
  ).toHaveAttribute("stroke", "#ff9fbd");
  const base = panel(page, "base");
  const ink = await base
    .locator("g[data-sample] circle")
    .first()
    .getAttribute("fill");
  expect(ink).toMatch(/^hsl\(\S+ 55% 72%\)$/);
  await expect(
    base.locator('circle[data-role="near"]').first(),
  ).toHaveAttribute("fill", ink!);
  await expect(base.locator('[data-role="neighborhood"]')).toHaveAttribute(
    "stroke",
    ink!,
  );
  await expect(
    panel(page, "stereo").locator('[data-role="near"]').first(),
  ).toHaveAttribute("stroke", ink!);
  const live = await meta(page);
  expect(live.config.weave).toMatchObject({
    sampling: "neighborhood",
    width: 3 / 20,
    nearby: 9,
    selected: 19,
  });
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const svg = await readFile((await (await download).path())!, "utf8");
  const m = JSON.parse(
    svg.match(/<desc>([^<]*)<\/desc>/)![1].replace(/&quot;/g, '"'),
  );
  expect(m.config).toEqual(live.config);
  expect(svg).not.toMatch(/<text|<foreignObject/);
  await button(page, "Copy link").click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  await page.goto("about:blank");
  await page.goto(url.replace(/^https?:\/\/[^/]+/, ""));
  await settle(page);
  expect((await meta(page)).config).toEqual(live.config);
  await expect(width(page)).toHaveValue("0.15");
  await expectCells(page, 2, 1);
});

for (const size of [
  { width: 1440, height: 650 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
])
  test(`neighborhood walkthrough keeps its controls together and both panes reachable (${size.width}×${size.height})`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: size,
      hasTouch: size.width < 1000,
      isMobile: size.width < 1000,
    });
    const page = await context.newPage();
    await openPreset(page, fan);
    await expect(panel(page, "base")).toBeVisible();
    await expect(panel(page, "stereo")).toBeVisible();
    const fits = () =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      );
    expect(await fits()).toBe(true);
    // The choice and its two fields sit together, the fields on one row.
    await sampling(page).scrollIntoViewIfNeeded();
    const box = async (l: ReturnType<typeof width>) => (await l.boundingBox())!;
    const [choice, w, k] = [
      await box(sampling(page)),
      await box(width(page)),
      await box(nearby(page)),
    ];
    expect(w.y).toBe(k.y);
    expect(w.y).toBeGreaterThan(choice.y + choice.height);
    expect(w.y - (choice.y + choice.height)).toBeLessThan(120);
    // An error under the width does not move its neighbor, compared with
    // the width itself, since the page may scroll to show the error.
    await width(page).fill("2");
    await expect(fieldOf(page, width(page)).getByRole("alert")).toBeVisible();
    expect(await fits()).toBe(true);
    const [w2, k2] = [await box(width(page)), await box(nearby(page))];
    expect([k2.x - w2.x, k2.y - w2.y]).toEqual([k.x - w.x, k.y - w.y]);
    // The phrase closes to 0.12, so its loop needs the entered width back.
    await width(page).fill("0.12");
    await settle(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await panel(page, "base").scrollIntoViewIfNeeded();
    const at = await pointOn(
      page,
      'svg[data-representation="base"] g[data-sample="3"]',
    );
    if (size.width < 1000) await page.touchscreen.tap(at.x, at.y);
    else await page.mouse.click(at.x, at.y);
    await settle(page);
    await expect(selectedField(page)).toHaveValue("4");
    await button(page, "Play animation").click();
    await button(page, "Pause").click();
    await page.getByRole("slider", { name: "Animation progress" }).fill("0.3");
    await settle(page);
    expect(await fits()).toBe(true);
    await page.getByRole("button", { name: /^(Stop|Back to study)$/ }).click();
    await settle(page);
    await context.close();
  });
