import { test, expect, type Page } from "@playwright/test";
import { deflateRawSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { choosePreset } from "./helpers";
import { engines, watchEngines } from "./engines";
import { probe } from "./video";
import { execFileSync } from "node:child_process";
import { wireStudy } from "./study-link-wire";
import {
  eventStates,
  heldLevel,
  holdPlan,
  observedClass,
  stories,
  storyContext,
  storyNote,
  type StoryId,
} from "../web/spatial/story";
import { implicitNote } from "../web/spatial/implicit";
import { spatialPresets } from "../web/spatial/presets";
import { presetStudy } from "../web/spatial/link";
import type { ImplicitResult, SpatialConfig } from "../web/spatial/types";

// The topology theater's two curated events (web/spatial/story.ts): Cassini
// drops that join at c = 1, and a sphere that gains a handle as c falls
// through 1. Their critical level and the surfaces on either side are
// derived analytically (docs/mathematics.md, Curated events); the mesh is
// a finite-resolution observation compared against them, never the proof.

// The recipes, written here independently of the app.
const fields: Record<StoryId, (x: number, y: number, z: number) => number> = {
  "two-drops": (x, y, z) =>
    ((x - 1) ** 2 + y ** 2 + z ** 2) * ((x + 1) ** 2 + y ** 2 + z ** 2),
  handle: (x, y, z) => (x ** 2 + y ** 2 - 1) ** 2 + z ** 2,
};
const ids = Object.keys(fields) as StoryId[];
const storyPreset = (id: StoryId) =>
  spatialPresets.findIndex((p) => p.story === id);
const storyConfig = (id: StoryId): SpatialConfig =>
  structuredClone(spatialPresets[storyPreset(id)].config);

// A complete closed mesh of the given pieces' Euler characteristics, with
// nothing cut, open or left out.
function mesh(
  euler: number[],
  change: Partial<ImplicitResult> = {},
): ImplicitResult {
  return {
    box: { xMin: -2, xMax: 2, yMin: -2, yMax: 2, zMin: -2, zMax: 2 },
    grid: [56, 56, 56],
    positions: new Float64Array(9),
    normals: new Float64Array(9),
    triangles: new Int32Array([0, 1, 2]),
    cut: new Int32Array(),
    open: new Int32Array(),
    crossings: new Int32Array(),
    twins: new Int32Array(),
    onCrossing: new Int32Array(),
    components: euler.map((e) => ({
      triangles: 1,
      euler: e,
      closed: true,
      orientable: true,
      crossings: 0,
    })),
    sections: [],
    marks: [],
    nonfinite: 0,
    discontinuities: 0,
    ambiguous: 0,
    singular: 0,
    cones: 0,
    crossingsUnresolved: 0,
    crossingsExhausted: false,
    sectionDiscontinuities: 0,
    sectionsSkipped: 0,
    truncated: false,
    refinement: {
      levels: 0,
      reached: 0,
      bisected: 0,
      unresolved: 0,
      exhausted: false,
    },
    ...change,
  };
}

test("each story's states straddle its one critical level", () => {
  for (const id of ids) {
    const s = stories[id];
    expect(s.critical).toBe(1);
    expect(s.levels.critical).toBe(1);
    // Analytic: the field at the origin is the critical level.
    expect(fields[id](0, 0, 0)).toBe(1);
    for (const state of ["before", "after"] as const) {
      expect(s.levels[state]).toBeGreaterThanOrEqual(s.range[0]);
      expect(s.levels[state]).toBeLessThanOrEqual(s.range[1]);
      expect(s.levels[state]).not.toBe(1);
    }
    expect(Math.sign(s.levels.before - 1)).toBe(-Math.sign(s.levels.after - 1));
  }
  // The drops join as c rises; the handle appears as it falls.
  expect(stories["two-drops"].levels.before).toBeLessThan(1);
  expect(stories.handle.levels.before).toBeGreaterThan(1);
  expect(stories["two-drops"].below.pieces).toEqual([2, 2]);
  expect(stories["two-drops"].above.pieces).toEqual([2]);
  expect(stories.handle.below.pieces).toEqual([0]);
  expect(stories.handle.above.pieces).toEqual([2]);
});

test("the proved region holds every point with F ≤ c up to the story's reach", () => {
  // Every level set F = c lies in the solid F ≤ c. Sample that solid
  // densely in a box much larger than the region and check the bound.
  for (const id of ids) {
    const s = stories[id],
      c = s.range[1],
      e = s.extent(c);
    let inside = 0;
    let reached = { x: 0, y: 0, z: 0 };
    const n = 81,
      h = 6 / (n - 1);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        for (let k = 0; k < n; k++) {
          const x = -3 + i * h,
            y = -3 + j * h,
            z = -3 + k * h;
          if (fields[id](x, y, z) > c) continue;
          inside++;
          expect(Math.abs(x)).toBeLessThanOrEqual(e.x);
          expect(Math.abs(y)).toBeLessThanOrEqual(e.y);
          expect(Math.abs(z)).toBeLessThanOrEqual(e.z);
          reached = {
            x: Math.max(reached.x, Math.abs(x)),
            y: Math.max(reached.y, Math.abs(y)),
            z: Math.max(reached.z, Math.abs(z)),
          };
        }
    expect(inside).toBeGreaterThan(1000);
    // The bound is tight: the solid's lattice points reach within two
    // steps of it (the extreme need not lie on the lattice).
    for (const axis of ["x", "y", "z"] as const)
      expect(e[axis] - reached[axis]).toBeLessThan(2 * h);
    // The story's box encloses it with room to spare.
    const box = storyConfig(id).implicit.box;
    expect(box.xMin).toBeLessThan(-e.x);
    expect(box.xMax).toBeGreaterThan(e.x);
    expect(box.zMin).toBeLessThan(-e.z);
  }
});

test("a story applies while its recipe and an enclosing box remain", () => {
  for (const id of ids) {
    const base = storyConfig(id);
    const at = (change: (c: SpatialConfig) => void) => {
      const c = structuredClone(base);
      change(c);
      return storyContext(c, id);
    };
    expect(storyContext(base, id)).toMatchObject({
      eligible: true,
      state: "before",
    });
    // What the story keeps: the level, resolution, sections, the dormant
    // shape parameter, and a box moved off the lattice that still encloses.
    for (const change of [
      (c: SpatialConfig) => (c.implicit.level = 1),
      (c: SpatialConfig) => (c.implicit.level = 0.9),
      (c: SpatialConfig) => (c.implicit.cells = 24),
      (c: SpatialConfig) => (c.implicit.refine = 2),
      (c: SpatialConfig) => (c.implicit.a = 3),
      (c: SpatialConfig) => (c.implicit.sections.count = 0),
      (c: SpatialConfig) =>
        (c.implicit.box = {
          xMin: -1.97,
          xMax: 2.03,
          yMin: -1.98,
          yMax: 2.02,
          zMin: -2.01,
          zMax: 1.99,
        }),
    ])
      expect(at(change)).toMatchObject({ eligible: true });
    expect(at((c) => (c.implicit.level = 1))).toMatchObject({
      state: "critical",
    });
    expect(
      at((c) => (c.implicit.level = stories[id].levels.after)),
    ).toMatchObject({ state: "after" });
    expect(at((c) => (c.implicit.level = 0.9))).toMatchObject({ state: null });
    // What it does not: another expression, even one drawing the same
    // surface, and a box that could cut the surface open.
    const other = at((c) => (c.implicit.f = `${c.implicit.f} + 0`));
    expect(other).toMatchObject({ eligible: false });
    expect((other as { reason: string }).reason).toMatch(/expression/);
    const clipped = at((c) => (c.implicit.box.xMax = 1.2));
    expect(clipped).toMatchObject({ eligible: false });
    expect((clipped as { reason: string }).reason).toMatch(/box/);
    expect(at((c) => (c.implicit.box.zMin = NaN))).toMatchObject({
      eligible: false,
    });
    expect(at((c) => (c.format = "torus"))).toBeNull();
    expect(storyContext(base, undefined)).toBeNull();
  }
});

test("the mesh is compared only when it is complete", () => {
  expect(observedClass(mesh([2, 2]))).toEqual({
    complete: true,
    pieces: [2, 2],
  });
  expect(observedClass(mesh([2, 0]))).toEqual({
    complete: true,
    pieces: [0, 2],
  });
  for (const [change, why] of [
    [{ cut: new Int32Array([0, 1]) }, /box/],
    [{ open: new Int32Array([0, 1]) }, /open/],
    [{ nonfinite: 3 }, /open/],
    [
      {
        refinement: {
          levels: 3,
          reached: 1,
          bisected: 9,
          unresolved: 4,
          exhausted: true,
        },
      },
      /budget/,
    ],
    [{ crossingsUnresolved: 2 }, /left out/],
    [{ crossingsExhausted: true }, /crossings/],
    [{ triangles: new Int32Array() }, /no surface/],
  ] as const)
    expect(observedClass(mesh([2], change))).toEqual({
      complete: false,
      why: expect.stringMatching(why),
    });
  const oneSided = mesh([0]);
  oneSided.components[0].orientable = false;
  expect(observedClass(oneSided)).toMatchObject({ complete: false });
});

test("story notes compare the mesh and never give the singular surface a genus", () => {
  const drops = stories["two-drops"],
    handle = stories.handle;
  // Regular levels, resolved: the analytic class, and agreement.
  expect(storyNote(drops, 0.84, mesh([2, 2])).join(" ")).toMatch(
    /two separate drops.*the mesh agrees/,
  );
  expect(storyNote(handle, 0.84, mesh([0])).join(" ")).toMatch(
    /torus.*the mesh agrees/,
  );
  // Unresolved: said, never relabeled.
  const missed = storyNote(drops, 0.999, mesh([2])).join(" ");
  expect(missed).toMatch(/two separate drops/);
  expect(missed).toMatch(/gap.*finer than this grid resolves/);
  expect(missed).not.toMatch(/agrees/);
  expect(storyNote(handle, 0.999, mesh([2])).join(" ")).toMatch(
    /hole.*finer than this grid resolves/,
  );
  expect(storyNote(handle, 1.04, mesh([6])).join(" ")).toMatch(
    /finer than this grid resolves/,
  );
  // Incomplete: not compared.
  expect(
    storyNote(drops, 1.16, mesh([0], { cut: new Int32Array([0, 1]) })).join(
      " ",
    ),
  ).toMatch(/one drop.*cannot confirm/);
  // The critical level: singular, without a genus, however the mesh looks.
  for (const s of [drops, handle])
    for (const looks of [[3], [1], [2], [0], [2, 2]]) {
      const words = storyNote(s, 1, mesh(looks)).join(" ");
      expect(words).toMatch(/not a manifold/);
      expect(words).not.toMatch(/genus \d/);
      const described = implicitNote(mesh(looks), { genus: false }).join(" ");
      expect(described).not.toMatch(/genus/);
      expect(described).toMatch(/Euler characteristic/);
    }
  // Outside the story's range the notes describe the mesh alone.
  expect(storyNote(drops, 2, mesh([2])).join(" ")).toMatch(/0\.64 to 1\.44/);
  expect(storyNote(drops, 2, mesh([2])).join(" ")).not.toMatch(/agrees/);
});

test("without a story, every note is as before", () => {
  // implicitNote's genus option is off only when asked; a regular or
  // unrelated study's note is unchanged, word for word.
  for (const looks of [[2], [0], [2, 2], [-2], [3]]) {
    const r = mesh(looks);
    expect(implicitNote(r, {})).toEqual(implicitNote(r));
    expect(implicitNote(r, { genus: true })).toEqual(implicitNote(r));
  }
  expect(implicitNote(mesh([0]))[0]).toBe(
    "The mesh is one piece, closed, of genus 1 (Euler characteristic 0).",
  );
  expect(implicitNote(mesh([0]), { genus: false })[0]).toBe(
    "The mesh is one piece, closed, with Euler characteristic 0.",
  );
  // Every other preset has no story and so no story context.
  for (const p of spatialPresets.filter((p) => !p.story))
    expect(storyContext(p.config, p.story)).toBeNull();
});

test("the level rests at the bracket's levels, and its ends are exact", () => {
  for (const id of ids) {
    const s = stories[id],
      { before, after } = s.levels;
    // The story's own film: before to after, resting at each end.
    const plan = holdPlan({ target: "level", from: before, to: after }, s)!;
    expect(plan.at).toEqual([0, 1]);
    expect(heldLevel(plan, 0)).toBe(before);
    expect(heldLevel(plan, 1)).toBe(after);
    expect(heldLevel(plan, plan.share * 0.99)).toBe(before);
    expect(heldLevel(plan, 1 - plan.share * 0.99)).toBe(after);
    // Between the rests it moves monotonically through the event.
    let last = before;
    for (let i = 0; i <= 200; i++) {
      const v = heldLevel(plan, i / 200);
      expect(Math.sign(v - last) * Math.sign(after - before)).not.toBe(-1);
      last = v;
    }
    expect(heldLevel(plan, 0.5)).toBeCloseTo((before + after) / 2, 12);
    // A wider track rests where it passes each bracket level.
    const wide = holdPlan(
      {
        target: "level",
        from: Math.min(before, after) - 0.2,
        to: Math.max(before, after) + 0.2,
      },
      s,
    )!;
    expect(wide.at.length).toBe(2);
    const rest = (u: number) => {
      // The timeline's time at which motion u is reached, after k rests.
      const k = wide.at.filter((a) => a < u).length;
      return u * (1 - wide.at.length * wide.share) + k * wide.share;
    };
    for (const [k, u] of wide.at.entries()) {
      const t = rest(u) + wide.share / 2;
      expect(heldLevel(wide, t)).toBe(
        [Math.min(before, after), Math.max(before, after)][k],
      );
    }
    expect(heldLevel(wide, 0)).toBe(wide.from);
    expect(heldLevel(wide, 1)).toBe(wide.to);
    // A track that never reaches the bracket, or moves nothing, rests
    // nowhere.
    expect(holdPlan({ target: "level", from: 2, to: 3 }, s)).toBeNull();
    expect(holdPlan({ target: "level", from: 1, to: 1 }, s)).toBeNull();
    expect(holdPlan({ target: "implicitA", from: 0.8, to: 1.2 }, s)).toBeNull();
  }
});

test("story presets open their before state and their own film", () => {
  for (const id of ids) {
    const i = storyPreset(id);
    expect(i).toBeGreaterThan(0);
    const study = presetStudy(i);
    expect(study.story).toBe(id);
    expect(study.config.implicit.level).toBe(stories[id].levels.before);
    expect(study.config.implicit.f).toBe(stories[id].f);
    expect(study.animation.mode).toBe("parameters");
    expect(study.animation.holds).toBe(true);
    expect(study.animation.tracks).toEqual([
      {
        target: "level",
        from: String(stories[id].levels.before),
        to: String(stories[id].levels.after),
      },
    ]);
    // The film starts from the view the preset opens with.
    expect(study.animation.path.keys[0]).toMatchObject(study.view);
    expect(eventStates.map((s) => stories[id].names[s]).every(Boolean)).toBe(
      true,
    );
  }
  // Every other preset opens without a story or holds.
  for (const [i, p] of spatialPresets.entries())
    if (!p.story) {
      expect(presetStudy(i)).not.toHaveProperty("story");
      expect(presetStudy(i).animation).not.toHaveProperty("holds");
    }
});

// In the notebook.

const stage = (page: Page) => page.locator(".spatial-stage");
const strip = (page: Page) => page.locator(".event-strip");
const state = (page: Page, s: string) =>
  page.locator(`.event-state[data-state="${s}"]`);
const note = (page: Page) => page.getByTestId("implicit-note");
async function settled(page: Page) {
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
}
async function shownConfig(page: Page): Promise<SpatialConfig> {
  return JSON.parse((await stage(page).getAttribute("data-config"))!);
}
async function openStory(page: Page, id: StoryId) {
  await page.goto("/?study=3d");
  await expect(page.locator("#spatial-artwork")).toBeVisible();
  await choosePreset(page, String(storyPreset(id)));
  await settled(page);
  await expect(strip(page)).toHaveAttribute("data-previews", "3");
}
// The study as its link carries it.
async function linked(page: Page) {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const copied = page.getByText("Link copied", { exact: true });
  await expect(copied).toHaveCount(0);
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(copied).toBeVisible();
  const href = await page.evaluate(() => navigator.clipboard.readText());
  await page.mouse.click(1, 1);
  return { href, study: wireStudy(/#s=(.*)$/.exec(href)![1]) };
}
// Each decoded frame's share of pixels off its background, decoded at 160
// pixels wide so 30 frames fit in memory; ffprobe's presence (probe) says
// ffmpeg is there.
function smallCoverage(path: string): number[] {
  const [w, h] = [160, 90];
  const bytes = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      path,
      "-vf",
      `scale=${w}:${h}`,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  const size = w * h * 3,
    out: number[] = [];
  for (let from = 0; from + size <= bytes.length; from += size) {
    const bg = [bytes[from], bytes[from + 1], bytes[from + 2]];
    let ink = 0;
    for (let i = from; i < from + size; i += 3)
      if (
        Math.abs(bytes[i] - bg[0]) +
          Math.abs(bytes[i + 1] - bg[1]) +
          Math.abs(bytes[i + 2] - bg[2]) >
        30
      )
        ink++;
    out.push(ink / (w * h));
  }
  return out;
}
const token = (study: unknown) =>
  deflateRawSync(
    Buffer.from(JSON.stringify({ v: 1, notebook: "3d", study })),
  ).toString("base64url");

for (const id of ids)
  test(`${id}: the strip chooses each state, forward and back, changing only the level`, async ({
    page,
  }) => {
    await openStory(page, id);
    const s = stories[id];
    await expect(state(page, "before")).toHaveAttribute("aria-pressed", "true");
    await expect(note(page)).toContainText("the mesh agrees");
    // The reader's own drawing settings: a layer hidden and the camera
    // turned, which every state keeps.
    await page
      .getByRole("checkbox", { name: "Section curves", exact: true })
      .uncheck();
    await page.locator("#spatial-artwork").focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("+");
    const start = (await linked(page)).study;
    expect(start.story).toBe(id);
    expect(start.layers.sections).toBe(false);
    for (const order of [
      ["critical", "after", "critical", "before"],
      ["after", "before"],
    ])
      for (const next of order) {
        await state(page, next).click();
        await settled(page);
        await expect(state(page, next)).toHaveAttribute("aria-pressed", "true");
        const level = s.levels[next as keyof typeof s.levels];
        expect((await shownConfig(page)).implicit.level).toBe(level);
        await expect(
          page.getByRole("textbox", { name: "Level c", exact: true }),
        ).toHaveValue(String(level));
        await expect(note(page)).toContainText(
          next === "critical" ? "not a manifold" : "the mesh agrees",
        );
        if (next === "critical")
          await expect(note(page)).not.toContainText("genus 0");
        const now = (await linked(page)).study;
        expect(now).toEqual({
          ...start,
          config: {
            ...start.config,
            implicit: { ...start.config.implicit, level },
          },
        });
      }
    // The keyboard reaches and presses a state.
    await state(page, "after").focus();
    await page.keyboard.press("Enter");
    await settled(page);
    expect((await shownConfig(page)).implicit.level).toBe(s.levels.after);
    await state(page, "critical").focus();
    await page.keyboard.press("Space");
    await settled(page);
    expect((await shownConfig(page)).implicit.level).toBe(1);
  });

for (const id of ids)
  test(`${id}: choosing the base state ends a film and restores the study`, async ({
    page,
  }) => {
    await watchEngines(page, 8, { spatial: 200 });
    await openStory(page, id);
    await page
      .getByRole("checkbox", { name: "Section curves", exact: true })
      .uncheck();
    await page.locator("#spatial-artwork").press("ArrowLeft");
    const original = (await linked(page)).study;
    const panel = page.locator("#spatial-animation-section");
    if ((await panel.getAttribute("open")) === null)
      await panel.locator(":scope > summary").click();
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.getByRole("slider", { name: "Animation progress" }).fill("0.5");
    await expect(stage(page)).toHaveAttribute("data-progress", "0.5");
    expect((await shownConfig(page)).implicit.level).toBe(1);
    // A paused critical frame must not keep the regular base study's
    // genus, nor can later regular frames keep the singular disclaimer.
    await expect(note(page)).toContainText("not a manifold");
    await expect(note(page)).not.toContainText("genus 0");
    await page.getByRole("slider", { name: "Animation progress" }).fill("0.7");
    await expect(stage(page)).toHaveAttribute("data-progress", "0.7");
    expect((await shownConfig(page)).implicit.level).not.toBe(
      stories[id].levels.before,
    );
    await expect(note(page)).toContainText(
      id === "handle" ? "surface is a torus" : "surface is one drop",
    );
    await expect(note(page)).not.toContainText("not a manifold");
    // The base study still stands at Before. It must remain an effective
    // navigation action while an animation displays another level.
    await state(page, "before").click();
    await expect(stage(page)).not.toHaveAttribute("data-progress");
    await expect(
      page.getByRole("button", { name: "Stop", exact: true }),
    ).toBeDisabled();
    expect(await shownConfig(page)).toEqual(original.config);
    expect((await linked(page)).study).toEqual(original);
    // Reopening the same recipe is a whole-study replacement even though
    // it needs no new numerical request. It resets the edited layers/view
    // and ends the previous film, including any pending frame.
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.getByRole("slider", { name: "Animation progress" }).fill("0.7");
    await expect(stage(page)).toHaveAttribute("data-progress", "0.7");
    await choosePreset(page, String(storyPreset(id)));
    await expect(stage(page)).not.toHaveAttribute("data-progress");
    expect((await linked(page)).study).toEqual(presetStudy(storyPreset(id)));
  });

test("a level still being evaluated settles before a state applies", async ({
  page,
}) => {
  await watchEngines(page, 8, { scalars: 600 });
  await openStory(page, "two-drops");
  const level = page.getByRole("textbox", { name: "Level c", exact: true });
  await level.fill("0.9");
  await state(page, "after").click();
  await settled(page);
  await expect
    .poll(async () => (await shownConfig(page)).implicit.level)
    .toBe(1.16);
  await expect(level).toHaveValue("1.16");
  await expect(state(page, "after")).toHaveAttribute("aria-pressed", "true");
  // And a study chosen meanwhile wins over the state.
  await level.fill("0.95");
  await state(page, "before").click();
  await choosePreset(page, String(storyPreset("handle")));
  await settled(page);
  await expect
    .poll(async () => (await shownConfig(page)).implicit.f)
    .toBe(stories.handle.f);
  expect((await shownConfig(page)).implicit.level).toBe(1.16);
});

test("an edit that leaves the recipe or its box sets the story aside until restored", async ({
  page,
}) => {
  await openStory(page, "two-drops");
  const f = page.getByRole("textbox", { name: "F(x, y, z)", exact: true });
  await f.fill(`${stories["two-drops"].f} + 0`);
  await settled(page);
  await expect(strip(page)).toContainText("no longer the story's expression");
  for (const s of eventStates) await expect(state(page, s)).toBeDisabled();
  await expect(strip(page).locator("img")).toHaveCount(0);
  // The note reads the mesh alone, with its genus.
  await expect(note(page)).not.toContainText("critical level");
  await expect(note(page)).toContainText("genus 0");
  await f.fill(stories["two-drops"].f);
  await settled(page);
  await expect(strip(page)).toHaveAttribute("data-previews", "3");
  await expect(state(page, "after")).toBeEnabled();
  // A box that cuts the surface: refused by its own words, and the mesh is
  // never read as the drops.
  const xTo = page.getByRole("textbox", { name: "x to", exact: true });
  await xTo.fill("1.2");
  await settled(page);
  await expect(strip(page)).toContainText("box no longer holds the surface");
  await expect(note(page)).toContainText("The box cuts it open");
  await expect(note(page)).not.toContainText("agrees");
  await xTo.fill("2");
  await settled(page);
  await expect(state(page, "after")).toBeEnabled();
  await expect(note(page)).toContainText("the mesh agrees");
});

test("too close for the grid, the note says so rather than relabel the mesh", async ({
  page,
}) => {
  // The drops 0.045 apart at c = 0.999 on 24 cells, in a box moved off the
  // lattice: the grid bridges the gap (engine3/implicit_event_test.go).
  await page.goto("/?study=3d");
  await expect(page.locator("#spatial-artwork")).toBeVisible();
  const study = presetStudy(storyPreset("two-drops"));
  study.config.implicit = {
    ...study.config.implicit,
    level: 0.999,
    cells: 24,
    box: {
      xMin: -1.9629,
      xMax: 2.0371,
      yMin: -1.9787,
      yMax: 2.0213,
      zMin: -2.0157,
      zMax: 1.9843,
    },
  };
  await page.goto(`/?study=3d#s=${token(study)}`);
  await expect(page).not.toHaveURL(/#s=/);
  await settled(page);
  await expect
    .poll(async () => (await shownConfig(page)).implicit.level)
    .toBe(0.999);
  await expect(note(page)).toContainText(
    "the gap between them is finer than this grid resolves",
  );
  await expect(note(page)).toContainText("The mesh is one piece");
  await expect(strip(page)).toHaveAttribute("data-previews", "3");
  for (const s of eventStates)
    await expect(state(page, s)).toHaveAttribute("aria-pressed", "false");
});

test("previews are bounded: three per refresh, none for a level", async ({
  page,
}) => {
  await watchEngines(page, 8);
  const sent = async () =>
    (await engines(page)).reduce((n, e) => n + (e.sent.spatial ?? 0), 0);
  await page.goto("/?study=3d");
  await settled(page);
  const opened = await sent();
  await choosePreset(page, String(storyPreset("handle")));
  await settled(page);
  await expect(strip(page)).toHaveAttribute("data-previews", "3");
  // The study, then its three previews.
  await expect.poll(async () => (await sent()) - opened).toBe(4);
  await expect(strip(page).locator("img")).toHaveCount(3);
  // A state changes the level alone: the study is calculated, the
  // previews are not.
  await state(page, "after").click();
  await settled(page);
  await expect.poll(async () => (await sent()) - opened).toBe(5);
  // The theme redraws only the previews, three of them.
  await page.getByRole("button", { name: "Use dark background" }).click();
  await expect(strip(page)).toHaveAttribute("data-previews", "3");
  await expect.poll(async () => (await sent()) - opened).toBe(8);
  await expect(strip(page).locator("img")).toHaveCount(3);
  // Rapid edits replace one another: previews wait for the study to
  // settle, and a refresh in flight finishes at most one calculation.
  // Three edits, each refreshed in full, would send 3 studies and 9
  // previews; coalesced, at most 3 studies, one stale preview and three.
  await page.locator("summary", { hasText: "Sampling & definition" }).click();
  const cells = page.getByRole("spinbutton", { name: "Cells", exact: true });
  const before = await sent();
  await cells.fill("40");
  // The previews of the study before the edit are gone at once.
  await expect(strip(page).locator("img")).toHaveCount(0);
  for (const n of ["44", "48"]) await cells.fill(n);
  await settled(page);
  await expect(strip(page)).toHaveAttribute("data-previews", "3");
  await expect(strip(page).locator("img")).toHaveCount(3);
  const added = (await sent()) - before;
  expect(added).toBeGreaterThanOrEqual(4);
  expect(added).toBeLessThanOrEqual(7);
});

test("a story travels in its link; older links and other studies have none", async ({
  page,
}) => {
  await openStory(page, "handle");
  await state(page, "critical").click();
  await settled(page);
  const { href, study } = await linked(page);
  expect(study.story).toBe("handle");
  expect(study.animation.holds).toBe(true);
  const other = await page.context().newPage();
  await other.goto(href);
  await expect(other.locator(".spatial-stage")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(
    other.locator('.event-state[data-state="critical"]'),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(other.getByTestId("implicit-note")).toContainText(
    "not a manifold",
  );
  // The same study without its story: an ordinary implicit study, whose
  // note gives the mesh's own reading.
  const { story: _, ...plain } = study;
  await other.goto(`/?study=3d#s=${token(plain)}`);
  await expect(other).not.toHaveURL(/#s=/);
  await expect(other.locator(".spatial-stage")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(other.locator(".event-strip")).toHaveCount(0);
  await expect(other.getByTestId("implicit-note")).not.toContainText(
    "critical level",
  );
  await other.close();
});

test("the story's film rests beside the event, and its movie decodes with the seeks' levels", async ({
  page,
}) => {
  test.slow();
  await openStory(page, "two-drops");
  const s = stories["two-drops"];
  const plan = holdPlan({ target: "level", from: 0.84, to: 1.16 }, s)!;
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
  const rest = page.getByRole("checkbox", { name: "Rest beside the event" });
  await expect(rest).toBeChecked();
  await page.getByLabel("Duration (seconds)").fill("2");
  // Seeks: the level at each time is the plan's, exactly.
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Animation progress" });
  const seeks: [number, number][] = [];
  // Ending mid-way: a seek to the end completes the animation.
  for (const t of [0, 0.1, 0.35, 0.5, 0.7, 0.9, 1, 0.5]) {
    await slider.fill(String(t));
    await expect(stage(page)).toHaveAttribute("data-progress", String(t));
    const level = (await shownConfig(page)).implicit.level;
    expect(level).toBe(heldLevel(plan, t));
    seeks.push([t, level]);
  }
  expect(seeks[1][1]).toBe(0.84);
  expect(seeks[5][1]).toBe(1.16);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(stage(page)).not.toHaveAttribute("data-progress");
  // Without rests the same seek moves the level.
  await rest.uncheck();
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await slider.fill("0.1");
  await expect(stage(page)).toHaveAttribute("data-progress", "0.1");
  expect((await shownConfig(page)).implicit.level).toBeCloseTo(
    0.84 + 0.32 * 0.1,
    12,
  );
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await rest.check();
  // The movie: 30 frames over 2 s, the first five at the before level and
  // the last five at the after level, as the seeks. The camera's own flight
  // continues through each rest, so it is held here.
  // With the camera held, only the level moves the drawing: the frames of
  // each rest are the same frame, and the rest differ.
  await page
    .getByLabel("Animation camera", { exact: true })
    .selectOption("hold");
  await page.locator("#spatial-export-settings > summary").click();
  await page.getByLabel("Export format", { exact: true }).selectOption("mp4");
  await page.getByLabel("Export frame rate").selectOption("15");
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("1");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export MP4/ }).click();
  const path = (await (await download).path())!;
  const data = probe(path);
  if (data) {
    expect(data.frames).toBe(30);
    expect(data.durations.reduce((a, b) => a + b, 0)).toBe(2000);
    const coverage = smallCoverage(path);
    expect(coverage).toHaveLength(30);
    const held = (i: number) => heldLevel(plan, i / 29);
    for (let i = 1; i < 30; i++) {
      const same = held(i) === held(i - 1);
      const change = Math.abs(coverage[i] - coverage[i - 1]);
      if (same) expect(change).toBeLessThan(1e-3);
    }
    expect(Math.abs(coverage[29] - coverage[0])).toBeGreaterThan(1e-3);
  }
  expect((await readFile(path)).length).toBeGreaterThan(1000);
});
