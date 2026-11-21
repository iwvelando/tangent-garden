import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { chooseColorScheme, exportImage, openShapeExport } from "./helpers";
import { desc, meta, openPreset, panel, raster, settle } from "./hopf-helpers";
import { decodeVideo, frameDifference, probe } from "./video";
import { weaveAtlasPoints } from "../web/tesseract/atlas-pairs";
import { objects } from "../web/tesseract/objects";

// A marked point carried along the moving fiber of Base sphere and fibers
// (docs/tesseracts.md, "Phase along a moving fiber"). Expectations are
// written out here: the north chart's starting point, the turn e^{iθ}q,
// the latitude's holonomy 2π sin²α and the octant triangle's π/4, half its
// area π/2.
const latitude = "A circle over every point";
const laps = "Eight laps, one turn of phase";

type Q = [number, number, number, number];
const turned = ([x, y, z, w]: Q, a: number): Q => {
  const c = Math.cos(a),
    s = Math.sin(a);
  return [c * x - s * y, s * x + c * y, c * z - s * w, s * z + c * w];
};
// e^{iφ₀} times the north chart's point over p, z₁ real and positive.
const northStart = (p: number[], phase: number): Q => {
  const z1 = Math.sqrt((1 + p[2]) / 2);
  const q: Q = [z1, 0, p[0] / (2 * z1), -p[1] / (2 * z1)];
  const n = Math.hypot(...q);
  return turned(q.map((v) => v / n) as Q, phase);
};
const hopf = ([x, y, z, w]: Q) => [
  2 * (x * z + y * w),
  2 * (y * z - x * w),
  x * x + y * y - z * z - w * w,
];
const expectNear = (a: number[], b: number[], digits = 12) =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

const button = (p: Page, name: string) =>
  p.getByRole("button", { name, exact: true });
const check = (p: Page) =>
  p.getByRole("checkbox", { name: "Carry a marked point", exact: true });
const phase = (p: Page) =>
  p.getByRole("textbox", { name: "Starting phase φ₀", exact: true });
const readout = (p: Page, label: string) =>
  p.locator(".lift-readout span", { hasText: label });
const transport = async (p: Page) =>
  (await desc(p, "stereo")).weave.correspondence.transport;
const progress = (p: Page) =>
  p.getByRole("slider", { name: "Animation progress" });
const marked = (p: Page) =>
  panel(p, "stereo").locator('circle[data-role="marked"]');

// An atlas reserves at least the engine's count before evaluation: the
// whole-path count (engine4 pairedWeavePoints and the base curve) and the
// carried point's (engine4 transportPoints): a trail of one turn at its
// quadrature pieces, the gap at half the arc samples, a crossing per
// interval of either, and two markers. The pieces are at least the base
// segments and T·max|p′|·8.
test("an atlas reserves a carried point's counted points", () => {
  const c = objects.weave.defaults({} as any);
  c.mode = "paired";
  c.curves = 32;
  // B is Go's segment count, without a polygon's inserted corners.
  const counted = (N: number, B: number, corners: number, pieces: number) =>
    (32 + 1) * (N + 2) +
    3 * (N + 1) +
    (N + 1) +
    3 * (N + 1) +
    32 +
    1 +
    (B - N) +
    corners +
    2 * (Math.max(B, pieces) + corners + 2) +
    2 * (Math.floor(N / 2) + 2) +
    2;
  const speed = (T: number, v: number) => Math.ceil(T * v * 8);
  for (const N of [8, 128, 256]) {
    c.samples = N;
    // The fastest admitted flower, A = π/4 and k = 8, bounds every flower
    // an atlas may vary its amplitude to.
    c.weave = {
      ...c.weave!,
      path: "flower",
      amplitude: 0.1,
      petals: 8,
      transport: true,
    };
    expect(weaveAtlasPoints(c)).toBeGreaterThanOrEqual(
      counted(
        N,
        Math.max(N, 128),
        0,
        speed(2 * Math.PI, Math.hypot(4 * Math.PI, 1)),
      ),
    );
    c.weave = { ...c.weave, path: "lissajous", azimuthal: 8, polar: 7 };
    expect(weaveAtlasPoints(c)).toBeGreaterThanOrEqual(
      counted(N, Math.max(N, 240), 0, speed(2 * Math.PI, Math.hypot(8, 7))),
    );
    c.weave = { ...c.weave, path: "latitude" };
    expect(weaveAtlasPoints(c)).toBeGreaterThanOrEqual(
      counted(N, N, 0, speed(2 * Math.PI, 1)),
    );
    // Twelve sides, each short of a half circle.
    c.weave = {
      ...c.weave,
      path: "polygon",
      vertices: Array.from({ length: 12 }, (_, i) => ({
        u: i * (Math.PI - 1e-5),
        v: i % 2 ? 1e-3 : 0,
      })),
    };
    expect(weaveAtlasPoints(c)).toBeGreaterThanOrEqual(
      counted(N, N, 11, speed(12 * Math.PI, 1)),
    );
    // Without the point, nothing is reserved for it.
    const off = structuredClone(c);
    delete off.weave!.transport;
    expect(weaveAtlasPoints(c) - weaveAtlasPoints(off)).toBe(
      2 * (Math.max(N, speed(12 * Math.PI, 1)) + 11 + 2) +
        2 * (Math.floor(N / 2) + 2) +
        2,
    );
  }
});

test("a carried point starts at its phase on an edited selection, refuses a bad phase by field, and turns off", async ({
  page,
}) => {
  await openPreset(page, latitude);
  const alpha = page.getByRole("textbox", {
    name: "Central latitude α",
    exact: true,
  });
  await alpha.fill("pi/6");
  await page
    .getByRole("spinbutton", { name: "Selected fiber", exact: true })
    .fill("4");
  await settle(page);
  await expect(phase(page)).toHaveCount(0);
  await check(page).check();
  await settle(page);
  const n = (await meta(page)).config.curves;
  const p = [
    Math.sin(Math.PI / 3) * Math.cos((2 * Math.PI * 3) / n),
    Math.sin(Math.PI / 3) * Math.sin((2 * Math.PI * 3) / n),
    Math.cos(Math.PI / 3),
  ];
  let t = await transport(page);
  expectNear(t.start, northStart(p, 0));
  expectNear(t.point, t.start, 15);
  expectNear(hopf(t.point), p);
  // 2π sin²(π/6) = π/2, whatever the selection and phase.
  expect(t.holonomy).toBeCloseTo(Math.PI / 2, 12);
  await expect(readout(page, "Holonomy per turn")).toHaveText(
    "Holonomy per turn: 1.5708",
  );
  await expect(marked(page)).toHaveCount(1);
  await expect(
    panel(page, "stereo").locator('circle[data-role="marked-start"]'),
  ).toHaveCount(1);
  // The base sphere draws nothing new.
  expect(
    (await desc(page, "base")).markers.some((m: any) =>
      m.role.startsWith("marked"),
    ),
  ).toBe(false);
  await phase(page).fill("pi/3");
  await settle(page);
  t = await transport(page);
  expectNear(t.start, northStart(p, Math.PI / 3));
  expect(t.holonomy).toBeCloseTo(Math.PI / 2, 12);
  // Out of range: refused under the phase field, the study kept.
  await phase(page).fill("2e5");
  const error = page
    .locator(".field")
    .filter({ has: phase(page) })
    .getByRole("alert");
  await expect(error).toHaveText(
    "Starting phase φ₀ must be finite and within ±100000 radians",
  );
  await phase(page).fill("pi/3");
  await settle(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  // The trace can't loop with the point carried: one turn turns it.
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("trace");
  const repeats = await page
    .getByRole("combobox", { name: "Repeat", exact: true })
    .locator("option")
    .allTextContents();
  expect(repeats).toEqual(["Once", "Back and forth"]);
  // Turning it off drops the field and the drawing, and keeps the phase.
  await check(page).uncheck();
  await settle(page);
  const weave = (await meta(page)).config.weave;
  expect("transport" in weave).toBe(false);
  expect(weave.phase).toBeCloseTo(Math.PI / 3, 15);
  await expect(phase(page)).toHaveCount(0);
  await expect(marked(page)).toHaveCount(0);
  await expect(readout(page, "Holonomy per turn")).toHaveCount(0);
  expect((await desc(page, "stereo")).weave.correspondence.transport).toBe(
    undefined,
  );
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("trace");
  expect(
    await page
      .getByRole("combobox", { name: "Repeat", exact: true })
      .locator("option")
      .allTextContents(),
  ).toContain("Loop");
  await check(page).check();
  await settle(page);
  expectNear((await transport(page)).start, northStart(p, Math.PI / 3));
});

test("each of the eight laps turns the point by π/4, and the eighth brings it home in a loop", async ({
  page,
}) => {
  await openPreset(page, laps);
  await expect(readout(page, "Holonomy per turn")).toHaveText(
    "Holonomy per turn: 0.785398",
  );
  await expect(readout(page, "Carried point")).toHaveText(
    "Carried point: in window",
  );
  const start = (await transport(page)).start;
  // Vertex 1 is (1, 0, 0); the example starts half a turn along its fiber.
  expectNear(start, northStart([1, 0, 0], Math.PI));
  const at = async () => ({
    t: await transport(page),
    marker: await marked(page).evaluate((c) => [
      Number(c.getAttribute("cx")),
      Number(c.getAttribute("cy")),
    ]),
    trail: await panel(page, "stereo")
      .locator('[data-role="lift"]')
      .evaluateAll((ps) => ps.map((p) => p.getAttribute("d"))),
    gap: await panel(page, "stereo")
      .locator('[data-role="holonomy"]')
      .evaluateAll((ps) => ps.map((p) => p.getAttribute("d"))),
  });
  const rest = await at();
  expect(rest.trail).toHaveLength(1);
  expect(rest.gap).toHaveLength(1);
  await button(page, "Play animation").click();
  await button(page, "Pause").click();
  for (let lap = 0; lap <= 8; lap++) {
    await progress(page).fill(String(lap / 8));
    await settle(page);
    const now = await at();
    const c = (await desc(page, "stereo")).weave.correspondence;
    expect(c.movingSample).toBe(0);
    expectNear(now.t.point, turned(start, (lap * Math.PI) / 4));
    // Every fiber and the whole trail stay inside the window.
    expect(now.t.inside).toBe(true);
    expect(now.trail).toHaveLength(1);
    expect(now.gap).toHaveLength(1);
    if (lap % 8) expect(now.marker).not.toEqual(rest.marker);
  }
  // The eighth lap draws the opening again, to rounding.
  const home = await at();
  home.marker.forEach((v, i) => expect(v).toBeCloseTo(rest.marker[i], 6));
  expect(home.trail).toEqual(rest.trail);
  expect(home.gap).toEqual(rest.gap);
  // So the loop check lets the phrase loop.
  await page.getByRole("button", { name: /^(Stop|Back to study)$/ }).click();
  await settle(page);
  await button(page, "Play animation").click();
  await expect(button(page, "Pause")).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await button(page, "Pause").click();
});

test("scrubbing the laps keeps redrawing the carried point without making a control blink", async ({
  page,
}) => {
  await openPreset(page, laps);
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
      seen.add(
        document
          .querySelector(
            'svg[data-representation="stereo"] [data-role="marked"]',
          )
          ?.getAttribute("cx") ?? null,
      );
      void stage;
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
      attributeFilter: ["cx", "disabled"],
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

test("a carried point's movie starts at the start and ends a lap later, turned", async ({
  page,
}) => {
  test.slow();
  await openPreset(page, laps);
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("trace");
  await page
    .getByRole("combobox", { name: "Repeat", exact: true })
    .selectOption("once");
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("1");
  await button(page, "Play animation").click();
  await button(page, "Pause").click();
  const references: number[][] = [];
  for (const s of [0, 1]) {
    await progress(page).fill(String(s));
    await settle(page);
    references.push(await raster(page, 1000, 380));
  }
  // The ends differ: the point has turned an eighth of its fiber.
  expectNear(
    (await transport(page)).point,
    turned(northStart([1, 0, 0], Math.PI), Math.PI / 4),
  );
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
  let last = 15;
  if (p) {
    expect([p.width, p.height]).toEqual([1000, 380]);
    expect(p.durations.reduce((a, b) => a + b, 0)).toBe(1000);
    last = p.frames - 1;
  }
  expect((await decodeVideo(page, await readFile(file))).duration).toBeCloseTo(
    1,
    3,
  );
  for (const [k, index] of [0, last].entries()) {
    const d = frameDifference(file, 1000, 380, index, references[k]);
    const other = frameDifference(file, 1000, 380, index, references[1 - k]);
    if (d && other) {
      expect(d.meanDifference).toBeLessThan(6);
      expect(d.unmatchedInk).toBeLessThan(0.02);
      // Each end matches its own moment better than the other end.
      expect(d.meanDifference).toBeLessThan(other.meanDifference);
    }
  }
});

test("a carried point's link and still keep its phase and appearance", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openPreset(page, laps);
  await phase(page).fill("pi/2");
  await page
    .getByRole("spinbutton", { name: "Selected fiber", exact: true })
    .fill("6");
  await settle(page);
  // Under another scheme and theme the point, its start, trail and gap
  // take the accent.
  await chooseColorScheme(page, "cobalt");
  await page.emulateMedia({ colorScheme: "dark" });
  await settle(page);
  const stereo = panel(page, "stereo");
  await expect(
    stereo.locator('[data-correspondence="moving"]'),
  ).toHaveAttribute("stroke", "#ff9fbd");
  await expect(marked(page)).toHaveAttribute("fill", "#ff9fbd");
  await expect(
    stereo.locator('circle[data-role="marked-start"]'),
  ).toHaveAttribute("stroke", "#ff9fbd");
  await expect(stereo.locator('[data-role="lift"]').first()).toHaveAttribute(
    "stroke",
    "#ff9fbd",
  );
  await expect(
    stereo.locator('[data-role="holonomy"]').first(),
  ).toHaveAttribute("stroke", "#ff9fbd");
  const live = await meta(page);
  expect(live.config.weave).toMatchObject({
    transport: true,
    phase: Math.PI / 2,
    selected: 5,
  });
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const svg = await readFile((await (await download).path())!, "utf8");
  const m = JSON.parse(
    svg.match(/<desc>([^<]*)<\/desc>/)![1].replace(/&quot;/g, '"'),
  );
  expect(m.config).toEqual(live.config);
  expect(svg).not.toMatch(/<text|<foreignObject/);
  const before = await transport(page);
  await button(page, "Copy link").click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  await page.goto("about:blank");
  await page.goto(url.replace(/^https?:\/\/[^/]+/, ""));
  await settle(page);
  expect((await meta(page)).config).toEqual(live.config);
  await expect(check(page)).toBeChecked();
  expect(await transport(page)).toEqual(before);
});

for (const size of [
  { width: 1440, height: 650 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
])
  test(`carried point walkthrough keeps its controls together and both panes reachable (${size.width}×${size.height})`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: size,
      hasTouch: size.width < 1000,
      isMobile: size.width < 1000,
    });
    const page = await context.newPage();
    await openPreset(page, laps);
    await expect(panel(page, "base")).toBeVisible();
    await expect(panel(page, "stereo")).toBeVisible();
    // The check and its phase follow the selection, in that order.
    const selection = page.getByRole("spinbutton", {
      name: "Selected fiber",
      exact: true,
    });
    await check(page).scrollIntoViewIfNeeded();
    await expect(check(page)).toBeInViewport();
    const [s, c, f] = await Promise.all(
      [selection, check(page), phase(page)].map(
        async (l) => (await l.boundingBox())!,
      ),
    );
    expect(c.y).toBeGreaterThan(s.y);
    expect(f.y).toBeGreaterThan(c.y);
    expect(f.y - (c.y + c.height)).toBeLessThan(160);
    // Opening the check's help moves nothing above it.
    const top = (await selection.boundingBox())!.y;
    await page
      .getByRole("button", {
        name: "About carrying a marked point",
        exact: true,
      })
      .click();
    expect((await selection.boundingBox())!.y).toBe(top);
    await expect(
      page.getByText(
        "Carries a point along the moving fiber without turning it about the fiber.",
      ),
    ).toBeVisible();
    await button(page, "Play animation").click();
    await button(page, "Pause").click();
    await progress(page).fill("0.3");
    await settle(page);
    await expect(marked(page)).toHaveCount(1);
    await page.getByRole("button", { name: /^(Stop|Back to study)$/ }).click();
    await settle(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await context.close();
  });
