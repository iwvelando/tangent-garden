import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { choosePreset } from "./helpers";
import { camera, project, refinementView } from "../web/spatial/scene";
import type { View } from "../web/spatial/renderer";
import type { Vec3 } from "../web/spatial/types";

// Refinement to the view in the 3D notebook: zoomed in, a study refined to
// its view is refined to what the drawing shows (engine3/view.go), its zoom
// reaches 1000×, and playback held at the current view draws the same
// curve.

const spring = { label: "A spring folded into a cusp" };
const stage = (page: Page) => page.locator(".spatial-stage");
const canvas = (page: Page) => page.locator("#spatial-artwork");
const settled = (page: Page) =>
  expect(stage(page)).toHaveAttribute("aria-busy", "false", {
    timeout: 20_000,
  });
const readout = (page: Page) => page.locator(".refinement-readout");
const toView = (page: Page) =>
  page.getByRole("checkbox", { name: "Refine to the view as you zoom" });
async function section(page: Page, selector: string) {
  const details = page.locator(selector);
  if ((await details.getAttribute("open")) === null)
    await details.locator(":scope > summary").click();
}
// The preset, with its sampling section open.
async function open(page: Page) {
  await page.goto("/?study=3d");
  await settled(page);
  await choosePreset(page, spring);
  await settled(page);
  await section(
    page,
    'details:has(> summary:text-is("Sampling & definition"))',
  );
}
async function shown(page: Page): Promise<View> {
  return JSON.parse((await canvas(page).getAttribute("data-view"))!);
}
async function size(page: Page) {
  return canvas(page).evaluate((c: HTMLCanvasElement) => ({
    width: c.clientWidth,
    height: c.clientHeight,
  }));
}
async function pixels(page: Page) {
  return canvas(page).evaluate((c: HTMLCanvasElement) => c.toDataURL());
}

// The preset's curve: a cardioid lifted by 0.5 cos 2t, wound with a coil
// of radius 0.01 turning 100 times.
const curve = (t: number): Vec3 => ({
  x: 3 * Math.cos(t) - 1.5 * Math.cos(2 * t),
  y: 3 * Math.sin(t) - 1.5 * Math.sin(2 * t) + 0.01 * Math.cos(100 * t),
  z: 0.5 * Math.cos(2 * t) + 0.01 * Math.sin(100 * t),
});

// The base curve's chords in an exported line drawing.
function chords(svg: string) {
  const group = svg.match(/<g id="base"[^>]*>(.*?)<\/g>/)![1];
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

test("zoomed into a study refined to its view, its chords follow the curve to the view's own scale", async ({
  page,
}) => {
  await open(page);
  await expect(toView(page)).toBeChecked();
  await expect(readout(page)).toContainText("finer in view");
  const view = await shown(page);
  // Deeper than the 8× a study not refined to its view allows.
  expect(view.zoom).toBe(70);
  // The view as Go refined it, on the page as drawn.
  const focus = refinementView(view, await size(page));
  await page.getByRole("button", { name: "Export image", exact: true }).click();
  const event = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Lines (SVG) · every line", exact: true })
    .click();
  const svg = (await readFile((await (await event).path())!)).toString();
  const width = Number(svg.match(/ width="(\d+)"/)![1]),
    height = Number(svg.match(/ height="(\d+)"/)![1]);
  const k = camera(view, { width, height });
  // Page pixels a unit of length spans, and the view's tolerance and
  // chord limit there: 2 × 10⁻⁴ and a quarter of its half diagonal.
  const scale = (k.framing[0] * width) / 2;
  const diagonal = Math.hypot(focus.width, focus.height);
  const tolerance = 2e-4 * diagonal * scale,
    limit = (diagonal / 4) * scale;
  // The curve within a unit of t of its cusp, finely enough that its
  // points lie a few hundredths of a pixel apart, hashed by pixel.
  const cells = new Map<string, [number, number][]>();
  for (let t = -1; t <= 1; t += 2e-6) {
    const p = project(k, curve(t));
    const key = `${Math.floor(p.x)},${Math.floor(p.y)}`;
    let cell = cells.get(key);
    if (!cell) cells.set(key, (cell = []));
    cell.push([p.x, p.y]);
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
  // Each chord's midpoint lies within its sagitta of the curve, at most
  // the view's tolerance (and the export's rounding to 0.01 pixels).
  let measured = 0,
    worst = 0;
  for (const [ax, ay, bx, by] of chords(svg)) {
    const mx = (ax + bx) / 2,
      my = (ay + by) / 2;
    if (mx < 0 || mx > width || my < 0 || my > height) continue;
    expect(Math.hypot(bx - ax, by - ay)).toBeLessThanOrEqual(limit + 0.02);
    worst = Math.max(worst, distance(mx, my));
    measured++;
  }
  expect(tolerance).toBeLessThan(0.5);
  expect(worst).toBeLessThanOrEqual(1.5 * tolerance + 0.02);
  expect(measured).toBeGreaterThan(400);
});

test("turning refinement to the view off zooms out to 8× and refines to the study alone", async ({
  page,
}) => {
  await open(page);
  const deep = await shown(page);
  await toView(page).uncheck();
  await settled(page);
  const plain = await shown(page);
  expect(plain.zoom).toBe(8);
  // About the middle of the drawing: the pan is kept.
  expect([plain.panX, plain.panY]).toEqual([deep.panX, deep.panY]);
  await expect(readout(page)).not.toContainText("finer in view");
  // The keys stop at 8× too.
  await canvas(page).focus();
  for (let k = 0; k < 3; k++) await page.keyboard.press("+");
  await settled(page);
  expect((await shown(page)).zoom).toBe(8);
  // Turned on again, the deeper zoom returns, and stops at 1000×.
  await toView(page).check();
  await canvas(page).focus();
  for (let k = 0; k < 3; k++) await page.keyboard.press("+");
  await settled(page);
  expect((await shown(page)).zoom).toBeCloseTo(8 * 1.1 ** 3, 9);
  await expect(readout(page)).toContainText("finer in view");
  for (let k = 0; k < 60; k++) await page.keyboard.press("+");
  await settled(page);
  expect((await shown(page)).zoom).toBe(1000);
});

test("the wheel zooms about the pointer, which stays on the same point", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await settled(page);
  const box = (await canvas(page).boundingBox())!;
  // A pointer off the middle, and the point of the plane through the
  // middle of the drawing beneath it.
  const u = box.width * 0.2,
    v = -box.height * 0.15;
  await page.mouse.move(box.x + box.width / 2 + u, box.y + box.height / 2 + v);
  const before = await shown(page);
  const page0 = await size(page);
  const f = refinementView(before, page0);
  const half = { x: page0.width / 2, y: page0.height / 2 };
  const q = (u / half.x) * f.width,
    r = (-v / half.y) * f.height;
  const point = {
    x: f.center.x + q * f.right.x + r * f.up.x,
    y: f.center.y + q * f.right.y + r * f.up.y,
    z: f.center.z + q * f.right.z + r * f.up.z,
  };
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => (await shown(page)).zoom).toBeGreaterThan(1);
  const after = await shown(page);
  const at = project(camera(after, page0), point);
  // The pointer stands on a whole client pixel.
  expect(Math.hypot(at.x - (half.x + u), at.y - (half.y + v))).toBeLessThan(1);
});

test("playback held at the current view refines every frame to it", async ({
  page,
}) => {
  await open(page);
  const still = await pixels(page);
  // A track whose ends are the study's own, so each frame calculated
  // afresh is the study again.
  await section(page, "#spatial-animation-section");
  await page.getByLabel("Animate", { exact: true }).selectOption("parameters");
  await page.getByLabel("Parameter 1", { exact: true }).selectOption("c0x");
  await page.getByLabel("Track 1 from").fill("0");
  await page.getByLabel("Track 1 to").fill("0");
  await page
    .getByLabel("Animation camera", { exact: true })
    .selectOption("current");
  // Test a single traversal with timeline time equal to motion progress,
  // independently of the preset's approach flight.
  await page.getByLabel("Repeat", { exact: true }).selectOption("once");
  await page.getByLabel("Pace", { exact: true }).selectOption("steady");
  await page.getByLabel("Duration (seconds)").fill("3");
  await settled(page);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Animation progress" });
  // A frame between the ends, calculated afresh.
  await slider.fill("0.5");
  await expect(stage(page)).toHaveAttribute("data-progress", "0.5");
  await expect.poll(() => pixels(page)).toBe(still);
  await slider.fill("1");
  await expect(stage(page)).toHaveAttribute("data-progress", "1");
  await expect.poll(() => pixels(page)).toBe(still);
});

test("a study refined to its view stays busy until it is refined to the view it opens at", async ({
  page,
}) => {
  // A slow engine, as on a loaded runner: each request reaches the worker
  // 300 ms late, so a preset's first frame returns after its camera has
  // rested, refined to the view as the previous study's bounds framed it.
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (
      this: Worker,
      ...args: Parameters<Worker["postMessage"]>
    ) {
      setTimeout(() => post.apply(this, args), 300);
    } as Worker["postMessage"];
  });
  await page.goto("/?study=3d");
  await settled(page);
  // aria-busy as each task leaves it, so a value React sets and replaces
  // before the page can run anything else is not counted.
  await stage(page).evaluate((element) => {
    const seen: string[] = [];
    (window as unknown as { busy: string[] }).busy = seen;
    new MutationObserver(() =>
      seen.push(element.getAttribute("aria-busy")!),
    ).observe(element, { attributes: true, attributeFilter: ["aria-busy"] });
  });
  await choosePreset(page, spring);
  await settled(page);
  await expect(readout(page)).toContainText("finer in view");
  // Past another rest of the camera and another delayed calculation.
  await page.waitForTimeout(1500);
  await settled(page);
  const seen = await page.evaluate(
    () => (window as unknown as { busy: string[] }).busy,
  );
  // Busy, then idle once: never idle with the drawing still to be refined
  // to the view it shows.
  expect(seen).toContain("false");
  expect(seen.slice(seen.indexOf("false"))).not.toContain("true");
});
