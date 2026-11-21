import { test, expect, type Page } from "@playwright/test";
import { deflateRawSync } from "node:zlib";
import { choosePreset } from "./helpers";
import { engines, watchEngines } from "./engines";
import { probe } from "./video";
import { wireStudy } from "./study-link-wire";
import {
  bracket,
  eventFor,
  eventOrder,
  heldLevel,
  holdPlan,
  holdShare,
  stories,
  storyContext,
  storyNote,
  type StoryId,
} from "../web/spatial/story";
import { spatialPresets } from "../web/spatial/presets";
import { presetStudy } from "../web/spatial/link";
import type { ImplicitResult, SpatialConfig } from "../web/spatial/types";

// The topology theater's stories with several events (web/spatial/story.ts
// and docs/mathematics.md, Curated events): the tanglecube's three, and
// the double torus's two handles at one level. Their critical points are
// derived analytically; the mesh is compared with the analysis, never
// taken for it (engine3/implicit_event_catalog_test.go meshes them).

// The recipes, written here independently of the app.
const g = (t: number) => t ** 4 - 5 * t ** 2;
const h = (x: number, y: number) => (x * x + y * y) ** 2 - x * x + y * y;
const fields = {
  tanglecube: (x: number, y: number, z: number) => g(x) + g(y) + g(z),
  "two-handles": (x: number, y: number, z: number) => h(x, y) ** 2 + z * z,
} as const;
type Id = keyof typeof fields;
const ids = Object.keys(fields) as Id[];
const s2 = Math.sqrt(2.5);
// Every critical point of each recipe at the levels its story covers, by
// the analysis: products of g's critical points 0 and ±√(5/2), and the
// centers (±1/√2, 0, 0) of the double torus's holes.
const criticalPoints: Record<Id, [number, [number, number, number][]][]> = {
  tanglecube: [
    [
      -12.5,
      [
        [0, s2, s2],
        [s2, 0, -s2],
        [-s2, s2, 0],
      ],
    ],
    [
      -6.25,
      [
        [s2, 0, 0],
        [0, -s2, 0],
        [0, 0, s2],
      ],
    ],
    [0, [[0, 0, 0]]],
  ],
  "two-handles": [
    [
      1 / 16,
      [
        [Math.SQRT1_2, 0, 0],
        [-Math.SQRT1_2, 0, 0],
      ],
    ],
  ],
};
// The surface on each side, as Euler characteristics, ascending.
const classes: Record<Id, number[][]> = {
  tanglecube: [[2, 2, 2, 2, 2, 2, 2, 2], [-8], [2, 2], [2]],
  "two-handles": [[-2], [2]],
};

const storyPreset = (id: StoryId) =>
  spatialPresets.findIndex((p) => p.story === id);
const storyConfig = (id: StoryId): SpatialConfig =>
  structuredClone(spatialPresets[storyPreset(id)].config);
const atLevel = (id: StoryId, level: number) => {
  const c = storyConfig(id);
  c.implicit.level = level;
  return c;
};

function mesh(
  euler: number[],
  change: Partial<ImplicitResult> = {},
): ImplicitResult {
  return {
    box: { xMin: -3, xMax: 3, yMin: -3, yMax: 3, zMin: -3, zMax: 3 },
    grid: [48, 48, 48],
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
    usesA: false,
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

test("each story's events and sides are the analysis's, in order", () => {
  for (const id of ids) {
    const s = stories[id];
    const critical = s.events.map((e) => e.critical);
    expect(critical).toEqual(criticalPoints[id].map(([c]) => c));
    expect(s.sides.map((side) => side.pieces)).toEqual(classes[id]);
    // Analytic: each listed point is at its critical level, and the
    // gradient vanishes there.
    for (const [c, points] of criticalPoints[id])
      for (const [x, y, z] of points) {
        expect(fields[id](x, y, z)).toBeCloseTo(c, 12);
        const d = 1e-5;
        for (const [dx, dy, dz] of [
          [d, 0, 0],
          [0, d, 0],
          [0, 0, d],
        ]) {
          const grad =
            (fields[id](x + dx, y + dy, z + dz) -
              fields[id](x - dx, y - dy, z - dz)) /
            (2 * d);
          expect(Math.abs(grad)).toBeLessThan(1e-6);
        }
      }
    // Each side's level is regular, strictly between its neighbors'
    // critical levels, within the levels the story covers.
    for (const [i, side] of s.sides.entries()) {
      const below = critical[i - 1] ?? s.range[0],
        above = critical[i] ?? s.range[1];
      expect(side.level).toBeGreaterThan(below);
      expect(side.level).toBeLessThan(above);
      expect(side.title).toBeTruthy();
      expect(side.name).toBeTruthy();
    }
    for (const e of s.events) {
      expect(e.title).toBeTruthy();
      expect(e.label).toBeTruthy();
      expect(e.meeting).toBeTruthy();
    }
  }
  // The tanglecube grows; the double torus's handles open as c falls.
  expect(stories.tanglecube.order).toBe("up");
  expect(stories["two-handles"].order).toBe("down");
});

test("the proved region holds every point with F ≤ c up to the story's reach", () => {
  for (const id of ids) {
    const s = stories[id],
      c = s.range[1],
      e = s.extent(c),
      box = storyConfig(id).implicit.box;
    // A sample box half again as large as the region.
    const r = { x: 1.5 * e.x, y: 1.5 * e.y, z: 1.5 * e.z };
    let inside = 0;
    const reached = { x: 0, y: 0, z: 0 };
    const n = 91;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        for (let k = 0; k < n; k++) {
          const x = -r.x + (2 * r.x * i) / (n - 1),
            y = -r.y + (2 * r.y * j) / (n - 1),
            z = -r.z + (2 * r.z * k) / (n - 1);
          if (fields[id](x, y, z) > c) continue;
          inside++;
          reached.x = Math.max(reached.x, Math.abs(x));
          reached.y = Math.max(reached.y, Math.abs(y));
          reached.z = Math.max(reached.z, Math.abs(z));
        }
    expect(inside).toBeGreaterThan(1000);
    // Every sample of the solid lies within the half-widths, which the
    // lattice reaches within a few steps (the extreme need not lie on it).
    for (const axis of ["x", "y", "z"] as const) {
      expect(reached[axis]).toBeLessThanOrEqual(e[axis]);
      expect(e[axis] - reached[axis]).toBeLessThan((6 * r[axis]) / (n - 1));
    }
    // Each half-width is reached exactly, at the analysis's extreme
    // points: on F = c, at that coordinate.
    for (const level of [s.range[0], c]) {
      const w = s.extent(level);
      const extremes: [number, number, number][] =
        id === "tanglecube"
          ? [
              [w.x, s2, s2],
              [s2, w.y, s2],
              [s2, s2, w.z],
            ]
          : [
              [w.x, 0, 0],
              [Math.sqrt((1 - 2 * w.y ** 2) / 2), w.y, 0],
              [1, 0, w.z],
            ];
      for (const [x, y, z] of extremes)
        expect(fields[id](x, y, z)).toBeCloseTo(level, 12);
    }
    expect(box.xMin).toBeLessThan(-e.x);
    expect(box.xMax).toBeGreaterThan(e.x);
    expect(box.yMin).toBeLessThan(-e.y);
    expect(box.yMax).toBeGreaterThan(e.y);
    expect(box.zMin).toBeLessThan(-e.z);
    expect(box.zMax).toBeGreaterThan(e.z);
  }
});

test("each event's bracket is its neighboring sides and its critical level, in the story's order", () => {
  const t = stories.tanglecube;
  expect(eventOrder(t)).toEqual([0, 1, 2]);
  expect(eventOrder(stories["two-handles"])).toEqual([0]);
  expect(bracket(t, 0).levels).toEqual({
    before: -15,
    critical: -12.5,
    after: -10,
  });
  // The side between two events is shared by their brackets.
  expect(bracket(t, 1).levels).toEqual({
    before: -10,
    critical: -6.25,
    after: -3,
  });
  expect(bracket(t, 2).levels).toEqual({
    before: -3,
    critical: 0,
    after: 2,
  });
  expect(bracket(t, 0).names).toEqual({
    before: t.sides[0].title,
    critical: t.events[0].title,
    after: t.sides[1].title,
  });
  // Descending: the sphere comes first.
  const d = stories["two-handles"];
  expect(bracket(d, 0).levels).toEqual({
    before: 0.09,
    critical: 0.0625,
    after: 0.04,
  });
  expect(bracket(d, 0).names.before).toBe(d.sides[1].title);
  // The one-event stories keep their states and names.
  expect(bracket(stories["two-drops"], 0)).toMatchObject({
    critical: 1,
    levels: { before: 0.84, critical: 1, after: 1.16 },
    names: {
      before: "Two drops",
      critical: "Touching at a point",
      after: "One drop",
    },
  });
  expect(bracket(stories.handle, 0)).toMatchObject({
    critical: 1,
    levels: { before: 1.16, critical: 1, after: 0.84 },
    names: {
      before: "A sphere",
      critical: "Pinched at the center",
      after: "A torus",
    },
  });
});

test("a new level moves the shown event onto the event whose state it is, and keeps a shared one", () => {
  const t = stories.tanglecube;
  // A level on one event's state is that event's.
  expect(eventFor(t, -15)).toBe(0);
  expect(eventFor(t, -12.5)).toBe(0);
  expect(eventFor(t, -6.25)).toBe(1);
  expect(eventFor(t, 0)).toBe(2);
  expect(eventFor(t, 2)).toBe(2);
  // A shared side belongs to the event shown when that one has it, and
  // otherwise to the event it leads to.
  expect(eventFor(t, -10, 0)).toBe(0);
  expect(eventFor(t, -10, 1)).toBe(1);
  expect(eventFor(t, -10, 2)).toBe(1);
  expect(eventFor(t, -10)).toBe(1);
  expect(eventFor(t, -3, 2)).toBe(2);
  // Any other level keeps the shown event, or opens at the nearest.
  expect(eventFor(t, -8, 2)).toBe(2);
  expect(eventFor(t, -8)).toBe(1);
  expect(eventFor(t, 100)).toBe(2);
  expect(eventFor(t, NaN)).toBe(0);
  // Descending, a shared side leads to the event below it.
  expect(eventFor(stories["two-handles"], 0.09)).toBe(0);
  // The context reads the state within the event shown.
  expect(storyContext(atLevel("tanglecube", -10), "tanglecube", 0)).toEqual({
    story: t,
    eligible: true,
    event: 0,
    state: "after",
  });
  expect(storyContext(atLevel("tanglecube", -10), "tanglecube", 1)).toEqual({
    story: t,
    eligible: true,
    event: 1,
    state: "before",
  });
  // An event shown is kept, even when the level is another's state.
  expect(storyContext(atLevel("tanglecube", -10), "tanglecube", 2)).toEqual({
    story: t,
    eligible: true,
    event: 2,
    state: null,
  });
  // With none shown, the level decides.
  expect(storyContext(atLevel("tanglecube", -10), "tanglecube")).toEqual({
    story: t,
    eligible: true,
    event: 1,
    state: "before",
  });
  expect(storyContext(atLevel("tanglecube", -8), "tanglecube", 2)).toEqual({
    story: t,
    eligible: true,
    event: 2,
    state: null,
  });
  expect(storyContext(storyConfig("tanglecube"), "tanglecube")).toEqual({
    story: t,
    eligible: true,
    event: 0,
    state: "before",
  });
});

test("a multi-event story applies while its recipe and an enclosing box remain", () => {
  for (const id of ids) {
    const base = storyConfig(id);
    const e = stories[id].extent(stories[id].range[1]);
    for (const change of [
      (c: SpatialConfig) => (c.implicit.level = stories[id].events[0].critical),
      (c: SpatialConfig) => (c.implicit.cells = 24),
      (c: SpatialConfig) => (c.implicit.refine = 2),
      (c: SpatialConfig) => (c.implicit.sections.count = 0),
    ]) {
      const c = structuredClone(base);
      change(c);
      expect(storyContext(c, id)).toMatchObject({ eligible: true });
    }
    const other = structuredClone(base);
    other.implicit.f = `${other.implicit.f} + 0`;
    expect(storyContext(other, id)).toMatchObject({ eligible: false });
    const clipped = structuredClone(base);
    clipped.implicit.box.zMax = 0.99 * e.z;
    expect(storyContext(clipped, id)).toMatchObject({
      eligible: false,
      reason: expect.stringMatching(/box/),
    });
  }
});

test("notes name the critical levels on each side, with true minus signs", () => {
  const t = stories.tanglecube;
  expect(storyNote(t, -15, mesh(classes.tanglecube[0]))).toEqual([
    "Below the critical level c = −12.5 the surface is eight separate drops, and the mesh agrees.",
  ]);
  expect(storyNote(t, -10, mesh([-8]))).toEqual([
    "Between the critical levels c = −12.5 and c = −6.25 the surface is one surface of genus 5, and the mesh agrees.",
  ]);
  expect(storyNote(t, -3, mesh([2, 2]))).toEqual([
    "Between the critical levels c = −6.25 and c = 0 the surface is two nested spheres, and the mesh agrees.",
  ]);
  expect(storyNote(t, 2, mesh([2]))).toEqual([
    "Above the critical level c = 0 the surface is one sphere, and the mesh agrees.",
  ]);
  // A misread names what narrows toward the nearer event.
  expect(storyNote(t, -12.3, mesh([2, 2, 2, 2, 2, 2, 2, 2])).join(" ")).toMatch(
    /necks are finer than this grid resolves.*farther from −12\.5\.$/,
  );
  expect(storyNote(t, -6.4, mesh([2, 2])).join(" ")).toMatch(
    /windows are finer than this grid resolves.*farther from −6\.25\.$/,
  );
  expect(storyNote(t, -0.1, mesh([2])).join(" ")).toMatch(
    /hollow is finer than this grid resolves.*farther from 0\.$/,
  );
  // Nothing narrows above the last event: the misread is said plainly.
  expect(storyNote(t, 0.1, mesh([2, 2]))).toEqual([
    "Above the critical level c = 0 the surface is one sphere, but the mesh reads otherwise. Use more cells or refinement.",
  ]);
  // Each critical level is singular, with its own meeting.
  for (const [i, e] of t.events.entries()) {
    const words = storyNote(t, e.critical, mesh([1])).join(" ");
    expect(words).toContain(`c = ${["−12.5", "−6.25", "0"][i]} ${e.meeting}`);
    expect(words).toMatch(/not a manifold/);
  }
  expect(storyNote(t, -19, mesh([2])).join(" ")).toMatch(/−18 to 4/);
  // The one-event stories' notes are unchanged, word for word.
  const drops = stories["two-drops"];
  expect(storyNote(drops, 0.84, mesh([2, 2]))).toEqual([
    "Below the critical level c = 1 the surface is two separate drops, and the mesh agrees.",
  ]);
  expect(storyNote(drops, 0.999, mesh([2]))).toEqual([
    "Below the critical level c = 1 the surface is two separate drops, but the mesh reads otherwise: the gap between them is finer than this grid resolves at this level. Use more cells or refinement, or a level farther from 1.",
  ]);
  expect(storyNote(stories.handle, 1.04, mesh([6]))).toEqual([
    "Above the critical level c = 1 the surface is a sphere, but the mesh reads otherwise: the gap between its dimples is finer than this grid resolves at this level. Use more cells or refinement, or a level farther from 1.",
  ]);
  expect(storyNote(drops, 1, mesh([3]))).toEqual([
    "At the critical level c = 1 the drops touch at the origin, where ∇F vanishes: the surface is not a manifold there, so it has no genus. The mesh is a finite picture of it and can look smooth.",
  ]);
  expect(storyNote(drops, 2, mesh([2]))).toEqual([
    "The story's analysis covers levels from 0.64 to 1.44; at c = 2 the notes describe the mesh alone.",
  ]);
});

test("the passage rests at every side it passes, and its ends are exact", () => {
  const t = stories.tanglecube;
  const plan = holdPlan({ target: "level", from: -15, to: 2 }, t)!;
  expect(plan.levels).toEqual([-15, -10, -3, 2]);
  expect(plan.at[0]).toBe(0);
  expect(plan.at[3]).toBe(1);
  // Four rests of 0.15 leave 0.4 of the timeline moving.
  expect(plan.share).toBe(holdShare);
  expect(heldLevel(plan, 0)).toBe(-15);
  expect(heldLevel(plan, 1)).toBe(2);
  // Each rest holds its level exactly, at the time its motion reaches it.
  const moving = 1 - plan.at.length * plan.share;
  for (const [k, u] of plan.at.entries()) {
    const start = u * moving + k * plan.share;
    for (const f of [0.01, 0.5, 0.99])
      expect(heldLevel(plan, start + f * plan.share)).toBe(plan.levels[k]);
  }
  // Monotone through every event.
  let last = -Infinity;
  for (let i = 0; i <= 400; i++) {
    const v = heldLevel(plan, i / 400);
    expect(v).toBeGreaterThanOrEqual(last);
    last = v;
  }
  // A track between two sides rests only at those it passes.
  expect(holdPlan({ target: "level", from: -11, to: -2 }, t)!.levels).toEqual([
    -10, -3,
  ]);
  // More rests than the timeline can hold share 0.6 of it between them.
  const crowded = holdPlan(
    { target: "level", from: -15, to: 2 },
    {
      ...t,
      sides: [
        ...t.sides,
        ...t.sides.map((s) => ({ ...s, level: s.level + 0.5 })),
      ],
    },
  )!;
  // Seven of the eight sides lie on the track; the eighth, 2.5, beyond it.
  expect(crowded.at).toHaveLength(7);
  expect(crowded.share).toBeCloseTo(0.6 / 7, 15);
  expect(heldLevel(crowded, 1)).toBe(2);
  // The one-event films keep their rests and share.
  const drops = holdPlan(
    { target: "level", from: 0.84, to: 1.16 },
    stories["two-drops"],
  )!;
  expect(drops).toEqual({
    from: 0.84,
    to: 1.16,
    at: [0, 1],
    levels: [0.84, 1.16],
    share: 0.15,
  });
});

test("multi-event presets open their first state and their own film", () => {
  for (const id of ids) {
    const i = storyPreset(id);
    expect(i).toBeGreaterThan(0);
    const study = presetStudy(i);
    const s = stories[id];
    const first = bracket(s, eventOrder(s)[0]).levels.before;
    const last = bracket(s, eventOrder(s).at(-1)!).levels.after;
    expect(study.story).toBe(id);
    expect(study.config.implicit.f).toBe(s.f);
    expect(study.config.implicit.level).toBe(first);
    expect(study.animation.holds).toBe(true);
    expect(study.animation.tracks).toEqual([
      { target: "level", from: String(first), to: String(last) },
    ]);
    expect(study.animation.path.keys[0]).toMatchObject(study.view);
  }
  // The examples whose fields these share are unchanged ordinary studies.
  for (const name of ["The tanglecube", "A double torus"]) {
    const p = spatialPresets.find((p) => p.name === name)!;
    expect(p.story).toBeUndefined();
  }
});

// In the notebook.

const stage = (page: Page) => page.locator(".spatial-stage");
const strip = (page: Page) => page.locator(".event-strip");
const state = (page: Page, s: string) =>
  page.locator(`.event-state[data-state="${s}"]`);
const chooser = (page: Page) =>
  strip(page).getByRole("group", { name: "Events" });
const eventButton = (page: Page, i: number) =>
  chooser(page).locator(`button[data-event="${i}"]`);
const note = (page: Page) => page.getByTestId("implicit-note");
const levelField = (page: Page) =>
  page.getByRole("textbox", { name: "Level c", exact: true });
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
const token = (study: unknown) =>
  deflateRawSync(
    Buffer.from(JSON.stringify({ v: 1, notebook: "3d", study })),
  ).toString("base64url");

test("the tanglecube's chooser shows each event's states, and a state changes only the level", async ({
  page,
}) => {
  await openStory(page, "tanglecube");
  const t = stories.tanglecube;
  await expect(chooser(page).getByRole("button")).toHaveCount(3);
  await expect(eventButton(page, 0)).toHaveAttribute("aria-pressed", "true");
  await expect(eventButton(page, 0)).toContainText("c = −12.5");
  await expect(eventButton(page, 1)).toContainText("c = −6.25");
  await expect(state(page, "before")).toHaveAttribute("aria-pressed", "true");
  await expect(state(page, "before")).toContainText("c = −15");
  await expect(note(page)).toContainText(
    "eight separate drops, and the mesh agrees",
  );
  await page
    .getByRole("checkbox", { name: "Section curves", exact: true })
    .uncheck();
  const start = (await linked(page)).study;
  expect(start.story).toBe("tanglecube");
  // Choosing an event changes what the strip shows, not the study.
  await eventButton(page, 1).click();
  await expect(eventButton(page, 1)).toHaveAttribute("aria-pressed", "true");
  await expect(strip(page)).toHaveAttribute("data-previews", "3");
  await expect(state(page, "before")).toContainText("c = −10");
  await expect(state(page, "critical")).toContainText("c = −6.25");
  await expect(state(page, "after")).toContainText("c = −3");
  for (const s of ["before", "critical", "after"])
    await expect(state(page, s)).toHaveAttribute("aria-pressed", "false");
  expect((await linked(page)).study).toEqual(start);
  // Each state of each event, forward and back.
  for (const [event, states] of [
    [1, ["critical", "after", "before"]],
    [2, ["critical", "after"]],
    [0, ["after", "critical"]],
  ] as const) {
    await eventButton(page, event).click();
    for (const next of states) {
      await state(page, next).click();
      await settled(page);
      await expect(state(page, next)).toHaveAttribute("aria-pressed", "true");
      await expect(eventButton(page, event)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      const level = bracket(t, event).levels[next];
      await expect(levelField(page)).toHaveValue(String(level));
      await expect(note(page)).toContainText(
        next === "critical" ? "not a manifold" : "the mesh agrees",
      );
      const now = (await linked(page)).study;
      expect(now).toEqual({
        ...start,
        config: {
          ...start.config,
          implicit: { ...start.config.implicit, level },
        },
      });
    }
  }
});

test("typing a state's level is choosing it, and the chooser follows it", async ({
  page,
}) => {
  await openStory(page, "tanglecube");
  // Chosen through the strip.
  await eventButton(page, 1).click();
  await state(page, "critical").click();
  await settled(page);
  const chosen = {
    config: await shownConfig(page),
    note: await note(page).textContent(),
    link: (await linked(page)).study,
  };
  // The same level typed, from another event and state.
  await eventButton(page, 0).click();
  await state(page, "before").click();
  await settled(page);
  await levelField(page).fill("-6.25");
  await settled(page);
  await expect(eventButton(page, 1)).toHaveAttribute("aria-pressed", "true");
  await expect(state(page, "critical")).toHaveAttribute("aria-pressed", "true");
  expect(await shownConfig(page)).toEqual(chosen.config);
  expect(await note(page).textContent()).toBe(chosen.note);
  expect((await linked(page)).study).toEqual(chosen.link);
  // A shared side keeps the event shown; another event's state moves it.
  await levelField(page).fill("-3");
  await settled(page);
  await expect(eventButton(page, 1)).toHaveAttribute("aria-pressed", "true");
  await expect(state(page, "after")).toHaveAttribute("aria-pressed", "true");
  await levelField(page).fill("2");
  await settled(page);
  await expect(eventButton(page, 2)).toHaveAttribute("aria-pressed", "true");
  await expect(state(page, "after")).toHaveAttribute("aria-pressed", "true");
  // Between states, the event stays and no state is pressed.
  await levelField(page).fill("-1");
  await settled(page);
  await expect(eventButton(page, 2)).toHaveAttribute("aria-pressed", "true");
  for (const s of ["before", "critical", "after"])
    await expect(state(page, s)).toHaveAttribute("aria-pressed", "false");
  await expect(note(page)).toContainText(
    "Between the critical levels c = −6.25 and c = 0",
  );
});

test("previews stay serial across event changes: one in flight, three kept", async ({
  page,
}) => {
  await watchEngines(page, 8);
  const sent = async () =>
    (await engines(page)).reduce((n, e) => n + (e.sent.spatial ?? 0), 0);
  await openStory(page, "tanglecube");
  await expect(strip(page).locator("img")).toHaveCount(3);
  // One event's previews: three calculations, and no study.
  let before = await sent();
  await eventButton(page, 2).click();
  await expect(strip(page).locator("img")).toHaveCount(0);
  await expect(strip(page)).toHaveAttribute("data-previews", "3");
  await expect(strip(page).locator("img")).toHaveCount(3);
  expect((await sent()) - before).toBe(3);
  // Rapid changes replace one another: each reply for an event left
  // behind is dropped, and at most one is in flight when it is left.
  before = await sent();
  for (const i of [0, 1, 0, 2, 1]) await eventButton(page, i).click();
  await expect(strip(page)).toHaveAttribute("data-previews", "3");
  await expect(strip(page).locator("img")).toHaveCount(3);
  const added = (await sent()) - before;
  expect(added).toBeGreaterThanOrEqual(3);
  expect(added).toBeLessThanOrEqual(3 + 4);
  // The images are the last event's: its states' levels.
  await expect(state(page, "critical")).toContainText("c = −6.25");
  // Choosing the event shown again asks for nothing.
  before = await sent();
  await eventButton(page, 1).click();
  await page.waitForTimeout(200);
  expect(await sent()).toBe(before);
});

test("the double torus has one event, two handles, and no chooser", async ({
  page,
}) => {
  await openStory(page, "two-handles");
  await expect(chooser(page)).toHaveCount(0);
  await expect(strip(page)).toContainText("Critical level c = 0.0625");
  await expect(state(page, "before")).toContainText("c = 0.09");
  await expect(state(page, "after")).toContainText("c = 0.04");
  await expect(note(page)).toContainText("a sphere, and the mesh agrees");
  await state(page, "after").click();
  await settled(page);
  await expect(note(page)).toContainText(
    "a surface of genus 2, and the mesh agrees",
  );
  await expect(note(page)).toContainText("genus 2");
  await state(page, "critical").click();
  await settled(page);
  await expect(note(page)).toContainText("not a manifold");
  await expect(note(page)).not.toContainText("genus 2");
});

test("a multi-event story travels in its link with its level, and the chooser opens at it", async ({
  page,
}) => {
  await openStory(page, "tanglecube");
  await eventButton(page, 2).click();
  await state(page, "critical").click();
  await settled(page);
  const { href, study } = await linked(page);
  expect(study.story).toBe("tanglecube");
  // The shown event is not saved; the level decides it on opening.
  expect(JSON.stringify(study)).not.toMatch(/"event"/);
  const other = await page.context().newPage();
  await other.goto(href);
  await expect(other.locator(".spatial-stage")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(
    other.locator('.event-strip button[data-event="2"]'),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    other.locator('.event-state[data-state="critical"]'),
  ).toHaveAttribute("aria-pressed", "true");
  // An unknown story is dropped: an ordinary study.
  await other.goto(
    `/?study=3d#s=${token({ ...study, story: "a-future-event" })}`,
  );
  await expect(other).not.toHaveURL(/#s=/);
  await expect(other.locator(".spatial-stage")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(other.getByTestId("implicit-note")).toContainText("genus");
  await other.close();
});

test("a rest's frames reuse one calculation while the camera flies on", async ({
  page,
}) => {
  await watchEngines(page, 8);
  const sent = async () =>
    (await engines(page)).reduce((n, e) => n + (e.sent.spatial ?? 0), 0);
  await openStory(page, "tanglecube");
  const plan = holdPlan(
    { target: "level", from: -15, to: 2 },
    stories.tanglecube,
  )!;
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Animation progress" });
  const moving = 1 - plan.at.length * plan.share;
  // The second rest, at −10: its start, plus a little and a little more.
  const start = plan.at[1] * moving + plan.share;
  const seek = async (t: number) => {
    const at = Number(t.toFixed(3));
    await slider.fill(String(at));
    await expect(stage(page)).toHaveAttribute("data-progress", String(at));
    await settled(page);
    return {
      level: (await shownConfig(page)).implicit.level,
      view: await stage(page).getAttribute("data-camera"),
    };
  };
  const first = await seek(start + 0.2 * plan.share);
  const before = await sent();
  const second = await seek(start + 0.7 * plan.share);
  expect(first.level).toBe(-10);
  expect(second.level).toBe(-10);
  // The camera moved, the study did not, and nothing was calculated.
  expect(second.view).not.toBe(first.view);
  expect(await sent()).toBe(before);
  // Leaving the rest calculates the new level.
  const moved = await seek(start + 1.5 * plan.share);
  expect(moved.level).not.toBe(-10);
  expect(await sent()).toBe(before + 1);
});

test("the tanglecube's film rests at each side, its seeks are exact, and its movie decodes", async ({
  page,
}) => {
  test.slow();
  await openStory(page, "tanglecube");
  const plan = holdPlan(
    { target: "level", from: -15, to: 2 },
    stories.tanglecube,
  )!;
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
  const rest = page.getByRole("checkbox", { name: "Rest beside the event" });
  await expect(rest).toBeChecked();
  await page.getByLabel("Duration (seconds)").fill("2");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Animation progress" });
  const moving = 1 - 4 * plan.share;
  // The middle of each rest, the end, and back.
  const rests = plan.at.map(
    (u, k) => u * moving + k * plan.share + plan.share / 2,
  );
  for (const [k, t] of [
    ...rests.entries(),
    [4, 1] as const,
    [5, 0.5] as const,
  ]) {
    const at = Number(t.toFixed(3));
    await slider.fill(String(at));
    await expect(stage(page)).toHaveAttribute("data-progress", String(at));
    const level = (await shownConfig(page)).implicit.level;
    expect(level).toBe(heldLevel(plan, at));
    if (k < 4) expect(level).toBe(plan.levels[k]);
    // The note follows the frame shown: a regular side, never singular.
    if (k < 4) await expect(note(page)).not.toContainText("not a manifold");
  }
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(stage(page)).not.toHaveAttribute("data-progress");
  expect((await shownConfig(page)).implicit.level).toBe(-15);
  // The movie: 30 frames over 2 s, decoded independently.
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
  }
  // The study is unchanged by the export.
  expect((await shownConfig(page)).implicit.level).toBe(-15);
});
