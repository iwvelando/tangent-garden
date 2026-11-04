import { test, expect, type Page, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import { wireStudy } from "./study-link-wire";
import { decodePng } from "./png";

// Hyperbolic lace: its entry from the gallery over the retained study,
// pointer and keyboard selection, layers, presentation, exports, refusals,
// cancellation, links and narrow layouts. Geometry is read back from the
// drawn SVG paths; the mathematical invariants are engine/lace_test.go's.

const stars = "Seven-pointed stars receding to the rim";
const path = "One tile and its path of reflections";

async function settled(page: Page) {
  await expect(page.locator(".app:visible .plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
}
async function openLace(page: Page, title = stars) {
  await page.getByRole("button", { name: "Browse notebook examples" }).click();
  const gallery = page.getByRole("dialog", { name: "Notebook examples" });
  await gallery
    .locator(`[data-lace-example][data-example-title="${title}"]`)
    .click();
  await gallery.waitFor({ state: "hidden" });
  const d = page.getByRole("dialog", { name: "Hyperbolic lace" });
  await ready(d);
  return d;
}
const ready = (d: Locator) =>
  expect(d.locator("#lace-artwork")).toHaveAttribute("aria-busy", "false");
const summary = (d: Locator) => d.locator(".lace-summary");
const tileCount = async (d: Locator) =>
  Number(
    (await summary(d).textContent())!
      .match(/^([\d,]+) tiles?/)![1]
      .replace(/,/g, ""),
  );

// A drawn segment in page units: a minor arc of radius r with SVG's sweep
// flag, or a line (r = 0).
type Segment = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  r: number;
  sweep: number;
};
type Run = {
  role: string;
  level: number;
  stroke: string;
  width: number;
  opacity: string | null;
  segments: Segment[];
};
const segmentPattern =
  /M(-?[\d.]+) (-?[\d.]+)(?:A(-?[\d.]+) -?[\d.]+ 0 0 ([01]) |L)(-?[\d.]+) (-?[\d.]+)/g;
function parse(d: string): Segment[] {
  return Array.from(d.matchAll(segmentPattern), (m) => ({
    x0: +m[1],
    y0: +m[2],
    r: m[3] === undefined ? 0 : +m[3],
    sweep: m[4] === undefined ? 0 : +m[4],
    x1: +m[5],
    y1: +m[6],
  }));
}
// Every path the drawing holds, grouped as it draws them.
async function runs(root: Locator): Promise<Run[]> {
  const raw = await root.evaluate((svg) =>
    Array.from(svg.querySelectorAll("path"), (p) => ({
      role: p.getAttribute("data-role")!,
      level: Number(p.getAttribute("data-level")),
      stroke: p.getAttribute("stroke")!,
      width: +p.getAttribute("stroke-width")!,
      opacity: p.getAttribute("opacity"),
      d: p.getAttribute("d")!,
    })),
  );
  return raw.map(({ d, ...r }) => {
    const segments = parse(d);
    // Every command is accounted for: nothing but arcs and lines.
    expect(d.replace(segmentPattern, "")).toBe("");
    return { ...r, segments };
  });
}
const segments = (all: Run[], ...roles: string[]) =>
  all.filter((r) => roles.includes(r.role)).flatMap((r) => r.segments);
// A segment's unordered end points, as a key.
const ends = (s: Segment) => {
  const a = `${s.x0},${s.y0}`,
    b = `${s.x1},${s.y1}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
};

test("arcs keep their sweep on the page, diameters are lines, and strokes taper by half-octaves", async ({
  page,
}) => {
  const { arcCommand, taper } = await import("../web/lace/Drawing");
  // A geodesic through (1, 0) and (0, 1): the unit circle about (1, 1).
  // Its minor arc between them passes nearest the origin, through
  // (1 − 1/√2, 1 − 1/√2); the browser's own arc geometry must agree, in
  // either direction.
  const c = { x: 1, y: 1 };
  const k = 100;
  const want = {
    x: 500 + (1 - Math.SQRT1_2) * k,
    y: 380 - (1 - Math.SQRT1_2) * k,
  };
  for (const [s, e] of [
    [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ],
    [
      { x: 0, y: 1 },
      { x: 1, y: 0 },
    ],
  ]) {
    const d = arcCommand(s, e, c, 1, false, k);
    const mid = await page.evaluate((d) => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", d);
      svg.append(p);
      document.body.append(svg);
      const at = p.getPointAtLength(p.getTotalLength() / 2);
      return { x: at.x, y: at.y, length: p.getTotalLength() };
    }, d);
    expect(mid.x).toBeCloseTo(want.x, 3);
    expect(mid.y).toBeCloseTo(want.y, 3);
    // A quarter of the circle, the minor arc (the major would be 471),
    // within the browser's own length approximation.
    expect(Math.abs(mid.length - (Math.PI / 2) * k)).toBeLessThan(0.5);
  }
  expect(arcCommand({ x: 1, y: 0 }, { x: 0, y: 1 }, c, 1, false, k)).toBe(
    "M600 380A100 100 0 0 1 500 280",
  );
  expect(
    arcCommand({ x: -0.5, y: 0 }, { x: 0.25, y: 0 }, c, 0, true, 350),
  ).toBe("M325 380L587.5 380");
  // Width falls with the square root of drawn size: a quarter-octave per
  // half-octave level, to a floor.
  expect(taper(0)).toBe(1);
  expect(taper(4)).toBeCloseTo(0.5, 12);
  expect(taper(8)).toBeCloseTo(0.25, 12);
  expect(taper(40)).toBe(0.06);
});

test("an address names its tile through its parents, and is absent beyond the cutoffs", async () => {
  const { addressOf, indexOf, presented } = await import("../web/lace/model");
  // Tiles 0–4: the seed, two children across sides 2 and 5, and their
  // children across sides 0 and 6.
  const r = {
    center: [0, 1, 2, 3, 4].map(() => ({ x: 0, y: 0 })),
    parent: [-1, 0, 0, 1, 2],
    via: [-1, 2, 5, 0, 6],
  } as any;
  expect([0, 1, 2, 3, 4].map((i) => addressOf(r, i))).toEqual([
    [],
    [2],
    [5],
    [2, 0],
    [5, 6],
  ]);
  for (let i = 0; i < 5; i++) expect(indexOf(r, addressOf(r, i))).toBe(i);
  expect(indexOf(r, [2, 6])).toBe(-1);
  expect(indexOf(r, [5, 6, 1])).toBe(-1);
  expect(indexOf(r, undefined)).toBe(-1);
  expect(presented(r, "selected", 4)).toEqual([0, 2, 4]);
  expect(presented(r, "selected", -1)).toEqual([0]);
  expect(presented(r, "complete", 4)).toEqual([0, 1, 2, 3, 4]);
});

// Following frames a tile by its corners' bounding box, centered, with the
// box's larger side a quarter of the page's height, within zoom 1–100.
// Independent page arithmetic on hand-made corners, not the camera code.
test("following frames a tile's corners centered at a quarter of the drawing's height", async () => {
  const { followView } = await import("../web/lace/model");
  // Tile 0: corners spanning x −0.3–0.3 and y −0.25–0.3; tile 1: a small
  // tile near (0.6, −0.4), 0.02 wide and 0.01 high; tile 2: tiny.
  const box = (x0: number, x1: number, y0: number, y1: number) => [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
    { x: (x0 + x1) / 2, y: y1 },
    { x: x0, y: (y0 + y1) / 2 },
    { x: x1, y: (y0 + y1) / 2 },
  ];
  const vertex = [
    ...box(-0.3, 0.3, -0.25, 0.3),
    ...box(0.59, 0.61, -0.405, -0.395),
    ...box(0.9, 0.9 + 1e-4, 0, 1e-4),
  ];
  const r = { vertex, corners: vertex.map((_, i) => i) } as any;
  const page = (v: { x: number; y: number }, c: any) => ({
    x: 500 + v.x * 350 * c.zoom + c.x,
    y: 380 - v.y * 350 * c.zoom + c.y,
  });
  const small = followView(r, 1);
  const mid = page({ x: 0.6, y: -0.4 }, small);
  expect(mid.x).toBeCloseTo(500, 9);
  expect(mid.y).toBeCloseTo(380, 9);
  // The box's larger side, 0.02 wide, fills a quarter of 760.
  expect(0.02 * 350 * small.zoom).toBeCloseTo(760 / 4, 9);
  // A large tile is never zoomed out past the whole disk, and a tiny one
  // is centered at the zoom limit.
  expect(followView(r, 0).zoom).toBe(1);
  const tiny = followView(r, 2);
  expect(tiny.zoom).toBe(100);
  expect(page({ x: 0.9 + 5e-5, y: 5e-5 }, tiny).x).toBeCloseTo(500, 6);
  // A centered view's pan has no negative zero.
  expect(Object.is(followView(r, 0).x, -0)).toBe(false);
});

test("the lace opens from the gallery over an untouched study and returns to it", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  const x = page.getByLabel("x(t)", { exact: true });
  await x.fill("cos(t) + 0.25");
  await settled(page);
  const d = await openLace(page);
  await expect(d.getByLabel("Star point", { exact: true })).toHaveValue("0.3");
  await expect(d.getByLabel("Depth", { exact: true })).toHaveValue("5");
  const art = d.locator("#lace-artwork");
  expect(await tileCount(d)).toBe(617);
  await expect(summary(d)).toContainText("1,008 tiles beyond depth 5");
  const all = await runs(art);
  // Fourteen strokes per tile, and each tile side drawn once: 2,856
  // distinct sides, as many as the complete five rings have.
  const motif = segments(all, "motif");
  expect(motif).toHaveLength(14 * 617);
  const sides = segments(all, "edge");
  expect(new Set(sides.map(ends)).size).toBe(sides.length);
  expect(sides).toHaveLength(2856);
  // Analytic arcs, not polylines; the seven sides leaving the center
  // tile's corners lie on diameters and are lines.
  expect(sides.filter((s) => s.r === 0).length).toBeGreaterThanOrEqual(7);
  expect(motif.every((s) => s.r > 0)).toBe(true);
  // Everything lies within the rim, drawn once as a circle of radius 350
  // about the page's center at 1×; nothing else, no text.
  const rim = art.locator('circle[data-role="rim"]');
  await expect(rim).toHaveAttribute("r", "350");
  await expect(art.locator("circle")).toHaveCount(1);
  await expect(art.locator("text, [pointer-events]")).toHaveCount(0);
  for (const s of [...motif, ...sides])
    for (const [px, py] of [
      [s.x0, s.y0],
      [s.x1, s.y1],
    ])
      expect(Math.hypot(px - 500, py - 380)).toBeLessThan(350);
  // Strokes taper toward the rim: the outer rings are drawn thinner.
  const widths = all.filter((r) => r.role === "motif").map((r) => r.width);
  expect(Math.max(...widths)).toBe(1.6);
  expect(Math.min(...widths)).toBeLessThan(0.5);
  await d.getByRole("button", { name: "Return to study", exact: true }).click();
  await expect(d).toBeHidden();
  await expect(x).toHaveValue("cos(t) + 0.25");
  await expect(
    page.getByRole("button", { name: "Browse notebook examples" }),
  ).toBeFocused();
});

// The page point of a model point, then the client point over the drawing.
async function client(art: Locator, p: { x: number; y: number }) {
  const box = (await art.boundingBox())!;
  const k = box.width / 1000;
  return { x: box.x + p.x * k, y: box.y + p.y * k };
}
// The center of the selected tile's drawn outline, in page units.
async function selectedCenter(art: Locator) {
  const sides = segments(await runs(art), "selectedEdge");
  expect(sides).toHaveLength(7);
  const xs = sides.flatMap((s) => [s.x0, s.x1]),
    ys = sides.flatMap((s) => [s.y0, s.y1]);
  return {
    x: xs.reduce((a, b) => a + b) / xs.length,
    y: ys.reduce((a, b) => a + b) / ys.length,
  };
}

test("clicking a tile selects it, forgivingly at the patch's edge, and selection leaves the geometry unchanged", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openLace(page);
  const art = d.locator("#lace-artwork");
  const field = d.getByLabel("Tile", { exact: true });
  const before = await runs(art);
  // Tile 40, chosen by number, then found again by clicking its middle.
  await field.fill("40");
  await expect(art).toHaveAttribute("data-selected", "39");
  const middle = await selectedCenter(art);
  const highlighted = await runs(art);
  // The selection overlays the same geometry: the union of all drawn
  // motif strokes and sides is unchanged, and only roles and opacity move.
  const union = (all: Run[], ...roles: string[]) =>
    new Set(segments(all, ...roles).map(ends));
  expect(union(highlighted, "motif", "pathMotif", "selectedMotif")).toEqual(
    union(before, "motif"),
  );
  expect(union(highlighted, "edge", "pathEdge", "selectedEdge")).toEqual(
    union(before, "edge"),
  );
  expect(highlighted.find((r) => r.role === "motif")!.opacity).toBe("0.35");
  await d.getByRole("button", { name: "Clear selection", exact: true }).click();
  expect(await runs(art)).toEqual(before);
  const at = await client(art, middle);
  await page.mouse.click(at.x, at.y);
  await expect(art).toHaveAttribute("data-selected", "39");
  await expect(d.locator(".garden-about h3")).toHaveText("Tile 40");
  // Containment, not nearness: a point just inside a side belongs to the
  // tile, and just across its outward side to the smaller tile beyond,
  // although the larger tile's center is relatively nearer.
  const outward = await art.evaluate((svg, c) => {
    let best = { x: 0, y: 0, far: -1 };
    for (const p of svg.querySelectorAll('path[data-role="selectedEdge"]')) {
      for (const run of p.getAttribute("d")!.match(/M[^M]*/g)!) {
        const q = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path",
        );
        q.setAttribute("d", run);
        svg.append(q);
        const m = q.getPointAtLength(q.getTotalLength() / 2);
        q.remove();
        const far = Math.hypot(m.x - 500, m.y - 380);
        if (far > best.far) best = { x: m.x, y: m.y, far };
      }
    }
    const len = Math.hypot(best.x - c.x, best.y - c.y);
    const u = { x: (best.x - c.x) / len, y: (best.y - c.y) / len };
    return {
      inside: { x: best.x - 3 * u.x, y: best.y - 3 * u.y },
      across: { x: best.x + 3 * u.x, y: best.y + 3 * u.y },
    };
  }, middle);
  for (const [where, inside] of [
    [outward.inside, true],
    [outward.across, false],
  ] as const) {
    const p = await client(art, where);
    await page.mouse.click(p.x, p.y);
    if (inside) await expect(art).toHaveAttribute("data-selected", "39");
    else {
      await expect(art).not.toHaveAttribute("data-selected", "39");
      await expect(d.locator(".garden-facts").first()).toContainText("Depth 4");
    }
  }
  // Beyond the rim, outside every tile but within the pointer's
  // tolerance of the last ring's corners, the nearest outer tile.
  const top = await client(art, { x: 500, y: 24 });
  await page.mouse.click(top.x, top.y);
  await expect(d.locator(".garden-facts").first()).toContainText("Depth 5");
  // Far outside the disk, a click changes nothing.
  const selected = await art.getAttribute("data-selected");
  const corner = await client(art, { x: 40, y: 40 });
  await page.mouse.click(corner.x, corner.y);
  await expect(art).toHaveAttribute("data-selected", selected!);
  // A drag is a pan, not a selection.
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 40, at.y + 10, { steps: 4 });
  await page.mouse.up();
  await expect(art).toHaveAttribute("data-selected", selected!);
  expect(await art.getAttribute("data-pan")).not.toBe("0,0");
});

test("keyboard selection steps through tiles and across their sides", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openLace(page, path);
  const art = d.locator("#lace-artwork");
  const field = d.getByLabel("Tile", { exact: true });
  // The preset selects tile 66 by its address 4, 0, 3.
  await expect(field).toHaveValue("66");
  await expect(d.locator(".garden-about")).toContainText(
    "Sides crossed from the center: 5 → 1 → 4",
  );
  await expect(d.locator(".garden-about")).toContainText(
    "across its side 5, then its side 1, then its side 4 gives",
  );
  await expect(d.locator(".garden-about")).toContainText(
    "corners and its motif run clockwise",
  );
  // The path presentation: the four tiles crossed, the center first.
  await d.getByLabel("Presentation", { exact: true }).selectOption("selected");
  const drawn = await runs(art);
  expect(segments(drawn, "pathMotif", "selectedMotif")).toHaveLength(14 * 4);
  expect(segments(drawn, "selectedMotif")).toHaveLength(14);
  expect(segments(drawn, "motif")).toHaveLength(0);
  // Across side 4, the last one crossed, the tile it was reached from.
  const neighbors = d.getByRole("group", { name: "Neighboring tiles" });
  const back = neighbors.getByRole("button", {
    name: /^Across side 4: Tile/,
  });
  const name = (await back.getAttribute("aria-label"))!.split(": ")[1];
  await back.focus();
  await page.keyboard.press("Enter");
  await expect(d.locator(".garden-about h3")).toHaveText(name);
  await expect(d.locator(".garden-about h3")).toHaveText("Tile 22");
  await expect(d.locator(".garden-about")).toContainText(
    "run counterclockwise again",
  );
  const opening = Number(await field.inputValue());
  await d.getByRole("button", { name: "Next tile", exact: true }).click();
  await expect(field).toHaveValue(String(opening + 1));
  await d.getByRole("button", { name: "Previous tile", exact: true }).click();
  await expect(field).toHaveValue(String(opening));
  // Emptying the field keeps it empty for typing without losing the
  // selection; leaving it restores the selected number.
  await field.click();
  await field.selectText();
  await page.keyboard.press("Backspace");
  await expect(field).toHaveValue("");
  await expect(d.locator(".garden-about h3")).toHaveText(`Tile ${opening}`);
  await field.blur();
  await expect(field).toHaveValue(String(opening));
  await field.fill("1");
  await expect(d.locator(".garden-about")).toContainText("The center tile");
  // An outer-ring tile has neighbors beyond the patch.
  await field.fill("617");
  await expect(
    neighbors.getByRole("button", { name: /beyond the patch/ }).first(),
  ).toBeDisabled();
  await d.getByRole("button", { name: "Clear selection", exact: true }).click();
  await expect(art).toHaveAttribute("data-selected", "-1");
  await expect(d.getByText("No tile selected.")).toBeVisible();
  // With nothing selected, the path presentation is the center tile.
  expect(segments(await runs(art), "motif")).toHaveLength(14);
  // The drawing's own keys pan and zoom the camera.
  await art.focus();
  await page.keyboard.press("+");
  await expect(art).toHaveAttribute("data-zoom", "1.2");
  await page.keyboard.press("ArrowRight");
  await expect(art).toHaveAttribute("data-pan", "25,0");
  await page.keyboard.press("Home");
  await expect(art).toHaveAttribute("data-zoom", "1");
  // In a panned view + and − zoom about the middle of the page: the disk's
  // center, drawn at the pan from the middle, moves away from it and back
  // by the zoom.
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowUp");
  await expect(art).toHaveAttribute("data-pan", "-25,-25");
  const pan = async () =>
    (await art.getAttribute("data-pan"))!.split(",").map(Number);
  await page.keyboard.press("+");
  await page.keyboard.press("+");
  await expect(art).toHaveAttribute("data-zoom", String(1.2 * 1.2));
  for (const v of await pan()) expect(v).toBeCloseTo(-25 * 1.44, 9);
  await expect(art.locator('circle[data-role="rim"]')).toHaveAttribute(
    "r",
    String(350 * 1.2 * 1.2),
  );
  await page.keyboard.press("-");
  await page.keyboard.press("-");
  await expect
    .poll(async () => Number(await art.getAttribute("data-zoom")))
    .toBeCloseTo(1, 12);
  for (const v of await pan()) expect(v).toBeCloseTo(-25, 9);
});

test("layers hide the motif or the sides, never the rim, and zoom moves the camera only", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openLace(page);
  const art = d.locator("#lace-artwork");
  const legend = (key: string) =>
    d.locator(`.garden-legend [data-legend="${key}"]`);
  const before = await runs(art);
  await d.getByRole("checkbox", { name: "Tile sides" }).uncheck();
  let all = await runs(art);
  expect(segments(all, "edge")).toHaveLength(0);
  expect(segments(all, "motif")).toEqual(segments(before, "motif"));
  await expect(legend("edges")).toHaveClass(/legend-off/);
  // With the sides hidden, a selection still outlines its own tile.
  await d.getByLabel("Tile", { exact: true }).fill("3");
  all = await runs(art);
  expect(segments(all, "selectedEdge")).toHaveLength(7);
  expect(segments(all, "edge", "pathEdge")).toHaveLength(0);
  await d.getByRole("checkbox", { name: "Motif" }).uncheck();
  all = await runs(art);
  expect(segments(all, "motif", "pathMotif", "selectedMotif")).toHaveLength(0);
  await expect(art.locator('circle[data-role="rim"]')).toHaveCount(1);
  await expect(legend("motif")).toHaveClass(/legend-off/);
  await expect(legend("rim")).not.toHaveClass(/legend-off/);
  await d.getByRole("checkbox", { name: "Motif" }).check();
  await d.getByRole("checkbox", { name: "Tile sides" }).check();
  await d.getByRole("button", { name: "Clear selection", exact: true }).click();
  expect(await runs(art)).toEqual(before);
  // Zoom scales the drawing about the page's center: every point moves
  // away from it by the zoom, so the disk keeps its shape and no tile
  // moves within it.
  await art.focus();
  await page.keyboard.press("+");
  const zoomed = await runs(art);
  // Strokes regroup as their taper levels change, so compare as sets.
  const a = segments(before, "motif"),
    b = segments(zoomed, "motif");
  expect(b).toHaveLength(a.length);
  const key = (x: number, y: number) =>
    `${Math.round(x * 10)},${Math.round(y * 10)}`;
  const starts = new Set(b.map((s) => key(s.x0 - 500, s.y0 - 380)));
  // Each sampled start, scaled by the zoom about the center, is a drawn
  // start, within the 0.001 rounding of each, so within one tenth-cell.
  const scaled = (s: Segment) =>
    [-1, 0, 1].some((dx) =>
      [-1, 0, 1].some((dy) =>
        starts.has(
          key((s.x0 - 500) * 1.2 + dx / 10, (s.y0 - 380) * 1.2 + dy / 10),
        ),
      ),
    );
  const sample = a.filter((_, i) => i % 97 === 0);
  expect(sample.filter(scaled)).toHaveLength(sample.length);
  await expect(art.locator('circle[data-role="rim"]')).toHaveAttribute(
    "r",
    "420",
  );
});

test("the star point reshapes only the motif, accepts constants, and at 0 draws radii as lines", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openLace(page);
  const art = d.locator("#lace-artwork");
  const star = d.getByLabel("Star point", { exact: true });
  const before = await runs(art);
  await star.fill("1/phi");
  await star.blur();
  await expect(summary(d)).toHaveAttribute("data-current", "true");
  await expect
    .poll(async () => segments(await runs(art), "motif")[0])
    .not.toEqual(segments(before, "motif")[0]);
  await ready(d);
  const after = await runs(art);
  expect(segments(after, "edge")).toEqual(segments(before, "edge"));
  expect(segments(after, "motif")).toHaveLength(14 * 617);
  await star.fill("0");
  await star.blur();
  await expect
    .poll(async () => segments(await runs(art), "motif").some((s) => s.r === 0))
    .toBe(true);
  // The center tile's fourteen strokes run from its center, a diameter's
  // segment each.
  const center = segments(await runs(art), "motif").filter(
    (s) => s.x1 === 500 && s.y1 === 380,
  );
  expect(center.length).toBeGreaterThanOrEqual(7);
  expect(center.every((s) => s.r === 0)).toBe(true);
});

test("cutoffs at their bounds are accepted, and invalid ones are refused under their fields", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openLace(page);
  const star = d.getByLabel("Star point", { exact: true });
  const depth = d.getByLabel("Depth", { exact: true });
  const limit = d.getByLabel("Tile limit", { exact: true });
  const error = (field: Locator) =>
    field
      .locator("xpath=ancestor::div[contains(@class,'field')][1]")
      .locator(".field-error");
  const share = d.getByRole("button", { name: "Copy link", exact: true });
  const exportButton = d.getByRole("button", { name: "Export image" });
  const art = d.locator("#lace-artwork");
  const before = segments(await runs(art), "motif").length;
  await star.fill("1.5");
  await expect(error(star)).toContainText("0–1");
  await expect(share).toBeDisabled();
  await expect(exportButton).toBeDisabled();
  // The previous drawing stays while the refusal is shown.
  expect(segments(await runs(art), "motif")).toHaveLength(before);
  await star.fill("1/0");
  await expect(error(star)).toBeVisible();
  await star.fill("1");
  await ready(d);
  await expect(error(star)).toHaveCount(0);
  await depth.fill("9");
  await expect(error(depth)).toContainText("0–8");
  await depth.fill("");
  await expect(error(depth)).toContainText("whole number");
  await depth.fill("0");
  await ready(d);
  expect(await tileCount(d)).toBe(1);
  await expect(summary(d)).toContainText("7 tiles beyond depth 0");
  await limit.fill("0");
  await expect(error(limit)).toContainText("1–1000");
  await limit.fill("1");
  await depth.fill("8");
  await ready(d);
  // The stop is a reason, not an error: emphasized, not alerted.
  await expect(d.locator(".garden-stopped")).toHaveText(
    /^Stopped at the 1-tile limit.*incomplete\.$/,
  );
  // The largest admitted patch: the count, not the depth, ends it.
  await limit.fill("1000");
  await ready(d);
  expect(await tileCount(d)).toBe(1000);
  await expect(summary(d)).toContainText("Stopped at the 1,000-tile limit");
  await expect(summary(d)).toContainText("depth 6 is incomplete");
  expect(segments(await runs(art), "motif")).toHaveLength(14 * 1000);
  await expect(share).toBeEnabled();
  await expect(d.getByRole("alert")).toHaveCount(0);
});

async function save(page: Page, d: Locator, format: "SVG" | "PNG") {
  const download = page.waitForEvent("download");
  await d.getByRole("button", { name: "Export image" }).click();
  await page.getByRole("menuitem", { name: new RegExp(format) }).click();
  return (await download).path();
}
function pngText(bytes: Buffer) {
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at),
      name = bytes.toString("ascii", at + 4, at + 8);
    if (name === "iTXt") {
      const body = bytes.subarray(at + 8, at + 8 + length).toString("utf8");
      const [keyword, ...rest] = body.split("\0");
      if (keyword === "Tangent Garden")
        return JSON.parse(rest.slice(4).join("\0"));
    }
    at += 12 + length;
  }
  throw new Error("no Tangent Garden metadata");
}

test("SVG and PNG stills reproduce the drawing and selection with their record", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openLace(page, path);
  const art = d.locator("#lace-artwork");
  await art.focus();
  await page.keyboard.press("+");
  const live = await runs(art);
  const svgText = await readFile((await save(page, d, "SVG"))!, "utf8");
  const exported = await page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    return {
      desc: JSON.parse(doc.querySelector("svg > desc")!.textContent!),
      paths: Array.from(doc.querySelectorAll("path"), (p) => ({
        role: p.getAttribute("data-role"),
        d: p.getAttribute("d"),
      })),
      text: doc.querySelectorAll("text, [pointer-events]").length,
      viewBox: doc.documentElement.getAttribute("viewBox"),
      rim: doc.querySelector('circle[data-role="rim"]')?.getAttribute("r"),
    };
  }, svgText);
  expect(exported.viewBox).toBe("0 0 1000 760");
  expect(exported.text).toBe(0);
  expect(exported.rim).toBe("420");
  // The same analytic arcs, path for path.
  expect(
    exported.paths.map((p) => ({ role: p.role, segments: parse(p.d!) })),
  ).toEqual(live.map((r) => ({ role: r.role, segments: r.segments })));
  const record = exported.desc;
  expect(record).toMatchObject({
    kind: "hyperbolic-lace",
    tiling: "{7,3}",
    model: "Poincaré disk",
    units: "rim radius = 1",
    depth: 5,
    maxTiles: 1000,
    starPoint: 0.3,
    tiles: 617,
    omitted: { depth: 1008, precision: 0 },
    edges: true,
    motif: true,
    presentation: "complete",
    view: { x: 0, y: 0, zoom: 1.2 },
    weight: "regular",
    selected: { number: 66, address: [4, 0, 3], depth: 3, reversed: true },
  });
  expect(record.metric).toContain("curvature −1");
  expect(record.finite).toContain("617 tiles within 5 reflections");
  expect(record.finite).toContain("no tile reaches it");
  const png = await readFile((await save(page, d, "PNG"))!);
  const image = decodePng(png);
  expect([image.width, image.height]).toEqual([2000, 1520]);
  expect(pngText(png)).toEqual(record);
  // The selected tile's ink reaches the raster.
  const ink = live.find((r) => r.role === "selectedMotif")!.stroke;
  const [r, g, b] = [1, 3, 5].map((k) => parseInt(ink.slice(k, k + 2), 16));
  let near = 0;
  for (let k = 0; k < image.rgba.length; k += 4)
    if (
      Math.abs(image.rgba[k] - r) < 24 &&
      Math.abs(image.rgba[k + 1] - g) < 24 &&
      Math.abs(image.rgba[k + 2] - b) < 24
    )
      near++;
  expect(near).toBeGreaterThan(50);
});

test("the lace draws and exports with the notebook's theme and color scheme", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("tangent-garden.theme", "dark");
    localStorage.setItem("tangent-garden.color-scheme", "cobalt");
  });
  await page.goto("/");
  const { plotPalette } = await import("../web/palette");
  const palette = plotPalette(true, "cobalt");
  const d = await openLace(page);
  await d.getByLabel("Tile", { exact: true }).fill("20");
  const art = d.locator("#lace-artwork");
  const inks = new Map((await runs(art)).map((r) => [r.role, r.stroke]));
  expect(Object.fromEntries(inks)).toEqual({
    edge: palette.line,
    motif: palette.base,
    pathEdge: palette.base,
    pathMotif: palette.base,
    selectedEdge: palette.derived,
    selectedMotif: palette.derived,
  });
  await expect(art.locator('circle[data-role="rim"]')).toHaveAttribute(
    "stroke",
    palette.base,
  );
  await expect(art.locator(":scope > rect")).toHaveAttribute(
    "fill",
    palette.bg,
  );
  const svgText = await readFile((await save(page, d, "SVG"))!, "utf8");
  expect(svgText).toMatch(
    new RegExp(`^<svg[^>]* style="background:${palette.bg}"`),
  );
  expect(svgText).toContain(`stroke="${palette.derived}"`);
  expect(svgText).toContain('"theme":"dark","scheme":"cobalt"');
  // The legend's swatches follow the scheme too.
  const rgb = (hex: string) =>
    `rgb(${[1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16)).join(", ")})`;
  for (const [swatch, hex] of [
    [".line-dot", palette.line],
    [".derived-dot", palette.derived],
    [".base-dot", palette.base],
  ])
    expect(
      await d
        .locator(`.garden-legend ${swatch}`)
        .first()
        .evaluate((e) => getComputedStyle(e).backgroundColor),
    ).toBe(rgb(hex));
});

test("rapid edits keep one computation and show only the latest patch; Return ends the workers", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.lacePosts = [];
    w.terminated = 0;
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (q: any, ...rest: any[]) {
      if (q?.action === "lace") {
        w.lacePosts.push(q.lace.depth);
        setTimeout(() => send.call(this, q, ...rest), 400);
      } else send.call(this, q, ...rest);
    };
    const end = Worker.prototype.terminate;
    Worker.prototype.terminate = function () {
      w.terminated++;
      return end.call(this);
    };
  });
  await page.goto("/");
  const d = await openLace(page);
  const depth = d.getByLabel("Depth", { exact: true });
  await page.evaluate(() => ((window as any).lacePosts.length = 0));
  await depth.fill("1");
  await expect
    .poll(() => page.evaluate(() => (window as any).lacePosts))
    .toEqual([1]);
  // The previous patch stays, marked busy, while one is pending.
  await expect(d.locator("#lace-artwork")).toHaveAttribute("aria-busy", "true");
  expect(await tileCount(d)).toBe(617);
  for (const v of ["2", "3", "4"]) {
    await depth.fill(v);
    await page.waitForTimeout(160);
  }
  await ready(d);
  expect(await tileCount(d)).toBe(232);
  const posts: number[] = await page.evaluate(() => (window as any).lacePosts);
  // The first edit runs; the newest intent replaces the rest while it does.
  expect(posts[0]).toBe(1);
  expect(posts.at(-1)).toBe(4);
  expect(posts.length).toBeLessThanOrEqual(3);
  await depth.fill("3");
  await page.waitForTimeout(150);
  const before = await page.evaluate(() => (window as any).terminated);
  await d.getByRole("button", { name: "Return to study", exact: true }).click();
  await expect(d).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => (window as any).terminated))
    .toBeGreaterThanOrEqual(before + 2);
  await settled(page);
});

test("restoring the shown settings invalidates a pending replacement", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.lacePosts = [];
    w.releaseLace = () => {};
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (q: any, ...rest: any[]) {
      if (q?.action === "lace") {
        w.lacePosts.push(q.lace.depth);
        if (q.lace.depth === 4) {
          this.addEventListener("message", (event) => {
            if (event.data.id === q.id) w.laceDelivered = true;
          });
          w.releaseLace = () => send.call(this, q, ...rest);
          return;
        }
      }
      send.call(this, q, ...rest);
    };
  });
  await page.goto("/");
  const d = await openLace(page);
  const art = d.locator("#lace-artwork");
  const original = await runs(art);
  const depth = d.getByLabel("Depth", { exact: true });
  await depth.fill("4");
  await expect
    .poll(() => page.evaluate(() => (window as any).lacePosts))
    .toEqual([5, 4]);
  await depth.fill("5");
  await ready(d);
  await page.evaluate(() => (window as any).releaseLace());
  // Wait until the held reply crosses the real worker/client boundary.
  await expect
    .poll(() => page.evaluate(() => (window as any).laceDelivered))
    .toBe(true);
  await ready(d);
  expect(await runs(art)).toEqual(original);
  expect(await tileCount(d)).toBe(617);
  await expect(summary(d)).toHaveAttribute("data-current", "true");
});

test("a failed engine is reported and the lace recovers when asked again", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  await page.route(/engine\.worker.*\.js/, (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: "throw new Error()",
    }),
  );
  await page.getByRole("button", { name: "Browse notebook examples" }).click();
  await page.locator('[data-lace-example="0"]').click();
  const d = page.getByRole("dialog", { name: "Hyperbolic lace" });
  await expect(d.getByRole("alert")).toContainText("engine");
  await page.unroute(/engine\.worker.*\.js/);
  await d.getByRole("button", { name: "Try again", exact: true }).click();
  await ready(d);
  expect(await tileCount(d)).toBe(617);
  await expect(d.getByRole("alert")).toHaveCount(0);
});

test("lace links restore settings, layers, selection, presentation and view over the study they came from", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as any).copied = value;
        },
      },
    }),
  );
  await page.goto("/");
  await settled(page);
  const x = page.getByLabel("x(t)", { exact: true });
  await x.fill("cos(t) + 0.5");
  await settled(page);
  const d = await openLace(page, path);
  await d.getByLabel("Depth", { exact: true }).fill("4");
  await d.getByLabel("Star point", { exact: true }).fill("0.45");
  await d.getByRole("checkbox", { name: "Tile sides" }).uncheck();
  await d.getByLabel("Presentation", { exact: true }).selectOption("selected");
  await d.getByLabel("Line weight", { exact: true }).selectOption("fine");
  await ready(d);
  const art = d.locator("#lace-artwork");
  await art.focus();
  await page.keyboard.press("+");
  await page.keyboard.press("ArrowDown");
  // Following, remembering the view above to return to, then a manual
  // adjustment of the framed view.
  await d.getByRole("checkbox", { name: "Follow selection" }).check();
  await expectFramed(art);
  await art.focus();
  await page.keyboard.press("ArrowUp");
  const followed = {
    zoom: Number(await art.getAttribute("data-zoom")),
    pan: (await art.getAttribute("data-pan"))!.split(",").map(Number),
  };
  await expect(d.getByRole("button", { name: "Copy link" })).toBeEnabled();
  await d.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(d.getByText("Link copied", { exact: true })).toBeVisible();
  const link: string = await page.evaluate(() => (window as any).copied);
  const saved = wireStudy(new URL(link).hash.slice(3));
  expect(saved.config.curve.x).toBe("cos(t) + 0.5");
  expect(saved.garden).toBeUndefined();
  expect(saved.lace).toEqual({
    tiling: "7,3",
    depth: 4,
    maxTiles: 1000,
    starPoint: 0.45,
    edges: false,
    motif: true,
    selected: [4, 0, 3],
    presentation: "selected",
    view: { x: followed.pan[0], y: followed.pan[1], zoom: followed.zoom },
    follow: true,
    viewBeforeFollow: { x: 0, y: 25, zoom: 1.2 },
    weight: "fine",
  });
  const drawn = await runs(art);
  await d.getByRole("button", { name: "Return to study", exact: true }).click();
  await x.fill("cos(t)");
  await settled(page);
  await page.goto(link);
  const reopened = page.getByRole("dialog", { name: "Hyperbolic lace" });
  await ready(reopened);
  const again = reopened.locator("#lace-artwork");
  await expect(again).toHaveAttribute("data-selected", "65");
  // Opening a link never reframes: the saved view, adjusted, is kept.
  await expect(again).toHaveAttribute("data-zoom", String(followed.zoom));
  await expect(again).toHaveAttribute("data-pan", followed.pan.join(","));
  await expect(again).toHaveAttribute("data-presentation", "selected");
  expect(await runs(again)).toEqual(drawn);
  const following = reopened.getByRole("checkbox", {
    name: "Follow selection",
  });
  await expect(following).toBeChecked();
  await following.uncheck();
  await expect(again).toHaveAttribute("data-zoom", "1.2");
  await expect(again).toHaveAttribute("data-pan", "0,25");
  await reopened
    .getByRole("button", { name: "Return to study", exact: true })
    .click();
  await expect(x).toHaveValue("cos(t) + 0.5");
});

test("a lace link whose selection lies beyond its cutoffs opens and says so", async ({
  page,
}) => {
  const { presetStudy } = await import("../web/planar-link");
  const { presetLace } = await import("../web/lace/model");
  const lace = { ...presetLace(1), depth: 2 };
  // Its tile lies at depth 3.
  const token = deflateRawSync(
    JSON.stringify({
      v: 1,
      notebook: "2d",
      study: { ...presetStudy(0), lace },
    }),
  ).toString("base64url");
  await page.goto(`/#s=${token}`);
  const d = page.getByRole("dialog", { name: "Hyperbolic lace" });
  await ready(d);
  await expect(d.locator("#lace-artwork")).toHaveAttribute(
    "data-selected",
    "-1",
  );
  await expect(
    d.getByText("The selected tile lies beyond the current cutoffs."),
  ).toBeVisible();
  // Raising the depth finds the same tile again, by its address.
  await d.getByLabel("Depth", { exact: true }).fill("3");
  await ready(d);
  await expect(d.locator(".garden-about h3")).toHaveText("Tile 66");
});

for (const [name, viewport] of [
  ["phone portrait", { width: 390, height: 844 }],
  ["phone landscape", { width: 844, height: 390 }],
] as const)
  test(`the lace fits a ${name} layout with every control reachable`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport,
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    await page.goto("/");
    const d = await openLace(page, path);
    const art = d.locator("#lace-artwork");
    const box = (await art.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.height).toBeLessThanOrEqual(viewport.height);
    expect(await d.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(
      true,
    );
    // A tap on the middle of a drawn path tile, the center one, selects it.
    await d.getByLabel("Tile", { exact: true }).fill("1");
    const middle = await selectedCenter(art);
    await d.getByLabel("Tile", { exact: true }).fill("66");
    await art.scrollIntoViewIfNeeded();
    const at = await client(art, middle);
    await page.touchscreen.tap(at.x, at.y);
    await expect(art).toHaveAttribute("data-selected", "0");
    for (const control of [
      d.getByRole("group", { name: "Neighboring tiles" }),
      d.getByRole("checkbox", { name: "Follow selection" }),
      d.getByLabel("Presentation", { exact: true }),
      d.getByRole("checkbox", { name: "Motif" }),
      d.getByRole("checkbox", { name: "Tile sides" }),
      d.getByRole("button", { name: "Play motion" }),
      d.getByRole("slider", { name: "Animation progress" }),
      d.getByLabel("Farthest offset", { exact: true }),
      d.getByLabel("Orbits", { exact: true }),
      d.getByLabel("Turns", { exact: true }),
      d.getByLabel("Duration", { exact: true }),
      d.getByLabel("Repeat", { exact: true }),
      d.getByRole("button", { name: /^Export (MP4 video|animated WebP)/ }),
      d.getByLabel("Offset", { exact: true }),
      d.getByLabel("Direction", { exact: true }),
      d.getByLabel("Rotation", { exact: true }),
      d.getByLabel("Star point", { exact: true }),
      d.getByLabel("Depth", { exact: true }),
      d.getByLabel("Tile limit", { exact: true }),
      d.getByLabel("Line weight", { exact: true }),
      d.getByRole("button", { name: "Return to study", exact: true }),
    ]) {
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeInViewport();
    }
    await context.close();
  });

// The selected tile's corners as drawn, through the pan: the bounding box
// of its outline's end points, in page units.
async function framed(art: Locator) {
  const pan = (await art.getAttribute("data-pan"))!.split(",").map(Number);
  const sides = segments(await runs(art), "selectedEdge");
  const xs = sides.flatMap((s) => [s.x0, s.x1]).map((x) => x + pan[0]),
    ys = sides.flatMap((s) => [s.y0, s.y1]).map((y) => y + pan[1]);
  const [x0, x1, y0, y1] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  return {
    x: (x0 + x1) / 2,
    y: (y0 + y1) / 2,
    size: Math.max(x1 - x0, y1 - y0),
  };
}
// Centered, its larger side a quarter of 760, within the page's 0.001
// rounding of each corner.
async function expectFramed(art: Locator) {
  await expect
    .poll(async () => {
      const f = await framed(art);
      return [f.x, f.y, f.size].map((v) => Math.round(v * 100) / 100);
    })
    .toEqual([500, 380, 190]);
}

test("following the selection frames each new selection, keeps manual adjustments, and restores the earlier view", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openLace(page);
  const art = d.locator("#lace-artwork");
  const follow = d.getByRole("checkbox", { name: "Follow selection" });
  await expect(follow).not.toBeChecked();
  // The reader's own view before following.
  await art.focus();
  await page.keyboard.press("+");
  await page.keyboard.press("ArrowLeft");
  const before = {
    zoom: await art.getAttribute("data-zoom"),
    pan: await art.getAttribute("data-pan"),
  };
  // Nothing selected: following waits for a selection.
  await follow.check();
  await expect(art).toHaveAttribute("data-zoom", before.zoom!);
  const field = d.getByLabel("Tile", { exact: true });
  await field.fill("40");
  await expectFramed(art);
  await d.getByRole("button", { name: "Next tile", exact: true }).click();
  await expect(field).toHaveValue("41");
  await expectFramed(art);
  // A manual adjustment stays, with following still on.
  await art.focus();
  await page.keyboard.press("ArrowRight");
  expect((await framed(art)).x).toBeCloseTo(525, 2);
  await expect(follow).toBeChecked();
  await page.waitForTimeout(400);
  expect((await framed(art)).x).toBeCloseTo(525, 2);
  // The next change frames again: a neighbor button, then a click on a
  // neighboring tile in the drawing.
  await d
    .getByRole("group", { name: "Neighboring tiles" })
    .getByRole("button", { name: /^Across side 1: Tile/ })
    .click();
  await expectFramed(art);
  const selected = await art.getAttribute("data-selected");
  const across = await client(art, { x: 500, y: 380 + 190 * 0.75 });
  await page.mouse.click(across.x, across.y);
  await expect(art).not.toHaveAttribute("data-selected", selected!);
  await expectFramed(art);
  // The smallest tile of the largest patch, in its partial sixth ring,
  // still frames fully within the zoom limit (at about 72×).
  await d.getByLabel("Depth", { exact: true }).fill("8");
  await ready(d);
  await field.fill("1000");
  await expectFramed(art);
  expect(Number(await art.getAttribute("data-zoom"))).toBeGreaterThan(50);
  // A manual change during the move wins: Home, pressed in the same task as
  // the selection that starts it, is where the view stays.
  await page.evaluate(() => {
    const prev = Array.from(document.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") === "Previous tile",
    )!;
    prev.click();
    document
      .querySelector("#lace-artwork")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
      );
  });
  await page.waitForTimeout(400);
  await expect(art).toHaveAttribute("data-zoom", "1");
  await expect(art).toHaveAttribute("data-pan", "0,0");
  await expect(follow).toBeChecked();
  // Turning following off returns to the view from before it was on.
  await follow.uncheck();
  await expect(art).toHaveAttribute("data-zoom", before.zoom!);
  await expect(art).toHaveAttribute("data-pan", before.pan!);
  // Off, a selection leaves the view alone.
  await field.fill("40");
  await page.waitForTimeout(400);
  await expect(art).toHaveAttribute("data-pan", before.pan!);
});

for (const reduced of [false, true])
  test(`following moves the lace's camera ${reduced ? "at once under reduced motion" : "in a short eased transition"}`, async ({
    page,
  }) => {
    await page.emulateMedia({
      reducedMotion: reduced ? "reduce" : "no-preference",
    });
    await page.goto("/");
    const d = await openLace(page, path);
    const art = d.locator("#lace-artwork");
    await d.getByRole("checkbox", { name: "Follow selection" }).check();
    await expectFramed(art);
    await art.evaluate((svg) => {
      (window as any).zooms = [];
      new MutationObserver(() =>
        (window as any).zooms.push(svg.getAttribute("data-zoom")),
      ).observe(svg, { attributes: true, attributeFilter: ["data-zoom"] });
    });
    await d.getByLabel("Tile", { exact: true }).fill("2");
    await expectFramed(art);
    const zooms: string[] = await page.evaluate(() => (window as any).zooms);
    if (reduced) expect(zooms).toHaveLength(1);
    else {
      expect(zooms.length).toBeGreaterThan(3);
      // Monotone in zoom: eased, without overshoot.
      const z = zooms.map(Number);
      const down = z.at(-1)! < z[0];
      for (let i = 1; i < z.length; i++)
        expect(down ? z[i] <= z[i - 1] : z[i] >= z[i - 1]).toBe(true);
    }
  });

// The page keeps only the patch it shows, and Return releases it; the heap
// after garbage collection is the measure. Nothing accumulates over
// repeated sessions at the largest patch.
test("repeated sessions at the largest patch keep the retained heap bounded, and Return releases it", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  const cdp = await page.context().newCDPSession(page);
  const heap = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    return (await cdp.send("Runtime.getHeapUsage")).usedSize;
  };
  let open = 0;
  const cycle = async () => {
    const d = await openLace(page);
    await d.getByLabel("Depth", { exact: true }).fill("8");
    await expect(summary(d)).toContainText("1,000-tile limit");
    await ready(d);
    const star = d.getByLabel("Star point", { exact: true });
    await star.fill("0.5");
    await star.blur();
    await expect.poll(() => star.inputValue()).toBe("0.5");
    await ready(d);
    await d.locator("#lace-artwork").focus();
    for (let i = 0; i < 6; i++) await page.keyboard.press("+");
    open = await heap();
    await d
      .getByRole("button", { name: "Return to study", exact: true })
      .click();
    await expect(d).toBeHidden();
    await settled(page);
  };
  await cycle();
  const start = await heap();
  for (let i = 0; i < 6; i++) await cycle();
  // Under a loaded full run the last patch can still be held for a moment
  // after Return; a later collection settles near 1.7 MB. Accumulation over
  // six sessions would never fall below the bound, so poll it.
  let end = 0;
  await expect
    .poll(async () => (end = await heap()) - start, {
      intervals: [100, 200, 500],
      timeout: 5_000,
    })
    .toBeLessThan(4_000_000);
  console.log("Lace retained heap (bytes, Chromium):", { start, open, end });
  // Open, the largest patch and its drawing are held; after Return they
  // are not.
  expect(open - end).toBeGreaterThan(1_000_000);
});

test("lace production measurements stay within one computation and its limits", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Native = Worker;
    const w = window as any;
    w.laceRows = [];
    w.lacePeak = 0;
    w.laceTerminated = [];
    let running = 0;
    window.Worker = class extends Native {
      sent = new Map<number, { time: number; q: any }>();
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        this.addEventListener("message", (e) => {
          const sent = this.sent.get(e.data.id);
          if (!sent) return;
          this.sent.delete(e.data.id);
          running--;
          const r = e.data.result;
          if (!r?.tiling) return;
          const received = performance.now();
          // The client restores the lifted arrays in place after this
          // listener runs.
          setTimeout(() =>
            w.laceRows.push({
              depth: sent.q.depth,
              tiles: r.center.length,
              processed: r.processed,
              typedEntries: e.data.lifted?.floats.length,
              prepare: e.data.timings.prepare,
              bytes: e.data.timings.bytes,
              roundTrip: received - sent.time,
              received,
            }),
          );
        });
      }
      postMessage(message: any, ...rest: any[]) {
        if (message.action === "lace") {
          this.sent.set(message.id, {
            time: performance.now(),
            q: message.lace,
          });
          running++;
          w.lacePeak = Math.max(w.lacePeak, running);
        }
        return super.postMessage(message, ...rest);
      }
      terminate() {
        if (this.sent.size) running -= this.sent.size;
        w.laceTerminated.push(performance.now());
        return super.terminate();
      }
    } as typeof Worker;
    new MutationObserver(() => {
      const rows = w.laceRows;
      const art = document.querySelector("#lace-artwork");
      if (!rows.length || art?.getAttribute("aria-busy") !== "false") return;
      const row = rows.at(-1);
      if (row.commit !== undefined) return;
      row.commit = performance.now() - row.received;
      requestAnimationFrame(() =>
        requestAnimationFrame(
          () => (row.paint = performance.now() - row.received),
        ),
      );
    }).observe(document, {
      subtree: true,
      attributes: true,
      childList: true,
      attributeFilter: ["aria-busy"],
    });
  });
  await page.goto("/");
  await settled(page);
  const d = await openLace(page);
  const art = d.locator("#lace-artwork");
  await d.getByLabel("Depth", { exact: true }).fill("8");
  await expect(summary(d)).toContainText("Stopped at the 1,000-tile limit");
  await ready(d);
  // Selecting at the largest patch: click to the selection drawn.
  await d.getByLabel("Tile", { exact: true }).fill("41");
  const middle = await selectedCenter(art);
  await d.getByRole("button", { name: "Clear selection", exact: true }).click();
  const at = await client(art, middle);
  const selection = await art.evaluate(async (svg, at) => {
    const start = performance.now();
    const event = { clientX: at.x, clientY: at.y, bubbles: true };
    svg.dispatchEvent(
      new PointerEvent("pointerdown", { ...event, button: 0, pointerId: 7 }),
    );
    svg.dispatchEvent(
      new PointerEvent("pointerup", { ...event, pointerId: 7 }),
    );
    await new Promise<void>((done) => {
      const check = () =>
        svg.getAttribute("data-selected") === "40"
          ? done()
          : requestAnimationFrame(check);
      check();
    });
    return performance.now() - start;
  }, at);
  // A pan across the largest patch, as ten pointer moves.
  const pan = await art.evaluate(async (svg) => {
    const start = performance.now();
    const at = (x: number) => ({
      clientX: 300 + x,
      clientY: 300,
      bubbles: true,
      pointerId: 9,
    });
    svg.dispatchEvent(new PointerEvent("pointerdown", { ...at(0), button: 0 }));
    for (let i = 1; i <= 10; i++) {
      svg.dispatchEvent(new PointerEvent("pointermove", at(i * 5)));
      await new Promise((done) => requestAnimationFrame(done));
    }
    svg.dispatchEvent(new PointerEvent("pointerup", at(50)));
    return (performance.now() - start) / 10;
  });
  // A zoom step at the largest patch redraws every arc at the new scale.
  const zoom = await art.evaluate(async (svg) => {
    const start = performance.now();
    svg.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -200,
        clientX: 400,
        clientY: 300,
        bubbles: true,
        cancelable: true,
      }),
    );
    await new Promise((done) => requestAnimationFrame(done));
    await new Promise((done) => requestAnimationFrame(done));
    return performance.now() - start;
  });
  const nodes = await art.evaluate((svg) => svg.querySelectorAll("*").length);
  // Return while the largest patch is being generated again.
  await d.getByLabel("Star point", { exact: true }).fill("0.4");
  await page.waitForTimeout(130);
  const returned = await page.evaluate(() => performance.now());
  await d.getByRole("button", { name: "Return to study", exact: true }).click();
  await expect(d).toBeHidden();
  const metrics = await page.evaluate(() => ({
    rows: (window as any).laceRows,
    peak: (window as any).lacePeak,
    terminated: (window as any).laceTerminated,
  }));
  const ended = metrics.terminated.filter((t: number) => t >= returned);
  expect(ended.length).toBeGreaterThanOrEqual(2);
  expect(metrics.peak).toBe(1);
  expect(metrics.rows.length).toBeGreaterThanOrEqual(2);
  for (const r of metrics.rows) {
    expect(r.tiles).toBeLessThanOrEqual(1000);
    expect(r.processed).toBeLessThanOrEqual(10000);
    expect(r.typedEntries).toBeGreaterThan(0);
  }
  // The drawing stays a few dozen elements however many tiles it holds:
  // arcs are grouped into paths by role and taper level.
  expect(nodes).toBeLessThan(100);
  console.log(
    "Lace production measurements (milliseconds, bytes; Chromium on local Mac):",
    JSON.stringify({
      rows: metrics.rows.map(({ received: _, ...r }: any) => r),
      selection,
      panMove: pan,
      zoomStep: zoom,
      nodes,
      cancel: Math.max(...ended) - returned,
    }),
  );
});
