import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import {
  chooseColorScheme,
  choosePreset,
  open as openDetails,
} from "./helpers";
import { decodeVideo, frameDifference, probe } from "./video";
import { transportDefaults } from "../web/spatial/geodesics";
import {
  arrowLines,
  revealGeodesics,
  routeThrough,
  transportHold,
  transportIndex,
  travel,
} from "../web/spatial/geodesic-path";
import { reveal } from "../web/spatial/animation";
import { spatialPresets } from "../web/spatial/presets";
import { defaultLayers } from "../web/spatial/scene";
import type {
  GeodesicResult,
  SpatialResult,
  TransportResult,
  Vec3,
} from "../web/spatial/types";

// A tangent arrow carried along a geodesic thread or around a sphere's
// octant triangle, through the real controls, worker and engine: its
// presets, notes and layers, controls and refusals, the reveal that
// carries it and holds where it arrives, seeking and scrubbing across the
// triangle's corners, exports, links, cancellation and the loop check.
const stage = (page: Page) => page.locator(".spatial-stage");
const canvas = (page: Page) => page.locator("#spatial-artwork");
const field = (page: Page, name: string) =>
  page.getByRole("textbox", { name, exact: true });
const count = (page: Page, name: string) =>
  page.getByRole("spinbutton", { name, exact: true });
const check = (page: Page, name: string) =>
  page.getByRole("checkbox", { name, exact: true });
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const carry = (page: Page) => check(page, "Carry a tangent arrow");
const note = (page: Page) => page.getByTestId("transport-note");
const unavailable = (page: Page) => page.getByTestId("transport-unavailable");
const settled = (page: Page) =>
  expect(stage(page)).toHaveAttribute("aria-busy", "false");
async function ready(page: Page) {
  await page.goto("/?study=3d");
  await expect(canvas(page)).toBeVisible();
  await settled(page);
}
async function config(page: Page) {
  return JSON.parse((await stage(page).getAttribute("data-config"))!);
}
const pixels = (page: Page) =>
  canvas(page).evaluate((c: HTMLCanvasElement) => c.toDataURL());
async function openAnimation(page: Page) {
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
}
async function paused(page: Page) {
  await openAnimation(page);
  await button(page, "Play animation").click();
  await button(page, "Pause").click();
}
async function seek(page: Page, p: string) {
  await page.getByRole("slider", { name: "Animation progress" }).fill(p);
  await expect(stage(page)).toHaveAttribute("data-progress", p);
}
async function lines(page: Page) {
  await button(page, "Export image").click();
  const event = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Lines (SVG) · every line", exact: true })
    .click();
  const svg = (await readFile((await (await event).path())!)).toString();
  const groups: Record<string, number> = {};
  for (const m of svg.matchAll(/<g id="([a-z0-9-]+)"[^>]*>(.*?)<\/g>/gs))
    groups[m[1]] = (groups[m[1]] ?? 0) + [...m[2].matchAll(/[ML]-?\d/g)].length;
  return groups;
}
async function openStudy(page: Page, study: unknown) {
  // A new document each time: a changed hash alone opens nothing.
  await page.goto("about:blank");
  await page.goto(
    `/?study=3d#s=${deflateRawSync(
      Buffer.from(JSON.stringify({ v: 1, notebook: "3d", study })),
    ).toString("base64url")}`,
  );
  await expect(canvas(page)).toBeVisible();
  await settled(page);
}
const triangle = { label: "The arrow that came home turned" };
const torusArrow = { label: "An arrow carried along a torus thread" };
const preset = (label: string) => spatialPresets.find((p) => p.name === label)!;
// The triangle's first corner comes at a third of the route, travelled in
// the first 1 − hold of the duration: progress 0.2667. On the slider's
// steps of 0.001, 0.266 stands just before it and 0.267 on its sample,
// 0.3 of a sample spacing past it.
const before = "0.266",
  corner = "0.267";

test("the triangle preset carries its arrow home turned a quarter turn", async ({
  page,
}) => {
  test.slow();
  await ready(page);
  await choosePreset(page, triangle);
  await settled(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "An arrow carried along a surface",
  );
  await expect(carry(page)).toBeChecked();
  expect((await config(page)).surface.geodesics).toEqual(
    preset(triangle.label).config.surface.geodesics,
  );
  await expect(page.getByLabel("Arrow's path", { exact: true })).toHaveValue(
    "triangle",
  );
  await expect(note(page)).toContainText(
    "Around the octant triangle the arrow comes home turned +90° about the outward normal: the area enclosed, πr²/2, times the curvature 1/r².",
  );
  await expect(note(page)).toContainText(
    "Its length stays 1 and it stays tangent to rounding.",
  );
  await expect(note(page)).toContainText(
    "The arrow is drawn in rust, its reference arrows in slate.",
  );
  await expect(page.locator(".legend")).toContainText(
    "Surface Octant triangle Carried arrow Reference arrows",
  );
  // The note names its colors in the scheme they are drawn in.
  await chooseColorScheme(page, "forest");
  await expect(note(page)).toContainText(
    "The arrow is drawn in ochre, its reference arrows in blue.",
  );
  const forest = await pixels(page);
  await chooseColorScheme(page, "default");
  const drawn = await pixels(page);
  expect(forest).not.toBe(drawn);
  for (const name of ["Octant triangle", "Carried arrow", "Reference arrows"]) {
    await check(page, name).uncheck();
    expect(await pixels(page)).not.toBe(drawn);
    await check(page, name).check();
    expect(await pixels(page)).toBe(drawn);
  }
  // The linework carries the triangle, one arrow (a shaft and two barbs,
  // five or six path points as the writer joins them) and twelve
  // reference arrows.
  const groups = await lines(page);
  expect(groups.route).toBeGreaterThan(700);
  expect(groups.carried).toBeGreaterThanOrEqual(5);
  expect(groups.carried).toBeLessThanOrEqual(6);
  expect(groups.references).toBe(12 * groups.carried);
  expect(groups.threads ?? 0).toBe(0);
});

test("seeking, scrubbing back and playback agree across the triangle's corners and at the return", async ({
  page,
}) => {
  test.slow();
  await ready(page);
  await choosePreset(page, triangle);
  await settled(page);
  const full = await pixels(page);
  await paused(page);
  const at: Record<string, string> = {};
  const marks = [
    "0",
    "0.25",
    before,
    corner,
    "0.29",
    "0.5",
    "0.6",
    "0.8",
    "0.95",
  ];
  for (const p of marks) {
    await seek(page, p);
    at[p] = await pixels(page);
  }
  // Every one differs until the arrow arrives; then the arrival holds,
  // and is the finished study.
  expect(new Set(marks.slice(0, 8).map((p) => at[p])).size).toBe(8);
  expect(at["0.8"]).toBe(full);
  expect(at["0.95"]).toBe(full);
  // Half way round, the reference arrows at jL/12 for j = 0…6 have been
  // passed, and the triangle is drawn to its middle.
  await seek(page, "0.4");
  const half = await lines(page);
  expect(half.references).toBe(7 * half.carried);
  for (const p of [...marks].reverse()) {
    await seek(page, p);
    expect(await pixels(page), `scrubbed back to ${p}`).toBe(at[p]);
  }
  // Playback paused part way shows the arrow on its way; played through,
  // it ends on the arrival a seek draws.
  await button(page, "Resume").click();
  await page.waitForTimeout(700);
  await button(page, "Pause").click();
  const p = Number(await stage(page).getAttribute("data-progress"));
  const played = await pixels(page);
  if (p > 0 && p < 1 - transportHold) {
    expect(played).not.toBe(at["0"]);
    expect(played).not.toBe(full);
  }
  // On a loaded runner playback can end before Pause lands; Stop is then
  // Back to study, which restores the study the same way.
  await page.getByRole("button", { name: /^(Stop|Back to study)$/ }).click();
  await settled(page);
  await page.getByLabel("Duration (seconds)").fill("1");
  await button(page, "Play animation").click();
  await expect(button(page, "Replay")).toBeVisible();
  expect(await pixels(page)).toBe(full);
  // A fresh page, seeking straight to the corner and to the return.
  for (const q of [corner, "0.8"]) {
    await ready(page);
    await choosePreset(page, triangle);
    await settled(page);
    await paused(page);
    await seek(page, q);
    expect(await pixels(page), `fresh seek to ${q}`).toBe(at[q]);
  }
});

// What a reveal shows of the arrow, on a three-sided route with a corner
// sample at arc length 1 and 2: the arrow stands at the last sample
// reached, a corner shows the arrow that arrived, and the route ends on its
// chord at the reveal's arc length.
test("the revealed arrow stands at the last sample reached; a corner shows its arrival", () => {
  const point = (x: number): Vec3 => ({ x, y: 0, z: 0 });
  const arcs = [0, 0.5, 1, 1.5, 2, 2.5, 3];
  const tr: TransportResult = {
    path: "triangle",
    length: 3,
    size: 0.5,
    samples: {
      arcs,
      points: arcs.map(point),
      vectors: arcs.map((a) => ({
        x: 0,
        y: a < 1.0001 ? 1 : 0,
        z: a > 1 ? 1 : 0,
      })),
      normals: arcs.map(() => ({ x: 0, y: 0, z: 1 })),
      tangents: arcs.map(() => ({ x: 1, y: 0, z: 0 })),
    },
    references: {
      arcs: [0, 1.5],
      points: [point(0), point(1.5)],
      vectors: [
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 0, z: 1 },
      ],
      normals: [
        { x: 0, y: 0, z: 1 },
        { x: 0, y: 0, z: 1 },
      ],
      tangents: [
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
    },
    corners: [2, 4],
    reason: "end",
    reached: 3,
    steps: 0,
    returns: true,
    holonomy: Math.PI / 2,
    drift: { norm: 0, tangency: 0 },
  };
  expect(transportIndex(tr, 0)).toBe(0);
  expect(transportIndex(tr, 0.99)).toBe(1);
  expect(transportIndex(tr, 1)).toBe(2);
  expect(transportIndex(tr, 1.01)).toBe(2);
  expect(transportIndex(tr, 3)).toBe(6);
  // Without a reveal, where the path ended.
  expect(transportIndex(tr)).toBe(6);
  expect(routeThrough(tr, 1.25)).toEqual([
    point(0),
    point(0.5),
    point(1),
    point(1.25),
  ]);
  expect(routeThrough(tr, 2)).toEqual(arcs.slice(0, 5).map(point));
  // The head's barbs lie in the tangent plane, behind the tip.
  const arrow = arrowLines(tr.samples, 0, 0.5);
  expect(arrow).toHaveLength(6);
  expect(arrow[1]).toEqual({ x: 0, y: 0.5, z: 0 });
  for (const barb of [arrow[3], arrow[5]]) {
    expect(barb.z).toBe(0);
    expect(barb.y).toBeLessThan(0.5);
  }
  // The reveal travels the first 1 − hold, then holds.
  expect(travel(0)).toBe(0);
  expect(travel((1 - transportHold) / 2)).toBeCloseTo(0.5, 15);
  expect(travel(1 - transportHold)).toBe(1);
  expect(travel(0.95)).toBe(1);
  const fan = {
    surface: "sphere",
    length: 6,
    step: 1,
    threads: [],
    selected: 1,
    steps: 0,
    transport: tr,
  } as GeodesicResult;
  expect(revealGeodesics(fan, 0.5, 6).transport!.shown).toBe(1.5);
  const result = {
    surface: { geodesics: { ...fan, threads: [{ points: [], reached: 0 }] } },
  } as unknown as SpatialResult;
  expect(
    reveal(result, (1 - transportHold) / 2).surface!.geodesics!.transport!
      .shown,
  ).toBeCloseTo(1.5, 12);
  expect(reveal(result, 0.9).surface!.geodesics).toBe(
    result.surface!.geodesics,
  );
});

test("an arrow carried on an edited torus takes defaults, follows edits and refuses bad fields by name", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, {
    label: "Threads finding their way around a torus",
  });
  await settled(page);
  await field(page, "Minor radius r").fill("0.6");
  await settled(page);
  const before = await pixels(page);
  const manual = async () => {
    const { yaw, pitch, zoom, panX, panY } = JSON.parse(
      (await canvas(page).getAttribute("data-view"))!,
    );
    return { yaw, pitch, zoom, panX, panY };
  };
  const view = await manual();
  await carry(page).check();
  await settled(page);
  const surface = (await config(page)).surface;
  expect(surface.geodesics.transport).toEqual(transportDefaults(surface));
  expect(surface.geodesics.transport).toEqual({
    path: "thread",
    angle: 90,
    size: 0.3,
    arrows: 8,
  });
  expect(await pixels(page)).not.toBe(before);
  await expect(note(page)).toContainText(
    "Along thread 8 the arrow keeps its 90° angle to the thread, as along any geodesic.",
  );
  await expect(page.locator(".legend")).toContainText(
    "Carried arrow Reference arrows",
  );
  await expect(page.locator(".legend")).not.toContainText("Octant triangle");
  // Edits reach the arrow; the thread and the view stay.
  await field(page, "Arrow angle α (°)").fill("pi/2*180/pi - 30");
  await settled(page);
  await expect(note(page)).toContainText("keeps its 60° angle");
  // Two quick edits: only the last is drawn.
  await field(page, "Arrow angle α (°)").fill("10");
  await field(page, "Arrow angle α (°)").fill("-45");
  await settled(page);
  await expect(note(page)).toContainText("keeps its -45° angle");
  expect((await config(page)).surface.geodesics.transport.angle).toBe(-45);
  // Refusals name their field, and the drawing stays.
  const drawn = await pixels(page);
  await field(page, "Arrow length").fill("0");
  await expect(page.getByRole("alert")).toContainText(
    "the arrow's length must be above 0 and at most 100000",
  );
  await field(page, "Arrow length").fill("0.4");
  await settled(page);
  await count(page, "Reference arrows").fill("37");
  await expect(page.getByRole("alert")).toContainText(
    "use 0–36 reference arrows",
  );
  await count(page, "Reference arrows").fill("8");
  await settled(page);
  await field(page, "Arrow length").fill("0.3");
  await settled(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await pixels(page)).toBe(drawn);
  // The triangle is a sphere's: on the torus it is unavailable, and the
  // threads stay.
  await page
    .getByLabel("Arrow's path", { exact: true })
    .selectOption("triangle");
  await settled(page);
  await expect(unavailable(page)).toHaveText(
    "The octant triangle lies on a sphere; on a torus the arrow can follow the selected thread.",
  );
  await expect(note(page)).toHaveCount(0);
  await expect(page.getByTestId("geodesics-note")).toContainText(
    "16 threads on the torus",
  );
  // On a sphere it is drawn.
  await page.getByLabel("Surface", { exact: true }).selectOption("ellipsoid");
  await settled(page);
  for (const axis of ["Axis a", "Axis b", "Axis c"])
    await field(page, axis).fill("1");
  await field(page, "Start v₀").fill("0");
  await settled(page);
  await expect(unavailable(page)).toHaveCount(0);
  await expect(note(page)).toContainText("comes home turned +90°");
  // Turning the arrow off restores the drawing it was carried over, and the
  // manual view was never moved.
  await page.getByLabel("Arrow's path", { exact: true }).selectOption("thread");
  await settled(page);
  const sphere = (await config(page)).surface;
  const framed = await canvas(page).getAttribute("data-view");
  await carry(page).uncheck();
  await settled(page);
  expect("transport" in (await config(page)).surface.geodesics).toBe(false);
  const plain = await pixels(page);
  await carry(page).check();
  await settled(page);
  expect((await config(page)).surface.geodesics.transport).toEqual(
    transportDefaults(sphere),
  );
  await carry(page).uncheck();
  await settled(page);
  expect(await pixels(page)).toBe(plain);
  expect(await canvas(page).getAttribute("data-view")).toBe(framed);
  expect(await manual()).toEqual(view);
});

// An edit made while an expensive arrow is still being integrated replaces
// it: an entry that cannot be evaluated leaves the previous study drawn,
// and the result begun before it is never shown.
test("an arrow still being integrated is dropped when an edit replaces it", async ({
  page,
}) => {
  test.slow();
  await ready(page);
  await choosePreset(page, torusArrow);
  await settled(page);
  // Eight threads of 20,000 samples, 2,000 long, with the arrow: the
  // largest fan the point cap admits with an arrow, sharing every step.
  await count(page, "Threads").fill("8");
  await count(page, "Samples per thread").fill("20000");
  await field(page, "Thread length L").fill("2000");
  await settled(page);
  await expect(note(page)).toContainText("keeps its 90° angle");
  await field(page, "Arrow angle α (°)").fill("10");
  // Once the request has gone to the worker, an entry it cannot evaluate.
  await page.waitForTimeout(400);
  await expect(stage(page)).toHaveAttribute("aria-busy", "true");
  await field(page, "Arrow angle α (°)").fill("t");
  await expect(page.getByRole("alert")).toHaveText(
    "Arrow angle α (°): t is not allowed in a constant expression",
  );
  await page.waitForTimeout(3000);
  await expect(note(page)).toContainText("keeps its 90° angle");
  await expect(note(page)).not.toContainText("10° angle");
  await field(page, "Arrow angle α (°)").fill("10");
  await settled(page);
  await expect(note(page)).toContainText("keeps its 10° angle");
});

test("the torus thread preset keeps its arrow at a right angle and draws it in every theme", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, torusArrow);
  await settled(page);
  await expect(note(page)).toContainText(
    "Along thread 1 the arrow keeps its 90° angle to the thread, as along any geodesic.",
  );
  await expect(note(page)).toContainText(
    "Its length stays 1 and it stays tangent within",
  );
  const light = await pixels(page);
  await page.getByRole("button", { name: "Use dark background" }).click();
  await settled(page);
  expect(await pixels(page)).not.toBe(light);
  await check(page, "Carried arrow").uncheck();
  const without = await pixels(page);
  await check(page, "Carried arrow").check();
  expect(await pixels(page)).not.toBe(without);
});

test("a link keeps the arrow, and a fan's link from before it has none", async ({
  page,
}) => {
  const p = preset(triangle.label);
  const study = {
    config: p.config,
    layers: { ...defaultLayers, ...p.layers },
    view: p.view,
  };
  await openStudy(page, study);
  expect((await config(page)).surface.geodesics.transport).toEqual(
    p.config.surface.geodesics!.transport,
  );
  await expect(note(page)).toContainText("comes home turned +90°");
  const { transport: _, ...fan } = p.config.surface.geodesics!;
  await openStudy(page, {
    ...study,
    config: { ...p.config, surface: { ...p.config.surface, geodesics: fan } },
  });
  await expect(carry(page)).not.toBeChecked();
  expect("transport" in (await config(page)).surface.geodesics).toBe(false);
});

test("a loop needs the arrow back where it started: a whole turn of its angle loops, half a turn does not", async ({
  page,
}) => {
  const p = preset(torusArrow.label);
  const study = (to: string) => ({
    config: p.config,
    layers: { ...defaultLayers, ...p.layers },
    view: p.view,
    animation: {
      mode: "parameters",
      camera: "hold",
      duration: 1,
      repeat: "loop",
      tracks: [{ target: "transportAngle", from: "90", to }],
    },
  });
  await openStudy(page, study("90 + 360"));
  await openAnimation(page);
  await expect(page.getByLabel("Parameter 1", { exact: true })).toHaveValue(
    "transportAngle",
  );
  await button(page, "Play animation").click();
  await expect(button(page, "Pause")).toBeVisible();
  await page.waitForTimeout(1200);
  await expect(page.locator(".animation-error")).toHaveCount(0);
  await button(page, "Stop").click();
  await page.getByLabel("Track 1 to", { exact: true }).fill("270");
  await button(page, "Play animation").click();
  await expect(page.locator(".animation-error")).toContainText(
    "the drawing at the end lies up to",
  );
});

// The movie of the triangle's reveal decodes with its duration; its frames
// before the first corner, after the second, at the arrival and in the
// hold are the stills a direct seek draws there.
test("the triangle's movie agrees with stills at direct seeks", async ({
  page,
}) => {
  test.slow();
  await ready(page);
  await choosePreset(page, triangle);
  await settled(page);
  await paused(page);
  const stills: Record<string, Buffer> = {};
  for (const p of ["1", "0", "0.2", "0.6"]) {
    await seek(page, p);
    stills[p] = await still(page);
  }
  await button(page, "Stop").click();
  await settled(page);
  await page.getByLabel("Duration (seconds)").fill("0.4");
  await openDetails(page, "#spatial-export-settings");
  await page.getByLabel("Export format", { exact: true }).selectOption("mp4");
  await page.getByLabel("Export frame rate").selectOption("15");
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("2");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export MP4/ }).click();
  const path = (await (await download).path())!;
  const data = probe(path);
  if (data) {
    expect(data.frames).toBe(6);
    expect([data.width, data.height]).toEqual([2000, 1520]);
  }
  const video = await decodeVideo(page, await readFile(path));
  expect(video.duration).toBeCloseTo(0.4, 3);
  expect(video.first.hash).not.toBe(video.last.hash);
  const match = (index: number, reference: Buffer) =>
    frameDifference(path, 2000, 1520, index, reference);
  // Frames at progress 0, 0.2, 0.6, 0.8 (the arrival) and 1 (the hold),
  // each against every still. The surface fills every frame and only thin
  // lines differ, so the whole frame's mean difference stays small: each
  // frame must match its own still within H.264's noise and lie nearer it
  // than any other. Measured: 0.47–0.86 levels to its own, 1.0–1.4 to the
  // other end.
  const frames: [number, string][] = [
    [0, "0"],
    [1, "0.2"],
    [3, "0.6"],
    [4, "1"],
    [5, "1"],
  ];
  const keys = Object.keys(stills);
  const table = frames.map(([index, own]) => ({
    own,
    to: Object.fromEntries(keys.map((k) => [k, match(index, stills[k])])),
  }));
  if (table.every((row) => keys.every((k) => row.to[k]))) {
    console.log("Transport reveal frames", JSON.stringify(table));
    for (const { own, to } of table) {
      expect(to[own]!.meanDifference).toBeLessThan(4);
      expect(to[own]!.unmatchedInk).toBeLessThan(0.02);
      for (const k of keys)
        if (k !== own)
          expect(to[own]!.meanDifference, `${own} against ${k}`).toBeLessThan(
            to[k]!.meanDifference,
          );
    }
  }
});

// A still PNG's pixels, as RGBA.
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
