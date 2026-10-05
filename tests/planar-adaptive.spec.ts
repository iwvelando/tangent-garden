import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import { choosePreset, exportImage, openAnimation } from "./helpers";
import { reveal } from "../web/animation";
import { presets } from "../web/presets";
import type { Result, Vec } from "../web/types";

// Refinement between samples in the 2D notebook: Go inserts points between
// the uniform samples (engine/adaptive.go); the drawing draws them in place
// of the samples of the base curve, a derived input, and a pedal-type or
// inverted curve.

const ripples = "Ripples hidden between samples",
  petals = "Petals that miss the center";

const art = (page: Page) => page.locator("#artwork");
const ready = (page: Page) =>
  expect(page.locator(".plot-wrap")).toHaveAttribute("aria-busy", "false");
const refine = (page: Page) =>
  page.getByRole("checkbox", { name: "Refine between samples" });
const readout = (page: Page) => page.locator(".refinement-readout");
const definition = async (page: Page) =>
  JSON.parse((await art(page).locator("desc").textContent())!);
// The vertices of a drawn path: one per M or L command.
const vertices = (d: string | null) => (d?.match(/[ML]/g) ?? []).length;
const base = (page: Page) => art(page).getByTestId("base-curve");

test("reveal shows refined points up to the last revealed sample", () => {
  const p = (x: number): Vec => ({ x, y: 0 });
  const refined = {
    points: [p(0), p(0.5), p(1), null, p(2), p(2.25), p(2.5), p(3)],
    at: [0, 0.5, 1, 1.5, 2, 2.25, 2.5, 3],
    tolerance: 1e-3,
    inserted: 3,
    breaks: 0,
    unresolved: 0,
    exhausted: false,
  };
  const result: Result = {
    base: [p(0), p(1), p(2), p(3)],
    derived: [p(0), p(1), p(2), p(3)],
    virtual: [false, false, false, false],
    rays: [],
    family: [],
    circles: [],
    rolling: [],
    warnings: [],
    invalid: 0,
    input: [p(0), p(1), p(2), p(3)],
    adaptive: {
      base: refined,
      input: refined,
      derived: refined,
      family: [refined, refined],
    },
  };
  // Two of three intervals: through sample 2, before the points beyond it.
  const shown = reveal(result, 2 / 3).adaptive!;
  expect(shown.family).toHaveLength(2);
  for (const path of [
    shown.base!,
    shown.input!,
    shown.derived!,
    ...shown.family!,
  ]) {
    expect(path.at).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(path.points).toEqual([p(0), p(0.5), p(1), null, p(2)]);
  }
  expect(reveal(result, 1).adaptive).toEqual(result.adaptive);
  expect(reveal({ ...result, adaptive: undefined }, 0.5).adaptive).toBe(
    undefined,
  );
});

test("reveal keeps a refined caustic's virtual flags with its points", () => {
  const p = (x: number): Vec => ({ x, y: 0 });
  const derived = {
    points: [p(0), p(0.5), p(1), p(1.001), p(2)],
    at: [0, 0.5, 1, 1.001, 2],
    virtual: [false, false, false, true, true],
    tolerance: 1e-3,
    inserted: 2,
    breaks: 0,
    unresolved: 0,
    exhausted: false,
  };
  const result: Result = {
    base: [p(0), p(1), p(2)],
    derived: [p(0), p(1), p(2)],
    virtual: [false, false, true],
    rays: [],
    family: [],
    circles: [],
    rolling: [],
    warnings: [],
    invalid: 0,
    adaptive: { derived },
  };
  const shown = reveal(result, 1 / 2).adaptive!.derived!;
  expect(shown.points).toEqual([p(0), p(0.5), p(1)]);
  expect(shown.virtual).toEqual([false, false, false]);
  expect(reveal(result, 1).adaptive!.derived).toEqual(derived);
});

test("the control appears only for curves refinable between samples, and toggles back to the same drawing", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await expect(refine(page)).not.toBeChecked();
  const before = await art(page).evaluate((svg) => svg.outerHTML);
  const uniform = vertices(await base(page).getAttribute("d"));
  await refine(page).check();
  await ready(page);
  await expect(readout(page)).toContainText("added between samples");
  expect((await definition(page)).adaptive).toBe(true);
  // The ellipse is smooth: refinement adds a few points, never removes one.
  expect(vertices(await base(page).getAttribute("d"))).toBeGreaterThanOrEqual(
    uniform,
  );
  await refine(page).uncheck();
  await ready(page);
  await expect(readout(page)).toHaveCount(0);
  expect((await definition(page)).adaptive).toBe(false);
  const after = await art(page).evaluate((svg) => svg.outerHTML);
  // Only the recorded setting differs.
  expect(after.replace(',"adaptive":false', "")).toBe(before);

  // Integrated curves and those without a parameter offer no refinement.
  for (const format of ["pursuit", "field", "implicit", "attractor"]) {
    const i = presets.findIndex((p) => p.config.curve.format === format);
    expect(i, format).toBeGreaterThanOrEqual(0);
    await choosePreset(page, String(i));
    await ready(page);
    await expect(refine(page)).toHaveCount(0);
  }
});

test("ripples aliased by the samples appear when refined", async ({ page }) => {
  await page.goto("/");
  await choosePreset(page, { label: ripples });
  await ready(page);
  // The example opens refined.
  await expect(refine(page)).toBeChecked();
  const refined = vertices(await base(page).getAttribute("d"));
  await expect(readout(page)).toHaveText(
    /^[\d,]+ points added between samples\.$/,
  );
  // The SVG export carries the refined points.
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const svg = (await readFile((await (await download).path())!)).toString();
  const paths = [...svg.matchAll(/ d="([^"]*)"/g)].map((m) => vertices(m[1]));
  expect(Math.max(...paths)).toBeGreaterThanOrEqual(refined);
  await refine(page).uncheck();
  await ready(page);
  const uniform = vertices(await base(page).getAttribute("d"));
  expect(uniform).toBe(240);
  expect(refined).toBeGreaterThan(10 * uniform);
});

test("petals that miss the center throw out round loops when refined, and travel in a link", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await choosePreset(page, { label: petals });
  await ready(page);
  const image = art(page).getByTestId("derived-curve");
  await expect(refine(page)).toBeChecked();
  const drawn = await image.getAttribute("d");
  await refine(page).uncheck();
  await ready(page);
  const uniform = vertices(await image.getAttribute("d"));
  expect(vertices(drawn)).toBeGreaterThan(2 * uniform);
  await refine(page).check();
  await ready(page);
  await expect(image).toHaveAttribute("d", drawn!);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const href = await page.evaluate(() => navigator.clipboard.readText());
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const other = await context.newPage();
  await other.goto(href);
  await ready(other);
  await expect(refine(other)).toBeChecked();
  await expect(art(other).getByTestId("derived-curve")).toHaveAttribute(
    "d",
    drawn!,
  );
  await context.close();
});

test("a paused reveal of a refined study draws its refined points up to the revealed sample", async ({
  page,
}) => {
  await page.goto("/");
  await choosePreset(page, { label: ripples });
  await ready(page);
  const whole = vertices(await base(page).getAttribute("d"));
  await openAnimation(page);
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("reveal");
  await page.getByRole("button", { name: "Play animation" }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("slider", { name: "Animation progress" }).fill("0.5");
  await expect(art(page)).toHaveAttribute("data-animation-progress", "0.5");
  const half = vertices(await base(page).getAttribute("d"));
  expect(half).toBeGreaterThan(0.4 * whole);
  expect(half).toBeLessThan(0.6 * whole);
});

// A link encoded independently, as a sender's browser would.
const linkTo = (study: unknown) =>
  `/#s=${deflateRawSync(
    Buffer.from(JSON.stringify({ v: 1, notebook: "2d", study })),
  ).toString("base64url")}`;

test("a derived input is drawn from its refined points", async ({ page }) => {
  const ripple = presets.find((p) => p.title === ripples)!.config;
  await page.goto(
    linkTo({
      config: { ...ripple, kind: "evolute", input: "offset", distance: 0.01 },
      bounds: { min: "0", max: "2*pi" },
    }),
  );
  await ready(page);
  const input = art(page).getByTestId("construction-input");
  await expect(refine(page)).toBeChecked();
  const refined = vertices(await input.getAttribute("d"));
  await refine(page).uncheck();
  await ready(page);
  const uniform = vertices(await input.getAttribute("d"));
  expect(uniform).toBeLessThanOrEqual(240);
  expect(refined).toBeGreaterThan(10 * uniform);
});

const ripplesStar = "Ripples around a five-pointed star",
  wavefront = "A wavefront through a three-pointed star";

// A drawn path's vertices in page units, with null at each move (a break).
const pathPoints = (d: string | null) =>
  [...(d ?? "").matchAll(/([ML])(-?[\d.]+),(-?[\d.]+)/g)].flatMap((m) => [
    ...(m[1] === "M" ? [null] : []),
    { x: Number(m[2]), y: Number(m[3]) },
  ]);
type Point = { x: number; y: number };
const segmentDistance = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    l = dx * dx + dy * dy,
    s =
      l > 0
        ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l))
        : 0;
  return Math.hypot(p.x - a.x - s * dx, p.y - a.y - s * dy);
};
// The distance from p to a drawn polyline.
const toCurve = (p: Point, curve: (Point | null)[]) => {
  let best = Infinity;
  for (let k = 1; k < curve.length; k++) {
    const a = curve[k - 1],
      b = curve[k];
    if (a && b) best = Math.min(best, segmentDistance(p, a, b));
  }
  return best;
};
// The distance from the curve of each chord's midpoint on a drawn offset,
// as a share of the distance at its vertices: an outward offset with no
// folds is the edge of the band within its distance of the curve, so its
// chords stay at that distance only where they follow it.
const chordReach = (offset: (Point | null)[], curve: (Point | null)[]) => {
  const vertices = offset.filter((p): p is Point => !!p),
    reach = vertices.map((p) => toCurve(p, curve)).sort((a, b) => a - b);
  const distance = reach[Math.floor(reach.length / 2)];
  let nearest = Infinity;
  for (let k = 1; k < offset.length; k++) {
    const a = offset[k - 1],
      b = offset[k];
    if (a && b)
      nearest = Math.min(
        nearest,
        toCurve({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, curve),
      );
  }
  return {
    spread: reach[reach.length - 1] / reach[0],
    nearest: nearest / distance,
  };
};

test("ripples around a five-pointed star swing round its tips at their own distance when refined", async ({
  page,
}) => {
  await page.goto("/");
  await choosePreset(page, { label: ripplesStar });
  await ready(page);
  await expect(refine(page)).toBeChecked();
  await expect(readout(page)).toHaveText(
    /^[\d,]+ points added between samples\.$/,
  );
  const stack = art(page).getByTestId("offset-family").locator("path");
  await expect(stack).toHaveCount(16);
  const outermost = async () => {
    const distances = await stack.evaluateAll((paths) =>
      paths.map((p) => Math.abs(Number(p.getAttribute("data-distance")))),
    );
    return stack.nth(distances.indexOf(Math.max(...distances)));
  };
  const drawn = await stack.evaluateAll((paths) =>
    paths.map((p) => p.getAttribute("d")),
  );
  const refined = chordReach(
    pathPoints(await (await outermost()).getAttribute("d")),
    pathPoints(await base(page).getAttribute("d")),
  );
  // Every vertex lies at the offset's distance from the curve, and so does
  // every chord between them, to within the page's rounding.
  expect(refined.spread).toBeLessThan(1.01);
  expect(refined.nearest).toBeGreaterThan(0.99);
  await refine(page).uncheck();
  await ready(page);
  await expect(readout(page)).toHaveCount(0);
  const uniform = await stack.evaluateAll((paths) =>
    paths.map((p) => p.getAttribute("d")),
  );
  drawn.forEach((d, k) => {
    expect(vertices(uniform[k])).toBeLessThanOrEqual(1000);
    expect(vertices(d)).toBeGreaterThan(vertices(uniform[k]));
  });
  // Round each tip, a chord of the evenly spaced samples cuts the corner.
  const corners = chordReach(
    pathPoints(await (await outermost()).getAttribute("d")),
    pathPoints(await base(page).getAttribute("d")),
  );
  expect(corners.nearest).toBeLessThan(0.9);
  await refine(page).check();
  await ready(page);
  await expect(stack).toHaveCount(16);
  expect(
    await stack.evaluateAll((paths) => paths.map((p) => p.getAttribute("d"))),
  ).toEqual(drawn);
});

test("a wavefront through a three-pointed star opens refined and stays refined as its distance moves", async ({
  page,
}) => {
  await page.goto("/");
  await choosePreset(page, { label: wavefront });
  await ready(page);
  await expect(refine(page)).toBeChecked();
  const offset = art(page).getByTestId("derived-curve");
  const opening = vertices(await offset.getAttribute("d"));
  expect(opening).toBeGreaterThan(1000);
  await openAnimation(page);
  await expect(
    page.getByRole("combobox", { name: "Animate", exact: true }),
  ).toHaveValue("parameters");
  await page.getByRole("button", { name: "Play animation" }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  // Halfway through its time it turns back at the end of its track, the
  // farthest outward offset: a band's edge.
  await page.getByRole("slider", { name: "Animation progress" }).fill("0.5");
  await expect(art(page)).toHaveAttribute("data-animation-progress", "1");
  const outward = chordReach(
    pathPoints(await offset.getAttribute("d")),
    pathPoints(await base(page).getAttribute("d")),
  );
  expect(outward.spread).toBeLessThan(1.01);
  expect(outward.nearest).toBeGreaterThan(0.99);
});

const hammered = "Sunlight in a hammered cup",
  crown = "A crown of cusps in a sunlit cup";

// The ends of a drawn path's runs, between its moves.
const runEnds = (d: string | null) => {
  const points = pathPoints(d),
    ends: Point[] = [];
  points.forEach((p, k) => {
    if (p && (!points[k - 1] || !points[k + 1])) ends.push(p);
  });
  return ends;
};
// How many ends of the solid caustic have an end of the dashed one within
// reach: where the caustic crosses its curve, from real to virtual.
const meetings = async (page: Page, reach: number) => {
  const solid = runEnds(
      await art(page).getByTestId("derived-curve").getAttribute("d"),
    ),
    dashed = runEnds(
      await art(page).getByTestId("virtual-derived-curve").getAttribute("d"),
    );
  return solid.filter((p) =>
    dashed.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < reach),
  ).length;
};

// Light travelling along +x gathers ahead of the half of the cup it meets
// face on, x > 0, and appears to gather behind the other: the solid real
// caustic keeps to the right of the cup's center and the dashed virtual
// one to the left. The page center is the middle of the drawn cup.
const keepsToItsSide = async (page: Page) => {
  const xs = (d: string | null) =>
      pathPoints(d)
        .filter((p): p is Point => !!p)
        .map((p) => p.x),
    cup = xs(await base(page).getAttribute("d")),
    center = (Math.min(...cup) + Math.max(...cup)) / 2;
  const solid = xs(
      await art(page).getByTestId("derived-curve").getAttribute("d"),
    ),
    dashed = xs(
      await art(page).getByTestId("virtual-derived-curve").getAttribute("d"),
    );
  expect(solid.length).toBeGreaterThan(0);
  expect(dashed.length).toBeGreaterThan(0);
  expect(Math.min(...solid)).toBeGreaterThan(center - 0.5);
  expect(Math.max(...dashed)).toBeLessThan(center + 0.5);
};

test("sunlight in a hammered cup opens refined, its real and virtual caustic meeting at the wall", async ({
  page,
}) => {
  await page.goto("/");
  await choosePreset(page, { label: hammered });
  await ready(page);
  await expect(refine(page)).toBeChecked();
  await expect(readout(page)).toHaveText(
    /^[\d,]+ points added between samples\.$/,
  );
  const caustic = art(page).getByTestId("derived-curve");
  const refined = vertices(await caustic.getAttribute("d"));
  // Where the light grazes the wall, top and bottom, the caustic turns
  // virtual: refined, the two parts meet there to well within a page unit.
  expect(await meetings(page, 0.1)).toBe(2);
  await keepsToItsSide(page);
  await refine(page).uncheck();
  await ready(page);
  // On the samples alone, a sample interval separates them.
  expect(await meetings(page, 1)).toBe(0);
  expect(refined).toBeGreaterThan(vertices(await caustic.getAttribute("d")));
});

test("a crown of cusps in a sunlit cup stays refined as its ripples settle", async ({
  page,
}) => {
  await page.goto("/");
  await choosePreset(page, { label: crown });
  await ready(page);
  await expect(refine(page)).toBeChecked();
  expect(await meetings(page, 0.1)).toBe(2);
  await openAnimation(page);
  await expect(
    page.getByRole("combobox", { name: "Animate", exact: true }),
  ).toHaveValue("parameters");
  await page.getByRole("button", { name: "Play animation" }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  // Halfway through its time it turns back at the end of its track, a = 0:
  // a smooth cup, whose caustic is the nephroid.
  await page.getByRole("slider", { name: "Animation progress" }).fill("0.5");
  await expect(art(page)).toHaveAttribute("data-animation-progress", "1");
  expect(await meetings(page, 0.1)).toBe(2);
  await keepsToItsSide(page);
});

const unwoundStar = "A string unwound from a three-pointed star",
  woundBack = "A string wound back onto a four-pointed star";

// The longest step between consecutive drawn vertices of a path, as a
// share of the larger side of their bounding box. A string's end sweeps a
// wide arc round each nearly sharp point; drawn by the evenly spaced
// samples, each arc is one long chord. Refined, a chord strays at most
// 2·10⁻⁴ of the curve's radius from an arc whose radius is at most the
// drawing's size, so it is at most about √(8·10⁻⁴) ≈ 3% of that size.
const longestStep = (d: string | null) => {
  const points = pathPoints(d);
  const drawn = points.filter((p): p is Point => !!p);
  const xs = drawn.map((p) => p.x),
    ys = drawn.map((p) => p.y);
  const size = Math.max(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
  );
  let longest = 0;
  points.forEach((p, k) => {
    const q = points[k - 1];
    if (p && q) longest = Math.max(longest, Math.hypot(p.x - q.x, p.y - q.y));
  });
  return longest / size;
};

test("a string unwound from a three-pointed star sweeps round arcs when refined", async ({
  page,
}) => {
  await page.goto("/");
  await choosePreset(page, { label: unwoundStar });
  await ready(page);
  await expect(refine(page)).toBeChecked();
  await expect(readout(page)).toHaveText(
    /^[\d,]+ points added between samples\.$/,
  );
  const involute = art(page).getByTestId("derived-curve");
  const drawn = await involute.getAttribute("d");
  expect(longestStep(drawn)).toBeLessThan(0.04);
  await refine(page).uncheck();
  await ready(page);
  const uniform = await involute.getAttribute("d");
  expect(vertices(uniform)).toBeLessThanOrEqual(1000);
  expect(vertices(drawn)).toBeGreaterThan(vertices(uniform));
  expect(longestStep(uniform)).toBeGreaterThan(0.2);
  await refine(page).check();
  await ready(page);
  expect(await involute.getAttribute("d")).toBe(drawn);
});

test("a string wound back onto a four-pointed star stays refined as its length moves", async ({
  page,
}) => {
  await page.goto("/");
  await choosePreset(page, { label: woundBack });
  await ready(page);
  await expect(refine(page)).toBeChecked();
  const involute = art(page).getByTestId("derived-curve");
  expect(longestStep(await involute.getAttribute("d"))).toBeLessThan(0.04);
  await openAnimation(page);
  await expect(
    page.getByRole("combobox", { name: "Animate", exact: true }),
  ).toHaveValue("parameters");
  await page.getByRole("button", { name: "Play animation" }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  // Halfway through its time it turns back at the end of its track, the
  // string a whole lap shorter.
  await page.getByRole("slider", { name: "Animation progress" }).fill("0.5");
  await expect(art(page)).toHaveAttribute("data-animation-progress", "1");
  const shortest = await involute.getAttribute("d");
  expect(vertices(shortest)).toBeGreaterThan(1000);
  expect(longestStep(shortest)).toBeLessThan(0.04);
});

const coinStar = "A coin rolled round a three-pointed star",
  circlingPetals = "Petals circling a four-pointed star";

test("a coin rolled round a three-pointed star sweeps round petals when refined", async ({
  page,
}) => {
  await page.goto("/");
  await choosePreset(page, { label: coinStar });
  await ready(page);
  await expect(refine(page)).toBeChecked();
  await expect(readout(page)).toHaveText(
    /^[\d,]+ points added between samples\.$/,
  );
  const trace = art(page).getByTestId("derived-curve");
  const drawn = await trace.getAttribute("d");
  // Round the points the coin pivots, its tracing point sweeps an arc of
  // radius ρ + ℓ ≈ 1.03 in a drawing about 4.4 across: refined, a chord
  // strays at most 2·10⁻⁴ of the trace's radius from it, so it is at most
  // about 2% of the drawing.
  expect(longestStep(drawn)).toBeLessThan(0.03);
  await refine(page).uncheck();
  await ready(page);
  const uniform = await trace.getAttribute("d");
  expect(vertices(uniform)).toBeLessThanOrEqual(1000);
  expect(vertices(drawn)).toBeGreaterThan(vertices(uniform));
  expect(longestStep(uniform)).toBeGreaterThan(0.08);
  await refine(page).check();
  await ready(page);
  expect(await trace.getAttribute("d")).toBe(drawn);
});

test("petals circling a four-pointed star stay refined as the phase turns", async ({
  page,
}) => {
  await page.goto("/");
  await choosePreset(page, { label: circlingPetals });
  await ready(page);
  await expect(refine(page)).toBeChecked();
  const trace = art(page).getByTestId("derived-curve");
  const opening = await trace.getAttribute("d");
  expect(longestStep(opening)).toBeLessThan(0.03);
  await openAnimation(page);
  await expect(
    page.getByRole("combobox", { name: "Animate", exact: true }),
  ).toHaveValue("parameters");
  await page.getByRole("button", { name: "Play animation" }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  // Halfway, the phase has turned half a turn: the tracing point passes
  // nearest the contact at the star's points, where small loops now sit.
  await page.getByRole("slider", { name: "Animation progress" }).fill("0.5");
  await expect(art(page)).toHaveAttribute("data-animation-progress", "0.5");
  const halfway = await trace.getAttribute("d");
  expect(halfway).not.toBe(opening);
  expect(vertices(halfway)).toBeGreaterThan(1000);
  expect(longestStep(halfway)).toBeLessThan(0.03);
});

const swellingStar = "Circles swelling at a five-pointed star's points",
  breathingStar = "Circles breathing round a three-pointed star";

const branches = (page: Page) =>
  art(page).getByTestId("envelope-branches").locator("path");
const branchPaths = (page: Page) =>
  branches(page).evaluateAll((paths) => paths.map((p) => p.getAttribute("d")));
const circles = (page: Page) =>
  art(page)
    .getByTestId("generating-circles")
    .locator("circle")
    .evaluateAll((drawn) =>
      drawn.map((c) => ({
        x: Number(c.getAttribute("cx")),
        y: Number(c.getAttribute("cy")),
        r: Number(c.getAttribute("r")),
      })),
    );
// How far the outer branch's chords reach into the drawn circles, as a
// share of the circle's radius. The outer branch, the one reaching farthest
// from the drawing's center, bounds the union of the circles' disks: it lies
// on the circles and outside all of them, so where its chords follow it they
// stay outside, and where one cuts across a point it cuts into the circle
// there.
const outerDepth = async (page: Page) => {
  const drawn = (await branchPaths(page)).map((d) => pathPoints(d));
  const rings = await circles(page);
  const all = drawn.flat().filter((p): p is Point => !!p);
  const xs = all.map((p) => p.x),
    ys = all.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2,
    cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const reach = drawn.map((points) =>
    Math.max(
      ...points
        .filter((p): p is Point => !!p)
        .map((p) => Math.hypot(p.x - cx, p.y - cy)),
    ),
  );
  const outer = drawn[reach.indexOf(Math.max(...reach))];
  let depth = 0;
  outer.forEach((b, k) => {
    const a = outer[k - 1];
    if (!a || !b) return;
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    for (const c of rings)
      depth = Math.max(depth, (c.r - Math.hypot(m.x - c.x, m.y - c.y)) / c.r);
  });
  return depth;
};

test("circles swelling at a five-pointed star's points are enveloped round each point when refined", async ({
  page,
}) => {
  await page.goto("/");
  await choosePreset(page, { label: swellingStar });
  await ready(page);
  await expect(refine(page)).toBeChecked();
  await expect(readout(page)).toHaveText(
    /^[\d,]+ points added between samples\.$/,
  );
  await expect(branches(page)).toHaveCount(2);
  const drawn = await branchPaths(page);
  // Refined, a chord strays at most 2·10⁻⁴ of the branch's radius, about
  // 5, from the circle of radius 0.9 it follows round a point: 0.1% of
  // that radius, within the page's rounding.
  expect(await outerDepth(page)).toBeLessThan(0.005);
  for (const d of drawn) expect(longestStep(d)).toBeLessThan(0.03);
  await refine(page).uncheck();
  await ready(page);
  await expect(readout(page)).toHaveCount(0);
  const uniform = await branchPaths(page);
  drawn.forEach((d, k) => {
    expect(vertices(uniform[k])).toBeLessThanOrEqual(1000);
    expect(vertices(d)).toBeGreaterThan(vertices(uniform[k]));
  });
  // Round each point the circle's half turn takes a few samples, whose
  // chords cut deep into it.
  expect(await outerDepth(page)).toBeGreaterThan(0.1);
  expect(Math.max(...uniform.map(longestStep))).toBeGreaterThan(0.08);
  await refine(page).check();
  await ready(page);
  expect(await branchPaths(page)).toEqual(drawn);
});

test("circles breathing round a three-pointed star stay enveloped as their radii move", async ({
  page,
}) => {
  await page.goto("/");
  await choosePreset(page, { label: breathingStar });
  await ready(page);
  await expect(refine(page)).toBeChecked();
  const opening = await branchPaths(page);
  expect(await outerDepth(page)).toBeLessThan(0.005);
  await openAnimation(page);
  await expect(
    page.getByRole("combobox", { name: "Animate", exact: true }),
  ).toHaveValue("parameters");
  await page.getByRole("button", { name: "Play animation" }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  // Halfway through its time it turns back at the end of its track: the
  // circles are smallest at the points and largest along the sides.
  await page.getByRole("slider", { name: "Animation progress" }).fill("0.5");
  await expect(art(page)).toHaveAttribute("data-animation-progress", "1");
  const reversed = await branchPaths(page);
  expect(reversed).not.toEqual(opening);
  for (const d of reversed) {
    expect(vertices(d)).toBeGreaterThan(1000);
    expect(longestStep(d)).toBeLessThan(0.03);
  }
  expect(await outerDepth(page)).toBeLessThan(0.005);
});
