import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import { choosePreset, openShapeAnimation, openShapeExport } from "./helpers";
import { decodeVideo, frameDifference, probe } from "./video";
import { presetStudy } from "../web/tesseract/link";
import { objects } from "../web/tesseract/objects";
import { tesseractPresets } from "../web/tesseract/presets";
import {
  initialView,
  motions,
  type Config,
  type Result,
  type View,
} from "../web/tesseract/types";
import {
  applyTesseractTarget,
  cameraLeg,
  constantText,
  compileTesseractPhrase,
  createTesseractPhraseSampler,
  defaultTesseractPhrase,
  phrasePanes,
  tesseractPhraseAt,
  tesseractPhraseError,
  tesseractPhraseKeys,
  tesseractPhraseTargets,
  tesseractTargetValue,
  type TesseractPhrase,
} from "../web/tesseract/phrase";

const preset = (name: string) => {
  const found = tesseractPresets.find((p) => p.name === name);
  if (!found) throw new Error(`No preset ${name}`);
  return structuredClone(found.config);
};
// The five-petal flower over the base sphere, sample 0 selected.
const flower = () => preset("A flower below, a bouquet above");
const latitude = () => preset("A circle over every point");
const cube = () => preset("A cube beyond a cube");
const root = () => preset("The second time around");
const sections = () => preset("An octahedron within");

const entry = {
  view: { yaw: 0.3, pitch: 0.4, zoom: 1.5, panX: 10, panY: -20 },
  diagramView: { yaw: -0.2, pitch: 0.1, zoom: 0.8, panX: 0, panY: 5 },
};
const film = (): TesseractPhrase => ({
  target: "weave.trace",
  also: ["weave.amplitude", "xw"],
  phases: [
    { name: "Trace the flower", duration: 4, pace: "steady", key: "1" },
    {
      name: "Open the petals",
      duration: 2,
      pace: "ease",
      keys: { "weave.amplitude": "pi/5" },
    },
    {
      name: "Turn",
      duration: 4,
      pace: "steady",
      keys: { xw: "0.3 + 2*pi" },
      view: { yaw: 0.3, pitch: 0.4, zoom: 1.5, panX: 10, panY: -20, turns: 1 },
    },
    { name: "Choose another fiber", duration: 1, pace: "steady", selected: 7 },
    {
      name: "Return",
      duration: 2,
      pace: "ease",
      key: "2",
      keys: { "weave.amplitude": "pi/8", xw: "0.3" },
      view: "entry",
      companionView: {
        yaw: 1,
        pitch: -0.5,
        zoom: 2,
        panX: 0,
        panY: 0,
        turns: 0,
      },
    },
  ],
});
// The keys of film(), as Go resolves them.
const resolved = [1, Math.PI / 5, 0.3 + 2 * Math.PI, 2, Math.PI / 8, 0.3];
const compiled = () =>
  compileTesseractPhrase(flower(), film(), resolved, entry);

test("4D phrases are offered by the descriptor, for its continuous parameters only", () => {
  expect(tesseractPhraseTargets(cube())).toEqual([
    "xw",
    "yw",
    "zw",
    "xy",
    "xz",
    "yz",
    "distance",
  ]);
  expect(tesseractPhraseTargets({ ...cube(), mode: "orthographic" })).toEqual([
    "xw",
    "yw",
    "zw",
    "xy",
    "xz",
    "yz",
  ]);
  expect(tesseractPhraseTargets({ ...cube(), mode: "stereo" })).toContain(
    "clip",
  );
  // A section's slice first; its spread only when several sections share it.
  const one = sections();
  expect(tesseractPhraseTargets(one)[0]).toBe("slice");
  expect(tesseractPhraseTargets({ ...one, count: 1 })).not.toContain("spread");
  expect(tesseractPhraseTargets({ ...one, count: 3 })).toContain("spread");
  // The weave's paired views: the trace leads; the amplitude only on a
  // flower; never the petal count or the selection.
  expect(tesseractPhraseTargets(flower()).slice(0, 3)).toEqual([
    "weave.trace",
    "weave.alpha",
    "weave.amplitude",
  ]);
  expect(tesseractPhraseTargets(flower())).toContain("clip");
  expect(tesseractPhraseTargets(latitude())).not.toContain("weave.amplitude");
  const loom = objects.weave.defaults(cube());
  expect(tesseractPhraseTargets(loom)).not.toContain("weave.trace");
  expect(tesseractPhraseTargets({ ...loom, count: 1 })).not.toContain(
    "weave.spread",
  );
  expect(tesseractPhraseTargets({ ...loom, count: 3 })).toContain(
    "weave.spread",
  );
  expect(tesseractPhraseTargets(root()).slice(0, 2)).toEqual([
    "root.t",
    "root.radius",
  ]);
  for (const object of [
    "ball",
    "tube",
    "lift",
    "bypass",
    "cell24",
    "cell16",
  ] as const) {
    const c = objects[object].defaults(cube());
    expect(tesseractPhraseTargets(c), object).toEqual([]);
    expect(motions(c).map((m) => m.value)).not.toContain("phrase");
  }
  for (const c of [cube(), flower(), loom, root(), sections()])
    expect(motions(c).at(-1)!.value).toBe("phrase");
});

test("only spatial panes take camera keys; a flat diagram holds", () => {
  expect(phrasePanes(cube())).toEqual(["view"]);
  expect(phrasePanes(sections())).toEqual(["view"]);
  expect(phrasePanes(flower())).toEqual(["view", "companionView"]);
  expect(phrasePanes(objects.weave.defaults(cube()))).toEqual(["view"]);
  // The journey's lifted path turns; its source and value planes are flat.
  expect(phrasePanes(root())).toEqual(["view"]);
});

test("a 4D phrase's tracks, views and selection cuts are checked before it compiles", () => {
  const config = flower();
  expect(tesseractPhraseError(config, film())).toBeNull();
  expect(tesseractPhraseKeys(film()).map((k) => [k.phase, k.track])).toEqual([
    [0, 0],
    [1, 1],
    [2, 2],
    [4, 0],
    [4, 1],
    [4, 2],
  ]);
  const with_ = (change: (p: TesseractPhrase) => void, c = config) => {
    const p = film();
    change(p);
    return tesseractPhraseError(c, p);
  };
  expect(with_((p) => (p.also = ["weave.trace"]))).toMatch(/must be distinct/);
  expect(with_((p) => (p.target = "slice"))).toMatch(
    /consumed continuous target/,
  );
  // The petal count is whole: never a track.
  expect(with_((p) => (p.also = ["weave.petals" as never]))).toMatch(
    /consumed continuous target/,
  );
  expect(with_((p) => (p.phases[3].selected = 20))).toMatch(
    /^Phase 4 selected fiber must be a whole number from 1 to 20/,
  );
  expect(with_((p) => (p.phases[3].selected = 1.5))).toMatch(
    /^Phase 4 selected fiber/,
  );
  expect(
    with_((p) => {
      (p.phases[2].view as { pitch: number }).pitch = 2;
    }),
  ).toMatch(/^Phase 3 view is outside/);
  expect(
    with_((p) => {
      (p.phases[2].view as { turns: number }).turns = 0.5;
    }),
  ).toMatch(/^Phase 3 turns must be a whole number from −8 to 8/);
  expect(
    with_((p) => {
      (p.phases[4].companionView as { zoom: number }).zoom = 9;
    }),
  ).toMatch(/^Phase 5 view 2 is outside/);
  // A study without the selection, or without a second spatial pane,
  // refuses phases that use them.
  const loom = objects.weave.defaults(config);
  const plain: TesseractPhrase = {
    target: "xw",
    phases: [{ name: "Turn", duration: 1, pace: "steady", key: "1" }],
  };
  expect(tesseractPhraseError(loom, plain)).toBeNull();
  expect(
    tesseractPhraseError(loom, {
      ...plain,
      phases: [{ ...plain.phases[0], selected: 0 }],
    }),
  ).toMatch(/^Phase 1 selected fiber: this view has no selection/);
  expect(
    tesseractPhraseError(root(), {
      ...plain,
      phases: [{ ...plain.phases[0], companionView: "entry" }],
    }),
  ).toMatch(/^Phase 1 view 2: this view has no second camera/);
});

test("every admitted study's starter phrase is valid and returns to its start", () => {
  const admitted = tesseractPresets
    .map((p) => p.config)
    .filter((c) => tesseractPhraseTargets(c).length);
  expect(admitted.length).toBeGreaterThanOrEqual(8);
  for (const c of [...admitted, objects.weave.defaults(cube())]) {
    const p = defaultTesseractPhrase(c);
    expect(tesseractPhraseError(c, p), c.object).toBeNull();
    expect(p.target).toBe(tesseractPhraseTargets(c)[0]);
    // The last key is the study's own value, exactly.
    const last = tesseractPhraseKeys(p).at(-1)!;
    expect(last.text).toBe(constantText(tesseractTargetValue(c, p.target)));
  }
  // Exact multiples of π read as such; other values read back exactly.
  expect(constantText(Math.PI / 4)).toBe("pi/4");
  expect(constantText((3 * Math.PI) / 4)).toBe("3*pi/4");
  expect(constantText(-Math.PI)).toBe("-pi");
  expect(constantText(4 * Math.PI)).toBe("4*pi");
  expect(constantText(0.3)).toBe("0.3");
  expect(constantText(0)).toBe("0");
  expect(Number(constantText(0.1 + 0.2))).toBe(0.1 + 0.2);
});

test("compiled boundaries are exact; tracks move together within a phase", () => {
  const original = flower();
  const frozen = structuredClone(original);
  const phrase = compileTesseractPhrase(original, film(), resolved, entry);
  original.weave!.amplitude = 0.01;
  expect(phrase.config).toEqual(frozen);
  expect(phrase.duration).toBe(13);
  const at = (s: number) => tesseractPhraseAt(phrase, s);
  // The opening is the study as drawn, both views as they stand.
  expect(at(0).config).toEqual(frozen);
  expect(at(0).view).toEqual(entry.view);
  expect(at(0).companionView).toEqual(entry.diagramView);
  // Each phase end holds its keys and keeps every other track.
  expect(at(4).values).toEqual([1, Math.PI / 8, 0.3]);
  expect(at(6).values).toEqual([1, Math.PI / 5, 0.3]);
  expect(at(10).values).toEqual([1, Math.PI / 5, 0.3 + 2 * Math.PI]);
  expect(at(13).values).toEqual([2, Math.PI / 8, 0.3]);
  // Steady progress halfway through the trace, applied to the request.
  const half = at(2);
  expect(half.values[0]).toBe(0.5);
  expect(half.config.weave!.trace).toBe(0.5);
  expect(half.config.weave!.amplitude).toBe(Math.PI / 8);
  expect(half.config.angles[3]).toBe(0.3);
  expect(half.phase).toBe("Trace the flower");
  // Eased: a quarter of the way through the petals' phase.
  const eased = (1 - Math.cos(Math.PI / 4)) / 2;
  expect(at(4.5).values[1]).toBeCloseTo(
    Math.PI / 8 + (Math.PI / 5 - Math.PI / 8) * eased,
    15,
  );
  // The selection is a cut at its phase's start, never blended.
  expect(at(9.999).config.weave!.selected).toBe(0);
  expect(at(10).config.weave!.selected).toBe(7);
  expect(at(10).phase).toBe("Choose another fiber");
  expect(at(13).config.weave!.selected).toBe(7);
  expect(at(13).config.weave!.trace).toBe(2);
  // Views: held until the turn, exactly the key at its end, and exactly
  // the opening (and the second key) at the end.
  expect(at(6).view).toEqual(entry.view);
  expect(at(10).view).toEqual({
    yaw: 0.3,
    pitch: 0.4,
    zoom: 1.5,
    panX: 10,
    panY: -20,
  });
  expect(at(8).view.yaw).toBeCloseTo(0.3 + Math.PI, 12);
  expect(at(13).view).toEqual(entry.view);
  expect(at(13).companionView).toEqual({
    yaw: 1,
    pitch: -0.5,
    zoom: 2,
    panX: 0,
    panY: 0,
  });
  expect(at(10.5).companionView).toEqual(entry.diagramView);
  expect(at(12).companionView.yaw).toBeGreaterThan(-0.2);
  expect(at(12).companionView.yaw).toBeLessThan(1);
});

test("a camera leg turns the shorter way plus whole turns, zooming geometrically", () => {
  const a: View = { yaw: 3, pitch: -0.5, zoom: 0.5, panX: 0, panY: 10 };
  const b: View = { yaw: -3, pitch: 0.5, zoom: 2, panX: 20, panY: -10 };
  expect(cameraLeg(a, b, 0, 0)).toEqual(a);
  expect(cameraLeg(a, b, 0, 1)).toEqual(b);
  // From 3 to −3 the shorter way crosses π: 2π − 6 forward.
  const mid = cameraLeg(a, b, 0, 0.5);
  expect(mid.yaw).toBeCloseTo(3 + (2 * Math.PI - 6) / 2, 12);
  expect(mid.pitch).toBeCloseTo(0, 12);
  expect(mid.zoom).toBeCloseTo(1, 12);
  expect(mid.panX).toBeCloseTo(10, 12);
  expect(cameraLeg(a, b, -1, 0.5).yaw).toBeCloseTo(
    3 + (2 * Math.PI - 6 - 2 * Math.PI) / 2,
    12,
  );
  // The same view with a turn goes all the way round.
  expect(cameraLeg(a, a, 2, 0.25).yaw).toBeCloseTo(3 + Math.PI, 12);
});

test("the journey's parameter moves the point from Trace start; at its entry value the study is as drawn", () => {
  const c = root();
  expect(tesseractTargetValue(c, "root.t")).toBe(c.root!.from);
  expect(applyTesseractTarget(c, "root.t", c.root!.from)).toEqual(c);
  const moved = applyTesseractTarget(c, "root.t", 3);
  expect(moved.root).toEqual({ ...c.root, to: 3, trace: 1 });
  expect(tesseractTargetValue(moved, "root.t")).toBe(3);
  const turned = applyTesseractTarget(c, "yw", 0.4);
  expect(turned.angles).toEqual([...c.angles.slice(0, 4), 0.4, c.angles[5]]);
  expect(c.angles[4]).not.toBe(0.4);
});

const fakeResult = (config: Config): Result =>
  ({
    paths: [],
    object: config.object,
    operation: config.mode,
    emittedPoints: 0,
    evaluations: 0,
    faces: [],
    points: [],
    sections: [],
    clipped: 0,
    radius: 1,
  }) as Result;
test("the sampler asks once per distinct state per engine; holds and repeated states ask nothing", async () => {
  const phrase = compiled();
  const original = { config: flower(), result: fakeResult(flower()) };
  const sample = createTesseractPhraseSampler({ phrase, original });
  const asked: Config[][] = [[], []];
  const engines = asked.map((log) => ({
    tesseract: async (c: Config) => {
      log.push(c);
      return fakeResult(c);
    },
  }));
  // The opening is the study's own result, without a request.
  const first = await sample(0, engines[0]);
  expect(first.result).toBe(original.result);
  expect(first.view).toEqual(entry.view);
  expect(asked[0]).toHaveLength(0);
  await sample(2, engines[0]);
  await sample(2, engines[0]);
  expect(asked[0]).toHaveLength(1);
  // Each engine keeps its own latest geometry.
  await sample(2, engines[1]);
  expect(asked[1]).toHaveLength(1);
  // The end of the petals and the start of the turn are the same state.
  await sample(6, engines[0]);
  await sample(6, engines[0]);
  expect(asked[0]).toHaveLength(2);
  const at = await sample(8, engines[0]);
  expect(at.view.yaw).toBeCloseTo(0.3 + Math.PI, 12);
  expect(at.tracks.map((t) => t.label)).toEqual([
    "Trace (turns)",
    "Flower amplitude A",
    "xw angle",
  ]);
  expect(at.phase).toBe("Turn");
  // A cut to another fiber is new geometry; holding it is not.
  await sample(10.2, engines[0]);
  await sample(10.8, engines[0]);
  expect(asked[0]).toHaveLength(4);
  expect(asked[0][3].weave!.selected).toBe(7);
});

test("a cut alone, every value held, is new geometry; holding the opening is not", async () => {
  const phrase = compileTesseractPhrase(
    flower(),
    {
      target: "weave.trace",
      phases: [
        { name: "Hold", duration: 1, pace: "steady" },
        { name: "Cut", duration: 1, pace: "steady", selected: 4 },
      ],
    },
    [],
    entry,
  );
  const original = { config: flower(), result: fakeResult(flower()) };
  const sample = createTesseractPhraseSampler({ phrase, original });
  const asked: Config[] = [];
  const engine = {
    tesseract: async (c: Config) => {
      asked.push(c);
      return fakeResult(c);
    },
  };
  expect((await sample(0.5, engine)).result).toBe(original.result);
  expect(asked).toHaveLength(0);
  const cut = await sample(1.5, engine);
  expect(asked).toHaveLength(1);
  expect(cut.result).not.toBe(original.result);
  expect(cut.config.weave!.selected).toBe(4);
  expect(asked[0].weave!.selected).toBe(4);
  expect(asked[0].weave!.trace ?? 0).toBe(0);
});

test("views a phrase never moves stay as entered", () => {
  const phrase = compileTesseractPhrase(
    root(),
    {
      target: "root.t",
      phases: [{ name: "Go", duration: 2, pace: "steady", key: "4*pi" }],
    },
    [4 * Math.PI],
    { view: initialView, diagramView: entry.diagramView },
  );
  const end = tesseractPhraseAt(phrase, 2);
  expect(end.companionView).toEqual(entry.diagramView);
  // A phase that keys no view holds the opening view's own object.
  expect(tesseractPhraseAt(phrase, 1).view).toBe(end.view);
  expect(end.view).toEqual(initialView);
  expect(end.config.root!.to).toBe(4 * Math.PI);
});

// Through the real notebook, worker, engine and exporter.
const stage = (page: Page) => page.locator(".tesseract-stage");
const settled = (page: Page) =>
  expect(stage(page)).toHaveAttribute("aria-busy", "false");
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const shownConfig = async (page: Page): Promise<Config> =>
  JSON.parse((await stage(page).getAttribute("data-config"))!);
// Each pane's view as drawn, by its operation.
async function shownViews(page: Page): Promise<Record<string, View>> {
  const desc = JSON.parse(
    (await page.locator("#tesseract-artwork > desc").textContent())!,
  );
  return desc.views
    ? Object.fromEntries(
        desc.views.map((v: { operation: string; view: View }) => [
          v.operation,
          v.view,
        ]),
      )
    : { [desc.operation]: desc.view };
}
async function seek(page: Page, progress: number) {
  const time = String(Math.round(progress * 1000) / 1000);
  await page.getByRole("slider", { name: "Animation progress" }).fill(time);
  await expect(stage(page)).toHaveAttribute("data-time", time);
  await settled(page);
}
async function openStudy(page: Page, study: unknown) {
  await page.goto(
    `/?study=4d#s=${deflateRawSync(
      Buffer.from(JSON.stringify({ v: 1, notebook: "4d", study })),
    ).toString("base64url")}`,
  );
  await expect(page).not.toHaveURL(/#s=/);
  await settled(page);
  await openShapeAnimation(page);
}
const studyOf = (name: string, extra: object = {}) => ({
  ...presetStudy(tesseractPresets.findIndex((p) => p.name === name)),
  ...extra,
});
async function playAndPause(page: Page) {
  await button(page, "Play animation").click();
  await button(page, "Pause").click();
  await settled(page);
}

test("the authored film traces, opens, turns and closes its bouquet, exactly at every phase end", async ({
  page,
}) => {
  test.setTimeout(180000);
  const film = tesseractPresets.find(
    (p) => p.name === "A bouquet answers its path",
  )!;
  // Independent of the compiler: the phase ends from the preset's own
  // durations, each on the timeline's 0.001 steps.
  const ends = film.phrase!.phases.reduce<number[]>(
    (all, p) => [...all, (all.at(-1) ?? 0) + p.duration],
    [],
  );
  expect(ends).toEqual([6, 9, 17, 20]);
  const total = 20;
  await page.goto("/?study=4d");
  await settled(page);
  await choosePreset(page, { label: film.name });
  await settled(page);
  await openShapeAnimation(page);
  await expect(page.getByLabel("Animate", { exact: true })).toHaveValue(
    "phrase",
  );
  // The phrase replaces duration and pace; the 4D phrase reveals nothing,
  // and each spatial pane has its camera.
  const panel = page.locator("#shape-animation-section");
  await expect(panel.getByLabel("Duration (seconds)")).toHaveCount(0);
  await expect(panel.getByLabel("Pace", { exact: true })).toHaveCount(0);
  await expect(panel.getByLabel("Phase 1 reveal")).toHaveCount(0);
  await expect(page.locator(".phrase-phases > li")).toHaveCount(4);
  await expect(panel.getByLabel("Phase 1 camera", { exact: true })).toHaveValue(
    "hold",
  );
  await expect(panel.getByLabel("Phase 3 camera", { exact: true })).toHaveValue(
    "view",
  );
  await expect(panel.getByLabel("Phase 3 turns", { exact: true })).toHaveValue(
    "1",
  );
  await expect(
    panel.getByLabel("Phase 1 camera 2", { exact: true }),
  ).toHaveValue("hold");
  await expect(
    panel.getByLabel("Phase 1 selected fiber", { exact: true }),
  ).toHaveValue("keep");
  await expect(page.getByLabel("Repeat", { exact: true })).toHaveValue("loop");
  // Another motion has its duration and pace again, and the phrase returns.
  await page.getByLabel("Animate", { exact: true }).selectOption("trace");
  await expect(panel.getByLabel("Duration (seconds)")).toBeVisible();
  await expect(panel.getByLabel("Pace", { exact: true })).toBeVisible();
  await expect(page.locator(".phrase-phases")).toHaveCount(0);
  await page.getByLabel("Animate", { exact: true }).selectOption("phrase");
  await expect(page.locator(".phrase-phases > li")).toHaveCount(4);
  // Loop passes Play's check: the end is the opening drawing.
  await playAndPause(page);
  await expect(panel.locator(".animation-error")).toHaveCount(0);
  const opening = film.config;
  const at = async (seconds: number) => {
    await seek(page, seconds / total);
    return { config: await shownConfig(page), views: await shownViews(page) };
  };
  const start = await at(0);
  expect(start.config).toEqual(opening);
  expect(start.views).toEqual({ base: initialView, stereo: initialView });
  // The trace's one steady turn: halfway is half a turn from fiber 1.
  const half = await at(3);
  expect(half.config.weave!.trace).toBe(0.5);
  expect(half.config.weave!.amplitude).toBe(opening.weave!.amplitude);
  const traced = await at(ends[0]);
  expect(traced.config.weave!.trace).toBe(1);
  expect(traced.config.weave!.amplitude).toBe(Math.PI / 7);
  // Open: pi/5, exactly as Go resolves it.
  const open = await at(ends[1]);
  expect(open.config.weave!.amplitude).toBe(Math.PI / 5);
  expect(open.config.angles[3]).toBe(0.3);
  expect(open.views.stereo).toEqual(initialView);
  // Halfway through the eased turn: half a turn of xw and of the fibers'
  // camera, while the base sphere's view stands still.
  const turning = await at((ends[1] + ends[2]) / 2);
  expect(turning.config.angles[3]).toBeCloseTo(0.3 + Math.PI, 12);
  expect(turning.views.stereo.yaw).toBeCloseTo(initialView.yaw + Math.PI, 12);
  expect(turning.views.stereo.pitch).toBe(initialView.pitch);
  expect(turning.views.base).toEqual(initialView);
  const turned = await at(ends[2]);
  expect(turned.config.angles[3]).toBe(0.3 + 2 * Math.PI);
  expect(turned.views.stereo).toEqual(initialView);
  const end = await at(total);
  expect(end.config.weave!.amplitude).toBe(Math.PI / 7);
  expect(end.config.weave!.trace).toBe(1);
  expect(end.config.weave!.selected).toBe(14);
  // The stage and values beside the timeline, never in the drawing.
  await expect(page.locator("#shape-playback .phrase-stage")).toContainText(
    "Close the petals · Trace (turns) =",
  );
  await expect(page.locator("#tesseract-artwork text")).toHaveCount(0);
});

test("Stop restores the study and both views, and an edit while paused returns to the study", async ({
  page,
}) => {
  await openStudy(page, studyOf("A bouquet answers its path"));
  await playAndPause(page);
  await seek(page, 0.65);
  expect((await shownViews(page)).stereo).not.toEqual(initialView);
  // The phrase owns the views until it ends: dragging leaves them.
  const views = await shownViews(page);
  const art = page.locator("#tesseract-artwork");
  const box = (await art.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.85, box.y + box.height / 2);
  await page.mouse.up();
  expect(await shownViews(page)).toEqual(views);
  await page
    .locator("#shape-playback")
    .getByRole("button", { name: "Stop", exact: true })
    .click();
  await settled(page);
  const film = studyOf("A bouquet answers its path");
  expect(await shownConfig(page)).toEqual(film.config);
  expect(await shownViews(page)).toEqual({
    base: initialView,
    stereo: initialView,
  });
  await playAndPause(page);
  await seek(page, 0.5);
  await page.getByLabel("Phase 1 key", { exact: true }).fill("2");
  await expect(page.locator(".tesseract-playback.active")).toHaveCount(0);
  await settled(page);
  expect(await shownConfig(page)).toEqual(film.config);
  // Played again, the edited key is the one that moves.
  await playAndPause(page);
  await seek(page, 0.3);
  expect((await shownConfig(page)).weave!.trace).toBe(2);
});

test("a refused or unresolved key stops Play under the field that caused it", async ({
  page,
}) => {
  await openStudy(page, studyOf("A bouquet answers its path"));
  // α₀ ± A must stay within 0 and π/2: an amplitude of π/2 is refused at
  // the end of the phase that reaches it, not mid-film.
  await page.getByLabel("Phase 2 key 2", { exact: true }).fill("pi/2");
  await button(page, "Play animation").click();
  const field = page
    .locator(".field")
    .filter({ has: page.getByLabel("Phase 2 key 2", { exact: true }) });
  await expect(field).toContainText(/amplitude/i);
  await expect(page.locator(".tesseract-playback.active")).toHaveCount(0);
  // With two values moving together, the one at fault is named.
  await page.getByLabel("Phase 2 key 2", { exact: true }).fill("pi/5");
  await page.getByLabel("Phase 2 key", { exact: true }).fill("2");
  await page.getByLabel("Phase 2 key 3", { exact: true }).fill("1");
  await page.getByLabel("Phase 2 key 2", { exact: true }).fill("pi/2");
  await button(page, "Play animation").click();
  await expect(field).toContainText(/amplitude/i);
  await page.getByLabel("Phase 2 key 2", { exact: true }).fill("pi/5");
  await page.getByLabel("Phase 1 key", { exact: true }).fill("1 +");
  await button(page, "Play animation").click();
  await expect(
    page
      .locator(".field")
      .filter({ has: page.getByLabel("Phase 1 key", { exact: true }) }),
  ).toContainText(/Phase 1 key/);
  await page.getByLabel("Phase 1 key", { exact: true }).fill("1");
  await playAndPause(page);
  await expect(page.locator(".tesseract-playback.active")).toHaveCount(1);
});

test("a selection cut happens exactly at its phase start; the journey's flat planes hold while its lifted view turns", async ({
  page,
}) => {
  const key = { yaw: 1.2, pitch: -0.4, zoom: 2, panX: 30, panY: -10 };
  await openStudy(
    page,
    studyOf("A circle over every point", {
      motion: "phrase",
      repeat: "once",
      phrase: {
        target: "weave.trace",
        phases: [
          { name: "Half", duration: 1, pace: "steady", key: "0.5" },
          { name: "Cut", duration: 1, pace: "steady", selected: 5 },
        ],
      },
    }),
  );
  await playAndPause(page);
  await seek(page, 0.499);
  expect((await shownConfig(page)).weave!.selected ?? 0).toBe(0);
  await seek(page, 0.5);
  const cut = await shownConfig(page);
  expect(cut.weave!.selected).toBe(5);
  expect(cut.weave!.trace).toBe(0.5);
  // The base sphere's correspondence follows the selection it draws.
  const desc = JSON.parse(
    (await page.locator("#tesseract-artwork > desc").textContent())!,
  );
  expect(
    desc.views.find((v: { operation: string }) => v.operation === "base")
      .markers.length,
  ).toBeGreaterThan(0);
  const journey = studyOf("The second time around");
  const diagram = { yaw: 0.1, pitch: 0.2, zoom: 1.5, panX: 40, panY: 0 };
  await openStudy(page, {
    ...journey,
    diagramView: diagram,
    repeat: "once",
    phrase: {
      target: "root.t",
      phases: [
        {
          name: "Twice around",
          duration: 2,
          pace: "steady",
          key: "4*pi",
          view: { ...key, turns: 1 },
        },
      ],
    },
    motion: "phrase",
  });
  // Its flat panes take no camera key.
  await expect(page.getByLabel("Phase 1 camera 2")).toHaveCount(0);
  await playAndPause(page);
  await seek(page, 0.5);
  const middle = await shownConfig(page);
  expect(middle.root).toEqual({
    ...journey.config.root,
    to: 2 * Math.PI,
    trace: 1,
  });
  const views = await shownViews(page);
  expect(views.diagram).toEqual(diagram);
  expect(views.orthographic.zoom).toBeCloseTo(Math.sqrt(2), 12);
  await seek(page, 1);
  const end = await shownViews(page);
  expect(end.orthographic).toEqual(key);
  expect(end.diagram).toEqual(diagram);
  expect((await shownConfig(page)).root!.to).toBe(4 * Math.PI);
});

test("a phrase round-trips through a link, old links keep their motion, and a bad phrase is refused by name", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openStudy(page, studyOf("A bouquet answers its path"));
  await page
    .getByLabel("Phase 4 selected fiber", { exact: true })
    .selectOption({ value: "3" });
  await page
    .getByLabel("Phase 1 camera 2", { exact: true })
    .selectOption("view");
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  await page.goto("about:blank");
  await page.goto(url.replace(/^https?:\/\/[^/]+/, ""));
  await settled(page);
  await openShapeAnimation(page);
  await expect(page.getByLabel("Animate", { exact: true })).toHaveValue(
    "phrase",
  );
  await expect(
    page.getByLabel("Phase 4 selected fiber", { exact: true }),
  ).toHaveValue("3");
  await expect(
    page.getByLabel("Phase 1 camera 2", { exact: true }),
  ).toHaveValue("view");
  await expect(page.getByLabel("Phase 3 key 3", { exact: true })).toHaveValue(
    "0.3 + 2*pi",
  );
  // A link from before phrases opens its own motion.
  const old = studyOf("A flower below, a bouquet above");
  await openStudy(page, old);
  await expect(page.getByLabel("Animate", { exact: true })).toHaveValue(
    "trace",
  );
  const refused = async (study: object, text: RegExp) => {
    await page.goto(
      `/?study=4d#s=${deflateRawSync(
        Buffer.from(JSON.stringify({ v: 1, notebook: "4d", study })),
      ).toString("base64url")}`,
    );
    await expect(page.getByRole("alert").first()).toContainText(text);
  };
  await refused({ ...old, motion: "phrase" }, /needs phase settings/);
  await refused(
    {
      ...old,
      motion: "phrase",
      phrase: {
        target: "slice",
        phases: [{ name: "Slice", duration: 1, pace: "steady", key: "1" }],
      },
    },
    /phrase\.target/,
  );
  await refused(
    {
      ...old,
      motion: "phrase",
      phrase: {
        target: "weave.trace",
        phases: [
          {
            name: "Far",
            duration: 1,
            pace: "steady",
            view: { ...initialView, zoom: 20, turns: 0 },
          },
        ],
      },
    },
    /phrase\.phases\[0\]\.view\.zoom/,
  );
  await refused(
    {
      ...studyOf("A cube beyond a cube"),
      motion: "phrase",
      phrase: {
        target: "xw",
        phases: [{ name: "Cut", duration: 1, pace: "steady", selected: 1 }],
      },
    },
    /no selection/,
  );
});

test("scrubbing a phrase keeps redrawing without making a control blink", async ({
  page,
}) => {
  await openStudy(page, studyOf("A bouquet answers its path"));
  await playAndPause(page);
  const { shown, flickered, found } = await page.evaluate(async () => {
    const slider = document.querySelector(
      'input[aria-label="Animation progress"]',
    ) as HTMLInputElement;
    const stage = document.querySelector(".tesseract-stage")!;
    const seen = new Set<string | null>();
    const buttons = [...document.querySelectorAll("button")].filter(
      (b) => b.closest("header") || b.closest("#shape-playback"),
    );
    const states = new Map(buttons.map((b) => [b, b.disabled]));
    let flickered = 0;
    const look = () => {
      seen.add(stage.getAttribute("data-config"));
      for (const b of buttons)
        if (b.disabled !== states.get(b)) {
          flickered++;
          states.set(b, b.disabled);
        }
      if (stage.querySelector(".computing")) flickered++;
    };
    const watch = new MutationObserver(look);
    watch.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ["data-config", "disabled"],
    });
    const set = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    for (let i = 0; i < 120; i++) {
      set.call(slider, (0.5 + 0.45 * Math.sin(i / 8)).toFixed(3));
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 16));
    }
    watch.disconnect();
    return { shown: seen.size, flickered, found: buttons.length };
  });
  expect(found).toBeGreaterThan(3);
  expect(shown).toBeGreaterThan(10);
  expect(flickered).toBe(0);
});

test("a phrase's MP4 has its exact duration and opens and ends on the frames playback shows", async ({
  page,
}) => {
  test.setTimeout(180000);
  await openStudy(
    page,
    studyOf("A cube beyond a cube", {
      motion: "phrase",
      repeat: "once",
      phrase: {
        target: "xw",
        phases: [
          { name: "Turn", duration: 0.2, pace: "steady", key: "pi/3" },
          {
            name: "Look down",
            duration: 0.2,
            pace: "steady",
            view: { yaw: 0, pitch: 1.4, zoom: 1.3, panX: 0, panY: 0, turns: 0 },
          },
        ],
      },
    }),
  );
  await button(page, "Play animation").click();
  await expect(button(page, "Replay")).toBeVisible({ timeout: 60000 });
  const stills: Buffer[] = [];
  for (const p of [0, 1]) {
    await seek(page, p);
    stills.push(await still(page));
  }
  await button(page, "Back to study").click();
  await openShapeExport(page);
  await page.getByLabel("Export format", { exact: true }).selectOption("mp4");
  await page.getByLabel("Export frame rate").selectOption("15");
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("2");
  await page
    .getByRole("slider", { name: "Export quality", exact: true })
    .fill("100");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export MP4/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("tangent-garden-tesseract.mp4");
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
    console.log("4D phrase endpoints", { ends, crossed });
    // Each end matches its own still and not the other's. A sparse wire
    // drawing differs little anywhere, so the ink is the sharp criterion
    // (0 and 0.0002 unmatched, against 0.95 crossed); the opening I-frame's
    // mean difference measured 0.96 against 4.2 crossed.
    for (const d of ends) {
      expect(d.meanDifference).toBeLessThan(
        Math.min(...crossed.map((c) => c.meanDifference)) / 3,
      );
      expect(d.unmatchedInk).toBeLessThan(0.05);
    }
    for (const d of crossed) expect(d.unmatchedInk).toBeGreaterThan(0.3);
  }
});

async function still(page: Page) {
  await page.getByRole("button", { name: "Export image" }).click();
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

// Holds the worker's scalar requests until released, so an edit is sure
// to land while a phrase's keys are being resolved.
async function gateScalars(page: Page) {
  await page.evaluate(() => {
    const post = Worker.prototype.postMessage;
    const pending: (() => void)[] = [];
    (window as unknown as { gate: object }).gate = {
      pending,
      release: () => {
        Worker.prototype.postMessage = post;
        pending.splice(0).forEach((send) => send());
      },
    };
    Worker.prototype.postMessage = function (
      this: Worker,
      ...args: Parameters<Worker["postMessage"]>
    ) {
      const data = args[0] as { action: string };
      if (data.action !== "scalars") return post.apply(this, args);
      pending.push(() => post.apply(this, args));
    } as Worker["postMessage"];
  });
}
const gated = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { gate: { pending: unknown[] } }).gate.pending
        .length,
  );
const release = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { gate: { release: () => void } }).gate.release(),
  );

test("an edit while Play resolves the keys discards that preparation; the next Play uses the edit", async ({
  page,
}) => {
  await openStudy(page, studyOf("A bouquet answers its path"));
  await gateScalars(page);
  await button(page, "Play animation").click();
  await expect.poll(() => gated(page)).toBeGreaterThan(0);
  await page.getByLabel("Phase 1 key", { exact: true }).fill("2");
  await release(page);
  await page.waitForTimeout(500);
  await expect(button(page, "Pause")).toHaveCount(0);
  await expect(page.locator(".tesseract-playback.active")).toHaveCount(0);
  await playAndPause(page);
  await seek(page, 0.3);
  expect((await shownConfig(page)).weave!.trace).toBe(2);
});

test("a layer change while an export resolves the keys cancels it without a file", async ({
  page,
}) => {
  await openStudy(page, studyOf("A bouquet answers its path"));
  await openShapeExport(page);
  const exportButton = page.getByRole("button", { name: /Export (MP4|WebP)/ });
  await expect(exportButton).toBeEnabled();
  const downloads: string[] = [];
  page.on("download", (file) => downloads.push(file.suggestedFilename()));
  await gateScalars(page);
  await exportButton.click();
  await expect.poll(() => gated(page)).toBeGreaterThan(0);
  await page
    .getByRole("checkbox", { name: "Sphere and window guides", exact: true })
    .uncheck();
  await release(page);
  await expect(exportButton).toBeEnabled();
  await page.waitForTimeout(1000);
  expect(downloads).toEqual([]);
  await expect(
    page.locator("#shape-animation-section .animation-error"),
  ).toHaveCount(0);
});
