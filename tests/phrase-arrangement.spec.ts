import { test, expect, type Page } from "@playwright/test";
import {
  openAnimation,
  openExportSettings,
  choosePreset,
  exportImage,
} from "./helpers";
import { decodeVideo, probe, frameDifference } from "./video";
import { decodePng } from "./png";
import { readFile } from "node:fs/promises";
import { watchEngines } from "./engines";
import { presets } from "../web/presets";
import {
  addPhraseTrack,
  compilePhrase,
  createPhraseSampler,
  defaultPhrase,
  insertPhase,
  maxPhases,
  maxPhraseTracks,
  movePhase,
  phaseRevealChoice,
  phraseAt,
  phraseError,
  phraseKeys,
  phraseTrackTargets,
  removePhase,
  removePhraseTrack,
  retargetPhraseTrack,
  setPhaseKey,
  withPhaseReveal,
  type Phrase,
} from "../web/phrase";

// A circular mirror with a lamp at (1, 0): its x and y are two scalars of
// one study.
const config = () => structuredClone(presets[2].config);
const layers = {
  base: true,
  derived: true,
  lines: true,
  definitionGuides: true,
  rollingGuides: true,
  incident: true,
  virtual: true,
  axes: false,
};
const two = (): Phrase => ({
  target: "sourceX",
  also: ["sourceY"],
  opening: { base: 1, construction: 1, derived: 1 },
  phases: [
    {
      name: "Both",
      duration: 2,
      pace: "steady",
      key: "0.5",
      keys: { sourceY: "0.25" },
    },
    { name: "Hold", duration: 1, pace: "steady" },
    { name: "Only y", duration: 2, pace: "steady", keys: { sourceY: "-0.5" } },
    { name: "Only x", duration: 4, pace: "ease", key: "1" },
  ],
});

test("simultaneous tracks own one scalar each, share phase ends and hold independently at any seek", () => {
  const draft = two();
  expect(phraseTrackTargets(draft)).toEqual(["sourceX", "sourceY"]);
  // Keys in phase order, and within a phase in track order.
  expect(phraseKeys(draft)).toEqual([
    { phase: 0, track: 0, text: "0.5" },
    { phase: 0, track: 1, text: "0.25" },
    { phase: 2, track: 1, text: "-0.5" },
    { phase: 3, track: 0, text: "1" },
  ]);
  const phrase = compilePhrase(
    config(),
    layers,
    0.8,
    draft,
    [0.5, 0.25, -0.5, 1],
  );
  expect(phrase.duration).toBe(9);
  // Independent expectation: each coordinate's own piecewise-linear route,
  // with the last phase eased on a half cosine.
  const ease = (u: number) => (1 - Math.cos(Math.PI * u)) / 2;
  const x = (s: number) =>
    s <= 2 ? 1 - 0.25 * s : s <= 5 ? 0.5 : 0.5 + 0.5 * ease((s - 5) / 4);
  const y = (s: number) =>
    s <= 2 ? 0.125 * s : s <= 3 ? 0.25 : s <= 5 ? 0.25 - 0.375 * (s - 3) : -0.5;
  // Forward, backward and repeated seeks: no history contributes.
  for (const s of [0, 9, 1, 2, 2.5, 3, 4, 5, 6, 7, 9, 4, 0.5, 8.25, 3, 0]) {
    const at = phraseAt(phrase, s);
    expect(at.config.source.position.x).toBeCloseTo(x(s), 14);
    expect(at.config.source.position.y).toBeCloseTo(y(s), 14);
    expect(at.values).toEqual([
      at.config.source.position.x,
      at.config.source.position.y,
    ]);
    expect(at.value).toBe(at.values[0]);
  }
  // Holds and boundaries return stored endpoints exactly.
  for (const s of [2, 2.3, 3])
    expect(phraseAt(phrase, s).values).toEqual([0.5, 0.25]);
  for (const s of [3.7, 5]) expect(phraseAt(phrase, s).values[0]).toBe(0.5);
  for (const s of [5, 6.1, 9]) expect(phraseAt(phrase, s).values[1]).toBe(-0.5);
  expect(phraseAt(phrase, 9).values).toEqual([1, -0.5]);
  expect(phraseAt(phrase, 0).values).toEqual([1, 0]);
});

test("a single-parameter phrase compiles as before and records no further tracks", () => {
  const draft = defaultPhrase(config(), 0.8, "sourceX", layers);
  expect(draft.also).toBeUndefined();
  expect(phraseTrackTargets(draft)).toEqual(["sourceX"]);
  const keys = phraseKeys(draft);
  expect(keys.every((k) => k.track === 0)).toBe(true);
  const phrase = compilePhrase(
    config(),
    layers,
    0.8,
    draft,
    keys.map((k) => Number(k.text)),
  );
  const at = phraseAt(phrase, phrase.duration / 2);
  expect(at.values).toEqual([at.value]);
});

test("conflicting, unavailable and excess tracks and stray or blank keys are refused", () => {
  const error = (change: (p: Phrase) => void) => {
    const p = two();
    change(p);
    return phraseError(config(), p);
  };
  expect(error(() => {})).toBeNull();
  expect(error((p) => (p.also = ["sourceX"]))).toMatch(/distinct/);
  expect(error((p) => (p.also = ["sourceY", "sourceY"]))).toMatch(/distinct/);
  expect(error((p) => (p.also = ["lines"]))).toMatch(/consumed continuous/);
  // The circle does not consume a.
  expect(error((p) => (p.also = ["a"]))).toMatch(/consumed continuous/);
  expect(maxPhraseTracks).toBe(3);
  expect(error((p) => (p.also = ["sourceY", "min", "max"]))).toMatch(
    /at most 3 parameters/,
  );
  expect(error((p) => (p.also = ["sourceY", "min"]))).toBeNull();
  expect(error((p) => (p.phases[0].keys = { min: "0" }))).toMatch(
    /Phase 1 .*not one of the phrase's further parameters/,
  );
  // The first parameter's key belongs in key, not keys.
  expect(error((p) => (p.phases[0].keys = { sourceX: "0" }))).toMatch(
    /Phase 1 .*not one of the phrase's further parameters/,
  );
  expect(error((p) => (p.phases[2].keys = { sourceY: " " }))).toMatch(
    /^Phase 3 key 2 must be a finite constant/,
  );
  expect(error((p) => (p.phases[0].key = ""))).toMatch(
    /^Phase 1 key must be a finite constant/,
  );
  // Compilation needs one resolved number per key, and refuses a draft in error.
  expect(() =>
    compilePhrase(config(), layers, 0.8, two(), [0.5, 0.25]),
  ).toThrow(/key/);
  const bad = two();
  bad.also = ["sourceX"];
  expect(() =>
    compilePhrase(config(), layers, 0.8, bad, [0.5, 0.25, -0.5, 1]),
  ).toThrow(/distinct/);
});

test("ray length keeps its range on whichever track carries it", () => {
  const draft = two();
  draft.also = ["rayLength"];
  draft.phases[0].keys = { rayLength: "200" };
  delete draft.phases[2].keys;
  expect(phraseError(config(), draft)).toBeNull();
  expect(() =>
    compilePhrase(config(), layers, 0.8, draft, [0.5, 200, 1]),
  ).toThrow(/^Phase 1 key 2: Ray length keys must be 0.01–100/);
  const phrase = compilePhrase(config(), layers, 0.8, draft, [0.5, 2, 1]);
  expect(phraseAt(phrase, 1).length).toBeCloseTo(1.4, 14);
  expect(phraseAt(phrase, 1).config.source.position.x).toBe(0.75);
});

test("phases are added, removed and moved within the limits, leaving the others untouched", () => {
  const draft = two();
  const names = (p: Phrase) => p.phases.map((q) => q.name);
  const added = insertPhase(draft, 2);
  expect(names(added)).toEqual(["Both", "Hold", "Only y", "Hold", "Only x"]);
  // A new phase holds every track, the view and the reveal for a second,
  // at its neighbor's pace.
  expect(added.phases[3]).toEqual({
    name: "Hold",
    duration: 1,
    pace: "steady",
  });
  expect(insertPhase(draft, 3).phases[4].pace).toBe("ease");
  expect([0, 1, 2, 4].map((i) => added.phases[i])).toEqual(draft.phases);
  expect(draft).toEqual(two());
  const moved = movePhase(draft, 3, 0);
  expect(names(moved)).toEqual(["Only x", "Both", "Hold", "Only y"]);
  expect(moved.phases[0]).toBe(draft.phases[3]);
  expect(names(movePhase(draft, 0, 2))).toEqual([
    "Hold",
    "Only y",
    "Both",
    "Only x",
  ]);
  for (const [from, to] of [
    [0, -1],
    [3, 4],
    [5, 0],
    [1, 1],
  ])
    expect(movePhase(draft, from, to)).toBe(draft);
  expect(names(removePhase(draft, 1))).toEqual(["Both", "Only y", "Only x"]);
  // Reordering changes the compiled route deterministically: keys are
  // absolute end values and holds carry what precedes them.
  const reordered = compilePhrase(
    config(),
    layers,
    0.8,
    moved,
    phraseKeys(moved).map((k) => Number(k.text)),
  );
  expect(phraseAt(reordered, 4).values).toEqual([1, 0]);
  expect(phraseAt(reordered, 6).values).toEqual([0.5, 0.25]);
  expect(phraseAt(reordered, 9).values).toEqual([0.5, -0.5]);
  // The last phase stays, and a full phrase takes no more.
  let one = draft;
  for (let i = 0; i < 3; i++) one = removePhase(one, 0);
  expect(names(one)).toEqual(["Only x"]);
  expect(removePhase(one, 0)).toBe(one);
  let full = draft;
  while (full.phases.length < maxPhases) full = insertPhase(full, 0);
  expect(full.phases).toHaveLength(12);
  expect(insertPhase(full, 0)).toBe(full);
  expect(phraseError(config(), full)).toBeNull();
});

test("tracks are added, removed and retargeted without touching the other tracks' keys", () => {
  const single = defaultPhrase(config(), 0.8, "sourceX", layers);
  const added = addPhraseTrack(single, "sourceY");
  expect(added.also).toEqual(["sourceY"]);
  // A new track holds through every phase until given end values.
  expect(added.phases).toEqual(single.phases);
  expect(addPhraseTrack(added, "sourceY")).toBe(added);
  expect(addPhraseTrack(added, "sourceX")).toBe(added);
  const three = addPhraseTrack(added, "min");
  expect(addPhraseTrack(three, "max")).toBe(three);
  const keyed = setPhaseKey(setPhaseKey(three, 3, 1, "0.2"), 3, 2, "pi/8");
  expect(keyed.phases[3].keys).toEqual({ sourceY: "0.2", min: "pi/8" });
  expect(keyed.phases[3].key).toBe(single.phases[3].key);
  // An empty value holds; the last key leaves no empty record behind.
  const cleared = setPhaseKey(setPhaseKey(keyed, 3, 1, ""), 3, 2, "  ");
  expect(cleared.phases[3]).toEqual(single.phases[3]);
  expect(setPhaseKey(keyed, 3, 0, "").phases[3].key).toBeUndefined();
  // Removing a track removes its keys alone; removing the last leaves a
  // single-parameter phrase exactly.
  const without = removePhraseTrack(keyed, "sourceY");
  expect(without.also).toEqual(["min"]);
  expect(without.phases[3].keys).toEqual({ min: "pi/8" });
  expect(removePhraseTrack(without, "min")).toEqual(single);
  // Retargeting resets that track's explicit keys to the study's value.
  const retargeted = retargetPhraseTrack(keyed, 1, "max", "6.28");
  expect(retargeted.also).toEqual(["max", "min"]);
  expect(retargeted.phases[3].keys).toEqual({ max: "6.28", min: "pi/8" });
  expect(retargeted.phases[3].key).toBe(single.phases[3].key);
  const first = retargetPhraseTrack(keyed, 0, "max", "6.28");
  expect(first.target).toBe("max");
  expect(first.phases.map((p) => p.key)).toEqual(
    single.phases.map((p) => (p.key === undefined ? undefined : "6.28")),
  );
  expect(first.phases[3].keys).toEqual(keyed.phases[3].keys);
  // A target another track already owns is not taken.
  expect(retargetPhraseTrack(keyed, 1, "min", "0")).toBe(keyed);
  expect(retargetPhraseTrack(keyed, 0, "sourceY", "0")).toBe(keyed);
});

test("a phase's reveal choice draws or erases roles and preserves reveals it cannot name", () => {
  const phase = { name: "Stage", duration: 1, pace: "ease" as const };
  expect(phaseRevealChoice(phase)).toBe("keep");
  const entry = { ...layers, definitionGuides: false };
  const drawn = withPhaseReveal(phase, "draw-construction-derived", entry);
  expect(drawn.reveal).toEqual({ construction: 1, derived: 1 });
  // Drawing shows the role from the phase's start, honoring the study's
  // chosen construction subsets.
  expect(drawn.layers).toEqual({
    lines: true,
    definitionGuides: false,
    rollingGuides: true,
    incident: true,
    derived: true,
  });
  expect(phaseRevealChoice(drawn)).toBe("draw-construction-derived");
  const erased = withPhaseReveal(drawn, "erase-construction", entry);
  expect(erased.reveal).toEqual({ construction: 0 });
  expect(erased.layers).toBeUndefined();
  expect(phaseRevealChoice(erased)).toBe("erase-construction");
  const kept = withPhaseReveal(
    { ...erased, layers: { axes: true, base: false } },
    "keep",
    entry,
  );
  expect(kept.reveal).toBeUndefined();
  // Layer events the choice does not own stay.
  expect(kept.layers).toEqual({ axes: true, base: false });
  expect(phaseRevealChoice({ ...phase, reveal: { base: 1 } })).toBe(
    "draw-base",
  );
  expect(
    phaseRevealChoice({
      ...phase,
      reveal: { base: 1, construction: 1, derived: 1 },
    }),
  ).toBe("draw-all");
  // A link's partial fraction is none of the choices.
  const partial = { ...phase, reveal: { derived: 0.4 } };
  expect(phaseRevealChoice(partial)).toBe("custom");
  expect(withPhaseReveal(partial, "custom", entry)).toBe(partial);
});

test("the sampler keys its one cached geometry by every track and names each in the presentation", async () => {
  const phrase = compilePhrase(
    config(),
    layers,
    0.8,
    two(),
    [0.5, 0.25, -0.5, 1],
  );
  const original = {
    config: config(),
    result: {
      base: [{ x: 0, y: 0 }, null, { x: 1, y: 0 }],
      derived: [null, { x: 0.3, y: 0 }, null],
      virtual: [false, false, false],
      rays: [],
      family: [],
      circles: [],
      rolling: [],
      warnings: [],
      invalid: 1,
    },
  };
  const asked: [number, number][] = [];
  const engine = {
    compute: async (c: any) => {
      asked.push([c.source.position.x, c.source.position.y]);
      return { ...original, config: c };
    },
  };
  const sample = createPhraseSampler({
    phrase,
    original: original as any,
    view: { cx: 0, cy: 0, scale: 100, span: 2 },
    stop: true,
  });
  // The entry study is reused; a hold asks once; a move of y alone asks
  // again although x has not changed.
  await sample(0, engine);
  expect(asked).toEqual([]);
  for (const s of [2, 2.5, 3, 2.2]) await sample(s, engine);
  expect(asked).toEqual([[0.5, 0.25]]);
  const moving = await sample(4, engine);
  expect(asked).toEqual([
    [0.5, 0.25],
    [0.5, -0.125],
  ]);
  expect(moving.frame.config.source.position).toMatchObject({
    x: 0.5,
    y: -0.125,
  });
  expect(moving.phrase).toMatchObject({
    phase: "Only y",
    target: "sourceX",
    value: 0.5,
    range: [0.5, 1],
    also: [{ target: "sourceY", value: -0.125, range: [-0.5, 0.25] }],
  });
  // Reverse seek to the held state asks again: one geometry is kept, not a
  // history.
  await sample(2.5, engine);
  expect(asked).toHaveLength(3);
  // At the end x is back at its entry value but y is not: that is not the
  // entry study.
  const end = await sample(9, engine);
  expect(asked.at(-1)).toEqual([1, -0.5]);
  expect(end.frame.config.source.position).toMatchObject({ x: 1, y: -0.5 });
  // A single-parameter phrase's presentation is unchanged.
  const single = defaultPhrase(config(), 0.8, "sourceX", layers);
  const plain = createPhraseSampler({
    phrase: compilePhrase(
      config(),
      layers,
      0.8,
      single,
      phraseKeys(single).map((k) => Number(k.text)),
    ),
    original: original as any,
    view: { cx: 0, cy: 0, scale: 100, span: 2 },
    stop: true,
  });
  expect((await plain(0, engine)).phrase).not.toHaveProperty("also");
});

// The circle's caustic study (a lamp at (1, 0)) with a starter phrase:
// Establish 1 s, Reveal 2 s, Find 2 s, Move to x = 0.75 in 3 s, Reach
// x = 0.5 in 3 s, Hold 2 s, Return to x = 1 in 3 s.
async function starter(page: Page) {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await openAnimation(page);
  await choosePreset(page, "2");
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("phrase");
}
const definition = async (page: Page) =>
  JSON.parse((await page.locator("#artwork desc").textContent())!);
const play = (page: Page) =>
  page.getByRole("button", { name: "Play animation", exact: true });
const box = (page: Page, name: string) =>
  page.getByRole("textbox", { name, exact: true });
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const names = (page: Page) =>
  page
    .locator(".phrase-phases li")
    .evaluateAll((items) =>
      items.map((li) => li.querySelector("textarea")!.value),
    );
async function seek(page: Page, time: string) {
  await page
    .getByRole("slider", { name: "Animation progress", exact: true })
    .fill(time);
  await expect(page.locator("#artwork")).toHaveAttribute(
    "data-animation-time",
    time,
  );
}

test("an arranged two-parameter phrase plays the route its controls describe at any seek", async ({
  page,
}) => {
  await starter(page);
  await button(page, "+ Add a parameter").click();
  const second = page.getByRole("combobox", {
    name: "Phrase parameter 2",
    exact: true,
  });
  await expect(second).toHaveValue("sourceY");
  // No parameter is offered twice.
  expect(
    await second.locator("option").evaluateAll((o) => o.map((x) => x.value)),
  ).not.toContain("sourceX");
  expect(
    await page
      .getByRole("combobox", { name: "Phrase parameter", exact: true })
      .locator("option")
      .evaluateAll((o) => o.map((x) => x.value)),
  ).not.toContain("sourceY");
  await box(page, "Phase 4 key 2").fill("0.3");
  await box(page, "Phase 5 key 2").fill("-0.2");
  await box(page, "Phase 7 key 2").fill("0");
  await button(page, "Remove phase 6").click();
  // Focus follows a moved phase onto the same button in its new place.
  await button(page, "Move phase 5 up").click();
  await expect(button(page, "Move phase 4 up")).toBeFocused();
  await button(page, "Add a phase after phase 5").click();
  await box(page, "Phase 6 name").fill("Rest");
  expect(await names(page)).toEqual([
    "Establish the base",
    "Reveal the construction",
    "Find the envelope",
    "Reach the detail",
    "Move the parameter",
    "Rest",
    "Return",
  ]);
  await page
    .getByRole("combobox", { name: "Pace", exact: true })
    .selectOption("steady");
  await expect(page.locator(".phrase-phases + .note")).toContainText(
    "Total: 15 s. 7 of 12 phases.",
  );
  await expect(play(page)).toBeEnabled();
  await play(page).click();
  await button(page, "Pause").click();
  // Independent expectation: 0–5 s still, 5–8 s to (0.5, −0.2), 8–11 s to
  // (0.75, 0.3), a 1 s rest, then 12–15 s back to (1, 0), all steady.
  const route = (s: number) =>
    s <= 5
      ? [1, 0]
      : s <= 8
        ? [1 - (0.5 * (s - 5)) / 3, (-0.2 * (s - 5)) / 3]
        : s <= 11
          ? [0.5 + (0.25 * (s - 8)) / 3, -0.2 + (0.5 * (s - 8)) / 3]
          : s <= 12
            ? [0.75, 0.3]
            : [0.75 + (0.25 * (s - 12)) / 3, 0.3 - (0.3 * (s - 12)) / 3];
  // Forward, backward and repeated seeks.
  for (const time of ["0.5", "0.9", "0.6", "0.76", "0.2", "0.6", "1", "0"]) {
    await seek(page, time);
    const shown = await definition(page);
    const [x, y] = route(15 * Number(time));
    expect(shown.source.position.x).toBeCloseTo(x, 12);
    expect(shown.source.position.y).toBeCloseTo(y, 12);
    expect(shown.animation.phrase.value).toBe(shown.source.position.x);
    expect(shown.animation.phrase.also).toEqual([
      { target: "sourceY", value: shown.source.position.y },
    ]);
    if (time === "0.76") {
      expect(shown.animation.phrase.phase).toBe("Rest");
      expect([shown.source.position.x, shown.source.position.y]).toEqual([
        0.75, 0.3,
      ]);
    }
  }
  // The caption names the stage and each parameter on its own row.
  await seek(page, "0.76");
  const caption = page.getByRole("group", { name: "Animation stage" });
  await expect(caption.locator(".phrase-caption-stage")).toHaveText("Rest");
  await expect(caption.locator(".phrase-caption-value")).toHaveText([
    /^Source x = 0\.75/,
    /^Source y = \s*0\.3/,
  ]);
  // Removing the second parameter while paused restores the study and
  // leaves the single-parameter phrase.
  await button(page, "Remove phrase parameter 2").click();
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-progress",
  );
  await expect(box(page, "Phase 4 key 2")).toHaveCount(0);
  await expect(box(page, "Phase 4 key")).toHaveValue("0.5");
  await expect(play(page)).toBeEnabled();
});

test("phases stay within 1 to 12, an empty end value holds, and names and keys report under their own fields", async ({
  page,
}) => {
  await starter(page);
  // Emptying an end value makes the phase a hold; the draft stays playable.
  await box(page, "Phase 5 key").fill("");
  await expect(box(page, "Phase 5 key")).toHaveAttribute("placeholder", "Held");
  await expect(play(page)).toBeEnabled();
  await play(page).click();
  await button(page, "Pause").click();
  // 16 s: phase 5 spans 8–11 s and now holds phase 4's 0.75.
  for (const time of ["0.5", "0.625", "0.688", "0.8"]) {
    await seek(page, time);
    expect((await definition(page)).source.position.x).toBe(0.75);
  }
  await button(page, "Stop").click();
  // An invalid further key and a blank name each report under their field.
  await button(page, "+ Add a parameter").click();
  await box(page, "Phase 4 key 2").fill("t");
  await expect(play(page)).toBeDisabled();
  const errorUnder = (name: string) =>
    box(page, name)
      .locator("xpath=ancestor::div[contains(@class,'field')][1]")
      .getByRole("alert");
  await expect(errorUnder("Phase 4 key 2")).toContainText(/^Phase 4 key 2:/);
  await expect(page.getByRole("alert")).toHaveCount(1);
  await box(page, "Phase 4 key 2").fill("0.1");
  await expect(play(page)).toBeEnabled();
  await box(page, "Phase 2 name").fill("");
  await expect(errorUnder("Phase 2 name")).toContainText(
    "Phase 2 name must contain 1–60 characters.",
  );
  await expect(play(page)).toBeDisabled();
  await box(page, "Phase 2 name").fill("Rays");
  await expect(play(page)).toBeEnabled();
  // Down to one phase: it cannot be removed or moved.
  for (let i = 0; i < 6; i++) await button(page, "Remove phase 1").click();
  expect(await names(page)).toEqual(["Return"]);
  for (const name of ["Remove phase 1", "Move phase 1 up", "Move phase 1 down"])
    await expect(button(page, name)).toBeDisabled();
  await expect(play(page)).toBeEnabled();
  // Up to twelve: nothing more is added.
  for (let i = 0; i < 11; i++)
    await button(page, "Add a phase after phase 1").click();
  await expect(page.locator(".phrase-phases li")).toHaveCount(12);
  for (const i of [1, 7, 12])
    await expect(button(page, `Add a phase after phase ${i}`)).toBeDisabled();
  await expect(page.locator(".phrase-phases + .note")).toContainText(
    "12 of 12 phases.",
  );
  await expect(play(page)).toBeEnabled();
  // Three parameters at most.
  await button(page, "+ Add a parameter").click();
  await expect(button(page, "+ Add a parameter")).toBeDisabled();
  await expect(
    page.getByRole("combobox", { name: "Phrase parameter 3", exact: true }),
  ).toBeVisible();
  await expect(box(page, "Phase 1 key 3")).toBeVisible();
});

test("retargeting one parameter resets only its end values, and a reveal choice erases through playback", async ({
  page,
}) => {
  await starter(page);
  await button(page, "+ Add a parameter").click();
  await box(page, "Phase 4 key 2").fill("0.3");
  await box(page, "Phase 5 key 2").fill("-0.2");
  await page
    .getByRole("combobox", { name: "Phrase parameter 2", exact: true })
    .selectOption("max");
  // The second parameter's explicit keys start again at the study's domain
  // end; its holds stay holds and the first parameter's keys are untouched.
  const end = String(presets[2].config.curve.max);
  await expect(box(page, "Phase 4 key 2")).toHaveValue(end);
  await expect(box(page, "Phase 5 key 2")).toHaveValue(end);
  await expect(box(page, "Phase 7 key 2")).toHaveValue("");
  await expect(box(page, "Phase 4 key")).toHaveValue("0.75");
  await expect(box(page, "Phase 7 key")).toHaveValue("1");
  // Phase 6 (the 2 s hold at 11–13 s of 16) erases the construction.
  const reveal = page.getByRole("combobox", {
    name: "Phase 6 reveal",
    exact: true,
  });
  await expect(reveal).toHaveValue("keep");
  await expect(
    page.getByRole("combobox", { name: "Phase 2 reveal", exact: true }),
  ).toHaveValue("draw-construction");
  await reveal.selectOption("erase-construction");
  await page
    .getByRole("combobox", { name: "Pace", exact: true })
    .selectOption("steady");
  await play(page).click();
  await button(page, "Pause").click();
  for (const [time, fraction] of [
    ["0.65", 1],
    ["0.75", 0.5],
    ["0.85", 0],
    ["1", 0],
    ["0.75", 0.5],
  ] as const) {
    await seek(page, time);
    expect(
      (await definition(page)).animation.phrase.reveal.construction,
    ).toBeCloseTo(fraction, 12);
  }
});

test("a reorder during pending key evaluation discards the earlier arrangement's values", async ({
  page,
}) => {
  await watchEngines(page, 2, { scalars: 250 });
  await starter(page);
  await expect(play(page)).toBeEnabled();
  // Edit a key and move its phase before Go has answered for the edit.
  await box(page, "Phase 4 key").fill("0.6");
  await button(page, "Move phase 4 down").click();
  await expect(play(page)).toBeDisabled();
  await expect(play(page)).toBeEnabled();
  await page
    .getByRole("combobox", { name: "Pace", exact: true })
    .selectOption("steady");
  await expect(play(page)).toBeEnabled();
  await play(page).click();
  await button(page, "Pause").click();
  // Now: Reach 0.5 over 5–8 s, then Move to 0.6 over 8–11 s, of 16.
  for (const [time, x] of [
    ["0.5", 0.5],
    ["0.75", 0.6],
    ["0.625", 0.5 + 0.2 / 3],
  ] as const) {
    await seek(page, time);
    expect((await definition(page)).source.position.x).toBeCloseTo(x, 12);
  }
});

const film = "A caustic gathered into a focus";
// The caustic as drawn, in the study's coordinates: the drawing is 1000 by
// 760 units about its camera center, y upward.
async function caustic(page: Page) {
  return page.locator("#artwork").evaluate((svg) => {
    const scale = Number(svg.getAttribute("data-camera-scale"));
    const [cx, cy] = svg
      .getAttribute("data-camera-center")!
      .split(",")
      .map(Number);
    const d =
      svg.querySelector('[data-testid="derived-curve"]')?.getAttribute("d") ??
      "";
    return [...d.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map((m) => [
      cx + (Number(m[1]) - 500) / scale,
      cy - (Number(m[2]) - 380) / scale,
    ]);
  });
}

test("the authored two-parameter film gathers its caustic into the far focus and opens it again", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await openAnimation(page);
  await choosePreset(page, { label: film });
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(
    page.getByRole("combobox", { name: "Animate", exact: true }),
  ).toHaveValue("phrase");
  await expect(
    page.getByRole("combobox", { name: "Phrase parameter", exact: true }),
  ).toHaveValue("sourceX");
  await expect(
    page.getByRole("combobox", { name: "Phrase parameter 2", exact: true }),
  ).toHaveValue("sourceY");
  const original = await definition(page);
  expect(original.animation).toBeUndefined();
  expect(original.source.position).toEqual({ x: 0.4, y: 0.3 });
  // An ellipse with semi-axes 1.25 and 1: foci at (±c, 0).
  const c = Math.sqrt(1.25 ** 2 - 1);
  await play(page).click();
  await button(page, "Pause").click();
  // 19 s: rays by 4 s, caustic by 6 s; y alone to −0.35 by 9 s; both to the
  // focus by 13 s, held to 15 s; back to (0.4, 0.3) by 19 s.
  for (const [time, x, y, phase] of [
    ["0.74", c, 0, "Every ray meets at the other focus"],
    ["0.474", 0.4, -0.35, "Carry the lamp to a focus"],
    ["1", 0.4, 0.3, "Return"],
    ["0.3", 0.4, 0.3, "Find the caustic"],
    ["0.74", c, 0, "Every ray meets at the other focus"],
    ["0", 0.4, 0.3, "Establish the mirror and lamp"],
  ] as const) {
    await seek(page, time);
    const shown = await definition(page);
    expect(shown.animation.phrase.phase).toBe(phase);
    if (time === "0.474") {
      // 9.006 s, six thousandths of a second after the lamp sets off.
      expect(shown.source.position.x).toBeCloseTo(x, 5);
      expect(shown.source.position.y).toBeCloseTo(y, 5);
    } else expect(shown.source.position).toEqual({ x, y });
    expect(shown.animation.phrase.reveal.construction).toBe(
      time === "0" ? 0 : 1,
    );
    if (time === "0") continue;
    const points = await caustic(page);
    expect(points.length).toBeGreaterThan(100);
    if (x === c)
      // Reflection in an ellipse sends every ray from one focus through
      // the other, so the whole caustic is that point (to the path's 3
      // decimals).
      for (const [px, py] of points) {
        expect(Math.abs(px + c)).toBeLessThan(1e-4);
        expect(Math.abs(py)).toBeLessThan(1e-4);
      }
    else {
      // Off the focus it is a curve across the mirror.
      const xs = points.map((q) => q[0]);
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.5);
    }
  }
  await expect(page.locator("#artwork text")).toHaveCount(0);
  await button(page, "Stop").click();
  expect(await definition(page)).toEqual(original);
});

test("a two-parameter phrase's MP4 and SVG match direct seeks at both ends, a hold and a moving frame", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await openExportSettings(page);
  await choosePreset(page, { label: film });
  const exportMP4 = page.getByRole("button", { name: "Export MP4 video" });
  await expect(exportMP4).toBeEnabled();
  await page
    .getByRole("combobox", { name: "Export format", exact: true })
    .selectOption("mp4");
  await page
    .getByRole("combobox", { name: "Export frame rate", exact: true })
    .selectOption("15");
  // 2 s: the lamp is carried to the focus in 0.8–1.1 s and held to 1.7 s.
  for (const [i, duration] of [0.1, 0.2, 0.2, 0.3, 0.3, 0.6, 0.3].entries())
    await page
      .getByRole("spinbutton", { name: `Phase ${i + 1} duration`, exact: true })
      .fill(String(duration));
  await play(page).click();
  await button(page, "Pause").click();
  const stills = [];
  // 0.517 (frame 15 of 30, at 15/29 of 2 s within half a millisecond) is
  // reached by scrubbing backward, while x and y both move.
  for (const time of ["0", "0.7", "1", "0.517"]) {
    await seek(page, time);
    const shown = await definition(page);
    if (time === "0.517") {
      const h = (1 - Math.cos(Math.PI * ((1.034 - 0.8) / 0.3))) / 2;
      expect(shown.source.position.x).toBeCloseTo(0.4 + 0.35 * h, 12);
      expect(shown.source.position.y).toBeCloseTo(-0.35 + 0.35 * h, 12);
    } else
      expect(shown.source.position).toEqual(
        time === "0.7" ? { x: 0.75, y: 0 } : { x: 0.4, y: 0.3 },
      );
    if (time === "0.7") {
      const saved = page.waitForEvent("download");
      await exportImage(page, "SVG");
      const svg = await readFile((await (await saved).path())!, "utf8");
      expect(svg).toContain('"phase":"Every ray meets at the other focus"');
      expect(svg).toContain('"also":[{"target":"sourceY","value":0}]');
      expect(svg).not.toMatch(/<text[\s>]/);
    }
    const saved = page.waitForEvent("download");
    await exportImage(page, "PNG");
    stills.push(decodePng(await readFile((await (await saved).path())!)));
  }
  await button(page, "Stop").click();
  const download = page.waitForEvent("download");
  await exportMP4.click();
  const path = (await (await download).path())!;
  const data = probe(path);
  if (data) {
    expect(data.frames).toBe(30);
    expect(data.durations.reduce((a, b) => a + b, 0)).toBe(2000);
    expect(data.times[0]).toBe(0);
    const match = (i: number, reference: (typeof stills)[number]) =>
      frameDifference(path, 2000, 1520, i, reference.rgba)!;
    for (const [i, reference] of [
      [0, stills[0]],
      [15, stills[3]],
      [20, stills[1]],
      [23, stills[1]],
      [29, stills[2]],
    ] as const) {
      const difference = match(i, reference);
      expect(difference.meanDifference).toBeLessThan(3);
      expect(difference.unmatchedInk).toBeLessThan(0.05);
    }
    // The gathered caustic is not the open one, nor the frame on the way.
    expect(match(20, stills[2]).unmatchedInk).toBeGreaterThan(0.3);
    expect(match(15, stills[1]).unmatchedInk).toBeGreaterThan(0.3);
  }
  const video = await decodeVideo(page, await readFile(path));
  expect(video.duration).toBeCloseTo(2, 3);
  expect(video.first.hash).not.toBe(video.last.hash); // rays and caustic drawn
});

test("a boundary the engine refuses is reported under the end value that caused it and stands until its inputs change", async ({
  page,
}) => {
  await starter(page);
  // Three parameters: the lamp's x, the domain start, and the lamp's y.
  await button(page, "+ Add a parameter").click();
  await page
    .getByRole("combobox", { name: "Phrase parameter 2", exact: true })
    .selectOption("min");
  await button(page, "+ Add a parameter").click();
  await expect(
    page.getByRole("combobox", { name: "Phrase parameter 3", exact: true }),
  ).toHaveValue("sourceY");
  // A domain start past the domain's end is a valid constant that only the
  // engine can refuse. Phase 4 moves all three parameters; the lamp's
  // coordinates are fine on their own.
  await box(page, "Phase 4 key 2").fill("7");
  await box(page, "Phase 4 key 3").fill("0.3");
  await expect(play(page)).toBeEnabled();
  await play(page).click();
  const errorUnder = (name: string) =>
    box(page, name)
      .locator("xpath=ancestor::div[contains(@class,'field')][1]")
      .getByRole("alert");
  await expect(errorUnder("Phase 4 key 2")).toContainText(
    /^Phase 4 key 2: domain start/,
  );
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-progress",
  );
  await expect(play(page)).toBeDisabled();
  // A later phase's values, a duration and a name do not bear on it.
  await box(page, "Phase 5 key").fill("0.4");
  await page
    .getByRole("spinbutton", { name: "Phase 1 duration", exact: true })
    .fill("2");
  await box(page, "Phase 6 name").fill("Wait");
  await expect(errorUnder("Phase 4 key 2")).toContainText(/^Phase 4 key 2: /);
  await expect(play(page)).toBeDisabled();
  // Its own value does.
  await box(page, "Phase 4 key 2").fill("0.5");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(play(page)).toBeEnabled();
  // A phase that only a further parameter moves is checked too: phase 6
  // holds the lamp.
  await box(page, "Phase 6 key 2").fill("7");
  await expect(play(page)).toBeEnabled();
  await play(page).click();
  await expect(errorUnder("Phase 6 key 2")).toContainText(
    /^Phase 6 key 2: domain start/,
  );
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-progress",
  );
  await box(page, "Phase 6 key 2").fill("");
  await expect(play(page)).toBeEnabled();
  await play(page).click();
  await button(page, "Pause").click();
  await seek(page, "1");
  const end = await definition(page);
  expect(end.curve.min).toBe(0.5);
  expect(end.source.position).toEqual({ x: 1, y: 0.3 });
});
