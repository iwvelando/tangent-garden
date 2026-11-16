import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import { choosePreset, open as openDetails } from "./helpers";
import { decodeVideo, frameDifference, probe } from "./video";
import { presetStudy } from "../web/spatial/link";
import { spatialPresets } from "../web/spatial/presets";
import { integerTargets } from "../web/spatial/animation";
import { defaultLayers } from "../web/spatial/scene";
import type { View } from "../web/spatial/scene";
import type { Frame, SpatialConfig, SpatialResult } from "../web/spatial/types";
import {
  compileSpatialPhrase,
  createSpatialPhraseSampler,
  defaultSpatialPhrase,
  revealShare,
  spatialPhraseAt,
  spatialPhraseError,
  spatialPhraseKeys,
  spatialPhraseTargets,
  spatialPhraseViewError,
  type SpatialPhrase,
} from "../web/spatial/phrase";
import { insertPhase, movePhase, removePhase } from "../web/phrase-timeline";

const preset = (name: string) => {
  const found = spatialPresets.find((p) => p.name === name);
  if (!found) throw new Error(`No preset ${name}`);
  return found;
};
// Sixteen geodesic threads on a ring torus: direction and spread are two
// continuous scalars of one study.
const torus = (): SpatialConfig =>
  structuredClone(preset("Threads finding their way around a torus").config);

const around = { center: { x: 0, y: 0, z: 0 }, radius: 3 };
const entry: View = {
  ...around,
  yaw: 0.3,
  pitch: 0.75,
  zoom: 2.3,
  panX: 0.1,
  panY: -0.2,
};
const film = (): SpatialPhrase => ({
  target: "geodesicDirection",
  also: ["geodesicSpread"],
  opening: 0,
  phases: [
    { name: "Grow", duration: 4, pace: "steady", reveal: 1 },
    {
      name: "Recede",
      duration: 1,
      pace: "steady",
      layers: { surface: false },
    },
    {
      name: "Rise",
      duration: 3,
      pace: "ease",
      view: { yaw: 0, pitch: 1.4, zoom: 1.5, panX: 0, panY: 0, turns: 1 },
    },
    {
      name: "Sweep",
      duration: 4,
      pace: "steady",
      key: "60",
      keys: { geodesicSpread: "10" },
    },
    { name: "Hold", duration: 1, pace: "steady" },
    { name: "Back", duration: 2, pace: "ease", view: "entry", key: "65" },
  ],
});
const compiled = () =>
  compileSpatialPhrase(torus(), defaultLayers, 1, film(), [60, 10, 65], {
    around,
    entry,
  });

test("spatial phrases move continuous targets the study consumes, never counts", () => {
  const targets = spatialPhraseTargets(torus());
  expect(targets).toContain("geodesicDirection");
  expect(targets).toContain("geodesicSpread");
  expect(targets).toContain("geodesicLength");
  for (const t of integerTargets) expect(targets).not.toContain(t);
  const curve = structuredClone(spatialPresets[0].config);
  curve.format = "parametric";
  curve.curve.x = "cos(t)";
  curve.curve.y = "sin(t)";
  curve.curve.z = "t";
  expect(spatialPhraseTargets(curve)).not.toContain("a");
  curve.curve.z = "a*t";
  expect(spatialPhraseTargets(curve)[0]).toBe("a");
});

test("a spatial phrase's keys, reveal, layers and views are checked before it compiles", () => {
  const config = torus();
  expect(spatialPhraseError(config, film())).toBeNull();
  expect(spatialPhraseKeys(film())).toEqual([
    { phase: 3, track: 0, text: "60" },
    { phase: 3, track: 1, text: "10" },
    { phase: 5, track: 0, text: "65" },
  ]);
  const with_ = (change: (p: SpatialPhrase) => void) => {
    const p = film();
    change(p);
    return spatialPhraseError(config, p);
  };
  expect(with_((p) => (p.also = ["geodesicDirection"]))).toMatch(
    /must be distinct/,
  );
  expect(with_((p) => (p.target = "geodesicCount"))).toMatch(
    /consumed continuous target/,
  );
  expect(
    with_((p) => (p.also = ["geodesicSpread", "geodesicLength", "reach"])),
  ).toMatch(/at most 3/);
  expect(with_((p) => (p.phases[0].keys = { geodesicLength: "3" }))).toMatch(
    /Phase 1 has a key for .*not one of the phrase's further/,
  );
  expect(with_((p) => (p.phases[0].key = " "))).toBe(
    "Phase 1 key must be a finite constant.",
  );
  expect(with_((p) => (p.opening = 1.5))).toBe(
    "Opening reveal must be between 0 and 1.",
  );
  expect(with_((p) => (p.phases[1].reveal = -0.1))).toBe(
    "Phase 2 reveal must be between 0 and 1.",
  );
  expect(
    with_(
      (p) =>
        (p.phases[1].layers = { nope: true } as unknown as Partial<
          typeof defaultLayers
        >),
    ),
  ).toBe("Phase 2 layer nope is not a layer of the 3D notebook.");
  expect(
    with_(
      (p) =>
        (p.phases[1].layers = { surface: "yes" } as unknown as Partial<
          typeof defaultLayers
        >),
    ),
  ).toBe("Phase 2 layer surface must be shown or hidden.");
  const view = (change: object) =>
    with_(
      (p) =>
        (p.phases[2].view = { ...film().phases[2].view!, ...change } as never),
    );
  expect(view({ pitch: 2 })).toBe(
    "Phase 3 view is outside the drawing's orbit and zoom limits.",
  );
  expect(view({ zoom: 0.1 })).toBe(
    "Phase 3 view is outside the drawing's orbit and zoom limits.",
  );
  expect(view({ zoom: 1001 })).toBe(
    "Phase 3 view is outside the drawing's orbit and zoom limits.",
  );
  expect(view({ yaw: Infinity })).toBe(
    "Phase 3 view is outside the drawing's orbit and zoom limits.",
  );
  expect(view({ turns: 1.5 })).toBe(
    "Phase 3 turns must be a whole number from −8 to 8.",
  );
  expect(view({ turns: -9 })).toBe(
    "Phase 3 turns must be a whole number from −8 to 8.",
  );
  expect(with_((p) => (p.phases = Array(13).fill(p.phases[0])))).toBe(
    "A phrase must contain 1–12 phases.",
  );
  expect(with_((p) => (p.phases[0].duration = 0.05))).toBe(
    "Phase 1 duration must be at least 0.1 seconds.",
  );
  expect(with_((p) => (p.phases[0].duration = 3600))).toBe(
    "Total phrase duration must be between 0.1 and 3600 seconds.",
  );
  // Deeper than the drawing allows: 8×, unless refined to its view.
  const deep = film();
  (deep.phases[2].view as { zoom: number }).zoom = 20;
  expect(spatialPhraseError(config, deep)).toBeNull();
  expect(spatialPhraseViewError(deep, 8)).toBe(
    "Phase 3 view zooms past 8×; refine the study to its view to zoom further.",
  );
  expect(spatialPhraseViewError(deep, 1000)).toBeNull();
  // A compile refuses what the check refuses, and unresolved keys.
  expect(() =>
    compileSpatialPhrase(config, defaultLayers, 1, film(), [60, 10], {
      around,
      entry,
    }),
  ).toThrow(/Every phase key/);
});

test("boundaries compile once from the entry study, and any seek reads tracks, reveal, layers and camera from them alone", () => {
  const phrase = compiled();
  expect(phrase.duration).toBe(15);
  const at = (s: number) => spatialPhraseAt(phrase, s);
  // Opening: nothing drawn, the study's own values and layers, its view.
  expect(at(0).values).toEqual([65, 30]);
  expect(at(0).reveal).toBe(0);
  expect(at(0).layers).toEqual(defaultLayers);
  expect(at(0).view).toEqual(entry);
  // Drawing steadily, at the opening view.
  expect(at(2).reveal).toBe(0.5);
  expect(at(2).view).toEqual(entry);
  // A layer event applies from its phase's start.
  expect(at(3.999).layers.surface).toBe(true);
  expect(at(4).layers.surface).toBe(false);
  expect(at(4).reveal).toBe(1);
  // Halfway through an eased leg with one whole turn: yaw the shorter way
  // plus 2π, pitch linear, zoom geometric, all at half progress.
  const mid = at(6.5).view;
  expect(mid.yaw).toBeCloseTo((0.3 + 2 * Math.PI) / 2, 12);
  expect(mid.pitch).toBeCloseTo((0.75 + 1.4) / 2, 12);
  expect(mid.zoom).toBeCloseTo(Math.sqrt(2.3 * 1.5), 12);
  // The leg ends exactly at its key view, about the study's bounds.
  const key = { ...around, yaw: 0, pitch: 1.4, zoom: 1.5, panX: 0, panY: 0 };
  expect(at(8).view).toEqual(key);
  // Two tracks move together on the shared phase, steadily; the view holds.
  expect(at(10).values).toEqual([62.5, 20]);
  expect(at(10).view).toEqual(key);
  const config = at(10).config.surface.geodesics!;
  expect([config.direction, config.spread]).toEqual([62.5, 20]);
  expect(at(12.5).values).toEqual([60, 10]);
  // The last phase returns to the opening view exactly; spread holds.
  expect(at(15).values).toEqual([65, 10]);
  expect(at(15).view).toEqual(entry);
  expect(at(15).reveal).toBe(1);
  expect(at(15).layers.surface).toBe(false);
  // Seeking back reads the same state: nothing depends on seek history.
  expect(at(10)).toEqual(spatialPhraseAt(compiled(), 10));
  expect(at(-1)).toEqual(at(0));
  expect(at(99)).toEqual(at(15));
});

test("a phrase without views holds the opening view, in its lens, throughout", () => {
  const phrase = film();
  for (const p of phrase.phases) delete p.view;
  const lensed = { ...entry, projection: "normal" as const, targetDepth: 0.4 };
  const c = compileSpatialPhrase(
    torus(),
    defaultLayers,
    1,
    phrase,
    [60, 10, 65],
    {
      around,
      entry: lensed,
    },
  );
  for (const s of [0, 3, 6.5, 10, 15])
    expect(spatialPhraseAt(c, s).view).toBe(lensed);
  // A flown phrase flies in the opening view's projection.
  const flown = compileSpatialPhrase(
    torus(),
    defaultLayers,
    1,
    film(),
    [60, 10, 65],
    {
      around,
      entry: lensed,
    },
  );
  expect(spatialPhraseAt(flown, 6.5).view.projection).toBe("normal");
  expect(spatialPhraseAt(flown, 8).view.projection).toBe("normal");
});

test("the starter phrase draws the study, moves its first parameter, holds and returns", () => {
  const config = torus();
  const phrase = defaultSpatialPhrase(config);
  expect(spatialPhraseError(config, phrase)).toBeNull();
  expect(phrase.target).toBe(spatialPhraseTargets(config)[0]);
  expect(phrase.opening).toBe(0);
  expect(phrase.phases.map((p) => p.name)).toEqual([
    "Draw the study",
    "Move the parameter",
    "Hold",
    "Return",
  ]);
  expect(phrase.phases[0].reveal).toBe(1);
  expect(phrase.phases.some((p) => p.view !== undefined)).toBe(false);
});

test("arranging a spatial phrase keeps every other phase's layers, reveal and view", () => {
  const phrase = film();
  const added = insertPhase(phrase, 1);
  expect(added.phases).toHaveLength(7);
  expect(added.phases[2]).toEqual({
    name: "Hold",
    duration: 1,
    pace: "steady",
  });
  expect([...added.phases.slice(0, 2), ...added.phases.slice(3)]).toEqual(
    phrase.phases,
  );
  const moved = movePhase(phrase, 2, 0);
  expect(moved.phases[0]).toEqual(phrase.phases[2]);
  expect(moved.opening).toBe(0);
  expect(removePhase(phrase, 1).phases).toEqual([
    phrase.phases[0],
    ...phrase.phases.slice(2),
  ]);
});

// A study result with nothing but bounds: enough for frames that need no
// reveal.
const bare = (config: SpatialConfig): Frame => ({
  config,
  result: { bounds: around } as unknown as SpatialResult,
});

test("the sampler asks for one geometry per distinct input, never for holds, reveals or camera moves", async () => {
  const phrase = film();
  phrase.opening = 1;
  delete phrase.phases[0].reveal;
  const c = compileSpatialPhrase(
    torus(),
    defaultLayers,
    1,
    phrase,
    [60, 10, 65],
    {
      around,
      entry,
    },
  );
  const original = bare(torus());
  const calls: string[] = [];
  const engine = {
    computeSpatial: async (config: SpatialConfig) => {
      const g = config.surface.geodesics!;
      calls.push(`${g.direction},${g.spread}`);
      return bare(config);
    },
  };
  const sample = createSpatialPhraseSampler({ phrase: c, original });
  // The first phases hold the entry values: the study itself, no request.
  for (const s of [0, 1, 4, 5, 6.5, 8]) {
    const view = await sample(s, engine);
    expect(view.frame).toBe(original);
  }
  expect(calls).toEqual([]);
  // A moving frame is computed once, and asking again reuses it.
  await sample(10, engine);
  await sample(10, engine);
  expect(calls).toEqual(["62.5,20"]);
  // The hold's frames share one geometry.
  await sample(12.2, engine);
  await sample(12.8, engine);
  expect(calls).toEqual(["62.5,20", "60,10"]);
  // Another engine keeps its own latest geometry.
  const other = { ...engine };
  await sample(12.5, other);
  expect(calls).toEqual(["62.5,20", "60,10", "60,10"]);
  const end = await sample(15, engine);
  expect(end.complete).toBe(true);
  expect(end.mode).toBe("phrase");
  expect(end.phrase!.view).toEqual(entry);
  expect(end.phrase!.layers.surface).toBe(false);
  expect(end.phrase!.phase).toBe("Back");
  expect(end.phrase!.tracks.map((t) => t.value)).toEqual([65, 10]);
  expect(end.phrase!.tracks[0].range).toEqual([60, 65]);
  expect(end.phrase!.tracks[1].range).toEqual([10, 30]);
});

test("in a study refined to its view, zoomed camera moves refine once per piece, moving frames to their own view, and wide entry frames draw plain", async () => {
  const phrase: SpatialPhrase = {
    target: "geodesicDirection",
    opening: 1,
    phases: [
      {
        name: "Close in",
        duration: 4,
        pace: "steady",
        view: { yaw: 0.3, pitch: 0.75, zoom: 6, panX: 0.4, panY: 0, turns: 0 },
      },
      { name: "Steeper", duration: 2, pace: "steady", key: "70" },
      { name: "Back", duration: 2, pace: "steady", key: "65", view: "entry" },
    ],
  };
  const wide: View = {
    ...around,
    ...{ yaw: 0.3, pitch: 0.75, zoom: 1, panX: 0, panY: 0 },
  };
  const c = compileSpatialPhrase(torus(), defaultLayers, 1, phrase, [70, 65], {
    around,
    entry: wide,
  });
  const original = bare(torus());
  const plain = bare(torus());
  const calls: { direction: number; view?: unknown; views?: unknown[] }[] = [];
  const engine = {
    computeSpatial: async (
      config: SpatialConfig,
      options: { view?: unknown; views?: unknown[] } = {},
    ) => {
      calls.push({
        direction: config.surface.geodesics!.direction,
        ...options,
      });
      return bare(config);
    },
  };
  const sample = createSpatialPhraseSampler({
    phrase: c,
    original,
    plain,
    page: { width: 800, height: 600 },
  });
  // At the opening, wide and at the entry value: plain, no request.
  expect((await sample(0, engine)).frame).toBe(plain);
  expect(calls).toEqual([]);
  // Closing in: a few refinements, each to its piece's views, however
  // many frames are drawn, and none again when the same frames return.
  const times = Array.from({ length: 200 }, (_, k) => 0.02 * k);
  for (const t of times) await sample(t, engine);
  const pieces = calls.length;
  expect(pieces).toBeGreaterThan(0);
  expect(pieces).toBeLessThan(20);
  for (const call of calls) {
    expect(call.direction).toBe(65);
    expect(call.view).toBeUndefined();
    expect(call.views!.length).toBeGreaterThan(0);
    expect(call.views!.length).toBeLessThanOrEqual(16);
  }
  for (const t of times) await sample(t, engine);
  expect(calls).toHaveLength(pieces);
  // While the direction moves, zoomed in: one request per value, refined
  // to that frame's own view.
  await sample(5, engine);
  await sample(5, engine);
  expect(calls).toHaveLength(pieces + 1);
  expect(calls[pieces].direction).toBe(67.5);
  expect(calls[pieces].view).toBeDefined();
  expect(calls[pieces].views).toBeUndefined();
  // Back at the opening view and value: plain again.
  expect((await sample(8, engine)).frame).toBe(plain);
});

test("a carried arrow travels with the drawn share itself, and the whole share is the study", () => {
  const points = Array.from({ length: 11 }, (_, k) => ({ x: k, y: 0, z: 0 }));
  const tangent = { x: 1, y: 0, z: 0 };
  const result = {
    bounds: around,
    surface: {
      surface: { points: [] },
      geodesics: {
        surface: "sphere",
        length: 10,
        step: 1,
        selected: 1,
        steps: 10,
        threads: [
          {
            direction: 0,
            points,
            tangents: points.map(() => tangent),
            reason: "end",
            reached: 10,
            end: points[10],
            endTangent: tangent,
            endU: 0,
            endV: 0,
            steps: 10,
            return: { position: 0, direction: 0 },
            closes: false,
          },
        ],
        transport: {
          path: "thread",
          length: 4,
          size: 0.5,
          samples: {
            arcs: [0, 4],
            points: [],
            vectors: [],
            normals: [],
            tangents: [],
          },
          references: {
            arcs: [],
            points: [],
            vectors: [],
            normals: [],
            tangents: [],
          },
          corners: [],
          reason: "end",
          reached: 4,
          steps: 4,
          returns: false,
          holonomy: 0,
          drift: { norm: 0, tangency: 0 },
        },
      },
    },
  } as unknown as SpatialResult;
  expect(revealShare(result, 1)).toBe(result);
  const half = revealShare(result, 0.5).surface!.geodesics!;
  expect(half.transport!.shown).toBe(2);
  expect(half.threads[0].reached).toBe(5);
  expect(half.threads[0].partial).toBe(true);
});

// Through the real notebook, worker, engine, renderer and exporter.
const stage = (page: Page) => page.locator(".spatial-stage");
const settled = (page: Page) =>
  expect(stage(page)).toHaveAttribute("aria-busy", "false", {
    timeout: 60000,
  });
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const legend = (page: Page) => page.locator(".plot-meta");
// Whether the legend names the surface: a hidden layer's entry is kept but
// not shown.
const surfaceShown = (page: Page) =>
  legend(page).getByText("Surface", { exact: true }).isVisible();
async function openPanel(page: Page) {
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
}
async function openStudy(page: Page, study: unknown) {
  await page.goto(
    `/?study=3d#s=${deflateRawSync(
      Buffer.from(JSON.stringify({ v: 1, notebook: "3d", study })),
    ).toString("base64url")}`,
  );
  await settled(page);
  await openPanel(page);
}
async function playAndPause(page: Page) {
  await button(page, "Play animation").click();
  await button(page, "Pause").click({ timeout: 60000 });
  await expect(button(page, "Resume")).toBeVisible();
}
// The timeline snaps to steps of 0.001.
async function seek(page: Page, to: number) {
  const p = Math.round(to * 1000) / 1000;
  await page
    .getByRole("slider", { name: "Animation progress" })
    .fill(String(p));
  await expect(stage(page)).toHaveAttribute("data-progress", String(p), {
    timeout: 60000,
  });
  await settled(page);
}
const shownConfig = async (page: Page): Promise<SpatialConfig> =>
  JSON.parse((await stage(page).getAttribute("data-config"))!);
const shownCamera = async (page: Page) =>
  JSON.parse((await stage(page).getAttribute("data-camera"))!);
const index = (name: string) =>
  spatialPresets.findIndex((p) => p.name === name);

test("the authored film thins its fan to one thread and turns it past Clairaut's angle, through the hole", async ({
  page,
}) => {
  test.setTimeout(180000);
  const film = preset("Threads that find the hole");
  const phrase = film.flight!.phrase!;
  // Independent of the compiler: the phase ends from the preset's own
  // durations.
  const ends = phrase.phases.reduce<number[]>(
    (all, p) => [...all, (all.at(-1) ?? 0) + p.duration],
    [],
  );
  const total = ends.at(-1)!;
  expect(total).toBe(25);
  // The Clairaut constant 2.8 cos β meets R − r = 1.2 at β ≈ 64.6°: the
  // fan opens below it, and the middle thread's keys stand either side.
  const threshold = (Math.acos(1.2 / 2.8) * 180) / Math.PI;
  const opening = film.config.surface.geodesics!;
  expect(opening.direction + opening.spread / 2).toBeLessThan(threshold);
  expect(phrase.phases.map((p) => p.key).filter(Boolean)).toEqual([
    "62",
    "64.4",
    "67",
    "50",
  ]);
  expect(64.4).toBeLessThan(threshold);
  expect(67).toBeGreaterThan(threshold);
  await page.goto("/?study=3d");
  await settled(page);
  await choosePreset(page, { label: film.name });
  await settled(page);
  await openPanel(page);
  await expect(page.getByLabel("Animate", { exact: true })).toHaveValue(
    "phrase",
  );
  // Every phase eases, and Pace says so.
  await expect(page.getByLabel("Pace", { exact: true })).toHaveValue("ease");
  await playAndPause(page);
  const threads = () =>
    legend(page)
      .getByText(/^geodesic threads$/i)
      .isVisible();
  const at = async (seconds: number) => {
    await seek(page, seconds / total);
    return {
      direction: (await shownConfig(page)).surface.geodesics!.direction,
      camera: await shownCamera(page),
      threads: await threads(),
    };
  };
  const start = await at(0);
  expect(start.direction).toBe(50);
  expect([start.camera.yaw, start.camera.pitch, start.camera.zoom]).toEqual([
    film.view!.yaw,
    film.view!.pitch,
    film.view!.zoom,
  ]);
  expect(start.threads).toBe(true);
  // The fan thins to its middle thread as that phase begins. Every phase
  // end lies on the timeline's 0.001 steps.
  expect((await at(ends[0] - 0.2)).threads).toBe(true);
  expect((await at(ends[0])).threads).toBe(false);
  // Tilted into the hole, exactly the key view, before the thread moves.
  const tilted = await at(ends[1]);
  expect([tilted.camera.yaw, tilted.camera.pitch, tilted.camera.zoom]).toEqual([
    0.3, 0.95, 2.3,
  ]);
  expect(tilted.direction).toBe(50);
  // The keys, exactly at their phase ends; the view holds meanwhile.
  for (const [k, value] of [
    [2, 62],
    [3, 64.4],
    [4, 67],
  ] as const) {
    const state = await at(ends[k]);
    expect(state.direction).toBe(value);
    expect(state.camera.yaw).toBe(0.3);
  }
  // One whole eased turn about the drawing at 67°: half of it halfway.
  const turning = await at((ends[4] + ends[5]) / 2);
  expect(turning.direction).toBe(67);
  expect(turning.camera.yaw).toBeCloseTo(0.3 + Math.PI, 9);
  expect(turning.camera.pitch).toBeCloseTo(0.95, 12);
  expect((await at(ends[5])).camera.yaw).toBe(0.3);
  // Back to the opening exactly, the fan shown again.
  const end = await at(total);
  expect(end.direction).toBe(50);
  expect(end.camera).toEqual(start.camera);
  expect(end.threads).toBe(true);
  // The stage and parameter beside the timeline, never in the drawing.
  await expect(page.locator("#spatial-playback")).toContainText(
    "Back to the fan",
  );
});

test("a phrase is composed, arranged and flown through its controls, and the probe or a refused key stops it with a reason", async ({
  page,
}) => {
  test.setTimeout(180000);
  const study = presetStudy(index("Threads finding their way around a torus"));
  await openStudy(page, study);
  await page.getByLabel("Animate", { exact: true }).selectOption("phrase");
  const phases = page.locator(".phrase-phases > li");
  await expect(phases).toHaveCount(4);
  await expect(page.getByLabel("Phase 1 name", { exact: true })).toHaveValue(
    "Draw the study",
  );
  await expect(page.getByLabel("Animation camera")).toHaveCount(0);
  await expect(page.getByLabel("Duration (seconds)")).toHaveCount(0);
  // A hold after the first phase, renamed, that flies to the drawing's
  // view with a whole turn and hides the surface.
  await button(page, "Add a phase after phase 1").click();
  await expect(phases).toHaveCount(5);
  await page
    .getByLabel("Phase 2 name", { exact: true })
    .fill("Turn and recede");
  await page.getByLabel("Phase 2 duration", { exact: true }).fill("2");
  await page.getByLabel("Phase 2 camera", { exact: true }).selectOption("view");
  await page.getByLabel("Phase 2 turns", { exact: true }).fill("1");
  await page.getByLabel("Phase 2 layers: keep").click();
  await page
    .getByLabel("Phase 2 Surface patch", { exact: true })
    .selectOption("hide");
  await expect(
    page.getByLabel("Phase 2 layers: hide Surface patch"),
  ).toBeVisible();
  // Moving a phase keeps every other's settings.
  await button(page, "Move phase 2 down").click();
  await expect(page.getByLabel("Phase 3 name", { exact: true })).toHaveValue(
    "Turn and recede",
  );
  await expect(page.getByLabel("Phase 2 name", { exact: true })).toHaveValue(
    "Move the parameter",
  );
  await expect(button(page, "Move phase 3 down")).toBeFocused();
  await button(page, "Move phase 3 up").click();
  await expect(page.getByLabel("Phase 2 name", { exact: true })).toHaveValue(
    "Turn and recede",
  );
  await expect(page.getByLabel("Phase 2 turns", { exact: true })).toHaveValue(
    "1",
  );
  // Play: the starter draws, then the new phase turns once on its way to
  // the drawing's view, with the surface hidden from its start.
  const idle = JSON.parse(
    (await page.locator("#spatial-artwork").getAttribute("data-view"))!,
  );
  await playAndPause(page);
  const total = 3 + 2 + 3 + 1 + 3;
  await seek(page, 3 / total);
  await expect(legend(page).getByText("Surface", { exact: true })).toBeHidden();
  const before = await shownCamera(page);
  await seek(page, 4 / total);
  const middle = await shownCamera(page);
  // The eased progress at the time the slider stands at: half a cosine.
  const u =
    (Number(await stage(page).getAttribute("data-progress")) * total - 3) / 2;
  const eased = (1 - Math.cos(Math.PI * u)) / 2;
  await seek(page, 5 / total);
  const after = await shownCamera(page);
  // The key view is the drawing's own; halfway, the yaw has turned half a
  // turn beyond it (a whole turn over the leg, from the same view).
  expect(after.yaw).toBeCloseTo(idle.yaw, 12);
  expect(after.pitch).toBeCloseTo(idle.pitch, 12);
  expect(before.yaw).toBeCloseTo(idle.yaw, 12);
  expect(middle.yaw - before.yaw).toBeCloseTo(2 * Math.PI * eased, 9);
  await button(page, "Stop").click();
  // A refused key is reported under its own field, not as a general error.
  await page.getByLabel("Phase 3 key", { exact: true }).fill("nope");
  await button(page, "Play animation").click();
  const field = page.locator(".field", {
    has: page.getByLabel("Phase 3 key", { exact: true }),
  });
  await expect(field.locator(".field-error")).toContainText("Phase 3 key");
  await expect(page.locator(".animation-error")).toHaveCount(0);
  await page.getByLabel("Phase 3 key", { exact: true }).fill("pi/3");
  await expect(field.locator(".field-error")).toHaveCount(0);
  // The probe is not drawn by a phrase: Play says so.
  await page
    .getByRole("checkbox", { name: /at a point/ })
    .first()
    .check();
  await button(page, "Play animation").click();
  await expect(page.locator(".animation-error")).toContainText(
    "Turn the probe off to play it",
  );
});

test("an edit during preparation discards it, and the phrase round-trips through a link", async ({
  page,
}) => {
  const study = presetStudy(index("Threads that find the hole"));
  await openStudy(page, study);
  await expect(page.getByLabel("Phase 5 key", { exact: true })).toHaveValue(
    "67",
  );
  await button(page, "Play animation").click();
  await page.getByLabel("Phase 5 key", { exact: true }).fill("70");
  await expect(button(page, "Play animation")).toBeEnabled();
  await page.waitForTimeout(1000);
  await expect(stage(page)).not.toHaveAttribute("data-mode", "phrase");
  await expect(button(page, "Pause")).toHaveCount(0);
  // Played again, the edited key is the one that moves.
  await playAndPause(page);
  await seek(page, 17 / 25);
  expect((await shownConfig(page)).surface.geodesics!.direction).toBe(70);
});

for (const action of ["play", "export"] as const)
  test(`a layer edit cancels phrase ${action} while scalar preparation is pending`, async ({
    page,
  }) => {
    await openStudy(page, presetStudy(index("Threads that find the hole")));
    if (action === "export") {
      await openDetails(page, "#spatial-export-settings");
      await expect(
        page.getByRole("button", { name: /Export MP4/ }),
      ).toBeEnabled();
    }
    // Hold the actual worker requests until the layer changes, rather than
    // depending on the machine being slow enough to catch preparation.
    await page.evaluate(() => {
      const post = Worker.prototype.postMessage;
      const pending: (() => Promise<void>)[] = [];
      const gate = {
        pending,
        release: () => {
          Worker.prototype.postMessage = post;
          return Promise.all(pending.splice(0).map((send) => send()));
        },
      };
      (window as unknown as { phraseGate: typeof gate }).phraseGate = gate;
      Worker.prototype.postMessage = function (
        this: Worker,
        ...args: Parameters<Worker["postMessage"]>
      ) {
        const data = args[0] as { action: string; id: number };
        if (data.action !== "scalars") return post.apply(this, args);
        pending.push(
          () =>
            new Promise<void>((resolve) => {
              const received = (event: MessageEvent) => {
                if (event.data.id !== data.id) return;
                this.removeEventListener("message", received);
                resolve();
              };
              this.addEventListener("message", received);
              post.apply(this, args);
            }),
        );
      } as Worker["postMessage"];
    });
    const downloads: string[] = [];
    page.on("download", (file) => downloads.push(file.suggestedFilename()));
    await (
      action === "play"
        ? button(page, "Play animation")
        : page.getByRole("button", { name: /Export MP4/ })
    ).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { phraseGate: { pending: unknown[] } })
              .phraseGate.pending.length,
        ),
      )
      .toBeGreaterThan(0);
    await page
      .getByRole("checkbox", { name: "Surface patch", exact: true })
      .uncheck();
    try {
      await expect(button(page, "Play animation")).toBeEnabled();
      await expect(button(page, "Stop")).toBeDisabled();
    } finally {
      await page.evaluate(async () => {
        await (
          window as unknown as {
            phraseGate: { release: () => Promise<unknown> };
          }
        ).phraseGate.release();
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      });
    }
    await expect(stage(page)).not.toHaveAttribute("data-mode", "phrase");
    await expect(button(page, "Pause")).toHaveCount(0);
    await expect(
      page.getByRole("checkbox", { name: "Surface patch", exact: true }),
    ).not.toBeChecked();
    expect(downloads).toEqual([]);
    // The new layers belong to the next session, which must still work.
    await playAndPause(page);
    expect(await surfaceShown(page)).toBe(false);
    await button(page, "Stop").click();
  });

test("a level phrase through a curated event computes every frame at its level and reads each state from the drawn frame", async ({
  page,
}) => {
  test.setTimeout(180000);
  const i = spatialPresets.findIndex((p) => p.story === "two-drops");
  const study = presetStudy(i);
  study.config.implicit.level = 0.84;
  study.animation = {
    ...study.animation,
    mode: "phrase",
    phrase: {
      target: "level",
      opening: 1,
      phases: [
        { name: "Meet", duration: 2, pace: "steady", key: "1" },
        { name: "Touching", duration: 1, pace: "steady" },
        { name: "One drop", duration: 2, pace: "steady", key: "1.16" },
      ],
    },
  };
  await openStudy(page, study);
  await expect(page.getByLabel("Animate", { exact: true })).toHaveValue(
    "phrase",
  );
  await playAndPause(page);
  const note = page.getByTestId("implicit-note");
  const level = async (p: number) => {
    await seek(page, p);
    return (await shownConfig(page)).implicit.level;
  };
  expect(await level(0)).toBe(0.84);
  await expect(note).toContainText("two separate drops");
  // Halfway to the event, steadily.
  expect(await level(0.2)).toBeCloseTo(0.92, 12);
  // At the event and throughout the hold, exactly the critical level.
  for (const p of [0.4, 0.5, 0.59]) {
    expect(await level(p)).toBe(1);
    await expect(note).toContainText("not a manifold");
  }
  expect(await level(1)).toBe(1.16);
  await expect(note).toContainText("one drop");
  await expect(note).not.toContainText("not a manifold");
});

test("a phrase's MP4 has its exact duration and opens and ends on the frames playback shows", async ({
  page,
}) => {
  test.setTimeout(180000);
  const study = presetStudy(index("Threads finding their way around a torus"));
  study.animation = {
    ...study.animation,
    mode: "phrase",
    phrase: {
      target: "geodesicDirection",
      opening: 1,
      phases: [
        { name: "Steeper", duration: 0.2, pace: "steady", key: "75" },
        {
          name: "Face the hole",
          duration: 0.2,
          pace: "steady",
          layers: { surface: false },
          view: { yaw: 0, pitch: 0, zoom: 2.3, panX: 0, panY: 0, turns: 0 },
        },
      ],
    },
  };
  await openStudy(page, study);
  // Too short to pause: it plays through, then the timeline is scrubbed.
  await button(page, "Play animation").click();
  await expect(button(page, "Replay")).toBeVisible({ timeout: 60000 });
  const stills: Buffer[] = [];
  for (const p of [0, 1]) {
    await seek(page, p);
    stills.push(await still(page));
  }
  await button(page, "Back to study").click();
  await openDetails(page, "#spatial-export-settings");
  await page.getByLabel("Export format", { exact: true }).selectOption("mp4");
  await page.getByLabel("Export frame rate").selectOption("15");
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("2");
  // Dense thin threads: high quality keeps codec loss below the comparison.
  await page
    .getByRole("slider", { name: "Export quality", exact: true })
    .fill("100");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export MP4/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("tangent-garden-spatial-phrase.mp4");
  const path = (await file.path())!;
  const data = probe(path);
  if (data) {
    expect(data.frames).toBe(6);
    expect(data.durations.reduce((a, b) => a + b, 0)).toBe(400);
  }
  const video = await decodeVideo(page, await readFile(path));
  expect(video.duration).toBeCloseTo(0.4, 3);
  const match = (k: number, reference: Buffer) =>
    frameDifference(path, 2000, 1520, k, reference);
  const ends = [match(0, stills[0]), match(5, stills[1])];
  const crossed = [match(0, stills[1]), match(5, stills[0])];
  if (ends[0] && ends[1] && crossed[0] && crossed[1]) {
    console.log("Phrase endpoints", { ends, crossed });
    // Each end matches its own still and not the other's. Dense thin
    // threads cost H.264 more than a shaded sheet: the end frame's mean
    // difference falls as quality rises (4.7 at the default, 3.2 at 100),
    // so it is bounded against the other end's rather than absolutely.
    for (const d of ends) {
      expect(d.meanDifference).toBeLessThan(
        Math.min(...crossed.map((c) => c.meanDifference)) / 5,
      );
      expect(d.unmatchedInk).toBeLessThan(0.05);
    }
    for (const d of crossed) expect(d.unmatchedInk).toBeGreaterThan(0.3);
  }
});

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
