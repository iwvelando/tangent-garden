import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { choosePreset, exportImage, openAnimation } from "./helpers";
import { distanceToStar, rho, tip } from "./star";

// Refinement to the view in the 2D notebook: zoomed in, a study refined to
// its view is refined to what the drawing shows (engine/adaptive.go,
// View.focus), its zoom reaches 1000×, and playback held at the current
// view and the exported image draw the same curve.

const star = "Inside a star's point";
const W = 1000,
  H = 760;

const art = (page: Page) => page.locator("#artwork");
const ready = (page: Page) =>
  expect(page.locator(".plot-wrap")).toHaveAttribute("aria-busy", "false", {
    timeout: 20_000,
  });
const readout = (page: Page) => page.locator(".refinement-readout");
const toView = (page: Page) =>
  page.getByRole("checkbox", { name: "Refine to the view as you zoom" });
// The innermost of the star's offsets, 0.0003 inside it.
const innermost = (page: Page) =>
  art(page).locator('[data-testid="offset-family"] path').first();

async function camera(page: Page) {
  const svg = art(page);
  const scale = Number(await svg.getAttribute("data-camera-scale"));
  const [cx, cy] = (await svg.getAttribute("data-camera-center"))!
    .split(",")
    .map(Number);
  return { scale, cx, cy };
}

// The page point (in viewBox units) of a world point, and back.
const page = (
  c: { scale: number; cx: number; cy: number },
  x: number,
  y: number,
) => ({
  x: W / 2 + (x - c.cx) * c.scale,
  y: H / 2 - (y - c.cy) * c.scale,
});
const world = (
  c: { scale: number; cx: number; cy: number },
  u: number,
  v: number,
) => ({
  x: c.cx + (u - W / 2) / c.scale,
  y: c.cy - (v - H / 2) / c.scale,
});

// Turns the wheel over a world point, a step at a time, keeping the pointer
// on it.
async function zoomAt(p: Page, x: number, y: number, steps: number) {
  const svg = art(p);
  for (let k = 0; k < steps; k++) {
    const box = (await svg.boundingBox())!;
    const ratio = Math.max(W / box.width, H / box.height);
    const at = page(await camera(p), x, y);
    await p.mouse.move(
      box.x + box.width / 2 + (at.x - W / 2) / ratio,
      box.y + box.height / 2 + (at.y - H / 2) / ratio,
    );
    await p.mouse.wheel(0, -500);
  }
}

// The vertices of a path's d attribute.
const vertices = (d: string) =>
  [...d.matchAll(/[ML]([-\d.]+),([-\d.]+)/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
  }));

test("zoomed into a study refined to its view, its curves follow the curve to the view's own scale", async ({
  page: p,
}) => {
  await p.goto("/");
  await choosePreset(p, { label: star });
  await ready(p);
  await expect(toView(p)).toBeChecked();
  const fit = await camera(p);
  await zoomAt(p, tip.x, tip.y, 14);
  // The drawing stays busy until the view is refined, so whatever is
  // drawn once it is ready is already refined to the view.
  await ready(p);
  const atReady = await innermost(p).getAttribute("d");
  const zoomed = await camera(p);
  // Deeper than the 20× a study not refined to its view allows.
  expect(zoomed.scale / fit.scale).toBeGreaterThan(500);
  expect(zoomed.scale / fit.scale).toBeLessThanOrEqual(1000 + 1e-9);
  await expect(readout(p)).toContainText("finer in view");
  expect(await innermost(p).getAttribute("d")).toBe(atReady);
  // The innermost offset, 0.0003 inside the star, rounds its point in an
  // arc of radius ρ − 0.0003 > 0, where no other part of the star is
  // nearer. Every drawn chord's midpoint in view lies 0.0003 from the
  // star to within its sagitta, at most the view's tolerance, 2 × 10⁻⁴ of
  // its half diagonal; the study's own tolerance is hundreds of times as
  // coarse.
  expect(rho).toBeGreaterThan(0.0003);
  const tolerance = (2e-4 * Math.hypot(W, H)) / 2 / zoomed.scale;
  const points = vertices((await innermost(p).getAttribute("d"))!);
  let measured = 0,
    worst = 0;
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1],
      b = points[k];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (mid.x < 0 || mid.x > W || mid.y < 0 || mid.y > H) continue;
    // Chords no longer than a quarter of the view's half diagonal.
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThanOrEqual(
      Math.hypot(W, H) / 8 + 1e-3,
    );
    const at = world(zoomed, mid.x, mid.y);
    worst = Math.max(worst, Math.abs(distanceToStar(at) - 0.0003));
    measured++;
  }
  expect(measured).toBeGreaterThan(20);
  expect(worst).toBeLessThanOrEqual(1.5 * tolerance);

  // The exported image draws the same curve.
  const download = p.waitForEvent("download");
  await exportImage(p, "SVG");
  const svg = (await readFile((await (await download).path())!)).toString();
  expect(svg).toContain(`d="${await innermost(p).getAttribute("d")}"`);
});

test("turning refinement to the view off zooms out to 20× about the middle and refines to the study alone", async ({
  page: p,
}) => {
  await p.goto("/");
  await choosePreset(p, { label: star });
  await ready(p);
  const fit = await camera(p);
  await zoomAt(p, tip.x, tip.y, 10);
  await ready(p);
  const deep = await camera(p);
  expect(deep.scale / fit.scale).toBeGreaterThan(100);
  await toView(p).uncheck();
  await ready(p);
  const plain = await camera(p);
  expect(plain.scale / fit.scale).toBeCloseTo(20, 9);
  expect(plain.cx).toBeCloseTo(deep.cx, 9);
  expect(plain.cy).toBeCloseTo(deep.cy, 9);
  await expect(readout(p)).not.toContainText("finer in view");
  // The wheel stops at 20× too.
  await zoomAt(p, tip.x, tip.y, 3);
  await ready(p);
  expect((await camera(p)).scale / fit.scale).toBeCloseTo(20, 9);
  // Turned on again, the deeper zoom returns.
  await toView(p).check();
  await zoomAt(p, tip.x, tip.y, 3);
  await ready(p);
  expect((await camera(p)).scale / fit.scale).toBeGreaterThan(20);
  await expect(readout(p)).toContainText("finer in view");
});

test("a study not refined to its view zooms to 20×, about the pointer", async ({
  page: p,
}) => {
  await p.goto("/");
  await ready(p);
  await expect(toView(p)).toHaveCount(0);
  const fit = await camera(p);
  // A point of the plane off the middle stays under the pointer.
  const target = { x: 1.2, y: -0.7 };
  const before = page(fit, target.x, target.y);
  await zoomAt(p, target.x, target.y, 1);
  const once = await camera(p);
  expect(once.scale).toBeGreaterThan(fit.scale);
  const after = page(once, target.x, target.y);
  // The pointer lands on a whole client pixel, at most about 0.7 page
  // units from the point.
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(1);
  await zoomAt(p, target.x, target.y, 12);
  expect((await camera(p)).scale / fit.scale).toBeCloseTo(20, 9);
});

test("playback held at the current view refines every frame to it", async ({
  page: p,
}) => {
  await p.goto("/");
  await choosePreset(p, { label: star });
  await ready(p);
  await zoomAt(p, tip.x, tip.y, 12);
  await ready(p);
  const drawn = await innermost(p).getAttribute("d");
  // A track whose ends are the study's own, so each frame calculated
  // afresh is the study again.
  await openAnimation(p);
  await p
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("parameters");
  await p.getByRole("combobox", { name: "Repeat" }).selectOption("once");
  await p
    .getByRole("combobox", { name: "Parameter 1", exact: true })
    .selectOption("stackFrom");
  await p.getByRole("textbox", { name: "Track 1 from" }).fill("0.0003");
  await p.getByRole("textbox", { name: "Track 1 to" }).fill("0.0003");
  await p
    .getByRole("combobox", { name: "Animation camera" })
    .selectOption("current");
  await p.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("3");
  await ready(p);
  const scale = await art(p).getAttribute("data-camera-scale");
  await p.getByRole("button", { name: "Play animation" }).click();
  // A frame between the ends, calculated as it plays.
  const progress = async () =>
    Number(await art(p).getAttribute("data-animation-progress"));
  await expect.poll(progress).toBeGreaterThan(0.05);
  await p.getByRole("button", { name: "Pause", exact: true }).click();
  expect(await progress()).toBeLessThan(1);
  await expect(art(p)).toHaveAttribute("data-camera-scale", scale!);
  await expect(innermost(p)).toHaveAttribute("d", drawn!);
  await p.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    p.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(art(p)).toHaveAttribute("data-camera-scale", scale!);
  await expect(innermost(p)).toHaveAttribute("d", drawn!);
});
