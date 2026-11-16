import { test, expect, type Page } from "@playwright/test";
import { deflateRawSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import {
  choosePreset,
  open,
  openAnimation,
  openExportSettings,
} from "./helpers";
import { decodePng } from "./png";
import { pngStill } from "./spatial-family-helpers";
import {
  decodedFrame,
  decodeVideo,
  frameDifference,
  probe as probeVideo,
} from "./video";
import { settled } from "./gallery-helpers";
import {
  compileEngravingPhrase,
  defaultEngravingPhrase,
  engravingPhraseAt,
  engravingPhraseError,
  setSpanEnd,
  spanAt,
  spanBefore,
  type EngravingPhrase,
} from "../web/engraving-phrase";
import { familyMotionMembers } from "../web/family-motion";
import { insertPhase, movePhase, removePhase } from "../web/phrase-timeline";

// The shared model of an engraving phrase: a finite family's frozen members
// shown through named phases. Layers and camera keys are notebook-owned;
// these tests use plain records and numbers for them.
type L = { lines: boolean; incident: boolean; base: boolean };
type V = { zoom: number };
const layers: L = { lines: false, incident: true, base: true };
const camera = { entry: 1, key: (v: V) => v.zoom };
const phrase = (): EngravingPhrase<L, V> => ({
  opening: { first: 1, last: 16 },
  phases: [
    {
      name: "Single out one",
      duration: 2,
      pace: "steady",
      members: { first: 8, last: 8 },
      layers: { incident: false },
    },
    {
      name: "Its construction",
      duration: 1,
      pace: "steady",
      layers: { lines: true },
      view: { zoom: 3 },
    },
    {
      name: "Return",
      duration: 4,
      pace: "ease",
      members: { first: 1, last: 16 },
      layers: { lines: false, incident: true },
      view: "entry",
    },
  ],
});

test("each end of a member span steps on its own at evenly spaced progress and is exact at both ends", () => {
  // Independent expectation: e₀ + sgn(Δ)·⌊|Δ|·p⌋ for each end.
  const step = (a: number, b: number, p: number) =>
    a + Math.sign(b - a) * Math.floor(Math.abs(b - a) * p);
  const cases = [
    [1, 16, 8, 8],
    [8, 8, 1, 16],
    [2, 2, 1, 9],
    [1, 3, 14, 16],
    [5, 12, 5, 12],
  ] as const;
  for (const [a0, b0, a1, b1] of cases)
    for (let k = 0; k <= 64; k++) {
      const p = k / 64;
      const span = spanAt({ first: a0, last: b0 }, { first: a1, last: b1 }, p);
      expect(span).toEqual({
        first: step(a0, a1, p),
        last: step(b0, b1, p),
      });
      expect(span.first).toBeLessThanOrEqual(span.last);
    }
  // Boundaries are the stored spans themselves.
  expect(spanAt({ first: 1, last: 16 }, { first: 8, last: 8 }, 0)).toEqual({
    first: 1,
    last: 16,
  });
  expect(spanAt({ first: 1, last: 16 }, { first: 8, last: 8 }, 1)).toEqual({
    first: 8,
    last: 8,
  });
  // A growing span from member 1 is the existing reveal's member timing.
  const ids = Array.from({ length: 9 }, (_, i) => i);
  for (let k = 0; k <= 40; k++) {
    const p = k / 40;
    const span = spanAt({ first: 1, last: 1 }, { first: 1, last: 9 }, p);
    expect(ids.slice(span.first - 1, span.last)).toEqual(
      familyMotionMembers(ids, { mode: "reveal", width: 1, progress: p }),
    );
  }
});

test("a compiled engraving phrase samples spans, layer events and camera from absolute time alone", () => {
  const compiled = compileEngravingPhrase(phrase(), 16, layers, camera);
  expect(compiled.duration).toBe(7);
  expect(compiled.count).toBe(16);
  // Forward, backward and repeated seeks agree: no history contributes.
  const expected = (s: number) => {
    const ease = (u: number) => (1 - Math.cos(Math.PI * u)) / 2;
    if (s < 2) {
      const p = s / 2;
      return {
        phase: "Single out one",
        first: 1 + Math.floor(7 * p),
        last: 16 - Math.floor(8 * p),
        layers: { lines: false, incident: false, base: true },
      };
    }
    if (s < 3)
      return {
        phase: "Its construction",
        first: 8,
        last: 8,
        layers: { lines: true, incident: false, base: true },
      };
    const p = ease(Math.min(1, (s - 3) / 4));
    return {
      phase: "Return",
      first: 8 - Math.floor(7 * p),
      last: 8 + Math.floor(8 * p),
      layers: { lines: false, incident: true, base: true },
    };
  };
  for (const s of [0, 7, 1, 0.5, 2, 2.5, 3, 4.2, 5, 6.9, 7, 1.99, 0]) {
    const at = engravingPhraseAt(compiled, s);
    const want = expected(s);
    expect(at.phase).toBe(want.phase);
    expect(at.span).toEqual({ first: want.first, last: want.last });
    expect(at.layers).toEqual(want.layers);
  }
  // Exact endpoints: the opening span and the final one.
  expect(engravingPhraseAt(compiled, 0).span).toEqual({ first: 1, last: 16 });
  expect(engravingPhraseAt(compiled, 7).span).toEqual({ first: 1, last: 16 });
  expect(engravingPhraseAt(compiled, -3).span).toEqual({ first: 1, last: 16 });
  expect(engravingPhraseAt(compiled, 70).span).toEqual({ first: 1, last: 16 });
  // Camera boundaries as the notebook resolves them: entry 1, key 3, and
  // back to entry; each phase reports its own two ends and progress.
  const leg = (s: number) => {
    const at = engravingPhraseAt(compiled, s);
    return [at.from, at.to, at.p];
  };
  expect(leg(1)).toEqual([1, 1, 0.5]);
  expect(leg(2.5)).toEqual([1, 3, 0.5]);
  expect(leg(5).slice(0, 2)).toEqual([3, 1]);
  expect(leg(5)[2]).toBeCloseTo(0.5, 14);
  expect(engravingPhraseAt(compiled, 2.5).key).toEqual({ zoom: 3 });
  expect(engravingPhraseAt(compiled, 5).key).toBe("entry");
  expect(engravingPhraseAt(compiled, 1).key).toBeUndefined();
});

test("a compiled phrase keeps no reference to the draft it was compiled from", () => {
  const draft = phrase();
  const compiled = compileEngravingPhrase(draft, 16, layers, camera);
  draft.phases[0].members!.first = 3;
  draft.opening.last = 2;
  (draft.phases[1].layers as L).lines = false;
  expect(engravingPhraseAt(compiled, 2).span).toEqual({ first: 8, last: 8 });
  expect(engravingPhraseAt(compiled, 0).span).toEqual({ first: 1, last: 16 });
  expect(engravingPhraseAt(compiled, 2.5).layers.lines).toBe(true);
});

test("refusals name the offending field, in timeline order", () => {
  const error = (change: (p: EngravingPhrase<L, V>) => void, count = 16) => {
    const p = phrase();
    change(p);
    return engravingPhraseError(p, count);
  };
  expect(error(() => {})).toBeNull();
  expect(error((p) => (p.phases = []))).toBe(
    "A phrase must contain 1–12 phases.",
  );
  expect(error((p) => (p.opening.first = 0))).toBe(
    "Opening first member must be a whole number from 1 to 16.",
  );
  expect(error((p) => (p.opening.first = 2.5))).toBe(
    "Opening first member must be a whole number from 1 to 16.",
  );
  expect(error((p) => (p.opening.last = 17))).toBe(
    "Opening last member must be a whole number from the first member to 16.",
  );
  expect(error((p) => (p.opening = { first: 9, last: 4 }))).toBe(
    "Opening last member must be a whole number from the first member to 16.",
  );
  expect(error((p) => (p.phases[1].name = " "))).toBe(
    "Phase 2 name must contain 1–60 characters.",
  );
  expect(error((p) => (p.phases[0].duration = 0.05))).toBe(
    "Phase 1 duration must be at least 0.1 seconds.",
  );
  expect(error((p) => (p.phases[0].duration = NaN))).toBe(
    "Phase 1 duration must be at least 0.1 seconds.",
  );
  expect(error((p) => (p.phases[2].members = { first: NaN, last: 3 }))).toBe(
    "Phase 3 first member must be a whole number from 1 to 16.",
  );
  expect(error((p) => (p.phases[2].members = { first: 3, last: NaN }))).toBe(
    "Phase 3 last member must be a whole number from the first member to 16.",
  );
  // A smaller family refuses a span it no longer contains.
  expect(error(() => {}, 12)).toBe(
    "Opening last member must be a whole number from the first member to 12.",
  );
  expect(
    error((p) => {
      p.opening.last = 8;
      p.phases[2].members = { first: 1, last: 8 };
    }, 7),
  ).toBe(
    "Opening last member must be a whole number from the first member to 7.",
  );
  expect(error((p) => (p.phases = Array(7).fill(p.phases[0])))).toBeNull();
  expect(error((p) => (p.phases = Array(13).fill(p.phases[0])))).toBe(
    "A phrase must contain 1–12 phases.",
  );
  expect(
    error(
      (p) => (p.phases = Array(2).fill({ ...p.phases[0], duration: 1801 })),
    ),
  ).toBe("Total phrase duration must be between 0.1 and 3600 seconds.");
  // The notebook's own checks run per phase, after its members.
  expect(
    engravingPhraseError(phrase(), 16, {
      phase: (p, i) => (p.view === "entry" ? `Phase ${i + 1} view no.` : null),
    }),
  ).toBe("Phase 3 view no.");
  expect(() =>
    compileEngravingPhrase(
      { ...phrase(), opening: { first: 2, last: 1 } },
      16,
      layers,
      camera,
    ),
  ).toThrow(/Opening last member/);
});

test("the starter singles out the selected member, shows its construction and returns to the whole family", () => {
  const starter = defaultEngravingPhrase<L, V>(9, 4, layers, ["lines"]);
  expect(engravingPhraseError(starter, 9)).toBeNull();
  expect(starter.opening).toEqual({ first: 1, last: 9 });
  const compiled = compileEngravingPhrase(starter, 9, layers, camera);
  const end = engravingPhraseAt(compiled, compiled.duration);
  // It ends exactly as it opens: the whole family with the study's layers.
  expect(end.span).toEqual({ first: 1, last: 9 });
  expect(end.layers).toEqual(layers);
  expect(engravingPhraseAt(compiled, 0).layers).toEqual(layers);
  const alone = compiled.phases.find(
    (p) => p.to.span.first === 5 && p.to.span.last === 5,
  );
  expect(alone).toBeTruthy();
  // Somewhere the selected member stands alone with its construction shown.
  const shown = compiled.phases.some(
    (p) =>
      p.from.span.first === 5 &&
      p.from.span.last === 5 &&
      p.from.layers.lines === true,
  );
  expect(shown).toBe(true);
  // No construction to show: no phase pretends to show it.
  const plain = defaultEngravingPhrase<L, V>(9, 0, layers, []);
  expect(engravingPhraseError(plain, 9)).toBeNull();
  expect(plain.phases.every((p) => !p.layers)).toBe(true);
  expect(
    plain.phases.some((p) => p.members?.first === 1 && p.members.last === 1),
  ).toBe(true);
});

test("an end typed alone completes the held span, and clearing both holds again", () => {
  const draft = phrase();
  expect(spanBefore(draft, 0)).toEqual({ first: 1, last: 16 });
  expect(spanBefore(draft, 1)).toEqual({ first: 8, last: 8 });
  expect(spanBefore(draft, 2)).toEqual({ first: 8, last: 8 });
  const held = spanBefore(draft, 1);
  expect(setSpanEnd(undefined, held, "first", 6, true)).toEqual({
    first: 6,
    last: 8,
  });
  expect(setSpanEnd({ first: 6, last: 8 }, held, "last", 12, true)).toEqual({
    first: 6,
    last: 12,
  });
  // An emptied end stays a refusal until its partner empties too.
  expect(setSpanEnd({ first: 6, last: 12 }, held, "first", NaN, true)).toEqual({
    first: NaN,
    last: 12,
  });
  expect(
    setSpanEnd({ first: NaN, last: 12 }, held, "last", NaN, true),
  ).toBeUndefined();
  expect(setSpanEnd(undefined, held, "last", NaN, true)).toBeUndefined();
  // The opening keeps both ends, even emptied.
  expect(setSpanEnd({ first: 1, last: 16 }, held, "first", NaN, false)).toEqual(
    { first: NaN, last: 16 },
  );
});

test("the shared arrangement operations apply to engraving phrases", () => {
  const p = phrase();
  const added = insertPhase(p, 0);
  expect(added.phases).toHaveLength(4);
  expect(added.phases[1]).toEqual({
    name: "Hold",
    duration: 1,
    pace: "steady",
  });
  expect(added.opening).toBe(p.opening);
  expect(engravingPhraseError(added, 16)).toBeNull();
  expect(movePhase(p, 2, 0).phases.map((q) => q.name)).toEqual([
    "Return",
    "Single out one",
    "Its construction",
  ]);
  expect(removePhase(p, 1).phases.map((q) => q.name)).toEqual([
    "Single out one",
    "Return",
  ]);
});

// The planar notebook: the lamp's lace holds sixteen caustics with member 5
// selected and its rays and incident light hidden.
async function lampPhrase(page: Page) {
  await page.addInitScript(() => {
    (window as any).requests = 0;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (data: any, options?: any) {
      if (typeof data?.action === "string") (window as any).requests++;
      post.call(this, data, options);
    };
  });
  await page.goto("/");
  await choosePreset(page, { label: "A lamp's lace" });
  await settled(page);
  await openAnimation(page);
  await page.getByLabel("Repeat", { exact: true }).selectOption("once");
  await page.getByLabel("Animate", { exact: true }).selectOption("phrase");
}
const shownMembers = (page: Page) =>
  page
    .locator("#artwork [data-family-member]")
    .evaluateAll((ns) =>
      ns.map((n) => Number(n.getAttribute("data-family-member"))),
    );
const range = (a: number, b: number) =>
  Array.from({ length: b - a + 1 }, (_, i) => a + i);

test("a planar engraving phrase plays the frozen members through the normal panel without engine requests", async ({
  page,
}) => {
  await lampPhrase(page);
  // The starter opens on the whole family and singles out member 5.
  await expect(
    page.getByLabel("Opening first member", { exact: true }),
  ).toHaveValue("1");
  await expect(
    page.getByLabel("Opening last member", { exact: true }),
  ).toHaveValue("16");
  await expect(
    page.getByLabel("Phase 1 first member", { exact: true }),
  ).toHaveValue("5");
  await expect(
    page.getByLabel("Phase 1 last member", { exact: true }),
  ).toHaveValue("5");
  await expect(
    page.getByLabel("Phase 2 first member", { exact: true }),
  ).toHaveValue("");
  await expect(page.getByLabel("Phase 1 name", { exact: true })).toHaveValue(
    "Single out one member",
  );
  await expect(page.getByLabel("Phase 4 name", { exact: true })).toHaveValue(
    "Return to the family",
  );
  await expect(
    page.getByLabel("Duration (seconds)", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Phrase parameter", { exact: true }),
  ).toHaveCount(0);
  const before = await page.evaluate(() => (window as any).requests);
  const play = page.getByRole("button", {
    name: "Play animation",
    exact: true,
  });
  await play.click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", {
    name: "Animation progress",
    exact: true,
  });
  const art = page.locator("#artwork");
  // Phases of 3, 2, 1 and 3 seconds; the first and last eased. Independent
  // expectation: each end of the span steps a whole member at a time.
  const ease = (u: number) => (1 - Math.cos(Math.PI * u)) / 2;
  // Seeks land on the slider's thousandths; seconds follow from them.
  const expected = (value: number): [number[], number] => {
    const s = value * 9;
    if (s < 3) {
      const p = ease(s / 3);
      return [range(Math.floor(4 * p), 15 - Math.floor(11 * p)), 0];
    }
    // Its 24 rays, each reflected and incident.
    if (s < 6) return [[4], 48];
    const p = ease((s - 6) / 3);
    return [range(4 - Math.floor(4 * p), 4 + Math.floor(11 * p)), 0];
  };
  for (const value of [0, 0.167, 0.25, 0.444, 0.611, 0.75, 0.833, 0.95, 1]) {
    const [ids, lines] = expected(value);
    await slider.fill(String(value));
    await expect.poll(() => shownMembers(page)).toEqual(ids);
    await expect(art.locator("[data-family-member] line")).toHaveCount(lines);
  }
  expect(expected(0.167)[0]).toEqual(range(2, 10));
  expect(expected(1)[0]).toEqual(range(0, 15));
  await slider.fill("0.444");
  await expect(page.locator(".animation-values")).toContainText(
    "Show its construction · member 5 of 16",
  );
  // Seeks and playback are composed from the members already held.
  expect(await page.evaluate(() => (window as any).requests)).toBe(before);
  // Edits apply to the latest phrase: two arrangements in one task both
  // land.
  await page.evaluate(() => {
    const add = (n: number) =>
      document
        .querySelector<HTMLButtonElement>(
          `button[aria-label="Add a phase after phase ${n}"]`,
        )!
        .click();
    add(4);
    add(1);
  });
  await expect(page.locator(".phrase-phases > li")).toHaveCount(6);
  for (const n of [6, 2])
    await page
      .getByRole("button", { name: `Remove phase ${n}`, exact: true })
      .click();
  await expect(page.locator(".phrase-phases > li")).toHaveCount(4);
  // An edit returns to the study.
  await page.getByLabel("Phase 1 last member", { exact: true }).fill("7");
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeDisabled();
  await expect.poll(() => shownMembers(page)).toEqual(range(0, 15));
  // A refusal names its field and blocks Play and Copy link.
  await page.getByLabel("Phase 1 first member", { exact: true }).fill("17");
  await expect(
    page.locator(".animation-panel, #animation-section"),
  ).toContainText("Phase 1 first member must be a whole number from 1 to 16.");
  await expect(play).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Copy link", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Phase 1 first member", { exact: true }).fill("5");
  await expect(play).toBeEnabled();
  // A refusal no single field owns is shown in the panel.
  await page.getByLabel("Phase 2 duration", { exact: true }).fill("3595");
  await expect(page.locator("#animation-section")).toContainText(
    "Total phrase duration must be between 0.1 and 3600 seconds.",
  );
  await expect(play).toBeDisabled();
  await page.getByLabel("Phase 2 duration", { exact: true }).fill("2");
  await expect(play).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Copy link", exact: true }),
  ).toBeEnabled();
  expect(await page.evaluate(() => (window as any).requests)).toBe(before);
});

// The 3D notebook: the knot's family, a short span phrase over it.
const knotFamily = () => ({
  enabled: true,
  target: "tube" as const,
  from: 0.3,
  to: 1.2,
  count: 5,
  selected: 2,
  presentation: "family" as const,
  motion: "phrase" as const,
  width: 3,
  phrase: {
    opening: { first: 1, last: 5 },
    phases: [
      {
        name: "One knot",
        duration: 1,
        pace: "ease" as const,
        members: { first: 3, last: 3 },
        layers: { connectors: true },
      },
      {
        name: "Around",
        duration: 2,
        pace: "steady" as const,
        view: { yaw: 1, pitch: 0.3, zoom: 1.5, panX: 0, panY: 0, turns: 1 },
      },
      {
        name: "Return",
        duration: 1,
        pace: "ease" as const,
        members: { first: 1, last: 5 },
        view: "entry" as const,
      },
    ],
  },
});
const knotSource = async () => {
  const { presetStudy } = await import("../web/spatial/link");
  const s = presetStudy(0);
  s.config.construction = "orthotomic";
  s.config.samples = 240;
  s.config.lines = 12;
  s.config.adaptive = false;
  return s;
};

test("spatial engraving phrase links conform spans, layer events and views within the family", async () => {
  const { spatialStudy } = await import("../web/spatial/link");
  const { readStudyLink, writeStudyLink } = await import("../web/study-link");
  const s = { ...(await knotSource()), family: knotFamily() };
  expect(spatialStudy(s)).toEqual(s);
  const read = await readStudyLink(await writeStudyLink("3d", s));
  expect(spatialStudy(read.study).family).toEqual(s.family);
  // Older links keep reveal and window, without a phrase.
  const { phrase: _, ...old } = { ...s.family, motion: "window" as const };
  expect(spatialStudy({ ...s, family: old }).family).toEqual(old);
  const refused = (change: (f: any) => void, field: RegExp) => {
    const f = structuredClone(s.family) as any;
    change(f);
    expect(() => spatialStudy({ ...s, family: f })).toThrow(field);
  };
  refused((f) => delete f.phrase, /family\.phrase/);
  refused((f) => (f.phrase.opening.last = 6), /Opening last member/);
  refused((f) => (f.phrase.phases[0].members.last = 2), /Phase 1 last member/);
  refused((f) => (f.phrase.phases[0].layers.halo = true), /family\.phrase/);
  refused((f) => (f.phrase.phases[0].layers.connectors = 1), /family\.phrase/);
  refused(
    (f) => (f.phrase.phases[1].view.zoom = 9),
    /phases\[1\]\.view\.zoom must be from 0\.2 to 8/,
  );
  refused(
    (f) => (f.phrase.phases[1].view.turns = 0.5),
    /phases\[1\]\.view\.turns must be a whole number/,
  );
  refused((f) => (f.phrase.phases[1].view = "nearby"), /phases\[1\]\.view/);
  refused((f) => (f.phrase.phases[0].reveal = 1), /family\.phrase/);
  refused((f) => (f.phrase.target = "tube"), /family\.phrase/);
  refused((f) => (f.count = 4), /Opening last member/);
  // Checked even while the family is off, as its other settings are.
  refused((f) => {
    f.enabled = false;
    f.phrase.phases[0].members.first = 0;
  }, /Phase 1 first member/);
});

// Through the 3D notebook's worker, renderer and panel.
const stage3d = (page: Page) => page.locator(".spatial-stage");
const settled3d = (page: Page) =>
  expect(stage3d(page)).toHaveAttribute("aria-busy", "false", {
    timeout: 60000,
  });
const record3d = async (page: Page) =>
  JSON.parse((await stage3d(page).getAttribute("data-engraving"))!);
const camera3d = async (page: Page) =>
  JSON.parse((await stage3d(page).getAttribute("data-camera"))!);
async function seek3d(page: Page, to: number) {
  await page
    .getByRole("slider", { name: "Animation progress" })
    .fill(String(to));
  await expect(stage3d(page)).toHaveAttribute("data-progress", String(to), {
    timeout: 60000,
  });
}
async function openKnot(page: Page, study: unknown) {
  await page.addInitScript(() => {
    (window as any).requests = 0;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (data: any, options?: any) {
      if (typeof data?.action === "string") (window as any).requests++;
      post.call(this, data, options);
    };
  });
  await page.goto(
    `/?study=3d#s=${deflateRawSync(
      Buffer.from(JSON.stringify({ v: 1, notebook: "3d", study })),
    ).toString("base64url")}`,
  );
  await settled3d(page);
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
}

test("a 3D engraving phrase shows spans, layers and a turning camera from the frozen members alone", async ({
  page,
}) => {
  const study = { ...(await knotSource()), family: knotFamily() };
  study.animation.repeat = "once";
  await openKnot(page, study);
  await expect(page.getByLabel("Family motion", { exact: true })).toHaveValue(
    "phrase",
  );
  await expect(page.getByLabel("Phase 2 turns", { exact: true })).toHaveValue(
    "1",
  );
  await expect(page.getByLabel("Animation camera")).toHaveCount(0);
  const before = await page.evaluate(() => (window as any).requests);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const entry = await camera3d(page);
  // Phases of 1, 2 and 1 seconds, the outer two eased.
  const ease = (u: number) => (1 - Math.cos(Math.PI * u)) / 2;
  const span = (value: number) => {
    const s = value * 4;
    if (s < 1) {
      const p = ease(s);
      return range(Math.floor(2 * p), 4 - Math.floor(2 * p));
    }
    if (s < 3) return [2];
    const p = ease(s - 3);
    return range(2 - Math.floor(2 * p), 2 + Math.floor(2 * p));
  };
  for (const value of [0, 0.125, 0.25, 0.5, 0.625, 0.875, 1]) {
    await seek3d(page, value);
    await expect
      .poll(async () => (await record3d(page)).visible)
      .toEqual(span(value));
  }
  // The selected member's connectors show from the first phase's start.
  await seek3d(page, 0.5);
  await expect(page.locator(".animation-values")).toContainText(
    "Around · member 3 of 5",
  );
  // Halfway through the steady leg with one whole turn: past half a turn
  // from the opening yaw the shorter way toward the key.
  const middle = await camera3d(page);
  expect(middle.zoom).toBeGreaterThan(entry.zoom);
  expect(middle.zoom).toBeLessThan(1.5);
  // The key view, exactly, as the phase ends; the opening view as the
  // phrase ends.
  await seek3d(page, 0.75);
  const key = await camera3d(page);
  expect([key.yaw, key.pitch, key.zoom]).toEqual([1, 0.3, 1.5]);
  await seek3d(page, 1);
  const end = await camera3d(page);
  expect([end.yaw, end.pitch, end.zoom]).toEqual([
    entry.yaw,
    entry.pitch,
    entry.zoom,
  ]);
  expect(await page.evaluate(() => (window as any).requests)).toBe(before);
  // An edit returns to the study; a refusal names its field.
  await page.getByLabel("Phase 1 last member", { exact: true }).fill("2");
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeDisabled();
  await expect(page.locator("#spatial-animation-section")).toContainText(
    "Phase 1 last member must be a whole number from the first member to 5.",
  );
  await expect(
    page.getByRole("button", { name: "Play animation", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Copy link", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Phase 1 last member", { exact: true }).fill("3");
  await expect(
    page.getByRole("button", { name: "Play animation", exact: true }),
  ).toBeEnabled();
  // A refusal no single field owns is shown in the panel.
  await page.getByLabel("Phase 2 duration", { exact: true }).fill("3599");
  await expect(page.locator("#spatial-animation-section")).toContainText(
    "Total phrase duration must be between 0.1 and 3600 seconds.",
  );
  await expect(
    page.getByRole("button", { name: "Play animation", exact: true }),
  ).toBeDisabled();
});

test("the knot's film withdraws into one member, shows its construction and keeps it as the family returns to the opening view", async ({
  page,
}) => {
  const { spatialPresets } = await import("../web/spatial/presets");
  const film = spatialPresets.find((p) => p.name === "A knot remembers")!;
  const phrase = film.family!.phrase!;
  // Phase ends from the preset's own durations, independent of the
  // compiler: 3, 5.5 and 10 seconds.
  const ends = phrase.phases.reduce<number[]>(
    (all, p) => [...all, (all.at(-1) ?? 0) + p.duration],
    [],
  );
  expect(ends).toEqual([3, 5.5, 10]);
  await page.addInitScript(() => {
    (window as any).requests = 0;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (data: any, options?: any) {
      if (typeof data?.action === "string") (window as any).requests++;
      post.call(this, data, options);
    };
  });
  await page.goto("/?study=3d");
  await settled3d(page);
  await choosePreset(page, { label: film.name });
  await settled3d(page);
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
  await expect(page.getByLabel("Family motion", { exact: true })).toHaveValue(
    "phrase",
  );
  // The still's view is the preset's own (data-camera reports only an
  // animation's camera).
  const still = film.view!;
  const all = range(0, 15);
  expect((await record3d(page)).visible).toEqual(all);
  const before = await page.evaluate(() => (window as any).requests);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  // The paused frame as a still: its metadata records the layers it was
  // drawn with and the family slots shown.
  const still3d = async () => {
    await page
      .getByRole("button", { name: "Export image", exact: true })
      .click();
    const download = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: /^SVG/ }).click();
    const text = await readFile((await (await download).path())!, "utf8");
    const desc = /<desc>(.*)<\/desc>/s.exec(text)![1];
    return JSON.parse(
      desc
        .replaceAll("&quot;", '"')
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&amp;", "&"),
    );
  };
  const at = async (seconds: number) => {
    await seek3d(page, seconds / 10);
    return {
      visible: (await record3d(page)).visible,
      camera: await camera3d(page),
    };
  };
  // It opens exactly on the still.
  const start = await at(0);
  expect(start.visible).toEqual(all);
  expect([start.camera.yaw, start.camera.pitch, start.camera.zoom]).toEqual([
    still.yaw,
    still.pitch,
    still.zoom,
  ]);
  // Member 8 alone, closer, then its perpendiculars and pole.
  const alone = await at(3);
  expect(alone.visible).toEqual([7]);
  expect(alone.camera.zoom).toBe(1.4);
  const explained = await at(4);
  expect(explained.visible).toEqual([7]);
  const construction = await still3d();
  expect(construction.layers).toMatchObject({ connectors: true, pole: true });
  expect(construction.family.visible).toEqual([7]);
  // Halfway back: a band about member 8, its construction still shown.
  const returning = await at(7.75);
  expect((await still3d()).layers).toMatchObject({
    connectors: true,
    pole: true,
  });
  expect(returning.visible.length).toBeGreaterThan(1);
  expect(returning.visible.length).toBeLessThan(16);
  expect(returning.visible).toContain(7);
  // It ends exactly on the still, with the study's own layers.
  const end = await at(10);
  expect(end.visible).toEqual(all);
  expect([end.camera.yaw, end.camera.pitch, end.camera.zoom]).toEqual([
    still.yaw,
    still.pitch,
    still.zoom,
  ]);
  // The perpendiculars and pole stay on member 8 as the family returns
  // and the camera turns, to the end.
  const ending = await still3d();
  expect(ending.layers).toMatchObject({ connectors: true, pole: true });
  expect(ending.family.visible).toEqual(all);
  expect(await page.evaluate(() => (window as any).requests)).toBe(before);
});

// A one-second phrase over the knot's family: one member, a turn, and back.
const shortKnot = async () => {
  const s = { ...(await knotSource()), family: knotFamily() };
  s.animation.repeat = "once";
  s.family.phrase.phases[0].duration = 0.25;
  s.family.phrase.phases[1].duration = 0.5;
  s.family.phrase.phases[2].duration = 0.25;
  return s;
};

test("a 3D engraving phrase movie matches its seeks frame for frame and closes on its opening", async ({
  page,
}) => {
  test.slow();
  await openKnot(page, await shortKnot());
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  const refs: Uint8Array[] = [];
  for (const t of [0, 0.5, 1]) {
    await seek3d(page, t);
    await settled3d(page);
    refs.push(decodePng(await pngStill(page)).rgba);
  }
  await page
    .getByRole("button", { name: /^(Stop|Back to study)$/, exact: true })
    .click();
  await open(page, "#spatial-export-settings");
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("1");
  await page
    .locator("#spatial-animation-section")
    .getByLabel("Export frame rate", { exact: true })
    .selectOption("15");
  await page
    .getByRole("slider", { name: "Export quality", exact: true })
    .fill("100");
  const before = await page.evaluate(() => (window as any).requests);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Export MP4 video/ }).click();
  const path = (await (await download).path())!;
  // Exporting composes the held members; it asks the engine for nothing.
  expect(await page.evaluate(() => (window as any).requests)).toBe(before);
  const p = probeVideo(path);
  expect(p).not.toBeNull();
  expect(p).toMatchObject({ width: 1000, height: 760, frames: 15 });
  expect(p!.durations.reduce((a, b) => a + b, 0)).toBe(1000);
  // Frames 0, 7 and 14 stand at 0, 0.5 and 1 of the phrase.
  for (const [k, index] of [0, 7, 14].entries()) {
    const d = frameDifference(path, 1000, 760, index, refs[k])!;
    expect(d.meanDifference).toBeLessThan(3);
    expect(d.unmatchedInk).toBeLessThan(0.03);
  }
  // The phrase returns to its opening span and view: the ends agree.
  const ends = frameDifference(path, 1000, 760, 14, refs[0])!;
  expect(ends.meanDifference).toBeLessThan(3);
  const middle = frameDifference(path, 1000, 760, 7, refs[0])!;
  expect(middle.unmatchedInk).toBeGreaterThan(0.05);
  const decoded = await decodeVideo(page, await readFile(path));
  expect(decoded.duration).toBeCloseTo(1, 3);
});

test("a planar engraving phrase movie draws each frame's span at its absolute time", async ({
  page,
}) => {
  test.slow();
  await page.addInitScript(() => {
    (window as any).exportSVGs = [];
    const create = URL.createObjectURL;
    URL.createObjectURL = function (blob: Blob | MediaSource) {
      if (blob instanceof Blob && blob.type === "image/svg+xml")
        void blob.text().then((text) => (window as any).exportSVGs.push(text));
      return create.call(this, blob);
    };
  });
  await lampPhrase(page);
  // Half a second to member 5 alone, a quarter holding with its rays, and
  // half a second back to all sixteen.
  for (const [field, value] of [
    ["Phase 1 duration", "0.5"],
    ["Phase 2 duration", "0.25"],
    ["Phase 3 duration", "0.25"],
    ["Phase 4 duration", "0.5"],
  ])
    await page.getByLabel(field, { exact: true }).fill(value);
  for (const phase of [1, 4])
    await page
      .getByLabel(`Phase ${phase} name`, { exact: true })
      .fill(`Steady ${phase}`);
  await page.getByLabel("Pace", { exact: true }).selectOption("steady");
  await openExportSettings(page);
  await page.getByLabel("Export resolution", { exact: true }).fill("1");
  await page.getByLabel("Export quality", { exact: true }).fill("80");
  await page
    .getByLabel("Export frame rate", { exact: true })
    .selectOption("15");
  const before = await page.evaluate(() => (window as any).requests);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export MP4 video", exact: false })
    .click();
  const path = (await (await download).path())!;
  expect((await download).suggestedFilename()).toContain("family-phrase");
  expect(await page.evaluate(() => (window as any).requests)).toBe(before);
  const svgs: string[] = await page.evaluate(() => (window as any).exportSVGs);
  // 1.5 seconds at 15 frames a second: frame i stands at 1.5·i/22 s.
  // Independent expectation: steady phases, each end of the span stepping
  // a whole member at a time.
  expect(svgs).toHaveLength(23);
  const expected = (s: number) => {
    if (s < 0.5) {
      const p = s / 0.5;
      return range(Math.floor(4 * p), 15 - Math.floor(11 * p));
    }
    if (s < 1) return [4];
    const p = Math.min(1, (s - 1) / 0.5);
    return range(4 - Math.floor(4 * p), 4 + Math.floor(11 * p));
  };
  const members = await page.evaluate(
    (svgs) =>
      svgs.map((text) =>
        [
          ...new DOMParser()
            .parseFromString(text, "image/svg+xml")
            .querySelectorAll("[data-family-member]"),
        ].map((n) => Number(n.getAttribute("data-family-member"))),
      ),
    svgs,
  );
  members.forEach((ids, i) =>
    expect(ids, `frame ${i}`).toEqual(expected((1.5 * i) / 22)),
  );
  const p = probeVideo(path);
  expect(p).not.toBeNull();
  expect(p!.frames).toBe(23);
  expect(p!.durations.reduce((a, b) => a + b, 0)).toBe(1500);
  // The starter returns to the whole family at the opening view: the last
  // decoded frame matches the first within the encoder's loss.
  const decoded = await decodeVideo(page, await readFile(path));
  expect(decoded.duration).toBeCloseTo(1.5, 3);
  const rgb = decodedFrame(path, 1000, 760, 0)!;
  const first = new Uint8Array(1000 * 760 * 4);
  for (let i = 0; i < 1000 * 760; i++)
    first.set(rgb.subarray(3 * i, 3 * i + 3), 4 * i);
  const ends = frameDifference(path, 1000, 760, 22, first)!;
  expect(ends.meanDifference).toBeLessThan(1);
  expect(ends.unmatchedInk).toBeLessThan(0.01);
  const alone = frameDifference(path, 1000, 760, 11, first)!;
  expect(alone.unmatchedInk).toBeGreaterThan(0.05);
});

test("editing an engraving phrase during its export abandons the file and its frames", async ({
  page,
}) => {
  await lampPhrase(page);
  await openExportSettings(page);
  await page
    .getByLabel("Export frame rate", { exact: true })
    .selectOption("60");
  let downloads = 0;
  page.on("download", () => downloads++);
  await page
    .getByRole("button", { name: "Export MP4 video", exact: false })
    .click();
  const cancel = page.getByRole("button", {
    name: "Cancel export",
    exact: true,
  });
  await expect(cancel).toBeVisible();
  await page
    .getByLabel("Phase 2 name", { exact: true })
    .fill("Rays of the fifth lamp");
  await expect(cancel).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeDisabled();
  // The family's own still is back, and no file arrives later.
  await expect.poll(() => shownMembers(page)).toEqual(range(0, 15));
  await page.waitForTimeout(1500);
  expect(downloads).toBe(0);
  // The edited phrase plays from the start.
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page
    .getByRole("slider", { name: "Animation progress", exact: true })
    .fill("0.444");
  await expect(page.locator(".animation-values")).toContainText(
    "Rays of the fifth lamp · member 5 of 16",
  );
});

// Scrubbing records every disabled change on the panel's buttons; none may
// blink while frames follow the thumb.
async function scrubSteadily(page: Page, section: string) {
  const slider = page.getByRole("slider", {
    name: "Animation progress",
    exact: true,
  });
  const box = (await slider.boundingBox())!;
  await page.evaluate((section) => {
    const changes: string[] = [];
    Object.assign(window, { buttonChanges: changes });
    new MutationObserver((ms) => {
      for (const m of ms)
        if (m.type === "attributes" && m.attributeName === "disabled")
          changes.push((m.target as HTMLElement).outerHTML);
    }).observe(document.querySelector(section)!, {
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled"],
    });
  }, section);
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  expect(await page.evaluate(() => (window as any).buttonChanges)).toEqual([]);
}

for (const [width, height] of [
  [1024, 600],
  [390, 844],
  [844, 390],
])
  test(`engraving phrases are reachable and scrub steadily at ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await lampPhrase(page);
    // The last phase's fields, at the foot of the editor.
    const last = page.getByLabel("Phase 4 last member", { exact: true });
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await scrubSteadily(page, "#animation-section");
    const stop = page.getByRole("button", { name: "Stop", exact: true });
    await stop.scrollIntoViewIfNeeded();
    await expect(stop).toBeInViewport();
    await stop.click();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width + 1);
    // The 3D notebook's film.
    await page.goto("/?study=3d");
    await settled3d(page);
    await choosePreset(page, { label: "A knot remembers" });
    await settled3d(page);
    await page.getByRole("button", { name: "Animation", exact: true }).click();
    const turns = page.getByLabel("Phase 3 turns", { exact: true });
    await turns.scrollIntoViewIfNeeded();
    await expect(turns).toBeInViewport();
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await scrubSteadily(page, "#spatial-animation-section");
    const stop3d = page.getByRole("button", { name: "Stop", exact: true });
    await stop3d.scrollIntoViewIfNeeded();
    await expect(stop3d).toBeInViewport();
    await stop3d.click();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width + 1);
  });
