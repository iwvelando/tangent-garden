import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { choosePreset } from "./helpers";
import { engines, watchEngines } from "./engines";
import { spatialPresets } from "../web/spatial/presets";
import {
  defaultAnimation,
  presetStudy,
  type SpatialStudy,
} from "../web/spatial/link";
import { defaultLayers, initialView } from "../web/spatial/renderer";
import { defaultCut } from "../web/spatial/cut";
import { defaultSight } from "../web/spatial/sight";
import { studyHref, writeStudyLink } from "../web/study-link";
import type {
  SpatialConfig,
  SpatialResult,
  SurfaceDiagnostics,
} from "../web/spatial/types";
import { surfaceProbeBatches, surfaceQuery } from "../web/spatial/probe";

// The surface probe between grid samples on a surface built on a curve:
// Go describes the canal, ruling or ribbon at the probe's own t and place
// across it (engine3/surfacepoint.go, curvePoint). Expectations are closed
// forms evaluated here.
//
// The study is the tube of radius r = 0.5 round the circle of radius 2 in
// the xy-plane, t in [0, 2π], its angle carried by a rotation-minimizing
// frame started from N₀ = z. That frame stays z, so the turn θ from θ₀ = 0
// points cos θ z + sin θ (cos t, sin t, 0), at a distance ρ = 2 + r sin θ
// from the axis. Around the contact circle κ = −1/r; across it,
// −sin θ/(2 + r sin θ). Position 0.123456 and across 0.29 stand between
// samples 59 and 60 of 480, and between turns 6 and 7 of 24.

const stage = (page: Page) => page.locator(".spatial-stage");
const settled = (page: Page) =>
  expect(stage(page)).toHaveAttribute("aria-busy", "false");
const canalSwitch = (page: Page) =>
  page.getByRole("checkbox", { name: "At any t and θ − θ₀, between samples" });
const ruledSwitch = (page: Page) =>
  page.getByRole("checkbox", { name: "At any t and u, between samples" });
const anyGridSwitch = (page: Page) =>
  page.getByRole("checkbox", { name: /^At any .* and .*, between samples$/ });
const alongT = (page: Page) => page.getByRole("slider", { name: "Along t" });
const around = (page: Page) => page.getByRole("slider", { name: "Around" });
const readout = (page: Page) => page.locator(".probe-readout dd");
const mode = (page: Page) => page.getByLabel("Animate", { exact: true });
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const short = (v: number) => String(Number(v.toPrecision(4)));
const position = 0.123456,
  across = 0.29,
  r = 0.5;
const at = (p: number) => 2 * Math.PI * p;

// The readout's four rows at turn θ on the tube: κ around, κ across, their
// radii, and K and H.
function tube(theta: number) {
  const k = [-1 / r, -Math.sin(theta) / (2 + r * Math.sin(theta))];
  return [
    short(k[0]),
    short(k[1]),
    `${short(1 / k[0])}, ${short(1 / k[1])}`,
    `${short(k[0] * k[1])}, ${short((k[0] + k[1]) / 2)}`,
  ];
}

const base = structuredClone(spatialPresets[0].config);
const config: SpatialConfig = {
  ...base,
  format: "harmonic",
  construction: "canal",
  samples: 480,
  harmonic: {
    center: { x: 0, y: 0, z: 0 },
    terms: [
      {
        frequency: 1,
        cosine: { x: 2, y: 0, z: 0 },
        sine: { x: 0, y: 2, z: 0 },
      },
    ],
    min: 0,
    max: 2 * Math.PI,
  },
  canal: { radius: r, profile: "1", meridians: 4 },
  frame: {
    ...base.frame,
    kind: "rotation-minimizing",
    reference: { x: 0, y: 0, z: 1 },
    angle: 0,
    twist: 0,
    closure: "seam",
  },
};
async function open(page: Page, betweenGrid = true, samples = 480) {
  const study: SpatialStudy = {
    config: { ...config, samples },
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
const placedAt = (u: number, v: number) => `${u},${v}`;

test("a tiny framed ribbon keeps its probe normal and curvature on and between samples", async ({
  page,
}) => {
  const radius = 2 ** -40;
  const study = presetStudy(0);
  study.config = {
    ...structuredClone(config),
    construction: "framed",
    harmonic: {
      ...config.harmonic,
      terms: [
        {
          frequency: 1,
          cosine: { x: radius, y: 0, z: 0 },
          sine: { x: 0, y: radius, z: 0 },
        },
      ],
    },
    frame: {
      ...config.frame,
      width: radius / 4,
      offset: 0,
      strands: 0,
      twist: 1,
    },
  };
  study.probe = {
    enabled: true,
    target: "surface",
    position: 0.125,
    across: 0.5,
  };
  const token = await writeStudyLink("3d", study);
  await page.goto(`/?study=3d#s=${token}`);
  await expect(page).not.toHaveURL(/#s=/);
  await settled(page);
  const check = async () => {
    await expect(page.getByTestId("probe-status")).not.toHaveText(
      /Singular|unknown|No point/,
    );
    await expect(readout(page)).toHaveCount(4);
    await expect(readout(page).first()).not.toHaveText(/—|unknown/);
    const K = Number(
      (await readout(page).nth(3).textContent())!.split(", ")[0],
    );
    expect(Math.abs(K * radius * radius + 1)).toBeLessThan(5e-4);
  };
  await check();
  await alongT(page).fill("120");
  await check();
  await ruledSwitch(page).check();
  await alongT(page).fill("0.123456");
  await expect(stage(page)).toHaveAttribute(
    "data-probe-uv",
    placedAt(at(0.123456), 0),
  );
  await settled(page);
  await check();
  // Returning to the grid retains the same regular surface.
  await ruledSwitch(page).uncheck();
  await settled(page);
  await check();
});

test("between samples, a canal's probe reads the tube at its own t and turn", async ({
  page,
}) => {
  await open(page);
  const t = at(position),
    theta = at(across);
  expect((position * 480) % 1).toBeGreaterThan(0.1);
  expect((across * 24) % 1).toBeGreaterThan(0.1);
  await expect(canalSwitch(page)).toBeChecked();
  await expect(stage(page)).toHaveAttribute(
    "data-probe-uv",
    placedAt(t, theta),
  );
  await expect(alongT(page)).toHaveAttribute("step", "any");
  await expect(around(page)).toHaveAttribute("step", "any");
  await expect(alongT(page)).toHaveAttribute(
    "aria-valuetext",
    `t = ${short(t)}`,
  );
  await expect(around(page)).toHaveAttribute(
    "aria-valuetext",
    `θ − θ₀ = ${short(theta)}`,
  );
  await expect(readout(page)).toHaveText(tube(theta));
  // Snapped, it stands on the nearest turn, which reads differently.
  await canalSwitch(page).uncheck();
  await settled(page);
  const turn = (2 * Math.PI * Math.round(across * 24)) / 24;
  expect(tube(turn)).not.toEqual(tube(theta));
  await expect(stage(page)).not.toHaveAttribute("data-probe-uv", /./);
  await expect(readout(page)).toHaveText(tube(turn));
  await canalSwitch(page).check();
  await settled(page);
  await expect(readout(page)).toHaveText(tube(theta));
});

test("moving a canal's probe between samples asks Go for the point alone", async ({
  page,
}) => {
  await watchEngines(page, 2);
  await open(page);
  const before = (await engines(page))[0].sent.spatial ?? 0;
  for (const [p, q] of [
    [0.31, 0.12],
    [0.62, 0.47],
    [0.4, 0.77],
  ]) {
    await alongT(page).fill(String(p));
    await around(page).fill(String(q));
    await expect(stage(page)).toHaveAttribute(
      "data-probe-uv",
      placedAt(at(p), at(q)),
    );
    await settled(page);
    await expect(readout(page)).toHaveText(tube(at(q)));
  }
  const sent = (await engines(page))[0].sent.spatial - before;
  expect(sent).toBeGreaterThanOrEqual(3);
  expect(sent).toBeLessThanOrEqual(7);
});

test("a lines export records a canal's probe at its own t and turn", async ({
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

test("moving the probe along a canal passes through every t at its turn", async ({
  page,
}) => {
  await open(page);
  await openAnimation(page);
  await mode(page).selectOption("probe");
  await page.getByLabel("Duration (seconds)").fill("4");
  await button(page, "Play animation").click();
  await expect(stage(page)).toHaveAttribute("data-mode", "probe");
  await button(page, "Pause").click();
  await expect(canalSwitch(page)).toBeDisabled();
  for (const p of ["0.37", "0", "1", "0.621"]) {
    await seek(page, p);
    await expect(stage(page)).toHaveAttribute(
      "data-probe-uv",
      placedAt(at(Number(p)), at(across)),
    );
  }
  await button(page, "Stop").click();
  await settled(page);
  await expect(stage(page)).toHaveAttribute(
    "data-probe-uv",
    placedAt(at(position), at(across)),
  );
  await expect(readout(page)).toHaveText(tube(at(across)));
});

test("a reveal draws a canal's probe once it reaches the sample after it", async ({
  page,
}) => {
  test.slow();
  await open(page, true, 1440);
  await openAnimation(page);
  await mode(page).selectOption("reveal");
  await page.getByLabel("Duration (seconds)").fill("5");
  await button(page, "Play animation").click();
  await expect(stage(page)).toHaveAttribute("data-mode", "reveal");
  await button(page, "Pause").click();
  // With 1440 samples the grid's rows are every third sample. The probe
  // stands between samples 177 and 178: drawn through 177 (progress
  // 0.123), the reveal has not reached it; through 178 (0.124), it has.
  await seek(page, "0.123");
  await expect(page.locator(".spatial-probe")).toContainText(
    "The drawing has not reached the probe yet.",
  );
  await expect(stage(page)).not.toHaveAttribute("data-probe-uv", /./);
  await seek(page, "0.124");
  await expect(stage(page)).toHaveAttribute(
    "data-probe-uv",
    placedAt(at(position), at(across)),
  );
});

test("a surface built on an integrated curve stays on its grid", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await settled(page);
  // A curve evaluated anywhere offers it, its curve probe too.
  await choosePreset(page, { label: "A tube around the trefoil" });
  await settled(page);
  await page.getByLabel("Describe", { exact: true }).selectOption("surface");
  await page.locator(".spatial-probe .probe-switch input").first().check();
  await settled(page);
  await expect(canalSwitch(page)).toHaveCount(1);
  // The curve probe has its own switch, for t alone.
  await page.getByLabel("Describe", { exact: true }).selectOption("curve");
  await expect(anyGridSwitch(page)).toHaveCount(0);
  // A field's trajectory, integrated step by step, does not.
  await page
    .getByLabel("Spatial definition", { exact: true })
    .selectOption("field");
  await settled(page);
  await page.getByLabel("Construction", { exact: true }).selectOption("canal");
  await settled(page);
  await page.getByLabel("Describe", { exact: true }).selectOption("surface");
  await settled(page);
  await expect(anyGridSwitch(page)).toHaveCount(0);
});

test("the hyperboloid example stands on the throat its grid steps over", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await settled(page);
  await choosePreset(page, { label: "Round a hyperboloid's throat" });
  await settled(page);
  await expect(ruledSwitch(page)).toBeChecked();
  const [t, u] = (await stage(page).getAttribute("data-probe-uv"))!
    .split(",")
    .map(Number);
  expect(t).toBe(Math.PI / 4);
  expect(u).toBe(0.3);
  // The grid's 25 columns along each ruling are 1/24 apart and miss it.
  expect((u * 24) % 1).toBeCloseTo(0.2, 9);
  // On x² + z² − y²/c² = 1, c = 1.25: κ = 1/c² and −1, K = −1/c².
  await expect(readout(page)).toHaveText([
    "0.64",
    "-1",
    // 1/0.64 = 1.5625 exactly, so the fourth figure rounds either way.
    /^1\.56[23], -1$/,
    "-0.64, -0.18",
  ]);
  // Played, it glides round the throat, reading the same everywhere.
  await openAnimation(page);
  await button(page, "Play animation").click();
  await expect(stage(page)).toHaveAttribute("data-mode", "probe");
  await button(page, "Pause").click();
  await seek(page, "0.37");
  await expect(stage(page)).toHaveAttribute(
    "data-probe-uv",
    placedAt(at(0.37), 0.3),
  );
  await button(page, "Stop").click();
  await settled(page);
  // Snapped to the nearest column, it leaves the throat.
  await ruledSwitch(page).uncheck();
  await settled(page);
  await expect(readout(page).nth(3)).not.toHaveText("-0.64, -0.18");
});

test("a tangent developable's share across runs through its columns, which skip u = 0", () => {
  const developable: SpatialConfig = {
    ...base,
    construction: "developable",
    length: 1.2,
  };
  const L = developable.length;
  // Columns ±L·k/12, k = 1…12: the share k/23 stands on column k.
  const columns = [
    ...Array.from({ length: 12 }, (_, k) => (-L * (12 - k)) / 12),
    ...Array.from({ length: 12 }, (_, k) => (L * (k + 1)) / 12),
  ];
  columns.forEach((v, k) =>
    expect(surfaceQuery(developable, 0.5, k / 23).v).toBeCloseTo(v, 14),
  );
  // Between columns 5 (−7L/12) and 6 (−6L/12), a quarter of the way.
  expect(surfaceQuery(developable, 0.5, 5.25 / 23).v).toBeCloseTo(
    (-L * 6.75) / 12,
    14,
  );
  // Halfway across, the edge of regression.
  expect(surfaceQuery(developable, 0.5, 0.5).v).toBeCloseTo(0, 14);
  expect(surfaceQuery(developable, 0, 1)).toEqual({ u: 0, v: L });
});

test("a point between samples draws the circle or ruling Go gives through it", () => {
  const through = [
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: -1, y: 0, z: 0 },
  ];
  const d = {
    kind: "canal",
    along: [3],
    u: [0.1],
    v: [0.2],
    periodic: true,
    points: [[through[0]]],
    normals: [[{ x: 1, y: 0, z: 0 }]],
    curvature: [[[-2]], [[-0.5]]],
    direction: [[[{ x: 0, y: 1, z: 0 }]], [[{ x: 0, y: 0, z: 1 }]]],
    focal: [[[null]], [[null]]],
    singular: 0,
    umbilics: 0,
    unknown: 0,
    clipped: [0, 0],
    through,
  } as unknown as SurfaceDiagnostics;
  const result = {
    surfaceDiagnostics: d,
    bounds: { center: { x: 0, y: 0, z: 0 }, radius: 2 },
  } as unknown as SpatialResult;
  const mark = surfaceProbeBatches(result, 0, 0)[0];
  // The point's cross (three segments), then the line's two segments.
  const vertices = Array.from(mark.data).filter((_, i) => i % 7 < 3);
  expect(vertices.length / 3).toBe(6 + 2 * (through.length - 1));
  expect(vertices.slice(18)).toEqual([1, 0, 0, 0, 1, 0, 0, 1, 0, -1, 0, 0]);
});
