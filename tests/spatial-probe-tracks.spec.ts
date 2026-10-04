import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { choosePreset } from "./helpers";
import { probe as ffprobe, decodeVideo, frameDifference } from "./video";
import { spatialPresets } from "../web/spatial/presets";
import { defaultAnimation } from "../web/spatial/link";
import { defaultLayers, initialView } from "../web/spatial/renderer";
import { defaultCut } from "../web/spatial/cut";
import { defaultSight } from "../web/spatial/sight";
import { studyHref, writeStudyLink } from "../web/study-link";

// The parameter probe while parameter tracks reshape the study, through the
// real notebook, worker, engine and exporter. The helix preset is
// r = (2 cos t, 2 sin t, at/3) on [−3π, 3π] with 960 samples: with
// h = a/3, κ = 2/(4 + h²) and τ = h/(4 + h²) at every point, independent
// of the engine's numerical derivatives.
const stage = (page: Page) => page.locator(".spatial-stage");
const settled = (page: Page) =>
  expect(stage(page)).toHaveAttribute("aria-busy", "false");
const probeSwitch = (page: Page) =>
  page.getByRole("checkbox", {
    name: "Frame, curvature & torsion at a point",
  });
const point = (page: Page) => page.getByRole("slider", { name: "Point" });
const readout = (page: Page) => page.locator(".probe-readout dd");
const mode = (page: Page) => page.getByLabel("Animate", { exact: true });
const motion = (page: Page) => page.getByLabel("Probe", { exact: true });
const values = (page: Page) => page.locator(".animation-values");
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const pixels = (page: Page) =>
  page
    .locator("#spatial-artwork")
    .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
const view = async (page: Page) =>
  JSON.parse((await stage(page).getAttribute("data-camera"))!);
async function seek(page: Page, p: string) {
  await page.getByRole("slider", { name: "Animation progress" }).fill(p);
  await expect(stage(page)).toHaveAttribute("data-progress", p);
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
}
const helix = { label: "Helix · a ribbon staircase" };
const short = (v: number) => String(Number(v.toPrecision(4)));
// The readout of a helix of pitch parameter a: κ, 1/κ, τ.
const helixReadout = (a: number) => {
  const h = a / 3;
  return [
    short(2 / (4 + h * h)),
    short((4 + h * h) / 2),
    short(h / (4 + h * h)),
  ];
};
async function probing(page: Page) {
  await page.goto("/?study=3d");
  await expect(page.locator("#spatial-artwork")).toBeVisible();
  await settled(page);
  await choosePreset(page, helix);
  await probeSwitch(page).check();
  await settled(page);
  await expect(readout(page)).toHaveCount(3);
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
}
async function track(page: Page, target: string, from: string, to: string) {
  await mode(page).selectOption("parameters");
  await page.getByLabel("Parameter 1", { exact: true }).selectOption(target);
  await page.getByLabel("Track 1 from").fill(from);
  await page.getByLabel("Track 1 to").fill(to);
  await page.getByLabel("Duration (seconds)").fill("5");
}
async function playPaused(page: Page) {
  await button(page, "Play animation").click();
  await expect(stage(page)).toHaveAttribute("data-mode", "parameters");
  await button(page, "Pause").click();
}
const options = (page: Page) =>
  motion(page)
    .locator("option")
    .evaluateAll((os) =>
      os.map((o) => [(o as HTMLOptionElement).value, o.textContent]),
    );

test("the probe's motion is offered only for parameter tracks with the probe on", async ({
  page,
}) => {
  await probing(page);
  await expect(motion(page)).toHaveCount(0);
  await mode(page).selectOption("parameters");
  await expect(motion(page)).toHaveValue("stays");
  expect(await options(page)).toEqual([
    ["stays", "Stays at its t"],
    ["length", "Keeps its share of the length"],
    ["along", "Moves along the curve"],
  ]);
  await probeSwitch(page).uncheck();
  await settled(page);
  await expect(motion(page)).toHaveCount(0);
  await probeSwitch(page).check();
  await settled(page);
  await expect(motion(page)).toHaveValue("stays");
  await mode(page).selectOption("orbit");
  await expect(motion(page)).toHaveCount(0);
});

test("a probe that stays at its t describes each frame of a varying helix", async ({
  page,
}) => {
  await probing(page);
  const study = await pixels(page);
  // The probe at the preset's middle sample, t = 0.
  const mine = "t = 0, sample 480 of 960";
  await expect(point(page)).toHaveAttribute("aria-valuetext", mine);
  await track(page, "a", "0", "6");
  await playPaused(page);
  await expect(point(page)).toBeDisabled();
  for (const [p, a] of [
    ["0.5", 3],
    ["1", 6],
    ["0.25", 1.5],
  ] as const) {
    await seek(page, p);
    await expect(point(page)).toHaveAttribute("aria-valuetext", mine);
    await expect(readout(page)).toHaveText(helixReadout(a));
  }
  // The track's readout alone: the probe does not move.
  await expect(values(page)).toHaveText("Shape parameter a = 1.50000");
  const quarter = await pixels(page);
  await probeSwitch(page).uncheck();
  // Turning the probe off ends the animation that draws it.
  await expect(stage(page)).not.toHaveAttribute("data-progress");
  await probeSwitch(page).check();
  await settled(page);
  expect(await pixels(page)).toBe(study);
  // And the drawing of a frame includes the probe: the same frame without
  // it differs.
  await mode(page).selectOption("parameters");
  await probeSwitch(page).uncheck();
  await settled(page);
  await playPaused(page);
  await seek(page, "0.25");
  expect(await pixels(page)).not.toBe(quarter);
  await button(page, "Stop").click();
  await probeSwitch(page).check();
  await settled(page);
  await expect(point(page)).toBeEnabled();
  await expect(point(page)).toHaveAttribute("aria-valuetext", mine);
});

test("staying at t and keeping a share of the length part when the domain grows", async ({
  page,
}) => {
  await probing(page);
  await track(page, "max", "3*pi", "5*pi");
  await playPaused(page);
  await seek(page, "1");
  // [−3π, 5π] in 960 steps: t = 0 is sample 360.
  await expect(point(page)).toHaveAttribute(
    "aria-valuetext",
    "t = 0, sample 360 of 960",
  );
  await button(page, "Back to study").click();
  await motion(page).selectOption("length");
  await playPaused(page);
  await seek(page, "0");
  await expect(point(page)).toHaveAttribute(
    "aria-valuetext",
    "t = 0, sample 480 of 960",
  );
  await seek(page, "1");
  // Half the helix's length is halfway along the domain, at t = π.
  await expect(point(page)).toHaveAttribute(
    "aria-valuetext",
    "t = 3.142, sample 480 of 960",
  );
  await expect(values(page)).toHaveText(
    "Domain end = 15.7080 · Probe at t = 3.14159",
  );
  await expect(readout(page)).toHaveText(helixReadout(1));
});

test("a probe whose t leaves the domain is absent and says why", async ({
  page,
}) => {
  await probing(page);
  await track(page, "min", "-3*pi", "pi");
  await playPaused(page);
  await seek(page, "0.5");
  await expect(point(page)).toHaveAttribute(
    "aria-valuetext",
    // [−π, 3π] in 960 steps: t = 0 is sample 240.
    "t = 0, sample 240 of 960",
  );
  const inside = await pixels(page);
  await seek(page, "1");
  await expect(point(page)).toHaveCount(0);
  await expect(page.locator(".spatial-probe")).toContainText(
    "t = 0 lies outside this frame's domain, [3.14159, 9.42478].",
  );
  // What it describes waits, as it does while the probe is drawn.
  await expect(page.getByLabel("Describe", { exact: true })).toBeDisabled();
  expect(await pixels(page)).not.toBe(inside);
  await seek(page, "0.5");
  await expect(point(page)).toHaveAttribute(
    "aria-valuetext",
    "t = 0, sample 240 of 960",
  );
});

test("a probe that moves along the curve does so while the parameters vary", async ({
  page,
}) => {
  await probing(page);
  await track(page, "a", "0", "6");
  await motion(page).selectOption("along");
  await playPaused(page);
  await seek(page, "0.25");
  await expect(point(page)).toHaveAttribute(
    "aria-valuetext",
    "t = -4.712, sample 240 of 960",
  );
  await expect(readout(page)).toHaveText(helixReadout(1.5));
  await expect(values(page)).toHaveText(
    "Shape parameter a = 1.50000 · Probe at t = -4.71239",
  );
  await seek(page, "1");
  await expect(point(page)).toHaveAttribute(
    "aria-valuetext",
    "t = 9.425, sample 960 of 960",
  );
  await expect(readout(page)).toHaveText(helixReadout(6));
  await button(page, "Back to study").click();
  // With geometry that returns, a probe that stays loops; one that moves
  // along cannot, as it ends where it did not start.
  await page.getByLabel("Track 1 from").fill("1");
  await page.getByLabel("Track 1 to").fill("1");
  await page.getByLabel("Repeat", { exact: true }).selectOption("loop");
  await button(page, "Play animation").click();
  await expect(page.locator(".animation-error")).toContainText(
    "the probe at the end is not where it starts",
  );
  await motion(page).selectOption("stays");
  await button(page, "Play animation").click();
  await expect(stage(page)).toHaveAttribute("data-mode", "parameters");
  await expect(page.locator(".animation-error")).toHaveCount(0);
  await button(page, "Stop").click();
});

for (const camera of ["hold", "current", "follow", "fit"])
  test(`the ${camera} camera frames the varying study as it would without the probe`, async ({
    page,
  }) => {
    await probing(page);
    await track(page, "a", "0", "6");
    await page
      .getByLabel("Animation camera", { exact: true })
      .selectOption(camera);
    await playPaused(page);
    await seek(page, "0.5");
    const probed = await view(page);
    await button(page, "Stop").click();
    await probeSwitch(page).uncheck();
    await settled(page);
    await playPaused(page);
    await seek(page, "0.5");
    // Framing ignores the probe and its osculating circle.
    expect(await view(page)).toEqual(probed);
  });

test("a study link reopens how the probe moves while parameters vary", async ({
  page,
}) => {
  const token = await writeStudyLink("3d", {
    config: structuredClone(
      spatialPresets.find((p) => p.name === helix.label)!.config,
    ),
    layers: defaultLayers,
    view: initialView,
    animation: {
      ...defaultAnimation,
      mode: "parameters",
      tracks: [{ target: "max", from: "3*pi", to: "5*pi" }],
      probeMotion: "length",
    },
    probe: { enabled: true, position: 0.5, target: "curve", across: 0.5 },
    cut: defaultCut,
    sight: defaultSight,
    projection: "orthographic",
  });
  await page.goto(
    studyHref("http://localhost/?study=3d", "3d", token).replace(
      "http://localhost",
      "",
    ),
  );
  await settled(page);
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
  await expect(mode(page)).toHaveValue("parameters");
  await expect(motion(page)).toHaveValue("length");
  await playPaused(page);
  await seek(page, "1");
  await expect(point(page)).toHaveAttribute(
    "aria-valuetext",
    "t = 3.142, sample 480 of 960",
  );
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

// An MP4 at the still images' 2000 × 1520, six frames over 0.4 s.
async function exportVideo(page: Page) {
  await page.getByLabel("Duration (seconds)").fill("0.4");
  const settings = page.locator("#spatial-export-settings");
  if ((await settings.getAttribute("open")) === null)
    await settings.locator(":scope > summary").click();
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
    expect([data.width, data.height]).toEqual([2000, 1520]);
  }
  const video = await decodeVideo(page, await readFile(path));
  expect(video.duration).toBeCloseTo(0.4, 3);
  await expect(stage(page)).not.toHaveAttribute("data-progress");
  return (index: number, reference: Buffer) =>
    frameDifference(path, 2000, 1520, index, reference);
}

test("an export of varying parameters draws the probe on each frame", async ({
  page,
}) => {
  test.slow();
  await probing(page);
  const a = page.getByRole("textbox", { name: "Shape parameter a" });
  // The probe on the helix at a = 1, in the manual view that the
  // animation's current camera keeps.
  const first = await still(page);
  await track(page, "a", "1", "4");
  await page
    .getByLabel("Animation camera", { exact: true })
    .selectOption("current");
  const start = (await exportVideo(page))(0, first);
  // At a = 4, with and without the probe, framed afresh as the hold
  // camera frames the final study.
  await a.fill("4");
  await a.blur();
  await settled(page);
  await expect(readout(page)).toHaveText(helixReadout(4));
  const last = await still(page);
  await probeSwitch(page).uncheck();
  await settled(page);
  const bare = await still(page);
  await probeSwitch(page).check();
  await settled(page);
  await a.fill("1");
  await a.blur();
  await settled(page);
  await page
    .getByLabel("Animation camera", { exact: true })
    .selectOption("hold");
  const match = await exportVideo(page);
  const end = match(5, last),
    without = match(5, bare);
  if (start && end && without) {
    console.log("Probe under tracks endpoints", { start, end, without });
    for (const d of [start, end]) {
      expect(d.meanDifference).toBeLessThan(6);
      expect(d.unmatchedInk).toBeLessThan(0.02);
    }
    // The last frame has the probe's ink, which a frame without it lacks.
    expect(without.unmatchedInk).toBeGreaterThan(0.003);
    expect(without.unmatchedInk).toBeGreaterThan(2 * end.unmatchedInk);
  }
});

// The presets that show the probe while parameters vary open with the
// probe on and their animation set, and read their analytic values.
async function preset(page: Page, label: string) {
  await page.goto("/?study=3d");
  await expect(page.locator("#spatial-artwork")).toBeVisible();
  await settled(page);
  await choosePreset(page, { label });
  await settled(page);
  await expect(probeSwitch(page)).toBeChecked();
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
  await expect(mode(page)).toHaveValue("parameters");
}
// Seek the timeline, which back and forth and easing map to the motion.
async function at(page: Page, time: string) {
  await page.getByRole("slider", { name: "Animation progress" }).fill(time);
  await expect(stage(page)).toHaveAttribute("data-time", time);
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
}
const numbers = async (page: Page) =>
  (await readout(page).allTextContents()).map((t) => parseFloat(t));

test("a helix pressed through its circle reads κ = 1/(1 + a²) and τ = −a/(1 + a²)", async ({
  page,
}) => {
  await preset(page, "A helix pressed through its circle");
  await expect(motion(page)).toHaveValue("stays");
  // (cos t, at, sin t): r′ × r″ = (−a sin t, −1, a cos t) and r‴ =
  // (sin t, 0, −cos t), so κ = 1/(1 + a²) and τ = −a/(1 + a²).
  const expectHelix = async (a: number) => {
    const [k, r, tau] = await numbers(page);
    expect(k).toBeCloseTo(1 / (1 + a * a), 3);
    expect(r).toBeCloseTo(1 + a * a, 3);
    expect(tau).toBeCloseTo(-a / (1 + a * a), 3);
  };
  await expectHelix(-0.35);
  await playPaused(page);
  // Halfway out, a = 0: the circle, its own osculating circle.
  await at(page, "0.25");
  expect(Number(await stage(page).getAttribute("data-progress"))).toBeCloseTo(
    0.5,
    12,
  );
  await expectHelix(0);
  await expect(point(page)).toHaveAttribute(
    "aria-valuetext",
    "t = 0, sample 480 of 960",
  );
  // Out at a = 0.35, the other hand.
  await at(page, "0.5");
  await expectHelix(0.35);
});

test("a twisted cubic losing its bend reads κ = 2|a| and τ = 3/a, flat at a = 0", async ({
  page,
}) => {
  await preset(page, "A twisted cubic losing its bend");
  await playPaused(page);
  await at(page, "0");
  await expect(readout(page)).toHaveText(["2", "0.5", "3"]);
  await at(page, "0.25");
  expect(Number(await stage(page).getAttribute("data-progress"))).toBeCloseTo(
    0.5,
    12,
  );
  await expect(readout(page).first()).toHaveText(
    "0 (flat: N, B and τ undefined)",
  );
  await at(page, "0.5");
  await expect(readout(page)).toHaveText(["2", "0.5", "-3"]);
});

test("a trefoil breathing under a moving probe rides the knot out and back", async ({
  page,
}) => {
  await preset(page, "A trefoil breathing under a moving probe");
  await expect(motion(page)).toHaveValue("along");
  await playPaused(page);
  await at(page, "0");
  await expect(point(page)).toHaveAttribute(
    "aria-valuetext",
    "t = 0, sample 0 of 960",
  );
  await at(page, "0.5");
  await expect(point(page)).toHaveAttribute(
    "aria-valuetext",
    "t = 6.283, sample 960 of 960",
  );
  await expect(values(page)).toHaveText(
    "Minor radius r = 1.30000 · Probe at t = 6.28319",
  );
});

test("a knot reparameterized in place keeps the probe's point while its t moves", async ({
  page,
}) => {
  await preset(page, "A knot reparameterized in place");
  await expect(motion(page)).toHaveValue("length");
  await expect(page.getByLabel("Repeat", { exact: true })).toHaveValue("loop");
  await playPaused(page);
  const seen: { t: string; k: number; tau: number }[] = [];
  for (const time of ["0", "0.25", "0.5", "0.75"]) {
    await at(page, time);
    const [k, , tau] = await numbers(page);
    seen.push({
      t: (await point(page).getAttribute("aria-valuetext"))!,
      k,
      tau,
    });
  }
  // The knot is the same at every frame, and so is the point the probe
  // stands at, to within a sample: its curvature and torsion hold while
  // its t moves. Snapping to the nearest sample can move it up to half a
  // sample's spacing: the knot is about 29 long (its speed² is
  // 17 + 8 cos 3s + 9 cos² 3s) and ds/dt ≤ 1.5, so at most 0.023 of arc
  // length. That moves κ ≈ 0.28 by about 1% here; staying at its t instead
  // moves it by more than half.
  expect(new Set(seen.map((s) => s.t)).size).toBeGreaterThan(2);
  for (const s of seen) {
    expect(Math.abs(s.k - seen[0].k)).toBeLessThan(0.02 * seen[0].k);
    expect(Math.abs(s.tau - seen[0].tau)).toBeLessThan(
      0.02 * Math.abs(seen[0].tau),
    );
  }
  // Staying at its t instead, the probe slides along the fixed knot.
  await button(page, "Stop").click();
  await motion(page).selectOption("stays");
  await playPaused(page);
  const ks: number[] = [];
  for (const time of ["0", "0.25", "0.5", "0.75"]) {
    await at(page, time);
    ks.push((await numbers(page))[0]);
  }
  expect(Math.max(...ks) - Math.min(...ks)).toBeGreaterThan(0.2 * ks[0]);
});
