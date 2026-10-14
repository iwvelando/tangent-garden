import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { choosePreset } from "./helpers";
import { camera, project, refinementView } from "../web/spatial/scene";
import type { View } from "../web/spatial/renderer";
import type { Vec3 } from "../web/spatial/types";

// A camera flight in a study refined to its view: key views zoom past 8×,
// and every frame is drawn refined to what it shows (engine3.View), in
// playback and export alike, through the real notebook, worker and engine.

const wheels = { label: "Wheels within wheels" };
const stage = (page: Page) => page.locator(".spatial-stage");
const canvas = (page: Page) => page.locator("#spatial-artwork");
const settled = (page: Page) =>
  expect(stage(page)).toHaveAttribute("aria-busy", "false", {
    timeout: 20_000,
  });
async function section(page: Page, selector: string) {
  const details = page.locator(selector);
  if ((await details.getAttribute("open")) === null)
    await details.locator(":scope > summary").click();
}
async function open(page: Page) {
  await page.goto("/?study=3d");
  await settled(page);
  await choosePreset(page, wheels);
  await settled(page);
  await section(page, "#spatial-animation-section");
}
async function shown(page: Page): Promise<View> {
  return JSON.parse((await canvas(page).getAttribute("data-view"))!);
}
async function seek(page: Page, p: string) {
  await page.getByRole("slider", { name: "Animation progress" }).fill(p);
  await expect(stage(page)).toHaveAttribute("data-progress", p, {
    timeout: 20_000,
  });
}

// The preset's curve: four circles, turning 1, 6, 36 and 216 times, each a
// third the radius of the last.
const terms: [number, number[], number[]][] = [
  [1, [3, 0, 0], [0, 3, 0]],
  [6, [0, 0, 1], [1, 0, 0]],
  [36, [0, 1 / 3, 0], [0, 0, 1 / 3]],
  [216, [1 / 9, 0, 0], [0, 1 / 9, 0]],
];
const curve = (t: number): Vec3 => {
  const p = [0, 0, 0];
  for (const [f, a, b] of terms)
    for (let i = 0; i < 3; i++)
      p[i] += a[i] * Math.cos(f * t) + b[i] * Math.sin(f * t);
  return { x: p[0], y: p[1], z: p[2] };
};

// Where the base curve's strokes start and end in an exported line
// drawing.
function ends(svg: string) {
  const group = svg.match(/<g id="base"[^>]*>(.*?)<\/g>/s)![1];
  return [...group.matchAll(/ d="([^"]*)"/g)].flatMap((d) => {
    const points = [...d[1].matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [
      Number(m[1]),
      Number(m[2]),
    ]);
    return [points[0], points[points.length - 1]];
  });
}

// The base curve's chords in an exported line drawing.
function chords(svg: string) {
  const group = svg.match(/<g id="base"[^>]*>(.*?)<\/g>/s)![1];
  const out: [number, number, number, number][] = [];
  for (const d of group.matchAll(/ d="([^"]*)"/g)) {
    let last: [number, number] | null = null;
    for (const m of d[1].matchAll(/([ML])(-?[\d.]+) (-?[\d.]+)/g)) {
      const p: [number, number] = [Number(m[2]), Number(m[3])];
      if (m[1] === "L" && last) out.push([...last, ...p]);
      last = p;
    }
  }
  return out;
}

// How far, in view tolerances, the drawn frame's chords stray from the
// curve, and how many lie on the page: the frame exported as lines, its
// chords' midpoints measured against the curve sampled finely where it
// crosses the page (a few hundredths of a pixel apart).
async function stray(page: Page) {
  const view = await shown(page);
  const size = await canvas(page).evaluate((c: HTMLCanvasElement) => ({
    width: c.clientWidth,
    height: c.clientHeight,
  }));
  const focus = refinementView(view, size);
  await page.getByRole("button", { name: "Export image", exact: true }).click();
  const event = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Lines (SVG) · every line", exact: true })
    .click();
  const svg = (await readFile((await (await event).path())!)).toString();
  const width = Number(svg.match(/ width="(\d+)"/)![1]),
    height = Number(svg.match(/ height="(\d+)"/)![1]);
  const k = camera(view, { width, height });
  const scale = (k.framing[0] * width) / 2;
  const tolerance = 2e-4 * Math.hypot(focus.width, focus.height) * scale;
  // Where the curve comes near the page, sampled coarsely, then finely.
  const near = (p: { x: number; y: number }) =>
    p.x > -width && p.x < 2 * width && p.y > -height && p.y < 2 * height;
  const cells = new Map<string, [number, number][]>();
  const coarse = 1e-4,
    fine = 2e-4 / Math.max(1, scale);
  for (let t = 0; t < 2 * Math.PI; t += coarse) {
    if (!near(project(k, curve(t))) && !near(project(k, curve(t + coarse))))
      continue;
    for (let u = t; u < t + coarse; u += fine) {
      const p = project(k, curve(u));
      const key = `${Math.floor(p.x)},${Math.floor(p.y)}`;
      let cell = cells.get(key);
      if (!cell) cells.set(key, (cell = []));
      cell.push([p.x, p.y]);
    }
  }
  const distance = (x: number, y: number) => {
    let best = Infinity;
    for (let i = -2; i <= 2; i++)
      for (let j = -2; j <= 2; j++)
        for (const [u, v] of cells.get(
          `${Math.floor(x) + i},${Math.floor(y) + j}`,
        ) ?? [])
          best = Math.min(best, Math.hypot(u - x, v - y));
    return best;
  };
  let measured = 0,
    worst = 0;
  for (const [ax, ay, bx, by] of chords(svg)) {
    const mx = (ax + bx) / 2,
      my = (ay + by) / 2;
    if (mx < 0 || mx > width || my < 0 || my > height) continue;
    // The export rounds to 0.01 pixels.
    worst = Math.max(worst, (distance(mx, my) - 0.02) / tolerance);
    measured++;
  }
  expect(tolerance).toBeLessThan(0.5);
  // The curve is smooth and closed, so it runs unbroken across the page:
  // its strokes start and end only at the page's edges.
  const inside = ends(svg).filter(
    ([x, y]) => x > 1 && x < width - 1 && y > 1 && y < height - 1,
  );
  return { view, worst, measured, inside };
}

test("a flight past 8× draws each frame refined to what it shows", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await open(page);
  await page.getByLabel("Duration (seconds)").fill("3");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  // Frames between views, deep in the flight, and its last, 79 times
  // closer than the whole.
  for (const [p, zoom] of [
    ["0.76", 20],
    ["0.82", 28],
    ["1", 79],
  ] as const) {
    await seek(page, p);
    const { view, worst, measured, inside } = await stray(page);
    expect(view.zoom).toBeGreaterThan(zoom);
    expect(measured).toBeGreaterThan(40);
    expect(worst).toBeLessThanOrEqual(1.5);
    expect(inside).toEqual([]);
  }
});

// Flown as the animation camera: a reveal cuts its frames from the same
// pieces, and parameter frames are each refined to their own view.
for (const [name, setup] of [
  [
    "a reveal",
    async (page: Page) => {
      await page.getByLabel("Animate", { exact: true }).selectOption("reveal");
    },
  ],
  [
    "parameters",
    async (page: Page) => {
      // A track whose ends are the study's own, so each frame calculated
      // afresh is the study again.
      await page
        .getByLabel("Animate", { exact: true })
        .selectOption("parameters");
      await page.getByLabel("Parameter 1", { exact: true }).selectOption("c0x");
      await page.getByLabel("Track 1 from").fill("0");
      await page.getByLabel("Track 1 to").fill("0");
    },
  ],
] as const)
  test(`flown over ${name}, each frame past 8× is refined to what it shows`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await open(page);
    await setup(page);
    await page
      .getByLabel("Animation camera", { exact: true })
      .selectOption("path");
    await page.getByLabel("Duration (seconds)").fill("3");
    await settled(page);
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    for (const p of ["0.82", "1"]) {
      await seek(page, p);
      const { view, worst, measured, inside } = await stray(page);
      expect(view.zoom).toBeGreaterThan(28);
      expect(inside).toEqual([]);
      expect(measured).toBeGreaterThan(40);
      expect(worst).toBeLessThanOrEqual(1.5);
    }
  });

test("without refinement to the view, a flight stops at 8×", async ({
  page,
}) => {
  await open(page);
  await section(
    page,
    'details:has(> summary:text-is("Sampling & definition"))',
  );
  await page
    .getByRole("checkbox", { name: "Refine to the view as you zoom" })
    .uncheck();
  await settled(page);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(page.locator("#spatial-animation-section")).toContainText(
    "View 3 zooms past 8×; refine the study to its view to zoom further.",
  );
});
