import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { choosePreset } from "./helpers";
import { engines, watchEngines } from "./engines";
import { decodeVideo, frameDifference, probe as ffprobe } from "./video";
import { spatialPresets } from "../web/spatial/presets";
import { defaultAnimation, type SpatialStudy } from "../web/spatial/link";
import { defaultLayers, initialView } from "../web/spatial/renderer";
import { defaultCut } from "../web/spatial/cut";
import { defaultSight } from "../web/spatial/sight";
import { studyHref, writeStudyLink } from "../web/study-link";
import {
  probeBatches,
  probeInk,
  sampleProbe,
  type CurveProbe,
} from "../web/spatial/probe";
import type { Batch } from "../web/spatial/scene";
import type { SpatialConfig, SpatialResult, Vec3 } from "../web/spatial/types";

// The 3D curve probe between samples: Go describes the curve and its
// construction at the probe's own t (engine3/probe.go), read out beside
// the drawing. Expectations are closed forms evaluated here.
//
// The study is the elliptic helix r = (3 cos t, sin t, a·t/4) on [0, 2π]
// with 240 samples. With h = a/4, r′ = (−3 sin t, cos t, h), r′ × r″ =
// (h sin t, −3h cos t, 3) and (r′ × r″)·r‴ = 3h, so κ = |r′ × r″|/|r′|³
// and τ = 3h/|r′ × r″|². Position 0.123456 is t ≈ 0.7757, between samples
// 29 and 30.

const stage = (page: Page) => page.locator(".spatial-stage");
const settled = (page: Page) =>
  expect(stage(page)).toHaveAttribute("aria-busy", "false");
const betweenSwitch = (page: Page) =>
  page.getByRole("checkbox", { name: "At any t, between samples" });
const point = (page: Page) => page.getByRole("slider", { name: "Point" });
const readout = (page: Page) => page.locator(".probe-readout dd");
const mode = (page: Page) => page.getByLabel("Animate", { exact: true });
const motion = (page: Page) => page.getByLabel("Probe", { exact: true });
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const short = (v: number) => String(Number(v.toPrecision(4)));
const samples = 240,
  position = 0.123456;

function helix(t: number, a = 1) {
  const h = a / 4,
    s = Math.sin(t),
    c = Math.cos(t);
  const b = Math.hypot(h * s, 3 * h * c, 3),
    speed = Math.hypot(3 * s, c, h);
  const kappa = b / speed ** 3;
  return [short(kappa), short(1 / kappa), short((3 * h) / (b * b))];
}

const config: SpatialConfig = {
  ...structuredClone(spatialPresets[0].config),
  format: "parametric",
  construction: "none",
  samples,
  lines: 24,
  curve: {
    x: "3*cos(t)",
    y: "sin(t)",
    z: "a*t/4",
    a: 1,
    min: 0,
    max: 2 * Math.PI,
  },
};
async function open(page: Page, between = true, extra: object = {}) {
  const study: SpatialStudy = {
    config,
    layers: defaultLayers,
    view: initialView,
    animation: defaultAnimation,
    probe: {
      enabled: true,
      position,
      target: "curve",
      across: 0.5,
      ...(between && { between: true }),
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
  await expect(readout(page)).toHaveCount(3);
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

test("between samples, the probe reads the curve at its own t", async ({
  page,
}) => {
  await open(page);
  const t = 2 * Math.PI * position;
  expect((position * samples) % 1).toBeGreaterThan(0.5);
  await expect(betweenSwitch(page)).toBeChecked();
  await expect(stage(page)).toHaveAttribute("data-probe-t", String(t));
  await expect(stage(page)).not.toHaveAttribute("data-probe-sample", /./);
  await expect(point(page)).toHaveAttribute(
    "aria-valuetext",
    `t = ${short(t)}`,
  );
  await expect(point(page)).toHaveAttribute("step", "any");
  await expect(readout(page)).toHaveText(helix(t));
  // Snapped, it stands on the nearest sample instead, which reads
  // differently there.
  await betweenSwitch(page).uncheck();
  await settled(page);
  const j = Math.round(position * samples),
    tj = (2 * Math.PI * j) / samples;
  expect(helix(tj)).not.toEqual(helix(t));
  await expect(stage(page)).toHaveAttribute("data-probe-sample", String(j));
  await expect(point(page)).toHaveAttribute(
    "aria-valuetext",
    `t = ${short(tj)}, sample ${j} of ${samples}`,
  );
  await expect(readout(page)).toHaveText(helix(tj));
  await betweenSwitch(page).check();
  await settled(page);
  await expect(readout(page)).toHaveText(helix(t));
  await expect(stage(page)).toHaveAttribute("data-probe-t", String(t));
});

test("moving the probe between samples asks Go for the probe alone", async ({
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
  for (const p of [0.31, 0.62, 0.4]) {
    await point(page).fill(String(p));
    const t = 2 * Math.PI * p;
    await expect(stage(page)).toHaveAttribute("data-probe-t", String(t));
    await settled(page);
    await expect(readout(page)).toHaveText(helix(t));
  }
  expect(await pixels()).not.toBe(first);
  const log = (await engines(page))[0];
  // One probe-only request per place, each of which the worker answers
  // from the study Go keeps.
  expect(log.sent.spatial - before).toBeGreaterThanOrEqual(3);
  expect(log.sent.spatial - before).toBeLessThanOrEqual(4);
  // A fast drag coalesces: its last place is where the probe ends.
  for (let k = 0; k < 30; k++)
    await point(page).fill(String(Number((0.5 + k / 100).toFixed(2))));
  await settled(page);
  await expect(stage(page)).toHaveAttribute(
    "data-probe-t",
    String(2 * Math.PI * 0.79),
  );
  await expect(readout(page)).toHaveText(helix(2 * Math.PI * 0.79));
});

test("a drag over a slow engine keeps one probe request in flight and ends at its last place", async ({
  page,
}) => {
  // Every request reaches the worker 300 ms late, so the drag outruns it.
  await watchEngines(page, 2, { spatial: 300 });
  await open(page);
  const before = (await engines(page))[0].sent.spatial ?? 0;
  const places = [0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65];
  for (const p of places) await point(page).fill(String(p));
  await settled(page);
  const last = 2 * Math.PI * places.at(-1)!;
  await expect(stage(page)).toHaveAttribute("data-probe-t", String(last));
  await expect(readout(page)).toHaveText(helix(last));
  // The first place, then the latest one each reply finds wanted.
  const sent = (await engines(page))[0].sent.spatial - before;
  expect(sent).toBeGreaterThanOrEqual(2);
  expect(sent).toBeLessThan(places.length);
});

test("a lines export records the probe's own t, not a sample", async ({
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
  expect(meta.probe).toEqual({ t: 2 * Math.PI * position });
  expect(meta.config).toEqual(config);
});

test("moving the probe along the curve passes through every t", async ({
  page,
}) => {
  await open(page);
  await openAnimation(page);
  await mode(page).selectOption("probe");
  await page.getByLabel("Duration (seconds)").fill("4");
  await button(page, "Play animation").click();
  await expect(stage(page)).toHaveAttribute("data-mode", "probe");
  await button(page, "Pause").click();
  await expect(point(page)).toBeDisabled();
  await expect(betweenSwitch(page)).toBeDisabled();
  for (const p of ["0.37", "0", "1", "0.621"]) {
    await seek(page, p);
    const t = 2 * Math.PI * Number(p);
    await expect(stage(page)).toHaveAttribute("data-probe-t", String(t));
    await expect(point(page)).toHaveAttribute(
      "aria-valuetext",
      `t = ${short(t)}`,
    );
    await expect(readout(page)).toHaveText(helix(t));
  }
  await expect(page.locator(".animation-values")).toContainText(
    `Probe at t = ${Number((2 * Math.PI * 0.621).toPrecision(6))}`,
  );
  // Stopping returns the probe to where it was put.
  await button(page, "Stop").click();
  await settled(page);
  await expect(stage(page)).toHaveAttribute(
    "data-probe-t",
    String(2 * Math.PI * position),
  );
  await expect(point(page)).toBeEnabled();
});

test("while parameters vary, Go places the probe at its exact t in each frame", async ({
  page,
}) => {
  await open(page);
  await openAnimation(page);
  await mode(page).selectOption("parameters");
  await page.getByLabel("Parameter 1", { exact: true }).selectOption("a");
  await page.getByLabel("Track 1 from").fill("1");
  await page.getByLabel("Track 1 to").fill("3");
  await page.getByLabel("Duration (seconds)").fill("5");
  await expect(motion(page)).toHaveValue("stays");
  await button(page, "Play animation").click();
  await expect(stage(page)).toHaveAttribute("data-mode", "parameters");
  await button(page, "Pause").click();
  const t = 2 * Math.PI * position;
  for (const [p, a] of [
    ["0.5", 2],
    ["1", 3],
    ["0", 1],
  ] as const) {
    await seek(page, p);
    await expect(stage(page)).toHaveAttribute("data-probe-t", String(t));
    await expect(readout(page)).toHaveText(helix(t, a));
  }
  // Moving along the curve, it stands at that share of the domain, as the
  // parameter varies.
  await button(page, "Stop").click();
  await settled(page);
  await motion(page).selectOption("along");
  await button(page, "Play animation").click();
  await expect(stage(page)).toHaveAttribute("data-mode", "parameters");
  await button(page, "Pause").click();
  await seek(page, "0.37");
  const along = 2 * Math.PI * 0.37;
  await expect(stage(page)).toHaveAttribute("data-probe-t", String(along));
  await expect(readout(page)).toHaveText(helix(along, 1.74));
});

// A still PNG's pixels, as RGBA (see spatial-probe-playback.spec.ts).
async function still(page: Page) {
  await button(page, "Export image").click();
  const event = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /^PNG image/ }).click();
  const png = await readFile((await (await event).path())!);
  const rgba = await page.evaluate(async (input) => {
    const image = new Image();
    image.src = `data:image/png;base64,${input}`;
    await image.decode();
    const c = document.createElement("canvas");
    c.width = image.width;
    c.height = image.height;
    const g = c.getContext("2d")!;
    g.drawImage(image, 0, 0);
    const data = g.getImageData(0, 0, c.width, c.height).data;
    let text = "";
    for (let i = 0; i < data.length; i += 0x8000)
      text += String.fromCharCode(...data.subarray(i, i + 0x8000));
    return btoa(text);
  }, png.toString("base64"));
  return Buffer.from(rgba, "base64");
}

test("a probe playback export draws the probe at each frame's own t", async ({
  page,
}) => {
  test.slow();
  // 241 samples, so the export's frames at progress 0.4 stands between
  // samples 96 and 97, 0.4 of the way.
  await open(page, true, { config: { ...config, samples: 241 } });
  await point(page).fill("0.4");
  await settled(page);
  const between = await still(page);
  await betweenSwitch(page).uncheck();
  await settled(page);
  await expect(stage(page)).toHaveAttribute("data-probe-sample", "96");
  const snapped = await still(page);
  await betweenSwitch(page).check();
  await settled(page);
  await openAnimation(page);
  await mode(page).selectOption("probe");
  await page
    .getByLabel("Animation camera", { exact: true })
    .selectOption("current");
  await page.getByLabel("Duration (seconds)").fill("0.4");
  await page.locator("#spatial-export-settings > summary").click();
  await page.getByLabel("Export format", { exact: true }).selectOption("mp4");
  await page.getByLabel("Export frame rate").selectOption("15");
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("2");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export MP4/ }).click();
  const path = (await (await download).path())!;
  const data = ffprobe(path);
  if (data) {
    expect(data.frames).toBe(6);
    expect(data.durations.reduce((a, b) => a + b, 0)).toBe(400);
  }
  const video = await decodeVideo(page, await readFile(path));
  expect(video.duration).toBeCloseTo(0.4, 3);
  const own = frameDifference(path, 2000, 1520, 2, between);
  const sample = frameDifference(path, 2000, 1520, 2, snapped);
  if (own && sample) {
    console.log("Probe between samples in an export", { own, sample });
    expect(own.meanDifference).toBeLessThan(6);
    expect(own.unmatchedInk).toBeLessThan(0.02);
    expect(sample.unmatchedInk).toBeGreaterThan(0.01);
    expect(sample.unmatchedInk).toBeGreaterThan(own.unmatchedInk);
  }
});

test("a reveal draws the probe between samples once it reaches the sample after it", async ({
  page,
}) => {
  await open(page);
  await openAnimation(page);
  await mode(page).selectOption("reveal");
  await page.getByLabel("Duration (seconds)").fill("5");
  await button(page, "Play animation").click();
  await expect(stage(page)).toHaveAttribute("data-mode", "reveal");
  await button(page, "Pause").click();
  await seek(page, "0.1");
  await expect(page.locator(".spatial-probe")).toContainText(
    "The drawing has not reached the probe yet.",
  );
  await expect(stage(page)).not.toHaveAttribute("data-probe-t", /./);
  // The probe stands between samples 29 and 30: drawn through sample 29
  // (progress 0.122), the reveal has not reached it; through 30 (0.125),
  // it has.
  await seek(page, "0.122");
  await expect(page.locator(".spatial-probe")).toContainText(
    "The drawing has not reached the probe yet.",
  );
  await seek(page, "0.125");
  await expect(stage(page)).toHaveAttribute(
    "data-probe-t",
    String(2 * Math.PI * position),
  );
});

test("only a curve evaluated at any parameter offers to stand between samples", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await settled(page);
  await choosePreset(page, { label: "Four pursuers on a tetrahedron" });
  await settled(page);
  const probe = page.getByRole("checkbox", {
    name: "Frame, curvature & torsion at a point",
  });
  await probe.check();
  await settled(page);
  await expect(betweenSwitch(page)).toHaveCount(0);
  await choosePreset(page, { label: "Helix · a ribbon staircase" });
  await settled(page);
  await expect(betweenSwitch(page)).toHaveCount(1);
});

test("the Viviani example glides its osculating circle between samples", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await settled(page);
  await choosePreset(page, {
    label: "An osculating circle gliding round Viviani's window",
  });
  await settled(page);
  await expect(betweenSwitch(page)).toBeChecked();
  // r = (1 + cos t, sin t, 2 sin(t/2)): κ = √(13 + 3 cos t)/(3 + cos t)^{3/2}
  // and τ = 6 cos(t/2)/(13 + 3 cos t), at t = −2π + 0.1·4π.
  const t = -2 * Math.PI * 0.9 + 2 * Math.PI * 0.1;
  const kappa = Math.sqrt(13 + 3 * Math.cos(t)) / (3 + Math.cos(t)) ** 1.5;
  await expect(stage(page)).toHaveAttribute(
    "data-probe-t",
    String(-2 * Math.PI * 0.9 + 2 * Math.PI * 0.1),
  );
  expect(t).toBeCloseTo(-2 * Math.PI + 0.4 * Math.PI, 12);
  await expect(readout(page)).toHaveText([
    short(kappa),
    short(1 / kappa),
    short((6 * Math.cos(t / 2)) / (13 + 3 * Math.cos(t))),
  ]);
});

// The drawing between samples, from a probe Go placed, by hand: each
// construction's highlight joins the points it carries.
const at = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
function segments(b: Batch): [Vec3, Vec3][] {
  const out: [Vec3, Vec3][] = [];
  for (let i = 0; i + 13 < b.data.length; i += 14)
    out.push([
      at(b.data[i], b.data[i + 1], b.data[i + 2]),
      at(b.data[i + 7], b.data[i + 8], b.data[i + 9]),
    ]);
  return out;
}
const near = (a: Vec3, b: Vec3) =>
  expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(1e-6);

test("a probe between samples draws each construction from its own points", () => {
  const result = {
    base: [],
    minus: [],
    plus: [],
    breaks: [],
    mesh: [],
    rulings: [],
    bounds: { center: at(0, 0, 0), radius: 2 },
    radius: 2,
    omitted: 0,
    invalid: 0,
    projection: {
      pole: at(0, 0, 2),
      points: [],
      feet: [],
      constructions: [],
      collapsed: false,
      invalid: 0,
    },
  } as unknown as SpatialResult;
  const probe: CurveProbe = {
    t: 0.3,
    point: at(1, 0, 0),
    tangent: at(0, 1, 0),
    normal: null,
    binormal: null,
    center: null,
    curvature: 0,
    torsion: null,
    length: 1,
    minus: at(1, -1, 0),
    plus: at(1, 1, 0),
    foot: at(1, 0.5, 0),
    image: at(1, 0.5, 0.1),
    source: at(2, 0, 0),
    members: [at(1, 2, 0), null, at(1, 3, 0)],
  };
  const marked = (construction: SpatialConfig["construction"]) => {
    const b = probeBatches(result, { ...config, construction }, probe).find(
      (b) => b.ink === probeInk.mark,
    )!;
    // Leave out the point's three-axis mark, drawn last.
    return segments(b).slice(0, -3);
  };
  const [ruling] = marked("developable");
  near(ruling[0], probe.minus!);
  near(ruling[1], probe.plus!);
  const [partner] = marked("ruled");
  near(partner[0], probe.point!);
  near(partner[1], probe.plus!);
  const strings = marked("involute");
  expect(strings).toHaveLength(2);
  near(strings[1][1], at(1, 3, 0));
  const feet = marked("tangent-foot");
  expect(feet).toHaveLength(3);
  near(feet[1][0], at(0, 0, 2));
  near(feet[2][1], probe.image!);
  const [correspondence] = marked("inversion");
  near(correspondence[0], probe.source!);
  near(correspondence[1], probe.image!);
  expect(marked("canal")).toHaveLength(0);
});

test("a probe at a sample carries the study's own points there", () => {
  const p = (k: number) => at(k, 0, 0);
  const result = {
    base: [p(0), p(1)],
    minus: [p(10), p(11)],
    plus: [p(20), p(21)],
    projection: { feet: [p(30), p(31)], points: [p(40), p(41)] },
    involute: { members: [{ points: [p(50), null] }] },
    harmonic: { chains: [{ sampleIndex: 0 }, { sampleIndex: 1 }] },
    diagnostics: {
      min: 0,
      max: 2,
      curvature: [1, 0.5],
      torsion: [0, null],
      tangent: [p(60), p(61)],
      normal: [p(70), null],
      binormal: [p(80), null],
      center: [p(90), null],
      length: [0, 3],
    },
  } as unknown as SpatialResult;
  expect(sampleProbe(result, 1)).toEqual({
    t: 2,
    point: p(1),
    tangent: p(61),
    normal: null,
    binormal: null,
    center: null,
    curvature: 0.5,
    torsion: null,
    length: 3,
    minus: p(11),
    plus: p(21),
    foot: p(31),
    source: undefined,
    image: p(41),
    members: [null],
    chain: { sampleIndex: 1 },
    sample: 1,
  });
  expect(sampleProbe({ ...result, diagnostics: undefined }, 0)).toBeNull();
});
