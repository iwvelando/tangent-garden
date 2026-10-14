import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { choosePreset } from "./helpers";
import { engines, watchEngines } from "./engines";
import { spatialPresets } from "../web/spatial/presets";
import { defaultAnimation, type SpatialStudy } from "../web/spatial/link";
import { defaultLayers, initialView } from "../web/spatial/renderer";
import { defaultCut } from "../web/spatial/cut";
import { defaultSight } from "../web/spatial/sight";
import { studyHref, writeStudyLink } from "../web/study-link";
import type { SpatialConfig } from "../web/spatial/types";

// A patch's probe between its grid samples: Go describes the patch at the
// probe's own (u, v) (engine3/surfacepoint.go), read out beside the
// drawing. Expectations are closed forms evaluated here.
//
// The study is the torus of major radius R = 2 and minor radius r on
// [0, 2π]², on a 30 × 18 grid, with its outward normal X_u × X_v. Around
// the tube its curvature is −1/r; along the parallel, −cos v/(R + r cos v);
// numbered κ₁ ≥ κ₂. Position 0.123456 and across 0.29 put (u, v) ≈
// (0.7757, 1.8221), between rows 3 and 4 and columns 5 and 6.

const stage = (page: Page) => page.locator(".spatial-stage");
const settled = (page: Page) =>
  expect(stage(page)).toHaveAttribute("aria-busy", "false");
const gridSwitch = (page: Page) =>
  page.getByRole("checkbox", { name: "At any u and v, between samples" });
const alongU = (page: Page) => page.getByRole("slider", { name: "Along u" });
const alongV = (page: Page) => page.getByRole("slider", { name: "Along v" });
const readout = (page: Page) => page.locator(".probe-readout dd");
const status = (page: Page) => page.getByTestId("probe-status");
const mode = (page: Page) => page.getByLabel("Animate", { exact: true });
const motion = (page: Page) => page.getByLabel("Probe", { exact: true });
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const short = (v: number) => String(Number(v.toPrecision(4)));
const uSamples = 30,
  vSamples = 18,
  position = 0.123456,
  across = 0.29;

// The readout's four rows at (u, v) on the torus of minor radius r: κ₁,
// κ₂, their radii, and K and H.
function torus(v: number, r = 0.8) {
  const k = [-1 / r, -Math.cos(v) / (2 + r * Math.cos(v))].sort(
    (a, b) => b - a,
  );
  return [
    short(k[0]),
    short(k[1]),
    `${short(1 / k[0])}, ${short(1 / k[1])}`,
    `${short(k[0] * k[1])}, ${short((k[0] + k[1]) / 2)}`,
  ];
}

const config: SpatialConfig = {
  ...structuredClone(spatialPresets[0].config),
  format: "surface",
  surface: {
    ...structuredClone(spatialPresets[0].config.surface),
    kind: "torus",
    a: 2,
    b: 0.8,
    c: 1,
    uMin: 0,
    uMax: 2 * Math.PI,
    vMin: 0,
    vMax: 2 * Math.PI,
    uSamples,
    vSamples,
    curves: 6,
    reverse: false,
    offset: 0,
    reach: 0,
  },
};
async function open(page: Page, betweenGrid = true, extra: object = {}) {
  const study: SpatialStudy = {
    config,
    layers: defaultLayers,
    view: initialView,
    animation: defaultAnimation,
    probe: {
      enabled: true,
      position,
      target: "surface",
      across,
      ...(betweenGrid && { betweenGrid: true }),
    },
    cut: defaultCut,
    sight: defaultSight,
    projection: "orthographic",
    ...extra,
  };
  const token = await writeStudyLink("3d", study);
  await page.goto(
    studyHref("http://localhost/?study=3d", "3d", token).replace(
      "http://localhost",
      "",
    ),
  );
  await expect(page.locator("#spatial-artwork")).toBeVisible();
  await settled(page);
  await expect(readout(page)).toHaveCount(4);
}
async function openAnimation(page: Page) {
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
}
async function seek(page: Page, p: string) {
  await page.getByRole("slider", { name: "Animation progress" }).fill(p);
  await expect(stage(page)).toHaveAttribute("data-progress", p);
  await settled(page);
}
// Where the probe is drawn, as Go placed it.
const placedAt = (u: number, v: number) => `${u},${v}`;
const at = (p: number) => 2 * Math.PI * p;

test("between grid samples, the patch's probe reads the surface at its own u and v", async ({
  page,
}) => {
  await open(page);
  const u = at(position),
    v = at(across);
  expect((position * uSamples) % 1).toBeGreaterThan(0.1);
  expect((across * vSamples) % 1).toBeGreaterThan(0.1);
  await expect(gridSwitch(page)).toBeChecked();
  await expect(stage(page)).toHaveAttribute("data-probe-uv", placedAt(u, v));
  await expect(alongU(page)).toHaveAttribute("step", "any");
  await expect(alongV(page)).toHaveAttribute("step", "any");
  await expect(alongU(page)).toHaveAttribute(
    "aria-valuetext",
    `u = ${short(u)}`,
  );
  await expect(alongV(page)).toHaveAttribute(
    "aria-valuetext",
    `v = ${short(v)}`,
  );
  await expect(readout(page)).toHaveText(torus(v));
  // Snapped, it stands on the nearest grid sample, which reads differently.
  await gridSwitch(page).uncheck();
  await settled(page);
  const column = Math.round(across * vSamples),
    vj = (2 * Math.PI * column) / vSamples;
  expect(torus(vj)).not.toEqual(torus(v));
  await expect(stage(page)).not.toHaveAttribute("data-probe-uv", /./);
  await expect(alongV(page)).toHaveAttribute(
    "aria-valuetext",
    `v = ${short(vj)}, column ${column} of ${vSamples}`,
  );
  await expect(readout(page)).toHaveText(torus(vj));
  await gridSwitch(page).check();
  await settled(page);
  await expect(readout(page)).toHaveText(torus(v));
  await expect(stage(page)).toHaveAttribute("data-probe-uv", placedAt(u, v));
});

test("moving the patch's probe between samples asks Go for the point alone", async ({
  page,
}) => {
  await watchEngines(page, 2);
  await open(page);
  const pixels = () =>
    page
      .locator("#spatial-artwork")
      .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  const before = (await engines(page))[0].sent.spatial ?? 0;
  const first = await pixels();
  for (const [p, q] of [
    [0.31, 0.12],
    [0.62, 0.47],
    [0.4, 0.77],
  ]) {
    await alongU(page).fill(String(p));
    await alongV(page).fill(String(q));
    await expect(stage(page)).toHaveAttribute(
      "data-probe-uv",
      placedAt(at(p), at(q)),
    );
    await settled(page);
    await expect(readout(page)).toHaveText(torus(at(q)));
  }
  expect(await pixels()).not.toBe(first);
  // One probe-only request per move, each answered from the study Go
  // keeps: never the whole study again.
  const sent = (await engines(page))[0].sent.spatial - before;
  expect(sent).toBeGreaterThanOrEqual(3);
  expect(sent).toBeLessThanOrEqual(7);
});

test("a lines export records the patch's probe at its own u and v", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Export image", exact: true }).click();
  const event = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Lines (SVG) · every line", exact: true })
    .click();
  const svg = (await readFile((await (await event).path())!)).toString();
  expect(svg).toContain('<g id="probe"');
  const meta = JSON.parse(
    svg
      .match(/<desc>(.*?)<\/desc>/)![1]
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&amp;", "&"),
  );
  expect(meta.probe).toEqual({
    target: "surface",
    u: at(position),
    v: at(across),
  });
});

test("moving the probe along the patch passes through every u at its v", async ({
  page,
}) => {
  await open(page);
  await openAnimation(page);
  await mode(page).selectOption("probe");
  await page.getByLabel("Duration (seconds)").fill("4");
  await button(page, "Play animation").click();
  await expect(stage(page)).toHaveAttribute("data-mode", "probe");
  await button(page, "Pause").click();
  await expect(gridSwitch(page)).toBeDisabled();
  for (const p of ["0.37", "0", "1", "0.621"]) {
    await seek(page, p);
    await expect(stage(page)).toHaveAttribute(
      "data-probe-uv",
      placedAt(at(Number(p)), at(across)),
    );
  }
  await expect(page.locator(".animation-values")).toContainText(
    `Probe at u = ${Number(at(0.621).toPrecision(6))}, v = ${Number(at(across).toPrecision(6))}`,
  );
  // Stopping returns the probe to where it was put.
  await button(page, "Stop").click();
  await settled(page);
  await expect(stage(page)).toHaveAttribute(
    "data-probe-uv",
    placedAt(at(position), at(across)),
  );
  await expect(readout(page)).toHaveText(torus(at(across)));
});

test("while parameters vary, Go places the patch's probe at its exact u and v in each frame", async ({
  page,
}) => {
  await open(page);
  await openAnimation(page);
  await mode(page).selectOption("parameters");
  await page
    .getByLabel("Parameter 1", { exact: true })
    .selectOption("surfaceB");
  await page.getByLabel("Track 1 from").fill("0.8");
  await page.getByLabel("Track 1 to").fill("0.4");
  await page.getByLabel("Duration (seconds)").fill("5");
  await motion(page).selectOption("point");
  await button(page, "Play animation").click();
  await expect(stage(page)).toHaveAttribute("data-mode", "parameters");
  await button(page, "Pause").click();
  const u = at(position),
    v = at(across);
  for (const p of ["0.5", "1", "0"]) {
    await seek(page, p);
    await expect(stage(page)).toHaveAttribute("data-probe-uv", placedAt(u, v));
  }
  // Moving along the patch, it stands at that share of u, as the radius
  // varies.
  await button(page, "Stop").click();
  await settled(page);
  await motion(page).selectOption("along");
  await button(page, "Play animation").click();
  await expect(stage(page)).toHaveAttribute("data-mode", "parameters");
  await button(page, "Pause").click();
  await seek(page, "0.37");
  await expect(stage(page)).toHaveAttribute(
    "data-probe-uv",
    placedAt(at(0.37), v),
  );
});

test("a frame whose domain leaves the probe's u out has no probe", async ({
  page,
}) => {
  await open(page);
  await openAnimation(page);
  await mode(page).selectOption("parameters");
  await page.getByLabel("Parameter 1", { exact: true }).selectOption("uMax");
  await page.getByLabel("Track 1 from").fill("2*pi");
  await page.getByLabel("Track 1 to").fill("0.5");
  await page.getByLabel("Duration (seconds)").fill("5");
  await motion(page).selectOption("point");
  await button(page, "Play animation").click();
  await expect(stage(page)).toHaveAttribute("data-mode", "parameters");
  await button(page, "Pause").click();
  await seek(page, "1");
  await expect(stage(page)).not.toHaveAttribute("data-probe-uv", /./);
  await expect(page.locator(".spatial-probe")).toContainText(
    "lies outside this frame's domain",
  );
  await seek(page, "0");
  await expect(stage(page)).toHaveAttribute(
    "data-probe-uv",
    placedAt(at(position), at(across)),
  );
});

test("only a patch offers its probe between grid samples", async ({ page }) => {
  await page.goto("/?study=3d");
  await settled(page);
  await choosePreset(page, { label: "A torus revealing its centers" });
  await settled(page);
  const probe = page.locator(".spatial-probe .probe-switch input").first();
  await probe.check();
  await settled(page);
  await expect(gridSwitch(page)).toHaveCount(1);
  // A mirror's probe stays on its grid.
  await choosePreset(page, { label: "A paraboloid gathering light" });
  await settled(page);
  await page.locator(".spatial-probe .probe-switch input").first().check();
  await settled(page);
  await expect(gridSwitch(page)).toHaveCount(0);
});

test("the umbilic example stands exactly on an umbilic the grid steps over", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await settled(page);
  await choosePreset(page, { label: "Through an ellipsoid's umbilic" });
  await settled(page);
  await expect(gridSwitch(page)).toBeChecked();
  // sin v = √((b² − c²)/(a² − c²)) for (1.5, 1, 0.7), at u = 2π; κ = −ac/b³.
  const v = Math.asin(Math.sqrt(0.51 / 1.76));
  const [u, w] = (await stage(page).getAttribute("data-probe-uv"))!
    .split(",")
    .map(Number);
  expect(u).toBeCloseTo(2 * Math.PI, 12);
  expect(w).toBeCloseTo(v, 12);
  // The grid's columns are π/24 apart and miss it.
  expect(((v + Math.PI / 2) / Math.PI) * 24 - 16).toBeCloseTo(0.342, 3);
  await expect(status(page)).toHaveText(
    "An umbilic: every direction is principal, so none is drawn.",
  );
  await expect(readout(page).nth(0)).toHaveText(short(-1.05));
  await expect(readout(page).nth(1)).toHaveText(short(-1.05));
  // Snapped to the nearest sample, it is not.
  await gridSwitch(page).uncheck();
  await settled(page);
  await expect(status(page)).not.toHaveText(/umbilic/);
});

test("a reveal draws the patch's probe once it reaches the row after it", async ({
  page,
}) => {
  await open(page);
  await openAnimation(page);
  await mode(page).selectOption("reveal");
  await page.getByLabel("Duration (seconds)").fill("5");
  await button(page, "Play animation").click();
  await expect(stage(page)).toHaveAttribute("data-mode", "reveal");
  await button(page, "Pause").click();
  // The probe stands between rows 3 and 4: drawn through row 3 (progress
  // 0.13), the reveal has not reached it; through row 4 (0.134), it has.
  await seek(page, "0.13");
  await expect(page.locator(".spatial-probe")).toContainText(
    "The drawing has not reached the probe yet.",
  );
  await expect(stage(page)).not.toHaveAttribute("data-probe-uv", /./);
  await seek(page, "0.134");
  await expect(stage(page)).toHaveAttribute(
    "data-probe-uv",
    placedAt(at(position), at(across)),
  );
});
