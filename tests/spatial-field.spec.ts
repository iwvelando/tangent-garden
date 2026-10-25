import {
  applyTracks,
  fitBounds,
  availableTargets,
  reveal,
  targetLabel,
} from "../web/spatial/animation";
import { spatialPresets } from "../web/spatial/presets";
import type { SpatialResult } from "../web/spatial/types";
import { test, expect, type Page } from "@playwright/test";
import { choosePreset } from "./helpers";
import { readFile } from "node:fs/promises";
import { probe, decodeVideo } from "./video";
import { curveMesh } from "./curve-mesh";
import { buildScene, scenePasses, defaultLayers } from "../web/spatial/scene";
const stage = (page: Page) => page.locator(".spatial-stage");
const field = (page: Page, name: string) =>
  page.getByRole("textbox", { name, exact: true });
async function ready(page: Page) {
  await page.goto("/?study=3d");
  await expect(page.locator("#spatial-artwork")).toBeVisible();
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
}
async function settled(page: Page) {
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
}
async function config(page: Page) {
  const text = await stage(page).getAttribute("data-config");
  return text ? JSON.parse(text) : undefined;
}
const pixels = (page: Page) =>
  page
    .locator("#spatial-artwork")
    .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
async function openAnimation(page: Page) {
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
}
const vortex = "24",
  lorenz = "25",
  rossler = "26";
const note = (page: Page) => page.getByTestId("field-note");
const layer = (page: Page, name: string) =>
  page.getByRole("checkbox", { name, exact: true });

test("family scene and reveal keep every construction and shadow synchronized", () => {
  const points = (x: number) => [0, 1, 2].map((y) => ({ x, y, z: 0 }));
  const member = (x: number): SpatialResult =>
    ({
      base: points(x),
      minus: [],
      plus: [],
      breaks: [false, false, false],
      mesh: curveMesh(),
      rulings: [],
      bounds: { center: { x, y: 1, z: 0 }, radius: 1 },
      radius: 1,
      omitted: 0,
      invalid: 0,
      projection: {
        points: points(x + 1),
        feet: points(x + 1),
        pole: { x: 0, y: 0, z: 0 },
        constructions: [],
      },
    }) as SpatialResult;
  const result = member(0);
  result.members = [member(20)];
  const shadow = (x: number) => ({
    plane: "z" as const,
    at: -3,
    corners: points(x).concat(points(x)[0]).slice(0, 4),
    curve: { points: points(x), breaks: [false, false, false] },
    kind: "" as const,
    planar: [],
    cast: [],
    compared: 0,
    size: 1,
    notes: [],
  });
  result.shadow = {
    ...shadow(0),
    family: [shadow(20)],
  } as SpatialResult["shadow"];
  const scene = buildScene(result);
  expect(
    scenePasses(scene, defaultLayers).filter((p) => p.layer === "projection")
      .length,
  ).toBe(2);
  expect(scene.shadowCurve.data.length).toBe(2 * 2 * 2 * 7);
  const half = reveal(result, 0.5);
  expect(half.members![0].base).toHaveLength(2);
  expect(half.shadow!.family![0].curve.points).toHaveLength(2);
  expect(half.bounds.radius).toBeGreaterThan(10);
  expect(result.members[0].base).toHaveLength(3);
  expect(reveal(result, 1).bounds).toEqual(result.bounds);
});

test("family toggle preserves presets and enables all paths for new constructions", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, { label: "A rising vortex" });
  await settled(page);
  const all = page.getByRole("checkbox", {
    name: "Construct on all paths",
    exact: true,
  });
  await expect(all).not.toBeChecked();
  const single = await pixels(page);
  await all.check();
  await settled(page);
  expect((await config(page)).allPaths).toBe(true);
  expect(await pixels(page)).not.toBe(single);
  await all.uncheck();
  await settled(page);
  expect(await pixels(page)).toBe(single);
  await choosePreset(page, { label: "A chase untangling a trefoil" });
  await settled(page);
  await page.getByLabel("Construction", { exact: true }).selectOption("canal");
  await settled(page);
  await expect(all).toBeChecked();
  await expect(page.getByTestId("pursuit-note")).toContainText(
    "every moving path",
  );
  await page.getByLabel("Shadow on", { exact: true }).selectOption("z");
  await settled(page);
  await expect(
    page.getByRole("checkbox", { name: "Shadow all paths", exact: true }),
  ).toBeChecked();
  await page
    .getByRole("checkbox", {
      name: "Face-on views beside the drawing",
      exact: true,
    })
    .check();
  await settled(page);
  expect((await config(page)).shadow.grid).toBe(true);
  await expect(
    page.locator('[data-plane-view="shadow"] [data-testid="plane-shadow"]'),
  ).toHaveCount(9);
});

test("tiny sink opens a tube at its own scale and radius edits change its geometry", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, { label: "Spirals into a tiny sink" });
  await settled(page);
  await page.getByLabel("Construction", { exact: true }).selectOption("canal");
  await settled(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect((await config(page)).canal.radius).toBeLessThan(1e-12);
  await expect(page.getByTestId("canal-note")).not.toContainText("folds back");
  const thin = await pixels(page);
  await field(page, "Tube radius R").fill("0.1*2^-40");
  await settled(page);
  expect((await config(page)).canal.radius).toBe(0.1 * 2 ** -40);
  expect(await pixels(page)).not.toBe(thin);
  await choosePreset(page, { label: "A rising vortex" });
  await settled(page);
  expect((await config(page)).canal.radius).toBe(0.35);
});

test("family scope survives pending scalar edits and presets discard those edits", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...rest) {
      if (
        message?.action === "scalars" &&
        message.expressions?.some((s: string) => s === "pi/10" || s === "pi/11")
      ) {
        this.addEventListener("message", function done(event) {
          if (event.data.id !== message.id) return;
          (window as any).familyScalarReplies =
            ((window as any).familyScalarReplies ?? 0) + 1;
          this.removeEventListener("message", done);
        });
        setTimeout(() => send.call(this, message, ...rest), 400);
      } else send.call(this, message, ...rest);
    };
  });
  await ready(page);
  await choosePreset(page, { label: "A rising vortex" });
  await settled(page);
  await page.getByLabel("Construction", { exact: true }).selectOption("canal");
  await settled(page);
  const all = page.getByRole("checkbox", {
    name: "Construct on all paths",
    exact: true,
  });
  await all.check();
  await settled(page);
  await field(page, "Tube radius R").fill("pi/10");
  await all.uncheck();
  await expect
    .poll(async () => (await config(page))?.canal.radius)
    .toBe(Math.PI / 10);
  expect((await config(page)).allPaths).toBe(false);
  await field(page, "Tube radius R").fill("pi/11");
  await choosePreset(page, { label: "A chase untangling a trefoil" });
  await expect
    .poll(() => page.evaluate(() => (window as any).familyScalarReplies))
    .toBe(2);
  await settled(page);
  expect((await config(page)).canal.radius).toBe(0.35);
  expect((await config(page)).allPaths).toBe(true);
});

test("trajectories stand alone with their own layers and validated fields", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, lorenz);
  await settled(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Paths that follow a field",
  );
  await expect(page.getByLabel("Construction", { exact: true })).toHaveValue(
    "none",
  );
  await expect(layer(page, "Ribbon surface")).toHaveCount(0);
  await expect(page.getByLabel("Tangent reach L")).toHaveCount(0);
  const original = await pixels(page);
  for (const name of [
    "Other trajectories",
    "Field directions",
    "Seeds & early stops",
  ]) {
    await layer(page, name).uncheck();
    expect(await pixels(page)).not.toBe(original);
    await layer(page, name).check();
    expect(await pixels(page)).toBe(original);
  }
  for (const [name, text, message] of [
    ["dz/dt", "x*w", "dz/dt"],
    ["dx/dt", "10*(y-", "dx/dt"],
    ["Escape radius R", "0", "escape radius"],
    ["Escape radius R", "2e5", "escape radius"],
    ["Seed x₂", "2e5", "seed 2"],
    ["to", "0", "domain"],
    ["Shape parameter a", "t", "t is not allowed"],
  ] as const) {
    const before = await field(page, name).inputValue();
    await field(page, name).fill(text);
    await expect(page.getByRole("alert")).toContainText(message);
    await field(page, name).fill(before);
    await settled(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  // Seeds are added up to twelve and removed down to one.
  const add = page.getByRole("button", { name: "Add a seed" });
  for (let n = 2; n < 12; n++) await add.click();
  await expect(
    page.getByRole("button", { name: "At most 12 seeds" }),
  ).toBeDisabled();
  await settled(page);
  expect((await config(page)).field.seeds).toHaveLength(12);
  // The third seed continues the line through the first two.
  const third = (await config(page)).field.seeds[2];
  expect(third.x).toBeCloseTo(1.002, 12);
  expect([third.y, third.z]).toEqual([1, 20]);
  for (let n = 12; n > 1; n--)
    await page.getByRole("button", { name: `Remove seed ${n}` }).click();
  await expect(
    page.getByRole("button", { name: "Remove seed 1" }),
  ).toBeDisabled();
  await settled(page);
  expect((await config(page)).field.seeds).toEqual([{ x: 1, y: 1, z: 20 }]);
});

test("notes report ends, escapes, equilibria, timed fields and the carried construction", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, lorenz);
  await settled(page);
  await expect(note(page)).toHaveText(
    "Every trajectory runs to the end of the interval.",
  );
  // The origin is an equilibrium of Lorenz's equations.
  for (const axis of ["x", "y", "z"])
    await field(page, `Seed ${axis}₂`).fill("0");
  await settled(page);
  await expect(note(page)).toContainText(
    "Seed 2 starts near an equilibrium, with negligible initial motion at this study's scale.",
  );
  await field(page, "Escape radius R").fill("30");
  await settled(page);
  await expect(note(page)).toContainText(
    "Trajectory 1 leaves the escape sphere at t = ",
  );
  await expect(note(page)).toContainText(
    "The others run to the end of the interval.",
  );

  await choosePreset(page, vortex);
  await settled(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "A ribbon of tangent lines",
  );
  await expect(note(page)).toContainText(
    "The construction is built on trajectory 1.",
  );
  await field(page, "dz/dt").fill("a*cos(t)");
  await settled(page);
  await expect(note(page)).toContainText("The field changes with t");
  // A first seed outside the escape sphere leaves nothing to build on…
  await field(page, "Seed x₁").fill("30");
  await expect(page.getByRole("alert")).toContainText(
    "trajectory 1 has no regular sample",
  );
  // …but the trajectories can still stand alone.
  await page.getByLabel("Construction", { exact: true }).selectOption("none");
  await settled(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(note(page)).toContainText(
    "Seed 1 is outside the escape sphere, so it has no path.",
  );
  await field(page, "dx/dt").fill("sqrt(x)");
  await settled(page);
  await expect(note(page)).toContainText(
    "The field is not finite at seed 3, so it has no path.",
  );

  await choosePreset(page, rossler);
  await settled(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "A ribbon carried by a frame",
  );
  await expect(note(page)).toContainText(
    "The trajectory runs to the end of the interval.",
  );
});

test("field reveal, pause, resume and edits invalidate stale playback", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, lorenz);
  await settled(page);
  const original = await config(page);
  const full = await pixels(page);
  await openAnimation(page);
  await page.getByLabel("Animate", { exact: true }).selectOption("reveal");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Animation progress" });
  await slider.fill("0.5");
  await expect(stage(page)).toHaveAttribute("data-progress", "0.5");
  const halfway = await pixels(page);
  expect(halfway).not.toBe(full);
  await slider.fill("1");
  await expect(stage(page)).toHaveAttribute("data-progress", "1");
  expect(await pixels(page)).toBe(full);
  await slider.fill("0.5");
  expect(await pixels(page)).toBe(halfway);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect
    .poll(async () => +(await stage(page).getAttribute("data-progress"))!)
    .toBeGreaterThan(0.5);
  await field(page, "Seed z₁").fill("21");
  await expect(stage(page)).not.toHaveAttribute("data-progress");
  await expect
    .poll(async () => (await config(page))?.field?.seeds[0].z)
    .toBe(21);
  expect((await config(page)).field.x).toBe(original.field.x);
  // A replacement preset invalidates pending scalar work.
  await field(page, "Shape parameter a").fill("pi");
  await choosePreset(page, lorenz);
  await settled(page);
  expect((await config(page)).field).toEqual(
    spatialPresets[+lorenz].config.field,
  );
});

for (const camera of ["hold", "current", "follow", "fit"])
  test(`field playback reaches exact endpoints with the ${camera} camera`, async ({
    page,
  }) => {
    await ready(page);
    await choosePreset(page, vortex);
    await settled(page);
    await page
      .getByRole("checkbox", { name: "Construct on all paths", exact: true })
      .check();
    await settled(page);
    const base = await config(page);
    await openAnimation(page);
    await page
      .getByLabel("Animate", { exact: true })
      .selectOption("parameters");
    await page.getByLabel("Parameter 1", { exact: true }).selectOption("a");
    await page.getByLabel("Track 1 from").fill("1/8");
    await page.getByLabel("Track 1 to").fill("1/e");
    await page
      .getByLabel("Animation camera", { exact: true })
      .selectOption(camera);
    await page.getByLabel("Duration (seconds)").fill("5");
    await page.locator("#spatial-artwork").focus();
    await page.keyboard.press("+");
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const slider = page.getByRole("slider", { name: "Animation progress" });
    const framing = async () =>
      JSON.parse((await stage(page).getAttribute("data-camera"))!);
    await slider.fill("0");
    await expect(stage(page)).toHaveAttribute("data-progress", "0");
    expect((await config(page)).field.a).toBe(1 / 8);
    const first = await framing();
    await slider.fill("1");
    await expect(stage(page)).toHaveAttribute("data-progress", "1");
    expect((await config(page)).field.a).toBe(1 / Math.E);
    const last = await framing();
    if (camera === "hold" || camera === "current") expect(last).toEqual(first);
    if (camera === "follow") expect(last.radius).toBe(first.radius);
    if (camera === "fit") expect(last.radius).not.toBe(first.radius);
    expect(first.zoom).toBe(camera === "current" ? 1.1 : 1);
    await slider.fill("0.5");
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(stage(page)).not.toHaveAttribute("data-progress");
    expect(await config(page)).toEqual(base);
  });

test("a field MP4 decodes with exact duration and moving seeds", async ({
  page,
}) => {
  test.slow();
  await ready(page);
  await choosePreset(page, vortex);
  await settled(page);
  await page
    .getByRole("checkbox", { name: "Construct on all paths", exact: true })
    .check();
  await settled(page);
  await openAnimation(page);
  await page.getByLabel("Animate", { exact: true }).selectOption("parameters");
  await page.getByLabel("Parameter 1", { exact: true }).selectOption("seed1Z");
  await page.getByLabel("Track 1 from").fill("0");
  await page.getByLabel("Track 1 to").fill("1");
  await page
    .getByLabel("Animation camera", { exact: true })
    .selectOption("hold");
  await page.getByLabel("Duration (seconds)").fill("0.4");
  await page.locator("#spatial-export-settings > summary").click();
  await page.getByLabel("Export format", { exact: true }).selectOption("mp4");
  await page.getByLabel("Export frame rate").selectOption("15");
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("1");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export MP4/ }).click();
  const file = await download,
    path = (await file.path())!;
  const data = probe(path);
  if (data) {
    expect(data.frames).toBe(6);
    expect(data.durations.reduce((a, b) => a + b, 0)).toBe(400);
  }
  const video = await decodeVideo(page, await readFile(path));
  expect(video.duration).toBeCloseTo(0.4, 3);
  expect(video.first.hash).not.toBe(video.last.hash);
});

test("field reveal shows every trajectory to the same time", () => {
  const origin = { x: 0, y: 0, z: 0 },
    far = { x: 40, y: 0, z: 0 },
    near = { x: 1, y: 0, z: 0 };
  const input: SpatialResult = {
    base: [origin, near, near, near],
    minus: [],
    plus: [],
    mesh: curveMesh(),
    rulings: [],
    breaks: [false, false, false, false],
    bounds: { center: origin, radius: 40 },
    radius: 40,
    invalid: 0,
    omitted: 0,
    field: {
      // The second trajectory escapes between samples 1 and 2; the third
      // reaches far only at the end.
      paths: [
        [origin, near, near, near],
        [near, origin, null, null],
        [origin, origin, origin, far],
      ],
      arrows: [0, 1, 2, 3].map((sampleIndex) => ({
        sampleIndex,
        seed: 0,
        point: origin,
        velocity: near,
      })),
      ends: [
        { time: 3, reason: "end", point: near, steps: 4 },
        { time: 1.5, reason: "escape", point: origin, steps: 2 },
        { time: 3, reason: "end", point: far, steps: 4 },
      ],
      resting: [false, false, false],
      timed: false,
    },
  };
  const early = reveal(input, 1 / 3);
  expect(early.field?.paths).toEqual([
    [origin, near],
    [near, origin],
    [origin, origin],
  ]);
  expect(early.field?.arrows.map((a) => a.sampleIndex)).toEqual([0, 1]);
  // The escape is not marked until the reveal passes it.
  expect(early.field?.ends[1].point).toBeNull();
  expect(reveal(input, 2 / 3).field?.ends[1].point).toEqual(origin);
  // Every trajectory frames the reveal, as in Go.
  expect(early.bounds.radius).toBeLessThan(1);
  expect(reveal(input, 1).bounds.radius).toBeGreaterThan(19);
  expect(input.field?.paths[2]).toHaveLength(4);
});

test("field tracks move a, seeds, escape and time and leave the base intact", () => {
  const base = structuredClone(spatialPresets[+lorenz].config);
  const targets = availableTargets(base);
  expect(targets).toEqual([
    "a",
    "seed1X",
    "seed1Y",
    "seed1Z",
    "seed2X",
    "seed2Y",
    "seed2Z",
    "escape",
    "min",
    "max",
    "samples",
    "lines",
  ]);
  expect(targetLabel(base, "seed2Z")).toBe("Seed z₂");
  expect(targetLabel(base, "escape")).toBe("Escape radius R");
  expect(targetLabel(base, "lines")).toBe("Field arrows");
  // With a construction, its own targets follow a.
  const carried = structuredClone(spatialPresets[+vortex].config);
  expect(availableTargets(carried).slice(0, 2)).toEqual(["a", "length"]);
  expect(targetLabel(carried, "lines")).toBe("Tangent lines");
  const tracks = [
    { target: "a", from: 20, to: 28 },
    { target: "seed2X", from: 1, to: 2 },
    { target: "escape", from: 50, to: 100 },
    { target: "max", from: 10, to: 20 },
  ] as const;
  const end = applyTracks(base, [...tracks], 1).config;
  expect(end.field).toEqual({
    ...base.field,
    a: 28,
    escape: 100,
    max: 20,
    seeds: [base.field.seeds[0], { ...base.field.seeds[1], x: 2 }],
  });
  expect(end.curve).toEqual(base.curve);
  expect(applyTracks(base, [...tracks], -1).config.field.a).toBe(20);
  expect(base.field).toEqual(spatialPresets[+lorenz].config.field);
});

test("any curve can stand alone, with no construction, layers or reach", async ({
  page,
}) => {
  await ready(page);
  const original = await pixels(page);
  await page.getByLabel("Construction", { exact: true }).selectOption("none");
  await settled(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "A curve in space",
  );
  await expect(page.locator(".spatial-layers")).toHaveCount(0);
  await expect(page.getByLabel("Tangent reach L")).toHaveCount(0);
  await expect(page.getByLabel("Representative samples")).toHaveCount(1);
  expect(await pixels(page)).not.toBe(original);
  const shown = await config(page);
  expect(shown.construction).toBe("none");
  expect(availableTargets(shown)).toEqual([
    "radius",
    "tube",
    "samples",
    "lines",
  ]);
  expect(targetLabel(shown, "lines")).toBe("Representative samples");
  // A harmonic curve alone keeps its vector sums and ellipses.
  await page
    .getByLabel("Spatial definition", { exact: true })
    .selectOption("harmonic");
  await settled(page);
  await expect(layer(page, "Vector sums")).toBeVisible();
});

test("tiny sink distinguishes spiraling paths from its equilibrium through playback and edits", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, { label: "Spirals into a tiny sink" });
  await settled(page);
  const base = await config(page);
  expect(base.field.seeds).toHaveLength(5);
  expect(base.field.escape).toBe(4 * 2 ** -40);
  await expect(note(page)).toContainText("Seed 5 starts near an equilibrium");
  await expect(note(page)).not.toContainText("Seeds 1");
  const full = await pixels(page);
  await openAnimation(page);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Animation progress" });
  await slider.fill("0.5");
  await expect(stage(page)).toHaveAttribute("data-progress", "0.5");
  expect(await pixels(page)).not.toBe(full);
  await slider.fill("1");
  await expect(stage(page)).toHaveAttribute("data-progress", "1");
  expect(await pixels(page)).toBe(full);
  await page
    .getByRole("button", { name: "Back to study", exact: true })
    .click();
  expect(await config(page)).toEqual(base);
  // Scalar edits use the same units as a preset: moving the fifth seed
  // off the equilibrium must clear its resting note, then restore it.
  await field(page, "Seed x₅").fill("2^-41");
  await expect(note(page)).not.toContainText("equilibrium");
  await field(page, "Seed x₅").fill("0");
  await expect(note(page)).toContainText("Seed 5 starts near an equilibrium");
});

// A reveal's framing uses the same relative scale as the Go result. Its
// field direction markers must not inherit a fixed world-space radius.
test("field reveal framing scales with a tiny family and retains robust outlier fences", () => {
  const family = Array.from({ length: 100 }, (_, i) => ({
    x: Math.cos((i * 2 * Math.PI) / 100),
    y: Math.sin((i * 2 * Math.PI) / 100),
    z: 0,
  }));
  family.push({ x: 100, y: 0, z: 0 });
  const unit = fitBounds(family);
  expect(unit.center).toEqual({ x: 0, y: 0, z: 0 });
  expect(unit.radius).toBeCloseTo(1, 14);
  for (const scale of [2 ** -40, 2 ** -60]) {
    const tiny = fitBounds(
      family.map((p) => ({ x: scale * p.x, y: scale * p.y, z: scale * p.z })),
    );
    expect(tiny.center).toEqual(unit.center);
    expect(tiny.radius / scale).toBe(unit.radius);
  }
  // A lone point keeps a usable frame, as Go does.
  expect(fitBounds([{ x: 0, y: 0, z: 0 }]).radius).toBe(1e-4);
});
