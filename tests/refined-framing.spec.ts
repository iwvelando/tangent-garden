import { test, expect, type Page } from "@playwright/test";
import { choosePreset } from "./helpers";
import { fitFrame, framingPoints } from "../web/Plot";
import { reveal } from "../web/animation";
import { presets } from "../web/presets";
import type { RefinedPath } from "../web/refinement";
import type { Config, Result, Vec } from "../web/types";

// Framing by the points between samples in the 2D notebook: with
// adaptiveFrame, Go reports each refined curve's reach (engine/adaptive.go),
// and the drawing's framing takes it in within each family's fence.

const urchin = "A sea urchin turned inside out";
const W = 1000,
  H = 760;

const p = (x: number, y: number): Vec => ({ x, y });
// A refined path with nothing between samples but its reach.
const reached = (reach: Vec[], reachAt: number[]): RefinedPath<Vec> => ({
  points: [],
  at: [],
  tolerance: 1e-4,
  inserted: 0,
  breaks: 0,
  unresolved: 0,
  exhausted: false,
  reach,
  reachAt,
});
// 101 samples along y = 0 from x = 0 to 1.
const line = Array.from({ length: 101 }, (_, i) => p(i / 100, 0));
const result = (adaptive: Result["adaptive"]): Result => ({
  base: line,
  derived: line.map((q) => p(q.x, q.y - 1)),
  virtual: line.map(() => false),
  rays: [],
  family: [{ distance: 0.5, points: line.map((q) => p(q.x, q.y + 1)) }],
  circles: [],
  rolling: [],
  warnings: [],
  invalid: 0,
  input: line.map((q) => p(q.x, q.y + 2)),
  adaptive,
});
const config = (adaptiveFrame?: boolean): Config => ({
  ...structuredClone(presets[0].config),
  adaptive: true,
  ...(adaptiveFrame !== undefined && { adaptiveFrame }),
});

test("framing takes in each refined curve's reach only when asked", () => {
  const plain = fitFrame(result(undefined), config());
  // Reach above the input, the highest family, and below the derived
  // curve, the lowest: each widens the framing by 0.2.
  const adaptive = {
    input: reached([p(0.505, 2.2)], [50.5]),
    derived: reached([p(0.305, -1.2)], [30.5]),
  };
  expect(fitFrame(result(adaptive), config())).toEqual(plain);
  expect(fitFrame(result(adaptive), config(false))).toEqual(plain);
  const framed = fitFrame(result(adaptive), config(true));
  expect(framed.cy).toBeCloseTo(0.5, 12);
  expect(framed.span).toBeCloseTo(3.4, 12);
  expect(framed.cx).toBe(plain.cx);
  // The base's reach and a family member's, paired by index, widen it
  // sideways.
  const sideways = fitFrame(
    result({
      base: reached([p(-0.3, 0)], [0.5]),
      family: [reached([p(1.4, 1)], [99.5])],
    }),
    config(true),
  );
  expect(sideways.cx).toBeCloseTo(0.55, 12);
  expect(sideways.cy).toBe(plain.cy);
});

test("a reach beyond its family's fence stays out of the framing, as an outlying sample does", () => {
  const plain = fitFrame(result(undefined), config());
  // The base's samples span x from 0 to 1, so its fence runs from −1.25
  // to 2.25.
  const far = fitFrame(
    result({ base: reached([p(4, 0)], [3.5]) }),
    config(true),
  );
  expect(far).toEqual(plain);
  const near = fitFrame(
    result({ base: reached([p(4, 0), p(2, 0)], [3.5, 50.5]) }),
    config(true),
  );
  expect(near.cx).toBeCloseTo(1, 12);
  // A family of fewer than eight samples has no fence, so its whole finite
  // reach frames it.
  const few = [p(0, 0), p(1, 0), p(2, 0)];
  expect(framingPoints(few, [p(9, 9), p(Infinity, 0)])).toEqual([
    ...few,
    p(9, 9),
  ]);
});

test("a reveal frames only the reach it has reached", () => {
  // Both inside the fence of the revealed half, x from −0.625 to 1.125.
  const full = result({
    base: reached([p(-0.3, 0), p(1.1, 0)], [10.5, 90.5]),
  });
  const half = reveal(full, 0.5);
  expect(half.adaptive!.base!.reach).toEqual([p(-0.3, 0)]);
  expect(half.adaptive!.base!.reachAt).toEqual([10.5]);
  expect(fitFrame(half, config(true)).cx).toBeCloseTo(0.1, 12);
  expect(reveal(full, 1).adaptive).toEqual(full.adaptive);
  expect(fitFrame(full, config(true)).cx).toBeCloseTo(0.4, 12);
});

const art = (page: Page) => page.locator("#artwork");
const ready = (page: Page) =>
  expect(page.locator(".plot-wrap")).toHaveAttribute("aria-busy", "false", {
    timeout: 20_000,
  });
const frameCheck = (page: Page) =>
  page.getByRole("checkbox", { name: "Frame the points between samples" });
const vertices = (d: string | null) =>
  [...(d ?? "").matchAll(/[ML]([-\d.]+),([-\d.]+)/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
  }));
const baseVertices = async (page: Page) =>
  vertices(await art(page).getByTestId("base-curve").getAttribute("d"));
const onPage = (v: Vec) => v.x >= 0 && v.x <= W && v.y >= 0 && v.y <= H;
async function camera(page: Page) {
  const svg = art(page);
  const scale = Number(await svg.getAttribute("data-camera-scale"));
  const [cx, cy] = (await svg.getAttribute("data-camera-center"))!
    .split(",")
    .map(Number);
  return { scale, cx, cy };
}

test("the urchin's spines, found between samples, are framed whole, and only with the setting", async ({
  page,
}) => {
  await page.goto("/");
  await choosePreset(page, { label: urchin });
  await ready(page);
  await expect(frameCheck(page)).toBeChecked();
  const framed = await art(page).evaluate((svg) => svg.outerHTML);
  const drawn = await baseVertices(page);
  expect(drawn.length).toBeGreaterThan(1000);
  expect(drawn.every(onPage)).toBe(true);
  // The spines reach 1.8 from the center, and the framing takes them in:
  // the widest is most of the page's height.
  const { scale } = await camera(page);
  expect((1.8 * 2 * scale) / H).toBeGreaterThan(0.7);
  // The samples alone stop at about 1.05, and leave most spine tips off the
  // page.
  await frameCheck(page).uncheck();
  await ready(page);
  const samplesOnly = await camera(page);
  expect(samplesOnly.scale / scale).toBeGreaterThan(1.5);
  expect((await baseVertices(page)).some((v) => !onPage(v))).toBe(true);
  // Turned back on, it draws exactly what it did.
  await frameCheck(page).check();
  await ready(page);
  expect(await art(page).evaluate((svg) => svg.outerHTML)).toBe(framed);
});

test("zooming in, refined to the view, never moves the urchin's framing", async ({
  page,
}) => {
  await page.goto("/");
  await choosePreset(page, { label: urchin });
  await ready(page);
  const fit = await camera(page);
  await art(page).focus();
  for (let k = 0; k < 30; k++) await page.keyboard.press("+");
  await ready(page);
  await expect(page.locator(".refinement-readout")).toContainText(
    "finer in view",
  );
  const zoomed = await camera(page);
  expect(zoomed.scale / fit.scale / 1.1 ** 30).toBeCloseTo(1, 9);
  expect(zoomed.cx).toBeCloseTo(fit.cx, 12);
  expect(zoomed.cy).toBeCloseTo(fit.cy, 12);
  await page.keyboard.press("Home");
  await ready(page);
  expect(await camera(page)).toEqual(fit);
});
